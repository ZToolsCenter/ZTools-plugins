#import "ClipboardCaptureTimingTests.h"

#import "ClipboardProbe.h"
#import "ClipboardCapturePolicy.h"
#import "ClipboardCaptureTimingPublishTests.h"
#import "ClipboardFormatCodecs.h"

static NSString *const PBFPrivateBoardPrefix = @"org.ztools.pasteboard-pro.g0.";

@interface PBFOversizedTimingData : NSData
@property(nonatomic, assign) NSUInteger reportedLength, copyCount;
@end
@implementation PBFOversizedTimingData
- (NSUInteger)length { return self.reportedLength; }
- (const void *)bytes { static const uint8_t sentinel = 0; return &sentinel; }
- (id)copyWithZone:(NSZone *)zone { (void)zone; self.copyCount++; return self; }
@end

static NSDictionary<NSString *, id> *PBFTimingCase(NSString *identifier, BOOL passed) {
    return @{@"id" : identifier,
             @"status" : passed ? @"pass" : @"fail",
             @"detailCode" : passed ? @"case-passed" : @"case-failed"};
}

static void PBFAppendTimingCase(NSMutableArray<NSDictionary<NSString *, id> *> *cases,
                               NSString *identifier,
                               BOOL passed) {
    [cases addObject:PBFTimingCase(identifier, passed)];
}

static NSDictionary<NSString *, id> *PBFTestPolicy(void) {
    NSMutableDictionary *policy = [PBFDefaultCapturePolicy() mutableCopy];
    policy[@"allowUnknownSource"] = @YES;
    return PBFNormalizeCapturePolicy(policy);
}

static PBFSourceHintProvider PBFNoSourceHint(void) {
    return ^NSString *{
        return nil;
    };
}

static BOOL PBFSeedItems(NSPasteboard *pasteboard,
                         NSArray<NSArray<NSDictionary<NSString *, id> *> *> *items) {
    [pasteboard clearContents];
    NSMutableArray<NSPasteboardItem *> *nativeItems = [NSMutableArray arrayWithCapacity:items.count];
    for (NSArray<NSDictionary<NSString *, id> *> *representations in items) {
        NSPasteboardItem *nativeItem = [[NSPasteboardItem alloc] init];
        for (NSDictionary<NSString *, id> *representation in representations) {
            NSString *nativeName = representation[@"nativeName"];
            NSData *data = representation[@"data"];
            if (![nativeName isKindOfClass:NSString.class] ||
                ![data isKindOfClass:NSData.class] ||
                ![nativeItem setData:data forType:nativeName]) {
                return NO;
            }
        }
        [nativeItems addObject:nativeItem];
    }
    return nativeItems.count == items.count &&
        nativeItems.count > 0 &&
        [pasteboard writeObjects:nativeItems] &&
        pasteboard.pasteboardItems.count == nativeItems.count;
}

static NSUInteger PBFExpectedCandidateReads(NSPasteboard *pasteboard) {
    NSUInteger count = 0;
    for (NSPasteboardItem *item in pasteboard.pasteboardItems ?: @[]) {
        for (id rawName in item.types) {
            if (![rawName isKindOfClass:NSString.class]) continue;
            NSString *nativeName = rawName;
            if (PBFCodecSupportsNativeName(nativeName) &&
                !PBFIsCapturePolicyMetadataType(nativeName)) {
                count++;
            }
        }
    }
    return count;
}

static NSData *PBFRepresentationAt(NSDictionary<NSString *, id> *capture,
                                   NSUInteger itemIndex,
                                   NSString *nativeName) {
    NSArray *items = capture[@"items"];
    if (![items isKindOfClass:NSArray.class] || itemIndex >= items.count) return nil;
    NSArray *representations = items[itemIndex][@"representations"];
    if (![representations isKindOfClass:NSArray.class]) return nil;
    for (NSDictionary *representation in representations) {
        if ([representation[@"nativeName"] isEqual:nativeName] &&
            [representation[@"data"] isKindOfClass:NSData.class]) {
            return representation[@"data"];
        }
    }
    return nil;
}

static BOOL PBFBoardHasData(NSPasteboard *pasteboard,
                            NSString *nativeName,
                            NSData *expected) {
    NSPasteboardItem *item = pasteboard.pasteboardItems.firstObject;
    NSData *actual = [item dataForType:nativeName];
    return [actual isKindOfClass:NSData.class] && [actual isEqual:expected];
}

static BOOL PBFHasNoMaterializedPayload(NSDictionary<NSString *, id> *result) {
    return !result[@"items"] && !result[@"summary"] &&
        !result[@"unsupported"] && !result[@"byteLength"];
}

static BOOL PBFPrivateUUIDBoard(NSPasteboard *pasteboard) {
    if (![pasteboard isKindOfClass:NSPasteboard.class] ||
        PBFIsReservedPasteboardName(pasteboard.name) ||
        ![pasteboard.name hasPrefix:PBFPrivateBoardPrefix]) {
        return NO;
    }
    NSString *uuidText = [pasteboard.name substringFromIndex:PBFPrivateBoardPrefix.length];
    return [[NSUUID alloc] initWithUUIDString:uuidText] != nil;
}

static void PBFAppendPrivateBoardFailures(
    NSMutableArray<NSDictionary<NSString *, id> *> *cases) {
    for (NSString *identifier in @[
        @"mac-capture-offline-validation-preserves-revision",
        @"mac-capture-materialization-before-validation",
        @"mac-capture-read-race-discards-owned-bytes",
        @"mac-capture-invalid-owned-bytes-budgeted",
        @"mac-capture-owned-validation-partial",
        @"mac-capture-validator-exception-contained",
        @"mac-publish-offline-readback-race-unconfirmed"
    ]) {
        PBFAppendTimingCase(cases, identifier, NO);
    }
}

static BOOL PBFCaptureOfflineValidationPreservesRevision(
    NSPasteboard *pasteboard,
    NSDictionary<NSString *, NSNumber *> *limits) {
    NSData *first = [@"timing-original-first" dataUsingEncoding:NSUTF8StringEncoding];
    NSData *second = [@"timing-original-second" dataUsingEncoding:NSUTF8StringEncoding];
    NSData *replacement = [@"timing-validator-replacement" dataUsingEncoding:NSUTF8StringEncoding];
    BOOL seeded = PBFSeedItems(pasteboard, @[
        @[@{@"nativeName" : PBFFormatUTF8Text, @"data" : first}],
        @[@{@"nativeName" : PBFFormatUTF8Text, @"data" : second}]
    ]);
    NSInteger capturedRevision = pasteboard.changeCount;
    NSUInteger expectedReads = PBFExpectedCandidateReads(pasteboard);
    __block NSUInteger readCount = 0;
    __block NSUInteger validationCount = 0;
    __block BOOL mutationAttempted = NO;
    __block BOOL mutationSucceeded = NO;
    __block BOOL allReadsOwnedBeforeValidation = YES;

    PBFRepresentationValidator validator = ^BOOL(NSString *nativeName, NSData *data) {
        validationCount++;
        if (readCount != expectedReads) allReadsOwnedBeforeValidation = NO;
        if (!mutationAttempted) {
            mutationAttempted = YES;
            mutationSucceeded = PBFSeedItems(pasteboard, @[
                @[@{@"nativeName" : PBFFormatUTF8Text, @"data" : replacement}]
            ]);
        }
        return PBFCodecValidateRepresentation(nativeName, data);
    };
    NSDictionary *result = seeded ? PBFCaptureForTestingWithProviders(
        pasteboard, limits, @(capturedRevision), PBFTestPolicy(),
        ^NSData *(NSPasteboardItem *item, NSPasteboardType nativeName) {
            readCount++;
            return [[item dataForType:nativeName] copy];
        }, PBFNoSourceHint(), validator) : @{};

    NSInteger observedRevision = pasteboard.changeCount;
    BOOL oldBytesRetained =
        [PBFRepresentationAt(result, 0, PBFFormatUTF8Text) isEqual:first] &&
        [PBFRepresentationAt(result, 1, PBFFormatUTF8Text) isEqual:second];
    return seeded && expectedReads >= 2 && readCount == expectedReads &&
        validationCount == expectedReads && allReadsOwnedBeforeValidation &&
        mutationAttempted && mutationSucceeded &&
        [result[@"status"] isEqual:@"ready"] &&
        [result[@"revision"] integerValue] == capturedRevision &&
        [result[@"observedRevision"] integerValue] == observedRevision &&
        observedRevision != capturedRevision && oldBytesRetained &&
        PBFBoardHasData(pasteboard, PBFFormatUTF8Text, replacement);
}

static BOOL PBFCaptureMaterializesBeforeValidation(
    NSPasteboard *pasteboard,
    NSDictionary<NSString *, NSNumber *> *limits) {
    NSData *first = [@"materialized-first" dataUsingEncoding:NSUTF8StringEncoding];
    NSData *second = [@"materialized-second" dataUsingEncoding:NSUTF8StringEncoding];
    BOOL seeded = PBFSeedItems(pasteboard, @[
        @[@{@"nativeName" : PBFFormatUTF8Text, @"data" : first}],
        @[@{@"nativeName" : PBFFormatUTF8Text, @"data" : second}]
    ]);
    NSInteger revision = pasteboard.changeCount;
    NSUInteger expectedReads = PBFExpectedCandidateReads(pasteboard);
    __block NSUInteger readCount = 0;
    __block NSUInteger validationCount = 0;
    __block BOOL validationStartedAfterAllReads = YES;
    PBFRepresentationValidator validator = ^BOOL(NSString *nativeName, NSData *data) {
        validationCount++;
        if (readCount != expectedReads) validationStartedAfterAllReads = NO;
        return PBFCodecValidateRepresentation(nativeName, data);
    };
    NSDictionary *result = seeded ? PBFCaptureForTestingWithProviders(
        pasteboard, limits, @(revision), PBFTestPolicy(),
        ^NSData *(NSPasteboardItem *item, NSPasteboardType nativeName) {
            readCount++;
            return [[item dataForType:nativeName] copy];
        }, PBFNoSourceHint(), validator) : @{};

    return seeded && expectedReads >= 2 && readCount == expectedReads &&
        validationCount == expectedReads && validationStartedAfterAllReads &&
        [result[@"status"] isEqual:@"ready"] &&
        [result[@"revision"] integerValue] == revision &&
        [result[@"observedRevision"] integerValue] == revision;
}

static BOOL PBFCaptureReadRaceDiscardsOwnedBytes(
    NSPasteboard *pasteboard,
    NSDictionary<NSString *, NSNumber *> *limits) {
    NSData *original = [@"read-race-original" dataUsingEncoding:NSUTF8StringEncoding];
    NSData *replacement = [@"read-race-replacement" dataUsingEncoding:NSUTF8StringEncoding];
    BOOL seeded = PBFSeedItems(pasteboard, @[
        @[@{@"nativeName" : PBFFormatUTF8Text, @"data" : original}]
    ]);
    NSInteger revision = pasteboard.changeCount;
    __block NSUInteger readCount = 0;
    __block NSUInteger validationCount = 0;
    __block BOOL mutationSucceeded = NO;
    PBFRepresentationValidator validator = ^BOOL(NSString *nativeName, NSData *data) {
        (void)nativeName;
        (void)data;
        validationCount++;
        return YES;
    };
    NSDictionary *result = seeded ? PBFCaptureForTestingWithProviders(
        pasteboard, limits, @(revision), PBFTestPolicy(),
        ^NSData *(NSPasteboardItem *item, NSPasteboardType nativeName) {
            NSData *owned = [[item dataForType:nativeName] copy];
            readCount++;
            mutationSucceeded = PBFSeedItems(pasteboard, @[
                @[@{@"nativeName" : PBFFormatUTF8Text, @"data" : replacement}]
            ]);
            return owned;
        }, PBFNoSourceHint(), validator) : @{};

    return seeded && readCount == 1 && mutationSucceeded && validationCount == 0 &&
        [result[@"status"] isEqual:@"superseded"] &&
        PBFHasNoMaterializedPayload(result) &&
        [pasteboard changeCount] != revision &&
        PBFBoardHasData(pasteboard, PBFFormatUTF8Text, replacement);
}

static BOOL PBFCaptureInvalidBytesCountAgainstBudget(
    NSPasteboard *pasteboard,
    NSDictionary<NSString *, NSNumber *> *limits) {
    const uint8_t invalidPNGBytes[] = {
        0x00, 0x11, 0x22, 0x33, 0x44, 0x55, 0x66, 0x77,
        0x88, 0x99, 0xAA, 0xBB, 0xCC, 0xDD, 0xEE, 0xFF
    };
    NSData *invalidPNG = [NSData dataWithBytes:invalidPNGBytes length:sizeof(invalidPNGBytes)];
    BOOL seeded = PBFSeedItems(pasteboard, @[
        @[@{@"nativeName" : PBFFormatPNG, @"data" : invalidPNG}],
        @[@{@"nativeName" : PBFFormatPNG, @"data" : invalidPNG}]
    ]);
    NSInteger revision = pasteboard.changeCount;
    NSUInteger expectedReads = PBFExpectedCandidateReads(pasteboard);
    NSMutableDictionary *smallSnapshot = [limits mutableCopy];
    smallSnapshot[@"maxSnapshotBytes"] = @24;
    __block NSUInteger readCount = 0;
    __block NSUInteger validationCount = 0;
    PBFRepresentationValidator validator = ^BOOL(NSString *nativeName, NSData *data) {
        (void)nativeName;
        (void)data;
        validationCount++;
        return NO;
    };
    NSDictionary *result = seeded ? PBFCaptureForTestingWithProviders(
        pasteboard, smallSnapshot, @(revision), PBFTestPolicy(),
        ^NSData *(NSPasteboardItem *item, NSPasteboardType nativeName) {
            readCount++;
            return [[item dataForType:nativeName] copy];
        }, PBFNoSourceHint(), validator) : @{};

    PBFOversizedTimingData *oversized = [[PBFOversizedTimingData alloc] init];
    oversized.reportedLength = 25;
    __block NSUInteger oversizedReads = 0;
    __block NSUInteger oversizedValidations = 0;
    NSDictionary *copyGuardResult = seeded ? PBFCaptureForTestingWithProviders(
        pasteboard, smallSnapshot, @(revision), PBFTestPolicy(),
        ^NSData *(NSPasteboardItem *item, NSPasteboardType nativeName) {
            (void)item;
            (void)nativeName;
            oversizedReads++;
            return oversized;
        }, PBFNoSourceHint(), ^BOOL(NSString *nativeName, NSData *data) {
            (void)nativeName;
            (void)data;
            oversizedValidations++;
            return NO;
        }) : @{};
    BOOL oversizedRejectedBeforeCopy =
        [copyGuardResult[@"status"] isEqual:@"over-limit"] &&
        [copyGuardResult[@"reasonCode"] isEqual:@"payload_limit_exceeded"] &&
        PBFHasNoMaterializedPayload(copyGuardResult) &&
        oversizedReads == 1 && oversized.copyCount == 0 &&
        oversizedValidations == 0 && pasteboard.changeCount == revision;
    return seeded && expectedReads == 2 && readCount == 2 && validationCount == 0 &&
        [result[@"status"] isEqual:@"over-limit"] &&
        [result[@"reasonCode"] isEqual:@"payload_limit_exceeded"] &&
        PBFHasNoMaterializedPayload(result) && pasteboard.changeCount == revision &&
        oversizedRejectedBeforeCopy;
}

static BOOL PBFCaptureOwnedValidationCanBePartial(
    NSPasteboard *pasteboard,
    NSDictionary<NSString *, NSNumber *> *limits) {
    NSData *text = [@"valid-owned-representation" dataUsingEncoding:NSUTF8StringEncoding];
    const uint8_t invalidPNGBytes[] = {0x01, 0x02, 0x03, 0x04, 0x05, 0x06};
    NSData *invalidPNG = [NSData dataWithBytes:invalidPNGBytes length:sizeof(invalidPNGBytes)];
    BOOL seeded = PBFSeedItems(pasteboard, @[
        @[@{@"nativeName" : PBFFormatUTF8Text, @"data" : text}],
        @[@{@"nativeName" : PBFFormatPNG, @"data" : invalidPNG}]
    ]);
    NSInteger revision = pasteboard.changeCount;
    NSUInteger expectedReads = PBFExpectedCandidateReads(pasteboard);
    __block NSUInteger readCount = 0;
    __block NSUInteger validationCount = 0;
    __block BOOL allReadsOwnedBeforeValidation = YES;
    PBFRepresentationValidator validator = ^BOOL(NSString *nativeName, NSData *data) {
        validationCount++;
        if (readCount != expectedReads) allReadsOwnedBeforeValidation = NO;
        return PBFCodecValidateRepresentation(nativeName, data);
    };
    NSDictionary *result = seeded ? PBFCaptureForTestingWithProviders(
        pasteboard, limits, @(revision), PBFTestPolicy(),
        ^NSData *(NSPasteboardItem *item, NSPasteboardType nativeName) {
            readCount++;
            return [[item dataForType:nativeName] copy];
        }, PBFNoSourceHint(), validator) : @{};

    NSArray *unsupported = result[@"unsupported"];
    BOOL invalidPNGReported = NO;
    for (NSDictionary *entry in unsupported) {
        if ([entry[@"nativeName"] isEqual:PBFFormatPNG] &&
            [entry[@"reasonCode"] isEqual:@"format_validation_failed"]) {
            invalidPNGReported = YES;
        }
    }
    return seeded && expectedReads == 2 && readCount == expectedReads &&
        validationCount == expectedReads && allReadsOwnedBeforeValidation &&
        [result[@"status"] isEqual:@"partial"] && invalidPNGReported &&
        [PBFRepresentationAt(result, 0, PBFFormatUTF8Text) isEqual:text] &&
        !PBFRepresentationAt(result, 1, PBFFormatPNG) &&
        [result[@"byteLength"] unsignedLongLongValue] == text.length &&
        [result[@"revision"] integerValue] == revision &&
        [result[@"observedRevision"] integerValue] == revision &&
        pasteboard.changeCount == revision;
}

static BOOL PBFCaptureContainsNoExceptionDetails(NSDictionary<NSString *, id> *result,
                                                  NSString *secret) {
    if (![result[@"status"] isEqual:@"failed"] ||
        ![result[@"reasonCode"] isKindOfClass:NSString.class] ||
        !PBFHasNoMaterializedPayload(result)) {
        return NO;
    }
    return ![[result description] containsString:secret];
}

static BOOL PBFCaptureValidatorExceptionIsContained(
    NSPasteboard *pasteboard,
    NSDictionary<NSString *, NSNumber *> *limits) {
    NSData *text = [@"exception-owned-payload" dataUsingEncoding:NSUTF8StringEncoding];
    BOOL seeded = PBFSeedItems(pasteboard, @[
        @[@{@"nativeName" : PBFFormatUTF8Text, @"data" : text}]
    ]);
    NSInteger revision = pasteboard.changeCount;
    NSUInteger expectedReads = PBFExpectedCandidateReads(pasteboard);
    NSString *secret = @"private-validator-exception-detail";
    __block NSUInteger readCount = 0;
    __block NSUInteger validationCount = 0;
    PBFRepresentationValidator validator = ^BOOL(NSString *nativeName, NSData *data) {
        (void)nativeName;
        (void)data;
        validationCount++;
        @throw [NSException exceptionWithName:@"PBFPrivateValidatorException"
                                       reason:secret
                                     userInfo:nil];
    };
    NSDictionary *result = seeded ? PBFCaptureForTestingWithProviders(
        pasteboard, limits, @(revision), PBFTestPolicy(),
        ^NSData *(NSPasteboardItem *item, NSPasteboardType nativeName) {
            readCount++;
            return [[item dataForType:nativeName] copy];
        }, PBFNoSourceHint(), validator) : @{};

    return seeded && expectedReads == 1 && readCount == expectedReads &&
        validationCount == 1 && PBFCaptureContainsNoExceptionDetails(result, secret) &&
        pasteboard.changeCount == revision;
}

void PBFRunCaptureTimingTests(
    NSPasteboard *pasteboard,
    NSDictionary<NSString *, NSNumber *> *limits,
    NSMutableArray<NSDictionary<NSString *, id> *> *cases) {
    if (!PBFPrivateUUIDBoard(pasteboard)) {
        PBFAppendPrivateBoardFailures(cases);
        return;
    }

    PBFAppendTimingCase(cases, @"mac-capture-offline-validation-preserves-revision",
        PBFCaptureOfflineValidationPreservesRevision(pasteboard, limits));
    PBFAppendTimingCase(cases, @"mac-capture-materialization-before-validation",
        PBFCaptureMaterializesBeforeValidation(pasteboard, limits));
    PBFAppendTimingCase(cases, @"mac-capture-read-race-discards-owned-bytes",
        PBFCaptureReadRaceDiscardsOwnedBytes(pasteboard, limits));
    PBFAppendTimingCase(cases, @"mac-capture-invalid-owned-bytes-budgeted",
        PBFCaptureInvalidBytesCountAgainstBudget(pasteboard, limits));
    PBFAppendTimingCase(cases, @"mac-capture-owned-validation-partial",
        PBFCaptureOwnedValidationCanBePartial(pasteboard, limits));
    PBFAppendTimingCase(cases, @"mac-capture-validator-exception-contained",
        PBFCaptureValidatorExceptionIsContained(pasteboard, limits));
    PBFRunCaptureTimingPublishTests(pasteboard, limits, cases);
}
