import { expect, test } from "playwright/test";
import { parseInlineMarkdown } from "../../src/lib/export/markdown/parse/inline";

test("parseInlineMarkdown preserves styles inside link text", () => {
  expect(parseInlineMarkdown("[**Bold** and `code`](https://example.com)")).toEqual([
    {
      type: "link",
      href: "https://example.com",
      content: [
        { type: "text", text: "Bold", styles: { bold: true } },
        { type: "text", text: " and ", styles: {} },
        { type: "text", text: "code", styles: { code: true } },
      ],
    },
  ]);
});
