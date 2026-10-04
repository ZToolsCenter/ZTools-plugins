'use strict';

/**
 * types.js —— Content-Type 判定、扩展名安全化、会话三档分类（A 层）
 *
 * 分类语义铁律（第一目的基线 1 / 设计 4.3）：
 * 三档只用于**视图默认显示**与**分析包详细度选择**，
 * 任何一档都不允许在数据层丢弃字节。B 档（JS/CSS/HTML 逻辑素材）
 * 永不从分析包中排除——本机实测 JS 类响应 1586 条 > JSON 1305 条，
 * 登录/注册流程的签名与加密实现恰恰在这些 JS 里。
 */

/** Content-Type 基础值 → 首选扩展名（沿用原算法映射，但一律过 safeExt 校验）。 */
const EXT_BY_TYPE = {
  'text/html': '.html',
  'text/css': '.css',
  'text/javascript': '.js',
  'application/javascript': '.js',
  'application/x-javascript': '.js',
  'application/ecmascript': '.js',
  'text/json': '.json',
  'application/json': '.json',
  'application/xml': '.xml',
  'text/xml': '.xml',
  'text/plain': '.txt',
  'text/markdown': '.md',
  'text/csv': '.csv',
  'text/srt': '.srt',
  'text/vtt': '.vtt',
  'text/event-stream': '.sse',
  'application/x-www-form-urlencoded': '.txt',
  'multipart/form-data': '.txt',
  'application/pdf': '.pdf',
  'application/zip': '.zip',
  'application/gzip': '.gz',
  'application/x-protobuf': '.pb',
  'application/grpc': '.grpc',
  'application/octet-stream': '.bin',
  'binary/octet-stream': '.bin',
  'application/wasm': '.wasm',
  'application/x-shockwave-flash': '.swf',
  'application/vnd.apple.mpegurl': '.m3u8',
  'application/x-mpegurl': '.m3u8',
  'application/dash+xml': '.mpd',
  'image/png': '.png',
  'image/jpeg': '.jpg',
  'image/gif': '.gif',
  'image/webp': '.webp',
  'image/avif': '.avif',
  'image/apng': '.apng',
  'image/bmp': '.bmp',
  'image/tiff': '.tiff',
  'image/svg+xml': '.svg',
  'image/x-icon': '.ico',
  'image/vnd.microsoft.icon': '.ico',
  'audio/mpeg': '.mp3',
  'audio/mp4': '.m4a',
  'audio/ogg': '.ogg',
  'audio/wav': '.wav',
  'audio/webm': '.weba',
  'video/mp4': '.mp4',
  'video/webm': '.webm',
  'video/ogg': '.ogv',
  'video/mp2t': '.ts',
  'video/quicktime': '.mov',
  'font/woff': '.woff',
  'font/woff2': '.woff2',
  'font/ttf': '.ttf',
  'font/otf': '.otf',
};

/** 可以"头部与正文分离并单独成文"的文本类型（原算法 EXTRACTABLE_TEXT_TYPES 等价集合）。 */
const EXTRACTABLE = new Set([
  'application/json', 'text/json', 'application/javascript', 'text/javascript',
  'application/x-javascript', 'text/css', 'text/html', 'application/xml', 'text/xml',
  'text/plain', 'application/x-www-form-urlencoded',
]);

/** URL 末段静态资源后缀（判定噪声用）。 */
const STATIC_EXT_RE = /\.(gif|png|jpe?g|webp|avif|apng|bmp|ico|svg|css|js|mjs|css\.map|js\.map|woff2?|ttf|otf|eot|mp4|webm|mov|m4a|mp3|ogg|wav|m3u8|ts|wasm|pdf|zip|gz|br|apk|ipa|crx|pngs)\b/i;

/** 扩展名硬校验（修正原算法缺陷 B2：`image/` → `.`、`image/x.fb.keyframes` → 超长怪名）。 */
function safeExt(ext) {
  if (!ext) return '';
  let e = String(ext).toLowerCase();
  if (!e.startsWith('.')) e = '.' + e;
  if (!/^\.[a-z0-9]{1,8}$/.test(e)) return '';
  return e;
}

/** 解析 `text/html; charset=utf-8` → { base, params } */
function parseContentType(ct) {
  if (!ct) return { base: '', params: {} };
  const parts = String(ct).split(';');
  const base = parts.shift().trim().toLowerCase();
  const params = {};
  for (const p of parts) {
    const eq = p.indexOf('=');
    if (eq <= 0) continue;
    params[p.slice(0, eq).trim().toLowerCase()] = p.slice(eq + 1).trim().replace(/^["']|["']$/g, '');
  }
  return { base, params };
}

/** 取字符集声明（无则 null，由上层按内容嗅探）。 */
function charsetOf(ct) {
  const { params } = parseContentType(ct);
  return params.charset ? params.charset.toLowerCase() : null;
}

/** 是否属于"需要单独成文并美化"的文本类型。 */
function isExtractable(ct) {
  const { base } = parseContentType(ct);
  return EXTRACTABLE.has(base) || base.endsWith('+json') || base === 'application/x-ndjson';
}

/** 该 Content-Type 对应的扩展名（找不到返回空串，由上层用 URL 兜底）。 */
function extForContentType(ct) {
  const { base } = parseContentType(ct);
  if (!base) return '';
  if (EXT_BY_TYPE[base]) return EXT_BY_TYPE[base];
  if (base.endsWith('+json')) return '.json';
  if (base.endsWith('+xml')) return '.xml';
  // 通用前缀规则：image/xxx → .xxx，但必须过 safeExt（避免 .x.fb.keyframes 这种）
  for (const prefix of ['image/', 'audio/', 'video/', 'font/', 'model/']) {
    if (base.startsWith(prefix)) {
      const sub = base.slice(prefix.length).split('+')[0];
      const ext = safeExt(sub);
      if (ext) return ext;
      return '';
    }
  }
  return '';
}

/** 从 URL 路径猜扩展名（保留原算法行为，但同样过 safeExt）。 */
function extFromUrl(urlPath) {
  if (!urlPath) return '';
  const path = String(urlPath).split('?')[0].split('#')[0];
  let last = path.replace(/\/+$/, '').split('/').pop() || '';
  try { last = decodeURIComponent(last); } catch (e) { /* 保留原串 */ }
  const dot = last.lastIndexOf('.');
  if (dot <= 0 || dot === last.length - 1) return '';
  return safeExt(last.slice(dot + 1));
}

/** 是否文本可读（用于决定正文以文本还是二进制呈现）。 */
function isTextualType(ct) {
  const { base } = parseContentType(ct);
  if (!base) return null; // 未知，交给字节嗅探
  if (base.startsWith('text/')) return true;
  if (EXTRACTABLE.has(base)) return true;
  if (base.endsWith('+json') || base.endsWith('+xml') || base === 'application/x-ndjson') return true;
  if (/^application\/(.*\.)?(json|xml|javascript|graphql|yaml|x-yaml)$/.test(base)) return true;
  if (base === 'application/x-www-form-urlencoded' || base === 'multipart/form-data') return true;
  if (/^application\/(octet-stream|grpc|x-protobuf|wasm|zip|gzip|x-dosexe)/.test(base)) return false;
  return null; // 交字节嗅探
}

/**
 * 会话三档分类。
 * @param {{method?:string,status?:number,reqContentType?:string,respContentType?:string,urlPath?:string,reqHasBody?:boolean,respHasBody?:boolean,isWebSocket?:boolean,hasWebSocketLog?:boolean,wsFrameCount?:number}} s
 * @returns {{category:'api'|'logic'|'noise',reasons:string[]}}
 */
function classifySession(s) {
  const reasons = [];
  const method = (s.method || '').toUpperCase();
  const respBase = parseContentType(s.respContentType).base;
  const reqBase = parseContentType(s.reqContentType).base;

  // C 档：隧道（本机实测 CONNECT 322 条，无业务报文）
  if (method === 'CONNECT') { reasons.push('CONNECT 隧道'); return { category: 'noise', reasons }; }

  // WebSocket：升级版握手本身是噪声，但帧日志里装的是业务数据。
  // 本机实测：两类长连接（一个 protobuf 类子协议与一家社交平台的实时网关）合计 1984 帧 / 1007KB，
  // 全部只在 _w.txt 里存在——原算法一条没取。以故有帧日志时算 A 档素材。
  if (s.isWebSocket || Number(s.status) === 101) {
    if (s.hasWebSocketLog && (s.wsFrameCount || 0) > 0) {
      reasons.push('WebSocket 数据通道（帧日志 ' + s.wsFrameCount + ' 条，业务数据在此）');
      return { category: 'api', reasons };
    }
    reasons.push('WebSocket 升级握手（无帧日志）');
    return { category: 'noise', reasons };
  }

  // C 档：媒体与资源载荷
  for (const p of ['image/', 'video/', 'audio/', 'font/', 'model/']) {
    if (respBase.startsWith(p)) { reasons.push('媒体资源 ' + respBase); return { category: 'noise', reasons }; }
  }
  if (respBase === 'application/wasm' || respBase === 'application/octet-stream' || respBase === 'binary/octet-stream') {
    if (!reqBase || (!reqBase.includes('json') && !reqBase.includes('x-www-form-urlencoded'))) {
      reasons.push('二进制下载 ' + respBase);
      return { category: 'noise', reasons };
    }
  }

  // A 档：接口强信号（请求或响应是结构化数据）
  const apiResp = respBase.includes('json') || respBase === 'application/xml' || respBase === 'text/xml'
    || respBase === 'application/x-protobuf' || respBase === 'application/grpc' || respBase.includes('graphql');
  const apiReq = reqBase.includes('json') || reqBase === 'application/x-www-form-urlencoded'
    || reqBase === 'multipart/form-data' || reqBase === 'application/x-protobuf' || reqBase.includes('graphql');
  if (apiResp || apiReq) {
    reasons.push(apiResp ? '响应为结构化数据 ' + respBase : '请求为结构化数据 ' + reqBase);
    return { category: 'api', reasons };
  }
  // 无 Content-Type 但有请求体的 POST 常是自定义协议
  if (!respBase && s.respHasBody) { reasons.push('响应缺少 Content-Type，按体积判读'); }
  if (s.statusAbnormal) { reasons.push('响应状态异常：' + s.statusAbnormal); }

  // B 档：逻辑素材（JS/CSS/HTML）—— 默认折叠但永不排除出分析包
  if (/(javascript|ecmascript)/.test(respBase) || respBase === 'text/css' || respBase === 'text/html' || respBase === 'application/x-javascript') {
    reasons.push('逻辑素材 ' + respBase + '（可能含签名/加密实现，分析包内保留）');
    return { category: 'logic', reasons };
  }

  // C 档：静态后缀兜底
  if (s.urlPath && STATIC_EXT_RE.test(s.urlPath)) { reasons.push('静态后缀命中'); return { category: 'noise', reasons }; }

  if (s.status && Number(s.status) >= 400) { reasons.push('错误响应值得分析'); return { category: 'api', reasons }; }

  reasons.push('未归类，默认按接口处理以免漏素材');
  return { category: 'api', reasons };
}

/** 档位展示顺序与标签。 */
const CATEGORY_LABEL = { api: '接口', logic: '逻辑素材', noise: '噪声' };

module.exports = {
  EXT_BY_TYPE,
  EXTRACTABLE,
  safeExt,
  parseContentType,
  charsetOf,
  isExtractable,
  extForContentType,
  extFromUrl,
  isTextualType,
  classifySession,
  CATEGORY_LABEL,
  STATIC_EXT_RE,
};
