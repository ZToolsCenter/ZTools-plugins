/**
 * 本地文件状态查询（走 preload，渲染进程没有 fs）。
 *
 * 只用于「这个文件还在不在」这类轻量判断：剪贴板里的文件记录可能已经被
 * 移动或删除，界面上要给出提示，而不是点了定位之后毫无反应。
 *
 * 浏览器直连开发模式没有 preload，此时返回 null（状态未知）；
 * 调用方对 null 的处理必须与 true 一致（正常显示，不报"已失效"），
 * 否则开发环境下会看到满屏假警告。
 */

const cache = new Map<string, boolean>()

/** true = 存在；false = 已不存在；null = 无法判断（没有 preload） */
export function fileExists(p: string): boolean | null {
  if (!p) return null
  const hit = cache.get(p)
  if (hit !== undefined) return hit

  try {
    const svc = (window as unknown as { services?: { fileExists?: (f: string) => boolean } }).services
    if (!svc?.fileExists) return null
    const v = svc.fileExists(p)
    cache.set(p, v)
    return v
  } catch {
    return null
  }
}

/** 记录被删除后清掉缓存，避免同一路径一直显示旧状态 */
export function forgetFile(p: string): void {
  cache.delete(p)
}
