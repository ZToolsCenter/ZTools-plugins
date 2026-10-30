import { constants as fileSystemConstants } from "node:fs";
import type { BigIntStats } from "node:fs";
import { lstat, open } from "node:fs/promises";
import type { FileHandle } from "node:fs/promises";
import path from "node:path";

export const MAX_SYNC_BLOB_BYTES = 100 * 1_024 * 1_024;

export class SyncBlobReadLimitError extends RangeError {
  readonly code = "ERR_SYNC_BLOB_TOO_LARGE";

  constructor() {
    super("Image file exceeds the 100 MiB read limit");
    this.name = "SyncBlobReadLimitError";
  }
}

export class SyncBlobPathChangedError extends TypeError {
  constructor(message: string) {
    super(message);
    this.name = "SyncBlobPathChangedError";
  }
}

export type SyncBlobReadDependencies = Readonly<{
  lstat?: (filePath: string) => Promise<BigIntStats>;
  open?: (filePath: string, flags: number) => Promise<FileHandle>;
}>;

function sameIdentity(left: BigIntStats, right: BigIntStats): boolean {
  return (
    left.ino !== 0n &&
    left.dev === right.dev &&
    left.ino === right.ino
  );
}

function sameFileState(left: BigIntStats, right: BigIntStats): boolean {
  return (
    sameIdentity(left, right) &&
    left.size === right.size &&
    left.mtimeNs === right.mtimeNs &&
    left.ctimeNs === right.ctimeNs
  );
}

function assertRegularFile(status: BigIntStats): void {
  if (status.isSymbolicLink()) {
    throw new TypeError("Refusing to read a symbolic-link image file");
  }
  if (!status.isFile()) {
    throw new TypeError("Image path must identify a regular file");
  }
  if (
    typeof status.dev !== "bigint" ||
    typeof status.ino !== "bigint" ||
    typeof status.size !== "bigint" ||
    typeof status.mtimeNs !== "bigint" ||
    typeof status.ctimeNs !== "bigint" ||
    status.ino === 0n
  ) {
    throw new TypeError("Image file metadata does not provide a usable identity");
  }
  if (status.size < 0n) {
    throw new TypeError("Image file metadata has an invalid size");
  }
  if (status.size > BigInt(MAX_SYNC_BLOB_BYTES)) {
    throw new SyncBlobReadLimitError();
  }
}

function openFlags(): number {
  const noFollow =
    typeof fileSystemConstants.O_NOFOLLOW === "number"
      ? fileSystemConstants.O_NOFOLLOW
      : 0;
  const nonBlocking =
    typeof fileSystemConstants.O_NONBLOCK === "number"
      ? fileSystemConstants.O_NONBLOCK
      : 0;
  return fileSystemConstants.O_RDONLY | noFollow | nonBlocking;
}

export async function readBoundedImageBytes(
  filePath: string,
  dependencies: SyncBlobReadDependencies = {},
): Promise<Buffer> {
  if (filePath.length === 0 || !path.isAbsolute(filePath)) {
    throw new TypeError("Image path must be an absolute path");
  }

  const readLstat = dependencies.lstat ?? ((target) => lstat(target, { bigint: true }));
  const openFile = dependencies.open ?? open;
  const initialPathStatus = await readLstat(filePath);
  assertRegularFile(initialPathStatus);

  const handle = await openFile(filePath, openFlags());
  try {
    const initialHandleStatus = await handle.stat({ bigint: true });
    assertRegularFile(initialHandleStatus);
    if (!sameFileState(initialPathStatus, initialHandleStatus)) {
      throw new SyncBlobPathChangedError(
        "Image file changed between path inspection and open",
      );
    }

    const chunks: Buffer[] = [];
    const chunk = Buffer.allocUnsafe(64 * 1_024);
    let totalBytes = 0;
    let position = 0;
    while (true) {
      const remainingThroughLimit = MAX_SYNC_BLOB_BYTES + 1 - totalBytes;
      const readLength = Math.min(chunk.byteLength, remainingThroughLimit);
      const { bytesRead } = await handle.read(chunk, 0, readLength, position);
      if (bytesRead === 0) break;
      totalBytes += bytesRead;
      if (totalBytes > MAX_SYNC_BLOB_BYTES) {
        throw new SyncBlobReadLimitError();
      }
      chunks.push(Buffer.from(chunk.subarray(0, bytesRead)));
      position += bytesRead;
    }

    const finalHandleStatus = await handle.stat({ bigint: true });
    const finalPathStatus = await readLstat(filePath);
    assertRegularFile(finalHandleStatus);
    assertRegularFile(finalPathStatus);
    if (
      !sameFileState(initialHandleStatus, finalHandleStatus) ||
      !sameFileState(initialPathStatus, finalPathStatus) ||
      !sameIdentity(finalHandleStatus, finalPathStatus) ||
      finalHandleStatus.size !== BigInt(totalBytes)
    ) {
      throw new SyncBlobPathChangedError("Image file changed while being read");
    }

    return Buffer.concat(chunks, totalBytes);
  } finally {
    await handle.close();
  }
}
