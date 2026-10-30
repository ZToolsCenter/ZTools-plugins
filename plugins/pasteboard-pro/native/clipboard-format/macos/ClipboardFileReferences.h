#import <Foundation/Foundation.h>

NS_ASSUME_NONNULL_BEGIN

// Returns a fixed reason code when any file URL in a publish plan is not
// locally reachable. This checks metadata and permissions only, never contents.
FOUNDATION_EXPORT NSString * _Nullable PBFFileReferenceAvailabilityFailure(NSArray *items);

NS_ASSUME_NONNULL_END
