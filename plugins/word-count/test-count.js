const { countText, formatFullReport, formatReadingTime } = require("./count.js");

function assert(cond, msg) {
  if (!cond) {
    console.error("FAIL:", msg);
    process.exitCode = 1;
  } else {
    console.log("OK:", msg);
  }
}

let s = countText("");
assert(
  s.charCount === 0 && s.han === 0 && s.latinWords === 0 && s.lines === 0,
  "empty"
);

s = countText("你好世界");
assert(s.han === 4 && s.latinWords === 0 && s.charCount === 4, "pure han");

s = countText("Hello world's test");
assert(s.latinWords === 3 && s.han === 0, "latin words with apostrophe: " + s.latinWords);

s = countText("Hello 世界 123！");
assert(
  s.han === 2 && s.latinWords === 1 && s.numbers === 1 && s.punctuation >= 1,
  "mixed " + JSON.stringify({ han: s.han, words: s.latinWords, num: s.numbers, p: s.punctuation })
);

s = countText("😀字");
assert(s.charCount === 2 && s.han === 1, "emoji code points: " + s.charCount);

s = countText("a\nb\n\nc");
assert(s.lines === 4 && s.paragraphs === 2, "lines/para " + s.lines + "/" + s.paragraphs);

s = countText("一".repeat(400));
assert(s.readingMinutes === 1, "400 han = 1 min, got " + s.readingMinutes);

assert(formatReadingTime(0.01).includes("秒"), "seconds label");
assert(formatReadingTime(1.2).includes("分钟"), "minutes label");

console.log("report:", formatFullReport(countText("Hello 世界")));
console.log("done");
