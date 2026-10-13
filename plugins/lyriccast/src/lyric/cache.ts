/**
 * 歌词缓存(v2):主键 = 规范化 title|artist(不含时长),时长作为条目内的校验字段 ——
 * 同一首歌换了播放器报的时长有 ±1s 抖动也不影响命中,但差 >5s 视为不同版本不命中。
 *
 * - 命中:直接返回,不打网络;
 * - 负缓存(查过且确认没有):24h 过期,避免冷门歌反复请求;只有"全部来源明确
 *   not_found"才写入(见 lyrics-manager);
 * - userPinned:用户手动固定的结果,优先级高于一切,不受负缓存/自动重匹配影响;
 * - 结构版本:条目带 v 字段;无 v 或 v 不符的旧条目一律按未命中处理(平滑失效,不抛错);
 *   v1 的 `lyric.v1.*` 键因前缀不同天然不可达,读取方永不感知。
 */
import { normalizeText } from './normalize'
import type { LyricQuery, LyricResult } from './types'

/** 与 ztools.dbStorage 同形的最小存储接口 */
export interface KVStorage {
  getItem(key: string): any
  setItem(key: string, value: any): void
  removeItem(key: string): void
}

const NEGATIVE_TTL_MS = 24 * 60 * 60 * 1000
const PREFIX = 'lyric.cache.v2.'
/** 时长校验窗口:缓存条目与查询时长差超过该值视为不同版本 */
export const DURATION_MATCH_WINDOW_MS = 5_000

/** 来源元数据(供"换一个"候选面板与诊断展示) */
export interface CacheMeta {
  /** 命中来源,如 lrclib / netease / kugou */
  provider: string
  /** 命中时的匹配得分 */
  score?: number
  /** 用户手动固定(优先于自动匹配) */
  userPinned?: boolean
  /** 固定时所选候选的 id(候选面板高亮"当前选中";自动命中/无 id 候选无此字段) */
  candidateId?: string
}

interface CacheEntryBase {
  v: 2
  savedAt: number
  /** 写入时的曲目时长(毫秒);0 表示未知 */
  durationMs?: number
}

interface ResultEntry extends CacheEntryBase {
  type: 'result'
  result: LyricResult
  meta?: CacheMeta
}

interface NegativeEntry extends CacheEntryBase {
  type: 'negative'
}

type CacheEntry = ResultEntry | NegativeEntry

/** 缓存主键:规范化 title|artist(时长不参与键,由条目内校验字段把关) */
export function cacheKey(query: Pick<LyricQuery, 'title' | 'artist'>): string {
  return `${PREFIX}${normalizeText(query.title)}|${normalizeText(query.artist)}`
}

export class LyricCache {
  private readonly now: () => number

  /**
   * @param storage 持久化实现(ztools.dbStorage 或测试用 Map 适配器)
   * @param now 时间源,负缓存过期判定用;测试可注入
   */
  constructor(private storage: KVStorage, now: () => number = Date.now) {
    this.now = now
  }

  /**
   * 命中返回结果;未命中/结构版本不符/负缓存期/时长差超窗都返回 null。
   * @param opts.pinnedOnly 只接受用户固定条目(自动匹配路径用)
   */
  get(query: LyricQuery, opts: { pinnedOnly?: boolean } = {}): LyricResult | null {
    const entry = this.read(cacheKey(query))
    if (!entry || entry.type !== 'result') return null
    if (opts.pinnedOnly && entry.meta?.userPinned !== true) return null
    if (!this.durationMatches(entry, query)) return null
    return entry.result
  }

  /** 用户固定条目(仅 userPinned=true);无固定/时长差超窗返回 null */
  getPinned(query: LyricQuery): LyricResult | null {
    return this.get(query, { pinnedOnly: true })
  }

  /**
   * 用户固定条目的来源元数据(候选面板高亮"当前选中"用)。
   * @returns 含 provider/candidateId 的 meta;无固定/时长差超窗返回 null
   */
  getPinnedMeta(query: LyricQuery): CacheMeta | null {
    const entry = this.read(cacheKey(query))
    if (!entry || entry.type !== 'result' || entry.meta?.userPinned !== true) return null
    if (!this.durationMatches(entry, query)) return null
    return entry.meta
  }

  /**
   * 是否处于"最近查过且确认没有"的负缓存新鲜期(此时不再发请求)。
   * 过期的负缓存视为可重试。
   */
  isNegativeFresh(query: LyricQuery): boolean {
    const entry = this.read(cacheKey(query))
    if (!entry || entry.type !== 'negative') return false
    return this.now() - entry.savedAt < NEGATIVE_TTL_MS
  }

  /** 写入命中结果;meta 记录来源/得分/userPinned(自动路径不传 userPinned) */
  put(query: LyricQuery, result: LyricResult, meta?: CacheMeta): void {
    const entry: ResultEntry = {
      v: 2,
      type: 'result',
      savedAt: this.now(),
      durationMs: durationMsOf(query),
      result,
      ...(meta ? { meta } : {})
    }
    this.storage.setItem(cacheKey(query), entry)
  }

  /** 写入用户固定结果(userPinned=true,自动匹配不得覆盖) */
  putPinned(query: LyricQuery, result: LyricResult, meta?: Omit<CacheMeta, 'userPinned'>): void {
    this.put(query, result, { ...meta, userPinned: true })
  }

  /** 确认没有:写负缓存(24h) */
  putNegative(query: LyricQuery): void {
    const entry: NegativeEntry = {
      v: 2,
      type: 'negative',
      savedAt: this.now(),
      durationMs: durationMsOf(query)
    }
    this.storage.setItem(cacheKey(query), entry)
  }

  /** 恢复自动匹配:清除固定标记(条目保留,后续按普通缓存对待) */
  unpin(query: LyricQuery): void {
    const key = cacheKey(query)
    const entry = this.read(key)
    if (entry && entry.type === 'result' && entry.meta?.userPinned) {
      const { userPinned: _dropped, ...restMeta } = entry.meta
      this.storage.setItem(key, { ...entry, meta: restMeta })
    }
  }

  /** 时长校验:条目无时长或查询未知时不拦;差 >5s 视为不同版本 */
  private durationMatches(entry: ResultEntry, query: LyricQuery): boolean {
    const cached = entry.durationMs ?? 0
    if (!cached) return true
    const incoming = query.durationMs
    if (!incoming || incoming <= 0) return true
    return Math.abs(cached - incoming) <= DURATION_MATCH_WINDOW_MS
  }

  private read(key: string): CacheEntry | null {
    try {
      const entry = this.storage.getItem(key)
      // 结构版本不符(旧格式/损坏数据)一律按未命中处理,不抛错
      if (entry && entry.v === 2 && (entry.type === 'result' || entry.type === 'negative')) return entry
    } catch (_) { /* 存储损坏时当未命中 */ }
    return null
  }
}

function durationMsOf(query: Pick<LyricQuery, 'durationMs'>): number {
  return query.durationMs > 0 ? Math.round(query.durationMs) : 0
}

/** Map 假存储(测试与无 ztools 环境兜底) */
export function createMemoryStorage(): KVStorage {
  const map = new Map<string, any>()
  return {
    getItem: (key) => (map.has(key) ? map.get(key) : null),
    setItem: (key, value) => void map.set(key, value),
    removeItem: (key) => void map.delete(key)
  }
}
