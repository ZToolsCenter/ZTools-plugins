'use strict';

/**
 * stream.js —— 流式 / 多帧正文的结构化拆解（A 层 · 修 B11 的后续，功能 F28）
 *
 * 为什么需要它（本机 50 个样本实测，见设计文档 1.12）：
 * - `text/event-stream` 共 **19 条会话 / 5030 个事件**，其中 **5023 个事件的 `data:` 是合法 JSON**。
 *   以前整块交给 `JSON.parse` → 必然失败 → 字段视图降级成"宽松键名"（`partial:true`），
 *   AI 拿到的就是一坨几千行的事件流，知道有内容但读不出结构。
 * - 另有真·**顶层多份 JSON 拼接**的响应（服务端不加框架直接连着写多个 JSON 值），
 *   同样只能整块 parse 失败。
 *
 * 三条硬约束：
 * 1. **纯字节/字符串处理，零依赖、零 IO**：调用方负责把正文取回来（detail 已经做过 transfer-decoding 与解压）。
 * 2. **不改写原文**：每个事件/值都保留 `raw` 原文与在正文中的字节偏移，拆不出来就原样退还，绝不"看起来拆好了其实丢内容"。
 * 3. **规模可控**：事件数与单事件 JSON 深度都有上限与留痕（`truncated` / `stats`），超限时明确说明，不静默截断。
 */

/** 该 Content-Type 是否应按事件流解析。实测错标 0 条，所以按 CT 分派即可。 */
function isEventStream(contentType) {
  const base = String(contentType || '').split(';')[0].trim().toLowerCase();
  return base === 'text/event-stream' || base === 'text/eventstream' || base === 'application/event-stream';
}

/** 该 Content-Type 是否值得尝试"顶层多值 JSON"拆解。 */
function isJsonish(contentType) {
  const base = String(contentType || '').split(';')[0].trim().toLowerCase();
  return base === 'application/json' || base === 'text/json' || base.endsWith('+json')
    || base === 'application/x-ndjson' || base === 'application/jsonlines' || base === 'application/jsonl' || base === '';
}

/**
 * 解析 SSE 正文（W3C EventSource / RFC 后身）：
 * - 事件之间以**空行**分隔；
 * - 行内 `field: value`，`data` 可多行（按规范用 `\n` 连接），字段名后的**单个空格**属于分隔符不是内容；
 * - `:` 开头是注释（心跳），单独计数不当事件；
 * - 字段名未知（如部分服务端写 `id:` 之外自定义）时保留在 `other`。
 *
 * @param {string} text 已解框/已解压的正文文本
 * @param {object} [opts]
 * @param {number} [opts.maxEvents] 事件数上限（默认 5000，超出标 truncated 并继续统计总数）
 * @param {boolean} [opts.withRaw] 是否保留每事件原文（默认 false，导出与 UI 需要时再开）
 * @param {number} [opts.maxDataChars] 单事件 data 字符上限（默认 200000）
 */
function parseEventStream(text, opts) {
  const o = opts || {};
  const maxEvents = o.maxEvents === undefined ? 5000 : o.maxEvents;
  const maxDataChars = o.maxDataChars === undefined ? 200000 : o.maxDataChars;
  const src = String(text == null ? '' : text);
  const events = [];
  const stats = {
    blocks: 0, events: 0, withData: 0, withJsonData: 0, comments: 0,
    withId: 0, withEventName: 0, withRetry: 0, dataTruncated: 0, otherFields: 0,
  };
  const eventTypes = {};

  const flush = (block, blockIndex) => {
    stats.blocks++;
    const ev = { index: events.length, id: null, event: null, data: null, dataLines: 0, retry: null, commentLines: 0, other: [] };
    let hasField = false;
    for (const line of block.split(/\r\n|\r|\n/)) {
      if (!line) continue;
      if (line[0] === ':') { ev.commentLines++; stats.comments++; hasField = true; continue; }
      const ci = line.indexOf(':');
      let key;
      let val;
      if (ci === -1) { key = line; val = ''; } else { key = line.slice(0, ci); val = line.slice(ci + 1); if (val[0] === ' ') val = val.slice(1); }
      if (key === 'data') {
        ev.dataLines++;
        ev.data = ev.data === null ? val : ev.data + '\n' + val;
        hasField = true;
      } else if (key === 'event') { ev.event = val; hasField = true; }
      else if (key === 'id') { ev.id = val; hasField = true; }
      else if (key === 'retry') { ev.retry = val; hasField = true; }
      else { ev.other.push(key + ':' + val); stats.otherFields++; hasField = true; }
    }
    if (!hasField) return;
    // 只有注释的块（心跳）也保留为事件吗？不单独成事件，但计入 comments
    if (ev.dataLines === 0 && ev.event === null && ev.id === null && ev.retry === null && ev.commentLines > 0) return;

    stats.events++;
    if (ev.data !== null) {
      stats.withData++;
      if (ev.data.length > maxDataChars) { ev.dataTruncated = true; ev.dataChars = ev.data.length; ev.data = ev.data.slice(0, maxDataChars); stats.dataTruncated++; }
      const j = tryJson(ev.data);
      if (j.ok) { ev.dataJson = j.value; ev.dataType = j.type; stats.withJsonData++; }
      else if (ev.data.trim()) ev.dataParseError = j.error;
    }
    if (ev.id !== null) stats.withId++;
    if (ev.event !== null) { stats.withEventName++; eventTypes[ev.event] = (eventTypes[ev.event] || 0) + 1; }
    if (ev.retry !== null) stats.withRetry++;
    if (ev.other.length === 0) delete ev.other;
    if (ev.dataLines === 0) delete ev.dataLines;
    if (o.withRaw) ev.raw = block;
    if (events.length < maxEvents) events.push(ev);
    else ev.dropped = true;
    if (blockIndex === undefined) { /* noop */ }
  };

  // 事件分隔：空行。末尾无空行也要收最后一块。
  const blocks = src.split(/\r?\n\r?\n|\r\r/);
  for (let i = 0; i < blocks.length; i++) {
    if (!blocks[i]) continue;
    flush(blocks[i], i);
  }
  const overflow = Math.max(0, stats.events - events.length);
  return {
    kind: 'event-stream',
    events,
    stats: Object.assign({}, stats, { returned: events.length, overflow }),
    eventTypes,
    truncated: overflow > 0,
  };
}

/** `JSON.parse` 包装：失败只返回原因，不抛。 */
function tryJson(text) {
  try {
    const v = JSON.parse(text);
    return { ok: true, value: v, type: Array.isArray(v) ? 'array' : (v === null ? 'null' : typeof v) };
  } catch (e) {
    return { ok: false, error: (e && e.message) || 'parse-error' };
  }
}

/**
 * 从一个位置扫一个 JSON 值，返回结束下标；不是合法开头返回 -1。
 * 与 tools/probe-stream-bodies.js 同源，判据经过实测校正：
 * 只看"能不能数到大括号"会把 webpack chunk / bootstrap CSS 误判成多帧（实测假阳性 1005 条），
 * 因此调用方必须再校验**值与值之间只隔空白**。
 */
function scanJsonValue(text, from) {
  const c = text[from];
  if (c === '{' || c === '[') {
    let depth = 0;
    let inStr = false;
    let esc = false;
    for (let i = from; i < text.length; i++) {
      const ch = text[i];
      if (inStr) {
        if (esc) esc = false;
        else if (ch === '\\') esc = true;
        else if (ch === '"') inStr = false;
        continue;
      }
      if (ch === '"') { inStr = true; continue; }
      if (ch === '{' || ch === '[') depth++;
      else if (ch === '}' || ch === ']') { depth--; if (depth === 0) return i + 1; }
    }
    return -1;
  }
  if (c === '"') {
    let esc2 = false;
    for (let i = from + 1; i < text.length; i++) {
      const ch = text[i];
      if (esc2) esc2 = false;
      else if (ch === '\\') esc2 = true;
      else if (ch === '"') return i + 1;
    }
    return -1;
  }
  const m = /^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?|^true|^false|^null/.exec(text.slice(from, from + 40));
  return m ? from + m[0].length : -1;
}

/**
 * 拆"顶层多份 JSON 值"（ndjson / 无框架直接拼接）。
 * 必要条件：值与值之间**只能是空白**，且扫到正文结尾无残留；否则判 not-multi-value 并退还原文。
 *
 * @param {string} text
 * @param {object} [opts]
 * @param {number} [opts.maxValues] 默认 2000
 * @param {boolean} [opts.withRaw]
 */
function splitJsonValues(text, opts) {
  const o = opts || {};
  const maxValues = o.maxValues === undefined ? 2000 : o.maxValues;
  const src = String(text == null ? '' : text);
  const values = [];
  let i = 0;
  let gapsPureWs = true;
  let lastEnd = 0;
  let aborted = false;
  while (i < src.length && values.length < maxValues) {
    const wsStart = i;
    while (i < src.length && /\s/.test(src[i])) i++;
    if (i >= src.length) break;
    if (i > wsStart && /[^\s]/.test(src.slice(wsStart, i))) gapsPureWs = false;
    if (!gapsPureWs) break;
    const start = i;
    const end = scanJsonValue(src, start);
    if (end < 0) { aborted = true; break; }
    const slice = src.slice(start, end);
    const item = { index: values.length, start, end, chars: slice.length };
    const j = tryJson(slice);
    if (j.ok) { item.json = j.value; item.type = j.type; }
    else item.parseError = j.error;
    if (o.withRaw) item.raw = slice;
    values.push(item);
    lastEnd = end;
    i = end;
  }
  const trailing = src.slice(lastEnd).trim().length;
  const ok = values.length >= 2 && gapsPureWs && !aborted && trailing === 0;
  return {
    kind: 'multi-value',
    values,
    ok,
    stats: {
      returned: values.length,
      withJson: values.filter((v) => v.json !== undefined).length,
      gapsPureWs, aborted, trailingChars: trailing,
    },
    note: ok ? '' : (values.length < 2 ? '顶层不足两个 JSON 值' : (!gapsPureWs || aborted || trailing ? '值之间存在非空白残留，不是干净的拼接流' : '')),
  };
}

/** 事件/值的 JSON 顶层键集合（给分析包做一行摘要用，不塞整份 JSON）。 */
function topKeysOf(value, limit) {
  const n = limit === undefined ? 12 : limit;
  if (value && typeof value === 'object') {
    if (Array.isArray(value)) return { isArray: true, length: value.length, keys: value.length && value[0] && typeof value[0] === 'object' ? Object.keys(value[0]).slice(0, n) : [] };
    return { isArray: false, length: null, keys: Object.keys(value).slice(0, n) };
  }
  return { isArray: false, length: null, keys: [], scalar: value === null ? 'null' : typeof value };
}

/**
 * 内容预门：正文首个非空白字符必须是 `{` 或 `[`，否则不去扫全文。
 *
 * 为什么不收宽到"任意 JSON 值开头"（数字/字符串/true）：实测那样会让闸门从 39 次膨胀到 6271 次
 *（1955 次被硬判据拒绝），而 50 个归档里的 4 条真命中全部是对象/数组拼接 ——
 * 代价一上来，收益一条没多。准确率本来由 splitJsonValues 的硬判据保证，这里纯粹是省扫描。
 */
function worthSniffing(text) {
  const s = String(text == null ? '' : text);
  for (let i = 0; i < s.length && i < 4096; i++) {
    const c = s[i];
    if (c === ' ' || c === '\n' || c === '\r' || c === '\t') continue;
    return c === '{' || c === '[';
  }
  return false;
}

/**
 * 统一入口：按 Content-Type 选拆法，拆不动就返回 kind:'none' 并给出原因（调用方据此原样落盘）。
 *
 * 一个必须存在的**回退通路**（本机实测）：某样本的 sid3561/3663/3731 声明
 * `text/event-stream`，但正文是**每行一份裸 JSON（ndjson，没有 `data:` 前缀）**。
 * 只按 SSE 语法走会得到“1 个事件、data 为空、3 份 JSON 全堆在 other”——比不拆更难读。
 * 因此：按 event-stream 解不出任何带 data 的事件时，再试一次顶层多值；只有多值判据严格通过才改判，
 * 否则仍按原结果返回（不猜）。
 */
function parseStreamBody(text, contentType, opts) {
  if (isEventStream(contentType)) {
    const r = parseEventStream(text, opts);
    if (r.stats.events > 0 && r.stats.withData === 0) {
      const mv = splitJsonValues(text, opts);
      if (mv.ok) {
        mv.fellBackFrom = 'event-stream';
        mv.sseStats = r.stats;
        mv.note = '声明为 ' + contentType + ' 但正文没有 `data:` 字段，实际是 '
          + mv.values.length + ' 份顶层 JSON 值（按内容改判，非按头）';
        return mv;
      }
    }
    if (r.stats.events > 0) return r;
    return { kind: 'none', events: [], stats: r.stats, eventTypes: r.eventTypes, truncated: false, note: '声明为 event-stream 但没解出任何事件' };
  }
  if (isJsonish(contentType)) {
    // 调用方（字段层）已经整块 parse 过时，把结果传进来，不要重复 parse 一份 512KB 正文
    const wholeOk = opts && opts.jsonParsed !== undefined
      ? opts.jsonParsed === true
      : tryJson(text).ok;
    if (wholeOk) return { kind: 'none', values: [], stats: null, note: '整块就是一个合法 JSON，无需拆分' };
    const r = splitJsonValues(text, opts);
    if (r.ok) return r;
    return { kind: 'none', values: [], stats: r.stats, note: r.note || '不是多值 JSON' };
  }
  // 非流式、非 jsonish 的普通类型：实测存在把多值 JSON 错标成 text/html 的真实会话
  // （某样本 sid1642，290.8KB / 9 份顶层值；取证与设计文档 1.14）。只要硬判据全部通过就拆；
  // 全包实测 3125 条候选里仅命中这一条，JS/CSS/HTML 假阳性 0。
  if (worthSniffing(text)) {
    const r = splitJsonValues(text, opts);
    if (r.ok) {
      r.detectedBy = 'content';
      r.note = 'Content-Type 标为 ' + (contentType || '未声明') + '，但正文是 '
        + r.values.length + ' 份顶层 JSON 值（值间纯空白且无残留，按内容判）';
      return r;
    }
  }
  return { kind: 'none', events: undefined, values: undefined, stats: null, note: '类型 ' + (contentType || '未声明') + ' 不按流式处理' };
}

module.exports = {
  isEventStream,
  isJsonish,
  worthSniffing,
  parseEventStream,
  splitJsonValues,
  scanJsonValue,
  parseStreamBody,
  topKeysOf,
  tryJson,
};
