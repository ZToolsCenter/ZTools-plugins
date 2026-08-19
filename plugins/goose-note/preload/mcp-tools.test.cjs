"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const {
  extractTextFromPageContent,
  extractTitleFromPageContent,
  getNextOffset,
  parsePersistedNotebooks,
  searchNoteItems,
  stripMarkdownSyntax,
} = require("./mcp-tools.cjs");

test("提取页面标题和正文文本", () => {
  const content = {
    type: "doc",
    content: [
      {
        type: "heading",
        attrs: { level: 1 },
        content: [{ type: "text", text: "测试标题" }],
      },
      {
        type: "paragraph",
        content: [{ type: "text", text: "第一段正文" }],
      },
    ],
  };

  assert.equal(extractTitleFromPageContent(content), "测试标题");
  assert.equal(extractTextFromPageContent(content), "测试标题 第一段正文");
});

test("Markdown 文本提取会去掉常见标记", () => {
  const markdown = "# 标题\n\n- 列表\n\n[链接](https://example.com)\n\n`代码`";
  assert.equal(stripMarkdownSyntax(markdown), "标题 列表 链接 代码");
});

test("搜索排序标题命中优先于正文命中", () => {
  const items = [
    {
      id: "1",
      title: "普通页面",
      updatedAt: 10,
      contentText: "这里有关键词",
    },
    {
      id: "2",
      title: "关键词标题",
      updatedAt: 1,
      contentText: "没有别的内容",
    },
  ];

  const results = searchNoteItems(items, "关键词");
  assert.equal(results[0].id, "2");
  assert.deepEqual(results[0].matchedFields, ["title"]);
  assert.equal(results[1].id, "1");
  assert.deepEqual(results[1].matchedFields, ["content"]);
});

test("分页偏移量仅在还有结果时返回", () => {
  assert.equal(getNextOffset(12, 0, 5), 5);
  assert.equal(getNextOffset(12, 5, 5), 10);
  assert.equal(getNextOffset(12, 10, 2), null);
  assert.equal(getNextOffset(0, 0, 0), null);
});

test("解析 Zustand 持久化记事本结构", () => {
  const raw = JSON.stringify({
    state: {
      notebooks: {
        a: { id: "a", name: "默认", source: "default" },
        b: { id: "b", name: "本地", source: "local-folder", localPath: "/tmp/demo" },
      },
    },
    version: 0,
  });

  const notebooks = parsePersistedNotebooks(raw);
  assert.equal(notebooks.length, 2);
  assert.equal(notebooks[1].localPath, "/tmp/demo");
});
