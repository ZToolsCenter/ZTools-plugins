'use strict';

/**
 * fields.js —— 结构化字段提取（A 层 · F17 元特征 + F19 统一 KV 树）
 *
 * 为什么这一层是"AI 分析素材"的关键：
 * 原算法只把正文写成文件，AI 必须先花大量 token 读完整体才知道有哪些字段。
 * 这里在**索引阶段**就产出字段名集合、类型与隐私标签，让 L0/L1 摘要即具定位能力。
 *
 * 重要约束：
 * - 索引阶段正文可能只读了前缀（被截断），因此 JSON 解析失败必须走宽松扫描兜底，
 *   并如实标记 partial，绝不把"没解析出来"当成"没有字段"。
 * - 提取只读不改写：字段值原样保留（隐私值默认列出）。
 */

const privacy = require('./privacy');
const { parseContentType } = require('./types');

/** JSON 值类型名，用于摘要里标注字段形状而不泄露全部值。 */
function jsonTypeOf(v) {
  if (v === null) return 'null';
  if (Array.isArray(v)) return 'array';
  const t = typeof v;
  if (t === 'object') return 'object';
  if (t === 'number') return 'number';
  if (t === 'boolean') return 'boolean';
  return 'string';
}

/** 递归收集 JSON 的字段路径与类型（深度/数量双重限流，避免超大响应拖慢索引）。 */
function walkJson(node, prefix, depth, budget, out, sampleValues) {
  if (depth > budget.maxDepth || out.length >= budget.maxKeys) { budget.overflow = true; return; }
  if (Array.isArray(node)) {
    if (node.length > 0) walkJson(node[0], prefix + '[]', depth + 1, budget, out, sampleValues);
    return;
  }
  if (node && typeof node === 'object') {
    for (const k of Object.keys(node)) {
      if (out.length >= budget.maxKeys) { budget.overflow = true; return; }
      const path = prefix ? prefix + '.' + k : k;
      const v = node[k];
      const entry = { path, type: jsonTypeOf(v), isArray: Array.isArray(v) };
      if (sampleValues) entry.sample = summarizeValue(v);
      out.push(entry);
      walkJson(v, path, depth + 1, budget, out, sampleValues);
    }
  }
}

/** 值摘要：默认保留完整值（隐私值是分析对象），仅在超长时截断并标记长度。 */
function summarizeValue(v, maxLen) {
  const cap = maxLen || 200;
  if (v === null || v === undefined) return '';
  if (typeof v === 'object') return '';
  const s = String(v);
  if (s.length <= cap) return s;
  return s.slice(0, cap) + '…(' + s.length + ')';
}

/**
 * 宽松扫描 JSON 文本中的键名（用于被截断的前缀，或结构非法但可读的场景）。
 * 不追求语法正确，只求"出现过这个 key"。
 */
function looseJsonKeys(text, maxKeys) {
  const seen = new Set();
  const re = /"((?:[^"\\]|\\"){1,80})"\s*:/g;
  let m;
  while ((m = re.exec(text)) !== null) {
    if (seen.size >= (maxKeys || 400)) break;
    if (m[1]) seen.add(m[1]);
  }
  return [...seen].map((k) => ({ path: k, type: 'unknown', loose: true }));
}

/**
 * 从 JSON 正文提取字段清单。
 * @param {Buffer|string} body
 * @param {{maxKeys?:number,maxDepth?:number,truncated?:boolean,withSamples?:boolean}} opts
 */
function extractJsonFields(body, opts) {
  const o = opts || {};
  const maxKeys = o.maxKeys || 300;
  const maxDepth = o.maxDepth || 4;
  const text = typeof body === 'string' ? body : body.toString('utf8');
  const res = { format: 'json', fields: [], partial: false, parsed: false, overflow: false, note: '' };
  if (!text.trim()) { res.format = 'empty'; return res; }

  if (!o.truncated) {
    try {
      const obj = JSON.parse(text);
      const budget = { maxKeys, maxDepth, overflow: false };
      walkJson(obj, '', 0, budget, res.fields, o.withSamples);
      res.parsed = true;
      res.partial = budget.overflow;
      res.overflow = budget.overflow;
      if (budget.overflow) res.note = '字段数超上限 ' + maxKeys + '，已截断';
      return res;
    } catch (e) {
      res.note = 'JSON.parse 失败，转宽松扫描: ' + e.message;
    }
  } else {
    res.note = '正文为前缀读取，字段来自不完整文本';
  }
  res.fields = looseJsonKeys(text, maxKeys);
  res.partial = true;
  return res;
}

/** x-www-form-urlencoded → KV 列表（保留重复 key 与原始顺序）。 */
function extractUrlencodedFields(body) {
  const text = (Buffer.isBuffer(body) ? body.toString('latin1') : String(body)).trim();
  const fields = [];
  if (!text) return { format: 'empty', fields, partial: false };
  for (const pair of text.split('&')) {
    if (!pair) continue;
    const eq = pair.indexOf('=');
    const rawKey = eq === -1 ? pair : pair.slice(0, eq);
    const rawVal = eq === -1 ? '' : pair.slice(eq + 1);
    let key = rawKey, val = rawVal;
    try { key = decodeURIComponent(rawKey.replace(/\+/g, ' ')); } catch (e) { /* 原样 */ }
    try { val = decodeURIComponent(rawVal.replace(/\+/g, ' ')); } catch (e) { /* 原样 */ }
    fields.push({ path: key, type: 'string', raw: val.length > 512 ? val.slice(0, 512) + '…' : val, rawEncodedLength: rawVal.length });
  }
  return { format: 'urlencoded', fields, partial: false };
}

/**
 * multipart/form-data 拆分（修正原算法把整块 multipart 塞进 .txt 的做法）。
 * 文件部分只取元信息与体积，普通字段保留完整值。
 */
function extractMultipartFields(body, boundary) {
  const res = { format: 'multipart', fields: [], parts: [], partial: false, note: '' };
  if (!boundary) { res.note = '缺少 boundary'; res.partial = true; return res; }
  const buf = Buffer.isBuffer(body) ? body : Buffer.from(String(body), 'binary');
  const delim = Buffer.from('--' + boundary, 'latin1');
  const CRLF = Buffer.from('\r\n', 'latin1');

  let start = buf.indexOf(delim);
  if (start < 0) { res.note = '未找到 boundary 分隔符（可能被前缀读取截断）'; res.partial = true; return res; }

  while (true) {
    const next = buf.indexOf(delim, start + delim.length);
    if (next < 0) { res.partial = true; break; }
    const seg = buf.subarray(start + delim.length, next);
    // 跳过分隔符后的 CRLF，识别结束标记 '--'
    let bodyStart = seg.indexOf(CRLF);
    if (bodyStart < 0) { start = next; continue; }
    const headPart = seg.subarray(0, bodyStart).toString('utf8');
    if (/^--\s*$/.test(headPart)) break; // 结束分隔符
    let content = seg.subarray(bodyStart + 2);
    if (content.length >= 2 && content.subarray(content.length - 2).toString('latin1') === '\r\n') {
      content = content.subarray(0, content.length - 2);
    }
    const partInfo = { headers: {}, size: content.length };
    for (const line of headPart.split(/\r?\n/)) {
      const ci = line.indexOf(':');
      if (ci <= 0) continue;
      partInfo.headers[line.slice(0, ci).trim().toLowerCase()] = line.slice(ci + 1).trim();
    }
    const disp = partInfo.headers['content-disposition'] || '';
    const nameM = /name="?([^";]+)"?/i.exec(disp);
    const fileM = /filename="?([^";]*)"*/i.exec(disp);
    const part = {
      name: nameM ? nameM[1] : '',
      filename: fileM ? fileM[1] : null,
      contentType: partInfo.headers['content-type'] || null,
      size: content.length,
      isFile: !!fileM,
    };
    res.parts.push(part);
    if (!part.isFile) {
      res.fields.push({ path: part.name, type: 'string', raw: content.toString('utf8') });
    } else {
      res.fields.push({ path: part.name, type: 'file', filename: part.filename, size: part.size });
    }
    start = next;
  }
  if (res.fields.length === 0 && res.parts.length === 0) res.partial = true;
  return res;
}

/** XML 顶层与次层元素名（不引入第三方 XML 库，取元素名集合即可满足摘要需要）。 */
function extractXmlFields(body) {
  const text = (Buffer.isBuffer(body) ? body.toString('utf8') : String(body)).slice(0, 200000);
  const names = new Set();
  const re = /<([A-Za-z_][\w:.-]*)(?:\s[^>]*)?>/g;
  let m;
  while ((m = re.exec(text)) !== null) {
    if (names.size >= 300) break;
    names.add(m[1]);
  }
  const fields = [...names].map((n) => ({ path: n, type: 'element', loose: true }));
  return { format: 'xml', fields, partial: true, note: '按元素名宽松提取' };
}

/**
 * 统一字段视图（F19）：按 Content-Type 分派到具体提取器，并叠加隐私标签。
 *
 * @param {{contentType?:string,bodyBuf?:Buffer,bodyTruncated?:boolean,boundary?:string}} input
 * @param {object} [opts]
 * @returns {{format:string, fields:Array, partial:boolean, privacyTags:Array, note:string}}
 */
function buildFieldView(input, opts) {
  const o = opts || {};
  const body = input.bodyBuf;
  const { base } = parseContentType(input.contentType);
  let out = { format: base || 'unknown', fields: [], partial: false, note: '' };

  if (!body || body.length === 0) {
    out.format = 'empty';
    out.noPrivacy = true;
    return finalize(out, []);
  }

  if (base === 'application/x-www-form-urlencoded') {
    out = extractUrlencodedFields(body);
  } else if (base === 'multipart/form-data') {
    const { params } = parseContentType(input.contentType);
    out = extractMultipartFields(body, input.boundary || params.boundary);
  } else if (base.includes('json') || base === '' || base.startsWith('text/')) {
    // 无声明但内容像 JSON 的情况也要提字段：先按 JSON 尝试
    out = extractJsonFields(body, {
      maxKeys: o.maxKeys,
      maxDepth: o.maxDepth,
      truncated: !!input.bodyTruncated,
      withSamples: o.withSamples !== false, // 默认带值（用户指令：隐私值默认列出）
    });
    if (out.format === 'json' && out.fields.length === 0 && /<\?xml|<[A-Za-z]/.test(body.subarray(0, 200).toString('utf8'))) {
      out = extractXmlFields(body);
    }
  } else if (base === 'application/xml' || base === 'text/xml' || base.endsWith('+xml')) {
    out = extractXmlFields(body);
  } else if (base === 'application/x-protobuf' || base === 'application/grpc') {
    out = { format: 'protobuf', fields: [], partial: true, note: '需 wire 转储，见 protobuf.js' };
  } else {
    out = { format: base || 'binary', fields: [], partial: true, note: '非文本内容，仅记录体积与类型' };
  }

  const tags = [];
  for (const f of out.fields) {
    const tag = privacy.tagField(f.path, false);
    if (tag) tags.push({ name: f.path, kind: tag.kind, value: f.raw === undefined ? f.sample : f.raw, valueLength: f.raw ? String(f.raw).length : 0 });
  }
  return finalize(out, tags);
}

/** 统一补齐 privacyTags 字段，便于上层无脑读取。 */
function finalize(view, tags) {
  view.privacyTags = tags || [];
  if (!view.note) view.note = '';
  return view;
}

/** query 串 → 字段视图（含隐私标签）。 */
function buildQueryView(query) {
  const u = extractUrlencodedFields(query || '');
  u.format = 'query';
  const tags = [];
  for (const f of u.fields) {
    const tag = privacy.tagField(f.path, false);
    if (tag) tags.push({ name: f.path, kind: tag.kind, value: f.raw, valueLength: String(f.raw || '').length });
  }
  return finalize(u, tags);
}

module.exports = {
  extractJsonFields,
  extractUrlencodedFields,
  extractMultipartFields,
  extractXmlFields,
  looseJsonKeys,
  walkJson,
  jsonTypeOf,
  summarizeValue,
  buildFieldView,
  buildQueryView,
};
