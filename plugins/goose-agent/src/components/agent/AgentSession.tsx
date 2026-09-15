/**
 * 会话容器：顶栏 + 消息区 / Composer。
 * SessionChatPane 按 conversationId 固定，支持多会话并发 + keep-alive。
 */
import { useCallback, useEffect, useRef } from "react";
import { GitCompare, MessageSquarePlus, Settings } from "lucide-react";
import { toast } from "@/lib/toast";
import {
  getActiveCredentialMissingMessage,
  hasActiveCredential,
  modelSupportsVision,
  resolveEffectiveModelId,
} from "@/lib/ai-provider";
import { runAgentTurn } from "@/lib/agent/runTurn";
import type {
  AgentChatContentPart,
  AgentChatMessage,
  AgentTurnEvent,
} from "@/lib/agent/types";
import {
  formatOfficeAttachmentsForMessage,
  type OfficeAttachment,
} from "@/lib/agent/officeAttachments";
import type { UserImageAttachment } from "@/lib/agent/userImages";
import { resolvePersona } from "@/lib/agent/persona";
import { openInFileManager } from "@/lib/fs";
import { useOnboardingTour } from "@/hooks/useOnboardingTour";
import { useSettings } from "@/stores/settings";
import {
  createAgentMessageId,
  getConversationTitle,
  getMessageImages,
  getMessageText,
  useAgentChats,
  type AgentImagePart,
  type AgentMessage,
  type AgentMessagePart,
  type AgentToolPart,
} from "@/stores/useAgentChats";
import { useFileChanges } from "@/stores/useFileChanges";
import { usePermissionMode } from "@/stores/usePermissionMode";
import {
  selectIsSessionRunning,
  useSessionRuns,
} from "@/stores/useSessionRuns";
import { useWorkspaces } from "@/stores/useWorkspaces";
import { cn } from "@/lib/utils";
import { ChatChrome } from "./beautiful-ui/ChatChrome";
import { ChatMessages } from "./ChatMessages";
import { Composer } from "./Composer";
import { ConversationHistory } from "./ConversationHistory";

/** 稳定空列表，避免 `|| []` 每帧新引用触发下游 effect */
const EMPTY_MESSAGES: AgentMessage[] = [];

/**
 * 会话消息 → runTurn AgentChatMessage。
 * 无图：content string；有图：parts 数组；纯图也保留。
 */
function toChatMessages(messages: AgentMessage[]): AgentChatMessage[] {
  return messages
    .filter((m) => m.role === "user" || m.role === "assistant")
    .map((m) => {
      const text = getMessageText(m);
      const images = getMessageImages(m);
      if (images.length === 0) {
        return {
          role: m.role as "user" | "assistant",
          content: text,
        };
      }
      const parts: AgentChatContentPart[] = [
        ...images.map(
          (img): AgentChatContentPart => ({
            type: "image",
            mediaType: img.mediaType,
            dataBase64: img.dataBase64,
          }),
        ),
      ];
      if (text.trim()) {
        parts.push({ type: "text", text });
      }
      return {
        role: m.role as "user" | "assistant",
        content: parts,
      };
    })
    .filter((m) => {
      if (typeof m.content === "string") return m.content.trim() !== "";
      // 有 image 即使 text 空也保留
      return m.content.some(
        (p) =>
          (p.type === "image" && Boolean(p.dataBase64)) ||
          (p.type === "text" && p.text.trim() !== ""),
      );
    });
}

function upsertToolPart(
  parts: AgentMessagePart[],
  toolCallId: string,
  patch: Partial<AgentToolPart> & { type: string },
): AgentMessagePart[] {
  const next = parts.slice();
  const idx = next.findIndex(
    (p) =>
      p.type !== "text" &&
      "toolCallId" in p &&
      (p as AgentToolPart).toolCallId === toolCallId,
  );
  if (idx >= 0) {
    const prev = next[idx] as AgentToolPart;
    next[idx] = {
      ...prev,
      ...patch,
      toolCallId,
      // 显式合并 subRun，避免 patch 未带时被抹掉
      subRun:
        patch.subRun !== undefined ? patch.subRun : prev.subRun,
    };
    return next;
  }
  next.push({
    type: patch.type,
    toolCallId,
    state: patch.state,
    input: patch.input,
    output: patch.output,
    errorText: patch.errorText,
    subRun: patch.subRun,
  });
  return next;
}

function setTextPart(parts: AgentMessagePart[], text: string): AgentMessagePart[] {
  const next = parts.filter((p) => p.type !== "text");
  next.push({ type: "text", text });
  // 保持 tool 在前、text 在后的可读顺序
  const tools = next.filter((p) => p.type !== "text");
  const texts = next.filter((p) => p.type === "text");
  return [...tools, ...texts];
}

// ─── SessionChatPane：单会话消息 + Composer + send/stop ───────────────────────

export interface SessionChatPaneProps {
  /** 本 pane 固定绑定的会话 id（不跟 activeConversation 漂移） */
  conversationId: string;
  /** false = keep-alive 隐藏态；仍挂载，跳过 Escape 等全局快捷键 */
  isActive?: boolean;
  onOpenChanges?: (path?: string) => void;
}

/**
 * 单会话聊天面板。keep-alive 下可多实例并存；流式状态读 useSessionRuns。
 */
export function SessionChatPane({
  conversationId,
  isActive = true,
  onOpenChanges,
}: SessionChatPaneProps) {
  const messages =
    useAgentChats((s) => s.conversations[conversationId]?.messages) ??
    EMPTY_MESSAGES;

  const isStreaming = useSessionRuns(selectIsSessionRunning(conversationId));
  const streamingMessageId = useSessionRuns(
    (s) => s.runs[conversationId]?.assistantMessageId ?? null,
  );

  // 会话绑定工作区根（与 runTurn 一致，不跟 active 工作区串台）
  const convWorkspaceId = useAgentChats(
    (s) => s.conversations[conversationId]?.workspaceId ?? null,
  );
  const workspaceRoot = useWorkspaces((s) => {
    if (!convWorkspaceId) return null;
    return s.workspaces.find((w) => w.id === convWorkspaceId)?.path ?? null;
  });
  /** 与 Composer / runTurn 同一权限模式；Artifact「保存到工作区」走沙箱 */
  const permissionMode = usePermissionMode((s) => s.mode);

  /** 本 turn 的 controller；用于 finishTurn 身份校验，避免陈旧 turn 误 end */
  const turnControllerRef = useRef<AbortController | null>(null);
  const textAccRef = useRef("");
  const streamTargetRef = useRef<{
    convId: string;
    assistantId: string;
  } | null>(null);
  const textRafRef = useRef<number | null>(null);

  const cancelTextRaf = useCallback(() => {
    if (textRafRef.current != null) {
      cancelAnimationFrame(textRafRef.current);
      textRafRef.current = null;
    }
  }, []);

  /** 将 textAcc 刷进 store（最多约每帧一次；force 用于 done/stop） */
  const flushStreamingText = useCallback(() => {
    cancelTextRaf();
    const target = streamTargetRef.current;
    if (!target) return;
    const acc = textAccRef.current;
    useAgentChats.getState().updateMessage(
      target.convId,
      target.assistantId,
      (m) => ({
        ...m,
        parts: setTextPart(m.parts, acc),
      }),
    );
  }, [cancelTextRaf]);

  const scheduleStreamingTextFlush = useCallback(() => {
    if (textRafRef.current != null) return;
    textRafRef.current = requestAnimationFrame(() => {
      textRafRef.current = null;
      const target = streamTargetRef.current;
      if (!target) return;
      const acc = textAccRef.current;
      useAgentChats.getState().updateMessage(
        target.convId,
        target.assistantId,
        (m) => ({
          ...m,
          parts: setTextPart(m.parts, acc),
        }),
      );
    });
  }, []);

  // 仅取消 rAF；不得 endRun / unpause（run 与 registry 解耦，LRU 卸下后 turn 继续）
  useEffect(() => {
    return () => {
      cancelTextRaf();
    };
  }, [cancelTextRaf]);

  const stop = useCallback(() => {
    flushStreamingText();
    streamTargetRef.current = null;
    turnControllerRef.current = null;
    useSessionRuns.getState().abortRun(conversationId);
  }, [conversationId, flushStreamingText]);

  const handleOpenChanges = useCallback(
    (path?: string) => {
      if (onOpenChanges) {
        onOpenChanges(path);
        return;
      }
      window.dispatchEvent(
        new CustomEvent("goose-agent:open-changes", {
          detail: path ? { path } : {},
        }),
      );
    },
    [onOpenChanges],
  );

  const handleSend = useCallback(
    (
      text: string,
      images?: UserImageAttachment[],
      office?: OfficeAttachment[],
    ): boolean => {
      const convId = conversationId;
      const chats = useAgentChats.getState();
      if (!chats.conversations[convId]) return false;

      const trimmed = text.trim();
      const imageList = images ?? [];
      const officeList = office ?? [];
      if (!trimmed && imageList.length === 0 && officeList.length === 0) {
        return false;
      }

      // 并发闸：同会话已在跑 / 全局 cap
      const gate = useSessionRuns.getState().canStartRun(convId);
      if (gate === "already-running") return false;
      if (gate === "capped") {
        toast.info("已有 3 个会话在运行，请等待完成后再发送");
        return false;
      }

      // 无 active 凭证挡发送（与 Composer / getAIAvailability 一致）
      const settingsSnap = useSettings.getState().ai;
      if (!hasActiveCredential(settingsSnap)) {
        toast.error("请先配置凭证", {
          description: getActiveCredentialMissingMessage(settingsSnap),
        });
        return false;
      }

      // 有图且当前模型不支持视觉：硬拦，字+图留在 Composer
      if (imageList.length > 0) {
        const modelId = resolveEffectiveModelId(settingsSnap);
        if (
          !modelSupportsVision(
            modelId,
            settingsSnap.customModelOptions,
            settingsSnap.customProviderId,
          )
        ) {
          toast.error("当前模型不支持看图，请切换支持视觉的模型");
          return false;
        }
      }

      const imageParts: AgentImagePart[] = imageList.map((img) => ({
        type: "image" as const,
        mediaType: img.mediaType,
        dataBase64: img.dataBase64,
      }));
      // 模型可见：用户原文 + Office 解析正文；气泡用 displayText 避免刷屏
      const officeBlock = formatOfficeAttachmentsForMessage(officeList);
      const modelText = [trimmed, officeBlock].filter(Boolean).join("\n\n");
      const parts: AgentMessagePart[] = [...imageParts];
      if (modelText) {
        parts.push({ type: "text", text: modelText });
      }

      const displayText =
        trimmed ||
        (officeList.length > 0
          ? `（附件：${officeList.map((o) => o.filename).join("、")}）`
          : imageList.length > 0
            ? "（图片）"
            : "");

      const userMsg: AgentMessage = {
        id: createAgentMessageId("user"),
        role: "user",
        parts,
        createdAt: Date.now(),
        metadata: { displayText },
      };
      const assistantId = createAgentMessageId("assistant");
      const assistantMsg: AgentMessage = {
        id: assistantId,
        role: "assistant",
        parts: [{ type: "text", text: "" }],
        createdAt: Date.now(),
      };

      // 先占 run 槽再写消息，避免 cap 竞态留下空 assistant
      const controller = useSessionRuns
        .getState()
        .beginRun(convId, assistantId);
      if (!controller) {
        toast.info("已有 3 个会话在运行，请等待完成后再发送");
        return false;
      }

      chats.appendMessage(convId, userMsg);
      chats.appendMessage(convId, assistantMsg);

      const history = toChatMessages(
        chats
          .getConversationMessages(convId)
          .filter((m) => m.id !== assistantId),
      );

      const settingsState = useSettings.getState();
      const settings = settingsState.ai;
      const persona = resolvePersona(
        settingsState.persona.selectedPersonaId,
        settingsState.persona.customPersonas,
      );
      const mode = usePermissionMode.getState().mode;

      // 工具 workspace root：跟会话绑定，不跟当前 active 工作区
      const conv = chats.conversations[convId];
      const wsId = conv?.workspaceId ?? null;
      const workspaceRoot =
        useWorkspaces
          .getState()
          .workspaces.find((w) => w.id === wsId)?.path ?? null;
      const selectedModelId = resolveEffectiveModelId(settings);

      turnControllerRef.current = controller;
      textAccRef.current = "";
      streamTargetRef.current = { convId, assistantId };
      cancelTextRaf();

      // 闭包内 finished 标志：pane 被 LRU 卸载后仍可靠收尾 endRun / 写 store
      let turnFinished = false;
      let textAcc = "";

      const patchAssistant = (
        updater: (parts: AgentMessagePart[]) => AgentMessagePart[],
      ) => {
        useAgentChats.getState().updateMessage(convId, assistantId, (m) => ({
          ...m,
          parts: updater(m.parts),
        }));
      };

      const flushTextToStore = () => {
        const acc = textAcc;
        // 同步本实例 ref（pane 仍挂载时）
        textAccRef.current = acc;
        useAgentChats.getState().updateMessage(convId, assistantId, (m) => ({
          ...m,
          parts: setTextPart(m.parts, acc),
        }));
      };

      const finishTurn = () => {
        if (turnFinished) return;
        turnFinished = true;
        flushTextToStore();
        if (turnControllerRef.current === controller) {
          streamTargetRef.current = null;
          turnControllerRef.current = null;
        }
        useSessionRuns.getState().endRun(convId);
      };

      const onEvent = (event: AgentTurnEvent) => {
        if (turnFinished) return;

        if (event.type === "text-delta") {
          textAcc += event.text;
          textAccRef.current = textAcc;
          // pane 仍挂载时走 rAF 批处理；卸载后直接写 store
          if (streamTargetRef.current?.assistantId === assistantId) {
            scheduleStreamingTextFlush();
          } else {
            flushTextToStore();
          }
          return;
        }

        if (event.type === "tool-start") {
          flushTextToStore();
          const toolType = event.name.startsWith("tool-")
            ? event.name
            : `tool-${event.name}`;
          patchAssistant((parts) =>
            upsertToolPart(parts, event.id, {
              type: toolType,
              state: "call",
              input: event.input,
            }),
          );
          return;
        }

        if (event.type === "tool-progress") {
          flushTextToStore();
          const toolType = event.name.startsWith("tool-")
            ? event.name
            : `tool-${event.name}`;
          patchAssistant((parts) =>
            upsertToolPart(parts, event.id, {
              type: toolType,
              state: "call",
              subRun: event.subRun as AgentToolPart["subRun"],
            }),
          );
          return;
        }

        if (event.type === "tool-end") {
          flushTextToStore();
          const toolType = event.name.startsWith("tool-")
            ? event.name
            : `tool-${event.name}`;
          const result = event.result;
          const isErr =
            result &&
            typeof result === "object" &&
            (result as { ok?: boolean }).ok === false;
          const errorText =
            isErr &&
            typeof (result as { error?: unknown }).error === "string"
              ? (result as { error: string }).error
              : undefined;
          patchAssistant((parts) =>
            upsertToolPart(parts, event.id, {
              type: toolType,
              state: errorText ? "output-error" : "output-available",
              output: result,
              errorText,
            }),
          );
          return;
        }

        if (event.type === "usage") {
          useAgentChats.getState().recordTurnUsage(convId, event.usage);
          return;
        }

        if (event.type === "error") {
          // runTurn 保证 error 后仍会 done；此处只补错误文案，由 done 统一收尾
          const msg = event.message || "请求失败";
          if (!textAcc.trim()) {
            textAcc = msg;
            textAccRef.current = textAcc;
            if (streamTargetRef.current?.assistantId === assistantId) {
              scheduleStreamingTextFlush();
            } else {
              flushTextToStore();
            }
          }
          return;
        }

        if (event.type === "done") {
          finishTurn();
        }
      };

      void runAgentTurn({
        messages: history,
        settings,
        permissionMode: mode,
        workspaceRoot,
        signal: controller.signal,
        selectedModelId,
        personaSnippet: persona.systemSnippet,
        conversationId: convId,
        onEvent,
      }).catch(() => {
        // 未正常 done 时也释放 run 槽
        finishTurn();
      });

      return true;
    },
    [
      conversationId,
      cancelTextRaf,
      scheduleStreamingTextFlush,
      flushStreamingText,
    ],
  );

  // Escape 仅在本 pane 可见且本会话在跑时 abort
  useEffect(() => {
    if (!isActive || !isStreaming) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        stop();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [isActive, isStreaming, stop]);

  return (
    <ChatChrome className="agent-panel-enter flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden rounded-panel bg-surface">
      <ChatMessages
        messages={messages}
        streamingMessageId={streamingMessageId}
        isBusy={isStreaming}
        onOpenDiff={handleOpenChanges}
        workspaceRoot={workspaceRoot}
        permissionMode={permissionMode}
      />
      <Composer
        conversationId={conversationId}
        isStreaming={isStreaming}
        onSend={handleSend}
        onStop={stop}
      />
    </ChatChrome>
  );
}

// ─── 顶栏：共享一次，不随 pane keep-alive 复制 ───────────────────────────────

export interface AgentSessionHeaderProps {
  onOpenSettings: () => void;
  onOpenChanges?: (path?: string) => void;
}

export function AgentSessionHeader({
  onOpenSettings,
  onOpenChanges,
}: AgentSessionHeaderProps) {
  const workspaces = useWorkspaces((s) => s.workspaces);
  const activeWsId = useWorkspaces((s) => s.activeId);
  const activeWs = workspaces.find((w) => w.id === activeWsId) ?? null;

  const conversationId = useAgentChats((s) => s.activeConversationId);
  const conversationsMap = useAgentChats((s) => s.conversations);
  const activeConv = conversationId
    ? (conversationsMap[conversationId] ?? null)
    : null;
  /** 顶栏 = 会话标题；无则留空（不显示工作区名 / 软件名 /「新会话」） */
  const sessionTitle = activeConv ? getConversationTitle(activeConv) : null;
  const activeIsStreaming = useSessionRuns(
    selectIsSessionRunning(conversationId),
  );
  const changesCount = useFileChanges((s) =>
    conversationId
      ? (s.byConversation[conversationId]?.length ?? 0)
      : 0,
  );
  /** 当前工作区是否有可列历史（有消息且未归档）——有才露历史图标 */
  const hasHistory = Object.values(conversationsMap).some(
    (c) =>
      c.messages.length > 0 &&
      (c.workspaceId ?? null) === (activeWsId ?? null) &&
      !(
        typeof c.archivedAt === "number" &&
        Number.isFinite(c.archivedAt) &&
        c.archivedAt > 0
      ),
  );

  // 自动导览：仅看当前可见会话是否在流式（后台会话跑不影响调度）
  useOnboardingTour(activeIsStreaming);

  const handleNewConversation = useCallback(() => {
    useAgentChats.getState().createConversation({
      workspaceId: activeWsId ?? null,
    });
  }, [activeWsId]);

  const handleSelectConversation = useCallback((id: string) => {
    useAgentChats.getState().setActiveConversation(id);
  }, []);

  /** 主路径软归档（ADR 0015）；不 abort 进行中的 turn */
  const handleArchiveConversation = useCallback((id: string) => {
    useAgentChats.getState().archiveConversation(id);
  }, []);

  const handleOpenChanges = useCallback(
    (path?: string) => {
      if (onOpenChanges) {
        onOpenChanges(path);
        return;
      }
      window.dispatchEvent(
        new CustomEvent("goose-agent:open-changes", {
          detail: path ? { path } : {},
        }),
      );
    },
    [onOpenChanges],
  );

  const handleOpenWorkspaceFolder = useCallback(async () => {
    if (!activeWs?.path) return;
    const ok = await openInFileManager(activeWs.path);
    if (!ok) {
      toast.error("无法打开文件夹（需 uTools 真机）");
    }
  }, [activeWs?.path]);

  return (
    <header className="relative z-30 flex h-11 shrink-0 items-center justify-between gap-3 overflow-visible bg-bg px-3">
      {/*
        主行 = 会话标题（放大单行）；无标题则留空。
        描述（工作区路径）仅 hover / 焦点显示，可点开文件管理器。
      */}
      <div
        className="group/title relative flex h-full min-w-0 flex-1 items-center pr-2"
        /* 标题为空时仍占满左侧，便于 hover 出路径 */
      >
        <h1
          className={cn(
            "min-w-0 truncate font-semibold tracking-tight text-fg",
            /* 描述隐藏时标题放大，占满顶栏视觉重量 */
            "text-[15px] leading-snug",
          )}
          title={sessionTitle ?? undefined}
          aria-label={sessionTitle ?? "当前会话"}
        >
          {sessionTitle ?? ""}
        </h1>
        {activeWs ? (
          <button
            type="button"
            onClick={() => void handleOpenWorkspaceFolder()}
            className={cn(
              "absolute left-0 top-[calc(100%-2px)] z-40 max-w-[min(100%,28rem)]",
              "truncate rounded-md bg-bg px-1.5 py-0.5 text-left text-[11px] leading-tight",
              "text-fg-faint shadow-sm ring-1 ring-border-soft",
              "cursor-pointer opacity-0 pointer-events-none",
              "transition-[opacity,transform,color] duration-150",
              "[transition-timing-function:cubic-bezier(0.23,1,0.32,1)]",
              "translate-y-[-2px]",
              "group-hover/title:pointer-events-auto group-hover/title:opacity-100 group-hover/title:translate-y-0",
              "focus-visible:pointer-events-auto focus-visible:opacity-100 focus-visible:translate-y-0",
              "[@media(hover:none)]:pointer-events-auto [@media(hover:none)]:opacity-100 [@media(hover:none)]:translate-y-0",
              "hover:text-fg-muted hover:underline",
              "focus-visible:outline-none focus-visible:underline",
            )}
            title={`在文件管理器中打开：${activeWs.path}`}
            aria-label={`在文件管理器中打开 ${activeWs.path}`}
          >
            {activeWs.path}
          </button>
        ) : null}
      </div>
      {/*
        顶栏右侧：设置始终可见；其余按「有内容才露」
        - 历史：当前工作区有可列会话才显示
        - 变更：本会话有落盘变更才显示
        - 新会话：始终保留（与侧栏「+」互补，空态也可新建）
      */}
      <div className="flex shrink-0 items-center gap-0.5">
        <button
          type="button"
          onClick={handleNewConversation}
          className="icon-control inline-flex size-7 items-center justify-center rounded-md text-fg-muted"
          title="新会话"
          aria-label="新会话"
        >
          <MessageSquarePlus size={16} strokeWidth={1.75} />
        </button>
        {hasHistory ? (
          <ConversationHistory
            workspaceId={activeWsId ?? null}
            onSelectConversation={handleSelectConversation}
            onNewConversation={handleNewConversation}
            onArchiveConversation={handleArchiveConversation}
          />
        ) : null}
        {changesCount > 0 ? (
          <button
            type="button"
            onClick={() => handleOpenChanges()}
            className="icon-control agent-header-icon-enter relative inline-flex size-7 items-center justify-center rounded-md text-fg-muted"
            title="变更"
            aria-label={`变更，${changesCount} 项`}
          >
            <GitCompare size={16} strokeWidth={1.75} />
            <span
              className="absolute -right-0.5 -top-0.5 min-w-[14px] rounded-full bg-accent px-0.5 text-center text-[9px] font-medium leading-[14px] text-accent-fg"
              aria-hidden
            >
              {changesCount > 99 ? "99+" : changesCount}
            </span>
          </button>
        ) : null}
        <button
          type="button"
          data-tour="settings"
          onClick={onOpenSettings}
          className="icon-control inline-flex size-7 items-center justify-center rounded-md text-fg-muted"
          title="设置"
          aria-label="设置"
        >
          <Settings size={16} strokeWidth={1.75} />
        </button>
      </div>
    </header>
  );
}

// ─── 兼容导出：单实例全页（测试 / 简单嵌入） ─────────────────────────────────

interface AgentSessionProps {
  conversationId: string;
  isActive?: boolean;
  onOpenSettings: () => void;
  onOpenChanges?: (path?: string) => void;
}

/**
 * 完整会话页：共享顶栏语义 + 单 pane。
 * 工作台主路径请用 MainArea 的 LRU keep-alive（Header 一次 + 多 pane）。
 */
export function AgentSession({
  conversationId,
  isActive = true,
  onOpenSettings,
  onOpenChanges,
}: AgentSessionProps) {
  return (
    <section className="flex h-full min-h-0 min-w-0 flex-1 flex-col bg-bg">
      {isActive ? (
        <AgentSessionHeader
          onOpenSettings={onOpenSettings}
          onOpenChanges={onOpenChanges}
        />
      ) : null}
      <SessionChatPane
        conversationId={conversationId}
        isActive={isActive}
        onOpenChanges={onOpenChanges}
      />
    </section>
  );
}
