import { describe, expect, it } from "vitest";
import {
  filterActionableLocalAuthHints,
  filterVisibleProviderPresets,
  inspectCodexAuthJson,
  isActionableLocalAuthHint,
  parseGrokAuthJson,
  parseGrokModelsCache,
  parseOpenCodexAuthJson,
  type LocalAuthHint,
} from "../localAuthDetect";
import {
  AI_PROVIDER_PRESETS,
  getApiKeyProviderPresets,
  XAI_CLI_SESSION_BASE_URL,
  type AIProviderPreset,
} from "../presets";

describe("parseGrokAuthJson", () => {
  it("取第一个非空 key 并映射 AIOAuthSession", () => {
    const raw = JSON.stringify({
      "entry-a": {
        key: "  access-token-1  ",
        auth_mode: "oidc",
        refresh_token: "refresh-1",
        expires_at: "2030-01-15T12:00:00.000Z",
        email: "user@example.com",
      },
      "entry-b": {
        key: "should-not-use",
      },
    });
    const session = parseGrokAuthJson(raw);
    expect(session).not.toBeNull();
    expect(session!.accessToken).toBe("access-token-1");
    expect(session!.refreshToken).toBe("refresh-1");
    expect(session!.expiresAt).toBe(Date.parse("2030-01-15T12:00:00.000Z"));
    expect(session!.accountLabel).toBe("user@example.com");
    expect(session!.providerId).toBe("xai");
  });

  it("无 email 时 accountLabel 为 Grok 账号", () => {
    const raw = JSON.stringify({
      only: { key: "tok", auth_mode: "oidc" },
    });
    const session = parseGrokAuthJson(raw);
    expect(session).toEqual({
      accessToken: "tok",
      providerId: "xai",
      accountLabel: "Grok 账号",
    });
  });

  it("跳过空 key，取下一有效条目", () => {
    const raw = JSON.stringify({
      empty: { key: "   ", auth_mode: "oidc" },
      next: { key: "good-token", email: "a@b.c" },
    });
    const session = parseGrokAuthJson(raw);
    expect(session?.accessToken).toBe("good-token");
    expect(session?.accountLabel).toBe("a@b.c");
  });

  it("非法 JSON / 空对象 / 无有效 key → null", () => {
    expect(parseGrokAuthJson("not-json")).toBeNull();
    expect(parseGrokAuthJson("{}")).toBeNull();
    expect(parseGrokAuthJson("[]")).toBeNull();
    expect(
      parseGrokAuthJson(JSON.stringify({ a: { key: "" }, b: { no_key: true } })),
    ).toBeNull();
  });

  it("expires_at 非法时忽略 expiresAt", () => {
    const raw = JSON.stringify({
      e: { key: "t", expires_at: "not-a-date" },
    });
    const session = parseGrokAuthJson(raw);
    expect(session?.accessToken).toBe("t");
    expect(session?.expiresAt).toBeUndefined();
  });
});

describe("parseOpenCodexAuthJson", () => {
  it("从 accounts map + activeAccount 取 xai credential", () => {
    const raw = JSON.stringify({
      activeAccount: "xai",
      accounts: {
        xai: {
          credential: {
            access: "  oc-access  ",
            refresh: "oc-refresh",
            email: "oc@x.ai",
          },
        },
        other: {
          credential: { access: "nope" },
        },
      },
    });
    const session = parseOpenCodexAuthJson(raw);
    expect(session).toEqual({
      accessToken: "oc-access",
      refreshToken: "oc-refresh",
      accountLabel: "oc@x.ai",
      providerId: "xai",
    });
  });

  it("无 active 时取第一个 xai 键", () => {
    const raw = JSON.stringify({
      accounts: {
        openai: { credential: { access: "sk-ignore" } },
        grok: {
          credential: {
            access_token: "grok-tok",
            refresh_token: "r",
          },
        },
      },
    });
    const session = parseOpenCodexAuthJson(raw);
    expect(session?.accessToken).toBe("grok-tok");
    expect(session?.refreshToken).toBe("r");
    expect(session?.providerId).toBe("xai");
  });

  it("accounts 数组 provider=xai", () => {
    const raw = JSON.stringify({
      accounts: [
        { provider: "anthropic", credential: { access: "a" } },
        {
          provider: "xai",
          credential: { access: "xai-a", email: "u@x.ai" },
        },
      ],
    });
    const session = parseOpenCodexAuthJson(raw);
    expect(session?.accessToken).toBe("xai-a");
    expect(session?.accountLabel).toBe("u@x.ai");
  });

  it("无 xai 账号 → null", () => {
    expect(
      parseOpenCodexAuthJson(
        JSON.stringify({
          accounts: { openai: { credential: { access: "sk" } } },
        }),
      ),
    ).toBeNull();
    expect(parseOpenCodexAuthJson("not-json")).toBeNull();
  });
});

describe("inspectCodexAuthJson", () => {
  it("识别 OPENAI_API_KEY", () => {
    expect(
      inspectCodexAuthJson(
        JSON.stringify({ OPENAI_API_KEY: "sk-test" }),
      ),
    ).toEqual({ hasOpenAiApiKey: true, hasChatGptTokens: false });
  });

  it("识别 tokens.access_token 为 ChatGPT 订阅", () => {
    expect(
      inspectCodexAuthJson(
        JSON.stringify({
          tokens: { access_token: "chatgpt-jwt", refresh_token: "r" },
        }),
      ),
    ).toEqual({ hasOpenAiApiKey: false, hasChatGptTokens: true });
  });

  it("非法 JSON → 皆 false", () => {
    expect(inspectCodexAuthJson("x")).toEqual({
      hasOpenAiApiKey: false,
      hasChatGptTokens: false,
    });
  });
});

describe("parseGrokModelsCache", () => {
  const realisticFixture = {
    fetched_at: "2026-08-01T00:00:00.000Z",
    origin: "https://cli-chat-proxy.grok.com/v1/models",
    models: {
      "grok-4.5": {
        info: {
          id: "grok-4.5",
          model: "grok-4.5",
          base_url: "https://cli-chat-proxy.grok.com/v1",
          name: "Grok 4.5",
          api_backend: "responses",
          context_window: 500000,
          hidden: false,
          supported_in_api: true,
        },
      },
      "hidden-model": {
        info: {
          id: "hidden-model",
          name: "Hidden",
          hidden: true,
          api_backend: "responses",
          base_url: "https://cli-chat-proxy.grok.com/v1",
        },
      },
      "grok-legacy": {
        info: {
          model: "grok-legacy",
          name: "Grok Legacy",
          api_backend: "chat",
          context_window: 128000,
        },
      },
    },
  };

  it("解析 grok-4.5 等真实形状条目", () => {
    const result = parseGrokModelsCache(JSON.stringify(realisticFixture));
    expect(result).not.toBeNull();
    expect(result!.models.map((m) => m.id)).toEqual([
      "grok-4.5",
      "grok-legacy",
    ]);
    expect(result!.models[0]).toEqual({
      id: "grok-4.5",
      label: "Grok 4.5",
      contextWindow: 500_000,
    });
    expect(result!.baseURL).toBe("https://cli-chat-proxy.grok.com/v1");
    expect(result!.protocol).toBe("openai-responses");
  });

  it("跳过 hidden === true", () => {
    const result = parseGrokModelsCache(
      JSON.stringify({
        models: {
          a: { info: { id: "a", name: "A", hidden: true } },
          b: { info: { id: "b", name: "B", hidden: false } },
        },
      }),
    );
    expect(result!.models).toEqual([{ id: "b", label: "B" }]);
  });

  it("非法 JSON / 无 models / 空 models → null", () => {
    expect(parseGrokModelsCache("not-json")).toBeNull();
    expect(parseGrokModelsCache("{}")).toBeNull();
    expect(parseGrokModelsCache("[]")).toBeNull();
    expect(
      parseGrokModelsCache(JSON.stringify({ models: {} })),
    ).toBeNull();
    expect(
      parseGrokModelsCache(
        JSON.stringify({
          models: {
            only: { info: { id: "x", hidden: true } },
          },
        }),
      ),
    ).toBeNull();
  });

  it("无 base_url 时从 origin 去掉 /models 推导 baseURL", () => {
    const result = parseGrokModelsCache(
      JSON.stringify({
        origin: "https://cli-chat-proxy.grok.com/v1/models",
        models: {
          m1: { info: { id: "m1", name: "M1" } },
        },
      }),
    );
    expect(result!.baseURL).toBe("https://cli-chat-proxy.grok.com/v1");
    expect(result!.protocol).toBe("openai-responses");
  });

  it("origin 与 base_url 皆无时回落 XAI_CLI_SESSION_BASE_URL", () => {
    const result = parseGrokModelsCache(
      JSON.stringify({
        models: {
          m1: { info: { id: "m1" } },
        },
      }),
    );
    expect(result!.baseURL).toBe(XAI_CLI_SESSION_BASE_URL);
  });

  it("仅 chat 类 api_backend 时 protocol 为 openai", () => {
    const result = parseGrokModelsCache(
      JSON.stringify({
        models: {
          m1: {
            info: {
              id: "m1",
              api_backend: "chat_completions",
              base_url: "https://example.com/v1",
            },
          },
        },
      }),
    );
    expect(result!.protocol).toBe("openai");
    expect(result!.baseURL).toBe("https://example.com/v1");
  });
});

describe("isActionableLocalAuthHint / filterActionableLocalAuthHints", () => {
  const actionableGrok: LocalAuthHint = {
    providerId: "xai",
    source: "grok_cli",
    displayPath: "~/.grok",
    hasAuthMaterial: true,
    importAllowed: true,
    statusNote: "可导入",
  };
  const actionableOpenCodex: LocalAuthHint = {
    providerId: "xai",
    source: "opencodex",
    displayPath: "~/.opencodex",
    hasAuthMaterial: true,
    importAllowed: true,
    statusNote: "可导入 xAI 账号",
  };
  const presenceOnly: LocalAuthHint = {
    providerId: null,
    source: "claude_cli",
    displayPath: "~/.claude",
    hasAuthMaterial: false,
    importAllowed: false,
    statusNote: "已检测 Claude Code（订阅凭证不导入）",
  };
  const materialButNoImport: LocalAuthHint = {
    providerId: null,
    source: "codex_cli",
    displayPath: "~/.codex",
    hasAuthMaterial: true,
    importAllowed: false,
    statusNote: "ChatGPT 订阅登录已检测",
  };
  const importFlagNoMaterial: LocalAuthHint = {
    providerId: "xai",
    source: "grok_cli",
    displayPath: "~/.grok",
    hasAuthMaterial: false,
    importAllowed: true,
    statusNote: "登录文件缺失",
  };

  it("importAllowed && hasAuthMaterial 才可行动", () => {
    expect(isActionableLocalAuthHint(actionableGrok)).toBe(true);
    expect(isActionableLocalAuthHint(actionableOpenCodex)).toBe(true);
    expect(isActionableLocalAuthHint(presenceOnly)).toBe(false);
    expect(isActionableLocalAuthHint(materialButNoImport)).toBe(false);
    expect(isActionableLocalAuthHint(importFlagNoMaterial)).toBe(false);
  });

  it("filter 只保留可行动 hint", () => {
    const filtered = filterActionableLocalAuthHints([
      presenceOnly,
      actionableGrok,
      materialButNoImport,
      actionableOpenCodex,
      importFlagNoMaterial,
    ]);
    expect(filtered).toEqual([actionableGrok, actionableOpenCodex]);
  });

  it("空列表 → []", () => {
    expect(filterActionableLocalAuthHints([])).toEqual([]);
  });
});

describe("filterVisibleProviderPresets / getApiKeyProviderPresets", () => {
  const xaiHint: LocalAuthHint = {
    providerId: "xai",
    source: "grok_cli",
    displayPath: "~/.grok",
    hasAuthMaterial: true,
    importAllowed: true,
  };

  it("Key 页预设不含 glm/minimax/xai，含 deepseek 与自定义", () => {
    const ids = getApiKeyProviderPresets().map((p) => p.id);
    expect(ids).toContain("deepseek");
    expect(ids).toContain("custom-openai");
    expect(ids).toContain("custom-claude");
    expect(ids).not.toContain("glm");
    expect(ids).not.toContain("minimax");
    expect(ids).not.toContain("xai");
  });

  it("无 requiresLocalPresence 的供应商始终可见", () => {
    const visible = filterVisibleProviderPresets(AI_PROVIDER_PRESETS, []);
    const ids = visible.map((p) => p.id);
    expect(ids).toContain("deepseek");
    expect(ids).not.toContain("xai");
    expect(ids).not.toContain("glm");
    expect(ids).not.toContain("minimax");
  });

  it("有 ~/.grok hint 时 xai 可见", () => {
    const visible = filterVisibleProviderPresets(AI_PROVIDER_PRESETS, [
      xaiHint,
    ]);
    expect(visible.some((p) => p.id === "xai")).toBe(true);
  });

  it("requiresLocalPresence 与 hint.providerId 精确匹配", () => {
    const presets: AIProviderPreset[] = [
      {
        id: "deepseek",
        label: "DeepSeek",
        description: "",
        baseURL: "https://example.com",
        protocol: "openai",
        allowCustomBaseURL: false,
        authModes: ["api_key"],
      },
      {
        id: "xai",
        label: "Grok",
        description: "",
        baseURL: "https://api.x.ai/v1",
        protocol: "openai",
        allowCustomBaseURL: false,
        authModes: ["oauth"],
        requiresLocalPresence: true,
      },
    ];
    expect(
      filterVisibleProviderPresets(presets, []).map((p) => p.id),
    ).toEqual(["deepseek"]);
    expect(
      filterVisibleProviderPresets(presets, [xaiHint]).map((p) => p.id),
    ).toEqual(["deepseek", "xai"]);
  });
});
