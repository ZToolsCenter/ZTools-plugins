import type { Page } from "@/types";
import {
  deletePageWithUndo,
  permanentlyDeletePageWithCleanup,
  restorePageWithToast,
} from "@/lib/page-delete-actions";
import { formatShortcut } from "@/lib/utils";
import { useNotebooks } from "@/stores/useNotebooks";
import { useTabs } from "@/stores/useTabs";
import { useSettings } from "@/stores/useSettings";
import { shell } from "@/lib/utools/shell";
import { formatLocalFolderOpenAppName } from "@/lib/local-folder-open-apps";
import { toast } from "@/components/ui/sonner";
import { closeNotebookAiIfFullscreen } from "@/pages/workspace/components/notebook-ai/useNotebookAiPanel";
import { openPageFromSidebar } from "@/lib/sidebarPageNavigation";

const _platform = navigator.platform || navigator.userAgent;
const _isMac = /Mac/i.test(_platform);
const _isWin = /Win/i.test(_platform);
function getFinderLabel(isFolder: boolean) {
  const action = isFolder ? "打开" : "显示";
  if (_isMac) return `在访达中${action}`;
  if (_isWin) return `在资源管理器中${action}`;
  return `在文件管理器中${action}`;
}

function getParentPath(targetPath: string): string {
  return targetPath.replace(/[\\/][^\\/]*$/, "");
}

function getExternalAppLabel(app: string): string {
  if (!app.trim()) return "用系统默认打开";
  return `用 ${formatLocalFolderOpenAppName(app, "外部应用")} 打开`;
}

function getFileManagerLabel(isFolder: boolean, fileManager: string): string {
  if (!fileManager.trim()) return getFinderLabel(isFolder);
  return `用 ${formatLocalFolderOpenAppName(fileManager, "文件管理器")} 打开`;
}

function getTerminalLabel(terminal: string): string {
  if (!terminal.trim()) return "在终端中打开";
  return `在 ${formatLocalFolderOpenAppName(terminal, "终端")} 中打开`;
}

interface SidebarContextMenuProps {
  page: Page;
  children: React.ReactNode;
  onCreateLocalFolder?: (parentId?: string) => void;
}

export function SidebarContextMenu({
  page,
  children,
  onCreateLocalFolder,
}: SidebarContextMenuProps) {
  const {
    updatePage,
    duplicatePage,
    movePageTreeToNotebook,
    undoMovePageTree,
  } = usePages();
  const notebooks = useNotebooks((state) => state.notebooks);
  const notebook = notebooks[page.workspaceId];
  const isLocalFolder = notebook?.source === "local-folder";
  const isTrashed = !!page.trashedAt;
  const movableNotebooks = Object.values(notebooks).filter(
    (item) => item.id !== page.workspaceId && item.source !== "local-folder",
  );

  const toggleFavorite = () => {
    updatePage(page.id, { isFavorite: !page.isFavorite });
  };

  const togglePinned = () => {
    updatePage(page.id, { isPinned: !page.isPinned });
  };

  const handleMoveToTopLevel = () => {
    updatePage(page.id, { parentId: undefined });
  };

  const handleDuplicatePage = () => {
    const newId = duplicatePage(page.id);
    if (!newId || newId === page.id) return;
    openPageFromSidebar(newId, "permanent");
  };

  const handleRestore = () => restorePageWithToast(page.id);

  const handleMoveToNotebook = (targetNotebookId: string) => {
    const result = movePageTreeToNotebook(page.id, targetNotebookId);
    if (!result.ok) {
      if (result.reason === "same-notebook") {
        toast.error("页面已在当前记事本");
      } else if (result.reason === "target-not-supported") {
        toast.error("目标记事本不支持移动");
      } else {
        toast.error("移动失败，请重试");
      }
      return;
    }

    const targetNotebook = notebooks[targetNotebookId];
    const targetName = targetNotebook?.name || "目标记事本";
    toast.success(`已移动到「${targetName}」`, {
      description: `共移动 ${result.movedCount} 个页面`,
      duration: 5000,
      action: {
        label: "撤回",
        onClick: () => {
          const ok = undoMovePageTree(
            result.undoSnapshots,
            result.sourceNotebookId,
            result.prevActivePageId,
          );
          if (!ok) {
            toast.error("撤回失败：源记事本不存在");
          }
        },
      },
    });
  };

  const localFolderFileManager = useSettings((s) => s.localFolderFileManager);
  const localFolderExternalEditor = useSettings(
    (s) => s.localFolderExternalEditor,
  );
  const localFolderTerminal = useSettings((s) => s.localFolderTerminal);
  const singleTabMode = useSettings((s) => s.singleTabMode);
  const hasParent = !!page.parentId;

  const handleOpenInFileManager = async () => {
    if (!page.localFilePath) return;
    const ok = localFolderFileManager.trim()
      ? await shell.openWithApp(page.localFilePath, localFolderFileManager)
      : page.isFolder
        ? await shell.openPath(page.localFilePath)
        : await shell.showItemInFolder(page.localFilePath);
    if (!ok) toast.error("打开失败，请检查文件管理器设置");
  };

  const handleOpenInTerminal = async () => {
    if (!page.localFilePath) return;
    const targetPath = page.isFolder
      ? page.localFilePath
      : getParentPath(page.localFilePath);
    const ok = await shell.openTerminalAtPath(targetPath, localFolderTerminal);
    if (!ok) toast.error("打开失败，请检查终端设置");
  };

  return (
    <>
      <ContextMenu>
        <ContextMenuTrigger asChild className="w-full">
          <div data-goose-context-trigger="true" className="h-full w-full">
            {children}
          </div>
        </ContextMenuTrigger>
        <ContextMenuContent className="goose-sidebar-context-menu w-60 !border-0">
          {!singleTabMode && (
            <ContextMenuItem
              onSelect={() => {
                if (isTrashed) return;
                closeNotebookAiIfFullscreen();
                useTabs.getState().openTab(page.id);
              }}
              disabled={isTrashed}
            >
              <LucideIcons.PanelTopOpen className="h-4 w-4" />
              <span>在新标签页打开</span>
              <span className="ml-auto text-xs text-muted-foreground">
                {formatShortcut("Mod")}+点击
              </span>
            </ContextMenuItem>
          )}
          {isLocalFolder && !isTrashed && page.localFilePath && (
            <ContextMenuItem
              onSelect={() => {
                onCreateLocalFolder?.(page.isFolder ? page.id : page.parentId);
              }}
            >
              <LucideIcons.FolderPlus className="h-4 w-4" />
              {/* 右键目标是文件夹时按需求显示「新建文件」；行为不变，仍创建子文件夹 */}
              <span>{page.isFolder ? "新建文件" : "新建文件夹"}</span>
            </ContextMenuItem>
          )}
          {isLocalFolder && !isTrashed && page.localFilePath && (
            <ContextMenuItem
              onSelect={() => {
                void shell
                  .openWithEditor(
                    page.localFilePath!,
                    localFolderExternalEditor,
                  )
                  .then((ok) => {
                    if (!ok) toast.error("打开失败，请检查外部应用设置");
                  });
              }}
            >
              <LucideIcons.SquareArrowOutUpRight className="h-4 w-4" />
              <span>{getExternalAppLabel(localFolderExternalEditor)}</span>
            </ContextMenuItem>
          )}
          {isLocalFolder && !isTrashed && page.localFilePath && (
            <ContextMenuItem onSelect={() => void handleOpenInFileManager()}>
              <LucideIcons.FolderOpen className="h-4 w-4" />
              <span>
                {getFileManagerLabel(!!page.isFolder, localFolderFileManager)}
              </span>
            </ContextMenuItem>
          )}
          {isLocalFolder && !isTrashed && page.localFilePath && (
            <ContextMenuItem onSelect={() => void handleOpenInTerminal()}>
              <LucideIcons.Terminal className="h-4 w-4" />
              <span>{getTerminalLabel(localFolderTerminal)}</span>
            </ContextMenuItem>
          )}
          {!isTrashed && !isLocalFolder && (
            <ContextMenuItem onSelect={toggleFavorite}>
              <LucideIcons.Star
                className={cn(
                  "h-4 w-4",
                  page.isFavorite &&
                    "fill-[var(--goose-color-favorite)] text-[var(--goose-color-favorite)]",
                )}
              />
              <span>{page.isFavorite ? "从最爱移除" : "添加到最爱"}</span>
            </ContextMenuItem>
          )}
          {!isTrashed && !isLocalFolder && (
            <ContextMenuItem onSelect={togglePinned}>
              <LucideIcons.Pin
                className={cn(
                  "h-4 w-4",
                  page.isPinned &&
                    "fill-[var(--goose-color-danger)] text-[var(--goose-color-danger)]",
                )}
              />
              <span>{page.isPinned ? "取消置顶" : "置顶页面"}</span>
            </ContextMenuItem>
          )}
          {!isTrashed && !isLocalFolder && (
            <ContextMenuItem onSelect={handleDuplicatePage}>
              <LucideIcons.Copy className="h-4 w-4" />
              <span>创建副本</span>
            </ContextMenuItem>
          )}

          <ContextMenuSeparator className="bg-transparent" />

          {/* 只有当页面有父级时才显示"移至顶层"选项 */}
          {hasParent && !isTrashed && !isLocalFolder && (
            <ContextMenuItem onSelect={handleMoveToTopLevel}>
              <LucideIcons.ArrowUpToLine className="h-4 w-4" />
              <span>移至顶层</span>
            </ContextMenuItem>
          )}

          {!isTrashed && !isLocalFolder && movableNotebooks.length > 0 && (
            <ContextMenuSub>
              <ContextMenuSubTrigger className="gap-2 rounded-[6px] px-1.5 py-1.5 text-[13px]">
                <LucideIcons.FolderOutput className="h-4 w-4" />
                <span>移动到笔记本</span>
              </ContextMenuSubTrigger>
              <ContextMenuPortal>
                <ContextMenuSubContent
                  sideOffset={8}
                  alignOffset={-4}
                  collisionPadding={12}
                  className="w-56 max-h-72 overflow-y-auto !border-0"
                >
                  {movableNotebooks.map((item) => (
                    <ContextMenuItem
                      key={item.id}
                      onSelect={() => handleMoveToNotebook(item.id)}
                    >
                      <span className="truncate">{item.name}</span>
                    </ContextMenuItem>
                  ))}
                </ContextMenuSubContent>
              </ContextMenuPortal>
            </ContextMenuSub>
          )}

          <ContextMenuSeparator className="bg-transparent" />

          {isTrashed ? (
            <>
              <ContextMenuItem onSelect={handleRestore}>
                <LucideIcons.RotateCcw className="h-4 w-4" />
                <span>
                  {isLocalFolder
                    ? page.isFolder
                      ? "恢复文件夹"
                      : "恢复文件"
                    : "恢复页面"}
                </span>
              </ContextMenuItem>
              <ContextMenuItem
                onSelect={() => void permanentlyDeletePageWithCleanup(page.id)}
                className="text-foreground/85 dark:text-foreground/85 focus:text-[var(--goose-color-danger-focus)] focus:bg-[var(--goose-color-danger-subtle-bg)]"
              >
                <LucideIcons.Trash2 className="h-4 w-4" />
                <span>永久删除</span>
              </ContextMenuItem>
            </>
          ) : (
            <ContextMenuItem
              onSelect={() => void deletePageWithUndo(page.id)}
              className="text-foreground/85 dark:text-foreground/85 focus:text-[var(--goose-color-danger-focus)] focus:bg-[var(--goose-color-danger-subtle-bg)]"
            >
              {isLocalFolder ? (
                <LucideIcons.FileX className="h-4 w-4" />
              ) : (
                <LucideIcons.Trash2 className="h-4 w-4" />
              )}
              <span>{isLocalFolder ? "移到系统回收站" : "移至垃圾箱"}</span>
              <span className="ml-auto text-xs text-muted-foreground">
                {formatShortcut("Mod+Backspace")}
              </span>
            </ContextMenuItem>
          )}
        </ContextMenuContent>
      </ContextMenu>
    </>
  );
}
