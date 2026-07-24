import { randomBytes as nodeRandomBytes } from "node:crypto";

import {
  base64ToBytes,
  canonicalVaultMetadata,
  createVaultMetadata,
  parseVaultMetadata,
} from "@pasteboard-pro/sync-protocol";
import {
  bytesToHex,
  decryptEnvelope,
  deriveVaultKey,
  hexToBytes,
} from "@pasteboard-pro/sync-protocol/node-crypto";
import { parseVaultEnvelope, parseVaultIndex } from "@pasteboard-pro/sync-protocol";

import type { KeychainSecretStore } from "./keychain";
import {
  createWebDavVaultClient,
  type WebDavCredentials,
  type WebDavVaultClient,
} from "./sync";
import type { SyncSettings, ZToolsSyncStore } from "./sync-store";

export type SaveSyncConfigurationInput = Readonly<{
  enabled: boolean;
  baseUrl: string;
  username: string;
  webdavPassword?: string;
  syncPassword?: string;
  syncFileContents: boolean;
}>;

export type SaveSyncConfigurationOptions = Readonly<{
  randomBytes?: (size: number) => Uint8Array;
  clientFactory?: (
    baseUrl: string,
    credentials: WebDavCredentials,
    store: ZToolsSyncStore,
  ) => WebDavVaultClient;
}>;

const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder("utf-8", { fatal: true });

function parseVaultMetadataBody(
  body: Uint8Array,
): ReturnType<typeof parseVaultMetadata> {
  if (body.byteLength > 64 * 1_024) {
    throw new RangeError("vault.json cannot exceed 64 KiB");
  }
  return parseVaultMetadata(JSON.parse(textDecoder.decode(body)) as unknown);
}

async function verifyCandidateVaultKey(
  client: WebDavVaultClient,
  key: Uint8Array,
): Promise<void> {
  const remoteIndex = await client.readFile("index.enc");
  if (remoteIndex === undefined) return;
  if (remoteIndex.body.byteLength > 16 * 1_024 * 1_024) {
    throw new RangeError("远端同步索引异常过大");
  }
  try {
    const envelope = parseVaultEnvelope(
      JSON.parse(textDecoder.decode(remoteIndex.body)) as unknown,
    );
    if (envelope.objectType !== "index" || envelope.objectId !== "main") {
      throw new TypeError("远端同步索引描述符无效");
    }
    parseVaultIndex(await decryptEnvelope(key, envelope));
  } catch (error) {
    throw new TypeError("剪贴板同步密码不正确，原有本地密钥未被替换", {
      cause: error,
    });
  }
}

export async function ensureVaultMetadata(
  client: WebDavVaultClient,
  randomBytes: (size: number) => Uint8Array = nodeRandomBytes,
): Promise<ReturnType<typeof parseVaultMetadata>> {
  const existing = await client.readFile("vault.json");
  if (existing !== undefined) return parseVaultMetadataBody(existing.body);

  const candidate = createVaultMetadata(randomBytes(16));
  const result = await client.putFileIfAbsent(
    "vault.json",
    textEncoder.encode(canonicalVaultMetadata(candidate)),
    "application/json",
  );
  if (result === "created") return candidate;
  const raced = await client.readFile("vault.json");
  if (raced === undefined) {
    throw new Error("WebDAV vault creation raced but vault.json is still missing");
  }
  return parseVaultMetadataBody(raced.body);
}

export async function saveSyncConfiguration(
  store: ZToolsSyncStore,
  keychain: KeychainSecretStore,
  input: SaveSyncConfigurationInput,
  options: SaveSyncConfigurationOptions = {},
): Promise<SyncSettings> {
  const current = await store.getSettings();
  const baseUrl = input.baseUrl.trim();
  const username = input.username.trim();
  const webdavPassword = input.webdavPassword;
  const syncPassword = input.syncPassword;
  const randomBytes = options.randomBytes ?? nodeRandomBytes;

  if (input.enabled && (baseUrl.length === 0 || username.length === 0)) {
    throw new TypeError("启用同步前需要填写 WebDAV 地址和用户名");
  }
  if (username.includes(":") || username.includes("\0")) {
    throw new TypeError("WebDAV 用户名不能包含冒号或 NUL 字符");
  }
  const suppliedWebDavPassword =
    webdavPassword !== undefined && webdavPassword.length > 0
      ? webdavPassword
      : undefined;
  const candidateWebDavPassword =
    suppliedWebDavPassword ??
    (input.enabled
      ? await keychain.load(current.webdavCredentialAccount)
      : undefined);
  let vaultSaltHex = current.vaultSaltHex;
  let candidateEncodedKey: string | undefined;
  if (input.enabled) {
    if (candidateWebDavPassword === undefined) {
      throw new TypeError("启用同步前需要保存 WebDAV 密码");
    }
    const credentials = { username, password: candidateWebDavPassword };
    const client =
      options.clientFactory?.(baseUrl, credentials, store) ??
      createWebDavVaultClient({
        baseUrl,
        credentials: async () => credentials,
        queue: store,
      });
    const hasCandidateSyncPassword =
      syncPassword !== undefined && syncPassword.length > 0;
    const metadata = hasCandidateSyncPassword
      ? await ensureVaultMetadata(client, randomBytes)
      : await (async () => {
          const existing = await client.readFile("vault.json");
          if (existing === undefined) {
            throw new TypeError("远端尚未创建 vault，请输入剪贴板同步密码");
          }
          return parseVaultMetadataBody(existing.body);
        })();
    vaultSaltHex = bytesToHex(base64ToBytes(metadata.kdf.salt));
    let key: Uint8Array;
    if (hasCandidateSyncPassword) {
      key = await deriveVaultKey(syncPassword, hexToBytes(vaultSaltHex));
      candidateEncodedKey = Buffer.from(key).toString("base64");
    } else {
      if (
        current.vaultSaltHex !== undefined &&
        current.vaultSaltHex !== vaultSaltHex
      ) {
        throw new TypeError("远端 vault 已更换，请重新输入剪贴板同步密码");
      }
      const existingEncodedKey = await keychain.load(current.vaultKeyAccount);
      if (existingEncodedKey === undefined) {
        throw new TypeError("启用同步前需要设置剪贴板同步密码");
      }
      key = new Uint8Array(Buffer.from(existingEncodedKey, "base64"));
      if (key.byteLength !== 32) {
        throw new TypeError("钥匙串中的剪贴板同步密钥无效");
      }
    }
    await verifyCandidateVaultKey(client, key);
  }

  if (suppliedWebDavPassword !== undefined) {
    await keychain.save(current.webdavCredentialAccount, suppliedWebDavPassword);
  }
  if (candidateEncodedKey !== undefined) {
    await keychain.save(current.vaultKeyAccount, candidateEncodedKey);
  }

  const settings: SyncSettings = {
    ...current,
    enabled: input.enabled,
    baseUrl,
    username,
    ...(vaultSaltHex === undefined ? {} : { vaultSaltHex }),
    syncFileContents: input.syncFileContents,
    status: {
      state: input.enabled ? "idle" : "disabled",
      pendingObjects: (await store.listObjects()).length,
      ...(current.status.lastSyncedAt === undefined
        ? {}
        : { lastSyncedAt: current.status.lastSyncedAt }),
    },
  };
  await store.putSettings(settings);
  return settings;
}
