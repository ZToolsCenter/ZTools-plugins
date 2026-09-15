import { expect, test } from "playwright/test";
import { normalizeBlockContent } from "../../src/components/editor/utils/blocknote-content";

test("连续有序列表只保留首项的显式起始序号", () => {
  const normalized = normalizeBlockContent([
    {
      type: "numberedListItem",
      props: { start: 3 },
      content: "第三项",
    },
    {
      type: "numberedListItem",
      props: { start: 4, textColor: "red" },
      content: "第四项",
    },
    { type: "paragraph", content: "分隔" },
    {
      type: "numberedListItem",
      props: { start: 8 },
      content: "新的第八项",
    },
  ]);

  expect(normalized[0].props?.start).toBe(3);
  expect(normalized[1].props).toEqual({ textColor: "red" });
  expect(normalized[3].props?.start).toBe(8);
});

test("嵌套有序列表独立保留首项起始序号并清理后续冗余值", () => {
  const normalized = normalizeBlockContent([
    {
      type: "numberedListItem",
      props: { start: 5 },
      content: "父项",
      children: [
        {
          type: "numberedListItem",
          props: { start: 7 },
          content: "嵌套第七项",
        },
        {
          type: "numberedListItem",
          props: { start: 8 },
          content: "嵌套第八项",
        },
      ],
    },
    {
      type: "numberedListItem",
      props: { start: 6 },
      content: "父级后续项",
    },
  ]);

  expect(normalized[0].props?.start).toBe(5);
  expect(normalized[1].props?.start).toBeUndefined();
  expect(normalized[0].children?.[0].props?.start).toBe(7);
  expect(normalized[0].children?.[1].props?.start).toBeUndefined();
});
