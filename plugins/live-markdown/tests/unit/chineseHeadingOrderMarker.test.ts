import { describe, expect, it } from "vitest";
import { prepareArtifactFill } from "../../src/core/ai/artifactFill";
import { resolveArtifactHeadingList } from "../../src/core/ai/artifactHeadingListEvidence";
import { resolveArtifactSpec } from "../../src/core/ai/artifactSpecFromInstruction";
import { resolveGenerationRequirements } from "../../src/core/ai/generationRequirements";

const directInstruction = "在文末新增三个二级标题，依次为：背景、方案、风险。";
const expected = ["背景", "方案", "风险"];

function resolve(instruction: string) {
  const requirements = resolveGenerationRequirements(instruction, "custom");
  const spec = resolveArtifactSpec(instruction, requirements, { effect: "edit", operation: "insert" });
  const fill = prepareArtifactFill({ instruction, requirements, spec });
  return { requirements, spec, fill };
}

function expectHeadingEvidence(instruction: string, labels: string[]) {
  const headings = resolveArtifactHeadingList(instruction).headings;
  expect(headings.map(({ text }) => text?.value)).toEqual(labels);
  for (const [index, heading] of headings.entries()) {
    const evidence = heading.text?.evidence[0];
    expect(evidence).toBeDefined();
    expect(instruction.slice(evidence!.from, evidence!.to)).toBe(evidence!.raw);
    expect(evidence!.raw).toContain(labels[index]);
  }
  return headings;
}

describe("Chinese counted heading lists with an order marker", () => {
  it("parses the reported Chinese numeral case as complete title-only output", () => {
    const parsed = resolveArtifactHeadingList(directInstruction);
    const { requirements, spec, fill } = resolve(directInstruction);

    expect(parsed).toMatchObject({ recognized: true, onlyHeadings: true, declaredCount: { value: 3 }, issues: [] });
    expect(expectHeadingEvidence(directInstruction, expected).map(({ level }) => level?.value)).toEqual([2, 2, 2]);
    expect(requirements.requiredHeadings.map(({ text }) => text)).toEqual(expected);
    expect(spec).toMatchObject({ kind: "heading", composition: "complete", headings: expected.map(text => ({ text: { value: text } })) });
    expect(fill).toBeNull();
  });

  it("accepts an explicit order connective after an Arabic count without changing the level or count", () => {
    const instruction = "在文末新增 3 个二级标题，依次是：背景、方案、风险。";
    const parsed = resolveArtifactHeadingList(instruction);
    const { requirements, spec, fill } = resolve(instruction);

    expect(parsed).toMatchObject({ recognized: true, onlyHeadings: true, declaredCount: { value: 3 }, issues: [] });
    expect(expectHeadingEvidence(instruction, expected).map(({ level }) => level?.value)).toEqual([2, 2, 2]);
    expect(requirements.requiredHeadings.map(({ text }) => text)).toEqual(expected);
    expect(spec.composition).toBe("complete");
    expect(fill).toBeNull();
  });

  it("keeps body-writing requests on the multi-section fill path", () => {
    const instruction = "在文末起草恢复演练计划，新增三个二级标题，依次为：背景、方案、风险。每节写一段建议。";
    const parsed = resolveArtifactHeadingList(instruction);
    const { requirements, spec, fill } = resolve(instruction);
    const schema = fill?.outputSchema as {
      properties?: { payload?: { properties?: { sections?: { properties?: Record<string, unknown> } } } };
    } | undefined;

    expect(parsed).toMatchObject({ recognized: true, onlyHeadings: false, issues: [] });
    expect(requirements.requiredHeadings.map(({ text }) => text)).toEqual(expected);
    expect(spec.composition).toBe("partial");
    expect(Object.keys(schema?.properties?.payload?.properties?.sections?.properties ?? {})).toEqual(expected);
  });

  it("preserves quoted separators inside heading labels", () => {
    const instruction = "在文末新增三个二级标题，依次为：“背景、范围”、“风险和缓解”、方案。";
    const parsed = resolveArtifactHeadingList(instruction);

    expect(parsed).toMatchObject({ recognized: true, onlyHeadings: true, declaredCount: { value: 3 }, issues: [] });
    expect(expectHeadingEvidence(instruction, ["背景、范围", "风险和缓解", "方案"])).toHaveLength(3);
  });

  it.each([
    "在文末新增三个二级标题，备注：背景、方案、风险。",
    "在文末新增三个二级标题，依次说明：背景、方案、风险。"
  ])("does not treat a bare comma or free-form phrase as a list cue: %s", instruction => {
    expect(resolveArtifactHeadingList(instruction).recognized).toBe(false);
    expect(resolveGenerationRequirements(instruction, "custom").requiredHeadings).toEqual([]);
  });

  it("keeps an explicit only-headings suffix on the title-only path", () => {
    const instruction = "在文末新增三个二级标题，依次为：背景、方案、风险。只写标题。";
    const parsed = resolveArtifactHeadingList(instruction);
    const { spec, fill } = resolve(instruction);

    expect(parsed).toMatchObject({ recognized: true, onlyHeadings: true, declaredCount: { value: 3 }, issues: [] });
    expect(spec).toMatchObject({ kind: "heading", composition: "complete" });
    expect(fill).toBeNull();
  });

  it.each([
    "示例：“在文末新增三个二级标题，依次为：背景、方案、风险。”",
    "不要在文末新增三个二级标题，依次为：背景、方案、风险。",
    "如果需要，在文末新增三个二级标题，依次为：背景、方案、风险。"
  ])("does not promote a quoted example, negated request, or conditional mention: %s", instruction => {
    const parsed = resolveArtifactHeadingList(instruction);
    expect(parsed).toMatchObject({ recognized: false, onlyHeadings: false, headings: [] });
    expect(resolveGenerationRequirements(instruction, "custom").requiredHeadings).toEqual([]);
  });

  it("retains a heading-count mismatch instead of completing a short list", () => {
    const instruction = "在文末新增三个二级标题，依次为：背景、方案。";
    const parsed = resolveArtifactHeadingList(instruction);
    const { spec, fill } = resolve(instruction);

    expect(parsed).toMatchObject({ recognized: true, declaredCount: { value: 3 }, issues: ["heading_count_mismatch"] });
    expect(parsed.headings.map(({ text }) => text?.value)).toEqual(["背景", "方案"]);
    expect(spec.issues).toContain("heading_count_mismatch");
    expect(fill).toBeNull();
  });

  it("retains the immediate-colon Arabic-count form", () => {
    const instruction = "在文末新增 3 个二级标题：背景、方案、风险。";
    const parsed = resolveArtifactHeadingList(instruction);

    expect(parsed).toMatchObject({ recognized: true, onlyHeadings: true, declaredCount: { value: 3 }, issues: [] });
    expect(expectHeadingEvidence(instruction, expected)).toHaveLength(3);
  });
});
