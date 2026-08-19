import type { NotebookAiMessage } from "./types";

const INPUT_ONLY_TOOL_STATES = new Set([
  "call",
  "partial-call",
  "input-streaming",
  "input-available",
]);

function isObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

export function isNotebookAiToolPart(part: unknown): part is {
  type: string;
  state?: string;
  input?: unknown;
  output?: unknown;
  errorText?: string;
  toolCallId?: string;
} {
  return (
    isObject(part) &&
    typeof part.type === "string" &&
    part.type.startsWith("tool-")
  );
}

function shouldDropFinishedToolPart(part: unknown) {
  if (!isNotebookAiToolPart(part)) return false;
  const state = part.state ?? "";
  const hasTerminalPayload =
    state === "output-available" ||
    state === "output-error" ||
    state === "output-denied" ||
    part.output !== undefined ||
    Boolean(part.errorText);

  return INPUT_ONLY_TOOL_STATES.has(state) && !hasTerminalPayload;
}

function hasModelRelevantPart(part: unknown) {
  if (!isObject(part) || typeof part.type !== "string") return false;
  if (part.type === "step-start") return false;
  return true;
}

export function sanitizeNotebookAiMessages(
  messages: NotebookAiMessage[],
): NotebookAiMessage[] {
  const nextMessages: NotebookAiMessage[] = [];
  let changed = false;

  for (const message of messages) {
    const parts = message.parts ?? [];
    const nextParts = parts.filter((part) => !shouldDropFinishedToolPart(part));

    if (nextParts.length !== parts.length) changed = true;

    if (message.role === "assistant" && !nextParts.some(hasModelRelevantPart)) {
      changed = true;
      continue;
    }

    nextMessages.push(
      nextParts === parts
        ? message
        : ({
            ...message,
            parts: nextParts,
          } as NotebookAiMessage),
    );
  }

  return changed ? nextMessages : messages;
}

/**
 * 工具执行痕迹只用于本地 UI，不跨轮回放给模型。
 * Responses 兼容源会严格校验历史 function_call 的 call_id / item_id；这些 ID
 * 经过 UIMessage 持久化和重新组装后不再具备供应商侧关联，回放会导致下一轮
 * 请求直接失败。发送时仅保留用户内容与助手正文；本地持久化消息中的工具卡、
 * 审批和撤回记录保持不变，需要信息时模型会在新一轮重新加载 Skill/读取页面。
 */
export function prepareNotebookAiMessagesForModel(
  messages: NotebookAiMessage[],
): NotebookAiMessage[] {
  const sanitized = sanitizeNotebookAiMessages(messages);
  const nextMessages: NotebookAiMessage[] = [];

  for (const message of sanitized) {
    const parts = message.parts ?? [];
    const nextParts = parts.filter((part) => !isNotebookAiToolPart(part));

    if (message.role === "assistant" && !nextParts.some(hasModelRelevantPart)) {
      continue;
    }

    nextMessages.push(
      nextParts.length === parts.length
        ? message
        : ({ ...message, parts: nextParts } as NotebookAiMessage),
    );
  }

  return nextMessages;
}

/**
 * 图片会作为 data URL 暂存在 AI SDK 的 file part 中。会话写入本地存储前必须
 * 移除二进制内容：它既会放大存储，也会在后续每轮无意间重复上传旧图片。
 * 附件名称和类型保留在 metadata.imageAttachments，供历史记录提示用户。
 */
export function prepareNotebookAiMessagesForPersistence(
  messages: NotebookAiMessage[],
): NotebookAiMessage[] {
  const sanitized = sanitizeNotebookAiMessages(messages);
  let changed = sanitized !== messages;

  const nextMessages = sanitized.map((message) => {
    const parts = message.parts ?? [];
    const nextParts = parts.filter((part) => part.type !== "file");
    if (nextParts.length === parts.length) return message;
    changed = true;
    return {
      ...message,
      parts: nextParts,
    } as NotebookAiMessage;
  });

  return changed ? nextMessages : sanitized;
}
