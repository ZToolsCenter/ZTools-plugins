import { afterEach, describe, expect, it, vi } from "vitest";
import { AiTaskCancelledError, type AiTaskRunnerOptions, type AiTaskRequest, type AiTaskResult } from "../../src/core/ai/aiTaskRunner";
import { shouldUseAiTaskWorker, runAiTaskInWorker, type AiTaskWorkerFactory } from "../../src/core/ai/aiTaskWorkerClient";
import type { AiDocumentSnapshot } from "../../src/types/aiEditing";
import type { AiTaskWorkerCommand, AiTaskWorkerEvent } from "../../src/core/ai/aiTaskWorkerProtocol";

const snapshot = (content: string): AiDocumentSnapshot => ({ documentId: "doc", revision: 1, content, selection: null, cursor: null, readOnly: false });
const request = (source: string): AiTaskRequest => ({ source, action: "custom", baseSystemPrompt: "system", actionDefinition: { id: "custom", label: "custom", prompt: "task", system: "" } });
const options = (invoke: AiTaskRunnerOptions["invoke"], extra: Partial<AiTaskRunnerOptions> = {}): AiTaskRunnerOptions => ({ invoke, isCurrent: () => true, abortCurrent: vi.fn(), ...extra });

class FakeWorker {
  onmessage: ((event: MessageEvent<AiTaskWorkerEvent>) => void) | null = null;
  onerror: ((event: ErrorEvent) => void) | null = null;
  onmessageerror: ((event: MessageEvent) => void) | null = null;
  terminated = false;
  received: AiTaskWorkerCommand[] = [];
  postMessage(message: AiTaskWorkerCommand | AiTaskWorkerEvent): void {
    if (message.type === "start") {
      const start = message as Extract<AiTaskWorkerCommand, { type: "start" }>;
      this.received.push(start);
      if (start.callbacks.executionPlan) {
        queueMicrotask(() => this.emit({
          type: "execution-plan", taskId: start.taskId,
          plan: { version: 2, kind: "no_op", instruction: "task", message: "done" }
        }));
      }
      queueMicrotask(() => this.emit({ type: "progress", taskId: start.taskId, message: "处理中" }));
      queueMicrotask(() => this.emit({ type: "protection", taskId: start.taskId, chunk: undefined }));
      queueMicrotask(() => this.emit({
        type: "prose-plan", taskId: start.taskId,
        plan: { source: "source", sourceHash: "hash", scope: { from: 0, to: 6 }, inputBytes: 6, slots: [], batches: [] }
      }));
      queueMicrotask(() => this.emit({
        type: "invoke", taskId: start.taskId, callId: "call-1", prompt: "p", systemPrompt: "s", maxTokens: 10,
        limits: { silent: false, maxOutputBytes: 100 }
      }));
    } else if ("value" in message && message.type === "invoke-result") {
      const response = message as Extract<AiTaskWorkerCommand, { type: "invoke-result" }>;
      this.received.push(response);
      queueMicrotask(() => this.emit({
        type: "result", taskId: response.taskId,
        result: { text: response.value, semanticAction: "custom", editAction: false, nonReplacementSkill: false, protection: undefined, conservative: false, warnings: [] }
      }));
    }
  }
  terminate(): void { this.terminated = true; }
  emit(data: AiTaskWorkerEvent): void { if (!this.terminated) this.onmessage?.({ data } as MessageEvent<AiTaskWorkerEvent>); }
}

function workerFactory(worker: FakeWorker): AiTaskWorkerFactory { return () => worker as unknown as Worker; }

describe("large-document Worker dispatch and main-thread provider RPC", () => {
  afterEach(() => { vi.unstubAllGlobals(); });

  it("uses UTF-8 size and full snapshot source, while keeping Node/SSR on core", () => {
    vi.stubGlobal("window", { document: {} });
    vi.stubGlobal("Worker", class {});
    expect(shouldUseAiTaskWorker(request("small"), snapshot("x".repeat(65_536)), options(async () => ""))).toBe(false);
    expect(shouldUseAiTaskWorker(request("small"), snapshot("x".repeat(65_537)), options(async () => ""))).toBe(true);
    expect(shouldUseAiTaskWorker(request("small"), snapshot("汉".repeat(21_845)), options(async () => ""))).toBe(false);
    expect(shouldUseAiTaskWorker(request("small"), snapshot("汉".repeat(21_846)), options(async () => ""))).toBe(true);
    expect(shouldUseAiTaskWorker(request("x".repeat(65_537)), snapshot("x"), options(async () => ""))).toBe(true);
    expect(shouldUseAiTaskWorker(request("large"), snapshot("large"), options(async () => "", { now: () => 0 }))).toBe(false);
    expect(shouldUseAiTaskWorker(request("large"), snapshot("large"), options(async () => "", { execution: {} as never }))).toBe(false);
    vi.stubGlobal("window", undefined);
    expect(shouldUseAiTaskWorker(request("large"), snapshot("large"), options(async () => ""))).toBe(false);
  });

  it("runs provider calls in the main execution and forwards worker progress", async () => {
    const worker = new FakeWorker();
    const provider = vi.fn(async (_prompt, _system, _tokens, onChunk) => { onChunk("stream"); return "provider-result"; });
    const onProgress = vi.fn();
    const onProtection = vi.fn();
    const onProsePlan = vi.fn();
    const onRequestStart = vi.fn();
    const onChunk = vi.fn();
    const result = await runAiTaskInWorker(request("source"), snapshot("source"), options(provider, { onProgress, onProtection, onProsePlan, onRequestStart, onChunk }), workerFactory(worker));

    expect(result.text).toBe("provider-result");
    expect(provider).toHaveBeenCalledTimes(1);
    expect(onProgress).toHaveBeenCalledWith("处理中");
    expect(onProtection).toHaveBeenCalledWith(undefined);
    expect(onProsePlan).toHaveBeenCalledWith(expect.objectContaining({ sourceHash: "hash" }));
    expect(onRequestStart).toHaveBeenCalledWith(1);
    expect(onChunk).toHaveBeenCalledWith("stream");
    expect(worker.terminated).toBe(true);
    expect(worker.received[0]).toMatchObject({ type: "start", request: { source: "source" }, snapshot: { content: "source" } });
  });

  it("forwards execution plans and stops before provider RPC when the plan invalidates the snapshot", async () => {
    const worker = new FakeWorker();
    const plan = { version: 2, kind: "no_op", instruction: "task", message: "done" } as const;
    let current = true;
    const provider = vi.fn(async () => "provider must not run");
    const onExecutionPlan = vi.fn(() => { current = false; });

    const task = runAiTaskInWorker(request("source"), snapshot("source"), options(provider, {
      isCurrent: () => current,
      onExecutionPlan
    }), workerFactory(worker));

    await expect(task).rejects.toBeInstanceOf(AiTaskCancelledError);
    expect(onExecutionPlan).toHaveBeenCalledOnce();
    expect(onExecutionPlan).toHaveBeenCalledWith(plan);
    expect(worker.received[0]).toMatchObject({ type: "start", callbacks: { executionPlan: true } });
    expect(provider).not.toHaveBeenCalled();
    expect(worker.terminated).toBe(true);
  });

  it("terminates on cancellation, aborts the provider, and ignores late worker receipts", async () => {
    const worker = new FakeWorker();
    const controller = new AbortController();
    let release: ((value: string) => void) | undefined;
    const abortCurrent = vi.fn();
    const provider = vi.fn(() => new Promise<string>(resolve => { release = resolve; }));
    const task = runAiTaskInWorker(request("source"), snapshot("source"), options(provider, { signal: controller.signal, abortCurrent }), workerFactory(worker));
    await vi.waitFor(() => expect(provider).toHaveBeenCalledOnce());
    const taskId = (worker.received[0] as Extract<AiTaskWorkerCommand, { type: "start" }>).taskId;
    controller.abort();
    await expect(task).rejects.toBeInstanceOf(AiTaskCancelledError);
    expect(worker.terminated).toBe(true);
    expect(abortCurrent).toHaveBeenCalled();
    release?.("late-provider-result");
    worker.emit({ type: "result", taskId, result: {} as AiTaskResult });
    expect(worker.terminated).toBe(true);
  });
});
