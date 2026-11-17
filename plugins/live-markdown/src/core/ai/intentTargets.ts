import { GFM, parser } from "@lezer/markdown";

export interface IntentHeading {
  id: string;
  text: string;
  level: number;
}

export interface IntentHeadingRange extends IntentHeading {
  from: number;
  to: number;
  lineFrom: number;
  lineTo: number;
}

const markdownParser = parser.configure(GFM);

function normalizeLineEndings(source: string): { text: string; toSourceOffset: (offset: number) => number } {
  if (!source.includes("\r")) return { text: source, toSourceOffset: (offset) => offset };
  let text = "";
  const crlfEnds: number[] = [];
  for (let index = 0; index < source.length; index += 1) {
    if (source[index] === "\r") {
      text += "\n";
      if (source[index + 1] === "\n") {
        index += 1;
        crlfEnds.push(text.length);
      }
    } else text += source[index];
  }
  return {
    text,
    toSourceOffset: (offset) => {
      let low = 0;
      let high = crlfEnds.length;
      while (low < high) {
        const middle = (low + high) >> 1;
        if (crlfEnds[middle] <= offset) low = middle + 1;
        else high = middle;
      }
      return offset + low;
    }
  };
}

function frontMatterEnd(source: string): number | null {
  const opening = /^---[ \t]*(?:\r\n|\r|\n)/.exec(source);
  if (!opening) return null;
  let lineStart = opening[0].length;
  while (lineStart <= source.length) {
    let lineEnd = lineStart;
    while (lineEnd < source.length && source[lineEnd] !== "\r" && source[lineEnd] !== "\n") lineEnd += 1;
    if (/^---[ \t]*$/.test(source.slice(lineStart, lineEnd))) {
      if (source[lineEnd] === "\r" && source[lineEnd + 1] === "\n") return lineEnd + 2;
      return lineEnd < source.length ? lineEnd + 1 : lineEnd;
    }
    if (lineEnd === source.length) break;
    lineStart = source[lineEnd] === "\r" && source[lineEnd + 1] === "\n" ? lineEnd + 2 : lineEnd + 1;
  }
  return null;
}

export function getMarkdownBodyStart(source: string): number {
  if (/^---[ \t]*(?:\r\n|\r|\n)/.test(source) && frontMatterEnd(source) === null) {
    throw new Error("文档头部 frontmatter 尚未闭合，无法安全定位正文开头。");
  }
  return frontMatterEnd(source) ?? 0;
}

function headingLevel(name: string): number | null {
  const match = /^(?:ATX|Setext)Heading([1-6])$/.exec(name);
  return match ? Number(match[1]) : null;
}

function headingText(source: string, from: number, to: number, name: string): string {
  const raw = source.slice(from, to);
  const firstLine = raw.split(/\r\n|\r|\n/, 1)[0];
  const title = name.startsWith("ATX")
    ? firstLine.replace(/^ {0,3}#{1,6}[ \t]+/, "").replace(/[ \t]+#+[ \t]*$/, "")
    : firstLine;
  return title.trim();
}

export function readIntentHeadingRanges(source: string): IntentHeadingRange[] {
  const normalized = normalizeLineEndings(source);
  const cursor = markdownParser.parse(normalized.text).cursor();
  const bodyStart = getMarkdownBodyStart(source);
  const headings: IntentHeadingRange[] = [];
  while (cursor.next()) {
    const level = headingLevel(cursor.name);
    if (level === null) continue;
    const from = normalized.toSourceOffset(cursor.from);
    const to = normalized.toSourceOffset(cursor.to);
    if (from < bodyStart || to < from || to > source.length) continue;
    let lineFrom = from;
    while (lineFrom > 0 && source[lineFrom - 1] !== "\r" && source[lineFrom - 1] !== "\n") lineFrom -= 1;
    let lineTo = to;
    while (lineTo < source.length && source[lineTo] !== "\r" && source[lineTo] !== "\n") lineTo += 1;
    if (source[lineTo] === "\r" && source[lineTo + 1] === "\n") lineTo += 2;
    else if (lineTo < source.length) lineTo += 1;
    headings.push({
      id: `heading:${from}:${to}`,
      text: headingText(source, from, to, cursor.name),
      level,
      from,
      to,
      lineFrom,
      lineTo
    });
  }
  return headings;
}

/** Returns stable, snapshot-local AST heading IDs suitable for the intent planner. */
export function getIntentHeadings(source: string): IntentHeading[] {
  return readIntentHeadingRanges(source).map(({ id, text, level }) => ({ id, text, level }));
}

export function isSafeMarkdownBoundary(source: string, offset: number): boolean {
  if (!Number.isInteger(offset) || offset < 0 || offset > source.length) return false;
  if (offset > 0 && offset < source.length) {
    const before = source.charCodeAt(offset - 1);
    const after = source.charCodeAt(offset);
    if (before >= 0xd800 && before <= 0xdbff && after >= 0xdc00 && after <= 0xdfff) return false;
    if (source[offset - 1] === "\r" && source[offset] === "\n") return false;
  }
  return true;
}

export function assertSafeMarkdownRange(source: string, from: number, to: number): void {
  if (from > to || !isSafeMarkdownBoundary(source, from) || !isSafeMarkdownBoundary(source, to)) {
    throw new Error("目标位置切开了换行符或 Unicode 字符，请重新选择目标位置。");
  }
}
