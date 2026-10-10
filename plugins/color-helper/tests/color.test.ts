import { describe, it, expect } from 'vitest';
import chroma from 'chroma-js';
import { isDarkColor, isLightColor, textColorFor, dimColor, getContrastColor } from '../utils/color';
/** WCAG 对比度 */
function cr(l1: number, l2: number): number {
  const hi = Math.max(l1, l2);
  const lo = Math.min(l1, l2);
  return (hi + 0.05) / (lo + 0.05);
}

/**
 * isDarkColor 的判据是"白字对比度 >= 黑字对比度", 解出来正是
 * luminance <= sqrt(0.05 * 1.05) - 0.05 ≈ 0.17912878474779204
 */
const LUMINANCE_THRESHOLD = Math.sqrt(0.05 * 1.05) - 0.05;

describe('isDarkColor / isLightColor 严格互补', () => {
  it('已知值的判定结果', () => {
    // 期望值来自"白字/黑字哪个对比度更高"
    expect(isDarkColor('#000000')).toBe(true);
    expect(isDarkColor('#FFFFFF')).toBe(false);
    expect(isDarkColor('#336699')).toBe(true);
    expect(isDarkColor('#808080')).toBe(false);
    expect(isDarkColor('#E91E63')).toBe(false);
    expect(isDarkColor('#C4C4C4')).toBe(false);
  });

  it('对所有取样颜色严格互补(同一判据取反)', () => {
    for (let r = 0; r < 256; r += 17) {
      for (let g = 0; g < 256; g += 17) {
        for (let b = 0; b < 256; b += 17) {
          const hex = chroma.rgb(r, g, b).hex();
          expect(isLightColor(hex)).toBe(!isDarkColor(hex));
        }
      }
    }
  });
});

describe('isDarkColor 与 WCAG 最优选择一致', () => {
  it('不存在与 WCAG 最优选择不一致的取样颜色', () => {
    let mismatches = 0;
    for (let r = 0; r < 256; r += 17) {
      for (let g = 0; g < 256; g += 17) {
        for (let b = 0; b < 256; b += 17) {
          const hex = chroma.rgb(r, g, b).hex();
          const l = chroma(hex).luminance();
          const wcagDark = cr(l, 1) >= cr(l, 0);
          if (isDarkColor(hex) !== wcagDark) mismatches++;
        }
      }
    }
    expect(mismatches).toBe(0);
  });

  it('等价于 luminance < 0.17912878474779204', () => {
    let mismatches = 0;
    for (let r = 0; r < 256; r += 17) {
      for (let g = 0; g < 256; g += 17) {
        for (let b = 0; b < 256; b += 17) {
          const hex = chroma.rgb(r, g, b).hex();
          if (isDarkColor(hex) !== (chroma(hex).luminance() < LUMINANCE_THRESHOLD)) mismatches++;
        }
      }
    }
    expect(mismatches).toBe(0);
  });

  it('灰阶上的翻转点落在 #757575 与 #767676 之间', () => {
    expect(isDarkColor('#757575')).toBe(true);
    expect(isDarkColor('#767676')).toBe(false);
    expect(chroma('#757575').luminance()).toBeLessThan(LUMINANCE_THRESHOLD);
    expect(chroma('#767676').luminance()).toBeGreaterThan(LUMINANCE_THRESHOLD);
  });
});

describe('文字配色派生函数与判据一致', () => {
  it('textColorFor: 深底给白字, 浅底给黑字', () => {
    expect(textColorFor('#000000')).toBe('#fff');
    expect(textColorFor('#FFFFFF')).toBe('#000');
    expect(textColorFor('#336699')).toBe('#fff');
  });

  it('getContrastColor 与 textColorFor 同一判据(字面量不同: 3位 vs 6位)', () => {
    // 两者返回的字面量不同 —— textColorFor 是 '#fff' / '#000',
    // getContrastColor 是 '#FFFFFF' / '#000000'。这里比较的是"选黑还是选白",
    // 不是字符串本身
    for (const hex of ['#000000', '#FFFFFF', '#336699', '#808080', '#E91E63', '#C4C4C4']) {
      expect(chroma(getContrastColor(hex)).hex()).toBe(chroma(textColorFor(hex)).hex());
    }
  });

  it('dimColor: 深底用白色半透明, 浅底用黑色半透明', () => {
    expect(dimColor('#000000', 0.5)).toBe(chroma('#fff').alpha(0.5).hex());
    expect(dimColor('#FFFFFF', 0.5)).toBe(chroma('#000').alpha(0.5).hex());
    expect(dimColor('#000000', 0.5).slice(0, 7)).toBe('#ffffff');
    expect(dimColor('#FFFFFF', 0.5).slice(0, 7)).toBe('#000000');
  });
});
