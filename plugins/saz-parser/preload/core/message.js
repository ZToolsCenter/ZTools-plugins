'use strict';

/**
 * message.js —— HTTP 原始报文解析（A 层 · 数据保真）
 *
 * SAZ 的 raw/*_c.txt 与 raw/*_s.txt 是**线上格式原始字节**（wire format），
 * 不是解码后的结构化数据，因此这里只做字节级切分与文本解析，绝不做任何内容改写。
 *
 * 字节保真原则（第一目的基线 1）：
 * - 头部原文一律以 Buffer 切片形式保留（rawHeaderBuf），写盘时直接回写原始字节；
 * - 解析出来的字符串仅用于分析与展示，不作为唯一事实来源；
 * - 头字段值内部用 latin1 承载，保证 1 字节 1 字符、可无损还原。
 *
 * 已修正原算法缺陷 B1：请求目标（target）为绝对 URL 或 CONNECT authority 时不再与 Host 拼接。
 */

const METHODS = ['GET', 'POST', 'PUT', 'DELETE', 'HEAD', 'OPTIONS', 'PATCH', 'CONNECT', 'TRACE'];

const CRLF_CRLF = Buffer.from('\r\n\r\n', 'latin1');
const LF_LF = Buffer.from('\n\n', 'latin1');

/**
 * 按 \r
\r
（退化 

）分离头部与体部。
 * 返回的索引相对 buf，体部为零拷贝切片视图。
 */
function splitHeaderBody(buf) {
  let idx = buf.indexOf(CRLF_CRLF);
  if (idx >= 0) {
    return { headerBuf: buf.subarray(0, idx), bodyBuf: buf.subarray(idx + 4), sep: '\r\n\r\n' };
  }
  idx = buf.indexOf(LF_LF);
  if (idx >= 0) {
    return { headerBuf: buf.subarray(0, idx), bodyBuf: buf.subarray(idx + 2), sep: '\n\n' };
  }
  // 无分隔符：整块视为头部（GET 无体且无尾部空行的抓包记录）
  return { headerBuf: buf, bodyBuf: buf.subarray(buf.length), sep: '' };
}

/** 头部字节转解析用字符串（latin1 无损）。 */
function headerText(headerBuf) {
  return headerBuf.toString('latin1');
}

/**
 * 解析头部块：起始行 + 头字段表。
 * 支持 obs-fold（续行以空格/Tab 开头）。
 */
function parseHeaderBlock(headerBuf) {
  const text = headerText(headerBuf);
  const lines = text.split(/\r?\n/);
  const startLine = lines.length > 0 ? lines[0] : '';
  const headers = [];
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i];
    if (!line) continue;
    const ci = line.indexOf(':');
    if (ci <= 0) continue;
    const name = line.slice(0, ci).trim();
    let value = line.slice(ci + 1);
    // obs-fold：下一行以空白开头则属于同一字段
    while (i + 1 < lines.length && /^[ \t]/.test(lines[i + 1])) {
      i++;
      value += ' ' + lines[i].trim();
    }
    value = value.replace(/^[ \t]+/, '');
    headers.push({ name, lower: name.toLowerCase(), value });
  }
  return { startLine, headers, text };
}

/** 取某个头字段的值（首个匹配）。 */
function headerValue(headers, lowerName) {
  for (const h of headers) if (h.lower === lowerName) return h.value;
  return null;
}

/** 取某个头字段的全部值（如 Set-Cookie 可多次出现）。 */
function headerValues(headers, lowerName) {
  const out = [];
  for (const h of headers) if (h.lower === lowerName) out.push(h.value);
  return out;
}

/**
 * 解析请求起始行：`METHOD TARGET [HTTP/x.y]`
 *
 * target 的三种真实形态（本机实测）：
 * - 绝对 URL：`https://host/path?q`（HTTPS 解密会话，占非 CONNECT 的 100%）
 * - 相对路径：`/path?q`（HTTP 会话）
 * - authority：`host:443`（CONNECT 隧道，无 scheme）
 */
function parseRequestLine(startLine) {
  const m = /^([A-Z]+)\s+(\S+)(?:\s+(HTTP\/\d(?:\.\d)?))?\s*$/i.exec(startLine);
  if (!m) {
    return { ok: false, method: null, target: startLine, httpVersion: null };
  }
  return {
    ok: true,
    method: m[1].toUpperCase(),
    target: m[2],
    httpVersion: m[3] || null,
  };
}

/**
 * 解析响应起始行：`HTTP/x.y STATUS REASON`
 *
 * 必须宽容的真实形态（本机实测）：
 * - `HTTP/1.1 0 FIDDLER GENERATED - RESPONSE DATA WAS MISSING`
 *   Fiddler 在丢响应时写入状态码 **0**（1~2 位）的占位行，原正则 `(\d{3})` 直接判为解析失败；
 * - `HTTP/1.1 200`（无 reason phrase）。
 * 这类占位行本身是"数据缺失"的事实记录，必须解出来并打标，不能当解析错误丢弃。
 */
function parseStatusLine(startLine) {
  const m = /^(HTTP\/(\d(?:\.\d)?))\s+(\d{1,3})(?:\s+(.*))?$/.exec(startLine.trim());
  if (!m) return { ok: false, httpVersion: null, status: 0, statusText: '', statusAbnormal: '起始行无法解析' };
  const status = Number(m[3]);
  const reason = (m[4] || '').trim();
  return {
    ok: true,
    httpVersion: m[1],
    httpMajor: Number(m[2]) || 0,
    status,
    statusText: reason,
    // 状态码 0 或非标准三位码 = Fiddler 占位，语义是"响应不存在/不完整"
    statusAbnormal: (status === 0 || status < 100 || status > 599)
      ? (reason || '非标准状态码 ' + m[3])
      : null,
    isFiddlerPlaceholder: /^FIDDLER GENERATED/i.test(reason),
  };
}

/** 安全解析绝对 URL，失败返回 null（不抛异常，抓包数据常有畸形 URL）。 */
function parseAbsoluteUrl(target) {
  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(target)) return null;
  try {
    const u = new URL(target);
    return {
      scheme: u.protocol.replace(/:$/, '').toLowerCase(),
      host: u.hostname,
      port: u.port ? Number(u.port) : (u.protocol === 'https:' ? 443 : 80),
      path: u.pathname || '/',
      search: u.search || '',
      query: u.search ? u.search.slice(1) : '',
      hash: u.hash || '',
    };
  } catch (e) {
    return null;
  }
}

/** 拆解相对路径为 path + query。 */
function splitPathQuery(target) {
  const hashAt = target.indexOf('#');
  let t = hashAt >= 0 ? target.slice(0, hashAt) : target;
  const qAt = t.indexOf('?');
  if (qAt >= 0) return { path: t.slice(0, qAt), query: t.slice(qAt + 1) };
  return { path: t, query: '' };
}

/**
 * 归一化 URL 模板（F17 元特征核心）：把路径里的动态段折叠，便于同接口聚类。
 * 规则：纯数字 / 长十六进制串(>=12) / UUID / JWT 样式的点分段 → 占位符。
 */
function normalizeUrlTemplate(path) {
  if (!path) return '/';
  const segs = path.split('/');
  const out = [];
  let folded = 0;
  for (const seg of segs) {
    if (!seg) { out.push(seg); continue; }
    if (/^\d+$/.test(seg)) { out.push('{num}'); folded++; continue; }
    if (/^[0-9a-f]{12,}$/i.test(seg)) { out.push('{hex}'); folded++; continue; }
    if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(seg)) { out.push('{uuid}'); folded++; continue; }
    if (/^[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}/.test(seg)) { out.push('{jwt}'); folded++; continue; }
    out.push(seg);
  }
  return { template: out.join('/') || '/', foldedSegments: folded };
}

/**
 * 组装请求的完整 URL 视图（修正 B1：绝对 target 不再与 Host 拼接）。
 * @returns {{url:string, host:string, scheme:string, path:string, query:string, targetForm:string}}
 */
function resolveRequestUrl(reqLine, headers) {
  const abs = parseAbsoluteUrl(reqLine.target);
  if (abs) {
    return {
      targetForm: 'absolute',
      scheme: abs.scheme,
      host: abs.host,
      port: abs.port,
      path: abs.path,
      query: abs.query,
      url: reqLine.target,
    };
  }
  const hostHeader = headerValue(headers, 'host') || '';
  const sp = splitPathQuery(reqLine.target);
  if (reqLine.method === 'CONNECT') {
    // CONNECT 的 target 本身就是 authority（host:port），不存在 path。
    // 两处关键处理：
    // 1) 不再与 Host 头拼接（原算法此处双拼，实测 467 个旧产物目录中 52 个中招）；
    // 2) url 字段不得掺入方法名——否则目录名会退化成 "CONNECT_CONNECT_host_443"，
    //    且下游按 url 取域名的逻辑会被前缀污染。url 统一为纯 authority。
    const authority = reqLine.target;
    const cHost = authority.replace(/:\d+$/, '');
    const portMatch = /:(\d+)$/.exec(authority);
    const cPort = portMatch ? (Number(portMatch[1]) || 0) : 0;
    return {
      targetForm: 'authority',
      scheme: 'connect',
      host: cHost,
      port: cPort,
      authority,
      path: '',
      query: '',
      url: authority,
    };
  }
  const host = hostHeader.replace(/:\d+$/, '');
  return {
    targetForm: 'relative',
    scheme: 'http',
    host,
    port: hostHeader.includes(':') ? Number(hostHeader.split(':')[1]) || 0 : 0,
    path: sp.path,
    query: sp.query,
    url: (hostHeader ? 'http://' + hostHeader : '') + sp.path + (sp.query ? '?' + sp.query : ''),
  };
}

/** 把 query 串解成 [{key,value,raw}]，保留重复 key，不做 URL 解码以外的加工。 */
function parseQueryString(qs) {
  const out = [];
  if (!qs) return out;
  for (const pair of qs.split('&')) {
    if (!pair) continue;
    const eq = pair.indexOf('=');
    const rawKey = eq === -1 ? pair : pair.slice(0, eq);
    const rawVal = eq === -1 ? '' : pair.slice(eq + 1);
    out.push({ key: safeDecode(rawKey), value: safeDecode(rawVal), raw: rawVal });
  }
  return out;
}

/** 宽容解码：失败时返回原串，绝不因为一个畸形百分号编码丢掉整条会话。 */
function safeDecode(s) {
  try {
    return decodeURIComponent(s.replace(/\+/g, ' '));
  } catch (e) {
    try { return decodeURI(s); } catch (e2) { return s; }
  }
}

/**
 * 解析一条报文（请求或响应）。
 * @param {Buffer} buf raw 条目明文（可能是前缀截断版本）
 * @param {'request'|'response'} kind
 * @param {boolean} bodyTruncated 体部是否因前缀读取而被截断
 */
function parseMessage(buf, kind, bodyTruncated) {
  const { headerBuf, bodyBuf, sep } = splitHeaderBody(buf);
  const block = parseHeaderBlock(headerBuf);
  const res = {
    kind,
    startLine: block.startLine,
    headers: block.headers,
    headerText: block.text,
    headerRawBuf: headerBuf,
    bodyBuf,
    separator: sep,
    parseError: null,
    bodyTruncated: !!bodyTruncated,
    httpVersion: null,
    method: null,
    status: 0,
    statusText: '',
    url: '',
    host: '',
    scheme: '',
    path: '',
    query: '',
    targetForm: '',
    urlTemplate: '',
    contentType: headerValue(block.headers, 'content-type') || '',
    contentEncoding: headerValue(block.headers, 'content-encoding') || '',
    contentLength: headerValue(block.headers, 'content-length') || '',
    // Transfer-Encoding 与 Content-Encoding 是两层东西：前者是分块框架（chunked），后者才是压缩。
    // 只处理后者会把长度行当成正文的一部分（实测 36/36 条 chunked 响应整块 JSON 解析失败）。
    transferEncoding: headerValue(block.headers, 'transfer-encoding') || '',
  };

  if (kind === 'request') {
    const rl = parseRequestLine(block.startLine);
    res.httpVersion = rl.httpVersion;
    res.method = rl.method;
    if (!rl.ok) res.parseError = '请求行无法解析: ' + block.startLine.slice(0, 120);
    const u = resolveRequestUrl(rl, block.headers);
    Object.assign(res, {
      url: u.url, host: u.host, scheme: u.scheme, path: u.path,
      query: u.query, targetForm: u.targetForm, port: u.port,
    });
    const tpl = normalizeUrlTemplate(u.path);
    res.urlTemplate = tpl.template;
    res.foldedSegments = tpl.foldedSegments;
    res.hasHostHeader = !!headerValue(block.headers, 'host');
  } else {
    const sl = parseStatusLine(block.startLine);
    res.httpVersion = sl.httpVersion;
    res.status = sl.status;
    res.statusText = sl.statusText;
    if (!sl.ok) res.parseError = '状态行无法解析: ' + block.startLine.slice(0, 120);
    // Fiddler 占位响应等异常状态单独留痕：它不是解析失败，而是抓包本身缺数据
    res.statusAbnormal = sl.statusAbnormal || null;
    res.isFiddlerPlaceholder = !!sl.isFiddlerPlaceholder;
    res.setCookieCount = headerValues(block.headers, 'set-cookie').length;
  }
  return res;
}

module.exports = {
  METHODS,
  splitHeaderBody,
  parseHeaderBlock,
  headerValue,
  headerValues,
  parseRequestLine,
  parseStatusLine,
  parseAbsoluteUrl,
  resolveRequestUrl,
  normalizeUrlTemplate,
  parseQueryString,
  parseMessage,
  safeDecode,
  headerText,
};
