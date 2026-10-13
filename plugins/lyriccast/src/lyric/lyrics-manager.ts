/**
 * 歌词编排:缓存 → 路由/熔断/开关 → providers(串行回退或并行时间预算)→ 写缓存。
 *
 * 核心不变量(任务 2.1):
 * - 只有"所有实际运行的 provider 都明确 not_found"(被开关禁用/熔断跳过的不算数)才写负缓存;
 * - 任一 provider error(超时/网络/5xx/解析失败)→ 本次不写任何缓存,下次可重试;
 * - 切歌 abort → 既非 error 也非 not_found,不写任何缓存;
 * - userPinned 条目优先于一切,不受负缓存与自动重匹配影响(阶段 3)。
 *
 * 并行模式(任务 2.3,可关):
 * - 所有来源同时发起,第一个"高置信"(score ≥ 阈值)的有效时间轴结果立即返回并取消其余;
 * - 否则在首个结果到达后再等 collectWindowMs 收集,统一按打分择优;总预算 budgetMs 封顶;
 * - 全部纳入 RequestSupervisor,切歌即取消。关闭时退化为按路由顺序串行。
 */
import { RequestSupervisor } from './fetcher'
import { LyricCache, type KVStorage } from './cache'
import { cleanArtist, cleanTitleDetailed, parseArtists } from './clean-title'
import { isUsableSynced, lrcToPlain } from './parse-lrc'
import { routeProviders } from './provider-router'
import { ProviderBreaker } from './circuit-breaker'
import type { LyricProvider, LyricQuery, LyricResult, PickerCandidate } from './types'

export interface TrackForLyrics {
  id: string
  title: string
  artist: string
  album: string
  durationMs: number
}

export interface LyricsManagerOptions {
  storage: KVStorage
  providers: LyricProvider[]
  /** 单请求超时(默认 5s,协议约定) */
  timeoutMs?: number
  /** 并行时间预算模式;可传函数以便运行时开关(默认开) */
  parallel?: boolean | (() => boolean)
  /** 高置信分数阈值:达到即立刻采用,不再等待(默认 8) */
  confidenceThreshold?: number
  /** 首个结果到达后的追加收集窗口(默认 1500ms) */
  collectWindowMs?: number
  /** 并行总预算(默认 5000ms,超时用已收集结果决策) */
  budgetMs?: number
  /** 用户开关:返回 false 的 provider 本次跳过(如设置页关闭某来源) */
  isProviderEnabled?: (name: string) => boolean
  /** 熔断参数 */
  breakerThreshold?: number
  breakerCooldownMs?: number
  /** 时间源(测试注入) */
  now?: () => number
}

/** 单个 provider 的一次执行记录,驱动缓存决策与熔断记账 */
type Collected =
  | { name: string; status: 'found'; result: LyricResult; score?: number }
  | { name: string; status: 'not_found' }
  | { name: string; status: 'error'; message: string }
  | { name: string; status: 'aborted' }

interface Decision {
  /** found=已择优 / plain=纯文本兜底 / negative=确认没有 / none=不写任何缓存 */
  kind: 'found' | 'plain' | 'negative' | 'none'
  result?: LyricResult
  meta?: { provider: string; score?: number }
}

export class LyricsManager {
  private supervisor = new RequestSupervisor()
  private cache: LyricCache
  private breaker: ProviderBreaker
  private providers: LyricProvider[]
  private timeoutMs: number
  private parallel: boolean | (() => boolean)
  private confidenceThreshold: number
  private collectWindowMs: number
  private budgetMs: number
  private isProviderEnabled: (name: string) => boolean
  private now: () => number

  constructor(options: LyricsManagerOptions) {
    this.cache = new LyricCache(options.storage, options.now)
    this.breaker = new ProviderBreaker({
      threshold: options.breakerThreshold,
      cooldownMs: options.breakerCooldownMs,
      now: options.now
    })
    this.providers = options.providers
    this.timeoutMs = options.timeoutMs ?? 5_000
    this.parallel = options.parallel ?? true
    this.confidenceThreshold = options.confidenceThreshold ?? 8
    this.collectWindowMs = options.collectWindowMs ?? 1_500
    this.budgetMs = options.budgetMs ?? 5_000
    this.isProviderEnabled = options.isProviderEnabled ?? (() => true)
    this.now = options.now ?? Date.now
  }

  /** 中止全部在途请求(切歌时由 store 间接触发:下一次 fetch 会先 cancelAll) */
  cancelAll(): void {
    this.supervisor.cancelAll()
  }

  // ==================== 手动纠错(任务 3.1) ====================

  /**
   * 候选面板:聚合所有支持 searchCandidates 的来源(路由序,受开关约束)。
   * 单来源失败静默跳过;全部纳入 RequestSupervisor,切歌即取消。
   * 不写缓存、不记熔断 —— 面板失败只影响展示。
   */
  async fetchCandidates(track: TrackForLyrics): Promise<PickerCandidate[]> {
    const query = this.buildQuery(track)
    if (!query.title) return []
    this.supervisor.cancelAll()
    const providers = routeProviders(
      this.providers.filter(
        (p) => this.isProviderEnabled(p.name) && typeof p.searchCandidates === 'function'
      ),
      query
    )
    const results = await Promise.allSettled(
      providers.map(async (provider) => {
        const controller = this.supervisor.create(this.timeoutMs)
        try {
          return await provider.searchCandidates!(query, controller.signal)
        } catch (err) {
          if (controller.signal.aborted) return [] as PickerCandidate[]
          console.warn(`[lyrics] candidates from ${provider.name} failed:`, (err as Error)?.message)
          return [] as PickerCandidate[]
        }
      })
    )
    const items: PickerCandidate[] = []
    for (const entry of results) if (entry.status === 'fulfilled') items.push(...entry.value)
    return items
  }

  /**
   * 固定用户选择:候选自带歌词内容直接采用;仅带 id 的候选按源回取。
   * 结果经 normalize(伪时间轴降级)后写入缓存并标记 userPinned,
   * 优先级高于自动匹配,不受 24h 负缓存与自动重匹配影响。
   */
  async pinLyrics(track: TrackForLyrics, candidate: PickerCandidate): Promise<LyricResult | null> {
    const query = this.buildQuery(track)
    if (!query.title) return null
    this.supervisor.cancelAll()
    const controller = this.supervisor.create(this.timeoutMs)
    try {
      let raw: LyricResult | null = null
      if (candidate.synced || candidate.plain) {
        raw = {
          synced: candidate.synced ?? null,
          plain: candidate.plain ?? null,
          translation: candidate.translation ?? null,
          source: candidate.source
        }
      } else if (candidate.id) {
        const provider = this.providers.find((p) => p.name === candidate.source)
        if (provider?.fetchLyricsById) {
          raw = await provider.fetchLyricsById(candidate.id, query, controller.signal)
        }
      }
      const normalized = this.normalize(raw)
      if (!normalized) return null
      // candidateId 随固定条目持久化,供候选面板重开时高亮"当前选中"
      this.cache.putPinned(query, normalized, {
        provider: candidate.source,
        ...(candidate.id ? { candidateId: candidate.id } : {})
      })
      return normalized
    } catch (err) {
      if (controller.signal.aborted) return null
      console.warn('[lyrics] pin failed:', (err as Error)?.message)
      return null
    }
  }

  /** 恢复自动匹配:清除固定标记(自动路径可重新接管该曲) */
  async unpinLyrics(track: TrackForLyrics): Promise<void> {
    const query = this.buildQuery(track)
    if (query.title) this.cache.unpin(query)
  }

  /** 当前曲目是否处于固定状态(UI 徽标/恢复入口用) */
  isPinned(track: TrackForLyrics): boolean {
    const query = this.buildQuery(track)
    return !!query.title && this.cache.getPinned(query) !== null
  }

  /**
   * 当前固定候选的标识(候选面板高亮"当前选中"用)。
   * @returns { source, id };未固定/固定条目未记录候选 id(无 id 候选或旧版本固定)返回 null
   */
  pinnedCandidate(track: TrackForLyrics): { source: string; id: string } | null {
    const query = this.buildQuery(track)
    if (!query.title) return null
    const meta = this.cache.getPinnedMeta(query)
    if (!meta?.candidateId) return null
    return { source: meta.provider, id: meta.candidateId }
  }

  /**
   * 取一首歌的歌词(带缓存)。
   *
   * @param track 手机推送的曲目快照
   * @param appPackage 来源 App(预留字段;当前不参与查询)
   * @returns 命中返回结果;确认无/负缓存新鲜期/出错(本次不缓存)返回 null
   */
  async fetchForTrack(track: TrackForLyrics, appPackage = ''): Promise<LyricResult | null> {
    void appPackage
    const query = this.buildQuery(track)
    if (!query.title) return null

    // 1) 用户固定 > 缓存 > 负缓存(负缓存新鲜期内不再打网络)
    const pinned = this.cache.getPinned(query)
    if (pinned) return this.normalize(pinned) ?? null
    const cached = this.cache.get(query)
    if (cached) return this.normalize(cached) ?? null
    if (this.cache.isNegativeFresh(query)) return null

    // 2) 新歌:中止上一首的在途请求(防旧歌词覆盖新歌)
    this.supervisor.cancelAll()

    // 3) 开关 + 熔断过滤;全部不可用时不写负缓存(没有任何来源实际给出结论)
    const enabled = this.providers.filter((p) => this.isProviderEnabled(p.name))
    const routed = routeProviders(enabled, query)
    const available = routed.filter((p) => this.breaker.isAvailable(p.name))
    if (available.length === 0) return null

    // 4) 串行或并行执行,统一决策
    const parallel = typeof this.parallel === 'function' ? this.parallel() : this.parallel
    const collected =
      parallel && available.length > 1
        ? await this.runParallel(available, query)
        : await this.runSerial(available, query)

    const decision = this.decide(collected, query)
    switch (decision.kind) {
      case 'found':
      case 'plain': {
        this.cache.put(query, decision.result!, decision.meta)
        return decision.result!
      }
      case 'negative':
        this.cache.putNegative(query)
        return null
      default:
        return null
    }
  }

  // ==================== 执行模式 ====================

  /** 串行:按路由顺序逐个尝试,第一个有效时间轴即胜出;纯文本只做兜底记忆 */
  private async runSerial(providers: LyricProvider[], query: LyricQuery): Promise<Collected[]> {
    const collected: Collected[] = []
    for (const provider of providers) {
      const entry = await this.invoke(provider, query)
      collected.push(entry)
      if (entry.status === 'aborted') break
      this.record(entry)
      // 串行优先级:有效时间轴立刻采用(与 v1 行为一致)
      if (entry.status === 'found' && entry.result.synced) break
    }
    return collected
  }

  /**
   * 并行时间预算:全部同时发起;
   * - 第一个高置信(score ≥ 阈值)有效时间轴 → 立刻返回并取消其余;
   * - 否则首个结果到达后再开 collectWindowMs 窗口统一收集,总预算 budgetMs 封顶。
   */
  private async runParallel(providers: LyricProvider[], query: LyricQuery): Promise<Collected[]> {
    return new Promise((resolve) => {
      const collected: Collected[] = []
      let pending = providers.length
      let done = false
      let windowTimer: ReturnType<typeof setTimeout> | null = null
      let budgetTimer: ReturnType<typeof setTimeout> | null = null

      const finish = (list: Collected[]) => {
        if (done) return
        done = true
        if (windowTimer) clearTimeout(windowTimer)
        if (budgetTimer) clearTimeout(budgetTimer)
        this.supervisor.cancelAll() // 取消仍在途的请求,由 invoke 归类为 aborted
        resolve(list)
      }

      const maybeFinish = () => {
        if (done) return
        if (collected.length >= pending) finish(collected)
      }

      const onFirst = () => {
        if (done || windowTimer) return
        windowTimer = setTimeout(() => finish(collected), this.collectWindowMs)
      }

      budgetTimer = setTimeout(() => finish(collected), this.budgetMs)

      for (const provider of providers) {
        void this.invoke(provider, query).then((entry) => {
          if (done) return
          collected.push(entry)
          if (entry.status === 'aborted') {
            // 切歌:立即结束,不写任何缓存(由 decide 判定)
            finish(collected)
            return
          }
          this.record(entry)
          if (
            entry.status === 'found' &&
            entry.result.synced &&
            (entry.score ?? 0) >= this.confidenceThreshold
          ) {
            finish(collected) // 高置信:立刻采用
            return
          }
          onFirst()
          maybeFinish()
        })
      }
    })
  }

  /** 调单个 provider:abort 归类为 aborted(非 error),异常兜底为 error */
  private async invoke(provider: LyricProvider, query: LyricQuery): Promise<Collected> {
    const controller = this.supervisor.create(this.timeoutMs)
    try {
      const outcome = await provider.search(query, controller.signal)
      if (outcome.status === 'found') {
        const normalized = this.normalize(outcome.result)
        if (!normalized) return { name: provider.name, status: 'not_found' }
        return { name: provider.name, status: 'found', result: normalized, score: outcome.score }
      }
      if (outcome.status === 'not_found') return { name: provider.name, status: 'not_found' }
      return { name: provider.name, status: 'error', message: outcome.message }
    } catch (err) {
      if (controller.signal.aborted) return { name: provider.name, status: 'aborted' }
      return { name: provider.name, status: 'error', message: (err as Error)?.message ?? String(err) }
    }
  }

  private record(entry: Collected): void {
    if (entry.status === 'found') this.breaker.recordSuccess(entry.name)
    else if (entry.status === 'not_found') this.breaker.recordNotFound(entry.name)
    else if (entry.status === 'error') this.breaker.recordError(entry.name)
  }

  // ==================== 决策 ====================

  /**
   * 统一决策(任务 2.1):有效时间轴择优 > 纯文本兜底 > 负缓存(仅全部 not_found)>
   * 出错/中止/被跳过 → 不写任何缓存。
   */
  private decide(collected: Collected[], query: LyricQuery): Decision {
    if (collected.some((c) => c.status === 'aborted')) return { kind: 'none' }
    if (collected.length === 0) return { kind: 'none' } // 全部被开关/熔断跳过

    const found = collected.filter((c) => c.status === 'found')
    // 有效时间轴:并行收集到的多个结果按打分择优;串行模式首胜即最后一个 found
    const syncedHits = found.filter((c) => c.result.synced)
    if (syncedHits.length > 0) {
      let best = syncedHits[0]
      for (const hit of syncedHits) {
        const bestScore = best.status === 'found' ? (best.score ?? 0) : 0
        const score = hit.status === 'found' ? (hit.score ?? 0) : 0
        if (score > bestScore) best = hit
      }
      return {
        kind: 'found',
        result: (best as Extract<Collected, { status: 'found' }>).result,
        meta: { provider: best.name, score: best.status === 'found' ? best.score : undefined }
      }
    }

    // 纯文本兜底:路由顺序里第一份
    const plain = found.find((c) => c.result.plain)
    if (plain) {
      return { kind: 'plain', result: plain.result, meta: { provider: plain.name } }
    }

    // 都没命中:只有"没有任何 error"才允许写负缓存
    if (collected.some((c) => c.status === 'error')) return { kind: 'none' }
    return { kind: 'negative' }
  }

  // ==================== 结果规范化 ====================

  /**
   * 结果规范化:确保 synced 字段一定是有效时间轴。
   * 无效时间轴(少于 2 行 / 全零时间戳 / 跨度过短)降级为纯文本;
   * 降级后连纯文本都凑不出的结果按未命中处理。
   */
  private normalize(result: LyricResult | null): LyricResult | null {
    if (!result) return null
    if (!result.synced && !result.plain) return null
    if (result.synced && !isUsableSynced(result.synced)) {
      const plain = result.plain || lrcToPlain(result.synced)
      if (!plain) return null
      return { ...result, synced: null, plain }
    }
    return result
  }

  /**
   * 组装查询:标题/歌手先清洗提高命中率,同时保留原始值、完整歌手列表与版本标签:
   * rawTitle/rawArtist 供 provider 的查询变体回退,allArtists 供集合重叠打分,
   * versionTags 供打分做对称版本惩罚。
   */
  private buildQuery(track: TrackForLyrics): LyricQuery {
    const cleaned = cleanTitleDetailed(track.title, track.artist)
    return {
      title: cleaned.title,
      artist: cleanArtist(track.artist),
      album: track.album || '',
      durationMs: track.durationMs || 0,
      rawTitle: track.title,
      rawArtist: track.artist,
      allArtists: parseArtists(track.artist),
      versionTags: [...cleaned.tags]
    }
  }
}
