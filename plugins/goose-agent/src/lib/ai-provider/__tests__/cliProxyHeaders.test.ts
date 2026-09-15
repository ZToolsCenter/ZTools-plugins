import { describe, expect, it, beforeEach } from "vitest";
import {
  buildCliProxyHeaders,
  cacheGrokCliClientVersion,
  clearGrokCliClientVersionCache,
  formatGrokCliVersionErrorMessage,
  GROK_CLI_CLIENT_IDENTIFIER,
  GROK_CLI_TOKEN_AUTH,
  GROK_CLI_VERSION_FALLBACK,
  isCliChatProxyUrl,
  isGrokCliVersionError,
  mapFetchErrorIfGrokCliVersion,
  normalizeGrokCliClientVersion,
  parseGrokCliVersionJson,
  resolveGrokCliClientVersionSync,
  withCliProxyHeaders,
} from "../cliProxyHeaders";
import { XAI_CLI_SESSION_BASE_URL } from "../presets";

describe("parseGrokCliVersionJson", () => {
  it("reads version field", () => {
    expect(
      parseGrokCliVersionJson(
        JSON.stringify({ version: "1.2.3", stable_version: null }),
      ),
    ).toBe("1.2.3");
  });

  it("falls back to stable_version", () => {
    expect(
      parseGrokCliVersionJson(
        JSON.stringify({ version: null, stable_version: "2.0.0" }),
      ),
    ).toBe("2.0.0");
  });

  it("rejects none and empty", () => {
    expect(
      parseGrokCliVersionJson(JSON.stringify({ version: "none" })),
    ).toBeNull();
    expect(
      parseGrokCliVersionJson(JSON.stringify({ version: "  " })),
    ).toBeNull();
    expect(parseGrokCliVersionJson("not-json")).toBeNull();
  });
});

describe("normalize + cache + resolve sync", () => {
  beforeEach(() => {
    clearGrokCliClientVersionCache();
  });

  it("never returns none", () => {
    expect(normalizeGrokCliClientVersion("none")).toBeNull();
    expect(normalizeGrokCliClientVersion("NONE")).toBeNull();
    expect(resolveGrokCliClientVersionSync("none")).toBe(
      GROK_CLI_VERSION_FALLBACK,
    );
  });

  it("prefers cache over hint", () => {
    cacheGrokCliClientVersion("9.9.9");
    expect(resolveGrokCliClientVersionSync("1.0.0")).toBe("9.9.9");
  });
});

describe("buildCliProxyHeaders / withCliProxyHeaders", () => {
  beforeEach(() => {
    clearGrokCliClientVersionCache();
    cacheGrokCliClientVersion("1.0.0");
  });

  it("includes required identity headers", () => {
    const h = buildCliProxyHeaders();
    expect(h["x-grok-client-version"]).toBe("1.0.0");
    expect(h["x-grok-client-identifier"]).toBe(GROK_CLI_CLIENT_IDENTIFIER);
    expect(h["X-XAI-Token-Auth"]).toBe(GROK_CLI_TOKEN_AUTH);
    expect(h["x-grok-client-version"]).not.toBe("none");
  });

  it("injects only for cli-chat-proxy urls", () => {
    expect(isCliChatProxyUrl(XAI_CLI_SESSION_BASE_URL)).toBe(true);
    expect(isCliChatProxyUrl("https://api.x.ai/v1")).toBe(false);

    const proxy = withCliProxyHeaders(`${XAI_CLI_SESSION_BASE_URL}/responses`, {
      Authorization: "Bearer t",
    });
    expect(proxy["x-grok-client-version"]).toBe("1.0.0");
    expect(proxy.Authorization).toBe("Bearer t");

    const other = withCliProxyHeaders("https://api.deepseek.com/models", {
      Authorization: "Bearer t",
    });
    expect(other["x-grok-client-version"]).toBeUndefined();
  });
});

describe("426 / version error mapping", () => {
  it("detects 426 and message patterns", () => {
    expect(isGrokCliVersionError(426)).toBe(true);
    expect(isGrokCliVersionError("Grok CLI version (none)")).toBe(true);
    expect(isGrokCliVersionError("upgrade required")).toBe(true);
    expect(isGrokCliVersionError("normal error")).toBe(false);
  });

  it("maps to 简体中文 CTA", () => {
    const msg = mapFetchErrorIfGrokCliVersion(426, "upgrade");
    expect(msg).toContain("Grok CLI");
    expect(msg).toContain("重新导入");
    expect(formatGrokCliVersionErrorMessage()).toContain("更新本机 Grok CLI");
  });
});
