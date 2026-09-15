/**
 * 供应商鉴权模式：api_key / oauth 类型与统一 resolve。
 * 一期可不真登录；类型、normalize 与取 token 路径完整。
 *
 * 仅依赖 presets / types，避免与 modelCatalog 循环引用。
 */
import type { AISettingsLike, CustomAIProtocol } from "./types";
import {
  inferProviderIdFromSettings,
  isAIProviderId,
  isCustomProviderId,
  isForeignProviderBaseURL,
  providerAuthModes,
  providerSupportsApiKey,
  resolveProtocolForProvider,
  type AIProviderId,
} from "./presets";

export type { AIProviderAuthMode } from "./presets";
export {
  providerAuthModes,
  providerSupportsApiKey,
  providerSupportsOAuth,
} from "./presets";

export type AIAuthMode = "api_key" | "oauth";

/** OAuth 会话（一期可选；不真登录也保留完整字段） */
export interface AIOAuthSession {
  accessToken: string;
  refreshToken?: string;
  /** 过期时间，Unix 毫秒 */
  expiresAt?: number;
  accountLabel?: string;
  providerId?: string;
  /** 本机 CLI 来源（如 grok_cli / opencodex）；多 source 时用于 UI 仅高亮一行 */
  source?: string;
}

export type RequestCredential =
  | { type: "api_key"; token: string }
  | { type: "oauth"; token: string };

/** 由会话字段推导的 OAuth 连接态（供 UI） */
export type OAuthDerivedStatus = "idle" | "connected" | "expired";

/**
 * 供应商 OAuth 适配器接口预留。
 * 一期 registry 空；真登录接入时按 providerId 注册。
 */
export interface ProviderOAuthAdapter {
  providerId: string;
  startLogin(): Promise<void>;
  // optional: refresh, logout, getSession
}

const OAUTH_EXPIRY_SKEW_MS = 30_000;

/** 一期无适配器实现 */
const OAUTH_ADAPTER_REGISTRY = new Map<string, ProviderOAuthAdapter>();

export function isAIAuthMode(value: unknown): value is AIAuthMode {
  return value === "api_key" || value === "oauth";
}

function getProviderId(settings: AISettingsLike): AIProviderId {
  if (isAIProviderId(settings.customProviderId)) {
    return settings.customProviderId;
  }
  return inferProviderIdFromSettings(settings);
}

/**
 * 用户偏好鉴权模式（auth-mode-first：顶层「本机账号 | API 密钥」驱动）。
 * - 显式 preferredAuthMode=api_key → 始终 api_key（即使 customProviderId 为 xai）
 * - 显式 oauth → oauth（供应商支持或已有有效 session）
 * - 缺省：oauth-only 供应商 → oauth；否则 api_key
 */
export function getPreferredAuthMode(ai: AISettingsLike): AIAuthMode {
  const providerId = getProviderId(ai);
  const modes = providerAuthModes(providerId);
  const supportsOAuth = modes.includes("oauth");
  const supportsApiKey = modes.includes("api_key");

  if (ai.preferredAuthMode === "api_key") {
    return "api_key";
  }

  if (ai.preferredAuthMode === "oauth") {
    // 有有效 session 时允许 oauth（session.providerId 可为 xai，customProviderId 可能滞后）
    if (hasValidOAuthSession(ai) || supportsOAuth) return "oauth";
    return "api_key";
  }

  // 缺省未写 preferred：oauth-only 供应商仍走 oauth
  if (supportsOAuth && !supportsApiKey) return "oauth";
  if (supportsApiKey && !supportsOAuth) return "api_key";
  if (supportsOAuth) return "oauth";
  return "api_key";
}

export function hasValidOAuthSession(
  ai: Pick<AISettingsLike, "oauthSession"> | AISettingsLike,
): boolean {
  return deriveOAuthStatus(ai.oauthSession) === "connected";
}

/**
 * 由 OAuth 会话推导 UI 状态：无 token → idle；过期 → expired；否则 connected。
 */
export function deriveOAuthStatus(
  session:
    | AIOAuthSession
    | AISettingsLike["oauthSession"]
    | null
    | undefined,
): OAuthDerivedStatus {
  if (!session || typeof session !== "object") return "idle";
  const token =
    typeof session.accessToken === "string" ? session.accessToken.trim() : "";
  if (!token) return "idle";
  if (
    typeof session.expiresAt === "number" &&
    Number.isFinite(session.expiresAt)
  ) {
    if (Date.now() >= session.expiresAt - OAUTH_EXPIRY_SKEW_MS) {
      return "expired";
    }
  }
  return "connected";
}

function resolveProtocol(
  settings: AISettingsLike,
  protocol?: CustomAIProtocol,
): CustomAIProtocol {
  if (protocol) return protocol;
  const providerId = getProviderId(settings);
  const modelId = settings.selectedModelId?.trim() || null;
  return resolveProtocolForProvider(
    providerId,
    modelId,
    settings.customProtocol,
  );
}

/**
 * 与 getCustomAIApiKey 同语义的薄读取（不 import modelCatalog，避免循环依赖）。
 * api_key 模式优先 per-provider 快照，再回退共享协议槽。
 * 自定义无 snap 且共享 base 为 foreign 时不信任共享槽 key。
 */
function readApiKey(
  settings: AISettingsLike,
  protocol: CustomAIProtocol,
): string {
  const providerId = getProviderId(settings);
  const snapKey =
    settings.providerCredentials?.[providerId]?.apiKey?.trim() ?? "";
  if (snapKey) return snapKey;

  // 无 snap 时：共享槽若为其它内置官方 URL，不采用槽内 key（可能是污染残留）
  if (isCustomProviderId(providerId)) {
    const snapBase =
      settings.providerCredentials?.[providerId]?.baseURL?.trim() ?? "";
    if (!snapBase) {
      const sharedBase =
        protocol === "claude"
          ? settings.customClaudeBaseURL?.trim() || ""
          : protocol === "openai"
            ? settings.customOpenAIBaseURL?.trim() || ""
            : settings.customOpenAIResponsesBaseURL?.trim() || "";
      if (sharedBase && isForeignProviderBaseURL(sharedBase, providerId)) {
        return "";
      }
    }
  }

  const key = (
    protocol === "openai-responses"
      ? settings.customOpenAIResponsesApiKey
      : protocol === "openai"
        ? settings.customOpenAIApiKey
        : settings.customClaudeApiKey
  )?.trim();

  if (key) return key;

  // DeepSeek / xai 双协议共用同一 Key
  if (providerId === "deepseek" || providerId === "xai") {
    return (
      settings.customOpenAIResponsesApiKey?.trim() ||
      settings.customOpenAIApiKey?.trim() ||
      ""
    );
  }

  return "";
}

/**
 * 任一凭证曾配置（有效 API Key 或有效 OAuth）。
 * 语义给 onboarding / 清单：有任一即可进工作台。
 */
export function hasConfiguredCredential(ai: AISettingsLike): boolean {
  if (readApiKey(ai, resolveProtocol(ai))) return true;
  return hasValidOAuthSession(ai);
}

/**
 * preferred 侧是否有有效凭证（与 getRequestCredential / getAIAvailability 一致）。
 * 发送门控、可用性检查应使用本函数，禁止静默跨模式。
 */
export function hasActiveCredential(ai: AISettingsLike): boolean {
  return getRequestCredential(ai) !== null;
}

/**
 * 解析本次请求凭证。
 * **仅**返回 preferred 侧有效凭证；禁止静默跨模式回落。
 * preferred=oauth 且会话无效 → null；preferred=api_key 且无 Key → null。
 */
export function getRequestCredential(
  ai: AISettingsLike,
  protocol?: CustomAIProtocol,
): RequestCredential | null {
  const preferred = getPreferredAuthMode(ai);

  if (preferred === "oauth") {
    if (!hasValidOAuthSession(ai)) return null;
    const token = ai.oauthSession?.accessToken?.trim() ?? "";
    if (!token) return null;
    return { type: "oauth", token };
  }

  const activeProtocol = resolveProtocol(ai, protocol);
  const apiKey = readApiKey(ai, activeProtocol);
  if (!apiKey) return null;
  return { type: "api_key", token: apiKey };
}

/**
 * 无 active 凭证时的可操作提示：按 preferred 引导登录或填 Key。
 */
export function getActiveCredentialMissingMessage(ai: AISettingsLike): string {
  const preferred = getPreferredAuthMode(ai);
  if (preferred === "oauth") {
    if (providerSupportsApiKey(getProviderId(ai))) {
      return "账号登录无效或已过期。请重新登录，或切换到 API 密钥。";
    }
    return "账号登录无效或已过期。请在 Grok CLI 重新登录后导入。";
  }
  return "未填写有效 API Key。";
}

/** 按 providerId 取 OAuth 适配器；一期 registry 空，恒返回 null。 */
export function getOAuthAdapter(
  providerId: string,
): ProviderOAuthAdapter | null {
  return OAUTH_ADAPTER_REGISTRY.get(providerId) ?? null;
}
