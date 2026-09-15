import { useMemo, useState } from "react";
import {
  Archive,
  ChevronRight,
  ChevronsDownUp,
  Folder,
  FolderOpen,
  FolderPlus,
  MessageSquare,
  MessageSquarePlus,
  MoreHorizontal,
  Plus,
  RotateCcw,
  Timer,
  Trash2,
} from "lucide-react";
import { toast } from "@/lib/toast";
import { buiSidebarLoader } from "@/components/agent/aiMotionPresets";
import { LoadingState } from "@/components/agent/beautiful-ui/LoadingState";
import { Dropdown } from "@/lib/heroui";
import { cn } from "@/lib/utils";
import {
  getConversationSummary,
  isConversationArchived,
  useAgentChats,
  type AgentConversation,
} from "@/stores/useAgentChats";
import { useSessionRuns } from "@/stores/useSessionRuns";
import { useWorkspaces } from "@/stores/useWorkspaces";

interface WorkspaceSidebarProps {
  /** 打开定时任务全页（ADR 0017） */
  onOpenAutomations?: () => void;
}

/**
 * 左栏：工作区树 + 多展开会话子菜单（ADR 0014 / 0015）。
 * 可拖宽由 WorkbenchShell 的 ResizablePanel 负责；本组件 w-full。
 */
export function WorkspaceSidebar({
  onOpenAutomations,
}: WorkspaceSidebarProps = {}) {
  const workspaces = useWorkspaces((s) => s.workspaces);
  const activeWsId = useWorkspaces((s) => s.activeId);
  const expandedIds = useWorkspaces((s) => s.expandedIds);
  const setActiveWs = useWorkspaces((s) => s.setActive);
  const toggleExpanded = useWorkspaces((s) => s.toggleExpanded);
  const collapseAll = useWorkspaces((s) => s.collapseAll);
  const addFromPicker = useWorkspaces((s) => s.addFromPicker);
  const removeWs = useWorkspaces((s) => s.remove);

  const conversationsMap = useAgentChats((s) => s.conversations);
  const activeConvId = useAgentChats((s) => s.activeConversationId);
  /** 订阅 runs 表，会话行运行态 orb 随 start/end 重渲染 */
  const sessionRuns = useSessionRuns((s) => s.runs);

  const [archivedOpenIds, setArchivedOpenIds] = useState<Set<string>>(
    () => new Set(),
  );
  /** 快速对话折叠：默认展开；chevron 可手动收起；选中/新建/恢复时强制展开 */
  const [quickChatExpanded, setQuickChatExpanded] = useState(true);

  const unmountedSessions = useMemo(
    () =>
      Object.values(conversationsMap)
        .filter(
          (c) =>
            (c.workspaceId ?? null) === null &&
            c.messages.length > 0 &&
            !isConversationArchived(c),
        )
        .sort((a, b) => b.updatedAt - a.updatedAt),
    [conversationsMap],
  );

  const unmountedArchived = useMemo(
    () =>
      Object.values(conversationsMap)
        .filter(
          (c) =>
            (c.workspaceId ?? null) === null &&
            c.messages.length > 0 &&
            isConversationArchived(c),
        )
        .sort((a, b) => (b.archivedAt ?? 0) - (a.archivedAt ?? 0)),
    [conversationsMap],
  );

  const sessionsByWorkspace = useMemo(() => {
    const map = new Map<string, AgentConversation[]>();
    for (const ws of workspaces) {
      map.set(
        ws.id,
        Object.values(conversationsMap)
          .filter(
            (c) =>
              (c.workspaceId ?? null) === ws.id &&
              c.messages.length > 0 &&
              !isConversationArchived(c),
          )
          .sort((a, b) => b.updatedAt - a.updatedAt),
      );
    }
    return map;
  }, [conversationsMap, workspaces]);

  const archivedByWorkspace = useMemo(() => {
    const map = new Map<string, AgentConversation[]>();
    for (const ws of workspaces) {
      map.set(
        ws.id,
        useAgentChats.getState().listArchivedConversations(ws.id),
      );
    }
    return map;
  }, [conversationsMap, workspaces]);

  const handleAddFolder = async () => {
    try {
      const item = await addFromPicker();
      if (!item) return;
      useAgentChats.getState().ensureConversationForWorkspace(item.id);
      toast.success(`已添加：${item.name}`);
    } catch (err) {
      console.error("[workspace] addFromPicker failed:", err);
      toast.error("选择文件夹失败");
    }
  };

  const handleRemoveWs = (id: string, name: string) => {
    removeWs(id);
    const nextId = useWorkspaces.getState().activeId;
    useAgentChats.getState().ensureConversationForWorkspace(nextId);
    toast.success(`已移除：${name}`);
  };

  const handleSelectWorkspace = (id: string) => {
    setActiveWs(id);
    useAgentChats.getState().ensureConversationForWorkspace(id);
  };

  const handleNewSession = (workspaceId: string | null) => {
    if (workspaceId) setActiveWs(workspaceId);
    else setActiveWs(null);
    useAgentChats.getState().createConversation({ workspaceId });
  };

  const handleSelectSession = (
    conversationId: string,
    workspaceId: string | null,
  ) => {
    if (workspaceId) setActiveWs(workspaceId);
    else setActiveWs(null);
    useAgentChats.getState().setActiveConversation(conversationId);
  };

  const handleArchiveSession = (conversationId: string) => {
    useAgentChats.getState().archiveConversation(conversationId);
    toast.success("已归档");
  };

  const handleRestoreSession = (conversationId: string) => {
    // restoreConversation 清 archivedAt 并设 active；再显式 set 一次保证聚焦
    useAgentChats.getState().restoreConversation(conversationId);
    useAgentChats.getState().setActiveConversation(conversationId);
    const conv = useAgentChats.getState().conversations[conversationId];
    const wsId = conv?.workspaceId ?? null;
    if (wsId) setActiveWs(wsId);
    else setActiveWs(null);
    // 快速对话（null）时确保 dock 展开
    if (!wsId) setQuickChatExpanded(true);
    toast.success("已恢复");
  };

  const handleDeleteSession = (conversationId: string) => {
    if (!window.confirm("永久删除该会话？此操作不可恢复。")) return;
    useAgentChats.getState().deleteConversation(conversationId);
    toast.success("已永久删除");
  };

  const toggleArchivedSection = (key: string) => {
    setArchivedOpenIds((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const count = workspaces.length;
  const isExpanded = (id: string) => expandedIds.includes(id);
  const quickChatActive = !activeWsId;
  /** 展开由 quickChatExpanded 控制（初始 true）；选中/新建/恢复时强制 true；chevron 可折叠 */
  const showQuickSessions = quickChatExpanded;

  const selectQuickChat = () => {
    setActiveWs(null);
    setQuickChatExpanded(true);
    useAgentChats.getState().ensureConversationForWorkspace(null);
  };

  const newQuickSession = () => {
    setActiveWs(null);
    setQuickChatExpanded(true);
    handleNewSession(null);
  };

  return (
    <aside
      data-tour="workspace"
      className="flex h-full w-full min-w-0 flex-col bg-bg"
      aria-label="工作区"
    >
      {/* 标题行操作：默认隐藏，hover / 焦点 / 无悬停设备时显示 */}
      <div className="group/hdr flex h-11 shrink-0 items-center justify-between gap-2 px-2.5">
        <div className="min-w-0 pl-0.5">
          <span className="block truncate text-[13px] font-semibold tracking-tight text-fg">
            工作区
          </span>
        </div>
        <div
          className={cn(
            "flex shrink-0 items-center gap-0.5",
            "opacity-0 transition-opacity duration-150",
            "[transition-timing-function:cubic-bezier(0.23,1,0.32,1)]",
            "group-hover/hdr:opacity-100 focus-within:opacity-100",
            "[@media(hover:none)]:opacity-100",
          )}
        >
          {count > 0 ? (
            <button
              type="button"
              onClick={() => collapseAll()}
              className="icon-control inline-flex size-7 items-center justify-center rounded-md text-fg-muted"
              title="收起全部"
              aria-label="收起全部"
            >
              <ChevronsDownUp size={16} strokeWidth={1.75} />
            </button>
          ) : null}
          <button
            type="button"
            onClick={() => {
              if (onOpenAutomations) onOpenAutomations();
              else {
                window.dispatchEvent(
                  new CustomEvent("goose-agent:open-automations"),
                );
              }
            }}
            className="icon-control inline-flex size-7 items-center justify-center rounded-md text-fg-muted"
            title="定时任务"
            aria-label="定时任务"
            data-tour="automations"
          >
            <Timer size={16} strokeWidth={1.75} />
          </button>
          <button
            type="button"
            onClick={() => void handleAddFolder()}
            className="icon-control inline-flex size-7 items-center justify-center rounded-md text-fg-muted"
            title="添加文件夹"
            aria-label="添加文件夹"
          >
            <FolderPlus size={16} strokeWidth={1.75} />
          </button>
        </div>
      </div>

      {/* 滚动区：仅工作区列表 / 空文件夹 CTA；会话在底部「快速对话」dock */}
      <div className="min-h-0 flex-1 overflow-y-auto p-1.5">
        {count === 0 ? (
          <div className="agent-panel-enter flex flex-col items-stretch gap-2.5 rounded-panel bg-surface px-2.5 py-3.5">
            <div
              className="mx-auto flex size-9 items-center justify-center rounded-[10px] bg-accent-subtle text-fg-muted transition-transform duration-150 hover:scale-105"
              aria-hidden
            >
              <Folder size={18} strokeWidth={1.5} className="agent-icon-pop" />
            </div>
            <div className="space-y-1 text-center">
              <p className="text-[12.5px] font-medium text-fg">
                添加本地文件夹
              </p>
              <p className="text-[11px] leading-snug text-fg-faint">
                用于读写文件；可不加直接对话
              </p>
            </div>
            <button
              type="button"
              onClick={() => void handleAddFolder()}
              className={cn(
                "inline-flex h-8 items-center justify-center gap-1.5 rounded-lg",
                "bg-accent px-2.5 text-[12.5px] font-medium text-accent-fg",
                "hover:bg-accent-hover active:bg-accent-active",
                "transition-colors duration-150",
              )}
            >
              <FolderPlus size={14} strokeWidth={1.75} />
              选择文件夹
            </button>
          </div>
        ) : (
          <ul className="flex flex-col gap-0" role="list">
            {workspaces.map((ws) => {
              const active = ws.id === activeWsId;
              const expanded = isExpanded(ws.id);
              const Icon = active || expanded ? FolderOpen : Folder;
              const sessions = sessionsByWorkspace.get(ws.id) ?? [];
              const archived = archivedByWorkspace.get(ws.id) ?? [];
              return (
                <li key={ws.id} className="group/ws">
                  <div className="group/row relative">
                    <div
                      className={cn(
                        "relative flex w-full items-center gap-0.5 rounded-lg py-2 pl-1 pr-1",
                        "text-[12.5px] transition-colors duration-150",
                        active
                          ? "bg-accent-subtle text-fg"
                          : "text-fg-muted hover:bg-surface-hover hover:text-fg",
                      )}
                    >
                      <button
                        type="button"
                        onClick={() => toggleExpanded(ws.id)}
                        className="inline-flex shrink-0 items-center justify-center rounded-sm p-0.5 hover:bg-surface-active"
                        aria-label={expanded ? "折叠" : "展开"}
                        aria-expanded={expanded}
                      >
                        <ChevronRight
                          size={12}
                          strokeWidth={2}
                          className={cn(
                            "text-fg-faint transition-transform duration-150",
                            expanded && "rotate-90",
                          )}
                          aria-hidden
                        />
                      </button>
                      <button
                        type="button"
                        onClick={() => handleSelectWorkspace(ws.id)}
                        className="flex min-w-0 flex-1 items-center gap-1 text-left"
                        title={ws.path}
                      >
                        <Icon
                          size={14}
                          strokeWidth={1.75}
                          className={cn(
                            "shrink-0",
                            active
                              ? "text-fg"
                              : "text-fg-faint group-hover/row:text-fg-muted",
                          )}
                        />
                        <span className="min-w-0 flex-1 truncate font-medium">
                          {ws.name}
                        </span>
                      </button>
                      {/* 行操作：默认隐藏，hover / 焦点 / 无悬停设备时显示 */}
                      <div
                        className={cn(
                          "flex shrink-0 items-center gap-0",
                          "opacity-0 transition-opacity duration-150",
                          "[transition-timing-function:cubic-bezier(0.23,1,0.32,1)]",
                          "group-hover/row:opacity-100 focus-within:opacity-100",
                          "[@media(hover:none)]:opacity-100",
                        )}
                      >
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            if (!expanded) toggleExpanded(ws.id);
                            handleNewSession(ws.id);
                          }}
                          className={cn(
                            "icon-control inline-flex size-6 shrink-0 items-center justify-center rounded-md",
                            "text-fg-faint hover:bg-surface-active hover:text-fg",
                          )}
                          title="新会话"
                          aria-label={`在 ${ws.name} 新建会话`}
                        >
                          <Plus size={14} strokeWidth={1.75} />
                        </button>
                        <Dropdown>
                          <Dropdown.Trigger
                            aria-label={`${ws.name} 更多操作`}
                            className={cn(
                              "inline-flex size-6 shrink-0 items-center justify-center rounded-md",
                              "text-fg-faint hover:bg-surface-active hover:text-fg",
                              "data-[pressed=true]:bg-surface-active",
                            )}
                          >
                            <MoreHorizontal size={14} strokeWidth={1.75} />
                          </Dropdown.Trigger>
                          <Dropdown.Popover
                            placement="bottom end"
                            className="min-w-[148px] p-1.5"
                          >
                            <Dropdown.Menu
                              aria-label={`${ws.name} 操作`}
                              onAction={(key) => {
                                if (key === "remove") {
                                  handleRemoveWs(ws.id, ws.name);
                                }
                              }}
                            >
                              <Dropdown.Item
                                id="remove"
                                textValue="移除工作区"
                                className="cursor-pointer gap-2 rounded-md px-2 py-1.5 text-[12.5px]"
                              >
                                <Trash2
                                  size={13}
                                  strokeWidth={1.75}
                                  className="shrink-0 text-fg-muted"
                                />
                                <span className="text-fg">移除工作区</span>
                              </Dropdown.Item>
                            </Dropdown.Menu>
                          </Dropdown.Popover>
                        </Dropdown>
                      </div>
                    </div>
                  </div>

                  {expanded ? (
                    <SessionGroup
                      nested
                      showNew={false}
                      sessions={sessions}
                      archived={archived}
                      archivedOpen={archivedOpenIds.has(ws.id)}
                      onToggleArchived={() => toggleArchivedSection(ws.id)}
                      activeConvId={activeConvId}
                      sessionRuns={sessionRuns}
                      onNew={() => handleNewSession(ws.id)}
                      onSelect={(id) => handleSelectSession(id, ws.id)}
                      onArchive={handleArchiveSession}
                      onRestore={handleRestoreSession}
                      onDelete={handleDeleteSession}
                    />
                  ) : null}
                </li>
              );
            })}
          </ul>
        )}
      </div>

      {/* 底部固定：快速对话（workspaceId === null），始终可见；列表可滚、header 不挤 */}
      <div
        className="flex min-h-0 max-h-[min(45%,280px)] shrink-0 flex-col border-t border-border-soft p-1.5"
        data-slot="quick-chat-dock"
      >
        <div
          className={cn(
            "group/row flex w-full shrink-0 items-center gap-0.5 rounded-lg px-1 py-2 text-[12.5px]",
            quickChatActive
              ? "bg-accent-subtle text-fg"
              : "text-fg-muted hover:bg-surface-hover hover:text-fg",
          )}
        >
          <button
            type="button"
            onClick={() => setQuickChatExpanded((v) => !v)}
            className="inline-flex shrink-0 items-center justify-center rounded-sm p-0.5 hover:bg-surface-active"
            aria-label={showQuickSessions ? "折叠" : "展开"}
            aria-expanded={showQuickSessions}
          >
            <ChevronRight
              size={12}
              strokeWidth={2}
              className={cn(
                "text-fg-faint transition-transform duration-150",
                showQuickSessions && "rotate-90",
              )}
              aria-hidden
            />
          </button>
          <button
            type="button"
            onClick={selectQuickChat}
            className="flex min-w-0 flex-1 items-center gap-1 text-left"
            title="快速对话"
            aria-label="快速对话"
          >
            <MessageSquare
              size={14}
              strokeWidth={1.75}
              className={cn(
                "shrink-0",
                quickChatActive
                  ? "text-fg"
                  : "text-fg-faint group-hover/row:text-fg-muted",
              )}
            />
            <span className="min-w-0 flex-1 truncate font-medium">
              快速对话
            </span>
          </button>
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              newQuickSession();
            }}
            className={cn(
              "icon-control inline-flex size-6 shrink-0 items-center justify-center rounded-md",
              "text-fg-faint hover:bg-surface-active hover:text-fg",
              "opacity-0 transition-opacity duration-150",
              "[transition-timing-function:cubic-bezier(0.23,1,0.32,1)]",
              "group-hover/row:opacity-100 focus-visible:opacity-100",
              "[@media(hover:none)]:opacity-100",
            )}
            title="新会话"
            aria-label="在快速对话新建会话"
          >
            <Plus size={14} strokeWidth={1.75} />
          </button>
        </div>
        {showQuickSessions ? (
          <div className="min-h-0 overflow-y-auto">
            <SessionGroup
              nested
              showNew={false}
              sessions={unmountedSessions}
              archived={unmountedArchived}
              archivedOpen={archivedOpenIds.has("unmounted")}
              onToggleArchived={() => toggleArchivedSection("unmounted")}
              activeConvId={activeConvId}
              sessionRuns={sessionRuns}
              onNew={() => handleNewSession(null)}
              onSelect={(id) => handleSelectSession(id, null)}
              onArchive={handleArchiveSession}
              onRestore={handleRestoreSession}
              onDelete={handleDeleteSession}
            />
          </div>
        ) : null}
      </div>
    </aside>
  );
}

function SessionGroup({
  title,
  nested,
  expanded = true,
  /** 工作区 / 快速对话行已有「+」时置 false，隐藏嵌套「新会话」行 */
  showNew = true,
  sessions,
  archived = [],
  archivedOpen = false,
  onToggleArchived,
  activeConvId,
  sessionRuns,
  onNew,
  onSelect,
  onArchive,
  onRestore,
  onDelete,
}: {
  title?: string;
  nested?: boolean;
  expanded?: boolean;
  showNew?: boolean;
  sessions: AgentConversation[];
  archived?: AgentConversation[];
  archivedOpen?: boolean;
  onToggleArchived?: () => void;
  activeConvId: string | null;
  sessionRuns: Record<string, unknown>;
  onNew: () => void;
  onSelect: (id: string) => void;
  onArchive: (id: string) => void;
  onRestore: (id: string) => void;
  onDelete?: (id: string) => void;
}) {
  if (!expanded) return null;

  return (
    <div
      className={cn(
        /* nested 仅在 expanded 时挂载，折叠无 margin 残留 */
        "flex flex-col gap-0.5",
        nested ? "mt-0.5 mb-1 ml-3 pl-2" : "mt-1",
      )}
    >
      {title ? (
        <div className="flex items-center justify-between px-1.5 pt-0.5">
          <span className="text-[10.5px] font-medium text-fg-faint">
            {title}
          </span>
        </div>
      ) : null}

      {showNew ? (
        <button
          type="button"
          onClick={onNew}
          className={cn(
            "inline-flex h-7 w-full items-center gap-1.5 rounded-md px-2",
            "text-[11.5px] font-medium text-fg-muted",
            "hover:bg-surface-hover hover:text-fg",
            "transition-colors duration-150",
          )}
        >
          <MessageSquarePlus size={13} strokeWidth={1.75} />
          新会话
        </button>
      ) : null}

      {sessions.length > 0 ? (
        <ul className="flex flex-col gap-0.5" role="list">
          {sessions.map((conv) => {
            const active = conv.id === activeConvId;
            const summary = getConversationSummary(conv);
            const running = Boolean(sessionRuns[conv.id]);
            return (
              <li key={conv.id} className="group/sess relative">
                <button
                  type="button"
                  onClick={() => onSelect(conv.id)}
                  className={cn(
                    "flex h-7 w-full items-center gap-1.5 rounded-md pl-2 pr-7 text-left",
                    "text-[11.5px] transition-colors duration-150",
                    active
                      ? "bg-accent-subtle text-fg"
                      : "text-fg-muted hover:bg-surface-hover hover:text-fg",
                  )}
                  title={summary}
                >
                  <MessageSquare
                    size={12}
                    strokeWidth={1.75}
                    className={cn(
                      "shrink-0",
                      active ? "text-fg" : "text-fg-faint",
                    )}
                  />
                  <span className="min-w-0 flex-1 truncate font-medium">
                    {summary}
                  </span>
                </button>
                {running ? (
                  <span
                    className="absolute right-1 top-1/2 z-[1] flex -translate-y-1/2 items-center justify-center"
                    aria-label="运行中"
                  >
                    <LoadingState
                      variant={buiSidebarLoader.variant}
                      size={buiSidebarLoader.size}
                      showElapsed={false}
                      label={undefined}
                      className="pointer-events-none"
                    />
                  </span>
                ) : (
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      onArchive(conv.id);
                    }}
                    className={cn(
                      "absolute right-0.5 top-1/2 z-[1] flex size-6 -translate-y-1/2 items-center justify-center rounded-md",
                      "text-fg-faint opacity-0 transition-opacity duration-150",
                      "[transition-timing-function:cubic-bezier(0.23,1,0.32,1)]",
                      "hover:bg-surface-active hover:text-fg",
                      "group-hover/sess:opacity-100 focus-visible:opacity-100",
                      "[@media(hover:none)]:opacity-100",
                    )}
                    title="归档"
                    aria-label="归档"
                  >
                    <Archive size={12} strokeWidth={1.75} />
                  </button>
                )}
              </li>
            );
          })}
        </ul>
      ) : null}

      {archived.length > 0 && onToggleArchived ? (
        <div className="mt-0.5 flex flex-col gap-0.5">
          <button
            type="button"
            onClick={onToggleArchived}
            className={cn(
              "inline-flex h-7 w-full items-center gap-1.5 rounded-md px-2",
              "text-[11px] text-fg-faint hover:bg-surface-hover hover:text-fg-muted",
              "transition-colors duration-150",
            )}
            aria-expanded={archivedOpen}
          >
            <ChevronRight
              size={11}
              strokeWidth={2}
              className={cn(
                "shrink-0 transition-transform duration-150",
                archivedOpen && "rotate-90",
              )}
              aria-hidden
            />
            <Archive size={12} strokeWidth={1.75} className="shrink-0" />
            <span>已归档</span>
            <span className="tabular-nums">{archived.length}</span>
          </button>
          {archivedOpen ? (
            <ul className="flex flex-col gap-0.5" role="list">
              {archived.map((conv) => {
                const summary = getConversationSummary(conv);
                const active = conv.id === activeConvId;
                return (
                  <li key={conv.id} className="group/arch relative">
                    <button
                      type="button"
                      onClick={() => onSelect(conv.id)}
                      className={cn(
                        "flex h-7 w-full items-center gap-1.5 rounded-md pl-2 pr-[3.25rem] text-left",
                        "text-[11.5px] transition-colors duration-150",
                        active
                          ? "bg-accent-subtle text-fg"
                          : "text-fg-faint hover:bg-surface-hover hover:text-fg-muted",
                      )}
                      title={summary}
                    >
                      <MessageSquare
                        size={12}
                        strokeWidth={1.75}
                        className={cn(
                          "shrink-0",
                          active ? "text-fg" : "opacity-70",
                        )}
                      />
                      <span className="min-w-0 flex-1 truncate">
                        {summary}
                      </span>
                    </button>
                    <div
                      className={cn(
                        "absolute right-0.5 top-1/2 z-[1] flex -translate-y-1/2 items-center gap-0.5",
                        "opacity-0 transition-opacity duration-150",
                        "[transition-timing-function:cubic-bezier(0.23,1,0.32,1)]",
                        "group-hover/arch:opacity-100 focus-within:opacity-100",
                        "[@media(hover:none)]:opacity-100",
                      )}
                    >
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          onRestore(conv.id);
                        }}
                        className={cn(
                          "inline-flex h-6 items-center gap-0.5 rounded-md px-1.5",
                          "text-[10.5px] text-fg-faint",
                          "hover:bg-surface-active hover:text-fg",
                        )}
                        title="恢复"
                        aria-label="恢复"
                      >
                        <RotateCcw size={11} strokeWidth={1.75} />
                        <span>恢复</span>
                      </button>
                      {onDelete ? (
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            if (
                              window.confirm(
                                "永久删除该会话？此操作不可恢复。",
                              )
                            ) {
                              onDelete(conv.id);
                            }
                          }}
                          className={cn(
                            "inline-flex size-6 items-center justify-center rounded-md",
                            "text-fg-faint hover:bg-surface-active hover:text-fg",
                          )}
                          title="永久删除"
                          aria-label="永久删除"
                        >
                          <Trash2 size={11} strokeWidth={1.75} />
                        </button>
                      ) : null}
                    </div>
                  </li>
                );
              })}
            </ul>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
