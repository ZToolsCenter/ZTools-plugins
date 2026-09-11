import { readFile } from "node:fs/promises";

import { describe, expect, it } from "vitest";

import {
  bytesToHex,
  decryptEnvelope,
  decryptEnvelopeBytes,
  deriveVaultKey,
  encryptBytes,
  encryptObjectForFixture,
  hexToBytes,
  vaultBytesRevision,
} from "../src/node-crypto";

type Fixture = {
  password: string;
  saltHex: string;
  nonceHex: string;
  derivedKeyHex: string;
  ciphertextAndTagHex: string;
  descriptor: {
    version: 1;
    objectType: "item";
    objectId: string;
    revision: string;
  };
  object: unknown;
};

const fixture = JSON.parse(
  await readFile(new URL("../fixtures/crypto-v1.json", import.meta.url), "utf8"),
) as Fixture;

describe("PasteboardPro v1 crypto fixture", () => {
  it("derives and encrypts the fixed bytes exactly", async () => {
    const key = await deriveVaultKey(
      fixture.password,
      hexToBytes(fixture.saltHex),
    );
    expect(bytesToHex(key)).toBe(fixture.derivedKeyHex);

    const envelope = encryptObjectForFixture(
      key,
      fixture.descriptor,
      fixture.object,
      hexToBytes(fixture.nonceHex),
    );
    expect(bytesToHex(Buffer.from(envelope.ciphertext, "base64"))).toBe(
      fixture.ciphertextAndTagHex,
    );
    await expect(decryptEnvelope(key, envelope)).resolves.toEqual(fixture.object);
  });

  it("rejects the wrong password and corrupted authentication tags", async () => {
    const key = await deriveVaultKey(
      fixture.password,
      hexToBytes(fixture.saltHex),
    );
    const wrongKey = await deriveVaultKey("wrong password", hexToBytes(fixture.saltHex));
    const envelope = encryptObjectForFixture(
      key,
      fixture.descriptor,
      fixture.object,
      hexToBytes(fixture.nonceHex),
    );

    await expect(decryptEnvelope(wrongKey, envelope)).rejects.toThrow();
    const bytes = Buffer.from(envelope.ciphertext, "base64");
    bytes[bytes.length - 1] = bytes[bytes.length - 1]! ^ 0xff;
    await expect(
      decryptEnvelope(key, { ...envelope, ciphertext: bytes.toString("base64") }),
    ).rejects.toThrow();
  });

  it("round-trips opaque blob bytes without JSON conversion", async () => {
    const key = new Uint8Array(32).fill(9);
    const bytes = new Uint8Array([0, 255, 1, 2, 3, 0]);
    const descriptor = {
      version: 1 as const,
      objectType: "blob" as const,
      objectId: "blob-test",
      revision: vaultBytesRevision(key, bytes),
    };
    const envelope = encryptBytes(key, descriptor, bytes);

    await expect(decryptEnvelopeBytes(key, envelope)).resolves.toEqual(bytes);
    await expect(decryptEnvelope(key, envelope)).rejects.toThrow();
  });
});
