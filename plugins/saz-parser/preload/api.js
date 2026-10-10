'use strict';

/**
 * api.js —— 对外能力面（被 window.sazApi 与 MCP tools 共同复用）
 *
 * 设计要点：
 * 1. **同一套实现服务两个入口**。UI 点选与外部 AI 调 tool 必须给出完全相同的数字，
 *    否则用户按 UI 估算 token、AI 按 tool 结果取数，两边一对照就发现对不上。
 * 2. 不引用 `window`，全部依赖通过参数注入（store / host=window.ztools），
 *    因此这套 API 可以**直接在纯 Node 里跑实证脚本**，不必启动 ZTools 才能验证。
 * 3. 返回给 UI 的是**投影后的精简对象**，大对象（Buffer）一律不出边界。
 */

const path = require('node:path');
const fs = require('node:fs');

// 本文件在 plugin/preload/ 下，因此 core 与 analysis 都是**同级**（./）。
// 此前写成 ../core 会解析到 plugin/core（不存在）——纯 Node 实证脚本一跑就暴露。
const dec = require('./core/decode');
const streamCore = require('./core/stream');
const types = require('./core/types');
const wsLog = require('./core/ws-log');
const query = require('./analysis/query');
const flow = require('./analysis/flow');
const token = require('./analysis/token');
const pkgmod = require('./analysis/package');
const legacy = require('./analysis/legacy-export');
// 元信息直接取自 plugin.json：它是客户端实际读到的那份身份，
// 不得与开发侧 package.json 的版本号发生漂移。
const manifest = require('../plugin.json');

/**
 * 清洗外部递来的路径字符串。
 * 搜索框/剪贴板/正则触发这三条通路都可能带引号、尾部空白或换行；
 * 不当回事就会变成“文件不存在”，而当回事只能在报错文本里看到原值才能排查。
 */
function cleanPathArg(v) {
  let s = String(v === undefined || v === null ? '' : v);
  s = s.replace(/[\r\n\t]+/g, ' ').trim();
  s = s.replace(/^\s*["“‘']+/, '').replace(/["”’']+\s*$/, '');
  return s.trim();
}

/**
 * 插件设置默认值。
 * beautifyLevel 取 json：原 Python 环境装了 jsbeautifier，会重排 JSON，
 * “效果与 py 脚本类似”就须带这个默认。
 * quickMode 已取消（v0.2.1）：“一键落盘”与“打开界面分析”现在是两条并列指令
 * （saz-quick / saz-view），用户在宿主列表里点哪条就是哪个行为，
 * 不需要一个会把两条指令“劫持成同一种行为”的开关。
 */
const DEFAULT_SETTINGS = {
  autoClose: true,       // 一键解析跑完就 outPlugin（仅当仍走 enter 通路时相干）
  beautifyLevel: 'json', // none | json | all
};

/**
 * 默认输出目录 = 归档所在目录 + `<归档名>_分析包` / `<归档名>_解析结果`。
 * 与原 Python 完全一致（解析SAZ.py:438 `output_dir = os.path.join(saz_dir, f"{saz_name}_解析结果")`），
 * 这样“默认就能用”而不必每次手输。
 * 注意是**在其下建一个子目录**而不是直接往归档旁边写：
 * 否则一次导出就把上百个会话目录平铺到用户的 saz 目录里。
 */
function defaultOutDirFor(arc, kind) {
  const suffix = kind === 'legacy' ? '_解析结果' : '_分析包';
  const raw = String((arc && (arc.name || arc.path)) || '');
  const base = path.basename(raw).replace(/\.saz$/i, '') || 'saz';
  const parent = arc && arc.path ? path.dirname(arc.path) : process.cwd();
  return path.join(parent, base + suffix);
}

/**
 * 解析输出目录入参。
 * 留空 → 用默认（归档旁）；给了相对路径 → 拒（同 `open()` 的教训：按 CWD 补全会把人选向错误位置）。
 */
function resolveOutDir(arc, outDir, kind) {
  const given = cleanPathArg(outDir);
  if (!given) return defaultOutDirFor(arc, kind);
  if (!path.isAbsolute(given)) {
    throw new Error('输出目录必须是绝对路径，收到「' + given + '」。插件工作目录为 ' + process.cwd() +
      '，不猜相对路径；留空则默认落在归档所在目录。');
  }
  return path.normalize(given);
}

/** 索引会话 → UI 行（不带 Buffer，字段与摘要行一致）。 */
function projectSession(s) {
  return {
    sid: s.sid,
    seq: s.seq,
    flowId: s.flowId || null,
    category: s.category,
    categoryLabel: types.CATEGORY_LABEL[s.category] || s.category,
    categoryReasons: s.categoryReasons,
    method: s.method,
    url: s.url,
    urlTemplate: s.urlTemplate,
    host: s.host,
    port: s.port,
    scheme: s.scheme,
    path: s.path,
    targetForm: s.targetForm,
    status: s.status,
    statusText: s.statusText,
    statusAbnormal: s.statusAbnormal || null,
    reqContentType: s.reqContentType,
    respContentType: s.respContentType,
    // Transfer-Encoding 与 Content-Encoding 是两层东西（chunked 是分块框架不是压缩），
    // 不把它带到 UI/工具侧，下游就没法知道“这条正文是被解过框的”。
    reqTransferEncoding: s.reqTransferEncoding || '',
    respTransferEncoding: s.respTransferEncoding || '',
    respEncodingChain: s.respEncodingChain,
    reqHeaderCount: s.reqHeaderCount,
    respHeaderCount: s.respHeaderCount,
    reqBodyBytes: s.reqBodyBytes,
    respBodyBytes: s.respBodyBytes,
    respPlainBytes: s.respEntryPlainBytes,
    respCompressedBytes: s.respEntryCompressedBytes,
    hasRequest: s.hasRequest,
    hasResponse: s.hasResponse,
    hasMeta: s.hasMeta,
    hasWs: s.hasWs,
    wsFrames: s.wsFrames,
    wsFrameBytes: s.wsFrameBytes,
    wsSubprotocol: s.wsSubprotocol,
    complete: s.complete,
    isUpgrade: s.isUpgrade,
    headerOnly: s.headerOnly,
    setCookieCount: s.setCookieCount,
    queryKeyCount: s.queryKeyCount,
    reqFields: s.reqFields,
    reqFieldsPartial: s.reqFieldsPartial,
    privacyTags: s.privacyTags,
    timers: s.timers,
  };
}

/** 正文 → 可跨边界结构（Buffer 转字符串或 hex，并保留长度事实）。 */
function projectBody(side, decodeInfo, opts) {
  const limit = (opts && opts.limitBytes) || 0;
  if (!side) return null;
  const buf = side.bodyBuf || Buffer.alloc(0);
  const textual = dec.looksTextual(buf, 4096);
  let text = null;
  let hex = null;
  const slice = limit && buf.length > limit ? buf.subarray(0, limit) : buf;
  if (textual) text = slice.toString('utf8');
  else hex = slice.subarray(0, Math.min(slice.length, 65536)).toString('hex');
  return {
    startLine: side.startLine,
    httpVersion: side.httpVersion,
    method: side.method || null,
    status: side.status || null,
    statusText: (side.statusText || '') ,
    url: side.url || null,
    headers: side.headers,
    contentType: side.contentType,
    contentEncoding: side.contentEncoding,
    contentLength: side.contentLength,
    transferEncoding: side.transferEncoding || '',
    headerBytes: side.headerBytes,
    rawBodyBytes: side.rawBodyBytes,
    bodyBytes: buf.length,
    bodyReturnedBytes: slice.length,
    bodyTotalBytes: side.bodyTotalBytes || buf.length,
    bodyTruncated: !!side.bodyTruncated || (limit > 0 && buf.length > limit),
    textual,
    text,
    hex,
    decode: decodeInfo || null,
  };
}

/**
 * 流式/多帧拆解结果 → 跨边界结构（F28）。
 *
 * 规则：一条记录里 `data`（原文字符串）与 `dataJson`（已解析对象）**不重复给**：
 * 能解析成 JSON 的只给 dataJson（它信息量严格更高且不占双份 token），
 * 解不开的才给 data 原文。完整原文在 `response.text` 里一份不少，不会丢。
 */
function projectStream(stm, o) {
  const from = o.streamFrom || 0;
  const count = o.streamCount === undefined ? 60 : o.streamCount;
  const isSse = stm.kind === 'event-stream';
  const all = isSse ? (stm.events || []) : (stm.values || []);
  const brief = isSse
    ? (e) => {
      const out = { index: e.index, id: e.id, event: e.event, retry: e.retry, commentLines: e.commentLines || 0 };
      if (e.dataJson !== undefined) {
        out.dataType = e.dataType || typeof e.dataJson;
        out.dataShape = streamCore.topKeysOf(e.dataJson, 12);
        out.dataJson = e.dataJson;
        out.dataChars = e.data.length;
      } else {
        out.data = e.data;
        out.dataChars = e.data === null ? 0 : e.data.length;
        if (e.dataParseError) out.dataParseError = e.dataParseError;
      }
      if (e.dataTruncated) out.dataTruncated = true;
      if (e.other) out.other = e.other;
      return out;
    }
    : (v) => {
      const out = { index: v.index, start: v.start, end: v.end, chars: v.chars };
      if (v.json !== undefined) { out.type = v.type; out.dataShape = streamCore.topKeysOf(v.json, 12); out.dataJson = v.json; }
      else out.parseError = v.parseError || null;
      return out;
    };
  return {
    kind: stm.kind,
    stats: stm.stats || null,
    eventTypes: stm.eventTypes || null,
    truncated: !!stm.truncated,
    note: stm.note || null,
    total: all.length,
    returned: Math.min(count, Math.max(0, all.length - from)),
    items: all.slice(from, from + count).map(brief),
    // 供 streamEvents() 分页用的“全量投影”（不放进 detail 返回体，避免跨边界双份）
    allItems: (o.streamNeedAll === true) ? all.map(brief) : null,
  };
}

/**
 * 创建 API 表面。
 * @param {{store:object, host?:object, logger?:(m:string)=>void, progress?:(p:object)=>void}} deps
 *   host 即 window.ztools；progress 用于长任务进度上报
 */
function createApi(deps) {
  const store = deps.store;
  const host = deps.host || null;
  const log = deps.logger || (() => {});
  // 进度一律由**内部事件总线**播，不接收渲染端传进来的回调：
  // 跳桥传函数在新版 Electron 里才可用，与其依赖版本行为，不如让 UI 订阅事件（两种挂载下都一致）。
  const emitProgress = deps.progress || (() => {});

  /** 取"当前归档"，没有就报可操作的错误。 */
  function needCurrent() {
    const arc = store.current;
    if (!arc) throw new Error('尚未解析任何 .saz 文件：请先拖入文件或调用 saz_parse 指定绝对路径');
    return arc;
  }
  function pickArchive(sazPath) {
    if (!sazPath) return needCurrent();
    const hit = store.peek(sazPath);
    if (hit) return hit;
    return store.open(sazPath);
  }

  const api = {
    /* ---------------- 元信息 ---------------- */
    info() {
      return {
        plugin: { name: manifest.name, title: manifest.title, version: manifest.version },
        engine: { capabilities: dec.capabilities(), zeroDependency: true },
        privacy: { valuesInSummary: 'full', note: '隐私值默认完整保留；脱敏只会另生成副本' },
        store: store.stat(),
        host: host ? { available: true, apis: Object.keys(host) } : { available: false },
        tools: Object.keys(manifest.tools || {}),
      };
    },

    /* ---------------- 解析与索引 ---------------- */
    open(sazPath, options) {
      const given = cleanPathArg(sazPath);
      if (!given) throw new Error('没有收到文件路径');
      /*
       * 绝不把相对路径按当前工作目录补全。插件进程的 CWD 是 ZTools 安装目录，
       * 拼出来的“文件不存在：<ZTools 安装目录>\xxx.saz”会把人与 AI 完全引向错误方向
       *（实测：粘贴触发只拿到文件名时就这么错了一轮）。
       */
      if (!path.isAbsolute(given)) {
        throw new Error('需要 .saz 的绝对路径，收到的是「' + given + '」。插件工作目录为 ' + process.cwd()
          + '，相对路径不会被猜测补全；粘贴触发只拿到文件名时插件会自动回查剪贴板，仍失败请用「选择 .saz」。');
      }
      const abs = path.normalize(given);
      if (!fs.existsSync(abs)) throw new Error('文件不存在：' + abs);
      if (fs.statSync(abs).isDirectory()) throw new Error('需要 .saz 文件，给的是目录：' + abs);
      const arc = store.open(abs, options || {});
      return {
        archive: { name: arc.name, path: arc.path, sizeBytes: arc.fileSize, entries: arc.entryCount, elapsedMs: arc.elapsedMs },
        summary: arc.summary,
        sessions: arc.sessions.map(projectSession),
      };
    },
    reindex(sazPath, options) {
      return api.open(sazPath, Object.assign({}, options, { reindex: true }));
    },
    close(sazPath) { return store.close(sazPath); },
    stat() { return store.stat(); },

    /** 当前索引概览（不重发全部会话，供 UI 头部与 tool 复用）。 */
    summary(sazPath) { return pickArchive(sazPath).summary; },

    /* ---------------- 取数（F24）---------------- */
    list(filter, page) {
      const arc = pickArchive(filter && filter._sazPath);
      const f = Object.assign({}, filter);
      delete f._sazPath;
      const r = query.querySessions(arc.sessions, f, page || {});
      return {
        total: r.total,
        matched: r.matched,
        returned: r.returned,
        offset: r.offset,
        activeFilters: r.activeFilters,
        estTokens: r.items.reduce((a, s) => a + token.estimateTokens(s.urlTemplate || s.url) + 24, 0),
        items: r.items.map(projectSession),
      };
    },
    group(by, filter) {
      const arc = needCurrent();
      const f = filter || {};
      const sel = query.querySessions(arc.sessions, f, {}).items;
      return query.groupSessions(sel, by || 'host').map((g) => ({
        key: g.key, count: g.count,
        sids: g.items.slice(0, 50).map((s) => s.sid),
        truncated: g.count > 50,
        categories: g.items.reduce((a, s) => { a[s.category] = (a[s.category] || 0) + 1; return a; }, {}),
      }));
    },

    /* ---------------- 单会话 ---------------- */
    detail(sid, opts) {
      const found = store.find(sid);
      if (!found) throw new Error('未找到会话 sid=' + sid + '（该归档可能尚未解析）');
      const o = opts || {};
      const d = found.archive.detail(found.session, {
        withFields: o.withFields !== false,
        maxBodyBytes: o.limitBytes || 0,
        // F28：拆解只在调用方要的时候做（拆 2000+ 事件不便宜），并且只对 event-stream / 整块解不开的 JSON 生效
        withStream: o.withStream === true,
        streamOptions: o.streamOptions,
      });
      return {
        sid: found.session.sid,
        seq: found.session.seq,
        session: projectSession(found.session),
        archivePath: found.key,
        // 解码事实单独上提：判断“这一侧到底解没解开”不该要求调用方去猜 body 的结构
        decode: d.decode || {},
        request: projectBody(d.request, d.decode.request, o),
        response: projectBody(d.response, d.decode.response, o),
        meta: d.meta ? {
          sid: d.meta.sid, bitFlags: d.meta.bitFlags, flags: d.meta.flags,
          certPolicyErrors: d.meta.certPolicyErrors, clientIP: d.meta.clientIP,
          timers: d.meta.timers, numeric: d.meta.numeric, derived: d.meta.derived,
        } : null,
        fields: {
          request: d.request && d.request.fields ? d.request.fields.fields : [],
          response: d.response && d.response.fields ? d.response.fields.fields : [],
        },
        websocket: d.websocket ? {
          stats: d.websocket.stats, parseErrors: d.websocket.parseErrors, truncated: d.websocket.truncated,
          records: d.websocket.records.slice(o.wsFrom || 0, (o.wsFrom || 0) + (o.wsCount || 200)).map((r, i) => ({
            index: (o.wsFrom || 0) + i,
            dir: r.dir, id: r.id, bitFlags: r.bitFlags,
            doneRead: r.doneRead, beginSend: r.beginSend, doneSend: r.doneSend,
            declaredFrameLen: r.declaredFrameLen, rawLength: r.rawLength,
            frame: {
              fin: r.frame.fin, opcode: r.frame.opcode, opcodeName: r.frame.opcodeName,
              masked: r.frame.masked, payloadLen: r.frame.declaredPayloadLen,
              headerBytes: r.frame.headerBytes, consistent: r.frame.frameConsistent, note: r.frame.frameNote,
            },
            text: r.textPreview === undefined ? null : r.textPreview,
            hex: (() => {
              if (r.textPreview !== undefined && r.textPreview !== null) return null;
              const p = d.websocket.payloadAt(o.wsFrom ? o.wsFrom + i : i);
              return p ? p.subarray(0, Math.min(256, p.length)).toString('hex') : null;
            })(),
          })),
        } : null,
        // 流式/多帧正文的结构化视图（F28）；不拆时固定为 null，调用方据此区分“没拆”与“拆了但为空”
        stream: d.response && d.response.stream ? projectStream(d.response.stream, o) : null,
      };
    },

    /* ---------------- 流式 / 分块正文（F28 / B11）---------------- */
    /** 归档里哪些会话是事件流（按响应头判定，不读正文）。 */
    streamList() {
      const arc = needCurrent();
      return arc.sessions.filter((s) => streamCore.isEventStream(s.respContentType)).map((s) => ({
        sid: s.sid, seq: s.seq, url: s.url, host: s.host, status: s.status,
        respContentType: s.respContentType, respPlainBytes: s.respEntryPlainBytes,
        flowId: s.flowId || null, category: s.category, complete: s.complete,
      }));
    },
    /** chunked 会话清单（解框已在取正文时自动完成，这里只给导航与留痕）。 */
    chunkedList() {
      const arc = needCurrent();
      return arc.sessions.filter((s) => dec.isChunked(s.respTransferEncoding)).map((s) => ({
        sid: s.sid, seq: s.seq, url: s.url, status: s.status,
        respContentType: s.respContentType, respTransferEncoding: s.respTransferEncoding,
        respPlainBytes: s.respEntryPlainBytes, flowId: s.flowId || null, category: s.category,
      }));
    },
    /**
     * 取某会话的事件流 / 多值 JSON（分页）。
     * 与 websocketFrames 同构：一次只给一页，完整 data 默认附上（隐私值不裁剪的项目口径）。
     */
    streamEvents(sid, opts) {
      const o = opts || {};
      const d = api.detail(sid, {
        withFields: false, withStream: true, limitBytes: o.limitBytes || 0,
        streamFrom: o.from || 0, streamCount: o.count === undefined ? 200 : o.count, streamNeedAll: true,
        streamOptions: { maxEvents: Math.max(2000, (o.from || 0) + (o.count || 200) * 2) },
      });
      const stm = d.stream;
      if (!stm) {
        return { sid, kind: 'none', total: 0, events: [], note: '该会话不是事件流，也不是整块解不开的多值 JSON（或正文未能解压）' };
      }
      const from = o.from || 0;
      const count = o.count === undefined ? 200 : o.count;
      const all = stm.allItems || [];
      return {
        sid,
        kind: stm.kind,
        stats: stm.stats,
        eventTypes: stm.eventTypes || null,
        truncated: stm.truncated,
        note: stm.note || null,
        total: all.length,
        from,
        returned: Math.min(count, Math.max(0, all.length - from)),
        events: all.slice(from, from + count),
        next: (from + count < all.length) ? '还有 ' + (all.length - from - count) + ' 条，用 from=' + (from + count) + ' 继续取' : null,
      };
    },

    /** 原始报文字节（保真出口：导出/校验/自查都用它，不做任何改写）。 */
    raw(sid, side, opts) {
      const found = store.find(sid);
      if (!found) throw new Error('未找到会话 sid=' + sid);
      const refs = found.session.refs || {};
      const key = side === 'request' ? 'reqEntry' : side === 'meta' ? 'metaEntry'
        : side === 'ws' ? 'wsEntry' : 'respEntry';
      if (refs[key] === null || refs[key] === undefined) throw new Error('该会话没有 ' + side + ' 侧条目');
      // 复用已打开句柄，不重开 zip（实测重开一次代价 16ms，逐条取就变成线性累积）
      const data = found.archive.readEntry(refs[key]);
      const limit = (opts && opts.limitBytes) || 0;
      const slice = limit && data.length > limit ? data.subarray(0, limit) : data;
      return { sid: found.session.sid, side, entry: key, bytes: data.length, returned: slice.length, base64: slice.toString('base64') };
    },

    /* ---------------- 分析元特征 ---------------- */
    endpoints(filter) {
      const arc = needCurrent();
      const sel = query.querySessions(arc.sessions, filter || {}, {}).items;
      return query.groupSessions(sel, 'urlTemplate').map((g) => {
        const first = g.items[0];
        const params = new Map();
        for (const s of g.items) for (const f of s.reqFields || []) if (!params.has(f.path)) params.set(f.path, f.type);
        return {
          endpoint: g.key,
          calls: g.count,
          host: first.host,
          category: first.category,
          statuses: [...new Set(g.items.map((s) => s.status))],
          errorCount: g.items.filter((s) => Number(s.status) >= 400 || s.statusAbnormal).length,
          paramNames: [...params.keys()],
          authSessions: g.items.filter((s) => (s.privacyTags || []).some((t) => t.kind === 'auth')).length,
          sids: g.items.slice(0, 40).map((s) => s.sid),
          sidsTruncated: g.count > 40,
        };
      });
    },
    flows() {
      const arc = needCurrent();
      const g = flow.groupFlows(arc.sessions, {});
      return {
        params: g.params,
        flows: g.flows.map((f) => ({
          flowId: f.flowId, startIso: f.startIso, endIso: f.endIso, spanMs: f.spanMs,
          sessionCount: f.sessionCount, apiCount: f.apiCount, logicCount: f.logicCount, noiseCount: f.noiseCount,
          hostCount: f.hostCount, endpointCount: f.endpointCount, plainResponseBytes: f.plainResponseBytes,
          topHosts: f.topHosts, methods: f.methods,
          firstApi: f.firstApi ? f.firstApi.method + ' ' + (f.firstApi.urlTemplate || f.firstApi.url) : null,
          lastApi: f.lastApi ? f.lastApi.method + ' ' + (f.lastApi.urlTemplate || f.lastApi.url) : null,
          sids: f.sids,
        })),
        unassignedCount: g.unassigned.length,
      };
    },
    chains(opts) {
      const arc = needCurrent();
      const l = flow.buildValueLedger(arc, opts || {});
      return { stats: l.stats, budgetNotes: l.budgetNotes, chains: l.chains };
    },
    credentials() {
      const arc = needCurrent();
      return flow.buildCredentialBoard(arc);
    },
    /** 隐私字段全景（回答"这个包里有哪几类敏感值、分别出现在哪些会话"）。 */
    privacyMap() {
      const arc = needCurrent();
      const byKind = new Map();
      for (const s of arc.sessions) {
        for (const t of s.privacyTags || []) {
          if (!byKind.has(t.kind)) byKind.set(t.kind, { kind: t.kind, count: 0, names: new Set(), sids: [], valueLengths: [] });
          const rec = byKind.get(t.kind);
          rec.count++;
          rec.names.add(t.name);
          rec.valueLengths.push(t.valueLength || String(t.value || '').length);
          if (rec.sids.length < 50) rec.sids.push(s.sid);
        }
      }
      return [...byKind.values()].map((r) => ({
        kind: r.kind, count: r.count, names: [...r.names], sids: r.sids,
        sidsTruncated: r.count > r.sids.length,
        valueLength: { min: Math.min(...r.valueLengths), max: Math.max(...r.valueLengths), avg: Math.round(r.valueLengths.reduce((a, b) => a + b, 0) / r.valueLengths.length) },
      })).sort((a, b) => b.count - a.count);
    },
    /** 归档里出现过的解压算法清单（用来判断"这台机器能不能全解"）。 */
    encodings() {
      const arc = needCurrent();
      return { distribution: arc.summary.responseEncoding, failed: arc.summary.responseEncodingFailed, capabilities: dec.capabilities() };
    },

    /* ---------------- 分析包与导出 ---------------- */
    /**
     * 默认输出目录（纯计算，**不会创建任何东西**）。
     * 返回对象而不是字符串：UI 选目录对话框需要“归档所在目录”做起点，
     * 直接把默认目录当 defaultPath 传过去会因它还不存在而被宿主回落到别处。
     */
    defaultOutDir(kind) {
      const arc = needCurrent();
      const k = kind === 'legacy' ? 'legacy' : 'analysis';
      const dir = defaultOutDirFor(arc, k);
      return { kind: k, dir, archiveDir: path.dirname(arc.path), exists: fs.existsSync(dir) };
    },
    /** 只估算不落盘（UI 的"当前选择 ≈ N token"实时提示）。 */
    estimate(profile) {
      const arc = needCurrent();
      const p = pkgmod.buildAnalysisPackage(arc, Object.assign({}, profile, { withBodies: false }), null);
      const withBodies = profile && profile.withBodies === true;
      const q = withBodies ? p : pkgmod.buildAnalysisPackage(arc, profile || {}, null);
      return {
        tier: q.manifest.profile.tier,
        tokens: q.manifest.totals.tokens,
        chars: q.manifest.totals.chars,
        files: q.manifest.totals.files,
        volumes: q.manifest.totals.summaryVolumes + q.manifest.totals.bodyVolumes,
        trimLog: q.manifest.trimLog,
        counts: q.manifest.counts,
        estimateMode: 'heuristic',
        budgetPerVolume: q.manifest.profile.tokenBudgetPerVolume,
      };
    },
    buildPackage(outDir, profile) {
      const arc = needCurrent();
      // 留空走默认（归档旁建 `<名>_分析包`），与解析SAZ.py 的输出位置一致
      const dir = resolveOutDir(arc, outDir, 'analysis');
      fs.mkdirSync(dir, { recursive: true });
      const t0 = Date.now();
      const p = pkgmod.buildAnalysisPackage(arc, profile || {}, (e) => emitProgress(Object.assign({ kind: 'package' }, e)));
      const w = pkgmod.writePackage(p, dir);
      // F25：脱敏副本是**另生成一份**，原包不动
      const copies = [{ dir, masked: false }];
      if (profile && profile.maskCopy) {
        const mdir = dir + '-masked';
        fs.mkdirSync(mdir, { recursive: true });
        const pm = pkgmod.buildAnalysisPackage(arc, Object.assign({}, profile, { valuesInSummary: 'masked', maskCopy: false }), (e) => emitProgress(Object.assign({ kind: 'package', copy: 'masked' }, e)));
        pkgmod.writePackage(pm, mdir);
        copies.push({ dir: mdir, masked: true, tokens: pm.manifest.totals.tokens });
      }
      return {
        outDir: dir,
        elapsedMs: Date.now() - t0,
        manifest: p.manifest,
        written: w.written,
        copies,
      };
    },
    exportLegacy(outDir, options) {
      const arc = needCurrent();
      const dir = resolveOutDir(arc, outDir, 'legacy');
      const t0 = Date.now();
      const m = legacy.exportLegacy(arc, dir, options || {}, (e) => emitProgress(Object.assign({ kind: 'legacy' }, e)));
      return { outDir: dir, elapsedMs: Date.now() - t0, manifest: m };
    },

    /**
     * F27 一键解析：与旧 `解析SAZ.py` 同效 —— 索引后直接把同构目录树落盘，全程不需要界面。
     * 落点用默认规则（归档旁 `<名>_解析结果`）；失败以数据返回，不抛（抛出后宿主只能看到超时）。
     * 故意不注册成 MCP 工具：给 AI 取数可以，替人写盘不行（D17）。
     */
    async quickParse(sazPath, options) {
      const t0 = Date.now();
      const o = Object.assign({}, options || {});
      const opened = api.open(sazPath, o.openOptions || {});
      const settings = await api.settingsGet();
      const legacyOptions = Object.assign(
        { beautifyLevel: o.beautifyLevel || settings.beautifyLevel },
        o.legacy || {},
      );
      const r = api.exportLegacy(o.outDir, legacyOptions);
      const m = r.manifest;
      const rec = {
        path: opened.archive.path, name: opened.archive.name, mode: 'quick',
        sessions: opened.summary.sessionCount, outDir: r.outDir,
        files: m.counts.files, dirs: m.counts.dirs, bytes: m.counts.bytes,
        at: Date.now(),
      };
      // 历史写入不能影响主路：一闪而过的场景里，这份记录是唯一能回查的线索
      try { await api.historyPut(rec); } catch (e) { log('写入解析历史失败（不影响结果）：' + e.message); }
      api.notify('一键解析完成', r.outDir + '（' + m.counts.dirs + ' 会话目录 / ' + m.counts.files + ' 文件）');
      return {
        ok: true, outDir: r.outDir, archive: opened.archive, summary: opened.summary,
        counts: m.counts, options: m.options, elapsedMs: Date.now() - t0,
      };
    },

    /* ---------------- WebSocket（F26）---------------- */
    websocketList() {
      const arc = needCurrent();
      return arc.sessions.filter((s) => s.hasWs).map((s) => ({
        sid: s.sid, seq: s.seq, url: s.url, host: s.host, status: s.status,
        subprotocol: s.wsSubprotocol, frames: s.wsFrames, frameBytes: s.wsFrameBytes,
        flowId: s.flowId || null, category: s.category,
      }));
    },
    websocketFrames(sid, opts) {
      const d = api.detail(sid, Object.assign({ withFields: false }, opts || {}));
      if (!d.websocket) return { sid, total: 0, frames: [], note: '该会话没有 _w.txt 帧日志' };
      return { sid, stats: d.websocket.stats, parseErrors: d.websocket.parseErrors, total: d.websocket.records.length, frames: d.websocket.records };
    },

    /* ---------------- 宿主能力包装 ---------------- */
    /** 选文件：优先宿主对话框，拿不到路径时走 checkFilePaths / getLastCopiedContent 兜底。 */
    async pickFile() {
      if (host && typeof host.showOpenDialog === 'function') {
        const r = await host.showOpenDialog({
          title: '选择 Fiddler .saz 抓包文件',
          buttonLabel: '解析',
          filters: [{ name: 'Fiddler 抓包', extensions: ['saz', 'zip'] }],
          properties: ['openFile'],
        });
        const p = Array.isArray(r) ? r[0] : r;
        if (p) return { source: 'dialog', path: String(p) };
      }
      const fromClipboard = await api.lastCopiedFile();
      if (fromClipboard) return { source: 'clipboard', path: fromClipboard.path };
      throw new Error('无法取得文件路径：宿主对话框不可用，且剪贴板里没有 .saz 文件');
    },
    pickDir(defaultPath) {
      if (!host || typeof host.showSaveDialog !== 'function') throw new Error('宿主未提供 showSaveDialog');
      return host.showSaveDialog({
        title: '选择解析结果输出目录',
        buttonLabel: '到这里',
        defaultPath: defaultPath || undefined,
        properties: ['createDirectory', 'showWriteOnlyDirectory'],
      });
    },
    /**
     * 未文档化但实测存在的通路：主窗口“已检查的路径”与最近复制内容。
     * 真实形状从 ZTools 渲染端源码确证（SearchBox 粘贴处理器）：
     *   const c = await ztools.getLastCopiedContent();
     *   c.type === 'file' → 文件列表在 **c.data**，项为 {path,name,isDirectory,isFile}，path 是绝对路径
     *   c.type === 'image' → c.data 是图片数据；'text' → c.data 是文本
     * 因此当触发只递过来一个文件名时，这是取回真实路径的主兜底。
     */
    async checkPaths(paths) {
      if (!host || typeof host.checkFilePaths !== 'function') return [];
      return await host.checkFilePaths(Array.isArray(paths) ? paths : [paths]);
    },
    async lastCopiedFile(fileName) {
      if (!host || typeof host.getLastCopiedContent !== 'function') return null;
      try {
        const c = await host.getLastCopiedContent();
        // data 是实测主键；file/files 是早先的猜测，留着不伤。
        const raw = (c && (Array.isArray(c.data) ? c.data : (c.file || c.files))) || [];
        const arr = (Array.isArray(raw) ? raw : [raw]).filter((f) => f && typeof f === 'object');
        const saz = arr.filter((f) => /\.saz$/i.test(String(f.path || '')) && f.path && path.isAbsolute(String(f.path)));
        if (!saz.length) return null;
        if (!fileName) return { path: saz[0].path, name: saz[0].name || path.basename(saz[0].path), matched: 'first' };
        const want = String(fileName).toLowerCase();
        const hit = saz.find((f) => String(f.name || '').toLowerCase() === want ||
          path.basename(String(f.path)).toLowerCase() === want);
        return hit ? { path: hit.path, name: hit.name || path.basename(hit.path), matched: 'by-name' } : null;
      } catch (e) {
        log('lastCopiedFile 失败：' + e.message);
        return null;
      }
    },
    /** 拖放/粘贴进来的路径列表里筛出 .saz。 */
    findSaz(list) {
      return (Array.isArray(list) ? list : []).filter((p) => /\.saz$/i.test(String(p && p.path ? p.path : p)))
        .map((p) => (typeof p === 'string' ? p : p.path));
    },
    notify(title, body) {
      if (host && typeof host.showNotification === 'function') { try { host.showNotification(title, body); return true; } catch (e) { return false; } }
      return false;
    },
    /**
     * 复制文本（F8）。优先用宿主 copyText：
     * 渲染端的 navigator.clipboard 在 file:// 下须要焦点与权限，导出后一键复制经常拿不到。
     * 返回实际走的那条通路，方便 UI 在失败时自己退回选中文本。
     */
    copyText(text) {
      const s = String(text === undefined || text === null ? '' : text);
      if (host && typeof host.copyText === 'function') {
        try { host.copyText(s); return { ok: true, via: 'ztools' }; } catch (e) { /* 继续试渲染端 */ }
      }
      try {
        const ta = document.createElement('textarea');
        ta.value = s;
        ta.setAttribute('readonly', '');
        ta.style.position = 'fixed';
        ta.style.left = '-9999px';
        document.body.appendChild(ta);
        ta.select();
        const ok = document.execCommand('copy');
        document.body.removeChild(ta);
        return { ok, via: 'execCommand' };
      } catch (e) { return { ok: false, via: 'none', error: e.message }; }
    },
    /** 在资源管理器里打开导出结果（无宿主时静默失败，由调用方提示路径）。 */
    openPath(p) {
      if (!host || typeof host.shellOpenPath !== 'function') return false;
      try { host.shellOpenPath(String(p)); return true; } catch (e) { log('openPath 失败：' + e.message); return false; }
    },
    /* ---------------- 解析历史（F14）----------------
     * 为什么写成三个顶层函数而不是 `history: { put, get, clear }`：
     * 挂载有两种通路（直挂 window / contextBridge），后者的代理不能依赖嵌套对象上的方法，
     * 而两种通路下 UI 拿到的形状必须一致。因此 **API 面保持扁平：只有顶层函数，返回值一律纯数据**。
     */
    async historyPut(record) {
      if (!host || typeof host.dbStorageSet !== 'function') return null;
      const key = 'saz-parser:history';
      const cur = (await host.dbStorageGet(key)) || [];
      const list = [Object.assign({ at: Date.now() }, record)].concat(
        (Array.isArray(cur) ? cur : []).filter((r) => r.path !== record.path)
      ).slice(0, 20);
      await host.dbStorageSet(key, list);
      return list;
    },
    async historyGet() {
      if (!host || typeof host.dbStorageGet !== 'function') return [];
      const cur = await host.dbStorageGet('saz-parser:history');
      return Array.isArray(cur) ? cur : [];
    },
    async historyClear() {
      if (!host || typeof host.dbStorageSet !== 'function') return;
      await host.dbStorageSet('saz-parser:history', []);
    },

    /* ---------------- 设置（F27 等开关）----------------
     * 与历史同理：扁平函数 + 纯数据返回值。无宿主持久化时返回默认值并标记 persisted=false，
     * 让 UI 能诚实地告诉用户“这个开关不会记忆”。
     */
    async settingsGet() {
      if (!host || typeof host.dbStorageGet !== 'function') {
        return Object.assign({ persisted: false }, DEFAULT_SETTINGS);
      }
      let cur = null;
      try { cur = await host.dbStorageGet('saz-parser:settings'); } catch (e) { log('读设置失败：' + e.message); }
      return Object.assign({ persisted: true }, DEFAULT_SETTINGS, cur && typeof cur === 'object' ? cur : {});
    },
    async settingsSet(patch) {
      /*
       * 合并顺序必须是 默认值 → 已存值 → 本次 patch。
       * 早期版本先拼了 DEFAULT_SETTINGS 再盖到已存值上，结果是
       * “改一个开关会把其他设置静默重置为默认”（例如改 autoClose 会把 beautifyLevel 打回 json）。
       */
      const cur = await api.settingsGet();
      const merged = Object.assign({}, DEFAULT_SETTINGS, cur,
        (patch && typeof patch === 'object') ? patch : {});
      const canPersist = !!(host && typeof host.dbStorageSet === 'function');
      const { persisted, ...toStore } = merged;   // 不把“这台宿主存不住”的标记存进用户数据里
      if (!canPersist) return Object.assign({ persisted: false }, toStore);
      await host.dbStorageSet('saz-parser:settings', toStore);
      return Object.assign({ persisted: true }, toStore);
    },
  };

  return api;
}

module.exports = { createApi, projectSession, projectBody, defaultOutDirFor, resolveOutDir };
