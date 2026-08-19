import { getPageTitle } from "@/components/editor/utils/page-title";
import type { Notebook } from "@/stores/useNotebooks";
import type { Page } from "@/types";

interface BuildSidebarTitleDisambiguationOptions {
  pages: Record<string, Page>;
  activeNotebookId: string | null;
  notebook?: Notebook;
  rootPageIds?: string[];
}

interface PathCandidate {
  pageId: string;
  segments: string[];
}

const TITLE_FALLBACK = "无标题";
const ROOT_HINT = "根级";
const PATH_SPLIT_RE = /[\\/]+/;

function normalizeTitle(title: string | undefined) {
  const trimmed = title?.trim() ?? "";
  return trimmed || TITLE_FALLBACK;
}

function normalizePath(path: string) {
  return path.replace(/\\/g, "/").replace(/\/+$/, "");
}

function buildChildrenMap(pages: Record<string, Page>) {
  const childrenMap = new Map<string, Page[]>();

  Object.values(pages).forEach((page) => {
    if (page.trashedAt) return;
    if (!page.parentId) return;

    const list = childrenMap.get(page.parentId) ?? [];
    list.push(page);
    childrenMap.set(page.parentId, list);
  });

  return childrenMap;
}

function collectScopePageIds(
  pages: Record<string, Page>,
  activeNotebookId: string | null,
  rootPageIds?: string[],
) {
  const includeByWorkspace = (page: Page) => {
    if (page.trashedAt) return false;
    if (!activeNotebookId) return true;
    return page.workspaceId === activeNotebookId;
  };

  if (!rootPageIds || rootPageIds.length === 0) {
    return new Set(
      Object.values(pages)
        .filter(includeByWorkspace)
        .map((page) => page.id),
    );
  }

  const childrenMap = buildChildrenMap(pages);
  const scopeIds = new Set<string>();
  const stack = [...rootPageIds];

  while (stack.length > 0) {
    const currentId = stack.pop()!;
    if (scopeIds.has(currentId)) continue;

    const currentPage = pages[currentId];
    if (!currentPage || !includeByWorkspace(currentPage)) continue;

    scopeIds.add(currentId);

    const children = childrenMap.get(currentId) ?? [];
    children.forEach((child) => {
      stack.push(child.id);
    });
  }

  return scopeIds;
}

function buildParentTitleSegments(
  page: Page,
  pages: Record<string, Page>,
  scopeIds: Set<string>,
) {
  const segments: string[] = [];
  const visited = new Set<string>();

  let currentParentId = page.parentId;
  while (currentParentId) {
    if (visited.has(currentParentId)) break;
    visited.add(currentParentId);

    const parent = pages[currentParentId];
    if (!parent) break;
    if (parent.trashedAt) break;
    if (!scopeIds.has(parent.id)) break;

    segments.push(normalizeTitle(getPageTitle(parent)));
    currentParentId = parent.parentId;
  }

  return segments.reverse();
}

function buildLocalPathSegments(page: Page, notebook?: Notebook) {
  if (!page.localFilePath) return [];

  const rawPath = normalizePath(page.localFilePath);
  const rootPath = notebook?.localPath ? normalizePath(notebook.localPath) : "";

  let relativePath = rawPath;
  if (rootPath && rawPath.startsWith(`${rootPath}/`)) {
    relativePath = rawPath.slice(rootPath.length + 1);
  }

  const parts = relativePath.split(PATH_SPLIT_RE).filter(Boolean);
  if (parts.length <= 1) return [];

  return parts.slice(0, -1);
}

function pickShortestDistinctSuffix(candidates: PathCandidate[]) {
  const labels = new Map<string, string>();

  candidates.forEach((current) => {
    const currentSegments = current.segments;

    if (currentSegments.length === 0) {
      labels.set(current.pageId, ROOT_HINT);
      return;
    }

    let chosenLabel = currentSegments.join("/");

    for (let depth = 1; depth <= currentSegments.length; depth += 1) {
      const suffix = currentSegments.slice(-depth).join("/");
      const unique = candidates.every((other) => {
        if (other.pageId === current.pageId) return true;
        return other.segments.slice(-depth).join("/") !== suffix;
      });

      if (unique) {
        chosenLabel = suffix;
        break;
      }
    }

    labels.set(current.pageId, chosenLabel);
  });

  const duplicateLabelCounter = new Map<string, number>();
  labels.forEach((label) => {
    duplicateLabelCounter.set(label, (duplicateLabelCounter.get(label) ?? 0) + 1);
  });

  const finalLabels = new Map<string, string>();
  labels.forEach((label, pageId) => {
    if ((duplicateLabelCounter.get(label) ?? 0) <= 1) {
      finalLabels.set(pageId, label);
      return;
    }

    finalLabels.set(pageId, `${label} · ${pageId.slice(-4)}`);
  });

  return finalLabels;
}

export function buildSidebarTitleDisambiguationMap({
  pages,
  activeNotebookId,
  notebook,
  rootPageIds,
}: BuildSidebarTitleDisambiguationOptions) {
  const scopeIds = collectScopePageIds(pages, activeNotebookId, rootPageIds);

  const titleGroups = new Map<string, string[]>();
  scopeIds.forEach((pageId) => {
    const page = pages[pageId];
    if (!page) return;

    const title = normalizeTitle(getPageTitle(page));
    const group = titleGroups.get(title) ?? [];
    group.push(pageId);
    titleGroups.set(title, group);
  });

  const disambiguationMap = new Map<string, string>();

  titleGroups.forEach((groupPageIds) => {
    if (groupPageIds.length <= 1) return;

    const candidates: PathCandidate[] = groupPageIds.map((pageId) => {
      const page = pages[pageId];
      if (!page) {
        return { pageId, segments: [] };
      }

      const segments =
        notebook?.source === "local-folder"
          ? buildLocalPathSegments(page, notebook)
          : buildParentTitleSegments(page, pages, scopeIds);

      return {
        pageId,
        segments,
      };
    });

    const finalLabels = pickShortestDistinctSuffix(candidates);
    finalLabels.forEach((label, pageId) => {
      disambiguationMap.set(pageId, label);
    });
  });

  return disambiguationMap;
}
