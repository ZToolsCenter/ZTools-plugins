import { describe, expect, it, vi } from "vitest";
import { detectEditingMetaQuestion } from "../../src/core/ai/instructionSpeechAct";
import { deriveInstructionContract } from "../../src/core/ai/instructionConstraints";
import { buildAiIntentCandidates } from "../../src/core/ai/intentContext";
import { buildIntentOutputSchema } from "../../src/core/ai/intentOutputSchema";
import { parseIntentOutput } from "../../src/core/ai/intentSchema";
import { bindAiIntent } from "../../src/core/ai/intentBinder";
import { resolveKnownIntent } from "../../src/core/ai/resolvedIntentContract";
// Retained full-policy regression; default thin behavior has separate production-entry tests.
import { runFullHarnessTaskCore as runPlannedAiTaskCore } from "../../src/core/ai/fullHarnessTaskRunnerCore";

describe("editing meta questions", () => {
  it("scans a long comma-separated question with linear clause traversal", () => {
    const instruction = ["How do I polish this?", ...Array.from({ length: 1000 }, (_, index) => `note${index}`)].join(", ");
    const evidence = detectEditingMetaQuestion(instruction);
    expect(evidence).toBeDefined();
    expect(instruction.slice(evidence!.from, evidence!.to)).toBe(instruction);
  });

  it.each([
    "润色的标准是什么？",
    "如何润色这段话？",
    "校对有哪些方法？",
    "为什么要润色全文？",
    "What does proofreading mean?",
    "How do I polish this?",
    "续写有什么技巧？",
    "帮我解释一下怎么续写。",
    "续写的定义是什么？",
    "总结全文的方法是什么？",
    "润色方法？",
    "Proofreading tips?",
    "如何润色选区？",
    "告诉我如何在文末增加 hello。"
  ])("recognizes a whole-utterance question about editing: %s", instruction => {
    const evidence = detectEditingMetaQuestion(instruction);
    expect(evidence).toBeDefined();
    expect(instruction.slice(evidence!.from, evidence!.to)).toBe(evidence!.raw);
  });

  it.each([
    "请帮我润色全文。",
    "能帮我润色全文吗？",
    "底部新增代码块 markdown 标题一 hello",
    "在文末新增一段解释如何润色的文字。",
    "在文末新增代码块，里面显示‘如何润色’。",
    "不要只告诉我如何在文末增加 hello，请在文末新增‘hello’。",
    "为什么要润色全文？然后在文末新增 hello。",
    "告诉我如何在文末增加 hello，然后删除末尾一段。",
    "告诉我如何润色全文，并帮我新增一段。",
    "Tell me how to polish the document, but please add an introduction.",
    "如何润色全文？然后在文末新增hello。",
    "请问，如何润色全文？",
    "解释‘如何润色’这句话。",
    "在文末新增一段文字，内容为润色的方法。"
  ])("does not mistake an edit request or quoted payload for a meta question: %s", instruction => {
    expect(detectEditingMetaQuestion(instruction)).toBeUndefined();
  });

  it.each([
    "告诉我如何润色全文，并帮我新增一段。",
    "Tell me how to polish the document, but please add an introduction.",
    "如何润色全文？然后在文末新增hello。"
  ])("does not force an answer for a question followed by another edit: %s", instruction => {
    expect(detectEditingMetaQuestion(instruction)).toBeUndefined();
    const contract = deriveInstructionContract(instruction, { hasSelection: false, hasCursor: true });
    expect(contract.effect).not.toMatchObject({ state: "explicit", value: "answer" });
  });

  it.each([
    "Tell me how to polish the document, and create an intro paragraph now",
    "Tell me how to polish the document, but please add an introduction",
    "告诉我如何润色全文，并帮我新增一段"
  ])("keeps a question plus a requested edit together and asks the planner to clarify: %s", async instruction => {
    const source = "# Existing\n\nOriginal paragraph.";
    const contract = deriveInstructionContract(instruction, { hasSelection: false, hasCursor: false });
    expect(detectEditingMetaQuestion(instruction)).toBeUndefined();
    expect(contract.effect.state).toBe("ambiguous");
    expect(contract.operation.state).toBe("ambiguous");
    expect(contract.issues).toMatchObject([{ code: "compound" }]);
    const evidence = contract.issues[0].evidence.map(({ from, to }) => instruction.slice(from, to));
    expect(evidence.length).toBeGreaterThanOrEqual(2);
    expect(evidence.some((item) => /polish|润色/iu.test(item))).toBe(true);
    expect(evidence.some((item) => /create|add|新增/iu.test(item))).toBe(true);

    const candidates = buildAiIntentCandidates(instruction, source, contract);
    const schema = buildIntentOutputSchema(instruction, false, candidates, contract) as {
      anyOf: Array<{ properties: { kind: { const?: string; enum?: string[] } } }>;
    };
    const kinds = schema.anyOf.flatMap(({ properties }) => properties.kind.enum ?? [properties.kind.const ?? ""]);
    expect(kinds).toContain("clarify");
    expect(kinds).not.toContain("answer");
    expect(kinds).not.toContain("edit");

    const invoke = vi.fn(async (_prompt: string, _system: string, _tokens: number, _onChunk: (chunk: string) => void, outputSchema?: Record<string, unknown>) => {
      expect(outputSchema).toBeDefined();
      return JSON.stringify({ version: 1, kind: "clarify", reason: "compound" });
    });
    const snapshot = { documentId: "mixed.md", revision: 1, content: source, selection: null, cursor: null, readOnly: false };
    const request = {
      source, action: "custom" as const, userPrompt: instruction, baseSystemPrompt: "Answer the user.",
      actionDefinition: { id: "custom" as const, label: "Custom", prompt: instruction }
    };
    await expect(runPlannedAiTaskCore(request, snapshot, {
      invoke, isCurrent: () => true, abortCurrent: vi.fn()
    })).rejects.toThrow(/多个操作/u);
    expect(invoke).toHaveBeenCalledTimes(1);
  });

  it.each([
    "在文末新增一段文字，说明润色的标准",
    "在文末新增一段文字，写出润色方法",
    "在文末新增代码块，里面说明总结的方法",
    "在文末新增一段文字，说明润色的标准是什么？",
    "在文末新增一段文字，写出润色方法有哪些？"
  ])("does not classify an inner content brief as a user question: %s", instruction => {
    expect(detectEditingMetaQuestion(instruction)).toBeUndefined();
    const contract = deriveInstructionContract(instruction, { hasSelection: false, hasCursor: true });
    expect(contract.effect).not.toMatchObject({ state: "explicit", value: "answer" });
    expect(contract.operation.state).toMatch(/^(?:conflict|ambiguous)$/u);
    expect(contract.issues.length).toBeGreaterThan(0);
    const source = "原始文稿内容。";
    const candidates = buildAiIntentCandidates(instruction, source, contract);
    const schema = buildIntentOutputSchema(instruction, false, candidates, contract) as { anyOf: Array<{ properties: { kind: { const?: string; enum?: string[] } } }> };
    const kinds = schema.anyOf.flatMap(({ properties }) => properties.kind.enum ?? [properties.kind.const ?? ""]);
    expect(kinds).toContain("clarify");
    expect(kinds).not.toContain("answer");
  });

  it.each([
    ["润色的标准是什么？", "answer", "unknown"],
    ["如何润色这段话？", "answer", "unknown"],
    ["校对有哪些方法？", "answer", "unknown"],
    ["为什么要润色全文？", "answer", "document"],
    ["What does proofreading mean?", "answer", "unknown"],
    ["How do I polish this?", "answer", "unknown"],
    ["续写有什么技巧？", "answer", "unknown"],
    ["帮我解释一下怎么续写。", "answer", "unknown"],
    ["续写的定义是什么？", "answer", "unknown"],
    ["总结全文的方法是什么？", "answer", "document"],
    ["如何润色选区？", "answer", "unknown"],
    ["告诉我如何在文末增加 hello。", "answer", "document"]
  ])("clears edit locks and selection preconditions so the model plans an answer: %s", (instruction, effect, expectedScope) => {
    const contract = deriveInstructionContract(instruction, { hasSelection: false, hasCursor: false });
    expect(contract.effect).toMatchObject(effect === "answer"
      ? { state: "explicit", value: "answer" }
      : { state: "unknown" });
    expect(contract.operation).toEqual({ state: "unknown" });
    expect(contract.target).toEqual({ state: "unknown" });
    expect(contract.scope.state === "explicit" ? contract.scope.value : contract.scope.state).toBe(expectedScope);
    if (effect === "answer") expect(contract.generationTasks).toMatchObject({ state: "explicit", value: ["custom"] });
    else expect(contract.generationTasks).toBeUndefined();
    expect(contract.preconditions).toEqual({ selectionRequired: false, cursorRequired: false });
    expect(contract.literals.every(({ role }) => role === "unknown")).toBe(true);
    expect(contract.issues).toEqual([]);
  });

  it.each([
    ["如何润色全文？", true, "document", "document"],
    ["如何润色全文？", false, "document", "document"],
    ["如何润色选区？", true, "selection", "selection"],
    ["如何润色选区？", false, "unknown", "document"]
  ] as const)("keeps only a grounded answer scope for %s (selected=%s)", (instruction, selected, scope, answerTarget) => {
    const source = "Document first paragraph.\n\nDocument second paragraph.";
    const selection = selected
      ? { from: source.indexOf("Document second"), to: source.length }
      : null;
    const snapshot = {
      documentId: "scope.md", revision: 1, content: source, selection, cursor: null, readOnly: false
    };
    const contract = deriveInstructionContract(instruction, { hasSelection: selected, hasCursor: false });
    expect(contract.scope.state === "explicit" ? contract.scope.value : contract.scope.state).toBe(scope);
    expect(contract.target).toEqual({ state: "unknown" });
    expect(contract.preconditions.selectionRequired).toBe(false);

    const candidates = buildAiIntentCandidates(instruction, source, contract);
    expect(resolveKnownIntent(instruction, snapshot, candidates, contract)).toBeNull();
    const schema = buildIntentOutputSchema(instruction, selected, candidates, contract) as {
      anyOf: Array<{ properties: { kind: { const?: string }; target?: { const?: string; enum?: string[] } } }>;
    };
    const answerBranch = schema.anyOf.find(({ properties }) => properties.kind.const === "answer");
    const targets = answerBranch?.properties.target?.enum ?? [answerBranch?.properties.target?.const ?? ""];
    expect(targets).toContain(answerTarget);

    const plan = JSON.stringify({
      version: 1, kind: "answer", target: answerTarget,
      content: { mode: "generate", task: "custom" }
    });
    const intent = parseIntentOutput(plan, instruction, candidates, contract);
    const bound = bindAiIntent(intent, snapshot, instruction, candidates, contract);
    expect(bound.intent).toMatchObject({ kind: "answer", target: answerTarget });
    expect(bound.dependency).toBe(answerTarget);
    expect(bound.range.expectedText).toBe(answerTarget === "selection" ? source.slice(selection!.from, selection!.to) : source);
  });

  it("keeps ordinary generation and nested explanation requests on their current contracts", () => {
    for (const instruction of [
      "请帮我润色全文。",
      "底部新增代码块 markdown 标题一 hello",
      "在文末新增一段解释如何润色的文字。",
      "在文末新增代码块，里面显示‘如何润色’。"
    ]) {
      const contract = deriveInstructionContract(instruction, { hasSelection: false, hasCursor: true });
      expect(contract.effect).not.toMatchObject({ state: "explicit", value: "answer" });
    }
  });

  it.each([
    "润色的标准是什么？",
    "如何润色这段话？",
    "What does proofreading mean?",
    "告诉我如何在文末增加 hello。"
  ])("does not resolve a meta question as a program-owned edit or answer: %s", instruction => {
    const source = "原始文稿内容。";
    const snapshot = { documentId: "meta.md", revision: 1, content: source, selection: null, cursor: null, readOnly: false };
    const contract = deriveInstructionContract(instruction, { hasSelection: false, hasCursor: false });
    const candidates = buildAiIntentCandidates(instruction, source, contract);
    expect(resolveKnownIntent(instruction, snapshot, candidates, contract)).toBeNull();
  });
});
