/**
 * 歌词繁→简显示转换(纯同步,字表直转)。
 *
 * 采用「枚举字表直转」而非翻译渠道:繁→简是多对一的字级映射,查表无歧义,
 * 离线零延迟且绝不会改写歌词/漏行/行数错位;词汇级差异(如「滑鼠/鼠标」)
 * 属于地域用语而非简繁转换范畴,不做处理。
 * 字表为 OpenCC TSCharacters 全表(t2s-table.ts,约 3000 对),表外字符保持原样
 * (生僻字两侧字形通常一致,不影响阅读)。
 *
 * 检测防误判:整段歌词的繁体特征字需同时满足绝对数与占比下限,个别港台用字
 * (如「裡」)不至触发;含假名一律视为日文歌词,不转换。
 */
import { T2S_PAIRS } from './t2s-table'

/** 表外补充映射:OpenCC 字表缺失但简体侧写法唯一的常用字(妳→你、砲→炮) */
const T2S_EXTRA_PAIRS = '妳你砲炮'

/** 繁→简映射表(模块级懒构建;键为繁体字,值为简体字) */
const T2S_MAP: ReadonlyMap<string, string> = (() => {
  const map = new Map<string, string>()
  for (const pairs of [T2S_PAIRS, T2S_EXTRA_PAIRS]) {
    for (let i = 0; i < pairs.length; i += 2) {
      map.set(pairs[i] as string, pairs[i + 1] as string)
    }
  }
  return map
})()

/** 汉字/假名统计口径(区间与 normalize.ts 的 scriptRatio 一致) */
const HAN_RE = /[\u3400-\u9fff\uf900-\ufaff]/g
const KANA_RE = /[\u3040-\u30ff]/g

/** 繁体判定阈值:特征字绝对数 ≥ 3 且占汉字总数 ≥ 2% 才判定为繁体 */
const MIN_TRAD_HITS = 3
const MIN_TRAD_RATIO = 0.02

/** 繁体特征统计结果 */
export interface TraditionalStats {
  /** 落入繁简映射表的字数(繁体特征字) */
  hits: number
  /** 汉字总数 */
  hanTotal: number
  /** 假名数(> 0 视为日文歌词) */
  kana: number
  /** 是否判定为繁体中文(假名守卫 + 双阈值综合) */
  traditional: boolean
}

/**
 * 统计文本的繁体特征字分布并给出繁体判定。
 * @param text 任意文本(调用方通常传入整段歌词的拼接)
 * @returns hits/hanTotal/kana 统计与 traditional 判定
 */
export function analyzeTraditional(text: string): TraditionalStats {
  const kana = (text.match(KANA_RE) ?? []).length
  const han = text.match(HAN_RE) ?? []
  let hits = 0
  for (const ch of han) if (T2S_MAP.has(ch)) hits++
  const traditional =
    kana === 0 && han.length > 0 && hits >= MIN_TRAD_HITS && hits / han.length >= MIN_TRAD_RATIO
  return { hits, hanTotal: han.length, kana, traditional }
}

/**
 * 是否判定为繁体中文文本(含假名视为日文歌词,一律 false)。
 * @param text 任意文本;判定以"特征字占比"为准,不要求全文皆繁体
 */
export function isTraditionalChinese(text: string): boolean {
  return analyzeTraditional(text).traditional
}

/**
 * 单行文本是否含繁体字(用于跳过无需转换的行:纯拉丁/简体行)。
 * @param text 单行文本
 */
export function hasTraditionalChar(text: string): boolean {
  for (const ch of text) if (T2S_MAP.has(ch)) return true
  return false
}

/**
 * 繁→简逐字查表转换;表外字符(含全部非汉字)原样保留。
 * @param text 单行文本
 */
export function toSimplified(text: string): string {
  let out = ''
  for (const ch of text) out += T2S_MAP.get(ch) ?? ch
  return out
}

/**
 * 批量转换歌词文本行:整段判定为繁体时逐行转换,否则原样返回 null(调用方沿用原文)。
 * 判定与转换都以整段为粒度,避免逐行独立判定造成副歌行疏密不一的误判。
 * @param texts 歌词行文本(主歌词/翻译/纯文本各自成批传入)
 * @returns 判定为繁体时返回与入参等长的简体行数组;非繁体或空数组返回 null
 */
export function convertTextsIfTraditional(texts: string[]): string[] | null {
  if (texts.length === 0) return null
  if (!isTraditionalChinese(texts.join('\n'))) return null
  return texts.map((t) => (hasTraditionalChar(t) ? toSimplified(t) : t))
}
