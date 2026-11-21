import type { AiDocumentSnapshot } from "../../types/aiEditing";
import type { AiTaskRequest, AiTaskResult, AiTaskRunnerOptions } from "./aiTaskRunner";
import { runPlannedAiTaskCore } from "./plannedTaskRunnerCore";
import { runAiTaskInWorker, shouldUseAiTaskWorker } from "./aiTaskWorkerClient";

/** Route sufficiently large browser tasks through the shared core inside a Worker. */
export async function runPlannedAiTask(request: AiTaskRequest, snapshot: AiDocumentSnapshot, options: AiTaskRunnerOptions): Promise<AiTaskResult> {
  if (shouldUseAiTaskWorker(request, snapshot, options)) {
    return runAiTaskInWorker(request, snapshot, options);
  }
  return runPlannedAiTaskCore(request, snapshot, options);
}
