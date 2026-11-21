import type { SummaryFactCandidate, SummaryFactCategory } from "./summaryFactLedger";
import { maskQuotedInstruction, scanInstructionQuotes } from "./instructionLiteralEvidence";
import { isNegatedMention } from "./instructionConstraints";

const focusWords: Array<{ pattern: RegExp; category: SummaryFactCategory }> = [
  { pattern: /决定|决策|\bdecisions?\b/giu, category: "decision" },
  { pattern: /风险|隐患|\brisks?\b/giu, category: "risk" },
  { pattern: /约束|限制|\bconstraints?\b/giu, category: "constraint" },
  { pattern: /负责人|责任归属|\bowners?\b/giu, category: "owner" },
  { pattern: /状态|进度|\bstatus|progress\b/giu, category: "status" },
  { pattern: /日期|截止|\bdates?|deadlines?\b/giu, category: "date" },
  { pattern: /金额|预算|\bamounts?|budgets?\b/giu, category: "amount" },
  { pattern: /指标|\bmetrics?\b/giu, category: "metric" },
  { pattern: /行动|待办|下一步|\bactions?\b/giu, category: "action" }
];

/** A narrow topic request excludes unrelated optional background, never required facts. */
export function summaryFocus(instruction: string): ReadonlySet<SummaryFactCategory> {
  const masked = maskQuotedInstruction(instruction, scanInstructionQuotes(instruction));
  const focus = new Set<SummaryFactCategory>();
  for (const { pattern, category } of focusWords) {
    for (const match of masked.matchAll(pattern)) {
      const from = match.index ?? 0;
      if (!isNegatedMention(masked, from, from + match[0].length)) focus.add(category);
    }
  }
  return focus;
}

export function focusSummaryCandidates(facts: SummaryFactCandidate[], focus: ReadonlySet<SummaryFactCategory>): SummaryFactCandidate[] {
  if (!focus.size) return facts;
  return facts.filter(fact => fact.required || fact.facets.some(category =>
    // A non-affirmative decision remains source evidence, but is not a decision to summarize.
    category !== "decision" && focus.has(category)));
}
