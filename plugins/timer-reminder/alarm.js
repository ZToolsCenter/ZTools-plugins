/* alarm.js —— 置顶强提醒弹窗逻辑
 *
 * 该页面由 createBrowserWindow 打开，不加载插件 preload，
 * 因此直接通过 window.ztools.db 读写提醒文档（与 lib/store.js 同一前缀约定）。
 *
 * 防重复触发：弹窗打开时先把 nextRunAt 推后一个“稍后”周期，
 * 避免调度器在弹窗未处理期间每秒重复触发；按钮再写入最终状态。
 */
(function () {
  'use strict';

  var ITEM_PREFIX = 'reminder_item_';
  var SETTINGS_ID = 'reminder_settings';
  var Fmt = window.ZRTimeFormat;
  var Sched = window.ZRSchedule;

  var id = null;
  var doc = null;

  function db() {
    return window.ztools.db;
  }

  function readDoc(rid) {
    try {
      var d = db().get(rid);
      return d && d._id === rid ? d : null;
    } catch (e) {
      return null;
    }
  }

  function writeDoc(patch) {
    if (!doc) return null;
    var existing = readDoc(doc._id) || doc;
    var merged = Object.assign({}, existing, patch, { _id: doc._id, updatedAt: Date.now() });
    if (existing._rev) merged._rev = existing._rev;
    try {
      db().put(merged);
      doc = merged;
      return merged;
    } catch (e) {
      return null;
    }
  }

  function readSettings() {
    try {
      var s = db().get(SETTINGS_ID);
      return Object.assign({ snoozeMinutes: 10 }, (s && s.value) || {});
    } catch (e) {
      return { snoozeMinutes: 10 };
    }
  }

  function snoozeBy(minutes) {
    writeDoc({ nextRunAt: Date.now() + minutes * 60 * 1000, enabled: true, expiredAt: null });
    window.close();
  }

  function complete() {
    var now = Date.now();
    if (doc.mode === 'repeat') {
      var next = Sched.computeNextRun(
        { mode: 'repeat', repeat: doc.repeat, anchorAt: doc.anchorAt },
        now
      );
      writeDoc({ nextRunAt: next, enabled: next != null });
    } else {
      writeDoc({ nextRunAt: null, enabled: false, expiredAt: null });
    }
    window.close();
  }

  function init() {
    var params = new URLSearchParams(location.search);
    id = params.get('id');
    doc = id && id.indexOf(ITEM_PREFIX) === 0 ? readDoc(id) : null;

    if (!doc) {
      document.getElementById('alarmTitle').textContent = '提醒已不存在';
      document.getElementById('alarmTime').textContent = '该提醒可能已被删除或完成。';
      return;
    }

    // 先占位一个“稍后”周期，防止调度器在弹窗未处理时重复触发
    var settings = readSettings();
    if (typeof doc.nextRunAt === 'number' && doc.nextRunAt <= Date.now()) {
      writeDoc({ nextRunAt: Date.now() + settings.snoozeMinutes * 60 * 1000, enabled: true });
    }

    // 外部（主列表 / 其它窗口）处理了该提醒时自动关窗：
    // 删除 / 完成（enabled=false 或文档消失）立即关；稍后 / 编辑等写入
    // （_rev 变化且晚于本次占位写入 1s 以上）也关，避免残留空窗
    var openRev = doc._rev;
    var openAt = doc.updatedAt || 0;
    setInterval(function () {
      var cur = readDoc(id);
      if (!cur || cur.enabled === false) {
        window.close();
        return;
      }
      if (cur._rev !== openRev && (cur.updatedAt || 0) > openAt + 1000) window.close();
    }, 1000);

    document.getElementById('alarmTitle').textContent = doc.title || '提醒';
    var firedAt = doc.lastFiredAt || Date.now();
    document.getElementById('alarmTime').textContent =
      Fmt.formatHuman(firedAt, Date.now()) + (doc.mode === 'repeat' ? ' · ' + Fmt.formatRepeat(doc.repeat) : '');

    var noteEl = document.getElementById('alarmNote');
    if (doc.note) {
      noteEl.hidden = false;
      noteEl.textContent = doc.note;
    }

    document.getElementById('btnDone').addEventListener('click', complete);
    // 「稍后」时长跟随设置中的 snoozeMinutes，按钮文案同步更新
    var snoozeMins = Math.max(1, (settings.snoozeMinutes | 0) || 10);
    var snoozeBtn = document.getElementById('btnSnooze10');
    snoozeBtn.textContent = '稍后 ' + snoozeMins + ' 分钟';
    snoozeBtn.addEventListener('click', function () {
      snoozeBy(snoozeMins);
    });
    document.getElementById('btnSnooze60').addEventListener('click', function () {
      snoozeBy(60);
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
