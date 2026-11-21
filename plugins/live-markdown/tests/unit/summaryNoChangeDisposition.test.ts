import { describe, expect, it, vi } from "vitest";
import { runAiTask, type AiTaskRequest, type AiTaskRunnerOptions } from "../../src/core/ai/aiTaskRunner";
import { createAiTaskExecution } from "../../src/core/ai/aiTaskExecution";
// Retained full-policy regression; default thin behavior has separate production-entry tests.
import { runFullHarnessTaskCore as runPlannedAiTask } from "../../src/core/ai/fullHarnessTaskRunnerCore";
import { runSummaryTask } from "../../src/core/ai/aiSummaryPipeline";

const requiredSource = Array.from({ length: 32 }, (_, index) =>
  `- 项目决定采用离线部署方案${index + 1}，由团队成员负责核对本地工作区的文件编辑、自动保存、文档检索和发布验证流程。`
).join("\n");

function request(source: string, userPrompt = "总结全文") : AiTaskRequest {
  return {
    source,
    action: "summarize",
    userPrompt,
    baseSystemPrompt: "忠于原文。",
    actionDefinition: { id: "summarize", label: "总结", prompt: userPrompt }
  };
}

function options(invoke: AiTaskRunnerOptions["invoke"]): AiTaskRunnerOptions {
  return { invoke, isCurrent: () => true, abortCurrent: vi.fn() };
}

function snapshot(content: string) {
  return { documentId: "draft.md", revision: 7, content, selection: null, cursor: null, readOnly: false };
}

function plannedOptions(plan: unknown) {
  const invoke = vi.fn<AiTaskRunnerOptions["invoke"]>(async () => JSON.stringify(plan));
  return { invoke, options: options(invoke) };
}

describe("verified summary with no document change", () => {
  it("marks the ledger-rendered 32-fact, 1750-character source as preserved without inference", async () => {
    expect(Array.from(requiredSource)).toHaveLength(1750);

    const invoke = vi.fn<AiTaskRunnerOptions["invoke"]>(async () => {
      throw new Error("All 32 facts are required; summary selection must not call the model.");
    });
    const execution = createAiTaskExecution({ invoke, isCurrent: () => true, abortCurrent: vi.fn() });
    const result = await runSummaryTask(request(requiredSource), execution, {});

    expect(result.text).toBe(requiredSource);
    expect(result.sourceFacts).toHaveLength(32);
    expect(result.stats.modelCalls).toBe(0);
    expect(result.preservedSource).toBe(true);
    expect(invoke).not.toHaveBeenCalled();
  });

  it("treats a CRLF-only ledger rendering difference as unchanged and returns the exact source", async () => {
    const crlfSource = requiredSource.replace(/\n/gu, "\r\n");
    const invoke = vi.fn<AiTaskRunnerOptions["invoke"]>(async () => {
      throw new Error("All 32 facts are required; summary selection must not call the model.");
    });
    const execution = createAiTaskExecution({ invoke, isCurrent: () => true, abortCurrent: vi.fn() });
    const result = await runSummaryTask(request(crlfSource), execution, {});

    expect(result.text).toBe(crlfSource);
    expect(result.preservedSource).toBe(true);
    expect(result.warnings).toContain("摘要与原文一致，文档保持不变。");
    expect(invoke).not.toHaveBeenCalled();
  });

  it("carries the verified no-change disposition through runAiTask", async () => {
    const invoke = vi.fn<AiTaskRunnerOptions["invoke"]>(async () => {
      throw new Error("All 32 facts are required; summary selection must not call the model.");
    });
    const result = await runAiTask(request(requiredSource), options(invoke));

    expect(result.text).toBe(requiredSource);
    expect(result.preservedSource).toBe(true);
    expect(result.warnings).toContain("摘要与原文一致，文档保持不变。");
    expect(result.summaryStats?.modelCalls).toBe(0);
    expect(invoke).not.toHaveBeenCalled();
  });

  it("propagates no-change from the multi-chunk summary route below the token threshold", async () => {
    const source = Array.from({ length: 32 }, (_, index) =>
      `- 项目决定采用方案${index + 1}，由团队负责核验流程与结果。`
    ).join("\n");
    const invoke = vi.fn<AiTaskRunnerOptions["invoke"]>(async () => {
      throw new Error("All 32 facts are required; multi-chunk summary must not call the model.");
    });
    const result = await runAiTask({
      ...request(source),
      baseSystemPrompt: "系统约束。".repeat(320)
    }, options(invoke));

    expect(result.text).toBe(source);
    expect(result.preservedSource).toBe(true);
    expect(result.summaryStats?.chunks).toBeGreaterThan(1);
    expect(result.summaryStats?.modelCalls).toBe(0);
    expect(result.warnings).toContain("摘要与原文一致，文档保持不变。");
    expect(invoke).not.toHaveBeenCalled();
  });

  it("shows the unchanged summary through the planned answer route without a proposal or generation call", async () => {
    const plan = {
      version: 1, kind: "answer", target: "document",
      content: { mode: "generate", task: "summarize" }
    };
    const { invoke, options: runnerOptions } = plannedOptions(plan);
    const result = await runPlannedAiTask({
      ...request(requiredSource, "总结全文，只回答，不修改文档。"),
      action: "custom",
      actionDefinition: { id: "custom", label: "自定义", prompt: "总结全文，只回答，不修改文档。" }
    }, snapshot(requiredSource), runnerOptions);

    expect(result.answerOnly).toBe(true);
    expect(result.text).toBe(requiredSource);
    expect(result.preservedSource).toBe(true);
    expect(result.proposal).toBeUndefined();
    expect(result.warnings).toContain("摘要与原文一致，文档保持不变。");
    expect(result.summaryStats?.modelCalls).toBe(0);
    expect(invoke.mock.calls.filter((call) => (call[4] as { properties?: { ids?: unknown } } | undefined)?.properties?.ids)).toHaveLength(0);
  });

  it("does not append a verified summary that is identical to the source", async () => {
    const plan = {
      version: 1, kind: "edit", operation: "insert", target: "document_end", layout: "block",
      content: { mode: "generate", task: "summarize" }
    };
    const { invoke, options: runnerOptions } = plannedOptions(plan);
    const result = await runPlannedAiTask({
      ...request(requiredSource, "在文末新增全文摘要。"),
      action: "custom",
      actionDefinition: { id: "custom", label: "自定义", prompt: "在文末新增全文摘要。" }
    }, snapshot(requiredSource), runnerOptions);

    expect(result.text).toBe(requiredSource);
    expect(result.preservedSource).toBe(true);
    expect(result.proposal).toBeUndefined();
    expect(result.warnings).toContain("摘要与原文一致，文档保持不变。");
    expect(result.summaryStats?.modelCalls).toBe(0);
    expect(invoke.mock.calls.filter((call) => (call[4] as { properties?: { ids?: unknown } } | undefined)?.properties?.ids)).toHaveLength(0);
  });

  it("still rejects a model echo when no verified summary ledger produced it", async () => {
    const source = "未分段摘要的原文回显仍需通过通用输出合约检查。".repeat(5);
    const invoke = vi.fn<AiTaskRunnerOptions["invoke"]>(async prompt => prompt.includes("本次用户指令：")
      ? JSON.stringify({ version: 1, kind: "answer", target: "document", content: { mode: "generate", task: "summarize" } })
      : source);
    await expect(runPlannedAiTask({
      ...request(source, "总结全文的内容，只回答，不修改文档。"),
      action: "custom",
      actionDefinition: { id: "custom", label: "自定义", prompt: "总结全文的内容，只回答，不修改文档。" }
    }, snapshot(source), options(invoke))).rejects.toThrow(/重复了过多原文|source_echo|重复原文/);
    expect(invoke).toHaveBeenCalledTimes(2);
  });
});
