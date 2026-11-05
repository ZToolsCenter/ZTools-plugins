#import "ClipboardCaptureCodecEvidence.h"

#import "ClipboardFormatCodecs.h"

#import <CoreFoundation/CoreFoundation.h>

#include <utility>

namespace {

BOOL ReadBoolean(id raw, BOOL *output) {
    if (![raw isKindOfClass:NSNumber.class] ||
        CFGetTypeID((__bridge CFTypeRef)raw) != CFBooleanGetTypeID() ||
        output == nullptr) {
        return NO;
    }
    *output = [raw boolValue];
    return YES;
}

bool HasTextEvidence(NSDictionary<NSString *, id> *representation) {
    return representation[@"byteOrder"] != nil ||
           representation[@"byteOrderMark"] != nil ||
           representation[@"nullTerminated"] != nil ||
           representation[@"encodingCheck"] != nil;
}

}  // namespace

BOOL PBFBuildCaptureCodecEvidence(
    NSString *nativeName,
    NSDictionary<NSString *, id> *representation,
    clipboard_format_probe::CaptureCodecV2 *output) {
    using clipboard_format_probe::CaptureCodecV2;
    using clipboard_format_probe::CaptureTextEvidenceV2;

    if (![nativeName isKindOfClass:NSString.class] ||
        ![representation isKindOfClass:NSDictionary.class] ||
        output == nullptr) {
        return NO;
    }

    CaptureCodecV2 codec;
    if ([nativeName isEqualToString:PBFFormatUTF8Text] ||
        [nativeName isEqualToString:PBFFormatTSV] ||
        [nativeName isEqualToString:PBFFormatURL] ||
        [nativeName isEqualToString:PBFFormatFileURL]) {
        codec.encoding = "utf-8";
    } else if ([nativeName isEqualToString:PBFFormatHTML]) {
        codec.encoding = "html-utf8";
    } else if ([nativeName isEqualToString:PBFFormatRTF]) {
        codec.encoding = "rtf-bytes";
    } else if ([nativeName isEqualToString:PBFFormatUTF16ExternalText]) {
        codec.encoding = "utf16-external-bytes";
    } else if ([nativeName isEqualToString:PBFFormatPNG]) {
        codec.encoding = "png-bytes";
    } else if ([nativeName isEqualToString:PBFFormatJPEG]) {
        codec.encoding = "jpeg-bytes";
    } else if ([nativeName isEqualToString:PBFFormatTIFF]) {
        codec.encoding = "tiff-bytes";
    } else if ([nativeName isEqualToString:PBFFormatColor]) {
        codec.encoding = "nscolor-secure-archive";
    } else {
        return NO;
    }
    codec.materialization = "owned-pasteboard-data";

    if ([nativeName isEqualToString:PBFFormatUTF16ExternalText] &&
        HasTextEvidence(representation)) {
        NSString *byteOrder = representation[@"byteOrder"];
        NSString *encodingCheck = representation[@"encodingCheck"];
        BOOL byteOrderMark = NO;
        BOOL nullTerminated = NO;
        id rawDerivedFrom = representation[@"derivedFrom"];
        if (![byteOrder isKindOfClass:NSString.class] ||
            ![encodingCheck isKindOfClass:NSString.class] ||
            ![rawDerivedFrom isKindOfClass:NSString.class] ||
            ![rawDerivedFrom isEqualToString:PBFFormatUTF8Text] ||
            !ReadBoolean(representation[@"byteOrderMark"], &byteOrderMark) ||
            !ReadBoolean(representation[@"nullTerminated"], &nullTerminated) ||
            !([encodingCheck isEqualToString:@"decoded-text-matches"] ||
              [encodingCheck isEqualToString:@"canonical-unicode-equivalent"])) {
            return NO;
        }
        CaptureTextEvidenceV2 text;
        if ([byteOrder isEqualToString:@"little-endian"]) {
            text.encoding = "utf-16le";
        } else if ([byteOrder isEqualToString:@"big-endian"]) {
            text.encoding = "utf-16be";
        } else {
            return NO;
        }
        text.byte_order_mark = byteOrderMark;
        text.null_terminated = nullTerminated;
        text.encoding_check = encodingCheck.UTF8String ?: "";
        codec.text = std::move(text);
    }

    *output = std::move(codec);
    return YES;
}
