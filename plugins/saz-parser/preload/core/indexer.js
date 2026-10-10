'use strict';

/**
 * indexer.js —— 会话索引与正文读取装配（A 层核心）
 *
 * 索引阶段的设计取舍（由本机实测数据决定，不是凭感觉）：
 * - 请求侧 Content-Encoding：4221 条**全部为无** → 请求体与 query 的字段集合可零额外成本提取，
 *   因此 F17 的"接口有哪些参数"在秒级索引里就能给出。
 * - 响应侧 Content-Encoding：gzip 30.5% + zstd 26.1% + br 2.0% → 58.5% 是压缩的，
 *   若索引阶段就提取响应字段，必须解压全部 311.7MB 正文，秒级目标直接破产。
 *   因此响应字段集合**留到分析包 L1/L2 阶段对选定会话解压**，索引只保留
 *   status / Content-Type / Content-Length / Set-Cookie 数量等头部信息。
 * - 头部读取实测：7546 条目全部在 256KB 前缀内出现 \r\n\r\n（命中 7546/7546），
 *   耗时 1062ms，RSS 增量 43MB → 证实"逐条读、逐条释放"的恒定内存模型成立。
 *
 * 字节保真：索引不保存改写后的内容，正文一律按需从归档重新读取原始字节。
 */

const path = require('node:path');
const { ZipReader } = require('./zip-reader');
const { pairEntries } = require('./pairing');
const msg = require('./message');
const dec = require('./decode');
const stream = require('./stream');
const types = require('./types');
const privacy = require('./privacy');
const fields = require('./fields');
const meta = require('./session-meta');
const ws = require('./ws-log');

const DEFAULT_OPTS = {
  /** 头部+请求体前缀的明文读取上限 */
  headerReadBytes: 256 * 1024,
  /** 请求体字段提取上限（超出标记 partial） */
  reqKeySampleBytes: 64 * 1024,
  /** 单会话字段数上限 */
  maxKeys: 300,
  /** 是否在索引里保留字段值（用户指令：默认保留） */
  withValues: true,
};

/** 读取一条报文并解析，失败不抛（转为警告），保证一个坏条目不影响整包索引。 */
function readAndParse(zip, entry, kind, maxPlainBytes) {
  try {
    const r = zip.readEntryPrefix(entry, maxPlainBytes);
    const parsed = msg.parseMessage(r.buffer, kind, !r.plainFull);
    parsed.entryUncompressedSize = entry.uncompressedSize;
    parsed.entryCompressedSize = entry.compressedSize;
    parsed.plainReadBytes = r.buffer.length;
    return parsed;
  } catch (err) {
    return { kind, parseError: err.message, headers: [], startLine: '', bodyBuf: Buffer.alloc(0), bodyTruncated: false };
  }
}

/** 从请求报文提取字段视图：query + 请求体（请求体实测均为未压缩明文）。 */
function buildRequestFieldView(request, opts) {
  const view = { query: null, body: null, all: [], privacyTags: [] };
  if (request.query) {
    view.query = fields.buildQueryView(request.query);
    for (const t of view.query.privacyTags) view.privacyTags.push(Object.assign({ scope: 'query' }, t));
  }
  if (request.bodyBuf && request.bodyBuf.length > 0) {
    // 索引期只能拿到前缀，因此对 chunked 请求体做**尽力而为**解框：框架不完整就不动，
    // 宁可退回原字节也不能交出一段被切坏的内容（dechunk 内部已保证失败时整块退还）。
    let body = request.bodyBuf;
    if (dec.isChunked(request.transferEncoding)) {
      const r = dec.dechunk(body);
      if (r.applied && !r.partial) body = r.data;
    }
    const sample = body.length > opts.reqKeySampleBytes ? body.subarray(0, opts.reqKeySampleBytes) : body;
    view.body = fields.buildFieldView({
      contentType: request.contentType,
      bodyBuf: sample,
      bodyTruncated: body.length > opts.reqKeySampleBytes,
    }, { maxKeys: opts.maxKeys, withSamples: opts.withValues });
    for (const t of view.body.privacyTags) view.privacyTags.push(Object.assign({ scope: 'requestBody' }, t));
  }
  view.all = []
    .concat(view.query ? view.query.fields.map((f) => Object.assign({ from: 'query' }, f)) : [])
    .concat(view.body ? view.body.fields.map((f) => Object.assign({ from: 'body' }, f)) : []);
  return view;
}

/** 汇总头部里的隐私字段（默认保留完整值）。 */
function privacyFromHeaders(message, scope) {
  const tags = privacy.scanHeaders(message.headers);
  return tags.map((t) => Object.assign({ scope }, t));
}

/** 判断响应是否为 WebSocket/流式升级（101），供分类与告警使用。 */
function isUpgradeResponse(message) {
  if (Number(message.status) === 101) return true;
  const up = msg.headerValue(message.headers, 'upgrade');
  return !!up;
}

/**
 * 构建整包索引。
 * @param {string|ZipReader} source .saz 绝对路径，或已 open 的 ZipReader（复用时不关闭）
 * @param {object} [options] 覆盖 DEFAULT_OPTS
 * @param {(p:{done:number,total:number,phase:string,sid?:number})=>void} [onProgress]
 * @returns {{archive:object,summary:object,sessions:Array,warnings:Array,decode:object}}
 */
function buildIndex(source, options, onProgress) {
  const opts = Object.assign({}, DEFAULT_OPTS, options || {});
  const ownsZip = typeof source === 'string';
  const zip = ownsZip ? new ZipReader(source) : source;
  if (ownsZip) zip.open();
  const t0 = Date.now();

  const paired = pairEntries(zip.entries);
  const sessions = [];
  const warnings = [];
  const decodeStats = { none: 0, gzip: 0, deflate: 0, br: 0, zstd: 0, failed: 0, failedList: [] };
  if (paired.skipped.length) {
    for (const s of paired.skipped.slice(0, 50)) warnings.push({ type: 'skipped-entry', name: s.name, reason: s.reason });
    if (paired.skipped.length > 50) warnings.push({ type: 'skipped-entry', reason: '其余 ' + (paired.skipped.length - 50) + ' 条同类告警已省略' });
  }

  const total = paired.sessions.length;
  const categoryCount = { api: 0, logic: 0, noise: 0 };
  const hosts = new Map();
  const statusCount = {};
  const kindTally = {};
  const wsTotals = { sessions: 0, frames: 0, bytes: 0 };
  // chunked 只登记“有没有这个头”（索引期不读全正文，无法逐块核对框架合法性）
  const teTotals = { req: 0, resp: 0 };
  const teRespSids = [];
  const sseTotals = { responses: 0 };
  let statusAbnormalCount = 0;

  for (let i = 0; i < total; i++) {
    const s = paired.sessions[i];
    const request = s.request ? readAndParse(zip, s.request, 'request', opts.headerReadBytes) : null;
    const response = s.response ? readAndParse(zip, s.response, 'response', opts.headerReadBytes) : null;

    if (request && request.parseError) warnings.push({ type: 'request-parse', sid: s.sid, reason: request.parseError });
    if (response && response.parseError) warnings.push({ type: 'response-parse', sid: s.sid, reason: response.parseError });

    const method = (request && request.method) || '';
    const reqTE = (request && request.transferEncoding) || '';
    const respTE = (response && response.transferEncoding) || '';
    if (dec.isChunked(respTE)) { teTotals.resp++; if (s.sid !== undefined) teRespSids.push(s.sid); }
    if (dec.isChunked(reqTE)) teTotals.req++;
    const respCT = (response && response.contentType) || '';
    if (stream.isEventStream(respCT)) sseTotals.responses++;
    const reqCT = (request && request.contentType) || '';
    const upgraded = response ? isUpgradeResponse(response) : false;

    // WebSocket 帧日志（_w.txt）：实测全包只有几十个、明文合计约 1MB，
    // 索引期只做轻量快扫（帧数/字节数）以驱动分类与概览，完整解帧留给 detail。
    let wsScan = { frames: 0, request: 0, response: 0, bytes: 0 };
    if (s.ws) {
      try {
        const raw = zip.readEntry(s.ws);
        wsScan = ws.quickScan(raw);
        wsTotals.sessions++;
        wsTotals.frames += wsScan.frames;
        wsTotals.bytes += wsScan.bytes;
        if (wsScan.frames === 0) warnings.push({ type: 'ws-empty', sid: s.sid, reason: '_w.txt 存在但未解出任何帧' });
      } catch (e) {
        warnings.push({ type: 'ws-read', sid: s.sid, reason: e.message });
      }
    }

    const cls = types.classifySession({
      method,
      status: response ? response.status : 0,
      reqContentType: reqCT,
      respContentType: respCT,
      urlPath: request ? request.path : '',
      reqHasBody: !!(request && request.bodyBuf && request.bodyBuf.length),
      respHasBody: !!(response && response.bodyBuf && response.bodyBuf.length),
      isWebSocket: upgraded,
      hasWebSocketLog: !!s.ws,
      wsFrameCount: wsScan.frames,
      statusAbnormal: response ? response.statusAbnormal : null,
    });
    categoryCount[cls.category]++;
    if (response && response.statusAbnormal) statusAbnormalCount++;

    // 响应侧编码只在索引里登记"是否可解"，不做实际解压（见文件头注释）
    // 能力判定必须走 isAlgoAvailable：HTTP 令牌 br 与 capabilities() 键名 brotli 不同名，
    // 直接 caps[a] 会把可用的 brotli 误报成不可解。
    const respChain = response ? dec.parseEncodingChain(response.contentEncoding || '') : [];
    if (!response || respChain.length === 0) decodeStats.none++;
    else {
      for (const a of respChain) if (decodeStats[a] !== undefined) decodeStats[a]++;
      for (const a of respChain) {
        if (!dec.isAlgoAvailable(a)) {
          decodeStats.failed++;
          if (decodeStats.failedList.length < 50) decodeStats.failedList.push({ sid: s.sid, algorithm: a, reason: 'runtime-lacks-' + a });
        }
      }
    }

    const reqFields = request ? buildRequestFieldView(request, opts) : { all: [], privacyTags: [] };
    const privacyTags = []
      .concat(request ? privacyFromHeaders(request, 'requestHeader') : [])
      .concat(response ? privacyFromHeaders(response, 'responseHeader') : [])
      .concat(reqFields.privacyTags || []);
    for (const t of privacyTags) kindTally[t.kind] = (kindTally[t.kind] || 0) + 1;

    // 会话元数据（_m.xml）体积很小，索引阶段直接解析，为 F23 流程分组提供时序
    let metaLite = null;
    if (s.meta) {
      try {
        const raw = zip.readEntry(s.meta);
        metaLite = meta.metaForIndex(meta.parseSessionXml(raw));
      } catch (e) {
        warnings.push({ type: 'meta-parse', sid: s.sid, reason: e.message });
      }
    }

    const host = (request && request.host) || '';
    if (host) hosts.set(host, (hosts.get(host) || 0) + 1);
    if (response && response.status) statusCount[response.status] = (statusCount[response.status] || 0) + 1;

    sessions.push({
      sid: s.sid,
      seq: s.seq,
      category: cls.category,
      categoryReasons: cls.reasons,
      method,
      url: (request && request.url) || '',
      host,
      port: (request && request.port) || 0,
      scheme: (request && request.scheme) || '',
      path: (request && request.path) || '',
      urlTemplate: (request && request.urlTemplate) || '',
      targetForm: (request && request.targetForm) || '',
      hasQuery: !!(request && request.query),
      queryKeyCount: reqFields.query ? reqFields.query.fields.length : 0,
      status: response ? response.status : 0,
      statusText: response ? response.statusText : '',
      httpVersion: response ? response.httpVersion : (request ? request.httpVersion : null),
      reqContentType: reqCT,
      reqTransferEncoding: reqTE,
      respContentType: respCT,
      respTransferEncoding: respTE,
      reqContentEncoding: request ? request.contentEncoding : '',
      respContentEncoding: response ? response.contentEncoding : '',
      respEncodingChain: respChain,
      reqHeaderCount: request ? request.headers.length : 0,
      respHeaderCount: response ? response.headers.length : 0,
      reqBodyBytes: request ? request.bodyBuf.length : 0,
      reqBodyPlainBytes: request ? request.bodyBuf.length : 0,
      respBodyBytes: response ? response.bodyBuf.length : 0,
      respEntryPlainBytes: response ? response.entryUncompressedSize : 0,
      respEntryCompressedBytes: response ? response.entryCompressedSize : 0,
      hasRequest: !!s.request,
      hasResponse: !!s.response,
      hasMeta: !!s.meta,
      hasWs: !!s.ws,
      wsFrames: wsScan.frames,
      wsFrameBytes: wsScan.bytes,
      // 子协议直接决定帧载荷的解读方式（实测样本里有一个 protobuf 类子协议），不记下来下游只能猜
      wsSubprotocol: (response && msg.headerValue(response.headers, 'sec-websocket-protocol')) ||
        (request && msg.headerValue(request.headers, 'sec-websocket-protocol')) || '',
      statusAbnormal: response ? response.statusAbnormal : null,
      isFiddlerPlaceholder: !!(response && response.isFiddlerPlaceholder),
      complete: s.complete,
      isUpgrade: upgraded,
      headerOnly: !!(response && response.bodyTruncated),
      reqFields: reqFields.all.slice(0, opts.maxKeys),
      reqFieldsPartial: !!(reqFields.body && reqFields.body.partial) || !!(reqFields.query && reqFields.query.partial),
      privacyTags,
      setCookieCount: response ? (response.setCookieCount || 0) : 0,
      timers: metaLite,
      // 条目定位信息：正文按需读取时无需重新扫描归档
      refs: {
        reqEntry: s.request ? s.request.index : null,
        respEntry: s.response ? s.response.index : null,
        metaEntry: s.meta ? s.meta.index : null,
        wsEntry: s.ws ? s.ws.index : null,
      },
    });

    if (onProgress && (i % 50 === 0 || i === total - 1)) onProgress({ done: i + 1, total, phase: 'index', sid: s.sid });
  }

  const elapsedMs = Date.now() - t0;
  const archive = Object.assign({}, zip.info(), {
    name: path.basename(zip.filePath),
    dir: path.dirname(zip.filePath),
    elapsedMs,
    capabilities: dec.capabilities(),
  });

  const summary = {
    sessionCount: sessions.length,
    hostCount: hosts.size,
    topHosts: [...hosts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 20).map(([host, n]) => ({ host, count: n })),
    categoryCount,
    statusCount,
    privacyKindCount: kindTally,
    pairing: paired.stats,
    responseEncoding: {
      none: decodeStats.none,
      gzip: decodeStats.gzip,
      br: decodeStats.br,
      zstd: decodeStats.zstd,
      deflate: decodeStats.deflate,
      undecodable: decodeStats.failed,
    },
    responseEncodingFailed: decodeStats.failedList,
    websocket: {
      sessions: wsTotals.sessions,
      frames: wsTotals.frames,
      frameBytes: wsTotals.bytes,
    },
    transferChunked: { responses: teTotals.resp, requests: teTotals.req, responseSids: teRespSids.slice(0, 200) },
    stream: { eventStreamResponses: sseTotals.responses },
    statusAbnormalCount,
    totalBodyBytesCompressed: sessions.reduce((a, s) => a + s.respEntryCompressedBytes, 0),
    totalBodyBytesPlain: sessions.reduce((a, s) => a + s.respEntryPlainBytes, 0),
    warnings: warnings.length,
  };

  if (ownsZip) zip.close();
  return { archive, summary, sessions, warnings, decode: decodeStats };
}

/**
 * 打开归档并完成索引，返回**持有文件句柄**的 Archive 对象。
 *
 * 为什么需要它：中央目录解析实测 16ms（324MB/11304 条目），若每次取正文都重开一次，
 * UI 懒加载 3756 次就要多花约 60 秒；MCP 的 saz_parse → saz_body 连续调用同理。
 * 因此索引与正文读取必须共用一个已打开的 ZipReader。
 *
 * @param {string} sazPath
 * @param {object} [options]
 * @param {Function} [onProgress]
 */
function openArchive(sazPath, options, onProgress) {
  const zip = new ZipReader(sazPath);
  zip.open();
  let result;
  try {
    result = buildIndex(zip, options, onProgress);
  } catch (e) {
    zip.close();
    throw e;
  }
  const bySid = new Map(result.sessions.map((s) => [s.sid, s]));
  const bySeq = new Map(result.sessions.map((s) => [s.seq, s]));
  // 把归档元信息（path/fileSize/entryCount/name/capabilities…）提到顶层，
  // 让下游既能写 arc.summary 也能写 arc.capabilities，不必区分 arc.archive.*
  // 两套写法极易出错（分析包生成时已在此踩坑一次）。
  return Object.assign({}, result, result.archive, {
    sazPath,
    /** 按会话对象 / sid / seq 解析出会话项。 */
    resolveSession(ref) {
      if (!ref) return null;
      if (typeof ref === 'object') return ref.sid !== undefined ? (bySid.get(ref.sid) || null) : (bySeq.get(ref.seq) || null);
      const n = Number(ref);
      return bySid.get(n) || bySeq.get(n) || null;
    },
    /** 取正文详情（复用句柄）。 */
    detail(ref, detailOptions) {
      const s = this.resolveSession(ref);
      if (!s) return null;
      return detailFromZip(zip, s, detailOptions);
    },
    /**
     * 读某条目的**原始字节**（不做任何解析与改写）。
     * 保真出口：UI 的"看原始报文"（api.raw）、兼容层导出、对拍脚本都走它，共用同一个句柄。
     * @param {number|object} ref 条目索引或条目对象
     */
    readEntry(ref) { return zip.readEntry(ref); },
    /** 会话的条目索引号（reqEntry/respEntry/metaEntry/wsEntry）。 */
    entryRefs(ref) {
      const s = this.resolveSession(ref);
      return s ? s.refs : null;
    },
    close() { zip.close(); },
  });
}

/** 会话项定位辅助：从索引结果里找会话。 */
function findSession(sessions, ref) {
  const n = Number(ref);
  return sessions.find((s) => s.sid === n || s.seq === n) || null;
}

/**
 * 读取单会话完整详情（F3 懒加载 / 分析包 / MCP saz_body 共用）。
 * 基于已打开的 zip 句柄，不重复解析中央目录。
 * @param {ZipReader} zip 已 open 的归档读取器
 * @param {object} session buildIndex 产出的会话项
 * @param {object} [options]
 * @param {number} [options.maxBodyBytes] 解码后正文上限（超出截断并标记）
 * @param {boolean} [options.withFields] 是否提取字段视图
 * @param {boolean} [options.withStream] 是否对 event-stream / 多帧 JSON 做拆解（F28，默认关）
 */
function detailFromZip(zip, session, options) {
  const opts = Object.assign({ maxBodyBytes: 0, withFields: true }, options || {});
  const out = { sid: session.sid, seq: session.seq, request: null, response: null, meta: null, decode: {} };

  if (session.refs.reqEntry !== null && session.refs.reqEntry !== undefined) {
    const raw = zip.readEntry(session.refs.reqEntry);
    const parsed = msg.parseMessage(raw, 'request', false);
    // 请求侧也要走同一条路：实测请求体全部无 Content-Encoding，但 chunked 分块框架与请求侧
    // 同样可能存在。以前这边直接拿 parsed.bodyBuf，长度行会混进字段提取与正文。
    const rd = (parsed.transferEncoding || parsed.contentEncoding)
      ? dec.decodeBody(parsed.bodyBuf, parsed.contentEncoding, { maxBytes: opts.maxBodyBytes, transferEncoding: parsed.transferEncoding })
      : null;
    out.decode.request = rd
      ? { chain: rd.chain, failed: rd.failed, algorithm: rd.algorithm, reason: rd.reason, truncated: rd.truncated, plainTotalBytes: rd.plainTotalBytes || rd.decodedBytes, dechunk: rd.dechunk || null }
      : { chain: [], failed: false, algorithm: '', reason: '', truncated: false, dechunk: null };
    out.request = shapeSide(parsed, raw, rd, session.reqContentType);
    if (opts.withFields) {
      out.request.fields = fields.buildFieldView({
        contentType: session.reqContentType,
        bodyBuf: out.request.bodyBuf,
        bodyTruncated: !!(rd && rd.truncated),
      }, { maxKeys: DEFAULT_OPTS.maxKeys, withSamples: true });
    }
  }
  if (session.refs.respEntry !== null && session.refs.respEntry !== undefined) {
    const raw = zip.readEntry(session.refs.respEntry);
    const parsed = msg.parseMessage(raw, 'response', false);
    const d = dec.decodeBody(parsed.bodyBuf, parsed.contentEncoding, {
      maxBytes: opts.maxBodyBytes,
      // transfer-decoding 必须先于 content-decoding（B11：实测 36 条 chunked 响应正文全部带长度行）
      transferEncoding: parsed.transferEncoding,
    });
    out.decode.response = {
      chain: d.chain,
      failed: d.failed,
      algorithm: d.algorithm,
      reason: d.reason,
      truncated: d.truncated,
      plainTotalBytes: d.plainTotalBytes || d.decodedBytes,
      dechunk: d.dechunk || null,
    };
    out.response = shapeSide(parsed, raw, d, session.respContentType);
    // 解码失败时不提字段（避免把压缩字节当成文本解析出伪字段）
    if (opts.withFields && !d.failed) {
      out.response.fields = fields.buildFieldView({
        contentType: parsed.contentType,
        bodyBuf: d.data,
        bodyTruncated: !!d.truncated,
      }, { maxKeys: DEFAULT_OPTS.maxKeys, withSamples: true });
    }
    // F28 流式/多帧拆解。闸门：“值不值得试”，具体怎么判交给 stream.js（内部有首字符门 + 硬判据）。
    // 三条入口：标了 event-stream / 字段层整块没解开 / 正文以 JSON 值开头。
    // 只在调用方显式要求时做（withStream），因为拆几千事件不便宜。
    if (opts.withStream && !d.failed && !d.truncated) {
      const fv = out.response.fields;
      const wholeUnparsed = !!(fv && fv.parsed === false);
      const body = d.data.toString('utf8');
      if (stream.isEventStream(parsed.contentType) || wholeUnparsed || stream.worthSniffing(body)) {
        out.response.stream = stream.parseStreamBody(body, parsed.contentType,
          Object.assign({ jsonParsed: fv ? fv.parsed : undefined }, opts.streamOptions));
      }
    }
  }
  if (session.refs.metaEntry !== null && session.refs.metaEntry !== undefined) {
    try {
      const metaBuf = zip.readEntry(session.refs.metaEntry);
      out.meta = meta.parseSessionXml(metaBuf);
      out.meta.flags = meta.decodeBitFlags(out.meta.bitFlags);
      // 兼容层导出需要 _m.xml 原文副本（修 B8 的 withMeta 选项）
      out.meta.rawText = metaBuf.toString('utf8');
    } catch (e) { out.meta = { parseFailed: true, reason: e.message }; }
  }
  // WebSocket 帧日志：完整解帧只在拿到具体会话时做（全包仅几十个、约 1MB）
  if (session.refs.wsEntry !== null && session.refs.wsEntry !== undefined) {
    try {
      const wbuf = zip.readEntry(session.refs.wsEntry);
      const w = ws.parseWsLog(wbuf, { textPreviewChars: opts.wsPreviewChars === undefined ? 240 : opts.wsPreviewChars });
      out.websocket = {
        records: w.records,
        stats: w.stats,
        parseErrors: w.parseErrors,
        truncated: w.truncated,
        /** 第 i 帧去掩码后的应用数据（供导出与分析包逐帧落盘）。 */
        payloadAt(i) { return w.records[i] ? ws.framePayload(wbuf, w.records[i]) : null; },
        textAt(i) { return w.records[i] ? ws.frameText(wbuf, w.records[i]) : null; },
      };
      out.decode.websocket = {
        chain: [], failed: w.parseErrors.length > 0, algorithm: 'ws-frame',
        reason: w.parseErrors.length ? w.parseErrors[0].reason : '',
        truncated: w.truncated, plainTotalBytes: wbuf.length,
      };
    } catch (e) {
      out.websocket = { parseFailed: true, reason: e.message };
      warningsOneOff(out, session, e);
    }
  }
  if (out.request) {
    out.decode.request = out.decode.request || { chain: [], failed: false, algorithm: '', reason: '', truncated: false, dechunk: null };
  }
  return out;
}

/** detail 阶段的异常也要留痕，不静默吞掉。 */
function warningsOneOff(out, session, err) {
  out.warnings = out.warnings || [];
  out.warnings.push({ sid: session.sid, type: 'ws-detail', reason: err.message });
}

/** 独立入口：没有 Archive 句柄时自建自关（供一次性脚本与兜底使用）。 */
function readSessionDetail(sazPath, session, options) {
  const zip = new ZipReader(sazPath);
  try {
    zip.open();
    return detailFromZip(zip, session, options);
  } finally {
    zip.close();
  }
}

/** 把解析结果整形成对外安全的结构（latin1 头文本 + 原始字节引用）。 */
function shapeSide(parsed, rawWhole, decoded, contentType) {
  return {
    startLine: parsed.startLine,
    // headerText / headerRawBuf 是导出与分析包里"原始行序"的唯一来源，
    // 之前遗漏 headerText 会导致会话正文文件头为空（实测过才发现）
    method: parsed.method || null,
    status: parsed.status || null,
    url: parsed.url || null,
    httpVersion: parsed.httpVersion,
    headers: parsed.headers,
    headerText: parsed.headerText,
    headerRawBuf: parsed.headerRawBuf,
    contentType,
    contentEncoding: parsed.contentEncoding,
    contentLength: parsed.contentLength,
    transferEncoding: parsed.transferEncoding || '',
    headerBytes: parsed.headerRawBuf.length,
    rawBodyBytes: parsed.bodyBuf.length,
    // 解压前的原始体部字节（解压失败时要把它原样落盘，不混进 .txt）
    // 注：带 `Transfer-Encoding: chunked` 时这份字节**仍含分块框架**（它是线上原样），
    // 而下面经 decodeBody 处理后的 bodyBuf 才是解框+解压后的应用数据。
    rawBodyBuf: parsed.bodyBuf,
    bodyBuf: decoded ? decoded.data : parsed.bodyBuf,
    bodyTruncated: !!(decoded && decoded.truncated),
    bodyTotalBytes: decoded ? (decoded.plainTotalBytes || decoded.decodedBytes) : parsed.bodyBuf.length,
  };
}

/** 按 sid 取详情（MCP saz_body 的入口），复用已建索引避免重复扫描。 */
function detailBySid(index, sazPath, sid, options) {
  const s = findSession(index.sessions, sid);
  if (!s) return null;
  return readSessionDetail(sazPath, s, options);
}

module.exports = {
  buildIndex,
  openArchive,
  readSessionDetail,
  detailFromZip,
  findSession,
  detailBySid,
  DEFAULT_OPTS,
};
