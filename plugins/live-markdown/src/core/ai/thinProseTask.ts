import { GFM, parser } from "@lezer/markdown";
import type { AiTaskExecution } from "./aiTaskExecution";
import type { AiTaskRequest, AiTaskRunnerOptions } from "./aiTaskRunner";
import type { IntentTask } from "./intentTypes";
import { calculateLocalAiBudget, LOCAL_AI_MAX_OUTPUT_TOKENS } from "./requestBudget";
import { estimateAiTokens } from "./markdownChunker";
import { validateProseReplacementFacts } from "./proseEditFactGuard";
import { validateProseDateOwnerReplacement } from "./proseDateOwnership";
import { buildThinProseSlots, type ThinProseScopeContext, type ThinProseSlot } from "./thinProseSlots";
import { buildThinProseContexts, renderThinProseContexts, type ThinProseContext } from "./thinProseContext";
import { prepareReadableProse } from "./readableProseView";
import { buildReadableProsePrompts } from "./readableProseTask";
import { planReadableProse } from "./readableProsePlan";
import { runReadableProsePlan } from "./readableProseExecution";
import { permitsRoutineStyleContext, type RoutineStyleCanonicalAuthority } from "./proseRoutineStyleContext";
import { validateDuplicateSentenceReplacement } from "./proseDuplicateOwnership";
import { createProseRequestMarkerSourceProof, prepareProseRequestMarkerProofScope, prepareRoutineStyleRequestMarkerProofScope,
  suggestProseRequestMarkerSourceRepair, type ProseRequestMarkerProofScope, type ProseRequestMarkerSourceProof } from "./proseRequestMarkerProof";
import { assembleThinProseCandidate, thinProseLengthWarnings, validateThinProseCandidateIntegrity, type AssembledThinProseCandidate } from "./thinProseCandidateIntegrity";
import { prepareSourceOwnedFactPlan } from "./sourceOwnedFactPlan";
import { unwrapJsonResponseEnvelope } from "./jsonResponseEnvelope";
import { runSourceOwnedFactPlan } from "./runSourceOwnedFactPlan";
import type { SourceOwnedFactAuthority } from "./sourceOwnedFactAuthority";

const MAX_BATCHES = 50;
const MAX_SLOTS_PER_BATCH = 64;
const MAX_RESPONSE_BYTES = 2 * 1024 * 1024;
const MAX_SLOT_OUTPUT_BYTES = 32 * 1024;
const MAX_JSON_DEPTH = 8;
const MIN_READONLY_COPY_CODEPOINTS = 32;
const MIN_COPY_GROWTH_CODEPOINTS = 16;
const ENCODER = new TextEncoder();
const markdownParser = parser.configure(GFM);
const STRUCTURAL_OUTPUT_NODES = new Set([
  "FencedCode", "CodeBlock", "InlineCode", "Table", "LinkReference", "HTMLBlock",
  "ATXHeading1", "ATXHeading2", "ATXHeading3", "ATXHeading4", "ATXHeading5", "ATXHeading6",
  "SetextHeading1", "SetextHeading2", "Link", "Image", "URL", "HTMLTag", "Escape",
  "Emphasis", "StrongEmphasis", "Strikethrough", "BulletList", "OrderedList", "ListItem", "Blockquote", "HorizontalRule"
]);

export interface ThinProseTaskInput {
  source: string;
  instruction: string;
  systemPrompt: string;
  skill?: AiTaskRequest["skill"];
  preferReadable?: boolean;
  /** Validated semantic task from the bound edit plan, never inferred from model output. */
  task?: IntentTask;
  routineStyleAuthority?: RoutineStyleCanonicalAuthority;
  sourceOwnedFactAuthority?: SourceOwnedFactAuthority;
  scopeContext?: ThinProseScopeContext;
}

interface BatchPlan {
  slots: readonly ThinProseSlot[];
  contexts: readonly ThinProseContext[];
  prompt: string;
  systemPrompt: string;
  maxTokens: number;
  contextTokens: number;
  maxOutputBytes: number;
  schema: Record<string, unknown>;
}

function byteLength(value: string): number { return ENCODER.encode(value).byteLength; }
function codePointLength(value: string): number { return Array.from(value).length; }

function exactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const actual = Object.keys(value);
  return actual.length === keys.length && keys.every((key) => Object.hasOwn(value, key));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value) && Object.getPrototypeOf(value) === Object.prototype;
}

function scanJson(source: string): void {
  let index = 0;
  const whitespace = () => { while (/\s/u.test(source[index] ?? "")) index += 1; };
  const fail = () => { throw new Error("正文润色回执不是安全的 JSON 对象，原文未修改。"); };
  const string = (): string => {
    const start = index;
    if (source[index++] !== '"') fail();
    while (index < source.length) {
      const char = source[index++];
      if (char === '"') {
        try { return JSON.parse(source.slice(start, index)) as string; } catch { fail(); }
      }
      if (char === "\\") index += 1;
      else if (char.charCodeAt(0) < 0x20) fail();
    }
    return fail();
  };
  const value = (depth: number): void => {
    if (depth > MAX_JSON_DEPTH) fail();
    whitespace();
    if (source[index] === '"') { string(); return; }
    if (source[index] === "{") {
      index += 1; whitespace();
      const keys = new Set<string>();
      if (source[index] === "}") { index += 1; return; }
      while (index < source.length) {
        whitespace();
        const key = string();
        if (keys.has(key)) throw new Error("正文润色回执包含重复 JSON 字段，原文未修改。");
        keys.add(key); whitespace();
        if (source[index++] !== ":") fail();
        value(depth + 1); whitespace();
        const separator = source[index++];
        if (separator === "}") return;
        if (separator !== ",") fail();
      }
      return fail();
    }
    if (source[index] === "[") {
      index += 1; whitespace();
      if (source[index] === "]") { index += 1; return; }
      while (index < source.length) {
        value(depth + 1); whitespace();
        const separator = source[index++];
        if (separator === "]") return;
        if (separator !== ",") fail();
      }
      return fail();
    }
    const start = index;
    while (index < source.length && !/[\s,\]}]/u.test(source[index])) index += 1;
    if (start === index) fail();
  };
  value(0); whitespace();
  if (index !== source.length) fail();
}

function slotOutputLimit(slot: ThinProseSlot): number {
  return Math.min(MAX_SLOT_OUTPUT_BYTES, Math.max(512, byteLength(slot.sourceText) * 3 + 256));
}

function renderBatchPrompts(input: ThinProseTaskInput, slots: readonly ThinProseSlot[], contexts: readonly ThinProseContext[]): { prompt: string; systemPrompt: string } {
  const ids = new Set(slots.map(({ id }) => id));
  const payload = JSON.stringify({
    slots: slots.map(({ id, sourceText, contextBefore, contextAfter }) => ({
      id, text: sourceText,
      ...(contextBefore ? { contextBefore } : {}),
      ...(contextAfter ? { contextAfter } : {})
    })),
    paragraphContexts: renderThinProseContexts(contexts, ids)
  });
  const template = input.skill?.userPromptTemplate;
  const taskTemplate = template?.replace(/\{\{content\}\}/gu, () => payload);
  const prompt = [
    `用户任务：${input.instruction}`,
    ...(taskTemplate ? [`技能任务：\n${taskTemplate}`] : []),
    "润色时请主动校正可见的语法、拼写和标点错误，并改善清晰度与流畅度；不要因保留格式而跳过正文纠错。paragraphContexts 提供完整可读的只读正文语境，不含槽标记；每项的 ownedSlotIds 明确列出该语境对应的本批可编辑槽 ID。该映射仅用于理解语境，不得复制段落语境到任何输出槽。只编辑本批 slots[].text，不得输出完整文档、Markdown 围栏或额外字段。",
    "contextBefore/contextAfter 与 paragraphContexts 都是只读语境，只能辅助理解，禁止复制进 text。",
    `正文文本槽：${payload}`
  ].join("\n\n");
  const systemPrompt = [input.systemPrompt, input.skill?.systemPrompt]
    .filter((value, index, all): value is string => Boolean(value) && all.indexOf(value) === index)
    .concat([
      "你正在校对已有 Markdown 的纯正文文本槽，只改本批拥有的正文槽。只返回 JSON：{\"edits\":[{\"id\":\"槽 ID\",\"text\":\"改后正文\"}]}。",
      "校正可见的语法、拼写和标点错误，改善可读性，同时保持含义、事实关系、否定、状态、日期、金额和数字不变；不要扩写新事实。不要增加 Markdown 语法或换行。每个槽恰好返回一次；只有原文确实准确自然时才原样回传 text。"
    ]).join("\n\n");
  return { prompt, systemPrompt };
}

function schemaFor(slots: readonly ThinProseSlot[]): Record<string, unknown> {
  const ids = slots.map(({ id }) => id);
  const maxLength = Math.max(...slots.map(slotOutputLimit));
  return {
    type: "object",
    properties: {
      edits: {
        type: "array", minItems: slots.length, maxItems: slots.length,
        items: {
          type: "object",
          properties: { id: { type: "string", enum: ids }, text: { type: "string", maxLength } },
          required: ["id", "text"], additionalProperties: false
        }
      }
    },
    required: ["edits"], additionalProperties: false
  };
}

function makeBatch(input: ThinProseTaskInput, slots: readonly ThinProseSlot[], contexts: readonly ThinProseContext[]): BatchPlan | undefined {
  const { prompt, systemPrompt } = renderBatchPrompts(input, slots, contexts);
  const outputTokens = slots.reduce((total, slot) => total + Math.max(48, Math.ceil(estimateAiTokens(slot.sourceText) * 2.1) + 24), 24);
  if (outputTokens > LOCAL_AI_MAX_OUTPUT_TOKENS) return undefined;
  try {
    const budget = calculateLocalAiBudget(prompt, systemPrompt, Math.max(1, outputTokens));
    const outputShapeBytes = byteLength(JSON.stringify({ edits: slots.map(({ id }) => ({ id, text: "" })) }));
    const maxOutputBytes = Math.min(1024 * 1024, outputShapeBytes + slots.reduce((total, slot) => total + slotOutputLimit(slot), 0));
    return { slots, contexts, prompt, systemPrompt, maxTokens: budget.maxTokens, contextTokens: budget.contextTokens, maxOutputBytes, schema: schemaFor(slots) };
  } catch { return undefined; }
}

function indexContexts(contexts: readonly ThinProseContext[]): Map<string, ThinProseContext[]> {
  const bySlot = new Map<string, ThinProseContext[]>();
  for (const context of contexts) {
    for (const id of context.slotIds) {
      const matches = bySlot.get(id);
      if (matches) matches.push(context);
      else bySlot.set(id, [context]);
    }
  }
  return bySlot;
}

function contextsForSlots(slots: readonly ThinProseSlot[], bySlot: ReadonlyMap<string, ThinProseContext[]>): ThinProseContext[] {
  const unique = new Set<ThinProseContext>();
  for (const { id } of slots) for (const context of bySlot.get(id) ?? []) unique.add(context);
  return [...unique];
}

function createBatches(input: ThinProseTaskInput, slots: readonly ThinProseSlot[], contexts: readonly ThinProseContext[], availableCalls: number): BatchPlan[] {
  if (!Number.isSafeInteger(availableCalls) || availableCalls < 0) throw new Error("正文润色调用预算无效，原文未修改。");
  const batches: BatchPlan[] = [];
  const contextsBySlot = indexContexts(contexts);
  let pending: ThinProseSlot[] = [];
  const flush = () => {
    if (!pending.length) return;
    const batchContexts = contextsForSlots(pending, contextsBySlot);
    const batch = makeBatch(input, pending, batchContexts);
    if (!batch) throw new Error("单批正文超过上下文或输出预算，原文未修改。");
    batches.push(batch); pending = [];
  };
  for (const slot of slots) {
    const candidate = [...pending, slot];
    const candidateContexts = contextsForSlots(candidate, contextsBySlot);
    const next = candidate.length <= MAX_SLOTS_PER_BATCH ? makeBatch(input, candidate, candidateContexts) : undefined;
    if (next) { pending = candidate; continue; }
    flush();
    const singleContexts = contextsBySlot.get(slot.id) ?? [];
    const single = makeBatch(input, [slot], singleContexts);
    if (!single) throw new Error("单个正文槽超过模型上下文或输出预算，原文未修改。");
    pending = [slot];
  }
  flush();
  if (batches.length > MAX_BATCHES) throw new Error("正文分批超过 50 组安全上限，原文未修改。");
  if (batches.length > availableCalls) throw new Error("正文分批超过剩余模型调用预算，已在开始前停止。");
  return batches;
}

function parseEdits(raw: string, batch: BatchPlan): Map<string, string> {
  if (byteLength(raw) > batch.maxOutputBytes || byteLength(raw) > MAX_RESPONSE_BYTES) {
    throw new Error("正文润色回执超过本批输出上限，原文未修改。");
  }
  let source: string;
  try { source = unwrapJsonResponseEnvelope(raw); }
  catch { throw new Error("正文润色必须返回单个 JSON 对象，原文未修改。"); }
  if (!source || source.startsWith("```") || source.startsWith("~~~")) throw new Error("正文润色必须返回单个 JSON 对象，原文未修改。");
  scanJson(source);
  let parsed: unknown;
  try { parsed = JSON.parse(source) as unknown; } catch { throw new Error("正文润色回执 JSON 解析失败，原文未修改。"); }
  if (!isRecord(parsed) || !exactKeys(parsed, ["edits"]) || !Array.isArray(parsed.edits)) {
    throw new Error("正文润色回执字段缺失或多余，原文未修改。");
  }
  const expected = new Map(batch.slots.map((slot) => [slot.id, slot]));
  const edits = new Map<string, string>();
  for (const item of parsed.edits) {
    if (!isRecord(item) || !exactKeys(item, ["id", "text"]) || typeof item.id !== "string" || typeof item.text !== "string") {
      throw new Error("正文润色回执结构无效，原文未修改。");
    }
    if (!expected.has(item.id)) throw new Error("回执包含不属于当前批次的正文槽，原文未修改。");
    if (edits.has(item.id)) throw new Error("正文润色回执包含重复槽 ID，原文未修改。");
    if (!item.text.trim() || /[\r\n\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/u.test(item.text)) {
      throw new Error("正文润色文本为空或包含结构换行/控制字符，原文未修改。");
    }
    if (byteLength(item.text) > slotOutputLimit(expected.get(item.id)!)) throw new Error("正文润色文本超过单槽输出上限，原文未修改。");
    edits.set(item.id, item.text);
  }
  if (parsed.edits.length !== batch.slots.length || edits.size !== expected.size) throw new Error("正文润色回执不完整，原文未修改。");
  return edits;
}

function readOnlyParagraphPhrases(slotId: string, contexts: readonly ThinProseContext[]): Set<string> {
  const phrases = new Set<string>();
  const addRun = (run: string) => {
    const trimmed = run.trim();
    if (!trimmed) return;
    phrases.add(trimmed);
    for (const sentence of trimmed.split(/(?<=[.!?。！？；])\s*/u)) {
      const phrase = sentence.trim();
      if (phrase) phrases.add(phrase);
    }
  };
  for (const context of contexts) {
    let run = "";
    for (const part of context.parts) {
      if (part.slotId === slotId) {
        addRun(run);
        run = "";
      } else run += part.text;
    }
    addRun(run);
  }
  return phrases;
}

function copiedLongReadOnlyParagraphPhrase(slot: ThinProseSlot, text: string, contexts: readonly ThinProseContext[]): boolean {
  const sourceLength = codePointLength(slot.sourceText);
  const outputLength = codePointLength(text);
  const minimumGrowth = Math.max(MIN_COPY_GROWTH_CODEPOINTS, Math.ceil(sourceLength * 0.25));
  if (outputLength - sourceLength < minimumGrowth) return false;
  for (const phrase of readOnlyParagraphPhrases(slot.id, contexts)) {
    if (codePointLength(phrase) < MIN_READONLY_COPY_CODEPOINTS) continue;
    if (slot.sourceText.includes(phrase)) continue;
    if (text.includes(phrase)) return true;
  }
  return false;
}

function validateReplacement(slot: ThinProseSlot, text: string, contexts: readonly ThinProseContext[], source: string,
  proofScope: ProseRequestMarkerProofScope, proposedProof?: ProseRequestMarkerSourceProof): { text: string; requestMarkerProof?: ProseRequestMarkerSourceProof } {
  if (!text.trim() || byteLength(text) > slotOutputLimit(slot) || /[\p{Cc}\p{Zl}\p{Zp}]/u.test(text)) {
    throw new Error("正文润色文本为空、超限或包含结构换行，原文未修改。");
  }
  validateDuplicateSentenceReplacement(slot, text, source);
  const normalized = slot.dateOwnerFact ? validateProseDateOwnerReplacement(slot.dateOwnerFact, slot.sourceText, text) : text;
  let structural = false;
  markdownParser.parse(normalized).iterate({ enter(node) { if (STRUCTURAL_OUTPUT_NODES.has(node.name)) structural = true; } });
  if (structural) throw new Error("正文润色新增了 Markdown 结构，原文未修改。");
  const contextCopied = [slot.contextBefore, slot.contextAfter].some((context) =>
    context.length >= 12 && !slot.sourceText.includes(context) && normalized.includes(context));
  if (contextCopied || copiedLongReadOnlyParagraphPhrase(slot, normalized, contexts)) {
    throw new Error("正文润色复制了只读相邻内容，原文未修改。");
  }
  const sourceRange = { from: proofScope.taskRange.from + slot.range.from, to: proofScope.taskRange.from + slot.range.to };
  const requestMarkerProof = proposedProof ?? createProseRequestMarkerSourceProof(proofScope, slot.id, sourceRange, slot.sourceText, normalized);
  try {
    validateProseReplacementFacts(slot.sourceText, normalized, { contextBefore: slot.contextBefore, contextAfter: slot.contextAfter,
      ...(requestMarkerProof ? { requestMarkerProofs: [requestMarkerProof], requestMarkerProofStage: "slot" as const } : {}) });
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : String(cause);
    throw new Error(`正文润色未保留原有事实锚点：${message}`, { cause });
  }
  return { text: normalized, ...(requestMarkerProof ? { requestMarkerProof } : {}) };
}

/** Runs a single polish task through source-owned text slots and exact-range assembly. */
export async function runThinProseTask(
  input: ThinProseTaskInput,
  execution: AiTaskExecution,
  options: AiTaskRunnerOptions
): Promise<{ text: string; warnings: string[] }> {
  execution.assertRunning();
  const originalSlots = buildThinProseSlots(input.source, input.instruction,
    `${input.systemPrompt}\n${input.skill?.systemPrompt ?? ""}`, input.scopeContext);
  if (!originalSlots.length) return { text: input.source, warnings: ["没有可编辑的正文文本，原文保持不变。"] };
  const proofTaskRange = input.scopeContext?.range ?? { from: 0, to: input.source.length };
  const proofInput = {
    instruction: input.instruction, document: input.scopeContext?.document ?? input.source,
    taskRange: proofTaskRange, taskSource: input.source
  };
  const routineScope = permitsRoutineStyleContext(input)
    ? prepareRoutineStyleRequestMarkerProofScope({ ...proofInput, task: input.task ?? "custom",
      canonicalAuthority: input.routineStyleAuthority }) : undefined;
  const proofScope = routineScope ?? prepareProseRequestMarkerProofScope(proofInput);
  const requestMarkerProofs: ProseRequestMarkerSourceProof[] = [];
  const validateAndCollect = (slot: ThinProseSlot, text: string, contexts: readonly ThinProseContext[], exactSourceReply = false) => {
    const sourceRange = { from: proofScope.taskRange.from + slot.range.from, to: proofScope.taskRange.from + slot.range.to };
    const repair = routineScope && exactSourceReply && text === slot.sourceText
      ? suggestProseRequestMarkerSourceRepair(routineScope, slot.id, sourceRange, slot.sourceText) : undefined;
    const validated = validateReplacement(slot, repair?.text ?? text, contexts, input.source, proofScope, repair?.proof);
    if (validated.requestMarkerProof) requestMarkerProofs.push(validated.requestMarkerProof);
    return validated.text;
  };
  const readablePlan = input.preferReadable ? planReadableProse(input.source, originalSlots, {
    instruction: input.instruction,
    scopeContext: input.scopeContext
  }) : null;
  const sourceOwnedPlan = readablePlan && input.sourceOwnedFactAuthority
    ? prepareSourceOwnedFactPlan({ authority: input.sourceOwnedFactAuthority, source: input.source,
      instruction: input.instruction, systemPrompt: input.systemPrompt, skill: input.skill, task: input.task,
      scopeContext: input.scopeContext, originalSlots, readablePlan })
    : undefined;
  const slots = readablePlan?.slots ?? originalSlots;
  const contexts = buildThinProseContexts(input.source, slots.map(({ id, range, sourceText }) => ({ id, range, text: sourceText })));
  const finalize = (edits: ReadonlyMap<string, string>): AssembledThinProseCandidate => {
    const proofSlotIds = requestMarkerProofs.length ? new Set(requestMarkerProofs.map(proof => proof.slotId)) : undefined;
    const candidate = assembleThinProseCandidate(input.source, slots, edits, proofSlotIds);
    validateThinProseCandidateIntegrity({ source: input.source, candidate, slots, scopeContext: input.scopeContext,
      requestMarkerProofs });
    return candidate;
  };
  if (readablePlan) {
    const exactSourceSlots = new Set<string>();
    const onExactSourceReply = (ids: readonly string[]) => { for (const id of ids) exactSourceSlots.add(id); };
    const edits = sourceOwnedPlan
      ? await runSourceOwnedFactPlan({ prepared: sourceOwnedPlan, readableInput: input, execution, options,
        onExactSourceReply })
      : await runReadableProsePlan(input, readablePlan, execution, options, undefined, onExactSourceReply);
    for (const slot of slots) edits.set(slot.id, validateAndCollect(slot, edits.get(slot.id)!, contexts, exactSourceSlots.has(slot.id)));
    const candidate = finalize(edits);
    execution.assertRunning();
    return { text: candidate.text, warnings: thinProseLengthWarnings(candidate.editableBytes, candidate.editedBytes) };
  }
  const readable = input.preferReadable ? prepareReadableProse(input.source, slots) : null;
  if (readable) {
    const prompts = buildReadableProsePrompts(input, readable);
    const budget = calculateLocalAiBudget(prompts.prompt, prompts.systemPrompt,
      Math.min(1536, Math.max(128, Math.ceil(estimateAiTokens(readable.text) * 2) + 64)));
    options.onProgress?.("正在校对可读正文");
    const raw = await execution.invoke(prompts.prompt, prompts.systemPrompt, budget.maxTokens,
      { silent: true, maxOutputBytes: MAX_SLOT_OUTPUT_BYTES });
    execution.assertRunning();
    const edits = readable.decode(raw);
    if (edits.size !== slots.length) throw new Error("正文校对未覆盖全部文本范围，原文未修改。");
    for (const slot of slots) {
      const replacement = edits.get(slot.id);
      if (replacement === undefined) throw new Error("正文校对未覆盖全部文本范围，原文未修改。");
      edits.set(slot.id, validateAndCollect(slot, replacement, contexts, raw === readable.text));
    }
    const candidate = finalize(edits);
    execution.assertRunning();
    return { text: candidate.text, warnings: thinProseLengthWarnings(candidate.editableBytes, candidate.editedBytes) };
  }
  const batches = createBatches(input, slots, contexts, execution.remainingCalls);
  const staged = new Map<string, string>();
  let responseBytes = 0;
  for (let index = 0; index < batches.length; index += 1) {
    execution.assertRunning();
    options.onProgress?.(`正在润色第 ${index + 1}/${batches.length} 组正文`);
    const batch = batches[index];
    const raw = await execution.invoke(batch.prompt, batch.systemPrompt, batch.maxTokens, {
      silent: true,
      maxOutputBytes: Math.min(batch.maxOutputBytes, MAX_RESPONSE_BYTES - responseBytes),
      outputSchema: batch.schema
    });
    execution.assertRunning();
    responseBytes += byteLength(raw);
    if (responseBytes > MAX_RESPONSE_BYTES) throw new Error("正文润色累计响应超过 2 MiB，原文未修改。");
    const edits = parseEdits(raw, batch);
    for (const slot of batch.slots) {
      const replacement = edits.get(slot.id);
      if (replacement === undefined) throw new Error("正文润色回执未覆盖全部文本槽，原文未修改。");
      staged.set(slot.id, validateAndCollect(slot, replacement, batch.contexts, replacement === slot.sourceText));
    }
  }
  execution.assertRunning();
  const candidate = finalize(staged);
  execution.assertRunning();
  return { text: candidate.text, warnings: thinProseLengthWarnings(candidate.editableBytes, candidate.editedBytes) };
}
