import type { AISettingsLike, AIMessage, AIStreamPhase, AIRequestOverrides } from "../types";
import {
  getCustomAIApiKey,
  getCustomAIBaseURL,
  getCustomSelectedModelId,
  getRequestReasoningLevel,
  readErrorMessage,
} from "../modelCatalog";
import { readSSELines } from "../stream";

export async function handleOpenAIResponsesStream(
  settings: AISettingsLike,
  messages: AIMessage[],
  signal: AbortSignal,
  emit: (phase: AIStreamPhase, text: string, isReasoning: boolean) => void,
  requestOverrides?: AIRequestOverrides,
) {
  const protocol = "openai-responses" as const;
  const apiKey = getCustomAIApiKey(settings, protocol);
  const baseURL = getCustomAIBaseURL(settings, protocol).replace(/\/+$/, "");
  const modelId = getCustomSelectedModelId(settings, requestOverrides);
  const reasoningLevel = getRequestReasoningLevel(settings, requestOverrides);
  const instructions = messages
    .filter((message) => message.role === "system")
    .map((message) => message.content)
    .join("\n");
  const input = messages
    .filter((message) => message.role !== "system")
    .map((message) => ({ role: message.role, content: message.content }));

  const body: Record<string, unknown> = {
    model: modelId,
    input,
    stream: true,
    store: false,
  };
  if (instructions) {
    body.instructions = instructions;
  }
  if (reasoningLevel) {
    body.reasoning = {
      effort: reasoningLevel,
      summary: "auto",
    };
  }

  const response = await fetch(`${baseURL}/responses`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify(body),
    signal,
  });

  if (!response.ok) {
    const errorMessage = await readErrorMessage(response);
    throw new Error(errorMessage || "请求自定义 OpenAI Responses 模型失败");
  }

  let fullText = "";
  let fullReasoning = "";
  let streamError: string | null = null;

  for await (const line of readSSELines(response, signal)) {
    if (!line.startsWith("data: ")) continue;
    const data = line.slice(6);
    if (!data || data === "[DONE]") continue;

    try {
      const event = JSON.parse(data);
      if (event.type === "response.output_text.delta" && typeof event.delta === "string") {
        fullText += event.delta;
        emit("generating", event.delta, false);
      } else if (
        event.type === "response.reasoning_summary_text.delta" &&
        typeof event.delta === "string"
      ) {
        fullReasoning += event.delta;
        emit("thinking", event.delta, true);
      } else if (event.type === "error") {
        streamError = event.message || event.error?.message || "OpenAI Responses 流式请求失败";
      } else if (event.type === "response.failed") {
        streamError = event.response?.error?.message || "OpenAI Responses 流式请求失败";
      }
    } catch {
      // 忽略无法解析的单条 SSE 事件，继续读取后续内容。
    }
  }

  if (streamError) {
    throw new Error(streamError);
  }

  return { text: fullText, reasoningText: fullReasoning };
}
