import { describe, expect, it } from "vitest";
import { deriveInstructionContract } from "../../src/core/ai/instructionConstraints";
import { assertSingleEditOperation } from "../../src/core/ai/intentConstraints";
import { buildAiTaskRequest } from "../../src/core/ai/aiTaskRequest";
import { runPlannedAiTaskCore } from "../../src/core/ai/plannedTaskRunnerCore";
import { resolveAiEdit } from "../../src/core/ai/editProposal";
import { generatedCodeCompositionRanges, generatedFunctionBehaviorRanges } from "../../src/core/ai/codeGenerationBehavior";
import { maskQuotedInstruction, scanInstructionQuotes } from "../../src/core/ai/instructionLiteralEvidence";

const source = "# Notes\n\nKeep this paragraph unchanged.";

function contract(instruction: string) {
  return deriveInstructionContract(instruction, { hasSelection: false, hasCursor: false });
}

describe("operations inside a generated function", () => {
  it("keeps parameter transformations in the generated function instead of treating them as document edits", () => {
    const instruction = "在文末新增 Python 代码围栏，定义 normalizeTopic(topic) 函数。它将 topic 转为小写，并把单词之间的空格改为下划线；不要改动已有段落。";
    const result = contract(instruction);

    expect(result.operation).toMatchObject({ state: "explicit", value: "insert" });
    expect(result.effect).toMatchObject({ state: "explicit", value: "edit" });
    expect(result.target).toMatchObject({ state: "explicit", value: "document_end" });
    expect(result.issues).toEqual([]);
    expect(() => assertSingleEditOperation(instruction)).not.toThrow();
  });

  it("applies the same boundary to deletion and suffix behavior on the declared parameter", () => {
    const instruction = "在文末新增 Python 代码围栏，定义 cleanTopic(topic) 函数。该函数删除 topic 首尾空格，并在 topic 末尾追加 .md。";
    const result = contract(instruction);

    expect(result.operation).toMatchObject({ state: "explicit", value: "insert" });
    expect(result.issues).toEqual([]);
    expect(() => assertSingleEditOperation(instruction)).not.toThrow();
  });

  it("supports English function anaphora and inherits the same parameter scope across coordinated behaviors", () => {
    const instruction = "At the end, add a Python code block and define function normalizeTopic(topic). It converts topic to lowercase and replaces spaces with underscores.";
    const result = contract(instruction);
    const masked = maskQuotedInstruction(instruction, scanInstructionQuotes(instruction));
    const ranges = [...instruction.matchAll(/converts|replaces/giu)].map(match => ({ from: match.index!, to: match.index! + match[0].length }));
    expect(generatedFunctionBehaviorRanges(instruction, masked, ranges)).toEqual(new Set(ranges.map(({ from, to }) => `${from}:${to}`)));

    expect(result.operation).toMatchObject({ state: "explicit", value: "insert" });
    expect(result.issues).toEqual([]);
    expect(() => assertSingleEditOperation(instruction)).not.toThrow();
  });

  it.each([
    "在文末新增 Python 代码围栏，定义 cleanTopic(topic) 函数。它删除 topic 首尾空格，并修改原文第一段。",
    "在文末新增 Python 代码围栏，定义 cleanTopic(topic) 函数。它将 topic 转为小写，并修改现有文档标题为‘完成’。",
    "在文末新增 Python 代码围栏，定义 cleanTopic(topic) 函数。它将 topic 转为小写，然后在文末添加一张表格。"
  ])("preserves a distinct document operation next to generated function behavior: %s", instruction => {
    const result = contract(instruction);

    expect(result.issues.some(issue => issue.code === "compound")).toBe(true);
    expect(() => assertSingleEditOperation(instruction)).toThrow(/多个编辑操作/u);
  });

  it("counts multiple function definitions in one code fence as one document insertion", () => {
    const instruction = "在文末新增 Python 代码围栏，定义 cleanTopic(topic) 函数。它删除 topic 首尾空格，并新增 helper(value) 函数。";
    const result = contract(instruction);
    expect(result.operation).toMatchObject({ state: "explicit", value: "insert" });
    expect(result.issues).toEqual([]);
    expect(() => assertSingleEditOperation(instruction)).not.toThrow();
  });

  it("does not merge two separately requested code fences into one insertion", () => {
    const instruction = "At the end, add a JavaScript code fence with cleanTopic(topic). Trim the topic parameter. Then add a second JavaScript code fence with normalizeTitle(title).";
    const result = contract(instruction);

    expect(result.issues.some(issue => issue.code === "compound")).toBe(true);
    expect(() => assertSingleEditOperation(instruction)).toThrow(/多个编辑操作/u);
  });

  it.each([
    "At the end, add a JavaScript function tidyText(text). It trims the selected text in this editor and removes the current note.",
    "At the end, add a JavaScript function tidyText(text). It trims the current note text and deletes the current note’s first line.",
    "在文末新增 JavaScript 代码围栏，定义 cleanText(text) 函数。它删除当前选区的 text，并移除页面中的第一行。",
    "At the end, add a JavaScript function tidyText(text). It trims text in the current selection and appends a suffix to the clipboard."
  ])("keeps explicit editor targets outside function-local behavior: %s", instruction => {
    const result = contract(instruction);
    const forcedInsert = result.operation.state === "explicit" && result.operation.value === "insert" &&
      result.effect.state === "explicit" && result.effect.value === "edit" && !result.issues.length;

    expect(forcedInsert).toBe(false);
  });

  it("does not treat a Document-like function name or filename parameter as an editor target", () => {
    const instruction = "At the end, add a JavaScript function cleanDocument(fileName). It trims the fileName parameter and appends a suffix to it.";
    const result = contract(instruction);

    expect(result.operation).toMatchObject({ state: "explicit", value: "insert" });
    expect(result.issues).toEqual([]);
    expect(() => assertSingleEditOperation(instruction)).not.toThrow();
  });

  it("keeps a move of existing document content as a separate operation", () => {
    expect(() => assertSingleEditOperation("在文末新增 Python 代码围栏，定义 cleanTopic(topic) 函数，然后移动原文第一段。"))
      .toThrow(/多个编辑操作/u);
  });

  it("recognizes explicitly typed TypeScript parameters and function-body references", () => {
    const instruction = "在文末新增 TypeScript 代码围栏，定义 removePrefix(value: string, prefix: string)。函数只从 value 参数中移除给定 prefix 并返回结果，不修改当前文档。";
    const result = contract(instruction);

    expect(result.operation).toMatchObject({ state: "explicit", value: "insert" });
    expect(result.issues).toEqual([]);
    expect(() => assertSingleEditOperation(instruction)).not.toThrow();
  });

  it("uses ASCII identifier boundaries and preserves an explicit text2-only transformation", () => {
    const instruction = "Define combineText(text, text2) in a JavaScript code fence at the end. Trim only the text2 parameter and return both inputs; preserve text exactly and do not edit the existing sentence that mentions text and text2.";
    const result = contract(instruction);
    expect(result.operation).toMatchObject({ state: "explicit", value: "insert" });
    expect(result.effect).toMatchObject({ state: "explicit", value: "edit" });
    expect(result.issues).toEqual([]);
    expect(() => assertSingleEditOperation(instruction)).not.toThrow();
  });

  it("does not let an English document prohibition replace an inferred code insertion", () => {
    const instruction = "At the end, define appendSuffix(fileName, suffix) in a JavaScript fence. The function returns fileName with the supplied suffix appended; do not append anything to the document itself.";
    const result = contract(instruction);

    expect(result.operation).toMatchObject({ state: "explicit", value: "insert" });
    expect(result.effect).toMatchObject({ state: "explicit", value: "edit" });
    expect(result.issues).toEqual([]);
    expect(() => assertSingleEditOperation(instruction)).not.toThrow();
  });

  it("supports a single unambiguous call signature followed by an explicit function reference", () => {
    const instruction = "At the end, add a JavaScript code fence with tidyInput(text). Inside that function, trim surrounding whitespace from its text parameter and replace spaces in that parameter with underscores.";
    const result = contract(instruction);

    expect(result.operation).toMatchObject({ state: "explicit", value: "insert" });
    expect(result.issues).toEqual([]);
    expect(() => assertSingleEditOperation(instruction)).not.toThrow();
  });

  it("uses a same-function anaphor and connected operations for several parameter transforms", () => {
    const instruction = "在文末添加 JavaScript 代码围栏，定义 formatKey(key)。同一个函数把 key 去除首尾空白、转为小写、将空格替换成下划线，并在返回值末尾追加固定后缀；只新增代码，不改文档。";
    const result = contract(instruction);

    expect(result.operation).toMatchObject({ state: "explicit", value: "insert" });
    expect(result.issues).toEqual([]);
    expect(() => assertSingleEditOperation(instruction)).not.toThrow();
  });

  it("accepts a directly named Chinese parameter without requiring a pronoun", () => {
    const instruction = "在文末新增 Python 函数 normalizeTitle(title)。将 title 参数转成小写，并将其中的词间空格换成下划线；这些变换只作用于参数，不修改文档正文或标题。";
    const result = contract(instruction);

    expect(result.operation).toMatchObject({ state: "explicit", value: "insert" });
    expect(result.issues).toEqual([]);
    expect(() => assertSingleEditOperation(instruction)).not.toThrow();
  });

  it("keeps a genuine English H1 rename as a document operation beside code creation", () => {
    const instruction = "Add TypeScript code defining isReady(flag) at the end, and separately rename the existing H1 'Existing title' to 'Current title'.";
    const result = contract(instruction);

    expect(result.issues.some(issue => issue.code === "compound")).toBe(true);
    expect(() => assertSingleEditOperation(instruction)).toThrow(/多个编辑操作/u);
  });

  it("does not infer that an ambiguous phrase 'the text' means the function parameter", () => {
    const instruction = "Add a JavaScript function formatCard(value), and clean the text by removing spaces and appending a suffix. The instruction does not say whether the text is value or existing document prose.";
    const result = contract(instruction);

    expect(result.issues.some(issue => issue.code === "compound")).toBe(true);
    expect(() => assertSingleEditOperation(instruction)).toThrow(/多个编辑操作/u);
  });

  it("does not count an English do-not prohibition as a second positive edit", () => {
    const instruction = "At the end, add a JavaScript function removeSpaces(text). It removes spaces from text and do not delete the first paragraph.";
    const result = contract(instruction);

    expect(result.operation).toMatchObject({ state: "explicit", value: "insert" });
    expect(result.issues).toEqual([]);
    expect(() => assertSingleEditOperation(instruction)).not.toThrow();
  });

  it("leaves quoted behavior text, negated definitions, and existing-code explanations outside the filter", () => {
    const quoted = "在文末新增 Python 代码围栏，定义 echo(text) 函数。它返回字符串‘删除全文’，不要在文档中删除内容。";
    const negated = "不要新增 Python 代码围栏，定义 cleanTopic(topic) 函数；只修改原文第一段。";
    const descriptive = "这个 Python 函数 cleanTopic(topic) 将 topic 转为小写，并删除空格。";

    expect(contract(quoted).issues).toEqual([]);
    expect(contract(negated).operation).toMatchObject({ state: "explicit", value: "rewrite" });
    expect(contract(descriptive).issues.some(issue => issue.code === "compound")).toBe(true);
  });

  it("does not treat an explicitly described quoted token as a document edit", () => {
    const instruction = "在文末新增 JavaScript 函数 stripMarker(value)。它只在 value 参数中把字面标记 \"REMOVE\" 替换为空文本；引号中的 REMOVE 是数据，不是要求删除当前文档内容。";
    const result = contract(instruction);

    expect(result.operation).toMatchObject({ state: "explicit", value: "insert" });
    expect(result.issues).toEqual([]);
    expect(() => assertSingleEditOperation(instruction)).not.toThrow();
  });

  it("reaches the normal artifact decoder with one call and leaves the source proposal-based", async () => {
    const instruction = "在文末新增 Python 代码围栏，定义 normalizeTopic(topic) 函数。它将 topic 转为小写，并把单词之间的空格改为下划线；不要改动已有段落。";
    const request = buildAiTaskRequest({ source, selected: false, action: "custom", userPrompt: instruction,
      config: { provider: "local", model: "Qwen3-0.6B-Q4_K_M.gguf", activeRoleId: "general", executionPolicy: "thin" } });
    const snapshot = { documentId: "generated-function-behavior", revision: 1, content: source,
      selection: null, cursor: null, selectionValid: true, readOnly: false };
    let calls = 0;
    const result = await runPlannedAiTaskCore(request, snapshot, {
      invoke: async (_prompt, _system, _maxTokens, _chunk, schema) => {
        calls++;
        expect(schema).toHaveProperty("properties.payload");
        return JSON.stringify({ payload: "def normalizeTopic(topic):\n    return topic.lower().replace(' ', '_')" });
      }, isCurrent: () => true, abortCurrent: () => {}, maxCalls: 1, maxDurationMs: 10_000
    });

    expect(calls).toBe(1);
    expect(snapshot.content).toBe(source);
    expect(result.proposal).toBeDefined();
    expect(resolveAiEdit(result.proposal!)?.content.startsWith(source + "\n\n")).toBe(true);
  });

  it.each([
    "在文末新增 Markdown 二级标题“API v2”，其后放 TypeScript 代码围栏并定义 greetUser 函数。",
    "在文末新增 Markdown 二级标题“API <v2> & C++”，其后放 TypeScript 代码围栏并定义 greetUser 函数。"
  ])("treats a heading and its following code fence as one generated artifact: %s", async instruction => {
    const result = contract(instruction);
    expect(result.operation).toMatchObject({ state: "explicit", value: "insert" });
    expect(result.effect).toMatchObject({ state: "explicit", value: "edit" });
    expect(result.issues).toEqual([]);
    expect(() => assertSingleEditOperation(instruction)).not.toThrow();

    const request = buildAiTaskRequest({ source, selected: false, action: "custom", userPrompt: instruction,
      config: { provider: "local", model: "Qwen3-0.6B-Q4_K_M.gguf", activeRoleId: "general", executionPolicy: "thin" } });
    const snapshot = { documentId: "heading-code-artifact", revision: 1, content: source,
      selection: null, cursor: null, selectionValid: true, readOnly: false };
    let calls = 0;
    const task = await runPlannedAiTaskCore(request, snapshot, {
      invoke: async (_prompt, _system, _maxTokens, _chunk, schema) => {
        calls++;
        expect(schema).toHaveProperty("properties.payload");
        return JSON.stringify({ payload: "function greetUser() { return 'hello'; }" });
      }, isCurrent: () => true, abortCurrent() {}, maxCalls: 1, maxDurationMs: 10_000
    });

    expect(calls).toBe(1);
    expect(snapshot.content).toBe(source);
    expect(task.proposal).toBeDefined();
    expect(resolveAiEdit(task.proposal!)?.content.startsWith(source + "\n\n")).toBe(true);
  });

  it("keeps actual document edits after a heading-plus-code insertion compound", () => {
    const instruction = "在文末新增 Markdown 二级标题“API v2”，其后放 TypeScript 代码围栏并定义 greetUser 函数，然后删除原文第一段。";
    expect(contract(instruction).issues.some(issue => issue.code === "compound")).toBe(true);
    expect(() => assertSingleEditOperation(instruction)).toThrow(/多个编辑操作/u);
  });

  it("abstains from generated-code scoping for overlong instructions", () => {
    const base = "At the end, add a JavaScript code fence with tidyInput(text). Inside that function, trim whitespace from text and delete the first paragraph in the current document.";
    const instruction = `${base}${" Extra guidance.".repeat(700)}`;
    const from = instruction.indexOf("trim");
    const range = { from, to: from + "trim".length };

    expect(generatedFunctionBehaviorRanges(instruction, instruction, [range])).toEqual(new Set());
    expect(() => assertSingleEditOperation(instruction)).toThrow(/多个编辑操作/u);
  });

  it("abstains from function-local scope filtering when operation count exceeds its bound", () => {
    const behavior = Array.from({ length: 33 }, () => "trim the text").join(" and ");
    const instruction = `At the end, add a JavaScript code fence with tidyInput(text). Inside that function, ${behavior}.`;
    const ranges = [...instruction.matchAll(/trim/gu)].map(match => ({ from: match.index!, to: match.index! + match[0].length }));

    expect(ranges).toHaveLength(33);
    expect(generatedFunctionBehaviorRanges(instruction, instruction, ranges)).toEqual(new Set());
    expect(() => assertSingleEditOperation(instruction)).toThrow(/多个编辑操作/u);
  });

  it("abstains from function-local scope filtering when signature ambiguity exceeds its bound", () => {
    const suffix = Array.from({ length: 17 }, (_, index) => `f${index}(a)`).join(" ");
    const instruction = `At the end, add a JavaScript code fence with tidyInput(text). Inside that function, trim whitespace from text. ${suffix}`;
    const from = instruction.indexOf("trim");
    const range = { from, to: from + "trim".length };

    expect(generatedFunctionBehaviorRanges(instruction, instruction, [range])).toEqual(new Set());
  });

  it("abstains from heading/code composition filtering when operation count exceeds its bound", () => {
    const instruction = "在文末新增 Markdown 二级标题“API v2”，其后放 TypeScript 代码围栏并定义 greetUser 函数。";
    const masked = maskQuotedInstruction(instruction, scanInstructionQuotes(instruction));
    const primary = { from: instruction.indexOf("新增"), to: instruction.indexOf("新增") + 2 };
    const nested = { from: instruction.indexOf("定义"), to: instruction.indexOf("定义") + 2 };
    const operations = [primary, nested, ...Array.from({ length: 31 }, () => ({ from: 0, to: 1 }))];

    expect(generatedCodeCompositionRanges(instruction, masked, operations)).toEqual(new Set());
  });

  it("abstains from heading/code composition filtering for overlong or highly ambiguous requests", () => {
    const base = "在文末新增 Markdown 二级标题“API v2”，其后放 TypeScript 代码围栏并定义 greetUser 函数。";
    const primary = { from: base.indexOf("新增"), to: base.indexOf("新增") + 2 };
    const nested = { from: base.indexOf("定义"), to: base.indexOf("定义") + 2 };
    const operations = [primary, nested];
    const long = `${base}${" Additional context.".repeat(600)}`;
    const names = Array.from({ length: 17 }, (_, index) => `f${index}(a)`).join(" ");
    const manySignatures = `${base} ${names}`;
    const longMasked = maskQuotedInstruction(long, scanInstructionQuotes(long));
    const signatureMasked = maskQuotedInstruction(manySignatures, scanInstructionQuotes(manySignatures));

    expect(generatedCodeCompositionRanges(long, longMasked, operations)).toEqual(new Set());
    expect(generatedCodeCompositionRanges(manySignatures, signatureMasked, operations)).toEqual(new Set());
  });
});
