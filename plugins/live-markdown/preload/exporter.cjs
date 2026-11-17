"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { assertNonEmptyPath } = require("./fs-workspace.cjs");

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function sanitizeExportHtmlString(rawHtml) {
  let html = String(rawHtml ?? "");
  if (!html) return "";

  // Strip heading fold buttons, gutter H1..H6 badges, collapsed pills, table toolbars, and datalists
  html = html
    .replace(
      /<button[^>]*class="[^"]*\bty-heading-fold-btn\b[^"]*"[^>]*>[\s\S]*?<\/button>/gi,
      ""
    )
    .replace(
      /<span[^>]*class="[^"]*\bty-heading-gutter-tag\b[^"]*"[^>]*>[\s\S]*?<\/span>/gi,
      ""
    )
    .replace(
      /<(?:button|span)[^>]*class="[^"]*\bty-heading-collapsed-pill\b[^"]*"[^>]*>[\s\S]*?<\/(?:button|span)>/gi,
      ""
    )
    .replace(
      /<div[^>]*class="[^"]*\bty-table-toolbar\b[^"]*"[^>]*>[\s\S]*?<\/div>/gi,
      ""
    )
    .replace(
      /<div[^>]*class="[^"]*\bty-live-syntax-badge\b[^"]*"[^>]*>[\s\S]*?<\/div>/gi,
      ""
    )
    .replace(/<datalist[\s\S]*?<\/datalist>/gi, "");

  // Convert code fence language <input class="ty-code-lang-input" ... value="lang"> to static <span class="ty-export-code-lang">
  html = html.replace(
    /<div[^>]*class="[^"]*\bmd-fences-header\b[^"]*"[^>]*>[\s\S]*?<\/div>/gi,
    (headerBlock) => {
      const valMatch = headerBlock.match(
        /<input[^>]*class="[^"]*\bty-code-lang-input\b[^"]*"[^>]*value="([^"]*)"/i
      );
      const lang = valMatch ? valMatch[1].trim() : "";
      if (!lang) return "";
      return `<div class="md-fences-header"><span class="ty-export-code-lang">${escapeHtml(
        lang
      )}</span></div>`;
    }
  );

  return html;
}

const DEFAULT_EXPORT_BASE_CSS = `
:root, body.typora-export {
  --bg-color: #ffffff;
  --text-color: #24292f;
  --muted-text-color: #57606a;
  --sidebar-bg: #f6f8fa;
  --border-color: #d0d7de;
  --subtle-border-color: #e5e9f0;
  --primary-color: #0969da;
  --code-bg: #f6f8fa;
  --code-text: #1f2328;
  --blockquote-border: #d0d7de;
  --blockquote-text: #57606a;
  --blockquote-bg: rgba(175, 184, 193, 0.08);
  --table-border: #d0d7de;
  --table-stripe-bg: #f6f8fa;
  --mark-bg: #fff8c5;
  --mark-text: #24292f;
  --font-body: -apple-system, BlinkMacSystemFont, "PingFang SC", "Segoe UI", sans-serif;
  --font-ui: -apple-system, BlinkMacSystemFont, "PingFang SC", "Segoe UI", sans-serif;
  --font-mono: "SFMono-Regular", Menlo, Monaco, Consolas, monospace;
  --diagram-bg: #f8fafc;
  --diagram-node-bg: #ffffff;
  --diagram-node-fill: #ffffff;
  --diagram-node-border: #64748b;
  --diagram-node-stroke: #64748b;
  --diagram-node-text: #0f172a;
  --diagram-primary-bg: #eff6ff;
  --diagram-primary-fill: #eff6ff;
  --diagram-primary-border: #3b82f6;
  --diagram-primary-stroke: #3b82f6;
  --diagram-accent-bg: #ecfdf5;
  --diagram-accent-fill: #ecfdf5;
  --diagram-accent-border: #10b981;
  --diagram-accent-stroke: #10b981;
  --diagram-edge: #475569;
  --diagram-label-bg: #ffffff;
  --diagram-lifeline: #cbd5e1;
}
body.typora-export[data-theme="night"] {
  --bg-color: #1e222a;
  --text-color: #d8dee9;
  --muted-text-color: #8b949e;
  --sidebar-bg: #171a21;
  --border-color: #30363d;
  --subtle-border-color: #262b33;
  --primary-color: #58a6ff;
  --code-bg: #15181e;
  --code-text: #e6edf3;
  --table-border: #30363d;
  --table-stripe-bg: #232831;
  --diagram-bg: #161b22;
  --diagram-node-bg: #21262d;
  --diagram-node-fill: #21262d;
  --diagram-node-border: #6e7681;
  --diagram-node-stroke: #6e7681;
  --diagram-node-text: #f0f6fc;
  --diagram-primary-bg: #1f324d;
  --diagram-primary-fill: #1f324d;
  --diagram-primary-border: #58a6ff;
  --diagram-primary-stroke: #58a6ff;
  --diagram-accent-bg: #18362b;
  --diagram-accent-fill: #18362b;
  --diagram-accent-border: #3fb950;
  --diagram-accent-stroke: #3fb950;
  --diagram-edge: #8b949e;
  --diagram-label-bg: #1e242c;
  --diagram-lifeline: #3b434d;
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
  line-height: 1.72;
  -webkit-font-smoothing: antialiased;
}
.typora-export-content {
  max-width: 914px;
  margin: 0 auto;
  padding: 36px 48px 80px;
}
.ty-heading-fold-btn,
.ty-heading-gutter-tag,
.ty-heading-collapsed-pill,
.ty-table-toolbar,
.ty-live-syntax-badge,
.md-fences-header button,
.md-fences-header datalist,
.md-toc-title button {
  display: none !important;
}
`;

function buildStandaloneHtml(options = {}) {
  const {
    title = "Untitled",
    htmlBody = "",
    themeName = "github",
    themeCss = "",
    baseCss = "",
    includeStyles = true
  } = options;

  const safeTitle = escapeHtml(title);
  const safeTheme = escapeHtml(themeName);
  const cleanedBody = sanitizeExportHtmlString(htmlBody);

  const styleBlock = includeStyles
    ? `<style type="text/css">
/* Typora Export Base Styles */
${DEFAULT_EXPORT_BASE_CSS}
${baseCss}
${themeCss}
</style>`
    : "";

  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${safeTitle}</title>
  ${styleBlock}
</head>
<body class="typora-export" data-theme="${safeTheme}">
  <div class="typora-export-content">
    <div id="write" class="is-node">
${cleanedBody}
    </div>
  </div>
</body>
</html>
`;
}

function exportHtmlFile(targetPath, options = {}) {
  const resolved = assertNonEmptyPath(targetPath, "targetPath");
  fs.mkdirSync(path.dirname(resolved), { recursive: true });
  const html = buildStandaloneHtml(options);
  fs.writeFileSync(resolved, html, "utf8");
  return {
    path: resolved,
    size: Buffer.byteLength(html, "utf8")
  };
}

module.exports = {
  escapeHtml,
  sanitizeExportHtmlString,
  buildStandaloneHtml,
  exportHtmlFile
};

