import { afterEach, describe, expect, it, vi } from "vitest";
import { buildAiIntentCandidates } from "../../src/core/ai/intentContext";
import * as intentTargets from "../../src/core/ai/intentTargets";
import { deriveInstructionContract } from "../../src/core/ai/instructionConstraints";

const source = "# Welcome\n\n说明。\n\n## 结论\n\n原文。\n\n## 结论\n\n另一份。\n\n## A\n\n内容。";

describe("intent planning context", () => {
  afterEach(() => vi.restoreAllMocks());

  it("omits irrelevant document headings for a global literal append", () => {
    expect(buildAiIntentCandidates("底部加个hello， world", source).headings).toEqual([]);
    expect(buildAiIntentCandidates("底部加个hello， world", source).incomplete).toBe(false);
  });

  it("retains every same-title match so a model cannot hide an ambiguous anchor", () => {
    expect(buildAiIntentCandidates("在结论后增加说明", source).headings.map((heading) => heading.text)).toEqual(["结论", "结论"]);
  });

  it("keeps AST order for explicit heading ordinals and marks a bounded outline incomplete", () => {
    expect(buildAiIntentCandidates("在第二个标题后加 hello", source).headings.map((heading) => heading.text)).toEqual(["Welcome", "结论", "结论", "A"]);
    const manyHeadings = Array.from({ length: 40 }, (_, index) => `## H${index}\n\ntext`).join("\n\n");
    const candidates = buildAiIntentCandidates("在最后一个标题后加 hello", manyHeadings);
    expect(candidates.headings).toHaveLength(32);
    expect(candidates.incomplete).toBe(true);
  });

  it("preserves quoted payload bytes and avoids a single-letter heading inside add", () => {
    const candidates = buildAiIntentCandidates('append "hello， world" at the end', source);
    expect(candidates.headings).toEqual([]);
    expect(candidates.literals).toEqual([{ id: "literal-1", text: "hello， world" }]);
    expect(buildAiIntentCandidates("在 A 后加 hello", source).headings.map((heading) => heading.text)).toEqual(["A"]);
  });

  it("skips the Markdown heading parse when the contract fixes a non-heading replacement", () => {
    const instruction = 'replace "hello" with "world"';
    const contract = deriveInstructionContract(instruction);
    expect(contract.operation).toMatchObject({ state: "explicit", value: "replace_exact" });
    expect(contract.heading.state).toBe("unknown");
    const parseHeadings = vi.spyOn(intentTargets, "getIntentHeadings");

    const candidates = buildAiIntentCandidates(instruction, source, contract);

    expect(parseHeadings).not.toHaveBeenCalled();
    expect(candidates.headings).toEqual([]);
  });

  it("skips heading parsing for explicit whole-document rewrite and EOF insertion targets", () => {
    const rewrite = 'polish the whole document';
    const rewriteContract = deriveInstructionContract(rewrite);
    expect(rewriteContract.operation).toMatchObject({ state: "explicit", value: "rewrite" });
    const parseHeadings = vi.spyOn(intentTargets, "getIntentHeadings");

    expect(buildAiIntentCandidates(rewrite, source, rewriteContract).headings).toEqual([]);
    expect(parseHeadings).not.toHaveBeenCalled();

    const append = 'append "hello" at the end';
    const appendContract = deriveInstructionContract(append);
    expect(appendContract.target.state).toBe("explicit");
    expect(buildAiIntentCandidates(append, source, appendContract).headings).toEqual([]);
    expect(parseHeadings).not.toHaveBeenCalled();
  });

  it("keeps parsing headings for title-text insertion when the contract target is unknown", () => {
    const instruction = "在结论后增加说明";
    const contract = deriveInstructionContract(instruction);
    expect(contract.target.state).toBe("unknown");
    const parseHeadings = vi.spyOn(intentTargets, "getIntentHeadings");

    const candidates = buildAiIntentCandidates(instruction, source, contract);

    expect(parseHeadings).toHaveBeenCalledOnce();
    expect(candidates.headings.map((heading) => heading.text)).toEqual(["结论", "结论"]);
  });

  it("does not send the existing outline when a new code artifact contains its own heading", () => {
    const instruction = "新增个markdown的代码块，里面生成一个h1标题";
    const contract = deriveInstructionContract(instruction);
    const parseHeadings = vi.spyOn(intentTargets, "getIntentHeadings");
    const document = Array.from({ length: 40 }, (_, index) => `## 现有标题${index}\n\n内容。`).join("\n\n");
    expect(buildAiIntentCandidates(instruction, document, contract).headings).toEqual([]);
    expect(parseHeadings).not.toHaveBeenCalled();
  });

  it("retains an explicit existing heading anchor when the new content is code", () => {
    const instruction = "在“Welcome”标题后新增 Python 代码块，里面生成一个 h1 标题";
    const contract = deriveInstructionContract(instruction);
    expect(contract.heading.state).toBe("explicit");
    expect(buildAiIntentCandidates(instruction, source, contract).headings.map(({ text }) => text)).toEqual(["Welcome"]);
  });
});
