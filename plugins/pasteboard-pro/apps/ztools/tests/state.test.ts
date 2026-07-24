import { describe, expect, it } from "vitest";

import {
  historyFixture,
  pasteStackKeyboardFixture,
  selectionKeyboardFixture,
} from "@pasteboard-pro/contract-fixtures";
import { pasteboardTokens } from "@pasteboard-pro/design-tokens";

import {
  createPasteboardState,
  keyboardAction,
  pasteStackSnapshot,
  visualState,
} from "../src/state";

describe("Vue canonical state", () => {
  it("replays the shared selection keyboard fixture", () => {
    const state = createPasteboardState({
      items: historyFixture.filter((item) =>
        selectionKeyboardFixture.orderedIds.includes(item.id),
      ),
      orderedIds: selectionKeyboardFixture.orderedIds,
      selection: selectionKeyboardFixture.initial,
    });

    for (const step of selectionKeyboardFixture.steps) {
      state.handleKeyboard(step.event);
      expect(state.selection.selected).toEqual(step.expectedSelected);
      expect(state.selection.anchor).toBe(step.expectedAnchor);
      expect(state.selection.focus).toBe(step.expectedFocus);
    }
  });

  it("replays the shared Paste Stack fixture", () => {
    const state = createPasteboardState({
      items: historyFixture,
      pasteStack: pasteStackKeyboardFixture.initial,
    });

    for (const step of pasteStackKeyboardFixture.steps) {
      state.dispatchPasteStack(step.action);
      expect(state.pasteStack.itemIds).toEqual(step.expectedItemIds);
      expect(state.pasteStack.direction).toBe(step.expectedDirection);
    }
  });

  it("copies a reactive-like paste stack into a plain persistence snapshot", () => {
    const reactiveLike = new Proxy(
      { direction: "forward" as const, itemIds: ["a", "b"] },
      {},
    );

    expect(pasteStackSnapshot(reactiveLike)).toEqual({
      direction: "forward",
      itemIds: ["a", "b"],
    });
  });

  it("filters through the shared query engine and repairs selection", () => {
    const state = createPasteboardState({
      items: historyFixture,
      selection: {
        selected: ["text-old"],
        anchor: "text-old",
        focus: "text-old",
      },
    });

    state.setQuery("type:image invoice");

    expect(state.visibleItems.map((item) => item.id)).toEqual(["image-new"]);
    expect(state.selection).toEqual({
      selected: ["image-new"],
      anchor: "image-new",
      focus: "image-new",
    });
  });

  it("maps Command 1-9 and Shift-Command 1-9 to Quick Paste", () => {
    const state = createPasteboardState({ items: historyFixture });

    expect(
      state.handleKeyboard({
        key: "2",
        metaKey: true,
        shiftKey: false,
        altKey: false,
      }),
    ).toEqual({
      type: "quick-paste",
      itemId: state.visibleItems[1]?.id,
      plainText: false,
    });
    expect(
      state.handleKeyboard({
        key: "2",
        metaKey: true,
        shiftKey: true,
        altKey: false,
      }),
    ).toEqual({
      type: "quick-paste",
      itemId: state.visibleItems[1]?.id,
      plainText: true,
    });
    expect(
      state.handleKeyboard({
        key: "9",
        metaKey: true,
        shiftKey: false,
        altKey: false,
      }),
    ).toBeNull();
  });

  it("moves single selection with arrows and exposes paste/preview effects", () => {
    const state = createPasteboardState({ items: historyFixture });
    const firstId = state.visibleItems[0]!.id;
    const secondId = state.visibleItems[1]!.id;

    state.replaceSelection(firstId);
    expect(
      state.handleKeyboard({
        key: "ArrowRight",
        metaKey: false,
        shiftKey: false,
        altKey: false,
      }),
    ).toBeNull();
    expect(state.selection.selected).toEqual([secondId]);
    expect(
      state.handleKeyboard({
        key: "Enter",
        metaKey: false,
        shiftKey: false,
        altKey: false,
      }),
    ).toEqual({ type: "paste", itemIds: [secondId], plainText: false });
    expect(
      state.handleKeyboard({
        key: "Enter",
        metaKey: false,
        shiftKey: true,
        altKey: false,
      }),
    ).toEqual({ type: "paste", itemIds: [secondId], plainText: true });
    expect(
      state.handleKeyboard({
        key: " ",
        metaKey: false,
        shiftKey: false,
        altKey: false,
      }),
    ).toEqual({ type: "preview", itemId: secondId });
  });

  it("uses range direction and explicit selection order as the automatic paste queue", () => {
    const state = createPasteboardState({ items: historyFixture });
    const [firstId, secondId, thirdId] = state.visibleItems.map((item) => item.id);
    if (firstId === undefined || secondId === undefined || thirdId === undefined) {
      throw new Error("Expected at least three history fixtures");
    }

    state.replaceSelection(firstId);
    expect(state.selectionPasteQueue()).toEqual([]);
    state.extendSelectionTo(thirdId);
    expect(state.selectionPasteQueue()).toEqual([firstId, secondId, thirdId]);

    state.replaceSelection(thirdId);
    state.extendSelectionTo(firstId);
    expect(state.selectionPasteQueue()).toEqual([thirdId, secondId, firstId]);

    state.replaceSelection(firstId);
    state.toggleSelection(thirdId);
    state.toggleSelection(secondId);
    expect(state.selectionPasteQueue()).toEqual([firstId, thirdId, secondId]);
    expect(
      state.handleKeyboard({
        key: "Enter",
        metaKey: false,
        shiftKey: false,
        altKey: false,
      }),
    ).toEqual({
      type: "paste",
      itemIds: [firstId, thirdId, secondId],
      plainText: false,
    });
  });

  it("clears selection when the active paste queue is consumed", () => {
    const state = createPasteboardState({
      items: historyFixture,
      selection: { selected: ["text-old", "url-middle"] },
      pasteStack: {
        direction: "forward",
        itemIds: ["text-old", "url-middle"],
      },
    });

    state.setPasteStack({ direction: "forward", itemIds: [] }, true);

    expect(state.selection).toEqual({ selected: [] });
  });
});

describe("visual state", () => {
  it("maps every dock edge and compact mode to shared tokens", () => {
    expect(visualState("bottom", "expanded")).toEqual({
      dockClass: "shelf--bottom",
      cardWidth: pasteboardTokens.expandedCardWidth,
      transitionMs: pasteboardTokens.dockTransitionMs,
    });
    expect(visualState("left", "compact")).toEqual({
      dockClass: "shelf--left",
      cardWidth: pasteboardTokens.compactCardWidth,
      transitionMs: pasteboardTokens.dockTransitionMs,
    });
  });

  it("translates host keyboard events into shared reducer actions", () => {
    expect(
      keyboardAction(
        { key: "a", metaKey: true, shiftKey: false, altKey: false },
        ["a", "b"],
      ),
    ).toEqual({ type: "select-all", orderedIds: ["a", "b"] });
    expect(
      keyboardAction(
        { key: "ArrowLeft", metaKey: false, shiftKey: true, altKey: false },
        ["a", "b"],
      ),
    ).toEqual({ type: "extend", orderedIds: ["a", "b"], direction: -1 });
  });
});
