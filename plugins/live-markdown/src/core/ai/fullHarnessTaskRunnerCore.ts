import type { AiDocumentSnapshot } from "../../types/aiEditing";
import { runAiTask, type AiTaskRequest, type AiTaskResult, type AiTaskRunnerOptions } from "./aiTaskRunner";
import { createAiTaskExecution } from "./aiTaskExecution";
import { deriveInstructionContract } from "./instructionConstraints";
import { resolveKnownIntent } from "./resolvedIntentContract";
import { PlanValidationError } from "./intentPlanValidation";
import { isSafeMarkdownBoundary } from "./intentTargets";
import { assertIntentInstructionBudget, planAiIntent } from "./intentPlanner";
import { buildAiIntentCandidates } from "./intentContext";
import { bindAiIntent } from "./intentBinder";
import { selectAiChunkGranularity } from "./aiChunkingPolicy";
import { AI_ACTIONS, type AiTaskAction } from "./aiTaskPrompts";
import { validateTaskCandidate } from "./aiOutputContract";
import { restoreMarkdownAfterAi } from "./markdownChunker";
import { createPlannedEditProposal } from "./plannedEditProposal";
import { shouldOmitTaskGenerationSource } from "./artifactGenerationContext";
import { createExecutionPlan, bindStructuredEntry, type ActiveExecutionPlan } from "./executionPlan";
import type { IntentEdit } from "./intentTypes";
import { artifactOutputFormat } from "./artifactSpec";
import { validateArtifactCandidate } from "./artifactValidation";
import { buildTaskGenerationPrompt } from "./taskGenerationPrompt";
import { estimateAiTokens } from "./markdownChunker";
import { runSourceAnswerTask } from "./sourceAnswerPipeline";
import { TaskCandidateFailure } from "./taskCandidateFailure";

function restoredOutput(result: AiTaskResult, source: string): string {
  let text = result.editAction && result.protection
    ? restoreMarkdownAfterAi(result.text, [result.protection]) : result.text;
  if (result.conservative && !result.sourceOwned) {
    text = (source.match(/^\s*/u)?.[0] ?? "") + text.trim() + (source.match(/\s*$/u)?.[0] ?? "");
  }
  return text;
}

function candidateFailure(cause: unknown, text: string, plan: Extract<ActiveExecutionPlan, { kind: "edit" }>, intent: IntentEdit, conservative: boolean, sourceFacts?: readonly string[]): Error {
  const original = cause instanceof Error ? cause : new Error(String(cause));
  try {
    return new TaskCandidateFailure(original.message, { text, plan, intent, conservative, ...(sourceFacts?.length ? { sourceFacts } : {}) },
      "code" in original ? String(original.code) : undefined);
  } catch { return original; }
}

/** Natural-language requests are planned once. Explicit buttons/skills retain their existing route. */
/** Pure task orchestration shared by the UI thread adapter and the Worker entry. */
export async function runFullHarnessTaskCore(request: AiTaskRequest, snapshot: AiDocumentSnapshot, options: AiTaskRunnerOptions): Promise<AiTaskResult> {
  const execution = options.execution ?? createAiTaskExecution(options);
  execution.assertRunning();
  if (new TextEncoder().encode(snapshot.content).byteLength > 1_048_576) throw new Error("内容超过 1 MiB 安全上限，请缩小处理范围。");
  const structured = request.action !== "custom" || Boolean(request.skill);
  const instruction = request.userPrompt || (structured ? request.skill?.userPromptTemplate || request.actionDefinition.prompt ||
    AI_ACTIONS.find(item => item.id === request.action)?.prompt || "请按所选任务处理当前内容。" : "");
  assertIntentInstructionBudget(instruction);
  options.onProgress?.("正在理解指令");
  const selected = Boolean(snapshot.selectionValid !== false && snapshot.selection && snapshot.selection.to > snapshot.selection.from);
  const contract = deriveInstructionContract(instruction, { hasSelection: selected, hasCursor: snapshot.cursor !== null && isSafeMarkdownBoundary(snapshot.content, snapshot.cursor) });
  if (!structured && contract.preconditions.selectionRequired && !selected) throw new PlanValidationError("selection_required");
  if (!structured && contract.preconditions.cursorRequired && !contract.preconditions.cursorAvailable) throw new PlanValidationError("cursor_required");
  if (!structured && contract.effect.state === "explicit" && contract.effect.value === "no_edit") {
    const message = "已遵守不修改文档的要求。";
    return { text: message, executionPolicy: "full", semanticAction: "custom", editAction: false, nonReplacementSkill: false,
      conservative: false, protection: undefined, warnings: [], answerOnly: true, planningMode: "program",
      executionPlan: { version: 2, kind: "no_op", instruction, message } };
  }
  const candidates = buildAiIntentCandidates(instruction, snapshot.content, contract);
  const invokePlanner = Object.assign(
    (prompt: string, systemPrompt: string, maxTokens: number, outputSchema?: Record<string, unknown>) => execution.invoke(prompt, systemPrompt, maxTokens, { silent: true, maxOutputBytes: 4096, outputSchema }),
    { abort: options.abortCurrent }
  );
  // Retain the full reference policy's requirement for an explicit insert layout.
  const knownBound = structured ? bindStructuredEntry(request, snapshot) : resolveKnownIntent(instruction, snapshot, candidates, contract, false);
  const intent = knownBound?.intent ?? await planAiIntent(instruction, selected, candidates, invokePlanner, contract);
  execution.assertRunning();
  const bound = knownBound ?? bindAiIntent(intent, snapshot, instruction, candidates, contract);
  options.onProgress?.(bound.summary);
  const plan = createExecutionPlan(request, snapshot, bound, instruction, knownBound ? "program" : "model");
  options.onExecutionPlan?.(plan);
  execution.assertRunning();
  const plannedTask = plan.task;
  const requirements = plan.requirements;
  const outputFormat = artifactOutputFormat(plan.artifact);
  const displaySource = plan.artifact.displaySource;
  let generated: AiTaskResult | undefined;
  let text = plan.content.mode === "literal" || plan.content.mode === "compose" ? plan.content.text : undefined;
  if (text === undefined) {
    const insertion = intent.kind === "edit" && intent.operation === "insert";
    const action: AiTaskAction = outputFormat === "table" || outputFormat === "code" || outputFormat === "math" ? "custom" : outputFormat === "mermaid" ? "diagram" : plannedTask === "restructure" ? "custom" : plannedTask;
    const prompt = buildTaskGenerationPrompt({ instruction, spec: plan.artifact, effect: plan.kind,
      operation: intent.kind === "edit" ? intent.operation : undefined, task: plannedTask,
      target: intent.kind === "edit" || intent.kind === "answer" ? intent.target : undefined, dependency: bound.dependency });
    const omitGenerationSource = shouldOmitTaskGenerationSource({ instruction, spec: plan.artifact, effect: plan.kind,
      task: plannedTask,
      operation: intent.kind === "edit" ? intent.operation : undefined,
      target: intent.kind === "edit" || intent.kind === "answer" ? intent.target : undefined, dependency: bound.dependency });
    options.onProgress?.(insertion ? "正在生成新增内容" : intent.kind === "answer" ? "正在整理回答" : "正在处理指定内容");
    if (plan.kind === "answer" && plannedTask === "custom" && !omitGenerationSource &&
        (plan.artifact.kind === "none" || plan.artifact.kind === "markdown") && estimateAiTokens(bound.source) > 1400) {
      const answer = await runSourceAnswerTask({ source: bound.source, instruction, systemPrompt: prompt.systemPrompt }, execution, options);
      generated = { ...answer, semanticAction: "custom", editAction: false, nonReplacementSkill: false,
        protection: undefined, conservative: false, outputMode: "answer" };
    } else {
    let completedCalls = 0;
    let completedCandidate: string | undefined;
    const generationExecution = {
      get remainingCalls() { return execution.remainingCalls; },
      assertRunning: execution.assertRunning,
      invoke: async (...args: Parameters<typeof execution.invoke>) => {
        const raw = await execution.invoke(...args);
        completedCalls += 1;
        // Structured receipts and intermediate long-document outputs remain private.
        completedCandidate = completedCalls === 1 && !args[3]?.outputSchema ? raw : undefined;
        return raw;
      }
    };
    try {
    generated = await runAiTask({
      ...request, source: bound.source, scope: bound.dependency === "selection" ? "selection" : "document",
      action, userPrompt: structured ? instruction : prompt.prompt, intentPlanned: true,
      baseSystemPrompt: structured ? request.baseSystemPrompt : prompt.systemPrompt,
      generationContextSource: omitGenerationSource ? "" : undefined,
      outputFormat, displaySource, generationRequirements: { ...requirements, contentInstruction: instruction },
      readOnlyTask: intent.kind === "answer" || insertion || intent.kind === "edit" && intent.operation === "replace_exact",
      actionDefinition: structured ? request.actionDefinition : { id: action, label: "按计划处理", prompt: prompt.prompt },
      granularity: request.granularity === "paragraph" ? "paragraph" : request.provider ? selectAiChunkGranularity(request.provider, action, request.skill) : request.granularity
    }, { ...options, execution: generationExecution });
    } catch (cause) {
      if (plan.kind === "edit" && intent.kind === "edit" && plan.content.mode === "generate" && completedCandidate?.trim()) {
        throw candidateFailure(cause, completedCandidate, plan, intent, false);
      }
      throw cause;
    }
    }
    text = restoredOutput(generated, bound.source);
    execution.assertRunning();
  }
  const verifiedUnchangedSummary = generated?.semanticAction === "summarize"
    && generated.preservedSource === true
    && generated.summaryStats !== undefined
    && Boolean(generated.sourceFacts?.length)
    && generated.text === bound.source
    && text === bound.source;
  const candidateWarnings: string[] = [];
  try {
  if (!verifiedUnchangedSummary) {
    const validated = validateTaskCandidate({
      source: bound.source, raw: text, instruction,
      mode: plan.content.mode === "literal" || plan.content.mode === "compose" ? "literal" : generated?.outputMode ?? (generated?.semanticAction === "summarize" ? "summary" : intent.kind === "answer" ? "answer" : intent.kind === "edit" && intent.operation === "rewrite" ? "rewrite" : "fragment"),
      format: outputFormat,
      literalSource: plan.content.mode === "literal" || plan.content.mode === "compose" ? plan.content.text : undefined,
      sourceFacts: generated?.sourceFacts,
      displaySource,
      reviewPartialOverlap: true,
      allowArtifactReuseFromFacts: plan.content.mode === "source_transform" && Boolean(generated?.sourceFacts?.length)
    });
    text = validated.text;
    if (validated.evidence.some(item => item.kind === "source_overlap_review")) candidateWarnings.push("部分新增内容与原文相近，请在修改对照中检查是否需要保留。");
    validateArtifactCandidate(plan.artifact, text);
  }
  const base: AiTaskResult = {
    text, candidateText: text, executionPolicy: "full", semanticAction: generated?.semanticAction ?? "custom", editAction: structured ? generated?.editAction ?? false : false,
    nonReplacementSkill: false, protection: undefined, conservative: false,
    warnings: [...(generated?.warnings ?? []), ...candidateWarnings], sourceFacts: generated?.sourceFacts, summaryStats: generated?.summaryStats, planSummary: bound.summary,
    resolvedIntent: intent, planningMode: knownBound ? "program" : "model", sourceOwned: generated?.sourceOwned, proseStats: generated?.proseStats, outputMode: generated?.outputMode, executionPlan: plan
  };
  if (verifiedUnchangedSummary) return { ...base, preservedSource: true, ...(intent.kind === "answer" ? { answerOnly: true } : {}) };
  if (intent.kind === "answer") return { ...base, answerOnly: true };
  if (generated?.preservedSource) return { ...base, preservedSource: true };
  if ((intent as IntentEdit).operation === "rewrite" && text === bound.source) {
    return { ...base, preservedSource: true, warnings: [...base.warnings, "处理结果与原文一致，文档保持不变。"] };
  }
  const created = createPlannedEditProposal(bound, snapshot, text, generated?.conservative ?? false);
  const proposal = structured ? { ...created, dependency: undefined } : created;
  execution.assertRunning();
  return { ...base, text: structured ? text : proposal.text, proposal };
  } catch (cause) {
    if (plan.kind === "edit" && intent.kind === "edit" && text.trim()) {
      throw candidateFailure(cause, text, plan, intent, generated?.conservative ?? false, generated?.sourceFacts);
    }
    throw cause;
  }
}
