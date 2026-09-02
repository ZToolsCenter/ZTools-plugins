'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { TextDecoder } = require('node:util');

const TOOL_NAMES = Object.freeze({ detect: 'detect_text', redact: 'redact_text' });
const RULE_NAMES = Object.freeze(['email', 'phone_cn', 'ipv4', 'win_path', 'posix_path', 'bearer', 'api_key', 'jwt', 'id_cn']);
const RULE_SET = new Set(RULE_NAMES);
const FORBIDDEN_KEYS = new Set(['__proto__', 'prototype', 'constructor']);
const MCP_TEXT_BYTES = 512 * 1024;
const MCP_REDACT_TEXT_BYTES = 448 * 1024;
const MCP_INPUT_BYTES = 768 * 1024;
const MCP_RESPONSE_BYTES = 512 * 1024;
const MCP_FINDING_LIMIT = 500;
const MAX_WHITELIST = 200;
const MAX_WHITELIST_ITEM_BYTES = 4096;
const MAX_WHITELIST_BYTES = 64 * 1024;
const ENTRY_TEXT_BYTES = 1024 * 1024;
const ENTRY_IMAGE_BYTES = 20 * 1024 * 1024;
const ENTRY_TEXT_EXTENSIONS = new Set(['.txt', '.md', '.json', '.log']);
const ENTRY_IMAGE_TYPES = new Map([
  ['.png', 'image/png'],
  ['.jpg', 'image/jpeg'],
  ['.jpeg', 'image/jpeg'],
  ['.webp', 'image/webp']
]);
const registeredHosts = new WeakSet();
const entryRelays = new WeakMap();
let corePromise;

function invalid(message) {
  return Object.assign(new TypeError(message), { code: 'INVALID_TOOL_INPUT' });
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

function validateText(value, maxBytes) {
  if (typeof value !== 'string') throw invalid('text 必须是字符串。');
  if (Buffer.byteLength(value, 'utf8') > maxBytes) throw invalid(`text 超过 ${maxBytes / 1024} KiB 的 MCP 上限。`);
  return value;
}

function validateWhitelist(value) {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > MAX_WHITELIST) throw invalid('whitelist 最多只能包含 200 个字符串。');
  let totalBytes = 0;
  for (const item of value) {
    if (typeof item !== 'string' || Buffer.byteLength(item, 'utf8') > MAX_WHITELIST_ITEM_BYTES) throw invalid('whitelist 包含无效值。');
    totalBytes += Buffer.byteLength(item, 'utf8');
  }
  if (totalBytes > MAX_WHITELIST_BYTES) throw invalid('whitelist 超过 64 KiB 的 MCP 上限。');
  return value.slice();
}

function validateEnabled(value) {
  if (value === undefined) return undefined;
  validateObject(value, RULE_SET, 'enabled');
  const enabled = {};
  for (const key of Object.keys(value)) {
    if (typeof value[key] !== 'boolean') throw invalid(`enabled.${key} 必须是布尔值。`);
    enabled[key] = value[key];
  }
  return enabled;
}

function validateInput(input, allowReplacement) {
  const allowed = new Set(['text', 'whitelist', 'enabled', ...(allowReplacement ? ['replacement'] : [])]);
  validateObject(input, allowed, '工具输入');
  const output = { text: validateText(input.text, allowReplacement ? MCP_REDACT_TEXT_BYTES : MCP_TEXT_BYTES), whitelist: validateWhitelist(input.whitelist), enabled: validateEnabled(input.enabled) };
  if (allowReplacement && input.replacement !== undefined) {
    if (typeof input.replacement !== 'string' || Array.from(input.replacement).length > 64) throw invalid('replacement 必须是不超过 64 个字符的字符串。');
    output.replacement = input.replacement;
  }
  if (Buffer.byteLength(JSON.stringify(output), 'utf8') > MCP_INPUT_BYTES) throw invalid('工具输入超过 768 KiB 的 MCP 序列化上限。');
  return output;
}

function loadCore() {
  if (!corePromise) {
    const packaged = path.join(__dirname, '..', 'core', 'sanitize.mjs');
    const corePath = fs.existsSync(packaged) ? packaged : path.join(__dirname, '..', 'src', 'core', 'sanitize.mjs');
    corePromise = import(pathToFileURL(corePath).href);
  }
  return corePromise;
}

function safeFindings(findings, metadata = {}) {
  const selected = findings.slice(0, MCP_FINDING_LIMIT);
  const byType = Object.create(null);
  const safe = selected.map(({ type, start, end, confidence }) => {
    byType[type] = (byType[type] || 0) + 1;
    return { type, start, end, confidence };
  });
  const hasTotal = Object.hasOwn(metadata, 'total');
  const total = hasTotal ? metadata.total : findings.length;
  const truncated = Boolean(metadata.truncated || findings.length > safe.length);
  const counts = { total, returned: safe.length, byType };
  if (total === null) counts.totalAtLeast = Number.isSafeInteger(metadata.totalAtLeast) ? metadata.totalAtLeast : safe.length;
  return { findings: safe, counts, truncated };
}

function enforceResponseBudget(result) {
  let serialized;
  try { serialized = JSON.stringify(result); } catch { throw invalid('工具响应无法安全序列化。'); }
  if (Buffer.byteLength(serialized, 'utf8') > MCP_RESPONSE_BYTES) throw invalid('工具响应超过 512 KiB 的 MCP 上限；请缩短 text 或 replacement。');
  return result;
}

async function detectForMcp(input) {
  const value = validateInput(input, false);
  const { inspectSensitive } = await loadCore();
  const result = inspectSensitive(value.text, { whitelist: value.whitelist, enabled: value.enabled, maxFindings: MCP_FINDING_LIMIT });
  return enforceResponseBudget(safeFindings(result.findings, result));
}

async function redactForMcp(input) {
  const value = validateInput(input, true);
  const { redactText } = await loadCore();
  let result;
  try {
    result = redactText(value.text, { whitelist: value.whitelist, enabled: value.enabled, ...(value.replacement === undefined ? {} : { replacement: value.replacement }) });
  } catch (error) {
    if (error instanceof RangeError) throw invalid(error.message);
    throw error;
  }
  return enforceResponseBudget({ text: result.text, ...safeFindings(result.findings, result) });
}

function isPlainObject(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function validateImageDataUrl(value) {
  if (typeof value !== 'string') throw invalid('图片入口必须是 data URL。');
  const match = /^data:(image\/(?:png|jpeg|webp));base64,([A-Za-z0-9+/]*={0,2})$/i.exec(value);
  if (!match) throw invalid('图片入口必须是 PNG、JPEG 或 WebP 的 data URL。');
  if (match[2].length > Math.ceil(ENTRY_IMAGE_BYTES / 3) * 4 + 4) throw invalid('图片入口超过 20 MiB 上限。');
  const bytes = Buffer.from(match[2], 'base64');
  if (bytes.length === 0 || bytes.length > ENTRY_IMAGE_BYTES) throw invalid('图片入口超过 20 MiB 上限。');
  if (!matchesImageSignature(bytes, match[1].toLowerCase())) throw invalid('图片数据与声明的类型不匹配。');
  return value;
}

function matchesImageSignature(buffer, mime) {
  if (mime === 'image/png') return buffer.length >= 8 && buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  if (mime === 'image/jpeg') return buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff;
  return buffer.length >= 12 && buffer.subarray(0, 4).toString('ascii') === 'RIFF' && buffer.subarray(8, 12).toString('ascii') === 'WEBP';
}

function fileSnapshotMatches(left, right) {
  if (!left || !right || !left.isFile() || !right.isFile()) return false;
  return ['dev', 'ino', 'size', 'mtimeMs', 'ctimeMs'].every((key) => Object.is(left[key], right[key]));
}

async function readHandleBounded(handle, limit) {
  if (!Number.isSafeInteger(limit) || limit < 0) throw invalid('文件读取上限无效。');
  const buffer = Buffer.allocUnsafe(limit + 1);
  let offset = 0;
  while (offset < buffer.length) {
    const { bytesRead } = await handle.read(buffer, offset, buffer.length - offset, null);
    if (bytesRead === 0) break;
    offset += bytesRead;
  }
  if (offset > limit) throw invalid('所选文件超过大小上限。');
  return buffer.subarray(0, offset);
}

async function readHostSelectedFile(file) {
  if (!isPlainObject(file) || file.isFile !== true || file.isDirectory === true) throw invalid('所选入口必须是文件。');
  if (typeof file.path !== 'string' || file.path.length === 0 || file.path.length > 4096 || file.path.includes('\0') || !path.isAbsolute(file.path)) throw invalid('所选文件路径无效。');
  if (typeof file.name !== 'string' || file.name.length === 0 || file.name.length > 512 || path.basename(file.path) !== file.name) throw invalid('所选文件名无效。');
  const extension = path.extname(file.name).toLowerCase();
  const mime = ENTRY_IMAGE_TYPES.get(extension);
  if (!mime && !ENTRY_TEXT_EXTENSIONS.has(extension)) throw invalid('不支持所选文件类型。');
  const limit = mime ? ENTRY_IMAGE_BYTES : ENTRY_TEXT_BYTES;
  const before = await fs.promises.lstat(file.path);
  if (!before.isFile() || before.isSymbolicLink() || before.size > limit) throw invalid('所选文件不可用或过大。');
  const noFollow = Number.isInteger(fs.constants.O_NOFOLLOW) ? fs.constants.O_NOFOLLOW : 0;
  let handle;
  let content;
  let opened;
  let openedAfter;
  try {
    handle = await fs.promises.open(file.path, fs.constants.O_RDONLY | noFollow);
    opened = await handle.stat();
    if (!fileSnapshotMatches(before, opened) || opened.size > limit) throw invalid('所选文件在读取前已发生变化。');
    content = await readHandleBounded(handle, limit);
    openedAfter = await handle.stat();
  } finally {
    await handle?.close();
  }
  const after = await fs.promises.lstat(file.path);
  if (after.isSymbolicLink() || !fileSnapshotMatches(opened, openedAfter) || !fileSnapshotMatches(openedAfter, after) || content.length > limit) throw invalid('所选文件在读取过程中发生变化。');
  if (mime) {
    if (!matchesImageSignature(content, mime)) throw invalid('所选图片的文件签名与扩展名不匹配。');
    return { kind: 'image', dataUrl: `data:${mime};base64,${content.toString('base64')}` };
  }
  return { kind: 'text', text: new TextDecoder('utf-8', { fatal: true }).decode(content) };
}

async function consumeHostEntry(action) {
  if (!isPlainObject(action)) throw invalid('插件入口参数无效。');
  if (action.type === 'over') {
    if (typeof action.payload !== 'string' || Buffer.byteLength(action.payload, 'utf8') > ENTRY_TEXT_BYTES) throw invalid('所选文本超过 1 MiB 上限。');
    return { kind: 'text', text: action.payload };
  }
  if (action.type === 'img') return { kind: 'image', dataUrl: validateImageDataUrl(action.payload) };
  if (action.type === 'files') {
    if (!Array.isArray(action.payload) || action.payload.length !== 1) throw invalid('必须且只能选择一个文件。');
    return readHostSelectedFile(action.payload[0]);
  }
  return null;
}

function createEntryRelay(api) {
  // ZTools lifecycle hooks return void.  A preload can outlive individual
  // plugin visits, so subscribe exactly once here rather than treating their
  // return values as disposers or subscribing again after every `out` event.
  const state = { callback: null, pending: null, token: 0 };
  const deliver = (entry, token = state.token) => {
    if (!entry || token !== state.token) return;
    if (!state.callback) { state.pending = entry; return; }
    try { state.callback(entry); } catch {}
  };
  const clearForExit = () => {
    state.token += 1;
    state.pending = null;
    // Keeping a callback that has no sensitive state is safe and lets a
    // persistent renderer receive later entries without a second host hook.
    try { state.callback?.({ kind: 'reset' }); } catch {}
  };
  if (typeof api.onPluginEnter === 'function') {
    try {
      api.onPluginEnter((action) => {
        const token = state.token;
        Promise.resolve(consumeHostEntry(action)).then(
          (entry) => deliver(entry, token),
          () => deliver({ kind: 'error', message: '无法安全载入插件入口数据。' }, token)
        );
      });
    } catch {}
  }
  if (typeof api.onPluginOut === 'function') {
    try { api.onPluginOut(clearForExit); } catch {}
  }
  return (next) => {
    if (typeof next !== 'function') throw new TypeError('入口回调必须是函数。');
    state.callback = next;
    if (state.pending) {
      const entry = state.pending;
      state.pending = null;
      const token = state.token;
      queueMicrotask(() => deliver(entry, token));
    }
    return () => { if (state.callback === next) state.callback = null; };
  };
}

function registerTools(target) {
  const api = target?.ztools;
  if (!api || typeof api.registerTool !== 'function' || registeredHosts.has(api)) return false;
  let registered = false;
  for (const [name, handler] of [[TOOL_NAMES.detect, detectForMcp], [TOOL_NAMES.redact, redactForMcp]]) {
    try { api.registerTool.call(api, name, handler); registered = true; } catch {}
  }
  registeredHosts.add(api);
  return registered;
}

function attachShareSanitizer(target) {
  if (!target || (typeof target !== 'object' && typeof target !== 'function')) throw new TypeError('需要一个类 window 目标。');
  const api = target.ztools || {};
  let onEntry = entryRelays.get(api);
  if (!onEntry) {
    onEntry = createEntryRelay(api);
    if (api && (typeof api === 'object' || typeof api === 'function')) entryRelays.set(api, onEntry);
  }
  const bridge = {};
  if (typeof api.copyText === 'function') bridge.copyText = (text) => api.copyText(String(text));
  if (typeof api.copyImage === 'function') bridge.copyImage = (dataUrl) => api.copyImage(String(dataUrl));
  bridge.onEntry = onEntry;
  target.shareSanitizer = Object.freeze(bridge);
  registerTools(target);
  return target.shareSanitizer;
}

if (typeof globalThis !== 'undefined') attachShareSanitizer(globalThis);

module.exports = { TOOL_NAMES, MCP_TEXT_BYTES, MCP_REDACT_TEXT_BYTES, MCP_INPUT_BYTES, MCP_RESPONSE_BYTES, MCP_FINDING_LIMIT, MAX_WHITELIST_BYTES, ENTRY_TEXT_BYTES, ENTRY_IMAGE_BYTES, validateInput, safeFindings, enforceResponseBudget, validateImageDataUrl, fileSnapshotMatches, readHandleBounded, readHostSelectedFile, consumeHostEntry, detectForMcp, redactForMcp, registerTools, attachShareSanitizer };
