import { describe, expect, it } from "vitest";
import { deriveInstructionContract, scanInstructionQuotes } from "../../src/core/ai/instructionConstraints";
import { buildAiIntentCandidates } from "../../src/core/ai/intentContext";
import { buildIntentOutputSchema } from "../../src/core/ai/intentOutputSchema";

describe("instruction contract literal evidence", () => {
  it.each(["Add “!” exactly where the cursor is", "Insert “x” where my caret is", "Add “y” at the current cursor"])("grounds an explicit English cursor reference: %s", instruction => {
    const contract = deriveInstructionContract(instruction, { hasCursor: true });
    expect(contract.target).toMatchObject({ state: "explicit", value: "cursor" });
    expect(contract.layout).toMatchObject({ state: "explicit", value: "inline" });
    expect(contract.preconditions.cursorRequired).toBe(true);
  });
  it("scans quoted payloads as exact UTF-16 source spans", () => {
    const instruction = "把“ e\u0301\r\n✨ ”替换成『done』";
    const quotes = scanInstructionQuotes(instruction);

    expect(quotes.map(({ from, to, raw, value }) => ({ from, to, raw, value }))).toEqual([
      { from: 2, to: 9, raw: " e\u0301\r\n✨ ", value: " e\u0301\r\n✨ " },
      { from: 14, to: 18, raw: "done", value: "done" }
    ]);
    expect(instruction.slice(quotes[0].from, quotes[0].to)).toBe(quotes[0].raw);
  });

  it("assigns old and new quoted values to replacement roles", () => {
    const contract = deriveInstructionContract("把“draft”改成“final”");

    expect(contract.operation).toMatchObject({ state: "explicit", value: "replace_exact" });
    expect(contract.literals.map(({ role, value }) => ({ role, value }))).toEqual([
      { role: "find", value: "draft" },
      { role: "write", value: "final" }
    ]);
  });

  it("keeps last matching text separate from a document-end insertion target", () => {
    const contract = deriveInstructionContract("把最后一处 draft 改成 final");

    expect(contract.operation).toMatchObject({ state: "explicit", value: "replace_exact" });
    expect(contract.occurrence).toMatchObject({ state: "explicit", value: "last" });
    expect(contract.target.state).toBe("unknown");
  });

  it.each([
    ["把第3处draft改成final", 3],
    ["把第 3 处 draft 改成 final", 3],
    ["把第三处 draft 改成 final", 3]
  ])("reads an explicit ordinal from common spacing and Chinese forms: %s", (instruction, ordinal) => {
    expect(deriveInstructionContract(instruction).occurrence).toMatchObject({ state: "explicit", value: ordinal });
  });

  it("requires explicit position evidence instead of defaulting an insertion to EOF", () => {
    const unknown = deriveInstructionContract("追加“hello”");
    const explicitEnd = deriveInstructionContract("在当前文档最末尾追加“hello”");

    expect(unknown.target.state).toBe("unknown");
    expect(explicitEnd.target).toMatchObject({ state: "explicit", value: "document_end" });
    expect(explicitEnd.scope).toMatchObject({ state: "explicit", value: "document" });
  });

  it("keeps a quoted heading as an anchor and the later quote as inserted text", () => {
    const contract = deriveInstructionContract("在标题“实施计划”后另起新段落添加“下一步”");

    expect(contract.target).toMatchObject({ state: "explicit", value: "heading_end" });
    expect(contract.heading).toMatchObject({ state: "explicit", value: { text: "实施计划", relation: "heading_end" } });
    expect(contract.layout).toMatchObject({ state: "explicit", value: "block" });
    expect(contract.literals.map(({ role, value }) => ({ role, value }))).toEqual([
      { role: "unknown", value: "实施计划" },
      { role: "write", value: "下一步" }
    ]);
  });

  it("separates a pure negative command from a positive operation after a clause break", () => {
    const negative = deriveInstructionContract("不要在文末添加“hello”");
    const mixed = deriveInstructionContract("不要修改原文，只在文末添加“hello”");

    expect(negative.effect).toMatchObject({ state: "explicit", value: "no_edit" });
    expect(negative.operation.state).toBe("unknown");
    expect(mixed.operation).toMatchObject({ state: "explicit", value: "insert" });
    expect(mixed.effect).toMatchObject({ state: "explicit", value: "edit" });
    expect(mixed.literals.map(({ role }) => role)).toEqual(["write"]);
  });

  it("reports an explicit selection precondition when no valid selection is present", () => {
    const contract = deriveInstructionContract("改写选中的内容", { hasSelection: false });

    expect(contract.target).toMatchObject({ state: "explicit", value: "selection" });
    expect(contract.scope).toMatchObject({ state: "explicit", value: "selection" });
    expect(contract.preconditions).toMatchObject({ selectionRequired: true, selectionAvailable: false });
    expect(contract.issues).toContainEqual(expect.objectContaining({ code: "missing_target" }));
  });

  it("recognizes the frozen B07 selection wording even when the selected payload is quoted", () => {
    const contract = deriveInstructionContract("只把选中的“hello”替换为“world”。", { hasSelection: false });

    expect(contract.operation).toMatchObject({ state: "explicit", value: "replace_exact" });
    expect(contract.target).toMatchObject({ state: "explicit", value: "selection" });
    expect(contract.preconditions).toMatchObject({ selectionRequired: true, selectionAvailable: false });
    expect(contract.issues).toContainEqual(expect.objectContaining({ code: "missing_target" }));
    expect(contract.literals.map(({ role, value }) => ({ role, value }))).toEqual([
      { role: "find", value: "hello" },
      { role: "write", value: "world" }
    ]);
  });

  it("recognizes frozen L12/L13 heading anchors when the quoted name comes first", () => {
    const heading = deriveInstructionContract("在“部署步骤”这个标题后新增“运行前先备份”");
    const section = deriveInstructionContract("在“实施计划”章节结束后增加“计划已评审”");

    expect(heading.target).toMatchObject({ state: "explicit", value: "heading_end" });
    expect(heading.heading).toMatchObject({ state: "explicit", value: { text: "部署步骤", relation: "heading_end" } });
    expect(heading.literals.map(({ role }) => role)).toEqual(["unknown", "write"]);
    expect(section.target).toMatchObject({ state: "explicit", value: "section_end" });
    expect(section.heading).toMatchObject({ state: "explicit", value: { text: "实施计划", relation: "section_end" } });
    expect(section.literals.map(({ role }) => role)).toEqual(["unknown", "write"]);
  });

  it("distinguishes a global heading ordinal from the Nth same-title heading", () => {
    const sameTitle = deriveInstructionContract("在第二个“概览”标题后插入“补充说明”");
    const global = deriveInstructionContract("在第 2 个标题“实施计划”之后插入“评审记录”");

    expect(sameTitle.heading).toMatchObject({ state: "explicit", value: { text: "概览", ordinal: 2, ordinalScope: "same_title" } });
    expect(global.heading).toMatchObject({ state: "explicit", value: { text: "实施计划", ordinal: 2, ordinalScope: "global" } });
  });

  it("grounds an unquoted replacement pair and treats bottom replacement as the last occurrence", () => {
    const contract = deriveInstructionContract("底部hello改成helloworld");

    expect(contract.operation).toMatchObject({ state: "explicit", value: "replace_exact" });
    expect(contract.target).toMatchObject({ state: "explicit", value: "document" });
    expect(contract.occurrence).toMatchObject({ state: "explicit", value: "last" });
    expect(contract.literals.map(({ role, value }) => ({ role, value }))).toEqual([
      { role: "find", value: "hello" },
      { role: "write", value: "helloworld" }
    ]);
  });

  it("supports a previously unseen English last-literal replacement without hardcoding the literal", () => {
    const contract = deriveInstructionContract("Replace the last status with active in the document");

    expect(contract.operation).toMatchObject({ state: "explicit", value: "replace_exact" });
    expect(contract.occurrence).toMatchObject({ state: "explicit", value: "last" });
    expect(contract.literals.map(({ role, value }) => ({ role, value }))).toEqual([
      { role: "find", value: "status" },
      { role: "write", value: "active" }
    ]);
  });

  it("keeps a new-paragraph insertion as a block insertion at the document end", () => {
    const contract = deriveInstructionContract("在文末新增一段“发布说明”");

    expect(contract.operation).toMatchObject({ state: "explicit", value: "insert" });
    expect(contract.target).toMatchObject({ state: "explicit", value: "document_end" });
    expect(contract.layout).toMatchObject({ state: "explicit", value: "block" });
    expect(contract.literals[0]).toMatchObject({ role: "write", value: "发布说明" });
  });

  it.each([
    "在文末新增一个 Python 代码块，实现 multiply(a, b) 函数并返回 a * b。保留原有内容，只输出新增代码块。",
    "请在文章结尾添加 Python 代码围栏，定义 multiply(a, b) 并返回它们的乘积；保留原文，仅输出新代码。"
  ])("locks a clear generated-code request without turning its output constraint into another edit: %s", instruction => {
    const contract = deriveInstructionContract(instruction, { hasSelection: false });

    expect(contract.effect).toMatchObject({ state: "explicit", value: "edit" });
    expect(contract.operation).toMatchObject({ state: "explicit", value: "insert" });
    expect(contract.target).toMatchObject({ state: "explicit", value: "document_end" });
    expect(contract.layout).toMatchObject({ state: "explicit", value: "block" });
    expect(contract.generationTasks).toMatchObject({ state: "explicit", value: ["custom"] });
    expect(contract.issues).toEqual([]);
  });

  it("uses a clear generated-code verb as insertion only when the document position is explicit", () => {
    const atEnd = deriveInstructionContract("在文末生成一个 Python 代码块，实现 multiply(a, b) 函数并返回 a*b。", { hasSelection: false });
    const noPosition = deriveInstructionContract("生成 Python 代码块给我看看。", { hasSelection: false });

    expect(atEnd).toMatchObject({
      effect: { state: "explicit", value: "edit" },
      operation: { state: "explicit", value: "insert" },
      target: { state: "explicit", value: "document_end" },
      layout: { state: "explicit", value: "block" },
      generationTasks: { state: "explicit", value: ["custom"] }
    });
    expect(atEnd.issues).toEqual([]);
    expect(noPosition.operation.state).toBe("unknown");
    expect(noPosition.target.state).toBe("unknown");
  });

  it.each([
    "续写后续行动建议，但不要改原文",
    "续写后续行动建议，但不要重复原文",
    "续写后续行动建议，但不要新增日期、金额或标题",
    "续写后续行动建议，但不要新增“内容”"
  ])("keeps narrow continuation restrictions from becoming a ban on all added text: %s", instruction => {
    const contract = deriveInstructionContract(instruction, { hasSelection: false });

    expect(contract.operation).toMatchObject({ state: "explicit", value: "insert" });
    expect(contract.target).toMatchObject({ state: "explicit", value: "document_end" });
    expect(contract.issues).toEqual([]);
  });

  it.each([
    "不要在文末新增 Python 代码块",
    "只回答这段 Python 代码的作用，不要修改文档",
    "在文末新增代码块，并在正文开头添加说明"
  ])("does not force a direct code insertion when intent is negative, answer-only, or compound: %s", instruction => {
    const contract = deriveInstructionContract(instruction, { hasSelection: false });

    expect(contract.effect.state === "explicit" && contract.effect.value === "edit" &&
      contract.operation.state === "explicit" && contract.operation.value === "insert" &&
      contract.target.state === "explicit" && contract.target.value === "document_end" &&
      contract.generationTasks?.state === "explicit" && contract.generationTasks.value.includes("custom"))
      .toBe(false);
  });

  it("does not treat a quoted request as an active edit command", () => {
    const contract = deriveInstructionContract("请解释“不要删除这个文件”是什么意思");

    expect(contract.operation.state).toBe("unknown");
    expect(contract.effect).toMatchObject({ state: "explicit", value: "answer" });
  });

  it("classifies a document summary that is answer-only as an answer, not a rewrite", () => {
    const contract = deriveInstructionContract("总结全文的三项决定，忽略重复背景，只回答，不修改文档。");

    expect(contract.effect).toMatchObject({ state: "explicit", value: "answer" });
    expect(contract.operation.state).toBe("unknown");
    expect(contract.scope).toMatchObject({ state: "explicit", value: "document" });
  });

  it.each(["在全文末尾新增总结，不修改原文", "文末写一段总结"])(
    "treats a summary requested as new content as an insertion: %s",
    (instruction) => {
      const contract = deriveInstructionContract(instruction);

      expect(contract.operation).toMatchObject({ state: "explicit", value: "insert" });
      expect(contract.target).toMatchObject({ state: "explicit", value: "document_end" });
      expect(contract.effect).toMatchObject({ state: "explicit", value: "edit" });
    }
  );

  it("keeps a negated bottom occurrence from authorizing a replacement", () => {
    for (const instruction of [
      "不要替换最后一处的 ‘hello’，改成 ‘helloworld’",
      "不改底部的 ‘hello’，改成 ‘helloworld’",
      "把 ‘hello’ 改成 ‘helloworld’，不要动最后一处",
      "把 ‘hello’ 改成 ‘helloworld’，底部的 hello 不要动"
    ]) {
      const contract = deriveInstructionContract(instruction);
      expect(contract.occurrence.state, instruction).toBe("unknown");
      expect(contract.target.state, instruction).toBe("unknown");
    }
  });

  it("recognizes a change-to replacement and preserves quoted find/write roles", () => {
    const quoted = deriveInstructionContract("change ‘hello’ to ‘helloworld’ at the bottom");
    const unquoted = deriveInstructionContract("change hello to helloworld at the bottom");

    expect(quoted.operation).toMatchObject({ state: "explicit", value: "replace_exact" });
    expect(quoted.target).toMatchObject({ state: "explicit", value: "document" });
    expect(quoted.occurrence).toMatchObject({ state: "explicit", value: "last" });
    expect(quoted.literals.map(({ role, value }) => ({ role, value }))).toEqual([
      { role: "find", value: "hello" },
      { role: "write", value: "helloworld" }
    ]);
    expect(unquoted.literals.map(({ role, value }) => ({ role, value }))).toEqual([
      { role: "find", value: "hello" },
      { role: "write", value: "helloworld" }
    ]);
  });

  it("does not treat ‘do not forget’ as an edit negation and records evidence for a true no-edit", () => {
    const positive = deriveInstructionContract("不要忘记润色选区");
    const negative = deriveInstructionContract("不要在底部加hello");

    expect(positive.operation).toMatchObject({ state: "explicit", value: "rewrite" });
    expect(positive.scope).toMatchObject({ state: "explicit", value: "selection" });
    expect(negative.effect).toMatchObject({ state: "explicit", value: "no_edit" });
    if (negative.effect.state === "explicit") {
      expect(negative.effect.evidence).toEqual([{ from: 0, to: 2, raw: "不要" }]);
      expect("不要在底部加hello".slice(negative.effect.evidence[0].from, negative.effect.evidence[0].to)).toBe(negative.effect.evidence[0].raw);
    }
  });

  it("uses cursor insertion as inline unless the instruction requests a block", () => {
    const contract = deriveInstructionContract("在光标处原样插入“  keep spaces  ”");

    expect(contract.target).toMatchObject({ state: "explicit", value: "cursor" });
    expect(contract.layout).toMatchObject({ state: "explicit", value: "inline" });
    expect(contract.literals[0]).toMatchObject({ role: "write", value: "  keep spaces  " });
  });

  it("keeps a numbered section-end anchor distinct from the generic document-end word", () => {
    const contract = deriveInstructionContract("在第 2 个“结果”章节末尾添加“该结果已复核”");

    expect(contract.target).toMatchObject({ state: "explicit", value: "section_end" });
    expect(contract.heading).toMatchObject({ state: "explicit", value: { text: "结果", relation: "section_end", ordinal: 2 } });
    expect(contract.scope.state).toBe("unknown");
    expect(contract.occurrence.state).toBe("unknown");
  });

  it("treats a single literal replacing the explicitly selected fragment as a selection rewrite", () => {
    const contract = deriveInstructionContract("将当前选中的片段原样替换为“**已定稿**”", { hasSelection: true });

    expect(contract.operation).toMatchObject({ state: "explicit", value: "rewrite" });
    expect(contract.target).toMatchObject({ state: "explicit", value: "selection" });
    expect(contract.literals.map(({ role, value }) => ({ role, value }))).toEqual([{ role: "write", value: "**已定稿**" }]);
  });

  it("recognizes inserting a paragraph at the cursor as a block layout", () => {
    const contract = deriveInstructionContract("在光标处插入段落“计算前提已确认”", { hasCursor: true });

    expect(contract.target).toMatchObject({ state: "explicit", value: "cursor" });
    expect(contract.layout).toMatchObject({ state: "explicit", value: "block" });
  });

  it("requires clarification when one instruction names different heading anchors", () => {
    const instruction = "在标题‘结果’后和标题‘摘要’后都添加‘已完成’";
    const contract = deriveInstructionContract(instruction);
    const candidates = buildAiIntentCandidates(instruction, "# 结果\n\n# 摘要\n", contract);
    const schema = buildIntentOutputSchema(instruction, false, candidates, contract);

    expect(contract.heading.state).toBe("ambiguous");
    expect(contract.issues).toContainEqual(expect.objectContaining({ code: "compound" }));
    const kinds = (schema.anyOf as Array<{ properties: { kind: { const?: string; enum?: string[] } } }>).flatMap(({ properties }) =>
      properties.kind.const ? [properties.kind.const] : properties.kind.enum ?? []);
    expect(kinds).toContain("clarify");
    expect(kinds).not.toContain("edit");
    expect(kinds).not.toContain("answer");
  });

  it("does not mark repeated evidence for the same heading as conflicting", () => {
    const contract = deriveInstructionContract("在标题‘结果’后（即标题‘结果’后）添加‘已完成’");

    expect(contract.heading).toMatchObject({ state: "explicit", value: { text: "结果", relation: "heading_end" } });
    expect(contract.heading.state).not.toBe("ambiguous");
  });

  it("does not classify an entire unquoted English instruction as literal content", () => {
    const contract = deriveInstructionContract("append hello to the end of the document");

    expect(contract.operation).toMatchObject({ state: "explicit", value: "insert" });
    expect(contract.literals.some(({ role, value }) => role === "write" && value === "append hello to the end of the document")).toBe(false);
  });
});
