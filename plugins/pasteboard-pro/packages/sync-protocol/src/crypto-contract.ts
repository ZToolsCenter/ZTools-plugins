export const VAULT_VERSION = 1 as const;

export const VAULT_OBJECT_TYPES = [
  "item",
  "pinboard",
  "tombstone",
  "index",
  "blob",
] as const;

export type VaultObjectType = (typeof VAULT_OBJECT_TYPES)[number];

export type VaultObjectDescriptor = {
  version: typeof VAULT_VERSION;
  objectType: VaultObjectType;
  objectId: string;
  revision: string;
};

export type VaultObjectEnvelope = VaultObjectDescriptor & {
  nonce: string;
  ciphertext: string;
};

export const VAULT_KDF = {
  name: "scrypt",
  N: 32_768,
  r: 8,
  p: 1,
  keyLength: 32,
} as const;

export const VAULT_CIPHER = {
  name: "AES-256-GCM",
  nonceLength: 12,
  tagLength: 16,
} as const;
