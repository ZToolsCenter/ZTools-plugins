#import "ClipboardRtfFramingTests.h"
#import "ClipboardProbe.h"

static NSData *RTFBytes(NSString *value) {
    return [value dataUsingEncoding:NSUTF8StringEncoding];
}

static void RTFCase(NSMutableArray *cases, NSString *identifier, BOOL pass) {
    [cases addObject:@{ @"id" : identifier, @"status" : pass ? @"pass" : @"fail",
                        @"detailCode" : pass ? @"case-passed" : @"case-failed" }];
}

static NSDictionary *RTFPlan(NSPasteboard *board, NSArray *representations) {
    return @{ @"planId" : NSUUID.UUID.UUIDString, @"snapshotId" : NSUUID.UUID.UUIDString,
              @"manifestRevision" : NSUUID.UUID.UUIDString, @"expectedRevision" : @(board.changeCount),
              @"omittedRepresentationKeys" : @[], @"items" : @[@{ @"representations" : representations }] };
}

static NSData *RTFFind(NSDictionary *capture, NSString *name) {
    for (NSDictionary *item in capture[@"items"]) {
        for (NSDictionary *rep in item[@"representations"]) {
            if ([rep[@"nativeName"] isEqual:name]) return rep[@"data"];
        }
    }
    return nil;
}

static BOOL RTFSeed(NSPasteboard *board, NSData *text, NSData *rtf) {
    [board clearContents];
    NSPasteboardItem *item = [[NSPasteboardItem alloc] init];
    return [item setData:text forType:PBFFormatUTF8Text] &&
        [item setData:rtf forType:PBFFormatRTF] && [board writeObjects:@[item]];
}

void PBFRunRtfFramingTests(NSPasteboard *board, NSDictionary<NSString *, NSNumber *> *limits,
                           NSMutableArray<NSDictionary<NSString *, id> *> *cases) {
    BOOL privateBoard = [board.name hasPrefix:@"org.ztools.pasteboard-pro.g0."] &&
        !PBFIsReservedPasteboardName(board.name);
    NSArray *invalid = @[@"not-rtf", @"{\\rtfx1 text}", @"{\\rtf2 text}",
        @"{\\rtf10 text}", @"{\\rtf1 unclosed", @"{\\rtf1 \\'QZ}",
        @"{\\rtf1\\bin-1 x}", @"{\\rtf1}private-trailing-data"];
    BOOL codec = privateBoard;
    for (NSString *value in invalid) codec = !PBFCodecValidateRepresentation(PBFFormatRTF, RTFBytes(value)) && codec;
    NSMutableData *binary = [RTFBytes(@"{\\rtf1\\ansi\\bin4 ") mutableCopy];
    const uint8_t payload[] = {0, '{', '}', '\\'};
    [binary appendBytes:payload length:sizeof(payload)];
    [binary appendData:RTFBytes(@"}")];
    codec = codec && PBFCodecValidateRepresentation(PBFFormatRTF, binary);
    RTFCase(cases, @"rtf-framing-codec-validation", codec);

    NSData *text = RTFBytes(@"RTF fixture");
    NSData *valid = RTFBytes(@"{\\rtf1\\ansi\\uc1 RTF \\b fixture\\b0\\par \\u27979?}");
    NSDictionary *published = privateBoard ? PBFPublish(board, RTFPlan(board, @[
        @{ @"nativeName" : PBFFormatUTF8Text, @"data" : text },
        @{ @"nativeName" : PBFFormatRTF, @"data" : valid }]), limits) : @{};
    NSDictionary *captured = [published[@"status"] isEqual:@"committed"] ?
        PBFCapture(board, limits, published[@"writeRevision"]) : @{};
    RTFCase(cases, @"rtf-framing-raw-roundtrip", [published[@"status"] isEqual:@"committed"] &&
        [RTFFind(captured, PBFFormatRTF) isEqual:valid]);

    BOOL seeded = privateBoard && RTFSeed(board, text, RTFBytes(@"{\\rtfx1 invalid}"));
    NSInteger revision = board.changeCount;
    NSDictionary *partial = seeded ? PBFCapture(board, limits, @(revision)) : @{};
    BOOL invalidReported = NO;
    for (NSDictionary *rep in partial[@"unsupported"]) {
        invalidReported |= [rep[@"nativeName"] isEqual:PBFFormatRTF] &&
            [rep[@"reasonCode"] isEqual:@"format_validation_failed"];
    }
    RTFCase(cases, @"rtf-framing-invalid-capture-partial", seeded &&
        [partial[@"status"] isEqual:@"partial"] && [RTFFind(partial, PBFFormatUTF8Text) isEqual:text] &&
        !RTFFind(partial, PBFFormatRTF) && invalidReported && board.changeCount == revision);

    NSDictionary *rejected = seeded ? PBFPublish(board, RTFPlan(board, @[
        @{ @"nativeName" : PBFFormatRTF, @"data" : RTFBytes(@"{\\rtf1}tail") }]), limits) : @{};
    RTFCase(cases, @"rtf-framing-publish-rejects-before-clear", seeded &&
        [rejected[@"status"] isEqual:@"failed"] && board.changeCount == revision &&
        [board.pasteboardItems.firstObject dataForType:PBFFormatUTF8Text] &&
        [[board.pasteboardItems.firstObject dataForType:PBFFormatUTF8Text] isEqual:text]);
}
