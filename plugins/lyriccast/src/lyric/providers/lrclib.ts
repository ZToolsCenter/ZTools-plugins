/**
 * LRCLIB provider(主来源,公开 API,https://lrclib.net)。
 * 策略:/api/get 精确查询 → /api/search 模糊查询(优先 track_name/artist_name 分字段,
 * 失败退回单个 q)→ 多候选本地挑选。查询变体按序尝试,命中即停;
 * 总请求数封顶(MAX_REQUESTS),避免对公益接口造成压力。
 * 稳定性:公益服务,可能限流;失败由上层静默回退,不影响主流程。
 */
import { fetchJson } from '../fetcher'
import { pickBestWithScore, type Candidate } from '../match'
import { buildQueryVariants } from '../query-variants'
import type { LyricProvider, LyricQuery, LyricResult, PickerCandidate, ProviderOutcome } from '../types'

const BASE = 'https://lrclib.net/api'
const TIMEOUT_MS = 5_000
/** 单次 search 调用的总请求数上限(get + 若干次 search) */
const MAX_REQUESTS = 4

interface LrcLibRecord extends Candidate {
  id: number
  trackName: string
  artistName: string
  albumName: string
  duration: number // 秒
  instrumental: boolean
  plainLyrics: string | null
  syncedLyrics: string | null
}

function toQuery(params: Record<string, string>): string {
  return new URLSearchParams(params).toString()
}

function recordToResult(record: LrcLibRecord): LyricResult | null {
  if (record.instrumental) return null // 纯音乐按未命中处理,让回退链继续
  const synced = record.syncedLyrics || null
  const plain = record.plainLyrics || null
  if (!synced && !plain) return null
  return { synced, plain, translation: null, source: 'lrclib' }
}

/** 搜索结果归一为统一候选;synced 一并带上,供打分做歌词内容反校验 */
function toCandidate(record: LrcLibRecord): Candidate {
  return {
    title: record.trackName,
    artist: record.artistName,
    album: record.albumName,
    durationMs: (record.duration || 0) * 1000,
    synced: record.syncedLyrics || null,
    translation: null,
    id: record.id,
    instrumental: record.instrumental,
    plainLyrics: record.plainLyrics,
    syncedLyrics: record.syncedLyrics
  }
}

export const lrclibProvider: LyricProvider = {
  name: 'lrclib',

  async search(query: LyricQuery, signal: AbortSignal): Promise<ProviderOutcome> {
    const records = await searchRecords(query, signal)
    const candidates = records.map(toCandidate)
    const best = pickBestWithScore(candidates, query)
    if (!best) return { status: 'not_found' }
    const result = recordToResult(best.candidate as LrcLibRecord)
    if (!result) return { status: 'not_found' }
    return { status: 'found', result, score: best.score }
  },

  /**
   * 候选面板:LRCLIB 搜索结果自带歌词内容,全部原样带出(排序交给面板,不在此打分)。
   * 纯音乐(instrumental)记录过滤掉 —— 固定了也没词。
   */
  async searchCandidates(query: LyricQuery, signal: AbortSignal): Promise<PickerCandidate[]> {
    const records = await searchRecords(query, signal)
    return records
      .filter((record) => !record.instrumental)
      .slice(0, 20)
      .map((record) => ({
        title: record.trackName,
        artist: record.artistName,
        album: record.albumName,
        durationMs: (record.duration || 0) * 1000,
        source: 'lrclib',
        id: String(record.id),
        synced: record.syncedLyrics || null,
        plain: record.plainLyrics || null
      }))
  }
}

/** /api/get + 变体模糊搜索(命中即停、请求封顶);search 与候选面板共用 */
async function searchRecords(query: LyricQuery, signal: AbortSignal): Promise<LrcLibRecord[]> {
  const variants = buildQueryVariants(query)
  if (variants.length === 0) return []

  const headers = {
    // LRCLIB 建议标注来源,方便对方联系;不含任何隐私信息
    'User-Agent': 'lyriccast-ztools-plugin/0.2'
  }
  let requests = 0
  const collected: LrcLibRecord[] = []

  // 1) 精确查询(变体 0 + 专辑 + 时长,参数齐全时);命中与否都交给统一打分
  const primary = variants[0]
  const durationSec = query.durationMs > 0 ? Math.round(query.durationMs / 1000) : undefined
  const getParams: Record<string, string> = {
    track_name: primary.title,
    artist_name: primary.artist
  }
  if (query.album) getParams.album_name = query.album
  if (durationSec) getParams.duration = String(durationSec)

  requests++
  try {
    const record = (await fetchJson(`${BASE}/get?${toQuery(getParams)}`, { headers, signal })) as LrcLibRecord
    collected.push(record)
  } catch (err) {
    if (signal.aborted) throw err
    // 404 等:走模糊搜索
  }

  // 2) 模糊搜索:变体按序,每档先分字段再 q;有候选即停;总请求封顶
  for (const variant of variants) {
    const fieldParams: Record<string, string> = { track_name: variant.title }
    if (variant.artist) fieldParams.artist_name = variant.artist

    const attempts: Array<Record<string, string>> = [fieldParams]
    if (variant.artist) attempts.push({ q: `${variant.title} ${variant.artist}`.trim() })
    else attempts.push({ q: variant.title })

    for (const params of attempts) {
      if (requests >= MAX_REQUESTS) break
      requests++
      let records: LrcLibRecord[]
      try {
        records = (await fetchJson(`${BASE}/search?${toQuery(params)}`, { headers, signal })) as LrcLibRecord[]
      } catch (err) {
        if (signal.aborted) throw err
        continue // 单档搜索失败继续下一档
      }
      if (!Array.isArray(records) || records.length === 0) continue
      collected.push(...records)
      break // 该变体已有候选:命中即停
    }
    if (requests >= MAX_REQUESTS) break
  }
  return dedupeById(collected)
}

/** 按 id 去重,保持首次出现顺序 */
function dedupeById(records: LrcLibRecord[]): LrcLibRecord[] {
  const seen = new Set<number>()
  const out: LrcLibRecord[] = []
  for (const record of records) {
    if (seen.has(record.id)) continue
    seen.add(record.id)
    out.push(record)
  }
  return out
}

export const LRCLIB_TIMEOUT = TIMEOUT_MS
