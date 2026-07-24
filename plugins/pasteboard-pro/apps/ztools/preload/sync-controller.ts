import type { KeychainSecretStore } from "./keychain";
import { createWebDavVaultClient, type WebDavVaultClient } from "./sync";
import { syncZToolsVault, type SyncEntityRepository } from "./sync-runtime";
import { type SyncSettings, ZToolsSyncStore } from "./sync-store";

export type SyncControllerOptions = Readonly<{
  store: ZToolsSyncStore;
  keychain: KeychainSecretStore;
  repository: SyncEntityRepository;
  clientFactory?: (
    settings: SyncSettings,
    password: string,
  ) => WebDavVaultClient;
  now?: () => number;
}>;

export async function runConfiguredVaultSync(
  options: SyncControllerOptions,
): Promise<SyncSettings> {
  const settings = await options.store.getSettings();
  if (!settings.enabled) return settings;

  const syncing: SyncSettings = {
    ...settings,
    status: {
      state: "syncing",
      pendingObjects: (await options.store.listObjects()).length,
      ...(settings.status.lastSyncedAt === undefined
        ? {}
        : { lastSyncedAt: settings.status.lastSyncedAt }),
    },
  };
  await options.store.putSettings(syncing);

  try {
    const [webdavPassword, encodedKey] = await Promise.all([
      options.keychain.load(settings.webdavCredentialAccount),
      options.keychain.load(settings.vaultKeyAccount),
    ]);
    if (webdavPassword === undefined || encodedKey === undefined) {
      const missing: SyncSettings = {
        ...syncing,
        status: { ...syncing.status, state: "auth_required" },
      };
      await options.store.putSettings(missing);
      return missing;
    }
    const key = new Uint8Array(Buffer.from(encodedKey, "base64"));
    if (key.byteLength !== 32) {
      const invalid: SyncSettings = {
        ...syncing,
        status: { ...syncing.status, state: "wrong_password" },
      };
      await options.store.putSettings(invalid);
      return invalid;
    }
    const client =
      options.clientFactory?.(settings, webdavPassword) ??
      createWebDavVaultClient({
        baseUrl: settings.baseUrl,
        credentials: async () => ({
          username: settings.username,
          password: webdavPassword,
        }),
        queue: options.store,
      });
    const result = await syncZToolsVault({
      client,
      key,
      repository: options.repository,
    });
    const now = options.now ?? Date.now;
    const completed: SyncSettings = {
      ...syncing,
      status: {
        state: result.state,
        pendingObjects: result.pendingObjects,
        ...(result.state === "success"
          ? { lastSyncedAt: new Date(now()).toISOString() }
          : settings.status.lastSyncedAt === undefined
            ? {}
            : { lastSyncedAt: settings.status.lastSyncedAt }),
      },
    };
    await options.store.putSettings(completed);
    return completed;
  } catch {
    const failed: SyncSettings = {
      ...syncing,
      status: {
        state: "partial",
        pendingObjects: (await options.store.listObjects()).length,
        ...(settings.status.lastSyncedAt === undefined
          ? {}
          : { lastSyncedAt: settings.status.lastSyncedAt }),
      },
    };
    await options.store.putSettings(failed);
    return failed;
  }
}
