import { describe, expect, it } from "vitest";
import { evaluateCaptureContentPolicyV2 } from "@pasteboard-pro/core";
import { codec, request, scanner } from "./content-scanner-v2-fixtures";

describe("real isolated V2 content scanning", () => {
  it("checks plaintext in a real worker and settles only after confirmed shutdown", async () => {
    const runtime = await scanner();
    try {
      expect(await runtime.scan(request())).toEqual([{ scope: "text", status: "passed" }]);
      expect(runtime.diagnostics()).toMatchObject({ started: 1, active: 0, completed: 1 });
      expect(runtime.diagnostics().terminated).toBeGreaterThanOrEqual(1);
    } finally { await runtime.dispose(); }
  });

  it.each([
    "Bearer abcdefghijklmnopqrstuvwxyz012345", "AKIAABCDEFGHIJKLMNOP",
    "-----BEGIN PRIVATE KEY-----", "ghp_abcdefghijklmnopqrstuvwxyz0123456789",
    "eyJabcdefghijklmnop.abcdefghijklmnop.abcdefghijklmnop",
  ])("blocks likely-secret family %# without returning the payload", async (body) => {
    const runtime = await scanner();
    try {
      const result = await runtime.scan(request(body));
      expect(result).toEqual([{ scope: "text", status: "blocked" }]);
      expect(JSON.stringify(runtime.diagnostics())).not.toContain(body);
      expect(JSON.stringify(result)).not.toContain(body);
    } finally { await runtime.dispose(); }
  });

  it.each([
    { type: "literal", value: "private-text" },
    { type: "wildcard", value: "*PRIVATE?TEXT*" },
    { type: "regex", value: "private-[a-z]+", flags: "i" },
  ] as const)("executes $type content rules in the worker", async (rule) => {
    const runtime = await scanner({ policy: { revision: "policy-1", blockLikelySecrets: false, contentRules: [rule] } });
    try { expect(await runtime.scan(request("prefix PRIVATE-TEXT suffix"))).toEqual([{ scope: "text", status: "blocked" }]); }
    finally { await runtime.dispose(); }
  });

  it("does not promote an unsupported regular expression to passed", async () => {
    const runtime = await scanner({ policy: { revision: "policy-1", blockLikelySecrets: false, contentRules: [{ type: "regex", value: "[" }] } });
    try { expect(await runtime.scan(request())).toEqual([{ scope: "text", status: "not-scanned" }]); }
    finally { await runtime.dispose(); }
  });

  it.each(["utf-16le", "utf-16be"] as const)("uses explicit %s encoding and NUL framing", async (encoding) => {
    const data = Buffer.from("Bearer abcdefghijklmnopqrstuvwxyz012345\0", "utf16le");
    if (encoding === "utf-16be") data.swap16();
    const runtime = await scanner({ codecs: [{ ...codec(), encoding, termination: "nul" }] });
    try {
      expect(await runtime.scan({ ...request(), bytes: data })).toEqual([{ scope: "text", status: "blocked" }]);
      expect(data.byteLength).toBeGreaterThan(0);
    } finally { await runtime.dispose(); }
  });

  it.each([new Uint8Array([0xc3, 0x28]), new Uint8Array([97, 0, 98])])("fails closed on malformed encoding or an interior NUL %#", async (bytes) => {
    const runtime = await scanner();
    try { expect(await runtime.scan({ ...request(), bytes })).toEqual([{ scope: "text", status: "not-scanned" }]); }
    finally { await runtime.dispose(); }
  });

  it("checks percent-encoded URL content without opening or rewriting it", async () => {
    const runtime = await scanner({ codecs: [codec("rep", "url")], policy: {
      revision: "policy-1", blockLikelySecrets: false, contentRules: [{ type: "literal", value: "private-text" }],
    } });
    const input = request("https://example.invalid/?q=private%2Dtext", "url");
    const original = input.bytes.slice();
    try {
      expect(await runtime.scan(input)).toEqual([{ scope: "text", status: "passed" }, { scope: "links", status: "blocked" }]);
      expect(input.bytes).toEqual(original);
    } finally { await runtime.dispose(); }
  });

  it("marks an uninterpretable URL escape as not-scanned", async () => {
    const runtime = await scanner({ codecs: [codec("rep", "url")] });
    try { expect(await runtime.scan(request("https://example.invalid/%FF", "url"))).toContainEqual({ scope: "links", status: "not-scanned" }); }
    finally { await runtime.dispose(); }
  });

  it("keeps rich text unavailable until an approved projector exists", async () => {
    const runtime = await scanner({ codecs: [codec("rep", "rich-text")] });
    try {
      expect(await runtime.scan(request("<b>private</b>", "rich-text"))).toEqual([{ scope: "text", status: "not-scanned" }, { scope: "links", status: "not-scanned" }]);
      expect(runtime.diagnostics().started).toBe(0);
    } finally { await runtime.dispose(); }
  });

  it("owns input bytes before the caller can mutate them or transfer them away", async () => {
    const runtime = await scanner();
    const input = request("Bearer abcdefghijklmnopqrstuvwxyz012345");
    try {
      const pending = runtime.scan(input);
      input.bytes.fill(0);
      expect(await pending).toEqual([{ scope: "text", status: "blocked" }]);
      expect(input.bytes.byteLength).toBeGreaterThan(0);
    } finally { await runtime.dispose(); }
  });

  it("feeds real results into the V2 whole-copy gate without granting downstream permissions", async () => {
    const runtime = await scanner({ codecs: [codec("plain"), codec("url", "url")] });
    const input = {
      attemptId: "attempt-1", snapshotId: "snapshot-1", manifestRevision: "manifest-1", receiptId: "receipt-1",
      capturedRevision: "41", observedRevision: "43", policy: { revision: "policy-1", contentRulesEnabled: true, requireFileBodyScan: false },
      preflight: { capturedRevision: "41", policyRevision: "policy-1", captureAllowed: true, localHistoryAllowed: true, cloudUploadAllowed: false },
      representations: [{ representationKey: "plain", itemIndex: 0, state: "captured", contentKind: "text", bytes: request().bytes },
        { representationKey: "url", itemIndex: 0, state: "captured", contentKind: "url", bytes: request("https://example.invalid/?token=Bearer%20abcdefghijklmnopqrstuvwxyz012345", "url").bytes }],
    };
    try {
      const result = await evaluateCaptureContentPolicyV2(input, { currentPolicyRevision: () => "policy-1", scan: runtime.scan });
      expect(result).toEqual({ status: "denied", attemptId: "attempt-1", outcomeCode: "policy-denied", reasonCode: "content-match" });
    } finally { await runtime.dispose(); }
  });
});
