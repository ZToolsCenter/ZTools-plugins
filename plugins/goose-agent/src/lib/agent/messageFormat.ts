import type {
  AgentChatContentPart,
  AgentChatMessage,
  OpenAIToolCall,
} from "./types";
import type { AIContentPart, AIMessage } from "@/lib/ai-provider";
import {
  contentToPlainText,
  hasRenderableContent,
  toOpenAIChatContent,
  type OpenAIChatContentPart,
} from "../ai-provider/multimodal";

export type { AgentChatContentPart };

/** content 是否有可发送内容（无 text 且无 image 才丢）。 */
export function messageHasContent(
  content: string | AgentChatContentPart[] | undefined,
): boolean {
  return hasRenderableContent(content as string | AIContentPart[] | undefined);
}

/**
 * 规范化出站 content：string 原样；array 过滤空 part。
 * 仅 image 保留；全空返回 ""。
 */
export function normalizeOutgoingContent(
  content: string | AgentChatContentPart[],
): string | AgentChatContentPart[] {
  if (typeof content === "string") return content;
  const parts = content.filter(
    (p) =>
      (p.type === "text" && p.text.trim() !== "") ||
      (p.type === "image" && Boolean(p.dataBase64?.trim())),
  );
  if (parts.length === 0) return "";
  if (parts.length === 1 && parts[0]!.type === "text") {
    return parts[0]!.text;
  }
  return parts;
}

function toAIContent(
  content: string | AgentChatContentPart[],
): string | AIContentPart[] {
  const normalized = normalizeOutgoingContent(content);
  if (typeof normalized === "string") return normalized;
  return normalized.map((p) =>
    p.type === "text"
      ? { type: "text" as const, text: p.text }
      : {
          type: "image" as const,
          mediaType: p.mediaType,
          dataBase64: p.dataBase64,
        },
  );
}

/** 会话消息 → ai-provider AIMessage（纯文本 / 多模态路径）。 */
export function toAIMessages(messages: AgentChatMessage[]): AIMessage[] {
  return messages
    .filter(
      (m) =>
        (m.role === "system" ||
          m.role === "user" ||
          m.role === "assistant") &&
        messageHasContent(m.content),
    )
    .map((m) => {
      // system 始终压成纯文本
      if (m.role === "system") {
        return {
          role: m.role,
          content: contentToPlainText(
            m.content as string | AIContentPart[],
          ),
        };
      }
      return {
        role: m.role,
        content: toAIContent(m.content),
      };
    });
}

/**
 * 在消息列表前插入 / 合并 system。
 * 若首条已是 system，则把 extra 追加到其后（双换行），避免多条 system 被部分服务商丢弃。
 */
export function prependSystemPrompt(
  messages: AgentChatMessage[],
  systemPrompt: string,
): AgentChatMessage[] {
  const trimmed = systemPrompt.trim();
  if (!trimmed) return messages.slice();

  if (messages[0]?.role === "system") {
    const headText = contentToPlainText(
      messages[0].content as string | AIContentPart[],
    );
    const merged = `${headText.trim()}\n\n${trimmed}`.trim();
    return [{ role: "system", content: merged }, ...messages.slice(1)];
  }
  return [{ role: "system", content: trimmed }, ...messages];
}

/** 回传模型的工具结果最大字符数（超长截断，避免撑爆上下文）。 */
export const MAX_TOOL_RESULT_CHARS = 32_000;

function truncateToolResultForModel(
  text: string,
  max = MAX_TOOL_RESULT_CHARS,
): string {
  if (text.length <= max) return text;
  return `${text.slice(0, max)}…[工具结果已截断，原长 ${text.length}]`;
}

/**
 * 回传模型前剥离巨型字段（base64 / 完整 HTML），避免撑爆上下文。
 * UI 仍持有完整 tool part.output。
 */
export function sanitizeToolResultForModel(result: unknown): unknown {
  if (result == null || typeof result !== "object" || Array.isArray(result)) {
    return result;
  }
  const rec = result as Record<string, unknown>;
  const out: Record<string, unknown> = { ...rec };

  if (typeof out.contentBase64 === "string" && out.contentBase64.length > 0) {
    const n = out.contentBase64.length;
    delete out.contentBase64;
    out.contentBase64Omitted = true;
    out.contentBase64Chars = n;
    if (out.byteLength == null) {
      // base64 ≈ 4/3 原始字节
      out.byteLengthApprox = Math.floor((n * 3) / 4);
    }
  }

  if (typeof out.html === "string" && out.html.length > 2_000) {
    const full = out.html;
    out.html = `${full.slice(0, 400)}…[html 已省略，共 ${full.length} 字，用户侧可预览下载]`;
    out.htmlOmitted = true;
    out.htmlChars = full.length;
  }

  // 长 SVG 与 html 同理：UI 持有完整 markup，模型只看摘要
  if (typeof out.svg === "string" && out.svg.length > 2_000) {
    const full = out.svg;
    out.svg = `${full.slice(0, 400)}…[svg 已省略，共 ${full.length} 字，用户侧可预览下载]`;
    out.svgOmitted = true;
    out.svgChars = full.length;
  }

  // Mermaid 源码过长时截断（完整图在 ArtifactCard）
  if (typeof out.source === "string" && out.source.length > 4_000) {
    const full = out.source;
    out.source = `${full.slice(0, 600)}…[source 已省略，共 ${full.length} 字]`;
    out.sourceOmitted = true;
    out.sourceChars = full.length;
  }

  // 生图远程 URL 可保留；超长 data URL 当 base64 处理
  if (typeof out.url === "string" && out.url.startsWith("data:") && out.url.length > 500) {
    out.url = "[data-url omitted]";
    out.urlOmitted = true;
  }

  return out;
}

/** 把工具结果压成可回传模型的字符串（失败不抛；剥离 base64；超长截断）。 */
export function formatToolResultForModel(result: unknown): string {
  const sanitized = sanitizeToolResultForModel(result);
  let text: string;
  if (sanitized == null) return "";
  if (typeof sanitized === "string") {
    text = sanitized;
  } else {
    try {
      text = JSON.stringify(sanitized, null, 0);
    } catch {
      text = String(sanitized);
    }
  }
  return truncateToolResultForModel(text);
}

/** 解析 function.arguments；坏 JSON 时回传原始字符串。 */
export function parseToolArguments(raw: string): unknown {
  const text = raw?.trim() ?? "";
  if (!text) return {};
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return { _raw: text };
  }
}

/**
 * OpenAI Chat Completions 请求用 message 形态（含 tool / tool_calls）。
 * 仅 openai 工具循环使用；不进入 runAITextStream。
 * user content 可为 string 或 image_url parts。
 */
export type OpenAILoopMessage =
  | {
      role: "system" | "user";
      content: string | OpenAIChatContentPart[];
    }
  | {
      role: "assistant";
      content: string | null;
      tool_calls?: OpenAIToolCall[];
    }
  | { role: "tool"; tool_call_id: string; content: string };

export function toOpenAILoopMessages(
  messages: AgentChatMessage[],
): OpenAILoopMessage[] {
  return messages
    .filter((m) => messageHasContent(m.content) || m.role === "assistant")
    .map((m) => {
      if (m.role === "system") {
        return {
          role: "system" as const,
          content: contentToPlainText(
            m.content as string | AIContentPart[],
          ),
        };
      }
      if (m.role === "user") {
        return {
          role: "user" as const,
          content: toOpenAIChatContent(
            m.content as string | AIContentPart[],
          ),
        };
      }
      // assistant / 其它：压成纯文本（tool loop 历史里 assistant 多为 string）
      return {
        role: m.role as "assistant",
        content:
          typeof m.content === "string"
            ? m.content
            : contentToPlainText(m.content as AIContentPart[]),
      };
    });
}

export function buildToolResultMessage(
  toolCallId: string,
  result: unknown,
): OpenAILoopMessage {
  return {
    role: "tool",
    tool_call_id: toolCallId,
    content: formatToolResultForModel(result),
  };
}
