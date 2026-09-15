import { FavoritesSection } from "./FavoritesSection";
import { SidebarFooter } from "./SidebarFooter";
import { SidebarHeader } from "./SidebarHeader";
import { SidebarMainTree } from "./main-tree/SidebarMainTree";
import { SettingsDialog } from "./SettingsDialog";
import { TrashList } from "./TrashList";
import { useTabs } from "@/stores/useTabs";
import { useSidebarView } from "@/stores/useSidebarView";
import type { EditorRef } from "@/components/editor/core/Editor";
import { useSidebarResize } from "./hooks/useSidebarResize";
import { useSidebarItemHeight } from "./hooks/useSidebarItemHeight";
import { useSidebarEffects } from "./hooks/useSidebarEffects";
import { SidebarResizeEdge } from "./SidebarResizeEdge";
import { SidebarSectionHeader } from "./SidebarSectionHeader";
import { SidebarRenameDialog, useRenameDialog } from "./SidebarRenameDialog";
import { SidebarOutline } from "./SidebarOutline";
import { HistoryVersionList } from "../history/HistoryView";
import { useHistoryView } from "@/stores/useHistoryView";
import { closeNotebookAiIfFullscreen } from "../notebook-ai/useNotebookAiPanel";

type SidebarView = "pages" | "trash" | "outline";
type SidebarDragGuideMode = "sort" | "nest-ready";

interface SidebarDragGuideState {
  direction: "left" | "right";
  mode: SidebarDragGuideMode;
}

interface SidebarProps extends React.HTMLAttributes<HTMLDivElement> {
  className?: string;
  disableResize?: boolean;
  selectedPageId?: string | null;
  editorRef?: React.RefObject<EditorRef | null>;
  scrollContainerRef?: React.RefObject<HTMLDivElement | null>;
}

export function Sidebar({
  className,
  disableResize = false,
  selectedPageId,
  editorRef,
  scrollContainerRef,
}: SidebarProps) {
  const {
    activePageId,
    setActivePage,
    createPage,
    createLocalPage,
    getPage,
    setExpandPageId,
  } = usePages();
  const { activeNotebookId, notebooks } = useNotebooks();
  const { openInCurrentTab } = useTabs();
  const setExpanded = useSidebarView((s) => s.setExpanded);
  const sidebarCollapsed = useSidebarView((s) => s.sidebarCollapsed);
  const activeNotebook = activeNotebookId ? notebooks[activeNotebookId] : null;
  const isLocalFolder = activeNotebook?.source === "local-folder";

  const itemHeight = useSidebarItemHeight();
  const rowHeight = itemHeight + 1;
  const trashItemHeight = Math.max(itemHeight + 20, 48);

  const { width, isResizing, handleResizeMouseDown, handleResizePointerDown } =
    useSidebarResize({ disableResize });

  const [showSettings, setShowSettings] = useState(false);
  const [currentView, setCurrentView] = useState<SidebarView>("pages");
  const [selectedTrashPageId, setSelectedTrashPageId] = useState<string | null>(
    null,
  );
  const [dragGuide, setDragGuide] = useState<SidebarDragGuideState | null>(
    null,
  );

  // 历史模式：整块侧栏主体替换为页面历史模块（隐藏笔记本 Header），
  // Footer 与 currentView/scrollAreaRef 等 state 保持，退出后页面树回到上次状态。
  const historyActivePageId = useHistoryView((s) => s.active);
  const exitHistoryView = useHistoryView((s) => s.exit);
  const inHistoryMode =
    !!historyActivePageId && historyActivePageId === activePageId;

  const sidebarRef = useRef<HTMLDivElement>(null);
  const scrollAreaRef = useRef<HTMLDivElement>(null);
  const [scrollAreaHeight, setScrollAreaHeight] = useState(0);

  const {
    renameDialogOpen,
    setRenameDialogOpen,
    renameValue,
    setRenameValue,
    renamePageId,
    closeRenameDialog,
    confirmRename,
  } = useRenameDialog();

  useSidebarEffects({
    activePageId,
    activeNotebookId,
    currentView,
    onOpenSettings: () => setShowSettings(true),
  });

  const exitTrashView = useCallback(() => {
    setCurrentView((view) => (view === "trash" ? "pages" : view));
    setSelectedTrashPageId(null);
  }, []);

  const previousNotebookIdRef = useRef<string | null | undefined>(undefined);
  const resetSidebarAfterNotebookChange = useCallback(
    (options: { localFolder: boolean; exitHistory: boolean }) => {
      setCurrentView("pages");
      setSelectedTrashPageId(null);
      setShowSettings(false);
      closeRenameDialog();
      if (options.exitHistory) exitHistoryView();
      if (options.localFolder) void setActivePage(null);
    },
    [closeRenameDialog, exitHistoryView, setActivePage],
  );

  useEffect(() => {
    const previousNotebookId = previousNotebookIdRef.current;
    previousNotebookIdRef.current = activeNotebookId;
    if (previousNotebookId === activeNotebookId) return;
    if (previousNotebookId === undefined && !isLocalFolder) return;

    resetSidebarAfterNotebookChange({
      localFolder: isLocalFolder,
      exitHistory: inHistoryMode,
    });
  }, [
    activeNotebookId,
    inHistoryMode,
    isLocalFolder,
    resetSidebarAfterNotebookChange,
  ]);

  useEffect(() => {
    const handleWindowExit = () => {
      exitTrashView();
    };
    const handleVisibilityChange = () => {
      if (document.visibilityState === "hidden") {
        exitTrashView();
      }
    };

    window.addEventListener("goose-note:plugin-out", handleWindowExit);
    window.addEventListener("goose-note:plugin-enter", handleWindowExit);
    window.addEventListener("pagehide", handleWindowExit);
    window.addEventListener("beforeunload", handleWindowExit);
    document.addEventListener("visibilitychange", handleVisibilityChange);

    return () => {
      window.removeEventListener("goose-note:plugin-out", handleWindowExit);
      window.removeEventListener("goose-note:plugin-enter", handleWindowExit);
      window.removeEventListener("pagehide", handleWindowExit);
      window.removeEventListener("beforeunload", handleWindowExit);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [exitTrashView]);

  useEffect(() => {
    if (!scrollAreaRef.current) return;
    const updateHeight = () => {
      const height = scrollAreaRef.current?.clientHeight ?? 0;
      setScrollAreaHeight(height);
    };
    updateHeight();
    const observer = new ResizeObserver(updateHeight);
    observer.observe(scrollAreaRef.current);
    return () => observer.disconnect();
  }, []);

  const handleCreatePage = () => {
    if (!activeNotebookId) return;
    closeNotebookAiIfFullscreen();
    // 在当前所处页面的同级创建：取当前页的 parentId 作为新页的父级
    const basePageId = selectedPageId ?? activePageId;
    const basePage = basePageId ? getPage(basePageId) : undefined;
    const siblingParentId =
      basePage && basePage.workspaceId === activeNotebookId
        ? basePage.parentId
        : undefined;
    if (isLocalFolder) {
      void createLocalPage(siblingParentId, activeNotebookId);
      return;
    }
    const newPageId = createPage(siblingParentId, activeNotebookId);
    openInCurrentTab(newPageId);
    // 新页若落在折叠的父级下，展开祖先并聚焦使其可见
    if (siblingParentId) setExpandPageId(newPageId);
  };

  const handleSearch = () => {
    window.dispatchEvent(new CustomEvent("goose-note:open-search"));
  };

  return (
    <div
      ref={sidebarRef}
      className={cn(
        "pb-0 bg-[hsl(var(--goose-shell-bg))] h-full flex flex-col relative group/sidebar",
        isResizing
          ? "transition-[opacity] duration-200 ease-[cubic-bezier(0.16,1,0.3,1)]"
          : "transition-[width,opacity] duration-200 ease-[cubic-bezier(0.16,1,0.3,1)]",
        sidebarCollapsed && "pointer-events-none",
        className,
      )}
      style={{
        width: sidebarCollapsed ? 0 : width,
        minWidth: sidebarCollapsed ? 0 : undefined,
        opacity: sidebarCollapsed ? 0 : 1,
        overflow: sidebarCollapsed ? "hidden" : "visible",
      }}
      aria-hidden={sidebarCollapsed}
    >
      {!disableResize && !sidebarCollapsed && (
        <SidebarResizeEdge
          isResizing={isResizing}
          onMouseDown={handleResizeMouseDown}
          onPointerDown={handleResizePointerDown}
        />
      )}

      <div className="flex-1 flex flex-col overflow-hidden rounded-[inherit]">
        {inHistoryMode ? (
          // 历史模式：整块侧栏主体交给页面历史模块，不露出笔记本切换器。
          <HistoryVersionList />
        ) : (
          <>
            <SidebarHeader
              dragGuide={dragGuide}
              selectedPageId={selectedPageId}
              onOpenPinnedPage={() => {
                setCurrentView("pages");
                setShowSettings(false);
              }}
            />

            {currentView === "trash" ? (
              <div className="flex-1 overflow-hidden">
                <TrashList
                  showHeader={false}
                  itemHeight={trashItemHeight}
                  selectedPageId={selectedTrashPageId}
                  onSelectPage={setSelectedTrashPageId}
                />
              </div>
            ) : (
              <>
                <FavoritesSection
                  width={width}
                  rowHeight={rowHeight}
                  itemHeight={itemHeight}
                  onCreatePage={handleCreatePage}
                />

                <div className="flex-1 min-h-0 flex flex-col">
                  <div className="mt-1 shrink-0">
                    <SidebarSectionHeader
                      title={isLocalFolder ? "本地" : "页面"}
                      onSearch={handleSearch}
                      onCreate={handleCreatePage}
                      createTitle={isLocalFolder ? "新建文件" : "新建页面"}
                      view={currentView}
                      onSwitchToPages={() => {
                        if (currentView === "pages" && activeNotebookId) {
                          setExpanded(activeNotebookId, []);
                        } else {
                          setCurrentView("pages");
                        }
                      }}
                      onSwitchToOutline={() => {
                        closeNotebookAiIfFullscreen();
                        setCurrentView("outline");
                      }}
                    />
                  </div>
                  {currentView === "pages" ? (
                    <div
                      ref={scrollAreaRef}
                      className="pl-0 flex-1 min-h-0 flex flex-col"
                    >
                      <SidebarMainTree
                        activeNotebookId={activeNotebookId}
                        selectedPageId={selectedPageId}
                        width={width}
                        rowHeight={rowHeight}
                        itemHeight={itemHeight}
                        viewportHeight={scrollAreaHeight}
                        onCreatePage={handleCreatePage}
                      />
                    </div>
                  ) : (
                    <div className="pl-0 pr-[9px] flex-1 min-h-0 overflow-hidden">
                      <SidebarOutline
                        editorRef={editorRef}
                        scrollContainerRef={scrollContainerRef}
                        pageId={activePageId}
                      />
                    </div>
                  )}
                </div>
              </>
            )}
          </>
        )}
      </div>

      <SidebarFooter
        currentView={currentView}
        isSettingsOpen={showSettings}
        hideTrash={isLocalFolder}
        onSwitchToTrash={() => {
          // 再点一次回收箱图标即返回页面视图（回收箱视图隐藏了页面/大纲分区头，
          // 没有别的返回入口，靠这个图标做开关，避免卡在回收箱里出不来）。
          if (currentView === "trash") {
            setCurrentView("pages");
            setSelectedTrashPageId(null);
            return;
          }
          if (inHistoryMode) exitHistoryView();
          closeNotebookAiIfFullscreen();
          setCurrentView("trash");
          setShowSettings(false);
          setSelectedTrashPageId(null);
          setActivePage(null);
        }}
        onOpenSettings={() => {
          if (inHistoryMode) exitHistoryView();
          setShowSettings(true);
        }}
      />

      <SidebarRenameDialog
        open={renameDialogOpen}
        onOpenChange={(open) => {
          setRenameDialogOpen(open);
        }}
        renamePageId={renamePageId}
        renameValue={renameValue}
        onRenameValueChange={setRenameValue}
        isLocalFolder={isLocalFolder}
        onConfirm={() => {
          void confirmRename();
        }}
      />

      <SettingsDialog open={showSettings} onOpenChange={setShowSettings} />
    </div>
  );
}
