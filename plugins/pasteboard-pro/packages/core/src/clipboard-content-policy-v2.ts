import {
  copyCapturedUint8ArrayV2,
  inspectCapturedUint8ArrayV2,
  MAX_SNAPSHOT_BYTES_V2,
  maxFormatBytesV2,
  sha256CapturedBytesV2,
} from "./clipboard-content-policy-bytes.js";
import {
  CaptureContentPolicyInputV2Schema,
  CaptureContentPolicyReceiptV2Schema,
  ContentScanCheckV2Schema,
  ScanScopeV2Schema,
  type AdmittedRepresentationV2,
  type CaptureContentPolicyDependenciesV2,
  type CaptureContentPolicyInputV2,
  type CaptureContentPolicyReceiptV2,
  type CaptureContentPolicyResultV2,
  type ContentKindV2,
  type ContentPolicyScanRequestV2,
  type ContentScanCheckV2,
  type ScanScopeV2,
} from "./clipboard-content-policy-v2-types.js";

export * from "./clipboard-content-policy-v2-types.js";

type PreparedRepresentation = {
  input: CaptureContentPolicyInputV2["representations"][number];
  ownedBytes?: Uint8Array;
  byteLength: number;
};
type EvaluatedRepresentation = {
  input: CaptureContentPolicyInputV2["representations"][number];
  checks: ContentScanCheckV2[];
  contentScanStatus: "passed" | "blocked" | "not-scanned";
  retentionAllowed: boolean;
  reasonCode?: "unsupported" | "timeout" | "over-limit" | "failed" | "required-check-unavailable";
  byteLength?: number;
  sha256?: string;
  ownedBytes?: Uint8Array;
};

function freeze<T extends object>(value: T): T {
  return Object.freeze(value);
}

function requestFailure(
  status: "invalid-request" | "over-limit",
): CaptureContentPolicyResultV2 {
  return status === "over-limit"
    ? freeze({ status, reasonCode: "payload-too-large" as const })
    : freeze({ status, reasonCode: "invalid-input" as const });
}

function unavailablePolicy(): CaptureContentPolicyResultV2 {
  return freeze({ status: "policy-unavailable" as const, reasonCode: "policy-unavailable" as const });
}

function revisionFailure(state: "changed" | "unavailable"): CaptureContentPolicyResultV2 {
  return state === "changed"
    ? freeze({ status: "policy-changed" as const, reasonCode: "policy-changed" as const })
    : unavailablePolicy();
}

function checkPolicyRevision(
  getCurrentRevision: () => string,
  expected: string,
): "same" | "changed" | "unavailable" {
  try {
    const current = getCurrentRevision();
    if (typeof current !== "string" || current.trim().length === 0) return "unavailable";
    return current === expected ? "same" : "changed";
  } catch {
    return "unavailable";
  }
}

function requiredScopes(kind: ContentKindV2, requireFileBodyScan: boolean): readonly ScanScopeV2[] {
  switch (kind) {
    case "text": return ["text"];
    case "rich-text":
    case "url": return ["text", "links"];
    case "image": return ["ocr", "image-metadata"];
    case "file-reference":
      return requireFileBodyScan
        ? ["file-reference-metadata", "file-body"]
        : ["file-reference-metadata"];
  }
}

function hasOwnDataField(value: object, field: string): boolean {
  try {
    const descriptor = Object.getOwnPropertyDescriptor(value, field);
    return descriptor !== undefined && "value" in descriptor;
  } catch {
    return false;
  }
}

type ScannerResponse = { checks?: ContentScanCheckV2[]; blocked: boolean; overLimit?: true };

function readScannerResponse(
  value: unknown,
  requestedScopes: readonly ScanScopeV2[],
): ScannerResponse {
  const requested = new Set(requestedScopes);
  let length = 0;
  let isArray = false;
  try {
    isArray = Array.isArray(value);
    if (isArray) length = (value as unknown[]).length;
  } catch {
    return { blocked: false };
  }
  if (!isArray || !Number.isSafeInteger(length) || length < 0) return { blocked: false };

  // Inspect at most twelve rows. Oversized responses are invalid and cannot grant retention.
  let recognizedBlock = false;
  const inspectedLength = Math.min(length, 12);
  try {
    for (let index = 0; index < inspectedLength; index += 1) {
      const entry = (value as unknown[])[index];
      if (
        typeof entry !== "object" ||
        entry === null ||
        !hasOwnDataField(entry, "scope") ||
        !hasOwnDataField(entry, "status")
      ) continue;
      const scope = (entry as { scope: unknown }).scope;
      const status = (entry as { status: unknown }).status;
      if (typeof scope === "string" && requested.has(scope as ScanScopeV2) && status === "blocked") {
        recognizedBlock = true;
      }
    }
  } catch {
    return { blocked: recognizedBlock };
  }
  if (length > 12) return { blocked: recognizedBlock, overLimit: true };

  try {
    const checks: ContentScanCheckV2[] = [];
    const seen = new Set<ScanScopeV2>();
    for (let index = 0; index < length; index += 1) {
      const entry = (value as unknown[])[index];
      if (
        typeof entry !== "object" ||
        entry === null ||
        !hasOwnDataField(entry, "scope") ||
        !hasOwnDataField(entry, "status")
      ) return { blocked: recognizedBlock };

      const check = ContentScanCheckV2Schema.parse(entry);
      if (!requested.has(check.scope) || seen.has(check.scope)) {
        return { blocked: recognizedBlock };
      }
      seen.add(check.scope);
      checks.push(check);
    }
    return { checks, blocked: recognizedBlock };
  } catch {
    return { blocked: recognizedBlock };
  }
}

function summarizeChecks(checks: readonly ContentScanCheckV2[]): "passed" | "blocked" | "not-scanned" {
  if (checks.some((check) => check.status === "blocked")) return "blocked";
  return checks.length > 0 && checks.every((check) => check.status === "passed")
    ? "passed"
    : "not-scanned";
}

function freezeReceipt(
  input: CaptureContentPolicyInputV2,
  representations: readonly EvaluatedRepresentation[],
): CaptureContentPolicyReceiptV2 {
  const rows = representations.map((rep) => {
    const common = {
      representationKey: rep.input.representationKey,
      itemIndex: rep.input.itemIndex,
      retentionAllowed: rep.retentionAllowed,
      contentScanStatus: rep.contentScanStatus,
      checks: Object.freeze(rep.checks.map((check) => freeze({ ...check }))),
    };
    if (rep.input.state === "unavailable") return freeze({ ...common, reasonCode: rep.input.reasonCode });
    if (rep.retentionAllowed) {
      return freeze({
        ...common,
        contentKind: rep.input.contentKind,
        byteLength: rep.byteLength!,
        sha256: rep.sha256!,
      });
    }
    return freeze({
      ...common,
      contentKind: rep.input.contentKind,
      reasonCode: "required-check-unavailable" as const,
    });
  });
  return freeze({
    schemaVersion: 2 as const,
    receiptId: input.receiptId,
    attemptId: input.attemptId,
    snapshotId: input.snapshotId,
    manifestRevision: input.manifestRevision,
    policyRevision: input.policy.revision,
    capturedRevision: input.capturedRevision,
    observedRevision: input.observedRevision,
    cloudUploadEligible: input.preflight.cloudUploadAllowed,
    representations: Object.freeze(rows),
    permissions: freeze({ preview: false as const, paste: false as const, sync: false as const }),
  }) as CaptureContentPolicyReceiptV2;
}

function unavailableOutcome(
  attemptId: string,
  representations: CaptureContentPolicyInputV2["representations"],
): CaptureContentPolicyResultV2 {
  const reasons = representations.flatMap((rep) => rep.state === "unavailable" ? [rep.reasonCode] : []);
  const outcomeCode = reasons.includes("timeout")
    ? "timeout"
    : reasons.includes("over-limit")
      ? "over-limit"
      : reasons.includes("failed")
        ? "capture-failed"
        : "unsupported";
  return freeze({
    status: "unavailable" as const,
    attemptId,
    outcomeCode,
    reasonCode: "no-materialized-representations" as const,
  });
}

function isOverLimitIssue(issue: { code: string; path: Array<string | number>; params?: Record<string, unknown> }) {
  return (
    (issue.code === "too_big" && issue.path.at(-1) === "representations") ||
    (issue.code === "custom" && issue.params?.limit === "representations-per-item")
  );
}

/**
 * Applies preflight and content rules to owned bytes.
 * The host must recheck hashes and serialize final commit with policy activation.
 * scan must use a bounded worker/helper executor; this pure gate does not stop a
 * pending scanner or synchronous decoder and must not execute them on the UI thread.
 */
export async function evaluateCaptureContentPolicyV2(
  input: unknown,
  deps: CaptureContentPolicyDependenciesV2,
): Promise<CaptureContentPolicyResultV2> {
  let parsed: CaptureContentPolicyInputV2;
  try {
    const result = CaptureContentPolicyInputV2Schema.safeParse(input);
    if (!result.success) {
      return requestFailure(result.error.issues.some(isOverLimitIssue) ? "over-limit" : "invalid-request");
    }
    parsed = result.data;
  } catch {
    return requestFailure("invalid-request");
  }

  const byteInfos: Array<ReturnType<typeof inspectCapturedUint8ArrayV2>> = [];
  let totalBytes = 0;
  for (const rep of parsed.representations) {
    if (rep.state === "unavailable") {
      byteInfos.push(undefined);
      continue;
    }
    const info = inspectCapturedUint8ArrayV2(rep.bytes);
    if (info === undefined) return requestFailure("invalid-request");
    byteInfos.push(info);
    totalBytes += info.byteLength;
    if (info.byteLength > maxFormatBytesV2(rep.contentKind)) return requestFailure("over-limit");
  }
  if (totalBytes > MAX_SNAPSHOT_BYTES_V2) return requestFailure("over-limit");

  let getCurrentRevision: () => string;
  let scan: CaptureContentPolicyDependenciesV2["scan"];
  try {
    if (typeof deps !== "object" || deps === null) return unavailablePolicy();
    getCurrentRevision = deps.currentPolicyRevision;
    scan = deps.scan;
    if (typeof getCurrentRevision !== "function" || typeof scan !== "function") return unavailablePolicy();
  } catch {
    return unavailablePolicy();
  }

  const initialRevision = checkPolicyRevision(getCurrentRevision, parsed.policy.revision);
  if (initialRevision !== "same") return revisionFailure(initialRevision);
  if (!parsed.preflight.captureAllowed || !parsed.preflight.localHistoryAllowed) {
    return freeze({
      status: "denied" as const,
      attemptId: parsed.attemptId,
      outcomeCode: "policy-denied" as const,
      reasonCode: "preflight-denied" as const,
    });
  }

  if (parsed.representations.every((rep) => rep.state === "unavailable")) {
    return unavailableOutcome(parsed.attemptId, parsed.representations);
  }

  // Every length passed its budget before any owned copy is allocated.
  const prepared: PreparedRepresentation[] = [];
  try {
    parsed.representations.forEach((rep, index) => {
      if (rep.state === "unavailable") {
        prepared.push({ input: { ...rep }, byteLength: 0 });
        return;
      }
      const info = byteInfos[index];
      if (info === undefined) throw new Error();
      const bytes = copyCapturedUint8ArrayV2(info);
      prepared.push({ input: { ...rep, bytes }, ownedBytes: bytes, byteLength: info.byteLength });
    });
  } catch {
    return unavailablePolicy();
  }

  const frozenInput: CaptureContentPolicyInputV2 = freeze({
    ...parsed,
    policy: freeze({ ...parsed.policy }),
    preflight: freeze({ ...parsed.preflight }),
    representations: Object.freeze(
      prepared.map((entry) => freeze(entry.input)),
    ) as unknown as CaptureContentPolicyInputV2["representations"],
  });

  const evaluated: EvaluatedRepresentation[] = [];
  let contentMatched = false;
  let scannerResponseOverLimit = false;
  for (let index = 0; index < frozenInput.representations.length; index += 1) {
    const rep = frozenInput.representations[index]!;
    if (rep.state === "unavailable") {
      evaluated.push({
        input: rep,
        checks: [],
        contentScanStatus: "not-scanned",
        retentionAllowed: false,
        reasonCode: rep.reasonCode,
      });
      continue;
    }

    const ownedBytes = prepared[index]!.ownedBytes!;
    const scopes = requiredScopes(rep.contentKind, frozenInput.policy.requireFileBodyScan);
    const scannableScopes = Object.freeze(scopes.filter((scope) => scope !== "file-body"));
    let checks: ContentScanCheckV2[] = scopes.map((scope) => ({ scope, status: "not-scanned" }));
    if (frozenInput.policy.contentRulesEnabled) {
      let response: unknown;
      try {
        const info = inspectCapturedUint8ArrayV2(ownedBytes);
        if (info === undefined) throw new Error();
        const request: ContentPolicyScanRequestV2 = freeze({
          policyRevision: frozenInput.policy.revision,
          representationKey: rep.representationKey,
          itemIndex: rep.itemIndex,
          contentKind: rep.contentKind,
          requiredScopes: scannableScopes,
          bytes: copyCapturedUint8ArrayV2(info),
        });
        response = await scan(request);
      } catch {
        response = undefined;
      }
      const validation = readScannerResponse(response, scannableScopes);
      if (validation.blocked) {
        contentMatched = true;
        break;
      }
      if (validation.overLimit) {
        scannerResponseOverLimit = true;
        break;
      }
      if (validation.checks !== undefined) {
        const byScope = new Map(validation.checks.map((check) => [check.scope, check.status]));
        checks = scopes.map((scope) => ({
          scope,
          status: scope === "file-body" ? "not-scanned" : byScope.get(scope) ?? "not-scanned",
        }));
      }
    }

    const contentScanStatus = summarizeChecks(checks);
    const retentionAllowed =
      !frozenInput.policy.contentRulesEnabled ||
      (contentScanStatus === "passed" && checks.every((check) => check.status === "passed"));
    evaluated.push({
      input: rep,
      checks,
      contentScanStatus,
      retentionAllowed,
      ...(retentionAllowed ? { ownedBytes, byteLength: prepared[index]!.byteLength } : {
        reasonCode: "required-check-unavailable" as const,
      }),
    });
  }

  let hashUnavailable = false;
  if (!contentMatched && !scannerResponseOverLimit) {
    try {
      for (const rep of evaluated) {
        if (rep.retentionAllowed && rep.input.state === "captured") {
          rep.sha256 = await sha256CapturedBytesV2(rep.ownedBytes!);
        }
      }
    } catch {
      hashUnavailable = true;
    }
  }

  const finalRevision = checkPolicyRevision(getCurrentRevision, frozenInput.policy.revision);
  if (finalRevision !== "same") return revisionFailure(finalRevision);
  if (hashUnavailable) {
    return freeze({ status: "policy-unavailable" as const, reasonCode: "hash-unavailable" as const });
  }
  if (contentMatched) {
    return freeze({
      status: "denied" as const,
      attemptId: frozenInput.attemptId,
      outcomeCode: "policy-denied" as const,
      reasonCode: "content-match" as const,
    });
  }

  if (scannerResponseOverLimit) {
    return freeze({
      status: "denied" as const,
      attemptId: frozenInput.attemptId,
      outcomeCode: "policy-denied" as const,
      reasonCode: "scanner-response-over-limit" as const,
    });
  }

  const admitted = evaluated.filter((rep) => rep.retentionAllowed && rep.input.state === "captured");
  if (admitted.length === 0) {
    return freeze({
      status: "denied" as const,
      attemptId: frozenInput.attemptId,
      outcomeCode: "policy-denied" as const,
      reasonCode: "no-eligible-representations" as const,
    });
  }

  const receipt = freezeReceipt(frozenInput, evaluated);
  try {
    CaptureContentPolicyReceiptV2Schema.parse(receipt);
  } catch {
    return unavailablePolicy();
  }
  const status = evaluated.every((rep) => rep.retentionAllowed) ? "eligible" : "partial";
  const admittedRepresentations: AdmittedRepresentationV2[] = admitted.map((rep) => {
    const captured = rep.input as Extract<
      CaptureContentPolicyInputV2["representations"][number],
      { state: "captured" }
    >;
    return freeze({
      representationKey: captured.representationKey,
      itemIndex: captured.itemIndex,
      contentKind: captured.contentKind,
      bytes: rep.ownedBytes!,
    });
  });
  return freeze({
    status,
    receipt,
    admittedRepresentations: Object.freeze(admittedRepresentations),
  }) as unknown as CaptureContentPolicyResultV2;
}
