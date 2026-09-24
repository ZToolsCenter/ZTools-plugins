import { describe, expect, it } from "vitest";
import {
  estimateTokensFromImageBase64,
  estimateTokensFromText,
  estimateTurnUsage,
  mergeUsage,
  parseClaudeUsage,
  parseOpenAIChatUsage,
  parseOpenAIResponsesUsage,
  withSpeed,
} from "../usage";

describe("estimateTokensFromText", () => {
  it("returns 0 for empty string", () => {
    expect(estimateTokensFromText("")).toBe(0);
  });

  it("counts CJK roughly 1 token per char", () => {
    expect(estimateTokensFromText("你好世界")).toBe(4);
  });

  it("counts latin roughly 1 token per 4 chars", () => {
    expect(estimateTokensFromText("abcd")).toBe(1);
    expect(estimateTokensFromText("abcdefgh")).toBe(2);
  });
});

describe("estimateTokensFromImageBase64", () => {
  it("returns 0 for empty string", () => {
    expect(estimateTokensFromImageBase64("")).toBe(0);
  });

  it("uses floor of 85 for small payloads", () => {
    expect(estimateTokensFromImageBase64("a".repeat(100))).toBe(85);
  });

  it("scales with base64 length above floor", () => {
    // 750 * 2 = 1500 → ceil(1500/750)=2 → max(85,2)=85 still floor
    expect(estimateTokensFromImageBase64("x".repeat(1500))).toBe(85);
    // 750 * 100 = 75000 → 100 tokens
    expect(estimateTokensFromImageBase64("x".repeat(75_000))).toBe(100);
    // non-multiple: ceil(75001/750)=101
    expect(estimateTokensFromImageBase64("x".repeat(75_001))).toBe(101);
  });
});

describe("parseOpenAIChatUsage", () => {
  it("parses standard usage + cache + reasoning", () => {
    const partial = parseOpenAIChatUsage({
      usage: {
        prompt_tokens: 100,
        completion_tokens: 50,
        total_tokens: 150,
        prompt_tokens_details: { cached_tokens: 20 },
        completion_tokens_details: { reasoning_tokens: 10 },
      },
    });
    expect(partial).toMatchObject({
      promptTokens: 100,
      completionTokens: 50,
      totalTokens: 150,
      cacheReadTokens: 20,
      reasoningTokens: 10,
      source: "provider",
    });
  });

  it("returns null without usage", () => {
    expect(parseOpenAIChatUsage({ choices: [] })).toBeNull();
    expect(parseOpenAIChatUsage(null)).toBeNull();
  });
});

describe("parseOpenAIResponsesUsage", () => {
  it("parses input/output tokens", () => {
    const partial = parseOpenAIResponsesUsage({
      usage: {
        input_tokens: 80,
        output_tokens: 40,
        total_tokens: 120,
        input_tokens_details: { cached_tokens: 5 },
        output_tokens_details: { reasoning_tokens: 8 },
      },
    });
    expect(partial).toMatchObject({
      promptTokens: 80,
      completionTokens: 40,
      totalTokens: 120,
      cacheReadTokens: 5,
      reasoningTokens: 8,
      source: "provider",
    });
  });
});

describe("parseClaudeUsage", () => {
  it("parses message.usage with cache fields", () => {
    const partial = parseClaudeUsage({
      message: {
        usage: {
          input_tokens: 200,
          output_tokens: 30,
          cache_read_input_tokens: 50,
          cache_creation_input_tokens: 10,
        },
      },
    });
    expect(partial).toMatchObject({
      promptTokens: 200,
      completionTokens: 30,
      totalTokens: 230,
      cacheReadTokens: 50,
      cacheWriteTokens: 10,
      source: "provider",
    });
  });

  it("parses flat usage object", () => {
    const partial = parseClaudeUsage({
      usage: { input_tokens: 1, output_tokens: 2 },
    });
    expect(partial).toMatchObject({
      promptTokens: 1,
      completionTokens: 2,
      totalTokens: 3,
    });
  });
});

describe("mergeUsage", () => {
  it("sums numeric fields across steps", () => {
    const a = parseOpenAIChatUsage({
      usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
    });
    const b = parseOpenAIChatUsage({
      usage: { prompt_tokens: 20, completion_tokens: 8, total_tokens: 28 },
    });
    const merged = mergeUsage(a, b);
    expect(merged.promptTokens).toBe(30);
    expect(merged.completionTokens).toBe(13);
    expect(merged.totalTokens).toBe(43);
    expect(merged.source).toBe("provider");
  });

  it("prefers provider source if any step had provider", () => {
    const merged = mergeUsage(
      { promptTokens: 1, completionTokens: 1, totalTokens: 2, source: "estimate" },
      { promptTokens: 2, completionTokens: 2, totalTokens: 4, source: "provider" },
    );
    expect(merged.source).toBe("provider");
  });
});

describe("withSpeed", () => {
  it("sets durationMs and tokensPerSecond from completion", () => {
    const base = mergeUsage(null, {
      promptTokens: 10,
      completionTokens: 100,
      totalTokens: 110,
      source: "provider",
    });
    const withSpd = withSpeed(base, 2000);
    expect(withSpd.durationMs).toBe(2000);
    expect(withSpd.tokensPerSecond).toBe(50);
  });
});

describe("estimateTurnUsage", () => {
  it("marks source as estimate and includes systemPromptTokens", () => {
    const u = estimateTurnUsage({
      systemPrompt: "系统",
      messages: [{ content: "你好" }],
      completionText: "回复",
      systemPromptTokens: 2,
    });
    expect(u.source).toBe("estimate");
    expect(u.systemPromptTokens).toBe(2);
    expect(u.promptTokens).toBeGreaterThan(0);
    expect(u.completionTokens).toBeGreaterThan(0);
  });
});
