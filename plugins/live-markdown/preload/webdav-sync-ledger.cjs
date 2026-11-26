"use strict";

// WebDAV 同步台账与冲突守卫。
//
// 远端文件只按文件名寻址，不同工作区的同名文件会映射到同一个远端路径。
// 台账按「服务器 + 远端目录 + 文件名」记录本设备上次同步时绑定的本地文件和内容哈希，
// 任何写入（上传覆盖云端、拉取覆盖本地）都必须证明被覆盖的一侧正是上次同步的版本，
// 否则视为冲突并跳过，绝不静默覆盖。

const crypto = require("node:crypto");
const path = require("node:path");

const LEDGER_STORAGE_KEY = "live_markdown_webdav_sync_ledger_v1";

function hashContent(content) {
  return crypto.createHash("sha256").update(String(content ?? ""), "utf8").digest("hex");
}

function normalizeLocalPath(filePath) {
  if (!filePath || typeof filePath !== "string") return null;
  const resolved = path.resolve(filePath);
  return process.platform === "win32" ? resolved.toLowerCase() : resolved;
}

function remoteKey(config, fileName) {
  const server = String(config.serverUrl || "").trim().replace(/\/+$/, "");
  return `${server}|${config.remotePath}|${fileName}`;
}

function resolveDefaultStorage() {
  const ztools = typeof window !== "undefined" ? window.ztools : null;
  if (ztools?.dbStorage && typeof ztools.dbStorage.getItem === "function" && typeof ztools.dbStorage.setItem === "function") {
    return ztools.dbStorage;
  }
  if (typeof localStorage !== "undefined" && typeof localStorage.getItem === "function" && typeof localStorage.setItem === "function") {
    return localStorage;
  }
  return null;
}

function createMemoryStorage() {
  const map = new Map();
  return {
    getItem: (key) => (map.has(key) ? map.get(key) : null),
    setItem: (key, value) => {
      map.set(key, String(value));
    }
  };
}

function createWebdavSyncLedger(storage) {
  const store = storage || resolveDefaultStorage() || createMemoryStorage();

  // 台账损坏时按“没有任何同步记录”处理：只会产生更多冲突提示，不会放行覆盖。
  function readAll() {
    try {
      const raw = store.getItem(LEDGER_STORAGE_KEY);
      if (!raw) return {};
      const parsed = typeof raw === "string" ? JSON.parse(raw) : raw;
      return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
    } catch {
      return {};
    }
  }

  function writeAll(entries) {
    store.setItem(LEDGER_STORAGE_KEY, JSON.stringify(entries));
  }

  return {
    get(config, fileName) {
      const entry = readAll()[remoteKey(config, fileName)];
      return entry && typeof entry === "object" ? entry : null;
    },
    record(config, fileName, { localPath, contentHash }) {
      const all = readAll();
      // 本地路径为空（未保存文档）表示“未绑定”：守卫只按内容哈希判定，之后另存为的文件可以正常接管。
      all[remoteKey(config, fileName)] = {
        localPath: normalizeLocalPath(localPath),
        contentHash,
        syncedAt: Date.now()
      };
      writeAll(all);
    },
    forget(config, fileName) {
      const all = readAll();
      delete all[remoteKey(config, fileName)];
      writeAll(all);
    }
  };
}

/** 拉取：云端内容将写入 localPath。localHash 为 null 表示本地文件不存在。 */
function decidePullWrite({ binding, localPath, localHash, remoteHash }) {
  if (localHash === null || localHash === remoteHash) return { allowed: true };
  const normalized = normalizeLocalPath(localPath);
  if (binding && binding.localPath && binding.localPath !== normalized) {
    return { allowed: false, reason: "bound-elsewhere" };
  }
  if (binding && binding.localPath === normalized) {
    return binding.contentHash === localHash
      ? { allowed: true }
      : { allowed: false, reason: "local-modified" };
  }
  return { allowed: false, reason: "local-unknown" };
}

/** 上传：localPath 的内容将覆盖云端。remoteHash 为 null 表示云端文件不存在。 */
function decidePushWrite({ binding, localPath, localHash, remoteHash }) {
  if (remoteHash === null || remoteHash === localHash) return { allowed: true };
  if (!binding) return { allowed: false, reason: "unknown-remote" };
  const normalized = normalizeLocalPath(localPath);
  if (binding.localPath && binding.localPath !== normalized) {
    return { allowed: false, reason: "bound-elsewhere" };
  }
  return binding.contentHash === remoteHash
    ? { allowed: true }
    : { allowed: false, reason: "remote-changed" };
}

function describeConflict(direction, fileName, reason) {
  const action = direction === "push" ? "上传" : "拉取";
  switch (reason) {
    case "bound-elsewhere":
      return `《${fileName}》已与另一个本地文件同步（可能是其他工作区的同名文件），已跳过${action}以免互相覆盖。请重命名其中一个文件，或为该工作区使用独立的 WebDAV 远端目录。`;
    case "remote-changed":
      return `云端《${fileName}》在上次同步后已被其他设备或工作区修改，已跳过上传以免覆盖云端内容，请先核对差异。`;
    case "unknown-remote":
      return `云端已存在内容不同的《${fileName}》，且本设备没有它的同步记录，已跳过上传以免覆盖云端内容。确认以本地为准时，可先在 WebDAV 面板删除云端副本再同步。`;
    case "local-modified":
      return `本地《${fileName}》有尚未同步的修改，与云端内容不一致，已跳过拉取以免覆盖本地文件。`;
    case "local-unknown":
    default:
      return `本地已存在内容不同的《${fileName}》，且本设备没有它的同步记录，已跳过${action}以免覆盖。确认以云端为准时，可先移走或重命名本地文件再拉取。`;
  }
}

module.exports = {
  LEDGER_STORAGE_KEY,
  hashContent,
  normalizeLocalPath,
  createWebdavSyncLedger,
  createMemoryStorage,
  decidePullWrite,
  decidePushWrite,
  describeConflict
};
