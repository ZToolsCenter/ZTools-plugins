import { readFileSync } from "node:fs";
import { expect, test } from "playwright/test";

const tableHandleSource = readFileSync(
  "src/components/editor/menus/GooseTableHandle.tsx",
  "utf8",
);
const popupCss = readFileSync(
  "src/pages/workspace/styles/editor-popup-position.css",
  "utf8",
);

test("表格菜单触发器不使用会污染 Portal 坐标的 CSS zoom", () => {
  expect(tableHandleSource).not.toContain(
    'className="goose-editor-inline-context-ui goose-table-handle-btn"',
  );
  expect(tableHandleSource).toContain(
    'className="goose-editor-position-safe-trigger goose-table-handle-btn"',
  );
});

test("表格把手用 transform 保持缩放视觉并保留旋转方向", () => {
  expect(popupCss).toContain(".goose-editor-position-safe-trigger");
  expect(popupCss).toContain("zoom: 1");
  expect(popupCss).toContain("scale(var(--editor-scale, 1))");
  expect(popupCss).toContain(
    "rotate(var(--goose-popup-trigger-rotate, 0turn))",
  );
  expect(tableHandleSource).toContain('"--goose-popup-trigger-rotate"');
});
