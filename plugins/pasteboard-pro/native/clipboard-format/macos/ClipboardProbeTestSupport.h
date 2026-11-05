#import <Foundation/Foundation.h>

NS_ASSUME_NONNULL_BEGIN

FOUNDATION_EXPORT NSString * _Nullable PBFProbeCurrentExecutablePath(void);
FOUNDATION_EXPORT NSString * _Nullable PBFProbeArtifactDirectoryPathForExecutable(NSString *argument);
FOUNDATION_EXPORT NSString * _Nullable PBFProbeArtifactDirectoryPath(void);

NS_ASSUME_NONNULL_END
