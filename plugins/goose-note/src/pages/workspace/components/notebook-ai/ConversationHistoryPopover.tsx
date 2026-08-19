import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type MouseEvent,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import {
  Check,
  Clock3,
  History as HistoryIcon,
  MessageSquareText,
  Trash2,
} from "lucide-react";
import { toast } from "@/components/ui/sonner";
import { TOOLTIP_DELAY_MS } from "@/components/ui/tooltip-delay";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import type { NotebookAiMessage } from "@/lib/notebook-ai/types";
import { useNotebookAiChats } from "@/stores/useNotebookAiChats";
import { cn } from "@/lib/utils";

export interface ConversationHistoryListProps {
  notebookId: string;
  onSelectConversation: (conversationId: string) => void;
  /** 选中后回调（用于关闭外层菜单） */
  onDidSelect?: () => void;
  /** 删除会话回调；未提供时不显示删除按钮 */
  onDeleteConversation?: (conversationId: string) => void;
  className?: string;
  compact?: boolean;
}

export interface ConversationHistoryPopoverProps {
  notebookId: string;
  onSelectConversation: (conversationId: string) => void;
  disabled?: boolean;
}

function getMessageText(message: NotebookAiMessage) {
  const textPart = message.parts?.find((part) => part.type === "text");
  return textPart && "text" in textPart && typeof textPart.text === "string"
    ? textPart.text
    : "";
}

function getUserDisplayText(message: NotebookAiMessage) {
  const displayText = message.metadata?.displayText?.trim();
  if (displayText) return displayText;

  const rawText = getMessageText(message).trim();
  const hiddenContextStart = rawText.indexOf("\n\n本轮笔记上下文：");
  if (rawText.startsWith("用户输入：") && hiddenContextStart > -1) {
    return rawText.slice("用户输入：".length, hiddenContextStart).trim();
  }
  return rawText.startsWith("用户输入：")
    ? rawText.slice("用户输入：".length).trim()
    : rawText;
}

function getConversationSummary(messages: NotebookAiMessage[]) {
  const firstUserMessage = messages.find((message) => message.role === "user");
  return firstUserMessage
    ? getUserDisplayText(firstUserMessage) || "新会话"
    : "新会话";
}

/** 显示到时分秒；非今日附带月日（跨年再带年份） */
function formatConversationTime(timestamp: number) {
  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) return "";

  const now = new Date();
  const time = date.toLocaleTimeString("zh-CN", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });

  const isToday =
    date.getFullYear() === now.getFullYear() &&
    date.getMonth() === now.getMonth() &&
    date.getDate() === now.getDate();

  if (isToday) return time;

  const datePart = date.toLocaleDateString("zh-CN", {
    year: date.getFullYear() === now.getFullYear() ? undefined : "numeric",
    month: "short",
    day: "numeric",
  });

  return `${datePart} ${time}`;
}

/**
 * Dropdown / 溢出容器内 Radix Tooltip 常被 pointer 捕获拦掉。
 * 用 body portal + 固定定位，延迟与全局 Tooltip 一致。
 */
function PortalHoverTip({
  content,
  children,
}: {
  content: string;
  children: (handlers: {
    onMouseEnter: (event: MouseEvent<HTMLElement>) => void;
    onMouseLeave: () => void;
  }) => ReactNode;
}) {
  const [tip, setTip] = useState<{ top: number; left: number } | null>(null);
  const showTimerRef = useRef<number>(0);

  const clearShowTimer = () => {
    if (showTimerRef.current) {
      window.clearTimeout(showTimerRef.current);
      showTimerRef.current = 0;
    }
  };

  useEffect(() => () => clearShowTimer(), []);

  return (
    <>
      {children({
        onMouseEnter: (event) => {
          const rect = event.currentTarget.getBoundingClientRect();
          const maxWidth = 288;
          const left = Math.min(
            Math.max(8, rect.left),
            window.innerWidth - maxWidth - 8,
          );
          const nextTip = { top: rect.bottom + 6, left };
          clearShowTimer();
          showTimerRef.current = window.setTimeout(() => {
            setTip(nextTip);
          }, TOOLTIP_DELAY_MS);
        },
        onMouseLeave: () => {
          clearShowTimer();
          setTip(null);
        },
      })}
      {tip && typeof document !== "undefined"
        ? createPortal(
            <div
              role="tooltip"
              className="pointer-events-none fixed z-[30000] max-w-xs select-none whitespace-normal break-words rounded-[14px] border border-border/80 bg-popover px-2.5 py-1.5 text-[12px] font-medium leading-snug text-popover-foreground shadow-[0_8px_24px_rgba(15,23,42,0.12)] dark:border-white/20"
              style={{ top: tip.top, left: tip.left }}
            >
              {content}
            </div>,
            document.body,
          )
        : null}
    </>
  );
}

/** 正在等待 toast 确认的会话删除，防止重复触发 */
const conversationDeleteInFlight = new Set<string>();

/** 删除会话：走全局 sonner toast 确认，确认后回调执行真实删除 */
function requestDeleteConversation(
  conversationId: string,
  summary: string,
  onConfirm: () => void,
) {
  if (conversationDeleteInFlight.has(conversationId)) return;
  const trimmedSummary = summary.trim() || "新会话";
  const displaySummary =
    trimmedSummary.length > 20 ? `${trimmedSummary.slice(0, 20)}…` : trimmedSummary;
  const toastId = `delete-ai-conversation:${conversationId}`;

  // 从弹出确认 toast 起就占位，保证同一会话同时只有一个待确认 toast
  conversationDeleteInFlight.add(conversationId);
  toast.warning(`删除会话「${displaySummary}」？`, {
    id: toastId,
    duration: 8000,
    onDismiss: () => {
      conversationDeleteInFlight.delete(conversationId);
    },
    onAutoClose: () => {
      conversationDeleteInFlight.delete(conversationId);
    },
    action: {
      label: "确认删除",
      onClick: () => {
        try {
          onConfirm();
          toast.success("已删除会话", { id: toastId });
        } finally {
          conversationDeleteInFlight.delete(conversationId);
        }
      },
    },
  });
}

export function ConversationHistoryList({
  notebookId,
  onSelectConversation,
  onDidSelect,
  onDeleteConversation,
  className,
  compact = false,
}: ConversationHistoryListProps) {
  const notebookChatState = useNotebookAiChats(
    (state) => state.chats[notebookId],
  );
  const activeConversationId = notebookChatState?.activeConversationId ?? null;
  const conversations = useMemo(
    () =>
      Object.values(notebookChatState?.conversations ?? {})
        .filter((conversation) => conversation.messages.length > 0)
        .sort((left, right) => right.updatedAt - left.updatedAt),
    [notebookChatState],
  );

  const selectConversation = (conversationId: string) => {
    if (conversationId !== activeConversationId) {
      onSelectConversation(conversationId);
    }
    onDidSelect?.();
  };

  const confirmDeleteConversation = (
    event: MouseEvent<HTMLElement>,
    conversationId: string,
    summary: string,
  ) => {
    event.stopPropagation();
    event.preventDefault();
    if (!onDeleteConversation) return;
    requestDeleteConversation(conversationId, summary, () => {
      onDeleteConversation(conversationId);
    });
  };

  if (conversations.length === 0) {
    return (
      <div
        className={
          className ??
          "flex flex-col items-center justify-center gap-2 px-4 py-8 text-center text-muted-foreground"
        }
      >
        <MessageSquareText className="h-5 w-5" strokeWidth={1.5} />
        <span className="text-xs">暂无历史会话</span>
      </div>
    );
  }

  const list = (
    <div className="min-w-0 max-w-full space-y-0.5 overflow-x-hidden pr-1">
      {conversations.map((conversation) => {
        const isActive = conversation.id === activeConversationId;
        const summary = getConversationSummary(conversation.messages);

        return (
          <PortalHoverTip key={conversation.id} content={summary}>
            {({ onMouseEnter, onMouseLeave }) => (
              <div
                role="button"
                tabIndex={0}
                onClick={() => selectConversation(conversation.id)}
                onKeyDown={(event) => {
                  if (event.key !== "Enter" && event.key !== " ") return;
                  event.preventDefault();
                  selectConversation(conversation.id);
                }}
                onMouseEnter={onMouseEnter}
                onMouseLeave={onMouseLeave}
                className="group flex w-full min-w-0 max-w-full cursor-pointer items-center gap-2 overflow-hidden rounded-[8px] px-2.5 py-2 text-left transition-colors hover:bg-[var(--goose-interactive-hover)]"
                aria-current={isActive ? "true" : undefined}
              >
                <div className="min-w-0 flex-1 overflow-hidden">
                  <div className="block w-full truncate text-sm text-foreground">
                    {summary}
                  </div>
                  <div className="mt-1 flex items-center gap-1 text-[11px] text-muted-foreground">
                    <Clock3 className="h-3 w-3 shrink-0" strokeWidth={1.75} />
                    <span className="truncate">
                      {formatConversationTime(conversation.updatedAt)}
                    </span>
                  </div>
                </div>
                {isActive ? (
                  <span className="flex shrink-0 items-center gap-0.5 text-[11px] text-foreground">
                    <Check className="h-3 w-3" strokeWidth={2} />
                    当前
                  </span>
                ) : null}
                {onDeleteConversation ? (
                  <button
                    type="button"
                    aria-label="删除会话"
                    title="删除会话"
                    onClick={(event) =>
                      confirmDeleteConversation(event, conversation.id, summary)
                    }
                    className="flex h-6 w-6 shrink-0 items-center justify-center rounded-[6px] text-muted-foreground opacity-0 outline-none transition-[opacity,color,background-color] hover:bg-[var(--goose-color-danger-subtle-bg)] hover:text-[var(--goose-color-danger-focus)] focus-visible:opacity-100 group-hover:opacity-100"
                  >
                    <Trash2 className="h-3.5 w-3.5" strokeWidth={1.75} />
                  </button>
                ) : null}
              </div>
            )}
          </PortalHoverTip>
        );
      })}
    </div>
  );

  if (compact) {
    return <div className={cn("min-w-0 max-w-full", className)}>{list}</div>;
  }

  return (
    <div
      className={cn(
        "min-w-0 max-w-full overflow-x-hidden overflow-y-auto p-1.5",
        className,
      )}
      style={{ maxHeight: Math.min(conversations.length * 58 + 12, 300) }}
    >
      {list}
    </div>
  );
}

export function ConversationHistoryPopover({
  notebookId,
  onSelectConversation,
  disabled = false,
}: ConversationHistoryPopoverProps) {
  const [open, setOpen] = useState(false);

  return (
    <Popover
      open={open && !disabled}
      onOpenChange={(nextOpen) => {
        if (!disabled) setOpen(nextOpen);
      }}
    >
      <PopoverTrigger asChild>
        <button
          type="button"
          className="flex h-7 w-7 items-center justify-center rounded-[7px] text-muted-foreground transition-colors hover:bg-[var(--goose-icon-chip-on-selected)] hover:text-foreground dark:hover:bg-[var(--goose-interactive-hover)] disabled:pointer-events-none disabled:opacity-50"
          aria-label="历史会话"
          title="历史会话"
          disabled={disabled}
        >
          <HistoryIcon className="h-3.5 w-3.5" strokeWidth={1.75} />
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="end"
        sideOffset={6}
        className="w-72 max-w-72 overflow-hidden p-0"
      >
        <ConversationHistoryList
          notebookId={notebookId}
          onSelectConversation={onSelectConversation}
          onDidSelect={() => setOpen(false)}
        />
      </PopoverContent>
    </Popover>
  );
}
