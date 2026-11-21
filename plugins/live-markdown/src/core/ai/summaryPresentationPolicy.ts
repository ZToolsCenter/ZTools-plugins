import type { SummaryFactLedgerEntry } from "./summaryFactLedger";

/** Default concise summaries keep all required facts and cap optional selections. */
export const DEFAULT_OPTIONAL_SUMMARY_FACTS = 5;
export const DEFAULT_SUMMARY_CHARACTERS = 400;

/** Markdown control markers are syntax, not source facts for an extractive summary. */
export function isSummaryControlMarker(text: string): boolean {
  const trimmed = text.trim();
  return /^>[\t ]*\[!(?:NOTE|TIP|IMPORTANT|WARNING|CAUTION)\]$/iu.test(trimmed)
    || /^\[\[?\s*toc\s*\]\]?$/iu.test(trimmed);
}

export interface SummaryOutputBudgetResult {
  ledger: SummaryFactLedgerEntry[];
  requiredFactsExceedCharacterBudget: boolean;
}

function presentationFactKey(entry: SummaryFactLedgerEntry): string {
  const path = entry.sectionPath.map(({ text, level, range }) => [text, level, range.from, range.to]);
  return JSON.stringify([entry.quote, entry.category, entry.facets, path]);
}

/** Pure layout for already source-validated entries; safe to call while measuring budget candidates. */
export function renderValidatedSummaryFacts(ledger: readonly SummaryFactLedgerEntry[]): string {
  const byFact = new Map<string, SummaryFactLedgerEntry>();
  for (const entry of ledger) {
    const key = presentationFactKey(entry);
    const existing = byFact.get(key);
    if (!existing || entry.range.from < existing.range.from) byFact.set(key, entry);
  }
  let previousSectionKey: string | undefined;
  return [...byFact.values()]
    .sort((a, b) => a.range.from - b.range.from || a.range.to - b.range.to || a.id.localeCompare(b.id))
    .map(({ quote, sectionPath }) => {
      const section = sectionPath.map(({ text }) => text).join(" > ");
      const sectionKey = JSON.stringify(sectionPath.map(({ text, level }) => [text, level]));
      const prefix = section && sectionKey !== previousSectionKey ? `（章节：${section}）` : "";
      previousSectionKey = sectionKey;
      if (isFencedCodeFact(quote)) return `${prefix ? `- ${prefix}\n\n` : ""}${quote}`;
      return `- ${prefix}${presentSummaryQuote(quote)}`;
    })
    .join("\n");
}

const FACET_PRIORITY = ["decision", "risk", "constraint", "metric", "owner", "date", "amount", "action", "claim", "other"] as const;

export function summaryRequestsTechnicalSource(instruction: string): boolean {
  return /源码|代码|实现细节|程序结构|技术实现|Mermaid|图表源码|公式推导|\bsource code\b|\bimplementation details\b/iu.test(instruction);
}

export function isFencedCodeFact(quote: string): boolean {
  return /^\s*(?:`{3,}|~{3,})/u.test(quote);
}

function priority(entry: SummaryFactLedgerEntry): number {
  const categoryIndex = FACET_PRIORITY.findIndex((facet) => entry.facets.includes(facet));
  return categoryIndex < 0 ? FACET_PRIORITY.length : categoryIndex;
}

export function applySummaryOutputBudget(
  ledger: readonly SummaryFactLedgerEntry[],
  maxOptionalFacts: number,
  maxCharacters: number | undefined,
  measureCharacters: (entries: readonly SummaryFactLedgerEntry[]) => number
): SummaryOutputBudgetResult {
  const required = ledger.filter(({ required }) => required);
  const requiredFactsExceedCharacterBudget = maxCharacters !== undefined && measureCharacters(required) > maxCharacters;
  if (requiredFactsExceedCharacterBudget) return { ledger: [...required], requiredFactsExceedCharacterBudget };

  const optional = ledger.filter(({ required }) => !required)
    .sort((a, b) => priority(a) - priority(b) || a.range.from - b.range.from || a.id.localeCompare(b.id));
  const selected = [...required];
  let selectedOptional = 0;
  for (const candidate of optional) {
    if (selectedOptional >= Math.max(0, maxOptionalFacts)) break;
    const proposed = sortBySource([...selected, candidate]);
    if (maxCharacters !== undefined && measureCharacters(proposed) > maxCharacters) continue;
    selected.push(candidate);
    selectedOptional += 1;
  }
  return { ledger: sortBySource(selected), requiredFactsExceedCharacterBudget };
}

function sortBySource(entries: SummaryFactLedgerEntry[]): SummaryFactLedgerEntry[] {
  return entries.sort((a, b) => a.range.from - b.range.from || a.range.to - b.range.to || a.id.localeCompare(b.id));
}

/** Removes quote/callout decoration from presentation while ledger evidence stays source-exact. */
export function presentSummaryQuote(quote: string): string {
  return quote
    .replace(/(^|[\r\n])[\t ]*>[\t ]*\[!(?:NOTE|TIP|IMPORTANT|WARNING|CAUTION)\][\t ]*(?:\r\n|\r|\n|$)/giu, "$1")
    .replace(/(^|[\r\n])[\t ]*>[\t ]?/gu, "$1")
    .replace(/^[-+*][\t ]+/u, "")
    .replace(/[\t ]*(?:\r\n|\r|\n)[\t ]*/gu, " ")
    .trim();
}
