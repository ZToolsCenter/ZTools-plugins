#import "ClipboardFormatCodecs.h"
#import "ClipboardURLCodecs.h"
#include "../common/clipboard_rtf.h"

#import <CoreGraphics/CoreGraphics.h>
#import <CoreFoundation/CoreFoundation.h>
#import <ImageIO/ImageIO.h>
#import <ctype.h>
#import <math.h>
#import <time.h>

NSString *const PBFFormatUTF8Text = NSPasteboardTypeString;
NSString *const PBFFormatUTF16ExternalText = @"public.utf16-external-plain-text";
NSString *const PBFFormatHTML = NSPasteboardTypeHTML;
NSString *const PBFFormatRTF = NSPasteboardTypeRTF;
NSString *const PBFFormatPNG = NSPasteboardTypePNG;
NSString *const PBFFormatJPEG = @"public.jpeg";
NSString *const PBFFormatTIFF = NSPasteboardTypeTIFF;
NSString *const PBFFormatURL = NSPasteboardTypeURL;
NSString *const PBFFormatFileURL = NSPasteboardTypeFileURL;
NSString *const PBFFormatTSV = NSPasteboardTypeTabularText;
NSString *const PBFFormatColor = NSPasteboardTypeColor;

static const uint64_t PBFCodecMaxURLBytes = 64ULL * 1024ULL;
static const uint64_t PBFCodecMaxColorArchiveBytes = 1024ULL * 1024ULL;
static const uint64_t PBFCodecMaxImageBytes = 100ULL * 1024ULL * 1024ULL;
static const uint64_t PBFCodecMaxImagePixels = 32ULL * 1024ULL * 1024ULL;
static const uint64_t PBFCodecMaxImageSide = 8192ULL;
static const uint64_t PBFCodecMaxDecodedImageBytes = 256ULL * 1024ULL * 1024ULL;
static const uint64_t PBFCodecEstimatedBytesPerPixel = 8ULL;
static const double PBFCodecMaxImageDecodeWallSeconds = 5.0;
static const double PBFCodecMaxImageDecodeCPUSeconds = 2.0;
static const size_t PBFCodecMaxImageFrames = 8;
static const uint64_t PBFCodecMaxTextBytes = 10ULL * 1024ULL * 1024ULL;

BOOL PBFCodecIsValidNativeName(id nativeName) {
    if (![nativeName isKindOfClass:NSString.class] ||
        [nativeName length] == 0 || [nativeName length] > 512) return NO;
    return [nativeName rangeOfCharacterFromSet:NSCharacterSet.controlCharacterSet].location == NSNotFound;
}

BOOL PBFCodecSupportsNativeName(NSString *nativeName) {
    return [nativeName isEqualToString:PBFFormatUTF8Text] ||
           [nativeName isEqualToString:PBFFormatUTF16ExternalText] ||
           [nativeName isEqualToString:PBFFormatHTML] ||
           [nativeName isEqualToString:PBFFormatRTF] ||
           [nativeName isEqualToString:PBFFormatPNG] ||
           [nativeName isEqualToString:PBFFormatJPEG] ||
           [nativeName isEqualToString:PBFFormatTIFF] ||
           [nativeName isEqualToString:PBFFormatURL] ||
           [nativeName isEqualToString:PBFFormatFileURL] ||
           [nativeName isEqualToString:PBFFormatTSV] ||
           [nativeName isEqualToString:PBFFormatColor];
}

BOOL PBFCodecIsTextNativeName(NSString *nativeName) {
    return [nativeName isEqualToString:PBFFormatUTF8Text] ||
           [nativeName isEqualToString:PBFFormatUTF16ExternalText] ||
           [nativeName isEqualToString:PBFFormatHTML] ||
           [nativeName isEqualToString:PBFFormatRTF] ||
           [nativeName isEqualToString:PBFFormatTSV];
}

NSDictionary<NSString *, id> *PBFCodecReportMetadata(NSString *nativeName) {
    if ([nativeName isEqualToString:PBFFormatJPEG]) return @{@"formatKind" : @"image", @"codec" : @"imageio-jpeg"};
    if ([nativeName isEqualToString:PBFFormatTIFF]) return @{@"formatKind" : @"image", @"codec" : @"imageio-tiff"};
    if ([nativeName isEqualToString:PBFFormatURL]) return @{@"formatKind" : @"url", @"codec" : @"url-utf8"};
    if ([nativeName isEqualToString:PBFFormatFileURL]) {
        return @{@"formatKind" : @"file-reference", @"codec" : @"file-url-utf8", @"fidelity" : @"reference"};
    }
    if ([nativeName isEqualToString:PBFFormatTSV]) return @{@"formatKind" : @"tabular-text", @"codec" : @"utf8-tsv"};
    if ([nativeName isEqualToString:PBFFormatColor]) {
        return @{@"formatKind" : @"color", @"codec" : @"nscolor-secure-archive"};
    }
    return @{};
}

NSDictionary<NSString *, id> *PBFAnalyzeUTF16Compatibility(NSData *data, NSString *expectedText) {
    if (data.length < sizeof(unichar)) return nil;
    const uint8_t *bytes = (const uint8_t *)data.bytes;
    NSUInteger offset = 0;
    NSString *bomOrder = nil;
    NSStringEncoding bomEncoding = 0;
    if (data.length >= 2 && bytes[0] == 0xFF && bytes[1] == 0xFE) {
        offset = 2;
        bomOrder = @"little-endian";
        bomEncoding = NSUTF16LittleEndianStringEncoding;
    } else if (data.length >= 2 && bytes[0] == 0xFE && bytes[1] == 0xFF) {
        offset = 2;
        bomOrder = @"big-endian";
        bomEncoding = NSUTF16BigEndianStringEncoding;
    }
    NSUInteger payloadLength = data.length - offset;
    if (payloadLength == 0 || payloadLength % sizeof(unichar) != 0) return nil;
    NSData *payload = offset == 0 ? data : [data subdataWithRange:NSMakeRange(offset, payloadLength)];
    NSArray<NSNumber *> *encodings = bomOrder ? @[@(bomEncoding)] :
        @[@(NSUTF16LittleEndianStringEncoding), @(NSUTF16BigEndianStringEncoding)];
    NSString *normalizedExpected = [expectedText precomposedStringWithCanonicalMapping];
    for (NSNumber *encoding in encodings) {
        NSString *decoded = [[NSString alloc] initWithData:payload encoding:encoding.unsignedIntegerValue];
        if (!decoded) continue;
        BOOL terminated = [decoded hasSuffix:@"\0"];
        NSArray<NSNumber *> *trimOptions = terminated ? @[@NO, @YES] : @[@NO];
        for (NSNumber *trim in trimOptions) {
            NSString *candidate = decoded;
            if (trim.boolValue) candidate = [decoded substringToIndex:decoded.length - 1];
            NSString *encodingCheck = nil;
            if ([candidate isEqualToString:expectedText]) {
                encodingCheck = @"decoded-text-matches";
            } else if ([[candidate precomposedStringWithCanonicalMapping] isEqualToString:normalizedExpected]) {
                encodingCheck = @"canonical-unicode-equivalent";
            }
            if (encodingCheck) {
                NSString *byteOrder = bomOrder ?:
                    (encoding.unsignedIntegerValue == NSUTF16LittleEndianStringEncoding ? @"little-endian" : @"big-endian");
                return @{@"encodingCheck" : encodingCheck,
                         @"byteOrder" : byteOrder,
                         @"byteOrderMark" : @(bomOrder != nil),
                         @"nullTerminated" : @(trim.boolValue)};
            }
        }
    }
    return nil;
}

static BOOL PBFValidateFileURL(NSData *data) {
    if (data.length == 0 || data.length > PBFCodecMaxURLBytes) return NO;
    NSString *raw = [[NSString alloc] initWithData:data encoding:NSUTF8StringEncoding];
    if (!raw || [raw rangeOfCharacterFromSet:NSCharacterSet.controlCharacterSet].location != NSNotFound) return NO;
    NSURLComponents *components = [NSURLComponents componentsWithString:raw];
    NSString *host = components.host.lowercaseString;
    BOOL localHost = host.length == 0 || [host isEqualToString:@"localhost"];
    return [components.scheme.lowercaseString isEqualToString:@"file"] &&
           localHost && components.user.length == 0 && components.password.length == 0 &&
           components.query.length == 0 && components.fragment.length == 0 &&
           components.path.length > 0 && [components.path hasPrefix:@"/"] &&
           components.URL.isFileURL;
}

static BOOL PBFValidateTSV(NSData *data) {
    if (data.length == 0 || data.length > PBFCodecMaxTextBytes) return NO;
    NSString *text = [[NSString alloc] initWithData:data encoding:NSUTF8StringEncoding];
    if (!text) return NO;
    NSMutableCharacterSet *disallowedControls = [NSCharacterSet.controlCharacterSet mutableCopy];
    [disallowedControls removeCharactersInString:@"\t\r\n"];
    return [text rangeOfCharacterFromSet:disallowedControls].location == NSNotFound;
}

BOOL PBFCodecImageFrameBudgetAllows(uint64_t width,
                                    uint64_t height,
                                    uint64_t accumulatedEstimate,
                                    uint64_t *nextEstimate) {
    if (width == 0 || height == 0 || width > PBFCodecMaxImageSide || height > PBFCodecMaxImageSide ||
        width > PBFCodecMaxImagePixels / height || accumulatedEstimate > PBFCodecMaxDecodedImageBytes) return NO;
    uint64_t pixels = width * height;
    if (pixels > UINT64_MAX / PBFCodecEstimatedBytesPerPixel) return NO;
    uint64_t frameEstimate = pixels * PBFCodecEstimatedBytesPerPixel;
    if (frameEstimate > PBFCodecMaxDecodedImageBytes ||
        accumulatedEstimate > PBFCodecMaxDecodedImageBytes - frameEstimate) return NO;
    if (nextEstimate) *nextEstimate = accumulatedEstimate + frameEstimate;
    return YES;
}

static double PBFSecondsBetween(const struct timespec *start, const struct timespec *end) {
    return (double)(end->tv_sec - start->tv_sec) + (double)(end->tv_nsec - start->tv_nsec) / 1000000000.0;
}

static BOOL PBFImageDecodeBudgetExceeded(const struct timespec *wallStart,
                                         const struct timespec *cpuStart) {
    struct timespec wallNow = {};
    struct timespec cpuNow = {};
    if (clock_gettime(CLOCK_MONOTONIC, &wallNow) != 0 ||
        clock_gettime(CLOCK_PROCESS_CPUTIME_ID, &cpuNow) != 0) return YES;
    return PBFSecondsBetween(wallStart, &wallNow) > PBFCodecMaxImageDecodeWallSeconds ||
           PBFSecondsBetween(cpuStart, &cpuNow) > PBFCodecMaxImageDecodeCPUSeconds;
}

static BOOL PBFAccumulateActualImageBytes(CGImageRef image, uint64_t *totalBytes) {
    uint64_t bytesPerRow = (uint64_t)CGImageGetBytesPerRow(image);
    uint64_t height = (uint64_t)CGImageGetHeight(image);
    if (bytesPerRow == 0 || height == 0 || bytesPerRow > UINT64_MAX / height) return NO;
    uint64_t frameBytes = bytesPerRow * height;
    if (frameBytes > PBFCodecMaxDecodedImageBytes ||
        *totalBytes > PBFCodecMaxDecodedImageBytes - frameBytes) return NO;
    *totalBytes += frameBytes;
    return YES;
}

static BOOL PBFValidateImage(NSData *data, NSString *expectedType) {
    if (data.length == 0 || data.length > PBFCodecMaxImageBytes) return NO;
    struct timespec wallStart = {};
    struct timespec cpuStart = {};
    if (clock_gettime(CLOCK_MONOTONIC, &wallStart) != 0 ||
        clock_gettime(CLOCK_PROCESS_CPUTIME_ID, &cpuStart) != 0) return NO;
    // These post-call process CPU samples do not interrupt ImageIO; the external runner enforces a deadline and observed RSS guard.
    if (PBFImageDecodeBudgetExceeded(&wallStart, &cpuStart)) return NO;
    CGImageSourceRef source = CGImageSourceCreateWithData((__bridge CFDataRef)data, NULL);
    if (!source) return NO;
    if (PBFImageDecodeBudgetExceeded(&wallStart, &cpuStart)) {
        CFRelease(source);
        return NO;
    }
    BOOL valid = NO;
    CFStringRef sourceType = CGImageSourceGetType(source);
    size_t frameCount = CGImageSourceGetCount(source);
    if (PBFImageDecodeBudgetExceeded(&wallStart, &cpuStart)) {
        CFRelease(source);
        return NO;
    }
    BOOL tiff = [expectedType isEqualToString:PBFFormatTIFF];
    if (!sourceType || !CFEqual(sourceType, (__bridge CFStringRef)expectedType) || frameCount == 0 ||
        (tiff ? frameCount > PBFCodecMaxImageFrames : frameCount != 1)) {
        CFRelease(source);
        return NO;
    }

    uint64_t totalPixels = 0;
    uint64_t estimatedDecodedBytes = 0;
    uint64_t actualDecodedBytes = 0;
    valid = YES;
    for (size_t index = 0; index < frameCount && valid; index++) {
        if (PBFImageDecodeBudgetExceeded(&wallStart, &cpuStart)) {
            valid = NO;
            break;
        }
        NSDictionary *properties = CFBridgingRelease(CGImageSourceCopyPropertiesAtIndex(source, index, NULL));
        if (PBFImageDecodeBudgetExceeded(&wallStart, &cpuStart)) {
            valid = NO;
            break;
        }
        uint64_t width = [properties[(NSString *)kCGImagePropertyPixelWidth] unsignedLongLongValue];
        uint64_t height = [properties[(NSString *)kCGImagePropertyPixelHeight] unsignedLongLongValue];
        uint64_t nextEstimate = 0;
        if (!PBFCodecImageFrameBudgetAllows(width, height, estimatedDecodedBytes, &nextEstimate) ||
            width > PBFCodecMaxImagePixels / height || totalPixels > PBFCodecMaxImagePixels - width * height) {
            valid = NO;
            break;
        }
        totalPixels += width * height;
        estimatedDecodedBytes = nextEstimate;
        if (PBFImageDecodeBudgetExceeded(&wallStart, &cpuStart)) {
            valid = NO;
            break;
        }
        CGImageRef image = CGImageSourceCreateImageAtIndex(source, index, NULL);
        if (PBFImageDecodeBudgetExceeded(&wallStart, &cpuStart)) valid = NO;
        valid = valid && image != NULL && PBFAccumulateActualImageBytes(image, &actualDecodedBytes);
        if (image) CGImageRelease(image);
    }
    CFRelease(source);
    return valid;
}

static BOOL PBFDictionaryHasExactKeys(NSDictionary *dictionary, NSArray<NSString *> *keys) {
    if (![dictionary isKindOfClass:NSDictionary.class] || dictionary.count != keys.count) return NO;
    NSSet *expected = [NSSet setWithArray:keys];
    for (id key in dictionary) {
        if (![key isKindOfClass:NSString.class] || ![expected containsObject:key]) return NO;
    }
    return YES;
}

static BOOL PBFArchiveIntegerEquals(id value, int64_t expected) {
    if (![value isKindOfClass:NSNumber.class]) return NO;
    CFTypeRef number = (__bridge CFTypeRef)value;
    if (CFGetTypeID(number) != CFNumberGetTypeID() ||
        CFNumberIsFloatType((CFNumberRef)number)) return NO;
    return [value longLongValue] == expected;
}

static BOOL PBFArchiveUIDIndex(id value, NSUInteger objectCount, NSUInteger *indexOut) {
    if (!PBFDictionaryHasExactKeys(value, @[@"PBF_UID"])) return NO;
    id rawIndex = value[@"PBF_UID"];
    if (![rawIndex isKindOfClass:NSNumber.class]) return NO;
    CFTypeRef number = (__bridge CFTypeRef)rawIndex;
    if (CFGetTypeID(number) != CFNumberGetTypeID() || CFNumberIsFloatType((CFNumberRef)number)) return NO;
    long long signedIndex = [rawIndex longLongValue];
    if (signedIndex < 0 || (unsigned long long)signedIndex >= objectCount) return NO;
    if (indexOut) *indexOut = (NSUInteger)signedIndex;
    return YES;
}

static BOOL PBFColorClassDescription(NSArray *objects, NSUInteger index, NSString *expectedName) {
    if (index >= objects.count) return NO;
    NSDictionary *description = objects[index];
    if (!PBFDictionaryHasExactKeys(description, @[@"$classname", @"$classes"])) return NO;
    id className = description[@"$classname"];
    id classes = description[@"$classes"];
    return [className isKindOfClass:NSString.class] && [className isEqualToString:expectedName] &&
           [classes isKindOfClass:NSArray.class] && [classes isEqual:@[expectedName, @"NSObject"]];
}

static BOOL PBFValidateColorNumericData(NSData *data, NSUInteger expectedCount, double maximum) {
    if (![data isKindOfClass:NSData.class] || data.length == 0 || data.length > 128) return NO;
    const uint8_t *bytes = (const uint8_t *)data.bytes;
    NSUInteger length = data.length;
    if (bytes[length - 1] == 0) length--;
    for (NSUInteger index = 0; index < length; index++) {
        uint8_t byte = bytes[index];
        if (byte == 0 || !(isdigit(byte) || byte == '.' || byte == '+' || byte == '-' ||
                           byte == 'e' || byte == 'E' || byte == ' ')) return NO;
    }
    NSString *string = [[NSString alloc] initWithBytes:bytes length:length encoding:NSASCIIStringEncoding];
    if (!string) return NO;
    NSArray<NSString *> *tokens = [string componentsSeparatedByCharactersInSet:NSCharacterSet.whitespaceCharacterSet];
    NSMutableArray<NSString *> *numbers = [NSMutableArray array];
    for (NSString *token in tokens) if (token.length > 0) [numbers addObject:token];
    if (numbers.count != expectedCount) return NO;
    for (NSString *token in numbers) {
        NSScanner *scanner = [NSScanner scannerWithString:token];
        scanner.locale = [NSLocale localeWithLocaleIdentifier:@"en_US_POSIX"];
        double value = 0;
        if (![scanner scanDouble:&value] || !scanner.isAtEnd || !isfinite(value) || value < 0 || value > maximum) return NO;
    }
    return YES;
}

static BOOL PBFValidateICCProfile(NSData *data) {
    if (![data isKindOfClass:NSData.class] || data.length < 128 || data.length > PBFCodecMaxColorArchiveBytes) return NO;
    const uint8_t *bytes = (const uint8_t *)data.bytes;
    uint32_t declaredLength = ((uint32_t)bytes[0] << 24) | ((uint32_t)bytes[1] << 16) |
                              ((uint32_t)bytes[2] << 8) | (uint32_t)bytes[3];
    return declaredLength == data.length && bytes[36] == 'a' && bytes[37] == 'c' &&
           bytes[38] == 's' && bytes[39] == 'p';
}

static NSDictionary *PBFParseBoundedColorArchive(NSData *data) {
    if (data.length == 0 || data.length > PBFCodecMaxColorArchiveBytes) return nil;
    NSError *error = nil;
    NSPropertyListFormat binaryFormat = NSPropertyListOpenStepFormat;
    id binary = [NSPropertyListSerialization propertyListWithData:data
                                                          options:NSPropertyListImmutable
                                                           format:&binaryFormat
                                                            error:&error];
    if (error || binaryFormat != NSPropertyListBinaryFormat_v1_0 ||
        !PBFDictionaryHasExactKeys(binary, @[@"$archiver", @"$version", @"$objects", @"$top"])) return nil;
    NSDictionary *binaryArchive = binary;
    id archiverName = binaryArchive[@"$archiver"];
    NSArray *binaryObjects = binaryArchive[@"$objects"];
    NSDictionary *binaryTop = binaryArchive[@"$top"];
    if (![archiverName isKindOfClass:NSString.class] || ![archiverName isEqualToString:@"NSKeyedArchiver"] ||
        !PBFArchiveIntegerEquals(binaryArchive[@"$version"], 100000) ||
        ![binaryObjects isKindOfClass:NSArray.class] || binaryObjects.count != 6 ||
        ![binaryTop isKindOfClass:NSDictionary.class] || binaryTop.count != 1 ||
        ![binaryObjects.firstObject isKindOfClass:NSString.class] ||
        ![binaryObjects.firstObject isEqualToString:@"$null"]) return nil;

    NSData *xmlData = [NSPropertyListSerialization dataWithPropertyList:binaryArchive
                                                                  format:NSPropertyListXMLFormat_v1_0
                                                                 options:0
                                                                   error:&error];
    if (error || xmlData.length == 0 || xmlData.length > 2 * PBFCodecMaxColorArchiveBytes) return nil;
    NSString *xml = [[NSString alloc] initWithData:xmlData encoding:NSUTF8StringEncoding];
    NSString *uidKey = @"<key>CF$UID</key>";
    if (!xml || ![xml containsString:uidKey]) return nil;
    xml = [xml stringByReplacingOccurrencesOfString:uidKey withString:@"<key>PBF_UID</key>"];
    NSData *normalizedXMLData = [xml dataUsingEncoding:NSUTF8StringEncoding];
    if (normalizedXMLData.length == 0 || normalizedXMLData.length > 2 * PBFCodecMaxColorArchiveBytes) return nil;
    NSPropertyListFormat xmlFormat = NSPropertyListOpenStepFormat;
    id parsed = [NSPropertyListSerialization propertyListWithData:normalizedXMLData
                                                         options:NSPropertyListImmutable
                                                          format:&xmlFormat
                                                           error:&error];
    if (error || xmlFormat != NSPropertyListXMLFormat_v1_0 ||
        !PBFDictionaryHasExactKeys(parsed, @[@"$archiver", @"$version", @"$objects", @"$top"])) return nil;
    return parsed;
}

static BOOL PBFValidateColorArchiveObjectGraph(NSDictionary *archive) {
    NSArray *objects = archive[@"$objects"];
    NSDictionary *top = archive[@"$top"];
    id archiverName = archive[@"$archiver"];
    if (![archiverName isKindOfClass:NSString.class] || ![archiverName isEqualToString:@"NSKeyedArchiver"] ||
        !PBFArchiveIntegerEquals(archive[@"$version"], 100000) ||
        ![objects isKindOfClass:NSArray.class] || objects.count != 6 ||
        ![objects.firstObject isKindOfClass:NSString.class] || ![objects.firstObject isEqualToString:@"$null"] ||
        !PBFDictionaryHasExactKeys(top, @[@"root"])) return NO;

    NSUInteger colorIndex = 0;
    if (!PBFArchiveUIDIndex(top[@"root"], objects.count, &colorIndex) || colorIndex == 0) return NO;
    NSDictionary *color = objects[colorIndex];
    if (!PBFDictionaryHasExactKeys(color, @[@"$class", @"NSColorSpace", @"NSComponents", @"NSRGB",
                                            @"NSLinearExposure", @"NSCustomColorSpace"]) ||
        !PBFArchiveIntegerEquals(color[@"NSColorSpace"], 1) ||
        !PBFValidateColorNumericData(color[@"NSComponents"], 4, 1.0) ||
        !PBFValidateColorNumericData(color[@"NSRGB"], 4, 1.0) ||
        !PBFValidateColorNumericData(color[@"NSLinearExposure"], 1, 16.0)) return NO;

    NSUInteger colorClassIndex = 0;
    NSUInteger colorSpaceIndex = 0;
    if (!PBFArchiveUIDIndex(color[@"$class"], objects.count, &colorClassIndex) ||
        !PBFColorClassDescription(objects, colorClassIndex, @"NSColor") ||
        !PBFArchiveUIDIndex(color[@"NSCustomColorSpace"], objects.count, &colorSpaceIndex) ||
        colorSpaceIndex == 0 || colorSpaceIndex == colorIndex) return NO;
    NSDictionary *colorSpace = objects[colorSpaceIndex];
    if (!PBFDictionaryHasExactKeys(colorSpace, @[@"$class", @"NSID", @"NSICC"]) ||
        !PBFArchiveIntegerEquals(colorSpace[@"NSID"], 7)) return NO;
    NSUInteger colorSpaceClassIndex = 0;
    NSUInteger iccIndex = 0;
    if (!PBFArchiveUIDIndex(colorSpace[@"$class"], objects.count, &colorSpaceClassIndex) ||
        !PBFColorClassDescription(objects, colorSpaceClassIndex, @"NSColorSpace") ||
        !PBFArchiveUIDIndex(colorSpace[@"NSICC"], objects.count, &iccIndex) ||
        iccIndex == 0 || iccIndex == colorIndex || iccIndex == colorSpaceIndex ||
        ![objects[iccIndex] isKindOfClass:NSData.class] || !PBFValidateICCProfile(objects[iccIndex])) return NO;

    NSSet *usedObjects = [NSSet setWithArray:@[@0, @(colorIndex), @(colorSpaceIndex), @(iccIndex),
                                                @(colorClassIndex), @(colorSpaceClassIndex)]];
    return usedObjects.count == objects.count;
}

static BOOL PBFValidateSecureColorArchive(NSData *data) {
    @try {
        NSDictionary *archive = PBFParseBoundedColorArchive(data);
        if (!archive || !PBFValidateColorArchiveObjectGraph(archive)) return NO;
        NSError *error = nil;
        NSKeyedUnarchiver *unarchiver = [[NSKeyedUnarchiver alloc] initForReadingFromData:data error:&error];
        if (!unarchiver) return NO;
        NSColor *decoded = nil;
        unarchiver.requiresSecureCoding = YES;
        decoded = [unarchiver decodeTopLevelObjectOfClass:NSColor.class
                                                    forKey:NSKeyedArchiveRootObjectKey
                                                    error:&error];
        [unarchiver finishDecoding];
        if (error != nil || ![decoded isKindOfClass:NSColor.class]) return NO;
        NSColorSpace *colorSpace = decoded.colorSpace;
        return colorSpace != nil && colorSpace.colorSpaceModel == NSColorSpaceModelRGB;
    } @catch (NSException *exception) {
        (void)exception;
        return NO;
    }
}

BOOL PBFCodecValidateRepresentation(NSString *nativeName, NSData *data) {
    if (!PBFCodecSupportsNativeName(nativeName) || ![data isKindOfClass:NSData.class]) return NO;
    if ([nativeName isEqualToString:PBFFormatPNG] || [nativeName isEqualToString:PBFFormatJPEG] ||
        [nativeName isEqualToString:PBFFormatTIFF]) return PBFValidateImage(data, nativeName);
    if ([nativeName isEqualToString:PBFFormatRTF]) {
        clipboard_format_probe::RtfFraming framing;
        return clipboard_format_probe::AnalyzeRtfFraming(
            static_cast<const uint8_t *>(data.bytes), data.length, &framing);
    }
    if ([nativeName isEqualToString:PBFFormatURL]) return PBFCodecValidateStoredURL(data);
    if ([nativeName isEqualToString:PBFFormatFileURL]) return PBFValidateFileURL(data);
    if ([nativeName isEqualToString:PBFFormatTSV]) return PBFValidateTSV(data);
    if ([nativeName isEqualToString:PBFFormatColor]) return PBFValidateSecureColorArchive(data);
    return YES;
}
