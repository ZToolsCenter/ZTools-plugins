#import "ClipboardProbeArchiveTests.h"

#import "ClipboardFormatCodecs.h"

#import <AppKit/AppKit.h>

static void PBFAddArchiveCase(NSMutableArray<NSDictionary<NSString *, id> *> *cases,
                              NSString *identifier,
                              BOOL passed) {
    [cases addObject:@{@"id" : identifier,
                       @"status" : passed ? @"pass" : @"fail",
                       @"detailCode" : passed ? @"case-passed" : @"case-failed"}];
}

static NSMutableDictionary *PBFObjectContainingKey(NSArray *objects, NSString *key) {
    for (id object in objects) {
        if ([object isKindOfClass:NSMutableDictionary.class] && object[key] != nil) return object;
    }
    return nil;
}

static NSMutableDictionary *PBFColorClassDescription(NSArray *objects) {
    for (id object in objects) {
        if (![object isKindOfClass:NSMutableDictionary.class]) continue;
        if ([object[@"$classname"] isKindOfClass:NSString.class] &&
            [object[@"$classname"] isEqualToString:@"NSColor"]) return object;
    }
    return nil;
}

static NSData *PBFMalformedColorArchive(NSData *baseArchive, NSString *mutation) {
    NSPropertyListFormat format = NSPropertyListOpenStepFormat;
    NSMutableDictionary *archive = [[NSPropertyListSerialization propertyListWithData:baseArchive
                                                                              options:NSPropertyListMutableContainersAndLeaves
                                                                               format:&format
                                                                                error:nil] mutableCopy];
    if (format != NSPropertyListBinaryFormat_v1_0 || !archive) return nil;
    NSMutableArray *objects = archive[@"$objects"];
    NSMutableDictionary *color = PBFObjectContainingKey(objects, @"NSComponents");
    NSMutableDictionary *space = PBFObjectContainingKey(objects, @"NSID");
    NSMutableDictionary *colorClass = PBFColorClassDescription(objects);
    NSMutableDictionary *top = archive[@"$top"];
    if (!objects || !color || !space || !colorClass || !top) return nil;
    NSUInteger spaceIndex = [objects indexOfObjectIdenticalTo:space];
    NSUInteger colorClassIndex = [objects indexOfObjectIdenticalTo:colorClass];
    if (spaceIndex == NSNotFound || colorClassIndex == NSNotFound) return nil;

    if ([mutation isEqualToString:@"archiver"]) archive[@"$archiver"] = @7;
    else if ([mutation isEqualToString:@"version"]) archive[@"$version"] = @"100000";
    else if ([mutation isEqualToString:@"objects-container"]) archive[@"$objects"] = @"wrong-type";
    else if ([mutation isEqualToString:@"objects-first"]) objects[0] = @7;
    else if ([mutation isEqualToString:@"top-container"]) archive[@"$top"] = @"wrong-type";
    else if ([mutation isEqualToString:@"top-root"]) top[@"root"] = @7;
    else if ([mutation isEqualToString:@"classname"]) colorClass[@"$classname"] = @7;
    else if ([mutation isEqualToString:@"classes"]) colorClass[@"$classes"] = @7;
    else if ([mutation isEqualToString:@"color-class"]) color[@"$class"] = @7;
    else if ([mutation isEqualToString:@"components"]) color[@"NSComponents"] = @7;
    else if ([mutation isEqualToString:@"rgb"]) color[@"NSRGB"] = @7;
    else if ([mutation isEqualToString:@"linear-exposure"]) color[@"NSLinearExposure"] = @7;
    else if ([mutation isEqualToString:@"color-space"]) color[@"NSColorSpace"] = @"1";
    else if ([mutation isEqualToString:@"color-space-id"]) space[@"NSID"] = @"7";
    else if ([mutation isEqualToString:@"icc-reference"]) space[@"NSICC"] = @7;
    else if ([mutation isEqualToString:@"color-space-object"]) objects[spaceIndex] = @7;
    else if ([mutation isEqualToString:@"color-class-description"]) objects[colorClassIndex] = @7;
    else if ([mutation isEqualToString:@"icc-object-data"]) {
        NSUInteger profileIndex = NSNotFound;
        for (NSUInteger index = 0; index < objects.count; index++) {
            if ([objects[index] isKindOfClass:NSData.class] && [objects[index] length] > 128) profileIndex = index;
        }
        if (profileIndex == NSNotFound) return nil;
        objects[profileIndex] = @7;
    }
    else return nil;

    return [NSPropertyListSerialization dataWithPropertyList:archive
                                                      format:NSPropertyListBinaryFormat_v1_0
                                                     options:0
                                                       error:nil];
}

BOOL PBFTestMalformedColorArchiveTypes(NSMutableArray<NSDictionary<NSString *, id> *> *cases) {
    NSError *error = nil;
    NSColor *color = [NSColor colorWithSRGBRed:0.15 green:0.35 blue:0.65 alpha:0.85];
    NSData *base = [NSKeyedArchiver archivedDataWithRootObject:color
                                         requiringSecureCoding:YES
                                                         error:&error];
    BOOL baseAccepted = NO;
    @try {
        baseAccepted = base.length > 0 && PBFCodecValidateRepresentation(PBFFormatColor, base);
    } @catch (NSException *exception) {
        (void)exception;
    }
    NSArray<NSString *> *mutations = @[@"archiver", @"version", @"objects-container", @"objects-first",
                                        @"top-container", @"top-root", @"classname", @"classes", @"color-class",
                                        @"components", @"rgb", @"linear-exposure", @"color-space",
                                        @"color-space-id", @"icc-reference", @"color-space-object",
                                        @"color-class-description", @"icc-object-data"];
    BOOL rejectedAll = error == nil && baseAccepted;
    for (NSString *mutation in mutations) {
        NSData *malformed = PBFMalformedColorArchive(base, mutation);
        BOOL rejected = NO;
        @try {
            rejected = malformed.length > 0 && !PBFCodecValidateRepresentation(PBFFormatColor, malformed);
        } @catch (NSException *exception) {
            (void)exception;
            rejected = NO;
        }
        rejectedAll = rejectedAll && rejected;
    }
    PBFAddArchiveCase(cases, @"color-malformed-plist-types-rejected", rejectedAll);
    return rejectedAll;
}
