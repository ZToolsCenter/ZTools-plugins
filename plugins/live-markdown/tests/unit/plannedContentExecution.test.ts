import { expect, it, vi } from "vitest";
import { buildAiTaskRequest } from "../../src/core/ai/aiTaskRequest";
import { runPlannedAiTaskCore } from "../../src/core/ai/plannedTaskRunnerCore";
import { resolveAiEdit } from "../../src/core/ai/editProposal";
import type { AiTaskRunnerOptions } from "../../src/core/ai/aiTaskRunner";

const model = "Qwen3-0.6B-Q4_K_M.gguf";
function run(source: string, instruction: string, invoke: AiTaskRunnerOptions["invoke"], maxCalls = 16, modelId = model) {
  const request = buildAiTaskRequest({ source, selected: false, action: "custom", userPrompt: instruction,
    config: { provider: "local", activeRoleId: "general", model: modelId } });
  const snapshot = { documentId: "planned.md", revision: 1, content: source, selection: null, cursor: null, readOnly: false };
  return runPlannedAiTaskCore(request, snapshot, { invoke, maxCalls, isCurrent: () => true, abortCurrent() {} });
}

it("collects multiple readable lines before creating one source-preserving replacement", async () => {
  const source = "The release note need review.\r\n\r\nThese notes needs approval.";
  const invoke = vi.fn(async (prompt: string, _system: string, _tokens: number, _emit: unknown, schema: unknown) => {
    expect(schema).toBeUndefined();
    return prompt.includes("The release note") ? "The release note needs review." : "These notes need approval.";
  });
  const result = await run(source, "校对正文，保留换行和格式。", invoke);
  expect(invoke).toHaveBeenCalledTimes(2);
  expect(resolveAiEdit(result.proposal!)?.content).toBe("The release note needs review.\r\n\r\nThese notes need approval.");
  expect(result.proposal?.snapshot.content).toBe(source);
});

it("separates a grammar sentence from protected-code noise and preserves the boundary space", async () => {
  const source = "The **release note** need review. Keep `v2.1` exact.";
  const invoke = vi.fn(async (prompt: string) => prompt.includes("release note")
    ? "The release note needs review." : prompt.split("\n\n").at(-1)!.trim());
  const result = await run(source, "校对正文，保留代码和格式。", invoke);
  expect(invoke).toHaveBeenCalledTimes(2);
  expect(invoke.mock.calls[0][0]).not.toContain("ProtectedLiveMarkdownAtom");
  expect(resolveAiEdit(result.proposal!)?.content).toBe("The **release note** needs review. Keep `v2.1` exact.");
});

it("rejects insufficient prose call budget before making a request", async () => {
  const invoke = vi.fn();
  await expect(run("First line need review.\nSecond line need review.", "校对正文。", invoke, 1)).rejects.toThrow(/预算/u);
  expect(invoke).not.toHaveBeenCalled();
});

it("discards staged prose when a later planned response fails without retry", async () => {
  const invoke = vi.fn().mockResolvedValueOnce("First line needs review.").mockRejectedValueOnce(new Error("second-line-failed"));
  await expect(run("First line need review.\nSecond line need review.", "校对正文。", invoke)).rejects.toThrow("second-line-failed");
  expect(invoke).toHaveBeenCalledTimes(2);
});

const source = "# Current\n\nPRIVATE_SOURCE remains untouched.";
const instruction = "在文末写一个发布演练草案，按顺序用小标题 目标、步骤、风险 组织。";
const bodies = ["验证模拟发布和回滚流程可以完成。", "在隔离测试副本进行模拟发布，并检查服务状态。", "若检查失败，停止演练并检查日志。"];
it("keeps one structured section request for evaluated and other local models", async () => {
  for (const modelId of [model, "another-local-model"]) {
    const invoke = vi.fn(async (_prompt: string, _system: string, _tokens: number, _emit: unknown, schema: unknown) => {
      expect(schema).toHaveProperty("properties.payload.properties.sections");
      return JSON.stringify({ payload: { sections: { 目标: bodies[0], 步骤: bodies[1], 风险: bodies[2] } } });
    });
    const result = await run(source, instruction, invoke, 1, modelId);
    expect(invoke).toHaveBeenCalledTimes(1);
    expect(resolveAiEdit(result.proposal!)?.content).toContain("## 目标");
    expect(result.proposal?.snapshot.content).toBe(source);
  }
});
