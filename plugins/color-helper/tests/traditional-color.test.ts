import { describe, it, expect } from 'vitest';
import { getColorAttr } from '../pages/TraditionalColorsPage';
import { classifyColor } from '../pages/GradientsPage';
import { isDarkColor } from '../utils/color';

/**
 * 传统色的 tag/dark 判定
 * tag 分段: l<0.2 black / l>0.85 white / s<0.2 gray / 其余按色相分段
 */

describe('getColorAttr: tag 分类', () => {
  it('明度两端', () => {
    expect(getColorAttr('#000000').tag).toBe('black');
    expect(getColorAttr('#ffffff').tag).toBe('white');
  });

  it('低饱和走 gray', () => {
    expect(getColorAttr('#808080').tag).toBe('gray');
    expect(getColorAttr('#C4C4C4').tag).toBe('gray');
  });

  it('色相分段', () => {
    expect(getColorAttr('#E91E63').tag).toBe('red');
    expect(getColorAttr('#336699').tag).toBe('blue');
    expect(getColorAttr('#2E8B57').tag).toBe('green');
    expect(getColorAttr('#FFD700').tag).toBe('yellow');
  });
});

describe('getColorAttr: dark 与统一判据一致', () => {
  it('等于 isDarkColor(与全局统一判据一致)', () => {
    const samples = [
      '#000000', '#ffffff', '#808080', '#E91E63', '#336699', '#C4C4C4',
      '#FFF799', '#B6A014', '#D5EBE1', '#80A492', '#FFF', '#123456',
    ];
    for (const c of samples) {
      expect(getColorAttr(c).dark).toBe(isDarkColor(c));
    }
  });
});

describe('getColorAttr: 边界值', () => {
  it('灰阶下落为 0 而不是 NaN 分支', () => {
    // 纯灰的 chroma.hsl()[0] 是 NaN, 实现里回落为 0 -> 落在 red 段
    // (只因 s < 0.2 更早命中, 实际 tag 是 gray)
    expect(getColorAttr('#808080').tag).toBe('gray');
    expect(getColorAttr('#ffffff').tag).toBe('white');
    expect(getColorAttr('#000000').tag).toBe('black');
  });

  it('l 恰好 0.2 / s 恰好 0.2 的邻域不发散', () => {
    // hsl(120, 50%, 20%) -> l 正好 0.2, 不满足 l<0.2, 落到色相分段
    expect(getColorAttr('#1a4d1a').tag).not.toBe('black');
    // hsl(120, 50%, 19%) -> l < 0.2
    expect(getColorAttr('#184618').tag).toBe('black');
  });

  it('色相恰好落在分段边界上时归入后一段', () => {
    // h=70 不满足 <70, 归 green
    expect(getColorAttr('hsl(70, 100%, 50%)').tag).toBe('green');
    // h=69.9 归 yellow
    expect(getColorAttr('hsl(69.9, 100%, 50%)').tag).toBe('yellow');
  });
});

describe('classifyColor(渐变页) 与 getColorAttr(传统色页) 同源', () => {
  // 两个文件各有一份色相分段表, 词表必须一致 —— 否则同一颜色在
  // 渐变页筛选项与传统色页筛选项会归到不同类
  it('tag 词表一致', () => {
    const hues = [0, 20, 30, 60, 100, 170, 200, 300, 340, 359];
    for (const h of hues) {
      const color = `hsl(${h}, 80%, 45%)`;
      expect(classifyColor(color)).toBe(getColorAttr(color).tag);
    }
  });

  it('通用取样下两者结果相同', () => {
    for (let r = 0; r < 256; r += 51) {
      for (let g = 0; g < 256; g += 51) {
        for (let b = 0; b < 256; b += 51) {
          const hex = `#${[r, g, b].map((v) => v.toString(16).padStart(2, '0')).join('')}`;
          expect(classifyColor(hex)).toBe(getColorAttr(hex).tag);
        }
      }
    }
  });
});
