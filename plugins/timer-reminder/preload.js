/**
 * preload.js —— 插件预加载入口（CommonJS，ZTools 在渲染进程注入 Node 能力）
 *
 * 职责：
 *   1. 组装各模块，向渲染进程暴露 window.reminder 桥接 API；
 *   2. 启动后台调度器（仅主窗口 / 分离窗口参与，弹窗浏览器窗口不参与）。
 *
 * 注意：按 ZTools 规范，preload 及其依赖必须保持源码清晰可读，不得压缩混淆。
 */
'use strict';

const Schedule = require('./lib/schedule.js');
const TimeParse = require('./lib/time-parse.js');
const TimeFormat = require('./lib/time-format.js');
const store = require('./lib/store.js');
const notifier = require('./lib/notifier.js');
const scheduler = require('./lib/scheduler.js');
const ImportExport = require('./lib/import-export.js');
const Ics = require('./lib/ics.js');
const channels = require('./lib/channels.js');
const llm = require('./lib/llm.js');
const Holidays = require('./lib/holidays.js');

/* ------------------------------------------------------------------ *
 * 渲染进程桥接 API
 * ------------------------------------------------------------------ */

window.reminder = {
  /** 全部提醒（已排序） */
  list() {
    return store.listReminders();
  },

  get(id) {
    return store.getReminder(id);
  },

  /** 新建提醒，data 见 lib/store.js createReminder */
  create(data) {
    const doc = store.createReminder(data);
    scheduler.tick(); // 立即对齐一次状态
    return doc;
  },

  /** 局部更新 */
  update(id, patch) {
    const doc = store.updateReminder(id, patch);
    if (doc) scheduler.tick();
    return doc;
  },

  remove(id) {
    const ok = store.removeReminder(id);
    if (ok) scheduler.tick();
    return ok;
  },

  setEnabled(id, enabled) {
    return store.updateReminder(id, { enabled: !!enabled });
  },

  /** 稍后提醒 */
  snooze(id, minutes) {
    return scheduler.snooze(id, minutes);
  },

  /** 完成（单次）/ 跳过本次（重复） */
  complete(id) {
    return scheduler.complete(id);
  },

  /** 自然语言解析（供界面实时预览） */
  parse(text) {
    return TimeParse.parse(text);
  },

  settings: {
    get() {
      return store.getSettings();
    },
    set(patch) {
      return store.setSettings(patch);
    }
  },

  status() {
    return scheduler.status();
  },

  /** 订阅调度事件：{type:'fired'|'changed'|'started', ...} */
  onEvent(callback) {
    return scheduler.on(callback);
  },

  testNotify() {
    notifier.testNotify();
  },

  /** 手动触发一次扫描（调试用） */
  tickNow() {
    scheduler.tick();
  },

  /* ---------------- 触发历史 ---------------- */
  history: {
    /** 最近触发记录（最新在前，最多 100 条） */
    list() {
      return store.getHistory();
    },
    /** 清空触发记录 */
    clear() {
      store.clearHistory();
    }
  },

  /* ---------------- 导入 / 导出（Excel） ---------------- */
  data: {
    /** 导出到 Excel 文件；filter: 'all' | 'active' | 'done' */
    exportToFile(filter) {
      const rows = ImportExport.buildExportRows(store.listReminders(), filter || 'done');
      if (rows.length <= 1) return { ok: false, error: '没有可导出的提醒' };
      let filePath;
      try {
        filePath = window.ztools.showSaveDialog({
          defaultPath: 'reminders-' + TimeFormat.formatDate(Date.now()) + '.xlsx',
          filters: [{ name: 'Excel', extensions: ['xlsx'] }]
        });
      } catch (e) {
        return { ok: false, error: String((e && e.message) || e) };
      }
      if (!filePath) return { ok: false, cancelled: true };
      try {
        ImportExport.writeXlsxFile(filePath, rows);
      } catch (e) {
        return { ok: false, error: '写入失败: ' + String((e && e.message) || e) };
      }
      return { ok: true, path: filePath, count: rows.length - 1 };
    },

    /** 从 Excel 文件导入（合并，不删除现有数据） */
    importFromFile() {
      let paths;
      try {
        paths = window.ztools.showOpenDialog({
          properties: ['openFile'],
          filters: [{ name: 'Excel', extensions: ['xlsx'] }]
        });
      } catch (e) {
        return { ok: false, error: String((e && e.message) || e) };
      }
      if (!paths || !paths.length) return { ok: false, cancelled: true };
      let rows;
      try {
        rows = ImportExport.readXlsxFile(paths[0]);
      } catch (e) {
        return { ok: false, error: '文件读取/解析失败: ' + String((e && e.message) || e) };
      }
      const plan = ImportExport.rowsToItems(rows);
      if (!plan.ok) return plan;
      plan.items.forEach((d) => store.createReminder(d));
      scheduler.tick();
      return { ok: true, path: paths[0], report: plan.report };
    },

    /** 导出到 ICS 日历文件；filter: 'all' | 'active' | 'done' */
    exportIcsToFile(filter) {
      const list = store.listReminders().filter((i) => {
        if (filter === 'active') return i.enabled !== false;
        if (filter === 'done') return i.enabled === false;
        return true;
      });
      if (!list.length) return { ok: false, error: '没有可导出的提醒' };
      let filePath;
      try {
        filePath = window.ztools.showSaveDialog({
          defaultPath: 'reminders-' + TimeFormat.formatDate(Date.now()) + '.ics',
          filters: [{ name: 'iCalendar', extensions: ['ics'] }]
        });
      } catch (e) {
        return { ok: false, error: String((e && e.message) || e) };
      }
      if (!filePath) return { ok: false, cancelled: true };
      try {
        Ics.writeIcsFile(filePath, list);
      } catch (e) {
        return { ok: false, error: '写入失败: ' + String((e && e.message) || e) };
      }
      return { ok: true, path: filePath, count: list.length };
    },

    /** 从 ICS 日历文件导入（合并） */
    importIcsFile() {
      let paths;
      try {
        paths = window.ztools.showOpenDialog({
          properties: ['openFile'],
          filters: [
            { name: 'iCalendar', extensions: ['ics'] },
            { name: '文本文件', extensions: ['txt'] }
          ]
        });
      } catch (e) {
        return { ok: false, error: String((e && e.message) || e) };
      }
      if (!paths || !paths.length) return { ok: false, cancelled: true };
      let text;
      try {
        text = Ics.readIcsFile(paths[0]);
      } catch (e) {
        return { ok: false, error: '文件读取失败: ' + String((e && e.message) || e) };
      }
      let events;
      try {
        events = Ics.parseIcs(text);
      } catch (e) {
        return { ok: false, error: '文件解析失败: ' + String((e && e.message) || e) };
      }
      if (!events.length) return { ok: false, error: '文件中没有找到日历事件（VEVENT）' };
      const plan = Ics.eventsToItems(events);
      plan.items.forEach((d) => store.createReminder(d));
      scheduler.tick();
      return { ok: true, path: paths[0], report: plan.report };
    }
  },

  /* ---------------- 额外提醒通道 ---------------- */
  channels: {
    presets: channels.WEBHOOK_PRESETS,
    get() {
      return store.getSettings().channels;
    },
    set(patch) {
      const next = store.setSettings({
        channels: Object.assign({}, store.getSettings().channels, patch)
      });
      return next.channels;
    },
    async test(kind) {
      try {
        await channels.testChannel(kind, store.getSettings(), store.getSecrets());
        return { ok: true };
      } catch (e) {
        return { ok: false, error: String((e && e.message) || e) };
      }
    }
  },

  /* ---------------- 密钥（只写不读） ---------------- */
  secrets: {
    /** 仅写入非空字段；返回各密钥是否已保存 */
    set(patch) {
      const clean = {};
      Object.keys(patch || {}).forEach((k) => {
        if (patch[k] !== '' && patch[k] != null) clean[k] = patch[k];
      });
      store.setSecrets(clean);
      return this.has();
    },
    has() {
      const s = store.getSecrets();
      return {
        smtpPass: !!s.smtpPass,
        smsbaoKey: !!s.smsbaoKey,
        llmApiKey: !!s.llmApiKey
      };
    }
  },

  /* ---------------- 大语言模型 ---------------- */
  llm: {
    presets: llm.PRESETS,
    get() {
      return store.getSettings().llm;
    },
    set(patch) {
      const next = store.setSettings({ llm: Object.assign({}, store.getSettings().llm, patch) });
      return next.llm;
    },
    async test() {
      try {
        const reply = await llm.testConnection(store.getSettings().llm, store.getSecrets().llmApiKey);
        return { ok: true, reply: reply };
      } catch (e) {
        return { ok: false, error: String((e && e.message) || e) };
      }
    },
    /** 智能解析（规则解析失败时的兑底） */
    async parse(text) {
      try {
        return await llm.parseText(text, store.getSettings().llm, store.getSecrets().llmApiKey);
      } catch (e) {
        return { ok: false, error: String((e && e.message) || e) };
      }
    }
  },

  format: TimeFormat,
  schedule: Schedule,
  holidays: Holidays
};

/* ------------------------------------------------------------------ *
 * 启动调度器
 * ------------------------------------------------------------------ */

// 弹窗（createBrowserWindow 创建的 browser 窗口）不承担调度职责
try {
  if (window.ztools.getWindowType() !== 'browser') {
    scheduler.start();

    // 可见性感知调度：ZTools 隐藏插件视图时缓存保留（进程存活），
    // 若不降频，每个缓存的隐藏视图都会持续每秒向主进程发起同步 IPC，
    // 打开的插件视图越多，主进程压力越大（ZTools 卡顿的根源之一）。
    // 隐藏 → 调度降频 60s（触发误差 ≤60s）；重新进入 → 恢复 1s 并立即对齐。
    try {
      if (typeof window.ztools.onPluginOut === 'function') {
        window.ztools.onPluginOut(function (isKill) {
          if (isKill) {
            scheduler.stop();
          } else {
            scheduler.setVisibility(false);
          }
        });
      }
    } catch (e) {
      /* 生命周期事件不可用时保持默认 1s 调度 */
    }
    try {
      if (typeof window.ztools.onPluginEnter === 'function') {
        window.ztools.onPluginEnter(function () {
          scheduler.setVisibility(true);
        });
      }
    } catch (e) {
      /* 忽略 */
    }
    // 兜底：以 document 可见性变化作为第二信号
    try {
      document.addEventListener('visibilitychange', function () {
        scheduler.setVisibility(!document.hidden);
      });
    } catch (e) {
      /* 忽略 */
    }
  }
} catch (e) {
  scheduler.start();
}
