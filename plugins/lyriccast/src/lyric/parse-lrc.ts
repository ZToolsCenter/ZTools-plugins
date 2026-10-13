/**
 * LRC 解析:支持多时间戳行、[offset:] 全局偏移、毫秒 2~3 位;
 * 增强型逐字时间戳(<mm:ss.xx>)本期只剥离不渲染(标记 isEnhanced,待验证渲染需求)。
 */
import type { LyricsLine } from './types'

export interface ParsedLyrics {
  /** 按 timeMs 升序;含空文本行(间奏),调用方自行处理 */
  lines: LyricsLine[]
  /** [offset:] 标签原始值(毫秒);未提供为 0。已应用到 lines[].timeMs = 原始 − offset */
  offsetTagMs: number
  /** 检测到增强型逐字时间戳 */
  isEnhanced: boolean
}

const TIME_TAG = /\[(\d{1,3}):(\d{1,2})(?:[.:](\d{1,3}))?\]/g
const WORD_TAG = /<\d{1,3}:\d{1,2}(?:[.:]\d{1,3})?>/g
const OFFSET_TAG = /^\s*\[offset:\s*([+-]?\d+)\s*\]/im

/**
 * 元数据行(作词/作曲/编曲/混音等)判定:关键词 + 全/半角冒号 + 短内容。
 * 只在歌词开头区域生效(见 isMetadataLineAt 的使用方式),避免误删正文中
 * 恰好含"作词"二字的正常歌词。
 */
const METADATA_KEYWORD =
  /^(?:作词|作詞|作曲|编曲|編曲|填词|填詞|填曲|制作|製作|制作人|製作人|监制|監製|混音|母带|母帶|和声|和聲|录音|錄音|和音|OP|SP|Lyricist|Lyrics(\s+by)?|Composer|Composed(\s+by)?|Arranger|Producer|Produced(\s+by)?|Mixed(\s+by)?|Mastered(\s+by)?)\s*[:：]/i
const METADATA_MAX_CHARS = 50

function isMetadataText(text: string): boolean {
  const trimmed = text.trim()
  return trimmed.length > 0 && trimmed.length <= METADATA_MAX_CHARS && METADATA_KEYWORD.test(trimmed)
}

/**
 * 解析 LRC 文本。非法输入(空串/无时间戳)返回 lines=[],调用方按"解析失败"处理。
 *
 * @param lrc LRC 原文
 */
export function parseLrc(lrc: string): ParsedLyrics {
  const result: ParsedLyrics = { lines: [], offsetTagMs: 0, isEnhanced: false }
  if (!lrc) return result

  const offsetMatch = OFFSET_TAG.exec(lrc)
  if (offsetMatch) result.offsetTagMs = parseInt(offsetMatch[1], 10)

  const seen = new Set<string>()
  for (const rawLine of lrc.split(/\r?\n/)) {
    const line = rawLine.replace(WORD_TAG, '')
    if (line !== rawLine) result.isEnhanced = true

    TIME_TAG.lastIndex = 0
    const stamps: number[] = []
    let match: RegExpExecArray | null
    let lastTagEnd = 0
    while ((match = TIME_TAG.exec(line)) !== null) {
      const minutes = parseInt(match[1], 10)
      const seconds = parseInt(match[2], 10)
      const fractionRaw = match[3] ?? '0'
      // 两位=百分之一秒,三位=毫秒
      const fraction =
        fractionRaw.length === 1
          ? parseInt(fractionRaw, 10) * 100
          : fractionRaw.length === 2
            ? parseInt(fractionRaw, 10) * 10
            : parseInt(fractionRaw, 10)
      stamps.push(minutes * 60_000 + seconds * 1_000 + fraction)
      lastTagEnd = TIME_TAG.lastIndex
    }
    if (stamps.length === 0) continue // 元数据行/空行

    const text = line.slice(lastTagEnd).trim()
    // 开头区域的"作词:xxx"等制作信息行不进入歌词体(保证 isUsableSynced 的
    // 行数/跨度统计和渲染都不受空壳元数据干扰);一旦出现正式歌词行即停止过滤
    if (result.lines.length === 0 && isMetadataText(text)) continue
    for (const raw of stamps) {
      const timeMs = raw - result.offsetTagMs
      const key = `${timeMs}|${text}`
      if (seen.has(key)) continue
      seen.add(key)
      result.lines.push({ timeMs, text })
    }
  }
  result.lines.sort((a, b) => a.timeMs - b.timeMs)
  return result
}

/**
 * 判断一段 LRC 是否是"可用的"时间轴歌词。
 * 网易云等来源对无时间轴的歌也会返回 synced 字段,但内容是纯文本或全零时间戳空壳,
 * 直接按逐行高亮渲染体验极差;调用方应在展示/缓存前用本函数把关。
 *
 * 判定标准:至少 2 行带时间戳、时间戳至少 2 个不同取值、且整体跨度 ≥ 5 秒。
 * @param lrc LRC 原文
 */
export function isUsableSynced(lrc: string): boolean {
  if (!lrc) return false
  const { lines } = parseLrc(lrc)
  if (lines.length < 2) return false
  const times = new Set(lines.map((line) => line.timeMs))
  if (times.size < 2) return false
  const first = lines[0]?.timeMs ?? 0
  const last = lines[lines.length - 1]?.timeMs ?? 0
  return last - first >= 5_000
}

/**
 * 把 LRC 原文降级为纯文本歌词:剥掉时间戳/增强标签与元数据行,保留演唱文本。
 * 用于"来源声称 synced 但实际无有效时间轴"时的兜底展示。
 */
export function lrcToPlain(lrc: string): string {
  if (!lrc) return ''
  const lines: string[] = []
  for (const rawLine of lrc.split(/\r?\n/)) {
    // 逐个剥掉行首的 [...] 标签(时间戳与 ar/ti 等元数据);剥完为空说明是纯元数据行
    const text = rawLine
      .replace(TIME_TAG, '')
      .replace(WORD_TAG, '')
      .replace(/^(\s*\[[^\]]*\])+\s*/, '')
      .trim()
    if (!text) continue
    // 开头区域过滤"作词:xxx"制作信息,与 parseLrc 行为一致
    if (lines.length === 0 && isMetadataText(text)) continue
    lines.push(text)
  }
  // 相邻去重:同一句被多时间戳标记时只保留一次
  const result: string[] = []
  for (const text of lines) {
    if (result[result.length - 1] !== text) result.push(text)
  }
  return result.join('\n')
}

/**
 * 二分查找"正在唱的一行":最后一个 timeMs <= position 的行;position 早于第一行时返回 -1。
 * @param lines 必须已按 timeMs 升序(parseLrc 保证)
 */
export function findActiveLine(lines: LyricsLine[], positionMs: number): number {
  let low = 0
  let high = lines.length - 1
  let found = -1
  while (low <= high) {
    const mid = (low + high) >> 1
    if ((lines[mid]?.timeMs ?? 0) <= positionMs) {
      found = mid
      low = mid + 1
    } else {
      high = mid - 1
    }
  }
  return found
}
