#import "ClipboardProbe.h"
#import "ClipboardCapturePolicyTests.h"
#import "ClipboardCaptureTimingTests.h"
#import "ClipboardRtfFramingTests.h"

#import <CommonCrypto/CommonDigest.h>
#import <sys/utsname.h>

static NSString *const PBFUTF8 = NSPasteboardTypeString;
static NSString *const PBFUTF16 = @"public.utf16-external-plain-text";
static NSString *const PBFHTML = NSPasteboardTypeHTML;
static NSString *const PBFRichText = NSPasteboardTypeRTF;
static NSString *const PBFPNG = NSPasteboardTypePNG;
static NSString *const PBFOpaque = @"org.ztools.pasteboard-pro.g0.opaque-v1";

static NSString *PBFHexDigest(NSData *data) {
    unsigned char digest[CC_SHA256_DIGEST_LENGTH];
    CC_SHA256(data.bytes, (CC_LONG)data.length, digest);
    NSMutableString *hex = [NSMutableString stringWithCapacity:CC_SHA256_DIGEST_LENGTH * 2];
    for (NSUInteger index = 0; index < CC_SHA256_DIGEST_LENGTH; index++) {
        [hex appendFormat:@"%02x", digest[index]];
    }
    return hex;
}

static NSData *PBFPNGFixture(void) {
    NSBitmapImageRep *bitmap = [[NSBitmapImageRep alloc] initWithBitmapDataPlanes:nullptr
                                                                           pixelsWide:2
                                                                           pixelsHigh:2
                                                                        bitsPerSample:8
                                                                      samplesPerPixel:4
                                                                             hasAlpha:YES
                                                                             isPlanar:NO
                                                                       colorSpaceName:NSCalibratedRGBColorSpace
                                                                          bytesPerRow:0
                                                                         bitsPerPixel:0];
    if (!bitmap || !bitmap.bitmapData) return nil;
    const unsigned char rgba[16] = {255, 32, 16, 255, 20, 200, 30, 180,
                                    24, 64, 250, 255, 250, 230, 40, 128};
    memcpy(bitmap.bitmapData, rgba, sizeof(rgba));
    return [bitmap representationUsingType:NSBitmapImageFileTypePNG properties:@{}];
}

static NSArray<NSDictionary<NSString *, id> *> *PBFFixtureItems(void) {
    NSString *nfdText = @"Clipboard 测试 e\u0301 🧪";
    NSString *nfcText = @"Clipboard 测试 é 🧪";
    NSData *nfdPlain = [nfdText dataUsingEncoding:NSUTF8StringEncoding];
    NSData *nfcPlain = [nfcText dataUsingEncoding:NSUTF8StringEncoding];
    NSData *nfdHTML = [[NSString stringWithFormat:@"<html><body><b>%@</b></body></html>", nfdText] dataUsingEncoding:NSUTF8StringEncoding];
    NSData *nfcHTML = [[NSString stringWithFormat:@"<html><body><b>%@</b></body></html>", nfcText] dataUsingEncoding:NSUTF8StringEncoding];
    NSData *nfdRTF = [@"{\\rtf1\\ansi\\uc1 Clipboard \\u27979?\\u35797? e\\u769? \\u-10178?\\u-8726?}" dataUsingEncoding:NSASCIIStringEncoding];
    NSData *nfcRTF = [@"{\\rtf1\\ansi\\uc1 Clipboard \\u27979?\\u35797? \\u233? \\u-10178?\\u-8726?}" dataUsingEncoding:NSASCIIStringEncoding];
    NSData *png = PBFPNGFixture();
    if (!nfdPlain || !nfcPlain || !nfdHTML || !nfcHTML || !nfdRTF || !nfcRTF || !png) return @[];
    return @[
        @{@"representations" : @[
            @{@"nativeName" : PBFUTF8, @"data" : nfdPlain},
            @{@"nativeName" : PBFHTML, @"data" : nfdHTML},
            @{@"nativeName" : PBFRichText, @"data" : nfdRTF}]},
        @{@"representations" : @[
            @{@"nativeName" : PBFPNG, @"data" : png},
            @{@"nativeName" : PBFUTF8, @"data" : nfcPlain},
            @{@"nativeName" : PBFHTML, @"data" : nfcHTML},
            @{@"nativeName" : PBFRichText, @"data" : nfcRTF}]}
    ];
}

static NSMutableDictionary<NSString *, id> *PBFCase(NSString *identifier, BOOL pass, NSString *detail) {
    (void)detail;
    return [@{@"id" : identifier,
              @"status" : pass ? @"pass" : @"fail",
              @"detailCode" : pass ? @"case-passed" : @"case-failed"} mutableCopy];
}

static NSDictionary *PBFRepresentation(NSDictionary *item, NSString *nativeName) {
    for (NSDictionary *representation in item[@"representations"] ?: @[]) {
        if ([representation[@"nativeName"] isEqual:nativeName]) return representation;
    }
    return nil;
}

static BOOL PBFCompatibleUTF16Matches(NSDictionary *expectedItem, NSDictionary *actualRepresentation) {
    NSString *encodingCheck = actualRepresentation[@"encodingCheck"];
    if (![actualRepresentation[@"fidelity"] isEqual:@"compatible"] ||
        ![actualRepresentation[@"derivedFrom"] isEqual:PBFUTF8] ||
        !([encodingCheck isEqual:@"decoded-text-matches"] ||
          [encodingCheck isEqual:@"canonical-unicode-equivalent"])) return NO;
    NSDictionary *expectedUTF8 = PBFRepresentation(expectedItem, PBFUTF8);
    NSData *utf8Data = expectedUTF8[@"data"];
    NSData *utf16Data = actualRepresentation[@"data"];
    if (![utf8Data isKindOfClass:NSData.class] || ![utf16Data isKindOfClass:NSData.class]) return NO;
    NSString *utf8Text = [[NSString alloc] initWithData:utf8Data encoding:NSUTF8StringEncoding];
    NSDictionary *analysis = PBFAnalyzeUTF16Compatibility(utf16Data, utf8Text);
    if (!analysis) return NO;
    for (NSString *key in @[@"encodingCheck", @"byteOrder", @"byteOrderMark", @"nullTerminated"]) {
        if (![analysis[key] isEqual:actualRepresentation[key]]) return NO;
    }
    return YES;
}

static NSString *PBFCompareItems(NSArray *expected,
                                 NSArray *actual,
                                 BOOL allowCompatibleAliases,
                                 NSUInteger *aliasCount) {
    if (aliasCount) *aliasCount = 0;
    if (expected.count != actual.count) {
        return [NSString stringWithFormat:@"item_count:%lu!=%lu", (unsigned long)expected.count, (unsigned long)actual.count];
    }
    for (NSUInteger itemIndex = 0; itemIndex < expected.count; itemIndex++) {
        NSDictionary *expectedItem = expected[itemIndex];
        NSDictionary *actualItem = actual[itemIndex];
        NSArray *expectedReps = expectedItem[@"representations"] ?: @[];
        NSArray *actualReps = actualItem[@"representations"] ?: @[];
        NSMutableSet<NSString *> *expectedNames = [NSMutableSet set];
        for (NSDictionary *expectedRep in expectedReps) {
            NSString *name = expectedRep[@"nativeName"];
            [expectedNames addObject:name];
            NSDictionary *actualRep = PBFRepresentation(actualItem, name);
            if (!actualRep) return [NSString stringWithFormat:@"item_%lu_missing_%@", (unsigned long)itemIndex, name];
            if (![expectedRep[@"data"] isEqual:actualRep[@"data"]]) {
                return [NSString stringWithFormat:@"item_%lu_format_%@_bytes_differ", (unsigned long)itemIndex, name];
            }
        }
        for (NSDictionary *actualRep in actualReps) {
            NSString *name = actualRep[@"nativeName"];
            if ([expectedNames containsObject:name]) continue;
            if (allowCompatibleAliases && [name isEqual:PBFUTF16] && PBFCompatibleUTF16Matches(expectedItem, actualRep)) {
                if (aliasCount) (*aliasCount)++;
                continue;
            }
            return [NSString stringWithFormat:@"item_%lu_unplanned_format_%@", (unsigned long)itemIndex, name ?: @"unknown"];
        }
        if (actualReps.count < expectedReps.count) return [NSString stringWithFormat:@"item_%lu_format_count", (unsigned long)itemIndex];
    }
    return nil;
}

static NSArray<NSDictionary<NSString *, id> *> *PBFDiagnosticItems(NSArray *items) {
    NSMutableArray *itemSummaries = [NSMutableArray arrayWithCapacity:items.count];
    for (NSUInteger itemIndex = 0; itemIndex < items.count; itemIndex++) {
        NSMutableArray *representations = [NSMutableArray array];
        for (NSDictionary *representation in items[itemIndex][@"representations"] ?: @[]) {
            NSData *data = representation[@"data"];
            NSMutableDictionary *summary = [@{@"nativeName" : representation[@"nativeName"] ?: @"unknown",
                                               @"byteLength" : @([data isKindOfClass:NSData.class] ? data.length : 0),
                                               @"sha256" : [data isKindOfClass:NSData.class] ? PBFHexDigest(data) : @""} mutableCopy];
            for (NSString *metadataKey in @[@"formatKind", @"fidelity", @"codec", @"derivedFrom", @"encodingCheck", @"byteOrder", @"byteOrderMark", @"nullTerminated"]) {
                if (representation[metadataKey]) summary[metadataKey] = representation[metadataKey];
            }
            [representations addObject:summary];
        }
        [itemSummaries addObject:@{@"itemIndex" : @(itemIndex), @"representations" : representations}];
    }
    return itemSummaries;
}

static NSDictionary<NSString *, id> *PBFPlan(NSArray *items, NSInteger revision) {
    return @{@"planId" : NSUUID.UUID.UUIDString,
             @"snapshotId" : NSUUID.UUID.UUIDString,
             @"manifestRevision" : NSUUID.UUID.UUIDString,
             @"expectedRevision" : @(revision),
             @"omittedRepresentationKeys" : @[],
             @"items" : items};
}

static NSDictionary<NSString *, id> *PBFFormatSummary(NSArray *planned, NSArray *captured) {
    NSArray *capturedDiagnostics = PBFDiagnosticItems(captured ?: @[]);
    NSMutableArray *aliases = [NSMutableArray array];
    for (NSDictionary *item in capturedDiagnostics) {
        for (NSDictionary *representation in item[@"representations"]) {
            if ([representation[@"fidelity"] isEqual:@"compatible"]) {
                NSMutableDictionary *alias = [representation mutableCopy];
                alias[@"itemIndex"] = item[@"itemIndex"];
                [aliases addObject:alias];
            }
        }
    }
    return @{@"planned" : PBFDiagnosticItems(planned ?: @[]),
             @"captured" : capturedDiagnostics,
             @"compatibleAliases" : aliases};
}


static NSDictionary<NSString *, id> *PBFUTF16CodecFixtureTest(void) {
    NSString *nfd = @"e\u0301 🧪";
    NSString *nfc = @"é 🧪";
    NSData *nfcLittleEndian = [nfc dataUsingEncoding:NSUTF16LittleEndianStringEncoding];
    NSMutableData *withBOM = [NSMutableData dataWithBytes:(const uint8_t[]){0xFF, 0xFE} length:2];
    [withBOM appendData:nfcLittleEndian];
    NSDictionary *canonical = PBFAnalyzeUTF16Compatibility(withBOM, nfd);

    NSString *exactText = @"Dock 🧪";
    NSData *bigEndian = [exactText dataUsingEncoding:NSUTF16BigEndianStringEncoding];
    NSMutableData *terminated = [bigEndian mutableCopy];
    const uint8_t nullTerminator[] = {0x00, 0x00};
    [terminated appendBytes:nullTerminator length:sizeof(nullTerminator)];
    NSDictionary *terminator = PBFAnalyzeUTF16Compatibility(terminated, exactText);
    NSData *malformed = [NSData dataWithBytes:(const uint8_t[]){0x41} length:1];
    NSDictionary *rejected = PBFAnalyzeUTF16Compatibility(malformed, @"A");

    BOOL canonicalPass = [canonical[@"encodingCheck"] isEqual:@"canonical-unicode-equivalent"] &&
                         [canonical[@"byteOrder"] isEqual:@"little-endian"] &&
                         [canonical[@"byteOrderMark"] boolValue] &&
                         ![canonical[@"nullTerminated"] boolValue];
    BOOL terminatorPass = [terminator[@"encodingCheck"] isEqual:@"decoded-text-matches"] &&
                          [terminator[@"byteOrder"] isEqual:@"big-endian"] &&
                          ![terminator[@"byteOrderMark"] boolValue] &&
                          [terminator[@"nullTerminated"] boolValue];
    BOOL malformedPass = rejected == nil;
    NSArray *fixtureSummaries = @[
        @{@"nativeName" : PBFUTF16, @"byteLength" : @(withBOM.length), @"sha256" : PBFHexDigest(withBOM), @"analysis" : canonical ?: @{}},
        @{@"nativeName" : PBFUTF16, @"byteLength" : @(terminated.length), @"sha256" : PBFHexDigest(terminated), @"analysis" : terminator ?: @{}},
        @{@"nativeName" : PBFUTF16, @"byteLength" : @(malformed.length), @"sha256" : PBFHexDigest(malformed), @"analysis" : @{@"rejected" : @(malformedPass)}}
    ];
    return @{@"pass" : @(canonicalPass && terminatorPass && malformedPass),
             @"detail" : @"nfc_nfd_bom_endian_nul_and_malformed_checks",
             @"fixtures" : fixtureSummaries};
}

static NSDictionary<NSString *, id> *PBFRunCases(NSPasteboard *pasteboard,
                                                   NSMutableArray<NSDictionary<NSString *, id> *> *cases) {
    if (PBFIsReservedPasteboardName(pasteboard.name)) {
        [cases addObject:PBFCase(@"isolated-pasteboard", NO, @"reserved_pasteboard_name")];
        return @{};
    }
    NSArray *existingItems = pasteboard.pasteboardItems;
    if (existingItems && existingItems.count != 0) {
        [cases addObject:PBFCase(@"isolated-pasteboard", NO, @"named_pasteboard_not_empty")];
        return @{};
    }
    [cases addObject:PBFCase(@"isolated-pasteboard", YES, existingItems ? @"unique_named_pasteboard_created_empty" : @"unique_named_pasteboard_empty_items_nil")];

    NSDictionary *limits = PBFDefaultLimits();
    NSArray *fixtures = PBFFixtureItems();
    if (fixtures.count != 2) {
        [cases addObject:PBFCase(@"fixture-build", NO, @"synthetic_formats_unavailable")];
        return @{};
    }
    [cases addObject:PBFCase(@"fixture-build", YES, @"two_items_nfc_nfd_html_rtf_png")];
    NSInteger initialRevision = pasteboard.changeCount;

    NSDictionary *emptyCapture = PBFCapture(pasteboard, limits, @(initialRevision));
    BOOL emptyCaptureSafe = [emptyCapture[@"status"] isEqual:@"failed"] && [emptyCapture[@"reasonCode"] isEqual:@"no_items"] && pasteboard.changeCount == initialRevision;
    [cases addObject:PBFCase(@"empty-capture-safe", emptyCaptureSafe, emptyCaptureSafe ? @"empty_items_read_without_mutation" : @"empty_pasteboard_state_changed")];

    BOOL reservedGuard = PBFIsReservedPasteboardName(NSPasteboardNameGeneral) &&
                         PBFIsReservedPasteboardName(NSPasteboardNameFont) &&
                         PBFIsReservedPasteboardName(NSPasteboardNameRuler) &&
                         PBFIsReservedPasteboardName(NSPasteboardNameFind) &&
                         PBFIsReservedPasteboardName(NSPasteboardNameDrag) &&
                         !PBFIsReservedPasteboardName(pasteboard.name);
    [cases addObject:PBFCase(@"reserved-name-guard", reservedGuard, reservedGuard ? @"system_names_rejected_without_opening_them" : @"reserved_name_check_failed")];

    NSDictionary *nilCapture = PBFCapture(nil, limits, nil);
    NSDictionary *nilPublish = PBFPublish(nil, PBFPlan(fixtures, initialRevision), limits);
    BOOL nilRejected = [nilCapture[@"status"] isEqual:@"failed"] &&
                       [nilCapture[@"reasonCode"] isEqual:@"pasteboard_unavailable"] &&
                       [nilPublish[@"status"] isEqual:@"failed"] &&
                       [nilPublish[@"reasonCode"] isEqual:@"pasteboard_unavailable"] &&
                       pasteboard.changeCount == initialRevision;
    [cases addObject:PBFCase(@"nil-pasteboard-rejected", nilRejected, nilRejected ? @"nil_object_not_treated_as_empty_board" : @"nil_pasteboard_not_rejected")];

    NSDictionary *emptyPlanResult = PBFPublish(pasteboard, PBFPlan(@[], initialRevision), limits);
    BOOL emptySafe = [emptyPlanResult[@"status"] isEqual:@"failed"] && pasteboard.changeCount == initialRevision;
    [cases addObject:PBFCase(@"empty-plan-safe", emptySafe, emptySafe ? @"rejected_before_clear" : @"clipboard_state_changed")];

    NSMutableArray *badItems = [fixtures mutableCopy];
    badItems[0] = @{@"representations" : @[@{@"nativeName" : @"", @"data" : [NSData dataWithBytes:"x" length:1]}]};
    NSDictionary *badResult = PBFPublish(pasteboard, PBFPlan(badItems, initialRevision), limits);
    NSDictionary *malformedResult = PBFPublish(pasteboard, @{@"unexpected" : @YES}, limits);
    BOOL malformedSafe = [badResult[@"status"] isEqual:@"failed"] &&
                         [malformedResult[@"status"] isEqual:@"failed"] &&
                         pasteboard.changeCount == initialRevision;
    [cases addObject:PBFCase(@"malformed-plan-safe", malformedSafe, malformedSafe ? @"malformed_requests_rejected_before_clear" : @"malformed_request_mutated_board")];

    NSMutableDictionary *formatLimits = [limits mutableCopy];
    formatLimits[@"maxFormatsPerItem"] = @2;
    NSDictionary *formatLimitResult = PBFPublish(pasteboard, PBFPlan(fixtures, initialRevision), formatLimits);
    BOOL formatSafe = [formatLimitResult[@"status"] isEqual:@"failed"] && pasteboard.changeCount == initialRevision;
    [cases addObject:PBFCase(@"format-limit-safe", formatSafe, formatSafe ? @"rejected_before_clear" : @"format_limit_not_enforced")];

    NSMutableDictionary *byteLimits = [limits mutableCopy];
    byteLimits[@"maxFormatBytes"] = @2;
    NSDictionary *byteLimitResult = PBFPublish(pasteboard, PBFPlan(fixtures, initialRevision), byteLimits);
    BOOL byteSafe = [byteLimitResult[@"status"] isEqual:@"failed"] && pasteboard.changeCount == initialRevision;
    [cases addObject:PBFCase(@"format-byte-limit-safe", byteSafe, byteSafe ? @"rejected_before_clear" : @"format_byte_limit_not_enforced")];

    NSMutableDictionary *unsafeLimits = [limits mutableCopy];
    unsafeLimits[@"maxItems"] = @(9007199254740992ULL);
    NSDictionary *unsafeLimitResult = PBFCapture(pasteboard, unsafeLimits, @(initialRevision));
    BOOL unsafeLimitSafe = [unsafeLimitResult[@"status"] isEqual:@"failed"] &&
                           [unsafeLimitResult[@"reasonCode"] isEqual:@"invalid_limits"] &&
                           pasteboard.changeCount == initialRevision;
    [cases addObject:PBFCase(@"unsafe-limit-rejected", unsafeLimitSafe, unsafeLimitSafe ? @"unsafe_integer_rejected" : @"unsafe_integer_limit_accepted")];

    NSDictionary *plan = PBFPlan(fixtures, initialRevision);
    NSDictionary *published = PBFPublish(pasteboard, plan, limits);
    BOOL committed = [published[@"status"] isEqual:@"committed"] &&
                     [published[@"writtenRepresentationKeys"] count] == 7 &&
                     [published[@"plannedRepresentationKeys"] count] == 7 &&
                     [published[@"writeRevision"] isKindOfClass:NSNumber.class];
    [cases addObject:PBFCase(@"write-two-items", committed, committed ? @"seven_planned_representations_written_once" : @"publish_incomplete")];
    if (!committed) return PBFFormatSummary(fixtures, @[]);

    NSInteger writeRevision = [published[@"writeRevision"] integerValue];
    NSDictionary *captured = PBFCapture(pasteboard, limits, @(writeRevision));
    NSUInteger aliasCount = 0;
    NSString *roundTripMismatch = PBFCompareItems(fixtures, captured[@"items"] ?: @[], YES, &aliasCount);
    BOOL roundTrip = [captured[@"status"] isEqual:@"ready"] && roundTripMismatch == nil;
    NSString *roundTripDetail = roundTrip ?
        [NSString stringWithFormat:@"source_bytes_and_item_order_match;compatible_aliases_%lu", (unsigned long)aliasCount] :
        [NSString stringWithFormat:@"capture_status_%@;unsupported_%lu;%@", captured[@"status"] ?: @"missing", (unsigned long)[captured[@"unsupported"] count], roundTripMismatch ?: @"unknown"];
    [cases addObject:PBFCase(@"capture-roundtrip", roundTrip, roundTripDetail)];
    [cases addObject:PBFCase(@"compatible-utf16-alias", roundTrip, aliasCount > 0 ? @"utf16_bytes_captured_and_unicode_verified" : @"runtime_exposed_no_extra_utf16_alias")];
    if (!roundTrip) return PBFFormatSummary(fixtures, captured[@"items"] ?: @[]);

    NSDictionary *staleResult = PBFPublish(pasteboard, PBFPlan(fixtures, writeRevision + 1), limits);
    BOOL staleSafe = [staleResult[@"status"] isEqual:@"superseded"] && pasteboard.changeCount == writeRevision;
    [cases addObject:PBFCase(@"stale-revision-rejected", staleSafe, staleSafe ? @"clipboard_unchanged" : @"stale_write_was_not_rejected")];

    NSMutableDictionary *captureLimits = [limits mutableCopy];
    captureLimits[@"maxFormatBytes"] = @2;
    NSDictionary *captureLimitResult = PBFCapture(pasteboard, captureLimits, @(writeRevision));
    BOOL captureLimitSafe = [captureLimitResult[@"status"] isEqual:@"over-limit"] && pasteboard.changeCount == writeRevision;
    [cases addObject:PBFCase(@"capture-byte-limit", captureLimitSafe, captureLimitSafe ? @"rejected_without_mutation" : @"capture_limit_not_enforced")];

    NSDictionary *replayed = PBFPublish(pasteboard, PBFPlan(captured[@"items"], writeRevision), limits);
    NSDictionary *afterReplay = [replayed[@"status"] isEqual:@"committed"] ? PBFCapture(pasteboard, limits, replayed[@"writeRevision"]) : @{};
    NSString *replayMismatch = PBFCompareItems(captured[@"items"] ?: @[], afterReplay[@"items"] ?: @[], YES, NULL);
    BOOL replayPass = [replayed[@"status"] isEqual:@"committed"] &&
                       [replayed[@"writtenRepresentationKeys"] count] == [published[@"plannedRepresentationKeys"] count] + aliasCount &&
                       [afterReplay[@"status"] isEqual:@"ready"] && replayMismatch == nil;
    NSString *replayDetail = replayPass ? @"captured_raw_formats_republished_and_reloaded" : (replayMismatch ?: @"replay_status_or_written_count_mismatch");
    [cases addObject:PBFCase(@"republish", replayPass, replayDetail)];

    const uint8_t opaqueBytes[] = {0x00, 0xFF, 0x7F, 0x10, 0x42};
    NSData *opaque = [NSData dataWithBytes:opaqueBytes length:sizeof(opaqueBytes)];
    NSInteger beforeUnsupportedSeed = pasteboard.changeCount;
    NSDictionary *unsupportedPlan = PBFPlan(@[@{@"representations" : @[@{@"nativeName" : PBFOpaque, @"data" : opaque}]}], beforeUnsupportedSeed);
    NSDictionary *unsupportedPublish = PBFPublish(pasteboard, unsupportedPlan, limits);
    BOOL unsupportedPublishSafe = [unsupportedPublish[@"status"] isEqual:@"failed"] && pasteboard.changeCount == beforeUnsupportedSeed;
    NSPasteboardItem *unsupportedItem = [[NSPasteboardItem alloc] init];
    BOOL unsupportedItemPrepared = [unsupportedItem setData:opaque forType:PBFOpaque];
    [pasteboard clearContents];
    BOOL unsupportedItemWritten = unsupportedItemPrepared && [pasteboard writeObjects:@[unsupportedItem]];
    NSInteger unsupportedRevision = pasteboard.changeCount;
    NSDictionary *unsupportedCapture = PBFCapture(pasteboard, limits, @(unsupportedRevision));
    NSArray *unsupportedRecords = unsupportedCapture[@"unsupported"];
    NSDictionary *partialRepublish = PBFPublish(pasteboard, PBFPlan(unsupportedCapture[@"items"] ?: @[], unsupportedRevision), limits);
    BOOL unsupportedPartialSafe = unsupportedItemWritten &&
                                  [unsupportedCapture[@"status"] isEqual:@"partial"] &&
                                  unsupportedRecords.count == 1 &&
                                  [unsupportedRecords[0][@"nativeName"] isEqual:PBFOpaque] &&
                                  [unsupportedRecords[0][@"reasonCode"] isEqual:@"unsupported_format_not_materialized"] &&
                                  [unsupportedCapture[@"items"] count] == 1 &&
                                  [unsupportedCapture[@"items"][0][@"representations"] count] == 0 &&
                                  [partialRepublish[@"status"] isEqual:@"failed"] &&
                                  [unsupportedPublish[@"status"] isEqual:@"failed"] &&
                                  pasteboard.changeCount == unsupportedRevision;
    [cases addObject:PBFCase(@"unsupported-format-partial", unsupportedPartialSafe && unsupportedPublishSafe,
                              unsupportedPartialSafe && unsupportedPublishSafe ?
                              @"unknown_type_listed_without_materialization_or_replay" : @"unknown_type_boundary_failed")];

    NSData *singlePNG = PBFPNGFixture();
    NSArray *singleItem = @[@{@"representations" : @[@{@"nativeName" : PBFPNG, @"data" : singlePNG}]}];
    NSInteger beforeSingleWrite = pasteboard.changeCount;
    NSDictionary *singleSeed = PBFPublish(pasteboard, PBFPlan(singleItem, beforeSingleWrite), limits);
    BOOL singleSeeded = [singleSeed[@"status"] isEqual:@"committed"];
    [cases addObject:PBFCase(@"single-format-seed", singleSeeded, singleSeeded ? @"one_png_representation_ready_for_byte_cap_check" : @"single_png_seed_failed")];
    if (singleSeeded) {
        NSInteger singleRevision = [singleSeed[@"writeRevision"] integerValue];
        NSMutableDictionary *singleLimits = [limits mutableCopy];
        singleLimits[@"maxFormatBytes"] = @(MAX(singlePNG.length, (NSUInteger)16));
        singleLimits[@"maxSnapshotBytes"] = @2;
        NSDictionary *singleCapture = PBFCapture(pasteboard, singleLimits, @(singleRevision));
        BOOL singleCaptureCapped = [singleCapture[@"status"] isEqual:@"over-limit"] && pasteboard.changeCount == singleRevision;
        [cases addObject:PBFCase(@"single-format-capture-snapshot-limit", singleCaptureCapped, singleCaptureCapped ? @"one_payload_larger_than_snapshot_rejected" : @"single_payload_snapshot_cap_failed")];
        NSDictionary *singlePublish = PBFPublish(pasteboard, PBFPlan(singleItem, singleRevision), singleLimits);
        BOOL singlePublishSafe = [singlePublish[@"status"] isEqual:@"failed"] && pasteboard.changeCount == singleRevision;
        [cases addObject:PBFCase(@"single-format-publish-snapshot-limit", singlePublishSafe, singlePublishSafe ? @"single_payload_rejected_before_clear" : @"single_payload_snapshot_cap_mutated_board")];
    }

    PBFRunCapturePolicyTests(pasteboard, limits, cases);
    PBFRunCaptureTimingTests(pasteboard, limits, cases);
    PBFRunRtfFramingTests(pasteboard, limits, cases);
    NSDictionary *additionalSummary = PBFRunBoundaryTests(pasteboard, limits, fixtures, cases);
    NSMutableDictionary *combinedSummary = [PBFFormatSummary(fixtures, captured[@"items"] ?: @[]) mutableCopy];
    for (NSString *key in @[@"planned", @"captured", @"compatibleAliases"]) {
        NSMutableArray *values = [combinedSummary[key] mutableCopy] ?: [NSMutableArray array];
        [values addObjectsFromArray:additionalSummary[key] ?: @[]];
        combinedSummary[key] = values;
    }
    return combinedSummary;
}

NSDictionary<NSString *, id> *PBFSelfTest(void) {
    NSMutableArray<NSDictionary<NSString *, id> *> *cases = [NSMutableArray array];
    NSDictionary<NSString *, id> *formatSummary = @{@"planned" : @[], @"captured" : @[], @"compatibleAliases" : @[]};
    NSDictionary *codecFixtureResult = PBFUTF16CodecFixtureTest();
    [cases addObject:PBFCase(@"utf16-codec-fixtures", [codecFixtureResult[@"pass"] boolValue], codecFixtureResult[@"detail"] ?: @"codec_check_failed")];
    NSString *name = [NSString stringWithFormat:@"org.ztools.pasteboard-pro.g0.%@", NSUUID.UUID.UUIDString];
    if (PBFIsReservedPasteboardName(name)) {
        [cases addObject:PBFCase(@"isolated-pasteboard", NO, @"generated_name_was_reserved")];
    } else {
        @autoreleasepool {
            NSPasteboard *pasteboard = [NSPasteboard pasteboardWithName:name];
            if (!pasteboard) {
                [cases addObject:PBFCase(@"isolated-pasteboard", NO, @"named_pasteboard_unavailable")];
            } else {
                @try {
                    formatSummary = PBFRunCases(pasteboard, cases);
                } @finally {
                    [pasteboard releaseGlobally];
                }
            }
        }
    }

    NSMutableDictionary *reportFormatSummary = [formatSummary mutableCopy];
    reportFormatSummary[@"codecFixtures"] = codecFixtureResult[@"fixtures"] ?: @[];
    struct utsname machine;
    NSString *architecture = uname(&machine) == 0 ? [NSString stringWithUTF8String:machine.machine] : @"unknown";
    BOOL success = cases.count > 0;
    for (NSDictionary *entry in cases) success = success && [entry[@"status"] isEqual:@"pass"];
    NSString *osVersion = NSProcessInfo.processInfo.operatingSystemVersionString ?: @"unknown";
    return @{@"schemaVersion" : @1,
             @"platform" : @"darwin",
             @"scope" : @"isolated-named-pasteboard",
             @"success" : @(success),
             @"cases" : cases,
             @"environment" : @{@"osVersion" : osVersion,
                                  @"architecture" : architecture ?: @"unknown"},
             @"formatSummary" : reportFormatSummary,
             @"unverified" : @[@"general-clipboard-monitoring",
                               @"delayed-source-rendering",
                               @"target-application-paste",
                               @"signed-host-integration",
                               @"os-atomic-commit",
                               @"jpeg-tiff-codecs",
                               @"file-reference-codecs",
                               @"url-color-codecs",
                               @"table-application-fidelity",
                               @"native-read-timeout",
                               @"partial-write-fault-injection",
                               @"rss-watchdog",
                               @"legacy-nsfilenames-file-lists",
                               @"legacy-color-pasteboard-codec",
                               @"file-operation-cut-move-semantics",
                               @"image-decoder-stress"]};
}
