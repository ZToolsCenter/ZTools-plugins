/**
 * scheduler.js —— 提醒调度引擎（preload 专用，CommonJS）
 *
 * 设计要点：
 *  - 使用 Node 侧 setInterval（preload 运行在 Node 上下文），不受页面隐藏时
 *    Chromium 对 DOM 定时器的节流影响，隐藏后台后仍能准点触发。
 *  - 多窗口（主窗口 / 分离窗口 / 弹窗）可能同时加载 preload，通过数据库里的
 *    “心跳锁”保证同一时刻只有一个窗口真正触发提醒，避免重复通知。
 *  - 状态全部落在 ztools.db，插件被杀后重启可自动续上；错过的提醒在启动时补发。
 */
'use strict';

const store = require('./store.js');
const notifier = require('./notifier.js');
const channels = require('./channels.js');
const Schedule = require('./schedule.js');

const LOCK_ID = 'reminder_scheduler_lock';
const TICK_MS = 1000; // 调度精度
const LOCK_TTL = 8000; // 超过该时长没有心跳即视为锁失效
const LOCK_REFRESH = 4000; // 心跳写入间隔
const MISSED_THRESHOLD = 5 * 60 * 1000; // 超过该时长视为“错过”

let timer = null;
let isOwner = false;
let ownerId = null;
let lastLockWrite = 0;
const listeners = [];

function ztools() {
  return window.ztools;
}

function emit(event) {
  for (let i = 0; i < listeners.length; i++) {
    try {
      listeners[i](event);
    } catch (e) {
      /* 单个监听器异常不影响调度 */
    }
  }
}

function on(listener) {
  if (typeof listener === 'function') listeners.push(listener);
  return () => {
    const idx = listeners.indexOf(listener);
    if (idx !== -1) listeners.splice(idx, 1);
  };
}

function readLock() {
  try {
    return ztools().db.get(LOCK_ID) || null;
  } catch (e) {
    return null;
  }
}

function writeLock(now) {
  try {
    const existing = readLock();
    const doc = Object.assign({}, existing || {}, {
      _id: LOCK_ID,
      owner: ownerId,
      ts: now
    });
    if (existing && existing._rev) doc._rev = existing._rev;
    ztools().db.put(doc);
    lastLockWrite = now;
  } catch (e) {
    /* 忽略 */
  }
}

/**
 * 竞选 / 续约调度锁。只有持锁窗口才会真正触发提醒。
 */
function ensureOwnership(now) {
  const lock = readLock();
  if (lock && lock.owner !== ownerId && now - (lock.ts || 0) < LOCK_TTL) {
    isOwner = false;
    return;
  }
  isOwner = true;
  if (!lock || lock.owner !== ownerId || now - lastLockWrite >= LOCK_REFRESH) {
    writeLock(now);
  }
}

/**
 * 触发一条到点的提醒，并推进其状态。
 */
function fire(item, now, settings) {
  const late = now - item.nextRunAt;
  notifier.notify(item, {
    late: late,
    beepTimes: settings.beepTimes
  });

  const patch = {
    lastFiredAt: now,
    firedCount: (item.firedCount || 0) + 1
  };

  if (item.mode === 'repeat') {
    const next = Schedule.computeNextRun(
      { mode: 'repeat', repeat: item.repeat, anchorAt: item.anchorAt },
      now
    );
    if (next == null) {
      patch.enabled = false;
      patch.nextRunAt = null;
    } else {
      patch.nextRunAt = next;
    }
  } else {
    patch.enabled = false;
    patch.nextRunAt = null;
  }

  const updated = store.updateReminder(item._id, patch);

  // 额外通道（邮件 / 短信 / Webhook），异步且不阻塞主流程
  channels
    .send(item, settings, store.getSecrets())
    .then((results) => {
      if (results && results.length) emit({ type: 'channels', reminder: updated || item, results: results });
    })
    .catch(() => {
      /* 忽略 */
    });

  emit({ type: 'fired', reminder: updated || item, late: late });
}

/**
 * 一次调度扫描。
 */
function tick() {
  const now = Date.now();
  ensureOwnership(now);
  if (!isOwner) return;

  const settings = store.getSettings();
  const items = store.listReminders();
  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    if (item.enabled === false) continue;
    const next = item.nextRunAt;
    if (typeof next !== 'number' || !isFinite(next) || next > now) continue;
    try {
      fire(item, now, settings);
    } catch (e) {
      /* 单条失败不中断整体调度 */
    }
  }
}

/**
 * 启动调度器。重复调用无副作用。
 */
function start() {
  if (timer) return;
  try {
    ownerId = String(ztools().getWebContentsId());
  } catch (e) {
    ownerId = 'win_' + Math.random().toString(36).slice(2, 8);
  }
  // 立即扫一次，补发插件未运行期间错过的提醒
  tick();
  timer = setInterval(tick, TICK_MS);
  emit({ type: 'started', owner: ownerId });
}

function stop() {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
  isOwner = false;
}

function status() {
  return {
    running: !!timer,
    owner: isOwner,
    ownerId: ownerId,
    tickMs: TICK_MS
  };
}

/**
 * 稍后提醒：把下次触发时间推后 minutes 分钟并重新启用。
 */
function snooze(id, minutes, settings) {
  const mins = minutes != null ? minutes : (settings || store.getSettings()).snoozeMinutes;
  const next = Date.now() + Math.max(1, mins | 0) * 60 * 1000;
  const updated = store.updateReminder(id, { nextRunAt: next, enabled: true });
  if (updated) emit({ type: 'changed', reminder: updated });
  return updated;
}

/**
 * 完成（单次）/ 跳过本次（重复）。
 */
function complete(id) {
  const item = store.getReminder(id);
  if (!item) return null;
  let updated;
  if (item.mode === 'repeat') {
    const next = Schedule.computeNextRun(
      { mode: 'repeat', repeat: item.repeat, anchorAt: item.anchorAt },
      Date.now()
    );
    updated = store.updateReminder(id, { nextRunAt: next, enabled: next != null });
  } else {
    updated = store.updateReminder(id, { enabled: false, nextRunAt: null });
  }
  if (updated) emit({ type: 'changed', reminder: updated });
  return updated;
}

module.exports = {
  start,
  stop,
  tick,
  status,
  on,
  snooze,
  complete,
  MISSED_THRESHOLD
};
