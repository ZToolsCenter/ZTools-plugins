import { expect, test } from "playwright/test";
import type { JSONContent, Page } from "../../src/types";
import {
  guardPageForAiWrite,
  writePageContentSafely,
} from "../../src/lib/notebook-ai/pageWriteGuard";
import { useNotebooks } from "../../src/stores/useNotebooks";
import { usePages } from "../../src/stores/usePages";
import { pendingLocalSaveContents } from "../../src/stores/pages/folderSync";

const notebookId = "notebook-a";
const pageId = "page-a";
const originalWritePageContent = usePages.getState().writePageContent;

function content(text: string): JSONContent {
  return [{ type: "paragraph", content: text }];
}

function createPage(overrides: Partial<Page> = {}): Page {
  return {
    id: pageId,
    workspaceId: notebookId,
    content: content("原内容"),
    isLocked: false,
    fontSize: "default",
    fontFamily: "default",
    createdAt: 1,
    updatedAt: 1,
    ...overrides,
  };
}

test.beforeEach(() => {
  useNotebooks.setState({
    notebooks: {
      [notebookId]: {
        id: notebookId,
        name: "A",
        createdAt: 1,
        updatedAt: 1,
      },
    },
    activeNotebookId: notebookId,
  });
  usePages.setState({
    pages: { [pageId]: createPage() },
    activePageId: pageId,
    writePageContent: originalWritePageContent,
  });
});

test.afterEach(() => {
  pendingLocalSaveContents.delete(pageId);
  usePages.setState({ writePageContent: originalWritePageContent });
});

test("guard 拒绝跨笔记本、文件夹、回收站、锁定和本地读取错误页面", () => {
  expect(
    guardPageForAiWrite(pageId, { expectedNotebookId: "notebook-b" }),
  ).toMatchObject({ ok: false, code: "notebook-mismatch" });

  const cases: Array<[Partial<Page>, string]> = [
    [{ isFolder: true }, "page-is-folder"],
    [{ trashedAt: 10 }, "page-in-trash"],
    [{ isLocked: true }, "page-locked"],
    [{ localReadState: "error" }, "local-read-error"],
  ];
  for (const [overrides, code] of cases) {
    usePages.setState({ pages: { [pageId]: createPage(overrides) } });
    expect(
      guardPageForAiWrite(pageId, { expectedNotebookId: notebookId }),
    ).toMatchObject({ ok: false, code });
  }
});

test("guard 用 updatedAt 和内容签名拒绝覆盖并发编辑", () => {
  const first = guardPageForAiWrite(pageId, {
    expectedNotebookId: notebookId,
  });
  expect(first.ok).toBe(true);
  if (!first.ok) return;

  usePages.setState({
    pages: {
      [pageId]: createPage({ content: content("用户新编辑") }),
    },
  });
  expect(
    guardPageForAiWrite(pageId, {
      expectedNotebookId: notebookId,
      expectedRevision: {
        updatedAt: first.updatedAt,
        contentSignature: first.contentSignature,
      },
    }),
  ).toMatchObject({ ok: false, code: "page-changed" });
});

test("本地写入失败时仅回滚仍等于本轮尝试值的内容", async () => {
  const attempted = content("AI 尝试内容");
  usePages.setState({
    writePageContent: async (id, nextContent) => {
      pendingLocalSaveContents.set(id, nextContent);
      usePages.setState((state) => ({
        pages: {
          ...state.pages,
          [id]: { ...state.pages[id], content: nextContent },
        },
      }));
      await Promise.resolve();
      return false;
    },
  });

  const result = await writePageContentSafely(pageId, attempted, {
    expectedNotebookId: notebookId,
  });

  expect(result).toMatchObject({ ok: false, code: "write-failed" });
  expect(usePages.getState().pages[pageId].content).toEqual(content("原内容"));
  expect(pendingLocalSaveContents.has(pageId)).toBe(false);
  expect(usePages.getState().dirtyLocalPageIds[pageId]).toBe(false);
});

test("写入失败期间出现用户编辑时不回滚覆盖用户内容", async () => {
  let finishWrite: ((saved: boolean) => void) | undefined;
  usePages.setState({
    writePageContent: (id, nextContent) => {
      usePages.setState((state) => ({
        pages: {
          ...state.pages,
          [id]: { ...state.pages[id], content: nextContent },
        },
      }));
      return new Promise<boolean>((resolve) => {
        finishWrite = resolve;
      });
    },
  });

  const pending = writePageContentSafely(pageId, content("AI 尝试内容"), {
    expectedNotebookId: notebookId,
  });
  usePages.setState((state) => ({
    pages: {
      ...state.pages,
      [pageId]: { ...state.pages[pageId], content: content("用户并发编辑") },
    },
  }));
  finishWrite?.(false);
  const result = await pending;

  expect(result).toMatchObject({ ok: false, code: "write-failed" });
  expect(usePages.getState().pages[pageId].content).toEqual(
    content("用户并发编辑"),
  );
});
