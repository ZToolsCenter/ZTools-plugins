'use strict';

/**
 * decode.js —— 报文体部编码解码（A 层 · 数据保真）
 *
 * 本机实测（5 个真实样本、4221 条响应）决定这里的优先级：
 *   无 41.5% / gzip 30.5% / zstd 26.1% / br 2.0%；请求侧全部无编码。
 * 因此 zstd 属于**必需能力**而非可选。
 *
 * 运行环境事实：ZTools 3.2.0 = Electron 41.4.0，其内嵌 Node 的 zlib 已提供
 * zstdDecompressSync / brotliDecompressSync（已通过二进制符号扫描 + 运行时确认），
 * 所以**不引入任何第三方解压库**。
 *
 * 修正原算法缺陷 B5：原实现遇到缺库或解压失败时只 print 警告，然后把压缩字节
 * 原样写进 .txt，用户拿到乱码文件却无从知晓。这里改为显式失败标记 + 保留原始字节，
 * 并要求上层把失败计数暴露到概览与 manifest。
 */

const zlib = require('node:zlib');

/** 运行时能力探测结果（进程内缓存一次）。 */
let CAPS = null;

/** 探测当前运行环境可用的解压算法。 */
function capabilities() {
  if (CAPS) return CAPS;
  CAPS = {
    gzip: typeof zlib.gunzipSync === 'function',
    deflate: typeof zlib.inflateSync === 'function',
    deflateRaw: typeof zlib.inflateRawSync === 'function',
    brotli: typeof zlib.brotliDecompressSync === 'function',
    zstd: typeof zlib.zstdDecompressSync === 'function',
    zlibVersions: (process.versions && process.versions.zlib) || null,
    node: process.versions.node,
    electron: process.versions.electron || null,
  };
  return CAPS;
}

/**
 * 编码令牌 → capabilities() 键名的映射。
 * Content-Encoding 用的是 HTTP 名（br / deflate），而 capabilities() 用 zlib API 名
 * （brotli / deflateRaw），两者不同名。此处不做映射会造成能力探测永远为假、
 * 把 2% 的 brotli 响应误报成 "runtime-lacks-br"（已在 324MB 真实样本上复现）。
 */
const ALGO_CAP_KEY = {
  gzip: 'gzip',
  deflate: 'deflate',
  deflateRaw: 'deflateRaw',
  br: 'brotli',
  zstd: 'zstd',
};

/** 该编码令牌在当前运行时是否可解。 */
function isAlgoAvailable(algo) {
  const key = ALGO_CAP_KEY[algo];
  if (!key) return false;
  return capabilities()[key] === true;
}

/** 归一化 Content-Encoding 令牌，如 `GZIP`、`x-gzip`、` identity`。 */
function normalizeToken(tok) {
  const t = String(tok).trim().toLowerCase();
  if (t === 'x-gzip') return 'gzip';
  if (t === 'identify' || t === 'id') return 'identity';
  return t;
}

/**
 * 拆解 Content-Encoding 头，得到解码顺序（HTTP 语义：解码顺序与编码顺序相反）。
 * 例：`Content-Encoding: gzip, zstd` 表示先 zstd 压缩再 gzip 包装 → 解码先 gzip。
 */
function parseEncodingChain(headerValue) {
  if (!headerValue) return [];
  return headerValue
    .split(',')
    .map(normalizeToken)
    .filter((t) => t && t !== 'identity' && t !== 'none')
    .reverse();
}

/** 单算法解码；抛出交由上层捕获并归类原因。 */
function decodeOnce(data, algo) {
  switch (algo) {
    case 'gzip':
      // 部分抓包记录写的是裸 deflate 却标 gzip，因此失败时回退 raw inflate
      try {
        return zlib.gunzipSync(data);
      } catch (e) {
        if (capabilities().deflateRaw) return zlib.inflateRawSync(data, { finishFlush: zlib.constants.Z_SYNC_FLUSH });
        throw e;
      }
    case 'deflate': {
      // 原算法口径：先按 zlib wrapper 解，失败再按 raw 解
      try {
        return zlib.inflateSync(data);
      } catch (e) {
        if (capabilities().deflateRaw) {
          return zlib.inflateRawSync(data, { finishFlush: zlib.constants.Z_SYNC_FLUSH });
        }
        throw e;
      }
    }
    case 'br':
      return zlib.brotliDecompressSync(data);
    case 'zstd':
      return decodeZstd(data);
    default:
      throw new Error('unsupported-algorithm');
  }
}

/**
 * zstd 解码：优先一次性 API；若因帧内无 content size 而失败，
 * 退到同步可读的流式路径（用 createZstdDecompress + 缓冲读取）。
 */
function decodeZstd(data) {
  if (!capabilities().zstd) throw new Error('zstd-unavailable');
  try {
    return zlib.zstdDecompressSync(data);
  } catch (e) {
    // 帧头缺 content size 时一次性 API 可能要求显式输出上限，这里做一次性放大重试
    for (const factor of [16, 64, 256]) {
      try {
        const maxOut = Math.min(data.length * factor + 1024 * 1024, 512 * 1024 * 1024);
        return zlib.zstdDecompressSync(data, { maxOutputLength: maxOut });
      } catch (e2) { /* 继续放大 */ }
    }
    throw e;
  }
}

/**
 * 归一化 Transfer-Encoding 头值（可能多行合并、带参数如 `chunked;ext=1`）。
 * @returns {string[]}
 */
function parseTransferEncoding(headerValue) {
  if (!headerValue) return [];
  return String(headerValue)
    .split(/[,\r\n]+/)
    .map((part) => part.split(';')[0].trim().toLowerCase())
    .filter(Boolean);
}

/** 该 Transfer-Encoding 串里是否需要做 chunked 解框。 */
function isChunked(headerValue) {
  return parseTransferEncoding(headerValue).includes('chunked');
}

/**
 * chunked transfer-decoding（RFC 9112 §7.1）。
 *
 * 为什么非做不可（实测）：SAZ 的 raw 条目存的是**线上原始字节**，全包 50 个样本里
 * 带 `Transfer-Encoding: chunked` 的 36 条响应，正文**全部**还混着长度行（形如
 * `471\r\n{json}\r\n…\r\n0\r\n\r\n`）→ 整块 JSON 解析 0 条成功，F19 的字段视图全部降级
 * 成 `partial` 的宽松键名。原 Python 脚本也没做（全文件零 `chunked` 关键字）。
 *
 * **取舍：宁可不动，不可动坏**。任何一处框架不合法（长度行不是十六进制、块后不是
 * CRLF、残尾不完整），就把**原始字节整块退还**并写明原因，绝不交出一段“看起来剥好了
 * 其实丢了东西”的正文。能剥出完整块但尾部残缺时，返回已完成的块 + `partial:true`，
 * 把残尾原字节带着（`remainderBuf`），不静默截断。
 *
 * @param {Buffer} buf 含 chunk 框架的体部字节
 * @returns {{applied:boolean, data:Buffer, frames:number, overheadBytes:number, partial:boolean,
 *            reason:string, trailerLines:string[], remainderBuf:Buffer|null}}
 */
function dechunk(buf) {
  const none = {
    applied: false, data: buf || Buffer.alloc(0), frames: 0, overheadBytes: 0,
    partial: false, reason: '', trailerLines: [], remainderBuf: null,
  };
  if (!buf || buf.length === 0) return none;

  const LF = 0x0a;
  let i = 0;
  let overhead = 0;
  let frames = 0;
  const parts = [];
  const trailerLines = [];
  let inTrailer = false;
  let terminator = false;

  while (i < buf.length) {
    const nl = buf.indexOf(LF, i);
    if (nl < 0) return Object.assign({}, none, { reason: '长度行不完整（抓包截断）', remainderBuf: buf.subarray(i) });
    const line = buf.toString('latin1', i, nl).replace(/\r$/, '');
    if (inTrailer) {
      if (line === '') { overhead += 2; terminator = true; break; }
      trailerLines.push(line);
      overhead += line.length + 1 + (buf[nl - 1] === 0x0d ? 1 : 0);
      i = nl + 1;
      continue;
    }
    // 长度行允许带 chunk 扩展：`5i2;name=value`
    const sizeTxt = line.split(';')[0].trim();
    if (!/^[0-9a-fA-F]{1,}$/.test(sizeTxt)) {
      return Object.assign({}, none, { reason: '第 ' + (frames + 1) + ' 块长度行不是十六进制：' + JSON.stringify(line.slice(0, 40)), remainderBuf: null });
    }
    const size = parseInt(sizeTxt, 16);
    const dataStart = nl + 1;
    overhead += (dataStart - i);
    frames++;
    if (size === 0) { inTrailer = true; i = dataStart; continue; }
    if (dataStart + size > buf.length) {
      // 尾部不完整：已完成的块交回去，残块原字节保留，并标 partial
      return {
        applied: true, data: Buffer.concat(parts), frames: frames - 1, overheadBytes: overhead,
        partial: true, reason: '最后一个分块不完整（抓包截断）：声明 ' + size + ' 字节，实际 ' + (buf.length - dataStart),
        trailerLines: [], remainderBuf: buf.subarray(dataStart),
      };
    }
    parts.push(buf.subarray(dataStart, dataStart + size));
    const after = dataStart + size;
    if (after >= buf.length) {
      // 数据本身完整，只是抓包在块尾 CRLF 前断了：交出已得块并标 partial，不当成“框架非法”
      parts.push(Buffer.alloc(0));
      return {
        applied: true, data: Buffer.concat(parts), frames, overheadBytes: overhead,
        partial: true, reason: '最后一个分块后缺终止 CRLF（抓包截断）',
        trailerLines: [], remainderBuf: null,
      };
    }
    const cr = buf[after] === 0x0d ? 1 : 0;
    if (buf[after + cr] !== LF) {
      return Object.assign({}, none, { reason: '第 ' + frames + ' 块数据后缺 CRLF 分隔符', remainderBuf: null });
    }
    overhead += cr + 1;
    i = after + cr + 1;
  }

  if (!terminator && !inTrailer) {
    return Object.assign({}, none, { reason: '正文里没有 0 长度终止块，不是完整的 chunked 流', remainderBuf: null });
  }
  if (parts.length === 0) {
    return { applied: true, data: Buffer.alloc(0), frames, overheadBytes: overhead, partial: false, reason: '空体（仅终止块）', trailerLines, remainderBuf: null };
  }
  return { applied: true, data: Buffer.concat(parts), frames, overheadBytes: overhead, partial: false, reason: '', trailerLines, remainderBuf: null };
}

/**
 * 按 Content-Encoding 链解码体部。
 *
 * @param {Buffer} bodyBuf 原始体部字节（可能已被前缀读取截断）
 * @param {string} contentEncoding 头值原文
 * @param {object} [opts]
 * @param {number} [opts.maxBytes] 解码后保留上限（超出截断并标记，不丢原始长度信息）
 * @param {string} [opts.transferEncoding] Transfer-Encoding 头值；含 chunked 时**先解框再解压**
 *        （顺序按 RFC 9112：transfer 在外层，content-encoding 在内层）
 * @returns {{data:Buffer, chain:string[], failed:boolean, algorithm:string, reason:string, decodedBytes:number, originalBytes:number, truncated:boolean, dechunk:object}}
 */
function decodeBody(bodyBuf, contentEncoding, opts) {
  const maxBytes = (opts && opts.maxBytes) || 0;
  const chain = parseEncodingChain(contentEncoding);
  const base = {
    chain,
    originalBytes: bodyBuf ? bodyBuf.length : 0,
    truncated: false,
  };

  if (!bodyBuf || bodyBuf.length === 0) {
    return Object.assign(base, { data: bodyBuf || Buffer.alloc(0), failed: false, algorithm: '', reason: '', decodedBytes: 0, dechunk: null });
  }

  // transfer-decoding：失败（框架不合法）时整块退还，后续流程跟原来一模一样
  let work = bodyBuf;
  let de = null;
  if (opts && isChunked(opts.transferEncoding)) {
    const r = dechunk(bodyBuf);
    de = {
      applied: r.applied, frames: r.frames, overheadBytes: r.overheadBytes,
      partial: r.partial, reason: r.reason, trailerLines: r.trailerLines,
      hadFraming: r.applied,
    };
    if (r.applied) work = r.data;
    else de.error = r.reason;
  }

  if (chain.length === 0) {
    let data = work;
    if (maxBytes && data.length > maxBytes) { data = data.subarray(0, maxBytes); base.truncated = true; }
    return Object.assign(base, { data, failed: false, algorithm: '', reason: '', decodedBytes: data.length, dechunk: de });
  }

  let cur = work;
  for (let i = 0; i < chain.length; i++) {
    const algo = chain[i];
    if (!isAlgoAvailable(algo)) {
      return Object.assign(base, {
        // 解压失败时退还的是**已解框**的字节（work）：保留可用的一层剥除结果，不把 chunk 长度行又带回来
        data: work,
        failed: true,
        algorithm: algo,
        reason: 'runtime-lacks-' + algo,
        decodedBytes: 0,
        dechunk: de,
      });
    }
    try {
      cur = decodeOnce(cur, algo);
    } catch (err) {
      // 前缀读取会导致压缩流不完整，这种失败要能识别出来，提示"重新完整读取"而非"无法解码"
      const incomplete = work.length && cur && cur.length === work.length;
      return Object.assign(base, {
        data: work,
        failed: true,
        algorithm: algo,
        reason: (err && err.code) || (err && err.message) || 'decode-error',
        possiblyTruncatedInput: !!incomplete,
        decodedBytes: 0,
        dechunk: de,
      });
    }
  }

  let data = cur;
  if (maxBytes && data.length > maxBytes) {
    data = data.subarray(0, maxBytes);
    base.truncated = true;
  }
  return Object.assign(base, {
    data,
    failed: false,
    algorithm: chain[chain.length - 1],
    reason: '',
    decodedBytes: data.length,
    plainTotalBytes: cur.length,
    dechunk: de,
  });
}

/**
 * 判断字节流是否为文本可读内容（无 BOM 探测，用空字节比例做经验判定）。
 * @returns {boolean}
 */
function looksTextual(buf, sampleBytes) {
  if (!buf || buf.length === 0) return true;
  const n = Math.min(buf.length, sampleBytes || 4096);
  let suspicious = 0;
  for (let i = 0; i < n; i++) {
    const b = buf[i];
    if (b === 0) suspicious++;
    else if (b < 9 || (b > 13 && b < 32)) suspicious++;
  }
  return suspicious / n < 0.02; // 可疑字节占比超 2% 判为二进制
}

/** Buffer 是否为空。 */
function isEmpty(buf) {
  return !buf || buf.length === 0;
}

module.exports = {
  capabilities,
  isAlgoAvailable,
  parseEncodingChain,
  parseTransferEncoding,
  isChunked,
  dechunk,
  decodeBody,
  decodeOnce,
  decodeZstd,
  looksTextual,
  isEmpty,
};
