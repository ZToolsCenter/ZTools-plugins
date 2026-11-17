import { describe, expect, it, vi } from "vitest";
// Retained full-policy regression; default thin behavior has separate production-entry tests.
import { runFullHarnessTaskCore as runPlannedAiTask } from "../../src/core/ai/fullHarnessTaskRunnerCore";
import { resolveAiEdit, isAiProposalCurrent } from "../../src/core/ai/editProposal";
import type { AiTaskRunnerOptions } from "../../src/core/ai/aiTaskRunner";
import { buildSummaryCandidates } from "../../src/core/ai/summaryFactLedger";

const background = "日常背景用于说明记录方式与沟通路径。".repeat(80);
const source = `# 开篇\n\n开篇决定：苍鹭站点由许宁负责。\n\n${background}\n\n# 中段\n\n中段决定：海盐系统预算为37万元。\n\n${background}\n\n# 末段\n\n末段决定：琥珀版本于2026-12-19发布。`;
const snapshot = { documentId: "draft.md", revision: 3, content: source, selection: null, cursor: null, readOnly: false };
function invokeFor(kind: "answer" | "edit") {
  return vi.fn<AiTaskRunnerOptions["invoke"]>(async (prompt, _system, _max, _emit, schema) => {
    if (prompt.includes("本次用户指令：")) {
      expect(schema).toHaveProperty("anyOf");
      return JSON.stringify(kind === "edit"
        ? { version: 1, kind: "edit", operation: "insert", target: "document_end", layout: "block", content: { mode: "generate", task: "summarize" } }
        : { version: 1, kind: "answer", target: "document", content: { mode: "generate", task: "summarize" } });
    }
    expect(schema).toHaveProperty("properties.ids.items.enum");
    const facts = JSON.parse(prompt.split("\n").find(line => line.startsWith("候选："))!.slice(3)) as Array<{ id: string; quote: string }>;
    return JSON.stringify({ ids: facts.filter(({ quote }) => quote.includes("决定")).map(({ id }) => id) });
  });
}
async function run(kind: "answer" | "edit") {
  const instruction = kind === "answer" ? "总结全文的三项决定，只回答，不修改文档。" : "在全文末尾新增总结，保留三项决定，不修改原文。";
  const invoke = invokeFor(kind);
  const result = await runPlannedAiTask({ source, action: "custom", userPrompt: instruction, baseSystemPrompt: "忠于原文。", actionDefinition: { id: "custom", label: "自定义", prompt: instruction } }, snapshot, { invoke, isCurrent: () => true, abortCurrent: vi.fn() });
  return { invoke, result };
}
describe("long summary source ledger through the production planner and binder", () => {
  it("allows one long source sentence as a program-rendered, fact-bound action item", async () => {
    const source = "恢复演练尚未完成，因此上线前必须确认备份可恢复并核对回滚步骤。";
    const candidate = buildSummaryCandidates(source, { index: 0, text: source, ownedRange: { from: 0, to: source.length } })[0];
    const instruction = "在文末新增一段下一步行动，沿用本文项目事实，提出具体检查事项。不要杜撰数字与日期。";
    const outputs = [JSON.stringify({
      version: 1, kind: "edit", operation: "insert", target: "document_end", layout: "block",
      content: { mode: "generate", task: "continue" }
    }), JSON.stringify({ suggestions: [{ action: "核对", evidenceIds: [candidate.id] }] })];
    const invoke = vi.fn<AiTaskRunnerOptions["invoke"]>(async () => outputs.shift()!);
    const result = await runPlannedAiTask({
      source, action: "custom", userPrompt: instruction, baseSystemPrompt: "忠于原文。",
      actionDefinition: { id: "custom", label: "自定义", prompt: instruction }
    }, { documentId: "draft.md", revision: 3, content: source, selection: null, cursor: null, readOnly: false }, {
      invoke, isCurrent: () => true, abortCurrent: vi.fn()
    });

    expect(invoke).toHaveBeenCalledTimes(2);
    expect(result.planningMode).toBe("model");
    expect(result.proposal?.patch?.from).toBe(source.length);
    const proposedDocument = resolveAiEdit(result.proposal!)?.content ?? "";
    expect(proposedDocument).toContain("- 建议核对：将该事项拆成检查点，逐项核对前置条件、实际结果与完成证据，并记录未满足项。");
    expect(proposedDocument).toContain("依据摘录：确认备份可恢复并核对回滚步骤");
    expect(proposedDocument).not.toContain(`> ${source}`);
    expect(proposedDocument).toContain(result.text);
    expect(result.text).not.toMatch(/已经完成|直接上线/u);
  });

  it("answers with original relations and no debug metadata or edit patch", async () => {
    const { result, invoke } = await run("answer");
    expect(result.answerOnly).toBe(true);
    expect(result.proposal).toBeUndefined();
    expect(invoke.mock.calls.length).toBe(result.summaryStats!.modelCalls + 1);
    expect(result.text).toContain("苍鹭站点由许宁负责");
    expect(result.text).toContain("海盐系统预算为37万元");
    expect(result.text).toContain("琥珀版本于2026-12-19发布");
    expect(result.text).not.toMatch(/source\[|id=|category=|includedBy=|sf:\d+:/);
  });
  it("creates one EOF proposal while preserving the source and revision fence", async () => {
    const { result, invoke } = await run("edit");
    const proposal = result.proposal!;
    expect(proposal.patch?.from).toBe(source.length);
    expect(proposal.patch?.to).toBe(source.length);
    expect(resolveAiEdit(proposal)?.content).toBe(source + proposal.text);
    expect(isAiProposalCurrent(proposal, { ...snapshot, revision: 4 })).toBe(false);
    expect(result.text).not.toMatch(/source\[|id=|category=|includedBy=|sf:\d+:/);
    expect(invoke.mock.calls.length).toBe(result.summaryStats!.modelCalls + 1);
  });
});
