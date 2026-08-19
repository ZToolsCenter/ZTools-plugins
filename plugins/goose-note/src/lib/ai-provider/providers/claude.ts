import type { AISettingsLike, AIMessage, AIStreamPhase, AIRequestOverrides } from "../types";
import {
  getCustomAIApiKey,
  getCustomAIBaseURL,
  getCustomSelectedModelId,
  getCustomProviderOptions,
  readErrorMessage,
} from "../modelCatalog";
import { readSSELines } from "../stream";

export async function handleClaudeStream(
  settings: AISettingsLike,
  messages: AIMessage[],
  signal: AbortSignal,
  emit: (phase: AIStreamPhase, text: string, isReasoning: boolean) => void,
  requestOverrides?: AIRequestOverrides,
) {
  const protocol = "claude" as const;
  const apiKey = getCustomAIApiKey(settings, protocol);
  const baseURL = getCustomAIBaseURL(settings, protocol).replace(/\/+$/, "");
  const modelId = getCustomSelectedModelId(settings, requestOverrides);
  const options = getCustomProviderOptions(settings, requestOverrides);

  const claudeMessages = messages.filter((m) => m.role !== "system");
  const systemInstruction = messages
    .filter((m) => m.role === "system")
    .map((m) => m.content)
    .join("\n");

  const body: Record<string, unknown> = {
    model: modelId,
    messages: claudeMessages,
    max_tokens: 32768,
    stream: true,
  };
  if (systemInstruction) {
    body.system = systemInstruction;
  }
  if (options?.anthropic) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const claudeOpts = options.anthropic as any;
    if (claudeOpts.thinking?.budgetTokens) {
      body.thinking = {
        type: "enabled",
        budget_tokens: claudeOpts.thinking.budgetTokens,
      };
    }
  }

  const response = await fetch(`${baseURL}/messages`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
      "anthropic-dangerous-direct-browser-access": "true",
    },
    body: JSON.stringify(body),
    signal,
  });

  if (!response.ok) {
    const errMs = await readErrorMessage(response);
    throw new Error(errMs || "请求自定义 Anthropic 模型失败");
  }

  let fullText = "";
  let fullReasoning = "";
  for await (const line of readSSELines(response, signal)) {
    if (line.startsWith("data: ")) {
      try {
        const json = JSON.parse(line.slice(6));
        if (json.type === "content_block_delta" && json.delta) {
          if (json.delta.type === "thinking_delta") {
            fullReasoning += json.delta.thinking;
            emit("thinking", json.delta.thinking, true);
          } else if (json.delta.type === "text_delta") {
            fullText += json.delta.text;
            emit("generating", json.delta.text, false);
          }
        }
      } catch {
        // parse error
      }
    }
  }
  return { text: fullText, reasoningText: fullReasoning };
}
