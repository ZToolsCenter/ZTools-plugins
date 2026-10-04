'use strict';

/**
 * flow.js —— 业务流程分组与跨会话参数传递链（B 层 · F23）
 *
 * 这是原算法完全没有、而人做分析时最花时间的部分：从 3756 条平铺会话里
 * 还原出"这是一次注册流程 / 一次登录流程 / 一条刷新链"，以及
 * "哪个响应产生的 token 被后面哪些请求用了"。
 *
 * 分两步且**成本显式受控**：
 *  1. groupFlows —— 纯用索引里的 _m.xml 时间戳做时序断点聚类，零额外 IO。
 *  2. buildValueLedger —— 先从索引里的**请求侧**字段值/头值建“值 → 使用位置”倒排（零 IO），
 *     再**只对出现在 ≥2 个请求的共享值**回溯找生产者：
 *     ① 响应头来源（Set-Cookie / 凭证类头）直接用索引里已有的隐私标签倒排匹配，**零 IO**；
 *     ② 响应正文子串匹配（需解压，条数与单条字节数都有上限）；
 *     ③ 响应头原文子串兜底（与正文同一次读取产出，不产生额外 IO）。
 *     超限即写进 trimLog，不静默降级。
 *
 * 方向纪律（重要，v0.2.1）：**响应头是“来源”，不是“使用者”**。
 * 早期版本把 scope='responseHeader' 的隐私值也当使用位置登记，导致两个后果（实测 50 个样本共 398/11025 个 users 被污染）：
 *   · reuseSessionCount 虚高（把下发算成复用）；
 *   · firstUse 被提前到“下发那一刻”，把生产者约束收得更紧、更难命中。
 * 现只把请求侧（query / requestBody / requestHeader / cookie 拆项）当作使用者。
 *
 * Cookie 拆项（v0.2.1 接线）：整串 `Cookie: a=1; b=token` 含空格与分号，会被
 * isTraceableValue 直接拒收 —— 之前实测 50 个样本里 1078 条 cookie→cookie 真值链，
 * 只有 1 条进了账本。privacy.parseCookieHeader 早就实现了拆项但全仓库零调用，
 * 现在真正接上：拆成 `cookie.<name>` 粒度的使用位置（scope='cookie'）。
 *
 * 绝不猜测未观察到的因果关系：只有“字面值确实出现在更早的响应里（头或正文）”才记为生产者，
 * 并按通路标 `match: 'set-cookie' | 'header' | 'literal' | 'header-text'`；
 * 其余一律留在 `unproduced` 里由分析者判断。
 */

const privacy = require('../core/privacy');

/** cookie 语义的头值 → 可用项值（拆不出可用值时不退回整串，因为整串一定含分隔符、无追踪价值）。 */
function cookieItemValues(value) {
  const out = [];
  for (const c of privacy.parseCookieHeader(value)) {
    if (c.value && isTraceableValue(c.value)) out.push(c.value);
  }
  return out;
}

/**
 * 索引里可作为“被传递值”的来源位置——**只算请求侧**（谁在用这个值）。
 * 响应头属于来源侧，由 buildValueLedger 的响应头倒排单独处理，不能在这里当使用者。
 */
function collectCandidateValues(session) {
  const out = [];
  for (const f of session.reqFields || []) {
    if (f && f.sample) out.push({ value: String(f.sample), scope: f.from === 'query' ? 'query' : 'body', name: f.path });
  }
  for (const t of session.privacyTags || []) {
    if (!t || !t.value) continue;
    if (t.scope === 'responseHeader') continue;
    const name = String(t.name || '');
    if (/^cookie$/i.test(name)) {
      // 拆项：一个 cookie 项就是一个使用位置，名字用 cookie 自名
      for (const c of privacy.parseCookieHeader(t.value)) {
        if (c.value && isTraceableValue(c.value)) out.push({ value: c.value, scope: 'cookie', name: 'cookie.' + c.name });
      }
      continue;
    }
    out.push({ value: String(t.value), scope: t.scope || 'header', name });
  }
  return out;
}

/**
 * 值是否值得追踪。规则（保守，宁可漏也不制造噪声）：
 * - 长度 >= 8（短值如 "android"、"1" 到处都出现，无追踪价值）
 * - 长度 <= 512（超长多为整块 base64 载荷，不是标识符）
 * - 不是纯数字（时间戳/计数会误报成"传递链"）
 * - 不含空白与控制符
 */
function isTraceableValue(v) {
  if (!v || v.length < 8 || v.length > 512) return false;
  if (/^\d+$/.test(v)) return false;
  if (/[\s\u0000-\u001f]/.test(v)) return false;
  return true;
}

/**
 * 时序流程分组。
 * @param {Array} sessions 索引会话（需带 timers.startedAt）
 * @param {object} [opts]
 * @param {number} [opts.gapMs] 断流阈值，默认 15000
 * @param {number} [opts.minSessions] 少于此数的段并入前一段，默认 2
 * @param {(s:object)=>boolean} [opts.only] 只聚类命中的会话（其余归入 flowId=null 的"未聚类"）
 * @returns {{flows:Array, unassigned:Array, params:object}}
 */
function groupFlows(sessions, opts) {
  const o = opts || {};
  const gapMs = o.gapMs === undefined ? 15000 : Number(o.gapMs);
  const minSessions = o.minSessions === undefined ? 2 : Number(o.minSessions);
  const timed = sessions.filter((s) => s.timers && s.timers.startedAt !== null && s.timers.startedAt !== undefined);
  const others = o.only ? sessions.filter((s) => !o.only(s)) : [];
  const pool = (o.only ? timed.filter(o.only) : timed).slice()
    .sort((a, b) => a.timers.startedAt - b.timers.startedAt || a.seq - b.seq);

  const segments = [];
  let cur = null;
  let prevAt = null;
  for (const s of pool) {
    const at = s.timers.startedAt;
    if (!cur || (at - prevAt) > gapMs) {
      cur = { startAt: at, endAt: at, sessions: [] };
      segments.push(cur);
    }
    cur.sessions.push(s);
    if (cur.endAt < at) cur.endAt = at;
    prevAt = at;
  }
  // 过短的段并入前段：抓包里的零星重试不应被当成一个独立"流程"
  const merged = [];
  for (const seg of segments) {
    if (seg.sessions.length < minSessions && merged.length) {
      const prev = merged[merged.length - 1];
      prev.sessions = prev.sessions.concat(seg.sessions);
      prev.endAt = Math.max(prev.endAt, seg.endAt);
    } else {
      merged.push(seg);
    }
  }

  const flows = merged.map((seg, i) => {
    const hosts = new Map();
    const cats = { api: 0, logic: 0, noise: 0 };
    const methods = new Map();
    let bytes = 0;
    for (const s of seg.sessions) {
      s.flowId = 'F' + String(i + 1).padStart(2, '0');
      if (s.host) hosts.set(s.host, (hosts.get(s.host) || 0) + 1);
      cats[s.category] = (cats[s.category] || 0) + 1;
      methods.set(s.method || 'REQ', (methods.get(s.method || 'REQ') || 0) + 1);
      bytes += s.respEntryPlainBytes || 0;
    }
    const topHosts = [...hosts.entries()].sort((a, b) => b[1] - a[1]);
    const endpoints = new Set(seg.sessions.filter((s) => s.category === 'api').map((s) => s.urlTemplate || s.url));
    return {
      flowId: 'F' + String(i + 1).padStart(2, '0'),
      index: i + 1,
      startAt: seg.startAt,
      endAt: seg.endAt,
      startIso: new Date(seg.startAt).toISOString(),
      endIso: new Date(seg.endAt).toISOString(),
      spanMs: seg.endAt - seg.startAt,
      sessionCount: seg.sessions.length,
      apiCount: cats.api,
      logicCount: cats.logic,
      noiseCount: cats.noise,
      hostCount: hosts.size,
      endpointCount: endpoints.size,
      plainResponseBytes: bytes,
      topHosts: topHosts.slice(0, 6).map(([host, n]) => ({ host, count: n })),
      methods: [...methods.entries()].sort((a, b) => b[1] - a[1]).map(([m, n]) => m + ':' + n),
      /** 首尾接口是流程识别最强的两个特征（如 /get_verification_id → /login） */
      firstApi: (seg.sessions.find((s) => s.category === 'api') || null),
      lastApi: [...seg.sessions].reverse().find((s) => s.category === 'api') || null,
      sids: seg.sessions.map((s) => s.sid),
    };
  });

  return {
    flows,
    unassigned: sessions.filter((s) => !s.flowId),
    others,
    params: { gapMs, minSessions, timedSessions: timed.length, total: sessions.length },
  };
}

/**
 * 值账本：谁在用这个值、谁产生了这个值。
 * @param {object} archive openArchive 的结果（需要 detail 能力才能扫响应）
 * @param {object} [opts]
 * @param {number} [opts.minReuse] 至少被几个请求使用才追踪，默认 2
 * @param {number} [opts.maxTrackedValues] 追踪上限（按使用次数排序后截取），默认 200
 * @param {number} [opts.maxResponseScans] 响应扫描条数上限，默认 1200
 * @param {number} [opts.maxResponseBytes] 单条响应参与匹配的明文字节上限，默认 512KB
 * @param {boolean} [opts.withHeaderText] 是否把响应头原文也当子串匹配域（零额外 IO），默认 true
 */
function buildValueLedger(archive, opts) {
  const o = Object.assign({ minReuse: 2, maxTrackedValues: 200, maxResponseScans: 1200, maxResponseBytes: 512 * 1024, withHeaderText: true }, opts || {});
  const sessions = archive.sessions;
  const bySid = new Map(sessions.map((s) => [s.sid, s]));

  /* --- 第一步：请求侧倒排，零 IO --- */
  const usage = new Map();
  for (const s of sessions) {
    for (const c of collectCandidateValues(s)) {
      if (!isTraceableValue(c.value)) continue;
      let rec = usage.get(c.value);
      if (!rec) { rec = { value: c.value, users: [], kinds: new Set(), names: new Set() }; usage.set(c.value, rec); }
      rec.users.push({ sid: s.sid, seq: s.seq, scope: c.scope, name: c.name, flowId: s.flowId || null });
      rec.kinds.add(c.scope);
      rec.names.add(c.name);
    }
  }

  const shared = [...usage.values()]
    .filter((r) => new Set(r.users.map((u) => u.sid)).size >= o.minReuse)
    .sort((a, b) => new Set(b.users.map((u) => u.sid)).size - new Set(a.users.map((u) => u.sid)).size);

  const tracked = shared.slice(0, o.maxTrackedValues);
  const droppedValues = Math.max(0, shared.length - tracked.length);

  /* --- 第二步：回溯找生产者 --- */
  // 因果方向：生产者必须早于该值的**首次使用**（使用只看请求侧）。
  // 扫描horizon 取所有追踪值首次使用序号的**最大值**（而非最小）——
  // 取最小会导致刚开头就 break，实测只能扫 2 条响应、一个生产者都找不到。
  const firstUse = new Map(tracked.map((r) => [r.value, Math.min(...r.users.map((u) => u.seq))]));
  const horizon = tracked.length ? Math.max(...[...firstUse.values()]) : 0;
  const result = new Map(tracked.map((r) => [r.value, { producers: [] }]));
  const trackedSet = new Set(tracked.map((r) => r.value));

  /* 2a. 响应头来源倒排：**零 IO**。
   * Set-Cookie / 凭证类响应头在索引阶段就已经躺在 privacyTags 里（scope='responseHeader'），
   * 所以按 name=value 精确匹配即可，不依赖“读不读得到 headerText”。
   * 这一步单独成立，才能避开“会话无响应体（204/304 带 Set-Cookie）”时被正文门槛误挡。*/
  const headerIndex = new Map();
  let headerIndexValues = 0;
  for (const s of sessions) {
    for (const t of s.privacyTags || []) {
      if (t.scope !== 'responseHeader' || !t.value) continue;
      const hname = String(t.name || '');
      const isSetCookie = /^set-cookie$/i.test(hname);
      const vals = /^cookie$/i.test(hname) ? cookieItemValues(t.value) : (isSetCookie ? cookieItemValues(t.value) : [String(t.value)]);
      for (const v of vals) {
        if (!trackedSet.has(v)) continue;
        const fu = firstUse.get(v);
        if (fu === undefined || s.seq >= fu) continue;   // 不早于使用点就不是来源
        let arr = headerIndex.get(v);
        if (!arr) { arr = []; headerIndex.set(v, arr); headerIndexValues++; }
        arr.push({ sid: s.sid, seq: s.seq, host: s.host, urlTemplate: s.urlTemplate, match: isSetCookie ? 'set-cookie' : 'header' });
      }
    }
  }
  for (const [v, list] of headerIndex) {
    const bucket = result.get(v);
    for (const p of list) if (!bucket.producers.some((x) => x.sid === p.sid)) bucket.producers.push(p);
  }

  let scanned = 0;
  let scannedBytes = 0;
  let scanCapReached = false;
  let headerTextHits = 0;

  if (tracked.length && Number.isFinite(horizon)) {
    const ordered = sessions.slice().sort((a, b) => a.seq - b.seq);
    for (const s of ordered) {
      if (s.seq >= horizon) break;
      if (!s.hasResponse) continue;
      // 无响应体或超大响应不参与文本匹配（超大件通常是媒体，不可能是 token 来源）；
      // 注意：这类会话如果是 Set-Cookie 来源，已在上面的零 IO 倒排里处理完。
      if (!s.respEntryPlainBytes || s.respEntryPlainBytes > 8 * 1024 * 1024) continue;
      if (scanned >= o.maxResponseScans) { scanCapReached = true; break; }
      let hayBody = '';
      let hayHead = '';
      try {
        const d = archive.detail(s, { withFields: false, maxBodyBytes: o.maxResponseBytes });
        const buf = d.response && d.response.bodyBuf;
        const head = d.response && d.response.headerText;
        hayBody = buf && buf.length ? buf.toString('latin1') : '';
        // headerText 与 body 来自**同一次 readEntry+parseMessage**，取它不产生额外 IO
        hayHead = o.withHeaderText === false || !head ? '' : String(head);
        if (!hayBody && !hayHead) continue;
      } catch (e) {
        continue;
      }
      scanned++;
      scannedBytes += hayBody.length + hayHead.length;
      for (const r of tracked) {
        // 只有响应确实早于该值首次使用，才能当生产者
        if (s.seq >= firstUse.get(r.value)) continue;
        const bucket = result.get(r.value).producers;
        if (bucket.some((p) => p.sid === s.sid)) continue;   // 已由响应头精确命中，不用子串重复登记
        if (hayBody.includes(r.value)) {
          bucket.push({ sid: s.sid, seq: s.seq, host: s.host, urlTemplate: s.urlTemplate, match: 'literal' });
        } else if (hayHead && hayHead.includes(r.value)) {
          headerTextHits++;
          bucket.push({ sid: s.sid, seq: s.seq, host: s.host, urlTemplate: s.urlTemplate, match: 'header-text' });
        }
      }
    }
  }

  /* --- 汇总成可渲染结构 --- */
  const producerKinds = {};
  const chains = tracked.map((r) => {
    const usersBySid = [...new Map(r.users.map((u) => [u.sid, u])).values()].sort((a, b) => a.seq - b.seq);
    const producers = (result.get(r.value).producers || []).sort((a, b) => a.seq - b.seq);
    for (const p of producers) producerKinds[p.match] = (producerKinds[p.match] || 0) + 1;
    const firstUser = usersBySid[0];
    return {
      value: r.value,
      // 呈现长度：默认给全值（用户指令：隐私值默认列出），仅在超过 96 字时截显示并保留 length
      display: r.value.length > 96 ? r.value.slice(0, 96) + '…' : r.value,
      valueLength: r.value.length,
      scopes: [...r.kinds],
      names: [...r.names].slice(0, 12),
      reuseSessionCount: usersBySid.length,
      producers,
      producer: producers.length ? producers[0] : null,
      users: usersBySid.slice(0, 40),
      usersTruncated: usersBySid.length > 40,
      spread: producers.length && firstUser ? { fromSid: producers[0].sid, toSid: firstUser.sid, fromSeq: producers[0].seq, toSeq: firstUser.seq } : null,
      flows: [...new Set(r.users.map((u) => u.flowId).filter(Boolean))],
    };
  }).sort((a, b) => b.reuseSessionCount - a.reuseSessionCount);

  return {
    chains,
    stats: {
      candidateDistinctValues: usage.size,
      sharedValues: shared.length,
      trackedValues: tracked.length,
      droppedValues,
      responsesScanned: scanned,
      responseBytesScanned: scannedBytes,
      /** 生产者按通路分类：set-cookie / header 为精确项匹配，literal / header-text 为子串匹配 */
      producerKinds,
      headerIndexValues,
      headerTextHits,
      withHeaderText: o.withHeaderText !== false,
      withProducer: chains.filter((c) => c.producer).length,
      withoutProducer: chains.filter((c) => !c.producer).length,
      scanCapReached,
      maxResponseScans: o.maxResponseScans,
    },
    /** 供调用方写入 manifest.trimLog：任何被预算裁掉的部分都必须可见。 */
    budgetNotes: [
      droppedValues ? { step: 'F23 值追踪', action: '限制追踪的共享值数量', detail: '按使用次数排序后丢弃 ' + droppedValues + ' 个低频值', reason: 'maxTrackedValues=' + o.maxTrackedValues } : null,
      scanCapReached ? { step: 'F23 生产者回溯', action: '提前停止响应扫描', detail: '达到 ' + o.maxResponseScans + ' 条上限即停，horizon 内尚有响应未扫完', reason: 'maxResponseScans' } : null,
      // 弱匹配必须留痕：header-text 是子串命中（不如 cookie 项精确），核对时看 producer.match
      headerTextHits ? { step: 'F23 生产者来源', action: '响应头原文子串兜底命中', detail: headerTextHits + ' 条生产者来自 header-text（弱于 set-cookie/header 的精确项匹配，也不同于正文 literal）', reason: 'withHeaderText' } : null,
    ].filter(Boolean),
    bySid: { get: (sid) => bySid.get(sid) },
  };
}

/**
 * 鉴权与设备标识总览（L0 用）：把散在头/查询/体里的凭证类字段按名字聚合。
 * 同名同值出现在多个会话 = 稳定凭证；同名异值 = 被刷新过（分析时最需要看的就是这条线）。
 */
function buildCredentialBoard(archive) {
  const sessions = archive.sessions;
  const board = new Map();
  for (const s of sessions) {
    for (const c of collectCandidateValues(s)) {
      if (!isTraceableValue(c.value)) continue;
      const key = String(c.name).toLowerCase();
      let rec = board.get(key);
      if (!rec) { rec = { name: c.name, values: new Map(), sessions: new Set(), scopes: new Set() }; board.set(key, rec); }
      if (!rec.values.has(c.value)) rec.values.set(c.value, { value: c.value, firstSeq: s.seq, lastSeq: s.seq, sessions: new Set() });
      const v = rec.values.get(c.value);
      v.lastSeq = s.seq;
      v.sessions.add(s.sid);
      rec.sessions.add(s.sid);
      rec.scopes.add(c.scope);
    }
  }
  return [...board.values()]
    .map((r) => ({
      name: r.name,
      sessionCount: r.sessions.size,
      scope: [...r.scopes].join('/'),
      distinctValues: r.values.size,
      /** 同名多值 = 该字段在会话期间发生过变化（token 刷新/账号切换的强信号） */
      rotated: r.values.size > 1,
      values: [...r.values.values()]
        .sort((a, b) => a.firstSeq - b.firstSeq)
        .map((v) => ({
          display: v.value.length > 96 ? v.value.slice(0, 96) + '…' : v.value,
          valueLength: v.value.length,
          firstSeq: v.firstSeq,
          lastSeq: v.lastSeq,
          sessionCount: v.sessions.size,
        })),
    }))
    .filter((r) => r.sessionCount >= 2)
    .sort((a, b) => b.sessionCount - a.sessionCount);
}

module.exports = {
  groupFlows,
  buildValueLedger,
  buildCredentialBoard,
  collectCandidateValues,
  isTraceableValue,
};
