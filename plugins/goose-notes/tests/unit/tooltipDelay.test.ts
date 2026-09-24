import { readFileSync } from "node:fs";
import { expect, test } from "playwright/test";
import {
  TOOLTIP_DELAY_MS,
  resolveTooltipDelayDuration,
} from "../../src/components/ui/tooltip-delay";

const readSource = (path: string) => readFileSync(path, "utf8");

test("全局 TooltipProvider 默认延迟 400ms，瞬间与 600 特例收入默认", () => {
  expect(TOOLTIP_DELAY_MS).toBe(400);
  expect(TOOLTIP_DELAY_MS).toBeGreaterThanOrEqual(400);
  expect(TOOLTIP_DELAY_MS).toBeLessThanOrEqual(500);

  expect(resolveTooltipDelayDuration(0)).toBe(TOOLTIP_DELAY_MS);
  expect(resolveTooltipDelayDuration(600)).toBe(TOOLTIP_DELAY_MS);
  expect(resolveTooltipDelayDuration(400)).toBe(400);
  expect(resolveTooltipDelayDuration(300)).toBe(300);
  expect(resolveTooltipDelayDuration(2000)).toBe(2000);

  const uiProvider = readSource("src/components/ui/tooltip.tsx");
  const editorProvider = readSource("src/components/editor/ui/tooltip.tsx");
  expect(uiProvider).toContain("delayDuration = TOOLTIP_DELAY_MS");
  expect(uiProvider).toContain("resolveTooltipDelayDuration(delayDuration)");
  expect(editorProvider).toContain("delayDuration = TOOLTIP_DELAY_MS");
  expect(editorProvider).toContain("resolveTooltipDelayDuration(delayDuration)");
});
