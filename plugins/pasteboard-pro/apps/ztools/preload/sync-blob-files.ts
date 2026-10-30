import { createHash, randomUUID } from "node:crypto";
import { constants as fileSystemConstants } from "node:fs";
import {
  lstat,
  mkdir,
  open,
  realpath,
  rename,
  rm,
  unlink,
} from "node:fs/promises";
import path from "node:path";

import {
  assertCanonicalManagedBlobFile,
  assertManagedBlobDirectoryContinuation,
  inspectManagedBlobDirectory,
  isInsideManagedBlobRoot,
  sameManagedBlobDirectoryChain,
} from "./sync-blob-directory";
import {
  MAX_SYNC_BLOB_BYTES,
  readBoundedImageBytes,
  SyncBlobPathChangedError,
  SyncBlobReadLimitError,
} from "./sync-blob-read";

export {
  MAX_SYNC_BLOB_BYTES,
  readBoundedImageBytes,
  SyncBlobPathChangedError,
  SyncBlobReadLimitError,
} from "./sync-blob-read";

const MANAGED_BLOB_FILE_PATTERN =
  /^([0-9a-f]{64})\.(png|jpg|webp|tiff|pdf|rtf|rtfd|bin)$/u;

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function missingFile(error: unknown): boolean {
  return isRecord(error) && error.code === "ENOENT";
}

function blobExtension(mediaType: string): string {
  return (
    {
      "image/png": "png",
      "image/jpeg": "jpg",
      "image/webp": "webp",
      "image/tiff": "tiff",
      "application/pdf": "pdf",
      "text/rtf": "rtf",
      "text/rtfd": "rtfd",
    } as Readonly<Record<string, string>>
  )[mediaType] ?? "bin";
}

function assertRegularTarget(status: Awaited<ReturnType<typeof lstat>>): void {
  if (status.isSymbolicLink()) {
    throw new TypeError("Refusing to read or replace a symbolic-link blob target");
  }
  if (!status.isFile()) {
    throw new TypeError("Managed blob target must be a regular file");
  }
}

async function isVerifiedBlobFile(
  root: string,
  filePath: string,
  expectedDigest: string,
  expectedLength: number,
): Promise<boolean> {
  const resolvedRoot = path.resolve(root);
  const resolvedPath = path.resolve(filePath);
  if (!isInsideManagedBlobRoot(resolvedRoot, resolvedPath)) {
    throw new TypeError("Refusing to verify a blob outside its managed root");
  }

  const directory = path.dirname(resolvedPath);
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const directoryBeforeRead = await inspectManagedBlobDirectory(directory, true);
    let initialStatus;
    try {
      initialStatus = await lstat(resolvedPath);
    } catch (error) {
      if (missingFile(error)) return false;
      throw error;
    }
    assertRegularTarget(initialStatus);
    if (initialStatus.size !== expectedLength) return false;
    if (!directoryBeforeRead.complete) {
      throw new TypeError("Managed blob file exists below an incomplete directory chain");
    }

    try {
      const canonicalBeforeRead = await assertCanonicalManagedBlobFile(
        resolvedRoot,
        resolvedPath,
      );
      const content = await readBoundedImageBytes(resolvedPath);
      const canonicalAfterRead = await assertCanonicalManagedBlobFile(
        resolvedRoot,
        resolvedPath,
      );
      const directoryAfterRead = await inspectManagedBlobDirectory(directory, false);
      if (
        !sameManagedBlobDirectoryChain(directoryBeforeRead, directoryAfterRead) ||
        canonicalBeforeRead.canonicalRoot !== canonicalAfterRead.canonicalRoot ||
        canonicalBeforeRead.canonicalFile !== canonicalAfterRead.canonicalFile
      ) {
        throw new SyncBlobPathChangedError(
          "Managed blob path changed while its cached bytes were verified",
        );
      }
      if (content.byteLength !== expectedLength) return false;
      const digest = createHash("sha256").update(content).digest("hex");
      return digest === expectedDigest;
    } catch (error) {
      if (error instanceof SyncBlobReadLimitError) return false;
      if (
        attempt < 3 &&
        (error instanceof SyncBlobPathChangedError || missingFile(error))
      ) {
        continue;
      }
      throw error;
    }
  }
  return false;
}

async function assertReplaceableTarget(filePath: string): Promise<void> {
  let status;
  try {
    status = await lstat(filePath);
  } catch (error) {
    if (missingFile(error)) return;
    throw error;
  }
  assertRegularTarget(status);
}

export type WrittenSyncBlobFile = Readonly<{
  digest: string;
  filePath: string;
  byteLength: number;
}>;

export async function writeVerifiedSyncBlobFile(
  root: string,
  bytes: Uint8Array,
  mediaType: string,
): Promise<WrittenSyncBlobFile> {
  if (bytes.byteLength > MAX_SYNC_BLOB_BYTES) {
    throw new RangeError("Blob exceeds 100 MiB");
  }

  const digest = createHash("sha256").update(bytes).digest("hex");
  const resolvedRoot = path.resolve(root);
  const directory = path.join(resolvedRoot, digest.slice(0, 2));
  const filePath = path.join(directory, `${digest}.${blobExtension(mediaType)}`);
  if (!isInsideManagedBlobRoot(resolvedRoot, filePath)) {
    throw new TypeError("Blob destination is outside its managed root");
  }
  const initialDirectoryChain = await inspectManagedBlobDirectory(directory, true);
  let temporary: string | undefined;
  let verifiedPath: string | undefined;
  let failure: unknown;

  try {
    if (await isVerifiedBlobFile(resolvedRoot, filePath, digest, bytes.byteLength)) {
      const chainAfterRead = await inspectManagedBlobDirectory(directory, false);
      assertManagedBlobDirectoryContinuation(initialDirectoryChain, chainAfterRead);
      verifiedPath = filePath;
    } else {
      await mkdir(directory, { recursive: true });
      const preparedDirectoryChain = await inspectManagedBlobDirectory(directory, false);
      assertManagedBlobDirectoryContinuation(initialDirectoryChain, preparedDirectoryChain);
      if (await isVerifiedBlobFile(resolvedRoot, filePath, digest, bytes.byteLength)) {
        const chainAfterRead = await inspectManagedBlobDirectory(directory, false);
        if (!sameManagedBlobDirectoryChain(preparedDirectoryChain, chainAfterRead)) {
          throw new SyncBlobPathChangedError(
            "Managed blob directory changed during cache verification",
          );
        }
        verifiedPath = filePath;
      } else {
        const beforeTemporary = await inspectManagedBlobDirectory(directory, false);
        if (!sameManagedBlobDirectoryChain(preparedDirectoryChain, beforeTemporary)) {
          throw new SyncBlobPathChangedError(
            "Managed blob directory changed before temporary-file creation",
          );
        }
        const candidate = `${filePath}.tmp-${randomUUID()}`;
        const temporaryHandle = await open(candidate, "wx");
        temporary = candidate;
        try {
          await temporaryHandle.writeFile(bytes);
        } finally {
          await temporaryHandle.close();
        }

        const afterTemporaryWrite = await inspectManagedBlobDirectory(directory, false);
        if (!sameManagedBlobDirectoryChain(preparedDirectoryChain, afterTemporaryWrite)) {
          throw new SyncBlobPathChangedError(
            "Managed blob directory changed while writing its temporary file",
          );
        }

        if (await isVerifiedBlobFile(resolvedRoot, filePath, digest, bytes.byteLength)) {
          const chainAfterRead = await inspectManagedBlobDirectory(directory, false);
          if (!sameManagedBlobDirectoryChain(preparedDirectoryChain, chainAfterRead)) {
            throw new SyncBlobPathChangedError(
              "Managed blob directory changed during concurrent cache verification",
            );
          }
          verifiedPath = filePath;
        } else {
          await assertReplaceableTarget(filePath);
          const beforeRename = await inspectManagedBlobDirectory(directory, false);
          if (!sameManagedBlobDirectoryChain(preparedDirectoryChain, beforeRename)) {
            throw new SyncBlobPathChangedError(
              "Managed blob directory changed before cache replacement",
            );
          }
          await rename(temporary, filePath);
          temporary = undefined;
          if (!(await isVerifiedBlobFile(resolvedRoot, filePath, digest, bytes.byteLength))) {
            throw new TypeError("Written blob failed length and SHA-256 verification");
          }
          const afterFinalVerification = await inspectManagedBlobDirectory(directory, false);
          if (
            !sameManagedBlobDirectoryChain(
              preparedDirectoryChain,
              afterFinalVerification,
            )
          ) {
            throw new SyncBlobPathChangedError(
              "Managed blob directory changed after cache verification",
            );
          }
          verifiedPath = filePath;
        }
      }
    }
  } catch (error) {
    failure = error;
  }

  if (temporary !== undefined) {
    try {
      await rm(temporary, { force: true });
    } catch (error) {
      failure ??= error;
    }
  }
  if (failure !== undefined) throw failure;
  if (verifiedPath === undefined) {
    throw new Error("Blob write completed without a verified destination");
  }

  return { digest, filePath: verifiedPath, byteLength: bytes.byteLength };
}

type PathIdentity = Readonly<{
  path: string;
  device: number;
  inode: number;
}>;

async function checkedPathChain(
  root: string,
  target: string,
): Promise<readonly PathIdentity[] | undefined> {
  const relative = path.relative(root, target);
  if (!isInsideManagedBlobRoot(root, target)) {
    throw new TypeError("Refusing to inspect a blob outside its managed root");
  }
  const entries = [root];
  let cursor = root;
  for (const segment of relative.split(path.sep)) {
    cursor = path.join(cursor, segment);
    entries.push(cursor);
  }

  const identities: PathIdentity[] = [];
  for (let index = 0; index < entries.length; index += 1) {
    const entry = entries[index]!;
    let status;
    try {
      status = await lstat(entry);
    } catch (error) {
      if (missingFile(error)) return undefined;
      throw error;
    }
    if (status.isSymbolicLink()) {
      throw new TypeError(
        index === 0
          ? "Refusing to delete through a symbolic-link blob root"
          : "Refusing to delete through a symbolic link",
      );
    }
    const isTarget = index === entries.length - 1;
    if (!isTarget && !status.isDirectory()) {
      throw new TypeError("Blob parent path must contain only directories");
    }
    if (isTarget && !status.isFile()) {
      throw new TypeError("Managed blob target must be a regular file");
    }
    identities.push({ path: entry, device: status.dev, inode: status.ino });
  }
  return identities;
}

function samePathChain(
  before: readonly PathIdentity[],
  after: readonly PathIdentity[],
): boolean {
  return (
    before.length === after.length &&
    before.every((entry, index) => {
      const candidate = after[index];
      return (
        candidate !== undefined &&
        entry.path === candidate.path &&
        entry.device === candidate.device &&
        entry.inode === candidate.inode
      );
    })
  );
}

function managedBlobDigest(root: string, filePath: string): string | undefined {
  const relative = path.relative(root, filePath);
  const segments = relative.split(path.sep);
  if (segments.length !== 2) return undefined;
  const match = MANAGED_BLOB_FILE_PATTERN.exec(segments[1]!);
  if (match === null || segments[0] !== match[1]!.slice(0, 2)) return undefined;
  return match[1];
}

function assertBlobIdentifier(blobId: string): void {
  if (blobId.length === 0) throw new TypeError("Blob id must be non-empty");
  if (blobId.includes("\0")) throw new TypeError("Blob id cannot contain a NUL byte");
  if (
    blobId === "." ||
    blobId === ".." ||
    blobId.includes("/") ||
    blobId.includes("\\")
  ) {
    throw new TypeError("Blob id must be a safe object identifier");
  }
}

export type DeleteSyncBlobInput = Readonly<{ blobId: string; filePath: string }>;

export async function deleteManagedSyncBlobFile(
  input: DeleteSyncBlobInput,
  managedRoots: readonly string[],
  isReferenced: (canonicalFile: string, blobId: string) => Promise<boolean>,
): Promise<void> {
  assertBlobIdentifier(input.blobId);
  const filePath = path.resolve(input.filePath);
  const resolvedRoots = managedRoots.map((root) => path.resolve(root));
  const lexicalRoot = resolvedRoots.find((root) => isInsideManagedBlobRoot(root, filePath));
  if (lexicalRoot === undefined) {
    throw new TypeError("Refusing to delete a blob outside the plugin blob directory");
  }

  const initialChain = await checkedPathChain(lexicalRoot, filePath);
  if (initialChain === undefined) return;
  const expectedDigest = managedBlobDigest(lexicalRoot, filePath);
  if (expectedDigest === undefined) {
    throw new TypeError("Refusing to delete a blob outside the content-addressed layout");
  }

  const [canonicalRoot, canonicalFile] = await Promise.all([
    realpath(lexicalRoot),
    realpath(filePath),
  ]);
  if (!isInsideManagedBlobRoot(canonicalRoot, canonicalFile)) {
    throw new TypeError("Refusing to delete a blob outside the canonical plugin blob directory");
  }
  if (managedBlobDigest(canonicalRoot, canonicalFile) !== expectedDigest) {
    throw new TypeError("Canonical blob path does not match its content-addressed layout");
  }

  const noFollow = process.platform === "win32" ? 0 : fileSystemConstants.O_NOFOLLOW;
  const handle = await open(canonicalFile, fileSystemConstants.O_RDONLY | noFollow);
  let handleOpen = true;
  try {
    const openedStatus = await handle.stat();
    if (!openedStatus.isFile()) {
      throw new TypeError("Managed blob target must remain a regular file");
    }
    if (openedStatus.size > MAX_SYNC_BLOB_BYTES) {
      throw new RangeError("Managed blob exceeds 100 MiB");
    }
    const actualDigest = createHash("sha256")
      .update(await handle.readFile())
      .digest("hex");
    if (actualDigest !== expectedDigest) {
      throw new TypeError("Managed blob content does not match its path digest");
    }

    if (await isReferenced(canonicalFile, input.blobId)) return;

    const finalChain = await checkedPathChain(lexicalRoot, filePath);
    if (finalChain === undefined || !samePathChain(initialChain, finalChain)) {
      throw new TypeError("Managed blob path changed during deletion validation");
    }
    const [finalCanonicalRoot, finalCanonicalFile] = await Promise.all([
      realpath(lexicalRoot),
      realpath(filePath),
    ]);
    if (
      finalCanonicalRoot !== canonicalRoot ||
      finalCanonicalFile !== canonicalFile
    ) {
      throw new TypeError("Managed blob canonical path changed during deletion validation");
    }
    const finalStatus = await lstat(finalCanonicalFile);
    if (
      finalStatus.isSymbolicLink() ||
      !finalStatus.isFile() ||
      finalStatus.dev !== openedStatus.dev ||
      finalStatus.ino !== openedStatus.ino
    ) {
      throw new TypeError("Managed blob file changed during deletion validation");
    }

    if (process.platform === "win32") {
      await handle.close();
      handleOpen = false;
    }
    // Node does not expose unlinkat(2), so the final pathname unlink cannot
    // be made atomic with the verified file descriptor. Repeated path and
    // inode checks fail closed for untrusted metadata and ordinary replacement.
    await unlink(finalCanonicalFile);
  } finally {
    if (handleOpen) await handle.close();
  }
}
