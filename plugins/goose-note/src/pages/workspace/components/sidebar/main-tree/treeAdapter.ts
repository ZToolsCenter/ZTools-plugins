import type { TreeItem, TreeItemIndex } from "react-complex-tree";
import type { Page } from "@/types";
import { getPageTitle } from "@/components/editor/utils/page-title";

export { getPageTitle };

function sortPages(items: Page[], isLocalFolder: boolean): Page[] {
  return items.slice().sort((a, b) => {
    if (isLocalFolder) {
      if (!!a.isFolder !== !!b.isFolder) {
        return a.isFolder ? -1 : 1;
      }
      const nameA = getPageTitle(a);
      const nameB = getPageTitle(b);
      return nameA.localeCompare(nameB, "zh-CN", { numeric: true });
    }
    const orderA = a.order ?? a.createdAt;
    const orderB = b.order ?? b.createdAt;
    if (orderA !== orderB) return orderA - orderB;
    return a.id.localeCompare(b.id);
  });
}

const ROOT_PLACEHOLDER: Page = {
  id: "root",
  workspaceId: "",
  content: { type: "doc", content: [] } as any,
  isLocked: false,
  fontSize: "medium" as any,
  fontFamily: "default" as any,
  createdAt: 0,
  updatedAt: 0,
};

export function pagesToTreeItems(
  pages: Page[],
  activeNotebookId: string,
  isLocalFolder: boolean,
): Record<TreeItemIndex, TreeItem<Page>> {
  const scoped = pages.filter(
    (p) => p.workspaceId === activeNotebookId && !p.trashedAt,
  );
  const childrenMap = new Map<string | undefined, Page[]>();
  for (const page of scoped) {
    const key = page.parentId;
    if (!childrenMap.has(key)) childrenMap.set(key, []);
    childrenMap.get(key)!.push(page);
  }
  for (const [key, list] of childrenMap.entries()) {
    childrenMap.set(key, sortPages(list, isLocalFolder));
  }

  const items: Record<TreeItemIndex, TreeItem<Page>> = {};
  const rootChildren = (childrenMap.get(undefined) ?? []).map((p) => p.id);
  items["root"] = {
    index: "root",
    children: rootChildren,
    isFolder: true,
    data: ROOT_PLACEHOLDER,
    canMove: false,
    canRename: false,
  };

  for (const page of scoped) {
    const children = (childrenMap.get(page.id) ?? []).map((p) => p.id);
    const isFolder = isLocalFolder ? !!page.isFolder : true;
    items[page.id] = {
      index: page.id,
      children,
      isFolder,
      data: page,
      canMove: true,
      canRename: false,
    };
  }

  return items;
}
