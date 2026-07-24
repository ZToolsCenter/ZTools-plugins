import { describe, expect, it } from "vitest";

import type { ZToolsDocumentDatabase } from "../preload/clipboard-store";
import type { KeychainSecretStore } from "../preload/keychain";
import type { WebDavVaultClient } from "../preload/sync";
import { runConfiguredVaultSync } from "../preload/sync-controller";
import type { SyncEntityRepository } from "../preload/sync-runtime";
import { defaultSyncSettings, ZToolsSyncStore } from "../preload/sync-store";

function stateDatabase(): ZToolsDocumentDatabase {
  let document: Record<string, unknown> | undefined;
  return {
    async get() { if (document === undefined) throw { status: 404 }; return structuredClone(document); },
    async put(next) { document = { ...structuredClone(next), _rev: "1-test" }; return { ok: true }; },
  };
}

const repository: SyncEntityRepository = {
  async listEntities() { return []; },
  async applyEntities() {},
  async readBlob() { return undefined; },
  async writeBlob() {},
};

describe("configured vault sync controller", () => {
  it("reports missing Keychain material without attempting network access", async () => {
    const store = new ZToolsSyncStore(stateDatabase());
    await store.putSettings({
      ...defaultSyncSettings,
      enabled: true,
      baseUrl: "https://dav.example.com/PasteboardPro/v1/",
      username: "alice",
      status: { state: "idle", pendingObjects: 0 },
    });
    const keychain: KeychainSecretStore = {
      async save() {}, async load() { return undefined; }, async delete() {},
    };

    await expect(
      runConfiguredVaultSync({ store, keychain, repository }),
    ).resolves.toMatchObject({ status: { state: "auth_required" } });
  });

  it("persists successful completion time from the real runtime result", async () => {
    const store = new ZToolsSyncStore(stateDatabase());
    await store.putSettings({
      ...defaultSyncSettings,
      enabled: true,
      baseUrl: "https://dav.example.com/PasteboardPro/v1/",
      username: "alice",
      status: { state: "idle", pendingObjects: 0 },
    });
    const keychain: KeychainSecretStore = {
      async save() {},
      async load(account) {
        return account === "webdav"
          ? "dav-secret"
          : Buffer.alloc(32, 1).toString("base64");
      },
      async delete() {},
    };
    const client: WebDavVaultClient = {
      async readFile() { return undefined; },
      async putFileIfAbsent() { return "created"; },
      async syncEncryptedVault() {
        return { state: "success", uploadedObjects: 0, pendingObjects: 0, retries: 0, failedObjectIds: [] };
      },
    };

    await expect(
      runConfiguredVaultSync({
        store,
        keychain,
        repository,
        clientFactory: () => client,
        now: () => Date.parse("2026-07-16T14:00:00Z"),
      }),
    ).resolves.toMatchObject({
      status: { state: "success", lastSyncedAt: "2026-07-16T14:00:00.000Z" },
    });
  });
});
