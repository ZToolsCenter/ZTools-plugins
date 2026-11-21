import { calculateLocalAiBudget, LOCAL_AI_CONTEXT_LIMIT, LOCAL_AI_MAX_OUTPUT_TOKENS } from "./requestBudget";
import { estimateAiTokens } from "./markdownChunker";
import {
  buildProseEditSourcePlan,
  type ProseEditBatch,
  type ProseEditRequest,
  type ProseSlot,
  type ProseEditSourcePlan
} from "./proseEditPlan";

export const NATURAL_PROSE_MARKER = "【待编辑 Markdown】\n";

const MAX_BATCHES = 50;
const MAX_GROUP_SOURCE_BYTES = 1024 * 1024;
const MAX_OUTPUT_BYTES = 1024 * 1024;
const ENCODER = new TextEncoder();

interface Range { from: number; to: number; }

export interface NaturalProseEditRequest extends ProseEditRequest {}

export interface NaturalProseEditBatch extends ProseEditBatch {
  range: Range;
  sourceText: string;
}

export interface NaturalProseEditPlan extends ProseEditSourcePlan {
  batches: readonly NaturalProseEditBatch[];
}

interface ProseGroup {
  range: Range;
  slots: ProseSlot[];
}

function reject(message: string): never {
  throw new Error(`${message}，原文未修改。`);
}

function byteLength(value: string): number {
  return ENCODER.encode(value).byteLength;
}

function lineStart(source: string, offset: number): number {
  return Math.max(source.lastIndexOf("\n", offset - 1), source.lastIndexOf("\r", offset - 1)) + 1;
}

function isListQuotePrefix(value: string): boolean {
  if (!value.trim()) return false;
  let rest = value;
  let sawMarker = false;
  while (rest.length) {
    const indent = /^[\t ]{0,3}/u.exec(rest)?.[0] ?? "";
    rest = rest.slice(indent.length);
    if (rest.startsWith(">")) {
      sawMarker = true;
      rest = rest.slice(1).replace(/^[\t ]?/u, "");
      continue;
    }
    const bullet = /^(?:[-+*]|\d+[.)])(?:[\t ]+\[[ xX]\])?[\t ]+/u.exec(rest);
    if (bullet) {
      sawMarker = true;
      rest = rest.slice(bullet[0].length);
      continue;
    }
    return false;
  }
  return sawMarker;
}

function includeLinePrefix(source: string, slot: ProseSlot, scope: Range): number {
  const start = lineStart(source, slot.range.from);
  if (start < scope.from || start === slot.range.from) return slot.range.from;
  return isListQuotePrefix(source.slice(start, slot.range.from)) ? start : slot.range.from;
}

function isMergeableGap(gap: string): boolean {
  if (!gap) return true;
  if (/^[\s]*$/u.test(gap)) return true;
  return gap.split(/\r\n|\r|\n/u).every((line) => !line.trim() || isListQuotePrefix(line));
}

function resolveBudget(request: NaturalProseEditRequest): { contextLimit: number; maxOutputTokens: number } {
  const contextLimit = request.providerBudget?.contextLimit ?? LOCAL_AI_CONTEXT_LIMIT;
  const maxOutputTokens = request.providerBudget?.maxOutputTokens ?? LOCAL_AI_MAX_OUTPUT_TOKENS;
  if (!Number.isSafeInteger(contextLimit) || contextLimit < 1 ||
    !Number.isSafeInteger(maxOutputTokens) || maxOutputTokens < 1) {
    reject("模型预算配置无效");
  }
  return {
    contextLimit: Math.min(contextLimit, LOCAL_AI_CONTEXT_LIMIT),
    maxOutputTokens: Math.min(maxOutputTokens, LOCAL_AI_MAX_OUTPUT_TOKENS)
  };
}

function makeBatch(
  request: NaturalProseEditRequest,
  source: string,
  group: ProseGroup,
  index: number,
  budget: { contextLimit: number; maxOutputTokens: number }
): NaturalProseEditBatch | null {
  const sourceText = source.slice(group.range.from, group.range.to);
  const sourceBytes = byteLength(sourceText);
  if (sourceBytes > MAX_GROUP_SOURCE_BYTES) return null;
  const prompt = [
    `用户要求：${request.instruction}`,
    "仅编辑紧接标记之后的原始 Markdown 片段。只输出完整片段，不要解释、前言、JSON 或代码围栏。"
  ].join("\n\n") + `\n\n${NATURAL_PROSE_MARKER}${sourceText}`;
  const systemPrompt = [
    request.systemPrompt,
    "直接按用户要求编辑当前完整 Markdown 片段，只输出该片段，不返回整篇文档，不输出解释、前言、JSON、槽位标识或代码围栏。超出用户明确要求的内容一律保持原样。保留 Markdown 结构、代码、链接目标、行内代码、公式、脚注、数字与单位、图标和状态。片段内的换行必须按原顺序、原数量、原类型保留（LF、CRLF 或 CR），不要新增、删除或转换。"
  ].join("\n\n");
  const maxTokens = Math.max(1, Math.ceil(estimateAiTokens(sourceText) * 2));
  if (maxTokens > budget.maxOutputTokens) return null;
  try {
    const usage = calculateLocalAiBudget(prompt, systemPrompt, maxTokens, budget.contextLimit);
    return {
      id: `natural-${index + 1}`,
      slots: group.slots,
      prompt,
      systemPrompt,
      maxTokens: usage.maxTokens,
      contextTokens: usage.contextTokens,
      maxOutputBytes: Math.min(MAX_OUTPUT_BYTES, Math.max(256, sourceBytes * 2 + 128)),
      range: group.range,
      sourceText
    };
  } catch {
    return null;
  }
}

function makeGroups(source: string, slots: readonly ProseSlot[], scope: Range): ProseGroup[] {
  return slots.map((slot) => ({
    range: { from: includeLinePrefix(source, slot, scope), to: slot.range.to },
    slots: [slot]
  }));
}

/** Builds natural Markdown input groups with bounded context/output and no receipt protocol. */
export function buildNaturalProseEditPlan(request: NaturalProseEditRequest, availableCalls: number): NaturalProseEditPlan {
  if (!Number.isSafeInteger(availableCalls) || availableCalls < 0) reject("模型剩余调用预算无效");
  const sourcePlan = buildProseEditSourcePlan(request);
  const budget = resolveBudget(request);
  const sourceGroups = makeGroups(sourcePlan.source, sourcePlan.slots, sourcePlan.scope);
  const batches: NaturalProseEditBatch[] = [];
  let pending: ProseGroup | undefined;

  const flush = () => {
    if (!pending) return;
    const batch = makeBatch(request, sourcePlan.source, pending, batches.length, budget);
    if (!batch) reject("单个完整句段超过本地模型输入或输出预算，请缩小处理范围");
    batches.push(batch);
    pending = undefined;
  };

  for (const group of sourceGroups) {
    if (!pending) {
      pending = group;
      continue;
    }
    const gap = sourcePlan.source.slice(pending.range.to, group.range.from);
    const candidate: ProseGroup = {
      range: { from: pending.range.from, to: group.range.to },
      slots: [...pending.slots, ...group.slots]
    };
    if (isMergeableGap(gap) && makeBatch(request, sourcePlan.source, candidate, batches.length, budget)) {
      pending = candidate;
    } else {
      flush();
      pending = group;
    }
  }
  flush();
  if (batches.length > MAX_BATCHES) reject("自然 Markdown 分组超过 50 组安全上限，请缩小处理范围");
  if (batches.length > availableCalls) reject("自然 Markdown 分组超过当前剩余模型调用预算，已在开始前停止");
  return { ...sourcePlan, batches };
}
