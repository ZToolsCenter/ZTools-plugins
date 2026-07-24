import type { ZToolsDocumentDatabase } from "./clipboard-store";
import type {
  EncryptedSyncObject,
  PendingEncryptedSyncObject,
  SyncQueue,
  WebDavSyncResult,
} from "./sync";

export type SyncStatus = Readonly<{
  state:
    | "disabled"
    | "idle"
    | "syncing"
    | WebDavSyncResult["state"]
    | "wrong_password"
    | "corrupted"
    | "schema_too_new";
  pendingObjects: number;
  lastSyncedAt?: string;
}>;

export type SyncSettings = Readonly<{
  enabled: boolean;
  baseUrl: string;
  username: string;
  webdavCredentialAccount: string;
  vaultKeyAccount: string;
  vaultSaltHex?: string;
  syncFileContents: boolean;
  status: SyncStatus;
}>;

export const WEBDAV_CREDENTIAL_ACCOUNT = "webdav";
export const VAULT_KEY_ACCOUNT = "vault-key";

export const defaultSyncSettings: SyncSettings = {
  enabled: false,
  baseUrl: "",
  username: "",
  webdavCredentialAccount: WEBDAV_CREDENTIAL_ACCOUNT,
  vaultKeyAccount: VAULT_KEY_ACCOUNT,
  syncFileContents: false,
  status: { state: "disabled", pendingObjects: 0 },
};

type StoredSyncDocument = Readonly<{
  _id: string;
  _rev?: string;
  type: "pasteboard-pro-sync-state";
  settings: SyncSettings;
  queue: PendingEncryptedSyncObject[];
  retryRequired: boolean;
}>;

const DOCUMENT_ID = "pasteboard-pro:settings:sync";

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function databaseStatus(error: unknown, status: number): boolean {
  return isRecord(error) && (error.status === status || error.statusCode === status);
}

function validBaseUrl(value: string): boolean {
  if (value.length === 0) return true;
  try {
    const url = new URL(value);
    return (
      url.protocol === "https:" &&
      url.username.length === 0 &&
      url.password.length === 0 &&
      url.search.length === 0 &&
      url.hash.length === 0
    );
  } catch {
    return false;
  }
}

function parsedSettings(value: unknown): SyncSettings | undefined {
  if (!isRecord(value) || !isRecord(value.status)) return undefined;
  const status = value.status;
  const states = new Set([
    "disabled",
    "idle",
    "syncing",
    "success",
    "offline",
    "auth_required",
    "partial",
    "conflict",
    "wrong_password",
    "corrupted",
    "schema_too_new",
  ]);
  if (
    typeof value.enabled !== "boolean" ||
    typeof value.baseUrl !== "string" ||
    !validBaseUrl(value.baseUrl) ||
    typeof value.username !== "string" ||
    value.webdavCredentialAccount !== WEBDAV_CREDENTIAL_ACCOUNT ||
    value.vaultKeyAccount !== VAULT_KEY_ACCOUNT ||
    typeof value.syncFileContents !== "boolean" ||
    typeof status.state !== "string" ||
    !states.has(status.state) ||
    !Number.isSafeInteger(status.pendingObjects) ||
    Number(status.pendingObjects) < 0
  ) {
    return undefined;
  }
  return {
    enabled: value.enabled,
    baseUrl: value.baseUrl,
    username: value.username,
    webdavCredentialAccount: value.webdavCredentialAccount,
    vaultKeyAccount: value.vaultKeyAccount,
    ...(typeof value.vaultSaltHex === "string" ? { vaultSaltHex: value.vaultSaltHex } : {}),
    syncFileContents: value.syncFileContents,
    status: {
      state: status.state as SyncStatus["state"],
      pendingObjects: Number(status.pendingObjects),
      ...(typeof status.lastSyncedAt === "string"
        ? { lastSyncedAt: status.lastSyncedAt }
        : {}),
    },
  };
}

function parsedQueue(value: unknown): PendingEncryptedSyncObject[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry) =>
    isRecord(entry) &&
    typeof entry.id === "string" &&
    typeof entry.path === "string" &&
    typeof entry.bodyBase64 === "string" &&
    typeof entry.queuedAt === "string"
      ? [
          {
            id: entry.id,
            path: entry.path,
            bodyBase64: entry.bodyBase64,
            queuedAt: entry.queuedAt,
          },
        ]
      : [],
  );
}

function parsedDocument(value: unknown): StoredSyncDocument | undefined {
  if (!isRecord(value) || value.type !== "pasteboard-pro-sync-state") return undefined;
  const settings = parsedSettings(value.settings);
  if (settings === undefined) return undefined;
  return {
    _id: DOCUMENT_ID,
    ...(typeof value._rev === "string" ? { _rev: value._rev } : {}),
    type: "pasteboard-pro-sync-state",
    settings,
    queue: parsedQueue(value.queue),
    retryRequired: value.retryRequired === true,
  };
}

function emptyDocument(): StoredSyncDocument {
  return {
    _id: DOCUMENT_ID,
    type: "pasteboard-pro-sync-state",
    settings: structuredClone(defaultSyncSettings),
    queue: [],
    retryRequired: false,
  };
}

export class ZToolsSyncStore implements SyncQueue {
  constructor(private readonly database: ZToolsDocumentDatabase) {}

  private async read(): Promise<StoredSyncDocument> {
    try {
      return parsedDocument(await this.database.get(DOCUMENT_ID)) ?? emptyDocument();
    } catch (error) {
      if (databaseStatus(error, 404)) return emptyDocument();
      throw error;
    }
  }

  private async update(
    transform: (current: StoredSyncDocument) => StoredSyncDocument,
  ): Promise<void> {
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const current = await this.read();
      const next = transform(current);
      try {
        await this.database.put(structuredClone(next) as unknown as Record<string, unknown>);
        return;
      } catch (error) {
        if (!databaseStatus(error, 409) || attempt === 2) throw error;
      }
    }
  }

  async getSettings(): Promise<SyncSettings> {
    return structuredClone((await this.read()).settings);
  }

  async putSettings(settings: SyncSettings): Promise<void> {
    if (settings.enabled && !validBaseUrl(settings.baseUrl)) {
      throw new TypeError("Enabled sync requires a credential-free HTTPS WebDAV URL");
    }
    await this.update((current) => ({
      ...current,
      settings: structuredClone(settings),
    }));
  }

  async enqueueObjects(objects: readonly EncryptedSyncObject[]): Promise<void> {
    await this.update((current) => {
      const queue = new Map(current.queue.map((object) => [object.path, object]));
      for (const object of objects) {
        queue.set(object.path, {
          id: object.id,
          path: object.path,
          bodyBase64: Buffer.from(object.body).toString("base64"),
          queuedAt: new Date().toISOString(),
        });
      }
      return { ...current, queue: [...queue.values()] };
    });
  }

  async listObjects(): Promise<PendingEncryptedSyncObject[]> {
    return structuredClone((await this.read()).queue);
  }

  async removeObjects(paths: readonly string[]): Promise<void> {
    const removed = new Set(paths);
    await this.update((current) => ({
      ...current,
      queue: current.queue.filter((object) => !removed.has(object.path)),
    }));
  }

  async setRetryRequired(required: boolean): Promise<void> {
    await this.update((current) => ({ ...current, retryRequired: required }));
  }

  async isRetryRequired(): Promise<boolean> {
    return (await this.read()).retryRequired;
  }
}
