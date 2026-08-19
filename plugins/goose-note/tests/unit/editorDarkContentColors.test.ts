import { readFileSync } from "node:fs";
import { expect, test } from "@playwright/test";

const css = readFileSync(
  "src/pages/workspace/styles/block-background.css",
  "utf8",
);

const colorNames = [
  "gray",
  "brown",
  "red",
  "orange",
  "yellow",
  "green",
  "blue",
  "purple",
  "pink",
] as const;

function readDarkToken(name: string, role: "text" | "bg") {
  const darkBlock = css.match(/\.dark\s*\{(?<body>[\s\S]*?)\n\}/)?.groups?.body;
  const value = darkBlock?.match(
    new RegExp(
      `--goose-editor-highlight-${name}-${role}:\\s*(#[0-9a-f]{6})`,
      "i",
    ),
  )?.[1];
  expect(value, `缺少 ${name} ${role} 深色令牌`).toBeTruthy();
  return value!;
}

function relativeLuminance(hex: string) {
  const channels = hex
    .slice(1)
    .match(/.{2}/g)!
    .map((part) => Number.parseInt(part, 16) / 255)
    .map((channel) =>
      channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4,
    );
  return channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722;
}

function contrastRatio(first: string, second: string) {
  const [lighter, darker] = [
    relativeLuminance(first),
    relativeLuminance(second),
  ].sort((a, b) => b - a);
  return (lighter + 0.05) / (darker + 0.05);
}

test("深色同色文字与背景均满足正文对比度", () => {
  for (const name of colorNames) {
    expect(
      contrastRatio(readDarkToken(name, "text"), readDarkToken(name, "bg")),
      `${name} 同色组合对比度不足`,
    ).toBeGreaterThanOrEqual(4.5);
  }
});

test("深色文字单独使用、背景搭配默认正文时也保持易读", () => {
  const editorBackground = "#2e2e2d";
  const defaultText = "#e6e6e6";

  for (const name of colorNames) {
    expect(
      contrastRatio(readDarkToken(name, "text"), editorBackground),
      `${name} 文字在编辑器背景上对比度不足`,
    ).toBeGreaterThanOrEqual(4.5);
    expect(
      contrastRatio(defaultText, readDarkToken(name, "bg")),
      `${name} 背景与默认正文对比度不足`,
    ).toBeGreaterThanOrEqual(4.5);
  }
});

test("深色色板只覆盖常规笔记本和原生编辑器", () => {
  expect(css).toContain(
    '.dark .workspace-shell .bn-root[data-color-scheme="dark"]',
  );
  expect(css).toContain(
    '.dark .native-editor-root .bn-root[data-color-scheme="dark"]',
  );
  expect(css).not.toContain(".dark .quicknote-root .bn-root");
});
