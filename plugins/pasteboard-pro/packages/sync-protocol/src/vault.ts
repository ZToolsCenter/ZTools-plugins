import {
  VAULT_CIPHER,
  VAULT_KDF,
  VAULT_VERSION,
  type VaultObjectDescriptor,
  type VaultObjectEnvelope,
  type VaultObjectType,
} from "./crypto-contract";
import { canonicalJson, objectPath, parseVaultObjectDescriptor } from "./wire";

export type VaultMetadata = Readonly<{
  version: typeof VAULT_VERSION;
  kdf: Readonly<{
    name: typeof VAULT_KDF.name;
    salt: string;
    N: typeof VAULT_KDF.N;
    r: typeof VAULT_KDF.r;
    p: typeof VAULT_KDF.p;
    keyLength: typeof VAULT_KDF.keyLength;
  }>;
  cipher: typeof VAULT_CIPHER;
}>;

export type VaultIndexEntry = Readonly<{
  objectType: Exclude<VaultObjectType, "index">;
  objectId: string;
  revision: string;
  path: string;
}>;

export type VaultIndex = Readonly<{
  version: typeof VAULT_VERSION;
  objects: readonly VaultIndexEntry[];
}>;

const METADATA_KEYS = new Set(["version", "kdf", "cipher"]);
const KDF_KEYS = new Set(["name", "salt", "N", "r", "p", "keyLength"]);
const CIPHER_KEYS = new Set(["name", "nonceLength", "tagLength"]);
const INDEX_KEYS = new Set(["version", "objects"]);
const INDEX_ENTRY_KEYS = new Set([
  "objectType",
  "objectId",
  "revision",
  "path",
]);
const BASE64_PATTERN = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/;

function record(value: unknown, label: string): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError(`${label} must be an object`);
  }
  return value as Record<string, unknown>;
}

function exactKeys(
  value: Record<string, unknown>,
  expected: ReadonlySet<string>,
  label: string,
): void {
  for (const key of Object.keys(value)) {
    if (!expected.has(key)) throw new TypeError(`Unknown ${label} field: ${key}`);
  }
  for (const key of expected) {
    if (!Object.prototype.hasOwnProperty.call(value, key)) {
      throw new TypeError(`${label} is missing ${key}`);
    }
  }
}

function base64ByteLength(value: string): number {
  const padding = value.endsWith("==") ? 2 : value.endsWith("=") ? 1 : 0;
  return (value.length / 4) * 3 - padding;
}

function canonicalBase64(value: unknown, label: string, minimumBytes: number): string {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length % 4 !== 0 ||
    !BASE64_PATTERN.test(value) ||
    base64ByteLength(value) < minimumBytes
  ) {
    throw new TypeError(`${label} must be canonical base64 with at least ${minimumBytes} bytes`);
  }
  return value;
}

export function createVaultMetadata(salt: Uint8Array): VaultMetadata {
  if (salt.byteLength < 16) {
    throw new RangeError("Vault salt must contain at least 16 bytes");
  }
  return {
    version: VAULT_VERSION,
    kdf: {
      name: VAULT_KDF.name,
      salt: bytesToBase64(salt),
      N: VAULT_KDF.N,
      r: VAULT_KDF.r,
      p: VAULT_KDF.p,
      keyLength: VAULT_KDF.keyLength,
    },
    cipher: { ...VAULT_CIPHER },
  };
}

export function parseVaultMetadata(value: unknown): VaultMetadata {
  const input = record(value, "Vault metadata");
  exactKeys(input, METADATA_KEYS, "vault metadata");
  if (input.version !== VAULT_VERSION) {
    throw new RangeError(`Unsupported vault metadata version: ${String(input.version)}`);
  }
  const kdf = record(input.kdf, "Vault KDF");
  exactKeys(kdf, KDF_KEYS, "vault KDF");
  if (
    kdf.name !== VAULT_KDF.name ||
    kdf.N !== VAULT_KDF.N ||
    kdf.r !== VAULT_KDF.r ||
    kdf.p !== VAULT_KDF.p ||
    kdf.keyLength !== VAULT_KDF.keyLength
  ) {
    throw new RangeError("Vault KDF parameters are unsupported");
  }
  const cipher = record(input.cipher, "Vault cipher");
  exactKeys(cipher, CIPHER_KEYS, "vault cipher");
  if (
    cipher.name !== VAULT_CIPHER.name ||
    cipher.nonceLength !== VAULT_CIPHER.nonceLength ||
    cipher.tagLength !== VAULT_CIPHER.tagLength
  ) {
    throw new RangeError("Vault cipher parameters are unsupported");
  }
  return {
    version: VAULT_VERSION,
    kdf: {
      name: VAULT_KDF.name,
      salt: canonicalBase64(kdf.salt, "Vault KDF salt", 16),
      N: VAULT_KDF.N,
      r: VAULT_KDF.r,
      p: VAULT_KDF.p,
      keyLength: VAULT_KDF.keyLength,
    },
    cipher: { ...VAULT_CIPHER },
  };
}

function parseIndexEntry(value: unknown): VaultIndexEntry {
  const input = record(value, "Vault index entry");
  exactKeys(input, INDEX_ENTRY_KEYS, "vault index entry");
  const descriptor = parseVaultObjectDescriptor({
    version: VAULT_VERSION,
    objectType: input.objectType,
    objectId: input.objectId,
    revision: input.revision,
  });
  if (descriptor.objectType === "index") {
    throw new TypeError("Vault index cannot reference another index object");
  }
  const expectedPath = objectPath(descriptor);
  if (input.path !== expectedPath) {
    throw new TypeError("Vault index entry path does not match its descriptor");
  }
  return {
    objectType: descriptor.objectType,
    objectId: descriptor.objectId,
    revision: descriptor.revision,
    path: expectedPath,
  };
}

function compareEntry(left: VaultIndexEntry, right: VaultIndexEntry): number {
  return (
    left.objectType.localeCompare(right.objectType) ||
    left.objectId.localeCompare(right.objectId) ||
    left.revision.localeCompare(right.revision)
  );
}

export function parseVaultIndex(value: unknown): VaultIndex {
  const input = record(value, "Vault index");
  exactKeys(input, INDEX_KEYS, "vault index");
  if (input.version !== VAULT_VERSION) {
    throw new RangeError(`Unsupported vault index version: ${String(input.version)}`);
  }
  if (!Array.isArray(input.objects)) {
    throw new TypeError("Vault index objects must be an array");
  }
  const objects = input.objects.map(parseIndexEntry).sort(compareEntry);
  const identities = new Set<string>();
  for (const entry of objects) {
    const identity = `${entry.objectType}\0${entry.objectId}`;
    if (identities.has(identity)) {
      throw new RangeError("Vault index contains duplicate object identities");
    }
    identities.add(identity);
  }
  return { version: VAULT_VERSION, objects };
}

export function canonicalVaultMetadata(metadata: VaultMetadata): string {
  return canonicalJson(parseVaultMetadata(metadata));
}

export function canonicalVaultIndex(index: VaultIndex): string {
  return canonicalJson(parseVaultIndex(index));
}

export function bytesToBase64(value: Uint8Array): string {
  let binary = "";
  for (const byte of value) binary += String.fromCharCode(byte);
  return btoa(binary);
}

export function base64ToBytes(value: string): Uint8Array {
  const canonical = canonicalBase64(value, "Base64 value", 1);
  const binary = atob(canonical);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

export type VaultObjectCipher = {
  encryptObject(descriptor: VaultObjectDescriptor, value: unknown): VaultObjectEnvelope;
  decryptEnvelope(envelope: VaultObjectEnvelope): Promise<unknown>;
};

export function envelopeDescriptor(
  envelope: VaultObjectEnvelope,
): VaultObjectDescriptor {
  return {
    version: envelope.version,
    objectType: envelope.objectType,
    objectId: envelope.objectId,
    revision: envelope.revision,
  };
}
