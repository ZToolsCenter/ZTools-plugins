import { parseDslJson } from './dslValidate'

export type RestHint = {
  severity: 'error' | 'warning' | 'info'
  message: string
}

export function normalizeRestPath(path: string): string {
  const t = path.trim()
  if (!t) return '/'
  return t.startsWith('/') ? t : `/${t}`
}

export function validateRestPath(path: string): RestHint[] {
  const hints: RestHint[] = []
  const raw = path.trim()
  if (!raw) {
    hints.push({ severity: 'error', message: '\u8def\u5f84\u4e0d\u80fd\u4e3a\u7a7a' })
    return hints
  }
  if (/\s/.test(raw)) {
    hints.push({ severity: 'error', message: '\u8def\u5f84\u4e0d\u80fd\u5305\u542b\u7a7a\u683c' })
  }
  if (!raw.startsWith('/')) {
    hints.push({
      severity: 'warning',
      message: '\u8def\u5f84\u5efa\u8bae\u4ee5 / \u5f00\u5934\uff08\u53d1\u9001\u65f6\u4f1a\u81ea\u52a8\u8865\u5168\uff09',
    })
  }
  // crude check: query string should use ? and &
  const q = raw.indexOf('?')
  if (q >= 0) {
    const qs = raw.slice(q + 1)
    if (qs.includes(' ') || qs.startsWith('&') || qs.endsWith('&') || qs.includes('&&')) {
      hints.push({ severity: 'warning', message: '\u67e5\u8be2\u53c2\u6570\u683c\u5f0f\u53ef\u80fd\u4e0d\u6b63\u786e' })
    }
  }
  return hints
}

export function validateRestBody(method: string, bodyText: string): RestHint[] {
  const hints: RestHint[] = []
  const m = method.toUpperCase()
  const trimmed = bodyText.trim()

  if (!trimmed) {
    if (m === 'POST' || m === 'PUT') {
      hints.push({
        severity: 'info',
        message: 'Body \u4e3a\u7a7a\uff1a\u5c06\u4ee5\u65e0\u8bf7\u6c42\u4f53\u53d1\u9001',
      })
    }
    return hints
  }

  // HEAD must not carry a body; GET with body is valid for ES (_search etc.)
  if (m === 'HEAD') {
    hints.push({
      severity: 'warning',
      message: 'HEAD \u4e0d\u5e94\u643a\u5e26 Body\uff0c\u53d1\u9001\u65f6\u4f1a\u5ffd\u7565 Body',
    })
  }

  const parsed = parseDslJson(trimmed)
  if (parsed.error) {
    hints.push({ severity: 'error', message: `Body JSON \u65e0\u6548\uff1a${parsed.error}` })
    return hints
  }
  if (parsed.value === null || typeof parsed.value !== 'object') {
    hints.push({
      severity: 'warning',
      message: 'Body \u5efa\u8bae\u4f7f\u7528 JSON \u5bf9\u8c61\u6216\u6570\u7ec4',
    })
  } else {
    hints.push({ severity: 'info', message: 'Body JSON \u8bed\u6cd5\u6b63\u786e' })
  }
  return hints
}

export function validateRestRequest(method: string, path: string, bodyText: string): RestHint[] {
  return [...validateRestPath(path), ...validateRestBody(method, bodyText)]
}

export function restHasBlockingError(hints: RestHint[]): boolean {
  return hints.some((h) => h.severity === 'error')
}
