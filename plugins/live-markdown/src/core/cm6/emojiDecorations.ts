import { EditorState } from "@codemirror/state";
import { Decoration, WidgetType } from "@codemirror/view";
import { syntaxTree } from "@codemirror/language";
import { resolveEmojiShortcode } from "../emojiDictionary";
import type { TextDecorationEntry } from "./textNodeDecorations";

interface SourceRange { from: number; to: number }
const literalNodes = new Set(["FencedCode", "CodeBlock", "InlineCode", "URL", "Autolink", "LinkReference", "HTMLBlock", "HTMLTag", "Escape"]);

class EmojiWidget extends WidgetType {
  constructor(readonly shortcode: string, readonly emoji: string) { super(); }
  eq(other: EmojiWidget) { return this.shortcode === other.shortcode && this.emoji === other.emoji; }
  toDOM() {
    const span = document.createElement("span");
    span.className = "ty-cm6-emoji";
    span.textContent = this.emoji;
    span.title = this.shortcode;
    span.setAttribute("role", "img");
    span.setAttribute("aria-label", this.shortcode);
    return span;
  }
}

/** The TOC shares shortcode display while keeping escapes and code literals intact. */
export function previewEmojiText(text: string): string {
  return text.replace(/(`+)[\s\S]*?\1|\\.|:([a-z0-9_+\-]+):/gi,
    (raw, _fence, shortcode: string | undefined) => shortcode ? resolveEmojiShortcode(shortcode) ?? raw : raw);
}

export function buildEmojiDecorations(
  state: EditorState, tree: ReturnType<typeof syntaxTree>, cursorMin: number, cursorMax: number,
  excluded: readonly SourceRange[] = [], navigationReveal?: SourceRange | null,
  activeParagraph?: SourceRange | null
): TextDecorationEntry[] {
  // Background parsing is incremental. Leave the unknown tail as literal source.
  const source = state.sliceDoc(0, tree.length);
  const blocked = [...excluded];
  tree.iterate({ enter(node) {
    if (literalNodes.has(node.name)) { blocked.push({ from: node.from, to: node.to }); return false; }
  } });
  for (const match of source.matchAll(/\$\$[\s\S]*?\$\$|\$(?:\\.|[^$\r\n])+\$/g)) {
    blocked.push({ from: match.index, to: match.index + match[0].length });
  }
  blocked.sort((a, b) => a.from - b.from || a.to - b.to);
  const entries: TextDecorationEntry[] = [];
  let blockedIndex = 0;
  for (const match of source.matchAll(/:([a-z0-9_+\-]+):/gi)) {
    const from = match.index, to = from + match[0].length;
    while (blockedIndex < blocked.length && blocked[blockedIndex].to <= from) blockedIndex++;
    if (blockedIndex < blocked.length && blocked[blockedIndex].from < to) continue;
    const emoji = resolveEmojiShortcode(match[1]);
    if (!emoji) continue;
    const line = state.doc.lineAt(from);
    const cursorOnLine = cursorMin <= line.to && cursorMax >= line.from;
    const navigationOnLine = !!navigationReveal && navigationReveal.from <= line.to && navigationReveal.to >= line.from;
    const activeParagraphLine = !!activeParagraph
      && activeParagraph.from <= line.from && activeParagraph.to >= line.to;
    if (cursorOnLine || navigationOnLine || activeParagraphLine) continue;
    entries.push({ from, to, deco: Decoration.replace({ widget: new EmojiWidget(match[0], emoji) }), priority: 0 });
  }
  return entries;
}
