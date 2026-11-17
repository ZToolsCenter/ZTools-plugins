import type { InstructionContract, InstructionSpan } from "./intentContract";
import type { IntentTarget } from "./intentTypes";

interface ContinuationContext {
  hasSelection?: boolean;
}

const CONTINUATION_TARGETS = new Set<IntentTarget>([
  "body_start", "document_end", "cursor", "selection_end", "heading_end", "section_end", "exact_match"
]);
const FORBIDDEN_ADDITION = /(?:请\s*)?(?:不要|别|禁止|不得|不许|不能|不可|无需|无须|不需要|不必|不|don't|do\s+not|must\s+not|mustn't)\s*(?:再|继续)?\s*(?:新增|添加|增加|追加|加入|写入|生成|add|append|insert|write|generate)\s*(?:(?:任何|any)\s*)?(?:(?:新的?|new)\s*)?(?:内容|文本|文字|段落|信息|content|text|paragraphs?)(?![\p{L}\p{N}_])/giu;

function isExplicit<T>(constraint: { state: string; value?: T }): constraint is { state: "explicit"; value: T; evidence: InstructionSpan[] } {
  return constraint.state === "explicit";
}

function hasContractConflict(contract: InstructionContract): boolean {
  return contract.issues.length > 0 || [contract.effect, contract.operation, contract.target, contract.scope,
    contract.layout, contract.generationTasks ?? { state: "unknown" }]
    .some(({ state }) => state === "ambiguous" || state === "conflict");
}

function isSinglePositiveContinuation(contract: InstructionContract): boolean {
  const generationTasks = contract.generationTasks;
  return !hasContractConflict(contract) &&
    isExplicit(contract.effect) && contract.effect.value === "edit" &&
    isExplicit(contract.operation) && contract.operation.value === "rewrite" && contract.operation.evidence.length === 1 &&
    generationTasks !== undefined && isExplicit(generationTasks) && generationTasks.value.length === 1 && generationTasks.value[0] === "continue" &&
    generationTasks.evidence.length === 1;
}

function forbiddenAdditionEvidence(instruction: string, masked: string): InstructionSpan[] {
  FORBIDDEN_ADDITION.lastIndex = 0;
  return [...masked.matchAll(FORBIDDEN_ADDITION)].map((match) => {
    const from = match.index ?? 0;
    const to = from + match[0].length;
    return { from, to, raw: instruction.slice(from, to) };
  });
}

function inferredTarget(contract: InstructionContract, context: ContinuationContext): IntentTarget | undefined {
  if (isExplicit(contract.target)) {
    if (CONTINUATION_TARGETS.has(contract.target.value)) return contract.target.value;
    if (contract.target.value === "document") return "document_end";
    if (contract.target.value === "selection" && context.hasSelection === true) return "selection_end";
    return undefined;
  }
  if (contract.target.state !== "unknown") return undefined;
  if (isExplicit(contract.scope)) {
    if (contract.scope.value === "document") return "document_end";
    return context.hasSelection === true ? "selection_end" : undefined;
  }
  if (context.hasSelection === true) return "selection_end";
  if (context.hasSelection === false) return "document_end";
  return undefined;
}

/** Locks a single affirmative continuation to an insertion range; location defaults follow editor scope. */
export function applyContinuationIntentDefaults(
  contract: InstructionContract,
  context: ContinuationContext,
  instruction: string,
  masked: string
): void {
  if (!isSinglePositiveContinuation(contract)) return;
  if (contract.operation.state !== "explicit" || contract.generationTasks?.state !== "explicit") return;
  const forbidden = forbiddenAdditionEvidence(instruction, masked);
  if (forbidden.length) {
    const evidence = [...contract.operation.evidence, ...forbidden];
    contract.operation = { state: "conflict", alternatives: ["insert", "rewrite"], evidence };
    contract.issues.push({ code: "conflicting_constraints", evidence });
    return;
  }
  const target = inferredTarget(contract, context);
  if (!target) return;

  const targetEvidence = contract.target.state === "explicit" ? contract.target.evidence
    : contract.scope.state === "explicit" ? contract.scope.evidence : contract.operation.evidence;
  contract.operation = { state: "explicit", value: "insert", evidence: contract.operation.evidence };
  contract.target = { state: "explicit", value: target, evidence: targetEvidence };
  if (contract.layout.state === "unknown") {
    contract.layout = { state: "explicit", value: "block", evidence: targetEvidence };
  }
  if (target === "selection_end") {
    contract.preconditions.selectionRequired = true;
    contract.preconditions.selectionAvailable = context.hasSelection;
  }
}
