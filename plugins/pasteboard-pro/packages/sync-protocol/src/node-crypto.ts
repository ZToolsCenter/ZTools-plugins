import {
  createCipheriv,
  createDecipheriv,
  createHmac,
  randomBytes,
  scrypt as scryptCallback,
} from "node:crypto";

import {
  VAULT_CIPHER,
  VAULT_KDF,
  type VaultObjectDescriptor,
  type VaultObjectEnvelope,
} from "./crypto-contract";
import { canonicalJson, objectAad, parseVaultEnvelope } from "./wire";

function asBuffer(value: Uint8Array): Buffer {
  return Buffer.from(value.buffer, value.byteOffset, value.byteLength);
}

function assertKey(key: Uint8Array): Buffer {
  if (key.byteLength !== VAULT_KDF.keyLength) {
    throw new RangeError(`Vault key must be ${VAULT_KDF.keyLength} bytes`);
  }
  return asBuffer(key);
}

function assertNonce(nonce: Uint8Array): Buffer {
  if (nonce.byteLength !== VAULT_CIPHER.nonceLength) {
    throw new RangeError(`AES-GCM nonce must be ${VAULT_CIPHER.nonceLength} bytes`);
  }
  return asBuffer(nonce);
}

export async function deriveVaultKey(
  password: string,
  salt: Uint8Array,
): Promise<Uint8Array> {
  if (password.length === 0) {
    throw new TypeError("Sync password cannot be empty");
  }
  if (salt.byteLength < 16) {
    throw new RangeError("Vault salt must be at least 16 bytes");
  }
  const key = await new Promise<Buffer>((resolve, reject) => {
    scryptCallback(password, asBuffer(salt), VAULT_KDF.keyLength, {
      N: VAULT_KDF.N,
      r: VAULT_KDF.r,
      p: VAULT_KDF.p,
      maxmem: 64 * 1024 * 1024,
    }, (error, derivedKey) => {
      if (error) {
        reject(error);
        return;
      }
      resolve(derivedKey);
    });
  });
  return new Uint8Array(key);
}

function encryptWithNonce(
  key: Uint8Array,
  descriptor: VaultObjectDescriptor,
  value: unknown,
  nonce: Uint8Array,
): VaultObjectEnvelope {
  return encryptBytesWithNonce(
    key,
    descriptor,
    new TextEncoder().encode(canonicalJson(value)),
    nonce,
  );
}

function encryptBytesWithNonce(
  key: Uint8Array,
  descriptor: VaultObjectDescriptor,
  value: Uint8Array,
  nonce: Uint8Array,
): VaultObjectEnvelope {
  const nonceBuffer = assertNonce(nonce);
  const cipher = createCipheriv("aes-256-gcm", assertKey(key), nonceBuffer, {
    authTagLength: VAULT_CIPHER.tagLength,
  });
  cipher.setAAD(asBuffer(objectAad(descriptor)));
  const ciphertext = Buffer.concat([
    cipher.update(asBuffer(value)),
    cipher.final(),
    cipher.getAuthTag(),
  ]);

  return {
    ...descriptor,
    nonce: nonceBuffer.toString("base64"),
    ciphertext: ciphertext.toString("base64"),
  };
}

export function encryptObject(
  key: Uint8Array,
  descriptor: VaultObjectDescriptor,
  value: unknown,
): VaultObjectEnvelope {
  return encryptWithNonce(key, descriptor, value, randomBytes(VAULT_CIPHER.nonceLength));
}

export function encryptBytes(
  key: Uint8Array,
  descriptor: VaultObjectDescriptor,
  value: Uint8Array,
): VaultObjectEnvelope {
  return encryptBytesWithNonce(
    key,
    descriptor,
    value,
    randomBytes(VAULT_CIPHER.nonceLength),
  );
}

export function encryptObjectForFixture(
  key: Uint8Array,
  descriptor: VaultObjectDescriptor,
  value: unknown,
  nonce: Uint8Array,
): VaultObjectEnvelope {
  return encryptWithNonce(key, descriptor, value, nonce);
}

export async function decryptEnvelope(
  key: Uint8Array,
  envelopeValue: unknown,
): Promise<unknown> {
  const plaintext = await decryptEnvelopeBytes(key, envelopeValue);
  return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(plaintext)) as unknown;
}

export async function decryptEnvelopeBytes(
  key: Uint8Array,
  envelopeValue: unknown,
): Promise<Uint8Array> {
  const envelope = parseVaultEnvelope(envelopeValue);
  const nonce = Buffer.from(envelope.nonce, "base64");
  if (nonce.byteLength !== VAULT_CIPHER.nonceLength) {
    throw new RangeError(`AES-GCM nonce must be ${VAULT_CIPHER.nonceLength} bytes`);
  }
  const encrypted = Buffer.from(envelope.ciphertext, "base64");
  if (encrypted.byteLength < VAULT_CIPHER.tagLength) {
    throw new RangeError("AES-GCM ciphertext is missing its authentication tag");
  }
  const tagOffset = encrypted.byteLength - VAULT_CIPHER.tagLength;
  const decipher = createDecipheriv("aes-256-gcm", assertKey(key), nonce, {
    authTagLength: VAULT_CIPHER.tagLength,
  });
  decipher.setAAD(asBuffer(objectAad(envelope)));
  decipher.setAuthTag(encrypted.subarray(tagOffset));
  const plaintext = Buffer.concat([
    decipher.update(encrypted.subarray(0, tagOffset)),
    decipher.final(),
  ]);
  return new Uint8Array(plaintext);
}

export function bytesToHex(value: Uint8Array): string {
  return asBuffer(value).toString("hex");
}

export function hexToBytes(value: string): Uint8Array {
  if (value.length === 0 || value.length % 2 !== 0 || !/^[0-9a-f]+$/i.test(value)) {
    throw new TypeError("Hex input must contain complete hexadecimal bytes");
  }
  return new Uint8Array(Buffer.from(value, "hex"));
}

export function vaultRevision(key: Uint8Array, value: unknown): string {
  return vaultBytesRevision(key, new TextEncoder().encode(canonicalJson(value)));
}

export function vaultBytesRevision(key: Uint8Array, value: Uint8Array): string {
  return `r-${createHmac("sha256", assertKey(key))
    .update(asBuffer(value))
    .digest("hex")}`;
}
