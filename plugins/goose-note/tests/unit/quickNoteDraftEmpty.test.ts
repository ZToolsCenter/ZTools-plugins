import { expect, test } from "playwright/test";
import { isQuickNoteDraftEmpty } from "../../src/stores/useQuickNote";
import type { JSONContent } from "../../src/types";

const content = (blocks: unknown[]): JSONContent => blocks as JSONContent;

test("空文本块与只含空白字符的多块草稿视为空白", () => {
  expect(isQuickNoteDraftEmpty(null)).toBe(true);
  expect(
    isQuickNoteDraftEmpty(
      content([
        { type: "paragraph", content: [] },
        { type: "heading", content: [{ type: "text", text: "  " }] },
      ]),
    ),
  ).toBe(true);
});

test("文本与嵌套子块会标记槽位为有内容", () => {
  expect(
    isQuickNoteDraftEmpty(
      content([
        {
          type: "toggleListItem",
          content: [],
          children: [
            {
              type: "paragraph",
              content: [{ type: "text", text: "子内容" }],
            },
          ],
        },
      ]),
    ),
  ).toBe(false);
  expect(
    isQuickNoteDraftEmpty(
      content([
        {
          type: "paragraph",
          content: [{ type: "link", content: [{ text: "链接" }] }],
        },
      ]),
    ),
  ).toBe(false);
});

test("没有行内文本的结构化媒体块仍视为真实内容", () => {
  expect(
    isQuickNoteDraftEmpty(
      content([
        { type: "image", props: { url: "data:image/png;base64,AA==" } },
      ]),
    ),
  ).toBe(false);
  expect(
    isQuickNoteDraftEmpty(content([{ type: "table", content: { rows: [] } }])),
  ).toBe(false);
});
