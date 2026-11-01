import { createHash } from "node:crypto";

import type { SnapshotCommitV2 } from "../src/types.js";

export type CaptureFixtureOptionsV2 = Readonly<{
  attemptId?: string;
  receiptId?: string;
  snapshotId?: string;
  manifestRevision?: string;
  expectedManifestRevision?: string | null;
  representationKey?: string;
  payload?: string;
}>;

export function makeCaptureFixture(
  hostEpoch: string,
  options: CaptureFixtureOptionsV2 = {},
): SnapshotCommitV2 {
  const payload = Buffer.from(options.payload ?? "exact clipboard bytes", "utf8");
  const sha256 = createHash("sha256").update(payload).digest("hex");
  const snapshotId = options.snapshotId ?? "snapshot-1";
  const manifestRevision = options.manifestRevision ?? "revision-1";
  const receiptId = options.receiptId ?? "receipt-1";
  const attemptId = options.attemptId ?? "attempt-1";
  const representationKey = options.representationKey ?? "plain-text";

  return {
    expectedManifestRevision: options.expectedManifestRevision ?? null,
    manifest: {
      schemaVersion: 2,
      snapshotId,
      manifestRevision,
      source: {
        hostEpoch,
        platform: "macos",
        osRevision: "clipboard-revision-1",
        capturedAt: "2026-10-27T12:00:00.000Z",
        osBuild: "macOS 15.1",
        architecture: "arm64",
        adapterVersion: "capture-adapter-2",
        itemModel: "macos-items",
        sourceApplication: { kind: "unknown" },
        attribution: "unknown",
      },
      policyReceiptId: receiptId,
      items: [{
        index: 0,
        representations: [{
          representationKey,
          formatId: "public.utf8-plain-text",
          nativeName: "public.utf8-plain-text",
          mime: "text/plain",
          state: "ready",
          storage: "blob",
          fidelity: "exact",
          byteLength: payload.byteLength,
          sha256,
          blobRef: "sha256-" + sha256,
        }],
      }],
      coverage: { requested: 1, captured: 1, omitted: 0 },
      captureState: "ready",
    },
    receipt: {
      schemaVersion: 2,
      receiptId,
      attemptId,
      snapshotId,
      manifestRevision,
      policyRevision: "policy-revision-1",
      capturedRevision: "clipboard-revision-1",
      observedRevision: "clipboard-revision-1",
      cloudUploadEligible: true,
      representations: [{
        representationKey,
        itemIndex: 0,
        contentKind: "text",
        retentionAllowed: true,
        contentScanStatus: "not-scanned",
        checks: [{ scope: "text", status: "not-scanned" }],
        byteLength: payload.byteLength,
        sha256,
      }],
      permissions: { preview: false, paste: false, sync: false },
    },
    rawObjects: [{
      representationKey,
      itemIndex: 0,
      blobRef: "sha256-" + sha256,
      sha256,
      byteLength: payload.byteLength,
    }],
  };
}

export function makeFileReferenceFixture(
  hostEpoch: string,
  options: CaptureFixtureOptionsV2 = {},
): SnapshotCommitV2 {
  const sidecar = Buffer.from(options.payload ?? "file-reference-sidecar-bytes", "utf8");
  const sha256 = createHash("sha256").update(sidecar).digest("hex");
  const snapshotId = options.snapshotId ?? "file-snapshot-1";
  const manifestRevision = options.manifestRevision ?? "file-revision-1";
  const receiptId = options.receiptId ?? "file-receipt-1";
  const attemptId = options.attemptId ?? "file-attempt-1";
  const representationKey = options.representationKey ?? "file-list";

  return {
    expectedManifestRevision: options.expectedManifestRevision ?? null,
    manifest: {
      schemaVersion: 2,
      snapshotId,
      manifestRevision,
      source: {
        hostEpoch,
        platform: "macos",
        osRevision: "clipboard-revision-1",
        capturedAt: "2026-10-27T12:00:00.000Z",
        osBuild: "macOS 15.1",
        architecture: "arm64",
        adapterVersion: "capture-adapter-2",
        itemModel: "macos-items",
        sourceApplication: { kind: "unknown" },
        attribution: "unknown",
      },
      policyReceiptId: receiptId,
      items: [{
        index: 0,
        representations: [{
          representationKey,
          formatId: "public.file-url",
          nativeName: "public.file-url",
          state: "ready",
          storage: "file-reference",
          fidelity: "reference",
          originDeviceId: "device-origin-1",
          references: [{
            url: "file:///Users/test/Quarterly%20Report.pdf",
            isDirectory: false,
            observedAvailability: "available",
          }],
        }],
      }],
      coverage: { requested: 1, captured: 1, omitted: 0 },
      captureState: "ready",
    },
    receipt: {
      schemaVersion: 2,
      receiptId,
      attemptId,
      snapshotId,
      manifestRevision,
      policyRevision: "policy-revision-1",
      capturedRevision: "clipboard-revision-1",
      observedRevision: "clipboard-revision-1",
      cloudUploadEligible: false,
      representations: [{
        representationKey,
        itemIndex: 0,
        contentKind: "file-reference",
        retentionAllowed: true,
        contentScanStatus: "not-scanned",
        checks: [{ scope: "file-reference-metadata", status: "not-scanned" }],
        byteLength: sidecar.byteLength,
        sha256,
      }],
      permissions: { preview: false, paste: false, sync: false },
    },
    rawObjects: [{
      representationKey,
      itemIndex: 0,
      blobRef: "sha256-" + sha256,
      sha256,
      byteLength: sidecar.byteLength,
    }],
  };
}
