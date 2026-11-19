(() => {
  const $ = id => document.getElementById(id)
  const host = window.ztools
  const api = window.imagePreviewApi
  let target, url, cleanup
  function action(id, run) {
    $(id).onclick = async () => {
      try { $('image-message').textContent = await run() || '' }
      catch (error) { $('image-message').textContent = error.message }
    }
  }
  action('image-open', async () => {
    const result = await host.shellOpenPath(target)
    if (!result?.success) throw new Error(result?.error || '打开失败')
  })
  action('image-copy', () => {
    if (host.copyText(target) !== true) throw new Error('复制路径失败')
    return '已复制路径'
  })
  $('image-close').onclick = () => window.close()
  window.addEventListener('keydown', event => { if (event.key === 'Escape') window.close() })
  window.addEventListener('beforeunload', () => { cleanup?.(); if (url) URL.revokeObjectURL(url) })
  function theme(info) {
    document.documentElement.dataset.theme = info?.isDark ? 'dark' : 'light'
    document.documentElement.style.colorScheme = info?.isDark ? 'dark' : 'light'
  }
  theme(host?.getThemeInfo?.()); host?.onThemeChange?.(theme)
  void (async () => {
    try {
      target = decodeURIComponent(location.hash.slice(1))
      const name = api.name(target)
      $('image-title').textContent = name; document.title = name + ' · 图片预览'
      const file = await api.readImage(target)
      url = URL.createObjectURL(new Blob([file.bytes], { type: file.type }))
      const image = new Image(); image.alt = name; image.className = 'image-preview'; image.src = url
      try { await image.decode() } catch { throw new Error('无法预览此图片，格式可能不受支持或文件已损坏。') }
      const bytes = file.bytes.byteLength
      cleanup = window.mountImageViewer($('image-body'), image, bytes >= 1048576 ? (bytes / 1048576).toFixed(1) + ' MB' : (bytes / 1024).toFixed(1) + ' KB')
    } catch (error) { $('image-body').querySelector('p').textContent = error.message }
  })()
})()
