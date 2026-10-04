'use strict';

/**
 * privacy.js —— 隐私字段识别（A 层 · F18）
 *
 * 设计原则（用户明确指令）：
 * 隐私字段的值**默认完整保留**，这里只打"类型标签"用于检索、聚合与摘要呈现；
 * 打标签绝不修改、遮蔽或删除任何字节。折叠/打码只在用户显式选择时，
 * 以另存副本的形式发生。
 *
 * 依据：SAZ 的用途是协议还原与登录/注册流程分析，Cookie、Authorization、token、
 * sign、device_id 本身就是研究对象。原样保留是功能正确性的一部分。
 */

/** 头字段专用规则（只看 header 名）。 */
const HEADER_RULES = [
  { kind: 'auth', re: /^(authorization|proxy-authorization|x-authorization|x-auth-token|x-access-token)$/i },
  { kind: 'cookie', re: /^(cookie|set-cookie|xsrf-token|x-xsrf-token|csrf-token|x-csrf-token)$/i },
  { kind: 'token', re: /(access[-_]?token|id[-_]?token|refresh[-_]?token|bearer[-_]?token|api[-_]?key|apikey)$/i },
  { kind: 'secret', re: /(client[-_]?secret|app[-_]?secret|x[-_]?sign|signature|x[-_]?nonce)$/i },
  { kind: 'device', re: /^(x[-_]?device[-_]?id|deviceid|device[-_]?id|imei|meid|android[-_]?id|idfa|idfv|oaid|utdid|umid|mac[-_]?address|serial[-_]?number)$/i },
  { kind: 'account', re: /^(x[-_]?uid|x[-_]?user[-_]?id|user[-_]?id|uid|openid|unionid)$/i },
];

/** 通用键名规则（用于 query、body 字段、cookie 项）。 */
const KEY_RULES = [
  { kind: 'token', re: /^(access[-_]?token|id[-_]?token|refresh[-_]?token|token|auth[-_]?token|jwt|session[-_]?key|sessionid|sid)$/i },
  { kind: 'secret', re: /(password|passwd|pwd|client[-_]?secret|app[-_]?secret|secret[-_]?key|private[-_]?key|signature|nonce|appkey|app[-_]?key|sign)$/i },
  { kind: 'cookie', re: /^(cookie|cookies)$/i },
  { kind: 'device', re: /(device[-_]?id|devicetype|imei|android[-_]?id|idfa|idfv|oaid|utdid|umid|mac[-_]?addr|guid|client[-_]?version|build[-_]?number)$/i },
  { kind: 'account', re: /^(username|user[-_]?name|nickname|phone|mobile|tel|email|mail|account|passportid|uid|user[-_]?id|openid|unionid)$/i },
];

/**
 * 给一个字段名打隐私类型标签。
 * @param {string} name 字段/键名
 * @param {boolean} isHeader 是否为 HTTP 头名（头名规则更严格）
 * @returns {{kind:string}|null}
 */
function tagField(name, isHeader) {
  if (!name) return null;
  const n = String(name).trim();
  const rules = isHeader ? HEADER_RULES : KEY_RULES;
  for (const r of rules) if (r.re.test(n)) return { kind: r.kind };
  // 头字段也可能命中通用键名规则（如 X-Token-Value）
  if (isHeader) for (const r of KEY_RULES) if (r.re.test(n)) return { kind: r.kind };
  return null;
}

/** 标签集合的中文名，用于概览与 UI 展示。 */
const KIND_LABEL = {
  auth: '鉴权头',
  token: '令牌',
  cookie: 'Cookie/CSRF',
  secret: '密钥/签名',
  device: '设备标识',
  account: '账号信息',
};

/**
 * 扫描头部，返回带标签的隐私字段清单（值原样保留在 value 中）。
 * @param {Array<{name:string,value:string}>} headers
 */
function scanHeaders(headers) {
  const out = [];
  for (const h of headers || []) {
    const tag = tagField(h.name, true);
    if (!tag) continue;
    out.push({
      name: h.name,
      kind: tag.kind,
      value: h.value,
      valueLength: String(h.value || '').length,
    });
  }
  return out;
}

/**
 * 扫描 KV 列表（query 解析结果或 body 字段），返回带标签项。
 * @param {Array<{key:string,value?:string,name?:string}>} items
 */
function scanFields(items) {
  const out = [];
  for (const it of items || []) {
    const name = it.key || it.name;
    const tag = tagField(name, false);
    if (!tag) continue;
    out.push({
      name: name,
      kind: tag.kind,
      value: it.value === undefined ? null : it.value,
      valueLength: it.value === undefined ? 0 : String(it.value).length,
    });
  }
  return out;
}

/**
 * 从 Cookie 头值里拆出各 cookie 项并打标签（不改变原值）。
 * `a=1; b=2` → [{name:'a',value:'1'},...]
 */
function parseCookieHeader(value) {
  const out = [];
  if (!value) return out;
  for (const part of String(value).split(';')) {
    const seg = part.trim();
    if (!seg) continue;
    const eq = seg.indexOf('=');
    if (eq <= 0) { out.push({ name: seg, value: '' }); continue; }
    out.push({ name: seg.slice(0, eq).trim(), value: seg.slice(eq + 1).trim() });
  }
  return out;
}

/** 把标签数组聚合成 {kind: count}，用于概览统计。 */
function tally(tags) {
  const acc = {};
  for (const t of tags) acc[t.kind] = (acc[t.kind] || 0) + 1;
  return acc;
}

module.exports = {
  tagField,
  scanHeaders,
  scanFields,
  parseCookieHeader,
  tally,
  KIND_LABEL,
  HEADER_RULES,
  KEY_RULES,
};
