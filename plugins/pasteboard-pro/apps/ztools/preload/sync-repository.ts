import { createHash } from "node:crypto";
import { mkdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { mergeEntity, type Tombstone } from "@pasteboard-pro/sync-protocol";

import {
  documentsFromAllDocs,
  ZToolsCanonicalClipboardStore,
  type ZToolsDocumentDatabase,
} from "./clipboard-store";
import { ZToolsPinboardStore } from "./pinboard-store";
import type { SyncBlob, SyncEntity, SyncEntityRepository } from "./sync-runtime";

const TOMBSTONE_PREFIX = "pasteboard-pro:tombstone:";
const MAX_BLOB_BYTES = 100 * 1_024 * 1_024;

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
  return `${"kind" in entity ? "paste_item" : "pinboard"}\0${entity.id}`;
}

export class ZToolsSyncEntityRepository implements SyncEntityRepository {
  private readonly clipboard: ZToolsCanonicalClipboardStore;
  private readonly pinboards: ZToolsPinboardStore;

  constructor(
    private readonly database: ZToolsDocumentDatabase,
    deviceId: string,
    private readonly blobRoot = path.join(
      os.homedir(),
      ".pasteboard-pro",
      "ztools",
      "blobs",
    ),
  ) {
    this.clipboard = new ZToolsCanonicalClipboardStore(database, { deviceId });
    this.pinboards = new ZToolsPinboardStore(database, { deviceId });
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
    const entities: SyncEntity[] = [
      ...(await this.clipboard.listRecords()).map((record) => record.item),
      ...(await this.pinboards.list()),
      ...(await this.tombstones()),
    ];
    const merged = new Map<string, SyncEntity>();
    for (const entity of entities) {
      const key = identity(entity);
      const current = merged.get(key);
      merged.set(
        key,
        current === undefined
          ? entity
          : (mergeEntity(current, entity) as SyncEntity),
      );
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
    for (const entity of entities) {
      if ("deleted" in entity) {
        if (entity.entityType === "paste_item") {
          await this.clipboard.removeSyncedItem(entity.id);
        } else {
          await this.pinboards.removeSynced(entity.id);
        }
        await this.putTombstone(entity);
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

  async writeBlob(blob: SyncBlob): Promise<void> {
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
