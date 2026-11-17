import { describe, expect, it, vi } from "vitest";
import { EditorSelection, EditorState } from "@codemirror/state";
import { BlockType, EditorView } from "@codemirror/view";
import { markdown } from "@codemirror/lang-markdown";
import { correctSkippedAdjacentLine } from "../../src/core/cm6/verticalNavigation";
import { navigationRevealLine } from "../../src/core/cm6/navigationReveal";
import { buildLivePreviewDecorations } from "../../src/core/cm6/livePreviewPlugin";

function makeView(doc: string, currentPosition: number, currentBlockRange: { from: number; to: number }, targetBlockRange?: { from: number; to: number }) {
  let state = EditorState.create({
    doc,
    selection: EditorSelection.create([EditorSelection.cursor(currentPosition, -1, undefined, 38)]),
    extensions: [markdown(), navigationRevealLine, EditorState.readOnly.of(false), EditorView.editable.of(true)]
  });
  const currentLine = state.doc.lineAt(currentPosition);
  const currentBlock = { type: BlockType.Text, ...currentBlockRange, height: 26 };
  const targetBlock = targetBlockRange && { type: BlockType.Text, ...targetBlockRange, height: 52 };
  const view = {
    get state() { return state; },
    composing: false,
    compositionStarted: false,
    contentDOM: { getBoundingClientRect: () => ({ left: 100, right: 600, width: 500 }) },
    lineBlockAt: vi.fn((position: number) => {
      if (targetBlock && position >= targetBlock.from && position <= targetBlock.to) return targetBlock;
      if (position >= currentBlock.from && position <= currentBlock.to) return currentBlock;
      const line = state.doc.lineAt(position);
      return { type: BlockType.Text, from: line.from, to: line.to, height: 26 };
    }),
    moveVertically: vi.fn((current: typeof state.selection.main, forward: boolean) => {
      return EditorSelection.cursor(state.doc.line(forward ? state.doc.lines : 1).from, current.assoc, undefined, current.goalColumn);
    }),
    coordsAtPos: vi.fn((position: number) => {
      const target = targetBlock && position >= targetBlock.from && position <= targetBlock.to;
      const inCurrent = position >= currentBlock.from && position <= currentBlock.to;
      const top = target ? 470 : inCurrent ? 600 : 430;
      return { left: 138, right: 138, top, bottom: top + 18 };
    }),
    posAndSideAtCoords: vi.fn(({ y }: { x: number; y: number }) => {
      if (targetBlock && y < 550) return { pos: targetBlock.to, assoc: -1 as const };
      return { pos: currentLine.from, assoc: 1 as const };
    }),
    dispatch: vi.fn((spec: Parameters<EditorView["dispatch"]>[0]) => { state = state.update(spec).state; })
  } as unknown as EditorView & {
    lineBlockAt: ReturnType<typeof vi.fn>;
    moveVertically: ReturnType<typeof vi.fn>;
    posAndSideAtCoords: ReturnType<typeof vi.fn>;
    dispatch: ReturnType<typeof vi.fn>;
  };
  return { view, getState: () => state };
}

describe("CM6 soft-flow navigation across rendered text blocks", () => {
  it("keeps active paragraph-wide Strong and emoji reveal in the final flow layout", () => {
    const doc = "active first line\n**bold second line** :rocket:";
    const state = EditorState.create({
      doc,
      selection: EditorSelection.create([EditorSelection.cursor(2)]),
      extensions: [markdown(), navigationRevealLine]
    });
    const decorations = buildLivePreviewDecorations(state);
    const softLf = state.doc.line(1).to;
    let foldedLf = false;
    let expandedStrong = false;
    let expandedEmoji = true;
    decorations.between(softLf, softLf + 1, (_from, _to, decoration) => {
      if ((decoration as unknown as { isReplace?: boolean }).isReplace) foldedLf = true;
    });
    const strongFrom = doc.indexOf("**bold");
    decorations.between(strongFrom, strongFrom + 2, (_from, _to, decoration) => {
      if (decoration.spec.class?.includes("cm-ghost-mark")) expandedStrong = true;
    });
    const emojiFrom = doc.indexOf(":rocket:");
    decorations.between(emojiFrom, emojiFrom + ":rocket:".length, (_from, _to, decoration) => {
      if (decoration.spec.widget !== undefined) expandedEmoji = false;
    });

    expect(foldedLf).toBe(true);
    expect(expandedStrong).toBe(true);
    expect(expandedEmoji).toBe(true);
    expect(state.doc.toString()).toBe(doc);
  });

  it("uses a merged active source block boundary to recover the next empty line", () => {
    const doc = "above\n\ncurrent first\ncurrent second\n\nbelow";
    const first = doc.indexOf("current first");
    const last = doc.indexOf("current second") + "current second".length;
    const blankLine = doc.indexOf("\n\nbelow") + 1;
    const { view, getState } = makeView(doc, last, { from: first, to: last });

    expect(correctSkippedAdjacentLine(view, true)).toBe(true);
    expect(getState().selection.main.head).toBe(blankLine);
    expect(getState().doc.toString()).toBe(doc);
    expect(view.moveVertically).toHaveBeenCalledOnce();
  });

  it("repairs a native jump to an empty block when another visual row remains in the active merged block", () => {
    const doc = "above\n\ncurrent first\ncurrent second\n\nbelow";
    const first = doc.indexOf("current first");
    const second = doc.indexOf("current second");
    const last = second + "current second".length;
    const emptyLine = doc.indexOf("\n\nbelow") + 1;
    let state = EditorState.create({
      doc,
      selection: EditorSelection.create([EditorSelection.cursor(first + 4, 1, undefined, 38)]),
      extensions: [markdown(), navigationRevealLine, EditorState.readOnly.of(false), EditorView.editable.of(true)]
    });
    const block = { type: BlockType.Text, from: first, to: last, height: 44.8 };
    const secondLine = state.doc.lineAt(second);
    const view = {
      get state() { return state; },
      composing: false,
      compositionStarted: false,
      defaultLineHeight: 22.4,
      contentDOM: {
        ownerDocument: {},
        getBoundingClientRect: () => ({ left: 100, right: 600, width: 500 })
      },
      lineBlockAt: vi.fn((pos: number) => pos >= block.from && pos <= block.to
        ? block
        : { type: BlockType.Text, from: state.doc.lineAt(pos).from, to: state.doc.lineAt(pos).to, height: 26.4 }),
      moveVertically: vi.fn((current: typeof state.selection.main) =>
        EditorSelection.cursor(emptyLine, current.assoc, undefined, current.goalColumn)),
      coordsAtPos: vi.fn((pos: number) => {
        const isSecondRow = pos >= secondLine.from && pos <= secondLine.to;
        const top = isSecondRow ? 522.4 : 500;
        return { left: 138, right: 138, top, bottom: top + 18 };
      }),
      posAndSideAtCoords: vi.fn(() => ({ pos: secondLine.from + 2, assoc: -1 as const })),
      domAtPos: vi.fn(() => { throw new Error("unmounted fake view"); }),
      dispatch: vi.fn((spec: Parameters<EditorView["dispatch"]>[0]) => { state = state.update(spec).state; })
    } as unknown as EditorView & {
      moveVertically: ReturnType<typeof vi.fn>;
      posAndSideAtCoords: ReturnType<typeof vi.fn>;
      dispatch: ReturnType<typeof vi.fn>;
    };

    expect(correctSkippedAdjacentLine(view, true)).toBe(true);
    expect(view.moveVertically).toHaveBeenCalledOnce();
    expect(view.posAndSideAtCoords).toHaveBeenCalled();
    expect(state.selection.main.head).toBe(secondLine.from + 2);
    expect(state.selection.main.assoc).toBe(-1);
    expect(state.doc.toString()).toBe(doc);
  });

  it("reveals markup in a multiline target without unflowing its source LF", () => {
    const doc = "above\n**target first\nsecond**\n\nbelow";
    const targetFrom = doc.indexOf("**target");
    const targetTo = doc.indexOf("second**") + "second**".length;
    const blankLine = doc.indexOf("\n\nbelow") + 1;
    const { view, getState } = makeView(doc, blankLine, { from: blankLine, to: blankLine }, { from: targetFrom, to: targetTo });

    expect(correctSkippedAdjacentLine(view, false)).toBe(true);
    expect(view.dispatch).toHaveBeenCalledTimes(2);
    expect(getState().selection.main.head).toBe(targetTo);
    expect(getState().doc.toString()).toBe(doc);
    expect(getState().field(navigationRevealLine)).toBeNull();
    const [reveal, navigation] = view.dispatch.mock.calls.map(([spec]) => spec as { selection?: unknown; effects?: unknown });
    expect(reveal.selection).toBeUndefined();
    expect(navigation.selection).toBeDefined();
    expect(navigation.effects).toBeDefined();
  });
});
