import { createAiTaskExecution, AiTaskCancelledError, type AiTaskExecution } from "./aiTaskExecution";
export { AiTaskCancelledError, AiTaskDeadlineError } from "./aiTaskExecution";
import type { AgentOrchestrationConfig } from "../../types/aiOrchestration";
import type { AiSkill } from "../../types/typora";
import type { AiEditProposal } from "../../types/aiEditing";
import { estimateAiTokens } from "./markdownChunker";
import { runSummaryTask } from "./aiSummaryPipeline";
import { runNaturalProseEditTask } from "./naturalProseExecution";
import { combineMarkdownAiChunks } from "./markdownChunker";
import { planMarkdownAiRequests, type AiPlannedChunk } from "./aiChunkPlanner";
import { validateAiChunkOutput } from "./aiChunkIntegrity";
import { calculateLocalAiBudget } from "./requestBudget";
import { validateAiOutput } from "./validateAiOutput";
import { requestedOutputFormat, type AiOutputFormat, type AiOutputMode } from "./aiOutputContract";
import { runTableArtifact } from "./aiTableArtifact";
import { runProseEditTask, type ProseEditSnapshotIdentity } from "./proseEditExecution";
import type { ProseEditPlan } from "./proseEditPlan";
import type { ValidatedIntent } from "./intentTypes";
import { resolveGenerationRequirements, type GenerationRequirements } from "./generationRequirements";
import { runGroundedGeneration } from "./groundedGeneration";
import type { IntentTask } from "./intentTypes";
import type { ExecutionPlan } from "./executionPlan";
import { resolveAiAppendIntent } from "./aiAppendIntent";
import {
  isConservativeAiAction,
  isReplacementAiAction,
  resolveAiSemanticAction,
  type AiActionDefinition,
  type AiTaskAction
} from "./aiTaskPrompts";

export interface AiTaskRequest {
  executionPolicy?: "direct" | "thin" | "full";
  /** Selected model identity for measured capability advice; never used to switch providers. */
  modelId?: string;
  provider?: AgentOrchestrationConfig["provider"];
  source: string;
  action: AiTaskAction;
  userPrompt?: string;
  baseSystemPrompt: string;
  skill?: Pick<AiSkill, "id" | "category" | "systemPrompt" | "userPromptTemplate">;
  actionDefinition: AiActionDefinition;
  granularity?: "budget" | "paragraph";
  scope?: "document" | "selection";
  /** Intent has already been classified; never reinterpret a content instruction. */
  intentPlanned?: boolean;
  /** Source is read-only context; validate the generated fragment inside its final patch. */
  readOnlyTask?: boolean;
  /** Optional context override for direct read-only generation; on budget failure, fail closed. */
  generationContextSource?: string;
  outputFormat?: AiOutputFormat;
  displaySource?: boolean;
  generationRequirements?: GenerationRequirements;
}

export interface AiTaskRunnerOptions {
  invoke: (prompt: string, systemPrompt: string, maxTokens: number, onChunk: (chunk: string) => void, outputSchema?: Record<string, unknown>) => Promise<string>;
  isCurrent: () => boolean;
  /** Optional document snapshot fence used between prose batches and before assembly. */
  isSnapshotCurrent?: (snapshot: ProseEditSnapshotIdentity) => boolean;
  signal?: AbortSignal;
  abortCurrent: () => void;
  onProgress?: (message: string) => void;
  onRequestStart?: (requestIndex: number) => void;
  onChunk?: (chunk: string) => void;
  onProtection?: (chunk: AiPlannedChunk | undefined) => void;
  /** Optional development observer, called synchronously before any prose inference. */
  onProsePlan?: (plan: ProseEditPlan) => void;
  onExecutionPlan?: (plan: ExecutionPlan) => void;
  now?: () => number;
  maxDurationMs?: number;
  maxCalls?: number;
  execution?: AiTaskExecution;
}

export interface AiTaskResult {
  text: string;
  /** Complete candidate body before program-owned insertion separators; diagnostics only. */
  candidateText?: string;
  /** Effective route, including a pre-inference fallback chosen for a large request. */
  executionPolicy?: "direct" | "thin" | "full";
  contentExecutor?: import("./modelCapabilityAdvice").ContentTaskFamily;
  evidenceCoverage?: import("./thinTaskOutput").EvidenceCoverage;
  semanticAction: AiTaskAction;
  editAction: boolean;
  nonReplacementSkill: boolean;
  protection: AiPlannedChunk | undefined;
  integritySource?: string;
  conservative: boolean;
  warnings: string[];
  preservedSource?: boolean;
  proposalMode?: "append";
  literalAppend?: boolean;
  proposal?: AiEditProposal;
  answerOnly?: boolean;
  planSummary?: string;
  sourceFacts?: string[];
  summaryStats?: { chunks: number; modelCalls: number; selectedFacts: number; retainedRequiredFacts: number };
  sourceOwned?: boolean;
  proseStats?: Awaited<ReturnType<typeof runProseEditTask>>["stats"];
  resolvedIntent?: ValidatedIntent;
  planningMode?: "program" | "model";
  outputMode?: AiOutputMode;
  executionPlan?: ExecutionPlan;
}

function estimateSummaryCalls(chunkCount: number, appendFinalCall: boolean): number {
  let total = chunkCount;
  let levelCount = chunkCount;
  while (levelCount > 1) {
    levelCount = Math.ceil(levelCount / 4);
    total += levelCount;
  }
  return total + (appendFinalCall ? 1 : 0);
}

function renderSkill(skill: AiTaskRequest["skill"], content: string): { systemPrompt: string; prompt: string } | null {
  if (!skill) return null;
  return {
    systemPrompt: skill.systemPrompt,
    prompt: skill.userPromptTemplate.replace(/\{\{content\}\}/g, () => content)
  };
}

function hasEditableText(chunk: AiPlannedChunk): boolean {
  const protectedTokensRemoved = chunk.text.replace(new RegExp(`${escapeRegExp(chunk.mask)}\\d+__`, "g"), "");
  return Boolean(protectedTokensRemoved.trim());
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function assertRunning(options: AiTaskRunnerOptions): void {
  if (options.signal?.aborted || !options.isCurrent()) throw new AiTaskCancelledError();
}

export async function runAiTask(request: AiTaskRequest, options: AiTaskRunnerOptions): Promise<AiTaskResult> {
  const execution = options.execution ?? createAiTaskExecution(options);
  const maxCalls = execution.remainingCalls;
  const invoke = (prompt: string, systemPrompt: string, maxTokens: number) => execution.invoke(prompt, systemPrompt, maxTokens);

  const append = request.skill || request.intentPlanned ? null : resolveAiAppendIntent(request.action, request.userPrompt, request.scope);
  if (append) {
    assertRunning(options);
    if (append.requiresSplit) throw new Error("文末追加指令包含其他操作或不完整的引用，请将追加与改写拆成独立指令，原文未修改。");
    if (new TextEncoder().encode(request.source).byteLength > 1_048_576) {
      throw new Error("内容超过 1 MiB 安全上限，请缩小处理范围。");
    }
    if (append.literal !== null) return {
      text: append.literal, semanticAction: "continue", editAction: false,
      nonReplacementSkill: false, protection: undefined, conservative: false,
      warnings: [], proposalMode: "append", literalAppend: true
    };
    request = {
      ...request, action: "continue", userPrompt: undefined,
      actionDefinition: {
        id: "continue", label: "文末追加",
        prompt: `仅在文档末尾执行一次以下要求：${append.instruction}\n只输出本次新增的 Markdown，不重复原文，不改写或删除原文。`,
        system: "文档上下文只读；只生成一次新增内容，保留原有事实与语气。"
      }
    };
  }
  const semanticAction = resolveAiSemanticAction(request.action, request.skill?.category);
  const nonReplacementSkill = request.skill?.category === "summary" || request.skill?.category === "diagram";
  const editAction = !request.readOnlyTask && isReplacementAiAction(request.action, request.skill?.category);
  const conservative = !request.readOnlyTask && isConservativeAiAction(request.action, request.skill?.id, request.skill?.category);
  const contextResponse = semanticAction === "continue" || Boolean(request.readOnlyTask && semanticAction !== "summarize");
  const summaryTask = semanticAction === "summarize" || contextResponse;
  const warnings: string[] = [];
  const instruction = request.userPrompt || request.actionDefinition.prompt;
  const outputFormat = request.outputFormat ?? requestedOutputFormat(instruction, semanticAction);
  const requirements = request.generationRequirements ?? resolveGenerationRequirements(instruction);
  const displaySource = request.displaySource ?? (requirements.display.state === "explicit" && requirements.display.value === "source");
  const validateOutput = (raw: string) => validateAiOutput(raw, outputFormat, displaySource);
  let protection: AiPlannedChunk | undefined;

  if (request.readOnlyTask && outputFormat === "table" && !displaySource && request.generationContextSource !== "") {
    const table = await runTableArtifact({ source: request.source, instruction, systemPrompt: request.baseSystemPrompt }, execution);
    warnings.push("请对照原文检查表格每一列的含义及对应关系。");
    return { ...table, semanticAction, editAction, nonReplacementSkill, protection, conservative, warnings };
  }
  const generationSource = request.generationContextSource ?? request.source;
  if (generationSource && (semanticAction === "tech-spec" || semanticAction === "continue")) {
    const grounded = await runGroundedGeneration({
      source: generationSource, instruction: requirements.contentInstruction || instruction,
      systemPrompt: request.baseSystemPrompt, task: semanticAction as IntentTask, requirements
    }, execution);
    if (grounded) return { ...grounded, semanticAction, editAction, nonReplacementSkill, protection, conservative, warnings };
  }

  if (editAction && conservative) {
    options.onProtection?.(undefined);
    const runProse = request.provider === "local" ? runNaturalProseEditTask : runProseEditTask;
    const prose = await runProse({
      source: request.source, instruction,
      systemPrompt: request.skill?.systemPrompt || `${request.baseSystemPrompt}\n${request.actionDefinition.system || ""}`
    }, execution, {
      onProgress: options.onProgress,
      onPlan: options.onProsePlan,
      isSnapshotCurrent: options.isSnapshotCurrent
    });
    return {
      text: prose.text, semanticAction, editAction, nonReplacementSkill, protection: undefined,
      conservative, sourceOwned: true, proseStats: prose.stats, preservedSource: prose.preservedSource,
      warnings: [...(prose.warnings ?? []), ...(prose.preservedSource ? ["没有改变原文，未生成可应用的修改。"] : [])]
    };
  }

  if (semanticAction === "summarize" && estimateAiTokens(request.source) > 1400) {
    const summary = await runSummaryTask(request, execution, options);
    return { text: summary.text, sourceFacts: summary.sourceFacts, summaryStats: summary.stats, semanticAction, editAction, nonReplacementSkill, protection, conservative, warnings: [...warnings, ...summary.warnings], ...(summary.preservedSource ? { preservedSource: true } : {}) };
  }
  if (summaryTask) {
    const summarySystem = semanticAction === "summarize"
      ? request.skill?.systemPrompt || `${request.baseSystemPrompt}\n${request.actionDefinition.system || ""}`
      : request.baseSystemPrompt;
    if (contextResponse) {
      const contextSource = request.generationContextSource ?? request.source;
      const directPrompt = contextSource
        ? `${request.actionDefinition.prompt}\n\n【全文上下文】\n${contextSource}`
        : request.actionDefinition.prompt;
      try {
        const budget = calculateLocalAiBudget(directPrompt, `${request.baseSystemPrompt}\n${request.actionDefinition.system || ""}`, 1024);
        const directText = await invoke(directPrompt, `${request.baseSystemPrompt}\n${request.actionDefinition.system || ""}`, budget.maxTokens);
        assertRunning(options);
        return { text: validateOutput(directText), semanticAction, editAction, nonReplacementSkill, protection, conservative, warnings, ...(append ? { proposalMode: "append" as const } : {}) };
      } catch (error) {
        if (!(error instanceof Error) || !/上下文预算/.test(error.message)) throw error;
        if (request.generationContextSource !== undefined) throw error;
      }
    }
    const plan = planMarkdownAiRequests(request.source, {
      protectMarkdown: false,
      conservative: false,
      buildPrompt: (text, context) => {
        const skillPrompt = semanticAction === "summarize" ? renderSkill(request.skill, text)?.prompt : null;
        const prompt = semanticAction === "summarize"
          ? skillPrompt || `${request.userPrompt || "总结下面这一部分，保留关键实体、数字、结论："}\n\n${text}`
          : `提炼以下全文片段中的主题、术语和语气，不续写：\n\n${text}`;
        return { prompt: context ? `${prompt}\n\n【相邻语境，仅供理解，不要输出】\n${context}` : prompt, systemPrompt: summarySystem };
      }
    });
    if (plan.exceeded) throw new Error(plan.exceeded === "bytes" ? "内容超过 1 MiB 安全上限，请缩小选区后重试。" : "内容分段超过 50 块安全上限，请缩小选区后重试。");
    if (semanticAction === "summarize" && plan.chunks.length > 1) {
      const summary = await runSummaryTask(request, execution, options);
      return { text: summary.text, sourceFacts: summary.sourceFacts, summaryStats: summary.stats, semanticAction, editAction, nonReplacementSkill, protection, conservative, warnings: [...warnings, ...summary.warnings], ...(summary.preservedSource ? { preservedSource: true } : {}) };
    }
    options.onProtection?.(plan.chunks[0]);
    if (estimateSummaryCalls(plan.chunks.length, contextResponse) > maxCalls) {
      throw new Error("分段摘要需要超过 64 次模型调用，已在开始前停止；请缩小选区后重试。");
    }
    const summaries: string[] = [];
    for (const chunk of plan.chunks) {
      assertRunning(options);
      options.onProgress?.(`正在处理第 ${chunk.index + 1}/${plan.chunks.length} 段`);
      summaries.push(await invoke(chunk.prompt, chunk.systemPrompt, chunk.maxTokens));
      assertRunning(options);
    }
    if (!summaries.length || summaries.some((summary) => !summary.trim())) throw new Error("AI 分段处理未全部完成，无法生成完整结果。");
    let summaryLevel = summaries;
    while (summaryLevel.length > 1) {
      const nextLevel: string[] = [];
      for (let offset = 0; offset < summaryLevel.length;) {
        assertRunning(options);
        let count = Math.min(4, summaryLevel.length - offset);
        let group = summaryLevel.slice(offset, offset + count);
        if (group.length === 1) {
          nextLevel.push(group[0]);
          offset += 1;
          continue;
        }
        let prompt = "";
        let budget: ReturnType<typeof calculateLocalAiBudget> | undefined;
        while (count >= 2 && !budget) {
          group = summaryLevel.slice(offset, offset + count);
          prompt = `合并以下分段摘要，去重并保留主题、专有名词和关键结论。${request.userPrompt ? `原始任务：${request.userPrompt}` : ""}\n\n${group.join("\n\n")}`;
          try { budget = calculateLocalAiBudget(prompt, summarySystem, 384); }
          catch (error) {
            if (!(error instanceof Error) || !/上下文预算/.test(error.message)) throw error;
            count -= 1;
          }
        }
        if (!budget || count < 2) throw new Error("分段摘要超过本地模型上下文预算，无法安全归并。");
        nextLevel.push(await invoke(prompt, summarySystem, budget.maxTokens));
        assertRunning(options);
        offset += count;
      }
      if (nextLevel.length >= summaryLevel.length) throw new Error("分段摘要未能缩短，已停止重复归并。");
      summaryLevel = nextLevel;
    }
    let text = summaryLevel[0];
    if (contextResponse) {
      assertRunning(options);
      const systemPrompt = `${request.baseSystemPrompt}\n${request.actionDefinition.system || ""}`;
      let tail = request.source.slice(-1000);
      let prompt = "";
      let budget: ReturnType<typeof calculateLocalAiBudget> | undefined;
      while (!budget) {
        prompt = `${request.actionDefinition.prompt}\n\n【全文上下文摘要】\n${text}\n\n【文档末尾】\n${tail}`;
        try { budget = calculateLocalAiBudget(prompt, systemPrompt, 1024); }
        catch (error) {
          if (!(error instanceof Error) || !/上下文预算/.test(error.message)) throw error;
          if (!tail.length) throw error;
          tail = tail.slice(Math.ceil(tail.length / 2));
        }
      }
      text = await invoke(prompt, systemPrompt, budget.maxTokens);
      assertRunning(options);
    }
    return { text: validateOutput(text), semanticAction, editAction, nonReplacementSkill, protection, conservative, warnings, ...(append ? { proposalMode: "append" as const } : {}) };
  }

  const baseSystemPrompt = request.skill?.systemPrompt || `${request.baseSystemPrompt}\n${request.actionDefinition.system || ""}`;
  const granularity = request.granularity === "paragraph" && editAction && conservative ? "paragraph" : "budget";
  const plan = planMarkdownAiRequests(request.source, {
    protectMarkdown: editAction,
    conservative,
    granularity,
    buildPrompt: (text, context) => {
      const skillPrompt = renderSkill(request.skill, text)?.prompt;
      const taskInstruction = request.userPrompt || request.actionDefinition.prompt;
      const hasMarkdownHeading = text.split(/\r\n|\r|\n/).some((line) => /^ {0,3}#{1,6}[ \t]+/.test(line));
      const paragraphHeadingInstruction = hasMarkdownHeading
        ? "当前段落含有 Markdown 标题，保留现有标题，不要新增标题、场景名或章节编号。"
        : "当前段落没有标题，不要添加标题、场景名或章节编号。";
      const markerPrompt = editAction
        ? `\n只改写${granularity === "paragraph" ? "当前正文段落" : "当前正文块"}；${granularity === "paragraph" ? paragraphHeadingInstruction : "相邻语境只用于保持指代与术语一致。"}仅输出当前块的完整 Markdown，不解释，不复制相邻语境。任何 LOCAL_AI_ 开头、双下划线结尾的标记都是必须原样保留的受保护内容：逐字复制，每个只出现一次，顺序不变。`
        : "";
      const contextPrompt = granularity === "budget" && context
        ? `【相邻语境，仅供理解，不要输出或修改】\n${context}\n\n`
        : "";
      const body = skillPrompt || `【当前分块】\n${text}`;
      const prompt = skillPrompt
        ? `${skillPrompt}${markerPrompt}`
        : `${taskInstruction}\n\n${contextPrompt}${body}${markerPrompt}`;
      return { prompt, systemPrompt: baseSystemPrompt };
    }
  });
  if (plan.exceeded) throw new Error(plan.exceeded === "bytes" ? "内容超过 1 MiB 安全上限，请缩小选区后重试。" : "内容分段超过 50 块安全上限，请缩小选区后重试。");
  if (!plan.chunks.length) throw new Error("当前内容没有可处理的 Markdown 文本。");
  protection = plan.chunks[0];
  options.onProtection?.(protection);
  const editableChunks = plan.chunks.filter(hasEditableText);
  if (editAction && editableChunks.length === 0 && plan.chunks.every((chunk) => chunk.protectedValues.length > 0)) {
    return {
      text: request.source,
      semanticAction,
      editAction,
      nonReplacementSkill,
      protection: undefined,
      conservative,
      warnings: ["文档仅含受保护结构，已保留原样；未调用模型。"],
      preservedSource: true
    };
  }
  const outputs: string[] = [];
  for (const chunk of plan.chunks) {
    assertRunning(options);
    if (editAction && !hasEditableText(chunk)) {
      outputs.push(chunk.text);
      continue;
    }
    options.onProgress?.(granularity === "paragraph"
      ? `正在逐段处理（${chunk.index + 1}/${plan.chunks.length}）`
      : `正在处理第 ${chunk.index + 1}/${plan.chunks.length} 段`);
    const raw = await invoke(chunk.prompt, chunk.systemPrompt, chunk.maxTokens);
    assertRunning(options);
    const result = validateAiChunkOutput(raw, chunk, conservative);
    outputs.push(result);
  }
  const complete = outputs;
  let text = editAction ? combineMarkdownAiChunks(complete, plan.chunks) : complete.join("\n\n");
  return {
    text: validateOutput(text), semanticAction, editAction, nonReplacementSkill,
    protection, integritySource: plan.chunks.map((chunk) => chunk.text).join(""), conservative, warnings
  };
}
