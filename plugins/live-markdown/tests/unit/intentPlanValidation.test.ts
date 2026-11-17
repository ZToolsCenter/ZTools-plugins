import { describe, expect, it } from "vitest";
import type { AiDocumentSnapshot } from "../../src/types/aiEditing";
import { getIntentHeadings } from "../../src/core/ai/intentTargets";
import { extractIntentLiterals } from "../../src/core/ai/intentLiterals";
import type { IntentCandidates, IntentOccurrence, IntentTarget, ValidatedIntent } from "../../src/core/ai/intentTypes";
import type { InstructionConstraint, InstructionContract, InstructionLiteralEvidence } from "../../src/core/ai/intentContract";
import { validatePlannedIntent } from "../../src/core/ai/intentPlanValidation";

const snapshot = (content: string, overrides: Partial<AiDocumentSnapshot> = {}): AiDocumentSnapshot => ({
  documentId: "doc.md",
  revision: 7,
  content,
  selection: null,
  cursor: null,
  readOnly: false,
  ...overrides
});

const explicit = <T>(value: T, instruction: string): InstructionConstraint<T> => ({
  state: "explicit",
  value,
  evidence: [{ from: 0, to: instruction.length, raw: instruction }]
});

const unknown = <T>(): InstructionConstraint<T> => ({ state: "unknown" });

const contract = (overrides: Partial<InstructionContract> = {}): InstructionContract => ({
  effect: unknown(),
  operation: unknown(),
  target: unknown(),
  scope: unknown(),
  occurrence: unknown(),
  layout: unknown(),
  literals: [],
  heading: unknown(),
  issues: [],
  preconditions: { selectionRequired: false, cursorRequired: false },
  ...overrides
});

const candidates = (content: string, literalTexts: string[] = []): IntentCandidates => ({
  headings: getIntentHeadings(content),
  literals: literalTexts.map((text, index) => ({ id: `literal-${index + 1}`, text }))
});

const literalInsert = (
  target: Exclude<IntentTarget, "document" | "selection">,
  textOrId: string,
  layout: "inline" | "block" = "block",
  isId = false
): ValidatedIntent => ({
  version: 1,
  kind: "edit",
  operation: "insert",
  target,
  layout,
  content: isId ? { mode: "literal", literalId: textOrId } : { mode: "literal", text: textOrId }
});

const replace = (target: "document" | "selection", find: string, occurrence: IntentOccurrence, write: string): ValidatedIntent => ({
  version: 1,
  kind: "edit",
  operation: "replace_exact",
  target,
  find,
  occurrence,
  content: { mode: "literal", text: write }
});

const assertRejected = (run: () => void, code: string): void => {
  try {
    run();
  } catch (error) {
    expect(error).toMatchObject({ code });
    expect((error as Error).message).not.toBe("");
    return;
  }
  throw new Error(`Expected plan validation to reject with ${code}`);
};

function literalEvidence(instruction: string, value: string, role: InstructionLiteralEvidence["role"]): InstructionLiteralEvidence {
  const from = instruction.indexOf(value);
  if (from < 0) throw new Error(`Fixture does not contain literal: ${value}`);
  return { from, to: from + value.length, raw: value, value, role };
}

const check = (intent: ValidatedIntent, rules: InstructionContract, document: AiDocumentSnapshot, candidatesForDocument: IntentCandidates, instruction: string): void => {
  validatePlannedIntent(intent, rules, document, candidatesForDocument, instruction);
};

describe("planned intent constraint validation", () => {
  it("blocks a selection-only replacement when no valid selection exists", () => {
    const source = "# 选区替换\n\n正文里有 hello，但用户没有选择它。";
    const instruction = "只把选中的“hello”替换为“world”。";
    const e = <T>(value: T) => explicit(value, instruction);
    const selectedOnly = contract({
      effect: e("edit"),
      operation: e("replace_exact"),
      scope: e("selection"),
      target: e("selection"),
      literals: [literalEvidence(instruction, "hello", "find"), literalEvidence(instruction, "world", "write")],
      preconditions: { selectionRequired: true, selectionAvailable: false, cursorRequired: false }
    });
    const modelWidenedToDocument = replace("document", "hello", "single", "world");

    assertRejected(() => check(modelWidenedToDocument, selectedOnly, snapshot(source), candidates(source, ["hello", "world"]), instruction), "selection_required");
    assertRejected(() => check(modelWidenedToDocument, selectedOnly, snapshot(source, { selection: { from: 0, to: 0 }, selectionValid: true }), candidates(source, ["hello", "world"]), instruction), "selection_required");
  });

  it("allows the same exact replacement when the requested selection is valid", () => {
    const source = "outside hello\nselected hello keep";
    const selection = { from: source.indexOf("selected"), to: source.length };
    const instruction = "把选区里的“hello”替换成“world”。";
    const e = <T>(value: T) => explicit(value, instruction);
    const selectedOnly = contract({
      effect: e("edit"),
      operation: e("replace_exact"),
      target: e("selection"),
      scope: e("selection"),
      literals: [literalEvidence(instruction, "hello", "find"), literalEvidence(instruction, "world", "write")],
      preconditions: { selectionRequired: true, selectionAvailable: true, cursorRequired: false }
    });
    const plan = replace("selection", "hello", "single", "world");

    expect(() => check(plan, selectedOnly, snapshot(source, { selection, selectionValid: true }), candidates(source, ["hello", "world"]), instruction)).not.toThrow();
  });

  it("rejects a selection-scoped model plan when the user explicitly requested the full document", () => {
    const source = "旧词在首段。\n选中旧词的句子。\n全文末尾旧词。";
    const instruction = "全文最后一处“旧词”替换为“新词”";
    const e = <T>(value: T) => explicit(value, instruction);
    const wholeDocument = contract({
      effect: e("edit"),
      operation: e("replace_exact"),
      scope: e("document"),
      occurrence: e("last"),
      literals: [literalEvidence(instruction, "旧词", "find"), literalEvidence(instruction, "新词", "write")]
    });
    const selection = { from: source.indexOf("选中"), to: source.indexOf("句子") + 2 };

    assertRejected(() => check(replace("selection", "旧词", "last", "新词"), wholeDocument, snapshot(source, { selection }), candidates(source, ["旧词", "新词"]), instruction), "scope_mismatch");
    expect(() => check(replace("document", "旧词", "last", "新词"), wholeDocument, snapshot(source, { selection }), candidates(source, ["旧词", "新词"]), instruction)).not.toThrow();
  });

  it("rejects a document-end plan when the instruction names a heading section", () => {
    const source = "# 实验报告\n\n## 结果\n\n样本量为 80，成功数量为 72。\n\n## 后续\n\n保留后续章节原文。";
    const instruction = "在“结果”章节末尾生成一段摘要，说明样本数与成功数，不更改其他章节。";
    const e = <T>(value: T) => explicit(value, instruction);
    const headings = getIntentHeadings(source);
    const headingContract = contract({
      effect: e("edit"),
      operation: e("insert"),
      target: e("section_end"),
      scope: e("document"),
      heading: e({ text: "结果", relation: "section_end" })
    });
    const eof: ValidatedIntent = { version: 1, kind: "edit", operation: "insert", target: "document_end", layout: "block", content: { mode: "generate", task: "summarize" } };
    const correct: ValidatedIntent = { version: 1, kind: "edit", operation: "insert", target: "section_end", targetId: headings[1].id, layout: "block", content: { mode: "generate", task: "summarize" } };

    assertRejected(() => check(eof, headingContract, snapshot(source), candidates(source, ["摘要"]), instruction), "target_mismatch");
    expect(() => check(correct, headingContract, snapshot(source), candidates(source, ["摘要"]), instruction)).not.toThrow();
  });

  it("rejects an unresolved duplicate heading and accepts the explicitly numbered AST candidate", () => {
    const source = "# 发布计划\n\n## 部署\n\n准备阶段。\n\n## 回滚\n\n回滚流程。\n\n## 部署\n\n执行阶段。";
    const instruction = "在“部署”章节末尾的第二个同名标题插入“完成”。";
    const e = <T>(value: T) => explicit(value, instruction);
    const headings = getIntentHeadings(source);
    const ambiguous = contract({
      effect: e("edit"),
      operation: e("insert"),
      target: e("section_end"),
      heading: e({ text: "部署", relation: "section_end" })
    });
    const duplicateSecond = { ...literalInsert("section_end", "完成", "block"), targetId: headings[3].id } as ValidatedIntent;
    assertRejected(() => check(duplicateSecond, ambiguous, snapshot(source), candidates(source), instruction), "ambiguous_heading");

    const numbered = contract({
      ...ambiguous,
      heading: e({ text: "部署", ordinal: 2, ordinalScope: "same_title", relation: "section_end" })
    });
    expect(() => check(duplicateSecond, numbered, snapshot(source), candidates(source), instruction)).not.toThrow();

    const globalOrdinal = contract({
      ...ambiguous,
      heading: e({ text: "部署", ordinal: 3, ordinalScope: "global", relation: "section_end" })
    });
    assertRejected(() => check(duplicateSecond, globalOrdinal, snapshot(source), candidates(source), instruction), "heading_mismatch");
  });

  it("rejects a heading target that does not exist in the source AST", () => {
    const source = "# 运维手册\n\n## 部署\n\n按步骤完成发布。";
    const instruction = "在“发布”章节末尾追加“hello”。";
    const e = <T>(value: T) => explicit(value, instruction);
    const headings = getIntentHeadings(source);
    const requestedMissingHeading = contract({
      effect: e("edit"),
      operation: e("insert"),
      target: e("section_end"),
      heading: e({ text: "发布", relation: "section_end" }),
      literals: [literalEvidence(instruction, "hello", "write")]
    });
    const plan = { ...literalInsert("section_end", "hello"), targetId: headings[1].id } as ValidatedIntent;

    assertRejected(() => check(plan, requestedMissingHeading, snapshot(source), candidates(source, ["hello"]), instruction), "missing_heading");
  });

  it("resolves a global heading ordinal without requiring a title name", () => {
    const source = "# Overview\n\n## Setup\n\n### Validation";
    const instruction = "在第3个标题后增加 Added";
    const e = <T>(value: T) => explicit(value, instruction);
    const headings = getIntentHeadings(source);
    const ordinalHeading = contract({
      effect: e("edit"),
      operation: e("insert"),
      target: e("heading_end"),
      heading: e({ text: "", ordinal: 3, ordinalScope: "global", relation: "heading_end" })
    });
    const correct = { ...literalInsert("heading_end", "Added"), targetId: headings[2].id } as ValidatedIntent;
    const wrong = { ...literalInsert("heading_end", "Added"), targetId: headings[1].id } as ValidatedIntent;

    expect(() => check(correct, ordinalHeading, snapshot(source), candidates(source), instruction)).not.toThrow();
    assertRejected(() => check(wrong, ordinalHeading, snapshot(source), candidates(source), instruction), "heading_mismatch");
  });

  it("preserves explicitly requested inline layout and quoted edge whitespace", () => {
    const source = "标签：";
    const instruction = "在光标处原样插入“  keep spaces  ”";
    const e = <T>(value: T) => explicit(value, instruction);
    const literal = literalEvidence(instruction, "  keep spaces  ", "write");
    const inlineAtCursor = contract({
      effect: e("edit"),
      operation: e("insert"),
      target: e("cursor"),
      layout: e("inline"),
      literals: [literal],
      preconditions: { selectionRequired: false, cursorRequired: true, cursorAvailable: true }
    });
    const allLiterals = extractIntentLiterals(instruction);
    const candidate = candidates(source, allLiterals.map(({ text }) => text));

    assertRejected(() => check(literalInsert("document_end", allLiterals[0].id, "block", true), inlineAtCursor, snapshot(source, { cursor: 3 }), candidate, instruction), "target_mismatch");
    expect(() => check(literalInsert("cursor", allLiterals[0].id, "inline", true), inlineAtCursor, snapshot(source, { cursor: 3 }), candidate, instruction)).not.toThrow();
    assertRejected(() => check(literalInsert("cursor", "keep spaces", "inline"), inlineAtCursor, snapshot(source, { cursor: 3 }), candidate, instruction), "literal_mismatch");
  });

  it("checks explicit replacement occurrence against both the plan and actual source matches", () => {
    const source = "A hello, B hello.";
    const instruction = "把第二处“hello”换成“world”。";
    const e = <T>(value: T) => explicit(value, instruction);
    const secondOccurrence = contract({
      effect: e("edit"),
      operation: e("replace_exact"),
      target: e("document"),
      scope: e("document"),
      occurrence: e(2),
      literals: [literalEvidence(instruction, "hello", "find"), literalEvidence(instruction, "world", "write")]
    });

    assertRejected(() => check(replace("document", "hello", "single", "world"), secondOccurrence, snapshot(source), candidates(source, ["hello", "world"]), instruction), "occurrence_mismatch");
    expect(() => check(replace("document", "hello", 2, "world"), secondOccurrence, snapshot(source), candidates(source, ["hello", "world"]), instruction)).not.toThrow();
    assertRejected(() => check(replace("document", "hello", 2, "world"), secondOccurrence, snapshot("A hello."), candidates("A hello.", ["hello", "world"]), instruction), "occurrence_unavailable");
  });

  it("requires literal writes to resolve to the exact quoted source data", () => {
    const source = "intro";
    const instruction = "在文末原样加上“  hello  ”";
    const e = <T>(value: T) => explicit(value, instruction);
    const literal = literalEvidence(instruction, "  hello  ", "write");
    const literalContract = contract({
      effect: e("edit"),
      operation: e("insert"),
      target: e("document_end"),
      layout: e("block"),
      literals: [literal]
    });
    const literalCandidates = candidates(source, ["  hello  "]);

    assertRejected(() => check(literalInsert("document_end", "hello", "block"), literalContract, snapshot(source), literalCandidates, instruction), "literal_mismatch");
    expect(() => check(literalInsert("document_end", "literal-1", "block", true), literalContract, snapshot(source), literalCandidates, instruction)).not.toThrow();
  });

  it("does not execute quoted commands when the explicit effect is answer", () => {
    const source = "正文保留原样。";
    const instruction = "请解释这句话：“在文末追加hello”";
    const answerContract = contract({ effect: explicit("answer", instruction) });
    const answer: ValidatedIntent = { version: 1, kind: "answer", target: "document", content: { mode: "generate", task: "custom" } };
    const quotedEdit: ValidatedIntent = literalInsert("document_end", "在文末追加hello", "block");

    expect(() => check(answer, answerContract, snapshot(source), candidates(source), instruction)).not.toThrow();
    assertRejected(() => check(quotedEdit, answerContract, snapshot(source), candidates(source), instruction), "effect_mismatch");

    const editContract = contract({ effect: explicit("edit", "在文末追加 hello") });
    assertRejected(() => check(answer, editContract, snapshot(source), candidates(source), "在文末追加 hello"), "effect_mismatch");
  });

  it("rejects contract evidence whose UTF-16 source span does not match the instruction", () => {
    const instruction = "在文末追加 hello";
    const forged = contract({
      effect: { state: "explicit", value: "edit", evidence: [{ from: 0, to: instruction.length, raw: "伪造证据" }] }
    });
    const plan: ValidatedIntent = {
      version: 1,
      kind: "edit",
      operation: "insert",
      target: "document_end",
      layout: "block",
      content: { mode: "generate", task: "custom" }
    };

    assertRejected(() => check(plan, forged, snapshot("正文"), candidates("正文"), instruction), "invalid_evidence");
  });

  it("rejects edit plans for explicit no-edit and conflicting contracts", () => {
    const source = "保留内容";
    const instruction = "不要修改原文";
    const noEdit = contract({ effect: explicit("no_edit", instruction) });
    const edit: ValidatedIntent = literalInsert("document_end", "hello", "block");
    const conflict = contract({
      effect: { state: "conflict", alternatives: ["answer", "edit"], evidence: [literalEvidence(instruction, "改", "unknown")] }
    });

    assertRejected(() => check(edit, noEdit, snapshot(source), candidates(source), instruction), "effect_mismatch");
    assertRejected(() => check(edit, conflict, snapshot(source), candidates(source), instruction), "ambiguous_instruction");
  });

  it("does not invent a target or occurrence constraint when the instruction contract is unknown", () => {
    const source = "first\nsecond";
    const instruction = "在合适的地方加一段简短说明";
    const e = <T>(value: T) => explicit(value, instruction);
    const naturalLanguage = contract({ effect: e("edit"), operation: e("insert") });
    const modelPlan: ValidatedIntent = {
      version: 1,
      kind: "edit",
      operation: "insert",
      target: "document_end",
      layout: "block",
      content: { mode: "generate", task: "custom" }
    };

    expect(() => check(modelPlan, naturalLanguage, snapshot(source), candidates(source), instruction)).not.toThrow();
  });
});
