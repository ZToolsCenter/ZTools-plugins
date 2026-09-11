export const ACCENT_COLORS = [
  "mono",
  "iris",
  "ocean",
  "pine",
  "amber",
  "coral",
  "rose",
  "grape",
] as const;

export type AccentColor = (typeof ACCENT_COLORS)[number];

export const DEFAULT_ACCENT_COLOR: AccentColor = "mono";

export const ACCENT_OPTIONS: ReadonlyArray<{
  value: AccentColor;
  label: string;
  light: string;
  dark: string;
}> = [
  { value: "mono", label: "黑白", light: "#171717", dark: "#f5f5f5" },
  { value: "iris", label: "鸢尾", light: "#6366f1", dark: "#a5b4fc" },
  { value: "ocean", label: "海蓝", light: "#3b82f6", dark: "#93c5fd" },
  { value: "pine", label: "松绿", light: "#15803d", dark: "#86efac" },
  { value: "amber", label: "琥珀", light: "#b45309", dark: "#fbbf24" },
  { value: "coral", label: "朱砂", light: "#c2410c", dark: "#fdba74" },
  { value: "rose", label: "莓红", light: "#be123c", dark: "#fda4af" },
  { value: "grape", label: "葡萄", light: "#7e22ce", dark: "#d8b4fe" },
];

export function normalizeAccentColor(value: unknown): AccentColor {
  return typeof value === "string" && (ACCENT_COLORS as readonly string[]).includes(value)
    ? value as AccentColor
    : DEFAULT_ACCENT_COLOR;
}

export function applyAccentColor(accentColor: AccentColor): void {
  if (typeof document === "undefined") return;
  document.documentElement.setAttribute("data-accent", accentColor);
}
