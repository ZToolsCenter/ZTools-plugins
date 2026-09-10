/* ZTools preload: CommonJS, intentionally readable and dependency-light. */
'use strict';

const { WebhookServer, hmac, curlFor, preview } = require('../core/server.cjs');
let owner = null;
const TOOL_NAMES = Object.freeze({ hmac: 'hmac', preview: 'preview_payload' });
const MCP_BODY_BYTES = 256 * 1024;
const MCP_SECRET_BYTES = 8192;
const MCP_CONTENT_TYPE_BYTES = 256;
const MCP_RESPONSE_BYTES = 64 * 1024;
const FORBIDDEN_KEYS = new Set(['__proto__', 'prototype', 'constructor']);
const registeredHosts = new WeakSet();
const lifecycleHosts = new WeakSet();
const SENSITIVE = /authorization|cookie|token|secret|api[-_]?key|password|signature|credential|(^|[-_])sig(nature)?($|[-_])/i;
const KNOWN_TOKEN = /(?:github_pat_[A-Za-z0-9_]{10,}|gh[pousr]_[A-Za-z0-9]{16,}|sk-(?:proj-)?[A-Za-z0-9_-]{16,}|(?:AKIA|ASIA)[A-Z0-9]{16})/g;
const PRIVATE_KEY = /-----BEGIN ([A-Z0-9 ]*PRIVATE KEY)-----[\s\S]*?(?:-----END \1-----|$)/g;
const RESERVED_OUTPUT_KEY = '[reserved-key]';

function invalid(message) {
  return Object.assign(new TypeError(message), { code: 'INVALID_TOOL_INPUT' });
}

function validateObject(value, allowed, label = '工具输入') {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw invalid(`${label}必须是对象。`);
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) throw invalid(`${label}使用了不支持的原型。`);
  for (const key of Reflect.ownKeys(value)) {
    if (typeof key !== 'string' || FORBIDDEN_KEYS.has(key) || !allowed.has(key)) throw invalid(`${label}包含不支持的字段。`);
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor || !Object.hasOwn(descriptor, 'value')) throw invalid(`${label}只能包含数据字段。`);
  }
}

function utf8(value, field, maxBytes, required = true) {
  if (value === undefined && !required) return '';
  if (typeof value !== 'string') throw invalid(`${field} 必须是字符串。`);
  if (Buffer.byteLength(value, 'utf8') > maxBytes) throw invalid(`${field} 超过 UTF-8 字节限制。`);
  return value;
}

function own(value, key) {
  return Object.hasOwn(value, key) ? value[key] : undefined;
}

function validateHmacInput(input) {
  validateObject(input, new Set(['body', 'secret', 'algorithm']));
  const algorithmValue = own(input, 'algorithm');
  const algorithm = algorithmValue === undefined ? 'sha256' : algorithmValue;
  if (algorithm !== 'sha256' && algorithm !== 'sha512') throw invalid('algorithm 必须是 sha256 或 sha512。');
  return {
    body: utf8(own(input, 'body'), 'body', MCP_BODY_BYTES),
    secret: utf8(own(input, 'secret'), 'secret', MCP_SECRET_BYTES),
    algorithm
  };
}

function validatePreviewInput(input) {
  validateObject(input, new Set(['body', 'contentType']));
  return {
    body: utf8(own(input, 'body'), 'body', MCP_BODY_BYTES),
    contentType: utf8(own(input, 'contentType'), 'contentType', MCP_CONTENT_TYPE_BYTES, false)
  };
}

function safeOptions(input = {}) {
  const port = Number(input.port), options = {};
  if (Number.isInteger(port) && port >= 0 && port <= 65535) options.port = port;
  return options;
}
function assign(target, key, value) { Object.defineProperty(target, key, { value, enumerable: true, configurable: true, writable: true }); }
function redactString(value) {
  return value
    .replace(PRIVATE_KEY, '[redacted-private-key]')
    .replace(KNOWN_TOKEN, '[redacted]')
    .replace(/\b(?:bearer|basic)\s+[A-Za-z0-9._~+/=-]{6,}/gi, '[redacted]')
    .replace(/\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g, '[redacted]')
    .replace(/(^|[^A-Za-z0-9])(token|secret|password|api[_ -]?key|authorization|signature|credential|aws[_ -]?secret[_ -]?access[_ -]?key)\s*([=:])\s*[^\s&#,;]+/gi, '$1$2$3[redacted]')
    .replace(/([?&](?:token|secret|password|api[_-]?key|authorization|signature|credential|aws[_-]?secret[_-]?access[_-]?key)=)[^&#\s]*/gi, '$1[redacted]')
    .slice(0, 4096);
}
function sanitizedOutputKey(key) {
  const sanitized = redactString(key);
  return FORBIDDEN_KEYS.has(sanitized) ? RESERVED_OUTPUT_KEY : sanitized;
}
function allocateOutputKey(key, allocated) {
  const base = sanitizedOutputKey(key);
  let candidate = base;
  for (let suffix = 2; allocated.has(candidate); suffix += 1) candidate = `${base}#${suffix}`;
  allocated.add(candidate);
  return candidate;
}
function redact(value) {
  const root = { value: null }, queue = [{ source: value, target: root, key: 'value', depth: 0, sensitive: false }];
  let nodes = 0;
  while (queue.length) {
    const item = queue.pop();
    const inheritedSensitive = item.sensitive;
    if (inheritedSensitive) { assign(item.target, item.key, '[redacted]'); continue; }
    if (item.source === null || typeof item.source !== 'object') { assign(item.target, item.key, typeof item.source === 'string' ? redactString(item.source) : item.source); continue; }
    if (++nodes > 2000 || item.depth > 48) { assign(item.target, item.key, '[truncated]'); continue; }
    const nameDescriptor = Object.getOwnPropertyDescriptor(item.source, 'name');
    const sourceName = nameDescriptor && Object.hasOwn(nameDescriptor, 'value') ? nameDescriptor.value : undefined;
    const namedSecret = typeof sourceName === 'string' && SENSITIVE.test(sourceName);
    const copy = Array.isArray(item.source) ? [] : Object.create(null);
    assign(item.target, item.key, copy);
    const allocated = new Set();
    for (const key of Object.keys(item.source)) {
      const descriptor = Object.getOwnPropertyDescriptor(item.source, key);
      const outputKey = allocateOutputKey(key, allocated);
      if (!descriptor || !Object.hasOwn(descriptor, 'value')) {
        assign(copy, outputKey, '[redacted]');
        continue;
      }
      queue.push({ source: descriptor.value, target: copy, key: outputKey, depth: item.depth + 1, sensitive: namedSecret || SENSITIVE.test(key) });
    }
  }
  return root.value;
}

function encodedBytes(value) {
  return Buffer.byteLength(JSON.stringify(value), 'utf8');
}

function hmacForMcp(input) {
  const value = validateHmacInput(input);
  return {
    algorithm: value.algorithm,
    digest: hmac(value.body, value.secret, value.algorithm),
    bodyBytes: Buffer.byteLength(value.body, 'utf8')
  };
}

function previewForMcp(input) {
  const value = validatePreviewInput(input);
  const body = Buffer.from(value.body, 'utf8');
  const result = redact(preview(body, value.contentType));
  const response = {
    kind: result && ['json', 'form', 'text'].includes(result.kind) ? result.kind : 'text',
    value: result?.value,
    truncated: Boolean(result?.truncated),
    bodyBytes: body.length,
    outputLimitBytes: MCP_RESPONSE_BYTES
  };
  if (encodedBytes(response) <= MCP_RESPONSE_BYTES) return response;
  return {
    kind: response.kind,
    value: '[preview omitted: redacted output exceeds 64 KiB]',
    truncated: true,
    bodyBytes: body.length,
    outputLimitBytes: MCP_RESPONSE_BYTES
  };
}

function safeEvents() { return redact((owner?.events || []).slice(0, 200)); }
function registerLifecycle(ztools) {
  if (!ztools || (typeof ztools !== 'object' && typeof ztools !== 'function') || lifecycleHosts.has(ztools)) return false;
  const stop = async () => { const current = owner; owner = null; current?.clear(); await current?.stop(); };
  try {
    if (typeof ztools.onPluginOut === 'function') ztools.onPluginOut(stop);
    else if (typeof ztools.onPluginExit === 'function') ztools.onPluginExit(stop);
  } catch {}
  lifecycleHosts.add(ztools);
  return true;
}
function registerTools(target) {
  const ztools = target?.ztools;
  if (!ztools || typeof ztools.registerTool !== 'function' || registeredHosts.has(ztools)) return Object.freeze([]);
  const registered = [];
  for (const [name, handler] of [[TOOL_NAMES.hmac, hmacForMcp], [TOOL_NAMES.preview, previewForMcp]]) {
    try { ztools.registerTool.call(ztools, name, handler); registered.push(name); } catch {}
  }
  registeredHosts.add(ztools);
  return Object.freeze(registered);
}
function bridge(ztools) {
  registerLifecycle(ztools);
  return Object.freeze({
    start: async (options) => { const next = safeOptions(options); if (!owner) owner = new WebhookServer(next); else if (Object.hasOwn(next, 'port') && owner.options.port !== next.port) await owner.restart(next); return owner.start(); },
    stop: async () => { const current = owner; owner = null; await current?.stop(); },
    events: safeEvents,
    hmac: (body, secret, algorithm) => hmac(body, secret, algorithm),
    curl: (url) => curlFor(url, process.platform),
    copyText: (text) => ztools?.copyText?.(String(text))
  });
}
function attachWebhookLab(target) {
  if (!target || (typeof target !== 'object' && typeof target !== 'function')) throw new TypeError('需要一个类似 window 的挂载目标。');
  const value = bridge(target.ztools || {});
  Object.defineProperty(target, 'webhookLab', { value, enumerable: true, configurable: true, writable: true });
  registerTools(target);
  return value;
}
if (typeof globalThis !== 'undefined') attachWebhookLab(globalThis);
module.exports = {
  TOOL_NAMES,
  MCP_BODY_BYTES,
  MCP_SECRET_BYTES,
  MCP_CONTENT_TYPE_BYTES,
  MCP_RESPONSE_BYTES,
  validateObject,
  validateHmacInput,
  validatePreviewInput,
  redact,
  hmacForMcp,
  previewForMcp,
  registerTools,
  attachWebhookLab,
  bridge,
  __testOwner: () => owner,
  __testSetOwner: (next) => { owner = next; }
};
