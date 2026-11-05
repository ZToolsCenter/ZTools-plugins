#import "ClipboardProbe.h"
#import "ClipboardProbeContracts.h"
#import "ClipboardFileReferences.h"

#import <CommonCrypto/CommonDigest.h>
#import <sys/utsname.h>

static NSDictionary<NSString *, id> *PBFMerge(NSDictionary<NSString *, id> *base,
                                              NSDictionary<NSString *, id> *extra) {
    NSMutableDictionary<NSString *, id> *merged = [base mutableCopy];
    [merged addEntriesFromDictionary:extra];
    return merged;
}

static NSString *PBFHexDigest(NSData *data) {
    unsigned char digest[CC_SHA256_DIGEST_LENGTH];
    CC_SHA256(data.bytes, (CC_LONG)data.length, digest);
    NSMutableString *hex = [NSMutableString stringWithCapacity:CC_SHA256_DIGEST_LENGTH * 2];
    for (NSUInteger index = 0; index < CC_SHA256_DIGEST_LENGTH; index++) {
        [hex appendFormat:@"%02x", digest[index]];
    }
    return hex;
}

static NSString *PBFRepresentationKey(NSUInteger itemIndex, NSString *nativeName) {
    return [NSString stringWithFormat:@"%lu:%@", (unsigned long)itemIndex, nativeName];
}

NSDictionary<NSString *, id> *PBFUnsupportedFormatRecord(NSUInteger itemIndex,
                                                         id nativeName,
                                                         NSString *reasonCode) {
    NSString *safeName = PBFCodecIsValidNativeName(nativeName) ? nativeName : @"unknown";
    return @{@"itemIndex" : @(itemIndex), @"nativeName" : safeName, @"reasonCode" : reasonCode};
}

BOOL PBFIsReservedPasteboardName(NSString *name) {
    if (![name isKindOfClass:NSString.class] || name.length == 0) return YES;
    NSSet<NSString *> *reserved = [NSSet setWithArray:@[NSPasteboardNameGeneral,
                                                        NSPasteboardNameFont,
                                                        NSPasteboardNameRuler,
                                                        NSPasteboardNameFind,
                                                        NSPasteboardNameDrag]];
    return [reserved containsObject:name];
}

NSDictionary<NSString *, id> *PBFRepresentationSummary(NSUInteger itemIndex,
                                                        NSString *nativeName,
                                                        NSData *data) {
    NSMutableDictionary *summary = [@{@"representationKey" : PBFRepresentationKey(itemIndex, nativeName),
                                      @"nativeName" : nativeName,
                                      @"byteLength" : @(data.length),
                                      @"sha256" : PBFHexDigest(data)} mutableCopy];
    [summary addEntriesFromDictionary:PBFCodecReportMetadata(nativeName)];
    return summary;
}

static NSDictionary<NSString *, id> *PBFValidateRepresentationItems(
    NSArray<NSDictionary<NSString *, id> *> *items,
    NSDictionary<NSString *, NSNumber *> *limits,
    NSError **error) {
    uint64_t maxItems = 0, maxFormats = 0, maxFormatBytes = 0, maxTextBytes = 0, maxSnapshotBytes = 0;
    if (!PBFResolveLimits(limits, &maxItems, &maxFormats, &maxFormatBytes, &maxTextBytes, &maxSnapshotBytes, error)) return nil;
    if (items.count == 0 || items.count > maxItems) {
        if (error) *error = PBFError(2, items.count == 0 ? @"empty_plan" : @"too_many_items");
        return nil;
    }
    uint64_t totalBytes = 0;
    NSMutableArray *itemSummaries = [NSMutableArray arrayWithCapacity:items.count];
    NSMutableArray<NSString *> *plannedKeys = [NSMutableArray array];
    for (NSUInteger itemIndex = 0; itemIndex < items.count; itemIndex++) {
        id itemValue = items[itemIndex];
        if (![itemValue isKindOfClass:NSDictionary.class]) {
            if (error) *error = PBFError(3, @"invalid_item");
            return nil;
        }
        NSArray *representations = itemValue[@"representations"];
        if (![representations isKindOfClass:NSArray.class] || representations.count == 0 || representations.count > maxFormats) {
            if (error) *error = PBFError(3, @"invalid_or_over_limit_representations");
            return nil;
        }
        NSMutableSet<NSString *> *seenNames = [NSMutableSet set];
        NSMutableArray *summary = [NSMutableArray arrayWithCapacity:representations.count];
        for (id representationValue in representations) {
            if (![representationValue isKindOfClass:NSDictionary.class]) {
                if (error) *error = PBFError(3, @"invalid_representation");
                return nil;
            }
            NSDictionary *representation = representationValue;
            NSString *nativeName = representation[@"nativeName"];
            NSData *data = representation[@"data"];
            if (!PBFCodecIsValidNativeName(nativeName) ||
                !PBFCodecSupportsNativeName(nativeName) || ![data isKindOfClass:NSData.class] ||
                !PBFCodecValidateRepresentation(nativeName, data) ||
                [seenNames containsObject:nativeName]) {
                if (error) *error = PBFError(3, @"invalid_or_unsupported_representation");
                return nil;
            }
            uint64_t payloadBytes = (uint64_t)data.length;
            if (payloadBytes > maxFormatBytes ||
                (PBFCodecIsTextNativeName(nativeName) && payloadBytes > maxTextBytes) ||
                payloadBytes > maxSnapshotBytes || totalBytes > maxSnapshotBytes - payloadBytes) {
                if (error) *error = PBFError(4, @"payload_limit_exceeded");
                return nil;
            }
            [seenNames addObject:nativeName];
            totalBytes += (uint64_t)data.length;
            [plannedKeys addObject:PBFRepresentationKey(itemIndex, nativeName)];
            [summary addObject:PBFRepresentationSummary(itemIndex, nativeName, data)];
        }
        [itemSummaries addObject:@{@"index" : @(itemIndex), @"representations" : summary}];
    }
    return @{@"items" : itemSummaries,
             @"plannedRepresentationKeys" : plannedKeys,
             @"plannedBytes" : @(totalBytes)};
}

static NSDictionary<NSString *, id> *PBFPublishUsingReadbackProvider(
    NSPasteboard * _Nullable pasteboard,
    NSDictionary<NSString *, id> *plan,
    NSDictionary<NSString *, NSNumber *> *limits,
    PBFReadbackProvider readbackProvider) {
    if (!readbackProvider) return PBFPreMutationFailure(@"invalid_readback_provider");
    if (![plan isKindOfClass:NSDictionary.class]) return PBFPreMutationFailure(@"invalid_plan");
    NSInteger expectedRevision = 0;
    if (!PBFReadRevision(plan[@"expectedRevision"], &expectedRevision)) return PBFPreMutationFailure(@"invalid_expected_revision");
    if (![pasteboard isKindOfClass:NSPasteboard.class]) return PBFPreMutationFailure(@"pasteboard_unavailable");
    if (PBFIsReservedPasteboardName(pasteboard.name)) return PBFPreMutationFailure(@"reserved_pasteboard_name");
    NSError *validationError = nil;
    NSString *planId = plan[@"planId"];
    NSString *snapshotId = plan[@"snapshotId"];
    NSString *manifestRevision = plan[@"manifestRevision"];
    NSArray<NSDictionary<NSString *, id> *> *items = plan[@"items"];
    NSArray *omittedKeys = plan[@"omittedRepresentationKeys"] ?: @[];
    NSDictionary *validation = PBFValidateRepresentationItems(items, limits, &validationError);
    if (![planId isKindOfClass:NSString.class] || planId.length == 0 ||
        ![snapshotId isKindOfClass:NSString.class] || snapshotId.length == 0 ||
        ![manifestRevision isKindOfClass:NSString.class] || manifestRevision.length == 0 ||
        ![omittedKeys isKindOfClass:NSArray.class] || !validation) {
        return PBFPreMutationFailure(validationError ? @"invalid_plan_or_limits" : @"invalid_plan");
    }
    NSInteger currentRevision = pasteboard.changeCount;
    NSDictionary *context = @{@"planId" : planId,
                              @"snapshotId" : snapshotId,
                              @"manifestRevision" : manifestRevision,
                              @"plannedRepresentationKeys" : validation[@"plannedRepresentationKeys"],
                              @"omittedRepresentationKeys" : omittedKeys};
    if (currentRevision != expectedRevision) {
        return PBFResult(@"superseded", PBFMerge(context, @{@"observedRevision" : @(currentRevision), @"clipboardMayHaveChanged" : @NO}));
    }

    // Filesystem availability is a point-in-time metadata check and can change after publication.
    NSString *fileReferenceFailure = PBFFileReferenceAvailabilityFailure(items);
    if (fileReferenceFailure) {
        NSInteger checkedRevision = pasteboard.changeCount;
        if (checkedRevision != expectedRevision) {
            return PBFResult(@"superseded", PBFMerge(context, @{@"observedRevision" : @(checkedRevision),
                                                                 @"clipboardMayHaveChanged" : @NO}));
        }
        return PBFResult(@"failed", PBFMerge(context, @{@"reasonCode" : fileReferenceFailure,
                                                         @"clipboardMayHaveChanged" : @NO}));
    }

    NSMutableArray<NSPasteboardItem *> *nativeItems = [NSMutableArray arrayWithCapacity:items.count];
    for (NSDictionary *itemRecord in items) {
        NSPasteboardItem *nativeItem = [[NSPasteboardItem alloc] init];
        for (NSDictionary *record in itemRecord[@"representations"]) {
            if (![nativeItem setData:record[@"data"] forType:record[@"nativeName"]]) {
                return PBFResult(@"failed", PBFMerge(context, @{@"reasonCode" : @"representation_rejected_before_clear", @"clipboardMayHaveChanged" : @NO}));
            }
        }
        [nativeItems addObject:nativeItem];
    }

    NSInteger checkedRevision = pasteboard.changeCount;
    if (checkedRevision != expectedRevision) {
        return PBFResult(@"superseded", PBFMerge(context, @{@"observedRevision" : @(checkedRevision), @"clipboardMayHaveChanged" : @NO}));
    }
    [pasteboard clearContents];
    NSInteger clearedRevision = pasteboard.changeCount;
    if (clearedRevision == expectedRevision) {
        return PBFResult(@"partial-write", PBFMerge(context, @{@"writtenRepresentationKeys" : @[],
                                                                                               @"missingRepresentationKeys" : context[@"plannedRepresentationKeys"],
                                                                                               @"clipboardMayHaveChanged" : @YES,
                                                                                               @"reasonCode" : @"clear_not_observed",
                                                                                               @"recovery" : @"not-attempted"}));
    }

    BOOL accepted = [pasteboard writeObjects:nativeItems];
    NSInteger publishedRevision = pasteboard.changeCount;
    NSDictionary *verification = nil;
    @try {
        verification = readbackProvider(pasteboard, limits, @(publishedRevision));
    } @catch (NSException *exception) {
        (void)exception;
        verification = @{ @"status" : @"failed", @"reasonCode" : @"readback_provider_exception" };
    }
    NSMutableArray<NSString *> *written = [NSMutableArray array];
    NSMutableArray<NSString *> *missing = [NSMutableArray array];
    NSMutableSet<NSString *> *observedKeys = [NSMutableSet set];
    NSArray *verifiedItems = verification[@"items"];
    NSString *verificationStatus = verification[@"status"];
    BOOL usableStatus = [verificationStatus isEqual:@"ready"] || [verificationStatus isEqual:@"partial"];
    BOOL readbackAvailable = usableStatus && [verifiedItems isKindOfClass:NSArray.class] && verifiedItems.count == items.count;
    if (readbackAvailable) {
        for (NSUInteger itemIndex = 0; itemIndex < items.count; itemIndex++) {
            NSDictionary *expectedItem = items[itemIndex];
            NSDictionary *actualItem = verifiedItems[itemIndex];
            NSDictionary *actualByName = @{};
            NSMutableDictionary *mutableActual = [NSMutableDictionary dictionary];
            for (NSDictionary *actualRep in actualItem[@"representations"]) mutableActual[actualRep[@"nativeName"]] = actualRep[@"data"];
            actualByName = mutableActual;
            for (NSDictionary *expectedRep in expectedItem[@"representations"]) {
                NSString *nativeName = expectedRep[@"nativeName"];
                NSString *key = PBFRepresentationKey(itemIndex, nativeName);
                NSData *actualData = actualByName[nativeName];
                NSData *expectedData = expectedRep[@"data"];
                if (actualData && [actualData isEqualToData:expectedData]) {
                    [written addObject:key];
                    [observedKeys addObject:key];
                } else {
                    [missing addObject:key];
                }
            }
        }
    } else {
        [missing addObjectsFromArray:context[@"plannedRepresentationKeys"]];
    }
    BOOL stillOwned = pasteboard.changeCount == publishedRevision;
    BOOL complete = accepted && stillOwned && missing.count == 0 && written.count == [context[@"plannedRepresentationKeys"] count];
    NSMutableDictionary *resultFields = [context mutableCopy];
    resultFields[@"writeRevision"] = @(publishedRevision);
    resultFields[@"writtenRepresentationKeys"] = written;
    resultFields[@"missingRepresentationKeys"] = missing;
    if (complete) return PBFResult(@"committed", resultFields);
    resultFields[@"clipboardMayHaveChanged"] = @YES;
    if (accepted && stillOwned && !readbackAvailable) {
        resultFields[@"writtenRepresentationKeys"] = context[@"plannedRepresentationKeys"];
        resultFields[@"missingRepresentationKeys"] = @[];
        resultFields[@"reasonCode"] = @"publication-unconfirmed";
        resultFields[@"recovery"] = @"not-attempted";
        return PBFResult(@"partial-write", resultFields);
    }
    resultFields[@"reasonCode"] = accepted ? (stillOwned ? @"readback_incomplete" : @"clipboard_superseded_during_readback") : @"native_write_rejected";
    resultFields[@"recovery"] = stillOwned ? @"not-attempted" : @"superseded";
    return PBFResult(@"partial-write", resultFields);
}

static NSDictionary<NSString *, id> *PBFRealCaptureReadback(
    NSPasteboard *pasteboard,
    NSDictionary<NSString *, NSNumber *> *limits,
    NSNumber *expectedRevision) {
    return PBFCapture(pasteboard, limits, expectedRevision);
}

NSDictionary<NSString *, id> *PBFPublish(NSPasteboard * _Nullable pasteboard,
                                         NSDictionary<NSString *, id> *plan,
                                         NSDictionary<NSString *, NSNumber *> *limits) {
    return PBFPublishUsingReadbackProvider(pasteboard, plan, limits, PBFRealCaptureReadback);
}

NSDictionary<NSString *, id> *PBFPublishForTestingWithReadbackProvider(
    NSPasteboard * _Nullable pasteboard,
    NSDictionary<NSString *, id> *plan,
    NSDictionary<NSString *, NSNumber *> *limits,
    PBFReadbackProvider readbackProvider) {
    return PBFPublishUsingReadbackProvider(pasteboard, plan, limits, readbackProvider);
}
