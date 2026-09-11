import type { IconCollection, IconItem, IconPage } from '../types/icon'

const API_HOSTS = [
  'https://api.iconify.design',
  'https://api.simplesvg.com',
  'https://api.unisvg.com'
] as const

export const DEFAULT_PAGE_SIZE = 48
const INITIAL_LIMIT = DEFAULT_PAGE_SIZE * 2
const MAX_LIMIT = 999

const CHINESE_KEYWORDS: Record<string, string> = {
  客户服务: 'customer support',
  客服: 'customer support',
  首页: 'home',
  房子: 'home',
  用户: 'user',
  人员: 'people',
  设置: 'settings',
  搜索: 'search',
  菜单: 'menu',
  关闭: 'close',
  删除: 'delete',
  编辑: 'edit',
  保存: 'save',
  下载: 'download',
  上传: 'upload',
  复制: 'copy',
  分享: 'share',
  添加: 'add',
  减少: 'minus',
  确认: 'check',
  警告: 'warning',
  信息: 'info',
  帮助: 'help',
  邮件: 'mail',
  电话: 'phone',
  日历: 'calendar',
  时间: 'clock',
  位置: 'location',
  地图: 'map',
  图片: 'image',
  相机: 'camera',
  播放: 'play',
  暂停: 'pause',
  音乐: 'music',
  文件: 'file',
  文件夹: 'folder',
  链接: 'link',
  锁定: 'lock',
  解锁: 'unlock',
  眼睛: 'eye',
  购物车: 'cart',
  收藏: 'star',
  喜欢: 'heart',
  刷新: 'refresh',
  筛选: 'filter',
  打印: 'print',
  云: 'cloud',
  代码: 'code',
  终端: 'terminal'
}

interface SearchResponse {
  icons: string[]
  total: number
  limit: number
  start: number
  collections: Record<string, IconCollection>
}

interface SearchCache {
  icons: string[]
  collections: Record<string, IconCollection>
  fullyLoaded: boolean
  capped: boolean
}

export interface FetchLike {
  (input: RequestInfo | URL, init?: RequestInit): Promise<Response>
}

export function normalizeSearchQuery(query: string): string {
  const trimmed = query.trim().replace(/\s+/g, ' ')
  if (!/[\u3400-\u9fff]/.test(trimmed)) return trimmed

  let translated = trimmed
  const entries = Object.entries(CHINESE_KEYWORDS).sort(([left], [right]) => right.length - left.length)
  for (const [chinese, english] of entries) {
    translated = translated.split(chinese).join(` ${english} `)
  }

  const withoutUnknownChinese = translated.replace(/[\u3400-\u9fff]+/g, ' ')
  const normalized = withoutUnknownChinese.trim().replace(/\s+/g, ' ')
  return normalized || trimmed
}

function parseIcon(id: string, collections: Record<string, IconCollection>): IconItem {
  const separator = id.indexOf(':')
  const prefix = id.slice(0, separator)
  const name = id.slice(separator + 1)
  const collection = collections[prefix]

  return {
    id,
    prefix,
    name,
    collectionName: collection?.name || prefix,
    palette: collection?.palette === true,
    license: collection?.license
  }
}

export function iconSvgUrl(id: string, color?: string, host: string = API_HOSTS[0]): string {
  const [prefix, name] = id.split(':')
  const url = new URL(`${host}/${encodeURIComponent(prefix)}/${encodeURIComponent(name)}.svg`)
  if (color) url.searchParams.set('color', color)
  return url.toString()
}

export class IconifyClient {
  private readonly cache = new Map<string, SearchCache>()

  constructor(private readonly fetcher: FetchLike = (input, init) => globalThis.fetch(input, init)) {}

  async search(query: string, page = 1, pageSize = DEFAULT_PAGE_SIZE, signal?: AbortSignal): Promise<IconPage> {
    const effectiveQuery = normalizeSearchQuery(query)
    if (!effectiveQuery) throw new Error('请输入搜索关键词')
    if (page < 1) throw new Error('页码必须从 1 开始')

    let cached = this.cache.get(effectiveQuery)
    if (!cached) {
      const response = await this.requestSearch(effectiveQuery, INITIAL_LIMIT, signal)
      cached = {
        icons: response.icons,
        collections: response.collections,
        fullyLoaded: response.icons.length < response.limit,
        capped: false
      }
      this.cache.set(effectiveQuery, cached)
    }

    const start = (page - 1) * pageSize
    if (start + pageSize > cached.icons.length && !cached.fullyLoaded) {
      const response = await this.requestSearch(effectiveQuery, MAX_LIMIT, signal)
      cached = {
        icons: response.icons,
        collections: response.collections,
        fullyLoaded: true,
        capped: response.icons.length >= MAX_LIMIT
      }
      this.cache.set(effectiveQuery, cached)
    }

    const items = cached.icons
      .slice(start, start + pageSize)
      .map((id) => parseIcon(id, cached.collections))

    return {
      items,
      page,
      pageSize,
      loadedCount: cached.icons.length,
      hasPrevious: page > 1,
      hasNext: start + pageSize < cached.icons.length || !cached.fullyLoaded,
      capped: cached.capped,
      effectiveQuery
    }
  }

  async getSvg(id: string, color?: string, signal?: AbortSignal): Promise<string> {
    let lastError: unknown
    for (const host of API_HOSTS) {
      try {
        const response = await this.fetcher(iconSvgUrl(id, color, host), {
          headers: { Accept: 'image/svg+xml' },
          signal
        })
        if (!response.ok) throw new Error(`HTTP ${response.status}`)
        return await response.text()
      } catch (error) {
        if (signal?.aborted) throw error
        lastError = error
      }
    }
    throw new Error(`无法获取图标：${lastError instanceof Error ? lastError.message : '网络错误'}`)
  }

  clear(): void {
    this.cache.clear()
  }

  private async requestSearch(query: string, limit: number, signal?: AbortSignal): Promise<SearchResponse> {
    let lastError: unknown
    for (const host of API_HOSTS) {
      const url = new URL(`${host}/search`)
      url.searchParams.set('query', query)
      url.searchParams.set('limit', String(limit))

      try {
        const response = await this.fetcher(url, {
          headers: { Accept: 'application/json' },
          signal
        })
        if (!response.ok) throw new Error(`HTTP ${response.status}`)
        return (await response.json()) as SearchResponse
      } catch (error) {
        if (signal?.aborted) throw error
        lastError = error
      }
    }
    throw new Error(`搜索服务暂时不可用：${lastError instanceof Error ? lastError.message : '网络错误'}`)
  }
}

export const iconifyClient = new IconifyClient()
