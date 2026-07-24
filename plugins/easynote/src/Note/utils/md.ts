import { marked } from 'marked'

// GFM + 换行转 <br>，更贴近便签书写习惯
marked.setOptions({
  gfm: true,
  breaks: true
})

/** 将 Markdown 渲染为 HTML */
export function renderMarkdown(src: string): string {
  if (!src) return ''
  return marked.parse(src, { async: false }) as string
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
