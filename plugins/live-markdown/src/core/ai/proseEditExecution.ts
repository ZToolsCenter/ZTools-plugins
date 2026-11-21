import type { AiTaskExecution } from "./aiTaskExecution";
import { validateMarkdownAstIntegrity } from "./markdownAstIntegrity";
import { validateProseReplacementFacts } from "./proseEditFactGuard";
import { buildProseEditPlan, type ProseEditRequest, type ProseEditPlan, type ProseSlot } from "./proseEditPlan";

const MAX_TASK_RESPONSE_BYTES = 2 * 1024 * 1024;
const MAX_CANDIDATE_BYTES = 1024 * 1024;
const MAX_BATCH_RESPONSE_BYTES = 1024 * 1024;
const MAX_JSON_DEPTH = 16;
const ENCODER = new TextEncoder();

export type { ProseEditRequest } from "./proseEditPlan";

export interface ProseEditSnapshotIdentity {
  sourceHash: string;
  revision?: string;
}

export interface ProseEditExecutionOptions {
  onProgress?: (message: string) => void;
  onPlan?: (plan: ProseEditPlan) => void;
  isSnapshotCurrent?: (snapshot: ProseEditSnapshotIdentity) => boolean;
}

export interface ProseEditTaskStats {
  batches: number;
  modelCalls: number;
  inputBytes: number;
  rawOutputBytes: number;
  candidateBytes: number;
  estimatedPromptTokens: number;
  requestedOutputTokens: number;
  sourceHash: string;
  revision?: string;
}

export interface ProseEditTaskResult {
  text: string;
  preservedSource: boolean;
  warnings?: string[];
  stats: ProseEditTaskStats;
}

type Receipt = { slot: ProseSlot; text: string };
type ParsedBatch = { protocol: "prose-edit/v1"; batchId: string; edits: unknown[] };

function reject(reason: string): never {
  throw new Error(`正文文本槽校验失败（${reason}），原文未修改。`);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value) && Object.getPrototypeOf(value) === Object.prototype;
}

function exactKeys(value: Record<string, unknown>, required: readonly string[]): void {
  const keys = Object.keys(value);
  if (keys.length !== required.length || required.some((key) => !Object.hasOwn(value, key))) reject("响应字段缺失或多余");
}

function scanJsonForDuplicateKeys(source: string): void {
  let index = 0;
  const whitespace = () => { while (/\s/.test(source[index] ?? "")) index += 1; };
  const parseString = (): string => {
    const start = index;
    if (source[index++] !== '"') return reject("JSON 字符串格式无效");
    while (index < source.length) {
      const character = source[index++];
      if (character === '"') {
        try { return JSON.parse(source.slice(start, index)) as string; } catch { return reject("JSON 字符串格式无效"); }
      }
      if (character === "\\") index += 1;
      else if (character.charCodeAt(0) < 0x20) return reject("JSON 包含非法控制字符");
    }
    return reject("JSON 字符串未闭合");
  };
  const parseValue = (depth: number): void => {
    if (depth > MAX_JSON_DEPTH) reject("JSON 嵌套超过安全上限");
    whitespace();
    if (source[index] === '"') { parseString(); return; }
    if (source[index] === "{") {
      index += 1; whitespace();
      const keys = new Set<string>();
      if (source[index] === "}") { index += 1; return; }
      while (index < source.length) {
        whitespace();
        const key = parseString();
        if (keys.has(key)) reject("JSON 字段重复");
        keys.add(key); whitespace();
        if (source[index++] !== ":") reject("JSON 对象格式无效");
        parseValue(depth + 1); whitespace();
        const delimiter = source[index++];
        if (delimiter === "}") return;
        if (delimiter !== ",") reject("JSON 对象格式无效");
      }
      return reject("JSON 对象未闭合");
    }
    if (source[index] === "[") {
      index += 1; whitespace();
      if (source[index] === "]") { index += 1; return; }
      while (index < source.length) {
        parseValue(depth + 1); whitespace();
        const delimiter = source[index++];
        if (delimiter === "]") return;
        if (delimiter !== ",") reject("JSON 数组格式无效");
      }
      return reject("JSON 数组未闭合");
    }
    const start = index;
    while (index < source.length && !/[\s,\]}]/.test(source[index])) index += 1;
    if (start === index) reject("JSON 值无效");
  };
  parseValue(0);
  whitespace();
  if (index !== source.length) reject("JSON 尾部包含额外内容");
}

function parseBatch(raw: string, batchId: string): ParsedBatch {
  if (ENCODER.encode(raw).byteLength > MAX_BATCH_RESPONSE_BYTES) reject("单批响应超过 1 MiB 上限");
  const json = raw.trim();
  if (!json || json.startsWith("```") || json.startsWith("~~~")) reject("响应必须是单个原始 JSON 对象");
  scanJsonForDuplicateKeys(json);
  let parsed: unknown;
  try { parsed = JSON.parse(json) as unknown; } catch { return reject("JSON 解析失败"); }
  if (!isRecord(parsed)) return reject("响应根节点必须是对象");
  exactKeys(parsed, ["protocol", "batchId", "edits"]);
  if (parsed.protocol !== "prose-edit/v1" || parsed.batchId !== batchId || !Array.isArray(parsed.edits)) {
    return reject("协议或批次标识不匹配");
  }
  return parsed as ParsedBatch;
}

function validateSlotFacts(slot: ProseSlot, text: string): void {
  try {
    validateProseReplacementFacts(slot.sourceText, text, {
      contextBefore: slot.readOnlyContext.before, contextAfter: slot.readOnlyContext.after
    });
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : String(cause);
    const copiedContext = [slot.readOnlyContext.before, slot.readOnlyContext.after]
      .map(context => context.trim()).some(context => context.length >= 4 &&
        !slot.sourceText.includes(context) && text.includes(context));
    const reason = copiedContext ? `模型复制了只读相邻内容；${message}` : message;
    const excerpt = Array.from(slot.sourceText).slice(0, 32).join("");
    throw new Error(`“${excerpt}”：${reason}`, { cause });
  }
}

function validateReceipts(batchId: string, raw: string, slots: readonly ProseSlot[]): Receipt[] {
  const parsed = parseBatch(raw, batchId);
  if (parsed.edits.length !== slots.length) reject("本批文本槽回执数量不匹配");
  const expected = new Map(slots.map((slot) => [slot.id, slot]));
  const seen = new Set<string>();
  const receipts: Receipt[] = [];
  for (const item of parsed.edits) {
    if (!isRecord(item) || typeof item.id !== "string" || seen.has(item.id)) reject("存在重复或无效的槽 ID");
    const slot = expected.get(item.id);
    if (!slot) reject("响应包含当前批次不拥有的槽 ID");
    seen.add(item.id);
    if (item.status === "unchanged") {
      exactKeys(item, ["id", "status"]);
      receipts.push({ slot, text: slot.sourceText });
      continue;
    }
    if (item.status !== "replace" || typeof item.text !== "string") reject("槽回执类型无效");
    exactKeys(item, ["id", "status", "text"]);
    const bytes = ENCODER.encode(item.text).byteLength;
    const limit = 2 * ENCODER.encode(slot.sourceText).byteLength + 64;
    if (bytes > limit) reject("替换文本超过该槽 2 倍加 64 字节的上限");
    if (!item.text.trim()) reject("replace 不能隐含删除整个文本槽");
    if (/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/.test(item.text)) reject("替换文本包含控制字符");
    const lineBreaks = (text: string) => text.match(/\r\n|\r|\n/gu) ?? [];
    if (JSON.stringify(lineBreaks(slot.sourceText)) !== JSON.stringify(lineBreaks(item.text))) reject("替换文本新增、删除或改变了源码换行");
    validateSlotFacts(slot, item.text);
    receipts.push({ slot, text: item.text });
  }
  if (seen.size !== expected.size) reject("本批文本槽回执不完整");
  return receipts;
}

function responseSchema(batchId: string, slots: readonly ProseSlot[]): Record<string, unknown> {
  const ids = slots.map((slot) => slot.id);
  const maxTextLength = Math.max(...slots.map((slot) => 2 * ENCODER.encode(slot.sourceText).byteLength + 64));
  const receipt = (status: string, requiresText: boolean) => ({
    type: "object",
    properties: {
      id: { type: "string", enum: ids },
      status: { const: status },
      ...(requiresText ? { text: { type: "string", maxLength: maxTextLength } } : {})
    },
    required: requiresText ? ["id", "status", "text"] : ["id", "status"],
    additionalProperties: false
  });
  return {
    type: "object",
    properties: {
      protocol: { const: "prose-edit/v1" },
      batchId: { const: batchId },
      edits: {
        type: "array",
        minItems: slots.length,
        maxItems: slots.length,
        items: { anyOf: [receipt("replace", true), receipt("unchanged", false)] }
      }
    },
    required: ["protocol", "batchId", "edits"],
    additionalProperties: false
  };
}

function assertSnapshot(plan: ProseEditPlan, options: ProseEditExecutionOptions): void {
  if (options.isSnapshotCurrent && !options.isSnapshotCurrent({ sourceHash: plan.sourceHash, ...(plan.revision ? { revision: plan.revision } : {}) })) {
    reject("文档版本已变化，必须重新选择内容后再试");
  }
}

function candidateFromReceipts(plan: ProseEditPlan, receipts: Map<string, string>): { text: string; bytes: number } {
  if (receipts.size !== plan.slots.length) reject("已完成分批没有覆盖全部源码范围");
  const pieces: string[] = [];
  let cursor = 0;
  let bytes = 0;
  const append = (piece: string) => {
    bytes += ENCODER.encode(piece).byteLength;
    if (bytes > MAX_CANDIDATE_BYTES) reject("完整候选文档超过 1 MiB 上限");
    pieces.push(piece);
  };
  for (const slot of plan.slots) {
    if (!Number.isInteger(slot.range.from) || !Number.isInteger(slot.range.to) || slot.range.from < cursor || slot.range.to < slot.range.from || slot.range.to > plan.source.length) {
      reject("文本槽源码范围重叠或无效");
    }
    const replacement = receipts.get(slot.id);
    if (replacement === undefined) reject("已完成分批没有覆盖全部源码范围");
    append(plan.source.slice(cursor, slot.range.from));
    append(replacement);
    cursor = slot.range.to;
  }
  append(plan.source.slice(cursor));
  return { text: pieces.join(""), bytes };
}

/** Stages all batch receipts privately and returns only one AST-validated candidate. */
export async function runProseEditTask(
  request: ProseEditRequest,
  execution: AiTaskExecution,
  options: ProseEditExecutionOptions = {}
): Promise<ProseEditTaskResult> {
  execution.assertRunning();
  const plan = buildProseEditPlan(request, execution.remainingCalls);
  options.onPlan?.(plan);
  const staged = new Map<string, string>();
  let rawOutputBytes = 0;
  let estimatedPromptTokens = 0;
  let requestedOutputTokens = 0;
  if (options.isSnapshotCurrent) assertSnapshot(plan, options);
  for (let index = 0; index < plan.batches.length; index += 1) {
    execution.assertRunning();
    assertSnapshot(plan, options);
    const batch = plan.batches[index];
    options.onProgress?.(`正在处理第 ${index + 1}/${plan.batches.length} 组正文`);
    const remainingRawBytes = MAX_TASK_RESPONSE_BYTES - rawOutputBytes;
    if (remainingRawBytes <= 0) reject("任务累计原始响应超过 2 MiB 上限");
    const raw = await execution.invoke(batch.prompt, batch.systemPrompt, batch.maxTokens, {
      silent: true,
      maxOutputBytes: Math.min(batch.maxOutputBytes, MAX_BATCH_RESPONSE_BYTES, remainingRawBytes),
      outputSchema: responseSchema(batch.id, batch.slots)
    });
    execution.assertRunning();
    assertSnapshot(plan, options);
    rawOutputBytes += ENCODER.encode(raw).byteLength;
    if (rawOutputBytes > MAX_TASK_RESPONSE_BYTES) reject("任务累计原始响应超过 2 MiB 上限");
    try {
      for (const receipt of validateReceipts(batch.id, raw, batch.slots)) staged.set(receipt.slot.id, receipt.text);
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : String(cause);
      throw new Error(`第 ${index + 1}/${plan.batches.length} 组正文校验未通过：${message}`, { cause });
    }
    estimatedPromptTokens += Math.max(0, batch.contextTokens - batch.maxTokens);
    requestedOutputTokens += batch.maxTokens;
  }
  execution.assertRunning();
  assertSnapshot(plan, options);
  const candidate = candidateFromReceipts(plan, staged);
  validateProseReplacementFacts(plan.source, candidate.text);
  validateMarkdownAstIntegrity(plan.source, candidate.text, true);
  execution.assertRunning();
  assertSnapshot(plan, options);
  return {
    text: candidate.text,
    preservedSource: candidate.text === plan.source,
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
