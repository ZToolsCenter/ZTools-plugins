import { describe, expect, it } from 'vitest';
import {
  clampScale,
  imageBoundsForScale,
  isValidSelection,
  normalizeRect,
  outerBoundsForImage,
  scaleFromWheelDelta,
  translateRect,
} from '../src/core/geometry';

describe('geometry', () => {
  it('normalizes a drag from bottom-right to top-left', () => {
    expect(normalizeRect({ x: 30, y: 40 }, { x: 10, y: 15 })).toEqual({
      x: 10,
      y: 15,
      width: 20,
      height: 25,
    });
  });

  it('rejects tiny selections', () => {
    expect(isValidSelection({ x: 0, y: 0, width: 7, height: 20 })).toBe(false);
    expect(isValidSelection({ x: 0, y: 0, width: 20, height: 7 })).toBe(false);
    expect(isValidSelection({ x: 0, y: 0, width: 8, height: 8 })).toBe(true);
  });

  it('adds frame space around an image window', () => {
    expect(outerBoundsForImage({ x: 100, y: 80, width: 200, height: 120 }, 6)).toEqual({
      x: 94,
      y: 74,
      width: 212,
      height: 132,
    });
  });

  it('scales around the current image center', () => {
    expect(imageBoundsForScale({ x: 100, y: 80, width: 200, height: 120 }, 1.5)).toEqual({
      x: 50,
      y: 50,
      width: 300,
      height: 180,
    });
  });

  it('clamps scale and applies wheel direction', () => {
    expect(clampScale(0.1)).toBe(0.3);
    expect(clampScale(4)).toBe(3);
    expect(scaleFromWheelDelta(1, -100)).toBe(1.1);
    expect(scaleFromWheelDelta(1, 100)).toBe(0.9);
  });

  it('translates a rectangle by a delta', () => {
    expect(translateRect({ x: 10, y: 20, width: 30, height: 40 }, 5, -8)).toEqual({
      x: 15,
      y: 12,
      width: 30,
      height: 40,
    });
  });

  it('returns the rectangle center', async () => {
    const { rectCenter } = await import('../src/core/geometry');

    expect(rectCenter({ x: 10, y: 20, width: 30, height: 40 })).toEqual({ x: 25, y: 40 });
  });

  it('scales an original image size around an existing center', async () => {
    const { imageBoundsForOriginalSize } = await import('../src/core/geometry');

    expect(imageBoundsForOriginalSize({ x: 200, y: 140 }, { width: 100, height: 80 }, 1.5)).toEqual({
      x: 125,
      y: 80,
      width: 150,
      height: 120,
    });
  });
});
