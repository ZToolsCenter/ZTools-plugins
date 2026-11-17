import type { AiTaskRequest } from "./aiTaskRunner";
import type { AiDocumentSnapshot } from "../../types/aiEditing";
import type { BoundIntent } from "./intentBinder";
import { bindAiIntent } from "./intentBinder";
import type { IntentTask, ValidatedIntent } from "./intentTypes";
import type { InstructionSpan } from "./intentContract";
import { resolveIntentGenerationRequirements } from "./intentGenerationRequirements";
import type { GenerationRequirements } from "./generationRequirements";
import type { ArtifactSpec } from "./artifactSpec";
import { resolveArtifactSpec } from "./artifactSpecFromInstruction";
import { renderArtifact } from "./artifactRenderer";
import { validateArtifactCandidate } from "./artifactValidation";
import { resolveAiSemanticAction } from "./aiTaskPrompts";
import { mergeArtifactPlanHint } from "./intentArtifactHint";

type Recipe =
  | { readonly mode: "literal"; readonly text: string; readonly evidence: readonly InstructionSpan[] }
  | { readonly mode: "compose"; readonly text: string }
  | { readonly mode: "source_transform" | "generate" | "prose_slots" | "summary_ledger" };

interface PlannedTask {
  readonly version: 2;
  readonly instruction: string;
  readonly artifact: ArtifactSpec;
  readonly requirements: GenerationRequirements;
  readonly content: Recipe;
  readonly task: IntentTask;
  readonly planningMode: "program" | "model";
}

export type ExecutionPlan =
  | PlannedTask & { readonly kind: "edit"; readonly operation: "insert" | "replace_exact" | "rewrite";
      readonly target: { readonly documentId: string; readonly revision: number; readonly from: number;
        readonly to: number; readonly dependency: BoundIntent["dependency"] } }
  | PlannedTask & { readonly kind: "answer"; readonly readScope: { readonly from: number; readonly to: number } }
  | { readonly version: 2; readonly kind: "no_op"; readonly instruction: string; readonly message: string };

export type ActiveExecutionPlan = Extract<ExecutionPlan, { kind: "edit" | "answer" }>;

/** UI buttons and Skills are already structured tasks; no lexical reclassification or model planning. */
export function bindStructuredEntry(request: AiTaskRequest, snapshot: AiDocumentSnapshot): BoundIntent {
  const task = resolveAiSemanticAction(request.action, request.skill?.category) as IntentTask;
  const selection = request.scope === "selection";
  if (selection && (!snapshot.selection || snapshot.selectionValid === false)) throw new Error("当前选区无法准确定位，原文未修改。");
  const target = selection ? "selection" : "document";
  const intent: ValidatedIntent = task === "summarize" || task === "diagram" && snapshot.readOnly
    ? { version: 1, kind: "answer", target, content: { mode: "generate", task } }
    : task === "diagram"
    ? { version: 1, kind: "edit", operation: "insert", target: selection ? "selection_end" : snapshot.cursor === null ? "document_end" : "cursor", layout: "block", content: { mode: "generate", task } }
    : task === "continue"
    ? { version: 1, kind: "edit", operation: "insert", target: selection ? "selection_end" : "document_end", layout: "block", content: { mode: "generate", task } }
    : { version: 1, kind: "edit", operation: "rewrite", target, content: { mode: "generate", task } };
  const bound = bindAiIntent(intent, snapshot, "", { headings: [], literals: [] });
  if (request.source !== bound.source) throw new Error(selection ? "当前选区无法与原始 Markdown 源码准确对应，原文未修改。" : "任务输入与文档范围不一致，原文未修改。");
  return bound;
}

/** The only artifact/strategy decision point after binding. Executors consume this immutable plan. */
export function createExecutionPlan(
  request: AiTaskRequest, snapshot: AiDocumentSnapshot, bound: BoundIntent,
  instruction: string, planningMode: "program" | "model"
): ActiveExecutionPlan {
  const intent = bound.intent;
  if (intent.kind !== "edit" && intent.kind !== "answer") throw new Error("未解决的意图不能执行。");
  const task = intent.content.mode === "generate" ? intent.content.task : "custom";
  const requirements = resolveIntentGenerationRequirements(instruction, intent, request.skill);
  if (requirements.artifact.state === "conflict" || requirements.display.state === "conflict") {
    throw new Error("本次指令包含不兼容的产物或展示要求，原文未修改。");
  }
  let artifact = resolveArtifactSpec(instruction, requirements, { effect: intent.kind, operation: intent.kind === "edit" ? intent.operation : undefined });
  artifact = mergeArtifactPlanHint(artifact, intent.content.mode === "generate" ? intent.content.artifact : undefined, instruction);
  if (artifact.kind === "none" && task === "diagram") artifact = { ...artifact, kind: "mermaid", sourceDependent: true };
  if (artifact.issues.length) throw new Error(`产物要求未能确定：${artifact.issues.join("；")}。原文未修改。`);

  let content: Recipe;
  if (bound.literalText !== undefined) {
    validateArtifactCandidate(artifact, bound.literalText);
    content = { mode: "literal", text: bound.literalText,
      evidence: bound.contract?.literals.filter(item => item.role === "write") ?? [] };
  } else {
    const composed = intent.kind === "edit" && intent.operation === "insert" ? renderArtifact(artifact) : undefined;
    content = composed !== undefined ? { mode: "compose", text: composed }
      : ["polish", "proofread", "academic-polish"].includes(task) ? { mode: "prose_slots" }
      : task === "summarize" ? { mode: "summary_ledger" }
      : artifact.sourceDependent && ["table", "mermaid", "math"].includes(artifact.kind) ? { mode: "source_transform" }
      : { mode: "generate" };
  }
  const common: PlannedTask = { version: 2, instruction, artifact, requirements, content, task, planningMode };
  return Object.freeze(intent.kind === "answer"
    ? { ...common, kind: "answer", readScope: { from: bound.range.from, to: bound.range.to } }
    : { ...common, kind: "edit", operation: intent.operation, target: {
      documentId: snapshot.documentId, revision: snapshot.revision, from: bound.range.from,
      to: bound.range.to, dependency: bound.dependency
    } });
}
