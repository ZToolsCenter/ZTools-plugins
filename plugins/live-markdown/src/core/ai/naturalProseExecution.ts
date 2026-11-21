import type { AiTaskExecution } from "./aiTaskExecution";
import { validateMarkdownAstIntegrity, validateMarkdownFragmentCompleteness } from "./markdownAstIntegrity";
import { validateProseReplacementFacts } from "./proseEditFactGuard";
import { chunkMarkdownForAi } from "./markdownChunker";
import type {
  ProseEditExecutionOptions,
  ProseEditSnapshotIdentity,
  ProseEditTaskResult
} from "./proseEditExecution";
import type { ProseEditRequest } from "./proseEditPlan";
import {
  buildNaturalProseEditPlan,
  type NaturalProseEditBatch,
  type NaturalProseEditPlan
} from "./naturalProsePlan";

const MAX_TASK_RESPONSE_BYTES = 2 * 1024 * 1024;
const MAX_CANDIDATE_BYTES = 1024 * 1024;
const MAX_BATCH_RESPONSE_BYTES = 1024 * 1024;
const MIN_COVERAGE_SOURCE_CHARS = 80;
const ENCODER = new TextEncoder();

export type { ProseEditRequest } from "./proseEditPlan";

function reject(reason: string): never {
  throw new Error(`自然 Markdown 校验失败（${reason}），原文未修改。`);
}

function byteLength(value: string): number {
  return ENCODER.encode(value).byteLength;
}

function lineBreaks(value: string): string[] {
  return value.match(/\r\n|\r|\n/gu) ?? [];
}

function conservativePlainText(value: string): string {
  const chunks = chunkMarkdownForAi(value, {
    maxChunkCharacters: Math.max(1, value.length * 32),
    maxInputBytes: MAX_BATCH_RESPONSE_BYTES,
    maxChunks: 1
  });
  if (chunks.exceeded || chunks.chunks.length > 1) reject("正文覆盖检查超过安全上限");
  const chunk = chunks.chunks[0];
  if (!chunk) return "";
  const mask = chunk.mask.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
  return chunk.text.replace(new RegExp(`${mask}\\d+__`, "gu"), " ")
    .replace(/[\s`*_~>#|\[\]()!\\]/gu, "")
    .trim();
}

function validateConservativeCoverage(source: string, output: string): void {
  const sourceText = conservativePlainText(source);
  if (sourceText.length < MIN_COVERAGE_SOURCE_CHARS) return;
  const outputText = conservativePlainText(output);
  if (outputText.length < Math.ceil(sourceText.length * 0.5)) {
    reject("模型输出比原文短得过多，可能遗漏了正文内容");
  }
}

function assertSnapshot(plan: NaturalProseEditPlan, options: ProseEditExecutionOptions): void {
  const snapshot: ProseEditSnapshotIdentity = {
    sourceHash: plan.sourceHash,
    ...(plan.revision ? { revision: plan.revision } : {})
  };
  if (options.isSnapshotCurrent && !options.isSnapshotCurrent(snapshot)) {
    reject("文档版本已变化，必须重新选择内容后再试");
  }
}

function unwrapMarkdownEnvelope(raw: string): string {
  const match = /^```markdown[\t ]*(?:\r\n|\r|\n)([\s\S]*?)(?:\r\n|\r|\n)```[\t ]*$/iu.exec(raw);
  if (match) return match[1];
  if (/^```|```[\t ]*$/u.test(raw.trim())) reject("只允许完整的外层 markdown 围栏，模型输出围栏不完整");
  return raw;
}

function validateBatchOutput(batch: NaturalProseEditBatch, raw: string): { text: string; inlineStyleChanged: boolean } {
  if (byteLength(raw) > MAX_BATCH_RESPONSE_BYTES) reject("单组原始响应超过 1 MiB 安全上限");
  const replacement = unwrapMarkdownEnvelope(raw);
  if (!replacement.trim()) reject("模型输出为空，不能隐含删除整段原文");
  if (/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/u.test(replacement)) reject("模型输出包含控制字符");
  const trimmed = replacement.trimStart();
  if (replacement !== batch.sourceText && (trimmed.startsWith("{") || trimmed.startsWith("["))) {
    let isJson = false;
    try { JSON.parse(trimmed); isJson = true; } catch { /* Markdown may legitimately start with a brace. */ }
    if (isJson) reject("自然 Markdown 模式不接受 JSON 回执或包装对象");
  }
  if (JSON.stringify(lineBreaks(batch.sourceText)) !== JSON.stringify(lineBreaks(replacement))) {
    reject("模型输出新增、遗漏或转换了源码换行");
  }
  const responsePreface = /^(?:修改如下|润色如下|校对结果|以下是|Here(?:'s| is)|Revised text|Edited text)[：:\s]/iu;
  if (responsePreface.test(replacement.trimStart()) && !responsePreface.test(batch.sourceText.trimStart())) {
    reject("模型输出包含说明性前言，而不是原始 Markdown 片段");
  }
  validateConservativeCoverage(batch.sourceText, replacement);
  try {
    validateProseReplacementFacts(batch.sourceText, replacement);
    validateMarkdownFragmentCompleteness(replacement);
    const integrity = validateMarkdownAstIntegrity(batch.sourceText, replacement, true, undefined, { allowInlineStyleChanges: true });
    return { text: replacement, inlineStyleChanged: integrity.inlineStyleChanged };
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : String(cause);
    throw new Error(message, { cause });
  }
}

function assembleCandidate(plan: NaturalProseEditPlan, staged: ReadonlyMap<string, string>): { text: string; bytes: number } {
  if (staged.size !== plan.batches.length) reject("未完成所有源码范围的暂存");
  const pieces: string[] = [];
  let cursor = 0;
  let bytes = 0;
  const append = (piece: string) => {
    bytes += byteLength(piece);
    if (bytes > MAX_CANDIDATE_BYTES) reject("完整候选文档超过 1 MiB 上限");
    pieces.push(piece);
  };
  for (const batch of plan.batches) {
    if (!Number.isInteger(batch.range.from) || !Number.isInteger(batch.range.to) ||
      batch.range.from < cursor || batch.range.to <= batch.range.from || batch.range.to > plan.source.length) {
      reject("自然 Markdown 范围重叠或超出原文");
    }
    const replacement = staged.get(batch.id);
    if (replacement === undefined) reject("未完成所有源码范围的暂存");
    append(plan.source.slice(cursor, batch.range.from));
    append(replacement);
    cursor = batch.range.to;
  }
  append(plan.source.slice(cursor));
  return { text: pieces.join(""), bytes };
}

/** Executes direct Markdown generation and returns one fully validated atomic candidate. */
export async function runNaturalProseEditTask(
  request: ProseEditRequest,
  execution: AiTaskExecution,
  options: ProseEditExecutionOptions = {}
): Promise<ProseEditTaskResult> {
  execution.assertRunning();
  const plan = buildNaturalProseEditPlan(request, execution.remainingCalls);
  options.onPlan?.(plan);
  const staged = new Map<string, string>();
  let rawOutputBytes = 0;
  let estimatedPromptTokens = 0;
  let requestedOutputTokens = 0;
  let inlineStyleChanged = false;
  if (options.isSnapshotCurrent) assertSnapshot(plan, options);

  for (let index = 0; index < plan.batches.length; index += 1) {
    execution.assertRunning();
    assertSnapshot(plan, options);
    const batch = plan.batches[index];
    options.onProgress?.(`正在处理第 ${index + 1}/${plan.batches.length} 组 Markdown 正文`);
    const remainingRawBytes = MAX_TASK_RESPONSE_BYTES - rawOutputBytes;
    if (remainingRawBytes <= 0) reject("任务累计原始响应超过 2 MiB 上限");
    const raw = await execution.invoke(batch.prompt, batch.systemPrompt, batch.maxTokens, {
      silent: true,
      maxOutputBytes: Math.min(batch.maxOutputBytes, MAX_BATCH_RESPONSE_BYTES, remainingRawBytes)
    });
    execution.assertRunning();
    assertSnapshot(plan, options);
    rawOutputBytes += byteLength(raw);
    if (rawOutputBytes > MAX_TASK_RESPONSE_BYTES) reject("任务累计原始响应超过 2 MiB 上限");
    try {
      const validated = validateBatchOutput(batch, raw);
      inlineStyleChanged ||= validated.inlineStyleChanged;
      staged.set(batch.id, validated.text);
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : String(cause);
      throw new Error(`第 ${index + 1}/${plan.batches.length} 组 Markdown 校验未通过：${message}`, { cause });
    }
    estimatedPromptTokens += Math.max(0, batch.contextTokens - batch.maxTokens);
    requestedOutputTokens += batch.maxTokens;
  }

  execution.assertRunning();
  assertSnapshot(plan, options);
  validateConservativeCoverage(
    plan.batches.map(({ sourceText }) => sourceText).join("\n\n"),
    plan.batches.map(({ id }) => staged.get(id) ?? "").join("\n\n")
  );
  const candidate = assembleCandidate(plan, staged);
  try {
    validateProseReplacementFacts(plan.source, candidate.text);
    const integrity = validateMarkdownAstIntegrity(plan.source, candidate.text, true, undefined, { allowInlineStyleChanges: true });
    inlineStyleChanged ||= integrity.inlineStyleChanged;
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : String(cause);
    throw new Error(`完整候选校验未通过：${message}`, { cause });
  }
  execution.assertRunning();
  assertSnapshot(plan, options);
  return {
    text: candidate.text,
    preservedSource: candidate.text === plan.source,
    ...(inlineStyleChanged ? { warnings: ["已调整行内强调格式，请在 Diff 中确认。"] } : {}),
    stats: {
      batches: plan.batches.length,
      modelCalls: plan.batches.length,
      inputBytes: plan.inputBytes,
      rawOutputBytes,
      candidateBytes: candidate.bytes,
      estimatedPromptTokens,
      requestedOutputTokens,
      sourceHash: plan.sourceHash,
      ...(plan.revision ? { revision: plan.revision } : {})
    }
  };
}
