import { describe, expect, it } from "vitest";
import { boundedVisualSize, localVisualReference, passiveVisualTag, visualScaleBounds } from "../../src/components/renderedVisualPolicy";

describe("passive reading visual policy", () => {
  it("keeps vector and CHTML drawing vocabulary while refusing active content", () => {
    for (const tag of ["path", "foreignObject", "use", "marker", "defs"]) expect(passiveVisualTag(tag, true)).toBe(true);
    for (const tag of ["span", "mjx-math", "mjx-c"]) expect(passiveVisualTag(tag, false)).toBe(true);
    for (const tag of ["script", "iframe", "input", "button", "img", "object", "style", "mjx-assistive-mml", "mjx-merror"]) expect(passiveVisualTag(tag, false)).toBe(false);
    for (const tag of ["script", "image", "animate", "set", "a"]) expect(passiveVisualTag(tag, true)).toBe(false);
  });
  it("isolates marker/clip references and refuses remote, data and unresolved references", () => {
    const ids = new Map([["arrow", "preview-arrow"], ["clip", "preview-clip"]]);
    expect(localVisualReference('url("#arrow")', ids)).toBe("url(#preview-arrow)");
    expect(localVisualReference("url(#arrow) url('#clip')", ids)).toBe("url(#preview-arrow) url(#preview-clip)");
    for (const value of ["url(https://example.test/a.svg#arrow)", "url(data:image/svg+xml,foo)", "url(#missing)", "url(#arrow) url(javascript:alert)"]) expect(localVisualReference(value, ids)).toBeNull();
    expect(localVisualReference("rgb(20, 30, 40)", ids)).toBe("rgb(20, 30, 40)");
  });
  it("fits diagrams to the stage and bounds zoom by CSS pixel budgets", () => {
    const bounds = { width: 1000, height: 600 };
    expect(visualScaleBounds(50, 25, bounds, "math").fit).toBe(2.5);
    expect(visualScaleBounds(50, 25, bounds, "image").fit).toBe(1);
    expect(visualScaleBounds(2000, 200, { width: 320, height: 500 }, "image").fit).toBe(0.16);
    const tiny = visualScaleBounds(6, 3, bounds, "diagram");
    expect(tiny.fit).toBeCloseTo(1000 / 6);
    expect(tiny.max).toBeGreaterThanOrEqual(tiny.fit * 8);
    const large = visualScaleBounds(12000, 600, bounds, "diagram");
    expect(boundedVisualSize(12000 * large.max, 600 * large.max)).toBe(true);
    expect(large.max).toBeLessThan(8);
    const hugeStage = visualScaleBounds(100, 1, { width: 1_000_000, height: 1_000_000 }, "diagram");
    expect(boundedVisualSize(100 * hugeStage.fit, hugeStage.fit)).toBe(true);
    expect(hugeStage.max).toBeGreaterThanOrEqual(hugeStage.fit);
    expect(Math.min(hugeStage.max, Math.max(hugeStage.min, hugeStage.fit * 1.25))).toBeGreaterThanOrEqual(hugeStage.fit);
  });
  it("bounds formula fit and zoom to the rendered pixel budget", () => {
    for (const [width, height] of [[20000, 1000], [10000, 10000]]) {
      const limits = visualScaleBounds(width, height, { width: 1_000_000, height: 1_000_000 }, "math");
      expect(Number.isFinite(limits.fit) && limits.fit > 0).toBe(true);
      expect(Number.isFinite(limits.max) && limits.max > 0).toBe(true);
      expect(width * limits.max).toBeLessThanOrEqual(32768);
      expect(height * limits.max).toBeLessThanOrEqual(32768);
      expect(width * limits.max * height * limits.max).toBeLessThanOrEqual(120_000_000);
      expect(limits.fit).toBeLessThanOrEqual(limits.max);
      expect(Math.min(limits.max, Math.max(limits.min, limits.fit * 1.25))).toBeGreaterThanOrEqual(limits.fit);
    }
  });
  it("rejects invalid and unbounded drawing dimensions", () => {
    for (const size of [[Infinity, 20], [0, 20], [NaN, 20], [40000, 20], [20000, 20000], [-1, 10]]) expect(boundedVisualSize(...size as [number, number])).toBe(false);
    expect(boundedVisualSize(12000, 600)).toBe(true);
  });
});
