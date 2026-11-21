import { AiTaskCancelledError, AiTaskDeadlineError, type AiTaskExecution, type AiInvocationLimits } from "./aiTaskExecution";
import type { AiTaskWorkerCommand, AiTaskWorkerEvent, AiTaskWorkerStart } from "./aiTaskWorkerProtocol";
import { runPlannedAiTaskCore } from "./plannedTaskRunnerCore";
import type { AiTaskResult } from "./aiTaskRunner";
import { readTaskCandidateDraft, TaskCandidateFailure } from "./taskCandidateFailure";

interface WorkerScope {
  onmessage: ((event: MessageEvent<AiTaskWorkerCommand>) => void) | null;
  postMessage(message: AiTaskWorkerEvent): void;
}
interface PendingCall { resolve(value: string): void; reject(cause: Error): void; }
const scope = globalThis as unknown as WorkerScope;
let activeTaskId: string | undefined;
let cancelled = false;
let deadlineAt = 0;
let maxCalls = 64;
let callCount = 0;
let nextCallId = 0;
const pending = new Map<string, PendingCall>();

function post(message: AiTaskWorkerEvent): void {
  if (activeTaskId && message.taskId === activeTaskId) scope.postMessage(message);
}
function rejectPending(cause: Error): void {
  for (const call of pending.values()) call.reject(cause);
  pending.clear();
}
function assertRunning(taskId: string): void {
  if (cancelled || activeTaskId !== taskId) throw new AiTaskCancelledError();
  if (Date.now() >= deadlineAt) throw new AiTaskDeadlineError();
}
function createRemoteExecution(start: AiTaskWorkerStart): AiTaskExecution {
  activeTaskId = start.taskId;
  cancelled = false;
  deadlineAt = Date.now() + Math.min(start.maxDurationMs, 300_000);
  maxCalls = Math.min(start.maxCalls, 64);
  callCount = 0;
  nextCallId = 0;
  return {
    get remainingCalls() { return maxCalls - callCount; },
    assertRunning: () => assertRunning(start.taskId),
    invoke(prompt, systemPrompt, maxTokens, limits: AiInvocationLimits = {}) {
      assertRunning(start.taskId);
      if (callCount >= maxCalls) throw new Error("AI 子请求超过 64 次安全上限，结果未写入文档。");
      callCount += 1;
      const callId = `${start.taskId}-call-${++nextCallId}`;
      return new Promise<string>((resolve, reject) => {
        pending.set(callId, { resolve, reject });
        try { post({ type: "invoke", taskId: start.taskId, callId, prompt, systemPrompt, maxTokens, limits }); }
        catch (cause) {
          pending.delete(callId);
          reject(cause instanceof Error ? cause : new Error(String(cause)));
        }
      });
    }
  };
}

function resultForWorker(result: AiTaskResult): AiTaskWorkerEvent {
  const proposal = result.proposal;
  const { proposal: _proposal, ...rest } = result;
  const safeResult = proposal
    ? { ...rest, proposal: { text: proposal.text, mode: proposal.mode, patch: proposal.patch, summary: proposal.summary, dependency: proposal.dependency } }
    : rest;
  return { type: "result", taskId: activeTaskId!, result: safeResult };
}

async function run(start: AiTaskWorkerStart): Promise<void> {
  const execution = createRemoteExecution(start);
  const isCurrent = () => !cancelled && activeTaskId === start.taskId;
  const sendCallback = (message: AiTaskWorkerEvent) => post(message);
  const options = {
    invoke: async () => { throw new Error("Worker provider calls must use the main-thread RPC."); },
    isCurrent,
    abortCurrent: () => { cancelled = true; rejectPending(new AiTaskCancelledError()); },
    maxDurationMs: start.maxDurationMs,
    maxCalls: start.maxCalls,
    execution,
    ...(start.callbacks.progress ? { onProgress: (message: string) => sendCallback({ type: "progress", taskId: start.taskId, message }) } : {}),
    ...(start.callbacks.protection ? { onProtection: (chunk: import("./aiChunkPlanner").AiPlannedChunk | undefined) => sendCallback({ type: "protection", taskId: start.taskId, chunk }) } : {}),
    ...(start.callbacks.prosePlan ? { onProsePlan: (plan: import("./proseEditPlan").ProseEditPlan) => sendCallback({ type: "prose-plan", taskId: start.taskId, plan }) } : {}),
    ...(start.callbacks.executionPlan ? { onExecutionPlan: (plan: import("./executionPlan").ExecutionPlan) => sendCallback({ type: "execution-plan", taskId: start.taskId, plan }) } : {})
  };
  try {
    const result = await runPlannedAiTaskCore(start.request, start.snapshot, options);
    execution.assertRunning();
    post(resultForWorker(result));
  } catch (cause) {
    if (!isCurrent()) return;
    const error = cause instanceof Error ? cause : new Error(String(cause));
    const failure = { type: "failure" as const, taskId: start.taskId, name: error.name, message: error.message };
    if (error instanceof TaskCandidateFailure) {
      const draft = readTaskCandidateDraft(error);
      post({ ...failure, code: error.code, ...(draft ? { draft } : {}) });
    } else post(failure);
  } finally {
    rejectPending(new AiTaskCancelledError());
    activeTaskId = undefined;
  }
}

scope.onmessage = event => {
  const message = event.data;
  if (message.type === "cancel") {
    if (message.taskId !== activeTaskId) return;
    cancelled = true;
    rejectPending(new AiTaskCancelledError());
    return;
  }
  if (message.type === "invoke-result" || message.type === "invoke-error") {
    if (message.taskId !== activeTaskId) return;
    const call = pending.get(message.callId);
    if (!call) return;
    pending.delete(message.callId);
    if (message.type === "invoke-result") call.resolve(message.value);
    else call.reject(message.name === "AiTaskCancelledError" ? new AiTaskCancelledError() : message.name === "AiTaskDeadlineError" ? new AiTaskDeadlineError() : Object.assign(new Error(message.message), { name: message.name }));
    return;
  }
  if (activeTaskId || message.type !== "start") return;
  void run(message);
};
