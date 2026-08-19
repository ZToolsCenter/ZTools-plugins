import type { Page } from "@/types";
import { getPageTitle } from "@/components/editor/utils/page-title";

function compareSiblingPages(
  a: Page,
  b: Page,
  isLocalNotebook: boolean,
): number {
  if (isLocalNotebook) {
    if (a.isFolder !== b.isFolder) {
      return a.isFolder ? -1 : 1;
    }
    const titleCompare = getPageTitle(a).localeCompare(getPageTitle(b), "zh-CN", {
      numeric: true,
    });
    if (titleCompare !== 0) return titleCompare;
    return a.id.localeCompare(b.id);
  }

  const orderA = a.order ?? a.createdAt;
  const orderB = b.order ?? b.createdAt;
  if (orderA !== orderB) return orderA - orderB;
  return a.id.localeCompare(b.id);
}

export { compareSiblingPages };

function resolveAdjacentPageAfterDeletion({
  pages,
  currentPage,
  removedIds,
  isLocalNotebook,
}: {
  pages: Record<string, Page>;
  currentPage: Page;
  removedIds: Set<string>;
  isLocalNotebook: boolean;
}): string | null {
  const siblingsBeforeDelete = Object.values(pages)
    .filter(
      (candidate) =>
        candidate.workspaceId === currentPage.workspaceId &&
        !candidate.trashedAt &&
        candidate.parentId === currentPage.parentId,
    )
    .sort((a, b) => compareSiblingPages(a, b, isLocalNotebook));

  const deletedPageIndex = siblingsBeforeDelete.findIndex(
    (candidate) => candidate.id === currentPage.id,
  );
  const siblingsAfterDelete = siblingsBeforeDelete.filter(
    (candidate) => !removedIds.has(candidate.id),
  );

  if (siblingsAfterDelete.length === 0) {
    return null;
  }

  const fallbackIndex =
    deletedPageIndex === -1
      ? siblingsAfterDelete.length - 1
      : Math.min(deletedPageIndex, siblingsAfterDelete.length - 1);

  return siblingsAfterDelete[fallbackIndex]?.id ?? null;
}

export { resolveAdjacentPageAfterDeletion };

/**
 * 删除后按「可见行顺序」选下一个目标，贴合用户连续删除的直觉：
 * 优先选删除项视觉上的下一行，没有则上一行，再没有则回退到父节点。
 * 可见行 = 在当前展开状态下深度优先展开后的扁平序（折叠节点的子页不计入）。
 */
function resolveVisibleRowAfterDeletion({
  pages,
  currentPage,
  removedIds,
  isLocalNotebook,
  expandedIds,
}: {
  pages: Record<string, Page>;
  currentPage: Page;
  removedIds: Set<string>;
  isLocalNotebook: boolean;
  expandedIds: string[];
}): string | null {
  const expanded = new Set(expandedIds);
  const childrenOf = (parentId: string | undefined) =>
    Object.values(pages)
      .filter(
        (candidate) =>
          candidate.workspaceId === currentPage.workspaceId &&
          !candidate.trashedAt &&
          candidate.parentId === parentId,
      )
      .sort((a, b) => compareSiblingPages(a, b, isLocalNotebook));

  // 构建删除前的可见行扁平序（DFS，尊重折叠状态）。
  const visibleBefore: string[] = [];
  const walk = (parentId: string | undefined) => {
    for (const page of childrenOf(parentId)) {
      visibleBefore.push(page.id);
      if (expanded.has(page.id)) walk(page.id);
    }
  };
  walk(undefined);

  const deletedIndex = visibleBefore.indexOf(currentPage.id);
  if (deletedIndex === -1) {
    // 删除项本就不在可见序里（理论上不该发生），回退到同级策略。
    return resolveAdjacentPageAfterDeletion({
      pages,
      currentPage,
      removedIds,
      isLocalNotebook,
    });
  }

  // 向下找第一个未删除的可见行。
  for (let i = deletedIndex + 1; i < visibleBefore.length; i++) {
    if (!removedIds.has(visibleBefore[i])) return visibleBefore[i];
  }
  // 向上找最近的未删除可见行。
  for (let i = deletedIndex - 1; i >= 0; i--) {
    if (!removedIds.has(visibleBefore[i])) return visibleBefore[i];
  }
  // 整棵可见树都没了，回退父节点（父节点若也被删则为 null）。
  const parentId = currentPage.parentId;
  if (parentId && pages[parentId] && !removedIds.has(parentId)) {
    return parentId;
  }
  return null;
}

export { resolveVisibleRowAfterDeletion };
