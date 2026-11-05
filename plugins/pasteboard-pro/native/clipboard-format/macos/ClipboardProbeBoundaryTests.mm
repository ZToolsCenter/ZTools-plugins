#import "ClipboardProbe.h"

#import <math.h>

static NSString *const PBFBoundaryUTF8 = NSPasteboardTypeString;
static NSString *const PBFBoundaryUTF16 = @"public.utf16-external-plain-text";
static NSString *const PBFBoundaryHTML = NSPasteboardTypeHTML;
static NSString *const PBFBoundaryRTF = NSPasteboardTypeRTF;
static NSString *const PBFBoundaryPNG = NSPasteboardTypePNG;

static void PBFAddBoundaryCase(NSMutableArray<NSDictionary<NSString *, id> *> *cases,
                              NSString *identifier,
                              BOOL passed) {
    [cases addObject:@{@"id" : identifier,
                       @"status" : passed ? @"pass" : @"fail",
                       @"detailCode" : passed ? @"case-passed" : @"case-failed"}];
}

static NSDictionary<NSString *, id> *PBFBoundaryPlan(NSArray *items, id revision) {
    return @{@"planId" : NSUUID.UUID.UUIDString,
             @"snapshotId" : NSUUID.UUID.UUIDString,
             @"manifestRevision" : NSUUID.UUID.UUIDString,
             @"expectedRevision" : revision,
             @"omittedRepresentationKeys" : @[],
             @"items" : items};
}

static NSArray<NSDictionary<NSString *, id> *> *PBFSingleRepresentation(NSString *nativeName, NSData *data) {
    return @[@{@"representations" : @[@{@"nativeName" : nativeName, @"data" : data}]}];
}

static BOOL PBFNoChangeFailure(NSDictionary *result, NSPasteboard *pasteboard, NSInteger revision) {
    return [result[@"status"] isEqual:@"failed"] &&
           [result[@"clipboardMayHaveChanged"] isEqual:@NO] &&
           pasteboard.changeCount == revision;
}

static BOOL PBFIsInvalidRevisionResult(NSDictionary *result, NSInteger revision) {
    return [result[@"status"] isEqual:@"failed"] &&
           [result[@"reasonCode"] isEqual:@"invalid_expected_revision"] &&
           [result[@"clipboardMayHaveChanged"] isEqual:@NO] &&
           revision >= 0;
}

static NSData *PBFBoundaryPNGFixture(NSArray<NSDictionary<NSString *, id> *> *fixtures) {
    for (NSDictionary *item in fixtures) {
        for (NSDictionary *representation in item[@"representations"] ?: @[]) {
            if ([representation[@"nativeName"] isEqual:PBFBoundaryPNG] &&
                [representation[@"data"] isKindOfClass:NSData.class]) return representation[@"data"];
        }
    }
    return nil;
}

static BOOL PBFCheckRevisionBoundaries(NSPasteboard *pasteboard,
                                       NSDictionary<NSString *, NSNumber *> *limits,
                                       NSMutableArray<NSDictionary<NSString *, id> *> *cases) {
    NSInteger revision = pasteboard.changeCount;
    NSData *text = [@"revision-check" dataUsingEncoding:NSUTF8StringEncoding];
    NSArray *items = PBFSingleRepresentation(PBFBoundaryUTF8, text);
    NSDictionary *booleanPlan = PBFBoundaryPlan(items, @YES);
    NSDictionary *fractionPlan = PBFBoundaryPlan(items, @(revision + 0.5));
    NSDictionary *booleanResult = PBFPublish(pasteboard, booleanPlan, limits);
    NSDictionary *fractionResult = PBFPublish(pasteboard, fractionPlan, limits);
    BOOL booleanRejected = PBFNoChangeFailure(booleanResult, pasteboard, revision) &&
                           [booleanResult[@"reasonCode"] isEqual:@"invalid_expected_revision"];
    BOOL fractionRejected = PBFNoChangeFailure(fractionResult, pasteboard, revision) &&
                            [fractionResult[@"reasonCode"] isEqual:@"invalid_expected_revision"];
    PBFAddBoundaryCase(cases, @"revision-boolean-rejected", booleanRejected);
    PBFAddBoundaryCase(cases, @"revision-fraction-rejected", fractionRejected);

    NSArray *invalidPublishRevisions = @[@(INFINITY), @(NAN), @(9007199254740992ULL), @(-1)];
    BOOL publishRejected = YES;
    for (NSNumber *invalid in invalidPublishRevisions) {
        NSDictionary *result = PBFPublish(pasteboard, PBFBoundaryPlan(items, invalid), limits);
        publishRejected = publishRejected && PBFNoChangeFailure(result, pasteboard, revision) &&
                          [result[@"reasonCode"] isEqual:@"invalid_expected_revision"];
    }
    PBFAddBoundaryCase(cases, @"publish-nonfinite-unsafe-revisions-rejected", publishRejected);

    NSArray *invalidRevisions = @[@YES, @(revision + 0.5), @(INFINITY), @(NAN),
                                  @(9007199254740992ULL), @(-1)];
    BOOL captureRejected = YES;
    for (NSNumber *invalid in invalidRevisions) {
        NSDictionary *result = PBFCapture(pasteboard, limits, invalid);
        captureRejected = captureRejected && PBFIsInvalidRevisionResult(result, revision) &&
                          pasteboard.changeCount == revision;
    }
    PBFAddBoundaryCase(cases, @"capture-invalid-revisions-rejected", captureRejected);
    return booleanRejected && fractionRejected && publishRejected && captureRejected;
}

static BOOL PBFCheckPreMutationFlags(NSPasteboard *pasteboard,
                                     NSDictionary<NSString *, NSNumber *> *limits,
                                     NSMutableArray<NSDictionary<NSString *, id> *> *cases) {
    NSInteger revision = pasteboard.changeCount;
    NSData *text = [@"invalid-plan" dataUsingEncoding:NSUTF8StringEncoding];
    NSArray *validItems = PBFSingleRepresentation(PBFBoundaryUTF8, text);
    NSDictionary *empty = PBFPublish(pasteboard, PBFBoundaryPlan(@[], @(revision)), limits);
    NSDictionary *malformed = PBFPublish(pasteboard, @{@"unexpected" : @YES}, limits);
    NSMutableDictionary *overLimit = [limits mutableCopy];
    overLimit[@"maxTextBytes"] = @(10ULL * 1024ULL * 1024ULL + 1);
    NSDictionary *invalidLimits = PBFPublish(pasteboard,
                                              PBFBoundaryPlan(validItems, @(revision)),
                                              overLimit);
    BOOL passed = PBFNoChangeFailure(empty, pasteboard, revision) &&
                  PBFNoChangeFailure(malformed, pasteboard, revision) &&
                  PBFNoChangeFailure(invalidLimits, pasteboard, revision) &&
                  [invalidLimits[@"reasonCode"] isEqual:@"invalid_plan_or_limits"];
    PBFAddBoundaryCase(cases, @"pre-mutation-failure-has-no-change", passed);
    return passed;
}

static BOOL PBFCheckNativeNameRedaction(NSPasteboard *pasteboard,
                                        NSMutableArray<NSDictionary<NSString *, id> *> *cases) {
    NSString *oversizedName = [@"x" stringByPaddingToLength:513 withString:@"x" startingAtIndex:0];
    NSString *controlName = @"org.ztools.probe.invalid\nformat";
    NSInteger revision = pasteboard.changeCount;
    NSArray *records = @[PBFUnsupportedFormatRecord(0, oversizedName, @"invalid_format_name"),
                         PBFUnsupportedFormatRecord(1, controlName, @"invalid_format_name")];
    NSString *serialized = [[NSString alloc] initWithData:
        [NSJSONSerialization dataWithJSONObject:records options:0 error:nil] encoding:NSUTF8StringEncoding];
    BOOL noOriginalNames = ![serialized containsString:oversizedName] && ![serialized containsString:controlName];
    BOOL passed = [records[0][@"nativeName"] isEqual:@"unknown"] &&
                  [records[1][@"nativeName"] isEqual:@"unknown"] &&
                  [records[0][@"reasonCode"] isEqual:@"invalid_format_name"] &&
                  [records[1][@"reasonCode"] isEqual:@"invalid_format_name"] &&
                  noOriginalNames && pasteboard.changeCount == revision;
    PBFAddBoundaryCase(cases, @"invalid-native-name-redacted", passed);
    return passed;
}

static BOOL PBFCheckTextLimit(NSPasteboard *pasteboard,
                              NSDictionary<NSString *, NSNumber *> *limits,
                              NSArray<NSDictionary<NSString *, id> *> *fixtures,
                              NSMutableArray<NSDictionary<NSString *, id> *> *cases) {
    NSArray<NSString *> *textTypes = @[PBFBoundaryUTF8, PBFBoundaryUTF16, PBFBoundaryHTML, PBFBoundaryRTF];
    NSData *textBytes = [@"0123456789abcdef0123456789abcdef" dataUsingEncoding:NSUTF8StringEncoding];
    NSData *utf16Bytes = [@"0123456789abcdef" dataUsingEncoding:NSUTF16LittleEndianStringEncoding];
    NSData *rtfBytes = [@"{\\rtf1\\ansi 0123456789abcdef0123456789abcdef}" dataUsingEncoding:NSASCIIStringEncoding];
    NSArray<NSData *> *payloads = @[textBytes, utf16Bytes, textBytes, rtfBytes];
    BOOL formatByteLimitsPass = YES;
    for (NSUInteger index = 0; index < textTypes.count; index++) {
        NSData *payload = payloads[index];
        NSMutableDictionary *strict = [limits mutableCopy];
        strict[@"maxFormatBytes"] = @(payload.length - 1);
        NSInteger revision = pasteboard.changeCount;
        NSDictionary *result = PBFPublish(pasteboard,
                                          PBFBoundaryPlan(PBFSingleRepresentation(textTypes[index], payload), @(revision)),
                                          strict);
        formatByteLimitsPass = formatByteLimitsPass && PBFNoChangeFailure(result, pasteboard, revision) &&
                               [result[@"reasonCode"] isEqual:@"invalid_plan_or_limits"];
    }
    for (NSUInteger index = 0; index < textTypes.count; index++) {
        NSData *payload = payloads[index];
        NSInteger beforePublish = pasteboard.changeCount;
        NSDictionary *seed = PBFPublish(pasteboard,
                                         PBFBoundaryPlan(PBFSingleRepresentation(textTypes[index], payload), @(beforePublish)),
                                         limits);
        NSInteger seededRevision = pasteboard.changeCount;
        NSMutableDictionary *strict = [limits mutableCopy];
        strict[@"maxFormatBytes"] = @(payload.length - 1);
        NSDictionary *captured = [seed[@"status"] isEqual:@"committed"] ?
            PBFCapture(pasteboard, strict, @(seededRevision)) : @{};
        formatByteLimitsPass = formatByteLimitsPass && [seed[@"status"] isEqual:@"committed"] &&
                               [captured[@"status"] isEqual:@"over-limit"] &&
                               pasteboard.changeCount == seededRevision;
    }
    PBFAddBoundaryCase(cases, @"text-format-byte-limits", formatByteLimitsPass);

    BOOL publishRejected = YES;
    for (NSUInteger index = 0; index < textTypes.count; index++) {
        NSData *payload = payloads[index];
        NSMutableDictionary *strict = [limits mutableCopy];
        strict[@"maxTextBytes"] = @(payload.length - 1);
        NSInteger revision = pasteboard.changeCount;
        NSDictionary *result = PBFPublish(pasteboard,
                                          PBFBoundaryPlan(PBFSingleRepresentation(textTypes[index], payload), @(revision)),
                                          strict);
        publishRejected = publishRejected && PBFNoChangeFailure(result, pasteboard, revision) &&
                          [result[@"reasonCode"] isEqual:@"invalid_plan_or_limits"];
    }
    PBFAddBoundaryCase(cases, @"text-format-publish-limits", publishRejected);

    BOOL captureRejected = YES;
    for (NSUInteger index = 0; index < textTypes.count; index++) {
        NSData *payload = payloads[index];
        NSInteger beforePublish = pasteboard.changeCount;
        NSDictionary *seed = PBFPublish(pasteboard,
                                         PBFBoundaryPlan(PBFSingleRepresentation(textTypes[index], payload), @(beforePublish)),
                                         limits);
        NSInteger seededRevision = pasteboard.changeCount;
        NSMutableDictionary *strict = [limits mutableCopy];
        strict[@"maxTextBytes"] = @(payload.length - 1);
        NSDictionary *captured = [seed[@"status"] isEqual:@"committed"] ?
            PBFCapture(pasteboard, strict, @(seededRevision)) : @{};
        captureRejected = captureRejected && [seed[@"status"] isEqual:@"committed"] &&
                          [captured[@"status"] isEqual:@"over-limit"] &&
                          pasteboard.changeCount == seededRevision;
    }
    PBFAddBoundaryCase(cases, @"text-format-capture-limits", captureRejected);

    NSData *png = PBFBoundaryPNGFixture(fixtures);
    BOOL pngExcluded = png.length > 1;
    if (pngExcluded) {
        NSMutableDictionary *strict = [limits mutableCopy];
        strict[@"maxTextBytes"] = @(png.length - 1);
        NSInteger revision = pasteboard.changeCount;
        NSDictionary *result = PBFPublish(pasteboard,
                                          PBFBoundaryPlan(PBFSingleRepresentation(PBFBoundaryPNG, png), @(revision)),
                                          strict);
        NSDictionary *captured = [result[@"status"] isEqual:@"committed"] ?
            PBFCapture(pasteboard, strict, result[@"writeRevision"]) : @{};
        pngExcluded = [result[@"status"] isEqual:@"committed"] &&
                      [captured[@"status"] isEqual:@"ready"] &&
                      [captured[@"byteLength"] unsignedLongLongValue] == png.length;
    }
    PBFAddBoundaryCase(cases, @"text-limit-excludes-png", pngExcluded);

    NSMutableDictionary *overHardMax = [limits mutableCopy];
    overHardMax[@"maxTextBytes"] = @(10ULL * 1024ULL * 1024ULL + 1);
    NSInteger revision = pasteboard.changeCount;
    NSDictionary *hardMaxResult = PBFPublish(pasteboard,
                                              PBFBoundaryPlan(PBFSingleRepresentation(PBFBoundaryUTF8, textBytes), @(revision)),
                                              overHardMax);
    BOOL hardMaxRejected = PBFNoChangeFailure(hardMaxResult, pasteboard, revision) &&
                           [hardMaxResult[@"reasonCode"] isEqual:@"invalid_plan_or_limits"];
    PBFAddBoundaryCase(cases, @"text-limit-hard-max", hardMaxRejected);
    return formatByteLimitsPass && publishRejected && captureRejected && pngExcluded && hardMaxRejected;
}

static NSDictionary<NSString *, id> *PBFForcedReadbackFailure(
    NSPasteboard *pasteboard,
    NSDictionary<NSString *, NSNumber *> *limits,
    NSNumber *expectedRevision) {
    (void)pasteboard;
    (void)limits;
    (void)expectedRevision;
    return @{@"status" : @"failed", @"reasonCode" : @"test_readback_unavailable"};
}

static NSDictionary<NSString *, id> *PBFThrowingReadbackProvider(
    NSPasteboard *pasteboard,
    NSDictionary<NSString *, NSNumber *> *limits,
    NSNumber *expectedRevision) {
    (void)pasteboard;
    (void)limits;
    (void)expectedRevision;
    @throw [NSException exceptionWithName:@"PBFTestReadbackFailure" reason:nil userInfo:nil];
}

static BOOL PBFIsUnconfirmedPublication(NSDictionary *result,
                                       NSPasteboard *pasteboard,
                                       NSInteger before) {
    NSArray *planned = result[@"plannedRepresentationKeys"];
    return [result[@"status"] isEqual:@"partial-write"] &&
           [result[@"reasonCode"] isEqual:@"publication-unconfirmed"] &&
           [result[@"clipboardMayHaveChanged"] isEqual:@YES] &&
           [result[@"writtenRepresentationKeys"] isEqual:planned] &&
           [result[@"missingRepresentationKeys"] isEqual:@[]] &&
           [result[@"writeRevision"] integerValue] == pasteboard.changeCount &&
           pasteboard.changeCount != before;
}

static BOOL PBFCheckReadbackFailure(NSPasteboard *pasteboard,
                                    NSDictionary<NSString *, NSNumber *> *limits,
                                    NSMutableArray<NSDictionary<NSString *, id> *> *cases) {
    NSInteger before = pasteboard.changeCount;
    NSData *payload = [@"confirmed-native-write" dataUsingEncoding:NSUTF8StringEncoding];
    NSDictionary *plan = PBFBoundaryPlan(PBFSingleRepresentation(PBFBoundaryUTF8, payload), @(before));
    NSDictionary *result = PBFPublishForTestingWithReadbackProvider(
        pasteboard, plan, limits, PBFForcedReadbackFailure);
    BOOL returnedFailureUnconfirmed = PBFIsUnconfirmedPublication(result, pasteboard, before);
    PBFAddBoundaryCase(cases, @"readback-failure-publication-unconfirmed", returnedFailureUnconfirmed);

    NSInteger exceptionBefore = pasteboard.changeCount;
    NSDictionary *exceptionPlan = PBFBoundaryPlan(
        PBFSingleRepresentation(PBFBoundaryUTF8, [@"exception-after-native-write" dataUsingEncoding:NSUTF8StringEncoding]),
        @(exceptionBefore));
    NSDictionary *exceptionResult = PBFPublishForTestingWithReadbackProvider(
        pasteboard, exceptionPlan, limits, PBFThrowingReadbackProvider);
    BOOL exceptionUnconfirmed = PBFIsUnconfirmedPublication(exceptionResult, pasteboard, exceptionBefore);
    PBFAddBoundaryCase(cases, @"readback-exception-publication-unconfirmed", exceptionUnconfirmed);
    return returnedFailureUnconfirmed && exceptionUnconfirmed;
}

NSDictionary<NSString *, id> *PBFRunBoundaryTests(NSPasteboard *pasteboard,
                                                   NSDictionary<NSString *, NSNumber *> *limits,
                                                   NSArray<NSDictionary<NSString *, id> *> *fixtures,
                                                   NSMutableArray<NSDictionary<NSString *, id> *> *cases) {
    PBFCheckRevisionBoundaries(pasteboard, limits, cases);
    PBFCheckPreMutationFlags(pasteboard, limits, cases);
    PBFCheckNativeNameRedaction(pasteboard, cases);
    PBFCheckTextLimit(pasteboard, limits, fixtures, cases);
    PBFCheckReadbackFailure(pasteboard, limits, cases);
    return PBFRunExtendedFormatTests(pasteboard, limits, cases);
}
