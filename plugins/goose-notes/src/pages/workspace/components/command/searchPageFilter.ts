import { getPageTitle } from "@/components/editor/utils/page-title";
import type { Page } from "@/types";

type SearchNotebook = {
  source?: "default" | "local-folder";
  excludeFromGlobalSearch?: boolean;
};

/** 搜索面板只收录可打开的笔记；local-folder 目录节点仅用于侧栏导航。 */
export function isCommandSearchablePage(
  page: Page,
  notebooks: Record<string, SearchNotebook | undefined>,
): boolean {
  if (page.trashedAt) return false;

  const title = getPageTitle(page);
  if (!title || title === "无标题") return false;

  return !(
    notebooks[page.workspaceId]?.source === "local-folder" && page.isFolder
  );
}

/**
 * 「所有记事本」搜索时，排除设置了 excludeFromGlobalSearch 的笔记本页面。
 * 当前本搜索不在这里拦截（由 activeNotebook 范围过滤负责）。
 */
export function shouldIncludePageInCommandScope(
  page: Page,
  notebooks: Record<string, SearchNotebook | undefined>,
  searchAllNotebooks: boolean,
): boolean {
  if (!searchAllNotebooks) return true;
  return !notebooks[page.workspaceId]?.excludeFromGlobalSearch;
}
