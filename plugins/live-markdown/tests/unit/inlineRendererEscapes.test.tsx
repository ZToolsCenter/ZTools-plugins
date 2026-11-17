import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { renderInlineMarkdown } from "../../src/core/inlineRenderer";

function html(source: string): string {
  return renderToStaticMarkup(React.createElement(React.Fragment, null, renderInlineMarkdown(source)));
}

function visibleText(markup: string): string {
  return markup.replace(/<[^>]*>/gu, "").replace(/&lt;/gu, "<").replace(/&gt;/gu, ">")
    .replace(/&amp;/gu, "&").replace(/&quot;/gu, '"').replace(/&#x27;/gu, "'");
}

describe("CommonMark punctuation escapes in inline rendering", () => {
  it("renders escaped angle brackets and plus signs literally with source mapping", () => {
    const rendered = html(String.raw`API \<v2\> & C\+\+`);

    expect(visibleText(rendered)).toBe("API <v2> & C++");
    expect(rendered).toContain('data-raw-start="4" data-marker-len="1"');
    expect(rendered).not.toContain('class="md-link"');
  });

  it("supports every ASCII punctuation escape without turning escaped tags into HTML", () => {
    const punctuation = "!\"#$%&'()*+,-./:;<=>?@[\\]^_`{|}~";
    const escaped = Array.from(punctuation, character => `\\${character}`).join("");
    const rendered = html(escaped + String.raw`\<img src="x" onerror="alert(1)">`);

    expect(visibleText(rendered)).toBe(punctuation + '<img src="x" onerror="alert(1)">');
    expect(rendered).not.toContain("<img");
  });

  it("does not turn escaped emphasis delimiters into formatting", () => {
    const rendered = html(String.raw`\*literal*`);

    expect(visibleText(rendered)).toBe("*literal*");
    expect(rendered).not.toContain("<em>");
  });

  it("keeps the CommonMark meaning of paired backslashes before active emphasis", () => {
    const rendered = html(String.raw`\\*active*`);

    expect(visibleText(rendered)).toBe("\\active");
    expect(rendered).toContain("<em>active</em>");
  });

  it("preserves non-punctuation escapes and inline-code contents verbatim", () => {
    const source = String.raw`\a ` + "`" + String.raw`C\+\+ :smile:` + "`";
    const rendered = html(source);

    expect(rendered).toContain(String.raw`\a`);
    expect(rendered).toContain(String.raw`C\+\+ :smile:`);
    expect(rendered).not.toContain("😄");
  });
});
