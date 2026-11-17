import { EditorState, StateEffect, StateField } from "@codemirror/state";
import { syntaxTree } from "@codemirror/language";
import { resolveEmojiShortcode } from "../emojiDictionary";
import { findPreviewParagraphAt } from "./softBreakPreview";

export interface NavigationRevealLine {
  from: number;
  to: number;
}

/** Temporarily render one destination line as it will look while being edited. */
export const setNavigationRevealLine = StateEffect.define<NavigationRevealLine | null>();

export const navigationRevealLine = StateField.define<NavigationRevealLine | null>({
  create: () => null,
  update(value, transaction) {
    // A reveal exists only for one synchronous navigation. Never carry its
    // source offsets across an edit, selection transition, or reconfiguration.
    if (transaction.docChanged || transaction.selection || transaction.reconfigured) return null;
    let next = value;
    for (const effect of transaction.effects) {
      if (effect.is(setNavigationRevealLine)) next = effect.value;
    }
    return next;
  }
});

export function isNavigationRevealEffect(effect: StateEffect<unknown>): boolean {
  return effect.is(setNavigationRevealLine);
}

export function isNavigationRevealLine(state: EditorState, from: number, to: number): boolean {
  const reveal = state.field(navigationRevealLine, false);
  return reveal !== undefined && reveal !== null && reveal.from <= to && reveal.to >= from;
}

/** Bound the extra decoration pass to lines whose preview form may change width. */
export function needsNavigationReveal(
  state: EditorState,
  line: { from: number; to: number; length: number },
  currentPosition?: number
): boolean {
  const paragraph = findPreviewParagraphAt(state, line.from);
  if (paragraph && (currentPosition === undefined
    || currentPosition < paragraph.from || currentPosition > paragraph.to)) return true;

  const tree = syntaxTree(state);
  // An unparsed tail or an unusually long line cannot be safely classified by
  // scanning source text. Prefer the one bounded reveal pass for that boundary.
  if (line.length > 8192 || line.to > tree.length) return true;

  let needsReveal = false;
  tree.iterate({ from: line.from, to: line.to, enter(node) {
    if (node.name.startsWith("ATXHeading") || node.name === "StrongEmphasis") {
      needsReveal = true;
      return false;
    }
  } });
  if (needsReveal) return true;

  const text = state.sliceDoc(line.from, line.to);
  for (const match of text.matchAll(/:([a-z0-9_+\-]+):/gi)) {
    if (resolveEmojiShortcode(match[1])) return true;
  }
  return false;
}
