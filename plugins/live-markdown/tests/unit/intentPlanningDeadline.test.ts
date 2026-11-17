import { afterEach, describe, expect, it, vi } from "vitest";
// Retained full-policy regression; default thin behavior has separate production-entry tests.
import { runFullHarnessTaskCore as runPlannedAiTaskCore } from "../../src/core/ai/fullHarnessTaskRunnerCore";
import { buildAiTaskRequest } from "../../src/core/ai/aiTaskRequest";
import { resolveAiEdit } from "../../src/core/ai/editProposal";
import type { AiTaskRunnerOptions } from "../../src/core/ai/aiTaskRunner";
import { TYPORA_QUICKSTART_MARKDOWN } from "../../src/core/sampleDocs";

const instruction = "新增个markdown的代码块，里面生成一个h1标题";
const source = "# 文稿\n\n原有正文保持不变。";
const block = "```markdown\n# hello\n```";
const plan = JSON.stringify({ version: 1, kind: "edit", operation: "insert", target: "document_end",
  layout: "block", content: { mode: "generate", task: "custom" } });
const snapshot = { documentId: "test.md", revision: 1, content: source, selection: null, cursor: source.length, readOnly: false };
const request = () => buildAiTaskRequest({ source, selected: false, action: "custom", userPrompt: instruction,
  config: { provider: "ztools", activeRoleId: "general" } });
const options = (invoke: AiTaskRunnerOptions["invoke"], extra: Partial<AiTaskRunnerOptions> = {}): AiTaskRunnerOptions =>
  ({ invoke, isCurrent: () => true, abortCurrent: vi.fn(), ...extra });
const delay = <T>(value: T, ms: number) => new Promise<T>(resolve => setTimeout(() => resolve(value), ms));

afterEach(() => { vi.clearAllTimers(); vi.useRealTimers(); });

describe("shared planning and generation deadline", () => {
  it("produces one complete artifact against the original rich Welcome document without changing its source", async () => {
    const content = TYPORA_QUICKSTART_MARKDOWN;
    const fullSnapshot = { ...snapshot, content, cursor: content.length };
    const fullRequest = buildAiTaskRequest({ source: content, selected: false, action: "custom", userPrompt: instruction,
      config: { provider: "ztools", activeRoleId: "general" } });
    const invoke = vi.fn<AiTaskRunnerOptions["invoke"]>(async prompt => {
      if (invoke.mock.calls.length === 1) return plan;
      if (prompt.startsWith("提炼以下全文片段") || prompt.startsWith("合并以下分段摘要")) return "原文介绍 Markdown 编辑工作流。";
      expect(prompt).toContain("里面生成一个h1标题");
      return block;
    });
    const result = await runPlannedAiTaskCore(fullRequest, fullSnapshot, options(invoke));
    expect(content.endsWith("\n")).toBe(true);
    expect(result.proposal?.patch?.insertText).toBe(`\n${block}`);
    expect(resolveAiEdit(result.proposal!)?.content).toBe(`${content}\n${block}`);
    expect(fullSnapshot.content).toBe(content);
    expect(invoke.mock.calls.length).toBeLessThanOrEqual(8);
  });
  it("keeps a creative instruction alive beyond 15 seconds and stages one complete Markdown code block", async () => {
    vi.useFakeTimers();
    const invoke = vi.fn<AiTaskRunnerOptions["invoke"]>()
      .mockImplementationOnce(async () => delay(`\`\`\`json\n${plan}\n\`\`\``, 20000))
      .mockImplementationOnce(async prompt => {
        expect(prompt).toContain("里面生成一个h1标题");
        return block;
      });
    let settled = false;
    const observed = runPlannedAiTaskCore(request(), snapshot, options(invoke))
      .then(value => { settled = true; return { value, error: undefined }; }, error => { settled = true; return { value: undefined, error }; });
    await vi.advanceTimersByTimeAsync(16000);
    expect(settled).toBe(false);
    await vi.advanceTimersByTimeAsync(4000);
    const result = await observed;
    expect(result.error).toBeUndefined();
    expect(invoke).toHaveBeenCalledTimes(2);
    expect(result.value?.proposal?.patch?.insertText).toBe(`\n\n${block}`);
    expect(snapshot.content).toBe(source);
    expect(resolveAiEdit(result.value!.proposal!)?.content).toBe(`${source}\n\n${block}`);
  });

  it("stops a hanging planner only at the shared task deadline and aborts once", async () => {
    vi.useFakeTimers();
    const invoke = vi.fn<AiTaskRunnerOptions["invoke"]>(async () => new Promise(() => {}));
    const abortCurrent = vi.fn();
    const observed = runPlannedAiTaskCore(request(), snapshot, options(invoke, { abortCurrent })).catch(error => error);
    await vi.advanceTimersByTimeAsync(299999);
    expect(abortCurrent).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(await observed).toMatchObject({ name: "IntentProtocolError", code: "timeout" });
    expect(abortCurrent).toHaveBeenCalledTimes(1);
    expect(invoke).toHaveBeenCalledTimes(1);
  });

  it("does not reset the task budget after the planner returns", async () => {
    vi.useFakeTimers();
    const invoke = vi.fn<AiTaskRunnerOptions["invoke"]>()
      .mockImplementationOnce(async () => delay(plan, 20000))
      .mockImplementationOnce(async () => delay(block, 10000));
    const abortCurrent = vi.fn();
    const observed = runPlannedAiTaskCore(request(), snapshot, options(invoke, { maxDurationMs: 25000, abortCurrent })).catch(error => error);
    await vi.advanceTimersByTimeAsync(25000);
    expect(await observed).toMatchObject({ name: "AiTaskDeadlineError" });
    expect(abortCurrent).toHaveBeenCalledTimes(1);
    expect(invoke).toHaveBeenCalledTimes(2);
  });

  it("cancels pending planning and ignores a late valid plan without starting content generation", async () => {
    vi.useFakeTimers();
    const controller = new AbortController();
    const invoke = vi.fn<AiTaskRunnerOptions["invoke"]>(async () => delay(plan, 20000));
    const abortCurrent = vi.fn();
    const observed = runPlannedAiTaskCore(request(), snapshot, options(invoke, { signal: controller.signal, abortCurrent })).catch(error => error);
    await vi.advanceTimersByTimeAsync(16000);
    controller.abort();
    expect(await observed).toMatchObject({ name: "AiTaskCancelledError" });
    await vi.advanceTimersByTimeAsync(10000);
    expect(invoke).toHaveBeenCalledTimes(1);
    expect(abortCurrent).toHaveBeenCalledTimes(1);
    expect(snapshot.content).toBe(source);
  });
});
