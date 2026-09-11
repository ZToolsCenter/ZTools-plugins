import { describe, expect, it } from "vitest";

import {
  reducePasteStack,
  type PasteStackState,
} from "../src/index";

describe("reducePasteStack", () => {
  it("replaces with unique IDs and consumes forward from the front", () => {
    const replaced = reducePasteStack(
      { direction: "forward", itemIds: ["stale"] },
      { type: "replace", itemIds: ["a", "b", "a"] },
    );

    expect(replaced).toEqual({ direction: "forward", itemIds: ["a", "b"] });
    expect(reducePasteStack(replaced, { type: "consume" })).toEqual({
      direction: "forward",
      itemIds: ["b"],
    });
  });

  it("consumes reverse from the end and honors direction switches", () => {
    const reversed = reducePasteStack(
      { direction: "forward", itemIds: ["a", "b", "c"] },
      { type: "set-direction", direction: "reverse" },
    );

    expect(reversed).toEqual({
      direction: "reverse",
      itemIds: ["a", "b", "c"],
    });
    expect(reducePasteStack(reversed, { type: "consume" })).toEqual({
      direction: "reverse",
      itemIds: ["a", "b"],
    });
  });

  it("appends unseen IDs after a deduplicated existing queue", () => {
    expect(
      reducePasteStack(
        { direction: "forward", itemIds: ["a", "a", "b"] },
        { type: "append", itemIds: ["b", "c", "", "c", ""] },
      ),
    ).toEqual({
      direction: "forward",
      itemIds: ["a", "b", "c", ""],
    });
  });

  it("removes an item and clears while keeping direction", () => {
    const removed = reducePasteStack(
      { direction: "reverse", itemIds: ["a", "b", "a", "c"] },
      { type: "remove", itemId: "a" },
    );

    expect(removed).toEqual({ direction: "reverse", itemIds: ["b", "c"] });
    expect(reducePasteStack(removed, { type: "clear" })).toEqual({
      direction: "reverse",
      itemIds: [],
    });
  });

  it("keeps an empty queue empty when consumed", () => {
    expect(
      reducePasteStack(
        { direction: "forward", itemIds: [] },
        { type: "consume" },
      ),
    ).toEqual({ direction: "forward", itemIds: [] });
  });

  it("does not mutate state or action inputs", () => {
    const state: PasteStackState = {
      direction: "forward",
      itemIds: ["a", "a", "b"],
    };
    const itemIds = ["b", "c", "c"] as const;
    const action = { type: "append" as const, itemIds };
    const originalState = structuredClone(state);
    const originalAction = structuredClone(action);

    reducePasteStack(state, action);

    expect(state).toEqual(originalState);
    expect(action).toEqual(originalAction);
    expect(itemIds).toEqual(["b", "c", "c"]);
  });
});
