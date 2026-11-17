import type { AiTaskRequest, AiTaskRunnerOptions } from "./aiTaskRunner";
import type { BoundIntent } from "./intentBinder";
import type { ArtifactSpec } from "./artifactSpec";
import type { AiTaskExecution } from "./aiTaskExecution";
import type { ThinTaskOutput } from "./thinTaskOutput";
import { isTaskSourceReferenced } from "./artifactGenerationContext";
import { answerMarkdownKnowledge } from "./markdownKnowledge";
import { resolveIntentGenerationRequirements } from "./intentGenerationRequirements";
import { prepareArtifactFill, type PreparedArtifactFill } from "./artifactFill";
import { runThinProseTask } from "./thinProseTask";
import { runThinEvidenceAnswer } from "./thinEvidenceAnswer";
import { calculateLocalAiBudget } from "./requestBudget";
import { runSummaryTask } from "./aiSummaryPipeline";
import { answerDocumentHeadings } from "./markdownDocumentAnswer";
import { analyzeEvidenceQuestion } from "./thinEvidenceFields";
import { referencesDocumentFields } from "./thinSourceDependency";
import { isEvaluatedSmallLocalModel } from "./modelCapabilityAdvice";
import { createRoutineStyleCanonicalAuthority } from "./proseRoutineStyleContext";
import { createSourceOwnedFactAuthority } from "./sourceOwnedFactAuthority";

interface ContentInput {
  request: AiTaskRequest;
  bound: BoundIntent;
  instruction: string;
  spec: ArtifactSpec;
  source: string;
  systemPrompt: string;
}

function requestsFieldProjection(instruction: string): boolean {
  return /^(?:请\s*)?只(?:总结|整理|提取|列出|回答)/u.test(instruction.trim()) &&
    !/全文|摘要|重点|概述|要点|整体|自己的话/u.test(instruction) &&
    analyzeEvidenceQuestion(instruction, []).fields.length >= 2;
}

async function fillArtifact(fill: PreparedArtifactFill, request: AiTaskRequest,
  execution: AiTaskExecution, options: AiTaskRunnerOptions): Promise<ThinTaskOutput> {
  const tokens = request.provider === "ztools" || request.provider === "atools" ? fill.maxTokens
    : calculateLocalAiBudget(fill.prompt, fill.systemPrompt, fill.maxTokens).maxTokens;
  options.onProgress?.("正在生成内容，格式由编辑器组装");
  const raw = await execution.invoke(fill.prompt, fill.systemPrompt, tokens, { silent: true, outputSchema: fill.outputSchema });
  execution.assertRunning();
  return { ...fill.decode(raw), executor: "artifact" };
}

/** Select by semantics first. Budget only determines the batches within an executor. */
export async function executeThinContent(input: ContentInput, execution: AiTaskExecution,
  options: AiTaskRunnerOptions): Promise<ThinTaskOutput | null> {
  const { request, bound, instruction, spec, source } = input;
  if (request.executionPolicy === "direct") return null;
  // Dedicated protocols supply their own output contract; do not inherit the
  // free-generation "return the complete Markdown" presentation instruction.
  const systemPrompt = request.skill?.systemPrompt || request.baseSystemPrompt || input.systemPrompt;
  const intent = bound.intent;
  if (intent.kind !== "edit" && intent.kind !== "answer") return null;
  const task = intent.content.mode === "generate" ? intent.content.task : "custom";

  if (intent.kind === "answer") {
    if (spec.kind !== "none" && spec.kind !== "markdown") {
      const requirements = resolveIntentGenerationRequirements(instruction, intent, request.skill);
      const fill = prepareArtifactFill({ instruction, spec, requirements, source, includeSource: Boolean(source), systemPrompt });
      if (fill) return fillArtifact(fill, request, execution, options);
      // Keep an explicitly requested answer format in the ordinary generation
      // path when no typed adapter can represent it; a field list would drop it.
      return null;
    }
    const sourceBound = task === "summarize" || bound.dependency !== "document" || isTaskSourceReferenced(instruction, "answer") ||
      referencesDocumentFields(instruction, bound.source);
    if (sourceBound) {
      const headings = answerDocumentHeadings(instruction, bound.documentContent, bound.range);
      if (headings) return headings;
      if (task === "summarize" && !requestsFieldProjection(instruction)) {
        // Generic summaries retain their dedicated summary executor, not a QA quote list.
        if (/用自己的话|不要(?:引用|摘录|原句)|自由改写|in\s+(?:your|my)\s+own\s+words/iu.test(instruction)) return null;
        const summary = await runSummaryTask({ ...request, source: bound.source, userPrompt: instruction, baseSystemPrompt: systemPrompt }, execution, options);
        return { text: summary.text, warnings: summary.warnings, sourceFacts: summary.sourceFacts, executor: "summary" };
      }
      const result = await runThinEvidenceAnswer({ source: bound.source, instruction, systemPrompt }, execution, options);
      return { ...result, executor: "evidence" };
    }
    if (!request.skill && spec.kind === "none") {
      const knowledge = answerMarkdownKnowledge(instruction);
      if (knowledge) return { text: knowledge.text, warnings: [], executor: "knowledge" };
    }
    return null;
  }

  if (intent.operation === "rewrite" && ["polish", "proofread", "academic-polish"].includes(task)) {
    const routineStyleAuthority = createRoutineStyleCanonicalAuthority({ request, instruction, task });
    const sourceOwnedFactAuthority = createSourceOwnedFactAuthority({ request, bound, source, instruction, task,
      effectiveSystemPrompt: systemPrompt, routineStyleAuthority });
    const result = await runThinProseTask({ source: bound.source, instruction, systemPrompt, skill: request.skill, task,
      routineStyleAuthority, sourceOwnedFactAuthority,
      preferReadable: isEvaluatedSmallLocalModel(request),
      scopeContext: { document: bound.documentContent, range: bound.range } }, execution, options);
    return { ...result, executor: "prose" };
  }

  const requirements = resolveIntentGenerationRequirements(instruction, intent, request.skill);
  const fill = prepareArtifactFill({ instruction, spec, requirements, source, includeSource: Boolean(source), systemPrompt });
  if (!fill) return null;
  return fillArtifact(fill, request, execution, options);
}
