/**
 * 顶栏会话历史（HeroUI Popover）。
 * 主操作 = 归档（ADR 0015）；切换会话不拦截流式。
 */
import { useMemo, useState } from "react";
import { Archive, History, MessageSquarePlus } from "lucide-react";
import { toast } from "@/lib/toast";
import { Popover } from "@/lib/heroui";
import {
  getConversationSummary,
  useAgentChats,
  type AgentConversation,
} from "@/stores/useAgentChats";
import { cn } from "@/lib/utils";

interface ConversationHistoryProps {
  disabled?: boolean;
  /** 当前工作区；列表只显示该工作区下会话（null = 未挂载） */
  workspaceId?: string | null;
  onSelectConversation: (conversationId: string) => void;
  onNewConversation: () => void;
  /** 兼容旧 prop：若未传 onArchive 则走此回调 */
  onDeleteConversation?: (conversationId: string) => void;
  /** 软归档（优先） */
  onArchiveConversation?: (conversationId: string) => void;
}

export function ConversationHistory({
  disabled,
  workspaceId = null,
  onSelectConversation,
  onNewConversation,
  onDeleteConversation,
  onArchiveConversation,
}: ConversationHistoryProps) {
  const [open, setOpen] = useState(false);
  // 禁止 selector 内 new Array：zustand + useSyncExternalStore 会无限重渲染 (#185)
  const conversationsMap = useAgentChats((s) => s.conversations);
  const activeId = useAgentChats((s) => s.activeConversationId);
  const conversations = useMemo(
    () =>
      Object.values(conversationsMap)
        .filter(
          (c) =>
            c.messages.length > 0 &&
            (c.workspaceId ?? null) === (workspaceId ?? null) &&
            !(
              typeof c.archivedAt === "number" &&
              Number.isFinite(c.archivedAt) &&
              c.archivedAt > 0
            ),
        )
        .sort((a, b) => b.updatedAt - a.updatedAt),
    [conversationsMap, workspaceId],
  );

  const handleSelect = (id: string) => {
    onSelectConversation(id);
    setOpen(false);
  };

  const handleArchive = (
    event: React.MouseEvent,
    conversation: AgentConversation,
  ) => {
    event.stopPropagation();
    if (onArchiveConversation) {
      onArchiveConversation(conversation.id);
      toast.success("已归档");
    } else if (onDeleteConversation) {
      onDeleteConversation(conversation.id);
      toast.success("已归档");
    }
  };

  const canArchive = Boolean(onArchiveConversation || onDeleteConversation);

  return (
    <Popover
      isOpen={open}
      onOpenChange={(next) => {
        if (disabled) return;
        setOpen(next);
      }}
    >
      {/*
        HeroUI Popover.Trigger 固定包一层 div.popover__trigger（默认 inline-block）。
        不可再嵌套 button，否则顶栏 flex 里出现 baseline 空隙，图标看起来未垂直居中。
        样式直接打在 Trigger 上，与其它 icon-control 同为 size-7 inline-flex。
      */}
      <Popover.Trigger
        title="会话历史"
        aria-label="会话历史"
        aria-disabled={disabled || undefined}
        className={cn(
          // !inline-flex 覆盖 .popover__trigger 的 inline-block
          "icon-control !inline-flex size-7 shrink-0 items-center justify-center rounded-md text-fg-muted outline-none",
          disabled && "pointer-events-none cursor-not-allowed opacity-40",
        )}
      >
        <History size={16} strokeWidth={1.75} aria-hidden />
      </Popover.Trigger>
      <Popover.Content placement="bottom end" className="w-72 p-0">
        <Popover.Dialog className="outline-none">
          <div className="flex items-center justify-between border-b border-border px-2.5 py-2">
            <span className="text-[12px] font-medium text-fg">会话历史</span>
            <button
              type="button"
              onClick={() => {
                onNewConversation();
                setOpen(false);
              }}
              className="inline-flex items-center gap-1 rounded-md px-1.5 py-1 text-[11.5px] text-fg-muted hover:bg-surface-hover hover:text-fg"
            >
              <MessageSquarePlus size={13} strokeWidth={1.75} />
              新会话
            </button>
          </div>

          <div className="max-h-64 overflow-y-auto p-1.5">
            {conversations.length === 0 ? (
              <p className="px-2 py-4 text-center text-[12px] text-fg-faint">
                暂无历史会话
              </p>
            ) : (
              <ul className="space-y-0.5">
                {conversations.map((conv) => {
                  const active = conv.id === activeId;
                  return (
                    <li key={conv.id}>
                      <button
                        type="button"
                        onClick={() => handleSelect(conv.id)}
                        className={cn(
                          "group flex h-8 w-full items-center gap-2 rounded-md px-2 text-left",
                          active
                            ? "bg-accent-subtle"
                            : "hover:bg-surface-hover",
                        )}
                      >
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-[12.5px] text-fg">
                            {getConversationSummary(conv)}
                          </p>
                        </div>
                        {canArchive ? (
                          <span
                            role="button"
                            tabIndex={0}
                            onClick={(e) => handleArchive(e, conv)}
                            onKeyDown={(e) => {
                              if (e.key === "Enter" || e.key === " ") {
                                e.preventDefault();
                                handleArchive(
                                  e as unknown as React.MouseEvent,
                                  conv,
                                );
                              }
                            }}
                            className="shrink-0 rounded p-1 text-fg-faint opacity-0 hover:bg-surface-active hover:text-fg group-hover:opacity-100"
                            title="归档"
                            aria-label="归档会话"
                          >
                            <Archive size={13} strokeWidth={1.75} />
                          </span>
                        ) : null}
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </Popover.Dialog>
      </Popover.Content>
    </Popover>
  );
}
