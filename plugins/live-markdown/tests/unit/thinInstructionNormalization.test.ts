import { describe, expect, it } from "vitest";
import type { AiDocumentSnapshot } from "../../src/types/aiEditing";
import { deriveInstructionContract } from "../../src/core/ai/instructionConstraints";
import { buildAiIntentCandidates } from "../../src/core/ai/intentContext";
import { bindAiIntent } from "../../src/core/ai/intentBinder";
import { resolveKnownIntent } from "../../src/core/ai/resolvedIntentContract";
import { runPlannedAiTaskCore } from "../../src/core/ai/plannedTaskRunnerCore";
import type { AiTaskRequest } from "../../src/core/ai/aiTaskRunner";
import type { ValidatedIntent } from "../../src/core/ai/intentTypes";

const snapshot = (content: string): AiDocumentSnapshot => ({
  documentId: "thin-normalization.md", revision: 1, content, selection: null, cursor: null, readOnly: false
});
const sectionInsert = (targetId: string): ValidatedIntent => ({
  version: 1, kind: "edit", operation: "insert", target: "section_end", targetId,
  layout: "block", content: { mode: "literal", text: "Reviewed." }
});

describe("thin instruction normalization", () => {
  it("normalizes a selected polish with one exact local typo correction", () => {
    const instruction = "只润色选区中的“我们以经完成备份。”，只将以经改成已经，其余字不变。";
    const contract = deriveInstructionContract(instruction, { hasSelection: true });

    expect(contract.effect).toMatchObject({ state: "explicit", value: "edit" });
    expect(contract.operation).toMatchObject({ state: "explicit", value: "replace_exact" });
    expect(contract.occurrence).toMatchObject({ state: "explicit", value: "single" });
    expect(contract.scope).toMatchObject({ state: "explicit", value: "selection" });
    expect(contract.target).toMatchObject({ state: "explicit", value: "selection" });
    expect(contract.issues).toEqual([]);
    expect(contract.literals.filter(({ role }) => role === "find" || role === "write")
      .map(({ role, value }) => ({ role, value }))).toEqual([
      { role: "find", value: "以经" }, { role: "write", value: "已经" }
    ]);
  });

  it("programmatically binds a unique selected typo refinement to only the typo span", async () => {
    const source = "Opening stays.\n\n我们以经完成备份。\n\nClosing stays.";
    const selectedText = "我们以经完成备份。";
    const selectionFrom = source.indexOf(selectedText);
    const document: AiDocumentSnapshot = {
      ...snapshot(source), selection: { from: selectionFrom, to: selectionFrom + selectedText.length }
    };
    const instruction = "只润色选区中的“我们以经完成备份。”，只将以经改成已经，其余字不变。";
    const contract = deriveInstructionContract(instruction, { hasSelection: true });
    const candidates = buildAiIntentCandidates(instruction, source, contract);
    expect(contract.operation).toMatchObject({ state: "explicit", value: "replace_exact" });
    expect(contract.occurrence).toMatchObject({ state: "explicit", value: "single" });
    expect(resolveKnownIntent(instruction, document, candidates, contract)).not.toBeNull();
    const request: AiTaskRequest = {
      action: "custom", source, userPrompt: instruction, provider: "local", baseSystemPrompt: "",
      actionDefinition: { id: "custom", label: "custom", prompt: instruction }
    };
    let calls = 0;
    const result = await runPlannedAiTaskCore(request, document, {
      invoke: async () => { calls += 1; throw new Error("unexpected model call"); }, isCurrent: () => true, abortCurrent() {}
    });
    const patch = result.proposal?.patch;
    const expectedFrom = source.indexOf("以经");
    const applied = patch ? source.slice(0, patch.from) + patch.insertText + source.slice(patch.to) : undefined;

    expect(calls).toBe(0);
    expect(result.resolvedIntent).toMatchObject({
      kind: "edit", operation: "replace_exact", target: "selection", find: "以经", occurrence: "single",
      content: { mode: "literal", text: "已经" }
    });
    expect(patch).toMatchObject({ from: expectedFrom, to: expectedFrom + "以经".length, expectedText: "以经", insertText: "已经" });
    expect(applied).toBe(source.replace("以经", "已经"));
    expect(applied?.slice(0, expectedFrom)).toBe(source.slice(0, expectedFrom));
    expect(applied?.slice(expectedFrom + "已经".length)).toBe(source.slice(expectedFrom + "以经".length));
  });

  it("keeps genuinely connected edits ambiguous", () => {
    const contract = deriveInstructionContract("在文末新增一段，再润色选区", { hasSelection: true });
    const repeatedRangeEdit = deriveInstructionContract("把选区中的“draft”改成“final”，然后把文末的“旧”改成“新”。", { hasSelection: true });

    expect(contract.operation.state).toBe("ambiguous");
    expect(contract.issues).toContainEqual(expect.objectContaining({ code: "compound" }));
    expect(repeatedRangeEdit.operation.state).toBe("ambiguous");
    expect(repeatedRangeEdit.issues).toContainEqual(expect.objectContaining({ code: "compound" }));
  });

  it("keeps unrelated rewrite and replacement operations conflicting", () => {
    const contract = deriveInstructionContract("润色选区内容。把文末标题改成报告。", { hasSelection: true });

    expect(contract.operation.state).toBe("conflict");
    expect(contract.issues).toContainEqual(expect.objectContaining({ code: "conflicting_constraints" }));
  });

  it("treats an unquoted selected replacement payload as a whole-selection rewrite without a find literal", () => {
    const contract = deriveInstructionContract("只把当前选区替换为 Backup verified.", { hasSelection: true });

    expect(contract.effect).toMatchObject({ state: "explicit", value: "edit" });
    expect(contract.operation).toMatchObject({ state: "explicit", value: "rewrite" });
    expect(contract.scope).toMatchObject({ state: "explicit", value: "selection" });
    expect(contract.target).toMatchObject({ state: "explicit", value: "selection" });
    expect(contract.literals.filter(({ role }) => role === "find")).toEqual([]);
    expect(contract.issues).toEqual([]);
  });

  it("binds an only-the-last English exact replacement to the document by default", () => {
    const instruction = "Replace only the last exact Alpha is old. with Alpha is new.";
    const source = "Alpha is old. Then Alpha is old.";
    const contract = deriveInstructionContract(instruction);
    const candidates = buildAiIntentCandidates(instruction, source, contract);
    const resolved = resolveKnownIntent(instruction, snapshot(source), candidates, contract);

    expect(contract.operation).toMatchObject({ state: "explicit", value: "replace_exact" });
    expect(contract.occurrence).toMatchObject({ state: "explicit", value: "last" });
    expect(contract.target.state).toBe("unknown");
    expect(resolved?.intent).toMatchObject({
      kind: "edit", operation: "replace_exact", target: "document", find: "Alpha is old.", occurrence: "last",
      content: { mode: "literal", text: "Alpha is new." }
    });
    expect(resolved?.range.from).toBe(source.lastIndexOf("Alpha is old."));
  });

  it("extracts an unquoted Markdown heading anchor and filters AST candidates by title", () => {
    const instruction = "在唯一的 ## Results 章节末尾增加 Reviewed.";
    const source = "# Report\n\n## Results\n\n80 samples passed.\n\n## Next\n\nKeep this section.";
    const contract = deriveInstructionContract(instruction);
    const candidates = buildAiIntentCandidates(instruction, source, contract);

    expect(contract.heading).toMatchObject({ state: "explicit", value: { text: "Results", relation: "section_end" } });
    expect(contract.target).toMatchObject({ state: "explicit", value: "section_end" });
    expect(contract.issues).toEqual([]);
    expect(candidates.headings.map(({ text }) => text)).toEqual(["Results"]);
  });

  it("preserves duplicate and missing heading behavior for an explicit AST anchor", () => {
    const instruction = "在唯一的 ## Results 章节末尾增加 Reviewed.";
    const contract = deriveInstructionContract(instruction);
    const duplicate = buildAiIntentCandidates(instruction,
      "# Report\n\n## Results\n\nFirst.\n\n## Details\n\n## Results\n\nSecond.", contract);
    const missing = buildAiIntentCandidates(instruction, "# Report\n\n## Summary\n\nDraft.", contract);

    expect(duplicate.headings.map(({ text }) => text)).toEqual(["Results", "Results"]);
    expect(missing.headings).toEqual([]);
  });

  it("binds the unique AST heading but keeps duplicate and missing targets unresolved", () => {
    const instruction = "在唯一的 ## Results 章节末尾增加 Reviewed.";
    const uniqueSource = "# Report\n\n## Results\n\n80 samples passed.\n\n## Next\n\nKeep this section.";
    const duplicateSource = "# Report\n\n## Results\n\nFirst.\n\n## Details\n\n## Results\n\nSecond.";
    const uniqueContract = deriveInstructionContract(instruction);
    const uniqueCandidates = buildAiIntentCandidates(instruction, uniqueSource, uniqueContract);
    const bound = bindAiIntent(sectionInsert(uniqueCandidates.headings[0].id), snapshot(uniqueSource), instruction, uniqueCandidates, uniqueContract);
    expect(bound.range.from).toBe(uniqueSource.indexOf("## Next"));

    const duplicateContract = deriveInstructionContract(instruction);
    const duplicateCandidates = buildAiIntentCandidates(instruction, duplicateSource, duplicateContract);
    expect(() => bindAiIntent(sectionInsert(duplicateCandidates.headings[0].id), snapshot(duplicateSource), instruction, duplicateCandidates, duplicateContract))
      .toThrow("多个同名标题");

    const missingSource = "# Report\n\n## Summary\n\nDraft.";
    const missingContract = deriveInstructionContract(instruction);
    const missingCandidates = buildAiIntentCandidates(instruction, missingSource, missingContract);
    expect(missingCandidates.headings).toEqual([]);
    expect(() => bindAiIntent(sectionInsert("heading:missing"), snapshot(missingSource), instruction, missingCandidates, missingContract))
      .toThrow("找不到您指定的标题");
  });

  it("keeps an affirmative source transformation despite a narrow content-count prohibition", () => {
    const contract = deriveInstructionContract(
      "根据原文把水果和每斤价格转成两列表格，列名必须为水果、价格；不要增加第三种水果。"
    );

    expect(contract.effect).toMatchObject({ state: "explicit", value: "edit" });
    expect(contract.operation).toMatchObject({ state: "explicit", value: "rewrite" });
    expect(contract.scope).toMatchObject({ state: "explicit", value: "document" });
    expect(contract.target).toMatchObject({ state: "explicit", value: "document" });
    expect(contract.issues).not.toContainEqual(expect.objectContaining({ code: "missing_operation" }));
  });

  it("keeps cited commands as data and explicit no-edit language as no-edit", () => {
    const cited = deriveInstructionContract("解释一下“在文末添加内容”的意思，不要修改文档。");
    const negative = deriveInstructionContract("不要修改文档。");

    expect(cited.effect).toMatchObject({ state: "explicit", value: "answer" });
    expect(cited.operation.state).toBe("unknown");
    expect(negative.effect).toMatchObject({ state: "explicit", value: "no_edit" });
    expect(negative.operation.state).toBe("unknown");
  });
});
