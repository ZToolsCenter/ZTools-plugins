import { describe, it, expect } from 'vitest';
import { quantize } from '../utils/quantize';

/** 生成参考像素集: r∈[0,256,4) × g∈[0,256,8) × b∈[0,256,16) = 32768 个 */
function referencePixels(): number[][] {
  const px: number[][] = [];
  for (let r = 0; r < 256; r += 4)
    for (let g = 0; g < 256; g += 8)
      for (let b = 0; b < 256; b += 16) px.push([r, g, b]);
  return px;
}

describe('quantize 参数校验', () => {
  it('空像素集返回 null', () => {
    expect(quantize([], 10)).toBeNull();
  });

  it('maxColors < 2 返回 null(但 1 是合法整数, 不抛错)', () => {
    expect(quantize([[1, 2, 3]], 1)).toBeNull();
  });

  it('maxColors 非整数抛 Error', () => {
    expect(() => quantize([[1, 2, 3]], 2.5)).toThrow();
  });

  it('maxColors 超出 1..256 抛 Error', () => {
    expect(() => quantize([[1, 2, 3]], 0)).toThrow();
    expect(() => quantize([[1, 2, 3]], 257)).toThrow();
  });
});

describe('quantize 两个分支', () => {
  it('去重后 <= maxColors 走 SimpleCMap: map() 原样返回像素', () => {
    const cmap = quantize([[1, 2, 3], [4, 5, 6], [7, 8, 9]], 10)!;
    expect(cmap.map([1, 2, 3])).toEqual([1, 2, 3]);
  });

  it('SimpleCMap 的 palette 就是去重后的原像素', () => {
    const cmap = quantize([[1, 2, 3], [1, 2, 3], [4, 5, 6]], 10)!;
    expect(cmap.palette()).toEqual([[1, 2, 3], [4, 5, 6]]);
  });

  it('去重后 > maxColors 走 CMap 分支, 返回 maxColors 个代表色', () => {
    const cmap = quantize(referencePixels(), 10)!;
    expect(cmap.palette()).toHaveLength(10);
  });
});

describe('回归重点: palette() / map() 的返回形状', () => {
  it('palette() 每项是长度 3 的数组, 元素在 0..255', () => {
    const palette = quantize(referencePixels(), 10)!.palette();
    expect(palette.length).toBeGreaterThan(0);
    for (const c of palette) {
      expect(Array.isArray(c)).toBe(true);
      expect(c).toHaveLength(3);
      for (const ch of c) {
        expect(Number.isInteger(ch)).toBe(true);
        expect(ch).toBeGreaterThanOrEqual(0);
        expect(ch).toBeLessThanOrEqual(255);
      }
    }
  });

  it('map() 返回 number[] 而不是 number', () => {
    const mapped = quantize(referencePixels(), 10)!.map([12, 34, 56]);
    expect(Array.isArray(mapped)).toBe(true);
    expect(mapped).toHaveLength(3);
  });
});

describe('回归基线: 固定输入产出固定结果', () => {
  it('32768 像素量化为 10 色', () => {
    const cmap = quantize(referencePixels(), 10)!;
    expect(cmap.palette()).toHaveLength(10);
  });

  it('重复调用结果稳定(优先队列无随机性)', () => {
    const a = quantize(referencePixels(), 10)!.palette();
    const b = quantize(referencePixels(), 10)!.palette();
    expect(a).toEqual(b);
  });
});
