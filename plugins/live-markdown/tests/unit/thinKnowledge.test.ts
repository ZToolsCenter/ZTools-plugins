import { describe, expect, it, vi } from "vitest";
import { runPlannedAiTaskCore } from "../../src/core/ai/plannedTaskRunnerCore";
import { buildAiTaskRequest } from "../../src/core/ai/aiTaskRequest";

const source = "# 私有文稿\n\nPRIVATE_SENTINEL 原文保持不变。";
const snapshot = { documentId: "knowledge.md", revision: 1, content: source, selection: null, cursor: null, readOnly: true };
const request = (instruction: string) => buildAiTaskRequest({ source, selected: false, action: "custom", userPrompt: instruction,
  config: { provider: "local", activeRoleId: "general" } });

describe("source-independent Markdown reference answers", () => {
  it("answers the reported H1 question from reviewed syntax without inference or document access", async () => {
    const invoke = vi.fn(async () => { throw new Error("Do not ask the weak model to invent Markdown syntax."); });
    const result = await runPlannedAiTaskCore(request("如何在 Markdown 中创建一级标题？只解释，不修改文档。"), snapshot,
      { invoke, isCurrent: () => true, abortCurrent() {} });
    expect(invoke).not.toHaveBeenCalled();
    expect(result.answerOnly).toBe(true);
    expect(result.proposal).toBeUndefined();
    expect(result.text).toContain("# 标题");
    expect(result.text).not.toContain("## 标题");
    expect(result.text).toContain("https://spec.commonmark.org/");
    expect(result.text).not.toContain("PRIVATE_SENTINEL");
  });

  it("does not substitute a generic reference for a question about the current document", async () => {
    const invoke = vi.fn(async () => "当前文稿标题为私有文稿。");
    const result = await runPlannedAiTaskCore(request("只回答：当前文档的一级标题是什么？"), snapshot,
      { invoke, isCurrent: () => true, abortCurrent() {} });
    expect(result.text).not.toContain("# 标题");
    expect(result.proposal).toBeUndefined();
  });

  it("preserves the original one-call path for unrelated general questions", async () => {
    const invoke = vi.fn(async () => "len() 返回元素数量。");
    const result = await runPlannedAiTaskCore(request("请解释 Python 的 len() 函数。"), snapshot,
      { invoke, isCurrent: () => true, abortCurrent() {} });
    expect(invoke).toHaveBeenCalledTimes(1);
    expect(result.text).toContain("len()");
    expect(result.proposal).toBeUndefined();
  });
});
