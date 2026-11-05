#import "ClipboardFormatCodecs.h"

NS_ASSUME_NONNULL_BEGIN

FOUNDATION_EXPORT NSDictionary<NSString *, NSNumber *> *PBFDefaultLimits(void);
FOUNDATION_EXPORT BOOL PBFIsReservedPasteboardName(NSString *name);
FOUNDATION_EXPORT NSDictionary<NSString *, id> *PBFUnsupportedFormatRecord(
    NSUInteger itemIndex,
    id nativeName,
    NSString *reasonCode);
FOUNDATION_EXPORT NSDictionary<NSString *, id> *PBFCapture(
    NSPasteboard * _Nullable pasteboard,
    NSDictionary<NSString *, NSNumber *> *limits,
    NSNumber *_Nullable expectedRevision);
// Source hints are informational only and cannot establish a producer identity.
typedef NSData *_Nullable (^PBFOrdinaryDataReader)(NSPasteboardItem *item, NSPasteboardType nativeName);
typedef NSString *_Nullable (^PBFSourceHintProvider)(void);
typedef BOOL (^PBFRepresentationValidator)(NSString *nativeName, NSData *data);
FOUNDATION_EXPORT NSDictionary<NSString *, id> *PBFCaptureWithPolicy(
    NSPasteboard *_Nullable pasteboard,
    NSDictionary<NSString *, NSNumber *> *limits,
    NSNumber *_Nullable expectedRevision,
    NSDictionary<NSString *, id> *policy);
FOUNDATION_EXPORT NSDictionary<NSString *, id> *PBFCaptureForTestingWithPolicy(
    NSPasteboard *_Nullable pasteboard,
    NSDictionary<NSString *, NSNumber *> *limits,
    NSNumber *_Nullable expectedRevision,
    NSDictionary<NSString *, id> *policy,
    PBFOrdinaryDataReader reader,
    PBFSourceHintProvider hintProvider);
// Testing seam; validation receives owned bytes only, after materialization ends.
FOUNDATION_EXPORT NSDictionary<NSString *, id> *PBFCaptureForTestingWithProviders(
    NSPasteboard *_Nullable pasteboard,
    NSDictionary<NSString *, NSNumber *> *limits,
    NSNumber *_Nullable expectedRevision,
    NSDictionary<NSString *, id> *policy,
    PBFOrdinaryDataReader reader,
    PBFSourceHintProvider hintProvider,
    PBFRepresentationValidator validator);
FOUNDATION_EXPORT NSDictionary<NSString *, id> *PBFPublish(
    NSPasteboard * _Nullable pasteboard,
    NSDictionary<NSString *, id> *plan,
    NSDictionary<NSString *, NSNumber *> *limits);
typedef NSDictionary<NSString *, id> * _Nonnull (*PBFReadbackProvider)(
    NSPasteboard *pasteboard,
    NSDictionary<NSString *, NSNumber *> *limits,
    NSNumber *expectedRevision);
FOUNDATION_EXPORT NSDictionary<NSString *, id> *PBFPublishForTestingWithReadbackProvider(
    NSPasteboard * _Nullable pasteboard,
    NSDictionary<NSString *, id> *plan,
    NSDictionary<NSString *, NSNumber *> *limits,
    PBFReadbackProvider readbackProvider);
FOUNDATION_EXPORT NSDictionary<NSString *, id> *PBFRepresentationSummary(
    NSUInteger itemIndex,
    NSString *nativeName,
    NSData *data);
FOUNDATION_EXPORT NSDictionary<NSString *, id> *PBFRunBoundaryTests(
    NSPasteboard *pasteboard,
    NSDictionary<NSString *, NSNumber *> *limits,
    NSArray<NSDictionary<NSString *, id> *> *fixtures,
    NSMutableArray<NSDictionary<NSString *, id> *> *cases);
FOUNDATION_EXPORT NSDictionary<NSString *, id> *PBFRunExtendedFormatTests(
    NSPasteboard *pasteboard,
    NSDictionary<NSString *, NSNumber *> *limits,
    NSMutableArray<NSDictionary<NSString *, id> *> *cases);
FOUNDATION_EXPORT NSDictionary<NSString *, id> *PBFSelfTest(void);

NS_ASSUME_NONNULL_END
