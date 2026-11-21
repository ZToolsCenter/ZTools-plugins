import { describe, expect, it } from "vitest";
import {
  handleListBackspace,
  handleListEnter,
  handleListTab,
  renumberOrderedList
} from "../../src/core/listAutoIndent";

describe("listAutoIndent Unit Tests", () => {
  it("should auto-increment ordered list numbers on Enter", () => {
    const text = "1. Item 1";
    const res = handleListEnter(text, text.length, text.length);

    expect(res.handled).toBe(true);
    expect(res.newText).toBe("1. Item 1\n2. ");
    expect(res.newCursorPos).toBe("1. Item 1\n2. ".length);
    expect(res.isListExit).toBe(false);
  });

  it("should auto-increment from multi-digit numbers (e.g., 9 -> 10)", () => {
    const text = "9. Item 9";
    const res = handleListEnter(text, text.length, text.length);

    expect(res.handled).toBe(true);
    expect(res.newText).toBe("9. Item 9\n10. ");
    expect(res.newCursorPos).toBe("9. Item 9\n10. ".length);
  });

  it("should preserve indentation for nested ordered list", () => {
    const text = "  1. Nested Item";
    const res = handleListEnter(text, text.length, text.length);

    expect(res.handled).toBe(true);
    expect(res.newText).toBe("  1. Nested Item\n  2. ");
    expect(res.newCursorPos).toBe("  1. Nested Item\n  2. ".length);
  });

  it("should exit ordered list on empty item Enter", () => {
    const text = "1. First\n2. ";
    const cursorPos = text.length;
    const res = handleListEnter(text, cursorPos, cursorPos);

    expect(res.handled).toBe(true);
    expect(res.isListExit).toBe(true);
    expect(res.newText).toBe("1. First\n");
    expect(res.newCursorPos).toBe("1. First\n".length);
  });

  it("should treat single '*' without space as regular paragraph text (handled: false)", () => {
    // Pure '*' without trailing space must NOT trigger list (could be italic *text* or math)
    const text = "*";
    const res = handleListEnter(text, text.length, text.length);
    expect(res.handled).toBe(false);
    expect(res.newText).toBe("*");
  });

  it("should recognize '* ' with space as unordered list and continue '* ' on Enter", () => {
    const text = "* First Item";
    const res = handleListEnter(text, text.length, text.length);
    expect(res.handled).toBe(true);
    expect(res.newText).toBe("* First Item\n* ");
    expect(res.newCursorPos).toBe("* First Item\n* ".length);
    expect(res.isListExit).toBe(false);
  });

  it("should exit '* ' unordered list on empty item Enter", () => {
    const text = "* First Item\n* ";
    const res = handleListEnter(text, text.length, text.length);
    expect(res.handled).toBe(true);
    expect(res.isListExit).toBe(true);
    expect(res.newText).toBe("* First Item\n");
  });

  it("should strip '* ' marker on Backspace when empty and convert to plain line", () => {
    const text = "* ";
    const res = handleListBackspace(text, text.length, text.length);
    expect(res).not.toBeNull();
    expect(res?.handled).toBe(true);
    expect(res?.newText).toBe("");
    expect(res?.newCursorPos).toBe(0);
  });

  it("should strip '* ' prefix on Backspace when cursor is at '* |content'", () => {
    const text = "* Item Content";
    const res = handleListBackspace(text, "* ".length, "* ".length);
    expect(res).not.toBeNull();
    expect(res?.handled).toBe(true);
    expect(res?.newText).toBe("Item Content");
    expect(res?.newCursorPos).toBe(0);
  });

  it("should indent '* ' unordered list by 2 spaces on Tab and outdent on Shift+Tab", () => {
    const text = "* Subitem";
    const tabRes = handleListTab(text, 2, 2, false);
    expect(tabRes.handled).toBe(true);
    expect(tabRes.newText).toBe("  * Subitem");

    const outdentRes = handleListTab(tabRes.newText, 4, 4, true);
    expect(outdentRes.handled).toBe(true);
    expect(outdentRes.newText).toBe("* Subitem");
  });

  it("should continue unordered list markers (- , * , +)", () => {
    const text1 = "- Item A";
    const res1 = handleListEnter(text1, text1.length, text1.length);
    expect(res1.newText).toBe("- Item A\n- ");

    const text2 = "* Item B";
    const res2 = handleListEnter(text2, text2.length, text2.length);
    expect(res2.newText).toBe("* Item B\n* ");
  });

  it("should exit unordered list on empty item Enter", () => {
    const text = "- Item A\n- ";
    const res = handleListEnter(text, text.length, text.length);

    expect(res.handled).toBe(true);
    expect(res.isListExit).toBe(true);
    expect(res.newText).toBe("- Item A\n");
  });

  it("should continue task list with uncompleted item [ ]", () => {
    const text = "- [x] Done Task";
    const res = handleListEnter(text, text.length, text.length);

    expect(res.handled).toBe(true);
    expect(res.newText).toBe("- [x] Done Task\n- [ ] ");
  });

  it("should exit task list on empty task item Enter", () => {
    const text = "- [ ] Task 1\n- [ ] ";
    const res = handleListEnter(text, text.length, text.length);

    expect(res.handled).toBe(true);
    expect(res.isListExit).toBe(true);
    expect(res.newText).toBe("- [ ] Task 1\n");
  });

  it("should split line in the middle correctly", () => {
    const text = "1. Hello World";
    // Place cursor between "Hello" and " World"
    const cursorPos = "1. Hello".length;
    const res = handleListEnter(text, cursorPos, cursorPos);

    expect(res.handled).toBe(true);
    expect(res.newText).toBe("1. Hello\n2.  World");
    expect(res.newCursorPos).toBe("1. Hello\n2. ".length);
  });

  it("should treat '1.' without space as regular paragraph text (handled: false)", () => {
    // Typing "1." without space must NOT be recognized as an ordered list item
    const text = "1.";
    const res = handleListEnter(text, text.length, text.length);

    expect(res.handled).toBe(false);
    expect(res.newText).toBe("1.");
  });

  it("should treat '1.0' or '2.5' version/section numbers as regular paragraph text", () => {
    const text = "Version 1.0 is released.";
    const res = handleListEnter(text, text.length, text.length);

    expect(res.handled).toBe(false);
    expect(res.newText).toBe(text);
  });

  it("should recognize '1. ' with space as ordered list and exit on double enter", () => {
    // "1. " with space is an empty ordered list item; pressing Enter exits cleanly
    const text = "1. ";
    const res = handleListEnter(text, text.length, text.length);

    expect(res.handled).toBe(true);
    expect(res.isListExit).toBe(true);
    expect(res.newText).toBe("");
  });

  it("should ignore non-list lines", () => {
    const text = "This is a regular paragraph.";
    const res = handleListEnter(text, text.length, text.length);

    expect(res.handled).toBe(false);
    expect(res.newText).toBe(text);
  });

  describe("Smart Subsequent Renumbering on Enter (Auto-Increment)", () => {
    it("should smartly increment subsequent ordered items when pressing Enter in the middle", () => {
      const doc = "1. Item A\n2. Item B\n3. Item C";
      // Cursor at the end of line 1: "1. Item A"
      const pos = "1. Item A".length;
      const res = handleListEnter(doc, pos, pos);

      expect(res.handled).toBe(true);
      expect(res.newText).toBe("1. Item A\n2. \n3. Item B\n4. Item C");
      expect(res.newCursorPos).toBe("1. Item A\n2. ".length);
    });

    it("should smartly increment subsequent items when splitting an item in the middle", () => {
      const doc = "1. First\n2. Hello World\n3. Third";
      // Cursor between "Hello" and " World" on line 2
      const pos = "1. First\n2. Hello".length;
      const res = handleListEnter(doc, pos, pos);

      expect(res.handled).toBe(true);
      expect(res.newText).toBe("1. First\n2. Hello\n3.  World\n4. Third");
      expect(res.newCursorPos).toBe("1. First\n2. Hello\n3. ".length);
    });

    it("should preserve nested child lists without wrongly modifying child numbers", () => {
      const doc = "1. Parent 1\n  1. Child A\n  2. Child B\n2. Parent 2\n3. Parent 3";
      // Press Enter after Parent 1
      const pos = "1. Parent 1".length;
      const res = handleListEnter(doc, pos, pos);

      expect(res.handled).toBe(true);
      // Children remain 1. and 2., but Parent 2 and Parent 3 become 3 and 4!
      expect(res.newText).toBe(
        "1. Parent 1\n2. \n  1. Child A\n  2. Child B\n3. Parent 2\n4. Parent 3"
      );
    });

    it("should handle multi-digit number roll (e.g. 9 -> 10 -> 11)", () => {
      const doc = "9. Item Nine\n10. Item Ten";
      const pos = "9. Item Nine".length;
      const res = handleListEnter(doc, pos, pos);

      expect(res.handled).toBe(true);
      expect(res.newText).toBe("9. Item Nine\n10. \n11. Item Ten");
    });
  });

  describe("Smart Subsequent Renumbering on Backspace (Auto-Decrement)", () => {
    it("should smartly decrement subsequent items when deleting an empty item line", () => {
      const doc = "1. Item A\n2. \n3. Item B\n4. Item C";
      // Cursor on line 2 after "2. "
      const pos = "1. Item A\n2. ".length;
      const res = handleListBackspace(doc, pos, pos);

      expect(res).not.toBeNull();
      expect(res?.handled).toBe(true);
      expect(res?.newText).toBe("1. Item A\n2. Item B\n3. Item C");
      expect(res?.newCursorPos).toBe("1. Item A".length);
    });

    it("should smartly decrement subsequent items when backspacing at the beginning of content", () => {
      const doc = "1. Item A\n2. Item B\n3. Item C";
      // Cursor right after "2. " on line 2
      const pos = "1. Item A\n2. ".length;
      const res = handleListBackspace(doc, pos, pos);

      expect(res).not.toBeNull();
      expect(res?.handled).toBe(true);
      // Line 2 merges into Line 1, and Line 3 becomes 2.
      expect(res?.newText).toBe("1. Item A Item B\n2. Item C");
    });

    it("should strip list marker on line 1 and renumber remaining items from 1", () => {
      const doc = "1. Item A\n2. Item B\n3. Item C";
      const pos = "1. ".length;
      const res = handleListBackspace(doc, pos, pos);

      expect(res).not.toBeNull();
      expect(res?.handled).toBe(true);
      expect(res?.newText).toBe("Item A\n1. Item B\n2. Item C");
    });
  });

  describe("renumberOrderedList Global Normalizer", () => {
    it("should renumber discontinuous lists into clean 1, 2, 3 sequence", () => {
      const dis = "1. A\n3. B\n7. C";
      const clean = renumberOrderedList(dis);
      expect(clean).toBe("1. A\n2. B\n3. C");
    });
  });

  describe("handleListTab (Typora Indent & Outdent Alignment)", () => {
    it("should indent list item by 2 spaces when Tab is pressed", () => {
      const text = "1. First Item";
      const res = handleListTab(text, 3, 3, false);

      expect(res.handled).toBe(true);
      expect(res.newText).toBe("  1. First Item");
      expect(res.newCursorPos).toBe(3 + 2);
    });

    it("should outdent nested list item by 2 spaces when Shift+Tab is pressed", () => {
      const text = "  1. Nested Item";
      const res = handleListTab(text, 5, 5, true);

      expect(res.handled).toBe(true);
      expect(res.newText).toBe("1. Nested Item");
      expect(res.newCursorPos).toBe(5 - 2);
    });

    it("should insert 2 spaces for plain text when Tab is pressed without blurring", () => {
      const text = "const a = 1;";
      const res = handleListTab(text, 0, 0, false);

      expect(res.handled).toBe(true);
      expect(res.newText).toBe("  const a = 1;");
      expect(res.newCursorPos).toBe(2);
    });
  });
});
