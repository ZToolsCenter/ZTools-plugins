import MarkdownIt from 'markdown-it'

/**
 * Markdown 渲染实例。
 * - html: false —— 不渲染原始 HTML，防止 XSS 注入
 * - linkify: true —— 自动识别 URL 为链接
 * - breaks: false —— 单个换行不强制转 <br>（遵循标准 Markdown 规则）
 */
const md = new MarkdownIt({
  html: false,
  linkify: true,
  breaks: false,
})

/** 将（已替换变量的）文本渲染为 Markdown HTML */
export function renderMarkdown(text: string): string {
  if (!text) return ''
  return md.render(text)
}
