import { ThemeName } from "../types/typora";

export interface ThemeMeta {
  id: ThemeName;
  label: string;
  description: string;
  isDark: boolean;
  fontFamily: string;
  previewBg: string;
  previewText: string;
  previewAccent: string;
}

export const TYPORA_THEMES: ThemeMeta[] = [
  {
    id: "github",
    label: "GitHub",
    description: "经典 GitHub 现代无衬线文档排版，清晰干练",
    isDark: false,
    fontFamily: '"Open Sans", "Clear Sans", "Helvetica Neue", Helvetica, Arial, "PingFang SC", sans-serif',
    previewBg: "#ffffff",
    previewText: "#333333",
    previewAccent: "#4183C4"
  },
  {
    id: "night",
    label: "Night",
    description: "深色沉浸主题，低眩光护眼配色",
    isDark: true,
    fontFamily: '"Helvetica Neue", Helvetica, Arial, "PingFang SC", sans-serif',
    previewBg: "#363B40",
    previewText: "#B8BFC6",
    previewAccent: "#E0E0E0"
  },
  {
    id: "newsprint",
    label: "Newsprint",
    description: "复古暖米色纸张衬线风格，适合深度长文阅读与写作",
    isDark: false,
    fontFamily: '"PT Serif", Georgia, "Times New Roman", "Songti SC", serif',
    previewBg: "#F3F2EE",
    previewText: "#1F0909",
    previewAccent: "#2E67A0"
  },
  {
    id: "pixyll",
    label: "Pixyll",
    description: "大字号、宽行距优雅书籍排版，兼具呼吸感与视觉张力",
    isDark: false,
    fontFamily: '"Merriweather", "PT Serif", Georgia, "PingFang SC", serif',
    previewBg: "#FAFAFA",
    previewText: "#333333",
    previewAccent: "#0076DF"
  },
  {
    id: "whitey",
    label: "Whitey",
    description: "瑞士极简网格与居中章节线风格，干净纯粹",
    isDark: false,
    fontFamily: '"Vollkorn", Palatino, Georgia, "PingFang SC", serif',
    previewBg: "#FEFEFE",
    previewText: "#333333",
    previewAccent: "#065588"
  },
  {
    id: "gothic",
    label: "Gothic",
    description: "现代几何无衬线细体，极简工业设计风格",
    isDark: false,
    fontFamily: '"Century Gothic", "Avenir Next", "Futura", "PingFang SC", sans-serif',
    previewBg: "#FCFCFC",
    previewText: "#111111",
    previewAccent: "#16A34A"
  }
];

interface ThemeCssVariables {
  bgColor: string;
  textColor: string;
  mutedTextColor: string;
  sidebarBg: string;
  sidebarHoverBg: string;
  sidebarActiveBg: string;
  sidebarActiveText: string;
  borderColor: string;
  subtleBorderColor: string;
  primaryColor: string;
  primaryHover: string;
  codeBg: string;
  codeText: string;
  blockquoteBorder: string;
  blockquoteText: string;
  blockquoteBg: string;
  tableBorder: string;
  tableStripeBg: string;
  markBg: string;
  markText: string;
  panelBg: string;
  fontBody: string;
  diagramBg: string;
  diagramNodeBg: string;
  diagramNodeBorder: string;
  diagramNodeText: string;
  diagramPrimaryBg: string;
  diagramPrimaryBorder: string;
  diagramAccentBg: string;
  diagramAccentBorder: string;
  diagramEdge: string;
  diagramLabelBg: string;
  diagramLifeline: string;
}

const THEME_CSS_VARS: Record<ThemeName, ThemeCssVariables> = {
  github: {
    bgColor: "#ffffff",
    textColor: "#24292f",
    mutedTextColor: "#57606a",
    sidebarBg: "#f6f8fa",
    sidebarHoverBg: "#eaeef2",
    sidebarActiveBg: "#dde8f8",
    sidebarActiveText: "#0969da",
    borderColor: "#d0d7de",
    subtleBorderColor: "#e5e9f0",
    primaryColor: "#0969da",
    primaryHover: "#0550ae",
    codeBg: "#f6f8fa",
    codeText: "#1f2328",
    blockquoteBorder: "#d0d7de",
    blockquoteText: "#57606a",
    blockquoteBg: "rgba(175, 184, 193, 0.08)",
    tableBorder: "#d0d7de",
    tableStripeBg: "#f6f8fa",
    markBg: "#fff8c5",
    markText: "#24292f",
    panelBg: "#ffffff",
    fontBody:
      '-apple-system, BlinkMacSystemFont, "PingFang SC", "Hiragino Sans GB", "Segoe UI", "Noto Sans SC", "Microsoft YaHei", sans-serif',
    diagramBg: "#f8fafc",
    diagramNodeBg: "#ffffff",
    diagramNodeBorder: "#64748b",
    diagramNodeText: "#0f172a",
    diagramPrimaryBg: "#eff6ff",
    diagramPrimaryBorder: "#3b82f6",
    diagramAccentBg: "#ecfdf5",
    diagramAccentBorder: "#10b981",
    diagramEdge: "#475569",
    diagramLabelBg: "#ffffff",
    diagramLifeline: "#cbd5e1"
  },
  night: {
    bgColor: "#1e222a",
    textColor: "#d8dee9",
    mutedTextColor: "#8b949e",
    sidebarBg: "#171a21",
    sidebarHoverBg: "#232832",
    sidebarActiveBg: "#263852",
    sidebarActiveText: "#58a6ff",
    borderColor: "#30363d",
    subtleBorderColor: "#262b33",
    primaryColor: "#58a6ff",
    primaryHover: "#79c0ff",
    codeBg: "#15181e",
    codeText: "#e6edf3",
    blockquoteBorder: "#3b4252",
    blockquoteText: "#9da7b3",
    blockquoteBg: "rgba(59, 66, 82, 0.25)",
    tableBorder: "#30363d",
    tableStripeBg: "#232831",
    markBg: "#5a4b1c",
    markText: "#f0f6fc",
    panelBg: "#222730",
    fontBody:
      '-apple-system, BlinkMacSystemFont, "PingFang SC", "Helvetica Neue", Helvetica, Arial, sans-serif',
    diagramBg: "#161b22",
    diagramNodeBg: "#21262d",
    diagramNodeBorder: "#6e7681",
    diagramNodeText: "#f0f6fc",
    diagramPrimaryBg: "#1f324d",
    diagramPrimaryBorder: "#58a6ff",
    diagramAccentBg: "#18362b",
    diagramAccentBorder: "#3fb950",
    diagramEdge: "#8b949e",
    diagramLabelBg: "#1e242c",
    diagramLifeline: "#3b434d"
  },
  newsprint: {
    bgColor: "#f4f1ea",
    textColor: "#2c2620",
    mutedTextColor: "#6e655b",
    sidebarBg: "#eae5db",
    sidebarHoverBg: "#dfd9cd",
    sidebarActiveBg: "#d4cbb8",
    sidebarActiveText: "#8b3a1e",
    borderColor: "#d3ccc0",
    subtleBorderColor: "#e2dcd0",
    primaryColor: "#9b3b1c",
    primaryHover: "#7c2d12",
    codeBg: "#ebe6dc",
    codeText: "#3b3228",
    blockquoteBorder: "#b8afa0",
    blockquoteText: "#5c5349",
    blockquoteBg: "rgba(184, 175, 160, 0.14)",
    tableBorder: "#cfc7b8",
    tableStripeBg: "#ede8de",
    markBg: "#f6df96",
    markText: "#2c2620",
    panelBg: "#f8f5ef",
    fontBody: '"Georgia", "Songti SC", "STSong", "Noto Serif SC", serif',
    diagramBg: "#efeae0",
    diagramNodeBg: "#faf7f0",
    diagramNodeBorder: "#8c7f70",
    diagramNodeText: "#2c2620",
    diagramPrimaryBg: "#f5e8df",
    diagramPrimaryBorder: "#9b3b1c",
    diagramAccentBg: "#e7efe8",
    diagramAccentBorder: "#3b6e52",
    diagramEdge: "#6e655b",
    diagramLabelBg: "#faf7f0",
    diagramLifeline: "#cfc7b8"
  },
  pixyll: {
    bgColor: "#fafafa",
    textColor: "#333333",
    mutedTextColor: "#6b7280",
    sidebarBg: "#f0f1f4",
    sidebarHoverBg: "#e5e7eb",
    sidebarActiveBg: "#e0e7ff",
    sidebarActiveText: "#4338ca",
    borderColor: "#e2e8f0",
    subtleBorderColor: "#edf2f7",
    primaryColor: "#4f46e5",
    primaryHover: "#4338ca",
    codeBg: "#f1f5f9",
    codeText: "#1e293b",
    blockquoteBorder: "#6366f1",
    blockquoteText: "#4b5563",
    blockquoteBg: "rgba(99, 102, 241, 0.05)",
    tableBorder: "#cbd5e1",
    tableStripeBg: "#f8fafc",
    markBg: "#fef08a",
    markText: "#1e293b",
    panelBg: "#ffffff",
    fontBody: '"Merriweather", "PingFang SC", "Hiragino Sans GB", serif',
    diagramBg: "#f8fafc",
    diagramNodeBg: "#ffffff",
    diagramNodeBorder: "#64748b",
    diagramNodeText: "#1e293b",
    diagramPrimaryBg: "#eef2ff",
    diagramPrimaryBorder: "#4f46e5",
    diagramAccentBg: "#ecfdf5",
    diagramAccentBorder: "#10b981",
    diagramEdge: "#475569",
    diagramLabelBg: "#ffffff",
    diagramLifeline: "#cbd5e1"
  },
  whitey: {
    bgColor: "#fcfcfc",
    textColor: "#1f2937",
    mutedTextColor: "#6b7280",
    sidebarBg: "#f4f4f6",
    sidebarHoverBg: "#e8e8ec",
    sidebarActiveBg: "#e4e9f2",
    sidebarActiveText: "#1d4ed8",
    borderColor: "#e5e7eb",
    subtleBorderColor: "#f0f1f4",
    primaryColor: "#2563eb",
    primaryHover: "#1d4ed8",
    codeBg: "#f3f4f6",
    codeText: "#111827",
    blockquoteBorder: "#9ca3af",
    blockquoteText: "#4b5563",
    blockquoteBg: "rgba(156, 163, 175, 0.08)",
    tableBorder: "#e5e7eb",
    tableStripeBg: "#f9fafb",
    markBg: "#fef3c7",
    markText: "#111827",
    panelBg: "#ffffff",
    fontBody: '"Vollkorn", Palatino, Georgia, "PingFang SC", serif',
    diagramBg: "#f9fafb",
    diagramNodeBg: "#ffffff",
    diagramNodeBorder: "#6b7280",
    diagramNodeText: "#111827",
    diagramPrimaryBg: "#eff6ff",
    diagramPrimaryBorder: "#2563eb",
    diagramAccentBg: "#ecfdf5",
    diagramAccentBorder: "#059669",
    diagramEdge: "#4b5563",
    diagramLabelBg: "#ffffff",
    diagramLifeline: "#d1d5db"
  },
  gothic: {
    bgColor: "#fcfcfc",
    textColor: "#111111",
    mutedTextColor: "#52525b",
    sidebarBg: "#f4f4f5",
    sidebarHoverBg: "#e4e4e7",
    sidebarActiveBg: "#dcfce7",
    sidebarActiveText: "#15803d",
    borderColor: "#e4e4e7",
    subtleBorderColor: "#f4f4f5",
    primaryColor: "#16a34a",
    primaryHover: "#15803d",
    codeBg: "#f4f4f5",
    codeText: "#18181b",
    blockquoteBorder: "#16a34a",
    blockquoteText: "#3f3f46",
    blockquoteBg: "rgba(22, 163, 74, 0.05)",
    tableBorder: "#e4e4e7",
    tableStripeBg: "#fafafa",
    markBg: "#bbf7d0",
    markText: "#14532d",
    panelBg: "#ffffff",
    fontBody: '"Century Gothic", "Avenir Next", "Futura", "PingFang SC", sans-serif',
    diagramBg: "#f8fafc",
    diagramNodeBg: "#ffffff",
    diagramNodeBorder: "#52525b",
    diagramNodeText: "#18181b",
    diagramPrimaryBg: "#f0fdf4",
    diagramPrimaryBorder: "#16a34a",
    diagramAccentBg: "#ecfeff",
    diagramAccentBorder: "#0891b2",
    diagramEdge: "#52525b",
    diagramLabelBg: "#ffffff",
    diagramLifeline: "#d4d4d8"
  }
};

export function getExportThemeCss(theme: ThemeName): string {
  const meta = TYPORA_THEMES.find((t) => t.id === theme) || TYPORA_THEMES[0];
  const vars = THEME_CSS_VARS[meta.id] || THEME_CSS_VARS.github;
  const isNight = meta.id === "night";

  return `
:root,
body.typora-export,
body.typora-export[data-theme="${meta.id}"] {
  --bg-color: ${vars.bgColor};
  --text-color: ${vars.textColor};
  --muted-text-color: ${vars.mutedTextColor};
  --sidebar-bg: ${vars.sidebarBg};
  --sidebar-hover-bg: ${vars.sidebarHoverBg};
  --sidebar-active-bg: ${vars.sidebarActiveBg};
  --sidebar-active-text: ${vars.sidebarActiveText};
  --border-color: ${vars.borderColor};
  --subtle-border-color: ${vars.subtleBorderColor};
  --primary-color: ${vars.primaryColor};
  --primary-hover: ${vars.primaryHover};
  --code-bg: ${vars.codeBg};
  --code-text: ${vars.codeText};
  --blockquote-border: ${vars.blockquoteBorder};
  --blockquote-text: ${vars.blockquoteText};
  --blockquote-bg: ${vars.blockquoteBg};
  --table-border: ${vars.tableBorder};
  --table-stripe-bg: ${vars.tableStripeBg};
  --mark-bg: ${vars.markBg};
  --mark-text: ${vars.markText};
  --panel-bg: ${vars.panelBg};
  --font-body: ${vars.fontBody};
  --font-ui: -apple-system, BlinkMacSystemFont, "PingFang SC", "Segoe UI", sans-serif;
  --font-mono: "SFMono-Regular", "JetBrains Mono", "Fira Code", Menlo, Monaco, Consolas, monospace;
  --font-monospace: var(--font-mono);
  --heading-border-color: var(--subtle-border-color);
  --side-bar-border-color: var(--border-color);
  --editor-max-width: 860px;
  --editor-font-size: 16px;
  --editor-line-height: 1.75;
  --diagram-bg: ${vars.diagramBg};
  --diagram-node-bg: ${vars.diagramNodeBg};
  --diagram-node-fill: ${vars.diagramNodeBg};
  --diagram-node-border: ${vars.diagramNodeBorder};
  --diagram-node-stroke: ${vars.diagramNodeBorder};
  --diagram-node-text: ${vars.diagramNodeText};
  --diagram-primary-bg: ${vars.diagramPrimaryBg};
  --diagram-primary-fill: ${vars.diagramPrimaryBg};
  --diagram-primary-border: ${vars.diagramPrimaryBorder};
  --diagram-primary-stroke: ${vars.diagramPrimaryBorder};
  --diagram-accent-bg: ${vars.diagramAccentBg};
  --diagram-accent-fill: ${vars.diagramAccentBg};
  --diagram-accent-border: ${vars.diagramAccentBorder};
  --diagram-accent-stroke: ${vars.diagramAccentBorder};
  --diagram-edge: ${vars.diagramEdge};
  --diagram-label-bg: ${vars.diagramLabelBg};
  --diagram-lifeline: ${vars.diagramLifeline};
}

*, *::before, *::after {
  box-sizing: border-box;
}

body.typora-export {
  margin: 0;
  padding: 0;
  background-color: var(--bg-color);
  color: var(--text-color);
  font-family: var(--font-body);
  font-size: var(--editor-font-size);
  line-height: var(--editor-line-height);
  -webkit-font-smoothing: antialiased;
  -moz-osx-font-smoothing: grayscale;
}

.typora-export-content {
  max-width: 914px;
  margin: 0 auto;
  padding: 36px 48px 80px;
}

body.typora-export #write {
  width: 100%;
  max-width: var(--editor-max-width);
  margin: 0 auto;
  font-family: var(--font-body);
  font-size: var(--editor-font-size);
  line-height: var(--editor-line-height);
  color: var(--text-color);
  word-wrap: break-word;
}

/* Hide interactive editor-only controls in exported HTML */
body.typora-export .ty-heading-fold-btn,
body.typora-export .ty-heading-gutter-tag,
body.typora-export .ty-heading-collapsed-pill,
body.typora-export .ty-table-toolbar,
body.typora-export .ty-live-syntax-badge,
body.typora-export .md-fences-header button,
body.typora-export .md-fences-header datalist,
body.typora-export .md-toc-title button {
  display: none !important;
}

body.typora-export .ty-block-wrapper {
  position: relative;
  margin: 4px 0;
}

.ty-heading-row {
  display: flex;
  align-items: center;
  gap: 6px;
}

#write h1,
#write h2,
#write h3,
#write h4,
#write h5,
#write h6 {
  flex: 1 1 auto;
  min-width: 0;
  margin-top: 1.1em;
  margin-bottom: 0.45em;
  font-weight: 700;
  line-height: 1.3;
  color: var(--text-color);
}

#write h1 {
  font-size: 1.95em;
  padding-bottom: 0.28em;
  border-bottom: 1px solid var(--subtle-border-color);
}

#write h2 {
  font-size: 1.5em;
  padding-bottom: 0.22em;
  border-bottom: 1px solid var(--subtle-border-color);
}

#write h3 { font-size: 1.25em; }
#write h4 { font-size: 1.08em; }
#write h5 { font-size: 1em; }
#write h6 { font-size: 0.92em; color: var(--muted-text-color); }

#write p {
  margin: 0.65em 0;
}

#write a,
#write a.md-link {
  color: var(--primary-color);
  text-decoration: none;
}

#write a:hover {
  text-decoration: underline;
}

#write blockquote {
  margin: 0.9em 0;
  padding: 8px 16px;
  border-left: 4px solid var(--blockquote-border);
  background-color: var(--blockquote-bg);
  color: var(--blockquote-text);
  border-radius: 0 6px 6px 0;
}

#write ul,
#write ol {
  margin: 0.6em 0;
  padding-left: 1.75em;
}

#write li {
  margin: 0.25em 0;
}

#write ul.ty-task-list {
  list-style: none;
  padding-left: 0.4em;
}

.ty-task-list-item {
  display: flex;
  align-items: baseline;
  gap: 8px;
  margin: 0.32em 0;
}

.ty-task-checkbox {
  width: 15px;
  height: 15px;
  accent-color: var(--primary-color);
  transform: translateY(2px);
  flex-shrink: 0;
}

.ty-task-text.is-checked {
  text-decoration: line-through;
  color: var(--muted-text-color);
}

/* YAML Front Matter & TOC */
.md-front-matter {
  margin: 0 0 1.4em;
  padding: 10px 14px;
  border: 1px dashed var(--border-color);
  border-radius: 8px;
  background-color: var(--code-bg);
  color: var(--muted-text-color);
  font-family: var(--font-mono);
  font-size: 12px;
  line-height: 1.55;
  white-space: pre-wrap;
}

.md-toc {
  margin: 1.1em 0;
  padding: 12px 16px;
  border: 1px solid var(--border-color);
  border-radius: 8px;
  background-color: var(--sidebar-bg);
}

.md-toc-title {
  font-family: var(--font-ui);
  font-size: 12px;
  font-weight: 700;
  color: var(--muted-text-color);
  text-transform: uppercase;
  letter-spacing: 0.03em;
  margin-bottom: 8px;
  padding-bottom: 6px;
  border-bottom: 1px solid var(--subtle-border-color);
}

.md-toc-item {
  font-size: 13.5px;
  line-height: 1.75;
  color: var(--primary-color);
  padding: 1px 6px;
}

/* GitHub-style Callout Alerts */
.md-alert {
  margin: 1em 0;
  padding: 12px 16px;
  border-left: 4px solid var(--primary-color);
  border-radius: 0 8px 8px 0;
  background-color: var(--code-bg);
}

.md-alert-title {
  font-family: var(--font-ui);
  font-size: 12.5px;
  font-weight: 700;
  margin-bottom: 4px;
  display: flex;
  align-items: center;
  gap: 6px;
}

.md-alert-NOTE { border-left-color: #0969da; background-color: rgba(9, 105, 218, 0.06); }
.md-alert-NOTE .md-alert-title { color: #0969da; }
.md-alert-TIP { border-left-color: #1a7f37; background-color: rgba(26, 127, 55, 0.06); }
.md-alert-TIP .md-alert-title { color: #1a7f37; }
.md-alert-IMPORTANT { border-left-color: #8250df; background-color: rgba(130, 80, 223, 0.06); }
.md-alert-IMPORTANT .md-alert-title { color: #8250df; }
.md-alert-WARNING { border-left-color: #9a6700; background-color: rgba(154, 103, 0, 0.08); }
.md-alert-WARNING .md-alert-title { color: #9a6700; }
.md-alert-CAUTION { border-left-color: #cf222e; background-color: rgba(207, 34, 46, 0.07); }
.md-alert-CAUTION .md-alert-title { color: #cf222e; }

/* Code Fences & Syntax Highlighting */
.md-fences,
#write pre {
  margin: 1em 0;
  border: 1px solid var(--border-color);
  border-radius: 8px;
  background-color: var(--code-bg);
  overflow: hidden;
}

#write pre {
  padding: 12px 16px;
  overflow-x: auto;
}

.md-fences-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 5px 12px;
  background-color: rgba(128, 128, 128, 0.06);
  border-bottom: 1px solid var(--subtle-border-color);
  font-family: var(--font-mono);
  font-size: 11.5px;
  font-weight: 600;
  color: var(--muted-text-color);
}

.ty-export-code-lang,
.ty-code-lang-input {
  font-family: var(--font-mono);
  font-size: 11.5px;
  font-weight: 600;
  color: var(--muted-text-color);
  border: none;
  background: transparent;
  padding: 0;
}

.ty-code-render {
  padding: 10px 12px;
  font-family: var(--font-mono);
  font-size: 13px;
  line-height: 1.6;
  color: var(--code-text);
  overflow-x: auto;
}

.ty-code-line {
  display: flex;
  align-items: baseline;
}

.ty-code-linenum {
  width: 28px;
  flex-shrink: 0;
  color: var(--muted-text-color);
  opacity: 0.55;
  font-size: 11.5px;
  text-align: right;
  padding-right: 12px;
  user-select: none;
  font-variant-numeric: tabular-nums;
}

.ty-code-linetext {
  flex: 1 1 auto;
  white-space: pre-wrap;
  word-break: break-word;
}

.cm-keyword { color: ${isNight ? "#ff7b72" : "#cf222e"}; font-weight: 600; }
.cm-string { color: ${isNight ? "#a5d6ff" : "#0a3069"}; }
.cm-comment { color: ${isNight ? "#8b949e" : "#6e7781"}; font-style: italic; }
.cm-number { color: ${isNight ? "#79c0ff" : "#0550ae"}; }
.cm-function { color: ${isNight ? "#d2a8ff" : "#8250df"}; }
.cm-operator { color: ${isNight ? "#ff7b72" : "#cf222e"}; }

/* Tables */
.ty-table-figure {
  margin: 1.1em 0;
  overflow-x: auto;
}

#write table {
  width: 100%;
  border-collapse: collapse;
  border-spacing: 0;
  font-size: 0.95em;
  margin: 0.5em 0;
}

#write th,
#write td {
  border: 1px solid var(--table-border);
  padding: 8px 12px;
}

#write th {
  background-color: var(--sidebar-bg);
  font-weight: 600;
}

#write tbody tr:nth-child(2n) {
  background-color: var(--table-stripe-bg);
}

/* Math & Diagrams */
.md-math-block,
.ty-math-block {
  margin: 1em 0;
  padding: 14px 18px;
  border-radius: 8px;
  background-color: var(--code-bg);
  border: 1px solid var(--subtle-border-color);
  text-align: center;
  overflow-x: auto;
}

.ty-math-render,
.ty-math-block-render,
.ty-math-inline-render {
  font-family: "Cambria Math", "Latin Modern Math", "STIX Two Math", Georgia, serif;
  display: inline-flex;
  align-items: center;
  flex-wrap: wrap;
  justify-content: center;
  gap: 2px;
}

.ty-math-display,
.ty-math-block-render {
  font-size: 1.12em;
  justify-content: center;
}

.ty-math-frac {
  display: inline-flex;
  flex-direction: column;
  align-items: center;
  vertical-align: middle;
  margin: 0 3px;
  font-size: 0.9em;
}

.ty-math-frac-num {
  border-bottom: 1px solid currentColor;
  padding: 0 4px 1px;
  line-height: 1.15;
}

.ty-math-frac-den {
  padding: 1px 4px 0;
  line-height: 1.15;
}

.ty-math-sqrt {
  display: inline-flex;
  align-items: baseline;
  margin: 0 2px;
}

.ty-math-sqrt-body {
  border-top: 1px solid currentColor;
  padding: 0 2px;
}

.ty-math-matrix,
.ty-math-env {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  vertical-align: middle;
  margin: 0 4px;
}

.ty-math-delim {
  font-size: 1.65em;
  font-weight: 300;
  line-height: 1;
  display: inline-flex;
  align-items: center;
  align-self: stretch;
}

.ty-math-matrix-grid {
  display: inline-flex;
  flex-direction: column;
  gap: 3px;
  padding: 2px 4px;
}

.ty-math-matrix-row {
  display: flex;
  gap: 12px;
  justify-content: center;
  align-items: center;
}

.ty-diagram-block,
.ty-mermaid-block {
  margin: 1em 0;
  padding: 18px 20px;
  border: 1px solid var(--border-color);
  border-radius: 8px;
  background-color: var(--diagram-bg, var(--code-bg));
  display: block;
  overflow-x: auto;
}

.ty-mermaid-svg-wrap {
  width: 100%;
  display: flex;
  justify-content: center;
  align-items: center;
  overflow-x: auto;
}

.ty-mermaid-svg {
  max-width: 100%;
  height: auto;
  display: block;
  margin: 0 auto;
  font-family: var(--font-ui);
}

.ty-mermaid-fallback {
  width: 100%;
  margin: 0;
  padding: 12px 14px;
  border-radius: 6px;
  background-color: var(--code-bg);
  color: var(--code-text);
  font-family: var(--font-mono);
  font-size: 12.5px;
  line-height: 1.6;
  white-space: pre-wrap;
}

/* Inline Elements */
#write code,
.md-codespan,
.md-inline-code {
  font-family: var(--font-mono);
  font-size: 0.875em;
  background-color: var(--code-bg);
  color: var(--code-text);
  border: 1px solid var(--subtle-border-color);
  padding: 0.15em 0.4em;
  border-radius: 4px;
}

#write pre code {
  border: none;
  padding: 0;
  background: transparent;
}

#write mark,
#write mark.md-highlight {
  background-color: var(--mark-bg);
  color: var(--mark-text);
  padding: 0.1em 0.3em;
  border-radius: 3px;
}

.md-footnote {
  color: var(--primary-color);
  font-weight: 600;
  margin: 0 1px;
}

.md-image {
  display: inline-flex;
  flex-direction: column;
  align-items: center;
  margin: 10px 0;
  max-width: 100%;
}

.md-image img {
  max-width: 100%;
  height: auto;
  border-radius: 6px;
  box-shadow: 0 2px 10px rgba(0, 0, 0, 0.08);
}

.md-image-caption {
  font-size: 12px;
  color: var(--muted-text-color);
  margin-top: 6px;
}

@media (max-width: 768px) {
  .typora-export-content {
    padding: 20px 18px 48px;
  }
}
`;
}

/**
 * Sanitizes raw `#write` HTML so exported standalone HTML documents do not
 * leak interactive editor controls (fold buttons, H1-H6 badges, language inputs,
 * copy buttons, datalist, or table editing toolbars).
 */
export function sanitizeExportHtmlBody(rawHtml: string): string {
  if (!rawHtml || typeof DOMParser === "undefined") {
    return rawHtml || "";
  }
  try {
    const parser = new DOMParser();
    const doc = parser.parseFromString(
      `<div id="export-root">${rawHtml}</div>`,
      "text/html"
    );
    const root = doc.getElementById("export-root");
    if (!root) return rawHtml;

    // If #write wrapper itself was passed in, unwrap its inner contents
    const writeEl = root.querySelector("#write");
    const container = writeEl || root;

    // 1. Remove editor-only interactive controls
    const removableSelectors = [
      ".ty-heading-fold-btn",
      ".ty-heading-gutter-tag",
      ".ty-heading-collapsed-pill",
      ".ty-table-toolbar",
      ".ty-live-syntax-badge",
      "datalist",
      ".md-fences-header button",
      ".md-toc-title button"
    ];
    container
      .querySelectorAll(removableSelectors.join(", "))
      .forEach((el) => el.remove());

    // 2. Transform code block headers: replace <input class="ty-code-lang-input"> with static label or remove empty header
    container.querySelectorAll(".md-fences-header").forEach((header) => {
      const input = header.querySelector(
        "input.ty-code-lang-input"
      ) as HTMLInputElement | null;
      const lang = (
        input?.getAttribute("value") ||
        input?.value ||
        ""
      ).trim();
      if (!lang) {
        header.remove();
      } else {
        header.innerHTML = `<span class="ty-export-code-lang">${lang
          .replace(/&/g, "&amp;")
          .replace(/</g, "&lt;")
          .replace(/>/g, "&gt;")}</span>`;
      }
    });

    // 3. Replace any table cell inputs with static text
    container
      .querySelectorAll("input.ty-table-cell-input")
      .forEach((inputEl) => {
        const val =
          inputEl.getAttribute("value") ||
          (inputEl as HTMLInputElement).value ||
          "";
        const span = doc.createElement("span");
        span.textContent = val;
        inputEl.replaceWith(span);
      });

    // 4. Make task list checkboxes read-only in exported HTML while keeping checked state
    container
      .querySelectorAll("input.ty-task-checkbox")
      .forEach((checkboxEl) => {
        checkboxEl.setAttribute("disabled", "disabled");
      });

    // 5. Remove editor-specific transient focus classes
    container.querySelectorAll(".md-focus").forEach((el) => {
      el.classList.remove("md-focus");
    });

    return container.innerHTML;
  } catch {
    return rawHtml;
  }
}

export const getThemeCss = getExportThemeCss;


