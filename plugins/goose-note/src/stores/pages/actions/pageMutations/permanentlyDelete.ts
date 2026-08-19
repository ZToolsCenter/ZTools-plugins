import { useNotebooks } from "../../../useNotebooks";
import type { StoreSet, StoreGet } from "../hydrate";
import {
  removePersistedPageSnapshot,
  removePersistedPageSnapshots,
} from "../../persistence";
import { resolveHistoryBackend } from "../../../../lib/history/backend";
import {
  clearLocalSaveTimers,
  pendingLocalSaveContents,
} from "../../folderSync";

export const permanentlyDeletePageAction = async (
  set: StoreSet,
  get: StoreGet,
  id: string,
): Promise<void> => {
  const page = get().pages[id];
  const notebook = page
    ? useNotebooks.getState().notebooks[page.workspaceId]
    : undefined;
  const isLocalFolder = notebook?.source === "local-folder";

  if (isLocalFolder && notebook?.localPath) {
    if (typeof window === "undefined" || !window.gooseFs) return;
    if (!page) return;
    const snapshotPages = get().pages;

    const resolvePathFromId = (pageId: string) => {
      // 兜底：从旧格式 id（local-{nb}-{encoded}）反解路径。
      // 稳定 id 后路径应始终来自 page.localFilePath，此分支仅用于极端兜底。
      const prefix = `local-${page.workspaceId}-`;
      if (!pageId.startsWith(prefix)) return null;
      const encoded = pageId.slice(prefix.length);
      try {
        const relativePath = decodeURIComponent(encoded);
        return `${notebook.localPath}/${relativePath}`;
      } catch {
        return null;
      }
    };

    // 路径优先从 page.localFilePath 取（稳定 id 后是主路径来源）。
    const targetPath = page.localFilePath || resolvePathFromId(id);
    if (!targetPath) return;

    const removedIds = new Set<string>();
    const stack = [id];
    while (stack.length) {
      const currentId = stack.pop()!;
      removedIds.add(currentId);
      Object.values(get().pages).forEach((p) => {
        if (p.parentId === currentId) stack.push(p.id);
      });
    }

    const deleted = page.isFolder
      ? await window.gooseFs.deleteDir(targetPath)
      : await window.gooseFs.deleteFile(targetPath);
    if (!deleted) return;

    // 清理历史快照：必须在 store 记录删除前解析 backend（删后解析不到
    // notebook.localPath）。文件夹删除时连同所有被递归移除的子页一并清理。
    removedIds.forEach((pid) => {
      void resolveHistoryBackend(pid).dropAll(pid);
    });

    // 清理自动保存计时器与待写队列，防止删除后重建同名文件时被 dirty 守卫（load.ts:26）
    // 拒绝加载磁盘内容，也避免计时器到期后对已不存在的页面执行写盘。
    removedIds.forEach((pid) => {
      clearLocalSaveTimers(pid);
      pendingLocalSaveContents.delete(pid);
    });

    set((state) => {
      const newPages = { ...state.pages };
      removedIds.forEach((pid) => delete newPages[pid]);

      // 同步清理 dirtyLocalPageIds，避免删除后重建同名文件被 dirty 守卫拒绝加载。
      const newDirtyLocalPageIds = { ...state.dirtyLocalPageIds };
      removedIds.forEach((pid) => delete newDirtyLocalPageIds[pid]);

      let nextActivePageId = state.activePageId;
      if (removedIds.has(state.activePageId || "")) {
        nextActivePageId = null;
        useNotebooks.getState().setLastActivePage(page.workspaceId, null);
      }

      return {
        pages: newPages,
        activePageId: nextActivePageId,
        dirtyLocalPageIds: newDirtyLocalPageIds,
      };
    });
    removePersistedPageSnapshots(snapshotPages, removedIds);
    return;
  }

  const targetPage = get().pages[id];
  // 清理历史快照：内部页存于 uTools dbStorage（gn:hist: 前缀），永久删除后
  // 若不清理会成为孤儿数据。在 store 记录删除前调用。
  if (targetPage) {
    void resolveHistoryBackend(id).dropAll(id);
  }
  // 清理自动保存计时器与待写队列（对非本地页面无害，统一处理）。
  clearLocalSaveTimers(id);
  pendingLocalSaveContents.delete(id);
  set((state) => {
    const page = state.pages[id];
    if (!page) return state;
    const workspaceId = page.workspaceId;
    const deletingTrashedPage = !!page.trashedAt;
    const newPages = { ...state.pages };
    delete newPages[id];

    // 清理 dirtyLocalPageIds，避免删除后重建同名文件被 dirty 守卫拒绝加载。
    const newDirtyLocalPageIds = { ...state.dirtyLocalPageIds };
    delete newDirtyLocalPageIds[id];

    let newActivePageId = state.activePageId;
    if (state.activePageId === id) {
      if (deletingTrashedPage) {
        const trashedPagesAfterDelete = Object.values(newPages)
          .filter((p) => p.workspaceId === workspaceId && !!p.trashedAt)
          .sort((a, b) => (b.trashedAt ?? 0) - (a.trashedAt ?? 0));

        if (trashedPagesAfterDelete.length > 0) {
          const trashedPagesBeforeDelete = Object.values(state.pages)
            .filter((p) => p.workspaceId === workspaceId && !!p.trashedAt)
            .sort((a, b) => (b.trashedAt ?? 0) - (a.trashedAt ?? 0));

          const deletedPageIndex = trashedPagesBeforeDelete.findIndex(
            (p) => p.id === id,
          );
          const safeCurrentIndex = Math.max(deletedPageIndex, 0);
          const nextIndex =
            safeCurrentIndex >= trashedPagesAfterDelete.length
              ? trashedPagesAfterDelete.length - 1
              : safeCurrentIndex;

          newActivePageId = trashedPagesAfterDelete[nextIndex].id;
        } else {
          newActivePageId = null;
        }
      } else {
        const siblings = Object.values(newPages)
          .filter(
            (p) =>
              p.workspaceId === workspaceId && !p.trashedAt && p.id !== id,
          )
          .sort(
            (a, b) => (a.order ?? a.createdAt) - (b.order ?? b.createdAt),
          );

        if (siblings.length > 0) {
          const deletedPageIndex = Object.values(state.pages)
            .filter((p) => p.workspaceId === workspaceId && !p.trashedAt)
            .sort(
              (a, b) => (a.order ?? a.createdAt) - (b.order ?? b.createdAt),
            )
            .findIndex((p) => p.id === id);

          const nextIndex =
            deletedPageIndex >= siblings.length
              ? siblings.length - 1
              : deletedPageIndex;
          newActivePageId = siblings[nextIndex].id;
        } else {
          newActivePageId = null;
        }
      }
    }

    return {
      pages: newPages,
      activePageId: newActivePageId,
      dirtyLocalPageIds: newDirtyLocalPageIds,
    };
  });
  removePersistedPageSnapshot(targetPage, id);
};
