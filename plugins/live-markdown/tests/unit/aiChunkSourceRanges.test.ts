import { describe, expect, it } from "vitest";
import { planMarkdownAiRequests } from "../../src/core/ai/aiChunkPlanner";

const buildPrompt = (text: string, context: string) => ({ prompt: `${context}\n${text}`, systemPrompt: "只读抽取" });
describe("unmasked chunk source ownership", () => {
  it("maps repeated source to distinct contiguous ranges without searching for text", () => {
    const source = "# 说明\r\n\r\n" + "重复背景有同一段文字。😀\r\n\r\n".repeat(600);
    const plan = planMarkdownAiRequests(source, { protectMarkdown: false, conservative: false, buildPrompt });
    expect(plan.exceeded).toBeNull();
    expect(plan.chunks.length).toBeGreaterThan(1);
    let from = 0;
    for (const chunk of plan.chunks) {
      expect(chunk.ownedRange).toEqual({ from, to: from + chunk.text.length });
      expect(source.slice(chunk.ownedRange!.from, chunk.ownedRange!.to)).toBe(chunk.text);
      expect(chunk.text.startsWith("\n")).toBe(false);
      for (const range of chunk.contextRanges ?? []) {
        expect(range.to - range.from).toBeLessThanOrEqual(121);
        expect(range.to <= chunk.ownedRange!.from || range.from >= chunk.ownedRange!.to).toBe(true);
      }
      from += chunk.text.length;
    }
    expect(from).toBe(source.length);
  });
  it("never labels masked source offsets as original-source offsets", () => {
    const source = "正文。\n\n```js\nsecret()\n```\n\n结尾。";
    const plan = planMarkdownAiRequests(source, { protectMarkdown: true, conservative: true, buildPrompt });
    expect(plan.chunks.every(chunk => chunk.ownedRange === undefined && chunk.contextRanges === undefined)).toBe(true);
  });
});
