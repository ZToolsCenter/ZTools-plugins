import { describe, expect, it } from "vitest";

import {
  clampShelfBounds,
  pasteboardTokens,
  resolveDockEdge,
  shelfRadius,
  type DisplayGeometry,
  type Rect,
} from "../src/index";

describe("pasteboardTokens", () => {
  it("exposes the exact shared visual and geometry tokens", () => {
    expect(pasteboardTokens).toEqual({
      radius: 28,
      snapZone: 12,
      dockTransitionMs: 160,
      cardGap: 12,
      expandedCardWidth: 220,
      compactCardWidth: 148,
      glassBorder: "rgba(255,255,255,0.32)",
      glassBlurPx: 26,
    });
  });
});

describe("shelfRadius", () => {
  it.each([
    [
      "floating",
      { topLeft: 28, topRight: 28, bottomRight: 28, bottomLeft: 28 },
    ],
    [
      "bottom",
      { topLeft: 28, topRight: 28, bottomRight: 0, bottomLeft: 0 },
    ],
    [
      "top",
      { topLeft: 0, topRight: 0, bottomRight: 28, bottomLeft: 28 },
    ],
    [
      "left",
      { topLeft: 0, topRight: 28, bottomRight: 28, bottomLeft: 0 },
    ],
    [
      "right",
      { topLeft: 28, topRight: 0, bottomRight: 0, bottomLeft: 28 },
    ],
  ] as const)("returns exact %s shelf radii", (edge, expected) => {
    expect(shelfRadius(edge)).toEqual(expected);
  });

  it("returns a fresh radii object for every call", () => {
    expect(shelfRadius("floating")).not.toBe(shelfRadius("floating"));
  });
});

describe("resolveDockEdge", () => {
  const display: DisplayGeometry = {
    workArea: { x: 0, y: 0, width: 1000, height: 800 },
  };

  it("resolves the plan example near the left edge", () => {
    expect(
      resolveDockEdge({ x: 5, y: 100, width: 220, height: 160 }, display),
    ).toBe("left");
  });

  it("resolves top, bottom, and right edge gaps", () => {
    expect(
      resolveDockEdge({ x: 300, y: 5, width: 220, height: 145 }, display),
    ).toBe("top");
    expect(
      resolveDockEdge({ x: 300, y: 650, width: 220, height: 145 }, display),
    ).toBe("bottom");
    expect(
      resolveDockEdge({ x: 790, y: 200, width: 205, height: 160 }, display),
    ).toBe("right");
  });

  it("includes the exact threshold and excludes threshold plus epsilon", () => {
    expect(
      resolveDockEdge({ x: 12, y: 100, width: 220, height: 160 }, display),
    ).toBe("left");
    expect(
      resolveDockEdge(
        { x: 12 + Number.EPSILON * 8, y: 100, width: 220, height: 160 },
        display,
      ),
    ).toBe("floating");
  });

  it("prefers bottom over left for a complete tie", () => {
    expect(
      resolveDockEdge({ x: 5, y: 635, width: 220, height: 160 }, display),
    ).toBe("bottom");
  });

  it("chooses the nearer candidate when gaps are not tied", () => {
    expect(
      resolveDockEdge({ x: 8, y: 634, width: 220, height: 160 }, display),
    ).toBe("bottom");
    expect(
      resolveDockEdge({ x: 4, y: 632, width: 220, height: 160 }, display),
    ).toBe("left");
  });

  it("supports a negative-x secondary display", () => {
    expect(
      resolveDockEdge(
        { x: -1434, y: 80, width: 220, height: 160 },
        { workArea: { x: -1440, y: 0, width: 1440, height: 900 } },
      ),
    ).toBe("left");
  });

  it("does not mutate the rect or display", () => {
    const rect: Rect = { x: 5, y: 100, width: 220, height: 160 };
    const customDisplay: DisplayGeometry = {
      workArea: { x: -100, y: -50, width: 1000, height: 800 },
    };
    const originalRect = structuredClone(rect);
    const originalDisplay = structuredClone(customDisplay);

    resolveDockEdge(rect, customDisplay);

    expect(rect).toEqual(originalRect);
    expect(customDisplay).toEqual(originalDisplay);
  });
});

describe("clampShelfBounds", () => {
  it("clamps normal overflow inside the work area", () => {
    expect(
      clampShelfBounds(
        { x: 900, y: 760, width: 220, height: 100 },
        { workArea: { x: 0, y: 0, width: 1000, height: 800 } },
      ),
    ).toEqual({ x: 780, y: 700, width: 220, height: 100 });
  });

  it("shrinks an oversized shelf before clamping its origin", () => {
    expect(
      clampShelfBounds(
        { x: -100, y: 900, width: 1200, height: 900 },
        { workArea: { x: 0, y: 0, width: 1000, height: 800 } },
      ),
    ).toEqual({ x: 0, y: 0, width: 1000, height: 800 });
  });

  it("supports negative work-area coordinates", () => {
    expect(
      clampShelfBounds(
        { x: -1500, y: -100, width: 300, height: 200 },
        { workArea: { x: -1440, y: -40, width: 1440, height: 900 } },
      ),
    ).toEqual({ x: -1440, y: -40, width: 300, height: 200 });
  });

  it("returns a new rect without mutating inputs", () => {
    const rect: Rect = { x: 900, y: 760, width: 220, height: 100 };
    const display: DisplayGeometry = {
      workArea: { x: 0, y: 0, width: 1000, height: 800 },
    };
    const originalRect = structuredClone(rect);
    const originalDisplay = structuredClone(display);
    const result = clampShelfBounds(rect, display);

    expect(result).not.toBe(rect);
    expect(rect).toEqual(originalRect);
    expect(display).toEqual(originalDisplay);
  });
});

describe("geometry validation", () => {
  const validRect: Rect = { x: 0, y: 0, width: 100, height: 100 };
  const validDisplay: DisplayGeometry = {
    workArea: { x: 0, y: 0, width: 1000, height: 800 },
  };

  it.each([
    [
      "right",
      { x: Number.MAX_VALUE, y: 0, width: Number.MAX_VALUE, height: 1 },
    ],
    [
      "bottom",
      { x: 0, y: Number.MAX_VALUE, width: 1, height: Number.MAX_VALUE },
    ],
  ] as const)("rejects a rect whose %s endpoint overflows", (_edge, rect) => {
    const originalRect = structuredClone(rect);
    const originalDisplay = structuredClone(validDisplay);

    expect(() => clampShelfBounds(rect, validDisplay)).toThrow(RangeError);
    expect(() => resolveDockEdge(rect, validDisplay)).toThrow(RangeError);
    expect(rect).toEqual(originalRect);
    expect(validDisplay).toEqual(originalDisplay);
  });

  it.each([
    [
      "right",
      { x: Number.MAX_VALUE, y: 0, width: Number.MAX_VALUE, height: 100 },
    ],
    [
      "bottom",
      { x: 0, y: Number.MAX_VALUE, width: 100, height: Number.MAX_VALUE },
    ],
  ] as const)(
    "rejects a work area whose %s endpoint overflows",
    (_edge, workArea) => {
      const display = { workArea };
      const originalRect = structuredClone(validRect);
      const originalDisplay = structuredClone(display);

      expect(() => clampShelfBounds(validRect, display)).toThrow(RangeError);
      expect(() => resolveDockEdge(validRect, display)).toThrow(RangeError);
      expect(validRect).toEqual(originalRect);
      expect(display).toEqual(originalDisplay);
    },
  );

  it.each([
    { ...validRect, width: -1 },
    { ...validRect, height: -1 },
    { ...validRect, x: Number.NaN },
    { ...validRect, y: Number.POSITIVE_INFINITY },
    { ...validRect, width: Number.NEGATIVE_INFINITY },
  ])("rejects an invalid rect %#", (rect) => {
    expect(() => clampShelfBounds(rect, validDisplay)).toThrow(RangeError);
    expect(() => resolveDockEdge(rect, validDisplay)).toThrow(RangeError);
  });

  it.each([
    { ...validDisplay.workArea, width: -1 },
    { ...validDisplay.workArea, height: -1 },
    { ...validDisplay.workArea, x: Number.NaN },
    { ...validDisplay.workArea, y: Number.POSITIVE_INFINITY },
    { ...validDisplay.workArea, height: Number.NEGATIVE_INFINITY },
  ])("rejects an invalid work area %#", (workArea) => {
    const display = { workArea };

    expect(() => clampShelfBounds(validRect, display)).toThrow(RangeError);
    expect(() => resolveDockEdge(validRect, display)).toThrow(RangeError);
  });

  it.each([-1, Number.NaN, Number.POSITIVE_INFINITY])(
    "rejects invalid snapZone %s",
    (snapZone) => {
      expect(() =>
        resolveDockEdge(validRect, validDisplay, snapZone),
      ).toThrow(RangeError);
    },
  );
});
