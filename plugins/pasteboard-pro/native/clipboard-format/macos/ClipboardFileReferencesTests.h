#import "ClipboardProbe.h"

NS_ASSUME_NONNULL_BEGIN

FOUNDATION_EXPORT BOOL PBFRunFileReferencePublishTests(
    NSPasteboard *pasteboard,
    NSDictionary<NSString *, NSNumber *> *limits,
    NSMutableArray *plannedSummary,
    NSMutableArray *capturedSummary,
    NSMutableArray<NSDictionary<NSString *, id> *> *cases);

NS_ASSUME_NONNULL_END
