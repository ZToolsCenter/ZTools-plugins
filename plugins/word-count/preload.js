/**
 * ZTools preload：注册主搜索即时字数结果
 * 与 count.js 保持同一套统计口径（此处内联一份轻量实现，避免加载时序问题）
 */
(function () {
  "use strict";

  function countTextLite(text) {
    if (typeof text !== "string") text = "";
    var han = (text.match(/\p{Script=Han}/gu) || []).length;
    var latinWords = (text.match(/\p{Script=Latin}+(?:['’]\p{Script=Latin}+)*/gu) || [])
      .length;
    var charCount = Array.from(text).length;
    var readingMinutes = han / 400 + latinWords / 200;
    if (charCount > 0 && readingMinutes < 1 / 60) readingMinutes = 1 / 60;
    var readingLabel;
    if (readingMinutes <= 0) readingLabel = "0 秒";
    else if (readingMinutes < 1) readingLabel = Math.max(1, Math.round(readingMinutes * 60)) + " 秒";
    else if (readingMinutes < 60) readingLabel = Math.round(readingMinutes) + " 分钟";
    else {
      var h = Math.floor(readingMinutes / 60);
      var rest = Math.round(readingMinutes % 60);
      readingLabel = rest > 0 ? h + " 小时 " + rest + " 分钟" : h + " 小时";
    }
    return {
      charCount: charCount,
      han: han,
      latinWords: latinWords,
      readingLabel: readingLabel,
    };
  }

  function pickPayload(queryData) {
    if (!queryData) return "";
    if (typeof queryData === "string") return queryData;
    return (
      queryData.payload ||
      queryData.text ||
      queryData.query ||
      queryData.content ||
      (typeof queryData.data === "string" ? queryData.data : "") ||
      ""
    );
  }

  function registerMainPush() {
    if (!window.ztools || typeof window.ztools.onMainPush !== "function") return;

    window.ztools.onMainPush(
      function (queryData) {
        var text = pickPayload(queryData);
        if (!text || !text.trim()) return [];
        // 避免对极短指令词误报
        if (text.trim().length < 2) return [];
        var s = countTextLite(text);
        return [
          {
            title: "字数统计",
            description:
              "汉字 " +
              s.han +
              " · 英文 " +
              s.latinWords +
              " · 阅读约 " +
              s.readingLabel,
            icon: "logo.png",
            featureCode: "word-count",
          },
        ];
      },
      function (selectData) {
        return true;
      }
    );
  }

  try {
    registerMainPush();
  } catch (e) {
    console.warn("onMainPush register failed", e);
  }
})();
