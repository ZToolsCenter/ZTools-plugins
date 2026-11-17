import { expect, it, vi } from "vitest";
import { buildAiTaskRequest } from "../../src/core/ai/aiTaskRequest";
import { resolveAiEdit } from "../../src/core/ai/editProposal";
import { runPlannedAiTaskCore } from "../../src/core/ai/plannedTaskRunnerCore";
import type { AiTaskRunnerOptions } from "../../src/core/ai/aiTaskRunner";
import { createAiTaskExecution } from "../../src/core/ai/aiTaskExecution";
import { runThinProseTask } from "../../src/core/ai/thinProseTask";

const source = "本次核对金额为18万元，请请项目组再次确认。";
const instruction = "润色正文，删去明显重复的请求用词；保留金额和核对事项，不添加事实。";

it("accepts the captured two-call duplicate-request correction without changing other source bytes", async () => {
  const request = buildAiTaskRequest({ source, selected: false, action: "polish", userPrompt: instruction,
    config: { provider: "local", activeRoleId: "general", executionPolicy: "thin", model: "Qwen3-1.7B-Q4_K_M.gguf" } });
  const snapshot = { documentId: "request-marker.md", revision: 1, content: source,
    selection: null, cursor: source.length, readOnly: false };
  const invoke = vi.fn<AiTaskRunnerOptions["invoke"]>(async (prompt) => {
    if (prompt.includes("本次核对金额为18万元")) return "本次核对金额为18万元";
    if (prompt.includes("请请项目组再次确认。")) return "请项目组再次确认。";
    throw new Error(`Unexpected captured core prompt: ${prompt.slice(0, 120)}`);
  });

  const result = await runPlannedAiTaskCore(request, snapshot, {
    invoke, maxCalls: 8, isCurrent: () => true, abortCurrent() {}
  });

  expect(invoke).toHaveBeenCalledTimes(2);
  expect(resolveAiEdit(result.proposal!)?.content).toBe("本次核对金额为18万元，请项目组再次确认。");
});

it("keeps full-document date ownership and AST validation active alongside the proof", async () => {
  const mixedSource = "由林安负责的排期日期是2026-11-03，请请大家再次确认。";
  const responses = ["林安负责的2026-11-03排期", "请大家再次确认。"];
  const invoke = vi.fn<AiTaskRunnerOptions["invoke"]>(async () => responses.shift()!);
  const options: AiTaskRunnerOptions = { invoke, isCurrent: () => true, abortCurrent() {} };
  const result = await runThinProseTask({ source: mixedSource,
    instruction: "润色正文，删去明显重复的请求用词；保留日期、负责人和核对事项，不添加事实。",
    systemPrompt: "", preferReadable: true }, createAiTaskExecution(options), options);

  expect(invoke).toHaveBeenCalledTimes(2);
  expect(result.text).toBe("林安负责的2026-11-03排期，请大家再次确认。");
});

it.each([
  ["amount", "本次核对金额为19万元", "请请星河项目组再次确认。"],
  ["project name", "本次核对金额为18万元", "请银河项目组再次确认。"],
  ["recipient", "本次核对金额为18万元", "请财务组再次确认。"],
  ["negation", "本次核对金额为18万元", "请星河项目组不要确认。"]
] as const)("keeps the ordinary captured-core guard for a changed %s", async (_kind, amountText, requestText) => {
  const source = "本次核对金额为18万元，请请星河项目组再次确认。";
  const request = buildAiTaskRequest({ source, selected: false, action: "polish", userPrompt: instruction,
    config: { provider: "local", activeRoleId: "general", executionPolicy: "thin", model: "Qwen3-1.7B-Q4_K_M.gguf" } });
  const snapshot = { documentId: "request-marker-negative.md", revision: 1, content: source,
    selection: null, cursor: source.length, readOnly: false };
  const invoke = vi.fn<AiTaskRunnerOptions["invoke"]>(async prompt => {
    if (prompt.includes("本次核对金额为18万元")) return amountText;
    if (prompt.includes("请请星河项目组再次确认。")) return requestText;
    throw new Error(`Unexpected captured-core negative prompt: ${prompt.slice(0, 120)}`);
  });
  await expect(runPlannedAiTaskCore(request, snapshot, {
    invoke, maxCalls: 8, isCurrent: () => true, abortCurrent() {}
  })).rejects.toThrow();
});
