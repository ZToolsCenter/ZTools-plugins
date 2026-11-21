import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";
import { mergeArtifactPlanHint, type IntentArtifactHint } from "../../src/core/ai/intentArtifactHint";
import type { ArtifactSpec } from "../../src/core/ai/artifactSpec";
import { resolveArtifactSpec } from "../../src/core/ai/artifactSpecFromInstruction";
import { resolveGenerationRequirements } from "../../src/core/ai/generationRequirements";
import { buildIntentOutputSchema } from "../../src/core/ai/intentOutputSchema";
import { buildIntentPlanningPrompt, buildIntentSystemPrompt } from "../../src/core/ai/intentPrompts";
import { deriveInstructionContract } from "../../src/core/ai/instructionConstraints";
import type { InstructionContract } from "../../src/core/ai/intentContract";
import { parseIntentOutput } from "../../src/core/ai/intentSchema";
import type { IntentCandidates } from "../../src/core/ai/intentTypes";
import { calculateLocalAiBudget } from "../../src/core/ai/requestBudget";

const { validateOutputSchema } = createRequire(import.meta.url)("../../preload/local-ai/output-constraint.cjs");
const noCandidates: IntentCandidates = { headings: [], literals: [] };
const instruction = "在文末创建一个 Markdown 代码块，包含二级标题“hello”";
type TestSchema = { const?: unknown; enum?: unknown[]; anyOf?: TestSchema[]; properties?: Record<string, TestSchema> };
const hint: IntentArtifactHint = {
  kind: "code", language: "Markdown", headingLevel: 2, headingText: "hello"
};

function generatedPlan(content: Record<string, unknown>): string {
  return JSON.stringify({
    version: 1, kind: "edit", operation: "insert", target: "document_end", layout: "block", content
  });
}

function resolve(instructionText: string): ArtifactSpec {
  return resolveArtifactSpec(instructionText, resolveGenerationRequirements(instructionText), { effect: "edit", operation: "insert" });
}

function generatedArtifactProperties(source: string): Record<string, { const?: unknown; enum?: unknown[] }> {
  const branches = buildIntentOutputSchema(source, false, noCandidates).anyOf as TestSchema[];
  const generated = branches.flatMap((branch) => branch.properties?.content?.anyOf ?? [])
    .find((branch) => branch.properties?.mode?.const === "generate");
  return generated?.properties?.artifact?.anyOf?.[0]?.properties ?? {};
}

function clarificationReasonSchema(source: string, contract = deriveInstructionContract(source)): { const?: unknown; enum?: unknown[] } | undefined {
  const branches = buildIntentOutputSchema(source, false, noCandidates, contract).anyOf as TestSchema[];
  return branches.find((branch) => branch.properties?.reason)?.properties?.reason;
}

describe("optional planner artifact hints", () => {
  it("keeps known read operations and supplied subjects out of the missing edit-operation/position lane", () => {
    expect(clarificationReasonSchema("请解释“底部加hello”是什么意思，勿修改文稿。")).toBeUndefined();
    expect(clarificationReasonSchema("请解释一下")).toEqual({ const: "missing_content" });
    expect(clarificationReasonSchema("请解释当前选区。")?.enum).toContain("missing_target");
    expect(clarificationReasonSchema("处理一下这里")?.enum).toContain("missing_operation");
    expect(clarificationReasonSchema("请解释“添加文字”的意思，然后润色全文。")).toEqual({ const: "compound" });
  });

  it("accepts a bounded generated hint and preserves the old v1 shape", () => {
    expect(parseIntentOutput(generatedPlan({ mode: "generate", task: "custom", artifact: hint }), instruction, noCandidates))
      .toMatchObject({ content: { mode: "generate", task: "custom", artifact: hint } });
    expect(parseIntentOutput(generatedPlan({ mode: "generate", task: "custom" }), instruction, noCandidates))
      .toMatchObject({ content: { mode: "generate", task: "custom" } });
  });

  it("rejects invented strings, unsupported hint fields, and hints on literal content", () => {
    const invalid = [
      generatedPlan({ mode: "generate", task: "custom", artifact: { ...hint, headingText: "invented" } }),
      generatedPlan({ mode: "generate", task: "custom", artifact: { ...hint, headingLevel: 1 } }),
      generatedPlan({ mode: "generate", task: "custom", artifact: { ...hint, body: "hello" } }),
      generatedPlan({ mode: "literal", text: "hello", artifact: hint })
    ];
    for (const output of invalid) expect(() => parseIntentOutput(output, instruction, noCandidates)).toThrow();
  });

  it.each([
    ["新增二级标题“hello”", { kind: "heading", headingLevel: 2, headingText: "hello" }],
    ["新增表格，列名为名称、状态；行数据为测试→通过。", { kind: "table", columns: ["名称", "状态"] }],
    ["新增公式，公式为 x^2 + y^2。", { kind: "math", equation: "x^2 + y^2" }],
    ["新增列表：计划、评审、发布。", { kind: "list", items: ["计划", "评审", "发布"] }],
    ["新增 Mermaid 流程图，按顺序表示开始→结束。", { kind: "mermaid" }]
  ] as const)("accepts source-grounded %s artifact fields", (source, artifact) => {
    expect(parseIntentOutput(generatedPlan({ mode: "generate", task: "custom", artifact }), source, noCandidates).kind).toBe("edit");
  });

  it("keeps the closed schema optional and exposes hints only on generated content", () => {
    const schema = buildIntentOutputSchema(instruction, false, noCandidates);
    expect(() => validateOutputSchema(schema)).not.toThrow();
    const branches = schema.anyOf as TestSchema[];
    const generated = branches.flatMap((branch) => branch.properties?.content?.anyOf ?? [])
      .find((branch) => branch.properties?.mode?.const === "generate");
    const literal = branches.flatMap((branch) => branch.properties?.content?.anyOf ?? [])
      .find((branch) => branch.properties?.mode?.const === "literal");
    expect(generated?.properties?.artifact?.anyOf).toBeDefined();
    expect(literal?.properties?.artifact).toBeUndefined();
  });

  it("projects a single explicit contract issue into the clarify reason", () => {
    const source = "请在文末新增 hello，然后全文润色一遍。";
    const contract = deriveInstructionContract(source);
    expect(contract.issues.map(({ code }) => code)).toEqual(["compound"]);
    expect(clarificationReasonSchema(source, contract)).toEqual({ const: "compound" });

    const noIssue = { ...contract, issues: [] } satisfies InstructionContract;
    const multipleIssues = {
      ...contract,
      issues: [...contract.issues, { code: "missing_target" as const, evidence: [] }]
    } satisfies InstructionContract;
    expect(clarificationReasonSchema(source, noIssue)?.const).toBeUndefined();
    expect(clarificationReasonSchema(source, multipleIssues)?.enum).toContain("compound");
  });

  it("limits a Markdown heading hint to the exact fields and source values that were requested", () => {
    const properties = generatedArtifactProperties("新增代码块markdown的标题一 hello");
    expect(Object.keys(properties).sort()).toEqual(["headingLevel", "headingText", "kind", "language"]);
    expect(properties.kind).toEqual({ const: "code" });
    expect(properties.language).toEqual({ const: "markdown" });
    expect(properties.headingLevel).toEqual({ const: 1 });
    expect(properties.headingText).toEqual({ const: "hello" });
  });

  it("keeps the quoted Unicode heading and H2 level exact while constraining language to its source spelling", () => {
    const source = "在文末新增代码块 markdown 格式 标题二 “检查边界：状态✅”";
    const properties = generatedArtifactProperties(source);
    expect(properties.language).toEqual({ const: "markdown" });
    expect(properties.headingLevel).toEqual({ const: 2 });
    expect(properties.headingText).toEqual({ const: "检查边界：状态✅" });
    const modelHint = { kind: "code", language: "Markdown", headingLevel: 2, headingText: "检查边界：状态✅" } as const;
    expect(parseIntentOutput(generatedPlan({ mode: "generate", task: "custom", artifact: modelHint }), source, noCandidates))
      .toMatchObject({ content: { artifact: modelHint } });
    expect(mergeArtifactPlanHint(resolve(source), modelHint, source).issues).toEqual([]);
  });

  it("does not offer heading fields for Python or JSON code requests", () => {
    const python = generatedArtifactProperties("在文末新增 Python 代码块，定义 add(a, b)，返回 a + b。");
    expect(Object.keys(python).sort()).toEqual(["functionName", "kind", "language"]);
    expect(python.language).toEqual({ const: "Python" });
    expect(python.functionName).toEqual({ const: "add" });

    const json = generatedArtifactProperties("在文末新增 JSON 代码块，内容为 {\"ok\": true, \"count\": 3}。");
    expect(Object.keys(json).sort()).toEqual(["kind", "language"]);
    expect(json.language).toEqual({ const: "JSON" });
  });

  it("merges only role-matching values and reports a grounded known-field conflict", () => {
    const spec = resolve(instruction);
    const merged = mergeArtifactPlanHint(spec, hint, instruction);
    expect(merged).toEqual(spec);

    const conflicting: IntentArtifactHint = { ...hint, headingText: "Markdown" };
    const conflict = mergeArtifactPlanHint(spec, conflicting, instruction);
    expect(conflict.kind).toBe("code");
    if (conflict.kind !== "code") return;
    expect(conflict.heading?.text?.value).toBe("hello");
    expect(conflict.issues).toContain("artifact_hint_conflict");
  });

  it("normalizes language case only when the source binds the token to a code artifact", () => {
    const lowerCaseInstruction = "新增代码块markdown的标题一 hello";
    const lowerCaseSpec = resolve(lowerCaseInstruction);
    const modelHint = { kind: "code", language: "Markdown", headingLevel: 1, headingText: "hello" } as const;
    expect(parseIntentOutput(generatedPlan({ mode: "generate", task: "custom", artifact: modelHint }), lowerCaseInstruction, noCandidates))
      .toMatchObject({ content: { artifact: modelHint } });
    const modelCase = mergeArtifactPlanHint(lowerCaseSpec, modelHint, lowerCaseInstruction);
    expect(modelCase.issues).toEqual([]);

    const unrelated = "新增代码块，Markdown只是讨论主题。";
    const unrelatedSpec = resolve(unrelated);
    const unrelatedCase = mergeArtifactPlanHint(unrelatedSpec, { kind: "code", language: "MARKDOWN" }, unrelated);
    expect(unrelatedCase.issues).toContain("artifact_hint_conflict");
  });

  it("keeps a quoted language argument role-bound and preserves its exact source evidence", () => {
    const source = "新增代码块，语言为‘markdown’，包含一级标题‘hello’";
    const spec = resolve(source);
    const properties = generatedArtifactProperties(source);
    expect(properties.language).toEqual({ const: "markdown" });
    expect(properties.headingLevel).toEqual({ const: 1 });
    expect(properties.headingText).toEqual({ const: "hello" });

    const modelHint = { kind: "code", language: "Markdown", headingLevel: 1, headingText: "hello" } as const;
    expect(parseIntentOutput(generatedPlan({ mode: "generate", task: "custom", artifact: modelHint }), source, noCandidates))
      .toMatchObject({ content: { artifact: modelHint } });
    const merged = mergeArtifactPlanHint(spec, modelHint, source);
    expect(merged.issues).toEqual([]);
    expect(merged.kind).toBe("code");
    if (merged.kind !== "code") return;
    expect(merged.language?.value).toBe("markdown");
    expect(source.slice(merged.language?.evidence[0].from, merged.language?.evidence[0].to)).toBe("markdown");
    expect(merged.composition).toBe("partial");
  });

  it("treats a grounded but unrequested heading value as a conflict instead of ignoring it", () => {
    const source = "在文末新增 JSON 代码块，内容为 {\"ok\": true, \"count\": 3}。";
    const spec = resolve(source);
    const merged = mergeArtifactPlanHint(spec, { kind: "code", headingText: "ok" }, source);
    expect(merged.issues).toContain("artifact_hint_conflict");
  });

  it("can fill an unknown language only when the source binds it to the code block", () => {
    const source = "在文末创建一个 Kotlin 代码块，输出一个示例。";
    const spec = resolve(source);
    expect(spec.kind).toBe("code");
    if (spec.kind !== "code") return;
    expect(spec.language).toBeUndefined();
    const options = generatedArtifactProperties(source);
    expect(Object.keys(options).sort()).toEqual(["kind", "language"]);
    expect(options.language).toEqual({ const: "Kotlin" });
    const merged = mergeArtifactPlanHint(spec, { kind: "code", language: "Kotlin" }, source);
    expect(merged.kind).toBe("code");
    if (merged.kind !== "code") return;
    expect(merged.language?.value).toBe("kotlin");
    expect(source.slice(merged.language?.evidence[0].from, merged.language?.evidence[0].to)).toBe("Kotlin");
    expect(merged.composition).toBe("partial");

    const unrelated = "在文末创建代码块，并解释 Kotlin 语言的优缺点。";
    const unrelatedSpec = resolve(unrelated);
    expect(generatedArtifactProperties(unrelated)).toEqual({ kind: { const: "code" } });
    const rejected = mergeArtifactPlanHint(unrelatedSpec, { kind: "code", language: "Kotlin" }, unrelated);
    expect(rejected.kind).toBe("code");
    if (rejected.kind === "code") expect(rejected.language).toBeUndefined();
  });

  it("does not let hints change artifact kind, source dependency, or completeness", () => {
    const sourceInstruction = "严格根据原文新增两列表格，列名“水果”“价格”，列出文中所有水果及价格。";
    const sourceSpec = resolve(sourceInstruction);
    const sourceHint: IntentArtifactHint = { kind: "table", columns: ["水果", "价格"] };
    const merged = mergeArtifactPlanHint(sourceSpec, sourceHint, sourceInstruction);
    expect(merged.sourceDependent).toBe(true);
    expect(merged.composition).toBe("partial");

    const wrongKind = mergeArtifactPlanHint(sourceSpec, { kind: "code" }, sourceInstruction);
    expect(wrongKind.kind).toBe("table");
    expect(wrongKind.issues).toContain("artifact_hint_conflict");
  });

  it("teaches that the hint contains parameters rather than generated body text", () => {
    const prompt = buildIntentSystemPrompt(false, noCandidates, true);
    expect(prompt).toContain("artifact参数只填写schema列出的原句已知字段");
    expect(prompt).not.toContain('"headingLevel":1,"headingText":"hello"');
    expect(prompt).toContain("不是正文");
  });

  it("retains the single planning call 384-token output budget for plain and structured requests", () => {
    for (const [text, selected, creatingCode] of [["润色全文", true, false], [instruction, false, true]] as const) {
      expect(calculateLocalAiBudget(
        buildIntentPlanningPrompt(text, selected, noCandidates),
        buildIntentSystemPrompt(selected, noCandidates, creatingCode),
        384
      ).maxTokens).toBe(384);
    }
  });
});
