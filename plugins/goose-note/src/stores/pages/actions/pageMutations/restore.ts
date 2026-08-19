import type { Page } from "@/types";
import { useNotebooks } from "../../../useNotebooks";
import type { StoreSet, StoreGet } from "../hydrate";
import { getPageTitle } from "@/components/editor/utils/page-title";
import { persistPageSnapshots } from "../../persistence";

export const restorePageAction = (
  set: StoreSet,
  get: StoreGet,
  id: string,
): {
  ok: boolean;
  pageTitle?: string;
  notebookName?: string;
  parentTitles?: string[];
  restoredCount?: number;
  itemLabel?: string;
} => {
  const snapshotPages = get().pages;
  const page = snapshotPages[id];
  if (!page || !page.trashedAt) {
    return { ok: false };
  }

  const notebookName =
    useNotebooks.getState().notebooks[page.workspaceId]?.name ||
    "未命名记事本";
  const pageTitle = getPageTitle(page) || "无标题";
  const itemLabel = page.isFolder
    ? "文件夹"
    : page.localFilePath
      ? "文件"
      : "页面";

  const parentTitles: string[] = [];
  const parentVisited = new Set<string>();
  let currentParentId = page.parentId;
  while (currentParentId && !parentVisited.has(currentParentId)) {
    parentVisited.add(currentParentId);
    const parentPage = snapshotPages[currentParentId];
    if (!parentPage) break;
    parentTitles.unshift(getPageTitle(parentPage) || "无标题");
    currentParentId = parentPage.parentId;
  }

  let restoredCount = 0;
  const restoredIds: string[] = [];
  set((state) => {
    const currentPage = state.pages[id];
    if (!currentPage || !currentPage.trashedAt) return state;

    const trashStamp = currentPage.trashedAt;
    const batchId = currentPage.trashBatchId;
    const now = Date.now();
    const restoredPages = { ...state.pages };

    const stack = [id];
    const visited = new Set<string>();
    while (stack.length) {
      const currentId = stack.pop()!;
      if (visited.has(currentId)) continue;
      visited.add(currentId);
      const current = restoredPages[currentId];
      // 节点自身有 batchId 时按 batchId 精确匹配同批；
      // 存量垃圾箱数据无 batchId，回退到 trashedAt 时间窗匹配（兼容旧行为）。
      const matched =
        current?.trashBatchId !== undefined
          ? current.trashBatchId === batchId
          : current?.trashedAt === trashStamp;
      if (current && matched) {
        const { trashedAt, trashBatchId, ...rest } = current;
        restoredPages[currentId] = {
          ...rest,
          updatedAt: now,
        } as Page;
        restoredCount += 1;
        restoredIds.push(currentId);
      }
      Object.values(restoredPages).forEach((p) => {
        if (p.parentId === currentId && !visited.has(p.id)) {
          stack.push(p.id);
        }
      });
    }

    return {
      pages: restoredPages,
    };
  });

  persistPageSnapshots(get().pages, restoredIds);

  return {
    ok: true,
    pageTitle,
    notebookName,
    parentTitles,
    restoredCount,
    itemLabel,
  };
};
