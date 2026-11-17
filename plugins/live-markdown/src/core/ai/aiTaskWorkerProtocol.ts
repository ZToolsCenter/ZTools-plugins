import type { AiTaskRequest, AiTaskResult } from "./aiTaskRunner";
import type { AiInvocationLimits } from "./aiTaskExecution";
import type { AiDocumentSnapshot } from "../../types/aiEditing";
import type { AiPlannedChunk } from "./aiChunkPlanner";
import type { ProseEditPlan } from "./proseEditPlan";
import type { ExecutionPlan } from "./executionPlan";
import type { TaskCandidateDraft } from "./taskCandidateFailure";

export interface AiTaskWorkerStart {
  type: "start";
  taskId: string;
  request: AiTaskRequest;
  snapshot: AiDocumentSnapshot;
  maxDurationMs: number;
  maxCalls: number;
  callbacks: { progress: boolean; protection: boolean; prosePlan: boolean; executionPlan?: boolean };
}
export interface AiTaskWorkerInvokeResult { type: "invoke-result"; taskId: string; callId: string; value: string; }
export interface AiTaskWorkerInvokeError { type: "invoke-error"; taskId: string; callId: string; name: string; message: string; }
export interface AiTaskWorkerCancel { type: "cancel"; taskId: string; }
export type AiTaskWorkerCommand = AiTaskWorkerStart | AiTaskWorkerInvokeResult | AiTaskWorkerInvokeError | AiTaskWorkerCancel;

export interface AiTaskWorkerInvoke {
  type: "invoke";
  taskId: string;
  callId: string;
  prompt: string;
  systemPrompt: string;
  maxTokens: number;
  limits: AiInvocationLimits;
}
export interface AiTaskWorkerProgress { type: "progress"; taskId: string; message: string; }
export interface AiTaskWorkerProtection { type: "protection"; taskId: string; chunk: AiPlannedChunk | undefined; }
export interface AiTaskWorkerProsePlan { type: "prose-plan"; taskId: string; plan: ProseEditPlan; }
export interface AiTaskWorkerExecutionPlan { type: "execution-plan"; taskId: string; plan: ExecutionPlan; }
export interface AiTaskWorkerResult { type: "result"; taskId: string; result: Omit<AiTaskResult, "proposal"> & { proposal?: Omit<NonNullable<AiTaskResult["proposal"]>, "snapshot"> }; }
export interface AiTaskWorkerFailure { type: "failure"; taskId: string; name: string; message: string; code?: string; draft?: TaskCandidateDraft; }
export type AiTaskWorkerEvent = AiTaskWorkerInvoke | AiTaskWorkerProgress | AiTaskWorkerProtection | AiTaskWorkerProsePlan | AiTaskWorkerExecutionPlan | AiTaskWorkerResult | AiTaskWorkerFailure;
