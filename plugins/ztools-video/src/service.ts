import type { VideoService } from './types'

const active = new Set<AbortController>()
async function preview<T>(operation: string, value: string): Promise<T> {
  const controller = new AbortController()
  active.add(controller)
  try {
    const response = await fetch('/__video/' + operation, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ value }),
      signal: controller.signal,
    })
    const body = await response.json()
    if (!response.ok) throw new Error(body.error || '预览服务无法获取数据。')
    return body as T
  } finally {
    active.delete(controller)
  }
}

const unavailable = async () => { throw new Error('未连接 ZTools。请在 ZTools 里打开插件，或启动开发预览。') }
export const service: VideoService = window.videoService ?? (import.meta.env.DEV ? {
  channel: value => preview('channel', value),
  search: value => preview('search', value),
  catalog: value => preview('catalog', value),
  resolve: value => preview('resolve', value),
  cancel() { for (const controller of active) controller.abort() },
} : { channel: unavailable, search: unavailable, catalog: unavailable, resolve: unavailable, cancel() {} })

export function readInput(input: string): { v: string } | { source: import('./types').Source; title: string } | null {
  if (/^(?:ch|cg)[a-z0-9]{6,20}$/i.test(input) && /\d/.test(input)) return { v: input }
  if (!/^https?:\/\//i.test(input)) return null
  let url: URL
  try { url = new URL(input) } catch { throw new Error('视频链接格式不正确。') }
  if (url.protocol !== 'https:' || url.username || url.password) throw new Error('请输入有效的 HTTPS 视频链接。')
  if (['www.4kvm.tv', '4kvm.tv'].includes(url.hostname) && !url.port) {
    const v = url.pathname.match(/^\/play\/([a-zA-Z0-9_-]{1,64})\/?$/)?.[1]
    if (v) return { v }
  }
  const type = url.pathname.match(/\.(m3u8|mp4)$/i)?.[1]?.toLowerCase()
  if (!type) throw new Error('支持 4K 影视播放页、MP4 和 .m3u8 链接。')
  return { source: { url: input, format: type === 'm3u8' ? 'hls' : 'mp4', quality: '' }, title: '播放链接' }
}
