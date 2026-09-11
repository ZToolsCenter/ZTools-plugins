import { describe, expect, it } from "vitest";

import {
  reduceSelection,
  type SelectionState,
} from "../src/index";

describe("reduceSelection", () => {
  it("replaces the selection and extends it from a to b", () => {
    const replaced = reduceSelection(
      { selected: [] },
      { type: "replace", itemId: "a" },
    );

    expect(replaced).toEqual({
      selected: ["a"],
      anchor: "a",
      focus: "a",
    });
    expect(
      reduceSelection(replaced, {
        type: "extend",
        orderedIds: ["a", "b", "c"],
        direction: 1,
      }),
    ).toEqual({
      selected: ["a", "b"],
      anchor: "a",
      focus: "b",
    });
  });

  it("shrinks an extended selection in reverse without moving the anchor", () => {
    const state: SelectionState = {
      selected: ["a", "b", "c"],
      anchor: "a",
      focus: "c",
    };

    const shrunk = reduceSelection(state, {
      type: "extend",
      orderedIds: ["a", "b", "c"],
      direction: -1,
    });

    expect(shrunk).toEqual({
      selected: ["a", "b"],
      anchor: "a",
      focus: "b",
    });
    expect(
      reduceSelection(shrunk, {
        type: "extend",
        orderedIds: ["a", "b", "c"],
        direction: -1,
      }),
    ).toEqual({
      selected: ["a"],
      anchor: "a",
      focus: "a",
    });
  });

  it("keeps a reverse range in the order selected from its anchor", () => {
    let state = reduceSelection(
      { selected: [] },
      { type: "replace", itemId: "f" },
    );
    for (let step = 0; step < 5; step += 1) {
      state = reduceSelection(state, {
        type: "extend",
        orderedIds: ["a", "b", "c", "d", "e", "f"],
        direction: -1,
      });
    }

    expect(state).toEqual({
      selected: ["f", "e", "d", "c", "b", "a"],
      anchor: "f",
      focus: "a",
    });
  });

  it("toggles items while preserving valid anchor and focus fallbacks", () => {
    const added = reduceSelection(
      { selected: ["a"], anchor: "a", focus: "a" },
      { type: "toggle", itemId: "b" },
    );

    expect(added).toEqual({
      selected: ["a", "b"],
      anchor: "b",
      focus: "b",
    });
    expect(
      reduceSelection(added, { type: "toggle", itemId: "b" }),
    ).toEqual({
      selected: ["a"],
      anchor: "a",
      focus: "a",
    });
    expect(
      reduceSelection(
        { selected: ["a"], anchor: "a", focus: "a" },
        { type: "toggle", itemId: "a" },
      ),
    ).toEqual({ selected: [] });
  });

  it("normalizes duplicate selected IDs when toggling a new item", () => {
    const state: SelectionState = {
      selected: ["a", "a"],
      anchor: "a",
      focus: "a",
    };
    const originalState = structuredClone(state);

    expect(
      reduceSelection(state, { type: "toggle", itemId: "b" }),
    ).toEqual({
      selected: ["a", "b"],
      anchor: "b",
      focus: "b",
    });
    expect(state).toEqual(originalState);
  });

  it("removes every target occurrence and normalizes remaining IDs", () => {
    const state: SelectionState = {
      selected: ["a", "b", "b", "a"],
      anchor: "b",
      focus: "b",
    };

    expect(
      reduceSelection(state, { type: "toggle", itemId: "b" }),
    ).toEqual({
      selected: ["a"],
      anchor: "a",
      focus: "a",
    });
  });

  it("selects all unique ordered IDs and clears the selection", () => {
    const selected = reduceSelection(
      { selected: ["stale"], anchor: "stale", focus: "stale" },
      { type: "select-all", orderedIds: ["b", "a", "b", "c"] },
    );

    expect(selected).toEqual({
      selected: ["b", "a", "c"],
      anchor: "b",
      focus: "c",
    });
    expect(reduceSelection(selected, { type: "clear" })).toEqual({
      selected: [],
    });
    expect(
      reduceSelection(selected, { type: "select-all", orderedIds: [] }),
    ).toEqual({ selected: [] });
  });

  it("restores retained IDs in selection order and repairs removed endpoints", () => {
    expect(
      reduceSelection(
        {
          selected: ["removed", "c", "a", "c"],
          anchor: "removed",
          focus: "c",
        },
        {
          type: "restore",
          orderedIds: ["a", "b", "c", "a"],
          fallbackId: "b",
        },
      ),
    ).toEqual({
      selected: ["c", "a"],
      anchor: "c",
      focus: "c",
    });
  });

  it("uses a valid fallback only when no selected ID remains", () => {
    const state: SelectionState = {
      selected: ["removed"],
      anchor: "removed",
      focus: "removed",
    };

    expect(
      reduceSelection(state, {
        type: "restore",
        orderedIds: ["a", "b"],
        fallbackId: "b",
      }),
    ).toEqual({ selected: ["b"], anchor: "b", focus: "b" });
    expect(
      reduceSelection(state, {
        type: "restore",
        orderedIds: ["a", "b"],
        fallbackId: "missing",
      }),
    ).toEqual({ selected: [] });
  });

  it("does not mutate state, actions, or ordered IDs", () => {
    const state: SelectionState = {
      selected: ["b"],
      anchor: "b",
      focus: "b",
    };
    const orderedIds = ["a", "b", "b", "c"] as const;
    const action = {
      type: "extend" as const,
      orderedIds,
      direction: 1 as const,
    };
    const originalState = structuredClone(state);
    const originalAction = structuredClone(action);

    reduceSelection(state, action);

    expect(state).toEqual(originalState);
    expect(action).toEqual(originalAction);
    expect(orderedIds).toEqual(["a", "b", "b", "c"]);
  });
});
