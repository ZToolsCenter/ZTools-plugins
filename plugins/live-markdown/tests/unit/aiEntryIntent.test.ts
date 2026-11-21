import { describe, expect, it } from "vitest";
import { createAiEntryIntent, resolveAiEntryIntent, resolveAiSkillId } from "../../src/core/ai/aiEntryIntent";

describe("AI entry intent routing", () => {
  it("opens the assistant without inheriting a previous one-shot action", () => {
    const openOnly = createAiEntryIntent("ai_chat", 4)!;
    expect(resolveAiEntryIntent(openOnly)).toEqual({ action: null, requestKey: openOnly });
    expect(resolveAiEntryIntent("ai_chat")).toEqual({ action: null, requestKey: "ai_chat" });
  });

  it("keeps repeated explicit actions distinct and resolves their original action", () => {
    const first = createAiEntryIntent("polish", 1);
    const second = createAiEntryIntent("polish", 2);
    expect(first).not.toBe(second);
    expect(resolveAiEntryIntent(first!)).toEqual({ action: "polish", requestKey: first });
    expect(resolveAiEntryIntent(second!)).toEqual({ action: "polish", requestKey: second });
  });

  it("routes explicit polish and summary actions to their dedicated built-in Skills", () => {
    expect(resolveAiSkillId("polish")).toBe("polish");
    expect(resolveAiSkillId("summarize")).toBe("quick-summarize");
    expect(resolveAiSkillId("continue")).toBeNull();
  });
});
