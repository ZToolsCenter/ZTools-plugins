/**
 * B3 / B4 界面偏好（v1.7）：**只存本地浏览器偏好，不进 state**。
 *
 * 为什么单独一个文件、单独两个键：
 *  - 密度（紧凑/舒适）是「这台设备上这个人的阅读习惯」，不是账本数据。
 *    一旦塞进 `state`，它就会跟着 7 日快照、JSON 备份、CSV 导入导出一起搬家 ——
 *    在 A 电脑选了紧凑，导到 B 电脑会莫名其妙变紧凑，用户会以为是数据坏了。
 *  - 上次备份时间同理：它是**本机**的事实，跟着账本走没有意义（换台机器就该重新提示）。
 *
 * localStorage 不可用（隐私模式 / 配额满 / Node 环境）时**一律静默回退默认值，永不 throw**——
 * 偏好读不到不该让整个应用白屏。写法与 `src/lib/storage.js` 保持一致。
 */

import { ref } from 'vue';

/**
 * 列表密度键：
 *  · `'compact'`（默认，两行、单行 35.92px —— v1.7 B3 已验收口径，**一行不许改**）
 *  · `'comfort'`（三行、单行 ≈57px）
 *  · `'large'`（v1.8.2 新增「大字」档：三行布局，行内所有文字 ≥12px，不承诺首屏条数）
 */
export const DENSITY_KEY = 'ztools_rc_density';
/** 上次备份时间戳（ms）键；`0` / 缺失 = 从未备份 */
export const LAST_BACKUP_KEY = 'ztools_rc_last_backup';

/** 合法密度值（顺序即 UI 上的切换顺序） */
export const DENSITIES = ['compact', 'comfort', 'large'];
/** 默认密度：v1.7 拍板默认紧凑 —— 71 个费用项的列表，一屏多看 3 条比多看两行装饰更有用 */
export const DENSITY_DEFAULT = 'compact';

/** K22（v1.9.x）：密度三档的 chip 文案（原来散在 ItemsView，收拢到 prefs 供 DensityChip 复用） */
export const DENSITY_LABEL = { compact: '密度·紧凑', comfort: '密度·舒适', large: '密度·大字' };
/**
 * K22：三档的**可见**说明文字（原来只藏在 title 里，挑剔客户反馈「说明只在悬停时才有」）。
 * 在密度直达菜单里作为每个选项的副标题常驻显示，不再依赖悬停。
 */
export const DENSITY_DESC = {
  compact: '单行 35.92px，首屏条数最多',
  comfort: '三行布局，单行约 57px',
  large: '所有文字 ≥12px，首屏条数变少',
};

/**
 * K16（v1.9.x）：全局「活着」的密度信号（Vue ref）。
 *
 * 为什么需要它：v1.7 时密度只被 ItemsView 的列表消费，各视图自持一个本地 ref 就够了；
 * K16 要把大字档铺到**图表**（Donut / MiniBars）与**抽屉明细行**（Drawer）上 ——
 * 这些组件不属于任何单一视图，再靠视图传 prop 就得钻三层。故把信号放到 prefs：
 *  · 仍是**独立键、不进账本**（v1.7「密度不进账本」的决定不变）；
 *  · `setDensity()` 是唯一写入口，写库同时同步本 ref，所有消费方自动响应；
 *  · 模块加载时读一次 localStorage —— node 测试环境（无 localStorage）安全回落 compact。
 */
export const densityLive = ref(getDensity());

/** 安全取 localStorage；不可用时返回 null（调用方按默认值处理） */
function store() {
  try {
    // 先看全局（浏览器与 node 打桩环境都有），再退回 window.localStorage。
    // 注意别用 `typeof window === 'undefined'` 直接判死：某些环境（测试打桩）只挂了全局 localStorage。
    if (typeof localStorage !== 'undefined' && localStorage) return localStorage;
    if (typeof window !== 'undefined' && window.localStorage) return window.localStorage;
    return null;
  } catch (_) {
    // Safari 隐私模式下访问 localStorage 本身就会抛 SecurityError
    return null;
  }
}

/** 归一化密度值：任何非法输入都落回默认，不抛错 */
export function normDensity(v) {
  return v === 'comfort' || v === 'large' ? v : DENSITY_DEFAULT;
}

/** 读密度偏好（读不到 = 紧凑） */
export function getDensity() {
  try {
    const raw = store()?.getItem(DENSITY_KEY);
    return raw === 'comfort' || raw === 'compact' || raw === 'large' ? raw : DENSITY_DEFAULT;
  } catch (_) {
    return DENSITY_DEFAULT;
  }
}

/**
 * 写密度偏好。
 * @param {'compact'|'comfort'|'large'} v
 * @returns {'compact'|'comfort'|'large'} 实际落库的值（写失败也返回归一化后的值，UI 照常切换）
 */
export function setDensity(v) {
  const n = normDensity(v);
  try { store()?.setItem(DENSITY_KEY, n); } catch (_) { /* 配额满 / 隐私模式：静默 */ }
  // K16：同步全局信号（Donut / MiniBars / Drawer 都从这里读，不需要视图层层传 prop）
  densityLive.value = n;
  return n;
}

/** 读上次备份时间戳 ms；从未备份返回 0 */
export function getLastBackup() {
  try {
    const raw = store()?.getItem(LAST_BACKUP_KEY);
    const n = Number(raw);
    return Number.isFinite(n) && n > 0 ? n : 0;
  } catch (_) {
    return 0;
  }
}

/**
 * 记一次备份完成的时间。
 * @param {number} [ts] 默认 now（测试可注入固定时间）
 * @returns {number} 实际记录的时间戳
 */
export function setLastBackup(ts = Date.now()) {
  const n = Number(ts);
  const v = Number.isFinite(n) && n > 0 ? Math.round(n) : Date.now();
  try { store()?.setItem(LAST_BACKUP_KEY, String(v)); } catch (_) { /* 静默 */ }
  return v;
}

/* ---------------- K2（v1.8）自动备份偏好（独立键，不进账本） ----------------
 * 与密度 / 上次手动备份同一套设计：只存本机浏览器偏好，绝不进台账 state，
 * 否则会跟着快照 / JSON 备份 / CSV 导入一起搬家，换台机器反而混乱。
 * localStorage 不可用（隐私模式 / 配额满 / Node 环境）时一律降级默认，永不 throw。 */

/** 自动备份开关 + 周期：`{ enabled: boolean, period: 'week'|'month' }` */
export const AUTO_BACKUP_KEY = 'ztools_rc_auto_backup';
/** 上次自动备份时间戳 ms（判定「是否跨过周期边界」用） */
export const AUTO_BACKUP_LAST_KEY = 'ztools_rc_auto_backup_last';
/** 最近自动备份日志：`[{ ts:number, size:number, name:string }]`（时间倒序） */
export const AUTO_BACKUP_LOG_KEY = 'ztools_rc_auto_backup_log';
/** 设置页最多展示的自动备份条数 */
export const AUTO_BACKUP_MAX = 8;
/**
 * 「首次启动已告知」标记键：值为 `'1'` = 已告知过，缺失 / 其它 = 未告知。
 * 用途见 `store.maybeAutoBackup` 的注释 —— 自动备份默认开启后，
 * 首次启动只做告知、不真的下载，避免 headless 回归被下载动作卡死。
 */
export const AUTO_BACKUP_NOTICED_KEY = 'ztools_rc_auto_backup_noticed';

/**
 * 自动备份的默认配置：**默认开启 + 周期一周**。
 *
 * 为什么敢默认开启：在「默认开启」与「无条件下载」之间隔着一道 `AUTO_BACKUP_NOTICED_KEY`
 * 闸门（见 `store.maybeAutoBackup` 的 `first-run-notice` 分支）—— 首次启动只置标记、不下载，
 * 第二次启动起才按周期真正落文件。于是「真实用户第二天起就被自动备份保护着」，
 * 从头跑 = 永远停在首启」，再也不会有下载对话框把 UI 套件卡死。
 */
export const AUTO_BACKUP_DEFAULT = Object.freeze({ enabled: true, period: 'week' });

/** 读「是否已做过首次告知」（未告知 = false；localStorage 不可用时保守返回 false） */
export function getAutoBackupNoticed() {
  try {
    return store()?.getItem(AUTO_BACKUP_NOTICED_KEY) === '1';
  } catch (_) {
    return false;
  }
}

/**
 * 写「首次告知」标记（写失败静默 —— 最坏结果是再告知一次，不会丢数据）。
 * @param {boolean} v true = 已告知
 * @returns {boolean} 实际落库的值
 */
export function setAutoBackupNoticed(v = true) {
  const flag = !!v;
  try {
    if (flag) store()?.setItem(AUTO_BACKUP_NOTICED_KEY, '1');
    else store()?.removeItem(AUTO_BACKUP_NOTICED_KEY);
  } catch (_) { /* 静默 */ }
  return flag;
}

/**
 * 读自动备份配置。
 * 读不到 / 损坏 / localStorage 不可用 → 落回 `AUTO_BACKUP_DEFAULT`（**默认开启 · 周**）。
 */
export function getAutoBackup() {
  try {
    const raw = store()?.getItem(AUTO_BACKUP_KEY);
    if (!raw) return { ...AUTO_BACKUP_DEFAULT };
    const o = JSON.parse(raw);
    return {
      // 显式写过 `enabled:false` 的用户保留「关」；从未写过（键缺失）→ 默认开
      enabled: !!o?.enabled,
      period: o?.period === 'month' ? 'month' : AUTO_BACKUP_DEFAULT.period,
    };
  } catch (_) {
    return { ...AUTO_BACKUP_DEFAULT };
  }
}

/** 写自动备份配置（写失败静默，返回归一化后的配置） */
export function setAutoBackup(cfg) {
  const o = {
    enabled: !!(cfg && cfg.enabled),
    period: cfg && cfg.period === 'month' ? 'month' : 'week',
  };
  try { store()?.setItem(AUTO_BACKUP_KEY, JSON.stringify(o)); } catch (_) { /* 静默 */ }
  return o;
}

/** 读上次自动备份时间戳 ms；从未备份返回 0 */
export function getLastAutoBackup() {
  try {
    const n = Number(store()?.getItem(AUTO_BACKUP_LAST_KEY));
    return Number.isFinite(n) && n > 0 ? n : 0;
  } catch (_) {
    return 0;
  }
}

/** 记一次自动备份完成的时间（写入前归一化为正整数） */
export function setLastAutoBackup(ts = Date.now()) {
  const n = Number(ts);
  const v = Number.isFinite(n) && n > 0 ? Math.round(n) : Date.now();
  try { store()?.setItem(AUTO_BACKUP_LAST_KEY, String(v)); } catch (_) { /* 静默 */ }
  return v;
}

/** 读自动备份日志（时间倒序数组；读不到 / 损坏返回空数组） */
export function getAutoBackupLog() {
  try {
    const raw = store()?.getItem(AUTO_BACKUP_LOG_KEY);
    const arr = raw ? JSON.parse(raw) : [];
    return Array.isArray(arr) ? arr : [];
  } catch (_) {
    return [];
  }
}

/**
 * 追加一条自动备份日志到列表头，超出 `AUTO_BACKUP_MAX` 截断旧记录。
 * @param {{ts?: number, size?: number, name?: string}} entry
 * @returns {Array} 截断后的日志（时间倒序）
 */
export function addAutoBackupLog(entry) {
  const log = getAutoBackupLog();
  log.unshift({
    ts: Number(entry?.ts) || Date.now(),
    size: Number(entry?.size) || 0,
    name: String(entry?.name || ''),
  });
  const trimmed = log.slice(0, AUTO_BACKUP_MAX);
  try { store()?.setItem(AUTO_BACKUP_LOG_KEY, JSON.stringify(trimmed)); } catch (_) { /* 静默 */ }
  return trimmed;
}

/** 清空自动备份日志 */
export function clearAutoBackupLog() {
  try { store()?.removeItem(AUTO_BACKUP_LOG_KEY); } catch (_) { /* 静默 */ }
}
