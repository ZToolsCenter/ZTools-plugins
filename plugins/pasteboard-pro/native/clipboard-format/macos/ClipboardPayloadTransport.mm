#import "ClipboardPayloadTransport.h"

#import "ClipboardCapturePolicy.h"
#import "ClipboardCaptureCodecEvidence.h"
#import "ClipboardProbe.h"
#import "ClipboardProbeContracts.h"

#include "../common/clipboard_capture_wire.h"

#include <CoreFoundation/CoreFoundation.h>
#include <cstdio>
#include <iostream>
#include <string>
#include <utility>
#include <vector>

using clipboard_format_probe::CaptureCodecV2;
using clipboard_format_probe::CaptureWireRowV1;
using clipboard_format_probe::CaptureWireV1;

static NSString *const PBFWireUnknownNativeName =
    @"org.ztools.pasteboard-pro.fixture.unknown-v1";

static int PBFWireFixtureFailure(const char *code) {
    fprintf(stderr, "%s\n", code);
    fflush(stderr);
    return 2;
}

static NSData *PBFWireUTF8Data(NSString *value) {
    return [value dataUsingEncoding:NSUTF8StringEncoding allowLossyConversion:NO];
}

static NSPasteboardItem *PBFWireFixtureItem(
    BOOL includeUnknown,
    PBFCaptureWireFixtureMode mode) {
    NSPasteboardItem *item = [[NSPasteboardItem alloc] init];
    if (mode == PBFCaptureWireFixtureModeDefault) {
        NSData *plain = PBFWireUTF8Data(@"wire fixture hello");
        NSData *html = PBFWireUTF8Data(@"<p>wire <b>fixture</b> hello</p>");
        NSData *rtf = PBFWireUTF8Data(@"{\\rtf1\\ansi wire fixture hello}");
        if (!plain || !html || !rtf ||
            ![item setData:plain forType:PBFFormatUTF8Text] ||
            ![item setData:html forType:PBFFormatHTML] ||
            ![item setData:rtf forType:PBFFormatRTF]) {
            return nil;
        }
    } else {
        static const std::uint8_t kUtf8Hello[] = {'h', 'e', 'l', 'l', 'o'};
        static const std::uint8_t kUtf8HelloWithNul[] = {'h', 'e', 'l', 'l', 'o', 0};
        static const std::uint8_t kUtf16LeHelloTerminated[] = {
            'h', 0, 'e', 0, 'l', 0, 'l', 0, 'o', 0, 0, 0
        };
        static const std::uint8_t kUtf16BeHelloTerminated[] = {
            0, 'h', 0, 'e', 0, 'l', 0, 'l', 0, 'o', 0, 0
        };
        BOOL nulContent = mode == PBFCaptureWireFixtureModeNulContent;
        BOOL bigEndian = mode == PBFCaptureWireFixtureModeBomlessBigEndian;
        const std::uint8_t *utf8Bytes = nulContent ? kUtf8HelloWithNul : kUtf8Hello;
        NSUInteger utf8Length = nulContent ? sizeof(kUtf8HelloWithNul) : sizeof(kUtf8Hello);
        const std::uint8_t *utf16Bytes = bigEndian ? kUtf16BeHelloTerminated
                                                   : kUtf16LeHelloTerminated;
        NSData *plain = [NSData dataWithBytes:utf8Bytes length:utf8Length];
        NSData *utf16 = [NSData dataWithBytes:utf16Bytes
                                       length:sizeof(kUtf16LeHelloTerminated)];
        if (![item setData:plain forType:PBFFormatUTF8Text] ||
            ![item setData:utf16 forType:PBFFormatUTF16ExternalText]) {
            return nil;
        }
    }
    if (includeUnknown &&
        ![item setData:[NSData data] forType:PBFWireUnknownNativeName]) {
        return nil;
    }
    return item;
}

static BOOL PBFWireString(NSString *value, std::string *output) {
    if (![value isKindOfClass:NSString.class] || !output) return NO;
    NSData *utf8 = [value dataUsingEncoding:NSUTF8StringEncoding allowLossyConversion:NO];
    if (!utf8) return NO;
    const char *bytes = static_cast<const char *>(utf8.bytes);
    output->assign(bytes ? bytes : "", utf8.length);
    return YES;
}

static BOOL PBFWireReadRevision(id raw, std::string *output) {
    NSInteger value = 0;
    if (!PBFReadRevision(raw, &value) || !output) return NO;
    *output = std::to_string(static_cast<std::uint64_t>(value));
    return YES;
}

static BOOL PBFWireReadIndex(id raw, NSUInteger *output) {
    NSInteger value = 0;
    if (!PBFReadRevision(raw, &value) || !output) return NO;
    *output = static_cast<NSUInteger>(value);
    return YES;
}

static BOOL PBFWireReadBoolean(id raw, BOOL *output) {
    if (![raw isKindOfClass:NSNumber.class] ||
        CFGetTypeID((__bridge CFTypeRef)raw) != CFBooleanGetTypeID() || !output) {
        return NO;
    }
    *output = [raw boolValue];
    return YES;
}

static BOOL PBFWireIsSHA256(NSString *value) {
    if (![value isKindOfClass:NSString.class] || value.length != 64) return NO;
    for (NSUInteger index = 0; index < value.length; index++) {
        unichar character = [value characterAtIndex:index];
        if (!((character >= '0' && character <= '9') ||
              (character >= 'a' && character <= 'f'))) {
            return NO;
        }
    }
    return YES;
}

static NSString *PBFWireKey(NSUInteger itemIndex, NSString *nativeName) {
    return [NSString stringWithFormat:@"%lu:%@", (unsigned long)itemIndex, nativeName];
}

static NSArray<NSArray<NSString *> *> *PBFWireSnapshotTypeOrder(
    NSPasteboard *pasteboard,
    NSNumber *expectedRevision) {
    NSInteger requiredRevision = 0;
    if (!PBFReadRevision(expectedRevision, &requiredRevision)) return nil;
    NSArray<NSPasteboardItem *> *nativeItems = pasteboard.pasteboardItems;
    if (![nativeItems isKindOfClass:NSArray.class] ||
        nativeItems.count == 0 || nativeItems.count > 32) {
        return nil;
    }

    NSMutableArray<NSArray<NSString *> *> *typeOrders =
        [NSMutableArray arrayWithCapacity:nativeItems.count];
    for (id nativeItem in nativeItems) {
        if (![nativeItem isKindOfClass:NSPasteboardItem.class]) return nil;
        NSArray *rawTypes = [nativeItem types];
        if (![rawTypes isKindOfClass:NSArray.class] || rawTypes.count == 0 ||
            rawTypes.count > 32) {
            return nil;
        }
        NSMutableSet<NSString *> *seenTypes = [NSMutableSet set];
        NSMutableArray<NSString *> *types = [NSMutableArray arrayWithCapacity:rawTypes.count];
        for (id rawType in rawTypes) {
            if (!PBFCodecIsValidNativeName(rawType) || [seenTypes containsObject:rawType]) return nil;
            NSString *nativeName = [rawType copy];
            [seenTypes addObject:nativeName];
            [types addObject:nativeName];
        }
        [typeOrders addObject:[types copy]];
    }
    return pasteboard.changeCount == requiredRevision ? [typeOrders copy] : nil;
}

static std::string PBFWireUnavailableReason(NSString *reason) {
    if ([reason isEqualToString:@"unsupported"] ||
        [reason isEqualToString:@"unsupported_format_not_materialized"]) {
        return "unsupported";
    }
    if ([reason isEqualToString:@"timeout"] ||
        [reason isEqualToString:@"timed-out"]) {
        return "timeout";
    }
    if ([reason isEqualToString:@"over-limit"] ||
        [reason isEqualToString:@"payload_limit_exceeded"]) {
        return "over-limit";
    }
    return "failed";
}

static BOOL PBFWireAddCapturedRow(
    NSUInteger itemIndex,
    NSString *nativeName,
    NSDictionary<NSString *, id> *representation,
    NSDictionary<NSString *, id> *summary,
    CaptureWireV1 *wire,
    NSMutableArray<NSData *> *ownedPayloads) {
    NSData *payload = representation[@"data"];
    NSString *summarySHA = summary[@"sha256"];
    if (![payload isKindOfClass:NSData.class] || !PBFWireIsSHA256(summarySHA)) return NO;

    id rawFidelity = representation[@"fidelity"] ?: summary[@"fidelity"];
    NSString *fidelity = [rawFidelity isKindOfClass:NSString.class] ? rawFidelity : nil;
    if (!fidelity) fidelity = @"exact";
    if (!([fidelity isEqualToString:@"exact"] ||
          [fidelity isEqualToString:@"compatible"] ||
          [fidelity isEqualToString:@"reference"])) {
        return NO;
    }

    id rawDerivedFrom = representation[@"derivedFrom"] ?: summary[@"derivedFrom"];
    NSString *derivedFrom = [rawDerivedFrom isKindOfClass:NSString.class] ? rawDerivedFrom : nil;
    if ([fidelity isEqualToString:@"compatible"] &&
        (!derivedFrom || derivedFrom.length == 0 ||
         !PBFCodecIsValidNativeName(derivedFrom))) {
        return NO;
    }

    CaptureWireRowV1 row;
    row.item_index = static_cast<std::uint32_t>(itemIndex);
    if (!PBFWireString(nativeName, &row.native_name) ||
        !PBFWireString(fidelity, &row.fidelity) ||
        !PBFWireString(summarySHA, &row.sha256)) {
        return NO;
    }
    if (derivedFrom && !PBFWireString(derivedFrom, &row.derived_from)) return NO;
    CaptureCodecV2 nativeCodec;
    if (!PBFBuildCaptureCodecEvidence(nativeName, representation, &nativeCodec)) return NO;
    row.native_codec = std::move(nativeCodec);
    row.captured = true;
    row.bytes = static_cast<const std::uint8_t *>(payload.bytes);
    row.byte_length = payload.length;
    wire->rows.push_back(std::move(row));
    [ownedPayloads addObject:payload];
    return YES;
}

static BOOL PBFWireAddUnavailableRow(
    NSUInteger itemIndex,
    NSString *nativeName,
    NSDictionary<NSString *, id> *unavailable,
    CaptureWireV1 *wire) {
    NSString *reason = unavailable[@"reasonCode"];
    if (![reason isKindOfClass:NSString.class]) return NO;
    CaptureWireRowV1 row;
    row.item_index = static_cast<std::uint32_t>(itemIndex);
    if (!PBFWireString(nativeName, &row.native_name)) return NO;
    row.captured = false;
    row.reason_code = PBFWireUnavailableReason(reason);
    wire->rows.push_back(std::move(row));
    return YES;
}

static BOOL PBFWireBuildFrame(
    NSArray<NSArray<NSString *> *> *typeOrders,
    NSDictionary<NSString *, id> *capture,
    NSNumber *expectedRevision,
    NSDictionary<NSString *, id> *fixturePolicy,
    CaptureWireV1 *wire,
    NSMutableArray<NSData *> *ownedPayloads) {
    NSString *status = capture[@"status"];
    BOOL partial = [status isEqualToString:@"partial"];
    if (!partial && ![status isEqualToString:@"ready"]) return NO;

    NSInteger expectedRevisionNumber = 0;
    if (!PBFReadRevision(expectedRevision, &expectedRevisionNumber) ||
        !PBFWireReadRevision(expectedRevision, &wire->expected_revision)) {
        return NO;
    }

    id rawItems = capture[@"items"];
    id rawSummaries = capture[@"summary"];
    id rawUnavailable = capture[@"unsupported"];
    NSArray *items = [rawItems isKindOfClass:NSArray.class] ? rawItems : nil;
    NSArray *summaries = [rawSummaries isKindOfClass:NSArray.class] ? rawSummaries : nil;
    NSArray *unavailable = [rawUnavailable isKindOfClass:NSArray.class] ? rawUnavailable : nil;
    if (!items || !summaries || !unavailable ||
        ![typeOrders isKindOfClass:NSArray.class] ||
        typeOrders.count != items.count || items.count == 0 || items.count > 32 ||
        summaries.count != items.count) {
        return NO;
    }

    NSDictionary *policyReceipt = capture[@"policyReceipt"];
    BOOL captureAllowed = NO;
    BOOL localHistoryAllowed = NO;
    BOOL cloudUploadAllowed = NO;
    if (![policyReceipt isKindOfClass:NSDictionary.class] ||
        !PBFWireReadBoolean(policyReceipt[@"captureAllowed"], &captureAllowed) ||
        !PBFWireReadBoolean(fixturePolicy[@"allowLocalHistory"], &localHistoryAllowed) ||
        !captureAllowed || !localHistoryAllowed) {
        return NO;
    }
    id rawCloudPermission = policyReceipt[@"cloudUploadAllowed"] ?:
        policyReceipt[@"cloudUploadPermitted"];
    if (rawCloudPermission &&
        !PBFWireReadBoolean(rawCloudPermission, &cloudUploadAllowed)) {
        return NO;
    }

    if (!PBFWireReadRevision(capture[@"revision"], &wire->captured_revision) ||
        !PBFWireReadRevision(capture[@"observedRevision"], &wire->observed_revision) ||
        wire->captured_revision != wire->expected_revision) {
        return NO;
    }

    wire->request_id = "fixture-v17";
    wire->platform = "macos";
    wire->policy_revision = "fixture-policy-v17";
    wire->partial = partial;
    wire->capture_allowed = captureAllowed;
    wire->local_history_allowed = localHistoryAllowed;
    wire->cloud_upload_allowed = cloudUploadAllowed;

    NSMutableDictionary<NSString *, NSDictionary<NSString *, id> *> *capturedByKey =
        [NSMutableDictionary dictionary];
    NSUInteger capturedCount = 0;
    for (NSUInteger itemPosition = 0; itemPosition < items.count; itemPosition++) {
        NSDictionary *item = items[itemPosition];
        NSUInteger itemIndex = 0;
        NSArray *representations = item[@"representations"];
        if (![item isKindOfClass:NSDictionary.class] ||
            !PBFWireReadIndex(item[@"index"], &itemIndex) ||
            itemIndex != itemPosition ||
            ![representations isKindOfClass:NSArray.class] ||
            representations.count > 32) {
            return NO;
        }
        for (id rawRepresentation in representations) {
            if (![rawRepresentation isKindOfClass:NSDictionary.class]) return NO;
            NSDictionary *representation = rawRepresentation;
            NSString *nativeName = representation[@"nativeName"];
            if (!PBFCodecIsValidNativeName(nativeName)) return NO;
            NSString *key = PBFWireKey(itemIndex, nativeName);
            if (capturedByKey[key]) return NO;
            capturedByKey[key] = representation;
            capturedCount++;
        }
    }

    NSMutableDictionary<NSString *, NSDictionary<NSString *, id> *> *summariesByKey =
        [NSMutableDictionary dictionary];
    for (NSUInteger itemPosition = 0; itemPosition < summaries.count; itemPosition++) {
        NSDictionary *item = summaries[itemPosition];
        NSUInteger itemIndex = 0;
        NSArray *representations = item[@"representations"];
        if (![item isKindOfClass:NSDictionary.class] ||
            !PBFWireReadIndex(item[@"index"], &itemIndex) ||
            itemIndex != itemPosition ||
            ![representations isKindOfClass:NSArray.class]) {
            return NO;
        }
        for (id rawSummary in representations) {
            if (![rawSummary isKindOfClass:NSDictionary.class]) return NO;
            NSDictionary *summary = rawSummary;
            NSString *nativeName = summary[@"nativeName"];
            if (!PBFCodecIsValidNativeName(nativeName)) return NO;
            NSString *key = PBFWireKey(itemIndex, nativeName);
            if (summariesByKey[key]) return NO;
            summariesByKey[key] = summary;
        }
    }
    if (summariesByKey.count != capturedCount) return NO;

    NSMutableDictionary<NSString *, NSDictionary<NSString *, id> *> *unavailableByKey =
        [NSMutableDictionary dictionary];
    for (id rawRecord in unavailable) {
        if (![rawRecord isKindOfClass:NSDictionary.class]) return NO;
        NSDictionary *record = rawRecord;
        NSUInteger itemIndex = 0;
        NSString *nativeName = record[@"nativeName"];
        if (!PBFWireReadIndex(record[@"itemIndex"], &itemIndex) ||
            itemIndex >= typeOrders.count ||
            !PBFCodecIsValidNativeName(nativeName)) {
            return NO;
        }
        NSString *key = PBFWireKey(itemIndex, nativeName);
        if (unavailableByKey[key] || capturedByKey[key]) return NO;
        unavailableByKey[key] = record;
    }

    NSMutableSet<NSString *> *usedCaptured = [NSMutableSet set];
    NSMutableSet<NSString *> *usedUnavailable = [NSMutableSet set];
    for (NSUInteger itemIndex = 0; itemIndex < typeOrders.count; itemIndex++) {
        for (NSString *nativeName in typeOrders[itemIndex]) {
            NSString *key = PBFWireKey(itemIndex, nativeName);
            NSDictionary *representation = capturedByKey[key];
            NSDictionary *summary = summariesByKey[key];
            NSDictionary *unavailableRecord = unavailableByKey[key];
            if (representation) {
                if (!summary ||
                    !PBFWireAddCapturedRow(itemIndex, nativeName, representation, summary,
                                           wire, ownedPayloads)) {
                    return NO;
                }
                [usedCaptured addObject:key];
            } else if (unavailableRecord) {
                if (!PBFWireAddUnavailableRow(itemIndex, nativeName, unavailableRecord, wire)) {
                    return NO;
                }
                [usedUnavailable addObject:key];
            } else {
                return NO;
            }
        }
    }
    if (usedCaptured.count != capturedByKey.count ||
        usedUnavailable.count != unavailableByKey.count ||
        wire->rows.empty() ||
        (partial && unavailableByKey.count == 0) ||
        (!partial && unavailableByKey.count != 0)) {
        return NO;
    }
    return PBFWireString(@"fixture-policy-v17", &wire->policy_revision);
}

static int PBFWriteCaptureWireFrame(
    NSArray<NSArray<NSString *> *> *typeOrders,
    NSDictionary<NSString *, id> *capture,
    NSNumber *expectedRevision,
    NSDictionary<NSString *, id> *fixturePolicy,
    NSMutableArray<NSData *> *ownedPayloads) {
    CaptureWireV1 wire;
    if (!PBFWireBuildFrame(typeOrders, capture, expectedRevision, fixturePolicy,
                           &wire, ownedPayloads)) {
        return PBFWireFixtureFailure("wire-fixture-capture-invalid");
    }
    if (!clipboard_format_probe::WriteCaptureWireV2(wire, &std::cout)) {
        return PBFWireFixtureFailure("wire-fixture-frame-rejected");
    }
    std::cout.flush();
    return std::cout.good() ? 0 : PBFWireFixtureFailure("wire-fixture-write-failed");
}

int PBFRunCaptureWireFixtureForMode(PBFCaptureWireFixtureMode mode) {
    if (mode != PBFCaptureWireFixtureModeDefault &&
        mode != PBFCaptureWireFixtureModeNulContent &&
        mode != PBFCaptureWireFixtureModeTerminated &&
        mode != PBFCaptureWireFixtureModeBomlessBigEndian) {
        return PBFWireFixtureFailure("wire-fixture-mode-invalid");
    }
    @autoreleasepool {
        NSString *name = [NSString stringWithFormat:
            @"org.ztools.pasteboard-pro.g0.wire-fixture.%@",
            NSUUID.UUID.UUIDString];
        if (PBFIsReservedPasteboardName(name)) {
            return PBFWireFixtureFailure("wire-fixture-board-invalid");
        }
        NSPasteboard *pasteboard = [NSPasteboard pasteboardWithName:name];
        if (!pasteboard || ![pasteboard.name isEqualToString:name] ||
            PBFIsReservedPasteboardName(pasteboard.name)) {
            return PBFWireFixtureFailure("wire-fixture-board-unavailable");
        }

        int result = 2;
        @try {
            NSArray *existingItems = pasteboard.pasteboardItems;
            if (existingItems && existingItems.count != 0) {
                result = PBFWireFixtureFailure("wire-fixture-board-not-empty");
            } else {
                const BOOL standardFixture = mode == PBFCaptureWireFixtureModeDefault;
                NSPasteboardItem *first = PBFWireFixtureItem(standardFixture, mode);
                NSPasteboardItem *second = standardFixture
                    ? PBFWireFixtureItem(NO, mode) : nil;
                if (!first || (standardFixture && !second)) {
                    result = PBFWireFixtureFailure("wire-fixture-seed-failed");
                } else {
                    NSArray<NSPasteboardItem *> *fixtureItems = standardFixture
                        ? @[first, second] : @[first];
                    if (![pasteboard writeObjects:fixtureItems]) {
                        result = PBFWireFixtureFailure("wire-fixture-seed-failed");
                    } else {
                        NSNumber *expectedRevision = @(pasteboard.changeCount);
                        NSArray<NSArray<NSString *> *> *typeOrders =
                            PBFWireSnapshotTypeOrder(pasteboard, expectedRevision);
                        NSMutableDictionary<NSString *, id> *fixturePolicy =
                            [PBFDefaultCapturePolicy() mutableCopy];
                        fixturePolicy[@"allowUnknownSource"] = @YES;
                        NSDictionary<NSString *, id> *capture = typeOrders ? PBFCaptureWithPolicy(
                            pasteboard, PBFDefaultLimits(), expectedRevision, fixturePolicy) : nil;
                        NSString *status = capture[@"status"];
                        if (!typeOrders || (![status isEqualToString:@"ready"] &&
                            ![status isEqualToString:@"partial"])) {
                            result = PBFWireFixtureFailure("wire-fixture-capture-unavailable");
                        } else {
                            NSMutableArray<NSData *> *ownedPayloads = [NSMutableArray array];
                            result = PBFWriteCaptureWireFrame(typeOrders, capture,
                                expectedRevision, fixturePolicy, ownedPayloads);
                        }
                    }
                }
            }
        } @catch (NSException *exception) {
            (void)exception;
            result = PBFWireFixtureFailure("wire-fixture-capture-failed");
        } @finally {
            [pasteboard releaseGlobally];
        }
        return result;
    }
}

int PBFRunCaptureWireFixture(void) {
    return PBFRunCaptureWireFixtureForMode(PBFCaptureWireFixtureModeDefault);
}
