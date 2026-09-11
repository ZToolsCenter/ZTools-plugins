import type { UIMessage, InferUITools } from "ai";
import type {
  AiFileReferenceAttrs,
  AiSkillCommandAttrs,
} from "@/components/editor/ai/composer/referenceLookup";
import type { NotebookAiTools } from "./tools";
import type { NotebookSkillId } from "./skills";

export type NotebookAiContextMode = "structure-summary" | "full-text";

export type NotebookAiContextBudgetTier =
  | "summary-standard"
  | "full-text-standard";

/** 不包含笔记正文，可安全持久化用于诊断上下文成本与读取失败。 */
export interface NotebookAiContextDiagnostics {
  uniqueReferenceCount: number;
  occurrenceCount: number;
  summaryCount: number;
  fullTextCount: number;
  failedCount: number;
  contextCharacters: number;
  budgetTier: NotebookAiContextBudgetTier;
  characterBudget: number;
  /** 图片由实际发送附件的调用方补充或覆盖。 */
  imageCount?: number;
}

export interface NotebookAiMessageMetadata {
  displayText?: string;
  references?: AiFileReferenceAttrs[];
  /** 本轮用户消息中显式调用的本地 Skill（chip 顺序）。 */
  skills?: AiSkillCommandAttrs[];
  implicitPage?: AiFileReferenceAttrs;
  diagnostics?: NotebookAiContextDiagnostics;
  imageAttachments?: Array<{
    filename: string;
    mediaType: string;
  }>;
  /** 消息创建时间（毫秒时间戳），用于聊天时间分隔条 */
  createdAt?: number;
}

/** 序列化进持久化存储的单条消息格式 */
export type NotebookAiMessage = UIMessage<
  NotebookAiMessageMetadata,
  never,
  InferUITools<NotebookAiTools>
>;

export interface NotebookAiAgentContext {
  notebookId: string;
  currentPageId?: string | null;
  loadedSkills: Set<NotebookSkillId>;
}

/** 单条 AI 会话状态 */
export interface NotebookAiConversationState {
  id: string;
  messages: NotebookAiMessage[];
  createdAt: number;
  updatedAt: number;
}

/** 单个笔记本的多会话状态 */
export interface NotebookAiChatState {
  activeConversationId: string | null;
  conversations: Record<string, NotebookAiConversationState>;
  updatedAt: number;
}

/** 持久化存储结构 */
export interface NotebookAiChatsPersistedState {
  /** notebookId -> 会话状态 */
  chats: Record<string, NotebookAiChatState>;
}

/** liveWriter 调用上下文 */
export interface LiveWriterContext {
  /** 当前绑定的笔记本 ID */
  notebookId: string;
  /** 本轮发送时绑定的当前页签页面 ID */
  currentPageId?: string | null;
}
