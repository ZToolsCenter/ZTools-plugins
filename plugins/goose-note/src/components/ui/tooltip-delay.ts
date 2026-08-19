/** 应用内 Radix/shadcn Tooltip 的全局默认悬停延迟。 */
export const TOOLTIP_DELAY_MS = 400;

/**
 * 统一 delayDuration：0（瞬间）和历史 600 特例收到默认；
 * 其余有意覆盖（如工具栏 300、关标签 2000）原样保留。
 */
export function resolveTooltipDelayDuration(delayDuration: number): number {
  if (delayDuration === 0 || delayDuration === 600) return TOOLTIP_DELAY_MS;
  return delayDuration;
}
