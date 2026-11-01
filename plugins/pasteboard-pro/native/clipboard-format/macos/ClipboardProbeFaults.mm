#import "ClipboardProbeFaults.h"

#import "ClipboardFormatCodecs.h"
#import "ClipboardProbe.h"

#import <unistd.h>

@interface PBFDelayedReadProvider : NSObject <NSPasteboardItemDataProvider>
@property(atomic, assign) BOOL entered;
@end

@implementation PBFDelayedReadProvider
- (void)pasteboard:(NSPasteboard *)pasteboard
              item:(NSPasteboardItem *)item
    provideDataForType:(NSPasteboardType)type {
    (void)pasteboard;
    (void)item;
    if (![type isEqualToString:PBFFormatUTF8Text]) return;
    self.entered = YES;
    fputs("fixture-entered\n", stderr);
    fflush(stderr);
    sleep(10);
}
@end

int PBFRunDelayedReadFixture(void) {
    @autoreleasepool {
        NSString *name = [NSString stringWithFormat:@"org.ztools.pasteboard-pro.g0.delayed.%@",
                          NSUUID.UUID.UUIDString];
        if (PBFIsReservedPasteboardName(name)) return 2;
        NSPasteboard *pasteboard = [NSPasteboard pasteboardWithName:name];
        if (!pasteboard) return 2;
        @try {
            NSArray *existingItems = pasteboard.pasteboardItems;
            if (existingItems && existingItems.count != 0) return 3;
            PBFDelayedReadProvider *provider = [[PBFDelayedReadProvider alloc] init];
            NSPasteboardItem *item = [[NSPasteboardItem alloc] init];
            if (![item setDataProvider:provider forTypes:@[PBFFormatUTF8Text]]) return 3;
            if (![pasteboard writeObjects:@[item]]) return 3;
            NSPasteboardItem *consumerItem = pasteboard.pasteboardItems.firstObject;
            if (!consumerItem) return 3;
            fputs("read-call-started\n", stderr);
            fflush(stderr);
            @try {
                NSData *result = [consumerItem dataForType:PBFFormatUTF8Text];
                (void)result;
            } @catch (NSException *exception) {
                (void)exception;
            }
            fputs("read-call-returned\n", stderr);
            fflush(stderr);
            return provider.entered ? 4 : 5;
        } @finally {
            [pasteboard releaseGlobally];
        }
    }
}
