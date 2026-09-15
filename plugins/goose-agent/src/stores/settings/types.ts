import {
  DEFAULT_CLAUDE_BASE_URL,
  DEFAULT_OPENAI_BASE_URL,
  DEEPSEEK_BASE_URL,
  getAIProviderPreset,
  getProviderCredentialSlots,
  getProviderFixedBaseURL,
  inferProviderIdFromSettings,
  isAIProviderId,
  providerSupportsApiKey,
  providerSupportsOAuth,
  XAI_BASE_URL,
  XAI_CLI_SESSION_BASE_URL,
  type AIAuthMode,
  type AIOAuthSession,
  type AIModelOption,
  type AIProviderId,
  type AIReasoningLevel,
  type CustomAIProtocol,
} from "@/lib/ai-provider";
import {
  normalizeModelsByProvider,
  type ModelsByProvider,
} from "@/lib/ai-provider/modelRef";

/** Agent 运行时；默认 pi。 */
export type AIAgentRuntime = "pi" | "legacy";

export type { AIAuthMode, AIOAuthSession };

export interface AISettings {
  /** 始终 true；历史存储可能为 false，读入时强制纠正 */
  enabled: boolean;
  readGlobalPrompt: boolean;
  readLocalSkills: boolean;
  runtime: AIAgentRuntime;
  selectedModelId: string | null;
  workspaceSelectedModelId: string | null;
  workspaceReasoningLevel: AIReasoningLevel;
  /** 供应商预设（DeepSeek / 自定义 / xai OAuth 路由…） */
  customProviderId: AIProviderId;
  customProtocol: CustomAIProtocol;
  customOpenAIResponsesBaseURL: string;
  customOpenAIBaseURL: string;
  customClaudeBaseURL: string;
  customOpenAIResponsesApiKey: string;
  customOpenAIApiKey: string;
  customClaudeApiKey: string;
  customModelOptions: AIModelOption[];
  /**
   * 各供应商模型缓存（Composer 多供应商聚合用）。
   * 保存 Key / 导入 OAuth 时写入对应 provider 桶。
   */
  modelsByProvider: ModelsByProvider;
  /**
   * 各供应商隔离的 baseURL + apiKey。
   * 共享协议槽 dual-write 仍保留；本 map 是切换/请求时其它供应商的真相源。
   */
  providerCredentials: Partial<
    Record<AIProviderId, { baseURL: string; apiKey: string }>
  >;
  /** 首选鉴权模式；默认 api_key */
  preferredAuthMode: AIAuthMode;
  /** OAuth 会话；一期可选，不真登录 */
  oauthSession: AIOAuthSession | null;
  /**
   * 供应商是否在 Composer 模型列表中显示；与凭证独立。
   * 缺省键：normalize 时对已有凭证/模型的供应商迁为 true；手动 false 会粘住。
   */
  enabledProviders: Partial<Record<AIProviderId, boolean>>;
}

export function normalizeAIModelOptions(
  modelOptions: AIModelOption[] | undefined,
): AIModelOption[] {
  if (!Array.isArray(modelOptions)) {
    return [];
  }

  return modelOptions
    .filter((item): item is AIModelOption =>
      Boolean(item && typeof item === "object"),
    )
    .map((item) => ({
      id: typeof item.id === "string" ? item.id.trim() : "",
      label: typeof item.label === "string" ? item.label.trim() : "",
      description:
        typeof item.description === "string" && item.description.trim()
          ? item.description.trim()
          : undefined,
      contextWindow:
        typeof item.contextWindow === "number" && item.contextWindow > 0
          ? Math.floor(item.contextWindow)
          : undefined,
      supportsVision:
        typeof item.supportsVision === "boolean"
          ? item.supportsVision
          : undefined,
    }))
    .filter((item) => item.id && item.label);
}

export function normalizeAIBaseURL(value: unknown, fallback: string) {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

export function normalizeAIApiKey(value: unknown, fallback = "") {
  return typeof value === "string" ? value.trim() : fallback;
}

/** 单条供应商凭证快照 */
export type ProviderCredentialSnapshot = {
  baseURL: string;
  apiKey: string;
};

/**
 * 归一化 providerCredentials：非法键丢掉；字符串 trim。
 * 仅保留 baseURL 或 apiKey 至少一个非空的条目。
 */
export function normalizeProviderCredentials(
  raw: unknown,
): Partial<Record<AIProviderId, ProviderCredentialSnapshot>> {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const out: Partial<Record<AIProviderId, ProviderCredentialSnapshot>> = {};
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if (!isAIProviderId(k)) continue;
    if (!v || typeof v !== "object" || Array.isArray(v)) continue;
    const entry = v as Record<string, unknown>;
    const baseURL =
      typeof entry.baseURL === "string" ? entry.baseURL.trim() : "";
    const apiKey = typeof entry.apiKey === "string" ? entry.apiKey.trim() : "";
    if (!baseURL && !apiKey) continue;
    out[k] = { baseURL, apiKey };
  }
  return out;
}

/**
 * 已知固定/官方 URL：不可迁移进 custom-* 的 credentials（避免 xai 污染）。
 */
function isKnownOfficialBaseURL(url: string): boolean {
  const u = url.replace(/\/+$/, "").toLowerCase();
  if (!u) return false;
  const known = [
    XAI_BASE_URL,
    XAI_CLI_SESSION_BASE_URL,
    DEEPSEEK_BASE_URL,
    DEFAULT_OPENAI_BASE_URL,
    DEFAULT_CLAUDE_BASE_URL,
  ].map((x) => x.replace(/\/+$/, "").toLowerCase());
  return known.includes(u);
}

/**
 * 从共享协议槽读取某供应商当前凭证快照（用于迁移 / 回退）。
 */
function readSharedSlotSnapshot(
  providerId: AIProviderId,
  protocol: CustomAIProtocol,
  slots: {
    customOpenAIResponsesBaseURL: string;
    customOpenAIBaseURL: string;
    customClaudeBaseURL: string;
    customOpenAIResponsesApiKey: string;
    customOpenAIApiKey: string;
    customClaudeApiKey: string;
  },
): ProviderCredentialSnapshot {
  const credentialSlots = getProviderCredentialSlots(providerId);
  let baseURL = "";
  let apiKey = "";
  if (credentialSlots.includes("openai-responses")) {
    baseURL = slots.customOpenAIResponsesBaseURL.trim() || baseURL;
    apiKey = slots.customOpenAIResponsesApiKey.trim() || apiKey;
  }
  if (credentialSlots.includes("openai")) {
    // 单协议 openai 优先该槽；双槽时若 responses 已有 base 则保留
    if (!baseURL || protocol === "openai") {
      baseURL = slots.customOpenAIBaseURL.trim() || baseURL;
    }
    apiKey = slots.customOpenAIApiKey.trim() || apiKey;
  }
  if (credentialSlots.includes("claude")) {
    baseURL = slots.customClaudeBaseURL.trim() || baseURL;
    apiKey = slots.customClaudeApiKey.trim() || apiKey;
  }
  // 按当前协议再校正一次 base（与 getCustomAI* 共享槽语义一致）
  if (protocol === "claude") {
    baseURL = slots.customClaudeBaseURL.trim() || baseURL;
    apiKey = slots.customClaudeApiKey.trim() || apiKey;
  } else if (protocol === "openai") {
    baseURL = slots.customOpenAIBaseURL.trim() || baseURL;
    apiKey =
      slots.customOpenAIApiKey.trim() ||
      slots.customOpenAIResponsesApiKey.trim() ||
      apiKey;
  } else {
    baseURL = slots.customOpenAIResponsesBaseURL.trim() || baseURL;
    apiKey =
      slots.customOpenAIResponsesApiKey.trim() ||
      slots.customOpenAIApiKey.trim() ||
      apiKey;
  }
  return { baseURL, apiKey };
}

export function normalizeAIReasoningLevel(value: unknown): AIReasoningLevel {
  if (value === "low" || value === "medium" || value === "high") {
    return value;
  }
  // 历史 "default" 与非法值统一为中
  return "medium";
}

export function normalizeAIAuthMode(value: unknown): AIAuthMode {
  return value === "oauth" ? "oauth" : "api_key";
}

/** 兼容旧数据：无 accessToken 则 null */
export function normalizeAIOAuthSession(value: unknown): AIOAuthSession | null {
  if (!value || typeof value !== "object") return null;
  const raw = value as Record<string, unknown>;
  const accessToken =
    typeof raw.accessToken === "string" ? raw.accessToken.trim() : "";
  if (!accessToken) return null;

  const session: AIOAuthSession = { accessToken };

  if (typeof raw.refreshToken === "string" && raw.refreshToken.trim()) {
    session.refreshToken = raw.refreshToken.trim();
  }
  if (typeof raw.expiresAt === "number" && Number.isFinite(raw.expiresAt)) {
    session.expiresAt = raw.expiresAt;
  }
  if (typeof raw.accountLabel === "string" && raw.accountLabel.trim()) {
    session.accountLabel = raw.accountLabel.trim();
  }
  if (typeof raw.providerId === "string" && raw.providerId.trim()) {
    session.providerId = raw.providerId.trim();
  }
  if (typeof raw.source === "string" && raw.source.trim()) {
    session.source = raw.source.trim();
  }

  return session;
}

export function normalizeAISettings(
  ai: Partial<AISettings> | undefined,
): AISettings {
  const customModelOptions = normalizeAIModelOptions(ai?.customModelOptions);
  const modelsByProvider = normalizeModelsByProvider(
    (ai as { modelsByProvider?: unknown } | undefined)?.modelsByProvider,
  );
  const storedSelectedModelId =
    typeof ai?.selectedModelId === "string" && ai.selectedModelId.trim()
      ? ai.selectedModelId.trim()
      : null;
  const storedWorkspaceSelectedModelId =
    typeof ai?.workspaceSelectedModelId === "string" &&
    ai.workspaceSelectedModelId.trim()
      ? ai.workspaceSelectedModelId.trim()
      : null;
  const legacyAI = (ai ?? {}) as Partial<AISettings> & {
    customBaseURL?: unknown;
    customApiKey?: unknown;
  };
  const legacyBaseURL =
    typeof legacyAI.customBaseURL === "string"
      ? legacyAI.customBaseURL.trim()
      : "";
  const legacyApiKey =
    typeof legacyAI.customApiKey === "string"
      ? legacyAI.customApiKey.trim()
      : "";
  const customProtocol: CustomAIProtocol =
    ai?.customProtocol === "openai-responses" ||
    ai?.customProtocol === "openai" ||
    ai?.customProtocol === "claude"
      ? ai.customProtocol
      : legacyApiKey || legacyBaseURL
        ? "openai"
        : "openai-responses";
  // selected 可为 provider/model；与 options 比对时剥前缀
  const selectedMatchesOptions = (id: string | null) => {
    if (!id) return false;
    if (customModelOptions.length === 0) return true;
    return customModelOptions.some(
      (item) =>
        item.id === id ||
        id.endsWith(`/${item.id}`) ||
        item.id === id.split("/").slice(1).join("/"),
    );
  };
  const selectedModelId = selectedMatchesOptions(storedSelectedModelId)
    ? storedSelectedModelId
    : customModelOptions[0]?.id
      ? storedSelectedModelId &&
        storedSelectedModelId.includes("/")
        ? // 保留 provider 前缀风格，用当前第一项裸 id 不够；先裸 id
          customModelOptions[0].id
        : customModelOptions[0].id
      : null;

  const runtime: AIAgentRuntime =
    ai?.runtime === "legacy" || ai?.runtime === "pi" ? ai.runtime : "pi";

  const customOpenAIResponsesBaseURL = normalizeAIBaseURL(
    ai?.customOpenAIResponsesBaseURL,
    customProtocol === "openai-responses" && legacyBaseURL
      ? legacyBaseURL
      : DEFAULT_OPENAI_BASE_URL,
  );
  const customOpenAIBaseURL = normalizeAIBaseURL(
    ai?.customOpenAIBaseURL,
    customProtocol === "openai" && legacyBaseURL
      ? legacyBaseURL
      : DEFAULT_OPENAI_BASE_URL,
  );
  const customClaudeBaseURL = normalizeAIBaseURL(
    ai?.customClaudeBaseURL,
    customProtocol === "claude" && legacyBaseURL
      ? legacyBaseURL
      : DEFAULT_CLAUDE_BASE_URL,
  );

  // 存量 glm / minimax → custom-openai（保留 Base URL）
  const customProviderId: AIProviderId = isAIProviderId(ai?.customProviderId)
    ? ai.customProviderId
    : inferProviderIdFromSettings({
        customProviderId: ai?.customProviderId,
        customProtocol,
        customOpenAIResponsesBaseURL,
        customOpenAIBaseURL,
        customClaudeBaseURL,
      });

  // 存量 glm/minimax 已不在 AIProviderId；Partial 入参按 unknown 收窄
  const rawStoredProviderId = String(
    (ai as { customProviderId?: unknown } | undefined)?.customProviderId ?? "",
  );
  const isLegacyGlmOrMinimax =
    rawStoredProviderId === "glm" || rawStoredProviderId === "minimax";
  const looksLikeLegacyGlmMinimaxBase =
    customOpenAIBaseURL.includes("bigmodel") ||
    customOpenAIBaseURL.includes("minimax") ||
    customOpenAIResponsesBaseURL.includes("bigmodel") ||
    customOpenAIResponsesBaseURL.includes("minimax");

  // 若历史固定 Base 仍在 openai 槽且已迁到 custom-openai，协议对齐 openai
  const migratedProtocol: CustomAIProtocol =
    customProviderId === "custom-openai" &&
    (isLegacyGlmOrMinimax ||
      (customProtocol === "openai-responses" && looksLikeLegacyGlmMinimaxBase))
      ? "openai"
      : customProtocol;

  // glm/minimax 可能把 base 写在 responses 槽：迁到 openai 槽以免丢失
  let nextOpenAIBaseURL = customOpenAIBaseURL;
  let nextOpenAIResponsesBaseURL = customOpenAIResponsesBaseURL;
  if (customProviderId === "custom-openai" && isLegacyGlmOrMinimax) {
    const legacyBase =
      (customOpenAIBaseURL &&
      customOpenAIBaseURL !== "https://api.openai.com/v1"
        ? customOpenAIBaseURL
        : "") ||
      (customOpenAIResponsesBaseURL &&
      customOpenAIResponsesBaseURL !== "https://api.openai.com/v1"
        ? customOpenAIResponsesBaseURL
        : "");
    if (legacyBase) {
      nextOpenAIBaseURL = legacyBase;
    }
  }

  // 遗留：仅有 customModelOptions 时灌入当前供应商桶；桶优先保留他供应商
  let resolvedModelsByProvider: ModelsByProvider = modelsByProvider;
  if (
    Object.keys(modelsByProvider).length === 0 &&
    customModelOptions.length > 0 &&
    isAIProviderId(customProviderId)
  ) {
    resolvedModelsByProvider = { [customProviderId]: customModelOptions };
  } else if (
    isAIProviderId(customProviderId) &&
    customModelOptions.length > 0
  ) {
    resolvedModelsByProvider = {
      ...modelsByProvider,
      [customProviderId]: modelsByProvider[customProviderId]?.length
        ? modelsByProvider[customProviderId]!
        : customModelOptions,
    };
  }

  const oauthSession = normalizeAIOAuthSession(ai?.oauthSession);

  const nextOpenAIResponsesApiKey = normalizeAIApiKey(
    ai?.customOpenAIResponsesApiKey,
    customProtocol === "openai-responses" ? legacyApiKey : "",
  );
  const nextOpenAIApiKey = normalizeAIApiKey(
    ai?.customOpenAIApiKey,
    customProtocol === "openai" ? legacyApiKey : "",
  );
  const nextClaudeApiKey = normalizeAIApiKey(
    ai?.customClaudeApiKey,
    customProtocol === "claude" ? legacyApiKey : "",
  );

  // per-provider 凭证快照：非法键丢弃；对 enabled 或有 modelsByProvider 的供应商尽量从共享槽补 snap
  let providerCredentials = normalizeProviderCredentials(
    (ai as { providerCredentials?: unknown } | undefined)?.providerCredentials,
  );

  const sharedSlotBundle = {
    customOpenAIResponsesBaseURL: nextOpenAIResponsesBaseURL,
    customOpenAIBaseURL: nextOpenAIBaseURL,
    customClaudeBaseURL,
    customOpenAIResponsesApiKey: nextOpenAIResponsesApiKey,
    customOpenAIApiKey: nextOpenAIApiKey,
    customClaudeApiKey: nextClaudeApiKey,
  };

  const tryMigrateSnap = (
    pid: AIProviderId,
    protocol: CustomAIProtocol,
  ): void => {
    if (providerCredentials[pid]) return;
    const snap = readSharedSlotSnapshot(pid, protocol, sharedSlotBundle);
    if (!snap.baseURL && !snap.apiKey) return;
    // 勿把 xai/deepseek 官方 URL 误记到 custom-*
    const isCustom =
      pid === "custom-openai" ||
      pid === "custom-openai-responses" ||
      pid === "custom-claude";
    if (isCustom && snap.baseURL && isKnownOfficialBaseURL(snap.baseURL)) {
      return;
    }
    // 内置 fixed-base 供应商：base 用固定值，key 可从共享槽迁
    const fixed = getProviderFixedBaseURL(pid);
    providerCredentials = {
      ...providerCredentials,
      [pid]: {
        baseURL: fixed ?? snap.baseURL,
        apiKey: snap.apiKey,
      },
    };
  };

  // 当前 active 供应商（有模型时）优先迁移
  if (
    isAIProviderId(customProviderId) &&
    (resolvedModelsByProvider[customProviderId]?.length ||
      customModelOptions.length > 0)
  ) {
    tryMigrateSnap(customProviderId, migratedProtocol);
  }

  // 对 modelsByProvider 有列表、或 enabledProviders true 的其它供应商：
  // 仅当共享槽可安全归属时补 snap（内置 fixed-base 可迁 key；custom 仅非官方 URL）
  const rawEnabled = (ai as { enabledProviders?: unknown } | undefined)
    ?.enabledProviders;
  const enabledMap =
    rawEnabled && typeof rawEnabled === "object" && !Array.isArray(rawEnabled)
      ? (rawEnabled as Record<string, unknown>)
      : {};

  const candidateProviders = new Set<AIProviderId>();
  for (const pid of Object.keys(resolvedModelsByProvider) as AIProviderId[]) {
    if (isAIProviderId(pid) && resolvedModelsByProvider[pid]?.length) {
      candidateProviders.add(pid);
    }
  }
  for (const [k, v] of Object.entries(enabledMap)) {
    if (v === true && isAIProviderId(k)) candidateProviders.add(k);
  }

  for (const pid of candidateProviders) {
    if (pid === customProviderId) continue;
    // 非 active 的 custom：共享槽通常属于 active，不可安全归属则跳过
    const isCustom =
      pid === "custom-openai" ||
      pid === "custom-openai-responses" ||
      pid === "custom-claude";
    if (isCustom) {
      continue;
    }
    // 内置 deepseek/xai：仅当共享槽 base 可归属到该官方域名时才迁（避免 LiteLLM 污染）
    const protocol = getAIProviderPreset(pid).protocol;
    const probe = readSharedSlotSnapshot(pid, protocol, sharedSlotBundle);
    if (!probe.apiKey && !probe.baseURL) continue;
    const fixed = getProviderFixedBaseURL(pid);
    const baseNorm = (probe.baseURL || "").replace(/\/+$/, "").toLowerCase();
    const fixedNorm = (fixed || "").replace(/\/+$/, "").toLowerCase();
    const belongsToBuiltin =
      Boolean(fixedNorm) &&
      (baseNorm === fixedNorm ||
        (pid === "xai" &&
          (baseNorm.includes("api.x.ai") ||
            baseNorm.includes("cli-chat-proxy.grok.com"))) ||
        (pid === "deepseek" && baseNorm.includes("deepseek.com")));
    if (!belongsToBuiltin) continue;
    tryMigrateSnap(pid, protocol);
  }

  return {
    enabled: true,
    readGlobalPrompt:
      typeof ai?.readGlobalPrompt === "boolean" ? ai.readGlobalPrompt : true,
    readLocalSkills:
      typeof ai?.readLocalSkills === "boolean" ? ai.readLocalSkills : true,
    runtime,
    selectedModelId,
    workspaceSelectedModelId: storedWorkspaceSelectedModelId,
    workspaceReasoningLevel: normalizeAIReasoningLevel(
      ai?.workspaceReasoningLevel,
    ),
    customProviderId,
    customProtocol: migratedProtocol,
    customOpenAIResponsesBaseURL: nextOpenAIResponsesBaseURL,
    customOpenAIBaseURL: nextOpenAIBaseURL,
    customClaudeBaseURL,
    customOpenAIResponsesApiKey: nextOpenAIResponsesApiKey,
    customOpenAIApiKey: nextOpenAIApiKey,
    customClaudeApiKey: nextClaudeApiKey,
    customModelOptions,
    modelsByProvider: resolvedModelsByProvider,
    providerCredentials,
    preferredAuthMode: (() => {
      const mode = normalizeAIAuthMode(ai?.preferredAuthMode);
      const supportsOAuth = providerSupportsOAuth(customProviderId);
      const sessionOk = Boolean(oauthSession?.accessToken?.trim());
      // auth-mode-first：显式 api_key 保留；oauth 需支持或已有 session
      if (mode === "api_key") return "api_key" as const;
      if (mode === "oauth") {
        if (supportsOAuth || sessionOk) return "oauth" as const;
        return "api_key" as const;
      }
      // 缺省：oauth-only 供应商 → oauth
      if (supportsOAuth && !providerSupportsApiKey(customProviderId)) {
        return "oauth" as const;
      }
      return mode;
    })(),
    oauthSession,
    enabledProviders: normalizeEnabledProviders(
      (ai as { enabledProviders?: unknown } | undefined)?.enabledProviders,
      resolvedModelsByProvider,
      customProviderId,
      customModelOptions,
      oauthSession,
    ),
  };
}

/**
 * 归一化 enabledProviders。
 * - 显式 true/false 保留
 * - 存量无 map / 键缺失：对已有模型桶或当前供应商有模型的 id 迁为 true（旧安装不丢列表）
 */
function normalizeEnabledProviders(
  raw: unknown,
  modelsByProvider: ModelsByProvider,
  customProviderId: AIProviderId,
  customModelOptions: AIModelOption[],
  oauthSession: AIOAuthSession | null,
): Partial<Record<AIProviderId, boolean>> {
  const out: Partial<Record<AIProviderId, boolean>> = {};
  if (raw && typeof raw === "object" && !Array.isArray(raw)) {
    for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
      if (!isAIProviderId(k)) continue;
      if (v === true) out[k] = true;
      else if (v === false) out[k] = false;
    }
  }

  const candidateIds = new Set<AIProviderId>();
  for (const pid of Object.keys(modelsByProvider) as AIProviderId[]) {
    if (isAIProviderId(pid) && modelsByProvider[pid]?.length) {
      candidateIds.add(pid);
    }
  }
  if (isAIProviderId(customProviderId) && customModelOptions.length > 0) {
    candidateIds.add(customProviderId);
  }
  if (oauthSession?.accessToken?.trim()) {
    const sid = oauthSession.providerId;
    if (typeof sid === "string" && isAIProviderId(sid)) {
      candidateIds.add(sid);
    } else {
      candidateIds.add("xai");
    }
  }

  for (const pid of candidateIds) {
    if (out[pid] === undefined) {
      out[pid] = true;
    }
  }
  return out;
}
