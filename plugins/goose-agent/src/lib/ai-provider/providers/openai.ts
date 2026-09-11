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
  getCustomProviderOptions,
  readErrorMessage,
} from "../modelCatalog";
import { encodeMessagesForOpenAIChat } from "../multimodal";
import { readSSELines } from "../stream";

export async function handleOpenAIStream(
  settings: AISettingsLike,
  messages: AIMessage[],
  signal: AbortSignal,
  emit: (phase: AIStreamPhase, text: string, isReasoning: boolean) => void,
  requestOverrides?: AIRequestOverrides,
) {
  const protocol = "openai" as const;
  const cred = getRequestCredential(settings, protocol);
  const token = cred?.token ?? "";
  const baseURL = getCustomAIBaseURL(settings, protocol).replace(/\/+$/, "");
  const modelId = getCustomSelectedModelId(settings, requestOverrides);
  const options = getCustomProviderOptions(settings, requestOverrides);

  const body: Record<string, unknown> = {
    model: modelId,
    messages: encodeMessagesForOpenAIChat(messages),
    stream: true,
    stream_options: { include_usage: true },
  };
  if (options?.openaiCompatible) {
    const openaiOpts = options.openaiCompatible as Record<string, unknown>;
    if (openaiOpts.reasoningEffort) {
      body.reasoning_effort = openaiOpts.reasoningEffort;
    }
  }

  const requestUrl = `${baseURL}/chat/completions`;
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
    const errMs = await readErrorMessage(response);
    const mapped = mapFetchErrorIfGrokCliVersion(response.status, errMs);
    throw new Error(mapped || errMs || "请求自定义 OpenAI 模型失败");
  }

  let fullText = "";
  let fullReasoning = "";
  /** 末次 chunk 的 usage 对象（OpenAI 常在 choices 为空的收尾包里给） */
  let usage: unknown = undefined;
  for await (const line of readSSELines(response, signal)) {
    if (line === "data: [DONE]") break;
    if (line.startsWith("data: ")) {
      const dataStr = line.slice(6);
      if (!dataStr) continue;
      try {
        const json = JSON.parse(dataStr);
        if (json.usage) usage = json.usage;
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
  return { text: fullText, reasoningText: fullReasoning, usage };
}
