import { createHash } from "node:crypto";
import { constants as fileSystemConstants } from "node:fs";
import {
  lstat,
  mkdir,
  open,
  readFile,
  realpath,
  rename,
  rm,
  stat,
  unlink,
  writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import {
  compareClock,
  mergeEntity,
  type Tombstone,
} from "@pasteboard-pro/sync-protocol";

import {
  documentsFromAllDocs,
  ZToolsCanonicalClipboardStore,
  type ZToolsDocumentDatabase,
} from "./clipboard-store";
import { ZToolsPinboardStore } from "./pinboard-store";
import type { SyncBlob, SyncEntity, SyncEntityRepository } from "./sync-runtime";
import {
  ZToolsWindowPreferencesStore,
  type SyncedWindowPreferences,
} from "./window-preferences";

const TOMBSTONE_PREFIX = "pasteboard-pro:tombstone:";
const MAX_BLOB_BYTES = 100 * 1_024 * 1_024;
const MANAGED_BLOB_FILE_PATTERN =
  /^([0-9a-f]{64})\.(png|jpg|webp|tiff|pdf|rtf|rtfd|bin)$/u;

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

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

async function existingFile(filePath: string): Promise<boolean> {
  try {
    return (await stat(filePath)).isFile();
  } catch (error) {
    if (isRecord(error) && error.code === "ENOENT") return false;
    throw error;
  }
}

function databaseStatus(error: unknown, status: number): boolean {
  return isRecord(error) && (error.status === status || error.statusCode === status);
}

function missingFile(error: unknown): boolean {
  return isRecord(error) && error.code === "ENOENT";
}

function insideRoot(root: string, candidate: string): boolean {
  const relative = path.relative(root, candidate);
  return (
    relative.length > 0 &&
    !relative.startsWith(`..${path.sep}`) &&
    relative !== ".." &&
    !path.isAbsolute(relative)
  );
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
  if (!insideRoot(root, target)) {
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
    identities.push({
      path: entry,
      device: status.dev,
      inode: status.ino,
    });
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
  if (blobId.length === 0) {
    throw new TypeError("Blob id must be non-empty");
  }
  if (blobId.includes("\0")) {
    throw new TypeError("Blob id cannot contain a NUL byte");
  }
  if (
    blobId === "." ||
    blobId === ".." ||
    blobId.includes("/") ||
    blobId.includes("\\")
  ) {
    throw new TypeError("Blob id must be a safe object identifier");
  }
}

function revision(value: unknown): string | undefined {
  return isRecord(value) && typeof value._rev === "string" ? value._rev : undefined;
}

function parsedTombstone(value: unknown): Tombstone | undefined {
  if (!isRecord(value) || value.type !== "pasteboard-pro-tombstone" || !isRecord(value.tombstone)) {
    return undefined;
  }
  const tombstone = value.tombstone;
  if (
    typeof tombstone.id !== "string" ||
    (tombstone.entityType !== "paste_item" && tombstone.entityType !== "pinboard") ||
    tombstone.deleted !== true ||
    typeof tombstone.deletedAt !== "string" ||
    typeof tombstone.sourceDeviceId !== "string" ||
    !isRecord(tombstone.clock) ||
    !Number.isSafeInteger(tombstone.clock.wallMs) ||
    !Number.isSafeInteger(tombstone.clock.counter) ||
    typeof tombstone.clock.deviceId !== "string"
  ) {
    return undefined;
  }
  return structuredClone(tombstone) as Tombstone;
}

function identity(entity: SyncEntity): string {
  if ("deleted" in entity) return `${entity.entityType}\0${entity.id}`;
  if ("entityType" in entity) return `${entity.entityType}\0${entity.id}`;
  return `${"kind" in entity ? "paste_item" : "pinboard"}\0${entity.id}`;
}

function isWindowPreferences(
  entity: SyncEntity,
): entity is SyncedWindowPreferences {
  return !("deleted" in entity) && "entityType" in entity;
}

export class ZToolsSyncEntityRepository implements SyncEntityRepository {
  private readonly clipboard: ZToolsCanonicalClipboardStore;
  private readonly pinboards: ZToolsPinboardStore;
  private readonly preferences: ZToolsWindowPreferencesStore;

  constructor(
    private readonly database: ZToolsDocumentDatabase,
    deviceId: string,
    private readonly blobRoot = path.join(
      os.homedir(),
      ".pasteboard-pro",
      "ztools",
      "blobs",
    ),
    private readonly legacyBlobRoots: readonly string[] = [],
    private readonly ready: Promise<void> = Promise.resolve(),
  ) {
    this.clipboard = new ZToolsCanonicalClipboardStore(database, { deviceId });
    this.pinboards = new ZToolsPinboardStore(database, { deviceId });
    this.preferences = new ZToolsWindowPreferencesStore(database, { deviceId });
  }

  private async tombstones(): Promise<Tombstone[]> {
    if (this.database.allDocs === undefined) return [];
    const result = await this.database.allDocs({
      include_docs: true,
      startkey: TOMBSTONE_PREFIX,
      endkey: `${TOMBSTONE_PREFIX}\uffff`,
    });
    return documentsFromAllDocs(
      result,
      "ZTools database returned invalid tombstone rows",
    ).flatMap((document) =>
      parsedTombstone(document) !== undefined
        ? [parsedTombstone(document)!]
        : [],
    );
  }

  async listEntities(): Promise<SyncEntity[]> {
    await this.ready;
    const preferences = await this.preferences.getSyncEntity();
    const entities: SyncEntity[] = [
      ...(await this.clipboard.listRecords()).map((record) => record.item),
      ...(await this.pinboards.list()),
      ...(preferences === undefined ? [] : [preferences]),
      ...(await this.tombstones()),
    ];
    const merged = new Map<string, SyncEntity>();
    for (const entity of entities) {
      const key = identity(entity);
      const current = merged.get(key);
      if (current === undefined) {
        merged.set(key, entity);
      } else if (isWindowPreferences(current) || isWindowPreferences(entity)) {
        if (!isWindowPreferences(current) || !isWindowPreferences(entity)) {
          throw new RangeError("Sync entity identity contains incompatible entity types");
        }
        merged.set(
          key,
          compareClock(current.clock, entity.clock) >= 0 ? current : entity,
        );
      } else {
        merged.set(key, mergeEntity(current, entity) as SyncEntity);
      }
    }
    return [...merged.values()].map((entity) => structuredClone(entity));
  }

  private tombstoneDocumentId(tombstone: Tombstone): string {
    return `${TOMBSTONE_PREFIX}${tombstone.entityType}:${tombstone.id}`;
  }

  private async removeTombstone(entityType: Tombstone["entityType"], id: string): Promise<void> {
    if (this.database.remove === undefined) return;
    const documentId = `${TOMBSTONE_PREFIX}${entityType}:${id}`;
    try {
      await this.database.remove(await this.database.get(documentId));
    } catch (error) {
      if (!databaseStatus(error, 404)) throw error;
    }
  }

  private async putTombstone(tombstone: Tombstone): Promise<void> {
    const id = this.tombstoneDocumentId(tombstone);
    for (let attempt = 0; attempt < 3; attempt += 1) {
      let current: unknown;
      try {
        current = await this.database.get(id);
      } catch (error) {
        if (!databaseStatus(error, 404)) throw error;
      }
      try {
        await this.database.put({
          _id: id,
          ...(revision(current) === undefined ? {} : { _rev: revision(current) }),
          type: "pasteboard-pro-tombstone",
          tombstone: structuredClone(tombstone),
        });
        return;
      } catch (error) {
        if (!databaseStatus(error, 409) || attempt === 2) throw error;
      }
    }
  }

  async applyEntities(entities: readonly SyncEntity[]): Promise<void> {
    await this.ready;
    for (const entity of entities) {
      if ("deleted" in entity) {
        if (entity.entityType === "paste_item") {
          await this.clipboard.removeSyncedItem(entity.id);
        } else {
          await this.pinboards.removeSynced(entity.id);
        }
        await this.putTombstone(entity);
      } else if ("entityType" in entity) {
        await this.preferences.putSynced(entity);
      } else if ("kind" in entity) {
        await this.removeTombstone("paste_item", entity.id);
        await this.clipboard.putSyncedItem(entity);
      } else {
        await this.removeTombstone("pinboard", entity.id);
        await this.pinboards.putSynced(entity);
      }
    }
  }

  async readBlob(blobId: string): Promise<SyncBlob | undefined> {
    await this.ready;
    const record = (await this.clipboard.listRecords()).find(
      (candidate) => candidate.item.payload.blobId === blobId,
    );
    if (record === undefined) return undefined;
    const imagePath = record.origin.imagePath;
    if (imagePath === undefined) return undefined;
    let bytes: Buffer;
    try {
      bytes = await readFile(imagePath);
    } catch (error) {
      if (databaseStatus(error, 404) || (isRecord(error) && error.code === "ENOENT")) {
        return undefined;
      }
      throw error;
    }
    if (bytes.byteLength > MAX_BLOB_BYTES) {
      throw new RangeError(`Blob ${blobId} exceeds 100 MiB`);
    }
    return {
      id: blobId,
      mediaType: record.item.payload.mediaType ?? "application/octet-stream",
      bytes: new Uint8Array(bytes),
    };
  }

  async storeLocalBlob(
    bytes: Uint8Array,
    mediaType: string,
  ): Promise<Readonly<{ id: string; imagePath: string; blobBytes: number }>> {
    await this.ready;
    if (bytes.byteLength > MAX_BLOB_BYTES) {
      throw new RangeError("Blob exceeds 100 MiB");
    }
    const digest = createHash("sha256").update(bytes).digest("hex");
    const imagePath = await this.writeBlobBytes(bytes, mediaType, digest);
    return {
      id: `blob-${digest}`,
      imagePath,
      blobBytes: bytes.byteLength,
    };
  }

  async deleteLocalBlob(input: Readonly<{ blobId: string; filePath: string }>): Promise<void> {
    await this.ready;
    assertBlobIdentifier(input.blobId);
    const filePath = path.resolve(input.filePath);
    const managedRoots = [this.blobRoot, ...this.legacyBlobRoots].map((root) => path.resolve(root));
    const lexicalRoot = managedRoots.find((root) => insideRoot(root, filePath));
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
    if (!insideRoot(canonicalRoot, canonicalFile)) {
      throw new TypeError("Refusing to delete a blob outside the canonical plugin blob directory");
    }
    if (managedBlobDigest(canonicalRoot, canonicalFile) !== expectedDigest) {
      throw new TypeError("Canonical blob path does not match its content-addressed layout");
    }

    const noFollow = process.platform === "win32"
      ? 0
      : fileSystemConstants.O_NOFOLLOW;
    const handle = await open(
      canonicalFile,
      fileSystemConstants.O_RDONLY | noFollow,
    );
    let handleOpen = true;
    try {
      const openedStatus = await handle.stat();
      if (!openedStatus.isFile()) {
        throw new TypeError("Managed blob target must remain a regular file");
      }
      if (openedStatus.size > MAX_BLOB_BYTES) {
        throw new RangeError("Managed blob exceeds 100 MiB");
      }
      const actualDigest = createHash("sha256")
        .update(await handle.readFile())
        .digest("hex");
      if (actualDigest !== expectedDigest) {
        throw new TypeError("Managed blob content does not match its path digest");
      }

      const remainingRecords = await this.clipboard.listRecords();
      for (const record of remainingRecords) {
        const recordPath = record.origin.imagePath;
        if (recordPath === undefined) continue;
        let canonicalRecordPath: string;
        try {
          canonicalRecordPath = await realpath(recordPath);
        } catch (error) {
          if (missingFile(error)) continue;
          throw error;
        }
        if (
          canonicalRecordPath === canonicalFile ||
          record.origin.pluginBlobId === input.blobId
        ) {
          return;
        }
      }

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
      // be made atomic with the verified file descriptor. The content-addressed
      // whitelist plus repeated parent/canonical/inode checks fail closed for
      // untrusted metadata and ordinary path replacement; a malicious process
      // racing this exact final syscall under the same OS account is outside
      // this API's enforceable boundary.
      await unlink(finalCanonicalFile);
    } finally {
      if (handleOpen) await handle.close();
    }
  }

  async writeBlob(blob: SyncBlob): Promise<void> {
    await this.ready;
    if (blob.bytes.byteLength > MAX_BLOB_BYTES) {
      throw new RangeError(`Blob ${blob.id} exceeds 100 MiB`);
    }
    const digest = createHash("sha256").update(blob.bytes).digest("hex");
    const destination = await this.writeBlobBytes(blob.bytes, blob.mediaType, digest);
    const records = await this.clipboard.listRecords();
    await Promise.all(
      records
        .filter((record) => record.item.payload.blobId === blob.id)
        .map((record) =>
          this.clipboard.attachSyncedBlob(
            record.item.id,
            blob.id,
            destination,
            blob.bytes.byteLength,
          ),
        ),
    );
  }

  private async writeBlobBytes(
    bytes: Uint8Array,
    mediaType: string,
    digest: string,
  ): Promise<string> {
    const directory = path.join(this.blobRoot, digest.slice(0, 2));
    const destination = path.join(
      directory,
      `${digest}.${blobExtension(mediaType)}`,
    );
    if (await existingFile(destination)) return destination;
    await mkdir(directory, { recursive: true });
    const temporary = `${destination}.tmp-${process.pid}-${Date.now()}`;
    try {
      await writeFile(temporary, bytes, { flag: "wx" });
      await rename(temporary, destination);
    } catch (error) {
      await rm(temporary, { force: true });
      if (await existingFile(destination)) return destination;
      throw error;
    }
    return destination;
  }
}
