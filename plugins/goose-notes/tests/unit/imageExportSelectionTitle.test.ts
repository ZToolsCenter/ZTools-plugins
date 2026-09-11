import { expect, test } from "playwright/test";
import { getSelectionBlocksToRender } from "../../src/lib/imageExport/renderer";

const pageTitleBlock = {
  id: "title",
  type: "heading",
  props: { level: 1 },
  content: [{ type: "text", text: "快捷键指南", styles: {} }],
};

const bodyBlock = {
  id: "body",
  type: "paragraph",
  content: [{ type: "text", text: "正文", styles: {} }],
};

test("选中页面标题且显示生成标题时去掉重复 H1", () => {
  const blocks = [pageTitleBlock, bodyBlock] as any;

  const result = getSelectionBlocksToRender(blocks, "快捷键指南", true);

  expect(result).toEqual([bodyBlock]);
  expect(blocks).toHaveLength(2);
});

test("关闭生成标题时保留选中的页面标题", () => {
  const blocks = [pageTitleBlock, bodyBlock] as any;

  expect(getSelectionBlocksToRender(blocks, "快捷键指南", false)).toBe(
    blocks,
  );
});

test("不同内容或不同级别的章节标题不会被误删", () => {
  const otherH1 = {
    ...pageTitleBlock,
    content: [{ type: "text", text: "章节标题", styles: {} }],
  };
  const matchingH2 = {
    ...pageTitleBlock,
    props: { level: 2 },
  };

  expect(getSelectionBlocksToRender([otherH1, bodyBlock] as any, "快捷键指南", true))
    .toHaveLength(2);
  expect(getSelectionBlocksToRender([matchingH2, bodyBlock] as any, "快捷键指南", true))
    .toHaveLength(2);
});
