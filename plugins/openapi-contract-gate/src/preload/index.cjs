const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const YAML = require('yaml');
const MAX = 10 * 1024 * 1024, TTL = 300000, DEPTH = 60, NODES = 40000;
const INLINE_EACH_MAX = 320 * 1024, INLINE_TOTAL_MAX = 640 * 1024, MAX_PAGE = 200;
const MCP_RESPONSE_MAX = 512 * 1024, MCP_MARKDOWN_MAX = 64 * 1024;
const FINDING_FIELD_MAX = Object.freeze({ level: 32, kind: 128, pointer: 1024, reason: 768 });
const TOOL_NAMES = Object.freeze({ compareInline: 'compare_inline', compareApprovedFiles: 'compare_approved_files' });
const CLOSE_RETRY_MS = 100;
const registeredHosts = new WeakSet();
let grants = [];
let pendingCloses = [];
let grantTimer;
let closeRetryTimer;
let sessionEpoch = 0;
let closeSync = fs.closeSync;

function sessionExpired() {
  return Object.assign(new Error('插件会话已结束，请重新打开后选择契约文件。'), { code: 'SESSION_EXPIRED' });
}
function assertSessionEpoch(epoch) {
  if (epoch !== sessionEpoch) throw sessionExpired();
}

function close(record) {
  if (!record || record.closed) return true;
  try {
    closeSync(record.fd);
    record.closed = true;
    return true;
  } catch (error) {
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
    // The retry queue deliberately retains only the descriptor. Authorization
    // paths and file metadata are revoked even when the operating system asks
    // us to retry closing the handle.
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
function clear() {
  if (grantTimer) clearTimeout(grantTimer);
  grantTimer = undefined;
  // Grant replacement, TTL expiry, plugin-out, and explicit clearing are all
  // immediate retry opportunities. The timer is only a fallback.
  retryPendingCloses();
  const active = grants;
  grants = [];
  for (const record of active) retire(record);
}
function expireSession() {
  sessionEpoch += 1;
  clear();
}
function scheduleClear() {
  if (!grants.length) return;
  const delay = Math.max(0, Math.min(...grants.map((item) => item.until)) - Date.now());
  grantTimer = setTimeout(clear, delay);
  grantTimer.unref?.();
}
function audit(root) {
  const queue = [[root, 0]], seen = new Set(); let nodes = 0;
  while (queue.length) {
    const [value, depth] = queue.pop();
    if (depth > DEPTH || ++nodes > NODES) throw Error('契约超过安全结构限制');
    if (value === null || typeof value !== 'object') continue;
    if (seen.has(value)) continue;
    seen.add(value);
    for (const [key, next] of Object.entries(value)) {
      if (key === '$ref' && typeof next === 'string' && !next.startsWith('#/')) throw Error('不允许远程 $ref');
      queue.push([next, depth + 1]);
    }
  }
}
function isPlainObject(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}
function validateDocumentShape(document) {
  const openapi3 = typeof document?.openapi === 'string' && /^3\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/.test(document.openapi);
  const swagger2 = document?.swagger === '2.0';
  if (!isPlainObject(document) || (!openapi3 && !swagger2)) throw Error('根节点必须是 OpenAPI 3.x 或 Swagger 2.0 契约');
  if (!isPlainObject(document.paths)) throw Error('paths 必须是普通对象');
}
function sameIdentity(record, stat) {
  return stat.isFile() && stat.size === record.size && stat.mtimeMs === record.mtime && stat.ctimeMs === record.ctime && stat.dev === record.dev && stat.ino === record.ino;
}
function readStableBuffer(record, expectedDigest) {
  const before = fs.fstatSync(record.fd);
  if (!sameIdentity(record, before)) throw Error('契约文件在选择后发生变化');
  const buffer = Buffer.alloc(record.size); let offset = 0;
  while (offset < buffer.length) {
    const length = Math.min(64 * 1024, buffer.length - offset);
    const count = fs.readSync(record.fd, buffer, offset, length, offset);
    if (!count) throw Error('契约文件读取不完整');
    offset += count;
  }
  const after = fs.fstatSync(record.fd);
  if (!sameIdentity(record, after)) throw Error('契约文件在读取期间发生变化');
  const digest = crypto.createHash('sha256').update(buffer).digest('hex');
  if (expectedDigest && digest !== expectedDigest) throw Error('契约文件内容与授权时不一致');
  return { buffer, digest };
}
function record(file, ttl) {
  const real = fs.realpathSync(file), link = fs.lstatSync(file);
  const fd = fs.openSync(real, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW || 0));
  try {
    const stat = fs.fstatSync(fd);
    if (link.isSymbolicLink() || !stat.isFile() || stat.size > MAX || !/\.(json|ya?ml)$/i.test(real)) throw Error('契约文件不符合安全要求');
    const selected = { fd, real, size: stat.size, mtime: stat.mtimeMs, ctime: stat.ctimeMs, dev: stat.dev, ino: stat.ino, until: Date.now() + ttl };
    selected.digest = readStableBuffer(selected).digest;
    return selected;
  } catch (error) { retire({ fd }); throw error; }
}
function grant(files, ttl = TTL) {
  clear();
  if (!Array.isArray(files) || files.length < 1 || files.length > 2) throw Error('请选择一到两个契约文件');
  if (!Number.isSafeInteger(ttl) || ttl < 1 || ttl > TTL) throw Error('授权有效期无效');
  const selected = [];
  try {
    for (const file of files) selected.push(record(file, ttl));
    grants = selected;
    scheduleClear();
    return grants.map((item) => path.basename(item.real));
  }
  catch (error) { for (const item of selected) retire(item); throw error; }
}
function auditYamlNode(node, seen = new Set()) {
  if (!node || typeof node !== 'object' || seen.has(node)) return;
  seen.add(node);
  if (node.anchor || node.tag || node.constructor?.name === 'Alias') throw Error('不允许 YAML 锚点、别名或显式标签');
  if (Array.isArray(node.items)) for (const item of node.items) auditYamlNode(item, seen);
  auditYamlNode(node.key, seen);
  auditYamlNode(node.value, seen);
}
function parseYaml(text) {
  const document = YAML.parseDocument(text, { uniqueKeys: true, prettyErrors: false });
  if (document.errors.length || document.warnings.length) {
    const message = document.errors.concat(document.warnings).map((item) => item.message).join('; ');
    if (/tag|alias|anchor/i.test(message)) throw Error('不允许 YAML 锚点、别名或显式标签');
    throw Error('YAML 格式无效');
  }
  auditYamlNode(document.contents);
  return document.toJS({ maxAliasCount: 0 });
}
function invalidTool(message) { const error = new Error(message); error.code = 'INVALID_TOOL_INPUT'; throw error; }
function byteLength(value) { return Buffer.byteLength(String(value), 'utf8'); }
function validateObject(input, allowed, label) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) invalidTool(`${label}必须是对象。`);
  let prototype, keys;
  try { prototype = Object.getPrototypeOf(input); keys = Reflect.ownKeys(input); } catch { invalidTool(`${label}结构无效。`); }
  if (prototype !== Object.prototype && prototype !== null) invalidTool(`${label}原型无效。`);
  const values = Object.create(null);
  for (const key of keys) {
    if (typeof key !== 'string' || key === '__proto__' || key === 'prototype' || key === 'constructor' || !allowed.has(key)) invalidTool(`${label}包含未允许字段。`);
    let descriptor;
    try { descriptor = Object.getOwnPropertyDescriptor(input, key); } catch { invalidTool(`${label}字段无效。`); }
    if (!descriptor || !Object.prototype.hasOwnProperty.call(descriptor, 'value')) invalidTool(`${label}只允许数据字段。`);
    values[key] = descriptor.value;
  }
  return values;
}
function validatePage(input) {
  const offset = input.offset === undefined ? 0 : input.offset;
  const limit = input.limit === undefined ? 100 : input.limit;
  if (!Number.isSafeInteger(offset) || offset < 0) invalidTool('offset 必须是非负安全整数。');
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > MAX_PAGE) invalidTool('limit 必须是 1—200 的安全整数。');
  if (input.includeMarkdown !== undefined && typeof input.includeMarkdown !== 'boolean') invalidTool('includeMarkdown 必须是布尔值。');
  return { offset, limit, includeMarkdown: input.includeMarkdown === true };
}
function validateInlineInput(input) {
  input = validateObject(input, new Set(['before', 'after', 'format', 'includeMarkdown', 'offset', 'limit']), '内联比较参数');
  if (typeof input.before !== 'string' || typeof input.after !== 'string') invalidTool('before 和 after 必须是字符串。');
  const beforeBytes = byteLength(input.before), afterBytes = byteLength(input.after);
  if (beforeBytes > INLINE_EACH_MAX || afterBytes > INLINE_EACH_MAX || beforeBytes + afterBytes > INLINE_TOTAL_MAX) invalidTool('两份内联契约必须各不超过 320 KiB，合计不超过 640 KiB UTF-8。');
  const format = input.format === undefined ? 'auto' : input.format;
  if (!['auto', 'json', 'yaml'].includes(format)) invalidTool('format 必须是 auto、json 或 yaml。');
  return { before: input.before, after: input.after, format, ...validatePage(input) };
}
function validateApprovedInput(input) {
  input = validateObject(input, new Set(['includeMarkdown', 'offset', 'limit']), '授权文件比较参数');
  return validatePage(input);
}
function parseInline(text, format) {
  let document;
  if (format === 'json') {
    try { document = JSON.parse(text); } catch { throw Error('JSON 契约格式无效'); }
  } else if (format === 'yaml') document = parseYaml(text);
  else {
    try { document = JSON.parse(text); }
    catch { document = parseYaml(text); }
  }
  validateDocumentShape(document);
  audit(document);
  const serialized = JSON.stringify(document);
  if (byteLength(serialized) > INLINE_EACH_MAX) invalidTool('解析后的内联契约不得超过 320 KiB UTF-8。');
  return serialized;
}
function clipUtf8(value, maximum) {
  const text = String(value ?? '');
  const bytes = Buffer.from(text, 'utf8');
  if (bytes.length <= maximum) return { value: text, truncated: false };
  const suffix = Buffer.from('…');
  let end = Math.max(0, maximum - suffix.length);
  while (end > 0 && (bytes[end] & 0xc0) === 0x80) end -= 1;
  return { value: bytes.subarray(0, end).toString('utf8') + '…', truncated: true };
}
function createFindingCollector(page) {
  const counts = { breaking: 0, nonBreaking: 0, info: 0, total: 0 };
  const findings = [];
  let fieldTruncated = false;
  return {
    counts,
    findings,
    get fieldTruncated() { return fieldTruncated; },
    push(item) {
      const index = counts.total;
      counts.total += 1;
      if (item?.level === 'breaking') counts.breaking += 1;
      else if (item?.level === 'non-breaking') counts.nonBreaking += 1;
      else if (item?.level === 'info') counts.info += 1;
      if (index < page.offset || findings.length >= page.limit) return counts.total;
      const sanitized = {};
      for (const field of ['level', 'kind', 'pointer', 'reason']) {
        const clipped = clipUtf8(item?.[field], FINDING_FIELD_MAX[field]);
        sanitized[field] = clipped.value;
        fieldTruncated ||= clipped.truncated;
      }
      findings.push(sanitized);
      return counts.total;
    }
  };
}
function serializedBytes(value) { return Buffer.byteLength(JSON.stringify(value), 'utf8'); }
function buildCollectorResponse(collector, page, mod, findingCount) {
  const findings = collector.findings.slice(0, findingCount);
  let markdownTruncated = false;
  let markdown;
  if (page.includeMarkdown) {
    const clipped = clipUtf8(mod.reportMarkdown(findings), MCP_MARKDOWN_MAX);
    markdown = clipped.value;
    markdownTruncated = clipped.truncated;
  }
  const responseTruncated = collector.fieldTruncated || findingCount < collector.findings.length || markdownTruncated;
  return {
    gatePassed: collector.counts.breaking === 0,
    counts: collector.counts,
    findings,
    page: { offset: page.offset, limit: page.limit, returned: findings.length, total: collector.counts.total, truncated: page.offset + findings.length < collector.counts.total },
    responseTruncated,
    ...(page.includeMarkdown ? { markdown, markdownTruncated } : {})
  };
}
function boundedCollectorResponse(collector, page, mod) {
  let low = 0, high = collector.findings.length, best = buildCollectorResponse(collector, page, mod, 0);
  while (low <= high) {
    const middle = Math.floor((low + high) / 2);
    const candidate = buildCollectorResponse(collector, page, mod, middle);
    if (serializedBytes(candidate) <= MCP_RESPONSE_MAX) { best = candidate; low = middle + 1; }
    else high = middle - 1;
  }
  if (best.findings.length < collector.findings.length) best.responseTruncated = true;
  if (serializedBytes(best) > MCP_RESPONSE_MAX) throw Object.assign(new Error('MCP 响应超过安全预算。'), { code: 'MCP_RESPONSE_BUDGET_EXCEEDED' });
  return best;
}
function stableToolError(code, message) { return Object.assign(new Error(message), { code }); }
async function compareSerialized(before, after, page) {
  const mod = await import('../core/contract.js');
  const collector = createFindingCollector(page);
  mod.compareContracts(mod.parseDocument(before), mod.parseDocument(after), collector);
  return boundedCollectorResponse(collector, page, mod);
}
async function compareInline(input) {
  try {
    const value = validateInlineInput(input);
    return await compareSerialized(parseInline(value.before, value.format), parseInline(value.after, value.format), value);
  } catch (error) {
    if (error?.code === 'INVALID_TOOL_INPUT') throw error;
    throw stableToolError('CONTRACT_COMPARISON_FAILED', '契约解析或比较失败；请检查格式与安全限制。');
  }
}
async function compareApprovedFiles(input) {
  const value = validateApprovedInput(input);
  const epoch = sessionEpoch;
  try {
    assertSessionEpoch(epoch);
    if (grants.length !== 2 || grants.some((item) => item.until < Date.now())) {
      clear();
      throw stableToolError('UI_APPROVAL_REQUIRED', '请先在插件界面一次选择两份契约文件。');
    }
    const documents = readGranted({ consume: true });
    const result = await compareSerialized(documents[0], documents[1], value);
    assertSessionEpoch(epoch);
    return result;
  } catch (error) {
    clear();
    if (error?.code === 'UI_APPROVAL_REQUIRED') throw error;
    if (error?.code === 'SESSION_EXPIRED') throw error;
    throw stableToolError('APPROVED_CONTRACT_FAILED', '已授权契约不可用或比较失败，请在插件界面重新选择。');
  }
}
function registerTools(ztools) {
  if (!ztools || typeof ztools.registerTool !== 'function') return false;
  if (registeredHosts.has(ztools)) return false;
  let registered = 0;
  for (const [name, handler] of [
    [TOOL_NAMES.compareInline, (input) => compareInline(input)],
    [TOOL_NAMES.compareApprovedFiles, (input) => compareApprovedFiles(input)]
  ]) {
    try { ztools.registerTool.call(ztools, name, handler); registered += 1; } catch {}
  }
  registeredHosts.add(ztools);
  return registered > 0;
}
function read(record) {
  if (Date.now() > record.until) throw Error('文件选择授权已过期');
  const { buffer } = readStableBuffer(record, record.digest);
  let document;
  if (/\.json$/i.test(record.real)) {
    try { document = JSON.parse(buffer.toString('utf8')); } catch { throw Error('JSON 契约格式无效'); }
  } else document = parseYaml(buffer.toString('utf8'));
  validateDocumentShape(document);
  audit(document);
  const serialized = JSON.stringify(document);
  if (Buffer.byteLength(serialized) > MAX) throw Error('契约超过安全序列化大小限制');
  return serialized;
}
function readGranted({ consume = false } = {}) {
  if (!grants.length) throw Error('请先选择契约文件');
  try { return grants.map(read); }
  catch (error) { clear(); throw error; }
  finally { if (consume) clear(); }
}
async function choose(ztools) {
  if (typeof ztools?.showOpenDialog !== 'function') throw Error('ZTools 文件选择对话框不可用');
  expireSession();
  const epoch = sessionEpoch;
  const result = await ztools.showOpenDialog({ title: '选择一到两个 OpenAPI 契约文件', properties: ['openFile', 'multiSelections'], filters: [{ name: 'OpenAPI 契约', extensions: ['json', 'yaml', 'yml'] }] });
  assertSessionEpoch(epoch);
  const files = Array.isArray(result) ? result : result?.filePaths;
  if (!files?.length) { clear(); return []; }
  try {
    const names = grant(files);
    assertSessionEpoch(epoch);
    return names;
  }
  catch { clear(); throw Error('无法授权所选契约文件，请检查文件类型、大小和权限'); }
}
function bridge(ztools) {
  if (typeof ztools?.onPluginOut === 'function') ztools.onPluginOut(expireSession);
  registerTools(ztools);
  return Object.freeze({ choose: () => choose(ztools), readGranted: () => readGranted(), copyText: (text) => ztools?.copyText?.(String(text)) });
}
if (typeof window !== 'undefined') window.contractGate = bridge(window.ztools);
module.exports = {
  TOOL_NAMES,
  bridge,
  registerTools,
  validateInlineInput,
  validateApprovedInput,
  createFindingCollector,
  boundedCollectorResponse,
  compareInline,
  compareApprovedFiles,
  __testGrant: grant,
  __testClear: clear,
  __testExpireSession: expireSession,
  __testGrants: () => grants,
  __testPendingCloses: () => pendingCloses,
  __testRetryPendingCloses: retryPendingCloses,
  __testSetCloseSync: (value) => {
    if (typeof value !== 'function') throw new TypeError('测试 closeSync 必须是函数。');
    closeSync = value;
  },
  __testResetCloseSync: () => { closeSync = fs.closeSync; },
  __testSessionEpoch: () => sessionEpoch,
  readGranted
};
