#import "ClipboardURLCodecs.h"

#include "../common/clipboard_uri_syntax.h"

#include <string>

static const NSUInteger PBFStoredURLMaximumUTF8Bytes = 64 * 1024;

BOOL PBFCodecValidateStoredURL(NSData *data) {
    if (![data isKindOfClass:NSData.class] || data.length == 0 ||
        data.length > PBFStoredURLMaximumUTF8Bytes) {
        return NO;
    }

    NSString *raw = [[NSString alloc] initWithData:data encoding:NSUTF8StringEncoding];
    if (raw == nil) return NO;
    NSData *roundTrip = [raw dataUsingEncoding:NSUTF8StringEncoding allowLossyConversion:NO];
    if (![roundTrip isEqualToData:data]) return NO;

    std::u16string codeUnits;
    codeUnits.reserve(raw.length);
    for (NSUInteger index = 0; index < raw.length; ++index) {
        codeUnits.push_back(static_cast<char16_t>([raw characterAtIndex:index]));
    }
    return clipboard_codecs::IsValidStoredAbsoluteUri(codeUnits) ? YES : NO;
}
