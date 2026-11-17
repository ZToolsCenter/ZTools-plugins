import type { SyntaxNode } from "@lezer/common";
import { GFM, parser } from "@lezer/markdown";
import { resolveEmojiShortcode } from "./emojiDictionary";

const inlineParser = parser.configure(GFM);
const MARKER_NODES = new Set(["EmphasisMark", "StrongEmphasisMark", "StrikethroughMark", "LinkMark", "CodeMark"]);
const MAX_INLINE_DISPLAY_SOURCE_CODE_UNITS = 4 * 1024;

function children(node: SyntaxNode): SyntaxNode[] {
  const result: SyntaxNode[] = [];
  for (let child = node.firstChild; child; child = child.nextSibling) result.push(child);
  return result;
}

function plainDisplayText(raw: string): string {
  return raw.replace(/:([a-zA-Z0-9_+\-]+):/gu, (match, shortcode: string) => resolveEmojiShortcode(shortcode) || match);
}

function markerChildren(node: SyntaxNode, name: string): SyntaxNode[] {
  return children(node).filter(child => child.name === name);
}

function renderRange(source: string, start: number, end: number, nodes: readonly SyntaxNode[]): string {
  let output = "";
  let cursor = start;
  for (const node of nodes) {
    if (node.to <= start || node.from >= end) continue;
    const from = Math.max(node.from, start);
    const to = Math.min(node.to, end);
    if (from > cursor) output += plainDisplayText(source.slice(cursor, from));
    if (to <= cursor) continue;
    output += renderNode(source, node);
    cursor = to;
  }
  if (cursor < end) output += plainDisplayText(source.slice(cursor, end));
  return output;
}

function linkLabelRange(node: SyntaxNode): { from: number; to: number } | null {
  const marks = markerChildren(node, "LinkMark");
  if (marks.length < 2 || marks[0]!.to > marks[1]!.from) return null;
  return { from: marks[0]!.to, to: marks[1]!.from };
}

function renderNode(source: string, node: SyntaxNode): string {
  const nested = children(node);
  if (MARKER_NODES.has(node.name)) return "";
  if (node.name === "Escape") return source.slice(node.from + 1, node.to);
  if (node.name === "InlineCode") {
    const marks = markerChildren(node, "CodeMark");
    const from = marks[0]?.to ?? node.from;
    const to = marks.at(-1)?.from ?? node.to;
    return source.slice(from, to);
  }
  if (node.name === "Link" || node.name === "Image") {
    const label = linkLabelRange(node);
    if (label) return renderRange(source, label.from, label.to, nested);
  }
  return renderRange(source, node.from, node.to, nested);
}

/** Projects inline Markdown to a display-only title without changing source coordinates or identifiers. */
export function markdownInlineDisplayText(rawHeading: string): string {
  const source = String(rawHeading ?? "");
  if (!source || source.length > MAX_INLINE_DISPLAY_SOURCE_CODE_UNITS) return source;
  try {
    const tree = inlineParser.parse(source);
    return renderNode(source, tree.topNode);
  } catch (error) {
    if (error instanceof RangeError) return source;
    throw error;
  }
}
