/**
 * 裸 URL / 裸邮箱的"降级"处理
 *
 * 原则：用户写的是什么，存回去就得是什么。
 * remark-gfm 默认开 autolink，正文里的 lancc@live.com、www.live.com 会被解析成链接节点；
 * 序列化时这些节点又被写成 <lancc@live.com> 或 [www.live.com](http://www.live.com)，
 * 等于擅自改写用户原文。
 *
 * 所以反序列化之后做一次降级：只要是「文字本身就是那个地址」的链接
 * （用户手写的 [显示文字](url) 文字与地址不同，不受影响），就把链接外壳去掉、
 * 内容提升成普通文本。已存成 <邮箱> / [地址](地址) 的笔记在打开时会被还原。
 */

type AnyNode = {
  type?: string
  url?: unknown
  children?: AnyNode[]
  text?: string
  [k: string]: unknown
}

/** 去掉协议、mailto:、www. 前缀和结尾斜杠，用于比较"文字是不是就是这个地址" */
function bare(s: string): string {
  let t = String(s || '').trim().toLowerCase()
  if (t.startsWith('mailto:')) t = t.slice(7)
  if (t.startsWith('https://')) t = t.slice(8)
  else if (t.startsWith('http://')) t = t.slice(7)
  if (t.startsWith('www.')) t = t.slice(4)
  while (t.endsWith('/')) t = t.slice(0, -1)
  return t
}

/** 取节点里的纯文本（链接内容通常只有文本） */
function textOf(node: AnyNode): string {
  const kids = Array.isArray(node.children) ? node.children : []
  let out = ''
  for (const k of kids) {
    if (typeof k.text === 'string') out += k.text
    else if (Array.isArray(k.children)) out += textOf(k)
  }
  return out
}

/**
 * 把「文字等于链接地址」的链接节点拆成纯文本，递归处理整棵树。
 * 返回新数组；链接被拆开后它的子节点会被摊平到父级（元素外壳消失）。
 */
export function flattenAutolinks<T>(nodes: T[]): T[] {
  if (!Array.isArray(nodes)) return nodes
  const walk = (list: AnyNode[]): AnyNode[] => {
    const out: AnyNode[] = []
    for (const n of list) {
      if (!n || typeof n !== 'object') {
        out.push(n)
        continue
      }
      const kids = Array.isArray(n.children) ? walk(n.children) : undefined
      const isLink = n.type === 'a' || n.type === 'link'
      if (isLink && n.url) {
        const text = textOf(n)
        if (text && bare(text) === bare(String(n.url))) {
          // 自动识别出来的链接：拆掉外壳，内容原样留在父级
          if (kids && kids.length) out.push(...kids)
          else out.push({ text })
          continue
        }
        out.push({ ...n, children: kids as AnyNode[] })
        continue
      }
      out.push(kids ? ({ ...n, children: kids } as AnyNode) : n)
    }
    return out
  }
  return walk(nodes as unknown as AnyNode[]) as unknown as T[]
}
