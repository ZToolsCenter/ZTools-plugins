import { expect, test } from "playwright/test";
import type { Page } from "../../src/types";
import { isCommandSearchablePage, shouldIncludePageInCommandScope } from "../../src/pages/workspace/components/command/searchPageFilter";

const pageBase: Page = {
  id: "page-1",
  workspaceId: "notebook-1",
  content: [
    { type: "heading", props: { level: 1 }, content: "测试页面" },
  ],
  isLocked: false,
  fontSize: "default",
  fontFamily: "default",
  createdAt: 1,
  updatedAt: 1,
};

test("本地文件夹的目录节点不进入搜索，但文件仍可搜索", () => {
  const notebooks = {
    "notebook-1": { source: "local-folder" as const },
  };

  expect(
    isCommandSearchablePage({ ...pageBase, isFolder: true }, notebooks),
  ).toBe(false);
  expect(
    isCommandSearchablePage(
      { ...pageBase, isFolder: false, localFilePath: "/notes/test.md" },
      notebooks,
    ),
  ).toBe(true);
});

test("内置记事本的父页面仍属于可搜索页面", () => {
  expect(
    isCommandSearchablePage(
      { ...pageBase, isFolder: true },
      { "notebook-1": { source: "default" } },
    ),
  ).toBe(true);
});

test("开启 excludeFromGlobalSearch 后仅在所有记事本搜索中隐藏", () => {
  const notebooks = {
    "notebook-1": {
      source: "default" as const,
      excludeFromGlobalSearch: true,
    },
  };

  expect(isCommandSearchablePage(pageBase, notebooks)).toBe(true);
  expect(
    shouldIncludePageInCommandScope(pageBase, notebooks, true),
  ).toBe(false);
  expect(
    shouldIncludePageInCommandScope(pageBase, notebooks, false),
  ).toBe(true);
});

test("未开启 excludeFromGlobalSearch 时全局搜索仍可见", () => {
  const notebooks = {
    "notebook-1": {
      source: "local-folder" as const,
      excludeFromGlobalSearch: false,
    },
  };

  expect(
    shouldIncludePageInCommandScope(pageBase, notebooks, true),
  ).toBe(true);
});
