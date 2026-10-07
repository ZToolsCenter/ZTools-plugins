import { describe, it, expect } from 'vitest';
import { calculateGradientLine } from '../utils/gradient';

/** 渐变线长度 = 起点到终点的距离 */
function lineLength(w: number, h: number, angle: number): number {
  const { tx, ty, bx, by } = calculateGradientLine(w, h, angle);
  return Math.hypot(bx - tx, by - ty);
}

function round(v: number): number {
  // +0 归一化: Math.sin(Math.PI) 会产出 -0, deepEqual 下 -0 !== 0
  const r = Math.round(v * 100) / 100;
  return r === 0 ? 0 : r;
}

/** 浮点端点比较: 逐项 toBeCloseTo, 避开 -0 与 1e-14 级误差 */
function expectPoint(
  actual: { tx: number; ty: number; bx: number; by: number },
  start: number[],
  end: number[],
) {
  expect(actual.tx).toBeCloseTo(start[0]!, 2);
  expect(actual.ty).toBeCloseTo(start[1]!, 2);
  expect(actual.bx).toBeCloseTo(end[0]!, 2);
  expect(actual.by).toBeCloseTo(end[1]!, 2);
}

describe('calculateGradientLine 基线值', () => {
  it.each([
    [500, 500, 135, [0, 0], [500, 500], 707.11],
    [500, 500, 0, [250, 500], [250, 0], 500],
    [500, 500, 90, [0, 250], [500, 250], 500],
    [500, 500, 180, [250, 0], [250, 500], 500],
    [1000, 500, 135, [125, -125], [875, 625], 1060.66],
    [1200, 900, 45, [75, 975], [1125, -75], 1484.92],
  ])('%ix%i @ %i° → 起点 %o 终点 %o L=%f', (w, h, angle, start, end, len) => {
    const line = calculateGradientLine(w as number, h as number, angle as number);
    expectPoint(line, start as number[], end as number[]);
    expect(round(lineLength(w as number, h as number, angle as number))).toBe(len);
  });
});

describe('回归护栏: 不要退回半对角线', () => {
  it('500×500 @135° 的端点不是半对角线那个错误值 (0,0)→(250,250)', () => {
    // 半对角线错误实现的特征值: 长度 353.55(= 对角线的一半)
    expect(round(lineLength(500, 500, 135))).not.toBe(353.55);
    expect(lineLength(500, 500, 135)).not.toBeCloseTo(500 * Math.SQRT2 / 2, 2);
  });

  it('135° 的对角线长度应为 √2·w(而非半对角线)', () => {
    expect(round(lineLength(500, 500, 135))).toBe(round(Math.SQRT2 * 500));
  });
});

describe('calculateGradientLine 几何不变量', () => {
  const sizes: Array<[number, number]> = [[500, 500], [1000, 500], [1200, 900], [1, 1], [333, 777]];

  it('中点恒为画布中心', () => {
    for (const [w, h] of sizes) {
      for (const angle of [0, 45, 90, 135, 180, 225, 270, 315, 360]) {
        const line = calculateGradientLine(w, h, angle);
        expect((line.tx + line.bx) / 2).toBeCloseTo(w / 2, 6);
        expect((line.ty + line.by) / 2).toBeCloseTo(h / 2, 6);
      }
    }
  });

  it('长度公式 = |w·sin a| + |h·cos a|', () => {
    for (const [w, h] of sizes) {
      for (const angle of [0, 30, 45, 90, 135, 180, 270, 315]) {
        const rad = (angle * Math.PI) / 180;
        const expected = Math.abs(w * Math.sin(rad)) + Math.abs(h * Math.cos(rad));
        expect(lineLength(w, h, angle)).toBeCloseTo(expected, 6);
      }
    }
  });

  it('0°/90°/180°/270° 落在画布边界的中点上', () => {
    expectPoint(calculateGradientLine(400, 200, 0), [200, 200], [200, 0]);
    expectPoint(calculateGradientLine(400, 200, 90), [0, 100], [400, 100]);
    expectPoint(calculateGradientLine(400, 200, 180), [200, 0], [200, 200]);
    expectPoint(calculateGradientLine(400, 200, 270), [400, 100], [0, 100]);
  });
});
