import type { InstructionHeadingEvidence, InstructionSpan } from "./intentContract";
import type { InstructionQuote } from "./instructionLiteralEvidence";

export interface HeadingTargetEvidence {
  value: InstructionHeadingEvidence;
  evidence: InstructionSpan;
  targetEvidence: InstructionSpan;
  ordinalEvidence?: InstructionSpan;
}

function span(source: string, from: number, to: number): InstructionSpan {
  return { from, to, raw: source.slice(from, to) };
}

export function parseChineseOrdinal(value: string): number | null {
  if (/^\d+$/u.test(value)) return Number(value);
  const digits: Record<string, number> = { 零: 0, 〇: 0, 一: 1, 二: 2, 两: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9 };
  if (!value.includes("十")) return value.length === 1 ? digits[value] ?? null : null;
  const [tens, units = ""] = value.split("十");
  if (tens.length > 1 || units.length > 1) return null;
  const tenValue = tens ? digits[tens] : 1;
  const unitValue = units ? digits[units] : 0;
  if (tenValue === undefined || unitValue === undefined) return null;
  return tenValue * 10 + unitValue;
}

/** Finds quoted and plain Markdown heading names used as positional anchors. */
export function buildInstructionHeadingEvidence(
  instruction: string,
  masked: string,
  quotes: InstructionQuote[]
): HeadingTargetEvidence[] {
  const result: HeadingTargetEvidence[] = [];
  for (const quote of quotes) {
    const left = masked.slice(Math.max(0, quote.from - 24), quote.from);
    const right = masked.slice(quote.to, Math.min(masked.length, quote.to + 28));
    const markerBefore = /(?:标题|章节|section|heading)\s*$/iu.test(left);
    const markerAfter = /^\s*(?:(?:这个|该|此|the)\s*)?(?:标题|章节|section|heading)/iu.exec(right)?.[0];
    const sectionAfter = markerAfter ? /(?:章节|section)/iu.test(markerAfter) : false;
    const after = right.slice(markerAfter?.length ?? 0);
    const directSectionEnd = /^\s*(?:的)?(?:章节)?(?:末尾|结尾|结束|末端)/u.test(right) || /^\s*(?:end|end\s+of\s+(?:the\s+)?section)\b/iu.test(right);
    const relation: InstructionHeadingEvidence["relation"] | null = sectionAfter && /^\s*(?:的)?(?:末尾|结尾|结束|末端)/u.test(after) || (markerBefore && directSectionEnd)
      ? "section_end" : markerAfter && !sectionAfter && /^\s*(?:的)?(?:后|之后|下方|下面|after|below)/iu.test(after) || (markerBefore && /^\s*(?:后|之后|下方|下面|after|below)/iu.test(right)) ? "heading_end" : null;
    if (!markerBefore && !markerAfter || !relation) continue;

    const leftBase = Math.max(0, quote.from - 24);
    const globalOrdinalMatch = /第\s*([0-9]{1,4}|[零〇一二两三四五六七八九十]+)\s*(?:个|处)?\s*(?:标题|章节|section|heading)\s*$/iu.exec(left);
    const sameTitleFromLeft = /第?\s*([0-9]{1,4}|[零〇一二两三四五六七八九十]+)\s*(?:个|处)\s*$/iu.exec(left);
    const sameTitleFromRight = /(?:标题|章节|section|heading)\s*(?:第\s*)?([0-9]{1,4}|[零〇一二两三四五六七八九十]+)\s*(?:个|处)\s*$/iu.exec(right);
    const sameTitleOrdinalMatch = sameTitleFromLeft ?? sameTitleFromRight;
    const ordinalMatch = globalOrdinalMatch ?? sameTitleOrdinalMatch;
    const ordinalBase = globalOrdinalMatch || sameTitleFromLeft ? leftBase : quote.to;
    const ordinalValue = ordinalMatch ? parseChineseOrdinal(ordinalMatch[1]) : null;
    const headingText = quote.value.replace(/^\s*#{1,6}\s*/u, "").trim();
    const value = { text: headingText, relation, ...(ordinalValue ? { ordinal: ordinalValue, ordinalScope: globalOrdinalMatch ? "global" as const : "same_title" as const } : {}) };
    const relationTail = relation === "section_end"
      ? /^\s*(?:的)?(?:末尾|结尾|结束|末端)|^\s*(?:end|end\s+of\s+(?:the\s+)?section)\b/iu.exec(markerAfter ? after : right)
      : /^\s*(?:的)?(?:后|之后|下方|下面|after|below)/iu.exec(markerAfter ? after : right);
    const targetEnd = quote.to + (markerAfter?.length ?? 0) + (relationTail?.[0].length ?? 0);
    result.push({
      value,
      evidence: span(instruction, quote.from - 1, quote.to + 1),
      targetEvidence: span(instruction, quote.from - 1, Math.max(quote.to + 1, targetEnd)),
      ...(ordinalMatch ? { ordinalEvidence: span(instruction, ordinalBase + ordinalMatch.index, ordinalBase + ordinalMatch.index + ordinalMatch[0].length) } : {})
    });
  }

  const markdownSectionEnd = /#{1,6}[ \t]+([^#\r\n，,。！？；;]+?)\s*(?:章节|section)\s*(?:的)?\s*(?:末尾|结尾|结束|末端)/giu;
  for (const match of masked.matchAll(markdownSectionEnd)) {
    const start = match.index ?? 0;
    const from = start + match[0].search(/#{1,6}/u);
    const to = start + match[0].length;
    if (quotes.some((quote) => from < quote.to && to > quote.from)) continue;
    const text = match[1].trim().replace(/\s*#+\s*$/u, "");
    if (!text) continue;
    const evidence = span(instruction, from, to);
    result.push({ value: { text, relation: "section_end" }, evidence, targetEvidence: evidence });
  }

  const globalPosition = /(?:在|于|到)?\s*第\s*([0-9]{1,4}|[零〇一二两三四五六七八九十]+)\s*(?:个|处)?\s*(标题|章节|section|heading)\s*(?:的)?\s*(后|之后|下方|下面|末尾|结尾|结束|after|below|end)/giu;
  for (const match of masked.matchAll(globalPosition)) {
    const ordinal = parseChineseOrdinal(match[1]);
    if (!ordinal || ordinal > 1000) continue;
    const from = match.index ?? 0;
    const to = from + match[0].length;
    const relation: InstructionHeadingEvidence["relation"] = /(?:章节|section)/iu.test(match[2]) && /(?:末尾|结尾|结束|end)/iu.test(match[3])
      ? "section_end" : "heading_end";
    if (result.some(({ value, targetEvidence }) => (value.ordinalScope === "same_title" || value.ordinalScope === "global") &&
      value.ordinal === ordinal && value.relation === relation && targetEvidence.from < to && targetEvidence.to > from)) continue;
    const ordinalFrom = from + match[0].indexOf("第");
    const ordinalEnd = ordinalFrom + match[0].slice(match[0].indexOf("第")).indexOf(match[1]) + match[1].length;
    const evidence = span(instruction, from, to);
    result.push({
      value: { text: "", relation, ordinal, ordinalScope: "global" }, evidence,
      targetEvidence: evidence,
      ordinalEvidence: span(instruction, ordinalFrom, ordinalEnd)
    });
  }
  return result;
}
