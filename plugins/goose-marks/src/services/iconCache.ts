import type { IconSource, Bookmark } from '@/types/bookmark'

const isDataUrl = (value: string) => value.startsWith('data:image/')
const FAVICON_COOLDOWN_MS = 10 * 60 * 1000
const ICON_FETCH_TIMEOUT_MS = 4000
const MAX_ICON_BYTES = 2 * 1024 * 1024
const faviconOriginCooldowns = new Map<string, number>()

/** 浏览器 / uTools 有 window；Node/bun 自测无 window，禁止裸访问。 */
const getRuntimeWindow = (): (Window & typeof globalThis) | null =>
  typeof window !== 'undefined' ? window : null

const getNodeRequire = (): ((id: string) => any) | null => {
  const w = getRuntimeWindow() as (Window & { require?: (id: string) => any }) | null
  if (w && typeof w.require === 'function') return w.require.bind(w)
  return null
}

const isWindowsUToolsRuntime = () => {
  try {
    const w = getRuntimeWindow()
    if (typeof w?.utools?.isWindows === 'function') return w.utools.isWindows()
    if (typeof navigator !== 'undefined') return /Windows/i.test(navigator.userAgent)
    return false
  } catch {
    return false
  }
}

const getBackgroundFetchConcurrency = () => (isWindowsUToolsRuntime() ? 2 : 4)

const shouldCooldownStatus = (status: number) => status >= 400 && status < 500

const getUrlOrigin = (url: string): string | null => {
  try {
    return new URL(url).origin
  } catch {
    return null
  }
}

const isOriginInCooldown = (url: string): boolean => {
  const origin = getUrlOrigin(url)
  if (!origin) return false
  const until = faviconOriginCooldowns.get(origin)
  if (!until) return false
  if (until <= Date.now()) {
    faviconOriginCooldowns.delete(origin)
    return false
  }
  return true
}

const markOriginCooldown = (url: string) => {
  const origin = getUrlOrigin(url)
  if (!origin) return
  faviconOriginCooldowns.set(origin, Date.now() + FAVICON_COOLDOWN_MS)
}

const clearOriginCooldown = (url: string) => {
  const origin = getUrlOrigin(url)
  if (!origin) return
  faviconOriginCooldowns.delete(origin)
}

const blobToDataUrl = (blob: Blob): Promise<string | null> => new Promise((resolve) => {
  const reader = new FileReader()
  reader.onload = () => resolve(typeof reader.result === 'string' ? reader.result : null)
  reader.onerror = () => resolve(null)
  reader.readAsDataURL(blob)
})

const withTimeout = async <T>(promise: Promise<T>, timeoutMs = ICON_FETCH_TIMEOUT_MS): Promise<T | null> => {
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([
      promise,
      new Promise<null>((resolve) => {
        timer = setTimeout(() => resolve(null), timeoutMs)
      })
    ])
  } finally {
    if (timer) clearTimeout(timer)
  }
}

/** uTools 下优先 gooseWeb（代理感知）下图转 base64；失败再 require 直连。 */
const fetchImageViaRequire = (url: string, redirectDepth = 0): Promise<string | null> => {
  const req = getNodeRequire()
  if (typeof req !== 'function' || redirectDepth > 3) return Promise.resolve(null)
  return new Promise((resolve) => {
    let settled = false
    let request: any = null
    const deadline = setTimeout(() => {
      try { request?.destroy?.() } catch {}
      finish(null)
    }, ICON_FETCH_TIMEOUT_MS)
    const finish = (v: string | null) => {
      if (settled) return
      settled = true
      clearTimeout(deadline)
      resolve(v)
    }
    try {
      const lib = req(url.startsWith('https:') ? 'https' : 'http')
      const { Buffer } = req('buffer')
      request = lib.get(url, (res: any) => {
        const status = res.statusCode || 0
        const location = res.headers?.location
        // 跟随重定向（favicon 常有 301/302）
        if (status >= 300 && status < 400 && location) {
          res.resume()
          let next: string
          try { next = new URL(location, url).href } catch { finish(null); return }
          if (settled) return
          settled = true
          clearTimeout(deadline)
          resolve(fetchImageViaRequire(next, redirectDepth + 1))
          return
        }
        if (status !== 200) { res.resume(); finish(null); return }
        const contentType = String(res.headers?.['content-type'] || '')
        if (!contentType.startsWith('image/')) { res.resume(); finish(null); return }
        const contentLength = Number(res.headers?.['content-length'] || 0)
        if (Number.isFinite(contentLength) && contentLength > MAX_ICON_BYTES) {
          res.destroy()
          finish(null)
          return
        }
        const chunks: Uint8Array[] = []
        let receivedBytes = 0
        res.on('data', (c: Uint8Array) => {
          receivedBytes += c.byteLength
          if (receivedBytes > MAX_ICON_BYTES) {
            res.destroy()
            try { request.destroy() } catch {}
            finish(null)
            return
          }
          chunks.push(c)
        })
        res.on('end', () => finish(`data:${contentType.split(';')[0].trim()};base64,${Buffer.concat(chunks).toString('base64')}`))
        res.on('error', () => finish(null))
      })
      request.on('error', () => finish(null))
      request.setTimeout(ICON_FETCH_TIMEOUT_MS, () => { try { request.destroy() } catch {} finish(null) })
    } catch {
      finish(null)
    }
  })
}

/** favicon 等常返回空 content-type 或 application/octet-stream */
const isLikelyImagePath = (url: string) => {
  try {
    const path = new URL(url).pathname.toLowerCase()
    return /favicon/.test(path) || /\.(ico|png|svg|webp|gif|jpe?g)$/.test(path)
  } catch {
    return false
  }
}

const guessImageMimeFromUrl = (url: string) => {
  try {
    const path = new URL(url).pathname.toLowerCase()
    if (path.endsWith('.png')) return 'image/png'
    if (path.endsWith('.svg')) return 'image/svg+xml'
    if (path.endsWith('.webp')) return 'image/webp'
    if (path.endsWith('.gif')) return 'image/gif'
    if (path.endsWith('.jpg') || path.endsWith('.jpeg')) return 'image/jpeg'
    if (path.endsWith('.ico') || /favicon/.test(path)) return 'image/x-icon'
  } catch {}
  return 'image/x-icon'
}

const fetchImageViaNode = async (url: string): Promise<string | null> => {
  const w = getRuntimeWindow()
  if (w?.gooseWeb?.fetchBinary) {
    try {
      const result = await w.gooseWeb.fetchBinary(url, {
        timeoutMs: ICON_FETCH_TIMEOUT_MS,
        maxBytes: MAX_ICON_BYTES
      })
      if (result.ok && result.base64) {
        const rawType = String(result.contentType || '').split(';')[0].trim()
        if (rawType.startsWith('image/')) {
          return `data:${rawType};base64,${result.base64}`
        }
        // 空 type / octet-stream：按 URL 路径放行 favicon 与常见图片后缀
        if ((!rawType || rawType === 'application/octet-stream') && isLikelyImagePath(url)) {
          return `data:${guessImageMimeFromUrl(url)};base64,${result.base64}`
        }
      }
    } catch {
      // 失败回退 require
    }
  }
  return fetchImageViaRequire(url)
}

const MAX_HTML_BYTES = 512 * 1024

const decodeHtmlEntities = (text: string) =>
  text
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .trim()

const pickHtmlCharset = (contentType: string, headSample: string) => {
  const fromHeader = /charset=([\w-]+)/i.exec(contentType)?.[1]
  const fromMeta = /<meta[^>]+charset=["']?([\w-]+)/i.exec(headSample)?.[1]
  const label = (fromHeader || fromMeta || 'utf-8').toLowerCase()
  // 仅放行常见 legacy 编码（gbk/big5 等），其余一律按 utf-8 解码
  if (/^(gbk|gb2312|gb18030|big5|shift_jis|euc-jp|euc-kr|windows-125\d|iso-8859-\d+|latin1)$/.test(label)) return label
  return 'utf-8'
}

const extractMetaFromHtml = (html: string) => {
  const title = decodeHtmlEntities(/<title[^>]*>([\s\S]*?)<\/title>/i.exec(html)?.[1] || '')
  let description = ''
  const metaTags = html.match(/<meta\s[^>]*>/gi) || []
  for (const tag of metaTags) {
    if (!/(?:name|property)\s*=\s*["'](?:description|og:description|twitter:description)["']/i.test(tag)) continue
    const content = /content\s*=\s*"([^"]*)"/i.exec(tag)?.[1] ?? /content\s*=\s*'([^']*)'/i.exec(tag)?.[1] ?? ''
    const value = decodeHtmlEntities(content)
    if (value) {
      description = value
      break
    }
  }
  return { title: title || null, description: description || null }
}

/** 从 HTML 文本提取 meta。 */
const metaFromHtmlText = (html: string): { title: string | null; description: string | null } | null => {
  const meta = extractMetaFromHtml(html)
  return meta.title || meta.description ? meta : null
}

/** base64 → Uint8Array；优先 require('buffer')，否则 atob。 */
const base64ToUint8Array = (base64: string): Uint8Array => {
  const req = getNodeRequire()
  if (typeof req === 'function') {
    try {
      const { Buffer } = req('buffer')
      return new Uint8Array(Buffer.from(base64, 'base64'))
    } catch {
      // fall through
    }
  }
  const bin = atob(base64)
  const out = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
  return out
}

/** 按 content-type / meta charset 解码 HTML 字节（支持 GBK 等）。 */
const decodeHtmlBytes = (bytes: Uint8Array, contentType: string): string => {
  const sample = new TextDecoder('latin1').decode(bytes.slice(0, 4096))
  return new TextDecoder(pickHtmlCharset(contentType, sample)).decode(bytes)
}

/** Node 抓 HTML 提取 title/description：优先 gooseWeb（代理感知）。 */
const fetchPageMetaViaRequire = (
  url: string,
  redirectDepth = 0
): Promise<{ title: string | null; description: string | null } | null> => {
  const req = getNodeRequire()
  if (typeof req !== 'function' || redirectDepth > 3) return Promise.resolve(null)
  return new Promise((resolve) => {
    let settled = false
    let request: any = null
    const deadline = setTimeout(() => {
      try { request?.destroy?.() } catch {}
      finish(null)
    }, ICON_FETCH_TIMEOUT_MS)
    const finish = (v: { title: string | null; description: string | null } | null) => {
      if (settled) return
      settled = true
      clearTimeout(deadline)
      resolve(v)
    }
    try {
      const lib = req(url.startsWith('https:') ? 'https' : 'http')
      const { Buffer } = req('buffer')
      request = lib.get(
        url,
        {
          headers: {
            // 部分站点（豆瓣等）会拒绝无 UA 的 Node 请求
            'User-Agent':
              'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/108.0.0.0 Safari/537.36',
            Accept: 'text/html,application/xhtml+xml'
          }
        },
        (res: any) => {
          const status = res.statusCode || 0
          const location = res.headers?.location
          if (status >= 300 && status < 400 && location) {
            res.resume()
            let next: string
            try { next = new URL(location, url).href } catch { finish(null); return }
            if (settled) return
            settled = true
            clearTimeout(deadline)
            resolve(fetchPageMetaViaRequire(next, redirectDepth + 1))
            return
          }
          if (status !== 200) { res.resume(); finish(null); return }
          const contentType = String(res.headers?.['content-type'] || '')
          if (contentType && !/text\/html|application\/xhtml/i.test(contentType)) { res.resume(); finish(null); return }
          const chunks: Uint8Array[] = []
          let received = 0
          // title/description 都在 <head>，截断后直接解析已收到的部分即可
          const parseAndFinish = () => {
            try {
              const buf = Buffer.concat(chunks)
              const sample = new TextDecoder('latin1').decode(buf.slice(0, 4096))
              const html = new TextDecoder(pickHtmlCharset(contentType, sample)).decode(buf)
              finish(metaFromHtmlText(html))
            } catch {
              finish(null)
            }
          }
          res.on('data', (c: Uint8Array) => {
            if (received < MAX_HTML_BYTES) chunks.push(c)
            received += c.byteLength
            if (received > MAX_HTML_BYTES) {
              try { res.destroy() } catch {}
              parseAndFinish()
            }
          })
          res.on('end', parseAndFinish)
          res.on('error', () => finish(null))
        }
      )
      request.on('error', () => finish(null))
      request.setTimeout(ICON_FETCH_TIMEOUT_MS, () => { try { request.destroy() } catch {} finish(null) })
    } catch {
      finish(null)
    }
  })
}

const fetchPageMetaViaNode = async (
  url: string
): Promise<{ title: string | null; description: string | null } | null> => {
  const w = getRuntimeWindow()
  // 优先二进制：web-fetch 固定 utf-8 的 fetchText 会把 GBK 标题解成乱码
  if (w?.gooseWeb?.fetchBinary) {
    try {
      const result = await w.gooseWeb.fetchBinary(url, {
        timeoutMs: ICON_FETCH_TIMEOUT_MS,
        maxBytes: MAX_HTML_BYTES
      })
      if (result.ok && result.base64) {
        const bytes = base64ToUint8Array(result.base64)
        const html = decodeHtmlBytes(bytes, String(result.contentType || ''))
        return metaFromHtmlText(html)
      }
    } catch {
      // 失败再试 fetchText / require
    }
  }
  if (w?.gooseWeb?.fetchText) {
    try {
      const result = await w.gooseWeb.fetchText(url, {
        timeoutMs: ICON_FETCH_TIMEOUT_MS,
        maxBytes: MAX_HTML_BYTES
      })
      if (result.ok && result.text) return metaFromHtmlText(result.text)
    } catch {
      // 失败回退 require
    }
  }
  return fetchPageMetaViaRequire(url)
}

export const fetchAsDataUrl = async (url: string): Promise<string | null> => {
  if (!url) return null
  if (isOriginInCooldown(url)) return null

  const w = getRuntimeWindow() as (Window & { require?: unknown }) | null
  // 优先 gooseWeb / require 下载（无 CORS、代理感知）
  if (w?.gooseWeb?.fetchBinary || typeof w?.require === 'function') {
    const viaNode = await fetchImageViaNode(url)
    if (viaNode) clearOriginCooldown(url)
    return viaNode
  }

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), ICON_FETCH_TIMEOUT_MS)
  try {
    const response = await fetch(url, { signal: controller.signal })
    clearTimeout(timer)
    if (!response.ok) {
      if (shouldCooldownStatus(response.status)) {
        markOriginCooldown(url)
      }
      return null
    }
    const blob = await response.blob()
    if (!blob.type.startsWith('image/')) return null
    const dataUrl = await blobToDataUrl(blob)
    if (dataUrl) clearOriginCooldown(url)
    return dataUrl
  } catch {
    return null
  } finally {
    clearTimeout(timer)
  }
}

const isHtmlDocument = async (url: string): Promise<boolean> => {
  if (!url) return false
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 4000)
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: { Accept: 'text/html,application/xhtml+xml' }
    })
    if (!response.ok) return false
    const contentType = response.headers.get('content-type') || ''
    return contentType.includes('text/html') || contentType.includes('application/xhtml+xml')
  } catch {
    return false
  } finally {
    clearTimeout(timer)
  }
}

const buildTextIconValue = (text: string) => {
  const base = text.trim()
  return base ? base.slice(0, 4).toUpperCase() : '•'
}

const textIconFromBookmark = (bookmark: Bookmark): IconSource => {
  const base = bookmark.title.trim() || bookmark.url.trim()
  const text = buildTextIconValue(base)
  return { type: 'text', value: text }
}

export const iconToDisplayUrl = (icon?: IconSource) => {
  if (!icon) return null
  if (icon.type === 'file') return `file://${icon.path}`
  if (icon.type === 'remote') return icon.cache || icon.src
  if (icon.type === 'custom') return icon.data
  return null
}

type UToolsBrowserFetchResult = {
  icon: string | null
  cache: string | null
  title?: string | null
  description?: string | null
}

const hasFetchedPageData = (result: UToolsBrowserFetchResult | null | undefined) => {
  if (!result) return false
  return Boolean(result.icon || result.cache || result.title || result.description)
}

const fetchIconFromUToolsBrowser = async (url: string): Promise<UToolsBrowserFetchResult | null> => {
  if (isOriginInCooldown(url)) return null
  // ubrowser.run 没有可用的取消句柄，Promise.race 超时后底层任务仍会存活。
  // Windows 上连续残留隐藏 Chromium 任务会占满 GPU/句柄，因此禁用该不可取消路径。
  if (isWindowsUToolsRuntime()) return null
  const utoolsApi = getRuntimeWindow()?.utools as unknown as { ubrowser?: any; createBrowserWindow?: any } | undefined
  const ubrowser = utoolsApi?.ubrowser

  if (ubrowser?.goto) {
    try {
      const runner = ubrowser.goto(url)
      if (runner?.wait && runner?.evaluate && runner?.run) {
        const result = await withTimeout(runner.wait(1000).evaluate(() => {
          const readDescription = () => {
            const candidates = [
              "meta[name='description']",
              "meta[property='og:description']",
              "meta[name='twitter:description']"
            ]
            for (const selector of candidates) {
              const meta = document.querySelector(selector)
              const content = meta?.getAttribute('content')?.trim()
              if (content) return content
            }
            return null
          }

          // 多选择器匹配，优先级从高到低
          const selectors = [
            "link[rel='icon']",
            "link[rel='shortcut icon']",
            "link[rel='apple-touch-icon']",
            "link[rel='fluid-icon']",
            "link[href*='favicon']",
            "link[href*='icon']"
          ]
          let href: string | null = null
          for (const sel of selectors) {
            const link = document.querySelector(sel) as HTMLLinkElement | null
            if (link?.href) {
              href = link.href
              break
            }
          }
          return {
            href: href || `${location.origin}/favicon.ico`,
            title: document.title?.trim() || null,
            description: readDescription()
          }
        }).run({ width: 800, height: 600, show: false }))
        if (!result) return null
        const payload = Array.isArray(result) ? (result[0] as { href?: string; title?: string | null; description?: string | null }) : undefined
        const href = payload?.href || null
        const cache = href ? await fetchAsDataUrl(href) : null
        const fetched = {
          icon: href,
          cache,
          title: payload?.title || null,
          description: payload?.description || null
        }
        if (hasFetchedPageData(fetched)) return fetched
      }
    } catch {}
  }

  const canOpenHtml = await isHtmlDocument(url)
  if (!canOpenHtml) return null

  let browserWindow: { close?: () => void; destroy?: () => void; webContents?: { executeJavaScript?: (code: string) => Promise<unknown> } } | undefined
  try {
    browserWindow = utoolsApi?.createBrowserWindow?.(url, { show: false })
    const exec = browserWindow?.webContents?.executeJavaScript
    if (exec) {
      const payload = await withTimeout(exec(`
        (async () => {
          const readDescription = () => {
            const candidates = [
              "meta[name='description']",
              "meta[property='og:description']",
              "meta[name='twitter:description']"
            ]
            for (const selector of candidates) {
              const meta = document.querySelector(selector)
              const content = meta?.getAttribute('content')?.trim()
              if (content) return content
            }
            return null
          }

          const selectors = [
            "link[rel='icon']",
            "link[rel='shortcut icon']",
            "link[rel='apple-touch-icon']",
            "link[rel='fluid-icon']",
            "link[href*='favicon']",
            "link[href*='icon']"
          ]
          let href = null
          for (const sel of selectors) {
            const link = document.querySelector(sel)
            if (link?.href) {
              href = link.href
              break
            }
          }
          if (!href) href = location.origin + "/favicon.ico"
          try {
            const res = await fetch(href)
            if (!res.ok) return { href, status: res.status, dataUrl: "", title: document.title?.trim() || null, description: readDescription() }
            const blob = await res.blob()
            if (!blob.type.startsWith("image/")) return { href, status: 415, dataUrl: "", title: document.title?.trim() || null, description: readDescription() }
            const reader = new FileReader()
            const dataUrl = await new Promise(resolve => {
              reader.onload = () => resolve(reader.result || "")
              reader.onerror = () => resolve("")
              reader.readAsDataURL(blob)
            })
            return { href, status: res.status, dataUrl, title: document.title?.trim() || null, description: readDescription() }
          } catch {
            return { href, status: 0, dataUrl: "", title: document.title?.trim() || null, description: readDescription() }
          }
        })()
      `))
      if (!payload) return null
      const href = (payload as { href?: string })?.href
      const status = (payload as { status?: number })?.status
      const dataUrl = (payload as { dataUrl?: string })?.dataUrl
      const title = (payload as { title?: string | null })?.title || null
      const description = (payload as { description?: string | null })?.description || null
      if (href && typeof status === 'number' && shouldCooldownStatus(status)) {
        markOriginCooldown(href)
      }
      if (typeof href === 'string' && typeof dataUrl === 'string' && dataUrl.startsWith('data:image/')) {
        clearOriginCooldown(href)
        return { icon: href, cache: dataUrl, title, description }
      }
      const fetched = {
        icon: typeof href === 'string' ? href : null,
        cache: typeof dataUrl === 'string' && dataUrl ? dataUrl : null,
        title,
        description
      }
      if (hasFetchedPageData(fetched)) return fetched
    }
  } catch {}
  finally {
    try {
      browserWindow?.close?.()
    } catch {}
    try {
      browserWindow?.destroy?.()
    } catch {}
  }

  return null
}

/** 获取页面元信息（标题、描述），用于快速保存等场景 */
export const fetchPageMeta = async (url: string): Promise<{ title: string | null; description: string | null }> => {
  if (!url) return { title: null, description: null }

  let targetUrl = url
  if (!/^https?:\/\//i.test(targetUrl)) {
    targetUrl = 'https://' + targetUrl
  }

  try {
    new URL(targetUrl)
  } catch {
    return { title: null, description: null }
  }

  if (typeof window !== 'undefined' && window.utools) {
    const utoolsResult = await fetchIconFromUToolsBrowser(targetUrl)
    if (utoolsResult?.title || utoolsResult?.description) {
      return {
        title: utoolsResult.title || null,
        description: utoolsResult.description || null
      }
    }
  }

  const nodeMeta = await fetchPageMetaViaNode(targetUrl)
  return {
    title: nodeMeta?.title || null,
    description: nodeMeta?.description || null
  }
}

type FetchIconOptions = {
  allowBrowserAutomation?: boolean
}

export const fetchAndCacheIcon = async (
  url: string,
  _force = false,
  options: FetchIconOptions = {}
): Promise<(IconSource & { title?: string | null; description?: string | null }) | null> => {
  if (!url) return null

  let targetUrl = url
  const hasTemplate = /{[^}]+}/.test(url)

  if (hasTemplate) {
    try {
      const temp = url.replace(/{[^}]+}/g, 'x')
      const u = new URL(/^https?:\/\//i.test(temp) ? temp : 'https://' + temp)
      targetUrl = u.origin
    } catch {
      targetUrl = url.replace(/{[^}]+}/g, '')
    }
  }

  if (!/^https?:\/\//i.test(targetUrl)) {
    targetUrl = 'https://' + targetUrl
  }

  try {
    new URL(targetUrl)
  } catch {
    return null
  }

  let fetchedMeta: { title?: string | null; description?: string | null } = {}
  const avoidBrowserAutomation = options.allowBrowserAutomation === false || isWindowsUToolsRuntime()

  // Node 直抓 HTML 的懒加载兜底：仅在 ubrowser 没拿到标题/描述（或被禁用）时触发一次
  let nodeMetaPromise: Promise<{ title: string | null; description: string | null } | null> | null = null
  const fillMetaViaNode = async () => {
    if (fetchedMeta.title && fetchedMeta.description) return
    if (!nodeMetaPromise) nodeMetaPromise = fetchPageMetaViaNode(targetUrl)
    const nodeMeta = await nodeMetaPromise
    if (!nodeMeta) return
    if (!fetchedMeta.title && nodeMeta.title) fetchedMeta.title = nodeMeta.title
    if (!fetchedMeta.description && nodeMeta.description) fetchedMeta.description = nodeMeta.description
  }

  if (avoidBrowserAutomation) {
    try {
      const faviconUrl = new URL('/favicon.ico', targetUrl).href
      // Windows 禁用 ubrowser：favicon 与标题/描述并行直抓（Node 无 CORS）
      const [cache] = await Promise.all([fetchAsDataUrl(faviconUrl), fillMetaViaNode()])
      if (cache) {
        return { type: 'remote', src: faviconUrl, cache, fetchedAt: Date.now(), ...fetchedMeta }
      }
    } catch {}
  }

  // uTools 环境优先用内置浏览器获取图标
  if (typeof window !== 'undefined' && window.utools && !avoidBrowserAutomation) {
    const utoolsResult = await withTimeout(fetchIconFromUToolsBrowser(targetUrl), 4000)
    if (utoolsResult) {
      fetchedMeta = {
        title: utoolsResult.title || null,
        description: utoolsResult.description || null
      }
      if (import.meta.env.DEV) {
        console.log('✅ [AG-Verify] uTools Icon Base64:', utoolsResult.cache?.substring(0, 50) || 'none', 'Len:', utoolsResult.cache?.length || 0)
      }
      if (utoolsResult.icon && utoolsResult.cache) {
        return {
          type: 'remote',
          src: utoolsResult.icon,
          cache: utoolsResult.cache,
          fetchedAt: Date.now(),
          ...fetchedMeta
        }
      }
    }
  }

  // ubrowser 没拿到标题/描述时，用 Node 直抓 HTML 兜底一次
  await fillMetaViaNode()

  // 各路径都失败时再试 origin/favicon.ico（uTools 无 ubrowser 结果、Web 预览、Node 自测通用）
  try {
    const faviconUrl = new URL('/favicon.ico', targetUrl).href
    const cache = await fetchAsDataUrl(faviconUrl)
    if (cache) {
      return { type: 'remote', src: faviconUrl, cache, fetchedAt: Date.now(), ...fetchedMeta }
    }
  } catch {}

  if (fetchedMeta.title || fetchedMeta.description) {
    const fallbackText = fetchedMeta.title || (() => {
      try {
        return new URL(targetUrl).hostname.replace(/^www\./i, '')
      } catch {
        return targetUrl
      }
    })()
    return {
      type: 'text',
      value: buildTextIconValue(fallbackText),
      ...fetchedMeta
    }
  }

  // 元信息也没有：至少用主机名文字占位，避免上层拿 null
  try {
    const host = new URL(targetUrl).hostname.replace(/^www\./i, '')
    return { type: 'text', value: buildTextIconValue(host) }
  } catch {
    return null
  }
}

export const ensureIconForBookmark = async (bookmark: Bookmark, force = false): Promise<IconSource | undefined> => {
  if (bookmark.icon && bookmark.icon.type !== 'text' && !force) {
    return bookmark.icon
  }
  
  const fetched = await fetchAndCacheIcon(bookmark.url, force)
  if (fetched) return fetched
  
  return textIconFromBookmark(bookmark)
}

export const bulkMatchMissing = async (bookmarks: Bookmark[]): Promise<Map<string, IconSource>> => {
  const result = new Map<string, IconSource>()
  const missing = bookmarks.filter((b) => !b.icon || b.icon.type === 'text')
  const concurrency = getBackgroundFetchConcurrency()

  // 并发限制池：每次最多 CONCURRENCY 个并发 fetch
  let index = 0
  const worker = async () => {
    while (index < missing.length) {
      const bookmark = missing[index++]
      const icon = await fetchAndCacheIcon(bookmark.url, false, { allowBrowserAutomation: false })
      if (icon) {
        result.set(bookmark.id, icon)
      }
    }
  }

  const workers = Array.from({ length: Math.min(concurrency, missing.length) }, () => worker())
  await Promise.all(workers)

  return result
}

/**
 * 把"已有远程 URL、但还没缓存 base64"的图标抓成本地 base64。
 * 用于一次性回填存量书签与 web 兜底失败的图标，实现"成功一次永久本地化、之后不再联网"。
 * 返回 id -> base64 dataUrl 的映射，由调用方写回 store。
 */
export const backfillRemoteIconCache = async (bookmarks: Bookmark[]): Promise<Map<string, string>> => {
  const result = new Map<string, string>()
  const targets = bookmarks.filter((b) => {
    const icon = b.icon
    return icon?.type === 'remote' && !!icon.src && !(icon.cache && icon.cache.startsWith('data:image/'))
  })
  if (targets.length === 0) return result

  const concurrency = getBackgroundFetchConcurrency()
  let index = 0
  const worker = async () => {
    while (index < targets.length) {
      const bookmark = targets[index++]
      const icon = bookmark.icon as Extract<IconSource, { type: 'remote' }>
      const dataUrl = await fetchAsDataUrl(icon.src)
      if (dataUrl) result.set(bookmark.id, dataUrl)
    }
  }

  const workers = Array.from({ length: Math.min(concurrency, targets.length) }, () => worker())
  await Promise.all(workers)

  return result
}
