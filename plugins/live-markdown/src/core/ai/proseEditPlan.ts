import { GFM, parser } from "@lezer/markdown";
import { calculateLocalAiBudget, LOCAL_AI_CONTEXT_LIMIT, LOCAL_AI_MAX_OUTPUT_TOKENS } from "./requestBudget";
import { estimateAiTokens } from "./markdownChunker";
import { splitMarkdownSentences } from "./markdownSentenceBoundaries";

const MAX_SOURCE_BYTES = 1024 * 1024;
const MAX_PROMPT_FIELD_BYTES = 64 * 1024;
const MAX_BATCHES = 50;
const MAX_SLOTS = 50_000;
const MAX_AST_NODES = 50_000;
const MAX_AST_DEPTH = 128;
const MAX_SLOTS_PER_BATCH = 128;
const ENCODER = new TextEncoder();
const markdownParser = parser.configure(GFM);
const protectedNodes = new Set(["FencedCode", "CodeBlock", "Table", "LinkReference", "HTMLBlock"]);

interface Range { from: number; to: number; }
interface AstNode extends Range { name: string; children: AstNode[]; }

export interface ProseEditProviderBudget {
  contextLimit: number;
  maxOutputTokens: number;
}

export interface ProseEditRequest {
  source: string;
  instruction: string;
  systemPrompt: string;
  scope?: Range;
  revision?: string;
  providerBudget?: Partial<ProseEditProviderBudget>;
}

export interface ProseSlot {
  id: string;
  range: Range;
  sourceText: string;
  paragraphId: string;
  readOnlyContext: { before: string; after: string };
}

export interface ProseEditBatch {
  id: string;
  slots: readonly ProseSlot[];
  prompt: string;
  systemPrompt: string;
  maxTokens: number;
  contextTokens: number;
  maxOutputBytes: number;
}

export interface ProseEditPlan {
  source: string;
  sourceHash: string;
  revision?: string;
  scope: Range;
  inputBytes: number;
  slots: readonly ProseSlot[];
  batches: readonly ProseEditBatch[];
}

export type ProseEditSourcePlan = Omit<ProseEditPlan, "batches">;

function reject(message: string): never {
  throw new Error(`${message}，原文未修改。`);
}

function byteLength(value: string): number { return ENCODER.encode(value).byteLength; }

/** Stable, non-cryptographic identity; writeback must still compare revision and source bytes. */
export function fingerprintProseSource(source: string): string {
  let hash = 0xcbf29ce484222325n;
  const mask = 0xffffffffffffffffn;
  for (let index = 0; index < source.length; index += 1) {
    hash ^= BigInt(source.charCodeAt(index));
    hash = (hash * 0x100000001b3n) & mask;
  }
  return hash.toString(16).padStart(16, "0");
}

function normalizeLineEndings(source: string): { text: string; toSourceOffset: (offset: number) => number } {
  if (!source.includes("\r")) return { text: source, toSourceOffset: (offset) => offset };
  let text = "";
  const crlfEnds: number[] = [];
  for (let index = 0; index < source.length; index += 1) {
    if (source[index] === "\r") {
      text += "\n";
      if (source[index + 1] === "\n") { index += 1; crlfEnds.push(text.length); }
    } else text += source[index];
  }
  const toSourceOffset = (offset: number) => {
    let low = 0;
    let high = crlfEnds.length;
    while (low < high) {
      const middle = (low + high) >> 1;
      if (crlfEnds[middle] <= offset) low = middle + 1;
      else high = middle;
    }
    return offset + low;
  };
  return { text, toSourceOffset };
}

function parseTree(source: string): AstNode {
  const normalized = normalizeLineEndings(source);
  const cursor = markdownParser.parse(normalized.text).cursor();
  let nodes = 0;
  const read = (depth = 0): AstNode => {
    nodes += 1;
    if (nodes > MAX_AST_NODES || depth > MAX_AST_DEPTH) reject("Markdown AST 超过文本槽扫描上限");
    const current: AstNode = {
      name: cursor.name,
      from: normalized.toSourceOffset(cursor.from),
      to: normalized.toSourceOffset(cursor.to),
      children: []
    };
    if (cursor.firstChild()) {
      do { current.children.push(read(depth + 1)); } while (cursor.nextSibling());
      cursor.parent();
    }
    return current;
  };
  return read();
}

function walk(node: AstNode, visit: (node: AstNode, ancestors: AstNode[]) => void, ancestors: AstNode[] = []): void {
  visit(node, ancestors);
  ancestors.push(node);
  for (const child of node.children) walk(child, visit, ancestors);
  ancestors.pop();
}

function mergeRanges(ranges: Range[]): Range[] {
  const sorted = ranges.filter(({ from, to }) => from < to).sort((left, right) => left.from - right.from || left.to - right.to);
  const merged: Range[] = [];
  for (const range of sorted) {
    const previous = merged.at(-1);
    if (!previous || range.from > previous.to) merged.push({ ...range });
    else previous.to = Math.max(previous.to, range.to);
  }
  return merged;
}

function intersectsProtectedRange(ranges: readonly Range[], candidate: Range): boolean {
  let low = 0, high = ranges.length;
  while (low < high) {
    const middle = low + ((high - low) >> 1);
    if (ranges[middle].to <= candidate.from) low = middle + 1;
    else high = middle;
  }
  return low < ranges.length && ranges[low].from < candidate.to;
}

function frontMatterRange(source: string): Range[] {
  const opening = /^---[ \t]*(?:\r\n|\r|\n)/.exec(source);
  if (!opening) return [];
  let lineStart = opening[0].length;
  while (lineStart <= source.length) {
    let lineEnd = lineStart;
    while (lineEnd < source.length && source[lineEnd] !== "\r" && source[lineEnd] !== "\n") lineEnd += 1;
    if (/^---[ \t]*$/.test(source.slice(lineStart, lineEnd))) {
      let to = lineEnd;
      if (source[to] === "\r" && source[to + 1] === "\n") to += 2;
      else if (to < source.length) to += 1;
      return [{ from: 0, to }];
    }
    if (lineEnd === source.length) break;
    lineStart = source[lineEnd] === "\r" && source[lineEnd + 1] === "\n" ? lineEnd + 2 : lineEnd + 1;
  }
  return [{ from: 0, to: source.length }];
}

function footnoteRanges(source: string): Range[] {
  const ranges: Range[] = [];
  const lines = [...source.matchAll(/[^\r\n]*(?:\r\n|\r|\n|$)/g)].filter((match) => match[0].length > 0);
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    if (!/^ {0,3}\[\^[^\]]+\]:/.test(line[0])) continue;
    const from = line.index ?? 0;
    let to = from + line[0].length;
    while (index + 1 < lines.length && /^(?: {2,}|\t)\S/.test(lines[index + 1][0])) {
      index += 1;
      to = (lines[index].index ?? to) + lines[index][0].length;
    }
    ranges.push({ from, to });
  }
  return ranges;
}

function standaloneTocRanges(source: string): Range[] {
  const ranges: Range[] = [];
  const lines = [...source.matchAll(/[^\r\n]*(?:\r\n|\r|\n|$)/g)].filter((match) => match[0].length > 0);
  for (const line of lines) {
    const body = line[0].replace(/(?:\r\n|\r|\n)$/u, "");
    if (/^[\t ]{0,3}(?:\[TOC\]|\[\[TOC\]\])[\t ]*$/iu.test(body)) {
      const from = line.index ?? 0;
      ranges.push({ from, to: from + line[0].length });
    }
  }
  return ranges;
}

function isEscapedDelimiter(source: string, index: number): boolean {
  let slashes = 0;
  for (let cursor = index - 1; cursor >= 0 && source[cursor] === "\\"; cursor -= 1) slashes += 1;
  return slashes % 2 === 1;
}

function findUnescapedDelimiter(source: string, delimiter: string, start = 0): number | undefined {
  let index = source.indexOf(delimiter, start);
  while (index >= 0) {
    if (!isEscapedDelimiter(source, index)) return index;
    index = source.indexOf(delimiter, index + delimiter.length);
  }
  return undefined;
}

function displayMathRanges(source: string): Range[] {
  const result: Range[] = [];
  let displayStart: number | undefined;
  let closingDelimiter: string | undefined;
  let lineStart = 0;
  while (lineStart < source.length) {
    let contentTo = lineStart;
    while (contentTo < source.length && source[contentTo] !== "\r" && source[contentTo] !== "\n") contentTo += 1;
    let lineTo = contentTo;
    if (source[lineTo] === "\r" && source[lineTo + 1] === "\n") lineTo += 2;
    else if (lineTo < source.length) lineTo += 1;
    const body = source.slice(lineStart, contentTo);
    if (displayStart !== undefined && closingDelimiter) {
      if (findUnescapedDelimiter(body, closingDelimiter) !== undefined) {
        result.push({ from: displayStart, to: lineTo });
        displayStart = undefined;
        closingDelimiter = undefined;
      }
    } else {
      for (const [opening, closing] of [["$$", "$$"], ["\\[", "\\]"]] as const) {
        let open = findUnescapedDelimiter(body, opening);
        while (open !== undefined) {
          const close = findUnescapedDelimiter(body, closing, open + opening.length);
          if (close === undefined) break;
          result.push({ from: lineStart + open, to: lineStart + close + closing.length });
          open = findUnescapedDelimiter(body, opening, close + closing.length);
        }
      }
      const dollarStart = /^ {0,3}\$\$/.exec(body);
      const bracketStart = /^ {0,3}\\\[/.exec(body);
      if (dollarStart && findUnescapedDelimiter(body, "$$", dollarStart[0].length) === undefined) {
        displayStart = lineStart;
        closingDelimiter = "$$";
      } else if (bracketStart && findUnescapedDelimiter(body, "\\]", bracketStart[0].length) === undefined) {
        displayStart = lineStart;
        closingDelimiter = "\\]";
      }
    }
    if (lineTo <= lineStart) break;
    lineStart = lineTo;
  }
  if (displayStart !== undefined) result.push({ from: displayStart, to: source.length });
  return mergeRanges(result);
}

function previousCodePoint(source: string, index: number): number {
  const last = source.charCodeAt(index - 1);
  const first = source.charCodeAt(index - 2);
  return last >= 0xdc00 && last <= 0xdfff && first >= 0xd800 && first <= 0xdbff ? index - 2 : index - 1;
}

function readOnlyContext(source: string, range: Range, scope: Range): { before: string; after: string } {
  let before = range.from;
  let count = 0;
  while (before > scope.from && count < 64) {
    const previous = previousCodePoint(source, before);
    if (source[previous] === "\n" || source[previous] === "\r") break;
    before = previous;
    count += 1;
  }
  let after = range.to;
  count = 0;
  while (after < scope.to && count < 64) {
    const point = source.codePointAt(after);
    if (point === undefined || point === 10 || point === 13) break;
    after += point > 0xffff ? 2 : 1;
    count += 1;
  }
  return { before: source.slice(before, range.from), after: source.slice(range.to, after) };
}

function safeBoundary(source: string, offset: number): boolean {
  if (!Number.isInteger(offset) || offset < 0 || offset > source.length) return false;
  if (offset === 0 || offset === source.length) return true;
  const before = source.charCodeAt(offset - 1);
  const after = source.charCodeAt(offset);
  return !(source[offset - 1] === "\r" && source[offset] === "\n") &&
    !(before >= 0xd800 && before <= 0xdbff && after >= 0xdc00 && after <= 0xdfff);
}

function collectParagraphRanges(root: AstNode): Array<{ range: Range; paragraphId: string }> {
  const result: Array<{ range: Range; paragraphId: string }> = [];
  let paragraphIndex = 0;
  walk(root, (node) => {
    if (node.name !== "Paragraph" && node.name !== "Task") return;
    paragraphIndex += 1;
    result.push({ range: { from: node.from, to: node.to }, paragraphId: `p${paragraphIndex}` });
  });
  return result;
}

function rangesExcluding(range: Range, excluded: readonly Range[]): Range[] {
  const result: Range[] = [];
  let cursor = range.from;
  for (const protectedRange of excluded) {
    if (protectedRange.to <= cursor) continue;
    if (protectedRange.from >= range.to) break;
    if (protectedRange.from > cursor) result.push({ from: cursor, to: Math.min(protectedRange.from, range.to) });
    cursor = Math.max(cursor, protectedRange.to);
    if (cursor >= range.to) break;
  }
  if (cursor < range.to) result.push({ from: cursor, to: range.to });
  return result;
}

function safeTextSlots(source: string, scope: Range, root: AstNode): Array<{ range: Range; paragraphId: string }> {
  const tocRanges = standaloneTocRanges(source);
  const protectedRanges: Range[] = [
    ...frontMatterRange(source),
    ...footnoteRanges(source),
    ...tocRanges,
    ...displayMathRanges(source)
  ];
  walk(root, (node) => {
    if (protectedNodes.has(node.name) || /^ATXHeading[1-6]$/.test(node.name) || /^SetextHeading/.test(node.name)) {
      protectedRanges.push(node);
    }
  });
  const sortedProtectedRanges = mergeRanges(protectedRanges);
  const paragraphs = collectParagraphRanges(root);
  const slots: Array<{ range: Range; paragraphId: string }> = [];
  for (const paragraph of paragraphs) {
    for (const textRange of rangesExcluding(paragraph.range, tocRanges)) {
      for (const sentence of splitMarkdownSentences(source, textRange)) {
        if (sentence.from < scope.from || sentence.to > scope.to) continue;
        if (intersectsProtectedRange(sortedProtectedRanges, sentence)) continue;
        slots.push({ range: sentence, paragraphId: paragraph.paragraphId });
      }
    }
  }
  return slots.sort((left, right) => left.range.from - right.range.from || left.range.to - right.range.to);
}

function slotOutputTokenReserve(slot: ProseSlot): number {
  return Math.ceil(estimateAiTokens(slot.sourceText) * 2 + estimateAiTokens("x".repeat(64)) + estimateAiTokens(slot.id) + 32);
}

function makeBatch(request: ProseEditRequest, slots: readonly ProseSlot[], index: number, budget: ProseEditProviderBudget): ProseEditBatch | null {
  const id = `batch-${index + 1}`;
  const payload = {
    protocol: "prose-edit/v1",
    batchId: id,
    slots: slots.map(({ id: slotId, sourceText, readOnlyContext }) => ({
      id: slotId,
      text: sourceText,
      contextBefore: readOnlyContext.before,
      contextAfter: readOnlyContext.after
    }))
  };
  const systemPrompt = [
    request.systemPrompt,
    "只按用户要求修改每个槽的 text，保持事实、数字、日期、金额、标识、单位、上下标表达式及其关系不变，不补充事实。contextBefore/contextAfter 是受限只读相邻语境，仅供理解，绝不可复制或拼接到任何 text，也不要补写其中的数字或符号。槽内已有换行须保留其原序列、数量和类型（LF、CRLF 或 CR），禁止新增、删除或互相转换。",
    "仅输出 JSON：{protocol:\"prose-edit/v1\",batchId,edits:[{id,status:\"replace\",text}|{id,status:\"unchanged\"}]}。每个槽恰好回执一次；未改变时只回传 id 和 status，不要复写输入文本；不得返回完整文档。"
  ].join("\n\n");
  const prompt = [
    `用户要求：${request.instruction}`,
    "只改当前 text 槽，不新增或删除 Markdown 结构。相邻 context 仅供理解且不可输出；未改变的槽只回执 unchanged。输出 JSON 不要代码围栏。",
    `${"【待编辑文本槽】\n"}${JSON.stringify(payload)}`
  ].join("\n\n");
  const maxTokens = slots.reduce((total, slot) => total + slotOutputTokenReserve(slot), estimateAiTokens('{"protocol":"prose-edit/v1","batchId":"batch-000","edits":[]}'));
  if (maxTokens > budget.maxOutputTokens) return null;
  try {
    const usage = calculateLocalAiBudget(prompt, systemPrompt, Math.max(1, maxTokens), budget.contextLimit);
    const textBytes = slots.reduce((total, slot) => total + 2 * byteLength(slot.sourceText) + 64, 0);
    const jsonOverhead = byteLength(JSON.stringify({ protocol: "prose-edit/v1", batchId: id, edits: slots.map(({ id: slotId }) => ({ id: slotId, status: "replace", text: "" })) }));
    return {
      id,
      slots,
      prompt,
      systemPrompt,
      maxTokens: usage.maxTokens,
      contextTokens: usage.contextTokens,
      maxOutputBytes: Math.min(2 * 1024 * 1024, jsonOverhead + textBytes * 2)
    };
  } catch {
    return null;
  }
}

function resolvedBudget(request: ProseEditRequest): ProseEditProviderBudget {
  const context = request.providerBudget?.contextLimit ?? LOCAL_AI_CONTEXT_LIMIT;
  const output = request.providerBudget?.maxOutputTokens ?? LOCAL_AI_MAX_OUTPUT_TOKENS;
  if (!Number.isSafeInteger(context) || context < 1 || !Number.isSafeInteger(output) || output < 1) {
    reject("模型预算配置无效");
  }
  return {
    contextLimit: Math.min(context, LOCAL_AI_CONTEXT_LIMIT),
    maxOutputTokens: Math.min(output, LOCAL_AI_MAX_OUTPUT_TOKENS)
  };
}

function createBatches(request: ProseEditRequest, slots: ProseSlot[], availableCalls: number): ProseEditBatch[] {
  const budget = resolvedBudget(request);
  const batches: ProseEditBatch[] = [];
  let pending: ProseSlot[] = [];
  const flush = () => {
    if (!pending.length) return;
    const batch = makeBatch(request, pending, batches.length, budget);
    if (!batch) reject("单组安全文本超过模型上下文或输出预算，未开始调用");
    batches.push(batch);
    pending = [];
  };
  for (const slot of slots) {
    const candidate = [...pending, slot];
    const next = candidate.length <= MAX_SLOTS_PER_BATCH ? makeBatch(request, candidate, batches.length, budget) : null;
    if (next) { pending = candidate; continue; }
    flush();
    const solo = makeBatch(request, [slot], batches.length, budget);
    if (!solo) reject("单段正文无法在安全预算内分批，请缩小处理范围");
    pending = [slot];
  }
  flush();
  if (batches.length > MAX_BATCHES) reject("文本槽分组超过 50 组安全上限，请缩小处理范围");
  if (batches.length > availableCalls) reject("文本槽分组超过当前剩余模型调用预算，已在开始前停止");
  return batches;
}

/** Builds bounded, source-owned prose slots without consuming calls or selecting an output protocol. */
export function buildProseEditSourcePlan(request: ProseEditRequest): ProseEditSourcePlan {
  if (typeof request.source !== "string" || typeof request.instruction !== "string" || typeof request.systemPrompt !== "string") {
    reject("正文编辑请求无效");
  }
  const inputBytes = byteLength(request.source);
  if (inputBytes > MAX_SOURCE_BYTES) reject("正文超过 1 MiB 安全上限");
  if (byteLength(request.instruction) > MAX_PROMPT_FIELD_BYTES || byteLength(request.systemPrompt) > MAX_PROMPT_FIELD_BYTES) {
    reject("正文编辑指令或系统提示超过安全上限");
  }
  const scope = request.scope ?? { from: 0, to: request.source.length };
  if (!safeBoundary(request.source, scope.from) || !safeBoundary(request.source, scope.to) || scope.from > scope.to) {
    reject("编辑范围没有对齐安全的 Unicode 或换行边界");
  }
  const root = parseTree(request.source);
  const ranges = safeTextSlots(request.source, scope, root);
  if (ranges.length > MAX_SLOTS) reject("可编辑正文槽超过安全上限");
  const slots: ProseSlot[] = ranges.map(({ range, paragraphId }, index) => ({
    id: `slot-${index + 1}`,
    range,
    sourceText: request.source.slice(range.from, range.to),
    paragraphId,
    readOnlyContext: readOnlyContext(request.source, range, scope)
  }));
  return {
    source: request.source,
    sourceHash: fingerprintProseSource(request.source),
    ...(request.revision ? { revision: request.revision } : {}),
    scope,
    inputBytes,
    slots
  };
}

/** Builds the existing JSON-receipt plan on top of the shared source-owned units. */
export function buildProseEditPlan(request: ProseEditRequest, availableCalls: number): ProseEditPlan {
  if (!Number.isSafeInteger(availableCalls) || availableCalls < 0) reject("模型剩余调用预算无效");
  const sourcePlan = buildProseEditSourcePlan(request);
  const batches = createBatches(request, [...sourcePlan.slots], availableCalls);
  return { ...sourcePlan, batches };
}
