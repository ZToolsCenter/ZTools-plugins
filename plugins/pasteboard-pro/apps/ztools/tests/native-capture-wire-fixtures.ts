import { createHash } from "node:crypto";

export const wireContext = () => ({
  requestId: "fixture-v17",
  platform: "macos" as const,
  attemptId: "native-attempt-v17",
  snapshotId: "native-snapshot-v17",
  manifestRevision: "native-manifest-v17",
  receiptId: "native-receipt-v17",
  policy: { revision: "fixture-policy-v17", contentRulesEnabled: true, requireFileBodyScan: false },
});
export function capturedWireRow(nativeName: string, text: string, itemIndex = 0, offset = 0) {
  const bytes = Buffer.from(text, "utf8");
  return {
    bytes,
    metadata: { itemIndex, nativeName, state: "captured", offset, byteLength: bytes.length,
      sha256: createHash("sha256").update(bytes).digest("hex"), fidelity: "exact" },
  };
}
export function wireMetadata(rows: unknown[] = [capturedWireRow("public.utf8-plain-text", "hello").metadata]) {
  return {
    schemaVersion: 1,
    requestId: "fixture-v17",
    platform: "macos",
    expectedRevision: "7",
    capturedRevision: "7",
    observedRevision: "8",
    captureState: "ready",
    sourceAttribution: "unknown",
    policy: { revision: "fixture-policy-v17", captureAllowed: true, localHistoryAllowed: true, cloudUploadAllowed: false },
    representations: rows,
  };
}
export function wireFrame(metadata: unknown = wireMetadata(), payload: Uint8Array = Buffer.from("hello"), text?: string) {
  const json = Buffer.from(text ?? JSON.stringify(metadata), "utf8");
  const header = Buffer.alloc(20);
  header.write("PBCAP01\n", 0, "ascii");
  header.writeUInt32LE(json.length, 8);
  header.writeBigUInt64LE(BigInt(payload.byteLength), 12);
  return Buffer.concat([header, json, payload]);
}
