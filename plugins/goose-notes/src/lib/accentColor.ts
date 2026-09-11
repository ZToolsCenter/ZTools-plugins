import type { AccentColor } from "@/stores/settings/types";

type AccentRuntimeTokens = {
  light: Record<string, string>;
  dark: Record<string, string>;
};

/**
 * 运行时直接写入的强调色 token。
 * 侧栏选中与行内代码等关键表面依赖这些变量；仅靠 CSS 选择器时，
 * 旧内核 / 缓存 CSS 可能只命中部分 token，导致侧栏已跟随 accent、
 * 行内代码仍停在 .dark 的 iris fallback。
 */
const ACCENT_RUNTIME_TOKENS: Record<AccentColor, AccentRuntimeTokens> = {
  iris: {
    light: {
      "--goose-interactive-selected": "#e0e7ff",
      "--goose-interactive-selected-fg": "#4f46e5",
      "--goose-icon-chip-on-selected": "#eef2ff",
      "--goose-inline-code-bg": "#eef2ff",
      "--goose-inline-code-fg": "#4f46e5",
      "--goose-inline-code-border-hover": "#c7d2fe",
      "--goose-editor-selection-bg": "#e0e7ff",
    },
    dark: {
      "--goose-interactive-selected": "rgba(99, 102, 241, 0.2)",
      "--goose-interactive-selected-fg": "#a5b4fc",
      "--goose-icon-chip-on-selected": "rgba(99, 102, 241, 0.14)",
      "--goose-inline-code-bg": "#3d3e64",
      "--goose-inline-code-fg": "#c7d2fe",
      "--goose-inline-code-border-hover": "#6366f1",
      "--goose-editor-selection-bg": "rgba(99, 102, 241, 0.35)",
    },
  },
  ocean: {
    light: {
      "--goose-interactive-selected": "#dbeafe",
      "--goose-interactive-selected-fg": "#2563eb",
      "--goose-icon-chip-on-selected": "#eff6ff",
      "--goose-inline-code-bg": "#eff6ff",
      "--goose-inline-code-fg": "#2563eb",
      "--goose-inline-code-border-hover": "#bfdbfe",
      "--goose-editor-selection-bg": "#dbeafe",
    },
    dark: {
      "--goose-interactive-selected": "rgba(59, 130, 246, 0.2)",
      "--goose-interactive-selected-fg": "#93c5fd",
      "--goose-icon-chip-on-selected": "rgba(59, 130, 246, 0.14)",
      "--goose-inline-code-bg": "#324665",
      "--goose-inline-code-fg": "#bfdbfe",
      "--goose-inline-code-border-hover": "#3b82f6",
      "--goose-editor-selection-bg": "rgba(59, 130, 246, 0.35)",
    },
  },
  mono: {
    light: {
      "--goose-interactive-selected": "#e5e5e5",
      "--goose-interactive-selected-fg": "#171717",
      "--goose-icon-chip-on-selected": "#f5f5f5",
      "--goose-inline-code-bg": "#f5f5f5",
      "--goose-inline-code-fg": "#171717",
      "--goose-inline-code-border-hover": "#d4d4d4",
      "--goose-editor-selection-bg": "#e5e5e5",
    },
    dark: {
      "--goose-interactive-selected": "rgba(255, 255, 255, 0.16)",
      "--goose-interactive-selected-fg": "#f5f5f5",
      "--goose-icon-chip-on-selected": "rgba(255, 255, 255, 0.1)",
      "--goose-inline-code-bg": "#3a3a3a",
      "--goose-inline-code-fg": "#f5f5f5",
      "--goose-inline-code-border-hover": "#737373",
      "--goose-editor-selection-bg": "rgba(255, 255, 255, 0.22)",
    },
  },
  pine: {
    light: {
      "--goose-interactive-selected": "#dcfce7",
      "--goose-interactive-selected-fg": "#15803d",
      "--goose-icon-chip-on-selected": "#f0fdf4",
      "--goose-inline-code-bg": "#f0fdf4",
      "--goose-inline-code-fg": "#15803d",
      "--goose-inline-code-border-hover": "#bbf7d0",
      "--goose-editor-selection-bg": "#dcfce7",
    },
    dark: {
      "--goose-interactive-selected": "rgba(34, 197, 94, 0.2)",
      "--goose-interactive-selected-fg": "#86efac",
      "--goose-icon-chip-on-selected": "rgba(34, 197, 94, 0.14)",
      "--goose-inline-code-bg": "#2b4a37",
      "--goose-inline-code-fg": "#bbf7d0",
      "--goose-inline-code-border-hover": "#22c55e",
      "--goose-editor-selection-bg": "rgba(34, 197, 94, 0.35)",
    },
  },
  amber: {
    light: {
      "--goose-interactive-selected": "#fef3c7",
      "--goose-interactive-selected-fg": "#b45309",
      "--goose-icon-chip-on-selected": "#fffbeb",
      "--goose-inline-code-bg": "#fffbeb",
      "--goose-inline-code-fg": "#b45309",
      "--goose-inline-code-border-hover": "#fde68a",
      "--goose-editor-selection-bg": "#fef3c7",
    },
    dark: {
      "--goose-interactive-selected": "rgba(245, 158, 11, 0.2)",
      "--goose-interactive-selected-fg": "#fbbf24",
      "--goose-icon-chip-on-selected": "rgba(245, 158, 11, 0.14)",
      "--goose-inline-code-bg": "#4a3b24",
      "--goose-inline-code-fg": "#fde68a",
      "--goose-inline-code-border-hover": "#f59e0b",
      "--goose-editor-selection-bg": "rgba(245, 158, 11, 0.35)",
    },
  },
  coral: {
    light: {
      "--goose-interactive-selected": "#ffedd5",
      "--goose-interactive-selected-fg": "#c2410c",
      "--goose-icon-chip-on-selected": "#fff7ed",
      "--goose-inline-code-bg": "#fff7ed",
      "--goose-inline-code-fg": "#c2410c",
      "--goose-inline-code-border-hover": "#fed7aa",
      "--goose-editor-selection-bg": "#ffedd5",
    },
    dark: {
      "--goose-interactive-selected": "rgba(249, 115, 22, 0.2)",
      "--goose-interactive-selected-fg": "#fdba74",
      "--goose-icon-chip-on-selected": "rgba(249, 115, 22, 0.14)",
      "--goose-inline-code-bg": "#4f3425",
      "--goose-inline-code-fg": "#fed7aa",
      "--goose-inline-code-border-hover": "#f97316",
      "--goose-editor-selection-bg": "rgba(249, 115, 22, 0.35)",
    },
  },
  rose: {
    light: {
      "--goose-interactive-selected": "#ffe4e6",
      "--goose-interactive-selected-fg": "#be123c",
      "--goose-icon-chip-on-selected": "#fff1f2",
      "--goose-inline-code-bg": "#fff1f2",
      "--goose-inline-code-fg": "#be123c",
      "--goose-inline-code-border-hover": "#fecdd3",
      "--goose-editor-selection-bg": "#ffe4e6",
    },
    dark: {
      "--goose-interactive-selected": "rgba(244, 63, 94, 0.2)",
      "--goose-interactive-selected-fg": "#fda4af",
      "--goose-icon-chip-on-selected": "rgba(244, 63, 94, 0.14)",
      "--goose-inline-code-bg": "#66333b",
      "--goose-inline-code-fg": "#fecdd3",
      "--goose-inline-code-border-hover": "#f43f5e",
      "--goose-editor-selection-bg": "rgba(244, 63, 94, 0.35)",
    },
  },
  grape: {
    light: {
      "--goose-interactive-selected": "#f3e8ff",
      "--goose-interactive-selected-fg": "#7e22ce",
      "--goose-icon-chip-on-selected": "#faf5ff",
      "--goose-inline-code-bg": "#faf5ff",
      "--goose-inline-code-fg": "#7e22ce",
      "--goose-inline-code-border-hover": "#e9d5ff",
      "--goose-editor-selection-bg": "#f3e8ff",
    },
    dark: {
      "--goose-interactive-selected": "rgba(168, 85, 247, 0.2)",
      "--goose-interactive-selected-fg": "#d8b4fe",
      "--goose-icon-chip-on-selected": "rgba(168, 85, 247, 0.14)",
      "--goose-inline-code-bg": "#46305d",
      "--goose-inline-code-fg": "#e9d5ff",
      "--goose-inline-code-border-hover": "#a855f7",
      "--goose-editor-selection-bg": "rgba(168, 85, 247, 0.35)",
    },
  },
};

function isDarkDocument(root: Element): boolean {
  return root.classList.contains("dark");
}

export function resolveAccentRuntimeTokens(
  accentColor: AccentColor,
  isDark: boolean,
): Record<string, string> {
  const tokens = ACCENT_RUNTIME_TOKENS[accentColor] ?? ACCENT_RUNTIME_TOKENS.mono;
  return isDark ? tokens.dark : tokens.light;
}

const RUNTIME_STYLE_ID = "goose-accent-runtime-vars";

function ensureRuntimeStyleEl(): HTMLStyleElement | null {
  if (typeof document === "undefined") return null;
  if (typeof document.getElementById !== "function") return null;
  if (typeof document.createElement !== "function") return null;
  let el = document.getElementById(RUNTIME_STYLE_ID) as HTMLStyleElement | null;
  if (!el) {
    el = document.createElement("style");
    el.id = RUNTIME_STYLE_ID;
    // 尽量挂到 head 末尾，压过打包 CSS
    (document.head || document.documentElement).appendChild(el);
  }
  return el;
}

function writeAccentRuntimeTokens(
  root: HTMLElement,
  accentColor: AccentColor,
): void {
  if (!root?.style?.setProperty) return;
  const tokens = resolveAccentRuntimeTokens(
    accentColor,
    isDarkDocument(root),
  );
  for (const [name, value] of Object.entries(tokens)) {
    // 旧内核 / 后续 CSS 偶发盖掉自定义属性时，important 保证行内代码跟强调色
    root.style.setProperty(name, value, "important");
  }

  // 再挂一份 style 标签：直接给编辑器 code 上色，彻底绕开变量被盖
  const styleEl = ensureRuntimeStyleEl();
  if (!styleEl) return;
  const bg = tokens["--goose-inline-code-bg"];
  const fg = tokens["--goose-inline-code-fg"];
  const border = tokens["--goose-inline-code-border-hover"];
  styleEl.textContent = `
:root {
  --goose-inline-code-bg: ${bg} !important;
  --goose-inline-code-fg: ${fg} !important;
  --goose-inline-code-border-hover: ${border} !important;
  --goose-interactive-selected: ${tokens["--goose-interactive-selected"]} !important;
  --goose-interactive-selected-fg: ${tokens["--goose-interactive-selected-fg"]} !important;
  --goose-icon-chip-on-selected: ${tokens["--goose-icon-chip-on-selected"]} !important;
  --goose-editor-selection-bg: ${tokens["--goose-editor-selection-bg"]} !important;
}
.workspace-editor-surface .bn-inline-content code,
.quicknote-editor-surface .bn-inline-content code,
.ai-markdown code:not(pre > code),
.ai-md [data-streamdown="inline-code"] {
  background-color: ${bg} !important;
  color: ${fg} !important;
}
.workspace-editor-surface .bn-inline-content code [data-goose-inline-code-content],
.quicknote-editor-surface .bn-inline-content code [data-goose-inline-code-content] {
  color: ${fg} !important;
}
`.trim();
}

/**
 * 应用强调色：
 * 1. 写 data-goose-accent，供静态 CSS preset 覆盖 primary 等其余 token
 * 2. 直接 setProperty 关键表面 token，避免仅靠选择器时行内代码掉回 iris fallback
 */
export function applyAccentColor(accentColor: AccentColor): void {
  if (typeof document === "undefined") return;
  const root = document.documentElement;
  root.setAttribute("data-goose-accent", accentColor);
  writeAccentRuntimeTokens(root, accentColor);
}

/**
 * 按当前 data-goose-accent + 明暗 class 重刷 runtime token。
 * 主题切换后应调用，避免仍停在上一模式的 inline-code vars。
 */
export function syncAccentColorCssVars(): void {
  if (typeof document === "undefined") return;
  const root = document.documentElement;
  if (!root || typeof root.getAttribute !== "function") return;
  const accentAttr = root.getAttribute("data-goose-accent");
  const accentColor = (accentAttr ?? "mono") as AccentColor;
  writeAccentRuntimeTokens(root, accentColor);
}
