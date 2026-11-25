import { marked } from 'marked'
import DOMPurify from 'dompurify'

marked.setOptions({ gfm: true, breaks: false })

/** md → 安全 HTML。公式不在这里处理，交给预览组件的 KaTeX auto-render */
export function renderMarkdown(md: string): string {
  const raw = marked.parse(md || '', { async: false }) as string
  return DOMPurify.sanitize(raw, {
    ADD_TAGS: ['iframe'],
    ADD_ATTR: ['target', 'rel', 'data-attachment'],
  })
}

/** 给代码块补上语言 class，便于 highlight.js 识别 */
export function decorateCodeBlocks(root: HTMLElement): void {
  root.querySelectorAll('pre > code').forEach((el) => {
    if (!el.className) {
      const pre = el.parentElement
      const hint = pre?.getAttribute('data-lang')
      if (hint) el.className = 'language-' + hint
    }
  })
}
