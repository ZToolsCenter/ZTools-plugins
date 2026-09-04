const SENSITIVE = /authorization|cookie|set-cookie|token|access_token|session|secret|api[-_]?key|password|signature|sign/i;
const SECRET_VALUE = /\bBearer\s+[A-Za-z0-9._~+\/-]{8,}|\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b|\b(?:api[_-]?key|token|secret|password|signature)\s*[:=]\s*['"]?(?!(?:\[redacted\]|%5Bredacted%5D)(?:['"]|$|[&#\s]))[^\s,'";]{6,}/gi;
const PREFIXED_SECRETS = [
  /github_pat_[A-Za-z0-9_]{20,}/gi,
  /gh[pousr]_[A-Za-z0-9_]{20,}/gi,
  /sk-(?:proj-)?[A-Za-z0-9_-]{16,}/gi,
  /(?:AKIA|ASIA)[A-Z0-9]{16}/gi
];
const PEM_PATH_MARKER = /-----(BEGIN|END) ((?:(?:RSA|EC|DSA|OPENSSH|ENCRYPTED) )?PRIVATE KEY)-----/gi;
const RESERVED_KEYS = new Set(['__proto__', 'constructor', 'prototype']);
const MAX_BYTES = 20 * 1024 * 1024;
const MAX_ENTRIES = 5000;
const SAFE_METHODS = new Set(['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS', 'TRACE', 'CONNECT']);
const SAFE_MIME_TYPES = new Set([
  'application/json', 'application/ld+json', 'application/xml', 'application/pdf', 'application/javascript', 'application/wasm',
  'text/plain', 'text/html', 'text/css', 'text/csv', 'text/javascript', 'text/xml',
  'image/png', 'image/jpeg', 'image/gif', 'image/webp', 'image/svg+xml', 'image/x-icon',
  'audio/mpeg', 'audio/ogg', 'audio/wav', 'video/mp4', 'video/webm',
  'font/woff', 'font/woff2', 'font/ttf', 'font/otf'
]);
// IDs are allocated independently from their values, so a known username-to-id
// pair cannot predict a second low-entropy username or tenant.
const anonymizationByValue = new Map();
const anonymizationById = new Map();
let fallbackOpaqueCounter = 0n;

export function fileContract(platform, filename) {
  const base = String(filename || '').split(platform === 'win32' ? /[\\/]/ : /\//).pop();
  return { platform, accepted: /\.har$/i.test(base), base };
}

export function parseHar(text) {
  if (utf8Length(String(text)) > MAX_BYTES) throw new Error('HAR 超过 20 MiB 上限');
  let value; try { value = JSON.parse(text); } catch { throw new Error('HAR JSON 无效'); }
  if (!value || !value.log || !Array.isArray(value.log.entries)) throw new Error('HAR 必须包含 log.entries');
  if (value.log.entries.length > MAX_ENTRIES) throw new Error('HAR 超过 5,000 条记录上限');
  return value;
}

function utf8Length(text) { return typeof TextEncoder !== 'undefined' ? new TextEncoder().encode(text).length : Buffer.byteLength(text, 'utf8'); }

function redactNonPemSecrets(value, replacement) {
  let output = String(value);
  for (const pattern of PREFIXED_SECRETS) output = output.replace(pattern, replacement);
  return output.replace(SECRET_VALUE, replacement);
}

function appendReplacement(output, replacement) {
  return output.endsWith(replacement) ? output : output + replacement;
}

function redactPemText(value, state, replacement) {
  const text = String(value);
  let cursor = 0;
  let output = '';
  for (const match of text.matchAll(PEM_PATH_MARKER)) {
    const markerKind = match[1].toUpperCase();
    const markerLabel = match[2].toUpperCase();
    if (state.pemLabels.length) {
      output = appendReplacement(output, replacement);
      cursor = match.index + match[0].length;
      if (markerKind === 'BEGIN') state.pemLabels.push(markerLabel);
      else if (markerLabel === state.pemLabels[state.pemLabels.length - 1]) state.pemLabels.pop();
      continue;
    }
    output += redactNonPemSecrets(text.slice(cursor, match.index), replacement);
    output = appendReplacement(output, replacement);
    if (markerKind === 'BEGIN') state.pemLabels.push(markerLabel);
    cursor = match.index + match[0].length;
  }
  if (state.pemLabels.length) return appendReplacement(output, replacement);
  return output + redactNonPemSecrets(text.slice(cursor), replacement);
}

export function redactString(value, replacement = '[redacted]') {
  const safeReplacement = String(replacement);
  return redactPemText(value, { pemLabels: [] }, safeReplacement);
}

function redactedKey(rawKey) {
  const value = redactString(rawKey);
  return RESERVED_KEYS.has(value) ? `[reserved ${value}]` : value;
}

function redactCountMap(value) {
  const output = Object.create(null);
  if (!value || typeof value !== 'object' || Array.isArray(value)) return output;
  for (const rawKey of Reflect.ownKeys(value)) {
    if (typeof rawKey !== 'string') continue;
    const descriptor = Object.getOwnPropertyDescriptor(value, rawKey);
    if (!descriptor?.enumerable || !Object.hasOwn(descriptor, 'value') || !Number.isFinite(descriptor.value)) continue;
    const safeKey = redactedKey(rawKey);
    if (Object.hasOwn(output, safeKey)) output[safeKey] += descriptor.value;
    else Object.defineProperty(output, safeKey, { value: descriptor.value, enumerable: true, configurable: true, writable: true });
  }
  return output;
}

export function redact(value) {
  if (Array.isArray(value)) return value.map(redact);
  if (typeof value === 'string') return redactString(value);
  if (!value || typeof value !== 'object') return value;
  const output = Object.create(null);
  const usedKeys = new Set();
  const nameDescriptor = Object.getOwnPropertyDescriptor(value, 'name');
  const sensitiveRecord = Boolean(nameDescriptor?.enumerable && Object.hasOwn(nameDescriptor, 'value') && typeof nameDescriptor.value === 'string' && SENSITIVE.test(nameDescriptor.value));
  for (const rawKey of Reflect.ownKeys(value)) {
    if (typeof rawKey !== 'string') continue;
    const descriptor = Object.getOwnPropertyDescriptor(value, rawKey);
    if (!descriptor?.enumerable || !Object.hasOwn(descriptor, 'value')) continue;
    const baseKey = redactedKey(rawKey);
    const safeValue = rawKey === 'domains' || rawKey === 'types'
      ? redactCountMap(descriptor.value)
      : (sensitiveRecord && rawKey === 'value') || SENSITIVE.test(rawKey) ? '[redacted]' : redact(descriptor.value);
    if (usedKeys.has(baseKey) && Number.isFinite(output[baseKey]) && Number.isFinite(safeValue)) {
      output[baseKey] += safeValue;
      continue;
    }
    let safeKey = baseKey;
    for (let index = 2; usedKeys.has(safeKey); index += 1) safeKey = `${baseKey} [collision ${index}]`;
    usedKeys.add(safeKey);
    Object.defineProperty(output, safeKey, { value: safeValue, enumerable: true, configurable: true, writable: true });
  }
  return output;
}

function headers(items) { return Object.fromEntries((items || []).map(({ name, value }) => [String(name).toLowerCase(), String(value || '')])); }
function host(url) { try { return new URL(url).host; } catch { return '(无效 URL)'; } }
function decodePathSegment(value) { try { return { ok: true, value: decodeURIComponent(value) }; } catch { return { ok: false, value: '' }; } }
function safeEncodeComponent(value) { try { return encodeURIComponent(value); } catch { return '%5Bredacted%5D'; } }
function stableId(value) {
  const raw = String(value);
  const existing = anonymizationByValue.get(raw);
  if (existing) return existing;
  let id;
  do {
    if (globalThis.crypto?.getRandomValues) {
      const bytes = new Uint8Array(16);
      globalThis.crypto.getRandomValues(bytes);
      id = Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
    } else {
      // Legacy runtimes without Web Crypto still get an allocation-order token
      // with no computable relationship to the private value.
      fallbackOpaqueCounter += 1n;
      id = fallbackOpaqueCounter.toString(16).padStart(32, '0');
    }
  } while (anonymizationById.has(id));
  anonymizationByValue.set(raw, id);
  anonymizationById.set(id, raw);
  return id;
}
function privatePlaceholder(kind, value) { return `[${kind}-${stableId(value)}]`; }
function isIpv4(value) {
  const parts = String(value).split('.');
  return parts.length === 4 && parts.every((part) => /^\d{1,3}$/.test(part) && Number(part) <= 255);
}
function isIpv6(value) {
  const text = String(value).toLowerCase();
  if (!text.includes(':') || !/^[0-9a-f:.]+$/.test(text)) return false;
  const pieces = text.split('::');
  if (pieces.length > 2) return false;
  const count = (part) => part ? part.split(':').filter(Boolean).length : 0;
  const groups = count(pieces[0]) + count(pieces[1]);
  return text.includes('::') ? groups < 8 : groups === 8;
}
export function classifyPii(value, previous = '') {
  const text = String(value);
  const label = String(previous || '').toLowerCase();
  if (/^(?:users?|usernames?|u)$/.test(label) || /^@[^@/\s]{1,128}$/.test(text)) return 'user';
  if (/^(?:tenants?|organizations?|orgs?|t|租户)$/.test(label) || /^(?:tenant|租户)[=:_-].+$/i.test(text)) return 'tenant';
  if (/^(?:accounts?|members?|profiles?)$/.test(label)) return 'account';
  if (/^[^/@\s]+@[^/@\s]+\.[^/@\s]+$/.test(text)) return 'email';
  if (/^(?:\+?86[- ]?)?1[3-9]\d{9}$/.test(text)) return 'phone';
  if (/^\d{17}[\dXx]$/.test(text)) return 'identity';
  if (isIpv4(text) || isIpv6(text)) return 'ip';
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(text)) return 'id';
  if (/^\d{8,}$/.test(text) || (!/^[A-Z_]+$/.test(text) && /^[a-z0-9_-]{16,}$/i.test(text))) return 'id';
  if (/^(?:user(?:name)?|account|member|profile)[=:_-].+$/i.test(text)) return 'account';
  return null;
}
function redactPrivatePathSegment(value, previous) {
  const text = String(value);
  if (/^\[redacted\]$/i.test(text)) return text;
  const kind = classifyPii(text, previous);
  if (kind) return privatePlaceholder(kind, text);
  return text;
}
function redactHostname(value) {
  const hostname = String(value).toLowerCase();
  // Keep the poison-key fixture literal so count maps still exercise their null-prototype path.
  if (hostname === '__proto__') return hostname;
  return `host-${stableId(hostname)}.invalid`;
}
function redactPathname(pathname) {
  const state = { pemLabels: [], decodeFailed: false };
  let previous = '';
  return String(pathname).split('/').map((segment) => {
    if (state.decodeFailed) return '%5Bredacted%5D';
    const decoded = decodePathSegment(segment);
    if (!decoded.ok) {
      state.decodeFailed = true;
      state.pemLabels.length = 0;
      return '%5Bredacted%5D';
    }
    const redacted = redactPemText(decoded.value, state, '[redacted]');
    const output = redactPrivatePathSegment(redacted, previous);
    previous = decoded.value;
    return safeEncodeComponent(output);
  }).join('/');
}
function safeQueryKey(value) {
  const raw = String(value);
  // Query names are attacker-controlled and can themselves be PII.  There is
  // no reliable way to distinguish a semantic key from a short username or
  // tenant name, so fail closed and anonymize every key while keeping repeats
  // stable for grouping.
  return privatePlaceholder('query', raw);
}
function safeInvalidQueryKey(value) {
  try { return safeQueryKey(decodeURIComponent(value)); } catch { return 'redacted'; }
}
function redactInvalidUrl(raw) {
  const withoutHash = String(raw).replace(/#[\s\S]*$/, '');
  const queryIndex = withoutHash.indexOf('?');
  // Invalid input has no trustworthy origin/path boundary.  Preserve only the
  // number of slash-delimited route segments; never project its raw base.
  const rawBase = queryIndex < 0 ? withoutHash : withoutHash.slice(0, queryIndex);
  const route = String(rawBase).split('/').map((part) => part ? '%5Bredacted%5D' : '').join('/');
  const base = route || '%5Bredacted%5D';
  if (queryIndex < 0) return base;
  const query = withoutHash.slice(queryIndex + 1).split('&').map((part) => {
    const separator = part.indexOf('=');
    const rawKey = separator < 0 ? part : part.slice(0, separator);
    return `${safeEncodeComponent(safeInvalidQueryKey(rawKey))}=%5Bredacted%5D`;
  }).join('&');
  return `${base}?${query}`;
}
export function redactUrl(raw) {
  try {
    const url = new URL(raw);
    url.username='';url.password='';url.hash='';
    url.hostname = redactHostname(url.hostname);
    url.pathname = redactPathname(url.pathname);
    const query = new URLSearchParams();
    for (const [key] of url.searchParams.entries()) query.append(safeQueryKey(key), '[redacted]');
    url.search = query.toString();
    return url.toString();
  } catch {
    return redactInvalidUrl(raw);
  }
}
function safeMethod(value) {
  const method = String(value || 'GET').trim().toUpperCase();
  return SAFE_METHODS.has(method) ? method : 'OTHER';
}
function safeMime(value) {
  const mime = String(value || '').split(';')[0].trim().toLowerCase();
  return SAFE_MIME_TYPES.has(mime) ? mime : 'unknown';
}
function sumTiming(timing) { return Object.values(timing || {}).reduce((n, v) => n + (Number(v) > 0 ? Number(v) : 0), 0); }

export function analyze(har) {
  const entries = har.log.entries;
  const result = { entries: entries.length, totalMs: 0, transferredBytes: 0, domains: Object.create(null), types: Object.create(null), slow: [], errors: [], redirects: [], cache: [], cors: [], security: [], duplicateBytes: 0, invalidUrls: 0 };
  const seen = new Map();
  for (const entry of entries) {
    const request = entry.request || {}, response = entry.response || {};
    const rawUrl = request.url || '';
    let validUrl = true; try { new URL(rawUrl); } catch { validUrl = false; }
    const url = redactUrl(rawUrl); const duration = Number(entry.time) > 0 ? Number(entry.time) : sumTiming(entry.timings);
    const declared=Number(response.bodySize);const size = declared>=0?declared:Math.max(0, Number(response.content?.size) || 0); const status = Number(response.status) || 0;
    const domain = validUrl ? host(url) : '(无效 URL)'; if (!validUrl) result.invalidUrls++;
    result.totalMs += duration; result.transferredBytes += size;
    result.domains[domain] = (result.domains[domain] || 0) + 1; const kind = safeMime(response.content?.mimeType); result.types[kind] = (result.types[kind] || 0) + 1;
    const timing={};for(const key of ['blocked','dns','connect','send','wait','receive','ssl'])if(Number.isFinite(Number(entry.timings?.[key])))timing[key]=Number(entry.timings[key]);const item = { url, method: safeMethod(request.method), status, duration, size, timing };
    if (duration >= 1000) result.slow.push(item);
    if (status >= 400) result.errors.push(item);
    if (status >= 300 && status < 400) result.redirects.push(item);
    const h = headers(response.headers); const q = headers(request.headers);
    if (h['cache-control'] || h.etag || h['last-modified']) result.cache.push({ url, cacheControl: Boolean(h['cache-control']), noStore: /(?:^|,)\s*no-store\b/i.test(h['cache-control'] || ''), noCache: /(?:^|,)\s*no-cache\b/i.test(h['cache-control'] || ''), etag: Boolean(h.etag), lastModified: Boolean(h['last-modified']) });
    if (q.origin && !h['access-control-allow-origin']) result.cors.push({ url, reason: '包含 Origin 的请求缺少 ACAO 响应头' });
    const missing = ['strict-transport-security', 'content-security-policy', 'x-content-type-options'].filter((name) => !h[name]);
    if (url.startsWith('https:') && missing.length) result.security.push({ url, missing });
    const prior = seen.get(url); if (prior) result.duplicateBytes += Math.min(size, prior); else seen.set(url, size);
  }
  result.slow.sort((a, b) => b.duration - a.duration); return result;
}

export function diffReports(before, after) {
  const numeric = (v) => Array.isArray(v) ? v.length : Number(v || 0);
  const compare = (key) => numeric(after[key]) - numeric(before[key]);
  return { entries: compare('entries'), totalMs: compare('totalMs'), transferredBytes: compare('transferredBytes'), errors: compare('errors'), slow: compare('slow'), duplicateBytes: compare('duplicateBytes') };
}

export function humanizeRedactionMarkers(value) {
  return String(value)
    .replace(/%5Bredacted%5D/gi, '[已脱敏]')
    .replace(/\[redacted\]/gi, '[已脱敏]');
}

export function toMarkdown(report, diff) {
  const lines = [`# HAR 诊断报告`, '', `- 请求数：${report.entries}`, `- 瀑布总耗时：${report.totalMs} ms`, `- 传输量：${report.transferredBytes} 字节`, `- 错误数：${report.errors.length}`, `- 慢请求数：${report.slow.length}`, `- 重复传输估算：${report.duplicateBytes} 字节`];
  if (diff) { const labels = { entries: '请求数', totalMs: '总耗时', transferredBytes: '传输量', errors: '错误数', slow: '慢请求数', duplicateBytes: '重复传输量' }; lines.push('', '## 环境差异', ...Object.entries(diff).map(([k, v]) => `- ${labels[k] || k}：${v >= 0 ? '+' : ''}${v}`)); }
  return lines.join('\n');
}
