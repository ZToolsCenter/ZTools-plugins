let seq = 0

/** 复制文本：优先 ztools API，降级到 clipboard API / execCommand，成功后弹出提示 */
export async function copyText(text: string, tip = '复制成功') {
  let ok = false
  const zt = (window as any).ztools
  if (zt?.copyText) {
    try {
      zt.copyText(text)
      ok = true
    } catch {
      /* 继续尝试其它方式 */
    }
  }
  if (!ok) {
    try {
      await navigator.clipboard.writeText(text)
      ok = true
    } catch {
      /* 继续尝试其它方式 */
    }
  }
  if (!ok) {
    const ta = document.createElement('textarea')
    ta.value = text
    ta.style.position = 'fixed'
    ta.style.opacity = '0'
    document.body.appendChild(ta)
    ta.select()
    ok = document.execCommand('copy')
    ta.remove()
  }
  showSuccessToast(ok ? tip : '复制失败')
}

/** Element UI 风格的成功提示（顶部居中，自动消失），对齐原插件的复制成功弹窗 */
export function showSuccessToast(text = '复制成功') {
  const div = document.createElement('div')
  div.className = 'copy-message'
  div.style.zIndex = String(2000 + seq++)
  div.innerHTML =
    '<svg class="copy-message-icon" viewBox="0 0 16 16" width="16" height="16" fill="currentColor">' +
    '<path d="M16 8A8 8 0 1 1 0 8a8 8 0 0 1 16 0zm-3.97-3.03a.75.75 0 0 0-1.08.022L7.477 9.417 5.384 7.323a.75.75 0 0 0-1.06 1.06L6.97 11.03a.75.75 0 0 0 1.079-.02l3.992-4.99a.75.75 0 0 0-.01-1.05z"/>' +
    '</svg><p class="copy-message-content"></p>'
  ;(div.querySelector('.copy-message-content') as HTMLElement).textContent = text
  document.body.appendChild(div)
  requestAnimationFrame(() => div.classList.add('show'))
  setTimeout(() => {
    div.classList.remove('show')
    setTimeout(() => div.remove(), 300)
  }, 2000)
}
