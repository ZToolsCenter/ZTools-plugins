/**
 * time-format.js —— 人性化时间格式化（UMD：preload / 渲染进程共用）
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.ZRTimeFormat = factory();
  }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var WEEK_CN = ['日', '一', '二', '三', '四', '五', '六'];
  var MIN = 60 * 1000;
  var HOUR = 60 * MIN;
  var DAY = 24 * HOUR;

  function pad2(n) {
    return (n < 10 ? '0' : '') + n;
  }

  function weekdayName(dateOrIndex) {
    var idx = typeof dateOrIndex === 'number' ? dateOrIndex : dateOrIndex.getDay();
    return '周' + WEEK_CN[idx];
  }

  function startOfDay(ts) {
    var d = new Date(ts);
    d.setHours(0, 0, 0, 0);
    return d.getTime();
  }

  function dayDiff(ts, now) {
    return Math.round((startOfDay(ts) - startOfDay(now)) / DAY);
  }

  /** 'HH:MM' */
  function formatClock(ts) {
    var d = new Date(ts);
    return pad2(d.getHours()) + ':' + pad2(d.getMinutes());
  }

  /** 'YYYY-MM-DD' */
  function formatDate(ts) {
    var d = new Date(ts);
    return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate());
  }

  /** 'YYYY-MM-DD HH:MM' */
  function formatDateTime(ts) {
    return formatDate(ts) + ' ' + formatClock(ts);
  }

  /** 'M月D日' 或 'YYYY年M月D日'（跨年时带年份） */
  function formatMonthDay(ts, now) {
    var d = new Date(ts);
    var prefix = '';
    if (now != null && d.getFullYear() !== new Date(now).getFullYear()) {
      prefix = d.getFullYear() + '年';
    }
    return prefix + (d.getMonth() + 1) + '月' + d.getDate() + '日';
  }

  /**
   * 相对描述：'3 分钟后' / '2 小时前' / '刚刚'
   */
  function formatRelative(ts, now) {
    now = now == null ? Date.now() : now;
    var diff = ts - now;
    var abs = Math.abs(diff);
    var suffix = diff >= 0 ? '后' : '前';
    if (abs < 10 * 1000) return '刚刚';
    if (abs < MIN) return Math.round(abs / 1000) + ' 秒' + suffix;
    if (abs < HOUR) return Math.round(abs / MIN) + ' 分钟' + suffix;
    if (abs < DAY) {
      var h = Math.floor(abs / HOUR);
      var m = Math.round((abs % HOUR) / MIN);
      return m > 0 ? h + ' 小时 ' + m + ' 分' + suffix : h + ' 小时' + suffix;
    }
    var days = Math.round(abs / DAY);
    if (days <= 30) return days + ' 天' + suffix;
    return Math.round(days / 30) + ' 个月' + suffix;
  }

  /**
   * 面向列表的友好时间：'今天 14:30（3 分钟后）' / '明天 09:00' / '周五 18:00' / '10月8日 14:30'
   */
  function formatHuman(ts, now) {
    now = now == null ? Date.now() : now;
    var diff = dayDiff(ts, now);
    var clock = formatClock(ts);
    var head;
    if (diff === 0) head = '今天';
    else if (diff === 1) head = '明天';
    else if (diff === 2) head = '后天';
    else if (diff === -1) head = '昨天';
    else if (diff > 2 && diff < 7) head = weekdayName(new Date(ts));
    else head = formatMonthDay(ts, now);
    return head + ' ' + clock;
  }

  /**
   * 倒计时 '1天 02:03:04' / '02:03:04' / '03:04'
   */
  function formatCountdown(ms) {
    if (ms < 0) ms = 0;
    var totalSec = Math.floor(ms / 1000);
    var d = Math.floor(totalSec / 86400);
    var h = Math.floor((totalSec % 86400) / 3600);
    var m = Math.floor((totalSec % 3600) / 60);
    var s = totalSec % 60;
    if (d > 0) return d + '天 ' + pad2(h) + ':' + pad2(m) + ':' + pad2(s);
    if (h > 0) return pad2(h) + ':' + pad2(m) + ':' + pad2(s);
    return pad2(m) + ':' + pad2(s);
  }

  /**
   * 重复规则描述：'每 30 分钟' / '每小时' / '每天 08:30' / '每周一、三、五 09:00' / '每月 5 日 09:00' / '工作日 09:00'
   */
  function formatRepeat(repeat) {
    repeat = repeat || {};
    switch (repeat.kind) {
      case 'interval':
        return '每 ' + (repeat.everyMinutes || 0) + ' 分钟';
      case 'hourly':
        return '每小时整点';
      case 'daily':
        return '每天 ' + (repeat.timeOfDay || '09:00');
      case 'workday':
        return '工作日 ' + (repeat.timeOfDay || '09:00');
      case 'weekly': {
        var names = (repeat.weekdays || []).map(function (n) {
          return WEEK_CN[n];
        });
        return '每周' + names.join('、') + ' ' + (repeat.timeOfDay || '09:00');
      }
      case 'monthly':
        return '每月 ' + (repeat.dayOfMonth || 1) + ' 日 ' + (repeat.timeOfDay || '09:00');
      default:
        return '不重复';
    }
  }

  return {
    WEEK_CN: WEEK_CN,
    pad2: pad2,
    weekdayName: weekdayName,
    startOfDay: startOfDay,
    dayDiff: dayDiff,
    formatClock: formatClock,
    formatDate: formatDate,
    formatDateTime: formatDateTime,
    formatMonthDay: formatMonthDay,
    formatRelative: formatRelative,
    formatHuman: formatHuman,
    formatCountdown: formatCountdown,
    formatRepeat: formatRepeat
  };
});
