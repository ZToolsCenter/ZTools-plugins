import { describe, expect, it } from "vitest";
import { timelineFocusOffset, timelineRange } from "../src/virtual-timeline";

describe("virtual timeline", () => {
  it("bounds rendering at the start, middle, and end of 10,000 records", () => {
    for (const stride of [252, 154, 116]) {
      for (const offset of [0, 5000 * stride, 10000 * stride]) {
        const { start, end } = timelineRange(10000, stride, offset, 900);
        expect(start).toBeGreaterThanOrEqual(0);
        expect(end).toBeLessThanOrEqual(10000);
        expect(end - start).toBeGreaterThanOrEqual(30);
        expect(end - start).toBeLessThanOrEqual(50);
      }
    }
  });

  it("handles empty and shortened search results at an old scroll position", () => {
    expect(timelineRange(0, 154, 50000, 500)).toEqual({ start: 0, end: 0 });
    expect(timelineRange(2, 154, 50000, 500)).toEqual({ start: 0, end: 2 });
  });

  it("reveals unmounted focus targets and keeps already visible targets stable", () => {
    expect(timelineFocusOffset(0, 154, 142, 9000, 500)).toBe(0);
    const offset = timelineFocusOffset(9999, 154, 142, 0, 500);
    expect(offset + 500).toBe(9999 * 154 + 142);
    const range = timelineRange(10000, 154, offset, 500);
    expect(range.end).toBe(10000);
    expect(timelineFocusOffset(3, 154, 142, 400, 500)).toBe(400);
    expect(timelineFocusOffset(3, 154, 142, 0, 100)).toBe(462);
  });
});
