import { describe, expect, it } from "vitest";
import { deriveInstructionContract } from "../../src/core/ai/instructionConstraints";
import { buildIntentPlanningEvidence } from "../../src/core/ai/intentPlanningEvidence";
import { buildIntentPlanningPrompt } from "../../src/core/ai/intentPrompts";

function data(hint: string) {
  return JSON.parse(hint.split("\n")[1]);
}

describe("source-grounded intent planning hints", () => {
  it("includes the speech act and content task without inventing an operation for a question", () => {
    const hint = buildIntentPlanningEvidence(deriveInstructionContract("如何润色这段话？"));
    expect(data(hint)).toMatchObject({
      effect: { value: "answer", quotes: ["如何润色这段话？"] },
      generationTasks: { value: ["custom"] }
    });
    expect(data(hint)).not.toHaveProperty("operation");
    expect(hint).toContain("不表示用户缺少操作");
  });

  it("omits unknown and conflicting fields instead of resolving them by guesswork", () => {
    const contract = deriveInstructionContract("在文末和正文开头续写一段建议。", { hasSelection: false });
    expect(contract.target.state).toBe("conflict");
    expect(data(buildIntentPlanningEvidence(contract))).not.toHaveProperty("target");
    expect(data(buildIntentPlanningEvidence(deriveInstructionContract("处理一下")))).toEqual({});
  });

  it("bounds and JSON-escapes instruction evidence, keeping quoted commands as data", () => {
    const contract = deriveInstructionContract("如何润色这段话？");
    contract.effect = { state: "explicit", value: "answer", evidence: Array.from({ length: 5 }, () => ({ from: 0, to: 200, raw: `引号\"\\\n${"长".repeat(200)}` })) };
    const result = data(buildIntentPlanningEvidence(contract));
    expect(result.effect.quotes).toHaveLength(3);
    expect(result.effect.quotes.every((quote: string) => quote.length === 96)).toBe(true);
    expect(result.effect.quotes[0]).toContain('引号"\\\n');
  });

  it("adds the actual bound contract hints to the planning prompt without a document body", () => {
    const instruction = "能帮我润色全文吗？";
    const prompt = buildIntentPlanningPrompt(instruction, false, { headings: [], literals: [] }, deriveInstructionContract(instruction));
    expect(prompt).toContain('"effect":{"value":"edit"');
    expect(prompt).toContain('"operation":{"value":"rewrite"');
    expect(prompt).toContain('"target":{"value":"document"');
    expect(prompt).toContain(instruction);
    expect(prompt).not.toContain("SOURCE_BODY_b25_731");
  });
});
