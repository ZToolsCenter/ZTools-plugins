#import "ClipboardProbeContracts.h"

#include <math.h>

static NSString *const PBFErrorDomain = @"org.ztools.pasteboard-pro.clipboard-format-g0";
NSDictionary<NSString *, id> *PBFResult(NSString *status,
                                                NSDictionary<NSString *, id> *fields) {
    NSMutableDictionary<NSString *, id> *result = [fields mutableCopy];
    result[@"status"] = status;
    return result;
}

NSDictionary<NSString *, id> *PBFPreMutationFailure(NSString *reasonCode) {
    return PBFResult(@"failed", @{ @"reasonCode" : reasonCode,
                                    @"clipboardMayHaveChanged" : @NO });
}

NSError *PBFError(NSInteger code, NSString *message) {
    return [NSError errorWithDomain:PBFErrorDomain
                               code:code
                           userInfo:@{NSLocalizedDescriptionKey : message}];
}

NSDictionary<NSString *, NSNumber *> *PBFDefaultLimits(void) {
    return @{@"maxItems" : @32,
             @"maxFormatsPerItem" : @32,
             @"maxFormatBytes" : @(100ULL * 1024ULL * 1024ULL),
             @"maxTextBytes" : @(10ULL * 1024ULL * 1024ULL),
             @"maxSnapshotBytes" : @(200ULL * 1024ULL * 1024ULL)};
}

static BOOL PBFReadLimit(NSDictionary<NSString *, NSNumber *> *limits,
                         NSString *key,
                         uint64_t *value,
                         NSError **error) {
    id raw = limits[key];
    if (![raw isKindOfClass:NSNumber.class] || CFGetTypeID((__bridge CFTypeRef)raw) == CFBooleanGetTypeID()) {
        if (error) *error = PBFError(1, [NSString stringWithFormat:@"invalid_limit:%@", key]);
        return NO;
    }
    double number = [raw doubleValue];
    if (!isfinite(number) || number < 1 || floor(number) != number || number > 9007199254740991.0) {
        if (error) *error = PBFError(1, [NSString stringWithFormat:@"invalid_limit:%@", key]);
        return NO;
    }
    *value = (uint64_t)number;
    return YES;
}

BOOL PBFResolveLimits(NSDictionary<NSString *, NSNumber *> *limits,
                             uint64_t *maxItems,
                             uint64_t *maxFormats,
                             uint64_t *maxFormatBytes,
                             uint64_t *maxTextBytes,
                             uint64_t *maxSnapshotBytes,
                             NSError **error) {
    NSDictionary *keys = @{@"maxItems" : @((uint64_t)32),
                           @"maxFormatsPerItem" : @((uint64_t)32),
                           @"maxFormatBytes" : @(100ULL * 1024ULL * 1024ULL),
                           @"maxTextBytes" : @(10ULL * 1024ULL * 1024ULL),
                           @"maxSnapshotBytes" : @(200ULL * 1024ULL * 1024ULL)};
    uint64_t *destinations[] = {maxItems, maxFormats, maxFormatBytes, maxTextBytes, maxSnapshotBytes};
    NSArray<NSString *> *orderedKeys = @[@"maxItems", @"maxFormatsPerItem", @"maxFormatBytes", @"maxTextBytes", @"maxSnapshotBytes"];
    for (NSUInteger index = 0; index < orderedKeys.count; index++) {
        NSString *key = orderedKeys[index];
        uint64_t parsed = 0;
        if (!PBFReadLimit(limits, key, &parsed, error) || parsed > [keys[key] unsignedLongLongValue]) {
            if (error && !*error) *error = PBFError(1, [NSString stringWithFormat:@"limit_exceeds_hard_max:%@", key]);
            return NO;
        }
        *destinations[index] = parsed;
    }
    return YES;
}

BOOL PBFReadRevision(id raw, NSInteger *revision) {
    if (![raw isKindOfClass:NSNumber.class] || CFGetTypeID((__bridge CFTypeRef)raw) == CFBooleanGetTypeID()) return NO;
    double number = [raw doubleValue];
    if (!isfinite(number) || number < 0 || floor(number) != number || number > 9007199254740991.0) return NO;
    *revision = (NSInteger)number;
    return YES;
}
