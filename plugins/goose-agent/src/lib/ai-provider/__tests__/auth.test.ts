import { afterEach, describe, expect, it, vi } from "vitest";
import type { AISettingsLike } from "../types";
import {
  deriveOAuthStatus,
  getPreferredAuthMode,
  getRequestCredential,
  hasActiveCredential,
  hasConfiguredCredential,
} from "../auth";
import * as presets from "../presets";

function baseSettings(
  overrides: Partial<AISettingsLike> = {},
): AISettingsLike {
  return {
    enabled: true,
    selectedModelId: "gpt-4o",
    workspaceReasoningLevel: "medium",
    customProviderId: "custom-openai",
    customProtocol: "openai",
    customOpenAIResponsesBaseURL: "",
    customOpenAIBaseURL: "https://api.openai.com/v1",
    customClaudeBaseURL: "",
    customOpenAIResponsesApiKey: "",
    customOpenAIApiKey: "",
    customClaudeApiKey: "",
    customModelOptions: [],
    preferredAuthMode: "api_key",
    oauthSession: null,
    ...overrides,
  };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("getPreferredAuthMode", () => {
  it("!supportsOAuth → 强制 api_key（即使 preferred 为 oauth）", () => {
    vi.spyOn(presets, "providerAuthModes").mockReturnValue(["api_key"]);
    expect(
      getPreferredAuthMode(
        baseSettings({ preferredAuthMode: "oauth" }),
      ),
    ).toBe("api_key");
  });

  it("supportsOAuth + preferred oauth → oauth（双模式）", () => {
    vi.spyOn(presets, "providerAuthModes").mockReturnValue([
      "api_key",
      "oauth",
    ]);
    expect(
      getPreferredAuthMode(
        baseSettings({ preferredAuthMode: "oauth" }),
      ),
    ).toBe("oauth");
  });

  it("auth-mode-first：显式 api_key 即使 xai 也返回 api_key", () => {
    expect(
      getPreferredAuthMode(
        baseSettings({
          customProviderId: "xai",
          preferredAuthMode: "api_key",
        }),
      ),
    ).toBe("api_key");
  });

  it("缺省 preferred + xai oauth-only → oauth", () => {
    expect(
      getPreferredAuthMode(
        baseSettings({
          customProviderId: "xai",
          preferredAuthMode: undefined,
        }),
      ),
    ).toBe("oauth");
  });

  it("缺省 preferred → api_key（api_key-only 供应商）", () => {
    expect(getPreferredAuthMode(baseSettings({}))).toBe("api_key");
  });

  it("preferred oauth + 有效 session → oauth（即使 customProviderId 为 key 供应商）", () => {
    expect(
      getPreferredAuthMode(
        baseSettings({
          customProviderId: "deepseek",
          preferredAuthMode: "oauth",
          oauthSession: {
            accessToken: "tok",
            expiresAt: Date.now() + 60_000,
            providerId: "xai",
          },
        }),
      ),
    ).toBe("oauth");
  });
});

describe("getRequestCredential", () => {
  it("preferred api_key + has key → credential api_key", () => {
    const ai = baseSettings({
      preferredAuthMode: "api_key",
      customOpenAIApiKey: "sk-test-key",
    });
    expect(getRequestCredential(ai)).toEqual({
      type: "api_key",
      token: "sk-test-key",
    });
  });

  it("preferred oauth + no session + has key → null（禁止回落）", () => {
    vi.spyOn(presets, "providerAuthModes").mockReturnValue([
      "api_key",
      "oauth",
    ]);
    const ai = baseSettings({
      preferredAuthMode: "oauth",
      customOpenAIApiKey: "sk-still-there",
      oauthSession: null,
    });
    expect(getRequestCredential(ai)).toBeNull();
  });

  it("preferred oauth + valid session → oauth", () => {
    vi.spyOn(presets, "providerAuthModes").mockReturnValue([
      "api_key",
      "oauth",
    ]);
    const ai = baseSettings({
      preferredAuthMode: "oauth",
      customOpenAIApiKey: "sk-ignored",
      oauthSession: {
        accessToken: "oauth-token-1",
        expiresAt: Date.now() + 60 * 60_000,
      },
    });
    expect(getRequestCredential(ai)).toEqual({
      type: "oauth",
      token: "oauth-token-1",
    });
  });
});

describe("hasConfiguredCredential vs hasActiveCredential", () => {
  it("OR：仅 key、preferred oauth 时 configured=true、active=false", () => {
    vi.spyOn(presets, "providerAuthModes").mockReturnValue([
      "api_key",
      "oauth",
    ]);
    const ai = baseSettings({
      preferredAuthMode: "oauth",
      customOpenAIApiKey: "sk-only-key",
      oauthSession: null,
    });
    expect(hasConfiguredCredential(ai)).toBe(true);
    expect(hasActiveCredential(ai)).toBe(false);
  });

  it("OR：仅有效 OAuth、preferred api_key 时 configured=true、active=false", () => {
    const ai = baseSettings({
      preferredAuthMode: "api_key",
      customOpenAIApiKey: "",
      oauthSession: {
        accessToken: "oauth-only",
        expiresAt: Date.now() + 60 * 60_000,
      },
    });
    expect(hasConfiguredCredential(ai)).toBe(true);
    expect(hasActiveCredential(ai)).toBe(false);
  });

  it("preferred 侧有效时二者均为 true", () => {
    const ai = baseSettings({
      preferredAuthMode: "api_key",
      customOpenAIApiKey: "sk-ok",
    });
    expect(hasConfiguredCredential(ai)).toBe(true);
    expect(hasActiveCredential(ai)).toBe(true);
  });

  it("均无凭证时二者均为 false", () => {
    const ai = baseSettings({
      preferredAuthMode: "api_key",
      customOpenAIApiKey: "",
      oauthSession: null,
    });
    expect(hasConfiguredCredential(ai)).toBe(false);
    expect(hasActiveCredential(ai)).toBe(false);
  });
});

describe("deriveOAuthStatus", () => {
  it("empty → idle", () => {
    expect(deriveOAuthStatus(null)).toBe("idle");
    expect(deriveOAuthStatus(undefined)).toBe("idle");
    expect(deriveOAuthStatus({ accessToken: "" })).toBe("idle");
    expect(deriveOAuthStatus({ accessToken: "   " })).toBe("idle");
  });

  it("valid token → connected", () => {
    expect(
      deriveOAuthStatus({
        accessToken: "tok",
        expiresAt: Date.now() + 60 * 60_000,
      }),
    ).toBe("connected");
    // 无 expiresAt 视为未过期
    expect(deriveOAuthStatus({ accessToken: "tok" })).toBe("connected");
  });

  it("expired（含 30s skew）→ expired", () => {
    expect(
      deriveOAuthStatus({
        accessToken: "tok",
        expiresAt: Date.now() - 1,
      }),
    ).toBe("expired");
    // 距过期不足 skew 也算 expired
    expect(
      deriveOAuthStatus({
        accessToken: "tok",
        expiresAt: Date.now() + 10_000,
      }),
    ).toBe("expired");
  });
});
