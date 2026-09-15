"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { markdownToHtml, stripHtml, parseDelimited, serializeDelimited, jsonToRows, rowsToJson, convertStructured } = require("../../preload/text-converter.cjs");

test("parses quoted CSV including commas, quotes and embedded newlines", () => {
  const rows = parseDelimited('name,note\nAlice,"hello, world"\nBob,"line 1\nline 2"\nC,"a""b"', ",");
  assert.deepEqual(rows, [["name","note"],["Alice","hello, world"],["Bob","line 1\nline 2"],["C",'a"b']]);
  assert.deepEqual(parseDelimited(serializeDelimited(rows, ","), ","), rows);
});

test("converts object arrays to tabular rows and back", () => {
  const rows = jsonToRows([{ name: "A", score: 3 }, { name: "B", extra: true }]);
  assert.deepEqual(rows[0], ["name", "score", "extra"]);
  assert.deepEqual(rowsToJson(rows)[1], { name: "B", score: "", extra: true });
});

test("renders safe markdown and strips active HTML", () => {
  const html = markdownToHtml("# Title\n\n- **safe**\n<script>alert(1)</script>");
  assert.match(html, /<h1>Title<\/h1>/);
  assert.doesNotMatch(html, /<script>/);
  assert.equal(stripHtml("<style>x</style><p>Hello<br>World</p>"), "Hello\nWorld");
});

test("plain text can become structured targets deterministically", () => {
  const source = { text: "A\nB", rows: null, json: null, html: null };
  assert.match(convertStructured(source, "txt", "json"), /"value": "A"/);
  assert.equal(convertStructured(source, "txt", "csv"), "A\nB");
});
