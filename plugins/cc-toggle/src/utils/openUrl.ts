/**
 * 在 ZTools 插件中打开外部链接
 * 优先使用 ZTools API，降级到 window.open
 * @param {string} url
 */
export function openUrl(url: string): void {
  try {
    window.ztools?.shellOpenExternal?.(url);
  } catch (e) {
    window.open(url, '_blank');
  }
}
