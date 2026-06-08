export type BookSourceRuleSet = Record<string, unknown>

export type BookSourceConfig = {
  id: string
  name: string
  url: string
  loginUrl: string
  searchUrl: string
  bookUrlPattern: string
  enabled: boolean
  enabledCookieJar: boolean
  ruleSearch: BookSourceRuleSet
  ruleBookInfo: BookSourceRuleSet
  ruleToc: BookSourceRuleSet
  ruleContent: BookSourceRuleSet
  raw: Record<string, unknown>
}

export type SourceSearchResult = {
  key: string
  sourceId: string
  sourceName: string
  title: string
  author: string
  intro: string
  bookUrl: string
  coverUrl: string
  latestChapter: string
}

export type SourceChapter = {
  title: string
  url: string
  index: number
}

export type LoadedOnlineBook = {
  book: SourceSearchResult
  content: string
  chapters: SourceChapter[]
}

export type LoadedOnlineBookDetail = {
  book: SourceSearchResult
  chapters: SourceChapter[]
}

export type SourceRequest = {
  url: string
  method?: string
  headers?: Record<string, string>
  body?: string
  sourceId?: string
  sourceName?: string
  sourceUrl?: string
  enabledCookieJar?: boolean
  responseUrl?: string
}

export type SourceFetch = (request: SourceRequest) => Promise<string>

export type SourceVerificationOptions = {
  mode?: 'image' | 'browser'
  title?: string
  waitForResult?: boolean
  refetchAfterSuccess?: boolean
}

export type SourceVerificationHandler = (
  request: SourceRequest,
  source: BookSourceConfig,
  options?: SourceVerificationOptions
) => Promise<string>

export class SourceVerificationError extends Error {
  readonly sourceId: string
  readonly sourceName: string
  readonly url: string
  readonly request?: SourceRequest
  readonly options?: SourceVerificationOptions

  constructor(source: BookSourceConfig, url: string, request?: SourceRequest, options?: SourceVerificationOptions) {
    super(`书源「${source.name}」需要先完成验证码或访问验证`)
    this.name = 'SourceVerificationError'
    this.sourceId = source.id
    this.sourceName = source.name
    this.url = url
    this.request = request
    this.options = options
  }
}

export function isSourceVerificationError(error: unknown): error is SourceVerificationError {
  return error instanceof SourceVerificationError || (isRecord(error) && error.name === 'SourceVerificationError')
}

type ParsedContent =
  | {
      kind: 'json'
      raw: string
      data: unknown
    }
  | {
      kind: 'html'
      raw: string
      document: Document
    }
  | {
      kind: 'text'
      raw: string
    }

type RuleMode = 'default' | 'json' | 'xpath' | 'regex' | 'js' | 'put' | 'get'

type ParsedRule = {
  mode: RuleMode
  rule: string
  replaceRegex: string
  replacement: string
  replaceFirst: boolean
  restRules: string[]
}

type UrlBuildContext = {
  source?: BookSourceConfig
  keyword?: string
  page?: number
  baseUrl?: string
  currentRequestUrl?: string
  fetchText?: SourceFetch
  getVerificationCode?: SourceVerificationHandler
  variables?: Record<string, string>
  appendKeywordToGet?: boolean
}

type BookDetail = {
  title: string
  author: string
  intro: string
  coverUrl: string
  latestChapter: string
  tocUrl: string
  requestUrl: string
  tocHtml: ParsedContent | null
  detailRoot: ParsedContent
}

type AnalyzeRuntime = UrlBuildContext & {
  source?: BookSourceConfig
  fetchText?: SourceFetch
}

type JsoupElement = {
  raw: Element
  attr: (name: string, value?: string) => string | JsoupElement
  text: () => string
  html: () => string
  outerHtml: () => string
  select: (selector: string) => JsoupSelection
  toString: () => string
}

type JsoupSelection = {
  length: number
  [index: number]: JsoupElement
  [Symbol.iterator]: () => Iterator<JsoupElement>
  attr: (name: string, value?: string) => string | JsoupSelection
  text: () => string
  html: () => string
  outerHtml: () => string
  select: (selector: string) => JsoupSelection
  toString: () => string
}

type JsRuntimeEnv = Record<string, any>

const MAX_SEARCH_RESULTS = 80
const MAX_TOC_PAGES = 20
const MAX_CONTENT_PAGES = 20
const EMPTY_RULES: BookSourceRuleSet = {}
const URL_OPTION_PATTERN = /\s*,\s*(?=\{)/
const JS_CONTENT_OVERRIDE_KEY = '__deepreadContentOverride'
let gbkEncodeMap: Map<string, number[]> | null = null

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isElement(value: unknown): value is Element {
  return typeof Element !== 'undefined' && value instanceof Element
}

function isDocument(value: unknown): value is Document {
  return typeof Document !== 'undefined' && value instanceof Document
}

function isParsedContent(value: unknown): value is ParsedContent {
  return isRecord(value) && typeof value.kind === 'string' && typeof value.raw === 'string'
}

function toCleanString(value: unknown) {
  if (value === undefined || value === null) return ''
  return String(value).replace(/\s+/g, ' ').trim()
}

function toSourceString(value: unknown) {
  if (value === undefined || value === null) return ''
  return String(value)
}

function toRawString(value: unknown) {
  if (value === undefined || value === null) return ''
  if (isParsedContent(value)) return value.raw
  if (isDocument(value)) return value.documentElement?.outerHTML || ''
  if (isElement(value)) return value.outerHTML
  if (Array.isArray(value)) return value.map((item) => (Array.isArray(item) ? item.join('') : String(item))).join('')
  if (typeof value === 'object') {
    try {
      return JSON.stringify(value)
    } catch (error) {
      return String(value)
    }
  }
  return String(value)
}

function toRuleSet(value: unknown): BookSourceRuleSet {
  if (isRecord(value)) return value
  if (typeof value !== 'string' || !value.trim()) return EMPTY_RULES

  try {
    const parsed = JSON.parse(value)
    return isRecord(parsed) ? parsed : EMPTY_RULES
  } catch (error) {
    return EMPTY_RULES
  }
}

function safeBase64(value: string) {
  try {
    return btoa(unescape(encodeURIComponent(value))).replace(/=+$/g, '')
  } catch (error) {
    let hash = 0
    for (let index = 0; index < value.length; index += 1) {
      hash = value.charCodeAt(index) + ((hash << 5) - hash)
    }
    return Math.abs(hash).toString(36)
  }
}

function getSourceId(raw: Record<string, unknown>, name: string, url: string) {
  const explicitId = toCleanString(raw.id || raw.bookSourceId || raw.sourceId)
  if (explicitId) return explicitId
  return `source:${safeBase64(`${name}|${url}`).slice(0, 32)}`
}

export function parseBookSources(input: string): BookSourceConfig[] {
  const trimmed = input.trim()
  if (!trimmed) return []

  let parsed: unknown
  try {
    parsed = JSON.parse(trimmed)
  } catch (error) {
    throw new Error('书源 JSON 解析失败，请检查格式')
  }

  const sources = normalizeBookSources(extractSourceItems(parsed))
  if (!sources.length) throw new Error('没有识别到可用书源，需要包含 searchUrl')
  return sources
}

export function normalizeBookSources(input: unknown): BookSourceConfig[] {
  const items = extractSourceItems(input)
  const seen = new Set<string>()
  const sources: BookSourceConfig[] = []

  for (const item of items) {
    const source = normalizeBookSource(item)
    if (!source || seen.has(source.id)) continue
    seen.add(source.id)
    sources.push(source)
  }

  return sources
}

function extractSourceItems(input: unknown): unknown[] {
  if (Array.isArray(input)) return input
  if (!isRecord(input)) return []

  for (const key of ['data', 'sources', 'bookSources', 'bookSourceList', 'list', 'items']) {
    const value = input[key]
    if (Array.isArray(value)) return value
  }

  return [input]
}

function normalizeBookSource(input: unknown): BookSourceConfig | null {
  if (!isRecord(input)) return null

  const raw = unwrapSourceRaw(input)
  const name =
    toCleanString(input.bookSourceName) ||
    toCleanString(input.sourceName) ||
    toCleanString(input.name) ||
    '未命名书源'
  const url = toCleanString(input.bookSourceUrl || input.sourceUrl || input.url)
  const loginUrl = toSourceString(input.loginUrl).trim()
  const ruleSearch = toRuleSet(input.ruleSearch)
  const searchUrl = toSourceString(input.searchUrl).trim() || toSourceString(ruleSearch.searchUrl).trim()

  if (!searchUrl) return null

  return {
    id: getSourceId(input, name, url || searchUrl),
    name,
    url,
    loginUrl,
    searchUrl,
    bookUrlPattern: toSourceString(input.bookUrlPattern).trim(),
    enabled: input.enabled === undefined ? true : input.enabled !== false,
    enabledCookieJar: input.enabledCookieJar === undefined ? true : input.enabledCookieJar !== false,
    ruleSearch,
    ruleBookInfo: toRuleSet(input.ruleBookInfo),
    ruleToc: toRuleSet(input.ruleToc),
    ruleContent: toRuleSet(input.ruleContent),
    raw
  }
}

function unwrapSourceRaw(input: Record<string, unknown>): Record<string, unknown> {
  const nested = input.raw
  if (isRecord(nested) && (typeof nested.searchUrl === 'string' || typeof nested.bookSourceUrl === 'string')) {
    return unwrapSourceRaw(nested)
  }

  const { raw, ...withoutNestedRaw } = input
  return withoutNestedRaw
}

export async function searchSourceBooks(
  source: BookSourceConfig,
  keyword: string,
  fetchText: SourceFetch,
  getVerificationCode?: SourceVerificationHandler
) {
  const query = keyword.trim()
  if (!query) return []

  const variables: Record<string, string> = {}
  const { request, baseUrl } = await buildSourceRequest(source.searchUrl, {
    source,
    keyword: query,
    page: 1,
    baseUrl: source.url,
    fetchText,
    getVerificationCode,
    variables
  })
  let text = ''
  try {
    text = await fetchText(request)
  } catch (error) {
    if (looksLikeVerificationError(error)) throw new SourceVerificationError(source, request.url, request)
    throw error
  }
  const root = parseContent(text)
  const responseUrl = request.responseUrl || request.url
  const currentRequestUrl = serializeSourceRequest(request)
  const pageUrl = responseUrl || request.url || baseUrl
  const analyzer = new LegadoAnalyzer(root, pageUrl, pageUrl, {
    source,
    keyword: query,
    page: 1,
    baseUrl: pageUrl,
    currentRequestUrl,
    fetchText,
    getVerificationCode,
    variables
  })
  if (isBookDetailUrl(source, pageUrl)) {
    const detailResult = await analyzeBookDetailAsSearchResult(source, analyzer, pageUrl)
    if (detailResult) return [detailResult]
  }

  const results = await analyzeSearchBookList(source, analyzer, pageUrl)

  return dedupeResults(results).slice(0, MAX_SEARCH_RESULTS)
}

export async function loadOnlineBook(
  source: BookSourceConfig,
  result: SourceSearchResult,
  fetchText: SourceFetch,
  onProgress?: (finished: number, total: number, title: string) => void,
  getVerificationCode?: SourceVerificationHandler
): Promise<LoadedOnlineBook> {
  const detail = await loadBookDetail(source, result, fetchText, getVerificationCode)
  const loadedBook = mergeSearchResultWithDetail(result, detail)
  const chapters = await loadChapterCatalog(source, result.bookUrl, detail, fetchText, getVerificationCode)
  if (!chapters.length) {
    const content = await extractContent(detail.detailRoot, source.ruleContent, result.bookUrl, undefined, {
      source,
      fetchText,
      getVerificationCode,
      baseUrl: detail.requestUrl || result.bookUrl,
      currentRequestUrl: detail.requestUrl,
      variables: {}
    })
    if (content) {
      return {
        book: loadedBook,
        content: buildChapterContent(loadedBook.title, content),
        chapters: [{ title: loadedBook.title, url: loadedBook.bookUrl, index: 0 }]
      }
    }

    throw new Error('没有解析到目录或正文，请检查书源规则')
  }

  const firstChapter = chapters[0]
  onProgress?.(0, chapters.length, firstChapter.title)

  return {
    book: loadedBook,
    content: await loadOnlineChapter(source, firstChapter, fetchText, getVerificationCode),
    chapters
  }
}

export async function loadOnlineBookDetail(
  source: BookSourceConfig,
  result: SourceSearchResult,
  fetchText: SourceFetch,
  getVerificationCode?: SourceVerificationHandler
): Promise<LoadedOnlineBookDetail> {
  const detail = await loadBookDetail(source, result, fetchText, getVerificationCode)

  return {
    book: mergeSearchResultWithDetail(result, detail),
    chapters: await loadChapterCatalog(source, result.bookUrl, detail, fetchText, getVerificationCode)
  }
}

export async function loadOnlineChapter(
  source: BookSourceConfig,
  chapter: SourceChapter,
  fetchText: SourceFetch,
  getVerificationCode?: SourceVerificationHandler
) {
  const content = await collectChapterContent(source, chapter, fetchText, getVerificationCode)
  if (!content) throw new Error('章节正文为空，请检查正文规则')
  return buildChapterContent(chapter.title, content)
}

async function analyzeSearchBookList(source: BookSourceConfig, analyzer: LegadoAnalyzer, baseUrl: string) {
  const ruleSearch = source.ruleSearch
  const bookListRule = getRule(ruleSearch, 'bookList', 'list', 'books')
  const normalizedListRule = parseListRulePrefix(bookListRule)
  const hasListRule = Boolean(normalizedListRule.rule)
  let elements: unknown[] = []
  if (normalizedListRule.rule) {
    try {
      elements = await analyzer.getElementsAsync(normalizedListRule.rule)
    } catch (error) {
      const challengeText = toRawString(analyzer.getLastRuleInputContent()) || toRawString(analyzer.content)
      if (!isSourceVerificationError(error) && looksLikeDeferredChallengePage(challengeText)) {
        const mode = sourceRuleUsesImageVerification(normalizedListRule.rule) ? 'image' : 'browser'
        const request = await createDeferredVerificationRequest(source, normalizedListRule.rule, baseUrl, mode)
        throw new SourceVerificationError(
          source,
          request.url,
          request,
          { mode }
        )
      }
      throw error
    }
  }
  const candidates = elements.length ? elements : hasListRule ? [] : getFallbackSearchItems(analyzer.content)
  const results: SourceSearchResult[] = []

  if (!candidates.length && !hasListRule && hasAnyRule(ruleSearch, ['name', 'title', 'bookName'])) {
    const detailResult =
      (await analyzeSearchItem(source, analyzer, analyzer.content, baseUrl, normalizedListRule.allInOne)) ||
      (await analyzeBookDetailAsSearchResult(source, analyzer, baseUrl))
    if (detailResult) results.push(detailResult)
    return results
  }

  for (const item of candidates) {
    const result = await analyzeSearchItem(source, analyzer, item, baseUrl, normalizedListRule.allInOne)
    if (result) results.push(result)
    if (results.length >= MAX_SEARCH_RESULTS) break
  }

  if (normalizedListRule.reverse) results.reverse()
  return results
}

async function analyzeSearchItem(
  source: BookSourceConfig,
  rootAnalyzer: LegadoAnalyzer,
  item: unknown,
  baseUrl: string,
  allInOne = false
): Promise<SourceSearchResult | null> {
  const ruleSearch = source.ruleSearch
  const analyzer = rootAnalyzer.withContent(item, baseUrl)
  const title =
    formatBookName(await getRuleValueForSearchItem(analyzer, item, getRule(ruleSearch, 'name', 'title', 'bookName'), allInOne)) ||
    getFallbackTitle(item)
  const bookUrl =
    (await getRuleValueForSearchItem(
      analyzer,
      item,
      getRule(ruleSearch, 'bookUrl', 'bookInfoUrl', 'detailUrl', 'detail', 'url', 'href'),
      allInOne,
      true
    )) || resolveRuleUrl(baseUrl, getFallbackUrl(item))

  if (!title || !bookUrl) return null

  const coverUrl =
    (await getOptionalRuleValueForSearchItem(
      analyzer,
      item,
      getRule(ruleSearch, 'coverUrl', 'cover', 'image'),
      allInOne,
      true
    )) || resolveRuleUrl(baseUrl, getFallbackField(item, ['coverUrl', 'cover', 'image', 'img', 'src']))

  return {
    key: `${source.id}:${bookUrl}`,
    sourceId: source.id,
    sourceName: source.name,
    title,
    author:
      formatBookAuthor(
        await getOptionalRuleValueForSearchItem(analyzer, item, getRule(ruleSearch, 'author', 'authorName'), allInOne)
      ) ||
      getFallbackField(item, ['author', 'writer']),
    intro:
      tidyBriefText(
        await getOptionalRuleValueForSearchItem(analyzer, item, getRule(ruleSearch, 'intro', 'desc', 'description'), allInOne)
      ) ||
      getFallbackField(item, ['intro', 'desc', 'summary']),
    bookUrl,
    coverUrl,
    latestChapter:
      (await getOptionalRuleValueForSearchItem(
        analyzer,
        item,
        getRule(ruleSearch, 'lastChapter', 'latestChapter', 'lastChapterName'),
        allInOne
      )) ||
      getFallbackField(item, ['lastChapter', 'latestChapter'])
  }
}

async function getRuleValueForSearchItem(
  analyzer: LegadoAnalyzer,
  item: unknown,
  rule: string,
  allInOne: boolean,
  isUrl = false
) {
  if (!rule) return ''
  if (!allInOne) return await analyzer.getStringAsync(rule, { isUrl })
  const value = readAllInOneField(item, rule)
  if (!isUrl) return value
  return value ? resolveRuleUrl(analyzer.redirectBaseUrl, value) : ''
}

async function getOptionalRuleValueForSearchItem(
  analyzer: LegadoAnalyzer,
  item: unknown,
  rule: string,
  allInOne: boolean,
  isUrl = false
) {
  try {
    return await getRuleValueForSearchItem(analyzer, item, rule, allInOne, isUrl)
  } catch (error) {
    if (isSourceVerificationError(error)) throw error
    return ''
  }
}

function readAllInOneField(item: unknown, rule: string) {
  if (!rule) return ''
  const direct = getObjectPathValue(item, rule)
  if (direct !== undefined && direct !== null) return valueToString(direct)
  return getFallbackField(item, [rule])
}

async function analyzeBookDetailAsSearchResult(
  source: BookSourceConfig,
  analyzer: LegadoAnalyzer,
  baseUrl: string
): Promise<SourceSearchResult | null> {
  const detailAnalyzer = await applyRuleInit(analyzer, getRule(source.ruleBookInfo, 'init'))
  const title = formatBookName(await detailAnalyzer.getStringAsync(getRule(source.ruleBookInfo, 'name', 'title', 'bookName')))
  if (!title) return null

  return {
    key: `${source.id}:${baseUrl}`,
    sourceId: source.id,
    sourceName: source.name,
    title,
    author: formatBookAuthor(await detailAnalyzer.getStringAsync(getRule(source.ruleBookInfo, 'author', 'authorName'))),
    intro: tidyBriefText(await detailAnalyzer.getStringAsync(getRule(source.ruleBookInfo, 'intro', 'desc', 'description'))),
    bookUrl: baseUrl,
    coverUrl: await detailAnalyzer.getStringAsync(getRule(source.ruleBookInfo, 'coverUrl', 'cover', 'image'), { isUrl: true }),
    latestChapter: await detailAnalyzer.getStringAsync(getRule(source.ruleBookInfo, 'lastChapter', 'latestChapter', 'lastChapterName'))
  }
}

async function loadBookDetail(
  source: BookSourceConfig,
  result: SourceSearchResult,
  fetchText: SourceFetch,
  getVerificationCode?: SourceVerificationHandler
): Promise<BookDetail> {
  const variables: Record<string, string> = {}
  const { request, baseUrl } = await buildSourceRequest(result.bookUrl, {
    source,
    baseUrl: source.url || result.bookUrl,
    fetchText,
    getVerificationCode,
    variables
  })
  const text = await fetchText(request)
  const detailRoot = parseContent(text)
  const responseUrl = request.responseUrl || request.url
  const currentRequestUrl = serializeSourceRequest(request)
  const pageUrl = responseUrl || request.url || result.bookUrl
  const runtime = {
    source,
    fetchText,
    getVerificationCode,
    baseUrl: stripUrlOptions(result.bookUrl) || pageUrl || baseUrl,
    currentRequestUrl,
    variables
  }
  let analyzer = new LegadoAnalyzer(detailRoot, stripUrlOptions(result.bookUrl) || pageUrl || baseUrl, pageUrl, runtime)
  const infoRule = source.ruleBookInfo
  const initRule = getRule(infoRule, 'init')

  analyzer = await applyRuleInit(analyzer, initRule)

  const tocUrl =
    (await analyzer.getStringAsync(getRule(infoRule, 'tocUrl', 'chapterUrl', 'catalogUrl', 'toc'), { isUrl: true })) ||
    result.bookUrl

  return {
    title: formatBookName(await analyzer.getStringAsync(getRule(infoRule, 'name'))) || result.title,
    author: formatBookAuthor(await analyzer.getStringAsync(getRule(infoRule, 'author'))) || result.author,
    intro: tidyBriefText(await analyzer.getStringAsync(getRule(infoRule, 'intro'))) || result.intro,
    coverUrl: (await analyzer.getStringAsync(getRule(infoRule, 'coverUrl'), { isUrl: true })) || result.coverUrl,
    latestChapter: (await analyzer.getStringAsync(getRule(infoRule, 'lastChapter'))) || result.latestChapter,
    tocUrl,
    requestUrl: pageUrl,
    tocHtml: isSameUrlIgnoringOptions(tocUrl, result.bookUrl) ? detailRoot : null,
    detailRoot
  }
}

function mergeSearchResultWithDetail(result: SourceSearchResult, detail: BookDetail): SourceSearchResult {
  const title = detail.title || result.title
  const bookUrl = result.bookUrl

  return {
    ...result,
    key: `${result.sourceId}:${bookUrl}`,
    title,
    author: detail.author || result.author,
    intro: detail.intro || result.intro,
    bookUrl,
    coverUrl: detail.coverUrl || result.coverUrl,
    latestChapter: detail.latestChapter || result.latestChapter
  }
}

async function loadChapterCatalog(
  source: BookSourceConfig,
  bookUrl: string,
  detail: BookDetail,
  fetchText: SourceFetch,
  getVerificationCode?: SourceVerificationHandler
) {
  const tocStartUrl = detail.tocUrl || bookUrl
  let tocRoot = detail.tocHtml
  let tocRequestUrl = detail.tocHtml ? detail.requestUrl : ''

  if (!tocRoot) {
    const tocRequest = await buildSourceRequest(detail.tocUrl, {
      source,
      baseUrl: bookUrl,
      fetchText,
      getVerificationCode,
      variables: {}
    })
    const response = await fetchText(tocRequest.request)
    tocRoot = parseContent(response)
    tocRequestUrl = tocRequest.request.responseUrl || tocRequest.request.url || detail.tocUrl
  }

  const chapters = await collectTocChapters(
    source,
    bookUrl,
    tocStartUrl,
    tocRoot,
    fetchText,
    tocRequestUrl,
    getVerificationCode
  )

  return dedupeChapters(chapters).map((chapter, index) => ({ ...chapter, index }))
}

async function collectTocChapters(
  source: BookSourceConfig,
  bookUrl: string,
  startUrl: string,
  startRoot: ParsedContent,
  fetchText: SourceFetch,
  startRequestUrl = '',
  getVerificationCode?: SourceVerificationHandler
) {
  const tocRules = source.ruleToc
  const listRule = parseListRulePrefix(getRule(tocRules, 'chapterList', 'list', 'chapters'))
  const chapters: SourceChapter[] = []
  const visited = new Set<string>()
  let currentUrl = startUrl || bookUrl
  let currentRequestUrl = startRequestUrl || currentUrl
  let root: ParsedContent = startRoot

  for (let page = 0; page < MAX_TOC_PAGES; page += 1) {
    const visitKey = normalizeUrlForVisit(currentUrl)
    if (visited.has(visitKey)) break
    visited.add(visitKey)

    const pageUrl = currentRequestUrl || currentUrl || bookUrl
    const analyzer = new LegadoAnalyzer(root, currentUrl || pageUrl || bookUrl, pageUrl, {
      source,
      fetchText,
      getVerificationCode,
      baseUrl: currentUrl || pageUrl || bookUrl,
      currentRequestUrl,
      variables: {}
    })
    chapters.push(...extractTocChapters(analyzer, tocRules, listRule.rule, currentUrl || bookUrl))

    const nextUrls = await analyzer.getStringListAsync(getRule(tocRules, 'nextTocUrl', 'nextUrl', 'nextPageUrl'), {
      isUrl: true
    })
    const nextUrl = nextUrls.find((url) => url && !visited.has(normalizeUrlForVisit(url)))
    if (!nextUrl) break

    const nextRequest = await buildSourceRequest(nextUrl, {
      source,
      baseUrl: currentUrl,
      fetchText,
      getVerificationCode,
      variables: {}
    })
    const response = await fetchText(nextRequest.request)
    currentUrl = nextRequest.request.responseUrl || nextRequest.request.url || nextUrl
    currentRequestUrl = currentUrl
    root = parseContent(response)
  }

  if (listRule.reverse) chapters.reverse()
  return chapters
}

function extractTocChapters(
  analyzer: LegadoAnalyzer,
  tocRules: BookSourceRuleSet,
  chapterListRule: string,
  baseUrl: string
) {
  const elements = chapterListRule ? analyzer.getElements(chapterListRule) : []
  const candidates = elements.length ? elements : getFallbackChapterItems(analyzer.content)

  return candidates
    .map((item, index) => {
      const itemAnalyzer = analyzer.withContent(item, baseUrl)
      const title =
        itemAnalyzer.getString(getRule(tocRules, 'chapterName', 'name', 'title')) ||
        getFallbackTitle(item) ||
        `第 ${index + 1} 章`
      const url =
        itemAnalyzer.getString(getRule(tocRules, 'chapterUrl', 'url', 'href'), { isUrl: true }) ||
        resolveRuleUrl(baseUrl, getFallbackUrl(item)) ||
        baseUrl

      return title ? { title: toCleanString(title), url, index: 0 } : null
    })
    .filter((chapter): chapter is SourceChapter => Boolean(chapter))
}

async function collectChapterContent(
  source: BookSourceConfig,
  chapter: SourceChapter,
  fetchText: SourceFetch,
  getVerificationCode?: SourceVerificationHandler
) {
  const contentRule = source.ruleContent
  const rule = getRule(contentRule, 'content', 'text', 'body')
  if (!rule) return ''

  const contentParts: string[] = []
  const visited = new Set<string>()
  let currentUrl = chapter.url
  const variables: Record<string, string> = {}

  for (let page = 0; page < MAX_CONTENT_PAGES; page += 1) {
    const visitKey = normalizeUrlForVisit(currentUrl)
    if (visited.has(visitKey)) break
    visited.add(visitKey)

    const { request } = await buildSourceRequest(currentUrl, {
      source,
      baseUrl: chapter.url,
      fetchText,
      getVerificationCode,
      variables
    })
    const root = parseContent(await fetchText(request))
    const responseUrl = request.responseUrl || request.url
    const currentRequestUrl = serializeSourceRequest(request)
    const pageUrl = responseUrl || request.url || currentUrl
    const analyzer = new LegadoAnalyzer(root, currentUrl || pageUrl, pageUrl, {
      source,
      fetchText,
      getVerificationCode,
      baseUrl: currentUrl || pageUrl,
      currentRequestUrl,
      variables
    })
    const content = await extractContent(root, contentRule, responseUrl, analyzer, {
      source,
      fetchText,
      getVerificationCode,
      baseUrl: currentUrl || pageUrl,
      currentRequestUrl,
      variables
    })
    if (content) contentParts.push(content)

    const nextUrls = await analyzer.getStringListAsync(getRule(contentRule, 'nextContentUrl', 'nextUrl', 'nextPageUrl'), {
      isUrl: true
    })
    const nextUrl = nextUrls.find((url) => url && !visited.has(normalizeUrlForVisit(url)))
    if (!nextUrl) break
    currentUrl = nextUrl
  }

  return applyContentReplaceRule(contentParts.join('\n'), getRule(contentRule, 'replaceRegex'))
}

async function extractContent(
  root: ParsedContent,
  rules: BookSourceRuleSet,
  baseUrl: string,
  existingAnalyzer?: LegadoAnalyzer,
  runtime?: AnalyzeRuntime
) {
  const analyzer = existingAnalyzer ?? new LegadoAnalyzer(root, baseUrl, baseUrl, runtime)
  const rule = getRule(rules, 'content', 'text', 'body')
  const rawContent = await analyzer.getStringAsync(rule, { unescape: false })
  if (rawContent) return tidyNovelContent(formatHtmlText(rawContent, baseUrl))

  const fallback = getFallbackContent(root)
  return tidyNovelContent(formatHtmlText(fallback, baseUrl))
}

function buildChapterContent(title: string, content: string) {
  return [title, '', content].join('\n').trim()
}

async function buildSourceRequest(ruleUrl: string, context: UrlBuildContext): Promise<{ request: SourceRequest; baseUrl: string }> {
  const source = context.source
  const keyword = context.keyword ?? ''
  const page = context.page ?? 1
  const baseUrl = stripUrlOptions(context.baseUrl || source?.url || '')
  const hasKeywordPlaceholder = hasSearchKeywordPlaceholder(ruleUrl)
  const sourceHeaders = parseHeaders(source?.raw.header)
  let rule = await resolveDynamicUrlRule(ruleUrl, {
    ...context,
    baseUrl,
    keyword,
    page
  })
  rule = replaceUrlPlaceholders(rule, {
    ...context,
    baseUrl,
    keyword,
    page
  })
  let options: Record<string, unknown> = {}
  const split = splitUrlOptions(rule)

  if (split.optionsText) {
    rule = split.url
    options = parseLooseJsonObject(split.optionsText)
  }

  const resolvedUrl = resolveUrl(baseUrl, rule)
  const method = (toCleanString(options.method).toUpperCase() || (options.body !== undefined ? 'POST' : 'GET')) as
    | 'GET'
    | 'POST'
    | string
  const optionHeaders = parseHeaders(options.headers ?? options.header)
  const headers = {
    ...sourceHeaders,
    ...optionHeaders
  }
  delete headers.proxy

  let body = normalizeBody(options.body)
  if (body) {
    body = replaceUrlPlaceholders(body, {
      ...context,
      baseUrl,
      keyword,
      page
    })
  }
  applyDefaultRequestHeaders(headers, method, body)

  const request: SourceRequest = {
    url:
      method === 'GET'
        ? normalizeGetUrl(resolvedUrl, keyword, hasKeywordPlaceholder, context.appendKeywordToGet !== false)
        : resolvedUrl,
    method,
    headers: Object.keys(headers).length ? headers : undefined,
    body: method === 'GET' ? undefined : encodeRequestBody(body, headers, toCleanString(options.charset)),
    sourceId: source?.id,
    sourceName: source?.name,
    sourceUrl: source?.url || baseUrl || resolvedUrl,
    enabledCookieJar: source?.enabledCookieJar !== false
  }

  return {
    request,
    baseUrl: request.url
  }
}

function applyDefaultRequestHeaders(headers: Record<string, string>, method: string, body: string | undefined) {
  if (method !== 'POST' || !body) return
  if (Object.keys(headers).some((key) => key.toLowerCase() === 'content-type')) return
  if (isJsonLike(body)) {
    headers['Content-Type'] = 'application/json; charset=UTF-8'
    return
  }
  if (body.trim().startsWith('<')) {
    headers['Content-Type'] = 'text/xml; charset=UTF-8'
    return
  }
  headers['Content-Type'] = 'application/x-www-form-urlencoded'
}

function hasSearchKeywordPlaceholder(value: string) {
  return /\{\{\s*(key|keyword|searchKey)\s*\}\}|<searchKey>|\{searchKey\}|\{key\}|\{keyword\}/i.test(value)
}

function replaceUrlPlaceholders(value: string, context: UrlBuildContext) {
  const keyword = context.keyword ?? ''
  const page = context.page ?? 1
  let result = value

  result = result.replace(/\{\{([\s\S]*?)\}\}/g, (_match, code: string) => {
    const expression = code.trim()
    if (/^(key|keyword|searchKey)$/i.test(expression)) return keyword
    if (/^page$/i.test(expression)) return String(page)
    return toCleanString(evaluateJs(expression, undefined, context))
  })

  result = result.replace(/<searchKey>|\{searchKey\}|\{key\}|\{keyword\}/gi, keyword)

  result = result.replace(/<([^<>]+)>/g, (match, pages: string) => {
    const choices = pages.split(',').map((item) => item.trim())
    if (!choices.length) return match
    return choices[Math.min(Math.max(1, page), choices.length) - 1] || choices.at(-1) || ''
  })

  return result
}

function splitUrlOptions(value: string) {
  const match = URL_OPTION_PATTERN.exec(value)
  if (!match) return { url: value.trim(), optionsText: '' }
  return {
    url: value.slice(0, match.index).trim(),
    optionsText: value.slice(match.index + match[0].length).trim()
  }
}

function stripUrlOptions(value: string) {
  return splitUrlOptions(value).url
}

function parseLooseJsonObject(value: string) {
  try {
    const parsed = JSON.parse(value)
    return isRecord(parsed) ? parsed : {}
  } catch (error) {
    return {}
  }
}

function serializeSourceRequest(request: SourceRequest) {
  const options: Record<string, unknown> = {}
  const method = toCleanString(request.method).toUpperCase()

  if (method && method !== 'GET') options.method = method
  if (request.body !== undefined) options.body = request.body
  if (request.headers && Object.keys(request.headers).length) options.headers = request.headers

  return Object.keys(options).length ? `${request.url},${JSON.stringify(options)}` : request.url
}

function parseHeaders(value: unknown): Record<string, string> {
  if (!value) return {}
  if (typeof value === 'string') {
    const trimmed = value.trim()
    if (!trimmed) return {}
    try {
      return parseHeaders(JSON.parse(trimmed))
    } catch (error) {
      return trimmed.split(/\r?\n/).reduce<Record<string, string>>((headers, line) => {
        const index = line.indexOf(':')
        if (index > 0) headers[line.slice(0, index).trim()] = line.slice(index + 1).trim()
        return headers
      }, {})
    }
  }
  if (!isRecord(value)) return {}

  const headers: Record<string, string> = {}
  for (const [key, item] of Object.entries(value)) {
    if (item === undefined || item === null) continue
    headers[key] = String(item)
  }
  return headers
}

function normalizeBody(value: unknown) {
  if (value === undefined || value === null) return undefined
  if (typeof value === 'string') return value
  try {
    return JSON.stringify(value)
  } catch (error) {
    return String(value)
  }
}

function encodeRequestBody(body: string | undefined, headers: Record<string, string>, charset: string) {
  if (!body) return undefined
  const contentTypeKey = Object.keys(headers).find((key) => key.toLowerCase() === 'content-type')
  const contentType = contentTypeKey ? headers[contentTypeKey] : ''
  const normalizedCharset = (charset || getHeaderCharset(contentType)).toLowerCase()
  const isFormBody = !contentType || /application\/x-www-form-urlencoded/i.test(contentType)
  if (!isFormBody || isJsonLike(body) || body.trim().startsWith('<')) return body
  if (/%[0-9a-f]{2}/i.test(body)) return body
  if (normalizedCharset === 'escape') return encodeFormBody(body, escape)
  if (normalizedCharset === 'gbk' || normalizedCharset === 'gb2312' || normalizedCharset === 'gb18030') {
    return encodeFormBody(body, (value) => encodeFormValueByCharset(value, normalizedCharset))
  }
  return encodeFormBody(body, (value) => encodeFormValueByCharset(value, 'utf-8'))
}

function getHeaderCharset(contentType: string) {
  return contentType.match(/charset\s*=\s*([^;\s]+)/i)?.[1]?.trim() || ''
}

function encodeFormValueByCharset(value: string, charset = 'utf-8') {
  return encodeByCharset(value, charset).replace(/%20/g, '+')
}

function encodeFormBody(body: string, encoder: (value: string) => string) {
  return body
    .split('&')
    .map((pair) => {
      const index = pair.indexOf('=')
      if (index < 0) return encoder(pair)
      return `${encoder(pair.slice(0, index))}=${encoder(pair.slice(index + 1))}`
    })
    .join('&')
}

function encodeByCharset(value: string, charset = 'utf-8', preserveUriReserved = false) {
  const normalized = charset.toLowerCase()
  if (normalized !== 'gbk' && normalized !== 'gb2312' && normalized !== 'gb18030') {
    return preserveUriReserved ? encodeURI(value) : encodeURIComponent(value)
  }

  const map = getGbkEncodeMap()
  if (!map.size) return preserveUriReserved ? encodeURI(value) : encodeURIComponent(value)

  let encoded = ''
  for (const char of value) {
    if (isUriSafeChar(char, preserveUriReserved)) {
      encoded += char
      continue
    }

    const bytes = map.get(char) ?? Array.from(new TextEncoder().encode(char))
    encoded += bytes.map((byte) => `%${byte.toString(16).toUpperCase().padStart(2, '0')}`).join('')
  }
  return encoded
}

function getGbkEncodeMap() {
  if (gbkEncodeMap) return gbkEncodeMap
  gbkEncodeMap = new Map<string, number[]>()

  try {
    const decoder = new TextDecoder('gbk', { fatal: true })
    for (let lead = 0x81; lead <= 0xfe; lead += 1) {
      for (let trail = 0x40; trail <= 0xfe; trail += 1) {
        if (trail === 0x7f) continue
        try {
          const char = decoder.decode(new Uint8Array([lead, trail]))
          if (char && char !== '\uFFFD' && !gbkEncodeMap.has(char)) gbkEncodeMap.set(char, [lead, trail])
        } catch (error) {
          // Skip byte pairs that are not valid in this runtime's GBK table.
        }
      }
    }
  } catch (error) {
    gbkEncodeMap.clear()
  }

  return gbkEncodeMap
}

function isUriSafeChar(char: string, preserveUriReserved: boolean) {
  if (/^[A-Za-z0-9_.~-]$/.test(char)) return true
  return preserveUriReserved && /^[!#$&'()*+,/:;=?@[\]]$/.test(char)
}

function normalizeGetUrl(url: string, keyword: string, hasKeywordPlaceholder: boolean, appendKeyword: boolean) {
  try {
    const parsed = new URL(url)
    if (appendKeyword && keyword && !hasKeywordPlaceholder && !parsed.searchParams.size) {
      parsed.searchParams.set('key', keyword)
    }
    return parsed.toString()
  } catch (error) {
    return url
  }
}

async function resolveDynamicUrlRule(ruleUrl: string, context: UrlBuildContext) {
  const trimmed = ruleUrl.trim()
  if (/^@js:/i.test(trimmed)) {
    return valueToString(await evaluateJsAsync(trimmed.replace(/^@js:/i, ''), undefined, context)).trim()
  }

  const jsOnly = trimmed.match(/^<js>([\s\S]*)<\/js>$/i)
  if (jsOnly) return valueToString(await evaluateJsAsync(jsOnly[1], undefined, context)).trim()

  return trimmed
}

class LegadoAnalyzer {
  readonly content: unknown
  private readonly baseUrl: string
  private readonly redirectUrl: string
  private readonly runtime: AnalyzeRuntime
  private readonly variables: Record<string, string>
  private lastRuleInputContent: unknown

  constructor(content: unknown, baseUrl: string, redirectUrl?: string, runtime: AnalyzeRuntime = {}) {
    this.content = content
    this.baseUrl = baseUrl
    this.redirectUrl = redirectUrl || baseUrl
    this.runtime = { ...runtime, baseUrl: runtime.baseUrl || baseUrl }
    this.variables = this.runtime.variables ?? {}
    this.lastRuleInputContent = content
  }

  get redirectBaseUrl() {
    return this.redirectUrl || this.baseUrl
  }

  getLastRuleInputContent() {
    return this.lastRuleInputContent
  }

  withContent(content: unknown, baseUrl = this.baseUrl) {
    return new LegadoAnalyzer(content, baseUrl, this.redirectUrl, {
      ...this.runtime,
      baseUrl,
      variables: this.variables
    })
  }

  getElement(rule: string) {
    return this.getElements(rule)[0]
  }

  getElements(rule: string): unknown[] {
    if (!rule) return []
    let result: unknown = this.content
    const rules = splitSourceRules(rule, result, true)

    for (const rawRule of rules) {
      if (result === undefined || result === null) return []
      this.lastRuleInputContent = result
      const parsed = parseSourceRule(rawRule, result, true)
      if (parsed.mode === 'put') {
        this.applyPutRuleSync(parsed.rule, result)
        continue
      }
      if (parsed.mode === 'get') {
        result = this.variables[parsed.rule] ?? ''
        continue
      }
      result = this.evaluateElements(result, parsed)
      result = this.consumeContentOverride(result)
    }

    return Array.isArray(result) ? result.filter((item) => item !== undefined && item !== null) : []
  }

  async getElementsAsync(rule: string): Promise<unknown[]> {
    if (!rule) return []
    let result: unknown = this.content
    const rules = splitSourceRules(rule, result, true)

    for (const rawRule of rules) {
      if (result === undefined || result === null) return []
      this.lastRuleInputContent = result
      const parsed = parseSourceRule(rawRule, result, true)
      if (parsed.mode === 'put') {
        await this.applyPutRule(parsed.rule, result)
        continue
      }
      if (parsed.mode === 'get') {
        result = this.variables[parsed.rule] ?? ''
        continue
      }
      result = await this.evaluateElementsAsync(result, parsed)
      result = this.consumeContentOverride(result)
    }

    return Array.isArray(result) ? result.filter((item) => item !== undefined && item !== null) : []
  }

  getStringList(rule: string, options: { content?: unknown; isUrl?: boolean } = {}) {
    if (!rule) return []
    let result: unknown = options.content ?? this.content
    const rules = splitSourceRules(rule, result, false)

    for (const rawRule of rules) {
      if (result === undefined || result === null) return []
      const parsed = parseSourceRule(rawRule, result, false)
      if (parsed.mode === 'put') {
        this.applyPutRuleSync(parsed.rule, result)
        continue
      }
      if (parsed.mode === 'get') {
        result = this.variables[parsed.rule] ?? ''
        continue
      }
      result = this.evaluateStringList(result, parsed)
      result = this.consumeContentOverride(result)
      result = applyParsedReplacement(result, parsed)
    }

    const list = Array.isArray(result) ? result.flatMap((item) => valueToStringList(item)) : valueToStringList(result)
    if (!options.isUrl) return list.map(decodeHtmlEntities).filter((item) => item !== '')
    return dedupeStrings(list.map((item) => resolveRuleUrl(this.redirectUrl || this.baseUrl, item)).filter(Boolean))
  }

  async getStringListAsync(rule: string, options: { content?: unknown; isUrl?: boolean } = {}) {
    if (!rule) return []
    let result: unknown = options.content ?? this.content
    const rules = splitSourceRules(rule, result, false)

    for (const rawRule of rules) {
      if (result === undefined || result === null) return []
      const parsed = parseSourceRule(rawRule, result, false)
      if (parsed.mode === 'put') {
        await this.applyPutRule(parsed.rule, result)
        continue
      }
      if (parsed.mode === 'get') {
        result = this.variables[parsed.rule] ?? ''
        continue
      }
      result = await this.evaluateStringListAsync(result, parsed)
      result = this.consumeContentOverride(result)
      result = applyParsedReplacement(result, parsed)
    }

    const list = Array.isArray(result) ? result.flatMap((item) => valueToStringList(item)) : valueToStringList(result)
    if (!options.isUrl) return list.map(decodeHtmlEntities).filter((item) => item !== '')
    return dedupeStrings(list.map((item) => resolveRuleUrl(this.redirectUrl || this.baseUrl, item)).filter(Boolean))
  }

  getString(rule: string, options: { content?: unknown; isUrl?: boolean; unescape?: boolean } = {}) {
    if (!rule) return ''
    let result: unknown = options.content ?? this.content
    const rules = splitSourceRules(rule, result, false)

    for (const rawRule of rules) {
      if (result === undefined || result === null) return ''
      const parsed = parseSourceRule(rawRule, result, false)
      if (parsed.mode === 'put') {
        this.applyPutRuleSync(parsed.rule, result)
        continue
      }
      if (parsed.mode === 'get') {
        result = this.variables[parsed.rule] ?? ''
        continue
      }
      result = this.evaluateString(result, parsed, Boolean(options.isUrl))
      result = this.consumeContentOverride(result)
      result = applyParsedReplacement(result, parsed)
    }

    const text = valueToString(result)
    const clean = options.unescape === false ? text : decodeHtmlEntities(text)
    if (!options.isUrl) return clean.trim()
    return clean.trim() ? resolveRuleUrl(this.redirectUrl || this.baseUrl, clean) : ''
  }

  async getStringAsync(rule: string, options: { content?: unknown; isUrl?: boolean; unescape?: boolean } = {}) {
    if (!rule) return ''
    let result: unknown = options.content ?? this.content
    const rules = splitSourceRules(rule, result, false)

    for (const rawRule of rules) {
      if (result === undefined || result === null) return ''
      const parsed = parseSourceRule(rawRule, result, false)
      if (parsed.mode === 'put') {
        await this.applyPutRule(parsed.rule, result)
        continue
      }
      if (parsed.mode === 'get') {
        result = this.variables[parsed.rule] ?? ''
        continue
      }
      result = await this.evaluateStringAsync(result, parsed, Boolean(options.isUrl))
      result = this.consumeContentOverride(result)
      result = applyParsedReplacement(result, parsed)
    }

    const text = valueToString(result)
    const clean = options.unescape === false ? text : decodeHtmlEntities(text)
    if (!options.isUrl) return clean.trim()
    return clean.trim() ? resolveRuleUrl(this.redirectUrl || this.baseUrl, clean) : ''
  }

  private evaluateElements(content: unknown, parsed: ParsedRule) {
    switch (parsed.mode) {
      case 'json':
        return flattenElementValues(selectJsonValues(content, parsed.rule))
      case 'xpath':
        return selectXPathValues(content, parsed.rule)
      case 'regex':
        return selectRegexMatches(content, parsed.rule)
      case 'js':
        return evaluateJs(parsed.rule, content, this.runtimeFor(content))
      default:
        return selectHtmlElements(content, parsed.rule)
    }
  }

  private async evaluateElementsAsync(content: unknown, parsed: ParsedRule) {
    switch (parsed.mode) {
      case 'json':
        return flattenElementValues(selectJsonValues(content, parsed.rule))
      case 'xpath':
        return selectXPathValues(content, parsed.rule)
      case 'regex':
        return selectRegexMatches(content, parsed.rule)
      case 'js':
        return await evaluateJsAsync(parsed.rule, content, this.runtimeFor(content))
      default:
        return selectHtmlElements(content, parsed.rule)
    }
  }

  private evaluateStringList(content: unknown, parsed: ParsedRule) {
    if (Array.isArray(content) && /\$\d{1,2}/.test(parsed.rule)) {
      return [replaceRegexGroupReferences(parsed.rule, content)]
    }

    switch (parsed.mode) {
      case 'json':
        return selectJsonValues(content, parsed.rule).map(valueToString)
      case 'xpath':
        return selectXPathValues(content, parsed.rule).map(valueToString)
      case 'regex':
        return selectRegexMatches(content, parsed.rule).flatMap((match) => (Array.isArray(match) ? match : [String(match)]))
      case 'js':
        return valueToStringList(evaluateJs(parsed.rule, content, this.runtimeFor(content)))
      default:
        return selectHtmlStringList(content, parsed.rule)
    }
  }

  private async evaluateStringListAsync(content: unknown, parsed: ParsedRule) {
    if (Array.isArray(content) && /\$\d{1,2}/.test(parsed.rule)) {
      return [replaceRegexGroupReferences(parsed.rule, content)]
    }

    switch (parsed.mode) {
      case 'json':
        return selectJsonValues(content, parsed.rule).map(valueToString)
      case 'xpath':
        return selectXPathValues(content, parsed.rule).map(valueToString)
      case 'regex':
        return selectRegexMatches(content, parsed.rule).flatMap((match) => (Array.isArray(match) ? match : [String(match)]))
      case 'js':
        return valueToStringList(await evaluateJsAsync(parsed.rule, content, this.runtimeFor(content)))
      default:
        return selectHtmlStringList(content, parsed.rule)
    }
  }

  private evaluateString(content: unknown, parsed: ParsedRule, isUrl: boolean) {
    if (Array.isArray(content) && /\$\d{1,2}/.test(parsed.rule)) {
      return replaceRegexGroupReferences(parsed.rule, content)
    }

    switch (parsed.mode) {
      case 'json':
        return selectJsonValues(content, parsed.rule).map(valueToString).join('\n')
      case 'xpath':
        return selectXPathValues(content, parsed.rule).map(valueToString).join('\n')
      case 'regex':
        return selectRegexMatches(content, parsed.rule)
          .map((match) => (Array.isArray(match) ? match[0] : String(match)))
          .join('\n')
      case 'js':
        return valueToString(evaluateJs(parsed.rule, content, this.runtimeFor(content)))
      default:
        return isUrl ? selectHtmlStringList(content, parsed.rule)[0] || '' : selectHtmlStringList(content, parsed.rule).join('\n')
    }
  }

  private async evaluateStringAsync(content: unknown, parsed: ParsedRule, isUrl: boolean) {
    if (Array.isArray(content) && /\$\d{1,2}/.test(parsed.rule)) {
      return replaceRegexGroupReferences(parsed.rule, content)
    }

    switch (parsed.mode) {
      case 'json':
        return selectJsonValues(content, parsed.rule).map(valueToString).join('\n')
      case 'xpath':
        return selectXPathValues(content, parsed.rule).map(valueToString).join('\n')
      case 'regex':
        return selectRegexMatches(content, parsed.rule)
          .map((match) => (Array.isArray(match) ? match[0] : String(match)))
          .join('\n')
      case 'js':
        return valueToString(await evaluateJsAsync(parsed.rule, content, this.runtimeFor(content)))
      default:
        return isUrl ? selectHtmlStringList(content, parsed.rule)[0] || '' : selectHtmlStringList(content, parsed.rule).join('\n')
    }
  }

  private async applyPutRule(rule: string, content: unknown) {
    const entries = parsePutRuleObject(rule)
    for (const [key, itemRule] of Object.entries(entries)) {
      this.variables[key] = await this.withContent(content).getStringAsync(String(itemRule))
    }
  }

  private applyPutRuleSync(rule: string, content: unknown) {
    const entries = parsePutRuleObject(rule)
    for (const [key, itemRule] of Object.entries(entries)) {
      this.variables[key] = this.withContent(content).getString(String(itemRule))
    }
  }

  private runtimeFor(content: unknown): AnalyzeRuntime {
    return {
      ...this.runtime,
      baseUrl: this.baseUrl,
      variables: this.variables
    }
  }

  private consumeContentOverride(fallback: unknown) {
    if (!(JS_CONTENT_OVERRIDE_KEY in this.variables)) return fallback
    const value = this.variables[JS_CONTENT_OVERRIDE_KEY]
    delete this.variables[JS_CONTENT_OVERRIDE_KEY]
    return value
  }
}

function splitSourceRules(rule: string, content: unknown, allInOne: boolean): string[] {
  const trimmed = rule.trim()
  if (!trimmed) return []
  if (allInOne && trimmed.startsWith(':')) return [trimmed]
  const implicitJsRules = splitImplicitJsRule(trimmed, content)
  if (implicitJsRules) return implicitJsRules

  const rules: string[] = []
  const jsPattern = /<js>([\s\S]*?)<\/js>/gi
  let cursor = 0
  let match: RegExpExecArray | null

  while ((match = jsPattern.exec(trimmed)) !== null) {
    const before = trimmed.slice(cursor, match.index).trim()
    if (before) rules.push(before)
    rules.push(`@js:${match[1]}`)
    cursor = match.index + match[0].length
  }

  const tail = trimmed.slice(cursor).trim()
  if (tail) rules.push(tail)
  return rules.flatMap((item) => splitChainedControlRule(item)).filter(Boolean)
}

function splitImplicitJsRule(rule: string, content: unknown): string[] | null {
  if (!shouldTreatRuleAsImplicitJs(rule, content)) return null

  const trailingStart = findTrailingRuleStart(rule)
  if (trailingStart > 0) {
    const jsRule = rule.slice(0, trailingStart).trim()
    const trailingRule = rule.slice(trailingStart).trim()
    if (jsRule && trailingRule) {
      return [`@js:${jsRule}`, ...splitSourceRules(trailingRule, content, false)]
    }
  }

  return [`@js:${rule}`]
}

function shouldTreatRuleAsImplicitJs(rule: string, content: unknown) {
  const trimmed = rule.trim()
  if (!trimmed || isExplicitRule(trimmed) || isLikelyPlainRule(trimmed, content)) return false
  return looksLikeJsRule(trimmed)
}

function isExplicitRule(rule: string) {
  return /^@(?:js|put|get|css|xpath|json):/i.test(rule) || /^<js>/i.test(rule) || /<js>[\s\S]*<\/js>/i.test(rule)
}

function isLikelyPlainRule(rule: string, content: unknown) {
  if (isJsonContent(content) && (rule.startsWith('$.') || rule.startsWith('$['))) return true
  if (rule.startsWith('/') && !rule.startsWith('//http')) return true
  if (/^[:.#\[\w-]+(?:[>+~\s.#:[\]\w="'^$*|!-]|@|\|\||&&|%%|##|,)*$/.test(rule)) return true
  return false
}

function looksLikeJsRule(rule: string) {
  return /(?:^|[\s;])(?:var|let|const|if|else|while|for|try|catch|function|return)\b/.test(rule) ||
    /\b(?:java|source|org|result|src|baseUrl|key|url|html|eval)\b/.test(rule) && /[=;{}()]/.test(rule)
}

function findTrailingRuleStart(rule: string) {
  const lines = rule.replace(/\r\n/g, '\n').split('\n')
  for (let index = 1; index < lines.length; index += 1) {
    const trailingRule = lines.slice(index).join('\n').trim()
    if (!isLikelyTrailingRule(trailingRule)) continue

    const before = lines.slice(0, index).join('\n').trim()
    if (!looksLikeJsRule(before)) continue

    let offset = 0
    for (let lineIndex = 0; lineIndex < index; lineIndex += 1) offset += lines[lineIndex].length + 1
    offset += lines[index].length - lines[index].trimStart().length
    return offset
  }
  return -1
}

function isLikelyTrailingRule(rule: string) {
  const firstLine = rule.split('\n').map((line) => line.trim()).find(Boolean) || ''
  if (!firstLine || looksLikeJsRule(firstLine) || isJsContinuationLine(firstLine)) return false
  if (/^(?:@(?:css|xpath|json):|@@|\/\/|\$\.|\$\[|[:#.[]|class\.|id\.|tag\.|text\.)/i.test(firstLine)) return true
  if (/[.@#[\]>+~:*|&]/.test(firstLine)) return true
  return false
}

function isJsContinuationLine(line: string) {
  return /^(?:\}|\)|\]|\{|\(|\]|else\b|catch\b|finally\b|[,.;])/.test(line) || /[{};]$/.test(line)
}

function parseSourceRule(rule: string, content: unknown, allInOne: boolean): ParsedRule {
  const originalRule = replaceEmbeddedRuleValues(rule.trim(), content)
  let mode: RuleMode = 'default'
  let workingRule = originalRule
  let restRules: string[] = []

  if (allInOne && workingRule.startsWith(':')) {
    mode = 'regex'
    workingRule = workingRule.slice(1)
  } else if (/^@put:/i.test(workingRule)) {
    mode = 'put'
    workingRule = workingRule.replace(/^@put:/i, '')
  } else if (/^@get:/i.test(workingRule)) {
    mode = 'get'
    workingRule = workingRule.replace(/^@get:/i, '')
    const parsedGet = parseGetRuleHead(workingRule)
    workingRule = parsedGet.key
    restRules = parsedGet.restRules
  } else if (/^@js:/i.test(workingRule)) {
    mode = 'js'
    workingRule = workingRule.replace(/^@js:/i, '')
  } else if (/^@CSS:/i.test(workingRule)) {
    mode = 'default'
  } else if (workingRule.startsWith('@@')) {
    mode = 'default'
    workingRule = workingRule.slice(2)
  } else if (/^@XPath:/i.test(workingRule)) {
    mode = 'xpath'
    workingRule = workingRule.replace(/^@XPath:/i, '')
  } else if (/^@Json:/i.test(workingRule)) {
    mode = 'json'
    workingRule = workingRule.replace(/^@Json:/i, '')
  } else if (isJsonContent(content) || workingRule.startsWith('$.') || workingRule.startsWith('$[')) {
    mode = 'json'
  } else if (workingRule.startsWith('/') && !workingRule.startsWith('//http')) {
    mode = 'xpath'
  } else if (/\$\d{1,2}/.test(workingRule)) {
    mode = 'regex'
  }

  const parts = workingRule.split('##')
  return {
    mode,
    rule: (parts.shift() || '').trim(),
    replaceRegex: parts[0]?.trim() || '',
    replacement: parts[1] ?? '',
    replaceFirst: parts.length > 2,
    restRules
  }
}

function splitChainedControlRule(rule: string): string[] {
  const trimmed = rule.trim()
  if (!/^@(?:get|put):/i.test(trimmed)) return [trimmed]

  const head = extractControlRuleHead(trimmed)
  if (!head.rest.trim()) return [trimmed]

  return [head.rule, ...splitSourceRules(head.rest, '', false)]
}

function extractControlRuleHead(rule: string) {
  const prefixMatch = rule.match(/^@(?:get|put):/i)
  if (!prefixMatch) return { rule, rest: '' }

  let index = prefixMatch[0].length
  while (index < rule.length && /\s/.test(rule[index])) index += 1

  if (rule[index] === '{') {
    const close = findBalancedClose(rule, index, '{', '}')
    if (close >= 0) {
      return {
        rule: rule.slice(0, close + 1),
        rest: rule.slice(close + 1)
      }
    }
  }

  while (index < rule.length && rule[index] !== '@') index += 1
  return {
    rule: rule.slice(0, index),
    rest: rule.slice(index)
  }
}

function parseGetRuleHead(rule: string): { key: string; restRules: string[] } {
  const trimmed = rule.trim()
  if (trimmed.startsWith('{')) {
    const close = findBalancedClose(trimmed, 0, '{', '}')
    if (close >= 0) {
      return {
        key: trimmed.slice(1, close).trim(),
        restRules: splitSourceRules(trimmed.slice(close + 1), '', false)
      }
    }
  }

  const delimiter = trimmed.indexOf('@')
  if (delimiter >= 0) {
    return {
      key: trimmed.slice(0, delimiter).trim(),
      restRules: splitSourceRules(trimmed.slice(delimiter), '', false)
    }
  }

  return {
    key: trimmed,
    restRules: []
  }
}

function findBalancedClose(value: string, start: number, open: string, close: string) {
  let quote = ''
  let depth = 0

  for (let index = start; index < value.length; index += 1) {
    const char = value[index]
    if (quote) {
      if (char === quote && value[index - 1] !== '\\') quote = ''
      continue
    }
    if (char === '"' || char === "'" || char === '`') {
      quote = char
      continue
    }
    if (char === open) depth += 1
    else if (char === close) {
      depth -= 1
      if (depth === 0) return index
    }
  }

  return -1
}

function replaceEmbeddedRuleValues(rule: string, content: unknown) {
  let result = rule

  result = result.replace(/\{\{([\s\S]*?)\}\}/g, (_match, code: string) => {
    const expression = code.trim()
    if (isNestedRule(expression)) {
      return new LegadoAnalyzer(content, '').getString(expression)
    }
    return toCleanString(evaluateJs(expression, content))
  })

  return result
}

function isNestedRule(rule: string) {
  return !/^@get:/i.test(rule) && (rule.startsWith('@') || rule.startsWith('$.') || rule.startsWith('$[') || rule.startsWith('//'))
}

function parsePutRuleObject(rule: string) {
  const text = rule.trim()
  const body = text.replace(/^@put:/i, '')
  try {
    const parsed = Function(`"use strict"; return (${body})`)() as unknown
    if (isRecord(parsed)) return parsed
  } catch (error) {
    // Fall through to a conservative parser for malformed but common object snippets.
  }

  const entries: Record<string, string> = {}
  const inner = body.replace(/^\{|\}$/g, '')
  splitTopLevel(inner, [',']).forEach((part) => {
    const index = part.indexOf(':')
    if (index <= 0) return
    const key = part.slice(0, index).trim().replace(/^['"]|['"]$/g, '')
    const value = part.slice(index + 1).trim().replace(/^['"]|['"]$/g, '')
    if (key) entries[key] = value
  })
  return entries
}

function applyParsedReplacement(value: unknown, parsed: ParsedRule): unknown {
  if (!parsed.replaceRegex) return value
  if (Array.isArray(value)) return value.map((item) => replaceByParsedRule(valueToString(item), parsed))
  return replaceByParsedRule(valueToString(value), parsed)
}

function replaceByParsedRule(value: string, parsed: ParsedRule) {
  try {
    const regex = new RegExp(parsed.replaceRegex, 'g')
    if (parsed.replaceFirst) {
      const match = value.match(regex)
      return match?.[0]?.replace(regex, parsed.replacement) || ''
    }
    return value.replace(regex, parsed.replacement)
  } catch (error) {
    return value.replaceAll(parsed.replaceRegex, parsed.replacement)
  }
}

function normalizeElementResult(value: unknown): unknown[] {
  if (Array.isArray(value)) return value
  if (value === undefined || value === null) return []
  return [value]
}

function flattenElementValues(values: unknown[]) {
  return values.flatMap((value) => (Array.isArray(value) ? value : [value]))
}

function replaceRegexGroupReferences(rule: string, groups: unknown[]) {
  return rule.replace(/\$(\d{1,2})/g, (match, indexText: string) => {
    const value = groups[Number(indexText)]
    return value === undefined || value === null ? match : String(value)
  })
}

function selectHtmlElements(content: unknown, rule: string): unknown[] {
  const root = asHtmlRoot(content)
  if (!root) return []
  return combineRuleBranches(rule, (branch) => selectHtmlElementsBranch(root, branch))
}

function selectHtmlElementsBranch(root: Document | Element, rule: string): Element[] {
  const cleanRule = stripCssRulePrefix(rule)
  if (!cleanRule) return []
  const parts = splitHtmlRule(cleanRule).filter((part) => part && !isHtmlAccessor(part))
  let current: Array<Document | Element> = [root]

  for (const part of parts) {
    const next: Element[] = []
    for (const node of current) next.push(...selectHtmlPart(node, part))
    current = next
  }

  return current.filter(isElement)
}

function selectHtmlStringList(content: unknown, rule: string): string[] {
  if (isPlainScalarContent(content) && isScalarHtmlAccessorRule(rule)) return valueToStringList(content)

  const root = asHtmlRoot(content)
  if (!root) return valueToStringList(content)

  return combineRuleBranches(rule, (branch) => {
    const cleanRule = stripCssRulePrefix(branch)
    if (!cleanRule) return [getHtmlAccessorValue(root, 'text')]
    const parts = splitHtmlRule(cleanRule).filter(Boolean)
    const last = parts.at(-1) || ''
    const accessor = isHtmlValueRule(last) ? parts.pop() || 'text' : 'text'
    let current: Array<Document | Element> = [root]

    for (const part of parts) {
      const next: Element[] = []
      for (const node of current) next.push(...selectHtmlPart(node, part))
      current = next
    }

    return current.map((node) => getHtmlAccessorValue(node, accessor)).filter((item) => item !== '')
  })
}

function isPlainScalarContent(content: unknown) {
  if (typeof content !== 'string') return false
  const trimmed = content.trim()
  return Boolean(trimmed) && !/<[a-z][\s\S]*>/i.test(trimmed)
}

function isScalarHtmlAccessorRule(rule: string) {
  const cleanRule = stripCssRulePrefix(rule)
  const parts = splitHtmlRule(cleanRule).filter(Boolean)
  return parts.length === 1 && isHtmlValueRule(parts[0])
}

function selectHtmlPart(root: Document | Element, rule: string): Element[] {
  const { selector, indexes, exclude, text, attrRegex } = normalizeHtmlSelector(rule)
  let elements: Element[] = []

  try {
    if (text !== null) {
      elements = Array.from(root.querySelectorAll('*')).filter((element) =>
        getOwnText(element).includes(text)
      )
    } else if (selector === 'children') {
      elements = isDocument(root) ? Array.from(root.documentElement.children) : Array.from(root.children)
    } else if (attrRegex) {
      const candidates = Array.from(root.querySelectorAll(selector || '*'))
      elements = candidates.filter((element) => attrRegex.pattern.test(element.getAttribute(attrRegex.name) || ''))
    } else if (selector) {
      elements = Array.from(root.querySelectorAll(selector))
    }
  } catch (error) {
    elements = []
  }

  return applyIndexes(elements, indexes, exclude)
}

function normalizeHtmlSelector(rule: string): {
  selector: string
  indexes: number[]
  exclude: boolean
  text: string | null
  attrRegex: { name: string; pattern: RegExp } | null
} {
  let selector = rule.trim()
  const indexes: number[] = []
  let exclude = false

  const legacyIndex = selector.match(/^(.*?)([.!])(-?\d+)$/)
  if (legacyIndex && legacyIndex[1]) {
    selector = legacyIndex[1]
    exclude = legacyIndex[2] === '!'
    indexes.push(Number(legacyIndex[3]))
  }

  const bracketIndex = selector.match(/^(.*)\[(!?)(-?\d+)\]$/)
  if (bracketIndex && !bracketIndex[1].endsWith('=')) {
    selector = bracketIndex[1]
    exclude = bracketIndex[2] === '!'
    indexes.push(Number(bracketIndex[3]))
  }

  if (/^class\./i.test(selector)) selector = `.${cssEscape(selector.slice(6))}`
  else if (/^id\./i.test(selector)) selector = `#${cssEscape(selector.slice(3))}`
  else if (/^tag\./i.test(selector)) selector = selector.slice(4)
  else if (/^text\./i.test(selector)) return { selector: '', indexes, exclude, text: selector.slice(5), attrRegex: null }
  else if (selector === 'children') return { selector: 'children', indexes, exclude, text: null, attrRegex: null }

  const attrRegex = parseJsoupAttributeRegexSelector(selector)
  if (attrRegex) {
    return {
      selector: attrRegex.selector,
      indexes,
      exclude,
      text: null,
      attrRegex: {
        name: attrRegex.name,
        pattern: attrRegex.pattern
      }
    }
  }

  return { selector, indexes, exclude, text: null, attrRegex: null }
}

function parseJsoupAttributeRegexSelector(selector: string) {
  const match = selector.match(/^(.*)\[([^\]\s~|^$*!=]+)~=([^\]]+)\]$/)
  if (!match) return null

  try {
    return {
      selector: match[1]?.trim() || '*',
      name: match[2],
      pattern: new RegExp(match[3].replace(/^['"]|['"]$/g, ''))
    }
  } catch (error) {
    return null
  }
}

function applyIndexes<T>(items: T[], indexes: number[], exclude = false) {
  if (!indexes.length) return items
  if (exclude) {
    const excluded = new Set<number>()
    for (const rawIndex of indexes) {
      const index = rawIndex < 0 ? items.length + rawIndex : rawIndex
      if (index >= 0 && index < items.length) excluded.add(index)
    }
    return items.filter((_item, index) => !excluded.has(index))
  }

  const selected: T[] = []
  for (const rawIndex of indexes) {
    const index = rawIndex < 0 ? items.length + rawIndex : rawIndex
    if (index >= 0 && index < items.length) selected.push(items[index])
  }
  return selected
}

function splitHtmlRule(rule: string) {
  return splitTopLevel(rule, ['@']).map((part) => part.trim()).filter(Boolean)
}

function stripCssRulePrefix(rule: string) {
  return rule.trim().replace(/^@?CSS:/i, '').trim()
}

function isHtmlAccessor(part: string) {
  return isHtmlValueRule(part)
}

function isHtmlValueRule(part: string) {
  const lower = part.toLowerCase()
  return (
    lower === 'text' ||
    lower === 'textnodes' ||
    lower === 'owntext' ||
    lower === 'html' ||
    lower === 'all' ||
    lower === 'href' ||
    lower === 'src' ||
    lower === 'content' ||
    lower === 'value' ||
    lower === 'alt' ||
    lower === 'title' ||
    lower.startsWith('data-') ||
    lower.startsWith('attr.')
  )
}

function getHtmlAccessorValue(node: Document | Element, accessor: string) {
  const lower = accessor.toLowerCase()
  if (lower === 'html') return isElement(node) ? node.innerHTML : node.documentElement?.innerHTML || ''
  if (lower === 'all') return isElement(node) ? node.outerHTML : node.documentElement?.outerHTML || ''
  if (lower === 'owntext') return isElement(node) ? getOwnText(node) : toCleanString(node.body?.textContent)
  if (lower === 'textnodes') return isElement(node) ? getTextNodes(node).join('\n') : toCleanString(node.body?.textContent)
  if (lower === 'text') return toCleanString(node.textContent)

  if (!isElement(node)) return ''
  const attr = lower.startsWith('attr.') ? accessor.slice(5) : accessor
  return toCleanString(node.getAttribute(attr))
}

function getOwnText(element: Element) {
  return toCleanString(
    Array.from(element.childNodes)
      .filter((node) => node.nodeType === Node.TEXT_NODE)
      .map((node) => node.textContent || '')
      .join(' ')
  )
}

function getTextNodes(element: Element) {
  return Array.from(element.childNodes)
    .filter((node) => node.nodeType === Node.TEXT_NODE)
    .map((node) => toCleanString(node.textContent))
    .filter(Boolean)
}

function cssEscape(value: string) {
  if (typeof CSS !== 'undefined' && CSS.escape) return CSS.escape(value)
  return value.replace(/([ !"#$%&'()*+,./:;<=>?@[\\\]^`{|}~])/g, '\\$1')
}

function selectJsonValues(content: unknown, rule: string): unknown[] {
  const root = asJsonRoot(content)
  if (root === undefined) return []
  return combineRuleBranches(rule, (branch) => selectJsonBranch(root, branch))
}

function selectJsonBranch(root: unknown, rule: string): unknown[] {
  const path = rule.trim().replace(/^@?Json:/i, '')
  if (!path || path === '$') return [root]
  const tokens = tokenizeJsonPath(path)
  let values: unknown[] = [root]

  for (const token of tokens) {
    const next: unknown[] = []
    for (const value of values) next.push(...readJsonToken(value, token))
    values = next.filter((value) => value !== undefined && value !== null)
  }

  return values
}

function tokenizeJsonPath(path: string) {
  const tokens: string[] = []
  let index = path.startsWith('$') ? 1 : 0

  while (index < path.length) {
    const char = path[index]
    if (/[\w$-]/.test(char)) {
      const key = readJsonPathKey(path, index)
      tokens.push(key.value)
      index = key.next
      continue
    }
    if (char === '.') {
      if (path[index + 1] === '.') {
        index += 2
        const key = readJsonPathKey(path, index)
        tokens.push(`..${key.value}`)
        index = key.next
      } else {
        index += 1
        if (path[index] === '*') {
          tokens.push('*')
          index += 1
          continue
        }
        const key = readJsonPathKey(path, index)
        tokens.push(key.value)
        index = key.next
      }
      continue
    }
    if (char === '[') {
      const close = findClosingBracket(path, index)
      if (close < 0) break
      tokens.push(path.slice(index, close + 1))
      index = close + 1
      continue
    }
    index += 1
  }

  return tokens.filter(Boolean)
}

function readJsonPathKey(path: string, start: number) {
  let index = start
  while (index < path.length && /[\w$-]/.test(path[index])) index += 1
  return {
    value: path.slice(start, index),
    next: index
  }
}

function findClosingBracket(value: string, start: number) {
  let quote = ''
  for (let index = start + 1; index < value.length; index += 1) {
    const char = value[index]
    if (quote) {
      if (char === quote && value[index - 1] !== '\\') quote = ''
      continue
    }
    if (char === '"' || char === "'") {
      quote = char
      continue
    }
    if (char === ']') return index
  }
  return -1
}

function readJsonToken(value: unknown, token: string): unknown[] {
  if (token === '*') {
    if (Array.isArray(value)) return value
    if (isRecord(value)) return Object.values(value)
    return []
  }
  if (token.startsWith('..')) return findJsonRecursive(value, token.slice(2))
  if (token.startsWith('[')) return readJsonBracket(value, token)
  if (Array.isArray(value)) {
    const index = Number(token)
    if (Number.isInteger(index)) {
      const normalizedIndex = index < 0 ? value.length + index : index
      return [value[normalizedIndex]]
    }
    return value.flatMap((item) => (isRecord(item) ? [item[token]] : []))
  }
  if (isRecord(value)) return [value[token]]
  return []
}

function readJsonBracket(value: unknown, token: string): unknown[] {
  const inner = token.slice(1, -1).trim()
  if (inner === '*') {
    if (Array.isArray(value)) return value
    if (isRecord(value)) return Object.values(value)
    return []
  }

  const quoted = inner.match(/^['"](.+)['"]$/)
  if (quoted) {
    if (isRecord(value)) return [value[quoted[1]]]
    return []
  }

  const range = inner.match(/^(-?\d*)\s*:\s*(-?\d*)$/)
  if (range && Array.isArray(value)) {
    const start = range[1] ? Number(range[1]) : 0
    const end = range[2] ? Number(range[2]) : value.length
    return value.slice(start, end)
  }

  const filter = inner.match(/^\?\(@\.([\w$-]+)\s*==\s*['"]([^'"]+)['"]\)$/)
  if (filter && Array.isArray(value)) {
    return value.filter((item) => isRecord(item) && String(item[filter[1]]) === filter[2])
  }

  const index = Number(inner)
  if (Number.isInteger(index) && Array.isArray(value)) {
    const normalizedIndex = index < 0 ? value.length + index : index
    return [value[normalizedIndex]]
  }

  return []
}

function findJsonRecursive(value: unknown, key: string): unknown[] {
  const results: unknown[] = []
  if (Array.isArray(value)) {
    for (const item of value) results.push(...findJsonRecursive(item, key))
    return results
  }
  if (!isRecord(value)) return results
  if (key in value) results.push(value[key])
  for (const item of Object.values(value)) results.push(...findJsonRecursive(item, key))
  return results
}

function selectXPathValues(content: unknown, rule: string): unknown[] {
  const root = asHtmlRoot(content)
  if (!root || typeof XPathResult === 'undefined') return []
  return combineRuleBranches(rule, (branch) => selectXPathBranch(root, branch))
}

function selectXPathBranch(root: Document | Element, rule: string): unknown[] {
  const xpath = rule.trim().replace(/^@?XPath:/i, '')
  if (!xpath) return []
  const documentNode = isDocument(root) ? root : root.ownerDocument
  if (!documentNode) return []

  try {
    const result = documentNode.evaluate(xpath, root, null, XPathResult.ANY_TYPE, null)
    if (result.resultType === XPathResult.STRING_TYPE) return [result.stringValue]
    if (result.resultType === XPathResult.NUMBER_TYPE) return [String(result.numberValue)]
    if (result.resultType === XPathResult.BOOLEAN_TYPE) return [String(result.booleanValue)]

    const nodes: unknown[] = []
    let node = result.iterateNext()
    while (node) {
      nodes.push(node)
      node = result.iterateNext()
    }
    return nodes
  } catch (error) {
    return []
  }
}

function selectRegexMatches(content: unknown, rule: string): unknown[] {
  const stages = splitTopLevel(rule, ['&&']).map((item) => item.trim()).filter(Boolean)
  let text = toRawString(content)
  let matches: string[][] = []

  for (const [stageIndex, stage] of stages.entries()) {
    const regex = createGlobalRegex(stage)
    if (!regex) return []
    matches = []
    let match: RegExpExecArray | null
    while ((match = regex.exec(text)) !== null) {
      matches.push(Array.from(match))
      if (match[0] === '') regex.lastIndex += 1
    }
    if (stageIndex < stages.length - 1) text = matches.map((item) => item[0]).join('')
  }

  return matches
}

function createGlobalRegex(pattern: string) {
  try {
    return new RegExp(pattern, 'gs')
  } catch (error) {
    try {
      return new RegExp(escapeRegExp(pattern), 'gs')
    } catch (innerError) {
      return null
    }
  }
}

function combineRuleBranches<T>(rule: string, evaluate: (branch: string) => T[]): T[] {
  const trimmed = rule.trim()
  if (!trimmed) return []
  const split = splitRuleCombination(trimmed)
  if (!split) return evaluate(trimmed)

  const results = split.parts.map(evaluate).filter((items) => items.length)
  if (!results.length) return []
  if (split.operator === '||') return results[0]
  if (split.operator === '%%') return interleave(results)
  return results.flat()
}

function splitRuleCombination(rule: string): { operator: '&&' | '||' | '%%'; parts: string[] } | null {
  for (const operator of ['||', '&&', '%%'] as const) {
    const parts = splitTopLevel(rule, [operator]).map((item) => item.trim()).filter(Boolean)
    if (parts.length > 1) return { operator, parts }
  }
  return null
}

function interleave<T>(groups: T[][]) {
  const result: T[] = []
  const maxLength = Math.max(...groups.map((group) => group.length))
  for (let index = 0; index < maxLength; index += 1) {
    for (const group of groups) {
      if (index < group.length) result.push(group[index])
    }
  }
  return result
}

function splitTopLevel(value: string, delimiters: string[]) {
  const parts: string[] = []
  let quote = ''
  let depth = 0
  let start = 0

  for (let index = 0; index < value.length; index += 1) {
    const char = value[index]
    if (quote) {
      if (char === quote && value[index - 1] !== '\\') quote = ''
      continue
    }
    if (char === '"' || char === "'" || char === '`') {
      quote = char
      continue
    }
    if ('([{'.includes(char)) depth += 1
    else if (')]}'.includes(char)) depth = Math.max(0, depth - 1)

    if (depth > 0) continue
    const delimiter = delimiters.find((item) => value.startsWith(item, index))
    if (!delimiter) continue
    parts.push(value.slice(start, index))
    index += delimiter.length - 1
    start = index + 1
  }

  parts.push(value.slice(start))
  return parts
}

function asHtmlRoot(value: unknown): Document | Element | null {
  if (isDocument(value) || isElement(value)) return value
  if (isParsedContent(value)) {
    if (value.kind === 'html') return value.document
    if (value.kind === 'text') return parseHtml(value.raw)
    return null
  }
  if (typeof value === 'string') return parseHtml(value)
  return null
}

function asJsonRoot(value: unknown): unknown {
  if (isParsedContent(value)) {
    if (value.kind === 'json') return value.data
    return undefined
  }
  if (typeof value === 'string' && isJsonLike(value)) {
    try {
      return JSON.parse(value)
    } catch (error) {
      return undefined
    }
  }
  return value
}

function isJsonContent(value: unknown) {
  if (isDocument(value) || isElement(value)) return false
  if (isParsedContent(value)) return value.kind === 'json'
  if (typeof value !== 'string') return Array.isArray(value) || isRecord(value)
  return isJsonLike(value)
}

function parseContent(text: string): ParsedContent {
  const trimmed = text.trim()
  if (isJsonLike(trimmed)) {
    try {
      return {
        kind: 'json',
        raw: text,
        data: JSON.parse(trimmed)
      }
    } catch (error) {
      // Broken JSON-like responses are still common on novel sites.
    }
  }

  if (/<[a-z][\s\S]*>/i.test(trimmed)) {
    return {
      kind: 'html',
      raw: text,
      document: parseHtml(text)
    }
  }

  return {
    kind: 'text',
    raw: text
  }
}

function parseHtml(text: string) {
  return new DOMParser().parseFromString(text, text.trim().startsWith('<?xml') ? 'application/xml' : 'text/html')
}

function isJsonLike(value: string) {
  const trimmed = value.trim()
  return (trimmed.startsWith('{') && trimmed.endsWith('}')) || (trimmed.startsWith('[') && trimmed.endsWith(']'))
}

function valueToString(value: unknown): string {
  if (value === undefined || value === null) return ''
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return String(value)
  if (isElement(value)) return toCleanString(value.textContent)
  if (isDocument(value)) return toCleanString(value.body?.textContent || value.documentElement?.textContent)
  if (value instanceof Attr) return value.value
  if (value instanceof Text) return value.textContent || ''
  if (Array.isArray(value)) return value.map(valueToString).join('\n')
  if (isParsedContent(value)) return value.raw
  try {
    return JSON.stringify(value)
  } catch (error) {
    return String(value)
  }
}

function valueToStringList(value: unknown): string[] {
  if (value === undefined || value === null) return []
  if (Array.isArray(value)) return value.flatMap(valueToStringList)
  const text = valueToString(value)
  return text ? String(text).split('\n') : []
}

function getJsRuntimeValue(value: unknown) {
  return isParsedContent(value) ? value.raw : value
}

function evaluateJs(script: string, result?: unknown, context: UrlBuildContext = {}) {
  try {
    const env = createJsRuntimeEnv(result, context, false)
    const body = makeJsFunctionBody(script, false)
    return Function('__env', `with (__env) { ${body} }`)(env)
  } catch (error) {
    return ''
  }
}

async function evaluateJsAsync(script: string, result?: unknown, context: UrlBuildContext = {}) {
  const env = createJsRuntimeEnv(result, context, true)
  return await runAsyncJsInEnv(script, env)
}

async function runAsyncJsInEnv(script: string, env: JsRuntimeEnv) {
  const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor as new (
    ...args: string[]
  ) => (env: JsRuntimeEnv) => Promise<unknown>
  const body = makeJsFunctionBody(prepareAsyncJsScript(script), true)
  return await new AsyncFunction('__env', `with (__env) { ${body} }`)(env)
}

function createJsRuntimeEnv(result: unknown, context: UrlBuildContext, asyncMode: boolean): JsRuntimeEnv {
  const keyword = context.keyword ?? ''
  const variables = context.variables ?? {}
  const initialResult = getJsRuntimeValue(result)
  const target: JsRuntimeEnv = {
    result: initialResult,
    src: valueToString(initialResult),
    key: keyword,
    keyword,
    searchKey: keyword,
    page: context.page ?? 1,
    baseUrl: context.baseUrl ?? context.source?.url ?? '',
    source: createSourceJsObject(context.source, variables),
    org: createOrgJsObject(),
    java: createJavaJsObject(context, asyncMode),
    navigator: {
      platform: 'Linux armv8l',
      userAgent: 'Mozilla/5.0 (Linux; Android 9) Mobile Safari/537.36',
      maxTouchPoints: 5
    },
    window: createSafeJsWindow(),
    alert: () => undefined,
    Ajax: createNoopAjax(),
    console,
    eval: async (code: unknown) => {
      const nested = exposeEvalDeclarations(String(code ?? ''))
      if (!nested.trim()) return undefined
      return await runAsyncJsInEnv(nested, proxy)
    }
  }

  const proxy = new Proxy(target, {
    has() {
      return true
    },
    get(object, property) {
      if (property === Symbol.unscopables) return undefined
      if (property in object) return object[property as keyof typeof object]
      if (property in globalThis) return (globalThis as unknown as Record<PropertyKey, unknown>)[property]
      return undefined
    },
    set(object, property, value) {
      object[property as keyof typeof object] = value
      if (property === 'result') object.src = valueToString(value)
      if (property === 'src') object.result = valueToString(value)
      return true
    }
  })

  return proxy
}

function exposeEvalDeclarations(script: string) {
  return script.replace(/(^|[\n;])(\s*)function\s+([A-Za-z_$][\w$]*)\s*\(/g, '$1$2$3 = function $3(')
}

function createSafeJsWindow() {
  return {
    document: typeof document === 'undefined' ? undefined : document,
    navigator: {
      platform: 'Linux armv8l',
      userAgent: 'Mozilla/5.0 (Linux; Android 9) Mobile Safari/537.36',
      maxTouchPoints: 5
    },
    location: {
      href: globalThis.location?.href || '',
      reload: () => undefined
    }
  }
}

function createNoopAjax() {
  return {
    readyState: 0,
    status: 0,
    responseText: '',
    onreadystatechange: null as null | (() => void),
    open: () => undefined,
    send() {
      this.readyState = 4
      this.status = 204
      this.onreadystatechange?.()
    }
  }
}

function createSourceJsObject(source: BookSourceConfig | undefined, variables: Record<string, string>) {
  const raw = source?.raw ?? {}
  const sourceUrl = source?.url || toSourceString(raw.bookSourceUrl || raw.sourceUrl || raw.url).trim()
  const api: Record<string, unknown> = {
    ...raw,
    key: sourceUrl,
    url: sourceUrl,
    bookSourceUrl: sourceUrl,
    bookSourceName: source?.name || toCleanString(raw.bookSourceName || raw.sourceName || raw.name),
    bookSourceComment: toSourceString(raw.bookSourceComment),
    searchUrl: source?.searchUrl || toSourceString(raw.searchUrl).trim(),
    loginUrl: source?.loginUrl || toSourceString(raw.loginUrl).trim(),
    getKey: () => sourceUrl,
    get: (key: string) => variables[key] ?? '',
    put: (key: string, value: unknown) => {
      variables[key] = valueToString(value)
      return variables[key]
    }
  }
  return api
}

function createJavaJsObject(context: UrlBuildContext, asyncMode: boolean) {
  const requestText = async (url: unknown, override?: Partial<SourceRequest>) => {
    if (!asyncMode || !context.fetchText) return ''
    const built = await buildSourceRequest(String(url ?? ''), { ...context, appendKeywordToGet: false })
    const request = { ...built.request, ...override }
    if (override?.headers) request.headers = { ...(built.request.headers || {}), ...override.headers }
    if (override?.body !== undefined && !override.method) request.method = 'POST'
    if (request.method) request.method = request.method.toUpperCase()
    let text = await context.fetchText(request)
    if (shouldRetryScriptRequest(request.url, text)) {
      const retryRequest = withScriptRetryHeaders(request, context)
      text = await context.fetchText(retryRequest)
      if (retryRequest.responseUrl) request.responseUrl = retryRequest.responseUrl
    }
    if (request.responseUrl) context.baseUrl = request.responseUrl
    return text
  }
  const requestVerification = async (url: unknown, options: SourceVerificationOptions) => {
    if (!context.source) throw new Error('书源需要验证')
    const built = await buildSourceRequest(String(url ?? ''), {
      ...context,
      baseUrl: context.baseUrl || context.source.url,
      appendKeywordToGet: false
    })
    if (context.getVerificationCode) return await context.getVerificationCode(built.request, context.source, options)
    throw new SourceVerificationError(context.source, built.request.url, built.request, options)
  }

  return {
    ajax: requestText,
    connect: requestText,
    get: requestText,
    post: async (url: unknown, body?: unknown) => {
      const override: Partial<SourceRequest> = { method: 'POST' }
      if (body !== undefined) override.body = normalizeBody(body)
      return await requestText(url, override)
    },
    ajaxAll: async (items: unknown[]) => {
      if (!Array.isArray(items)) return []
      return await Promise.all(items.map((item) => requestText(item)))
    },
    ajaxAllStr: async (items: unknown[]) => {
      if (!Array.isArray(items)) return ''
      return (await Promise.all(items.map((item) => requestText(item)))).join('\n')
    },
    ajaxUrl: async (url: unknown) => {
      if (!asyncMode || !context.fetchText) return ''
      const built = await buildSourceRequest(String(url ?? ''), { ...context, appendKeywordToGet: false })
      await context.fetchText(built.request)
      if (built.request.responseUrl) context.baseUrl = built.request.responseUrl
      return built.request.responseUrl || built.request.url
    },
    encodeURI: (value: unknown, charset?: unknown) =>
      encodeFormValueByCharset(String(value ?? ''), toCleanString(charset) || 'utf-8'),
    encodeURIComponent: (value: unknown, charset?: unknown) =>
      encodeByCharset(String(value ?? ''), toCleanString(charset) || 'utf-8'),
    getVerificationCode: async (url: unknown) => await requestVerification(url, { mode: 'image' }),
    getVerificationCodeAsync: async (url: unknown) => await requestVerification(url, { mode: 'image' }),
    getVerificationCodeSync: (url: unknown) => {
      if (context.source) {
        throw new SourceVerificationError(
          context.source,
          resolveUrl(context.baseUrl || context.source.url, String(url ?? '')),
          undefined,
          { mode: 'image' }
        )
      }
      throw new Error('书源需要验证码')
    },
    startBrowser: async (url: unknown, title?: unknown) => {
      await requestVerification(url, {
        mode: 'browser',
        title: toCleanString(title),
        waitForResult: false
      })
      return ''
    },
    startBrowserAwait: async (url: unknown, title?: unknown, refetchAfterSuccess?: unknown) => {
      const body = await requestVerification(url, {
        mode: 'browser',
        title: toCleanString(title),
        waitForResult: true,
        refetchAfterSuccess: refetchAfterSuccess === undefined ? true : refetchAfterSuccess !== false
      })
      return createStrResponse(String(url ?? ''), body)
    },
    setContent: (value: unknown) => {
      if (context.variables) context.variables[JS_CONTENT_OVERRIDE_KEY] = valueToString(value)
      return value
    }
  }
}

function shouldRetryScriptRequest(url: string, text: string) {
  if (!/\.js(?:[?#]|$)/i.test(stripUrlOptions(url))) return false
  const sample = text.slice(0, 400).trim()
  return !sample || /^<!doctype html\b|^<html\b|^<head\b|^<body\b/i.test(sample)
}

function withScriptRetryHeaders(request: SourceRequest, context: UrlBuildContext): SourceRequest {
  const headers = { ...(request.headers || {}) }
  if (!hasHeader(headers, 'Referer')) {
    const referer = context.currentRequestUrl || context.baseUrl || context.source?.url || request.sourceUrl
    if (referer) headers.Referer = stripUrlOptions(referer)
  }
  if (!hasHeader(headers, 'Cache-Control')) headers['Cache-Control'] = 'no-cache'
  return {
    ...request,
    headers
  }
}

function hasHeader(headers: Record<string, string>, name: string) {
  const target = name.toLowerCase()
  return Object.keys(headers).some((key) => key.toLowerCase() === target)
}

function createStrResponse(url: string, body: string) {
  return {
    url,
    body: () => body,
    bodyStr: body,
    toString: () => body
  }
}

function createOrgJsObject() {
  return {
    jsoup: {
      Jsoup: {
        parse: (html: unknown) => createJsoupDocument(valueToString(html))
      }
    }
  }
}

function createJsoupDocument(html: string) {
  const document = parseHtml(html)
  return {
    select: (selector: string) => createJsoupSelection(selectHtmlPart(document, selector)),
    text: () => toCleanString(document.body?.textContent || document.documentElement?.textContent),
    html: () => document.documentElement?.innerHTML || '',
    outerHtml: () => document.documentElement?.outerHTML || '',
    toString: () => document.documentElement?.outerHTML || html
  }
}

function createJsoupSelection(elements: Element[]): JsoupSelection {
  const wrappers = elements.map(createJsoupElement)
  const selection: Partial<JsoupSelection> = {
    length: wrappers.length,
    [Symbol.iterator]: function* () {
      yield* wrappers
    },
    attr(name: string, value?: string): string | JsoupSelection {
      if (value !== undefined) {
        wrappers.forEach((item) => {
          item.attr(name, value)
        })
        return selection as JsoupSelection
      }
      return wrappers[0]?.raw.getAttribute(name) || ''
    },
    text: () => toCleanString(wrappers.map((item) => item.text()).join(' ')),
    html: () => wrappers.map((item) => item.html()).join(''),
    outerHtml: () => wrappers.map((item) => item.outerHtml()).join(''),
    select: (selector: string) =>
      createJsoupSelection(wrappers.flatMap((item) => selectHtmlPart(item.raw, selector))),
    toString: () => wrappers.map((item) => item.outerHtml()).join('')
  }
  wrappers.forEach((wrapper, index) => {
    selection[index] = wrapper
  })
  return selection as JsoupSelection
}

function createJsoupElement(element: Element): JsoupElement {
  const wrapper: JsoupElement = {
    raw: element,
    attr(name: string, value?: string) {
      if (value !== undefined) {
        element.setAttribute(name, value)
        return wrapper
      }
      return element.getAttribute(name) || ''
    },
    text: () => toCleanString(element.textContent),
    html: () => element.innerHTML,
    outerHtml: () => element.outerHTML,
    select: (selector: string) => createJsoupSelection(selectHtmlPart(element, selector)),
    toString: () => element.outerHTML
  }
  return wrapper
}

function prepareAsyncJsScript(script: string) {
  return wrapAwaitableJavaCalls(script)
    .replace(/\beval\s*\(/g, (match, offset: number, full: string) =>
      /await\s+$/.test(full.slice(Math.max(0, offset - 10), offset)) ? match : 'await eval('
    )
}

function wrapAwaitableJavaCalls(script: string) {
  const methods =
    'ajaxAllStr|ajaxAll|ajaxUrl|connect|getVerificationCodeAsync|getVerificationCode|startBrowserAwait|startBrowser|post|get|ajax'
  const pattern = new RegExp(`\\bjava\\.(${methods})\\s*\\(`, 'g')
  let output = ''
  let cursor = 0
  let match: RegExpExecArray | null

  while ((match = pattern.exec(script)) !== null) {
    const start = match.index
    const openIndex = pattern.lastIndex - 1
    const closeIndex = findBalancedClose(script, openIndex, '(', ')')
    if (closeIndex < 0) continue

    output += script.slice(cursor, start)
    const call = script.slice(start, closeIndex + 1)
    const separator = isAwaitCallStatementStart(script, start) ? ';' : ''
    output += hasAwaitBefore(script, start) ? call : `${separator}(await ${call})`
    cursor = closeIndex + 1
    pattern.lastIndex = closeIndex + 1
  }

  return output + script.slice(cursor)
}

function isAwaitCallStatementStart(script: string, index: number) {
  const lineStart = Math.max(script.lastIndexOf('\n', index - 1), script.lastIndexOf('\r', index - 1)) + 1
  return script.slice(lineStart, index).trim() === ''
}

function hasAwaitBefore(script: string, index: number) {
  return /(?:^|[^\w$])await\s*$/.test(script.slice(Math.max(0, index - 16), index))
}

function makeJsFunctionBody(script: string, asyncMode: boolean) {
  const normalized = script.trim()
  if (!normalized) return 'return undefined;'
  if (/^\s*return\b/.test(normalized)) return normalized

  const expressionBody = makeTrailingExpressionReturn(normalized)
  if (expressionBody) return expressionBody

  return `${normalized}\n; return typeof result !== "undefined" ? result : (typeof url !== "undefined" ? url : undefined);`
}

function makeTrailingExpressionReturn(script: string) {
  const lines = script.replace(/\r\n/g, '\n').split('\n')
  const lastIndex = findLastExpressionLine(lines)
  if (lastIndex < 0) return ''

  const line = lines[lastIndex]
  const indent = line.match(/^\s*/)?.[0] || ''
  const candidate = line.trim().replace(/;$/, '').trim()
  if (!isLikelyJsExpression(candidate)) return ''

  lines[lastIndex] = `${indent}return (${candidate});`
  return lines.join('\n')
}

function findLastExpressionLine(lines: string[]) {
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    const line = lines[index].trim()
    if (!line || line.startsWith('//') || line.startsWith('*')) continue
    return index
  }
  return -1
}

function isLikelyJsExpression(line: string) {
  if (!line || line === '}' || line.endsWith('{')) return false
  if (/^(?:if|else|for|while|switch|try|catch|finally|do|class|function|var|let|const|throw|break|continue)\b/.test(line)) return false
  if (/^\}|\belse\b/.test(line)) return false
  return true
}

function getRule(rules: BookSourceRuleSet, ...keys: string[]) {
  for (const key of keys) {
    const value = rules[key]
    if (typeof value === 'string' && value.trim()) return value.trim()
  }
  return ''
}

function hasAnyRule(rules: BookSourceRuleSet, keys: string[]) {
  return keys.some((key) => typeof rules[key] === 'string' && String(rules[key]).trim())
}

function parseListRulePrefix(rule: string) {
  const trimmed = rule.trim()
  if (trimmed.startsWith('-')) return { rule: trimmed.slice(1).trim(), reverse: true, allInOne: false }
  if (trimmed.startsWith('+')) return { rule: trimmed.slice(1).trim(), reverse: false, allInOne: true }
  return { rule: trimmed, reverse: false, allInOne: false }
}

async function applyRuleInit(analyzer: LegadoAnalyzer, initRule: string) {
  if (!initRule) return analyzer
  const elements = await analyzer.getElementsAsync(initRule)
  if (elements.length) return analyzer.withContent(elements[0], analyzer.redirectBaseUrl)
  await analyzer.getStringAsync(initRule)
  return analyzer
}

function getObjectPathValue(item: unknown, path: string): unknown {
  if (!path || !isRecord(item)) return undefined
  const normalized = path.replace(/^\$\.?/, '')
  if (!normalized) return item
  const parts = normalized
    .replace(/\[(?:'([^']+)'|"([^"]+)"|(\d+))\]/g, (_match, single: string, double: string, index: string) => {
      return `.${single || double || index}`
    })
    .split('.')
    .map((part) => part.trim())
    .filter(Boolean)

  let current: unknown = item
  for (const part of parts) {
    if (Array.isArray(current)) {
      const index = Number(part)
      if (!Number.isInteger(index)) return undefined
      current = current[index < 0 ? current.length + index : index]
    } else if (isRecord(current)) {
      current = current[part]
    } else {
      return undefined
    }
  }

  return current
}

function isBookDetailUrl(source: BookSourceConfig, url: string) {
  const pattern = source.bookUrlPattern.trim()
  if (!pattern || !url) return false
  try {
    return new RegExp(pattern).test(stripUrlOptions(url))
  } catch (error) {
    return false
  }
}

function resolveRuleUrl(baseUrl: string, value: string) {
  const split = splitUrlOptions(toCleanString(value))
  if (!split.url) return ''
  const resolved = resolveUrl(baseUrl, split.url)
  return split.optionsText ? `${resolved},${split.optionsText}` : resolved
}

function resolveUrl(baseUrl: string, value: string) {
  const url = toCleanString(value)
  if (!url) return ''

  try {
    return new URL(url, baseUrl || globalThis.location?.href || 'http://localhost/').toString()
  } catch (error) {
    return url
  }
}

function looksLikeVerificationError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error ?? '')
  return /HTTP\s*(401|403|429)|验证码|访问验证|安全验证|人机验证|captcha|verification|challenge|cloudflare/i.test(message)
}

function looksLikeDeferredChallengePage(text: string) {
  const sample = text.slice(0, 16000).replace(/\s+/g, ' ')
  if (!sample) return false
  const hasLoadingHint =
    /内容正在载入|正在载入|正在加载|请稍候|请刷新|loading|please wait|just a moment|checking your browser/i.test(sample)
  const hasChallengeScript = /<script\b|location\.reload|c2\s*=|challenge|captcha/i.test(sample)
  return hasLoadingHint && hasChallengeScript
}

function sourceRuleUsesImageVerification(rule: string) {
  return /\bgetVerificationCode(?:Async|Sync)?\s*\(/.test(rule)
}

async function createDeferredVerificationRequest(
  source: BookSourceConfig,
  rule: string,
  baseUrl: string,
  mode: SourceVerificationOptions['mode']
) {
  const fallbackUrl = baseUrl || source.url || source.searchUrl
  if (mode !== 'image') return createSourceVerificationRequest(source, fallbackUrl)

  const imageRule = inferImageVerificationRule(rule, source, fallbackUrl)
  if (!imageRule) return createSourceVerificationRequest(source, fallbackUrl)

  try {
    return (await buildSourceRequest(imageRule, {
      source,
      baseUrl: fallbackUrl || source.url,
      page: 1,
      appendKeywordToGet: false
    })).request
  } catch (error) {
    return createSourceVerificationRequest(source, fallbackUrl)
  }
}

function inferImageVerificationRule(rule: string, source: BookSourceConfig, baseUrl: string) {
  const script = extractFirstJsBlock(rule) || rule
  const call = extractGetVerificationCodeArgument(script)
  if (!call) return ''

  const variables = inferSimpleJsVariables(script.slice(0, call.start), source, baseUrl)
  return resolveSimpleJsExpression(call.argument, variables)
}

function extractFirstJsBlock(rule: string) {
  return rule.match(/<js>([\s\S]*?)<\/js>/i)?.[1] || ''
}

function extractGetVerificationCodeArgument(script: string) {
  const match = /\bgetVerificationCode(?:Async|Sync)?\s*\(/.exec(script)
  if (!match) return null

  const openIndex = match.index + match[0].lastIndexOf('(')
  const closeIndex = findBalancedClose(script, openIndex, '(', ')')
  if (closeIndex < 0) return null

  return {
    start: match.index,
    argument: script.slice(openIndex + 1, closeIndex).trim()
  }
}

function inferSimpleJsVariables(script: string, source: BookSourceConfig, baseUrl: string) {
  const variables: Record<string, string> = {
    baseUrl,
    su: source.url,
    url: source.url
  }
  const assignmentPattern = /(?:^|[;\n\r])\s*(?:var|let|const)?\s*([A-Za-z_$][\w$]*)\s*=\s*([^;\n\r]+)/g
  let match: RegExpExecArray | null

  while ((match = assignmentPattern.exec(script)) !== null) {
    const key = match[1]
    const value = resolveSimpleJsExpression(match[2], variables, source)
    if (value) variables[key] = value
  }

  return variables
}

function resolveSimpleJsExpression(expression: string, variables: Record<string, string>, source?: BookSourceConfig): string {
  const trimmed = expression.trim().replace(/;$/, '').trim()
  if (!trimmed) return ''
  if (/^source\.(?:getKey\(\)|key|url|bookSourceUrl)$/.test(trimmed)) return source?.url || variables.su || ''
  if (/^[A-Za-z_$][\w$]*$/.test(trimmed)) return variables[trimmed] || ''

  const literal = parseSimpleJsStringLiteral(trimmed, variables)
  if (literal !== null) return literal

  const parts = splitSimpleConcatExpression(trimmed)
  if (parts.length > 1) {
    const value: string = parts.map((part) => resolveSimpleJsExpression(part, variables, source)).join('')
    if (value) return value
  }

  return ''
}

function parseSimpleJsStringLiteral(expression: string, variables: Record<string, string>) {
  const quote = expression[0]
  if ((quote !== '"' && quote !== "'" && quote !== '`') || expression.at(-1) !== quote) return null

  const body = expression.slice(1, -1)
  const unescaped = body.replace(/\\([`'"\\])/g, '$1')
  if (quote !== '`') return unescaped

  return unescaped.replace(/\$\{\s*([A-Za-z_$][\w$]*)\s*\}/g, (_match, key: string) => variables[key] || '')
}

function splitSimpleConcatExpression(expression: string) {
  const parts: string[] = []
  let cursor = 0
  let quote = ''
  let depth = 0

  for (let index = 0; index < expression.length; index += 1) {
    const char = expression[index]
    if (quote) {
      if (char === '\\') {
        index += 1
      } else if (char === quote) {
        quote = ''
      }
      continue
    }
    if (char === '"' || char === "'" || char === '`') {
      quote = char
      continue
    }
    if (char === '(') depth += 1
    if (char === ')') depth = Math.max(0, depth - 1)
    if (char !== '+' || depth > 0) continue

    parts.push(expression.slice(cursor, index).trim())
    cursor = index + 1
  }

  parts.push(expression.slice(cursor).trim())
  return parts.filter(Boolean)
}

function createSourceVerificationRequest(source: BookSourceConfig, url: string): SourceRequest {
  return {
    url,
    sourceId: source.id,
    sourceName: source.name,
    sourceUrl: source.url || url,
    enabledCookieJar: source.enabledCookieJar !== false
  }
}

function normalizeUrlForVisit(url: string) {
  try {
    const parsed = new URL(stripUrlOptions(url), globalThis.location?.href || 'http://localhost/')
    parsed.hash = ''
    return parsed.toString()
  } catch (error) {
    return stripUrlOptions(url).split('#')[0]
  }
}

function isSameUrlIgnoringOptions(left: string, right: string) {
  return normalizeUrlForVisit(left) === normalizeUrlForVisit(right)
}

function getFallbackSearchItems(root: unknown): unknown[] {
  const html = asHtmlRoot(root)
  if (html) {
    const selectors = [
      '.book',
      '.book-item',
      '.result',
      '.result-item',
      '.search-result li',
      '.library li',
      'article',
      'li',
      'tr'
    ]

    for (const selector of selectors) {
      const items = Array.from(html.querySelectorAll(selector)).filter((item) => item.querySelector('a'))
      if (items.length) return items
    }
  }

  const jsonRoot = asJsonRoot(root)
  if (Array.isArray(jsonRoot)) return jsonRoot
  if (isRecord(jsonRoot)) {
    for (const key of ['data', 'books', 'list', 'items', 'result', 'results']) {
      const value = jsonRoot[key]
      if (Array.isArray(value)) return value
      const nested = getFallbackSearchItems(value)
      if (nested.length) return nested
    }
  }

  return []
}

function getFallbackChapterItems(root: unknown): unknown[] {
  const html = asHtmlRoot(root)
  if (html) {
    const links = Array.from(html.querySelectorAll('a')).filter((link) => {
      const text = toCleanString(link.textContent)
      return /第.{1,12}[章章节回卷集部篇幕]|番外|楔子|序章|尾声/.test(text)
    })
    if (links.length) return links
  }

  const jsonRoot = asJsonRoot(root)
  if (Array.isArray(jsonRoot)) return jsonRoot
  if (isRecord(jsonRoot)) {
    for (const key of ['chapters', 'chapterList', 'list', 'items', 'data']) {
      const value = jsonRoot[key]
      if (Array.isArray(value)) return value
      const nested = getFallbackChapterItems(value)
      if (nested.length) return nested
    }
  }

  return []
}

function getFallbackTitle(item: unknown) {
  if (isElement(item) || isDocument(item)) {
    const target = item.querySelector('a, h1, h2, h3, h4, .title, .name') || item
    return toCleanString(target.textContent)
  }

  return getFallbackField(item, ['name', 'title', 'bookName', 'chapterName'])
}

function getFallbackUrl(item: unknown) {
  if (isElement(item) || isDocument(item)) {
    const target = item.querySelector('a[href]') || (isElement(item) && item.matches('a[href]') ? item : null)
    return target ? toCleanString(target.getAttribute('href')) : ''
  }

  return getFallbackField(item, ['bookUrl', 'url', 'href', 'link', 'chapterUrl', 'detailUrl'])
}

function getFallbackField(item: unknown, keys: string[]): string {
  if (!isRecord(item)) return ''

  for (const key of keys) {
    const value = item[key]
    if (typeof value === 'string' || typeof value === 'number') return toCleanString(value)
  }

  for (const value of Object.values(item)) {
    if (!isRecord(value)) continue
    const nested = getFallbackField(value, keys)
    if (nested) return nested
  }

  return ''
}

function getFallbackContent(root: unknown) {
  const html = asHtmlRoot(root)
  if (html) {
    const main =
      html.querySelector('#content, .content, .chapter-content, .read-content, .reader, article') ||
      (isDocument(html) ? html.body : html)
    return main?.innerHTML || main?.textContent || ''
  }

  return getFallbackField(asJsonRoot(root), ['content', 'text', 'body'])
}

function formatBookName(value: string) {
  return toCleanString(value).replace(/^《|》$/g, '')
}

function formatBookAuthor(value: string) {
  return toCleanString(value)
    .replace(/^作者[:：\s]*/i, '')
    .replace(/^作\s*者[:：\s]*/i, '')
}

function tidyBriefText(value: string) {
  return formatHtmlText(value, '').replace(/\n+/g, ' ').slice(0, 5000).trim()
}

function formatHtmlText(value: string, baseUrl: string) {
  if (!/<[a-z][\s\S]*>/i.test(value)) return value
  return value
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<img[^>]*(?:data-src|src)=["']([^"']+)["'][^>]*>/gi, (_match, url: string) => `\n${resolveUrl(baseUrl, url)}\n`)
    .replace(/<\/?(?:div|p|br|hr|h\d|article|dd|dl|li|tr)[^>]*>/gi, '\n')
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<[^>]+>/g, '')
}

function tidyNovelContent(content: string) {
  return decodeHtmlEntities(content)
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .replace(/&nbsp;/g, ' ')
    .replace(/\u00a0/g, ' ')
    .replace(/[\u2009\u200c\u200d]/g, '')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n\s+/g, '\n')
    .replace(/\n{4,}/g, '\n\n\n')
    .trim()
}

function decodeHtmlEntities(value: string) {
  if (!value.includes('&')) return value
  const textarea = document.createElement('textarea')
  textarea.innerHTML = value
  return textarea.value
}

function applyContentReplaceRule(content: string, replaceRule: string) {
  if (!replaceRule) return tidyNovelContent(content)
  const parsed = parseSourceRule(replaceRule, content, false)
  return tidyNovelContent(replaceByParsedRule(content, parsed))
}

function dedupeResults(results: SourceSearchResult[]) {
  const seen = new Set<string>()
  const deduped: SourceSearchResult[] = []

  for (const result of results) {
    const key = `${result.sourceId}:${normalizeUrlForVisit(result.bookUrl || result.title)}`
    if (seen.has(key)) continue
    seen.add(key)
    deduped.push({ ...result, key })
  }

  return deduped
}

function dedupeChapters(chapters: SourceChapter[]) {
  const seen = new Set<string>()
  const deduped: SourceChapter[] = []

  for (const chapter of chapters) {
    const key = normalizeUrlForVisit(chapter.url || chapter.title)
    if (seen.has(key)) continue
    seen.add(key)
    deduped.push(chapter)
  }

  return deduped
}

function dedupeStrings(items: string[]) {
  return [...new Set(items)]
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}
