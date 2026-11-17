import { EditorState } from "@codemirror/state";
import { Decoration } from "@codemirror/view";
import { syntaxTree } from "@codemirror/language";
import type { SyntaxNode } from "@lezer/common";
import { markdownInlineDisplayText } from "../markdownInlineDisplayText";
import { TocBlockWidget, TocHeadingItem } from "./widgets";
import type { ProtectedMathRange, TextDecorationEntry } from "./textNodeDecorations";

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

function isRootParagraph(tree: ReturnType<typeof syntaxTree>, position: number): boolean {
  let node: SyntaxNode | null = tree.resolveInner(position, 1);
  while (node && node.name !== "Paragraph") node = node.parent;
  return node?.parent?.name === "Document";
}

function collectHeadings(
  state: EditorState,
  tree: ReturnType<typeof syntaxTree>,
  excludedBlocks: readonly ProtectedMathRange[]
): TocHeadingItem[] {
  const headings: TocHeadingItem[] = [];
  tree.iterate({
    enter: (node) => {
      if (!node.name.startsWith("ATXHeading")) return;
      const excludedIndex = firstProtectedRangeAfter(excludedBlocks, node.from);
      if (excludedIndex < excludedBlocks.length && excludedBlocks[excludedIndex].from < node.to) return false;
      const level = parseInt(node.name.replace("ATXHeading", ""), 10) || 1;
      const rawHeading = state.sliceDoc(node.from, node.to).replace(/^#{1,6}\s+/, "").trim();
      const text = markdownInlineDisplayText(rawHeading);
      headings.push({ level, text, from: node.from });
    }
  });
  return headings;
}

/** Finds literal TOC lines inside a top-level Markdown paragraph. */
export function buildTocDecorations(
  state: EditorState,
  tree: ReturnType<typeof syntaxTree>,
  from: number,
  to: number,
  cursorMin: number,
  cursorMax: number,
  excludedBlocks: readonly ProtectedMathRange[] = []
): TextDecorationEntry[] {
  const raw = state.sliceDoc(from, to);
  const entries: TextDecorationEntry[] = [];
  let headings: TocHeadingItem[] | null = null;
  const lines = raw.matchAll(/[^\r\n]*/g);
  for (const lineMatch of lines) {
    const line = lineMatch[0];
    if (!line || !/^\s*\[toc\]\s*$/i.test(line)) continue;
    const marker = line.match(/\[toc\]/i);
    if (!marker) continue;
    const markerFrom = from + (lineMatch.index || 0) + marker.index!;
    const markerTo = markerFrom + marker[0].length;
    if (!isRootParagraph(tree, markerFrom)) continue;
    const cursorTouchesMarker = cursorMin <= markerTo && cursorMax >= markerFrom;
    if (cursorTouchesMarker) continue;

    entries.push({
      from: markerFrom,
      to: markerTo,
      deco: Decoration.replace({
        widget: new TocBlockWidget(headings ??= collectHeadings(state, tree, excludedBlocks)),
        block: true
      }),
      priority: 0
    });
  }
  return entries;
}
