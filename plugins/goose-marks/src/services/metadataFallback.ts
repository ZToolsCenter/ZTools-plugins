import { registeredDomainOf } from '@/lib/siteColor'

type SearchFallbackProvider = 'jina' | 'domain_search'

type SearchFallbackResult = {
  title: string | null
  description: string | null
  provider: SearchFallbackProvider
}

type NodeModuleLike = {
  request?: (...args: any[]) => any
  get?: (...args: any[]) => any
}

const getNodeModule = (name: string): NodeModuleLike | null => {
  if (typeof window !== 'undefined' && window.require) {
    try {
      return window.require(name)
    } catch {
      return null
    }
  }
  return null
}

const requestTextViaFetch = async (url: string, timeoutMs: number, headers?: Record<string, string>) => {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        'User-Agent': 'Mozilla/5.0',
        'Accept': 'text/html,application/xhtml+xml',
        ...headers
      }
    })
    if (!response.ok) return null
    return await response.text()
  } catch {
    return null
  } finally {
    clearTimeout(timer)
  }
}

/** 优先 gooseWeb（代理感知），失败再 require 直连。 */
const requestTextViaNode = async (
  url: string,
  timeoutMs: number,
  headers?: Record<string, string>
): Promise<string | null> => {
  if (typeof window !== 'undefined' && window.gooseWeb?.fetchText) {
    try {
      const result = await window.gooseWeb.fetchText(url, { timeoutMs })
      if (result.ok && typeof result.text === 'string') return result.text
    } catch {
      // 回退 require
    }
  }

  return new Promise((resolve) => {
    const https = getNodeModule('https')
    const http = getNodeModule('http')
    try {
      const target = new URL(url)
      const mod = target.protocol === 'http:' ? http : https
      if (!mod?.request) {
        resolve(null)
        return
      }

      const req = mod.request(url, {
        method: 'GET',
        timeout: timeoutMs,
        headers: {
          'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
          'Accept': 'text/html,application/xhtml+xml',
          ...headers
        }
      }, (res: any) => {
        if ((res.statusCode || 0) >= 400) {
          resolve(null)
          req.destroy()
          return
        }
        const bufferModule = getNodeModule('buffer') as { Buffer?: { concat: (items: any[]) => { toString: (encoding: string) => string } } } | null
        const chunks: any[] = []
        res.on('data', (chunk: any) => chunks.push(chunk))
        res.on('end', () => {
          if (!bufferModule?.Buffer) {
            resolve(null)
            return
          }
          resolve(bufferModule.Buffer.concat(chunks).toString('utf8'))
        })
      })

      req.on('error', () => resolve(null))
      req.on('timeout', () => {
        req.destroy()
        resolve(null)
      })
      req.end()
    } catch {
      resolve(null)
    }
  })
}

const requestText = async (url: string, timeoutMs = 8000, headers?: Record<string, string>) => {
  const nodeResult = await requestTextViaNode(url, timeoutMs, headers)
  if (nodeResult) return nodeResult
  return requestTextViaFetch(url, timeoutMs, headers)
}

/**
 * 登录墙 / 访问受限 / 人机验证等弱文案：不能当作书签标题或简介来源。
 * 供表单抓取、AI 保存与联网兜底共用。
 */
export function isLoginOrAccessWallText(text: string | null | undefined): boolean {
  const raw = (text || '').trim()
  if (!raw) return true
  const t = raw.toLowerCase()
  // 过短且仅为通用导航词
  if (/^(home|首页|主页|index|welcome|欢迎)$/i.test(raw)) return true
  const patterns = [
    /\bsign[\s-]?in\b/i,
    /\blog[\s-]?in\b/i,
    /\bsign[\s-]?up\b/i,
    /\blog[\s-]?on\b/i,
    /请.?登录/,
    /需要登录/,
    /先登录/,
    /登录后/,
    /立即登录/,
    /注册登录/,
    /登录以继续/,
    /登录你的/,
    /登录您的/,
    /账号登录/,
    /帐户登录/,
    /验证你是真人/,
    /人机验证/,
    /access denied/i,
    /permission denied/i,
    /unauthorized/i,
    /403 forbidden/i,
    /just a moment/i,
    /attention required/i,
    /checking your browser/i,
    /enable javascript/i,
    /cloudflare/i,
    /captcha/i,
    /verify you are human/i,
    /bot detection/i
  ]
  return patterns.some((re) => re.test(t) || re.test(raw))
}

const hostnameOf = (url: string): string | null => {
  try {
    const normalized = /^https?:\/\//i.test(url) ? url : `https://${url}`
    return new URL(normalized).hostname.replace(/^www\./i, '')
  } catch {
    return null
  }
}

const brandTitleFromHost = (host: string): string => {
  const reg = registeredDomainOf(host)
  const label = (reg.split('.')[0] || host).trim()
  if (!label) return host
  return label.charAt(0).toUpperCase() + label.slice(1)
}

const clipDescription = (text: string, max = 280): string => {
  const compact = text.replace(/\s+/g, ' ').trim()
  if (compact.length <= max) return compact
  const slice = compact.slice(0, max)
  const cut = slice.lastIndexOf(' ')
  return (cut > 80 ? slice.slice(0, cut) : slice).trim() + '…'
}

// Jina Reader 双域名容灾：主域名 r.jina.ai 在国内存在 DNS 污染，备用域名 r.jinaai.cn 国内可用。
// 按顺序尝试，首个成功的域名会被记住（内存 + localStorage），后续请求优先直连。
const JINA_READER_HOSTS = ['https://r.jina.ai', 'https://r.jinaai.cn']
const JINA_HOST_STORAGE_KEY = 'gm-jina-reader-host'
let cachedJinaHost: string | null = null

const readPreferredJinaHost = (): string | null => {
  if (cachedJinaHost) return cachedJinaHost
  try {
    const saved = typeof window !== 'undefined' ? window.localStorage?.getItem(JINA_HOST_STORAGE_KEY) : null
    if (saved && JINA_READER_HOSTS.includes(saved)) cachedJinaHost = saved
  } catch {}
  return cachedJinaHost
}

const rememberJinaHost = (host: string) => {
  cachedJinaHost = host
  try {
    window.localStorage?.setItem(JINA_HOST_STORAGE_KEY, host)
  } catch {}
}

const fetchMetadataViaJina = async (url: string, timeoutMs = 10000): Promise<SearchFallbackResult | null> => {
  const normalized = /^https?:\/\//i.test(url) ? url : `https://${url}`
  const preferred = readPreferredJinaHost()
  const hosts = preferred ? [preferred, ...JINA_READER_HOSTS.filter((h) => h !== preferred)] : JINA_READER_HOSTS
  const perHostTimeout = Math.max(2000, Math.floor(timeoutMs / hosts.length))

  for (const host of hosts) {
    try {
      const text = await requestText(`${host}/${normalized}`, perHostTimeout, { Accept: 'application/json' })
      if (!text) continue
      const payload = JSON.parse(text)
      const title = (payload?.data?.title ?? payload?.title ?? '').trim()
      const description = (payload?.data?.description ?? payload?.description ?? '').trim()
      if (!title) continue
      rememberJinaHost(host)
      return { title, description: description || null, provider: 'jina' }
    } catch {
      continue
    }
  }
  return null
}

type DdgPayload = {
  Heading?: string
  AbstractText?: string
  Abstract?: string
  RelatedTopics?: Array<{ Text?: string; FirstURL?: string } | { Topics?: Array<{ Text?: string }> }>
}

const parseDdgAbstract = (payload: DdgPayload): { title: string | null; abstract: string | null } => {
  let abstract = (payload.AbstractText || payload.Abstract || '').trim()
  if (!abstract && Array.isArray(payload.RelatedTopics)) {
    for (const topic of payload.RelatedTopics) {
      if (topic && 'Text' in topic && typeof topic.Text === 'string' && topic.Text.trim()) {
        abstract = topic.Text.trim()
        break
      }
      if (topic && 'Topics' in topic && Array.isArray(topic.Topics)) {
        const nested = topic.Topics.find((t) => typeof t?.Text === 'string' && t.Text.trim())
        if (nested?.Text) {
          abstract = nested.Text.trim()
          break
        }
      }
    }
  }
  if (!abstract || isLoginOrAccessWallText(abstract)) {
    return { title: null, abstract: null }
  }
  const heading = (payload.Heading || '').trim()
  return {
    title: heading && !isLoginOrAccessWallText(heading) ? heading : null,
    abstract
  }
}

/** DDG Instant Answer：多查询（域名 / 品牌）；浏览器侧部分 IP 对纯域名查询常返回空。 */
const fetchViaDuckDuckGo = async (
  host: string,
  timeoutMs: number
): Promise<SearchFallbackResult | null> => {
  const brand = brandTitleFromHost(host)
  const reg = registeredDomainOf(host)
  const queries = Array.from(
    new Set([reg, brand, `${brand} AI`, `${brand} software`, `${brand} Anthropic`].filter(Boolean))
  )
  const perQuery = Math.max(1200, Math.floor(timeoutMs / Math.max(1, queries.length)))

  for (const q of queries) {
    try {
      const endpoint = `https://api.duckduckgo.com/?q=${encodeURIComponent(q)}&format=json&no_html=1&skip_disambig=1`
      const text = await requestText(endpoint, perQuery, { Accept: 'application/json' })
      if (!text) continue
      const parsed = parseDdgAbstract(JSON.parse(text) as DdgPayload)
      if (!parsed.abstract) continue
      return {
        title: parsed.title || brand,
        description: clipDescription(parsed.abstract),
        provider: 'domain_search'
      }
    } catch {
      continue
    }
  }
  return null
}

type WikiSearchHit = { title?: string; snippet?: string }

const pickWikiHit = (hits: WikiSearchHit[], brand: string): WikiSearchHit | null => {
  if (!hits.length) return null
  const b = brand.toLowerCase()
  const score = (h: WikiSearchHit) => {
    const title = (h.title || '').toLowerCase()
    const snip = (h.snippet || '').replace(/<[^>]+>/g, ' ').toLowerCase()
    let s = 0
    if (title === b) s += 8
    if (title.startsWith(`${b} (`)) s += 10
    if (title.includes(b)) s += 4
    if (/\b(ai|chatbot|language model|llm|assistant)\b/i.test(title)) s += 5
    if (snip.includes(b)) s += 2
    // 人名/无关消歧
    if (/\b(shannon|debussy|monet|rainwater)\b/i.test(title)) s -= 12
    return s
  }
  const ranked = [...hits].sort((a, bHit) => score(bHit) - score(a))
  return ranked[0] && score(ranked[0]) > 0 ? ranked[0] : hits[0]
}

/**
 * Wikipedia 公开 API（origin=*，浏览器可跨域）：品牌语义检索 + intro 摘要。
 * 作为 DDG 空结果时的第二跳（浏览器侧 DDG 常无 Instant Answer）。
 */
const fetchViaWikipedia = async (
  host: string,
  timeoutMs: number
): Promise<SearchFallbackResult | null> => {
  const brand = brandTitleFromHost(host)
  const reg = registeredDomainOf(host)
  // 优先「产品语义」查询，纯域名易命中公司页而非产品页
  const queries = Array.from(
    new Set([
      `${brand} language model`,
      `${brand} AI chatbot`,
      `${brand} (${reg})`,
      `${brand} ${reg}`,
      brand
    ])
  )
  const perSearch = Math.max(1200, Math.floor((timeoutMs * 0.45) / Math.max(1, Math.min(queries.length, 2))))

  try {
    let hit: WikiSearchHit | null = null
    for (const q of queries.slice(0, 2)) {
      const searchUrl =
        `https://en.wikipedia.org/w/api.php?action=query&list=search&srsearch=${encodeURIComponent(q)}` +
        `&srlimit=5&utf8=1&format=json&origin=*`
      const searchText = await requestText(searchUrl, perSearch, { Accept: 'application/json' })
      if (!searchText) continue
      const searchPayload = JSON.parse(searchText) as {
        query?: { search?: WikiSearchHit[] }
      }
      hit = pickWikiHit(searchPayload.query?.search || [], brand)
      if (hit?.title) break
    }
    if (!hit?.title) return null

    const pageTitle = hit.title.trim()
    const extractUrl =
      `https://en.wikipedia.org/w/api.php?action=query&prop=extracts&exintro=1&explaintext=1` +
      `&titles=${encodeURIComponent(pageTitle)}&format=json&origin=*`
    const extractText = await requestText(extractUrl, Math.max(1500, Math.floor(timeoutMs * 0.55)), {
      Accept: 'application/json'
    })
    if (!extractText) {
      const snip = (hit.snippet || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()
      if (!snip || isLoginOrAccessWallText(snip)) return null
      return { title: brand, description: clipDescription(snip), provider: 'domain_search' }
    }

    const extractPayload = JSON.parse(extractText) as {
      query?: { pages?: Record<string, { extract?: string; title?: string }> }
    }
    const pages = extractPayload.query?.pages || {}
    const page = Object.values(pages).find((p) => typeof p?.extract === 'string' && p.extract.trim())
    const extract = (page?.extract || '').trim()
    if (!extract || isLoginOrAccessWallText(extract)) return null

    return {
      title: brand || (page?.title || pageTitle),
      description: clipDescription(extract),
      provider: 'domain_search'
    }
  } catch {
    return null
  }
}

/**
 * 需登录 / 抓页失败时：用公开检索摘要说明「该域名提供什么服务」，供标题简介润色。
 * DDG 与 Wikipedia 并行（浏览器侧 DDG Instant Answer 常空，串行会吃光预算）。
 */
const fetchDomainServiceSummary = async (
  url: string,
  timeoutMs = 5000
): Promise<SearchFallbackResult | null> => {
  const host = hostnameOf(url)
  if (!host) return null

  const budget = Math.max(2500, timeoutMs)
  const [ddg, wiki] = await Promise.all([
    fetchViaDuckDuckGo(host, budget),
    fetchViaWikipedia(host, budget)
  ])
  return ddg || wiki
}

const usableTitle = (title: string | null | undefined, pageUrl: string): string | null => {
  const t = (title || '').trim()
  if (!t || isLoginOrAccessWallText(t)) return null
  const host = hostnameOf(pageUrl)
  if (host) {
    const normalized = t
      .toLowerCase()
      .replace(/^https?:\/\//, '')
      .replace(/^www\./, '')
      .replace(/\/$/, '')
    if (normalized === host.toLowerCase() || normalized === registeredDomainOf(host)) return null
  }
  return t
}

const usableDescription = (description: string | null | undefined): string | null => {
  const d = (description || '').trim()
  if (!d || isLoginOrAccessWallText(d)) return null
  return d
}

/**
 * 联网元信息兜底：
 * 1. Jina Reader 读页
 * 2. 标题/简介缺失或登录墙时，检索域名公开服务摘要
 */
export const fetchMetadataFromNetwork = async (
  url: string,
  timeoutMs = 10000
): Promise<SearchFallbackResult | null> => {
  // Jina 读页与域名公开摘要并行：登录墙页常有 title、无可用 desc
  const budget = Math.max(4000, timeoutMs)
  const [jina, domain] = await Promise.all([
    fetchMetadataViaJina(url, budget),
    fetchDomainServiceSummary(url, budget)
  ])

  const jinaTitle = usableTitle(jina?.title, url)
  const jinaDesc = usableDescription(jina?.description)
  const domainTitle = usableTitle(domain?.title, url)
  const domainDesc = usableDescription(domain?.description)

  if (jinaTitle && jinaDesc) {
    return { title: jinaTitle, description: jinaDesc, provider: 'jina' }
  }

  if (!jinaTitle && !jinaDesc && !domainTitle && !domainDesc) return null

  const title = jinaTitle || domainTitle
  const description = jinaDesc || domainDesc
  if (!title && !description) return null

  return {
    title: title || domainTitle || brandTitleFromHost(hostnameOf(url) || 'site'),
    description: description || null,
    provider: domainDesc || domainTitle ? 'domain_search' : 'jina'
  }
}
