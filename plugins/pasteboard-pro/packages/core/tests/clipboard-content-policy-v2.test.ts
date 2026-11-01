import { describe, expect, it } from "vitest";
import { evaluateCaptureContentPolicyV2, CaptureContentPolicyReceiptV2Schema } from "../src/clipboard-content-policy-v2";
import { admission, candidate, captured, dependencies, unavailable, type ScanRequest } from "./clipboard-content-policy-fixtures";

describe("V2 whole-copy content admission", () => {
  it("keeps disabled content checks not-scanned while preserving revision bindings", async () => {
    const input = candidate([captured("text"), captured("image", "image"), captured("files", "file-reference")]);
    input.policy.contentRulesEnabled = false;
    input.preflight.cloudUploadAllowed = true;
    const deps = dependencies();
    const result = admission(await evaluateCaptureContentPolicyV2(input, deps));
    expect(result.status).toBe("eligible");
    expect(deps.scan).not.toHaveBeenCalled();
    expect(result.receipt.capturedRevision).toBe("41");
    expect(result.receipt.observedRevision).toBe("43");
    expect(result.receipt.cloudUploadEligible).toBe(true);
    expect(result.receipt.permissions).toEqual({ preview: false, paste: false, sync: false });
    expect(result.receipt.representations.every((row) => row.contentScanStatus === "not-scanned")).toBe(true);
    expect(result.receipt.representations.every((row) => row.retentionAllowed)).toBe(true);
    expect(CaptureContentPolicyReceiptV2Schema.safeParse(result.receipt).success).toBe(true);
    expect(JSON.stringify(result.receipt)).not.toContain("safe");
  });

  it.each(["captureAllowed", "localHistoryAllowed"] as const)("refuses a %s preflight denial without scanning", async (flag) => {
    const input = candidate();
    input.preflight[flag] = false;
    const deps = dependencies();
    const result = await evaluateCaptureContentPolicyV2(input, deps);
    expect(result).toEqual({ status: "denied", attemptId: "attempt-1", outcomeCode: "policy-denied", reasonCode: "preflight-denied" });
    expect(deps.scan).not.toHaveBeenCalled();
  });


  it("honors a source preflight denial even when every native format is unavailable", async () => {
    const input = candidate([unavailable()]); input.preflight.captureAllowed = false;
    const deps = dependencies();
    expect(await evaluateCaptureContentPolicyV2(input, deps)).toEqual({ status: "denied", attemptId: "attempt-1", outcomeCode: "policy-denied", reasonCode: "preflight-denied" });
    expect(deps.scan).not.toHaveBeenCalled();
  });

  it("denies an oversized scanner response without overlooking a match beyond the inspection bound", async () => {
    const response = Array.from({ length: 13 }, (_, i) => ({ scope: "text", status: i === 12 ? "blocked" : "passed" }));
    const deps = dependencies();
    deps.scan.mockImplementation(async (request: ScanRequest) => request.representationKey === "large" ? response as never
      : request.requiredScopes.map((scope) => ({ scope, status: "passed" as const })));
    const result = await evaluateCaptureContentPolicyV2(candidate([captured("plain"), captured("large")]), deps);
    expect(result).toEqual({ status: "denied", attemptId: "attempt-1", outcomeCode: "policy-denied", reasonCode: "scanner-response-over-limit" });
    expect(result).not.toHaveProperty("receipt");
    expect(result).not.toHaveProperty("admittedRepresentations");
  });

  it("rejects a stored receipt that claims file-body checking over reference-only data", async () => {
    const result = admission(await evaluateCaptureContentPolicyV2(candidate([captured("files", "file-reference")]), dependencies()));
    const rows = result.receipt.representations.map((row) => ({ ...row, checks: [
      { scope: "file-reference-metadata", status: "passed" }, { scope: "file-body", status: "passed" },
    ] }));
    expect(CaptureContentPolicyReceiptV2Schema.safeParse({ ...result.receipt, representations: rows }).success).toBe(false);
  });

  it("keeps native cloud denial separate from permitted local retention", async () => {
    const result = admission(await evaluateCaptureContentPolicyV2(candidate(), dependencies()));
    expect(result.status).toBe("eligible");
    expect(result.receipt.cloudUploadEligible).toBe(false);
    expect(result.receipt.permissions.sync).toBe(false);
    expect(result.admittedRepresentations).toHaveLength(1);
  });

  it("requests every required content scope rather than passing rich formats through a plain-text result", async () => {
    const input = candidate([
      captured("text", "text"), captured("html", "rich-text"), captured("url", "url"),
      captured("png", "image"), captured("files", "file-reference"),
    ]);
    const deps = dependencies();
    const result = admission(await evaluateCaptureContentPolicyV2(input, deps));
    expect(result.status).toBe("eligible");
    expect(deps.scan.mock.calls.map(([request]) => [request.representationKey, request.requiredScopes])).toEqual([
      ["text", ["text"]], ["html", ["text", "links"]], ["url", ["text", "links"]],
      ["png", ["ocr", "image-metadata"]], ["files", ["file-reference-metadata"]],
    ]);
    expect(result.receipt.representations.every((row) => row.contentScanStatus === "passed")).toBe(true);
  });

  it("redacts the entire copy when a later HTML or RTF representation matches", async () => {
    const secret = "secret-in-rich-payload";
    const input = candidate([captured("plain"), captured("html", "rich-text", secret), captured("later")]);
    const deps = dependencies();
    deps.scan.mockImplementation(async (request: ScanRequest) => request.requiredScopes.map((scope) => ({
      scope, status: new TextDecoder().decode(request.bytes).includes(secret) ? "blocked" : "passed",
    })) as never);
    const result = await evaluateCaptureContentPolicyV2(input, deps);
    expect(result).toEqual({ status: "denied", attemptId: "attempt-1", outcomeCode: "policy-denied", reasonCode: "content-match" });
    expect(deps.scan).toHaveBeenCalledTimes(2);
    for (const forbidden of [secret, "receipt", "admittedRepresentations", "snapshot-1", "sha256", "html"]) {
      expect(JSON.stringify(result)).not.toContain(forbidden);
    }
  });

  it("keeps a safe subset when OCR cannot run and never hashes the rejected image in its receipt", async () => {
    const input = candidate([captured("plain"), captured("png", "image")]);
    const deps = dependencies();
    deps.scan.mockImplementation(async (request: ScanRequest) => request.requiredScopes.map((scope) => ({
      scope, status: scope === "ocr" ? "not-scanned" : "passed",
    })) as never);
    const result = admission(await evaluateCaptureContentPolicyV2(input, deps));
    expect(result.status).toBe("partial");
    expect(result.admittedRepresentations.map((rep) => rep.representationKey)).toEqual(["plain"]);
    expect(result.receipt.representations[1]).toMatchObject({ representationKey: "png", retentionAllowed: false,
      contentScanStatus: "not-scanned", reasonCode: "required-check-unavailable" });
    expect(result.receipt.representations[1]).not.toHaveProperty("sha256");
    expect(result.receipt.representations[1]).not.toHaveProperty("byteLength");
    expect(CaptureContentPolicyReceiptV2Schema.safeParse(result.receipt).success).toBe(true);
  });

  it("does not treat checked file names as scanned file bodies", async () => {
    const input = candidate([captured("files", "file-reference")]);
    input.policy.requireFileBodyScan = true;
    const deps = dependencies();
    deps.scan.mockImplementation(async () => [{ scope: "file-reference-metadata", status: "passed" }] as never);
    const result = await evaluateCaptureContentPolicyV2(input, deps);
    expect(deps.scan.mock.calls[0]?.[0].requiredScopes).toEqual(["file-reference-metadata"]);
    expect(result).toMatchObject({ status: "denied", outcomeCode: "policy-denied", reasonCode: "no-eligible-representations" });
    expect(result).not.toHaveProperty("receipt");
  });


  it("cannot approve file-body inspection from a scanner given only reference bytes", async () => {
    const input = candidate([captured("files", "file-reference")]);
    input.policy.requireFileBodyScan = true;
    const deps = dependencies();
    deps.scan.mockImplementation(async () => [
      { scope: "file-reference-metadata", status: "passed" }, { scope: "file-body", status: "passed" },
    ] as never);
    const result = await evaluateCaptureContentPolicyV2(input, deps);
    expect(result).toMatchObject({ status: "denied", reasonCode: "no-eligible-representations" });
    expect(result).not.toHaveProperty("receipt");
  });

  it.each([
    { response: [{ scope: "text", status: "blocked" }, { scope: "ocr", status: "passed" }] },
    { response: [{ scope: "text", status: "blocked", debug: "private-extra" }] },
    { response: [{ scope: "text", status: "blocked" }, { scope: "text", status: "passed" }] },
  ])("never drops a recognized content match because another scanner field is malformed %#", async ({ response }) => {
    const deps = dependencies();
    deps.scan.mockImplementation(async (request: ScanRequest) => request.representationKey === "hit" ? response as never
      : request.requiredScopes.map((scope) => ({ scope, status: "passed" as const })));
    const result = await evaluateCaptureContentPolicyV2(candidate([captured("plain"), captured("hit")]), deps);
    expect(result).toMatchObject({ status: "denied", outcomeCode: "policy-denied", reasonCode: "content-match" });
    expect(result).not.toHaveProperty("receipt");
    expect(JSON.stringify(result)).not.toContain("private-extra");
  });

  it.each([
    { response: [{ scope: "text", status: "passed" }, { scope: "text", status: "passed" }] },
    { response: [{ scope: "text", status: "passed", debug: "private-error" }] },
    { response: [{ scope: "ocr", status: "passed" }] },
    { response: [{ scope: "text", status: "unknown" }] },
    { response: [Object.create({ scope: "text", status: "passed" })] },
    { response: "passed" },
    { response: [] },
  ])("fails closed on an invalid or incomplete scanner response %#", async ({ response }) => {
    const deps = dependencies();
    deps.scan.mockImplementation(async () => response as never);
    const result = await evaluateCaptureContentPolicyV2(candidate(), deps);
    expect(result).toMatchObject({ status: "denied", reasonCode: "no-eligible-representations" });
    expect(JSON.stringify(result)).not.toContain("private-error");
  });

  it("requires the link scope even after the rich-text scope passes", async () => {
    const input = candidate([captured("plain"), captured("rich", "rich-text")]);
    const deps = dependencies();
    deps.scan.mockImplementation(async () => [{ scope: "text", status: "passed" }]);
    const result = admission(await evaluateCaptureContentPolicyV2(input, deps));
    expect(result.status).toBe("partial");
    expect(result.receipt.representations[1]?.checks).toContainEqual({ scope: "links", status: "not-scanned" });
  });

  it("contains scanner exceptions while preserving independently checked representations", async () => {
    const deps = dependencies();
    deps.scan.mockImplementation(async (request: ScanRequest) => {
      if (request.representationKey === "rich") throw new Error("private-scanner-stack");
      return request.requiredScopes.map((scope) => ({ scope, status: "passed" as const }));
    });
    const result = admission(await evaluateCaptureContentPolicyV2(candidate([captured("plain"), captured("rich", "rich-text")]), deps));
    expect(result.status).toBe("partial");
    expect(result.admittedRepresentations).toHaveLength(1);
    expect(JSON.stringify(result.receipt)).not.toContain("private-scanner-stack");
  });

  it("accounts for unsupported formats without letting them bypass the codec boundary", async () => {
    const deps = dependencies();
    const result = admission(await evaluateCaptureContentPolicyV2(candidate([captured(), unavailable()]), deps));
    expect(result.status).toBe("partial");
    expect(deps.scan).toHaveBeenCalledTimes(1);
    expect(result.receipt.representations[1]).toMatchObject({ representationKey: "rep-2", retentionAllowed: false,
      reasonCode: "unsupported", contentScanStatus: "not-scanned", checks: [] });
    expect(result.receipt.representations[1]).not.toHaveProperty("sha256");
  });

  it.each([
    [[unavailable("a")], "unsupported"],
    [[unavailable("a"), unavailable("b", "failed")], "capture-failed"],
    [[unavailable("a", "over-limit"), unavailable("b", "failed")], "over-limit"],
    [[unavailable("a", "timeout"), unavailable("b", "over-limit")], "timeout"],
  ])("preserves capture failure outcomes when no representation was materialized %#", async (reps, outcomeCode) => {
    const deps = dependencies();
    const result = await evaluateCaptureContentPolicyV2(candidate(reps as unknown[]), deps);
    expect(result).toEqual({ status: "unavailable", attemptId: "attempt-1", outcomeCode, reasonCode: "no-materialized-representations" });
    expect(deps.scan).not.toHaveBeenCalled();
  });
});
