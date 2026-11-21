import type { AiDocumentSnapshot } from "../../types/aiEditing";
import type { AiTaskRequest, AiTaskResult, AiTaskRunnerOptions } from "./aiTaskRunner";
import { runThinAiTaskCore } from "./thinTaskRunnerCore";
import { runFullHarnessTaskCore } from "./fullHarnessTaskRunnerCore";

/** One production entry. Full is explicit; the default is thin. */
export function runPlannedAiTaskCore(request: AiTaskRequest, snapshot: AiDocumentSnapshot, options: AiTaskRunnerOptions): Promise<AiTaskResult> {
  return request.executionPolicy === "full" ? runFullHarnessTaskCore(request, snapshot, options) : runThinAiTaskCore(request, snapshot, options);
}
