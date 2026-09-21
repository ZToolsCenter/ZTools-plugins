import { parseSearchBody, type QueryGroup } from './queryBuilder'
import { parseDslJson, validateSearchBody } from './dslValidate'
import type { MappingField } from '../types'

export type SearchRequestEnvelope = {
  method: string
  index: string
  path: string
  body: Record<string, unknown>
}

export type ApplySearchRequestResult = {
  ok: boolean
  errors: string[]
  warnings: string[]
  envelope?: SearchRequestEnvelope
  root?: QueryGroup
  size?: number
  from?: number
}

const METHOD_RE = /^(GET|POST|PUT|DELETE|HEAD)\s+(\/\S+)\s*$/i

export function formatSearchRequestText(index: string, body: Record<string, unknown>): string {
  const idx = (index || '').trim() || '_all'
  const path = `/${idx}/_search`
  return `GET ${path}\n${JSON.stringify(body, null, 2)}`
}

export function parseSearchRequestText(text: string): {
  envelope?: SearchRequestEnvelope
  errors: string[]
} {
  const raw = text.replace(/^\uFEFF/, '').trim()
  if (!raw) {
    return { errors: ['\u8bf7\u8f93\u5165\u67e5\u8be2\u8bf7\u6c42\uff08GET /index/_search + JSON body\uff09'] }
  }

  // Dev Tools style: first non-empty line is METHOD path, rest is JSON body
  const lines = raw.split(/\r?\n/)
  const firstIdx = lines.findIndex((l) => l.trim().length > 0)
  if (firstIdx < 0) {
    return { errors: ['\u8bf7\u8f93\u5165\u67e5\u8be2\u8bf7\u6c42'] }
  }
  const first = lines[firstIdx].trim()
  const m = first.match(METHOD_RE)

  if (m) {
    const method = m[1].toUpperCase()
    const path = m[2]
    const bodyText = lines.slice(firstIdx + 1).join('\n').trim()
    if (!bodyText) {
      return { errors: ['\u7f3a\u5c11\u8bf7\u6c42 Body JSON'] }
    }
    const parsed = parseDslJson(bodyText)
    if (parsed.error) {
      return { errors: [`Body JSON \u65e0\u6548\uff1a${parsed.error}`] }
    }
    if (!parsed.value || typeof parsed.value !== 'object' || Array.isArray(parsed.value)) {
      return { errors: ['Body \u5fc5\u987b\u662f JSON \u5bf9\u8c61'] }
    }
    const index = extractIndexFromPath(path)
    if (!index) {
      return { errors: [`\u65e0\u6cd5\u4ece\u8def\u5f84\u89e3\u6790\u7d22\u5f15\uff1a${path}\uff08\u793a\u4f8b\uff1a/my-index/_search\uff09`] }
    }
    if (!/\/_search\/?$/i.test(path) && !path.toLowerCase().includes('/_search')) {
      return {
        errors: [`\u8def\u5f84\u5e94\u5305\u542b /_search\uff1a${path}`],
      }
    }
    if (method !== 'GET' && method !== 'POST') {
      return { errors: [`\u641c\u7d22\u8bf7\u6c42\u4ec5\u652f\u6301 GET/POST\uff0c\u5f53\u524d\uff1a${method}`] }
    }
    return {
      envelope: {
        method,
        index,
        path,
        body: parsed.value as Record<string, unknown>,
      },
      errors: [],
    }
  }

  // Fallback: body-only JSON (legacy)
  const parsed = parseDslJson(raw)
  if (parsed.error) {
    return {
      errors: [
        `JSON \u65e0\u6548\uff1a${parsed.error}`,
        '\u4e5f\u53ef\u4f7f\u7528 Dev Tools \u683c\u5f0f\uff1a\u7b2c\u4e00\u884c GET /index/_search\uff0c\u4e4b\u540e\u4e3a Body JSON',
      ],
    }
  }
  if (!parsed.value || typeof parsed.value !== 'object' || Array.isArray(parsed.value)) {
    return { errors: ['\u8bf7\u63d0\u4f9b\u6709\u6548\u7684\u67e5\u8be2 JSON \u5bf9\u8c61'] }
  }
  return {
    envelope: {
      method: 'GET',
      index: '',
      path: '',
      body: parsed.value as Record<string, unknown>,
    },
    errors: [],
  }
}

export function extractIndexFromPath(path: string): string {
  const p = path.trim()
  // /index/_search or /index,index2/_search or /index/_search?pretty
  const cleaned = p.split('?')[0].replace(/\/+$/, '')
  const m = cleaned.match(/^\/(.+?)\/_search$/i)
  if (m) return decodeURIComponent(m[1])
  return ''
}

export function applySearchRequestText(
  text: string,
  options: {
    availableIndices: string[]
    fields?: MappingField[]
    fallbackIndex?: string
  },
): ApplySearchRequestResult {
  const errors: string[] = []
  const warnings: string[] = []
  const { envelope, errors: parseErrors } = parseSearchRequestText(text)
  if (parseErrors.length || !envelope) {
    return { ok: false, errors: parseErrors.length ? parseErrors : ['\u89e3\u6790\u5931\u8d25'], warnings }
  }

  let index = envelope.index.trim()
  if (!index) {
    index = (options.fallbackIndex || '').trim()
    if (!index) {
      errors.push('\u672a\u6307\u5b9a\u7d22\u5f15\uff1a\u8bf7\u5728\u7b2c\u4e00\u884c\u5199 GET /your-index/_search\uff0c\u6216\u5148\u5728\u9875\u9762\u9009\u62e9\u7d22\u5f15')
    } else {
      warnings.push(`\u672a\u5728\u8bf7\u6c42\u4e2d\u6307\u5b9a\u7d22\u5f15\uff0c\u5c06\u4f7f\u7528\u5f53\u524d\u7d22\u5f15\uff1a${index}`)
      envelope.index = index
      envelope.path = `/${index}/_search`
    }
  }

  if (index && options.availableIndices.length) {
    const names = options.availableIndices
    const parts = index.split(',').map((s) => s.trim()).filter(Boolean)
    const missing = parts.filter((p) => p !== '_all' && p !== '*' && !names.includes(p) && !matchPattern(p, names))
    if (missing.length) {
      errors.push(`\u7d22\u5f15\u4e0d\u5b58\u5728\u6216\u672a\u52a0\u8f7d\uff1a${missing.join(', ')}\uff08\u53ef\u5148\u70b9\u300c\u5237\u65b0\u300d\uff09`)
    }
  } else if (index && !options.availableIndices.length) {
    warnings.push('\u5f53\u524d\u7d22\u5f15\u5217\u8868\u4e3a\u7a7a\uff0c\u65e0\u6cd5\u6821\u9a8c\u7d22\u5f15\u662f\u5426\u5b58\u5728\uff0c\u8bf7\u5148\u5237\u65b0')
  }

  const dslIssues = validateSearchBody(envelope.body, options.fields || [])
  for (const issue of dslIssues) {
    if (issue.severity === 'error') {
      errors.push(issue.path ? `${issue.path}\uff1a${issue.message}` : issue.message)
    } else {
      warnings.push(issue.path ? `${issue.path}\uff1a${issue.message}` : issue.message)
    }
  }

  const parsed = parseSearchBody(envelope.body)
  if (parsed.errors.length || !parsed.root) {
    errors.push(...(parsed.errors.length ? parsed.errors : ['\u65e0\u6cd5\u5e94\u7528\u5230\u6761\u4ef6']))
  }

  if (errors.length) {
    return { ok: false, errors, warnings, envelope }
  }

  return {
    ok: true,
    errors: [],
    warnings,
    envelope: { ...envelope, index },
    root: parsed.root!,
    size: parsed.size,
    from: parsed.from,
  }
}

function matchPattern(pattern: string, names: string[]): boolean {
  // simple wildcard index pattern: logs-*
  if (!pattern.includes('*')) return false
  const re = new RegExp('^' + pattern.split('*').map(escapeReg).join('.*') + '$')
  return names.some((n) => re.test(n))
}

function escapeReg(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}
