import {
  DEFAULT_CLAUDE_BASE_URL,
  DEFAULT_OPENAI_BASE_URL,
  getAIProviderPreset,
  getProviderCredentialSlots,
  getProviderFixedBaseURL,
  isAIProviderId,
  providerSupportsOAuth,
  resolveProtocolForProvider,
  type AIAuthMode,
  type AIOAuthSession,
  type AIModelOption,
  type AIProviderId,
  type AIReasoningLevel,
  type CustomAIProtocol,
} from "@/lib/ai-provider";
import {
  buildSelectComposerModelPatch,
  enableProviderIfFirst,
  formatModelRef,
  getApiModelId,
  rebindSelectionAfterDisable,
} from "@/lib/ai-provider/providerModels";
import type { AISettings } from "./types";
import {
  normalizeAIModelOptions,
  normalizeAIBaseURL,
  normalizeAIApiKey,
  normalizeAIAuthMode,
  normalizeAIOAuthSession,
} from "./types";

export interface AISliceState {
  ai: AISettings;
}

export interface AISliceActions {
  setAIReadGlobalPrompt: (enabled: boolean) => void;
  setAIReadLocalSkills: (enabled: boolean) => void;
  setAISelectedModelId: (modelId: string | null) => void;
  setAIWorkspaceSelectedModelId: (modelId: string | null) => void;
  /**
   * Composer 选中 provider/model：切换 customProviderId + preferredAuthMode + 模型 id。
   */
  selectComposerModel: (refOrId: string) => void;
  setAIWorkspaceReasoningLevel: (level: AIReasoningLevel) => void;
  setPreferredAuthMode: (mode: AIAuthMode) => void;
  /** 一期 stub：写入 OAuth 会话（未真登录） */
  setOAuthSession: (session: AIOAuthSession | null) => void;
  clearOAuthSession: () => void;
  /** 写入某供应商模型缓存（不改当前 active provider） */
  setProviderModels: (
    providerId: AIProviderId,
    modelOptions: AIModelOption[],
  ) => void;
  /** 供应商是否在 Composer 模型列表中显示；关闭时可能重绑当前选中 */
  setProviderEnabled: (providerId: AIProviderId, enabled: boolean) => void;
  saveAICustomConfig: (config: {
    providerId: AIProviderId;
    protocol?: CustomAIProtocol;
    baseURL: string;
    apiKey: string;
    modelOptions: AIModelOption[];
  }) => void;
}

export type AISlice = AISliceState & AISliceActions;

export const AI_INITIAL_STATE: AISliceState = {
  ai: {
    /** 始终开启；设置页不提供关闭开关 */
    enabled: true,
    readGlobalPrompt: true,
    readLocalSkills: true,
    runtime: "pi",
    selectedModelId: null,
    workspaceSelectedModelId: null,
    workspaceReasoningLevel: "medium",
    customProviderId: "deepseek",
    customProtocol: "openai-responses",
    customOpenAIResponsesBaseURL: DEFAULT_OPENAI_BASE_URL,
    customOpenAIBaseURL: DEFAULT_OPENAI_BASE_URL,
    customClaudeBaseURL: DEFAULT_CLAUDE_BASE_URL,
    customOpenAIResponsesApiKey: "",
    customOpenAIApiKey: "",
    customClaudeApiKey: "",
    customModelOptions: [],
    modelsByProvider: {},
    providerCredentials: {},
    preferredAuthMode: "api_key",
    oauthSession: null,
    enabledProviders: {},
  },
};

type SetFn = (
  updater: Partial<AISlice> | ((state: AISlice) => Partial<AISlice>),
) => void;

export function createAISlice(set: SetFn): AISlice {
  return {
    ...AI_INITIAL_STATE,
    setAIReadGlobalPrompt: (readGlobalPrompt) =>
      set((state) => ({ ai: { ...state.ai, readGlobalPrompt } })),
    setAIReadLocalSkills: (readLocalSkills) =>
      set((state) => ({ ai: { ...state.ai, readLocalSkills } })),
    setAISelectedModelId: (selectedModelId) =>
      set((state) => {
        const nextAI = { ...state.ai, selectedModelId };
        return { ai: nextAI };
      }),
    setAIWorkspaceSelectedModelId: (workspaceSelectedModelId) =>
      set((state) => ({
        ai: { ...state.ai, workspaceSelectedModelId },
      })),
    selectComposerModel: (refOrId) =>
      set((state) => {
        const patch = buildSelectComposerModelPatch(state.ai, refOrId);
        if (!patch) return {};
        return {
          ai: {
            ...state.ai,
            customProviderId: patch.customProviderId,
            preferredAuthMode: patch.preferredAuthMode,
            customProtocol: patch.customProtocol,
            selectedModelId: patch.selectedModelId,
            workspaceSelectedModelId: patch.workspaceSelectedModelId,
            customModelOptions: patch.customModelOptions,
            modelsByProvider: {
              ...state.ai.modelsByProvider,
              [patch.customProviderId]: patch.customModelOptions,
            },
            // 按供应商快照水合共享协议槽，避免 UI 已切模型但请求仍打到上一供应商
            ...(patch.providerCredentialHydration ?? {}),
          },
        };
      }),
    setProviderModels: (providerId, modelOptions) =>
      set((state) => {
        const normalized = normalizeAIModelOptions(modelOptions).map((m) => ({
          ...m,
          id: getApiModelId(m.id, providerId) ?? m.id,
        }));
        return {
          ai: {
            ...state.ai,
            modelsByProvider: {
              ...state.ai.modelsByProvider,
              [providerId]: normalized,
            },
          },
        };
      }),
    setAIWorkspaceReasoningLevel: (workspaceReasoningLevel) =>
      set((state) => ({
        ai: { ...state.ai, workspaceReasoningLevel },
      })),
    setPreferredAuthMode: (mode) =>
      set((state) => {
        const normalized = normalizeAIAuthMode(mode);
        const pid = isAIProviderId(state.ai.customProviderId)
          ? state.ai.customProviderId
          : null;
        const sessionPid = state.ai.oauthSession?.providerId;
        const sessionConnected = Boolean(
          state.ai.oauthSession?.accessToken?.trim(),
        );
        const oauthCapable =
          (pid != null && providerSupportsOAuth(pid)) ||
          (typeof sessionPid === "string" &&
            isAIProviderId(sessionPid) &&
            providerSupportsOAuth(sessionPid)) ||
          sessionConnected;

        // auth-mode-first：允许显式写 api_key（顶层切到 API 密钥 Tab）
        if (normalized === "api_key") {
          return {
            ai: {
              ...state.ai,
              preferredAuthMode: "api_key",
            },
          };
        }
        // 写入 oauth：需供应商或 session 可 oauth
        if (normalized === "oauth" && !oauthCapable) {
          return {
            ai: {
              ...state.ai,
              preferredAuthMode: "api_key",
            },
          };
        }
        return {
          ai: {
            ...state.ai,
            preferredAuthMode: normalized,
          },
        };
      }),
    setOAuthSession: (session) =>
      set((state) => {
        const nextSession = normalizeAIOAuthSession(session);
        // OAuth 导入成功写入 session 时：首次启用 xai（false 粘住）
        const enabledProviders = nextSession
          ? enableProviderIfFirst(state.ai.enabledProviders, "xai")
          : state.ai.enabledProviders;
        return {
          ai: {
            ...state.ai,
            oauthSession: nextSession,
            enabledProviders,
          },
        };
      }),
    clearOAuthSession: () =>
      set((state) => {
        // 断开：清 session 并回落 api_key（顶层「本机账号 | API 密钥」IA）
        return {
          ai: {
            ...state.ai,
            oauthSession: null,
            preferredAuthMode: "api_key",
          },
        };
      }),
    setProviderEnabled: (providerId, enabled) =>
      set((state) => {
        if (!isAIProviderId(providerId)) return {};
        const nextEnabled: Partial<Record<AIProviderId, boolean>> = {
          ...state.ai.enabledProviders,
          [providerId]: enabled,
        };
        if (enabled) {
          return {
            ai: {
              ...state.ai,
              enabledProviders: nextEnabled,
            },
          };
        }
        const rebind = rebindSelectionAfterDisable(state.ai, providerId);
        return {
          ai: {
            ...state.ai,
            enabledProviders: nextEnabled,
            ...(rebind.customProviderId != null
              ? { customProviderId: rebind.customProviderId }
              : {}),
            ...(rebind.preferredAuthMode != null
              ? { preferredAuthMode: rebind.preferredAuthMode }
              : {}),
            ...(rebind.customProtocol != null
              ? { customProtocol: rebind.customProtocol }
              : {}),
            selectedModelId: rebind.selectedModelId,
            workspaceSelectedModelId: rebind.workspaceSelectedModelId,
            ...(rebind.customModelOptions != null
              ? {
                  customModelOptions: rebind.customModelOptions,
                  modelsByProvider: {
                    ...state.ai.modelsByProvider,
                    ...(rebind.customProviderId
                      ? {
                          [rebind.customProviderId]:
                            rebind.customModelOptions,
                        }
                      : {}),
                  },
                }
              : {}),
            ...(rebind.providerCredentialHydration ?? {}),
          },
        };
      }),
    saveAICustomConfig: ({
      providerId: rawProviderId,
      protocol: protocolOverride,
      baseURL,
      apiKey,
      modelOptions,
    }) =>
      set((state) => {
        const providerId: AIProviderId = isAIProviderId(rawProviderId)
          ? rawProviderId
          : "deepseek";
        const preset = getAIProviderPreset(providerId);
        const normalizedModelOptions = normalizeAIModelOptions(modelOptions);
        const optionMatches = (selected: string | null) =>
          Boolean(
            selected &&
              normalizedModelOptions.some((item) => {
                const itemBare = getApiModelId(item.id, providerId) ?? item.id;
                const selBare = getApiModelId(selected, providerId) ?? selected;
                return itemBare === selBare || item.id === selected;
              }),
          );
        // 用 getApiModelId 比对：canonical `deepseek/deepseek-chat` 可匹配裸 option id
        const preservedSelectedModelId = optionMatches(state.ai.selectedModelId)
          ? state.ai.selectedModelId
          : (normalizedModelOptions[0]?.id ?? state.ai.selectedModelId);
        const preservedWorkspaceModelId = optionMatches(
          state.ai.workspaceSelectedModelId,
        )
          ? state.ai.workspaceSelectedModelId
          : state.ai.workspaceSelectedModelId;

        const protocol =
          protocolOverride ??
          resolveProtocolForProvider(
            providerId,
            preservedSelectedModelId,
            preset.protocol,
          );
        const fixedBaseURL = getProviderFixedBaseURL(providerId);
        const fallbackBaseURL =
          protocol === "claude"
            ? DEFAULT_CLAUDE_BASE_URL
            : DEFAULT_OPENAI_BASE_URL;
        const normalizedBaseURL = normalizeAIBaseURL(
          fixedBaseURL ?? baseURL,
          fallbackBaseURL,
        );
        const normalizedApiKey = normalizeAIApiKey(apiKey);
        const slots = getProviderCredentialSlots(providerId);

        // xAI OAuth 保存常带空 apiKey（不写 OIDC token）；空串不得冲掉已有 API Key。
        // preferred 为 api_key 时仍允许用空串显式清空（如清理 token 污染）。
        const preserveEmptyApiKey =
          providerId === "xai" &&
          !normalizedApiKey &&
          state.ai.preferredAuthMode === "oauth";
        const nextResponsesApiKey = slots.includes("openai-responses")
          ? preserveEmptyApiKey
            ? state.ai.customOpenAIResponsesApiKey
            : normalizedApiKey
          : state.ai.customOpenAIResponsesApiKey;
        const nextOpenAIApiKey = slots.includes("openai")
          ? preserveEmptyApiKey
            ? state.ai.customOpenAIApiKey
            : normalizedApiKey
          : state.ai.customOpenAIApiKey;
        const nextClaudeApiKey = slots.includes("claude")
          ? normalizedApiKey
          : state.ai.customClaudeApiKey;

        // 该供应商最终写入的 key：oauth 空 key 时保留本供应商快照 / 槽位，不抹掉
        const existingProviderKey =
          state.ai.providerCredentials?.[providerId]?.apiKey?.trim() ?? "";
        const finalProviderApiKey = preserveEmptyApiKey
          ? existingProviderKey ||
            nextResponsesApiKey.trim() ||
            nextOpenAIApiKey.trim() ||
            nextClaudeApiKey.trim() ||
            ""
          : normalizedApiKey;

        const bareModels = normalizedModelOptions.map((m) => ({
          ...m,
          id: getApiModelId(m.id, providerId) ?? m.id,
        }));
        const preservedBare =
          preservedSelectedModelId &&
          (getApiModelId(preservedSelectedModelId, providerId) ??
            preservedSelectedModelId);
        const nextSelectedCanonical = preservedBare
          ? formatModelRef(providerId, preservedBare)
          : bareModels[0]
            ? formatModelRef(providerId, bareModels[0].id)
            : null;
        const workspaceBare = preservedWorkspaceModelId
          ? getApiModelId(preservedWorkspaceModelId, providerId) ??
            preservedWorkspaceModelId
          : null;
        const nextWorkspaceCanonical =
          workspaceBare && bareModels.some((m) => m.id === workspaceBare)
            ? formatModelRef(providerId, workspaceBare)
            : preservedWorkspaceModelId;

        // 首次成功保存模型后自动启用；手动 false 粘住
        const enabledProviders =
          bareModels.length > 0
            ? enableProviderIfFirst(state.ai.enabledProviders, providerId)
            : state.ai.enabledProviders;

        // 只更新本供应商条目；绝不改写其它供应商的 providerCredentials
        const nextProviderCredentials = {
          ...(state.ai.providerCredentials ?? {}),
          [providerId]: {
            baseURL: normalizedBaseURL,
            apiKey: finalProviderApiKey,
          },
        };

        const nextAI: AISettings = {
          ...state.ai,
          enabled: true,
          customProviderId: providerId,
          customProtocol: protocol,
          customOpenAIResponsesBaseURL: slots.includes("openai-responses")
            ? normalizedBaseURL
            : state.ai.customOpenAIResponsesBaseURL,
          customOpenAIBaseURL: slots.includes("openai")
            ? normalizedBaseURL
            : state.ai.customOpenAIBaseURL,
          customClaudeBaseURL: slots.includes("claude")
            ? normalizedBaseURL
            : state.ai.customClaudeBaseURL,
          customOpenAIResponsesApiKey: nextResponsesApiKey,
          customOpenAIApiKey: nextOpenAIApiKey,
          customClaudeApiKey: nextClaudeApiKey,
          customModelOptions: bareModels,
          modelsByProvider: {
            ...state.ai.modelsByProvider,
            [providerId]: bareModels,
          },
          providerCredentials: nextProviderCredentials,
          selectedModelId: nextSelectedCanonical,
          workspaceSelectedModelId: nextWorkspaceCanonical,
          enabledProviders,
        };

        return { ai: nextAI };
      }),
  };
}
