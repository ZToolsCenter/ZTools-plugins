import { describe, expect, it } from "vitest";

import type { ZToolsDocumentDatabase } from "../preload/clipboard-store";
import type { KeychainSecretStore } from "../preload/keychain";
import { saveSyncConfiguration } from "../preload/sync-config";
import type { WebDavVaultClient } from "../preload/sync";
import {
  canonicalJson,
  canonicalVaultIndex,
  createVaultMetadata,
} from "@pasteboard-pro/sync-protocol";
import {
  deriveVaultKey,
  encryptObject,
} from "@pasteboard-pro/sync-protocol/node-crypto";
import { ZToolsSyncStore } from "../preload/sync-store";

describe("sync configuration", () => {
  it("derives the vault key and persists both secrets only in Keychain", async () => {
    let document: Record<string, unknown> | undefined;
    const secrets = new Map<string, string>();
    const database: ZToolsDocumentDatabase = {
      async get() {
        if (document === undefined) throw { status: 404 };
        return structuredClone(document);
      },
      async put(next) {
        document = { ...structuredClone(next), _rev: "1-test" };
        return { ok: true };
      },
    };
    const keychain: KeychainSecretStore = {
      async save(account, secret) { secrets.set(account, secret); },
      async load(account) { return secrets.get(account); },
      async delete(account) { secrets.delete(account); },
    };
    const settings = await saveSyncConfiguration(
      new ZToolsSyncStore(database),
      keychain,
      {
        enabled: true,
        baseUrl: "https://dav.example.com/PasteboardPro/v1/",
        username: "alice",
        webdavPassword: "dav-secret",
        syncPassword: "sync-secret",
        syncFileContents: false,
      },
      {
        randomBytes: () => new Uint8Array(16).fill(7),
        clientFactory: () =>
          ({
            async readFile() { return undefined; },
            async putFileIfAbsent() { return "created"; },
            async syncEncryptedVault() { throw new Error("not used"); },
          }) satisfies WebDavVaultClient,
      },
    );

    expect(secrets.get("webdav")).toBe("dav-secret");
    expect(Buffer.from(secrets.get("vault-key")!, "base64")).toHaveLength(32);
    expect(settings.vaultSaltHex).toBe("07070707070707070707070707070707");
    expect(JSON.stringify(document)).not.toMatch(/dav-secret|sync-secret/);
  });

  it("uses the existing remote vault salt instead of creating a device-local salt", async () => {
    let document: Record<string, unknown> | undefined;
    const secrets = new Map<string, string>();
    const database: ZToolsDocumentDatabase = {
      async get() { if (document === undefined) throw { status: 404 }; return document; },
      async put(next) { document = next; return { ok: true }; },
    };
    const keychain: KeychainSecretStore = {
      async save(account, secret) { secrets.set(account, secret); },
      async load(account) { return secrets.get(account); },
      async delete(account) { secrets.delete(account); },
    };
    const remoteMetadata = new TextEncoder().encode(
      JSON.stringify({
        version: 1,
        kdf: { name: "scrypt", salt: "CQkJCQkJCQkJCQkJCQkJCQ==", N: 32768, r: 8, p: 1, keyLength: 32 },
        cipher: { name: "AES-256-GCM", nonceLength: 12, tagLength: 16 },
      }),
    );
    const client: WebDavVaultClient = {
      async readFile(path) {
        return path === "vault.json" ? { body: remoteMetadata } : undefined;
      },
      async putFileIfAbsent() { throw new Error("must not create"); },
      async syncEncryptedVault() { throw new Error("not used"); },
    };

    const settings = await saveSyncConfiguration(
      new ZToolsSyncStore(database),
      keychain,
      {
        enabled: true,
        baseUrl: "https://dav.example.com/PasteboardPro/v1/",
        username: "alice",
        webdavPassword: "dav-secret",
        syncPassword: "sync-secret",
        syncFileContents: false,
      },
      { clientFactory: () => client },
    );
    expect(settings.vaultSaltHex).toBe("09090909090909090909090909090909");
  });

  it("keeps the previous Keychain key when a candidate password cannot decrypt the remote index", async () => {
    const db = stateDatabaseForConfig();
    const salt = new Uint8Array(16).fill(3);
    const metadata = createVaultMetadata(salt);
    const oldKey = await deriveVaultKey("correct password", salt);
    const index = JSON.parse(canonicalVaultIndex({ version: 1, objects: [] })) as unknown;
    const envelope = encryptObject(
      oldKey,
      { version: 1, objectType: "index", objectId: "main", revision: "r-existing" },
      index,
    );
    const files = new Map([
      ["vault.json", new TextEncoder().encode(JSON.stringify(metadata))],
      ["index.enc", new TextEncoder().encode(canonicalJson(envelope))],
    ]);
    const secrets = new Map([
      ["webdav", "old-dav-secret"],
      ["vault-key", Buffer.from(oldKey).toString("base64")],
    ]);
    const keychain: KeychainSecretStore = {
      async save(account, secret) { secrets.set(account, secret); },
      async load(account) { return secrets.get(account); },
      async delete(account) { secrets.delete(account); },
    };
    const client: WebDavVaultClient = {
      async readFile(path) {
        const body = files.get(path);
        return body === undefined ? undefined : { body };
      },
      async putFileIfAbsent() { return "exists"; },
      async syncEncryptedVault() { throw new Error("not used"); },
    };
    const previousKey = secrets.get("vault-key");

    await expect(
      saveSyncConfiguration(
        new ZToolsSyncStore(db),
        keychain,
        {
          enabled: true,
          baseUrl: "https://dav.example.com/PasteboardPro/v1/",
          username: "alice",
          webdavPassword: "new-dav-secret",
          syncPassword: "wrong password",
          syncFileContents: false,
        },
        { clientFactory: () => client },
      ),
    ).rejects.toThrow(/未被替换/);
    expect(secrets.get("vault-key")).toBe(previousKey);
    expect(secrets.get("webdav")).toBe("old-dav-secret");
  });
});

function stateDatabaseForConfig(): ZToolsDocumentDatabase {
  let document: Record<string, unknown> | undefined;
  return {
    async get() { if (document === undefined) throw { status: 404 }; return document; },
    async put(next) { document = next; return { ok: true }; },
  };
}
