import { describe, expect, it, vi } from "vitest";
import { runPlannedAiTaskCore } from "../../src/core/ai/plannedTaskRunnerCore";
import { buildAiTaskRequest } from "../../src/core/ai/aiTaskRequest";

async function run(instruction: string, source: string, selection: { from: number; to: number } | null = null) {
  const invoke = vi.fn(async (_prompt: string) => JSON.stringify({ ids: [] }));
  const request = buildAiTaskRequest({ source: selection ? source.slice(selection.from, selection.to) : source,
    selected: !!selection, action: "custom", userPrompt: instruction,
    config: { provider: "local", activeRoleId: "general" } });
  const snapshot = { documentId: "route.md", revision: 2, content: source, selection, cursor: null, readOnly: false };
  const result = await runPlannedAiTaskCore(request, snapshot, { invoke, isCurrent: () => true, abortCurrent() {} });
  expect(snapshot.content).toBe(source);
  expect(result.proposal).toBeUndefined();
  return { result, invoke };
}

describe("task semantics choose the thin content executor", () => {
  it.each(["这个 Markdown 里有哪些标题？", "列出这篇 Markdown 的标题"])("lists actual Markdown headings: %s", async instruction => {
    const { result, invoke } = await run(instruction, "# 发布计划\n\n## 备份\n\n完成检查。");
    expect(invoke).not.toHaveBeenCalled();
    expect(result.text).toContain("发布计划");
    expect(result.text).toContain("备份");
    expect(result.text).not.toContain("CommonMark");
    expect(result.text).not.toContain("# 标题");
  });

  it("does not list a heading outside the selected source range", async () => {
    const source = "# OUTSIDE\n\n## Inside\n\nSelected text.\n\n# AFTER";
    const { result } = await run("当前选区有哪些标题？", source, { from: source.indexOf("## Inside"), to: source.indexOf("# AFTER") });
    expect(result.text).toContain("Inside");
    expect(result.text).not.toContain("OUTSIDE");
    expect(result.text).not.toContain("AFTER");
  });

  it("keeps an ordinary summary on the summary executor", async () => {
    const { result } = await run("总结全文", "# 发布计划\n\n决定先备份再发布。\n\n验收截止日期为 2026-12-19。");
    expect(result.contentExecutor).toBe("summary");
    expect(result.text).toContain("先备份再发布");
    expect(result.text).not.toContain("可核验原文片段");
  });

  it("keeps budget and status focus within the requested summary task", async () => {
    const { result } = await run("总结全文，重点说明预算和当前状态。", "# 项目\n\n苍鹭由许宁负责，预算 37 万元。\n\n当前状态为准备中。\n\n决定先备份再发布。");
    expect(result.contentExecutor).toBe("summary");
    expect(result.text).toContain("37 万元");
    expect(result.text).toContain("准备中");
    expect(result.text).not.toContain("当前状态：");
  });

  it("projects an explicit field-only request without treating an unrelated amount as project budget", async () => {
    const { result } = await run("只总结项目名、负责人、预算和当前状态，不修改文档。", "# Project notes\n\nIris 由吴青负责，预算为 6 万元。外部哨兵：888 万元。");
    expect(result.contentExecutor).toBe("evidence");
    expect(result.text).toContain("Iris");
    expect(result.text).toContain("吴青");
    expect(result.text).toContain("6 万元");
    expect(result.text).not.toContain("888");
    expect(result.text).toContain("当前状态：已扫描材料未找到明确依据");
  });

  it("reads named source fields even when the question does not repeat the word document", async () => {
    const { result, invoke } = await run("只回答 Cedar 和 Maple 各自的负责人及预算；不能把负责人对应关系互换。", "Cedar 由林安负责，预算 30 万元。\n\nMaple 由周岚负责，预算也是 30 万元。");
    expect(result.contentExecutor).toBe("evidence");
    expect(invoke).not.toHaveBeenCalled();
    expect(result.text).toContain("预算（Cedar）：30 万元");
    expect(result.text).toContain("预算（Maple）：30 万元");
    expect(result.text).toContain("负责人（Cedar）：林安");
    expect(result.text).toContain("负责人（Maple）：周岚");
  });

  it("does not borrow private source for an unrelated named field question", async () => {
    const { result, invoke } = await run("What is Falcon's budget? Answer only; do not edit.", "PRIVATE_SOURCE Iris 的预算为 6 万元。");
    expect(result.contentExecutor).toBe("free");
    expect(invoke).toHaveBeenCalledTimes(1);
    expect(invoke.mock.calls[0]?.[0]).not.toContain("PRIVATE_SOURCE");
  });
});
