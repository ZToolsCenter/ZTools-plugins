/**
 * Mermaid 渲染主题：Neo 外形 + 产品色，去掉默认黄底紫盒。
 */

import type { MermaidConfig } from "mermaid";

export const MERMAID_FONT =
  '"Noto Sans SC","PingFang SC","Hiragino Sans GB","Microsoft YaHei",Arial,sans-serif';

export type MermaidThemeMode = "light" | "dark";

export interface MermaidInitOptions {
  mode: MermaidThemeMode;
  securityLevel?: "strict" | "loose" | "antiscript";
  fontFamily?: string;
  useMaxWidth?: boolean;
}

const LIGHT = {
  background: "transparent",
  primaryColor: "#ffffff",
  primaryTextColor: "#141413",
  primaryBorderColor: "#e7e5e0",
  secondaryColor: "#eef2ff",
  secondaryTextColor: "#312e81",
  secondaryBorderColor: "#c7d2fe",
  tertiaryColor: "#f7f6f2",
  tertiaryTextColor: "#5c5b57",
  tertiaryBorderColor: "#e7e5e0",
  lineColor: "#c4c2ba",
  textColor: "#141413",
  mainBkg: "#ffffff",
  nodeBorder: "#e7e5e0",
  clusterBkg: "#f7f6f2",
  clusterBorder: "#e7e5e0",
  titleColor: "#5c5b57",
  edgeLabelBackground: "#ffffff",
  nodeTextColor: "#141413",
  actorBkg: "#ffffff",
  actorBorder: "#e7e5e0",
  actorTextColor: "#141413",
  actorLineColor: "#c4c2ba",
  signalColor: "#5c5b57",
  signalTextColor: "#141413",
  labelBoxBkgColor: "#f7f6f2",
  labelBoxBorderColor: "#e7e5e0",
  labelTextColor: "#141413",
  loopTextColor: "#5c5b57",
  noteBkgColor: "#eef2ff",
  noteTextColor: "#312e81",
  noteBorderColor: "#c7d2fe",
  gradientStart: "#ffffff",
  gradientStop: "#f7f6f2",
  useGradient: false,
  dropShadow: "drop-shadow(0 1px 2px rgba(15, 23, 42, 0.08))",
} as const;

const DARK = {
  background: "transparent",
  primaryColor: "#3a3a38",
  primaryTextColor: "#faf9f5",
  primaryBorderColor: "#4a4a47",
  secondaryColor: "#312e81",
  secondaryTextColor: "#e0e7ff",
  secondaryBorderColor: "#4338ca",
  tertiaryColor: "#2e2e2d",
  tertiaryTextColor: "#c2c0b6",
  tertiaryBorderColor: "#4a4a47",
  lineColor: "#8a8880",
  textColor: "#faf9f5",
  mainBkg: "#3a3a38",
  nodeBorder: "#4a4a47",
  clusterBkg: "#262625",
  clusterBorder: "#4a4a47",
  titleColor: "#c2c0b6",
  edgeLabelBackground: "#2e2e2d",
  nodeTextColor: "#faf9f5",
  actorBkg: "#3a3a38",
  actorBorder: "#4a4a47",
  actorTextColor: "#faf9f5",
  actorLineColor: "#8a8880",
  signalColor: "#c2c0b6",
  signalTextColor: "#faf9f5",
  labelBoxBkgColor: "#262625",
  labelBoxBorderColor: "#4a4a47",
  labelTextColor: "#faf9f5",
  loopTextColor: "#c2c0b6",
  noteBkgColor: "#1e1b4b",
  noteTextColor: "#e0e7ff",
  noteBorderColor: "#4338ca",
  gradientStart: "#3a3a38",
  gradientStop: "#2e2e2d",
  useGradient: false,
  dropShadow: "drop-shadow(0 1px 3px rgba(0, 0, 0, 0.4))",
} as const;

function timelineCss(mode: MermaidThemeMode) {
  const fill = mode === "dark" ? "#3a3a38" : "#ffffff";
  const stroke = mode === "dark" ? "#4a4a47" : "#e7e5e0";
  const text = mode === "dark" ? "#faf9f5" : "#141413";
  const axis = mode === "dark" ? "#8a8880" : "#c4c2ba";
  return `
.cluster rect { rx: 14px; ry: 14px; }
.edgeLabel { border-radius: 6px; }
.taskWrapper rect, .eventWrapper rect {
  fill: ${fill} !important;
  stroke: ${stroke} !important;
  stroke-width: 1px !important;
  rx: 10px;
  ry: 10px;
}
.taskWrapper text, .eventWrapper text {
  fill: ${text} !important;
}
.lineWrapper line {
  stroke: ${axis} !important;
  stroke-width: 1.5px !important;
  stroke-dasharray: none !important;
  marker-end: none !important;
}
`;
}

export function getMermaidThemeVariables(mode: MermaidThemeMode) {
  const tokens = mode === "dark" ? DARK : LIGHT;
  return {
    ...tokens,
    darkMode: mode === "dark",
    fontFamily: MERMAID_FONT,
    fontSize: "14px",
  };
}

export function getMermaidInitConfig(options: MermaidInitOptions) {
  const fontFamily = options.fontFamily ?? MERMAID_FONT;
  const useMaxWidth = options.useMaxWidth ?? false;
  return {
    startOnLoad: false,
    theme: options.mode === "dark" ? "neo-dark" : "neo",
    look: "neo",
    darkMode: options.mode === "dark",
    securityLevel: options.securityLevel ?? "strict",
    fontFamily,
    suppressErrorRendering: true,
    themeVariables: {
      ...getMermaidThemeVariables(options.mode),
      fontFamily,
    },
    themeCSS: timelineCss(options.mode),
    timeline: {
      useMaxWidth,
      disableMulticolor: true,
      padding: 24,
      leftMargin: 72,
    },
    flowchart: {
      htmlLabels: true,
      useMaxWidth,
      padding: 18,
      nodeSpacing: 36,
      rankSpacing: 48,
      wrappingWidth: 220,
      curve: "basis",
    },
    sequence: {
      useMaxWidth,
      boxMargin: 8,
      actorMargin: 28,
    },
  } satisfies MermaidConfig;
}

export function stripMermaidInitDirectives(source: string): string {
  return source.replace(/%%\{init:[\s\S]*?\}%%/gi, "").trim();
}
