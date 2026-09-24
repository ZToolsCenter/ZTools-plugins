/**
 * RMB 大写转换器
 *
 * 输入：阿拉伯数字字符串（可含千分位逗号、最多 2 位小数）
 * 输出：人民币大写金额 + 千分位格式化结果
 *
 * 规则：
 *  - 必须加"整"：金额精确到元为止时
 *  - 可以加"整"：金额精确到角为止时
 *  - 不得加"整"：金额包含分时
 */

(function (root, factory) {
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = factory();
  } else {
    root.RMBConverter = factory();
  }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var DIGITS = ['零', '壹', '贰', '叁', '肆', '伍', '陆', '柒', '捌', '玖'];
  var UNITS = ['', '拾', '佰', '仟'];
  var BIG_UNITS = ['', '万', '亿', '兆', '京', '垓', '秭', '穰'];

  /**
   * 将一个 4 位分组转换为大写（保留内部 0 的语义）
   * @param {string} group 4 位数字字符串
   * @returns {string} 大写字符串（若全为 0 返回空串）
   */
  function convertGroup4(group) {
    if (!/^\d{4}$/.test(group)) return '';
    if (group === '0000') return '';

    var result = '';
    var lastWasZero = false;

    for (var i = 0; i < 4; i++) {
      var d = parseInt(group.charAt(i), 10);
      var unit = UNITS[3 - i];

      if (d === 0) {
        lastWasZero = true;
      } else {
        if (lastWasZero && result) result += '零';
        result += DIGITS[d] + unit;
        lastWasZero = false;
      }
    }

    return result;
  }

  /**
   * 判断两个相邻非空分组之间是否需要补"零"
   *
   * 中文读数里，只有当"上一组的末位"和"当前组的首位"在数值上直接衔接时才不补零。
   * @param {string} prev 上一分组的大写（如 '壹仟'）
   * @param {string} curr 当前分组的大写（如 '壹佰'）
   * @param {boolean} hasGap 两者之间是否存在全 0 分组
   * @returns {boolean} true = 不补零
   */
  function shouldSkipZero(prev, curr, hasGap) {
    if (hasGap) return false;

    var prevLastChar = prev.charAt(prev.length - 1);
    var prevReachesGe = prevLastChar !== '拾' && prevLastChar !== '佰' && prevLastChar !== '仟';
    var prevAtBaiOrQian = prevLastChar === '佰' || prevLastChar === '仟';
    var currReachesQian = curr.indexOf('仟') >= 0;

    // 上一组读到了个位、当前组顶到仟位 —— 数值直接衔接（如 1,0001 -> 壹万壹仟）
    if (prevReachesGe && currReachesQian) return true;
    // 上一组顶到佰/仟位、当前组顶到仟位 —— 同样衔接（如 100,1000 -> 壹佰万壹仟）
    if (prevAtBaiOrQian && currReachesQian) return true;
    // 两组都只是个位的"壹"（如 1,0001 -> 壹万壹）
    if (prev === '壹' && curr === '壹') return true;

    return false;
  }

  /**
   * 将整数部分字符串转换为大写
   * @param {string} numStr 纯数字字符串（不含逗号、小数点）
   * @returns {string}
   */
  function convertInteger(numStr) {
    if (!numStr || !/^\d+$/.test(numStr)) return '';
    if (/^0+$/.test(numStr)) return '零';

    var len = numStr.length;
    var padLen = Math.ceil(len / 4) * 4;
    var padded = numStr.length < padLen ? ('0000000000000000' + numStr).slice(-padLen) : numStr;
    var numGroups = padded.length / 4;

    var result = '';
    var prevGroupCapital = '';
    var hasGap = false;

    for (var i = 0; i < numGroups; i++) {
      var group = padded.substr(i * 4, 4);
      var groupIdx = numGroups - 1 - i;
      var bigUnit = BIG_UNITS[groupIdx] || '';
      var g = convertGroup4(group);

      if (g === '') {
        if (prevGroupCapital !== '') hasGap = true;
        continue;
      }

      if (prevGroupCapital === '') {
        // 第一个非空分组
        result = g + bigUnit;
      } else {
        // 后续非空分组：根据规则决定是否补"零"
        if (!shouldSkipZero(prevGroupCapital, g, hasGap)) {
          result += '零';
        }
        result += g + bigUnit;
      }

      prevGroupCapital = g;
      hasGap = false;
    }

    return result;
  }

  /**
   * 给数字字符串添加千分位
   * @param {string} numStr 纯数字字符串（不含逗号、可含小数点）
   * @returns {string}
   */
  function addThousandSeparator(numStr) {
    var idx = numStr.indexOf('.');
    var intPart = idx >= 0 ? numStr.substring(0, idx) : numStr;
    var decPart = idx >= 0 ? numStr.substring(idx) : '';
    var formattedInt = intPart.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
    return formattedInt + decPart;
  }

  /**
   * 主入口：将输入数字转换为人民币大写（始终带"整"，整数部分上限 16 位）
   * @param {string|number} input 输入数字（可含逗号）
   * @returns {{result: string, thousandSeparated: string}}
   *   - result: 大写人民币字符串
   *   - thousandSeparated: 千分位格式化字符串（< 1000 或超限时为空）
   */
  function numberToCapital(input) {
    if (input === null || input === undefined) {
      return { result: '', thousandSeparated: '' };
    }

    var raw = String(input).trim();
    var cleanStr = raw.replace(/,/g, '');

    if (!cleanStr || !/^\d+(\.\d{1,2})?$/.test(cleanStr)) {
      return { result: '', thousandSeparated: '' };
    }

    // 上限：整数部分最多 16 位
    var dotIdx = cleanStr.indexOf('.');
    var intDigits = dotIdx >= 0 ? cleanStr.substring(0, dotIdx) : cleanStr;
    if (intDigits.length > 16) {
      return { result: '', thousandSeparated: '' };
    }

    // 是否为零（0, 0.0, 0.00, 0.000...）
    var isZero = /^0+(\.0+)?$/.test(cleanStr);

    var result = '';
    var thousandSeparated = '';

    if (cleanStr.indexOf('.') >= 0) {
      var parts = cleanStr.split('.');
      var intPart = parts[0];
      var decPart = parts[1];
      var intCapital = isZero ? '零' : convertInteger(intPart);
      result = intCapital + '元';

      // 补齐到 2 位小数
      var paddedDec = (decPart + '00').substring(0, 2);
      var jiao = parseInt(paddedDec.charAt(0), 10);
      var fen = parseInt(paddedDec.charAt(1), 10);

      if (jiao === 0 && fen === 0) {
        // 精确到元
        result += '整';
      } else if (fen === 0) {
        // 仅角位
        result += DIGITS[jiao] + '角' + '整';
      } else if (jiao === 0) {
        // 仅分位（"零X分"）
        result += '零' + DIGITS[fen] + '分';
        // 严禁加"整"
      } else {
        // 角 + 分
        result += DIGITS[jiao] + '角' + DIGITS[fen] + '分';
        // 严禁加"整"
      }
    } else {
      // 纯整数
      var intCapital2 = isZero ? '零' : convertInteger(cleanStr);
      result = intCapital2 + '元' + '整';
    }

    // 千分位格式化：仅当 >= 1000 且非零时显示
    if (!isZero) {
      var num = parseFloat(cleanStr);
      if (num >= 1000) {
        thousandSeparated = addThousandSeparator(cleanStr);
      }
    }

    return { result: result, thousandSeparated: thousandSeparated };
  }

  /**
   * 校验输入是否符合本插件支持的数字格式
   * @param {string|number} input
   * @returns {boolean}
   */
  /**
   * 校验输入是否符合本插件支持的数字格式
   *
   * 该正则必须与 plugin.json 中 feature "rmb-regex" 的 match 严格保持一致。
   * 16 位整数部分的千分位形式允许：
   *   - 0~15 位整数带千分位：\d{1,3}(?:,\d{3}){1,4}    （首位 1-3 位 + 1-4 段三位）
   *   - 恰好 16 位带千分位：\d(?:,\d{3}){5}            （首位 1 位 + 5 段三位）
   * 拒绝更长的千分位形式（如 18 位的 11,222,333,444,555,666）
   */
  var MATCH_REGEX = /^(\d{1,16}|\d{1,3}(?:,\d{3}){1,4}|\d(?:,\d{3}){5})(?:\.\d{1,2})?$/;

  function isValidNumber(input) {
    if (input === null || input === undefined) return false;
    var raw = String(input).trim();
    if (!raw) return false;
    if (!MATCH_REGEX.test(raw)) return false;
    // 进一步约束：去掉逗号与小数后，整数部分不超过 16 位
    var digits = raw.replace(/,/g, '').replace(/\.\d*$/, '');
    return digits.length <= 16;
  }

  return {
    numberToCapital: numberToCapital,
    addThousandSeparator: addThousandSeparator,
    convertInteger: convertInteger,
    convertGroup4: convertGroup4,
    isValidNumber: isValidNumber,
    DIGITS: DIGITS.slice(),
    UNITS: UNITS.slice(),
    BIG_UNITS: BIG_UNITS.slice(),
  };
});
