import { type RefObject, useEffect, useRef } from "react";
import * as LucideIcons from "lucide-react";
import { useShallow } from "zustand/react/shallow";
import { cn } from "@/lib/utils";
import { usePages } from "@/stores/usePages";
import { useNotebooks } from "@/stores/useNotebooks";
import { useSettings } from "@/stores/useSettings";
import { useTabs } from "@/stores/useTabs";
import { Sidebar } from "./components/sidebar/Sidebar";
import { PageEmptyState } from "./components/page/PageEmptyState";
import { FolderHomePage } from "./components/page/FolderHomePage";
import { PageHeader } from "./components/page/PageHeader";
import { CommandPalette } from "./components/command/CommandPalette";
import { AIFeatureNotice } from "./components/AIFeatureNotice";
import { Editor, type EditorRef } from "@/components/editor/core/Editor";
import { locateAndHighlight } from "@/components/editor/find/searchHighlightLocate";
import { EditorHostBridge } from "./components/editor-host/EditorHostBridge";
import {
  HistoryToolbar,
  HistoryReader,
} from "./components/history/HistoryView";
import { useHistoryView } from "@/stores/useHistoryView";
import {
  permanentlyDeletePageWithCleanup,
  restorePageWithToast,
} from "@/lib/page-delete-actions";
import { NotebookAiPanel } from "./components/notebook-ai/NotebookAiPanel";
import { NotebookAiHostScope } from "./components/notebook-ai/NotebookAiHostScope";
import { NotebookAiSessionProvider } from "./components/notebook-ai/NotebookAiSession";
import {
  isFullscreenAiLayout,
  useNotebookAiPanel,
} from "./components/notebook-ai/useNotebookAiPanel";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { subscribePageTitleFocus } from "@/lib/page-title-focus";

interface WorkspaceLayoutProps {
  isDragging: boolean;
  dragIntent: "folder" | "text-file" | "file";
  onDragEnter: (e: React.DragEvent) => void;
  onDragOver: (e: React.DragEvent) => void;
  onDragLeave: (e: React.DragEvent) => void;
  onDrop: (e: React.DragEvent) => Promise<void>;
  editorRef: RefObject<EditorRef | null>;
  scrollContainerRef: RefObject<HTMLDivElement | null>;
}

export function WorkspaceLayout({
  isDragging,
  dragIntent,
  onDragEnter,
  onDragOver,
  onDragLeave,
  onDrop,
  editorRef,
  scrollContainerRef,
}: WorkspaceLayoutProps) {
  const { activePageId, getPage } = usePages(
    useShallow((s) => ({
      activePageId: s.activePageId,
      getPage: s.getPage,
    })),
  );
  const { openTabs, activeTabId, openWelcomeTab } = useTabs(
    useShallow((s) => ({
      openTabs: s.openTabs,
      activeTabId: s.activeTabId,
      openWelcomeTab: s.openWelcomeTab,
    })),
  );
  const activeTab = openTabs.find((t) => t.id === activeTabId);
  const isWelcomeTab = activeTab?.type === "welcome";
  const openWelcomeTabHandler = () => {
    openWelcomeTab();
  };
  const aiEnabled = useSettings((s) => s.ai.enabled);
  const {
    isOpen: aiPanelOpen,
    layoutMode: aiLayoutMode,
    setLayoutMode: setAiLayoutMode,
    open: openAiPanel,
    toggle: toggleAiPanel,
    close: closeAiPanel,
    capturedSelection: aiPanelCapturedSelection,
    consumeCapturedSelection: consumeAiPanelCapturedSelection,
  } = useNotebookAiPanel();
  const aiFullscreen = isFullscreenAiLayout(aiLayoutMode);
  const showSideAiPanel =
    aiEnabled && aiPanelOpen && !aiFullscreen;
  const showFullscreenAi =
    aiEnabled && aiPanelOpen && aiFullscreen;
  const searchHighlightNonce = usePages((s) => s.searchHighlightNonce);
  const searchHighlightQuery = usePages((s) => s.searchHighlightQuery);
  const searchHighlightPageId = usePages((s) => s.searchHighlightPageId);
  const handledSearchHighlightNonce = usePages(
    (s) => s.handledSearchHighlightNonce,
  );
  const setHandledSearchHighlightNonce = usePages(
    (s) => s.setHandledSearchHighlightNonce,
  );
  const { activeNotebookId, notebooks } = useNotebooks(
    useShallow((s) => ({
      activeNotebookId: s.activeNotebookId,
      notebooks: s.notebooks,
    })),
  );
  const singleTabMode = useSettings((s) => s.singleTabMode);
  const historyActivePageId = useHistoryView((s) => s.active);
  const inHistoryMode =
    !!historyActivePageId && historyActivePageId === activePageId;

  const page = activePageId ? getPage(activePageId) : undefined;
  const pageNotebook = page ? notebooks[page.workspaceId] : undefined;
  // 以页面本身是否带本地路径为准（比 notebook.source 更贴合「正文无 H1 标题块」）
  const isLocalFolderPage =
    Boolean(page?.localFilePath) || pageNotebook?.source === "local-folder";
  // Notebook AI 已具备本地文件读取保护、写入失败回滚和本地页面创建通道，
  // 不应再把本地文件夹笔记本静默排除。设置页开启后，所有笔记本统一显示入口。
  const aiAvailableForNotebook = aiEnabled;
  // 全屏 AI 优先用当前笔记本；本地文件夹切页竞态下 activeNotebookId 可能短暂为空，回退到页面所属本。
  const aiNotebookId = activeNotebookId ?? page?.workspaceId ?? null;

  // 全局搜索「跳转即定位」：监听搜索高亮信号，落到匹配块并展开折叠 + 高亮。
  // 信号由命令面板写入（只带 query，不带 blockId），见 searchHighlightLocate.ts。
  //
  // 关键：点搜索结果时「切页」是异步的，nonce 信号到达那一刻 activePageId 往往还没追上
  // 目标页。所以本 effect 不能只依赖 nonce，否则首跑被 pageId 守卫挡掉后永不重试。
  // 改为：依赖 activePageId/page 一并参与，用 handledSearchHighlightNonce 做幂等去重，
  // 等切页落定、目标页 editor ready 后自然会再跑一次并完成定位。
  const locateRetryRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Mod+J 快捷键（useAppHotkeys 派发）→ 开关 AI 面板，与 UI 按钮门控一致：未启用 AI 时不响应
  useEffect(() => {
    const onToggle = () => {
      if (!aiAvailableForNotebook) return;
      toggleAiPanel();
      // 由关闭切到打开时，面板若是首次挂载会自行聚焦；已挂载（如布局切换场景）则补发聚焦事件
      if (!aiPanelOpen) {
        window.dispatchEvent(new CustomEvent("goose-note:focus-ai-composer"));
      }
    };
    window.addEventListener("goose-note:toggle-ai-panel", onToggle);
    return () =>
      window.removeEventListener("goose-note:toggle-ai-panel", onToggle);
  }, [aiAvailableForNotebook, aiPanelOpen, toggleAiPanel]);

  // 极简工作区的新建页会直接进入标题编辑。若此时 AI 正以全屏覆盖主区域，
  // 必须同步退出 AI，否则只会看到页头标题框，正文仍错误地停留在 AI 会话。
  useEffect(
    () =>
      subscribePageTitleFocus(() => {
        if (aiPanelOpen && isFullscreenAiLayout(aiLayoutMode)) {
          closeAiPanel();
        }
      }),
    [aiLayoutMode, aiPanelOpen, closeAiPanel],
  );

  // 编辑器内的显式面板事件统一走此入口。
  // 使用 open 而非 toggle，重复触发不会把已经打开的面板关掉。
  useEffect(() => {
    const onOpen = (event: Event) => {
      if (!aiAvailableForNotebook) return;
      const detail = (event as CustomEvent<unknown>).detail;
      const capture =
        detail &&
        typeof detail === "object" &&
        (detail as Record<string, unknown>).version === 1 &&
        typeof (detail as Record<string, unknown>).pageId === "string" &&
        Boolean((detail as Record<string, unknown>).selection)
          ? (detail as Parameters<typeof openAiPanel>[0])
          : null;
      openAiPanel(capture);
      // 面板已打开时重复触发「打开」不会重挂载，补发聚焦事件让输入框重新获焦；
      // 首次挂载时面板自身会聚焦，此事件无害。
      window.dispatchEvent(new CustomEvent("goose-note:focus-ai-composer"));
    };
    window.addEventListener("goose-note:open-ai-panel", onOpen);
    return () => window.removeEventListener("goose-note:open-ai-panel", onOpen);
  }, [aiAvailableForNotebook, openAiPanel]);

  // AI 功能不可用时强制收起侧栏面板，避免 localStorage 仍为 true 导致下次误展开
  useEffect(() => {
    if (!aiAvailableForNotebook) closeAiPanel();
  }, [aiAvailableForNotebook, closeAiPanel]);

  useEffect(() => {
    if (locateRetryRef.current) {
      clearTimeout(locateRetryRef.current);
      locateRetryRef.current = null;
    }
    if (!searchHighlightNonce || searchHighlightNonce <= 0) return;
    // 这个 nonce 已经处理过了，跳过（幂等，避免重复定位/重复高亮）
    if (searchHighlightNonce === handledSearchHighlightNonce) return;
    if (!searchHighlightQuery) return;
    // 信号指向的页面还没成为当前活动页 → 等切页完成后本 effect 会因 activePageId
    // 变化再次运行，那时再继续。不在这里标记 handled，留待真正定位成功。
    if (!searchHighlightPageId || searchHighlightPageId !== activePageId)
      return;
    if (inHistoryMode || !page) return;

    const nonceToHandle = searchHighlightNonce;
    const query = searchHighlightQuery;
    let attempts = 0;
    const tryLocate = () => {
      const editor = editorRef.current?.editor;
      if (editor) {
        locateAndHighlight(editor, query);
        setHandledSearchHighlightNonce(nonceToHandle);
        locateRetryRef.current = null;
        return;
      }
      // 切页后编辑器可能还没挂载/换内容，短轮询等待 ready（上限约 1.5s）
      if (attempts++ < 30) {
        locateRetryRef.current = setTimeout(tryLocate, 50);
      }
    };
    // 首次延一帧，让切页的 replaceBlocks 先把目标页内容铺好
    locateRetryRef.current = setTimeout(tryLocate, 60);

    return () => {
      if (locateRetryRef.current) {
        clearTimeout(locateRetryRef.current);
        locateRetryRef.current = null;
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchHighlightNonce, activePageId, page]);

  return (
    <>
      <div
        className="workspace-shell window-shell-safe-top flex overflow-hidden bg-background text-foreground"
        onDragEnter={onDragEnter}
        onDragOver={onDragOver}
        onDragLeave={onDragLeave}
        onDrop={onDrop}
      >
        {isDragging && (
          <div className="fixed inset-0 z-[25000] flex items-center justify-center bg-[hsl(var(--goose-editor-bg)/0.96)] animate-in fade-in duration-150">
            <div className="flex min-h-[188px] min-w-[312px] flex-col items-center justify-center rounded-[14px] border border-border/70 bg-[hsl(var(--goose-shell-bg)/0.98)] px-10 py-8 text-center shadow-[0_18px_42px_rgba(15,23,42,0.12),0_1px_3px_rgba(15,23,42,0.06)] dark:border-white/10 dark:shadow-[0_18px_42px_rgba(0,0,0,0.32)]">
              {dragIntent === "folder" ? (
                <LucideIcons.FolderOpen className="mb-4 h-12 w-12 text-muted-foreground/80" />
              ) : dragIntent === "text-file" ? (
                <LucideIcons.FileText className="mb-4 h-12 w-12 text-muted-foreground/80" />
              ) : (
                <LucideIcons.FileQuestion className="mb-4 h-12 w-12 text-muted-foreground/70" />
              )}
              <p className="text-base font-medium text-foreground">
                {dragIntent === "folder"
                  ? "松手打开文件夹"
                  : dragIntent === "text-file"
                    ? "松手导入文本文件"
                    : "松手后检查文件"}
              </p>
              <p className="mt-2 text-sm text-muted-foreground">
                {dragIntent === "folder"
                  ? "会作为本地文件夹记事本载入"
                  : "支持 .md、.markdown、.txt"}
              </p>
            </div>
          </div>
        )}
        <CommandPalette />
        <AIFeatureNotice />
        <div className="workspace-stage">
          <Sidebar
            className="workspace-sidebar-pane"
            disableResize={false}
            // 全屏 AI 时取消侧栏高亮：用户再点页面会触发选中并切回该标签
            selectedPageId={showFullscreenAi ? null : activePageId}
            editorRef={editorRef}
            scrollContainerRef={scrollContainerRef}
          />

          <main
            className="workspace-main-sheet relative flex-1 flex flex-col h-full overflow-hidden"
            data-single-tab-mode={singleTabMode ? "true" : undefined}
            data-local-file-page={isLocalFolderPage ? "true" : undefined}
          >
            {/*
              会话运行时与面板 UI 解耦：Provider 在 AI 可用时常驻，
              关面板 / 切页不卸载 useChat，顶栏动画可跟到请求真正结束。
            */}
            {aiAvailableForNotebook && aiNotebookId ? (
              <NotebookAiSessionProvider
                key={aiNotebookId}
                notebookId={aiNotebookId}
                editorRef={editorRef}
              >
                <NotebookAiWorkspaceBody
                  showFullscreenAi={showFullscreenAi}
                  aiNotebookId={aiNotebookId}
                  aiAvailableForNotebook={aiAvailableForNotebook}
                  isWelcomeTab={isWelcomeTab}
                  openWelcomeTabHandler={openWelcomeTabHandler}
                  aiPanelOpen={aiPanelOpen}
                  aiLayoutMode={aiLayoutMode}
                  toggleAiPanel={toggleAiPanel}
                  showSideAiPanel={showSideAiPanel}
                  closeAiPanel={closeAiPanel}
                  editorRef={editorRef}
                  aiPanelCapturedSelection={aiPanelCapturedSelection}
                  consumeAiPanelCapturedSelection={
                    consumeAiPanelCapturedSelection
                  }
                  setAiLayoutMode={setAiLayoutMode}
                  activePageId={activePageId}
                  page={page}
                  inHistoryMode={inHistoryMode}
                  isLocalFolderPage={isLocalFolderPage}
                  scrollContainerRef={scrollContainerRef}
                />
              </NotebookAiSessionProvider>
            ) : (
              <NotebookAiWorkspaceBody
                showFullscreenAi={false}
                aiNotebookId={null}
                aiAvailableForNotebook={false}
                isWelcomeTab={isWelcomeTab}
                openWelcomeTabHandler={openWelcomeTabHandler}
                aiPanelOpen={false}
                aiLayoutMode={aiLayoutMode}
                toggleAiPanel={toggleAiPanel}
                showSideAiPanel={false}
                closeAiPanel={closeAiPanel}
                editorRef={editorRef}
                aiPanelCapturedSelection={null}
                consumeAiPanelCapturedSelection={
                  consumeAiPanelCapturedSelection
                }
                setAiLayoutMode={setAiLayoutMode}
                activePageId={activePageId}
                page={page}
                inHistoryMode={inHistoryMode}
                isLocalFolderPage={isLocalFolderPage}
                scrollContainerRef={scrollContainerRef}
              />
            )}
          </main>
        </div>
      </div>
    </>
  );
}

/** 主内容区 + 条件挂载的 AI 面板 UI（运行时在外层 Provider）。 */
function NotebookAiWorkspaceBody({
  showFullscreenAi,
  aiNotebookId,
  aiAvailableForNotebook,
  isWelcomeTab,
  openWelcomeTabHandler,
  aiPanelOpen,
  aiLayoutMode,
  toggleAiPanel,
  showSideAiPanel,
  closeAiPanel,
  editorRef,
  aiPanelCapturedSelection,
  consumeAiPanelCapturedSelection,
  setAiLayoutMode,
  activePageId,
  page,
  inHistoryMode,
  isLocalFolderPage,
  scrollContainerRef,
}: {
  showFullscreenAi: boolean;
  aiNotebookId: string | null;
  aiAvailableForNotebook: boolean;
  isWelcomeTab: boolean;
  openWelcomeTabHandler: () => void;
  aiPanelOpen: boolean;
  aiLayoutMode: ReturnType<typeof useNotebookAiPanel>["layoutMode"];
  toggleAiPanel: () => void;
  showSideAiPanel: boolean;
  closeAiPanel: () => void;
  editorRef: RefObject<EditorRef | null>;
  aiPanelCapturedSelection: ReturnType<
    typeof useNotebookAiPanel
  >["capturedSelection"];
  consumeAiPanelCapturedSelection: () => void;
  setAiLayoutMode: ReturnType<typeof useNotebookAiPanel>["setLayoutMode"];
  activePageId: string | null | undefined;
  page: ReturnType<typeof usePages.getState>["pages"][string] | undefined;
  inHistoryMode: boolean;
  isLocalFolderPage: boolean;
  scrollContainerRef: RefObject<HTMLDivElement | null>;
}) {
  return (
    <>
            {/*
              全屏 AI 叠在底层内容之上，不再卸载编辑器/欢迎页。
              否则再次开关 AI 时本地文件夹页会短暂落到「有页头标题、正文既非 AI 也非编辑器」的空白态。
            */}
            <div
              className={cn(
                "flex min-h-0 flex-1 flex-col overflow-hidden",
                showFullscreenAi &&
                  aiNotebookId &&
                  aiAvailableForNotebook &&
                  "invisible pointer-events-none",
              )}
              aria-hidden={
                showFullscreenAi && aiNotebookId && aiAvailableForNotebook
                  ? true
                  : undefined
              }
              // React 19 支持 inert，屏蔽底层编辑器抢焦点
              inert={
                showFullscreenAi && aiNotebookId && aiAvailableForNotebook
                  ? true
                  : undefined
              }
            >
              {isWelcomeTab ? (
                <>
                  <PageHeader
                    onOpenSearch={openWelcomeTabHandler}
                    aiPanelOpen={aiAvailableForNotebook && aiPanelOpen}
                    aiLayoutMode={aiLayoutMode}
                    onToggleAiPanel={
                      aiAvailableForNotebook ? toggleAiPanel : undefined
                    }
                  />
                  <div className="relative ml-0 mt-0 flex min-h-0 flex-1 flex-row gap-2 overflow-hidden !bg-[hsl(var(--goose-shell-bg))]">
                    <div className="flex min-w-0 flex-1 flex-col overflow-hidden rounded-[12px] bg-[hsl(var(--goose-editor-bg))]">
                      <PageEmptyState />
                    </div>
                    {showSideAiPanel && aiNotebookId ? (
                      <NotebookAiHostScope notebookId={aiNotebookId}>
                        <NotebookAiPanel
                          key={`welcome-${aiNotebookId}`}
                          notebookId={aiNotebookId}
                          onClose={closeAiPanel}
                          editorRef={editorRef}
                          capturedSelection={aiPanelCapturedSelection}
                          onConsumeCapturedSelection={
                            consumeAiPanelCapturedSelection
                          }
                          layoutMode={aiLayoutMode}
                          onLayoutModeChange={setAiLayoutMode}
                          variant="side-panel"
                        />
                      </NotebookAiHostScope>
                    ) : null}
                  </div>
                </>
              ) : activePageId && page && inHistoryMode ? (
                <>
                  <HistoryToolbar />
                  <div className="workspace-editor-surface relative ml-0 mt-0 flex-1 min-h-0 overflow-hidden">
                    <div
                      className={cn(
                        "h-full overflow-y-auto page-scroll-container bg-[hsl(var(--goose-editor-bg))]",
                      )}
                    >
                      <div className="flex min-h-full flex-col px-14 pt-0">
                        <HistoryReader />
                      </div>
                    </div>
                  </div>
                </>
              ) : activePageId && page ? (
                page.isFolder && isLocalFolderPage ? (
                  /* 本地文件夹目录页：主区渲染 FolderHomePage，不挂编辑器 */
                  <>
                    <div className="workspace-editor-surface relative ml-0 mt-0 flex min-h-0 flex-1 flex-row gap-2 overflow-hidden !bg-[hsl(var(--goose-shell-bg))]">
                      <div className="flex min-w-0 flex-1 flex-col overflow-hidden rounded-[12px] bg-[hsl(var(--goose-editor-bg))]">
                        <PageHeader
                          page={page}
                          onOpenSearch={openWelcomeTabHandler}
                          onRestore={() => restorePageWithToast(activePageId)}
                          onDelete={() =>
                            void permanentlyDeletePageWithCleanup(activePageId)
                          }
                          aiPanelOpen={aiAvailableForNotebook && aiPanelOpen}
                          aiLayoutMode={aiLayoutMode}
                          onToggleAiPanel={
                            aiAvailableForNotebook ? toggleAiPanel : undefined
                          }
                        />
                        <FolderHomePage page={page} />
                      </div>
                      {showSideAiPanel && aiNotebookId ? (
                        <NotebookAiPanel
                          key={`folder-${aiNotebookId}`}
                          notebookId={aiNotebookId}
                          onClose={closeAiPanel}
                          editorRef={editorRef}
                          capturedSelection={aiPanelCapturedSelection}
                          onConsumeCapturedSelection={
                            consumeAiPanelCapturedSelection
                          }
                          layoutMode={aiLayoutMode}
                          onLayoutModeChange={setAiLayoutMode}
                          variant="side-panel"
                        />
                      ) : null}
                    </div>
                  </>
                ) : (
                <>
                  <EditorHostBridge page={page} isEditorFullWidth>
                    <div
                      className="workspace-editor-surface relative ml-0 mt-0 flex min-h-0 flex-1 flex-row gap-2 overflow-hidden !bg-[hsl(var(--goose-shell-bg))]"
                      data-local-file-page={
                        isLocalFolderPage ? "true" : undefined
                      }
                    >
                      <div className="flex min-w-0 flex-1 flex-col overflow-hidden rounded-[12px] bg-[hsl(var(--goose-editor-bg))]">
                        <PageHeader
                          page={page}
                          onOpenSearch={openWelcomeTabHandler}
                          onRestore={() => restorePageWithToast(activePageId)}
                          onDelete={() =>
                            void permanentlyDeletePageWithCleanup(activePageId)
                          }
                          aiPanelOpen={
                            aiAvailableForNotebook && aiPanelOpen
                          }
                          aiLayoutMode={aiLayoutMode}
                          onToggleAiPanel={
                            aiAvailableForNotebook ? toggleAiPanel : undefined
                          }
                        />
                        <div
                          ref={scrollContainerRef}
                          className={cn(
                            "h-full flex-1 min-w-0 overflow-y-auto page-scroll-container bg-[hsl(var(--goose-editor-bg))]",
                          )}
                        >
                          <div className="flex min-h-full flex-col px-14 pt-1">
                            <ErrorBoundary
                              key={activePageId}
                              resetKey={activePageId}
                              fallback={(_, reset) => (
                                <div className="flex min-h-[260px] flex-col items-center justify-center gap-3 text-center text-sm text-muted-foreground">
                                  <p>当前页面渲染失败，已阻止整窗白屏。</p>
                                  <button
                                    type="button"
                                    onClick={reset}
                                    className="rounded-md border border-border bg-background px-3 py-1.5 text-sm text-foreground hover:bg-[var(--goose-interactive-hover)]"
                                  >
                                    重试
                                  </button>
                                </div>
                              )}
                            >
                              <Editor
                                ref={editorRef}
                                editable={!page.isLocked && !page.trashedAt}
                              />
                            </ErrorBoundary>
                          </div>
                        </div>
                      </div>
                      {/* 侧栏并排 AI 面板 */}
                      {showSideAiPanel && aiNotebookId ? (
                        <NotebookAiPanel
                          key={aiNotebookId}
                          notebookId={aiNotebookId}
                          onClose={closeAiPanel}
                          editorRef={editorRef}
                          capturedSelection={aiPanelCapturedSelection}
                          onConsumeCapturedSelection={
                            consumeAiPanelCapturedSelection
                          }
                          layoutMode={aiLayoutMode}
                          onLayoutModeChange={setAiLayoutMode}
                          variant="side-panel"
                        />
                      ) : null}
                    </div>
                  </EditorHostBridge>
                </>
                )
              ) : (
                <PageEmptyState />
              )}
            </div>

            {showFullscreenAi && aiNotebookId && aiAvailableForNotebook ? (
              <div className="absolute inset-0 z-20 flex flex-col overflow-hidden bg-[hsl(var(--goose-editor-bg))]">
                <PageHeader
                  page={page}
                  onOpenSearch={() => {
                    // 全屏会话中新建/搜索标签，先退出 AI 全屏，避免状态叠层
                    closeAiPanel();
                    openWelcomeTabHandler();
                  }}
                  onRestore={
                    activePageId
                      ? () => restorePageWithToast(activePageId)
                      : undefined
                  }
                  onDelete={
                    activePageId
                      ? () =>
                          void permanentlyDeletePageWithCleanup(activePageId)
                      : undefined
                  }
                  aiPanelOpen
                  aiLayoutMode={aiLayoutMode}
                  onToggleAiPanel={toggleAiPanel}
                  onBeforeActivateTab={closeAiPanel}
                />
                <div className="relative flex min-h-0 flex-1 flex-col overflow-hidden bg-[hsl(var(--goose-editor-bg))]">
                  <NotebookAiHostScope notebookId={aiNotebookId}>
                    <NotebookAiPanel
                      key={`fullscreen-${aiNotebookId}`}
                      notebookId={aiNotebookId}
                      onClose={closeAiPanel}
                      editorRef={editorRef}
                      capturedSelection={aiPanelCapturedSelection}
                      onConsumeCapturedSelection={
                        consumeAiPanelCapturedSelection
                      }
                      layoutMode={aiLayoutMode}
                      onLayoutModeChange={setAiLayoutMode}
                      variant="fullscreen"
                    />
                  </NotebookAiHostScope>
                </div>
              </div>
            ) : null}
    </>
  );
}
