export type ContentKind = 'json' | 'xml' | 'html' | 'image' | 'text' | 'binary'

export function detectContentKind(contentType = '', body = '', bodyBase64 = ''): ContentKind {
  const type = contentType.toLowerCase()
  const trimmed = body.trim()
  if (type.includes('json') || looksLikeJson(trimmed)) return 'json'
  if (type.includes('xml') || type.includes('rss') || type.includes('atom') || looksLikeXml(trimmed)) return 'xml'
  if (type.includes('html') || /^<!doctype html/i.test(trimmed) || /^<html[\s>]/i.test(trimmed)) return 'html'
  if (type.startsWith('image/') && bodyBase64) return 'image'
  if (type.startsWith('text/') || type.includes('javascript') || type.includes('form-urlencoded') || body) return 'text'
  return 'binary'
}

export function prettyJson(value: string) {
  try {
    return JSON.stringify(JSON.parse(value), null, 2)
  } catch {
    return value
  }
}

export function parseJson(value: string) {
  try {
    return JSON.parse(value)
  } catch {
    return undefined
  }
}

export function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char] || char)
}

export function highlightCode(value: string, kind: ContentKind | 'plain', query = '', activeIndex = 0) {
  let html = escapeHtml(value)
  if (kind === 'json') {
    html = html.replace(/(&quot;.*?&quot;)(\s*:)?/g, (_match, token, colon) =>
      colon ? `<span class="code-token-key">${token}</span>${colon}` : `<span class="code-token-string">${token}</span>`
    )
    html = html.replace(/\b(true|false|null)\b/g, '<span class="code-token-literal">$1</span>')
    html = html.replace(/(-?\b\d+(?:\.\d+)?\b)/g, '<span class="code-token-number">$1</span>')
  } else if (kind === 'xml' || kind === 'html') {
    html = html.replace(/(&lt;\/?)([\w:-]+)/g, '$1<span class="code-token-tag">$2</span>')
    html = html.replace(/([\w:-]+)=(&quot;.*?&quot;)/g, '<span class="code-token-attr">$1</span>=<span class="code-token-string">$2</span>')
    html = html.replace(/(&lt;!--[\s\S]*?--&gt;)/g, '<span class="code-token-comment">$1</span>')
  }
  if (!query) return html

  let index = -1
  return html.replace(new RegExp(escapeRegExp(escapeHtml(query)), 'gi'), (match) => {
    index += 1
    return `<mark class="search-hit ${index === activeIndex ? 'active' : ''}">${match}</mark>`
  })
}

export function countMatches(value: string, query: string) {
  if (!query) return 0
  return value.toLowerCase().split(query.toLowerCase()).length - 1
}

export function guessFileName(contentType: string) {
  const type = contentType.toLowerCase()
  if (type.includes('excel') || type.includes('spreadsheet')) return 'response.xlsx'
  if (type.includes('csv')) return 'response.csv'
  if (type.includes('json')) return 'response.json'
  if (type.includes('xml')) return 'response.xml'
  if (type.includes('html')) return 'response.html'
  if (type.includes('pdf')) return 'response.pdf'
  if (type.includes('zip')) return 'response.zip'
  if (type.includes('image/png')) return 'response.png'
  if (type.includes('image/jpeg')) return 'response.jpg'
  if (type.includes('image/webp')) return 'response.webp'
  if (type.includes('audio/mpeg')) return 'response.mp3'
  if (type.includes('audio/')) return 'response.audio'
  if (type.includes('video/mp4')) return 'response.mp4'
  if (type.includes('video/')) return 'response.video'
  if (type.startsWith('text/')) return 'response.txt'
  return 'response.bin'
}

export function fileLabel(contentType: string) {
  const type = contentType.toLowerCase()
  if (type.includes('excel') || type.includes('spreadsheet')) return 'XLSX'
  if (type.includes('csv')) return 'CSV'
  if (type.includes('pdf')) return 'PDF'
  if (type.includes('zip')) return 'ZIP'
  if (type.includes('image')) return 'IMG'
  if (type.includes('audio')) return 'AUDIO'
  if (type.includes('video')) return 'VIDEO'
  if (type.includes('json')) return 'JSON'
  if (type.includes('xml')) return 'XML'
  if (type.includes('html')) return 'HTML'
  return 'BIN'
}

export function formatBytes(value: number) {
  if (!Number.isFinite(value) || value <= 0) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB']
  let size = value
  let index = 0
  while (size >= 1024 && index < units.length - 1) {
    size /= 1024
    index += 1
  }
  const precision = index === 0 ? 0 : size >= 100 ? 0 : size >= 10 ? 1 : 2
  return `${size.toFixed(precision)} ${units[index]}`
}

export function formatDuration(ms: number) {
  if (!Number.isFinite(ms) || ms < 0) return '0 ms'
  if (ms < 1000) return `${Math.round(ms)} ms`
  return `${(ms / 1000).toFixed(ms >= 10000 ? 1 : 2)} s`
}

function looksLikeJson(value: string) {
  return /^[\[{]/.test(value)
}

function looksLikeXml(value: string) {
  return /^<\?xml/i.test(value) || /^<[\w:-]+[\s>]/.test(value)
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}
