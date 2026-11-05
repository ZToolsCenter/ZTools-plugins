#import "ClipboardFileReferences.h"

#import "ClipboardFormatCodecs.h"

#import <sys/stat.h>
#import <unistd.h>

static NSString *const PBFUnavailableReason = @"file_reference_unavailable";

static NSURL *PBFLocalFileURLFromRepresentation(id representation) {
    if (![representation isKindOfClass:NSDictionary.class]) return nil;
    id rawName = representation[@"nativeName"];
    if (![rawName isKindOfClass:NSString.class] || ![rawName isEqualToString:PBFFormatFileURL]) return nil;
    id rawData = representation[@"data"];
    if (![rawData isKindOfClass:NSData.class]) return nil;

    NSData *data = rawData;
    if (data.length == 0 || data.length > 16 * 1024) return nil;
    NSString *raw = [[NSString alloc] initWithData:data encoding:NSUTF8StringEncoding];
    if (!raw || [raw rangeOfString:@"\0"].location != NSNotFound ||
        [raw rangeOfCharacterFromSet:NSCharacterSet.controlCharacterSet].location != NSNotFound) return nil;

    NSURLComponents *components = [NSURLComponents componentsWithString:raw];
    NSString *scheme = components.scheme.lowercaseString;
    NSString *host = components.host.lowercaseString;
    BOOL localHost = host.length == 0 || [host isEqualToString:@"localhost"];
    if (![scheme isEqualToString:@"file"] || !localHost ||
        components.user.length != 0 || components.password.length != 0 ||
        components.query.length != 0 || components.fragment.length != 0) return nil;

    NSURL *url = components.URL;
    NSString *path = url.path;
    if (!url.isFileURL || path.length == 0 || !path.isAbsolutePath ||
        [path rangeOfString:@"\0"].location != NSNotFound) return nil;
    return url;
}

static BOOL PBFFileReferenceMetadataIsAccessible(NSURL *url) {
    const char *path = url.fileSystemRepresentation;
    if (!path) return NO;

    struct stat metadata;
    if (stat(path, &metadata) != 0) return NO;
    BOOL isDirectory = S_ISDIR(metadata.st_mode);
    if (!isDirectory && !S_ISREG(metadata.st_mode)) return NO;

    int requiredAccess = isDirectory ? (R_OK | X_OK) : R_OK;
    return access(path, requiredAccess) == 0;
}

NSString *PBFFileReferenceAvailabilityFailure(NSArray *items) {
    if (![items isKindOfClass:NSArray.class]) return PBFUnavailableReason;

    @try {
        for (id item in items) {
            if (![item isKindOfClass:NSDictionary.class]) return PBFUnavailableReason;
            id rawRepresentations = item[@"representations"];
            if (![rawRepresentations isKindOfClass:NSArray.class]) return PBFUnavailableReason;

            for (id representation in rawRepresentations) {
                if (![representation isKindOfClass:NSDictionary.class]) return PBFUnavailableReason;
                id rawName = representation[@"nativeName"];
                if (![rawName isKindOfClass:NSString.class] || ![rawName isEqualToString:PBFFormatFileURL]) continue;

                NSURL *url = PBFLocalFileURLFromRepresentation(representation);
                if (!url || !PBFFileReferenceMetadataIsAccessible(url)) return PBFUnavailableReason;
            }
        }
    } @catch (NSException *exception) {
        (void)exception;
        return PBFUnavailableReason;
    }

    return nil;
}
