import type { AiDocumentSnapshot } from "../../types/aiEditing";
import type { AiTaskRequest } from "./aiTaskRunner";
import type { InstructionContract } from "./intentContract";
import type { IntentCandidates, IntentTask, ValidatedIntent } from "./intentTypes";
import { bindAiIntent, type BoundIntent } from "./intentBinder";
import { bindStructuredEntry } from "./executionPlan";
import { resolveKnownIntent } from "./resolvedIntentContract";
import { resolveGenerationRequirements } from "./generationRequirements";
import { resolveArtifactSpec } from "./artifactSpecFromInstruction";
import { renderArtifact } from "./artifactRenderer";
import { isDocumentHeadingQuery } from "./markdownDocumentAnswer";
import { isTaskSourceReferenced } from "./artifactGenerationContext";
import { isNegatedMention } from "./instructionConstraints";
import { hasUnresolvedRelativeAnchor } from "./intentCompoundPolicy";
import { maskQuotedInstruction, scanInstructionQuotes } from "./instructionLiteralEvidence";

export function thinTaskId(contract: InstructionContract): IntentTask {
  if (contract.generationTasks?.state !== "explicit") return "custom";
  for (const task of ["proofread", "polish", "academic-polish", "summarize", "continue", "diagram", "tech-spec", "restructure", "custom"] as const) {
    if (contract.generationTasks.value.includes(task)) return task;
  }
  return "custom";
}

/** Bind only evidenced operations/default scopes. Unknown semantics stay with the one-call model. */
export function bindThinTask(request: AiTaskRequest, snapshot: AiDocumentSnapshot, instruction: string,
  contract: InstructionContract, candidates: IntentCandidates): BoundIntent | null {
  if (request.action !== "custom" || request.skill) return bindStructuredEntry(request, snapshot);
  if (contract.effect.state === "unknown" && !contract.issues.length && isDocumentHeadingQuery(instruction) &&
      (isTaskSourceReferenced(instruction, "answer") || contract.scope.state === "explicit")) {
    const scope = contract.scope.state === "explicit" ? contract.scope.value
      : snapshot.selectionValid !== false && snapshot.selection ? "selection" : "document";
    return bindAiIntent({ version: 1, kind: "answer", target: scope, content: { mode: "generate", task: "custom" } }, snapshot, instruction, candidates, contract);
  }
  const known = resolveKnownIntent(instruction, snapshot, candidates, contract);
  if (known) return known;
  // A declared code artifact plus an explicit insertion anchor already settles
  // the operation. Quoted JSON values/headings are artifact fields, not a reason
  // to ask a second, more general operation-and-body protocol to recreate them.
  const masked = maskQuotedInstruction(instruction, scanInstructionQuotes(instruction));
  const hasCreation = [...masked.matchAll(/生成|创建|定义|实现|新增|追加|输出|\b(?:generate|create|define|implement|append|output)\b/giu)]
    .some(match => !isNegatedMention(masked, match.index, match.index + match[0].length));
  const anchor = contract.target.state === "explicit" ? contract.target.value : undefined;
  const unambiguous = !contract.issues.length && [contract.effect, contract.operation, contract.target, contract.scope, contract.layout, contract.heading]
    .every(item => item.state !== "conflict" && item.state !== "ambiguous");
  if (unambiguous && hasCreation && (anchor === "document_end" || anchor === "body_start") &&
      (contract.effect.state === "unknown" || contract.effect.state === "explicit" && contract.effect.value === "edit") &&
      (contract.operation.state === "unknown" || contract.operation.state === "explicit" && contract.operation.value === "insert")) {
    const requirements = resolveGenerationRequirements(instruction);
    const spec = resolveArtifactSpec(instruction, requirements, { effect: "edit", operation: "insert" });
    if (spec.kind === "code" && spec.language && !spec.issues.length && !spec.sourceDependent) {
      return bindAiIntent({ version: 1, kind: "edit", operation: "insert", target: anchor,
        layout: contract.layout.state === "explicit" ? contract.layout.value : "block",
        content: { mode: "generate", task: "custom" } }, snapshot, instruction, candidates, contract);
    }
  }
  // A failed literal bind must not fall through as generated prose. Keep the
  // request for the single-call planner when its exact payload is too large,
  // ambiguous, or accompanied by an additional instruction.
  if (contract.literals.some(({ role }) => role === "write")) return null;
  if (contract.issues.length || [contract.effect, contract.operation, contract.target, contract.scope, contract.layout, contract.heading]
    .some(item => item.state === "conflict" || item.state === "ambiguous")) return null;
  const selected = Boolean(snapshot.selectionValid !== false && snapshot.selection && snapshot.selection.from < snapshot.selection.to);
  const scope = contract.scope.state === "explicit" ? contract.scope.value : selected ? "selection" : "document";
  const content = { mode: "generate" as const, task: thinTaskId(contract) };
  let intent: ValidatedIntent;
  if (contract.effect.state === "explicit" && contract.effect.value === "answer") {
    intent = { version: 1, kind: "answer", target: scope, content };
  } else if (contract.effect.state === "explicit" && contract.effect.value === "edit" && contract.operation.state === "explicit") {
    if (contract.operation.value === "rewrite") intent = { version: 1, kind: "edit", operation: "rewrite", target: scope, content };
    else if (contract.operation.value === "insert") {
      if (contract.target.state === "unknown" && hasUnresolvedRelativeAnchor(masked)) return null;
      const target = contract.target.state === "explicit" ? contract.target.value : !selected ? "document_end" : undefined;
      if (target !== "body_start" && target !== "document_end" && target !== "cursor" && target !== "selection_end") return null;
      intent = { version: 1, kind: "edit", operation: "insert", target,
        layout: contract.layout.state === "explicit" ? contract.layout.value
          : target === "cursor" || target === "selection_end" ? "inline" : "block", content };
    } else return null;
  } else {
    // Positive artifact evidence plus a complete field specification can authorize
    // the documented no-selection EOF default without another model classification.
    const requirements = resolveGenerationRequirements(instruction);
    if (requirements.artifact.state !== "explicit" || contract.effect.state !== "unknown" || contract.operation.state !== "unknown") return null;
    const spec = resolveArtifactSpec(instruction, requirements, { effect: "edit", operation: "insert" });
    if (spec.kind === "table" && spec.sourceDependent &&
        /(?:根据|基于|按照).{0,12}(?:原文|来源|选区|全文)|\b(?:from|based\s+on)\s+(?:the\s+)?(?:source|document|selection)\b/iu.test(instruction) &&
        /生成|创建|整理|转换|\b(?:generate|create|convert|transform)\b/iu.test(instruction)) {
      const transformScope = selected && !/全文|整篇|整个(?:文档|文件)|全篇|whole\s+(?:document|file)|entire\s+(?:document|file)/iu.test(instruction)
        ? "selection" : scope;
      return bindAiIntent({ version: 1, kind: "edit", operation: "rewrite", target: transformScope, content }, snapshot, instruction, candidates, contract);
    }
    if (selected || spec.composition !== "complete" || renderArtifact(spec) === undefined) return null;
    intent = { version: 1, kind: "edit", operation: "insert", target: "document_end", layout: "block", content };
  }
  return bindAiIntent(intent, snapshot, instruction, candidates, contract);
}
