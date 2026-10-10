/**
 * schedule.js —— 下次触发时间计算（UMD：preload / 渲染进程共用）
 *
 * 提醒数据模型（spec）：
 *   {
 *     mode: 'once' | 'repeat',
 *     at:    number,              // mode=once 时的触发时间戳(ms)
 *     repeat: {
 *       kind: 'interval' | 'hourly' | 'daily' | 'weekly' | 'workday' | 'monthly',
 *       everyMinutes: number,     // kind=interval
 *       timeOfDay: 'HH:MM',       // kind=daily|weekly|workday|monthly
 *       weekdays: number[],       // kind=weekly，0=周日
 *       dayOfMonth: number,       // kind=monthly
 *     },
 *     anchorAt: number            // kind=interval 的对齐基准（可选）
 *   }
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.ZRSchedule = factory();
  }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var MIN = 60 * 1000;
  var DAY = 24 * 60 * MIN;

  function parseHM(str) {
    var m = /^(\d{1,2}):(\d{1,2})$/.exec(String(str || '').trim());
    if (!m) return null;
    var h = parseInt(m[1], 10);
    var mi = parseInt(m[2], 10);
    if (h < 0 || h > 23 || mi < 0 || mi > 59) return null;
    return { h: h, m: mi };
  }

  function pad2(n) {
    return (n < 10 ? '0' : '') + n;
  }

  function matchesDay(repeat, date) {
    var wd = date.getDay();
    switch (repeat.kind) {
      case 'daily':
        return true;
      case 'workday':
        return wd >= 1 && wd <= 5;
      case 'weekly':
        return (repeat.weekdays || []).indexOf(wd) !== -1;
      case 'monthly':
        return date.getDate() === (parseInt(repeat.dayOfMonth, 10) || 0);
      default:
        return false;
    }
  }

  /**
   * 计算 fromTs 之后的下一次触发时间；无后续触发返回 null。
   */
  function computeNextRun(spec, fromTs) {
    var from = fromTs == null ? Date.now() : fromTs;
    spec = spec || {};

    if (spec.mode !== 'repeat') {
      var at = Number(spec.at);
      return isFinite(at) && at > from ? at : null;
    }

    var repeat = spec.repeat || {};
    switch (repeat.kind) {
      case 'interval': {
        var step = Math.max(1, parseInt(repeat.everyMinutes, 10) || 1) * MIN;
        var base = Number(spec.anchorAt);
        if (!isFinite(base) || base > from) base = from;
        var next = base + step;
        // 跳过已经过期的周期，避免补发一串过期提醒
        var guard = 0;
        while (next <= from && guard++ < 100000) next += step;
        return next;
      }
      case 'hourly': {
        var d = new Date(from);
        d.setMinutes(0, 0, 0);
        d.setHours(d.getHours() + 1);
        return d.getTime();
      }
      case 'daily':
      case 'weekly':
      case 'workday':
      case 'monthly': {
        var hm = parseHM(repeat.timeOfDay) || { h: 9, m: 0 };
        var baseDate = new Date(from);
        for (var i = 0; i < 400; i++) {
          var day = new Date(
            baseDate.getFullYear(),
            baseDate.getMonth(),
            baseDate.getDate() + i,
            hm.h,
            hm.m,
            0,
            0
          );
          var ts = day.getTime();
          if (ts <= from) continue;
          if (matchesDay(repeat, day)) return ts;
        }
        return null;
      }
      default:
        return null;
    }
  }

  /**
   * 把 repeat 配置规整化（补默认值、排序等），返回新对象。
   */
  function normalizeRepeat(repeat) {
    var r = Object.assign({}, repeat || {});
    switch (r.kind) {
      case 'interval':
        r.everyMinutes = Math.max(1, parseInt(r.everyMinutes, 10) || 30);
        break;
      case 'hourly':
        break;
      case 'daily':
      case 'workday':
        r.timeOfDay = (parseHM(r.timeOfDay) ? r.timeOfDay : '09:00');
        break;
      case 'weekly': {
        var list = (r.weekdays || []).map(Number).filter(function (n) {
          return n >= 0 && n <= 6;
        });
        list = list.filter(function (n, idx) {
          return list.indexOf(n) === idx;
        }).sort(function (a, b) {
          return a - b;
        });
        if (!list.length) list = [new Date().getDay()];
        r.weekdays = list;
        r.timeOfDay = (parseHM(r.timeOfDay) ? r.timeOfDay : '09:00');
        break;
      }
      case 'monthly':
        r.dayOfMonth = Math.min(31, Math.max(1, parseInt(r.dayOfMonth, 10) || 1));
        r.timeOfDay = (parseHM(r.timeOfDay) ? r.timeOfDay : '09:00');
        break;
      default:
        r.kind = 'daily';
        r.timeOfDay = '09:00';
    }
    return r;
  }

  return {
    MIN: MIN,
    DAY: DAY,
    parseHM: parseHM,
    pad2: pad2,
    computeNextRun: computeNextRun,
    normalizeRepeat: normalizeRepeat,
    matchesDay: matchesDay
  };
});
