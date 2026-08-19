import { expect, test } from "playwright/test";
import {
  calculateSafePixelRatio,
  getCapturePixelRatios,
} from "../../src/lib/imageExport/renderer";

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

test("图片导出比例同时受边长和总像素限制", () => {
  expect(calculateSafePixelRatio(1_200, 800)).toBe(3);

  const longRatio = calculateSafePixelRatio(1_000, 100_000);
  expectRatioWithinLimits(1_000, 100_000, longRatio);

  const wideRatio = calculateSafePixelRatio(20_000, 20_000);
  expectRatioWithinLimits(20_000, 20_000, wideRatio);
});

test("总像素卡在上限附近时会下调倍率而不是误报尺寸超限", () => {
  // 旧实现：floor 到 4 位后两端 ceil 会把总像素顶破 16M，直接抛
  // 「图片尺寸超出安全限制」。常见卡片宽高也很容易踩中。
  const borderlineCases: Array<[number, number]> = [
    [680, 5_000],
    [800, 10_000],
    [1_000, 2_000],
    [1_200, 5_000],
    [1_600, 2_000],
  ];

  for (const [width, height] of borderlineCases) {
    const ratio = calculateSafePixelRatio(width, height);
    expect(ratio).toBeGreaterThanOrEqual(0.1);
    expectRatioWithinLimits(width, height, ratio);
  }
});

test("连续导出失败时会按较低倍率重试", () => {
  expect(getCapturePixelRatios(1_200, 800)).toEqual([3, 2, 1]);

  const constrainedRatios = getCapturePixelRatios(1_000, 100_000);
  expect(constrainedRatios[0]).toBe(calculateSafePixelRatio(1_000, 100_000));
  expect(constrainedRatios).toEqual([0.1638, 0.1228, 0.1]);
});

test("过长内容不会用 0.1 下限突破画布安全边长", () => {
  expect(() => calculateSafePixelRatio(1_000, 200_000)).toThrow(
    "无法导出为单张图片",
  );
  expect(() => calculateSafePixelRatio(1_000, 200_000)).not.toThrow(
    "图片尺寸超出安全限制",
  );
});
