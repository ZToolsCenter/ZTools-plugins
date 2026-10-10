/**
 * 写作向字数统计核心（纯函数，无 DOM / 无 ztools 依赖）
 *
 * 口径说明：
 * - 字符数：Unicode 码点数（emoji 不拆成代理对）
 * - 汉字：Unicode Script=Han
 * - 英文单词：拉丁字母连续段（含常见撇号缩写），数字不计入单词
 * - 数字：连续数字段按 1 个「数」计
 * - 标点：Unicode P* 标点类别（中英标点均计入）
 * - 阅读时长：汉字 400 字/分 + 英文单词 200 词/分，向上取整
 */
(function (global) {
  "use strict";

  var RE_HAN = /\p{Script=Han}/gu;
  var RE_LATIN_WORD = /\p{Script=Latin}+(?:['’]\p{Script=Latin}+)*/gu;
  var RE_NUMBER = /\d+/g;
  var RE_PUNCT = /\p{P}/gu;
  var RE_SPACE = /\s/u;

  function toCodePoints(text) {
    return Array.from(text);
  }

  function countMatches(text, re) {
    var m = text.match(re);
    return m ? m.length : 0;
  }

  function formatReadingTime(minutes) {
    if (!isFinite(minutes) || minutes <= 0) return "0 秒";
    if (minutes < 1) {
      var secs = Math.max(1, Math.round(minutes * 60));
      return secs + " 秒";
    }
    if (minutes < 60) {
      var mins = Math.round(minutes);
      return mins + " 分钟";
    }
    var h = Math.floor(minutes / 60);
    var rest = Math.round(minutes % 60);
    return rest > 0 ? h + " 小时 " + rest + " 分钟" : h + " 小时";
  }

  /**
   * @param {string} text
   * @returns {{
   *   charCount: number,
   *   charNoSpace: number,
   *   whitespace: number,
   *   han: number,
   *   latinWords: number,
   *   numbers: number,
   *   punctuation: number,
   *   lines: number,
   *   paragraphs: number,
   *   readingMinutes: number,
   *   readingLabel: string,
   *   summary: string
   * }}
   */
  function countText(text) {
    if (typeof text !== "string") text = "";
    var codePoints = toCodePoints(text);
    var charCount = codePoints.length;
    var whitespace = 0;
    for (var i = 0; i < codePoints.length; i++) {
      if (RE_SPACE.test(codePoints[i])) whitespace++;
    }
    var charNoSpace = charCount - whitespace;

    var han = countMatches(text, RE_HAN);
    var latinWords = countMatches(text, RE_LATIN_WORD);
    var numbers = countMatches(text, RE_NUMBER);
    var punctuation = countMatches(text, RE_PUNCT);

    var lines = text.length === 0 ? 0 : text.split(/\r\n|\r|\n/).length;
    var paragraphs =
      text.trim() === ""
        ? 0
        : text
            .split(/\r\n[\s]*\r\n|\r[\s]*\r|\n[\s]*\n/)
            .filter(function (p) {
              return p.trim() !== "";
            }).length;

    var readingMinutes = han / 400 + latinWords / 200;
    if (charCount > 0 && readingMinutes < 1 / 60) {
      readingMinutes = 1 / 60;
    }

    var summary =
      "汉字 " +
      han +
      " · 英文 " +
      latinWords +
      " · 阅读约 " +
      formatReadingTime(readingMinutes);

    return {
      charCount: charCount,
      charNoSpace: charNoSpace,
      whitespace: whitespace,
      han: han,
      latinWords: latinWords,
      numbers: numbers,
      punctuation: punctuation,
      lines: lines,
      paragraphs: paragraphs,
      readingMinutes: readingMinutes,
      readingLabel: formatReadingTime(readingMinutes),
      summary: summary,
    };
  }

  function formatFullReport(stats) {
    return [
      "总字符 " + stats.charCount,
      "不含空白 " + stats.charNoSpace,
      "汉字 " + stats.han,
      "英文单词 " + stats.latinWords,
      "数字 " + stats.numbers,
      "标点 " + stats.punctuation,
      "行 " + stats.lines,
      "段落 " + stats.paragraphs,
      "预估阅读 " + stats.readingLabel,
    ].join(" · ");
  }

  var api = {
    countText: countText,
    formatReadingTime: formatReadingTime,
    formatFullReport: formatFullReport,
  };

  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  }
  global.WordCount = api;
})(typeof globalThis !== "undefined" ? globalThis : this);
