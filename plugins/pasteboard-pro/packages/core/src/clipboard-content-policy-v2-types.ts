import { z } from "zod";
import { isArrayBufferBackedUint8ArrayV2 } from "./clipboard-content-policy-bytes.js";

const Identifier = z.string().min(1).max(128).regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/);
const Revision = z.string().min(1).max(512).refine((value) => value.trim().length > 0);
const Sha256 = z.string().regex(/^[0-9a-f]{64}$/);
const ItemIndex = z.number().int().safe().refine((value) => value >= 0 && value <= 31);


export const ContentKindV2Schema = z.enum(["text", "rich-text", "url", "image", "file-reference"]);
export type ContentKindV2 = z.infer<typeof ContentKindV2Schema>;
export const ScanScopeV2Schema = z.enum([
  "text",
  "links",
  "ocr",
  "image-metadata",
  "file-reference-metadata",
  "file-body",
]);
export type ScanScopeV2 = z.infer<typeof ScanScopeV2Schema>;
export const ContentScanStatusV2Schema = z.enum(["passed", "blocked", "not-scanned"]);
export type ContentScanStatusV2 = z.infer<typeof ContentScanStatusV2Schema>;
export const ScanScopeStatusV2Schema = z.enum(["passed", "blocked", "not-scanned"]);
export type ScanScopeStatusV2 = z.infer<typeof ScanScopeStatusV2Schema>;

type RepresentationIdentity = { representationKey: string; itemIndex: number };

function addRepresentationListIssues(
  rows: readonly RepresentationIdentity[],
  path: Array<string | number>,
  ctx: z.RefinementCtx,
): void {
  const seen = new Set<string>();
  const counts = new Map<number, number>();
  let previousIndex = -1;

  rows.forEach((row, position) => {
    const rowPath = [...path, position];
    if (seen.has(row.representationKey)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: [...rowPath, "representationKey"],
        message: "representation keys must be unique",
      });
    }
    seen.add(row.representationKey);
    if (row.itemIndex < previousIndex) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: [...rowPath, "itemIndex"],
        message: "representations must be ordered by nondecreasing item index",
      });
    }
    previousIndex = row.itemIndex;

    const count = (counts.get(row.itemIndex) ?? 0) + 1;
    counts.set(row.itemIndex, count);
    if (count > 32) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: rowPath,
        message: "each item may have at most 32 representations",
        params: { limit: "representations-per-item" },
      });
    }
  });
}

const PolicyV2Schema = z
  .object({
    revision: Revision,
    contentRulesEnabled: z.boolean(),
    requireFileBodyScan: z.boolean(),
  })
  .strict();
const PreflightV2Schema = z
  .object({
    capturedRevision: Revision,
    policyRevision: Revision,
    captureAllowed: z.boolean(),
    localHistoryAllowed: z.boolean(),
    cloudUploadAllowed: z.boolean(),
  })
  .strict();
const CapturedRepresentationV2Schema = z
  .object({
    representationKey: Identifier,
    itemIndex: ItemIndex,
    state: z.literal("captured"),
    contentKind: ContentKindV2Schema,
    // The kind is a trusted native-codec classification from the host, never MIME or renderer proof.
    bytes: z.custom<Uint8Array>(isArrayBufferBackedUint8ArrayV2),
  })
  .strict();
const UnavailableRepresentationV2Schema = z
  .object({
    representationKey: Identifier,
    itemIndex: ItemIndex,
    state: z.literal("unavailable"),
    reasonCode: z.enum(["unsupported", "timeout", "over-limit", "failed"]),
  })
  .strict();

export const CaptureContentPolicyInputV2Schema = z
  .object({
    attemptId: Identifier,
    snapshotId: Identifier,
    manifestRevision: Identifier,
    receiptId: Identifier,
    capturedRevision: Revision,
    observedRevision: Revision,
    policy: PolicyV2Schema,
    preflight: PreflightV2Schema,
    representations: z
      .array(z.discriminatedUnion("state", [
        CapturedRepresentationV2Schema,
        UnavailableRepresentationV2Schema,
      ]))
      .min(1)
      .max(1024),
  })
  .strict()
  .superRefine((input, ctx) => {
    if (!input.policy.contentRulesEnabled && input.policy.requireFileBodyScan) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["policy", "requireFileBodyScan"],
        message: "file body scanning cannot be required while content rules are disabled",
      });
    }
    addRepresentationListIssues(input.representations, ["representations"], ctx);
    if (input.preflight.capturedRevision !== input.capturedRevision) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["preflight", "capturedRevision"],
        message: "preflight must bind the captured clipboard revision",
      });
    }
    if (input.preflight.policyRevision !== input.policy.revision) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["preflight", "policyRevision"],
        message: "preflight must bind the active content policy revision",
      });
    }
  });
export type CaptureContentPolicyInputV2 = z.infer<typeof CaptureContentPolicyInputV2Schema>;

export const ContentScanCheckV2Schema = z
  .object({ scope: ScanScopeV2Schema, status: ScanScopeStatusV2Schema })
  .strict();
export type ContentScanCheckV2 = z.infer<typeof ContentScanCheckV2Schema>;

const ReceiptCheckV2Schema = z
  .object({
    scope: ScanScopeV2Schema,
    status: z.enum(["passed", "not-scanned"]),
  })
  .strict()
  .refine((check) => check.scope !== "file-body" || check.status === "not-scanned", {
    message: "file bodies are not inspected by the reference-only capture gate",
  });
type ReceiptCheckV2 = z.infer<typeof ReceiptCheckV2Schema>;

function addReceiptCheckIssues(
  contentKind: ContentKindV2,
  checks: readonly ReceiptCheckV2[],
  contentScanStatus: "passed" | "not-scanned",
  requireUniformStatus: boolean,
  path: Array<string | number>,
  ctx: z.RefinementCtx,
): void {
  const scopes = checks.map((check) => check.scope);
  const expected: readonly string[] = contentKind === "text"
    ? ["text"]
    : contentKind === "rich-text" || contentKind === "url"
      ? ["text", "links"]
      : contentKind === "image"
        ? ["ocr", "image-metadata"]
        : scopes.includes("file-body")
          ? ["file-reference-metadata", "file-body"]
          : ["file-reference-metadata"];
  if (
    scopes.length !== expected.length ||
    scopes.some((scope, index) => scope !== expected[index]) ||
    new Set(scopes).size !== scopes.length
  ) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: [...path, "checks"],
      message: "checks must cover required scopes in canonical order",
    });
  }

  const allPassed = checks.length > 0 && checks.every((check) => check.status === "passed");
  const allNotScanned = checks.length > 0 && checks.every((check) => check.status === "not-scanned");
  if (contentScanStatus !== (allPassed ? "passed" : "not-scanned")) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: [...path, "contentScanStatus"],
      message: "content scan status must summarize required scope checks",
    });
  }
  if (requireUniformStatus && !allPassed && !allNotScanned) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: [...path, "checks"],
      message: "retained checks must all pass or all be not scanned",
    });
  }
  if (!requireUniformStatus && !checks.some((check) => check.status === "not-scanned")) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: [...path, "checks"],
      message: "unretained representations require an unavailable check",
    });
  }
}

const UnavailableReceiptRepresentationV2Schema = z
  .object({
    representationKey: Identifier,
    itemIndex: ItemIndex,
    retentionAllowed: z.literal(false),
    contentScanStatus: z.literal("not-scanned"),
    checks: z.array(ReceiptCheckV2Schema).length(0),
    reasonCode: z.enum(["unsupported", "timeout", "over-limit", "failed"]),
  })
  .strict();

const RetainedReceiptRepresentationV2Schema = z
  .object({
    representationKey: Identifier,
    itemIndex: ItemIndex,
    contentKind: ContentKindV2Schema,
    retentionAllowed: z.literal(true),
    contentScanStatus: z.enum(["passed", "not-scanned"]),
    checks: z.array(ReceiptCheckV2Schema).min(1).max(6),
    byteLength: z.number().int().nonnegative().safe(),
    sha256: Sha256,
  })
  .strict()
  .superRefine((row, ctx) => {
    addReceiptCheckIssues(row.contentKind, row.checks, row.contentScanStatus, true, [], ctx);
  });

const UnretainedReceiptRepresentationV2Schema = z
  .object({
    representationKey: Identifier,
    itemIndex: ItemIndex,
    contentKind: ContentKindV2Schema,
    retentionAllowed: z.literal(false),
    contentScanStatus: z.literal("not-scanned"),
    checks: z.array(ReceiptCheckV2Schema).min(1).max(6),
    reasonCode: z.literal("required-check-unavailable"),
  })
  .strict()
  .superRefine((row, ctx) => {
    addReceiptCheckIssues(row.contentKind, row.checks, row.contentScanStatus, false, [], ctx);
  });

const ReceiptRepresentationV2Schema = z.union([
  UnavailableReceiptRepresentationV2Schema,
  RetainedReceiptRepresentationV2Schema,
  UnretainedReceiptRepresentationV2Schema,
]);

export const CaptureContentPolicyReceiptV2Schema = z
  .object({
    schemaVersion: z.literal(2),
    receiptId: Identifier,
    attemptId: Identifier,
    snapshotId: Identifier,
    manifestRevision: Identifier,
    policyRevision: Revision,
    capturedRevision: Revision,
    observedRevision: Revision,
    cloudUploadEligible: z.boolean(),
    representations: z.array(ReceiptRepresentationV2Schema).min(1).max(1024),
    permissions: z
      .object({
        preview: z.literal(false),
        paste: z.literal(false),
        sync: z.literal(false),
      })
      .strict(),
  })
  .strict()
  .superRefine((receipt, ctx) => {
    addRepresentationListIssues(receipt.representations, ["representations"], ctx);
  });
export type CaptureContentPolicyReceiptV2 = z.infer<typeof CaptureContentPolicyReceiptV2Schema>;

const AdmittedRepresentationV2Schema = z
  .object({
    representationKey: Identifier,
    itemIndex: ItemIndex,
    contentKind: ContentKindV2Schema,
    bytes: z.custom<Uint8Array>(isArrayBufferBackedUint8ArrayV2),
  })
  .strict();
export type AdmittedRepresentationV2 = z.infer<typeof AdmittedRepresentationV2Schema>;

const RequestFailureV2Schema = z.union([
  z.object({ status: z.literal("invalid-request"), reasonCode: z.literal("invalid-input") }).strict(),
  z.object({ status: z.literal("over-limit"), reasonCode: z.literal("payload-too-large") }).strict(),
  z.object({ status: z.literal("policy-changed"), reasonCode: z.literal("policy-changed") }).strict(),
  z.object({
    status: z.literal("policy-unavailable"),
    reasonCode: z.enum(["policy-unavailable", "hash-unavailable"]),
  }).strict(),
]);
const DeniedResultV2Schema = z
  .object({
    status: z.literal("denied"),
    attemptId: Identifier,
    outcomeCode: z.literal("policy-denied"),
    reasonCode: z.enum([
      "preflight-denied",
      "content-match",
      "scanner-response-over-limit",
      "no-eligible-representations",
    ]),
  })
  .strict();
const UnavailableResultV2Schema = z
  .object({
    status: z.literal("unavailable"),
    attemptId: Identifier,
    outcomeCode: z.enum(["unsupported", "timeout", "over-limit", "capture-failed"]),
    reasonCode: z.literal("no-materialized-representations"),
  })
  .strict();

const EligibleResultV2Schema = z
  .object({
    status: z.enum(["eligible", "partial"]),
    receipt: CaptureContentPolicyReceiptV2Schema,
    admittedRepresentations: z.array(AdmittedRepresentationV2Schema).min(1).max(1024),
  })
  .strict()
  .superRefine((result, ctx) => {
    const retained = result.receipt.representations.filter((row) => row.retentionAllowed);
    if (result.admittedRepresentations.length !== retained.length) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["admittedRepresentations"],
        message: "admitted representations must match retained receipt rows",
      });
    }
    result.admittedRepresentations.forEach((admitted, position) => {
      const row = retained[position];
      if (
        row === undefined ||
        row.representationKey !== admitted.representationKey ||
        row.itemIndex !== admitted.itemIndex ||
        row.contentKind !== admitted.contentKind ||
        row.byteLength !== admitted.bytes.byteLength
      ) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["admittedRepresentations", position],
          message: "admitted bytes must match a retained receipt row in order",
        });
      }
    });
    const complete = retained.length === result.receipt.representations.length;
    if ((result.status === "eligible") !== complete || (result.status === "partial" && retained.length === 0)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["status"],
        message: "eligible and partial status must match receipt coverage",
      });
    }
  });

export const CaptureContentPolicyResultV2Schema = z.union([
  RequestFailureV2Schema,
  DeniedResultV2Schema,
  UnavailableResultV2Schema,
  EligibleResultV2Schema,
]);
export type CaptureContentPolicyResultV2 = z.infer<typeof CaptureContentPolicyResultV2Schema>;

export type ContentPolicyScanRequestV2 = {
  policyRevision: string;
  representationKey: string;
  itemIndex: number;
  contentKind: ContentKindV2;
  requiredScopes: readonly ScanScopeV2[];
  bytes: Uint8Array;
};
export type ContentPolicyScanResultV2 = readonly ContentScanCheckV2[];
export type CaptureContentPolicyDependenciesV2 = {
  currentPolicyRevision: () => string;
  scan: (request: ContentPolicyScanRequestV2) => Promise<ContentPolicyScanResultV2>;
};
