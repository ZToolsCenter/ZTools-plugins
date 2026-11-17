import { describe, expect, it } from "vitest";
import { resolveArtifactHeadingList } from "../../src/core/ai/artifactHeadingListEvidence";
import { resolveGenerationRequirements } from "../../src/core/ai/generationRequirements";

const holdoutInstruction = "Append a storage capacity expansion rehearsal draft with headings Objective, Steps, Risks, Acceptance criteria in this order. Each step needs an executable action and observable check; each risk needs a trigger and response. Make acceptance criteria verifiable. The platform, current free space, approval status and outage window are unspecified. Do not invent them or claim the rehearsal has occurred.";
const expectedHeadings = ["Objective", "Steps", "Risks", "Acceptance criteria"];

function resolvedHeadings(instruction: string): string[] {
  return resolveGenerationRequirements(instruction, "custom").requiredHeadings.map(({ text }) => text);
}

describe("English natural-language ordered heading lists", () => {
  it("resolves the real storage-rehearsal instruction and binds exact heading spans", () => {
    const headings = resolveGenerationRequirements(holdoutInstruction, "custom").requiredHeadings;
    expect(headings.map(({ text }) => text)).toEqual(expectedHeadings);
    for (const [index, heading] of headings.entries()) {
      expect(heading.evidence).toHaveLength(1);
      const evidence = heading.evidence[0];
      expect(evidence.from).toBe(holdoutInstruction.indexOf(expectedHeadings[index]));
      expect(evidence.to).toBe(evidence.from + expectedHeadings[index].length);
      expect(evidence.raw).toBe(expectedHeadings[index]);
      expect(holdoutInstruction.slice(evidence.from, evidence.to)).toBe(evidence.raw);
    }
  });

  it("preserves the existing in-order fallback and explicit colon-list behavior", () => {
    expect(resolvedHeadings("Append a storage rehearsal draft with headings Objective, Steps, Risks in order."))
      .toEqual(["Objective", "Steps", "Risks"]);

    const explicit = "Append exactly four H2 headings in order: Objective, Steps, Risks, Acceptance criteria. Headings only.";
    expect(resolveArtifactHeadingList(explicit).recognized).toBe(true);
    expect(resolvedHeadings(explicit)).toEqual(expectedHeadings);
  });

  it.each([
    ["Use headings Context, Constraints, Verification, Follow-up in that order.", ["Context", "Constraints", "Verification", "Follow-up"]],
    ["Using headings Inputs, Signals, Checks in this order, prepare a short review.", ["Inputs", "Signals", "Checks"]],
    ["With headings Scope, Risks, Actions in that order, prepare a short review.", ["Scope", "Risks", "Actions"]]
  ])("extracts imperative and participial heading lists with exact evidence spans: %s", (instruction, expected) => {
    const headings = resolveGenerationRequirements(instruction, "custom").requiredHeadings;

    expect(headings.map(({ text }) => text)).toEqual(expected);
    for (const [index, heading] of headings.entries()) {
      const evidence = heading.evidence[0];
      expect(evidence.from).toBe(instruction.indexOf(expected[index]));
      expect(evidence.to).toBe(evidence.from + expected[index].length);
      expect(evidence.raw).toBe(expected[index]);
      expect(instruction.slice(evidence.from, evidence.to)).toBe(expected[index]);
    }
  });

  it.each([
    "Can you create a draft with headings Goal, Steps, Risks in this order?",
    "Could you please write a draft with headings Goal, Steps, Risks in this order?",
    "Would you draft a document with headings Goal, Steps, Risks in this order?",
    "Will you prepare a document with headings Goal, Steps, Risks in this order?"
  ])("treats an explicit sentence-initial polite creation question as a request: %s", instruction => {
    const headings = resolveGenerationRequirements(instruction, "custom").requiredHeadings;
    expect(headings.map(({ text }) => text)).toEqual(["Goal", "Steps", "Risks"]);
    for (const heading of headings) {
      const evidence = heading.evidence[0];
      expect(evidence.raw).toBe(heading.text);
      expect(instruction.slice(evidence.from, evidence.to)).toBe(heading.text);
    }
  });

  it.each([
    ["Could you write a draft with headings Goal, Steps, No-go criteria in this order?", ["Goal", "Steps", "No-go criteria"]],
    ["Could you write a draft with headings Goal, Steps, When to rollback in this order?", ["Goal", "Steps", "When to rollback"]]
  ])("does not treat words inside heading names as instruction controls: %s", (instruction, expected) => {
    const headings = resolveGenerationRequirements(instruction, "custom").requiredHeadings;
    expect(headings.map(({ text }) => text)).toEqual(expected);
    for (const heading of headings) {
      const evidence = heading.evidence[0];
      expect(evidence.from).toBe(instruction.indexOf(heading.text));
      expect(evidence.raw).toBe(heading.text);
      expect(instruction.slice(evidence.from, evidence.to)).toBe(heading.text);
    }
  });

  it.each([
    "Do not append a rehearsal draft with headings Objective, Steps, Risks in this order.",
    "Do not use headings Context, Constraints, Verification in that order.",
    "Should a draft use headings Context, Constraints, Verification in that order?",
    "Example: `Use headings Context, Constraints, Verification in that order.`",
    "Should I append a rehearsal draft with headings Objective, Steps, Risks in this order?",
    "Should a draft use headings Goal, Steps, Risks in this order?",
    "Are these headings Goal, Steps, Risks in this order?",
    "Could you please not write a draft with headings Goal, Steps, Risks in this order?",
    "Could you please write a draft with headings Goal, Steps, Risks in this order if the outage window is approved?",
    "Could you please write a draft with headings Goal, Steps, Risks in this order, but do not include the Risks section?",
    "If the maintenance window permits, could you write a draft with headings Goal, Steps, No-go criteria in this order?",
    "Could you write a draft with headings Goal, Steps, No-go criteria in this order if the maintenance window permits?",
    "Do not write a draft with headings Goal, Steps, No-go criteria in this order.",
    "If the outage window is approved, append a rehearsal draft with headings Objective, Steps, Risks in this order.",
    "Append a rehearsal draft with headings Objective, Steps, Risks. Keep them in this order.",
    "Example: `Could you please write a draft with headings Goal, Steps, Risks in this order?`",
    "Example: “Use headings Context, Constraints, Verification in that order.”",
    "Do not use these headings in this order: Context, Constraints, Verification.",
    "If the maintenance window permits, use these headings in this order: Context, Constraints, Verification.",
    "Should this draft use these headings in this order: Context, Constraints, Verification?",
    "Example: “Use these headings in this order: Context, Constraints, Verification.”"
  ])("does not promote discussion, negated, conditional, split-sentence, or quoted mentions: %s", instruction => {
    expect(resolvedHeadings(instruction)).toEqual([]);
  });
});
