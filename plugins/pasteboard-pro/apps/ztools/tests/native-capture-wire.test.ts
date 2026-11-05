import { describe, expect, it } from "vitest";
import { mapNativeCaptureWireV1 } from "../preload/native-capture-adapter";
import { capturedWireRow, wireContext, wireFrame, wireMetadata } from "./native-capture-wire-fixtures";

describe("native capture wire admission mapping", () => {
  it("keeps the captured revision distinct from the subsequently observed revision", () => {
    const result = mapNativeCaptureWireV1(wireFrame(), wireContext());
    expect(result.input.capturedRevision).toBe("7");
    expect(result.input.observedRevision).toBe("8");
    expect(result.input.preflight.capturedRevision).toBe("7");
    expect(result.input.preflight.cloudUploadAllowed).toBe(false);
    expect(result.input.representations[0]).toMatchObject({ itemIndex: 0, state: "captured", contentKind: "text" });
    expect(result.codecs[0]).toMatchObject({ contentKind: "text", encoding: "utf-8", termination: "none" });
  });
  it("takes owned bytes from the exact visible Buffer span", () => {
    const frame = wireFrame(); const backing = Buffer.concat([Buffer.from("prefix"), frame, Buffer.from("suffix")]);
    const span = backing.subarray(6, 6 + frame.length);
    const result = mapNativeCaptureWireV1(span, wireContext());
    span.fill(0);
    const row = result.input.representations[0];
    expect(row?.state).toBe("captured");
    if (row?.state === "captured") expect(new TextDecoder().decode(row.bytes)).toBe("hello");
  });
  it("preserves unknown formats as unavailable inventory rows", () => {
    const row = capturedWireRow("public.utf8-plain-text", "hello");
    const metadata = wireMetadata([row.metadata, { itemIndex: 0, nativeName: "example.private", state: "unavailable", reasonCode: "unsupported" }]);
    metadata.captureState = "partial";
    const result = mapNativeCaptureWireV1(wireFrame(metadata), wireContext());
    expect(result.input.representations).toHaveLength(2);
    expect(result.identities).toHaveLength(2);
    expect(result.input.representations[1]).toMatchObject({ itemIndex: 0, state: "unavailable", reasonCode: "unsupported" });
  });
  it("never guesses that a captured private format is plaintext", () => {
    const row = capturedWireRow("example.private", "hello");
    const result = mapNativeCaptureWireV1(wireFrame(wireMetadata([row.metadata]), row.bytes), wireContext());
    expect(result.input.representations[0]).toMatchObject({ state: "unavailable", reasonCode: "unsupported" });
    expect(result.codecs).toEqual([]);
  });
  it.each([
    (m: ReturnType<typeof wireMetadata>) => { m.requestId = "other-request"; },
    (m: ReturnType<typeof wireMetadata>) => { m.platform = "windows"; },
    (m: ReturnType<typeof wireMetadata>) => { m.policy.revision = "old-policy"; },
    (m: ReturnType<typeof wireMetadata>) => { m.expectedRevision = "6"; },
    (m: ReturnType<typeof wireMetadata>) => { m.capturedRevision = "07"; m.expectedRevision = "07"; },
    (m: ReturnType<typeof wireMetadata>) => { m.capturedRevision = "18446744073709551616"; m.expectedRevision = m.capturedRevision; },
    (m: ReturnType<typeof wireMetadata>) => { m.policy.captureAllowed = false; },
    (m: ReturnType<typeof wireMetadata>) => { m.policy.localHistoryAllowed = false; },
    (m: ReturnType<typeof wireMetadata>) => { m.sourceAttribution = "trusted"; },
    (m: ReturnType<typeof wireMetadata>) => { m.captureState = "partial"; },
  ])("rejects inconsistent request, revision, source or preflight metadata %#", (mutate) => {
    const metadata = wireMetadata(); mutate(metadata);
    expect(() => mapNativeCaptureWireV1(wireFrame(metadata), wireContext())).toThrow();
  });
  it("binds an explicit host expected revision", () => {
    expect(() => mapNativeCaptureWireV1(wireFrame(), { ...wireContext(), expectedRevision: "6" })).toThrow();
  });
  it.each([
    (m: Record<string, unknown>) => { m.extra = "private-text"; },
    (m: Record<string, unknown>) => { (m.representations as Array<Record<string, unknown>>)[0]!.offset = 1; },
    (m: Record<string, unknown>) => { (m.representations as Array<Record<string, unknown>>)[0]!.byteLength = 4; },
    (m: Record<string, unknown>) => { (m.representations as Array<Record<string, unknown>>)[0]!.sha256 = "0".repeat(64); },
    (m: Record<string, unknown>) => { (m.representations as Array<Record<string, unknown>>)[0]!.itemIndex = 32; },
    (m: Record<string, unknown>) => { (m.representations as Array<Record<string, unknown>>)[0]!.derivedFrom = "public.utf8-plain-text"; },
  ])("rejects framing identities and digest inconsistencies %#", (mutate) => {
    const metadata = wireMetadata(); mutate(metadata);
    expect(() => mapNativeCaptureWireV1(wireFrame(metadata), wireContext())).toThrow();
  });
  it.each([
    (frame: Buffer) => frame.subarray(0, frame.length - 1),
    (frame: Buffer) => Buffer.concat([frame, Buffer.from([0])]),
    (frame: Buffer) => Buffer.concat([frame, frame]),
    (frame: Buffer) => { frame[0] = 0; return frame; },
    (frame: Buffer) => { frame.writeUInt32LE(1024 * 1024 + 1, 8); return frame; },
    (frame: Buffer) => { frame.writeBigUInt64LE(200n * 1024n * 1024n + 1n, 12); return frame; },
  ])("rejects incomplete, trailing and over-budget frames before admission %#", (mutate) => {
    expect(() => mapNativeCaptureWireV1(mutate(wireFrame()), wireContext())).toThrow();
  });
  it.each([
    () => JSON.stringify(wireMetadata()).replace('"schemaVersion":1', '"schemaVersion":1,"schemaVersion":1'),
    () => " " + JSON.stringify(wireMetadata()),
  ])("rejects duplicate JSON keys and non-canonical metadata %#", (text) => {
    expect(() => mapNativeCaptureWireV1(wireFrame(undefined, undefined, text()), wireContext())).toThrow();
  });
  it("does not leak payload or metadata in thrown errors", () => {
    const metadata = wireMetadata(); metadata.requestId = "private-text";
    let failure: unknown;
    try { mapNativeCaptureWireV1(wireFrame(metadata), wireContext()); } catch (error) { failure = error; }
    expect(failure).toBeInstanceOf(Error);
    expect(String(failure)).not.toContain("private-text");
    expect(String(failure)).not.toContain("hello");
  });
  it("rejects shared and detached views without running user byte accessors", () => {
    expect(() => mapNativeCaptureWireV1(new Uint8Array(new SharedArrayBuffer(30)), wireContext())).toThrow();
    const detached = new Uint8Array(30); structuredClone(detached, { transfer: [detached.buffer] });
    expect(() => mapNativeCaptureWireV1(detached, wireContext())).toThrow();
    let accessed = false;
    const fake = Object.create(Uint8Array.prototype);
    Object.defineProperty(fake, "byteLength", { get() { accessed = true; return 30; } });
    expect(() => mapNativeCaptureWireV1(fake, wireContext())).toThrow();
    expect(accessed).toBe(false);
  });
  it.each(["", "bad\nformat", "\ud800", "雪".repeat(171)])("rejects malformed or over-byte-budget native identities %#", (name) => {
    const row = capturedWireRow(name, "hello");
    expect(() => mapNativeCaptureWireV1(wireFrame(wireMetadata([row.metadata])), wireContext())).toThrow();
  });
  it("uses UTF-8 bytes for the policy revision limit", () => {
    const revision = "雪".repeat(171); const metadata = wireMetadata(); metadata.policy.revision = revision;
    expect(() => mapNativeCaptureWireV1(wireFrame(metadata), {
      ...wireContext(), policy: { ...wireContext().policy, revision },
    })).toThrow();
  });
  it("rejects a zero-row native success frame", () => {
    expect(() => mapNativeCaptureWireV1(wireFrame(wireMetadata([]), Buffer.alloc(0)), wireContext())).toThrow();
  });
  it("enforces the uint32 Windows sequence range independently of uint64 macOS revisions", () => {
    const metadata = wireMetadata(); metadata.platform = "windows"; metadata.observedRevision = "4294967296";
    expect(() => mapNativeCaptureWireV1(wireFrame(metadata), { ...wireContext(), platform: "windows" })).toThrow();
  });
  it.each(["duplicate", "reverse-items", "cycle", "cross-item"])("rejects inconsistent row relationships %s", (kind) => {
    const first = capturedWireRow("format.a", "", kind === "reverse-items" ? 1 : 0).metadata;
    const second = capturedWireRow(kind === "duplicate" ? "format.a" : "format.b", "",
      kind === "cross-item" ? 1 : 0).metadata;
    const a = { ...first, ...(kind === "cycle" || kind === "cross-item" ? { derivedFrom: "format.b" } : {}) };
    const b = { ...second, ...(kind === "cycle" ? { derivedFrom: "format.a" } : {}) };
    expect(() => mapNativeCaptureWireV1(wireFrame(wireMetadata([a, b]), Buffer.alloc(0)), wireContext())).toThrow();
  });
  it("refuses 33 rows in a single item", () => {
    const rows = Array.from({ length: 33 }, (_, n) => capturedWireRow(`format.${n}`, "").metadata);
    expect(() => mapNativeCaptureWireV1(wireFrame(wireMetadata(rows), Buffer.alloc(0)), wireContext())).toThrow();
  });
  it.each(["bom", "invalid-utf8"])("rejects non-canonical UTF-8 metadata %s", (kind) => {
    const frame = kind === "bom" ? wireFrame(undefined, undefined, "\ufeff" + JSON.stringify(wireMetadata())) : wireFrame();
    if (kind === "invalid-utf8") frame[21] = 0xff;
    expect(() => mapNativeCaptureWireV1(frame, wireContext())).toThrow();
  });

  it.each([" \t\n", "\ufeff", "\u00a0\u1680\u2000\u200a\u2028\u2029\u202f\u205f\u3000"])("rejects policy revisions containing only trim whitespace %#", (revision) => {
    const metadata = wireMetadata(); metadata.policy.revision = revision;
    expect(() => mapNativeCaptureWireV1(wireFrame(metadata), {
      ...wireContext(), policy: { ...wireContext().policy, revision },
    })).toThrow();
  });

});
