import { constants } from "node:fs";
import { lstat, mkdir, open, realpath } from "node:fs/promises";
import path from "node:path";
import { SnapshotStoreErrorV2 } from "./errors.js";

export async function syncDirectoryV2(directory: string): Promise<void> {
  let handle;
  try {
    handle = await open(directory, constants.O_RDONLY);
    await handle.sync();
  } catch {
    throw new SnapshotStoreErrorV2("directory-sync-unavailable");
  } finally {
    try { await handle?.close(); }
    catch { throw new SnapshotStoreErrorV2("directory-sync-unavailable"); }
  }
}

/** Only a trusted owner supplies paths. Existing parent directories are never chmod'ed. */
export async function preparePrivateDirectoryV2(directory: string): Promise<string> {
  // POSIX mode bits do not establish a Windows DACL. A verified Windows
  // directory/ACL adapter remains required before raw storage can be enabled.
  if (process.platform === "win32") throw new SnapshotStoreErrorV2("private-directory-unavailable");
  if (typeof directory !== "string" || !path.isAbsolute(directory) ||
      path.parse(directory).root === path.resolve(directory)) {
    throw new SnapshotStoreErrorV2("invalid-input");
  }
  const normalized = path.resolve(directory);
  let canonicalParent: string;
  try { canonicalParent = await realpath(path.dirname(normalized)); }
  catch { throw new SnapshotStoreErrorV2("storage-failed"); }
  const canonical = path.join(canonicalParent, path.basename(normalized));
  try { await mkdir(canonical, { mode: 0o700 }); }
  catch (error) {
    if (!(error instanceof Error) || !("code" in error) || error.code !== "EEXIST") {
      throw new SnapshotStoreErrorV2("storage-failed");
    }
  }
  let stat;
  try { stat = await lstat(canonical); }
  catch { throw new SnapshotStoreErrorV2("storage-failed"); }
  if (!stat.isDirectory() || stat.isSymbolicLink() ||
      (typeof process.getuid === "function" && stat.uid !== process.getuid()) ||
      (stat.mode & 0o077) !== 0) {
    throw new SnapshotStoreErrorV2("invalid-input");
  }
  await syncDirectoryV2(canonical);
  await syncDirectoryV2(canonicalParent);
  return canonical;
}
