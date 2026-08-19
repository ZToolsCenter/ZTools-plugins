/**
 * NotebookAiPanel — AI 聊天面板 UI（侧栏并排 / 全屏）
 *
 * 请求生命周期由 NotebookAiSessionProvider 持有：关面板或切页不会中止流式任务，
 * 顶栏 AI 图标继续反映运行/完成状态。
 */
import {
  useEffect,
  useRef,
  useState,
  useCallback,
  useMemo,
  type KeyboardEvent,
} from "react";
import {
  X,
  Plus,
  CircleAlert,
  MoreHorizontal,
  PanelRight,
  AppWindow,
  History as HistoryIcon,
  Check,
} from "lucide-react";
import type { RefObject } from "react";
import type { EditorRef } from "@/components/editor/core/Editor";
import { useNotebooks } from "@/stores/useNotebooks";
import { usePages } from "@/stores/usePages";
import {
  useNotebookAiChats,
} from "@/stores/useNotebookAiChats";
import { ChatChrome } from "./beautiful-ui/ChatChrome";
import { ChatMessages } from "./ChatMessages";
import { Composer, type ComposerHandle } from "./Composer";
import {
  usePanelWidth,
  PANEL_WIDTH_MIN,
  PANEL_WIDTH_MAX,
} from "./usePanelWidth";
import { ConversationHistoryList } from "./ConversationHistoryPopover";
import type {
  NotebookAiLayoutMode,
  NotebookAiPanelSelectionCapture,
} from "./useNotebookAiPanel";
import { isFullscreenAiLayout } from "./useNotebookAiPanel";
import { clearAiHeaderActions, setAiHeaderActions } from "./aiHeaderSlot";
import type { AiComposerPayload } from "@/components/editor/ai/composer/referenceLookup";
import { buildAiFileReferenceAttrs } from "@/components/editor/ai/composer/referenceLookup";
import {
  formatNotebookAiChatError,
  NOTEBOOK_AI_PLACEHOLDER_HINTS,
  useNotebookAiSession,
} from "./NotebookAiSession";
import type { NotebookAiImageAttachment } from "./Composer";
import { getCurrentNotebookAiPageId } from "@/lib/notebook-ai/context";
import { cn } from "@/lib/utils";
import { shouldSeedCurrentPageReference } from "./defaultComposerReference";
import {
  clearAiPanelSurface,
  dismissAiFloatingLayers,
  setAiPanelSurface,
} from "./aiPanelSurface";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

interface NotebookAiPanelProps {
  notebookId: string;
  onClose: () => void;
  editorRef?: RefObject<EditorRef | null>;
  capturedSelection?: NotebookAiPanelSelectionCapture | null;
  onConsumeCapturedSelection?: () => void;
  /** 打开方式：侧栏并排 / 全屏 */
  layoutMode?: NotebookAiLayoutMode;
  onLayoutModeChange?: (mode: NotebookAiLayoutMode) => void;
  /** 侧栏可拖宽；全屏铺满主区域 */
  variant?: "side-panel" | "fullscreen";
}

export function NotebookAiPanel({
  notebookId,
  onClose,
  editorRef: _editorRef,
  capturedSelection,
  onConsumeCapturedSelection,
  layoutMode = "side-panel",
  onLayoutModeChange,
  variant = "side-panel",
}: NotebookAiPanelProps) {
  // editorRef 由 SessionProvider 持有，面板侧仅保留 prop 兼容调用方签名
  void _editorRef;
  const isFullscreen = variant === "fullscreen";
  const layoutIsFullscreen = isFullscreenAiLayout(layoutMode);

  const { width, onDragHandleMouseDown } = usePanelWidth();
  const panelRootRef = useRef<HTMLDivElement | null>(null);
  // 展示宽度：随父级 flex 行可用空间收缩，避免 minWidth=stored 把面板裁出视口
  const [effectiveWidth, setEffectiveWidth] = useState(width);
  const composerRef = useRef<ComposerHandle | null>(null);

  // 面板挂载=AI 任务面；卸载/切走时清 body 标记并收起残留浮层
  useEffect(() => {
    setAiPanelSurface({ active: true, fullscreen: isFullscreen });
    return () => {
      const root = panelRootRef.current;
      clearAiPanelSurface();
      dismissAiFloatingLayers(root);
    };
  }, [isFullscreen]);

  // 侧栏：观察父级（.workspace-editor-surface）宽度，计算不挤爆编辑区的 effectiveWidth
  useEffect(() => {
    if (isFullscreen) return;
    const root = panelRootRef.current;
    const parent = root?.parentElement;
    if (!parent) return;

    const EDITOR_MIN = 200;
    const GAP = 8;

    const recompute = () => {
      const parentW = parent.clientWidth;
      const room = parentW - EDITOR_MIN - GAP;
      // room 足够时：不超过 stored / MAX，且留给编辑区至少 EDITOR_MIN
      // 极窄时（如 uTools 窄窗口）：适应可用 room 宽度（至少 200px），避免挤爆或超出父级视口
      const availableRoom = Math.max(200, room > 0 ? room : parentW);
      const next = Math.min(width, Math.min(PANEL_WIDTH_MAX, availableRoom));
      setEffectiveWidth(next);
    };

    recompute();
    const ro = new ResizeObserver(recompute);
    ro.observe(parent);
    return () => ro.disconnect();
  }, [isFullscreen, width]);
  // 页面数据可能晚于面板挂载完成；订阅活动页和页面表，确保空会话仍能补上当前笔记。
  const activePageId = usePages((state) => state.activePageId);
  const pages = usePages((state) => state.pages);
  const notebooks = useNotebooks((state) => state.notebooks);

  const {
    messages,
    error,
    clearError,
    isBusy,
    isStreaming,
    unavailableReason,
    placeholderIndex,
    composerRevision,
    send,
    newConversation,
    selectConversation,
    deleteConversation,
    searchPages,
    onBatchApproval,
    onBatchUndo,
  } = useNotebookAiSession();

  // 初次打开和新建会话时锁定当时的当前页，作为可见、可移除的默认上下文。
  // 若已有持久化草稿，不再强插默认引用，避免覆盖用户未发送内容。
  const currentPageId =
    getCurrentNotebookAiPageId(notebookId) ??
    (activePageId && pages[activePageId]?.workspaceId === notebookId
      ? activePageId
      : null);
  const initialReference = useMemo(() => {
    const page = currentPageId ? pages[currentPageId] : undefined;
    return page ? buildAiFileReferenceAttrs(page, notebooks) : null;
  }, [currentPageId, notebooks, pages]);

  // Composer 挂载（或 key 重挂载）后：仅空会话且无草稿时植入当前页引用 chip。
  // 已有消息的会话即使输入框为空，也不能被自动修改。
  useEffect(() => {
    if (!initialReference) return;
    const draft = useNotebookAiChats.getState().getComposerDraft(notebookId);
    if (!shouldSeedCurrentPageReference(messages.length, draft)) return;
    const timer = setTimeout(() => {
      composerRef.current?.insertReference(initialReference);
    }, 0);
    return () => clearTimeout(timer);
  }, [initialReference, messages.length, composerRevision, notebookId]);

  // 面板打开即聚焦输入框；已打开时重复触发「打开」走 goose-note:focus-ai-composer
  useEffect(() => {
    if (unavailableReason) return;
    const focusComposer = () => composerRef.current?.focus();
    const timer = window.setTimeout(focusComposer, 50);
    window.addEventListener("goose-note:focus-ai-composer", focusComposer);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener("goose-note:focus-ai-composer", focusComposer);
    };
  }, [unavailableReason]);

  const handlePanelKeyDown = useCallback(
    (event: KeyboardEvent<HTMLDivElement>) => {
      if (event.key !== "Escape" || event.defaultPrevented) return;
      event.stopPropagation();
      onClose();
    },
    [onClose],
  );

  const composerPlaceholder = unavailableReason
    ? "请先在设置中配置 AI 模型"
    : isBusy
      ? "正在生成结果…"
      : NOTEBOOK_AI_PLACEHOLDER_HINTS[placeholderIndex];

  const handleSend = useCallback(
    (
      payload: AiComposerPayload,
      imageAttachments: NotebookAiImageAttachment[],
    ) => {
      return send(payload, imageAttachments, {
        capturedSelection,
        onConsumeCapturedSelection,
      });
    },
    [send, capturedSelection, onConsumeCapturedSelection],
  );

  const handleNewConversation = useCallback(() => {
    newConversation({ onConsumeCapturedSelection });
  }, [newConversation, onConsumeCapturedSelection]);

  const handleSelectConversation = useCallback(
    (nextConversationId: string) => {
      selectConversation(nextConversationId, { onConsumeCapturedSelection });
    },
    [selectConversation, onConsumeCapturedSelection],
  );

  const handleDeleteConversation = useCallback(
    (targetConversationId: string) => {
      deleteConversation(targetConversationId);
    },
    [deleteConversation],
  );

  const streamingMessageId =
    isStreaming && messages.length > 0
      ? messages[messages.length - 1].id
      : undefined;

  // 会话标题只在历史列表展示；全屏时工具栏上移到 PageHeader 右上角（顶替 PageMenu）
  const headerToolbar = useMemo(() => {
    const iconBtn =
      "flex h-7 w-7 items-center justify-center rounded-[7px] text-muted-foreground transition-colors hover:bg-[var(--goose-icon-chip-on-selected)] hover:text-foreground dark:hover:bg-[var(--goose-interactive-hover)] disabled:pointer-events-none disabled:opacity-50";
    return (
      <div
        className="flex items-center gap-0.5"
        role="toolbar"
        aria-label="AI 工具栏"
      >
        <button
          type="button"
          onClick={handleNewConversation}
          className={iconBtn}
          aria-label="新建会话"
          title="新建会话"
          disabled={isBusy}
        >
          <Plus className="h-3.5 w-3.5" strokeWidth={1.75} />
        </button>

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              className={iconBtn}
              aria-label="更多选项"
              title="更多"
            >
              <MoreHorizontal className="h-4 w-4" strokeWidth={1.75} />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" sideOffset={6} className="w-56">
            <DropdownMenuSub>
              <DropdownMenuSubTrigger>
                <HistoryIcon className="h-4 w-4" strokeWidth={1.75} />
                <span>历史会话</span>
              </DropdownMenuSubTrigger>
              <DropdownMenuSubContent className="w-72 max-w-72 overflow-hidden p-0">
                <ConversationHistoryList
                  notebookId={notebookId}
                  onSelectConversation={handleSelectConversation}
                  onDeleteConversation={handleDeleteConversation}
                />
              </DropdownMenuSubContent>
            </DropdownMenuSub>

            {onLayoutModeChange ? (
              <>
                <DropdownMenuSeparator />
                <DropdownMenuLabel>打开方式</DropdownMenuLabel>
                <DropdownMenuItem
                  onSelect={() => onLayoutModeChange("side-panel")}
                  className="gap-2"
                >
                  <PanelRight className="h-4 w-4" strokeWidth={1.75} />
                  <span className="flex-1">侧栏并排</span>
                  {!layoutIsFullscreen ? (
                    <Check className="h-3.5 w-3.5" strokeWidth={2} />
                  ) : null}
                </DropdownMenuItem>
                <DropdownMenuItem
                  onSelect={() => onLayoutModeChange("fullscreen")}
                  className="gap-2"
                >
                  <AppWindow className="h-4 w-4" strokeWidth={1.75} />
                  <span className="flex-1">全屏</span>
                  {layoutIsFullscreen ? (
                    <Check className="h-3.5 w-3.5" strokeWidth={2} />
                  ) : null}
                </DropdownMenuItem>
              </>
            ) : null}
          </DropdownMenuContent>
        </DropdownMenu>

        <button
          type="button"
          onClick={onClose}
          className={iconBtn}
          aria-label="关闭 AI"
          title="关闭 AI"
        >
          <X className="h-4 w-4" strokeWidth={1.75} />
        </button>
      </div>
    );
  }, [
    onClose,
    handleNewConversation,
    isBusy,
    notebookId,
    handleSelectConversation,
    handleDeleteConversation,
    onLayoutModeChange,
    layoutIsFullscreen,
  ]);

  // 全屏：工具栏挂到标签栏右上角；侧栏并排：仍在面板内右上角
  useEffect(() => {
    if (!isFullscreen) {
      clearAiHeaderActions();
      return;
    }
    setAiHeaderActions(headerToolbar);
    return () => {
      clearAiHeaderActions();
    };
  }, [isFullscreen, headerToolbar]);

  return (
    <ChatChrome
      ref={panelRootRef}
      onKeyDown={handlePanelKeyDown}
      className={cn(
        "relative flex h-full flex-col overflow-hidden bg-[hsl(var(--goose-editor-bg))]",
        // 侧栏：shrink-0 保持并排卡片；宽度用 effectiveWidth（可随父级变窄），勿写死 minWidth:stored
        isFullscreen
          ? "min-w-0 w-full flex-1 rounded-none"
          : "z-[50] shrink-0 rounded-[12px]",
      )}
      style={
        isFullscreen
          ? undefined
          : { width: effectiveWidth, maxWidth: "100%" }
      }
    >
      {!isFullscreen ? (
        <div
          className="absolute left-0 top-0 z-10 h-full w-1 cursor-col-resize transition-colors hover:bg-[var(--goose-interactive-hover)]"
          onMouseDown={onDragHandleMouseDown}
          aria-hidden="true"
        />
      ) : null}

      {!isFullscreen ? (
        <div className="flex h-12 shrink-0 items-center justify-end gap-1 px-2.5">
          {headerToolbar}
        </div>
      ) : null}

      {unavailableReason ? (
        <div className="flex flex-1 items-center justify-center px-6">
          <div className="flex max-w-[260px] flex-col items-center gap-3 text-center">
            <div className="flex h-10 w-10 items-center justify-center rounded-[10px] bg-[var(--goose-interactive-hover)] text-muted-foreground">
              <CircleAlert className="h-5 w-5" strokeWidth={1.75} />
            </div>
            <p className="text-sm font-medium text-foreground">AI 暂不可用</p>
            <p className="text-xs leading-relaxed text-muted-foreground">
              {unavailableReason}
            </p>
          </div>
        </div>
      ) : (
        <ChatMessages
          messages={messages}
          streamingMessageId={streamingMessageId}
          editorRef={_editorRef}
          layout={isFullscreen ? "fullscreen" : "side-panel"}
          onBatchApproval={onBatchApproval}
          onBatchUndo={onBatchUndo}
        />
      )}

      {error ? (
        <div className={cn("mb-2 w-full", isFullscreen ? "px-6" : "px-3")}>
          <div
            className={cn(
              "flex items-start gap-2 rounded-[10px] border border-[var(--goose-color-danger-focus)] bg-[var(--goose-color-danger-subtle-bg)] px-3 py-2.5 text-xs",
              isFullscreen && "mx-auto max-w-[720px]",
            )}
            role="alert"
          >
            <CircleAlert
              className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[var(--goose-color-danger-focus)]"
              strokeWidth={1.75}
            />
            <div className="min-w-0 flex-1">
              <div className="font-medium text-[var(--goose-color-danger-focus)]">
                本轮失败原因
              </div>
              <div className="mt-0.5 break-words leading-relaxed text-foreground">
                {formatNotebookAiChatError(error)}
              </div>
            </div>
            <button
              type="button"
              onClick={() => clearError()}
              className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-[5px] text-[var(--goose-color-danger-focus)] outline-none transition-colors hover:bg-[var(--goose-color-danger-subtle-bg)]"
              aria-label="关闭错误提示"
            >
              <X className="h-3.5 w-3.5" strokeWidth={1.75} />
            </button>
          </div>
        </div>
      ) : null}

      <Composer
        ref={composerRef}
        key={`${notebookId}-${composerRevision}`}
        notebookId={notebookId}
        onSend={handleSend}
        isStreaming={isBusy}
        disabled={!!unavailableReason}
        placeholder={composerPlaceholder}
        searchPages={searchPages}
        onEscape={onClose}
        layout={isFullscreen ? "fullscreen" : "side-panel"}
      />
    </ChatChrome>
  );
}
