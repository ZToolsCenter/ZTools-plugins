import { expect, vi } from "vitest";
import { evaluateCaptureContentPolicyV2 } from "../src/clipboard-content-policy-v2";

export type ScanRequest = Parameters<Parameters<typeof evaluateCaptureContentPolicyV2>[1]["scan"]>[0];
export type ScanScope = ScanRequest["requiredScopes"][number];
export type ContentKind = ScanRequest["contentKind"];

export function captured(key = "rep-1", kind: ContentKind = "text", text = "safe") {
  return { representationKey: key, itemIndex: 0, state: "captured" as const,
    contentKind: kind, bytes: new TextEncoder().encode(text) };
}

export function unavailable(key = "rep-2", reasonCode = "unsupported") {
  return { representationKey: key, itemIndex: 0, state: "unavailable" as const, reasonCode };
}

export function candidate(representations: unknown[] = [captured()]) {
  return {
    attemptId: "attempt-1", snapshotId: "snapshot-1", manifestRevision: "manifest-1",
    receiptId: "receipt-1", capturedRevision: "41", observedRevision: "43",
    policy: { revision: "policy-1", contentRulesEnabled: true, requireFileBodyScan: false },
    preflight: { capturedRevision: "41", policyRevision: "policy-1", captureAllowed: true, localHistoryAllowed: true, cloudUploadAllowed: false },
    representations,
  };
}

export function dependencies() {
  return {
    currentPolicyRevision: vi.fn(() => "policy-1"),
    scan: vi.fn(async (request: ScanRequest) => request.requiredScopes.map((scope) => ({
      scope, status: "passed" as const,
    }))),
  };
}

export function admission(result: Awaited<ReturnType<typeof evaluateCaptureContentPolicyV2>>) {
  expect(["eligible", "partial"]).toContain(result.status);
  if (result.status !== "eligible" && result.status !== "partial") throw new Error("Expected admission");
  return result;
}
