/*
 * 搜索命中：**切片段**（给模板渲染底色）+ **片段前移**（snippet）。
 *
 * ── 为什么需要两个函数 ────────────────────────────────────────────────
 * 行里的文字是单行 `text-overflow: ellipsis`（`.t`，一行大约只显示 40 个字），
 * 而它渲染的是 `previewText()` = **正文前 400 个字**。于是命中靠后时会出现
 * 「这行确实匹配了、屏幕上却一个高亮都看不见」—— 因为那段被省略号截掉了。
 * ⇒ `rowText()` 负责把命中挪到看得见的位置，`splitHighlight()` 负责把它标出来。
 * 两个一起才成立，少一个就是"功能只做了一半"。
 *
 * ── 一条必须守住的耦合 ────────────────────────────────────────────────
 * 这里的"算不算命中"用的是 **`toLowerCase().indexOf()`**，跟 `clipboard.ts` 的
 * `matchClip` 是**同一条语义**（`includes` 就是 `indexOf >= 0`）。
 * ⚠️ 两边必须一直一致：只要有一边动了大小写规则，就会出现
 *    「匹配上了却没有高亮」或者「高亮了却按规则不该匹配」。
 *
 * ── 为什么不用正则 ────────────────────────────────────────────────────
 * 关键词是用户随手打的，可能含 `.*`、`(`、`[` 这类正则元字符 —— 拼进 `RegExp`
 * 要么直接抛异常，要么静默匹配到别处。所以全程 `indexOf`，一个 `RegExp` 都不建。
 */

import { PREVIEW_SCAN, previewText, type ClipContent } from './clipboard.ts'

/** 一段文字：`hit` 为真表示它要被标底色 */
export interface Seg {
  t: string
  hit: boolean
}

/** 折叠空白 —— 跟 `previewText` 里那条一模一样（行里是单行显示，换行/多空格没意义） */
function collapse(s: string): string {
  return s.replace(/\s+/g, ' ').trim()
}

/** 小写化。⚠️ 少数 Unicode 字符小写之后**长度会变**，那种串上算出来的下标会整体错位 */
function lower(s: string): string | null {
  const l = s.toLowerCase()
  return l.length === s.length ? l : null
}

/*
 * 命中在开头这个位置之内，就认为"本来就看得到" ⇒ 一个字都不动。
 *
 * 为什么要有这个数：一行 14px 的字、窗口 800px 宽，去掉行尾那一格和内边距大约能显示
 * 40 来个中文字（英文更多）。取 24 是**保守**的 —— 宁可早一点前移，也别赌它刚好被截掉。
 * 这个数的意义是"**避免不必要的跳动**"：命中本来就在眼前时还去切窗口，会让人以为内容变了。
 */
const VISIBLE_HEAD = 24

/** 前移之后，命中前面留几个字当上下文（全砍掉会看不出这句话在说什么） */
const SNIPPET_LEAD = 8

/**
 * 把命中切成片段。
 *
 * - 大小写不敏感，但**切出来的永远是原文那一段**（不能把小写化那份显示出去）
 * - 一行里出现多次就全部切出来，不止第一个
 * - 没命中 / 没有关键词 ⇒ 原样一段（模板照样能渲染，不必分支）
 */
export function splitHighlight(text: string, keyword: string): Seg[] {
  if (!text) return []
  const kw = keyword.trim().toLowerCase()
  const hay = kw ? lower(text) : null
  if (!kw || !hay) return [{ t: text, hit: false }]

  const out: Seg[] = []
  let from = 0
  for (;;) {
    const i = hay.indexOf(kw, from)
    if (i < 0) break
    if (i > from) out.push({ t: text.slice(from, i), hit: false })
    out.push({ t: text.slice(i, i + kw.length), hit: true })
    from = i + kw.length
  }
  if (!out.length) return [{ t: text, hit: false }]
  if (from < text.length) out.push({ t: text.slice(from), hit: false })
  return out
}

/**
 * 行里该显示的那段文字 —— 命中靠后时把它挪到前面来。
 *
 * 三档处理，只有中间那档会改变显示内容：
 *   1. **没有关键词** ⇒ 原样返回 `previewText`（这套逻辑一个字都不参与，现状不变）
 *   2. **命中本来就看得到** ⇒ 原样返回，**不做任何前移**（避免"一搜索整列内容就跳"）
 *   3. **命中在看不见的地方** ⇒ 以命中为中心切一段，两端补 `…`
 *
 * ⚠️ 第 3 档里"看不见"有两种：命中在开头但被省略号截掉了（在前 400 字内、位置靠后），
 *    以及命中干脆在 400 字之后。前者在手上这份短串里就能切，**只有后者需要回头去看全文**
 *    —— 那一步会 `toLowerCase()` 整篇正文，所以放在最后、尽量别走到。
 */
export function rowText(item: ClipContent, keyword: string): string {
  const base = previewText(item)
  const kw = keyword.trim().toLowerCase()
  if (!kw) return base

  // 只对文本做前移：图片的 preview 是「[图片] 123KB」、文件是文件名，都短得不可能超出可见范围
  if (item.type !== 'text') return base

  const content = item.content ?? ''
  const flat = collapse(content.slice(0, PREVIEW_SCAN))
  const head = lower(flat)
  const at = head ? head.indexOf(kw) : -1

  if (at >= 0 && at <= VISIBLE_HEAD) return flat

  /*
   * 命中在开头那段里、只是位置靠后 —— 手上这份串就够切。
   * 尾巴还得回头看一眼正文：开头那段是**正文前 400 字**，正文比它长就说明后面还有东西。
   */
  if (at > VISIBLE_HEAD) return windowOf(flat, at, true, content.length > PREVIEW_SCAN)

  /*
   * 命中在 400 字之后。这里才真正需要看全文。
   * 找不到就直接认了（理论上不该发生：能进列表就说明 matchClip 认过它，
   * 而 matchClip 搜的正是 content）—— 宁可显示开头，也别显示个空。
   */
  const full = lower(content)
  const pos = full ? full.indexOf(kw) : -1
  if (pos < 0) return flat
  return windowOf(content, pos, false, false)
}

/**
 * 从 `at` 那一刻往前留一点上下文、往后切一段。
 *
 * `isFlat` 为真表示 `src`（开头那段）已经折叠过空白，就地切就行；为假表示 `src` 是
 * **正文**，必须**切完之后**再折叠 —— 先折叠会改变下标，`at` 就对不上了。
 *
 * `moreAfterSrc` 表示"`src` 后面还有正文"。尾巴那个省略号是两个条件的并：
 *   窗口没切到 `src` 的尽头，**或者** `src` 本身只是正文的前一截。
 * ⚠️ 少了后一半就会撒谎：正文 700 字、命中在第 50 字，窗口一直取到第 400 字收尾，
 *    单看 `src` 像是"到底了"，其实后面还有大半没显示。
 */
function windowOf(src: string, at: number, isFlat: boolean, moreAfterSrc: boolean): string {
  const start = Math.max(0, at - SNIPPET_LEAD)
  const raw = src.slice(start, start + PREVIEW_SCAN)
  const body = isFlat ? raw : collapse(raw)

  // 窗口取满 400 字才可能还有下文；没取满就说明已经到 `src` 尽头了
  const more = moreAfterSrc || start + raw.length < src.length
  return `${start > 0 ? '…' : ''}${body}${more ? '…' : ''}`
}
