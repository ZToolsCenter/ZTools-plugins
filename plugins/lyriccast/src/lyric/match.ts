/**
 * 候选挑选:从歌词库返回的多条搜索结果里挑出与手机推送曲目最匹配的一条。
 *
 * 打分维度(在 v1"标题×4 + 歌手×2 + 时长加分"基础上增强):
 * - 标题相似度:三路加权(LCS-Dice / bigram Jaccard / 归一化编辑距离),短标题有
 *   "相等或互相包含"硬保护,避免"爱"匹配到"爱你一万年"一类误配;标题与别名取最高分;
 * - 版本标签对称惩罚:live/remix/伴奏/翻唱等一方有而另一方没有就扣分(remaster 轻惩罚),
 *   严重错版 + 时长差超 15s 的候选直接排除;
 * - 歌手:集合重叠(parseArtists 拆全列表,规范化后允许包含关系),合作者全命中给小加分;
 *   标题几乎全等且时长差 ≤2s 时歌手权重降到 0.5(跨语言"中文名 vs 英文名"场景);
 * - 专辑:小加分(完全相等 +1,近似 +0.5),不匹配不扣(合辑里同名歌常见);
 * - 歌词内容反校验(候选已带歌词时):尾部时间戳超出曲目时长、歌词语言与查询语言不符,
 *   都视为可疑扣分;平分时按 有时间轴 > 行数多 > 有翻译 > 逐字 加微小的序奖励。
 *
 * 硬门槛保持 v1:标题相似度 ≥ 0.4 才可信;门槛不过一律返回 null(宁缺毋滥)。
 */
import type { LyricQuery } from './types'
import {
  cleanTitle,
  extractVersionTags,
  isHeavyTag,
  normalizeText,
  parseArtists,
  TAG_PENALTY_HEAVY,
  TAG_PENALTY_LIGHT,
  type VersionTag
} from './clean-title'
import { isCjkMajor, scriptRatio } from './normalize'
import { parseLrc } from './parse-lrc'

export interface Candidate {
  title?: string
  artist?: string
  album?: string
  /** 与音乐库无关的附加字段由泛型承载 */
  durationMs?: number
  /** 标题别名/译名(网易云 alias/tns):参与标题相似度取最高 */
  aliasNames?: string[]
  /** 歌手别名(跨语言场景):并入歌手集合比较 */
  artistAliases?: string[]
  /** 候选已携带的同步歌词(内容反校验用;无则跳过该维度) */
  synced?: string | null
  /** 候选已携带的翻译(序奖励用) */
  translation?: string | null
  [key: string]: unknown
}

// ==================== 权重常量 ====================

/** 标题相似度权重 / 完全相等再加分 */
export const W_TITLE = 4
export const BONUS_EXACT_TITLE = 1.5
/** 歌手相似度权重;标题几乎全等 + 时长差 ≤2s 时降到此值(跨语言名失配) */
export const W_ARTIST = 2
export const W_ARTIST_CROSS_LANGUAGE = 0.5
/** 标题判定为"几乎完全相等"的相似度下限 */
export const TITLE_NEAR_EQUAL = 0.92
/** 歌手全部(多位)命中时的小加分 */
export const BONUS_FULL_MULTI_ARTIST = 0.5
/** 专辑加分上限(完全相等);近似(≥0.8)给一半 */
export const BONUS_ALBUM_FULL = 1
export const BONUS_ALBUM_NEAR = 0.5
/** 歌词内容可疑扣分:尾时间戳超时长 / 语言不符 */
export const PENALTY_CONTENT = 2
/** 内容晚于时长 +10s 视为不同版本 */
export const CONTENT_OVERRUN_MS = 10_000
/** 平分序奖励:有时间轴 > 行数多 > 有翻译 > 逐字 */
export const BONUS_HAS_SYNCED = 0.6
export const BONUS_LINE_COUNT_MAX = 0.3
export const BONUS_HAS_TRANSLATION = 0.2
export const BONUS_ENHANCED = 0.1
/** 标题硬门槛(v1 语义保持) */
export const TITLE_GATE = 0.4
/** 短标题判定:CJK 规范化后 ≤3 字,拉丁 ≤5 字母;互相包含时长度比不得超过 2 */
export const SHORT_TITLE_CJK = 3
export const SHORT_TITLE_LATIN = 5
export const SHORT_CONTAIN_MAX_RATIO = 2
/** 歌手名包含关系判定:短名至少 2 字符,长度比 ≤3 */
export const ARTIST_CONTAIN_MIN_LEN = 2
export const ARTIST_CONTAIN_MAX_RATIO = 3

// ==================== 相似度 ====================

/** 最长公共子序列长度 —— 对"插入/删字"容错,比 Levenshtein 更适合歌名比对 */
function lcsLength(a: string, b: string): number {
  if (!a || !b) return 0
  let prev = new Array<number>(b.length + 1).fill(0)
  for (let i = 1; i <= a.length; i++) {
    const curr = [0]
    for (let j = 1; j <= b.length; j++) {
      curr[j] = a[i - 1] === b[j - 1] ? (prev[j - 1] ?? 0) + 1 : Math.max(prev[j] ?? 0, curr[j - 1] ?? 0)
    }
    prev = curr
  }
  return prev[b.length] ?? 0
}

/** LCS-Dice:2·LCS/(lenA+lenB) */
function lcsDice(a: string, b: string): number {
  const total = a.length + b.length
  return total === 0 ? 0 : Math.min(1, (2 * lcsLength(a, b)) / total)
}

/** bigram Jaccard;过短字符串退化为单字 Jaccard */
function bigramJaccard(a: string, b: string): number {
  const gram = (s: string): Set<string> => {
    if (s.length < 2) return new Set(s ? [s] : [])
    const grams = new Set<string>()
    for (let i = 0; i < s.length - 1; i++) grams.add(s.slice(i, i + 2))
    return grams
  }
  const ga = gram(a)
  const gb = gram(b)
  if (ga.size === 0 && gb.size === 0) return 0
  let inter = 0
  for (const g of ga) if (gb.has(g)) inter++
  const union = ga.size + gb.size - inter
  return union === 0 ? 0 : inter / union
}

/** 归一化编辑距离:1 - lev/maxLen */
function normalizedEditSim(a: string, b: string): number {
  const maxLen = Math.max(a.length, b.length)
  if (maxLen === 0) return 0
  if (a === b) return 1
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j)
  for (let i = 1; i <= a.length; i++) {
    const curr = [i]
    for (let j = 1; j <= b.length; j++) {
      curr[j] = Math.min((prev[j] ?? 0) + 1, (curr[j - 1] ?? 0) + 1, (prev[j - 1] ?? 0) + (a[i - 1] === b[j - 1] ? 0 : 1))
    }
    prev = curr
  }
  return 1 - (prev[b.length] ?? maxLen) / maxLen
}

function isShortTitle(text: string): boolean {
  return text.length <= (isCjkMajor(text) ? SHORT_TITLE_CJK : SHORT_TITLE_LATIN)
}

/** 三路加权的标题相似度;权重集中在此,便于测试调整 */
const W_LCS = 0.5
const W_BIGRAM = 0.3
const W_EDIT = 0.2

/**
 * 标题相似度 0..1:规范化后比较;短标题(≤3 CJK / ≤5 拉丁)必须相等或互相包含
 * (且长度比 ≤2),否则直接 0 —— "宁缺毋滥"的硬保护。
 */
export function similarity(a: string, b: string): number {
  const na = normalizeText(a)
  const nb = normalizeText(b)
  if (!na || !nb) return 0
  if (na === nb) return 1

  const shorter = na.length <= nb.length ? na : nb
  const longer = na.length <= nb.length ? nb : na
  if (isShortTitle(na) || isShortTitle(nb)) {
    if (!longer.includes(shorter)) return 0
    // 比例 >= 2 视为悬殊:1 字标题只允许全等,2 字标题最多多 1 字符(防"爱"→"爱你"误配)
    if (longer.length / shorter.length >= SHORT_CONTAIN_MAX_RATIO) return 0
  }
  return Math.max(
    0,
    Math.min(1, W_LCS * lcsDice(na, nb) + W_BIGRAM * bigramJaccard(na, nb) + W_EDIT * normalizedEditSim(na, nb))
  )
}

// ==================== 歌手集合 ====================

/** 已拆好的歌手列表规范化去重(查询侧 allArtists 用) */
function dedupeNames(names: string[]): string[] {
  const out = new Set<string>()
  for (const name of names) {
    const norm = normalizeText(name)
    if (norm) out.add(norm)
  }
  return [...out]
}

/** 规范化去重后的歌手列表 */
function artistSet(raw: string, aliases?: string[]): string[] {
  const names = new Set<string>()
  for (const name of [...parseArtists(raw), ...(aliases ?? [])]) {
    const norm = normalizeText(name)
    if (norm) names.add(norm)
  }
  return [...names]
}

/** 两边歌手集合完全无交集(一个都没匹配上) */
function artistSetsDisjoint(a: string[], b: string[]): boolean {
  return !a.some((x) => b.some((y) => artistNamesRelated(x, y)))
}

/** 查询歌手与候选歌手主文字体系不同(CJK vs 拉丁),跨语言名场景判定用 */
function artistScriptsDiffer(a: string, b: string): boolean {
  const na = normalizeText(a)
  const nb = normalizeText(b)
  if (!na || !nb) return false
  return isCjkMajor(na) !== isCjkMajor(nb)
}

/** 歌手名相关:规范化后相等,或包含关系(短名 ≥2 字符且长度比 ≤3) */
function artistNamesRelated(a: string, b: string): boolean {
  if (a === b) return true
  const shorter = a.length <= b.length ? a : b
  const longer = a.length <= b.length ? b : a
  return (
    shorter.length >= ARTIST_CONTAIN_MIN_LEN &&
    longer.includes(shorter) &&
    longer.length / shorter.length <= ARTIST_CONTAIN_MAX_RATIO
  )
}

// ==================== 打分 ====================

/** 单条候选打分;导出仅为测试。返回 -Infinity 表示"直接排除"(严重错版 + 时长差远) */
export function scoreCandidate(candidate: Candidate, query: LyricQuery): number {
  const rawCandidateTitle = candidate.title ?? ''
  const candidateTitle = cleanTitle(rawCandidateTitle, candidate.artist ?? '')
  const candidateTags = extractVersionTags(rawCandidateTitle)
  const queryTags = query.versionTags ? new Set<VersionTag>(query.versionTags) : extractVersionTags(query.title)

  // 标题相似度:主标题与别名取最高
  let titleSim = similarity(query.title, candidateTitle)
  for (const alias of candidate.aliasNames ?? []) {
    titleSim = Math.max(titleSim, similarity(query.title, cleanTitle(alias)))
  }

  // 版本标签对称惩罚;严重错版(重惩罚标签失配)且时长差 >15s 直接排除
  let tagPenalty = 0
  let heavyMismatch = false
  for (const tag of queryTags) {
    if (candidateTags.has(tag)) continue
    tagPenalty += isHeavyTag(tag) ? TAG_PENALTY_HEAVY : TAG_PENALTY_LIGHT
    if (isHeavyTag(tag)) heavyMismatch = true
  }
  for (const tag of candidateTags) {
    if (queryTags.has(tag)) continue
    tagPenalty += isHeavyTag(tag) ? TAG_PENALTY_HEAVY : TAG_PENALTY_LIGHT
    if (isHeavyTag(tag)) heavyMismatch = true
  }
  const durationDelta =
    query.durationMs > 0 && typeof candidate.durationMs === 'number' && candidate.durationMs > 0
      ? Math.abs(candidate.durationMs - query.durationMs)
      : 0
  if (heavyMismatch && durationDelta > 15_000) return -Infinity

  let score = titleSim * W_TITLE
  if (titleSim === 1) score += BONUS_EXACT_TITLE

  // 歌手集合重叠;标题几乎全等且时长几乎一致时歌手权重降低(跨语言名)
  const queryArtists = query.allArtists ? dedupeNames(query.allArtists) : artistSet(query.artist)
  const candidateArtists = artistSet(candidate.artist ?? '', candidate.artistAliases)
  if (queryArtists.length > 0 && candidateArtists.length > 0) {
    const matched = queryArtists.filter((q) => candidateArtists.some((c) => artistNamesRelated(c, q)))
    // 跨语言降权:仅当"标题几乎全等 + 时长几乎一致 + 歌手零交集 + 双方主文字体系不同"
    // (中文歌手 vs 英文译名);同语言场景保持全权重,避免削弱真实歌手区分度
    const crossLanguage =
      titleSim >= TITLE_NEAR_EQUAL &&
      durationDelta <= 2_000 &&
      artistSetsDisjoint(queryArtists, candidateArtists) &&
      artistScriptsDiffer(query.artist, candidate.artist ?? '')
    score += (matched.length / queryArtists.length) * (crossLanguage ? W_ARTIST_CROSS_LANGUAGE : W_ARTIST)
    if (queryArtists.length > 1 && matched.length === queryArtists.length) score += BONUS_FULL_MULTI_ARTIST
  }

  // 歌手零交集且时长差远:同名不同人的概率极高,宁缺毋滥直接排除
  if (
    queryArtists.length > 0 &&
    candidateArtists.length > 0 &&
    artistSetsDisjoint(queryArtists, candidateArtists) &&
    durationDelta > 15_000
  ) {
    return -Infinity
  }

  // 时长加分(v1 语义保持)
  if (durationDelta > 0) {
    if (durationDelta <= 3000) score += 3
    else if (durationDelta <= 5000) score += 1
    else if (durationDelta > 15000) score -= 1
  }

  // 专辑加分:完全相等 +1,近似 +0.5;不匹配不扣(合辑同名歌常见)
  if (query.album && candidate.album) {
    const albumSim = similarity(query.album, cleanTitle(candidate.album))
    if (albumSim === 1) score += BONUS_ALBUM_FULL
    else if (albumSim >= 0.8) score += BONUS_ALBUM_NEAR
  }

  // 歌词内容反校验(仅当候选携带歌词)
  if (typeof candidate.synced === 'string' && candidate.synced.trim()) {
    const parsed = parseLrc(candidate.synced)
    const lines = parsed.lines.filter((line) => line.text.trim() !== '')
    if (lines.length > 0) {
      const last = lines[lines.length - 1]?.timeMs ?? 0
      if (query.durationMs > 0 && last > query.durationMs + CONTENT_OVERRUN_MS) score -= PENALTY_CONTENT

      // 语言一致性:查询以 CJK 为主而歌词几乎全拉丁(或反向)扣分;阈值保守,中英混排正常歌不受影响
      const qRatio = scriptRatio(`${query.title} ${query.artist}`)
      const qTotal = qRatio.cjk + qRatio.latin
      const lRatio = scriptRatio(lines.map((line) => line.text).join(''))
      const lTotal = lRatio.cjk + lRatio.latin
      if (qTotal > 0 && lTotal > 0) {
        const qCjkRatio = qRatio.cjk / qTotal
        const lCjkRatio = lRatio.cjk / lTotal
        if (qCjkRatio > 0.5 && lCjkRatio < 0.1) score -= PENALTY_CONTENT
        if (qCjkRatio < 0.1 && lCjkRatio > 0.5) score -= PENALTY_CONTENT
      }

      // 序奖励:有时间轴 > 行数多 > 有翻译 > 逐字
      score += BONUS_HAS_SYNCED
      score += BONUS_LINE_COUNT_MAX * Math.max(0, Math.min(1, (lines.length - 8) / 60))
      if (parsed.isEnhanced) score += BONUS_ENHANCED
    }
  }
  if (candidate.translation) score += BONUS_HAS_TRANSLATION

  return score - tagPenalty
}

export interface BestMatch<T> {
  candidate: T
  /** 总分(打分明细见 scoreCandidate) */
  score: number
  /** 标题相似度(硬门槛判定依据) */
  titleSim: number
}

function titleSimOf(candidate: Candidate, query: LyricQuery): number {
  let titleSim = similarity(query.title, cleanTitle(candidate.title ?? '', candidate.artist ?? ''))
  for (const alias of candidate.aliasNames ?? []) {
    titleSim = Math.max(titleSim, similarity(query.title, cleanTitle(alias)))
  }
  return titleSim
}

/**
 * 挑选最佳候选(带分数,供缓存元数据/置信度门限使用)。
 * @returns 最佳候选;分数过低(标题对不上)或全部被排除时返回 null
 */
export function pickBestWithScore<T extends Candidate>(candidates: T[], query: LyricQuery): BestMatch<T> | null {
  let best: T | null = null
  let bestScore = -Infinity
  let bestTitleSim = 0
  for (const candidate of candidates) {
    const score = scoreCandidate(candidate, query)
    if (score > bestScore) {
      bestScore = score
      best = candidate
      bestTitleSim = titleSimOf(candidate, query)
    }
  }
  if (!best || bestTitleSim < TITLE_GATE) return null
  return { candidate: best, score: bestScore, titleSim: bestTitleSim }
}

/**
 * 挑选最佳候选(v1 兼容入口)。
 * @returns 最佳候选;分数过低(标题都对不上)时返回 null
 */
export function pickBestCandidate<T extends Candidate>(candidates: T[], query: LyricQuery): T | null {
  return pickBestWithScore(candidates, query)?.candidate ?? null
}
