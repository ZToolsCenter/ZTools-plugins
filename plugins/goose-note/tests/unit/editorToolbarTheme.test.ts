import { readFileSync } from "node:fs";
import { expect, test } from "playwright/test";

const readSource = (path: string) => readFileSync(path, "utf8");

test("块工具栏通过 pressed 状态统一使用强调色令牌", () => {
  const css = readSource("src/pages/workspace/styles/editor-base.css");
  const imageToolbar = readSource(
    "src/components/editor/image/ImageToolbar.tsx",
  );
  const videoToolbar = readSource(
    "src/components/editor/blocks/video/VideoToolbar.tsx",
  );

  expect(css).toContain('.goose-block-toolbar-control[aria-pressed="true"]');
  expect(css).toContain("background: var(--goose-interactive-selected)");
  expect(css).toContain("color: var(--goose-interactive-selected-fg)");
  expect(imageToolbar).toContain(
    'className="goose-editor-context-ui goose-block-toolbar-surface',
  );
  expect(videoToolbar).toContain("aria-pressed={pressed}");
  expect(videoToolbar).not.toContain('"bg-accent text-foreground"');
});

test("页面菜单及导出子菜单接入编辑器 UI 缩放", () => {
  const pageMenu = readSource(
    "src/pages/workspace/components/page/PageMenu.tsx",
  );

  expect(pageMenu).toContain(
    'className="max-h-[calc(100vh-24px)] w-[272px]',
  );
  expect(pageMenu).toContain(
    'className="min-w-[144px]',
  );
  expect(pageMenu).toContain(
    "sideOffset={6}",
  );
  expect(pageMenu).toContain("<FontSelector");
  expect(pageMenu).toContain("compact");
});
