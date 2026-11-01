#import "ClipboardCapturePolicyTests.h"

#import "ClipboardCapturePolicy.h"
#import "ClipboardProbe.h"

@interface PBFPolicyPromisedText : NSObject <NSPasteboardItemDataProvider>
@property(atomic, assign) NSUInteger callbackCount;
@end

@implementation PBFPolicyPromisedText
- (void)pasteboard:(NSPasteboard *)pasteboard item:(NSPasteboardItem *)item
    provideDataForType:(NSPasteboardType)type {
    (void)pasteboard;
    self.callbackCount++;
    [item setData:[@"promised-fixture-text" dataUsingEncoding:NSUTF8StringEncoding] forType:type];
}
@end

static NSString *const PBFPolicyTestText = NSPasteboardTypeString;
static NSString *const PBFTestHint = @"com.example.SecretForegroundApp";

static NSDictionary<NSString *, id> *PBFPolicyTestCase(NSString *identifier,
                                                       BOOL passed,
                                                       NSString *detailCode) {
    (void)detailCode;
    return @{@"id" : identifier,
             @"status" : passed ? @"pass" : @"fail",
             @"detailCode" : passed ? @"case-passed" : @"case-failed"};
}

static NSData *PBFPolicyTestBytes(NSString *value) {
    return [value dataUsingEncoding:NSUTF8StringEncoding];
}

static BOOL PBFPolicyTestSeed(NSPasteboard *pasteboard,
                              NSArray<NSArray<NSDictionary<NSString *, id> *> *> *items) {
    [pasteboard clearContents];
    NSMutableArray<NSPasteboardItem *> *nativeItems = [NSMutableArray arrayWithCapacity:items.count];
    for (NSArray<NSDictionary<NSString *, id> *> *representations in items) {
        NSPasteboardItem *item = [[NSPasteboardItem alloc] init];
        for (NSDictionary<NSString *, id> *representation in representations) {
            NSString *name = representation[@"nativeName"];
            NSData *data = representation[@"data"];
            if (![item setData:data forType:name]) return NO;
        }
        [nativeItems addObject:item];
    }
    return nativeItems.count > 0 && [pasteboard writeObjects:nativeItems];
}

static NSDictionary<NSString *, id> *PBFPolicyTestRepresentation(NSString *name,
                                                                 NSString *payload) {
    return @{@"nativeName" : name, @"data" : PBFPolicyTestBytes(payload)};
}

static NSArray<NSArray<NSDictionary<NSString *, id> *> *> *PBFPolicyTestTextItems(void) {
    return @[@[PBFPolicyTestRepresentation(PBFPolicyTestText, @"private-test-payload")]];
}

static NSDictionary<NSString *, id> *PBFPolicyTestPolicy(BOOL allowUnknown) {
    NSMutableDictionary *policy = [PBFDefaultCapturePolicy() mutableCopy];
    policy[@"allowUnknownSource"] = @(allowUnknown);
    return PBFNormalizeCapturePolicy(policy);
}

static NSDictionary<NSString *, id> *PBFPolicyTestRun(
    NSPasteboard *pasteboard,
    NSDictionary<NSString *, NSNumber *> *limits,
    NSDictionary<NSString *, id> *policy,
    PBFOrdinaryDataReader reader,
    PBFSourceHintProvider hintProvider) {
    return PBFCaptureForTestingWithPolicy(pasteboard, limits, @(pasteboard.changeCount),
                                          policy, reader, hintProvider);
}

static BOOL PBFPolicyTestHasDenialWithoutPayload(NSDictionary<NSString *, id> *result,
                                                 NSString *expectedCode,
                                                 NSUInteger readCount,
                                                 NSString *secretHint) {
    NSDictionary *receipt = result[@"policyReceipt"];
    if (![result[@"status"] isEqual:@"policy-denied"] || readCount != 0 ||
        ![result[@"reasonCode"] isEqual:expectedCode] ||
        ![receipt[@"denialCode"] isEqual:expectedCode] ||
        ![receipt[@"sourceKind"] isEqual:@"unknown"] ||
        ![receipt[@"sourceAttribution"] isEqual:@"unknown"] ||
        [receipt[@"producerIdentityVerified"] boolValue] ||
        ![receipt[@"contentScanStatus"] isEqual:@"not-scanned"] ||
        result[@"items"] || result[@"summary"] || result[@"byteLength"]) return NO;
    for (id value in receipt.allValues) {
        if ([value isEqual:secretHint]) return NO;
    }
    return YES;
}

static BOOL PBFPolicyTestPromisedPayloadNotRead(NSPasteboard *pasteboard,
                                                NSDictionary<NSString *, NSNumber *> *limits) {
    PBFPolicyPromisedText *provider = [[PBFPolicyPromisedText alloc] init];
    NSPasteboardItem *first = [[NSPasteboardItem alloc] init];
    NSPasteboardItem *second = [[NSPasteboardItem alloc] init];
    [pasteboard clearContents];
    BOOL prepared = [first setDataProvider:provider forTypes:@[PBFPolicyTestText]] &&
        [second setData:[NSData data] forType:@"org.nspasteboard.ConcealedType"];
    BOOL seeded = prepared && [pasteboard writeObjects:@[first, second]];
    if (!seeded || provider.callbackCount != 0) return NO;
    NSDictionary *result = PBFCaptureWithPolicy(pasteboard, limits,
        @(pasteboard.changeCount), PBFPolicyTestPolicy(YES));
    return provider.callbackCount == 0 &&
        [result[@"status"] isEqual:@"policy-denied"] &&
        [result[@"reasonCode"] isEqual:@"concealed-content"] && !result[@"items"];
}

static void PBFPolicyTestAppend(NSMutableArray<NSDictionary<NSString *, id> *> *cases,
                                NSString *identifier,
                                BOOL passed,
                                NSString *successCode) {
    [cases addObject:PBFPolicyTestCase(identifier, passed,
                                       passed ? successCode : @"preflight_assertion_failed")];
}

void PBFRunCapturePolicyTests(
    NSPasteboard *pasteboard,
    NSDictionary<NSString *, NSNumber *> *limits,
    NSMutableArray<NSDictionary<NSString *, id> *> *cases) {
    if (!pasteboard || PBFIsReservedPasteboardName(pasteboard.name)) {
        [cases addObject:PBFPolicyTestCase(@"mac-policy-private-board", NO,
                                           @"private_board_required")];
        return;
    }

    PBFSourceHintProvider noHint = ^NSString *{ return nil; };

    BOOL seeded = PBFPolicyTestSeed(pasteboard, PBFPolicyTestTextItems());
    __block NSUInteger reads = 0;
    PBFOrdinaryDataReader denyCountingReader = ^NSData *(NSPasteboardItem *item,
                                                         NSPasteboardType nativeName) {
        reads++;
        return [item dataForType:nativeName];
    };
    NSMutableDictionary *paused = [PBFDefaultCapturePolicy() mutableCopy];
    paused[@"paused"] = @YES;
    NSDictionary *pausedResult = seeded ? PBFPolicyTestRun(pasteboard, limits,
        PBFNormalizeCapturePolicy(paused), denyCountingReader, noHint) : @{};
    PBFPolicyTestAppend(cases, @"mac-policy-paused-no-read",
        PBFPolicyTestHasDenialWithoutPayload(pausedResult, @"capture-paused", reads, PBFTestHint),
        @"pause_blocks_before_ordinary_payload_read");

    reads = 0;
    NSDictionary *strict = seeded ? PBFPolicyTestRun(pasteboard, limits,
        PBFPolicyTestPolicy(NO), denyCountingReader, noHint) : @{};
    PBFPolicyTestAppend(cases, @"mac-policy-strict-unknown-no-read",
        PBFPolicyTestHasDenialWithoutPayload(strict, @"source-unknown", reads, PBFTestHint),
        @"unknown_producer_denied_before_payload_read");

    reads = 0;
    NSDictionary *frontmostHint = seeded ? PBFPolicyTestRun(pasteboard, limits,
        PBFPolicyTestPolicy(NO), denyCountingReader, ^NSString *{ return PBFTestHint; }) : @{};
    NSDictionary *frontmostReceipt = frontmostHint[@"policyReceipt"];
    PBFPolicyTestAppend(cases, @"mac-policy-frontmost-is-not-owner",
        PBFPolicyTestHasDenialWithoutPayload(frontmostHint, @"source-unknown", reads, PBFTestHint) &&
        [frontmostReceipt[@"frontmostHintObserved"] boolValue] &&
        [frontmostReceipt[@"frontmostHintAttribution"] isEqual:@"heuristic"],
        @"foreground_hint_does_not_confirm_clipboard_producer");

    NSMutableDictionary *excluded = [PBFDefaultCapturePolicy() mutableCopy];
    excluded[@"excludedBundleIdentifiers"] = @[PBFTestHint];
    NSDictionary *excludedPolicy = PBFNormalizeCapturePolicy(excluded);
    reads = 0;
    NSDictionary *excludedResult = seeded ? PBFPolicyTestRun(pasteboard, limits,
        excludedPolicy, denyCountingReader, ^NSString *{ return PBFTestHint; }) : @{};
    PBFPolicyTestAppend(cases, @"mac-policy-excluded-hint-no-read",
        PBFPolicyTestHasDenialWithoutPayload(excludedResult, @"source-excluded", reads, PBFTestHint),
        @"excluded_foreground_hint_denied_without_payload_read");

    reads = 0;
    NSDictionary *unmatchedExcludedResult = seeded ? PBFPolicyTestRun(pasteboard, limits,
        excludedPolicy, denyCountingReader, ^NSString *{ return @"com.example.OtherApp"; }) : @{};
    PBFPolicyTestAppend(cases, @"mac-policy-exclusions-fail-closed",
        PBFPolicyTestHasDenialWithoutPayload(unmatchedExcludedResult, @"source-unknown", reads, PBFTestHint),
        @"unverified_nonmatching_hint_does_not_bypass_exclusions");

    NSMutableDictionary *historyDisabled = [PBFDefaultCapturePolicy() mutableCopy];
    historyDisabled[@"allowLocalHistory"] = @NO;
    reads = 0;
    NSDictionary *historyResult = seeded ? PBFPolicyTestRun(pasteboard, limits,
        PBFNormalizeCapturePolicy(historyDisabled), denyCountingReader, noHint) : @{};
    PBFPolicyTestAppend(cases, @"mac-policy-history-disabled-no-read",
        PBFPolicyTestHasDenialWithoutPayload(historyResult, @"local-history-disabled-by-user", reads, PBFTestHint),
        @"local_history_opt_out_blocks_payload_read");

    NSArray<NSString *> *sensitiveMarkers = @[
        @"org.nspasteboard.ConcealedType",
        @"org.nspasteboard.TransientType",
        @"org.nspasteboard.AutoGeneratedType"
    ];
    NSArray<NSString *> *sensitiveCodes = @[
        @"concealed-content", @"transient-content", @"autogenerated-content"
    ];
    for (NSUInteger index = 0; index < sensitiveMarkers.count; index++) {
        NSString *marker = sensitiveMarkers[index];
        NSString *code = sensitiveCodes[index];
        NSArray *markedItems = @[@[
            PBFPolicyTestRepresentation(PBFPolicyTestText, @"secret-payload-never-read"),
            PBFPolicyTestRepresentation(marker, @"marker-payload-never-read")
        ]];
        reads = 0;
        NSDictionary *markerResult = PBFPolicyTestSeed(pasteboard, markedItems) ?
            PBFPolicyTestRun(pasteboard, limits, PBFPolicyTestPolicy(YES), denyCountingReader, noHint) : @{};
        BOOL markerPresent = [markerResult[@"policyReceipt"][[NSString stringWithFormat:@"%@MarkerPresent",
            [marker isEqual:sensitiveMarkers[0]] ? @"concealed" :
            ([marker isEqual:sensitiveMarkers[1]] ? @"transient" : @"autogenerated")]] boolValue];
        PBFPolicyTestAppend(cases, [NSString stringWithFormat:@"mac-policy-marker-%@-no-read",
            [marker isEqual:sensitiveMarkers[0]] ? @"concealed" :
            ([marker isEqual:sensitiveMarkers[1]] ? @"transient" : @"autogenerated")],
            PBFPolicyTestHasDenialWithoutPayload(markerResult, code, reads, PBFTestHint) && markerPresent,
            @"sensitive_marker_blocks_all_item_payloads");
    }

    NSArray<NSString *> *legacyMarkers = @[
        @"de.petermaurer.TransientPasteboardType",
        @"com.typeit4me.clipping",
        @"Pasteboard generator type",
        @"com.agilebits.onepassword"
    ];
    NSArray<NSString *> *legacyCaseIDs = @[
        @"mac-policy-legacy-textpander-no-read",
        @"mac-policy-legacy-typeit4me-no-read",
        @"mac-policy-legacy-typinator-no-read",
        @"mac-policy-legacy-onepassword-no-read"
    ];
    for (NSUInteger index = 0; index < legacyMarkers.count; index++) {
        NSArray *markedItems = @[@[
            PBFPolicyTestRepresentation(PBFPolicyTestText, @"legacy-sensitive-payload"),
            PBFPolicyTestRepresentation(legacyMarkers[index], @"legacy-marker-payload")
        ]];
        reads = 0;
        BOOL legacySeeded = NO;
        if (index == 2) {
            // The legacy API accepts the old non-UTI tag and AppKit exposes its
            // dynamic UTI through item.types; NSPasteboardItem rejects raw spaces.
            [pasteboard declareTypes:@[PBFPolicyTestText, legacyMarkers[index]] owner:nil];
            legacySeeded = [pasteboard setData:PBFPolicyTestBytes(@"legacy-sensitive-payload")
                                      forType:PBFPolicyTestText] &&
                [pasteboard setData:[NSData data] forType:legacyMarkers[index]];
        } else {
            legacySeeded = PBFPolicyTestSeed(pasteboard, markedItems);
        }
        NSDictionary *legacyResult = legacySeeded ?
            PBFPolicyTestRun(pasteboard, limits, PBFPolicyTestPolicy(YES), denyCountingReader, noHint) : @{};
        PBFPolicyTestAppend(cases, legacyCaseIDs[index],
            [legacyResult[@"status"] isEqual:@"policy-denied"] && reads == 0 &&
            [legacyResult[@"policyReceipt"][@"denialCode"] isEqual:@"legacy-sensitive-content"] &&
            !legacyResult[@"items"], @"legacy_sensitive_marker_blocks_payload_read");
    }

    NSArray *laterItemMarker = @[
        @[PBFPolicyTestRepresentation(PBFPolicyTestText, @"first-item-payload")],
        @[PBFPolicyTestRepresentation(PBFPolicyTestText, @"second-item-payload"),
          PBFPolicyTestRepresentation(@"org.nspasteboard.ConcealedType", @"")]
    ];
    reads = 0;
    NSDictionary *laterMarkerResult = PBFPolicyTestSeed(pasteboard, laterItemMarker) ?
        PBFPolicyTestRun(pasteboard, limits, PBFPolicyTestPolicy(YES), denyCountingReader, noHint) : @{};
    PBFPolicyTestAppend(cases, @"mac-policy-later-item-marker-no-read",
        PBFPolicyTestHasDenialWithoutPayload(laterMarkerResult, @"concealed-content", reads, PBFTestHint) &&
        PBFPolicyTestPromisedPayloadNotRead(pasteboard, limits),
        @"all_items_preflighted_before_first_payload_read");

    reads = 0;
    NSDictionary *allowedUnknown = PBFPolicyTestSeed(pasteboard, PBFPolicyTestTextItems()) ?
        PBFPolicyTestRun(pasteboard, limits, PBFPolicyTestPolicy(YES), ^NSData *(NSPasteboardItem *item,
            NSPasteboardType nativeName) { reads++; return [item dataForType:nativeName]; }, noHint) : @{};
    NSDictionary *allowedReceipt = allowedUnknown[@"policyReceipt"];
    PBFPolicyTestAppend(cases, @"mac-policy-explicit-unknown-preserved",
        [allowedUnknown[@"status"] isEqual:@"ready"] && reads == 1 &&
        [allowedReceipt[@"sourceKind"] isEqual:@"unknown"] &&
        [allowedReceipt[@"sourceAttribution"] isEqual:@"unknown"] &&
        ![allowedReceipt[@"producerIdentityVerified"] boolValue] &&
        [allowedReceipt[@"contentScanStatus"] isEqual:@"not-scanned"] &&
        [allowedUnknown[@"items"][0][@"representations"][0][@"data"] isEqual:PBFPolicyTestBytes(@"private-test-payload")],
        @"explicit_unknown_allowed_keeps_unknown_attribution");

    BOOL realReaderSeeded = PBFPolicyTestSeed(pasteboard, PBFPolicyTestTextItems());
    NSDictionary *realReaderCapture = realReaderSeeded ? PBFCaptureWithPolicy(
        pasteboard, limits, @(pasteboard.changeCount), PBFPolicyTestPolicy(YES)) : @{};
    NSDictionary *realReaderReceipt = realReaderCapture[@"policyReceipt"];
    PBFPolicyTestAppend(cases, @"mac-policy-real-reader-explicit-unknown",
        [realReaderCapture[@"status"] isEqual:@"ready"] &&
        [realReaderReceipt[@"sourceKind"] isEqual:@"unknown"] &&
        [realReaderReceipt[@"sourceAttribution"] isEqual:@"unknown"] &&
        ![realReaderReceipt[@"producerIdentityVerified"] boolValue] &&
        [realReaderCapture[@"items"][0][@"representations"][0][@"data"]
            isEqual:PBFPolicyTestBytes(@"private-test-payload")],
        @"real_data_reader_path_retains_unknown_attribution");

    NSArray *sourceMarkedItems = @[@[
        PBFPolicyTestRepresentation(PBFPolicyTestText, @"visible-payload"),
        PBFPolicyTestRepresentation(@"org.nspasteboard.source", PBFTestHint)
    ]];
    reads = 0;
    NSDictionary *spoofedSourceResult = PBFPolicyTestSeed(pasteboard, sourceMarkedItems) ?
        PBFPolicyTestRun(pasteboard, limits, PBFPolicyTestPolicy(NO), denyCountingReader,
                         ^NSString *{ return PBFTestHint; }) : @{};
    PBFPolicyTestAppend(cases, @"mac-policy-source-marker-untrusted",
        PBFPolicyTestHasDenialWithoutPayload(spoofedSourceResult, @"source-unknown", reads, PBFTestHint) &&
        [spoofedSourceResult[@"policyReceipt"][@"sourceMarkerPresent"] boolValue],
        @"source_marker_is_metadata_and_does_not_verify_producer");

    reads = 0;
    NSDictionary *allowedSourceMarker = PBFPolicyTestSeed(pasteboard, sourceMarkedItems) ?
        PBFPolicyTestRun(pasteboard, limits, PBFPolicyTestPolicy(YES), ^NSData *(NSPasteboardItem *item,
            NSPasteboardType nativeName) { reads++; return [item dataForType:nativeName]; }, noHint) : @{};
    NSDictionary *sourceReceipt = allowedSourceMarker[@"policyReceipt"];
    BOOL sourceTypeExcluded = YES;
    for (NSDictionary *representation in allowedSourceMarker[@"items"][0][@"representations"] ?: @[]) {
        if ([representation[@"nativeName"] isEqual:@"org.nspasteboard.source"]) sourceTypeExcluded = NO;
    }
    PBFPolicyTestAppend(cases, @"mac-policy-source-marker-metadata-only",
        [allowedSourceMarker[@"status"] isEqual:@"ready"] && reads == 1 &&
        [sourceReceipt[@"sourceMarkerPresent"] boolValue] && sourceTypeExcluded &&
        ![sourceReceipt[@"producerIdentityVerified"] boolValue] &&
        ![sourceReceipt.allValues containsObject:PBFTestHint],
        @"source_marker_payload_never_materialized_or_trusted");

    reads = 0;
    NSMutableArray<NSDictionary<NSString *, id> *> *invalidPolicies = [NSMutableArray array];
    NSMutableDictionary *unknownKeyPolicy = [PBFDefaultCapturePolicy() mutableCopy];
    unknownKeyPolicy[@"unexpectedPolicyKey"] = @YES;
    [invalidPolicies addObject:unknownKeyPolicy];

    NSMutableDictionary *missingKeyPolicy = [PBFDefaultCapturePolicy() mutableCopy];
    [missingKeyPolicy removeObjectForKey:@"allowLocalHistory"];
    [invalidPolicies addObject:missingKeyPolicy];

    NSMutableDictionary *numericBooleanPolicy = [PBFDefaultCapturePolicy() mutableCopy];
    numericBooleanPolicy[@"paused"] = @1;
    [invalidPolicies addObject:numericBooleanPolicy];

    NSMutableArray<NSString *> *tooManyRules = [NSMutableArray arrayWithCapacity:129];
    for (NSUInteger index = 0; index < 129; index++) {
        [tooManyRules addObject:[NSString stringWithFormat:@"com.example.app%lu", (unsigned long)index]];
    }
    NSMutableDictionary *tooManyRulesPolicy = [PBFDefaultCapturePolicy() mutableCopy];
    tooManyRulesPolicy[@"excludedBundleIdentifiers"] = tooManyRules;
    [invalidPolicies addObject:tooManyRulesPolicy];

    NSMutableDictionary *longIdentifierPolicy = [PBFDefaultCapturePolicy() mutableCopy];
    longIdentifierPolicy[@"excludedBundleIdentifiers"] = @[[NSString stringWithFormat:@"%@x",
        [@"a" stringByPaddingToLength:255 withString:@"a" startingAtIndex:0]]];
    [invalidPolicies addObject:longIdentifierPolicy];

    NSMutableDictionary *nonStringRulePolicy = [PBFDefaultCapturePolicy() mutableCopy];
    nonStringRulePolicy[@"excludedBundleIdentifiers"] = @[@42];
    [invalidPolicies addObject:nonStringRulePolicy];

    NSMutableDictionary *duplicateRulesPolicy = [PBFDefaultCapturePolicy() mutableCopy];
    duplicateRulesPolicy[@"excludedBundleIdentifiers"] = @[PBFTestHint, PBFTestHint];
    [invalidPolicies addObject:duplicateRulesPolicy];

    BOOL invalidPolicyPass = seeded;
    for (NSDictionary *invalidPolicy in invalidPolicies) {
        reads = 0;
        NSDictionary *invalidPolicyResult = PBFPolicyTestRun(pasteboard, limits,
            invalidPolicy, denyCountingReader, noHint);
        invalidPolicyPass = invalidPolicyPass && !PBFNormalizeCapturePolicy(invalidPolicy) &&
            reads == 0 && [invalidPolicyResult[@"status"] isEqual:@"failed"] &&
            [invalidPolicyResult[@"reasonCode"] isEqual:@"invalid_capture_policy"] &&
            !invalidPolicyResult[@"items"] && !invalidPolicyResult[@"policyReceipt"];
    }
    PBFPolicyTestAppend(cases, @"mac-policy-invalid-config-no-read", invalidPolicyPass,
                        @"unknown_policy_fields_rejected_before_payload_read");

    reads = 0;
    PBFSourceHintProvider mutatingHint = ^NSString *{
        [pasteboard clearContents];
        NSPasteboardItem *replacement = [[NSPasteboardItem alloc] init];
        [replacement setData:PBFPolicyTestBytes(@"newer-revision") forType:PBFPolicyTestText];
        [pasteboard writeObjects:@[replacement]];
        return PBFTestHint;
    };
    NSDictionary *revisionAtHint = PBFPolicyTestSeed(pasteboard, PBFPolicyTestTextItems()) ?
        PBFPolicyTestRun(pasteboard, limits, PBFPolicyTestPolicy(YES), denyCountingReader, mutatingHint) : @{};
    PBFPolicyTestAppend(cases, @"mac-policy-revision-after-source-query-no-read",
        [revisionAtHint[@"status"] isEqual:@"superseded"] && reads == 0 &&
        !revisionAtHint[@"items"], @"source_query_revision_race_stops_before_payload");

    reads = 0;
    NSDictionary *readerException = PBFPolicyTestSeed(pasteboard, PBFPolicyTestTextItems()) ?
        PBFPolicyTestRun(pasteboard, limits, PBFPolicyTestPolicy(YES), ^NSData *(NSPasteboardItem *item,
            NSPasteboardType nativeName) {
            (void)item; (void)nativeName; reads++;
            @throw [NSException exceptionWithName:@"private-reader-error"
                reason:@"reader-secret-must-not-escape" userInfo:nil];
        }, noHint) : @{};
    NSString *exceptionText = [[readerException description] stringByAppendingString:
        [readerException[@"reasonCode"] description] ?: @""];
    PBFPolicyTestAppend(cases, @"mac-policy-reader-exception-contained",
        [readerException[@"status"] isEqual:@"failed"] && reads == 1 &&
        !readerException[@"items"] && ![exceptionText containsString:@"reader-secret-must-not-escape"],
        @"reader_exception_is_controlled_without_payload_or_error_text");

    reads = 0;
    PBFOrdinaryDataReader replacingReader = ^NSData *(NSPasteboardItem *item,
                                                       NSPasteboardType nativeName) {
        reads++;
        NSData *result = [item dataForType:nativeName];
        [pasteboard clearContents];
        NSPasteboardItem *replacement = [[NSPasteboardItem alloc] init];
        [replacement setData:PBFPolicyTestBytes(@"newer-revision") forType:PBFPolicyTestText];
        [pasteboard writeObjects:@[replacement]];
        return result;
    };
    NSDictionary *revisionDuringRead = PBFPolicyTestSeed(pasteboard, PBFPolicyTestTextItems()) ?
        PBFPolicyTestRun(pasteboard, limits, PBFPolicyTestPolicy(YES), replacingReader, noHint) : @{};
    PBFPolicyTestAppend(cases, @"mac-policy-revision-during-read-superseded",
        [revisionDuringRead[@"status"] isEqual:@"superseded"] && reads == 1 &&
        !revisionDuringRead[@"items"], @"changed_revision_discards_staged_payload");

    reads = 0;
    PBFSourceHintProvider throwingHint = ^NSString *{
        @throw [NSException exceptionWithName:@"private-source-error"
            reason:@"source-secret-must-not-escape" userInfo:nil];
    };
    NSDictionary *hintException = PBFPolicyTestSeed(pasteboard, PBFPolicyTestTextItems()) ?
        PBFPolicyTestRun(pasteboard, limits, excludedPolicy, denyCountingReader, throwingHint) : @{};
    NSString *hintExceptionText = [[hintException description] stringByAppendingString:
        [hintException[@"reasonCode"] description] ?: @""];
    PBFPolicyTestAppend(cases, @"mac-policy-source-query-exception-contained",
        [hintException[@"status"] isEqual:@"policy-denied"] && reads == 0 &&
        [hintException[@"reasonCode"] isEqual:@"source-unknown"] &&
        !hintException[@"items"] && ![hintExceptionText containsString:@"source-secret-must-not-escape"],
        @"source_query_exception_fails_closed_before_payload_read");

    NSArray *remoteMarkerItems = @[@[
        PBFPolicyTestRepresentation(PBFPolicyTestText, @"remote-payload"),
        PBFPolicyTestRepresentation(@"com.apple.is-remote-clipboard", @"")
    ]];
    reads = 0;
    NSDictionary *remoteMarker = PBFPolicyTestSeed(pasteboard, remoteMarkerItems) ?
        PBFPolicyTestRun(pasteboard, limits, PBFPolicyTestPolicy(YES), ^NSData *(NSPasteboardItem *item,
            NSPasteboardType nativeName) { reads++; return [item dataForType:nativeName]; }, noHint) : @{};
    NSDictionary *remoteReceipt = remoteMarker[@"policyReceipt"];
    PBFPolicyTestAppend(cases, @"mac-policy-remote-marker-no-cloud-grant",
        [remoteMarker[@"status"] isEqual:@"ready"] && reads == 1 &&
        [remoteReceipt[@"remoteClipboardMarkerPresent"] boolValue] &&
        ![remoteReceipt[@"producerIdentityVerified"] boolValue] && !remoteReceipt[@"cloudUploadPermitted"],
        @"remote_marker_is_informational_and_does_not_grant_cloud_upload");

    [pasteboard clearContents];
}
