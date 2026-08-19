import type { JSONContent, Page } from "@/types";
import { useNotebooks } from "@/stores/useNotebooks";
import { usePages } from "@/stores/usePages";
import {
  clearLocalSaveTimers,
  pendingLocalSaveContents,
} from "@/stores/pages/folderSync";

export type PageWriteGuardCode =
  | "notebook-not-found"
  | "page-not-found"
  | "notebook-mismatch"
  | "page-is-folder"
  | "page-in-trash"
  | "page-locked"
  | "local-read-error"
  | "page-changed"
  | "write-failed";

export type NotebookWriteGuardResult =
  | { ok: true; notebookId: string }
  | { ok: false; code: PageWriteGuardCode; error: string };

export type PageWriteGuardResult =
  | {
      ok: true;
      pageId: string;
      notebookId: string;
      page: Page;
      updatedAt: number;
      contentSignature: string;
    }
  | { ok: false; code: PageWriteGuardCode; error: string };

export type SafePageWriteResult =
  | { ok: true; pageId: string }
  | { ok: false; code: PageWriteGuardCode; error: string };

export interface ExpectedPageRevision {
  updatedAt: number;
  contentSignature: string;
}

export function getPageContentSignature(content: unknown): string {
  try {
    return JSON.stringify(content ?? null);
  } catch {
    return "";
  }
}

export function guardNotebookForAiWrite(
  notebookId: string,
): NotebookWriteGuardResult {
  if (!notebookId || !useNotebooks.getState().notebooks[notebookId]) {
    return {
      ok: false,
      code: "notebook-not-found",
      error: notebookId ? `笔记本 ${notebookId} 不存在` : "未找到目标笔记本",
    };
  }
  return { ok: true, notebookId };
}

export function guardPageForAiWrite(
  pageId: string,
  options: {
    expectedNotebookId?: string | null;
    expectedRevision?: ExpectedPageRevision;
  } = {},
): PageWriteGuardResult {
  const page = usePages.getState().pages[pageId];
  if (!page) {
    return {
      ok: false,
      code: "page-not-found",
      error: pageId ? `页面 ${pageId} 不存在` : "当前没有打开页面",
    };
  }

  const notebook = useNotebooks.getState().notebooks[page.workspaceId];
  if (!notebook) {
    return {
      ok: false,
      code: "notebook-not-found",
      error: `页面所属笔记本 ${page.workspaceId} 不存在`,
    };
  }
  if (
    options.expectedNotebookId &&
    page.workspaceId !== options.expectedNotebookId
  ) {
    return {
      ok: false,
      code: "notebook-mismatch",
      error: "目标页面不属于当前 AI 会话绑定的笔记本",
    };
  }
  if (page.isFolder) {
    return { ok: false, code: "page-is-folder", error: "文件夹不能写入正文" };
  }
  if (page.trashedAt) {
    return { ok: false, code: "page-in-trash", error: "回收站页面不能被修改" };
  }
  if (page.isLocked) {
    return { ok: false, code: "page-locked", error: "页面已锁定，不能修改" };
  }
  if (page.localReadState === "error") {
    return {
      ok: false,
      code: "local-read-error",
      error: page.localReadError
        ? `本地文件读取失败：${page.localReadError}`
        : "本地文件读取失败，不能覆盖现有内容",
    };
  }

  const contentSignature = getPageContentSignature(page.content);
  if (
    options.expectedRevision &&
    (page.updatedAt !== options.expectedRevision.updatedAt ||
      contentSignature !== options.expectedRevision.contentSignature)
  ) {
    return {
      ok: false,
      code: "page-changed",
      error: "页面内容已发生变化，为避免覆盖新的编辑，本次写入已取消",
    };
  }

  return {
    ok: true,
    pageId,
    notebookId: page.workspaceId,
    page,
    updatedAt: page.updatedAt,
    contentSignature,
  };
}

function cloneContent<T>(content: T): T {
  if (typeof structuredClone === "function") return structuredClone(content);
  return JSON.parse(JSON.stringify(content)) as T;
}

async function runSafePageWrite(
  pageId: string,
  operation: () => Promise<boolean>,
  options: {
    expectedNotebookId?: string | null;
    expectedRevision?: ExpectedPageRevision;
  },
): Promise<SafePageWriteResult> {
  const guard = guardPageForAiWrite(pageId, options);
  if (!guard.ok) return guard;

  const beforeContent = cloneContent(guard.page.content);
  let writePromise: Promise<boolean>;
  try {
    writePromise = operation();
  } catch {
    return {
      ok: false,
      code: "write-failed",
      error: "页面写入失败，未保存本次修改",
    };
  }
  // Store 写入在第一个 await 之前同步发生；立刻记录本轮实际尝试写入的内容。
  const attemptedContent = usePages.getState().pages[pageId]?.content;
  const attemptedSignature = getPageContentSignature(attemptedContent);

  let saved: boolean;
  try {
    saved = await writePromise;
  } catch {
    saved = false;
  }
  if (saved) return { ok: true, pageId };

  const current = usePages.getState().pages[pageId];
  if (
    current &&
    attemptedContent !== undefined &&
    getPageContentSignature(current.content) === attemptedSignature
  ) {
    const pending = pendingLocalSaveContents.get(pageId);
    if (getPageContentSignature(pending) === attemptedSignature) {
      pendingLocalSaveContents.delete(pageId);
      clearLocalSaveTimers(pageId);
    }
    usePages
      .getState()
      .updatePage(pageId, { content: beforeContent }, { silent: true });
    usePages.setState((state) => ({
      dirtyLocalPageIds: { ...state.dirtyLocalPageIds, [pageId]: false },
    }));
  }

  return {
    ok: false,
    code: "write-failed",
    error: "页面写入失败，未保存本次修改",
  };
}

export async function writePageContentSafely(
  pageId: string,
  content: JSONContent,
  options: {
    expectedNotebookId?: string | null;
    expectedRevision?: ExpectedPageRevision;
  } = {},
): Promise<SafePageWriteResult> {
  return runSafePageWrite(
    pageId,
    () => usePages.getState().writePageContent(pageId, content, "replace"),
    options,
  );
}

export async function appendPageContentSafely(
  pageId: string,
  content: JSONContent,
  options: { expectedNotebookId?: string | null } = {},
): Promise<SafePageWriteResult> {
  return runSafePageWrite(
    pageId,
    () => usePages.getState().appendPageContent(pageId, content),
    options,
  );
}
