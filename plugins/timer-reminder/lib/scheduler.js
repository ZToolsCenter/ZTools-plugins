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
const TICK_MS = 1000; // 可见时调度精度
const HIDDEN_TICK_MS = 60000; // 隐藏到后台时的扫描间隔（降频，误差 ≤60s，即用户可接受的一分钟上限；对主进程的同步 IPC 压力降至最低）
const LOCK_TTL = 180000; // 锁有效期：需显著大于隐藏调度间隔（60s×2+余量），防止多个隐藏视图因心跳变稀而互相抢锁、重复触发
const LOCK_REFRESH = 50000; // 心跳写入间隔（隐藏 60s 时每 tick 写一次；可见 1s 时每 50s 写一次）
const MISSED_THRESHOLD = 5 * 60 * 1000; // 超过该时长视为“错过”
const ESCALATE_MS = 5 * 60 * 1000; // 弹窗强提醒未处理时的升级间隔

let timer = null;
let isOwner = false;
let ownerId = null;
let lastLockWrite = 0;
let visible = true; // 插件视图是否对用户可见（ZTools 隐藏视图会缓存保留，需降频以降低后台开销）
const listeners = [];
const escalations = new Map(); // id -> Timeout，弹窗未处理时的升级提醒

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
 * 弹窗强提醒的升级机制：触发后 ESCALATE_MS 内用户未处理
 * （完成/稍后/编辑都会刷新 updatedAt）则再提醒一次，仅升级一次不循环。
 */
function scheduleEscalation(firedDoc, firedAt, settings) {
  const id = firedDoc._id;
  if (escalations.has(id)) return;
  const t = setTimeout(() => {
    escalations.delete(id);
    try {
      const doc = store.getReminder(id);
      if (!doc) return;
      // fire 自身写入的 updatedAt 与 firedAt 几乎同时，留 2s 余量；更晚的变更视为用户已处理
      if ((doc.updatedAt || 0) > firedAt + 2000) return;
      notifier.notify(doc, { late: 0, beepTimes: settings.beepTimes, escalate: true });
      emit({ type: 'escalated', reminder: doc });
    } catch (e) {
      /* 忽略 */
    }
  }, ESCALATE_MS);
  escalations.set(id, t);
}

/**
 * 触发一条到点的提醒，并推进其状态。
 * options.silent：仅推进状态不通知（错过聚合/关闭补发时使用）。
 */
function fire(item, now, settings, options) {
  const opts = options || {};
  const late = now - item.nextRunAt;
  const missed = late > MISSED_THRESHOLD;
  const silent = !!opts.silent || (missed && settings.notifyOnMissed === false);
  if (!silent) {
    notifier.notify(item, {
      late: late,
      beepTimes: settings.beepTimes
    });
  }

  const patch = {
    lastFiredAt: now,
    firedCount: (item.firedCount || 0) + 1
  };

  if (item.mode === 'repeat') {
    const next = Schedule.computeNextRun(
      { mode: 'repeat', repeat: item.repeat, anchorAt: item.anchorAt },
      now
    );
    const maxCount = item.repeat ? parseInt(item.repeat.maxCount, 10) : 0;
    const reachedMax = maxCount > 0 && patch.firedCount >= maxCount;
    if (next == null || reachedMax) {
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

  // 触发历史留痕（仅非静默触发；停机补发的批量静默推进不写，避免刷屏）
  if (!silent) {
    try {
      store.appendHistory(item, now, late);
    } catch (e) {
      /* 忽略 */
    }
  }

  // 额外通道（邮件 / 短信 / Webhook），异步且不阻塞主流程；静默补发时不轰炸外部通道
  if (!silent) {
    channels
      .send(item, settings, store.getSecrets())
      .then((results) => {
        if (results && results.length) emit({ type: 'channels', reminder: updated || item, results: results });
      })
      .catch(() => {
        /* 忽略 */
      });
  }

  // 弹窗强提醒：未处理时升级再提醒
  if (!silent && item.popup && updated) scheduleEscalation(updated, now, settings);

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
  const fresh = [];
  const stale = [];
  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    if (item.enabled === false) continue;
    const next = item.nextRunAt;
    if (typeof next !== 'number' || !isFinite(next) || next > now) continue;
    (now - next > MISSED_THRESHOLD ? stale : fresh).push(item);
  }

  // 刚到点的逐条通知
  for (let i = 0; i < fresh.length; i++) {
    try {
      fire(fresh[i], now, settings);
    } catch (e) {
      /* 单条失败不中断整体调度 */
    }
  }
  // 停机/休眠期间错过的多条提醒：静默推进状态，聚合成一条汇总通知，避免连环轰炸
  if (stale.length > 1) {
    for (let i = 0; i < stale.length; i++) {
      try {
        fire(stale[i], now, settings, { silent: true });
      } catch (e) {
        /* 忽略 */
      }
    }
    if (settings.notifyOnMissed !== false) {
      try {
        notifier.notifyMissedSummary(stale, settings);
      } catch (e) {
        /* 忽略 */
      }
      emit({ type: 'missed', reminders: stale });
    }
  } else if (stale.length === 1) {
    try {
      fire(stale[0], now, settings);
    } catch (e) {
      /* 忽略 */
    }
  }
}

/**
 * 启动调度器。重复调用无副作用。
 * 可见视图以 1 秒精度扫描；隐藏到后台的视图降频到 60 秒，
 * 提醒仍能准点触发（误差 ≤60 秒，即一分钟上限），
 * 但同步 IPC 对主进程的压力降至最低。
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
  timer = setInterval(tick, visible ? TICK_MS : HIDDEN_TICK_MS);
  emit({ type: 'started', owner: ownerId });
}

/**
 * 插件视图可见性变化时调整调度频率：
 *  - visible=true ：恢复 1 秒精度并立即扫一次，让界面马上对齐状态；
 *  - visible=false：降频到 60 秒（误差 ≤60 秒），减少隐藏视图对主进程的同步 IPC 负担。
 * 调度器不彻底停摆——持锁窗口仍需在后台准点触发提醒。
 */
function setVisibility(v) {
  visible = !!v;
  if (!timer) return;
  clearInterval(timer);
  if (visible) tick(); // 回到前台立即对齐一次，避免倒计时/状态滞后
  timer = setInterval(tick, visible ? TICK_MS : HIDDEN_TICK_MS);
}

function stop() {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
  escalations.forEach((t) => clearTimeout(t));
  escalations.clear();
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
  setVisibility,
  snooze,
  complete,
  MISSED_THRESHOLD
};
