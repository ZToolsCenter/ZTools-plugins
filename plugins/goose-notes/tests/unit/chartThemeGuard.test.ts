import { expect, test } from "playwright/test";
import {
  buildOption,
  hasRenderableChartSeries,
  type SimplifiedConfig,
} from "../../src/agent/renderers/echarts/chartTheme";

test("hasRenderableChartSeries 要求非空数组", () => {
  expect(hasRenderableChartSeries(undefined)).toBe(false);
  expect(hasRenderableChartSeries(null)).toBe(false);
  expect(hasRenderableChartSeries([])).toBe(false);
  expect(hasRenderableChartSeries([{ name: "a", data: [1] }])).toBe(true);
});

test("buildOption 在 series 缺失或非数组时不抛", () => {
  const missing = { type: "bar", title: "x" } as unknown as SimplifiedConfig;
  expect(() => buildOption(missing, false, 1)).not.toThrow();
  const option = buildOption(missing, false, 1);
  expect(Array.isArray(option.series)).toBe(true);
  expect((option.series as unknown[]).length).toBe(0);

  const undef = { type: "line", series: undefined } as unknown as SimplifiedConfig;
  expect(() => buildOption(undef, true, 1)).not.toThrow();
});
