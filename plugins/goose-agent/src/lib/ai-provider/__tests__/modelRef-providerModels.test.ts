import { describe, expect, it } from "vitest";
import type { AISettingsLike } from "../types";
import {
  aggregateModelsByProvider,
  formatModelRef,
  getApiModelId,
  modelIdsMatch,
  normalizeModelRef,
  parseModelRef,
  resolveEffectiveModelId,
} from "../modelRef";
import {
  authModeForProvider,
  buildSelectComposerModelPatch,
  enableProviderIfFirst,
  getAggregatedComposerModels,
  hasProviderCredential,
  isProviderEnabled,
  rebindSelectionAfterDisable,
  resolveComposerSelectedRef,
} from "../providerModels";
import { XAI_CLI_SESSION_BASE_URL } from "../presets";
import { normalizeAISettings } from "@/stores/settings/types";

function baseAi(
  overrides: Partial<AISettingsLike> & {
    modelsByProvider?: AISettingsLike["modelsByProvider"];
    workspaceSelectedModelId?: string | null;
    enabledProviders?: AISettingsLike["enabledProviders"];
  } = {},
): AISettingsLike & {
  modelsByProvider?: AISettingsLike["modelsByProvider"];
  workspaceSelectedModelId?: string | null;
  enabledProviders?: AISettingsLike["enabledProviders"];
} {
  return {
    enabled: true,
    selectedModelId: null,
    workspaceReasoningLevel: "medium",
    customProviderId: "deepseek",
    customProtocol: "openai-responses",
    customOpenAIResponsesBaseURL: "https://api.deepseek.com",
    customOpenAIBaseURL: "https://api.deepseek.com",
    customClaudeBaseURL: "",
    customOpenAIResponsesApiKey: "sk-ds",
    customOpenAIApiKey: "sk-ds",
    customClaudeApiKey: "",
    customModelOptions: [
      { id: "deepseek-chat", label: "DeepSeek Chat" },
    ],
    modelsByProvider: {
      deepseek: [{ id: "deepseek-chat", label: "DeepSeek Chat" }],
    },
    preferredAuthMode: "api_key",
    oauthSession: null,
    // 测试默认启用 deepseek，便于聚合
    enabledProviders: { deepseek: true },
    ...overrides,
  };
}

describe("modelRef parse/format", () => {
  it("formats and parses provider/model", () => {
    expect(formatModelRef("xai", "grok-4")).toBe("xai/grok-4");
    expect(parseModelRef("xai/grok-4")).toEqual({
      providerId: "xai",
      modelId: "grok-4",
      ref: "xai/grok-4",
    });
  });

  it("normalizes bare id with current provider", () => {
    expect(normalizeModelRef("grok-4", "xai")).toBe("xai/grok-4");
    expect(getApiModelId("xai/grok-4")).toBe("grok-4");
    expect(getApiModelId("deepseek-chat", "deepseek")).toBe("deepseek-chat");
  });

  it("modelIdsMatch equates canonical and bare ids", () => {
    expect(
      modelIdsMatch("deepseek/deepseek-reasoner", "deepseek-reasoner", "deepseek"),
    ).toBe(true);
    expect(
      modelIdsMatch("deepseek/deepseek-chat", "deepseek-chat"),
    ).toBe(true);
    expect(modelIdsMatch("deepseek/deepseek-chat", "deepseek-reasoner")).toBe(
      false,
    );
  });
});

describe("resolveEffectiveModelId", () => {
  it("preserves canonical workspace id when options use bare ids", () => {
    expect(
      resolveEffectiveModelId({
        workspaceSelectedModelId: "deepseek/deepseek-reasoner",
        selectedModelId: "deepseek/deepseek-chat",
        customProviderId: "deepseek",
        customModelOptions: [
          { id: "deepseek-chat" },
          { id: "deepseek-reasoner" },
        ],
      }),
    ).toBe("deepseek/deepseek-reasoner");
  });

  it("falls back to selectedModelId when workspace not in options", () => {
    expect(
      resolveEffectiveModelId({
        workspaceSelectedModelId: "xai/grok-4",
        selectedModelId: "deepseek/deepseek-chat",
        customProviderId: "deepseek",
        customModelOptions: [{ id: "deepseek-chat" }],
      }),
    ).toBe("deepseek/deepseek-chat");
  });
});

/**
 * saveAICustomConfig 保留选中：用 getApiModelId 比对 option 裸 id 与 canonical 选中。
 * （slice 副作用难测；此处覆盖同一匹配语义）
 */
describe("saveAICustomConfig preserve selection (matching helper)", () => {
  it("keeps deepseek/deepseek-reasoner when options are bare ids", () => {
    const providerId = "deepseek" as const;
    const selected = "deepseek/deepseek-reasoner";
    const options = [
      { id: "deepseek-chat" },
      { id: "deepseek-reasoner" },
    ];
    const preserved = options.some((item) => {
      const itemBare = getApiModelId(item.id, providerId) ?? item.id;
      const selBare = getApiModelId(selected, providerId) ?? selected;
      return itemBare === selBare || item.id === selected;
    })
      ? selected
      : options[0]?.id;
    expect(preserved).toBe("deepseek/deepseek-reasoner");
    const bare = getApiModelId(preserved!, providerId) ?? preserved!;
    expect(formatModelRef(providerId, bare)).toBe(
      "deepseek/deepseek-reasoner",
    );
  });
});

describe("aggregateModelsByProvider", () => {
  it("builds single column primaryLabel with short built-in prefixes", () => {
    const list = aggregateModelsByProvider({
      xai: [{ id: "grok-4", label: "Grok 4" }],
      deepseek: [{ id: "deepseek-chat", label: "Chat" }],
    });
    expect(list.map((m) => m.primaryLabel)).toEqual([
      "xai/Grok 4",
      "deepseek/Chat",
    ]);
    expect(list.map((m) => m.ref)).toEqual([
      "xai/grok-4",
      "deepseek/deepseek-chat",
    ]);
  });

  it("custom providers show model name only (no OpenAI Responses/ prefix)", () => {
    const list = aggregateModelsByProvider({
      "custom-openai-responses": [
        {
          id: "xai/grok-composer-2.5-fast",
          label: "xai/grok-composer-2.5-fast",
        },
      ],
      "custom-openai": [{ id: "tran", label: "tran" }],
    });
    expect(list.map((m) => m.primaryLabel)).toEqual([
      "xai/grok-composer-2.5-fast",
      "tran",
    ]);
    expect(list[0]?.id).toBe("xai/grok-composer-2.5-fast");
    expect(list[0]?.ref).toBe(
      "custom-openai-responses/xai/grok-composer-2.5-fast",
    );
  });
});

describe("getApiModelId gateway ids", () => {
  it("does not strip foreign xai/ prefix under custom provider", () => {
    expect(
      getApiModelId("xai/grok-composer-2.5-fast", "custom-openai-responses"),
    ).toBe("xai/grok-composer-2.5-fast");
    expect(
      getApiModelId(
        "custom-openai-responses/xai/grok-composer-2.5-fast",
        "custom-openai-responses",
      ),
    ).toBe("xai/grok-composer-2.5-fast");
  });
});

describe("hasProviderCredential + aggregation", () => {
  it("includes deepseek when key + models cached", () => {
    const ai = baseAi();
    expect(hasProviderCredential(ai, "deepseek")).toBe(true);
    expect(hasProviderCredential(ai, "xai")).toBe(false);
  });

  it("includes xai when oauth connected + models", () => {
    const ai = baseAi({
      preferredAuthMode: "oauth",
      oauthSession: {
        accessToken: "oidc",
        expiresAt: Date.now() + 3600_000,
        providerId: "xai",
      },
      modelsByProvider: {
        deepseek: [{ id: "deepseek-chat", label: "Chat" }],
        xai: [{ id: "grok-4", label: "Grok 4" }],
      },
      enabledProviders: { deepseek: true, xai: true },
      customOpenAIResponsesBaseURL: XAI_CLI_SESSION_BASE_URL,
    });
    expect(hasProviderCredential(ai, "xai")).toBe(true);
    expect(hasProviderCredential(ai, "deepseek")).toBe(true);
    const agg = getAggregatedComposerModels(ai);
    expect(agg.map((m) => m.ref)).toContain("xai/grok-4");
    expect(agg.map((m) => m.ref)).toContain("deepseek/deepseek-chat");
  });

  it("excludes provider when enabledProviders is false even with credential", () => {
    const ai = baseAi({
      enabledProviders: { deepseek: false },
    });
    expect(hasProviderCredential(ai, "deepseek")).toBe(true);
    expect(isProviderEnabled(ai, "deepseek")).toBe(false);
    expect(getAggregatedComposerModels(ai)).toEqual([]);
  });
});

describe("enableProviderIfFirst", () => {
  it("sets true only when key was undefined", () => {
    expect(enableProviderIfFirst({}, "deepseek")).toEqual({
      deepseek: true,
    });
    expect(enableProviderIfFirst({ deepseek: false }, "deepseek")).toEqual({
      deepseek: false,
    });
    expect(enableProviderIfFirst({ deepseek: true }, "deepseek")).toEqual({
      deepseek: true,
    });
  });
});

describe("rebindSelectionAfterDisable", () => {
  it("falls to first remaining aggregated model", () => {
    const ai = baseAi({
      preferredAuthMode: "api_key",
      selectedModelId: "deepseek/deepseek-chat",
      workspaceSelectedModelId: "deepseek/deepseek-chat",
      oauthSession: {
        accessToken: "oidc",
        expiresAt: Date.now() + 3600_000,
        providerId: "xai",
      },
      modelsByProvider: {
        deepseek: [{ id: "deepseek-chat", label: "Chat" }],
        xai: [{ id: "grok-4", label: "Grok 4" }],
      },
      enabledProviders: { deepseek: true, xai: true },
    });
    const rebind = rebindSelectionAfterDisable(ai, "deepseek");
    expect(rebind.selectedModelId).toBe("xai/grok-4");
    expect(rebind.customProviderId).toBe("xai");
  });

  it("clears selection when no remaining models", () => {
    const ai = baseAi({
      selectedModelId: "deepseek/deepseek-chat",
      workspaceSelectedModelId: "deepseek/deepseek-chat",
      enabledProviders: { deepseek: true },
    });
    const rebind = rebindSelectionAfterDisable(ai, "deepseek");
    expect(rebind.selectedModelId).toBeNull();
    expect(rebind.workspaceSelectedModelId).toBeNull();
    // 清空列表，避免发送路径回落到已禁用供应商的 models
    expect(rebind.customModelOptions).toEqual([]);
    // 保留 customProviderId 不强制改写（凭证仍在）
    expect(rebind.customProviderId).toBeUndefined();
  });
});

describe("normalizeAISettings enabledProviders migration", () => {
  it("migrates missing map to true for providers with models", () => {
    const normalized = normalizeAISettings({
      customProviderId: "deepseek",
      customProtocol: "openai-responses",
      customOpenAIResponsesApiKey: "sk",
      customModelOptions: [{ id: "deepseek-chat", label: "Chat" }],
      modelsByProvider: {
        deepseek: [{ id: "deepseek-chat", label: "Chat" }],
      },
    } as Parameters<typeof normalizeAISettings>[0]);
    expect(normalized.enabledProviders.deepseek).toBe(true);
  });

  it("preserves explicit false", () => {
    const normalized = normalizeAISettings({
      customProviderId: "deepseek",
      customProtocol: "openai-responses",
      customModelOptions: [{ id: "deepseek-chat", label: "Chat" }],
      modelsByProvider: {
        deepseek: [{ id: "deepseek-chat", label: "Chat" }],
      },
      enabledProviders: { deepseek: false },
    } as Parameters<typeof normalizeAISettings>[0]);
    expect(normalized.enabledProviders.deepseek).toBe(false);
  });
});

describe("buildSelectComposerModelPatch", () => {
  it("switches provider + auth on select", () => {
    const ai = baseAi({
      preferredAuthMode: "api_key",
      oauthSession: {
        accessToken: "oidc",
        expiresAt: Date.now() + 3600_000,
        providerId: "xai",
      },
      modelsByProvider: {
        deepseek: [{ id: "deepseek-chat", label: "Chat" }],
        xai: [{ id: "grok-4", label: "Grok 4" }],
      },
      enabledProviders: { deepseek: true, xai: true },
    });
    const patch = buildSelectComposerModelPatch(ai, "xai/grok-4");
    expect(patch).toMatchObject({
      customProviderId: "xai",
      preferredAuthMode: "oauth",
      selectedModelId: "xai/grok-4",
      workspaceSelectedModelId: "xai/grok-4",
    });
    expect(authModeForProvider("deepseek")).toBe("api_key");
    expect(authModeForProvider("xai")).toBe("oauth");
  });

  it("resolveComposerSelectedRef prefers workspace canonical", () => {
    const ai = baseAi({
      selectedModelId: "deepseek/deepseek-chat",
      workspaceSelectedModelId: "deepseek/deepseek-chat",
    });
    expect(resolveComposerSelectedRef(ai)).toBe("deepseek/deepseek-chat");
  });
});
