import { resolveNotebookLandingPageId } from "@/lib/notebookNavigation";
import { ensureEditorFontAvailable } from "@/lib/fontLoader";
import { useNotebooks } from "@/stores/useNotebooks";
import { usePages } from "@/stores/usePages";
import { useSettings } from "@/stores/useSettings";
import { useTabs } from "@/stores/useTabs";
import type { Page } from "@/types";

export type LastNoteRestoreResult =
  | "restored"
  | "already-active"
  | "not-ready"
  | "disabled"
  | "no-history"
  | "local-folder-unavailable";

type WorkspaceStartupGateOptions = {
  prepare: () => Promise<unknown> | unknown;
  render: () => void;
  renderError: (error: unknown) => void;
};

/**
 * 主工作区的首帧提交门。prepare 未完成前绝不调用 render；失败则提交可恢复的错误页。
 * 独立成纯函数是为了能直接验证“恢复先于 React render”这一时序约束。
 */
export async function renderWorkspaceAfterStartup({
  prepare,
  render,
  renderError,
}: WorkspaceStartupGateOptions): Promise<"rendered" | "error"> {
  try {
    await prepare();
    render();
    return "rendered";
  } catch (error) {
    renderError(error);
    return "error";
  }
}

const isVisiblePageInNotebook = (page: Page | undefined, notebookId: string) =>
  !!page && page.workspaceId === notebookId && !page.trashedAt;

const resolveWorkspaceStartupPageId = (
  notebookId: string | null,
): string | null => {
  if (!notebookId) return null;

  const notebooksStore = useNotebooks.getState();
  const pages = usePages.getState().pages;
  const lastPageId = notebooksStore.getLastActivePage(notebookId);
  if (lastPageId && isVisiblePageInNotebook(pages[lastPageId], notebookId)) {
    return lastPageId;
  }

  // 内部记事本沿用统一的落点规则；本地文件夹只有在启动扫描完成后才会走到这里。
  const regularLandingPageId = resolveNotebookLandingPageId(notebookId);
  if (regularLandingPageId) return regularLandingPageId;

  return (
    Object.values(pages)
      .filter((page) => isVisiblePageInNotebook(page, notebookId))
      .sort(
        (left, right) =>
          (left.order ?? left.createdAt) - (right.order ?? right.createdAt),
      )[0]?.id ?? null
  );
};

export const clearWorkspaceStartupSelection = () => {
  useTabs.setState({ activeTabId: null });
  const pagesStore = usePages.getState();
  if (pagesStore.activePageId) {
    pagesStore.setActivePage(null);
  }
};

/**
 * 在工作区首帧前恢复上次笔记。
 *
 * 页面数据和设置已由 bootstrap 水合完成；这里同步落定 page + tab，避免工作区
 * 先以 activePageId=null 绘制首页，再由 React effect 切回历史内容。
 */
export function restoreLastNoteIfNeeded(): LastNoteRestoreResult {
  const pagesStore = usePages.getState();
  if (!pagesStore.hydrated) return "not-ready";
  if (pagesStore.activePageId) return "already-active";
  if (!useSettings.getState().privacy.autoOpenLastNote) return "disabled";

  const targetPageId = resolveWorkspaceStartupPageId(
    useNotebooks.getState().activeNotebookId,
  );
  if (!targetPageId) return "no-history";

  // openTab 先同步选中/创建标签；setActivePage 再同步落定页面。openTab 内部排队的
  // setActivePage 随后会因 id 相同直接返回，不会造成二次切页。
  useTabs.getState().openTab(targetPageId);
  pagesStore.setActivePage(targetPageId);
  return "restored";
}

/**
 * 完成主工作区首帧所需的全部异步恢复。
 *
 * 内部页面在 pages hydrate 后已就绪；本地文件夹页面必须先扫描磁盘，否则同步 restore
 * 只能得到空结果，React 就会先绘制首页，再由挂载后的 effect 补上历史页面。
 */
export async function prepareWorkspaceStartup(): Promise<LastNoteRestoreResult> {
  const pagesStore = usePages.getState();
  if (!pagesStore.hydrated) return "not-ready";

  if (!useSettings.getState().privacy.autoOpenLastNote) {
    clearWorkspaceStartupSelection();
    return "disabled";
  }

  const notebooksStore = useNotebooks.getState();
  const activeNotebookId = notebooksStore.activeNotebookId;
  const activeNotebook = activeNotebookId
    ? notebooksStore.notebooks[activeNotebookId]
    : undefined;

  if (
    activeNotebookId &&
    activeNotebook?.source === "local-folder" &&
    activeNotebook.localPath
  ) {
    const gooseFs = typeof window !== "undefined" ? window.gooseFs : undefined;
    if (!gooseFs) {
      clearWorkspaceStartupSelection();
      return "local-folder-unavailable";
    }

    try {
      const exists = gooseFs.existsAsync
        ? await gooseFs.existsAsync(activeNotebook.localPath)
        : gooseFs.exists(activeNotebook.localPath);
      if (!exists) {
        notebooksStore.updateNotebook(activeNotebookId, {
          localPathMissing: true,
        });
        pagesStore.removePagesByWorkspaceId(activeNotebookId);
        clearWorkspaceStartupSelection();
        return "local-folder-unavailable";
      }

      if (activeNotebook.localPathMissing) {
        notebooksStore.updateNotebook(activeNotebookId, {
          localPathMissing: false,
        });
      }
      await pagesStore.loadLocalFolderPages(
        activeNotebookId,
        activeNotebook.localPath,
      );
    } catch (error) {
      // 单个本地目录不可读不应阻止整个应用出现；loadLocalFolderPages 已记录 error 状态。
      console.error("[bootstrap] 恢复本地文件夹失败", error);
      clearWorkspaceStartupSelection();
      return "local-folder-unavailable";
    }
  }

  const restoreResult = restoreLastNoteIfNeeded();
  const activePageId = usePages.getState().activePageId;
  const activePage = activePageId
    ? usePages.getState().pages[activePageId]
    : undefined;
  await ensureEditorFontAvailable(
    activePage?.fontFamily,
    useSettings.getState().customFonts,
  );
  return restoreResult;
}
