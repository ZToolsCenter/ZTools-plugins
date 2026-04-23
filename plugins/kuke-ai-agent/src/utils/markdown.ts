import MarkdownIt from 'markdown-it'
import hljs from 'highlight.js/lib/common'

export const escapeHtml = (value: string) =>
  value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')

export const renderHighlightedCode = (code: string, lang: string) => {
  const language = String(lang || '').trim().toLowerCase()
  let highlighted = ''
  let displayLanguage = language || 'text'
  try {
    if (language && hljs.getLanguage(language)) {
      highlighted = hljs.highlight(code, { language, ignoreIllegals: true }).value
    } else if (language) {
      highlighted = escapeHtml(code)
    } else {
      const auto = hljs.highlightAuto(code)
      highlighted = auto.value || escapeHtml(code)
      displayLanguage = auto.language || 'text'
    }
  } catch {
    highlighted = escapeHtml(code)
  }
  const encoded = encodeURIComponent(code)
  const safeLang = escapeHtml(displayLanguage)
  return `<div class="md-code-block"><div class="md-code-header"><span class="md-code-lang">${safeLang}</span><button type="button" class="md-code-copy" data-code="${encoded}" aria-label="复制代码"><span class="md-code-copy-icon" aria-hidden="true"></span><span class="md-code-copy-label">复制</span></button></div><pre class="md-code-pre hljs"><code class="hljs language-${safeLang}">${highlighted}</code></pre></div>`
}

export const md = new MarkdownIt({
  breaks: true,
  linkify: true,
})

md.renderer.rules.fence = (tokens, idx) => {
  const token = tokens[idx]
  const info = token.info ? token.info.trim() : ''
  const langName = info ? info.split(/\s+/)[0] : ''
  return `${renderHighlightedCode(token.content, langName)}\n`
}

md.renderer.rules.code_block = (tokens, idx) => {
  const token = tokens[idx]
  return `${renderHighlightedCode(token.content, '')}\n`
}
