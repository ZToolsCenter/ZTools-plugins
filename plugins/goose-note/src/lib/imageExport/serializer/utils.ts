const OBJECT_REPLACEMENT_CHARACTER = /\uFFFC/g;

/**
 * U+FFFC 是编辑器内部用于表示内联原子节点的占位符。它不属于用户文本，
 * 某些字体会把它绘制成虚线框中的 “OBJ”，因此导出前统一移除。
 */
export function stripEditorObjectReplacementCharacters(value: string): string {
  return value.replace(OBJECT_REPLACEMENT_CHARACTER, "");
}

export function escapeHtml(value: string): string {
  return stripEditorObjectReplacementCharacters(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export const BLOCKNOTE_TEXT_COLORS: Record<string, string> = {
  gray: "#9b9a97",
  brown: "#64473a",
  red: "#e03e3e",
  orange: "#d9730d",
  yellow: "#dfab01",
  green: "#4d6461",
  blue: "#0b6e99",
  purple: "#6940a5",
  pink: "#ad1a72",
};

export const BLOCKNOTE_BACKGROUND_COLORS: Record<string, string> = {
  gray: "#ebeced",
  brown: "#e9e5e3",
  red: "#fbe4e4",
  orange: "#f6e9d9",
  yellow: "#fbf3db",
  green: "#ddedea",
  blue: "#ddebf1",
  purple: "#eae4f2",
  pink: "#f4dfeb",
};

/**
 * 深色导出卡片与常规编辑器共用的语义色阶：
 * 高明度文字 + 低明度同色表面，保证同色叠加仍清晰可读。
 * tests/unit/editorDarkExportColors.test.ts 会校验此处与编辑器 CSS 令牌同步。
 */
export const BLOCKNOTE_TEXT_COLORS_DARK: Record<string, string> = {
  gray: "#d6d4cf",
  brown: "#e7c1ad",
  red: "#ffb4b8",
  orange: "#ffc38f",
  yellow: "#f0d77d",
  green: "#9ddfba",
  blue: "#9bd5f3",
  purple: "#d0baf8",
  pink: "#f1b6d7",
};

export const BLOCKNOTE_BACKGROUND_COLORS_DARK: Record<string, string> = {
  gray: "#3d3d3a",
  brown: "#49352c",
  red: "#512b31",
  orange: "#50351f",
  yellow: "#453a1e",
  green: "#253f34",
  blue: "#223f52",
  purple: "#3b3055",
  pink: "#4b2c42",
};

export function resolveExportColor(
  value: unknown,
  palette: Record<string, string>,
): string | null {
  if (typeof value !== "string" || value === "" || value === "default")
    return null;
  return palette[value] || value;
}
