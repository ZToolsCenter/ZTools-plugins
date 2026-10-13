/**
 * 标题/歌手清洗:国内音乐 App 的媒体元数据经常把附注、版本号、"歌名 - 歌手"混进 title,
 * 直接拿去搜歌词命中率很低。这里做保守清洗 —— 只删确定是噪音的部分,宁可少删不可误删。
 *
 * 增强:
 * - 清洗的同时把识别到的版本信息提取为标签集合(extractVersionTags / cleanTitleDetailed),
 *   供候选打分做"对称版本惩罚"(match.ts);
 * - parseArtists 把歌手串拆成完整列表(带固定名白名单),供集合重叠打分;
 * - normalizeText 移至 normalize.ts(与缓存键共用的深度规范化),此处 re-export 保持兼容。
 */
import { normalizeText } from './normalize'

// normalizeText 定义移至 normalize.ts(与缓存键共用的深度规范化);此处 re-export 保持旧导入路径兼容
export { normalizeText }

/** 版本标签:识别到候选/查询标题里的"非原版"特征 */
export type VersionTag =
  | 'live' // 现场:live / 现场 / 演唱会
  | 'remix' // 混音:remix / mix / 混音
  | 'dj' // DJ 版
  | 'instrumental' // 无人声:伴奏 / instrumental / karaoke / 伴唱 / 纯音乐
  | 'cover' // 翻唱:cover / 翻唱 / 翻自
  | 'acoustic' // 编制变体:acoustic / 不插电 / 钢琴版 / 吉他版
  | 'demo' // 小样:demo / 小样
  | 'remaster' // 重制:remaster / 重制版 / 录音室版(弱惩罚)
  | 'tempo' // 速度变体:sped up / slowed / nightcore / 加速 / 降调

/** 重惩罚标签:版本性质完全不同,串歌风险高(remaster 除外) */
const HEAVY_TAGS: ReadonlySet<VersionTag> = new Set([
  'live',
  'remix',
  'dj',
  'instrumental',
  'cover',
  'acoustic',
  'demo',
  'tempo'
])

/** 打分用的标签惩罚权重:重惩罚 1.2,remaster 类只轻惩罚 0.4 */
export const TAG_PENALTY_HEAVY = 1.2
export const TAG_PENALTY_LIGHT = 0.4

/**
 * 版本关键词表(中英文集中维护):标签 → 关键词(不区分大小写)。
 * 只在括号附注/破折号后缀区域匹配,标题正文的同名英文单词不受影响。
 */
const VERSION_KEYWORDS: ReadonlyArray<readonly [VersionTag, string[]]> = [
  ['live', ['live', '现场版', '现场', '演唱会', 'concert']],
  ['remix', ['remix', '混音版', '混音', 'extended mix', 'bootleg', 'mix']],
  ['dj', ['dj版', 'dj 版', 'dj']],
  ['instrumental', ['instrumental', 'karaoke', 'off vocal', '伴奏', '伴唱', '纯音乐', 'inst\\.', 'backing']],
  ['cover', ['cover', '翻唱', '翻自']],
  ['acoustic', ['acoustic', '不插电', '钢琴版', '吉他版']],
  ['demo', ['demo', '小样']],
  ['remaster', ['remaster', '重制版', '复刻版', '录音室版', 'studio ver']],
  ['tempo', ['sped up', 'speed up', 'slowed', 'reverb', 'nightcore', 'daycore', '加速', '减速', '降调', '升调']]
]

/** 拉丁字母开头的关键词加词边界,纯 CJK 关键词直接匹配 */
function keywordToPattern(keyword: string): string {
  return /^[a-z]/i.test(keyword) ? `\\b${keyword}` : keyword
}

const TAG_PATTERNS: ReadonlyArray<readonly [VersionTag, RegExp]> = VERSION_KEYWORDS.map(
  ([tag, keywords]) => [tag, new RegExp(keywords.map(keywordToPattern).join('|'), 'i')]
)

/** cleanTitle 剥离噪音用的词表 = 版本词 + 纯噪音词(official/video/audio 等与版本无关) */
const JUNK_KEYWORDS = [
  'live',
  'feat',
  'ft\\.',
  'featuring',
  'with',
  'remaster',
  'deluxe',
  'acoustic',
  'cover',
  'version',
  'ver\\.',
  'edit',
  'remix',
  'mix',
  'official',
  'video',
  'audio',
  'mv',
  'instrumental',
  'karaoke',
  'off vocal',
  '伴奏',
  '伴唱',
  '现场',
  '翻唱',
  '翻自',
  '纯音乐',
  '重制版',
  '复刻版',
  '升级版',
  '录音室版',
  '加长版',
  '完整版',
  '修复版',
  '钢琴版',
  '吉他版',
  'demo',
  'sped up',
  'speed up',
  'slowed',
  'reverb',
  'nightcore',
  'daycore',
  '加速',
  '减速',
  '降调',
  '升调'
]

const JUNK_IN_BRACKETS = new RegExp(
  `[（(\\[【][^）)\\]】]*?(?:${JUNK_KEYWORDS.join('|')})[^）)\\]】]*?[）)\\]】]`,
  'i'
)

const TRAILING_DASH_JUNK = new RegExp(`[-–—]\\s*(?:${JUNK_KEYWORDS.join('|')}).*$`, 'i')

/** 提取所有括号附注段(全/半角圆括号、方括号、【】)与破折号后缀区域 */
function noiseZones(raw: string): string {
  const zones: string[] = []
  for (const match of raw.matchAll(/[（(【\[]([^）)】\]]*)[）)】\]]/g)) {
    zones.push(match[1] ?? '')
  }
  const dash = raw.match(/[-–—]\s*(\S.*)$/)
  if (dash) zones.push(dash[1] ?? '')
  return zones.join(' ')
}

/**
 * 从原始标题提取版本标签(必须在剥离之前调用,否则噪音词已被删掉)。
 * 只扫描括号附注与破折号后缀区域,避免误伤标题正文里的同名英文词。
 */
export function extractVersionTags(raw: string): Set<VersionTag> {
  const tags = new Set<VersionTag>()
  if (!raw) return tags
  const zones = noiseZones(raw)
  if (!zones) return tags
  for (const [tag, pattern] of TAG_PATTERNS) {
    if (pattern.test(zones)) tags.add(tag)
  }
  return tags
}

/**
 * 清洗歌名的完整信息:剥离后的标题 + 识别到的版本标签。
 * @param raw 原始 title
 * @param artist 已知歌手(可为空;空时不做"歌名 - 歌手"右删)
 */
export function cleanTitleDetailed(raw: string, artist = ''): { title: string; tags: Set<VersionTag> } {
  return { title: cleanTitle(raw, artist), tags: extractVersionTags(raw) }
}

/**
 * 清洗歌名(保持 v1 行为):
 * 1. 反复剥离含噪音关键词的括号附注(如 "(Live)"、"【Remastered 2011】");
 * 2. 剥离 " - Remastered" 类破折号后缀;
 * 3. 若已知歌手且 title 形如 "歌名 - 歌手"(右侧包含歌手名),去掉右侧;
 * 4. 折叠空白。
 *
 * @param raw 原始 title
 * @param artist 已知歌手(可为空;空时不做第 3 步,避免误删)
 */
export function cleanTitle(raw: string, artist = ''): string {
  let title = (raw || '').trim()
  // 括号噪音可能多层嵌套,最多剥 3 层
  for (let i = 0; i < 3; i++) {
    const next = title.replace(JUNK_IN_BRACKETS, '')
    if (next === title) break
    title = next
  }
  title = title.replace(TRAILING_DASH_JUNK, '')

  const artistNorm = normalizeText(artist)
  if (artistNorm) {
    const dashIndex = title.lastIndexOf(' - ')
    if (dashIndex > 0) {
      const right = normalizeText(title.slice(dashIndex + 3))
      const left = title.slice(0, dashIndex)
      // 右侧像歌手(包含歌手名且不太长)才删,防止误删"歌名 - 副标题"
      if (right && right.length <= 40 && right.includes(artistNorm)) {
        title = left
      }
    }
  }
  return title.replace(/\s{2,}/g, ' ').trim()
}

/**
 * 固定名白名单:含分隔符特征但绝不能拆开的艺人名(按规范化后比对)。
 */
const ARTIST_WHITELIST = [
  'AC/DC',
  'Simon & Garfunkel',
  'Earth, Wind & Fire',
  'Crosby, Stills & Nash',
  'Crosby, Stills, Nash & Young',
  'Booker T. & the M.G.',
  'Panic! At The Disco',
  'm-flo'
].map((name) => normalizeText(name))

/** feat 系连词:连词两侧要求空白,避免误伤普通单词 */
const FEAT_SEPARATOR = /\s+(?:feat\.?|featuring|ft\.?|with)\s+/i
/** 并列分隔符:顿号/斜杠/分号/逗号/&/×/单字母 x(合作标注常见写法) */
const LIST_SEPARATOR = /\s*[、/;；,]\s*|\s*&\s*|\s*×\s*|\s+x\s+|\s+X\s+/

/**
 * 拆分歌手串为完整列表(主歌手在前):
 * "A feat. B"、"A、B"、"A / B"、"A & B"、"A x B" 都拆开;
 * "AC/DC"、"Simon & Garfunkel" 这类固定名靠白名单保护。
 * cleanArtist(只取首项)行为不变,这里提供完整列表供集合重叠打分。
 */
export function parseArtists(raw: string): string[] {
  const artist = (raw || '').trim()
  if (!artist) return []

  const normalizedWhole = normalizeText(artist)
  if (ARTIST_WHITELIST.includes(normalizedWhole)) return [artist]

  // 先按 feat 连词切段(每段含主/合作者),再在各段内按并列符拆
  const segments: string[] = []
  let rest = artist
  while (rest) {
    const match = rest.match(FEAT_SEPARATOR)
    if (!match || match.index === undefined) break
    segments.push(rest.slice(0, match.index))
    rest = rest.slice(match.index + match[0].length)
  }
  segments.push(rest)

  const result: string[] = []
  for (const segment of segments) {
    for (const piece of segment.split(LIST_SEPARATOR)) {
      const trimmed = piece.trim()
      if (trimmed) result.push(trimmed)
    }
  }
  return result.length > 0 ? result : [artist]
}

/**
 * 清洗歌手(保持 v1 行为):去掉 "A feat. B" / "A、B" / "A / B" 中的合作者,只留主歌手,
 * 提高歌词库(普遍按主歌手索引)的命中率。
 */
export function cleanArtist(raw: string): string {
  const parsed = parseArtists(raw)
  return parsed[0] ?? ''
}

/** 标签是否重惩罚(live/remix 一类);remaster 类返回 false */
export function isHeavyTag(tag: VersionTag): boolean {
  return HEAVY_TAGS.has(tag)
}
