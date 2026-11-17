import { describe, expect, it, vi } from "vitest";
import { buildIntentPlanningPrompt, buildIntentSystemPrompt, extractIntentLiterals, INTENT_SYSTEM_PROMPT } from "../../src/core/ai/intentPrompts";
import { planAiIntent } from "../../src/core/ai/intentPlanner";
import { parseIntentOutput } from "../../src/core/ai/intentSchema";
import { IntentProtocolError, type IntentCandidates } from "../../src/core/ai/intentTypes";

const noCandidates: IntentCandidates = { headings: [], literals: [] };
const append = (text = "hello") => JSON.stringify({
  version: 1, kind: "edit", operation: "insert", target: "document_end", layout: "block",
  content: { mode: "literal", text }
});

describe("AI intent wire protocol", () => {
  it("accepts a grounded literal append plan without a deterministic natural-language fast path", () => {
    expect(parseIntentOutput(append(), "底部加hello", noCandidates)).toEqual({
      version: 1, kind: "edit", operation: "insert", target: "document_end", layout: "block",
      content: { mode: "literal", text: "hello" }
    });
  });

  it("accepts generated edits, assistant answers, and explicit clarification results", () => {
    expect(parseIntentOutput(JSON.stringify({
      version: 1, kind: "edit", operation: "rewrite", target: "selection", content: { mode: "generate", task: "polish" }
    }), "润色选区", noCandidates).kind).toBe("edit");
    expect(parseIntentOutput(JSON.stringify({
      version: 1, kind: "answer", target: "document", content: { mode: "generate", task: "summarize" }
    }), "总结这篇文章", noCandidates).kind).toBe("answer");
    expect(parseIntentOutput(JSON.stringify({ version: 1, kind: "clarify", reason: "compound" }), "加 hello 再润色", noCandidates))
      .toEqual({ version: 1, kind: "clarify", reason: "compound" });
  });

  it("resolves only known literal and heading IDs and exact-match fields", () => {
    const candidates: IntentCandidates = {
      headings: [{ id: "heading-2", text: "结论", level: 2 }],
      literals: [{ id: "literal-1", text: "一段需要原样保留的很长内容" }]
    };
    expect(parseIntentOutput(JSON.stringify({
      version: 1, kind: "edit", operation: "insert", target: "section_end", targetId: "heading-2", layout: "block",
      content: { mode: "literal", literalId: "literal-1" }
    }), "在文末追加“一段需要原样保留的很长内容”", candidates).kind).toBe("edit");
    expect(parseIntentOutput(JSON.stringify({
      version: 1, kind: "edit", operation: "insert", target: "exact_match", layout: "inline",
      find: "校验完成。", occurrence: 2, matchScope: "document", content: { mode: "literal", text: "版本 2" }
    }), "在第二处‘校验完成。’后加一行版本 2", candidates).kind).toBe("edit");
  });

  it("accepts one complete JSON transport fence before strict intent validation", () => {
    expect(parseIntentOutput(`\`\`\`json\n${append()}\n\`\`\``, "底部加hello", noCandidates))
      .toMatchObject({ kind: "edit", content: { mode: "literal", text: "hello" } });
  });

  it("rejects malformed, duplicated, truncated, ambiguous, overlong, or extra-field JSON", () => {
    const malformed = [
      '{"version":1,"version":1,"kind":"clarify","reason":"compound"}',
      '说明\n```json\n{"version":1,"kind":"clarify","reason":"compound"}\n```',
      '```json\n{"version":1,"version":1,"kind":"clarify","reason":"compound"}\n```',
      '```json\n{"version":1,"kind":"clarify","reason":"compound"}\n```\n```json\n{}\n```',
      '{"version":1,"kind":"clarify","reason":"compound"} explanation',
      '{"version":1,"kind":"clarify","reason":"compound"',
      '{"version":1,"kind":"clarify","reason":"compound","extra":true}',
      JSON.stringify({ version: 1, kind: "clarify", reason: "compound", padding: "x".repeat(4096) })
    ];
    for (const output of malformed) expect(() => parseIntentOutput(output, "修改文稿", noCandidates)).toThrow(IntentProtocolError);
  });

  it("rejects ungrounded content, unknown IDs, invalid combinations, and invented ordinals", () => {
    const invalid = [
      [append("invented"), "底部加hello", noCandidates],
      [JSON.stringify({ version: 1, kind: "edit", operation: "insert", target: "document_end", layout: "block", content: { mode: "literal", literalId: "missing" } }), "底部加hello", noCandidates],
      [JSON.stringify({ version: 1, kind: "edit", operation: "rewrite", target: "document_end", layout: "block", content: { mode: "generate", task: "custom" } }), "修改全文", noCandidates],
      [JSON.stringify({ version: 1, kind: "edit", operation: "insert", target: "exact_match", layout: "block", find: "alpha", occurrence: 2, matchScope: "document", content: { mode: "literal", text: "beta" } }), "把 alpha 换成 beta", noCandidates],
      [JSON.stringify({ version: 1, kind: "edit", operation: "replace_exact", target: "document", find: "alpha", occurrence: "all", content: { mode: "literal", text: "beta" } }), "把 alpha 换成 beta", noCandidates],
      [JSON.stringify({ version: 1, kind: "edit", operation: "rewrite", target: "document", content: { mode: "literal", text: "" } }), "清空全文", noCandidates]
    ] as const;
    for (const [output, instruction, candidates] of invalid) {
      expect(() => parseIntentOutput(output, instruction, candidates)).toThrow(IntentProtocolError);
    }
  });

  it("rejects find and occurrence fields on rewrite instead of silently dropping them", () => {
    const validRewrite = { version: 1, kind: "edit", operation: "rewrite", target: "document", content: { mode: "generate", task: "polish" } };
    for (const extra of [{ find: "原文" }, { occurrence: "all" }, { find: "原文", occurrence: "all" }]) {
      expect(() => parseIntentOutput(JSON.stringify({ ...validRewrite, ...extra }), "润色全文", noCandidates))
        .toThrow(IntentProtocolError);
    }
  });
});

describe("AI intent prompt and planner", () => {
  it("extracts lossless quoted candidates and assigns stable local IDs", () => {
    expect(extractIntentLiterals("文末添加“第一段”再引用 \"second\" 和 ‘第三段’" )).toEqual([
      { id: "literal-1", text: "第一段" },
      { id: "literal-2", text: "second" },
      { id: "literal-3", text: "第三段" }
    ]);
  });

  it("harvests only a bounded exact unquoted ASCII tail when no quoted candidate exists", () => {
    expect(extractIntentLiterals("底部加个hello，world")).toEqual([{ id: "literal-1", text: "hello，world" }]);
    expect(extractIntentLiterals("底部加个 hello， world")).toEqual([{ id: "literal-1", text: "hello， world" }]);
    expect(extractIntentLiterals("底部加个 hello， world  ")).toEqual([{ id: "literal-1", text: "hello， world  " }]);
    expect(extractIntentLiterals("解释GPT")).toEqual([{ id: "literal-1", text: "GPT" }]);
    expect(extractIntentLiterals("append hello to the end")).toEqual([]);
    expect(extractIntentLiterals("底部加hello，world后不要改原文")).toEqual([]);
    expect(extractIntentLiterals(`底部加${"x".repeat(257)}`)).toEqual([]);
    expect(extractIntentLiterals("文末原样添加“引用文本”后追加 tail")).toEqual([{ id: "literal-1", text: "引用文本" }]);
  });

  it("builds a no-selection system prompt without selection-target examples", () => {
    const prompt = buildIntentPlanningPrompt("底部加hello", false, {
      headings: [{ id: "h1", text: "结论", level: 2 }], literals: [], incomplete: true
    });
    const systemPrompt = buildIntentSystemPrompt(false);
    expect(prompt).toContain("底部加hello");
    expect(prompt).toContain("结论");
    expect(prompt).toContain('"incomplete":true');
    expect(prompt).toContain("当前没有选区");
    expect(prompt).not.toContain("documentBody");
    expect(systemPrompt).toContain("范围由程序锁定为全文");
    expect(systemPrompt).toContain("底部加个hello，world");
    expect(systemPrompt).toContain("候选literal-1=hello，world");
    expect(systemPrompt).toContain('"content":{"mode":"literal","literalId":"literal-1"}');
    expect(systemPrompt).toContain('"mode":"literal","text":"原句文字"');
    expect(systemPrompt).toContain('"target":"document","content":{"mode":"generate","task":"polish"}');
    expect(systemPrompt).not.toContain('"target":"selection"');
    expect(systemPrompt).not.toContain('"target":"selection_end"');
    expect(systemPrompt).not.toContain('"reason":"scope_conflict"');
    expect(systemPrompt).toContain("纯否定返回");
    expect(systemPrompt).toContain("插入位置单独解析");
    expect(systemPrompt).toContain("是内容约束，不是第二次文稿编辑");
    expect(systemPrompt).toContain("多个操作返回 clarify/compound");
    expect(systemPrompt).toContain('"findId":"literal-1","occurrence":"single"');
    expect(systemPrompt).toContain('"findId":"literal-1","occurrence":"last"');
    expect(systemPrompt).toContain("不知道出现次数也用 single");
    expect(INTENT_SYSTEM_PROMPT).toBe(systemPrompt);
  });

  it("calls the planner exactly once and returns a buffered canonical plan", async () => {
    const invoke = vi.fn<(prompt: string, systemPrompt: string, maxTokens: number) => Promise<string>>(async () => append());
    await expect(planAiIntent("底部加hello", false, noCandidates, invoke)).resolves.toMatchObject({
      kind: "edit", operation: "insert", target: "document_end", content: { mode: "literal", text: "hello" }
    });
    expect(invoke).toHaveBeenCalledTimes(1);
    expect(invoke.mock.calls[0][2]).toBe(384);
    expect(invoke.mock.calls[0][1]).toBe(buildIntentSystemPrompt(false, noCandidates));
    expect((invoke.mock.calls[0] as unknown[])[3]).toHaveProperty("anyOf");
  });

  it("keeps full-document scope separate from insertion position when a selection exists", async () => {
    const prompt = buildIntentPlanningPrompt("润色全文", true, noCandidates);
    expect(prompt).toContain("rewrite target=document");
    expect(prompt).toContain("全文最末尾插入");
    const selectedSystemPrompt = buildIntentSystemPrompt(true);
    expect(selectedSystemPrompt).toContain('"target":"document"');
    expect(selectedSystemPrompt).toContain('"target":"selection"');
    expect(selectedSystemPrompt).toContain('"target":"document_end"');

    const rewrite = JSON.stringify({ version: 1, kind: "edit", operation: "rewrite", target: "document", content: { mode: "generate", task: "polish" } });
    const selectedRewrite = vi.fn<(prompt: string, systemPrompt: string, maxTokens: number) => Promise<string>>(async () => rewrite);
    await expect(planAiIntent("润色全文", true, noCandidates, selectedRewrite)).resolves.toMatchObject({ kind: "edit", operation: "rewrite", target: "document" });
    expect(selectedRewrite.mock.calls[0][1]).toBe(selectedSystemPrompt);

    const selectionPlan = JSON.stringify({ version: 1, kind: "edit", operation: "rewrite", target: "selection", content: { mode: "generate", task: "polish" } });
    await expect(planAiIntent("润色", true, noCandidates, vi.fn(async () => selectionPlan))).resolves.toMatchObject({ kind: "edit", target: "selection" });
  });

  it("turns no-selection scope conflicts and wrong targets into actionable errors", async () => {
    const clarifyConflict = JSON.stringify({ version: 1, kind: "clarify", reason: "scope_conflict" });
    const selectionPlan = JSON.stringify({ version: 1, kind: "edit", operation: "rewrite", target: "selection", content: { mode: "generate", task: "polish" } });
    const documentPlan = JSON.stringify({ version: 1, kind: "edit", operation: "rewrite", target: "document", content: { mode: "generate", task: "polish" } });
    const selectionError = /当前没有选区，请先选择要处理的内容/;
    const modelMismatch = /模型生成了与当前文档范围不一致的计划，原文未修改/;

    const implicitConflict = vi.fn(async () => clarifyConflict);
    await expect(planAiIntent("底部加hello", false, noCandidates, implicitConflict)).rejects.toThrow(modelMismatch);
    expect(implicitConflict).toHaveBeenCalledTimes(1);

    const wrongTarget = vi.fn(async () => selectionPlan);
    await expect(planAiIntent("润色", false, noCandidates, wrongTarget)).rejects.toThrow(modelMismatch);
    expect(wrongTarget).toHaveBeenCalledTimes(1);

    const explicitConflict = vi.fn(async () => clarifyConflict);
    await expect(planAiIntent("润色选区", false, noCandidates, explicitConflict)).rejects.toThrow(selectionError);

    const explicitMissing = vi.fn(async () => documentPlan);
    await expect(planAiIntent("只处理选中的文字", false, noCandidates, explicitMissing)).rejects.toThrow(selectionError);
    expect(explicitMissing).toHaveBeenCalledTimes(1);

    const explicitTarget = vi.fn(async () => selectionPlan);
    await expect(planAiIntent("只润色选区", false, noCandidates, explicitTarget)).rejects.toThrow(selectionError);
    expect(explicitTarget).toHaveBeenCalledTimes(1);

    for (const instruction of ["选区加 hello", "只润色选区而不要改其他部分", "不要忘记润色选区", "polish the selected text and do not edit anything else"]) {
      await expect(planAiIntent(instruction, false, noCandidates, vi.fn(async () => documentPlan))).rejects.toThrow(selectionError);
    }

    for (const instruction of ["选区末尾加 hello", "polish the selected text", "只润色选区且不要改其他部分"]) {
      await expect(planAiIntent(instruction, false, noCandidates, vi.fn(async () => documentPlan))).rejects.toThrow(selectionError);
    }

    await expect(planAiIntent("不要处理选区，只处理全文", false, noCandidates, vi.fn(async () => documentPlan)))
      .resolves.toMatchObject({ kind: "edit", target: "document" });

    const quotedPayload = vi.fn(async () => append("选区"));
    await expect(planAiIntent("文末原样添加‘选区’", false, noCandidates, quotedPayload)).resolves.toMatchObject({ kind: "edit", target: "document_end", content: { mode: "literal", text: "选区" } });

    const unquotedPayload = vi.fn(async () => append("选区"));
    await expect(planAiIntent("底部加个选区", false, noCandidates, unquotedPayload)).resolves.toMatchObject({ kind: "edit", target: "document_end" });

    const answerAboutSelection = JSON.stringify({ version: 1, kind: "answer", target: "document", content: { mode: "generate", task: "custom" } });
    await expect(planAiIntent("解释‘选区’是什么意思", false, noCandidates, vi.fn(async () => answerAboutSelection))).resolves.toMatchObject({ kind: "answer", target: "document" });

    const badOutput = vi.fn(async () => "not json");
    await expect(planAiIntent("底部加hello", false, noCandidates, badOutput)).rejects.toThrow(IntentProtocolError);
    expect(badOutput).toHaveBeenCalledTimes(1);
  });

  it("plans exact candidate IDs for unquoted append text without copying punctuation", async () => {
    const cases = [
      ["底部加个hello，world", "hello，world"],
      ["底部加个 hello， world", "hello， world"]
    ] as const;
    for (const [instruction, literal] of cases) {
      const candidates = { headings: [], literals: extractIntentLiterals(instruction) } satisfies IntentCandidates;
      expect(candidates.literals).toEqual([{ id: "literal-1", text: literal }]);
      const invoke = vi.fn(async () => JSON.stringify({ version: 1, kind: "edit", operation: "insert", target: "document_end", layout: "block", content: { mode: "literal", literalId: "literal-1" } }));
      await expect(planAiIntent(instruction, false, candidates, invoke)).resolves.toMatchObject({ kind: "edit", target: "document_end", content: { mode: "literal", literalId: "literal-1" } });
      expect(invoke).toHaveBeenCalledTimes(1);
    }

    const english = "append hello to the end";
    const englishCandidates = { headings: [], literals: extractIntentLiterals(english) } satisfies IntentCandidates;
    await expect(planAiIntent(english, false, englishCandidates, vi.fn(async () => append("hello"))))
      .resolves.toMatchObject({ kind: "edit", target: "document_end", content: { mode: "literal", text: "hello" } });
  });

  it("keeps a harvested question term as data while the answer plan still generates", async () => {
    const instruction = "解释GPT";
    const candidates = { headings: [], literals: extractIntentLiterals(instruction) } satisfies IntentCandidates;
    const answer = JSON.stringify({ version: 1, kind: "answer", target: "document", content: { mode: "generate", task: "custom" } });
    await expect(planAiIntent(instruction, false, candidates, vi.fn(async () => answer)))
      .resolves.toEqual({ version: 1, kind: "answer", target: "document", content: { mode: "generate", task: "custom" } });
  });

  it("retrieves examples by literal data shape while preserving answer and edit choices", () => {
    const single = { headings: [], literals: [{ id: "literal-1", text: "底部加hello" }] };
    const pair = { headings: [], literals: [{ id: "literal-1", text: "hello" }, { id: "literal-2", text: "helloworld" }] };
    const one = buildIntentSystemPrompt(false, single);
    const two = buildIntentSystemPrompt(false, pair);
    expect(one).toContain('"kind":"answer"');
    expect(one).toContain('"operation":"insert"');
    expect(one).toContain("replace_exact");
    expect(one).toContain("解释“底部加hello”是什么意思");
    expect(one).not.toContain('"literalId":"literal-2"');
    expect(two).toContain('"literalId":"literal-2"');
    expect(one.length).toBeLessThan(two.length);
  });

  it("keeps the active-selection clarification and whole-document position rules", async () => {
    const clarify = JSON.stringify({ version: 1, kind: "clarify", reason: "scope_conflict" });
    await expect(planAiIntent("底部加hello", true, noCandidates, vi.fn(async () => clarify))).resolves.toEqual({ version: 1, kind: "clarify", reason: "scope_conflict" });

    const appendToDocument = vi.fn<(prompt: string, systemPrompt: string, maxTokens: number) => Promise<string>>(async () => append());
    await expect(planAiIntent("把 hello 加到全文最末尾", true, noCandidates, appendToDocument)).resolves.toMatchObject({ kind: "edit", operation: "insert", target: "document_end" });
    expect(appendToDocument.mock.calls[0][1]).toBe(buildIntentSystemPrompt(true));
  });

  it("does not invoke the model when the prompt exceeds the shared local context budget", async () => {
    const invoke = vi.fn(async () => append());
    await expect(planAiIntent("说明".repeat(5000), false, noCandidates, invoke)).rejects.toMatchObject({ code: "budget_exceeded" });
    expect(invoke).not.toHaveBeenCalled();
  });
});
