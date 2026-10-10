/**
 * time-parse.js —— 自然语言时间解析（UMD：preload / 渲染进程共用）
 *
 * 支持示例：
 *   10分钟后 喝水            -> 单次，+10 分钟
 *   半小时后 站立活动        -> 单次，+30 分钟
 *   明天 9点 开会            -> 单次，明日 09:00
 *   15:30 提交周报           -> 单次，今日 15:30（已过则顺延到明天）
 *   周五 18:00 下班          -> 单次，本/下周五 18:00
 *   10月20日 9点 交材料      -> 单次，指定日期
 *   每30分钟 喝水            -> 重复，间隔 30 分钟
 *   每天 8:30 吃药           -> 重复，每日
 *   工作日 9:00 站会         -> 重复，周一至周五
 *   每周一三五 9:00 例会     -> 重复，指定星期
 *   每月5号 10:00 还信用卡   -> 重复，指定日期
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory(require('./schedule.js'));
  } else {
    root.ZRTimeParse = factory(root.ZRSchedule);
  }
})(typeof self !== 'undefined' ? self : this, function (Schedule) {
  'use strict';

  var MIN = 60 * 1000;
  var HOUR = 60 * MIN;
  var DAY = 24 * HOUR;

  var CN_DIGIT = { '零': 0, '一': 1, '二': 2, '两': 2, '三': 3, '四': 4, '五': 5, '六': 6, '七': 7, '八': 8, '九': 9 };
  var CN_WEEK = { '日': 0, '天': 0, '一': 1, '二': 2, '三': 3, '四': 4, '五': 5, '六': 6 };

  /** 中文数字转阿拉伯数字（支持 一 ~ 九十九） */
  function cnToNum(str) {
    str = String(str == null ? '' : str).trim();
    if (/^\d+$/.test(str)) return parseInt(str, 10);
    if (CN_DIGIT[str] != null) return CN_DIGIT[str];
    if (str === '十') return 10;
    var idx = str.indexOf('十');
    if (idx === -1) return NaN;
    var tens = idx === 0 ? 1 : (CN_DIGIT[str.charAt(0)] || 0);
    var ones = idx === str.length - 1 ? 0 : (CN_DIGIT[str.charAt(idx + 1)] || 0);
    return tens * 10 + ones;
  }

  /** 全角数字/冒号转半角、压缩空白 */
  function normalize(text) {
    return String(text == null ? '' : text)
      .replace(/[\uFF10-\uFF19]/g, function (c) {
        return String.fromCharCode(c.charCodeAt(0) - 0xFEE0);
      })
      .replace(/\uFF1A/g, ':')
      .replace(/[\s　]+/g, ' ')
      .trim();
  }

  /** 去掉“提醒我 / 提醒一下 / remind me”等引导词 */
  function stripVerbs(text) {
    var out = text.replace(/^(请|帮我|帮忙|麻烦)?\s*(提醒我|提醒一下|提醒|remind\s*me|remind)\s*[:：,，]?\s*/i, '');
    out = out.replace(/\s*(提醒我|提醒一下)\s*/g, ' ');
    return out.replace(/[\s　]+/g, ' ').trim();
  }

  function fail(message) {
    return { ok: false, error: message };
  }

  /**
   * 解析入口。
   * @param {string} text 原始文本
   * @param {number} [now] 当前时间戳，便于测试注入
   * @returns {{ok:boolean, title?:string, mode?:string, at?:number, repeat?:object, nextRunAt?:number, matched?:string, error?:string}}
   */
  function parse(text, now) {
    now = now == null ? Date.now() : now;
    var work = stripVerbs(normalize(text));
    if (!work) return fail('请输入提醒内容，例如「10分钟后 喝水」');

    var consumed = [];
    function take(matched) {
      if (matched) consumed.push(matched);
    }
    function cut(re) {
      var m = re.exec(work);
      if (!m) return null;
      take(m[0]);
      work = work.slice(0, m.index) + ' ' + work.slice(m.index + m[0].length);
      return m;
    }

    var repeat = null;
    var relMs = null;
    var dateInfo = null; // {kind:'offset', days} | {kind:'weekday', weekday, weekOffset} | {kind:'abs', y, m, d}
    var timeInfo = null; // {h, m}
    var meridiem = null;

    /* ---------- 1. 上午/下午等时段词 ---------- */
    var mMer = cut(/(上午|早上|早晨|清晨|中午|下午|傍晚|晚上|夜里|凌晨)/);
    if (mMer) meridiem = mMer[1];

    /* ---------- 2. 重复规则 ---------- */
    var m;
    if ((m = cut(/每\s*([0-9]+|[一二两三四五六七八九十]+)\s*(?:个\s*)?(?:分钟|分)(?!钟)/))) {
      repeat = { kind: 'interval', everyMinutes: cnToNum(m[1]) };
    } else if ((m = cut(/每\s*([0-9]+|[一二两三四五六七八九十]+)\s*(?:个\s*)?(?:小时|钟头)/))) {
      repeat = { kind: 'interval', everyMinutes: cnToNum(m[1]) * 60 };
    } else if ((m = cut(/每\s*半\s*(?:小时|钟头)/))) {
      repeat = { kind: 'interval', everyMinutes: 30 };
    } else if ((m = cut(/每\s*(?:个\s*)?小时/))) {
      repeat = { kind: 'hourly' };
    } else if ((m = cut(/每月\s*([0-9]+|[一二三四五六七八九十]+)\s*[日号]/))) {
      repeat = { kind: 'monthly', dayOfMonth: cnToNum(m[1]) };
    } else if ((m = cut(/(?:每周|每星期|每礼拜)\s*((?:[一二三四五六日天0-7]\s*[、,，和]?\s*)*)/))) {
      var wdRaw = (m[1] || '').replace(/[、,，和\s]/g, '');
      var weekdays = [];
      for (var i = 0; i < wdRaw.length; i++) {
        var ch = wdRaw.charAt(i);
        var val = CN_WEEK[ch] != null ? CN_WEEK[ch] : (/^\d$/.test(ch) ? Number(ch) % 7 : NaN);
        if (!isNaN(val) && weekdays.indexOf(val) === -1) weekdays.push(val);
      }
      repeat = { kind: 'weekly', weekdays: weekdays };
    } else if ((m = cut(/工作日|周一到周五|星期一到星期五/))) {
      repeat = { kind: 'workday' };
    } else if ((m = cut(/每天|每日/))) {
      repeat = { kind: 'daily' };
    }

    /* ---------- 3. 相对时间（N 秒/分/小时/天/周/月 后） ---------- */
    if (!repeat) {
      if ((m = cut(/([0-9]+|[一二两三四五六七八九十]+)\s*个\s*半\s*(?:小时|钟头)\s*(?:之后|以后|后|後)?/))) {
        relMs = cnToNum(m[1]) * 90 * MIN;
      } else if ((m = cut(/半\s*(?:小时|钟头)\s*(?:之后|以后|后|後)?/))) {
        relMs = 30 * MIN;
      } else if ((m = cut(/一刻\s*(?:钟)?\s*(?:之后|以后|后|後)?/))) {
        relMs = 15 * MIN;
      } else if ((m = cut(/([0-9]+|[一二两三四五六七八九十]+)\s*(秒钟|秒|分钟|分|小时|钟头|天|日|周|星期|礼拜|个月|月)\s*(?:之后|以后|后|後)/))) {
        relMs = unitToMs(cnToNum(m[1]), m[2]);
      }
    }

    /* ---------- 4. 日期词 ---------- */
    if ((m = cut(/大后天/))) {
      dateInfo = { kind: 'offset', days: 3 };
    } else if ((m = cut(/后天/))) {
      dateInfo = { kind: 'offset', days: 2 };
    } else if ((m = cut(/明早|明天|明日/))) {
      dateInfo = { kind: 'offset', days: 1 };
    } else if ((m = cut(/今天|今日|今晚|今夜|今晚儿/))) {
      dateInfo = { kind: 'offset', days: 0 };
    } else if ((m = cut(/(下|这|本)?\s*(?:周|星期|礼拜)\s*([一二三四五六日天0-7])/))) {
      dateInfo = {
        kind: 'weekday',
        weekday: CN_WEEK[m[2]] != null ? CN_WEEK[m[2]] : Number(m[2]) % 7,
        weekOffset: m[1] === '下' ? 1 : 0
      };
    }

    /* ---------- 5. 绝对日期 ---------- */
    if (!dateInfo) {
      if ((m = cut(/(\d{4})\s*[-/年.]\s*(\d{1,2})\s*[-/月.]\s*(\d{1,2})\s*日?/))) {
        dateInfo = { kind: 'abs', y: Number(m[1]), m: Number(m[2]), d: Number(m[3]) };
      } else if ((m = cut(/(\d{1,2})\s*月\s*([0-9]+|[一二三四五六七八九十]+)\s*[日号]/))) {
        dateInfo = { kind: 'abs', y: null, m: Number(m[1]), d: cnToNum(m[2]) };
      }
    }

    /* ---------- 6. 时刻 ---------- */
    if ((m = cut(/(\d{1,2})\s*:\s*(\d{2})/))) {
      timeInfo = { h: Number(m[1]), m: Number(m[2]) };
    } else if ((m = cut(/([0-9]+|[一二三四五六七八九十]+)\s*点\s*半/))) {
      timeInfo = { h: cnToNum(m[1]), m: 30 };
    } else if ((m = cut(/([0-9]+|[一二三四五六七八九十]+)\s*点\s*(?:([0-9]+|[一二三四五六七八九十]+)\s*分?)?/))) {
      timeInfo = { h: cnToNum(m[1]), m: m[2] ? cnToNum(m[2]) : 0 };
    } else if ((m = cut(/([0-9]+|[一二三四五六七八九十]+)\s*时\s*(?:([0-9]+|[一二三四五六七八九十]+)\s*分)?/))) {
      timeInfo = { h: cnToNum(m[1]), m: m[2] ? cnToNum(m[2]) : 0 };
    }

    /* ---------- 7. 时段修正 ---------- */
    if (timeInfo && meridiem) {
      if ((meridiem === '下午' || meridiem === '晚上' || meridiem === '傍晚' || meridiem === '夜里') && timeInfo.h < 12) {
        timeInfo.h += 12;
      } else if ((meridiem === '上午' || meridiem === '早上' || meridiem === '早晨' || meridiem === '清晨' || meridiem === '凌晨') && timeInfo.h === 12) {
        timeInfo.h = 0;
      } else if (meridiem === '中午' && timeInfo.h < 12) {
        timeInfo.h += 12;
      }
    }
    if (timeInfo && (timeInfo.h < 0 || timeInfo.h > 23 || timeInfo.m < 0 || timeInfo.m > 59)) {
      return fail('时间不合法：' + timeInfo.h + ':' + timeInfo.m);
    }

    /* ---------- 8. 标题 ---------- */
    var title = work
      .replace(/[\s　]+/g, ' ')
      .replace(/^[\s,，。.!！?？:：;；、-]+/, '')
      .replace(/[\s,，。.!！?？:：;；、]+$/, '')
      .trim();
    if (!title) title = '提醒';

    /* ---------- 9. 组装结果 ---------- */
    var result = { ok: true, title: title, matched: consumed.join(' ').trim() };

    if (repeat) {
      if (repeat.kind === 'interval') {
        if (isNaN(repeat.everyMinutes) || repeat.everyMinutes < 1) return fail('间隔分钟数不合法');
      } else {
        repeat.timeOfDay = timeInfo
          ? Schedule.pad2(timeInfo.h) + ':' + Schedule.pad2(timeInfo.m)
          : '09:00';
        if (repeat.kind === 'weekly' && !(repeat.weekdays || []).length) {
          repeat.weekdays = [new Date(now).getDay()];
        }
      }
      repeat = Schedule.normalizeRepeat(repeat);
      result.mode = 'repeat';
      result.repeat = repeat;
      result.nextRunAt = Schedule.computeNextRun({ mode: 'repeat', repeat: repeat }, now);
      if (result.nextRunAt == null) return fail('无法计算下一次提醒时间');
      return result;
    }

    if (relMs != null) {
      result.mode = 'once';
      result.at = now + relMs;
      result.nextRunAt = result.at;
      return result;
    }

    if (timeInfo) {
      var base = new Date(now);
      var y = base.getFullYear();
      var mo = base.getMonth();
      var d = base.getDate();

      if (dateInfo && dateInfo.kind === 'offset') {
        d += dateInfo.days;
      } else if (dateInfo && dateInfo.kind === 'weekday') {
        var cur = base.getDay();
        var delta;
        if (dateInfo.weekOffset === 1) {
          // “下周X”：下一个自然周的周一为基准，再偏移到目标星期
          delta = ((8 - cur) % 7) + (dateInfo.weekday - 1);
          if (delta === 0) delta = 7;
        } else {
          delta = (dateInfo.weekday - cur + 7) % 7;
          if (delta === 0) delta = 7; // “周五”指下一个周五，不含今天
        }
        d += delta;
      } else if (dateInfo && dateInfo.kind === 'abs') {
        mo = dateInfo.m - 1;
        d = dateInfo.d;
        y = dateInfo.y != null ? dateInfo.y : y;
        var probe = new Date(y, mo, d, timeInfo.h, timeInfo.m, 0, 0);
        if (dateInfo.y == null && probe.getTime() <= now) y += 1; // 今年已过则顺延到明年
      }

      var ts = new Date(y, mo, d, timeInfo.h, timeInfo.m, 0, 0).getTime();
      // 未指定日期且今天该时刻已过 -> 顺延到明天
      if (!dateInfo && ts <= now) ts += DAY;
      result.mode = 'once';
      result.at = ts;
      result.nextRunAt = ts;
      return result;
    }

    return fail('没有识别到时间，试试「10分钟后 喝水」或「明天9点 开会」');
  }

  function unitToMs(n, unit) {
    if (isNaN(n)) return null;
    switch (unit) {
      case '秒':
      case '秒钟':
        return n * 1000;
      case '分':
      case '分钟':
        return n * MIN;
      case '小时':
      case '钟头':
        return n * HOUR;
      case '天':
      case '日':
        return n * DAY;
      case '周':
      case '星期':
      case '礼拜':
        return n * 7 * DAY;
      case '月':
      case '个月':
        return n * 30 * DAY;
      default:
        return null;
    }
  }

  return { parse: parse, cnToNum: cnToNum, normalize: normalize, stripVerbs: stripVerbs };
});
