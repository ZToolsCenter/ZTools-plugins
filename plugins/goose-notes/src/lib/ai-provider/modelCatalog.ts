import type {
  AIModelOption,
  AISettingsLike,
  AIReasoningLevel,
  AIRequestOverrides,
  CustomAIProtocol,
} from "./types";
import {
  getAIProviderPreset,
  getProviderFixedBaseURL,
  inferProviderIdFromSettings,
  isAIProviderId,
  resolveProtocolForProvider,
  type AIProviderId,
} from "./presets";

export const DEFAULT_OPENAI_BASE_URL = "https://api.openai.com/v1";
export const DEFAULT_CLAUDE_BASE_URL = "https://api.anthropic.com/v1";
export const SETTINGS_ENTRY_HINT =
  '请前往"设置 -> AI 助手 -> AI 服务"检查配置。';
export const ANTHROPIC_THINKING_BUDGET: Record<AIReasoningLevel, number> = {
  default: 0,
  low: 1024,
  medium: 4096,
  high: 12000,
};

export function getSettingsProviderId(
  settings: Pick<
    AISettingsLike,
    | "customProviderId"
    | "customProtocol"
    | "customOpenAIResponsesBaseURL"
    | "customOpenAIBaseURL"
    | "customClaudeBaseURL"
  >,
): AIProviderId {
  if (isAIProviderId(settings.customProviderId)) {
    return settings.customProviderId;
  }
  return inferProviderIdFromSettings(settings);
}

/**
 * 按供应商 + 当前模型解析实际协议。
 * DeepSeek：Flash → Responses；Pro → 兼容 Chat Completions。
 */
export function resolveActiveProtocol(
  settings: AISettingsLike,
  requestOverrides?: AIRequestOverrides,
): CustomAIProtocol {
  const providerId = getSettingsProviderId(settings);
  const modelId =
    requestOverrides?.selectedModelId?.trim() ||
    settings.selectedModelId?.trim() ||
    null;
  return resolveProtocolForProvider(
    providerId,
    modelId,
    settings.customProtocol,
  );
}

export function normalizeModelOption(input: unknown): AIModelOption | null {
  if (!input) return null;

  if (typeof input === "string") {
    const id = input.trim();
    return id ? { id, label: id } : null;
  }

  if (typeof input !== "object") return null;

  const maybeModel = input as {
    id?: unknown;
    name?: unknown;
    display_name?: unknown;
    description?: unknown;
    type?: unknown;
  };

  const id = typeof maybeModel.id === "string" ? maybeModel.id.trim() : "";
  if (!id) return null;

  const labelSource =
    typeof maybeModel.display_name === "string" &&
    maybeModel.display_name.trim()
      ? maybeModel.display_name
      : typeof maybeModel.name === "string" && maybeModel.name.trim()
        ? maybeModel.name
        : id;

  const descriptionParts = [
    typeof maybeModel.description === "string"
      ? maybeModel.description.trim()
      : "",
    typeof maybeModel.type === "string" ? maybeModel.type.trim() : "",
  ].filter(Boolean);

  return {
    id,
    label: labelSource.trim(),
    description: descriptionParts.length
      ? descriptionParts.join(" · ")
      : undefined,
  };
}

function getOpenAIModelsUrl(baseURL: string) {
  return `${baseURL.replace(/\/+$/, "")}/models`;
}

function getClaudeModelsUrl(baseURL: string) {
  return `${baseURL.replace(/\/+$/, "")}/models`;
}

export function getDefaultCustomAIBaseURL(protocol: CustomAIProtocol) {
  return protocol === "claude"
    ? DEFAULT_CLAUDE_BASE_URL
    : DEFAULT_OPENAI_BASE_URL;
}

export function getCustomAIBaseURL(
  settings: AISettingsLike,
  protocol: CustomAIProtocol = resolveActiveProtocol(settings),
) {
  const providerId = getSettingsProviderId(settings);
  const fixedBaseURL = getProviderFixedBaseURL(providerId);
  if (fixedBaseURL) {
    return fixedBaseURL;
  }

  if (protocol === "claude") {
    const baseURL = settings.customClaudeBaseURL?.trim();
    return baseURL || DEFAULT_CLAUDE_BASE_URL;
  }
  if (protocol === "openai") {
    const baseURL = settings.customOpenAIBaseURL?.trim();
    return baseURL || DEFAULT_OPENAI_BASE_URL;
  }
  const baseURL = settings.customOpenAIResponsesBaseURL?.trim();
  return baseURL || DEFAULT_OPENAI_BASE_URL;
}

export function getCustomAIApiKey(
  settings: AISettingsLike,
  protocol: CustomAIProtocol = resolveActiveProtocol(settings),
) {
  const key = (
    protocol === "openai-responses"
      ? settings.customOpenAIResponsesApiKey
      : protocol === "openai"
        ? settings.customOpenAIApiKey
        : settings.customClaudeApiKey
  ).trim();

  // DeepSeek 双协议共用同一 Key：某一槽位为空时回退另一槽位。
  if (!key && getSettingsProviderId(settings) === "deepseek") {
    return (
      settings.customOpenAIResponsesApiKey?.trim() ||
      settings.customOpenAIApiKey?.trim() ||
      ""
    );
  }

  return key;
}

export async function readErrorMessage(response: Response) {
  try {
    const payload = await response.json();
    if (typeof payload?.error === "string" && payload.error.trim()) {
      return payload.error.trim();
    }
    if (
      typeof payload?.error?.message === "string" &&
      payload.error.message.trim()
    ) {
      return payload.error.message.trim();
    }
    if (typeof payload?.message === "string" && payload.message.trim()) {
      return payload.message.trim();
    }
  } catch {
    // ignore non-json responses
  }

  try {
    const text = await response.text();
    return text.trim() || null;
  } catch {
    return null;
  }
}

export function getApiKeyMissingMessage() {
  return `未填写 API Key。${SETTINGS_ENTRY_HINT}`;
}

export function getAuthFailedMessage(providerLabel: string) {
  return `${providerLabel} 鉴权失败。${SETTINGS_ENTRY_HINT}`;
}

export function getStoredAIModelOptions(
  settings: Pick<AISettingsLike, "customModelOptions">,
) {
  return settings.customModelOptions;
}

export function getRequestedModelId(
  settings: AISettingsLike,
  requestOverrides?: AIRequestOverrides,
) {
  const overrideModelId = requestOverrides?.selectedModelId?.trim();
  if (overrideModelId) {
    return overrideModelId;
  }

  return settings.selectedModelId?.trim() || null;
}

export function getCustomSelectedModelId(
  settings: AISettingsLike,
  requestOverrides?: AIRequestOverrides,
) {
  return (
    getRequestedModelId(settings, requestOverrides) ??
    settings.customModelOptions[0]?.id ??
    null
  );
}

export function getRequestReasoningLevel(
  settings: Pick<AISettingsLike, "workspaceReasoningLevel">,
  requestOverrides?: AIRequestOverrides,
) {
  const reasoningLevel =
    requestOverrides?.reasoningLevel ?? settings.workspaceReasoningLevel;
  if (!reasoningLevel || reasoningLevel === "default") {
    return null;
  }

  return reasoningLevel;
}

export function getCustomProviderOptions(
  settings: AISettingsLike,
  requestOverrides?: AIRequestOverrides,
): Record<string, Record<string, unknown>> | undefined {
  const reasoningLevel = getRequestReasoningLevel(settings, requestOverrides);
  if (!reasoningLevel) {
    return undefined;
  }

  const protocol = resolveActiveProtocol(settings, requestOverrides);

  if (protocol === "openai") {
    return {
      openaiCompatible: {
        reasoningEffort: reasoningLevel,
      },
    };
  }

  if (protocol === "openai-responses") {
    return {
      openai: {
        reasoningEffort: reasoningLevel,
        reasoningSummary: "auto",
      },
    };
  }

  return {
    anthropic: {
      thinking: {
        type: "enabled" as const,
        budgetTokens: ANTHROPIC_THINKING_BUDGET[reasoningLevel],
      },
    },
  };
}

export function getAIAvailability(
  settings: AISettingsLike,
  requestOverrides?: AIRequestOverrides,
) {
  if (!settings.enabled) {
    return { ok: false as const, reason: "AI 助手尚未开启，请先到设置中打开" };
  }

  if (!getCustomAIApiKey(settings)) {
    return { ok: false as const, reason: getApiKeyMissingMessage() };
  }

  const selectedModelId = getCustomSelectedModelId(settings, requestOverrides);
  if (!selectedModelId) {
    return {
      ok: false as const,
      reason: "请先保存自定义 AI 配置并获取模型列表",
    };
  }

  return { ok: true as const };
}

export async function fetchCustomAIModels(config: {
  protocol: CustomAIProtocol;
  baseURL: string;
  apiKey: string;
  providerId?: AIProviderId | string | null;
}) {
  const apiKey = config.apiKey.trim();
  if (!apiKey) {
    throw new Error(getApiKeyMissingMessage());
  }

  const providerId = isAIProviderId(config.providerId)
    ? config.providerId
    : null;
  const preset = providerId ? getAIProviderPreset(providerId) : null;
  const providerLabel = preset?.label
    ?? (config.protocol === "claude"
      ? "自定义 Anthropic 源"
      : config.protocol === "openai-responses"
        ? "自定义 OpenAI Responses 源"
        : "自定义 OpenAI 兼容源");

  const modelsUrl =
    config.protocol === "claude"
      ? getClaudeModelsUrl(config.baseURL)
      : getOpenAIModelsUrl(config.baseURL);

  const response = await fetch(modelsUrl, {
    headers:
      config.protocol === "claude"
        ? {
            "x-api-key": apiKey,
            "anthropic-version": "2023-06-01",
            "anthropic-dangerous-direct-browser-access": "true",
          }
        : { Authorization: `Bearer ${apiKey}` },
  });

  if (!response.ok) {
    // 预设供应商鉴权失败时，若有兜底模型且明确是列表接口问题，仍抛错让用户知悉 Key 问题。
    const errorMsg = await readErrorMessage(response);
    throw new Error(errorMsg || getAuthFailedMessage(providerLabel));
  }

  const payload = await response.json();
  const rawList = Array.isArray(payload)
    ? payload
    : Array.isArray(payload?.data)
      ? payload.data
      : [];

  if (rawList.length === 0 && config.protocol === "claude") {
    return [
      { id: "claude-3-7-sonnet-20250219", label: "Claude 3.7 Sonnet" },
      { id: "claude-3-5-sonnet-20241022", label: "Claude 3.5 Sonnet" },
      { id: "claude-3-5-haiku-20241022", label: "Claude 3.5 Haiku" },
      { id: "claude-3-opus-20240229", label: "Claude 3 Opus" },
    ];
  }

  const parsed = (rawList as unknown[])
    .map(normalizeModelOption)
    .filter(
      (item): item is AIModelOption =>
        item !== null && Boolean(item.id && item.label),
    );

  if (parsed.length === 0 && preset?.fallbackModels?.length) {
    return preset.fallbackModels;
  }

  return parsed;
}
