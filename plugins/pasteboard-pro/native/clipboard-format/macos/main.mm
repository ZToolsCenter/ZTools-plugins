#import "ClipboardProbe.h"
#import "ClipboardProbeFaults.h"
#import "ClipboardPayloadTransport.h"

#include <stdlib.h>
#include <string.h>

static BOOL PBFWaitForSupervisedRun(void) {
    const char *supervised = getenv("PBF_G0_SUPERVISED");
    if (!supervised || strcmp(supervised, "1") != 0) return YES;
    char line[16];
    return fgets(line, sizeof(line), stdin) != NULL && strcmp(line, "RUN\n") == 0;
}

static void PBFWriteJSON(NSDictionary<NSString *, id> *value) {
    NSError *error = nil;
    NSData *data = [NSJSONSerialization dataWithJSONObject:value options:NSJSONWritingFragmentsAllowed error:&error];
    if (!data) {
        fprintf(stderr, "failed to serialize probe result: %s\n", error.localizedDescription.UTF8String ?: "unknown error");
        exit(2);
    }
    fwrite(data.bytes, 1, data.length, stdout);
    fputc('\n', stdout);
}

int main(int argc, const char *argv[]) {
    @autoreleasepool {
        if (argc == 1) {
            fprintf(stdout, "Usage: clipboard-format-probe --self-test | --delayed-read-fixture | --capture-wire-fixture | --capture-wire-nul-content-fixture | --capture-wire-terminated-fixture | --capture-wire-bomless-be-fixture\n");
            return 0;
        }
        if (argc != 2) {
            fprintf(stderr, "unsupported arguments; use one fixed mode\n");
            return 2;
        }
        BOOL delayedReadFixture = strcmp(argv[1], "--delayed-read-fixture") == 0;
        PBFCaptureWireFixtureMode captureWireMode = PBFCaptureWireFixtureModeDefault;
        BOOL captureWireFixture = strcmp(argv[1], "--capture-wire-fixture") == 0;
        if (strcmp(argv[1], "--capture-wire-nul-content-fixture") == 0) {
            captureWireMode = PBFCaptureWireFixtureModeNulContent;
            captureWireFixture = YES;
        } else if (strcmp(argv[1], "--capture-wire-terminated-fixture") == 0) {
            captureWireMode = PBFCaptureWireFixtureModeTerminated;
            captureWireFixture = YES;
        } else if (strcmp(argv[1], "--capture-wire-bomless-be-fixture") == 0) {
            captureWireMode = PBFCaptureWireFixtureModeBomlessBigEndian;
            captureWireFixture = YES;
        }
        if (!delayedReadFixture && !captureWireFixture &&
            strcmp(argv[1], "--self-test") != 0) {
            fprintf(stderr, "unsupported mode; use --self-test, --delayed-read-fixture, or a fixed capture-wire fixture\n");
            return 2;
        }
        const char *supervised = getenv("PBF_G0_SUPERVISED");
        if ((delayedReadFixture || captureWireFixture) &&
            (!supervised || strcmp(supervised, "1") != 0)) {
            fprintf(stderr, "supervision-required\n");
            return 2;
        }
        if (!PBFWaitForSupervisedRun()) {
            fprintf(stderr, "supervised-start-rejected\n");
            return 2;
        }
        if (captureWireFixture) return PBFRunCaptureWireFixtureForMode(captureWireMode);
        if (delayedReadFixture) return PBFRunDelayedReadFixture();
        NSDictionary<NSString *, id> *report = PBFSelfTest();
        PBFWriteJSON(report);
        return [report[@"success"] boolValue] ? 0 : 1;
    }
}
