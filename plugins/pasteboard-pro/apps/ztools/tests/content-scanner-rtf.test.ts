import { describe, expect, it } from "vitest";
import { evaluateCaptureContentPolicyV2 } from "@pasteboard-pro/core";
import { codec, request, scanner } from "./content-scanner-v2-fixtures";
import { NATIVE_MACOS_RTF, makeRtf, rtf, rtfHexAscii, rtfUnicode, rtfUnicodeWithFallback } from "./content-rtf-fixtures";

const PASS = [{ scope: "text", status: "passed" }, { scope: "links", status: "passed" }];
const SECRET = "private-text";
const SECRET_RULE = { type: "literal" as const, value: SECRET };

function rtfCodec(representationKey = "rtf") {
  return { representationKey, contentKind: "rich-text" as const, richTextFormat: "rtf" as const };
}
function rtfRequest(source: string) {
  return { ...request("", "rich-text", "rtf"), bytes: makeRtf(source) };
}
function rtfScanner(literals: readonly string[] = [SECRET]) {
  return scanner({ codecs: [rtfCodec()], policy: {
    revision: "policy-1", blockLikelySecrets: true,
    contentRules: literals.map((value) => ({ type: "literal" as const, value })),
  } });
}
async function expectBlocked(source: string, literal = SECRET) {
  const runtime = await rtfScanner([literal]);
  const input = rtfRequest(source);
  const original = input.bytes.slice();
  try {
    const result = await runtime.scan(input);
    expect(result).toEqual([{ scope: "text", status: "blocked" }, { scope: "links", status: "blocked" }]);
    expect(input.bytes).toEqual(original);
    expect(JSON.stringify(result)).not.toContain(literal);
    expect(JSON.stringify(runtime.diagnostics())).not.toContain(literal);
  } finally { await runtime.dispose(); }
}

describe("offline RTF privacy projection in the real worker", () => {
  it.each([
    rtf("{|rtf1|ansi|ansicpg1252|uc1 Hello ordinary text|par next line}"),
    rtf("{|rtf1|ansi|ansicpg1252|uc1 A|b bold|b0 text {|i nested} tail|par}"),
    rtf("{|rtf1|ansi|ansicpg1252|uc1|deff0{|fonttbl{|f0|fnil|fcharset0 Arial;}}|f0 Safe}"),
    rtf("{|rtf1|ansi|ansicpg936|uc1 ") + rtfUnicode("测试") + "}",
    rtf("{|rtf1|ansi|ansicpg1252|uc1 |uc0|u65|u66|uc1|u67?}"),
    rtf("{|rtf1|ansi|ansicpg1252|uc1 |uc1|u65?{|uc2|u66??}?|u67?}"),
    rtf("{|rtf1|ansi|ansicpg1252|uc1 caf|'e9}"),
    rtf("{|rtf1|ansi|ansicpg936|uc1 |'b2|'e2|'ca|'d4}"),
    rtf("{|rtf1|ansi|ansicpg1252|uc1{|fonttbl{|f0|fcharset134 GB;}}|f0|'b2|'e2|'ca|'d4}"),
    rtf("{|rtf1|ansi|ansicpg1252|uc1{|fonttbl{|f0|cpg936 GB;}}|f0|'b2|'e2|'ca|'d4}"),
    rtf("{|rtf1|ansi|ansicpg1252|uc1{|field{|*|fldinst HYPERLINK " + '"https://example.invalid/clean"' + "}{|fldrslt Link label}}}"),
    rtf("{|rtf1|ansi|ansicpg1252|uc1 prefix {|field{|*|fldinst HYPERLINK " + '"https://example.invalid/clean"' + "}{|fldrslt mid}} suffix}"),
    rtf("{|rtf1|ansi|ansicpg1252|uc1{|upr{legacy safe}{|*|ud{Unicode safe}}}}"),
  ])("scans supported RTF text while preserving its bytes %#", async (source) => {
    const runtime = await rtfScanner([]);
    const input = rtfRequest(source);
    const original = input.bytes.slice();
    try { expect(await runtime.scan(input)).toEqual(PASS); expect(input.bytes).toEqual(original); }
    finally { await runtime.dispose(); }
  });

  it("blocks Unicode CJK from a real macOS AppKit RTF fixture", async () => {
    await expectBlocked(NATIVE_MACOS_RTF, "测试");
  });

  it("decodes a signed UTF-16 surrogate pair", async () => {
    const runtime = await rtfScanner([]);
    const input = rtfRequest(rtf("{|rtf1|ansi|ansicpg1252|uc1 " + rtfUnicode("safe 😀 text") + "}"));
    try { expect(await runtime.scan(input)).toEqual(PASS); }
    finally { await runtime.dispose(); }
  });

  it.each([
    rtf("{|rtf1|ansi|ansicpg1252|uc1 pri{|b vate}-text}"),
    rtf("{|rtf1|ansi|ansicpg1252|uc1 pri|b0 vate-text}"),
    rtf("{|rtf1|ansi|ansicpg1252|uc1 ") + rtfHexAscii(SECRET) + "}",
    rtf("{|rtf1|ansi|ansicpg1252|uc1 ") + rtfUnicode(SECRET) + "}",
    rtf("{|rtf1|ansi|ansicpg1252|uc1 |uc12|u65 ") + rtfHexAscii(SECRET) + "safe}",
    rtf("{|rtf1|ansi|ansicpg1252|uc1 {|uc2") + rtfUnicodeWithFallback(SECRET, 2) + "}}",
    rtf("{|rtf1|ansi|ansicpg1252|uc1 pri{|field{|*|fldinst HYPERLINK " +
      '"https://example.invalid/clean"' + "}{|fldrslt vate}}-text}"),
    rtf("{|rtf1{|upr{pri|u118?ate-text}{|*|ud safe}}}"),
    rtf("{|rtf1|ansi|ansicpg1252|uc1{|upr{ANSI safe}{|*|ud{") + rtfUnicode(SECRET) + "}}}",
    rtf("{|rtf1|ansi|ansicpg1252|uc1{|upr{") + SECRET + rtf("}{|*|ud{Unicode safe}}}"),
    rtf("{|rtf1|ansi|ansicpg1252|uc1{|info{|author ") + SECRET + "}}Safe}",
  ])("blocks split, encoded, field, alternate and metadata text %#", async (source) => {
    await expectBlocked(source);
  });

  it("blocks Unicode text in the legacy UPR branch", async () => {
    await expectBlocked(rtf("{|rtf1|ansi|ansicpg1252|uc1 {|upr{|u88?}{|*|ud safe}}}"), "X");
  });

  it("scans hidden text", async () => {
    await expectBlocked(rtf("{|rtf1|ansi|ansicpg1252|uc1 visible |v hidden ") + SECRET + rtf("|v0 visible}"));
  });

  it("applies a font codepage override over fcharset0", async () => {
    const runtime = await rtfScanner(["привет"]);
    const source = rtf("{|rtf1|ansi|ansicpg1252|uc1{|fonttbl{|f0|cpg1251|fcharset0 Cyrillic;}}|f0|'") +
      "ef" + String.fromCharCode(92) + "'f0" + String.fromCharCode(92) + "'e8" +
      String.fromCharCode(92) + "'e2" + String.fromCharCode(92) + "'e5" + String.fromCharCode(92) + "'f2}";
    try {
      expect(await runtime.scan(rtfRequest(source))).toEqual([
        { scope: "text", status: "blocked" }, { scope: "links", status: "blocked" },
      ]);
    } finally { await runtime.dispose(); }
  });

  it("checks percent-encoded hyperlink targets without resolving them", async () => {
    await expectBlocked(
      rtf("{|rtf1|ansi|ansicpg1252|uc1{|field{|*|fldinst HYPERLINK ") +
        '"https://example.invalid/%70rivate-text"' + rtf("}{|fldrslt open}}}"),
    );
  });

  it.each([
    rtf("{|rtf1|ansi|ansicpg1252|uc1{|pict|pngblip 89504e47}}"),
    rtf("{|rtf1|ansi|ansicpg1252|uc1{|object|objdata 0011}}"),
    rtf("{|rtf1|ansi|ansicpg1252|uc1{|*|unknown private text}}"),
    rtf("{|rtf1|ansi|ansicpg1252|uc1{|*|webhidden private-text}}"),
    rtf("{|rtf1|ansi|ansicpg1252|uc1|unknownctrl safe}"),
    rtf("{|rtf1|ansi|ansicpg1252|uc1{|field{|*|fldinst DATE}{|fldrslt 2026-01-01}}}"),
    rtf("{|rtf1|ansi|ansicpg1252|uc1{|field{|*|fldinst DDEAUTO cmd}{|fldrslt safe}}}"),
    rtf("{|rtf1|ansi|ansicpg1252|uc1{|fonttbl{|f0|fcharset2 Symbol;}}|f0|'70}"),
    rtf("{|rtf1|ansi|ansicpg1252|uc1{|fonttbl{|f0|fcharset0 Existing;}}|f9|'70}"),
    rtf("{|rtf1|ansi|ansicpg1252|uc1{|fonttbl{|f0|fcharset130 Unsupported;}}|f0|'70}"),
    rtf("{|rtf1|ansi|ansicpg1252|uc1|bin4 priv safe}"),
    rtf("{|rtf1|ansi|ansicpg1252|uc1{|stylesheet{|s0|fs20 Normal;}}|s0 safe}"),
  ])("does not claim complete scan for unsupported, binary or dynamic RTF %#", async (source) => {
    const runtime = await rtfScanner([]);
    try { expect((await runtime.scan(rtfRequest(source))).every((check) => check.status !== "passed")).toBe(true); }
    finally { await runtime.dispose(); }
  });

  it.each([
    rtf("{|rtf1|ansi|ansicpg1252|uc1|k"),
    rtf("{|rtf1|ansi|ansicpg1252|uc1 bad |'q0 escape}"),
    rtf("{|rtf1|ansi|ansicpg1252|uc1 |u0?}"),
    rtf("{|rtf1|ansi|ansicpg1252|uc1 |u-10179?}"),
    "{\\rtf1\\ansi\\ansicpg1252\\uc1 " + "{".repeat(128) + "safe" + "}".repeat(128) + "}",
  ])("does not pass malformed escapes, Unicode, or group depth %#", async (source) => {
    const runtime = await rtfScanner([]);
    try { expect((await runtime.scan(rtfRequest(source))).every((check) => check.status !== "passed")).toBe(true); }
    finally { await runtime.dispose(); }
  });

  it("retains allowlisted raw RTF as not scanned when rules are disabled", async () => {
    const runtime = await scanner({ codecs: [rtfCodec()], policy: {
      revision: "policy-1", blockLikelySecrets: false, contentRules: [],
    } });
    try {
      expect(await runtime.scan(rtfRequest(rtf("{|rtf1|ansi|ansicpg1252|uc1{|object private}Safe}"))))
        .toEqual([{ scope: "text", status: "not-scanned" }, { scope: "links", status: "not-scanned" }]);
    } finally { await runtime.dispose(); }
  });

  it("rejects UTF-8 or HTML codec metadata on RTF bytes", async () => {
    const invalid = [
      { ...rtfCodec(), encoding: "utf-8" as const },
      { ...rtfCodec(), termination: "none" as const },
      { ...rtfCodec(), htmlContainer: "cf-html" as const, encoding: "utf-8" as const, termination: "none" as const },
    ];
    for (const codecValue of invalid) {
      await expect(scanner({ codecs: [codecValue as never] }))
        .rejects.toThrow("Invalid content scanner configuration");
    }
  });

  it("denies mixed captures when required RTF privacy projection is incomplete", async () => {
    const runtime = await scanner({ codecs: [codec("plain"), rtfCodec()], policy: {
      revision: "policy-1", blockLikelySecrets: false, contentRules: [SECRET_RULE],
    } });
    const input = {
      attemptId: "attempt-rtf-incomplete", snapshotId: "snapshot-rtf-incomplete",
      manifestRevision: "manifest-rtf-incomplete", receiptId: "receipt-rtf-incomplete",
      capturedRevision: "41", observedRevision: "43",
      policy: { revision: "policy-1", contentRulesEnabled: true, requireFileBodyScan: false },
      preflight: { capturedRevision: "41", policyRevision: "policy-1", captureAllowed: true, localHistoryAllowed: true, cloudUploadAllowed: false },
      representations: [
        { representationKey: "plain", itemIndex: 0, state: "captured" as const, contentKind: "text" as const,
          bytes: request("safe", "text", "plain").bytes },
        { representationKey: "rtf", itemIndex: 0, state: "captured" as const, contentKind: "rich-text" as const,
          bytes: rtfRequest(rtf("{|rtf1|ansi|ansicpg1252|uc1{|object binary}safe}")).bytes },
      ],
    };
    try {
      const result = await evaluateCaptureContentPolicyV2(input, { currentPolicyRevision: () => "policy-1", scan: runtime.scan });
      expect(result).toMatchObject({
        status: "partial",
        admittedRepresentations: [{ representationKey: "plain", itemIndex: 0, contentKind: "text" }],
        receipt: { representations: [
          { representationKey: "plain", retentionAllowed: true, contentScanStatus: "passed" },
          { representationKey: "rtf", retentionAllowed: false, contentScanStatus: "not-scanned",
            reasonCode: "required-check-unavailable", checks: [
              { scope: "text", status: "not-scanned" }, { scope: "links", status: "not-scanned" },
            ] },
        ] },
      });
    } finally { await runtime.dispose(); }
  });

  it("denies admission when the only RTF representation is incomplete", async () => {
    const runtime = await scanner({ codecs: [rtfCodec()], policy: {
      revision: "policy-1", blockLikelySecrets: false, contentRules: [SECRET_RULE],
    } });
    const input = {
      attemptId: "attempt-rtf-only-incomplete", snapshotId: "snapshot-rtf-only-incomplete",
      manifestRevision: "manifest-rtf-only-incomplete", receiptId: "receipt-rtf-only-incomplete",
      capturedRevision: "41", observedRevision: "43",
      policy: { revision: "policy-1", contentRulesEnabled: true, requireFileBodyScan: false },
      preflight: { capturedRevision: "41", policyRevision: "policy-1", captureAllowed: true, localHistoryAllowed: true, cloudUploadAllowed: false },
      representations: [{ representationKey: "rtf", itemIndex: 0, state: "captured" as const,
        contentKind: "rich-text" as const, bytes: rtfRequest(rtf("{|rtf1|ansi|ansicpg1252|uc1{|object binary}safe}")).bytes }],
    };
    try {
      expect(await evaluateCaptureContentPolicyV2(input, { currentPolicyRevision: () => "policy-1", scan: runtime.scan }))
        .toEqual({ status: "denied", attemptId: "attempt-rtf-only-incomplete",
          outcomeCode: "policy-denied", reasonCode: "no-eligible-representations" });
    } finally { await runtime.dispose(); }
  });

  it("denies the whole capture when RTF text matches beside plain text", async () => {
    const runtime = await scanner({ codecs: [codec("plain"), rtfCodec()], policy: {
      revision: "policy-1", blockLikelySecrets: true, contentRules: [SECRET_RULE],
    } });
    const input = {
      attemptId: "attempt-rtf-match", snapshotId: "snapshot-rtf-match",
      manifestRevision: "manifest-rtf-match", receiptId: "receipt-rtf-match",
      capturedRevision: "41", observedRevision: "43",
      policy: { revision: "policy-1", contentRulesEnabled: true, requireFileBodyScan: false },
      preflight: { capturedRevision: "41", policyRevision: "policy-1", captureAllowed: true, localHistoryAllowed: true, cloudUploadAllowed: false },
      representations: [
        { representationKey: "plain", itemIndex: 0, state: "captured" as const, contentKind: "text" as const,
          bytes: request("safe", "text", "plain").bytes },
        { representationKey: "rtf", itemIndex: 0, state: "captured" as const, contentKind: "rich-text" as const,
          bytes: rtfRequest(rtf("{|rtf1|ansi|ansicpg1252|uc1 pri{|b vate}-text}")).bytes },
      ],
    };
    try {
      expect(await evaluateCaptureContentPolicyV2(input, { currentPolicyRevision: () => "policy-1", scan: runtime.scan }))
        .toEqual({ status: "denied", attemptId: "attempt-rtf-match", outcomeCode: "policy-denied", reasonCode: "content-match" });
    } finally { await runtime.dispose(); }
  });
});

describe("RTF destination default formatting", () => {
  it.each(["footnote", "annotation", "header", "footer"])("resets font before inspecting %s text", async (destination) => {
    const source = rtf("{|rtf1|ansi|ansicpg1252|deff0{|fonttbl{|f0|fnil|fcharset128 Japanese;}{|f1|fnil|fcharset0 Latin;}}|f1 Body{|" + destination + " |'82|'a0}}");
    await expectBlocked(source, "あ");
  });
  it("inherits explicitly scoped Unicode fallback count in a footnote", async () => {
    const runtime = await rtfScanner([]);
    try {
      const checks = await runtime.scan(rtfRequest(rtf("{|rtf1|ansi|uc2 Body{|footnote |u65??}}")));
      expect(checks).toEqual(PASS);
    } finally { await runtime.dispose(); }
  });
});

describe("RTF annotation structure completeness", () => {
  it.each(["atnauthor", "atnid", "atndate"])("does not approve an isolated %s without annotation semantics", async (destination) => {
    const runtime = await rtfScanner(["あ"]);
    const source = rtf("{|rtf1|ansi|ansicpg1252|deff0{|fonttbl{|f0|fnil|fcharset128 Japanese;}{|f1|fnil|fcharset0 Latin;}}|f1 Body{|*|" + destination + " |'82|'a0}}");
    try {
      const checks = await runtime.scan(rtfRequest(source));
      expect(checks.every((check) => check.status !== "passed")).toBe(true);
    } finally { await runtime.dispose(); }
  });
});
