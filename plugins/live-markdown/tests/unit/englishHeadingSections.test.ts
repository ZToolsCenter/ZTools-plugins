import { describe, expect, it, vi } from "vitest";
import { buildAiTaskRequest } from "../../src/core/ai/aiTaskRequest";
import type { AiTaskRunnerOptions } from "../../src/core/ai/aiTaskRunner";
import { prepareArtifactFill } from "../../src/core/ai/artifactFill";
import { resolveArtifactHeadingList } from "../../src/core/ai/artifactHeadingListEvidence";
import { renderArtifact } from "../../src/core/ai/artifactRenderer";
import { resolveArtifactSpec } from "../../src/core/ai/artifactSpecFromInstruction";
import { resolveGenerationRequirements } from "../../src/core/ai/generationRequirements";
import { runPlannedAiTaskCore } from "../../src/core/ai/plannedTaskRunnerCore";
import type { AiDocumentSnapshot } from "../../src/types/aiEditing";

const source = "# Notes\n\nPrivate source remains untouched.";
const snapshot: AiDocumentSnapshot = { documentId: "english-heading-sections.md", revision: 1,
  content: source, selection: null, cursor: source.length, readOnly: false };
const request = (userPrompt: string) => buildAiTaskRequest({ source, selected: false, action: "custom", userPrompt,
  config: { provider: "local", activeRoleId: "general" } });

describe("unquoted English section heading lists", () => {
  it.each([
    ["Use headings 'Design, Delivery' and \"Risks, Rollback\" in that order.", ["Design, Delivery", "Risks, Rollback"]],
    ["Use headings “Design and Delivery”, “Risks and Rollback” in that order.", ["Design and Delivery", "Risks and Rollback"]]
  ])("preserves quoted heading labels through the real resolver chain: %s", (instruction, expected) => {
    const requirements = resolveGenerationRequirements(instruction, "custom");
    const spec = resolveArtifactSpec(instruction, requirements, { effect: "edit", operation: "insert" });
    const fill = prepareArtifactFill({ instruction, requirements, spec });

    expect(requirements.requiredHeadings.map(({ text }) => text)).toEqual(expected);
    for (const heading of requirements.requiredHeadings) {
      const evidence = heading.evidence[0];
      expect(instruction.slice(evidence.from, evidence.to)).toBe(evidence.raw);
      expect(evidence.raw).toContain(heading.text);
    }
    expect(fill).not.toBeNull();
    const schema = fill?.outputSchema as {
      properties?: { payload?: { properties?: { sections?: { properties?: Record<string, unknown> } } } };
    } | undefined;
    expect(Object.keys(schema?.properties?.payload?.properties?.sections?.properties ?? {})).toEqual(expected);
  });

  it.each([
    ["Use these headings in this order: 'Design, Delivery' and \"Risks, Rollback\".", ["Design, Delivery", "Risks, Rollback"], undefined],
    ["Use H2 headings in this order: Context, Follow-up.", ["Context", "Follow-up"], 2]
  ])("parses preposed order markers while preserving quoted labels and level evidence: %s", (instruction, expected, level) => {
    const parsed = resolveArtifactHeadingList(instruction);

    expect(parsed.recognized).toBe(true);
    expect(parsed.onlyHeadings).toBe(false);
    expect(parsed.headings.map(({ text, level: headingLevel }) => [text?.value, headingLevel?.value]))
      .toEqual(expected.map(label => [label, level]));
    for (const heading of parsed.headings) {
      const evidence = heading.text?.evidence[0];
      expect(evidence).toBeDefined();
      expect(instruction.slice(evidence!.from, evidence!.to)).toBe(evidence!.raw);
      expect(evidence!.raw).toContain(heading.text!.value);
    }
    if (level !== undefined) expect(parsed.headings[0].level?.evidence[0].raw).toBe("H2");
  });

  it.each([
    "Use headings Plan, Steps, Risks in that order, but do not include Risks.",
    "Using headings Plan, Steps, Risks in this order, but do not include Risks.",
    "Use these headings in this order: Plan, Steps, Risks. Do not include the Risks section.",
    "Add three headings: Plan, Steps, Risks. Do not include Risks."
  ])("does not prepare a fill schema when an ordered heading is explicitly excluded: %s", instruction => {
    const requirements = resolveGenerationRequirements(instruction, "custom");
    const spec = resolveArtifactSpec(instruction, requirements, { effect: "edit", operation: "insert" });

    expect(requirements.requiredHeadings).toEqual([]);
    expect(prepareArtifactFill({ instruction, requirements, spec })).toBeNull();
  });

  it("keeps a title when a same-named risk is excluded only as an unresolved factual claim", () => {
    const instruction = "Use headings Plan, Steps, Risks in that order; do not claim risks are resolved.";
    const requirements = resolveGenerationRequirements(instruction, "custom");
    const spec = resolveArtifactSpec(instruction, requirements, { effect: "edit", operation: "insert" });
    const fill = prepareArtifactFill({ instruction, requirements, spec });

    expect(requirements.requiredHeadings.map(({ text }) => text)).toEqual(["Plan", "Steps", "Risks"]);
    expect(fill).not.toBeNull();
  });

  it("retains an explicit H2 level on an in-order English heading list", () => {
    const instruction = "Use H2 headings Context, Follow-up in that order.";
    const requirements = resolveGenerationRequirements(instruction, "custom");
    const spec = resolveArtifactSpec(instruction, requirements, { effect: "edit", operation: "insert" });
    const fill = prepareArtifactFill({ instruction, requirements, spec });
    const headingList = resolveArtifactHeadingList(instruction);

    expect(headingList.headings.map(({ level }) => level?.value)).toEqual([2, 2]);
    expect(headingList.headings[0].level?.evidence[0].raw).toBe("H2");
    expect(spec.kind).toBe("heading");
    expect(fill).not.toBeNull();
  });

  it("routes a draft with these headings through the schema-bound sections adapter", async () => {
    const instruction = "At the end, write a release rehearsal draft with these headings in order: Goal, Steps, Risks. Include executable steps and concrete risk scenarios; frame it as a proposal, not a completed event.";
    const invoke = vi.fn<AiTaskRunnerOptions["invoke"]>(async (_prompt, _system, _tokens, _emit, schema) => {
      expect(schema).toMatchObject({ properties: { payload: { properties: { sections: {
        properties: { Goal: { type: "string" }, Steps: { type: "string" }, Risks: { type: "string" } }
      } } } } });
      expect(JSON.stringify(schema)).not.toContain("Private source");
      return JSON.stringify({ payload: { sections: {
        Goal: "Propose a rehearsal outcome and how to observe it.",
        Steps: "Run the checklist in a test environment, then record each verification point.",
        Risks: "A failed check could delay sign-off; pause the release and investigate the cause."
      } } });
    });

    const result = await runPlannedAiTaskCore(request(instruction), snapshot,
      { invoke, isCurrent: () => true, abortCurrent: vi.fn() });

    expect(invoke).toHaveBeenCalledTimes(1);
    expect(result.proposal?.patch?.insertText).toBe(
      "\n\n## Goal\n\nPropose a rehearsal outcome and how to observe it.\n\n## Steps\n\nRun the checklist in a test environment, then record each verification point.\n\n## Risks\n\nA failed check could delay sign-off; pause the release and investigate the cause."
    );
  });

  it("keeps body text after the heading list on the generated sections path", () => {
    const parsed = resolveArtifactHeadingList("Write a draft with these headings in order: Goal, Risks. Add one proposal paragraph under each heading.");
    expect(parsed).toMatchObject({ recognized: true, onlyHeadings: false,
      headings: [{ text: { value: "Goal" } }, { text: { value: "Risks" } }] });
  });

  it.each([
    ["在文末新增 3 个二级标题：背景、方案、风险。", ["背景", "方案", "风险"], 2],
    ["Insert three H2 headings: Background, Plan, Risks.", ["Background", "Plan", "Risks"], 2],
    ["Add three headings: Background, Plan, Risks.", ["Background", "Plan", "Risks"], undefined]
  ])("renders direct counted heading creation without preparing section bodies: %s", (instruction, expected, level) => {
    const parsed = resolveArtifactHeadingList(instruction);
    const requirements = resolveGenerationRequirements(instruction, "custom");
    const spec = resolveArtifactSpec(instruction, requirements, { effect: "edit", operation: "insert" });

    expect(parsed).toMatchObject({ recognized: true, onlyHeadings: true });
    expect(parsed.headings.map(({ text, level: headingLevel }) => [text?.value, headingLevel?.value]))
      .toEqual(expected.map(label => [label, level]));
    expect(requirements.requiredHeadings.map(({ text }) => text)).toEqual(expected);
    for (const heading of requirements.requiredHeadings) {
      const evidence = heading.evidence[0];
      expect(instruction.slice(evidence.from, evidence.to)).toBe(evidence.raw);
      expect(evidence.raw).toBe(heading.text);
    }
    expect(spec.kind).toBe("heading");
    expect(spec.composition).toBe("complete");
    if (spec.kind === "heading") {
      expect(renderArtifact(spec)).toBe(expected.map(label => `## ${label}`).join("\n\n"));
    }
    expect(prepareArtifactFill({ instruction, requirements, spec })).toBeNull();
  });

  it.each([
    ["Add three headings: Background, Plan, Risks. Add one paragraph under each.", ["Background", "Plan", "Risks"]],
    ["Add three headings: Background, Plan, Risks. Headings only. Add one paragraph under each.", ["Background", "Plan", "Risks"]],
    ["At the end, write a plan for software release rehearsal. Add three headings: Preparation, Steps, Risks.", ["Preparation", "Steps", "Risks"]]
  ])("does not let direct-heading or only-headings wording swallow extra prose: %s", (instruction, expected) => {
    const parsed = resolveArtifactHeadingList(instruction);
    const requirements = resolveGenerationRequirements(instruction, "custom");
    const spec = resolveArtifactSpec(instruction, requirements, { effect: "edit", operation: "insert" });
    const fill = prepareArtifactFill({ instruction, requirements, spec });

    expect(parsed.recognized).toBe(true);
    expect(parsed.onlyHeadings).toBe(false);
    expect(spec.kind).toBe("none");
    expect(fill).not.toBeNull();
    const schema = fill?.outputSchema as {
      properties?: { payload?: { properties?: { sections?: { properties?: Record<string, unknown> } } } };
    } | undefined;
    expect(Object.keys(schema?.properties?.payload?.properties?.sections?.properties ?? {}))
      .toEqual(expected);
  });

  it.each([
    "If the maintenance window permits, add three headings: Background, Plan, Risks.",
    "如果维护窗口获批，在文末新增 3 个二级标题：背景、方案、风险。",
    "Do not add three headings: Background, Plan, Risks.",
    "Should I create three headings: Background, Plan, Risks?",
    "Example: “Add three headings: Background, Plan, Risks.”"
  ])("does not treat conditional, negative, questioned or quoted counted headings as direct title output: %s", instruction => {
    const parsed = resolveArtifactHeadingList(instruction);

    expect(parsed.recognized).toBe(false);
    expect(parsed.onlyHeadings).toBe(false);
  });

  it.each([
    "At the end, write a plan for software release rehearsal. Use these headings in that order: Preparation, Steps, Risks. Metadata labels are the source and target engines.",
    "At the end, write a Chinese draft about 数据库恢复演练 with these headings in order: Preparation, Steps, Risks."
  ])("routes a draft with a preposed order marker through the body sections schema: %s", instruction => {
    const parsed = resolveArtifactHeadingList(instruction);
    const requirements = resolveGenerationRequirements(instruction, "custom");
    const spec = resolveArtifactSpec(instruction, requirements, { effect: "edit", operation: "insert" });
    const fill = prepareArtifactFill({ instruction, requirements, spec });

    expect(parsed.recognized).toBe(true);
    expect(parsed.headings.map(({ text }) => text?.value)).toEqual(["Preparation", "Steps", "Risks"]);
    expect(parsed.onlyHeadings).toBe(false);
    for (const heading of requirements.requiredHeadings) {
      const evidence = heading.evidence[0];
      expect(instruction.slice(evidence.from, evidence.to)).toBe(evidence.raw);
      expect(evidence.raw).toBe(heading.text);
    }
    expect(requirements.requiredHeadings.map(({ text }) => text)).toEqual(["Preparation", "Steps", "Risks"]);
    expect(spec.kind).toBe("none");
    expect(fill).not.toBeNull();
    const schema = fill?.outputSchema as {
      properties?: { payload?: { properties?: { sections?: {
        properties?: Record<string, { type?: string; minLength?: number }>;
        required?: string[];
      } } } };
    } | undefined;
    const sections = schema?.properties?.payload?.properties?.sections;
    expect(Object.keys(sections?.properties ?? {}))
      .toEqual(["Preparation", "Steps", "Risks"]);
    expect(sections?.required).toEqual(["Preparation", "Steps", "Risks"]);
    expect(Object.values(sections?.properties ?? {}).every(({ type, minLength }) => type === "string" && minLength === 1))
      .toBe(true);
  });

  it.each([
    "Use headings Goal, Steps, Risks in that order. Headings only.",
    "Use headings Goal, Steps, Risks in that order. Only headings.",
    "Use headings Goal, Steps, Risks in that order. 只写标题。",
    "Use H2 headings Goal, Steps, Risks in that order. Headings only.",
    "At the end, write a plan for software release rehearsal. Use these headings in that order: Goal, Steps, Risks. Headings only."
  ])("keeps the ordered heading request title-only when the suffix says headings only: %s", instruction => {
    const requirements = resolveGenerationRequirements(instruction, "custom");
    const spec = resolveArtifactSpec(instruction, requirements, { effect: "edit", operation: "insert" });
    const headingList = resolveArtifactHeadingList(instruction);

    expect(requirements.requiredHeadings.map(({ text }) => text)).toEqual(["Goal", "Steps", "Risks"]);
    expect(headingList).toMatchObject({ recognized: true, onlyHeadings: true });
    expect(spec.kind).toBe("heading");
    expect(spec.composition).toBe("complete");
    if (spec.kind === "heading") {
      expect(spec.headings?.map(({ level }) => level?.value)).toEqual(
        instruction.includes("H2") ? [2, 2, 2] : [undefined, undefined, undefined]);
      expect(renderArtifact(spec)).toBe("## Goal\n\n## Steps\n\n## Risks");
    }
    expect(prepareArtifactFill({ instruction, requirements, spec })).toBeNull();
  });

  it("uses section bodies when an ordered heading request asks for a paragraph under each", () => {
    const instruction = "Use headings Goal, Steps, Risks in that order. Add one proposal paragraph under each heading.";
    const requirements = resolveGenerationRequirements(instruction, "custom");
    const spec = resolveArtifactSpec(instruction, requirements, { effect: "edit", operation: "insert" });
    const fill = prepareArtifactFill({ instruction, requirements, spec });

    expect(requirements.requiredHeadings.map(({ text }) => text)).toEqual(["Goal", "Steps", "Risks"]);
    expect(resolveArtifactHeadingList(instruction).onlyHeadings).toBe(false);
    expect(spec.composition).not.toBe("complete");
    expect(fill).not.toBeNull();
    const schema = fill?.outputSchema as {
      properties?: { payload?: { properties?: { sections?: { properties?: Record<string, unknown> } } } };
    } | undefined;
    expect(Object.keys(schema?.properties?.payload?.properties?.sections?.properties ?? {}))
      .toEqual(["Goal", "Steps", "Risks"]);
  });

  it("does not let a quoted only-headings example change an ordered body request", () => {
    const instruction = "Use headings Goal, Steps, Risks in that order. Example: “Headings only.”";
    const requirements = resolveGenerationRequirements(instruction, "custom");
    const spec = resolveArtifactSpec(instruction, requirements, { effect: "edit", operation: "insert" });

    expect(resolveArtifactHeadingList(instruction)).toMatchObject({ recognized: true, onlyHeadings: false });
    expect(spec.kind).toBe("none");
    expect(prepareArtifactFill({ instruction, requirements, spec })).not.toBeNull();
  });

  it.each([
    "How do I write a draft with these headings in order: Goal, Steps, Risks?",
    "Do not add these headings in order: Goal, Steps, Risks.",
    "Explain the phrase `write with these headings in order: Goal, Steps, Risks`.",
    "Example: `write with these headings in order: Goal, Steps, Risks`."
  ])("does not compile a question, negative, or mentioned syntax as a heading list: %s", instruction => {
    expect(resolveArtifactHeadingList(instruction).recognized).toBe(false);
  });
});
