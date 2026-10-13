/**
 * 网易云音乐 provider(中文曲库回退源)。
 *
 * ⚠️ 稳定性与合规:使用的是非官方公开接口(music.163.com 的 web API),
 *   可能随时变更、限流或需要风控参数;失败由上层静默回退,不影响 LRCLIB 主流程。
 *   仅作个人听歌的歌词展示用途,不缓存/转发任何音频内容。
 *
 * 流程:搜索变体按序尝试(/api/search/get,命中即停)→ 挑最佳候选 → 歌词(/api/song/lyric,含翻译)。
 * 别名:歌曲的 alias/tns 并入标题别名,歌手的 alias 并入歌手别名,解决译名失配。
 * 请求预算:最多 3 次搜索 + 1 次歌词。
 */
import { fetchJson } from '../fetcher'
import { pickBestWithScore, type Candidate } from '../match'
import { buildQueryVariants } from '../query-variants'
import type { LyricProvider, LyricQuery, LyricResult, PickerCandidate, ProviderOutcome } from '../types'

const TIMEOUT_MS = 5_000
const MAX_SEARCH_REQUESTS = 3
const HEADERS = {
  Referer: 'https://music.163.com/',
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) lyriccast-plugin/0.2'
}

interface NeteaseArtist {
  name: string
  alias?: string[]
}

interface NeteaseSong {
  id: number
  name: string
  /** 歌曲别名(常见:译名) */
  alias?: string[]
  /** 歌曲译名(部分接口以 tns 返回) */
  tns?: string[]
  duration: number // 毫秒
  artists?: NeteaseArtist[]
  album?: { name: string }
}

interface NeteaseLyricResponse {
  lrc?: { lyric?: string }
  tlyric?: { lyric?: string }
}

function searchUrl(keyword: string): string {
  return `https://music.163.com/api/search/get?${new URLSearchParams({
    s: keyword,
    type: '1',
    limit: '8'
  })}`
}

function songToCandidate(song: NeteaseSong): Candidate {
  return {
    title: song.name,
    aliasNames: [...(song.alias ?? []), ...(song.tns ?? [])],
    artist: song.artists?.map((a) => a.name).join('/') ?? '',
    artistAliases: song.artists?.flatMap((a) => a.alias ?? []) ?? [],
    album: song.album?.name ?? '',
    durationMs: song.duration ?? 0,
    id: song.id
  }
}

export const neteaseProvider: LyricProvider = {
  name: 'netease',

  async search(query: LyricQuery, signal: AbortSignal): Promise<ProviderOutcome> {
    const variants = buildQueryVariants(query)
    if (variants.length === 0) return null

    let best: Candidate | null = null
    for (const variant of variants) {
      const keyword = `${variant.title} ${variant.artist}`.trim()
      if (!keyword) continue

      const searchResult = (await fetchJson(searchUrl(keyword), {
        headers: HEADERS,
        signal
      })) as { result?: { songs?: NeteaseSong[] } }
      const songs = searchResult?.result?.songs ?? []
      if (songs.length === 0) continue

      const matched = pickBestWithScore(songs.map(songToCandidate), query)
      if (matched?.candidate.id) {
        best = matched.candidate
        break // 命中即停
      }
    }
    if (!best || typeof best.id !== 'number') return { status: 'not_found' }

    const lyricResult = await fetchLyricById(String(best.id), signal)

    const synced = lyricResult?.lrc?.lyric?.trim() || null
    const translation = lyricResult?.tlyric?.lyric?.trim() || null
    // 无时间轴也无纯文本 → 未命中
    if (!synced) return { status: 'not_found' }
    // 网易云对"没有歌词"的歌也返回时间轴空壳(只有元数据行),
    // parseLrc 已在开头区域过滤制作信息行,isUsableSynced 据此判定可用性
    return { status: 'found', result: { synced, plain: null, translation, source: 'netease' } }
  },

  /**
   * 候选面板:搜索结果只带元数据(歌词需按 id 二次请求)。
   * 顶部按搜索排序截断 20 条;固定时由 fetchLyricsById 回取歌词。
   */
  async searchCandidates(query: LyricQuery, signal: AbortSignal): Promise<PickerCandidate[]> {
    const variants = buildQueryVariants(query)
    const songs: NeteaseSong[] = []
    for (const variant of variants) {
      const keyword = `${variant.title} ${variant.artist}`.trim()
      if (!keyword) continue
      const searchResult = (await fetchJson(searchUrl(keyword), { headers: HEADERS, signal })) as {
        result?: { songs?: NeteaseSong[] }
      }
      songs.push(...(searchResult?.result?.songs ?? []))
      if (songs.length > 0) break // 命中即停
    }
    return songs.slice(0, 20).map((song) => ({
      title: song.name,
      artist: song.artists?.map((a) => a.name).join('/') ?? '',
      album: song.album?.name,
      durationMs: song.duration ?? 0,
      source: 'netease',
      id: String(song.id)
    }))
  },

  /** 按歌曲 id 取歌词(搜索与候选面板共用);无词返回 null */
  async fetchLyricsById(id: string, _query: LyricQuery, signal: AbortSignal): Promise<LyricResult | null> {
    const lyricResult = await fetchLyricById(id, signal)
    const synced = lyricResult?.lrc?.lyric?.trim() || null
    if (!synced) return null
    return {
      synced,
      plain: null,
      translation: lyricResult?.tlyric?.lyric?.trim() || null,
      source: 'netease'
    }
  }
}

/** 歌词接口(非官方,可能限流;调用方处理异常) */
async function fetchLyricById(id: string, signal: AbortSignal): Promise<NeteaseLyricResponse> {
  return (await fetchJson(
    `https://music.163.com/api/song/lyric?${new URLSearchParams({
      id,
      lv: '1',
      kv: '1',
      tv: '-1'
    })}`,
    { headers: HEADERS, signal }
  )) as NeteaseLyricResponse
}

export const NETEASE_TIMEOUT = TIMEOUT_MS
