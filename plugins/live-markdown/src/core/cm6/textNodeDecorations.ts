import { EditorState } from "@codemirror/state";
import { Decoration } from "@codemirror/view";
import { syntaxTree } from "@codemirror/language";
import type { SyntaxNode } from "@lezer/common";
import { MathBlockWidget } from "./widgets";
import { buildTocDecorations } from "./tocDecorations";

export interface TextDecorationEntry {
  from: number;
  to: number;
  deco: Decoration;
  priority: number;
}

function firstProtectedRangeAfter(ranges: readonly ProtectedMathRange[], position: number): number {
  let low = 0;
  let high = ranges.length;
  while (low < high) {
    const middle = (low + high) >>> 1;
    if (ranges[middle].to <= position) low = middle + 1;
    else high = middle;
  }
  return low;
}

interface SourceLine {
  start: number;
  end: number;
  text: string;
}

interface BlockMathRange {
  from: number;
  to: number;
  tex: string;
}

export interface ProtectedMathRange {
  from: number;
  to: number;
}

export function collectProtectedMathRanges(
  tree: ReturnType<typeof syntaxTree>,
  inlineCodeWhitespaceRanges?: ProtectedMathRange[]
): ProtectedMathRange[] {
  const ranges: ProtectedMathRange[] = [];
  tree.iterate({
    enter: (node) => {
      if (node.name === "InlineCode" && inlineCodeWhitespaceRanges && isInsideUnvisitedInlineContainer(node.node.parent)) {
        inlineCodeWhitespaceRanges.push({ from: node.from, to: node.to });
      }
      if (node.name === "InlineCode" || node.name === "URL") {
        const previous = ranges[ranges.length - 1];
        if (previous && node.from <= previous.to) previous.to = Math.max(previous.to, node.to);
        else ranges.push({ from: node.from, to: node.to });
      }
    }
  });
  return ranges;
}

const INLINE_RENDER_STOPPERS = new Set(["StrongEmphasis", "Emphasis", "Strikethrough", "Link"]);

function isInsideUnvisitedInlineContainer(parent: SyntaxNode | null): boolean {
  for (let node = parent; node; node = node.parent) {
    if (INLINE_RENDER_STOPPERS.has(node.name)) return true;
    if (node.name === "Paragraph" || node.name === "Document") return false;
  }
  return false;
}


function splitSourceLines(raw: string): SourceLine[] {
  const lines: SourceLine[] = [];
  let start = 0;
  while (start <= raw.length) {
    let end = start;
    while (end < raw.length && raw[end] !== "\n" && raw[end] !== "\r") end++;
    lines.push({ start, end, text: raw.slice(start, end) });
    if (end === raw.length) break;
    start = end + (raw[end] === "\r" && raw[end + 1] === "\n" ? 2 : 1);
  }
  return lines;
}

function isHardBreak(text: string): boolean {
  return /(?: {2,}|\\)$/.test(text);
}

function findBlockMathRanges(
  raw: string,
  paragraphFrom: number,
  protectedRanges: readonly ProtectedMathRange[]
): BlockMathRange[] {
  const lines = splitSourceLines(raw);
  const ranges: BlockMathRange[] = [];
  let openIndex: number | null = null;
  let protectedIndex = firstProtectedRangeAfter(protectedRanges, paragraphFrom);
  for (let index = 0; index < lines.length; index++) {
    const line = lines[index];
    const lineFrom = paragraphFrom + line.start;
    const lineTo = paragraphFrom + line.end;
    while (protectedIndex < protectedRanges.length && protectedRanges[protectedIndex].to <= lineFrom) protectedIndex++;
    const lineProtected = protectedIndex < protectedRanges.length && protectedRanges[protectedIndex].from < lineTo;
    if (openIndex !== null) {
      if (!lineProtected && /^ {0,3}\$\$\s*$/.test(line.text)) {
        const openLine = lines[openIndex];
        const bodyStart = openLine.end < raw.length
          ? openLine.end + (raw[openLine.end] === "\r" && raw[openLine.end + 1] === "\n" ? 2 : 1)
          : openLine.end;
        const tex = raw.slice(bodyStart, line.start).trim();
        if (tex) ranges.push({ from: openLine.start, to: line.end, tex });
        openIndex = null;
      }
      continue;
    }

    if (lineProtected) continue;
    const hasParagraphBoundary = index === 0 || isHardBreak(lines[index - 1].text);
    if (!hasParagraphBoundary) continue;
    const oneLine = line.text.match(/^ {0,3}\$\$(.+?)\$\$\s*$/);
    if (oneLine?.[1]?.trim()) {
      ranges.push({ from: line.start, to: line.end, tex: oneLine[1].trim() });
      continue;
    }
    if (/^ {0,3}\$\$\s*$/.test(line.text)) openIndex = index;
  }
  return ranges;
}

export function buildParagraphDecorations(
  state: EditorState,
  tree: ReturnType<typeof syntaxTree>,
  from: number,
  to: number,
  cursorMin: number,
  cursorMax: number,
  protectedRanges: readonly ProtectedMathRange[],
  excludedBlocks: readonly ProtectedMathRange[] = []
): TextDecorationEntry[] {
  const raw = state.sliceDoc(from, to);
  const entries: TextDecorationEntry[] = [];

  entries.push(...buildTocDecorations(state, tree, from, to, cursorMin, cursorMax, excludedBlocks));

  const blockMath = findBlockMathRanges(raw, from, protectedRanges);
  for (const range of blockMath) {
    const absoluteFrom = from + range.from;
    const absoluteTo = from + range.to;
    const cursorTouchesFormula = cursorMin <= absoluteTo && cursorMax >= absoluteFrom;
    if (!cursorTouchesFormula) {
      entries.push({
        from: absoluteFrom,
        to: absoluteTo,
        deco: Decoration.replace({
          widget: new MathBlockWidget(range.tex, absoluteFrom, absoluteTo, true),
          block: true
        }),
        priority: 0
      });
    }
  }

  const inlineRegex = /(?<!\$)\$([^$\n]+?)\$(?!\$)/g;
  let match: RegExpExecArray | null;
  let blockIndex = 0;
  let inlineProtectedIndex = firstProtectedRangeAfter(protectedRanges, from);
  while ((match = inlineRegex.exec(raw)) !== null) {
    const relativeFrom = match.index;
    const relativeTo = relativeFrom + match[0].length;
    while (blockIndex < blockMath.length && blockMath[blockIndex].to <= relativeFrom) blockIndex++;
    if (blockIndex < blockMath.length && blockMath[blockIndex].from < relativeTo) continue;
    const absoluteFrom = from + relativeFrom;
    const absoluteTo = from + relativeTo;
    while (inlineProtectedIndex < protectedRanges.length && protectedRanges[inlineProtectedIndex].to <= absoluteFrom) inlineProtectedIndex++;
    if (inlineProtectedIndex < protectedRanges.length && protectedRanges[inlineProtectedIndex].from < absoluteTo) continue;
    const cursorTouchesMath = cursorMin <= absoluteTo + 1 && cursorMax >= absoluteFrom - 1;
    if (!cursorTouchesMath) {
      entries.push({
        from: absoluteFrom,
        to: absoluteTo,
        deco: Decoration.replace({
          widget: new MathBlockWidget(match[1].trim(), absoluteFrom, absoluteTo, false)
        }),
        priority: 0
      });
    }
  }
  return entries;
}

export function buildLinkDecorations(state: EditorState, from: number, to: number): TextDecorationEntry[] {
  const raw = state.sliceDoc(from, to);
  const closeBracketIdx = raw.indexOf("]");
  const openParenIdx = raw.indexOf("(", closeBracketIdx);
  const closeParenIdx = raw.lastIndexOf(")");
  if (closeBracketIdx <= 0 || openParenIdx !== closeBracketIdx + 1 || closeParenIdx <= openParenIdx) return [];

  const textFrom = from + 1;
  const textTo = from + closeBracketIdx;
  const urlTo = from + closeParenIdx + 1;
  return [
    { from, to: textFrom, deco: Decoration.replace({}), priority: 0 },
    { from: textFrom, to: textTo, deco: Decoration.mark({ class: "cm-link-text" }), priority: 1 },
    { from: textTo, to: urlTo, deco: Decoration.replace({}), priority: 0 }
  ];
}
