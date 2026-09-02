import { lstat, readdir } from 'node:fs/promises';
import path from 'node:path';

export const DIST_SIZE_LIMIT = 14_500_000;

function relativeEntry(root, entryPath) {
  return path.relative(root, entryPath) || '.';
}

function unsupportedEntry(root, entryPath) {
  return new Error(`unsupported dist entry: ${relativeEntry(root, entryPath)}`);
}

export async function directoryBytes(
  directory,
  { root = directory, readDirectory = readdir, inspectPath = lstat } = {}
) {
  let bytes = 0;

  for (const entry of await readDirectory(directory, { withFileTypes: true })) {
    const entryPath = path.join(directory, entry.name);

    // Dirent rejects links and special files before following anything. lstat
    // closes the race/type-mismatch gap and deliberately never follows links.
    if (!entry.isDirectory() && !entry.isFile()) throw unsupportedEntry(root, entryPath);

    const metadata = await inspectPath(entryPath);
    if (metadata.isSymbolicLink()) throw unsupportedEntry(root, entryPath);
    if (entry.isDirectory() && metadata.isDirectory()) {
      bytes += await directoryBytes(entryPath, { root, readDirectory, inspectPath });
    } else if (entry.isFile() && metadata.isFile()) {
      bytes += metadata.size;
    } else {
      throw unsupportedEntry(root, entryPath);
    }
  }

  return bytes;
}

export function assertDistSize(bytes, limit = DIST_SIZE_LIMIT) {
  if (!Number.isSafeInteger(bytes) || bytes < 0) throw new TypeError('dist size must be a non-negative safe integer');
  if (bytes > limit) throw new Error(`dist size ${bytes} exceeds the 14.5 MB safety limit (${limit} bytes)`);
  return bytes;
}
