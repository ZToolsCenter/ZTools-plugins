import { GFM, parser } from "@lezer/markdown";
import { isWithinMarkdownAstByteBudget, MARKDOWN_AST_RESOURCE_BUDGET } from "./markdownAstResourceBudget";
import { validateProseReplacementFacts } from "./proseEditFactGuard";
import { readableProseSentenceWindows, type ReadableProseWindow } from "./readableProseView";

interface Range { from: number; to: number; }

export interface ProseDuplicateSentenceRun {
  sourceRange: Range;
  sentenceText: string;
  copies: readonly { slotId: string; range: Range; text: string }[];
}

export interface ProseDuplicateScopeContext {
  document: string;
  range: Range;
}

interface DuplicateSlotLike {
  id: string;
  range: Range;
  sourceText: string;
  contextBefore: string;
  contextAfter: string;
  dateOwnerFact?: unknown;
  dateOwnerCandidate?: unknown;
  duplicateSentenceRun?: ProseDuplicateSentenceRun;
}

interface AstIndex {
  ranges: Range[];
  prefixMaxTo: number[];
}

const markdownParser = parser.configure(GFM);
const MAX_AST_NODES = MARKDOWN_AST_RESOURCE_BUDGET.maxNodes;
const MAX_AST_DEPTH = MARKDOWN_AST_RESOURCE_BUDGET.maxDepth;
const SAFE_TEXT_NODES = new Set(["Document", "Paragraph", "Text"]);
const DENIAL = /不要|不应|不许|不得|不可以|不能|不可|不删除|不删|不去掉|不移除|禁止|无需|不用|不必|不需要|不允许|并非|保留两|保留全部|do not|don't|never|not\s+delete|keep\s+both/iu;
const POLISH_CLAUSE = /^(?:请)?(?:只)?(?:润色|校对)(?:(?:当前|这份|本文|整篇|可读)?(?:正文|文稿|文本))?$/u;
const DELETE_DUPLICATE_CLAUSE = /^(?:请)?(?:删除|删掉|删去|移除|去掉)(?:(?:(?:完全|全部)?(?:重复|相同)(?:的)?(?:第?[一二三四五六七八九十\d]+个?)?句(?:子)?)|(?:的)?第?[一二三四五六七八九十\d]+个?重复(?:的)?句(?:子)?)$/iu;
const KEEP_ONE_CLAUSE = /^(?:只|仅|单)?(?:保留|留下)(?:其中)?(?:一次|一个|一份|一条|one)(?:(?:原句|句子|副本)|([\p{Script=Han}\p{L}\p{N}]{3,32})的(?:要求|结果|内容|副本|句子|段落))?$/iu;
const EXTRA_ACTION = /(?:并|同时|另外|然后|以及|修改|改为|增加|添加|插入|补充|调整|替换|改动|扩写|删|删除|总结|翻译|保持|不变|原样|重写|rewrite|change|add|insert|also|then)/iu;

function hasInterrogativeOrHedgedEnding(instruction: string): boolean {
  if (/[?？]/u.test(instruction)) return true;
  const withoutTrailingPunctuation = instruction.trim().replace(/[\p{White_Space}。.!！…"'“”‘’）)\]}】》]+$/u, "");
  return /(?:吗|么|呢|吧)$/u.test(withoutTrailingPunctuation);
}

interface DuplicateSentenceAuthorization { referencedObject: string | null; }

function parseDuplicateSentenceAuthorization(instruction: string): DuplicateSentenceAuthorization | null {
  // Check tone before splitting: otherwise a trailing question mark is discarded as a separator,
  // turning a question into two imperative-looking clauses.
  if (!instruction || instruction.length > 2_048 || /[\r\n]/u.test(instruction) ||
      hasInterrogativeOrHedgedEnding(instruction) || DENIAL.test(instruction)) return null;
  const clauses = instruction.split(/[，,。；;！？!?]+/u).map(clause => clause.trim()).filter(Boolean);
  if (clauses.length < 2 || clauses.length > 4) return null;
  let polishClauses = 0, deleteClauses = 0, keepClauses = 0;
  let referencedObject: string | null = null;
  for (const clause of clauses) {
    if (POLISH_CLAUSE.test(clause)) { polishClauses += 1; continue; }
    if (DELETE_DUPLICATE_CLAUSE.test(clause)) { deleteClauses += 1; continue; }
    const keep = KEEP_ONE_CLAUSE.exec(clause);
    if (keep && !EXTRA_ACTION.test(keep[1] ?? "")) {
      keepClauses += 1;
      referencedObject = keep[1] ?? null;
      continue;
    }
    return null;
  }
  return polishClauses <= 1 && deleteClauses === 1 && keepClauses === 1 ? { referencedObject } : null;
}

/** True only for a single, explicit duplicate-sentence removal with a keep-one outcome. */
export function authorizesDuplicateSentenceRemoval(instruction: string): boolean {
  return parseDuplicateSentenceAuthorization(instruction) !== null;
}

function physicalLine(document: string, offset: number): ReadableProseWindow {
  const from = Math.max(document.lastIndexOf("\n", offset - 1), document.lastIndexOf("\r", offset - 1)) + 1;
  const cr = document.indexOf("\r", offset), lf = document.indexOf("\n", offset);
  return { from, to: Math.min(cr < 0 ? document.length : cr, lf < 0 ? document.length : lf) };
}

function parseAst(document: string): AstIndex | null {
  if (!isWithinMarkdownAstByteBudget(document)) return null;
  const ranges: Range[] = [];
  let count = 0, depth = -1;
  try {
    markdownParser.parse(document).iterate({
      enter(node) {
        count += 1;
        depth += 1;
        if (count > MAX_AST_NODES || depth > MAX_AST_DEPTH) throw new Error("AST budget");
        if (!SAFE_TEXT_NODES.has(node.name)) ranges.push({ from: node.from, to: node.to });
      },
      leave() { depth -= 1; }
    });
  } catch { return null; }
  ranges.sort((left, right) => left.from - right.from || left.to - right.to);
  const prefixMaxTo: number[] = [];
  let maximum = -1;
  for (const range of ranges) {
    maximum = Math.max(maximum, range.to);
    prefixMaxTo.push(maximum);
  }
  return { ranges, prefixMaxTo };
}

function isPlainOwnedContext(ast: AstIndex, range: Range): boolean {
  let low = 0, high = ast.ranges.length;
  while (low < high) {
    const middle = low + ((high - low) >> 1);
    if (ast.ranges[middle]!.from < range.to) low = middle + 1;
    else high = middle;
  }
  return low === 0 || ast.prefixMaxTo[low - 1]! <= range.from;
}

function validScope(source: string, context?: ProseDuplicateScopeContext): ProseDuplicateScopeContext | null {
  if (!context) return { document: source, range: { from: 0, to: source.length } };
  const { document, range } = context;
  if (!Number.isSafeInteger(range.from) || !Number.isSafeInteger(range.to) || range.from < 0 ||
      range.from >= range.to || range.to > document.length || document.slice(range.from, range.to) !== source) return null;
  return context;
}

function hasNoProtectedFact(slot: DuplicateSlotLike): boolean {
  if (slot.dateOwnerFact || slot.dateOwnerCandidate || slot.duplicateSentenceRun) return false;
  try { validateProseReplacementFacts(slot.sourceText + slot.sourceText, slot.sourceText); }
  catch { return false; }
  return true;
}

function repeatedRuns(slots: readonly DuplicateSlotLike[], context: ProseDuplicateScopeContext,
  ast: AstIndex): Array<DuplicateSlotLike[]> | null {
  const byLine = new Map<string, { range: Range; windows: readonly ReadableProseWindow[] | null; slots: DuplicateSlotLike[] }>();
  for (const slot of slots) {
    const globalFrom = context.range.from + slot.range.from;
    const globalTo = context.range.from + slot.range.to;
    const line = physicalLine(context.document, globalFrom);
    if (globalTo > line.to) continue;
    const key = `${line.from}:${line.to}`;
    const group = byLine.get(key) ?? { range: line, windows: readableProseSentenceWindows(context.document, line), slots: [] };
    group.slots.push(slot);
    byLine.set(key, group);
  }

  const runs: DuplicateSlotLike[][] = [];
  for (const { range: line, windows, slots: list } of byLine.values()) {
    if (!windows) return null;
    list.sort((left, right) => left.range.from - right.range.from);
    let index = 0;
    while (index < list.length) {
      const first = list[index]!;
      const run = [first];
      let nextIndex = index + 1;
      while (nextIndex < list.length) {
        const previous = run.at(-1)!;
        const next = list[nextIndex]!;
        if (next.range.from !== previous.range.to || next.sourceText !== first.sourceText) break;
        run.push(next);
        nextIndex += 1;
      }
      if (run.length > 1) {
        const eligible = run.every(slot => {
          const globalRange = { from: context.range.from + slot.range.from, to: context.range.from + slot.range.to };
          return globalRange.from >= line.from && globalRange.to <= line.to &&
            windows.some(window => window.from === globalRange.from && window.to === globalRange.to) &&
            hasNoProtectedFact(slot) && isPlainOwnedContext(ast, globalRange);
        });
        if (!eligible) return null;
        runs.push(run);
      }
      index += run.length;
    }
  }
  return runs;
}

/** Merges exactly one source-proven, explicitly authorized same-line duplicate run. */
export function groupAuthorizedDuplicateSentenceRun<T extends DuplicateSlotLike>(
  source: string,
  slots: readonly T[],
  instruction: string,
  scopeContext?: ProseDuplicateScopeContext
): T[] | null {
  const authorization = parseDuplicateSentenceAuthorization(instruction);
  if (!authorization) return null;
  const context = validScope(source, scopeContext);
  if (!context) return null;
  const ast = parseAst(context.document);
  if (!ast) return null;
  const runs = repeatedRuns(slots, context, ast);
  if (!runs || runs.length !== 1) return null;
  const run = runs[0]!;
  if (authorization.referencedObject && !run.every(slot => slot.sourceText.includes(authorization.referencedObject!))) return null;
  const first = run[0]!, last = run.at(-1)!;
  const from = first.range.from, to = last.range.to;
  if (run.some((slot, index) => slot.range.from !== (index === 0 ? from : run[index - 1]!.range.to) ||
      source.slice(slot.range.from, slot.range.to) !== slot.sourceText)) return null;
  const sentenceText = first.sourceText;
  const mergedSource = source.slice(from, to);
  try { validateProseReplacementFacts(mergedSource, sentenceText); }
  catch { return null; }
  const ownership: ProseDuplicateSentenceRun = {
    sourceRange: { from, to },
    sentenceText,
    copies: run.map(slot => ({ slotId: slot.id, range: { ...slot.range }, text: slot.sourceText }))
  };
  const merged = {
    id: `duplicate-run-${first.id}-${last.id}`,
    range: { from, to },
    sourceText: mergedSource,
    contextBefore: first.contextBefore,
    contextAfter: last.contextAfter,
    duplicateSentenceRun: ownership
  } as T;
  const removed = new Set(run.map(slot => slot.id));
  return [...slots.filter(slot => !removed.has(slot.id)), merged].sort((left, right) => left.range.from - right.range.from);
}

/** Rejects edits to a grouped slot unless exactly one original sentence remains. */
export function validateDuplicateSentenceReplacement(
  slot: DuplicateSlotLike,
  replacement: string,
  source: string
): string {
  const run = slot.duplicateSentenceRun;
  if (!run) return replacement;
  const valid = run.copies.length >= 2 && run.sourceRange.from === slot.range.from && run.sourceRange.to === slot.range.to &&
    run.copies.every((copy, index) => copy.text === run.sentenceText &&
      copy.range.from === (index === 0 ? slot.range.from : run.copies[index - 1]!.range.to) &&
      copy.range.to > copy.range.from && source.slice(copy.range.from, copy.range.to) === copy.text) &&
    run.copies[0]!.range.from === slot.range.from && run.copies.at(-1)!.range.to === slot.range.to &&
    slot.sourceText === run.copies.map(copy => copy.text).join("") && source.slice(slot.range.from, slot.range.to) === slot.sourceText;
  if (!valid || replacement !== run.sentenceText) {
    throw new Error("重复句整理结果未精确保留一个原句副本，原文未修改。");
  }
  return replacement;
}
