import { describe, expect, it } from "vitest";
import type { AISettingsLike } from "../types";
import {
  getCustomAIBaseURL,
  resolveActiveProtocol,
} from "../modelCatalog";
import {
  getProviderCredentialSlots,
  XAI_BASE_URL,
  XAI_CLI_SESSION_BASE_URL,
} from "../presets";

function baseSettings(
  overrides: Partial<AISettingsLike> = {},
): AISettingsLike {
  return {
    enabled: true,
    selectedModelId: "grok-4",
    workspaceReasoningLevel: "medium",
    customProviderId: "xai",
    customProtocol: "openai",
    customOpenAIResponsesBaseURL: XAI_CLI_SESSION_BASE_URL,
    customOpenAIBaseURL: XAI_BASE_URL,
    customClaudeBaseURL: "",
    customOpenAIResponsesApiKey: "",
    customOpenAIApiKey: "sk-xai-key",
    customClaudeApiKey: "",
    customModelOptions: [],
    preferredAuthMode: "api_key",
    oauthSession: null,
    ...overrides,
  };
}

describe("getProviderCredentialSlots(xai)", () => {
  it("returns both openai-responses and openai (dual write)", () => {
    expect(getProviderCredentialSlots("xai")).toEqual([
      "openai-responses",
      "openai",
    ]);
  });

  it("deepseek still dual-writes", () => {
    expect(getProviderCredentialSlots("deepseek")).toEqual([
      "openai-responses",
      "openai",
    ]);
  });

  it("single-protocol presets stay single-slot", () => {
    expect(getProviderCredentialSlots("custom-openai")).toEqual(["openai"]);
    expect(getProviderCredentialSlots("custom-claude")).toEqual(["claude"]);
  });
});

describe("resolveActiveProtocol + getCustomAIBaseURL (xai)", () => {
  it("xai + oauth → openai-responses + cli-chat-proxy", () => {
    const ai = baseSettings({
      preferredAuthMode: "oauth",
      oauthSession: {
        accessToken: "oidc-token",
        expiresAt: Date.now() + 60 * 60_000,
        providerId: "xai",
      },
    });
    expect(resolveActiveProtocol(ai)).toBe("openai-responses");
    expect(getCustomAIBaseURL(ai)).toBe(XAI_CLI_SESSION_BASE_URL);
    expect(getCustomAIBaseURL(ai, resolveActiveProtocol(ai))).toBe(
      XAI_CLI_SESSION_BASE_URL,
    );
  });

  it("xai + preferred api_key：不走 cli-proxy（auth-mode-first）", () => {
    const ai = baseSettings({ preferredAuthMode: "api_key" });
    // 显式 api_key 时用 console base / 协议，而非 OIDC 会话路径
    expect(resolveActiveProtocol(ai)).not.toBe("openai-responses");
    expect(getCustomAIBaseURL(ai)).toBe(XAI_BASE_URL);
  });

  it("xai + oauth ignores stored openai baseURL slot", () => {
    const ai = baseSettings({
      preferredAuthMode: "oauth",
      customOpenAIBaseURL: XAI_BASE_URL,
      customOpenAIResponsesBaseURL: "https://should-not-use.example/v1",
      oauthSession: {
        accessToken: "tok",
        expiresAt: Date.now() + 60_000,
      },
    });
    expect(getCustomAIBaseURL(ai)).toBe(XAI_CLI_SESSION_BASE_URL);
  });
});
