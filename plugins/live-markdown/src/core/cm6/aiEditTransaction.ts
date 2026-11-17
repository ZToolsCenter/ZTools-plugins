import { isolateHistory } from "@codemirror/commands";
import { EditorState, TransactionSpec } from "@codemirror/state";

/** Build a guarded AI edit isolated from adjacent typing in CM6 undo history. */
export function createAiEditTransaction(
  state: EditorState,
  from: number,
  to: number,
  expectedText: string,
  text: string
): TransactionSpec | null {
  if (state.readOnly || !Number.isInteger(from) || !Number.isInteger(to) || from < 0 || to < from || to > state.doc.length) return null;
  if (state.sliceDoc(from, to) !== expectedText) return null;
  return {
    changes: { from, to, insert: text },
    selection: { anchor: from + text.length },
    userEvent: "input.ai",
    annotations: isolateHistory.of("full")
  };
}
