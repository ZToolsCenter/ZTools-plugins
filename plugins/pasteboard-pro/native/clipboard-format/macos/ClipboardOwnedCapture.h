#import "ClipboardProbe.h"

NS_ASSUME_NONNULL_BEGIN

// No NSPasteboard access: validate and summarize the immutable materialized bytes.
FOUNDATION_EXPORT NSDictionary<NSString *, id> *PBFValidateOwnedCapture(
    NSArray<NSDictionary<NSString *, id> *> *ownedItems,
    NSMutableArray<NSDictionary<NSString *, id> *> *unsupported,
    PBFRepresentationValidator validator);

NS_ASSUME_NONNULL_END
