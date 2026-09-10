'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const TOOL_NAMES = Object.freeze({ scan: 'scan_approved' });
const GRANT_TTL_MS = 5 * 60 * 1000;
const MCP_FINDING_LIMIT = 400;
const MCP_FEATURE_LIMIT = 200;
const MCP_RESPONSE_BYTES = 512 * 1024;
const FORBIDDEN_KEYS = new Set(['__proto__', 'prototype', 'constructor']);
const registeredHosts = new WeakSet();
let selectedRoot = null;
let guardPromise;
let sessionEpoch = 0;

function invalid(message) { return Object.assign(new TypeError(message), { code: 'INVALID_TOOL_INPUT' }); }
function approvalRequired() { return Object.assign(new Error('请先在插件安全体检界面中选择插件目录；授权仅保留五分钟。'), { code: 'WORKSPACE_APPROVAL_REQUIRED' }); }
function approvedDirectoryUnavailable() { return Object.assign(new Error('已授权的插件目录不可用，请在界面中重新选择。'), { code: 'APPROVED_DIRECTORY_UNAVAILABLE' }); }
function sessionExpired() { return Object.assign(new Error('插件会话已结束，请重新打开后选择插件目录。'), { code: 'SESSION_EXPIRED' }); }
function expireSession() { sessionEpoch += 1; selectedRoot = null; }

function selectedPath(result) {
  if (typeof result === 'string') return result;
  if (Array.isArray(result)) return result[0];
  return result && result.filePaths && result.filePaths[0];
}

function statValue(value) {
  if (typeof value === 'bigint') return value.toString();
  return Number.isFinite(value) ? String(value) : null;
}

function directoryIdentity(info) {
  return Object.freeze({
    dev: statValue(info.dev),
    ino: statValue(info.ino),
    birthtimeMs: statValue(info.birthtimeMs),
    ctimeMs: statValue(info.ctimeMs),
    mtimeMs: statValue(info.mtimeMs),
    mode: statValue(info.mode)
  });
}

function hasStableFileId(identity) {
  return identity.dev !== null && identity.ino !== null && identity.ino !== '0';
}

function sameDirectoryIdentity(left, right) {
  const stableFileId = hasStableFileId(left) && hasStableFileId(right);
  if (stableFileId && (left.dev !== right.dev || left.ino !== right.ino)) return false;
  const fallbackFields = ['birthtimeMs', 'ctimeMs', 'mtimeMs', 'mode'];
  if (!stableFileId && !fallbackFields.some((key) => left[key] !== null && left[key] !== '0')) return false;
  return fallbackFields.every((key) => left[key] === right[key]);
}

function realpathDirectory(directory) {
  const requested = path.resolve(String(directory));
  const requestedLink = fs.lstatSync(requested);
  if (requestedLink.isSymbolicLink() || !requestedLink.isDirectory()) throw new TypeError('请选择插件目录，而不是符号链接或文件。');
  const real = typeof fs.realpathSync.native === 'function' ? fs.realpathSync.native(requested) : fs.realpathSync(requested);
  const realLink = fs.lstatSync(real);
  const info = fs.statSync(real);
  if (realLink.isSymbolicLink() || !realLink.isDirectory() || !info.isDirectory()) throw new TypeError('请选择插件目录，而不是符号链接或文件。');
  const requestedIdentity = directoryIdentity(requestedLink);
  const realIdentity = directoryIdentity(realLink);
  const identity = directoryIdentity(info);
  if (!sameDirectoryIdentity(requestedIdentity, realIdentity) || !sameDirectoryIdentity(realIdentity, identity)) throw new Error('插件目录在验证授权时发生变化。');
  return { real, identity };
}

function createDirectoryGrant(directory, expires = Date.now() + GRANT_TTL_MS) {
  const captured = realpathDirectory(directory);
  return Object.freeze({ path: captured.real, real: captured.real, identity: captured.identity, expires, source: 'ui' });
}

function revokeGrant(grant) {
  if (!grant || selectedRoot === grant) selectedRoot = null;
}

function currentApprovedGrant() {
  if (!selectedRoot || selectedRoot.source !== 'ui' || selectedRoot.expires < Date.now()) {
    selectedRoot = null;
    throw approvalRequired();
  }
  return selectedRoot;
}

function verifyApprovedGrant(grant) {
  try {
    if (!grant || selectedRoot !== grant) throw new Error('已授权目录的授权信息发生变化。');
    const current = realpathDirectory(grant.path);
    if (current.real !== grant.real || !sameDirectoryIdentity(grant.identity, current.identity)) throw new Error('已授权目录的身份信息发生变化。');
    return current.real;
  } catch {
    revokeGrant(grant);
    throw approvedDirectoryUnavailable();
  }
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

function validateToolInput(input) {
  validateObject(input, new Set(['report', 'offset', 'limit']), '工具输入');
  if (input.report !== undefined && !['json', 'markdown', 'both'].includes(input.report)) throw invalid('report 必须是 json、markdown 或 both。');
  if (input.offset !== undefined && (!Number.isInteger(input.offset) || input.offset < 0 || input.offset > MCP_FINDING_LIMIT)) throw invalid(`offset 必须是 0 到 ${MCP_FINDING_LIMIT} 之间的整数。`);
  if (input.limit !== undefined && (!Number.isInteger(input.limit) || input.limit < 1 || input.limit > 200)) throw invalid('limit 必须是 1 到 200 之间的整数。');
  return { report: input.report || 'json', offset: input.offset || 0, limit: input.limit || 50 };
}

function loadGuard() {
  if (!guardPromise) {
    const packaged = path.join(__dirname, '..', 'core', 'guard.mjs');
    const corePath = fs.existsSync(packaged) ? packaged : path.join(__dirname, '..', 'src', 'core', 'guard.mjs');
    guardPromise = import(pathToFileURL(corePath).href);
  }
  return guardPromise;
}

function clip(value, max = 2048) {
  const text = String(value ?? '');
  if (Buffer.byteLength(text, 'utf8') <= max) return text;
  const suffix = '…[truncated]';
  const budget = Math.max(0, max - Buffer.byteLength(suffix, 'utf8'));
  const bytes = Buffer.from(text, 'utf8');
  let end = Math.min(budget, bytes.length);
  while (end > 0 && (bytes[end] & 0xc0) === 0x80) end -= 1;
  return `${bytes.subarray(0, end).toString('utf8')}${suffix}`;
}

function sanitizedText(value, sanitize) {
  return sanitize(String(value ?? ''));
}

function safeFinding(value, sanitize) {
  return { level: clip(sanitizedText(value?.level, sanitize), 32), code: clip(sanitizedText(value?.code, sanitize), 128), message: clip(sanitizedText(value?.message, sanitize), 512), ...(value?.file ? { file: clip(sanitizedText(value.file, sanitize), 512) } : {}) };
}

function sanitizeOutput(value, sanitize, ancestors = new WeakSet()) {
  if (typeof value === 'string') return sanitize(value);
  if (value === null || typeof value !== 'object') return value;
  if (ancestors.has(value)) return '[redacted]';
  ancestors.add(value);
  const output = Array.isArray(value) ? [] : Object.create(null);
  if (Array.isArray(value)) {
    for (const item of value) output.push(sanitizeOutput(item, sanitize, ancestors));
  } else {
    for (const [key, item] of Object.entries(value)) output[key] = sanitizeOutput(item, sanitize, ancestors);
  }
  ancestors.delete(value);
  return output;
}

function paginateReport(report, { offset, limit }, sanitize = (value) => String(value ?? '')) {
  const issues = Array.isArray(report.issues) ? report.issues : [];
  const risks = Array.isArray(report.risks) ? report.risks : [];
  const all = [...issues.map((value) => ({ kind: 'issue', value })), ...risks.map((value) => ({ kind: 'risk', value }))];
  const page = all.slice(offset, offset + limit);
  const pageIssues = page.filter((item) => item.kind === 'issue').map((item) => safeFinding(item.value, sanitize));
  const pageRisks = page.filter((item) => item.kind === 'risk').map((item) => safeFinding(item.value, sanitize));
  const featureList = Array.isArray(report.manifest?.features) ? report.manifest.features : [];
  const totalIssues = Number.isFinite(Number(report.findingTotals?.issues)) ? Number(report.findingTotals.issues) : issues.length;
  const totalRisks = Number.isFinite(Number(report.findingTotals?.risks)) ? Number(report.findingTotals.risks) : risks.length;
  const totalFindings = totalIssues + totalRisks;
  const totalFeatures = Number.isFinite(Number(report.manifestFeatureTotal)) ? Number(report.manifestFeatureTotal) : featureList.length;
  const json = {
    manifest: report.manifest ? { name: clip(sanitizedText(report.manifest.name, sanitize), 256), version: clip(sanitizedText(report.manifest.version, sanitize), 128), features: featureList.slice(0, 200).map((feature) => ({ code: clip(sanitizedText(feature?.code, sanitize), 128) })) } : null,
    files: Number(report.files) || 0,
    bytes: Number(report.bytes) || 0,
    scannedAt: clip(sanitizedText(report.scannedAt, sanitize), 64),
    issues: pageIssues,
    risks: pageRisks,
    totals: { issues: totalIssues, risks: totalRisks, findings: totalFindings, retainedFindings: all.length, features: totalFeatures },
    pagination: { offset, limit, returned: page.length, nextOffset: offset + page.length, hasMore: offset + page.length < all.length }
  };
  return json;
}

function serializedBytes(value) { return Buffer.byteLength(JSON.stringify(value), 'utf8'); }

function buildMcpResponse(report, options, core) {
  if (typeof core?.maskSecrets !== 'function') throw Object.assign(new Error('MCP 输出脱敏器不可用。'), { code: 'MCP_SANITIZER_UNAVAILABLE' });
  const sanitize = core.maskSecrets;
  const retainedFindings = (Array.isArray(report.issues) ? report.issues.length : 0) + (Array.isArray(report.risks) ? report.risks.length : 0);
  const requestedPageCount = Math.min(options.limit, Math.max(0, retainedFindings - options.offset));
  let effectiveLimit = requestedPageCount;
  while (true) {
    const json = paginateReport(report, { offset: options.offset, limit: effectiveLimit }, sanitize);
    const responseTruncated = json.pagination.returned < requestedPageCount;
    json.pagination = { ...json.pagination, requestedLimit: options.limit, requestedPageCount, responseTruncated };
    const markdown = core.toMarkdown({ scannedAt: json.scannedAt, files: json.files, bytes: json.bytes, issues: json.issues, risks: json.risks, findingTotals: { issues: json.totals.issues, risks: json.totals.risks, findings: json.totals.findings }, retainedFindings: json.pagination.returned, findingsTruncated: json.pagination.offset > 0 || json.pagination.hasMore });
    const meta = { totals: json.totals, pagination: json.pagination, responseTruncated };
    const response = options.report === 'markdown' ? { ...meta, markdown } : options.report === 'both' ? { ...meta, json, markdown } : { ...meta, json };
    const safeResponse = sanitizeOutput(response, sanitize);
    if (serializedBytes(safeResponse) <= MCP_RESPONSE_BYTES) return safeResponse;
    if (effectiveLimit <= 1) throw Object.assign(new Error('MCP 响应无法满足安全预算。'), { code: 'MCP_RESPONSE_TOO_LARGE' });
    effectiveLimit = Math.max(1, Math.floor(effectiveLimit / 2));
  }
}

async function scanGrantedDirectory(scanOptions) {
  let core, report, grant;
  try {
    grant = currentApprovedGrant();
    const root = verifyApprovedGrant(grant);
    core = await loadGuard();
    report = await core.scanPlugin(root, scanOptions);
    verifyApprovedGrant(grant);
  } catch (error) {
    if (error?.code === 'WORKSPACE_APPROVAL_REQUIRED' || error?.code === 'APPROVED_DIRECTORY_UNAVAILABLE') throw error;
    revokeGrant(grant);
    throw approvedDirectoryUnavailable();
  }
  return { core, report };
}

async function scanApprovedForMcp(input) {
  const options = validateToolInput(input);
  const { core, report } = await scanGrantedDirectory({ findingLimit: MCP_FINDING_LIMIT, manifestFeatureLimit: MCP_FEATURE_LIMIT });
  return buildMcpResponse(report, options, core);
}

function createBridge(api) {
  const bridge = {
    choosePluginDirectory: async () => {
      if (typeof api.showOpenDialog !== 'function') throw new Error('当前 ZTools 环境不提供目录选择对话框。');
      expireSession();
      const epoch = sessionEpoch;
      const result = selectedPath(await api.showOpenDialog({ title: '选择插件目录', properties: ['openDirectory'] }));
      if (epoch !== sessionEpoch) throw sessionExpired();
      if (!result) throw new Error('已取消选择。');
      const grant = createDirectoryGrant(result);
      if (epoch !== sessionEpoch) throw sessionExpired();
      selectedRoot = grant;
      return true;
    },
    scan: async () => {
      const { report } = await scanGrantedDirectory();
      const { root, ...safe } = report;
      return safe;
    },
    copyText: typeof api.copyText === 'function' ? (text) => api.copyText(String(text)) : undefined
  };
  return Object.freeze(bridge);
}

function registerTools(target) {
  const api = target?.ztools;
  if (!api || typeof api.registerTool !== 'function' || registeredHosts.has(api)) return false;
  let registered = false;
  try { api.registerTool.call(api, TOOL_NAMES.scan, scanApprovedForMcp); registered = true; } catch {}
  registeredHosts.add(api);
  return registered;
}

function attachPluginGuard(target) {
  if (!target || (typeof target !== 'object' && typeof target !== 'function')) throw new TypeError('需要一个类 window 目标。');
  const api = target.ztools || {};
  target.pluginGuard = createBridge(api);
  if (typeof api.onPluginOut === 'function') api.onPluginOut(expireSession);
  registerTools(target);
  return target.pluginGuard;
}

if (typeof globalThis !== 'undefined') attachPluginGuard(globalThis);

module.exports = {
  TOOL_NAMES,
  GRANT_TTL_MS,
  MCP_FINDING_LIMIT,
  MCP_RESPONSE_BYTES,
  validateToolInput,
  paginateReport,
  sanitizeOutput,
  buildMcpResponse,
  scanApprovedForMcp,
  registerTools,
  attachPluginGuard,
  __testGrant: (root, expires = Date.now() + GRANT_TTL_MS) => { selectedRoot = createDirectoryGrant(root, expires); },
  __testClear: expireSession
};
