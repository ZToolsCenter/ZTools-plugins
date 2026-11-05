import { describe, expect, it } from "vitest";
import { evaluateCaptureContentPolicyV2 } from "@pasteboard-pro/core";
import { mapNativeCaptureWire, mapNativeCaptureWireV1, mapNativeCaptureWireV2 } from "../preload/native-capture-adapter";
import { capturedWireRow, wireContext, wireFrame, wireMetadata } from "./native-capture-wire-fixtures";
import { macCodec, utf16Pair, windowsCodec, wireV2 } from "./native-capture-v2-fixtures";
import { scanner } from "./content-scanner-v2-fixtures";
import { cfHtml } from "./cf-html-fixtures";

function textCodec(mapped: ReturnType<typeof mapNativeCaptureWire>) {
  const key = mapped.identities.find((row) => row.nativeName === "public.utf16-external-plain-text")!.representationKey;
  return mapped.codecs.find((row) => row.representationKey === key)!;
}
describe("wire2 native encoding evidence admission", () => {
  it("preserves native codec and every original byte while selecting explicit termination", () => {
    const rows = utf16Pair(); const mapped = mapNativeCaptureWire(wireV2(rows), wireContext());
    expect(mapped.metadata.schemaVersion).toBe(2);
    expect(mapped.identities[1]?.nativeCodec).toEqual(rows[1]!.nativeCodec);
    expect(textCodec(mapped)).toMatchObject({ encoding: "utf-16le", termination: "nul" });
    const row = mapped.input.representations[1];
    if (row?.state !== "captured") throw new Error("no-owned-native-row");
    expect(Array.from(row.bytes)).toEqual(Array.from(rows[1]!.bytes));
  });
  it("keeps strict v1/v2 entrypoints distinct and neutral entrypoint backward compatible", () => {
    expect(mapNativeCaptureWire(wireFrame(), wireContext()).metadata.schemaVersion).toBe(1);
    expect(() => mapNativeCaptureWireV1(wireV2(utf16Pair()), wireContext())).toThrow();
    expect(() => mapNativeCaptureWireV2(wireFrame(), wireContext())).toThrow();
  });
  it("does not silently drop metadata from a frame claiming v1", () => {
    const frame = wireV2(utf16Pair()); const size = frame.readUInt32LE(8);
    const metadata = JSON.parse(frame.subarray(20, 20 + size).toString("utf8")); metadata.schemaVersion = 1;
    expect(() => mapNativeCaptureWireV1(wireFrame(metadata, frame.subarray(20 + size)), wireContext())).toThrow();
  });
  it("requires nativeCodec on captured v2 rows", () => {
    const frame = wireFrame(); const size = frame.readUInt32LE(8);
    const metadata = JSON.parse(frame.subarray(20, 20 + size).toString("utf8")); metadata.schemaVersion = 2;
    const bad = wireFrame(metadata, frame.subarray(20 + size)); bad.write("PBCAP02\n", 0, "ascii");
    expect(() => mapNativeCaptureWire(bad, wireContext())).toThrow();
  });
  it.each([
    { encoding: "utf-16be" as const, bom: false }, { sourceBom: true },
    { source: "e\u0301", body: "é", check: "canonical-unicode-equivalent" as const },
  ])("validates explicitly analyzed byte order or canonical relationship %#", (options) => {
    const { source, ...rest } = { source: "hello", ...options };
    const mapped = mapNativeCaptureWire(wireV2(utf16Pair(source, rest)), wireContext());
    expect(textCodec(mapped).termination).toBe("nul");
  });
  it.each([
    (rows: ReturnType<typeof utf16Pair>) => { rows[1]!.nativeCodec.text!.encoding = "utf-16be"; },
    (rows: ReturnType<typeof utf16Pair>) => { rows[1]!.nativeCodec.text!.byteOrderMark = false; },
    (rows: ReturnType<typeof utf16Pair>) => { rows[1]!.nativeCodec.text!.nullTerminated = false; },
    (rows: ReturnType<typeof utf16Pair>) => { rows[1]!.nativeCodec.text!.encodingCheck = "canonical-unicode-equivalent"; },
    (rows: ReturnType<typeof utf16Pair>) => { rows[0]!.bytes = Buffer.from("different source"); },
    (rows: ReturnType<typeof utf16Pair>) => { rows[1]!.derivedFrom = "public.html"; },
    (rows: ReturnType<typeof utf16Pair>) => { rows[1]!.nativeCodec.encoding = "utf-8"; },
    (rows: ReturnType<typeof utf16Pair>) => { rows[1]!.nativeCodec.validationCodePage = 1252; },
  ])("rejects evidence not bound to its actual source and raw bytes %#", (mutate) => {
    const rows = utf16Pair(); mutate(rows);
    expect(() => mapNativeCaptureWire(wireV2(rows), wireContext())).toThrow();
  });
  it.each([Buffer.alloc(0), Buffer.from([0xff, 0xfe])])("rejects impossible empty analyzer payload %#", (bytes) => {
    const rows = utf16Pair(""); rows[1]!.bytes = bytes;
    rows[1]!.nativeCodec.text!.byteOrderMark = bytes.length > 0;
    rows[1]!.nativeCodec.text!.nullTerminated = false;
    expect(() => mapNativeCaptureWire(wireV2(rows), wireContext())).toThrow();
  });
  it("allows a real explicit terminator to encode an empty source", () => {
    const mapped = mapNativeCaptureWire(wireV2(utf16Pair("", { bom: false })), wireContext());
    expect(textCodec(mapped).termination).toBe("nul");
  });
  it("keeps actual content NUL distinct from a terminator and blocks false flag substitution", async () => {
    const rows = utf16Pair("hello\0", { terminated: false });
    const mapped = mapNativeCaptureWire(wireV2(rows), wireContext());
    expect(mapped.input.representations).toHaveLength(2);
    const runtime = await scanner({ codecs: mapped.codecs,
      policy: { revision: wireContext().policy.revision, blockLikelySecrets: false, contentRules: [{ type: "literal", value: "\0" }] } });
    try {
      const result = await evaluateCaptureContentPolicyV2(mapped.input, { currentPolicyRevision: () => wireContext().policy.revision, scan: runtime.scan });
      expect(result.status).toBe("denied");
    } finally { await runtime.dispose(); }
    rows[1]!.nativeCodec.text!.nullTerminated = true;
    expect(() => mapNativeCaptureWire(wireV2(rows), wireContext())).toThrow();
  });
  it("admits both known text representations with explicit native framing without modifying the terminator", async () => {
    const rows = utf16Pair("hello", { bom: false, encoding: "utf-16be" });
    const mapped = mapNativeCaptureWire(wireV2(rows), wireContext());
    const runtime = await scanner({ codecs: mapped.codecs,
      policy: { revision: wireContext().policy.revision, blockLikelySecrets: false, contentRules: [] } });
    try {
      const result = await evaluateCaptureContentPolicyV2(mapped.input, { currentPolicyRevision: () => wireContext().policy.revision, scan: runtime.scan });
      expect(result.status).toBe("eligible");
      if (result.status !== "eligible") throw new Error("explicit-framing-not-admitted");
      expect(Array.from(result.admittedRepresentations[1]!.bytes)).toEqual(Array.from(rows[1]!.bytes));
    } finally { await runtime.dispose(); }
  });
  it("retains allowed raw NUL text when content rules are explicitly disabled", async () => {
    const rows = utf16Pair("hello\0", { terminated: false });
    const context = { ...wireContext(), policy: { ...wireContext().policy, contentRulesEnabled: false } };
    const mapped = mapNativeCaptureWire(wireV2(rows), context);
    const result = await evaluateCaptureContentPolicyV2(mapped.input, {
      currentPolicyRevision: () => context.policy.revision, scan: async () => { throw new Error("must-not-scan"); },
    });
    expect(result.status).toBe("eligible");
    if (result.status !== "eligible") throw new Error("raw-standard-representations-lost");
    expect(result.admittedRepresentations).toHaveLength(2);
    expect(result.receipt.representations.every((row) => row.contentScanStatus === "not-scanned")).toBe(true);
  });
  it.each(["missing-text", "derived-exact", "compatible-no-source", "text-exact", "standalone-reference"])("rejects unproved UTF16 relationship %s", (kind) => {
    const rows = kind === "missing-text" ? utf16Pair("hello\0", { body: "hello", terminated: false }) : utf16Pair("hello");
    if (kind === "missing-text" || kind === "derived-exact" || kind === "compatible-no-source" || kind === "standalone-reference") delete rows[1]!.nativeCodec.text;
    if (kind === "derived-exact" || kind === "text-exact") rows[1]!.fidelity = "exact";
    if (kind === "compatible-no-source" || kind === "standalone-reference") delete rows[1]!.derivedFrom;
    if (kind === "standalone-reference") rows[1]!.fidelity = "reference";
    expect(() => mapNativeCaptureWire(wireV2(rows), wireContext())).toThrow();
  });
  it.each([true, false])("keeps known BOM-less raw availability separate from scan eligibility: rules %s", async (enabled) => {
    const row = capturedWireRow("public.utf16-external-plain-text", "no-bom");
    const context = { ...wireContext(), policy: { ...wireContext().policy, contentRulesEnabled: enabled } };
    const mapped = mapNativeCaptureWire(wireFrame(wireMetadata([row.metadata]), row.bytes), context);
    expect(mapped.input.representations[0]?.state).toBe("captured"); expect(mapped.codecs).toEqual([]);
    const runtime = await scanner({ codecs: [], policy: { revision: context.policy.revision, blockLikelySecrets: false, contentRules: [] } });
    try {
      const result = await evaluateCaptureContentPolicyV2(mapped.input, { currentPolicyRevision: () => context.policy.revision,
        scan: enabled ? runtime.scan : async () => { throw new Error("must-not-scan"); } });
      expect(result.status).toBe(enabled ? "denied" : "eligible");
      if (result.status === "eligible") expect(result.receipt.representations[0]?.contentScanStatus).toBe("not-scanned");
    } finally { await runtime.dispose(); }
  });
  it("preserves Windows validation code page facts while leaving ANSI decoding unsupported", () => {
    const nativeCodec = { ...windowsCodec("windows-acp-url-1252"), validationCodePage: 1252 };
    const mapped = mapNativeCaptureWire(wireV2([{ nativeName: "UniformResourceLocator", bytes: Buffer.from("https://example.invalid\0"), nativeCodec }], "windows"), { ...wireContext(), platform: "windows" });
    expect(mapped.identities[0]?.nativeCodec).toEqual(nativeCodec);
    expect(mapped.input.representations[0]).toMatchObject({ state: "unavailable", reasonCode: "unsupported" });
  });
  it("passes valid Windows container bytes through the container scanner and gate", async () => {
    const bytes = cfHtml("<b>中文🙂</b>");
    const mapped = mapNativeCaptureWire(wireV2([{ nativeName: "HTML Format", bytes, nativeCodec: windowsCodec("cf-html-offset-format") }], "windows"), { ...wireContext(), platform: "windows" });
    const runtime = await scanner({ codecs: mapped.codecs,
      policy: { revision: wireContext().policy.revision, blockLikelySecrets: false, contentRules: [] } });
    try {
      const result = await evaluateCaptureContentPolicyV2(mapped.input, { currentPolicyRevision: () => wireContext().policy.revision, scan: runtime.scan });
      expect(result.status).toBe("eligible");
      if (result.status === "eligible") expect(Array.from(result.admittedRepresentations[0]!.bytes)).toEqual(Array.from(bytes));
    } finally { await runtime.dispose(); }
  });
  it.each(["utf-8", "windows-acp-raw"])("rejects %s mislabeled as native Windows HTML", (encoding) => {
    const frame = wireV2([{ nativeName: "HTML Format", bytes: cfHtml(), nativeCodec: windowsCodec(encoding) }], "windows");
    expect(() => mapNativeCaptureWire(frame, { ...wireContext(), platform: "windows" })).toThrow();
  });
});
