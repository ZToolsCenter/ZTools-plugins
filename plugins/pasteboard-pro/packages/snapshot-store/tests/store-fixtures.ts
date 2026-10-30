import { createHash } from "node:crypto";
import type {
  CaptureContentPolicyInputV2,
  CaptureContentPolicyReceiptV2,
  ClipboardSnapshotManifestV2,
  ContentKindV2,
} from "@pasteboard-pro/core";

export type StoreRepresentationFixtureV2 = Readonly<{
  representationKey: string;
  itemIndex: number;
  contentKind: ContentKindV2;
  bytes: Uint8Array;
  unavailableReason?: "unsupported" | "timeout" | "over-limit" | "failed";
  formatId: string;
  nativeName: string;
  mime?: string;
  references?: readonly Readonly<{
    url: string;
    isDirectory: boolean;
    observedAvailability: "available" | "missing" | "unknown";
  }>[];
}>;

export type StoreCaptureFixtureV2 = Readonly<{
  capture: CaptureContentPolicyInputV2;
  rows: readonly StoreRepresentationFixtureV2[];
}>;

export type ProcessCrashScenarioV2 = "blob-published" | "journal-uncommitted" | "committed-control";

export function makeProcessCrashFixtureV2(scenario: ProcessCrashScenarioV2): StoreCaptureFixtureV2 {
  return makeStoreCaptureV2({
    attemptId: `process-${scenario}-attempt`,
    snapshotId: `process-${scenario}-snapshot`,
    manifestRevision: `process-${scenario}-manifest`,
    receiptId: `process-${scenario}-receipt`,
    capturedRevision: "synthetic-process-crash-revision",
    contentRulesEnabled: false,
    rows: [{
      representationKey: "process-crash-text",
      itemIndex: 0,
      contentKind: "text",
      bytes: new TextEncoder().encode(`synthetic durable payload for ${scenario}`),
      formatId: "public.utf8-plain-text",
      nativeName: "public.utf8-plain-text",
      mime: "text/plain;charset=utf-8",
    }],
  });
}

export function digestV2(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

export function makeStoreCaptureV2(options: Readonly<{
  attemptId?: string;
  snapshotId?: string;
  manifestRevision?: string;
  receiptId?: string;
  capturedRevision?: string;
  policyRevision?: string;
  contentRulesEnabled?: boolean;
  rows: readonly StoreRepresentationFixtureV2[];
}>): StoreCaptureFixtureV2 {
  const capturedRevision = options.capturedRevision ?? "clipboard-revision-1";
  const policyRevision = options.policyRevision ?? "policy-1";
  const rows = Object.freeze(options.rows.map((row) => Object.freeze({
    ...row,
    bytes: Uint8Array.from(row.bytes),
  })));
  return Object.freeze({
    rows,
    capture: {
      attemptId: options.attemptId ?? "attempt-1",
      snapshotId: options.snapshotId ?? "snapshot-1",
      manifestRevision: options.manifestRevision ?? "manifest-1",
      receiptId: options.receiptId ?? "receipt-1",
      capturedRevision,
      observedRevision: capturedRevision,
      policy: {
        revision: policyRevision,
        contentRulesEnabled: options.contentRulesEnabled ?? true,
        requireFileBodyScan: false,
      },
      preflight: {
        capturedRevision,
        policyRevision,
        captureAllowed: true,
        localHistoryAllowed: true,
        cloudUploadAllowed: false,
      },
      representations: rows.map((row) => row.unavailableReason
        ? {
          representationKey: row.representationKey,
          itemIndex: row.itemIndex,
          state: "unavailable" as const,
          reasonCode: row.unavailableReason,
        }
        : {
          representationKey: row.representationKey,
          itemIndex: row.itemIndex,
          state: "captured" as const,
          contentKind: row.contentKind,
          bytes: Uint8Array.from(row.bytes),
        }),
    },
  });
}

export function makeManifestFromReceiptV2(
  fixture: StoreCaptureFixtureV2,
  receipt: CaptureContentPolicyReceiptV2,
  hostEpoch: string,
): ClipboardSnapshotManifestV2 {
  const manifestItems = new Map<number, Array<Record<string, unknown>>>();
  for (const row of fixture.rows) {
    const admitted = receipt.representations.find((entry) =>
      entry.representationKey === row.representationKey);
    if (!admitted) throw new Error(`Missing receipt row ${row.representationKey}`);
    const representations = manifestItems.get(row.itemIndex) ?? [];
    const identity = {
      representationKey: row.representationKey,
      formatId: row.formatId,
      nativeName: row.nativeName,
      ...(row.mime ? { mime: row.mime } : {}),
    };
    if (admitted.retentionAllowed) {
      const sha256 = digestV2(row.bytes);
      if (row.contentKind === "file-reference") {
        representations.push({
          ...identity,
          state: "ready",
          storage: "file-reference",
          fidelity: "reference",
          originDeviceId: "synthetic-origin-device",
          references: row.references ?? [{
            url: "file:///synthetic/clipboard/reference.bin",
            isDirectory: false,
            observedAvailability: "unknown",
          }],
        });
      } else {
        representations.push({
          ...identity,
          state: "ready",
          storage: "blob",
          fidelity: "exact",
          byteLength: row.bytes.byteLength,
          sha256,
          blobRef: `sha256-${sha256}`,
        });
      }
    } else {
      const reasonCode = "reasonCode" in admitted ? admitted.reasonCode : "required-check-unavailable";
      representations.push({
        ...identity,
        state: reasonCode === "required-check-unavailable" ? "policy-blocked" : reasonCode,
        reasonCode,
      });
    }
    manifestItems.set(row.itemIndex, representations);
  }

  const items = [...manifestItems.entries()]
    .sort(([left], [right]) => left - right)
    .map(([index, representations]) => ({ index, representations }));
  const requested = fixture.rows.length;
  const captured = receipt.representations.filter((row) => row.retentionAllowed).length;
  return {
    schemaVersion: 2,
    snapshotId: fixture.capture.snapshotId,
    manifestRevision: fixture.capture.manifestRevision,
    source: {
      hostEpoch,
      platform: "macos",
      osRevision: fixture.capture.capturedRevision,
      capturedAt: "2026-10-27T12:00:00.000Z",
      osBuild: "synthetic-macOS-build",
      architecture: "arm64",
      adapterVersion: "synthetic-capture-adapter-1",
      itemModel: "macos-items",
      sourceApplication: { kind: "unknown" },
      attribution: "unknown",
    },
    policyReceiptId: receipt.receiptId,
    items: items as ClipboardSnapshotManifestV2["items"],
    coverage: { requested, captured, omitted: requested - captured },
    captureState: captured === requested ? "ready" : captured > 0 ? "partial" : "failed",
  };
}
