import { firstCodePoint, isCjkCodePoint, isRawHardBreak, needsWordSpace } from "../softBreakPolicy";
import { EditorState } from "@codemirror/state";
import { Decoration, WidgetType } from "@codemirror/view";
import { syntaxTree } from "@codemirror/language";
import type { SyntaxNode, SyntaxNodeRef } from "@lezer/common";
import type { ProtectedMathRange, TextDecorationEntry } from "./textNodeDecorations";

export interface SoftBreakSourceRange {
  from: number;
  to: number;
}

export interface SoftBreakScan {
  paragraphs: SoftBreakSourceRange[];
  hardBreaks: SoftBreakSourceRange[];
}

export interface SoftBreakRevealRange {
  from: number;
  to: number;
}

const MAX_PARAGRAPH_CHARS = 65_536;
const MAX_PARAGRAPH_BREAKS = 1_024;
class SoftBreakSpaceWidget extends WidgetType {
  eq(other: SoftBreakSpaceWidget): boolean { return other === this; }

  toDOM(): HTMLElement {
    const space = document.createElement("span");
    space.className = "cm-softbreak-space";
    space.textContent = " ";
    space.setAttribute("aria-hidden", "true");
    return space;
  }
}

const latinSpaceWidget = new SoftBreakSpaceWidget();
const emptyBreak = Decoration.replace({});
const wordBreak = Decoration.replace({ widget: latinSpaceWidget });

export function createSoftBreakScan(): SoftBreakScan {
  return { paragraphs: [], hardBreaks: [] };
}

/** Collect semantic boundaries during the live-preview field's existing tree walk. */
export function collectSoftBreakNode(scan: SoftBreakScan, node: SyntaxNodeRef): void {
  if (node.name === "Paragraph" && node.node.parent?.name === "Document") {
    scan.paragraphs.push({ from: node.from, to: node.to });
  } else if (node.name === "HardBreak") {
    scan.hardBreaks.push({ from: node.from, to: node.to });
  }
}

/**
 * Build only source-preserving inline replacements. This runs from a direct
 * StateField decoration set, which allows the LF range to affect line layout.
 */
export function buildSoftBreakDecorations(
  state: EditorState,
  scan: SoftBreakScan,
  blockedRanges: readonly SoftBreakSourceRange[],
  protectedRanges: readonly ProtectedMathRange[],
  inlineCodeWhitespaceRanges: readonly ProtectedMathRange[],
  reveal: SoftBreakRevealRange | null,
  editing: boolean,
  joinRanges: SoftBreakSourceRange[] = []
): TextDecorationEntry[] {
  const entries: TextDecorationEntry[] = [];
  const parsedLength = syntaxTree(state).length;
  let inlineCodeIndex = 0;
  for (const paragraph of scan.paragraphs) {
    if (!paragraphIsEligible(state, paragraph, blockedRanges, parsedLength)) continue;
    while (inlineCodeIndex < inlineCodeWhitespaceRanges.length && inlineCodeWhitespaceRanges[inlineCodeIndex].to <= paragraph.from) inlineCodeIndex++;
    const previewTypography = !isParagraphBeingEdited(state, paragraph, editing)
      && !(reveal && reveal.from <= paragraph.to && reveal.to >= paragraph.from);
    if (previewTypography) {
      const firstLine = state.doc.lineAt(paragraph.from);
      const lastLine = state.doc.lineAt(paragraph.to);
      for (let number = firstLine.number; number <= lastLine.number; number++) {
        const line = state.doc.line(number);
        entries.push({
          from: line.from,
          to: line.from,
          deco: Decoration.line({ class: "cm-paragraph-preview" }),
          priority: -1
        });
      }
      for (let index = inlineCodeIndex; index < inlineCodeWhitespaceRanges.length && inlineCodeWhitespaceRanges[index].from < paragraph.to; index++) {
        appendNestedCodeWhitespace(state, paragraph, inlineCodeWhitespaceRanges[index], entries);
      }
    }
    // Soft source LF remains a visual soft break while editing and during a
    // navigation reveal; only preview typography toggles with focus.
    appendParagraphBreaks(state, paragraph, scan.hardBreaks, protectedRanges, entries, joinRanges);
  }
  return entries;
}

/** Find a preview-layout paragraph at a source position for navigation reveal. */
export function findPreviewParagraphAt(state: EditorState, position: number): SoftBreakSourceRange | null {
  const tree = syntaxTree(state);
  const boundedPosition = Math.max(0, Math.min(position, state.doc.length));
  let node = rootParagraphAt(tree, boundedPosition, 1);
  if (!node || boundedPosition > node.to) node = rootParagraphAt(tree, boundedPosition, -1);

  // Lezer starts a Paragraph after Markdown's up-to-three-space indentation.
  // A caret or reveal request at that physical line's start is still part of
  // the paragraph and must share its whole-paragraph editing layout.
  if (!node) {
    const line = state.doc.lineAt(boundedPosition);
    const indentLength = Math.min(3, line.text.match(/^ */)?.[0].length ?? 0);
    const contentStart = line.from + indentLength;
    if (boundedPosition >= line.from && boundedPosition <= contentStart && contentStart > line.from) {
      node = rootParagraphAt(tree, contentStart, 1);
    }
  }
  if (!node) return null;

  const sourceParagraph = { from: node.from, to: node.to };
  if (!paragraphIsEligible(state, sourceParagraph, [], tree.length)) return null;
  const paragraph = { from: state.doc.lineAt(node.from).from, to: node.to };
  return paragraph.from <= boundedPosition && boundedPosition <= paragraph.to ? paragraph : null;
}

function rootParagraphAt(tree: ReturnType<typeof syntaxTree>, position: number, side: -1 | 1): SyntaxNode | null {
  let node: SyntaxNode | null = tree.resolveInner(position, side);
  while (node && node.name !== "Paragraph") node = node.parent;
  return node?.parent?.name === "Document" ? node : null;
}

export function isFullyParsedParagraphRange(range: SoftBreakSourceRange, parsedLength: number, docLength: number): boolean {
  return !(range.to >= parsedLength && parsedLength < docLength);
}

function paragraphIsEligible(
  state: EditorState,
  paragraph: SoftBreakSourceRange,
  blockedRanges: readonly SoftBreakSourceRange[],
  parsedLength: number
): boolean {
  if (paragraph.to <= paragraph.from || paragraph.to - paragraph.from > MAX_PARAGRAPH_CHARS) return false;
  if (!isFullyParsedParagraphRange(paragraph, parsedLength, state.doc.length)) return false;
  if (overlapsAny(blockedRanges, paragraph)) return false;

  const first = state.doc.lineAt(paragraph.from);
  const last = state.doc.lineAt(paragraph.to);
  if (last.number - first.number > MAX_PARAGRAPH_BREAKS) return false;
  if (paragraph.from === 0 && /^---[ \t]*$/.test(first.text)) return false;

  for (let number = first.number; number <= last.number; number++) {
    const text = state.doc.line(number).text.trim();
    if (text.toLowerCase() === "[toc]" || text === "$$" || /^\$\$.*\$\$$/.test(text)
      || /^\[\^[^\]]+\]:/.test(text)) return false;
  }
  return true;
}

function isParagraphBeingEdited(state: EditorState, paragraph: SoftBreakSourceRange, editing: boolean): boolean {
  const sourceStart = state.doc.lineAt(paragraph.from).from;
  return editing && state.selection.ranges.some((range) => range.from <= paragraph.to && range.to >= sourceStart);
}

function appendParagraphBreaks(
  state: EditorState,
  paragraph: SoftBreakSourceRange,
  hardBreaks: readonly SoftBreakSourceRange[],
  protectedRanges: readonly ProtectedMathRange[],
  entries: TextDecorationEntry[],
  joinRanges: SoftBreakSourceRange[]
): void {
  const firstLine = state.doc.lineAt(paragraph.from);
  const lastLine = state.doc.lineAt(paragraph.to);
  let count = 0;
  let overlappingJoinEnd = -1;
  for (let number = firstLine.number; number < lastLine.number && count < MAX_PARAGRAPH_BREAKS; number++) {
    const line = state.doc.line(number);
    const next = state.doc.line(number + 1);
    const from = line.to;
    const to = from + 1;
    if (to !== next.from || to > paragraph.to || state.doc.sliceString(from, to) !== "\n") continue;
    if (containsPosition(hardBreaks, from) || containsPosition(protectedRanges, from) || isRawHardBreak(line.text)) continue;

    const needsSpace = needsWordSpace(line.text, next.text);
    entries.push({ from, to, deco: needsSpace ? wordBreak : emptyBreak, priority: 0 });
    if (!needsSpace) {
      const left = lastCodePointWithStart(line.text);
      const right = firstCodePoint(next.text);
      if (left && right && isCjkCodePoint(left.value.codePointAt(0)!) && isCjkCodePoint(right.codePointAt(0)!)) {
        const candidate = { from: line.to - left.length, to: next.from + right.length };
        if (candidate.from < overlappingJoinEnd) {
          overlappingJoinEnd = Math.max(overlappingJoinEnd, candidate.to);
        } else {
          const previous = joinRanges[joinRanges.length - 1];
          if (previous && candidate.from < previous.to) {
            joinRanges.pop();
            overlappingJoinEnd = candidate.to;
          } else {
            joinRanges.push(candidate);
          }
        }
      }
    }
    count++;
  }
}

function appendNestedCodeWhitespace(
  state: EditorState,
  paragraph: SoftBreakSourceRange,
  range: ProtectedMathRange,
  entries: TextDecorationEntry[]
): void {
  if (range.from < paragraph.from || range.to > paragraph.to) return;
  const raw = state.sliceDoc(range.from, range.to);
  const delimiterLength = raw.match(/^`+/)?.[0].length ?? 1;
  const from = range.from + delimiterLength;
  const to = range.to - delimiterLength;
  if (from >= to) return;
  entries.push({ from, to, deco: Decoration.mark({ class: "cm-inline-code-whitespace" }), priority: 1 });
}

function lastCodePointWithStart(value: string): { value: string; length: number } | null {
  if (!value) return null;
  const last = value.charCodeAt(value.length - 1);
  const from = last >= 0xDC00 && last <= 0xDFFF && value.length > 1 ? value.length - 2 : value.length - 1;
  return { value: String.fromCodePoint(value.codePointAt(from)!), length: value.length - from };
}

function containsPosition(ranges: readonly SoftBreakSourceRange[], position: number): boolean {
  let low = 0;
  let high = ranges.length;
  while (low < high) {
    const middle = (low + high) >>> 1;
    if (ranges[middle].to <= position) low = middle + 1;
    else high = middle;
  }
  return low < ranges.length && ranges[low].from <= position && position < ranges[low].to;
}

function overlapsAny(ranges: readonly SoftBreakSourceRange[], target: SoftBreakSourceRange): boolean {
  let low = 0;
  let high = ranges.length;
  while (low < high) {
    const middle = (low + high) >>> 1;
    if (ranges[middle].to <= target.from) low = middle + 1;
    else high = middle;
  }
  return low < ranges.length && ranges[low].from < target.to;
}
