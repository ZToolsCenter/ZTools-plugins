import { describe, expect, it } from "vitest";
import { searchEmojiShortcodes } from "../../src/core/emojiDictionary";
import { renderInlineMarkdown } from "../../src/core/inlineRenderer";
import {
  resolveRelativePath,
  transformRelativeImageUrlsToAbsolute
} from "../../src/utils/pathUtils";
import { computeMarkdownAfterDeletingBlocks } from "../../src/utils/selectionUtils";
import {
  SAMPLE_MARKDOWN_REFERENCE_DOC,
  SAMPLE_QUICKSTART_DOC
} from "../../src/core/sampleDocs";
import {
  applyInlineFormatToText,
  computeWordCountStats,
  convertBlockType,
  createEmptyTableBlock,
  htmlToMarkdownSmartPaste,
  parseMarkdownDocument,
  prettifyMarkdownTable,
  serializeBlocksToMarkdown
} from "../../src/core/markdownParser";

describe("Typora Markdown Parser & AST Engine", () => {
  it("parses YAML front matter, headings, alerts, lists, tables, math, and mermaid blocks", () => {
    const sample = [
      "---",
      "title: Typora Test",
      "typora-root-url: ./assets",
      "---",
      "",
      "# 一级标题",
      "",
      "> [!TIP]",
      "> 这是一个 GFM 提示框",
      "",
      "- [x] 已完成事项",
      "- [ ] 待办事项",
      "",
      "| 功能 | 状态 |",
      "| :--- | :---: |",
      "| 实时预览 | 已支持 |",
      "",
      "$$",
      "E = mc^2",
      "$$",
      "",
      "```mermaid",
      "graph TD",
      "  A --> B",
      "```",
      "",
      "[TOC]",
      "",
      "[^1]: 脚注定义内容"
    ].join("\n");

    const parsed = parseMarkdownDocument(sample);

    expect(parsed.yamlMeta.title).toBe("Typora Test");
    expect(parsed.yamlMeta["typora-root-url"]).toBe("./assets");
    expect(parsed.outline).toHaveLength(1);
    expect(parsed.outline[0].text).toBe("一级标题");

    const types = parsed.blocks.map((b) => b.type);
    expect(types).toEqual([
      "frontmatter",
      "heading",
      "alert",
      "list",
      "table",
      "math",
      "diagram",
      "toc",
      "footnote_def"
    ]);

    const alertBlock = parsed.blocks.find((b) => b.type === "alert");
    expect(alertBlock?.alertKind).toBe("TIP");

    const listBlock = parsed.blocks.find((b) => b.type === "list");
    expect(listBlock?.listType).toBe("task");
    expect(listBlock?.items).toHaveLength(2);
    expect(listBlock?.items?.[0].checked).toBe(true);
    expect(listBlock?.items?.[1].checked).toBe(false);

    const tableBlock = parsed.blocks.find((b) => b.type === "table");
    expect(tableBlock?.headers).toEqual(["功能", "状态"]);
    expect(tableBlock?.alignments).toEqual(["left", "center"]);
    expect(tableBlock?.rows).toEqual([["实时预览", "已支持"]]);

    expect(parsed.footnotes["1"]).toBe("脚注定义内容");
  });

  it("prettifies Markdown tables with column alignment markers", () => {
    const formatted = prettifyMarkdownTable(
      ["模块", "快捷键", "支持度"],
      ["left", "center", "right"],
      [
        ["源码模式", "Cmd+/", "100%"],
        ["快速打开", "Cmd+P", "100%"]
      ]
    );

    const lines = formatted.split("\n");
    expect(lines).toHaveLength(4);
    expect(lines[0]).toContain("| 模块");
    expect(lines[1]).toMatch(/^\|\s*:---+\s*\|\s*:---+:?\s*\|\s*---+:\s*\|$/);
  });

  it("parses escaped pipes in table text and code spans as cell content", () => {
    const source = [
      "| label | code | amount |",
      "| :--- | :---: | ---: |",
      "| left \\| right | `first\\|second` | 12 |"
    ].join("\n");
    const parsed = parseMarkdownDocument(source);
    const table = parsed.blocks.find((block) => block.type === "table");

    expect(table?.headers).toEqual(["label", "code", "amount"]);
    expect(table?.alignments).toEqual(["left", "center", "right"]);
    expect(table?.rows).toEqual([["left \\| right", "`first\\|second`", "12"]]);
    expect(serializeBlocksToMarkdown(parsed.blocks)).toContain("left \\| right | `first\\|second` | 12");
  });

  it("computes accurate CJK + Latin word count statistics", () => {
    const md = "# 标题\n\n这里有六个汉字 and four English words.";
    const stats = computeWordCountStats(md);
    expect(stats.cjkChars).toBe(9); // 标题(2) + 这里有六个汉字(7)
    expect(stats.words).toBe(9 + 4);
    expect(stats.paragraphs).toBe(2);
    expect(stats.readingMinutes).toBeGreaterThanOrEqual(1);
  });

  it("applies inline formatting and toggles existing markers", () => {
    const wrapped = applyInlineFormatToText("Hello Typora", 6, 12, "bold");
    expect(wrapped.text).toBe("Hello **Typora**");

    const unwrapped = applyInlineFormatToText(
      wrapped.text,
      8,
      14,
      "bold"
    );
    expect(unwrapped.text).toBe("Hello Typora");
  });

  it("converts blocks between heading, alert, task list, and code", () => {
    const parsed = parseMarkdownDocument("普通段落内容");
    const block = parsed.blocks[0];

    const h2Block = convertBlockType(block, "heading", { headingLevel: 2 });
    expect(h2Block.raw).toBe("## 普通段落内容");

    const alertBlock = convertBlockType(block, "alert", {
      alertKind: "WARNING"
    });
    expect(alertBlock.raw).toBe("> [!WARNING]\n> 普通段落内容");

    const taskBlock = convertBlockType(block, "task");
    expect(taskBlock.raw).toBe("- [ ] 普通段落内容");
  });

  it("converts pasted HTML snippets into clean Markdown", () => {
    const html =
      '<h2>Title</h2><p>Hello <strong>World</strong> with <a href="https://typora.io">Link</a></p>';
    const md = htmlToMarkdownSmartPaste(html);
    expect(md).toContain("## Title");
    expect(md).toContain("**World**");
    expect(md).toContain("[Link](https://typora.io)");
  });

  it("creates empty tables and round-trips blocks", () => {
    const tableRaw = createEmptyTableBlock(3, 2);
    const parsed = parseMarkdownDocument(tableRaw);
    expect(parsed.blocks[0].type).toBe("table");
    const serialized = serializeBlocksToMarkdown(parsed.blocks);
    expect(serialized).toContain("| 列 1");
  });

  it("searches emoji shortcodes", () => {
    const results = searchEmojiShortcodes("rock");
    expect(results.some((r) => r.shortcode === "rocket")).toBe(true);
  });

  it("renders nested inline Markdown and full sample documents without regex state corruption", () => {
    const nodes = renderInlineMarkdown(
      "前缀 **加粗 *斜体* 文字** 与 ==高亮== 以及 [Typora **官网**](https://typora.io) 和 $E=mc^2$ :rocket:"
    );
    expect(nodes.length).toBeGreaterThan(5);

    for (const docContent of [SAMPLE_QUICKSTART_DOC, SAMPLE_MARKDOWN_REFERENCE_DOC]) {
      const parsed = parseMarkdownDocument(docContent);
      expect(parsed.blocks.length).toBeGreaterThan(5);
      for (const block of parsed.blocks) {
        if (block.text) {
          const rendered = renderInlineMarkdown(block.text);
          expect(Array.isArray(rendered)).toBe(true);
        }
      }
    }
  });

  it("handles unclosed mermaid fences without swallowing subsequent fenced blocks", async () => {
    const { cleanMermaidCode } = await import("../../src/core/mathAndDiagramRenderer");
    const fencedSample = "```mermaid\nflowchart LR\n  A[Start] --> B{Branch}\n```";
    expect(cleanMermaidCode(fencedSample)).toBe("flowchart LR\n  A[Start] --> B{Branch}");

    const docWithUnclosed = [
      "```mermaid",
      "graph TD",
      "  A --> B",
      "```ts",
      "const x = 1;",
      "```"
    ].join("\n");
    const parsed = parseMarkdownDocument(docWithUnclosed);
    expect(parsed.blocks).toHaveLength(2);
    expect(parsed.blocks[0].type).toBe("diagram");
    expect(parsed.blocks[0].code).toContain("A --> B");
    expect(parsed.blocks[1].type).toBe("code");
  });

  it("transforms relative image URLs to absolute paths when copying markdown to prevent broken images", () => {
    const docPath = "/Users/testuser/Documents/Notes/project-plan.md";

    const inputMd = [
      "# Project Plan",
      "",
      "Below are screenshots:",
      "![Overview](./assets/arch.png)",
      "![Design Diagram](assets/design.png \"System Architecture\")",
      "![Outer Pic](../shared-images/banner.jpg)",
      '<img src="./assets/flow.png" alt="Flowchart" width="400" />',
      "",
      "External images should not be changed:",
      "![Online Banner](https://images.unsplash.com/photo-1234.jpg)",
      "![Data URL](data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==)",
      "![Already Absolute](/System/Library/Assets/pic.png)"
    ].join("\n");

    const transformed = transformRelativeImageUrlsToAbsolute(inputMd, docPath);

    // Relative paths must be resolved against /Users/testuser/Documents/Notes
    expect(transformed).toContain(
      "![Overview](/Users/testuser/Documents/Notes/assets/arch.png)"
    );
    expect(transformed).toContain(
      '![Design Diagram](/Users/testuser/Documents/Notes/assets/design.png "System Architecture")'
    );
    expect(transformed).toContain(
      "![Outer Pic](/Users/testuser/Documents/shared-images/banner.jpg)"
    );
    expect(transformed).toContain(
      'src="/Users/testuser/Documents/Notes/assets/flow.png"'
    );

    // External and already-absolute images remain untouched
    expect(transformed).toContain(
      "![Online Banner](https://images.unsplash.com/photo-1234.jpg)"
    );
    expect(transformed).toContain("data:image/png;base64,iVBORw0KGgo");
    expect(transformed).toContain("![Already Absolute](/System/Library/Assets/pic.png)");
  });

  it("handles relative path resolution helper correctly across directory depths", () => {
    expect(resolveRelativePath("/base/notes", "./assets/img.png")).toBe(
      "/base/notes/assets/img.png"
    );
    expect(resolveRelativePath("/base/notes", "assets/img.png")).toBe(
      "/base/notes/assets/img.png"
    );
    expect(resolveRelativePath("/base/notes", "../images/logo.svg")).toBe(
      "/base/images/logo.svg"
    );
  });

  it("supports multi-block batch deletion and filtering correctly", () => {
    const rawMd = [
      "# 标题一",
      "",
      "段落一内容",
      "",
      "段落二内容",
      "",
      "段落三内容",
      "",
      "```typescript",
      "const a = 1;",
      "```",
      "",
      "段落四内容"
    ].join("\n");

    const parsed = parseMarkdownDocument(rawMd);
    expect(parsed.blocks.length).toBe(6);

    // Simulate multi-selecting blocks [1] (段落一) and [2] (段落二) and [4] (代码块)
    const toDeleteIds = new Set([
      parsed.blocks[1].id,
      parsed.blocks[2].id,
      parsed.blocks[4].id
    ]);

    const remainingBlocks = parsed.blocks.filter((b) => !toDeleteIds.has(b.id));
    expect(remainingBlocks.length).toBe(3);

    const serialized = remainingBlocks.map((b) => b.raw).join("\n\n");
    expect(serialized).toContain("# 标题一");
    expect(serialized).toContain("段落三内容");
    expect(serialized).toContain("段落四内容");
    expect(serialized).not.toContain("段落一内容");
    expect(serialized).not.toContain("段落二内容");
    expect(serialized).not.toContain("const a = 1;");

    // Test computeMarkdownAfterDeletingBlocks helper
    const computed = computeMarkdownAfterDeletingBlocks(parsed.blocks, toDeleteIds);
    expect(computed).toBe(serialized);

    // Test select-all deletion (all blocks removed)
    const allIds = new Set(parsed.blocks.map((b) => b.id));
    const emptyResult = computeMarkdownAfterDeletingBlocks(parsed.blocks, allIds);
    expect(emptyResult).toBe("");
  });
});

