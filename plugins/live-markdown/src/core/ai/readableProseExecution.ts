import type { AiTaskExecution } from "./aiTaskExecution";
import type { AiTaskRunnerOptions } from "./aiTaskRunner";
import { calculateLocalAiBudget } from "./requestBudget";
import { estimateAiTokens } from "./markdownChunker";
import type { ReadableProseTaskInput } from "./readableProseTask";
import type { ReadableProsePlan } from "./readableProsePlan";
import { restoreReadonlyCommaBoundary } from "./readableClauseBoundary";
import { analyzeEnglishAgreement } from "./englishAgreementService";
import { restoreStrictCoordinationComma } from "./strictCoordinationComma";
import {
  normalizeReadableProseText,
  prepareReadableProseRequest,
  requiresStrictProofreadReference,
  type ReadableProseAgreementAnalyzer
} from "./readableProseNormalization";

function stageJobEdits(
  slotIds: readonly string[],
  edits: Map<string, string>,
  staged: Map<string, string>
): void {
  if (edits.size !== slotIds.length || slotIds.some(id => !edits.has(id))) {
    throw new Error("正文校对未覆盖本段全部文本，原文未修改。");
  }
  for (const [id, value] of edits) {
    if (staged.has(id)) throw new Error("正文分片重复覆盖文本范围，原文未修改。");
    staged.set(id, value);
  }
}

async function awaitWhileRunning<T>(execution: AiTaskExecution, pending: Promise<T>): Promise<T> {
  try {
    const result = await pending;
    execution.assertRunning();
    return result;
  } catch (error) {
    execution.assertRunning();
    throw error;
  }
}

/** Preflight every sentence before the first call; any failure discards all staged edits. */
export async function runReadableProsePlan(
  input: ReadableProseTaskInput,
  plan: ReadableProsePlan,
  execution: AiTaskExecution,
  options: AiTaskRunnerOptions,
  analyzer?: ReadableProseAgreementAnalyzer,
  onExactSourceReply?: (slotIds: readonly string[]) => void
): Promise<Map<string, string>> {
  if (!plan.jobs.length) {
    throw new Error("正文分片超过本次调用预算，原文未修改。");
  }
  const modelJobs = plan.jobs.filter(job => job.kind !== "literal");
  const literalJobs = plan.jobs.filter(job => job.kind === "literal");
  if (modelJobs.length > execution.remainingCalls) {
    throw new Error("正文分片超过本次调用预算，原文未修改。");
  }
  const staged = new Map<string, string>();
  for (const job of literalJobs) {
    execution.assertRunning();
    stageJobEdits(job.slotIds, job.view.decode(job.view.text), staged);
  }
  const requests: Array<{
    job: (typeof modelJobs)[number];
    prompts: { prompt: string; systemPrompt: string };
    referenceText: string;
    budget: ReturnType<typeof calculateLocalAiBudget>;
  }> = [];
  for (const job of modelJobs) {
    execution.assertRunning();
    const prepared = await awaitWhileRunning(execution,
      prepareReadableProseRequest(input, job.view, options.signal, analyzer));
    const prompts = prepared.prompts;
    const budget = calculateLocalAiBudget(prompts.prompt, prompts.systemPrompt,
      Math.min(1536, Math.max(128, Math.ceil(estimateAiTokens(prepared.view.text) * 2) + 64)));
    requests.push({ job, prompts, referenceText: prepared.view.text, budget });
  }
  for (const [index, { job, prompts, referenceText: preparedReferenceText, budget }] of requests.entries()) {
    execution.assertRunning();
    options.onProgress?.(`正在校对第 ${index + 1}/${requests.length} 段正文`);
    const raw = await execution.invoke(prompts.prompt, prompts.systemPrompt, budget.maxTokens,
      { silent: true, maxOutputBytes: 32 * 1024 });
    execution.assertRunning();
    const referenceText = requiresStrictProofreadReference(input) ? preparedReferenceText : undefined;
    const clauseRaw = job.commaBoundary
      ? restoreReadonlyCommaBoundary(job.commaBoundary.sourceDocument, job.commaBoundary, raw)
      : raw;
    const readonlySurfaceRaw = job.view.normalizeReadonlySurface(clauseRaw);
    const preservedRaw = await awaitWhileRunning(execution, restoreStrictCoordinationComma({
      task: input, source: job.view.text, candidate: readonlySurfaceRaw,
      analyzer: { analyze: analyzer ?? analyzeEnglishAgreement }, signal: options.signal, timeoutMs: 1_500
    }));
    const normalizedRaw = await awaitWhileRunning(execution,
      normalizeReadableProseText(preservedRaw, job.view.readonlyPlaceholders, options.signal, analyzer, referenceText));
    stageJobEdits(job.slotIds, job.view.decode(normalizedRaw), staged);
    if (raw === job.view.text) onExactSourceReply?.(job.slotIds);
  }
  execution.assertRunning();
  if (staged.size !== plan.slots.length) throw new Error("正文分片未覆盖全部文本，原文未修改。");
  return staged;
}
