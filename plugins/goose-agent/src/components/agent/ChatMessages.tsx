/**
 * 消息列表：user / assistant 气泡 + 工具进度卡。
 * 无 BlockNote / 无 ApprovalPlanCard。
 * 首次引导在独立 OnboardingScreen，空会话仅轻空态。
 */
import { useEffect, useRef } from "react";
import {
  getMessageImages,
  getMessageText,
  getUserDisplayText,
  type AgentMessage,
} from "@/stores/useAgentChats";
import { cn } from "@/lib/utils";
import { buiThinkingLoader } from "./aiMotionPresets";
import { LoadingState } from "./beautiful-ui/LoadingState";
import { StreamingCaret } from "./beautiful-ui/StreamingCaret";
import { ThinkingTraces } from "./beautiful-ui/ThinkingTraces";
import { MarkdownContent } from "./MarkdownContent";
import {
  extractToolParts,
  ToolProgressCard,
} from "./ToolProgressCard";
import {
  isSubAgentToolPart,
  SubAgentCard,
} from "./SubAgentCard";
import {
  ArtifactCard,
  extractArtifactParts,
} from "./artifacts/ArtifactCard";
import { isArtifactToolType } from "./artifacts/artifactKinds";
import type { AgentToolPart } from "@/stores/useAgentChats";
import type { PermissionMode } from "@/lib/agent/permission";

interface ChatMessagesProps {
  messages: AgentMessage[];
  /** 正在流式输出的 assistant 消息 id */
  streamingMessageId?: string | null;
  isBusy?: boolean;
  /** 打开变更差异并聚焦 path */
  onOpenDiff?: (path: string) => void;
  /** 会话绑定工作区根；工具进度卡路径相对化 */
  workspaceRoot?: string | null;
  /** 与 Composer 一致的权限模式；Artifact 保存到工作区 */
  permissionMode?: PermissionMode;
}

function formatTime(ts: number) {
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleTimeString("zh-CN", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

function imageDataUrl(mediaType: string, dataBase64: string) {
  return `data:${mediaType};base64,${dataBase64}`;
}

/** 消息时间：默认隐藏，hover 气泡旁显示，不占流式布局行 */
function MessageTime({
  createdAt,
  side,
}: {
  createdAt: number;
  /** 用户气泡：时间在左；助手：在右 */
  side: "start" | "end";
}) {
  const label = formatTime(createdAt);
  if (!label) return null;
  return (
    <time
      dateTime={new Date(createdAt).toISOString()}
      className={cn(
        // 贴气泡底边外侧，不垂直居中
        "pointer-events-none absolute bottom-0 z-[1]",
        "whitespace-nowrap text-[10.5px] tabular-nums leading-none text-fg-faint",
        "opacity-0 transition-opacity duration-150",
        "group-hover/msg:opacity-100 group-focus-within/msg:opacity-100",
        side === "end"
          ? "right-full mr-1.5"
          : "left-full ml-1.5",
      )}
    >
      {label}
    </time>
  );
}

function UserBubble({ message }: { message: AgentMessage }) {
  const text = getUserDisplayText(message);
  const images = getMessageImages(message);
  // 纯图：displayText 可能是「（图片）」；无文案且无图则不渲染
  const showText = Boolean(text) && !(text === "（图片）" && images.length > 0);
  if (!showText && images.length === 0) return null;

  return (
    <div className="group/msg flex justify-end">
      <div
        className="agent-msg-user relative max-w-[min(100%,520px)] rounded-[14px] bg-accent-subtle px-3.5 py-2.5 text-fg"
        style={{
          fontSize: "var(--font-size-chat)",
          lineHeight: "var(--line-height-chat)",
        }}
      >
        {images.length > 0 ? (
          <div
            className={cn(
              "flex flex-wrap justify-end gap-1.5",
              showText && "mb-2",
            )}
          >
            {images.map((img, i) => (
              <img
                key={`${message.id}-img-${i}`}
                src={imageDataUrl(img.mediaType, img.dataBase64)}
                alt=""
                className="max-h-40 max-w-[min(100%,240px)] rounded-[10px] border border-border-soft object-contain bg-bg"
                draggable={false}
              />
            ))}
          </div>
        ) : null}
        {showText ? (
          <div className="select-text whitespace-pre-wrap break-words">{text}</div>
        ) : null}
        <MessageTime createdAt={message.createdAt} side="end" />
      </div>
    </div>
  );
}

function AssistantBubble({
  message,
  isStreaming,
  onOpenDiff,
  workspaceRoot,
  permissionMode,
}: {
  message: AgentMessage;
  isStreaming: boolean;
  onOpenDiff?: (path: string) => void;
  workspaceRoot?: string | null;
  permissionMode?: PermissionMode;
}) {
  const text = getMessageText(message);
  const toolParts = extractToolParts(
    message.parts as Array<{ type: string } & Record<string, unknown>>,
  );
  // 原始 part 保留 subRun；extractToolParts 会丢掉该字段
  const rawToolParts = message.parts.filter(
    (p): p is AgentToolPart =>
      p.type !== "text" &&
      p.type !== "image" &&
      (p.type.startsWith("tool-") || p.type.startsWith("tool")),
  );
  const subagentParts = rawToolParts.filter((p) => isSubAgentToolPart(p));
  // 进度卡排除 Artifact 类（由下方 ArtifactCard 渲染预览）
  const regularToolParts = toolParts.filter(
    (p) => !isSubAgentToolPart(p) && !isArtifactToolType(p.type),
  );
  const artifactParts = extractArtifactParts(
    rawToolParts.filter(
      (p) => !isSubAgentToolPart(p) && isArtifactToolType(p.type),
    ),
  );
  const showThinking =
    isStreaming &&
    !text.trim() &&
    toolParts.length === 0 &&
    subagentParts.length === 0;

  return (
    <div className="group/msg flex justify-start">
      <div className="agent-msg-assistant max-w-[min(100%,560px)] space-y-2">
        {subagentParts.map((part) => (
          <SubAgentCard
            key={part.toolCallId || part.type + String(part.subRun?.runId)}
            part={part}
            isMessageStreaming={isStreaming}
            onOpenDiff={onOpenDiff}
            workspaceRoot={workspaceRoot}
          />
        ))}
        {regularToolParts.length > 0 ? (
          <ToolProgressCard
            parts={regularToolParts}
            isMessageStreaming={isStreaming}
            onOpenDiff={onOpenDiff}
            workspaceRoot={workspaceRoot}
          />
        ) : null}
        {artifactParts.map((part, i) => (
          <ArtifactCard
            key={`${part.type}-${i}`}
            toolType={part.type}
            output={part.output}
            workspaceRoot={workspaceRoot}
            permissionMode={permissionMode}
          />
        ))}

        {showThinking ? (
          <div
            className="space-y-1.5"
            aria-live="polite"
            aria-busy="true"
          >
            <LoadingState
              variant={buiThinkingLoader.variant}
              startedAt={message.createdAt}
            />
            <ThinkingTraces
              steps={[]}
              startedAt={message.createdAt}
              working
            />
          </div>
        ) : null}

        {text.trim() ? (
          <div
            className="relative rounded-[14px] bg-bg px-3.5 py-2.5 text-fg"
            style={{
              fontSize: "var(--font-size-chat)",
              lineHeight: "var(--line-height-chat)",
            }}
          >
            <div className="select-text break-words">
              <MarkdownContent content={text} isStreaming={isStreaming} />
              {isStreaming ? <StreamingCaret /> : null}
            </div>
            {!isStreaming ? (
              <MessageTime createdAt={message.createdAt} side="start" />
            ) : null}
          </div>
        ) : null}
      </div>
    </div>
  );
}

export function ChatMessages({
  messages,
  streamingMessageId,
  isBusy,
  onOpenDiff,
  workspaceRoot,
  permissionMode,
}: ChatMessagesProps) {
  const bottomRef = useRef<HTMLDivElement>(null);
  const scrollerRef = useRef<HTMLDivElement>(null);
  const stickToBottomRef = useRef(true);

  useEffect(() => {
    const el = scrollerRef.current;
    if (!el) return;
    const onScroll = () => {
      const distance = el.scrollHeight - el.scrollTop - el.clientHeight;
      stickToBottomRef.current = distance < 80;
    };
    el.addEventListener("scroll", onScroll, { passive: true });
    return () => el.removeEventListener("scroll", onScroll);
  }, []);

  useEffect(() => {
    if (!stickToBottomRef.current) return;
    // 流式时用 auto：smooth 会在每帧消息更新时堆积动画，拖垮主线程
    const behavior: ScrollBehavior = streamingMessageId ? "auto" : "smooth";
    bottomRef.current?.scrollIntoView({ behavior, block: "end" });
  }, [messages, streamingMessageId, isBusy]);

  if (messages.length === 0) {
    return (
      <div
        ref={scrollerRef}
        /* 空态无需滚动；overflow-y-auto 在 pane 挂载/入场时易瞬时溢出闪条 */
        className="flex min-h-0 flex-1 flex-col overflow-hidden px-4 py-5"
      >
        <div className="mx-auto flex w-full max-w-[420px] flex-1 flex-col items-center justify-center">
          <div className="flex flex-col items-center text-center">
            <div
              className="agent-empty-mascot flex size-10 items-center justify-center rounded-[12px] bg-accent-subtle text-[18px]"
              aria-hidden
            >
              🪿
            </div>
            <p className="agent-empty-title mt-2.5 text-[14px] font-semibold tracking-tight text-fg">
              开始对话
            </p>
            <p className="mt-1 text-[11.5px] text-fg-faint">
              Enter 发送 · Shift+Enter 换行 · ⌘/Ctrl+J 聚焦
            </p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div
      ref={scrollerRef}
      className="agent-chat-scroller min-h-0 min-w-0 flex-1 px-4 py-4"
    >
      <div className="mx-auto flex w-full max-w-[640px] min-w-0 flex-col gap-4">
        {messages.map((message) => {
          if (message.role === "user") {
            return <UserBubble key={message.id} message={message} />;
          }
          if (message.role === "assistant") {
            return (
              <AssistantBubble
                key={message.id}
                message={message}
                isStreaming={message.id === streamingMessageId}
                onOpenDiff={onOpenDiff}
                workspaceRoot={workspaceRoot}
                permissionMode={permissionMode}
              />
            );
          }
          return null;
        })}
        <div ref={bottomRef} className="h-px shrink-0" aria-hidden />
      </div>
    </div>
  );
}
