import { history, undo } from "@codemirror/commands";
import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { describe, expect, it } from "vitest";
import { createAiEditTransaction } from "../../src/core/cm6/aiEditTransaction";

describe("CM6 AI edit transactions", () => {
  it("isolates AI changes from later human typing", () => {
    const initial = EditorState.create({ doc: "original", extensions: [history()] });
    const aiTransaction = createAiEditTransaction(initial, 0, 8, "original", "AI text");
    expect(aiTransaction).not.toBeNull();
    const aiState = initial.update(aiTransaction!).state;
    const typingState = aiState.update({ changes: { from: 7, insert: "X" }, userEvent: "input.type" }).state;
    let currentState = typingState;
    const fakeView = {
      get state() { return currentState; },
      dispatch: (transaction: Parameters<EditorState["update"]>[0]) => {
        currentState = currentState.update(transaction).state;
      }
    } as unknown as EditorView;
    expect(undo(fakeView)).toBe(true);
    expect(currentState.doc.toString()).toBe("AI text");
  });

  it("rejects edits and undo while EditorState is read-only", () => {
    const state = EditorState.create({ doc: "protected", extensions: [history(), EditorState.readOnly.of(true)] });
    expect(createAiEditTransaction(state, 0, 9, "protected", "changed")).toBeNull();
    const dispatched: unknown[] = [];
    const fakeView = { state, dispatch: (transaction: unknown) => dispatched.push(transaction) } as unknown as EditorView;
    expect(undo(fakeView)).toBe(false);
    expect(dispatched).toHaveLength(0);
  });

  it("rejects stale expected content and invalid ranges", () => {
    const state = EditorState.create({ doc: "same same" });
    expect(createAiEditTransaction(state, 0, 4, "same", "new")).not.toBeNull();
    expect(createAiEditTransaction(state, 5, 9, "wrong", "new")).toBeNull();
    expect(createAiEditTransaction(state, -1, 2, "", "new")).toBeNull();
  });
});
