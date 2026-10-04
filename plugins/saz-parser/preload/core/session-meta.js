'use strict';

/**
 * session-meta.js —— raw/<sid>_m.xml 会话元数据解析（A 层 · F11 / F23 主轴）
 *
 * 原算法完全丢弃这个文件（缺陷 B8），而它恰好是"分析业务流程"最需要的东西：
 * SessionTimers 提供每个阶段的绝对时间戳与 TCP/DNS/Gateway 耗时，
 * 有了时序才谈得上把 3756 条会话聚合成"注册流程 / 登录流程 / 刷新链"。
 *
 * 时间戳形如 `2026-04-25T01:56:42.7727322+08:00`（7 位小数 + 时区偏移）。
 * Date.parse 对超 3 位小数的实现相关性较高，因此这里做**显式手写解析**，
 * 保证跨平台（Windows/Linux/macOS 的 Node）结果一致。
 */

/** Session 根元素属性。 */
const SESSION_ATTR_RE = /<Session\b([^>]*)>/i;
/** SessionTimers 元素属性。 */
const TIMERS_RE = /<SessionTimers\b([^>]*)>/i;
/** 通用属性提取。 */
const ATTR_RE = /([\w:.-]+)\s*=\s*"([^"]*)"/g;

/** 需要参与耗时计算的计时器（按 Fiddler 语义排序）。 */
const TIMER_ORDER = [
  'ClientConnected', 'ClientBeginRequest', 'GotRequestHeaders', 'ClientDoneRequest',
  'ServerConnected', 'FiddlerBeginRequest', 'ServerGotRequest', 'ServerBeginResponse',
  'GotResponseHeaders', 'ServerDoneResponse', 'ClientBeginResponse', 'ClientDoneResponse',
];

/** 数值型耗时字段（单位 ms，非时间戳）。 */
const NUMERIC_FIELDS = ['GatewayTime', 'DNSTime', 'TCPConnectTime', 'ServerTime', 'OverallElapsed'];

/**
 * 手写 ISO 时间解析：返回 epoch 毫秒，解析失败返回 null。
 * 支持 `YYYY-MM-DDTHH:mm:ss(.f+)±HH:MM` 与省略时区（按本地时区不可靠，故按 UTC 处理）。
 */
function parseTimestamp(value) {
  if (!value) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2}):(\d{2})(?:\.(\d+))?(\+\d{2}:\d{2}|\-\d{2}:\d{2}|Z)?$/
    .exec(String(value).trim());
  if (!m) return null;
  const year = Number(m[1]);
  const month = Number(m[2]) - 1;
  const day = Number(m[3]);
  const hour = Number(m[4]);
  const min = Number(m[5]);
  const sec = Number(m[6]);
  const fracStr = m[7] || '';
  const fracMs = fracStr ? Math.floor(Number(('' + fracStr).slice(0, 3).padEnd(3, '0'))) : 0;
  let epoch = Date.UTC(year, month, day, hour, min, sec, fracMs);
  const zone = m[8];
  if (zone && zone !== 'Z') {
    const sign = zone[0] === '-' ? -1 : 1;
    const zh = Number(zone.slice(1, 3));
    const zm = Number(zone.slice(4, 6));
    epoch -= sign * (zh * 3600 + zm * 60) * 1000;
  }
  return Number.isFinite(epoch) ? epoch : null;
}

/** 从元素标签文本中提取全部属性为对象。 */
function attrsOf(fragment) {
  const out = {};
  if (!fragment) return out;
  let m;
  ATTR_RE.lastIndex = 0;
  while ((m = ATTR_RE.exec(fragment)) !== null) out[m[1].toLowerCase()] = m[2];
  return out;
}

/**
 * 解析 _m.xml 文本。
 * @param {string|Buffer} xmlText
 * @returns {{sid:string, flags:object|null, certPolicy:string|null, timers:object, numeric:object, derived:object, raw:object}}
 */
function parseSessionXml(xmlText) {
  const text = Buffer.isBuffer(xmlText) ? xmlText.toString('utf8') : String(xmlText || '');
  const res = {
    sid: null,
    uiSharedId: null,
    bitFlags: null,
    flags: null,
    certPolicyErrors: null,
    clientIP: null,
    timers: {},
    numeric: {},
    derived: {},
    parseFailed: !text,
  };
  if (!text) return res;

  const sM = SESSION_ATTR_RE.exec(text);
  const sAttrs = attrsOf(sM ? sM[1] : '');
  res.sid = sAttrs['sid'] || null;
  res.uiSharedId = sAttrs['ui-shared-id'] || null;
  res.bitFlags = sAttrs['bitflags'] !== undefined ? Number(sAttrs['bitflags']) : null;
  res.certPolicyErrors = sAttrs['servercertificatepolicyerrors'] || null;
  res.clientIP = sAttrs['clientip'] || null;

  const tM = TIMERS_RE.exec(text);
  const tAttrs = attrsOf(tM ? tM[1] : '');
  for (const key of TIMER_ORDER) {
    const rawVal = tAttrs[key.toLowerCase()];
    if (rawVal === undefined) continue;
    const ms = parseTimestamp(rawVal);
    if (ms !== null) res.timers[key.toLowerCase()] = ms;
  }
  for (const key of NUMERIC_FIELDS) {
    const rawVal = tAttrs[key.toLowerCase()];
    if (rawVal === undefined) continue;
    const n = Number(rawVal);
    if (Number.isFinite(n)) res.numeric[key.toLowerCase()] = n;
  }

  const g = (k) => res.timers[k] === undefined ? null : res.timers[k];
  const cb = g('clientbeginrequest');
  const cdr = g('clientdoneresponse');
  const grh = g('gotresponseheaders');
  const sc = g('serverconnected');
  const cc = g('clientconnected');

  if (cb !== null && cdr !== null) res.derived.totalMs = Math.max(0, cdr - cb);
  if (cb !== null && grh !== null) res.derived.ttfbMs = Math.max(0, grh - cb);
  if (cc !== null && sc !== null) res.derived.connectMs = Math.max(0, sc - cc);
  res.derived.startedAt = cb !== null ? cb : (cc !== null ? cc : null);
  res.derived.startedAtIso = res.derived.startedAt !== null ? new Date(res.derived.startedAt).toISOString() : null;
  if (res.numeric.overallelapsed !== undefined && !res.derived.totalMs) res.derived.totalMs = res.numeric.overallelapsed;

  return res;
}

/**
 * BitFlags 位拆解。
 * ⚠️ Fiddler 未公开权威定义表，这里只标出**从样本可推断**的通用位含义，
 * 其余位一律以 raw + set 列表形式保留，不做伪确定性解释。
 */
const FLAG_BITS = [
  { bit: 0, name: 'bit0' },
  { bit: 1, name: 'tunnelOrHttps' },
  { bit: 9, name: 'bit9(常伴随 HTTP/2 会话)' },
];

/** 返回 {raw, set:[bitIndex...], hints:[name...]}。 */
function decodeBitFlags(value) {
  if (value === null || value === undefined || Number.isNaN(Number(value))) return null;
  const n = Number(value);
  const set = [];
  const hints = [];
  for (let b = 0; b < 32; b++) {
    if (n & (1 << b)) {
      set.push(b);
      const f = FLAG_BITS.find((x) => x.bit === b);
      if (f) hints.push(f.name);
    }
  }
  return { raw: n, set, hints };
}

/** 把解析结果收敛成索引里需要的轻量形状（避免每条会话都挂着大对象）。 */
function metaForIndex(meta) {
  return {
    startedAt: meta.derived.startedAt,
    startedAtIso: meta.derived.startedAtIso,
    totalMs: meta.derived.totalMs === undefined ? null : meta.derived.totalMs,
    ttfbMs: meta.derived.ttfbMs === undefined ? null : meta.derived.ttfbMs,
    connectMs: meta.derived.connectMs === undefined ? null : meta.derived.connectMs,
    certPolicyErrors: meta.certPolicyErrors,
    bitFlags: meta.bitFlags,
  };
}

module.exports = {
  parseSessionXml,
  parseTimestamp,
  decodeBitFlags,
  metaForIndex,
  TIMER_ORDER,
};
