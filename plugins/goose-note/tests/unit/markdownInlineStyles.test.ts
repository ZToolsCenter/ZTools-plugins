import { expect, test } from "playwright/test";
import { parseInlineMarkdown } from "../../src/lib/export/markdown/parse/inline";
import { jsonContentToMarkdown } from "../../src/lib/export/markdown/serialize";

test("parses Obsidian-style span attributes without importing block styles", () => {
  expect(
    parseInlineMarkdown(
      `<span data-note="x" style='background-color: #ffe; text-align:center; color: rgb(1, 2, 3)'>text</span>`,
    ),
  ).toEqual([
    {
      type: "text",
      text: "text",
      styles: { textColor: "rgb(1, 2, 3)", backgroundColor: "#ffe" },
    },
  ]);
});

test("serializes styled link content with canonical Goose spans", () => {
  const markdown = jsonContentToMarkdown([
    {
      id: "paragraph-1",
      type: "paragraph",
      props: {},
      content: [
        {
          type: "link",
          href: "https://example.com",
          content: [
            {
              type: "text",
              text: "styled",
              styles: {
                textColor: "red",
                backgroundColor: "#ffe",
                underline: true,
              },
            },
          ],
        },
      ],
      children: [],
    },
  ] as any);

  expect(markdown).toBe(
    `[<u><span style="color:red; background-color:#ffe">styled</span></u>](https://example.com)`,
  );
  expect(parseInlineMarkdown(markdown)).toEqual([
    {
      type: "link",
      href: "https://example.com",
      content: [
        {
          type: "text",
          text: "styled",
          styles: {
            textColor: "red",
            backgroundColor: "#ffe",
            underline: true,
          },
        },
      ],
    },
  ]);
});

test("rejects unsafe color fragments during parsing and serialization", () => {
  expect(
    parseInlineMarkdown(
      `<span style='color:red" onclick="alert(1); background-color:url(https://evil.invalid)'>text</span>`,
    ),
  ).toEqual([{ type: "text", text: "text", styles: {} }]);

  const markdown = jsonContentToMarkdown([
    {
      id: "paragraph-1",
      type: "paragraph",
      props: {},
      content: [
        {
          type: "text",
          text: "text",
          styles: {
            textColor: "red",
            backgroundColor: `#fff" onclick="alert(1)`,
          },
        },
      ],
      children: [],
    },
  ] as any);

  expect(markdown).toBe(`<span style="color:red">text</span>`);
  expect(markdown).not.toContain("onclick");
});
