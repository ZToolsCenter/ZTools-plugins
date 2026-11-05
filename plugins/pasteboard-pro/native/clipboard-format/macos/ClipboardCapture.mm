#import "ClipboardProbe.h"
#import "ClipboardProbeContracts.h"
#import "ClipboardCapturePolicy.h"
#import "ClipboardOwnedCapture.h"

static NSDictionary<NSString *, id> *PBFCaptureUsingProviders(
    NSPasteboard *_Nullable pasteboard,
    NSDictionary<NSString *, NSNumber *> *limits,
    NSNumber *_Nullable expectedRevision,
    NSDictionary<NSString *, id> *policy,
    PBFOrdinaryDataReader reader,
    PBFSourceHintProvider hintProvider,
    PBFRepresentationValidator validator) {
    NSInteger requiredRevision = 0;
    if (expectedRevision && !PBFReadRevision(expectedRevision, &requiredRevision)) {
        return PBFPreMutationFailure(@"invalid_expected_revision");
    }
    if (![pasteboard isKindOfClass:NSPasteboard.class]) return PBFPreMutationFailure(@"pasteboard_unavailable");
    if (PBFIsReservedPasteboardName(pasteboard.name)) return PBFPreMutationFailure(@"reserved_pasteboard_name");
    if (!reader || !hintProvider || !validator) return PBFPreMutationFailure(@"invalid_capture_provider");
    NSDictionary *normalized = PBFNormalizeCapturePolicy(policy);
    if (!normalized) return PBFPreMutationFailure(@"invalid_capture_policy");
    NSError *limitError = nil;
    uint64_t maxItems = 0, maxFormats = 0, maxFormatBytes = 0, maxTextBytes = 0, maxSnapshotBytes = 0;
    if (!PBFResolveLimits(limits, &maxItems, &maxFormats, &maxFormatBytes, &maxTextBytes,
                         &maxSnapshotBytes, &limitError)) {
        return PBFPreMutationFailure(@"invalid_limits");
    }
    NSInteger before = pasteboard.changeCount;
    if (expectedRevision && before != requiredRevision) {
        return PBFResult(@"superseded", @{@"revision" : @(before)});
    }

    // Neither the frontmost application nor a source marker proves the producer.
    // A failed hint query remains unknown; the policy decides if that is allowed.
    NSString *hint = nil;
    @try {
        id observed = hintProvider();
        if ([observed isKindOfClass:NSString.class]) hint = [observed copy];
    } @catch (NSException *exception) {
        (void)exception;
    }
    NSArray<NSPasteboardItem *> *nativeItems = [pasteboard.pasteboardItems copy] ?: @[];
    if (nativeItems.count > maxItems) {
        return PBFResult(@"over-limit", @{@"reasonCode" : @"too_many_items", @"revision" : @(before)});
    }
    NSMutableArray<NSArray<NSString *> *> *itemTypes = [NSMutableArray arrayWithCapacity:nativeItems.count];
    for (NSPasteboardItem *item in nativeItems) {
        if (![item isKindOfClass:NSPasteboardItem.class]) return PBFPreMutationFailure(@"invalid_native_item");
        NSArray *types = [item.types copy];
        if (![types isKindOfClass:NSArray.class]) return PBFPreMutationFailure(@"format_enumeration_failed");
        if (types.count > maxFormats) {
            return PBFResult(@"over-limit", @{@"reasonCode" : @"too_many_formats", @"revision" : @(before)});
        }
        [itemTypes addObject:types];
    }
    NSInteger enumeratedRevision = pasteboard.changeCount;
    if (enumeratedRevision != before) {
        return PBFResult(@"superseded", @{@"revision" : @(enumeratedRevision)});
    }
    // All item type lists must be inspected before the first ordinary read: a
    // concealed marker on a later item applies to the entire snapshot.
    NSDictionary *receipt = PBFEvaluateMacCapturePolicy(normalized, itemTypes, hint);
    NSInteger policyRevision = pasteboard.changeCount;
    if (policyRevision != before) {
        return PBFResult(@"superseded", @{@"revision" : @(policyRevision)});
    }
    if (![receipt[@"captureAllowed"] boolValue]) {
        return PBFResult(@"policy-denied", @{@"reasonCode" : receipt[@"denialCode"],
                                              @"policyReceipt" : receipt});
    }

    NSMutableArray *ownedItems = [NSMutableArray arrayWithCapacity:nativeItems.count];
    NSMutableArray *unsupported = [NSMutableArray array];
    uint64_t totalBytes = 0;
    for (NSUInteger itemIndex = 0; itemIndex < nativeItems.count; itemIndex++) {
        NSPasteboardItem *nativeItem = nativeItems[itemIndex];
        NSMutableArray *representations = [NSMutableArray array];
        for (NSPasteboardType nativeName in itemTypes[itemIndex]) {
            if (!PBFCodecIsValidNativeName(nativeName)) {
                [unsupported addObject:PBFUnsupportedFormatRecord(itemIndex, nativeName, @"invalid_format_name")];
                continue;
            }
            if (PBFIsCapturePolicyMetadataType(nativeName)) continue;
            if (!PBFCodecSupportsNativeName(nativeName)) {
                [unsupported addObject:PBFUnsupportedFormatRecord(itemIndex, nativeName, @"unsupported_format_not_materialized")];
                continue;
            }
            NSInteger current = pasteboard.changeCount;
            if (current != before) {
                return PBFResult(@"superseded", @{@"revision" : @(current), @"policyReceipt" : receipt});
            }
            NSData *provided = reader(nativeItem, nativeName);
            NSInteger readRevision = pasteboard.changeCount;
            if (readRevision != before) {
                return PBFResult(@"superseded", @{@"revision" : @(readRevision), @"policyReceipt" : receipt});
            }
            if (![provided isKindOfClass:NSData.class]) {
                [unsupported addObject:PBFUnsupportedFormatRecord(itemIndex, nativeName, @"unavailable")];
                continue;
            }
            auto exceedsLimits = [&](uint64_t bytes) {
                return bytes > maxFormatBytes ||
                    (PBFCodecIsTextNativeName(nativeName) && bytes > maxTextBytes) ||
                    bytes > maxSnapshotBytes || totalBytes > maxSnapshotBytes - bytes;
            };
            // A native reader can already have allocated its payload. Avoid an
            // additional owned copy when its advertised length is over budget.
            if (exceedsLimits((uint64_t)provided.length)) {
                return PBFResult(@"over-limit", @{ @"reasonCode" : @"payload_limit_exceeded",
                                                   @"revision" : @(before), @"policyReceipt" : receipt });
            }
            NSData *data = [provided copy];
            NSInteger copiedRevision = pasteboard.changeCount;
            if (copiedRevision != before) {
                return PBFResult(@"superseded", @{ @"revision" : @(copiedRevision), @"policyReceipt" : receipt });
            }
            uint64_t payloadBytes = (uint64_t)data.length;
            if (exceedsLimits(payloadBytes)) {
                return PBFResult(@"over-limit", @{@"reasonCode" : @"payload_limit_exceeded",
                                                 @"revision" : @(before), @"policyReceipt" : receipt});
            }
            totalBytes += payloadBytes;
            [representations addObject:@{@"nativeName" : nativeName, @"data" : data}];
        }
        [ownedItems addObject:@{@"index" : @(itemIndex), @"representations" : representations}];
    }
    // This is the end of native materialization. Later clipboard changes must not
    // invalidate a consistent owned snapshot or relabel it as the newer revision.
    NSInteger materializedRevision = pasteboard.changeCount;
    if (materializedRevision != before) {
        return PBFResult(@"superseded", @{ @"revision" : @(materializedRevision), @"policyReceipt" : receipt });
    }
    if (ownedItems.count == 0) {
        return PBFResult(@"failed", @{ @"reasonCode" : @"no_items", @"revision" : @(before), @"policyReceipt" : receipt });
    }
    NSDictionary *validated = PBFValidateOwnedCapture(ownedItems, unsupported, validator);
    return PBFResult(unsupported.count ? @"partial" : @"ready",
                     @{ @"snapshotId" : NSUUID.UUID.UUIDString,
                        @"manifestRevision" : NSUUID.UUID.UUIDString,
                        @"revision" : @(materializedRevision),
                        @"observedRevision" : @(pasteboard.changeCount),
                        @"items" : validated[@"items"],
                        @"summary" : validated[@"summary"],
                        @"unsupported" : unsupported,
                        @"byteLength" : validated[@"byteLength"],
                        @"policyReceipt" : receipt });
}

NSDictionary<NSString *, id> *PBFCaptureForTestingWithProviders(
    NSPasteboard *_Nullable pasteboard,
    NSDictionary<NSString *, NSNumber *> *limits,
    NSNumber *_Nullable expectedRevision,
    NSDictionary<NSString *, id> *policy,
    PBFOrdinaryDataReader reader,
    PBFSourceHintProvider hintProvider,
    PBFRepresentationValidator validator) {
    @try {
        return PBFCaptureUsingProviders(pasteboard, limits, expectedRevision, policy,
                                         reader, hintProvider, validator);
    } @catch (NSException *exception) {
        (void)exception;
        // No payload, source identifier or exception text escapes a failed read.
        return PBFResult(@"failed", @{ @"reasonCode" : @"capture_read_failed" });
    }
}

NSDictionary<NSString *, id> *PBFCaptureForTestingWithPolicy(
    NSPasteboard *_Nullable pasteboard,
    NSDictionary<NSString *, NSNumber *> *limits,
    NSNumber *_Nullable expectedRevision,
    NSDictionary<NSString *, id> *policy,
    PBFOrdinaryDataReader reader,
    PBFSourceHintProvider hintProvider) {
    return PBFCaptureForTestingWithProviders(pasteboard, limits, expectedRevision,
        policy, reader, hintProvider, ^BOOL(NSString *nativeName, NSData *data) {
            return PBFCodecValidateRepresentation(nativeName, data);
        });
}

NSDictionary<NSString *, id> *PBFCaptureWithPolicy(
    NSPasteboard *_Nullable pasteboard,
    NSDictionary<NSString *, NSNumber *> *limits,
    NSNumber *_Nullable expectedRevision,
    NSDictionary<NSString *, id> *policy) {
    return PBFCaptureForTestingWithPolicy(pasteboard, limits, expectedRevision, policy,
        ^NSData *(NSPasteboardItem *item, NSPasteboardType nativeName) {
            return [item dataForType:nativeName];
        },
        ^NSString *{
            return NSWorkspace.sharedWorkspace.frontmostApplication.bundleIdentifier;
        });
}

NSDictionary<NSString *, id> *PBFCapture(
    NSPasteboard *_Nullable pasteboard,
    NSDictionary<NSString *, NSNumber *> *limits,
    NSNumber *_Nullable expectedRevision) {
    // The legacy G0 entrypoint is confined to isolated named boards and publish
    // readback. Its explicit unknown-source allowance is not a production policy.
    NSMutableDictionary *probePolicy = [PBFDefaultCapturePolicy() mutableCopy];
    probePolicy[@"allowUnknownSource"] = @YES;
    return PBFCaptureWithPolicy(pasteboard, limits, expectedRevision, probePolicy);
}
