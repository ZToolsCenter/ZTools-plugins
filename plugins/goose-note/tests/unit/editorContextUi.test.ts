import { expect, test } from "playwright/test";
import {
  getScaledEditorUiPx,
  normalizeEditorUiScale,
} from "../../src/components/editor/utils/editorContextUi";

test("编辑器上下文 UI 对非法缩放值安全回退", () => {
  expect(normalizeEditorUiScale("0.75")).toBe(0.75);
  expect(normalizeEditorUiScale(1.25)).toBe(1.25);
  expect(normalizeEditorUiScale(0)).toBe(1);
  expect(normalizeEditorUiScale("invalid")).toBe(1);
});

test("浮层外部间距随 UI 比例等比缩放", () => {
  expect(getScaledEditorUiPx(6, 0.75)).toBe(4.5);
  expect(getScaledEditorUiPx(6, 1)).toBe(6);
  expect(getScaledEditorUiPx(6, 1.25)).toBe(7.5);
});
