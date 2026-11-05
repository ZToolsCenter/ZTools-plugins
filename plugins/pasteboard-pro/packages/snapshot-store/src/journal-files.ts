import { constants, lstatSync } from "node:fs";
import * as fs from "node:fs/promises";
import { join } from "node:path";

import { storeErrorV2 } from "./errors.js";
import { syncDirectoryV2 } from "./fs-directory.js";
import { isSnapshotStoreError } from "./journal-validation.js";

export const JOURNAL_INITIALIZATION_INTENT_FILE_V2 = ".journal-v2-init";
type DatabaseFileName = "data.mdb" | "lock.mdb";
export type JournalFileIdentityV2 = Readonly<{ dev: number; ino: number }>;
type InspectedDatabaseFileV2 = Readonly<{ identity: JournalFileIdentityV2; size: number }>;
type DatabaseFilesV2 = ReadonlyMap<DatabaseFileName, InspectedDatabaseFileV2>;
type JournalFileScanV2 = Readonly<{
  databaseFiles: DatabaseFilesV2;
  initializationIntent?: JournalFileIdentityV2;
}>;
export type PreparedJournalFilesV2 = Readonly<{
  hadEnvironmentFiles: boolean;
  databaseFiles: ReadonlyMap<DatabaseFileName, JournalFileIdentityV2>;
  initializationIntent?: JournalFileIdentityV2;
}>;

const DATABASE_FILE_NAMES = ["data.mdb", "lock.mdb"] as const;
const ALLOWED_FILES = new Set<string>([
  ...DATABASE_FILE_NAMES,
  JOURNAL_INITIALIZATION_INTENT_FILE_V2,
]);

function errorCode(error: unknown): string | undefined {
  return typeof error === "object" && error !== null && "code" in error
    ? String((error as { code?: unknown }).code)
    : undefined;
}

function asFileFailure(error: unknown): never {
  if (isSnapshotStoreError(error)) throw error;
  if (["ELOOP", "ENOTDIR", "EISDIR"].includes(errorCode(error) ?? "")) {
    storeErrorV2("storage-corrupt");
  }
  storeErrorV2("storage-failed");
}

async function closeFileHandle(
  handle: Awaited<ReturnType<typeof fs.open>> | undefined,
): Promise<void> {
  if (!handle) return;
  try { await handle.close(); }
  catch (error) { asFileFailure(error); }
}

function noFollowFlag(): number {
  return process.platform === "win32" ? 0 : constants.O_NOFOLLOW;
}

function identityFromStat(
  stat: Awaited<ReturnType<typeof fs.lstat>>,
): JournalFileIdentityV2 {
  return Object.freeze({ dev: Number(stat.dev), ino: Number(stat.ino) });
}

function assertOwnedRegularFile(
  stat: Awaited<ReturnType<typeof fs.lstat>>,
  code: "storage-corrupt" | "storage-failed",
): void {
  if (!stat.isFile() || stat.isSymbolicLink() ||
      (typeof process.getuid === "function" && stat.uid !== process.getuid())) {
    storeErrorV2(code);
  }
}

function assertPrivateMode(
  stat: Awaited<ReturnType<typeof fs.lstat>>,
  code: "storage-corrupt" | "storage-failed",
): void {
  if (process.platform !== "win32" && (Number(stat.mode) & 0o777) !== 0o600) {
    storeErrorV2(code);
  }
}

function sameIdentity(
  left: JournalFileIdentityV2,
  right: JournalFileIdentityV2,
): boolean {
  return left.dev === right.dev && left.ino === right.ino;
}

async function readInitializationIntent(
  directory: string,
): Promise<JournalFileIdentityV2 | undefined> {
  const path = join(directory, JOURNAL_INITIALIZATION_INTENT_FILE_V2);
  let before: Awaited<ReturnType<typeof fs.lstat>>;
  try { before = await fs.lstat(path); }
  catch (error) {
    if (errorCode(error) === "ENOENT") return undefined;
    asFileFailure(error);
  }
  assertOwnedRegularFile(before, "storage-corrupt");
  assertPrivateMode(before, "storage-corrupt");
  if (before.size !== 0) storeErrorV2("storage-corrupt");

  let handle: Awaited<ReturnType<typeof fs.open>> | undefined;
  try {
    handle = await fs.open(path, constants.O_RDONLY | noFollowFlag());
    const opened = await handle.stat();
    assertOwnedRegularFile(opened, "storage-corrupt");
    assertPrivateMode(opened, "storage-corrupt");
    if (opened.dev !== before.dev || opened.ino !== before.ino || opened.size !== 0) {
      storeErrorV2("storage-corrupt");
    }
    const probe = new Uint8Array(1);
    const { bytesRead } = await handle.read(probe, 0, 1, 0);
    if (bytesRead !== 0) storeErrorV2("storage-corrupt");
    const after = await fs.lstat(path);
    assertOwnedRegularFile(after, "storage-corrupt");
    assertPrivateMode(after, "storage-corrupt");
    if (after.dev !== opened.dev || after.ino !== opened.ino || after.size !== 0) {
      storeErrorV2("storage-corrupt");
    }
    return Object.freeze({ dev: opened.dev, ino: opened.ino });
  } catch (error) {
    if (isSnapshotStoreError(error)) throw error;
    asFileFailure(error);
  } finally {
    await closeFileHandle(handle);
  }
}

async function inspectDatabaseFile(
  directory: string,
  name: DatabaseFileName,
): Promise<InspectedDatabaseFileV2 | undefined> {
  const path = join(directory, name);
  let before: Awaited<ReturnType<typeof fs.lstat>>;
  try { before = await fs.lstat(path); }
  catch (error) {
    if (errorCode(error) === "ENOENT") return undefined;
    asFileFailure(error);
  }
  assertOwnedRegularFile(before, "storage-corrupt");

  let handle: Awaited<ReturnType<typeof fs.open>> | undefined;
  try {
    handle = await fs.open(path, constants.O_RDWR | noFollowFlag());
    const opened = await handle.stat();
    assertOwnedRegularFile(opened, "storage-corrupt");
    if (opened.dev !== before.dev || opened.ino !== before.ino) {
      storeErrorV2("storage-corrupt");
    }
    await handle.chmod(0o600);
    const privateStat = await handle.stat();
    assertOwnedRegularFile(privateStat, "storage-corrupt");
    assertPrivateMode(privateStat, "storage-failed");
    if (privateStat.dev !== before.dev || privateStat.ino !== before.ino) {
      storeErrorV2("storage-corrupt");
    }
    await handle.sync();
    const after = await fs.lstat(path);
    assertOwnedRegularFile(after, "storage-corrupt");
    assertPrivateMode(after, "storage-failed");
    if (after.dev !== privateStat.dev || after.ino !== privateStat.ino) {
      storeErrorV2("storage-corrupt");
    }
    return Object.freeze({
      identity: Object.freeze({ dev: privateStat.dev, ino: privateStat.ino }),
      size: privateStat.size,
    });
  } catch (error) {
    if (isSnapshotStoreError(error)) throw error;
    asFileFailure(error);
  } finally {
    await closeFileHandle(handle);
  }
}

async function scanJournalFiles(directory: string): Promise<JournalFileScanV2> {
  let entries: string[];
  try { entries = await fs.readdir(directory); }
  catch (error) { asFileFailure(error); }
  if (entries.some((entry) => !ALLOWED_FILES.has(entry))) storeErrorV2("storage-corrupt");

  const initializationIntent = await readInitializationIntent(directory);
  const databaseFiles = new Map<DatabaseFileName, InspectedDatabaseFileV2>();
  for (const name of DATABASE_FILE_NAMES) {
    const file = await inspectDatabaseFile(directory, name);
    if (file) databaseFiles.set(name, file);
  }
  return Object.freeze({ databaseFiles, ...(initializationIntent ? { initializationIntent } : {}) });
}

async function createInitializationIntent(
  directory: string,
): Promise<JournalFileIdentityV2> {
  const path = join(directory, JOURNAL_INITIALIZATION_INTENT_FILE_V2);
  let handle: Awaited<ReturnType<typeof fs.open>> | undefined;
  try {
    handle = await fs.open(
      path,
      constants.O_CREAT | constants.O_EXCL | constants.O_RDWR | noFollowFlag(),
      0o600,
    );
    const opened = await handle.stat();
    assertOwnedRegularFile(opened, "storage-corrupt");
    await handle.chmod(0o600);
    const privateStat = await handle.stat();
    assertOwnedRegularFile(privateStat, "storage-corrupt");
    assertPrivateMode(privateStat, "storage-failed");
    if (privateStat.size !== 0) storeErrorV2("storage-corrupt");
    await handle.sync();
    await handle.close();
    handle = undefined;
    await syncDirectoryV2(directory);
    const validated = await readInitializationIntent(directory);
    if (!validated || !sameIdentity(validated, identityFromStat(privateStat))) {
      storeErrorV2("storage-corrupt");
    }
    return validated;
  } catch (error) {
    if (errorCode(error) === "EEXIST") {
      const raced = await readInitializationIntent(directory);
      if (!raced) return storeErrorV2("storage-corrupt");
      await syncDirectoryV2(directory);
      return raced;
    }
    if (isSnapshotStoreError(error)) throw error;
    return asFileFailure(error);
  } finally {
    await closeFileHandle(handle);
  }
}

async function createPrivateDatabaseFile(
  directory: string,
  name: DatabaseFileName,
): Promise<void> {
  let handle: Awaited<ReturnType<typeof fs.open>> | undefined;
  try {
    handle = await fs.open(
      join(directory, name),
      constants.O_CREAT | constants.O_EXCL | constants.O_RDWR | noFollowFlag(),
      0o600,
    );
    await handle.chmod(0o600);
    const stat = await handle.stat();
    assertOwnedRegularFile(stat, "storage-corrupt");
    assertPrivateMode(stat, "storage-failed");
    if (stat.size !== 0) storeErrorV2("storage-corrupt");
    await handle.sync();
  } catch (error) {
    if (errorCode(error) === "EEXIST") storeErrorV2("conflict");
    if (isSnapshotStoreError(error)) throw error;
    asFileFailure(error);
  } finally {
    await closeFileHandle(handle);
  }
}

export async function prepareJournalFilesV2(directory: string): Promise<PreparedJournalFilesV2> {
  let scan = await scanJournalFiles(directory);
  const hadEnvironmentFiles = scan.databaseFiles.size > 0;
  let initializationIntent = scan.initializationIntent;

  if (!initializationIntent) {
    if (scan.databaseFiles.size === 0) {
      initializationIntent = await createInitializationIntent(directory);
    } else {
      // Recheck for a concurrent first opener that durably created intent before its DB files.
      initializationIntent = await readInitializationIntent(directory);
      if (initializationIntent) await syncDirectoryV2(directory);
      else {
        if (scan.databaseFiles.size !== DATABASE_FILE_NAMES.length ||
            [...scan.databaseFiles.values()].some((file) => file.size === 0)) {
          storeErrorV2("storage-corrupt");
        }
        return Object.freeze({
          hadEnvironmentFiles,
          databaseFiles: new Map([...scan.databaseFiles].map(([name, file]) => [name, file.identity])),
        });
      }
    }
  } else {
    await syncDirectoryV2(directory);
  }

  const missingNames = DATABASE_FILE_NAMES.filter((name) => !scan.databaseFiles.has(name));
  if (missingNames.length > 0 && [...scan.databaseFiles.values()].some((file) => file.size !== 0)) {
    storeErrorV2("storage-corrupt");
  }
  for (const name of missingNames) await createPrivateDatabaseFile(directory, name);
  if (missingNames.length > 0) await syncDirectoryV2(directory);

  scan = await scanJournalFiles(directory);
  if (scan.databaseFiles.size !== DATABASE_FILE_NAMES.length) storeErrorV2("storage-corrupt");
  if (scan.initializationIntent && !sameIdentity(scan.initializationIntent, initializationIntent)) {
    storeErrorV2("storage-corrupt");
  }
  return Object.freeze({
    hadEnvironmentFiles,
    databaseFiles: new Map([...scan.databaseFiles].map(([name, file]) => [name, file.identity])),
    initializationIntent,
  });
}

export async function verifyOpenJournalFilesV2(
  directory: string,
  expected: PreparedJournalFilesV2,
): Promise<void> {
  let entries: string[];
  try { entries = await fs.readdir(directory); }
  catch (error) { asFileFailure(error); }
  if (entries.some((entry) => !ALLOWED_FILES.has(entry)) ||
      !DATABASE_FILE_NAMES.every((name) => entries.includes(name))) {
    storeErrorV2("storage-corrupt");
  }
  for (const name of DATABASE_FILE_NAMES) {
    const identity = expected.databaseFiles.get(name);
    if (!identity) storeErrorV2("storage-corrupt");
    let stat: Awaited<ReturnType<typeof fs.lstat>>;
    try { stat = await fs.lstat(join(directory, name)); }
    catch (error) { asFileFailure(error); }
    assertOwnedRegularFile(stat, "storage-corrupt");
    assertPrivateMode(stat, "storage-corrupt");
    if (stat.dev !== identity.dev || stat.ino !== identity.ino) storeErrorV2("storage-corrupt");
  }

  let intentStat: Awaited<ReturnType<typeof fs.lstat>> | undefined;
  try { intentStat = await fs.lstat(join(directory, JOURNAL_INITIALIZATION_INTENT_FILE_V2)); }
  catch (error) {
    if (errorCode(error) !== "ENOENT") asFileFailure(error);
  }
  if (intentStat) {
    assertOwnedRegularFile(intentStat, "storage-corrupt");
    assertPrivateMode(intentStat, "storage-corrupt");
    if (!expected.initializationIntent || intentStat.size !== 0 ||
        !sameIdentity(identityFromStat(intentStat), expected.initializationIntent)) storeErrorV2("storage-corrupt");
  }
}

export function assertInitializationIntentV2(
  directory: string,
  expected: JournalFileIdentityV2 | undefined,
): void {
  if (!expected) storeErrorV2("storage-corrupt");
  try {
    const stat = lstatSync(join(directory, JOURNAL_INITIALIZATION_INTENT_FILE_V2));
    assertOwnedRegularFile(stat, "storage-corrupt");
    assertPrivateMode(stat, "storage-corrupt");
    if (stat.size !== 0 || !sameIdentity(stat, expected)) storeErrorV2("storage-corrupt");
  } catch (error) {
    if (isSnapshotStoreError(error)) throw error;
    storeErrorV2("storage-corrupt");
  }
}

export async function finalizeInitializationIntentV2(
  directory: string,
  expected: JournalFileIdentityV2 | undefined,
): Promise<void> {
  if (!expected) return;
  const path = join(directory, JOURNAL_INITIALIZATION_INTENT_FILE_V2);
  let stat: Awaited<ReturnType<typeof fs.lstat>>;
  try { stat = await fs.lstat(path); }
  catch (error) {
    if (errorCode(error) === "ENOENT") return;
    asFileFailure(error);
  }
  assertOwnedRegularFile(stat, "storage-corrupt");
  assertPrivateMode(stat, "storage-corrupt");
  if (stat.size !== 0 || !sameIdentity(stat, expected)) storeErrorV2("storage-corrupt");
  try { await fs.unlink(path); }
  catch (error) {
    if (errorCode(error) === "ENOENT") return;
    asFileFailure(error);
  }
  await syncDirectoryV2(directory);
}
