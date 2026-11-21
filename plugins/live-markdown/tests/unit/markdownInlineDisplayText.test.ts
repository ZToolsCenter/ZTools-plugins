import { describe, expect, it } from "vitest";
import { markdownInlineDisplayText } from "../../src/core/markdownInlineDisplayText";
import { parseMarkdownDocument } from "../../src/core/markdownParser";

describe("Markdown inline display projection", () => {
  it.each([
    [String.raw`API \<v2\> & C\+\+`, "API <v2> & C++"],
    [String.raw`接口 \(v2\) \[beta\]`, "接口 (v2) [beta]"],
    [String.raw`\*literal* with **bold**`, "*literal* with bold"],
    [String.raw`a \\*active*`, "a \\active"],
    [String.raw`\:smile: :smile:`, ":smile: 😄"]
  ])("projects escaped punctuation and formatting without activating escaped marks: %s", (source, expected) => {
    expect(markdownInlineDisplayText(source)).toBe(expected);
  });

  it("keeps inline-code escapes and shortcode text literal while rendering surrounding emoji", () => {
    const codeSpan = "`" + String.raw`C\+\+ :smile:` + "`";
    const source = `Use ${codeSpan} and :smile:`;

    expect(markdownInlineDisplayText(source)).toBe(String.raw`Use C\+\+ :smile: and 😄`);
  });

  it("shows link labels instead of destinations and keeps nested emphasis readable", () => {
    expect(markdownInlineDisplayText("Read [the **API**](https://example.test/v2) now"))
      .toBe("Read the API now");
  });

  it("returns an oversized title literally instead of parsing it on the UI thread", () => {
    const source = String.raw`\*`.repeat(32_769);

    expect(source.length).toBeGreaterThan(64 * 1024);
    expect(markdownInlineDisplayText(source) === source).toBe(true);
  });

  it("returns deeply nested inline syntax literally before parser recursion can overflow", () => {
    const source = "*".repeat(5_000) + "x" + "*".repeat(5_000);

    expect(source.length).toBeGreaterThan(4 * 1024);
    expect(markdownInlineDisplayText(source)).toBe(source);
  });

  it("changes only the outline display title, not source, block identity, slug, or line", () => {
    const source = String.raw`# API \<v2\> C\+\+ **bold** ` + "`" + String.raw`code\+\+ :smile:` + "` :smile:\n";
    const parsed = parseMarkdownDocument(source);
    const heading = parsed.blocks.find(block => block.type === "heading");
    const outline = parsed.outline[0];

    expect(heading).toBeDefined();
    expect(outline).toMatchObject({
      id: `outline-${heading!.id}`,
      blockId: heading!.id,
      slug: heading!.slug,
      line: heading!.startLine,
      text: String.raw`API <v2> C++ bold code\+\+ :smile: 😄`
    });
    expect(heading!.text).toContain(String.raw`\<v2\>`);
    expect(heading!.slug).toBeDefined();
  });
});
