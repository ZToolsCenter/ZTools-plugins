import { expect, test } from "playwright/test";
import { readFileSync } from "node:fs";

const readSource = (path: string) => readFileSync(path, "utf8");

test("AI 面板挂载时标记任务面，卸载时清标记并收起浮层", () => {
  const panel = readSource(
    "src/pages/workspace/components/notebook-ai/NotebookAiPanel.tsx",
  );
  const surface = readSource(
    "src/pages/workspace/components/notebook-ai/aiPanelSurface.ts",
  );

  expect(panel).toContain("setAiPanelSurface({ active: true, fullscreen: isFullscreen })");
  expect(panel).toContain("clearAiPanelSurface()");
  expect(panel).toContain("dismissAiFloatingLayers(root)");
  expect(surface).toContain('export const AI_PANEL_ACTIVE_ATTR = "data-goose-ai-panel-active"');
  expect(surface).toContain('export const AI_FULLSCREEN_ATTR = "data-goose-ai-fullscreen"');
  expect(surface).toContain(".goose-code-floating-toolbar");
  expect(surface).toContain("[data-formatting-toolbar]");
  expect(surface).toContain('[data-streamdown="code-block-actions"]');
  expect(surface).toContain('[data-streamdown="mermaid-block-actions"]');
});

test("切走 AI / 开设置时隐藏文字工具栏及同类浮动层", () => {
  const css = readSource("src/pages/workspace/styles/editor-base.css");

  expect(css).toContain(
    "body:is([data-goose-settings-open], [data-goose-ai-fullscreen]) [data-formatting-toolbar]",
  );
  expect(css).toContain(
    "body:is([data-goose-settings-open], [data-goose-ai-fullscreen]) .goose-code-floating-toolbar",
  );
  expect(css).toContain(
    "body:is([data-goose-settings-open], [data-goose-ai-fullscreen]) .goose-ai-menu-floating",
  );
  expect(css).toContain(
    'body:not([data-goose-ai-panel-active]) [data-streamdown="code-block-actions"]',
  );
  expect(css).toContain(
    'body:not([data-goose-ai-panel-active]) [data-streamdown="mermaid-block-actions"]',
  );
  expect(css).toContain(
    'body:not([data-goose-ai-panel-active]) [data-streamdown="table-fullscreen"]',
  );
});
