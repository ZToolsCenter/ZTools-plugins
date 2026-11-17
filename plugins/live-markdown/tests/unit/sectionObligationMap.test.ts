import { describe, expect, it } from "vitest";
import { resolveGenerationRequirements } from "../../src/core/ai/generationRequirements";
import { buildSectionObligationMap } from "../../src/core/ai/sectionObligationMap";

function instructionWithRequirements(requirements: string): string {
  return `✨使用 Goal、Steps、Risks、Acceptance Criteria 标题组织方案。${requirements}`;
}

function mapFor(instruction: string) {
  const headings = resolveGenerationRequirements(instruction, "custom").requiredHeadings;
  return { headings, result: buildSectionObligationMap(instruction, headings) };
}

function assertExactEvidence(instruction: string, result: NonNullable<ReturnType<typeof buildSectionObligationMap>>) {
  const allSpans = [
    ...result.sections.flatMap(section => [...section.headingEvidence, ...section.requirements]),
    ...result.shared
  ];
  expect(allSpans.length).toBeGreaterThan(0);
  for (const span of allSpans) {
    expect(Number.isSafeInteger(span.from)).toBe(true);
    expect(Number.isSafeInteger(span.to)).toBe(true);
    expect(instruction.slice(span.from, span.to)).toBe(span.raw);
  }
}

describe("buildSectionObligationMap", () => {
  it("maps only explicit Chinese section obligations and preserves source-exact UTF-16 evidence", () => {
    const instruction = instructionWithRequirements(
      "Steps: 每个步骤给出动作和检查点。Risks: 每个风险说明触发条件与应对。Acceptance Criteria: 验收标准必须可验证。"
    );
    const { headings, result } = mapFor(instruction);
    expect(headings.map(item => item.text)).toEqual(["Goal", "Steps", "Risks", "Acceptance Criteria"]);
    expect(result).toBeDefined();
    expect(result?.sections.map(section => section.heading)).toEqual(headings.map(item => item.text));
    expect(result?.sections[0].requirements).toEqual([]);
    expect(result?.sections[1].requirements.map(span => span.raw)).toEqual(["Steps: 每个步骤给出动作和检查点。"]);
    expect(result?.sections[2].requirements.map(span => span.raw)).toEqual(["Risks: 每个风险说明触发条件与应对。"]);
    expect(result?.sections[3].requirements.map(span => span.raw)).toEqual(["Acceptance Criteria: 验收标准必须可验证。"]);
    const firstEvidence = result?.sections[0].headingEvidence[0];
    const lastEvidence = result?.sections.at(-1)?.headingEvidence[0];
    expect(firstEvidence?.from).toBe(instruction.indexOf("Goal"));
    expect(lastEvidence?.to).toBe(instruction.indexOf("Acceptance Criteria") + "Acceptance Criteria".length);
    assertExactEvidence(instruction, result!);
  });

  it("maps positive English requirements without generating new obligation text", () => {
    const instruction = instructionWithRequirements(
      "Steps: Include executable steps. Risks: Include concrete risk scenarios. Acceptance Criteria: Make acceptance criteria verifiable."
    );
    const { result } = mapFor(instruction);
    expect(result).toBeDefined();
    expect(result?.sections.find(section => section.heading === "Steps")?.requirements.map(span => span.raw))
      .toEqual(["Steps: Include executable steps. "]);
    expect(result?.sections.find(section => section.heading === "Risks")?.requirements.map(span => span.raw))
      .toEqual(["Risks: Include concrete risk scenarios. "]);
    expect(result?.sections.find(section => section.heading === "Acceptance Criteria")?.requirements.map(span => span.raw))
      .toEqual(["Acceptance Criteria: Make acceptance criteria verifiable."]);
    assertExactEvidence(instruction, result!);
  });

  it.each([
    ["conditional", "Steps: 如果用户选择详细模式，每个步骤给出动作和检查点。"],
    ["negative", "Steps: 不需要每个步骤给出动作和检查点。"],
    ["question", "Steps: 每个步骤给出动作和检查点吗？"],
    ["quoted", "Steps: “每个步骤给出动作和检查点。”"],
    ["explanatory", "Steps: 请解释为什么每个步骤给出动作和检查点。"]
  ])("keeps %s language in shared context instead of section obligations", (_label, clause) => {
    const instruction = instructionWithRequirements(clause);
    const { result } = mapFor(instruction);
    expect(result).toBeDefined();
    expect(result?.sections.find(section => section.heading === "Steps")?.requirements).toEqual([]);
    expect(result?.shared.some(span => span.raw.includes(clause.slice(clause.indexOf(":") + 2)))).toBe(true);
    assertExactEvidence(instruction, result!);
  });

  it("leaves unknown and unrelated prose shared, including source-only text", () => {
    const instruction = instructionWithRequirements(
      "Goal: 说明目标和未提供的参数，不要自行假设。Steps: Include executable steps."
    );
    const { result } = mapFor(instruction);
    expect(result).toBeDefined();
    expect(result?.shared.some(span => span.raw.includes("未提供的参数"))).toBe(true);
    expect(result?.shared.some(span => span.raw.startsWith("Goal:"))).toBe(true);
    expect(result?.sections.find(section => section.heading === "Steps")?.requirements.map(span => span.raw))
      .toEqual(["Steps: Include executable steps."]);
  });

  it("fails closed on malformed evidence, unknown options, duplicate headings and excessive input bytes", () => {
    const instruction = instructionWithRequirements("Steps: Include executable steps.");
    const headings = resolveGenerationRequirements(instruction, "custom").requiredHeadings;
    expect(buildSectionObligationMap({ instruction, headings } as unknown as string, headings)).toBeUndefined();
    expect(buildSectionObligationMap(instruction, headings.map((item, index) => index === 0
      ? { ...item, evidence: [{ ...item.evidence[0], from: -1 }] } : item))).toBeUndefined();
    expect(buildSectionObligationMap(instruction, [...headings, { ...headings[1], text: "steps" }])).toBeUndefined();
    expect(buildSectionObligationMap("x".repeat(20_000), headings)).toBeUndefined();
    expect(buildSectionObligationMap(instruction, [])).toBeUndefined();
  });
});
