'use strict';

const fs = require('node:fs/promises');
const fsSync = require('node:fs');
const path = require('node:path');
const { randomBytes } = require('node:crypto');
const { pathToFileURL } = require('node:url');

const TOOL_NAMES = Object.freeze({ inspect: 'inspect_approved_zip', plan: 'plan_approved_zip' });
const GRANT_TTL_MS = 5 * 60 * 1000;
const ZIP_SOURCE_MAX = 256 * 1024 * 1024;
const MCP_ZIP_SOURCE_MAX = 64 * 1024 * 1024;
const CREATE_FILE_MAX = 64 * 1024 * 1024;
const CREATE_TOTAL_MAX = 256 * 1024 * 1024;
const CREATE_COUNT_MAX = 100;
const MAX_GRANTS = 32;
const MCP_MAX_OFFSET = 1200;
const MCP_MAX_LIMIT = 200;
const MCP_DEFAULT_LIMIT = 100;
const MCP_RESPONSE_BYTES = 128 * 1024;
const FORBIDDEN_KEYS = new Set(['__proto__', 'prototype', 'constructor']);

const selected = new Map();
const registeredHosts = new WeakSet();
const lifecycleHosts = new WeakSet();
let activeZipToken = null;
let corePromise;
let mcpCache = null;
let mcpFlight = null;
let sessionEpoch = 0;
const mcpMetrics = { reads: 0, inspections: 0 };

function invalid(message) {
  return Object.assign(new TypeError(message), { code: 'INVALID_TOOL_INPUT' });
}

function approvalRequired() {
  return Object.assign(new Error('当前没有用户授权的 ZIP，请先在插件界面选择 ZIP 后再试。'), { code: 'APPROVED_ZIP_REQUIRED' });
}

function mcpZipTooLarge() {
  return Object.assign(new Error('已授权 ZIP 超过 MCP 检查的 64 MiB 限制；更大的压缩包请使用插件界面。'), { code: 'MCP_ZIP_TOO_LARGE' });
}

function sessionExpired() {
  return Object.assign(new Error('当前插件会话已结束，请重新选择文件或目录。'), { code: 'SESSION_EXPIRED' });
}

function assertSessionEpoch(epoch) {
  if (epoch !== sessionEpoch) throw sessionExpired();
}

function clearMcpState(grantId) {
  if (grantId === undefined || mcpCache?.grantId === grantId) mcpCache = null;
  if (grantId === undefined || mcpFlight?.grantId === grantId) mcpFlight = null;
}

function clearExpired(now = Date.now()) {
  for (const [id, item] of selected) {
    if (item.expires <= now) {
      selected.delete(id);
      if (activeZipToken === id) activeZipToken = null;
      clearMcpState(id);
    }
  }
}

function clearGrants() {
  sessionEpoch += 1;
  selected.clear();
  activeZipToken = null;
  clearMcpState();
}

function revokeZip(id) {
  selected.delete(id);
  if (activeZipToken === id) activeZipToken = null;
  clearMcpState(id);
}

function token(kind, value, epoch = sessionEpoch) {
  assertSessionEpoch(epoch);
  clearExpired();
  if (selected.size >= MAX_GRANTS) throw new Error('当前文件授权过多，请退出并重新打开插件。');
  const id = randomBytes(24).toString('base64url');
  selected.set(id, { kind, value, expires: Date.now() + GRANT_TTL_MS });
  return id;
}

function activateZip(value, epoch = sessionEpoch) {
  assertSessionEpoch(epoch);
  clearExpired();
  if (activeZipToken) revokeZip(activeZipToken);
  const id = token('zip', value, epoch);
  activeZipToken = id;
  clearMcpState();
  return id;
}

function grant(id, kind, epoch = sessionEpoch) {
  assertSessionEpoch(epoch);
  clearExpired();
  const grantId = String(id);
  const item = selected.get(grantId);
  if (!item || item.kind !== kind) throw new Error('所选路径的授权无效或已过期，请重新选择。');
  return Object.freeze({ id: grantId, kind, value: item.value });
}

function assertGrant(record, epoch) {
  assertSessionEpoch(epoch);
  clearExpired();
  const current = selected.get(record.id);
  if (!current || current.kind !== record.kind || current.value !== record.value) {
    throw new Error('所选路径的授权无效或已过期，请重新选择。');
  }
  return record.value;
}

function activeZipGrant() {
  clearExpired();
  if (!activeZipToken) throw approvalRequired();
  const item = selected.get(activeZipToken);
  if (!item || item.kind !== 'zip') {
    clearMcpState(activeZipToken);
    activeZipToken = null;
    throw approvalRequired();
  }
  return { id: activeZipToken, value: item.value, epoch: sessionEpoch };
}

function pathsFrom(result) {
  if (typeof result === 'string') return [result];
  if (Array.isArray(result)) return result;
  return Array.isArray(result && result.filePaths) ? result.filePaths : [];
}

async function choose(api, options) {
  if (typeof api.showOpenDialog !== 'function') throw new Error('当前 ZTools 版本不支持文件选择对话框。');
  const values = pathsFrom(await api.showOpenDialog(options));
  if (!values.length) throw new Error('已取消选择。');
  return values;
}

async function save(api, options) {
  if (typeof api.showSaveDialog !== 'function') throw new Error('当前 ZTools 版本不支持保存对话框。');
  const result = await api.showSaveDialog(options);
  const value = typeof result === 'string' ? result : result && (result.filePath || result.path);
  if (!value) throw new Error('已取消保存。');
  return value;
}

async function core() {
  if (!corePromise) {
    const packaged = path.join(__dirname, '..', 'core', 'archive.mjs');
    const source = path.join(__dirname, '..', 'src', 'core', 'archive.mjs');
    corePromise = import(pathToFileURL(fsSync.existsSync(packaged) ? packaged : source).href);
  }
  return corePromise;
}

function summary(plan) {
  return {
    format: plan.format,
    entries: plan.entries.map((entry) => ({ name: entry.name, size: entry.size, compressed: entry.compressed })),
    total: plan.total,
    conflict: plan.conflict
  };
}

async function safeFile(input, maxSize, extension) {
  const initial = await fs.lstat(input);
  if (initial.isSymbolicLink() || !initial.isFile()) throw new Error('只能使用直接选择的普通文件。');
  const resolved = await fs.realpath(input);
  const final = await fs.lstat(resolved);
  if (final.isSymbolicLink() || !final.isFile() || final.size > maxSize) throw new Error('所选文件不安全或超过大小限制。');
  if (extension && path.extname(resolved).toLowerCase() !== extension) throw new Error(`请选择 ${extension} 文件。`);
  return fileIdentity(resolved, final);
}

function fileIdentity(filePath, info) {
  return Object.freeze({ path: filePath, size: info.size, dev: info.dev, ino: info.ino, mtimeMs: info.mtimeMs, ctimeMs: info.ctimeMs });
}

function sameFileIdentity(approved, current) {
  return approved.path === current.path
    && approved.dev === current.dev
    && approved.ino === current.ino
    && approved.mtimeMs === current.mtimeMs
    && approved.ctimeMs === current.ctimeMs
    && approved.size === current.size;
}

async function readHandleBounded(handle, limit, maximum = MCP_ZIP_SOURCE_MAX) {
  if (!Number.isSafeInteger(limit) || limit < 0 || !Number.isSafeInteger(maximum) || maximum < 0 || limit > maximum) throw new RangeError('已授权文件的读取限制无效。');
  const buffer = Buffer.allocUnsafe(limit + 1);
  let offset = 0;
  while (offset < buffer.length) {
    const { bytesRead } = await handle.read(buffer, offset, buffer.length - offset, null);
    if (bytesRead === 0) break;
    offset += bytesRead;
  }
  if (offset > limit) throw new RangeError('已授权文件的大小在选择后增大。');
  return buffer.subarray(0, offset);
}

async function readApprovedIdentity(approved, maximum, extension) {
  const current = await safeFile(approved.path, maximum, extension);
  if (!sameFileIdentity(approved, current)) throw new Error('所选文件的身份已发生变化。');
  const flags = fsSync.constants.O_RDONLY | (process.platform === 'win32' ? 0 : (fsSync.constants.O_NOFOLLOW || 0));
  let handle;
  try {
    handle = await fs.open(current.path, flags);
    const before = await handle.stat();
    if (!before.isFile() || !sameFileIdentity(approved, fileIdentity(current.path, before))) throw new Error('所选文件在打开时发生变化。');
    const bytes = await readHandleBounded(handle, approved.size, maximum);
    const after = await handle.stat();
    if (!sameFileIdentity(approved, fileIdentity(current.path, after))) throw new Error('所选文件在读取时发生变化。');
    const final = await safeFile(current.path, maximum, extension);
    if (!sameFileIdentity(approved, final) || bytes.length !== approved.size) throw new Error('所选文件在读取时发生变化。');
    return bytes;
  } finally {
    await handle?.close().catch(() => {});
  }
}

async function safeDirectory(input) {
  const selectedPath = path.resolve(input);
  const initial = await fs.lstat(selectedPath);
  if (initial.isSymbolicLink() || !initial.isDirectory()) throw new Error('解压位置必须是真实目录。');
  const resolved = await fs.realpath(selectedPath);
  const final = await fs.lstat(resolved);
  if (final.isSymbolicLink() || !final.isDirectory()) throw new Error('解压位置在选择后发生变化。');
  let current = path.parse(resolved).root;
  for (const part of path.relative(current, resolved).split(path.sep).filter(Boolean)) {
    current = path.join(current, part);
    const info = await fs.lstat(current);
    if (info.isSymbolicLink()) throw new Error('解压位置的上级路径包含符号链接。');
  }
  return resolved;
}

function validateObject(value, allowed, label = '工具输入') {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw invalid(`${label}必须是对象。`);
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) throw invalid(`${label}包含不支持的原型。`);
  for (const key of Reflect.ownKeys(value)) {
    if (typeof key !== 'string' || FORBIDDEN_KEYS.has(key) || !allowed.has(key)) throw invalid(`${label}包含不支持的字段。`);
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor || !Object.hasOwn(descriptor, 'value')) throw invalid(`${label}只能包含数据字段。`);
  }
}

function boundedInteger(value, field, fallback, minimum, maximum) {
  if (value === undefined) return fallback;
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < minimum || value > maximum) throw invalid(`${field} 必须是 ${minimum} 到 ${maximum} 之间的整数。`);
  return value;
}

function own(value, key) {
  return Object.hasOwn(value, key) ? value[key] : undefined;
}

function validateToolInput(input = {}, allowConflict = false) {
  validateObject(input, new Set(['offset', 'limit', ...(allowConflict ? ['conflict'] : [])]));
  const offset = boundedInteger(own(input, 'offset'), 'offset', 0, 0, MCP_MAX_OFFSET);
  const limit = boundedInteger(own(input, 'limit'), 'limit', MCP_DEFAULT_LIMIT, 1, MCP_MAX_LIMIT);
  const conflictValue = own(input, 'conflict');
  const conflict = conflictValue === undefined ? 'rename' : conflictValue;
  if (allowConflict && !['rename', 'skip', 'error'].includes(conflict)) throw invalid('conflict 必须是 rename、skip 或 error。');
  return { offset, limit, ...(allowConflict ? { conflict } : {}) };
}

function safeLimits(plan) {
  return {
    archiveEntries: Number(plan.limits.entries),
    singleExpandedBytes: Number(plan.limits.single),
    totalExpandedBytes: Number(plan.limits.total),
    compressionRatio: Number(plan.limits.ratio),
    pathDepth: Number(plan.limits.depth),
    entryNameBytes: Number(plan.limits.name),
    sourceBytes: MCP_ZIP_SOURCE_MAX,
    pageLimit: MCP_MAX_LIMIT,
    responseBytes: MCP_RESPONSE_BYTES
  };
}

function totals(plan) {
  return {
    entries: plan.entries.length,
    expandedBytes: plan.total,
    compressedBytes: plan.entries.reduce((sum, entry) => sum + entry.compressed, 0)
  };
}

function encodedBytes(value) {
  return Buffer.byteLength(JSON.stringify(value), 'utf8');
}

function pagedResponse(base, key, all, offset, limit, mapItem) {
  const requested = all.slice(offset, offset + limit).map(mapItem);
  const items = requested.slice();
  const response = {
    ...base,
    pagination: { offset, limit, returned: items.length, hasMore: offset + items.length < all.length, responseTruncated: false },
    [key]: items
  };
  while (items.length && encodedBytes(response) > MCP_RESPONSE_BYTES) {
    items.pop();
    response.pagination.returned = items.length;
    response.pagination.hasMore = offset + items.length < all.length;
    response.pagination.responseTruncated = true;
  }
  if (encodedBytes(response) > MCP_RESPONSE_BYTES) throw new Error('安全压缩包摘要超过 MCP 响应大小限制。');
  return response;
}

function approvedZipUnavailable(record) {
  revokeZip(record.id);
  return Object.assign(new Error('已授权 ZIP 不可用或不再安全，请在插件界面重新选择。'), { code: 'APPROVED_ZIP_UNAVAILABLE' });
}

async function revalidateApprovedZip(record) {
  try {
    const current = await safeFile(record.value.path, MCP_ZIP_SOURCE_MAX, '.zip');
    if (!sameFileIdentity(record.value, current)) throw new Error('已授权 ZIP 的文件身份已发生变化。');
    return current;
  } catch {
    if (!activeGrantStillMatches(record.id, record.epoch)) throw approvalRequired();
    throw approvedZipUnavailable(record);
  }
}

async function readApprovedZip(record) {
  let handle;
  try {
    const current = await revalidateApprovedZip(record);
    handle = await fs.open(current.path, 'r');
    const before = await handle.stat();
    const opened = fileIdentity(current.path, before);
    if (!before.isFile() || !sameFileIdentity(record.value, opened)) throw new Error('已授权 ZIP 在打开时发生变化。');
    mcpMetrics.reads += 1;
    const bytes = await readHandleBounded(handle, record.value.size);
    const after = await handle.stat();
    const finished = fileIdentity(current.path, after);
    if (!sameFileIdentity(record.value, finished) || bytes.length !== record.value.size) throw new Error('已授权 ZIP 在读取时发生变化。');
    return bytes;
  } catch (error) {
    if (!activeGrantStillMatches(record.id, record.epoch)) throw approvalRequired();
    if (error?.code === 'APPROVED_ZIP_UNAVAILABLE') throw error;
    throw approvedZipUnavailable(record);
  } finally {
    await handle?.close().catch(() => {});
  }
}

function cacheableArchive(plan) {
  const entries = Object.freeze(plan.entries.map((entry) => Object.freeze({
    name: entry.name,
    size: entry.size,
    compressed: entry.compressed,
    directory: entry.directory,
    method: entry.method
  })));
  return Object.freeze({ format: plan.format, entries, total: plan.total, limits: Object.freeze({ ...plan.limits }) });
}

function cachedFailure() {
  return Object.assign(new Error('已授权 ZIP 未通过受限安全检查。'), { code: 'ZIP_INSPECTION_FAILED' });
}

function activeGrantStillMatches(id, epoch = sessionEpoch) {
  clearExpired();
  return epoch === sessionEpoch && activeZipToken === id && selected.get(id)?.kind === 'zip';
}

async function mcpInspection() {
  const record = activeZipGrant();
  if (record.value.size > MCP_ZIP_SOURCE_MAX) throw mcpZipTooLarge();

  if (mcpCache?.grantId === record.id) {
    await revalidateApprovedZip(record);
    if (!activeGrantStillMatches(record.id, record.epoch)) throw approvalRequired();
    if (mcpCache.error) throw cachedFailure();
    return mcpCache.archive;
  }
  if (mcpFlight?.grantId === record.id) return mcpFlight.promise;

  const flight = { grantId: record.id, promise: null };
  flight.promise = (async () => {
    const bytes = await readApprovedZip(record);
    let archive;
    try {
      const mod = await core();
      mcpMetrics.inspections += 1;
      archive = cacheableArchive(mod.inspectZip(bytes));
    } catch {
      if (activeGrantStillMatches(record.id, record.epoch)) mcpCache = { grantId: record.id, error: true };
      throw cachedFailure();
    }
    if (!activeGrantStillMatches(record.id, record.epoch)) throw approvalRequired();
    mcpCache = { grantId: record.id, archive };
    return archive;
  })().finally(() => {
    if (mcpFlight === flight) mcpFlight = null;
  });
  mcpFlight = flight;
  return flight.promise;
}

async function inspectApprovedZipForMcp(input = {}) {
  const page = validateToolInput(input, false);
  const plan = await mcpInspection();
  return pagedResponse(
    { format: plan.format, conflict: null, totals: totals(plan), limits: safeLimits(plan) },
    'entries',
    plan.entries,
    page.offset,
    page.limit,
    (entry) => ({ name: entry.name, size: entry.size, compressed: entry.compressed, directory: entry.directory, method: entry.method })
  );
}

async function planApprovedZipForMcp(input = {}) {
  const page = validateToolInput(input, true);
  const archive = await mcpInspection();
  const action = page.conflict === 'rename' ? 'rename-on-conflict' : `write-or-${page.conflict}`;
  return pagedResponse(
    { format: archive.format, conflict: page.conflict, totals: totals(archive), limits: safeLimits(archive) },
    'writePlan',
    archive.entries,
    page.offset,
    page.limit,
    (entry) => ({ name: entry.name, action })
  );
}

function registerTools(target) {
  const api = target?.ztools;
  if (!api || typeof api.registerTool !== 'function' || registeredHosts.has(api)) return Object.freeze([]);
  const registered = [];
  for (const [name, handler] of [[TOOL_NAMES.inspect, inspectApprovedZipForMcp], [TOOL_NAMES.plan, planApprovedZipForMcp]]) {
    try { api.registerTool.call(api, name, handler); registered.push(name); } catch {}
  }
  registeredHosts.add(api);
  return Object.freeze(registered);
}

function registerLifecycle(api) {
  if (!api || (typeof api !== 'object' && typeof api !== 'function') || lifecycleHosts.has(api)) return false;
  try {
    if (typeof api.onPluginOut === 'function') api.onPluginOut(clearGrants);
  } catch {}
  lifecycleHosts.add(api);
  return true;
}

function createBridge(api) {
  return Object.freeze({
    chooseZip: async () => {
      const epoch = sessionEpoch;
      const input = (await choose(api, { title: '选择 ZIP 压缩包', properties: ['openFile'], filters: [{ name: 'ZIP 压缩包', extensions: ['zip'] }] }))[0];
      assertSessionEpoch(epoch);
      const approved = await safeFile(input, ZIP_SOURCE_MAX, '.zip');
      assertSessionEpoch(epoch);
      return activateZip(approved, epoch);
    },
    chooseDestination: async () => {
      const epoch = sessionEpoch;
      const input = (await choose(api, { title: '选择解压位置', properties: ['openDirectory', 'createDirectory'] }))[0];
      assertSessionEpoch(epoch);
      const approved = await safeDirectory(input);
      assertSessionEpoch(epoch);
      return token('destination', approved, epoch);
    },
    chooseFiles: async () => {
      const epoch = sessionEpoch;
      const inputs = await choose(api, { title: '选择要压缩的文件', properties: ['openFile', 'multiSelections'] });
      assertSessionEpoch(epoch);
      if (inputs.length > CREATE_COUNT_MAX) throw new Error('最多选择 100 个文件。');
      let total = 0;
      const safe = [];
      for (const input of inputs) {
        const item = await safeFile(input, CREATE_FILE_MAX);
        assertSessionEpoch(epoch);
        total += item.size;
        if (total > CREATE_TOTAL_MAX) throw new Error('所选文件超过 256 MiB 总大小限制。');
        safe.push(item);
      }
      return token('files', safe, epoch);
    },
    preview: async (zipToken) => {
      const epoch = sessionEpoch;
      const zip = grant(zipToken, 'zip', epoch);
      const mod = await core();
      assertGrant(zip, epoch);
      const bytes = await readApprovedIdentity(zip.value, ZIP_SOURCE_MAX, '.zip');
      assertGrant(zip, epoch);
      return summary(mod.planExtraction(bytes, { conflict: 'rename' }));
    },
    extract: async (zipToken, destinationToken) => {
      const epoch = sessionEpoch;
      const zip = grant(zipToken, 'zip', epoch);
      const destination = grant(destinationToken, 'destination', epoch);
      const destinationPath = await safeDirectory(destination.value);
      assertGrant(destination, epoch);
      const mod = await core();
      assertGrant(zip, epoch);
      assertGrant(destination, epoch);
      const bytes = await readApprovedIdentity(zip.value, ZIP_SOURCE_MAX, '.zip');
      assertGrant(zip, epoch);
      assertGrant(destination, epoch);
      const assertActive = () => {
        assertGrant(zip, epoch);
        assertGrant(destination, epoch);
      };
      return summary(await mod.extractZipSafely(bytes, destinationPath, { conflict: 'rename', assertActive }));
    },
    create: async (filesToken) => {
      const epoch = sessionEpoch;
      const files = grant(filesToken, 'files', epoch);
      const inputs = files.value;
      if (!Array.isArray(inputs) || !inputs.length || inputs.length > CREATE_COUNT_MAX) throw new Error('文件选择授权已失效，请重新选择。');
      const mod = await core();
      assertGrant(files, epoch);
      let total = 0;
      const entries = [];
      for (const input of inputs) {
        const bytes = await readApprovedIdentity(input, CREATE_FILE_MAX);
        assertGrant(files, epoch);
        total += input.size;
        if (total > CREATE_TOTAL_MAX) throw new Error('所选文件超过 256 MiB 总大小限制。');
        entries.push({ name: path.basename(input.path), data: bytes });
      }
      const bytes = mod.createStoredZip(entries);
      assertGrant(files, epoch);
      const target = await save(api, { title: '保存 ZIP 压缩包', defaultPath: '压缩包.zip', filters: [{ name: 'ZIP 压缩包', extensions: ['zip'] }] });
      assertGrant(files, epoch);
      try {
        await fs.lstat(target);
        throw new Error('不能覆盖已有文件，请选择新的文件名。');
      } catch (error) {
        if (error && error.code !== 'ENOENT') throw error;
      }
      assertGrant(files, epoch);
      const temporary = path.join(path.dirname(target), `.archive-workbench-${randomBytes(12).toString('hex')}.tmp`);
      let temporaryIdentity;
      let linked = false;
      try {
        await fs.writeFile(temporary, bytes, { mode: 0o600, flag: 'wx' });
        assertGrant(files, epoch);
        temporaryIdentity = fileIdentity(temporary, await fs.lstat(temporary));
        assertGrant(files, epoch);
        await fs.link(temporary, target);
        linked = true;
        assertGrant(files, epoch);
        await fs.rm(temporary, { force: true });
        assertGrant(files, epoch);
      } catch (error) {
        if (linked && temporaryIdentity) {
          try {
            const output = fileIdentity(target, await fs.lstat(target));
            if (temporaryIdentity.dev === output.dev && temporaryIdentity.ino === output.ino) await fs.rm(target, { force: true });
          } catch {}
        }
        await fs.rm(temporary, { force: true }).catch(() => {});
        throw error;
      }
      return { path: target, entries: entries.length };
    },
    copyText: typeof api.copyText === 'function' ? (text) => api.copyText(String(text)) : undefined
  });
}

function attachArchiveWorkbench(target) {
  if (!target || (typeof target !== 'object' && typeof target !== 'function')) throw new TypeError('必须提供类似 window 的目标对象。');
  const api = target.ztools || {};
  const bridge = createBridge(api);
  Object.defineProperty(target, 'archiveWorkbench', { value: bridge, enumerable: true, configurable: true, writable: true });
  registerLifecycle(api);
  registerTools(target);
  return bridge;
}

if (typeof globalThis !== 'undefined') attachArchiveWorkbench(globalThis);

module.exports = {
  TOOL_NAMES,
  GRANT_TTL_MS,
  MCP_ZIP_SOURCE_MAX,
  MCP_MAX_OFFSET,
  MCP_MAX_LIMIT,
  MCP_RESPONSE_BYTES,
  readHandleBounded,
  validateObject,
  validateToolInput,
  inspectApprovedZipForMcp,
  planApprovedZipForMcp,
  registerTools,
  attachArchiveWorkbench,
  __testClearGrants: clearGrants,
  __testMcpMetrics: () => ({ ...mcpMetrics }),
  __testActiveZipIdentity: () => selected.get(activeZipToken)?.value || null
};
