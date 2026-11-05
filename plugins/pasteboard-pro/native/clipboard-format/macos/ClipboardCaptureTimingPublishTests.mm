#import "ClipboardCaptureTimingPublishTests.h"

#import "ClipboardProbe.h"
#import "ClipboardCapturePolicy.h"
#import "ClipboardFormatCodecs.h"

static NSString *const PBFPrivateBoardPrefix = @"org.ztools.pasteboard-pro.g0.";

@interface PBFReadbackRaceState : NSObject
@property(nonatomic, strong) NSPasteboard *pasteboard;
@property(nonatomic, strong) NSData *replacement;
@property(nonatomic, strong) NSDictionary<NSString *, id> *captureResult;
@property(nonatomic, assign) NSUInteger readCount;
@property(nonatomic, assign) NSUInteger validationCount;
@property(nonatomic, assign) NSInteger readbackRevision;
@property(nonatomic, assign) BOOL replacementSeeded;
@end

@implementation PBFReadbackRaceState
@end

static PBFReadbackRaceState *PBFActiveReadbackRaceState;

static BOOL PBFPrivateUUIDBoard(NSPasteboard *pasteboard) {
    if (![pasteboard isKindOfClass:NSPasteboard.class] ||
        PBFIsReservedPasteboardName(pasteboard.name) ||
        ![pasteboard.name hasPrefix:PBFPrivateBoardPrefix]) {
        return NO;
    }
    NSString *uuid = [pasteboard.name substringFromIndex:PBFPrivateBoardPrefix.length];
    return [[NSUUID alloc] initWithUUIDString:uuid] != nil;
}

static NSDictionary<NSString *, id> *PBFTestPolicy(void) {
    NSMutableDictionary *policy = [PBFDefaultCapturePolicy() mutableCopy];
    policy[@"allowUnknownSource"] = @YES;
    return PBFNormalizeCapturePolicy(policy);
}

static NSDictionary<NSString *, id> *PBFReadbackRaceCaptureProvider(
    NSPasteboard *pasteboard,
    NSDictionary<NSString *, NSNumber *> *limits,
    NSNumber *expectedRevision) {
    PBFReadbackRaceState *state = PBFActiveReadbackRaceState;
    if (!state || pasteboard != state.pasteboard) {
        return @{@"status" : @"failed", @"reasonCode" : @"test_context_unavailable"};
    }
    state.readbackRevision = pasteboard.changeCount;
    PBFRepresentationValidator validator = ^BOOL(NSString *nativeName, NSData *data) {
        state.validationCount++;
        if (state.validationCount == 1) {
            [pasteboard clearContents];
            NSPasteboardItem *replacementItem = [[NSPasteboardItem alloc] init];
            state.replacementSeeded =
                [replacementItem setData:state.replacement forType:PBFFormatUTF8Text] &&
                [pasteboard writeObjects:@[replacementItem]];
        }
        return PBFCodecValidateRepresentation(nativeName, data);
    };
    state.captureResult = PBFCaptureForTestingWithProviders(
        pasteboard, limits, expectedRevision, PBFTestPolicy(),
        ^NSData *(NSPasteboardItem *item, NSPasteboardType nativeName) {
            state.readCount++;
            return [[item dataForType:nativeName] copy];
        }, ^NSString *{
            return nil;
        }, validator);
    return state.captureResult;
}


static NSDictionary<NSString *, id> *PBFPublishTextPlan(NSInteger revision, NSData *data) {
    return @{@"planId" : NSUUID.UUID.UUIDString,
             @"snapshotId" : NSUUID.UUID.UUIDString,
             @"manifestRevision" : NSUUID.UUID.UUIDString,
             @"expectedRevision" : @(revision),
             @"omittedRepresentationKeys" : @[],
             @"items" : @[
                 @{@"representations" : @[
                     @{@"nativeName" : PBFFormatUTF8Text, @"data" : data}
                 ]}
             ]};
}

static BOOL PBFBoardHasText(NSPasteboard *pasteboard, NSData *expected) {
    NSData *actual = [pasteboard.pasteboardItems.firstObject dataForType:PBFFormatUTF8Text];
    return [actual isKindOfClass:NSData.class] && [actual isEqual:expected];
}

static BOOL PBFPublishReadbackRaceIsUnconfirmed(
    NSPasteboard *pasteboard,
    NSDictionary<NSString *, NSNumber *> *limits) {
    NSData *plannedData = [@"publish-before-offline-readback-race" dataUsingEncoding:NSUTF8StringEncoding];
    NSData *replacement = [@"external-writer-during-validation" dataUsingEncoding:NSUTF8StringEncoding];
    NSInteger before = pasteboard.changeCount;
    PBFReadbackRaceState *state = [[PBFReadbackRaceState alloc] init];
    state.pasteboard = pasteboard;
    state.replacement = replacement;
    PBFActiveReadbackRaceState = state;
    NSDictionary *result = nil;
    @try {
        result = PBFPublishForTestingWithReadbackProvider(
            pasteboard, PBFPublishTextPlan(before, plannedData), limits,
            PBFReadbackRaceCaptureProvider);
    } @finally {
        PBFActiveReadbackRaceState = nil;
    }

    NSInteger observedRevision = pasteboard.changeCount;
    return [result[@"status"] isEqual:@"partial-write"] &&
        [result[@"reasonCode"] isEqual:@"clipboard_superseded_during_readback"] &&
        ![result[@"status"] isEqual:@"committed"] &&
        [result[@"clipboardMayHaveChanged"] isEqual:@YES] &&
        [result[@"writeRevision"] integerValue] == state.readbackRevision &&
        state.readbackRevision != before &&
        observedRevision != state.readbackRevision &&
        [state.captureResult[@"status"] isEqual:@"ready"] &&
        [state.captureResult[@"revision"] integerValue] == state.readbackRevision &&
        [state.captureResult[@"observedRevision"] integerValue] == observedRevision &&
        state.readCount == 1 && state.validationCount == 1 &&
        state.replacementSeeded && PBFBoardHasText(pasteboard, replacement);
}

static void PBFAppendPublishTimingCase(
    NSMutableArray<NSDictionary<NSString *, id> *> *cases,
    BOOL passed) {
    [cases addObject:@{@"id" : @"mac-publish-offline-readback-race-unconfirmed",
                       @"status" : passed ? @"pass" : @"fail",
                       @"detailCode" : passed ? @"case-passed" : @"case-failed"}];
}

void PBFRunCaptureTimingPublishTests(
    NSPasteboard *pasteboard,
    NSDictionary<NSString *, NSNumber *> *limits,
    NSMutableArray<NSDictionary<NSString *, id> *> *cases) {
    BOOL privateBoard = PBFPrivateUUIDBoard(pasteboard);
    PBFAppendPublishTimingCase(cases, privateBoard &&
        PBFPublishReadbackRaceIsUnconfirmed(pasteboard, limits));
}
