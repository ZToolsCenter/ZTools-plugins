/** 复制文本到剪贴板 */
export async function copyText(text: string): Promise<void> {
  const ztools = window.ztools
  if (ztools?.copyText) {
    ztools.copyText(text)
    return
  }
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text)
    return
  }
  throw new Error('Clipboard API not available')
}

/** 从剪贴板读取文本 */
export async function readClipboardText(): Promise<string> {
  const ztools = window.ztools
  // ZTools 剪贴板 API：取最新一条文本记录
  if (ztools?.clipboard?.getHistory) {
    try {
      const result = await ztools.clipboard.getHistory(1, 1, 'text')
      const records = result?.list || result?.data || result || []
      const first = Array.isArray(records) ? records[0] : null
      if (first?.content) return String(first.content)
    } catch {}
  }
  // 回退：浏览器 Clipboard API
  if (navigator.clipboard?.readText) {
    try { return await navigator.clipboard.readText() } catch {}
  }
  return ''
}

/** 浏览器降级：应用内 toast */
function showToast(message: string) {
  console.info('[PromptForge]', message)
  if (typeof document === 'undefined') return
  const el = document.createElement('div')
  el.textContent = message
  el.setAttribute('role', 'status')
  el.style.cssText = [
    'position:fixed', 'bottom:18px', 'right:18px', 'z-index:9999',
    'max-width:320px', 'padding:10px 16px', 'border-radius:8px',
    'background:rgba(30,30,46,0.92)', 'color:#fff', 'font-size:12.5px',
    'line-height:1.5', 'pointer-events:none', 'opacity:0',
    'transition:opacity 0.25s ease', 'box-shadow:0 4px 16px rgba(0,0,0,0.18)',
  ].join(';')
  document.body.appendChild(el)
  requestAnimationFrame(() => { el.style.opacity = '1' })
  setTimeout(() => {
    el.style.opacity = '0'
    setTimeout(() => el.remove(), 300)
  }, 2400)
}

/** 显示通知 */
export function showNotification(message: string) {
  const ztools = window.ztools
  if (ztools?.showNotification) {
    ztools.showNotification(message)
    return
  }
  showToast(message)
}

/** 延迟隐藏主窗口 */
export function hideMainWindow(delay = 200) {
  const ztools = window.ztools
  if (!ztools?.hideMainWindow) return
  setTimeout(() => {
    ztools.hideMainWindow()
  }, delay)
}

/** 退出插件 */
export async function outPlugin() {
  const ztools = window.ztools
  if (ztools?.outPlugin) {
    await ztools.outPlugin()
  }
}

/** 在资源管理器中显示文件 */
export function showInFolder(path: string) {
  const ztools = window.ztools
  if (ztools?.shellShowItemInFolder) {
    ztools.shellShowItemInFolder(path)
  }
}
