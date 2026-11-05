/**
 * 快照：自动日快照 + 操作前快照 + 一键回滚。
 *
 * 三条硬约束（违反会导致数据被自己撑爆，见设计稿风险表 #1 #2）：
 *  1. 独立键 `SNAP_KEY`，**不进主键、不进 reactive `state`** —— 否则 deep watch → persist
 *     → 再写快照 → state 变化 的死循环，且 10×60KB 灌进主键会触发配额兜底静默删图。
 *  2. 绝不挂到 `persistNow()` 里，快照只在明确的时机由调用方触发。
 *  3. 写失败只返回 `{ ok:false, msg }`，**永不 throw** —— 主数据保存流程一律继续。
 *
 * 依赖：仅 `core.js`（`calc` / `round2` / `todayLocal`）。不依赖 `store.js` / `ui.js`。
 */
import { calc, round2, todayLocal } from './core';

/** 快照独立键（**严禁**加入 store 的 `PREV_KEYS`） */
export const SNAP_KEY = 'ztools_project_cost_snap_v1';

const MAX_DAILY = 7;
const MAX_PRE = 3;
/** 1,572,864 字节，按 Σ item.bytes 累计（只算 data 体积，不含 JSON 外层键开销） */
const MAX_BYTES = 1.5 * 1024 * 1024;

/** 快照类型标签，供设置页「历史版本」列表显示 */
export const REASON_TEXT = {
  daily: '自动',
  import: '导入前',
  'import-legacy': '搬家前',
  reset: '清空前',
  'restore-default': '恢复默认前',
  'checkup-fix': '修复前',
  'before-rollback': '回滚前',
};

/** 计算 UTF-8 字节数（不引第三方依赖） */
function utf8Bytes(s) {
  try {
    return new TextEncoder().encode(s).length;
  } catch (_) {
    // 极端环境兜底：中文按 3 字节估算
    return String(s).length * 3;
  }
}

const EMPTY = () => ({ v: 1, items: [] });

/**
 * 读取全部快照（容错：键被手工清空 / 内容损坏时返回空列表，不抛）。
 * @returns {{v: number, items: Array}}
 */
export function loadSnaps() {
  let raw = null;
  try {
    raw = localStorage.getItem(SNAP_KEY);
  } catch (_) {
    return EMPTY();
  }
  if (!raw) return EMPTY();
  try {
    const d = JSON.parse(raw);
    if (!d || !Array.isArray(d.items)) return EMPTY();
    const items = d.items.filter(
      (x) => x && typeof x === 'object' && x.data && Array.isArray(x.data.books) && x.data.books.length,
    );
    return { v: 1, items };
  } catch (_) {
    return EMPTY();
  }
}

/**
 * 淘汰策略（纯函数，便于单测）：先按分类限额裁，再按总量上限裁（优先淘汰 daily）。
 * @param {Array} items 快照数组
 * @returns {Array} 裁剪后按 ts 升序排列的新数组
 */
export function pruneTo(items) {
  let list = (items || []).slice().sort((a, b) => a.ts - b.ts);
  // ① 分类限额
  const daily = list.filter((x) => x.kind === 'daily');
  const pre = list.filter((x) => x.kind === 'pre');
  while (daily.length > MAX_DAILY) daily.shift(); // 最旧淘汰
  while (pre.length > MAX_PRE) pre.shift();
  list = [...daily, ...pre].sort((a, b) => a.ts - b.ts);
  // ② 总量上限：先淘汰 daily，都淘汰完了才动 pre
  const sum = (arr) => arr.reduce((s, x) => s + (x.bytes || 0), 0);
  while (sum(list) > MAX_BYTES) {
    const i = list.findIndex((x) => x.kind === 'daily');
    if (i >= 0) {
      list.splice(i, 1);
      continue;
    }
    if (list.length > 1) {
      list.shift();
      continue;
    }
    break; // 只剩本次这一条，交给外层判超限
  }
  return list;
}

/**
 * 深拷贝 payload 并剥离凭证图（`p.img`），返回剥离张数。
 * ⚠️ payload 可能是 Vue reactive proxy，必须先 `JSON.parse(JSON.stringify())` 成普通对象，
 * 绝不能把 reactive 引用存进快照。
 */
function prepareData(payload) {
  const data = JSON.parse(JSON.stringify(payload || {}));
  let imgDropped = 0;
  (data.books || []).forEach((b) => {
    (b.projects || []).forEach((p) => {
      if (p && p.img) {
        delete p.img;
        imgDropped += 1;
      }
    });
  });
  return { data, imgDropped };
}

/**
 * 从快照载荷算出统计摘要（存储时算好，列表直接显示，回滚后用于比对）。
 * @param {object} data 与 `importState(data)` 同构的载荷
 */
export function snapStatOf(data) {
  const books = Array.isArray(data?.books) ? data.books : [];
  const active = books.find((b) => b.id === data?.activeBookId) || books[0] || null;
  const c = calc(active);
  return {
    books: books.length,
    name: active?.name || '—',
    items: c.count,
    details: c.detailCount,
    pays: c.payCount,
    payable: round2(c.payable),
    paid: round2(c.paid),
    due: round2(c.remain),
  };
}

function writeSnaps(items) {
  try {
    localStorage.setItem(SNAP_KEY, JSON.stringify({ v: 1, items }));
    return true;
  } catch (_) {
    return false;
  }
}

/**
 * 写一份快照。**永不 throw**。
 * @param {'daily'|'pre'} kind 类型
 * @param {string} reason 原因码（见 `REASON_TEXT`）
 * @param {{books: Array, activeBookId: string, templates: Array, warnThreshold: number}} payload
 * @returns {{ok: boolean, msg?: string, item?: object}}
 */
export function saveSnapshot(kind, reason, payload) {
  let prepared;
  try {
    prepared = prepareData(payload);
  } catch (_) {
    return { ok: false, msg: '快照序列化失败，已跳过本次快照' };
  }
  const { data, imgDropped } = prepared;
  if (!Array.isArray(data.books) || !data.books.length) {
    return { ok: false, msg: '没有可备份的数据，已跳过本次快照' };
  }

  let dataStr;
  try {
    dataStr = JSON.stringify(data);
  } catch (_) {
    return { ok: false, msg: '快照序列化失败，已跳过本次快照' };
  }
  const bytes = utf8Bytes(dataStr);
  if (bytes > MAX_BYTES) {
    return { ok: false, msg: '快照体积超过上限，已跳过本次快照' };
  }

  const ts = Date.now();
  const item = {
    id: `s_${ts.toString(36)}_${Math.random().toString(36).slice(2, 6)}`,
    ts,
    day: todayLocal(),
    kind,
    reason,
    bytes,
    imgDropped,
    stat: snapStatOf(data),
    data,
  };

  const full = pruneTo([...loadSnaps().items, item]);
  if (writeSnaps(full)) return { ok: true, item };

  // 降级重试：只留 1 份 pre + 本次（daily 全丢，保住"操作前"这一份）
  const keep = full.filter((x) => x.kind === 'pre').slice(-1);
  const seen = new Set();
  const fallback = [...keep, item].filter((x) => {
    if (!x || seen.has(x.id)) return false;
    seen.add(x.id);
    return true;
  });
  if (writeSnaps(fallback)) return { ok: true, item, msg: '存储空间紧张，已精简历史快照' };
  return { ok: false, msg: '快照写入失败，本地存储空间可能已满；主数据不受影响' };
}

/**
 * 启动时写当日日快照：当日已有一条 `daily` 则跳过（不用时间差，避免一天开两次写两份）。
 * @param {object} payload 与 `saveSnapshot` 同构；由 store 组装
 */
export function maybeDailySnapshot(payload) {
  const { items } = loadSnaps();
  const day = todayLocal();
  if (items.some((x) => x.kind === 'daily' && x.day === day)) return { ok: true, skipped: true };
  return saveSnapshot('daily', 'daily', payload);
}

/**
 * 读单条快照（深读，含 `data`）。
 * @param {string} id 快照 id
 * @returns {object|null} 不可用时返回 null（不抛）
 */
export function readSnapshot(id) {
  if (!id) return null;
  const hit = loadSnaps().items.find((x) => x.id === id);
  if (!hit) return null;
  if (!Array.isArray(hit.data?.books) || !hit.data.books.length) return null;
  return hit;
}

/**
 * 列表用的快照摘要（**不含 data**，避免一次性把 620KB 拉进内存），按时间倒序。
 */
export function listSnaps() {
  return loadSnaps()
    .items.slice()
    .sort((a, b) => b.ts - a.ts)
    .map((x) => ({
      id: x.id,
      ts: x.ts,
      day: x.day,
      kind: x.kind,
      reason: x.reason,
      bytes: x.bytes || 0,
      imgDropped: x.imgDropped || 0,
      stat: x.stat || { books: 0, name: '—', items: 0, details: 0, pays: 0, payable: 0, paid: 0, due: 0 },
    }));
}

/** 快照时间显示：`MM-DD HH:mm`（手写补零，不用 locale） */
export function fmtSnapTime(ts) {
  const d = new Date(+ts || 0);
  if (Number.isNaN(d.getTime())) return '—';
  const p2 = (n) => String(n).padStart(2, '0');
  return `${p2(d.getMonth() + 1)}-${p2(d.getDate())} ${p2(d.getHours())}:${p2(d.getMinutes())}`;
}
