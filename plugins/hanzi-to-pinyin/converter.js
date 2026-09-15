/**
 * 汉字转拼音 —— 核心转换逻辑（纯函数，无 DOM 依赖）
 *
 * 同时支持两种运行环境：
 *  - 浏览器：通过 <script> 加载 vendor/pinyin-pro.js 后，使用 window.pinyinPro
 *  - Node（单元测试）：require('pinyin-pro')
 *
 * 对外暴露全局 PinyinConverter（浏览器）与 module.exports（Node）。
 */
(function (global) {
  'use strict';

  var isNode = typeof window === 'undefined';
  var P = isNode ? require('pinyin-pro') : global.pinyinPro;
  var pinyin = P.pinyin;
  var getInitialAndFinal = P.getInitialAndFinal;
  var getNumOfTone = P.getNumOfTone;

  // 常用汉字范围（含基本区与扩展 A）
  var CJK = /[㐀-䶿一-鿿]/;

  // 去掉拼音上的声调符号（如 shì -> shi，lǜ -> lu）
  function stripTone(s) {
    return s.normalize('NFD').replace(/[̀-ͯ]/g, '');
  }

  // 将拼音中的 ü（含声调变体）替换为 v
  function fixU(s) {
    return s.replace(/[üǖǘǚǜ]/g, 'v');
  }

  /**
   * 处理单个汉字音节（sym 为带声调符号的拼音，如 "shì"）
   * cfg 中相关字段：resultMode / toneMode / caseMode / uvToV
   */
  function processSyllable(sym, cfg) {
    if (!sym) return '';
    var toneNum = getNumOfTone(sym); // 字符串，如 "4"

    // 先取带声调符号的基础形式（声母/韵母/拼音/首字母）
    var toned;
    if (cfg.resultMode === 'pinyin') {
      toned = sym;
    } else if (cfg.resultMode === 'initial') {
      toned = getInitialAndFinal(sym).initial;
    } else if (cfg.resultMode === 'final') {
      toned = getInitialAndFinal(sym).final;
    } else if (cfg.resultMode === 'initialLetter') {
      toned = sym;
    } else {
      toned = ''; // 音调结果直接使用 toneNum
    }

    // ü -> v（必须在去声调之前执行，否则 lǜ 会被拆成 lu 而丢失 ü）
    if (cfg.uvToV) toned = fixU(toned);

    var base;
    if (cfg.resultMode === 'tone') {
      base = toneNum;
    } else if (cfg.toneMode === 'symbol') {
      base = toned; // 保留声调符号
    } else {
      // 不加音调 / 数字音调：先去声调符号
      base = stripTone(toned);
      // 数字音调：在拼音 / 韵母末尾追加声调数字（首字母、声母不追加）
      if (cfg.toneMode === 'num' && (cfg.resultMode === 'pinyin' || cfg.resultMode === 'final')) {
        base = base + toneNum;
      }
    }

    // 首字母：取第一个字母（音调数字不附加）
    if (cfg.resultMode === 'initialLetter') {
      base = base.charAt(0);
    }

    // 大小写（音调结果不区分大小写）
    if (cfg.resultMode !== 'tone') {
      if (cfg.caseMode === 'upper') {
        base = base.toUpperCase();
      } else if (cfg.caseMode === 'capitalize') {
        base = base.charAt(0).toUpperCase() + base.slice(1).toLowerCase();
      }
    }
    return base;
  }

  /**
   * 标准模式转换
   * cfg: { caseMode, toneMode, resultMode, nonHanMode, rmSpacing, rmNewline, uvToV, surname }
   */
  function convertMode1(text, cfg) {
    if (!text) return '';
    var pOpts = { toneType: 'symbol', type: 'array' };
    if (cfg.surname) pOpts.surname = 'head';
    var sylls = pinyin(text, pOpts); // 与字符对齐的数组

    var out = '';
    var lastWasPinyin = false;
    var isWs = function (ch) {
      return ch === ' ' || ch === '\n' || ch === '\r' || ch === '\t';
    };
    var isAlpha = function (ch) {
      return /[A-Za-z0-9]/.test(ch);
    };

    for (var i = 0; i < text.length; i++) {
      var c = text[i];
      if (CJK.test(c)) {
        var token = processSyllable(sylls[i] || '', cfg);
        // 默认每个拼音之间、以及拼音与相邻英文字母之间添加空格（仅「正常输出」模式）
        if (
          out !== '' &&
          !cfg.rmSpacing &&
          cfg.nonHanMode === 'normal' &&
          !isWs(out.slice(-1))
        ) {
          out += ' ';
        }
        out += token;
        lastWasPinyin = true;
      } else {
        if (cfg.rmNewline && (c === '\n' || c === '\r')) continue;
        if (cfg.nonHanMode === 'remove') {
          lastWasPinyin = false;
          continue;
        }
        var rep = c;
        if (cfg.nonHanMode === 'space') rep = ' ';
        else if (cfg.nonHanMode === 'underscore') rep = '_';

        // 正常输出模式下，若上一个是拼音且当前是英文字母/数字，则前方补一个空格
        if (
          cfg.nonHanMode === 'normal' &&
          !cfg.rmSpacing &&
          lastWasPinyin &&
          isAlpha(c)
        ) {
          out += ' ';
        }
        out += rep;
        lastWasPinyin = false;
      }
    }
    return out;
  }

  /**
   * 变量命名模式转换
   * cfg: { formatMode }
   * 将每个汉字转为无声调小写拼音作为一个词；连续的英文字母/数字作为一词；
   * 其余字符（空白、标点）作为分词边界。
   */
  function convertMode2(text, cfg) {
    if (!text) return '';
    var words = [];
    var lit = '';
    function flush() {
      if (lit) {
        words.push(lit);
        lit = '';
      }
    }
    for (var i = 0; i < text.length; i++) {
      var c = text[i];
      if (CJK.test(c)) {
        flush();
        var py = pinyin(c, { toneType: 'none', type: 'array' })[0] || '';
        words.push(py.toLowerCase());
      } else if (/[A-Za-z0-9]/.test(c)) {
        lit += c;
      } else {
        flush();
      }
    }
    flush();

    var fmt = cfg.formatMode;
    var cap = function (w) {
      return w.charAt(0).toUpperCase() + w.slice(1).toLowerCase();
    };
    var res;
    switch (fmt) {
      case 'camel': // 小驼峰 woShiShiLi
        res = words.map(function (w, idx) { return idx === 0 ? w.toLowerCase() : cap(w); }).join('');
        break;
      case 'pascal': // 大驼峰 WoShiShiLi
        res = words.map(cap).join('');
        break;
      case 'snake': // 下划线 wo_shi_shi_li
        res = words.map(function (w) { return w.toLowerCase(); }).join('_');
        break;
      case 'constant': // 常量名 WO_SHI_SHI_LI
        res = words.map(function (w) { return w.toUpperCase(); }).join('_');
        break;
      case 'kebab': // 短横杠 wo-shi-shi-li
        res = words.map(function (w) { return w.toLowerCase(); }).join('-');
        break;
      case 'space': // 空格 wo shi shi li
        res = words.map(function (w) { return w.toLowerCase(); }).join(' ');
        break;
      case 'initialsLower': // 首字母小写 wssl
        res = words.map(function (w) { return w.charAt(0).toLowerCase(); }).join('');
        break;
      case 'initialsUpper': // 首字母大写 WSSL
        res = words.map(function (w) { return w.charAt(0).toUpperCase(); }).join('');
        break;
      case 'initialsCamel': // 首字母小驼峰 wSSL
        res = words.map(function (w, idx) {
          return idx === 0 ? w.charAt(0).toLowerCase() : w.charAt(0).toUpperCase();
        }).join('');
        break;
      case 'initialsPascal': // 首字母大驼峰 Wssl
        res = words.map(function (w, idx) {
          return idx === 0 ? w.charAt(0).toUpperCase() : w.charAt(0).toLowerCase();
        }).join('');
        break;
      default:
        res = words.join('');
    }
    return res;
  }

  /**
   * 统一入口
   * cfg 需包含 mode 字段：'mode1' | 'mode2'，其余字段见上面两个函数。
   */
  function convert(text, cfg) {
    if (!cfg) cfg = {};
    if (cfg.mode === 'mode2') return convertMode2(text, cfg);
    return convertMode1(text, cfg);
  }

  var api = {
    convert: convert,
    convertMode1: convertMode1,
    convertMode2: convertMode2,
    processSyllable: processSyllable,
    stripTone: stripTone,
    fixU: fixU,
    CJK: CJK
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
  global.PinyinConverter = api;
})(typeof window !== 'undefined' ? window : globalThis);
