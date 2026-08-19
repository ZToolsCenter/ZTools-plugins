import { expect, test } from "playwright/test";
import {
  calculateContentAwarePixelRatio,
  getContentAwarePixelRatios,
  EXPORT_TARGET_LONG_EDGE,
} from "../../src/lib/imageExport/svgToPng";

function expectRatioWithinLimits(
  width: number,
  height: number,
  ratio: number,
): void {
  const outputWidth = Math.ceil(width * ratio);
  const outputHeight = Math.ceil(height * ratio);
  expect(outputWidth).toBeLessThanOrEqual(16_384);
  expect(outputHeight).toBeLessThanOrEqual(16_384);
  expect(outputWidth * outputHeight).toBeLessThanOrEqual(16_000_000);
}

test("小内容按 4K 长边抬倍率，避免固定 2× 发糊", () => {
  // 常见 AI 侧栏图表 / 小 mermaid：~480px 宽
  const ratio = calculateContentAwarePixelRatio(480, 320);
  expect(ratio).toBeGreaterThan(2);
  // 长边接近 4K 冗余
  expect(Math.ceil(480 * ratio)).toBeGreaterThanOrEqual(EXPORT_TARGET_LONG_EDGE - 1);
  expectRatioWithinLimits(480, 320, ratio);
});

test("中等内容至少 2×，长边不低于约 4K", () => {
  const ratio = calculateContentAwarePixelRatio(1_600, 900);
  expect(ratio).toBeGreaterThanOrEqual(2);
  expect(Math.ceil(1_600 * ratio)).toBeGreaterThanOrEqual(EXPORT_TARGET_LONG_EDGE - 1);
  expectRatioWithinLimits(1_600, 900, ratio);
});

test("已超过 4K 的大内容尽量保留倍率，并受像素上限约束", () => {
  // 4000×2000 @2× = 32M 像素，会先被 16M 总像素上限压到 √2
  const ratio = calculateContentAwarePixelRatio(4_000, 2_000);
  expect(ratio).toBeCloseTo(Math.sqrt(2), 2);
  expectRatioWithinLimits(4_000, 2_000, ratio);

  // 长边已 ≥4K 且面积允许时，至少 2×
  const wide = calculateContentAwarePixelRatio(4_000, 1_000);
  expect(wide).toBeGreaterThanOrEqual(2);
  expectRatioWithinLimits(4_000, 1_000, wide);

  const huge = calculateContentAwarePixelRatio(10_000, 10_000);
  expect(huge).toBeLessThan(2);
  expectRatioWithinLimits(10_000, 10_000, huge);
});

test("失败降级序列包含主倍率与更低档", () => {
  const ratios = getContentAwarePixelRatios(480, 320);
  expect(ratios[0]).toBe(calculateContentAwarePixelRatio(480, 320));
  expect(ratios.length).toBeGreaterThan(1);
  expect(ratios[ratios.length - 1]).toBeLessThanOrEqual(2);
  for (const ratio of ratios) {
    expectRatioWithinLimits(480, 320, ratio);
  }
});

test("显式 maxRatio 上限生效", () => {
  const ratio = calculateContentAwarePixelRatio(200, 100, { maxRatio: 3 });
  expect(ratio).toBeLessThanOrEqual(3);
  expectRatioWithinLimits(200, 100, ratio);
});
