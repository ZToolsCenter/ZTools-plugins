import { marked } from 'marked'

// GFM + 换行转 <br>，更贴近便签书写习惯
marked.setOptions({
  gfm: true,
  breaks: true
})

/** 将 Markdown 渲染为 HTML */
export function renderMarkdown(src: string): string {
  if (!src) return ''
  return marked.parse(src) as string
}

/** 从 Markdown 提取标题：首个标题或首段非空文本 */
export function extractTitle(src: string): string {
  if (!src) return '无标题'
  const lines = src.split('\n')
  for (const line of lines) {
    const m = /^#{1,6}\s+(.+)$/.exec(line.trim())
    if (m) return m[1].trim()
  }
  for (const line of lines) {
    const t = line.trim()
    if (t) return t.replace(/[#*`>_~\-\[\]]/g, '').slice(0, 40)
  }
  return '无标题'
}

/** 将 Markdown 剥离为纯文本，用于"复制纯文本" */
export function toPlainText(src: string): string {
  if (!src) return ''
  let s = src
  // 代码块：保留内容，去掉围栏
  s = s.replace(/```[\s\S]*?```/g, (m) =>
    m.replace(/^```[^\n]*\n?/, '').replace(/```$/, '')
  )
  // 行内代码
  s = s.replace(/`([^`]+)`/g, '$1')
  // 图片 -> alt
  s = s.replace(/!\[([^\]]*)\]\([^)]+\)/g, '$1')
  // 链接 -> 文本
  s = s.replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
  // 加粗 / 斜体 / 删除线
  s = s.replace(/\*\*([^*]+)\*\*/g, '$1')
  s = s.replace(/\*([^*]+)\*/g, '$1')
  s = s.replace(/__([^_]+)__/g, '$1')
  s = s.replace(/_([^_]+)_/g, '$1')
  s = s.replace(/~~([^~]+)~~/g, '$1')
  // 标题井号
  s = s.replace(/^#{1,6}\s+/gm, '')
  // 引用
  s = s.replace(/^>\s?/gm, '')
  // 无序 / 有序列表标记
  s = s.replace(/^\s*[-*+]\s+/gm, '')
  s = s.replace(/^\s*\d+\.\s+/gm, '')
  // 水平线
  s = s.replace(/^[-*_]{3,}$/gm, '')
  return s.trim()
}

/** 净化 Markdown 内容：移除 <br> 空行，合并连续空行，清理序列化转义 */
export function normalizeContent(src: string): string {
  if (!src) return ''
  return src
    .split('\n')
    // 移除 <br /> 独立行（包括 > <br /> 块引用内空行）
    .filter(line => !/^(\s*>\s+)?<br\s*\/?>\s*$/i.test(line.trim()))
    // 行首转义字符还原（remark-stringify 为防止语意冲突加的 \）
    .map(line => line.replace(/^(\s*)\\([#*\-+>=])/, '$1$2'))
    .join('\n')
    // 移除尾部空引用行（空段落残留）
    .replace(/(?:\n\s*>\s*)+\s*$/, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}
