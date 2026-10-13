/**
 * 歌词模块公共类型(本插件内部契约)。
 */
import type { VersionTag } from './clean-title'

/** 一次歌词查询的输入,来自手机推送的 track 快照 */
export interface LyricQuery {
  title: string
  artist: string
  album: string
  durationMs: number
  /** 原始未清洗标题(查询变体回退用) */
  rawTitle?: string
  /** 原始未清洗歌手(查询变体回退用) */
  rawArtist?: string
  /** 完整歌手列表(未清洗拆分,供集合重叠打分;缺省时从 artist 现场拆) */
  allArtists?: string[]
  /** 从原始标题提取的版本标签(live/remix 等,打分对称惩罚用) */
  versionTags?: VersionTag[]
}

/** Provider 返回的统一结果;synced/plain 至少一项非空才算命中 */
export interface LyricResult {
  /** 带时间轴的 LRC 原文;无则 null */
  synced: string | null
  /** 纯文本歌词;无则 null */
  plain: string | null
  /** 翻译 LRC(可选,时间轴与主歌词对齐) */
  translation?: string | null
  /** 来源标识,如 lrclib / netease */
  source: string
}

/** "换一个"候选面板的条目(任务 3.1;仅展示与固定用,不参与自动打分) */
export interface PickerCandidate {
  title: string
  artist: string
  album?: string
  durationMs?: number
  /** 来源标识(与 LyricResult.source 一致,用于按源回取歌词) */
  source: string
  /** 供 provider 后续按 id 取词(如网易云;LRCLIB 候选自带内容则无 id) */
  id?: string
  /** 直接携带的歌词内容(LRCLIB 搜索结果自带;带其一即"可直接固定") */
  synced?: string | null
  plain?: string | null
  translation?: string | null
}

/** 歌词数据源接口:实现方自行处理搜索→详情两步,失败以 error 结果返回 */
export interface LyricProvider {
  /** 来源标识(写入 LyricResult.source) */
  name: string
  /** 中文优先源(路由排序用:查询以 CJK 为主时排到最前) */
  prefersCjk?: boolean
  /**
   * 查询歌词。
   * @param query 查询参数(已清洗,含 rawTitle/versionTags 等)
   * @param signal 取消信号:切歌时中止在途请求(中止以 AbortError 抛出,由编排层识别)
   * @returns 显式区分 found / not_found / error(决定负缓存是否可写)
   */
  search(query: LyricQuery, signal: AbortSignal): Promise<ProviderOutcome>
  /**
   * 搜索候选列表(手动纠错面板用;不写缓存,请求受 RequestSupervisor 管理)。
   * 未实现该方法的来源不出现在候选面板里。
   */
  searchCandidates?(query: LyricQuery, signal: AbortSignal): Promise<PickerCandidate[]>
  /**
   * 按候选 id 回取歌词(候选未自带内容时;失败抛异常由编排层吞掉)。
   * 返回结果仍会经 normalize 把伪时间轴降级为纯文本。
   */
  fetchLyricsById?(id: string, query: LyricQuery, signal: AbortSignal): Promise<LyricResult | null>
}

/**
 * Provider 的一次查询结果(显式区分"没有"与"出错"):
 * - found:命中(score 为本源最佳候选打分,供并行模式置信度判定与跨源择优);
 * - not_found:接口明确无结果/无合格候选(可参与负缓存判定);
 * - error:超时、网络错误、5xx、429、解析失败(本次不得写负缓存)。
 * 切歌导致的 abort 以异常(AbortError)形式抛出,不属于以上任何一种。
 */
export type ProviderOutcome =
  | { status: 'found'; result: LyricResult; score?: number }
  | { status: 'not_found' }
  | { status: 'error'; message: string }

/** 解析后的一行歌词;timeMs 已应用 [offset:] 标签,未应用用户手动偏移 */
export interface LyricsLine {
  timeMs: number
  text: string
}
