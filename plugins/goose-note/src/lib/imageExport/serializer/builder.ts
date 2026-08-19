import type { CardTheme } from "../themes";
import type { WatermarkConfig } from "../watermark";
import { getWatermarkHTML, normalizeWatermarkConfig } from "../watermark";
import { escapeHtml } from "./utils";

function getGoogleFontsUrl(): string {
  const families = [
    "Inter:wght@400;500;600;700;800;900",
    "Noto+Sans+SC:wght@300;400;500;600;700;800;900",
    "Noto+Serif+SC:wght@400;600;700",
    "JetBrains+Mono:wght@400;500",
    "Courier+Prime:wght@400;700",
    "ZCOOL+XiaoWei",
    "Ma+Shan+Zheng",
    // Space Grotesk 最高到 700；更大字重由浏览器合成
    "Space+Grotesk:wght@400;500;600;700",
    "Fraunces:opsz,wght@9..144,400;9..144,500;9..144,600;9..144,700",
    "IBM+Plex+Sans:wght@400;500;600",
    "IBM+Plex+Mono:wght@400;500",
  ];
  return `https://fonts.googleapis.com/css2?family=${families.join("&family=")}&display=swap`;
}

/** 在深浅两种墨色中选择与背景对比度更高的一种。 */
function getContrastingInk(color: string): "#0a0a0a" | "#ffffff" {
  const hex = color.trim();
  const short = /^#([0-9a-f]{3})$/i.exec(hex);
  const full = /^#([0-9a-f]{6})$/i.exec(hex);
  let r: number;
  let g: number;
  let b: number;
  if (short) {
    r = parseInt(short[1][0] + short[1][0], 16);
    g = parseInt(short[1][1] + short[1][1], 16);
    b = parseInt(short[1][2] + short[1][2], 16);
  } else if (full) {
    r = parseInt(full[1].slice(0, 2), 16);
    g = parseInt(full[1].slice(2, 4), 16);
    b = parseInt(full[1].slice(4, 6), 16);
  } else if (/^rgba?\(/i.test(hex)) {
    const nums = hex
      .replace(/rgba?\(/i, "")
      .replace(/\)/, "")
      .split(",")
      .map((p) => parseFloat(p.trim()));
    if (nums.length < 3 || nums.some((n) => !Number.isFinite(n))) {
      return "#ffffff";
    }
    r = nums[0];
    g = nums[1];
    b = nums[2];
  } else {
    return "#ffffff";
  }
  const linearize = (channel: number) => {
    const value = channel / 255;
    return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  };
  const luminance =
    0.2126 * linearize(r) + 0.7152 * linearize(g) + 0.0722 * linearize(b);
  const darkContrast = (luminance + 0.05) / 0.053;
  const lightContrast = 1.05 / (luminance + 0.05);
  return darkContrast >= lightContrast ? "#0a0a0a" : "#ffffff";
}

function contentHeadingSizes(theme: CardTheme): {
  h1: number;
  h2: number;
  h3: number;
} {
  const body = theme.bodyFontSize;
  return {
    h1: Math.max(
      Math.round(theme.titleFontSize * 0.85),
      Math.round(body * 1.75),
    ),
    h2: Math.max(Math.round(theme.titleFontSize * 0.7), Math.round(body * 1.4)),
    h3: Math.max(
      Math.round(theme.titleFontSize * 0.58),
      Math.round(body * 1.22),
    ),
  };
}

function contentHeadingWeights(theme: CardTheme): {
  h1: number;
  h2: number;
  h3: number;
} {
  const base = theme.titleFontWeight;
  return {
    h1: Math.min(Math.max(base, 600), 900),
    h2: Math.min(Math.max(base - 100, 600), 800),
    h3: Math.min(Math.max(base - 200, 600), 700),
  };
}

export function buildStyledHTML(params: {
  title: string;
  blocksHtml: string;
  theme: CardTheme;
  watermarkConfig?: WatermarkConfig;
}): string {
  const { title, blocksHtml, theme } = params;
  const wm = normalizeWatermarkConfig(params.watermarkConfig);
  const t = theme;
  const headingSize = contentHeadingSizes(t);
  const headingWeight = contentHeadingWeights(t);
  const checkMarkColor = getContrastingInk(t.accent);
  const decoStyle = t.showDecorations
    ? `
    .gooseshot-container::before {
      content: '';
      position: absolute;
      top: -120px; right: -80px;
      width: 360px; height: 360px;
      background: radial-gradient(circle, ${t.decorationColor} 0%, transparent 70%);
      border-radius: 50%;
    }
    .gooseshot-container::after {
      content: '';
      position: absolute;
      bottom: -100px; left: -60px;
      width: 280px; height: 280px;
      background: radial-gradient(circle, ${t.decorationColor} 0%, transparent 70%);
      border-radius: 50%;
    }`
    : "";

  const titleStyle = `
    font-family: ${t.titleFont};
    font-size: ${t.titleFontSize}px;
    font-weight: ${t.titleFontWeight};
    line-height: ${t.titleLineHeight};
    letter-spacing: ${t.titleLetterSpacing};
    color: ${t.textColor};
    text-align: ${t.titleAlign};
  `;

  const headerBorder =
    "margin-bottom: 24px; padding-bottom: 0; border-bottom: none;";

  return `<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8">
<link rel="stylesheet" href="${getGoogleFontsUrl()}">
<style>
* { margin: 0; padding: 0; box-sizing: border-box; }
body {
  font-family: ${t.bodyFont};
  color: ${t.textColor};
  line-height: ${t.bodyLineHeight};
  font-size: ${t.bodyFontSize}px;
  letter-spacing: ${t.bodyLetterSpacing};
}
.gooseshot-container {
  background: ${t.background};
  padding: ${t.containerPaddingY}px ${t.containerPaddingX}px;
  min-width: 680px;
  max-width: 1200px;
  position: relative;
  overflow: hidden;
}
${decoStyle}
.gooseshot-card {
  background: ${t.cardBg};
  border-radius: ${t.cardRadius}px;
  padding: ${t.cardPaddingY}px ${t.cardPaddingX}px;
  box-shadow: ${t.cardShadow};
  position: relative;
  z-index: 1;
  border: ${t.cardBorder};
}
.gooseshot-header { ${headerBorder} }
.gooseshot-title { ${titleStyle} }
.gooseshot-content > * { margin-bottom: 14px; }
.gooseshot-content > *:last-child { margin-bottom: 0; }
.gooseshot-content h1,
.gooseshot-content h2,
.gooseshot-content h3 {
  font-family: ${t.titleFont};
  color: ${t.textColor};
  letter-spacing: ${t.titleLetterSpacing};
  text-wrap: balance;
}
.gooseshot-content h1 {
  font-size: ${headingSize.h1}px;
  font-weight: ${headingWeight.h1};
  line-height: ${Math.max(t.titleLineHeight, 1.2)};
  margin-top: 28px;
  margin-bottom: 14px;
}
.gooseshot-content h2 {
  font-size: ${headingSize.h2}px;
  font-weight: ${headingWeight.h2};
  line-height: 1.3;
  margin-top: 24px;
  margin-bottom: 12px;
}
.gooseshot-content h3 {
  font-size: ${headingSize.h3}px;
  font-weight: ${headingWeight.h3};
  line-height: 1.35;
  margin-top: 20px;
  margin-bottom: 10px;
}
.gooseshot-content > h1:first-child,
.gooseshot-content > h2:first-child,
.gooseshot-content > h3:first-child { margin-top: 0; }
.gooseshot-content p {
  margin-bottom: 12px;
  line-height: ${t.bodyLineHeight};
}
/* 空段落：占满一行正文高度，避免空行塌缩 */
.gooseshot-content .empty-block {
  min-height: calc(1em * ${t.bodyLineHeight});
  margin-bottom: 12px;
  line-height: ${t.bodyLineHeight};
}
.gooseshot-content p:empty {
  min-height: calc(1em * ${t.bodyLineHeight});
}
.gooseshot-content ul,
.gooseshot-content ol,
.gooseshot-content ul.bn-list,
.gooseshot-content ol.bn-list {
  display: block;
  margin-bottom: 12px;
  padding-inline-start: 1.65em;
  list-style-position: outside;
}
.gooseshot-content ul,
.gooseshot-content ul.bn-list {
  list-style-type: disc;
}
.gooseshot-content ol,
.gooseshot-content ol.bn-list {
  list-style-type: decimal;
}
.gooseshot-content ul > li,
.gooseshot-content ol > li,
.gooseshot-content ul.bn-list > li,
.gooseshot-content ol.bn-list > li {
  display: list-item;
  padding-inline-start: 0.2em;
  margin-bottom: 5px;
  line-height: ${t.bodyLineHeight};
  color: inherit;
  break-inside: avoid;
}
.gooseshot-content ul > li::marker,
.gooseshot-content ul.bn-list > li::marker {
  color: currentColor;
  font-size: 0.82em;
}
.gooseshot-content ol > li::marker,
.gooseshot-content ol.bn-list > li::marker {
  color: currentColor;
  font-weight: 600;
  font-variant-numeric: tabular-nums;
}
.gooseshot-content li > ul,
.gooseshot-content li > ol,
.gooseshot-content li > ul.bn-list,
.gooseshot-content li > ol.bn-list {
  margin-top: 0.35em;
  margin-bottom: 0.2em;
}
.gooseshot-content code {
  font-family: ${t.codeFont};
  font-size: 0.86em;
  background: ${t.codeBg};
  padding: 2px 6px;
  border-radius: 4px;
  color: ${t.codeTextColor ?? t.textColor};
}
.gooseshot-content pre {
  background: ${t.codeBg};
  border-radius: 10px;
  padding: 16px 18px;
  overflow-x: auto;
  margin: 16px 0;
  border: 1px solid ${t.tableBorder};
  color: ${t.codeTextColor ?? t.textColor};
}
.gooseshot-content pre code {
  background: transparent;
  padding: 0;
  font-size: 13px;
  line-height: 1.7;
  font-family: ${t.codeFont};
  color: inherit;
}
.gooseshot-content .code-block {
  background: ${t.codeBg};
  border-radius: 10px;
  padding: 14px 16px;
  overflow-x: auto;
  margin: 16px 0;
  border: 1px solid ${t.tableBorder};
  color: ${t.codeTextColor ?? t.textColor};
  font-family: ${t.codeFont};
}
.gooseshot-content .code-lang {
  font-size: 11px;
  color: ${t.secondaryText};
  margin-bottom: 6px;
  font-family: ${t.bodyFont};
  line-height: 1.4;
}
.gooseshot-content .code-summary {
  font-size: 12px;
  color: ${t.secondaryText};
  margin-bottom: 8px;
  font-family: ${t.bodyFont};
}
.gooseshot-content .code-block pre {
  margin: 0;
  padding: 0;
  background: transparent;
  border: none;
  border-radius: 0;
}
.gooseshot-content pre.code-wrap,
.gooseshot-content .code-wrap {
  white-space: pre-wrap;
  word-break: break-word;
  overflow: visible;
}
.gooseshot-content blockquote {
  border-left: 3px solid ${t.quoteBorder};
  padding-left: 18px;
  margin: 16px 0;
  color: ${t.secondaryText};
  font-style: italic;
}
.gooseshot-content img {
  max-width: 100%;
  height: auto;
  border-radius: 10px;
  margin: 16px 0;
}
.gooseshot-content .export-figure { margin: 16px 0; }
.gooseshot-content .export-figure img {
  display: block;
  margin: 0 auto 8px;
  max-width: 100%;
  height: auto;
  border-radius: 10px;
}
.gooseshot-content .export-figure figcaption {
  color: ${t.secondaryText};
  font-size: 0.9em;
  text-align: center;
  line-height: 1.5;
}
.gooseshot-content .file-card {
  display: flex;
  gap: 10px;
  align-items: center;
  padding: 12px 14px;
  background: ${t.calloutBg};
  border: 1px solid ${t.tableBorder};
  border-radius: 10px;
  margin: 14px 0;
}
.gooseshot-content .file-icon { font-size: 18px; line-height: 1; flex-shrink: 0; }
.gooseshot-content .file-body { min-width: 0; flex: 1; }
.gooseshot-content .file-name { font-weight: 500; color: ${t.textColor}; }
.gooseshot-content .file-caption {
  font-size: 0.9em;
  color: ${t.secondaryText};
  margin-top: 2px;
}
.gooseshot-content table {
  width: 100%;
  border-collapse: collapse;
  margin: 16px 0;
  font-size: 14px;
}
.gooseshot-content th, .gooseshot-content td {
  border: 1px solid ${t.tableBorder};
  padding: 8px 12px;
  text-align: left;
}
.gooseshot-content th {
  background: ${t.codeBg};
  font-weight: 600;
  color: ${t.codeTextColor ?? t.textColor};
}
.gooseshot-content .media-fallback {
  color: ${t.secondaryText};
  font-size: 0.95em;
  margin: 12px 0;
}
.gooseshot-content hr {
  border: none;
  border-top: 1px solid ${t.divider};
  margin: 20px 0;
}
.gooseshot-content .callout {
  background: ${t.calloutBg};
  border: 1px solid currentColor;
  border-radius: 10px;
  padding: 14px 18px;
  margin: 14px 0;
  display: flex;
  gap: 10px;
  align-items: flex-start;
  color: ${t.textColor};
  break-inside: avoid;
}
.gooseshot-content .callout-icon {
  font-size: 18px;
  line-height: 1;
  flex-shrink: 0;
  height: ${t.bodyFontSize * t.bodyLineHeight}px;
  display: flex;
  align-items: center;
}
.gooseshot-content .callout-text {
  flex: 1;
  min-width: 0;
  max-width: 100%;
  line-height: ${t.bodyLineHeight};
}
.gooseshot-content .callout-text > .nested-children {
  margin-left: 0;
  margin-top: 0.45em;
}
.gooseshot-content .nested-children {
  margin-left: 22px;
  margin-top: 6px;
}
.gooseshot-content .toggle-summary {
  display: flex;
  align-items: flex-start;
  gap: 6px;
}
.gooseshot-content .toggle-marker {
  flex-shrink: 0;
  color: ${t.secondaryText};
  line-height: inherit;
}
.gooseshot-content .toggle-children {
  margin-left: 22px;
  margin-top: 6px;
  border-left: 2px solid ${t.divider};
  padding-left: 14px;
}
.gooseshot-content .nested-children > *,
.gooseshot-content .toggle-children > * { margin-bottom: 8px; }
.gooseshot-content .nested-children > *:last-child,
.gooseshot-content .toggle-children > *:last-child { margin-bottom: 0; }
.gooseshot-content .callout-text pre,
.gooseshot-content .nested-children table,
.gooseshot-content .toggle-children table { max-width: 100%; }
.gooseshot-watermark {
  margin-top: 28px;
  padding-top: 18px;
  border-top: 1px solid ${t.divider};
  display: flex;
  justify-content: space-between;
  align-items: center;
}
.gooseshot-watermark-left {
  display: flex;
  align-items: center;
  gap: 6px;
}
.gooseshot-watermark-icon { font-size: 16px; line-height: 1; }
.gooseshot-watermark-brand {
  color: ${t.watermark};
  font-size: 12px;
  font-weight: 500;
  letter-spacing: 0.02em;
}
.gooseshot-watermark-date {
  color: ${t.watermark};
  font-size: 11px;
  font-weight: 400;
}
.gooseshot-content strong { font-weight: 600; }
.gooseshot-content em { font-style: italic; }
.gooseshot-content del { text-decoration: line-through; }
.gooseshot-content a {
  color: ${t.accent};
  text-decoration: none;
}
.gooseshot-content a:hover { text-decoration: underline; }
.gooseshot-content .task-item {
  display: flex;
  align-items: flex-start;
  gap: 0.5em;
  margin-bottom: 0.35em;
  line-height: ${t.bodyLineHeight};
  font-size: ${t.bodyFontSize}px;
  color: ${t.textColor};
  break-inside: avoid;
}
.gooseshot-content .task-checkbox-wrap {
  height: ${t.bodyLineHeight}em;
  display: flex;
  align-items: center;
  flex-shrink: 0;
}
.gooseshot-content .task-checkbox {
  width: 1em;
  height: 1em;
  border: 1.5px solid currentColor;
  background: transparent;
  border-radius: 0.22em;
  display: flex;
  align-items: center;
  justify-content: center;
  box-sizing: border-box;
}
.gooseshot-content .task-checkbox.checked {
  background: ${t.accent};
  border-color: ${t.accent};
}
.gooseshot-content .task-checkbox.checked::after {
  content: '✓';
  color: ${checkMarkColor};
  font-size: 0.72em;
  line-height: 1;
  font-weight: 700;
}
.gooseshot-content .task-item.checked .task-text {
  color: ${t.secondaryText};
  text-decoration: none;
}
.gooseshot-content .task-text {
  flex: 1;
  min-width: 0;
  line-height: ${t.bodyLineHeight};
}
</style>
</head>
<body>
<div class="gooseshot-container">
  <div class="gooseshot-card">
    ${
      wm.showTitle
        ? `<div class="gooseshot-header">
      <div class="gooseshot-title">${escapeHtml(title || "无标题")}</div>
    </div>`
        : ""
    }
    <div class="gooseshot-content">
      ${blocksHtml}
    </div>
    ${getWatermarkHTML(theme, wm)}
  </div>
</div>
</body>
</html>`;
}
