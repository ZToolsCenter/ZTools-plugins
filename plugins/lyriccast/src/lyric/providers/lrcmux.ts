/**
 * lrcmux provider(聚合源,公开实例 https://api.lrcmux.dev,MIT 开源,
 * 仓库 https://github.com/f1nniboy/lrcmux)。
 *
 * 聚合 LRCLIB / Musixmatch / 酷狗 / Genius / Deezer 等来源,LRCLIB 搜不到的曲目
 * 往往能在这里命中(服务端已做扇出与择优)。单次请求直接返回最优结果,因此
 * **没有候选列表概念**(不实现 searchCandidates)。
 *
 * 接口(本 provider 用 JSON 格式,自转 LRC 以便统一管线):
 *   GET /get?artist=&title=&album=&duration=&level=line&format=json
 *   200 → { track:{title,artist,album,isrc,duration}, meta:{source:{id,name,url}, level},
 *           lines:[{text, start(ms), end(ms), words:[{text,start,end}]}] }
 *   404 → {title:"Not Found", status:404, detail:"no lyrics found"}(确认无结果)
 *   429 → 带 Retry-After(限流;由编排层按 error 处理,不写负缓存)
 * 稳定性:公益服务;失败由上层静默回退。请求头带标识 User-Agent(官方建议)。
 */
import { fetchJson } from '../fetcher'
import { buildQueryVariants } from '../query-variants'
import type { LyricProvider, LyricQuery, LyricResult, ProviderOutcome } from '../types'

const BASE = 'https://api.lrcmux.dev'
const TIMEOUT_MS = 5_000
/** 查询变体上限(服务端自身会扇出多个源,不叠加太多变体) */
const MAX_VARIANTS = 2

const HEADERS = {
  // lrcmux 官方建议:标识应用与联系方式,便于对方排查;不含隐私信息
  'User-Agent': 'lyriccast-ztools-plugin/0.2 (github.com/Particaly/LyricCast)'
}

/** 一行歌词(解析后的 lrcmux JSON lines 项) */
export interface LrcmuxLine {
  text: string
  start?: number | null
  end?: number | null
  words?: Array<{ text: string; start?: number | null; end?: number | null }> | null
}

/** lrcmux JSON 响应(仅取本 provider 关心的字段;结构异常按未命中处理) */
export interface LrcmuxResponse {
  meta?: { source?: { id?: string; name?: string } | null; level?: string; instrumental?: boolean }
  track?: { title?: string; artist?: string; album?: string }
  lines?: LrcmuxLine[]
}

/** 毫秒 → LRC 行内时间戳 [mm:ss.xx] */
export function toLrcStamp(ms: number): string {
  const clamped = Math.max(0, Math.round(ms))
  const minutes = Math.floor(clamped / 60_000)
  const seconds = Math.floor((clamped % 60_000) / 1000)
  const hundredths = Math.floor((clamped % 1000) / 10)
  const pad = (n: number, w = 2) => String(n).padStart(w, '0')
  return `[${pad(minutes)}:${pad(seconds)}.${pad(hundredths)}]`
}

/**
 * lrcmux JSON → LRC 文本:
 * - 行级(start 存在)→ `[mm:ss.xx]text`;
 * - 词级(words 存在且非空)→ 词首时间转 `<mm:ss.xxx>` 增强标签(parseLrc 剥离并
 *   标记 isEnhanced,词间空格保留,信息不丢失);
 * - 无 start 的行(text-only)按纯文本段插入(无时间戳行被 parseLrc 忽略,
 *   纯文本兜底交给其他来源)。
 * 返回 null 表示没有任何可展示行。
 */
export function linesToLrc(lines: LrcmuxLine[]): string | null {
  const out: string[] = []
  for (const line of lines ?? []) {
    const text = (line.text ?? '').trim()
    if (!text) continue
    if (typeof line.start !== 'number') continue // 纯文本行不进时间轴,避免打乱渲染
    const stamp = toLrcStamp(line.start)
    const words = (line.words ?? []).filter((w) => (w.text ?? '').trim() !== '')
    if (words.length > 1 && words.every((w) => typeof w.start === 'number')) {
      const parts = words.map((w) => `<${toLrcStamp(w.start as number).slice(1, -1)}>`)
      const joined = words.map((w, i) => `${parts[i]}${w.text}`).join('')
      out.push(`${stamp}${joined}`)
    } else {
      out.push(`${stamp}${text}`)
    }
  }
  return out.length > 0 ? out.join('\n') : null
}

function toQuery(params: Record<string, string>): string {
  return new URLSearchParams(params).toString()
}

export const lrcmuxProvider: LyricProvider = {
  name: 'lrcmux',

  async search(query: LyricQuery, signal: AbortSignal): Promise<ProviderOutcome> {
    const variants = buildQueryVariants(query, MAX_VARIANTS)
    if (variants.length === 0) return { status: 'not_found' }

    for (const variant of variants) {
      // lrcmux 要求 artist+title 成对(仅 title 会 400):无 artist 的变体直接跳过
      if (!variant.artist.trim()) continue
      const params: Record<string, string> = {
        title: variant.title,
        artist: variant.artist,
        level: 'line', // 只要行级;词级由 words 自带,不强求
        format: 'json'
      }
      if (query.album) params.album = query.album
      const durationSec = query.durationMs > 0 ? Math.round(query.durationMs / 1000) : undefined
      if (durationSec) params.duration = String(durationSec)

      let payload: LrcmuxResponse
      try {
        payload = (await fetchJson(`${BASE}/get?${toQuery(params)}`, { headers: HEADERS, signal })) as LrcmuxResponse
      } catch (err) {
        if (signal.aborted) throw err
        // 404 = 聚合器确认无结果;400 = 变体参数无效(如无 artist)→ 均按该变体未命中;
        // 其余(429/5xx/网络)→ error,交编排层(不写负缓存)
        const message = (err as Error)?.message ?? ''
        if (/\b404\b/.test(message) || /\b400\b/.test(message)) continue
        return { status: 'error', message: `lrcmux: ${message}` }
      }

      if (payload?.meta?.instrumental) return { status: 'not_found' } // 纯音乐按未命中
      const synced = linesToLrc(payload?.lines ?? [])
      if (!synced) continue
      const source = payload.meta?.source?.id
      return {
        status: 'found',
        result: { synced, plain: null, translation: null, source: source ? `lrcmux:${source}` : 'lrcmux' },
        // 聚合源无本地候选打分;给中等分使其在并行模式可参与择优(不被误判高置信)
        score: 6
      }
    }
    return { status: 'not_found' }
  }
}

export const LRCMUX_TIMEOUT = TIMEOUT_MS
