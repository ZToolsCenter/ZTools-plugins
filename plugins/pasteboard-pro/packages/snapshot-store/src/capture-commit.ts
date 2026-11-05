import {
  CaptureContentPolicyResultV2Schema, ClipboardSnapshotManifestV2Schema,
  copyCapturedUint8ArrayV2, inspectCapturedUint8ArrayV2,
  type CaptureContentPolicyResultV2, type ClipboardSnapshotManifestV2,
} from "@pasteboard-pro/core";
import { SnapshotStoreErrorV2 } from "./errors.js";
import { sha256V2, validateCommitV2 } from "./journal-validation.js";
import type { RawObjectBindingV2, SnapshotCommitV2 } from "./types.js";

type Admission = Extract<CaptureContentPolicyResultV2, { status: "eligible" | "partial" }>;
export type PreparedCommitV2 = Readonly<{
  command: SnapshotCommitV2;
  objects: readonly Readonly<{ binding: RawObjectBindingV2; bytes: Uint8Array }>[];
}>;

/** Called only with a fresh internal gate result or a receipt already verified from this journal. */
export function prepareCaptureCommitV2(
  manifestInput: ClipboardSnapshotManifestV2,
  admissionInput: Admission,
  expectedManifestRevision: string | null,
  hostEpoch: string,
): PreparedCommitV2 {
  try {
    const manifest = ClipboardSnapshotManifestV2Schema.parse(manifestInput);
    const admission = CaptureContentPolicyResultV2Schema.parse(admissionInput);
    if (admission.status !== "eligible" && admission.status !== "partial") {
      throw new SnapshotStoreErrorV2("invalid-input");
    }
    const objects = admission.admittedRepresentations.map((row) => {
      const view = inspectCapturedUint8ArrayV2(row.bytes);
      if (!view) throw new SnapshotStoreErrorV2("invalid-input");
      const bytes = copyCapturedUint8ArrayV2(view);
      const sha256 = sha256V2(bytes);
      const receiptRow = admission.receipt.representations.find((entry) => entry.representationKey === row.representationKey);
      if (!receiptRow?.retentionAllowed || receiptRow.sha256 !== sha256) {
        throw new SnapshotStoreErrorV2("invalid-input");
      }
      const binding = Object.freeze({ representationKey: row.representationKey, itemIndex: row.itemIndex,
        sha256, byteLength: bytes.byteLength, blobRef: "sha256-" + sha256 });
      return Object.freeze({ binding, bytes });
    });
    const command = { manifest, receipt: admission.receipt, rawObjects: objects.map((entry) => entry.binding),
      expectedManifestRevision };
    const validated = validateCommitV2(command, hostEpoch);
    return Object.freeze({ command: validated.command, objects: Object.freeze(objects) });
  } catch (error) {
    if (error instanceof SnapshotStoreErrorV2) throw error;
    throw new SnapshotStoreErrorV2("invalid-input");
  }
}
