import type { ArtifactField, HeadingLevel } from "./artifactSpec";
import type { InstructionSpan } from "./intentContract";

export interface MatchSpan extends InstructionSpan {
  value: string;
}

const HEADING_PATTERN = /\b(?:h\s*([1-6])|heading\s*(?:level\s*)?([1-6])|level\s*([1-6])(?:\s+heading)?)\b|([一二三四五六1-6])\s*级\s*标题|标题\s*([一二三四五六1-6])/giu;
const QUOTE_CLOSE = new Map<string, string>([["“", "”"], ["‘", "’"], ["「", "」"], ["『", "』"], ["\"", "\""], ["'", "'"]]);

export function field<T>(source: string, from: number, to: number, value: T): ArtifactField<T> {
  return { value, evidence: [{ from, to, raw: source.slice(from, to) }] };
}

export function addIssue(issues: string[], issue: string): void {
  if (!issues.includes(issue)) issues.push(issue);
}

export function collectMatches(source: string, pattern: RegExp, value: string): MatchSpan[] {
  pattern.lastIndex = 0;
  return [...source.matchAll(pattern)].map(match => {
    const from = match.index ?? 0;
    const to = from + match[0].length;
    return { value, from, to, raw: source.slice(from, to) };
  });
}

export function headingTokens(source: string): Array<MatchSpan & { level: HeadingLevel }> {
  HEADING_PATTERN.lastIndex = 0;
  return [...source.matchAll(HEADING_PATTERN)].flatMap(match => {
    const from = match.index ?? 0;
    const to = from + match[0].length;
    const token = match.slice(1).find(Boolean);
    if (!token) return [];
    const numeric = /^[1-6]$/u.test(token) ? Number(token) : ["一", "二", "三", "四", "五", "六"].indexOf(token) + 1;
    if (numeric < 1 || numeric > 6) return [];
    return [{ value: String(numeric), level: numeric as HeadingLevel, from, to, raw: source.slice(from, to) }];
  });
}

export function quotedValue(source: string, from: number, limit: number): MatchSpan | undefined {
  const open = source[from];
  if (!open || !QUOTE_CLOSE.has(open)) return undefined;
  const close = QUOTE_CLOSE.get(open)!;
  let end = from + 1;
  while (end < limit) {
    if (source[end] === close && source[end - 1] !== "\\") break;
    end += 1;
  }
  if (end >= limit || end === from + 1) return undefined;
  return { value: source.slice(from + 1, end), from, to: end + 1, raw: source.slice(from, end + 1) };
}

export function trimRange(source: string, from: number, to: number): [number, number] {
  while (from < to && /\s/u.test(source[from])) from += 1;
  while (to > from && /\s/u.test(source[to - 1])) to -= 1;
  return [from, to];
}

export function payloadStart(source: string, from: number, limit: number): number | undefined {
  const tail = source.slice(from, limit);
  if (QUOTE_CLOSE.has(source[from] ?? "")) return from;
  const explicit = /^\s*(?:(?:内容|标题|文字|文本)\s*(?:为|是|[:：=])\s*|(?:with|as)\s+)/iu.exec(tail);
  if (explicit) return from + explicit[0].length;
  const punctuation = /^\s*[,，:：=]\s*/u.exec(tail);
  if (punctuation) return from + punctuation[0].length;
  const whitespace = /^\s+/u.exec(tail);
  if (whitespace) return from + whitespace[0].length;
  if (source[from] === "的") {
    const next = source.codePointAt(from + 1);
    if (next !== undefined && /\p{Script=Han}/u.test(String.fromCodePoint(next))) return undefined;
    return from + 1;
  }
  return undefined;
}

export function listSegmentEnd(source: string, start: number): number {
  const match = /[。！？；;\r\n]/u.exec(source.slice(start));
  return match ? start + match.index : source.length;
}

export function contentSegmentEnd(source: string, start: number, end = listSegmentEnd(source, start)): number {
  const extraAction = /(?:[,，]\s*|\s+)(?:并(?:且)?|然后|同时|以及|and|then|also)\s*(?:解释|说明|分析|补充|添加|新增|生成|写|explain|describe|analy[sz]e|add|create|write|(?:给|为)[^。！？；;\n]{0,20}(?:加上|添加|补充|增加|附加|标注|设置|配上))/iu.exec(source.slice(start, end));
  return extraAction ? start + extraAction.index : end;
}

export function parseSeparatedValues(source: string, start: number, end: number, separators: RegExp): MatchSpan[] {
  const values: MatchSpan[] = [];
  const separator = new RegExp(separators.source, "uy");
  const separatorLengthAt = (index: number): number => {
    separator.lastIndex = index;
    return separator.exec(source)?.[0].length ?? 0;
  };
  let cursor = start;
  while (cursor < end) {
    while (cursor < end && /\s/u.test(source[cursor])) cursor += 1;
    let initialSeparator = separatorLengthAt(cursor);
    while (initialSeparator) {
      cursor += initialSeparator;
      while (cursor < end && /\s/u.test(source[cursor])) cursor += 1;
      initialSeparator = separatorLengthAt(cursor);
    }
    if (cursor >= end) break;
    const quoted = quotedValue(source, cursor, end);
    if (quoted) {
      values.push(quoted);
      cursor = quoted.to;
    } else {
      let valueEnd = cursor;
      while (valueEnd < end && !separatorLengthAt(valueEnd)) valueEnd += 1;
      const [from, to] = trimRange(source, cursor, valueEnd);
      if (from < to) values.push({ value: source.slice(from, to), from, to, raw: source.slice(from, to) });
      cursor = valueEnd;
    }
    while (cursor < end && /\s/u.test(source[cursor])) cursor += 1;
    const separatorLength = separatorLengthAt(cursor);
    if (separatorLength) cursor += separatorLength;
  }
  return values;
}

export function markSpans(source: string, spans: readonly InstructionSpan[]): string {
  const chars = source.split("");
  for (const { from, to } of spans) {
    for (let index = from; index < to && index < chars.length; index += 1) {
      if (chars[index] !== "\n" && chars[index] !== "\r") chars[index] = " ";
    }
  }
  return chars.join("");
}
