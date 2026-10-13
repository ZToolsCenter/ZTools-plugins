/**
 * 查询变体生成:同一首歌的多种搜索写法,按命中率从高到低排序,命中即停。
 *
 * 顺序(任务书约定):清洗后 title+artist → 仅 title → 原始未清洗标题 → 去除所有括号内容的标题。
 * 纯函数、去重、封顶(默认 4 条),provider 侧再叠加自身的请求预算控制。
 */
import { normalizeText } from './normalize'
import type { LyricQuery } from './types'

export interface QueryVariant {
  title: string
  artist: string
}

/** 移除全部括号附注(无论是否噪音词),用于最宽松的一档回退 */
export function stripAllBrackets(raw: string): string {
  return (raw || '')
    .replace(/[（(【\[][^）)】\]]*[）)】\]]/g, ' ')
    .replace(/\s{2,}/g, ' ')
    .trim()
}

/**
 * 生成查询变体(去重、按序、封顶)。
 * @param query 已清洗的查询(rawTitle/rawArtist 为原始值;缺省时退化为 cleaned 值)
 * @param limit 最多返回几条(默认 4)
 */
export function buildQueryVariants(query: LyricQuery, limit = 4): QueryVariant[] {
  const rawTitle = (query.rawTitle || '').trim() || query.title
  const cleaned = { title: query.title, artist: query.artist }

  const wanted: QueryVariant[] = [
    cleaned,
    { title: cleaned.title, artist: '' },
    { title: rawTitle, artist: '' },
    { title: stripAllBrackets(rawTitle), artist: '' }
  ]

  const seen = new Set<string>()
  const variants: QueryVariant[] = []
  for (const variant of wanted) {
    if (!variant.title.trim()) continue
    const key = `${normalizeText(variant.title)}|${normalizeText(variant.artist)}`
    if (seen.has(key)) continue
    seen.add(key)
    variants.push(variant)
    if (variants.length >= limit) break
  }
  return variants
}
