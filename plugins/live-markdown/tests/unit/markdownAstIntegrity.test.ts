import { describe, expect, it } from "vitest";
import { validateMarkdownAppendIntegrity, validateMarkdownAstIntegrity } from "../../src/core/ai/markdownAstIntegrity";
import { validateAiChunkOutput } from "../../src/core/ai/aiChunkIntegrity";
import { chunkMarkdownForAi } from "../../src/core/ai/markdownChunker";
import { TYPORA_QUICKSTART_MARKDOWN } from "../../src/core/sampleDocs";

describe("Markdown AST integrity", () => {
  it("allows prose rewrites and equivalent soft line endings", () => {
    expect(() => validateMarkdownAstIntegrity(
      "# 原有标题\r\n\r\n第一行说明背景，\r\n第二行说明目标。",
      "# 更新后的标题\n\n这里重新组织了背景和目标的表达。",
      true
    )).not.toThrow();
  });

  it("rejects added, reordered, or changed heading levels", () => {
    expect(() => validateMarkdownAstIntegrity("# 甲\n\n## 乙", "# 甲\n\n### 乙", true)).toThrow(/标题层级/);
    expect(() => validateMarkdownAstIntegrity("# 甲\n\n## 乙", "## 乙\n\n# 甲", true)).toThrow(/标题/);
    expect(() => validateMarkdownAstIntegrity("正文内容足够长。", "# 新标题\n\n正文内容足够长。", true)).toThrow(/新增了原文没有的标题/);
  });

  it("validates nested list and quote topology while allowing item prose changes", () => {
    const source = "- 第一项\n  - 子项甲\n- 第二项\n\n> 引用内容";
    expect(() => validateMarkdownAstIntegrity(source, "- 已改写第一项\n  - 已改写子项\n- 已改写第二项\n\n> 更新引用", true)).not.toThrow();
    expect(() => validateMarkdownAstIntegrity(source, "- 第一项\n- 第二项\n\n> 引用内容", true)).toThrow(/列表结构/);
    expect(() => validateMarkdownAstIntegrity(source, "- 第一项\n  - 子项甲\n- 第二项", true)).toThrow(/引用/);
  });

  it("allows equivalent ordered-list delimiters while preserving numbers and checkbox states", () => {
    const source = "3. [ ] 第三项\n4. [x] 第四项";
    expect(() => validateMarkdownAstIntegrity(source, "3) [ ] 改写第三项\n4) [x] 改写第四项", true)).not.toThrow();
    expect(() => validateMarkdownAstIntegrity(source, "4. [ ] 改写第三项\n5. [x] 改写第四项", true)).toThrow(/列表结构/);
    expect(() => validateMarkdownAstIntegrity(source, "3. [x] 改写第三项\n4. [x] 改写第四项", true)).toThrow(/完成状态/);
  });

  it("preserves inline emphasis, link, and image semantics without freezing prose", () => {
    const source = "这段有 **强调**、[链接文字](https://example.com/a) 和 ![图片说明](https://example.com/i.png)。";
    expect(() => validateMarkdownAstIntegrity(
      source,
      "改写后的 **重点**、[新链接文案](https://example.com/a) 和 ![新图片说明](https://example.com/i.png)。",
      true
    )).not.toThrow();
    expect(() => validateMarkdownAstIntegrity(source, "改写后的 *重点*、[链接文字](https://example.com/a) 和 ![图片说明](https://example.com/i.png)。", true)).toThrow(/行内格式语义/);
    expect(() => validateMarkdownAstIntegrity(source, "改写后的 **重点** 和 [链接文字](https://example.com/a)。", true)).toThrow(/链接目标/);
  });

  it("preserves hard breaks and horizontal-rule nodes, and freezes HTML structures", () => {
    expect(() => validateMarkdownAstIntegrity("第一行  \n第二行\n\n---", "第一行\n第二行", true)).toThrow(/AST 结构校验/);
    const source = "正文 <b>加粗</b>。\n\n<div>固定 HTML</div>";
    expect(() => validateMarkdownAstIntegrity(source, "正文 <i>加粗</i>。\n\n<div>固定 HTML</div>", false)).toThrow(/HTML/);
    expect(() => validateMarkdownAstIntegrity(source, "正文 <b>加粗</b>。\n\n<div>已修改</div>", false)).toThrow(/HTML/);
  });

  it("keeps code, table cells, URL destinations, frontmatter, math, and footnote syntax immutable", () => {
    const source = [
      "---", "title: Stable", "---", "", "正文说明。", "", "```ts", "const stable = 1;", "```", "",
      "| 名称 | 值 |", "| --- | --- |", "| alpha | beta |", "", "[页面](https://example.com/original)",
      "", "公式 $x + y$。", "", "脚注引用[^fact]。", "", "[^fact]: 这是脚注正文。"
    ].join("\n");
    expect(() => validateMarkdownAstIntegrity(source, source.replace("正文说明", "已润色的正文说明"), false)).not.toThrow();
    for (const changed of [
      source.replace("const stable = 1;", "const stable = 2;"),
      source.replace("| alpha | beta |", "| alpha | changed |"),
      source.replace("https://example.com/original", "https://example.com/other"),
      source.replace("title: Stable", "title: Changed"),
      source.replace("$x + y$", "$x - y$"),
      source.replace("[^fact]", "[^other]")
    ]) {
      expect(() => validateMarkdownAstIntegrity(source, changed, false)).toThrow(/AST 结构校验/);
    }
  });

  it("rejects a protected block moved into a different structural parent", () => {
    const source = "说明代码用途。\n\n```js\nconst x = 1;\n```";
    const moved = "> 说明代码用途。\n>\n> ```js\n> const x = 1;\n> ```";
    expect(() => validateMarkdownAstIntegrity(source, moved, false)).toThrow(/所在结构/);
  });

  it("allows custom prose restructuring but still checks protected content", () => {
    const source = "# 原标题\n\n一段 **正文**。\n\n`stable`";
    expect(() => validateMarkdownAstIntegrity(source, "## 新标题\n\n新段落。\n\n`stable`", false)).not.toThrow();
    expect(() => validateMarkdownAstIntegrity(source, "## 新标题\n\n新段落。\n\n`changed`", false)).toThrow(/代码/);
    expect(() => validateMarkdownAstIntegrity(source, "## 新标题\n\n新段落和 $x^2$。\n\n```js\nconst added = true;\n```\n\n`stable`", false)).not.toThrow();
    expect(() => validateMarkdownAstIntegrity("普通正文。", "普通正文。\n\n```js\nconst added = true;\n```", true)).toThrow(/保守修改新增/);
    expect(() => validateMarkdownAstIntegrity("普通正文。", "普通正文。\n\n```js\nconst added = true;", false)).toThrow(/模型输出在代码块中途结束/);
  });

  it("validates append fragments without allowing them to close or join existing structures", () => {
    expect(() => validateMarkdownAppendIntegrity("正文原文。", "\n\n底部加 hello")).not.toThrow();
    expect(() => validateMarkdownAppendIntegrity("前文\n\n```ts\nconst x = 1;", "\n\n```\nhello")).toThrow(/原文末尾.*代码块/);
    expect(() => validateMarkdownAppendIntegrity("- 原有列表项", "\n\n- 新列表项")).toThrow(/列表或引用结构/);
    expect(() => validateMarkdownAppendIntegrity("正文原文。", "\n\n```ts\nconst x = 1;")).toThrow(/追加内容.*代码块/);
    expect(() => validateMarkdownAppendIntegrity("正文原文。", "\n\n$$\nx^2")).toThrow(/追加内容.*数学公式/);
    expect(() => validateMarkdownAppendIntegrity("---\ntitle: draft", "\n\nhello")).toThrow(/frontmatter/);
    expect(() => validateMarkdownAppendIntegrity("---\ntitle: done\n---", "\n\nhello")).not.toThrow();
    expect(() => validateMarkdownAppendIntegrity("正文\n\n---", "\n\nhello")).not.toThrow();
  });

  it("accepts the full Quickstart document with a prepared append and preserves CRLF separators", () => {
    expect(() => validateMarkdownAppendIntegrity(TYPORA_QUICKSTART_MARKDOWN, "\n\n底部加 hello")).not.toThrow();
    expect(() => validateMarkdownAppendIntegrity("正文\r\n", "\r\n追加内容")).not.toThrow();
  });

  it("fails safely on AST depth beyond the parser guard", () => {
    const deepQuote = `${"> ".repeat(140)}deeply nested quote`;
    expect(() => validateMarkdownAstIntegrity(deepQuote, deepQuote, true)).toThrow(/Markdown AST 嵌套超过校验上限/);
  });

  it("enforces the 1 MiB limit on the combined append candidate", () => {
    expect(() => validateMarkdownAppendIntegrity("a".repeat(600_000), "\n\n" + "b".repeat(500_000)))
      .toThrow(/1 MiB/);
  });

  it("applies AST validation after restoring only the current chunk's protected tokens", () => {
    const source = "段落内容足够长，可以改写。\n\n```js\nconst x = 1;\n```";
    const chunk = chunkMarkdownForAi(source, { createMask: () => "SAFE_" }).chunks[0];
    const codeToken = chunk.text.match(/SAFE_\d+__/g)?.[0] ?? "";
    const malformed = `# 新增标题\n\n段落内容足够长，可以改写。\n\n${codeToken}`;
    expect(() => validateAiChunkOutput(malformed, chunk, true)).toThrow(/新增了原文没有的标题/);
  });
});
