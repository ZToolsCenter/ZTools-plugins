import { expect, test } from "playwright/test";
import {
  computeArtifactFitScale,
  getArtifactScaleRange,
  readEditorScale,
  shouldSnapToFitOnResize,
} from "../../src/pages/workspace/components/notebook-ai/artifactPanZoomScale";

test("适配比例下仍允许缩小到 25%", () => {
  const { minScale, maxScale } = getArtifactScaleRange(1);
  expect(minScale).toBe(0.25);
  expect(maxScale).toBe(5);
});

test("适配比例较小时，缩小下限不低于绝对最小值", () => {
  const { minScale } = getArtifactScaleRange(0.2);
  expect(minScale).toBe(0.08);
});

test("视口变小时不强制重新适配，避免 Cmd+= 把图缩回去", () => {
  expect(
    shouldSnapToFitOnResize({
      currentScale: 1,
      previousFit: 1,
      nextFit: 0.8,
    }),
  ).toBe(false);
});

test("视口变大且仍在适配比例时才重新铺满", () => {
  expect(
    shouldSnapToFitOnResize({
      currentScale: 1,
      previousFit: 1,
      nextFit: 1.2,
    }),
  ).toBe(true);
});

test("用户已经放大过则不因视口变化被拉回适配", () => {
  expect(
    shouldSnapToFitOnResize({
      currentScale: 1.5,
      previousFit: 1,
      nextFit: 1.2,
    }),
  ).toBe(false);
});

test("readEditorScale 读不到合法值时回退到 1", () => {
  expect(readEditorScale("")).toBe(1);
  expect(readEditorScale("1.25")).toBe(1.25);
});

test("适配比例按宽度优先，高度过大时不低于 0.55", () => {
  expect(
    computeArtifactFitScale({
      viewportWidth: 400,
      viewportHeight: 200,
      contentWidth: 200,
      contentHeight: 2000,
    }),
  ).toBe(0.55);
});
