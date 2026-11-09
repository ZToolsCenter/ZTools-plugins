import type { CanonicalClipboardRecord } from "./clipboard-store-types";

/** Local-record provenance bound to an explicitly edited blob, not raw-payload fidelity. */
export type HostImageCaptureV1 = Readonly<{
  schemaVersion: 1;
  hostItemId: string;
  timestamp: number;
  deviceId: string;
  editedBlobId: string;
}>;

type HostImageIdentity = Readonly<{ hostItemId: string; timestamp: number; deviceId: string }>;
const BLOB = /^blob-([0-9a-f]{64})$/u;

function identityString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= 4096 && value.trim() === value;
}
function deviceString(value: unknown): value is string {
  return identityString(value) && !/[\uD800-\uDFFF]/u.test(value);
}
function timestampValue(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && Number.isFinite(new Date(value).getTime());
}
function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
export function parseHostImageCapture(value: unknown): HostImageCaptureV1 | undefined {
  if (!isRecord(value) || Object.keys(value).length !== 5 ||
      !["schemaVersion", "hostItemId", "timestamp", "deviceId", "editedBlobId"].every((key) => Object.hasOwn(value, key)) ||
      value.schemaVersion !== 1 || !identityString(value.hostItemId) || !timestampValue(value.timestamp) ||
      !deviceString(value.deviceId) || typeof value.editedBlobId !== "string" || !BLOB.test(value.editedBlobId)) return undefined;
  return { schemaVersion: 1, hostItemId: value.hostItemId, timestamp: value.timestamp,
    deviceId: value.deviceId, editedBlobId: value.editedBlobId };
}
function stableIdentity(record: CanonicalClipboardRecord, hostItemId: string, timestamp: number, deviceId: string): boolean {
  return record.item.kind === "image" && record.item.id === "ztools:" + hostItemId &&
    record.item.sourceDeviceId === deviceId && record.item.copiedAt === new Date(timestamp).toISOString();
}
function validEditedPayload(record: CanonicalClipboardRecord, binding: HostImageCaptureV1): boolean {
  if (record.origin.host !== "sync") return false;
  const digest = BLOB.exec(binding.editedBlobId)?.[1];
  return digest !== undefined && record.origin.pluginBlobId === binding.editedBlobId &&
    record.item.payload.blobId === binding.editedBlobId && record.item.payload.revision === `sha256:${digest}`;
}

/** Accept only a real host origin or a still-bound local-edit lineage. */
export function readHostImageIdentity(record: CanonicalClipboardRecord): HostImageIdentity | undefined {
  if (record.origin.host === "ztools") {
    const timestamp = Date.parse(record.item.copiedAt);
    const hostItemId = record.origin.hostItemId;
    const deviceId = record.item.sourceDeviceId;
    if (record.origin.hostType !== "image" || !identityString(hostItemId) || !deviceString(deviceId) ||
        !timestampValue(timestamp) || !stableIdentity(record, hostItemId, timestamp, deviceId)) return undefined;
    return { hostItemId, timestamp, deviceId };
  }
  const binding = parseHostImageCapture(record.origin.hostCapture);
  if (!binding || !stableIdentity(record, binding.hostItemId, binding.timestamp, binding.deviceId) ||
      !validEditedPayload(record, binding)) return undefined;
  return { hostItemId: binding.hostItemId, timestamp: binding.timestamp, deviceId: binding.deviceId };
}

/** Never invent a binding from a sync item's id or carry it to a different payload. */
export function bindLocalImageEdit(
  record: CanonicalClipboardRecord,
  deviceId: string,
  blobId: string,
  revision: string,
): HostImageCaptureV1 | undefined {
  const source = readHostImageIdentity(record);
  const digest = BLOB.exec(blobId)?.[1];
  if (!source || source.deviceId !== deviceId || digest === undefined || revision !== `sha256:${digest}`) return undefined;
  return { schemaVersion: 1, ...source, editedBlobId: blobId };
}
