import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import { prepareNotebookAiMessagesForPersistence } from "@/lib/notebook-ai/messageUtils";
import type { NotebookAiMessage } from "@/lib/notebook-ai/types";
import { uToolsStorage } from "@/lib/storage";
import type { JSONContent } from "@/types";

/** 每个会话最多保留的消息条数 */
const MAX_MESSAGES_PER_CONVERSATION = 60;
/** 最多持久化聊天记录的笔记本数 */
const MAX_NOTEBOOKS = 20;
/** 超过此时长未活跃的会话视为归档：再次打开 AI 进入空白新会话，旧会话留在历史里 */
export const CONVERSATION_STALE_MS = 6 * 60 * 60 * 1000;
const NOTEBOOK_AI_CHATS_STORAGE_VERSION = 1;

/**
 * 持久化输入草稿时去掉图片 token：File/blob 无法跨进程恢复，
 * 保留残缺 chip 会导致发送时丢图却看似还在。
 */
export function stripComposerDraftImages(
  content: JSONContent | null | undefined,
): JSONContent | null {
  if (!content || typeof content !== "object") return null;
  const blocks = Array.isArray(content.content) ? content.content : null;
  if (!blocks || blocks.length === 0) return null;

  const nextBlocks = blocks
    .map((block: unknown) => {
      if (!block || typeof block !== "object") return null;
      const blockRecord = block as { content?: unknown } & Record<
        string,
        unknown
      >;
      const nodes = Array.isArray(blockRecord.content)
        ? blockRecord.content
        : [];
      const nextNodes = nodes.filter((node: unknown) => {
        if (!node || typeof node !== "object") return false;
        return (node as { type?: string }).type !== "aiImageAttachment";
      });
      if (nextNodes.length === 0) {
        // 保留纯空段落没有意义
        return null;
      }
      return { ...blockRecord, content: nextNodes };
    })
    .filter(Boolean);

  if (nextBlocks.length === 0) return null;
  return { type: "doc", content: nextBlocks };
}

/** 草稿是否包含用户可见内容（文本或引用 chip） */
export function composerDraftHasContent(
  content: JSONContent | null | undefined,
): boolean {
  const cleaned = stripComposerDraftImages(content);
  if (!cleaned?.content?.length) return false;

  for (const block of cleaned.content) {
    if (!block || typeof block !== "object") continue;
    const nodes = Array.isArray((block as { content?: unknown }).content)
      ? ((block as { content: unknown[] }).content ?? [])
      : [];
    for (const node of nodes) {
      if (!node || typeof node !== "object") continue;
      const type = (node as { type?: string }).type;
      if (type === "aiFileReference") return true;
      if (type === "text") {
        const text = (node as { text?: unknown }).text;
        if (typeof text === "string" && text.trim().length > 0) return true;
      }
    }
  }
  return false;
}

export interface NotebookAiConversation {
  id: string;
  messages: NotebookAiMessage[];
  createdAt: number;
  updatedAt: number;
}

export interface NotebookAiNotebookChatState {
  activeConversationId: string | null;
  conversations: Record<string, NotebookAiConversation>;
  /** 用于超过笔记本上限时淘汰最久未使用的记录 */
  updatedAt: number;
}

interface NotebookAiChatsPersistedState {
  /** notebookId -> 多会话状态 */
  chats: Record<string, NotebookAiNotebookChatState>;
  /**
   * 输入框草稿（按笔记本隔离）。
   * 关面板 / 切页 / 退出插件后恢复文本与 @ 引用；图片不持久化。
   */
  composerDrafts: Record<string, JSONContent | null>;
}

interface LegacyNotebookAiChatState {
  messages: NotebookAiMessage[];
  updatedAt: number;
}

export interface NotebookAiChatsState extends NotebookAiChatsPersistedState {
  /** 获取当前激活的会话 ID；尚未创建会话时返回 null */
  getActiveConversationId: (notebookId: string) => string | null;
  /** 获取指定会话的消息；省略 conversationId 时读取当前会话 */
  getConversationMessages: (
    notebookId: string,
    conversationId?: string,
  ) => NotebookAiMessage[];
  /** 获取历史会话，排除空会话并按最近更新时间倒序排列 */
  listConversations: (notebookId: string) => NotebookAiConversation[];
  /** 新建并激活空会话；已有空会话时直接复用 */
  createConversation: (notebookId: string) => string;
  /**
   * 打开 AI 面板时解析当前会话：
   * - 无激活 / 空会话 → 返回（或创建）空会话
   * - 有消息且最近活跃未超过 maxAgeMs → 继续该会话
   * - 有消息但已过期 → 归档（留在历史），新建空白会话
   */
  ensureFreshActiveConversation: (
    notebookId: string,
    options?: { now?: number; maxAgeMs?: number },
  ) => string;
  /** 激活已存在的会话；会话不存在时不修改状态 */
  setActiveConversation: (notebookId: string, conversationId: string) => void;
  /**
   * 删除指定会话；删除激活会话时回退到剩余会话中最新的一条。
   * 笔记本下已无会话且无输入草稿时，一并移除该笔记本的记录。
   */
  deleteConversation: (notebookId: string, conversationId: string) => void;
  /** 更新指定会话的消息 */
  setMessages: (
    notebookId: string,
    conversationId: string,
    messages: NotebookAiMessage[],
  ) => void;
  /** 清空全部笔记本会话记录（数据重置/整包恢复使用） */
  clearAllChats: () => void;
  /** 读取指定笔记本的输入草稿（已去掉无法恢复的图片 token） */
  getComposerDraft: (notebookId: string) => JSONContent | null;
  /** 写入输入草稿；传 null 或空内容则清除 */
  setComposerDraft: (
    notebookId: string,
    content: JSONContent | null | undefined,
  ) => void;
  /** 清除指定笔记本的输入草稿 */
  clearComposerDraft: (notebookId: string) => void;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function normalizeTimestamp(value: unknown, fallback: number) {
  return typeof value === "number" && Number.isFinite(value) && value >= 0
    ? value
    : fallback;
}

function normalizeMessages(value: unknown) {
  if (!Array.isArray(value)) return [];
  return prepareNotebookAiMessagesForPersistence(
    value as NotebookAiMessage[],
  ).slice(-MAX_MESSAGES_PER_CONVERSATION);
}

function createConversationId() {
  if (typeof globalThis.crypto?.randomUUID === "function") {
    return globalThis.crypto.randomUUID();
  }
  return `conversation-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function pruneNotebookChats(
  chats: Record<string, NotebookAiNotebookChatState>,
  protectedNotebookId?: string,
) {
  const notebookIds = Object.keys(chats);
  if (notebookIds.length <= MAX_NOTEBOOKS) return chats;

  const hasRealHistory = (notebookId: string) =>
    Object.values(chats[notebookId].conversations).some(
      (conversation) => conversation.messages.length > 0,
    );
  let removeCount = notebookIds.length - MAX_NOTEBOOKS;
  const nextChats = { ...chats };
  const oldestFirst = (left: string, right: string) => {
    const updatedAtDifference = chats[left].updatedAt - chats[right].updatedAt;
    return updatedAtDifference || left.localeCompare(right);
  };

  // 空会话只是面板的临时占位，不能为了它淘汰已有真实历史。
  const emptyCandidates = notebookIds
    .filter((notebookId) => notebookId !== protectedNotebookId)
    .filter((notebookId) => !hasRealHistory(notebookId))
    .sort(oldestFirst);

  for (const notebookId of emptyCandidates.slice(0, removeCount)) {
    delete nextChats[notebookId];
    removeCount -= 1;
  }

  if (removeCount <= 0) return nextChats;
  if (
    protectedNotebookId &&
    nextChats[protectedNotebookId] &&
    !hasRealHistory(protectedNotebookId)
  ) {
    return nextChats;
  }

  const historyCandidates = Object.keys(nextChats)
    .filter((notebookId) => notebookId !== protectedNotebookId)
    .filter((notebookId) => hasRealHistory(notebookId))
    .sort(oldestFirst);

  for (const notebookId of historyCandidates.slice(0, removeCount)) {
    delete nextChats[notebookId];
  }
  return nextChats;
}

function normalizeConversation(
  conversationId: string,
  value: unknown,
): NotebookAiConversation | null {
  if (!isRecord(value)) return null;

  const messages = normalizeMessages(value.messages);
  const fallbackTimestamp = Date.now();
  const updatedAt = normalizeTimestamp(value.updatedAt, fallbackTimestamp);
  const createdAt = normalizeTimestamp(value.createdAt, updatedAt);

  return {
    id: typeof value.id === "string" && value.id ? value.id : conversationId,
    messages,
    createdAt,
    updatedAt,
  };
}

function normalizeNotebookChatState(
  value: Record<string, unknown>,
): NotebookAiNotebookChatState {
  const conversations = isRecord(value.conversations)
    ? Object.fromEntries(
        Object.entries(value.conversations).flatMap(
          ([conversationId, item]) => {
            const conversation = normalizeConversation(conversationId, item);
            return conversation ? [[conversation.id, conversation]] : [];
          },
        ),
      )
    : {};
  const conversationList = Object.values(conversations);
  const newestConversation = [...conversationList].sort(
    (left, right) => right.updatedAt - left.updatedAt,
  )[0];
  const requestedActiveId =
    typeof value.activeConversationId === "string"
      ? value.activeConversationId
      : null;
  const activeConversationId =
    requestedActiveId && conversations[requestedActiveId]
      ? requestedActiveId
      : (newestConversation?.id ?? null);
  const newestUpdatedAt = newestConversation?.updatedAt ?? 0;

  return {
    activeConversationId,
    conversations,
    updatedAt: Math.max(
      normalizeTimestamp(value.updatedAt, newestUpdatedAt),
      newestUpdatedAt,
    ),
  };
}

function migrateLegacyNotebookChatState(
  notebookId: string,
  value: LegacyNotebookAiChatState,
): NotebookAiNotebookChatState {
  const updatedAt = normalizeTimestamp(value.updatedAt, Date.now());
  const conversationId = `legacy-${notebookId}`;

  return {
    activeConversationId: conversationId,
    conversations: {
      [conversationId]: {
        id: conversationId,
        messages: normalizeMessages(value.messages),
        createdAt: updatedAt,
        updatedAt,
      },
    },
    updatedAt,
  };
}

function normalizeComposerDrafts(
  value: unknown,
): Record<string, JSONContent | null> {
  if (!isRecord(value)) return {};
  const next: Record<string, JSONContent | null> = {};
  for (const [notebookId, draft] of Object.entries(value)) {
    if (!notebookId) continue;
    const cleaned = stripComposerDraftImages(
      draft as JSONContent | null | undefined,
    );
    if (cleaned) next[notebookId] = cleaned;
  }
  return next;
}

/** Zustand persist v0（单会话）到 v1（多会话）的兼容迁移。 */
export function migrateNotebookAiChatsState(
  persistedState: unknown,
): NotebookAiChatsPersistedState {
  if (!isRecord(persistedState) || !isRecord(persistedState.chats)) {
    return { chats: {}, composerDrafts: {} };
  }

  const chats = Object.fromEntries(
    Object.entries(persistedState.chats).flatMap(([notebookId, value]) => {
      if (!isRecord(value)) return [];

      const notebookChatState = isRecord(value.conversations)
        ? normalizeNotebookChatState(value)
        : migrateLegacyNotebookChatState(
            notebookId,
            value as unknown as LegacyNotebookAiChatState,
          );
      return [[notebookId, notebookChatState]];
    }),
  );

  return {
    chats: pruneNotebookChats(chats),
    composerDrafts: normalizeComposerDrafts(persistedState.composerDrafts),
  };
}

export const useNotebookAiChats = create<NotebookAiChatsState>()(
  persist(
    (set, get) => ({
      chats: {},
      composerDrafts: {},

      getActiveConversationId: (notebookId) => {
        return get().chats[notebookId]?.activeConversationId ?? null;
      },

      getConversationMessages: (notebookId, conversationId) => {
        const notebookChat = get().chats[notebookId];
        const resolvedConversationId =
          conversationId ?? notebookChat?.activeConversationId;
        if (!resolvedConversationId) return [];

        return normalizeMessages(
          notebookChat?.conversations[resolvedConversationId]?.messages,
        );
      },

      listConversations: (notebookId) => {
        const conversations = Object.values(
          get().chats[notebookId]?.conversations ?? {},
        );

        return conversations
          .map((conversation) => ({
            ...conversation,
            messages: normalizeMessages(conversation.messages),
          }))
          .filter((conversation) => conversation.messages.length > 0)
          .sort((left, right) => right.updatedAt - left.updatedAt);
      },

      createConversation: (notebookId) => {
        let conversationId = "";

        set((state) => {
          const now = Date.now();
          const currentNotebookChat = state.chats[notebookId];
          const emptyConversation = Object.values(
            currentNotebookChat?.conversations ?? {},
          )
            .filter((conversation) => conversation.messages.length === 0)
            .sort((left, right) => right.updatedAt - left.updatedAt)[0];

          if (emptyConversation) {
            conversationId = emptyConversation.id;
            return {
              chats: pruneNotebookChats(
                {
                  ...state.chats,
                  [notebookId]: {
                    ...currentNotebookChat,
                    activeConversationId: conversationId,
                    updatedAt: now,
                  },
                },
                notebookId,
              ),
            };
          }

          conversationId = createConversationId();
          const conversation: NotebookAiConversation = {
            id: conversationId,
            messages: [],
            createdAt: now,
            updatedAt: now,
          };
          const notebookChat: NotebookAiNotebookChatState = {
            activeConversationId: conversationId,
            conversations: {
              ...(currentNotebookChat?.conversations ?? {}),
              [conversationId]: conversation,
            },
            updatedAt: now,
          };

          return {
            chats: pruneNotebookChats(
              {
                ...state.chats,
                [notebookId]: notebookChat,
              },
              notebookId,
            ),
          };
        });

        return conversationId;
      },

      ensureFreshActiveConversation: (notebookId, options) => {
        const now = options?.now ?? Date.now();
        const maxAgeMs = options?.maxAgeMs ?? CONVERSATION_STALE_MS;
        const notebookChat = get().chats[notebookId];
        const activeId = notebookChat?.activeConversationId ?? null;
        const activeConversation = activeId
          ? notebookChat?.conversations[activeId]
          : undefined;

        // 尚无会话，或当前就是空会话：直接落到可复用的空会话。
        if (!activeConversation || activeConversation.messages.length === 0) {
          return get().createConversation(notebookId);
        }

        // 以笔记本级 last touch 为准（发消息 / 切历史 / 新建 / 打开都会刷新），
        // 避免「只点开历史」后马上被 6 小时规则误归档。
        const lastActiveAt = Math.max(
          notebookChat?.updatedAt ?? 0,
          activeConversation.updatedAt,
        );
        if (now - lastActiveAt < maxAgeMs) {
          // 恢复未过期会话时刷新 touch，把 6 小时窗口从「最近一次打开」起算。
          get().setActiveConversation(notebookId, activeConversation.id);
          return activeConversation.id;
        }

        // 过期：旧会话保留在 conversations 里供历史列表读取，激活新空白会话。
        return get().createConversation(notebookId);
      },

      setActiveConversation: (notebookId, conversationId) => {
        set((state) => {
          const notebookChat = state.chats[notebookId];
          const conversation = notebookChat?.conversations[conversationId];
          if (!notebookChat || !conversation) return state;

          const now = Date.now();
          // 已是当前会话时仍刷新 touch 时间，表示用户再次打开/继续该会话。
          if (notebookChat.activeConversationId === conversationId) {
            return {
              chats: {
                ...state.chats,
                [notebookId]: {
                  ...notebookChat,
                  conversations: {
                    ...notebookChat.conversations,
                    [conversationId]: {
                      ...conversation,
                      updatedAt: now,
                    },
                  },
                  updatedAt: now,
                },
              },
            };
          }

          return {
            chats: {
              ...state.chats,
              [notebookId]: {
                ...notebookChat,
                activeConversationId: conversationId,
                conversations: {
                  ...notebookChat.conversations,
                  [conversationId]: {
                    ...conversation,
                    updatedAt: now,
                  },
                },
                updatedAt: now,
              },
            },
          };
        });
      },

      deleteConversation: (notebookId, conversationId) => {
        set((state) => {
          const notebookChat = state.chats[notebookId];
          if (!notebookChat?.conversations[conversationId]) return state;

          const now = Date.now();
          const { [conversationId]: _removed, ...remainingConversations } =
            notebookChat.conversations;
          const remainingList = Object.values(remainingConversations);
          const newestRemaining = [...remainingList].sort(
            (left, right) => right.updatedAt - left.updatedAt,
          )[0];
          const nextActiveConversationId =
            notebookChat.activeConversationId === conversationId
              ? (newestRemaining?.id ?? null)
              : notebookChat.activeConversationId;

          const hasDraft = Boolean(
            composerDraftHasContent(state.composerDrafts[notebookId]),
          );
          if (remainingList.length === 0 && !hasDraft) {
            // 无会话且无草稿：连同笔记本记录一起移除，保持 LRU 语义干净
            const { [notebookId]: _removedChat, ...restChats } = state.chats;
            return { chats: restChats };
          }

          return {
            chats: {
              ...state.chats,
              [notebookId]: {
                activeConversationId: nextActiveConversationId,
                conversations: remainingConversations,
                updatedAt: now,
              },
            },
          };
        });
      },

      setMessages: (notebookId, conversationId, messages) => {
        set((state) => {
          const now = Date.now();
          const currentNotebookChat = state.chats[notebookId];
          const currentConversation =
            currentNotebookChat?.conversations[conversationId];
          const conversation: NotebookAiConversation = {
            id: conversationId,
            messages: normalizeMessages(messages),
            createdAt: currentConversation?.createdAt ?? now,
            updatedAt: now,
          };
          const notebookChat: NotebookAiNotebookChatState = {
            activeConversationId:
              currentNotebookChat?.activeConversationId ?? conversationId,
            conversations: {
              ...(currentNotebookChat?.conversations ?? {}),
              [conversationId]: conversation,
            },
            updatedAt: now,
          };

          return {
            chats: pruneNotebookChats(
              {
                ...state.chats,
                [notebookId]: notebookChat,
              },
              notebookId,
            ),
          };
        });
      },

      clearAllChats: () => set({ chats: {}, composerDrafts: {} }),

      getComposerDraft: (notebookId) => {
        return stripComposerDraftImages(get().composerDrafts[notebookId]);
      },

      setComposerDraft: (notebookId, content) => {
        const cleaned = stripComposerDraftImages(content);
        set((state) => {
          const previous = state.composerDrafts[notebookId] ?? null;
          if (!cleaned) {
            if (previous == null) return state;
            const { [notebookId]: _removed, ...rest } = state.composerDrafts;
            return { composerDrafts: rest };
          }
          if (previous === cleaned) return state;
          return {
            composerDrafts: {
              ...state.composerDrafts,
              [notebookId]: cleaned,
            },
          };
        });
      },

      clearComposerDraft: (notebookId) => {
        set((state) => {
          if (!(notebookId in state.composerDrafts)) return state;
          const { [notebookId]: _removed, ...rest } = state.composerDrafts;
          return { composerDrafts: rest };
        });
      },
    }),
    {
      name: "goose-note-notebook-ai-chats",
      version: NOTEBOOK_AI_CHATS_STORAGE_VERSION,
      storage: createJSONStorage(() => uToolsStorage),
      skipHydration: true,
      migrate: (persistedState: unknown) =>
        migrateNotebookAiChatsState(persistedState),
      // 只持久化数据字段，不持久化函数
      partialize: (state) => ({
        chats: state.chats,
        composerDrafts: state.composerDrafts,
      }),
    },
  ),
);
