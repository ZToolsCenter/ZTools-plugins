/**
 * import-export.js —— 提醒列表 Excel（xlsx）导入 / 导出（preload 专用，CommonJS）
 *
 * 导出为单工作表 xlsx，列定义（表头）：
 *   提醒内容 | 类型 | 提醒时间 | 重复类型 | 间隔分钟 | 星期 | 每月几号 | 备注 | 状态 | 响铃 | 弹窗强提醒
 *
 * 各列约定：
 *   - 类型：单次 / 重复
 *   - 提醒时间：单次为 "YYYY-MM-DD HH:mm"（文本）；重复为 "HH:mm"（每日/每周/工作日/每月）
 *   - 重复类型：间隔 / 每小时 / 每天 / 每周 / 工作日 / 每月
 *   - 星期：1,3,5（0=周日）；状态：待提醒 / 已完成；响铃、弹窗强提醒：是 / 否
 *
 * 导入兼容手工在 Excel 中编辑的文件：表头行需含「提醒内容」列；
 * 真实 Excel 的 sharedStrings 单元格与日期序列号单元格均可被解析。
 */
'use strict';

const fs = require('node:fs');
const Schedule = require('./schedule.js');
const TimeFormat = require('./time-format.js');
const Xlsx = require('./xlsx.js');

const COLUMNS = ['提醒内容', '类型', '提醒时间', '重复类型', '间隔分钟', '星期', '每月几号', '备注', '状态', '响铃', '弹窗强提醒'];
const SHEET_NAME = '提醒列表';

const KIND_LABELS = {
  interval: '间隔',
  hourly: '每小时',
  daily: '每天',
  weekly: '每周',
  workday: '工作日',
  monthly: '每月'
};
const KIND_BY_LABEL = (() => {
  const map = {};
  Object.keys(KIND_LABELS).forEach((k) => {
    map[KIND_LABELS[k]] = k;
  });
  return map;
})();

/* ------------------------------------------------------------------ *
 * 导出：条目 -> 行
 * ------------------------------------------------------------------ */

function itemToRow(item) {
  const row = [];
  row.push(item.title || '');
  if (item.mode === 'repeat' && item.repeat) {
    const r = item.repeat;
    row.push('重复');
    row.push(r.timeOfDay || ''); // 间隔 / 每小时 无每日时间
    row.push(KIND_LABELS[r.kind] || '');
    row.push(r.kind === 'interval' ? r.everyMinutes || '' : '');
    row.push(r.kind === 'weekly' ? (r.weekdays || []).join(',') : '');
    row.push(r.kind === 'monthly' ? r.dayOfMonth || '' : '');
  } else {
    row.push('单次');
    row.push(item.at ? TimeFormat.formatDateTime(item.at) : '');
    row.push('');
    row.push('');
    row.push('');
    row.push('');
  }
  row.push(item.note || '');
  row.push(item.enabled === false ? '已完成' : '待提醒');
  row.push(item.sound === false ? '否' : '是');
  row.push(item.popup ? '是' : '否');
  return row;
}

/**
 * 由提醒文档数组生成导出行（含表头）。
 * @param {object[]} items
 * @param {'all'|'active'|'done'} filter
 */
function buildExportRows(items, filter) {
  const list = (items || []).filter((i) => {
    if (filter === 'active') return i.enabled !== false;
    if (filter === 'done') return i.enabled === false;
    return true;
  });
  const rows = [COLUMNS.slice()];
  list.forEach((i) => rows.push(itemToRow(i)));
  return rows;
}

/* ------------------------------------------------------------------ *
 * 导入：行 -> 数据
 * ------------------------------------------------------------------ */

/** Excel 日期序列号（1900 日期系统）-> 时间戳（毫秒） */
function serialToTimestamp(n) {
  const ms = Math.round((Number(n) - 25569) * 86400000);
  return isFinite(ms) ? ms : null;
}

function parseOnceAt(cell) {
  if (cell == null || cell === '') return null;
  if (typeof cell === 'number') {
    // 用户在 Excel 里输入日期/时间会变成序列号
    if (cell > 20000) return serialToTimestamp(cell);
    return null;
  }
  const s = String(cell).trim();
  const m = /^(\d{4})[-/](\d{1,2})[-/](\d{1,2})[ T](\d{1,2}):(\d{2})/.exec(s);
  if (m) {
    const ts = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), Number(m[4]), Number(m[5]), 0, 0).getTime();
    return isFinite(ts) ? ts : null;
  }
  const t = Date.parse(s);
  return isNaN(t) ? null : t;
}

function cellText(cell) {
  return cell == null ? '' : String(cell).trim();
}

function cellNumber(cell) {
  const n = Number(cellText(cell));
  return isFinite(n) && cellText(cell) !== '' ? n : null;
}

/**
 * 把 xlsx 行数据解析为待创建的数据数组与统计。
 * 自动定位表头行（第一列为「提醒内容」）。
 * @param {Array<Array<string|number>>} rows
 * @param {number} now
 */
function rowsToItems(rows, now) {
  now = now == null ? Date.now() : now;
  if (!Array.isArray(rows) || !rows.length) {
    return { ok: false, error: '文件内容为空', items: [], report: null };
  }

  // 定位表头：前 10 行内找到第一列为「提醒内容」的行
  let headerIdx = -1;
  for (let i = 0; i < Math.min(10, rows.length); i++) {
    if (cellText(rows[i][0]) === '提醒内容') {
      headerIdx = i;
      break;
    }
  }
  if (headerIdx < 0) {
    return { ok: false, error: '未找到表头（第一列应为「提醒内容」）', items: [], report: null };
  }

  const items = [];
  const report = { total: rows.length - headerIdx - 1, added: 0, skippedExpired: 0, skippedInvalid: 0 };

  for (let i = headerIdx + 1; i < rows.length; i++) {
    const src = rows[i] || [];
    const title = cellText(src[0]);
    if (!title) {
      // 完全空行不计数
      if (src.every((c) => c == null || cellText(c) === '')) continue;
      report.skippedInvalid++;
      continue;
    }

    const data = {
      title: title,
      note: cellText(src[7]),
      sound: cellText(src[9]) !== '否',
      popup: cellText(src[10]) === '是',
      enabled: cellText(src[8]) !== '已完成'
    };

    const type = cellText(src[1]);
    if (type === '重复') {
      const kind = KIND_BY_LABEL[cellText(src[3])] || null;
      const repeat = { kind: kind };
      if (kind === 'interval') {
        const everyMinutes = cellNumber(src[4]);
        if (!everyMinutes || everyMinutes < 1) {
          report.skippedInvalid++;
          continue;
        }
        repeat.everyMinutes = Math.round(everyMinutes);
      } else if (kind === 'monthly') {
        const dayOfMonth = cellNumber(src[6]);
        if (!dayOfMonth || dayOfMonth < 1 || dayOfMonth > 31) {
          report.skippedInvalid++;
          continue;
        }
        repeat.dayOfMonth = Math.round(dayOfMonth);
        repeat.timeOfDay = cellText(src[2]) || '09:00';
      } else if (kind === 'hourly') {
        /* 无额外字段 */
      } else if (kind === 'daily' || kind === 'workday') {
        repeat.timeOfDay = cellText(src[2]) || '09:00';
      } else if (kind === 'weekly') {
        repeat.timeOfDay = cellText(src[2]) || '09:00';
        const weekdays = cellText(src[5])
          .split(/[,，\s]+/)
          .map((s) => parseInt(s, 10))
          .filter((n) => !isNaN(n) && n >= 0 && n <= 6);
        if (!weekdays.length) {
          report.skippedInvalid++;
          continue;
        }
        repeat.weekdays = weekdays;
      } else {
        report.skippedInvalid++;
        continue;
      }

      const norm = Schedule.normalizeRepeat(repeat);
      const next = Schedule.computeNextRun({ mode: 'repeat', repeat: norm }, now);
      if (next == null) {
        report.skippedInvalid++;
        continue;
      }
      data.mode = 'repeat';
      data.repeat = norm;
      data.at = null;
      data.nextRunAt = next;
    } else {
      const at = parseOnceAt(src[2]);
      if (at == null || !isFinite(at) || at <= 0) {
        report.skippedInvalid++;
        continue;
      }
      data.mode = 'once';
      data.at = at;
      data.nextRunAt = at;
      data.repeat = null;
      // 已过期的单次提醒导入后不再补发，直接归入已完成
      if (at <= now) {
        data.enabled = false;
        report.skippedExpired++;
      }
    }
    report.added++;
    items.push(data);
  }

  return { ok: true, items: items, report: report };
}

/* ------------------------------------------------------------------ *
 * 文件 IO
 * ------------------------------------------------------------------ */

function writeXlsxFile(filePath, rows) {
  return Xlsx.writeFile(filePath, SHEET_NAME, rows);
}

function readXlsxFile(filePath) {
  return Xlsx.readFile(filePath);
}

module.exports = {
  COLUMNS,
  SHEET_NAME,
  itemToRow,
  buildExportRows,
  rowsToItems,
  serialToTimestamp,
  writeXlsxFile,
  readXlsxFile
};
