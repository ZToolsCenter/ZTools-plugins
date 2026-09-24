import { useCallback, useDeferredValue, useEffect, useMemo, useState } from "react";
import type { Page } from "@/types";
import { getPageTitle } from "@/components/editor/utils/page-title";
import { extractTextFromContent } from "@/components/editor/utils/content-text-extractor";
import { DEFAULT_NOTEBOOK, useNotebooks } from "@/stores/useNotebooks";
import { pinyinMatchIndices } from "@/lib/pinyin-search";
import { syncIndex, searchIndex } from "./pageSearchIndex";
import {
  isCommandSearchablePage,
  shouldIncludePageInCommandScope,
} from "./searchPageFilter";

// 模块级文本缓存：key = page.id，存储 updatedAt 与解析后纯文本
const textCache = new Map<string, { updatedAt: number; text: string }>();

function getCachedText(page: Page): string {
  const hit = textCache.get(page.id);
  if (hit && hit.updatedAt === page.updatedAt) return hit.text;
  const text = extractTextFromContent(page.content);
  textCache.set(page.id, { updatedAt: page.updatedAt, text });
  return text;
}

export interface SearchResultPage extends Page {
  contentSnippet?: string;
  snippetMatchIndex?: number;
}

export interface SearchResults {
  recent: SearchResultPage[];
  all: SearchResultPage[];
  /** 当前应渲染的结果切片，由 useCommandSearch 的 displayLimit 控制 */
  allDisplay: SearchResultPage[];
  hasQuery: boolean;
  hasMore: boolean;
}

/** 首屏与每次追加加载条数 */
export const SEARCH_RESULT_PAGE_SIZE = 30;

/**
 * 从内容中提取包含搜索关键词的上下文片段
 * @param contentText 完整的内容文本
 * @param query 搜索关键词
 * @param contextLength 关键词前后显示的字符数
 * @returns 包含关键词的上下文片段，或 undefined
 */
function getContentSnippet(
  contentText: string,
  query: string,
  contextLength: number = 30
): { snippet: string; matchIndex: number } | undefined {
  if (!query || !contentText) return undefined;

  const lowerContent = contentText.toLowerCase();
  const lowerQuery = query.toLowerCase();
  let matchIndex = lowerContent.indexOf(lowerQuery);

  // CJK 逐字 token AND 命中时原文无连续子串，用 query 首字符兜底定位
  if (matchIndex === -1) {
    const firstChar = lowerQuery[0];
    if (firstChar) {
      matchIndex = lowerContent.indexOf(firstChar);
    }
    if (matchIndex === -1) return undefined;
  }

  // 计算片段的起始和结束位置
  const start = Math.max(0, matchIndex - contextLength);
  const end = Math.min(contentText.length, matchIndex + query.length + contextLength);

  let snippet = contentText.slice(start, end);

  // 如果不是从头开始，添加省略号
  if (start > 0) {
    snippet = "..." + snippet;
  }

  // 如果不是到结尾，添加省略号
  if (end < contentText.length) {
    snippet = snippet + "...";
  }

  return { snippet, matchIndex: start > 0 ? matchIndex - start + 3 : matchIndex };
}

/** 全库可搜页面（与 Tab 笔记本范围无关），供 MiniSearch 单例索引 */
function buildSearchablePagesRecord(
  pages: Record<string, Page>,
  notebooks: ReturnType<typeof useNotebooks.getState>["notebooks"],
): Record<string, Page> {
  const record: Record<string, Page> = {};
  for (const page of Object.values(pages)) {
    if (!isCommandSearchablePage(page, notebooks)) continue;
    record[page.id] = page;
  }
  return record;
}

interface CommandSearchState {
  pages: Record<string, Page>;
  activeNotebookId: string | null;
  searchAllNotebooks: boolean;
}

export function useCommandSearch({
  pages,
  activeNotebookId,
  searchAllNotebooks,
}: CommandSearchState) {
  const [searchQuery, setSearchQuery] = useState("");
  const deferredQuery = useDeferredValue(searchQuery);
  const notebooks = useNotebooks((state) => state.notebooks);
  const [displayLimit, setDisplayLimit] = useState(SEARCH_RESULT_PAGE_SIZE);
  const [removedRecentIds, setRemovedRecentIds] = useState<string[]>(() => {
    try {
      const saved = localStorage.getItem("goose-recent-excludes");
      return saved ? JSON.parse(saved) : [];
    } catch {
      return [];
    }
  });

  // 查询 / 范围变化时重置分页，避免旧 limit 挂在新结果上
  useEffect(() => {
    setDisplayLimit(SEARCH_RESULT_PAGE_SIZE);
  }, [deferredQuery, searchAllNotebooks, activeNotebookId]);

  const loadMoreResults = useCallback(() => {
    setDisplayLimit((prev) => prev + SEARCH_RESULT_PAGE_SIZE);
  }, []);

  const removeRecent = useCallback((id: string) => {
    const newIds = [...removedRecentIds, id];
    setRemovedRecentIds(newIds);
    localStorage.setItem("goose-recent-excludes", JSON.stringify(newIds));
  }, [removedRecentIds]);

  const filteredPages = useMemo(() => {
    const allPagesArray = Object.values(pages).filter((page) =>
      isCommandSearchablePage(page, notebooks) &&
      shouldIncludePageInCommandScope(page, notebooks, searchAllNotebooks),
    );
    if (searchAllNotebooks) {
      return allPagesArray;
    }
    const currentNotebookId = activeNotebookId || DEFAULT_NOTEBOOK;
    return allPagesArray.filter((p) => p.workspaceId === currentNotebookId);
  }, [pages, notebooks, searchAllNotebooks, activeNotebookId]);

  // 索引始终覆盖 store 内全部可搜页；笔记本范围仅在 searchResults 的 filteredSet 过滤。
  // 若按 filteredPages sync，单本模式会 discard 其它本，Tab 切回「所有记事本」当轮搜不到。
  useEffect(() => {
    syncIndex(buildSearchablePagesRecord(pages, notebooks));
  }, [pages, notebooks]);

  const getPageBreadcrumb = useCallback(
    (page: Page): string[] => {
      const breadcrumb: string[] = [];
      let currentPage = page;

      while (currentPage) {
      const title = getPageTitle(currentPage);
        if (title && title !== "无标题") {
          breadcrumb.unshift(title);
        }
        if (!currentPage.parentId) {
          break;
        }
        currentPage = pages[currentPage.parentId];
      }

      const notebookId = page.workspaceId || "default";
      const notebook = useNotebooks.getState().notebooks[notebookId];
      if (notebook) {
        breadcrumb.unshift(notebook.name);
      }

      return breadcrumb;
    },
    [pages],
  );

  const searchResults: SearchResults = useMemo(() => {
    const query = deferredQuery.trim().toLowerCase();

    if (!query) {
      const recent = filteredPages
        .filter((p) => !removedRecentIds.includes(p.id))
        .sort((a, b) => b.updatedAt - a.updatedAt)
        .slice(0, 5) as SearchResultPage[];

      const all = filteredPages.sort((a, b) => {
        const titleA = getPageTitle(a);
        const titleB = getPageTitle(b);
        return titleA.localeCompare(titleB, "zh-CN");
      }) as SearchResultPage[];

      const allDisplay = all.slice(0, displayLimit);
      return {
        recent,
        all,
        allDisplay,
        hasQuery: false,
        hasMore: allDisplay.length < all.length,
      };
    }

    // 构建 filteredPages 的 id 集合（已按 notebook/trash 过滤）
    const filteredSet = new Map<string, Page>();
    for (const page of filteredPages) {
      filteredSet.set(page.id, page);
    }

    // 倒排索引查询，返回按相关度排序的 id 列表
    const indexHitIds = new Set(searchIndex(deferredQuery.trim()));

    // pinyin 补充命中（倒排索引不含拼音，需额外一轮）
    const pinyinHitIds = new Set<string>();
    for (const [id, page] of filteredSet) {
      if (!indexHitIds.has(id)) {
        const title = getPageTitle(page);
        if (pinyinMatchIndices(title, deferredQuery.trim()) !== null) {
          pinyinHitIds.add(id);
        }
      }
    }

    // 合并命中集（索引在前，拼音补充在后）
    const matched: SearchResultPage[] = [];

    // 先按索引顺序添加
    for (const id of indexHitIds) {
      const page = filteredSet.get(id);
      if (!page) continue;
      const resultPage: SearchResultPage = { ...page };
      const contentText = getCachedText(page);
      const snippetResult = getContentSnippet(contentText, query);
      if (snippetResult) {
        resultPage.contentSnippet = snippetResult.snippet;
        resultPage.snippetMatchIndex = snippetResult.matchIndex;
      }
      matched.push(resultPage);
    }

    // 再追加 pinyin 专属命中
    for (const id of pinyinHitIds) {
      const page = filteredSet.get(id);
      if (!page) continue;
      matched.push({ ...page });
    }

    const recent = matched
      .filter((p) => !removedRecentIds.includes(p.id))
      .sort((a, b) => b.updatedAt - a.updatedAt)
      .slice(0, 5);

    const all = [...matched].sort((a, b) => {
      const titleA = getPageTitle(a);
      const titleB = getPageTitle(b);
      return titleA.localeCompare(titleB, "zh-CN");
    });

    const allDisplay = all.slice(0, displayLimit);
    return {
      recent,
      all,
      allDisplay,
      hasQuery: true,
      hasMore: allDisplay.length < all.length,
    };
  }, [filteredPages, deferredQuery, removedRecentIds, displayLimit]);

  return {
    filteredPages,
    searchResults,
    getPageBreadcrumb,
    searchQuery,
    setSearchQuery,
    removeRecent,
    loadMoreResults,
  };
}
