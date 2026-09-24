/**
 * 将纯文本写入宿主剪贴板，并在宿主接口不可用时使用浏览器回退路径。
 * @param {string} text 需要原样写入剪贴板的文本。
 * @returns {Promise<boolean>} 宿主接受写入时返回 true，否则返回 false。
 */
export async function writeClipboard(text) {
  const content = String(text ?? '')
  try {
    // ZTools 插件优先使用宿主能力，避免受 WebContents 安全上下文限制。
    if (typeof window.ztools?.copyText === 'function') {
      await Promise.resolve(window.ztools.copyText(content))
      return true
    }
    if (typeof navigator.clipboard?.writeText === 'function') {
      await navigator.clipboard.writeText(content)
      return true
    }
  } catch {
    return false
  }

  if (typeof document.execCommand !== 'function') return false
  const textarea = document.createElement('textarea')
  textarea.value = content
  textarea.setAttribute('readonly', '')
  textarea.style.position = 'fixed'
  textarea.style.left = '-9999px'
  document.body.appendChild(textarea)
  textarea.select()
  try {
    // 旧版 WebContents 只提供同步复制命令，执行结果即为写入状态。
    return document.execCommand('copy')
  } catch {
    return false
  } finally {
    textarea.remove()
  }
}
