#import <AppKit/AppKit.h>

NS_ASSUME_NONNULL_BEGIN

FOUNDATION_EXPORT NSString *const PBFFormatUTF8Text;
FOUNDATION_EXPORT NSString *const PBFFormatUTF16ExternalText;
FOUNDATION_EXPORT NSString *const PBFFormatHTML;
FOUNDATION_EXPORT NSString *const PBFFormatRTF;
FOUNDATION_EXPORT NSString *const PBFFormatPNG;
FOUNDATION_EXPORT NSString *const PBFFormatJPEG;
FOUNDATION_EXPORT NSString *const PBFFormatTIFF;
FOUNDATION_EXPORT NSString *const PBFFormatURL;
FOUNDATION_EXPORT NSString *const PBFFormatFileURL;
FOUNDATION_EXPORT NSString *const PBFFormatTSV;
FOUNDATION_EXPORT NSString *const PBFFormatColor;

FOUNDATION_EXPORT BOOL PBFCodecIsValidNativeName(id nativeName);
FOUNDATION_EXPORT BOOL PBFCodecSupportsNativeName(NSString *nativeName);
FOUNDATION_EXPORT BOOL PBFCodecIsTextNativeName(NSString *nativeName);
FOUNDATION_EXPORT BOOL PBFCodecValidateRepresentation(NSString *nativeName, NSData *data);
FOUNDATION_EXPORT BOOL PBFCodecImageFrameBudgetAllows(uint64_t width,
                                                      uint64_t height,
                                                      uint64_t accumulatedEstimate,
                                                      uint64_t *nextEstimate);
FOUNDATION_EXPORT NSDictionary<NSString *, id> *PBFCodecReportMetadata(NSString *nativeName);
FOUNDATION_EXPORT NSDictionary<NSString *, id> * _Nullable PBFAnalyzeUTF16Compatibility(
    NSData *data,
    NSString *expectedText);

NS_ASSUME_NONNULL_END
