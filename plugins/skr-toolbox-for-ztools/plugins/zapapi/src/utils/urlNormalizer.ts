import { resolveVariables } from './variableResolver'

export type HttpUrlNormalizeError = 'empty' | 'invalid' | 'unsupported_protocol'

export interface HttpUrlNormalizeResult {
  ok: boolean
  url: string
  reason?: HttpUrlNormalizeError
}

const SCHEME_PATTERN = /^[a-zA-Z][a-zA-Z\d+\-.]*:\/\//

function extractHostname(urlOrHost: string): string | null {
  try {
    return new URL(urlOrHost).hostname
  } catch {
    return null
  }
}

function shouldUseHttp(hostname: string): boolean {
  const h = hostname.toLowerCase()
  if (h === 'localhost' || h === '::1') {
    return true
  }

  const parts = h.split('.')
  if (parts.length !== 4) {
    return false
  }

  const first = parseInt(parts[0], 10)
  const second = parseInt(parts[1], 10)

  if (first === 10) return true
  if (first === 127) return true
  if (first === 192 && second === 168) return true
  if (first === 172 && second >= 16 && second <= 31) return true
  if (first <= 9) return true

  return false
}

function getDefaultProtocol(hostname: string): string {
  return shouldUseHttp(hostname) ? 'http://' : 'https://'
}

export function normalizeHttpUrl(input: string, variables: Record<string, string>): HttpUrlNormalizeResult {
  const resolved = resolveVariables(input, variables).trim()
  if (!resolved) {
    return { ok: false, url: '', reason: 'empty' }
  }

  const hasScheme = SCHEME_PATTERN.test(resolved)
  const urlWithScheme = hasScheme ? resolved : `https://${resolved}`
  const hostname = extractHostname(urlWithScheme)
  const defaultProtocol = hostname ? getDefaultProtocol(hostname) : 'https://'
  const withScheme = hasScheme ? resolved : `${defaultProtocol}${resolved}`

  try {
    const parsed = new URL(withScheme)
    const protocol = parsed.protocol
    if (protocol !== 'http:' && protocol !== 'https:') {
      return { ok: false, url: withScheme, reason: 'unsupported_protocol' }
    }
  } catch {
    return { ok: false, url: withScheme, reason: 'invalid' }
  }

  return { ok: true, url: withScheme }
}
