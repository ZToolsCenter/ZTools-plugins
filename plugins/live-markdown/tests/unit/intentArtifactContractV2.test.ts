import { describe, expect, it } from "vitest";
import { resolveArtifactSpec } from "../../src/core/ai/artifactSpecFromInstruction";
import { validatePlannedIntent, PlanValidationError } from "../../src/core/ai/intentPlanValidation";
import { deriveInstructionContract } from "../../src/core/ai/instructionConstraints";
import { buildAiIntentCandidates } from "../../src/core/ai/intentContext";
import { isCompleteLiteralArtifact, isPartialArtifactPayload, requestsStructuredArtifact } from "../../src/core/ai/intentArtifactContent";
import { buildIntentOutputSchema } from "../../src/core/ai/intentOutputSchema";
import { buildIntentSystemPrompt } from "../../src/core/ai/intentPrompts";
import { resolveGenerationRequirements } from "../../src/core/ai/generationRequirements";
import type { ArtifactSpec } from "../../src/core/ai/artifactSpec";
import type { ValidatedIntent } from "../../src/core/ai/intentTypes";

const source = "# 说明\n\n保留原文，不把计划文字写入文稿。";

interface SchemaShape {
  const?: string;
  enum?: string[];
  anyOf?: SchemaShape[];
  properties?: Record<string, SchemaShape>;
}

function artifactSpec(instruction: string): ArtifactSpec {
  return resolveArtifactSpec(instruction, resolveGenerationRequirements(instruction), { effect: "edit", operation: "insert" });
}

function schemaFor(instruction: string) {
  const contract = deriveInstructionContract(instruction, { hasSelection: false, hasCursor: true });
  const candidates = buildAiIntentCandidates(instruction, source, contract);
  const schema = buildIntentOutputSchema(instruction, false, candidates, contract) as { anyOf: SchemaShape[] };
  const insertContent = schema.anyOf
    .filter(({ properties }) => properties?.kind?.const === "edit" && properties.operation?.const === "insert")
    .map(({ properties }) => properties!.content);
  return { contract, candidates, schema, insertContent };
}

function literalModes(content: SchemaShape[]) {
  return content.flatMap(({ anyOf = [] }) => anyOf
    .filter(({ properties }) => properties?.mode?.const === "literal")
    .map(({ properties }) => properties));
}

describe("structured artifact literal contract", () => {
  it.each([
    ["在文末新增一个 Python 代码块", "plainhello"],
    ["在文末新增 Markdown 表格，列名为“水果”“价格”", "水果"],
    ["在文末新增 LaTeX 显示公式块，用 $$ 包裹公式", "LaTeX"],
    ["在文末新增 Mermaid 流程图", "开始"],
    ["在文末新增二级标题：hello", "hello"],
    ["在文末新增两项清单", "水果"]
  ])("recognizes partial parameter text as incomplete for %s", (instruction, partial) => {
    expect(requestsStructuredArtifact(instruction)).toBe(true);
    expect(isPartialArtifactPayload(instruction, partial)).toBe(true);
    expect(isCompleteLiteralArtifact(artifactSpec(instruction), partial)).toBe(false);
  });

  it.each([
    ["在文末新增 Markdown 表格，列名为“水果”“价格”", "水果"],
    ["在文末新增显示公式块，用 $$ 包裹公式“LaTeX”", "LaTeX"],
    ["在文末新增 Python 代码块，函数名为“plainhello”", "plainhello"]
  ])("removes partial artifact fields from the insert literal schema: %s", (instruction, partial) => {
    const { candidates, insertContent } = schemaFor(instruction);
    const serialized = JSON.stringify(insertContent);

    expect(candidates.literals.some(({ text }) => text === partial)).toBe(true);
    // Parameters may be carried by a generated artifact hint, never as a whole literal body.
    expect(JSON.stringify(literalModes(insertContent))).not.toContain(partial);
    expect(literalModes(insertContent)).toHaveLength(0);
    expect(serialized).toContain('"const":"generate"');
  });

  it("allows complete table, display formula, and unlabeled code artifacts as literal candidates", () => {
    const examples: Array<[string, string]> = [
      [
        "在文末原样新增 Markdown 表格：“| 名称 | 状态 |\n|---|---|\n| 编译 | 通过 |”",
        "| 名称 | 状态 |\n|---|---|\n| 编译 | 通过 |"
      ],
      [
        "在文末原样新增 LaTeX 显示公式块：“$$\nx^2 + y^2 = z^2\n$$”",
        "$$\nx^2 + y^2 = z^2\n$$"
      ],
      [
        "在文末原样新增代码块：“```\nconst hello = 'world';\n```”",
        "```\nconst hello = 'world';\n```"
      ]
    ];

    for (const [instruction, complete] of examples) {
      const spec = artifactSpec(instruction);
      const { candidates, insertContent } = schemaFor(instruction);
      expect(requestsStructuredArtifact(instruction)).toBe(true);
      expect(isCompleteLiteralArtifact(spec, complete)).toBe(true);
      expect(isPartialArtifactPayload(instruction, complete)).toBe(false);
      expect(candidates.literals.some(({ text }) => text === complete)).toBe(true);
      const literalId = candidates.literals.find(({ text }) => text === complete)?.id;
      expect(JSON.stringify(literalModes(insertContent))).toContain("literalId");
      expect(JSON.stringify(literalModes(insertContent))).toContain(literalId);
    }
  });

  it("continues to allow ordinary literal text and does not classify artifact questions as edits", () => {
    const ordinary = "在文末新增hello";
    expect(requestsStructuredArtifact(ordinary)).toBe(false);
    expect(isPartialArtifactPayload(ordinary, "hello")).toBe(false);
    expect(literalModes(schemaFor(ordinary).insertContent).length).toBeGreaterThan(0);

    const question = "请解释“在文末新增表格”是什么意思，不要修改文稿。";
    const { contract, schema } = schemaFor(question);
    expect(requestsStructuredArtifact(question)).toBe(false);
    expect(contract.effect).toMatchObject({ state: "explicit", value: "answer" });
    expect(schema.anyOf.some(({ properties }) => properties?.kind?.const === "answer")).toBe(true);
  });

  it("rejects an incomplete structured literal plan instead of rewriting it as generation", () => {
    const instruction = "在文末新增 Markdown 表格，列名为“水果”“价格”";
    const contract = deriveInstructionContract(instruction, { hasSelection: false, hasCursor: true });
    const candidates = buildAiIntentCandidates(instruction, source, contract);
    const invalid: ValidatedIntent = {
      version: 1, kind: "edit", operation: "insert", target: "document_end", layout: "block",
      content: { mode: "literal", text: "水果" }
    };
    const snapshot = { documentId: "artifact.md", revision: 1, content: source, selection: null, cursor: source.length, readOnly: false };

    expect(() => validatePlannedIntent(invalid, contract, snapshot, candidates, instruction))
      .toThrow(expect.objectContaining({ code: "artifact_content_mismatch" } satisfies Partial<PlanValidationError>));
    expect(invalid.content.mode).toBe("literal");
  });

  it("teaches the planner that structure fields are parameters, not complete artifacts", () => {
    const prompt = buildIntentSystemPrompt(false);

    expect(prompt).toContain("结构产物");
    expect(prompt).toContain("列名");
    expect(prompt).toContain("完整产物");
    expect(prompt).toContain("generate");
  });
});
