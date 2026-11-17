import AiTaskWorker from "./aiTaskWorker?worker&inline";
import { createAiTaskExecution, AiTaskCancelledError, AiTaskDeadlineError } from "./aiTaskExecution";
import type { AiTaskRequest, AiTaskResult, AiTaskRunnerOptions } from "./aiTaskRunner";
import type { AiDocumentSnapshot } from "../../types/aiEditing";
import type { AiTaskWorkerCommand, AiTaskWorkerEvent } from "./aiTaskWorkerProtocol";
import { readTaskCandidateDraft, TaskCandidateFailure } from "./taskCandidateFailure";

const WORKER_THRESHOLD_BYTES = 65_536;
let nextTaskId = 0;

export type AiTaskWorkerFactory = () => Worker;

function exceedsWorkerThreshold(source: string): boolean {
  let bytes = 0;
  for (let index = 0; index < source.length;) {
    const point = source.codePointAt(index)!;
    bytes += point > 0xffff ? 4 : point > 0x7ff ? 3 : point > 0x7f ? 2 : 1;
    if (bytes > WORKER_THRESHOLD_BYTES) return true;
    index += point > 0xffff ? 2 : 1;
  }
  return false;
}

/** Keep synchronous work off the browser UI thread only when it can help safely. */
export function shouldUseAiTaskWorker(request: AiTaskRequest, snapshot: AiDocumentSnapshot, options: AiTaskRunnerOptions): boolean {
  if (typeof window === "undefined" || !window.document || typeof Worker === "undefined") return false;
  if (options.execution || options.now) return false;
  return exceedsWorkerThreshold(snapshot.content) || snapshot.content !== request.source && exceedsWorkerThreshold(request.source);
}

function errorFrom(name: string, message: string, code?: string, draft?: unknown): Error {
  if (name === "AiTaskCancelledError") return new AiTaskCancelledError();
  if (name === "AiTaskDeadlineError") return new AiTaskDeadlineError();
  if (name === "TaskCandidateFailure") {
    const safeDraft = readTaskCandidateDraft({ draft });
    if (safeDraft) return new TaskCandidateFailure(message, safeDraft, code);
  }
  const error = new Error(message);
  error.name = name || "Error";
  if (typeof code === "string" && code.length <= 128) Object.assign(error, { code });
  return error;
}

function errorPayload(cause: unknown): { name: string; message: string } {
  return cause instanceof Error ? { name: cause.name, message: cause.message } : { name: "Error", message: String(cause) };
}

/** Runs the shared planner in a real Worker while retaining host inference on this thread. */
export function runAiTaskInWorker(
  request: AiTaskRequest,
  snapshot: AiDocumentSnapshot,
  options: AiTaskRunnerOptions,
  createWorker: AiTaskWorkerFactory = () => new AiTaskWorker()
): Promise<AiTaskResult> {
  if (options.execution || options.now) return Promise.reject(new Error("Worker 执行不接受自定义时钟或任务执行器。"));
  const startedAt = Date.now();
  const maxDurationMs = Math.min(options.maxDurationMs ?? 300_000, 300_000);
  const maxCalls = Math.min(options.maxCalls ?? 64, 64);
  let worker: Worker;
  try { worker = createWorker(); }
  catch (cause) { return Promise.reject(cause instanceof Error ? cause : new Error(String(cause))); }

  const taskId = `ai-task-${++nextTaskId}`;
  const execution = createAiTaskExecution(options);
  return new Promise<AiTaskResult>((resolve, reject) => {
    let settled = false;
    let activeCallId: string | undefined;
    let timeout: ReturnType<typeof setTimeout> | undefined;
    let stalePoll: ReturnType<typeof setInterval> | undefined;
    const settleCleanup = () => {
      if (timeout !== undefined) clearTimeout(timeout);
      if (stalePoll !== undefined) clearInterval(stalePoll);
      options.signal?.removeEventListener("abort", onAbort);
      worker.onmessage = null;
      worker.onerror = null;
      worker.onmessageerror = null;
      worker.terminate();
    };
    const fail = (cause: unknown, abortProvider = true) => {
      if (settled) return;
      settled = true;
      settleCleanup();
      if (abortProvider) {
        try { options.abortCurrent(); } catch { /* Preserve the task error. */ }
      }
      reject(cause instanceof Error ? cause : new Error(String(cause)));
    };
    const isCurrent = () => !options.signal?.aborted && options.isCurrent();
    const onAbort = () => fail(new AiTaskCancelledError());
    const send = (message: AiTaskWorkerCommand) => {
      if (settled) return;
      try { worker.postMessage(message); }
      catch (cause) { fail(cause); }
    };

    worker.onmessage = (event: MessageEvent<AiTaskWorkerEvent>) => {
      const message = event.data;
      if (settled || !message || message.taskId !== taskId) return;
      try {
        if (!isCurrent()) { fail(new AiTaskCancelledError()); return; }
        switch (message.type) {
          case "invoke": {
            if (activeCallId || !message.callId || typeof message.prompt !== "string" || typeof message.systemPrompt !== "string" || !Number.isFinite(message.maxTokens)) {
              fail(new Error("AI Worker 调用协议无效。")); return;
            }
            activeCallId = message.callId;
            void execution.invoke(message.prompt, message.systemPrompt, message.maxTokens, message.limits).then(value => {
              if (settled || activeCallId !== message.callId) return;
              if (!isCurrent()) { fail(new AiTaskCancelledError()); return; }
              activeCallId = undefined;
              send({ type: "invoke-result", taskId, callId: message.callId, value });
            }).catch(cause => {
              if (settled || activeCallId !== message.callId) return;
              activeCallId = undefined;
              const error = errorPayload(cause);
              send({ type: "invoke-error", taskId, callId: message.callId, ...error });
            });
            return;
          }
          case "progress": options.onProgress?.(message.message); return;
          case "protection": options.onProtection?.(message.chunk); return;
          case "prose-plan": options.onProsePlan?.(message.plan); return;
          case "execution-plan": options.onExecutionPlan?.(message.plan); return;
          case "failure": fail(errorFrom(message.name, message.message, message.code, message.draft)); return;
          case "result": {
            if (activeCallId) { fail(new Error("AI Worker 在模型调用完成前结束任务。")); return; }
            execution.assertRunning();
            const result: AiTaskResult = message.result.proposal
              ? { ...message.result, proposal: { ...message.result.proposal, snapshot } }
              : message.result as AiTaskResult;
            settled = true;
            settleCleanup();
            resolve(result);
            return;
          }
        }
      } catch (cause) { fail(cause); }
    };
    worker.onerror = event => fail(new Error(event.message || "AI Worker 执行失败，原文未修改。"));
    worker.onmessageerror = () => fail(new Error("AI Worker 消息无法安全读取，原文未修改。"));
    options.signal?.addEventListener("abort", onAbort, { once: true });
    if (options.signal?.aborted || !isCurrent()) { onAbort(); return; }
    timeout = setTimeout(() => fail(new AiTaskDeadlineError()), Math.max(0, maxDurationMs - (Date.now() - startedAt)));
    stalePoll = setInterval(() => {
      try { if (!isCurrent()) fail(new AiTaskCancelledError()); }
      catch (cause) { fail(cause); }
    }, 50);
    send({
      type: "start", taskId, request, snapshot, maxDurationMs, maxCalls,
      callbacks: { progress: Boolean(options.onProgress), protection: Boolean(options.onProtection), prosePlan: Boolean(options.onProsePlan),
        ...(options.onExecutionPlan ? { executionPlan: true } : {}) }
    });
  });
}
