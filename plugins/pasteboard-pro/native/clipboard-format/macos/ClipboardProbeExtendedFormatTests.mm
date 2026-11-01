#import "ClipboardProbe.h"
#import "ClipboardProbeArchiveTests.h"
#import "ClipboardFileReferencesTests.h"
#import "ClipboardProbeTestSupport.h"

#import <CommonCrypto/CommonDigest.h>

#import <string.h>

static void PBFAddFormatCase(NSMutableArray<NSDictionary<NSString *, id> *> *cases,
                             NSString *identifier,
                             BOOL passed) {
    [cases addObject:@{@"id" : identifier,
                       @"status" : passed ? @"pass" : @"fail",
                       @"detailCode" : passed ? @"case-passed" : @"case-failed"}];
}

static NSDictionary<NSString *, id> *PBFExtendedPlan(NSArray *items, NSInteger revision) {
    return @{@"planId" : NSUUID.UUID.UUIDString,
             @"snapshotId" : NSUUID.UUID.UUIDString,
             @"manifestRevision" : NSUUID.UUID.UUIDString,
             @"expectedRevision" : @(revision),
             @"omittedRepresentationKeys" : @[],
             @"items" : items};
}

static NSDictionary<NSString *, id> *PBFExtendedItem(NSArray *representations) {
    return @{@"representations" : representations};
}

static NSDictionary<NSString *, id> *PBFExtendedRepresentation(NSString *nativeName, NSData *data) {
    return @{@"nativeName" : nativeName, @"data" : data};
}

static BOOL PBFFormatItemsMatch(NSArray *expected, NSArray *actual) {
    if (expected.count != actual.count) return NO;
    for (NSUInteger itemIndex = 0; itemIndex < expected.count; itemIndex++) {
        NSArray *expectedReps = expected[itemIndex][@"representations"] ?: @[];
        NSArray *actualReps = actual[itemIndex][@"representations"] ?: @[];
        for (NSDictionary *expectedRep in expectedReps) {
            BOOL found = NO;
            for (NSDictionary *actualRep in actualReps) {
                if (![actualRep[@"nativeName"] isEqual:expectedRep[@"nativeName"]]) continue;
                found = [actualRep[@"data"] isEqual:expectedRep[@"data"]];
                break;
            }
            if (!found) return NO;
        }
    }
    return YES;
}

static BOOL PBFIsFormatNoMutationFailure(NSDictionary *result,
                                         NSPasteboard *pasteboard,
                                         NSInteger revision) {
    return [result[@"status"] isEqual:@"failed"] &&
           [result[@"clipboardMayHaveChanged"] isEqual:@NO] &&
           pasteboard.changeCount == revision;
}

static void PBFAppendSafeFormatSummary(NSArray *items, NSMutableArray *destination) {
    NSUInteger firstIndex = destination.count;
    for (NSUInteger localIndex = 0; localIndex < items.count; localIndex++) {
        NSArray *representations = items[localIndex][@"representations"] ?: @[];
        NSMutableArray *summaries = [NSMutableArray arrayWithCapacity:representations.count];
        NSUInteger reportIndex = firstIndex + localIndex;
        for (NSDictionary *representation in representations) {
            NSString *nativeName = representation[@"nativeName"];
            NSData *data = representation[@"data"];
            if (![nativeName isKindOfClass:NSString.class] || ![data isKindOfClass:NSData.class]) continue;
            NSDictionary *full = PBFRepresentationSummary(reportIndex, nativeName, data);
            NSMutableDictionary *safe = [@{@"nativeName" : full[@"nativeName"],
                                           @"byteLength" : full[@"byteLength"],
                                           @"sha256" : full[@"sha256"]} mutableCopy];
            for (NSString *key in @[@"formatKind", @"codec", @"fidelity"]) {
                if (full[key]) safe[key] = full[key];
            }
            [summaries addObject:safe];
        }
        [destination addObject:@{@"itemIndex" : @(reportIndex), @"representations" : summaries}];
    }
}

static BOOL PBFPublishAndCapture(NSPasteboard *pasteboard,
                                 NSDictionary<NSString *, NSNumber *> *limits,
                                 NSArray *items,
                                 NSDictionary **publishResult,
                                 NSDictionary **captureResult) {
    NSInteger before = pasteboard.changeCount;
    NSDictionary *published = PBFPublish(pasteboard, PBFExtendedPlan(items, before), limits);
    if (publishResult) *publishResult = published;
    if (![published[@"status"] isEqual:@"committed"]) return NO;
    NSDictionary *captured = PBFCapture(pasteboard, limits, published[@"writeRevision"]);
    if (captureResult) *captureResult = captured;
    return [captured[@"status"] isEqual:@"ready"] &&
           PBFFormatItemsMatch(items, captured[@"items"] ?: @[]);
}

static NSBitmapImageRep *PBFExtendedBitmap(void) {
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
    const uint8_t pixels[16] = {15, 80, 160, 255, 235, 40, 20, 192,
                                40, 200, 90, 255, 240, 210, 25, 128};
    memcpy(bitmap.bitmapData, pixels, sizeof(pixels));
    return bitmap;
}

static BOOL PBFTestJPEGAndTIFF(NSPasteboard *pasteboard,
                               NSDictionary<NSString *, NSNumber *> *limits,
                               NSMutableArray *plannedSummary,
                               NSMutableArray *capturedSummary,
                               NSMutableArray<NSDictionary<NSString *, id> *> *cases) {
    NSBitmapImageRep *bitmap = PBFExtendedBitmap();
    NSData *jpeg = [bitmap representationUsingType:NSBitmapImageFileTypeJPEG
                                          properties:@{NSImageCompressionFactor : @0.9}];
    NSData *tiff = [bitmap representationUsingType:NSBitmapImageFileTypeTIFF properties:@{}];
    NSArray *items = @[@{@"representations" : @[
        PBFExtendedRepresentation(PBFFormatJPEG, jpeg ?: [NSData data]),
        PBFExtendedRepresentation(PBFFormatTIFF, tiff ?: [NSData data])]}];
    NSDictionary *published = nil;
    NSDictionary *captured = nil;
    BOOL passed = bitmap != nil && jpeg.length > 0 && tiff.length > 0 &&
                  PBFPublishAndCapture(pasteboard, limits, items, &published, &captured);
    if (published && [published[@"status"] isEqual:@"committed"]) PBFAppendSafeFormatSummary(items, plannedSummary);
    if (captured && [captured[@"status"] isEqual:@"ready"]) PBFAppendSafeFormatSummary(captured[@"items"], capturedSummary);
    PBFAddFormatCase(cases, @"jpeg-tiff-raw-roundtrip", passed);
    return passed;
}

static BOOL PBFTestImageBudget(NSMutableArray<NSDictionary<NSString *, id> *> *cases) {
    uint64_t nextEstimate = 0;
    BOOL smallFrameAccepted = PBFCodecImageFrameBudgetAllows(2, 2, 0, &nextEstimate) && nextEstimate == 32;
    BOOL accumulatedBudgetRejected = !PBFCodecImageFrameBudgetAllows(1, 1, UINT64_MAX, &nextEstimate);
    BOOL oversizedDimensionRejected = !PBFCodecImageFrameBudgetAllows(8193, 1, 0, &nextEstimate);
    BOOL passed = smallFrameAccepted && accumulatedBudgetRejected && oversizedDimensionRejected;
    PBFAddFormatCase(cases, @"image-decoded-byte-budget", passed);
    return passed;
}

static BOOL PBFTestURLs(NSPasteboard *pasteboard,
                        NSDictionary<NSString *, NSNumber *> *limits,
                        NSMutableArray *plannedSummary,
                        NSMutableArray *capturedSummary,
                        NSMutableArray<NSDictionary<NSString *, id> *> *cases) {
    NSArray<NSString *> *rawURIStrings = @[
        @"https://example.invalid/%E9%9B%AA?q=synthetic",
        @"mailto:?subject=headers-only",
        @"ftp://user:secret@[2001:db8::1]:21/%E9%9B%AA",
        @"file:///tmp/clipboard-synthetic.txt",
        @"web+custom:folder/雪?token=%2f",
        @"javascript:alert(1)",
        @"data:text/plain,clipboard%20fixture",
        @"x:",
        @"urn:pasteboard:%C3%A9",
        @"urn:pasteboard:é",
        @"urn:pasteboard:e\u0301",
    ];
    NSMutableArray *items = [NSMutableArray array];
    BOOL serialized = YES;
    for (NSString *value in rawURIStrings) {
        NSData *data = [value dataUsingEncoding:NSUTF8StringEncoding];
        if (data == nil) {
            serialized = NO;
            break;
        }
        [items addObject:PBFExtendedItem(@[PBFExtendedRepresentation(PBFFormatURL, data)])];
    }
    if (!serialized) {
        PBFAddFormatCase(cases, @"url-raw-uri-retention", NO);
        return NO;
    }
    NSDictionary *published = nil;
    NSDictionary *captured = nil;
    BOOL passed = PBFPublishAndCapture(pasteboard, limits, items, &published, &captured);
    NSURL *standardURL = [NSURL URLFromPasteboard:pasteboard];
    NSURL *expectedURL = [NSURL URLWithString:rawURIStrings.firstObject];
    passed = passed && [standardURL.absoluteString isEqualToString:expectedURL.absoluteString] &&
             captured != nil && PBFFormatItemsMatch(items, captured[@"items"] ?: @[]);
    if (published && [published[@"status"] isEqual:@"committed"]) PBFAppendSafeFormatSummary(items, plannedSummary);
    if (captured && [captured[@"status"] isEqual:@"ready"]) PBFAppendSafeFormatSummary(captured[@"items"], capturedSummary);
    PBFAddFormatCase(cases, @"url-raw-uri-retention", passed);
    return passed;
}

static BOOL PBFTestMalformedStoredURIs(NSPasteboard *pasteboard,
                                       NSDictionary<NSString *, NSNumber *> *limits,
                                       NSMutableArray<NSDictionary<NSString *, id> *> *cases) {
    const uint8_t invalidUTF8Bytes[] = {0x63, 0x75, 0x73, 0x74, 0x6f, 0x6d, 0x3a, 0xc3, 0x28};
    NSArray<NSData *> *invalidURLs = @[
        [@"relative/path" dataUsingEncoding:NSUTF8StringEncoding],
        [@"1scheme:value" dataUsingEncoding:NSUTF8StringEncoding],
        [@"custom:a?broken=%G1" dataUsingEncoding:NSUTF8StringEncoding],
        [@"https://example.invalid/path\nnext" dataUsingEncoding:NSUTF8StringEncoding],
        [NSData dataWithBytes:invalidUTF8Bytes length:sizeof(invalidUTF8Bytes)],
    ];
    BOOL rejected = YES;
    for (NSData *data in invalidURLs) {
        NSInteger revision = pasteboard.changeCount;
        NSDictionary *result = PBFPublish(
            pasteboard,
            PBFExtendedPlan(@[PBFExtendedItem(@[PBFExtendedRepresentation(PBFFormatURL, data)])], revision),
            limits);
        rejected = rejected && PBFIsFormatNoMutationFailure(result, pasteboard, revision);
    }
    PBFAddFormatCase(cases, @"url-uri-structure-rejected", rejected);
    return rejected;
}

static BOOL PBFTestFileURLReferences(NSPasteboard *pasteboard,
                                     NSDictionary<NSString *, NSNumber *> *limits,
                                     NSMutableArray *plannedSummary,
                                     NSMutableArray *capturedSummary,
                                     NSMutableArray<NSDictionary<NSString *, id> *> *cases) {
    NSString *artifactPath = PBFProbeArtifactDirectoryPath();
    if (artifactPath.length == 0) {
        PBFAddFormatCase(cases, @"file-url-order-roundtrip", NO);
        PBFAddFormatCase(cases, @"file-url-target-unavailable", NO);
        return NO;
    }
    NSString *fixturePath = [artifactPath stringByAppendingPathComponent:
        [NSString stringWithFormat:@"fixture-%@", NSUUID.UUID.UUIDString]];
    NSFileManager *manager = NSFileManager.defaultManager;
    NSURL *fixtureDirectory = [NSURL fileURLWithPath:fixturePath isDirectory:YES];
    NSArray<NSString *> *names = @[@"数据-一.txt", @"雪-二.txt"];
    NSMutableArray<NSURL *> *fileURLs = [NSMutableArray array];
    BOOL prepared = artifactPath.length > 0 && [manager createDirectoryAtURL:fixtureDirectory
                                                     withIntermediateDirectories:NO
                                                                      attributes:nil
                                                                           error:nil];
    NSMutableArray *items = [NSMutableArray array];
    @try {
        NSString *executablePath = PBFProbeCurrentExecutablePath();
        NSString *symlinkPath = [fixturePath stringByAppendingPathComponent:@"probe-executable-alias"];
        BOOL outsideRootRejected = PBFProbeArtifactDirectoryPathForExecutable(@"/usr/bin/true") == nil;
        BOOL outputLayoutsAccepted = [@[@"darwin", @"macos"] containsObject:artifactPath.lastPathComponent];
        BOOL symlinkCreated = prepared && [manager createSymbolicLinkAtPath:symlinkPath
                                                        withDestinationPath:executablePath
                                                                      error:nil];
        BOOL symlinkRejected = symlinkCreated && PBFProbeArtifactDirectoryPathForExecutable(symlinkPath) == nil;
        PBFAddFormatCase(cases, @"file-fixture-path-rejection",
                         outputLayoutsAccepted && outsideRootRejected && symlinkRejected);

        for (NSString *name in names) {
            NSURL *fileURL = [fixtureDirectory URLByAppendingPathComponent:name];
            NSData *syntheticBody = [@"synthetic-fixture" dataUsingEncoding:NSUTF8StringEncoding];
            prepared = prepared && [manager createFileAtPath:fileURL.path contents:syntheticBody attributes:nil];
            [fileURLs addObject:fileURL];
            NSData *urlData = [fileURL.absoluteString dataUsingEncoding:NSUTF8StringEncoding];
            [items addObject:PBFExtendedItem(@[PBFExtendedRepresentation(PBFFormatFileURL, urlData)])];
        }

        NSDictionary *published = nil;
        NSDictionary *captured = nil;
        BOOL ordered = prepared && PBFPublishAndCapture(pasteboard, limits, items, &published, &captured);
        NSURL *standardURL = [NSURL URLFromPasteboard:pasteboard];
        ordered = ordered && [standardURL.absoluteString isEqualToString:fileURLs.firstObject.absoluteString];
        if (published && [published[@"status"] isEqual:@"committed"]) PBFAppendSafeFormatSummary(items, plannedSummary);
        if (captured && [captured[@"status"] isEqual:@"ready"]) PBFAppendSafeFormatSummary(captured[@"items"], capturedSummary);
        PBFAddFormatCase(cases, @"file-url-order-roundtrip", ordered);

        NSError *cleanupError = nil;
        BOOL removed = fixturePath.length > 0 && [manager removeItemAtURL:fixtureDirectory error:&cleanupError];
        BOOL unavailable = removed;
        for (NSURL *fileURL in fileURLs) unavailable = unavailable && ![manager fileExistsAtPath:fileURL.path];
        NSDictionary *afterCleanup = PBFCapture(pasteboard, limits, published[@"writeRevision"]);
        unavailable = unavailable && [afterCleanup[@"status"] isEqual:@"ready"] &&
                      PBFFormatItemsMatch(items, afterCleanup[@"items"] ?: @[]);
        PBFAddFormatCase(cases, @"file-url-target-unavailable", unavailable);
        if ([afterCleanup[@"status"] isEqual:@"ready"]) PBFAppendSafeFormatSummary(afterCleanup[@"items"], capturedSummary);
        return ordered && unavailable;
    } @finally {
        if (fixturePath.length > 0 && [manager fileExistsAtPath:fixturePath]) {
            [manager removeItemAtURL:fixtureDirectory error:nil];
        }
    }
}

static BOOL PBFTestTSV(NSPasteboard *pasteboard,
                       NSDictionary<NSString *, NSNumber *> *limits,
                       NSMutableArray *plannedSummary,
                       NSMutableArray *capturedSummary,
                       NSMutableArray<NSDictionary<NSString *, id> *> *cases) {
    NSString *table = @"名称\t数量\n苹果\t3\n咖啡\t12\n";
    NSData *data = [table dataUsingEncoding:NSUTF8StringEncoding];
    NSArray *items = @[PBFExtendedItem(@[
        PBFExtendedRepresentation(PBFFormatTSV, data),
        PBFExtendedRepresentation(PBFFormatUTF8Text, data)])];
    NSDictionary *published = nil;
    NSDictionary *captured = nil;
    BOOL passed = PBFPublishAndCapture(pasteboard, limits, items, &published, &captured);
    NSPasteboardItem *nativeItem = pasteboard.pasteboardItems.firstObject;
    passed = passed && [nativeItem stringForType:PBFFormatTSV].length > 0 &&
             [[nativeItem stringForType:PBFFormatTSV] isEqualToString:table] &&
             [[nativeItem stringForType:PBFFormatUTF8Text] isEqualToString:table];
    if (published && [published[@"status"] isEqual:@"committed"]) PBFAppendSafeFormatSummary(items, plannedSummary);
    if (captured && [captured[@"status"] isEqual:@"ready"]) PBFAppendSafeFormatSummary(captured[@"items"], capturedSummary);
    PBFAddFormatCase(cases, @"tsv-text-roundtrip", passed);
    return passed;
}

static BOOL PBFTestSingleColumnTSV(NSPasteboard *pasteboard,
                                   NSDictionary<NSString *, NSNumber *> *limits,
                                   NSMutableArray *plannedSummary,
                                   NSMutableArray *capturedSummary,
                                   NSMutableArray<NSDictionary<NSString *, id> *> *cases) {
    NSArray<NSString *> *values = @[@"单字段值", @"第一行\n第二行\n第三行"];
    BOOL passed = YES;
    for (NSString *value in values) {
        NSData *data = [value dataUsingEncoding:NSUTF8StringEncoding];
        NSArray *items = @[PBFExtendedItem(@[PBFExtendedRepresentation(PBFFormatTSV, data ?: [NSData data])])];
        NSDictionary *published = nil;
        NSDictionary *captured = nil;
        BOOL roundtrip = data.length > 0 && PBFPublishAndCapture(pasteboard, limits, items, &published, &captured);
        NSDictionary *actualRepresentation = nil;
        NSArray *capturedItems = captured[@"items"];
        NSArray *representations = capturedItems.firstObject[@"representations"];
        for (NSDictionary *representation in representations) {
            if ([representation[@"nativeName"] isEqual:PBFFormatTSV]) actualRepresentation = representation;
        }
        NSPasteboardItem *nativeItem = pasteboard.pasteboardItems.firstObject;
        NSData *nativeTypedData = [nativeItem dataForType:PBFFormatTSV];
        roundtrip = roundtrip && actualRepresentation != nil &&
                    [actualRepresentation[@"data"] isEqualToData:data] &&
                    [nativeTypedData isEqualToData:data];
        passed = passed && roundtrip;
        if (published && [published[@"status"] isEqual:@"committed"]) {
            PBFAppendSafeFormatSummary(items, plannedSummary);
        }
        if (captured && [captured[@"status"] isEqual:@"ready"]) {
            PBFAppendSafeFormatSummary(capturedItems, capturedSummary);
        }
    }
    PBFAddFormatCase(cases, @"tsv-single-column-preserved", passed);
    return passed;
}

static BOOL PBFTestSecureColor(NSPasteboard *pasteboard,
                               NSDictionary<NSString *, NSNumber *> *limits,
                               NSMutableArray *plannedSummary,
                               NSMutableArray *capturedSummary,
                               NSMutableArray<NSDictionary<NSString *, id> *> *cases) {
    NSColor *source = [NSColor colorWithSRGBRed:0.2 green:0.4 blue:0.6 alpha:0.8];
    NSError *archiveError = nil;
    NSData *archive = [NSKeyedArchiver archivedDataWithRootObject:source
                                         requiringSecureCoding:YES
                                                         error:&archiveError];
    NSArray *items = @[PBFExtendedItem(@[PBFExtendedRepresentation(PBFFormatColor, archive ?: [NSData data])])];
    NSDictionary *published = nil;
    NSDictionary *captured = nil;
    BOOL passed = archiveError == nil && archive.length > 0 &&
                  PBFCodecValidateRepresentation(PBFFormatColor, archive) &&
                  PBFPublishAndCapture(pasteboard, limits, items, &published, &captured) &&
                  [NSColor colorFromPasteboard:pasteboard] != nil;
    if (published && [published[@"status"] isEqual:@"committed"]) PBFAppendSafeFormatSummary(items, plannedSummary);
    if (captured && [captured[@"status"] isEqual:@"ready"]) PBFAppendSafeFormatSummary(captured[@"items"], capturedSummary);
    PBFAddFormatCase(cases, @"color-secure-archive-roundtrip", passed);
    return passed;
}

static BOOL PBFTestRejectedColorArchives(NSMutableArray<NSDictionary<NSString *, id> *> *cases) {
    NSImage *patternImage = [[NSImage alloc] initWithSize:NSMakeSize(2, 2)];
    NSBitmapImageRep *bitmap = PBFExtendedBitmap();
    if (bitmap) [patternImage addRepresentation:bitmap];
    NSColor *patternColor = [NSColor colorWithPatternImage:patternImage];
    NSError *patternError = nil;
    NSData *patternArchive = [NSKeyedArchiver archivedDataWithRootObject:patternColor
                                                    requiringSecureCoding:YES
                                                                    error:&patternError];
    NSURL *syntheticURL = [NSURL URLWithString:@"https://example.invalid/color-fixture"];
    NSError *urlError = nil;
    NSData *urlArchive = [NSKeyedArchiver archivedDataWithRootObject:syntheticURL
                                                requiringSecureCoding:YES
                                                                error:&urlError];
    BOOL patternRejected = patternError == nil && patternArchive.length > 0 &&
                           !PBFCodecValidateRepresentation(PBFFormatColor, patternArchive);
    BOOL urlRejected = urlError == nil && urlArchive.length > 0 &&
                       !PBFCodecValidateRepresentation(PBFFormatColor, urlArchive);
    BOOL passed = patternRejected && urlRejected;
    PBFAddFormatCase(cases, @"color-untrusted-object-archives-rejected", passed);
    return passed;
}

static BOOL PBFTestInvalidFormatPayloads(NSPasteboard *pasteboard,
                                         NSDictionary<NSString *, NSNumber *> *limits,
                                         NSMutableArray<NSDictionary<NSString *, id> *> *cases) {
    const uint8_t invalidImageBytes[] = {0x00, 0x11, 0x22, 0x33, 0x44};
    NSData *invalidImage = [NSData dataWithBytes:invalidImageBytes length:sizeof(invalidImageBytes)];
    const uint8_t invalidTSVBytes[] = {'b', 'a', 'd', 0, 'c', 'e', 'l', 'l'};
    NSData *invalidText = [NSData dataWithBytes:invalidTSVBytes length:sizeof(invalidTSVBytes)];
    NSData *malformedURL = [@"https://example.invalid/%G1" dataUsingEncoding:NSUTF8StringEncoding];
    NSData *remoteFileURL = [@"file://remote.example.invalid/private.txt" dataUsingEncoding:NSUTF8StringEncoding];
    NSData *invalidColor = [@"not-a-keyed-archive" dataUsingEncoding:NSUTF8StringEncoding];
    NSArray *types = @[PBFFormatJPEG, PBFFormatTIFF, PBFFormatTSV, PBFFormatURL, PBFFormatFileURL, PBFFormatColor];
    NSArray<NSData *> *payloads = @[invalidImage, invalidImage, invalidText, malformedURL, remoteFileURL, invalidColor];
    BOOL passed = YES;
    for (NSUInteger index = 0; index < types.count; index++) {
        NSInteger revision = pasteboard.changeCount;
        NSArray *items = @[PBFExtendedItem(@[PBFExtendedRepresentation(types[index], payloads[index])])];
        NSDictionary *result = PBFPublish(pasteboard, PBFExtendedPlan(items, revision), limits);
        passed = passed && PBFIsFormatNoMutationFailure(result, pasteboard, revision);
    }
    PBFAddFormatCase(cases, @"format-codec-validation-rejected", passed);
    return passed;
}

NSDictionary<NSString *, id> *PBFRunExtendedFormatTests(
    NSPasteboard *pasteboard,
    NSDictionary<NSString *, NSNumber *> *limits,
    NSMutableArray<NSDictionary<NSString *, id> *> *cases) {
    NSMutableArray *planned = [NSMutableArray array];
    NSMutableArray *captured = [NSMutableArray array];
    PBFTestJPEGAndTIFF(pasteboard, limits, planned, captured, cases);
    PBFTestImageBudget(cases);
    PBFTestURLs(pasteboard, limits, planned, captured, cases);
    PBFTestMalformedStoredURIs(pasteboard, limits, cases);
    PBFTestFileURLReferences(pasteboard, limits, planned, captured, cases);
    PBFRunFileReferencePublishTests(pasteboard, limits, planned, captured, cases);
    PBFTestTSV(pasteboard, limits, planned, captured, cases);
    PBFTestSingleColumnTSV(pasteboard, limits, planned, captured, cases);
    PBFTestSecureColor(pasteboard, limits, planned, captured, cases);
    PBFTestRejectedColorArchives(cases);
    PBFTestMalformedColorArchiveTypes(cases);
    PBFTestInvalidFormatPayloads(pasteboard, limits, cases);
    return @{@"planned" : planned, @"captured" : captured, @"compatibleAliases" : @[]};
}
