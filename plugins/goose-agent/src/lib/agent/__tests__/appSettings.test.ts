/**
 * appSettings 工具：脱敏、读写 patch、不误清 Key。
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { AISettings } from "@/stores/settings";
import type { AppearanceSettings } from "@/stores/settings/appearanceSlice";
import type { PersonaSettings } from "@/stores/settings/personaSlice";
import type { PermissionMode } from "@/lib/agent/permission";
import type { AIModelOption, AIProviderId } from "@/lib/ai-provider";
import {
  executeGetAppSettings,
  executeUpdateAppSettings,
  maskSecret,
  setAppSettingsAccessorsForTests,
  type AppSettingsAccessors,
} from "../tools/appSettings";

function makeAI(overrides: Partial<AISettings> = {}): AISettings {
  return {
    enabled: true,
    readGlobalPrompt: true,
    readLocalSkills: true,
    runtime: "pi",
    selectedModelId: "deepseek/deepseek-v4-flash",
    workspaceSelectedModelId: null,
    workspaceReasoningLevel: "medium",
    customProviderId: "deepseek",
    customProtocol: "openai-responses",
    customOpenAIResponsesBaseURL: "https://api.deepseek.com",
    customOpenAIBaseURL: "https://api.openai.com/v1",
    customClaudeBaseURL: "https://api.anthropic.com",
    customOpenAIResponsesApiKey: "sk-secret-responses-key-abcd",
    customOpenAIApiKey: "",
    customClaudeApiKey: "",
    customModelOptions: [
      { id: "deepseek-v4-flash", label: "DeepSeek V4 Flash" },
    ],
    modelsByProvider: {
      deepseek: [{ id: "deepseek-v4-flash", label: "DeepSeek V4 Flash" }],
    },
    providerCredentials: {
      deepseek: {
        baseURL: "https://api.deepseek.com",
        apiKey: "sk-secret-responses-key-abcd",
      },
    },
    preferredAuthMode: "api_key",
    oauthSession: null,
    enabledProviders: { deepseek: true },
    ...overrides,
  };
}

function createMockAccessors(initial?: {
  ai?: Partial<AISettings>;
  persona?: Partial<PersonaSettings>;
  appearance?: Partial<AppearanceSettings>;
  permissionMode?: PermissionMode;
}): {
  accessors: AppSettingsAccessors;
  state: {
    ai: AISettings;
    persona: PersonaSettings;
    appearance: AppearanceSettings;
    permissionMode: PermissionMode;
  };
} {
  const state = {
    ai: makeAI(initial?.ai),
    persona: {
      selectedPersonaId: "default",
      customPersonas: [],
      ...initial?.persona,
    },
    appearance: {
      uiFont: "system" as const,
      codeFont: "jetbrains" as const,
      customCodeFont: "",
      fontSize: "md" as const,
      windowHeight: 800,
      uiZoom: 1,
      ...initial?.appearance,
    },
    permissionMode: (initial?.permissionMode ??
      "workspace-write") as PermissionMode,
  };

  const accessors: AppSettingsAccessors = {
    getAI: () => state.ai,
    getPersona: () => state.persona,
    getAppearance: () => state.appearance,
    getPermissionMode: () => state.permissionMode,
    setAISelectedModelId: (id) => {
      state.ai = { ...state.ai, selectedModelId: id };
    },
    setAIWorkspaceSelectedModelId: (id) => {
      state.ai = { ...state.ai, workspaceSelectedModelId: id };
    },
    setAIWorkspaceReasoningLevel: (level) => {
      state.ai = { ...state.ai, workspaceReasoningLevel: level };
    },
    setPreferredAuthMode: (mode) => {
      state.ai = { ...state.ai, preferredAuthMode: mode };
    },
    setAIReadGlobalPrompt: (v) => {
      state.ai = { ...state.ai, readGlobalPrompt: v };
    },
    setAIReadLocalSkills: (v) => {
      state.ai = { ...state.ai, readLocalSkills: v };
    },
    selectComposerModel: (ref) => {
      state.ai = {
        ...state.ai,
        selectedModelId: ref,
        workspaceSelectedModelId: ref,
      };
    },
    saveAICustomConfig: (cfg) => {
      const providerId = cfg.providerId as AIProviderId;
      state.ai = {
        ...state.ai,
        customProviderId: providerId,
        customProtocol: cfg.protocol ?? state.ai.customProtocol,
        customOpenAIResponsesBaseURL:
          providerId === "deepseek" ||
          providerId === "custom-openai-responses" ||
          providerId === "xai"
            ? cfg.baseURL
            : state.ai.customOpenAIResponsesBaseURL,
        customOpenAIBaseURL:
          providerId === "custom-openai" || providerId === "deepseek"
            ? cfg.baseURL
            : state.ai.customOpenAIBaseURL,
        customClaudeBaseURL:
          providerId === "custom-claude"
            ? cfg.baseURL
            : state.ai.customClaudeBaseURL,
        customOpenAIResponsesApiKey:
          providerId === "deepseek" ||
          providerId === "custom-openai-responses" ||
          providerId === "xai"
            ? cfg.apiKey
            : state.ai.customOpenAIResponsesApiKey,
        customOpenAIApiKey:
          providerId === "custom-openai"
            ? cfg.apiKey
            : state.ai.customOpenAIApiKey,
        customClaudeApiKey:
          providerId === "custom-claude"
            ? cfg.apiKey
            : state.ai.customClaudeApiKey,
        customModelOptions: cfg.modelOptions as AIModelOption[],
        modelsByProvider: {
          ...state.ai.modelsByProvider,
          [providerId]: cfg.modelOptions as AIModelOption[],
        },
        providerCredentials: {
          ...state.ai.providerCredentials,
          [providerId]: {
            baseURL: cfg.baseURL,
            apiKey: cfg.apiKey,
          },
        },
      };
    },
    setProviderEnabled: (providerId, enabled) => {
      state.ai = {
        ...state.ai,
        enabledProviders: {
          ...state.ai.enabledProviders,
          [providerId]: enabled,
        },
      };
    },
    clearOAuthSession: () => {
      state.ai = {
        ...state.ai,
        oauthSession: null,
        preferredAuthMode: "api_key",
      };
    },
    setSelectedPersonaId: (id) => {
      state.persona = { ...state.persona, selectedPersonaId: id };
    },
    addCustomPersona: ({ name, systemSnippet }) => {
      const id = `custom-test-${Date.now()}`;
      state.persona = {
        ...state.persona,
        customPersonas: [
          ...state.persona.customPersonas,
          { id, name, systemSnippet, isBuiltin: false },
        ],
        selectedPersonaId: id,
      };
      return id;
    },
    updateCustomPersona: (id, patch) => {
      state.persona = {
        ...state.persona,
        customPersonas: state.persona.customPersonas.map((p) =>
          p.id === id
            ? {
                ...p,
                name: patch.name ?? p.name,
                systemSnippet: patch.systemSnippet ?? p.systemSnippet,
              }
            : p,
        ),
      };
    },
    removeCustomPersona: (id) => {
      state.persona = {
        ...state.persona,
        customPersonas: state.persona.customPersonas.filter((p) => p.id !== id),
        selectedPersonaId:
          state.persona.selectedPersonaId === id
            ? "default"
            : state.persona.selectedPersonaId,
      };
    },
    setUiFont: (id) => {
      state.appearance = { ...state.appearance, uiFont: id };
    },
    setCodeFont: (id) => {
      state.appearance = { ...state.appearance, codeFont: id };
    },
    setCustomCodeFont: (value) => {
      state.appearance = { ...state.appearance, customCodeFont: value };
    },
    setFontSize: (id) => {
      state.appearance = { ...state.appearance, fontSize: id };
    },
    setWindowHeight: (height) => {
      state.appearance = { ...state.appearance, windowHeight: height };
    },
    setUiZoom: (zoom) => {
      state.appearance = { ...state.appearance, uiZoom: zoom };
    },
    setPermissionMode: (mode) => {
      state.permissionMode = mode;
    },
  };

  return { accessors, state };
}

describe("maskSecret", () => {
  it("empty → hasKey false", () => {
    expect(maskSecret("")).toEqual({ hasKey: false, hint: "" });
    expect(maskSecret("   ")).toEqual({ hasKey: false, hint: "" });
  });

  it("short secret (≤8) → bullets", () => {
    expect(maskSecret("short")).toEqual({ hasKey: true, hint: "••••" });
    expect(maskSecret("12345678")).toEqual({ hasKey: true, hint: "••••" });
  });

  it("long secret → prefix…suffix", () => {
    const r = maskSecret("sk-secret-responses-key-abcd");
    expect(r.hasKey).toBe(true);
    expect(r.hint).toMatch(/^sk-s…abcd$|^sk…abcd$/);
    expect(r.hint).not.toContain("secret-responses");
    expect(r.hint.length).toBeLessThan(20);
  });
});

describe("getAppSettings / updateAppSettings", () => {
  let mock: ReturnType<typeof createMockAccessors>;

  beforeEach(() => {
    mock = createMockAccessors();
    setAppSettingsAccessorsForTests(mock.accessors);
  });

  afterEach(() => {
    setAppSettingsAccessorsForTests(null);
  });

  it("get masks api keys and never leaks full key", async () => {
    const r = (await executeGetAppSettings({})) as {
      ok: boolean;
      ai: {
        customOpenAIResponsesApiKey: { hasKey: boolean; hint: string };
        providerCredentials: Record<
          string,
          { apiKey: { hasKey: boolean; hint: string } }
        >;
      };
    };
    expect(r.ok).toBe(true);
    expect(r.ai.customOpenAIResponsesApiKey.hasKey).toBe(true);
    expect(r.ai.customOpenAIResponsesApiKey.hint).not.toBe(
      "sk-secret-responses-key-abcd",
    );
    expect(JSON.stringify(r)).not.toContain("sk-secret-responses-key-abcd");
    expect(r.ai.providerCredentials.deepseek?.apiKey.hasKey).toBe(true);
  });

  it("get oauth omits accessToken", async () => {
    mock = createMockAccessors({
      ai: {
        oauthSession: {
          accessToken: "super-secret-oauth-token-xyz",
          accountLabel: "user@x.ai",
          providerId: "xai",
        },
      },
    });
    setAppSettingsAccessorsForTests(mock.accessors);
    const r = (await executeGetAppSettings({ sections: ["ai"] })) as {
      ok: boolean;
      ai: {
        oauth: {
          hasSession: boolean;
          accountLabel?: string;
          accessToken?: string;
        } | null;
      };
    };
    expect(r.ai.oauth?.hasSession).toBe(true);
    expect(r.ai.oauth?.accountLabel).toBe("user@x.ai");
    expect(r.ai.oauth).not.toHaveProperty("accessToken");
    expect(JSON.stringify(r)).not.toContain("super-secret-oauth-token-xyz");
  });

  it("update reasoning / appearance / permission", async () => {
    const r = (await executeUpdateAppSettings({
      ai: { workspaceReasoningLevel: "high" },
      appearance: { fontSize: "lg", windowHeight: 900 },
      permissionMode: "workspace-read",
    })) as {
      ok: boolean;
      applied: string[];
      snapshot: {
        ai: { workspaceReasoningLevel: string };
        appearance: { fontSize: string; windowHeight: number };
        permission: { mode: string };
      };
    };
    expect(r.ok).toBe(true);
    expect(r.applied).toEqual(
      expect.arrayContaining([
        "ai.workspaceReasoningLevel",
        "appearance.fontSize",
        "appearance.windowHeight",
        "permissionMode",
      ]),
    );
    expect(mock.state.ai.workspaceReasoningLevel).toBe("high");
    expect(mock.state.appearance.fontSize).toBe("lg");
    expect(mock.state.appearance.windowHeight).toBe(900);
    expect(mock.state.permissionMode).toBe("workspace-read");
    expect(r.snapshot.ai.workspaceReasoningLevel).toBe("high");
    expect(r.snapshot.permission.mode).toBe("workspace-read");
  });

  it("saveProvider without apiKey keeps existing key", async () => {
    const before = mock.state.ai.providerCredentials?.deepseek?.apiKey;
    expect(before).toBe("sk-secret-responses-key-abcd");

    const r = (await executeUpdateAppSettings({
      ai: {
        saveProvider: {
          providerId: "deepseek",
          baseURL: "https://api.deepseek.com",
          modelOptions: [
            { id: "deepseek-v4-pro", label: "DeepSeek V4 Pro" },
          ],
        },
      },
    })) as { ok: boolean; applied: string[] };

    expect(r.ok).toBe(true);
    expect(r.applied).toContain("ai.saveProvider");
    expect(mock.state.ai.providerCredentials?.deepseek?.apiKey).toBe(
      "sk-secret-responses-key-abcd",
    );
    expect(mock.state.ai.customOpenAIResponsesApiKey).toBe(
      "sk-secret-responses-key-abcd",
    );
    expect(mock.state.ai.modelsByProvider.deepseek?.[0]?.id).toBe(
      "deepseek-v4-pro",
    );
  });

  it("saveProvider with apiKey writes new key", async () => {
    const r = (await executeUpdateAppSettings({
      ai: {
        saveProvider: {
          providerId: "deepseek",
          apiKey: "sk-new-user-provided-key-9999",
          modelOptions: [
            { id: "deepseek-v4-flash", label: "DeepSeek V4 Flash" },
          ],
        },
      },
    })) as { ok: boolean };

    expect(r.ok).toBe(true);
    expect(mock.state.ai.providerCredentials?.deepseek?.apiKey).toBe(
      "sk-new-user-provided-key-9999",
    );
    expect(mock.state.ai.customOpenAIResponsesApiKey).toBe(
      "sk-new-user-provided-key-9999",
    );
  });

  it("rejects illegal permissionMode", async () => {
    const r = (await executeUpdateAppSettings({
      permissionMode: "sudo-root",
    })) as { ok: boolean; error: string };
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/permissionMode/);
    expect(mock.state.permissionMode).toBe("workspace-write");
  });

  it("rejects oauth token write fields", async () => {
    const r = (await executeUpdateAppSettings({
      ai: {
        oauthSession: { accessToken: "evil" },
      },
    })) as { ok: boolean; error: string };
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/OAuth|token/i);
  });

  it("clearOAuth disconnects session", async () => {
    mock = createMockAccessors({
      ai: {
        oauthSession: {
          accessToken: "tok",
          accountLabel: "u",
          providerId: "xai",
        },
        preferredAuthMode: "oauth",
      },
    });
    setAppSettingsAccessorsForTests(mock.accessors);
    const r = (await executeUpdateAppSettings({
      ai: { clearOAuth: true },
    })) as { ok: boolean; applied: string[] };
    expect(r.ok).toBe(true);
    expect(r.applied).toContain("ai.clearOAuth");
    expect(mock.state.ai.oauthSession).toBeNull();
    expect(mock.state.ai.preferredAuthMode).toBe("api_key");
  });
});
