import { history, historyField, undo, undoDepth } from "@codemirror/commands";
import { EditorState, Extension } from "@codemirror/state";
import { describe, expect, it } from "vitest";
import { captureCM6HistorySnapshot, isCM6HistorySnapshotFor, restoreCM6EditorState } from "../../src/core/cm6/historySnapshot";

const historyExtensions: Extension[] = [history()];

describe("CM6 history snapshots", () => {
  it("restores undo history into a fresh state only for the same document and content", () => {
    const initial = EditorState.create({ doc: "original", extensions: historyExtensions });
    const edited = initial.update({ changes: { from: 8, insert: " block" }, userEvent: "input.type" }).state;
    const snapshot = captureCM6HistorySnapshot("doc-a", edited);

    expect(isCM6HistorySnapshotFor(snapshot, "doc-a", "original block")).toBe(true);
    expect(isCM6HistorySnapshotFor(snapshot, "doc-b", "original block")).toBe(false);
    expect(isCM6HistorySnapshotFor(snapshot, "doc-a", "changed source")).toBe(false);

    const restored = restoreCM6EditorState("doc-a", "original block", historyExtensions, snapshot);
    expect(restored).not.toBe(edited);
    expect(restored.doc.toString()).toBe("original block");
    expect(undoDepth(restored)).toBeGreaterThan(0);
    expect(restored.field(historyField)).toBeDefined();

    let currentState = restored;
    const fakeView = {
      get state() { return currentState; },
      dispatch: (transaction: Parameters<EditorState["update"]>[0]) => {
        currentState = currentState.update(transaction).state;
      }
    };
    expect(undo(fakeView as never)).toBe(true);
    expect(currentState.doc.toString()).toBe("original");
  });

  it("starts clean when a snapshot belongs to another document or source version", () => {
    const edited = EditorState.create({ doc: "changed", extensions: historyExtensions });
    const snapshot = captureCM6HistorySnapshot("doc-a", edited);

    expect(undoDepth(restoreCM6EditorState("doc-b", "changed", historyExtensions, snapshot))).toBe(0);
    expect(undoDepth(restoreCM6EditorState("doc-a", "new source", historyExtensions, snapshot))).toBe(0);
  });
});
