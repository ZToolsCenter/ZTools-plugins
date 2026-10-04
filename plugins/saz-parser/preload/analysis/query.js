'use strict';

/**
 * query.js —— 条件取数（B 层 · F24）
 *
 * 这是"分析包该装什么"的唯一决策入口，同时被三处复用：
 *   ① UI 的筛选面板  ② MCP tool `saz_query`  ③ 分析包 L2/L3 的会话选择
 * 三处共用一套谓词，避免"UI 看到 100 条、导出来 87 条"这类口径分裂。
 *
 * 铁律（设计 4.3）：过滤只产生**视图/选取集合**，绝不改动数据层，
 * 也绝不因为"看起来是噪声"就把某档从数据集里删掉。
 */

/** 把字符串或正则字面量安全编译为 RegExp；非法表达式返回 null 并回报原因。 */
function compileRegex(input) {
  if (!input) return null;
  if (input instanceof RegExp) return input;
  let src = String(input);
  let flags = 'i';
  const m = /^\/([\s\S]*)\/([a-z]*)$/.exec(src);
  if (m) { src = m[1]; flags = m[2] || 'i'; }
  try { return new RegExp(src, flags); } catch (e) { return null; }
}

/** 会话里所有可被 bodyContains 命中的文本（懒算，只在需要时取）。 */
function sessionHaystack(session) {
  if (session._haystack) return session._haystack;
  const parts = [session.url, session.urlTemplate, session.reqContentType, session.respContentType, session.statusText];
  for (const f of session.reqFields || []) parts.push(f.path, f.sample || '');
  for (const t of session.privacyTags || []) parts.push(t.name, t.value || '');
  session._haystack = parts.join('\n').toLowerCase();
  return session._haystack;
}

/** 字段名集合（query + body 参数名）。 */
function fieldPathSet(session) {
  if (!session._fieldPaths) {
    session._fieldPaths = (session.reqFields || []).map((f) => f.path.toLowerCase());
  }
  return session._fieldPaths;
}

/** 该会话命中的隐私字段类型列表。 */
function privacyKinds(session) {
  if (!session._privacyKinds) {
    session._privacyKinds = [...new Set((session.privacyTags || []).map((t) => t.kind))];
  }
  return session._privacyKinds;
}

/**
 * 把条件对象编译为谓词函数。
 * 支持的条件（全部可选，AND 关系；同一名词内部多值为 OR）：
 *   category[] | excludeCategory[]
 *   domains[] | excludeDomains[]（按 host 前缀匹配，大小写不敏感）
 *   methods[] | status[] | statusRange:[min,max]
 *   urlRegex | urlTemplateRegex | contentType[]
 *   hasAuth:boolean | hasCookie:boolean | privacyKinds[]
 *   hasRequestFields:boolean | fieldNames[]（请求参数名命中其一）
 *   sidRange:[a,b] | seqRange:[a,b] | hosts[]
 *   bodyBytesRange:[min,max] | respBytesRange:[min,max]
 *   durationRange:[min,max]（_m.xml 的 totalMs）
 *   decodedOkOnly:boolean | decodeFailedOnly:boolean
 *   isWebSocket:boolean | hasWebSocketLog:boolean
 *   headerContains:[{name,valueRegex}] | bodyContains:[str]（在已索引文本里找）
 *   search:str（url + 字段名 + 隐私字段名的模糊包含）
 * @returns {{test:(session:object)=>boolean, active:string[]}}
 */
function buildPredicate(filter) {
  const f = filter || {};
  const checks = [];
  const active = [];

  const arr = (v) => (Array.isArray(v) ? v : v === undefined || v === null ? [] : [v]).map((x) => String(x).toLowerCase());
  const has = (v) => Array.isArray(v) ? v.length > 0 : v !== undefined && v !== null && v !== '';

  if (has(f.category)) {
    const set = arr(f.category);
    checks.push((s) => set.includes(s.category));
    active.push('category');
  }
  if (has(f.excludeCategory)) {
    const set = arr(f.excludeCategory);
    checks.push((s) => !set.includes(s.category));
    active.push('excludeCategory');
  }
  if (has(f.domains)) {
    const list = arr(f.domains);
    checks.push((s) => !!s.host && list.some((d) => s.host === d || s.host.endsWith('.' + d) || s.host.includes(d)));
    active.push('domains');
  }
  if (has(f.excludeDomains)) {
    const list = arr(f.excludeDomains);
    checks.push((s) => !s.host || !list.some((d) => s.host === d || s.host.endsWith('.' + d) || s.host.includes(d)));
    active.push('excludeDomains');
  }
  if (has(f.methods)) {
    const set = arr(f.methods);
    checks.push((s) => set.includes((s.method || '').toLowerCase()));
    active.push('methods');
  }
  if (has(f.status)) {
    const set = f.status.map(Number);
    checks.push((s) => set.includes(Number(s.status)));
    active.push('status');
  }
  if (Array.isArray(f.statusRange)) {
    const [lo, hi] = f.statusRange;
    checks.push((s) => Number(s.status) >= Number(lo) && Number(s.status) <= Number(hi));
    active.push('statusRange');
  }
  if (f.urlRegex !== undefined && f.urlRegex !== null && f.urlRegex !== '') {
    const re = compileRegex(f.urlRegex);
    if (re) { checks.push((s) => re.test(s.url || '')); active.push('urlRegex'); }
  }
  if (f.urlTemplateRegex) {
    const re = compileRegex(f.urlTemplateRegex);
    if (re) { checks.push((s) => re.test(s.urlTemplate || '')); active.push('urlTemplateRegex'); }
  }
  if (has(f.contentType)) {
    const list = arr(f.contentType);
    checks.push((s) => list.some((c) => (s.respContentType || '').toLowerCase().includes(c) || (s.reqContentType || '').toLowerCase().includes(c)));
    active.push('contentType');
  }
  // 传输层维度（v0.5.6 新增）：chunked 会话清单此前只能从 66-stream.md 或 UI 拿，
  // 工具侧无法枚举 —— 现给条件对象，`saz_query({filter:{chunkedOnly:true}})` 直接可用。
  if (has(f.transferEncoding)) {
    const list = arr(f.transferEncoding);
    checks.push((s) => list.some((c) => String(s.respTransferEncoding || '').toLowerCase().includes(c)
      || String(s.reqTransferEncoding || '').toLowerCase().includes(c)));
    active.push('transferEncoding');
  }
  if (typeof f.chunkedOnly === 'boolean') {
    checks.push((s) => /chunked/i.test(String(s.respTransferEncoding || '')) === f.chunkedOnly);
    active.push('chunkedOnly');
  }
  if (typeof f.eventStreamOnly === 'boolean') {
    checks.push((s) => /event-stream/i.test(String(s.respContentType || '')) === f.eventStreamOnly);
    active.push('eventStreamOnly');
  }
  if (f.hasAuth === true) checks.push((s) => privacyKinds(s).includes('auth'));
  if (f.hasAuth === false) checks.push((s) => !privacyKinds(s).includes('auth'));
  if (f.hasAuth !== undefined) active.push('hasAuth');
  if (f.hasCookie === true) checks.push((s) => privacyKinds(s).includes('cookie'));
  if (f.hasCookie === false) checks.push((s) => !privacyKinds(s).includes('cookie'));
  if (f.hasCookie !== undefined) active.push('hasCookie');
  if (has(f.privacyKinds)) {
    const list = arr(f.privacyKinds);
    checks.push((s) => {
      const got = privacyKinds(s);
      return list.some((k) => got.includes(k));
    });
    active.push('privacyKinds');
  }
  if (f.hasRequestFields === true) checks.push((s) => (s.reqFields || []).length > 0);
  if (f.hasRequestFields === false) checks.push((s) => (s.reqFields || []).length === 0);
  if (f.hasRequestFields !== undefined) active.push('hasRequestFields');
  if (has(f.fieldNames)) {
    const list = arr(f.fieldNames);
    checks.push((s) => {
      const paths = fieldPathSet(s);
      return list.some((n) => paths.some((p) => p === n || p.endsWith('.' + n) || p.includes('[' + n + ']') || p.includes(n)));
    });
    active.push('fieldNames');
  }
  if (Array.isArray(f.sidRange)) {
    const [lo, hi] = f.sidRange;
    checks.push((s) => s.sid >= Number(lo) && s.sid <= Number(hi));
    active.push('sidRange');
  }
  if (Array.isArray(f.seqRange)) {
    const [lo, hi] = f.seqRange;
    checks.push((s) => s.seq >= Number(lo) && s.seq <= Number(hi));
    active.push('seqRange');
  }
  if (Array.isArray(f.bodyBytesRange)) {
    const [lo, hi] = f.bodyBytesRange;
    checks.push((s) => s.reqBodyBytes >= Number(lo) && s.reqBodyBytes <= Number(hi));
    active.push('bodyBytesRange');
  }
  if (Array.isArray(f.respBytesRange)) {
    const [lo, hi] = f.respBytesRange;
    checks.push((s) => s.respEntryPlainBytes >= Number(lo) && s.respEntryPlainBytes <= Number(hi));
    active.push('respBytesRange');
  }
  if (Array.isArray(f.durationRange)) {
    const [lo, hi] = f.durationRange;
    checks.push((s) => {
      const ms = s.timers && typeof s.timers.totalMs === 'number' ? s.timers.totalMs : -1;
      return ms >= Number(lo) && ms <= Number(hi);
    });
    active.push('durationRange');
  }
  if (f.decodedOkOnly) checks.push((s) => !s.respDecodeFailed);
  if (f.decodeFailedOnly) checks.push((s) => !!s.respDecodeFailed);
  if (f.decodedOkOnly || f.decodeFailedOnly) active.push('decode');
  if (typeof f.isWebSocket === 'boolean') {
    checks.push((s) => !!s.isWebSocket === f.isWebSocket);
    active.push('isWebSocket');
  }
  if (typeof f.hasWebSocketLog === 'boolean') {
    checks.push((s) => !!s.hasWs === f.hasWebSocketLog);
    active.push('hasWebSocketLog');
  }
  if (has(f.bodyContains)) {
    const list = arr(f.bodyContains);
    checks.push((s) => {
      const hay = sessionHaystack(s);
      return list.every((n) => hay.includes(n));
    });
    active.push('bodyContains');
  }
  if (f.search) {
    const q = String(f.search).toLowerCase();
    checks.push((s) => sessionHaystack(s).includes(q));
    active.push('search');
  }

  return {
    active,
    /** 无条件时全 true —— 默认取全集，符合"过滤只影响视图"的铁律。 */
    test: checks.length ? (s) => { for (const c of checks) if (!c(s)) return false; return true; } : () => true,
  };
}

/**
 * 执行取数。
 * @param {Array} sessions 索引产出的全量会话
 * @param {object} filter 条件对象
 * @param {{limit?:number, offset?:number, sort?:string, order?:'asc'|'desc'}} [page]
 */
function querySessions(sessions, filter, page) {
  const p = page || {};
  const pred = buildPredicate(filter);
  const matched = sessions.filter(pred.test);
  const sorted = p.sort ? sortBy(matched, p.sort, p.order) : matched;
  const limit = p.limit === undefined ? sorted.length : Math.max(0, Number(p.limit));
  const offset = Math.max(0, Number(p.offset) || 0);
  return {
    total: sessions.length,
    matched: sorted.length,
    returned: Math.min(limit, Math.max(0, sorted.length - offset)),
    offset,
    activeFilters: pred.active,
    items: sorted.slice(offset, offset + limit),
  };
}

/** 支持的排序键（其余值原样返回，不猜语义）。 */
const SORT_FIELDS = ['sid', 'seq', 'status', 'respEntryPlainBytes', 'reqBodyBytes', 'startedAt', 'totalMs', 'host'];

/** 取排序值；时间类从 timers 里取。 */
function sortValue(s, key) {
  if (key === 'startedAt') return s.timers && s.timers.startedAt !== null ? s.timers.startedAt : Number.MAX_SAFE_INTEGER;
  if (key === 'totalMs') return s.timers && typeof s.timers.totalMs === 'number' ? s.timers.totalMs : -1;
  return s[key];
}

/** 稳定排序。 */
function sortBy(list, key, order) {
  if (!SORT_FIELDS.includes(key)) return list;
  const dir = order === 'desc' ? -1 : 1;
  return list.slice().sort((a, b) => {
    const va = sortValue(a, key);
    const vb = sortValue(b, key);
    if (va === vb) return a.seq - b.seq;
    if (va === undefined || va === null) return 1;
    if (vb === undefined || vb === null) return -1;
    return (va > vb ? 1 : -1) * dir;
  });
}

/** 分组：按 urlTemplate / host / category / flow 等，返回 Map 兼容的数组形状。 */
function groupSessions(sessions, key) {
  const map = new Map();
  for (const s of sessions) {
    const k = key === 'urlTemplate' ? (s.urlTemplate || s.url || '(未知)')
      : key === 'host' ? (s.host || '(无 host)')
      : key === 'domain' ? (s.host || '(无 host)')
      : key === 'category' ? s.category
      : key === 'status' ? String(s.status || 0)
      : key === 'method' ? (s.method || 'REQ')
      : String(s[key]);
    if (!map.has(k)) map.set(k, []);
    map.get(k).push(s);
  }
  return [...map.entries()].map(([name, items]) => ({ key: name, count: items.length, items }))
    .sort((a, b) => b.count - a.count);
}

module.exports = {
  buildPredicate,
  querySessions,
  groupSessions,
  sortBy,
  compileRegex,
  SORT_FIELDS,
  fieldPathSet,
  privacyKinds,
};
