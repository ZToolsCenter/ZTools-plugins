import { createHash, randomBytes } from "node:crypto";
import { constants } from "node:fs";
import * as fs from "node:fs/promises";
import { join } from "node:path";

import {
  copyCapturedUint8ArrayV2,
  inspectCapturedUint8ArrayV2,
  maxFormatBytesV2,
} from "@pasteboard-pro/core";
import { SnapshotStoreErrorV2, storeErrorV2 } from "./errors.js";
import { syncDirectoryV2 } from "./fs-directory.js";
import {
  assertDirectoryV2,
  ensureShardDirectoryV2,
  lstatMaybeV2,
  openBlobDirectoriesV2,
  throwStorageIo,
  type BlobDirectoriesV2,
} from "./blob-paths.js";
import type { BlobFaultPointV2, BlobInfoV2, BlobStoreV2 } from "./types.js";

const SHA256_PATTERN = /^[a-f0-9]{64}$/;
const BLOB_REF_PATTERN = /^sha256-([a-f0-9]{64})$/;
const STAGING_FILE_PATTERN = /^blob-[a-f0-9]{32}\.tmp$/;
const HASH_PREFIX_LENGTH = 2;
const HASH_BUFFER_BYTES = 64 * 1024;
const O_NOFOLLOW = constants.O_NOFOLLOW ?? 0;
const objectStageLocks = new Map<string, Promise<void>>();
const MAX_BLOB_BYTES = maxFormatBytesV2("binary");

type StoreOptions = Readonly<{ fault?: (point: BlobFaultPointV2) => void }>;
type OpenedBlob = Readonly<{ handle: Awaited<ReturnType<typeof fs.open>>; byteLength: number }>;

export async function openBlobStoreV2(
  root: string,
  options?: { fault?: (point: BlobFaultPointV2) => void },
): Promise<BlobStoreV2> {
  if (options !== undefined && (typeof options !== "object" || options === null)) {
    storeErrorV2("invalid-input");
  }
  const fault = options?.fault;
  if (fault !== undefined && typeof fault !== "function") storeErrorV2("invalid-input");
  let directories: BlobDirectoriesV2;
  try {
    directories = await openBlobDirectoriesV2(root);
  } catch (error) {
    throwStorageIo(error, "storage-failed");
  }

  const stage = async (input: Uint8Array, expectedSha256: string): Promise<BlobInfoV2> => {
    const owned = copyValidatedInput(input, expectedSha256);
    const sha256 = hashBytes(owned);
    if (sha256 !== expectedSha256) storeErrorV2("invalid-input");
    try {
      return await withObjectStageLock(join(directories.root, sha256), () =>
        stageOwnedBlob(directories, owned, sha256, fault),
      );
    } catch (error) {
      throwStorageIo(error, "storage-failed");
    }
  };

  const read = async (
    blobRef: string,
    expected: Readonly<{ sha256: string; byteLength: number }>,
  ): Promise<Uint8Array> => {
    const sha256 = shaFromBlobRef(blobRef);
    validateExpected(expected);
    if (expected.sha256 !== sha256) storeErrorV2("invalid-input");
    const objectPath = objectPathFor(directories, sha256);
    try {
      await assertDirectoryV2(directories.root);
      await assertDirectoryV2(directories.sha256);
      await assertDirectoryV2(join(directories.sha256, sha256.slice(0, HASH_PREFIX_LENGTH)));
      const opened = await openRegularBlob(objectPath);
      try {
        if (opened.byteLength > MAX_BLOB_BYTES) storeErrorV2("storage-corrupt");
        if (opened.byteLength !== expected.byteLength) storeErrorV2("storage-corrupt");
        const bytes = Buffer.allocUnsafe(opened.byteLength);
        await readExact(opened.handle, bytes, opened.byteLength);
        const finalStat = await opened.handle.stat();
        if (!finalStat.isFile() || finalStat.size !== opened.byteLength) storeErrorV2("storage-corrupt");
        if (hashBytes(bytes) !== sha256) storeErrorV2("storage-corrupt");
        return bytes;
      } finally {
        await closeQuietly(opened.handle);
      }
    } catch (error) {
      throwStorageIo(error, "storage-corrupt");
    }
  };

  const discardStaging = async (): Promise<number> => {
    try {
      await assertDirectoryV2(directories.root);
      await assertDirectoryV2(directories.staging);
      const entries = await fs.readdir(directories.staging);
      let removed = 0;
      for (const entry of entries) {
        if (!STAGING_FILE_PATTERN.test(entry)) storeErrorV2("storage-corrupt");
        const path = join(directories.staging, entry);
        const stat = await fs.lstat(path);
        if (stat.isSymbolicLink() || !stat.isFile()) storeErrorV2("storage-corrupt");
        await fs.unlink(path);
        removed += 1;
      }
      if (removed > 0) await syncDirectoryV2(directories.staging);
      return removed;
    } catch (error) {
      throwStorageIo(error, "storage-corrupt");
    }
  };

  const listObjects = async (): Promise<readonly BlobInfoV2[]> => {
    try {
      await assertDirectoryV2(directories.root);
      await assertDirectoryV2(directories.sha256);
      const result: BlobInfoV2[] = [];
      for (const prefix of await fs.readdir(directories.sha256)) {
        if (!/^[a-f0-9]{2}$/.test(prefix)) storeErrorV2("storage-corrupt");
        const shard = join(directories.sha256, prefix);
        await assertDirectoryV2(shard);
        for (const name of await fs.readdir(shard)) {
          if (!SHA256_PATTERN.test(name) || !name.startsWith(prefix)) storeErrorV2("storage-corrupt");
          const path = join(shard, name);
          const digest = await hashRegularBlob(path);
          if (digest.sha256 !== name) storeErrorV2("storage-corrupt");
          result.push(blobInfo(`sha256-${name}`, name, digest.byteLength));
        }
      }
      result.sort((left, right) => left.sha256.localeCompare(right.sha256));
      return Object.freeze(result);
    } catch (error) {
      throwStorageIo(error, "storage-corrupt");
    }
  };

  const removeUnreferenced = async (blobRef: string): Promise<void> => {
    const sha256 = shaFromBlobRef(blobRef);
    const objectPath = objectPathFor(directories, sha256);
    const shard = join(directories.sha256, sha256.slice(0, HASH_PREFIX_LENGTH));
    try {
      await assertDirectoryV2(directories.root);
      await assertDirectoryV2(directories.sha256);
      const shardStat = await lstatMaybeV2(shard);
      if (!shardStat) return;
      if (shardStat.isSymbolicLink() || !shardStat.isDirectory()) storeErrorV2("storage-corrupt");
      await assertDirectoryV2(shard);
      const stat = await lstatMaybeV2(objectPath);
      if (!stat) return;
      if (stat.isSymbolicLink() || !stat.isFile()) storeErrorV2("storage-corrupt");
      await fs.unlink(objectPath);
      await syncDirectoryV2(shard);
    } catch (error) {
      throwStorageIo(error, "storage-failed");
    }
  };

  return Object.freeze({ stage, read, discardStaging, listObjects, removeUnreferenced });
}

async function stageOwnedBlob(
  directories: BlobDirectoriesV2,
  owned: Uint8Array,
  sha256: string,
  fault: StoreOptions["fault"],
): Promise<BlobInfoV2> {
  const blobRef = `sha256-${sha256}`;
  const shard = await ensureShardDirectoryV2(directories, sha256.slice(0, HASH_PREFIX_LENGTH));
  const objectPath = join(shard, sha256);
  if (await lstatMaybeV2(objectPath)) {
    await validateExistingObject(objectPath, sha256, owned.byteLength);
    await syncDirectoryV2(shard);
    injectFault(fault, "after-directory-sync");
    return blobInfo(blobRef, sha256, owned.byteLength);
  }

  const stagingPath = join(directories.staging, `blob-${randomBytes(16).toString("hex")}.tmp`);
  let handle: Awaited<ReturnType<typeof fs.open>> | undefined;
  let stagingCreated = false;
  let stagingIdentity: Readonly<{ dev: number; ino: number }> | undefined;
  let published = false;
  try {
    await assertDirectoryV2(directories.root);
    await assertDirectoryV2(directories.staging);
    handle = await fs.open(stagingPath, "wx", 0o600);
    stagingCreated = true;
    const stagingStat = await handle.stat();
    stagingIdentity = Object.freeze({ dev: stagingStat.dev, ino: stagingStat.ino });
    await writeAll(handle, owned);
    injectFault(fault, "after-write");
    await handle.sync();
    injectFault(fault, "after-file-sync");
    await handle.close();
    handle = undefined;

    // Recheck immediately before rename so a concurrent writer is validated and reused.
    if (await lstatMaybeV2(objectPath)) {
      await validateExistingObject(objectPath, sha256, owned.byteLength);
      await fs.unlink(stagingPath);
      stagingCreated = false;
      await syncDirectoryV2(directories.staging);
      await syncDirectoryV2(shard);
      injectFault(fault, "after-directory-sync");
      return blobInfo(blobRef, sha256, owned.byteLength);
    }

    await assertDirectoryV2(shard);
    await fs.rename(stagingPath, objectPath);
    published = true;
    injectFault(fault, "after-rename");
    await syncDirectoryV2(shard);
    await syncDirectoryV2(directories.staging);
    injectFault(fault, "after-directory-sync");
    return blobInfo(blobRef, sha256, owned.byteLength);
  } catch (error) {
    if (!published) {
      if (handle) await closeQuietly(handle);
      if (stagingCreated && stagingIdentity) await unlinkOwnedStagingFile(stagingPath, stagingIdentity);
    }
    throwStorageIo(error, "storage-failed");
  }
}

function copyValidatedInput(input: Uint8Array, expectedSha256: string): Uint8Array {
  if (typeof expectedSha256 !== "string" || !SHA256_PATTERN.test(expectedSha256)) {
    storeErrorV2("invalid-input");
  }
  const inspected = inspectCapturedUint8ArrayV2(input);
  if (!inspected) storeErrorV2("invalid-input");
  if (inspected.byteLength > MAX_BLOB_BYTES) storeErrorV2("over-limit");
  try {
    return copyCapturedUint8ArrayV2(inspected);
  } catch {
    storeErrorV2("invalid-input");
  }
}

function validateExpected(expected: Readonly<{ sha256: string; byteLength: number }>): void {
  if (
    typeof expected !== "object" || expected === null || typeof expected.sha256 !== "string" ||
    !SHA256_PATTERN.test(expected.sha256)
  ) {
    storeErrorV2("invalid-input");
  }
  if (!Number.isSafeInteger(expected.byteLength) || expected.byteLength < 0) storeErrorV2("invalid-input");
  if (expected.byteLength > MAX_BLOB_BYTES) storeErrorV2("over-limit");
}

function shaFromBlobRef(blobRef: string): string {
  if (typeof blobRef !== "string") storeErrorV2("invalid-input");
  const match = BLOB_REF_PATTERN.exec(blobRef);
  if (!match) storeErrorV2("invalid-input");
  const sha256 = match[1];
  if (!sha256) storeErrorV2("invalid-input");
  return sha256;
}

function objectPathFor(directories: BlobDirectoriesV2, sha256: string): string {
  return join(directories.sha256, sha256.slice(0, HASH_PREFIX_LENGTH), sha256);
}

function hashBytes(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function blobInfo(blobRef: string, sha256: string, byteLength: number): BlobInfoV2 {
  return Object.freeze({ blobRef, sha256, byteLength });
}

async function withObjectStageLock<T>(key: string, action: () => Promise<T>): Promise<T> {
  const previous = objectStageLocks.get(key);
  let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  const current = (previous ?? Promise.resolve()).then(() => gate);
  objectStageLocks.set(key, current);
  await previous;
  try {
    return await action();
  } finally {
    release();
    if (objectStageLocks.get(key) === current) objectStageLocks.delete(key);
  }
}

function injectFault(fault: StoreOptions["fault"], point: BlobFaultPointV2): void {
  try {
    fault?.(point);
  } catch {
    storeErrorV2("storage-failed");
  }
}

async function validateExistingObject(path: string, sha256: string, byteLength: number): Promise<void> {
  const opened = await openRegularBlob(path);
  try {
    if (opened.byteLength !== byteLength || opened.byteLength > MAX_BLOB_BYTES) {
      storeErrorV2("storage-corrupt");
    }
    const digest = await hashOpenedBlob(opened.handle, opened.byteLength);
    const finalStat = await opened.handle.stat();
    if (!finalStat.isFile() || finalStat.size !== opened.byteLength || digest !== sha256) {
      storeErrorV2("storage-corrupt");
    }
  } finally {
    await closeQuietly(opened.handle);
  }
}

async function openRegularBlob(path: string): Promise<OpenedBlob> {
  const before = await lstatMaybeV2(path);
  if (!before || before.isSymbolicLink() || !before.isFile()) storeErrorV2("storage-corrupt");
  let handle: Awaited<ReturnType<typeof fs.open>>;
  try {
    handle = await fs.open(path, constants.O_RDONLY | O_NOFOLLOW);
  } catch (error) {
    throwStorageIo(error, "storage-corrupt");
  }
  try {
    const opened = await handle.stat();
    if (!opened.isFile() || !sameIdentity(before, opened)) storeErrorV2("storage-corrupt");
    if (!Number.isSafeInteger(opened.size) || opened.size < 0) storeErrorV2("storage-corrupt");
    return Object.freeze({ handle, byteLength: opened.size });
  } catch (error) {
    await closeQuietly(handle);
    throwStorageIo(error, "storage-corrupt");
  }
}

async function readExact(
  handle: Awaited<ReturnType<typeof fs.open>>,
  output: Uint8Array,
  byteLength: number,
): Promise<void> {
  let offset = 0;
  while (offset < byteLength) {
    const { bytesRead } = await handle.read(output, offset, byteLength - offset, offset);
    if (bytesRead === 0) storeErrorV2("storage-corrupt");
    offset += bytesRead;
  }
}

async function hashOpenedBlob(
  handle: Awaited<ReturnType<typeof fs.open>>,
  byteLength: number,
): Promise<string> {
  const hash = createHash("sha256");
  const buffer = Buffer.allocUnsafe(HASH_BUFFER_BYTES);
  let offset = 0;
  while (offset < byteLength) {
    const wanted = Math.min(buffer.byteLength, byteLength - offset);
    const { bytesRead } = await handle.read(buffer, 0, wanted, offset);
    if (bytesRead === 0) storeErrorV2("storage-corrupt");
    hash.update(buffer.subarray(0, bytesRead));
    offset += bytesRead;
  }
  return hash.digest("hex");
}

async function hashRegularBlob(path: string): Promise<Readonly<{ sha256: string; byteLength: number }>> {
  const opened = await openRegularBlob(path);
  try {
    if (opened.byteLength > MAX_BLOB_BYTES) storeErrorV2("storage-corrupt");
    const sha256 = await hashOpenedBlob(opened.handle, opened.byteLength);
    const finalStat = await opened.handle.stat();
    if (!finalStat.isFile() || finalStat.size !== opened.byteLength) storeErrorV2("storage-corrupt");
    return Object.freeze({ sha256, byteLength: opened.byteLength });
  } finally {
    await closeQuietly(opened.handle);
  }
}

async function writeAll(handle: Awaited<ReturnType<typeof fs.open>>, bytes: Uint8Array): Promise<void> {
  let offset = 0;
  while (offset < bytes.byteLength) {
    const { bytesWritten } = await handle.write(bytes, offset, bytes.byteLength - offset, offset);
    if (bytesWritten === 0) storeErrorV2("storage-failed");
    offset += bytesWritten;
  }
}

function sameIdentity(
  left: { dev: number | bigint; ino: number | bigint },
  right: { dev: number | bigint; ino: number | bigint },
): boolean {
  return left.dev === right.dev && left.ino === right.ino;
}

async function closeQuietly(handle: Awaited<ReturnType<typeof fs.open>>): Promise<void> {
  try {
    await handle.close();
  } catch {
    // Close errors do not expose native details or mask the storage result.
  }
}

async function unlinkOwnedStagingFile(
  path: string,
  identity: Readonly<{ dev: number; ino: number }>,
): Promise<void> {
  try {
    const stat = await fs.lstat(path);
    if (!stat.isSymbolicLink() && stat.isFile() && sameIdentity(identity, stat)) await fs.unlink(path);
  } catch {
    // Best-effort cleanup leaves any replaced or inaccessible path untouched.
  }
}
