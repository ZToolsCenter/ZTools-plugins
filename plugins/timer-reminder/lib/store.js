/**
 * store.js —— 提醒数据持久化（preload 专用，CommonJS）
 *
 * 基于 ZTools 的插件独立数据库（window.ztools.db），文档 ID 统一加前缀，
 * 便于用 allDocs(prefix) 批量读取。
 *
 * 提醒文档结构：
 *   {
 *     _id, _rev,
 *     title: string,          // 提醒内容
 *     note: string,           // 备注
 *     mode: 'once' | 'repeat',
 *     at: number | null,      // once 触发时间戳
 *     repeat: object | null,  // repeat 规则，见 lib/schedule.js
 *     anchorAt: number | null,// interval 对齐基准
 *     nextRunAt: number | null,
 *     enabled: boolean,
 *     sound: boolean,         // 到点响铃
 *     popup: boolean,         // 到点弹窗强提醒
 *     createdAt, updatedAt, lastFiredAt, firedCount
 *   }
 */
'use strict';

const ITEM_PREFIX = 'reminder_item_';
const SETTINGS_ID = 'reminder_settings';
const SECRETS_ID = 'reminder_secrets';
const HISTORY_ID = 'reminder_history';
const MAX_HISTORY = 100; // 触发记录最多保留条数

// 内存缓存：ztools.db 为同步桥接（每次调用都会阻塞渲染进程主线程并往返主进程），
// 调度器每秒扫描 + 界面每秒刷新若每次都全量读库，会随窗口数量成倍拖慢整个 ZTools。
// 采用「短 TTL + 写操作即时失效」：保证数据新鲜（跨窗口变更最多延迟 ~10s 可见），
// 同时把全量读库降到每 10 秒一次（覆盖可见 1s 与隐藏 5s 两种调度频率）、设置读取降到 30 秒一次。
const ITEMS_CACHE_TTL = 10000;
const SETTINGS_CACHE_TTL = 30000;

let itemsCache = null;
let itemsCacheAt = 0;
let settingsCache = null;
let settingsCacheAt = 0;

function invalidateCaches() {
  itemsCache = null;
  itemsCacheAt = 0;
  settingsCache = null;
  settingsCacheAt = 0;
}

const DEFAULT_SETTINGS = {
  sound: true, // 新建提醒默认响铃
  popup: false, // 新建提醒默认不弹窗
  snoozeMinutes: 10, // “稍后提醒”默认时长
  beepTimes: 3, // 响铃次数
  notifyOnMissed: true, // 启动时补发错过的提醒
  // 额外提醒通道（邮件 / 短信 / Webhook）；密钥另存于加密存储
  channels: {
    enabled: false,
    smtp: { enabled: false, host: '', port: 465, secure: true, user: '', from: '', to: '' },
    smsbao: { enabled: false, user: '', phone: '' },
    webhook: { enabled: false, url: '', method: 'POST', contentType: 'json', template: '' }
  },
  // 大语言模型（OpenAI 兼容）；API Key 另存于加密存储
  llm: { enabled: false, useWhenRuleFails: true, baseUrl: '', model: '', temperature: 0.2 }
};

function db() {
  return window.ztools.db;
}

/** 兼容 allDocs 可能返回 {doc} 包装或裸文档两种形态 */
function unwrap(item) {
  if (!item) return null;
  return item.doc && item.doc._id ? item.doc : item;
}

function safeGet(id) {
  try {
    return db().get(id) || null;
  } catch (e) {
    return null;
  }
}

function putDoc(doc) {
  const existing = safeGet(doc._id);
  const merged = Object.assign({}, existing || {}, doc);
  if (existing && existing._rev) merged._rev = existing._rev;
  const result = db().put(merged);
  invalidateCaches();
  return result;
}

function newId() {
  return ITEM_PREFIX + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 8);
}

/* ------------------------------------------------------------------ *
 * 提醒 CRUD
 * ------------------------------------------------------------------ */

function listReminders() {
  if (!itemsCache || Date.now() - itemsCacheAt >= ITEMS_CACHE_TTL) {
    let docs = [];
    try {
      docs = db().allDocs(ITEM_PREFIX) || [];
    } catch (e) {
      docs = [];
    }
    itemsCache = docs
      .map(unwrap)
      .filter((d) => d && d._id && d._id.indexOf(ITEM_PREFIX) === 0)
      .sort((a, b) => {
        // 启用中的按 nextRunAt 升序；已完成的沉底并按更新时间降序
        const aActive = a.enabled !== false;
        const bActive = b.enabled !== false;
        if (aActive !== bActive) return aActive ? -1 : 1;
        if (aActive && bActive) return (a.nextRunAt || 0) - (b.nextRunAt || 0);
        return (b.updatedAt || 0) - (a.updatedAt || 0);
      });
    itemsCacheAt = Date.now();
  }
  // 返回副本，避免调用方改动污染缓存
  return itemsCache.slice();
}

function getReminder(id) {
  const doc = safeGet(id);
  return doc && doc._id === id ? doc : null;
}

/**
 * 新建提醒。data 至少包含 title / mode。
 */
function createReminder(data) {
  const now = Date.now();
  const settings = getSettings();
  const doc = {
    _id: newId(),
    title: String(data.title || '提醒').trim() || '提醒',
    note: String(data.note || ''),
    mode: data.mode === 'repeat' ? 'repeat' : 'once',
    at: data.mode === 'repeat' ? null : Number(data.at) || null,
    repeat: data.mode === 'repeat' ? data.repeat : null,
    anchorAt: data.anchorAt != null ? Number(data.anchorAt) : now,
    nextRunAt: Number(data.nextRunAt) || null,
    enabled: data.enabled !== false,
    sound: data.sound != null ? !!data.sound : settings.sound,
    popup: data.popup != null ? !!data.popup : settings.popup,
    createdAt: now,
    updatedAt: now,
    lastFiredAt: null,
    firedCount: 0
  };
  putDoc(doc);
  return doc;
}

/**
 * 局部更新提醒，返回更新后的文档；不存在返回 null。
 */
function updateReminder(id, patch) {
  const doc = getReminder(id);
  if (!doc) return null;
  const merged = Object.assign({}, doc, patch, { _id: id, updatedAt: Date.now() });
  putDoc(merged);
  return merged;
}

function removeReminder(id) {
  const doc = getReminder(id);
  if (!doc) return false;
  try {
    db().remove(doc);
    invalidateCaches();
    return true;
  } catch (e) {
    return false;
  }
}

/* ------------------------------------------------------------------ *
 * 设置
 * ------------------------------------------------------------------ */

/**
 * 深度合并两个设置对象：旧版本保存的数据缺少新字段时自动补齐默认值，
 * 同时每层都复制，避免共享 DEFAULT_SETTINGS 的嵌套引用。
 */
function deepMerge(base, patch) {
  const out = {};
  Object.keys(base || {}).forEach((k) => {
    const b = base[k];
    const p = patch ? patch[k] : undefined;
    if (p === undefined) {
      out[k] = b && typeof b === 'object' && !Array.isArray(b) ? deepMerge(b, null) : b;
    } else if (
      p && typeof p === 'object' && !Array.isArray(p) &&
      b && typeof b === 'object' && !Array.isArray(b)
    ) {
      out[k] = deepMerge(b, p);
    } else {
      out[k] = p;
    }
  });
  Object.keys(patch || {}).forEach((k) => {
    if (!(k in (base || {}))) out[k] = patch[k];
  });
  return out;
}

function getSettings() {
  if (!settingsCache || Date.now() - settingsCacheAt >= SETTINGS_CACHE_TTL) {
    const stored = safeGet(SETTINGS_ID);
    settingsCache = deepMerge(DEFAULT_SETTINGS, (stored && stored.value) || {});
    settingsCacheAt = Date.now();
  }
  return settingsCache;
}

function setSettings(patch) {
  const next = deepMerge(getSettings(), patch || {});
  putDoc({ _id: SETTINGS_ID, value: next });
  return next;
}

/* ------------------------------------------------------------------ *
 * 密钥（加密存储）
 * ------------------------------------------------------------------ */

function cryptoStorage() {
  return window.ztools.dbCryptoStorage || window.ztools.dbStorage;
}

/**
 * 读取密钥：{ smtpPass, smsbaoKey, llmApiKey }
 */
function getSecrets() {
  try {
    return Object.assign({}, cryptoStorage().getItem(SECRETS_ID) || {});
  } catch (e) {
    return {};
  }
}

function setSecrets(patch) {
  const next = Object.assign({}, getSecrets(), patch || {});
  try {
    cryptoStorage().setItem(SECRETS_ID, next);
  } catch (e) {
    /* 忽略 */
  }
  return next;
}

/* ------------------------------------------------------------------ *
 * 触发历史（最近触发记录，最多保留 MAX_HISTORY 条）
 * ------------------------------------------------------------------ */

function getHistory() {
  try {
    const doc = safeGet(HISTORY_ID);
    return doc && Array.isArray(doc.value) ? doc.value : [];
  } catch (e) {
    return [];
  }
}

function appendHistory(item, firedAt, late) {
  try {
    const list = getHistory().slice();
    list.unshift({
      id: item._id,
      title: item.title || '提醒',
      note: item.note || '',
      at: firedAt || Date.now(),
      late: late || 0
    });
    if (list.length > MAX_HISTORY) list.length = MAX_HISTORY;
    putDoc({ _id: HISTORY_ID, value: list });
  } catch (e) {
    /* 历史记录失败不影响提醒主流程 */
  }
}

function clearHistory() {
  try {
    putDoc({ _id: HISTORY_ID, value: [] });
  } catch (e) {
    /* 忽略 */
  }
}

module.exports = {
  ITEM_PREFIX,
  DEFAULT_SETTINGS,
  listReminders,
  getReminder,
  createReminder,
  updateReminder,
  removeReminder,
  getSettings,
  setSettings,
  getSecrets,
  setSecrets,
  getHistory,
  appendHistory,
  clearHistory
};
