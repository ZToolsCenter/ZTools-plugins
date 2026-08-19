import { expect, test } from "playwright/test";
import { findNonOverlappingToolbarPosition } from "../../src/components/editor/utils/formattingToolbarPosition";
import { getMultiBlockToolbarEdgeRect } from "../../src/components/editor/utils/formattingToolbarReference";
import { getColorPanelPosition } from "../../src/components/editor/toolbars/formatting/ColorPicker";

const boundary = {
  top: 8,
  right: 792,
  bottom: 592,
  left: 8,
  width: 784,
  height: 584,
};

/** Tall multi-block selection with room below/above for a 300×40 toolbar. */
const multiBlockBoundary = {
  top: 0,
  right: 1000,
  bottom: 1000,
  left: 0,
  width: 1000,
  height: 1000,
};

const tallMultiBlockReference = {
  top: 100,
  left: 50,
  bottom: 500,
  right: 350,
  width: 300,
  height: 400,
};

const multiBlockFloating = { width: 300, height: 40 };
const multiBlockGap = 16;

test("formatting toolbar prefers above the selection when space allows", () => {
  expect(
    findNonOverlappingToolbarPosition({
      reference: {
        top: 100,
        right: 500,
        bottom: 180,
        left: 200,
        width: 300,
        height: 80,
      },
      floating: { width: 320, height: 40 },
      boundary,
      preferredSide: "top",
      gap: 16,
    }),
  ).toEqual({ x: 190, y: 44 });
});

test("formatting toolbar flips below when above the selection has no room", () => {
  expect(
    findNonOverlappingToolbarPosition({
      reference: {
        top: 20,
        right: 500,
        bottom: 80,
        left: 200,
        width: 300,
        height: 60,
      },
      floating: { width: 320, height: 40 },
      boundary,
      preferredSide: "top",
      gap: 16,
    }),
  ).toEqual({ x: 190, y: 96 });
});

test("formatting toolbar uses a side fallback for a tall Windows selection", () => {
  expect(
    findNonOverlappingToolbarPosition({
      reference: {
        top: 20,
        right: 420,
        bottom: 580,
        left: 220,
        width: 200,
        height: 560,
      },
      floating: { width: 160, height: 40 },
      boundary,
      preferredSide: "bottom",
      gap: 16,
    }),
  ).toEqual({ x: 436, y: 280 });
});

test("formatting toolbar hides when no non-overlapping position is reachable", () => {
  expect(
    findNonOverlappingToolbarPosition({
      reference: {
        top: 8,
        right: 792,
        bottom: 592,
        left: 8,
        width: 784,
        height: 584,
      },
      floating: { width: 320, height: 40 },
      boundary,
      preferredSide: "bottom",
      gap: 16,
    }),
  ).toBeNull();
});

test("multi-block preferredSide bottom places toolbar under reference, x centered", () => {
  const gap = multiBlockGap;
  const result = findNonOverlappingToolbarPosition({
    reference: tallMultiBlockReference,
    floating: multiBlockFloating,
    boundary: multiBlockBoundary,
    preferredSide: "bottom",
    gap,
  });

  expect(result).toEqual({
    x: tallMultiBlockReference.left +
      (tallMultiBlockReference.width - multiBlockFloating.width) / 2,
    y: tallMultiBlockReference.bottom + gap,
  });
});

test("multi-block preferredSide top places toolbar above reference, x centered", () => {
  const gap = multiBlockGap;
  const result = findNonOverlappingToolbarPosition({
    reference: tallMultiBlockReference,
    floating: multiBlockFloating,
    boundary: multiBlockBoundary,
    preferredSide: "top",
    gap,
  });

  expect(result).toEqual({
    x: tallMultiBlockReference.left +
      (tallMultiBlockReference.width - multiBlockFloating.width) / 2,
    y:
      tallMultiBlockReference.top - gap - multiBlockFloating.height,
  });
});

test("thin top-edge reference still centers x on full multi-block width", () => {
  const gap = multiBlockGap;
  const edge = getMultiBlockToolbarEdgeRect(tallMultiBlockReference, "top");
  expect(edge.height).toBe(1);
  expect(edge.width).toBe(tallMultiBlockReference.width);
  expect(edge.left).toBe(tallMultiBlockReference.left);

  // Prefer top against the thin edge at the top of a tall multi-block selection;
  // x must still center on the full selection width (300), not a caret width.
  const result = findNonOverlappingToolbarPosition({
    reference: edge,
    floating: multiBlockFloating,
    boundary: multiBlockBoundary,
    preferredSide: "top",
    gap,
  });

  expect(result).toEqual({
    x:
      tallMultiBlockReference.left +
      (tallMultiBlockReference.width - multiBlockFloating.width) / 2,
    y: edge.top - gap - multiBlockFloating.height,
  });
});

test("color panel stays centered on its trigger in viewport coordinates", () => {
  expect(
    getColorPanelPosition({
      trigger: { top: 104, right: 279, bottom: 143, left: 240, width: 39 },
      panelWidth: 246,
      panelHeight: 270,
      viewportWidth: 914,
      viewportHeight: 480,
      gap: 12,
    }),
  ).toEqual({ top: 155, left: 259.5, showAbove: false });
});

test("color panel clamps to the viewport instead of shifting its anchor", () => {
  expect(
    getColorPanelPosition({
      trigger: { top: 300, right: 40, bottom: 326, left: 14, width: 26 },
      panelWidth: 220,
      panelHeight: 180,
      viewportWidth: 800,
      viewportHeight: 600,
      gap: 8,
    }),
  ).toEqual({ top: 292, left: 118, showAbove: true });
});

test("color panel opens above a bottom-docked quicknote toolbar trigger", () => {
  // 速记小窗底栏：触发器贴底，下方几乎没空间；必须向上展开完整色板。
  expect(
    getColorPanelPosition({
      trigger: { top: 410, right: 180, bottom: 438, left: 152, width: 28 },
      panelWidth: 172,
      panelHeight: 190,
      viewportWidth: 360,
      viewportHeight: 480,
      gap: 8,
    }),
  ).toEqual({ top: 402, left: 166, showAbove: true });
});
