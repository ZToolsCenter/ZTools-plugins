import { describe, expect, it } from "vitest";

import { assignmentItemIds } from "../src/pinboard-assignment";

describe("pinboard context-menu assignment", () => {
  it("moves the current multi-selection when the clicked item is selected", () => {
    expect(assignmentItemIds(["item-1", "item-3", "item-3"], "item-3")).toEqual([
      "item-1",
      "item-3",
    ]);
  });

  it("moves only the right-clicked item outside the current selection", () => {
    expect(assignmentItemIds(["item-1", "item-2"], "item-4")).toEqual([
      "item-4",
    ]);
  });
});
