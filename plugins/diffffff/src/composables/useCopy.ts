/**
 * ============================================================================
 * 剪贴板复制 composable（INT-003：从 App.vue 的 UI-014 实现中抽取共享）
 * ============================================================================
 *
 * 复制文本到剪贴板的单出口：宿主 API 优先、浏览器 dev 降级。
 *
 * 路径与降级链（与抽取前行为逐字一致，UI-014 的复制原始 / 复制更改后与
 * UI-017 的「全部复制」共用）：
 * 1. `window.ztools.copyText(text)`（宿主 preload 注入，签名
 *    `copyText(text: string): boolean`，返回 false 视为失败）；
 * 2. `navigator.clipboard.writeText(text)`（浏览器 dev / preview 无 ztools
 *    全局时的降级；非安全上下文下 clipboard 为 undefined，writeText 访问即抛
 *    TypeError，同样汇入失败通道）。
 *
 * 任一路径成功即返回（不重复写剪贴板）；两条路径都失败时上抛最后一个错误，
 * 由调用方统一 toast error（App.vue 的 copyWithToast，沿用 useFileLoad 的
 * 错误文案惯例）。本文件不做任何 UI 反馈：纯逻辑 composable，零组件依赖。
 * ============================================================================
 */

/**
 * 复制文本到剪贴板：宿主 copyText 优先、浏览器剪贴板降级（单出口，见文件头）。
 *
 * @param text 待复制文本
 * @throws 两条路径都失败时上抛最后一个错误（调用方统一 toast error）
 */
async function copyTextViaHostOrClipboard(text: string): Promise<void> {
  try {
    if (typeof window.ztools !== 'undefined' && typeof window.ztools.copyText === 'function') {
      if (window.ztools.copyText(text)) return
    }
  } catch {
    // 宿主 API 抛错（含浏览器 dev 无 ztools 全局）→ 落到剪贴板降级路径
  }
  await navigator.clipboard.writeText(text)
}

/**
 * 剪贴板复制 composable：返回共享的 copyText 动作（useXxx 命名对齐项目
 * 其余 composables；当前实现无独立状态，后续如需「复制中 / 最近复制」等
 * 状态可在此扩展而不动调用方）。
 */
export function useCopy(): { copyText: (text: string) => Promise<void> } {
  return { copyText: copyTextViaHostOrClipboard }
}
