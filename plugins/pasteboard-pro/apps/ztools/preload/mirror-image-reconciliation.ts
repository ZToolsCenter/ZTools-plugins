import { createHash } from "node:crypto";
import { readHostImageIdentity } from "./mirror-image-host-capture";
import path from "node:path";
import { readBoundedImageBytes, MAX_SYNC_BLOB_BYTES } from "./sync-blob-read";
import {
  assertCanonicalManagedBlobFile,
  inspectManagedBlobDirectory,
  sameManagedBlobDirectoryChain,
} from "./sync-blob-directory";
import type { ClipboardRecordStore } from "./clipboard-record-store";
import type { HostCursor } from "./clipboard-store-types";

/**
 * A local record is evidence only for its exact source identity and device.
 * A failed image prepare never qualifies merely because a different record
 * happens to have the same host id or fingerprint. No host clipboard is read.
 */
export async function reconcilePersistedMirrorImage(
  store: Pick<ClipboardRecordStore, "findRecordByItemId">,
  cursor: HostCursor,
  deviceId: string,
  blobRoot: string,
): Promise<boolean> {
  // Database failures propagate; an unconfirmed read is never treated as success.
  const record = await store.findRecordByItemId("ztools:" + cursor.id);
  const source = record && readHostImageIdentity(record);
  const normalizedDeviceId = typeof deviceId === "string" ? deviceId.trim() : "";
  if (!record || !source || source.hostItemId !== cursor.id || source.timestamp !== cursor.timestamp ||
      !normalizedDeviceId || source.deviceId !== normalizedDeviceId ||
      typeof record.origin.imagePath !== "string" || !path.isAbsolute(record.origin.imagePath) ||
      typeof blobRoot !== "string" || !path.isAbsolute(blobRoot) ||
      typeof record.origin.pluginBlobId !== "string" ||
      !Number.isSafeInteger(record.origin.blobBytes) || (record.origin.blobBytes ?? 0) <= 0 ||
      (record.origin.blobBytes ?? 0) > MAX_SYNC_BLOB_BYTES) return false;
  const match = /^blob-([0-9a-f]{64})$/u.exec(record.origin.pluginBlobId);
  if (!match) return false;
  const digest = match[1]!;
  const root = path.resolve(blobRoot);
  const imagePath = path.resolve(record.origin.imagePath);
  if (imagePath !== record.origin.imagePath || path.dirname(imagePath) !== path.join(root, digest.slice(0, 2)) ||
      !new RegExp(`^${digest}\\.(?:png|jpg|webp|tiff|bin)$`, "u").test(path.basename(imagePath))) return false;

  try {
    const before = await inspectManagedBlobDirectory(path.dirname(imagePath), false);
    const canonicalBefore = await assertCanonicalManagedBlobFile(root, imagePath);
    const bytes = await readBoundedImageBytes(imagePath);
    const canonicalAfter = await assertCanonicalManagedBlobFile(root, imagePath);
    const after = await inspectManagedBlobDirectory(path.dirname(imagePath), false);
    if (!sameManagedBlobDirectoryChain(before, after) ||
        canonicalBefore.canonicalRoot !== canonicalAfter.canonicalRoot ||
        canonicalBefore.canonicalFile !== canonicalAfter.canonicalFile ||
        bytes.byteLength !== record.origin.blobBytes) return false;
    return createHash("sha256").update(bytes).digest("hex") === digest;
  } catch {
    // Missing, corrupt, inaccessible or changed owned files are not completion.
    return false;
  }
}
