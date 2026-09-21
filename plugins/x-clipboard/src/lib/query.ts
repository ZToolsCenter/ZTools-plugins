/*
 * 搜索框里的类型前缀。
 *
 * 宿主那个搜索框里可以带一个分类前缀，写法是「分类名 + 冒号 + 关键词」，全用汉字：
 *   文本:剪贴板     只在文本里搜
 *   图像:截图       只在图像里搜
 *   文件:报告       只在文件里搜
 *   全部:           不过滤（等于不带前缀）
 *   收藏:笔记       只在收藏里搜
 *
 * 五个分类**平级**，Tab / ⇧Tab 依次循环。收藏也是一个分类 ——
 * 它不是"另开一个视图"，而是这支循环里的第五站，这样搜索框里永远看得见自己在哪。
 *
 * 切分类做的事就是把前缀替你写进搜索框。**前缀是分类的唯一真相** ——
 * 所以「当前在哪个分类」永远看得见，而且「切分类」和「在分类里搜东西」
 * 用的是同一套语法，只记一次。
 *
 * 容错：中文输入法打出的全角「：」也认；分类名后面跟空格（`文本 报告`）也认。
 * 刻意不用字母前缀（t:/i:/f:）—— 既省得跟英文内容打架，也省得记两套写法。
 *
 * 抽成独立模块是为了能脱离浏览器直接单测。
 */

import type { ClipType } from './clipboard'

/**
 * 分类。前三个是宿主真有的内容类型；后两个是插件自己的两个视图 ——
 * 「全部」不过滤，「收藏」看的是插件自己存的那份。
 *
 * 五个**平级**：它们共用同一个搜索框前缀，Tab 一视同仁地循环。
 * 收藏能进循环，靠的就是它也是个前缀、而不是一个游离在外的开关。
 */
export type Cat = ClipType | 'all' | 'favorites'

/** 分类名 → 分类。'all' 是「不要过滤」的显式写法；「图片」当「图像」的别名收下 */
export const TYPE_WORDS: Record<string, Cat> = {
  文本: 'text',
  图像: 'image',
  图片: 'image',
  文件: 'file',
  全部: 'all',
  收藏: 'favorites'
}

/** 类型 → 中文名，给空状态文案用 */
export const TYPE_LABEL: Record<ClipType, string> = {
  text: '文本',
  image: '图像',
  file: '文件'
}

/**
 * 这条内容是不是一个「纯网址」。
 *
 * 只认带 http(s):// 或 www. 开头的整条内容 —— **故意不认裸域名**。
 * 看起来"example.com 也是网址"，但真放开就会误伤一片文件名：
 * `readme.md`、`index.js`、`photo.png` 全都是"点 + 两三个字母"，判成链接就闹笑话了。
 * 想再收窄（比如认成网盘分享串）可以，想放宽到裸域名不行。
 *
 * 另外要求整条**不含空白** —— 后面跟一句话的（`看这个 https://…`）就不是"纯"网址，
 * 那还是一段文本，标签该老老实实写「文本」。
 */
const BARE_URL = /^(?:https?:\/\/|www\.)\S+$/i

/*
 * 先过前缀那道闸。
 *
 * 上面那个正则以 `\S+$` 收尾，一旦开头命中就要**扫到串尾**才算数；
 * 而剪贴板里绝大多数是普通文字，`labelOf` 又要对每条内容都问一遍 ——
 * 先用一个只看开头的正则把它们挡掉，长正文就不会被整串扫。
 */
const URL_START = /^(?:https?:\/\/|www\.)/i

export function isBareUrl(text: unknown): boolean {
  if (typeof text !== 'string') return false
  const s = text.trim()
  return URL_START.test(s) && BARE_URL.test(s)
}

/**
 * 行尾那个类型标签该显示什么。
 *
 * 纯网址的文本行显示成「链接」—— 它确实还是 `type: 'text'`，
 * 只是在列表里一眼看出"这条点开是往浏览器去的"，信息量比「文本」大。
 * **只是显示**：Tab 过滤、收藏全都还是按 `type` 走，不受这个影响。
 */
export function labelOf(item: { type: ClipType; content?: string }): string {
  if (item.type === 'text' && isBareUrl(item.content)) return '链接'
  return TYPE_LABEL[item.type]
}

/** 类型 → 写进搜索框的前缀。切分类用它 */
export const TYPE_PREFIX: Record<ClipType, string> = {
  text: '文本:',
  image: '图像:',
  file: '文件:'
}

/** 分类 → 前缀。比 TYPE_PREFIX 多出「全部」「收藏」两个非类型分类 */
export const CAT_PREFIX: Record<Cat, string> = {
  all: '全部:',
  ...TYPE_PREFIX,
  favorites: '收藏:'
}

/** 当前分类对应的前缀。null（全部）也写成 `全部:` —— 全部也是一个分类，也要看得见 */
export function prefixOf(cat: Cat | null): string {
  return CAT_PREFIX[cat ?? 'all']
}

/**
 * Tab 循环的五站，顺序就是显示顺序：全部 → 文本 → 图像 → 文件 → 收藏。
 * 「收藏」排在最后，是**故意**的：日常九成时间在四个历史分类里转，
 * 多看两眼的那一站放最后，顺手 Tab 一下就回到「全部」。
 */
export const TYPE_CYCLE: string[] = ['全部:', '文本:', '图像:', '文件:', '收藏:']

/** 是不是宿主那三个真类型。不是（全部 / 收藏）就不用按 type 过滤 */
function isClipType(cat: Cat): cat is ClipType {
  return cat === 'text' || cat === 'image' || cat === 'file'
}

/** 冒号形式（中英文冒号都收）/ 空格形式。两个都只认分类名这一组词 */
const COLON_FORM = /^(文本|图像|图片|文件|全部|收藏)\s*[:：]\s*/
const SPACE_FORM = /^(文本|图像|图片|文件|全部|收藏)\s+/

/**
 * 从搜索框原文里认出分类前缀，顺带切出剩下的关键词。
 *
 * 下面三个入口（`parseQuery` / `catOf` / `cycleCat`）全走这里，一次就够。
 * 原来它们各跑一遍那两个正则 —— 每敲一个字，「在哪个分类」被算了两遍、
 * 「关键词是什么」又被算一遍，纯粹是同一件事问三次。
 * 收成一处还有个好处：「认哪几个词算分类前缀」只有一份定义，改不用改三边。
 */
function splitQuery(raw: string): { cat: Cat | null; body: string } {
  const s = raw.replace(/^\s+/, '')
  const m = COLON_FORM.exec(s) ?? SPACE_FORM.exec(s)
  const cat = m ? TYPE_WORDS[m[1]] : undefined
  if (!m || !cat) return { cat: null, body: s }
  return { cat, body: s.slice(m[0].length) }
}

export interface ParsedQuery {
  /** null = 不过滤类型（「全部:」「收藏:」以及不带前缀，都落在这里） */
  type: ClipType | null
  /** 去掉前缀之后剩下的关键词 */
  text: string
}

/** 把搜索框里的原文拆成「类型 + 关键词」 */
export function parseQuery(raw: string): ParsedQuery {
  const { cat, body } = splitQuery(raw)
  return { type: cat && isClipType(cat) ? cat : null, text: body }
}

/**
 * Backspace 的语义：**退一格，永不删数据**（09-17 改）。
 *
 * 以前 Backspace 和 Delete 一样是「删除当前项」。删除能一键免确认之后，
 * 「想删搜索词里的一个字、结果把整条剪贴记录删掉」就成了一次真实的丢数据 ——
 * 宿主那边是**硬删**，图像还会连磁盘文件一起 unlink，没有撤销。
 * 于是退格键只干退格的事，删数据只剩 `Delete` 和 `⌘⌫`（见 lib/keys.ts）：
 *
 *   · 有关键词 → 退掉最后一个字符，分类前缀原样带着（`文本:abc` → `文本:ab`）
 *   · 只剩分类前缀（或只剩空白）→ 把这一层整个退掉，回到空的「全部」（`文本:` → ``）
 *   · 本来就是空框 → 没有可退的
 *
 * 返回「退完搜索框里该是什么」；返回 `null` 表示**这一键什么都不做**。
 */
export function backspaceQuery(raw: string): string | null {
  if (!raw) return null
  /*
   * 有关键词就只退关键词的最后一格 —— `body` 永远是 `raw` 的后缀
   * （`splitQuery` 只从头上切前缀），所以直接 `slice(0, -1)` 不会误伤前缀。
   * 没关键词时剩下的只可能是前缀或空白，整层清掉，不会退成 `文本` 这种半截前缀。
   */
  return splitQuery(raw).body ? raw.slice(0, -1) : ''
}

/*
 * ⚠️ 这里曾经有过一个 `isScopeReset(raw)`（`parseQuery(raw).text === ''`），
 * 用来判"改完搜索框之后范围是不是回到了全量"，好决定当前行要不要落回第一条。
 *
 * **09-17 第二轮已删除**，别再写回来：老大看过真机之后把口径收紧了 ——
 * 「删到一半时，列表根据搜索框剩下的内容重新渲染了，为什么这时候 ↑↓ 没有重新从第一行开始」。
 * 也就是说**只要搜索框内容变了（不分变多变少、也不分是不是退成空），列表就是一张新列表，
 * 当前行一律落回第一条**。既然无条件，就不需要判据了。
 * 实现和理由都在 `App.vue` 的 `commitTypedQuery()` 上。
 */

/**
 * 现在站在哪个分类上。判「是不是收藏视图」、切分类都用它。
 *
 * 为什么不复用 parseQuery 的 `type`：`type` 只管「按哪种内容过滤」，
 * 答不出「在全部还是在收藏」—— 这两处都是 `null`。分类是比类型更靠上一层的东西。
 */
export function catOf(raw: string): Cat {
  return splitQuery(raw).cat ?? 'all'
}

/**
 * Tab / ⇧Tab：在五站里循环，返回**新的搜索框内容**。
 * 只换前缀，后缀关键词原样带走 —— 所以在文本里搜了「报告」，Tab 到图像还是搜「报告」。
 */
export function cycleCat(raw: string, delta: number): string {
  const n = TYPE_CYCLE.length
  const { cat, body } = splitQuery(raw)
  const i = TYPE_CYCLE.indexOf(CAT_PREFIX[cat ?? 'all'])
  return TYPE_CYCLE[(((i + delta) % n) + n) % n] + body
}
