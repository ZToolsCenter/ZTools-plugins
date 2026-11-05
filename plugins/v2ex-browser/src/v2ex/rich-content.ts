import DOMPurify from 'dompurify'

const ALLOWED_TAGS = [
  'p', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
  'pre', 'code', 'ul', 'ol', 'li', 'blockquote',
  'strong', 'em', 'del', 'br', 'hr', 'a', 'img'
]

const ALLOWED_URI_REGEXP = /^(?:https?:|\/|#|\.{0,2}\/)/i

export function normalizeContentUrl(value: string): string {
  if (value.startsWith('//')) return `https:${value}`
  if (value.startsWith('/') || value.startsWith('#') || value.startsWith('.')) {
    return new URL(value, 'https://www.v2ex.com').href
  }
  return value
}

export function renderRichContent(contentRendered?: string): string {
  if (!contentRendered) return ''
  const sanitized = document.createElement('div')
  sanitized.innerHTML = DOMPurify.sanitize(contentRendered, {
    ALLOWED_TAGS,
    ALLOWED_ATTR: ['href', 'src', 'alt', 'loading', 'class'],
    ALLOWED_URI_REGEXP,
    FORBID_ATTR: ['style'],
    ADD_DATA_URI_TAGS: []
  })
  // 插件从本地文件加载，不能让相对地址继承 file: 协议。
  for (const element of sanitized.querySelectorAll('[src], [href]')) {
    for (const attribute of ['src', 'href']) {
      const value = element.getAttribute(attribute)
      if (value) element.setAttribute(attribute, normalizeContentUrl(value))
    }
  }
  return sanitized.innerHTML
}

export function openExternalUrl(value: string): void {
  const url = normalizeContentUrl(value)
  if (window.ztools?.shellOpenExternal) {
    window.ztools.shellOpenExternal(url)
  } else {
    window.open(url, '_blank', 'noopener,noreferrer')
  }
}
