/**
 * Markdown 扩展语法 ↔ 节点树的字符串层转换
 *
 * 背景：`==高亮==`、`^上标^`、`~下标~` 都不是 CommonMark/GFM 语法，
 * remark 不认，从文件读进来只是普通文本；而 Plate 的序列化器遇到自己不认识的
 * mark 会把标记丢掉，保存一次就永久降级。
 *
 * 这里不碰 remark，只在两边各做一次转换：
 *   读：文本 ==x== → 节点 { text:'x', highlight:true }
 *   写：先换成 Unicode 私用区占位符（避免序列化器转义），序列化后再换回真实标记
 *
 * 私用区字符 U+E000..U+E005 在 markdown 里不会出现，也不会被转义。
 */

import { KEYS } from 'platejs'

type AnyNode = {
  text?: string
  type?: string
  children?: AnyNode[]
  [k: string]: unknown
}

// 字段名必须和 Plate 插件的 key 一致，否则渲染器认不出这个 mark，只会当普通文本
const F_HL = String(KEYS.highlight)
const F_SUP = String(KEYS.sup)
const F_SUB = String(KEYS.sub)
const F_UL = String(KEYS.underline)

const PH: Record<string, [string, string]> = {
  [F_HL]: ['\uE000', '\uE001'],
  [F_SUP]: ['\uE002', '\uE003'],
  [F_SUB]: ['\uE004', '\uE005'],
  // 下划线在 markdown 里没有语法，Plate 序列化时会抛
  // "Cannot handle unknown node mdxJsxTextElement"，异常被吞掉后整篇笔记就再也不保存了。
  // 用占位符绕过，写成 <u>…</u>（HTML 是合法的 markdown 内联）。
  [F_UL]: ['\uE006', '\uE007'],
}

type MarkKey = string

/** 代码块里的内容原样保留，不能被当成 markdown 解析 */
const RAW_BLOCKS = new Set(['code_block', 'code_line'])

/**
 * `~` 顺序在删除线之后匹配：`~~x~~` 是删除线（GFM），只有单个 `~` 才是下标。
 * 用前后断言排掉紧邻的 `~`。
 */
/**
 * 为什么要在字符串层先换占位符，而不是直接拆节点：
 * GitHub 风味的删除线支持单个波浪线 `~x~`，remark-gfm 会把 `H~2~O` 里的 `~2~`
 * 直接解析成 strikethrough。等到节点树阶段再处理就晚了 —— 那时已经没有
 * 「这是下标还是删除线」的信息。所以必须抢在解析之前把它保护起来。
 */
/** <br/> 的占位符（不在 stripPlaceholders 的清理区间内） */
const PH_BR = '\uE009'
/** [TOC] 的占位符：remark 会把裸 [TOC] 当引用标签转义成 \[TOC\] */
const PH_TOC = '\uE00A'
/** [[双链]] 的左右界 */
const PH_WIKI_O = '\uE00B'
const PH_WIKI_C = '\uE00C'
/**
 * <img ...> 的占位符。
 * 必须抢在 remark 之前把它摘出来：@platejs/markdown 内置 remark-mdx，
 * 碰到不带自闭合斜杠的 HTML 标签会直接抛 "Expected a closing tag"，
 * 结果是整篇笔记打不开（不是丢格式，是打不开）。
 * U+E010/E011 在 placeholderToMd 的清理区间（E000..E007）之外，绕行也安全。
 */
const PH_IMG_O = '\uE010'
const PH_IMG_C = '\uE011'
const PH_IMG_RE = new RegExp(PH_IMG_O + '([^' + PH_IMG_C + ']*)' + PH_IMG_C, 'g')

type HtmlImgInfo = { url: string; alt: string; width?: number; widthPct?: string }

/** 从一段 <img ...> 里取 src / alt / width（width 支持 320 与 50% 两种写法） */
function parseImgTag(tag: string): HtmlImgInfo | null {
  const attr = (name: string): string => {
    const re = new RegExp('\\s' + name + '\\s*=\\s*(?:"([^"]*)"|\'([^\']*)\'|([^\\s>]+))', 'i')
    const m = re.exec(tag)
    if (!m) return ''
    if (m[1] !== undefined) return m[1]
    if (m[2] !== undefined) return m[2]
    return m[3] || ''
  }
  const url = attr('src').trim()
  if (!url) return null
  const out: HtmlImgInfo = { url: url, alt: attr('alt') }
  const w = attr('width').trim()
  if (/^\d+(\.\d+)?$/.test(w)) out.width = Math.round(Number(w))
  else if (/^\d+(\.\d+)?%$/.test(w)) out.widthPct = w
  return out
}
const PH_RULES: Array<{ re: RegExp; field: MarkKey }> = [
  {
    re: new RegExp(PH[F_HL][0] + '([^' + PH[F_HL][1] + ']*)' + PH[F_HL][1], 'g'),
    field: F_HL,
  },
  {
    re: new RegExp(PH[F_SUP][0] + '([^' + PH[F_SUP][1] + ']*)' + PH[F_SUP][1], 'g'),
    field: F_SUP,
  },
  {
    re: new RegExp(PH[F_SUB][0] + '([^' + PH[F_SUB][1] + ']*)' + PH[F_SUB][1], 'g'),
    field: F_SUB,
  },
  {
    re: new RegExp(PH[F_UL][0] + '([^' + PH[F_UL][1] + ']*)' + PH[F_UL][1], 'g'),
    field: F_UL,
  },
]

/** 把一个 leaf 按规则切成若干带 mark 的 leaf */
function splitLeaf(leaf: AnyNode): AnyNode[] {
  let parts: AnyNode[] = [{ ...leaf }]

  for (const { re, field } of PH_RULES) {
    const next: AnyNode[] = []
    for (const p of parts) {
      const txt = typeof p.text === 'string' ? p.text : ''
      if (!txt || p[field]) {
        next.push(p)
        continue
      }
      re.lastIndex = 0
      let last = 0
      let m: RegExpExecArray | null
      let hit = false
      while ((m = re.exec(txt))) {
        hit = true
        if (m.index > last) next.push({ ...p, text: txt.slice(last, m.index) })
        next.push({ ...p, text: m[1], [field]: true })
        last = m.index + m[0].length
      }
      if (!hit) {
        next.push(p)
      } else if (last < txt.length) {
        next.push({ ...p, text: txt.slice(last) })
      }
    }
    parts = next
  }

  return parts.filter((p) => typeof p.text === 'string' && p.text.length > 0)
}

function walkIn(node: AnyNode): AnyNode[] {
  if (typeof node.text === 'string') return splitLeaf(node)
  if (node.type && RAW_BLOCKS.has(node.type)) return [node]
  if (Array.isArray(node.children)) {
    const out: AnyNode[] = []
    for (const c of node.children) {
      for (const n of walkIn(c)) out.push(n)
    }
    return [{ ...node, children: out }]
  }
  return [node]
}

/**
 * 反序列化之前调用：先把扩展语法换成占位符，避免被 remark-gfm 抢先解释
 * （`~x~` 会被当成删除线）。代码块和行内代码里的内容原样跳过。
 */
export function preDeserialize(md: string): string {
  if (!md) return md
  // 按代码块 / 行内代码切分，偶数段是普通文本
  // 保护范围：围栏代码（``` 与 ~~~）、行内代码（含多反引号）、块级公式、行内公式。
  // 之前只挡了 ``` 和单反引号，导致 $x^2$ 里的 ^ 被当成上标吃掉，
  // 公式 tex 被破坏成 x2。
  const segs = String(md).split(
    /(```[\s\S]*?```|~~~[\s\S]*?~~~|\$\$[\s\S]*?\$\$|`+[^`]*`+|\$[^$\n]+\$)/g,
  )
  return segs
    .map((seg, i) => {
      if (i % 2 === 1) return seg
      // 内联 HTML 白名单：转成等价的 markdown / 已有 mark，否则 remark 会把它当纯文本
      // 打印出来，读起来就是一串尖括号。放在扩展语法替换之前，因为 sup/sub 会生成
      // ^ / ~，后面还要再走一次占位符保护。
      // 先把 <img ...> 摘成占位符（见 PH_IMG_O 的说明），后面才轮到内联 HTML 白名单
      let out = seg
        .replace(/<img\b[^>]*>/gi, (m) => PH_IMG_O + encodeURIComponent(m) + PH_IMG_C)
        .replace(/<kbd>([^<]*)<\/kbd>/gi, (_m, x) => '`' + x + '`')
        .replace(/<sup>([^<]*)<\/sup>/gi, (_m, x) => '^' + x + '^')
        .replace(/<sub>([^<]*)<\/sub>/gi, (_m, x) => '~' + x + '~')
        .replace(/<abbr[^>]*>([^<]*)<\/abbr>/gi, '$1')
        .replace(/<mark>([^<]*)<\/mark>/gi, (_m, x) => '==' + x + '==')
        .replace(/<u>([^<]*)<\/u>/gi, (_m, x) => PH[F_UL][0] + x + PH[F_UL][1])
        // @platejs/markdown 内置 remark-mdx，任何 HTML 标签都会被解析成 mdxJsxTextElement，
        // 而序列化器不认识这个节点 → 整篇笔记保存失败。
        // 所以进 remark 之前，把所有内联 HTML 都换成普通字符或占位符。
        // <br/> 换成占位符而不是换行：换成换行会被 markdown 当段落分隔吃掉，
        // 用户笔记里靠 <br/> 撑出来的空行就没了。占位符原样往返，序列化时还原。
        .replace(/<br\s*\/?>/gi, PH_BR)
        // [TOC] 和 [[双链]] 不是标准 markdown，remark 会把方括号转义成 \[TOC\]，
        // 保存一次源文件就被污染。进 remark 前换成占位符，出来后原样还原。
        .replace(/\[TOC\]/gi, PH_TOC)
        .replace(/\[\[([^\[\]\n]+)\]\]/g, (_m, x) => PH_WIKI_O + x + PH_WIKI_C)
        .replace(/<mark>([^<]*)<\/mark>/gi, (_m, x) => PH[F_HL][0] + x + PH[F_HL][1])
        .replace(/<sup>([^<]*)<\/sup>/gi, (_m, x) => PH[F_SUP][0] + x + PH[F_SUP][1])
        .replace(/<sub>([^<]*)<\/sub>/gi, (_m, x) => PH[F_SUB][0] + x + PH[F_SUB][1])
        // kbd / small / ins / del 这些没有对应 mark，剥掉标签保留内容
        .replace(/<\/?(kbd|small|big|ins|del|font|span)(\s[^>]*)?>/gi, '')

      return out
        .replace(/==([^=\n]+?)==/g, (_m, x) => PH[F_HL][0] + x + PH[F_HL][1])
        .replace(/\^([^^\n]+?)\^/g, (_m, x) => PH[F_SUP][0] + x + PH[F_SUP][1])
        .replace(/(?<!~)~([^~\n]+?)~(?!~)/g, (_m, x) => PH[F_SUB][0] + x + PH[F_SUB][1])
    })
    .join('')
}

/**
 * 兜底：把没被规则吃掉的占位符字符从正文里清掉。
 * 占位符是 U+E000..U+E007 的私用区字符，在编辑器里会显示成方块，
 * 漏一个用户就会看到「两个口把文字包起来」。宁可丢掉标记，也不能显示乱码。
 */
function stripPlaceholders(node: AnyNode): AnyNode {
  if (typeof node.text === 'string') {
    const cleaned = node.text.replace(/[\uE000-\uE007]/g, '')
    return cleaned === node.text ? node : { ...node, text: cleaned }
  }
  if (Array.isArray(node.children)) {
    return { ...node, children: node.children.map(stripPlaceholders) }
  }
  return node
}

/**
 * 兜底：把 remark-mdx 残留的 mdxJsx* 节点整棵展开成普通节点。
 * 正常走不到（preDeserialize 已把 HTML 清干净），但只要漏一种写法，
 * 序列化器就会抛 "Cannot handle unknown node mdxJsxTextElement" 让整篇笔记存不了。
 * 这里宁可丢格式，也不能让保存整个失败。
 */
function flattenMdx(nodes: AnyNode[]): AnyNode[] {
  const out: AnyNode[] = []
  for (const n of nodes) {
    if (!n || typeof n !== 'object') continue
    if (String(n.type || '').startsWith('mdx')) {
      const name = String(n.name || '').toLowerCase()
      if (name === 'br') out.push({ text: '\n' })
      else if (Array.isArray(n.children)) out.push(...flattenMdx(n.children))
      continue
    }
    if (Array.isArray(n.children)) out.push({ ...n, children: flattenMdx(n.children) })
    else out.push(n)
  }
  return out
}

/** 反序列化后把语法占位符还原成可见文本，编辑器里要看到 [TOC] / [[名字]] 本身 */
function restoreSyntaxText(n: AnyNode): AnyNode {
  if (typeof n.text === 'string') {
    if (!n.text.includes(PH_TOC) && !n.text.includes(PH_WIKI_O)) return n
    const t = n.text.split(PH_TOC).join('[TOC]').split(PH_WIKI_O).join('[[').split(PH_WIKI_C).join(']]')
    return { ...n, text: t }
  }
  if (Array.isArray(n.children)) return { ...n, children: n.children.map(restoreSyntaxText) }
  return n
}

/** 序列化前把可见的 [TOC] / [[名字]] 换回占位符，避免被 remark 转义 */
function protectSyntaxText(n: AnyNode): AnyNode {
  if (typeof n.text === 'string') {
    if (!/\[TOC\]|\[\[/i.test(n.text)) return n
    const t = n.text
      .replace(/\[TOC\]/gi, PH_TOC)
      .replace(/\[\[([^\[\]\n]+)\]\]/g, (_m, x) => PH_WIKI_O + x + PH_WIKI_C)
    return { ...n, text: t }
  }
  if (Array.isArray(n.children)) return { ...n, children: n.children.map(protectSyntaxText) }
  return n
}

/** 两个 leaf 的 mark 集合是否完全一致（text 之外的字段） */
function sameMarks(a: AnyNode, b: AnyNode): boolean {
  const keysA = Object.keys(a).filter((k) => k !== 'text').sort()
  const keysB = Object.keys(b).filter((k) => k !== 'text').sort()
  if (keysA.join(',') !== keysB.join(',')) return false
  for (const k of keysA) {
    if (k === 'children') continue
    if (a[k] !== b[k]) return false
  }
  return true
}

/**
 * 收尾整理：
 *   1) 合并相邻且 mark 完全相同的 leaf —— 叠加占位符拆出来的碎片会在这里合回去
 *   2) 丢掉空的纯文本叶子（嵌套占位符闭合失败时会留下 text:'' 的残片），
 *      但如果整段都空了要补一个，Slate 不允许 element 的 children 为空
 */
function mergeLeaves(leaves: AnyNode[]): AnyNode[] {
  const out: AnyNode[] = []
  for (const l of leaves) {
    // 防御：element（有 children 没 text）绝不能参与合并
    if (typeof l.text !== 'string') {
      out.push(l)
      continue
    }
    const txt = l.text
    if (txt === '' && Object.keys(l).every((k) => k === 'text')) continue
    const prev = out[out.length - 1]
    if (prev && sameMarks(prev, l)) {
      // 真要合并才新建，避免无谓地换掉对象身份
      out[out.length - 1] = { ...prev, text: String(prev.text || '') + txt }
      continue
    }
    out.push(l)
  }
  if (!out.length) return [{ text: '' }]
  return out
}

/** 反序列化之后调用：把占位符文本拆成带 mark 的 leaf */
export function postDeserialize<T>(nodes: T[]): T[] {
  if (!Array.isArray(nodes)) return nodes
  const out: AnyNode[] = []
  for (const n of nodes as unknown as AnyNode[]) {
    for (const x of walkIn(n)) out.push(x)
  }
  const cleaned = flattenMdx(out).map(stripPlaceholders)
  // 每个容器的 children 做一次合并/去空
  const tidy = (n: AnyNode): AnyNode => {
    if (typeof n.text === 'string') return n
    if (!Array.isArray(n.children)) return n
    const kids = n.children.map(tidy)
    // 只对「纯文本 children」做合并。element children（code_line、table 的行等）
    // 一旦被 mergeLeaves 当成同 mark 的叶子合并，整块内容会被压成一行。
    const allText = kids.length > 0 && kids.every((k) => typeof k.text === 'string')
    const merged = allText ? mergeLeaves(kids) : kids
    // 一个都没变就返回原对象：Plate 用节点对象当 WeakMap key 缓存语法 token，
    // 无谓地换对象会让代码高亮整个失效
    if (merged.length === kids.length && merged.every((x, i) => x === kids[i])) return n
    return { ...n, children: merged }
  }
  const base = cleaned.map(tidy).map(restoreSyntaxText)
  // 最后一步：把 <img ...> 占位符还原成真正的图片节点（否则编辑器里会显示一串乱码）
  return restoreHtmlImgs(base) as unknown as T[]
}

function markLeafToPlaceholder(leaf: AnyNode): AnyNode {
  const rawText = typeof leaf.text === 'string' ? leaf.text : ''
  // Plate 用 U+200B（零宽空格）撑开空段落，直接序列化会把零宽字符写进文件。
  // 视为空文本处理：剥掉 mark，并把 text 清成空串。
  const txt0 = rawText.replace(/\u200b/g, '')
  if (!txt0) {
    // 空文本叶子（回车新建的段落会继承前一段的 mark）也必须剥掉 mark。
    // 不剥的话序列化器会用 mdx 的 <mark> 来表示它，直接抛
    // "Cannot handle unknown node mdxJsxTextElement"，整篇笔记就存不了。
    // 空段落本来就没有内容，mark 不需要保留，也就无需生成占位符。
    const bare = { ...leaf }
    for (const key of Object.keys(PH) as MarkKey[]) {
      if (bare[key]) delete bare[key]
    }
    bare.text = ''
    return bare
  }
  let txt = txt0
  const keep = { ...leaf }
  let dirty = false

  for (const key of Object.keys(PH) as MarkKey[]) {
    if (!leaf[key]) continue
    const [open, close] = PH[key]
    txt = open + txt + close
    delete keep[key]
    dirty = true
  }

  if (!dirty) return leaf
  keep.text = txt
  return keep
}

function walkOut(node: AnyNode): AnyNode {
  if (typeof node.text === 'string') return markLeafToPlaceholder(node)
  // 必须返回新对象：传进来的是 Plate 的 live 文档（editor.children），
  // 就地改会让编辑器里的高亮/上下标真的变成占位符字符，界面上显示豆腐块。
  if (Array.isArray(node.children)) {
    return { ...node, children: node.children.map(walkOut) }
  }
  return node
}

/** 序列化之前调用：把 mark 换成私用区占位符，序列化器不会动它们 */
export function protectSyntax<T>(nodes: T[]): T[] {
  return (nodes as unknown as AnyNode[]).map((n) => protectSyntaxText(n)) as unknown as T[]
}

export function markToPlaceholder<T>(nodes: T[]): T[] {
  if (!Array.isArray(nodes)) return nodes
  return (nodes as unknown as AnyNode[]).map(walkOut) as unknown as T[]
}

/** 序列化之后调用：把占位符换回真正的 markdown 标记 */
export function placeholderToMd(md: string): string {
  if (!md) return md
  let out = md
  for (const key of Object.keys(PH) as MarkKey[]) {
    const [open, close] = PH[key]
    const re = new RegExp(open + '([^' + close + ']*)' + close, 'g')
    if (key === F_UL) {
      out = out.replace(re, (_m, inner) => '<u>' + inner + '</u>')
      continue
    }
    const left = key === F_HL ? '==' : key === F_SUP ? '^' : '~'
    const right = left
    out = out.replace(re, (_m, inner) => left + inner + right)
  }
  // 兜底：万一有落单的占位符，直接清掉，不留在正文里
  // <br/> 占位符还原成 HTML（Obsidian / GitHub 都认）
  out = out.split(PH_BR).join('<br/>')
  out = out.split(PH_TOC).join('[TOC]')
  out = out.split(PH_WIKI_O).join('[[').split(PH_WIKI_C).join(']]')

  // 兜底：整行只有零宽字符时清成空行
  out = out.split('\n').map((l) => (/^[\u200b\s]*\u200b[\u200b\s]*$/.test(l) ? '' : l)).join('\n')

  // remark-stringify 会把行内代码后面的空格转义成 &#x20;（它担心空格连着反引号被误解析），
  // 但行内代码后跟空格本来就是安全的，还原成普通空格，别污染源文件
  out = out.replace(/&#x20;/g, ' ')

  return out.replace(/[\uE000-\uE007]/g, '')
}

/**
 * 把 preDeserialize 摘出来的 <img ...> 占位符还原成图片节点。
 *
 * 为什么不在 deserialize 阶段交给 @platejs/markdown 的 rules：
 * remark-mdx 会把 HTML 解析成 mdxJsxFlowElement，而 Plate 的序列化器不认这个节点，
 * 保存时会整篇失败；而且不带自闭合斜杠的 <img> 在解析阶段就直接抛错。
 * 所以先在字符串层摘掉，节点树成型后再补回来。
 *
 * 图片节点的形状要和 Plate 默认 img 规则产出一致（type=img、caption 存 alt、
 * children 里放一个空 text），否则渲染器和后续序列化都认不出它。
 */
function restoreHtmlImgs(nodes: AnyNode[]): AnyNode[] {
  if (!Array.isArray(nodes)) return nodes

  const toImgNode = (enc: string): AnyNode | null => {
    let tag = ''
    try {
      tag = decodeURIComponent(enc)
    } catch (e) {
      return null
    }
    const info = parseImgTag(tag)
    if (!info) return null
    const node: AnyNode = {
      type: String(KEYS.img),
      url: info.url,
      caption: [{ text: info.alt || '' }],
      children: [{ text: '' }],
    }
    if (info.width) node.width = info.width
    if (info.widthPct) node.widthPct = info.widthPct
    return node
  }

  const splitText = (leaf: AnyNode): AnyNode[] => {
    const txt = typeof leaf.text === 'string' ? leaf.text : ''
    if (!txt || txt.indexOf(PH_IMG_O) < 0) return [leaf]
    const out: AnyNode[] = []
    PH_IMG_RE.lastIndex = 0
    let last = 0
    let m: RegExpExecArray | null
    while ((m = PH_IMG_RE.exec(txt))) {
      if (m.index > last) out.push({ ...leaf, text: txt.slice(last, m.index) })
      const img = toImgNode(m[1])
      // 解析失败就保留原文，宁可显示难看的标签，也不能把内容吃掉
      out.push(img || { ...leaf, text: m[0] })
      last = m.index + m[0].length
    }
    if (last < txt.length) out.push({ ...leaf, text: txt.slice(last) })
    return out.filter((x) => !(typeof x.text === 'string' && x.text === ''))
  }

  const walk = (n: AnyNode): AnyNode[] => {
    if (typeof n.text === 'string') return splitText(n)
    if (!Array.isArray(n.children)) return [n]
    const kids: AnyNode[] = []
    for (const c of n.children) kids.push(...walk(c))
    return [{ ...n, children: kids }]
  }

  const out: AnyNode[] = []
  for (const n of nodes) {
    for (const x of walk(n)) {
      // 整个段落只有一张图 → 直接把段落换成图片节点，别留一个空段落
      if (x.type === String(KEYS.p) && Array.isArray(x.children)) {
        const real = x.children.filter((c) => !(typeof c.text === 'string' && !c.text.trim()))
        if (real.length === 1 && real[0] && real[0].type === String(KEYS.img)) {
          out.push(real[0])
          continue
        }
      }
      out.push(x)
    }
  }
  return out
}
