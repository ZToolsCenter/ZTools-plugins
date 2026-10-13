/**
 * Provider 路由:决定多来源的尝试顺序(纯函数,可测)。
 * 查询以 CJK 为主(标题+歌手合算)时,中文源(prefersCjk)排最前;否则保持原顺序。
 * 并行模式下该顺序仅影响"同时请求谁先被收集",串行模式则决定回退次序。
 */
import { normalizeText, scriptRatio } from './normalize'
import type { LyricProvider, LyricQuery } from './types'

/** 查询(标题+歌手)是否以 CJK 为主:规范化后 CJK 字符数 ≥ 拉丁字母数 */
export function isCjkQuery(query: Pick<LyricQuery, 'title' | 'artist'>): boolean {
  const ratio = scriptRatio(`${normalizeText(query.title)} ${normalizeText(query.artist)}`)
  if (ratio.cjk + ratio.latin === 0) return false
  return ratio.cjk >= ratio.latin
}

/** 路由:CJK 为主时中文源提前,其余保持相对顺序 */
export function routeProviders<T extends LyricProvider>(providers: T[], query: LyricQuery): T[] {
  const cjk = isCjkQuery(query)
  if (!cjk) return [...providers]
  const first = providers.filter((p) => p.prefersCjk)
  const rest = providers.filter((p) => !p.prefersCjk)
  return [...first, ...rest]
}
