import { GFM, parser } from "@lezer/markdown";
import { MARKDOWN_AST_RESOURCE_BUDGET, isWithinMarkdownAstByteBudget } from "./markdownAstResourceBudget";
import { authorizeRoutineStyleRequestMarkerRepair, type RoutineStyleAuthorizationInput } from "./proseRoutineStyleAuthorization";

interface Range { from: number; to: number; }
const scopeBrand: unique symbol = Symbol("prose-request-marker-scope");
const sourceProofBrand: unique symbol = Symbol("prose-request-marker-source-proof");
const boundProofBrand: unique symbol = Symbol("prose-request-marker-bound-proof");
const markdownParser = parser.configure(GFM);
const MAX_INSTRUCTION_CHARS = 2048;
const MAX_PROOFS_PER_TASK = 64;
const MAX_AST_NODES = MARKDOWN_AST_RESOURCE_BUDGET.maxNodes;
const MAX_AST_DEPTH = MARKDOWN_AST_RESOURCE_BUDGET.maxDepth;
const MAX_QUOTE_DEPTH = 64;
const MAX_QUOTE_RANGES = 16_384;
const MAX_BACKSLASH_RUN = 4096;

const blockedBlockNodes = new Set([
  "Blockquote", "BulletList", "OrderedList", "ListItem", "Table", "FencedCode", "CodeBlock", "HTMLBlock",
  "ATXHeading1", "ATXHeading2", "ATXHeading3", "ATXHeading4", "ATXHeading5", "ATXHeading6",
  "SetextHeading1", "SetextHeading2", "ThematicBreak", "HorizontalRule"
]);
const blockedInlineNodes = new Set([
  "InlineCode", "Link", "Image", "URL", "LinkTitle", "LinkReference", "HTMLTag",
  "Emphasis", "StrongEmphasis", "Strikethrough", "Task", "Math", "InlineMath", "DisplayMath"
]);
const requestTail = /^(?:(?:(?:[\p{Script=Han}]{2,12}|[A-Za-z][A-Za-z0-9_.+-]{1,31})?项目组|项目团队|相关团队|相关人员|相关同事|团队|大家|各位|对方|相关方|同事|负责人))?(?:(?:再次|重新|尽快|及时))?(?:进行|予以|作出)?(?:确认|核对|检查|复核|审阅|回复|处理|补充|说明|提交|完成|更新|落实)/u;
const repeatedPleaseAtClauseStart = /(?:^|[。！？；，、：\r\n])([ \t]*)请请/gu;
const instructionPositiveClause = /^(?:(?:润色|校对)(?:正文|文本)?[，,][ \t]*)?(?:请[ \t]*)?(?:删去|删除|移除|去掉)[ \t]*(?:明显[ \t]*)?重复的(?:请求|礼貌)(?:用词|措辞)$/u;
const instructionScopeClause = /^(?:(?:润色|校对)(?:正文|文本)?)$/u;
const instructionPreservationClause = /^(?:请[ \t]*)?(?:(?:保留|保持|维持)(?:原样)?(?:金额|数字|事实|原意|核对事项|日期|人名|名称|负责人|项目名称|格式|结构|语法)(?:(?:和|、)(?:金额|数字|事实|原意|核对事项|日期|人名|名称|负责人|项目名称|格式|结构|语法))*|(?:不|不要|不得)(?:添加|新增|修改|改动|改变)(?:任何)?(?:事实|内容|原意|数字|金额|名称|日期|负责人|结构|格式))$/u;

export interface ProseRequestMarkerProofScope { readonly [scopeBrand]: true; readonly taskRange: Range; }
export interface ProseRequestMarkerSourceProof { readonly [sourceProofBrand]: true; readonly slotId: string; }
export interface ProseRequestMarkerBoundProof { readonly [boundProofBrand]: true; }
export type ProseRequestMarkerProof = ProseRequestMarkerSourceProof | ProseRequestMarkerBoundProof;

interface ParsedScope {
  paragraphs: Range[];
  protected: Range[];
  quotes: Range[];
  quoteUncertain: boolean;
  frontMatter?: Range;
}

interface QuoteScan { ranges: Range[]; uncertain: boolean; }
interface Authorization { allowed: boolean; origin: "explicit-delete" | "routine-style"; }

class ScopeImpl implements ProseRequestMarkerProofScope {
  readonly [scopeBrand] = true as const;
  parsed: ParsedScope | null | undefined;
  readonly sourceProofs = new Set<SourceProofImpl>();
  readonly boundProofs = new Set<BoundProofImpl>();
  readonly taskRange: Range;

  constructor(readonly document: string, taskRange: Range, readonly authorization: Authorization) {
    this.taskRange = Object.freeze({ ...taskRange });
  }
}

class SourceProofImpl implements ProseRequestMarkerSourceProof {
  readonly [sourceProofBrand] = true as const;
  constructor(readonly scope: ScopeImpl, readonly slotId: string, readonly sourceRange: Range,
    readonly sourceMarkerRange: Range, readonly sourceText: string, readonly candidateText: string,
    readonly markerOffset: number) {
    Object.freeze(this.sourceRange);
    Object.freeze(this.sourceMarkerRange);
    Object.freeze(this);
  }

  get sourceDocument(): string { return this.scope.document; }
}

class BoundProofImpl implements ProseRequestMarkerBoundProof {
  readonly [boundProofBrand] = true as const;
  constructor(readonly sourceProof: SourceProofImpl, readonly candidateDocument: string,
    readonly candidateRange: Range, readonly candidateMarkerRange: Range) {
    Object.freeze(this.candidateRange);
    Object.freeze(this.candidateMarkerRange);
    Object.freeze(this);
  }
}

function validRange(range: Range, length: number): boolean {
  return Number.isSafeInteger(range.from) && Number.isSafeInteger(range.to) && range.from >= 0 && range.from <= range.to && range.to <= length;
}

function quotePairs(): { open: Map<string, string>; close: Map<string, string>; symmetric: Set<string> } {
  const entries: Array<[string, string]> = [["“", "”"], ["‘", "’"], ["「", "」"], ["『", "』"], ["«", "»"]];
  return { open: new Map(entries), close: new Map(entries.map(([left, right]) => [right, left])), symmetric: new Set(["\"", "'"]) };
}

/** A single bounded scan; unmatched or excessive quoting disables only this proof. */
function scanQuotes(source: string, ignored: readonly Range[] = []): QuoteScan {
  const pairs = quotePairs();
  const stack: Array<{ close: string; from: number }> = [];
  const ranges: Range[] = [];
  let ignoredIndex = 0;
  let backslashParity = 0;
  let backslashRun = 0;
  for (let index = 0; index < source.length; index += 1) {
    while (ignoredIndex < ignored.length && ignored[ignoredIndex]!.to <= index) ignoredIndex += 1;
    const skip = ignored[ignoredIndex];
    if (skip && skip.from <= index && index < skip.to) { index = skip.to - 1; backslashParity = 0; backslashRun = 0; continue; }
    const char = source[index]!;
    if (char === "\\") {
      backslashRun += 1;
      backslashParity ^= 1;
      if (backslashRun > MAX_BACKSLASH_RUN) return { ranges, uncertain: true };
      continue;
    }
    const escaped = backslashParity === 1;
    backslashParity = 0;
    backslashRun = 0;
    if (escaped || (char === "'" && /[\p{Script=Latin}\p{N}]/u.test(source[index - 1] ?? "") && /[\p{Script=Latin}\p{N}]/u.test(source[index + 1] ?? ""))) continue;
    if (pairs.symmetric.has(char)) {
      if (stack.at(-1)?.close === char) {
        const open = stack.pop()!;
        ranges.push({ from: open.from, to: index + 1 });
      } else stack.push({ close: char, from: index });
    } else if (pairs.open.has(char)) {
      stack.push({ close: pairs.open.get(char)!, from: index });
    } else if (pairs.close.has(char)) {
      if (stack.at(-1)?.close !== char) return { ranges, uncertain: true };
      const open = stack.pop()!;
      ranges.push({ from: open.from, to: index + 1 });
    }
    if (stack.length > MAX_QUOTE_DEPTH || ranges.length > MAX_QUOTE_RANGES) return { ranges, uncertain: true };
  }
  for (const open of stack) ranges.push({ from: open.from, to: source.length });
  return { ranges, uncertain: false };
}

function instructionAllowsDuplicatePlease(instruction: string): boolean {
  if (!instruction || instruction.length > MAX_INSTRUCTION_CHARS) return false;
  if (/[?？]/u.test(instruction)) return false;
  const quoteScan = scanQuotes(instruction);
  if (quoteScan.uncertain) return false;
  const statements = [...instruction.matchAll(/[^;；。！？\r\n]+/gu)];
  let positiveCount = 0;
  for (const match of statements) {
    const statement = match[0].trim();
    if (/[?？]/u.test(statement) || quoteScan.ranges.length) return false;
    // Preservation constraints are allowlisted independently. Any added edit
    // verb, explanation, condition, or vague language makes the authorization
    // ambiguous and leaves the ordinary fact guard unchanged.
    const clauses = instructionPositiveClause.test(statement) ? [statement] : statement.split(/[，,]/u).map(part => part.trim()).filter(Boolean);
    if (!clauses.length) return false;
    for (const clause of clauses) {
      if (instructionPositiveClause.test(clause)) { positiveCount += 1; continue; }
      if (instructionScopeClause.test(clause) || instructionPreservationClause.test(clause)) continue;
      return false;
    }
  }
  return positiveCount === 1;
}

function normalizeLineEndings(source: string): { text: string; toSourceOffset(offset: number): number } {
  if (!source.includes("\r")) return { text: source, toSourceOffset: offset => offset };
  let text = "";
  const crlfEnds: number[] = [];
  for (let index = 0; index < source.length; index += 1) {
    if (source[index] === "\r") {
      text += "\n";
      if (source[index + 1] === "\n") { index += 1; crlfEnds.push(text.length); }
    } else text += source[index];
  }
  return { text, toSourceOffset(offset) {
    let low = 0, high = crlfEnds.length;
    while (low < high) {
      const middle = low + ((high - low) >> 1);
      if (crlfEnds[middle]! <= offset) low = middle + 1;
      else high = middle;
    }
    return offset + low;
  } };
}

function frontMatterRange(source: string): Range | undefined {
  const opening = /^---[ \t]*(?:\r\n|\r|\n)/u.exec(source);
  if (!opening) return undefined;
  let lineStart = opening[0].length;
  while (lineStart <= source.length) {
    let lineEnd = lineStart;
    while (lineEnd < source.length && source[lineEnd] !== "\r" && source[lineEnd] !== "\n") lineEnd += 1;
    if (/^(?:---|\.\.\.)[ \t]*$/u.test(source.slice(lineStart, lineEnd))) {
      let to = lineEnd;
      if (source[to] === "\r" && source[to + 1] === "\n") to += 2;
      else if (to < source.length) to += 1;
      return { from: 0, to };
    }
    if (lineEnd === source.length) return { from: 0, to: source.length };
    lineStart = source[lineEnd] === "\r" && source[lineEnd + 1] === "\n" ? lineEnd + 2 : lineEnd + 1;
  }
  return { from: 0, to: source.length };
}

function overlap(left: Range, right: Range): boolean { return left.from < right.to && right.from < left.to; }

function analyzeDocument(source: string): ParsedScope | null {
  try {
    const normalized = normalizeLineEndings(source);
    const cursor = markdownParser.parse(normalized.text).cursor();
    const paragraphs: Range[] = [];
    const protectedRanges: Range[] = [];
    let nodes = 0;
    const visit = (depth: number, blockedAncestor: boolean): void => {
      nodes += 1;
      if (nodes > MAX_AST_NODES || depth > MAX_AST_DEPTH) throw new Error("AST budget");
      const name = cursor.name;
      const range = { from: normalized.toSourceOffset(cursor.from), to: normalized.toSourceOffset(cursor.to) };
      const block = blockedBlockNodes.has(name);
      if (name === "Paragraph" && !blockedAncestor) {
        const raw = source.slice(range.from, range.to);
        if (/<\/?[A-Za-z!][^>]*>/u.test(raw) || raw.includes("$") || raw.includes("\\(") || raw.includes("\\[") || raw.includes("\\)") || raw.includes("\\]")) {
          protectedRanges.push(range);
        } else paragraphs.push(range);
      }
      if (block || blockedInlineNodes.has(name)) protectedRanges.push(range);
      if (cursor.firstChild()) {
        do { visit(depth + 1, blockedAncestor || block); } while (cursor.nextSibling());
        cursor.parent();
      }
    };
    visit(0, false);
    const quoteScan = scanQuotes(source, protectedRanges);
    const merge = (ranges: Range[]) => {
      const sorted = ranges.sort((a, b) => a.from - b.from || a.to - b.to);
      const merged: Range[] = [];
      for (const range of sorted) {
        const previous = merged.at(-1);
        if (!previous || range.from > previous.to) merged.push({ ...range });
        else previous.to = Math.max(previous.to, range.to);
      }
      return merged;
    };
    return { paragraphs: paragraphs.sort((a, b) => a.from - b.from || a.to - b.to), protected: merge(protectedRanges),
      quotes: merge(quoteScan.ranges), quoteUncertain: quoteScan.uncertain,
      frontMatter: frontMatterRange(source) };
  } catch {
    return null;
  }
}

function includesRange(ranges: readonly Range[], target: Range): boolean {
  let low = 0, high = ranges.length;
  while (low < high) {
    const middle = low + ((high - low) >> 1);
    if (ranges[middle]!.to <= target.from) low = middle + 1;
    else high = middle;
  }
  const range = ranges[low];
  return Boolean(range && overlap(range, target));
}

function eligibleRequestMarker(sourceText: string): number | undefined {
  const matches = [...sourceText.matchAll(repeatedPleaseAtClauseStart)];
  if (matches.length !== 1) return undefined;
  const match = matches[0]!;
  const prefixStart = (match.index ?? 0) + match[0].length - 2;
  const after = sourceText.slice(prefixStart + 2);
  if (!requestTail.test(after)) return undefined;
  const deleteAt = prefixStart + 1;
  const candidate = sourceText.slice(0, deleteAt) + sourceText.slice(deleteAt + 1);
  return candidate.length === sourceText.length - 1 ? deleteAt : undefined;
}

function hasRequestBoundary(document: string, phraseStart: number): boolean {
  let cursor = phraseStart;
  while (cursor > 0 && (document[cursor - 1] === " " || document[cursor - 1] === "\t")) cursor -= 1;
  return cursor === 0 || /[。！？；，、：\r\n]/u.test(document[cursor - 1] ?? "");
}

function sameRange(left: Range, right: Range): boolean { return left.from === right.from && left.to === right.to; }

export function prepareProseRequestMarkerProofScope(input: {
  instruction: string;
  document: string;
  taskRange: Range;
  taskSource: string;
}): ProseRequestMarkerProofScope {
  const rangeValid = validRange(input.taskRange, input.document.length) && input.document.slice(input.taskRange.from, input.taskRange.to) === input.taskSource;
  const authorization = { allowed: rangeValid && instructionAllowsDuplicatePlease(input.instruction) && isWithinMarkdownAstByteBudget(input.document), origin: "explicit-delete" as const };
  return new ScopeImpl(input.document, input.taskRange, authorization);
}

/** Creates the separate routine-style scope without pretending the user explicitly requested marker deletion. */
export function prepareRoutineStyleRequestMarkerProofScope(input: RoutineStyleAuthorizationInput): ProseRequestMarkerProofScope | undefined {
  if (!authorizeRoutineStyleRequestMarkerRepair(input) || !isWithinMarkdownAstByteBudget(input.document)) return undefined;
  return new ScopeImpl(input.document, input.taskRange, { allowed: true, origin: "routine-style" });
}

export function createProseRequestMarkerSourceProof(scope: ProseRequestMarkerProofScope, slotId: string,
  sourceRange: Range, sourceText: string, candidateText: string): ProseRequestMarkerSourceProof | undefined {
  if (!(scope instanceof ScopeImpl) || !scope.authorization.allowed || !slotId || scope.sourceProofs.size >= MAX_PROOFS_PER_TASK) return undefined;
  if (!validRange(sourceRange, scope.document.length) || sourceRange.from < scope.taskRange.from || sourceRange.to > scope.taskRange.to ||
      scope.document.slice(sourceRange.from, sourceRange.to) !== sourceText) return undefined;
  const markerOffset = eligibleRequestMarker(sourceText);
  if (markerOffset === undefined || sourceText.slice(0, markerOffset) + sourceText.slice(markerOffset + 1) !== candidateText) return undefined;
  if (!hasRequestBoundary(scope.document, sourceRange.from + markerOffset - 1)) return undefined;
  const sourceMarkerRange = { from: sourceRange.from + markerOffset, to: sourceRange.from + markerOffset + 1 };
  const parsed = scope.parsed === undefined ? (scope.parsed = analyzeDocument(scope.document)) : scope.parsed;
  if (!parsed || parsed.quoteUncertain || (parsed.frontMatter && overlap(parsed.frontMatter, sourceMarkerRange)) ||
      includesRange(parsed.protected, sourceMarkerRange) || includesRange(parsed.quotes, sourceMarkerRange)) return undefined;
  const paragraphs = parsed.paragraphs.filter(range => range.from <= sourceMarkerRange.from && sourceMarkerRange.to <= range.to);
  if (paragraphs.length !== 1 || paragraphs[0]!.from < scope.taskRange.from || paragraphs[0]!.to > scope.taskRange.to) return undefined;
  const proof = new SourceProofImpl(scope, slotId, sourceRange, sourceMarkerRange, sourceText, candidateText, markerOffset);
  if ([...scope.sourceProofs].some(existing => overlap(existing.sourceRange, proof.sourceRange))) return undefined;
  scope.sourceProofs.add(proof);
  return proof;
}

/** Suggests only the source-derived deletion already proven by the marker policy. */
export function suggestProseRequestMarkerSourceRepair(scope: ProseRequestMarkerProofScope, slotId: string,
  sourceRange: Range, sourceText: string): { text: string; proof: ProseRequestMarkerSourceProof } | undefined {
  if (!(scope instanceof ScopeImpl) || scope.authorization.origin !== "routine-style") return undefined;
  const markerOffset = eligibleRequestMarker(sourceText);
  if (markerOffset === undefined) return undefined;
  const text = sourceText.slice(0, markerOffset) + sourceText.slice(markerOffset + 1);
  const proof = createProseRequestMarkerSourceProof(scope, slotId, sourceRange, sourceText, text);
  return proof ? { text, proof } : undefined;
}

export function bindProseRequestMarkerProofs(sourceProofs: readonly ProseRequestMarkerSourceProof[], input: {
  fullSource: string;
  fullCandidate: string;
  sourceSlotRanges: ReadonlyMap<string, Range>;
  candidateSlotRanges: ReadonlyMap<string, Range>;
  candidateTaskRange: Range;
}): readonly ProseRequestMarkerBoundProof[] | undefined {
  if (!sourceProofs.length || sourceProofs.length > MAX_PROOFS_PER_TASK) return undefined;
  const implementations = sourceProofs.filter((proof): proof is SourceProofImpl => proof instanceof SourceProofImpl);
  if (implementations.length !== sourceProofs.length) return undefined;
  const scope = implementations[0]!.scope;
  if (implementations.some(proof => proof.scope !== scope || !scope.sourceProofs.has(proof) ||
      [...scope.boundProofs].some(existing => existing.sourceProof === proof)) ||
      input.fullSource !== scope.document || !validRange(input.candidateTaskRange, input.fullCandidate.length) ||
      input.candidateTaskRange.from !== scope.taskRange.from) return undefined;
  const bound: BoundProofImpl[] = [];
  for (const proof of implementations) {
    const sourceSlotRange = input.sourceSlotRanges.get(proof.slotId);
    const candidateRange = input.candidateSlotRanges.get(proof.slotId);
    if (!sourceSlotRange || !candidateRange || !sameRange(sourceSlotRange, proof.sourceRange) ||
        !validRange(candidateRange, input.fullCandidate.length) || candidateRange.from < input.candidateTaskRange.from ||
        candidateRange.to > input.candidateTaskRange.to || input.fullSource.slice(proof.sourceRange.from, proof.sourceRange.to) !== proof.sourceText ||
        input.fullCandidate.slice(candidateRange.from, candidateRange.to) !== proof.candidateText ||
        proof.sourceText.slice(0, proof.markerOffset) + proof.sourceText.slice(proof.markerOffset + 1) !== proof.candidateText) return undefined;
    const candidateMarkerRange = { from: candidateRange.from + proof.markerOffset - 1, to: candidateRange.from + proof.markerOffset };
    if (input.fullSource.slice(proof.sourceMarkerRange.from, proof.sourceMarkerRange.to) !== "请" ||
        input.fullSource.slice(proof.sourceMarkerRange.from - 1, proof.sourceMarkerRange.from) !== "请" ||
        input.fullCandidate.slice(candidateMarkerRange.from, candidateMarkerRange.to) !== "请") return undefined;
    bound.push(new BoundProofImpl(proof, input.fullCandidate, candidateRange, candidateMarkerRange));
  }
  const ordered = [...bound].sort((a, b) => a.sourceProof.sourceRange.from - b.sourceProof.sourceRange.from);
  for (let index = 1; index < ordered.length; index += 1) {
    const before = ordered[index - 1]!;
    const after = ordered[index]!;
    if (overlap(before.sourceProof.sourceRange, after.sourceProof.sourceRange) || overlap(before.candidateRange, after.candidateRange)) return undefined;
  }
  for (const proof of bound) scope.boundProofs.add(proof);
  return Object.freeze(bound);
}

/** Returns only the source-side name text that a runtime-issued proof authorizes normalizing. */
export function normalizeProseRequestMarkerAnchorSource(source: string, replacement: string,
  proofs: readonly ProseRequestMarkerProof[] | undefined, stage: "slot" | "full-document" | undefined): string | undefined {
  if (!proofs?.length) return undefined;
  if (proofs.length === 1 && proofs[0] instanceof SourceProofImpl) {
    if (stage !== "slot") return undefined;
    const proof = proofs[0];
    if (!proof.scope.sourceProofs.has(proof) || source !== proof.sourceText || replacement !== proof.candidateText ||
        proof.scope.document.slice(proof.sourceRange.from, proof.sourceRange.to) !== source ||
        source.slice(proof.markerOffset, proof.markerOffset + 1) !== "请") return undefined;
    return source.slice(0, proof.markerOffset) + source.slice(proof.markerOffset + 1);
  }
  const bound = proofs.filter((proof): proof is BoundProofImpl => proof instanceof BoundProofImpl);
  if (stage !== "full-document" || bound.length !== proofs.length || !bound.length) return undefined;
  const scope = bound[0]!.sourceProof.scope;
  if (bound.some(proof => proof.sourceProof.scope !== scope || !scope.boundProofs.has(proof) ||
      proof.candidateDocument !== replacement || proof.sourceProof.sourceDocument !== source)) return undefined;
  const ordered = [...bound].sort((a, b) => a.sourceProof.sourceMarkerRange.from - b.sourceProof.sourceMarkerRange.from);
  for (let index = 0; index < ordered.length; index += 1) {
    const proof = ordered[index]!;
    const sourceProof = proof.sourceProof;
    if (source !== scope.document || source.slice(sourceProof.sourceRange.from, sourceProof.sourceRange.to) !== sourceProof.sourceText ||
        source.slice(sourceProof.sourceMarkerRange.from, sourceProof.sourceMarkerRange.to) !== "请" ||
        source.slice(sourceProof.sourceMarkerRange.from - 1, sourceProof.sourceMarkerRange.from) !== "请" ||
        replacement.slice(proof.candidateRange.from, proof.candidateRange.to) !== sourceProof.candidateText ||
        replacement.slice(proof.candidateMarkerRange.from, proof.candidateMarkerRange.to) !== "请") return undefined;
    if (index && (overlap(ordered[index - 1]!.sourceProof.sourceRange, sourceProof.sourceRange) ||
        overlap(ordered[index - 1]!.candidateRange, proof.candidateRange))) return undefined;
  }
  let normalized = source;
  for (const proof of [...ordered].reverse()) {
    const { from, to } = proof.sourceProof.sourceMarkerRange;
    normalized = normalized.slice(0, from) + normalized.slice(to);
  }
  return normalized;
}
