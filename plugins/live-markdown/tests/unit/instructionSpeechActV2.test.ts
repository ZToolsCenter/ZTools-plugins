import { describe, expect, it } from "vitest";
import { deriveInstructionContract } from "../../src/core/ai/instructionConstraints";
import { buildAiIntentCandidates } from "../../src/core/ai/intentContext";
import { buildIntentOutputSchema } from "../../src/core/ai/intentOutputSchema";
import { parseIntentOutput } from "../../src/core/ai/intentSchema";

const source = "上线前需确认：数据迁移完成、回滚方案可用、值班人员已到位。";

function deriveSchema(instruction: string, hasSelection = false) {
  const contract = deriveInstructionContract(instruction, { hasSelection });
  const candidates = buildAiIntentCandidates(instruction, source, contract);
  const schema = buildIntentOutputSchema(instruction, hasSelection, candidates, contract) as {
    anyOf: Array<{ properties: { kind: { const?: string; enum?: string[] }; target?: { const?: string; enum?: string[] } } }>;
  };
  const kinds = schema.anyOf.flatMap(({ properties }) => properties.kind.const ? [properties.kind.const] : properties.kind.enum ?? []);
  return { contract, candidates, schema, kinds };
}

describe("instruction speech act v2", () => {
  it.each([
    "请只基于全文回答：上线前有哪些三个关键事实？不要修改文稿。",
    "请解释“底部加hello”是什么意思，勿修改文稿。"
  ])("routes an explicit answer request through the answer schema: %s", instruction => {
    const { contract, candidates, kinds } = deriveSchema(instruction);

    expect(contract.effect).toMatchObject({ state: "explicit", value: "answer" });
    expect(contract.operation).toEqual({ state: "unknown" });
    expect(contract.target).toEqual({ state: "unknown" });
    expect(contract.issues).toEqual([]);
    expect(kinds).toContain("answer");
    expect(kinds).not.toContain("edit");

    const plan = JSON.stringify({ version: 1, kind: "answer", target: "document", content: { mode: "generate", task: "custom" } });
    expect(parseIntentOutput(plan, instruction, candidates, contract)).toMatchObject({ kind: "answer", target: "document" });
  });

  it("does not execute an edit command contained inside an explanation quote", () => {
    const instruction = "请解释“底部加hello”是什么意思，勿修改文稿。";
    const { contract } = deriveSchema(instruction);

    expect(contract.effect).toMatchObject({ state: "explicit", value: "answer" });
    expect(contract.operation).toEqual({ state: "unknown" });
    expect(contract.target).toEqual({ state: "unknown" });
    expect(contract.literals.every(({ role }) => role === "unknown")).toBe(true);
  });

  it("keeps a standalone negative edit as no-edit", () => {
    const { contract, kinds } = deriveSchema("不要新增代码块");

    expect(contract.effect).toMatchObject({ state: "explicit", value: "no_edit" });
    expect(kinds).not.toContain("edit");
    expect(kinds).not.toContain("answer");
  });

  it("keeps an explicit selection source and its missing-selection precondition", () => {
    const instruction = "请基于选区回答：是否需要补充说明？";
    const { contract, kinds } = deriveSchema(instruction, false);

    expect(contract.effect).toMatchObject({ state: "explicit", value: "answer" });
    expect(contract.scope).toMatchObject({ state: "explicit", value: "selection" });
    expect(contract.preconditions).toMatchObject({ selectionRequired: true, selectionAvailable: false });
    expect(contract.issues).toContainEqual(expect.objectContaining({ code: "missing_target" }));
    expect(kinds).toContain("clarify");
    expect(kinds).not.toContain("answer");
  });

  it("preserves compound answer plus real edit requests", () => {
    const instruction = "请解释“底部加hello”是什么意思？然后在文末新增‘hello’。";
    const { contract, kinds } = deriveSchema(instruction);

    expect(contract.effect).toMatchObject({ state: "ambiguous", alternatives: ["answer", "edit"] });
    expect(contract.operation).toMatchObject({ state: "ambiguous" });
    expect(contract.issues).toContainEqual(expect.objectContaining({ code: "compound" }));
    expect(kinds).toContain("clarify");
    expect(kinds).not.toContain("answer");
    expect(kinds).not.toContain("edit");
  });

  it("does not treat every question mark as an answer request", () => {
    const { contract } = deriveSchema("上线前有哪些三个关键事实？");

    expect(contract.effect).not.toMatchObject({ state: "explicit", value: "answer" });
  });

  it("keeps a polite request to edit as an edit", () => {
    const { contract, kinds } = deriveSchema("能帮我润色全文吗？");

    expect(contract.effect).toMatchObject({ state: "explicit", value: "edit" });
    expect(kinds).toContain("edit");
    expect(kinds).not.toContain("answer");
  });
});
it("does not replace an existing answer-only interpretation with a prohibition", () => {
  expect(deriveInstructionContract("不要修改文档，只告诉我如何在文末增加 hello。", { hasSelection: false }).effect)
    .toMatchObject({ state: "explicit", value: "answer" });
});
