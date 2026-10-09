import type { ClipboardRecord } from '../types'

/**
 * 图片显示源解析。
 *
 * 宿主可能给四种形态：
 *   1. data:image/... 的 data URL        → 直接用
 *   2. 裸 base64（无 data: 前缀）         → api.ts 已补前缀
 *   3. 本地磁盘路径                        → 调 preload 读成 data URL（file:// 会被页面安全策略拦）
 *   4. http(s) 网络图片                   → 直接用
 *
 * 本地路径走 preload 是同步读取，因此这里做结果缓存：同一个路径只读一次。
 */
const cache = new Map<string, string>()

export function resolveImageSrc(content: string): string {
  if (!content) return ''
  if (/^(data:|https?:|file:)/i.test(content)) return content

  // 不是路径形态（如"过大未保存"的兜底文案）：不尝试读盘，直接视为无图
  if (!/^(?:[a-z]:[\\/]|[\\/]|\.{1,2}[\\/])/i.test(content)) return ''

  const hit = cache.get(content)
  if (hit !== undefined) return hit

  let src = ''
  try {
    const svc = (window as unknown as { services?: { readImageDataUrl?: (p: string) => string | null } }).services
    if (svc?.readImageDataUrl) {
      src = svc.readImageDataUrl(content) || ''
    }
  } catch {
    src = ''
  }

  if (!src) {
    // 拿不到（浏览器直连开发模式）：退回 file://，加载失败会显示占位图
    const norm = content.replace(/\\/g, '/')
    src = 'file://' + (norm.startsWith('/') ? '' : '/') + encodeURI(norm)
  }

  cache.set(content, src)
  return src
}

export function isImageRecord(r: ClipboardRecord): boolean {
  return r.kind === 'image'
}
