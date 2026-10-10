import { describe, expect, it } from 'vitest';
import { selectionToSourcePixels } from '../src/core/crop';

describe('crop', () => {
  it('converts selection bounds to scaled source pixels', () => {
    expect(selectionToSourcePixels({ x: 10.2, y: 20.6, width: 100.4, height: 80.2 }, 1.5)).toEqual({
      x: 15,
      y: 31,
      width: 151,
      height: 120,
    });
  });
});
