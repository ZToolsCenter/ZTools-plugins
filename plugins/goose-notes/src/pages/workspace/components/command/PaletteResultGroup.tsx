import { useMemo } from "react";
import { Command } from "cmdk";
import * as LucideIcons from "lucide-react";
import type { Page } from "@/types";
import { getPageTitle } from "@/components/editor/utils/page-title";
import { useNotebooks } from "@/stores/useNotebooks";
import { usePages } from "@/stores/usePages";
import { LocalFileIcon } from "@/pages/workspace/components/sidebar/local-file-icon";
import type { SearchResultPage, SearchResults } from "./useCommandSearch";
import { isPinyinQuery, pinyinMatchIndices } from "@/lib/pinyin-search";

function BreadcrumbPath({
  parts,
  fallback,
}: {
  parts: string[];
  fallback?: string;
}) {
  if (parts.length === 0) {
    if (!fallback) return null;
    return (
      <span className="shrink-0 text-xs text-muted-foreground">{fallback}</span>
    );
  }
  return (
    <div className="flex items-center gap-0.5 shrink-0 max-w-[42%] overflow-hidden">
      {parts.map((part, i) => (
        <span key={i} className="flex items-center gap-0.5 min-w-0">
          {i > 0 && (
            <span
              aria-hidden="true"
              className="text-muted-foreground/60 text-[10px] shrink-0"
            >
              ›
            </span>
          )}
          <span
            className={`truncate text-xs text-muted-foreground ${i === 0 ? "font-medium" : ""}`}
          >
            {part}
          </span>
        </span>
      ))}
    </div>
  );
}

const MARK_CLASS =
  "rounded-[4px] bg-[hsl(var(--goose-selected-bg))] px-0.5 text-foreground";

function HighlightText({ text, query }: { text: string; query: string }) {
  if (!query.trim()) return <>{text}</>;
  const regex = new RegExp(
    `(${query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")})`,
    "gi",
  );
  const parts = text.split(regex);

  // 普通字符串命中
  const hasMatch = parts.length > 1;
  if (hasMatch) {
    return (
      <>
        {parts.map((part, i) =>
          regex.test(part) ? (
            <mark key={i} className={MARK_CLASS}>
              {part}
            </mark>
          ) : (
            part
          ),
        )}
      </>
    );
  }

  // 尝试拼音匹配高亮
  if (isPinyinQuery(query.trim())) {
    const indices = pinyinMatchIndices(text, query.trim());
    if (indices && indices.length > 0) {
      const hitSet = new Set(indices);
      // 分段：连续命中合并为一个 mark
      const segments: { chars: string; hit: boolean }[] = [];
      for (let i = 0; i < text.length; i++) {
        const hit = hitSet.has(i);
        if (segments.length > 0 && segments[segments.length - 1].hit === hit) {
          segments[segments.length - 1].chars += text[i];
        } else {
          segments.push({ chars: text[i], hit });
        }
      }
      return (
        <>
          {segments.map((seg, i) =>
            seg.hit ? (
              <mark key={i} className={MARK_CLASS}>
                {seg.chars}
              </mark>
            ) : (
              seg.chars
            ),
          )}
        </>
      );
    }
  }

  return <>{text}</>;
}

interface PaletteResultGroupProps {
  searchQuery: string;
  showRecentInSearch: boolean;
  searchResults: SearchResults;
  getPageBreadcrumb: (page: Page) => string[];
  onOpenPage: (page: SearchResultPage | Page, query: string | null) => void;
  onRemoveRecent: (id: string) => void;
  onHideRecent: () => void;
}

export function PaletteResultGroup({
  searchQuery,
  showRecentInSearch,
  searchResults,
  getPageBreadcrumb,
  onOpenPage,
  onRemoveRecent,
  onHideRecent,
}: PaletteResultGroupProps) {
  const pages = usePages((state) => state.pages);
  const notebooks = useNotebooks((state) => state.notebooks);
  const pageIdsWithChildren = useMemo(() => {
    const ids = new Set<string>();
    Object.values(pages).forEach((page) => {
      if (!page.trashedAt && page.parentId) {
        ids.add(page.parentId);
      }
    });
    return ids;
  }, [pages]);

  const renderPageIcon = (page: Page, className?: string) => (
    <LocalFileIcon
      page={page}
      iconName={page.icon}
      isLocalFolder={
        notebooks[page.workspaceId]?.source === "local-folder"
      }
      hasChildren={pageIdsWithChildren.has(page.id)}
      className={className}
    />
  );

  return (
    <>
      {!searchQuery.trim() &&
        showRecentInSearch &&
        searchResults.recent.length > 0 && (
          <Command.Group
            heading={
              <div className="flex items-center justify-between">
                <span>最近访问</span>
                <button
                  type="button"
                  aria-label="隐藏最近访问"
                  onClick={(e) => {
                    e.stopPropagation();
                    onHideRecent();
                  }}
                  className="p-0.5 rounded hover:bg-[var(--goose-icon-chip-on-selected)] dark:hover:bg-[var(--goose-interactive-hover)] cursor-pointer transition-colors"
                >
                  <LucideIcons.X
                    aria-hidden="true"
                    className="h-3.5 w-3.5 text-muted-foreground"
                  />
                </button>
              </div>
            }
          >
            {searchResults.recent.map((page: Page) => {
              const breadcrumb = getPageBreadcrumb(page);
              return (
                <Command.Item
                  key={`recent-${page.id}`}
                  value={`recent-${page.id}-${getPageTitle(page)}`}
                  onSelect={() => {
                    onOpenPage(page, null);
                  }}
                  className="group relative flex cursor-pointer select-none items-center rounded-[8px] px-2.5 py-2 text-sm text-foreground/90 outline-none transition-colors hover:bg-[var(--goose-interactive-hover)] aria-selected:bg-[var(--goose-interactive-selected)] aria-selected:text-foreground data-[disabled=true]:pointer-events-none data-[disabled=true]:opacity-50"
                >
                  <div className="mr-2 h-4 w-4 shrink-0 flex items-center justify-center relative group/icon">
                    <span className="flex h-4 w-4 items-center justify-center transition-opacity duration-200 group-hover/icon:opacity-0 group-focus-within/icon:opacity-0">
                      {renderPageIcon(page)}
                    </span>
                    <button
                      type="button"
                      aria-label={`从最近访问中移除“${getPageTitle(page)}”`}
                      onMouseDown={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                      }}
                      onClick={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        onRemoveRecent(page.id);
                      }}
                      className="absolute inset-0 h-4 w-4 cursor-pointer rounded flex items-center justify-center opacity-0 transition-opacity duration-200 group-hover/icon:opacity-100 focus-visible:opacity-100 hover:bg-[var(--goose-icon-chip-on-selected)] dark:hover:bg-[var(--goose-interactive-hover)]"
                    >
                      <LucideIcons.X
                        aria-hidden="true"
                        className="h-3 w-3 text-muted-foreground"
                      />
                    </button>
                  </div>
                  <span className="truncate flex-1 mr-3">
                    <HighlightText
                      text={getPageTitle(page)}
                      query={searchQuery}
                    />
                  </span>
                  <BreadcrumbPath
                    parts={breadcrumb.slice(0, -1)}
                    fallback={new Date(page.updatedAt).toLocaleDateString()}
                  />
                </Command.Item>
              );
            })}
          </Command.Group>
        )}

      {searchResults.all.length > 0 && (
        <Command.Group
          heading={searchResults.hasQuery ? "搜索结果" : "所有页面"}
        >
          {searchResults.allDisplay.map((page: SearchResultPage) => {
            const breadcrumb = getPageBreadcrumb(page);
            return (
              <Command.Item
                key={`all-${page.id}`}
                value={`all-${page.id}-${getPageTitle(page)}`}
                onSelect={() => {
                  const highlightQuery = searchQuery.trim() || null;
                  onOpenPage(page, highlightQuery);
                }}
                className="relative flex cursor-pointer select-none items-start rounded-[8px] px-2.5 py-2 text-sm text-foreground/90 outline-none transition-colors hover:bg-[var(--goose-interactive-hover)] aria-selected:bg-[var(--goose-interactive-selected)] aria-selected:text-foreground data-[disabled=true]:pointer-events-none data-[disabled=true]:opacity-50"
              >
                <span className="mr-2 mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center">
                  {renderPageIcon(page)}
                </span>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between gap-3">
                    <span className="truncate font-medium">
                      <HighlightText
                        text={getPageTitle(page)}
                        query={searchQuery}
                      />
                    </span>
                    <BreadcrumbPath parts={breadcrumb.slice(0, -1)} />
                  </div>
                  {searchResults.hasQuery && page.contentSnippet && (
                    <div className="text-xs text-muted-foreground mt-0.5 truncate">
                      <HighlightText
                        text={page.contentSnippet}
                        query={searchQuery}
                      />
                    </div>
                  )}
                </div>
              </Command.Item>
            );
          })}
        </Command.Group>
      )}
    </>
  );
}
