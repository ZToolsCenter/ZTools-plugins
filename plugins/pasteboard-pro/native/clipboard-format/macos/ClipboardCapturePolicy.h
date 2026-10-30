#import <Foundation/Foundation.h>

NS_ASSUME_NONNULL_BEGIN

// G0 preflight only. No trusted producer API or content scan is provided here.
FOUNDATION_EXPORT NSDictionary<NSString *, id> *PBFDefaultCapturePolicy(void);
FOUNDATION_EXPORT NSDictionary<NSString *, id> *_Nullable PBFNormalizeCapturePolicy(id _Nullable policy);
FOUNDATION_EXPORT NSDictionary<NSString *, id> *PBFEvaluateMacCapturePolicy(
    NSDictionary<NSString *, id> *normalizedPolicy,
    NSArray<NSArray<NSString *> *> *itemTypes,
    NSString *_Nullable frontmostBundleIdentifierHint);
FOUNDATION_EXPORT BOOL PBFIsCapturePolicyMetadataType(NSString *name);

NS_ASSUME_NONNULL_END
