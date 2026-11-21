import { EditorState } from "@codemirror/state";
import { Decoration } from "@codemirror/view";
import type { SyntaxNode } from "@lezer/common";
import type { NavigationRevealLine } from "./navigationReveal";
import { isNavigationRevealLine } from "./navigationReveal";
import type { TextDecorationEntry } from "./textNodeDecorations";

export interface EscapeSourceRange {
  from: number;
  to: number;
}

export interface EscapeDecorationOptions {
  cursorFrom: number;
  cursorTo: number;
  protectedRanges: readonly EscapeSourceRange[];
  navigationReveal?: NavigationRevealLine | null;
  activeParagraph?: EscapeSourceRange | null;
}

const LITERAL_CONTAINERS = new Set([
  "CodeBlock", "FencedCode", "HTMLBlock", "HTMLTag", "InlineCode", "LinkReference", "Table", "URL", "Autolink"
]);

function isAsciiPunctuation(code: number): boolean {
  return (code >= 0x21 && code <= 0x2f)
    || (code >= 0x3a && code <= 0x40)
    || (code >= 0x5b && code <= 0x60)
    || (code >= 0x7b && code <= 0x7e);
}

function mergeRanges(ranges: readonly EscapeSourceRange[]): EscapeSourceRange[] {
  const ordered = ranges.filter((range) => range.to > range.from)
    .map((range) => ({ from: range.from, to: range.to }))
    .sort((left, right) => left.from - right.from || left.to - right.to);
  const merged: EscapeSourceRange[] = [];
  for (const range of ordered) {
    const previous = merged[merged.length - 1];
    if (previous && range.from <= previous.to) previous.to = Math.max(previous.to, range.to);
    else merged.push(range);
  }
  return merged;
}

function isInsideProtectedRange(
  ranges: readonly EscapeSourceRange[],
  rangeIndex: { value: number },
  from: number,
  to: number
): boolean {
  while (rangeIndex.value < ranges.length && ranges[rangeIndex.value].to <= from) rangeIndex.value++;
  const current = ranges[rangeIndex.value];
  return !!current && current.from < to;
}

function isEditingLine(
  state: EditorState,
  node: SyntaxNode,
  options: EscapeDecorationOptions
): boolean {
  const line = state.doc.lineAt(node.from);
  const cursorOnLine = line.from <= options.cursorTo && line.to >= options.cursorFrom;
  const revealed = !!options.navigationReveal
    && options.navigationReveal.from <= line.to && options.navigationReveal.to >= line.from;
  const activeParagraphLine = !!options.activeParagraph
    && options.activeParagraph.from <= line.from && options.activeParagraph.to >= line.to;
  return cursorOnLine || revealed || activeParagraphLine || isNavigationRevealLine(state, line.from, line.to);
}

/** Hide only Lezer-recognized CommonMark escape backslashes in preview decorations. */
export function buildEscapeDecorations(
  state: EditorState,
  tree: { iterate(spec: { enter(node: SyntaxNode): boolean | void }): void },
  options: EscapeDecorationOptions
): TextDecorationEntry[] {
  const protectedRanges = mergeRanges(options.protectedRanges);
  const entries: TextDecorationEntry[] = [];
  const rangeIndex = { value: 0 };

  tree.iterate({
    enter(node) {
      if (LITERAL_CONTAINERS.has(node.name)) return false;
      if (node.name !== "Escape" || node.to - node.from !== 2) return;
      if (state.sliceDoc(node.from, node.from + 1) !== "\\") return;
      const punctuation = state.sliceDoc(node.from + 1, node.to).charCodeAt(0);
      if (!isAsciiPunctuation(punctuation)) return;
      if (isInsideProtectedRange(protectedRanges, rangeIndex, node.from, node.to)) return;
      if (isEditingLine(state, node, options)) return;

      entries.push({ from: node.from, to: node.from + 1, deco: Decoration.replace({}), priority: 0 });
      return false;
    }
  });

  return entries;
}
