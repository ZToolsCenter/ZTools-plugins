/**
 * 将 agent / AIMessage 风格的 content 转为各协议请求 body 形态。
 * dataBase64 约定无 data: 前缀。
 */

import type { AIContentPart, AIMessage } from "./types";

export function toImageDataUrl(mediaType: string, dataBase64: string): string {
  const mt = mediaType.trim() || "image/png";
  const data = dataBase64.replace(/^data:[^;]+;base64,/, "");
  return `data:${mt};base64,${data}`;
}

export function contentToPlainText(
  content: string | AIContentPart[] | undefined,
): string {
  if (content == null) return "";
  if (typeof content === "string") return content;
  return content
    .filter((p): p is Extract<AIContentPart, { type: "text" }> => p.type === "text")
    .map((p) => p.text)
    .join("\n");
}

/** 无 text 且无 image 才视为空；仅 image 应保留。 */
export function hasRenderableContent(
  content: string | AIContentPart[] | undefined,
): boolean {
  if (content == null) return false;
  if (typeof content === "string") return content.trim() !== "";
  return content.some(
    (p) =>
      (p.type === "text" && p.text.trim() !== "") ||
      (p.type === "image" && Boolean(p.dataBase64?.trim())),
  );
}

function normalizeParts(content: AIContentPart[]): AIContentPart[] {
  return content.filter(
    (p) =>
      (p.type === "text" && p.text.trim() !== "") ||
      (p.type === "image" && Boolean(p.dataBase64?.trim())),
  );
}

/** OpenAI Chat Completions user content parts */
export type OpenAIChatContentPart =
  | { type: "text"; text: string }
  | { type: "image_url"; image_url: { url: string } };

export function toOpenAIChatContent(
  content: string | AIContentPart[] | undefined,
): string | OpenAIChatContentPart[] {
  if (content == null) return "";
  if (typeof content === "string") return content;
  const parts = normalizeParts(content);
  if (parts.length === 0) return "";
  if (parts.length === 1 && parts[0]!.type === "text") {
    return parts[0]!.text;
  }
  const out: OpenAIChatContentPart[] = [];
  for (const p of parts) {
    if (p.type === "text") {
      out.push({ type: "text", text: p.text });
    } else {
      out.push({
        type: "image_url",
        image_url: { url: toImageDataUrl(p.mediaType, p.dataBase64) },
      });
    }
  }
  return out;
}

/** OpenAI Responses input content parts */
export type ResponsesInputContentPart =
  | { type: "input_text"; text: string }
  | { type: "input_image"; image_url: string };

export function toResponsesInputContent(
  content: string | AIContentPart[] | undefined,
): string | ResponsesInputContentPart[] {
  if (content == null) return "";
  if (typeof content === "string") return content;
  const parts = normalizeParts(content);
  if (parts.length === 0) return "";
  if (parts.length === 1 && parts[0]!.type === "text") {
    return parts[0]!.text;
  }
  const out: ResponsesInputContentPart[] = [];
  for (const p of parts) {
    if (p.type === "text") {
      out.push({ type: "input_text", text: p.text });
    } else {
      out.push({
        type: "input_image",
        image_url: toImageDataUrl(p.mediaType, p.dataBase64),
      });
    }
  }
  return out;
}

/** Anthropic Messages content blocks */
export type ClaudeContentBlock =
  | { type: "text"; text: string }
  | {
      type: "image";
      source: {
        type: "base64";
        media_type: string;
        data: string;
      };
    };

export function toClaudeContent(
  content: string | AIContentPart[] | undefined,
): string | ClaudeContentBlock[] {
  if (content == null) return "";
  if (typeof content === "string") return content;
  const parts = normalizeParts(content);
  if (parts.length === 0) return "";
  if (parts.length === 1 && parts[0]!.type === "text") {
    return parts[0]!.text;
  }
  // Anthropic 惯例：image 在前、text 在后
  const images: ClaudeContentBlock[] = [];
  const texts: ClaudeContentBlock[] = [];
  for (const p of parts) {
    if (p.type === "image") {
      const data = p.dataBase64.replace(/^data:[^;]+;base64,/, "");
      images.push({
        type: "image",
        source: {
          type: "base64",
          media_type: p.mediaType.trim() || "image/png",
          data,
        },
      });
    } else {
      texts.push({ type: "text", text: p.text });
    }
  }
  return [...images, ...texts];
}

/** Chat Completions：把 AIMessage 列表编成 wire 形态（system 始终纯文本）。 */
export function encodeMessagesForOpenAIChat(
  messages: AIMessage[],
): Array<{ role: string; content: string | OpenAIChatContentPart[] }> {
  return messages.map((m) => {
    if (m.role === "system") {
      return { role: "system", content: contentToPlainText(m.content) };
    }
    return { role: m.role, content: toOpenAIChatContent(m.content) };
  });
}

/** Responses 纯文本路径：system 进 instructions，其余转 input。 */
export function encodeMessagesForResponsesInput(messages: AIMessage[]): {
  instructions: string;
  input: Array<{ role: string; content: string | ResponsesInputContentPart[] }>;
} {
  const systemParts: string[] = [];
  const input: Array<{
    role: string;
    content: string | ResponsesInputContentPart[];
  }> = [];
  for (const m of messages) {
    if (m.role === "system") {
      const t = contentToPlainText(m.content).trim();
      if (t) systemParts.push(t);
      continue;
    }
    if (m.role === "user" || m.role === "assistant") {
      input.push({
        role: m.role,
        content: toResponsesInputContent(m.content),
      });
    }
  }
  return { instructions: systemParts.join("\n"), input };
}

/** Claude：system 拆出，其余转 content blocks。 */
export function encodeMessagesForClaude(messages: AIMessage[]): {
  systemInstruction: string;
  claudeMessages: Array<{
    role: "user" | "assistant";
    content: string | ClaudeContentBlock[];
  }>;
} {
  const systemInstruction = messages
    .filter((m) => m.role === "system")
    .map((m) => contentToPlainText(m.content))
    .filter((t) => t.trim() !== "")
    .join("\n");
  const claudeMessages = messages
    .filter(
      (m): m is AIMessage & { role: "user" | "assistant" } =>
        m.role === "user" || m.role === "assistant",
    )
    .map((m) => ({
      role: m.role,
      content: toClaudeContent(m.content),
    }));
  return { systemInstruction, claudeMessages };
}
