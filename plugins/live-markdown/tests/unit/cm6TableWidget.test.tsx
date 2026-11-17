import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { MarkdownTablePreview, TableBlockWidget } from "../../src/core/cm6/tableBlockWidget";

describe("CM6 Markdown table widget", () => {
  it("renders GFM escaped pipes in text/code spans and normalizes row widths", () => {
    const source = [
      "| label | code | value |",
      "| :--- | :---: | ---: |",
      "| left \\| right | `first\\|second` | 12 | extra |"
    ].join("\n");
    const sourceBeforePreview = source;
    const html = renderToStaticMarkup(<MarkdownTablePreview rawTable={source} />);

    expect((html.match(/<th\b/g) || []).length).toBe(3);
    expect((html.match(/<td\b/g) || []).length).toBe(3);
    expect(html).toContain("left | right");
    expect(html).toContain("<code");
    expect(html).toContain("first|second");
    expect(html).toContain("text-align:center");
    expect(html).toContain("text-align:right");
    expect(html).not.toContain("extra");
    expect(source).toContain("left \\| right | `first\\|second`");
    expect(source).toBe(sourceBeforePreview);
  });

  it("follows GFM escaped-pipe behavior inside code spans and emphasis", () => {
    const rawTable = [
      "| content |",
      "| --- |",
      String.raw`| **left \| right** and ` + "`\\|`" + " |"
    ].join("\n");
    const html = renderToStaticMarkup(<MarkdownTablePreview rawTable={rawTable} />);

    expect(html).toContain("<strong>left | right</strong>");
    expect(html).toMatch(/<code\b[^>]*>\|<\/code>/);
    expect(rawTable).toContain(String.raw`\|`);
  });

  it("does not reuse a table widget when its source range moves", () => {
    const original = new TableBlockWidget("| a |\n| --- |\n| b |", 10, 30);
    const shifted = new TableBlockWidget("| a |\n| --- |\n| b |", 11, 31);

    expect(original.eq(shifted)).toBe(false);
  });

  it("renders safe inline Markdown for emphasis, links, and dollar-delimited formulas", () => {
    const html = renderToStaticMarkup(
      <MarkdownTablePreview rawTable={[
        "| text | link | formula |",
        "| --- | --- | --- |",
        "| **bold** | [guide](https://example.test/docs) | $x^2$ |"
      ].join("\n")} />
    );

    expect(html).toContain("<strong>bold</strong>");
    expect(html).toContain('href="https://example.test/docs"');
    expect(html).toContain("ty-math-inline-render");
  });

  it("escapes raw HTML in table cells instead of injecting it", () => {
    const html = renderToStaticMarkup(
      <MarkdownTablePreview rawTable={[
        "| content |",
        "| --- |",
        "| <script>alert(1)</script> |"
      ].join("\n")} />
    );

    expect(html).toContain("&lt;script&gt;");
    expect(html).not.toContain("<script>");
  });
});
