import { describe, expect, it, vi } from "vitest";
import { runSummaryTask } from "../../src/core/ai/aiSummaryPipeline";
import { createAiTaskExecution } from "../../src/core/ai/aiTaskExecution";
import type { AiTaskRequest, AiTaskRunnerOptions } from "../../src/core/ai/aiTaskRunner";

const requiredSource = [
  "项目决定采用离线部署方案。",
  "由罗青负责实施。",
  "预算为12万元。",
  "计划于2026-12-19发布。"
].join("\n\n");

function request(source: string, userPrompt = "总结全文") : AiTaskRequest {
  return {
    source,
    action: "summarize",
    userPrompt,
    baseSystemPrompt: "忠于原文。",
    actionDefinition: { id: "summarize", label: "总结", prompt: userPrompt }
  };
}

function makeTask(invoke: AiTaskRunnerOptions["invoke"], maxCalls = 64) {
  return createAiTaskExecution({ invoke, isCurrent: () => true, abortCurrent: vi.fn(), maxCalls });
}

describe("summary inference budget preflight", () => {
  it("keeps required relations from a multi-chunk document without spending model calls", async () => {
    const document = Array.from({ length: 220 }, () => "项目决定采用离线部署方案。")
      .join("\n\n");
    const invoke = vi.fn(async () => JSON.stringify({ ids: [] }));
    const result = await runSummaryTask(request(document), makeTask(invoke, 0), {});

    expect(result.stats.chunks).toBeGreaterThan(1);
    expect(result.stats.modelCalls).toBe(0);
    expect(invoke).not.toHaveBeenCalled();
    expect(result.sourceFacts).toEqual(["项目决定采用离线部署方案。"]);
  });

  it("rejects an item count smaller than the deduplicated required ledger before inference", async () => {
    const document = `${requiredSource}\n\n${requiredSource}`;
    const invoke = vi.fn(async () => JSON.stringify({ ids: [] }));

    await expect(runSummaryTask(request(document, "总结为3条"), makeTask(invoke), {}))
      .rejects.toThrow(/必保的 4 条原文事实/);
    expect(invoke).not.toHaveBeenCalled();
  });

  it("rejects a character budget smaller than all required facts before inference", async () => {
    const invoke = vi.fn(async () => JSON.stringify({ ids: [] }));

    await expect(runSummaryTask(request(requiredSource, "摘要最多5个字"), makeTask(invoke), {}))
      .rejects.toThrow(/5 字限制/);
    expect(invoke).not.toHaveBeenCalled();
  });

  it("skips optional selection when the user's item count equals the required ledger", async () => {
    const document = "项目决定采用离线方案。\n\n由罗青负责实施。\n\n日常背景记录了沟通方式。";
    const invoke = vi.fn(async () => JSON.stringify({ ids: [] }));
    const result = await runSummaryTask(request(document, "总结为2条"), makeTask(invoke), {});

    expect(result.sourceFacts).toEqual(["项目决定采用离线方案。", "由罗青负责实施。"]);
    expect(result.stats.modelCalls).toBe(0);
    expect(invoke).not.toHaveBeenCalled();
  });

  it("does not select optional facts when required facts already exceed the default 400-character target", async () => {
    const longRequiredFacts = Array.from({ length: 6 }, (_, index) =>
      `项目决定${"采用离线架构".repeat(12)}方案${index + 1}，由罗青负责并于2026-12-19发布。`
    );
    const document = [...longRequiredFacts, "背景说明可以保持协作节奏清晰。"].join("\n\n");
    const invoke = vi.fn(async () => JSON.stringify({ ids: [] }));
    const result = await runSummaryTask(request(document), makeTask(invoke), {});

    expect(result.sourceFacts).toHaveLength(6);
    expect(result.sourceFacts.every((fact) => longRequiredFacts.includes(fact))).toBe(true);
    expect(result.text.length).toBeGreaterThan(400);
    expect(result.stats.modelCalls).toBe(0);
    expect(invoke).not.toHaveBeenCalled();
  });

  it("still observes cancelled and stale tasks when the required-only path needs no inference", async () => {
    const controller = new AbortController();
    controller.abort();
    const invoke = vi.fn(async () => JSON.stringify({ ids: [] }));
    const task = createAiTaskExecution({
      invoke,
      signal: controller.signal,
      isCurrent: () => true,
      abortCurrent: vi.fn()
    });

    await expect(runSummaryTask(request(requiredSource), task, {})).rejects.toThrow(/任务已取消/);
    expect(invoke).not.toHaveBeenCalled();

    const staleInvoke = vi.fn(async () => JSON.stringify({ ids: [] }));
    const staleTask = createAiTaskExecution({
      invoke: staleInvoke,
      isCurrent: () => false,
      abortCurrent: vi.fn()
    });
    await expect(runSummaryTask(request(requiredSource), staleTask, {})).rejects.toThrow(/任务已取消/);
    expect(staleInvoke).not.toHaveBeenCalled();
  });

  it("still invokes selection when optional facts can fit and never retries invalid IDs", async () => {
    const invoke = vi.fn(async () => JSON.stringify({ ids: ["unknown-id"] }));

    await expect(runSummaryTask(request("项目记录了每周沟通方式。"), makeTask(invoke), {}))
      .rejects.toThrow(/无法回溯/);
    expect(invoke).toHaveBeenCalledTimes(1);
  });

  it("rejects more requested items than distinct source facts before inference", async () => {
    const document = "背景介绍了沟通方式。\n\n材料说明了文稿结构。\n\n背景介绍了沟通方式。";
    const invoke = vi.fn(async () => JSON.stringify({ ids: [] }));
    await expect(runSummaryTask(request(document, "总结为3条"), makeTask(invoke), {}))
      .rejects.toThrow(/仅有 2 条完整原文事实.*无法满足 3 条/);
    expect(invoke).not.toHaveBeenCalled();
  });
});
