import { readFileSync } from "node:fs";
import { expect, test } from "playwright/test";
import { ACCENT_COLORS } from "../../src/stores/settings/types";

const css = readFileSync(
  new URL("../../src/styles/goose-accent-colors.css", import.meta.url),
  "utf8",
);

const REQUIRED_TOKENS = [
  "--primary",
  "--ring",
  "--goose-primary-hover-bg",
  "--goose-primary-active-bg",
  "--goose-interactive-selected",
  "--goose-interactive-selected-fg",
  "--goose-icon-chip-on-selected",
  "--goose-inline-code-bg",
  "--goose-inline-code-fg",
  "--goose-inline-code-border-hover",
  "--goose-callout-accent",
  "--goose-ai-approval-check-bg",
  "--goose-accent-link",
  "--goose-accent-focus",
  "--goose-accent-drag-line",
  "--goose-accent-drag-glow",
] as const;

function getRule(selector: string): string {
  const selectorIndex = css.indexOf(`${selector} {`);
  if (selectorIndex < 0) return "";
  const bodyStart = css.indexOf("{", selectorIndex) + 1;
  const bodyEnd = css.indexOf("}", bodyStart);
  return css.slice(bodyStart, bodyEnd);
}

test("八组强调色都提供浅色完整令牌和深色覆盖", () => {
  expect(ACCENT_COLORS).toHaveLength(8);

  for (const accentColor of ACCENT_COLORS) {
    const lightRule = getRule(`:root[data-goose-accent="${accentColor}"]`);
    const darkRule = getRule(`:root.dark[data-goose-accent="${accentColor}"]`);
    expect(lightRule, `${accentColor} light preset`).not.toBe("");
    expect(darkRule, `${accentColor} dark preset`).not.toBe("");
    for (const token of REQUIRED_TOKENS) {
      expect(lightRule, `${accentColor} missing ${token}`).toContain(
        `${token}:`,
      );
      expect(darkRule, `${accentColor} dark missing ${token}`).toContain(
        `${token}:`,
      );
    }
  }
});

test("强调色 preset 不使用旧 uTools 内核不可靠的颜色语法", () => {
  const declarations = css.replace(/\/\*[\s\S]*?\*\//g, "");
  expect(declarations).not.toContain("oklch(");
  expect(declarations).not.toContain("color-mix(");
  expect(declarations).not.toMatch(/hsl\(var\([^)]*\)\s*\//);
});

test("编辑器与 AI 行内代码都消费强调色 token", () => {
  const editorCss = readFileSync(
    new URL("../../src/pages/workspace/styles/editor-base.css", import.meta.url),
    "utf8",
  );
  const indexCss = readFileSync(
    new URL("../../src/index.css", import.meta.url),
    "utf8",
  );
  const aiCss = readFileSync(
    new URL("../../src/pages/workspace/styles/notebook-ai.css", import.meta.url),
    "utf8",
  );

  expect(editorCss).toContain(
    "background-color: var(--goose-inline-code-bg);",
  );
  expect(editorCss).toContain("color: var(--goose-inline-code-fg);");
  expect(editorCss).toContain("[data-goose-inline-code-content]");
  expect(indexCss).toContain(
    "background-color: var(--goose-inline-code-bg);",
  );
  expect(indexCss).toContain("color: var(--goose-inline-code-fg);");
  expect(indexCss).not.toMatch(
    /\.ai-markdown[\s\S]*code:not\(pre > code\)[\s\S]*hsl\(220/,
  );
  expect(aiCss).toContain("background: var(--goose-inline-code-bg);");
  expect(aiCss).toContain("color: var(--goose-inline-code-fg);");
  expect(aiCss).toContain("color: var(--goose-accent-link);");
});

function getToken(rule: string, token: string): string {
  const match = rule.match(new RegExp(`${token}:\\s*([^;]+);`));
  return match?.[1]?.trim() ?? "";
}

test("深色行内代码 token 足够有色相和底色", () => {
  const monoDark = getRule(':root.dark[data-goose-accent="mono"]');
  const irisDark = getRule(':root.dark[data-goose-accent="iris"]');
  const oceanDark = getRule(':root.dark[data-goose-accent="ocean"]');
  const amberDark = getRule(':root.dark[data-goose-accent="amber"]');
  const roseDark = getRule(':root.dark[data-goose-accent="rose"]');

  for (const [name, rule] of [
    ["mono", monoDark],
    ["iris", irisDark],
    ["ocean", oceanDark],
    ["amber", amberDark],
    ["rose", roseDark],
  ] as const) {
    expect(getToken(rule, "--goose-inline-code-bg"), `${name} bg`).not.toBe("");
    expect(getToken(rule, "--goose-inline-code-fg"), `${name} fg`).not.toBe("");
    expect(
      getToken(rule, "--goose-inline-code-border-hover"),
      `${name} border`,
    ).not.toBe("");
  }

  // 彩色 accent 不得再退回 0.14 淡底 / mono 灰字
  for (const [name, rule] of [
    ["iris", irisDark],
    ["ocean", oceanDark],
    ["amber", amberDark],
    ["rose", roseDark],
  ] as const) {
    const bg = getToken(rule, "--goose-inline-code-bg");
    const fg = getToken(rule, "--goose-inline-code-fg");
    expect(bg, `${name} dark bg too faint`).not.toMatch(/0\.14\)/);
    expect(fg, `${name} dark fg must not be mono gray`).not.toBe("#f5f5f5");
    expect(fg, `${name} dark fg must be hex color`).toMatch(/^#[0-9a-fA-F]{6}$/);
  }

  expect(getToken(irisDark, "--goose-inline-code-fg")).toBe("#c7d2fe");
  expect(getToken(oceanDark, "--goose-inline-code-fg")).toBe("#bfdbfe");
  expect(getToken(amberDark, "--goose-inline-code-bg")).toBe("#4a3b24");
  expect(getToken(amberDark, "--goose-inline-code-fg")).toBe("#fde68a");
  expect(getToken(roseDark, "--goose-inline-code-fg")).toBe("#fecdd3");
  expect(getToken(monoDark, "--goose-inline-code-fg")).toMatch(/^#f[a-f0-9]{5}$/i);
  expect(getToken(monoDark, "--goose-inline-code-bg")).not.toBe("");
});

test("深色 fallback 行内代码跟随选中表面，不再硬编码 iris", () => {
  const indexCss = readFileSync(
    new URL("../../src/index.css", import.meta.url),
    "utf8",
  );
  const darkSectionMatch = indexCss.match(/\.dark\s*\{([\s\S]*?)\n  \}/);
  expect(darkSectionMatch).not.toBeNull();
  const darkSection = darkSectionMatch?.[1] ?? "";
  expect(darkSection).toContain(
    "--goose-inline-code-bg: var(--goose-icon-chip-on-selected);",
  );
  expect(darkSection).toContain(
    "--goose-inline-code-fg: var(--goose-interactive-selected-fg);",
  );
  expect(darkSection).not.toContain("--goose-inline-code-bg: #3d3e64;");
  expect(darkSection).not.toContain("--goose-inline-code-fg: #c7d2fe;");
});

test("深色 accent 选择器绑定在 :root.dark 上提高匹配确定性", () => {
  expect(css).toContain(':root.dark[data-goose-accent="amber"]');
  expect(css).not.toMatch(/(?<!:root)\.dark\[data-goose-accent=/);
});
