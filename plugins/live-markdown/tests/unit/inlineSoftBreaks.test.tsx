import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { renderInlineMarkdown } from "../../src/core/inlineRenderer";
import { parseMarkdownDocument } from "../../src/core/markdownParser";

const html = (source: string) => renderToStaticMarkup(React.createElement(React.Fragment, null, renderInlineMarkdown(source)));
const text = (source: string) => html(source).replace(/<[^>]*>/gu, "");

describe("reading inline soft breaks", () => {
  it.each([
    ["优美出版级排\n版。", "优美出版级排版。"],
    ["alpha\nbeta", "alpha beta"],
    ["中文\nEnglish", "中文 English"],
    ["alpha\n，后文", "alpha，后文"],
    ["（\n中文", "（中文"],
    ["中**文**\n**续**写", "中文续写"],
    ["𠀀\n𠀁", "𠀀𠀁"],
    ["中文\r\n续文", "中文续文"],
    ["alpha\r\nbeta", "alpha beta"]
  ])("renders %j with the shared preview typography", (source, expected) => {
    expect(text(source)).toBe(expected);
  });

  it.each(["前行  \n后行", "前行\\\n后行", "前行  \r\n后行", "前行\\\r\n后行"])("retains explicit hard break %j without visible markers", (source) => {
    expect(html(source)).toContain("<br/>");
    expect(text(source)).toBe("前行后行");
  });

  it("keeps paired backslashes literal without inventing a hard break", () => {
    expect(html("before\\\\\nafter")).not.toContain("<br");
    expect(text("before\\\\\nafter")).toBe("before\\ after");
  });

  it("leaves code tokens and link destinations intact", () => {
    const code = html("前 `literal\ncode` 后");
    expect(code).toContain("literal\ncode");
    const link = html("[链接](https://example.test/a?q=one%20two)\n后文");
    expect(link).toContain('href="https://example.test/a?q=one%20two"');
    expect(link).toContain("后文");
    expect(html("前 $x+y$\n后")).toContain("math");
  });

  it("preserves raw paragraph, fenced code and display-math source bytes", () => {
    const source = "中\n文\n\n另段\n\n```js\nconst x = 1;\n```\n\n$$\nx+y\n$$";
    const parsed = parseMarkdownDocument(source);
    expect(parsed.blocks.map((block) => block.type)).toEqual(["paragraph", "paragraph", "code", "math"]);
    expect(parsed.blocks[0]!.raw).toBe("中\n文");
    expect(parsed.blocks[2]!.code).toBe("const x = 1;");
    expect(parsed.blocks[3]!.mathTex).toBe("x+y");
  });
});
