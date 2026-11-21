import type { AiDocumentSnapshot } from "../../types/aiEditing";
import type { InstructionContract } from "./intentContract";
import { isCompleteFencedCodeLiteral } from "./instructionLiteralEvidence";
import { bindAiIntent, type BoundIntent } from "./intentBinder";
import type { IntentCandidates, IntentContent, IntentOccurrence, IntentTask, ValidatedIntent } from "./intentTypes";
import { canResolveIntentProgrammatically } from "./programIntentPolicy";

const encoder = new TextEncoder();

function hasConflict(contract: InstructionContract): boolean {
  return contract.issues.length > 0 || [contract.effect, contract.operation, contract.target, contract.scope,
    contract.occurrence, contract.layout, contract.heading, ...(contract.generationTasks ? [contract.generationTasks] : [])]
    .some((constraint) => constraint.state === "ambiguous" || constraint.state === "conflict");
}

function valuesFor(contract: InstructionContract, role: "find" | "write"): string[] {
  return [...new Set(contract.literals.filter((literal) => literal.role === role).map(({ value }) => value))];
}

function uniqueRoleValue(contract: InstructionContract, role: "find" | "write"): string | undefined {
  const values = valuesFor(contract, role);
  return values.length === 1 ? values[0] : undefined;
}

function generationTask(contract: InstructionContract): IntentTask | undefined {
  if (contract.generationTasks?.state !== "explicit" || !contract.generationTasks.value.length) return undefined;
  const allowed = contract.generationTasks.value;
  // The parser uses alternatives for one user-facing task (for example polish vs academic polish).
  for (const preferred of ["summarize", "continue", "tech-spec", "diagram", "proofread", "polish", "academic-polish", "restructure", "custom"] as const) {
    if (allowed.includes(preferred)) return preferred;
  }
  return undefined;
}

function editableTarget(contract: InstructionContract, snapshot?: AiDocumentSnapshot): "document" | "selection" | undefined {
  const target = contract.target.state === "explicit" ? contract.target.value : undefined;
  if (target === "document" || target === "selection") return target;
  const scope = contract.scope.state === "explicit" ? contract.scope.value : undefined;
  if (scope) return scope;
  if (contract.preconditions.selectionRequired) return "selection";
  if (snapshot?.selection && snapshot.selection.from < snapshot.selection.to && snapshot.selectionValid !== false) return "selection";
  if (contract.preconditions.selectionAvailable === true) return "selection";
  return "document";
}

function generatedContent(contract: InstructionContract): Extract<IntentContent, { mode: "generate" }> | undefined {
  const task = generationTask(contract);
  return task ? { mode: "generate", task } : undefined;
}

function literalContent(contract: InstructionContract): Extract<IntentContent, { mode: "literal"; text: string }> | undefined {
  const value = uniqueRoleValue(contract, "write");
  if (value === undefined || !value || encoder.encode(value).byteLength > 256) return undefined;
  return { mode: "literal", text: value };
}

function isSinglePolishRefinement(contract: InstructionContract): boolean {
  const task = contract.generationTasks;
  const writes = contract.literals.filter(({ role }) => role === "write");
  const finds = contract.literals.filter(({ role }) => role === "find");
  return contract.effect.state === "explicit" && contract.effect.value === "edit" &&
    contract.operation.state === "explicit" && contract.operation.value === "replace_exact" &&
    contract.occurrence.state === "explicit" && contract.occurrence.value === "single" &&
    contract.scope.state === "explicit" && ["selection", "document"].includes(contract.scope.value) &&
    writes.length === 1 && finds.length === 1 &&
    (task?.state !== "explicit" || task.value.length > 0 && task.value.every((value) => value === "polish" || value === "academic-polish"));
}

function hasTrailingTask(text: string): boolean {
  return /(?:^|[.!?。！？,，;；]\s*)(?:并|然后|再|同时|以及|\band(?:\s+then)?\b|\bthen\b|\balso\b)\s*(?!(?:不|不要|别|无需|无须|never|do\s+not))(?=(?:.{0,24})?(?:解释|说明|分析|总结|生成|写|添加|增加|补充|检查|核对|润色|校对|改写|修改|转换|翻译|explain|describe|analy[sz]e|summari[sz]e|generate|write|add|check|verify|polish|proofread|rewrite|modify|translate))/iu.test(text);
}

function hasAdditionalLiteralTask(instruction: string, contract: InstructionContract): boolean {
  const writes = contract.literals.filter((literal) => literal.role === "write");
  const taskIsNarrowPolishLabel = contract.generationTasks?.state === "explicit" &&
    contract.generationTasks.value.length > 0 &&
    contract.generationTasks.value.every((value) => value === "polish" || value === "academic-polish");
  const taskIsCompleteCodeLiteral = contract.generationTasks?.state === "explicit" &&
    contract.generationTasks.value.length === 1 && contract.generationTasks.value[0] === "custom" &&
    contract.operation.state === "explicit" && contract.operation.value === "insert" &&
    writes.length === 1 && isCompleteFencedCodeLiteral(writes[0].value);
  if (contract.generationTasks?.state === "explicit" &&
    !(taskIsNarrowPolishLabel && isSinglePolishRefinement(contract)) && !taskIsCompleteCodeLiteral) return true;
  if (writes.length !== 1) return true;
  const trailing = instruction.slice(writes[0].to).replace(/^[”’」』》"'`]*/u, "");
  return hasTrailingTask(trailing);
}

function writeContent(contract: InstructionContract): IntentContent | undefined {
  return literalContent(contract) ?? generatedContent(contract);
}

function occurrence(contract: InstructionContract): IntentOccurrence | undefined {
  return contract.occurrence.state === "explicit" ? contract.occurrence.value : undefined;
}

function headingTarget(
  contract: InstructionContract,
  candidates: IntentCandidates
): { target: "heading_end" | "section_end"; targetId: string } | undefined {
  if (contract.heading.state !== "explicit") return undefined;
  const heading = contract.heading.value;
  const normalized = heading.text.normalize("NFC").trim().replace(/\s+/gu, " ").toLocaleLowerCase();
  const matches = candidates.headings.filter((candidate) =>
    candidate.text.normalize("NFC").trim().replace(/\s+/gu, " ").toLocaleLowerCase() === normalized);
  const selected = heading.ordinalScope === "global" && heading.ordinal !== undefined
    ? candidates.headings[0]
    : heading.ordinal === undefined ? matches.length === 1 ? matches[0] : undefined : matches[heading.ordinal - 1];
  if (!selected || candidates.incomplete) return undefined;
  return { target: heading.relation, targetId: selected.id };
}

function knownIntentShape(
  candidates: IntentCandidates,
  contract: InstructionContract,
  instruction: string,
  defaultInsertLayout: boolean
): ValidatedIntent | null {
  if (hasConflict(contract)) return null;
  const effect = contract.effect.state === "explicit" ? contract.effect.value : undefined;
  const task = generationTask(contract);
  const target = contract.target.state === "explicit" ? contract.target.value : undefined;

  if (effect === "answer") {
    const answerTarget = target === "document" || target === "selection"
      ? target
      : contract.scope.state === "explicit" ? contract.scope.value : undefined;
    if (!answerTarget || !task) return null;
    return { version: 1, kind: "answer", target: answerTarget, content: { mode: "generate", task } };
  }
  if (effect !== "edit" || contract.operation.state !== "explicit") return null;

  const operation = contract.operation.value;
  const content = writeContent(contract);
  if (!content) return null;
  if (content.mode === "literal" && valuesFor(contract, "write").length !== 1) return null;
  if (content.mode === "literal" && hasAdditionalLiteralTask(instruction, contract)) return null;

  if (operation === "rewrite") {
    const editTarget = editableTarget(contract);
    if (!editTarget) return null;
    return { version: 1, kind: "edit", operation, target: editTarget, content };
  }

  if (operation === "replace_exact") {
    const editTarget = editableTarget(contract);
    const find = uniqueRoleValue(contract, "find");
    const position = occurrence(contract);
    if (!editTarget || !find || !position || valuesFor(contract, "find").length !== 1) return null;
    return { version: 1, kind: "edit", operation, target: editTarget, find, occurrence: position, content };
  }

  if (operation !== "insert") return null;
  if (!defaultInsertLayout && contract.layout.state !== "explicit") return null;
  const layout = contract.layout.state === "explicit"
    ? contract.layout.value
    : target === "cursor" || target === "selection_end" ? "inline" : "block";
  const insertContent = content;
  if (target === "exact_match") {
    const find = uniqueRoleValue(contract, "find");
    const position = occurrence(contract);
    const matchScope = contract.scope.state === "explicit" ? contract.scope.value : undefined;
    if (!find || !position || !matchScope) return null;
    return { version: 1, kind: "edit", operation, target, find, occurrence: position, matchScope, layout, content: insertContent };
  }
  if (target === "heading_end" || target === "section_end") {
    const heading = headingTarget(contract, candidates);
    if (!heading || heading.target !== target) return null;
    return { version: 1, kind: "edit", operation, target, targetId: heading.targetId, layout, content: insertContent };
  }
  if (target === "body_start" || target === "document_end" || target === "cursor" || target === "selection_end") {
    return { version: 1, kind: "edit", operation, target, layout, content: insertContent };
  }
  // A known write without an evidenced insertion location must never become an EOF append.
  return null;
}

/** Only closed instruction templates may skip semantic planning, then bind against the source snapshot. */
export function resolveKnownIntent(
  instruction: string,
  snapshot: AiDocumentSnapshot,
  candidates: IntentCandidates,
  contract: InstructionContract,
  defaultInsertLayout = true
): BoundIntent | null {
  const intent = knownIntentShape(candidates, contract, instruction, defaultInsertLayout);
  if (!intent || !canResolveIntentProgrammatically(instruction, intent)) return null;
  try {
    return bindAiIntent(intent, snapshot, instruction, candidates, contract);
  } catch {
    return null;
  }
}
