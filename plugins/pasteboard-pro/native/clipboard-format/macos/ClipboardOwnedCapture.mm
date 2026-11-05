#import "ClipboardOwnedCapture.h"

static void PBFMarkCompatibleUTF16(NSMutableArray<NSDictionary *> *representations) {
    NSDictionary *utf8Representation = nil;
    NSUInteger utf16Index = NSNotFound;
    for (NSUInteger index = 0; index < representations.count; index++) {
        NSDictionary *representation = representations[index];
        NSString *name = representation[@"nativeName"];
        if ([name isEqualToString:PBFFormatUTF8Text]) utf8Representation = representation;
        if ([name isEqualToString:PBFFormatUTF16ExternalText]) utf16Index = index;
    }
    if (!utf8Representation || utf16Index == NSNotFound) return;
    NSString *utf8Text = [[NSString alloc] initWithData:utf8Representation[@"data"] encoding:NSUTF8StringEncoding];
    NSDictionary *analysis = PBFAnalyzeUTF16Compatibility(representations[utf16Index][@"data"], utf8Text);
    if (!utf8Text || !analysis) return;
    NSMutableDictionary *marked = [representations[utf16Index] mutableCopy];
    marked[@"fidelity"] = @"compatible";
    marked[@"derivedFrom"] = PBFFormatUTF8Text;
    [marked addEntriesFromDictionary:analysis];
    representations[utf16Index] = marked;
}

NSDictionary<NSString *, id> *PBFValidateOwnedCapture(
    NSArray<NSDictionary<NSString *, id> *> *ownedItems,
    NSMutableArray<NSDictionary<NSString *, id> *> *unsupported,
    PBFRepresentationValidator validator) {
    NSMutableArray *items = [NSMutableArray arrayWithCapacity:ownedItems.count];
    NSMutableArray *summaries = [NSMutableArray arrayWithCapacity:ownedItems.count];
    uint64_t validBytes = 0;
    for (NSUInteger itemIndex = 0; itemIndex < ownedItems.count; itemIndex++) {
        NSMutableArray *representations = [NSMutableArray array];
        NSMutableArray *representationSummaries = [NSMutableArray array];
        for (NSDictionary *representation in ownedItems[itemIndex][@"representations"]) {
            NSString *nativeName = representation[@"nativeName"];
            NSData *data = representation[@"data"];
            if (!validator(nativeName, data)) {
                [unsupported addObject:PBFUnsupportedFormatRecord(itemIndex, nativeName, @"format_validation_failed")];
                continue;
            }
            validBytes += (uint64_t)data.length;
            [representations addObject:representation];
            [representationSummaries addObject:PBFRepresentationSummary(itemIndex, nativeName, data)];
        }
        PBFMarkCompatibleUTF16(representations);
        [items addObject:@{ @"index" : @(itemIndex), @"representations" : representations }];
        [summaries addObject:@{ @"index" : @(itemIndex), @"representations" : representationSummaries }];
    }
    return @{ @"items" : items, @"summary" : summaries, @"byteLength" : @(validBytes) };
}
