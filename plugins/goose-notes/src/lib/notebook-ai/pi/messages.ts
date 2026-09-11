import type {
  Message,
  TextContent,
  ImageContent,
  ToolCall,
} from "@earendil-works/pi-ai";
import type { AgentMessage } from "@earendil-works/pi-agent-core";
import type { NotebookAiMessage } from "../types";
import { isNotebookAiToolPart } from "../messageUtils";
import { isNotebookSkillId, type NotebookSkillId } from "../skillIds";

/**
 * 每轮 PI transport 都会新建 Agent。历史中已成功 loadSkill 的能力必须同步
 * 恢复到新的 agentContext，否则模型会根据历史直接调用已解锁工具，但当前
 * 工具表仍只有 loadSkill，最终以 unknown tool 结束整轮请求。
 */
export function collectLoadedSkillIds(
  messages: NotebookAiMessage[],
): NotebookSkillId[] {
  const loaded = new Set<NotebookSkillId>();
  for (const message of messages) {
    if (message.role !== "assistant") continue;
    for (const part of message.parts ?? []) {
      if (
        !isNotebookAiToolPart(part) ||
        part.type !== "tool-loadSkill" ||
        part.state !== "output-available"
      ) {
        continue;
      }
      const input =
        part.input && typeof part.input === "object"
          ? (part.input as Record<string, unknown>)
          : null;
      const output =
        part.output && typeof part.output === "object"
          ? (part.output as Record<string, unknown>)
          : null;
      const skill = input?.skill;
      if (isNotebookSkillId(skill) && output?.supported !== false) {
        loaded.add(skill);
      }
    }
  }
  return [...loaded];
}

function extractTextFromParts(
  parts: NotebookAiMessage["parts"] | undefined,
): string {
  if (!parts?.length) return "";
  const chunks: string[] = [];
  for (const part of parts) {
    if (
      part &&
      typeof part === "object" &&
      "type" in part &&
      part.type === "text" &&
      "text" in part &&
      typeof part.text === "string"
    ) {
      chunks.push(part.text);
    }
  }
  return chunks.join("\n").trim();
}

function extractImagesFromParts(
  parts: NotebookAiMessage["parts"] | undefined,
): ImageContent[] {
  if (!parts?.length) return [];
  const images: ImageContent[] = [];
  for (const part of parts) {
    if (!part || typeof part !== "object" || !("type" in part)) continue;
    if (part.type !== "file") continue;
    const mediaType =
      "mediaType" in part && typeof part.mediaType === "string"
        ? part.mediaType
        : "";
    if (!mediaType.startsWith("image/")) continue;
    const url = "url" in part && typeof part.url === "string" ? part.url : "";
    if (!url.startsWith("data:")) continue;
    const comma = url.indexOf(",");
    if (comma < 0) continue;
    const data = url.slice(comma + 1);
    if (!data) continue;
    images.push({ type: "image", data, mimeType: mediaType });
  }
  return images;
}

/**
 * 将持久化/UI 消息历史转为 Pi AgentMessage 列表。
 * 不包含最后一条尚未提交给模型的用户消息时由调用方处理。
 */
export function uiMessagesToAgentMessages(
  messages: NotebookAiMessage[],
): AgentMessage[] {
  const out: AgentMessage[] = [];

  for (const message of messages) {
    if (message.role === "user") {
      const text = extractTextFromParts(message.parts);
      const images = extractImagesFromParts(message.parts);
      if (!text && images.length === 0) continue;
      if (images.length === 0) {
        out.push({
          role: "user",
          content: text,
          timestamp: Date.now(),
        });
      } else {
        const content: (TextContent | ImageContent)[] = [];
        if (text) content.push({ type: "text", text });
        content.push(...images);
        out.push({
          role: "user",
          content,
          timestamp: Date.now(),
        });
      }
      continue;
    }

    if (message.role === "assistant") {
      const content: Array<TextContent | ToolCall> = [];
      const toolResults: AgentMessage[] = [];

      for (const part of message.parts ?? []) {
        if (
          part &&
          typeof part === "object" &&
          "type" in part &&
          part.type === "text" &&
          "text" in part &&
          typeof part.text === "string" &&
          part.text
        ) {
          content.push({ type: "text", text: part.text });
          continue;
        }

        if (!isNotebookAiToolPart(part)) continue;
        const toolName = part.type.slice("tool-".length);
        const toolCallId =
          typeof part.toolCallId === "string" && part.toolCallId
            ? part.toolCallId
            : `tool-${toolName}-${out.length}`;
        const input =
          part.input && typeof part.input === "object" ? part.input : {};
        content.push({
          type: "toolCall",
          id: toolCallId,
          name: toolName,
          arguments: input as Record<string, unknown>,
        });

        const state = part.state ?? "";
        if (
          state === "output-available" ||
          state === "output-error" ||
          part.output !== undefined ||
          part.errorText
        ) {
          const isError = state === "output-error" || Boolean(part.errorText);
          const details = isError
            ? { error: part.errorText ?? "tool error" }
            : part.output;
          toolResults.push({
            role: "toolResult",
            toolCallId,
            toolName,
            content: [
              {
                type: "text",
                text:
                  typeof details === "string"
                    ? details
                    : JSON.stringify(details ?? null),
              },
            ],
            details,
            isError,
            timestamp: Date.now(),
          });
        }
      }

      if (content.length === 0 && toolResults.length === 0) continue;

      out.push({
        role: "assistant",
        content,
        api: "openai-completions",
        provider: "goose-custom",
        model: "history",
        usage: {
          input: 0,
          output: 0,
          cacheRead: 0,
          cacheWrite: 0,
          totalTokens: 0,
          cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
        },
        stopReason: "stop",
        timestamp: Date.now(),
      } as Message);

      for (const tr of toolResults) {
        out.push(tr);
      }
    }
  }

  return out;
}

/** 从最后一条用户消息取出可 prompt 的文本与图片。 */
export function extractLastUserPrompt(messages: NotebookAiMessage[]): {
  text: string;
  images: ImageContent[];
} | null {
  for (let i = messages.length - 1; i >= 0; i--) {
    const message = messages[i];
    if (message?.role !== "user") continue;
    const text = extractTextFromParts(message.parts);
    const images = extractImagesFromParts(message.parts);
    if (!text && images.length === 0) return null;
    return { text: text || "（见附件）", images };
  }
  return null;
}
