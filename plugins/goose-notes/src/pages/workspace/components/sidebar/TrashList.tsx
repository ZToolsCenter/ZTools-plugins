import { formatDistanceToNow } from "date-fns";
import { zhCN } from "date-fns/locale";
import { getPageTitle } from "@/components/editor/utils/page-title";
import { useEffect } from "react";
import { closeNotebookAiIfFullscreen } from "@/pages/workspace/components/notebook-ai/useNotebookAiPanel";

interface TrashListProps {
  onBack?: () => void;
  showHeader?: boolean;
  itemHeight?: number;
  selectedPageId?: string | null;
  onSelectPage?: (pageId: string | null) => void;
}

function nodeHasVisibleContent(node: unknown): boolean {
  if (!node || typeof node !== "object") return false;
  const value = node as {
    text?: unknown;
    content?: unknown;
    type?: unknown;
  };

  if (typeof value.text === "string" && value.text.trim().length > 0) {
    return true;
  }

  const children = Array.isArray(value.content) ? value.content : [];
  if (children.some((child: unknown) => nodeHasVisibleContent(child))) {
    return true;
  }

  if (
    value.type === "doc" ||
    value.type === "paragraph" ||
    value.type === "heading" ||
    value.type === "text" ||
    value.type === "hardBreak"
  ) {
    return false;
  }

  return typeof value.type === "string" && value.type.length > 0;
}

function pageHasVisibleContent(
  page: { content?: unknown } | null | undefined,
): boolean {
  return nodeHasVisibleContent(page?.content);
}

export function TrashList({
  onBack,
  showHeader = true,
  itemHeight = 52,
  selectedPageId,
  onSelectPage,
}: TrashListProps) {
  const { getTrashedPages, setActivePage, activePageId } = usePages();
  const { activeNotebookId } = useNotebooks();

  const trashedPages = getTrashedPages(activeNotebookId || undefined);
  const selectedPageExists =
    !!selectedPageId && trashedPages.some((page) => page.id === selectedPageId);
  const activePageExists =
    !!activePageId && trashedPages.some((page) => page.id === activePageId);
  const highlightedPageId = selectedPageExists
    ? selectedPageId
    : activePageExists
      ? activePageId
      : null;

  // 回收站自己的选中态与 activePage 分开维护，保证本地文件夹/空编辑区场景也有高亮反馈。
  useEffect(() => {
    if (trashedPages.length === 0) {
      onSelectPage?.(null);
      return;
    }

    if (highlightedPageId) return;

    const nextPageId = trashedPages[0].id;
    onSelectPage?.(nextPageId);
    if (activePageId !== nextPageId) {
      closeNotebookAiIfFullscreen();
      setActivePage(nextPageId);
    }
  }, [
    activePageId,
    highlightedPageId,
    onSelectPage,
    setActivePage,
    trashedPages,
  ]);

  return (
    <div className="flex flex-col h-full">
      {/* 头部 */}
      {showHeader && (
        <div className="flex items-center gap-2 px-3 py-3 shadow-[inset_0_-1px_0_hsl(var(--foreground)/0.08)]">
          <Button
            variant="ghost"
            size="icon"
            aria-label="返回"
            className="h-7 w-7"
            onClick={() => onBack?.()}
          >
            <LucideIcons.ArrowLeft className="h-4 w-4" />
          </Button>
          <div className="flex items-center gap-2">
            <LucideIcons.Trash2 className="h-4 w-4 text-muted-foreground" />
            <span className="text-sm font-medium">垃圾箱</span>
          </div>
        </div>
      )}

      {/* 列表 */}
      <ScrollArea className="flex-1">
        {trashedPages.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12 text-muted-foreground">
            <LucideIcons.Trash2 className="h-10 w-10 mb-3 opacity-50" />
            <p className="text-sm">垃圾箱是空的</p>
          </div>
        ) : (
          <div className="px-2 pb-10 pt-0.5 space-y-px">
            {trashedPages.map((page) => {
              const iconName = page.icon;
              const DefaultPageIcon = pageHasVisibleContent(page)
                ? LucideIcons.FileText
                : LucideIcons.File;
              const timeAgo = page.trashedAt
                ? formatDistanceToNow(page.trashedAt, {
                    addSuffix: true,
                    locale: zhCN,
                  })
                : "";

              return (
                <button
                  type="button"
                  key={page.id}
                  style={{ height: itemHeight }}
                  aria-current={
                    highlightedPageId === page.id ? "page" : undefined
                  }
                  className={cn(
                    "group relative flex w-full items-center gap-2 rounded-[8px] px-4 text-left transition-colors duration-200 overflow-hidden text-sm font-medium",
                    highlightedPageId === page.id
                      ? "bg-[var(--goose-interactive-selected)] text-[var(--goose-interactive-selected-fg)]"
                      : "text-muted-foreground dark:text-muted-foreground/65 hover:bg-[var(--goose-interactive-hover)] hover:text-foreground dark:hover:text-foreground/92",
                  )}
                  onClick={() => {
                    closeNotebookAiIfFullscreen();
                    onSelectPage?.(page.id);
                    setActivePage(page.id);
                  }}
                >
                  {/* 图标 */}
                  {iconName ? (
                    <div className="h-4 w-4 shrink-0 flex items-center justify-center">
                      {(LucideIcons as any)[iconName] ? (
                        (() => {
                          const Icon = (LucideIcons as any)[iconName];
                          return <Icon className="h-4 w-4" />;
                        })()
                      ) : (
                        <span className="text-xs">{iconName}</span>
                      )}
                    </div>
                  ) : (
                    <DefaultPageIcon className="h-4 w-4 shrink-0 text-muted-foreground" />
                  )}

                  {/* 标题和时间 */}
                  <div className="flex-1 min-w-0">
                    <div className="truncate text-xs font-medium leading-5">
                      {getPageTitle(page)}
                    </div>
                    <div className="text-xs leading-4 text-muted-foreground dark:text-muted-foreground/65">
                      {timeAgo}
                    </div>
                  </div>
                </button>
              );
            })}
          </div>
        )}
      </ScrollArea>

      {/* 底部提示 */}
      {trashedPages.length > 0 && (
        <div className="p-3 text-sm text-muted-foreground text-center">
          30 天后自动永久删除
        </div>
      )}
    </div>
  );
}
