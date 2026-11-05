import { createHash } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { evaluateCaptureContentPolicyV2, CaptureContentPolicyReceiptV2Schema } from "../src/clipboard-content-policy-v2";
import { admission, candidate, captured, dependencies, type ScanRequest } from "./clipboard-content-policy-fixtures";

const digest = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");
afterEach(() => vi.restoreAllMocks());

describe("V2 policy and owned-byte boundaries", () => {
  it("rejects a stale policy before handing any payload to a scanner", async () => {
    const deps = dependencies();
    deps.currentPolicyRevision.mockReturnValue("policy-2");
    const result = await evaluateCaptureContentPolicyV2(candidate(), deps);
    expect(result).toMatchObject({ status: "policy-changed" });
    expect(deps.scan).not.toHaveBeenCalled();
    expect(result).not.toHaveProperty("receipt");
  });


  it.each(["capture", "policy"])("rejects a preflight receipt bound to another %s", async (kind) => {
    const input = candidate();
    const deps = dependencies();
    if (kind === "capture") input.capturedRevision = "43";
    else {
      input.policy.revision = "policy-2";
      deps.currentPolicyRevision.mockReturnValue("policy-2");
    }
    const result = await evaluateCaptureContentPolicyV2(input, deps);
    expect(result).toMatchObject({ status: "invalid-request" });
    expect(result).not.toHaveProperty("receipt");
    expect(deps.scan).not.toHaveBeenCalled();
  });

  it("revokes the whole in-memory admission if policy changes during async scanning", async () => {
    const deps = dependencies();
    deps.scan.mockImplementation(async (request: ScanRequest) => {
      deps.currentPolicyRevision.mockReturnValue("policy-2");
      return request.requiredScopes.map((scope) => ({ scope, status: "passed" as const }));
    });
    const result = await evaluateCaptureContentPolicyV2(candidate(), deps);
    expect(result).toMatchObject({ status: "policy-changed" });
    expect(result).not.toHaveProperty("receipt");
    expect(result).not.toHaveProperty("admittedRepresentations");
  });


  it("revokes admission when the policy revision changes during hashing with scanning disabled", async () => {
    const input = candidate(); input.policy.contentRulesEnabled = false;
    const deps = dependencies();
    const originalDigest = crypto.subtle.digest.bind(crypto.subtle);
    vi.spyOn(crypto.subtle, "digest").mockImplementation(async (...args) => {
      const result = await originalDigest(...args);
      deps.currentPolicyRevision.mockReturnValue("policy-2");
      return result;
    });
    const result = await evaluateCaptureContentPolicyV2(input, deps);
    expect(result).toMatchObject({ status: "policy-changed" });
    expect(result).not.toHaveProperty("receipt");
    expect(result).not.toHaveProperty("admittedRepresentations");
    expect(deps.scan).not.toHaveBeenCalled();
  });

  it.each(["before", "after"])("contains a %s policy lookup failure", async (when) => {
    const deps = dependencies();
    if (when === "before") deps.currentPolicyRevision.mockImplementation(() => { throw new Error("secret-policy-error"); });
    else deps.scan.mockImplementation(async (request: ScanRequest) => {
      deps.currentPolicyRevision.mockImplementation(() => { throw new Error("secret-policy-error"); });
      return request.requiredScopes.map((scope) => ({ scope, status: "passed" as const }));
    });
    const result = await evaluateCaptureContentPolicyV2(candidate(), deps);
    expect(result).toMatchObject({ status: "policy-unavailable" });
    expect(JSON.stringify(result)).not.toContain("secret-policy-error");
    expect(result).not.toHaveProperty("receipt");
  });

  it("owns all bytes and identity fields before awaiting a scanner", async () => {
    const first = captured("first", "text", "original-one");
    const second = captured("second", "text", "original-two");
    const originalFirst = first.bytes.slice();
    const originalSecond = second.bytes.slice();
    const input = candidate([first, second]);
    const deps = dependencies();
    const seen: string[] = [];
    deps.scan.mockImplementation(async (request: ScanRequest) => {
      seen.push(new TextDecoder().decode(request.bytes));
      first.bytes.fill(0); second.bytes.fill(0);
      second.representationKey = "mutated-key";
      input.snapshotId = "mutated-snapshot";
      input.policy.revision = "mutated-policy";
      input.representations.length = 0;
      return request.requiredScopes.map((scope) => ({ scope, status: "passed" as const }));
    });
    const result = admission(await evaluateCaptureContentPolicyV2(input, deps));
    expect(seen).toEqual(["original-one", "original-two"]);
    expect(result.receipt.snapshotId).toBe("snapshot-1");
    expect(result.receipt.policyRevision).toBe("policy-1");
    expect(result.receipt.representations.map((row) => row.representationKey)).toEqual(["first", "second"]);
    expect(result.receipt.representations.map((row) => row.retentionAllowed ? row.sha256 : undefined)).toEqual([digest(originalFirst), digest(originalSecond)]);
    expect(result.admittedRepresentations.map((rep) => [...rep.bytes])).toEqual([[...originalFirst], [...originalSecond]]);
  });

  it("isolates a mutating scanner from bytes admitted for persistence", async () => {
    const rep = captured("rep", "text", "byte-preservation");
    const original = rep.bytes.slice();
    const deps = dependencies();
    deps.scan.mockImplementation(async (request: ScanRequest) => {
      request.bytes.fill(0);
      return request.requiredScopes.map((scope) => ({ scope, status: "passed" as const }));
    });
    const result = admission(await evaluateCaptureContentPolicyV2(candidate([rep]), deps));
    expect([...result.admittedRepresentations[0]!.bytes]).toEqual([...original]);
    expect(result.receipt.representations[0]).toMatchObject({ sha256: digest(original) });
    expect([...rep.bytes]).toEqual([...original]);
  });

  it("uses typed-array intrinsic spans instead of shadowed byteLength, buffer or slice", async () => {
    const bytes = new Uint8Array([0, 97, 98, 99, 0]).subarray(1, 4);
    Object.defineProperties(bytes, {
      byteLength: { value: 0 }, byteOffset: { value: 0 }, buffer: { value: new SharedArrayBuffer(1) },
      slice: { value: () => new Uint8Array([1]) },
    });
    const rep = captured(); rep.bytes = bytes;
    const input = candidate([rep]); input.policy.contentRulesEnabled = false;
    const result = admission(await evaluateCaptureContentPolicyV2(input, dependencies()));
    expect([...result.admittedRepresentations[0]!.bytes]).toEqual([97, 98, 99]);
    expect(result.receipt.representations[0]).toMatchObject({ byteLength: 3, sha256: "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad" });
  });

  it("rejects shared backing memory instead of racing a concurrent producer", async () => {
    const rep = captured(); rep.bytes = new Uint8Array(new SharedArrayBuffer(3));
    const deps = dependencies();
    const result = await evaluateCaptureContentPolicyV2(candidate([rep]), deps);
    expect(result).toMatchObject({ status: "invalid-request" });
    expect(deps.scan).not.toHaveBeenCalled();
  });

  it("rejects an already transferred buffer rather than admitting empty replacement bytes", async () => {
    const rep = captured();
    structuredClone(rep.bytes.buffer, { transfer: [rep.bytes.buffer as ArrayBuffer] });
    const deps = dependencies();
    expect(await evaluateCaptureContentPolicyV2(candidate([rep]), deps)).toMatchObject({ status: "invalid-request" });
    expect(deps.scan).not.toHaveBeenCalled();
  });

  it("accepts real Node Buffers and hashes only their visible span", async () => {
    const rep = captured(); rep.bytes = Buffer.from([8, 9, 10, 11]).subarray(1, 3);
    const result = admission(await evaluateCaptureContentPolicyV2(candidate([rep]), dependencies()));
    expect([...result.admittedRepresentations[0]!.bytes]).toEqual([9, 10]);
    expect(result.receipt.representations[0]).toMatchObject({ sha256: digest(new Uint8Array([9, 10])) });
  });

  it.each(["format", "text", "total"])("rejects an over-budget %s set before hashing or scanning", async (mode) => {
    const MiB = 1024 * 1024;
    const bytes = new Uint8Array(mode === "text" ? 10 * MiB + 1 : mode === "total" ? 80 * MiB : 100 * MiB + 1);
    const reps = mode === "total" ? ["a", "b", "c"].map((key) => ({ ...captured(key, "image"), bytes }))
      : [{ ...captured("a", mode === "text" ? "text" : "image"), bytes }];
    const deps = dependencies();
    const hash = vi.spyOn(crypto.subtle, "digest");
    const result = await evaluateCaptureContentPolicyV2(candidate(reps), deps);
    expect(result).toMatchObject({ status: "over-limit" });
    expect(deps.scan).not.toHaveBeenCalled();
    expect(hash).not.toHaveBeenCalled();
    expect(result).not.toHaveProperty("admittedRepresentations");
  });

  it("does not expose errors or a receipt when hashing is unavailable", async () => {
    vi.spyOn(crypto.subtle, "digest").mockRejectedValueOnce(new Error("private-hash-failure"));
    const result = await evaluateCaptureContentPolicyV2(candidate(), dependencies());
    expect(result).toMatchObject({ status: "policy-unavailable", reasonCode: "hash-unavailable" });
    expect(JSON.stringify(result)).not.toContain("private-hash-failure");
    expect(result).not.toHaveProperty("receipt");
  });

  it("strictly rejects invalid keys, contradictory policy, extra metadata and oversized item sets", async () => {
    const valid = candidate();
    const contradictory = candidate(); contradictory.policy.contentRulesEnabled = false; contradictory.policy.requireFileBodyScan = true;
    const descending = candidate([{ ...captured("a"), itemIndex: 1 }, captured("b")]);
    const cases: unknown[] = [
      { ...valid, snapshotId: "../bad" }, { ...valid, rawText: "private-extra" },
      { ...valid, policy: { ...valid.policy, contentRulesEnabled: "true" } }, contradictory,
      candidate([captured("duplicate"), captured("duplicate")]), descending,
      candidate([{ ...captured(), itemIndex: 32 }]),
      candidate([{ ...captured(), contentKind: "opaque-private" }]),
    ];
    for (const input of cases) {
      const deps = dependencies();
      expect(await evaluateCaptureContentPolicyV2(input, deps)).toMatchObject({ status: "invalid-request" });
      expect(deps.scan).not.toHaveBeenCalled();
    }
  });


  it("allows the documented 32 items times 32 representations rather than truncating at 32 total", async () => {
    const reps = Array.from({ length: 1024 }, (_, i) => ({ ...captured(`key-${i}`, "image", "x"), itemIndex: Math.floor(i / 32) }));
    const input = candidate(reps); input.policy.contentRulesEnabled = false;
    const result = admission(await evaluateCaptureContentPolicyV2(input, dependencies()));
    expect(result.status).toBe("eligible");
    expect(result.receipt.representations).toHaveLength(1024);
    expect(result.admittedRepresentations).toHaveLength(1024);
    expect(CaptureContentPolicyReceiptV2Schema.safeParse(result.receipt).success).toBe(true);
  });

  it.each([33, 1025])("rejects an over-budget representation count %s before scanning", async (count) => {
    const reps = Array.from({ length: count }, (_, i) => ({ ...captured(`key-${i}`), itemIndex: count === 33 ? 0 : Math.floor(i / 32) }));
    const deps = dependencies();
    expect(await evaluateCaptureContentPolicyV2(candidate(reps), deps)).toMatchObject({ status: "over-limit" });
    expect(deps.scan).not.toHaveBeenCalled();
  });

  it("does not let persisted receipts claim scanner completion or grant preview/paste/sync", async () => {
    const input = candidate(); input.policy.contentRulesEnabled = false;
    const result = admission(await evaluateCaptureContentPolicyV2(input, dependencies()));
    expect(Object.isFrozen(result.receipt)).toBe(true);
    expect(Object.isFrozen(result.receipt.representations)).toBe(true);
    expect(Object.isFrozen(result.admittedRepresentations)).toBe(true);
    for (const field of ["preview", "paste", "sync"]) {
      expect(CaptureContentPolicyReceiptV2Schema.safeParse({ ...result.receipt, permissions: { ...result.receipt.permissions, [field]: true } }).success).toBe(false);
    }
    expect(CaptureContentPolicyReceiptV2Schema.safeParse({ ...result.receipt, leakedBody: "private" }).success).toBe(false);
    const rows = result.receipt.representations.map((row) => ({ ...row, contentScanStatus: "passed" }));
    expect(CaptureContentPolicyReceiptV2Schema.safeParse({ ...result.receipt, representations: rows }).success).toBe(false);
  });
});
