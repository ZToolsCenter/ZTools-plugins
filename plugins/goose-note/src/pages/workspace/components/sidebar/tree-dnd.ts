import type { Page } from "@/types";

export interface FlatTreeItem {
  id: string;
  page: Page;
  depth: number;
  parentId: string | undefined;
  hasChildren: boolean;
  isOpen: boolean;
}

export interface PlaceholderTreeItem {
  id: string;
  depth: number;
  parentId: string;
  isPlaceholder: true;
  name: string;
}

export type VisibleTreeItem = FlatTreeItem | PlaceholderTreeItem;

interface BuildVisibleTreeOptions {
  pages: Record<string, Page>;
  openIds: Set<string>;
  workspaceId?: string;
  isLocalNotebook: boolean;
  rootPageIds?: string[];
  flatRoots?: boolean;
}

interface ProjectionOptions {
  items: FlatTreeItem[];
  activeId: string;
  overId: string;
  pages: Record<string, Page>;
  isLocalNotebook: boolean;
}

export interface ProjectionResult {
  depth: number;
  parentId: string | undefined;
}

function sortPages(items: Page[], isLocalNotebook: boolean) {
  return items.sort((a, b) => {
    if (isLocalNotebook) {
      if (a.isFolder !== b.isFolder) {
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

export function buildVisibleTree({
  pages,
  openIds,
  workspaceId,
  isLocalNotebook,
  rootPageIds,
  flatRoots,
}: BuildVisibleTreeOptions): VisibleTreeItem[] {
  const childrenMap = new Map<string | undefined, Page[]>();

  Object.values(pages).forEach((page) => {
    if (page.trashedAt) return;
    if (workspaceId && page.workspaceId !== workspaceId) return;

    const key = page.parentId;
    if (!childrenMap.has(key)) {
      childrenMap.set(key, []);
    }
    childrenMap.get(key)!.push(page);
  });

  for (const [key, children] of childrenMap.entries()) {
    childrenMap.set(key, sortPages(children, isLocalNotebook));
  }

  const visible: VisibleTreeItem[] = [];
  const visitedRootIds = new Set<string>();

  const appendNode = (page: Page, depth: number) => {
    const pageChildren = childrenMap.get(page.id) || [];
    const hasChildren = flatRoots ? false : pageChildren.length > 0;
    const isOpen = flatRoots ? false : openIds.has(page.id);

    visible.push({
      id: page.id,
      page,
      depth,
      parentId: flatRoots ? undefined : page.parentId,
      hasChildren,
      isOpen,
    });

    if (!isOpen) return;

    if (hasChildren) {
      pageChildren.forEach((child) => appendNode(child, depth + 1));
      return;
    }

    visible.push({
      id: `${page.id}__placeholder`,
      depth: depth + 1,
      parentId: page.id,
      isPlaceholder: true,
      name: isLocalNotebook ? "内无文件" : "内无页面",
    });
  };

  const walk = (parentId: string | undefined, depth: number) => {
    const children = childrenMap.get(parentId) || [];
    children.forEach((page) => appendNode(page, depth));
  };

  if (rootPageIds && rootPageIds.length > 0) {
    rootPageIds.forEach((rootId) => {
      if (visitedRootIds.has(rootId)) return;
      const rootPage = pages[rootId];
      if (!rootPage || rootPage.trashedAt) return;
      if (workspaceId && rootPage.workspaceId !== workspaceId) return;
      visitedRootIds.add(rootId);
      appendNode(rootPage, 0);
    });
    return visible;
  }

  walk(undefined, 0);
  return visible;
}

function getPageTitle(page: Page): string {
  const nodes = Array.isArray(page.content?.content) ? page.content.content : [];
  const headingNode = nodes.find((node: any) => {
    const attrs = (node as { attrs?: { level?: number } }).attrs;
    return node.type === "heading" && attrs?.level === 1;
  });
  const textNode = Array.isArray(headingNode?.content) ? headingNode.content[0] : undefined;
  return textNode?.type === "text" && textNode.text ? textNode.text : "无标题";
}

export function getProjection({
  items,
  activeId,
  overId,
  pages,
  isLocalNotebook,
}: ProjectionOptions): ProjectionResult | null {
  const overIndex = items.findIndex((item) => item.id === overId);
  const activeIndex = items.findIndex((item) => item.id === activeId);
  if (activeIndex < 0 || overIndex < 0) return null;

  const activeItem = items[activeIndex];
  const reordered = arrayMove(items, activeIndex, overIndex);
  const projectedIndex = reordered.findIndex((item) => item.id === activeId);
  const prevItem = reordered[projectedIndex - 1];

  const projectedDepth = activeItem.depth;

  const maxDepth = prevItem ? prevItem.depth + 1 : 0;
  let depth = clamp(projectedDepth, 0, maxDepth);
  let parentId = getParentId(depth, projectedIndex, reordered);

  if (isLocalNotebook && parentId && !pages[parentId]?.isFolder) {
    const parent = pages[parentId];
    parentId = parent?.parentId;
    depth = Math.max(0, depth - 1);
  }

  return { depth, parentId };
}

function getParentId(
  depth: number,
  index: number,
  items: FlatTreeItem[]
): string | undefined {
  if (depth === 0) return undefined;

  const prevItem = items[index - 1];
  if (!prevItem) return undefined;

  if (depth === prevItem.depth) {
    return prevItem.parentId;
  }

  if (depth > prevItem.depth) {
    return prevItem.id;
  }

  const parentItem = items
    .slice(0, index)
    .reverse()
    .find((item) => item.depth === depth - 1);

  return parentItem?.id;
}

export function isDescendant(
  sourceId: string,
  targetParentId: string | undefined,
  pages: Record<string, Page>
) {
  if (!targetParentId) return false;
  if (targetParentId === sourceId) return true;

  let current = pages[targetParentId];
  while (current?.parentId) {
    if (current.parentId === sourceId) return true;
    current = pages[current.parentId];
  }
  return false;
}

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function arrayMove<T>(array: T[], from: number, to: number) {
  const next = [...array];
  const [item] = next.splice(from, 1);
  next.splice(to, 0, item);
  return next;
}
