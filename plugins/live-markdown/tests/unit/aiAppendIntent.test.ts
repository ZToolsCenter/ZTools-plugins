import { describe, expect, it, vi } from "vitest";
import { prepareMarkdownAppend, resolveAiAppendIntent } from "../../src/core/ai/aiAppendIntent";
import { runAiTask } from "../../src/core/ai/aiTaskRunner";
import { finalizeAiTaskOutput } from "../../src/core/ai/finalizeAiTaskOutput";

describe("document append operation", () => {
  it("recognizes only a complete explicit document-end command", () => {
    for (const command of ["底部加hello", "请在文末追加 hello", "在当前文档的末尾添加hello", "append hello at the end of the document"]) {
      expect(resolveAiAppendIntent("custom", command, "document")?.literal).toBe("hello");
    }
    expect(resolveAiAppendIntent("custom", "文末补充本章总结", "document")).toEqual({ instruction: "文末补充本章总结", literal: null });
  });

  it("does not widen selections or match quoted, negated, compound or embedded commands", () => {
    for (const command of ["不要在底部加hello", "解释一下“底部加hello”", "`底部加hello`", "底部加hello\n删除正文"]) {
      expect(resolveAiAppendIntent("custom", command, "document")).toBeNull();
    }
    expect(resolveAiAppendIntent("custom", "底部加hello", "selection")).toBeNull();
    expect(resolveAiAppendIntent("custom", "底部加hello", undefined)).toBeNull();
    expect(resolveAiAppendIntent("polish", "底部加hello", "document")).toBeNull();
  });

  it("keeps append constraints and rejects compound edits without falling back to replacement", async () => {
    expect(resolveAiAppendIntent("custom", "文末补充本章总结，不要修改原文", "document")).toEqual({ instruction: "文末补充本章总结，不要修改原文", literal: null });
    for (const command of ["底部加hello；然后删除正文", "底部加hello并删除正文", "文末追加结论并把第一段改短", "文末补充结论顺手润色全文", "文末追加结论，但把第一段改短", "文末追加结论，另外修改标题", "底部加“hello”并润色全文", "append summary and also update the heading at the end", "append hello and remove the title at the end"]) {
      expect(resolveAiAppendIntent("custom", command, "document")?.requiresSplit).toBe(true);
      const invoke = vi.fn(async () => "must not run");
      await expect(runAiTask({ source: "原文", action: "custom", scope: "document", userPrompt: command, baseSystemPrompt: "", actionDefinition: { id: "custom", label: "", prompt: "" } }, { invoke, isCurrent: () => true, abortCurrent: vi.fn() })).rejects.toThrow("拆成独立指令");
      expect(invoke).not.toHaveBeenCalled();
    }
  });

  it("treats only an entire quoted payload as exact content", () => {
    expect(resolveAiAppendIntent("custom", "文末添加“不要删除正文”", "document")?.literal).toBe("不要删除正文");
    expect(resolveAiAppendIntent("custom", "文末追加 \"**hello**\"", "document")?.literal).toBe("**hello**");
    expect(resolveAiAppendIntent("custom", "文末添加“hello”并删除正文", "document")?.requiresSplit).toBe(true);
    expect(resolveAiAppendIntent("custom", "文末添加“”", "document")).toBeNull();
  });

  it("preserves LF, CRLF and CR source bytes while inserting one new paragraph", () => {
    for (const eol of ["\n", "\r\n", "\r"]) {
      expect(prepareMarkdownAppend(`正文${eol}`, "hello")).toBe(`${eol}hello`);
      expect(prepareMarkdownAppend(`正文${eol}${eol}`, "hello")).toBe("hello");
      expect(prepareMarkdownAppend(`正文${eol}尾文`, "hello")).toBe(`${eol}${eol}hello`);
    }
    expect(prepareMarkdownAppend("", "hello")).toBe("hello");
  });

  it("turns a fixed literal append into one confirmable result without copying the source through a model", async () => {
    const source = "---\ntitle: draft\n---\n\n# 标题\n\n正文。\n\n```js\nconsole.log(1)\n```";
    const invoke = vi.fn(async () => "should not be called");
    const task = await runAiTask({ source, action: "custom", scope: "document", userPrompt: "底部加hello", baseSystemPrompt: "只输出正文", actionDefinition: { id: "custom", label: "custom", prompt: "" } }, { invoke, isCurrent: () => true, abortCurrent: vi.fn() });
    expect(invoke).not.toHaveBeenCalled();
    expect(task.proposalMode).toBe("append");
    expect(task.text).toBe("hello");
    expect(source + finalizeAiTaskOutput(source, task.text, task)).toBe(`${source}\n\nhello`);
  });

  it("executes a generated append once as read-only context rather than once per edit block", async () => {
    const source = "# 标题\n\n正文。";
    const invoke = vi.fn(async (_prompt: string) => "新增结论。");
    const task = await runAiTask({ source, action: "custom", scope: "document", userPrompt: "文末补充本章总结", baseSystemPrompt: "只输出正文", actionDefinition: { id: "custom", label: "custom", prompt: "" } }, { invoke, isCurrent: () => true, abortCurrent: vi.fn() });
    expect(invoke).toHaveBeenCalledTimes(1);
    expect(invoke.mock.calls[0][0]).toContain("只输出本次新增");
    expect(task.editAction).toBe(false);
    expect(task.proposalMode).toBe("append");
    expect(source + finalizeAiTaskOutput(source, task.text, task)).toBe(`${source}\n\n新增结论。`);
  });

  it("does not create an append proposal after cancellation or above the document limit", async () => {
    const task = { source: "正文", action: "custom" as const, scope: "document" as const, userPrompt: "底部加hello", baseSystemPrompt: "", actionDefinition: { id: "custom" as const, label: "", prompt: "" } };
    const opts = { invoke: vi.fn(async () => ""), isCurrent: () => false, abortCurrent: vi.fn() };
    await expect(runAiTask(task, opts)).rejects.toThrow("取消");
    await expect(runAiTask({ ...task, source: "字".repeat(400_000) }, { ...opts, isCurrent: () => true })).rejects.toThrow("1 MiB");
    expect(opts.invoke).not.toHaveBeenCalled();
  });

  it("validates a selected replacement in its complete document context", () => {
    const content = "前文\n\n```js\nconst x = 1;\n```\n\n后文";
    const from = content.indexOf("x =");
    const snapshot = { documentId: "test", revision: 1, content, selection: { from, to: from + 1 }, cursor: from, readOnly: false };
    const task = { text: "y", semanticAction: "custom" as const, editAction: true, nonReplacementSkill: false, protection: undefined, conservative: false, warnings: [] };
    expect(() => finalizeAiTaskOutput("x", "y", task, snapshot)).toThrow(/代码/);
    expect(() => finalizeAiTaskOutput("wrong source", "y", task, snapshot)).toThrow(/无法校验当前选区/);
    expect(finalizeAiTaskOutput("x", "x", task, snapshot)).toBe("x");
  });
});
