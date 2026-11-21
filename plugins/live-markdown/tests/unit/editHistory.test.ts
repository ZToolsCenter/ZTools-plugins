import { describe, it, expect, beforeEach } from "vitest";
import { EditHistoryManager } from "../../src/core/editHistory";

describe("EditHistoryManager (Fine-Grained Transactional History)", () => {
  let history: EditHistoryManager;

  beforeEach(() => {
    history = new EditHistoryManager("", 0);
  });

  it("handles basic typing and initial state", () => {
    expect(history.canUndo()).toBe(false);
    expect(history.canRedo()).toBe(false);
    expect(history.getCurrent().value).toBe("");
  });

  it("accurately undos '2' when typing '1. 2' into an ordered list", () => {
    // 1. User types "1. " (list prefix with delimiter space)
    history.push("1. ", 3, 3);
    expect(history.getCurrent().value).toBe("1. ");
    expect(history.canUndo()).toBe(true);

    // 2. User types "2" (the list content)
    history.push("1. 2", 4, 4);
    expect(history.getCurrent().value).toBe("1. 2");

    // 3. User hits Undo (Cmd+Z)
    // MUST undo '2' and restore '1. ' with cursor at index 3!
    const undoRes1 = history.undo();
    expect(undoRes1).not.toBeNull();
    expect(undoRes1?.value).toBe("1. ");
    expect(undoRes1?.selectionStart).toBe(3);
    expect(undoRes1?.selectionEnd).toBe(3);

    // 4. User hits Redo (Cmd+Shift+Z)
    // MUST redo '2' and restore '1. 2' with cursor at index 4!
    const redoRes = history.redo();
    expect(redoRes).not.toBeNull();
    expect(redoRes?.value).toBe("1. 2");
    expect(redoRes?.selectionStart).toBe(4);

    // 5. User hits Undo again -> back to '1. '
    const undoBack = history.undo();
    expect(undoBack?.value).toBe("1. ");

    // 6. User hits Undo once more -> back to initial empty string ""
    const undoInitial = history.undo();
    expect(undoInitial?.value).toBe("");
    expect(undoInitial?.selectionStart).toBe(0);
    expect(history.canUndo()).toBe(false);
  });

  it("handles structural enter events with force: true", () => {
    history.push("1. First item", 13, 13);
    // User presses enter, producing auto-incremented list prefix
    history.push("1. First item\n2. ", 17, 17, { force: true, actionTag: "list-enter" });

    expect(history.getCurrent().value).toBe("1. First item\n2. ");

    // User types content for second item
    history.push("1. First item\n2. Second item", 28, 28);

    // Undo content first
    const u1 = history.undo();
    expect(u1?.value).toBe("1. First item\n2. ");
    expect(u1?.selectionStart).toBe(17);

    // Undo auto-incremented line
    const u2 = history.undo();
    expect(u2?.value).toBe("1. First item");
  });

  it("does not corrupt history stack on simple cursor repositioning", () => {
    history.push("Hello world", 11, 11);
    // User clicks between 'Hello' and 'world'
    history.push("Hello world", 5, 5);

    expect(history.getCurrent().selectionStart).toBe(5);
    // Undo should still undo the text insertion
    const u = history.undo();
    expect(u?.value).toBe("");
  });
});
