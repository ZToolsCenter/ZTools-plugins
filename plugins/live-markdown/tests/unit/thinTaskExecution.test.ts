import { describe, expect, it, vi } from "vitest";
import { runPlannedAiTaskCore } from "../../src/core/ai/plannedTaskRunnerCore";
import { resolveAiEdit } from "../../src/core/ai/editProposal";
import type { AiTaskRequest } from "../../src/core/ai/aiTaskRunner";
import type { AiDocumentSnapshot } from "../../src/types/aiEditing";

const source = "# 原文\n\n原文保持不变，价格为 27 元。";
const snapshot: AiDocumentSnapshot = { documentId: "thin.md", revision: 3, content: source, selection: null, cursor: source.length, readOnly: false };
const request = (instruction: string, extra: Partial<AiTaskRequest> = {}): AiTaskRequest => ({
  action: "custom", source, userPrompt: instruction, provider: "local", baseSystemPrompt: "原有角色：行文优美。",
  actionDefinition: { id: "custom", label: "自定义", prompt: instruction }, ...extra
});

describe("thin production execution", () => {
  it("answers an explicit Markdown question from the knowledge executor without a model call", async () => {
    const invoke = vi.fn(async () => { throw new Error("Markdown syntax knowledge should not infer"); });
    const result = await runPlannedAiTaskCore(request("怎么创建 Markdown 代码块？只告诉我方法，不要修改文稿。"), snapshot,
      { invoke, isCurrent: () => true, abortCurrent() {} });
    expect(invoke).not.toHaveBeenCalled();
    expect(result.answerOnly).toBe(true);
    expect(result.contentExecutor).toBe("knowledge");
    expect(result.text).toContain("围栏代码块");
    expect(result.proposal).toBeUndefined();
  });

  it("constructs fully specified artifacts without any model call", async () => {
    const invoke = vi.fn(async () => { throw new Error("unexpected inference"); });
    const result = await runPlannedAiTaskCore(request("创建代码块 markdown 格式 标题一 hello"), snapshot,
      { invoke, isCurrent: () => true, abortCurrent() {} });
    expect(invoke).not.toHaveBeenCalled();
    expect(resolveAiEdit(result.proposal!)?.content).toBe(source + "\n\n```markdown\n# hello\n```");
  });

  it("generates a declared EOF artifact once, preserving the entire source until confirmation", async () => {
    const code = "```python\ndef add(a, b):\n    return a + b\n```";
    const invoke = vi.fn(async (_prompt, _system, _max, _emit, schema) => {
      expect(schema).toMatchObject({
        type: "object", required: ["payload"], additionalProperties: false,
        properties: { payload: { type: "string" } }
      });
      return JSON.stringify({ payload: "def add(a, b):\n    return a + b" });
    });
    const result = await runPlannedAiTaskCore(request("在文末新增 Python 代码块，定义 add(a, b)，返回 a + b。"), snapshot,
      { invoke, isCurrent: () => true, abortCurrent() {} });
    expect(invoke).toHaveBeenCalledTimes(1);
    expect(result.contentExecutor).toBe("artifact");
    expect(result.proposal?.mode).toBe("append");
    expect(resolveAiEdit(result.proposal!)?.content).toBe(source + "\n\n" + code);
    expect(snapshot.content).toBe(source);
  });

  it("program-owns the requested language and external heading while generating only the code body", async () => {
    const instruction = "在文末生成 Python 函数 add(a, b)，标题必须是二级标题“计算函数”。";
    const onChunk = vi.fn();
    const rawBody = "def add(a, b):\n    return a + b";
    const invoke = vi.fn(async (_prompt, _system, _max, emit, schema) => {
      expect(schema).toMatchObject({
        type: "object", required: ["payload"], additionalProperties: false,
        properties: { payload: { type: "string", minLength: 1 } }
      });
      emit(JSON.stringify({ payload: rawBody }));
      return JSON.stringify({ payload: rawBody });
    });
    const result = await runPlannedAiTaskCore(request(instruction), snapshot,
      { invoke, isCurrent: () => true, abortCurrent() {}, onChunk });
    const patch = result.proposal?.patch;
    expect(invoke).toHaveBeenCalledTimes(1);
    expect(onChunk).not.toHaveBeenCalled();
    expect(result.contentExecutor).toBe("artifact");
    expect(patch).toMatchObject({ from: source.length, to: source.length });
    expect(patch?.insertText).toBe("\n\n## 计算函数\n\n```python\ndef add(a, b):\n    return a + b\n```");
    expect(resolveAiEdit(result.proposal!)?.content).toBe(source + patch?.insertText);
    expect(snapshot.content).toBe(source);
  });

  it("never starts another model call after a provider reports a context-budget failure", async () => {
    const invoke = vi.fn(async () => { throw new Error("transport rejected after request: 上下文预算"); });
    await expect(runPlannedAiTaskCore(request("请根据全文回答：价格是多少？不要修改文稿。"), snapshot,
      { invoke, isCurrent: () => true, abortCurrent() {} })).rejects.toThrow(/transport rejected/u);
    expect(invoke).toHaveBeenCalledTimes(1);
  });

  it("treats add(a,b) as a code identifier and makes one silent schema-bound cursor request", async () => {
    const code = "```python\ndef add(a, b):\n    return a + b\n```";
    const onChunk = vi.fn();
    const invoke = vi.fn(async (_prompt, _system, _max, emit, schema) => {
      expect(schema).toMatchObject({ type: "object", required: ["payload"], additionalProperties: false });
      emit(JSON.stringify({ payload: "def add(a, b):\n    return a + b" }));
      return JSON.stringify({ payload: "def add(a, b):\n    return a + b" });
    });
    const result = await runPlannedAiTaskCore(request("在当前光标处生成一个 Python 代码块，实现 add(a, b) 并返回 a + b。"), snapshot,
      { invoke, isCurrent: () => true, abortCurrent() {}, onChunk });
    expect(invoke).toHaveBeenCalledTimes(1);
    expect(onChunk).not.toHaveBeenCalled();
    expect(result.resolvedIntent).toMatchObject({ kind: "edit", operation: "insert", target: "cursor" });
    expect(result.contentExecutor).toBe("artifact");
    expect(result.proposal?.patch).toMatchObject({ from: source.length, to: source.length,
      insertText: `\n\n${code}` });
    expect(resolveAiEdit(result.proposal!)?.content).toBe(source + "\n\n" + code);
    expect(snapshot.content).toBe(source);
  });
});
