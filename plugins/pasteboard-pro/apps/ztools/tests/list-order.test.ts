import { describe, expect, it } from "vitest";

import type { PasteItem } from "@pasteboard-pro/core";
import {
  applyListOrder,
  collapsedDragSourceShifts,
  collapsedDragSourcesShifts,
  listOrderScope,
  reorderItemGroupIds,
  reorderItemGroupShifts,
  reorderItemIds,
  reorderItemShifts,
} from "../src/list-order";
import {
  SMART_IMAGE_PINBOARD_ID,
  SMART_TEXT_PINBOARD_ID,
} from "../src/smart-pinboards";

function item(id: string): PasteItem {
  return {
    id,
    kind: "text",
    sourceDeviceId: "device-test",
    copiedAt: "2026-08-25T00:00:00.000Z",
    updatedAt: "2026-08-25T00:00:00.000Z",
    contentFingerprint: `fingerprint-${id}`,
    payload: { revision: `revision-${id}`, text: id },
    pinned: false,
    fieldClocks: {},
  };
}

describe("list ordering", () => {
  it("moves an item before or after the drop target", () => {
    expect(reorderItemIds(["a", "b", "c", "d"], "d", "b", "before"))
      .toEqual(["a", "d", "b", "c"]);
    expect(reorderItemIds(["a", "b", "c", "d"], "a", "c", "after"))
      .toEqual(["b", "c", "a", "d"]);
  });

  it("moves non-contiguous selected items as one ordered group", () => {
    expect(
      reorderItemGroupIds(["a", "b", "c", "d", "e", "f"], ["d", "b"], "f", "after"),
    ).toEqual(["a", "c", "e", "f", "b", "d"]);
    expect(
      reorderItemGroupIds(["a", "b", "c", "d", "e", "f"], ["b", "d"], "a", "before"),
    ).toEqual(["b", "d", "a", "c", "e", "f"]);
    expect(
      reorderItemGroupIds(["a", "b", "c"], ["a", "b"], "b", "after"),
    ).toEqual(["a", "b", "c"]);
  });

  it("visually fills the hidden drag source and opens the insertion slot", () => {
    expect([...collapsedDragSourceShifts(["a", "b", "c", "d"], "a")])
      .toEqual([["b", -1], ["c", -1], ["d", -1]]);
    expect([...collapsedDragSourceShifts(["a", "b", "c", "d"], "c")])
      .toEqual([["d", -1]]);
    expect([...collapsedDragSourcesShifts(["a", "b", "c", "d", "e"], ["b", "d"])])
      .toEqual([["c", -1], ["e", -2]]);
    expect(
      [...reorderItemShifts(["a", "b", "c", "d"], "a", "c", "after")],
    ).toEqual([["b", -1], ["c", -1]]);
    expect(
      [...reorderItemShifts(["a", "b", "c", "d"], "d", "b", "before")],
    ).toEqual([["b", 1], ["c", 1]]);
    expect(reorderItemShifts(["a", "b"], "a", "missing", "before").size).toBe(0);
    expect(
      [...reorderItemGroupShifts(
        ["a", "b", "c", "d", "e", "f"],
        ["b", "d"],
        "e",
        "after",
      )],
    ).toEqual([["c", -1], ["e", -2]]);
  });

  it("keeps newly captured items ahead of an existing manual order", () => {
    const items = [item("new"), item("old-2"), item("old-1")];
    expect(applyListOrder(items, ["old-1", "old-2"]).map(({ id }) => id))
      .toEqual(["new", "old-1", "old-2"]);
  });

  it("uses independent scopes for all, smart, and custom groups", () => {
    expect(listOrderScope(undefined)).toBe("all");
    expect(listOrderScope(SMART_TEXT_PINBOARD_ID)).toBe("smart:text");
    expect(listOrderScope(SMART_IMAGE_PINBOARD_ID)).toBe("smart:image");
    expect(listOrderScope("board/a b")).toBe("pinboard:board%2Fa%20b");
  });
});
