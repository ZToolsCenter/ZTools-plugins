#import <Foundation/Foundation.h>

NS_ASSUME_NONNULL_BEGIN

// Shared request validation and fixed result construction for capture/publish.
FOUNDATION_EXPORT NSError *PBFError(NSInteger code, NSString *message);
FOUNDATION_EXPORT NSDictionary<NSString *, NSNumber *> *PBFDefaultLimits(void);
FOUNDATION_EXPORT BOOL PBFReadRevision(id raw, NSInteger *revision);
FOUNDATION_EXPORT BOOL PBFResolveLimits(
    NSDictionary<NSString *, NSNumber *> *limits,
    uint64_t *maxItems, uint64_t *maxFormats, uint64_t *maxFormatBytes,
    uint64_t *maxTextBytes, uint64_t *maxSnapshotBytes, NSError **error);
FOUNDATION_EXPORT NSDictionary<NSString *, id> *PBFResult(
    NSString *status, NSDictionary<NSString *, id> *fields);
FOUNDATION_EXPORT NSDictionary<NSString *, id> *PBFPreMutationFailure(NSString *reasonCode);

NS_ASSUME_NONNULL_END
