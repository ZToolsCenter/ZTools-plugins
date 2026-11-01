#import "ClipboardFileReferencesTests.h"

#import "ClipboardProbeTestSupport.h"

#import <sys/stat.h>
#import <unistd.h>

static void PBFAddFileReferenceCase(NSMutableArray<NSDictionary<NSString *, id> *> *cases,
                                    NSString *identifier,
                                    BOOL passed) {
    [cases addObject:@{@"id" : identifier,
                       @"status" : passed ? @"pass" : @"fail",
                       @"detailCode" : passed ? @"case-passed" : @"case-failed"}];
}

static NSDictionary<NSString *, id> *PBFFileReferencePlan(NSArray *items, NSInteger revision) {
    return @{@"planId" : NSUUID.UUID.UUIDString,
             @"snapshotId" : NSUUID.UUID.UUIDString,
             @"manifestRevision" : NSUUID.UUID.UUIDString,
             @"expectedRevision" : @(revision),
             @"omittedRepresentationKeys" : @[],
             @"items" : items};
}

static NSArray<NSDictionary<NSString *, id> *> *PBFFileReferenceItems(NSArray<NSURL *> *urls) {
    NSMutableArray *items = [NSMutableArray arrayWithCapacity:urls.count];
    for (NSURL *url in urls) {
        NSData *data = [url.absoluteString dataUsingEncoding:NSUTF8StringEncoding];
        [items addObject:@{@"representations" : @[@{@"nativeName" : PBFFormatFileURL,
                                                      @"data" : data ?: [NSData data]}]}];
    }
    return items;
}

static BOOL PBFFileReferenceItemsMatch(NSArray *expected, NSArray *actual) {
    if (expected.count != actual.count) return NO;
    for (NSUInteger itemIndex = 0; itemIndex < expected.count; itemIndex++) {
        NSArray *expectedRepresentations = expected[itemIndex][@"representations"] ?: @[];
        NSArray *actualRepresentations = actual[itemIndex][@"representations"] ?: @[];
        if (expectedRepresentations.count != actualRepresentations.count) return NO;
        for (NSDictionary *expectedRepresentation in expectedRepresentations) {
            BOOL found = NO;
            for (NSDictionary *actualRepresentation in actualRepresentations) {
                if (![actualRepresentation[@"nativeName"] isEqual:expectedRepresentation[@"nativeName"]]) continue;
                found = [actualRepresentation[@"data"] isEqual:expectedRepresentation[@"data"]];
                break;
            }
            if (!found) return NO;
        }
    }
    return YES;
}

static void PBFAppendFileReferenceSummary(NSArray *items, NSMutableArray *destination) {
    NSUInteger firstIndex = destination.count;
    for (NSUInteger localIndex = 0; localIndex < items.count; localIndex++) {
        NSUInteger reportIndex = firstIndex + localIndex;
        NSMutableArray *representations = [NSMutableArray array];
        for (NSDictionary *representation in items[localIndex][@"representations"] ?: @[]) {
            NSDictionary *summary = PBFRepresentationSummary(reportIndex,
                                                              representation[@"nativeName"],
                                                              representation[@"data"]);
            NSMutableDictionary *safe = [@{@"nativeName" : summary[@"nativeName"],
                                           @"byteLength" : summary[@"byteLength"],
                                           @"sha256" : summary[@"sha256"]} mutableCopy];
            for (NSString *key in @[@"formatKind", @"codec", @"fidelity"]) {
                if (summary[key]) safe[key] = summary[key];
            }
            [representations addObject:safe];
        }
        [destination addObject:@{@"itemIndex" : @(reportIndex), @"representations" : representations}];
    }
}

static BOOL PBFCreateEmptyFile(NSURL *url) {
    return [NSFileManager.defaultManager createFileAtPath:url.path contents:[NSData data] attributes:nil];
}

static BOOL PBFBoardFileURLOrderMatches(NSPasteboard *pasteboard, NSArray<NSURL *> *urls) {
    NSArray<NSPasteboardItem *> *nativeItems = pasteboard.pasteboardItems;
    if (nativeItems.count != urls.count) return NO;
    for (NSUInteger index = 0; index < urls.count; index++) {
        NSData *expected = [urls[index].absoluteString dataUsingEncoding:NSUTF8StringEncoding];
        NSData *actual = [nativeItems[index] dataForType:PBFFormatFileURL];
        if (!expected || ![actual isEqualToData:expected]) return NO;
    }
    return YES;
}

static BOOL PBFFileReferenceRefusalPreservesBoard(
    NSPasteboard *pasteboard,
    NSDictionary<NSString *, NSNumber *> *limits,
    NSURL *unavailableURL) {
    NSInteger beforeRevision = pasteboard.changeCount;
    NSDictionary *baseline = PBFCapture(pasteboard, limits, @(beforeRevision));
    if (![baseline[@"status"] isEqual:@"ready"]) return NO;

    NSArray *items = PBFFileReferenceItems(@[unavailableURL]);
    NSDictionary *plan = PBFFileReferencePlan(items, beforeRevision);
    NSDictionary *result = PBFPublish(pasteboard, plan, limits);
    NSString *serialized = [[NSString alloc] initWithData:
        [NSJSONSerialization dataWithJSONObject:result options:0 error:nil] encoding:NSUTF8StringEncoding];
    BOOL pathRedacted = serialized.length > 0 &&
                        ![serialized containsString:unavailableURL.absoluteString] &&
                        ![serialized containsString:unavailableURL.path];
    BOOL refused = [result[@"status"] isEqual:@"failed"] &&
                   [result[@"reasonCode"] isEqual:@"file_reference_unavailable"] &&
                   [result[@"clipboardMayHaveChanged"] isEqual:@NO] &&
                   [result[@"planId"] isEqual:plan[@"planId"]] &&
                   [result[@"snapshotId"] isEqual:plan[@"snapshotId"]] &&
                   [result[@"manifestRevision"] isEqual:plan[@"manifestRevision"]] &&
                   [result[@"plannedRepresentationKeys"] isEqual:@[@"0:public.file-url"]] &&
                   pathRedacted && pasteboard.changeCount == beforeRevision;
    NSDictionary *after = PBFCapture(pasteboard, limits, @(beforeRevision));
    return refused && [after[@"status"] isEqual:@"ready"] &&
           PBFFileReferenceItemsMatch(baseline[@"items"] ?: @[], after[@"items"] ?: @[]);
}

static BOOL PBFTestSupersededFileReference(NSPasteboard *pasteboard,
                                           NSDictionary<NSString *, NSNumber *> *limits,
                                           NSURL *unavailableURL) {
    NSInteger staleRevision = pasteboard.changeCount;
    NSData *baselineText = [@"file-reference-revision-baseline" dataUsingEncoding:NSUTF8StringEncoding];
    NSArray *baselineItems = @[@{@"representations" : @[@{@"nativeName" : PBFFormatUTF8Text,
                                                            @"data" : baselineText}]}];
    NSDictionary *baselinePlan = PBFFileReferencePlan(baselineItems, staleRevision);
    NSDictionary *baselinePublish = PBFPublish(pasteboard, baselinePlan, limits);
    NSInteger currentRevision = pasteboard.changeCount;
    if (![baselinePublish[@"status"] isEqual:@"committed"] || currentRevision == staleRevision) return NO;

    NSDictionary *stalePlan = PBFFileReferencePlan(PBFFileReferenceItems(@[unavailableURL]), staleRevision);
    NSDictionary *result = PBFPublish(pasteboard, stalePlan, limits);
    NSDictionary *after = PBFCapture(pasteboard, limits, @(currentRevision));
    NSArray *afterItems = after[@"items"];
    NSDictionary *actualItem = afterItems.firstObject;
    NSArray *actualRepresentations = actualItem[@"representations"];
    NSDictionary *actualText = actualRepresentations.firstObject;
    return [result[@"status"] isEqual:@"superseded"] &&
           [result[@"clipboardMayHaveChanged"] isEqual:@NO] &&
           pasteboard.changeCount == currentRevision &&
           [after[@"status"] isEqual:@"ready"] &&
           [actualText[@"data"] isEqual:baselineText];
}

BOOL PBFRunFileReferencePublishTests(
    NSPasteboard *pasteboard,
    NSDictionary<NSString *, NSNumber *> *limits,
    NSMutableArray *plannedSummary,
    NSMutableArray *capturedSummary,
    NSMutableArray<NSDictionary<NSString *, id> *> *cases) {
    NSString *artifactPath = PBFProbeArtifactDirectoryPath();
    if (artifactPath.length == 0) {
        PBFAddFileReferenceCase(cases, @"file-url-publish-existing-file-directory-order", NO);
        PBFAddFileReferenceCase(cases, @"file-url-publish-deleted-target-rejected", NO);
        PBFAddFileReferenceCase(cases, @"file-url-publish-moved-target-rejected", NO);
        PBFAddFileReferenceCase(cases, @"file-url-publish-permission-denied-rejected", NO);
        PBFAddFileReferenceCase(cases, @"file-url-publish-stale-revision-superseded", NO);
        return NO;
    }

    NSString *fixturePath = [artifactPath stringByAppendingPathComponent:
        [NSString stringWithFormat:@"file-reference-publish-%@", NSUUID.UUID.UUIDString]];
    NSURL *fixtureDirectory = [NSURL fileURLWithPath:fixturePath isDirectory:YES];
    NSFileManager *manager = NSFileManager.defaultManager;
    BOOL fixtureCreated = [manager createDirectoryAtURL:fixtureDirectory
                                withIntermediateDirectories:NO
                                                 attributes:nil
                                                      error:nil];
    BOOL allPassed = fixtureCreated;
    NSString *permissionPath = nil;
    @try {
        if (!fixtureCreated) {
            PBFAddFileReferenceCase(cases, @"file-url-publish-existing-file-directory-order", NO);
            PBFAddFileReferenceCase(cases, @"file-url-publish-deleted-target-rejected", NO);
            PBFAddFileReferenceCase(cases, @"file-url-publish-moved-target-rejected", NO);
            PBFAddFileReferenceCase(cases, @"file-url-publish-permission-denied-rejected", NO);
            PBFAddFileReferenceCase(cases, @"file-url-publish-stale-revision-superseded", NO);
            return NO;
        }

        NSURL *firstFile = [fixtureDirectory URLByAppendingPathComponent:@"first.txt"];
        NSURL *directory = [fixtureDirectory URLByAppendingPathComponent:@"folder" isDirectory:YES];
        NSURL *lastFile = [fixtureDirectory URLByAppendingPathComponent:@"last.txt"];
        BOOL targetsCreated = PBFCreateEmptyFile(firstFile) &&
                              [manager createDirectoryAtURL:directory
                                withIntermediateDirectories:NO
                                                 attributes:nil
                                                      error:nil] &&
                              PBFCreateEmptyFile(lastFile);
        NSArray<NSURL *> *validURLs = @[firstFile, directory, lastFile];
        NSArray *validItems = PBFFileReferenceItems(validURLs);
        NSInteger beforeValidPublish = pasteboard.changeCount;
        NSDictionary *validPlan = PBFFileReferencePlan(validItems, beforeValidPublish);
        NSDictionary *validPublish = targetsCreated ? PBFPublish(pasteboard, validPlan, limits) : @{};
        NSDictionary *validCapture = [validPublish[@"status"] isEqual:@"committed"]
            ? PBFCapture(pasteboard, limits, validPublish[@"writeRevision"]) : @{};
        BOOL ordered = targetsCreated &&
                       [validPublish[@"status"] isEqual:@"committed"] &&
                       [validCapture[@"status"] isEqual:@"ready"] &&
                       PBFFileReferenceItemsMatch(validItems, validCapture[@"items"] ?: @[]) &&
                       PBFBoardFileURLOrderMatches(pasteboard, validURLs);
        PBFAddFileReferenceCase(cases, @"file-url-publish-existing-file-directory-order", ordered);
        if (ordered) {
            PBFAppendFileReferenceSummary(validItems, plannedSummary);
            PBFAppendFileReferenceSummary(validCapture[@"items"], capturedSummary);
        }
        allPassed = allPassed && ordered;

        NSURL *deletedFile = [fixtureDirectory URLByAppendingPathComponent:@"deleted.txt"];
        BOOL deletedCreated = PBFCreateEmptyFile(deletedFile);
        BOOL deletedRemoved = deletedCreated && [manager removeItemAtURL:deletedFile error:nil];
        BOOL deletedRejected = deletedRemoved &&
                               PBFFileReferenceRefusalPreservesBoard(pasteboard, limits, deletedFile);
        PBFAddFileReferenceCase(cases, @"file-url-publish-deleted-target-rejected", deletedRejected);
        allPassed = allPassed && deletedRejected;

        NSURL *movedFile = [fixtureDirectory URLByAppendingPathComponent:@"move-source.txt"];
        NSURL *movedDestination = [fixtureDirectory URLByAppendingPathComponent:@"move-destination.txt"];
        BOOL movedCreated = PBFCreateEmptyFile(movedFile);
        BOOL movedSuccessfully = movedCreated && [manager moveItemAtURL:movedFile toURL:movedDestination error:nil];
        BOOL movedRejected = movedSuccessfully &&
                             PBFFileReferenceRefusalPreservesBoard(pasteboard, limits, movedFile);
        PBFAddFileReferenceCase(cases, @"file-url-publish-moved-target-rejected", movedRejected);
        allPassed = allPassed && movedRejected;

        NSURL *permissionFile = [fixtureDirectory URLByAppendingPathComponent:@"restricted.txt"];
        permissionPath = permissionFile.path;
        BOOL permissionCreated = PBFCreateEmptyFile(permissionFile);
        BOOL permissionChanged = permissionCreated && chmod(permissionPath.fileSystemRepresentation, 0000) == 0;
        BOOL permissionDenied = permissionChanged && access(permissionPath.fileSystemRepresentation, R_OK) != 0;
        BOOL permissionRejected = permissionDenied &&
                                  PBFFileReferenceRefusalPreservesBoard(pasteboard, limits, permissionFile);
        PBFAddFileReferenceCase(cases, @"file-url-publish-permission-denied-rejected", permissionRejected);
        allPassed = allPassed && permissionRejected;
        if (permissionPath.length > 0) chmod(permissionPath.fileSystemRepresentation, S_IRUSR | S_IWUSR);

        BOOL staleSuperseded = PBFTestSupersededFileReference(pasteboard, limits, deletedFile);
        PBFAddFileReferenceCase(cases, @"file-url-publish-stale-revision-superseded", staleSuperseded);
        allPassed = allPassed && staleSuperseded;
        return allPassed;
    } @finally {
        if (permissionPath.length > 0) chmod(permissionPath.fileSystemRepresentation, S_IRUSR | S_IWUSR);
        if ([manager fileExistsAtPath:fixturePath]) [manager removeItemAtURL:fixtureDirectory error:nil];
    }
}
