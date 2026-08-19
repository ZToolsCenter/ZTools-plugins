import type { Page } from "@/types";
import { useTabs, type TabItem } from "@/stores/useTabs";
import type { NotebookAiLayoutMode } from "@/pages/workspace/components/notebook-ai/useNotebookAiPanel";
import { isFullscreenAiLayout } from "@/pages/workspace/components/notebook-ai/useNotebookAiPanel";
import { useAiHeaderActions } from "@/pages/workspace/components/notebook-ai/aiHeaderSlot";
import {
  DndContext,
  PointerSensor,
  useSensor,
  useSensors,
  closestCenter,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  horizontalListSortingStrategy,
  useSortable,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { AiGradientIcon } from "@/components/ui/ai-gradient-icon";
import { useAiStatus } from "@/stores/useAiStatus";
import { useSidebarView } from "@/stores/useSidebarView";
import { PageMenu } from "./PageMenu";
import { PageIconButton } from "./PageIconButton";
import { getPageTitle } from "@/components/editor/utils/page-title";
import { SingleTabTitle } from "./SingleTabTitle";

// AI 按钮由 WorkspaceLayout 按 ai.enabled 门控后传入 onToggleAiPanel。

interface SortableTabItemProps {
  tab: TabItem;
  tabPage?: Page;
  isActive: boolean;
  isDirty: boolean;
  hasLeftTabs: boolean;
  hasRightTabs: boolean;
  hasOtherTabs: boolean;
  closeTabShortcutLabel: string;
  onActivate: () => void;
  onClose: () => void;
  onCloseOthers: () => void;
  onCloseLeft: () => void;
  onCloseRight: () => void;
  onTogglePin: () => void;
  onPromotePreview: () => void;
  onLocateInTree?: () => void;
}

function SortableTabItem({
  tab,
  tabPage,
  isActive,
  isDirty,
  hasLeftTabs,
  hasRightTabs,
  hasOtherTabs,
  closeTabShortcutLabel,
  onActivate,
  onClose,
  onCloseOthers,
  onCloseLeft,
  onCloseRight,
  onTogglePin,
  onPromotePreview,
  onLocateInTree,
}: SortableTabItemProps) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id: tab.id });
  const style: React.CSSProperties = {
    transform: CSS.Translate.toString(transform),
    transition,
  };

  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        <div
          ref={setNodeRef}
          style={style}
          {...attributes}
          {...listeners}
          data-tab-active={isActive || undefined}
          data-tab-page-id={tab.pageId}
          data-tab-preview={tab.preview || undefined}
          data-tab-pinned={tab.pinned || undefined}
          onClick={onActivate}
          onDoubleClick={(event) => {
            if (!tab.preview) return;
            event.preventDefault();
            event.stopPropagation();
            onPromotePreview();
          }}
          onAuxClick={(e) => {
            if (e.button === 1) {
              e.preventDefault();
              e.stopPropagation();
              onClose();
            }
          }}
          onKeyDown={(event) => {
            if (event.key === "Enter" || event.key === " ") {
              event.preventDefault();
              onActivate();
            }
          }}
          className={cn(
            // Chrome 式收缩：默认宽度 120px，空间不足时等比变窄，活动标签保留更大下限
            "group flex h-8 min-w-12 max-w-[120px] flex-[0_1_120px] @container items-center gap-1 rounded-[8px] px-2 text-sm transition-colors",
            isDragging && "opacity-60",
            isActive
              ? "min-w-24 bg-[var(--goose-interactive-selected)] text-[var(--goose-interactive-selected-fg)]"
              : "text-muted-foreground hover:bg-[var(--goose-interactive-hover)] hover:text-foreground",
          )}
        >
          {tab.pinned && (
            <LucideIcons.Pin
              aria-label="已固定"
              className="h-3 w-3 shrink-0 text-primary"
            />
          )}
          {isDirty && (
            <span
              aria-label="未保存"
              className="h-2 w-2 shrink-0 rounded-full bg-[var(--goose-color-unsaved)]"
            />
          )}
          <span
            className={cn(
              "min-w-0 flex-1 truncate",
              tab.preview && "italic text-muted-foreground",
              isDirty && "font-medium",
              isDirty && !tab.preview && "italic",
            )}
          >
            {tab.type === "welcome"
              ? "新标签页"
              : tabPage
                ? getPageTitle(tabPage)
                : ""}
          </span>
          <TooltipProvider delayDuration={2000}>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className={cn(
                    // 标签窄于 64px 时不再 hover 出关闭按钮，避免挤掉标题、误点关闭
                    "hidden h-5 w-5 shrink-0 rounded-[6px] p-0 transition-colors @[64px]:group-hover:flex",
                    isActive
                      ? "text-foreground/70 hover:bg-[var(--goose-interactive-hover)] hover:text-foreground"
                      : "text-muted-foreground/70 hover:bg-[var(--goose-interactive-hover)] hover:text-foreground",
                  )}
                  onPointerDown={(event) => event.stopPropagation()}
                  onClick={(event) => {
                    event.stopPropagation();
                    onClose();
                  }}
                  aria-label="关闭标签页"
                >
                  <LucideIcons.X className="h-3.5 w-3.5" />
                </Button>
              </TooltipTrigger>
              <TooltipContent side="bottom">
                <div className="flex items-center gap-2">
                  <span>关闭标签页</span>
                  {closeTabShortcutLabel && (
                    <span className="text-[11px] text-muted-foreground">
                      {closeTabShortcutLabel}
                    </span>
                  )}
                </div>
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
        </div>
      </ContextMenuTrigger>
      <ContextMenuContent className="w-[200px]">
        {tab.type !== "welcome" && onLocateInTree && (
          <>
            <ContextMenuItem onSelect={onLocateInTree}>
              在文件树中定位
            </ContextMenuItem>
            <ContextMenuSeparator />
          </>
        )}
        <ContextMenuItem onSelect={onTogglePin}>
          {tab.pinned ? "取消固定" : "固定标签"}
        </ContextMenuItem>
        <ContextMenuSeparator />
        <ContextMenuItem onSelect={onClose}>
          关闭
          {closeTabShortcutLabel && (
            <span className="ml-auto text-xs text-muted-foreground">
              {closeTabShortcutLabel}
            </span>
          )}
        </ContextMenuItem>
        <ContextMenuItem onSelect={onCloseOthers} disabled={!hasOtherTabs}>
          关闭其他标签页
        </ContextMenuItem>
        <ContextMenuItem onSelect={onCloseLeft} disabled={!hasLeftTabs}>
          关闭左侧标签页
        </ContextMenuItem>
        <ContextMenuItem onSelect={onCloseRight} disabled={!hasRightTabs}>
          关闭右侧标签页
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  );
}


interface PageHeaderProps {
  page?: Page;
  onOpenSearch: () => void;
  onRestore?: () => void;
  onDelete?: () => void;
  /** AI 面板当前是否打开 */
  aiPanelOpen?: boolean;
  /** AI 打开方式：全屏时入口在标签栏最左（仅图标） */
  aiLayoutMode?: NotebookAiLayoutMode;
  /** 切换 AI 面板（传入时显示按钮，不传则不渲染） */
  onToggleAiPanel?: () => void;
  /** 激活普通标签前回调（全屏 AI 下点标签可退出全屏） */
  onBeforeActivateTab?: () => void;
}

export function PageHeader({
  page,
  onOpenSearch,
  onRestore,
  onDelete,
  aiPanelOpen,
  aiLayoutMode = "fullscreen",
  onToggleAiPanel,
  onBeforeActivateTab,
}: PageHeaderProps) {
  const aiPhase = useAiStatus((state) => state.phase);
  const aiDoneToken = useAiStatus((state) => state.doneToken);
  const { getPage } = usePages();
  const activeNotebookId = useNotebooks((state) => state.activeNotebookId);
  const notebooks = useNotebooks((state) => state.notebooks);
  // 本地文件夹页没有 page.icon 元数据；仅 uTools 内置库页在顶栏放紧凑图标入口
  const showPageIcon =
    Boolean(page) &&
    !page?.localFilePath &&
    notebooks[page?.workspaceId ?? ""]?.source !== "local-folder";
  const dirtyLocalPageIds = usePages((state) => state.dirtyLocalPageIds);
  const isTabDirty = (tabPageId: string) =>
    Boolean(dirtyLocalPageIds?.[tabPageId]);
  const {
    openTabs,
    activeTabId,
    setActiveTab,
    closeTab,
    reorderTabs,
    togglePinTab,
    promotePreviewTab,
    syncNotebookForPage,
  } = useTabs();
  const setExpandPageId = usePages((s) => s.setExpandPageId);
  const setSidebarCollapsedView = useSidebarView((s) => s.setSidebarCollapsed);
  const locateInTree = (pageId: string) => {
    // 侧栏若已折叠，先展开，否则定位无处可见
    setSidebarCollapsedView(false);
    syncNotebookForPage(pageId);
    setExpandPageId(pageId);
  };
  const { closeTabShortcut, appShortcuts, singleTabMode } = useSettings();
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
  );
  const handleTabDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const from = openTabs.findIndex((tab) => tab.id === active.id);
    const to = openTabs.findIndex((tab) => tab.id === over.id);
    if (from === -1 || to === -1) return;
    reorderTabs(from, to);
  };
  const visibleTabs = openTabs.filter((tab) => {
    // AI 不占用标签页，仅图标入口
    if (tab.type === "notebook-ai") return false;
    if (tab.type === "welcome") return true;
    const tabPage = getPage(tab.pageId);
    return (
      tabPage &&
      !tabPage.trashedAt &&
      (!activeNotebookId || tabPage.workspaceId === activeNotebookId)
    );
  });
  const showAiOnTabRail =
    Boolean(onToggleAiPanel) && isFullscreenAiLayout(aiLayoutMode);
  const showAiOnActions =
    Boolean(onToggleAiPanel) && !isFullscreenAiLayout(aiLayoutMode);
  /** 全屏 AI 打开时：隐藏 PageMenu，改挂 AI 工具栏（× / + / ···） */
  const aiFullscreenOpen =
    Boolean(aiPanelOpen) && isFullscreenAiLayout(aiLayoutMode);
  const aiHeaderActions = useAiHeaderActions();
  const [isOverflowing, setIsOverflowing] = useState(false);
  const tabsScrollerRef = useRef<HTMLDivElement>(null);
  const closeTabShortcutLabel = closeTabShortcut
    ? formatShortcut(closeTabShortcut)
    : "";
  const sidebarCollapsed = useSidebarView((s) => s.sidebarCollapsed);
  const toggleSidebarCollapsed = useSidebarView((s) => s.toggleSidebarCollapsed);
  const toggleSidebarShortcutLabel = appShortcuts.toggleSidebar
    ? formatShortcut(appShortcuts.toggleSidebar)
    : "";
  const toggleAiPanelShortcutLabel = appShortcuts.toggleAIPanel
    ? formatShortcut(appShortcuts.toggleAIPanel)
    : "";
  const prevSidebarCollapsedRef = useRef(sidebarCollapsed);
  const [sidebarExpandAttention, setSidebarExpandAttention] = useState(false);

  useEffect(() => {
    if (!prevSidebarCollapsedRef.current && sidebarCollapsed) {
      setSidebarExpandAttention(true);
      const timer = window.setTimeout(() => {
        setSidebarExpandAttention(false);
      }, 4000);
      prevSidebarCollapsedRef.current = sidebarCollapsed;
      return () => window.clearTimeout(timer);
    }
    prevSidebarCollapsedRef.current = sidebarCollapsed;
  }, [sidebarCollapsed]);

  // 切换标签或窗口缩放导致溢出时，保证活动标签始终在可视区内
  // （inline: "nearest" 已可见时零移动，不会打断用户的手动横向滚动）
  // 同步更新 isOverflowing 供「全部标签」下拉按钮显示逻辑使用
  useEffect(() => {
    const scroller = tabsScrollerRef.current;
    if (!scroller) return;
    const scrollActiveIntoView = () => {
      scroller
        .querySelector<HTMLElement>('[data-tab-active="true"]')
        ?.scrollIntoView({ inline: "nearest", block: "nearest" });
      setIsOverflowing(scroller.scrollWidth > scroller.clientWidth);
    };
    scrollActiveIntoView();
    const observer = new ResizeObserver(scrollActiveIntoView);
    observer.observe(scroller);
    return () => observer.disconnect();
  }, [activeTabId]);

  const handleTabsWheel = (event: React.WheelEvent<HTMLDivElement>) => {
    const scroller = tabsScrollerRef.current;
    if (!scroller) return;
    if (Math.abs(event.deltaY) <= Math.abs(event.deltaX)) return;
    scroller.scrollLeft += event.deltaY;
    event.preventDefault();
  };

  /** 顶栏通用图标按钮：透明底，hover 才起底，与 PageIconButton 一致 */
  const actionButtonClass =
    "inline-flex h-8 w-8 items-center justify-center rounded-[8px] text-muted-foreground/75 transition-colors duration-150 hover:bg-[var(--goose-icon-chip-on-selected)] dark:hover:bg-[var(--goose-interactive-hover)] hover:text-foreground";

  return (
    <div
      className={cn(
        "workspace-divider h-12 flex items-center justify-between px-3 bg-[hsl(var(--goose-editor-bg))] sticky top-0 z-10 shrink-0",
        aiPhase === "streaming" && "ai-header-nebula-streaming",
      )}
      data-ai-header-effect={aiPhase === "streaming" ? "nebula" : undefined}
    >
      <div className="flex min-w-0 flex-1 items-center gap-2 overflow-hidden">
        {sidebarCollapsed ? (
          <TooltipProvider delayDuration={600}>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className={cn(
                    "h-8 w-8 shrink-0 rounded-[8px] text-muted-foreground/80 transition-colors hover:bg-[var(--goose-icon-chip-on-selected)] dark:hover:bg-[var(--goose-interactive-hover)] hover:text-foreground",
                    sidebarExpandAttention && "sidebar-expand-attention",
                  )}
                  onClick={toggleSidebarCollapsed}
                  aria-label="展开侧栏"
                >
                  <LucideIcons.PanelLeftOpen className="h-4 w-4" />
                </Button>
              </TooltipTrigger>
              <TooltipContent side="bottom">
                <div className="flex items-center gap-2">
                  <span>展开侧栏</span>
                  {toggleSidebarShortcutLabel && (
                    <span className="text-[11px] text-muted-foreground">
                      {toggleSidebarShortcutLabel}
                    </span>
                  )}
                </div>
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
        ) : null}
        <div
          ref={tabsScrollerRef}
          className="group/tabs flex min-w-0 flex-1 items-center gap-1 overflow-x-auto [scroll-padding-right:40px] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
          onWheel={handleTabsWheel}
          onDoubleClick={(e) => {
            // 只在点击容器自身空白区域时触发（非标签项、非按钮）
            if (!singleTabMode && e.target === e.currentTarget) {
              onBeforeActivateTab?.();
              useTabs.getState().openWelcomeTab();
            }
          }}
        >
          {/* 全屏模式：仅图标入口钉在标签栏最左，不创建 AI 标签 */}
          {showAiOnTabRail ? (
            <TooltipProvider delayDuration={600}>
              <Tooltip>
                <TooltipTrigger asChild>
                  <button
                    type="button"
                    className={cn(
                      "ai-icon-button",
                      actionButtonClass,
                      "mr-0.5 shrink-0",
                    )}
                    data-ai-state={aiPhase}
                    onClick={onToggleAiPanel}
                    aria-label={aiPanelOpen ? "关闭 AI" : "打开 AI"}
                    aria-pressed={aiPanelOpen}
                  >
                    <AiGradientIcon
                      key={
                        aiPhase === "done" ? `done-${aiDoneToken}` : aiPhase
                      }
                      className="h-4 w-4"
                      state={aiPhase}
                    />
                  </button>
                </TooltipTrigger>
                <TooltipContent side="bottom">
                  <div className="flex items-center gap-2">
                    <span>{aiPanelOpen ? "关闭 AI" : "打开 AI"}</span>
                    {toggleAiPanelShortcutLabel && (
                      <span className="text-[11px] text-muted-foreground">
                        {toggleAiPanelShortcutLabel}
                      </span>
                    )}
                  </div>
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
          ) : null}

          {singleTabMode ? (
            page ? (
              <>
                {showPageIcon ? <PageIconButton page={page} /> : null}
                <SingleTabTitle
                  key={`${page.id}:${getPageTitle(page)}`}
                  page={page}
                />
              </>
            ) : (
              <span className="min-w-0 flex-1 truncate px-2 text-sm font-semibold text-foreground">
                开始
              </span>
            )
          ) : (
            <DndContext
              sensors={sensors}
              collisionDetection={closestCenter}
              onDragEnd={handleTabDragEnd}
            >
              <SortableContext
                items={visibleTabs.map((tab) => tab.id)}
                strategy={horizontalListSortingStrategy}
              >
                {visibleTabs.map((tab) => {
                  const tabPage =
                    tab.type === "welcome" ? undefined : getPage(tab.pageId);
                  if (tab.type !== "welcome" && !tabPage) return null;
                  const visibleIndex = visibleTabs.findIndex(
                    (t) => t.id === tab.id,
                  );
                  return (
                    <SortableTabItem
                      key={tab.id}
                      tab={tab}
                      tabPage={tabPage}
                      isActive={
                        activeTabId === tab.id &&
                        !(aiPanelOpen && isFullscreenAiLayout(aiLayoutMode))
                      }
                      isDirty={isTabDirty(tab.pageId)}
                      hasLeftTabs={visibleIndex > 0}
                      hasRightTabs={visibleIndex < visibleTabs.length - 1}
                      hasOtherTabs={visibleTabs.length > 1}
                      closeTabShortcutLabel={closeTabShortcutLabel}
                      onActivate={() => {
                        onBeforeActivateTab?.();
                        setActiveTab(tab.id);
                      }}
                      onClose={() => closeTab(tab.id)}
                      onCloseOthers={() => {
                        visibleTabs
                          .filter((item) => item.id !== tab.id)
                          .forEach((item) => closeTab(item.id));
                      }}
                      onCloseLeft={() => {
                        visibleTabs
                          .slice(0, visibleIndex)
                          .forEach((item) => closeTab(item.id));
                      }}
                      onCloseRight={() => {
                        visibleTabs
                          .slice(visibleIndex + 1)
                          .forEach((item) => closeTab(item.id));
                      }}
                      onTogglePin={() => togglePinTab(tab.id)}
                      onPromotePreview={() => promotePreviewTab(tab.id)}
                      onLocateInTree={() => locateInTree(tab.pageId)}
                    />
                  );
                })}
              </SortableContext>
            </DndContext>
          )}

          {!singleTabMode && openTabs.length === 0 && page && (
            <span className="truncate text-sm text-foreground/80">
              {getPageTitle(page)}
            </span>
          )}

          {/* 平时 hover 标签栏才显形；极端溢出滚动时仍钉在右缘，不被挤出可视区 */}
          {!singleTabMode && !page?.trashedAt && (
            <div className="pointer-events-none sticky right-0 flex shrink-0 items-center gap-0.5 rounded-[8px] bg-[hsl(var(--goose-editor-bg))] opacity-0 transition-opacity duration-150 group-hover/tabs:pointer-events-auto group-hover/tabs:opacity-100 focus-within:pointer-events-auto focus-within:opacity-100 motion-reduce:transition-none">
              <TooltipProvider delayDuration={600}>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8 shrink-0 rounded-[8px] text-muted-foreground/70 transition-colors hover:bg-[var(--goose-icon-chip-on-selected)] dark:hover:bg-[var(--goose-interactive-hover)] hover:text-foreground"
                      onClick={onOpenSearch}
                    >
                      <LucideIcons.Plus className="h-4 w-4" />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent side="bottom">
                    <span>新标签页</span>
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>
              {isOverflowing && (
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <button
                      type="button"
                      className="outline-none inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-[7px] text-muted-foreground/70 transition-colors hover:bg-[var(--goose-icon-chip-on-selected)] dark:hover:bg-[var(--goose-interactive-hover)] hover:text-foreground"
                      aria-label="全部标签页"
                    >
                      <LucideIcons.ChevronDown
                        className="h-3.5 w-3.5"
                        strokeWidth={1.75}
                      />
                    </button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent
                    className="w-[220px] outline-none"
                    align="end"
                    sideOffset={4}
                  >
                    {visibleTabs.map((tab) => {
                      const tabPage =
                        tab.type === "welcome"
                          ? undefined
                          : getPage(tab.pageId);
                      const title =
                        tab.type === "welcome"
                          ? "新标签页"
                          : tabPage
                            ? getPageTitle(tabPage)
                            : "";
                      const isActive =
                        activeTabId === tab.id &&
                        !(
                          aiPanelOpen && isFullscreenAiLayout(aiLayoutMode)
                        );
                      return (
                        <DropdownMenuItem
                          key={tab.id}
                          className={cn(
                            "flex items-center gap-2 text-[13px]",
                            isActive && "bg-[var(--goose-interactive-selected)] text-[var(--goose-interactive-selected-fg)]",
                          )}
                          onSelect={() => {
                            onBeforeActivateTab?.();
                            setActiveTab(tab.id);
                            // 跳转后滚动到该标签（welcome 标签无 pageId，直接找活动标签）
                            setTimeout(() => {
                              const scroller = tabsScrollerRef.current;
                              if (!scroller) return;
                              const el = tab.pageId
                                ? scroller.querySelector<HTMLElement>(`[data-tab-page-id="${tab.pageId}"]`)
                                : scroller.querySelector<HTMLElement>('[data-tab-active="true"]');
                              el?.scrollIntoView({ inline: "nearest", block: "nearest" });
                            }, 0);
                          }}
                        >
                          {tab.pinned && (
                            <LucideIcons.Pin
                              className="h-3 w-3 shrink-0 text-primary"
                              strokeWidth={1.75}
                            />
                          )}
                          <span
                            className={cn(
                              "min-w-0 flex-1 truncate",
                              tab.preview && "italic text-muted-foreground",
                            )}
                          >
                            {title}
                          </span>
                          {isActive && (
                            <LucideIcons.Check
                              className="h-3.5 w-3.5 shrink-0 text-foreground/60"
                              strokeWidth={1.75}
                            />
                          )}
                        </DropdownMenuItem>
                      );
                    })}
                  </DropdownMenuContent>
                </DropdownMenu>
              )}
            </div>
          )}
        </div>

        {page?.isLocked && (
          <span className="text-xs bg-[var(--goose-color-lock-bg)] text-[var(--goose-color-lock-text)] px-1.5 py-0.5 rounded">已锁定</span>
        )}
        {page?.trashedAt && (
          <span className="text-xs bg-[var(--goose-color-lock-bg)] text-[var(--goose-color-lock-text)] px-1.5 py-0.5 rounded">
            页面已被删除
          </span>
        )}
      </div>
      <div className="ml-2 flex shrink-0 items-center gap-1">
        {/* 侧栏模式：入口仍在标题栏右侧；回收站页隐藏 */}
        {showAiOnActions && !page?.trashedAt && (
          <TooltipProvider delayDuration={600}>
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  type="button"
                  className={cn("ai-icon-button", actionButtonClass)}
                  data-ai-state={aiPhase}
                  onClick={onToggleAiPanel}
                  aria-label={aiPanelOpen ? "关闭 AI 面板" : "打开 AI 面板"}
                  aria-pressed={aiPanelOpen}
                >
                  <AiGradientIcon
                    key={aiPhase === "done" ? `done-${aiDoneToken}` : aiPhase}
                    className="h-4 w-4"
                    state={aiPhase}
                  />
                </button>
              </TooltipTrigger>
              <TooltipContent side="bottom">
                <div className="flex items-center gap-2">
                  <span>{aiPanelOpen ? "关闭 AI 面板" : "打开 AI 面板"}</span>
                  {toggleAiPanelShortcutLabel && (
                    <span className="text-[11px] text-muted-foreground">
                      {toggleAiPanelShortcutLabel}
                    </span>
                  )}
                </div>
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
        )}

        {page?.trashedAt && onRestore && onDelete && (
          <>
            <TooltipProvider delayDuration={600}>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    onClick={onRestore}
                    type="button"
                    aria-label="恢复页面"
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8 rounded-[8px] bg-[var(--goose-interactive-selected)] text-[hsl(var(--foreground))] transition-colors hover:bg-[var(--goose-color-restore-hover)] hover:text-white"
                  >
                    <LucideIcons.RotateCcw className="h-4 w-4" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent side="bottom">恢复页面</TooltipContent>
              </Tooltip>
            </TooltipProvider>
            <TooltipProvider delayDuration={600}>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    onClick={onDelete}
                    type="button"
                    aria-label="永久删除页面"
                    size="icon"
                    className="h-8 w-8 rounded-[8px] bg-[var(--goose-interactive-selected)] text-[hsl(var(--foreground))] transition-colors hover:bg-[var(--goose-color-danger-hover)] hover:text-white"
                  >
                    <LucideIcons.Trash2 className="h-4 w-4" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent side="bottom">永久删除</TooltipContent>
              </Tooltip>
            </TooltipProvider>
          </>
        )}

        {/* 多标签：图标放右侧操作区，避免正文上方再占一行空白 */}
        {!singleTabMode && showPageIcon && page && !page.trashedAt ? (
          <PageIconButton page={page} />
        ) : null}

        {/* 全屏 AI：右上角给 AI 工具栏（关闭/新建/更多），隐藏页面 PageMenu */}
        {aiFullscreenOpen ? (
          aiHeaderActions
        ) : page && !page.trashedAt ? (
          <PageMenu />
        ) : null}
      </div>
    </div>
  );
}
