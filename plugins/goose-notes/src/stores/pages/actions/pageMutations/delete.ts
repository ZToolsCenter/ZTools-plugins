import { useNotebooks } from "../../../useNotebooks";
import { useSidebarView } from "../../../useSidebarView";
import type { StoreSet, StoreGet } from "../hydrate";
import { flushEditorContent } from "../flushEditor";
import { resolveVisibleRowAfterDeletion } from "./helpers";
import {
  persistPageSnapshots,
  removePersistedPageSnapshots,
} from "../../persistence";

/**
 * 删除后把侧栏的键盘焦点/选中同步到新的合理行。
 * 否则 focusedItem 仍指向已删除项，react-complex-tree 焦点丢失，
 * 连续删除与方向键导航的起点会错乱。
 */
function syncSidebarSelectionAfterDelete(
  workspaceId: string,
  removedIds: Set<string>,
  get: StoreGet,
  fallbackPageId?: string | null,
): void {
  const view = useSidebarView.getState();
  const focused = view.focusedByNotebook[workspaceId];
  const selected = view.selectedByNotebook[workspaceId];
  if (!removedIds.has(focused || "") && !removedIds.has(selected || "")) {
    return;
  }
  const nextActive =
    fallbackPageId !== undefined ? fallbackPageId : get().activePageId;
  // nextActive 可能为 null（整本删空），此时清掉焦点/选中。
  if (removedIds.has(focused || "")) {
    view.setFocused(workspaceId, nextActive);
  }
  if (removedIds.has(selected || "")) {
    view.setSelected(workspaceId, nextActive);
  }
}

export const deletePageAction = async (
  set: StoreSet,
  get: StoreGet,
  id: string,
  options?: { trashBatchId?: string },
): Promise<boolean> => {
  flushEditorContent();
  const page = get().pages[id];
  if (!page) return false;

  const notebook = useNotebooks.getState().notebooks[page.workspaceId];
  const isLocalFolder = notebook?.source === "local-folder";
  if (isLocalFolder && notebook?.localPath) {
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
    if (!targetPath || !window.gooseFs) return false;

    const removedIds = new Set<string>();
    const stack = [id];
    const snapshotPages = get().pages;
    const expandedIds =
      useSidebarView.getState().expandedByNotebook[page.workspaceId] ?? [];
    while (stack.length) {
      const currentId = stack.pop()!;
      removedIds.add(currentId);
      Object.values(snapshotPages).forEach((p) => {
        if (p.parentId === currentId) stack.push(p.id);
      });
    }
    const sidebarView = useSidebarView.getState();
    const removedFocusedOrSelected =
      removedIds.has(sidebarView.focusedByNotebook[page.workspaceId] || "") ||
      removedIds.has(sidebarView.selectedByNotebook[page.workspaceId] || "");
    const nextSelectionPageId = removedFocusedOrSelected
      ? resolveVisibleRowAfterDeletion({
          pages: snapshotPages,
          currentPage: page,
          removedIds,
          isLocalNotebook: true,
          expandedIds,
        })
      : undefined;

    const removeOk = page.isFolder
      ? await window.gooseFs.deleteDir(targetPath)
      : await window.gooseFs.deleteFile(targetPath);
    if (!removeOk) return false;

    set((state) => {
      const newPages = { ...state.pages };
      removedIds.forEach((pid) => delete newPages[pid]);

      let nextActivePageId = state.activePageId;
      if (removedIds.has(state.activePageId || "")) {
        nextActivePageId = resolveVisibleRowAfterDeletion({
          pages: state.pages,
          currentPage: page,
          removedIds,
          isLocalNotebook: true,
          expandedIds,
        });
        useNotebooks
          .getState()
          .setLastActivePage(page.workspaceId, nextActivePageId);
      }

      return {
        pages: newPages,
        activePageId: nextActivePageId,
      };
    });

    syncSidebarSelectionAfterDelete(
      page.workspaceId,
      removedIds,
      get,
      nextSelectionPageId,
    );

    removePersistedPageSnapshots(snapshotPages, removedIds);

    return true;
  }

  const workspaceId = page.workspaceId;
  const changedIds: string[] = [];
  const removedIdsForSync = new Set<string>();

  set((state) => {
    const removedIds = new Set<string>();
    const stack = [id];
    while (stack.length) {
      const currentId = stack.pop()!;
      removedIds.add(currentId);
      Object.values(state.pages).forEach((p) => {
        if (p.parentId === currentId && !p.trashedAt) stack.push(p.id);
      });
    }
    removedIds.forEach((pid) => removedIdsForSync.add(pid));

    const newPages = { ...state.pages };
    const now = Date.now();
    const batchId = options?.trashBatchId || `b-${now}-${id}`;
    removedIds.forEach((pid) => {
      if (newPages[pid]) {
        newPages[pid] = {
          ...newPages[pid],
          trashedAt: now,
          trashBatchId: batchId,
          updatedAt: now,
          isFavorite: false,
          isPinned: false,
          pinnedAt: undefined,
        };
        changedIds.push(pid);
      }
    });

    let newActivePageId = state.activePageId;
    if (removedIds.has(state.activePageId || "")) {
      newActivePageId = resolveVisibleRowAfterDeletion({
        pages: state.pages,
        currentPage: page,
        removedIds,
        isLocalNotebook: false,
        expandedIds:
          useSidebarView.getState().expandedByNotebook[workspaceId] ?? [],
      });
      useNotebooks.getState().setLastActivePage(workspaceId, newActivePageId);
    }

    return {
      pages: newPages,
      activePageId: newActivePageId,
    };
  });

  syncSidebarSelectionAfterDelete(workspaceId, removedIdsForSync, get);

  persistPageSnapshots(get().pages, changedIds);

  return true;
};
