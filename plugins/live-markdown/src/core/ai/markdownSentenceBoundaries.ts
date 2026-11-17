import { GFM, parser } from "@lezer/markdown";

export interface MarkdownSourceSpan {
  from: number;
  to: number;
}

const closeQuotes = new Set(["”", "’", "」", "』", "）", ")", "]", "】"]);
const calloutNames = "NOTE|TIP|IMPORTANT|WARNING|CAUTION";

function escaped(source: string, index: number): boolean {
  let slashes = 0;
  for (let cursor = index - 1; cursor >= 0 && source[cursor] === "\\"; cursor -= 1) slashes += 1;
  return slashes % 2 === 1;
}

const inlineParser = parser.configure(GFM);
const inlineAtoms = new Set(["InlineCode", "Link", "Image", "URL", "Emphasis", "StrongEmphasis", "Strikethrough", "HTMLTag", "HTMLBlock", "Escape"]);

function inlineSyntaxRanges(source: string, span: MarkdownSourceSpan): MarkdownSourceSpan[] {
  const raw = source.slice(span.from, span.to);
  const removedCr: number[] = [];
  const normalized = raw.replace(/\r\n|\r/g, (value, offset: number) => {
    if (value.length === 2) removedCr.push(offset - removedCr.length + 1);
    return "\n";
  });
  const originalOffset = (offset: number) => {
    let low = 0, high = removedCr.length;
    while (low < high) {
      const mid = (low + high) >> 1;
      if (removedCr[mid] <= offset) low = mid + 1; else high = mid;
    }
    return span.from + offset + low;
  };
  const ranges: MarkdownSourceSpan[] = [];
  inlineParser.parse(normalized).iterate({ enter(node) {
    if (!inlineAtoms.has(node.name)) return;
    ranges.push({ from: originalOffset(node.from), to: originalOffset(node.to) });
    return false;
  } });
  // Math is an editor extension beyond GFM, so preserve its delimiters separately.
  const math = /\$\$[\s\S]*?\$\$|\$(?!\$)[^\r\n$]+?\$|\\\([\s\S]*?\\\)|\\\[[\s\S]*?\\\]/gu;
  for (const match of raw.matchAll(math)) {
    const from = span.from + (match.index ?? 0);
    if (match[0][0] === "$" && escaped(source, from)) continue;
    ranges.push({ from, to: from + match[0].length });
  }
  for (const match of raw.matchAll(/\[\^[^\]\r\n]+\]/gu)) {
    const from = span.from + (match.index ?? 0);
    if (!escaped(source, from)) ranges.push({ from, to: from + match[0].length });
  }
  const merged: MarkdownSourceSpan[] = [];
  for (const range of ranges.sort((a, b) => a.from - b.from || a.to - b.to)) {
    const previous = merged.at(-1);
    if (previous && range.from <= previous.to) previous.to = Math.max(previous.to, range.to);
    else merged.push({ ...range });
  }
  return merged;
}

function isCalloutMarkerBang(source: string, index: number, span: MarkdownSourceSpan): boolean {
  if (source[index - 1] !== "[" || !/^(?:NOTE|TIP|IMPORTANT|WARNING|CAUTION)\]/iu.test(source.slice(index + 1, index + 12))) return false;
  const lineStart = Math.max(span.from, source.lastIndexOf("\n", index - 1) + 1);
  const lineEndIndex = source.indexOf("\n", index);
  const lineEnd = lineEndIndex < 0 || lineEndIndex >= span.to ? span.to : lineEndIndex;
  const line = source.slice(lineStart, lineEnd).replace(/\r$/u, "");
  if (!new RegExp(`^[\\t ]{0,3}>[\\t ]*\\[!(?:${calloutNames})\\][\\t ]*$`, "iu").test(line)) return false;
  return lineStart + line.indexOf("!") === index;
}

function decimalPoint(source: string, index: number): boolean {
  return /\d/u.test(source[index - 1] ?? "") && /\d/u.test(source[index + 1] ?? "");
}

function englishAbbreviation(source: string, index: number): boolean {
  const prefix = source.slice(Math.max(0, index - 8), index + 1);
  return /(?:\b(?:Mr|Mrs|Ms|Dr|Prof|Sr|Jr|vs|etc|e\.g|i\.e)\.)$/iu.test(prefix)
    || /(?:\b[A-Z]\.){1,3}$/u.test(prefix);
}

function sentenceSuffixEnd(source: string, end: number, limit: number): number {
  while (end < limit) {
    if (closeQuotes.has(source[end])) { end += 1; continue; }
    let from = end;
    while (from < limit && /[ \t]/u.test(source[from])) from += 1;
    if (source.slice(from, from + 2) !== "[^") break;
    const closing = source.indexOf("]", from + 2);
    if (closing < 0 || closing >= limit || /[\r\n]/u.test(source.slice(from, closing)) || source[closing + 1] === ":") break;
    end = closing + 1;
  }
  return end;
}

function sentenceEnd(source: string, index: number, limit: number): number | undefined {
  const char = source[index];
  if (char === "。" || char === "！" || char === "？" || char === "!" || char === "?") {
    return sentenceSuffixEnd(source, index + 1, limit);
  }
  if (char !== "." || decimalPoint(source, index) || englishAbbreviation(source, index)) return undefined;
  const next = source[index + 1];
  if (next && !/\s/u.test(next) && !closeQuotes.has(next) && source.slice(index + 1, index + 3) !== "[^") return undefined;
  return sentenceSuffixEnd(source, index + 1, limit);
}

function trimSpan(source: string, from: number, to: number): MarkdownSourceSpan | undefined {
  let start = from;
  let end = to;
  while (start < end && /\s/u.test(source[start])) start += 1;
  while (end > start && /\s/u.test(source[end - 1])) end -= 1;
  return start < end ? { from: start, to: end } : undefined;
}

/** Split prose at sentence punctuation without breaking inline syntax, editor math or GFM callout markers. */
export function splitMarkdownSentences(source: string, span: MarkdownSourceSpan): MarkdownSourceSpan[] {
  const result: MarkdownSourceSpan[] = [];
  const codeRanges = inlineSyntaxRanges(source, span);
  let codeRangeIndex = 0;
  let start = span.from;
  for (let index = span.from; index < span.to; index += 1) {
    while (codeRangeIndex < codeRanges.length && codeRanges[codeRangeIndex].to <= index) codeRangeIndex += 1;
    const codeRange = codeRanges[codeRangeIndex];
    if (codeRange && index >= codeRange.from && index < codeRange.to) {
      index = codeRange.to - 1;
      continue;
    }
    if (/[.!?。！？]/u.test(source[index]) && escaped(source, index)) continue;
    if (source[index] === "!" && isCalloutMarkerBang(source, index, span)) continue;
    const end = sentenceEnd(source, index, span.to);
    if (end === undefined) continue;
    const trimmed = trimSpan(source, start, end);
    if (trimmed) result.push(trimmed);
    start = end;
    index = end - 1;
  }
  const tail = trimSpan(source, start, span.to);
  if (tail) result.push(tail);
  return result;
}

