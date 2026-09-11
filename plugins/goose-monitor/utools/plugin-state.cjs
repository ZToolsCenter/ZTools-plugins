const QUERY_PREF_KEY = "pk_query";
/** 插件上次退出时刻（ms 时间戳字符串），用于判断历史筛选是否过期。 */
const QUERY_LEFT_AT_PREF_KEY = "pk_query_left_at";
/** 关闭后超过该时长再进入，清空搜索栏并显示全部。 */
const QUERY_STALE_MS = 5 * 60 * 1000;

function extractKeyword(payload) {
  if (typeof payload !== "string") return "";
  const text = payload.trim();
  const matched = text.match(/^(?:杀进程|结束进程|进程|内存|prockill|pk|kill)[\s:：]+(\S.*)$/i);
  return (matched ? matched[1] : text).trim().slice(0, 200);
}

/**
 * 关闭超过 QUERY_STALE_MS 的历史筛选词视为过期，返回空串（下次进入显示全部）。
 * leftAt 缺失或非法时保留 query，兼容升级前旧数据与未记录退出的场景。
 */
function resolvePersistedQuery(savedQuery, leftAt, now = Date.now()) {
  const query = String(savedQuery || "").slice(0, 200);
  if (!query) return "";
  const left = typeof leftAt === "number" ? leftAt : Number(leftAt);
  if (!Number.isFinite(left) || left <= 0) return query;
  if (now - left >= QUERY_STALE_MS) return "";
  return query;
}

function resolveEntryQuery(entry, savedQuery) {
  const { type, payload } = entry || {};
  if (type === "regex" || type === "over") return extractKeyword(payload);
  return String(savedQuery || "").slice(0, 200);
}

module.exports = {
  QUERY_PREF_KEY,
  QUERY_LEFT_AT_PREF_KEY,
  QUERY_STALE_MS,
  extractKeyword,
  resolvePersistedQuery,
  resolveEntryQuery,
};
