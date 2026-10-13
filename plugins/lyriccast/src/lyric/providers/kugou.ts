/**
 * 酷狗音乐 provider(第三来源,中文曲库补充)。
 *
 * ⚠️ 稳定性与合规:以下均为**非官方公开接口**(mobiles.kugou.com / krcs.kugou.com /
 *   lyrics.kugou.com 的 web 端点),可能随时变更、限流或下线;失败由上层静默回退,
 *   不影响其他来源。仅作个人听歌的歌词展示用途,不缓存/转发任何音频内容。
 *
 * 流程(搜索 → 按 hash 取词,共 2~3 个请求):
 * 1. /api/v3/search/song(关键词搜索,普通 LRC 库索引)→ 多候选本地打分(复用 match.ts);
 * 2. krcs.kugou.com/search(按歌曲 hash 找歌词记录 id + accesskey);
 * 3. lyrics.kugou.com/download(fmt=lrc,内容为 base64 编码的 LRC 原文)。
 *
 * 已知限制:该接口只提供普通 LRC(含中文/双语对照行),**没有独立翻译轨道**,
 *   也没有逐字时间轴;translation 恒为 null。候选别名(译名)同样不可得。
 */
import { fetchJson } from '../fetcher'
import { pickBestWithScore, type Candidate } from '../match'
import { buildQueryVariants } from '../query-variants'
import type { LyricProvider, LyricQuery, LyricResult, PickerCandidate, ProviderOutcome } from '../types'

const TIMEOUT_MS = 5_000
/** 搜索分页条数;太多候选对移动端接口不友好 */
const SEARCH_LIMIT = 10

const SEARCH_HEADERS = {
  Referer: 'https://www.kugou.com/',
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) lyriccast-plugin/0.2'
}

interface KugouSearchResponse {
  data?: { info?: KugouSong[] }
}

interface KugouSong {
  hash: string
  songname: string
  singername?: string
  album_name?: string
  duration?: number // 秒
  album_id?: string
}

interface KrcSearchResponse {
  candidates?: Array<{ id: number | string; accesskey: string }>
}

interface KrcDownloadResponse {
  /** base64 编码的 LRC 原文(fmt=lrc, charset=utf8) */
  content?: string
  fmt?: string
  status?: number
}

/** 解析搜索响应 → 候选数组(响应结构异常时返回 [],不抛错) */
export function parseSearchResponse(payload: KugouSearchResponse): KugouSong[] {
  const info = payload?.data?.info
  return Array.isArray(info) ? info : []
}

/**
 * 解析歌词检索响应 → 首个候选的 id/accesskey(无候选/结构异常返回 null)。
 * 关键参数:payload 为 krcs /search 的 JSON;返回 { id, accessKey } 供 /download 拼接。
 * 重要行为:id 兼容接口的两种历史形态——数字与数字字符串(如 "317197757",
 *   2025 年起线上返回字符串);非数字 id 视为结构异常返回 null。
 */
export function parseKrcCandidates(payload: KrcSearchResponse): { id: string; accessKey: string } | null {
  const first = payload?.candidates?.[0]
  if (!first || typeof first.accesskey !== 'string') return null
  const id = typeof first.id === 'number' ? String(first.id) : typeof first.id === 'string' ? first.id.trim() : ''
  if (!/^\d+$/.test(id)) return null
  return { id, accessKey: first.accesskey }
}

/** 解码歌词下载响应 → LRC 原文(空/异常返回 null;容忍 URL-safe 变体与空白) */
export function decodeLrcContent(payload: KrcDownloadResponse): string | null {
  const encoded = payload?.content
  if (typeof encoded !== 'string' || encoded.length === 0) return null
  try {
    const normalized = encoded.trim().replace(/-/g, '+').replace(/_/g, '/')
    const binary = atob(normalized)
    // base64 → UTF-8 字节串 → 原文(手动解码,避免 TextDecoder 缺失环境)
    const bytes = Uint8Array.from(binary, (ch) => ch.charCodeAt(0))
    return new TextDecoder('utf-8').decode(bytes) || null
  } catch (_) {
    return null
  }
}

/** 搜索结果 → 统一候选(导出供打分集成测试) */
export function songToCandidate(song: KugouSong): Candidate {
  return {
    title: song.songname,
    artist: song.singername ?? '',
    album: song.album_name ?? '',
    durationMs: (song.duration ?? 0) * 1000,
    id: song.hash
  }
}

function songToPickerCandidate(song: KugouSong): PickerCandidate {
  return {
    title: song.songname,
    artist: song.singername ?? '',
    album: song.album_name,
    durationMs: (song.duration ?? 0) * 1000,
    source: 'kugou',
    id: song.hash
  }
}

function searchUrl(keyword: string): string {
  return `https://mobiles.kugou.com/api/v3/search/song?${new URLSearchParams({
    format: 'json',
    is_antishake: 'Y',
    keyword,
    page: '1',
    pagesize: String(SEARCH_LIMIT)
  })}`
}

async function searchSongs(query: LyricQuery, signal: AbortSignal): Promise<KugouSong[]> {
  const variants = buildQueryVariants(query)
  for (const variant of variants) {
    const keyword = `${variant.title} ${variant.artist}`.trim()
    if (!keyword) continue
    const payload = (await fetchJson(searchUrl(keyword), {
      headers: SEARCH_HEADERS,
      signal
    })) as KugouSearchResponse
    const songs = parseSearchResponse(payload)
    if (songs.length > 0) return songs // 命中即停
  }
  return []
}

/**
 * 按 hash 取词:krcs 检索(id+accesskey)→ 下载 base64 LRC → 解码。
 * 两步中任一步无结果/失败都返回 null(由上层归类为未命中)。
 */
async function fetchLrcByHash(hash: string, signal: AbortSignal): Promise<string | null> {
  const krcSearch = (await fetchJson(
    `https://krcs.kugou.com/search?${new URLSearchParams({
      ver: '1',
      man: 'yes',
      client: 'mobi',
      keyword: '',
      duration: '',
      hash
    })}`,
    { headers: SEARCH_HEADERS, signal }
  )) as KrcSearchResponse
  const candidate = parseKrcCandidates(krcSearch)
  if (!candidate) return null

  const download = (await fetchJson(
    `https://lyrics.kugou.com/download?${new URLSearchParams({
      ver: '1',
      client: 'pc',
      id: candidate.id,
      accesskey: candidate.accessKey,
      fmt: 'lrc',
      charset: 'utf8'
    })}`,
    { headers: SEARCH_HEADERS, signal }
  )) as KrcDownloadResponse
  return decodeLrcContent(download)
}

export const kugouProvider: LyricProvider = {
  name: 'kugou',
  prefersCjk: true, // 中文曲库,中文查询时路由提前

  async search(query: LyricQuery, signal: AbortSignal): Promise<ProviderOutcome> {
    const songs = await searchSongs(query, signal)
    if (songs.length === 0) return { status: 'not_found' }
    const best = pickBestWithScore(songs.map(songToCandidate), query)
    if (!best?.candidate.id) return { status: 'not_found' }

    const lrc = await fetchLrcByHash(String(best.candidate.id), signal)
    if (!lrc) return { status: 'not_found' }
    // 该接口无独立翻译轨道;伪时间轴空壳交给编排层 normalize 降级
    return { status: 'found', result: { synced: lrc, plain: null, translation: null, source: 'kugou' } }
  },

  /** 候选面板:搜索结果只带元数据,固定时按 hash 回取歌词 */
  async searchCandidates(query: LyricQuery, signal: AbortSignal): Promise<PickerCandidate[]> {
    const songs = await searchSongs(query, signal)
    return songs.slice(0, 20).map(songToPickerCandidate)
  },

  /** 按 hash 回取歌词(id 字段即歌曲 hash) */
  async fetchLyricsById(id: string, _query: LyricQuery, signal: AbortSignal): Promise<LyricResult | null> {
    const lrc = await fetchLrcByHash(id, signal)
    return lrc ? { synced: lrc, plain: null, translation: null, source: 'kugou' } : null
  }
}

export const KUGOU_TIMEOUT = TIMEOUT_MS
