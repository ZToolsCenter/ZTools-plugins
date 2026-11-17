import { describe, expect, it } from "vitest";
import { selectAiChunkGranularity } from "../../src/core/ai/aiChunkingPolicy";

describe("AI chunking policy", () => {
  it("uses paragraph calls for local conservative proofreading and editing", () => {
    expect(selectAiChunkGranularity("local", "polish")).toBe("paragraph");
    expect(selectAiChunkGranularity("local", "proofread")).toBe("paragraph");
    expect(selectAiChunkGranularity("local", "academic-polish")).toBe("paragraph");
    expect(selectAiChunkGranularity("local", "typo-proofread")).toBe("paragraph");
  });

  it("keeps hosted, custom, structural and non-replacement tasks on budget planning", () => {
    for (const provider of ["ztools", "atools"] as const) {
      expect(selectAiChunkGranularity(provider, "polish")).toBe("budget");
    }
    for (const action of ["custom", "tech-spec", "content-expand", "summarize", "continue", "diagram"] as const) {
      expect(selectAiChunkGranularity("local", action)).toBe("budget");
    }
    expect(selectAiChunkGranularity("local", "polish", { id: "summary-skill", category: "summary" })).toBe("budget");
    expect(selectAiChunkGranularity("local", "polish", { id: "diagram-skill", category: "diagram" })).toBe("budget");
  });
});
