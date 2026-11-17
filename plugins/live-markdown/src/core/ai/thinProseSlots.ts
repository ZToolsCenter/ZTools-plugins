import { GFM, parser } from "@lezer/markdown";
import { buildProseEditSourcePlan, type ProseSlot } from "./proseEditPlan";
import { proseEditProtectedRanges } from "./proseEditProtectedRanges";
import { findEligibleProseDateOwner, joinOwnedDateRange, type ProseDateOwnerFact } from "./proseDateOwnership";
import type { ProseDuplicateSentenceRun } from "./proseDuplicateOwnership";
import { scanProseDateSurfaces, type ProseDateSurface } from "./proseFactSurface";
import { MARKDOWN_AST_RESOURCE_BUDGET, isWithinMarkdownAstByteBudget } from "./markdownAstResourceBudget";
import { registerThinProseSlotBatch } from "./thinProseSlotBatchProvenance";

interface Range { from: number; to: number; }

export interface ThinProseScopeContext {
  document: string;
  range: Range;
}

export interface ThinProseSlot {
  id: string;
  range: Range;
  sourceText: string;
  contextBefore: string;
  contextAfter: string;
  dateOwnerFact?: ProseDateOwnerFact;
  /** Candidate qualification only; readable planning must revalidate and assign the complete date range. */
  dateOwnerCandidate?: ProseDateOwnerFact;
  /** Provenance for a source-authorized exact duplicate-sentence run. */
  duplicateSentenceRun?: ProseDuplicateSentenceRun;
}

const MAX_AST_NODES = MARKDOWN_AST_RESOURCE_BUDGET.maxNodes;
const MAX_AST_DEPTH = MARKDOWN_AST_RESOURCE_BUDGET.maxDepth;
const MAX_SLOTS = 50_000;
const INLINE_SYNTAX_NODES = new Set([
  "InlineCode", "Image", "URL", "HTMLTag", "Escape", "Entity",
  "LinkMark", "EmphasisMark", "StrongEmphasisMark", "StrikethroughMark",
  "CodeMark", "LinkTitle"
]);
const markdownParser = parser.configure(GFM);

function mergeRanges(ranges: Range[]): Range[] {
  const sorted = ranges.filter(({ from, to }) => from < to).sort((a, b) => a.from - b.from || a.to - b.to);
  const result: Range[] = [];
  for (const range of sorted) {
    const previous = result.at(-1);
    if (!previous || range.from > previous.to) result.push({ ...range });
    else previous.to = Math.max(previous.to, range.to);
  }
  return result;
}

function normalizeWithOffsets(source: string): { text: string; toSourceOffset(offset: number): number } {
  if (!source.includes("\r")) return { text: source, toSourceOffset: (offset) => offset };
  let text = "";
  const crlfEnds: number[] = [];
  for (let index = 0; index < source.length; index += 1) {
    if (source[index] === "\r") {
      text += "\n";
      if (source[index + 1] === "\n") { index += 1; crlfEnds.push(text.length); }
    } else text += source[index];
  }
  return {
    text,
    toSourceOffset(offset) {
      let low = 0, high = crlfEnds.length;
      while (low < high) {
        const middle = low + ((high - low) >> 1);
        if (crlfEnds[middle] <= offset) low = middle + 1;
        else high = middle;
      }
      return offset + low;
    }
  };
}

function astSyntaxRanges(source: string, includeContainerSyntax = false): Range[] {
  if (includeContainerSyntax && !isWithinMarkdownAstByteBudget(source)) {
    throw new Error("正文 Markdown AST 超过资源预算，原文未修改。");
  }
  const normalized = normalizeWithOffsets(source);
  const ranges: Range[] = [];
  const syntaxNodes = includeContainerSyntax ? new Set([...INLINE_SYNTAX_NODES,
    "FencedCode", "CodeBlock", "Table", "HTMLBlock", "Blockquote", "BulletList", "OrderedList", "ListItem",
    "Link", "Emphasis", "StrongEmphasis", "Strikethrough",
    "ATXHeading1", "ATXHeading2", "ATXHeading3", "ATXHeading4", "ATXHeading5", "ATXHeading6",
    "SetextHeading1", "SetextHeading2"]) : INLINE_SYNTAX_NODES;
  let nodes = 0, depth = -1;
  markdownParser.parse(normalized.text).iterate({
    enter(node) {
      nodes += 1;
      depth += 1;
      if (nodes > MAX_AST_NODES || includeContainerSyntax && depth > MAX_AST_DEPTH) {
        throw new Error("正文 Markdown AST 超过资源预算，原文未修改。");
      }
      if (syntaxNodes.has(node.name)) {
        ranges.push({ from: normalized.toSourceOffset(node.from), to: normalized.toSourceOffset(node.to) });
      }
    },
    leave() { depth -= 1; }
  });
  return ranges;
}

interface DateOwnerAstContext {
  eligible: boolean;
  ranges: Range[];
  document?: string;
  offset?: number;
  protectedRanges?: Range[];
  mathRanges?: Range[];
  dates?: ProseDateSurface[];
}

function dateOwnerAstContext(source: string, scope?: ThinProseScopeContext): DateOwnerAstContext {
  if (!scope) {
    try { return { eligible: true, ranges: astSyntaxRanges(source, true) }; }
    catch { return { eligible: false, ranges: [] }; }
  }
  const { document, range } = scope;
  if (!Number.isSafeInteger(range.from) || !Number.isSafeInteger(range.to) ||
      range.from < 0 || range.from >= range.to || range.to > document.length ||
      document.slice(range.from, range.to) !== source) return { eligible: false, ranges: [] };
  if (!isWithinMarkdownAstByteBudget(document)) return { eligible: false, ranges: [] };
  try {
    if (document === source && range.from === 0 && range.to === source.length) {
      return { eligible: true, ranges: astSyntaxRanges(source, true), document, offset: 0,
        protectedRanges: proseEditProtectedRanges(source, 0), mathRanges: inlineMathRanges(source),
        dates: scanProseDateSurfaces(source) };
    }
    const ranges = astSyntaxRanges(document, true)
      .filter(item => item.from < range.to && item.to > range.from)
      .map(item => ({ from: Math.max(item.from, range.from) - range.from, to: Math.min(item.to, range.to) - range.from }));
    return { eligible: true, ranges, document, offset: range.from,
      protectedRanges: proseEditProtectedRanges(document, 0), mathRanges: inlineMathRanges(document),
      dates: scanProseDateSurfaces(document) };
  } catch {
    return { eligible: false, ranges: [] };
  }
}

function dateOwnerContextAllows(fact: ProseDateOwnerFact, scopeRange: Range, context: DateOwnerAstContext): boolean {
  if (!context.eligible) return false;
  if (!context.document || context.offset === undefined || !context.protectedRanges || !context.mathRanges || !context.dates) return true;
  const scope = { from: scopeRange.from + context.offset, to: scopeRange.to + context.offset };
  const date = { from: fact.date.from + context.offset, to: fact.date.to + context.offset };
  const globalDate = context.dates.filter(surface => surface.from === date.from && surface.to === date.to);
  if (globalDate.length !== 1 || !globalDate[0]!.safe || globalDate[0]!.format !== "iso" ||
      globalDate[0]!.iso !== fact.date.iso) return false;
  if (context.protectedRanges.some(range => range.from < scope.to && range.to > scope.from &&
      !(range.from === date.from && range.to === date.to))) return false;
  return !context.mathRanges.some(range => range.from < scope.to && range.to > scope.from);
}

function isEscaped(source: string, index: number): boolean {
  let slashes = 0;
  for (let cursor = index - 1; cursor >= 0 && source[cursor] === "\\"; cursor -= 1) slashes += 1;
  return slashes % 2 === 1;
}

function inlineMathRanges(source: string): Range[] {
  const ranges: Range[] = [];
  const expression = /\$\$[\s\S]*?\$\$|\$(?!\$)[^\r\n$]+?\$|\\\([\s\S]*?\\\)|\\\[[\s\S]*?\\\]/gu;
  for (const match of source.matchAll(expression)) {
    const from = match.index ?? 0;
    if (match[0][0] === "$" && isEscaped(source, from)) continue;
    ranges.push({ from, to: from + match[0].length });
  }
  return ranges;
}

function lineBreakRanges(source: string): Range[] {
  const ranges: Range[] = [];
  for (const match of source.matchAll(/\r\n|\r|\n/gu)) {
    const from = match.index ?? 0;
    ranges.push({ from, to: from + match[0].length });
  }
  return ranges;
}

function preservesOuterMarkers(instruction: string): boolean {
  const preserve = /(?:保留|原样|不变|不要改|保持原样|preserve|keep|leave\s+unchanged)/iu.test(instruction);
  const position = /(?:文首|文末|开头|结尾|首行|末行|首尾|边缘|beginning|opening|first\s+line|start|ending|end|last\s+line|outer|boundary)/iu.test(instruction);
  const marker = /(?:标记|marker|tag)/iu.test(instruction);
  return preserve && position && marker;
}

function lineRangeAt(source: string, offset: number): Range {
  const from = Math.max(source.lastIndexOf("\n", offset - 1), source.lastIndexOf("\r", offset - 1)) + 1;
  let to = offset;
  while (to < source.length && source[to] !== "\r" && source[to] !== "\n") to += 1;
  return { from, to };
}

function outerMarkerRanges(source: string, instruction: string, slots: readonly ProseSlot[]): Range[] {
  if (!preservesOuterMarkers(instruction)) return [];
  if (!slots.length) return [];
  return [lineRangeAt(source, slots[0].range.from), lineRangeAt(source, slots.at(-1)!.range.to)];
}

function trimRange(source: string, input: Range): Range | undefined {
  let from = input.from, to = input.to;
  while (from < to && /\s/u.test(source[from])) from += 1;
  while (to > from && /\s/u.test(source[to - 1])) to -= 1;
  if (from < to) return { from, to };
  return undefined;
}

function firstProtectedRangeAfter(ranges: readonly Range[], offset: number): Range | undefined {
  let low = 0, high = ranges.length;
  while (low < high) {
    const middle = low + ((high - low) >> 1);
    if (ranges[middle].to <= offset) low = middle + 1;
    else high = middle;
  }
  const next = ranges[low];
  return next?.from >= offset ? next : undefined;
}

function isNonSubstantiveFactSlot(source: string, range: Range, protectedRanges: readonly Range[]): boolean {
  const text = source.slice(range.from, range.to).trim();
  if (!text) return true;
  if (/^[\p{P}\p{S}\s]+$/u.test(text)) return true;

  const label = text.replace(/^[\p{P}\s]+/u, "").trim();
  if (!/^\p{L}[\p{L}\p{N}_\s-]{0,31}[:：]$/u.test(label)) return false;
  const next = firstProtectedRangeAfter(protectedRanges, range.to);
  if (!next || source.slice(range.to, next.from).trim()) return false;
  return /\p{N}/u.test(source.slice(next.from, next.to));
}

function subtractRanges(range: Range, excluded: readonly Range[]): Range[] {
  const result: Range[] = [];
  let cursor = range.from;
  for (const item of excluded) {
    if (item.to <= cursor) continue;
    if (item.from >= range.to) break;
    if (item.from > cursor) result.push({ from: cursor, to: Math.min(item.from, range.to) });
    cursor = Math.max(cursor, item.to);
    if (cursor >= range.to) break;
  }
  if (cursor < range.to) result.push({ from: cursor, to: range.to });
  return result;
}

function previousCodePoint(source: string, offset: number): number {
  const last = source.charCodeAt(offset - 1), first = source.charCodeAt(offset - 2);
  return last >= 0xdc00 && last <= 0xdfff && first >= 0xd800 && first <= 0xdbff ? offset - 2 : offset - 1;
}

function nextCodePoint(source: string, offset: number): number {
  const point = source.codePointAt(offset);
  return point === undefined ? offset : offset + (point > 0xffff ? 2 : 1);
}

function contextWindow(source: string, range: Range, protectedRanges: readonly Range[], side: "before" | "after"): string {
  const maximum = 48;
  if (side === "before") {
    let lineStart = Math.max(source.lastIndexOf("\n", range.from - 1), source.lastIndexOf("\r", range.from - 1)) + 1;
    let from = range.from, count = 0;
    while (from > lineStart && count < maximum) { from = previousCodePoint(source, from); count += 1; }
    const barrier = protectedRanges.filter((item) => item.from < range.from && item.to > from).at(-1);
    if (barrier) from = Math.max(from, barrier.to);
    return source.slice(from, range.from).trim();
  }
  let lineEnd = source.length;
  for (const marker of [source.indexOf("\n", range.to), source.indexOf("\r", range.to)]) {
    if (marker >= 0) lineEnd = Math.min(lineEnd, marker);
  }
  let to = range.to, count = 0;
  while (to < lineEnd && count < maximum) { to = nextCodePoint(source, to); count += 1; }
  const barrier = protectedRanges.find((item) => item.to > range.to && item.from < to);
  if (barrier) to = Math.min(to, barrier.from);
  return source.slice(range.to, to).trim();
}

/** Creates exact-range plain-text slots; every non-text byte stays owned by the source. */
export function buildThinProseSlots(source: string, instruction: string, systemPrompt = "",
  scopeContext?: ThinProseScopeContext): ThinProseSlot[] {
  const plan = buildProseEditSourcePlan({ source, instruction, systemPrompt });
  const syntaxRanges = astSyntaxRanges(source);
  const dateContext = dateOwnerAstContext(source, scopeContext);
  const dateOwnerSyntaxRanges = dateContext.ranges;
  const outerMarkers = outerMarkerRanges(source, instruction, plan.slots);
  const protectedRanges = mergeRanges([
    ...syntaxRanges,
    ...inlineMathRanges(source),
    ...lineBreakRanges(source),
    ...proseEditProtectedRanges(source, 0),
    ...outerMarkers
  ]);
  const ranges: Array<Range & { dateOwnerFact?: ProseDateOwnerFact; dateOwnerCandidate?: ProseDateOwnerFact }> = [];
  for (const sourceSlot of plan.slots) {
    const parts = subtractRanges(sourceSlot.range, protectedRanges);
    const candidateFact = dateContext.eligible ? findEligibleProseDateOwner({
      source,
      sourcePlanRange: sourceSlot.range,
      astSyntaxRanges: dateOwnerSyntaxRanges
    }) : null;
    const dateOwnerFact = candidateFact && dateOwnerContextAllows(candidateFact, sourceSlot.range, dateContext)
      ? candidateFact : null;
    const ownedDate = dateOwnerFact ? joinOwnedDateRange(source, parts, dateOwnerFact) : null;
    if (ownedDate && !outerMarkers.some(marker => marker.from < ownedDate.to && marker.to > ownedDate.from)) {
      const first = parts.findIndex(part => part.from === ownedDate.from);
      const lastRangeEnd = ownedDate.to === dateOwnerFact!.date.to ? dateOwnerFact!.date.from : ownedDate.to;
      const last = parts.findIndex(part => part.to === lastRangeEnd);
      if (first >= 0 && last >= first) {
        for (let index = 0; index < parts.length; index += 1) ranges.push({
          ...parts[index]!,
          ...(index >= first && index <= last ? { dateOwnerCandidate: ownedDate.fact } : {})
        });
        if (ranges.length > MAX_SLOTS) throw new Error("可编辑正文槽超过安全上限，原文未修改。");
        continue;
      }
    }
    for (const range of parts) {
      const trimmed = trimRange(source, range);
      if (trimmed) ranges.push(trimmed);
      if (ranges.length > MAX_SLOTS) throw new Error("可编辑正文槽超过安全上限，原文未修改。");
    }
  }
  const slots = ranges
    .sort((left, right) => left.from - right.from || left.to - right.to)
    .filter((range) => range.dateOwnerCandidate || !isNonSubstantiveFactSlot(source, range, protectedRanges))
    .map((range, index) => ({
      id: `text-${index + 1}`,
      range,
      sourceText: source.slice(range.from, range.to),
      contextBefore: contextWindow(source, range, protectedRanges, "before"),
      contextAfter: contextWindow(source, range, protectedRanges, "after"),
      ...(range.dateOwnerFact ? { dateOwnerFact: range.dateOwnerFact } : {}),
      ...(range.dateOwnerCandidate ? { dateOwnerCandidate: range.dateOwnerCandidate } : {})
    }));
  const fullDocumentAstValidated = dateContext.eligible && (!scopeContext ||
    scopeContext.document === source && scopeContext.range.from === 0 && scopeContext.range.to === source.length);
  registerThinProseSlotBatch(slots, { source, instruction, systemContext: systemPrompt, scopeContext,
    fullDocumentAstValidated });
  return slots;
}
