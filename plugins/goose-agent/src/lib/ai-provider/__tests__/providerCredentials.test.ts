import { describe, expect, it } from "vitest";
import type { AISettingsLike } from "../types";
import {
  getAIAvailability,
  getCustomAIApiKey,
  getCustomAIBaseURL,
  getCustomSelectedModelId,
} from "../modelCatalog";
import {
  buildSelectComposerModelPatch,
} from "../providerModels";
import { getApiModelId } from "../modelRef";
import {
  XAI_BASE_URL,
  XAI_CLI_SESSION_BASE_URL,
} from "../presets";
import { createAISlice, AI_INITIAL_STATE } from "@/stores/settings/aiSlice";
import type { AISettings } from "@/stores/settings/types";
import { normalizeAISettings } from "@/stores/settings/types";

const LITELLM_BASE = "https://litellm.example.com/v1";
const LITELLM_KEY = "sk-litellm-test";

function baseAi(
  overrides: Partial<AISettingsLike> = {},
): AISettingsLike {
  return {
    enabled: true,
    selectedModelId: null,
    workspaceReasoningLevel: "medium",
    customProviderId: "custom-openai",
    customProtocol: "openai",
    customOpenAIResponsesBaseURL: "",
    customOpenAIBaseURL: LITELLM_BASE,
    customClaudeBaseURL: "",
    customOpenAIResponsesApiKey: "",
    customOpenAIApiKey: LITELLM_KEY,
    customClaudeApiKey: "",
    customModelOptions: [
      { id: "deepseek-v4-flash", label: "deepseek-v4-flash" },
    ],
    modelsByProvider: {
      "custom-openai": [
        { id: "deepseek-v4-flash", label: "deepseek-v4-flash" },
      ],
    },
    providerCredentials: {
      "custom-openai": {
        baseURL: LITELLM_BASE,
        apiKey: LITELLM_KEY,
      },
    },
    preferredAuthMode: "api_key",
    oauthSession: null,
    enabledProviders: { "custom-openai": true },
    ...overrides,
  };
}

/** 最小 store 模拟 saveAICustomConfig / selectComposerModel */
function createStore(initialAi: AISettings) {
  let state = { ai: initialAi };
  const set = (
    updater:
      | Partial<{ ai: AISettings }>
      | ((s: { ai: AISettings }) => Partial<{ ai: AISettings }>),
  ) => {
    const partial = typeof updater === "function" ? updater(state) : updater;
    if (partial.ai) {
      state = { ai: partial.ai };
    }
  };
  const slice = createAISlice(set as Parameters<typeof createAISlice>[0]);
  // 勿把 slice.ai（INITIAL）盖过可变 state；动作方法从 slice 取
  return {
    get ai() {
      return state.ai;
    },
    saveAICustomConfig: slice.saveAICustomConfig,
    selectComposerModel: slice.selectComposerModel,
    setPreferredAuthMode: slice.setPreferredAuthMode,
  };
}

describe("providerCredentials isolation", () => {
  it("save xai（oauth 空 key）不清除 providerCredentials[custom-openai]", () => {
    const store = createStore(
      normalizeAISettings({
        ...AI_INITIAL_STATE.ai,
        customProviderId: "custom-openai",
        customProtocol: "openai",
        customOpenAIBaseURL: LITELLM_BASE,
        customOpenAIApiKey: LITELLM_KEY,
        customModelOptions: [
          { id: "deepseek-v4-flash", label: "deepseek-v4-flash" },
        ],
        modelsByProvider: {
          "custom-openai": [
            { id: "deepseek-v4-flash", label: "deepseek-v4-flash" },
          ],
        },
        providerCredentials: {
          "custom-openai": {
            baseURL: LITELLM_BASE,
            apiKey: LITELLM_KEY,
          },
        },
        preferredAuthMode: "oauth",
        enabledProviders: { "custom-openai": true },
      }),
    );

    store.saveAICustomConfig({
      providerId: "xai",
      baseURL: XAI_CLI_SESSION_BASE_URL,
      apiKey: "",
      modelOptions: [{ id: "grok-4", label: "Grok 4" }],
    });

    expect(store.ai.providerCredentials?.["custom-openai"]).toEqual({
      baseURL: LITELLM_BASE,
      apiKey: LITELLM_KEY,
    });
    // xai 固定 base 为 api.x.ai（getProviderFixedBaseURL）；仅更新 xai 条目
    expect(store.ai.providerCredentials?.xai?.baseURL).toBe(XAI_BASE_URL);
    // 共享槽 dual-write 到 xai fixed base（现有行为）
    expect(store.ai.customOpenAIBaseURL).toBe(XAI_BASE_URL);
  });

  it("先有 LiteLLM credentials，save xai 后 select 回 custom-openai 时读路径恢复 LiteLLM", () => {
    const store = createStore(
      normalizeAISettings({
        ...AI_INITIAL_STATE.ai,
        customProviderId: "custom-openai",
        customProtocol: "openai",
        customOpenAIBaseURL: LITELLM_BASE,
        customOpenAIApiKey: LITELLM_KEY,
        customModelOptions: [
          { id: "deepseek-v4-flash", label: "deepseek-v4-flash" },
        ],
        modelsByProvider: {
          "custom-openai": [
            { id: "deepseek-v4-flash", label: "deepseek-v4-flash" },
          ],
        },
        providerCredentials: {
          "custom-openai": {
            baseURL: LITELLM_BASE,
            apiKey: LITELLM_KEY,
          },
        },
        preferredAuthMode: "api_key",
        enabledProviders: { "custom-openai": true, xai: true },
        oauthSession: {
          accessToken: "oidc-token",
          expiresAt: Date.now() + 3600_000,
          providerId: "xai",
        },
      }),
    );

    // 导入 xai：覆盖共享槽 base（fixed → api.x.ai）
    store.saveAICustomConfig({
      providerId: "xai",
      baseURL: XAI_CLI_SESSION_BASE_URL,
      apiKey: "",
      modelOptions: [{ id: "grok-4", label: "Grok 4" }],
    });
    store.setPreferredAuthMode("oauth");
    expect(store.ai.customOpenAIBaseURL).toBe(XAI_BASE_URL);
    // 其它供应商快照仍在
    expect(store.ai.providerCredentials?.["custom-openai"]?.baseURL).toBe(
      LITELLM_BASE,
    );

    // Composer 切回 LiteLLM 模型：水合共享槽 + 读路径恢复
    store.selectComposerModel("custom-openai/deepseek-v4-flash");
    expect(store.ai.customProviderId).toBe("custom-openai");
    expect(store.ai.customOpenAIBaseURL).toBe(LITELLM_BASE);
    expect(store.ai.customOpenAIApiKey).toBe(LITELLM_KEY);
    expect(getCustomAIBaseURL(store.ai)).toBe(LITELLM_BASE);
    expect(getCustomAIApiKey(store.ai)).toBe(LITELLM_KEY);
  });

  it("slots 被写成 xai URL 时，有 providerCredentials 仍返回 LiteLLM base/key", () => {
    const ai = baseAi({
      customProviderId: "custom-openai",
      customProtocol: "openai",
      // 污染共享槽（bug 现场）
      customOpenAIBaseURL: XAI_CLI_SESSION_BASE_URL,
      customOpenAIResponsesBaseURL: XAI_BASE_URL,
      customOpenAIApiKey: "sk-wrong-xai-or-stale",
      customOpenAIResponsesApiKey: "",
      providerCredentials: {
        "custom-openai": {
          baseURL: LITELLM_BASE,
          apiKey: LITELLM_KEY,
        },
      },
    });

    expect(getCustomAIBaseURL(ai)).toBe(LITELLM_BASE);
    expect(getCustomAIApiKey(ai)).toBe(LITELLM_KEY);

    // 切到 custom-openai 模型时 hydration 也应恢复槽
    const patch = buildSelectComposerModelPatch(ai, "custom-openai/deepseek-v4-flash");
    expect(patch?.providerCredentialHydration).toMatchObject({
      customOpenAIBaseURL: LITELLM_BASE,
      customOpenAIApiKey: LITELLM_KEY,
    });
  });

  it("normalize 仅对当前 active 供应商从共享槽迁移 credentials", () => {
    const normalized = normalizeAISettings({
      customProviderId: "custom-openai",
      customProtocol: "openai",
      customOpenAIBaseURL: LITELLM_BASE,
      customOpenAIApiKey: LITELLM_KEY,
      customModelOptions: [
        { id: "deepseek-v4-flash", label: "deepseek-v4-flash" },
      ],
      modelsByProvider: {
        "custom-openai": [
          { id: "deepseek-v4-flash", label: "deepseek-v4-flash" },
        ],
        deepseek: [{ id: "deepseek-chat", label: "Chat" }],
      },
    } as Parameters<typeof normalizeAISettings>[0]);

    expect(normalized.providerCredentials["custom-openai"]).toEqual({
      baseURL: LITELLM_BASE,
      apiKey: LITELLM_KEY,
    });
    // 非 active 不迁移
    expect(normalized.providerCredentials.deepseek).toBeUndefined();
  });

  it("normalize 不把 xai 官方 URL 迁移进 custom-openai credentials", () => {
    const normalized = normalizeAISettings({
      customProviderId: "custom-openai",
      customProtocol: "openai",
      customOpenAIBaseURL: XAI_CLI_SESSION_BASE_URL,
      customOpenAIApiKey: "sk-stale",
      customModelOptions: [{ id: "m", label: "m" }],
      modelsByProvider: {
        "custom-openai": [{ id: "m", label: "m" }],
      },
    } as Parameters<typeof normalizeAISettings>[0]);

    expect(normalized.providerCredentials["custom-openai"]).toBeUndefined();
  });

  it("slots 脏 xai URL + 无 snap + customProviderId=custom-openai → getCustomAIBaseURL 不得返回 cli-proxy/api.x.ai", () => {
    const ai = baseAi({
      customProviderId: "custom-openai",
      customProtocol: "openai",
      customOpenAIBaseURL: XAI_CLI_SESSION_BASE_URL,
      customOpenAIResponsesBaseURL: XAI_BASE_URL,
      customOpenAIApiKey: "sk-stale-xai",
      customOpenAIResponsesApiKey: "",
      providerCredentials: {},
    });

    const base = getCustomAIBaseURL(ai);
    expect(base).not.toBe(XAI_CLI_SESSION_BASE_URL);
    expect(base).not.toBe(XAI_BASE_URL);
    expect(base.toLowerCase()).not.toContain("cli-chat-proxy");
    expect(base.toLowerCase()).not.toContain("api.x.ai");
    // 无 snap 时不信任脏槽 key
    expect(getCustomAIApiKey(ai)).toBe("");
    // 发送门控失败并给出中文提示
    const availability = getAIAvailability(ai);
    expect(availability.ok).toBe(false);
    if (!availability.ok) {
      expect(availability.reason).toMatch(/凭证不完整|设置/);
    }
  });

  it("buildSelectComposerModelPatch(custom-openai/xai/grok-…) → provider 为 custom-*，getApiModelId 保留完整网关 id", () => {
    const modelId = "xai/grok-composer-2.5-fast";
    const ai = baseAi({
      customProviderId: "custom-openai-responses",
      customProtocol: "openai-responses",
      customOpenAIResponsesBaseURL: LITELLM_BASE,
      customOpenAIResponsesApiKey: LITELLM_KEY,
      customModelOptions: [{ id: modelId, label: "Grok Composer" }],
      modelsByProvider: {
        "custom-openai-responses": [
          { id: modelId, label: "Grok Composer" },
        ],
      },
      providerCredentials: {
        "custom-openai-responses": {
          baseURL: LITELLM_BASE,
          apiKey: LITELLM_KEY,
        },
      },
      enabledProviders: { "custom-openai-responses": true },
    });

    const ref = `custom-openai-responses/${modelId}`;
    const patch = buildSelectComposerModelPatch(ai, ref);
    expect(patch).not.toBeNull();
    expect(patch!.customProviderId).toBe("custom-openai-responses");
    expect(patch!.customProviderId).not.toBe("xai");
    expect(patch!.customProtocol).toBe("openai-responses");
    expect(patch!.selectedModelId).toBe(ref);
    // API 裸 id 仍为完整网关 id，不得剥成 grok-composer-2.5-fast
    expect(getApiModelId(patch!.selectedModelId, patch!.customProviderId)).toBe(
      modelId,
    );

    // 选中后 settings 读路径仍走 LiteLLM
    const after = {
      ...ai,
      customProviderId: patch!.customProviderId,
      customProtocol: patch!.customProtocol,
      selectedModelId: patch!.selectedModelId,
      preferredAuthMode: patch!.preferredAuthMode,
      ...(patch!.providerCredentialHydration ?? {}),
    };
    expect(getCustomAIBaseURL(after)).toBe(LITELLM_BASE);
    expect(getCustomSelectedModelId(after)).toBe(modelId);
  });

  it("selectComposerModel 后 customProtocol 与供应商一致", () => {
    const store = createStore(
      normalizeAISettings({
        ...AI_INITIAL_STATE.ai,
        customProviderId: "deepseek",
        customProtocol: "openai-responses",
        customOpenAIResponsesBaseURL: "https://api.deepseek.com",
        customOpenAIResponsesApiKey: "sk-ds",
        customModelOptions: [
          { id: "deepseek-v4-flash", label: "Flash" },
        ],
        modelsByProvider: {
          deepseek: [{ id: "deepseek-v4-flash", label: "Flash" }],
          "custom-openai": [
            { id: "deepseek-v4-flash", label: "deepseek-v4-flash" },
          ],
        },
        providerCredentials: {
          deepseek: {
            baseURL: "https://api.deepseek.com",
            apiKey: "sk-ds",
          },
          "custom-openai": {
            baseURL: LITELLM_BASE,
            apiKey: LITELLM_KEY,
          },
        },
        preferredAuthMode: "api_key",
        enabledProviders: { deepseek: true, "custom-openai": true },
      }),
    );

    store.selectComposerModel("custom-openai/deepseek-v4-flash");
    expect(store.ai.customProviderId).toBe("custom-openai");
    expect(store.ai.customProtocol).toBe("openai");
    expect(getCustomAIBaseURL(store.ai)).toBe(LITELLM_BASE);
    expect(getCustomAIApiKey(store.ai)).toBe(LITELLM_KEY);
  });
});
