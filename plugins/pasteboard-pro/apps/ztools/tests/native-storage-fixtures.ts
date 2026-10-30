import type { CaptureContentPolicyReceiptV2, ClipboardSnapshotManifestV2 } from "@pasteboard-pro/core";
import type { mapNativeCaptureWire } from "../preload/native-capture-adapter";

type NativeMapping = ReturnType<typeof mapNativeCaptureWire>;
export function buildNativeFixtureManifestV2(mapped: NativeMapping, hostEpoch: string, receipt: CaptureContentPolicyReceiptV2): ClipboardSnapshotManifestV2 {
  const groups = new Map<number, ClipboardSnapshotManifestV2["items"][number]>();
  for (const row of receipt.representations) {
    const identity = mapped.identities.find((entry) => entry.representationKey === row.representationKey)!;
    let item = groups.get(row.itemIndex);
    if (!item) { item = { index: row.itemIndex, representations: [] }; groups.set(row.itemIndex, item); }
    const metadata = { representationKey: row.representationKey, formatId: "native:" + identity.nativeName, nativeName: identity.nativeName };
    if (row.retentionAllowed) {
      item.representations.push({ ...metadata, state: "ready", storage: "blob",
        fidelity: identity.fidelity === "compatible" ? "compatible" : "exact",
        byteLength: row.byteLength, sha256: row.sha256, blobRef: "sha256-" + row.sha256,
        ...(identity.derivedFromRepresentationKey === undefined ? {} : { derivedFrom: identity.derivedFromRepresentationKey }) });
    } else {
      item.representations.push({ ...metadata, state: row.reasonCode === "required-check-unavailable" ? "policy-blocked" : row.reasonCode,
        reasonCode: row.reasonCode });
    }
  }
  const retained = receipt.representations.filter((row) => row.retentionAllowed).length;
  return {
    schemaVersion: 2, snapshotId: receipt.snapshotId, manifestRevision: receipt.manifestRevision,
    policyReceiptId: receipt.receiptId,
    source: { hostEpoch, platform: "macos", osRevision: receipt.capturedRevision, capturedAt: "2026-10-27T00:00:00.000Z",
      osBuild: "supervised-synthetic-fixture", architecture: process.arch, adapterVersion: "fixture-g1-v20",
      itemModel: "macos-items", sourceApplication: { kind: "unknown" }, attribution: "unknown" },
    items: [...groups.values()], coverage: { requested: receipt.representations.length, captured: retained, omitted: receipt.representations.length - retained },
    captureState: retained === receipt.representations.length ? "ready" : retained > 0 ? "partial" : "failed",
  };
}
