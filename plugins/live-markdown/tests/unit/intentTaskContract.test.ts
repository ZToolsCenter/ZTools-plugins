import { describe, expect, it, vi } from "vitest";
// Retained full-policy regression; default thin behavior has separate production-entry tests.
import { runFullHarnessTaskCore as runPlannedAiTask } from "../../src/core/ai/fullHarnessTaskRunnerCore";
import { buildIntentOutputSchema } from "../../src/core/ai/intentOutputSchema";
import { buildAiIntentCandidates } from "../../src/core/ai/intentContext";
import { deriveInstructionContract } from "../../src/core/ai/instructionConstraints";
import { resolveKnownIntent } from "../../src/core/ai/resolvedIntentContract";
import { validatePlannedIntent } from "../../src/core/ai/intentPlanValidation";
import type { IntentTask } from "../../src/core/ai/intentTypes";

const source = "这是完整原文，必须保留内容。";
describe("explicit generation task contract", () => {
  it("treats a plain summary request as a read-only answer, unless a write location is requested", async () => {
    const instruction = "请总结文档中关于备份与恢复的建议。";
    expect(deriveInstructionContract(instruction).effect).toMatchObject({ state: "explicit", value: "answer" });
    expect(deriveInstructionContract("在文末新增总结").effect).toMatchObject({ state: "explicit", value: "edit" });
    const answerPlan = JSON.stringify({ version: 1, kind: "answer", target: "document", content: { mode: "generate", task: "summarize" } });
    const summaryResponses = [answerPlan, "建议保留备份，并检查恢复版本。"];
    const invoke = vi.fn(async () => summaryResponses.shift() ?? "");
    const summary = await runPlannedAiTask({ source, action: "custom", userPrompt: instruction, baseSystemPrompt: "", actionDefinition: { id: "custom", label: "自定义", prompt: instruction } }, { content: source, documentId: "d.md", revision: 1, selection: null, cursor: null, readOnly: false }, { invoke, isCurrent: () => true, abortCurrent: vi.fn() });
    expect(summary.answerOnly).toBe(true);
    expect(summary.proposal).toBeUndefined();
    expect(invoke).toHaveBeenCalledTimes(2);
    const answerResponses = [answerPlan, "保留备份和恢复版本。"];
    const answer = vi.fn(async () => answerResponses.shift() ?? "");
    const result = await runPlannedAiTask({ source, action: "custom", userPrompt: instruction, baseSystemPrompt: "", actionDefinition: { id: "custom", label: "自定义", prompt: instruction } }, { content: source, documentId: "d.md", revision: 1, selection: null, cursor: null, readOnly: true }, { invoke: answer, isCurrent: () => true, abortCurrent: vi.fn() });
    expect(result.answerOnly).toBe(true);
    expect(result.proposal).toBeUndefined();
    expect(answer).toHaveBeenCalledTimes(2);
  });
  it.each([
    ["在文末生成技术方案", "tech-spec"],
    ["在文末生成 Mermaid 流程图", "diagram"]
  ])("grounds explicit task vocabulary: %s", (instruction, task) => {
    expect(deriveInstructionContract(instruction).generationTasks).toMatchObject({ state: "explicit", value: [task] });
  });
  it("rejects independent generation tasks instead of silently choosing one", async () => {
    const instruction = "在文末生成技术方案，并创建流程图。";
    const snapshot = { content: source, documentId: "d.md", revision: 1, selection: null, cursor: null, readOnly: false } as const;
    const contract = deriveInstructionContract(instruction);
    expect(contract.generationTasks).toMatchObject({ state: "conflict" });
    expect(contract.issues).toEqual(expect.arrayContaining([expect.objectContaining({ code: "compound" })]));
    const candidates = buildAiIntentCandidates(instruction, source, contract);
    expect(resolveKnownIntent(instruction, snapshot, candidates, contract)).toBeNull();
    const schema = JSON.stringify(buildIntentOutputSchema(instruction, false, candidates, contract));
    expect(schema).toContain('"clarify"');
    expect(schema).not.toContain('"tech-spec"');
    expect(schema).not.toContain('"diagram"');
    const invoke = vi.fn(async () => JSON.stringify({ version: 1, kind: "clarify", reason: "compound" }));
    await expect(runPlannedAiTask({
      source, action: "custom", userPrompt: instruction, baseSystemPrompt: "",
      actionDefinition: { id: "custom", label: "自定义", prompt: instruction }
    }, snapshot, { invoke, isCurrent: () => true, abortCurrent: vi.fn() })).rejects.toThrow(/多个操作/u);
    expect(invoke).toHaveBeenCalledTimes(1);
  });
  it.each(["custom", "summarize", "continue", "diagram"])("does not let %s turn explicit polish into an unprotected task", async task => {
    const instruction = "润色全文";
    const snapshot = { content: source, documentId: "d.md", revision: 1, selection: null, cursor: null, readOnly: false } as const;
    const contract = deriveInstructionContract(instruction);
    const candidates = buildAiIntentCandidates(instruction, source, contract);
    const invalid = { version: 1, kind: "edit", operation: "rewrite", target: "document", content: { mode: "generate", task: task as IntentTask } } as const;
    expect(() => validatePlannedIntent(invalid, contract, snapshot, candidates, instruction)).toThrow(expect.objectContaining({ code: "task_mismatch" }));
    expect(resolveKnownIntent(instruction, snapshot, candidates, contract)).toMatchObject({ intent: { kind: "edit", operation: "rewrite", target: "document", content: { mode: "generate", task: "polish" } } });
  });
  it("constrains the wire schema using positive verb evidence rather than quoted payloads", () => {
    const instruction = "润色全文";
    const schema = JSON.stringify(buildIntentOutputSchema(instruction, false, buildAiIntentCandidates(instruction, source)));
    expect(schema).toContain('"polish"');
    expect(schema).not.toContain('"summarize"');
    const append = '在文末添加“总结”';
    expect(JSON.stringify(buildIntentOutputSchema(append, false, buildAiIntentCandidates(append, source)))).not.toContain('"generate"');
  });
});

it("does not confuse unquoted format parameters with literal insertion content", async () => {
  const { deriveInstructionContract } = await import("../../src/core/ai/instructionConstraints");
  const contract = deriveInstructionContract("在文末新增 Python 函数");
  expect(contract.literals.filter(value => value.role === "write")).toEqual([]);
  for (const text of ["在文末续写一个下一步行动段落", "在文末续写一段说明。"] ) {
    const derived = deriveInstructionContract(text);
    expect(derived.operation).toMatchObject({ state: "explicit", value: "insert" });
    expect(derived.issues).toEqual([]);
  }
});
