import { describe, expect, it, vi } from "vitest";
import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { positionAtVisualRow } from "../../src/core/cm6/navigationCoordinates";

function makeView({
  nativeNodeInside = true,
  nativeSupported = true,
  nativeThrows = false,
  rangeSupported = false
} = {}) {
  const doc = EditorState.create({ doc: "other\ntarget row\nnext" }).doc;
  const target = doc.line(2);
  const contentDOM = {
    contains: vi.fn((node: Node) => node === textNode)
  } as unknown as HTMLElement;
  const textNode = { nodeType: 3 } as unknown as Node;
  const outsideNode = { nodeType: 3 } as unknown as Node;
  const documentRef = {
    caretPositionFromPoint: nativeSupported
      ? vi.fn(() => {
        if (nativeThrows) throw new Error("unsupported native hit test");
        return { offsetNode: nativeNodeInside ? textNode : outsideNode, offset: 2 };
      })
      : undefined,
    caretRangeFromPoint: vi.fn(() => rangeSupported
      ? { startContainer: nativeNodeInside ? textNode : outsideNode, startOffset: 3 } as Range
      : null)
  } as unknown as Document;
  Object.defineProperty(contentDOM, "ownerDocument", { value: documentRef });

  const view = {
    state: { doc },
    contentDOM,
    posAtDOM: vi.fn(() => target.from + 2),
    posAndSideAtCoords: vi.fn(() => ({ pos: target.from + 1, assoc: -1 as const })),
    coordsAtPos: vi.fn((_pos: number, assoc: number) => assoc === 1
      ? { left: 200, right: 200, top: 20, bottom: 38 }
      : { left: 200, right: 200, top: 0, bottom: 18 })
  } as unknown as EditorView & {
    posAtDOM: ReturnType<typeof vi.fn>;
    posAndSideAtCoords: ReturnType<typeof vi.fn>;
  };
  return { view, target, textNode };
}

describe("CM6 rendered navigation coordinates", () => {
  it("uses the browser hit on the editable DOM and chooses the matching wrap affinity", () => {
    const { view, target, textNode } = makeView();

    const result = positionAtVisualRow(view, 200, 29, target, 29, 2);

    expect(view.posAtDOM).toHaveBeenCalledWith(textNode, 2);
    expect(view.posAndSideAtCoords).not.toHaveBeenCalled();
    expect(result).toEqual({ pos: target.from + 2, assoc: 1, distance: 0 });
  });

  it("falls back to the CM6 public coordinate hit when native DOM APIs are unsupported", () => {
    const { view, target } = makeView({ nativeSupported: false });

    const result = positionAtVisualRow(view, 200, 29, target, 29, 2);

    expect(view.posAndSideAtCoords).toHaveBeenCalledWith({ x: 200, y: 29 });
    expect(result).toEqual({ pos: target.from + 1, assoc: 1, distance: 0 });
  });

  it("supports the legacy caret range API", () => {
    const { view, target, textNode } = makeView({ nativeSupported: false, rangeSupported: true });

    const result = positionAtVisualRow(view, 200, 29, target, 29, 2);

    expect(view.posAtDOM).toHaveBeenCalledWith(textNode, 3);
    expect(result).toEqual({ pos: target.from + 2, assoc: 1, distance: 0 });
  });

  it("falls back safely when the native hit-test API throws", () => {
    const { view, target } = makeView({ nativeThrows: true });

    const result = positionAtVisualRow(view, 200, 29, target, 29, 2);

    expect(view.posAndSideAtCoords).toHaveBeenCalled();
    expect(result).toEqual({ pos: target.from + 1, assoc: 1, distance: 0 });
  });

  it("rejects DOM nodes outside the editor and visual-row mismatches", () => {
    const outside = makeView({ nativeNodeInside: false });
    expect(positionAtVisualRow(outside.view, 200, 29, outside.target, 29, 2)).toEqual({
      pos: outside.target.from + 1,
      assoc: 1,
      distance: 0
    });
    expect(outside.view.posAtDOM).not.toHaveBeenCalled();

    const wrongRow = makeView();
    wrongRow.view.coordsAtPos = vi.fn(() => ({ left: 200, right: 200, top: 0, bottom: 18 }));
    expect(positionAtVisualRow(wrongRow.view, 200, 29, wrongRow.target, 29, 2)).toBeNull();
  });
});
