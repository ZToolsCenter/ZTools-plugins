'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const MAX = 20 * 1024 * 1024;
const TTL = 300000;
const INLINE_BYTES = 512 * 1024;
const INLINE_TOTAL_BYTES = 768 * 1024;
const MAX_DETAIL_LIMIT = 50;
const MCP_RESPONSE_BYTES = 512 * 1024;
const TOOL_NAMES = Object.freeze({ inline: 'analyze_inline', approved: 'analyze_approved_files' });
const FORBIDDEN_KEYS = new Set(['__proto__', 'prototype', 'constructor']);
const CLOSE_RETRY_MS = 100;
const registeredHosts = new WeakSet();
let grants = [];
let pendingCloses = [];
let corePromise;
let sessionEpoch = 0;
let grantTimer;
let closeRetryTimer;
let timerEpoch = 0;
let grantTtl = TTL;
let closeSync = fs.closeSync;

function invalid(message) { return Object.assign(new TypeError(message), { code: 'INVALID_TOOL_INPUT' }); }
function approvalRequired(message = 'Select one or two HAR files in the HAR Doctor UI first.') { return Object.assign(new Error(message), { code: 'FILE_APPROVAL_REQUIRED' }); }
function sessionExpired() { return Object.assign(new Error('插件会话已结束，请重新打开后选择 HAR 文件。'), { code: 'SESSION_EXPIRED' }); }
function machineFailure(error, code, message) {
  if (['INVALID_TOOL_INPUT', 'FILE_APPROVAL_REQUIRED', 'MCP_RESPONSE_TOO_LARGE'].includes(error?.code)) return error;
  return Object.assign(new Error(message), { code });
}
function close(record) {
  if (!record || record.closed) return true;
  try {
    closeSync(record.fd);
    record.closed = true;
    return true;
  } catch (error) {
    // EBADF means another trusted cleanup path already released the descriptor.
    if (error?.code === 'EBADF') {
      record.closed = true;
      return true;
    }
    record.closeFailed = true;
    return false;
  }
}
function scheduleCloseRetry() {
  if (!pendingCloses.length || closeRetryTimer) return;
  closeRetryTimer = setTimeout(() => {
    closeRetryTimer = undefined;
    retryPendingCloses();
  }, CLOSE_RETRY_MS);
  closeRetryTimer.unref?.();
}
function retire(record) {
  if (!record) return;
  record.revoked = true;
  if (!close(record) && !pendingCloses.some((pending) => pending.fd === record.fd)) {
    // Keep only the descriptor required for retry.  Revoked authorization
    // paths and file metadata must not survive in the retry queue.
    pendingCloses.push({ fd: record.fd, closed: false, closeFailed: true });
    scheduleCloseRetry();
  }
}
function retryPendingCloses() {
  if (closeRetryTimer) clearTimeout(closeRetryTimer);
  closeRetryTimer = undefined;
  const active = pendingCloses;
  pendingCloses = [];
  for (const record of active) {
    if (!close(record)) pendingCloses.push(record);
  }
  scheduleCloseRetry();
}
function cancelExpiry() {
  timerEpoch += 1;
  if (grantTimer) clearTimeout(grantTimer);
  grantTimer = undefined;
}
function clear() {
  cancelExpiry();
  // A later grant replacement, TTL expiry, plugin-out, or explicit clear is
  // also an immediate retry opportunity; the timer remains a fallback only.
  retryPendingCloses();
  const active = grants;
  grants = [];
  for (const record of active) retire(record);
}
function scheduleExpiry() {
  cancelExpiry();
  if (!grants.length) return;
  const epoch = timerEpoch;
  const until = Math.min(...grants.map((record) => record.until));
  grantTimer = setTimeout(() => {
    if (epoch !== timerEpoch) return;
    clear();
  }, Math.max(0, until - Date.now()));
  grantTimer.unref?.();
}
function expireSession() { sessionEpoch += 1; clear(); }

function identity(stat) {
  return { size: stat.size, mtimeMs: stat.mtimeMs, ctimeMs: stat.ctimeMs, dev: stat.dev, ino: stat.ino };
}

function sameIdentity(left, right) {
  return left.size === right.size && left.mtimeMs === right.mtimeMs && left.ctimeMs === right.ctimeMs && left.dev === right.dev && left.ino === right.ino;
}

function verifyRecord(record) {
  const link = fs.lstatSync(record.real);
  if (link.isSymbolicLink()) throw Error('HAR 文件在选择后发生变化');
  const pathIdentity = identity(fs.statSync(record.real));
  const handleIdentity = identity(fs.fstatSync(record.fd));
  if (!sameIdentity(record, pathIdentity) || !sameIdentity(record, handleIdentity) || !sameIdentity(pathIdentity, handleIdentity)) throw Error('HAR 文件在选择后发生变化');
  return handleIdentity;
}

function meta(file) {
  const real = fs.realpathSync(file);
  const link = fs.lstatSync(file);
  const fd = fs.openSync(real, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW || 0));
  try {
    const stat = fs.fstatSync(fd);
    if (link.isSymbolicLink() || !stat.isFile() || stat.size > MAX || !/\.har$/i.test(real)) throw Error('HAR 文件不符合要求');
    const record = { real, fd, ...identity(stat), until: Date.now() + grantTtl, closed: false };
    verifyRecord(record);
    return record;
  } catch (error) {
    retire({ fd });
    throw error;
  }
}

function grant(files) {
  clear();
  if (!Array.isArray(files) || files.length < 1 || files.length > 2) throw Error('请选择一到两个 HAR 文件');
  const selected = [];
  try {
    for (const file of files) selected.push(meta(file));
    grants = selected;
    scheduleExpiry();
    return grants.map((item) => path.basename(item.real));
  } catch (error) {
    for (const item of selected) retire(item);
    throw error;
  }
}

function read(record) {
  if (record.revoked) throw approvalRequired();
  if (Date.now() > record.until) { clear(); throw Error('HAR 文件选择授权已过期'); }
  const before = verifyRecord(record);
  const output = Buffer.alloc(before.size);
  let offset = 0;
  while (offset < output.length) {
    const count = fs.readSync(record.fd, output, offset, output.length - offset, offset);
    if (!count) throw Error('HAR 文件读取不完整');
    offset += count;
  }
  verifyRecord(record);
  return output.toString('utf8');
}

function readGranted({ consume = true, human = false } = {}) {
  if (!grants.length) throw approvalRequired(human ? '请先在 HAR 医生界面中选择一到两个 HAR 文件。' : undefined);
  try { return grants.map(read); }
  catch (error) { clear(); throw error; }
  finally { if (consume) clear(); }
}

async function choose(ztools) {
  if (typeof ztools?.showOpenDialog !== 'function') throw Error('ZTools 文件选择对话框不可用');
  expireSession();
  const epoch = sessionEpoch;
  const result = await ztools.showOpenDialog({ title: '选择一到两个 HAR 文件', properties: ['openFile', 'multiSelections'], filters: [{ name: 'HAR 文件', extensions: ['har'] }] });
  if (epoch !== sessionEpoch) throw sessionExpired();
  const files = Array.isArray(result) ? result : result?.filePaths;
  if (!files?.length) { clear(); return []; }
  return grant(files);
}

function validateObject(value, allowed, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw invalid(`${label} 必须是对象。`);
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) throw invalid(`${label} 必须是普通对象。`);
  for (const key of Reflect.ownKeys(value)) {
    if (typeof key !== 'string' || FORBIDDEN_KEYS.has(key) || !allowed.has(key)) throw invalid(`${label} 包含不支持的字段。`);
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor || !Object.hasOwn(descriptor, 'value')) throw invalid(`${label} 只能包含数据字段。`);
  }
}

function detailLimit(value) {
  if (value === undefined) return 20;
  if (!Number.isInteger(value) || value < 1 || value > MAX_DETAIL_LIMIT) throw invalid('detailLimit 必须是 1 到 50 之间的整数。');
  return value;
}

function validateInlineInput(input) {
  validateObject(input, new Set(['har', 'compareHar', 'detailLimit']), '工具输入');
  if (typeof input.har !== 'string') throw invalid('har 必须是字符串。');
  if (input.compareHar !== undefined && typeof input.compareHar !== 'string') throw invalid('compareHar 必须是字符串。');
  const texts = [input.har, ...(input.compareHar === undefined ? [] : [input.compareHar])];
  const sizes = texts.map((text) => Buffer.byteLength(text, 'utf8'));
  if (sizes.some((size) => size > INLINE_BYTES)) throw invalid('每份内联 HAR 最多为 512 KiB UTF-8。');
  if (sizes.reduce((sum, size) => sum + size, 0) > INLINE_TOTAL_BYTES) throw invalid('内联 HAR 文本总量超过 MCP 请求预算。');
  return { texts, detailLimit: detailLimit(input.detailLimit) };
}

function validateApprovedInput(input) {
  validateObject(input, new Set(['detailLimit']), '工具输入');
  return { detailLimit: detailLimit(input.detailLimit) };
}

function loadCore() {
  if (!corePromise) {
    const packaged = path.join(__dirname, '..', 'core', 'analyze.js');
    const source = path.join(__dirname, '..', 'core', 'analyze.js').replace(`${path.sep}preload${path.sep}..${path.sep}core`, `${path.sep}core`);
    corePromise = import(pathToFileURL(fs.existsSync(packaged) ? packaged : source).href);
  }
  return corePromise;
}

function finite(value) { const number = Number(value); return Number.isFinite(number) ? number : 0; }
function clip(value, maximum = 1024) {
  const text = String(value ?? '');
  if (Buffer.byteLength(text, 'utf8') <= maximum) return text;
  const suffix = '…[truncated]';
  const budget = Math.max(0, maximum - Buffer.byteLength(suffix, 'utf8'));
  const bytes = Buffer.from(text, 'utf8');
  let end = Math.min(budget, bytes.length);
  while (end > 0 && (bytes[end] & 0xc0) === 0x80) end -= 1;
  return `${bytes.subarray(0, end).toString('utf8')}${suffix}`;
}

function boundValue(value, core, state = { nodes: 0 }, depth = 0) {
  if (++state.nodes > 5000 || depth > 16) return '[truncated]';
  const redacted = core.redact(value);
  if (typeof redacted === 'string') return clip(redacted);
  if (redacted === null || typeof redacted !== 'object') return redacted;
  if (Array.isArray(redacted)) return redacted.slice(0, 64).map((item) => boundValue(item, core, state, depth + 1));
  const output = Object.create(null);
  for (const [key, item] of Object.entries(redacted).slice(0, 64)) {
    Object.defineProperty(output, clip(key, 128), { value: boundValue(item, core, state, depth + 1), enumerable: true, configurable: true, writable: true });
  }
  return output;
}

function topCounts(values, limit, core) {
  return Object.entries(values || {})
    .sort((left, right) => finite(right[1]) - finite(left[1]) || String(left[0]).localeCompare(String(right[0])))
    .slice(0, limit)
    .map(([name, count]) => ({ name: clip(core.redact(name), 512), count: finite(count) }));
}

function boundedReport(report, limit, core) {
  const detailKeys = ['slow', 'errors', 'redirects', 'cache', 'cors', 'security'];
  const details = Object.create(null);
  const truncated = Object.create(null);
  const totals = Object.create(null);
  for (const key of detailKeys) {
    const list = Array.isArray(report[key]) ? report[key] : [];
    totals[key] = list.length;
    truncated[key] = list.length > limit;
    details[key] = list.slice(0, limit).map((item) => boundValue(item, core));
  }
  const domainNames = Object.keys(report.domains || {});
  const typeNames = Object.keys(report.types || {});
  totals.domains = domainNames.length;
  totals.types = typeNames.length;
  return {
    metrics: { entries: finite(report.entries), totalMs: finite(report.totalMs), transferredBytes: finite(report.transferredBytes), duplicateBytes: finite(report.duplicateBytes), invalidUrls: finite(report.invalidUrls) },
    totals,
    domains: topCounts(report.domains, limit, core),
    types: topCounts(report.types, limit, core),
    details,
    truncation: { detailLimit: limit, ...truncated, domains: domainNames.length > limit, types: typeNames.length > limit }
  };
}

async function analyzeTexts(texts, limit) {
  if (!Array.isArray(texts) || texts.length < 1 || texts.length > 2) throw invalid('需要一到两份 HAR 文档。');
  const core = await loadCore();
  const rawReports = texts.map((text) => core.analyze(core.parseHar(text)));
  const diff = rawReports[1] ? core.diffReports(rawReports[0], rawReports[1]) : undefined;
  const markdown = clip(core.redact(core.toMarkdown(rawReports[0], diff)), 8192);
  let effectiveLimit = limit;
  while (true) {
    const response = { reports: rawReports.map((report) => boundedReport(report, effectiveLimit, core)), ...(diff ? { diff: boundValue(diff, core) } : {}), markdown, requestedDetailLimit: limit, detailLimit: effectiveLimit, responseTruncated: effectiveLimit < limit };
    if (Buffer.byteLength(JSON.stringify(response), 'utf8') <= MCP_RESPONSE_BYTES) return response;
    if (effectiveLimit === 0) throw Object.assign(new Error('MCP response exceeds the safe output budget.'), { code: 'MCP_RESPONSE_TOO_LARGE' });
    effectiveLimit = Math.floor(effectiveLimit / 2);
  }
}

async function analyzeInlineForMcp(input) {
  const value = validateInlineInput(input);
  try { return await analyzeTexts(value.texts, value.detailLimit); }
  catch (error) { throw machineFailure(error, 'HAR_ANALYSIS_FAILED', 'HAR analysis failed.'); }
}

async function analyzeApprovedForMcp(input) {
  const value = validateApprovedInput(input);
  try { return await analyzeTexts(readGranted(), value.detailLimit); }
  catch (error) { throw machineFailure(error, 'APPROVED_HAR_FAILED', 'Approved HAR analysis failed.'); }
}

function registerTools(ztools) {
  if (!ztools || typeof ztools.registerTool !== 'function' || registeredHosts.has(ztools)) return false;
  let registered = false;
  for (const [name, handler] of [[TOOL_NAMES.inline, analyzeInlineForMcp], [TOOL_NAMES.approved, analyzeApprovedForMcp]]) {
    try { ztools.registerTool.call(ztools, name, handler); registered = true; } catch {}
  }
  registeredHosts.add(ztools);
  return registered;
}

function bridge(ztools) {
  if (typeof ztools?.onPluginOut === 'function') ztools.onPluginOut(expireSession);
  registerTools(ztools);
  return Object.freeze({ choose: () => choose(ztools), previewGranted: () => readGranted({ consume: false, human: true }), copyText: (text) => ztools?.copyText?.(String(text)) });
}

function attachHarDoctor(target) {
  if (!target || (typeof target !== 'object' && typeof target !== 'function')) throw new TypeError('需要一个类 window 目标。');
  target.harDoctor = bridge(target.ztools);
  return target.harDoctor;
}

if (typeof window !== 'undefined') attachHarDoctor(window);

module.exports = {
  TOOL_NAMES,
  INLINE_BYTES,
  MCP_RESPONSE_BYTES,
  bridge,
  attachHarDoctor,
  registerTools,
  validateInlineInput,
  validateApprovedInput,
  boundedReport,
  analyzeTexts,
  analyzeInlineForMcp,
  analyzeApprovedForMcp,
  __testGrant: grant,
  __testClear: clear,
  __testGrants: () => grants,
  __testPendingCloses: () => pendingCloses,
  __testRetryPendingCloses: retryPendingCloses,
  __testSetCloseSync: (value) => {
    if (typeof value !== 'function') throw new TypeError('测试 closeSync 必须是函数。');
    closeSync = value;
  },
  __testResetCloseSync: () => { closeSync = fs.closeSync; },
  __testSetGrantTtl: (value) => {
    if (!Number.isInteger(value) || value < 1) throw new TypeError('测试授权时长必须为正整数。');
    grantTtl = value;
  },
  __testResetGrantTtl: () => { grantTtl = TTL; },
  __testHasGrantTimer: () => Boolean(grantTimer),
  readGranted
};
