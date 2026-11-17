import type { AiPlannedChunk } from "./aiChunkPlanner";
import { readIntentHeadingRanges } from "./intentTargets";
import { splitMarkdownSentences as splitSummarySentences } from "./markdownSentenceBoundaries";
import { isSummaryControlMarker, renderValidatedSummaryFacts } from "./summaryPresentationPolicy";

export type SummaryFactCategory =
  | "decision"
  | "risk"
  | "constraint"
  | "metric"
  | "owner"
  | "date"
  | "amount"
  | "action"
  | "claim"
  | "status"
  | "other";

export interface SummaryFactCandidate {
  id: string;
  range: { from: number; to: number };
  quote: string;
  category: SummaryFactCategory;
  /** All deterministic fact dimensions present in this exact source sentence. */
  facets: readonly SummaryFactCategory[];
  /** Parent Markdown headings, grounded in the source AST and exact heading ranges. */
  sectionPath: readonly SummarySectionHeading[];
  required: boolean;
  /** Diagnostic provenance only; deliberately excluded from the stable ID. */
  chunkIndex: number;
}

export interface SummaryFactLedgerEntry extends SummaryFactCandidate {
  includedBy: "required" | "selected";
}

type SourceSpan = { from: number; to: number };
type ChunkInput = Pick<AiPlannedChunk, "index" | "text" | "ownedRange">;

export interface SummarySectionHeading {
  text: string;
  level: number;
  range: SourceSpan;
}

export interface SummarySectionIndex {
  readonly headings: readonly SummarySectionHeading[];
}

interface IndexedSectionHeading {
  heading: SummarySectionHeading;
  path: readonly SummarySectionHeading[];
}

interface IndexedSectionSource {
  source: string;
  headings: readonly IndexedSectionHeading[];
}

const MAX_FACTS = 256;
const MAX_QUOTE_BYTES = 512;
const MAX_LEDGER_BYTES = 256 * 1024;
const utf8Encoder = new TextEncoder();
const sectionIndexSources = new WeakMap<SummarySectionIndex, IndexedSectionSource>();
const EMPTY_SECTION_PATH: readonly SummarySectionHeading[] = Object.freeze([]);

const FACET_ORDER: readonly SummaryFactCategory[] = [
  "decision", "risk", "constraint", "metric", "owner", "date", "amount", "action", "claim", "status"
];
const CATEGORY_PRIORITY: readonly SummaryFactCategory[] = [
  "decision", "risk", "constraint", "metric", "owner", "date", "amount", "action", "claim", "status", "other"
];

const DECISION = /(?:决定|决策|结论是|最终选择|选择采用|决定采用|采用|选用|定为|decision|decided|concluded|selected|adopted|will\s+use)/iu;
const RISK = /(?:风险|隐患|故障|阻塞|失败|问题|risk|blocker|failure|issue)/iu;
const CONSTRAINT = /(?:必须|不得|不能|不可|禁止|仅限|仅可|不超过|至少|最多|上限|下限|要求|限制|must(?:\s+not)?|cannot|only|no\s+more\s+than|at\s+least|constraint|limit)/iu;
const METRIC = /(?:指标|提升|下降|增长|减少|占比|成功率|耗时|性能|成本|metric|rate|latency|throughput|increased|decreased|improved|reduced|grew|cost)/iu;
const OWNER = /(?:负责人|由[\p{L}\p{N}_-]{1,24}(?:负责|完成|交付|执行|维护|跟进)|[\p{L}\p{N}_-]{1,24}负责|owner|assigned\s+to|led\s+by)/iu;
const STATUS = /(?:状态|进度|\bstatus\b|\bprogress\b)\s*(?:为|是|[:：=]|is\b)\s*[^，,。；;\n]+/iu;
const DATE = /(?:\b(?:19|20)\d{2}[-/.年]\d{1,2}(?:[-/.月]\d{1,2}日?)?|\b\d{1,2}月\d{1,2}日|\bQ[1-4]\s*20\d{2}\b|截止|截至|deadline|due\s+(?:on|by)|\b(?:Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday)\b)/iu;
const AMOUNT = /(?:\d+(?:[,.]\d+)?\s*(?:%|％|元|万元|亿元|美元|人民币|USD|CNY|RMB|MB|GB|TB|ms|毫秒|秒|分钟|小时|天|人|项|次|件|台|份)|预算|费用|金额|成本|总计|共计|budget|amount|cost|total)/iu;
const NO_DECISION = /(?:(?:没有|无|并无|尚无|暂无|未有|尚未|还未|未曾|未能|未作出|未形成|未确定|未决定|未确认|不确定)\s*(?:(?:新增|新的?|明确|正式|最终|作出|形成|做出|确认|的)\s*)*(?:决策|决定|结论|方案|采用|选用|使用)|(?:没有|尚未|还未|未|仍未)\s*决定\s*是否)/iu;
const ACTION = /(?:下一步|后续|待办|计划|需要|将(?:由|在|于)?|完成|交付|执行|实施|开发|部署|迁移|修复|发布|检查|验证|跟进|负责|action\s+item|next\s+step|plan(?:ned)?\s+to|will\s+(?:complete|deliver|run|deploy|fix|release|check|verify|migrate)|must\s+(?:complete|deliver|run|deploy|fix|release|check|verify))/iu;
const CLAIM = /(?:表明|显示|证明|发现|确认|报告指出|认为|研究结果|finds?|shows?|indicates?|confirms?|reports?\s+that|according\s+to)/iu;
const REQUIRED_DATE_VALUE = /(?:\b(?:19|20)\d{2}[-/.年]\d{1,2}(?:[-/.月]\d{1,2}日?)?|\b\d{1,2}月\d{1,2}日|\bQ[1-4]\s*20\d{2}\b|\b(?:Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday)\b)/iu;
const REQUIRED_AMOUNT_VALUE = /(?:\d+(?:[,.]\d+)?\s*(?:%|％|元|万元|亿元|美元|人民币|USD|CNY|RMB|MB|GB|TB|ms|毫秒|秒|分钟|小时|天|人|项|次|件|台|份)|(?:预算|费用|金额|成本|总计|共计|budget|amount|cost|total)\s*(?:为|[:=])?\s*\d)/iu;
const QUANTIFIED_VALUE = /\d+(?:[,.]\d+)?\s*(?:%|％|百分点|倍|元|万元|亿元|美元|人民币|USD|CNY|RMB|MB|GB|TB|ms|毫秒|秒|分钟|小时|天|人|项|次|件|台|份)/iu;

/** Builds an immutable AST-backed heading index that is bound to this exact source string. */
export function buildSummarySectionIndex(source: string): SummarySectionIndex {
  const stack: SummarySectionHeading[] = [];
  const indexedHeadings: IndexedSectionHeading[] = readIntentHeadingRanges(source).map(({ text, level, from, to }) => {
    while (stack.length && stack[stack.length - 1].level >= level) stack.pop();
    const heading = Object.freeze({ text, level, range: Object.freeze({ from, to }) });
    stack.push(heading);
    return Object.freeze({ heading, path: Object.freeze([...stack]) });
  });
  const index = Object.freeze({ headings: Object.freeze(indexedHeadings.map(({ heading }) => heading)) });
  sectionIndexSources.set(index, { source, headings: Object.freeze(indexedHeadings) });
  return index;
}

function sectionPathAt(source: string, index: SummarySectionIndex, position: number): readonly SummarySectionHeading[] {
  const indexed = sectionIndexSources.get(index);
  if (!indexed || indexed.source !== source) throw new Error("摘要章节索引与当前原文不一致。");
  let low = 0;
  let high = indexed.headings.length;
  while (low < high) {
    const middle = (low + high) >> 1;
    if (indexed.headings[middle].heading.range.from <= position) low = middle + 1;
    else high = middle;
  }
  return low ? indexed.headings[low - 1].path : EMPTY_SECTION_PATH;
}

function sameSectionPath(a: readonly SummarySectionHeading[], b: readonly SummarySectionHeading[]): boolean {
  return a.length === b.length && a.every((heading, index) => {
    const other = b[index];
    return heading.text === other.text && heading.level === other.level
      && heading.range.from === other.range.from && heading.range.to === other.range.to;
  });
}

function spanText(source: string, span: SourceSpan): string {
  return source.slice(span.from, span.to);
}

function trimSpan(source: string, from: number, to: number): SourceSpan | undefined {
  let start = from;
  let end = to;
  while (start < end && /\s/u.test(source[start])) start += 1;
  while (end > start && /\s/u.test(source[end - 1])) end -= 1;
  return start < end ? { from: start, to: end } : undefined;
}

function readLines(source: string, from: number, to: number): SourceSpan[] {
  const lines: SourceSpan[] = [];
  let start = from;
  while (start < to) {
    let end = start;
    while (end < to && source[end] !== "\r" && source[end] !== "\n") end += 1;
    if (end < to && source[end] === "\r" && source[end + 1] === "\n") end += 2;
    else if (end < to) end += 1;
    lines.push({ from: start, to: end });
    start = end;
  }
  if (from === to) return [];
  return lines;
}

function isBlank(source: string, span: SourceSpan): boolean {
  return /^\s*$/u.test(spanText(source, span));
}

function isHeading(source: string, span: SourceSpan): boolean {
  return /^\s{0,3}#{1,6}[ \t]+/u.test(spanText(source, span));
}

function isListItem(source: string, span: SourceSpan): boolean {
  return /^\s{0,3}(?:[-+*]|\d+[.)])[ \t]+/u.test(spanText(source, span));
}

function isTableRow(source: string, span: SourceSpan): boolean {
  const line = spanText(source, span).trim();
  return line.startsWith("|") && line.endsWith("|");
}

function isTableSeparator(source: string, span: SourceSpan): boolean {
  const line = spanText(source, span).trim();
  return /^\|?[ \t]*:?-{3,}:?[ \t]*(?:\|[ \t]*:?-{3,}:?[ \t]*)+\|?$/u.test(line);
}

function paragraphRanges(source: string, range: SourceSpan): SourceSpan[] {
  const result: SourceSpan[] = [];
  let start: number | undefined;
  let end = range.from;
  let fence: { marker: "`" | "~"; size: number } | undefined;
  for (const line of readLines(source, range.from, range.to)) {
    const content = spanText(source, line).trimStart();
    const marker = /^(?:```+|~~~+)/u.exec(content)?.[0];
    if (fence) {
      end = line.to;
      if (marker && marker[0] === fence.marker && marker.length >= fence.size) {
        fence = undefined;
        result.push({ from: start ?? line.from, to: end });
        start = undefined;
      }
      continue;
    }
    if (marker) {
      if (start !== undefined) result.push({ from: start, to: end });
      start = line.from;
      end = line.to;
      fence = { marker: marker[0] as "`" | "~", size: marker.length };
      continue;
    }
    if (isHeading(source, line)) {
      if (start !== undefined) result.push({ from: start, to: end });
      start = undefined;
      continue;
    }
    if (isBlank(source, line)) {
      if (start !== undefined) result.push({ from: start, to: end });
      start = undefined;
      continue;
    }
    if (start === undefined) start = line.from;
    end = line.to;
  }
  if (start !== undefined) result.push({ from: start, to: end });
  return result;
}

function factSpans(source: string, range: SourceSpan): SourceSpan[] {
  const result: SourceSpan[] = [];
  for (const paragraph of paragraphRanges(source, range)) {
    const lines = readLines(source, paragraph.from, paragraph.to).filter((line) => !isBlank(source, line));
    if (!lines.length) continue;
    const firstLine = spanText(source, lines[0]).trim();

    if (/^(?:```+|~~~+)/u.test(firstLine)) {
      const span = trimSpan(source, paragraph.from, paragraph.to);
      if (span) result.push(span);
      continue;
    }

    const structured = lines.some((line) => isListItem(source, line) || isTableRow(source, line));
    if (structured) {
      for (const line of lines) {
        if (isTableSeparator(source, line)) continue;
        const trimmed = trimSpan(source, line.from, line.to);
        if (!trimmed || isHeading(source, trimmed)) continue;
        result.push(...splitSummarySentences(source, trimmed).filter((span) => !isSummaryControlMarker(spanText(source, span))));
      }
      continue;
    }

    const span = trimSpan(source, paragraph.from, paragraph.to);
    if (span) result.push(...splitSummarySentences(source, span).filter((sentence) => !isSummaryControlMarker(spanText(source, sentence))));
  }
  return result;
}

interface Classification {
  category: SummaryFactCategory;
  facets: SummaryFactCategory[];
  required: boolean;
}

function classifyFact(quote: string): Classification {
  const facets = FACET_ORDER.filter((facet) => {
    switch (facet) {
      case "decision": return DECISION.test(quote);
      case "risk": return RISK.test(quote);
      case "constraint": return CONSTRAINT.test(quote);
      case "metric": return METRIC.test(quote);
      case "owner": return OWNER.test(quote);
      case "date": return DATE.test(quote);
      case "amount": return AMOUNT.test(quote);
      case "action": return ACTION.test(quote);
      case "claim": return CLAIM.test(quote);
      case "status": return STATUS.test(quote);
      default: return false;
    }
  });
  const category = CATEGORY_PRIORITY.find((candidate) => facets.includes(candidate)) ?? "other";
  const affirmativeDecision = quote.split(/[,，;；。！？!?]|但是|但|不过|\s+but\s+/iu)
    .some((clause) => DECISION.test(clause) && !NO_DECISION.test(clause));
  const required = (facets.includes("decision") && affirmativeDecision) || facets.includes("owner") || facets.includes("status")
    || (facets.includes("date") && REQUIRED_DATE_VALUE.test(quote))
    || (facets.includes("amount") && REQUIRED_AMOUNT_VALUE.test(quote))
    || (facets.includes("metric") && QUANTIFIED_VALUE.test(quote));
  return { category, facets, required };
}

function candidateId(range: SourceSpan, category: SummaryFactCategory): string {
  return `sf:${range.from}:${range.to}:${category}`;
}

function factKey(candidate: Pick<SummaryFactCandidate, "quote" | "category" | "facets" | "sectionPath">): string {
  const path = candidate.sectionPath.map(({ text, level, range }) => [text, level, range.from, range.to]);
  return JSON.stringify([candidate.quote, candidate.category, candidate.facets, path]);
}

function utf8ByteLength(text: string): number {
  return utf8Encoder.encode(text).byteLength;
}

function earlierSpan(a: SummaryFactCandidate, b: SummaryFactCandidate): SummaryFactCandidate {
  return a.range.from <= b.range.from ? a : b;
}

function isCategory(value: unknown): value is SummaryFactCategory {
  return typeof value === "string" && CATEGORY_PRIORITY.includes(value as SummaryFactCategory);
}

function validateCandidate(source: string, candidate: SummaryFactCandidate, sectionIndex: SummarySectionIndex): void {
  const { range, quote } = candidate;
  if (!range || !Number.isInteger(range.from) || !Number.isInteger(range.to)
    || range.from < 0 || range.to <= range.from || range.to > source.length
    || source.slice(range.from, range.to) !== quote) {
    throw new Error("摘要事实候选与原文 source range 证据不一致。");
  }
  if (utf8ByteLength(quote) > MAX_QUOTE_BYTES) {
    throw new Error("单条摘要事实超过 512 字节，无法在保留完整关系的前提下处理；请缩小范围。原文未修改。");
  }
  if (!isCategory(candidate.category) || candidate.id !== candidateId(range, candidate.category)) {
    throw new Error("摘要事实候选 ID 或 category 与原文证据不一致。");
  }
  if (!Number.isInteger(candidate.chunkIndex) || candidate.chunkIndex < 0) {
    throw new Error("摘要事实候选缺少有效的 chunk index 证据。");
  }
  if (!Array.isArray(candidate.sectionPath)
    || !sameSectionPath(candidate.sectionPath, sectionPathAt(source, sectionIndex, range.from))) {
    throw new Error("摘要事实章节路径与原文 AST 标题证据不一致。");
  }
  const classification = classifyFact(quote);
  if (classification.category !== candidate.category
    || classification.required !== candidate.required
    || classification.facets.join("|") !== candidate.facets.join("|")) {
    throw new Error("摘要事实候选分类与原文证据不一致。");
  }
}

/** Extracts quote-backed summary facts only from a chunk's exclusively owned source range. */
export function buildSummaryCandidates(
  source: string,
  chunk: ChunkInput,
  sectionIndex: SummarySectionIndex = buildSummarySectionIndex(source)
): SummaryFactCandidate[] {
  if (sectionIndexSources.get(sectionIndex)?.source !== source) {
    throw new Error("摘要章节索引与当前原文不一致。");
  }
  const ownedRange = chunk.ownedRange;
  if (!chunk.text && !ownedRange) return [];
  if (!ownedRange || !Number.isInteger(ownedRange.from) || !Number.isInteger(ownedRange.to)
    || ownedRange.from < 0 || ownedRange.to < ownedRange.from || ownedRange.to > source.length
    || source.slice(ownedRange.from, ownedRange.to) !== chunk.text) {
    throw new Error("摘要分段缺少与原文一致的 ownedRange/source evidence。");
  }
  if (!Number.isInteger(chunk.index) || chunk.index < 0) {
    throw new Error("摘要分段缺少有效的 chunk index。");
  }
  if (ownedRange.from === ownedRange.to) return [];

  const uniqueByFact = new Map<string, SummaryFactCandidate>();
  for (const range of factSpans(source, ownedRange)) {
    const quote = spanText(source, range);
    if (utf8ByteLength(quote) > MAX_QUOTE_BYTES) {
      throw new Error("单条摘要事实超过 512 字节，无法在保留完整关系的前提下处理；请缩小范围。原文未修改。");
    }
    const classification = classifyFact(quote);
    const candidate: SummaryFactCandidate = {
      id: candidateId(range, classification.category),
      range,
      quote,
      category: classification.category,
      facets: classification.facets,
      sectionPath: sectionPathAt(source, sectionIndex, range.from),
      required: classification.required,
      chunkIndex: chunk.index
    };
    const key = factKey(candidate);
    if (!uniqueByFact.has(key)) uniqueByFact.set(key, candidate);
  }
  return [...uniqueByFact.values()];
}

/** Merges model-selected IDs with every required source fact after revalidating evidence. */
export function mergeSummaryFactLedger(
  source: string,
  candidates: readonly SummaryFactCandidate[],
  selectedIds: readonly string[]
): SummaryFactLedgerEntry[] {
  const sectionIndex = buildSummarySectionIndex(source);
  const byId = new Map<string, SummaryFactCandidate>();
  for (const candidate of candidates) {
    validateCandidate(source, candidate, sectionIndex);
    const existing = byId.get(candidate.id);
    if (existing) {
      if (existing.quote !== candidate.quote || existing.required !== candidate.required
        || existing.category !== candidate.category || existing.facets.join("|") !== candidate.facets.join("|")
        || !sameSectionPath(existing.sectionPath, candidate.sectionPath)) {
        throw new Error("重复摘要事实 ID 对应不同原文证据。");
      }
      continue;
    }
    byId.set(candidate.id, candidate);
  }

  const selected = new Set(selectedIds);
  for (const id of selected) {
    if (!byId.has(id)) throw new Error(`模型选择了未知摘要事实候选：${id}`);
  }

  const byFact = new Map<string, SummaryFactCandidate>();
  const orderedCandidates = [...byId.values()].sort((a, b) => a.range.from - b.range.from || a.range.to - b.range.to);
  for (const candidate of orderedCandidates) {
    const key = factKey(candidate);
    const existing = byFact.get(key);
    byFact.set(key, existing ? earlierSpan(existing, candidate) : candidate);
  }
  if (byFact.size > MAX_FACTS) {
    throw new Error("全文可核验事实超过 256 条，请明确摘要范围。原文未修改。");
  }
  const selectedFacts = new Set([...selected].map((id) => factKey(byId.get(id)!)));
  const ledger = [...byFact.values()]
    .filter((candidate) => candidate.required || selectedFacts.has(factKey(candidate)))
    .sort((a, b) => a.range.from - b.range.from || a.range.to - b.range.to || a.id.localeCompare(b.id))
    .map((candidate) => ({
      ...candidate,
      includedBy: candidate.required ? "required" as const : "selected" as const
    }));
  if (utf8ByteLength(JSON.stringify(ledger)) > MAX_LEDGER_BYTES) {
    throw new Error("摘要事实账本超过 256 KiB 安全上限，请缩小范围。原文未修改。");
  }
  return ledger;
}

/** Renders a prompt-ready, escaped ledger while checking every quote against current source. */
export function renderSummaryFactLedger(
  source: string,
  ledger: readonly SummaryFactLedgerEntry[]
): string {
  const sectionIndex = buildSummarySectionIndex(source);
  for (const entry of ledger) {
    validateCandidate(source, entry, sectionIndex);
    const expectedProvenance = entry.required ? "required" : "selected";
    if (entry.includedBy !== expectedProvenance) {
      throw new Error("摘要事实 ledger provenance 与 required 规则不一致。");
    }
  }
  const rendered = renderValidatedSummaryFacts(ledger);
  if (new Set(ledger.map(factKey)).size > MAX_FACTS) throw new Error("摘要 facts 超过 256 条安全上限。");
  if (utf8ByteLength(rendered) > MAX_LEDGER_BYTES) {
    throw new Error("摘要 Markdown 账本超过 256 KiB 安全上限。");
  }
  return rendered;
}
