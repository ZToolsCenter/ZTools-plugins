import { create } from "zustand";
import {
  createJSONStorage,
  persist,
  type StateStorage,
} from "zustand/middleware";
import type { AgentTokenUsage, UsageSource } from "@/lib/agent/usage";
import { gaStateStorage } from "@/stores/settings/gaStorage";
import { useFileChanges } from "@/stores/useFileChanges";

/** 单会话最多保留消息条数 */
const MAX_MESSAGES_PER_CONVERSATION = 80;
/** 最多持久化的会话数 */
const MAX_CONVERSATIONS = 40;
/** 超过此时长未活跃的会话视为归档：再次进入空白新会话 */
export const CONVERSATION_STALE_MS = 6 * 60 * 60 * 1000;

/**
 * 流式输出期间暂缓 chats 持久化：token 级 set 会反复 JSON 序列化整份会话，
 * 在 uTools WebView 上足以卡死 UI。内存态仍即时更新，done/stop 后再落盘。
 */
let streamPersistPaused = false;
let pendingStreamPersist: { name: string; value: string } | null = null;

const agentChatsStorage: StateStorage = {
  getItem(name) {
    return gaStateStorage.getItem(name);
  },
  setItem(name, value) {
    if (streamPersistPaused) {
      pendingStreamPersist = { name, value };
      return;
    }
    gaStateStorage.setItem(name, value);
  },
  removeItem(name) {
    if (
      pendingStreamPersist &&
      pendingStreamPersist.name === name
    ) {
      pendingStreamPersist = null;
    }
    gaStateStorage.removeItem(name);
  },
};

/** 流式开始时 pause=true；结束/中止时 false 并 flush 最后一帧。 */
export function setAgentChatsStreamPersistPaused(paused: boolean) {
  streamPersistPaused = paused;
  if (!paused && pendingStreamPersist) {
    const { name, value } = pendingStreamPersist;
    pendingStreamPersist = null;
    gaStateStorage.setItem(name, value);
  }
}

/** 测试 / 诊断用 */
export function isAgentChatsStreamPersistPaused() {
  return streamPersistPaused;
}

export type AgentMessageRole = "user" | "assistant" | "system";

/** 文本 part */
export interface AgentTextPart {
  type: "text";
  text: string;
}

/** 用户附图 part（无 data: 前缀的 base64） */
export interface AgentImagePart {
  type: "image";
  mediaType: string;
  dataBase64: string;
}

/**
 * 子代理 run 轻量快照（与 runtime SubAgentRunSnapshot 对齐，持久化 steps+summary）。
 * 定义在 store 侧避免 UI 深耦合 agent 内核路径；形状保持兼容。
 */
export type AgentSubRunStep = {
  id: string;
  name: string;
  state?: string;
  input?: unknown;
  output?: unknown;
  errorText?: string;
};

export type AgentSubRunSnapshot = {
  runId: string;
  name: string;
  task: string;
  modelId: string;
  reasoningLevel: "low" | "medium" | "high";
  status: "queued" | "running" | "done" | "error" | "cancelled";
  depth: number;
  startedAt: number;
  endedAt?: number;
  currentTool?: string | null;
  steps: AgentSubRunStep[];
  summary?: string;
  errorText?: string;
  /** 子代理本 run 用量（重载后 SubAgentCard 展示 context / tok/s） */
  usage?: AgentTokenUsage;
  /** 流式中间文本（可选持久化） */
  liveText?: string;
};

/**
 * 工具 part（与 ToolProgressCard / SubAgentCard 对齐）。
 * type 形如 `tool-readFile` / `tool-loadSkill` / `tool-runSubagent`；无真实 tool 时也可渲染。
 */
export interface AgentToolPart {
  type: string;
  toolCallId?: string;
  state?: string;
  input?: unknown;
  output?: unknown;
  errorText?: string;
  /** 子代理进度与摘要（仅 tool-runSubagent / tool-task） */
  subRun?: AgentSubRunSnapshot;
}

export type AgentMessagePart = AgentTextPart | AgentImagePart | AgentToolPart;

export interface AgentMessage {
  id: string;
  role: AgentMessageRole;
  parts: AgentMessagePart[];
  createdAt: number;
  /** 用户气泡展示文案（可与模型侧 content 不同） */
  metadata?: {
    displayText?: string;
  };
}

/** 会话累计 usage（各 turn 相加） */
export type AgentConversationSessionUsage = {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
};

export type AgentConversationUsage = {
  lastTurn: AgentTokenUsage;
  session: AgentConversationSessionUsage;
};

export interface AgentConversation {
  id: string;
  messages: AgentMessage[];
  createdAt: number;
  updatedAt: number;
  /** 可选标题；缺省时取首条用户消息摘要 */
  title?: string;
  /** 绑定工作区 id；null / 缺省 = 未挂载 */
  workspaceId?: string | null;
  /** 最近一轮 + 会话累计 token usage（hybrid） */
  usage?: AgentConversationUsage;
  /**
   * 软归档时间戳；有值表示已归档，侧栏列表默认隐藏。
   * 硬删仍用 deleteConversation。
   */
  archivedAt?: number | null;
  /** 会话来源：用户 / 定时任务 */
  source?: "user" | "automation";
  /** 关联定时任务 id（source=automation 时） */
  automationId?: string | null;
}

/** 是否已软归档 */
export function isConversationArchived(
  conversation: AgentConversation | undefined | null,
): boolean {
  return (
    typeof conversation?.archivedAt === "number" &&
    Number.isFinite(conversation.archivedAt) &&
    conversation.archivedAt > 0
  );
}

interface AgentChatsPersisted {
  activeConversationId: string | null;
  conversations: Record<string, AgentConversation>;
  /** conversationId → 输入草稿（纯文本） */
  composerDrafts: Record<string, string>;
}

export interface AgentChatsState extends AgentChatsPersisted {
  getActiveConversationId: () => string | null;
  getConversationMessages: (conversationId?: string) => AgentMessage[];
  listConversations: () => AgentConversation[];
  listConversationsForWorkspace: (
    workspaceId: string | null,
  ) => AgentConversation[];
  /** 仅返回已归档会话，按 archivedAt 降序 */
  listArchivedConversations: (
    workspaceId?: string | null,
  ) => AgentConversation[];
  createConversation: (options?: {
    workspaceId?: string | null;
    title?: string;
    source?: "user" | "automation";
    automationId?: string | null;
    /** true 时不复用空会话，始终新建（定时任务 fire） */
    forceNew?: boolean;
  }) => string;
  ensureFreshActiveConversation: (options?: {
    now?: number;
    maxAgeMs?: number;
  }) => string;
  ensureConversationForWorkspace: (
    workspaceId: string | null,
    options?: {
      now?: number;
      maxAgeMs?: number;
    },
  ) => string;
  setActiveConversation: (conversationId: string) => void;
  /** 软归档；若为 active 则切到同工作区未归档会话或新建 */
  archiveConversation: (conversationId: string) => void;
  /** 取消软归档 */
  restoreConversation: (conversationId: string) => void;
  /** 硬删除（内部 / 可选）；主 UX 用 archive */
  deleteConversation: (conversationId: string) => void;
  setMessages: (conversationId: string, messages: AgentMessage[]) => void;
  appendMessage: (conversationId: string, message: AgentMessage) => void;
  updateMessage: (
    conversationId: string,
    messageId: string,
    updater: (message: AgentMessage) => AgentMessage,
  ) => void;
  getComposerDraft: (conversationId: string) => string;
  setComposerDraft: (conversationId: string, draft: string) => void;
  clearComposerDraft: (conversationId: string) => void;
  recordTurnUsage: (conversationId: string, usage: AgentTokenUsage) => void;
  getConversationUsage: (
    conversationId: string,
  ) => AgentConversationUsage | null;
}

function createId(prefix: string) {
  if (typeof globalThis.crypto?.randomUUID === "function") {
    return `${prefix}-${globalThis.crypto.randomUUID()}`;
  }
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function normalizeTimestamp(value: unknown, fallback: number) {
  return typeof value === "number" && Number.isFinite(value) && value >= 0
    ? value
    : fallback;
}

function normalizeSubRun(value: unknown): AgentSubRunSnapshot | undefined {
  if (!isRecord(value)) return undefined;
  const runId = typeof value.runId === "string" ? value.runId : "";
  const name = typeof value.name === "string" ? value.name : "子代理";
  const task = typeof value.task === "string" ? value.task : "";
  const modelId = typeof value.modelId === "string" ? value.modelId : "";
  const reasoningLevel =
    value.reasoningLevel === "low" ||
    value.reasoningLevel === "high" ||
    value.reasoningLevel === "medium"
      ? value.reasoningLevel
      : "medium";
  const status =
    value.status === "queued" ||
    value.status === "running" ||
    value.status === "done" ||
    value.status === "error" ||
    value.status === "cancelled"
      ? value.status
      : "done";
  const depth =
    typeof value.depth === "number" && Number.isFinite(value.depth)
      ? value.depth
      : 1;
  const startedAt = normalizeTimestamp(value.startedAt, Date.now());
  const endedAt =
    typeof value.endedAt === "number" && Number.isFinite(value.endedAt)
      ? value.endedAt
      : undefined;
  const currentTool =
    typeof value.currentTool === "string" ? value.currentTool : null;
  const steps: AgentSubRunStep[] = [];
  if (Array.isArray(value.steps)) {
    for (const s of value.steps) {
      if (!isRecord(s) || typeof s.id !== "string") continue;
      steps.push({
        id: s.id,
        name: typeof s.name === "string" ? s.name : "tool",
        state: typeof s.state === "string" ? s.state : undefined,
        input: s.input,
        output: s.output,
        errorText: typeof s.errorText === "string" ? s.errorText : undefined,
      });
    }
  }
  const summary = typeof value.summary === "string" ? value.summary : undefined;
  const errorText =
    typeof value.errorText === "string" ? value.errorText : undefined;
  const usage = normalizeTokenUsage(value.usage) ?? undefined;
  const liveText =
    typeof value.liveText === "string" ? value.liveText : undefined;
  if (!runId && !task && steps.length === 0 && !summary) return undefined;
  return {
    runId: runId || `sub-restored-${startedAt}`,
    name,
    task,
    modelId,
    reasoningLevel,
    status,
    depth,
    startedAt,
    endedAt,
    currentTool,
    steps,
    summary,
    errorText,
    usage,
    liveText,
  };
}

function normalizeParts(value: unknown): AgentMessagePart[] {
  if (!Array.isArray(value)) return [];
  const parts: AgentMessagePart[] = [];
  for (const item of value) {
    if (!isRecord(item) || typeof item.type !== "string") continue;
    if (item.type === "text") {
      parts.push({
        type: "text",
        text: typeof item.text === "string" ? item.text : "",
      });
      continue;
    }
    if (item.type === "image") {
      const dataBase64 =
        typeof item.dataBase64 === "string" ? item.dataBase64 : "";
      if (!dataBase64) continue;
      parts.push({
        type: "image",
        mediaType:
          typeof item.mediaType === "string" && item.mediaType.trim()
            ? item.mediaType.trim()
            : "image/jpeg",
        dataBase64,
      });
      continue;
    }
    if (item.type.startsWith("tool-") || item.type.startsWith("tool")) {
      parts.push({
        type: item.type,
        toolCallId:
          typeof item.toolCallId === "string" ? item.toolCallId : undefined,
        state: typeof item.state === "string" ? item.state : undefined,
        input: item.input,
        output: item.output,
        errorText:
          typeof item.errorText === "string" ? item.errorText : undefined,
        subRun: normalizeSubRun(item.subRun),
      });
    }
  }
  return parts;
}

function normalizeMessage(value: unknown): AgentMessage | null {
  if (!isRecord(value)) return null;
  const id = typeof value.id === "string" ? value.id : createId("msg");
  const role =
    value.role === "user" ||
    value.role === "assistant" ||
    value.role === "system"
      ? value.role
      : null;
  if (!role) return null;
  const createdAt = normalizeTimestamp(value.createdAt, Date.now());
  const parts = normalizeParts(value.parts);
  // 兼容 content 字段
  if (parts.length === 0 && typeof value.content === "string") {
    parts.push({ type: "text", text: value.content });
  }
  const metadata =
    isRecord(value.metadata) &&
    typeof value.metadata.displayText === "string"
      ? { displayText: value.metadata.displayText }
      : undefined;
  return { id, role, parts, createdAt, metadata };
}

function normalizeMessages(value: unknown): AgentMessage[] {
  if (!Array.isArray(value)) return [];
  return value
    .map(normalizeMessage)
    .filter((m): m is AgentMessage => Boolean(m))
    .slice(-MAX_MESSAGES_PER_CONVERSATION);
}

function coerceNonNegInt(value: unknown, fallback = 0): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    return fallback;
  }
  return Math.floor(value);
}

function normalizeUsageSource(value: unknown): UsageSource {
  if (value === "provider" || value === "estimate" || value === "hybrid") {
    return value;
  }
  return "estimate";
}

function normalizeTokenUsage(value: unknown): AgentTokenUsage | null {
  if (!isRecord(value)) return null;
  const promptTokens = coerceNonNegInt(value.promptTokens);
  const completionTokens = coerceNonNegInt(value.completionTokens);
  const totalTokens = coerceNonNegInt(
    value.totalTokens,
    promptTokens + completionTokens,
  );
  const source = normalizeUsageSource(value.source);
  const updatedAt = normalizeTimestamp(value.updatedAt, Date.now());
  const usage: AgentTokenUsage = {
    promptTokens,
    completionTokens,
    totalTokens,
    source,
    updatedAt,
  };
  if (value.cacheReadTokens !== undefined) {
    usage.cacheReadTokens = coerceNonNegInt(value.cacheReadTokens);
  }
  if (value.cacheWriteTokens !== undefined) {
    usage.cacheWriteTokens = coerceNonNegInt(value.cacheWriteTokens);
  }
  if (value.reasoningTokens !== undefined) {
    usage.reasoningTokens = coerceNonNegInt(value.reasoningTokens);
  }
  if (value.systemPromptTokens !== undefined) {
    usage.systemPromptTokens = coerceNonNegInt(value.systemPromptTokens);
  }
  if (value.durationMs !== undefined) {
    usage.durationMs = coerceNonNegInt(value.durationMs);
  }
  if (
    typeof value.tokensPerSecond === "number" &&
    Number.isFinite(value.tokensPerSecond) &&
    value.tokensPerSecond >= 0
  ) {
    usage.tokensPerSecond = value.tokensPerSecond;
  }
  return usage;
}

function emptySessionUsage(): AgentConversationSessionUsage {
  return {
    promptTokens: 0,
    completionTokens: 0,
    totalTokens: 0,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
  };
}

function normalizeSessionUsage(value: unknown): AgentConversationSessionUsage {
  if (!isRecord(value)) return emptySessionUsage();
  return {
    promptTokens: coerceNonNegInt(value.promptTokens),
    completionTokens: coerceNonNegInt(value.completionTokens),
    totalTokens: coerceNonNegInt(value.totalTokens),
    cacheReadTokens: coerceNonNegInt(value.cacheReadTokens),
    cacheWriteTokens: coerceNonNegInt(value.cacheWriteTokens),
  };
}

function normalizeConversationUsage(
  value: unknown,
): AgentConversationUsage | undefined {
  if (!isRecord(value)) return undefined;
  const lastTurn = normalizeTokenUsage(value.lastTurn);
  if (!lastTurn) return undefined;
  return {
    lastTurn,
    session: normalizeSessionUsage(value.session),
  };
}

function normalizeArchivedAt(value: unknown): number | undefined {
  if (value == null) return undefined;
  if (typeof value === "number" && Number.isFinite(value) && value > 0) {
    return value;
  }
  return undefined;
}

function normalizeConversation(
  value: unknown,
  fallbackId: string,
): AgentConversation | null {
  if (!isRecord(value)) return null;
  const id = typeof value.id === "string" ? value.id : fallbackId;
  const now = Date.now();
  const usage = normalizeConversationUsage(value.usage);
  const workspaceId =
    typeof value.workspaceId === "string" ? value.workspaceId : null;
  const archivedAt = normalizeArchivedAt(value.archivedAt);
  const source =
    value.source === "automation" || value.source === "user"
      ? value.source
      : undefined;
  const automationId =
    typeof value.automationId === "string"
      ? value.automationId
      : value.automationId === null
        ? null
        : undefined;
  return {
    id,
    messages: normalizeMessages(value.messages),
    createdAt: normalizeTimestamp(value.createdAt, now),
    updatedAt: normalizeTimestamp(value.updatedAt, now),
    title: typeof value.title === "string" ? value.title : undefined,
    workspaceId,
    ...(usage ? { usage } : {}),
    ...(archivedAt != null ? { archivedAt } : {}),
    ...(source ? { source } : {}),
    ...(automationId !== undefined ? { automationId } : {}),
  };
}

function pruneConversations(
  conversations: Record<string, AgentConversation>,
  protectedId?: string | null,
) {
  const ids = Object.keys(conversations);
  if (ids.length <= MAX_CONVERSATIONS) return conversations;

  const sorted = [...ids].sort((a, b) => {
    const aUpdated = conversations[a]?.updatedAt ?? 0;
    const bUpdated = conversations[b]?.updatedAt ?? 0;
    const diff = aUpdated - bUpdated;
    return diff || a.localeCompare(b);
  });

  const next = { ...conversations };
  let removeCount = ids.length - MAX_CONVERSATIONS;
  for (const id of sorted) {
    if (removeCount <= 0) break;
    if (id === protectedId) continue;
    // 优先淘汰空会话
    if ((next[id]?.messages.length ?? 0) === 0) {
      delete next[id];
      removeCount -= 1;
    }
  }
  for (const id of sorted) {
    if (removeCount <= 0) break;
    if (id === protectedId) continue;
    if (next[id]) {
      delete next[id];
      removeCount -= 1;
    }
  }
  return next;
}

function makeEmptyConversation(
  workspaceId?: string | null,
  extras?: {
    title?: string;
    source?: "user" | "automation";
    automationId?: string | null;
  },
): AgentConversation {
  const now = Date.now();
  const conv: AgentConversation = {
    id: createId("conv"),
    messages: [],
    createdAt: now,
    updatedAt: now,
    workspaceId: workspaceId ?? null,
  };
  if (extras?.title?.trim()) {
    conv.title = extras.title.trim();
  }
  if (extras?.source === "automation" || extras?.source === "user") {
    conv.source = extras.source;
  }
  if (extras?.automationId != null && extras.automationId !== "") {
    conv.automationId = extras.automationId;
  } else if (extras?.source === "automation") {
    conv.automationId = extras.automationId ?? null;
  }
  return conv;
}

function conversationWorkspaceId(
  conversation: AgentConversation | undefined | null,
): string | null {
  return conversation?.workspaceId ?? null;
}

/**
 * 多会话 messages + drafts。
 * 持久化名 `goose-agent-chats` → 物理键 `ga:goose-agent-chats`。
 */
export const useAgentChats = create<AgentChatsState>()(
  persist(
    (set, get) => ({
      activeConversationId: null,
      conversations: {},
      composerDrafts: {},

      getActiveConversationId: () => get().activeConversationId,

      getConversationMessages: (conversationId) => {
        const id = conversationId ?? get().activeConversationId;
        if (!id) return [];
        return get().conversations[id]?.messages ?? [];
      },

      listConversations: () => {
        const { conversations } = get();
        return Object.values(conversations)
          .filter((c) => c.messages.length > 0 && !isConversationArchived(c))
          .sort((a, b) => b.updatedAt - a.updatedAt);
      },

      listConversationsForWorkspace: (workspaceId) => {
        const { conversations } = get();
        return Object.values(conversations)
          .filter(
            (c) =>
              conversationWorkspaceId(c) === workspaceId &&
              c.messages.length > 0 &&
              !isConversationArchived(c),
          )
          .sort((a, b) => b.updatedAt - a.updatedAt);
      },

      listArchivedConversations: (workspaceId) => {
        const { conversations } = get();
        return Object.values(conversations)
          .filter((c) => {
            if (!isConversationArchived(c)) return false;
            // 与主列表一致：空壳不进归档区
            if (c.messages.length === 0) return false;
            if (workspaceId === undefined) return true;
            return conversationWorkspaceId(c) === workspaceId;
          })
          .sort((a, b) => (b.archivedAt ?? 0) - (a.archivedAt ?? 0));
      },

      createConversation: (options) => {
        const ws = options?.workspaceId ?? null;
        const forceNew =
          options?.forceNew === true || options?.source === "automation";
        const extras = {
          title: options?.title,
          source: options?.source,
          automationId: options?.automationId,
        };

        // 定时任务 / forceNew：始终新建，不复用空会话
        if (!forceNew) {
          // 仅复用同 workspaceId 的未归档空会话（且非 automation 标记）
          const { conversations, activeConversationId } = get();
          if (activeConversationId) {
            const active = conversations[activeConversationId];
            if (
              active &&
              !isConversationArchived(active) &&
              active.messages.length === 0 &&
              conversationWorkspaceId(active) === ws &&
              active.source !== "automation"
            ) {
              return activeConversationId;
            }
          }
          const empty = Object.values(conversations).find(
            (c) =>
              !isConversationArchived(c) &&
              c.messages.length === 0 &&
              conversationWorkspaceId(c) === ws &&
              c.source !== "automation",
          );
          if (empty) {
            set({ activeConversationId: empty.id });
            return empty.id;
          }
        }

        const conv = makeEmptyConversation(ws, extras);
        set((state) => ({
          activeConversationId: conv.id,
          conversations: pruneConversations(
            { ...state.conversations, [conv.id]: conv },
            conv.id,
          ),
        }));
        return conv.id;
      },

      ensureFreshActiveConversation: (options) => {
        const now = options?.now ?? Date.now();
        const maxAgeMs = options?.maxAgeMs ?? CONVERSATION_STALE_MS;
        const { activeConversationId, conversations } = get();

        if (activeConversationId) {
          const active = conversations[activeConversationId];
          if (active && !isConversationArchived(active)) {
            if (active.messages.length === 0) return activeConversationId;
            if (now - active.updatedAt <= maxAgeMs) {
              return activeConversationId;
            }
            // 过期：保留在 conversations，新建空白
          }
        }

        return get().createConversation();
      },

      ensureConversationForWorkspace: (workspaceId, options) => {
        const now = options?.now ?? Date.now();
        const maxAgeMs = options?.maxAgeMs ?? CONVERSATION_STALE_MS;
        const { activeConversationId, conversations } = get();

        if (activeConversationId) {
          const active = conversations[activeConversationId];
          if (
            active &&
            !isConversationArchived(active) &&
            conversationWorkspaceId(active) === workspaceId
          ) {
            if (active.messages.length === 0) return activeConversationId;
            if (now - active.updatedAt <= maxAgeMs) {
              return activeConversationId;
            }
            // 过期：新建同工作区空白
            return get().createConversation({ workspaceId });
          }
        }

        // 不把已归档会话当「最近」重新激活
        const recent = Object.values(conversations)
          .filter(
            (c) =>
              conversationWorkspaceId(c) === workspaceId &&
              c.messages.length > 0 &&
              !isConversationArchived(c),
          )
          .sort((a, b) => b.updatedAt - a.updatedAt)[0];
        if (recent) {
          set({ activeConversationId: recent.id });
          return recent.id;
        }

        return get().createConversation({ workspaceId });
      },

      setActiveConversation: (conversationId) => {
        if (!get().conversations[conversationId]) return;
        set({ activeConversationId: conversationId });
      },

      archiveConversation: (conversationId) => {
        set((state) => {
          const existing = state.conversations[conversationId];
          if (!existing || isConversationArchived(existing)) return state;
          const archivedWs = conversationWorkspaceId(existing);
          const nextConversations = {
            ...state.conversations,
            [conversationId]: {
              ...existing,
              archivedAt: Date.now(),
            },
          };

          let nextActive = state.activeConversationId;
          if (nextActive === conversationId) {
            const remaining = Object.values(nextConversations)
              .filter((c) => !isConversationArchived(c))
              .sort((a, b) => b.updatedAt - a.updatedAt);
            const sameWs = remaining.find(
              (c) => conversationWorkspaceId(c) === archivedWs,
            );
            if (sameWs) {
              nextActive = sameWs.id;
            } else if (remaining[0]) {
              nextActive = remaining[0].id;
            } else {
              const fresh = makeEmptyConversation(archivedWs);
              nextConversations[fresh.id] = fresh;
              nextActive = fresh.id;
            }
          }

          return {
            conversations: nextConversations,
            activeConversationId: nextActive,
          };
        });
      },

      restoreConversation: (conversationId) => {
        set((state) => {
          const existing = state.conversations[conversationId];
          if (!existing || !isConversationArchived(existing)) return state;
          const { archivedAt: _ignored, ...rest } = existing;
          void _ignored;
          return {
            conversations: {
              ...state.conversations,
              [conversationId]: rest,
            },
            // 恢复后聚焦该会话（侧栏归档区主路径）
            activeConversationId: conversationId,
          };
        });
      },

      deleteConversation: (conversationId) => {
        set((state) => {
          const deleted = state.conversations[conversationId];
          if (!deleted) return state;
          const deletedWs = conversationWorkspaceId(deleted);
          const nextConversations = { ...state.conversations };
          delete nextConversations[conversationId];
          const nextDrafts = { ...state.composerDrafts };
          delete nextDrafts[conversationId];

          let nextActive = state.activeConversationId;
          if (nextActive === conversationId) {
            // 优先同 workspace 未归档会话
            const remaining = Object.values(nextConversations)
              .filter((c) => !isConversationArchived(c))
              .sort((a, b) => b.updatedAt - a.updatedAt);
            const sameWs = remaining.find(
              (c) => conversationWorkspaceId(c) === deletedWs,
            );
            if (sameWs) {
              nextActive = sameWs.id;
            } else if (remaining[0]) {
              nextActive = remaining[0].id;
            } else {
              const fresh = makeEmptyConversation(deletedWs);
              nextConversations[fresh.id] = fresh;
              nextActive = fresh.id;
            }
          }

          return {
            conversations: nextConversations,
            composerDrafts: nextDrafts,
            activeConversationId: nextActive,
          };
        });
        // 会话级文件变更追踪：随会话删除清理（内存 store）
        useFileChanges.getState().clearConversation(conversationId);
      },

      setMessages: (conversationId, messages) => {
        set((state) => {
          const existing = state.conversations[conversationId];
          if (!existing) return state;
          const now = Date.now();
          return {
            conversations: {
              ...state.conversations,
              [conversationId]: {
                ...existing,
                messages: messages.slice(-MAX_MESSAGES_PER_CONVERSATION),
                updatedAt: now,
              },
            },
          };
        });
      },

      appendMessage: (conversationId, message) => {
        set((state) => {
          const existing = state.conversations[conversationId];
          if (!existing) return state;
          const now = Date.now();
          const messages = [...existing.messages, message].slice(
            -MAX_MESSAGES_PER_CONVERSATION,
          );
          return {
            conversations: {
              ...state.conversations,
              [conversationId]: {
                ...existing,
                messages,
                updatedAt: now,
              },
            },
          };
        });
      },

      updateMessage: (conversationId, messageId, updater) => {
        set((state) => {
          const existing = state.conversations[conversationId];
          if (!existing) return state;
          const idx = existing.messages.findIndex((m) => m.id === messageId);
          if (idx < 0) return state;
          const current = existing.messages[idx];
          if (!current) return state;
          const messages = existing.messages.slice();
          messages[idx] = updater(current);
          return {
            conversations: {
              ...state.conversations,
              [conversationId]: {
                ...existing,
                messages,
                updatedAt: Date.now(),
              },
            },
          };
        });
      },

      getComposerDraft: (conversationId) => {
        return get().composerDrafts[conversationId] ?? "";
      },

      setComposerDraft: (conversationId, draft) => {
        const text = draft ?? "";
        set((state) => {
          if (!text.trim()) {
            if (!(conversationId in state.composerDrafts)) return state;
            const next = { ...state.composerDrafts };
            delete next[conversationId];
            return { composerDrafts: next };
          }
          return {
            composerDrafts: {
              ...state.composerDrafts,
              [conversationId]: text,
            },
          };
        });
      },

      clearComposerDraft: (conversationId) => {
        set((state) => {
          if (!(conversationId in state.composerDrafts)) return state;
          const next = { ...state.composerDrafts };
          delete next[conversationId];
          return { composerDrafts: next };
        });
      },

      recordTurnUsage: (conversationId, usage) => {
        set((state) => {
          const existing = state.conversations[conversationId];
          if (!existing) return state;
          const prevSession =
            existing.usage?.session ?? emptySessionUsage();
          const nextUsage: AgentConversationUsage = {
            lastTurn: usage,
            session: {
              promptTokens:
                prevSession.promptTokens + coerceNonNegInt(usage.promptTokens),
              completionTokens:
                prevSession.completionTokens +
                coerceNonNegInt(usage.completionTokens),
              totalTokens:
                prevSession.totalTokens + coerceNonNegInt(usage.totalTokens),
              cacheReadTokens:
                prevSession.cacheReadTokens +
                coerceNonNegInt(usage.cacheReadTokens),
              cacheWriteTokens:
                prevSession.cacheWriteTokens +
                coerceNonNegInt(usage.cacheWriteTokens),
            },
          };
          return {
            conversations: {
              ...state.conversations,
              [conversationId]: {
                ...existing,
                usage: nextUsage,
                updatedAt: Date.now(),
              },
            },
          };
        });
      },

      getConversationUsage: (conversationId) => {
        return get().conversations[conversationId]?.usage ?? null;
      },
    }),
    {
      name: "goose-agent-chats",
      version: 2,
      storage: createJSONStorage(() => agentChatsStorage),
      partialize: (state) => ({
        activeConversationId: state.activeConversationId,
        conversations: state.conversations,
        composerDrafts: state.composerDrafts,
      }),
      merge: (persisted, current) => {
        const raw =
          persisted && typeof persisted === "object"
            ? (persisted as Partial<AgentChatsPersisted>)
            : {};

        const conversations: Record<string, AgentConversation> = {};
        if (isRecord(raw.conversations)) {
          for (const [id, value] of Object.entries(raw.conversations)) {
            const conv = normalizeConversation(value, id);
            if (conv) conversations[conv.id] = conv;
          }
        }

        const drafts: Record<string, string> = {};
        if (isRecord(raw.composerDrafts)) {
          for (const [id, value] of Object.entries(raw.composerDrafts)) {
            if (typeof value === "string" && value.length > 0) {
              drafts[id] = value;
            }
          }
        }

        let activeConversationId =
          typeof raw.activeConversationId === "string"
            ? raw.activeConversationId
            : null;
        if (activeConversationId && !conversations[activeConversationId]) {
          activeConversationId = null;
        }

        return {
          ...current,
          activeConversationId,
          conversations,
          composerDrafts: drafts,
        };
      },
    },
  ),
);

export function createAgentMessageId(prefix = "msg") {
  return createId(prefix);
}

export function getMessageText(message: AgentMessage): string {
  const textPart = message.parts.find((p) => p.type === "text");
  return textPart && "text" in textPart ? textPart.text : "";
}

/** 消息中的用户附图 parts */
export function getMessageImages(message: AgentMessage): AgentImagePart[] {
  return message.parts.filter(
    (p): p is AgentImagePart =>
      p.type === "image" &&
      typeof (p as AgentImagePart).dataBase64 === "string" &&
      Boolean((p as AgentImagePart).dataBase64),
  );
}

export function getUserDisplayText(message: AgentMessage): string {
  const display = message.metadata?.displayText?.trim();
  if (display) return display;
  return getMessageText(message).trim();
}

/**
 * 会话真实标题：显式 title 或首条用户消息摘要。
 * 无内容时返回 null（顶栏留空，不回落工作区名 /「新会话」）。
 */
export function getConversationTitle(
  conversation: AgentConversation,
  maxLen = 48,
): string | null {
  if (conversation.title?.trim()) return conversation.title.trim();
  const firstUser = conversation.messages.find((m) => m.role === "user");
  if (firstUser) {
    const text = getUserDisplayText(firstUser);
    if (text) {
      return text.length > maxLen ? `${text.slice(0, maxLen)}…` : text;
    }
  }
  return null;
}

/** 侧栏 / 历史列表：有标题用标题，否则「新会话」 */
export function getConversationSummary(conversation: AgentConversation) {
  return getConversationTitle(conversation, 40) ?? "新会话";
}
