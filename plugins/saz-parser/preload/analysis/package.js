'use strict';

/**
 * package.js —— 分析包生成（B 层核心 · F21 / F22）
 *
 * 本插件真正的产出物。设计约束全部来自实证与用户指令，不是风格偏好：
 * - **体积可控**：单卷 token 预算（默认 100,000）。预算是**硬约束**：任何文件超过预算都按行切卷，
 *   而不是"整块塞进一卷再宣称超了"。第一轮实测就是栽在这里——以 500 条为一块的摘要
 *   单块就到 46K token，配上 20K 的预算直接爆表，所以改成逐行累计切分。
 * - **可回溯**：每条素材带 sid，manifest 记录源归档、档位、参数、引擎能力、每个文件的 token 与字节。
 * - **留痕强制**：trimLog 不可关闭，每一次裁剪都写清 步骤/动作/前后数量/原因。
 * - **隐私默认不抹**：valuesInSummary 默认 `full`；`names-only` / `masked` 只改摘要字符串，
 *   正文文件与数据层字节不受影响（脱敏副本 = 用 masked 模式再跑一次生成另一份，见 F25）。
 *
 * 目录形态：
 *   manifest.json
 *   00-README.md              阅读指引（AI 拿到先读这个）
 *   10-overview.md            L0 概览
 *   20-endpoints-vNN.md       接口清单（按 url 模板聚合，超预算自动分卷）
 *   30-flows.md               流程分组 + 跨会话参数传递链
 *   40-fields-vNN.md          字段结构全集
 *   50-sessions-vNN.md        L1 会话摘要（分卷）
 *   60-bodies/vNN/sid<N>.md   L2/L3 会话正文（分卷）
 *   65-websocket.md           WebSocket 连接与帧索引（F26）
 *   66-stream.md              流式/分块正文索引：SSE 会话清单 + chunked 解框留痕（F28/B11）
 *   90-anomalies.md           解码失败 / 半截会话 / 异常状态 / 降级留痕
 */

const fs = require('node:fs');
const path = require('node:path');

const token = require('./token');
const query = require('./query');
const flow = require('./flow');
const render = require('./render');

const TIER_RANK = { L0: 0, L1: 1, L2: 2, L3: 3 };

const DEFAULTS = {
  tier: 'L2',
  tokenBudgetPerVolume: 100000,
  /** 结构化文件（00/10/20/30/40/65/90）合计可用卷数 */
  maxStructuredVolumes: 10,
  /** L1 摘要卷数上限 */
  maxSummaryVolumes: 6,
  /** L2/L3 正文卷数上限 */
  maxBodyVolumes: 10,
  valuesInSummary: 'full',
  /** 正文纳入的档位；noise 需显式开启 */
  bodyCategories: ['api', 'logic'],
  /** 单会话正文文件里的正文上限（字节） */
  maxBodyBytesInFile: 256 * 1024,
  /**
   * 单会话正文文件里最多列多少条事件 / 多少份顶层值（F28）。
   * 超出仍然会完整计数（stats 是全量统计出来的），只是不逐条展开，避免事件多的会话抢 token 预算。
   */
  maxStreamEventsInFile: 200,
  /** 单会话正文文件里最多列多少条 WebSocket 帧（F26，同上理由） */
  maxWsFramesInFile: 120,
  /** 拆帧上限：单会话最多解出多少个事件（core/stream，超出标 truncated 但继续统计） */
  streamMaxEvents: 5000,
  /** 拆帧上限：单会话最多解出多少份顶层值 */
  streamMaxValues: 2000,
  /** 单事件 data 字符上限，超出截断并标 dataTruncated */
  streamMaxDataChars: 200000,
  /** 正文会话总数硬上限（0 = 不限，靠卷数与预算收敛） */
  maxBodySessions: 0,
  selection: null,
  withLedger: true,
  ledger: {},
  flowGapMs: 15000,
  flowMinSessions: 2,
  maxFieldsPerEndpoint: 80,
  includeNoiseEndpoints: false,
  withBodies: true,
};

/** 结构化文件的读取顺序，AI 可按编号推断先后。 */
const STRUCTURED_ORDER = ['00-README.md', '10-overview.md', '20-endpoints', '30-flows.md', '40-fields', '65-websocket.md', '66-stream.md', '90-anomalies.md'];

/**
 * 按行把长文本切成不超过预算的块。
 * 返回的是**正文行分组**（不含抬头），由调用方或本函数末尾统一拼抬头：
 * 第 1 卷用原始抬头，后续卷重复抬头并标“接第 k/N 卷”，
 * 保证任何一卷被单独丢进上下文都能自解释。
 * @param {string} text
 * @param {number} budget 单卷 token 上限
 * @param {{headerLines?:number}} [opts]
 * @returns {Array<string>}
 */
function chunkTextByBudget(text, budget, opts) {
  const o = opts || {};
  const headerLineCount = o.headerLines === undefined ? 2 : o.headerLines;
  const all = String(text || '').split('\n');
  if (!all.length || token.estimateTokens(text) <= budget) return [text];

  const head = all.slice(0, headerLineCount).join('\n');
  const headTokens = token.estimateTokens(head);
  const body = all.slice(headerLineCount);

  const parts = [];
  let cur = [];
  let curTokens = 0;
  for (let line of body) {
    let t = token.estimateTokens(line);
    // 单行就超预算（实测存在：一行几 MB 的 JSON 响应体）：按字符硬切并在切点写明
    while (t > budget - headTokens) {
      const keep = Math.max(1, Math.floor((budget - headTokens) * 4 * 0.9));
      if (cur.length) { parts.push(cur); cur = []; curTokens = 0; }
      parts.push([line.slice(0, keep) + '\n（↑ 单行超长，已在 ' + token.humanBytes(keep) + ' 处硬切，本行原始 ' + token.humanBytes(line.length) + '）']);
      line = '（续上）' + line.slice(keep);
      t = token.estimateTokens(line);
    }
    if (cur.length && curTokens + t > budget - headTokens) {
      parts.push(cur); cur = []; curTokens = 0;
    }
    cur.push(line);
    curTokens += t;
  }
  if (cur.length) parts.push(cur);
  if (!parts.length) return [text];

  return parts.map((lines, i) =>
    head + (i === 0 ? '\n' : '\n（接第 ' + (i + 1) + '/' + parts.length + ' 卷）\n') + lines.join('\n'));
}

/** 给分卷文件命名：单卷保留基名，多卷加 -vNN。 */
function volumeLabel(base, ext, index, total) {
  if (total <= 1) return base + ext;
  return base + '-v' + String(index + 1).padStart(2, '0') + ext;
}

/** 把一段文本按预算切成 blocks 并登记降级；返回 {blocks, droppedTokens, droppedLines}。 */
function toVolumeBlocks(base, ext, text, ctx, sidsOf) {
  const chunks = chunkTextByBudget(text, ctx.tokenBudgetPerVolume);
  const allow = ctx.allowance[base];
  const kept = chunks.slice(0, allow);
  const dropped = chunks.slice(allow);
  if (dropped.length) {
    ctx.trimLog.push({
      step: '结构化分卷', action: '超出该文件卷数配额后丢弃后续卷',
      detail: base + ext + ' 共 ' + chunks.length + ' 卷，保留 ' + kept.length + ' 卷，丢弃 ' + dropped.length +
        ' 卷（约 ' + dropped.reduce((a, c) => a + token.estimateTokens(c), 0) + ' token）；' +
        '被丢弃部分仍可用 query/sid 在完整包里取',
      reason: '配额 ' + allow + ' 卷（maxStructuredVolumes 按文件类型分配）',
    });
  }
  ctx.allowance[base] = kept.length;
  return kept.map((c, i) => ({
    label: volumeLabel(base, ext, i, chunks.length),
    text: c,
    sids: sidsOf ? sidsOf(i) : [],
    part: chunks.length > 1 ? { index: i + 1, total: chunks.length } : null,
  }));
}

/** 标记每个 url 模板的首次出现会话（正文优先级用）。 */
function markFirstSeen(sessions) {
  const seen = new Set();
  for (const s of sessions) {
    const k = (s.method || '') + ' ' + (s.urlTemplate || s.url || '');
    s.firstSeenEndpoint = !seen.has(k);
    seen.add(k);
  }
}

/**
 * 正文会话纳入优先级：越靠前越该保住。
 * 依据"分析抓包流程"的需要排序，而不是体积。
 */
function priorityOf(s, ctx) {
  let score = 0;
  if (s.category === 'api') score += 100;
  if (s.category === 'logic') score += 60;
  if (Number(s.status) >= 400 || s.statusAbnormal) score += 30;
  if ((s.privacyTags || []).some((t) => t.kind === 'auth' || t.kind === 'token')) score += 25;
  if (s.hasWs && s.wsFrames > 0) score += 40;
  if (s.firstSeenEndpoint) score += 20;
  if (s.reqFields && s.reqFields.length) score += 8;
  if (s.isUpgrade) score += 10;
  if (ctx.selectedSids && ctx.selectedSids.has(s.sid)) score += 500;
  return -score;
}

/** 会话摘要块（逐行累计到预算即切卷）。 */
function buildSummaryBlocks(sessions, ctx) {
  const ordered = sessions.slice().sort((a, b) => a.seq - b.seq);
  const lines = ordered.map((s) => render.sessionLine(s, ctx));
  const headerOf = (i, total) => [
    '# 会话摘要 第 ' + (i + 1) + '/' + total + ' 卷（按会话顺序，一行一条）',
    '字段以两个空格分隔；sid= 为 Fiddler SessionID，可直接用于取原文与回溯归档。隐私值呈现=' + ctx.valuesInSummary + '。',
  ];
  const groups = [];
  let cur = [];
  let curTokens = 0;
  const baseTokens = () => token.estimateTokens(headerOf(0, 1).join('\n'));
  for (const ln of lines) {
    const t = token.estimateTokens(ln);
    if (cur.length && curTokens + t + baseTokens() > ctx.tokenBudgetPerVolume) {
      groups.push(cur); cur = []; curTokens = 0;
    }
    cur.push(ln); curTokens += t;
  }
  if (cur.length) groups.push(cur);

  const allow = ctx.maxSummaryVolumes;
  const keptGroups = groups.slice(0, allow);
  if (groups.length > keptGroups.length) {
    const lost = groups.slice(keptGroups.length);
    ctx.trimLog.push({
      step: '摘要分卷', action: '超出 maxSummaryVolumes 后停止写入',
      detail: '摘要需 ' + groups.length + ' 卷，仅写 ' + keptGroups.length + ' 卷，丢弃 ' +
        lost.reduce((a, g) => a + g.length, 0) + ' 条会话摘要',
      reason: 'maxSummaryVolumes=' + allow,
    });
  }
  return keptGroups.map((g, i) => ({
    label: volumeLabel('50-sessions', '.md', i, keptGroups.length),
    text: headerOf(i + 1, keptGroups.length).concat(g).join('\n'),
    sids: g.map((line) => Number(/sid=(\d+)/.exec(line)[1])),
    sessionCount: g.length,
  }));
}

/** 字段结构全集（按接口聚合索引期字段）。 */
function buildFieldGroups(archive, ctx) {
  const map = new Map();
  for (const s of archive.sessions) {
    if (!s.reqFields || !s.reqFields.length) continue;
    const key = (s.method || 'REQ') + ' ' + (s.urlTemplate || s.url || '(无 URL)');
    if (!map.has(key)) map.set(key, { key, fields: new Map() });
    const g = map.get(key);
    for (const f of s.reqFields) {
      const pk = (f.from === 'query' ? 'query.' : 'body.') + f.path;
      let rec = g.fields.get(pk);
      if (!rec) { rec = { path: pk, type: f.type, count: 0, samples: [], partial: false, from: f.from, side: 'request' }; g.fields.set(pk, rec); }
      rec.count++;
      if (f.partial) rec.partial = true;
      if (f.sample && rec.samples.length < 3 && !rec.samples.includes(f.sample)) rec.samples.push(f.sample);
    }
  }
  return [...map.values()]
    .map((g) => ({ key: g.key, fields: [...g.fields.values()].sort((a, b) => b.count - a.count).slice(0, ctx.maxFieldsPerEndpoint) }))
    .sort((a, b) => b.fields.length - a.fields.length);
}

/** WebSocket 连接索引（F26 的包内入口）。 */
function buildWsIndexText(archive) {
  const wsSessions = archive.sessions.filter((s) => s.hasWs);
  const L = [];
  L.push('# WebSocket 连接与帧索引');
  L.push('这些会话的业务数据**只存在于帧日志里**：原解析脚本只读 _c/_s/_m，这部分被完全丢弃（缺陷 B10）。');
  const wsm = archive.summary.websocket || { sessions: 0, frames: 0, frameBytes: 0 };
  L.push('连接=' + wsm.sessions + '  帧=' + wsm.frames + '  明文=' + token.humanBytes(wsm.frameBytes));
  L.push('');
  for (const s of wsSessions) {
    L.push('sid=' + s.sid + '  ' + s.method + ' ' + (s.url || '') + '  ' + s.status +
      '  帧=' + s.wsFrames + '  字节=' + token.humanBytes(s.wsFrameBytes) +
      '  子协议=' + (s.wsSubprotocol || '未声明') + (s.flowId ? '  流程=' + s.flowId : ''));
  }
  if (!wsSessions.length) L.push('（本归档没有 _w.txt，即无 WebSocket 会话）');
  return L.join('\n');
}

/** 流式 / 分块正文索引（F28 + B11 的包内入口）。 */
function buildStreamIndexText(archive) {
  const dec = require('../core/decode');
  const streamCore = require('../core/stream');
  const sse = archive.sessions.filter((x) => streamCore.isEventStream(x.respContentType));
  const chunked = archive.sessions.filter((x) => dec.isChunked(x.respTransferEncoding));
  const L = [];
  L.push('# 流式与分块正文索引');
  L.push('两类会话“解析完整”但曾经“结构不可用”（实测依据：本机 50 个样本，见设计文档 1.12）：');
  L.push('- `text/event-stream`：正文是逐事件的数据流，整块当 JSON 解必失败 → 本包已逐事件拆开；');
  L.push('- `Transfer-Encoding: chunked`：归档存的是线上原始字节，本包已先剥掉分块框架再解压（修 B11）。');
  L.push('');
  L.push('## SSE 事件流会话 ' + sse.length + ' 条');
  L.push('本表只列导航信息（索引期只看头部，不读正文）；事件数与逐事件结构在 `60-bodies/*/sidN.md` 的「事件流拆分」段，或用 `saz_stream` 工具取。');
  for (const x of sse) {
    L.push('sid=' + x.sid + '  ' + x.method + ' ' + (x.url || '') + '  ' + x.status +
      '  明文=' + token.humanBytes(x.respEntryPlainBytes) + (x.flowId ? '  流程=' + x.flowId : '') +
      (x.complete ? '' : '  ⚠ 半截会话'));
  }
  if (!sse.length) L.push('（本归档没有 event-stream 响应）');
  L.push('');
  L.push('## 带 chunked 分块框架的会话 ' + chunked.length + ' 条（已解框）');
  for (const x of chunked) {
    L.push('sid=' + x.sid + '  ' + x.method + ' ' + (x.url || '') + '  ' + x.status +
      '  CT=' + (x.respContentType || '未声明') + '  TE=' + x.respTransferEncoding +
      '  明文=' + token.humanBytes(x.respEntryPlainBytes));
  }
  if (!chunked.length) L.push('（本归档没有 chunked 响应）');
  L.push('');
  L.push('> 上面两个清单都是**按响应头判定**的；正文里是否真残留框架字节，已在写盘时逐块核对（verify.js 7.5 不变量）。');
  return L.join('\n');
}

/** README（给 AI 的阅读指引）。 */
function buildReadme(archive, ctx) {
  const L = [];
  L.push('# SAZ 抓包分析包 · ' + archive.name);
  L.push('');
  L.push('生成时间：' + ctx.generatedAtIso + '   耗时：' + ctx.elapsedMs + 'ms');
  L.push('源归档：' + archive.path + '（' + token.humanBytes(archive.fileSize) + '，' + archive.entryCount + ' 条目）');
  L.push('解析引擎：saz-parser v' + ctx.engineVersion + '   Node ' + archive.capabilities.node +
    '   Electron ' + (archive.capabilities.electron || '非 Electron 环境'));
  L.push('解压能力：' + JSON.stringify({ gzip: archive.capabilities.gzip, brotli: archive.capabilities.brotli, zstd: archive.capabilities.zstd }));
  L.push('');
  L.push('## 怎么读这份素材（按顺序）');
  L.push('1. `10-overview.md` —— 规模、三档分布、编码分布、域名与隐私字段计数，先建立总体认知。');
  L.push('2. `20-endpoints*.md` —— 接口清单（URL 模板已折叠动态段），带调用次数、错误率、耗时与参数名。');
  L.push('3. `30-flows.md` —— 流程分段 + 跨会话参数传递链 + 凭证看板。**分析业务流程应当从这里开始引用具体 sid。**');
  L.push('4. `40-fields*.md` —— 每个接口的参数全集与出现次数。');
  L.push('5. `50-sessions-vNN.md` —— 逐条会话摘要（一行一条）。');
  L.push('6. `60-bodies/vNN/sid<N>.md` —— 单会话完整头部与解码后正文；`65-websocket.md` 指向长连接帧，`66-stream.md` 指向事件流/分块正文。');
  L.push('7. `90-anomalies.md` 与 `manifest.json` 的 `trimLog` —— **哪些数据不可用、哪些被降级过**；任何范围性结论都必须核对这里。');
  L.push('');
  L.push('## 本包的硬性事实');
  L.push('- 隐私字段值呈现模式：**' + ctx.valuesInSummary + '**' +
    (ctx.valuesInSummary === 'full' ? '（完整保留；需要脱敏请用 masked 模式另生成一份副本，原包不动）' : '（仅摘要层折叠；正文文件仍是原值）'));
  L.push('- token 数是**估算值**，口径：' + JSON.stringify(token.DEFAULTS) + '，不是精确 BPE 计数。');
  L.push('- 正文一律从归档原始字节解码，未改写内容；解压失败的条目在 `90-anomalies.md` 明示，不会写成乱码充数。');
  L.push('- 本包由本地算法脚本生成，**未调用任何模型**，不含任何外部网络请求结果。');
  L.push('- 单卷 token 预算 ' + ctx.tokenBudgetPerVolume + '，超出即按固定顺序降级并留痕，不静默丢数据。');
  L.push('');
  L.push('档位=' + ctx.tier + '   摘要纳入会话=' + ctx.selected.length + '/' + archive.summary.sessionCount +
    '   正文入包=' + ctx.bodyIncluded + '/' + ctx.bodyCandidates);
  return L.join('\n');
}

/** 异常清单（必须在正文阶段之后生成，因为要引用 ctx.decodeFailures）。 */
function buildAnomalies(archive, ctx) {
  const L = [];
  const sm = archive.summary;
  L.push('# 异常、缺失与截断清单');
  L.push('本文件存在的意义：让"数据不可用"成为显式事实，而不是让下游猜。');
  L.push('');
  const capFailed = sm.responseEncodingFailed || [];
  L.push('## 运行时无法解压的响应（能力级）' + capFailed.length + ' 条');
  for (const f of capFailed.slice(0, 100)) L.push('  sid=' + f.sid + '  算法=' + f.algorithm + '  原因=' + f.reason);
  L.push('');
  const bodyFailed = ctx.decodeFailures || [];
  L.push('## 取正文时实际解压失败 ' + bodyFailed.length + ' 条');
  for (const f of bodyFailed.slice(0, 100)) L.push('  sid=' + f.sid + '  算法=' + f.algorithm + '  原因=' + f.reason + '  ' + f.url);
  L.push('');
  const dqFailed = ctx.dechunkFailures || [];
  L.push('## 带 `Transfer-Encoding: chunked` 但框架解不开的响应 ' + dqFailed.length + ' 条');
  L.push('  → 这些会话的正文**仍混着十六进制长度行**（为不弄坏数据而整块退还，见 decode.js `dechunk()`），引用其结构前先看这一节。');
  for (const f of dqFailed.slice(0, 100)) L.push('  sid=' + f.sid + '  原因=' + f.reason + '  ' + f.url);
  const dqPartial = ctx.dechunkPartial || [];
  if (dqPartial.length) {
    L.push('');
    L.push('## chunked 只解出部分分块（抓包截断）' + dqPartial.length + ' 条');
    for (const f of dqPartial.slice(0, 100)) L.push('  sid=' + f.sid + '  已完成块=' + f.frames + '  原因=' + f.reason);
  }
  L.push('');
  const incomplete = archive.sessions.filter((s) => !s.complete);
  L.push('## 半截会话 ' + incomplete.length + ' 条（抓包本身缺一侧）');
  for (const s of incomplete.slice(0, 100)) L.push('  sid=' + s.sid + ' ' + (s.hasRequest ? '有请求/缺响应' : '缺请求/有响应') +
    (s.statusAbnormal ? '  ' + s.statusAbnormal : '') + '  ' + (s.url || ''));
  L.push('');
  const abnormal = archive.sessions.filter((s) => s.statusAbnormal);
  L.push('## 异常状态行 ' + abnormal.length + ' 条（Fiddler 占位/非标准码，代表抓包缺数据）');
  for (const s of abnormal.slice(0, 100)) L.push('  sid=' + s.sid + ' → ' + s.statusAbnormal + '  ' + (s.url || ''));
  L.push('');
  const trunc = archive.sessions.filter((s) => s.headerOnly);
  L.push('## 索引期只读到头部的响应 ' + trunc.length + ' 条');
  L.push('  说明：索引为保秒级只读每条前 256KB；正文在生成本包时已按需完整重读，此处仅记录原始头部情况。');
  for (const s of trunc.slice(0, 50)) L.push('  sid=' + s.sid + ' 明文=' + token.humanBytes(s.respEntryPlainBytes));
  L.push('');
  if (sm.warnings) L.push('## 索引告警 ' + sm.warnings + ' 条（详见 manifest.warnings）');
  if (sm.pairing.skipped) L.push('## 未识别归档条目 ' + sm.pairing.skipped + ' 条（详见 manifest.warnings）');
  L.push('');
  L.push('## 本次生成的降级留痕（共 ' + ctx.trimLog.length + ' 条）');
  for (const t of ctx.trimLog) L.push('  [' + t.step + '] ' + t.action + '：' + t.detail + '（原因 ' + t.reason + '）');
  if (!ctx.trimLog.length) L.push('  （无降级：本次未裁剪任何素材）');
  return L.join('\n');
}

/** 按 token 预算把 blocks 装进最多 maxVolumes 卷；溢出交给 degrade 回调留痕。 */
function packVolumes(blocks, budgetPerVolume, maxVolumes, degrade) {
  const volumes = [];
  let cur = null;
  const overflow = [];
  for (const b of blocks) {
    const t = token.estimateTokens(b.text);
    if (t > budgetPerVolume) {
      // 上游已按预算切过；真到这里说明有实现漏洞，必须显式记录而不是悄悄超卷
      degrade && degrade([Object.assign({}, b, { tokens: t })], volumes.length, maxVolumes);
      continue;
    }
    if (!cur || cur.tokens + t > budgetPerVolume) {
      if (volumes.length >= maxVolumes) {
        overflow.push(Object.assign({}, b, { tokens: t }));
        continue;
      }
      if (cur) volumes.push(cur);
      cur = { index: volumes.length + 1, blocks: [], tokens: 0 };
    }
    cur.blocks.push(Object.assign({}, b, { tokens: t }));
    cur.tokens += t;
  }
  if (cur && cur.blocks.length) volumes.push(cur);
  if (overflow.length && degrade) degrade(overflow, volumes.length, maxVolumes);
  return { volumes, overflow };
}

/**
 * 构建分析包（不落盘，返回结构化产物，便于 UI 预览与断言）。
 * @param {object} archive indexer.openArchive 的结果
 * @param {object} [options] 覆盖 DEFAULTS
 * @param {(p:object)=>void} [onProgress]
 */
function buildAnalysisPackage(archive, options, onProgress) {
  const ctx = Object.assign({}, DEFAULTS, options || {});
  const t0 = Date.now();
  ctx.tierRank = TIER_RANK[ctx.tier] !== undefined ? TIER_RANK[ctx.tier] : 2;
  ctx.trimLog = [];
  ctx.generatedAtIso = new Date().toISOString();
  ctx.engineVersion = '0.1.0';
  ctx.decodeFailures = [];
  ctx.dechunkFailures = [];
  ctx.dechunkPartial = [];
  // 每种结构化文件默认可用的卷数；总额由 maxStructuredVolumes 分摊
  ctx.allowance = {
    '00-README': 1, '10-overview': 2, '20-endpoints': 4, '30-flows': 3,
    '40-fields': 4, '65-websocket': 2, '66-stream': 2, '90-anomalies': 2,
  };

  const say = (phase, extra) => { if (onProgress) onProgress(Object.assign({ phase }, extra || {})); };

  /* --- 1. 选取集合（F24）--- */
  markFirstSeen(archive.sessions);
  let selected = archive.sessions;
  if (ctx.selection && (ctx.selection.filter || ctx.selection.sids)) {
    if (Array.isArray(ctx.selection.sids)) {
      const set = new Set(ctx.selection.sids.map(Number));
      selected = archive.sessions.filter((s) => set.has(s.sid));
      ctx.selectedSids = set;
      ctx.trimLog.push({ step: '选取', action: '按显式 sid 集合', detail: '命中 ' + selected.length + '/' + archive.sessions.length + '（请求 ' + set.size + ' 个）', reason: 'selection.sids' });
    } else {
      const r = query.querySessions(archive.sessions, ctx.selection.filter, {});
      selected = r.items;
      ctx.trimLog.push({ step: '选取', action: '按条件过滤', detail: '命中 ' + r.matched + '/' + r.total + '  生效条件=' + r.activeFilters.join(','), reason: 'selection.filter' });
    }
  }
  ctx.selected = selected;
  say('selected', { count: selected.length });

  /* --- 2. 流程分组 + 值账本 + 凭证看板（F23）--- */
  const grouped = flow.groupFlows(archive.sessions, { gapMs: ctx.flowGapMs, minSessions: ctx.flowMinSessions });
  ctx.flows = grouped.flows;
  ctx.unassigned = grouped.unassigned;
  ctx.gapMs = grouped.params.gapMs;
  ctx.minSessions = grouped.params.minSessions;

  let ledger = { chains: [], stats: { responsesScanned: 0 }, budgetNotes: [] };
  if (ctx.withLedger && ctx.tierRank >= 1) {
    say('ledger');
    ledger = flow.buildValueLedger(archive, ctx.ledger);
    for (const n of ledger.budgetNotes) ctx.trimLog.push(n);
  }
  ctx.chains = ledger.chains;
  ctx.ledgerStats = ledger.stats;
  ctx.credentials = flow.buildCredentialBoard(archive);

  /* --- 3. 结构化文件（逐文件按预算切卷）--- */
  say('structured');
  const ep = render.renderEndpoints(archive, ctx);
  const fieldGroups = buildFieldGroups(archive, ctx);
  const structuredTexts = {
    '00-README': buildReadme(archive, ctx),
    '10-overview': render.renderOverview(archive, ctx),
    '20-endpoints': ep.text,
    '30-flows': render.renderFlows(ctx),
    '40-fields': render.renderFieldTree(fieldGroups, ctx),
    '65-websocket': buildWsIndexText(archive),
    '66-stream': buildStreamIndexText(archive),
  };
  const structuredBlocks = [];
  for (const base of Object.keys(structuredTexts)) {
    if (base === '65-websocket' && !(archive.summary.websocket && archive.summary.websocket.sessions)) continue;
    if (base === '66-stream') {
      const tc = archive.summary.transferChunked || { responses: 0, requests: 0 };
      const hasSse = archive.sessions.some((x) => String(x.respContentType || '').toLowerCase().includes('event-stream'));
      if (!hasSse && !tc.responses && !tc.requests) continue;   // 两类都没有就不占预算
    }
    for (const b of toVolumeBlocks(base, '.md', structuredTexts[base], ctx, null)) {
      b.role = 'structured';
      structuredBlocks.push(b);
    }
  }

  /* --- 4. L1 摘要卷 --- */
  ctx.summaryVolumes = [];
  ctx.summaryOverflow = [];
  if (ctx.tierRank >= 1) {
    say('sessions-summary', { count: selected.length });
    const summaryBlocks = buildSummaryBlocks(selected, ctx).map((b) => Object.assign(b, { role: 'session-lines' }));
    const packed = packVolumes(summaryBlocks, ctx.tokenBudgetPerVolume, ctx.maxSummaryVolumes, (overflow) => {
      ctx.summaryOverflow = overflow;
    });
    // 每个摘要 block 已经是一卷，这里保持 1:1
    ctx.summaryVolumes = packed.volumes;
  }

  /* --- 5. L2/L3 正文卷 --- */
  ctx.bodyVolumes = [];
  ctx.bodyCandidates = 0;
  ctx.bodyIncluded = 0;
  ctx.bodyExcluded = [];
  if (ctx.withBodies && ctx.tierRank >= 2) {
    let cands = selected.filter((s) => ctx.bodyCategories.includes(s.category) || (s.hasWs && s.wsFrames > 0));
    cands = cands.slice().sort((a, b) => priorityOf(a, ctx) - priorityOf(b, ctx));
    if (ctx.maxBodySessions > 0 && cands.length > ctx.maxBodySessions) {
      ctx.trimLog.push({ step: '正文选取', action: '限制正文会话数', detail: cands.length + ' → ' + ctx.maxBodySessions + '（按优先级保留）', reason: 'maxBodySessions' });
      cands = cands.slice(0, ctx.maxBodySessions);
    }
    ctx.bodyCandidates = cands.length;

    const bodyBlocks = [];
    let done = 0;
    for (const s of cands) {
      done++;
      if (done % 50 === 0 || done === cands.length) say('bodies', { done, total: cands.length, sid: s.sid });
      let detail;
      try {
        detail = archive.detail(s, {
          withFields: true,
          withStream: true,
          maxBodyBytes: ctx.maxBodyBytesInFile,
          streamOptions: {
            maxEvents: ctx.streamMaxEvents,
            maxValues: ctx.streamMaxValues,
            maxDataChars: ctx.streamMaxDataChars,
          },
        });
      } catch (e) {
        ctx.trimLog.push({ step: '正文读取', action: '跳过该会话', detail: 'sid=' + s.sid + ' 读取失败：' + e.message, reason: 'read-error' });
        continue;
      }
      detail.session = s;
      const dresp = detail.decode && detail.decode.response;
      if (dresp && dresp.failed) ctx.decodeFailures.push({ sid: s.sid, algorithm: dresp.algorithm, reason: dresp.reason, url: s.urlTemplate || s.url });
      // 带 chunked 头但**框架不合法解不了**的会话：正文仍含长度行，这必须上异常清单，不能静默当“已解框”
      const dq = dresp && dresp.dechunk;
      if (dq && dq.applied === false) ctx.dechunkFailures.push({ sid: s.sid, reason: dq.error || dq.reason || '未知', url: s.urlTemplate || s.url, TE: detail.response && detail.response.transferEncoding });
      else if (dq && dq.partial) ctx.dechunkPartial.push({ sid: s.sid, reason: dq.reason, frames: dq.frames });

      let text = render.renderSessionBody(s.sid, detail, ctx);
      let oversize = false;
      if (token.estimateTokens(text) > ctx.tokenBudgetPerVolume) {
        const keep = Math.max(4096, Math.floor(ctx.tokenBudgetPerVolume * 4 * 0.6));
        text = text.slice(0, keep) + '\n\n（本文件在 ' + token.humanBytes(keep) + ' 处截断以适配单卷预算；原始明文 ' +
          token.humanBytes((s.respEntryPlainBytes || 0) + (s.reqBodyBytes || 0)) + '，完整内容请用 saz_body 工具按 sid=' + s.sid + ' 取）';
        oversize = true;
        ctx.trimLog.push({ step: '正文截断', action: '单文件超预算即截断', detail: 'sid=' + s.sid + ' 截断保留 ' + token.humanBytes(keep), reason: 'tokenBudgetPerVolume' });
      }
      bodyBlocks.push({ label: 'sid' + s.sid + '.md', text, sids: [s.sid], role: 'body', oversizeTruncated: oversize });
    }
    const packed = packVolumes(bodyBlocks, ctx.tokenBudgetPerVolume, ctx.maxBodyVolumes, (overflow) => {
      ctx.bodyExcluded = ctx.bodyExcluded.concat(overflow);
    });
    ctx.bodyVolumes = packed.volumes;
    if (ctx.bodyExcluded.length) {
      ctx.trimLog.push({ step: '正文分卷', action: '超出 maxBodyVolumes 后按优先级丢弃', detail: '丢弃 ' + ctx.bodyExcluded.length +
        ' 个会话正文（约 ' + ctx.bodyExcluded.reduce((a, b) => a + b.tokens, 0) + ' token）；sid 已记入 manifest.excludedBodySids',
        reason: 'maxBodyVolumes=' + ctx.maxBodyVolumes });
    }
    ctx.bodyIncluded = ctx.bodyVolumes.reduce((a, v) => a + v.blocks.length, 0);
  }

  /* --- 6. 异常清单（含最终 trimLog）--- */
  const anomText = buildAnomalies(archive, ctx);
  for (const b of toVolumeBlocks('90-anomalies', '.md', anomText, ctx, null)) {
    b.role = 'structured';
    structuredBlocks.push(b);
  }
  ctx.structuredVolumes = [{ index: 1, blocks: structuredBlocks, tokens: structuredBlocks.reduce((a, b) => a + token.estimateTokens(b.text), 0) }];

  /* --- 7. manifest --- */
  const files = [];
  let totalTokens = 0;
  const pushFile = (p, role, text, sessionCount, extra) => {
    const t = token.estimateTokens(text);
    files.push(Object.assign({ path: p, role, tokens: t, chars: text.length, sessions: sessionCount }, extra || {}));
    totalTokens += t;
  };
  for (const b of structuredBlocks) pushFile(b.label, b.role, b.text, b.sids.length, b.part ? { part: b.part } : undefined);
  for (const v of ctx.summaryVolumes) for (const b of v.blocks) pushFile(b.label, 'session-lines', b.text, b.sessionCount || b.sids.length);
  for (const v of ctx.bodyVolumes) for (const b of v.blocks) pushFile('60-bodies/v' + String(v.index).padStart(2, '0') + '/' + b.label, 'body', b.text, b.sids.length, b.oversizeTruncated ? { oversizeTruncated: true } : undefined);

  const manifest = {
    schemaVersion: 'saz-analysis-package/1',
    generatedAt: ctx.generatedAtIso,
    elapsedMs: Date.now() - t0,
    source: { name: archive.name, path: archive.path, sizeBytes: archive.fileSize, entries: archive.entryCount },
    engine: {
      version: ctx.engineVersion,
      capabilities: archive.capabilities,
      tokenEstimate: {
        method: 'heuristic',
        note: '非精确 BPE：中文×' + token.DEFAULTS.cjkTokens + ' + 其余字符/4 + 行数×' + token.DEFAULTS.lineTokens + '，刻意偏高以避免撑爆上下文',
        params: token.DEFAULTS,
      },
    },
    profile: {
      tier: ctx.tier,
      tokenBudgetPerVolume: ctx.tokenBudgetPerVolume,
      maxStructuredVolumes: ctx.maxStructuredVolumes,
      maxSummaryVolumes: ctx.maxSummaryVolumes,
      maxBodyVolumes: ctx.maxBodyVolumes,
      valuesInSummary: ctx.valuesInSummary,
      bodyCategories: ctx.bodyCategories,
      maxBodyBytesInFile: ctx.maxBodyBytesInFile,
      maxBodySessions: ctx.maxBodySessions,
      selection: ctx.selection || null,
      flow: { gapMs: ctx.gapMs, minSessions: ctx.minSessions },
      ledger: Object.assign({}, DEFAULTS.ledger, ctx.ledger || {}),
      withBodies: ctx.withBodies,
      withLedger: ctx.withLedger,
    },
    counts: {
      sessionsTotal: archive.summary.sessionCount,
      sessionsSelected: selected.length,
      endpoints: ep.endpoints.length,
      flows: ctx.flows.length,
      unassignedSessions: ctx.unassigned.length,
      trackedValueChains: ctx.chains.length,
      chainWithProducer: ctx.chains.filter((c) => c.producer).length,
      credentialFields: ctx.credentials.length,
      responsesScannedForProducers: ctx.ledgerStats.responsesScanned || 0,
      websocketSessions: archive.summary.websocket.sessions,
      websocketFrames: archive.summary.websocket.frames,
      bodyCandidates: ctx.bodyCandidates,
      bodiesIncluded: ctx.bodyIncluded,
      bodiesExcluded: ctx.bodyExcluded.length,
      decodeFailures: ctx.decodeFailures.length,
      // B11/F28：分块框架解不开与只解出部分块都必须是可查的数字，否则“解框失败”会被当成成功
      dechunkFailures: ctx.dechunkFailures.length,
      dechunkPartial: ctx.dechunkPartial.length,
      chunkedResponses: (archive.summary.transferChunked || {}).responses || 0,
      eventStreamResponses: (archive.summary.stream || {}).eventStreamResponses || 0,
      capabilityUndecodable: (archive.summary.responseEncodingFailed || []).length,
      statusAbnormal: archive.sessions.filter((s) => s.statusAbnormal).length,
      incompleteSessions: archive.sessions.filter((s) => !s.complete).length,
    },
    totals: {
      tokens: totalTokens,
      chars: files.reduce((a, f) => a + f.chars, 0),
      files: files.length,
      structuredVolumes: 1,
      summaryVolumes: ctx.summaryVolumes.length,
      bodyVolumes: ctx.bodyVolumes.length,
      volumeCount: files.length,
    },
    files,
    trimLog: ctx.trimLog,
    decodeFailures: ctx.decodeFailures.slice(0, 200),
    excludedBodySids: ctx.bodyExcluded.map((b) => b.sids[0]),
    warnings: archive.warnings.slice(0, 200),
    readingOrder: files.filter((f) => f.role !== 'body').map((f) => f.path)
      .concat(ctx.bodyVolumes.map((v) => '60-bodies/v' + String(v.index).padStart(2, '0') + '/')),
  };
  ctx.elapsedMs = manifest.elapsedMs;

  say('done', { tokens: totalTokens, files: files.length });
  return { manifest, ctx };
}

/**
 * 落盘。内容与统计在 buildAnalysisPackage 已定稿，这里只写文件。
 * @returns {{written:Array, outDir:string}}
 */
function writePackage(pkg, outDir) {
  const { manifest, ctx } = pkg;
  fs.mkdirSync(outDir, { recursive: true });
  const written = [];
  const put = (rel, text) => {
    const full = path.join(outDir, rel);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, text, 'utf8');
    written.push({ path: rel, bytes: Buffer.byteLength(text, 'utf8') });
  };
  for (const b of ctx.structuredVolumes[0].blocks) put(b.label, b.text);
  for (const v of ctx.summaryVolumes) for (const b of v.blocks) put(b.label, b.text);
  for (const v of ctx.bodyVolumes) for (const b of v.blocks) put('60-bodies/v' + String(v.index).padStart(2, '0') + '/' + b.label, b.text);
  put('manifest.json', JSON.stringify(manifest, null, 2));
  return { written, outDir };
}

module.exports = {
  DEFAULTS,
  TIER_RANK,
  STRUCTURED_ORDER,
  buildAnalysisPackage,
  writePackage,
  packVolumes,
  chunkTextByBudget,
  volumeLabel,
  buildSummaryBlocks,
  buildFieldGroups,
  priorityOf,
};
