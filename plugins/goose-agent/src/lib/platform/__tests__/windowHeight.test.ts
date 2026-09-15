import { describe, expect, it } from "vitest";
import {
  WINDOW_HEIGHT_DEFAULT,
  WINDOW_HEIGHT_MAX,
  WINDOW_HEIGHT_MIN,
  clampWindowHeight,
} from "../windowHeight";

describe("clampWindowHeight", () => {
  it("returns default for non-number / non-finite", () => {
    expect(clampWindowHeight(undefined)).toBe(WINDOW_HEIGHT_DEFAULT);
    expect(clampWindowHeight(null)).toBe(WINDOW_HEIGHT_DEFAULT);
    expect(clampWindowHeight("800")).toBe(WINDOW_HEIGHT_DEFAULT);
    expect(clampWindowHeight(NaN)).toBe(WINDOW_HEIGHT_DEFAULT);
    expect(clampWindowHeight(Infinity)).toBe(WINDOW_HEIGHT_DEFAULT);
  });

  it("rounds and clamps to [MIN, MAX]", () => {
    expect(clampWindowHeight(479)).toBe(WINDOW_HEIGHT_MIN);
    expect(clampWindowHeight(1201)).toBe(WINDOW_HEIGHT_MAX);
    expect(clampWindowHeight(800.4)).toBe(800);
    expect(clampWindowHeight(800.6)).toBe(801);
    expect(clampWindowHeight(WINDOW_HEIGHT_MIN)).toBe(WINDOW_HEIGHT_MIN);
    expect(clampWindowHeight(WINDOW_HEIGHT_MAX)).toBe(WINDOW_HEIGHT_MAX);
  });

  it("preserves valid mid-range values", () => {
    expect(clampWindowHeight(640)).toBe(640);
    expect(clampWindowHeight(1000)).toBe(1000);
  });
});
