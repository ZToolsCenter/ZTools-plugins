import { lstat, readdir } from 'node:fs/promises';
import path from 'node:path';

export const DIST_SIZE_LIMIT_BYTES = 14_500_000;

export function assertWithinDistSizeLimit(bytes, limit = DIST_SIZE_LIMIT_BYTES) {
  if (!Number.isSafeInteger(bytes) || bytes < 0) throw new TypeError('dist byte count must be a non-negative safe integer');
  if (!Number.isSafeInteger(limit) || limit < 0) throw new TypeError('dist size limit must be a non-negative safe integer');
  if (bytes > limit) throw new Error(`dist is ${bytes} bytes and exceeds the 14.5 MB safety limit (${limit} bytes)`);
  return bytes;
}

export async function directoryBytes(directory, options = {}) {
  const {
    baseDirectory = directory,
    readEntries = readdir,
    inspectEntry = lstat
  } = options;
  let total = 0;

  for (const entry of await readEntries(directory, { withFileTypes: true })) {
    const entryPath = path.join(directory, entry.name);
    const metadata = await inspectEntry(entryPath);
    const relative = path.relative(baseDirectory, entryPath) || entry.name;

    if (metadata.isSymbolicLink()) throw new Error(`Unsupported dist symbolic link: ${relative}`);
    if (metadata.isDirectory()) {
      total += await directoryBytes(entryPath, { baseDirectory, readEntries, inspectEntry });
    } else if (metadata.isFile()) {
      if (!Number.isSafeInteger(metadata.size) || metadata.size < 0) throw new Error(`Invalid dist file size: ${relative}`);
      total += metadata.size;
      if (!Number.isSafeInteger(total)) throw new Error('dist byte count exceeds the safe integer range');
    } else {
      throw new Error(`Unsupported dist special file: ${relative}`);
    }
  }

  return total;
}
