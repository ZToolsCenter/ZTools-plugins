import { calculateLocalAiBudget } from "./requestBudget";
import { buildIntentPlanningPrompt, buildIntentSystemPrompt } from "./intentPrompts";
import { parseIntentOutput } from "./intentSchema";
import { buildIntentOutputSchema } from "./intentOutputSchema";
import { deriveInstructionContract } from "./instructionConstraints";
import { AiTaskDeadlineError } from "./aiTaskExecution";
import type { InstructionContract } from "./intentContract";
import { IntentProtocolError, type IntentCandidates, type IntentInvoke, type ValidatedIntent } from "./intentTypes";
import { requestsCodeArtifact } from "./intentArtifactContent";

const MAX_INSTRUCTION_BYTES = 64 * 1024;
const PLANNING_OUTPUT_TOKENS = 384;
const encoder = new TextEncoder();

export function assertIntentInstructionBudget(instruction: string): void {
  if (typeof instruction !== "string" || !instruction.trim() || encoder.encode(instruction).byteLength > MAX_INSTRUCTION_BYTES) {
    throw new IntentProtocolError("budget_exceeded");
  }
}

function requiresSelection(intent: ValidatedIntent): boolean {
  if (intent.kind === "answer") return intent.target === "selection";
  if (intent.kind !== "edit") return false;
  return intent.target === "selection" || intent.target === "selection_end" ||
    (intent.target === "exact_match" && intent.matchScope === "selection");
}

/** One buffered planning call; the caller's shared task execution owns timeout and cancellation. */
export async function planAiIntent(
  instruction: string,
  selected: boolean,
  candidates: IntentCandidates,
  invoke: IntentInvoke,
  contract?: InstructionContract
): Promise<ValidatedIntent> {
  assertIntentInstructionBudget(instruction);
  contract ??= deriveInstructionContract(instruction, { hasSelection: selected });

  let prompt: string;
  let budget: ReturnType<typeof calculateLocalAiBudget>;
  const creatingCode = contract.operation.state === "explicit" && contract.operation.value === "insert" && requestsCodeArtifact(instruction);
  const systemPrompt = buildIntentSystemPrompt(selected, candidates, creatingCode);
  try {
    prompt = buildIntentPlanningPrompt(instruction, selected, candidates, contract);
    budget = calculateLocalAiBudget(prompt, systemPrompt, PLANNING_OUTPUT_TOKENS);
  } catch {
    throw new IntentProtocolError("budget_exceeded");
  }

  let output: string;
  try {
    output = await invoke(prompt, systemPrompt, budget.maxTokens, buildIntentOutputSchema(instruction, selected, candidates, contract));
  } catch (error) {
    if (error instanceof AiTaskDeadlineError) throw new IntentProtocolError("timeout");
    throw error;
  }

  const intent = parseIntentOutput(output, instruction, candidates, contract);
  const explicitSelectionEdit = contract.preconditions.selectionRequired;
  if (!selected && intent.kind === "edit" && explicitSelectionEdit) {
    throw new IntentProtocolError("selection_required");
  }
  if (!selected && intent.kind === "clarify" && intent.reason === "scope_conflict") {
    throw new IntentProtocolError(explicitSelectionEdit ? "selection_required" : "scope_mismatch");
  }
  if (!selected && intent.kind === "clarify" && intent.reason === "missing_target" && explicitSelectionEdit) {
    throw new IntentProtocolError("selection_required");
  }
  if (!selected && requiresSelection(intent)) {
    throw new IntentProtocolError(explicitSelectionEdit ? "selection_required" : "scope_mismatch");
  }
  return intent;
}
