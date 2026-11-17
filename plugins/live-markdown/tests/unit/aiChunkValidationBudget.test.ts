import { describe, expect, it, vi } from "vitest";
import { runAiTask, type AiTaskRunnerOptions } from "../../src/core/ai/aiTaskRunner";
import { AI_ACTIONS } from "../../src/core/ai/aiTaskPrompts";
import { buildProseEditPlan } from "../../src/core/ai/proseEditPlan";

describe("source-bound prose request budget", () => {
  it("budgets the real slot protocol and stops at the first malformed response without retry", async () => {
    const source = Array.from({ length: 70 }, () => "这是一段需要完整保留的中文计划正文，包含实施步骤、检查边界和回滚说明。").join("\n\n");
    const action = AI_ACTIONS.find((item) => item.id === "polish")!;
    const baseSystemPrompt = "保持原意与结构，只输出完整 Markdown 正文。";
    const instruction = action.prompt;
    const systemPrompt = `${baseSystemPrompt}\n${action.system || ""}`;
    const plan = buildProseEditPlan({ source, instruction, systemPrompt }, 64);

    expect(plan.batches.length).toBeGreaterThan(1);
    expect(plan.batches.every((batch) => batch.contextTokens <= 4096)).toBe(true);
    expect(plan.batches.every((batch) => batch.maxTokens <= 2048)).toBe(true);
    expect(plan.batches.every((batch) => batch.prompt.includes("prose-edit/v1"))).toBe(true);
    expect(plan.batches.every((batch) => batch.systemPrompt.includes("contextBefore/contextAfter 是受限只读相邻语境"))).toBe(true);

    const invoke = vi.fn<AiTaskRunnerOptions["invoke"]>(async () => "短结果");
    await expect(runAiTask({
      source,
      action: "polish",
      baseSystemPrompt,
      actionDefinition: action
    }, {
      invoke,
      isCurrent: () => true,
      abortCurrent: () => undefined
    })).rejects.toThrow();

    expect(invoke).toHaveBeenCalledTimes(1);
    expect(invoke.mock.calls[0][0]).not.toContain("上次输出未通过校验");
  });
});
