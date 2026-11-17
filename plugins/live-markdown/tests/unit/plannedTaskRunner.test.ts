import { describe, it, expect, vi } from "vitest";
import { proseResponse } from "../helpers/proseResponses";
// Retained full-policy regression; default thin behavior has separate production-entry tests.
import { runFullHarnessTaskCore as runPlannedAiTask } from "../../src/core/ai/fullHarnessTaskRunnerCore";
import { createAiTaskExecution, AiTaskCancelledError } from "../../src/core/ai/aiTaskExecution";
import { resolveAiEdit, isAiProposalCurrent } from "../../src/core/ai/editProposal";
import { estimateAiTokens } from "../../src/core/ai/markdownChunker";
import type { AiDocumentSnapshot } from "../../src/types/aiEditing";
import type { AiTaskRequest, AiTaskRunnerOptions } from "../../src/core/ai/aiTaskRunner";

const source = "# 计划\n\n需要检查文稿。\n\n```js\nconst x = 1;\n```\n\n最后保留。";
const snapshot = (overrides: Partial<AiDocumentSnapshot> = {}): AiDocumentSnapshot => ({
  documentId: "test.md", revision: 1, content: source, selection: null, cursor: 0, readOnly: false, ...overrides
});
const request = (prompt: string, content = source): AiTaskRequest => ({
  source: content, action: "custom", userPrompt: prompt, baseSystemPrompt: "只输出结果。",
  actionDefinition: { id: "custom", label: "自定义", prompt }
});
const literal = { version: 1, kind: "edit", operation: "insert", target: "document_end", layout: "block", content: { mode: "literal", text: "hello" } };
function options(invoke: AiTaskRunnerOptions["invoke"], extra: Partial<AiTaskRunnerOptions> = {}): AiTaskRunnerOptions {
  return { invoke, isCurrent: () => true, abortCurrent: vi.fn(), ...extra };
}

describe("planned natural-language execution", () => {
  it("plans once for a complete literal append with unknown layout, preserves all original bytes, and streams no JSON", async () => {
    const onChunk = vi.fn();
    const plan = { version: 1, kind: "edit", operation: "insert", target: "document_end", layout: "block", content: { mode: "literal", text: "hello" } };
    const invoke = vi.fn(async () => JSON.stringify(plan));
    const result = await runPlannedAiTask(request("底部加hello"), snapshot(), options(invoke, { onChunk }));
    expect(invoke).toHaveBeenCalledTimes(1);
    expect(onChunk).not.toHaveBeenCalled();
    expect(result.planningMode).toBe("model");
    expect(result.proposal?.patch).toEqual({ from: source.length, to: source.length, expectedText: "", insertText: "\n\nhello" });
    expect(resolveAiEdit(result.proposal!)?.content).toBe(source + "\n\nhello");
  });

  it("binds an explicit document end independently of selection and cursor", async () => {
    const start = snapshot({ selection: { from: 0, to: 4 } });
    const invoke = vi.fn(async () => JSON.stringify(literal));
    const result = await runPlannedAiTask(request("在全文末尾加hello"), start, options(invoke));
    expect(invoke).toHaveBeenCalledTimes(1);
    expect(result.planningMode).toBe("model");
    expect(result.proposal?.patch?.from).toBe(source.length);
    expect(isAiProposalCurrent(result.proposal!, { ...start, selection: null, cursor: 9 })).toBe(true);
    expect(isAiProposalCurrent(result.proposal!, { ...start, revision: 2 })).toBe(false);
  });

  it("plans once for an unquoted literal candidate and preserves its punctuation", async () => {
    const plan = { version: 1, kind: "edit", operation: "insert", target: "document_end", layout: "block", content: { mode: "literal", literalId: "literal-1" } };
    const invoke = vi.fn(async () => JSON.stringify(plan));
    const result = await runPlannedAiTask(request("底部加个hello， world"), snapshot(), options(invoke));
    expect(invoke).toHaveBeenCalledTimes(1);
    expect(result.planningMode).toBe("model");
    expect(result.proposal?.patch?.insertText).toBe("\n\nhello， world");
    expect(resolveAiEdit(result.proposal!)?.content).toBe(source + "\n\nhello， world");
  });

  it("plans a free-form append before one content call and creates one EOF patch", async () => {
    const outputs = [JSON.stringify({ version: 1, kind: "edit", operation: "insert", target: "document_end", layout: "block", content: { mode: "generate", task: "summarize" } }), "## 摘要\n\n先检查，再发布。"];
    const invoke = vi.fn<AiTaskRunnerOptions["invoke"]>(async () => outputs.shift()!);
    const result = await runPlannedAiTask(request("在文末写一段总结"), snapshot(), options(invoke));
    expect(invoke).toHaveBeenCalledTimes(2);
    expect(result.planningMode).toBe("model");
    expect(result.proposal?.mode).toBe("append");
    expect((invoke.mock.calls[0] as unknown[])[4]).toHaveProperty("anyOf");
    expect(invoke.mock.calls[1][1]).not.toContain("只续写");
    expect((invoke.mock.calls[1] as unknown[])[4]).toBeUndefined();
    expect(resolveAiEdit(result.proposal!)?.content).toBe(source + "\n\n## 摘要\n\n先检查，再发布。");
  });

  it("answers without creating a document patch or requiring prose AST equivalence", async () => {
    const outputs = [JSON.stringify({ version: 1, kind: "answer", target: "document", content: { mode: "generate", task: "custom" } }), "这条指令表示在文档末尾新增指定文字。"];
    const invoke = vi.fn<AiTaskRunnerOptions["invoke"]>(async () => outputs.shift()!);
    const result = await runPlannedAiTask(request("解释‘底部加hello’是什么意思"), snapshot(), options(invoke));
    expect(result.answerOnly).toBe(true);
    expect(result.proposal).toBeUndefined();
    expect(invoke).toHaveBeenCalledTimes(2);
    expect(invoke.mock.calls[1][0]).toContain("解释‘底部加hello’是什么意思");
  });

  it("answers a source-independent question on a long Welcome document without source selection", async () => {
    const welcome = (`# Welcome\n\n${"Welcome to the local Markdown workspace. This guide explains editing, live preview, navigation, and history. ".repeat(100)}`).slice(0, 3_400);
    const instruction = "请解释“底部加hello”是什么意思，勿修改文稿。";
    const answerPlan = { version: 1, kind: "answer", target: "document", content: { mode: "generate", task: "custom" } };
    const outputs = [JSON.stringify(answerPlan), "这条指令表示在文档末尾新增指定文字。"];
    const invoke = vi.fn<AiTaskRunnerOptions["invoke"]>(async () => outputs.shift()!);

    expect(welcome).toHaveLength(3_400);
    expect(estimateAiTokens(welcome)).toBeGreaterThan(1_400);
    const result = await runPlannedAiTask(request(instruction, welcome), snapshot({ content: welcome }), options(invoke));

    expect(result.executionPlan).toMatchObject({ kind: "answer", task: "custom", artifact: { sourceDependent: true } });
    expect(result.answerOnly).toBe(true);
    expect(result.proposal).toBeUndefined();
    expect(invoke).toHaveBeenCalledTimes(2);
    expect(invoke.mock.calls[0][0]).toContain(instruction);
    expect(invoke.mock.calls[0][0]).not.toContain(welcome.slice(100, 160));
    expect(invoke.mock.calls[1][0]).toContain(instruction);
    expect(invoke.mock.calls[1][0]).not.toContain(welcome.slice(100, 160));
    expect(invoke.mock.calls[1][0]).not.toContain("全文上下文");
    expect(invoke.mock.calls[1][1]).toContain("当前任务不依赖文档");
    expect(invoke.mock.calls[1][4]).toBeUndefined();
  });

  it("generates one replacement phrase and preserves the bytes between all exact matches", async () => {
    const content = "说明待检查，稍后待检查。";
    const outputs = [JSON.stringify({ version: 1, kind: "edit", operation: "replace_exact", target: "document", find: "待检查", occurrence: "all", content: { mode: "generate", task: "custom" } }), "待复核"];
    const invoke = vi.fn<AiTaskRunnerOptions["invoke"]>(async () => outputs.shift()!);
    const result = await runPlannedAiTask(request("将所有‘待检查’换成更正式的表达", content), snapshot({ content }), options(invoke));
    expect(invoke).toHaveBeenCalledTimes(2);
    expect(invoke.mock.calls[1][0]).toContain("只输出用于替换每一处");
    expect(resolveAiEdit(result.proposal!)?.content).toBe("说明待复核，稍后待复核。");
  });

  it("plans the reported bottom replacement once and preserves the earlier same text", async () => {
    const content = `${source}\n\nhello\n\n中间保留。\n\nhello`;
    const plan = { version: 1, kind: "edit", operation: "replace_exact", target: "document", findId: "literal-1", occurrence: "last", content: { mode: "literal", literalId: "literal-2" } };
    const invoke = vi.fn(async () => JSON.stringify(plan));
    const result = await runPlannedAiTask(request("底部hello改成helloworld", content), snapshot({ content }), options(invoke));
    const from = content.lastIndexOf("hello");
    expect(invoke).toHaveBeenCalledTimes(0);
    expect(result.proposal?.patch).toEqual({ from, to: from + 5, expectedText: "hello", insertText: "helloworld" });
    expect(resolveAiEdit(result.proposal!)?.content).toBe(content.slice(0, from) + "helloworld");
    expect(result.proposal?.summary).toContain("最后一处");
    expect(result.proposal?.snapshot.content).toBe(content);
  });

  it("binds all literal replacements without planning and preserves separators", async () => {
    const content = "hello\r\n\r\n中间 **不变**。\r\n\r\nhello";
    const invoke = vi.fn(async () => { throw new Error("A complete all-replacement literal must not call the model."); });
    const result = await runPlannedAiTask(request("把所有 hello 替换为 helloworld", content), snapshot({ content }), options(invoke));
    expect(invoke).not.toHaveBeenCalled();
    expect(result.planningMode).toBe("program");
    expect(result.proposal?.snapshot.content).toBe(content);
    expect(resolveAiEdit(result.proposal!)?.content).toBe("helloworld\r\n\r\n中间 **不变**。\r\n\r\nhelloworld");
  });

  it.each(["**world**", "[world](https://example.com)", "$world$"])("preserves the complete Markdown replacement literal %s", async (replacement) => {
    const content = `${source}\n\nhello`;
    const plan = { version: 1, kind: "edit", operation: "replace_exact", target: "document", findId: "literal-1", occurrence: "last", content: { mode: "literal", literalId: "literal-2" } };
    const invoke = vi.fn(async () => JSON.stringify(plan));
    const result = await runPlannedAiTask(request(`底部hello改成${replacement}`, content), snapshot({ content }), options(invoke));
    expect(invoke).toHaveBeenCalledTimes(0);
    expect(resolveAiEdit(result.proposal!)?.content).toBe(content.slice(0, -5) + replacement);
    expect(result.proposal?.patch?.insertText).toBe(replacement);
  });

  it("changes only the authorized protected last match with the literal capability", async () => {
    const content = "hello\n\n```txt\nhello\n```";
    const plan = { version: 1, kind: "edit", operation: "replace_exact", target: "document", find: "hello", occurrence: "last", content: { mode: "literal", text: "helloworld" } };
    const invoke = vi.fn(async () => JSON.stringify(plan));
    const result = await runPlannedAiTask(request("文末hello改成helloworld", content), snapshot({ content }), options(invoke));
    expect(resolveAiEdit(result.proposal!)?.content).toBe("hello\n\n```txt\nhelloworld\n```");
    expect(result.proposal?.patch?.from).toBe(content.lastIndexOf("hello"));
    expect(invoke).toHaveBeenCalledTimes(0);
  });

  it("does not retry or fall back to a full rewrite when an exact replacement is absent or ambiguous", async () => {
    for (const [content, message] of [["原文没有该词。", /没有在指定范围找到/], ["hello\n\nhello", /多处匹配/]] as const) {
      const plan = { version: 1, kind: "edit", operation: "replace_exact", target: "document", findId: "literal-1", occurrence: "single", content: { mode: "literal", literalId: "literal-2" } };
      const invoke = vi.fn(async () => JSON.stringify(plan));
      await expect(runPlannedAiTask(request("把hello换成helloworld", content), snapshot({ content }), options(invoke))).rejects.toThrow(message);
      expect(invoke).toHaveBeenCalledTimes(1);
    }
  });

  it("uses a complete literal contract without consulting a conflicting model", async () => {
    const content = "草案";
    const invoke = vi.fn(async () => JSON.stringify({ version: 1, kind: "edit", operation: "replace_exact", target: "document", findId: "literal-1", occurrence: "last", content: { mode: "literal", literalId: "literal-1" } }));
    const result = await runPlannedAiTask(request("把文末的“草案”改成“终稿”", content), snapshot({ content }), options(invoke));
    expect(result.proposal?.patch?.insertText).toBe("终稿");
    expect(result.planningMode).toBe("program");
    expect(invoke).toHaveBeenCalledTimes(0);
  });

  it.each([
    ['{"version":1,"kind":"clarify","reason":"compound"}', '底部加hello，再润色第一段', /多个.*操作/],
    ["```json\n{}\n```", "让这份文档更容易被新同事阅读。", /明确编辑计划/]
  ])("terminates unsafe/ambiguous plans without a generation or retry", async (output, instruction, message) => {
    const invoke = vi.fn(async () => output);
    await expect(runPlannedAiTask(request(instruction), snapshot(), options(invoke))).rejects.toThrow(message);
    expect(invoke).toHaveBeenCalledTimes(1);
  });

  it("returns no_op without planning for a pure negative edit request", async () => {
    const invoke = vi.fn(async () => "unexpected model call");
    const result = await runPlannedAiTask(request("不要在底部加hello"), snapshot(), options(invoke));

    expect(result.executionPlan).toMatchObject({ kind: "no_op" });
    expect(result.proposal).toBeUndefined();
    expect(invoke).not.toHaveBeenCalled();
  });

  it("shares the call budget between planning and content, rather than resetting it", async () => {
    const invoke = vi.fn(async () => JSON.stringify({ ...literal, content: { mode: "generate", task: "summarize" } }));
    await expect(runPlannedAiTask(request("请在文末新增一段内容。"), snapshot(), options(invoke, { maxCalls: 1 }))).rejects.toThrow(/64 次/);
    expect(invoke).toHaveBeenCalledTimes(1);
  });

  it("binds an explicitly block-level verbatim quoted append without consulting a model", async () => {
    const invoke = vi.fn(async () => JSON.stringify({ ...literal, content: { mode: "generate", task: "summarize" } }));
    const result = await runPlannedAiTask(request("在文末另起一段，原样添加“你好，世界！”"), snapshot(), options(invoke));
    expect(invoke).not.toHaveBeenCalled();
    expect(result.planningMode).toBe("program");
    expect(result.proposal?.patch).toMatchObject({ from: source.length, to: source.length, expectedText: "", insertText: "\n\n你好，世界！" });
    expect(resolveAiEdit(result.proposal!)?.content).toBe(source + "\n\n你好，世界！");
  });

  it("rejects adding into an unclosed source fence with no content call", async () => {
    const content = "正文\n\n```js\nconst x=1";
    const invoke = vi.fn(async () => { throw new Error("An unclosed source fence must stop before inference."); });
    await expect(runPlannedAiTask(request("在底部另起一段加hello", content), snapshot({ content }), options(invoke))).rejects.toThrow(/代码块中途结束/);
    expect(invoke).not.toHaveBeenCalled();
  });

  it("keeps fixed polish buttons on their direct content path", async () => {
    const original = "文稿需要检查。";
    const polished = "文稿需要检查！";
    const invoke = vi.fn<AiTaskRunnerOptions["invoke"]>(async prompt => proseResponse(prompt, () => polished));
    const req = { ...request("", original), action: "polish" as const };
    const document = snapshot({ content: req.source });
    const result = await runPlannedAiTask(req, document, options(invoke));
    expect(invoke).toHaveBeenCalledTimes(1);
    expect(result.editAction).toBe(true);
    expect(result.proposal).toMatchObject({
      snapshot: document, text: polished, mode: "replace",
      patch: { from: 0, to: original.length, expectedText: original, insertText: polished }
    });
    expect(resolveAiEdit(result.proposal!)?.content).toBe(polished);
    expect(isAiProposalCurrent(result.proposal!, document)).toBe(true);
    expect(isAiProposalCurrent(result.proposal!, { ...document, selection: { from: 0, to: 2 } })).toBe(false);
    expect(invoke.mock.calls[0][0]).toContain("待编辑文本槽");
    expect((invoke.mock.calls[0] as unknown[])[4]).toHaveProperty("properties.protocol.const", "prose-edit/v1");
  });

  it("binds source-owned prose output to the exact selected range", async () => {
    const content = "前言保持不变。\n\n文稿需要检查。\n\n结尾保持不变。";
    const selected = "文稿需要检查。";
    const from = content.indexOf(selected);
    const polished = "文稿需要检查！";
    const req = { ...request("", selected), action: "polish" as const, scope: "selection" as const };
    const document = snapshot({ content, selection: { from, to: from + selected.length }, selectionValid: true });
    const invoke = vi.fn<AiTaskRunnerOptions["invoke"]>(async prompt => proseResponse(prompt, () => polished));

    const result = await runPlannedAiTask(req, document, options(invoke));
    expect(result.proposal).toMatchObject({
      snapshot: document, text: polished, mode: "replace",
      patch: { from, to: from + selected.length, expectedText: selected, insertText: polished }
    });
    expect(resolveAiEdit(result.proposal!)?.content).toBe(content.replace(selected, polished));
  });

  it("refuses source-owned output that cannot be bound to the captured selection", async () => {
    const selected = "其他内容。";
    const req = { ...request("", "文稿需要检查。"), action: "polish" as const, scope: "selection" as const };
    const document = snapshot({ content: selected, selection: { from: 0, to: selected.length }, selectionValid: true });
    const invoke = vi.fn<AiTaskRunnerOptions["invoke"]>(async prompt => proseResponse(prompt, () => "文稿需要检查！"));

    await expect(runPlannedAiTask(req, document, options(invoke))).rejects.toThrow(/选区无法与原始 Markdown 源码准确对应/);
  });

  it("does not manufacture a proposal when source-owned editing preserves all source bytes", async () => {
    const original = "文稿需要检查。";
    const req = { ...request("", original), action: "polish" as const };
    const invoke = vi.fn<AiTaskRunnerOptions["invoke"]>(async prompt => proseResponse(prompt));
    const result = await runPlannedAiTask(req, snapshot({ content: original }), options(invoke));

    expect(result.sourceOwned).toBe(true);
    expect(result.preservedSource).toBe(true);
    expect(result.proposal).toBeUndefined();
  });

  it("stops a read-only snapshot before model invocation without creating a proposal", async () => {
    const original = "文稿需要检查。";
    const req = { ...request("", original), action: "polish" as const };
    const document = snapshot({ content: original, readOnly: true });
    const invoke = vi.fn<AiTaskRunnerOptions["invoke"]>(async prompt => proseResponse(prompt, () => "文稿需要检查！"));

    await expect(runPlannedAiTask(req, document, options(invoke))).rejects.toThrow(/只读状态/u);
    expect(invoke).not.toHaveBeenCalled();
  });
});

describe("shared invocation fences", () => {
  it("cancels a pending planner, physically aborts, and ignores its late output", async () => {
    const controller = new AbortController();
    let resolve!: (value: string) => void;
    const abortCurrent = vi.fn();
    const onChunk = vi.fn();
    let emit!: (value: string) => void;
    const execution = createAiTaskExecution(options(async (_p, _s, _m, chunk) => {
      emit = chunk;
      return new Promise<string>((r) => { resolve = r; });
    }, { signal: controller.signal, abortCurrent, onChunk }));
    const pending = execution.invoke("p", "s", 384, { silent: true });
    await Promise.resolve();
    controller.abort();
    await expect(pending).rejects.toBeInstanceOf(AiTaskCancelledError);
    emit("late"); resolve("late");
    expect(abortCurrent).toHaveBeenCalled();
    expect(onChunk).not.toHaveBeenCalled();
  });

  it("aborts oversized streamed plans before they can return", async () => {
    const abortCurrent = vi.fn();
    const execution = createAiTaskExecution(options(async (_p, _s, _m, chunk) => {
      chunk("x".repeat(4097)); return new Promise<string>(() => undefined);
    }, { abortCurrent }));
    await expect(execution.invoke("p", "s", 384, { silent: true, maxOutputBytes: 4096 })).rejects.toThrow(/安全上限/);
    expect(abortCurrent).toHaveBeenCalledTimes(1);
  });
});
