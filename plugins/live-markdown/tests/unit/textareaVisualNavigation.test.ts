import { describe, expect, it } from "vitest";
import {
  getBoundedUnicodeSampleOffsets,
  getVisualRowSourceRange,
  isAmbiguousSoftWrapCaret,
  isImeCompositionKeyDown,
  MAX_VISUAL_ROW_SAMPLES,
  isSameVisualRow,
  shouldNavigateAcrossVisualEdge
} from "../../src/core/textareaVisualNavigation";

describe("textarea visual navigation boundaries", () => {
  it("recognizes a soft-wrapped caret row as distinct from the first and last rows", () => {
    expect(isSameVisualRow(100, 100, 24)).toBe(true);
    expect(isSameVisualRow(124, 100, 24)).toBe(false);
    expect(isSameVisualRow(123, 100, 24)).toBe(false);
  });

  it("treats a caret shared by adjacent visual rows as ambiguous but preserves hard breaks", () => {
    expect(isAmbiguousSoftWrapCaret({
      value: "wrapped text",
      offset: 6,
      beforeRowY: 10,
      afterRowY: 30,
      lineHeight: 20
    })).toBe(true);
    expect(isAmbiguousSoftWrapCaret({
      value: "first\nsecond",
      offset: 6,
      beforeRowY: 10,
      afterRowY: 30,
      lineHeight: 20
    })).toBe(false);
  });

  it("allows block roaming only at a visual edge with a single unmodified caret", () => {
    const edge = {
      direction: "up" as const,
      hasSelection: false,
      shiftKey: false,
      metaKey: false,
      ctrlKey: false,
      altKey: false,
      caretAtVisualEdge: true
    };

    expect(shouldNavigateAcrossVisualEdge(edge)).toBe(true);
    expect(shouldNavigateAcrossVisualEdge({ ...edge, caretAtVisualEdge: false })).toBe(false);
    expect(shouldNavigateAcrossVisualEdge({ ...edge, hasSelection: true })).toBe(false);
    expect(shouldNavigateAcrossVisualEdge({ ...edge, shiftKey: true })).toBe(false);
    expect(shouldNavigateAcrossVisualEdge({ ...edge, metaKey: true })).toBe(false);
    expect(shouldNavigateAcrossVisualEdge({ ...edge, ctrlKey: true })).toBe(false);
    expect(shouldNavigateAcrossVisualEdge({ ...edge, altKey: true })).toBe(false);
  });

  it("applies the same visual-edge policy to downward movement", () => {
    expect(shouldNavigateAcrossVisualEdge({
      direction: "down",
      hasSelection: false,
      shiftKey: false,
      metaKey: false,
      ctrlKey: false,
      altKey: false,
      caretAtVisualEdge: true
    })).toBe(true);
  });

  it("bounds measurements for long no-wrap visual rows", () => {
    const value = "x".repeat(1_000_000);
    const offsets = getBoundedUnicodeSampleOffsets(value, 0, value.length);

    expect(offsets.length).toBeLessThanOrEqual(MAX_VISUAL_ROW_SAMPLES);
    expect(offsets[0]).toBe(0);
    expect(offsets.at(-1)).toBe(value.length);
  });

  it("keeps sampled offsets within the source and outside surrogate pairs", () => {
    const value = "ab😀cd";
    const offsets = getBoundedUnicodeSampleOffsets(value, 0, value.length, 20);

    expect(offsets.every((offset) => offset >= 0 && offset <= value.length)).toBe(true);
    expect(offsets).not.toContain(3); // between the emoji's high/low surrogate
    expect(offsets[0]).toBe(0);
    expect(offsets.at(-1)).toBe(value.length);
  });

  it("handles empty and terminal-newline source ranges without exceeding source length", () => {
    expect(getBoundedUnicodeSampleOffsets("", 0, 1)).toEqual([0]);
    expect(getBoundedUnicodeSampleOffsets("line\n", 0, 5).at(-1)).toBe(5);
  });

  it("keeps the final source offset when a row has no following offset", () => {
    expect(getVisualRowSourceRange(7, 4, 8)).toEqual({ first: 4, last: 7 });
    expect(getVisualRowSourceRange(0, 0, 1)).toEqual({ first: 0, last: 0 });
    expect(getVisualRowSourceRange(7, 4, 6)).toEqual({ first: 4, last: 5 });
  });

  it("guards composing keystrokes reported by either browser IME signal", () => {
    expect(isImeCompositionKeyDown({ isComposing: true, keyCode: 38 })).toBe(true);
    expect(isImeCompositionKeyDown({ isComposing: false, keyCode: 229 })).toBe(true);
    expect(isImeCompositionKeyDown({ isComposing: false, keyCode: 38 })).toBe(false);
  });
});
