import { readFileSync } from "node:fs";
import { expect, test } from "@playwright/test";
import {
  BLOCKNOTE_BACKGROUND_COLORS,
  BLOCKNOTE_BACKGROUND_COLORS_DARK,
  BLOCKNOTE_TEXT_COLORS,
  BLOCKNOTE_TEXT_COLORS_DARK,
} from "../../src/lib/imageExport/serializer/utils";
import {
  renderBlock,
  renderInline,
} from "../../src/lib/imageExport/serializer/renderer";
import { CARD_THEMES } from "../../src/lib/imageExport/themes";

const editorColorCss = readFileSync(
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

function readEditorDarkToken(name: string, role: "text" | "bg") {
  const darkBlock = editorColorCss.match(/\.dark\s*\{(?<body>[\s\S]*?)\n\}/)
    ?.groups?.body;
  return darkBlock?.match(
    new RegExp(
      `--goose-editor-highlight-${name}-${role}:\\s*(#[0-9a-f]{6})`,
      "i",
    ),
  )?.[1];
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

test("深色导出色板与编辑器深色色板保持同步", () => {
  for (const name of colorNames) {
    expect(BLOCKNOTE_TEXT_COLORS_DARK[name], `${name} 文本色`).toBe(
      readEditorDarkToken(name, "text"),
    );
    expect(BLOCKNOTE_BACKGROUND_COLORS_DARK[name], `${name} 背景色`).toBe(
      readEditorDarkToken(name, "bg"),
    );
  }
});

test("深色导出同色文字与背景满足正文对比度", () => {
  for (const name of colorNames) {
    expect(
      contrastRatio(
        BLOCKNOTE_TEXT_COLORS_DARK[name],
        BLOCKNOTE_BACKGROUND_COLORS_DARK[name],
      ),
      `${name} 同色导出组合对比度不足`,
    ).toBeGreaterThanOrEqual(4.5);
  }
});

test("深色导出的块级与行内颜色都使用同步色板", () => {
  const darkTheme = CARD_THEMES.find((theme) => theme.mode === "dark")!;
  const blockHtml = renderBlock(
    {
      type: "heading",
      props: { level: 1, textColor: "blue", backgroundColor: "blue" },
      content: [{ type: "text", text: "深色导出", styles: {} }],
    },
    darkTheme,
  );
  const inlineHtml = renderInline(
    [
      {
        type: "text",
        text: "深色导出",
        styles: { textColor: "blue", backgroundColor: "blue" },
      },
    ],
    darkTheme,
  );

  for (const html of [blockHtml, inlineHtml]) {
    expect(html).toContain("color:#9bd5f3");
    expect(html).toContain("background-color:#223f52");
  }
});

test("浅色导出仍使用原浅色色板", () => {
  const lightTheme = CARD_THEMES.find((theme) => theme.mode === "light")!;
  const html = renderInline(
    [
      {
        type: "text",
        text: "浅色导出",
        styles: { textColor: "blue", backgroundColor: "blue" },
      },
    ],
    lightTheme,
  );

  expect(html).toContain(`color:${BLOCKNOTE_TEXT_COLORS.blue}`);
  expect(html).toContain(
    `background-color:${BLOCKNOTE_BACKGROUND_COLORS.blue}`,
  );
});
