import { describe, expect, it } from "vitest";
import { buildAiIntentCandidates } from "../../src/core/ai/intentContext";
import { buildIntentOutputSchema } from "../../src/core/ai/intentOutputSchema";
import { deriveInstructionContract } from "../../src/core/ai/instructionConstraints";
import { buildBoundIntentPatch } from "../../src/core/ai/intentBinder";
import { resolveKnownIntent } from "../../src/core/ai/resolvedIntentContract";
import { resolveGenerationRequirements } from "../../src/core/ai/generationRequirements";
import type { AiDocumentSnapshot } from "../../src/types/aiEditing";

type JsonSchema = {
  anyOf?: JsonSchema[];
  properties?: Record<string, { const?: unknown; enum?: unknown[] }>;
};

function schemaFor(instruction: string, source: string, context?: { hasCursor?: boolean; hasSelection?: boolean }): JsonSchema {
  const contract = deriveInstructionContract(instruction, context);
  const candidates = buildAiIntentCandidates(instruction, source, contract);
  return buildIntentOutputSchema(instruction, Boolean(context?.hasSelection), candidates, contract) as JsonSchema;
}

function branchesFor(schema: JsonSchema, kind: string): JsonSchema[] {
  return (schema.anyOf ?? []).filter(branch => {
    const value = branch.properties?.kind;
    return value?.const === kind || value?.enum?.includes(kind);
  });
}

function snapshot(content: string, extra: Partial<AiDocumentSnapshot> = {}): AiDocumentSnapshot {
  return { documentId: "resolved.md", revision: 1, content, selection: null, cursor: null, readOnly: false, ...extra };
}

function resolve(instruction: string, document: AiDocumentSnapshot) {
  const contract = deriveInstructionContract(instruction, {
    hasSelection: Boolean(document.selection && document.selection.to > document.selection.from),
    hasCursor: document.cursor !== null
  });
  const candidates = buildAiIntentCandidates(instruction, document.content, contract);
  return resolveKnownIntent(instruction, document, candidates, contract);
}

describe("resolved intent public schema contract", () => {
  it("constructs the frozen cursor-literal case as a zero-planning, zero-generation edit", () => {
    const instruction = "Add “!” exactly where the cursor is";
    const document = snapshot("Hi", { cursor: 2 });
    const bound = resolve(instruction, document);
    expect(bound?.intent).toEqual({
      version: 1, kind: "edit", operation: "insert", target: "cursor", layout: "inline",
      content: { mode: "literal", text: "!" }
    });
    expect(bound).toMatchObject({ range: { from: 2, to: 2, expectedText: "" }, source: "Hi", dependency: "cursor" });
    expect(buildBoundIntentPatch(bound!, "!")).toEqual({ from: 2, to: 2, expectedText: "", insertText: "!" });
  });

  it("constructs the frozen last-match replacement from source-backed find/write spans", () => {
    const instruction = "Replace the last draft with final in the document";
    const document = snapshot("draft one; draft two; draft three");
    const bound = resolve(instruction, document);
    expect(bound?.intent).toEqual({
      version: 1, kind: "edit", operation: "replace_exact", target: "document",
      find: "draft", occurrence: "last", content: { mode: "literal", text: "final" }
    });
    expect(bound).toMatchObject({ range: { from: 22, to: 27, expectedText: "draft" }, matches: [{ from: 22, to: 27 }] });
    expect(buildBoundIntentPatch(bound!, "final")).toEqual({
      from: 22, to: 27, expectedText: "draft", insertText: "final"
    });
  });

  it("keeps a free-form summary request for model planning without discarding its read-only constraints", () => {
    const instruction = "总结全文的三项决定，包含开篇、中段、末段的关键实体、负责人、金额和日期。忽略重复背景，只回答，不修改文档。";
    const document = snapshot("开篇苍鹭由许宁负责；中段海盐预算 37 万；末段琥珀截止 2026-12-19。");
    expect(resolve(instruction, document)).toBeNull();
    const contract = deriveInstructionContract(instruction, { hasSelection: false });
    expect(contract.effect).toMatchObject({ state: "explicit", value: "answer" });
    expect(contract.generationTasks).toMatchObject({ state: "explicit", value: ["summarize"] });
  });

  it.each([
    ["Add “!” exactly where the cursor is", snapshot("Hi")],
    ["Add “!” somewhere", snapshot("Hi", { cursor: 2 })],
    ["Replace the last draft with final in the document", snapshot("nothing to replace")],
    ["Replace draft with final in the document", snapshot("draft; draft")],
    ["Do not replace draft with final in the document", snapshot("draft")],
    ["Add “!” at the cursor and replace draft with final", snapshot("draft", { cursor: 0 })]
  ])("does not program-resolve missing, ambiguous, negated, or compound instruction: %s", (instruction, document) => {
    expect(resolve(instruction, document)).toBeNull();
  });

  it("does not turn an unlocated insertion into an implicit document-end edit", () => {
    expect(resolve("Add “hello”", snapshot("Existing text."))).toBeNull();
  });

  it.each([
    ["请不要续写一段后续行动建议。", snapshot("原文。")],
    ["解释“续写”这个词的含义。", snapshot("原文。")],
    ["只回答‘续写’是什么意思，不修改文档。", snapshot("原文。")],
    ["先总结全文，再续写一段后续行动建议。", snapshot("原文。")],
    ["在文末和正文开头续写一段后续行动建议。", snapshot("原文。")],
    ["续写当前选区中的后续行动建议。", snapshot("原文。")]
  ])("does not apply continuation defaults to negation, quotation, answer, compound, conflict, or missing selection: %s", (instruction, document) => {
    const result = resolve(instruction, document);
    expect(result).toBeNull();
    const contract = deriveInstructionContract(instruction, { hasSelection: false, hasCursor: false });
    expect(contract.target).not.toMatchObject({ state: "explicit", value: "document_end" });
  });

  it.each([
    {
      id: "L10",
      instruction: "Add “!” exactly where the cursor is",
      source: "Hi",
      context: { hasCursor: true },
      expected: { operation: "insert", target: "cursor", layout: "inline", literal: "!" }
    },
    {
      id: "L17",
      instruction: "Replace the last draft with final in the document",
      source: "draft one; draft two; draft three",
      context: {},
      expected: { operation: "replace_exact", target: "document", occurrence: "last", find: "draft", literal: "final" }
    },
    {
      id: "G09",
      instruction: "总结全文的三项决定，包含开篇、中段、末段的关键实体、负责人、金额和日期。忽略重复背景，只回答，不修改文档。",
      source: "## 开篇\n\n苍鹭由许宁负责。\n\n## 中段\n\n海盐预算 37 万。\n\n## 末段\n\n琥珀截止日期为 2026-12-19。",
      context: {},
      expected: { kind: "answer", target: "document", task: "summarize" }
    }
  ])("keeps clarification available to a model while preserving evidenced fields for $id", ({ instruction, source, context, expected }) => {
    const schema = schemaFor(instruction, source, context);
    expect(branchesFor(schema, "clarify")).toHaveLength(1);
    expect(branchesFor(schema, "unsupported")).toHaveLength(1);
    const serialized = JSON.stringify(schema);
    for (const [key, value] of Object.entries(expected)) {
      if (key === "literal") expect(serialized).toContain(`"const":"${value}"`);
      else if (key === "occurrence") expect(serialized).toMatch(new RegExp(`(?:"const":"${value}"|"enum":\\["${value}"\\])`));
      else expect(serialized).toContain(`"const":"${value}"`);
    }
  });

  it.each([
    "Add “!” at the cursor and replace “draft” with “final”",
    "Do not replace the last draft with final"
  ])("keeps clarification for conflict or negation instead of inventing an edit: %s", instruction => {
    const schema = schemaFor(instruction, "draft one; draft two", { hasCursor: true });
    expect(branchesFor(schema, "clarify").length + branchesFor(schema, "unsupported").length).toBeGreaterThan(0);
    expect(branchesFor(schema, "edit")).toHaveLength(0);
  });

  it("does not resolve a missing replacement value by treating the control instruction as payload", () => {
    const instruction = "在文末替换 draft";
    const contract = deriveInstructionContract(instruction);
    const schema = schemaFor(instruction, "draft one; draft two");
    expect(branchesFor(schema, "clarify").length + branchesFor(schema, "unsupported").length).toBeGreaterThan(0);
    expect(contract.literals.some(({ role, value }) => role === "write" && value === instruction)).toBe(false);
  });
});

describe("generation requirements precedence", () => {
  it.each([
    ["G03", "在文末生成 Markdown 表格，列名为水果和价格，列出上下文里的两种水果及每斤价格。", "table"],
    ["G04", "根据本文在文末生成 Mermaid 流程图，用 mermaid 代码围栏输出，包含开始、审核、结束三个节点。", "mermaid"],
    ["G05", "在文末生成一段直角三角形的勾股定理解释，使用 LaTeX 数学公式表达三条边的关系。", "math"],
    ["G06", "在文末生成本文需要的 Python 函数，使用 python 代码围栏，只生成代码和简短说明。", "code"],
    ["G08", "校对全文，纠正中文错别字，保留所有 Markdown 结构、数字、日期、图标、链接、代码和公式。", null],
    ["G11", "润色全文并纠正错别字，保留所有 C01 到 C08 段落标识及顺序、原有事实和代码。", null]
  ] as const)("uses only positively requested output format for frozen %s", (_id, instruction, artifact) => {
    const requirements = resolveGenerationRequirements(instruction);
    if (artifact) expect(requirements.artifact).toMatchObject({ state: "explicit", value: artifact });
    else expect(requirements.artifact.state).toBe("unknown");
  });

  it("locks an explicit Markdown table even when the semantic task and skill suggest a diagram", () => {
    const instruction = "在文末生成 Markdown 表格，列名为水果和价格，列出上下文里的两种水果及每斤价格。";
    const requirements = resolveGenerationRequirements(instruction, "diagram", { category: "diagram" });
    expect(requirements.artifact).toMatchObject({ state: "explicit", value: "table" });
    expect(requirements.factPolicy).toBe("source_bound");
    expect(requirements.contentInstruction).toContain("列名为水果和价格");
    expect(requirements.contentInstruction).not.toMatch(/文末|生成/u);
  });

  it("uses a task default only when the instruction has no explicit artifact", () => {
    const requirements = resolveGenerationRequirements("续写下一步行动", "continue");
    expect(requirements.artifact.state).toBe("unknown");
    expect(requirements.factPolicy).toBe("allow_suggestions");
  });

  it("keeps technical-plan facts source-bound and extracts the required section headings", () => {
    const instruction = "在全文末尾生成技术方案，使用目标、方案、风险三个 Markdown 标题。严格基于原文事实与约束。";
    const requirements = resolveGenerationRequirements(instruction, "tech-spec");
    expect(requirements.artifact.state).toBe("unknown");
    expect(requirements.factPolicy).toBe("source_bound");
    expect(requirements.requiredHeadings.map(({ text }) => text)).toEqual(["目标", "方案", "风险"]);
    expect(requirements.contentInstruction).toContain("严格基于原文事实与约束");
    expect(requirements.contentInstruction).not.toContain("全文末尾");
  });

  it("keeps an explicit source-bound instruction stronger than suggestion language", () => {
    const requirements = resolveGenerationRequirements("严格基于原文事实提出建议，生成下一步检查方案。", "continue");
    expect(requirements.factPolicy).toBe("source_bound");
    expect(requirements.constraints).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: "preserve", text: expect.stringContaining("严格基于原文事实") })
    ]));
  });

  it("recognizes a canonical technical-spec heading list without treating summary fields as headings", () => {
    const sourceBound = "严格依据原文整理技术方案，包含目标、方案、风险；保留 6GB、离线和不外发约束。不要新增品牌、型号、负责人或日期.";
    expect(resolveGenerationRequirements(sourceBound, "tech-spec").requiredHeadings.map(({ text }) => text)).toEqual(["目标", "方案", "风险"]);
    expect(resolveGenerationRequirements("总结全文，包含负责人、金额和日期。", "summarize").requiredHeadings).toEqual([]);
  });

  it("permits labeled continuation suggestions but preserves an explicit no-new-dates constraint", () => {
    const instruction = "在文末续写一个下一步行动段落，沿用本文项目事实，提出发布前的具体检查事项。不要重复原文或杜撰数字与日期。";
    const requirements = resolveGenerationRequirements(instruction, "continue");
    expect(requirements.factPolicy).toBe("allow_suggestions");
    expect(requirements.constraints).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: "forbid", text: expect.stringContaining("杜撰数字与日期") })
    ]));
    expect(requirements.contentInstruction).toContain("发布前的具体检查事项");
    expect(requirements.contentInstruction).not.toContain("在文末");
  });

  it("honors explicit source display mode without treating quoted examples as a display request", () => {
    expect(resolveGenerationRequirements("用 Markdown 源码展示表格").display).toMatchObject({ state: "explicit", value: "source" });
    expect(resolveGenerationRequirements("解释“Markdown 源码展示”这句话").display.state).toBe("unknown");
  });
});
