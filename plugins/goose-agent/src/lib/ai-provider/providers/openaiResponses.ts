import type { AISettingsLike, AIMessage, AIStreamPhase, AIRequestOverrides } from "../types";
import { getRequestCredential } from "../auth";
import {
  mapFetchErrorIfGrokCliVersion,
  resolveGrokCliClientVersion,
  withCliProxyHeaders,
} from "../cliProxyHeaders";
import {
  getCustomAIBaseURL,
  getCustomSelectedModelId,
  getRequestReasoningLevel,
  readErrorMessage,
} from "../modelCatalog";
import { encodeMessagesForResponsesInput } from "../multimodal";
import { readSSELines } from "../stream";

export async function handleOpenAIResponsesStream(
  settings: AISettingsLike,
  messages: AIMessage[],
  signal: AbortSignal,
  emit: (phase: AIStreamPhase, text: string, isReasoning: boolean) => void,
  requestOverrides?: AIRequestOverrides,
) {
  const protocol = "openai-responses" as const;
  const cred = getRequestCredential(settings, protocol);
  const token = cred?.token ?? "";
  const baseURL = getCustomAIBaseURL(settings, protocol).replace(/\/+$/, "");
  const modelId = getCustomSelectedModelId(settings, requestOverrides);
  const reasoningLevel = getRequestReasoningLevel(settings, requestOverrides);
  const { instructions, input } = encodeMessagesForResponsesInput(messages);

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

  const requestUrl = `${baseURL}/responses`;
  await resolveGrokCliClientVersion();
  const response = await fetch(requestUrl, {
    method: "POST",
    headers: withCliProxyHeaders(requestUrl, {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    }),
    body: JSON.stringify(body),
    signal,
  });

  if (!response.ok) {
    const errorMessage = await readErrorMessage(response);
    const mapped = mapFetchErrorIfGrokCliVersion(response.status, errorMessage);
    throw new Error(
      mapped || errorMessage || "请求自定义 OpenAI Responses 模型失败",
    );
  }

  let fullText = "";
  let fullReasoning = "";
  let streamError: string | null = null;
  /** response.completed 上的 usage 对象 */
  let usage: unknown = undefined;

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
      } else if (event.type === "response.completed" && event.response?.usage) {
        usage = event.response.usage;
      }
    } catch {
      // 忽略无法解析的单条 SSE 事件，继续读取后续内容。
    }
  }

  if (streamError) {
    throw new Error(streamError);
  }

  return { text: fullText, reasoningText: fullReasoning, usage };
}
