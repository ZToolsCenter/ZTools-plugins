/**
 * 行内格式层：Markdown 文本 ↔ Slate leaf
 *
 * 用 marked 做解析 —— 和 V1.0.0 用的是同一个解析器（其 bundle 里就是 marked），
 * 所以嵌套强调、转义这类边界行为天然一致，不用自己写正则去追 CommonMark 规范。
 *
 * 块级切分仍由 ndb.js 的 mdToNodes 负责（它输出 { text: 原始文本 }），
 * 这里只把每个块里的文本拆成带格式标记的 leaves，反向再拼回去。
 */
import { marked } from 'marked'
import type { CMarkElement, LeafFormat } from './slate-model'

type MdToken = {
  type: string
  text?: string
  raw?: string
  href?: string
  title?: string
  tokens?: MdToken[]
  items?: MdToken[]
  checked?: boolean
}

const MARKS = ['bold', 'italic', 'code', 'strike', 'highlight', 'underline', 'link'] as const
type Mark = Record<string, unknown>

function merge(base: Mark, extra: Mark): Mark {
  const out: Mark = { ...base }
  for (const k of MARKS) {
    if (extra[k] !== undefined) out[k] = extra[k]
  }
  return out
}

function walkTokens(tokens: MdToken[], marks: Mark): LeafFormat[] {
  const out: LeafFormat[] = []
  for (const t of tokens) {
    switch (t.type) {
      case 'text': {
        // text token 内部还可能带 tokens（marked 对 "a **b** c" 会拆成 text + strong + text）
        if (t.tokens && t.tokens.length) {
          out.push(...walkTokens(t.tokens, marks))
        } else if (t.text) {
          out.push({ text: decodeEntities(t.text), ...marks } as LeafFormat)
        }
        break
      }
      case 'escape':
        if (t.text) out.push({ text: decodeEntities(t.text), ...marks } as LeafFormat)
        break
      case 'strong':
        out.push(...walkTokens(t.tokens || [], merge(marks, { bold: true })))
        break
      case 'em':
        out.push(...walkTokens(t.tokens || [], merge(marks, { italic: true })))
        break
      case 'del':
        out.push(...walkTokens(t.tokens || [], merge(marks, { strike: true })))
        break
      case 'codespan':
        out.push({ text: decodeEntities(t.text || ''), ...merge(marks, { code: true }) } as LeafFormat)
        break
      case 'link': {
        // marked 的 GFM autolink 会把裸邮箱/裸网址包成 <a>，raw 不以 [ 开头。
        // 这类必须保留原文，否则 support@x.com 会被写成 [support@x.com](mailto:support@x.com)。
        const raw = (t.raw || '').trimStart()
        if (!raw.startsWith('[')) {
          if (t.raw) out.push({ text: t.raw, ...marks } as LeafFormat)
          break
        }
        out.push(...walkTokens(t.tokens || [], merge(marks, { link: t.href || '' })))
        break
      }
      case 'image': {
        // 保留原始 Markdown，交给 ndb.js 原样写回；不能降级成 alt，否则图片引用会丢
        const raw = t.raw || (t.text != null && t.href ? `![${t.text}](${t.href})` : '')
        if (raw) out.push({ text: raw, ...marks } as LeafFormat)
        break
      }
      case 'br':
        out.push({ text: '\n', ...marks } as LeafFormat)
        break
      default:
        if (t.raw) out.push({ text: decodeEntities(t.raw), ...marks } as LeafFormat)
    }
  }
  return out
}

function decodeEntities(s: string): string {
  return String(s)
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
}

/**
 * 一段行内 Markdown 文本 → leaves
 * 高亮 ==x== marked 不认，解析前先抽成占位符，解析后补回 highlight 标记
 */
export function inflateLeaves(raw: string): LeafFormat[] {
  const text = String(raw ?? '')
  if (!text) return [{ text: '' }]

  const highlights: string[] = []
  const stashed = text.replace(/==([^=\n]+)==/g, (_m, body: string) => {
    highlights.push(body)
    return `\u0000HL${highlights.length - 1}\u0000`
  })

  let leaves: LeafFormat[] = []
  try {
    const blockTokens = marked.lexer(stashed) as unknown as MdToken[]
    const inlineTokens =
      (blockTokens[0] && (blockTokens[0].tokens as MdToken[] | undefined)) || [{ type: 'text', text: stashed }]
    leaves = walkTokens(inlineTokens, {})
  } catch (e) {
    leaves = [{ text: stashed }]
  }

  // 还原高亮占位
  const restored: LeafFormat[] = []
  for (const leaf of leaves) {
    if (!leaf.text.includes('\u0000HL')) {
      restored.push(leaf)
      continue
    }
    const parts = leaf.text.split(/\u0000HL(\d+)\u0000/)
    for (let i = 0; i < parts.length; i++) {
      const chunk = parts[i]
      if (chunk === '' || chunk == null) continue
      if (i % 2 === 1) {
        const body = highlights[Number(chunk)] ?? ''
        restored.push({ ...leaf, text: body, highlight: true } as LeafFormat)
      } else {
        restored.push({ ...leaf, text: chunk } as LeafFormat)
      }
    }
  }

  // 合并相邻同样式的 leaf，减少碎片
  const merged: LeafFormat[] = []
  for (const leaf of restored) {
    const prev = merged[merged.length - 1]
    if (prev && sameMarks(prev, leaf)) prev.text += leaf.text
    else merged.push({ ...leaf })
  }
  return merged.length ? merged : [{ text: '' }]
}

function sameMarks(a: LeafFormat, b: LeafFormat): boolean {
  for (const k of MARKS) {
    if ((a as Record<string, unknown>)[k] !== (b as Record<string, unknown>)[k]) return false
  }
  return true
}

/**
 * leaves → 行内 Markdown 文本
 *
 * 关键点：不能逐个 leaf 单独包裹。`**a**` 后面紧跟 `*b*` 会拼成 `**a***b*`，
 * 再解析时星号边界就模糊了（实测 **加粗里的 *斜体*** 会滚成 *****）。
 * 正确做法是按「外层标记分组、组内再按内层标记细分」，让 *斜体* 落在 **加粗** 里面。
 */
export function deflateLeaves(leaves: LeafFormat[]): string {
  const list = leaves || []
  const out: string[] = []
  let i = 0

  while (i < list.length) {
    const l = list[i]
    if (!l.text) {
      i++
      continue
    }
    if (l.code) {
      out.push('`' + l.text + '`')
      i++
      continue
    }
    if (l.bold) {
      const group: LeafFormat[] = []
      while (i < list.length && list[i].bold && !list[i].code) {
        group.push(list[i])
        i++
      }
      out.push('**' + innerMarks(group) + '**')
      continue
    }
    if (l.italic) {
      const group: LeafFormat[] = []
      while (i < list.length && list[i].italic && !list[i].bold && !list[i].code) {
        group.push(list[i])
        i++
      }
      // 同样要把 strike / highlight / underline / link 一起包上
      out.push('*' + innerMarks(group.map((g) => ({ ...g, italic: false }))) + '*')
      continue
    }
    let t = l.text
    if (l.strike) t = '~~' + t + '~~'
    if (l.highlight) t = '==' + t + '=='
    if (l.underline) t = '<u>' + t + '</u>'
    if (l.link) t = '[' + t + '](' + l.link + ')'
    out.push(t)
    i++
  }
  return out.join('')
}

/**
 * 组内序列化：连续同标记的 leaf 合并成一段再逐层包裹。
 *
 * 早期实现只处理 italic，导致「加粗 + 删除线」「加粗 + 高亮」「加粗 + 链接」
 * 这些组合在保存时静默丢掉外层以外的标记。
 */
const WRAP_ORDER: { key: keyof LeafFormat; open: string; close: string }[] = [
  { key: 'strike', open: '~~', close: '~~' },
  { key: 'highlight', open: '==', close: '==' },
  { key: 'underline', open: '<u>', close: '</u>' },
]

function wrapWithMarks(text: string, leaf: LeafFormat): string {
  let t = text
  if (!t) return ''
  if (leaf.italic) t = '*' + t + '*'
  for (const w of WRAP_ORDER) {
    if ((leaf as Record<string, unknown>)[w.key as string]) t = w.open + t + w.close
  }
  if (leaf.link) t = '[' + t + '](' + leaf.link + ')'
  return t
}

/** 组内按「除 bold 以外的标记」分组，组间保证 *斜体* 正确嵌套进外层 ** */
function innerMarks(group: LeafFormat[]): string {
  let s = ''
  let j = 0
  while (j < group.length) {
    const g = group[j]
    const sig = (x: LeafFormat) =>
      [!!x.italic, !!x.strike, !!x.highlight, !!x.underline, x.link || ''].join('|')
    const cur = sig(g)
    const run: string[] = []
    while (j < group.length && sig(group[j]) === cur) {
      run.push(group[j].text)
      j++
    }
    s += wrapWithMarks(run.join(''), g)
  }
  return s
}

/* ---------------- 文档级：块容器递归 ---------------- */

type AnyNode = CMarkElement & { type: string; children: unknown[] }

const leafText = (children: unknown): string =>
  Array.isArray(children)
    ? children.map((c) => (c && typeof (c as { text?: string }).text === 'string' ? (c as { text: string }).text : '')).join('')
    : ''

/** ndb.js 的 toNodes 输出（叶子是原始文本）→ 拆成带格式标记的 leaves */
export function inflateDoc(nodes: unknown): CMarkElement[] {
  const list = Array.isArray(nodes) ? (nodes as AnyNode[]) : []
  return list.map((n) => {
    const t = n.type
    if (t === 'codeblock') {
      // ndb.js 把正文放在 content 字段、children 恒为空；Slate 只认 children，
      // 必须搬过去，否则打开老笔记看到的是空代码框
      const body = typeof (n as { content?: string }).content === 'string' ? (n as { content: string }).content : ''
      return { ...n, children: [{ text: body }] } as unknown as CMarkElement
    }
    if (t === 'table') {
      const rows = (n.children as AnyNode[]) || []
      return {
        ...n,
        children: rows.map((r) => ({
          ...r,
          children: ((r.children as AnyNode[]) || []).map((c) => inflateTableCell(c)),
        })),
      } as unknown as CMarkElement
    }
    if (t === 'bulleted-list' || t === 'numbered-list') {
      const items = (n.children as AnyNode[]) || []
      return { ...n, children: items.map((i) => inflateListItem(i)) } as unknown as CMarkElement
    }
    return { ...n, children: inflateLeaves(leafText(n.children)) } as unknown as CMarkElement
  })
}

/**
 * 表格单元格：正常情况下只有叶子，但用户在单元格里按 Ctrl+1 / Ctrl+0 / Ctrl+Q
 * 会把叶子变成块级元素（heading / paragraph / blockquote）。原来的实现直接
 * 交给 inflateLeaves/deflateLeaves，它们只认 .text，于是整格文字在存盘时被清空。
 * 这里把块级子节点的文字一起收进来，宁可丢块级样式也不能丢字。
 */
function inflateTableCell(cell: AnyNode): AnyNode {
  const kids = ((cell.children as AnyNode[]) || []).flatMap((c) => {
    const hasText = typeof (c as { text?: string }).text === 'string'
    if (hasText) return inflateLeaves((c as unknown as { text: string }).text).map((l) => l as unknown as AnyNode)
    // 块级子节点：把里面的文字并成一段（单元格不支持多段）
    return inflateLeaves(leafText(c.children)).map((l) => l as unknown as AnyNode)
  })
  return { ...cell, children: kids.length ? kids : [{ text: '' }] } as AnyNode
}

function deflateTableCell(cell: AnyNode): AnyNode {
  const parts: LeafFormat[] = []
  const collect = (node: AnyNode) => {
    const t = (node as { text?: string }).text
    if (typeof t === 'string') {
      parts.push(node as unknown as LeafFormat)
      return
    }
    ;((node.children as AnyNode[]) || []).forEach(collect)
  }
  ;((cell.children as AnyNode[]) || []).forEach(collect)
  return { ...cell, children: [{ text: deflateLeaves(parts) }] } as AnyNode
}

/** 列表项：叶子做行内解析，挂在它下面的子列表递归处理 */
function inflateListItem(item: AnyNode): AnyNode {
  const kids = ((item.children as AnyNode[]) || []).map((c) => {
    const ct = (c as { type?: string }).type
    if (ct === 'bulleted-list' || ct === 'numbered-list') return inflateDoc([c])[0] as AnyNode
    if (typeof (c as { text?: string }).text === 'string') {
      const leaves = inflateLeaves((c as unknown as { text: string }).text)
      // 第一个 leaf 沿用原对象位置，其余追加
      return leaves.map((l) => l as unknown as AnyNode)
    }
    return [c]
  })
  return { ...item, children: (kids as unknown[]).flat() } as AnyNode
}

function deflateListItem(item: AnyNode): AnyNode {
  const out: unknown[] = []
  let textRun: LeafFormat[] = []
  const flush = () => {
    if (textRun.length) {
      out.push({ text: deflateLeaves(textRun) })
      textRun = []
    }
  }
  ;((item.children as AnyNode[]) || []).forEach((c) => {
    const ct = (c as { type?: string }).type
    if (ct === 'bulleted-list' || ct === 'numbered-list') {
      flush()
      out.push(deflateDoc([c])[0])
    } else if (typeof (c as { text?: string }).text === 'string') {
      textRun.push(c as unknown as LeafFormat)
    }
  })
  flush()
  return { ...item, children: out.length ? out : [{ text: '' }] } as AnyNode
}

/** Slate 里的带格式 leaves → 收拢成单叶纯文本，交给 ndb.js 的 toMarkdown 拼块级 */
export function deflateDoc(nodes: CMarkElement[]): CMarkElement[] {
  const list = (nodes || []) as AnyNode[]
  return list.map((n) => {
    const t = n.type
    if (t === 'codeblock') {
      const body = leafText(n.children)
      return { ...n, content: body, children: [{ text: body }] } as unknown as CMarkElement
    }
    if (t === 'table') {
      const rows = (n.children as AnyNode[]) || []
      return {
        ...n,
        children: rows.map((r) => ({
          ...r,
          children: ((r.children as AnyNode[]) || []).map((c) => deflateTableCell(c)),
        })),
      } as unknown as CMarkElement
    }
    if (t === 'bulleted-list' || t === 'numbered-list') {
      const items = (n.children as AnyNode[]) || []
      return { ...n, children: items.map((i) => deflateListItem(i)) } as unknown as CMarkElement
    }
    return { ...n, children: [{ text: deflateLeaves(n.children as LeafFormat[]) }] } as unknown as CMarkElement
  })
}
