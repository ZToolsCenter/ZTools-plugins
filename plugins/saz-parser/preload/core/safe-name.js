'use strict';

/**
 * safe-name.js —— 文件与目录命名（A 层，修正原算法缺陷 B1/B2/B7）
 *
 * 命名规则必须同时满足：
 * 1. 导出模式与原解析SAZ.py 同构（`{seq}_{METHOD}_{host}_{path}`，`https___` 形态可被旧脚本复用）
 * 2. Windows/Linux/macOS 三平台都可写（用户要求全平台可用）
 * 3. 不被截断到产生重名（重名会导致会话互相覆盖，属数据丢失）
 */

/** Windows 保留设备名（不含扩展名判断，需单独处理 "CON.txt" 这类）。 */
const WIN_RESERVED = /^(con|prn|aux|nul|com[1-9]|lpt[1-8])$/i;

/** 各平台都安全的字符替换集合。 */
const ILLEGAL_RE = /[<>:"/\\|?*\u0000-\u001F]/g;

/**
 * 基础清洗：替换非法字符、压缩空白、去尾部点与空格（Windows 会静默丢弃这些）、
 * 拒绝保留名、限制长度。
 * @param {string} name
 * @param {{maxLen?:number, fallback?:string}} [opts]
 */
function sanitizeName(name, opts) {
  const o = opts || {};
  const maxLen = o.maxLen || 80;
  let s = String(name === undefined || name === null ? '' : name);
  s = s.replace(ILLEGAL_RE, '_');
  s = s.replace(/\s+/g, ' ').trim();
  // 去掉结尾的点与空格：Windows 写入时会静默剥离，导致名字与预期不符
  s = s.replace(/[. ]+$/g, '');
  if (!s) return o.fallback || 'unnamed';
  // 保留名检测（含 "CON.html" 这种带后缀形态）
  const stem = s.split('.')[0];
  if (WIN_RESERVED.test(stem)) s = '_' + s;
  if (s.length > maxLen) s = s.slice(0, maxLen).replace(/[. ]+$/g, '');
  return s || (o.fallback || 'unnamed');
}

/**
 * URL → 目录名片段。
 * 与原算法一致地把 `//` 压成 `__`、`:` 换 `_`（保证 `https___host_path` 形态可被旧脚本正则识别），
 * 但修正 B1：绝对 URL 不再与 Host 重复拼接。
 */
function urlToNameFragment(url, maxLen) {
  let s = String(url || '');
  s = s.replace(/:/g, '_');
  s = s.replace(/\/+/g, '/');
  s = s.replace(/\//g, '_');
  s = s.replace(/[?]/g, '_').replace(/[&=+%#,]/g, '_');
  s = s.replace(/_{2,}/g, '__');
  s = s.replace(/^_+|_+$/g, '');
  return sanitizeName(s, { maxLen: maxLen || 120, fallback: 'root' });
}

/**
 * 会话目录名。
 * @param {{seq:number, method?:string, host?:string, path?:string, url:string, sid:number, targetForm:string}} session
 * @param {{labelMaxLen?:number, lang?:string}} [opts]
 */
function sessionDirName(session, opts) {
  const o = opts || {};
  const seq = String(session.seq).padStart(3, '0');
  const method = (session.method || 'REQ').toUpperCase();
  const frag = urlToNameFragment(session.url || session.path || '', o.labelMaxLen || 120);
  // CONNECT 的 targetForm 为 authority，其 url 已含 host:port，不再叠加 host（修 B1）
  const name = seq + '_' + method + '_' + frag;
  // 追加 sid 保证唯一性：路径超长被截断时，不同会话不会互相覆盖
  return sanitizeName(name, { maxLen: 150, fallback: seq + '_sid' + session.sid }) + '__sid' + session.sid;
}

/**
 * 校验完整路径长度预算；超长时进一步压缩中段（保留 seq 与 sid）。
 * @param {string} root 输出根目录绝对路径
 * @param {string} dirName 会话目录名
 * @param {string} fileName 文件名
 * @param {number} limit 预算上限，默认 240（留余量给 Windows MAX_PATH 260）
 */
function fitsPath(root, dirName, fileName, limit) {
  const cap = limit || 240;
  return (root + '\\' + dirName + '\\' + fileName).length <= cap;
}

/** 逐层压缩目录名直到满足路径预算。 */
function shrinkDirName(root, dirName, fileName, limit) {
  let name = dirName;
  const cap = limit || 240;
  let guard = 0;
  while (!fitsPath(root, name, fileName, cap) && guard < 12) {
    const keep = Math.max(40, name.length - 30 * (guard + 1));
    const m = /^(.*?)(__sid\d+)$/.exec(name);
    name = m ? m[1].slice(0, Math.max(10, keep - m[2].length)) + m[2] : name.slice(0, keep);
    guard++;
  }
  return name;
}

/** 文件名语言映射：中文（默认，贴近原算法）或英文（跨平台协作更稳）。 */
const NAME_TABLE = {
  zh: { request: '请求', requestBody: '请求体', response: '响应', responseBody: '响应体', meta: '会话元数据', decodeFailed: '未解码' },
  en: { request: 'request', requestBody: 'request-body', response: 'response', responseBody: 'response-body', meta: 'session-meta', decodeFailed: 'undecoded' },
};

/** 取当前语言下的标准文件名。 */
function roleFileName(role, lang) {
  const t = NAME_TABLE[lang] || NAME_TABLE.zh;
  return t[role] || role;
}

/** 同名冲突处理：追加 `(n)`，保证一批会话不会互相覆盖。 */
function makeUnique(name, used) {
  if (!used.has(name)) { used.add(name); return name; }
  let i = 2;
  while (used.has(name + '(' + i + ')')) i++;
  const out = name + '(' + i + ')';
  used.add(out);
  return out;
}

module.exports = {
  sanitizeName,
  urlToNameFragment,
  sessionDirName,
  fitsPath,
  shrinkDirName,
  roleFileName,
  makeUnique,
  NAME_TABLE,
  WIN_RESERVED,
};
