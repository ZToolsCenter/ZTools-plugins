import { describe, expect, it } from "vitest";

import { placePopover } from "../src/components/popup-position";

describe("placePopover", () => {
  it("aligns to the trigger and opens above a bottom shelf control", () => {
    expect(
      placePopover(
        { left: 740, right: 820, top: 570, bottom: 608 },
        { width: 420, height: 360 },
        { width: 900, height: 640 },
        { align: "end", preferAbove: true },
      ),
    ).toEqual({ left: 400, top: 202 });
  });

  it("opens below when a top dock prefers the lower side", () => {
    expect(
      placePopover(
        { left: 20, right: 60, top: 8, bottom: 44 },
        { width: 220, height: 200 },
        { width: 800, height: 600 },
        { align: "start", preferAbove: false },
      ),
    ).toEqual({ left: 20, top: 52 });
  });

  it("clamps popovers inside narrow viewport margins", () => {
    expect(
      placePopover(
        { left: 2, right: 30, top: 15, bottom: 38 },
        { width: 400, height: 500 },
        { width: 320, height: 260 },
        { align: "start", preferAbove: true, margin: 10 },
      ),
    ).toEqual({ left: 10, top: 10 });
  });
});
