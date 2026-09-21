/**
 * 引擎下载地址：GitHub Release 走国内镜像，不需要用户凭证。
 */
export const ENGINE_MIRRORS = [
  'https://ghfast.top/',
  'https://ghproxy.net/',
  'https://mirror.ghproxy.com/',
  'https://gitclone.com/github.com/'
] as const

export function resolveEngineDownloadUrls(rawUrl: string): string[] {
  const url = String(rawUrl || '').trim()
  if (!url) return []
  let host = ''
  try {
    host = new URL(url).hostname
  } catch {
    return [url]
  }
  if (host !== 'github.com') return [url]
  const mirrored = ENGINE_MIRRORS.map((prefix) => {
    if (prefix.includes('gitclone.com/github.com/')) {
      return prefix + url.replace(/^https?:\/\/github\.com\//, '')
    }
    return prefix + url
  })
  return [...mirrored, url]
}

const BROWSER_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/127.0.0.0 Safari/537.36'

/** Range 续传请求头。existingBytes>0 时从断点接着下。 */
export function resumeDownloadHeaders(existingBytes: number): Record<string, string> {
  const headers: Record<string, string> = {
    'User-Agent': BROWSER_UA,
    Accept: '*/*'
  }
  const n = Math.max(0, Math.floor(Number(existingBytes) || 0))
  if (n > 0) headers.Range = 'bytes=' + n + '-'
  return headers
}

export function shouldResumePartial(statusCode: number, existingBytes: number): boolean {
  return existingBytes > 0 && statusCode === 206
}
