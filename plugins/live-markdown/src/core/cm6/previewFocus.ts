import { EditorState, StateEffect, StateField } from "@codemirror/state";
import { EditorView, ViewPlugin, ViewUpdate } from "@codemirror/view";

const setPreviewFocus = StateEffect.define<boolean>();
const previewFocus = StateField.define<boolean>({
  create: () => false,
  update(value, transaction) {
    for (const effect of transaction.effects) if (effect.is(setPreviewFocus)) value = effect.value;
    return value;
  }
});

/** Standalone state builders keep selection semantics; mounted editors track actual focus. */
export function isPreviewEditing(state: EditorState): boolean {
  return !state.readOnly && (state.field(previewFocus, false) ?? true);
}

export const livePreviewFocus = [previewFocus, ViewPlugin.fromClass(class {
  private destroyed = false;
  constructor(private view: EditorView) { this.refresh(); }
  update(update: ViewUpdate) { if (update.focusChanged) this.refresh(); }
  private refresh() {
    queueMicrotask(() => {
      if (!this.destroyed && this.view.state.field(previewFocus) !== this.view.hasFocus) {
        this.view.dispatch({ effects: setPreviewFocus.of(this.view.hasFocus) });
      }
    });
  }
  destroy() { this.destroyed = true; }
})];
