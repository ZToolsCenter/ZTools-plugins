/**
 * ZTools preload：本插件仅使用 window.ztools 原生 API，无需额外垫层。
 * 预留 Node 能力入口（如后续需要 fs 等）。
 */
;(function () {
  if (typeof window === 'undefined') return

  window.addEventListener('DOMContentLoaded', () => {
    if (window.ztools && typeof window.ztools.isDev === 'function' && window.ztools.isDev()) {
      console.log('[task-plugin] preload ready')
    }
  })
})()
