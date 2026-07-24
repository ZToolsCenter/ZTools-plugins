import {
  PasteItemSchema,
  PinboardSchema,
  type PasteItem,
  type Pinboard,
} from "@pasteboard-pro/core";
import {
  canonicalJson,
  canonicalVaultIndex,
  mergeEntity,
  objectPath,
  parseVaultEnvelope,
  parseVaultIndex,
  type Tombstone,
  type VaultIndexEntry,
  type VaultObjectDescriptor,
} from "@pasteboard-pro/sync-protocol";
import {
  decryptEnvelopeBytes,
  decryptEnvelope,
  encryptBytes,
  encryptObject,
  vaultBytesRevision,
  vaultRevision,
} from "@pasteboard-pro/sync-protocol/node-crypto";

import {
  VaultSyncError,
  type EncryptedSyncObject,
  type WebDavSyncResult,
  type WebDavVaultClient,
} from "./sync";

export type SyncEntity = PasteItem | Pinboard | Tombstone;

export type SyncBlob = Readonly<{
  id: string;
  mediaType: string;
  bytes: Uint8Array;
}>;

export interface SyncEntityRepository {
  listEntities(): Promise<SyncEntity[]>;
  applyEntities(entities: readonly SyncEntity[]): Promise<void>;
  readBlob(blobId: string): Promise<SyncBlob | undefined>;
  writeBlob(blob: SyncBlob): Promise<void>;
}

export type ZToolsVaultRuntimeOptions = Readonly<{
  client: WebDavVaultClient;
  key: Uint8Array;
  repository: SyncEntityRepository;
}>;

const encoder = new TextEncoder();
const decoder = new TextDecoder("utf-8", { fatal: true });
const MAX_BLOB_BYTES = 100 * 1_024 * 1_024;
const MAX_OBJECT_BYTES = 140 * 1_024 * 1_024;

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isTombstone(entity: SyncEntity): entity is Tombstone {
  return "deleted" in entity && entity.deleted === true;
}

function tombstone(value: unknown): Tombstone {
  if (
    !isRecord(value) ||
    typeof value.id !== "string" ||
    (value.entityType !== "paste_item" && value.entityType !== "pinboard") ||
    value.deleted !== true ||
    typeof value.deletedAt !== "string" ||
    !Number.isFinite(Date.parse(value.deletedAt)) ||
    typeof value.sourceDeviceId !== "string" ||
    !isRecord(value.clock) ||
    !Number.isSafeInteger(value.clock.wallMs) ||
    !Number.isSafeInteger(value.clock.counter) ||
    Number(value.clock.counter) < 0 ||
    typeof value.clock.deviceId !== "string"
  ) {
    throw new TypeError("Invalid sync tombstone");
  }
  return structuredClone(value) as Tombstone;
}

function entityType(entity: SyncEntity): "item" | "pinboard" | "tombstone" {
  if (isTombstone(entity)) return "tombstone";
  return "kind" in entity ? "item" : "pinboard";
}

function entityObjectId(entity: SyncEntity): string {
  return isTombstone(entity) ? `${entity.entityType}:${entity.id}` : entity.id;
}

function entityIdentity(entity: SyncEntity): string {
  if (isTombstone(entity)) return `${entity.entityType}\0${entity.id}`;
  return `${"kind" in entity ? "paste_item" : "pinboard"}\0${entity.id}`;
}

function parseEntity(value: unknown, entry: VaultIndexEntry): SyncEntity {
  if (entry.objectType === "item") return PasteItemSchema.parse(value);
  if (entry.objectType === "pinboard") return PinboardSchema.parse(value);
  if (entry.objectType === "tombstone") return tombstone(value);
  throw new TypeError("Blob entries are not sync entities");
}

function descriptor(entity: SyncEntity, key: Uint8Array): VaultObjectDescriptor {
  return {
    version: 1,
    objectType: entityType(entity),
    objectId: entityObjectId(entity),
    revision: vaultRevision(key, entity),
  };
}

function encryptedEntity(entity: SyncEntity, key: Uint8Array): EncryptedSyncObject {
  const objectDescriptor = descriptor(entity, key);
  const envelope = encryptObject(key, objectDescriptor, entity);
  return {
    id: entity.id,
    path: objectPath(objectDescriptor),
    body: encoder.encode(canonicalJson(envelope)),
  };
}

function blobDescriptor(blob: SyncBlob, key: Uint8Array): VaultObjectDescriptor {
  if (blob.bytes.byteLength > MAX_BLOB_BYTES) {
    throw new RangeError(`Blob ${blob.id} exceeds 100 MiB`);
  }
  return {
    version: 1,
    objectType: "blob",
    objectId: blob.id,
    revision: vaultBytesRevision(key, blob.bytes),
  };
}

function encryptedBlob(blob: SyncBlob, key: Uint8Array): EncryptedSyncObject {
  const descriptor = blobDescriptor(blob, key);
  return {
    id: blob.id,
    path: objectPath(descriptor),
    body: encoder.encode(canonicalJson(encryptBytes(key, descriptor, blob.bytes))),
  };
}

async function remoteBlob(
  client: WebDavVaultClient,
  key: Uint8Array,
  entry: VaultIndexEntry,
  mediaType: string,
): Promise<SyncBlob> {
  const remote = await client.readFile(entry.path);
  if (remote === undefined) {
    throw new VaultSyncError("corrupted", `Remote blob is missing: ${entry.path}`);
  }
  if (remote.body.byteLength > MAX_OBJECT_BYTES) {
    throw new VaultSyncError("corrupted", `Remote blob is too large: ${entry.path}`);
  }
  let envelope;
  try {
    envelope = parseVaultEnvelope(JSON.parse(decoder.decode(remote.body)) as unknown);
  } catch (error) {
    throw new VaultSyncError("corrupted", `Remote blob envelope is invalid: ${entry.path}`, { cause: error });
  }
  if (
    envelope.objectType !== "blob" ||
    envelope.objectId !== entry.objectId ||
    envelope.revision !== entry.revision
  ) {
    throw new VaultSyncError("corrupted", `Remote blob descriptor mismatch: ${entry.path}`);
  }
  let bytes: Uint8Array;
  try {
    bytes = await decryptEnvelopeBytes(key, envelope);
  } catch (error) {
    throw new VaultSyncError("corrupted", `Remote blob authentication failed: ${entry.path}`, { cause: error });
  }
  if (bytes.byteLength > MAX_BLOB_BYTES || vaultBytesRevision(key, bytes) !== entry.revision) {
    throw new VaultSyncError("corrupted", `Remote blob revision is invalid: ${entry.path}`);
  }
  return { id: entry.objectId, mediaType, bytes };
}

function referencedBlobMedia(entities: readonly SyncEntity[]): Map<string, string> {
  return new Map(
    entities.flatMap((entity) =>
      !isTombstone(entity) && "kind" in entity && entity.payload.blobId !== undefined
        ? [[entity.payload.blobId, entity.payload.mediaType ?? "application/octet-stream"] as const]
        : [],
    ),
  );
}

async function remoteEntities(
  client: WebDavVaultClient,
  key: Uint8Array,
  indexEntries: readonly VaultIndexEntry[],
): Promise<{ entities: SyncEntity[]; blobs: VaultIndexEntry[] }> {
  const entities: SyncEntity[] = [];
  const blobs: VaultIndexEntry[] = [];
  for (const entry of indexEntries) {
    if (entry.objectType === "blob") {
      blobs.push(entry);
      continue;
    }
    const remote = await client.readFile(entry.path);
    if (remote === undefined) {
      throw new VaultSyncError("corrupted", `Remote object is missing: ${entry.path}`);
    }
    if (remote.body.byteLength > MAX_OBJECT_BYTES) {
      throw new VaultSyncError("corrupted", `Remote object is too large: ${entry.path}`);
    }
    let envelope;
    try {
      envelope = parseVaultEnvelope(JSON.parse(decoder.decode(remote.body)) as unknown);
    } catch (error) {
      if (error instanceof RangeError && /version/i.test(error.message)) {
        throw new VaultSyncError("schema_too_new", `Remote object uses a newer schema: ${entry.path}`, { cause: error });
      }
      throw new VaultSyncError("corrupted", `Remote object envelope is invalid: ${entry.path}`, { cause: error });
    }
    if (
      envelope.objectType !== entry.objectType ||
      envelope.objectId !== entry.objectId ||
      envelope.revision !== entry.revision
    ) {
      throw new VaultSyncError("corrupted", `Remote object descriptor mismatch: ${entry.path}`);
    }
    try {
      entities.push(parseEntity(await decryptEnvelope(key, envelope), entry));
    } catch (error) {
      throw new VaultSyncError("corrupted", `Remote object authentication failed: ${entry.path}`, { cause: error });
    }
  }
  return { entities, blobs };
}

function mergeEntities(
  local: readonly SyncEntity[],
  remote: readonly SyncEntity[],
): SyncEntity[] {
  const merged = new Map<string, SyncEntity>();
  for (const entity of local) merged.set(entityIdentity(entity), structuredClone(entity));
  for (const entity of remote) {
    const identity = entityIdentity(entity);
    const current = merged.get(identity);
    merged.set(
      identity,
      current === undefined
        ? structuredClone(entity)
        : (mergeEntity(current, entity) as SyncEntity),
    );
  }
  return [...merged.values()];
}

function indexEntry(entity: SyncEntity, key: Uint8Array): VaultIndexEntry {
  const value = descriptor(entity, key);
  return {
    objectType: value.objectType as "item" | "pinboard" | "tombstone",
    objectId: value.objectId,
    revision: value.revision,
    path: objectPath(value),
  };
}

export async function syncZToolsVault(
  options: ZToolsVaultRuntimeOptions,
): Promise<WebDavSyncResult> {
  const initialEntities = await options.repository.listEntities();
  const initialObjects = initialEntities.map((entity) => encryptedEntity(entity, options.key));

  return await options.client.syncEncryptedVault({
    objects: initialObjects,
    async buildIndex(remoteBytes) {
      let entries: readonly VaultIndexEntry[] = [];
      if (remoteBytes !== undefined) {
        if (remoteBytes.byteLength > 16 * 1_024 * 1_024) {
          throw new VaultSyncError("corrupted", "Remote index exceeds 16 MiB");
        }
        let envelope;
        try {
          envelope = parseVaultEnvelope(JSON.parse(decoder.decode(remoteBytes)) as unknown);
          if (envelope.objectType !== "index" || envelope.objectId !== "main") {
            throw new TypeError("Remote index envelope descriptor is invalid");
          }
        } catch (error) {
          if (error instanceof RangeError && /version/i.test(error.message)) {
            throw new VaultSyncError("schema_too_new", "Remote index envelope uses a newer schema", { cause: error });
          }
          throw new VaultSyncError("corrupted", "Remote index envelope is invalid", { cause: error });
        }
        try {
          entries = parseVaultIndex(await decryptEnvelope(options.key, envelope)).objects;
        } catch (error) {
          if (error instanceof RangeError && /version/i.test(error.message)) {
            throw new VaultSyncError("schema_too_new", "Remote index uses a newer schema", { cause: error });
          }
          throw new VaultSyncError("wrong_password", "Remote index cannot be decrypted", { cause: error });
        }
      }

      const remote = await remoteEntities(options.client, options.key, entries);
      const local = await options.repository.listEntities();
      const merged = mergeEntities(local, remote.entities);
      await options.repository.applyEntities(merged);

      for (const entity of merged) {
        const encrypted = encryptedEntity(entity, options.key);
        await options.client.putFileIfAbsent(encrypted.path, encrypted.body);
      }
      const remoteBlobs = new Map(
        remote.blobs.map((entry) => [entry.objectId, entry] as const),
      );
      const blobEntries = new Map(
        remote.blobs.map((entry) => [entry.objectId, entry] as const),
      );
      for (const [blobId, mediaType] of referencedBlobMedia(merged)) {
        let blob = await options.repository.readBlob(blobId);
        if (blob === undefined) {
          const entry = remoteBlobs.get(blobId);
          if (entry === undefined) {
            throw new VaultSyncError(
              "corrupted",
              `Clipboard item references a missing blob: ${blobId}`,
            );
          }
          blob = await remoteBlob(options.client, options.key, entry, mediaType);
          await options.repository.writeBlob(blob);
        }
        const encrypted = encryptedBlob(blob, options.key);
        const descriptor = blobDescriptor(blob, options.key);
        const remoteEntry = remoteBlobs.get(blobId);
        if (
          remoteEntry !== undefined &&
          remoteEntry.revision !== descriptor.revision
        ) {
          throw new VaultSyncError(
            "corrupted",
            `Blob ${blobId} has conflicting immutable revisions`,
          );
        }
        await options.client.putFileIfAbsent(encrypted.path, encrypted.body);
        blobEntries.set(blobId, {
          objectType: "blob",
          objectId: descriptor.objectId,
          revision: descriptor.revision,
          path: encrypted.path,
        });
      }
      const index = {
        version: 1 as const,
        objects: [
          ...merged.map((entity) => indexEntry(entity, options.key)),
          ...blobEntries.values(),
        ],
      };
      const canonicalIndex = JSON.parse(canonicalVaultIndex(index)) as unknown;
      const indexDescriptor: VaultObjectDescriptor = {
        version: 1,
        objectType: "index",
        objectId: "main",
        revision: vaultRevision(options.key, canonicalIndex),
      };
      return encoder.encode(
        canonicalJson(encryptObject(options.key, indexDescriptor, canonicalIndex)),
      );
    },
  });
}
