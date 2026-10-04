'use strict';

/**
 * pairing.js —— SAZ 条目配对（A 层）
 *
 * 实测事实（决定这里不能简单按序号配对）：
 * - 文件名形如 raw/<SessionID>_<c|s|req|resp|client|server>.txt
 * - SessionID 不连续（样本中出现 1897、540），必须按数值排序后重新编号 seq
 * - 请求与响应数量不对称（实测 3756 请求 vs 4221 响应），存在半截会话，配对必须容错
 * - raw/ 下还有 <SessionID>_m.xml 会话元数据，需一并归入同一会话
 * - 本机实测发现：<SessionID>_w.txt 是 **Fiddler 的 WebSocket 帧日志**（324MB 样本中 34 个
 *   会话共 1007KB / 1984 帧）。原 Python 算法只处理 _c/_s/_m，把这部分业务数据全部丢弃，
 *   因此这里必须把它当作一等角色登记，而不是归入"未知后缀"告警后丢掉。
 */

/** 支持的命名后缀体系 → 归一角色。 */
const ROLE_MAP = {
  c: 'request', client: 'request', req: 'request',
  s: 'response', server: 'response', resp: 'response',
  m: 'meta',
  w: 'ws', websock: 'ws', ws: 'ws',
};

/** raw 条目文件名解析。 */
const RAW_FILE_RE = /^raw\/(\d+)_([A-Za-z]+)\.(txt|xml)$/i;

/** 目录条目（名以 / 结尾）与非法名会被跳过，需要向上传递告警。 */
function isDirectoryEntry(name) {
  return name.endsWith('/');
}

/**
 * 把 ZIP 条目组织为会话列表。
 * @param {Array} entries ZipReader#entries
 * @param {object} [opts]
 * @param {boolean} [opts.sortByTime] 有 _m.xml 时按 ClientBeginRequest 排序（默认按 sid 数值）
 * @returns {{sessions:Array, skipped:Array, stats:object}}
 */
function pairEntries(entries, opts) {
  const bySid = new Map();
  const skipped = [];

  for (const e of entries) {
    if (isDirectoryEntry(e.name)) continue;
    const m = RAW_FILE_RE.exec(e.name);
    if (!m) {
      if (e.name.startsWith('raw/')) skipped.push({ name: e.name, reason: '无法识别的文件名' });
      continue;
    }
    const sid = Number(m[1]);
    const role = ROLE_MAP[m[2].toLowerCase()];
    if (!role) { skipped.push({ name: e.name, reason: '未知后缀 ' + m[2] }); continue; }

    let rec = bySid.get(sid);
    if (!rec) {
      rec = { sid, request: null, response: null, meta: null, ws: null, duplicateCount: 0 };
      bySid.set(sid, rec);
    }
    if (rec[role]) {
      // 同一 sid 同角色出现多次（少见，但抓包重试会发生）：保留首个并记录，绝不静默覆盖
      rec.duplicateCount++;
      skipped.push({ name: e.name, reason: '同 sid 同角色重复，已忽略后来者' });
      continue;
    }
    rec[role] = e;
  }

  const sessions = [...bySid.values()].sort((a, b) => a.sid - b.sid);
  sessions.forEach((s, i) => {
    s.seq = i + 1;
    s.hasRequest = !!s.request;
    s.hasResponse = !!s.response;
    s.hasMeta = !!s.meta;
    s.hasWs = !!s.ws;
    s.complete = s.hasRequest && s.hasResponse;
  });

  const stats = {
    totalRawEntries: entries.filter((e) => e.name.startsWith('raw/') && !isDirectoryEntry(e.name)).length,
    sessionCount: sessions.length,
    withRequest: sessions.filter((s) => s.hasRequest).length,
    withResponse: sessions.filter((s) => s.hasResponse).length,
    withMeta: sessions.filter((s) => s.hasMeta).length,
    withWs: sessions.filter((s) => s.hasWs).length,
    incomplete: sessions.filter((s) => !s.complete).length,
    skipped: skipped.length,
  };
  return { sessions, skipped, stats };
}

/**
 * 按 sid 查它的 WebSocket 帧日志条目（分析包与 saz_ws tool 用）。
 * @returns {object|null}
 */
function wsEntryOf(session) {
  return session && session.ws ? session.ws : null;
}

/**
 * 从会话条目名推断角色（供单条读取路径复用）。
 * @returns {'request'|'response'|'meta'|'ws'|null}
 */
function roleOfEntry(name) {
  const m = RAW_FILE_RE.exec(name);
  if (!m) return null;
  return ROLE_MAP[m[2].toLowerCase()] || null;
}

module.exports = { pairEntries, roleOfEntry, wsEntryOf, ROLE_MAP, RAW_FILE_RE };
