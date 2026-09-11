/**
 * 多供应商模型聚合：凭证有效且已启用的供应商进入 Composer 列表。
 */
import {
  deriveOAuthStatus,
  hasValidOAuthSession,
  type AIAuthMode,
} from "./auth";
import {
  getAIProviderPreset,
  getProviderCredentialSlots,
  getProviderFixedBaseURL,
  isAIProviderId,
  providerSupportsApiKey,
  providerSupportsOAuth,
  resolveProtocolForProvider,
  XAI_CLI_SESSION_BASE_URL,
  type AIProviderId,
} from "./presets";
import {
  aggregateModelsByProvider,
  formatModelRef,
  getApiModelId,
  normalizeModelRef,
  parseModelRef,
  type AggregatedModelOption,
  type ModelsByProvider,
} from "./modelRef";
import type { AIModelOption, AISettingsLike, CustomAIProtocol } from "./types";

/** 设置中带 modelsByProvider / 启用开关的扩展视图（运行时可选） */
export type AISettingsWithModelsByProvider = AISettingsLike & {
  modelsByProvider?: ModelsByProvider;
  workspaceSelectedModelId?: string | null;
  enabledProviders?: Partial<Record<AIProviderId, boolean>>;
};

/** 切换供应商时水合到共享协议槽的补丁 */
export type ProviderCredentialHydration = Partial<{
  customOpenAIResponsesBaseURL: string;
  customOpenAIBaseURL: string;
  customClaudeBaseURL: string;
  customOpenAIResponsesApiKey: string;
  customOpenAIApiKey: string;
  customClaudeApiKey: string;
}>;

/**
 * 从共享协议槽读取 apiKey（不含 per-provider 快照）。
 */
function readSharedSlotApiKey(
  ai: AISettingsLike,
  protocol: CustomAIProtocol,
): string {
  const key = (
    protocol === "openai-responses"
      ? ai.customOpenAIResponsesApiKey
      : protocol === "openai"
        ? ai.customOpenAIApiKey
        : ai.customClaudeApiKey
  )?.trim();
  if (key) return key;
  // deepseek / xai 双槽
  if (protocol === "openai-responses" || protocol === "openai") {
    return (
      ai.customOpenAIResponsesApiKey?.trim() ||
      ai.customOpenAIApiKey?.trim() ||
      ""
    );
  }
  return "";
}

/**
 * 读某供应商 apiKey：per-provider 快照优先，再回退共享槽。
 * base 不作为 hasCredential 硬条件（与现一致）。
 */
export function readProviderApiKey(
  ai: AISettingsLike,
  providerId: AIProviderId,
): string {
  const snapKey = ai.providerCredentials?.[providerId]?.apiKey?.trim() ?? "";
  if (snapKey) return snapKey;
  const preset = getAIProviderPreset(providerId);
  return readSharedSlotApiKey(ai, preset.protocol);
}

/**
 * 根据 providerCredentials[providerId] 生成共享槽水合补丁。
 * fixed-base / xai oauth 用固定 base；apiKey 来自快照（oauth 请求仍走 token）。
 */
export function buildProviderCredentialHydration(
  ai: AISettingsWithModelsByProvider,
  providerId: AIProviderId,
  preferredAuthMode?: AIAuthMode,
): ProviderCredentialHydration {
  const snap = ai.providerCredentials?.[providerId];
  const slots = getProviderCredentialSlots(providerId);
  const mode = preferredAuthMode ?? authModeForProvider(providerId);

  let baseURL = "";
  if (providerId === "xai" && mode === "oauth") {
    baseURL = XAI_CLI_SESSION_BASE_URL;
  } else {
    const fixed = getProviderFixedBaseURL(providerId);
    baseURL = (fixed ?? snap?.baseURL ?? "").trim();
  }
  const apiKey = (snap?.apiKey ?? "").trim();

  // 无 base 且无 key 时不写补丁（避免用空串冲掉当前槽）
  if (!baseURL && !apiKey) return {};

  const hydration: ProviderCredentialHydration = {};
  if (slots.includes("openai-responses")) {
    if (baseURL) hydration.customOpenAIResponsesBaseURL = baseURL;
    // oauth 空 key 不覆盖已有槽；有快照 key 则写入
    if (apiKey) hydration.customOpenAIResponsesApiKey = apiKey;
  }
  if (slots.includes("openai")) {
    if (baseURL) hydration.customOpenAIBaseURL = baseURL;
    if (apiKey) hydration.customOpenAIApiKey = apiKey;
  }
  if (slots.includes("claude")) {
    if (baseURL) hydration.customClaudeBaseURL = baseURL;
    if (apiKey) hydration.customClaudeApiKey = apiKey;
  }
  return hydration;
}

/**
 * 供应商是否具备可用凭证（用于聚合列表，非 preferred 单路径）。
 * - oauth：会话 connected 且 provider 匹配 xai
 * - api_key：对应槽或 per-provider 快照有 Key，且该供应商有缓存模型或即为当前 customProviderId
 */
export function hasProviderCredential(
  ai: AISettingsWithModelsByProvider,
  providerId: AIProviderId,
): boolean {
  if (providerSupportsOAuth(providerId)) {
    if (!hasValidOAuthSession(ai)) return false;
    const sessionPid = ai.oauthSession?.providerId;
    if (sessionPid && isAIProviderId(sessionPid) && sessionPid !== providerId) {
      return false;
    }
    // xai oauth-only
    return providerId === "xai" || providerSupportsOAuth(providerId);
  }

  if (!providerSupportsApiKey(providerId)) return false;

  // custom / deepseek：快照或共享槽任一有效即可；base 非硬条件
  const dualKey = Boolean(readProviderApiKey(ai, providerId));
  if (!dualKey) return false;

  const byProvider = ai.modelsByProvider?.[providerId];
  if (byProvider && byProvider.length > 0) return true;

  // 当前供应商且有列表
  if (ai.customProviderId === providerId && ai.customModelOptions?.length) {
    return true;
  }

  return false;
}

/**
 * 供应商是否在 Composer 模型列表中显示。
 * - 显式 true → 启用
 * - 显式 false → 禁用（手动关闭粘住）
 * - undefined → 视为未启用（首次成功保存/导入会写 true；存量由 normalize 迁 true）
 */
export function isProviderEnabled(
  ai: AISettingsWithModelsByProvider,
  providerId: AIProviderId,
): boolean {
  return ai.enabledProviders?.[providerId] === true;
}

/**
 * 首次成功启用：仅当 map 中该键为 undefined 时写 true；false 粘住。
 */
export function enableProviderIfFirst(
  map: Partial<Record<AIProviderId, boolean>> | undefined,
  providerId: AIProviderId,
): Partial<Record<AIProviderId, boolean>> {
  const next = { ...(map ?? {}) };
  if (next[providerId] === undefined) {
    next[providerId] = true;
  }
  return next;
}

/** 合并 customModelOptions 进 modelsByProvider（当前供应商）。 */
export function resolveModelsByProvider(
  ai: AISettingsWithModelsByProvider,
): ModelsByProvider {
  const base: ModelsByProvider = { ...(ai.modelsByProvider ?? {}) };
  const pid =
    typeof ai.customProviderId === "string" && isAIProviderId(ai.customProviderId)
      ? ai.customProviderId
      : null;
  if (pid && ai.customModelOptions?.length) {
    // 不覆盖已有更长缓存；若无则填入
    if (!base[pid]?.length) {
      base[pid] = ai.customModelOptions.map((m) => ({
        ...m,
        id: getApiModelId(m.id, pid) ?? m.id,
      }));
    }
  }
  // oauth xai：若 session 有效且无缓存，用 customModelOptions 当 xai
  if (
    hasValidOAuthSession(ai) &&
    !base.xai?.length &&
    pid === "xai" &&
    ai.customModelOptions?.length
  ) {
    base.xai = ai.customModelOptions.map((m) => ({
      ...m,
      id: getApiModelId(m.id, "xai") ?? m.id,
    }));
  }
  return base;
}

const DEFAULT_PROVIDER_ORDER: AIProviderId[] = [
  "xai",
  "deepseek",
  "custom-openai-responses",
  "custom-openai",
  "custom-claude",
];

/**
 * 凭证有效且已启用的供应商 → 单列 provider/model。
 */
export function getAggregatedComposerModels(
  ai: AISettingsWithModelsByProvider,
): AggregatedModelOption[] {
  const all = resolveModelsByProvider(ai);
  const filtered: ModelsByProvider = {};
  for (const providerId of Object.keys(all) as AIProviderId[]) {
    if (!isAIProviderId(providerId)) continue;
    if (!hasProviderCredential(ai, providerId)) continue;
    if (!isProviderEnabled(ai, providerId)) continue;
    const list = all[providerId];
    if (list?.length) filtered[providerId] = list;
  }
  return aggregateModelsByProvider(filtered, {
    providerOrder: DEFAULT_PROVIDER_ORDER,
  });
}

export type RebindSelectionAfterDisableResult = {
  selectedModelId: string | null;
  workspaceSelectedModelId: string | null;
  customProviderId?: AIProviderId;
  preferredAuthMode?: AIAuthMode;
  customProtocol?: CustomAIProtocol;
  customModelOptions?: AIModelOption[];
  providerCredentialHydration?: ProviderCredentialHydration;
};

/**
 * 禁用某供应商后：若当前选中属于该供应商，则回落到其余聚合列表第一项，或清空选中。
 */
export function rebindSelectionAfterDisable(
  ai: AISettingsWithModelsByProvider,
  disabledProviderId: AIProviderId,
): RebindSelectionAfterDisableResult {
  const withDisabled: AISettingsWithModelsByProvider = {
    ...ai,
    enabledProviders: {
      ...(ai.enabledProviders ?? {}),
      [disabledProviderId]: false,
    },
  };
  const currentRef = resolveComposerSelectedRef(ai);
  const currentProvider =
    currentRef != null
      ? parseModelRef(currentRef, ai.customProviderId as AIProviderId)
          .providerId
      : isAIProviderId(ai.customProviderId)
        ? ai.customProviderId
        : null;

  if (currentProvider !== disabledProviderId) {
    return {
      selectedModelId: (ai.selectedModelId as string | null) ?? null,
      workspaceSelectedModelId:
        (ai.workspaceSelectedModelId as string | null) ?? null,
    };
  }

  const remaining = getAggregatedComposerModels(withDisabled);
  const first = remaining[0];
  if (!first) {
    // 无剩余可选模型：清空选中，避免 getCustomSelectedModelId 回落到已禁用供应商的 customModelOptions
    return {
      selectedModelId: null,
      workspaceSelectedModelId: null,
      customModelOptions: [],
    };
  }
  const patch = buildSelectComposerModelPatch(withDisabled, first.ref);
  if (!patch) {
    return {
      selectedModelId: null,
      workspaceSelectedModelId: null,
      customModelOptions: [],
    };
  }
  return {
    customProviderId: patch.customProviderId,
    preferredAuthMode: patch.preferredAuthMode,
    customProtocol: patch.customProtocol,
    selectedModelId: patch.selectedModelId,
    workspaceSelectedModelId: patch.workspaceSelectedModelId,
    customModelOptions: patch.customModelOptions,
    providerCredentialHydration: patch.providerCredentialHydration,
  };
}

/** 选中模型后应采用的 auth 模式 */
export function authModeForProvider(providerId: AIProviderId): AIAuthMode {
  if (providerSupportsOAuth(providerId) && !providerSupportsApiKey(providerId)) {
    return "oauth";
  }
  if (providerSupportsOAuth(providerId) && providerId === "xai") {
    // xai 在 Composer 选中时走 oauth（若 session 有效）；否则 api_key 无意义
    return "oauth";
  }
  return "api_key";
}

/**
 * 解析 Composer 当前选中项（canonical ref）。
 */
export function resolveComposerSelectedRef(
  ai: AISettingsWithModelsByProvider,
  aggregated?: AggregatedModelOption[],
): string | null {
  const list = aggregated ?? getAggregatedComposerModels(ai);
  if (list.length === 0) return null;

  const candidates = [
    ai.workspaceSelectedModelId,
    ai.selectedModelId,
  ].filter(Boolean) as string[];

  for (const c of candidates) {
    const parsed = parseModelRef(c, ai.customProviderId as AIProviderId);
    if (parsed.ref && list.some((m) => m.ref === parsed.ref)) {
      return parsed.ref;
    }
    // 裸 id 在唯一匹配时
    if (parsed.modelId) {
      const matches = list.filter((m) => m.id === parsed.modelId);
      if (matches.length === 1) return matches[0]!.ref;
      if (parsed.providerId) {
        const hit = matches.find((m) => m.providerId === parsed.providerId);
        if (hit) return hit.ref;
      }
    }
  }

  // 当前 provider 的第一项
  const pid =
    typeof ai.customProviderId === "string" && isAIProviderId(ai.customProviderId)
      ? ai.customProviderId
      : null;
  if (pid) {
    const first = list.find((m) => m.providerId === pid);
    if (first) return first.ref;
  }
  return list[0]?.ref ?? null;
}

export type SelectComposerModelResult = {
  customProviderId: AIProviderId;
  preferredAuthMode: AIAuthMode;
  /** 目标供应商对应协议（custom 用 preset；deepseek 按模型分支） */
  customProtocol: CustomAIProtocol;
  selectedModelId: string;
  workspaceSelectedModelId: string;
  /** 切换后应展示的该供应商模型列表 */
  customModelOptions: AIModelOption[];
  /** 按目标供应商快照水合共享协议槽 */
  providerCredentialHydration?: ProviderCredentialHydration;
};

/**
 * 用户在 Composer 选中 provider/model 后的 settings 补丁字段。
 * hit 优先纠正 provider；网关模型 id（如 `xai/grok-…`）在 custom 下不剥成内置 xai。
 */
export function buildSelectComposerModelPatch(
  ai: AISettingsWithModelsByProvider,
  refOrId: string,
): SelectComposerModelResult | null {
  const aggregated = getAggregatedComposerModels(ai);
  const parsed = parseModelRef(refOrId, ai.customProviderId as AIProviderId);
  if (!parsed.modelId) return null;

  let providerId = parsed.providerId;
  let modelId = parsed.modelId;
  let ref = parsed.ref;

  // hit 优先：按聚合列表纠正 provider / modelId（避免网关 id 首段误当路由）
  const hit = aggregated.find(
    (m) =>
      m.ref === ref ||
      (m.providerId === providerId && m.id === modelId) ||
      m.ref === refOrId.trim() ||
      // custom 桶内模型 id 常为 `xai/grok-…`；ref 为 `custom-openai/xai/grok-…`
      (m.id === modelId &&
        providerId != null &&
        m.providerId === providerId) ||
      m.id === refOrId.trim() ||
      (m.ref.endsWith(`/${refOrId.trim()}`) &&
        refOrId.trim().includes("/")),
  );
  if (hit) {
    providerId = hit.providerId;
    modelId = hit.id;
    ref = hit.ref;
  } else if (!providerId || !ref) {
    // 无 fallback 时 parse 可能把 `custom-openai/xai/…` 拆成 custom-openai + xai/…
    // 或把 `xai/grok` 拆成内置 xai；再试一次无 fallback 的 canonical
    const free = parseModelRef(refOrId, null);
    if (free.providerId && free.modelId && isAIProviderId(free.providerId)) {
      const freeHit = aggregated.find(
        (m) =>
          m.ref === free.ref ||
          (m.providerId === free.providerId && m.id === free.modelId),
      );
      if (freeHit) {
        providerId = freeHit.providerId;
        modelId = freeHit.id;
        ref = freeHit.ref;
      } else {
        providerId = free.providerId;
        modelId = free.modelId;
        ref = free.ref;
      }
    } else {
      return null;
    }
  }

  if (!isAIProviderId(providerId)) return null;

  const mode = authModeForProvider(providerId);
  // oauth 但 session 失效时仍写入 oauth（发送门控会提示重新导入）
  if (mode === "oauth" && deriveOAuthStatus(ai.oauthSession) === "expired") {
    // keep oauth
  }

  const models =
    resolveModelsByProvider(ai)[providerId] ??
    (ai.customProviderId === providerId ? ai.customModelOptions : []) ??
    [];

  const canonical = formatModelRef(providerId, modelId);
  const customProtocol = resolveProtocolForProvider(
    providerId,
    modelId,
    ai.customProtocol,
  );
  const providerCredentialHydration = buildProviderCredentialHydration(
    ai,
    providerId,
    mode,
  );
  return {
    customProviderId: providerId,
    preferredAuthMode: mode,
    customProtocol,
    selectedModelId: canonical,
    workspaceSelectedModelId: canonical,
    customModelOptions: models.map((m) => ({
      ...m,
      id: getApiModelId(m.id, providerId) ?? m.id,
    })),
    providerCredentialHydration:
      Object.keys(providerCredentialHydration).length > 0
        ? providerCredentialHydration
        : undefined,
  };
}

export {
  formatModelRef,
  getApiModelId,
  normalizeModelRef,
  parseModelRef,
  aggregateModelsByProvider,
  type AggregatedModelOption,
  type ModelsByProvider,
};
