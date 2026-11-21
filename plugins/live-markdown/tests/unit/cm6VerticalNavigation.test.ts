import { describe, expect, it, vi } from "vitest";
import { EditorSelection, EditorState } from "@codemirror/state";
import { BlockType, Decoration, EditorView } from "@codemirror/view";
import { markdown } from "@codemirror/lang-markdown";
import {
  correctSkippedAdjacentLine,
  findSkippedAdjacentEmptyLine
} from "../../src/core/cm6/verticalNavigation";
import { navigationRevealLine, needsNavigationReveal, setNavigationRevealLine } from "../../src/core/cm6/navigationReveal";
import { buildLivePreviewDecorations } from "../../src/core/cm6/livePreviewPlugin";

function mockView({
  currentLine,
  candidateLine,
  readOnly = false,
  composing = false,
  blockType = BlockType.Text
}: {
  currentLine: number;
  candidateLine: number;
  readOnly?: boolean;
  composing?: boolean;
  blockType?: BlockType;
}) {
  const doc = [...Array(8).fill("before"), "paragraph", "", "", "next"].join("\n");
  const state = EditorState.create({
    doc,
    selection: EditorSelection.create([EditorSelection.cursor(EditorState.create({ doc }).doc.line(currentLine).from)]),
    extensions: [markdown(), navigationRevealLine, EditorState.readOnly.of(readOnly), EditorView.editable.of(!readOnly)]
  });
  let currentState = state;
  return {
    get state() { return currentState; },
    composing,
    compositionStarted: false,
    moveVertically: vi.fn(() => EditorSelection.cursor(state.doc.line(candidateLine).from, -1, undefined, 42)),
    lineBlockAt: vi.fn((pos: number) => {
      const line = state.doc.lineAt(pos);
      return { type: blockType, from: line.from, to: line.to, height: 26.390625 };
    }),
    dispatch: vi.fn((spec: Parameters<EditorView["dispatch"]>[0]) => { currentState = currentState.update(spec).state; })
  } as unknown as EditorView & {
    moveVertically: ReturnType<typeof vi.fn>;
    lineBlockAt: ReturnType<typeof vi.fn>;
    dispatch: ReturnType<typeof vi.fn>;
  };
}

function mockShortRowView({ atomic = false, probeVisualOffset = 0 }: { atomic?: boolean; probeVisualOffset?: number } = {}) {
  const doc = "before\nintro\n版。\n\nnext";
  const state = EditorState.create({
    doc,
    selection: EditorSelection.create([EditorSelection.cursor(EditorState.create({ doc }).doc.line(4).from, -1, 2, 56)]),
    extensions: [
      markdown(),
      EditorState.readOnly.of(false),
      EditorView.editable.of(true),
      navigationRevealLine,
      EditorView.atomicRanges.of((view) => atomic
        ? Decoration.set([Decoration.replace({}).range(view.state.doc.line(3).from, view.state.doc.line(3).to)])
        : Decoration.none)
    ]
  });
  let currentState = state;
  const current = state.doc.line(4);
  const target = state.doc.line(3);
  const skipped = state.doc.line(1);
  const view = {
    get state() { return currentState; },
    composing: false,
    compositionStarted: false,
    contentDOM: { getBoundingClientRect: () => ({ left: 256, right: 744, width: 488 }) },
    lineBlockAt: vi.fn((pos: number) => {
      const line = state.doc.lineAt(pos);
      return { type: BlockType.Text, from: line.from, to: line.to, height: 26.390625 };
    }),
    moveVertically: vi.fn(() => EditorSelection.cursor(skipped.from, -1, 2, 56)),
    coordsAtPos: vi.fn((pos: number) => {
      const line = state.doc.lineAt(pos);
      const top = line.number === current.number
        ? 547.96875
        : line.number === target.number
          ? 521.578125 + (pos === target.from ? probeVisualOffset : 0)
          : 470;
      return { left: 312, right: 312, top, bottom: top + 18 };
    }),
    posAndSideAtCoords: vi.fn(({ y }: { x: number; y: number }) => y < 519
      ? { pos: target.from, assoc: -1 as const }
      : { pos: current.from, assoc: 1 as const }),
    dispatch: vi.fn((spec: Parameters<EditorView["dispatch"]>[0]) => { currentState = currentState.update(spec).state; })
  } as unknown as EditorView & {
    moveVertically: ReturnType<typeof vi.fn>;
    lineBlockAt: ReturnType<typeof vi.fn>;
    coordsAtPos: ReturnType<typeof vi.fn>;
    posAndSideAtCoords: ReturnType<typeof vi.fn>;
    dispatch: ReturnType<typeof vi.fn>;
  };
  return { view, current, target, skipped };
}

describe("CM6 vertical navigation correction", () => {
  it("repairs a native candidate that jumped over an adjacent empty line", () => {
    const state = EditorState.create({ doc: [...Array(8).fill("before"), "paragraph", "", "", "next"].join("\n") });
    const current = EditorSelection.cursor(state.doc.line(11).from);
    const nativeCandidate = EditorSelection.cursor(state.doc.line(9).from);

    expect(findSkippedAdjacentEmptyLine(state, current, nativeCandidate, false))
      .toBe(state.doc.line(10).from);
  });

  it("preserves native movement within a wrapped logical line", () => {
    const state = EditorState.create({ doc: "before\n\nlong paragraph" });
    const current = EditorSelection.cursor(state.doc.line(3).from);

    expect(findSkippedAdjacentEmptyLine(state, current, current, false)).toBeNull();
  });

  it("moves between adjacent empty logical lines when the native candidate stays put", () => {
    const state = EditorState.create({ doc: "paragraph\n\n\nnext" });
    const current = EditorSelection.cursor(state.doc.line(3).from);

    expect(findSkippedAdjacentEmptyLine(state, current, current, false))
      .toBe(state.doc.line(2).from);
  });

  it("repairs the symmetric downward skip without altering the retained goal column", () => {
    const state = EditorState.create({ doc: [...Array(8).fill("before"), "previous", "", "", "paragraph"].join("\n") });
    const current = EditorSelection.cursor(state.doc.line(10).from, 1, undefined, 36);
    const nativeCandidate = EditorSelection.cursor(state.doc.line(12).from, 1, undefined, 36);
    const correctedPosition = findSkippedAdjacentEmptyLine(state, current, nativeCandidate, true);

    expect(correctedPosition).toBe(state.doc.line(11).from);
    expect(nativeCandidate.goalColumn).toBe(36);
  });

  it("leaves adjacent content and correctly placed native candidates untouched", () => {
    const contentState = EditorState.create({ doc: "first\nsecond\nthird" });
    const current = EditorSelection.cursor(contentState.doc.line(3).from);
    const skippedCandidate = EditorSelection.cursor(contentState.doc.line(1).from);
    expect(findSkippedAdjacentEmptyLine(contentState, current, skippedCandidate, false)).toBeNull();

    const emptyState = EditorState.create({ doc: "first\n\nthird" });
    const emptyCurrent = EditorSelection.cursor(emptyState.doc.line(3).from);
    const nativeCandidate = EditorSelection.cursor(emptyState.doc.line(2).from);
    expect(findSkippedAdjacentEmptyLine(emptyState, emptyCurrent, nativeCandidate, false)).toBeNull();
  });

  it("does not invent a line at document boundaries", () => {
    const state = EditorState.create({ doc: "\ncontent" });
    const firstLine = EditorSelection.cursor(state.doc.line(1).from);
    const lastLine = EditorSelection.cursor(state.doc.line(2).from);

    expect(findSkippedAdjacentEmptyLine(state, firstLine, firstLine, false)).toBeNull();
    expect(findSkippedAdjacentEmptyLine(state, lastLine, lastLine, true)).toBeNull();
  });

  it("dispatches only the corrected selection and keeps CM6 goal and scroll semantics", () => {
    const view = mockView({ currentLine: 11, candidateLine: 9 });

    expect(correctSkippedAdjacentLine(view, false)).toBe(true);
    expect(view.moveVertically).toHaveBeenCalledOnce();
    const [transaction] = view.dispatch.mock.calls.at(-1) as [{
      selection: EditorSelection;
      scrollIntoView: boolean;
      userEvent: string;
    }];
    const applied = view.state.update(transaction).state.selection.main;
    expect(applied.head).toBe(view.state.doc.line(10).from);
    expect(applied.assoc).toBe(-1);
    expect(applied.goalColumn).toBe(42);
    expect(transaction.scrollIntoView).toBe(true);
    expect(transaction.userEvent).toBe("select");
  });

  it("uses rendered coordinates to recover a short adjacent text row skipped from an empty line", () => {
    const { view, target, skipped } = mockShortRowView();

    expect(view.state.selection.main.assoc).toBe(-1);
    expect(view.state.selection.main.bidiLevel).toBe(2);
    expect(view.state.selection.main.goalColumn).toBe(56);
    expect(correctSkippedAdjacentLine(view, false)).toBe(true);
    expect(view.moveVertically).toHaveBeenCalledOnce();
    expect(view.posAndSideAtCoords).toHaveBeenCalled();
    const [transaction] = view.dispatch.mock.calls.at(-1) as [{
      selection: EditorSelection;
      scrollIntoView: boolean;
      userEvent: string;
    }];
    const applied = view.state.update(transaction).state.selection.main;
    expect(applied.head).toBe(target.from);
    expect(applied.assoc).toBe(-1);
    expect(applied.bidiLevel).toBe(2);
    expect(applied.goalColumn).toBe(56);
    expect(applied.head).not.toBe(skipped.from);
    expect(transaction.scrollIntoView).toBe(true);
    expect(transaction.userEvent).toBe("select");
  });

  it("leaves the native candidate when the adjacent text row is atomic", () => {
    const { view } = mockShortRowView({ atomic: true });

    expect(correctSkippedAdjacentLine(view, false)).toBe(false);
    expect(view.dispatch).toHaveBeenCalledTimes(2);
    expect(view.dispatch.mock.calls.some(([spec]) => "selection" in (spec as object))).toBe(false);
  });

  it("does not accept a coordinate hit on the wrong visual row of the target logical line", () => {
    const { view } = mockShortRowView({ probeVisualOffset: -26.390625 });

    expect(correctSkippedAdjacentLine(view, false)).toBe(false);
    expect(view.posAndSideAtCoords).toHaveBeenCalled();
    expect(view.dispatch).toHaveBeenCalledTimes(2);
    expect(view.dispatch.mock.calls.some(([spec]) => "selection" in (spec as object))).toBe(false);
  });

  it("repairs a native move that skips a short text row between two text lines", () => {
    const doc = "intro\n级排\n版。\n\nnext";
    const state = EditorState.create({
      doc,
      selection: EditorSelection.create([EditorSelection.cursor(EditorState.create({ doc }).doc.line(3).from + 1, -1, undefined, 56)]),
      extensions: [markdown(), navigationRevealLine, EditorState.readOnly.of(false), EditorView.editable.of(true)]
    });
    const target = state.doc.line(2);
    const current = state.doc.line(3);
    const view = {
      state,
      composing: false,
      compositionStarted: false,
      contentDOM: { getBoundingClientRect: () => ({ left: 256, right: 744, width: 488 }) },
      lineBlockAt: vi.fn((pos: number) => {
        const line = state.doc.lineAt(pos);
        return { type: BlockType.Text, from: line.from, to: line.to, height: 26.4 };
      }),
      moveVertically: vi.fn(() => EditorSelection.cursor(state.doc.line(1).from, -1, 2, 56)),
      coordsAtPos: vi.fn((pos: number) => {
        const line = state.doc.lineAt(pos);
        const top = line.number === current.number ? 547 : line.number === target.number ? 521 : 470;
        return { left: 312, right: 312, top, bottom: top + 18 };
      }),
      posAndSideAtCoords: vi.fn(({ y }: { x: number; y: number }) => y < 519
        ? { pos: target.from, assoc: -1 as const }
        : { pos: current.from, assoc: 1 as const }),
      dispatch: vi.fn()
    } as unknown as EditorView & {
      moveVertically: ReturnType<typeof vi.fn>;
      posAndSideAtCoords: ReturnType<typeof vi.fn>;
      dispatch: ReturnType<typeof vi.fn>;
    };

    expect(correctSkippedAdjacentLine(view, false)).toBe(true);
    expect(view.dispatch).toHaveBeenCalledOnce();
    const transaction = view.dispatch.mock.calls[0][0] as { selection: EditorSelection };
    const applied = state.update(transaction).state.selection.main;
    expect(applied.head).toBe(target.from);
    expect(applied.assoc).toBe(-1);
    expect(applied.bidiLevel).toBe(2);
    expect(applied.goalColumn).toBe(56);
    expect(view.posAndSideAtCoords.mock.calls.length).toBeGreaterThan(1);
  });

  it("keeps native movement when text caret geometry is on an interior visual row", () => {
    const doc = "long paragraph\ncurrent row";
    const state = EditorState.create({
      doc,
      selection: EditorSelection.create([EditorSelection.cursor(doc.indexOf("current") + 3)]),
      extensions: [markdown(), navigationRevealLine, EditorState.readOnly.of(false), EditorView.editable.of(true)]
    });
    const current = state.doc.line(2);
    const view = {
      state,
      composing: false,
      compositionStarted: false,
      contentDOM: { getBoundingClientRect: () => ({ left: 100, right: 600, width: 500 }) },
      coordsAtPos: vi.fn((pos: number) => ({
        left: 120,
        right: 120,
        top: pos === current.from ? 500 : 526,
        bottom: pos === current.from ? 518 : 544
      })),
      lineBlockAt: vi.fn((pos: number) => {
        const line = state.doc.lineAt(pos);
        return { type: BlockType.Text, from: line.from, to: line.to, height: 26 };
      }),
      moveVertically: vi.fn(() => EditorSelection.cursor(state.doc.line(1).to)),
      dispatch: vi.fn()
    } as unknown as EditorView & { moveVertically: ReturnType<typeof vi.fn>; dispatch: ReturnType<typeof vi.fn> };

    expect(correctSkippedAdjacentLine(view, false)).toBe(false);
    expect(view.moveVertically).not.toHaveBeenCalled();
    expect(view.dispatch).not.toHaveBeenCalled();
  });

  it("conservatively reveals long or not-yet-parsed target lines without scanning their source", () => {
    const longDoc = `current\n${"x".repeat(9000)}`;
    const longState = EditorState.create({ doc: longDoc });
    expect(needsNavigationReveal(longState, longState.doc.line(2))).toBe(true);

    const partialState = EditorState.create({ doc: "current\nunknown tail" });
    expect(needsNavigationReveal(partialState, partialState.doc.line(2))).toBe(true);
  });

  it("drops a temporary reveal when its source document changes even if an old reveal effect is present", () => {
    const state = EditorState.create({ doc: "before\nafter", extensions: [navigationRevealLine] });
    const oldReveal = { from: state.doc.line(2).from, to: state.doc.line(2).to };
    const revealed = state.update({ effects: setNavigationRevealLine.of(oldReveal) }).state;
    expect(revealed.field(navigationRevealLine)).toEqual(oldReveal);

    const edited = revealed.update({
      changes: { from: 0, insert: "new " },
      effects: setNavigationRevealLine.of(oldReveal)
    }).state;
    expect(edited.field(navigationRevealLine)).toBeNull();
  });

  it("reveals only a bounded target line and clears the effect after navigation", () => {
    const doc = "next\n**rich target**";
    let state = EditorState.create({
      doc,
      selection: { anchor: "next".length },
      extensions: [markdown(), navigationRevealLine, EditorState.readOnly.of(false), EditorView.editable.of(true)]
    });
    const target = state.doc.line(2);
    expect(needsNavigationReveal(state, target)).toBe(true);
    const unchangedDoc = state.doc.toString();
    const afterReveal = state.update({ effects: setNavigationRevealLine.of({ from: target.from, to: target.to }) }).state;
    expect(afterReveal.field(navigationRevealLine)).toEqual({ from: target.from, to: target.to });
    expect(afterReveal.doc.toString()).toBe(unchangedDoc);
    expect(afterReveal.update({ effects: setNavigationRevealLine.of(null) }).state.field(navigationRevealLine)).toBeNull();

    const current = state.doc.line(1);
    const view = {
      get state() { return state; },
      composing: false,
      compositionStarted: false,
      contentDOM: { getBoundingClientRect: () => ({ left: 100, right: 600, width: 500 }) },
      lineBlockAt: vi.fn((pos: number) => {
        const line = state.doc.lineAt(pos);
        return { type: BlockType.Text, from: line.from, to: line.to, height: 22.4 };
      }),
      moveVertically: vi.fn(() => EditorSelection.cursor(target.from + 1, 1, undefined, 16)),
      coordsAtPos: vi.fn((pos: number) => {
        const line = state.doc.lineAt(pos);
        const revealed = state.field(navigationRevealLine)?.from === target.from;
        const top = line.number === current.number ? 400 : line.number === target.number ? (revealed ? 500 : 480) : 600;
        return { left: 116, right: 116, top, bottom: top + 18 };
      }),
      posAndSideAtCoords: vi.fn(({ y }: { x: number; y: number }) => y >= 500
        ? { pos: target.from + 1, assoc: 1 as const }
        : { pos: target.from, assoc: 1 as const }),
      dispatch: vi.fn((spec: Parameters<EditorView["dispatch"]>[0]) => { state = state.update(spec).state; })
    } as unknown as EditorView & {
      moveVertically: ReturnType<typeof vi.fn>;
      posAndSideAtCoords: ReturnType<typeof vi.fn>;
      dispatch: ReturnType<typeof vi.fn>;
    };

    expect(correctSkippedAdjacentLine(view, true)).toBe(true);
    expect(view.dispatch).toHaveBeenCalledTimes(2);
    const first = view.dispatch.mock.calls[0][0] as { selection?: unknown; effects?: unknown };
    const last = view.dispatch.mock.calls[1][0] as { selection?: EditorSelection; effects?: unknown };
    expect(first.selection).toBeUndefined();
    expect(first.effects).toBeDefined();
    expect(last.selection && state.doc.lineAt(last.selection.main.head).number).toBe(target.number);
    expect(last.effects).toBeDefined();
    expect(state.field(navigationRevealLine)).toBeNull();
    expect(state.doc.toString()).toBe(unchangedDoc);
  });

  it("renders target-line emphasis and shortcodes during the temporary reveal", () => {
    const doc = "current\n\n**bold** :rocket:";
    const state = EditorState.create({ doc, selection: { anchor: 0 }, extensions: [markdown(), navigationRevealLine] });
    const target = state.doc.line(3);
    const before = buildLivePreviewDecorations(state);
    const revealedState = state.update({ effects: setNavigationRevealLine.of({ from: target.from, to: target.to }) }).state;
    const after = buildLivePreviewDecorations(revealedState);
    const beforeDecorations: Array<{ from: number; to: number; replaced: boolean; className?: string }> = [];
    const afterDecorations: typeof beforeDecorations = [];
    before.between(target.from, target.to, (from, to, decoration) => {
      beforeDecorations.push({
        from,
        to,
        replaced: (decoration as unknown as { isReplace: boolean }).isReplace,
        className: decoration.spec.class
      });
    });
    after.between(target.from, target.to, (from, to, decoration) => {
      afterDecorations.push({
        from,
        to,
        replaced: (decoration as unknown as { isReplace: boolean }).isReplace,
        className: decoration.spec.class
      });
    });

    expect(beforeDecorations.some(({ from, replaced }) => from === target.from && replaced)).toBe(true);
    expect(afterDecorations.some(({ from, className }) => from === target.from && className === "cm-ghost-mark")).toBe(true);
    expect(beforeDecorations.some(({ replaced }) => replaced)).toBe(true);
    expect(afterDecorations.some(({ replaced }) => replaced)).toBe(false);
    expect(state.doc.toString()).toBe(doc);
  });

  it("avoids native layout work for read-only, composing, and widget destinations", () => {
    const readOnlyView = mockView({ currentLine: 11, candidateLine: 9, readOnly: true });
    const composingView = mockView({ currentLine: 11, candidateLine: 9, composing: true });
    const widgetView = mockView({ currentLine: 11, candidateLine: 9, blockType: BlockType.WidgetBefore });

    expect(correctSkippedAdjacentLine(readOnlyView, false)).toBe(false);
    expect(correctSkippedAdjacentLine(composingView, false)).toBe(false);
    expect(correctSkippedAdjacentLine(widgetView, false)).toBe(false);
    expect(readOnlyView.moveVertically).not.toHaveBeenCalled();
    expect(composingView.moveVertically).not.toHaveBeenCalled();
    expect(widgetView.moveVertically).not.toHaveBeenCalled();
    expect(widgetView.dispatch).not.toHaveBeenCalled();
  });

  it("does not navigate into an empty source line contained by a different rendered block", () => {
    const view = mockView({ currentLine: 11, candidateLine: 9 });
    view.lineBlockAt.mockReturnValue({ type: BlockType.Text, from: 0, to: view.state.doc.length });
    expect(correctSkippedAdjacentLine(view, false)).toBe(false);
    expect(view.moveVertically).not.toHaveBeenCalled();
    expect(view.dispatch).not.toHaveBeenCalled();
  });
});
