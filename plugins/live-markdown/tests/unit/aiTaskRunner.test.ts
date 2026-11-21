import { afterEach, describe, expect, it, vi } from "vitest";
import { runAiTask, AiTaskCancelledError, AiTaskDeadlineError, type AiTaskRequest, type AiTaskRunnerOptions } from "../../src/core/ai/aiTaskRunner";
// Retained full-policy regression; default thin behavior has separate production-entry tests.
import { runFullHarnessTaskCore as runPlannedAiTask } from "../../src/core/ai/fullHarnessTaskRunnerCore";
import { AI_ACTIONS } from "../../src/core/ai/aiTaskPrompts";

const SLOTS_MARKER = "【待编辑文本槽】\n";
type SlotPayload = { id: string; text: string; contextBefore: string; contextAfter: string };
type ProseBatch = { protocol: "prose-edit/v1"; batchId: string; slots: SlotPayload[] };

function readBatch(prompt: string): ProseBatch {
  const start = prompt.indexOf(SLOTS_MARKER);
  if (start < 0) throw new Error("expected source-bound prose slot payload");
  return JSON.parse(prompt.slice(start + SLOTS_MARKER.length)) as ProseBatch;
}

function proseReply(prompt: string, transform: (text: string, slot: SlotPayload) => string = (text) => text): string {
  const batch = readBatch(prompt);
  return JSON.stringify({
    protocol: batch.protocol,
    batchId: batch.batchId,
    edits: batch.slots.map((slot) => {
      const text = transform(slot.text, slot);
      return text === slot.text ? { id: slot.id, status: "unchanged" } : { id: slot.id, status: "replace", text };
    })
  });
}

function request(source: string, action: AiTaskRequest["action"] = "polish", userPrompt?: string): AiTaskRequest {
  const actionDefinition = AI_ACTIONS.find((item) => item.id === action) ?? {
    id: "custom" as const, label: "自定义", prompt: "custom instruction", system: ""
  };
  return { source, action, userPrompt, baseSystemPrompt: "role", actionDefinition };
}

function options(invoke: AiTaskRunnerOptions["invoke"], extra: Partial<AiTaskRunnerOptions> = {}): AiTaskRunnerOptions {
  return { invoke, isCurrent: () => true, abortCurrent: vi.fn(), ...extra };
}

function manyShortParagraphs(count = 48): string {
  return Array.from({ length: count }, (_, index) => `第${index + 1}段正文错字，事实保持不变。`).join("\n\n");
}

describe("AI task runner", () => {
  afterEach(() => vi.useRealTimers());

  it("surfaces a long summary warning while retaining every required source relation", async () => {
    const source = Array.from({ length: 12 }, (_, index) =>
      `项目${index + 1}由王明负责，${"原始说明内容".repeat(18)}。`
    ).join("\n\n");
    const invoke = vi.fn(async () => JSON.stringify({ ids: [] }));
    const result = await runAiTask(request(source, "summarize"), options(invoke));
    expect(result.sourceFacts).toHaveLength(12);
    expect(result.sourceFacts?.every(quote => source.includes(quote))).toBe(true);
    expect(result.warnings.join(" ")).toMatch(/保留全部 12 条关键事实/);
  });

  it("sends a source-bound slot request and returns a complete proposal", async () => {
    const invoke = vi.fn<AiTaskRunnerOptions["invoke"]>(async (prompt) => proseReply(prompt, (text) => text.replace("错字", "正字")));
    const result = await runAiTask(request("短文错字"), options(invoke));

    expect(invoke).toHaveBeenCalledTimes(1);
    expect(readBatch(invoke.mock.calls[0][0]).slots[0].text).toBe("短文错字");
    expect(result.text).toBe("短文正字");
    expect(result.editAction).toBe(true);
    expect(result.sourceOwned).toBe(true);
  });

  it("groups by the real prompt and output budget and returns only after every batch is acknowledged", async () => {
    const source = manyShortParagraphs();
    const invoke = vi.fn<AiTaskRunnerOptions["invoke"]>(async (prompt) => proseReply(prompt, (text) => text.replace("错字", "正字")));
    const result = await runAiTask(request(source), options(invoke));

    expect(result.proseStats?.batches).toBe(invoke.mock.calls.length);
    expect(invoke.mock.calls.length).toBeGreaterThan(1);
    expect(result.text).toBe(source.replaceAll("错字", "正字"));
    expect(result.text.startsWith("第1段")).toBe(true);
    expect(result.text.endsWith("事实保持不变。")).toBe(true);
  });

  it("does not expose a partial result when a later batch fails", async () => {
    const invoke = vi.fn<AiTaskRunnerOptions["invoke"]>(async (prompt) => {
      if (invoke.mock.calls.length === 1) return proseReply(prompt, (text) => text.replace("错字", "正字"));
      throw new Error("连接断开");
    });
    await expect(runAiTask(request(manyShortParagraphs()), options(invoke))).rejects.toThrow("连接断开");
    expect(invoke).toHaveBeenCalledTimes(2);
  });

  it("keeps an all-protected document unchanged without invoking the model", async () => {
    const source = "```ts\nconst answer = 42;\n```\n\n# 标题 ✨\n";
    const invoke = vi.fn<AiTaskRunnerOptions["invoke"]>(async () => "unexpected");
    const result = await runAiTask(request(source), options(invoke));

    expect(invoke).not.toHaveBeenCalled();
    expect(result.text).toBe(source);
    expect(result.preservedSource).toBe(true);
    expect(result.warnings.join(" ")).toContain("没有改变原文");
  });

  it("edits prose while preserving protected code, tables, links, and numeric facts", async () => {
    const source = "```ts\nconst x = 42;\n```\n\n说明错字，版本 v2 与 8GB 保持不变。\n\n| A | B |\n| --- | --- |\n| x | 42 |";
    const invoke = vi.fn<AiTaskRunnerOptions["invoke"]>(async (prompt) => proseReply(prompt, (text) => text.replace("错字", "正字")));
    const result = await runAiTask(request(source), options(invoke));

    expect(result.text).toBe(source.replace("说明错字", "说明正字"));
    expect(result.text).toContain("const x = 42;");
    expect(result.text).toContain("版本 v2 与 8GB");
    expect(result.text).toContain("| x | 42 |");
  });

  it("rejects malformed output or structural edits after one call, without a repair request", async () => {
    const malformed = vi.fn<AiTaskRunnerOptions["invoke"]>(async () => "not JSON");
    await expect(runAiTask(request("一段正文"), options(malformed))).rejects.toThrow();
    expect(malformed).toHaveBeenCalledTimes(1);

    const structural = vi.fn<AiTaskRunnerOptions["invoke"]>(async (prompt) => proseReply(prompt, () => "# 新标题"));
    await expect(runAiTask(request("一段正文"), options(structural))).rejects.toThrow(/AST|标题|结构/);
    expect(structural).toHaveBeenCalledTimes(1);
    expect(structural.mock.calls[0][0]).not.toContain("上次输出未通过校验");
  });

  it("checks cancellation after a batch response and before starting the next one", async () => {
    let current = true;
    const invoke = vi.fn<AiTaskRunnerOptions["invoke"]>(async (prompt) => {
      const result = proseReply(prompt);
      current = false;
      return result;
    });
    await expect(runAiTask(request(manyShortParagraphs()), options(invoke, { isCurrent: () => current })))
      .rejects.toBeInstanceOf(AiTaskCancelledError);
    expect(invoke).toHaveBeenCalledTimes(1);
  });

  it("stops stale prose snapshots after the current batch and exposes no partial result", async () => {
    let current = true;
    const invoke = vi.fn<AiTaskRunnerOptions["invoke"]>(async (prompt) => {
      const result = proseReply(prompt);
      current = false;
      return result;
    });
    const isSnapshotCurrent = vi.fn(() => current);

    await expect(runAiTask(request(manyShortParagraphs()), options(invoke, { isSnapshotCurrent })))
      .rejects.toThrow(/版本|快照/u);

    expect(invoke).toHaveBeenCalledTimes(1);
    expect(isSnapshotCurrent).toHaveBeenCalled();
  });

  it("does not create an edit proposal when the document snapshot changes during prose batches", async () => {
    const source = manyShortParagraphs();
    let current = true;
    const invoke = vi.fn<AiTaskRunnerOptions["invoke"]>(async (prompt) => {
      const result = proseReply(prompt);
      current = false;
      return result;
    });

    await expect(runPlannedAiTask(request(source), {
      documentId: "stale.md", revision: 2, content: source, selection: null, cursor: null, readOnly: false
    }, options(invoke, { isSnapshotCurrent: () => current }))).rejects.toThrow(/版本|快照/u);

    expect(invoke).toHaveBeenCalledTimes(1);
  });

  it("passes the snapshot fence to the local natural-prose executor too", async () => {
    let current = true;
    const invoke = vi.fn<AiTaskRunnerOptions["invoke"]>(async () => {
      current = false;
      return "stale natural prose";
    });

    await expect(runAiTask({ ...request(manyShortParagraphs()), provider: "local" }, options(invoke, {
      isSnapshotCurrent: () => current
    }))).rejects.toThrow(/版本|快照/u);

    expect(invoke).toHaveBeenCalledTimes(1);
  });

  it("keeps protocol chunks silent instead of exposing partial model output to the UI", async () => {
    const visible: string[] = [];
    const invoke = vi.fn<AiTaskRunnerOptions["invoke"]>(async (prompt, _system, _tokens, onChunk) => {
      onChunk("partial JSON");
      return proseReply(prompt);
    });
    await runAiTask(request("普通正文"), options(invoke, { onChunk: (chunk) => visible.push(chunk) }));
    expect(visible).toEqual([]);
  });

  it("aborts a provider request when the whole task reaches its deadline", async () => {
    vi.useFakeTimers();
    const callOptions = options(() => new Promise<string>(() => undefined), { maxDurationMs: 20 });
    const task = runAiTask(request("一段短正文"), callOptions);
    const expectation = expect(task).rejects.toBeInstanceOf(AiTaskDeadlineError);
    await vi.advanceTimersByTimeAsync(25);
    await expectation;
    expect(callOptions.abortCurrent).toHaveBeenCalledTimes(1);
  });

  it("keeps summary and continuation read-only generation on their existing request path", async () => {
    const summaryInvoke = vi.fn<AiTaskRunnerOptions["invoke"]>(async () => "摘要内容");
    const summary = await runAiTask(request("summary input", "summarize"), options(summaryInvoke));
    expect(summaryInvoke).toHaveBeenCalledTimes(1);
    expect(summary.editAction).toBe(false);
    expect(summary.text).toBe("摘要内容");

    const continuation = vi.fn<AiTaskRunnerOptions["invoke"]>(async () => "new ending");
    const continued = await runAiTask(request("short source", "continue"), options(continuation));
    expect(continuation).toHaveBeenCalledTimes(1);
    expect(continuation.mock.calls[0][0]).toContain("【全文上下文】");
    expect(continued.text).toBe("new ending");
  });

  it("does not append an empty full-context template for source-independent read-only generation", async () => {
    const taskRequest: AiTaskRequest = {
      ...request("This is unrelated full-document text.", "custom", "general question"),
      intentPlanned: true,
      readOnlyTask: true,
      generationContextSource: "",
      outputFormat: "none",
      actionDefinition: { id: "custom", label: "自定义", prompt: "Explain Markdown headings." }
    };
    const invoke = vi.fn<AiTaskRunnerOptions["invoke"]>(async () => "A heading starts with #.");

    await runAiTask(taskRequest, options(invoke));

    expect(invoke).toHaveBeenCalledTimes(1);
    expect(invoke.mock.calls[0][0]).toBe(taskRequest.actionDefinition.prompt);
    expect(invoke.mock.calls[0][0]).not.toContain("【全文上下文】");
    expect(invoke.mock.calls[0][0]).not.toContain(taskRequest.source);
  });

  it("lets self-contained tables use normal generation instead of source-row extraction", async () => {
    const source = "Alpha 和 Beta 产品总价为 30 元。";
    const taskRequest: AiTaskRequest = {
      ...request(source, "custom", "Create a self-contained status table."),
      intentPlanned: true,
      readOnlyTask: true,
      generationContextSource: "",
      outputFormat: "table",
      actionDefinition: { id: "custom", label: "自定义", prompt: "Create a self-contained status table." }
    };
    const table = "| Name | Status |\n| --- | --- |\n| Queue | Ready |";
    const invoke = vi.fn<AiTaskRunnerOptions["invoke"]>(async () => table);

    const result = await runAiTask(taskRequest, options(invoke));

    expect(invoke).toHaveBeenCalledTimes(1);
    expect(invoke.mock.calls[0][0]).toBe(taskRequest.actionDefinition.prompt);
    expect(result.text).toBe(table);
  });

  it("keeps source-row table validation when generation still depends on the document", async () => {
    const source = "Alpha 和 Beta 产品总价为 30 元。";
    const taskRequest: AiTaskRequest = {
      ...request(source, "custom", "根据原文生成商品与价格表格。"),
      intentPlanned: true,
      readOnlyTask: true,
      outputFormat: "table",
      actionDefinition: { id: "custom", label: "自定义", prompt: "根据原文生成商品与价格表格。" }
    };
    const invoke = vi.fn<AiTaskRunnerOptions["invoke"]>(async () => "unexpected");

    await expect(runAiTask(taskRequest, options(invoke))).rejects.toThrow(/复合价格关系/u);

    expect(invoke).not.toHaveBeenCalled();
  });

  it("does not source-ground a self-contained technical proposal when generation context is empty", async () => {
    const source = "This complete source document must not be copied into a standalone proposal.";
    const taskRequest: AiTaskRequest = {
      ...request(source, "tech-spec", "Write a standalone technical proposal."),
      intentPlanned: true,
      readOnlyTask: true,
      generationContextSource: "",
      outputFormat: "none",
      actionDefinition: { id: "tech-spec", label: "技术方案", prompt: "Write a standalone technical proposal." }
    };
    const invoke = vi.fn<AiTaskRunnerOptions["invoke"]>(async () => "Standalone proposal.");

    const result = await runAiTask(taskRequest, options(invoke));

    expect(invoke).toHaveBeenCalledTimes(1);
    expect(invoke.mock.calls[0][0]).toBe(taskRequest.actionDefinition.prompt);
    expect(invoke.mock.calls[0][0]).not.toContain(source);
    expect(result.text).toBe("Standalone proposal.");
  });

  it("does not fall back to a free-form reduce when long-summary evidence is malformed", async () => {
    const source = "这是一段可回溯的原文事实。".repeat(1200);
    const invoke = vi.fn<AiTaskRunnerOptions["invoke"]>(async () => "invented summary without evidence IDs");
    await expect(runAiTask(request(source, "summarize"), options(invoke))).rejects.toThrow();
    expect(invoke).toHaveBeenCalledTimes(1);
  });
});
