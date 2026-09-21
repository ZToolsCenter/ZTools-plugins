// 开源阅读（Legado）在线同步客户端
// 对接「阅读」APP 的 Web 服务与「阅读网页版」HTTP 接口，用于拉取书架、目录与正文，并回写阅读进度。

export interface LegadoConfig {
  enabled: boolean
  /** 1 = 阅读 APP Web 服务；2 = 阅读网页版 */
  type: 1 | 2
  url: string
  accessToken: string
}

export interface LegadoBook {
  url: string
  name: string
  author: string
  cover: string
  /** Legado 书架分组（WebBook.group），如「玄幻」「我的书架」 */
  group: string
  intro: string
  kind: string
  wordCount: string
  latestChapterTitle: string
  originName: string
  /** 章节索引（durChapterIndex） */
  progress: number
  /** 章节内位置（durChapterPos） */
  chapterProgress: number
  chapterCount: number
  updateTime: number
}

const services = () => (window as any).services

function buildBase(cfg: LegadoConfig): string {
  if (cfg.type === 2 && cfg.accessToken) {
    const sep = cfg.url.includes('?') ? '&' : '?'
    return `${cfg.url}${sep}accessToken=${encodeURIComponent(cfg.accessToken)}`
  }
  return cfg.url
}

function absUrl(url: string, base: string): string {
  if (!url) return ''
  if (/^https?:\/\//i.test(url)) return url
  if (url.startsWith('//')) {
    const proto = base.slice(0, base.indexOf('//'))
    return proto ? `${proto}${url}` : url
  }
  try {
    return new URL(url, base).href
  } catch {
    return url
  }
}

/**
 * 封面地址转可下载 URL：
 * - http(s) 链接原样返回
 * - 本地路径（content:// / file:// / /storage 等）→ Legado 的 /cover?path= 接口
 *   （该接口在 APP 内读取本地图并返回缩略图 PNG，BookController.getCover）
 * - 其他相对路径 → 基于服务地址拼接
 */
function coverUrl(url: string, base: string): string {
  if (!url) return ''
  if (/^https?:\/\//i.test(url)) return url
  if (url.startsWith('content://') || url.startsWith('file://') || url.startsWith('/') || url.startsWith('storage')) {
    return `${base}/cover?path=${encodeURIComponent(url)}`
  }
  return absUrl(url, base)
}

function preview(text: string, len = 120): string {
  return (text || '').replace(/\s+/g, ' ').slice(0, len)
}

/**
 * 解包 Legado 标准响应（ReturnData）：{"isSuccess":true,"errorMsg":"","data":<任意>}
 * 兼容直接返回数组/字符串/对象的老服务端（网页版等）：无 errorMsg 字段时原样返回。
 */
function unwrapReturnData(data: any): { ok: boolean; error?: string; data: any } {
  if (data && typeof data === 'object' && !Array.isArray(data) && typeof data.errorMsg === 'string') {
    if (data.errorMsg) return { ok: false, error: data.errorMsg, data: data.data }
    return { ok: true, data: data.data }
  }
  return { ok: true, data }
}

/**
 * 容错 JSON 请求：拿到状态码与响应头；响应不是合法 JSON 时给出
 * 带状态码/内容预览的明确错误（而非底层 JSON.parse 的乱码报错）。
 */
async function getJson(url: string): Promise<any> {
  const servicesApi = services()
  let status = 200
  let contentType = ''
  let text = ''
  if (servicesApi.httpGetResponse) {
    const res = await servicesApi.httpGetResponse(url, { timeout: 20000 })
    status = res.status
    contentType = String(res.headers?.['content-type'] || '')
    text = res.text
  } else if (servicesApi.httpGetJson) {
    // 旧 preload 兜底（无法区分编码问题与接口问题）
    try {
      return await servicesApi.httpGetJson(url, { timeout: 20000 })
    } catch (e: any) {
      throw new Error(`开源阅读接口请求失败：${e?.message || e}`)
    }
  } else {
    throw new Error('当前环境不支持网络请求')
  }
  if (status >= 400) {
    throw new Error(`开源阅读接口返回 HTTP ${status}（${contentType || '未知类型'}）`)
  }
  console.log(`[hushreader:legado] ${url} → HTTP ${status}，${text.length} 字符`)
  let parsed: any
  try {
    parsed = JSON.parse(text)
  } catch (e: any) {
    console.warn(`[hushreader:legado] 接口返回非 JSON：${url}（HTTP ${status}，${contentType || '未知类型'}）`, e)
    const isLocalFile = url.includes('content://') || url.includes('file://')
    throw new Error(
      `开源阅读接口返回的不是合法 JSON（HTTP ${status}，${contentType || '未知类型'}）。返回内容开头：「${preview(text)}」` +
      (text.startsWith('<')
        ? isLocalFile
          ? '—— 该书是本地文件（EPUB/TXT），Web 服务不支持其目录/正文接口，请在手机端阅读，或改用该书的在线书源'
          : '—— 返回的是网页而非接口数据，请检查服务地址/接口路径是否正确'
        : '')
    )
  }
  // Legado 标准响应（ReturnData）中 errorMsg 非空 = 接口业务失败（如「未找到」）
  const unwrapped = unwrapReturnData(parsed)
  if (!unwrapped.ok) {
    throw new Error(`开源阅读接口返回错误：${unwrapped.error}`)
  }
  return unwrapped.data
}

/** 获取 Legado 书架（含分组、封面、简介等完整元数据） */
export async function getLegadoBooks(cfg: LegadoConfig): Promise<LegadoBook[]> {
  const base = buildBase(cfg)
  const data = await getJson(`${base}/getBookshelf`)
  const list = Array.isArray(data) ? data : data?.bookshelf ?? data?.data ?? []
  return list.map((item: any) => ({
    url: absUrl(item.url || item.bookUrl || '', base),
    name: item.name || item.bookName || '',
    author: item.author || '',
    cover: coverUrl(item.coverUrl || item.cover || '', base),
    group: item.group || '',
    intro: item.introduction || item.intro || item.desc || '',
    kind: item.kind || '',
    wordCount: String(item.wordCount ?? item.wordCountText ?? ''),
    latestChapterTitle: item.latestChapterTitle || '',
    originName: item.originName || item.origin || '',
    progress: Number(item.durChapterIndex ?? item.progress ?? 0),
    chapterProgress: Number(item.durChapterPos ?? item.chapterProgress ?? 0),
    chapterCount: Number(item.totalChapterNum ?? item.chapterCount ?? 0),
    updateTime: Number(item.updateTime ?? item.update ?? 0) || 0
  }))
}

/** 获取目录 */
export async function getLegadoChapterList(cfg: LegadoConfig, bookUrl: string): Promise<{ title: string; index: number }[]> {
  const base = buildBase(cfg)
  const data = await getJson(`${base}/getChapterList?url=${encodeURIComponent(bookUrl)}`)
  const list = Array.isArray(data) ? data : data?.chapters ?? data?.data ?? []
  return list.map((item: any, i: number) => ({
    title: item.title || `第${(item.index ?? i) + 1}章`,
    index: Number(item.index ?? i)
  }))
}

/** 获取章节正文 */
export async function getLegadoContent(cfg: LegadoConfig, bookUrl: string, index: number): Promise<string> {
  const base = buildBase(cfg)
  const data = await getJson(`${base}/getBookContent?url=${encodeURIComponent(bookUrl)}&index=${index}`)
  let content = ''
  // Legado 标准响应经 getJson 解包后：data 就是正文字符串
  if (typeof data === 'string') content = data
  // 兼容直接返回 {content} / {data:{content}} 的服务端
  else if (data?.content != null) content = data.content
  else if (data?.data?.content != null) content = data.data.content
  return typeof content === 'string' ? content.trim() : ''
}

/** 回写阅读进度 */
export async function saveLegadoProgress(
  cfg: LegadoConfig,
  bookUrl: string,
  name: string,
  author: string,
  chapterIndex: number,
  charIndex: number
): Promise<void> {
  const base = buildBase(cfg)
  if (cfg.type === 1) {
    await services().httpPostJson(`${base}/saveBookProgress`, {
      name,
      author,
      durChapterIndex: chapterIndex,
      durChapterPos: charIndex,
      durChapterTime: Math.floor(Date.now() / 1000),
      durChapterTitle: '',
      updateTime: Date.now()
    })
  } else {
    await services().httpPostJson(`${base}/saveBookProgress`, {
      url: bookUrl,
      index: chapterIndex
    })
  }
}

/** 通知 Legado 删除书籍（用于从书架移除同步书） */
export async function deleteLegadoBook(cfg: LegadoConfig, bookUrl: string): Promise<void> {
  const base = buildBase(cfg)
  await services().httpPostJson(`${base}/deleteBook`, { url: bookUrl, bookUrl })
}
