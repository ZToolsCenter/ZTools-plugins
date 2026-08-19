import { useNotebooks } from "../../../useNotebooks";
import type { StoreSet, StoreGet } from "../hydrate";
import { persistPageSnapshots } from "../../persistence";

type MoveUndoSnapshot = {
  id: string;
  workspaceId: string;
  parentId?: string;
  order?: number;
};

/**
 * 撤回 movePageTree：用移动前捕获的 {workspaceId, parentId, order} 精确写回。
 * 不复用正向 move（正向会把 root 页 parentId 置 undefined 并重排 order）。
 * 撤回前校验各页源笔记本仍存在，被删则跳过；全部源笔记本都不存在则放弃撤回返回 false，
 * 避免把页面写回到已不存在的笔记本而变成孤儿。
 */
export const undoMovePageTreeAction = (
  set: StoreSet,
  get: StoreGet,
  undoSnapshots: MoveUndoSnapshot[] | undefined,
  sourceNotebookId: string | undefined,
  prevActivePageId: string | null | undefined,
): boolean => {
  if (!undoSnapshots || undoSnapshots.length === 0) return false;

  const notebooks = useNotebooks.getState().notebooks;
  const restorable = undoSnapshots.filter(
    (snap) => !!notebooks[snap.workspaceId],
  );
  if (restorable.length === 0) return false;

  const restoredIds: string[] = [];
  set((state) => {
    const newPages = { ...state.pages };
    restorable.forEach((snap) => {
      const current = newPages[snap.id];
      if (!current) return;
      newPages[snap.id] = {
        ...current,
        workspaceId: snap.workspaceId,
        parentId: snap.parentId,
        order: snap.order,
      };
      restoredIds.push(snap.id);
    });
    return { pages: newPages };
  });

  if (restoredIds.length === 0) return false;

  persistPageSnapshots(get().pages, restoredIds);

  if (sourceNotebookId && notebooks[sourceNotebookId]) {
    useNotebooks
      .getState()
      .setLastActivePage(sourceNotebookId, prevActivePageId ?? null);
  }

  return true;
};
