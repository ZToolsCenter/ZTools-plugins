import { expect, test } from "playwright/test";
import {
  getFormattingToolbarReferenceRect,
  getMultiBlockToolbarEdgeRect,
  type ToolbarReferenceRect,
} from "../../src/components/editor/utils/formattingToolbarReference";

// Task edge-rect fixture
const union: ToolbarReferenceRect = {
  top: 100,
  left: 50,
  bottom: 500,
  right: 350,
  width: 300,
  height: 400,
};

test("top edge: top=100, bottom≈101, width=300, left=50", () => {
  const edge = getMultiBlockToolbarEdgeRect(union, "top");

  expect(edge.top).toBe(100);
  expect(edge.bottom).toBeCloseTo(101);
  expect(edge.height).toBe(1);
  expect(edge.left).toBe(50);
  expect(edge.right).toBe(350);
  expect(edge.width).toBe(300);
});

test("bottom edge: bottom=500, top≈499, width=300", () => {
  const edge = getMultiBlockToolbarEdgeRect(union, "bottom");

  expect(edge.bottom).toBe(500);
  expect(edge.top).toBeCloseTo(499);
  expect(edge.height).toBe(1);
  expect(edge.left).toBe(50);
  expect(edge.right).toBe(350);
  expect(edge.width).toBe(300);
});

test("edge rect preserves full union width for horizontal centering", () => {
  const topEdge = getMultiBlockToolbarEdgeRect(union, "top");
  const bottomEdge = getMultiBlockToolbarEdgeRect(union, "bottom");

  expect(topEdge.width).toBe(union.width);
  expect(topEdge.left).toBe(union.left);
  expect(bottomEdge.width).toBe(union.width);
  expect(bottomEdge.left).toBe(union.left);
});

test("custom edge height is applied on top and bottom", () => {
  const topEdge = getMultiBlockToolbarEdgeRect(union, "top", 2);
  const bottomEdge = getMultiBlockToolbarEdgeRect(union, "bottom", 2);

  expect(topEdge).toEqual({
    top: 100,
    left: 50,
    bottom: 102,
    right: 350,
    width: 300,
    height: 2,
  });
  expect(bottomEdge).toEqual({
    top: 498,
    left: 50,
    bottom: 500,
    right: 350,
    width: 300,
    height: 2,
  });
});

test("left/right preferred side returns the full reference unchanged", () => {
  expect(getMultiBlockToolbarEdgeRect(union, "left")).toEqual(union);
  expect(getMultiBlockToolbarEdgeRect(union, "right")).toEqual(union);
});

test("getFormattingToolbarReferenceRect returns undefined for mode none (no view required)", () => {
  // DOM-dependent multiBlock/single paths need a live editor + block DOM.
  // Pure fallback only: mode "none" short-circuits without touching the DOM.
  const stubEditor = {} as any;
  expect(getFormattingToolbarReferenceRect(stubEditor, "none")).toBeUndefined();
});
