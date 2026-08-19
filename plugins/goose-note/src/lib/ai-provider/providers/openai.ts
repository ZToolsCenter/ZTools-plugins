import type { AISettingsLike, AIMessage, AIStreamPhase, AIRequestOverrides } from "../types";
import {
  getCustomAIApiKey,
  getCustomAIBaseURL,
  getCustomSelectedModelId,
  getCustomProviderOptions,
  readErrorMessage,
} from "../modelCatalog";
import { readSSELines } from "../stream";

export async function handleOpenAIStream(
  settings: AISettingsLike,
  messages: AIMessage[],
  signal: AbortSignal,
  emit: (phase: AIStreamPhase, text: string, isReasoning: boolean) => void,
  requestOverrides?: AIRequestOverrides,
) {
  const protocol = "openai" as const;
  const apiKey = getCustomAIApiKey(settings, protocol);
  const baseURL = getCustomAIBaseURL(settings, protocol).replace(/\/+$/, "");
  const modelId = getCustomSelectedModelId(settings, requestOverrides);
  const options = getCustomProviderOptions(settings, requestOverrides);

  const body: Record<string, unknown> = {
    model: modelId,
    messages: messages,
    stream: true,
  };
  if (options?.openaiCompatible) {
    const openaiOpts = options.openaiCompatible as Record<string, unknown>;
    if (openaiOpts.reasoningEffort) {
      body.reasoning_effort = openaiOpts.reasoningEffort;
    }
  }

  const response = await fetch(`${baseURL}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify(body),
    signal,
  });

  if (!response.ok) {
    const errMs = await readErrorMessage(response);
    throw new Error(errMs || "请求自定义 OpenAI 模型失败");
  }

  let fullText = "";
  let fullReasoning = "";
  for await (const line of readSSELines(response, signal)) {
    if (line === "data: [DONE]") break;
    if (line.startsWith("data: ")) {
      const dataStr = line.slice(6);
      if (!dataStr) continue;
      try {
        const json = JSON.parse(dataStr);
        const delta = json.choices?.[0]?.delta;
        if (delta) {
          if (delta.reasoning_content) {
            fullReasoning += delta.reasoning_content;
            emit("thinking", delta.reasoning_content, true);
          }
          if (delta.content) {
            fullText += delta.content;
            emit("generating", delta.content, false);
          }
        }
      } catch {
        // ignore parse error on single line
      }
    }
  }
  return { text: fullText, reasoningText: fullReasoning };
}
