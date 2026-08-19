import { expect, test } from "playwright/test";
import type { Page } from "../../src/types";
import {
  getPageTitle,
  UNTITLED_PAGE_TITLE,
  withInternalPageTitle,
} from "../../src/components/editor/utils/page-title";

const pageBase: Omit<Page, "content"> = {
  id: "page-1",
  workspaceId: "notebook-1",
  isFolder: false,
  isLocked: false,
  fontSize: "default",
  fontFamily: "default",
  createdAt: 1,
  updatedAt: 1,
  order: 1,
};

test("空的内部页和本地文件名统一显示为未命名", () => {
  expect(
    getPageTitle({
      ...pageBase,
      content: [
        { type: "heading", props: { level: 1 }, content: "" },
        { type: "paragraph", content: "正文" },
      ],
    }),
  ).toBe(UNTITLED_PAGE_TITLE);

  expect(
    getPageTitle({
      ...pageBase,
      content: [],
      localFilePath: "/notes/.md",
    }),
  ).toBe(UNTITLED_PAGE_TITLE);
});

test("正文旧快照合并顶栏最新标题且不修改传入内容", () => {
  const editorSnapshot = [
    { type: "heading", props: { level: 1 }, content: "旧标题" },
    { type: "paragraph", content: "新正文" },
  ];
  const merged = withInternalPageTitle(editorSnapshot, "新标题") as any[];

  expect(merged[0]?.content).toBe("新标题");
  expect(merged[1]?.content).toBe("新正文");
  expect(editorSnapshot[0]?.content).toBe("旧标题");
});

test("空顶栏名称持久化为未命名", () => {
  const merged = withInternalPageTitle(
    [{ type: "paragraph", content: "正文" }],
    "   ",
  ) as any[];

  expect(merged[0]).toMatchObject({
    type: "heading",
    props: { level: 1 },
    content: UNTITLED_PAGE_TITLE,
  });
  expect(merged[1]?.content).toBe("正文");
});
