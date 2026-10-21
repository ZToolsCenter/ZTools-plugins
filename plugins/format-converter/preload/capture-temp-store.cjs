"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs/promises");
const fssync = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const DEFAULT_MAX_CAPTURE_BYTES = 64 * 1024 ** 2;
const activeStores = new Set();
let processCleanupRegistered = false;

function captureError(code, message, cause) {
  const error = new Error(message, cause ? { cause } : undefined);
  error.code = code;
  return error;
}

function parseCaptureDataUrl(dataUrl, maxBytes = DEFAULT_MAX_CAPTURE_BYTES) {
  if (typeof dataUrl !== "string") throw captureError("SCREEN_CAPTURE_INVALID", "截图格式不受支持。");
  const header = /^data:image\/(png|jpeg|jpg|webp);base64,/i.exec(dataUrl);
  if (!header) throw captureError("SCREEN_CAPTURE_INVALID", "截图格式不受支持。");
  const payload = dataUrl.slice(header[0].length);
  const maxBase64Length = Math.ceil(maxBytes / 3) * 4;
  if (payload.length > maxBase64Length) throw captureError("SCREEN_CAPTURE_TOO_LARGE", `截图不能超过 ${Math.round(maxBytes / 1024 ** 2)} MB。`);
  if (!payload || payload.length % 4 !== 0 || !/^[A-Za-z0-9+/]+={0,2}$/.test(payload)) {
    throw captureError("SCREEN_CAPTURE_INVALID", "截图数据不是有效的 Base64 图像。");
  }
  const padding = payload.endsWith("==") ? 2 : payload.endsWith("=") ? 1 : 0;
  const decodedBytes = payload.length / 4 * 3 - padding;
  if (decodedBytes <= 0 || decodedBytes > maxBytes) throw captureError("SCREEN_CAPTURE_TOO_LARGE", `截图不能超过 ${Math.round(maxBytes / 1024 ** 2)} MB。`);
  const buffer = Buffer.from(payload, "base64");
  if (buffer.length !== decodedBytes) throw captureError("SCREEN_CAPTURE_INVALID", "截图数据不是有效的 Base64 图像。");
  return { buffer, extension: header[1].toLowerCase() === "jpg" ? "jpeg" : header[1].toLowerCase() };
}

function registerProcessCleanup() {
  if (processCleanupRegistered || typeof process?.once !== "function") return;
  processCleanupRegistered = true;
  process.once("exit", () => {
    for (const store of [...activeStores]) store.cleanupAllSync();
  });
}

function createCaptureTempStore(options = {}) {
  const maxBytes = Number.isSafeInteger(options.maxBytes) && options.maxBytes > 0 ? options.maxBytes : DEFAULT_MAX_CAPTURE_BYTES;
  const now = options.now || Date.now;
  const randomId = options.randomId || (() => crypto.randomUUID());
  const tempDirectory = options.tempDirectory || os.tmpdir();
  const trackedPaths = new Set();
  const grants = new Map();
  let root = null;
  let rootPromise = null;
  let generation = 0;

  function rootIsSafeSync(candidate) {
    if (!candidate || path.dirname(candidate) === candidate) return false;
    try {
      const stat = fssync.lstatSync(candidate);
      return stat.isDirectory() && !stat.isSymbolicLink() && fssync.realpathSync(candidate) === candidate;
    } catch { return false; }
  }

  function removeRootIfEmptySync() {
    if (!root || trackedPaths.size) return;
    const candidate = root;
    try {
      const stat = fssync.lstatSync(candidate);
      if (stat.isSymbolicLink()) fssync.unlinkSync(candidate);
      else if (stat.isDirectory()) fssync.rmdirSync(candidate);
    } catch {}
    if (!fssync.existsSync(candidate)) {
      root = null;
      activeStores.delete(store);
    }
  }

  function clearGrantRecord(grantId) {
    const grant = grants.get(grantId);
    if (!grant) return null;
    grants.delete(grantId);
    if (grant.timer) clearTimeout(grant.timer);
    return grant;
  }

  function cleanupTrackedPathSync(filePath) {
    if (!trackedPaths.has(filePath)) return false;
    if (!rootIsSafeSync(root)) {
      cleanupAllSync();
      return true;
    }
    if (path.dirname(filePath) !== root) {
      trackedPaths.delete(filePath);
      return false;
    }
    try {
      const stat = fssync.lstatSync(filePath);
      if (stat.isFile() || stat.isSymbolicLink()) fssync.unlinkSync(filePath);
    } catch {}
    trackedPaths.delete(filePath);
    removeRootIfEmptySync();
    return true;
  }

  function cleanupGrantSync(grantId) {
    const grant = clearGrantRecord(grantId);
    if (!grant) return false;
    return cleanupTrackedPathSync(grant.filePath);
  }

  function cleanupAllSync() {
    generation += 1;
    for (const grantId of [...grants.keys()]) clearGrantRecord(grantId);
    const candidate = root;
    if (!candidate) {
      trackedPaths.clear();
      activeStores.delete(store);
      return;
    }
    if (!rootIsSafeSync(candidate)) {
      try { if (fssync.lstatSync(candidate).isSymbolicLink()) fssync.unlinkSync(candidate); } catch {}
      trackedPaths.clear();
      root = null;
      activeStores.delete(store);
      return;
    }
    for (const filePath of [...trackedPaths]) {
      if (path.dirname(filePath) !== candidate) continue;
      try {
        const stat = fssync.lstatSync(filePath);
        if (stat.isFile() || stat.isSymbolicLink()) fssync.unlinkSync(filePath);
      } catch {}
    }
    trackedPaths.clear();
    try { fssync.rmdirSync(candidate); } catch {}
    if (!fssync.existsSync(candidate)) root = null;
    activeStores.delete(store);
  }

  function cleanupInactiveSync() {
    generation += 1;
    const currentTime = now();
    const retainedPaths = new Set();
    for (const [grantId, grant] of [...grants]) {
      const retryable = grant.jobId !== null && grant.expiresAt > currentTime;
      if (grant.active || retryable) retainedPaths.add(grant.filePath);
      else cleanupGrantSync(grantId);
    }
    for (const filePath of [...trackedPaths]) if (!retainedPaths.has(filePath)) cleanupTrackedPathSync(filePath);
  }

  async function assertSafeRoot(candidate) {
    const stat = await fs.lstat(candidate).catch(() => null);
    if (!stat || stat.isSymbolicLink() || !stat.isDirectory()) throw captureError("CAPTURE_TEMP_BOUNDARY", "截图临时目录已失效，请重试。");
    const [canonicalRoot, canonicalTemp] = await Promise.all([fs.realpath(candidate), fs.realpath(tempDirectory)]);
    if (canonicalRoot !== candidate || path.dirname(canonicalRoot) !== canonicalTemp) {
      throw captureError("CAPTURE_TEMP_BOUNDARY", "截图临时目录越过了安全边界。");
    }
    return canonicalRoot;
  }

  async function ensureRoot() {
    if (root) return assertSafeRoot(root);
    if (rootPromise) return rootPromise;
    const expectedGeneration = generation;
    rootPromise = (async () => {
      const canonicalTemp = await fs.realpath(tempDirectory);
      const created = await fs.mkdtemp(path.join(canonicalTemp, `ztools-format-converter-${process.pid}-`));
      try {
        await fs.chmod(created, 0o700);
        const canonicalRoot = await fs.realpath(created);
        const stat = await fs.lstat(created);
        if (generation !== expectedGeneration) throw captureError("CAPTURE_TEMP_CLEANED", "插件已退出，截图临时目录已清理。");
        if (stat.isSymbolicLink() || !stat.isDirectory() || canonicalRoot !== created || path.dirname(canonicalRoot) !== canonicalTemp) {
          throw captureError("CAPTURE_TEMP_BOUNDARY", "截图临时目录越过了安全边界。");
        }
        root = canonicalRoot;
        activeStores.add(store);
        registerProcessCleanup();
        return root;
      } catch (error) {
        try { await fs.rmdir(created); } catch {}
        throw error;
      }
    })();
    try { return await rootPromise; }
    finally { rootPromise = null; }
  }

  async function createFromDataUrl(dataUrl) {
    const { buffer, extension } = parseCaptureDataUrl(dataUrl, maxBytes);
    const expectedGeneration = generation;
    const safeRoot = await ensureRoot();
    if (generation !== expectedGeneration) throw captureError("CAPTURE_TEMP_CLEANED", "插件已退出，截图临时目录已清理。");
    const id = String(randomId());
    if (!/^[A-Za-z0-9-]{1,128}$/.test(id)) throw captureError("CAPTURE_TEMP_WRITE_FAILED", "无法生成安全的截图临时文件名。");
    const output = path.join(safeRoot, `capture-${id}.${extension}`);
    if (path.dirname(output) !== safeRoot) throw captureError("CAPTURE_TEMP_BOUNDARY", "截图临时文件越过了安全边界。");
    let handle;
    let created = false;
    try {
      await assertSafeRoot(safeRoot);
      const flags = fssync.constants.O_WRONLY | fssync.constants.O_CREAT | fssync.constants.O_EXCL | (fssync.constants.O_NOFOLLOW || 0);
      handle = await fs.open(output, flags, 0o600);
      created = true;
      await handle.writeFile(buffer);
      await handle.chmod(0o600);
      await handle.sync();
      await handle.close();
      handle = null;
      if (generation !== expectedGeneration) throw captureError("CAPTURE_TEMP_CLEANED", "插件已退出，截图临时文件已清理。");
      const [stat, canonicalFile, canonicalParent] = await Promise.all([fs.lstat(output), fs.realpath(output), fs.realpath(path.dirname(output))]);
      if (stat.isSymbolicLink() || !stat.isFile() || canonicalParent !== safeRoot || path.dirname(canonicalFile) !== safeRoot || canonicalFile !== output) {
        throw captureError("CAPTURE_TEMP_BOUNDARY", "截图临时文件越过了安全边界。");
      }
      trackedPaths.add(canonicalFile);
      return { path: canonicalFile, size: stat.size };
    } catch (error) {
      try { await handle?.close(); } catch {}
      if (created) await fs.unlink(output).catch(() => undefined);
      removeRootIfEmptySync();
      if (error?.code === "EEXIST" || error?.code === "ELOOP") throw captureError("CAPTURE_TEMP_CONFLICT", "截图临时文件已被占用，请重试。", error);
      if (error?.code) throw error;
      throw captureError("CAPTURE_TEMP_WRITE_FAILED", "无法安全写入截图临时文件。", error);
    }
  }

  function scheduleExpiry(grantId) {
    const grant = grants.get(grantId);
    if (!grant) return;
    const delay = Math.max(0, Math.min(2_147_483_647, grant.expiresAt - now() + 1));
    grant.timer = setTimeout(() => {
      const current = grants.get(grantId);
      if (!current) return;
      if (current.expiresAt <= now() && current.active) {
        current.expired = true;
        current.timer = null;
      } else if (current.expiresAt <= now()) cleanupGrantSync(grantId);
      else scheduleExpiry(grantId);
    }, delay);
    grant.timer.unref?.();
  }

  function associateGrant(grantId, filePath, expiresAt) {
    if (typeof grantId !== "string" || !trackedPaths.has(filePath)) throw captureError("CAPTURE_TEMP_GRANT_INVALID", "截图临时文件授权无效。");
    const expiry = Number.isFinite(expiresAt) ? expiresAt : now() + 12 * 60 * 60 * 1000;
    grants.set(grantId, { filePath, expiresAt: expiry, jobId: null, active: false, expired: false, timer: null });
    if (expiry <= now()) cleanupGrantSync(grantId); else scheduleExpiry(grantId);
  }

  function assertConsumable(grantId) {
    const grant = grants.get(grantId);
    if (grant?.jobId) throw captureError("SCREEN_CAPTURE_GRANT_CONSUMED", "该截图已开始转换，请重新截图后再创建新任务。");
  }

  function markConsumed(grantId, jobId) {
    const grant = grants.get(grantId);
    if (grant) { grant.jobId = jobId; grant.active = true; }
  }

  function markJobActive(jobId) {
    for (const grant of grants.values()) if (grant.jobId === jobId) grant.active = true;
  }

  function settleJob(grantId, job) {
    const grant = grants.get(grantId);
    if (!grant || (grant.jobId && grant.jobId !== job?.id)) return false;
    grant.active = false;
    const retryable = Array.isArray(job?.items) && job.items.some(item => item.status === "failed" || item.status === "cancelled");
    if (!retryable || grant.expired || grant.expiresAt <= now()) return cleanupGrantSync(grantId);
    return false;
  }

  function discardFile(filePath) {
    for (const [grantId, grant] of grants) if (grant.filePath === filePath) clearGrantRecord(grantId);
    return cleanupTrackedPathSync(filePath);
  }

  function pruneExpired(at = now()) {
    for (const [grantId, grant] of grants) {
      if (grant.expiresAt > at) continue;
      if (grant.active) grant.expired = true;
      else cleanupGrantSync(grantId);
    }
  }

  const store = Object.freeze({
    maxBytes,
    createFromDataUrl,
    associateGrant,
    assertConsumable,
    markConsumed,
    markJobActive,
    settleJob,
    discardFile,
    cleanupGrantSync,
    cleanupInactiveSync,
    cleanupAllSync,
    pruneExpired
  });
  return store;
}

module.exports = { DEFAULT_MAX_CAPTURE_BYTES, captureError, parseCaptureDataUrl, createCaptureTempStore };
