#pragma once

#import <Foundation/Foundation.h>

typedef NS_ENUM(NSInteger, PBFCaptureWireFixtureMode) {
    PBFCaptureWireFixtureModeDefault = 0,
    PBFCaptureWireFixtureModeNulContent,
    PBFCaptureWireFixtureModeTerminated,
    PBFCaptureWireFixtureModeBomlessBigEndian
};

FOUNDATION_EXPORT int PBFRunCaptureWireFixture(void);
FOUNDATION_EXPORT int PBFRunCaptureWireFixtureForMode(PBFCaptureWireFixtureMode mode);
