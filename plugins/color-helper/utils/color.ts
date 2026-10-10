import chroma from 'chroma-js';

/**
 * 颜色对比工具
 *
 * 只保留被使用的深浅判定与文字配色函数, 其余能力分别在:
 *
 * - 图片取色        -> pages/ImagePalettePage.tsx + utils/quantize.ts (Median Cut)
 * - 色卡保存        -> pages/ImagePalettePage.tsx handleExport + public/preload.cjs
 * - HSL/格式转换    -> pages/ColorPage.tsx
 * - 渐变 CSS        -> pages/GradientsPage.tsx
 */

/** WCAG 2.x 相对亮度 */
function relativeLuminance(color: string): number {
  return chroma(color).luminance();
}

/** WCAG 对比度公式 */
function contrastRatio(l1: number, l2: number): number {
  const hi = Math.max(l1, l2);
  const lo = Math.min(l1, l2);
  return (hi + 0.05) / (lo + 0.05);
}

/**
 * 判断颜色是否为深色 —— 即"该底色上应当使用白字"
 *
 * 采用 WCAG 对比度做判定(比较白/黑哪个对比度更高), 等价于亮度阈值
 * luminance < 0.1791。
 * 判定依据: 相对亮度 0 与 1 对黑/白的对比度相等 => L = sqrt(0.05*1.05)-0.05
 */
export function isDarkColor(hex: string): boolean {
  const l = relativeLuminance(hex);
  return contrastRatio(l, 1) >= contrastRatio(l, 0);
}

/**
 * 判断颜色是否为浅色(与 isDarkColor 严格互补)
 */
export function isLightColor(color: string): boolean {
  return !isDarkColor(color);
}

/**
 * 根据背景色返回对比度更高的文字颜色(黑/白)
 */
export function textColorFor(hex: string): string {
  return isDarkColor(hex) ? '#fff' : '#000';
}

/**
 * 生成半透明辅助色: 深色背景用白色、浅色背景用黑色
 */
export function dimColor(hex: string, alpha: number): string {
  return isDarkColor(hex)
    ? chroma('#fff').alpha(alpha).hex()
    : chroma('#000').alpha(alpha).hex();
}

/**
 * 获取对比色(用于文字) —— 与 textColorFor 同一判据
 */
export function getContrastColor(color: string): string {
  return isDarkColor(color) ? '#FFFFFF' : '#000000';
}
