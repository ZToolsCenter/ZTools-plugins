#import <Foundation/Foundation.h>

#include "../common/clipboard_capture_codec.h"

NS_ASSUME_NONNULL_BEGIN

FOUNDATION_EXPORT BOOL PBFBuildCaptureCodecEvidence(
    NSString *nativeName,
    NSDictionary<NSString *, id> *representation,
    clipboard_format_probe::CaptureCodecV2 *output);

NS_ASSUME_NONNULL_END
