import * as fs from "node:fs/promises";
import { isAbsolute, join, resolve } from "node:path";

import { SnapshotStoreErrorV2, storeErrorV2 } from "./errors.js";
import { preparePrivateDirectoryV2 } from "./fs-directory.js";

export type BlobDirectoriesV2 = Readonly<{
  root: string;
  staging: string;
  sha256: string;
}>;

type FsCode = NodeJS.ErrnoException["code"];

export function isMissingPathError(error: unknown): boolean {
  return getFsCode(error) === "ENOENT";
}

export function getFsCode(error: unknown): FsCode | undefined {
  if (typeof error !== "object" || error === null || !("code" in error)) return undefined;
  const code = (error as { code?: unknown }).code;
  return typeof code === "string" ? code as FsCode : undefined;
}

export function throwStorageIo(error: unknown, fallback: "storage-failed" | "storage-corrupt"): never {
  if (error instanceof SnapshotStoreErrorV2) throw error;
  const code = getFsCode(error);
  if (code === "ELOOP" || code === "ENOTDIR" || code === "EISDIR") {
    storeErrorV2("storage-corrupt");
  }
  storeErrorV2(fallback);
}

export async function openBlobDirectoriesV2(root: string): Promise<BlobDirectoriesV2> {
  if (typeof root !== "string" || !isAbsolute(root)) storeErrorV2("invalid-input");
  const canonicalRoot = await preparePrivateDirectoryV2(resolve(root));
  const staging = join(canonicalRoot, ".staging");
  const sha256 = join(canonicalRoot, "sha256");
  await preparePrivateDirectoryV2(staging);
  await preparePrivateDirectoryV2(sha256);

  return Object.freeze({ root: canonicalRoot, staging, sha256 });
}

export async function ensureShardDirectoryV2(
  directories: BlobDirectoriesV2,
  prefix: string,
): Promise<string> {
  if (!/^[a-f0-9]{2}$/.test(prefix)) storeErrorV2("invalid-input");
  await assertDirectoryV2(directories.root);
  await assertDirectoryV2(directories.sha256);
  const shard = join(directories.sha256, prefix);
  return preparePrivateDirectoryV2(shard);
}

export async function assertDirectoryV2(path: string): Promise<void> {
  let stat;
  try {
    stat = await fs.lstat(path);
  } catch (error) {
    throwStorageIo(error, "storage-corrupt");
  }
  if (stat.isSymbolicLink() || !stat.isDirectory()) storeErrorV2("storage-corrupt");
}

export async function lstatMaybeV2(path: string): Promise<Awaited<ReturnType<typeof fs.lstat>> | undefined> {
  try {
    return await fs.lstat(path);
  } catch (error) {
    if (isMissingPathError(error)) return undefined;
    throwStorageIo(error, "storage-corrupt");
  }
}
