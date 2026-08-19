import { FontSelector } from "@/pages/workspace/components/shared/FontSelector";
import { ImageExportThemeSelector } from "@/components/ui/image-export-theme-selector";
import { useEffect, useState } from "react";
import type { BlockNoteContent } from "@/components/editor/utils/blocknote-content";
import type { CardThemeId, WatermarkConfig } from "@/lib/imageExport";
import { exportPageToImage, exportSelectionToImage } from "@/lib/imageExport";
import { extractBlockNoteTitle } from "@/components/editor/utils/blocknote-content";
import { useHistoryView } from "@/stores/useHistoryView";
import { deletePageWithUndo } from "@/lib/page-delete-actions";
import { cn } from "@/lib/utils";
import { toast } from "@/components/ui/sonner";
import { closeNotebookAiIfFullscreen } from "@/pages/workspace/components/notebook-ai/useNotebookAiPanel";

function getEditorSelectedBlocks(): BlockNoteContent {
  try {
    const editor = (window as any).__gooseNoteEditor;
    if (editor && typeof editor.getSelection === "function") {
      const $from = editor.prosemirrorState.selection.$from;
      for (let d = $from.depth; d > 0; d--) {
        if ($from.node(d).type.name === "blockContainer") {
          const sel = editor.getSelection();
          if (Array.isArray(sel?.blocks)) return sel.blocks as BlockNoteContent;
          break;
        }
      }
    }
  } catch {
    /* ignore */
  }
  return [];
}

export function PageMenu() {
  const [viewport, setViewport] = useState(() => ({
    width: typeof window === "undefined" ? 0 : window.innerWidth,
    height: typeof window === "undefined" ? 0 : window.innerHeight,
  }));
  const { activePageId, getPage, updatePage, createPage, setActivePage } =
    usePages();
  const { activeNotebookId } = useNotebooks();
  const page = activePageId ? getPage(activePageId) : undefined;
  const [themeSelectorOpen, setThemeSelectorOpen] = useState(false);
  const [selectedBlocks, setSelectedBlocks] = useState<BlockNoteContent>([]);
  const isLocalItem = Boolean(page?.localFilePath);

  useEffect(() => {
    const updateViewport = () =>
      setViewport({ width: window.innerWidth, height: window.innerHeight });
    window.addEventListener("resize", updateViewport);
    return () => window.removeEventListener("resize", updateViewport);
  }, []);

  const handleImport = async () => {
    try {
      const result = await importFile();
      if (!result.success) {
        if (result.error !== "未选择文件") {
          toast.error(result.error || "导入失败");
        }
        return;
      }

      closeNotebookAiIfFullscreen();
      const newId = createPage(undefined, activeNotebookId || DEFAULT_NOTEBOOK);

      const content = result.content;
      const blocks = [
        { type: "heading", props: { level: 1 }, content: result.title },
        ...content,
      ] as any[];

      updatePage(newId, { content: blocks });

      setActivePage(null);
      requestAnimationFrame(() => {
        setActivePage(newId);
      });
      toast.success("已导入为新页面");
    } catch (error) {
      console.error("导入失败:", error);
      toast.error("导入失败，请检查文件后重试");
    }
  };

  const runExport = (label: string, task: () => Promise<unknown>) => {
    const toastId = toast.loading(`正在导出 ${label}…`);
    void task()
      .then(() => toast.success(`${label} 已导出`, { id: toastId }))
      .catch((error) => {
        console.error(`[export] ${label} 失败:`, error);
        toast.error(`${label} 导出失败`, { id: toastId });
      });
  };

  const handleThemeConfirm = (
    themeId: CardThemeId,
    watermarkConfig: WatermarkConfig,
  ) => {
    if (!page) return;
    const blocks = getEditorSelectedBlocks();
    if (blocks.length > 0) {
      exportSelectionToImage(
        blocks,
        extractBlockNoteTitle(page.content) || "选中内容",
        themeId,
        watermarkConfig,
      );
    } else {
      exportPageToImage(page, themeId, watermarkConfig);
    }
  };

  if (!page || !activePageId) return null;

  return (
    <>
      <DropdownMenu
        onOpenChange={(open) => {
          if (open) {
            const blocks = getEditorSelectedBlocks();
            setSelectedBlocks(blocks);
          }
        }}
      >
        <DropdownMenuTrigger asChild>
          <Button
            variant="ghost"
            size="icon"
            aria-label="更多操作"
            className="h-8 w-8 rounded-[8px] text-muted-foreground/70 transition-colors duration-150 hover:bg-[var(--goose-icon-chip-on-selected)] dark:hover:bg-[var(--goose-interactive-hover)] hover:text-foreground"
          >
            <LucideIcons.MoreHorizontal className="h-4 w-4" />
            <span className="sr-only">更多操作</span>
          </Button>
        </DropdownMenuTrigger>
        {/*
          不要在定位外壳上挂 goose-editor-context-ui（CSS zoom）。
          uTools 旧内核会把 zoom 祖先的 getBoundingClientRect 再次放大，
          导致导出子菜单相对「导出」触发项下漂，中间出现无法穿越的空隙。
          页面更多菜单走 viewport 坐标系，尺寸用真实 px。
        */}
        <DropdownMenuContent
          className="max-h-[calc(100vh-24px)] w-[272px] max-w-[calc(100vw-16px)] overflow-y-auto rounded-[12px] p-1.5"
          align="end"
          sideOffset={6}
          style={{
            maxHeight:
              viewport.height <= 0
                ? undefined
                : `${Math.max(160, viewport.height - 24)}px`,
            maxWidth:
              viewport.width <= 0
                ? undefined
                : `${Math.max(160, viewport.width - 16)}px`,
          }}
          forceMount
        >
          {/* Font Selector */}
          <div className="px-0.5 py-1">
            <FontSelector
              value={page.fontFamily}
              compact
              onChange={(fontFamily) =>
                updatePage(activePageId, { fontFamily })
              }
            />
          </div>

          <div className="mx-1 my-1 h-px bg-border" />

          <section aria-label="页面状态">
            <div className="px-2 pb-1 text-[10px] font-medium tracking-[0.08em] text-muted-foreground">
              页面状态
            </div>
            <div className="grid grid-cols-2 gap-1 px-1 pb-0.5">
              <button
                type="button"
                aria-pressed={page.isFavorite}
                onClick={() =>
                  updatePage(activePageId, { isFavorite: !page.isFavorite })
                }
                className={cn(
                  "relative grid min-h-[40px] grid-cols-[20px_minmax(0,1fr)] items-center gap-1.5 rounded-[9px] border px-2 py-1 pr-5 text-left transition-colors duration-150",
                  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1",
                  page.isFavorite
                    ? "border-[#ead39b] bg-[#fff8e6] text-[#8a621a] hover:bg-[#fff3d6] dark:border-[#654f23] dark:bg-[#3a2d16] dark:text-[#fbbf24] dark:hover:bg-[#44351a]"
                    : "border-[var(--goose-block-subtle-border)] bg-card text-foreground hover:bg-[var(--goose-block-subtle-bg)]",
                )}
              >
                <span
                  className={cn(
                    "grid h-5 w-5 place-items-center rounded-[7px]",
                    page.isFavorite && "bg-[#fff1c8] dark:bg-[#4b3919]",
                  )}
                >
                  <LucideIcons.Star
                    className={cn(
                      "h-3.5 w-3.5 text-muted-foreground",
                      page.isFavorite &&
                        "fill-[var(--goose-color-favorite)] text-[var(--goose-color-favorite)]",
                    )}
                  />
                </span>
                <span className="min-w-0 truncate text-xs font-medium">
                  {isLocalItem ? "收藏文件" : "收藏页面"}
                </span>
                {page.isFavorite && (
                  <LucideIcons.Check className="absolute right-1.5 top-1.5 h-3 w-3" />
                )}
              </button>

              <button
                type="button"
                aria-pressed={page.isPinned}
                onClick={() =>
                  updatePage(activePageId, { isPinned: !page.isPinned })
                }
                className={cn(
                  "relative grid min-h-[40px] grid-cols-[20px_minmax(0,1fr)] items-center gap-1.5 rounded-[9px] border px-2 py-1 pr-5 text-left transition-colors duration-150",
                  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1",
                  page.isPinned
                    ? "border-[#e8c0bc] bg-[#fff0ee] text-[#91433d] hover:bg-[#ffe7e4] dark:border-[#6b3734] dark:bg-[#3f2020] dark:text-[#f87171] dark:hover:bg-[#492525]"
                    : "border-[var(--goose-block-subtle-border)] bg-card text-foreground hover:bg-[var(--goose-block-subtle-bg)]",
                )}
              >
                <span
                  className={cn(
                    "grid h-5 w-5 place-items-center rounded-[7px]",
                    page.isPinned && "bg-[#ffe1dd] dark:bg-[#512827]",
                  )}
                >
                  <LucideIcons.Pin
                    className={cn(
                      "h-3.5 w-3.5 text-muted-foreground",
                      page.isPinned &&
                        "fill-[var(--goose-color-danger)] text-[var(--goose-color-danger)]",
                    )}
                  />
                </span>
                <span className="min-w-0 truncate text-xs font-medium">
                  置顶页面
                </span>
                {page.isPinned && (
                  <LucideIcons.Check className="absolute right-1.5 top-1.5 h-3 w-3" />
                )}
              </button>
            </div>

            {/* 页面锁定同属页面状态，连续呈现，避免用分割线制造多余层级。 */}
            <div
              role="button"
              tabIndex={0}
              className="grid min-h-[32px] cursor-pointer grid-cols-[18px_minmax(0,1fr)_auto] items-center gap-x-1.5 rounded-[9px] px-2 text-xs hover:bg-[var(--goose-block-subtle-bg)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1"
              onClick={() =>
                updatePage(activePageId, { isLocked: !page.isLocked })
              }
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  updatePage(activePageId, { isLocked: !page.isLocked });
                }
              }}
            >
              <LucideIcons.Lock className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
              <span className="min-w-0 truncate">锁定页面</span>
              <Switch
                aria-label="锁定页面"
                checked={page.isLocked}
                onCheckedChange={(checked) =>
                  updatePage(activePageId, { isLocked: checked })
                }
                onClick={(e) => e.stopPropagation()}
              />
            </div>
          </section>

          {/* Import */}
          {!isLocalItem && (
            <DropdownMenuGroup>
              <DropdownMenuItem
                className="grid min-h-[32px] grid-cols-[18px_minmax(0,1fr)] gap-x-1.5 px-2 text-xs"
                onSelect={handleImport}
              >
                <LucideIcons.Upload className="h-3.5 w-3.5 text-muted-foreground" />
                <span className="min-w-0 truncate">导入</span>
              </DropdownMenuItem>
            </DropdownMenuGroup>
          )}

          {/* Generate Image — standalone, before Export */}
          <DropdownMenuItem
            className="page-menu-generate-image grid min-h-[32px] grid-cols-[18px_minmax(0,1fr)] gap-x-1.5 px-2 text-xs text-foreground"
            onSelect={() => {
              setSelectedBlocks(getEditorSelectedBlocks());
              setThemeSelectorOpen(true);
            }}
          >
            <LucideIcons.Image className="h-3.5 w-3.5 text-muted-foreground" />
            <span className="page-menu-shimmer-text min-w-0 truncate font-medium text-foreground">
              {selectedBlocks.length > 0 ? "生成选中图片" : "生成图片"}
            </span>
          </DropdownMenuItem>

          {/* Export submenu */}
          <DropdownMenuGroup>
            <DropdownMenuSub>
              <DropdownMenuSubTrigger className="grid min-h-[32px] grid-cols-[18px_minmax(0,1fr)_auto] items-center gap-x-1.5 px-2 text-xs">
                <LucideIcons.Download className="h-3.5 w-3.5 text-muted-foreground" />
                <span className="min-w-0 truncate">导出</span>
              </DropdownMenuSubTrigger>
              <DropdownMenuSubContent
                className="min-w-[144px] rounded-[12px] p-1"
                sideOffset={2}
                alignOffset={-4}
                collisionPadding={8}
                style={{
                  maxHeight:
                    viewport.height <= 0
                      ? undefined
                      : `${Math.max(120, viewport.height - 16)}px`,
                }}
              >
                <DropdownMenuItem
                  className="grid grid-cols-[16px_minmax(0,1fr)] gap-x-2 text-xs"
                  onSelect={() => runExport("JSON", () => exportToJSON(page))}
                >
                  <LucideIcons.FileJson className="h-3.5 w-3.5 text-muted-foreground" />
                  <span className="min-w-0 truncate">JSON</span>
                </DropdownMenuItem>
                <DropdownMenuItem
                  className="grid grid-cols-[16px_minmax(0,1fr)] gap-x-2 text-xs"
                  onSelect={() =>
                    runExport("Markdown", () => exportToMarkdown(page))
                  }
                >
                  <LucideIcons.FileCode className="h-3.5 w-3.5 text-muted-foreground" />
                  <span className="min-w-0 truncate">Markdown</span>
                </DropdownMenuItem>
                <DropdownMenuItem
                  className="grid grid-cols-[16px_minmax(0,1fr)] gap-x-2 text-xs"
                  onSelect={() => runExport("HTML", () => exportToHTML(page))}
                >
                  <LucideIcons.FileType className="h-3.5 w-3.5 text-muted-foreground" />
                  <span className="min-w-0 truncate">HTML</span>
                </DropdownMenuItem>
                <DropdownMenuItem
                  className="grid grid-cols-[16px_minmax(0,1fr)] gap-x-2 text-xs"
                  onSelect={() => runExport("PDF", () => exportToPDF(page))}
                >
                  <LucideIcons.FileText className="h-3.5 w-3.5 text-muted-foreground" />
                  <span className="min-w-0 truncate">PDF</span>
                </DropdownMenuItem>
              </DropdownMenuSubContent>
            </DropdownMenuSub>

            <DropdownMenuItem
              className="grid min-h-[32px] grid-cols-[18px_minmax(0,1fr)] gap-x-1.5 px-2 text-xs"
              disabled={page?.isFolder}
              onSelect={() => {
                const pid = activePageId;
                // 进入历史模式前 flush，避免 200ms debounce 内的最新编辑丢失
                try {
                  flushEditorContent(true);
                } catch {
                  /* ignore */
                }
                setTimeout(() => {
                  useHistoryView.getState().enter(pid);
                }, 80);
              }}
            >
              <LucideIcons.History className="h-3.5 w-3.5 text-muted-foreground" />
              <span className="min-w-0 truncate">页面历史</span>
            </DropdownMenuItem>
          </DropdownMenuGroup>

          <DropdownMenuItem
            className="group grid min-h-[32px] grid-cols-[18px_minmax(0,1fr)] gap-x-1.5 px-2 text-xs text-foreground data-[highlighted]:text-[var(--goose-color-danger-focus)] focus:text-[var(--goose-color-danger-focus)]"
            onClick={() => void deletePageWithUndo(activePageId)}
          >
            {isLocalItem ? (
              <LucideIcons.FileX className="h-3.5 w-3.5 text-muted-foreground group-data-[highlighted]:text-[var(--goose-color-danger-focus)]" />
            ) : (
              <LucideIcons.Trash2 className="h-3.5 w-3.5 text-muted-foreground group-data-[highlighted]:text-[var(--goose-color-danger-focus)]" />
            )}
            <span className="min-w-0 truncate">
              {isLocalItem ? "移到系统回收站" : "移至垃圾箱"}
            </span>
          </DropdownMenuItem>

          <div className="mx-1 mt-1 h-px bg-border" />

          <div className="flex items-center justify-between gap-3 px-2 py-1 text-[10px] text-muted-foreground">
            <span>{countWords(page.content)} 字</span>
            <span className="min-w-0 truncate text-right">
              编辑于 {new Date(page.updatedAt).toLocaleString("zh-CN")}
            </span>
          </div>
        </DropdownMenuContent>
      </DropdownMenu>

      <ImageExportThemeSelector
        open={themeSelectorOpen}
        onOpenChange={setThemeSelectorOpen}
        onConfirm={handleThemeConfirm}
        mode={selectedBlocks.length > 0 ? "selection" : "page"}
      />
    </>
  );
}
