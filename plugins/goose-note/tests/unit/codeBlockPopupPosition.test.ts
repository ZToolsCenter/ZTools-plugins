import { readFileSync } from "node:fs";
import { expect, test } from "playwright/test";

const toolbarSource = readFileSync(
  "src/components/editor/blocks/code/CodeBlockToolbar.tsx",
  "utf8",
);
const specSource = readFileSync(
  "src/components/editor/blocks/code/codeBlockSpec.tsx",
  "utf8",
);
const popupCss = readFileSync(
  "src/pages/workspace/styles/editor-popup-position.css",
  "utf8",
);
const editorCss = readFileSync(
  "src/pages/workspace/styles/editor-base.css",
  "utf8",
);

test("代码块工具栏定位行不使用会污染 Portal 坐标的 CSS zoom", () => {
  expect(specSource).not.toContain(
    'className="goose-editor-inline-context-ui goose-code-toolbar-row"',
  );
  expect(specSource).toContain('className="goose-code-toolbar-row"');
});

test("代码块语言菜单触发簇用 transform 保持缩放并锚在块右上角", () => {
  expect(toolbarSource).toContain(
    "goose-editor-position-safe-trigger goose-code-toolbar-actions",
  );
  expect(popupCss).toContain(".goose-editor-position-safe-trigger");
  expect(popupCss).toContain("zoom: 1");
  expect(popupCss).toContain("scale(var(--editor-scale, 1))");
  expect(popupCss).toContain(
    "transform-origin: var(--goose-popup-trigger-origin, center)",
  );
  expect(editorCss).toContain(
    "--goose-popup-trigger-origin: top right",
  );
});
