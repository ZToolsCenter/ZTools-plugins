export const CODE_THEMES = [
  { id: "auto", label: "跟随编辑器" },
  { id: "light", label: "明亮" },
  { id: "dark", label: "暗色" },
  { id: "soft", label: "柔和" },
  { id: "contrast", label: "高对比" }
] as const;
export type CodeTheme = typeof CODE_THEMES[number]["id"];
export function normalizeCodeTheme(value: unknown): CodeTheme {
  return CODE_THEMES.some((theme) => theme.id === value) ? value as CodeTheme : "auto";
}
