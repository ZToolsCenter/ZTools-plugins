#import "ClipboardProbeTestSupport.h"

#import <limits.h>
#import <stdlib.h>
#import <string.h>

static NSString *PBFProbeCanonicalExistingPath(NSString *candidate) {
    if (candidate.length == 0) return nil;
    char resolved[PATH_MAX];
    if (!realpath(candidate.fileSystemRepresentation, resolved)) return nil;
    return [NSFileManager.defaultManager stringWithFileSystemRepresentation:resolved length:strlen(resolved)];
}

NSString *PBFProbeCurrentExecutablePath(void) {
    NSString *argument = NSProcessInfo.processInfo.arguments.firstObject;
    if (argument.length == 0) return nil;
    if ([argument isAbsolutePath]) return [argument stringByStandardizingPath];
    return [[NSFileManager.defaultManager.currentDirectoryPath stringByAppendingPathComponent:argument]
        stringByStandardizingPath];
}

NSString *PBFProbeArtifactDirectoryPathForExecutable(NSString *argument) {
    if (argument.length == 0) return nil;
    NSString *absolutePath = argument;
    if (![absolutePath isAbsolutePath]) {
        absolutePath = [NSFileManager.defaultManager.currentDirectoryPath stringByAppendingPathComponent:absolutePath];
    }
    absolutePath = [absolutePath stringByStandardizingPath];
    NSString *canonicalExecutable = PBFProbeCanonicalExistingPath(absolutePath);
    if (!canonicalExecutable || ![canonicalExecutable isEqualToString:absolutePath]) return nil;

    NSArray<NSString *> *components = canonicalExecutable.pathComponents;
    NSArray<NSString *> *required = @[@"plugins", @"pasteboard-pro", @"artifacts", @"pasteboardpro",
                                      @"clipboard-format-g0"];
    if (components.count <= required.count + 2) return nil;
    NSUInteger start = components.count - required.count - 2;
    for (NSUInteger index = 0; index < required.count; index++) {
        if (![components[start + index] isEqualToString:required[index]]) return nil;
    }
    NSString *platformDirectory = components[start + required.count];
    if (![platformDirectory isEqualToString:@"darwin"] && ![platformDirectory isEqualToString:@"macos"]) return nil;
    NSString *directoryPath = canonicalExecutable.stringByDeletingLastPathComponent;
    NSString *canonicalDirectory = PBFProbeCanonicalExistingPath(directoryPath);
    if (![canonicalDirectory isEqualToString:directoryPath]) return nil;
    return directoryPath;
}

NSString *PBFProbeArtifactDirectoryPath(void) {
    NSString *executablePath = PBFProbeCurrentExecutablePath();
    return executablePath ? PBFProbeArtifactDirectoryPathForExecutable(executablePath) : nil;
}
