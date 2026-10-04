'use strict';

/**
 * render.js —— 分析包的文本呈现层（B 层）
 *
 * 服务对象是 LLM 而不是人眼，因此遵循三条与"漂亮文档"相反的原则：
 * 1. **信息密度优先**：一行一条会话，不用表格边框浪费 token；
 * 2. **自解释**：每个文件开头用一行说明"这是什么、按什么排序、怎么回溯原文"，
 *    使得任何一卷被单独丢进上下文都不需要外部说明就能读懂；
 * 3. **可回溯**：每条素材都带 sid，AI 结论能反查到归档原始字节。
 *
 * 隐私值呈现由 `valuesInSummary` 控制（默认 full，即完整列出）：
 *   full       —— 原值（第一目的基线 1：隐私值是分析对象）
 *   names-only —— 只给字段名与长度，用于压 token
 *   masked     —— 首尾各 4 字符 + 长度
 * 三种模式**只影响这里生成的字符串**，数据层与 `60-bodies/` 的原始字节不受影响。
 */

const token = require('./token');
const stream = require('../core/stream');

/** 按模式呈现一个字段值。 */
function presentValue(value, mode) {
  const v = value === undefined || value === null ? '' : String(value);
  if (v === '') return '(空)';
  const m = mode || 'full';
  if (m === 'names-only') return '‹' + v.length + '字›';
  if (m === 'masked') return v.length <= 8 ? '‹' + v.length + '字›' : v.slice(0, 4) + '…' + v.slice(-4) + '‹' + v.length + '›';
  return v;
}

/** 单行会话摘要（L1 主力形态）。 */
function sessionLine(s, opts) {
  const o = opts || {};
  const mode = o.valuesInSummary || 'full';
  const bits = [];
  bits.push('sid=' + s.sid);
  bits.push('#' + s.seq);
  if (s.flowId) bits.push(s.flowId);
  bits.push(s.method || 'REQ');
  bits.push(s.urlTemplate || s.url || '(无 URL)');
  bits.push('→ ' + (s.status || '—') + (s.statusText ? ' ' + s.statusText : ''));
  if (s.timers && typeof s.timers.totalMs === 'number') bits.push(s.timers.totalMs + 'ms');
  if (s.respEntryPlainBytes) bits.push('resp=' + token.humanBytes(s.respEntryPlainBytes));
  if (s.respEncodingChain && s.respEncodingChain.length) bits.push('enc=' + s.respEncodingChain.join('+'));
  if (s.respContentType) bits.push('ct=' + s.respContentType.split(';')[0]);
  if (s.category !== 'api') bits.push('档=' + s.category);
  if (s.headerOnly) bits.push('仅头');
  if (s.reqFields && reqFieldLimit(o) > 0) {
    const names = (s.reqFields || []).slice(0, reqFieldLimit(o)).map((f) => f.path + (f.type && f.type !== 'string' ? ':' + f.type : '')).join(',');
    if (names) bits.push('参数[' + names + ']' + ((s.reqFields || []).length > reqFieldLimit(o) ? '…+' + ((s.reqFields.length) - reqFieldLimit(o)) : ''));
    if (s.reqFieldsPartial) bits.push('参数=部分(体被截断)');
  }
  const priv = (s.privacyTags || []);
  if (priv.length) {
    const grouped = new Map();
    for (const t of priv) {
      if (!grouped.has(t.kind)) grouped.set(t.kind, []);
      grouped.get(t.kind).push(t);
    }
    for (const [kind, list] of grouped) {
      bits.push('隐私/' + kind + '[' + list.map((t) =>
        t.name + '=' + (mode === 'names-only' ? '‹' + (t.valueLength || 0) + '字›' : presentValue(t.value, mode))).join(' ') + ']');
    }
  }
  if (s.hasWs) bits.push('WS帧=' + s.wsFrames);
  if (s.isUpgrade) bits.push('101');
  return bits.join('  ');
}

function reqFieldLimit(o) {
  return o.maxFieldsInLine === undefined ? 24 : Number(o.maxFieldsInLine);
}

/** L0 概览。 */
function renderOverview(archive, ctx) {
  const sm = archive.summary;
  const L = [];
  L.push('# L0 概览 · ' + archive.name);
  L.push('本文件是整包索引入口；所有结论都必须能按 sid 回溯到 60-bodies/ 与归档原始字节。');
  L.push('档位=' + ctx.tier + '  隐私值呈现=' + ctx.valuesInSummary + '  token估算=' + token.DEFAULTS.cjkTokens + '×CJK + 1/4×其他');
  L.push('');
  L.push('## 规模');
  L.push('会话 ' + sm.sessionCount + ' 条  域名 ' + sm.hostCount + ' 个  归档条目 ' + archive.entryCount +
    '  归档大小 ' + token.humanBytes(archive.sizeBytes));
  L.push('响应明文合计 ' + token.humanBytes(sm.totalBodyBytesPlain) + '（压缩后 ' + token.humanBytes(sm.totalBodyBytesCompressed) + '）');
  L.push('三档：接口 ' + sm.categoryCount.api + ' / 逻辑素材 ' + sm.categoryCount.logic + ' / 噪声 ' + sm.categoryCount.noise);
  L.push('配对：请求 ' + sm.pairing.withRequest + '  响应 ' + sm.pairing.withResponse +
    '  元数据 ' + sm.pairing.withMeta + '  WebSocket 日志 ' + sm.pairing.withWs +
    '  半截会话 ' + sm.pairing.incomplete + '  未识别条目 ' + sm.pairing.skipped);
  if (sm.websocket && sm.websocket.sessions) {
    L.push('WebSocket：' + sm.websocket.sessions + ' 个连接、' + sm.websocket.frames + ' 帧、' +
      token.humanBytes(sm.websocket.frameBytes) + ' 明文（原解析脚本完全不产出这部分）');
  }
  if (sm.stream && sm.stream.eventStreamResponses) {
    L.push('事件流（text/event-stream）响应 ' + sm.stream.eventStreamResponses + ' 条 —— 已逐事件拆开，见 `66-stream.md` 与会话正文的「事件流拆分」段');
  }
  if (sm.transferChunked && (sm.transferChunked.responses || sm.transferChunked.requests)) {
    L.push('带 `Transfer-Encoding: chunked` 的报文：响应 ' + (sm.transferChunked.responses || 0) + ' 条 / 请求 ' + (sm.transferChunked.requests || 0) + ' 条'
      + ' —— 均先做 transfer-decoding 再解压（修 B11，原解析脚本把分块框架当正文写出）');
  }
  L.push('');
  L.push('## 响应编码');
  L.push(JSON.stringify(sm.responseEncoding));
  if (sm.responseEncodingFailed && sm.responseEncodingFailed.length) {
    L.push('⚠ 不可解清单（前 20）：');
    for (const f of sm.responseEncodingFailed.slice(0, 20)) L.push('  sid=' + f.sid + ' ' + f.algorithm + ' 原因=' + f.reason);
  }
  L.push('');
  L.push('## 域名 Top 20');
  for (const h of sm.topHosts) L.push(h.count + '  ' + h.host);
  L.push('');
  L.push('## 状态码分布');
  L.push(Object.keys(sm.statusCount).sort((a, b) => Number(b) - Number(a)).map((k) => k + '×' + sm.statusCount[k]).join('  '));
  const abnormal = archive.sessions.filter((s) => s.statusAbnormal);
  if (abnormal.length) {
    L.push('⚠ 异常状态行 ' + abnormal.length + ' 条（Fiddler 占位/非标准码，代表抓包本身缺数据）：');
    for (const s of abnormal.slice(0, 10)) L.push('  sid=' + s.sid + ' ' + s.method + ' ' + (s.urlTemplate || s.url) + ' → ' + s.statusAbnormal);
  }
  L.push('');
  L.push('## 隐私字段类型计数（值默认完整保留在明细里）');
  L.push(Object.keys(sm.privacyKindCount).map((k) => k + '×' + sm.privacyKindCount[k]).join('  '));
  if (ctx.credentials && ctx.credentials.length) {
    L.push('');
    L.push('## 凭证与设备标识（跨会话复用）');
    L.push('distinctValues>1 表示该字段在抓包期间发生过变化（token 刷新 / 账号切换的强信号）');
    for (const c of ctx.credentials.slice(0, 25)) {
      L.push(c.name + '  会话数=' + c.sessionCount + '  不同值=' + c.distinctValues + (c.rotated ? '  ⚠变化过' : '') + '  位置=' + c.scope);
      for (const v of c.values.slice(0, 3)) {
        L.push('    ' + (ctx.valuesInSummary === 'names-only' ? '‹' + v.valueLength + '字›' : presentValue(v.display, ctx.valuesInSummary)) +
          '  首次#' + v.firstSeq + ' 末次#' + v.lastSeq + ' 覆盖' + v.sessionCount + '会话');
      }
    }
  }
  return L.join('\n');
}

/** L0 接口清单：按 urlTemplate 聚合。 */
function renderEndpoints(archive, ctx) {
  const groups = new Map();
  for (const s of archive.sessions) {
    if (s.category === 'noise' && !ctx.includeNoiseEndpoints) continue;
    const key = (s.method || 'REQ') + ' ' + (s.urlTemplate || s.url || '(无 URL)');
    if (!groups.has(key)) groups.set(key, { key, sessions: [], hosts: new Set(), status: new Map(), ct: new Set(), paramNames: new Map(), hasAuth: false, ws: false });
    const g = groups.get(key);
    g.sessions.push(s);
    if (s.host) g.hosts.add(s.host);
    g.status.set(s.status || 0, (g.status.get(s.status || 0) || 0) + 1);
    if (s.respContentType) g.ct.add(s.respContentType.split(';')[0]);
    if (s.reqContentType) g.ct.add('req:' + s.reqContentType.split(';')[0]);
    for (const f of s.reqFields || []) {
      const cur = g.paramNames.get(f.path);
      if (!cur) g.paramNames.set(f.path, { type: f.type, samples: f.sample ? [f.sample] : [] });
      else if (f.sample && cur.samples.length < 3 && !cur.samples.includes(f.sample)) cur.samples.push(f.sample);
    }
    if ((s.privacyTags || []).some((t) => t.kind === 'auth' || t.kind === 'token')) g.hasAuth = true;
    if (s.hasWs) g.ws = true;
  }
  const list = [...groups.values()].map((g) => {
    const total = g.sessions.length;
    const err = g.sessions.filter((s) => Number(s.status) >= 400 || s.statusAbnormal).length;
    const durations = g.sessions.map((s) => (s.timers && typeof s.timers.totalMs === 'number' ? s.timers.totalMs : null)).filter((x) => x !== null).sort((a, b) => a - b);
    return {
      key: g.key,
      calls: total,
      hosts: [...g.hosts],
      status: [...g.status.entries()].sort((a, b) => b[1] - a[1]).map(([k, v]) => k + '×' + v),
      errorRate: err / total,
      contentTypes: [...g.ct],
      hasAuth: g.hasAuth,
      isWebSocket: g.ws,
      params: [...g.paramNames.entries()].map(([p, m]) => ({ path: p, type: m.type, samples: m.samples })),
      p50Ms: durations.length ? durations[Math.floor(durations.length / 2)] : null,
      maxMs: durations.length ? durations[durations.length - 1] : null,
      sids: g.sessions.map((s) => s.sid).slice(0, 12),
      firstSeq: g.sessions[0].seq,
    };
  }).sort((a, b) => b.calls - a.calls);

  const L = [];
  L.push('# 接口清单 · 按 归一URL模板 聚合（调用次数降序）');
  L.push('URL 模板中的 {num}/{hex}/{uuid}/{jwt} 是被折叠的动态段；sids 为可直接引用的样本会话。');
  L.push('接口数 ' + list.length + '（含噪声档接口=' + (ctx.includeNoiseEndpoints ? '是' : '否') + '）');
  L.push('');
  for (const e of list) {
    L.push('## ' + e.key);
    L.push('调用=' + e.calls + '  域名=' + e.hosts.join(',') + '  状态=' + e.status.join(' ') +
      (e.errorRate > 0 ? '  错误率=' + (e.errorRate * 100).toFixed(0) + '%' : '') +
      (e.hasAuth ? '  带鉴权' : '') + (e.isWebSocket ? '  WebSocket' : '') +
      (e.p50Ms !== null ? '  耗时p50=' + e.p50Ms + 'ms/max=' + e.maxMs + 'ms' : ''));
    if (e.contentTypes.length) L.push('  类型: ' + e.contentTypes.join(', '));
    if (e.params.length) {
      L.push('  参数(' + e.params.length + '): ' + e.params.slice(0, 60).map((p) => {
        const s = ctx.valuesInSummary === 'full' && p.samples.length
          ? '=' + presentValue(p.samples[0], ctx.valuesInSummary) : '';
        return p.path + (p.type && p.type !== 'string' ? ':' + p.type : '') + s;
      }).join('  ') + (e.params.length > 60 ? ' …+' + (e.params.length - 60) : ''));
    }
    L.push('  sids: ' + e.sids.join(',') + (e.calls > e.sids.length ? ' …' : ''));
  }
  return { text: L.join('\n'), endpoints: list };
}

/** 单会话字段结构树（L1/L2 用，按接口聚合时可复用）。 */
function renderFieldTree(endpointGroups, ctx) {
  const L = [];
  L.push('# 字段结构 · 每个接口的请求参数与响应字段全集');
  L.push('由已索引字段合并；partial 表示请求体超过采样上限、字段集可能不完整。值呈现模式=' + ctx.valuesInSummary);
  L.push('');
  for (const g of endpointGroups) {
    if (!g.fields || !g.fields.length) continue;
    L.push('## ' + g.key);
    for (const f of g.fields) {
      const marks = [f.side === 'response' ? '响应' : '请求', f.from].filter(Boolean).join('/');
      const v = f.samples && f.samples.length ? ' 例=' + f.samples.map((x) => presentValue(x, ctx.valuesInSummary)).join(' | ') : '';
      L.push('  ' + f.path + '  ' + (f.type || '?') + '  出现=' + (f.count || 1) + (f.partial ? '  partial' : '') + v);
    }
  }
  return L.join('\n');
}

/** 流程分组与参数传递链。 */
function renderFlows(ctx) {
  const L = [];
  L.push('# 业务流程分组与跨会话参数传递链');
  L.push('分组依据：_m.xml 的 ClientBeginRequest 时序，间隙 > ' + ctx.gapMs + 'ms 断流；不足 ' + ctx.minSessions + ' 段的碎片已并入前段。');
  L.push('值账本：只登记“字面值确实出现在更早的响应里”的生产关系，未观察到的因果不做推断。');
  L.push('来源通路（看每行的 来源= 字段）：set-cookie / header = 响应头按项精确匹配（Set-Cookie 拆项、凭证类头整值）；');
  L.push('               literal = 响应正文子串；header-text = 响应头原文子串兜底（弱匹配，已写进 manifest.trimLog）。');
  L.push('使用位只取请求侧（query / body / 请求头 / cookie 拆项）：响应头算来源不算使用者，否则 firstUse 会被下发时刻提前。');
  L.push('');
  L.push('## 流程段（' + ctx.flows.length + ' 个）');
  for (const f of ctx.flows) {
    L.push('[' + f.flowId + '] ' + f.startIso + ' → ' + f.endIso + '  跨度=' + f.spanMs + 'ms  会话=' + f.sessionCount +
      '  接口=' + f.endpointCount + '  域名=' + f.hostCount + '  明文=' + token.humanBytes(f.plainResponseBytes));
    L.push('  域名: ' + f.topHosts.map((h) => h.host + '×' + h.count).join(', '));
    if (f.firstApi) L.push('  首接口: ' + f.firstApi.method + ' ' + (f.firstApi.urlTemplate || f.firstApi.url) + ' (sid=' + f.firstApi.sid + ')');
    if (f.lastApi) L.push('  末接口: ' + f.lastApi.method + ' ' + (f.lastApi.urlTemplate || f.lastApi.url) + ' (sid=' + f.lastApi.sid + ')');
    L.push('  sids: ' + f.sids.slice(0, 80).join(',') + (f.sids.length > 80 ? ' …+' + (f.sids.length - 80) : ''));
  }
  if (ctx.unassigned.length) {
    L.push('');
    L.push('## 未聚类（缺 _m.xml 时间戳）' + ctx.unassigned.length + ' 条');
    L.push('sids: ' + ctx.unassigned.slice(0, 200).map((s) => s.sid).join(','));
  }
  L.push('');
  L.push('## 参数传递链（' + ctx.chains.length + ' 个跨会话复用值，按复用会话数降序）');
  if (!ctx.chains.length) L.push('（无满足追踪阈值的共享值）');
  for (const c of ctx.chains.slice(0, 120)) {
    L.push('值=' + presentValue(c.display, ctx.valuesInSummary) + '  长度=' + c.valueLength +
      '  字段=' + c.names.join(',') + '  位置=' + c.scopes.join(',') + '  复用会话=' + c.reuseSessionCount +
      (c.flows.length ? '  跨流程[' + c.flows.join(',') + ']' : ''));
    if (c.producer) {
      L.push('  ← 生产者 sid=' + c.producer.sid + ' ' + c.producer.host + ' ' + (c.producer.urlTemplate || '') +
        '  来源=' + c.producer.match +
        (c.producers && c.producers.length > 1 ? '（共 ' + c.producers.length + ' 个候选来源）' : '') +
        (c.spread ? '  → 首个使用者 sid=' + c.users[0].sid + '（跨 ' + (c.users[0].seq - c.producer.seq) + ' 个会话）' : ''));
    } else {
      L.push('  ← 未在使用点之前扫到生产者（可能来自抓包范围之外，或扫描预算已耗尽，见 manifest.trimLog）');
    }
    L.push('  使用者: ' + c.users.slice(0, 16).map((u) => u.sid + '(' + u.name + ')').join(' ') + (c.usersTruncated ? ' …' : ''));
  }
  const noProducer = ctx.chains.filter((c) => !c.producer).length;
  const kinds = (ctx.ledgerStats && ctx.ledgerStats.producerKinds) || {};
  L.push('');
  L.push('统计：有明确生产者 ' + (ctx.chains.length - noProducer) + ' / 无 ' + noProducer +
    '；响应回溯扫描 ' + ctx.ledgerStats.responsesScanned + ' 条（上限 ' + ctx.ledgerStats.maxResponseScans + '）' +
    (ctx.ledgerStats.scanCapReached ? ' ⚠已达上限' : ''));
  L.push('生产者通路分布：' + (Object.keys(kinds).length
    ? Object.entries(kinds).map(([k, v]) => k + '=' + v).join('  ')
    : '（无）') + '　响应头零IO倒排命中值=' + ((ctx.ledgerStats && ctx.ledgerStats.headerIndexValues) || 0));
  return L.join('\n');
}

/** 字节块 → 可读文本（二进制只给 hex 摘要，绝不写乱码）。 */
function bodyBlock(buf, opts) {
  const o = opts || {};
  const dec = require('../core/decode');
  const max = o.maxBytes || 0;
  let slice = buf;
  let truncated = false;
  if (max && buf.length > max) { slice = buf.subarray(0, max); truncated = true; }
  if (!dec.looksTextual(slice, 4096)) {
    const hex = slice.subarray(0, Math.min(slice.length, o.hexBytes || 512)).toString('hex').replace(/(..)/g, '$1 ');
    return ['（二进制，不适合文本分析）长度=' + token.humanBytes(buf.length),
      '前 ' + Math.min(slice.length, o.hexBytes || 512) + 'B hex: ' + hex.trim() + (truncated ? '  ⚠展示已截断' : '')];
  }
  const out = [];
  if (truncated) out.push('（正文截断于 ' + token.humanBytes(max) + '，原始 ' + token.humanBytes(buf.length) + '）');
  out.push(slice.toString('utf8'));
  return out;
}

/** 单会话正文文件（L2/L3）。 */
function renderSessionBody(sid, detail, ctx) {
  const s = detail.session;
  const L = [];
  L.push('# sid=' + s.sid + ' #' + s.seq + '  ' + (s.method || 'REQ') + ' ' + (s.url || '(无 URL)'));
  L.push('回溯方式：本文件由归档 raw/' + s.sid + '_c.txt / _s.txt 的原始字节解码而来，未改写任何字节内容。');
  L.push('');
  L.push('- 档位=' + s.category + (s.flowId ? '  流程=' + s.flowId : '') + '  分类依据=' + (s.categoryReasons || []).join('；'));
  L.push('- 响应类型=' + (s.respContentType || '未声明') + '  编码链=' + ((s.respEncodingChain || []).join('+') || '无') +
    '  明文=' + token.humanBytes(s.respEntryPlainBytes) + '  归档压缩=' + token.humanBytes(s.respEntryCompressedBytes));
  if (s.statusAbnormal) L.push('- ⚠ 异常状态行：' + s.statusAbnormal);
  if (!s.complete) L.push('- ⚠ 半截会话：' + (s.hasRequest ? '缺响应' : '缺请求') + '（抓包本身不完整）');
  if (s.timers) {
    L.push('- 时序：' + s.timers.startedAtIso + '  总耗时=' + s.timers.totalMs + 'ms  TTFB=' + s.timers.ttfbMs + 'ms  连接=' + s.timers.connectMs + 'ms');
  }
  if (s.certPolicyErrors || (s.meta && s.meta.certPolicyErrors)) L.push('- 证书策略错误：' + (s.certPolicyErrors || s.meta.certPolicyErrors));
  L.push('');

  if (detail.request) {
    L.push('## 请求头（原始行序）');
    L.push(String(detail.request.headerText || '').replace(/\r\n/g, '\n').trimEnd());
    L.push('');
    const rb = detail.request.bodyBuf;
    if (rb && rb.length) {
      L.push('## 请求体（' + token.humanBytes(rb.length) + '）');
      L.push.apply(L, bodyBlock(rb, { maxBytes: ctx.maxBodyBytesInFile }));
      L.push('');
    }
  } else {
    L.push('## 请求头');
    L.push('（归档中无 _c.txt，会话只有响应）');
    L.push('');
  }

  if (detail.response) {
    L.push('## 响应头（原始行序）');
    L.push(String(detail.response.headerText || '').replace(/\r\n/g, '\n').trimEnd());
    L.push('');
    const dr = detail.decode && detail.decode.response;
    if (dr && dr.failed) {
      L.push('## 响应体（未能解压）');
      L.push('算法=' + dr.algorithm + '  原因=' + dr.reason + '  压缩字节=' + token.humanBytes(s.respEntryCompressedBytes));
      L.push('原算法会把压缩字节直接写进 .txt（缺陷 B5）；本包不写乱码，只记录失败事实。');
    } else {
      const pb = detail.response.bodyBuf;
      const dq = dr && dr.dechunk;
      if (pb && pb.length) {
        L.push('## 响应体（解码后 ' + token.humanBytes(pb.length) + (dr && dr.truncated ? '，已截断' : '') + '）');
        if (dq && dq.applied) {
          L.push('> 传输解码：本响应带 `Transfer-Encoding: chunked`，已剥掉 ' + dq.frames +
            ' 个分块的框架字节（长度行 + 块尾 CRLF，共 ' + token.humanBytes(dq.overheadBytes) + '），trailer 不混入正文。' +
            (dq.partial ? ' ⚠ ' + dq.reason : '（下方正文即拼接后的应用数据，与线上语义一致）'));
        }
        L.push.apply(L, bodyBlock(pb, { maxBytes: ctx.maxBodyBytesInFile }));
      } else {
        L.push('## 响应体');
        L.push('（无正文）' + (dq && dq.applied ? ' 仅剥掉了 ' + dq.frames + ' 个空分块框架' : ''));
      }
    }
    // F28：流式/多帧正文的逐事件索引（原文已在上方保留，这里只补“能导航的结构”）
    const stm = detail.response.stream;
    if (stm && stm.kind === 'event-stream' && stm.events && stm.events.length) {
      L.push('');
      L.push('## 事件流拆分（text/event-stream，F28）');
      L.push('事件=' + stm.stats.events + '  带 data=' + stm.stats.withData + '  其中 data 为合法 JSON=' + stm.stats.withJsonData +
        '  注释/心跳=' + stm.stats.comments + '  事件名分布=' + JSON.stringify(stm.eventTypes) +
        (stm.truncated ? '  ⚠ 超出上限，仅返回前 ' + stm.stats.returned + ' 条' : ''));
      L.push('一行一个事件；完整 data 用 `saz_stream` 工具按 sid 取（本文件不重复粘整块正文，避免抢 token 预算）。');
      const show = ctx.maxStreamEventsInFile === undefined ? 200 : ctx.maxStreamEventsInFile;
      stm.events.slice(0, show).forEach((e) => {
        const bits = [];
        if (e.id !== null) bits.push('id=' + e.id);
        if (e.event !== null) bits.push('event=' + e.event);
        if (e.retry !== null) bits.push('retry=' + e.retry);
        if (e.data !== null) {
          if (e.dataJson !== undefined) {
            const tk = stream.topKeysOf(e.dataJson, 10);
            bits.push('data{' + (tk.isArray ? '数组长' + tk.length + ' 首元素键:' : '键:') + tk.keys.join(',') + '}');
          } else bits.push('data"' + String(e.data).replace(/[\r\n]+/g, ' ').slice(0, 80) + '"');
        } else bits.push('(无 data，' + (e.commentLines ? '心跳' : '仅控制字段') + ')');
        L.push('- #' + e.index + ' ' + bits.join(' '));
      });
      if (stm.events.length > show) L.push('- …其余 ' + (stm.events.length - show) + ' 条未列（用 saz_stream 取）');
    } else if (stm && stm.kind === 'multi-value' && stm.values && stm.values.length) {
      L.push('');
      L.push('## 顶层多份 JSON 值拆分（F28）');
      if (stm.note) L.push('> ' + stm.note + (stm.fellBackFrom ? '（回退自 ' + stm.fellBackFrom + '）' : '') + (stm.detectedBy ? '（按内容探测命中）' : ''));
      L.push('整块不是合法 JSON，但是 ' + stm.values.length + ' 份顶层 JSON 值拼接（值间仅空白），已逐份定位：');
      const show = ctx.maxStreamEventsInFile === undefined ? 200 : ctx.maxStreamEventsInFile;
      stm.values.slice(0, show).forEach((v) => {
        const tk = v.json !== undefined ? stream.topKeysOf(v.json, 10) : null;
        L.push('- #' + v.index + ' ' + v.chars + ' 字符 ' +
          (tk ? (tk.isArray ? '数组长' + tk.length : (tk.scalar || '对象')) + ' 键:' + tk.keys.join(',') : '不是合法 JSON 值') +
          ' 偏移[' + v.start + ',' + v.end + ']');
      });
      if (stm.values.length > show) L.push('- …其余 ' + (stm.values.length - show) + ' 份未列');
    }
    L.push('');
  } else {
    L.push('## 响应头');
    L.push('（归档中无 _s.txt）');
    L.push('');
  }

  if (detail.websocket && detail.websocket.records) {
    const w = detail.websocket;
    L.push('## WebSocket 帧（原解析脚本不产出这部分）');
    L.push('帧数=' + w.stats.frames + '  发送=' + w.stats.request + '  接收=' + w.stats.response +
      '  字节=' + token.humanBytes(w.stats.bytes) + '  操作码=' + JSON.stringify(w.stats.opcodes));
    const show = ctx.maxWsFramesInFile === undefined ? 120 : ctx.maxWsFramesInFile;
    w.records.slice(0, show).forEach((r, i) => {
      const head = '#' + i + ' ' + r.dir + ' ' + r.frame.opcodeName + ' ' + r.rawLength + 'B' +
        ' @' + String(r.doneRead || '').slice(11, 23);
      let shown;
      if (r.textPreview) {
        shown = ctx.valuesInSummary === 'full'
          ? '  ' + r.textPreview.replace(/[\r\n]+/g, ' ').replace(/[\u0000-\u001f]/g, '.')
          : '  ‹' + r.textLength + '字›';
      } else {
        // 二进制帧：给去掩码后的前 64B hex，保留结构线索而不制造乱码
        const p = detail.websocket.payloadAt(i);
        shown = p && p.length ? '  hex=' + p.subarray(0, Math.min(64, p.length)).toString('hex') : '  (无载荷)';
      }
      L.push(head + shown);
    });
    if (w.records.length > show) L.push('…余 ' + (w.records.length - show) + ' 帧未列出（见 manifest.trimLog）');
    L.push('');
  }

  if (detail.request && detail.request.fields && detail.request.fields.fields && detail.request.fields.fields.length) {
    L.push('## 请求字段结构');
    for (const f of detail.request.fields.fields) {
      L.push('  ' + f.path + '  ' + (f.type || '?') + (f.samples && f.samples.length ? '  例=' + presentValue(f.samples[0], ctx.valuesInSummary) : ''));
    }
    if (detail.request.fields.partial) L.push('  （partial：体超长，字段集可能不完整）');
    L.push('');
  }
  if (detail.response && detail.response.fields && detail.response.fields.fields && detail.response.fields.fields.length) {
    L.push('## 响应字段结构');
    for (const f of detail.response.fields.fields) {
      L.push('  ' + f.path + '  ' + (f.type || '?') + (f.samples && f.samples.length ? '  例=' + presentValue(f.samples[0], ctx.valuesInSummary) : ''));
    }
    if (detail.response.fields.partial) L.push('  （partial：正文被截断）');
    L.push('');
  }
  return L.join('\n');
}

module.exports = {
  presentValue,
  sessionLine,
  bodyBlock,
  renderOverview,
  renderEndpoints,
  renderFieldTree,
  renderFlows,
  renderSessionBody,
};
