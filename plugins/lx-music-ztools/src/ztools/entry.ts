import './contracts'
import './shell.css'
document.documentElement.classList.add('lx-ztools-shell')
void Promise.resolve().then(async () => {
  if (!window.lxHost) throw new Error((window as any).lxBootstrapError || '插件预加载未成功，请检查 ZTools 是否支持 Node.js SQLite')
  await window.lxHost.invoke('runtime:ready')
  ;(window as any).shouldUseDarkColors = window.ztools.isDarkColors()
  document.documentElement.classList.remove('transparent')
  document.documentElement.classList.add('disableTransparent')
  // LX's lazily loaded styles define fallback :root colors in <head>.
  // Keep its active theme after those styles in document order.
  if (!(window as any).dom_style.isConnected) document.body.appendChild((window as any).dom_style)
  await import('../../vendor/lx/src/renderer/main')
  await import('./theme.js')
  await import('./player.js')
  await import('./download.js')
  await import('./catalog.js')
  await import('./commands.js')
}).catch(error => {
  console.error('LX Music initialization failed', error)
  document.body.replaceChildren()
  const message = document.createElement('p')
  message.style.cssText = 'padding:24px;white-space:pre-wrap;font-family:system-ui'
  message.textContent = `LX Music 启动失败：${error.message || error}\n请检查插件文件完整性及 ZTools 版本后重新进入插件。`
  document.body.append(message)
})
