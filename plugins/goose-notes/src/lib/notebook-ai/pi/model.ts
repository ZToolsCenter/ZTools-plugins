import {
  createModels,
  createProvider,
  type Model,
  type Models,
} from "@earendil-works/pi-ai";
import { openAICompletionsApi } from "@earendil-works/pi-ai/api/openai-completions.lazy";
import { openAIResponsesApi } from "@earendil-works/pi-ai/api/openai-responses.lazy";
import { anthropicMessagesApi } from "@earendil-works/pi-ai/api/anthropic-messages.lazy";
import {
  getCustomAIApiKey,
  getCustomAIBaseURL,
  getSettingsProviderId,
  resolveActiveProtocol,
} from "@/lib/ai-provider";
import { useSettings } from "@/stores/useSettings";

export type PiModelAvailability =
  | { ok: true; models: Models; model: Model<any>; providerId: string }
  | { ok: false; reason: string };

function resolveSelectedModelId(): string | null {
  const ai = useSettings.getState().ai;
  const workspaceOverride = ai.workspaceSelectedModelId?.trim();
  const workspaceOverrideValid =
    !!workspaceOverride &&
    ai.customModelOptions.some((option) => option.id === workspaceOverride);
  const modelId = (
    (workspaceOverrideValid ? workspaceOverride : null) ??
    ai.selectedModelId ??
    ""
  ).trim();
  return modelId || null;
}

function makeApiKeyAuth(name: string, apiKey: string) {
  return {
    apiKey: {
      name,
      resolve: async () =>
        apiKey
          ? { auth: { apiKey }, source: "settings" as const }
          : undefined,
    },
  };
}

/**
 * 把用户设置里的协议/密钥/Base URL 映射为 pi-ai Models + 当前 Model。
 * 不默认挂 deepseek 内置 catalog；始终按用户配置的 model id 构造。
 */
export function buildPiLanguageModel(): PiModelAvailability {
  const ai = useSettings.getState().ai;

  if (!ai.enabled) {
    return { ok: false, reason: "AI 功能未开启，请前往设置启用 AI 助手。" };
  }

  const modelId = resolveSelectedModelId();
  if (!modelId) {
    return {
      ok: false,
      reason: "请在设置中选择一个模型后再使用 AI 笔记本功能。",
    };
  }

  try {
    const models = createModels();
    const providerId = "goose-custom";
    const requestOverrides = { selectedModelId: modelId };
    const protocol = resolveActiveProtocol(ai, requestOverrides);
    const baseUrl = getCustomAIBaseURL(ai, protocol).replace(/\/+$/, "");
    const apiKey = getCustomAIApiKey(ai, protocol);
    const settingsProviderId = getSettingsProviderId(ai);
    const isDeepSeek = settingsProviderId === "deepseek";

    if (protocol === "openai-responses") {
      const model: Model<"openai-responses"> = {
        id: modelId,
        name: modelId,
        api: "openai-responses",
        provider: providerId,
        baseUrl,
        reasoning: false,
        input: ["text", "image"],
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
        contextWindow: 128000,
        maxTokens: 16384,
      };
      models.setProvider(
        createProvider({
          id: providerId,
          name: "Goose Custom (OpenAI Responses)",
          baseUrl,
          auth: makeApiKeyAuth("Goose OpenAI Responses", apiKey),
          models: [model],
          api: openAIResponsesApi(),
        }),
      );
      return { ok: true, models, model, providerId };
    }

    if (protocol === "claude") {
      const model: Model<"anthropic-messages"> = {
        id: modelId,
        name: modelId,
        api: "anthropic-messages",
        provider: providerId,
        baseUrl,
        reasoning: false,
        input: ["text", "image"],
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
        contextWindow: 200000,
        maxTokens: 16384,
      };
      models.setProvider(
        createProvider({
          id: providerId,
          name: "Goose Custom (Anthropic)",
          baseUrl,
          auth: makeApiKeyAuth("Goose Claude", apiKey),
          models: [model],
          api: anthropicMessagesApi(),
        }),
      );
      return { ok: true, models, model, providerId };
    }

    // OpenAI 兼容 Chat Completions（含 DeepSeek）。
    // tool 多轮时关闭 reasoning 回放约束，降低 Duplicate call_id 风险。
    const model: Model<"openai-completions"> = {
      id: modelId,
      name: modelId,
      api: "openai-completions",
      provider: providerId,
      baseUrl,
      reasoning: false,
      input: ["text"],
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      contextWindow: 128000,
      maxTokens: 8192,
      compat: {
        supportsStore: false,
        supportsDeveloperRole: false,
        supportsReasoningEffort: false,
        maxTokensField: "max_tokens",
        ...(isDeepSeek
          ? {
              thinkingFormat: "openai" as const,
              requiresReasoningContentOnAssistantMessages: false,
            }
          : {}),
      },
    };
    models.setProvider(
      createProvider({
        id: providerId,
        name: "Goose Custom (OpenAI Compatible)",
        baseUrl,
        auth: makeApiKeyAuth("Goose OpenAI Compatible", apiKey),
        models: [model],
        api: openAICompletionsApi(),
      }),
    );
    return { ok: true, models, model, providerId };
  } catch (err) {
    return {
      ok: false,
      reason: `构造 Pi 模型失败：${err instanceof Error ? err.message : String(err)}`,
    };
  }
}
