// 在线书源引擎（v2，对标开源阅读 Legado）
// 支持两种书源格式：
//   1. 现代 Legado 格式（bookSourceUrl/bookSourceName/searchUrl/ruleSearch/ruleToc/ruleContent/ruleBookInfo/header）
//   2. 「阅读 2.x」旧格式（source_name/source_url/search_url/search_result/book_menu/chapter_content/content_filter）
// 规则解析复用通用规则引擎 ruleEngine.ts（CSS / XPath / JSONPath / 正则 / ##替换##）。

import { getLegadoChapterList, getLegadoContent, type LegadoConfig } from './legado'
import { mergeCookies } from './cookieJar'
import {
  parseHtmlDoc,
  queryElements,
  queryString,
  queryElementText,
  splitRuleChain,
  parseRuleExpression
} from './ruleEngine'

// ---------- 书源类型 ----------

export interface SearchRuleSet {
  checkKeyWord?: string
  bookList?: string
  name?: string
  author?: string
  intro?: string
  kind?: string
  lastChapter?: string
  updateTime?: string
  bookUrl?: string
  coverUrl?: string
  wordCount?: string
  /** 详情页地址的备用取值字段（旧格式 book_id） */
  book_id?: string
}

export interface BookInfoRuleSet {
  init?: string
  name?: string
  author?: string
  intro?: string
  kind?: string
  lastChapter?: string
  updateTime?: string
  coverUrl?: string
  tocUrl?: string
  wordCount?: string
}

export interface TocRuleSet {
  chapterList?: string
  chapterName?: string
  chapterUrl?: string
  nextTocUrl?: string
  updateTime?: string
}

export interface ContentRuleSet {
  content?: string
  subContent?: string
  title?: string
  nextContentUrl?: string
  replaceRegex?: string
}

/** 书源 JSON（新格式与旧格式字段并存，导入时按需归一化） */
export interface BookSource {
  // ===== 现代 Legado 格式 =====
  bookSourceUrl?: string
  bookSourceName?: string
  bookSourceGroup?: string
  bookSourceType?: string | number
  bookUrlPattern?: string
  enabled?: boolean
  enabledExplore?: boolean
  /** 请求头 JSON 字符串或对象 */
  header?: string | Record<string, string>
  cookie?: string
  // ===== 登录（对标开源阅读 Legado） =====
  /** 登录地址：普通 URL、@js:/<js> 代码（从中提取登录端点）或相对地址 */
  loginUrl?: string
  /** 登录表单 UI（JSON 数组，如 [{"name":"username","type":"text"},{"name":"password","type":"password"}]） */
  loginUi?: string
  /** 登录状态检测表达式（支持 cookie.contains("xxx") / url.contains(...) / body.contains(...) 等） */
  loginCheckJs?: string
  /** 启用 Cookie Jar（自动保存并附加域名 Cookie），默认 true */
  enabledCookieJar?: boolean
  searchUrl?: string
  ruleSearch?: SearchRuleSet
  ruleBookInfo?: BookInfoRuleSet
  ruleToc?: TocRuleSet
  ruleContent?: ContentRuleSet
  // ===== 「阅读 2.x」旧格式 =====
  source_name?: string
  source_url?: string
  /** 1 = HTML 书源；2 = API（JSON）书源 */
  source_type?: '1' | '2' | number
  search_url?: string
  search_result?: {
    list?: string
    name?: string
    author?: string
    newest?: string
    remark?: string
    url?: string
    url_attr?: string
    cover?: string
    cover_attr?: string
    book_id?: string
  }
  book_menu?: string
  item_title?: string
  item_url?: string
  item_url_base?: string
  chapter_title?: string
  chapter_content?: string
  /** base64（正则@@替换值），逐条应用，用于去除广告等（旧格式） */
  content_filter?: string[]
  headers?: Record<string, string>
}

/** 归一化后的书源（内部统一视图） */
export interface NormalizedSource {
  key: string
  name: string
  url: string
  group?: string
  enabled: boolean
  /** 响应内容类型偏好（旧格式 source_type；新格式自动识别） */
  type: 'html' | 'json'
  bookUrlPattern?: string
  headers: Record<string, string>
  search: { url: string; rules: SearchRuleSet }
  bookInfo?: BookInfoRuleSet
  toc: TocRuleSet
  content: ContentRuleSet & { filters?: string[] }
  // ===== 登录（对标 Legado） =====
  loginUrl?: string
  loginUi?: string
  loginCheckJs?: string
  /** 启用 Cookie Jar（enabledCookieJar 缺省按 true 处理） */
  useCookieJar: boolean
}

// ---------- 在线书籍 / 搜索结果类型 ----------

export interface OnlineBookRef {
  id: string
  bookUrl: string
  /** 目录页地址（与详情页不同时有效，Legado 分离设计） */
  tocUrl?: string
  onlineKind: 'source' | 'legado'
  source?: BookSource
}

export interface OnlineSearchHit {
  sourceName: string
  title: string
  author: string
  newest: string
  remark: string
  url: string
  cover: string
  bookId: string
  source: BookSource
  /** 命中结果所属的书源分组名 */
  sourceGroup?: string
  /** 详情页解析出的目录页地址（入库时使用） */
  tocUrl?: string
  intro?: string
  kind?: string
  wordCount?: string
  /** 合并结果：命中的书源名列表 */
  sourceNames?: string[]
  /** 合并结果：命中的书源数量 */
  sourceCount?: number
}

export interface SearchSourceEntry {
  source: BookSource
  groupName?: string
}

export interface OnlineChapterItem {
  title: string
  url: string
  /** legado 书籍章节索引 */
  _index?: number
}

export interface OnlineReadContext {
  legado?: LegadoConfig
  /** Cookie Jar 访问上下文（由调用方从 store 构建） */
  cookie?: CookieCtx
}

/** Cookie Jar 访问上下文 */
export interface CookieCtx {
  /** 返回指定 URL 对应域名的已保存 cookie（未启用 jar 时调用方返回空串） */
  getCookie: (url: string) => string
  /** 保存响应 Set-Cookie 到对应域名 */
  saveCookies: (url: string, setCookies: string[]) => void
}

export interface BookInfoResult {
  title: string
  author: string
  intro: string
  kind: string
  coverUrl: string
  tocUrl: string
  wordCount: string
  latestChapterTitle: string
  /** 详情页原始 HTML（后续抓目录可复用） */
  html?: string
}

const services = () => (window as any).services

// 会话级缓存：目录 + 章节正文（打开书籍期间复用，避免重复请求）
const menuCache = new Map<string, OnlineChapterItem[]>()
const contentCache = new Map<string, string>()

export function clearOnlineCaches(bookId?: string) {
  if (bookId) {
    menuCache.delete(`menu:${bookId}`)
    for (const key of Array.from(contentCache.keys())) {
      if (key.startsWith(`content:${bookId}:`)) contentCache.delete(key)
    }
    return
  }
  menuCache.clear()
  contentCache.clear()
}

// ---------- 书源归一化 ----------

function pickAttrRule(sel: string | undefined, attr: string | undefined, fallback: string): string {
  if (!sel) return fallback
  if (attr && !sel.includes('@')) return `${sel}@${attr}`
  return sel
}

/** 解析书源请求头（header JSON 字符串 / headers 对象 / cookie） */
function parseSourceHeaders(source: BookSource): Record<string, string> {
  const h: Record<string, string> = {}
  if (source.headers && typeof source.headers === 'object') Object.assign(h, source.headers)
  if (typeof source.header === 'string' && source.header.trim()) {
    try {
      const parsed = JSON.parse(source.header)
      if (parsed && typeof parsed === 'object') Object.assign(h, parsed)
    } catch {
      /* header 非 JSON（如 @js: 表达式），忽略 */
    }
  } else if (source.header && typeof source.header === 'object') {
    Object.assign(h, source.header)
  }
  if (source.cookie && !h['Cookie'] && !h['cookie']) h['Cookie'] = source.cookie
  return h
}

/** 旧格式搜索规则 → 新格式 SearchRuleSet */
function convertOldSearchRules(source: BookSource): SearchRuleSet {
  const sr = source.search_result || {}
  return {
    bookList: sr.list,
    name: sr.name,
    author: sr.author,
    bookUrl: pickAttrRule(sr.url, sr.url_attr, sr.book_id || 'a@href'),
    book_id: sr.book_id,
    coverUrl: pickAttrRule(sr.cover, sr.cover_attr, ''),
    lastChapter: sr.newest,
    intro: sr.remark
  }
}

/** 把任意书源 JSON 归一化为内部统一结构 */
export function normalizeSource(raw: BookSource | undefined | null): NormalizedSource | null {
  if (!raw || typeof raw !== 'object') return null
  const source = raw as BookSource

  const isNewFormat = !!(source.bookSourceUrl || source.ruleSearch || source.searchUrl && source.bookSourceName)
  const key = source.bookSourceUrl || source.source_url || source.source_name || ''
  const name = source.bookSourceName || source.source_name || key || '未命名'
  const url = source.bookSourceUrl || source.source_url || source.search_url?.split('?')[0] || ''
  const type: 'html' | 'json' =
    String(source.source_type ?? '1') === '2' ? 'json' : 'html'

  const searchRules: SearchRuleSet = isNewFormat
    ? { ...(source.ruleSearch || {}) }
    : convertOldSearchRules(source)

  const toc: TocRuleSet = {
    chapterList: source.ruleToc?.chapterList ?? source.book_menu ?? '',
    chapterName: source.ruleToc?.chapterName ?? source.item_title ?? '',
    chapterUrl: source.ruleToc?.chapterUrl ?? source.item_url ?? 'a@href',
    nextTocUrl: source.ruleToc?.nextTocUrl,
    updateTime: source.ruleToc?.updateTime
  }

  const content: ContentRuleSet & { filters?: string[] } = {
    content: source.ruleContent?.content ?? source.chapter_content ?? '',
    subContent: source.ruleContent?.subContent,
    title: source.ruleContent?.title ?? source.chapter_title,
    nextContentUrl: source.ruleContent?.nextContentUrl,
    replaceRegex: source.ruleContent?.replaceRegex,
    filters: Array.isArray(source.content_filter) ? source.content_filter : undefined
  }

  return {
    key,
    name,
    url,
    group: source.bookSourceGroup,
    enabled: source.enabled !== false,
    type,
    bookUrlPattern: source.bookUrlPattern || undefined,
    headers: parseSourceHeaders(source),
    search: {
      url: source.searchUrl || source.search_url || '',
      rules: searchRules
    },
    bookInfo: source.ruleBookInfo ? { ...source.ruleBookInfo } : undefined,
    toc,
    content,
    loginUrl: source.loginUrl,
    loginUi: source.loginUi,
    loginCheckJs: source.loginCheckJs,
    useCookieJar: source.enabledCookieJar !== false
  }
}

/** 书源显示名（新格式优先；带分组时展示为「名称 (分组)」，对齐开源阅读的书源列表） */
export function sourceDisplayName(source: BookSource | null | undefined): string {
  const name = source?.bookSourceName || source?.source_name || source?.bookSourceUrl || source?.source_url || '未命名'
  const group = source?.bookSourceGroup?.trim()
  return group ? `${name} (${group})` : name
}

/** 书源唯一标识 */
export function sourceKey(source: BookSource | null | undefined): string {
  return source?.bookSourceUrl || source?.source_url || source?.source_name || ''
}

/**
 * 解析书源登录地址：
 * - 普通 http(s) URL 原样返回
 * - @js:/<js> 代码：启发式提取代码中第一个 http(s) URL（通常是 java.get/post 的登录端点）
 * - 相对地址：基于书源 URL 解析为绝对地址
 * 无法确定时返回空串。
 */
export function getSourceLoginUrl(source: BookSource | null | undefined): string {
  const raw = source?.loginUrl?.trim()
  if (!raw) return ''
  if (/^https?:\/\//i.test(raw)) return raw
  if (raw.startsWith('@js:') || raw.startsWith('<js>')) {
    const m = raw.match(/https?:\/\/[^\s'"`<>)]+/gi)
    if (m) return m[0]
    return ''
  }
  const base = sourceKey(source) || source?.searchUrl?.split('?')[0] || ''
  return base ? absoluteHttpUrl(raw, base) : raw
}

/** 解析 loginUi JSON（数组形式），返回表单字段列表；非法或为空返回 [] */
export function parseLoginUi(
  source: BookSource | null | undefined
): Array<{ name: string; type: string; default?: string; viewName?: string }> {
  const raw = source?.loginUi?.trim()
  if (!raw) return []
  try {
    const data = JSON.parse(raw)
    if (!Array.isArray(data)) return []
    return data
      .filter((f: any) => f && typeof f === 'object' && typeof f.name === 'string' && f.name)
      .map((f: any) => ({
        name: f.name as string,
        type: String(f.type || 'text'),
        default: f.default != null ? String(f.default) : undefined,
        viewName: f.viewName != null ? String(f.viewName) : undefined
      }))
  } catch {
    return []
  }
}

/** 校验书源，返回错误信息（合法返回 null） */
export function validateBookSource(source: BookSource): string | null {
  const s = source || {}
  const name = s.bookSourceName?.trim() || s.source_name?.trim()
  if (!name) return '缺少书源名称（bookSourceName / source_name）'
  const searchUrl = s.searchUrl?.trim() || s.search_url?.trim()
  if (!searchUrl) return '缺少搜索地址（searchUrl / search_url）'
  if (s.ruleSearch) {
    const rs = s.ruleSearch
    if (!rs.bookList) return '缺少 ruleSearch.bookList（搜索结果列表规则）'
    if (!rs.bookUrl && !rs.name) return '缺少 ruleSearch.bookUrl 或 name（搜索项解析规则）'
  } else if (s.search_result) {
    const sr = s.search_result
    if (!sr.list) return '缺少 search_result.list（搜索结果列表规则）'
    if (!sr.url && !sr.book_id) return '缺少 search_result.url 或 book_id（搜索项详情地址）'
    if (String(s.source_type ?? '1') !== '2') {
      if (!s.book_menu) return '缺少 book_menu（章节列表规则）'
      if (!s.chapter_content) return '缺少 chapter_content（正文规则）'
    }
  } else {
    return '缺少规则字段（ruleSearch / search_result）'
  }
  return null
}

// ---------- 基础工具 ----------

/** 取书源的基础地址（bookSourceUrl 优先） */
function sourceOrigin(source: BookSource | undefined | null): string {
  const raw = source?.bookSourceUrl || source?.source_url || source?.search_url || ''
  return raw.split('#')[0].split('?')[0]
}

/**
 * 把链接规则取到的值规整为可直接请求的绝对 http(s) 地址。
 * 规则多匹配时（如 tag.a@href 命中多个 a）queryString 返回换行拼接，这里只取首行，
 * 避免把整段拼接当成 URL（对标 Legado getString 取首条）。
 */
function absoluteHttpUrl(url: unknown, base?: string): string {
  if (url == null) return ''
  let raw = String(url).trim()
  const nl = raw.indexOf('\n')
  if (nl !== -1) raw = raw.slice(0, nl).trim()
  if (!raw || /^(javascript:|data:|about:|#)/i.test(raw)) return ''
  if (/^https?:\/\//i.test(raw)) {
    try {
      return new URL(raw).href
    } catch {
      return ''
    }
  }
  if (raw.startsWith('//')) {
    const proto = /^(https?):/i.exec(base || '')?.[1] || 'https'
    return absoluteHttpUrl(`${proto}:${raw}`)
  }
  if (!base) return ''
  try {
    return new URL(raw, base).href
  } catch {
    return ''
  }
}

function resolveUrl(url: string, baseUrl: string): string {
  return absoluteHttpUrl(url, baseUrl)
}

function cleanText(text: string): string {
  return text
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .replace(/\u00a0/g, ' ')
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/^\n+/, '')
    .replace(/\n+$/, '')
}

function decodeBase64(s: string): string {
  try {
    return decodeURIComponent(escape(window.atob(s)))
  } catch {
    try {
      return window.atob(s)
    } catch {
      return ''
    }
  }
}

/** 旧格式 content_filter：base64（正则@@替换值）逐条应用 */
function applyContentFilters(content: string, filters?: string[]): string {
  if (!Array.isArray(filters)) return content
  let result = content
  for (const f of filters) {
    if (!f) continue
    const decoded = decodeBase64(f)
    const idx = decoded.indexOf('@@')
    if (idx <= 0) continue
    const pattern = decoded.slice(0, idx)
    const repl = decoded.slice(idx + 2)
    try {
      result = result.replace(new RegExp(pattern, 'g'), repl)
    } catch {
      /* 非法正则直接跳过 */
    }
  }
  return result
}

/** 书源级全文替换（ContentRule.replaceRegex，对标 Legado BookContent） */
function applyContentReplaceRegex(content: string, replaceRegex?: string): string {
  if (!replaceRegex) return content
  const trimmed = content.split('\n').map(l => l.trim()).join('\n')
  const parts = replaceRegex.split('##')
  if (parts.length < 2) return content
  const pattern = parts[1]
  const replacement = parts.length > 2 ? parts[2] : ''
  try {
    return trimmed.replace(new RegExp(pattern, 'g'), replacement)
  } catch {
    return trimmed
  }
}

// ---------- URL 构建（对标 Legado AnalyzeUrl） ----------

/** 拆分 URL 末尾的请求选项 JSON（,{...}） */
function splitUrlOptions(raw: string): { url: string; method?: string; headers?: Record<string, string>; body?: string } {
  const m = /^(.*?),\s*(\{[\s\S]*\})$/.exec(raw.trim())
  if (!m) return { url: raw.trim() }
  try {
    const opts = JSON.parse(m[2])
    const headers: Record<string, string> = {}
    if (opts.headers && typeof opts.headers === 'object') {
      for (const [k, v] of Object.entries(opts.headers)) headers[k] = String(v)
    }
    return {
      url: m[1].trim(),
      method: opts.method ? String(opts.method).toUpperCase() : undefined,
      headers,
      body: opts.body != null ? String(opts.body) : undefined
    }
  } catch {
    return { url: raw.trim() }
  }
}

/** 构建搜索 URL：替换 {{key}}/{{page}}/<页码映射> 等占位符 */
export function buildSearchUrl(norm: NormalizedSource, keyword: string, page = 1): string {
  let url = norm.search.url || ''
  const enc = encodeURIComponent(keyword)

  // 页码映射 <1,2,3>
  url = url.replace(/<([^>]+)>/g, (_m, group: string) => {
    const pages = group.split(',').map(s => s.trim()).filter(Boolean)
    if (!pages.length) return ''
    return pages[Math.min(page - 1, pages.length - 1)]
  })

  // {{js}} 内嵌表达式（支持常见变量：key/keyword/page/page-1/page+1/escape/gb2312）
  url = url.replace(/\{\{([^{}]+)\}\}/g, (_m, expr: string) => {
    const e = expr.trim()
    if (/^key(?:word)?$/i.test(e)) return enc
    if (/^page\s*-\s*1$/i.test(e)) return String(Math.max(1, page - 1))
    if (/^page\s*\+\s*1$/i.test(e)) return String(page + 1)
    if (/^page$/i.test(e)) return String(page)
    if (/^escape$/i.test(e)) return enc
    if (/^gb2312$/i.test(e)) return enc
    // 不支持的 JS 表达式：保留原文（后续请求大概率失败，由调用方捕获）
    return `{{${expr}}}`
  })

  // 旧占位符兼容
  url = url.replace(/###keyword###/g, enc).replace(/{{keyword}}/g, enc)

  // 相对地址解析：以书源地址（bookSourceUrl）为基址拼成绝对地址（对齐 Legado）
  // 注意保留 `,{...}` 请求选项后缀（POST 方法/请求头/请求体）
  const optMatch = /^(.*?)(,\s*\{[\s\S]*\})$/.exec(url.trim())
  const urlPart = optMatch ? optMatch[1] : url.trim()
  const optPart = optMatch ? optMatch[2] : ''
  let resolved = urlPart
  if (urlPart && !/^https?:\/\//i.test(urlPart) && !urlPart.startsWith('//') && norm.url && /^https?:\/\//i.test(norm.url)) {
    try {
      resolved = new URL(urlPart, norm.url).href
    } catch {
      // 解析失败保留原样，由请求阶段报错
    }
  }
  return resolved + optPart
}

/** 按书源发起请求（支持 POST 选项、自定义头、Cookie Jar），返回 { 文本, 响应头 } */
async function requestWithResponse(
  rawUrl: string,
  headers: Record<string, string>,
  timeout: number,
  cookieCtx?: CookieCtx
): Promise<{ text: string; headers: Record<string, string | string[]> }> {
  const { url, method, headers: optHeaders, body } = splitUrlOptions(rawUrl)
  const finalHeaders = { ...headers, ...(optHeaders || {}) }
  // 附加 Cookie Jar 中的域名 Cookie（jar 优先于手动 Cookie，对齐 Legado mergeCookies）
  if (cookieCtx) {
    const jarCookie = cookieCtx.getCookie(url)
    if (jarCookie) finalHeaders['Cookie'] = mergeCookies(finalHeaders['Cookie'], jarCookie)
  }
  const servicesApi = services()
  let res: { status: number; text: string; headers: Record<string, string | string[]> }
  if (servicesApi.httpGetResponse && servicesApi.httpPostResponse) {
    res = method === 'POST'
      ? await servicesApi.httpPostResponse(url, body ?? '', { headers: finalHeaders, timeout })
      : await servicesApi.httpGetResponse(url, { headers: finalHeaders, timeout })
  } else {
    // 旧 preload 兜底（拿不到响应头，仅返回文本）
    const text = method === 'POST'
      ? await servicesApi.httpPostText(url, body ?? '', { headers: finalHeaders, timeout })
      : await servicesApi.httpGetText(url, { headers: finalHeaders, timeout })
    res = { status: 200, text, headers: {} }
  }
  // 保存 Set-Cookie 到 Cookie Jar
  if (cookieCtx && res.headers) {
    const setCookie = res.headers['set-cookie'] || res.headers['Set-Cookie']
    if (setCookie != null) {
      const list = Array.isArray(setCookie) ? setCookie.map(String) : [String(setCookie)]
      if (list.some(Boolean)) cookieCtx.saveCookies(url, list)
    }
  }
  return { text: res.text, headers: res.headers }
}

/** 按书源发起请求（支持 POST 选项、自定义头、Cookie Jar），返回文本 */
async function requestText(rawUrl: string, headers: Record<string, string>, timeout = 15000, cookieCtx?: CookieCtx): Promise<string> {
  const res = await requestWithResponse(rawUrl, headers, timeout, cookieCtx)
  return res.text
}

// ---------- 搜索解析 ----------

/**
 * 从列表项元素/对象中按规则取值（带 JSON 根上下文）。
 * 单值字段对标 Legado getString：规则多匹配时只取首条（queryString 按换行拼接多值）。
 * 正文 content 不走本函数（用 queryString 保留全部段落）。
 */
function itemText(item: unknown, rule: string | undefined, fallback: string, jsonRoot?: unknown): string {
  if (!rule) return ''
  let value = ''
  if (item instanceof Element) value = queryElementText(item, rule)
  else if (item && typeof item === 'object') value = queryElementText(item, rule, { json: jsonRoot })
  if (!value) return fallback
  const first = value.split('\n')[0].trim()
  return first || fallback
}

export function parseSearchHtml(raw: string, norm: NormalizedSource, baseUrl: string): OnlineSearchHit[] {
  const doc = parseHtmlDoc(raw)
  const sr = norm.search.rules
  const items = queryElements(doc, sr.bookList || '')
  const hits: OnlineSearchHit[] = []
  for (const item of items) {
    const title = itemText(item, sr.name || '', '') || (item instanceof Element ? (item.textContent || '').trim() : '')
    if (!title) continue
    let url = sr.bookUrl ? itemText(item, sr.bookUrl, '') : ''
    if (!url) url = itemText(item, sr.book_id, '')
    url = absoluteHttpUrl(url, baseUrl)
    if (!url) continue
    const cover = sr.coverUrl ? itemText(item, sr.coverUrl, '') : ''
    hits.push({
      sourceName: norm.name,
      title,
      author: itemText(item, sr.author, ''),
      intro: itemText(item, sr.intro, ''),
      kind: itemText(item, sr.kind, ''),
      newest: itemText(item, sr.lastChapter, ''),
      remark: itemText(item, sr.updateTime, ''),
      wordCount: itemText(item, sr.wordCount, ''),
      url,
      cover: absoluteHttpUrl(cover, baseUrl),
      bookId: '',
      source: {} as BookSource
    })
  }
  return hits
}

function parseSearchJson(raw: string, norm: NormalizedSource, base: string): OnlineSearchHit[] {
  let data: unknown
  try {
    data = JSON.parse(raw)
  } catch {
    return []
  }
  const sr = norm.search.rules
  const items = queryElements(data, sr.bookList || '') as Record<string, any>[]
  const hits: OnlineSearchHit[] = []
  for (const item of items) {
    if (!item || typeof item !== 'object') continue
    const title = itemText(item, sr.name || 'name', '', data)
    if (!title) continue
    let url = sr.bookUrl ? itemText(item, sr.bookUrl, '', data) : ''
    if (!url) url = itemText(item, sr.book_id || 'bookId', '', data)
    url = absoluteHttpUrl(url, base)
    if (!url) continue
    hits.push({
      sourceName: norm.name,
      title,
      author: itemText(item, sr.author || 'author', '', data),
      intro: itemText(item, sr.intro || 'intro', '', data),
      kind: itemText(item, sr.kind || 'kind', '', data),
      newest: itemText(item, sr.lastChapter || 'lastChapter', '', data),
      remark: itemText(item, sr.updateTime || 'updateTime', '', data),
      wordCount: itemText(item, sr.wordCount || 'wordCount', '', data),
      url,
      cover: absoluteHttpUrl(itemText(item, sr.coverUrl || 'cover', '', data), base),
      bookId: '',
      source: {} as BookSource
    })
  }
  return hits
}

/** 详情页模式：bookUrlPattern 命中时按 ruleBookInfo 解析单条结果 */
function parseSearchAsDetail(raw: string, norm: NormalizedSource, baseUrl: string): OnlineSearchHit | null {
  const bi = norm.bookInfo
  if (!bi) return null
  let doc: Document | null = null
  let jsonRoot: unknown = null
  let title = ''
  let author = ''
  let intro = ''
  let kind = ''
  let newest = ''
  let wordCount = ''
  let cover = ''
  let tocUrl = baseUrl

  const useJson = norm.type === 'json' || (bi.name || '').startsWith('$')
  if (useJson) {
    try {
      jsonRoot = JSON.parse(raw)
    } catch {
      return null
    }
    title = itemText(jsonRoot, bi.name || 'name', '', jsonRoot)
    author = itemText(jsonRoot, bi.author || 'author', '', jsonRoot)
    intro = itemText(jsonRoot, bi.intro || 'intro', '', jsonRoot)
    kind = itemText(jsonRoot, bi.kind || 'kind', '', jsonRoot)
    newest = itemText(jsonRoot, bi.lastChapter || 'lastChapter', '', jsonRoot)
    wordCount = itemText(jsonRoot, bi.wordCount || 'wordCount', '', jsonRoot)
    cover = itemText(jsonRoot, bi.coverUrl || 'cover', '', jsonRoot)
    tocUrl = bi.tocUrl ? absoluteHttpUrl(itemText(jsonRoot, bi.tocUrl || 'tocUrl', '', jsonRoot), baseUrl) : baseUrl
  } else {
    doc = parseHtmlDoc(raw)
    title = queryString(doc, bi.name || '') || queryString(doc, 'title@text')
    author = queryString(doc, bi.author || '')
    intro = queryString(doc, bi.intro || '')
    kind = queryString(doc, bi.kind || '')
    newest = queryString(doc, bi.lastChapter || '')
    wordCount = queryString(doc, bi.wordCount || '')
    cover = absoluteHttpUrl(queryString(doc, bi.coverUrl || ''), baseUrl)
    if (bi.tocUrl) tocUrl = absoluteHttpUrl(queryString(doc, bi.tocUrl, { isUrl: true }), baseUrl) || baseUrl
  }
  if (!title) return null
  return {
    sourceName: norm.name,
    title,
    author,
    intro,
    kind,
    newest,
    remark: '',
    wordCount,
    url: baseUrl,
    cover,
    bookId: '',
    tocUrl,
    source: {} as BookSource
  }
}

/** 搜索结果合并：同名同作者合并，命中书源多的排前面 */
export function mergeSearchHits(hits: OnlineSearchHit[]): OnlineSearchHit[] {
  const groups = new Map<string, OnlineSearchHit[]>()
  for (const h of hits) {
    const key = `${h.title}|${h.author || ''}`
    const arr = groups.get(key)
    if (arr) arr.push(h)
    else groups.set(key, [h])
  }
  const merged: OnlineSearchHit[] = []
  for (const arr of groups.values()) {
    if (arr.length === 1) {
      merged.push(arr[0])
      continue
    }
    const first = { ...arr[0] }
    first.sourceNames = arr.map(x => x.sourceName)
    first.sourceCount = arr.length
    // 取最完整的简介/最新章节
    for (const h of arr) {
      if (h.intro && !first.intro) first.intro = h.intro
      if (h.newest && !first.newest) first.newest = h.newest
      if (h.cover && !first.cover) first.cover = h.cover
    }
    first.sourceName = arr.map(x => x.sourceName).join(' / ')
    merged.push(first)
  }
  merged.sort((a, b) => (b.sourceCount || 1) - (a.sourceCount || 1))
  return merged
}

/** 在指定书源中并发搜索关键词 */
export async function searchOnlineBooks(
  keyword: string,
  entries: SearchSourceEntry[],
  onSourceDone?: (sourceName: string) => void,
  cookieCtx?: CookieCtx
): Promise<OnlineSearchHit[]> {
  const results: OnlineSearchHit[] = []
  await Promise.all(
    entries.map(async ({ source, groupName }) => {
      const norm = normalizeSource(source)
      const name = norm?.name || sourceDisplayName(source)
      try {
        if (!norm) {
          console.warn(`[hushreader:search] ${name}：书源规则解析失败（normalizeSource 返回空），已跳过`)
          return
        }
        if (!norm.enabled) {
          console.log(`[hushreader:search] ${name}：已停用，跳过`)
          return
        }
        if (!norm.search.url) {
          console.warn(`[hushreader:search] ${name}：未配置搜索地址（searchUrl/search_url），已跳过`)
          return
        }
        const rawUrl = buildSearchUrl(norm, keyword, 1)
        console.log(`[hushreader:search] ${name} → ${rawUrl}`)
        const perCtx = norm.useCookieJar ? cookieCtx : undefined
        const raw = await requestText(rawUrl, norm.headers, 15000, perCtx)
        const finalUrl = splitUrlOptions(rawUrl).url
        let hits: OnlineSearchHit[] = []
        const useJson = norm.type === 'json' || (norm.search.rules.bookList || '').startsWith('$')

        // 详情页检测（bookUrlPattern）
        if (norm.bookUrlPattern) {
          try {
            if (new RegExp(norm.bookUrlPattern).test(finalUrl)) {
              console.log(`[hushreader:search] ${name}：bookUrlPattern 命中，按详情页解析`)
              const hit = parseSearchAsDetail(raw, norm, finalUrl)
              if (hit) hits = [hit]
            }
          } catch { }
        }
        if (hits.length === 0) {
          try {
            hits = useJson
              ? parseSearchJson(raw, norm, sourceOrigin(source) || finalUrl)
              : parseSearchHtml(raw, norm, finalUrl)
          } catch (e: any) {
            console.warn(`[hushreader:search] ${name}：列表解析异常`, e)
            hits = []
          }
        }
        console.log(`[hushreader:search] ${name}：响应 ${raw.length} 字符，解析出 ${hits.length} 条结果（${useJson ? 'JSON' : 'HTML'}）`)
        for (const h of hits) {
          h.source = source
          h.sourceGroup = groupName
        }
        results.push(...hits)
      } catch (e: any) {
        console.warn(`[hushreader:search] ${name}：搜索失败`, e?.message || e)
      } finally {
        onSourceDone?.(norm?.name || sourceDisplayName(source))
      }
    })
  )
  return mergeSearchHits(results)
}

// ---------- 目录 / 正文 ----------

function parseMenuHtml(raw: string, norm: NormalizedSource, baseUrl: string): OnlineChapterItem[] {
  const doc = parseHtmlDoc(raw)
  const toc = norm.toc
  const items = queryElements(doc, toc.chapterList || 'a')
  const list: OnlineChapterItem[] = []
  items.forEach((item, i) => {
    if (!(item instanceof Element)) return
    const title = toc.chapterName
      ? queryElementText(item, toc.chapterName)
      : (item.textContent || '').trim()
    const href = toc.chapterUrl
      ? queryElementText(item, toc.chapterUrl, { isUrl: true })
      : (item.getAttribute('href') || '')
    const url = resolveUrl(href, baseUrl)
    if (!url) return
    list.push({ title: title || `第${i + 1}章`, url })
  })
  return list
}

function parseMenuJson(raw: string, norm: NormalizedSource, baseUrl: string): OnlineChapterItem[] {
  let data: unknown
  try {
    data = JSON.parse(raw)
  } catch {
    return []
  }
  const toc = norm.toc
  const items = queryElements(data, toc.chapterList || '') as Record<string, any>[]
  const list: OnlineChapterItem[] = []
  items.forEach((item, i) => {
    if (!item || typeof item !== 'object') return
    const title = itemText(item, toc.chapterName || 'name', '', data) ||
      String(item.title ?? item.name ?? '') || `第${i + 1}章`
    const url = absoluteHttpUrl(itemText(item, toc.chapterUrl || 'url', '', data), baseUrl)
    if (!url) return
    list.push({ title, url })
  })
  return list
}

export async function fetchChapterMenu(book: OnlineBookRef, ctx?: OnlineReadContext): Promise<OnlineChapterItem[]> {
  const key = `menu:${book.id}`
  const cached = menuCache.get(key)
  if (cached) return cached

  if (book.onlineKind === 'legado') {
    const cfg = ctx?.legado
    if (!cfg) throw new Error('未配置开源阅读同步，请先在设置中开启同步')
    const list = await getLegadoChapterList(cfg, book.bookUrl)
    const items: OnlineChapterItem[] = list.map(ch => ({
      title: ch.title,
      url: `${book.bookUrl}#${ch.index}`,
      _index: ch.index
    }))
    menuCache.set(key, items)
    return items
  }

  const source = book.source as BookSource
  const norm = normalizeSource(source)
  if (!norm) throw new Error('该书缺少书源规则')
  const base = norm.url || book.bookUrl
  const targetUrl = absoluteHttpUrl(book.tocUrl || book.bookUrl, base)
  if (!targetUrl) throw new Error('书籍地址无效，请重新添加该书')
  const perCtx = norm.useCookieJar ? ctx?.cookie : undefined
  let raw: string
  try {
    raw = await requestText(targetUrl, norm.headers, 20000, perCtx)
  } catch (e) {
    // 网络/请求失败：不抛错，允许打开空阅读器（正文加载时再提示），避免「打不开书」
    console.warn(`[fetchChapterMenu] 请求失败：${(e as Error)?.message || e}`)
    return []
  }

  const useJson = norm.type === 'json' || (norm.toc.chapterList || '').startsWith('$')
  const items = useJson
    ? parseMenuJson(raw, norm, targetUrl)
    : parseMenuHtml(raw, norm, targetUrl)
  // 解析不到章节不抛错：打开流程继续（空目录阅读器 + 错误提示），只有正文加载失败才阻止阅读
  if (items.length) menuCache.set(key, items)
  return items
}

function parseContentHtml(raw: string, norm: NormalizedSource, baseUrl: string, chapterTitle?: string): string {
  const doc = parseHtmlDoc(raw)
  const rule = norm.content.content || 'body@text'
  const expr = parseRuleExpression(rule)
  const needHtml = expr.mode === 'css' && expr.attr === 'html'
  let content = needHtml ? queryString(doc, rule) : queryString(doc, rule)

  // 若页面标题与章节标题一致且正文首行重复，剔除一行标题
  if (chapterTitle && content.startsWith(chapterTitle)) {
    content = content.slice(chapterTitle.length)
  }
  content = cleanText(content)
  content = applyContentFilters(content, norm.content.filters)
  content = applyContentReplaceRegex(content, norm.content.replaceRegex)
  return content.trim()
}

function parseContentJson(raw: string, norm: NormalizedSource): string {
  let data: unknown
  try {
    data = JSON.parse(raw)
  } catch {
    return ''
  }
  let content = queryString(data, norm.content.content || 'content')
  if (!content && typeof data === 'string') content = data
  if (!content && data && typeof data === 'object' && 'content' in data) {
    content = String((data as any).content)
  }
  content = cleanText(content)
  content = applyContentFilters(content, norm.content.filters)
  content = applyContentReplaceRegex(content, norm.content.replaceRegex)
  return content.trim()
}

export async function fetchChapterContent(
  book: OnlineBookRef,
  chapterIndex: number,
  ctx?: OnlineReadContext
): Promise<string> {
  const menu = await fetchChapterMenu(book, ctx)
  const item = menu[chapterIndex]
  if (!item) throw new Error('章节不存在')
  const ckey = `content:${book.id}:${chapterIndex}`
  const cached = contentCache.get(ckey)
  if (cached != null) return cached

  let content = ''
  if (book.onlineKind === 'legado') {
    const cfg = ctx?.legado
    if (!cfg) throw new Error('未配置开源阅读同步')
    content = await getLegadoContent(cfg, book.bookUrl, item._index ?? chapterIndex)
  } else {
    const source = book.source as BookSource
    const norm = normalizeSource(source)
    if (!norm) throw new Error('该书缺少书源规则')
    if (!norm.content.content) throw new Error('书源缺少正文规则（ruleContent.content）')
    const base = norm.url || book.bookUrl
    const chapterUrl = absoluteHttpUrl(item.url, base)
    if (!chapterUrl) throw new Error('章节地址无效，请检查书源规则')
    const perCtx = norm.useCookieJar ? ctx?.cookie : undefined
    const raw = await requestText(chapterUrl, norm.headers, 20000, perCtx)
    const useJson = norm.type === 'json' || (norm.content.content || '').startsWith('$')
    content = useJson
      ? parseContentJson(raw, norm)
      : parseContentHtml(raw, norm, chapterUrl, item.title)
  }
  if (!content) throw new Error('正文解析为空，可能是书源规则失效')
  contentCache.set(ckey, content)
  return content
}

// ---------- 详情页（入库用） ----------

/**
 * 拉取书籍详情页并按 ruleBookInfo 解析。
 * 用于「加入书架」时补全 简介/封面/最新章节/字数/目录页地址。
 * 失败时抛出错误，调用方应回退为仅用搜索结果入库。
 */
export async function fetchBookInfo(
  book: OnlineBookRef,
  ctx?: OnlineReadContext
): Promise<BookInfoResult> {
  if (book.onlineKind === 'legado') {
    throw new Error('开源阅读同步书籍无需拉取详情')
  }
  const source = book.source as BookSource
  const norm = normalizeSource(source)
  if (!norm) throw new Error('该书缺少书源规则')
  const bi = norm.bookInfo
  if (!bi) throw new Error('书源缺少详情页规则（ruleBookInfo）')

  const base = norm.url || book.bookUrl
  const targetUrl = absoluteHttpUrl(book.bookUrl, base)
  if (!targetUrl) throw new Error('书籍地址无效')
  const perCtx = norm.useCookieJar ? ctx?.cookie : undefined
  const raw = await requestText(targetUrl, norm.headers, 20000, perCtx)

  const useJson = norm.type === 'json' || (bi.name || '').startsWith('$')
  let title = ''
  let author = ''
  let intro = ''
  let kind = ''
  let newest = ''
  let wordCount = ''
  let cover = ''
  let tocUrl = targetUrl
  let html: string | undefined

  if (useJson) {
    let data: unknown
    try {
      data = JSON.parse(raw)
    } catch {
      throw new Error('详情页 JSON 解析失败')
    }
    title = itemText(data, bi.name || 'name', '', data)
    author = itemText(data, bi.author || 'author', '', data)
    intro = itemText(data, bi.intro || 'intro', '', data)
    kind = itemText(data, bi.kind || 'kind', '', data)
    newest = itemText(data, bi.lastChapter || 'lastChapter', '', data)
    wordCount = itemText(data, bi.wordCount || 'wordCount', '', data)
    cover = absoluteHttpUrl(itemText(data, bi.coverUrl || 'cover', '', data), targetUrl)
    if (bi.tocUrl) {
      tocUrl = absoluteHttpUrl(itemText(data, bi.tocUrl || 'tocUrl', '', data), targetUrl) || targetUrl
    }
  } else {
    const doc = parseHtmlDoc(raw)
    title = queryString(doc, bi.name || '') || queryString(doc, 'title@text')
    author = queryString(doc, bi.author || '')
    intro = queryString(doc, bi.intro || '')
    kind = queryString(doc, bi.kind || '')
    newest = queryString(doc, bi.lastChapter || '')
    wordCount = queryString(doc, bi.wordCount || '')
    cover = absoluteHttpUrl(queryString(doc, bi.coverUrl || ''), targetUrl)
    if (bi.tocUrl) {
      const toc = absoluteHttpUrl(queryString(doc, bi.tocUrl, { isUrl: true }), targetUrl)
      if (toc) tocUrl = toc
    }
    if (tocUrl === targetUrl) html = raw
  }
  if (!title) throw new Error('详情页未能解析出书名，请检查 ruleBookInfo.name 规则')
  return { title, author, intro, kind, coverUrl: cover, tocUrl, wordCount, latestChapterTitle: newest, html }
}

// ---------- 书源调试（对标 Legado 的 Debug 日志） ----------

/** 调试日志条目 */
export interface DebugLog {
  time: string
  level: 'info' | 'ok' | 'warn' | 'error'
  msg: string
}

function debugLog(logs: DebugLog[], level: DebugLog['level'], msg: string) {
  logs.push({
    time: new Date().toLocaleTimeString('zh-CN', { hour12: false }) + '.' + String(Date.now() % 1000).padStart(3, '0'),
    level,
    msg
  })
  if (level === 'error') console.warn(`[hushreader:debug] ${msg}`)
  else if (level === 'warn') console.warn(`[hushreader:debug] ${msg}`)
  else console.log(`[hushreader:debug] ${msg}`)
}

function textPreview(text: string, len = 180): string {
  return text.replace(/\s+/g, ' ').slice(0, len)
}

/** 调试搜索：单书源完整走一遍搜索链路，逐步输出日志 */
export async function debugSearchSource(
  keyword: string,
  source: BookSource,
  cookieCtx?: CookieCtx,
  logs: DebugLog[] = []
): Promise<OnlineSearchHit[]> {
  debugLog(logs, 'info', `开始调试书源：${sourceDisplayName(source)}`)
  const norm = normalizeSource(source)
  if (!norm) {
    debugLog(logs, 'error', '书源规则解析失败（normalizeSource 返回空）—— 请检查书源 JSON 结构（ruleSearch/ruleToc/ruleContent）')
    return []
  }
  debugLog(logs, 'info', `书源名称：${norm.name}；是否启用：${norm.enabled}；内容类型：${norm.type}；Cookie Jar：${norm.useCookieJar}`)
  if (!norm.search.url) {
    debugLog(logs, 'error', '搜索地址为空（searchUrl/search_url 缺失）')
    return []
  }
  const rawUrl = buildSearchUrl(norm, keyword, 1)
  debugLog(logs, 'info', `搜索 URL：${rawUrl}`)

  const perCtx = norm.useCookieJar ? cookieCtx : undefined
  let res: { text: string; headers?: Record<string, string | string[]> }
  try {
    res = await requestWithResponse(rawUrl, norm.headers, 20000, perCtx)
  } catch (e: any) {
    debugLog(logs, 'error', `请求失败：${e?.message || e}`)
    debugLog(logs, 'warn', '常见原因：网络不可达 / 站点反爬 / 需要登录 Cookie。可在书源行点「登录」获取 Cookie 后重试')
    return []
  }
  const contentType = String(res.headers?.['content-type'] || '')
  debugLog(logs, 'ok', `请求成功：HTTP ${res.text.length > 0 ? '返回' : '空'} ${res.text.length} 字符；Content-Type：${contentType || '未知'}`)
  debugLog(logs, 'info', `响应预览：${textPreview(res.text) || '(空响应)'}`)

  const finalUrl = splitUrlOptions(rawUrl).url
  const useJson = norm.type === 'json' || (norm.search.rules.bookList || '').startsWith('$')
  debugLog(logs, 'info', `解析方式：${useJson ? 'JSON（JSONPath）' : 'HTML（CSS/XPath）'}`)
  debugLog(logs, 'info', `列表规则 bookList：${norm.search.rules.bookList || '(空)'}`)

  let hits: OnlineSearchHit[] = []
  if (norm.bookUrlPattern) {
    try {
      if (new RegExp(norm.bookUrlPattern).test(finalUrl)) {
        debugLog(logs, 'info', `bookUrlPattern「${norm.bookUrlPattern}」命中搜索地址 → 按详情页规则解析单本`)
        const hit = parseSearchAsDetail(res.text, norm, finalUrl)
        hits = hit ? [hit] : []
        debugLog(logs, hits.length ? 'ok' : 'warn', hits.length ? '详情页解析出 1 本书' : '详情页规则未解析出内容')
      } else {
        debugLog(logs, 'info', `bookUrlPattern「${norm.bookUrlPattern}」未命中（正常）`)
      }
    } catch (e: any) {
      debugLog(logs, 'warn', `bookUrlPattern 正则无效：${e?.message || e}`)
    }
  }
  if (hits.length === 0) {
    try {
      hits = useJson
        ? parseSearchJson(res.text, norm, sourceOrigin(source) || finalUrl)
        : parseSearchHtml(res.text, norm, finalUrl)
    } catch (e: any) {
      debugLog(logs, 'error', `列表解析抛出异常：${e?.message || e}`)
      return []
    }
    debugLog(logs, hits.length ? 'ok' : 'warn', `列表解析出 ${hits.length} 条结果`)
    if (hits.length === 0) {
      debugLog(logs, 'warn', '未解析出任何结果 —— 排查方向：')
      debugLog(logs, 'info', '  1. bookList 选择器/路径是否正确命中列表容器')
      debugLog(logs, 'info', '  2. 响应是否确实是搜索页内容（而非登录/验证码/跳转页）')
      debugLog(logs, 'info', '  3. 名称/地址子规则是否写错（会整条过滤）')
      return []
    }
  }
  const first = hits[0]
  debugLog(logs, 'ok', `示例结果：标题=${first.title || '(空)'}｜作者=${first.author || '(空)'}｜地址=${first.url || '(空)'}｜封面=${first.cover || '(空)'}｜最新章节=${first.newest || '(空)'}`)
  debugLog(logs, 'ok', `调试完成：共 ${hits.length} 条结果`)
  return hits
}

/** 调试目录：对给定 URL 走一遍目录解析 */
export async function debugTocSource(
  url: string,
  source: BookSource,
  cookieCtx?: CookieCtx,
  logs: DebugLog[] = []
): Promise<OnlineChapterItem[]> {
  debugLog(logs, 'info', `开始调试目录：${sourceDisplayName(source)}`)
  const norm = normalizeSource(source)
  if (!norm) {
    debugLog(logs, 'error', '书源规则解析失败（normalizeSource 返回空）')
    return []
  }
  if (!url.trim()) {
    debugLog(logs, 'error', '目录地址为空')
    return []
  }
  const finalUrl = splitUrlOptions(url).url
  debugLog(logs, 'info', `目录 URL：${url}`)
  const perCtx = norm.useCookieJar ? cookieCtx : undefined
  let res: { text: string }
  try {
    res = await requestWithResponse(url, norm.headers, 20000, perCtx)
  } catch (e: any) {
    debugLog(logs, 'error', `请求失败：${e?.message || e}`)
    return []
  }
  debugLog(logs, 'ok', `请求成功：${res.text.length} 字符`)
  const useJson = norm.type === 'json' || (norm.toc.chapterList || '').startsWith('$')
  debugLog(logs, 'info', `解析方式：${useJson ? 'JSON' : 'HTML'}；chapterList：${norm.toc.chapterList || '(空)'}`)
  let chapters: OnlineChapterItem[] = []
  try {
    chapters = useJson ? parseMenuJson(res.text, norm, finalUrl) : parseMenuHtml(res.text, norm, finalUrl)
  } catch (e: any) {
    debugLog(logs, 'error', `目录解析异常：${e?.message || e}`)
    return []
  }
  debugLog(logs, chapters.length ? 'ok' : 'warn', `解析出 ${chapters.length} 个章节`)
  chapters.slice(0, 3).forEach((c, i) => debugLog(logs, 'info', `  示例 ${i + 1}：${c.title} → ${c.url}`))
  if (chapters.length === 0) {
    debugLog(logs, 'warn', '未解析到章节 —— 排查 chapterList / chapterName / chapterUrl 规则，或确认地址是否为目录页')
  } else {
    debugLog(logs, 'ok', '调试完成')
  }
  return chapters
}

/** 调试正文：对给定章节 URL 走一遍正文解析 */
export async function debugContentSource(
  url: string,
  source: BookSource,
  cookieCtx?: CookieCtx,
  logs: DebugLog[] = []
): Promise<string> {
  debugLog(logs, 'info', `开始调试正文：${sourceDisplayName(source)}`)
  const norm = normalizeSource(source)
  if (!norm) {
    debugLog(logs, 'error', '书源规则解析失败（normalizeSource 返回空）')
    return ''
  }
  if (!url.trim()) {
    debugLog(logs, 'error', '正文地址为空')
    return ''
  }
  const finalUrl = splitUrlOptions(url).url
  debugLog(logs, 'info', `正文 URL：${url}`)
  const perCtx = norm.useCookieJar ? cookieCtx : undefined
  let res: { text: string }
  try {
    res = await requestWithResponse(url, norm.headers, 20000, perCtx)
  } catch (e: any) {
    debugLog(logs, 'error', `请求失败：${e?.message || e}`)
    return ''
  }
  debugLog(logs, 'ok', `请求成功：${res.text.length} 字符`)
  const useJson = norm.type === 'json' || (norm.content.content || '').startsWith('$')
  debugLog(logs, 'info', `解析方式：${useJson ? 'JSON' : 'HTML'}；content 规则：${norm.content.content || '(空，取整页文本)'}`)
  if (norm.content.replaceRegex) {
    debugLog(logs, 'info', `正文替换规则 replaceRegex：${norm.content.replaceRegex}`)
  }
  let text = ''
  try {
    text = useJson ? parseContentJson(res.text, norm) : parseContentHtml(res.text, norm, finalUrl)
  } catch (e: any) {
    debugLog(logs, 'error', `正文解析异常：${e?.message || e}`)
    return ''
  }
  debugLog(logs, text ? 'ok' : 'warn', `解析出正文 ${text.length} 字符`)
  debugLog(logs, 'info', `正文预览：${textPreview(text, 120) || '(空正文)'}`)
  if (!text) {
    debugLog(logs, 'warn', '正文为空 —— 排查 content 选择器、正文是否在 iframe、或需要 Cookie')
  } else {
    debugLog(logs, 'ok', '调试完成')
  }
  return text
}

// ---------- 封面下载 ----------

export async function downloadCoverToDataUrl(url: string, headers?: Record<string, string>): Promise<string | null> {
  try {
    const buffer = await services().httpGetBuffer(url, { timeout: 15000, headers: headers || {} })
    const mime = sniffImageMime(buffer)
    const blob = new Blob([buffer], { type: mime })
    return await new Promise<string>((resolve) => {
      const reader = new FileReader()
      reader.onload = () => resolve(reader.result as string)
      reader.onerror = () => resolve('')
      reader.readAsDataURL(blob)
    })
  } catch {
    return null
  }
}

function sniffImageMime(buf: Uint8Array): string {
  if (buf.length >= 4 && buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) return 'image/png'
  if (buf.length >= 2 && buf[0] === 0xff && buf[1] === 0xd8) return 'image/jpeg'
  if (buf.length >= 3 && buf[0] === 0x47 && buf[1] === 0x49 && buf[2] === 0x46) return 'image/gif'
  if (buf.length >= 12 && buf[0] === 0x52 && buf[1] === 0x49 && buf[2] === 0x46 && buf[3] === 0x46) return 'image/webp'
  if (buf.length >= 2 && buf[0] === 0x42 && buf[1] === 0x4d) return 'image/bmp'
  return 'image/jpeg'
}

// 兼容旧导入：保留规则链拆分导出（部分旧代码引用）
export { splitRuleChain, parseRuleExpression }
