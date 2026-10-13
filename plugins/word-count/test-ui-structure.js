const fs = require("fs");
const html = fs.readFileSync("index.html", "utf8");
const js = fs.readFileSync("index.js", "utf8");
const css = fs.readFileSync("index.css", "utf8");

const keys = [...html.matchAll(/data-key="([^"]+)"/g)].map((m) => m[1]);
const needed = [
  "han",
  "latinWords",
  "readingLabel",
  "charCount",
  "charNoSpace",
  "numbers",
  "punctuation",
  "lines",
  "paragraphs",
];
const missing = needed.filter((k) => !keys.includes(k));
console.log("data-keys missing:", missing.length ? missing.join(",") : "none");

const ids = ["input-text", "btn-copy", "btn-clear", "btn-paste", "toast", "stats"];
for (const id of ids) {
  console.log("id", id, html.includes('id="' + id + '"') ? "OK" : "MISSING");
}

const banned = [
  "AI生成",
  "写作向",
  "中文字符",
  "拉丁词",
  "400 汉字",
  "实时统计",
  "等待输入",
  "口径：",
  "stat-hint",
  "footer-note",
  "tagline",
  "editor-meta",
];
for (const s of banned) {
  const hit = html.includes(s) || css.includes(s) || js.includes(s);
  console.log("ban", s, hit ? "FOUND" : "clean");
}

console.log("dark theme:", /html\[data-theme/.test(css));
console.log("toast styles:", css.includes(".toast"));
