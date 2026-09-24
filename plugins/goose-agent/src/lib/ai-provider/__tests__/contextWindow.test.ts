import { describe, expect, it } from "vitest";
import {
  DEFAULT_CONTEXT_WINDOW,
  formatTokenCount,
  resolveContextWindowTokens,
} from "../contextWindow";

describe("resolveContextWindowTokens", () => {
  it("explicit modelOptions[].contextWindow wins over heuristics", () => {
    const result = resolveContextWindowTokens({
      modelId: "claude-sonnet",
      modelOptions: [
        { id: "claude-sonnet", label: "Claude Sonnet", contextWindow: 64000 },
      ],
    });
    expect(result).toBe(64000);
  });

  it("matches modelOptions via canonical provider/model id", () => {
    const result = resolveContextWindowTokens({
      modelId: "deepseek/deepseek-chat",
      modelOptions: [
        { id: "deepseek-chat", label: "Chat", contextWindow: 64000 },
      ],
      providerId: "deepseek",
    });
    expect(result).toBe(64000);
  });

  it("claude/anthropic modelId heuristic → 200_000", () => {
    expect(resolveContextWindowTokens({ modelId: "claude-3-5-sonnet" })).toBe(
      200_000,
    );
    expect(
      resolveContextWindowTokens({ modelId: "anthropic.claude-v2" }),
    ).toBe(200_000);
  });

  it("deepseek → 128_000", () => {
    expect(resolveContextWindowTokens({ modelId: "deepseek-chat" })).toBe(
      128_000,
    );
  });

  it("MiniMax-M2.5 → 204_800", () => {
    expect(resolveContextWindowTokens({ modelId: "MiniMax-M2.5" })).toBe(
      204_800,
    );
  });

  it("protocol claude fallback when no modelId → 200_000", () => {
    expect(
      resolveContextWindowTokens({ modelId: null, protocol: "claude" }),
    ).toBe(200_000);
  });

  it("protocol openai / openai-responses → 128_000", () => {
    expect(
      resolveContextWindowTokens({ modelId: null, protocol: "openai" }),
    ).toBe(128_000);
    expect(
      resolveContextWindowTokens({
        modelId: null,
        protocol: "openai-responses",
      }),
    ).toBe(128_000);
  });

  it("ultimate fallback → DEFAULT_CONTEXT_WINDOW (positive)", () => {
    const result = resolveContextWindowTokens({ modelId: null });
    expect(result).toBe(DEFAULT_CONTEXT_WINDOW);
    expect(DEFAULT_CONTEXT_WINDOW).toBeGreaterThan(0);
  });
});

describe("formatTokenCount", () => {
  it("formats small numbers without suffix", () => {
    expect(formatTokenCount(0)).toBe("0");
    expect(formatTokenCount(42)).toBe("42");
    expect(formatTokenCount(999)).toBe("999");
  });

  it("formats thousands with K", () => {
    const k = formatTokenCount(12400);
    expect(k).toContain("K");
    expect(k).toBe(formatTokenCount(12400));
    expect(formatTokenCount(1000)).toMatch(/1K|1\.0K/);
  });

  it("formats millions with M", () => {
    const m = formatTokenCount(1_200_000);
    expect(m).toContain("M");
    expect(m).toBe(formatTokenCount(1_200_000));
  });
});
