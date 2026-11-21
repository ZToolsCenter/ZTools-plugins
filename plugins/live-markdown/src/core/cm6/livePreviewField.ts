import { EditorState, StateField } from "@codemirror/state";
import { Decoration, DecorationSet, EditorView } from "@codemirror/view";
import { syntaxTree } from "@codemirror/language";
import type { SoftBreakSourceRange } from "./softBreakPreview";
import { isNavigationRevealEffect } from "./navigationReveal";
import { isPreviewEditing } from "./previewFocus";

export interface LivePreviewDecorationState {
  decorations: DecorationSet;
  joins: DecorationSet;
}

type DecorationBuilder = (state: EditorState, joinRanges: SoftBreakSourceRange[]) => DecorationSet;

/** Isolate StateField lifecycle and the two CM6 decoration layers from rendering. */
export function createLivePreviewField(build: DecorationBuilder): StateField<LivePreviewDecorationState> {
  return StateField.define<LivePreviewDecorationState>({
    create(state) {
      return buildDecorationState(state, build);
    },
    update(value, transaction) {
      if (transaction.docChanged || transaction.selection || transaction.reconfigured
        || transaction.effects.some(isNavigationRevealEffect)
        || isPreviewEditing(transaction.startState) !== isPreviewEditing(transaction.state)
        || syntaxTree(transaction.startState) !== syntaxTree(transaction.state)) {
        return buildDecorationState(transaction.state, build);
      }
      return value;
    },
    provide: (field) => [
      EditorView.decorations.from(field, value => value.decorations),
      EditorView.outerDecorations.from(field, value => value.joins)
    ]
  });
}

function buildDecorationState(state: EditorState, build: DecorationBuilder): LivePreviewDecorationState {
  const joinRanges: SoftBreakSourceRange[] = [];
  const decorations = build(state, joinRanges);
  const joins = Decoration.set(joinRanges.map(({ from, to }) =>
    Decoration.mark({ class: "cm-softbreak-join" }).range(from, to)
  ), true);
  return { decorations, joins };
}
