require('./services')

const { ipcRenderer } = require('electron')
const { SLUG, httpsUrl } = require('./catalog')
let latest
let listener

/**
 * 校验封面地址。只用于 <img> 缩略图，必须是 https；
 * 本机回环地址额外放行，供开发预览和端到端测试使用。
 * @param value 页面提供的封面地址。
 * @returns 可用的地址，否则为 null。
 */
function coverUrl(value) {
  if (httpsUrl(value)) return value.slice(0, 8192)
  if (typeof value !== 'string' || value.length > 8192) return null
  try {
    const url = new URL(value)
    const loopback = ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)
    return url.protocol === 'http:' && loopback && !url.username && !url.password ? value : null
  } catch {
    return null
  }
}

ipcRenderer.on('ztools-video:playback', (_event, value) => {
  const title = typeof value?.title === 'string' ? value.title.trim().slice(0, 160) : ''
  const cover = coverUrl(value?.cover)
  if (value?.kind === 'catalog' && typeof value.v === 'string' && SLUG.test(value.v)) {
    latest = { kind: 'catalog', v: value.v, title, cover }
  } else if (value?.kind === 'direct') {
    const url = httpsUrl(value.source?.url)
    const type = url?.pathname.match(/\.(mp4|m3u8)$/i)?.[1]?.toLowerCase()
    if (!type) return
    latest = { kind: 'direct', title, source: { url: value.source.url, format: type === 'mp4' ? 'mp4' : 'hls', quality: '' } }
  } else return
  listener?.(latest)
})
window.videoPlayback = Object.freeze({
  subscribe(callback) {
    if (typeof callback !== 'function') throw new TypeError('Expected a playback listener')
    listener = callback
    if (latest) listener(latest)
    return () => { if (listener === callback) listener = undefined }
  },
  /**
   * 通知主窗口播放记录已更新，让它刷新首页列表。
   */
  notifyHistoryChanged() {
    try {
      ztools.sendToParent('ztools-video:history-changed')
    } catch {
      // 不在独立窗口中运行时没有父窗口，忽略即可。
    }
  },
})
