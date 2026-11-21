import { expect, it, vi } from "vitest";
import { buildAiTaskRequest } from "../../src/core/ai/aiTaskRequest";
import { runPlannedAiTaskCore } from "../../src/core/ai/plannedTaskRunnerCore";

it("binds a writing request using 写一个 before asking the model only for section prose", async () => {
  const content = "# Notes\n\nPRIVATE_SOURCE is unchanged.";
  const instruction = "在文末写一个发布演练草案，按顺序用小标题 目标、步骤、风险 组织。不要复述指令或使用占位内容。";
  const invoke = vi.fn(async (prompt: string, _system: string, _tokens: number, _emit: unknown, schema?: Record<string, unknown>) => {
    expect(prompt).not.toContain("PRIVATE_SOURCE");
    expect(schema).toHaveProperty("properties.payload");
    return JSON.stringify({ payload: { sections: { 目标: "验证分批发布。", 步骤: "先演练再复核。", 风险: "异常时暂停发布。" } } });
  });
  const request = buildAiTaskRequest({ source: content, selected: false, action: "custom", userPrompt: instruction,
    config: { provider: "local", activeRoleId: "general" } });
  const result = await runPlannedAiTaskCore(request,
    { documentId: "draft.md", revision: 1, content, selection: null, cursor: null, readOnly: false },
    { invoke, isCurrent: () => true, abortCurrent() {} });
  expect(result.contentExecutor).toBe("artifact");
  expect(result.candidateText).toBe("## 目标\n\n验证分批发布。\n\n## 步骤\n\n先演练再复核。\n\n## 风险\n\n异常时暂停发布。");
  expect(invoke).toHaveBeenCalledTimes(1);
});
