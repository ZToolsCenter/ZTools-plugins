import { describe, expect, it, vi } from "vitest";
import * as constraints from "../../src/core/ai/instructionConstraints";
import { planAiIntent } from "../../src/core/ai/intentPlanner";
// Retained full-policy regression; default thin behavior has separate production-entry tests.
import { runFullHarnessTaskCore as runPlannedAiTask } from "../../src/core/ai/fullHarnessTaskRunnerCore";

describe("instruction budget before any contract or candidate parsing", () => {
  it("rejects an over-budget multibyte instruction before deriving the default contract", async () => {
    const derive = vi.spyOn(constraints, "deriveInstructionContract");
    const invoke = vi.fn(async () => "");
    try {
      await expect(planAiIntent("润色".repeat(12_000), false, { headings: [], literals: [] }, invoke)).rejects.toMatchObject({ code: "budget_exceeded" });
      expect(derive).not.toHaveBeenCalled();
      expect(invoke).not.toHaveBeenCalled();
    } finally { derive.mockRestore(); }
  });
  it("applies the same guard at the production entry before scanning a large instruction", async () => {
    const derive = vi.spyOn(constraints, "deriveInstructionContract");
    const invoke = vi.fn(async () => "");
    const source = "原文保持不变。";
    const snapshot = { documentId: "d.md", revision: 1, content: source, selection: null, cursor: null, readOnly: false };
    try {
      await expect(runPlannedAiTask({ source, action: "custom", userPrompt: "润色".repeat(12_000), baseSystemPrompt: "", actionDefinition: { id: "custom", label: "自定义", prompt: "" } }, snapshot, { invoke, isCurrent: () => true, abortCurrent: vi.fn() })).rejects.toMatchObject({ code: "budget_exceeded" });
      expect(derive).not.toHaveBeenCalled();
      expect(invoke).not.toHaveBeenCalled();
      expect(snapshot.content).toBe(source);
    } finally { derive.mockRestore(); }
  });
});
