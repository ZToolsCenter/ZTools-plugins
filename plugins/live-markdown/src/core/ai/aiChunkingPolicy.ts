import type { AiProviderId } from "../../types/aiOrchestration";
import type { AiSkill } from "../../types/typora";
import { isConservativeAiAction, isReplacementAiAction, type AiTaskAction } from "./aiTaskPrompts";

type SkillPolicy = Pick<AiSkill, "id" | "category">;

/** Local conservative edits are easier for small models when each call owns one paragraph. */
export function selectAiChunkGranularity(
  provider: AiProviderId,
  action: AiTaskAction,
  skill?: SkillPolicy
): "budget" | "paragraph" {
  if (provider !== "local") return "budget";
  if (!isReplacementAiAction(action, skill?.category)) return "budget";
  return isConservativeAiAction(action, skill?.id, skill?.category) ? "paragraph" : "budget";
}
