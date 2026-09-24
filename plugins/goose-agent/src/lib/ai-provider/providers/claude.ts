import type { AISettingsLike, AIMessage, AIStreamPhase, AIRequestOverrides } from "../types";
import { getRequestCredential } from "../auth";
import {
  getCustomAIBaseURL,
  getCustomSelectedModelId,
  getCustomProviderOptions,
  readErrorMessage,
} from "../modelCatalog";
import { encodeMessagesForClaude } from "../multimodal";
import { readSSELines } from "../stream";

export async function handleClaudeStream(
  settings: AISettingsLike,
  messages: AIMessage[],
  signal: AbortSignal,
  emit: (phase: AIStreamPhase, text: string, isReasoning: boolean) => void,
  requestOverrides?: AIRequestOverrides,
) {
  const protocol = "claude" as const;
  const cred = getRequestCredential(settings, protocol);
  const token = cred?.token ?? "";
  const baseURL = getCustomAIBaseURL(settings, protocol).replace(/\/+$/, "");
  const modelId = getCustomSelectedModelId(settings, requestOverrides);
  const options = getCustomProviderOptions(settings, requestOverrides);

  const { systemInstruction, claudeMessages } =
    encodeMessagesForClaude(messages);

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

  const authHeaders: Record<string, string> =
    cred?.type === "oauth"
      ? { Authorization: `Bearer ${token}` }
      : { "x-api-key": token };

  const response = await fetch(`${baseURL}/messages`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...authHeaders,
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
  /**
   * Anthropic 流：message_start 常带 input_tokens；
   * message_delta 带 output_tokens。合并为单一 usage 对象。
   */
  let usage: Record<string, unknown> | undefined;
  for await (const line of readSSELines(response, signal)) {
    if (line.startsWith("data: ")) {
      try {
        const json = JSON.parse(line.slice(6));
        if (json.type === "message_start" && json.message?.usage) {
          usage = { ...(usage ?? {}), ...json.message.usage };
        } else if (json.type === "message_delta" && json.usage) {
          usage = { ...(usage ?? {}), ...json.usage };
        } else if (json.type === "content_block_delta" && json.delta) {
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
  return { text: fullText, reasoningText: fullReasoning, usage };
}
