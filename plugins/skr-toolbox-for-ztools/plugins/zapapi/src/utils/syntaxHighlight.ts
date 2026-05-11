import hljs from 'highlight.js/lib/core'
import json from 'highlight.js/lib/languages/json'
import xml from 'highlight.js/lib/languages/xml'
import javascript from 'highlight.js/lib/languages/javascript'
import plaintext from 'highlight.js/lib/languages/plaintext'

hljs.registerLanguage('json', json)
hljs.registerLanguage('xml', xml)
hljs.registerLanguage('html', xml) // xml handles HTML as well in highlight.js
hljs.registerLanguage('javascript', javascript)
hljs.registerLanguage('plaintext', plaintext)

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

function decodeHtmlEntities(str: string): string {
  let output = str
  for (let i = 0; i < 3; i += 1) {
    const next = output
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
    if (next === output) break
    output = next
  }
  return output
}

function isValidJson(text: string): boolean {
  const trimmed = text.trim()
  if (!trimmed) {
    return false
  }
  try {
    JSON.parse(trimmed)
    return true
  } catch {
    return false
  }
}

function detectLang(body: string, contentType?: string): 'json' | 'html' | 'xml' | 'javascript' | 'text' {
  if (contentType) {
    const ct = contentType.toLowerCase()
    if (ct.includes('json')) return 'json'
    if (ct.includes('html')) return 'html'
    if (ct.includes('xml')) return 'xml'
    if (ct.includes('javascript') || ct.includes('ecmascript')) return 'javascript'
  }
  const t = body.trim()
  if ((t.startsWith('{') && t.endsWith('}')) || (t.startsWith('[') && t.endsWith(']'))) {
    try { JSON.parse(t); return 'json' } catch { /* not json */ }
  }
  if (t.startsWith('<') && /<\/?[\w!]/.test(t)) return 'html'
  if (t.startsWith('&lt;') && /&lt;\/?[\w!]/.test(t)) return 'html'
  return 'text'
}

export type HighlightMode = 'auto' | 'json' | 'xml' | 'html' | 'javascript' | 'text'

export function highlight(body: string, contentType?: string, mode: HighlightMode = 'auto'): string {
  if (!body) return ''
  const lang = mode === 'auto' ? detectLang(body, contentType) : mode

  if (lang === 'text') {
    return escapeHtml(body)
  }

  let contentToHighlight = body
  if (lang === 'html' || lang === 'xml') {
    const trimmed = body.trim()
    const hasEscapedTags = /&lt;\/?[\w!]/.test(trimmed)
    const hasRawTags = /<\/?[\w!]/.test(trimmed)
    if (hasEscapedTags && !hasRawTags) {
      contentToHighlight = decodeHtmlEntities(body)
    }
  }

  if (lang === 'json' && !isValidJson(contentToHighlight)) {
    return escapeHtml(contentToHighlight)
  }

  try {
    const hljsLang = lang === 'html' ? 'xml' : lang
    const result = hljs.highlight(contentToHighlight, { language: hljsLang })
    return result.value
  } catch {
    return escapeHtml(contentToHighlight)
  }
}

