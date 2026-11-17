import { describe, expect, it, vi } from "vitest";
import { proseResponse } from "../helpers/proseResponses";
// Retained full-policy regression; default thin behavior has separate production-entry tests.
import { runFullHarnessTaskCore as runPlannedAiTask } from "../../src/core/ai/fullHarnessTaskRunnerCore";
import { resolveAiEdit } from "../../src/core/ai/editProposal";
import { bindAiIntent } from "../../src/core/ai/intentBinder";
import { getIntentHeadings } from "../../src/core/ai/intentTargets";
import { buildAiIntentCandidates } from "../../src/core/ai/intentContext";
import { deriveInstructionContract } from "../../src/core/ai/instructionConstraints";
import { validatePlannedIntent } from "../../src/core/ai/intentPlanValidation";
import { resolveKnownIntent } from "../../src/core/ai/resolvedIntentContract";
import type { AiDocumentSnapshot } from "../../src/types/aiEditing";
import type { ValidatedIntent } from "../../src/core/ai/intentTypes";

const source = "---\ntitle: stable\n---\n# 部署步骤\n\nalpha hello。\n\n# 实施计划\n\nbeta hello。\n\n# 下一节\n\nhello";
const snapshot = (extra: Partial<AiDocumentSnapshot> = {}): AiDocumentSnapshot => ({ documentId: "unsaved.md", revision: 4, content: source, selection: null, cursor: source.indexOf("alpha"), readOnly: false, ...extra });
const insert = (target: "document_end" | "body_start" | "cursor" | "selection_end", text = "hello"): ValidatedIntent => ({ version: 1, kind: "edit", operation: "insert", target, layout: target === "cursor" ? "inline" : "block", content: { mode: "literal", text } });
const insertGenerated = (target: "document_end" | "cursor" | "selection_end", task: "custom" | "continue" = "custom", layout: "inline" | "block" = target === "cursor" ? "inline" : "block"): ValidatedIntent => ({ version: 1, kind: "edit", operation: "insert", target, layout, content: { mode: "generate", task } });
function stagedInvoke(generated: string, task: "custom" | "continue" = "custom", target: "document_end" | "cursor" | "selection_end" = "document_end", prompts: string[] = [], layout: "inline" | "block" = target === "cursor" ? "inline" : "block") {
  return vi.fn(async (prompt: string, _system: string, _tokens: number, _onChunk: (chunk: string) => void, schema?: Record<string, unknown>) => {
    prompts.push(prompt);
    if (prompt.includes("本次用户指令：")) {
      expect(schema).toBeDefined();
      return JSON.stringify(insertGenerated(target, task, layout));
    }
    return generated;
  });
}
async function execute(instruction: string, plan: ValidatedIntent, snap = snapshot()) {
  const invoke = vi.fn(async () => JSON.stringify(plan));
  const result = await runPlannedAiTask({ source: snap.content, action: "custom", userPrompt: instruction, baseSystemPrompt: "只输出结果。", actionDefinition: { id: "custom", label: "自定义", prompt: instruction } }, snap, { invoke, isCurrent: () => true, abortCurrent: vi.fn() });
  return { result, invoke };
}

describe("production planned-task contract integration", () => {
  it.each([
    ["不要修改文档，只告诉我如何在文末增加 hello。", "custom"],
    ["只告诉我如何续写后续行动建议，保留原文。", "custom"],
    ["仅告诉我怎么在文末增加 hello。", "custom"],
    ["只告诉我方法，在文末增加 hello。", "custom"]
  ] as const)("keeps an explicitly answer-only request out of the edit schema: %s", async (instruction, task) => {
    const snap = snapshot({ cursor: null, selection: null });
    expect(deriveInstructionContract(instruction, { hasSelection: false }).effect).toMatchObject({ state: "explicit", value: "answer" });
    const plannerSchemas: Array<Record<string, unknown>> = [];
    const invoke = vi.fn(async (prompt: string, _system: string, _tokens: number, _onChunk: (chunk: string) => void, schema?: Record<string, unknown>) => {
      if (!prompt.includes("本次用户指令：")) return "可以把需要的内容接在文档末尾。";
      if (!schema) return JSON.stringify({ version: 1, kind: "clarify", reason: "missing_operation" });
      plannerSchemas.push(schema);
      const branches = (schema.anyOf ?? []) as Array<{ properties: { kind: { const?: string; enum?: string[] }; operation?: { const?: string }; target?: { const?: string }; layout?: { enum?: string[] }; content?: unknown } }>;
      const allowedKinds = branches.flatMap(({ properties }) => properties.kind.const ? [properties.kind.const] : properties.kind.enum ?? []);
      if (allowedKinds.includes("answer")) {
        return JSON.stringify({ version: 1, kind: "answer", target: "document", content: { mode: "generate", task } });
      }
      return JSON.stringify({ version: 1, kind: "clarify", reason: "missing_operation" });
    });
    let result: Awaited<ReturnType<typeof runPlannedAiTask>> | undefined;
    let clarification: unknown;
    try {
      result = await runPlannedAiTask({
        source: snap.content, action: "custom", userPrompt: instruction, baseSystemPrompt: "只输出结果。",
        actionDefinition: { id: "custom", label: "自定义", prompt: instruction }
      }, snap, { invoke, isCurrent: () => true, abortCurrent: vi.fn() });
    } catch (error) {
      clarification = error;
    }

    for (const schema of plannerSchemas) {
      const kinds = (schema.anyOf as Array<{ properties: { kind: { const?: string; enum?: string[] } } }>).flatMap(({ properties }) => properties.kind.const ? [properties.kind.const] : properties.kind.enum ?? []);
      expect(kinds.some((kind) => kind === "answer" || kind === "clarify")).toBe(true);
      expect(kinds).not.toContain("edit");
    }
    if (result) {
      expect(result).toMatchObject({ answerOnly: true, resolvedIntent: { kind: "answer" } });
      expect(result.proposal).toBeUndefined();
    } else {
      expect(clarification).toBeInstanceOf(Error);
      expect(String(clarification)).not.toContain("修改方案");
    }
  });

  it.each([
    "不要只告诉我如何在文末增加 hello，请在文末新增“hello”。"
  ])("does not widen answer-only recognition to ordinary or negated 'only tell me' wording: %s", instruction => {
    expect(deriveInstructionContract(instruction, { hasSelection: false }).effect).not.toMatchObject({ state: "explicit", value: "answer" });
  });

  it("routes a direct how-to question through a custom answer plan", async () => {
    const instruction = "告诉我如何在文末增加 hello。";
    const snap = snapshot({ cursor: null, selection: null });
    const invoke = vi.fn(async (prompt: string, _system: string, _tokens: number, _onChunk: (chunk: string) => void, schema?: Record<string, unknown>) => {
      if (prompt.includes("本次用户指令：")) {
        expect(schema).toBeDefined();
        return JSON.stringify({ version: 1, kind: "answer", target: "document", content: { mode: "generate", task: "custom" } });
      }
      return "这句话是在询问如何添加文稿内容。";
    });
    const result = await runPlannedAiTask({
      source: snap.content, action: "custom", userPrompt: instruction, baseSystemPrompt: "只输出结果。",
      actionDefinition: { id: "custom", label: "自定义", prompt: instruction }
    }, snap, { invoke, isCurrent: () => true, abortCurrent: vi.fn() });

    expect(deriveInstructionContract(instruction, { hasSelection: false }).effect).toMatchObject({ state: "explicit", value: "answer" });
    expect(result).toMatchObject({ planningMode: "model", answerOnly: true, resolvedIntent: { kind: "answer" } });
    expect(result.proposal).toBeUndefined();
    expect(invoke).toHaveBeenCalledTimes(2);
  });

  it.each([
    "在文末新增一个 Python 代码块，实现 multiply(a, b) 函数并返回 a * b。保留原有内容，只输出新增代码块。",
    "请在文章结尾添加 Python 代码围栏，定义 multiply(a, b) 并返回它们的乘积；保留原文，仅输出新代码。",
    "在文末追加 Python 代码块，定义 multiply(a, b) 并返回 a*b，只输出该代码块。",
    "在文末生成一个 Python 代码块，实现 multiply(a, b) 函数并返回 a * b。"
  ])("plans natural-language generated code before creating the artifact: %s", async instruction => {
    const generated = "```python\ndef multiply(a, b):\n    return a * b\n```";
    const snap = snapshot({ cursor: null, selection: null });
    const invoke = stagedInvoke(generated);
    const result = await runPlannedAiTask({
      source: snap.content, action: "custom", userPrompt: instruction, baseSystemPrompt: "只输出结果。",
      actionDefinition: { id: "custom", label: "自定义", prompt: instruction }
    }, snap, { invoke, isCurrent: () => true, abortCurrent: vi.fn() });

    expect(invoke).toHaveBeenCalledTimes(2);
    expect(result).toMatchObject({ planningMode: "model", resolvedIntent: {
      kind: "edit", operation: "insert", target: "document_end", layout: "block",
      content: { mode: "generate", task: "custom" }
    } });
    expect(result.proposal?.mode).toBe("append");
    expect(resolveAiEdit(result.proposal!)?.content).toBe(`${snap.content}\n\n${generated}`);
  });

  it("keeps code artifact and function requirements in the content-generation prompt", async () => {
    const instruction = "在文末新增一个 Python 代码块，实现 multiply(a, b) 函数并返回 a * b。保留原有内容，只输出新增代码块。";
    const generated = "```python\ndef multiply(a, b):\n    return a * b\n```";
    const snap = snapshot({ cursor: null, selection: null });
    const contentPrompts: string[] = [];
    const invoke = stagedInvoke(generated, "custom", "document_end", contentPrompts);
    const result = await runPlannedAiTask({
      source: snap.content, action: "custom", userPrompt: instruction, baseSystemPrompt: "只输出结果。",
      actionDefinition: { id: "custom", label: "自定义", prompt: instruction }
    }, snap, { invoke, isCurrent: () => true, abortCurrent: vi.fn() });

    expect(invoke).toHaveBeenCalledTimes(2);
    expect(contentPrompts).toHaveLength(2);
    expect(contentPrompts[0]).toContain("本次用户指令：");
    expect(contentPrompts[1]).toContain("Python 代码块");
    expect(contentPrompts[1]).toContain("实现 multiply(a, b) 函数");
    expect(contentPrompts[1]).toContain("返回 a * b");
    expect(contentPrompts[1]).toContain("只输出新增代码块");
    expect(contentPrompts[1]).toContain(instruction);
    expect(contentPrompts[1]).not.toContain("在一个 Python");
    expect(result).toMatchObject({ planningMode: "model", resolvedIntent: { kind: "edit", operation: "insert", target: "document_end", layout: "block" } });
  });

  it("preserves a quoted title adjacent to an unquoted placement cue in the content prompt", async () => {
    const instruction = "在“紧急事项”文末新增一个 Python 代码块，实现 multiply(a, b) 函数并返回 a * b。";
    const snap = snapshot({ cursor: null, selection: null });
    const contentPrompts: string[] = [];
    const invoke = stagedInvoke("```python\ndef multiply(a, b):\n    return a * b\n```", "custom", "document_end", contentPrompts);
    await runPlannedAiTask({
      source: snap.content, action: "custom", userPrompt: instruction, baseSystemPrompt: "只输出结果。",
      actionDefinition: { id: "custom", label: "自定义", prompt: instruction }
    }, snap, { invoke, isCurrent: () => true, abortCurrent: vi.fn() });

    expect(invoke).toHaveBeenCalledTimes(2);
    expect(contentPrompts).toHaveLength(2);
    expect(contentPrompts[1]).toContain("“紧急事项”");
    expect(contentPrompts[1]).toContain(instruction);
  });

  it("appends explanatory prose about code without forcing a code-fence response", async () => {
    const instruction = "在文末新增一段解释 Python 代码用途的文字，保留原文。";
    const explanation = "Python 代码可以把输入值转换为所需结果，便于复用计算逻辑。";
    const snap = snapshot({ cursor: null, selection: null });
    const invoke = stagedInvoke(explanation);
    const result = await runPlannedAiTask({
      source: snap.content, action: "custom", userPrompt: instruction, baseSystemPrompt: "只输出结果。",
      actionDefinition: { id: "custom", label: "自定义", prompt: instruction }
    }, snap, { invoke, isCurrent: () => true, abortCurrent: vi.fn() });

    expect(invoke).toHaveBeenCalledTimes(2);
    expect(result).toMatchObject({ planningMode: "model", resolvedIntent: {
      kind: "edit", operation: "insert", target: "document_end", layout: "block",
      content: { mode: "generate", task: "custom" }
    } });
    expect(result.proposal?.mode).toBe("append");
    expect(resolveAiEdit(result.proposal!)?.content).toBe(`${snap.content}\n\n${explanation}`);
  });

  it("continues at the document end by default without ever planning a whole-document rewrite", async () => {
    const instruction = "续写一段简短的后续行动建议";
    const snap = snapshot({ cursor: null, selection: null });
    const generated = "## 后续行动\n\n- 核对现有计划中的待确认事项。";
    const invoke = stagedInvoke(generated, "continue");
    const result = await runPlannedAiTask({
      source: snap.content, action: "custom", userPrompt: instruction, baseSystemPrompt: "只输出结果。",
      actionDefinition: { id: "custom", label: "自定义", prompt: instruction }
    }, snap, { invoke, isCurrent: () => true, abortCurrent: vi.fn() });

    expect(invoke).toHaveBeenCalledTimes(2);
    expect(result).toMatchObject({ planningMode: "model", resolvedIntent: {
      kind: "edit", operation: "insert", target: "document_end", layout: "block",
      content: { mode: "generate", task: "continue" }
    } });
    expect(result.proposal?.mode).toBe("append");
    expect(result.proposal?.patch).toMatchObject({ from: snap.content.length, to: snap.content.length, expectedText: "" });
    expect(resolveAiEdit(result.proposal!)?.content.startsWith(snap.content)).toBe(true);
  });

  it("continues at the end of a valid selection when there is no explicit position", async () => {
    const content = "前文不改。\n\n选区背景。\n\n后文不改。";
    const selected = "选区背景。";
    const from = content.indexOf(selected);
    const selection = { from, to: from + selected.length };
    const snap = snapshot({ content, selection, cursor: null });
    const instruction = "续写后续行动建议";
    const generated = "后续行动建议。";
    const invoke = stagedInvoke(generated, "continue", "selection_end");
    const result = await runPlannedAiTask({
      source: content, action: "custom", userPrompt: instruction, baseSystemPrompt: "只输出结果。",
      actionDefinition: { id: "custom", label: "自定义", prompt: instruction }
    }, snap, { invoke, isCurrent: () => true, abortCurrent: vi.fn() });

    expect(invoke).toHaveBeenCalledTimes(2);
    expect(result).toMatchObject({ planningMode: "model", resolvedIntent: {
      kind: "edit", operation: "insert", target: "selection_end", layout: "block",
      content: { mode: "generate", task: "continue" }
    } });
    expect(result.proposal?.patch).toMatchObject({ from: selection.to, to: selection.to, expectedText: "" });
    expect(resolveAiEdit(result.proposal!)?.content).toContain(`${selected}\n\n${generated}`);
  });

  it.each([
    "续写后续行动建议，但不要新增内容",
    "Continue with a follow-up recommendation, but do not add content."
  ])("does not append or rewrite when continuation conflicts with a ban on all new content: %s", async instruction => {
    const snap = snapshot({ cursor: null, selection: null });
    const invoke = vi.fn(async () => JSON.stringify({ version: 1, kind: "clarify", reason: "conflicting_constraints" }));

    await expect(runPlannedAiTask({
      source: snap.content, action: "custom", userPrompt: instruction, baseSystemPrompt: "只输出结果。",
      actionDefinition: { id: "custom", label: "自定义", prompt: instruction }
    }, snap, { invoke, isCurrent: () => true, abortCurrent: vi.fn() }))
      .rejects.toThrow(/指令中的要求互相冲突/u);
    expect(invoke).toHaveBeenCalledTimes(1);
  });

  it.each([
    ["在光标处行内续写一个简短的后续行动建议", "inline"],
    ["在光标处另起一段续写一个简短的后续行动建议", "block"],
    ["在光标处续写后续行动建议", "block"]
  ] as const)("respects continuation layout evidence and defaults to a block: %s", async (instruction, layout) => {
    const offset = source.indexOf("alpha");
    const snap = snapshot({ cursor: offset, selection: null });
    const generated = "后续行动建议。";
    const invoke = stagedInvoke(generated, "continue", "cursor", [], layout);
    const result = await runPlannedAiTask({
      source: snap.content, action: "custom", userPrompt: instruction, baseSystemPrompt: "只输出结果。",
      actionDefinition: { id: "custom", label: "自定义", prompt: instruction }
    }, snap, { invoke, isCurrent: () => true, abortCurrent: vi.fn() });

    expect(invoke).toHaveBeenCalledTimes(2);
    expect(result).toMatchObject({ planningMode: "model", resolvedIntent: {
      kind: "edit", operation: "insert", target: "cursor", layout,
      content: { mode: "generate", task: "continue" }
    } });
    expect(result.proposal?.patch).toMatchObject({ from: offset, to: offset, expectedText: "" });
  });

  it.each([
    ['在正文开头新增“hello”', "body_start", source.indexOf("# 部署步骤"), 1, "model"],
    ['在光标处原样插入“hello”', "cursor", source.indexOf("alpha"), 0, "program"]
  ] as const)("keeps the exact source position and uses the full-mode layout policy: %s", async (instruction, target, offset, calls, planningMode) => {
    const { result, invoke } = await execute(instruction, insert(target));
    expect(invoke).toHaveBeenCalledTimes(calls);
    expect(result.planningMode).toBe(planningMode);
    expect(result.proposal?.patch?.from).toBe(offset);
    expect(result.proposal?.patch?.to).toBe(offset);
    expect(result.proposal?.patch?.expectedText).toBe("");
    expect(result.proposal?.snapshot.content).toBe(source);
    const patch = result.proposal!.patch!;
    const proposed = resolveAiEdit(result.proposal!)?.content;
    expect(proposed).toBe(source.slice(0, offset) + patch.insertText + source.slice(offset));
    expect(proposed).toContain("hello");
  });

  it("rejects a model plan that contradicts the requested body-start position", async () => {
    const invoke = vi.fn(async () => JSON.stringify(insert("document_end")));
    await expect(runPlannedAiTask({
      source, action: "custom", userPrompt: '在正文开头新增“hello”', baseSystemPrompt: "只输出结果。",
      actionDefinition: { id: "custom", label: "自定义", prompt: '在正文开头新增“hello”' }
    }, snapshot(), { invoke, isCurrent: () => true, abortCurrent: vi.fn() }))
      .rejects.toMatchObject({ code: "target_mismatch" });
    expect(invoke).toHaveBeenCalledTimes(1);
  });

  it("does not impose insertion layout on proofread instructions that preserve Markdown line breaks", () => {
    const instruction = "校对全文并改正错别字，保留 Markdown 与 HTML 结构、所有数字、链接、命令、公式和换行。";
    const snap = snapshot({ content: "保留原换行。\r\n" });
    const plan: ValidatedIntent = {
      version: 1,
      kind: "edit",
      operation: "rewrite",
      target: "document",
      content: { mode: "generate", task: "polish" }
    };
    const contract = deriveInstructionContract(instruction);
    const candidates = buildAiIntentCandidates(instruction, snap.content, contract);

    expect(contract.operation).toMatchObject({ state: "explicit", value: "rewrite" });
    expect(contract.layout.state).toBe("unknown");
    expect(() => validatePlannedIntent(plan, contract, snap, candidates, instruction)).not.toThrow();
  });

  it("keeps an explicit cursor target without invoking the model", async () => {
    const { result, invoke } = await execute('在光标处原样插入“hello”', insert("document_end"));
    const offset = source.indexOf("alpha");
    expect(invoke).not.toHaveBeenCalled();
    expect(result.proposal?.patch).toMatchObject({ from: offset, to: offset, insertText: "hello" });
    expect(resolveAiEdit(result.proposal!)?.content).toContain("hello");
  });

  it("keeps an exact short task command on its program plan and one content call", async () => {
    const instruction = "润色全文";
    const snap = snapshot({ cursor: null, selection: null });
    const invoke = vi.fn(async (prompt: string) => proseResponse(prompt, text => text.replace("alpha hello。", "alpha hello！")));
    const result = await runPlannedAiTask({
      source: snap.content, action: "custom", userPrompt: instruction, baseSystemPrompt: "只输出结果。",
      actionDefinition: { id: "custom", label: "自定义", prompt: instruction }
    }, snap, { invoke, isCurrent: () => true, abortCurrent: vi.fn() });

    expect(invoke).toHaveBeenCalledTimes(1);
    expect(invoke.mock.calls[0][0]).not.toContain("本次用户指令：");
    expect(result).toMatchObject({ planningMode: "program", resolvedIntent: { kind: "edit", operation: "rewrite", target: "document" } });
  });

  it("rejects a selection plan against explicit document scope", () => {
    const instruction = "润色全文";
    const snap = snapshot({ selection: { from: source.indexOf("alpha"), to: source.indexOf("alpha") + 5 } });
    const plan: ValidatedIntent = { version: 1, kind: "edit", operation: "rewrite", target: "selection", content: { mode: "generate", task: "polish" } };
    const contract = deriveInstructionContract(instruction, { hasSelection: true });
    const candidates = buildAiIntentCandidates(instruction, source, contract);
    expect(() => validatePlannedIntent(plan, contract, snap, candidates, instruction)).toThrow(expect.objectContaining({ code: "target_mismatch" }));
    expect(resolveKnownIntent(instruction, snap, candidates, contract)).toMatchObject({ intent: { kind: "edit", operation: "rewrite", target: "document" } });
  });

  it("stops a missing selected quoted payload before any planning or content call", async () => {
    const invoke = vi.fn(async () => "");
    await expect(runPlannedAiTask({ source, action: "custom", userPrompt: '只把选中的“hello”替换为“world”。', baseSystemPrompt: "", actionDefinition: { id: "custom", label: "自定义", prompt: "" } }, snapshot(), { invoke, isCurrent: () => true, abortCurrent: vi.fn() }))
      .rejects.toMatchObject({ code: "selection_required" });
    expect(invoke).not.toHaveBeenCalled();
  });

  it("binds the third match with spaced ordinal evidence", async () => {
    const plan: ValidatedIntent = { version: 1, kind: "edit", operation: "replace_exact", target: "document", find: "hello", occurrence: 3, content: { mode: "literal", text: "world" } };
    const { result, invoke } = await execute('把第 3 处“hello”替换为“world”。', plan);
    expect(invoke).not.toHaveBeenCalled();
    expect(result.proposal?.patch?.from).toBe(source.lastIndexOf("hello"));
    expect(resolveAiEdit(result.proposal!)?.content).toBe(source.slice(0, -5) + "world");
  });

  it("uniquely binds a quoted title rather than accepting a different available title", async () => {
    const [wanted, wrong] = getIntentHeadings(source);
    const plan: ValidatedIntent = { version: 1, kind: "edit", operation: "insert", target: "heading_end", targetId: wanted.id, layout: "block", content: { mode: "literal", text: "hello" } };
    const instruction = '在“部署步骤”这个标题后新增“hello”';
    const { result, invoke } = await execute(instruction, plan);
    expect(invoke).toHaveBeenCalledTimes(1);
    expect(result.planningMode).toBe("model");
    expect(result.resolvedIntent).toMatchObject({ kind: "edit", operation: "insert", target: "heading_end", targetId: wanted.id });
    expect(result.proposal?.patch?.from).toBe(source.indexOf("\n", source.indexOf("# 部署步骤")) + 1);
    expect(result.proposal?.snapshot.content).toBe(source);
    const proposed = resolveAiEdit(result.proposal!)?.content;
    expect(proposed).toBe(source.slice(0, result.proposal!.patch!.from) + result.proposal!.patch!.insertText + source.slice(result.proposal!.patch!.to));
    expect(proposed).toContain("hello");
    const contract = deriveInstructionContract(instruction);
    const candidates = buildAiIntentCandidates(instruction, source, contract);
    expect(() => validatePlannedIntent({ ...plan, targetId: wrong.id }, contract, snapshot(), candidates, instruction))
      .toThrow(expect.objectContaining({ code: "heading_mismatch" }));
  });

  it("binds a global heading ordinal when no heading title is quoted", () => {
    const content = "# 第一章\n\na\n\n## 第二章\n\nb\n\n# 第三章\n\nc";
    const instruction = "在第3个标题后新增“Added”";
    const document = snapshot({ content });
    const contract = deriveInstructionContract(instruction);
    expect(contract.heading).toMatchObject({ state: "explicit", value: { text: "", ordinal: 3, ordinalScope: "global", relation: "heading_end" } });
    expect(contract.occurrence.state).toBe("unknown");
    const candidates = buildAiIntentCandidates(instruction, content, contract);
    expect(candidates.headings.map(({ text }) => text)).toEqual(["第三章"]);
    const modelPlan: ValidatedIntent = { version: 1, kind: "edit", operation: "insert", target: "heading_end", targetId: candidates.headings[0].id, layout: "block", content: { mode: "literal", text: "Added" } };
    const boundPlan = bindAiIntent(modelPlan, document, instruction, candidates, contract);
    expect(boundPlan.range.from).toBe(content.indexOf("\n", content.indexOf("# 第三章")) + 1);

    const explicitLayout = "在第3个标题后另起一段新增“Added”";
    const explicitContract = deriveInstructionContract(explicitLayout);
    const explicitCandidates = buildAiIntentCandidates(explicitLayout, content, explicitContract);
    const knownBound = resolveKnownIntent(explicitLayout, document, explicitCandidates, explicitContract);
    expect(knownBound?.intent).toMatchObject({ kind: "edit", operation: "insert", target: "heading_end", targetId: explicitCandidates.headings[0].id });
    expect(knownBound?.range.from).toBe(boundPlan.range.from);
  });
});
