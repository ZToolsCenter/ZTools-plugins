import {
  DEFAULT_CLAUDE_BASE_URL,
  DEFAULT_OPENAI_BASE_URL,
  getAIProviderPreset,
  getProviderCredentialSlots,
  getProviderFixedBaseURL,
  isAIProviderId,
  resolveProtocolForProvider,
  type AIModelOption,
  type AIProviderId,
  type CustomAIProtocol,
  type AIReasoningLevel,
} from "@/lib/ai-provider";
import type { AISettings } from "../types";
import {
  normalizeAIModelOptions,
  normalizeAIBaseURL,
  normalizeAIApiKey,
} from "../types";

export interface AISliceState {
  ai: AISettings;
}

export interface AISliceActions {
  setAIEnabled: (enabled: boolean) => void;
  setAIReadGlobalPrompt: (enabled: boolean) => void;
  setAIReadLocalSkills: (enabled: boolean) => void;
  setAISelectedModelId: (modelId: string | null) => void;
  setAIWorkspaceSelectedModelId: (modelId: string | null) => void;
  setAIWorkspaceReasoningLevel: (level: AIReasoningLevel) => void;
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
    enabled: false,
    readGlobalPrompt: true,
    readLocalSkills: true,
    runtime: "pi",
    selectedModelId: null,
    workspaceSelectedModelId: null,
    workspaceReasoningLevel: "default",
    customProviderId: "deepseek",
    customProtocol: "openai-responses",
    customOpenAIResponsesBaseURL: DEFAULT_OPENAI_BASE_URL,
    customOpenAIBaseURL: DEFAULT_OPENAI_BASE_URL,
    customClaudeBaseURL: DEFAULT_CLAUDE_BASE_URL,
    customOpenAIResponsesApiKey: "",
    customOpenAIApiKey: "",
    customClaudeApiKey: "",
    customModelOptions: [],
  },
};

type SetFn = (
  updater: Partial<AISlice> | ((state: AISlice) => Partial<AISlice>),
) => void;

export function createAISlice(set: SetFn): AISlice {
  return {
    ...AI_INITIAL_STATE,
    setAIEnabled: (enabled) =>
      set((state) => {
        const nextAI = { ...state.ai, enabled };
        return { ai: nextAI };
      }),
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
    setAIWorkspaceReasoningLevel: (workspaceReasoningLevel) =>
      set((state) => ({
        ai: { ...state.ai, workspaceReasoningLevel },
      })),
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
        // 保留用户当前默认模型（仍在新列表中时）；否则回落到列表首项
        const preservedSelectedModelId =
          state.ai.selectedModelId &&
          normalizedModelOptions.some(
            (item) => item.id === state.ai.selectedModelId,
          )
            ? state.ai.selectedModelId
            : (normalizedModelOptions[0]?.id ?? state.ai.selectedModelId);
        const preservedWorkspaceModelId =
          state.ai.workspaceSelectedModelId &&
          normalizedModelOptions.some(
            (item) => item.id === state.ai.workspaceSelectedModelId,
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

        const nextAI: AISettings = {
          ...state.ai,
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
          customOpenAIResponsesApiKey: slots.includes("openai-responses")
            ? normalizedApiKey
            : state.ai.customOpenAIResponsesApiKey,
          customOpenAIApiKey: slots.includes("openai")
            ? normalizedApiKey
            : state.ai.customOpenAIApiKey,
          customClaudeApiKey: slots.includes("claude")
            ? normalizedApiKey
            : state.ai.customClaudeApiKey,
          customModelOptions: normalizedModelOptions,
          selectedModelId: preservedSelectedModelId,
          workspaceSelectedModelId: preservedWorkspaceModelId,
        };

        return { ai: nextAI };
      }),
  };
}
