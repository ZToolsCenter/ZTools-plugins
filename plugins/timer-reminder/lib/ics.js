/**
 * ics.js —— iCalendar（RFC 5545）导入 / 导出（preload 专用，CommonJS）
 *
 * 用途：与系统日历 / Outlook / Google Calendar 等互通，也作为跨设备迁移格式。
 *   - 导出：每条提醒一个 VEVENT；重复规则映射 RRULE；生效时段用 X-ACTIVE-WINDOW 自定义属性保留；
 *     附 VALARM（到点提醒）；已停用/完成的条目导出为 STATUS:CANCELLED。
 *   - 导入：解析 VEVENT（SUMMARY/DESCRIPTION/DTSTART/RRULE），RRULE 还原为内部 repeat 结构；
 *     YEARLY 等不支持的频率按无效跳过；已过期的单次事件导入为已完成。
 *
 * 时间统一以 UTC（…Z）写出，导入兼容 UTC / 本地 / 纯日期三种形式。
 */
'use strict';

const fs = require('node:fs');
const Schedule = require('./schedule.js');

const WD_ABBR = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA'];
const WD_NUM = { SU: 0, MO: 1, TU: 2, WE: 3, TH: 4, FR: 5, SA: 6 };

function pad2(n) {
  return (n < 10 ? '0' : '') + n;
}

/** 时间戳 -> ICS UTC 时间 'YYYYMMDDTHHMMSSZ' */
function icsUtc(ts) {
  const d = new Date(ts);
  return (
    d.getUTCFullYear() + pad2(d.getUTCMonth() + 1) + pad2(d.getUTCDate()) +
    'T' + pad2(d.getUTCHours()) + pad2(d.getUTCMinutes()) + pad2(d.getUTCSeconds()) + 'Z'
  );
}

function escText(s) {
  return String(s == null ? '' : s)
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\r?\n/g, '\\n');
}

function unescText(s) {
  return String(s == null ? '' : s)
    .replace(/\\n/gi, '\n')
    .replace(/\\,/g, ',')
    .replace(/\\;/g, ';')
    .replace(/\\\\/g, '\\');
}

/** 75 octets 折行（RFC 5545 §3.1），续行以单个空格开头 */
function foldLine(line) {
  const out = [];
  let cur = line;
  while (Buffer.byteLength(cur, 'utf8') > 75) {
    let cut = cur.length;
    while (cut > 1 && Buffer.byteLength(cur.slice(0, cut), 'utf8') > 75) cut--;
    out.push(cur.slice(0, cut));
    cur = ' ' + cur.slice(cut);
  }
  out.push(cur);
  return out.join('\r\n');
}

/* ------------------------------------------------------------------ *
 * 导出
 * ------------------------------------------------------------------ */

function buildRrule(repeat) {
  if (!repeat || !repeat.kind) return '';
  const parts = [];
  switch (repeat.kind) {
    case 'interval':
      parts.push('FREQ=MINUTELY', 'INTERVAL=' + (repeat.everyMinutes || 1));
      break;
    case 'hourly':
      parts.push('FREQ=HOURLY');
      break;
    case 'daily':
      parts.push('FREQ=DAILY');
      break;
    case 'weekly':
      parts.push('FREQ=WEEKLY', 'BYDAY=' + (repeat.weekdays || []).map((n) => WD_ABBR[n] || 'MO').join(','));
      break;
    case 'workday':
      parts.push('FREQ=WEEKLY', 'BYDAY=MO,TU,WE,TH,FR');
      break;
    case 'monthly':
      parts.push('FREQ=MONTHLY', 'BYMONTHDAY=' + (repeat.dayOfMonth || 1));
      break;
    default:
      return '';
  }
  // COUNT 与 UNTIL 互斥，次数优先
  if (parseInt(repeat.maxCount, 10) > 0) parts.push('COUNT=' + parseInt(repeat.maxCount, 10));
  else if (repeat.until) parts.push('UNTIL=' + icsUtc(repeat.until));
  return parts.join(';');
}

/**
 * 生成 ICS 文本。
 * @param {object[]} items 提醒文档数组
 */
function buildIcs(items) {
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//ZTools//Timer Reminder 1.3//CN',
    'CALSCALE:GREGORIAN'
  ];
  (items || []).forEach((item) => {
    const start =
      item.mode === 'repeat'
        ? item.nextRunAt || item.anchorAt || Date.now()
        : item.at || item.nextRunAt || Date.now();
    lines.push('BEGIN:VEVENT');
    lines.push('UID:' + item._id + '@ztools-reminder');
    lines.push('DTSTAMP:' + icsUtc(Date.now()));
    lines.push('DTSTART:' + icsUtc(start));
    lines.push('SUMMARY:' + escText(item.title || '提醒'));
    if (item.note) lines.push('DESCRIPTION:' + escText(item.note));
    if (item.mode === 'repeat') {
      const rr = buildRrule(item.repeat);
      if (rr) lines.push('RRULE:' + rr);
      if (item.repeat && item.repeat.activeFrom && item.repeat.activeTo) {
        lines.push('X-ACTIVE-WINDOW:' + item.repeat.activeFrom + '-' + item.repeat.activeTo);
      }
    }
    if (item.enabled === false) lines.push('STATUS:CANCELLED');
    lines.push('BEGIN:VALARM');
    lines.push('ACTION:DISPLAY');
    lines.push('DESCRIPTION:' + escText(item.title || '提醒'));
    lines.push('TRIGGER:-PT0M');
    lines.push('END:VALARM');
    lines.push('END:VEVENT');
  });
  lines.push('END:VCALENDAR');
  return lines.map(foldLine).join('\r\n') + '\r\n';
}

/* ------------------------------------------------------------------ *
 * 导入
 * ------------------------------------------------------------------ */

/** 解析 ICS 时间：UTC(…Z) / 本地 / 纯日期 / ISO 字符串 */
function parseIcsTime(v) {
  const s = String(v == null ? '' : v).trim();
  if (!s) return null;
  let m = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/.exec(s);
  if (m) return Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]);
  m = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})$/.exec(s);
  if (m) return new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]).getTime();
  m = /^(\d{4})(\d{2})(\d{2})$/.exec(s);
  if (m) return new Date(+m[1], +m[2] - 1, +m[3], 9, 0, 0, 0).getTime();
  const t = Date.parse(s);
  return isNaN(t) ? null : t;
}

/** 解析 RRULE 为内部 repeat 结构；不支持的频率返回 null */
function parseRrule(rr) {
  const map = {};
  String(rr || '')
    .split(';')
    .forEach((kv) => {
      const i = kv.indexOf('=');
      if (i > 0) map[kv.slice(0, i).toUpperCase()] = kv.slice(i + 1);
    });
  const freq = map.FREQ;
  if (!freq) return null;
  const repeat = {};
  if (freq === 'MINUTELY') {
    repeat.kind = 'interval';
    repeat.everyMinutes = Math.max(1, parseInt(map.INTERVAL, 10) || 1);
  } else if (freq === 'HOURLY') {
    repeat.kind = 'hourly';
  } else if (freq === 'DAILY') {
    repeat.kind = 'daily';
  } else if (freq === 'WEEKLY') {
    const days = String(map.BYDAY || '')
      .split(',')
      .map((s) => WD_NUM[s.trim().toUpperCase().replace(/^-?\d+/, '')])
      .filter((n) => n != null && !isNaN(n));
    const isWorkday =
      days.length === 5 && [1, 2, 3, 4, 5].every((n) => days.indexOf(n) !== -1);
    if (isWorkday) {
      repeat.kind = 'workday';
    } else {
      repeat.kind = 'weekly';
      repeat.weekdays = days;
    }
  } else if (freq === 'MONTHLY') {
    repeat.kind = 'monthly';
    repeat.dayOfMonth = Math.min(31, Math.max(1, parseInt(map.BYMONTHDAY, 10) || 1));
  } else {
    return null; // YEARLY 等不支持
  }
  if (parseInt(map.COUNT, 10) > 0) repeat.maxCount = parseInt(map.COUNT, 10);
  if (map.UNTIL) {
    const u = parseIcsTime(map.UNTIL);
    if (u) repeat.until = u;
  }
  return repeat;
}

/** 解析 ICS 文本为事件数组 */
function parseIcs(text) {
  // unfold：CRLF + 单个空白 的续行拼回
  const unfolded = String(text == null ? '' : text).replace(/\r?\n[ \t]/g, '');
  const lines = unfolded.split(/\r?\n/);
  const events = [];
  let cur = null;
  let inAlarm = false;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!line) continue;
    const idx = line.indexOf(':');
    if (idx < 0) continue;
    let name = line.slice(0, idx);
    const value = line.slice(idx + 1);
    const semi = name.indexOf(';');
    if (semi >= 0) name = name.slice(0, semi); // 去掉 TZID 等参数
    name = name.toUpperCase();
    const upperVal = value.toUpperCase();
    if (name === 'BEGIN' && upperVal === 'VEVENT') {
      cur = {};
      inAlarm = false;
      continue;
    }
    if (name === 'BEGIN' && upperVal === 'VALARM') {
      inAlarm = true;
      continue;
    }
    if (name === 'END' && upperVal === 'VALARM') {
      inAlarm = false;
      continue;
    }
    if (name === 'END' && upperVal === 'VEVENT') {
      if (cur) events.push(cur);
      cur = null;
      continue;
    }
    if (!cur || inAlarm) continue;
    if (name === 'SUMMARY') cur.title = unescText(value);
    else if (name === 'DESCRIPTION') cur.note = unescText(value);
    else if (name === 'DTSTART') cur.dtstart = value;
    else if (name === 'RRULE') cur.rrule = value;
    else if (name === 'X-ACTIVE-WINDOW') cur.activeWindow = value;
    else if (name === 'STATUS') cur.status = upperVal;
  }
  return events;
}

/**
 * 事件数组 -> createReminder 数据数组。
 * @returns {{ok:boolean, items:object[], report:object}}
 */
function eventsToItems(events, now) {
  now = now == null ? Date.now() : now;
  const items = [];
  const report = { total: (events || []).length, added: 0, expiredKept: 0, doneKept: 0, skippedInvalid: 0 };
  (events || []).forEach((ev) => {
    const title = String(ev.title || '').trim();
    if (!title) {
      report.skippedInvalid++;
      return;
    }
    const start = parseIcsTime(ev.dtstart);
    if (start == null || !isFinite(start)) {
      report.skippedInvalid++;
      return;
    }
    const data = {
      title: title,
      note: ev.note || '',
      sound: true,
      popup: false,
      enabled: ev.status !== 'CANCELLED'
    };
    if (ev.rrule) {
      const repeat = parseRrule(ev.rrule);
      if (!repeat) {
        report.skippedInvalid++;
        return;
      }
      const d = new Date(start);
      const hm = Schedule.pad2(d.getHours()) + ':' + Schedule.pad2(d.getMinutes());
      if (repeat.kind !== 'interval' && repeat.kind !== 'hourly') repeat.timeOfDay = hm;
      if (ev.activeWindow) {
        const aw = /^(\d{1,2}:\d{2})-(\d{1,2}:\d{2})$/.exec(String(ev.activeWindow).trim());
        if (aw) {
          repeat.activeFrom = aw[1];
          repeat.activeTo = aw[2];
        }
      }
      const norm = Schedule.normalizeRepeat(repeat);
      const next = Schedule.computeNextRun({ mode: 'repeat', repeat: norm, anchorAt: start }, now);
      data.mode = 'repeat';
      data.repeat = norm;
      data.at = null;
      if (next == null) {
        // 已过 until / 无后续触发：规则已结束，导入为已完成保留记录
        data.nextRunAt = null;
        data.enabled = false;
        report.doneKept++;
      } else {
        data.nextRunAt = next;
      }
    } else {
      data.mode = 'once';
      data.at = start;
      data.repeat = null;
      if (start <= now) {
        if (data.enabled === false) {
          report.doneKept++;
        } else {
          // 到期未处理：留在待提醒并标记「已过期未处理」
          data.nextRunAt = null;
          data.expiredAt = start;
          report.expiredKept++;
        }
      } else {
        data.nextRunAt = start;
      }
    }
    report.added++;
    items.push(data);
  });
  return { ok: true, items: items, report: report };
}

/* ------------------------------------------------------------------ *
 * 文件 IO
 * ------------------------------------------------------------------ */

function writeIcsFile(filePath, items) {
  fs.writeFileSync(filePath, buildIcs(items), 'utf8');
  return filePath;
}

function readIcsFile(filePath) {
  return fs.readFileSync(filePath, 'utf8');
}

module.exports = {
  buildIcs,
  parseIcs,
  buildRrule,
  parseRrule,
  parseIcsTime,
  eventsToItems,
  writeIcsFile,
  readIcsFile,
  foldLine,
  escText,
  unescText
};
