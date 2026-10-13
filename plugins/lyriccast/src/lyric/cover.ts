/**
 * 封面 API 兜底:手机未推送封面(无内嵌封面 / 关闭"发送封面"开关 / 推送失败)时,
 * 按曲目的 标题/歌手/专辑 从公开 API 拉取封面 URL,供主界面 <img> 直接展示。
 *
 * 来源按序探测,首个可用者胜出:
 * 1. LrcAPI(https://api.lrc.cx/cover)—— 拼接 title/artist/album 参数,服务端 301 重定向
 *    到实际图片(CDN)。该端点不带 CORS 头,fetch 校验不可行;用 new Image() 探测
 *    (图片加载不受 CORS 限制),验证通过后直接把端点 URL 交给 <img>(重定向在展示时
 *    由浏览器跟随,最终 CDN 地址不落库)。
 * 2. MusicBrainz + Cover Art Archive —— 按专辑名+歌手搜 release-group(官方公开 API,
 *    带 CORS),取前几个 MBID 依次探测 coverartarchive.org 的 front-500 图。
 *
 * 缓存(持久化,键 = 规范化 title|artist|album):
 * - 命中条目 30 天过期(封面基本不变,过期自动重探);
 * - 负缓存(全部来源确认没有)24 小时,避免冷门曲目每次切歌都空跑两轮探测;
 * - 展示时才发现 URL 失效(如 CDN 下线)经 markBroken 按元数据逐出缓存,下次重新探测。
 *
 * 运行环境:Electron 渲染进程(Chromium)与 Node 18+ 均有全局 fetch;
 * Image 探测仅在浏览器环境可用,测试注入替身。
 */
import { RequestSupervisor, fetchJson } from './fetcher'
import { normalizeText } from './normalize'
import type { KVStorage } from './cache'

/** 一次封面查询的输入(来自手机推送的 track 快照,字段与 TrackForLyrics 对齐) */
export interface CoverQuery {
  title: string
  artist: string
  album: string
}

/** 封面获取结果:url 供 <img> 直接使用;source 标注来源(诊断展示用) */
export interface CoverEntry {
  url: string
  source: string
}

/** 图片可用性探测:URL 能作为图片加载则 resolve(true) */
export type ProbeImage = (url: string, timeoutMs: number, signal: AbortSignal) => Promise<boolean>

/** 封面数据源接口:实现方自行拼接/搜索并探测,失败返回 null(不抛错) */
export interface CoverSource {
  /** 来源标识(写入 CoverEntry.source) */
  name: string
  /** 查询封面;返回可直接用于 <img> 的 URL,无封面/探测失败返回 null */
  fetchCover(query: CoverQuery, signal: AbortSignal): Promise<string | null>
}

const LRCAPI_BASE = 'https://api.lrc.cx/cover'
const MUSICBRAINZ_BASE = 'https://musicbrainz.org/ws/2/release-group'
const COVERART_BASE = 'https://coverartarchive.org/release-group'
const TIMEOUT_MS = 5_000
/** 整次封面获取的总预算(LrcAPI 探测 + CAA 搜索 + 最多 3 次图片探测) */
const BUDGET_MS = 20_000
/** CAA 搜索取前几个 release-group 依次探测(无封面的分组 404,跳过下一个) */
const MAX_CAA_TRIES = 3
const UA = 'lyriccast-ztools-plugin/0.3'

const HIT_TTL_MS = 30 * 24 * 60 * 60 * 1000
const NEGATIVE_TTL_MS = 24 * 60 * 60 * 1000
const PREFIX = 'cover.cache.v1.'

/** 浏览器 Image 探测:加载成功即视为有封面;abort/超时/加载失败均视为无 */
export function probeImage(url: string, timeoutMs: number, signal: AbortSignal): Promise<boolean> {
  return new Promise((resolve) => {
    if (typeof Image === 'undefined') {
      resolve(false)
      return
    }
    const img = new Image()
    let settled = false
    const done = (ok: boolean) => {
      if (settled) return
      settled = true
      img.onload = img.onerror = null
      clearTimeout(timer)
      resolve(ok)
    }
    const timer = setTimeout(() => done(false), timeoutMs)
    if (typeof timer.unref === 'function') timer.unref()
    signal.addEventListener('abort', () => done(false), { once: true })
    img.onload = () => done(true)
    img.onerror = () => done(false)
    img.src = url
  })
}

/**
 * LrcAPI 封面 URL:title/artist/album 有啥拼啥(title 与 album 至少一项,否则没有查询意义)。
 * 返回的是 API 端点 URL 本身(服务端 301 到实际图片),<img> 展示时浏览器自动跟随。
 */
export function lrcapiCoverUrl(query: CoverQuery): string | null {
  if (!query.title && !query.album) return null
  const params = new URLSearchParams()
  if (query.title) params.set('title', query.title)
  if (query.artist) params.set('artist', query.artist)
  if (query.album) params.set('album', query.album)
  return `${LRCAPI_BASE}?${params.toString()}`
}

/**
 * LrcAPI 来源工厂:端点 URL 经 Image 探测验证(无封面时端点 404,图片加载必失败)。
 * @param probe 探测实现(默认浏览器 Image;测试注入替身)
 */
export function createLrcapiCoverSource(probe: ProbeImage = probeImage): CoverSource {
  return {
    name: 'lrcapi',

    async fetchCover(query: CoverQuery, signal: AbortSignal): Promise<string | null> {
      const url = lrcapiCoverUrl(query)
      if (!url) return null
      return (await probe(url, TIMEOUT_MS, signal)) ? url : null
    }
  }
}

interface MbReleaseGroup {
  id: string
  title?: string
  'primary-type'?: string
}

interface MbSearchResponse {
  'release-groups'?: MbReleaseGroup[]
}

/** 解析 MusicBrainz 搜索响应 → 去重后的 release-group MBID 列表(结构异常返回 []) */
export function parseReleaseGroupIds(payload: MbSearchResponse): string[] {
  const groups = payload?.['release-groups']
  if (!Array.isArray(groups)) return []
  const seen = new Set<string>()
  const ids: string[] = []
  for (const group of groups) {
    if (typeof group?.id !== 'string' || !/^[0-9a-f-]{36}$/i.test(group.id)) continue
    if (seen.has(group.id)) continue
    seen.add(group.id)
    ids.push(group.id)
  }
  return ids
}

/**
 * MusicBrainz + Cover Art Archive 来源工厂:
 * 1. release-group 搜索(专辑名 + 歌手,官方 API,带 CORS;专辑名是核心检索信号,缺省不查);
 * 2. 前 MAX_CAA_TRIES 个 MBID 依次探测 CAA front-500,首个可加载者胜出。
 * @param probe 探测实现(默认浏览器 Image;测试注入替身)
 */
export function createCaaCoverSource(probe: ProbeImage = probeImage): CoverSource {
  return {
    name: 'caa',

    async fetchCover(query: CoverQuery, signal: AbortSignal): Promise<string | null> {
      if (!query.album) return null
      const terms: string[] = [`release:"${query.album.replace(/"/g, '')}"`]
      if (query.artist) terms.push(`artist:"${query.artist.replace(/"/g, '')}"`)
      const url = `${MUSICBRAINZ_BASE}/?query=${encodeURIComponent(terms.join(' AND '))}&fmt=json&limit=${MAX_CAA_TRIES}`
      const payload = (await fetchJson(url, { headers: { 'User-Agent': UA }, signal })) as MbSearchResponse
      const ids = parseReleaseGroupIds(payload)
      for (const id of ids.slice(0, MAX_CAA_TRIES)) {
        const front = `${COVERART_BASE}/${id}/front-500`
        if (await probe(front, TIMEOUT_MS, signal)) return front
      }
      return null
    }
  }
}

/** 默认来源顺序:LrcAPI 零搜索成本先行,CAA 官方库兜底 */
export const defaultCoverSources = (): CoverSource[] => [createLrcapiCoverSource(), createCaaCoverSource()]

interface CoverCacheEntry {
  v: 1
  type: 'url' | 'negative'
  savedAt: number
  url?: string
  source?: string
}

/** 缓存主键:规范化 title|artist|album(封面与专辑版本相关,专辑名参与键) */
export function coverCacheKey(query: CoverQuery): string {
  return `${PREFIX}${normalizeText(query.title)}|${normalizeText(query.artist)}|${normalizeText(query.album)}`
}

/** 封面 URL 持久缓存:命中 30d / 负缓存(全部来源确认没有)24h */
export class CoverCache {
  private readonly now: () => number

  constructor(private storage: KVStorage, now: () => number = Date.now) {
    this.now = now
  }

  get(query: CoverQuery): CoverEntry | null {
    const entry = this.read(cacheKeyOf(query))
    if (!entry || entry.type !== 'url' || !entry.url) return null
    return { url: entry.url, source: entry.source ?? '' }
  }

  isNegativeFresh(query: CoverQuery): boolean {
    const entry = this.read(cacheKeyOf(query))
    return !!entry && entry.type === 'negative' && this.now() - entry.savedAt < NEGATIVE_TTL_MS
  }

  put(query: CoverQuery, entry: CoverEntry): void {
    this.storage.setItem(
      cacheKeyOf(query),
      { v: 1, type: 'url', savedAt: this.now(), url: entry.url, source: entry.source } satisfies CoverCacheEntry
    )
  }

  putNegative(query: CoverQuery): void {
    this.storage.setItem(cacheKeyOf(query), { v: 1, type: 'negative', savedAt: this.now() } satisfies CoverCacheEntry)
  }

  /** 展示时发现 URL 失效:该键的缓存条目确为此 URL 时逐出(下次重新探测),不写负缓存 */
  evict(query: CoverQuery, url: string): void {
    const key = cacheKeyOf(query)
    const entry = this.read(key)
    if (entry?.type === 'url' && entry.url === url) this.storage.removeItem(key)
  }

  private read(key: string): CoverCacheEntry | null {
    try {
      const entry = this.storage.getItem(key)
      if (entry && entry.v === 1 && (entry.type === 'url' || entry.type === 'negative')) {
        // 命中条目过期视为未命中(负缓存的时效由 isNegativeFresh 判定)
        if (entry.type === 'url' && this.now() - entry.savedAt >= HIT_TTL_MS) return null
        return entry
      }
    } catch (_) { /* 存储损坏时当未命中 */ }
    return null
  }
}

function cacheKeyOf(query: CoverQuery): string {
  return coverCacheKey(query)
}

export interface CoverManagerOptions {
  storage: KVStorage
  /** 来源列表(默认 LrcAPI → CAA);测试注入替身 */
  sources?: CoverSource[]
  timeoutMs?: number
  now?: () => number
}

/**
 * 封面获取编排:缓存 → 负缓存 → 来源逐个探测 → 写缓存。
 * 与 LyricsManager 相互独立(自持 RequestSupervisor,切歌时由 store 触发 cancelAll),
 * 失败静默返回 null,绝不影响歌词链路。
 */
export class CoverManager {
  private supervisor = new RequestSupervisor()
  private cache: CoverCache
  private sources: CoverSource[]
  private timeoutMs: number

  constructor(options: CoverManagerOptions) {
    this.cache = new CoverCache(options.storage, options.now)
    this.sources = options.sources ?? defaultCoverSources()
    this.timeoutMs = options.timeoutMs ?? BUDGET_MS
  }

  /** 中止在途封面请求(切歌时) */
  cancelAll(): void {
    this.supervisor.cancelAll()
  }

  /**
   * 取一首歌的封面 URL。
   * @param opts.ignoreNegative 手动重试时跳过负缓存新鲜期(用户点了"重试"就该再试一次)
   * @returns 命中返回条目;确认没有/负缓存期/出错/被切歌中止返回 null
   */
  async fetchForTrack(query: CoverQuery, opts: { ignoreNegative?: boolean } = {}): Promise<CoverEntry | null> {
    const cached = this.cache.get(query)
    if (cached) return cached
    if (!opts.ignoreNegative && this.cache.isNegativeFresh(query)) return null

    // 先中止上一首的在途探测(与 LyricsManager 同款防旧覆盖新语义)
    this.supervisor.cancelAll()
    const controller = this.supervisor.create(this.timeoutMs)
    for (const source of this.sources) {
      let url: string | null = null
      try {
        url = await source.fetchCover(query, controller.signal)
      } catch (err) {
        if (controller.signal.aborted) return null
        void err // 单来源失败(网络/限流)继续下一来源
      }
      if (controller.signal.aborted) return null
      if (url) {
        const entry = { url, source: source.name }
        this.cache.put(query, entry)
        return entry
      }
    }
    this.cache.putNegative(query)
    return null
  }

  /** 展示时 URL 加载失败(探测时是好的,展示时 404):按元数据逐出缓存,下次重新探测 */
  markBroken(query: CoverQuery, url: string): void {
    this.cache.evict(query, url)
  }
}
