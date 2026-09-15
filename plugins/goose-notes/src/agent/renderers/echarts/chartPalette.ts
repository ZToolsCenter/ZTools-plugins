/**
 * 2026 数据可视化色板
 *
 * 设计原则（参考 shadcn charts / ECharts 6 / Tableau 色盲友好建议）：
 * - 分类色：高区分度、色盲友好（蓝/橙/青绿/紫，避免纯红绿对）
 * - 与产品 accent indigo (#4f46e5) 同色相起点，嵌入感更强
 * - 深浅主题共用同一色相，靠饱和与明度微调（见 getSeriesColor）
 */

/** 主分类色 — 亮色主题默认 */
export const PALETTE = [
  "#4f46e5", // indigo  — brand
  "#0d9488", // teal
  "#ea580c", // orange
  "#7c3aed", // violet
  "#0284c7", // sky
  "#db2777", // pink
  "#ca8a04", // amber
  "#059669", // emerald
];

/** 深色主题略提亮，避免在深底上发闷 */
export const PALETTE_DARK = [
  "#818cf8", // indigo 400
  "#2dd4bf", // teal 400
  "#fb923c", // orange 400
  "#a78bfa", // violet 400
  "#38bdf8", // sky 400
  "#f472b6", // pink 400
  "#fbbf24", // amber 400
  "#34d399", // emerald 400
];

/** 热力图顺序色（冷→热，色盲相对友好：蓝紫→琥珀） */
export const HEATMAP_LIGHT = ["#eef2ff", "#818cf8", "#4f46e5", "#312e81"];
export const HEATMAP_DARK = ["#1e1b4b", "#6366f1", "#a5b4fc", "#e0e7ff"];

export function getPalette(isDark: boolean): string[] {
  return isDark ? PALETTE_DARK : PALETTE;
}

export function getSeriesColor(index: number, isDark: boolean): string {
  const palette = getPalette(isDark);
  return palette[index % palette.length]!;
}

/** 把 hex 转成 rgba，兼容 uTools 旧内核（避免 hsl(var)/alpha） */
export function hexToRgba(hex: string, alpha: number): string {
  const raw = hex.replace("#", "");
  const full =
    raw.length === 3
      ? raw
          .split("")
          .map((c) => c + c)
          .join("")
      : raw;
  const n = parseInt(full, 16);
  if (Number.isNaN(n)) return `rgba(79,70,229,${alpha})`;
  const r = (n >> 16) & 255;
  const g = (n >> 8) & 255;
  const b = n & 255;
  return `rgba(${r},${g},${b},${alpha})`;
}
