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
  isCustomProviderId,
  isForeignProviderBaseURL,
  resolveProtocolForProvider,
  XAI_CLI_SESSION_BASE_URL,
  type AIProviderId,
} from "./presets";
import {
  getActiveCredentialMissingMessage,
  getPreferredAuthMode,
  hasActiveCredential,
} from "./auth";
import {
  mapFetchErrorIfGrokCliVersion,
  resolveGrokCliClientVersion,
  withCliProxyHeaders,
} from "./cliProxyHeaders";
import { getApiModelId } from "./modelRef";

export const DEFAULT_OPENAI_BASE_URL = "https://api.openai.com/v1";
export const DEFAULT_CLAUDE_BASE_URL = "https://api.anthropic.com/v1";
export const SETTINGS_ENTRY_HINT =
  '请前往「设置 → AI」检查配置。';
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
 * xAI + preferred oauth：CLI 会话走 openai-responses（非 console Chat）。
 */
export function resolveActiveProtocol(
  settings: AISettingsLike,
  requestOverrides?: AIRequestOverrides,
): CustomAIProtocol {
  const providerId = getSettingsProviderId(settings);
  if (providerId === "xai" && getPreferredAuthMode(settings) === "oauth") {
    return "openai-responses";
  }
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
    contextWindow?: unknown;
    context_window?: unknown;
    supportsVision?: unknown;
    capabilities?: {
      image_input?: unknown;
      vision?: unknown;
    };
    modalities?: {
      input?: unknown;
    };
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

  const rawContextWindow =
    typeof maybeModel.contextWindow === "number"
      ? maybeModel.contextWindow
      : typeof maybeModel.context_window === "number"
        ? maybeModel.context_window
        : undefined;
  const contextWindow =
    typeof rawContextWindow === "number" && rawContextWindow > 0
      ? Math.floor(rawContextWindow)
      : undefined;

  // live 显式 vision：supportsVision / capabilities.image_input / modalities.input⊇image
  let supportsVision: boolean | undefined;
  if (typeof maybeModel.supportsVision === "boolean") {
    supportsVision = maybeModel.supportsVision;
  } else if (typeof maybeModel.capabilities?.image_input === "boolean") {
    supportsVision = maybeModel.capabilities.image_input;
  } else if (typeof maybeModel.capabilities?.vision === "boolean") {
    supportsVision = maybeModel.capabilities.vision;
  } else if (Array.isArray(maybeModel.modalities?.input)) {
    supportsVision = maybeModel.modalities.input.some(
      (m) => typeof m === "string" && m.toLowerCase() === "image",
    );
  }

  return {
    id,
    label: labelSource.trim(),
    description: descriptionParts.length
      ? descriptionParts.join(" · ")
      : undefined,
    contextWindow,
    supportsVision,
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

/**
 * 读 per-provider 凭证快照中的字段（trim 后非空才返回）。
 */
function readProviderCredentialField(
  settings: AISettingsLike,
  providerId: AIProviderId,
  field: "baseURL" | "apiKey",
): string {
  const snap = settings.providerCredentials?.[providerId];
  if (!snap) return "";
  const value = (snap[field] ?? "").trim();
  return value;
}

/** 读共享协议槽 base（未校验 foreign）。 */
function readSharedSlotBaseURL(
  settings: AISettingsLike,
  protocol: CustomAIProtocol,
): string {
  if (protocol === "claude") {
    return settings.customClaudeBaseURL?.trim() || "";
  }
  if (protocol === "openai") {
    return settings.customOpenAIBaseURL?.trim() || "";
  }
  return settings.customOpenAIResponsesBaseURL?.trim() || "";
}

/**
 * 自定义供应商是否有可用 base（snap 或非 foreign 共享槽）。
 * 无 snap 且共享槽为脏官方 URL / 空时视为不完整。
 */
export function hasUsableCustomProviderBase(
  settings: AISettingsLike,
  protocol: CustomAIProtocol = resolveActiveProtocol(settings),
): boolean {
  const providerId = getSettingsProviderId(settings);
  if (!isCustomProviderId(providerId)) return true;

  const snapBase = readProviderCredentialField(settings, providerId, "baseURL");
  if (snapBase) return true;

  const shared = readSharedSlotBaseURL(settings, protocol);
  if (!shared) return false;
  if (isForeignProviderBaseURL(shared, providerId)) return false;
  return true;
}

// re-export for callers that import from modelCatalog
export { isForeignProviderBaseURL, isCustomProviderId };

export function getCustomAIBaseURL(
  settings: AISettingsLike,
  protocol: CustomAIProtocol = resolveActiveProtocol(settings),
) {
  const providerId = getSettingsProviderId(settings);
  // OIDC 会话 token 仅对 cli-chat-proxy 有效，不可走 api.x.ai
  if (providerId === "xai" && getPreferredAuthMode(settings) === "oauth") {
    return XAI_CLI_SESSION_BASE_URL;
  }
  const fixedBaseURL = getProviderFixedBaseURL(providerId);
  if (fixedBaseURL) {
    return fixedBaseURL;
  }

  // 自定义供应商：优先 per-provider 快照，避免共享槽被 xai 导入覆盖后仍读错
  const snapBase = readProviderCredentialField(settings, providerId, "baseURL");
  if (snapBase) {
    return snapBase;
  }

  const shared = readSharedSlotBaseURL(settings, protocol);
  // 无 snap 时禁止采用其它内置供应商的固定 URL（脏槽）
  if (shared && isForeignProviderBaseURL(shared, providerId)) {
    return getDefaultCustomAIBaseURL(protocol);
  }

  return shared || getDefaultCustomAIBaseURL(protocol);
}

export function getCustomAIApiKey(
  settings: AISettingsLike,
  protocol: CustomAIProtocol = resolveActiveProtocol(settings),
) {
  const providerId = getSettingsProviderId(settings);

  // 优先 per-provider 快照（api_key 模式）
  const snapKey = readProviderCredentialField(settings, providerId, "apiKey");
  if (snapKey) {
    return snapKey;
  }

  // 自定义无 snap 且共享 base 为 foreign 时：不信任共享槽 key（可能是 xai 残留）
  if (
    isCustomProviderId(providerId) &&
    !readProviderCredentialField(settings, providerId, "baseURL")
  ) {
    const sharedBase = readSharedSlotBaseURL(settings, protocol);
    if (sharedBase && isForeignProviderBaseURL(sharedBase, providerId)) {
      return "";
    }
  }

  const key = (
    protocol === "openai-responses"
      ? settings.customOpenAIResponsesApiKey
      : protocol === "openai"
        ? settings.customOpenAIApiKey
        : settings.customClaudeApiKey
  ).trim();

  // 双协议槽位共用同一 Key：某一槽位为空时回退另一槽位（deepseek / xai）。
  if (!key && (providerId === "deepseek" || providerId === "xai")) {
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

/**
 * 无 active（preferred 侧）凭证时。
 * 传入 settings 时按 preferred 引导：oauth → 登录/切密钥；api_key → 填 Key。
 */
export function getCredentialMissingMessage(settings?: AISettingsLike) {
  if (settings) {
    const providerId = getSettingsProviderId(settings);
    if (
      isCustomProviderId(providerId) &&
      !hasUsableCustomProviderBase(settings)
    ) {
      return "当前供应商凭证不完整，请在设置 → AI 中保存该供应商。";
    }
    return `${getActiveCredentialMissingMessage(settings)}${SETTINGS_ENTRY_HINT}`;
  }
  return `未配置有效凭证（密钥或账号登录）。${SETTINGS_ENTRY_HINT}`;
}

/** 自定义供应商 base/key 不完整时的提示（无「默认/推荐」角标）。 */
export function getCustomProviderIncompleteMessage() {
  return "当前供应商凭证不完整，请在设置 → AI 中保存该供应商。";
}

export function getAuthFailedMessage(providerLabel: string) {
  return `${providerLabel} 鉴权失败。${SETTINGS_ENTRY_HINT}`;
}

export function getStoredAIModelOptions(
  settings: Pick<AISettingsLike, "customModelOptions">,
) {
  return settings.customModelOptions;
}

/**
 * 合并拉取到的模型列表与本地已存列表：以 fetched 的 id/label/description/contextWindow 为准；
 * 若 previous 同 id 有 boolean `supportsVision` 且 fetched 未带 boolean，则保留 previous 的值。
 */
export function mergeModelOptionsPreservingMeta(
  fetched: AIModelOption[],
  previous: AIModelOption[],
): AIModelOption[] {
  if (previous.length === 0) return fetched;

  const previousById = new Map(previous.map((m) => [m.id, m]));

  return fetched.map((item) => {
    const prev = previousById.get(item.id);
    if (!prev) return item;

    // fetched 已带 boolean supportsVision 时以 fetched 为准
    if (typeof item.supportsVision === "boolean") {
      return item;
    }

    // previous 有 boolean 元数据则保留
    if (typeof prev.supportsVision === "boolean") {
      return { ...item, supportsVision: prev.supportsVision };
    }

    return item;
  });
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

/**
 * 发给 API 的裸 model id（剥离 `providerId/` 前缀）。
 */
export function getCustomSelectedModelId(
  settings: AISettingsLike,
  requestOverrides?: AIRequestOverrides,
) {
  const raw =
    getRequestedModelId(settings, requestOverrides) ??
    settings.customModelOptions[0]?.id ??
    null;
  if (!raw) return null;
  const providerId = getSettingsProviderId(settings);
  return getApiModelId(raw, providerId) ?? raw;
}

export function getRequestReasoningLevel(
  settings: Pick<AISettingsLike, "workspaceReasoningLevel">,
  requestOverrides?: AIRequestOverrides,
): "low" | "medium" | "high" | null {
  const reasoningLevel =
    requestOverrides?.reasoningLevel ?? settings.workspaceReasoningLevel;
  if (reasoningLevel === "low" || reasoningLevel === "high") {
    return reasoningLevel;
  }
  // medium 与历史 default：按中档发出
  if (reasoningLevel === "medium" || reasoningLevel === "default") {
    return "medium";
  }
  return null;
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
  if (!hasActiveCredential(settings)) {
    return {
      ok: false as const,
      reason: getCredentialMissingMessage(settings),
    };
  }

  // 自定义供应商：无 snap 且共享槽为 foreign/空时禁止发送（避免打到 xai 脏 base）
  if (!hasUsableCustomProviderBase(settings)) {
    return {
      ok: false as const,
      reason: getCustomProviderIncompleteMessage(),
    };
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
      ? "Anthropic 源"
      : config.protocol === "openai-responses"
        ? "OpenAI Responses 源"
        : "OpenAI 兼容源");

  const modelsUrl =
    config.protocol === "claude"
      ? getClaudeModelsUrl(config.baseURL)
      : getOpenAIModelsUrl(config.baseURL);

  await resolveGrokCliClientVersion();
  const baseHeaders: Record<string, string> =
    config.protocol === "claude"
      ? {
          "x-api-key": apiKey,
          "anthropic-version": "2023-06-01",
          "anthropic-dangerous-direct-browser-access": "true",
        }
      : { Authorization: `Bearer ${apiKey}` };

  const response = await fetch(modelsUrl, {
    headers: withCliProxyHeaders(modelsUrl, baseHeaders),
  });

  if (!response.ok) {
    // 预设供应商鉴权失败时，若有兜底模型且明确是列表接口问题，仍抛错让用户知悉 Key 问题。
    const errorMsg = await readErrorMessage(response);
    const mapped = mapFetchErrorIfGrokCliVersion(response.status, errorMsg);
    throw new Error(mapped || errorMsg || getAuthFailedMessage(providerLabel));
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
