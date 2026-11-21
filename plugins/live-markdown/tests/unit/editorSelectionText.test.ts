import { describe, expect, it } from "vitest";
import { readEditorSelectionText } from "../../src/core/ai/editorSelectionText";

function selectionFor(options: {
  start: Node;
  end?: Node;
  text: string;
  collapsed?: boolean;
}): Selection {
  return {
    rangeCount: 1,
    isCollapsed: options.collapsed ?? false,
    getRangeAt: () => ({
      startContainer: options.start,
      endContainer: options.end ?? options.start
    }) as Range,
    toString: () => options.text
  } as unknown as Selection;
}

describe("native editor selection tracking", () => {
  it("returns selected text when the range is fully inside the editor", () => {
    const editorText = {} as Node;
    const editor = { contains: (node: Node) => node === editorText } as HTMLElement;

    expect(readEditorSelectionText(selectionFor({ start: editorText, text: "  selected text  " }), editor))
      .toBe("selected text");
  });

  it("clears tracked text for a collapsed editor selection", () => {
    const editorText = {} as Node;
    const editor = { contains: (node: Node) => node === editorText } as HTMLElement;

    expect(readEditorSelectionText(selectionFor({ start: editorText, text: "", collapsed: true }), editor))
      .toBe("");
  });

  it("ignores selections in the assistant or outside the editor", () => {
    const editorText = {} as Node;
    const assistantText = {} as Node;
    const editor = { contains: (node: Node) => node === editorText } as HTMLElement;

    expect(readEditorSelectionText(selectionFor({ start: assistantText, text: "warning text" }), editor))
      .toBeNull();
  });

  it("ignores a range that crosses the editor boundary", () => {
    const editorText = {} as Node;
    const externalText = {} as Node;
    const editor = { contains: (node: Node) => node === editorText } as HTMLElement;

    expect(readEditorSelectionText(selectionFor({ start: editorText, end: externalText, text: "mixed" }), editor))
      .toBeNull();
  });
});
