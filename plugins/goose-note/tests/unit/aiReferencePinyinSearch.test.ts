import { expect, test } from "playwright/test";
import type { Page } from "../../src/types";
import type { Notebook } from "../../src/stores/useNotebooks";
import { getAiReferenceSuggestionItems } from "../../src/components/editor/ai/composer/referenceLookup";

function makePage(
  id: string,
  title: string,
  overrides: Partial<Page> = {},
): Page {
  return {
    id,
    workspaceId: "notebook-1",
    content: {
      type: "doc",
      content: [
        {
          type: "heading",
          props: { level: 1 },
          content: [{ type: "text", text: title }],
        },
      ],
    },
    isLocked: false,
    fontSize: "default",
    fontFamily: "default",
    createdAt: 1,
    updatedAt: 1,
    ...overrides,
  };
}

const notebooks: Record<string, Notebook> = {
  "notebook-1": {
    id: "notebook-1",
    name: "盛世浩淼",
    createdAt: 1,
    updatedAt: 1,
  },
};

const pages: Record<string, Page> = {
  "page-shuju": makePage("page-shuju", "数据中台-低代码"),
  "page-yongyou": makePage("page-yongyou", "用友打包调试流程"),
  "page-english": makePage("page-english", "backend-start"),
  "page-trashed": makePage("page-trashed", "数据仓库", {
    trashedAt: 100,
  }),
};

test("中文标题支持拼音模糊匹配", () => {
  const byFirstLetter = getAiReferenceSuggestionItems(
    "shu",
    pages,
    notebooks,
    "notebook-1",
  );
  expect(byFirstLetter.map((item) => item.pageId)).toContain("page-shuju");
  expect(byFirstLetter.map((item) => item.title)).toContain("数据中台-低代码");

  const byInitials = getAiReferenceSuggestionItems(
    "sjzt",
    pages,
    notebooks,
    "notebook-1",
  );
  expect(byInitials.map((item) => item.pageId)).toEqual(["page-shuju"]);

  const byYongYou = getAiReferenceSuggestionItems(
    "yy",
    pages,
    notebooks,
    "notebook-1",
  );
  expect(byYongYou.map((item) => item.pageId)).toContain("page-yongyou");
});

test("原文子串匹配仍然可用，回收站页面不出现", () => {
  const byChinese = getAiReferenceSuggestionItems(
    "低代码",
    pages,
    notebooks,
    "notebook-1",
  );
  expect(byChinese.map((item) => item.pageId)).toEqual(["page-shuju"]);

  const byEnglish = getAiReferenceSuggestionItems(
    "backend",
    pages,
    notebooks,
    "notebook-1",
  );
  expect(byEnglish.map((item) => item.pageId)).toEqual(["page-english"]);

  const byTrashedPinyin = getAiReferenceSuggestionItems(
    "sjck",
    pages,
    notebooks,
    "notebook-1",
  );
  expect(byTrashedPinyin).toHaveLength(0);
});

test("空 query 返回当前笔记本可用页面", () => {
  const items = getAiReferenceSuggestionItems(
    "",
    pages,
    notebooks,
    "notebook-1",
  );
  expect(items.map((item) => item.pageId).sort()).toEqual([
    "page-english",
    "page-shuju",
    "page-yongyou",
  ]);
});

test("本地文件副标题只展示相对路径，不重复「本地文件 · 笔记本名」", () => {
  const localNotebooks: Record<string, Notebook> = {
    "local-nb": {
      id: "local-nb",
      name: "0Markdown",
      createdAt: 1,
      updatedAt: 1,
      localPath: "/Users/me/0Markdown",
    },
    "other-nb": {
      id: "other-nb",
      name: "其他库",
      createdAt: 1,
      updatedAt: 1,
      localPath: "/Users/me/Other",
    },
  };
  const localPages: Record<string, Page> = {
    "local-codex": makePage("local-codex", "Codex", {
      workspaceId: "local-nb",
      localFilePath: "/Users/me/0Markdown/Dev/New Project/Codex.md",
    }),
    "other-page": makePage("other-page", "备忘", {
      workspaceId: "other-nb",
      localFilePath: "/Users/me/Other/notes/memo.md",
    }),
  };

  const inActive = getAiReferenceSuggestionItems(
    "Codex",
    localPages,
    localNotebooks,
    "local-nb",
  );
  expect(inActive).toHaveLength(1);
  expect(inActive[0]?.description).toBe("Dev/New Project/Codex.md");

  // 本地文件标题取自文件名（去扩展名），不是正文 H1
  const crossNotebook = getAiReferenceSuggestionItems(
    "memo",
    localPages,
    localNotebooks,
    "local-nb",
  );
  expect(crossNotebook).toHaveLength(1);
  expect(crossNotebook[0]?.title).toBe("memo");
  expect(crossNotebook[0]?.description).toBe("其他库 · notes/memo.md");
});
