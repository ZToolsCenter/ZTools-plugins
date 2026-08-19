import { useNotebooks } from "../../../useNotebooks";
import type { StoreSet, StoreGet } from "../hydrate";
import { flushEditorContent } from "../flushEditor";
import { persistPageSnapshots } from "../../persistence";

export const movePageTreeToNotebookAction = (
  set: StoreSet,
  get: StoreGet,
  pageId: string,
  targetNotebookId: string,
): {
  ok: boolean;
  movedCount: number;
  sourceNotebookId?: string;
  targetNotebookId?: string;
  reason?: string;
  undoSnapshots?: Array<{
    id: string;
    workspaceId: string;
    parentId?: string;
    order?: number;
  }>;
  prevActivePageId?: string | null;
} => {
  flushEditorContent(true);

  const snapshotPages = get().pages;
  const sourcePage = snapshotPages[pageId];
  if (!sourcePage || sourcePage.trashedAt) {
    return {
      ok: false,
      movedCount: 0,
      reason: "page-not-found",
    };
  }

  const sourceNotebookId = sourcePage.workspaceId;
  const notebooksStore = useNotebooks.getState();
  const sourceNotebook = notebooksStore.notebooks[sourceNotebookId];
  const targetNotebook = notebooksStore.notebooks[targetNotebookId];

  if (!sourceNotebook || sourceNotebook.source === "local-folder") {
    return {
      ok: false,
      movedCount: 0,
      reason: "source-not-supported",
    };
  }

  if (!targetNotebook || targetNotebook.source === "local-folder") {
    return {
      ok: false,
      movedCount: 0,
      reason: "target-not-supported",
    };
  }

  if (sourceNotebookId === targetNotebookId) {
    return {
      ok: false,
      movedCount: 0,
      reason: "same-notebook",
    };
  }

  const movedIds: string[] = [];
  const movedIdSet = new Set<string>();
  const stack = [pageId];

  while (stack.length) {
    const currentId = stack.pop()!;
    if (movedIdSet.has(currentId)) continue;
    const currentPage = snapshotPages[currentId];
    if (!currentPage || currentPage.trashedAt) continue;
    movedIdSet.add(currentId);
    movedIds.push(currentId);

    Object.values(snapshotPages).forEach((p) => {
      if (!p.trashedAt && p.parentId === currentId && !movedIdSet.has(p.id)) {
        stack.push(p.id);
      }
    });
  }

  if (movedIds.length === 0) {
    return {
      ok: false,
      movedCount: 0,
      reason: "empty-tree",
    };
  }

  const now = Date.now();
  const targetTopLevelOrders = Object.values(snapshotPages)
    .filter(
      (p) =>
        !p.trashedAt &&
        p.workspaceId === targetNotebookId &&
        p.parentId === undefined,
    )
    .map((p) => p.order ?? p.createdAt);
  const maxTopLevelOrder =
    targetTopLevelOrders.length > 0
      ? Math.max(...targetTopLevelOrders)
      : now - 1;
  const rootOrder = maxTopLevelOrder + 1;

  const activeNotebookId = notebooksStore.activeNotebookId;
  const activePageId = get().activePageId;
  const shouldFallbackActive =
    !!activePageId &&
    movedIdSet.has(activePageId) &&
    activeNotebookId === sourceNotebookId;

  let nextActivePageId: string | null = activePageId;
  if (shouldFallbackActive) {
    const remainingPages = Object.values(snapshotPages)
      .filter(
        (p) =>
          !p.trashedAt &&
          p.workspaceId === sourceNotebookId &&
          !movedIdSet.has(p.id),
      )
      .sort((a, b) => {
        const valA = a.order ?? a.createdAt;
        const valB = b.order ?? b.createdAt;
        if (valA !== valB) return valA - valB;
        return a.id.localeCompare(b.id);
      });
    nextActivePageId = remainingPages[0]?.id ?? null;
  }

  // 移动前捕获每页原始 {workspaceId, parentId, order}，供撤回精确还原
  // （正向会把 root 页 parentId 置 undefined + 重排 order，反向必须精确写回）。
  const undoSnapshots = movedIds.map((mid) => {
    const c = snapshotPages[mid];
    return {
      id: mid,
      workspaceId: c.workspaceId,
      parentId: c.parentId,
      order: c.order,
    };
  });

  set((state) => {
    const newPages = { ...state.pages };

    movedIds.forEach((id) => {
      const current = newPages[id];
      if (!current || current.trashedAt) return;

      newPages[id] = {
        ...current,
        workspaceId: targetNotebookId,
        parentId: id === pageId ? undefined : current.parentId,
        order: id === pageId ? rootOrder : current.order,
      };
    });

    return {
      pages: newPages,
      activePageId: shouldFallbackActive ? nextActivePageId : state.activePageId,
    };
  });

  persistPageSnapshots(get().pages, movedIds);

  if (shouldFallbackActive) {
    notebooksStore.setLastActivePage(sourceNotebookId, nextActivePageId);
  }

  return {
    ok: true,
    movedCount: movedIds.length,
    sourceNotebookId,
    targetNotebookId,
    undoSnapshots,
    prevActivePageId: activePageId,
  };
};
