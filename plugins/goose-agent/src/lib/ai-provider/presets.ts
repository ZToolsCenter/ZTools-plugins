import type { AIModelOption, CustomAIProtocol } from "./types";

/**
 * AI 供应商预设。
 * 用户只选供应商并填 Key；协议 / Base URL / 模型分支内部处理。
 *
 * Key 页仅 deepseek + 自定义；xai 为 OAuth/本机 CLI 路由用内部 id。
 * glm / minimax 已移除，存量经 normalize 迁到 custom-openai。
 */
export type AIProviderId =
  | "deepseek"
  | "xai"
  | "custom-openai-responses"
  | "custom-openai"
  | "custom-claude";

/** 供应商支持的鉴权方式（多数仅 api_key；xAI 仅 oauth / 本机 CLI） */
export type AIProviderAuthMode = "api_key" | "oauth";

export interface AIProviderPreset {
  id: AIProviderId;
  label: string;
  description: string;
  /** 固定 Base URL；自定义项为 null，需用户填写 */
  baseURL: string | null;
  /** 默认协议（DeepSeek 会按模型再分支） */
  protocol: CustomAIProtocol;
  /** 是否允许编辑 Base URL */
  allowCustomBaseURL: boolean;
  /** 支持的鉴权方式；xAI 仅 oauth，国内与自定义多为仅 api_key */
  authModes: AIProviderAuthMode[];
  /** 控制台 / 获取 Key 的官方页（可知则填；oauth-only 不强调） */
  consoleUrl?: string | null;
  /** 拉取模型失败时的兜底列表 */
  fallbackModels?: AIModelOption[];
  /**
   * 为 true 时仅当本机检测到对应 CLI 目录才出现在供应商列表
   *（如 xai 依赖 ~/.grok）。Key 页不展示 oauth-only，本字段仅兼容过滤。
   */
  requiresLocalPresence?: boolean;
}

/** 官方文档：https://api-docs.deepseek.com/ */
export const DEEPSEEK_BASE_URL = "https://api.deepseek.com";

/**
 * 历史 GLM 固定 Base（迁移用，不再作为内置 preset）。
 * 官方文档：https://docs.bigmodel.cn/cn/guide/develop/openai/introduction
 */
export const GLM_BASE_URL = "https://open.bigmodel.cn/api/paas/v4";

/**
 * 历史 MiniMax 固定 Base（迁移用，不再作为内置 preset）。
 * 官方：https://platform.minimax.io / https://api.minimaxi.com
 */
export const MINIMAX_BASE_URL = "https://api.minimaxi.com/v1";

/** 官方 OpenAI 兼容：https://docs.x.ai/docs */
export const XAI_BASE_URL = "https://api.x.ai/v1";

/**
 * Grok CLI OIDC 会话走 chat-proxy（非 console API Key 的 api.x.ai）。
 * 与 ~/.grok/models_cache.json 中 base_url / origin 一致。
 */
export const XAI_CLI_SESSION_BASE_URL = "https://cli-chat-proxy.grok.com/v1";

export const AI_PROVIDER_PRESETS: AIProviderPreset[] = [
  {
    id: "deepseek",
    label: "DeepSeek",
    description: "官方 · 填 Key 即用",
    baseURL: DEEPSEEK_BASE_URL,
    protocol: "openai-responses",
    allowCustomBaseURL: false,
    authModes: ["api_key"],
    consoleUrl: "https://platform.deepseek.com/api_keys",
    fallbackModels: [
      {
        id: "deepseek-v4-flash",
        label: "DeepSeek V4 Flash",
        contextWindow: 128_000,
      },
      {
        id: "deepseek-v4-pro",
        label: "DeepSeek V4 Pro",
        contextWindow: 128_000,
      },
    ],
  },
  {
    id: "xai",
    label: "Grok（xAI）",
    description: "本机 CLI 登录",
    baseURL: XAI_BASE_URL,
    protocol: "openai",
    allowCustomBaseURL: false,
    authModes: ["oauth"],
    requiresLocalPresence: true,
    fallbackModels: [
      { id: "grok-4.5", label: "Grok 4.5", contextWindow: 500_000 },
      { id: "grok-4", label: "Grok 4", contextWindow: 256_000 },
    ],
  },
  {
    id: "custom-openai-responses",
    label: "OpenAI Responses",
    description: "Responses 协议",
    baseURL: null,
    protocol: "openai-responses",
    allowCustomBaseURL: true,
    authModes: ["api_key"],
    consoleUrl: "https://platform.openai.com/api-keys",
  },
  {
    id: "custom-openai",
    label: "OpenAI 兼容",
    description: "Chat Completions",
    baseURL: null,
    protocol: "openai",
    allowCustomBaseURL: true,
    authModes: ["api_key"],
    consoleUrl: "https://platform.openai.com/api-keys",
  },
  {
    id: "custom-claude",
    label: "Anthropic",
    description: "Messages API",
    baseURL: null,
    protocol: "claude",
    allowCustomBaseURL: true,
    authModes: ["api_key"],
    consoleUrl: "https://console.anthropic.com/settings/keys",
  },
];

/** Key 页可见：仅支持 api_key 的供应商（不含 xai 等 oauth-only） */
export function getApiKeyProviderPresets(): AIProviderPreset[] {
  return AI_PROVIDER_PRESETS.filter((p) => p.authModes.includes("api_key"));
}

const PRESET_BY_ID = new Map(
  AI_PROVIDER_PRESETS.map((preset) => [preset.id, preset]),
);

export function getAIProviderPreset(
  providerId: AIProviderId | string | null | undefined,
): AIProviderPreset {
  if (providerId && PRESET_BY_ID.has(providerId as AIProviderId)) {
    return PRESET_BY_ID.get(providerId as AIProviderId)!;
  }
  // noUncheckedIndexedAccess：空数组理论可能，预设表非空
  return AI_PROVIDER_PRESETS[0]!;
}

export function isAIProviderId(value: unknown): value is AIProviderId {
  return (
    typeof value === "string" && PRESET_BY_ID.has(value as AIProviderId)
  );
}

/** 历史已移除 id（glm / minimax）→ custom-openai */
export function isLegacyRemovedProviderId(value: unknown): boolean {
  return value === "glm" || value === "minimax";
}

/** DeepSeek V4 Pro 尚不支持 Responses，走兼容 Chat Completions。 */
export function isDeepSeekProModel(modelId: string | null | undefined): boolean {
  if (!modelId) return false;
  // 兼容 canonical provider/model
  const bare = modelId.includes("/")
    ? modelId.slice(modelId.indexOf("/") + 1)
    : modelId;
  return /deepseek-v4-pro|v4-pro/i.test(bare.trim());
}

/**
 * 按供应商 + 模型解析实际协议。
 * DeepSeek：4flash → openai-responses；4 pro → openai。
 */
export function resolveProtocolForProvider(
  providerId: AIProviderId,
  modelId: string | null | undefined,
  fallbackProtocol?: CustomAIProtocol,
): CustomAIProtocol {
  if (providerId === "deepseek") {
    return isDeepSeekProModel(modelId) ? "openai" : "openai-responses";
  }
  const preset = getAIProviderPreset(providerId);
  return fallbackProtocol &&
    (providerId === "custom-openai-responses" ||
      providerId === "custom-openai" ||
      providerId === "custom-claude")
    ? preset.protocol
    : preset.protocol;
}

/**
 * 从已有 base URL / 协议推断供应商（迁移旧配置用）。
 * 已移除的 glm / minimax 与 bigmodel / minimax 域名 → custom-openai。
 */
export function inferProviderIdFromSettings(input: {
  customProtocol?: CustomAIProtocol | string | null;
  customOpenAIResponsesBaseURL?: string | null;
  customOpenAIBaseURL?: string | null;
  customClaudeBaseURL?: string | null;
  customProviderId?: string | null;
}): AIProviderId {
  if (isAIProviderId(input.customProviderId)) {
    return input.customProviderId;
  }
  // 存量 glm / minimax 预设 id
  if (isLegacyRemovedProviderId(input.customProviderId)) {
    return "custom-openai";
  }

  const urls = [
    input.customOpenAIResponsesBaseURL,
    input.customOpenAIBaseURL,
    input.customClaudeBaseURL,
  ]
    .map((value) => (typeof value === "string" ? value.toLowerCase() : ""))
    .filter(Boolean);

  if (urls.some((url) => url.includes("deepseek.com"))) {
    return "deepseek";
  }
  // 原 glm / minimax 官方域名 → 自定义 OpenAI 兼容（保留 Base URL）
  if (
    urls.some(
      (url) =>
        url.includes("bigmodel.cn") ||
        url.includes("api.z.ai") ||
        url.includes("minimax"),
    )
  ) {
    return "custom-openai";
  }
  if (
    urls.some(
      (url) =>
        url.includes("x.ai") || url.includes("cli-chat-proxy.grok.com"),
    )
  ) {
    return "xai";
  }

  if (input.customProtocol === "claude") return "custom-claude";
  if (input.customProtocol === "openai") return "custom-openai";
  return "custom-openai-responses";
}

/** 预设供应商写入凭证时，需要同步的协议槽位。 */
export function getProviderCredentialSlots(
  providerId: AIProviderId,
): CustomAIProtocol[] {
  if (providerId === "deepseek" || providerId === "xai") {
    // deepseek: Flash=Responses / Pro=兼容；xai: oauth 走 Responses(cli-proxy)
    // 保存时两端都写入，运行时按 preferredAuthMode 覆盖 baseURL/协议
    return ["openai-responses", "openai"];
  }
  return [getAIProviderPreset(providerId).protocol];
}

export function getProviderFixedBaseURL(
  providerId: AIProviderId,
): string | null {
  return getAIProviderPreset(providerId).baseURL;
}

function normalizeBaseURLForCompare(url: string): string {
  return url.replace(/\/+$/, "").toLowerCase();
}

/**
 * 共享槽中的 base 是否属于「其它内置供应商」的固定/官方 URL。
 * 当前 provider 不是对应内置时不得采用该 base（避免 xai/deepseek 污染 custom 读路径）。
 */
export function isForeignProviderBaseURL(
  url: string,
  providerId: AIProviderId,
): boolean {
  const u = normalizeBaseURLForCompare(url.trim());
  if (!u) return false;

  const xaiBases = [XAI_BASE_URL, XAI_CLI_SESSION_BASE_URL].map(
    normalizeBaseURLForCompare,
  );
  const isXai =
    xaiBases.includes(u) ||
    u.includes("api.x.ai") ||
    u.includes("cli-chat-proxy.grok.com");
  if (isXai && providerId !== "xai") return true;

  const deepseekBases = [DEEPSEEK_BASE_URL].map(normalizeBaseURLForCompare);
  const isDeepseek =
    deepseekBases.includes(u) || u.includes("api.deepseek.com");
  if (isDeepseek && providerId !== "deepseek") return true;

  return false;
}

export function isCustomProviderId(providerId: AIProviderId): boolean {
  return (
    providerId === "custom-openai" ||
    providerId === "custom-openai-responses" ||
    providerId === "custom-claude"
  );
}

/** 供应商鉴权模式列表（非法 id 视为仅 api_key）。 */
export function providerAuthModes(
  providerId: AIProviderId | string | null | undefined,
): AIProviderAuthMode[] {
  if (!isAIProviderId(providerId)) return ["api_key"];
  return getAIProviderPreset(providerId).authModes;
}

/** 供应商是否支持账号 OAuth 登录（authModes 含 oauth）。 */
export function providerSupportsOAuth(
  providerId: AIProviderId | string | null | undefined,
): boolean {
  return providerAuthModes(providerId).includes("oauth");
}

/** 供应商是否支持 API Key（authModes 含 api_key）。 */
export function providerSupportsApiKey(
  providerId: AIProviderId | string | null | undefined,
): boolean {
  return providerAuthModes(providerId).includes("api_key");
}

/** 供应商控制台 / 获取 Key 页面；无则 null。 */
export function getProviderConsoleUrl(
  providerId: AIProviderId | string | null | undefined,
): string | null {
  const url = getAIProviderPreset(providerId).consoleUrl?.trim();
  return url || null;
}
