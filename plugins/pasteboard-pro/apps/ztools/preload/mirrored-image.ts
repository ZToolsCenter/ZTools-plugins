import { createHash } from "node:crypto";
import path from "node:path";
import type { CanonicalClipboardRecord } from "./clipboard-store";
import { MAX_SYNC_BLOB_BYTES } from "./sync-blob-files";

export type MirroredImagePersistenceErrorCode =
  | "image-path-unavailable"
  | "image-read-failed"
  | "image-storage-failed"
  | "image-verification-failed"
  | "image-metadata-invalid";

export class MirroredImagePersistenceError extends Error {
  readonly code: MirroredImagePersistenceErrorCode;

  constructor(code: MirroredImagePersistenceErrorCode) {
    super("Clipboard image persistence failed");
    this.name = "MirroredImagePersistenceError";
    this.code = code;
  }
}

type MirroredImageDependencies = Readonly<{
  readFile(filePath: string): Promise<Uint8Array>;
  storeLocalBlob(
    bytes: Uint8Array,
    mediaType: string,
  ): Promise<Readonly<{ id: string; imagePath: string; blobBytes: number }>>;
}>;

function isImageReadLimitError(error: unknown): boolean {
  return error !== null &&
    typeof error === "object" &&
    "code" in error &&
    error.code === "ERR_SYNC_BLOB_TOO_LARGE";
}

export async function localizeMirroredImage(
  record: CanonicalClipboardRecord,
  dependencies: MirroredImageDependencies,
): Promise<CanonicalClipboardRecord> {
  if (record.item.kind !== "image") {
    return record;
  }

  const imagePath = record.origin.imagePath;
  const mediaType = record.item.payload.mediaType;
  if (typeof imagePath !== "string" || !imagePath.trim() || !path.isAbsolute(imagePath)) {
    throw new MirroredImagePersistenceError("image-path-unavailable");
  }
  if (
    typeof mediaType !== "string" ||
    !/^image\/[a-z0-9][a-z0-9.+-]*$/i.test(mediaType)
  ) {
    throw new MirroredImagePersistenceError("image-metadata-invalid");
  }

  let bytes: Uint8Array;
  try {
    bytes = await dependencies.readFile(imagePath);
  } catch (error) {
    if (isImageReadLimitError(error)) {
      throw new MirroredImagePersistenceError("image-storage-failed");
    }
    throw new MirroredImagePersistenceError("image-read-failed");
  }
  if (!ArrayBuffer.isView(bytes) || !Number.isSafeInteger(bytes.byteLength)) {
    throw new MirroredImagePersistenceError("image-read-failed");
  }
  if (bytes.byteLength > MAX_SYNC_BLOB_BYTES) {
    throw new MirroredImagePersistenceError("image-storage-failed");
  }
  if (bytes.byteLength <= 0) {
    throw new MirroredImagePersistenceError("image-metadata-invalid");
  }

  const sourceBytes = bytes.byteLength;
  const sourceSha256 = createHash("sha256").update(bytes).digest("hex");
  let blob: Readonly<{ id: string; imagePath: string; blobBytes: number }>;
  try {
    blob = await dependencies.storeLocalBlob(bytes, mediaType);
  } catch {
    throw new MirroredImagePersistenceError("image-storage-failed");
  }

  if (
    blob === null ||
    typeof blob !== "object" ||
    blob.id !== `blob-${sourceSha256}` ||
    blob.blobBytes !== sourceBytes ||
    typeof blob.imagePath !== "string" ||
    !path.isAbsolute(blob.imagePath)
  ) {
    throw new MirroredImagePersistenceError("image-verification-failed");
  }

  let persistedBytes: Uint8Array;
  try {
    persistedBytes = await dependencies.readFile(blob.imagePath);
  } catch {
    throw new MirroredImagePersistenceError("image-verification-failed");
  }
  if (
    !ArrayBuffer.isView(persistedBytes) ||
    !Number.isSafeInteger(persistedBytes.byteLength) ||
    persistedBytes.byteLength !== sourceBytes ||
    createHash("sha256").update(persistedBytes).digest("hex") !== sourceSha256
  ) {
    throw new MirroredImagePersistenceError("image-verification-failed");
  }

  return {
    item: record.item,
    origin: {
      ...record.origin,
      imagePath: blob.imagePath,
      blobBytes: blob.blobBytes,
      pluginBlobId: blob.id,
    },
  };
}
