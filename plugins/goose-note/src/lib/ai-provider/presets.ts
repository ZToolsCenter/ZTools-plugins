import type { AIModelOption, CustomAIProtocol } from "./types";

/**
 * AI 供应商预设。
 * 用户只选供应商并填 Key；协议 / Base URL / 模型分支内部处理。
 */
export type AIProviderId =
  | "deepseek"
  | "glm"
  | "minimax"
  | "custom-openai-responses"
  | "custom-openai"
  | "custom-claude";

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
  /** 拉取模型失败时的兜底列表 */
  fallbackModels?: AIModelOption[];
}

/** 官方文档：https://api-docs.deepseek.com/ */
export const DEEPSEEK_BASE_URL = "https://api.deepseek.com";

/** 官方文档：https://docs.bigmodel.cn/cn/guide/develop/openai/introduction */
export const GLM_BASE_URL = "https://open.bigmodel.cn/api/paas/v4";

/**
 * 大陆用户优先国内域名。
 * 官方：https://platform.minimax.io / https://api.minimaxi.com
 */
export const MINIMAX_BASE_URL = "https://api.minimaxi.com/v1";

export const AI_PROVIDER_PRESETS: AIProviderPreset[] = [
  {
    id: "deepseek",
    label: "DeepSeek",
    description: "官方 · 填 Key 即用",
    baseURL: DEEPSEEK_BASE_URL,
    protocol: "openai-responses",
    allowCustomBaseURL: false,
    fallbackModels: [
      { id: "deepseek-v4-flash", label: "DeepSeek V4 Flash" },
      { id: "deepseek-v4-pro", label: "DeepSeek V4 Pro" },
    ],
  },
  {
    id: "glm",
    label: "GLM（智谱）",
    description: "智谱官方",
    baseURL: GLM_BASE_URL,
    protocol: "openai",
    allowCustomBaseURL: false,
    fallbackModels: [
      { id: "glm-5.2", label: "GLM-5.2" },
      { id: "glm-4.7-flash", label: "GLM-4.7 Flash" },
    ],
  },
  {
    id: "minimax",
    label: "MiniMax",
    description: "国内官方",
    baseURL: MINIMAX_BASE_URL,
    protocol: "openai",
    allowCustomBaseURL: false,
    fallbackModels: [
      { id: "MiniMax-M3", label: "MiniMax M3" },
      { id: "MiniMax-M2.5", label: "MiniMax M2.5" },
    ],
  },
  {
    id: "custom-openai-responses",
    label: "自定义 OpenAI Responses",
    description: "Responses 协议",
    baseURL: null,
    protocol: "openai-responses",
    allowCustomBaseURL: true,
  },
  {
    id: "custom-openai",
    label: "自定义 OpenAI 兼容",
    description: "Chat Completions",
    baseURL: null,
    protocol: "openai",
    allowCustomBaseURL: true,
  },
  {
    id: "custom-claude",
    label: "自定义 Anthropic",
    description: "Messages API",
    baseURL: null,
    protocol: "claude",
    allowCustomBaseURL: true,
  },
];

const PRESET_BY_ID = new Map(
  AI_PROVIDER_PRESETS.map((preset) => [preset.id, preset]),
);

export function getAIProviderPreset(
  providerId: AIProviderId | string | null | undefined,
): AIProviderPreset {
  if (providerId && PRESET_BY_ID.has(providerId as AIProviderId)) {
    return PRESET_BY_ID.get(providerId as AIProviderId)!;
  }
  return AI_PROVIDER_PRESETS[0];
}

export function isAIProviderId(value: unknown): value is AIProviderId {
  return (
    typeof value === "string" && PRESET_BY_ID.has(value as AIProviderId)
  );
}

/** DeepSeek V4 Pro 尚不支持 Responses，走兼容 Chat Completions。 */
export function isDeepSeekProModel(modelId: string | null | undefined): boolean {
  if (!modelId) return false;
  return /deepseek-v4-pro|v4-pro/i.test(modelId.trim());
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
  if (urls.some((url) => url.includes("bigmodel.cn") || url.includes("api.z.ai"))) {
    return "glm";
  }
  if (urls.some((url) => url.includes("minimax"))) {
    return "minimax";
  }

  if (input.customProtocol === "claude") return "custom-claude";
  if (input.customProtocol === "openai") return "custom-openai";
  return "custom-openai-responses";
}

/** 预设供应商写入凭证时，需要同步的协议槽位。 */
export function getProviderCredentialSlots(
  providerId: AIProviderId,
): CustomAIProtocol[] {
  if (providerId === "deepseek") {
    // Flash 用 Responses、Pro 用兼容，保存时两端都写入同一 Key/URL
    return ["openai-responses", "openai"];
  }
  return [getAIProviderPreset(providerId).protocol];
}

export function getProviderFixedBaseURL(
  providerId: AIProviderId,
): string | null {
  return getAIProviderPreset(providerId).baseURL;
}
