/**
 * Better Lyrics provider(海外开源歌词 API,https://lyrics-api.boidu.dev,
 * 扩展与 API 均开源:https://github.com/better-lyrics)。
 *
 * 卖点是**音节级 TTML**(Apple Music 风格 word/syllable timing)。本 provider
 * 把 TTML 转为增强 LRC(`[mm:ss.xx]` 行级 + `<mm:ss.xx>` 词级标签),词级信息
 * 完整保留在增强标签里(parseLrc 剥离渲染、标记 isEnhanced),未来渲染层支持
 * 逐字时无需换数据源。
 *
 * 接口:
 *   GET /getLyrics?s=<song>&a=<artist>&al=<album>&d=<duration 秒>
 *   200 → { ttml: "<TTML XML 字符串>" }   (缓存命中)
 *   404 → { error: "No lyrics available…" }(缓存内确认无词)
 *   401 → { error: "API key required…"}(未缓存查询要求 X-API-Key;公共实例常态)
 * 重要限制:公共实例对**未缓存**的查询强制要求 API key —— 新歌大概率 401。
 * 该源定位为"热门歌曲的 TTML 增强"(缓存命中率高),401/404 均静默跳过;
 * 401 不写负缓存(他人查询后可能变热),404 交编排层按确认无词处理。
 * 稳定性:非官方保证,随时可能变更;失败由上层静默回退。
 */
import { fetchJson } from '../fetcher'
import type { LyricProvider, LyricQuery, LyricResult, ProviderOutcome } from '../types'

const BASE = 'https://lyrics-api.boidu.dev'
const TIMEOUT_MS = 5_000

const HEADERS = {
  'User-Agent': 'lyriccast-ztools-plugin/0.2 (github.com/Particaly/LyricCast)'
}

/** 解析 TTML 时间属性:"18.893"(秒.毫秒)或 "0:18.893"/"mm:ss.mmm" → 毫秒;失败 NaN */
export function parseTtmlTime(raw: string): number {
  const text = (raw ?? '').trim()
  if (!text) return Number.NaN
  // mm:ss.mmm / h:mm:ss.mmm
  const parts = text.split(':')
  if (parts.length > 1) {
    const seconds = Number(parts[parts.length - 1])
    const minutes = Number(parts[parts.length - 2] ?? 0)
    const hours = parts.length > 2 ? Number(parts[0]) : 0
    if (!Number.isFinite(seconds) || !Number.isFinite(minutes) || !Number.isFinite(hours)) return Number.NaN
    return (hours * 3600 + minutes * 60 + seconds) * 1000
  }
  const seconds = Number(text)
  return Number.isFinite(seconds) ? seconds * 1000 : Number.NaN
}

/** 毫秒 → LRC 行时间戳 [mm:ss.xx] */
export function toLrcStamp(ms: number): string {
  const clamped = Math.max(0, Math.round(ms))
  const minutes = Math.floor(clamped / 60_000)
  const seconds = Math.floor((clamped % 60_000) / 1000)
  const hundredths = Math.floor((clamped % 1000) / 10)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `[${pad(minutes)}:${pad(seconds)}.${pad(hundredths)}]`
}

/** 毫秒 → LRC 词级增强标签 <mm:ss.xx>(行戳为方括号,词戳为尖括号,parseLrc 剥离) */
function toWordStamp(ms: number): string {
  return `<${toLrcStamp(ms).slice(1, -1)}>`
}

/**
 * TTML → 增强 LRC。
 * - `<p begin end>` 一行;行内 `<span begin>词</span>` 逐字;
 * - 多 span:词各转 `<mm:ss.xx>` 增强标签、词间以空格连接(剥掉标签后
 *   与整行文本一致,parseLrc 剥离渲染并标记 isEnhanced);
 * - 单 span 或无 span:退化为行级 `[mm:ss.xx]整行文本`;
 * - 忽略 `<head>` 与元数据;无任何带时间戳行时返回 null。
 */
export function ttmlToLrc(ttml: string): string | null {
  if (!ttml) return null
  const out: string[] = []
  const pPattern = /<p\b([^>]*)>([\s\S]*?)<\/p>/g
  let match: RegExpExecArray | null
  while ((match = pPattern.exec(ttml)) !== null) {
    const attrs = match[1] ?? ''
    const inner = match[2] ?? ''
    const beginRaw = attrs.match(/\bbegin\s*=\s*["\'\"]([^"\'\"]*)["\'\"]/)?.[1] ?? ''
    const beginMs = parseTtmlTime(beginRaw)
    if (!Number.isFinite(beginMs)) continue

    const words: Array<{ stamp: string; text: string }> = []
    const spanPattern = /<span\b([^>]*)>([\s\S]*?)<\/span>/g
    let spanMatch: RegExpExecArray | null
    while ((spanMatch = spanPattern.exec(inner)) !== null) {
      const spanAttrs = spanMatch[1] ?? ''
      const spanBegin = parseTtmlTime(spanAttrs.match(/\bbegin\s*=\s*["\'\"]([^"\'\"]*)["\'\"]/)?.[1] ?? '')
      const text = (spanMatch[2] ?? '')
        .replace(/<[^>]*>/g, '') // span 内还可能嵌 <emphasis> 等
        .trim()
      if (text) words.push({ stamp: toWordStamp(Number.isFinite(spanBegin) ? spanBegin : beginMs), text })
    }
    // 整行文本:剥掉全部标签后折叠空白(span 覆盖不全时也能兜住)
    const lineText = inner.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim()
    if (!lineText && words.length === 0) continue

    const stamp = toLrcStamp(beginMs)
    if (words.length >= 2) {
      out.push(`${stamp}${words.map((w) => `${w.stamp}${w.text}`).join(' ')}`)
    } else {
      out.push(`${stamp}${lineText ? ` ${lineText}` : ''}`)
    }
  }
  const result = out.join('\n').trim()
  return result.length > 0 ? result : null
}

/** Better Lyrics 响应(仅取关心的字段) */
interface BetterLyricsResponse {
  ttml?: string
}

function toQuery(params: Record<string, string>): string {
  return new URLSearchParams(params).toString()
}

export const betterLyricsProvider: LyricProvider = {
  name: 'betterlyrics',

  async search(query: LyricQuery, signal: AbortSignal): Promise<ProviderOutcome> {
    if (!query.title) return { status: 'not_found' }

    const params: Record<string, string> = { s: query.title }
    if (query.artist) params.a = query.artist
    if (query.album) params.al = query.album
    const durationSec = query.durationMs > 0 ? Math.round(query.durationMs / 1000) : undefined
    if (durationSec) params.d = String(durationSec)

    let payload: BetterLyricsResponse
    try {
      payload = (await fetchJson(`${BASE}/getLyrics?${toQuery(params)}`, { headers: HEADERS, signal })) as BetterLyricsResponse
    } catch (err) {
      if (signal.aborted) throw err
      const message = (err as Error)?.message ?? ''
      // 404 = 该曲确认无词(可参与负缓存);401 = 未缓存查询要 API key(热歌才有缓存),
      // 401 不写负缓存(时机敏感),归为 not_found 跳过;其余按 error。
      if (/\b404\b/.test(message)) return { status: 'not_found' }
      if (/\b401\b|\b403\b/.test(message)) return { status: 'not_found' }
      return { status: 'error', message: `betterlyrics: ${message}` }
    }

    const synced = ttmlToLrc(payload?.ttml ?? '')
    if (!synced) return { status: 'not_found' }
    // TTML 均为逐字级;给中等分(无本地打分对象),并行模式参与择优
    return { status: 'found', result: { synced, plain: null, translation: null, source: 'betterlyrics' }, score: 6 }
  }
}

export const BETTER_LYRICS_TIMEOUT = TIMEOUT_MS
