/**
 * Q3 存储占用与配额预警（v1.4）
 *
 * 只读模块：**绝不写 localStorage**，只做计量与分级。
 * 计量口径：localStorage 以 UTF-16 计，`str.length * 2` 字节（key 与 value 都算），
 * 与 Chromium `QuotaExceededError` 触发口径一致；`navigator.storage.estimate()` 在
 * `file://` 的 webview 里不可靠（常返回 0 / 抛错），故不用它。
 *
 * 分级：< 80% ok / ≥ 80% warn（变红，提示导出备份）/ ≥ 100% over。
 */

/** localStorage 单 origin 常见上限（Chromium / webview）。仅用于展示分母。 */
export const QUOTA_BYTES = 5 * 1024 * 1024;
/** 预警阈值（PRD：> 80% 变红并提示导出备份） */
export const WARN_RATIO = 0.8;

/** 本插件自己的键前缀（主键 + 快照键 + 损坏备份） */
const OWN_PREFIX = ['ztools_project_cost', 'ztools_renovation_cost'];
/** 网页版历史键（用户可能仍有残留，一并计入但它也占配额） */
const WEB_PREFIX = 'renovation_cost_';

/** UTF-16 字节数（无法获取时按 0） */
export const byteLen = (s) => (typeof s === 'string' ? s.length * 2 : 0);

export const fmtKB = (bytes) => {
  const kb = (bytes || 0) / 1024;
  if (kb >= 1024) return `${(kb / 1024).toFixed(2)} MB`;
  if (kb >= 100) return `${Math.round(kb)} KB`;
  return `${kb.toFixed(1)} KB`;
};

export const usageLevel = (ratio) => (ratio >= 1 ? 'over' : ratio >= WARN_RATIO ? 'warn' : 'ok');

/**
 * 统计当前 origin 的 localStorage 占用。
 * 永不 throw：环境不支持 / 被禁用时返回 `{ ok:false }`，UI 只需降级为一行文字。
 */
export function storageUsage(quota = QUOTA_BYTES) {
  const empty = {
    ok: false, bytes: 0, quota, ratio: 0, percent: 0, level: 'ok',
    main: 0, snap: 0, other: 0, keys: [], keyCount: 0, text: '不可用',
  };
  let ls;
  try { ls = window.localStorage; } catch (_) { return empty; }
  if (!ls) return empty;

  const keys = [];
  let bytes = 0;
  let main = 0;
  let snap = 0;
  let other = 0;
  try {
    for (let i = 0; i < ls.length; i += 1) {
      const k = ls.key(i);
      if (k === null || k === undefined) continue;
      const v = ls.getItem(k) || '';
      const b = byteLen(k) + byteLen(v);
      bytes += b;
      const own = OWN_PREFIX.some((p) => k.startsWith(p));
      const web = k.startsWith(WEB_PREFIX);
      if (own && k.includes('_snap')) snap += b;
      else if (own || web) main += b;
      else other += b;
      keys.push({ key: k, bytes: b, own, snap: own && k.includes('_snap') });
    }
  } catch (_) { return empty; }

  const ratio = quota > 0 ? bytes / quota : 0;
  const level = usageLevel(ratio);
  const percent = Math.round(ratio * 1000) / 10; // 一位小数
  return {
    ok: true,
    bytes, quota, ratio, percent, level,
    main, snap, other, keys, keyCount: keys.length,
    text: `${fmtKB(bytes)} / ${fmtKB(quota)}`,
  };
}
