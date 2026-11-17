import { expect, it, vi } from "vitest";
import { buildAiTaskRequest } from "../../src/core/ai/aiTaskRequest";
import { runPlannedAiTaskCore } from "../../src/core/ai/plannedTaskRunnerCore";
import type { AiTaskRunnerOptions } from "../../src/core/ai/aiTaskRunner";

const source = "# Current prices\n\nCedar costs 10 yuan. Maple costs 20 yuan.";
const instruction = "根据原文生成两列表格，列名 Product、Price；仅列 Cedar 10 yuan 和 Maple 20 yuan，价格必须分别对应原文。";
const options = (invoke: AiTaskRunnerOptions["invoke"]): AiTaskRunnerOptions => ({ invoke, isCurrent: () => true, abortCurrent() {} });

it.each([false, true])("binds an explicit source-derived table to its authorized range (selection: %s)", async selected => {
  const content = selected ? `PRIVATE_BEFORE\n\n${source}\n\nPRIVATE_AFTER` : source;
  const from = selected ? content.indexOf(source) : 0;
  const selection = selected ? { from, to: from + source.length } : null;
  const invoke = vi.fn(async (prompt: string, _system: string, _tokens: number, _emit: unknown, schema?: Record<string, unknown>) => {
    expect(prompt).toContain("Cedar costs 10 yuan");
    expect(prompt).not.toMatch(/PRIVATE_BEFORE|PRIVATE_AFTER/u);
    expect(schema).toHaveProperty("properties.payload");
    return JSON.stringify({ payload: { rows: [
      { sourceId: "row-0", cells: ["Cedar", "10 yuan"] },
      { sourceId: "row-1", cells: ["Maple", "20 yuan"] }
    ] } });
  });
  const request = buildAiTaskRequest({ source, selected, action: "custom", userPrompt: instruction,
    config: { provider: "local", activeRoleId: "general" } });
  const result = await runPlannedAiTaskCore(request, { documentId: "prices.md", revision: 1, content, selection, cursor: null, readOnly: false }, options(invoke));
  expect(result.contentExecutor).toBe("artifact");
  expect(invoke).toHaveBeenCalledTimes(1);
  expect(result.proposal?.patch).toMatchObject({ from, to: from + source.length, expectedText: source });
  expect(result.candidateText).toBe("| Product | Price |\n| --- | --- |\n| Cedar | 10 yuan |\n| Maple | 20 yuan |");
  expect(content).toBe(selected ? `PRIVATE_BEFORE\n\n${source}\n\nPRIVATE_AFTER` : source);
});

it("honors an explicit no-edit request over the source-derived table default", async () => {
  const invoke = vi.fn(async () => JSON.stringify({ payload: { rows: [
    { sourceId: "row-0", cells: ["Cedar", "10 yuan"] },
    { sourceId: "row-1", cells: ["Maple", "20 yuan"] }
  ] } }));
  const request = buildAiTaskRequest({ source, selected: false, action: "custom", userPrompt: `${instruction}只回答，不修改文档。`,
    config: { provider: "local", activeRoleId: "general" } });
  const result = await runPlannedAiTaskCore(request, { documentId: "prices.md", revision: 1, content: source, selection: null, cursor: null, readOnly: false }, options(invoke));
  expect(result.answerOnly).toBe(true);
  expect(result.proposal).toBeUndefined();
  expect(invoke).toHaveBeenCalledTimes(1);
});

it("fills an explicitly formatted JSON answer with source and without a write proposal", async () => {
  const content = "Cedar 的预算为 30 万元。";
  const invoke = vi.fn(async (prompt: string, _system: string, _tokens: number, _emit: unknown, schema?: Record<string, unknown>) => {
    expect(prompt).toContain(content);
    expect(schema).toHaveProperty("properties.payload");
    return JSON.stringify({ payload: '{"project":"Cedar","budget":"30 万元"}' });
  });
  const request = buildAiTaskRequest({ source: content, selected: false, action: "custom", userPrompt: "请以 JSON 格式回答：Cedar 的预算是多少？只回答，不修改文档。",
    config: { provider: "local", activeRoleId: "general" } });
  const result = await runPlannedAiTaskCore(request, { documentId: "answer.md", revision: 1, content, selection: null, cursor: null, readOnly: true }, options(invoke));
  expect(result.contentExecutor).toBe("artifact");
  expect(result.answerOnly).toBe(true);
  expect(result.proposal).toBeUndefined();
  expect(result.text).toContain('"budget": "30 万元"');
  expect(invoke).toHaveBeenCalledTimes(1);
});
