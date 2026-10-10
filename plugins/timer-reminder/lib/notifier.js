/**
 * notifier.js —— 到点提醒的呈现（preload 专用，CommonJS）
 *
 * 呈现手段（按可用性降级）：
 *   1. ztools.showNotification  系统通知（ZTools 官方 API）
 *   2. Electron Notification    官方 API 不可用时的兜底
 *   3. ztools.shellBeep         系统提示音
 *   4. createBrowserWindow      置顶弹窗强提醒（可选）
 */
'use strict';

const TimeFormat = require('./time-format.js');

let alarmWindows = [];

function ztools() {
  return window.ztools;
}

function beep(times) {
  const n = Math.max(1, Math.min(10, times | 0));
  for (let i = 0; i < n; i++) {
    setTimeout(() => {
      try {
        ztools().shellBeep();
      } catch (e) {
        /* 忽略 */
      }
    }, i * 700);
  }
}

function systemNotify(title, body) {
  // 1) ZTools 官方通知
  try {
    ztools().showNotification(body);
    return true;
  } catch (e) {
    /* 继续兜底 */
  }
  // 2) Electron 原生通知
  try {
    const { Notification } = require('electron');
    if (Notification && Notification.isSupported && Notification.isSupported()) {
      const n = new Notification({ title: title, body: body, silent: true });
      n.on('click', () => {
        try {
          ztools().showMainWindow();
        } catch (e) {
          /* 忽略 */
        }
      });
      n.show();
      return true;
    }
  } catch (e) {
    /* 忽略 */
  }
  return false;
}

/**
 * 打开置顶强提醒弹窗。
 */
function openAlarmWindow(reminder) {
  try {
    const win = ztools().createBrowserWindow(
      'alarm.html?id=' + encodeURIComponent(reminder._id),
      {
        width: 420,
        height: 250,
        frame: false,
        resizable: false,
        movable: true,
        alwaysOnTop: true,
        center: true,
        skipTaskbar: false,
        title: '定时提醒'
      },
      () => {
        /* 加载完成 */
      }
    );
    alarmWindows.push(win);
    // 兜底回收，避免窗口对象堆积
    setTimeout(() => {
      alarmWindows = alarmWindows.filter((w) => w !== win);
    }, 60 * 60 * 1000);
    return win;
  } catch (e) {
    return null;
  }
}

/**
 * 触发一次提醒。
 * @param {object} reminder 提醒文档
 * @param {{late?:number, beepTimes?:number}} [options]
 */
function notify(reminder, options) {
  const opts = options || {};
  const late = opts.late || 0;
  const when = reminder.nextRunAt || Date.now();
  const timeText = TimeFormat.formatHuman(when, Date.now());
  const prefix = late > 5 * 60 * 1000 ? '【已错过】' : '';
  const body = prefix + reminder.title + '\n' + timeText + (reminder.note ? '\n' + reminder.note : '');

  systemNotify('⏰ 定时提醒', body);

  if (reminder.sound !== false) {
    beep(opts.beepTimes != null ? opts.beepTimes : 3);
  }
  if (reminder.popup) {
    openAlarmWindow(reminder);
  }
}

/**
 * 测试通知（设置页使用）。
 */
function testNotify() {
  systemNotify('⏰ 定时提醒', '这是一条测试通知，说明通知通道工作正常。');
  beep(1);
}

module.exports = { notify, testNotify, openAlarmWindow, systemNotify, beep };
