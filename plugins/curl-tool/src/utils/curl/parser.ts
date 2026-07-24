import type { CurlParseResult, HttpMethod, ParsedCurlRequest, RequestBodyType, RequestEntry } from './types'

const DATA_FLAGS = new Set(['-d', '--data', '--data-raw', '--data-binary', '--data-ascii'])
const FORM_FLAGS = new Set(['-F', '--form'])
const METHOD_FLAGS = new Set(['-X', '--request'])
const HEADER_FLAGS = new Set(['-H', '--header'])
const URL_FLAGS = new Set(['--url'])

export function createEntry(key = '', value = ''): RequestEntry {
  return {
    id: `${Date.now()}:${Math.random().toString(36).slice(2, 8)}`,
    enabled: true,
    key,
    value,
    valueType: 'string'
  }
}

export function createEmptyRequest(): ParsedCurlRequest {
  return {
    method: 'GET',
    url: '',
    baseUrl: '',
    queryParams: [createEntry()],
    headers: [createEntry()],
    cookies: [],
    body: '',
    bodyType: 'none',
    options: {
      compressed: false,
      insecure: false,
      followRedirects: true
    },
    rawCommand: '',
    warnings: []
  }
}

export function parseCurlCommand(input: string): CurlParseResult {
  const rawCommand = input.trim()
  const warnings: string[] = []
  if (!rawCommand) return { ok: false, error: '请输入 curl 指令', warnings }

  const tokens = tokenizeCurl(rawCommand, warnings)
  const curlIndex = tokens.findIndex((token) => /^curl(?:\.exe)?$/i.test(token))
  const args = curlIndex >= 0 ? tokens.slice(curlIndex + 1) : tokens
  let method: HttpMethod | undefined
  let url = ''
  const headerValues: string[] = []
  const dataValues: string[] = []
  const formValues: string[] = []
  let auth: ParsedCurlRequest['auth']
  const options = { compressed: false, insecure: false, followRedirects: false, timeoutMs: undefined as number | undefined }

  for (let i = 0; i < args.length; i += 1) {
    const token = args[i]
    const next = args[i + 1]
    if (METHOD_FLAGS.has(token)) {
      method = normalizeMethod(next)
      i += 1
    } else if (HEADER_FLAGS.has(token)) {
      if (next) headerValues.push(next)
      i += 1
    } else if (DATA_FLAGS.has(token)) {
      if (next !== undefined) dataValues.push(next)
      i += 1
    } else if (FORM_FLAGS.has(token)) {
      if (next !== undefined) formValues.push(next)
      i += 1
    } else if (URL_FLAGS.has(token)) {
      if (next) url = next
      i += 1
    } else if (token === '-u' || token === '--user') {
      auth = parseBasicAuth(next || '')
      i += 1
    } else if (token === '-k' || token === '--insecure') {
      options.insecure = true
    } else if (token === '-L' || token === '--location') {
      options.followRedirects = true
    } else if (token === '--compressed') {
      options.compressed = true
    } else if (!token.startsWith('-') && !url && looksLikeUrl(token)) {
      url = token
    } else if (token.startsWith('-')) {
      warnings.push(`暂未支持参数 ${token}`)
    }
  }

  if (!url) return { ok: false, error: 'curl 指令缺少 URL', warnings }

  const normalizedUrl = normalizeUrl(url)
  const { baseUrl, queryParams } = splitUrl(normalizedUrl)
  const headers = headerValues.map(parseHeader)
  const cookies = extractCookies(headers)
  const body = formValues.length ? formValues.join('&') : mergeBodyValues(dataValues, headers)
  const bodyType = detectBodyType(body, headers, formValues.length > 0)
  method = method || (body ? 'POST' : 'GET')

  const bearer = findBearer(headers)
  if (!auth && bearer) auth = { type: 'bearer', token: bearer }

  return {
    ok: true,
    warnings,
    request: {
      method,
      url: normalizedUrl,
      baseUrl,
      queryParams,
      headers,
      cookies,
      body,
      bodyType,
      auth,
      options,
      rawCommand,
      warnings
    }
  }
}

export function tokenizeCurl(input: string, warnings: string[] = []) {
  const normalized = input.replace(/\\\r?\n/g, ' ').trim()
  const tokens: string[] = []
  let current = ''
  let quote: '"' | "'" | undefined
  let escaped = false
  for (const char of normalized) {
    if (escaped) {
      current += char
      escaped = false
    } else if (char === '\\' && quote !== "'") {
      escaped = true
    } else if (quote) {
      if (char === quote) quote = undefined
      else current += char
    } else if (char === '"' || char === "'") {
      quote = char
    } else if (/\s/.test(char)) {
      if (current) tokens.push(current)
      current = ''
    } else {
      current += char
    }
  }
  if (current) tokens.push(current)
  if (quote) warnings.push('curl 指令存在未闭合引号，已尽量解析')
  return tokens
}

export function normalizeMethod(value = 'GET'): HttpMethod {
  const method = value.toUpperCase()
  if (['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'].includes(method)) return method as HttpMethod
  return 'GET'
}

export function normalizeUrl(value: string) {
  const trimmed = value.trim()
  if (!trimmed) return ''
  if (/^https?:\/\//i.test(trimmed)) return trimmed
  if (/^(localhost|\d{1,3}(?:\.\d{1,3}){3})(?::\d+)?(?:[/?#]|$)/i.test(trimmed)) return `http://${trimmed}`
  return `https://${trimmed}`
}

export function parseKeyValueBody(value: string): RequestEntry[] {
  if (!value.trim()) return [createEntry()]
  return value
    .split('&')
    .filter(Boolean)
    .map((part) => {
      const index = part.indexOf('=')
      const key = index < 0 ? part : part.slice(0, index)
      const itemValue = index < 0 ? '' : part.slice(index + 1)
      return createEntry(decodeParam(key), decodeParam(itemValue))
    })
}

function decodeParam(value: string) {
  try {
    return decodeURIComponent(value.replace(/\+/g, ' '))
  } catch {
    return value
  }
}

function looksLikeUrl(value: string) {
  return /^https?:\/\//i.test(value) || /^[\w.-]+\.[a-z]{2,}/i.test(value) || /^(localhost|\d{1,3}(?:\.\d{1,3}){3})/i.test(value)
}

function splitUrl(value: string) {
  try {
    const url = new URL(value)
    const queryParams: RequestEntry[] = []
    url.searchParams.forEach((paramValue, key) => queryParams.push(createEntry(key, paramValue)))
    url.search = ''
    return { baseUrl: url.toString(), queryParams: queryParams.length ? queryParams : [createEntry()] }
  } catch {
    return { baseUrl: value, queryParams: [createEntry()] }
  }
}

function parseHeader(value: string) {
  const index = value.indexOf(':')
  if (index < 0) return createEntry(value.trim(), '')
  return createEntry(value.slice(0, index).trim(), value.slice(index + 1).trim())
}

function extractCookies(headers: RequestEntry[]) {
  return headers
    .filter((header) => header.key.toLowerCase() === 'cookie')
    .flatMap((header) =>
      header.value.split(';').filter(Boolean).map((part) => {
        const index = part.indexOf('=')
        return index < 0 ? createEntry(part.trim(), '') : createEntry(part.slice(0, index).trim(), part.slice(index + 1).trim())
      })
    )
}

function mergeBodyValues(values: string[], headers: RequestEntry[]) {
  if (!values.length) return ''
  return (findHeader(headers, 'content-type') || '').includes('application/x-www-form-urlencoded') ? values.join('&') : values.join('\n')
}

function detectBodyType(body: string, headers: RequestEntry[], isForm: boolean): RequestBodyType {
  if (!body) return 'none'
  const contentType = (findHeader(headers, 'content-type') || '').toLowerCase()
  if (isForm || contentType.includes('multipart/form-data')) return 'form-data'
  if (contentType.includes('application/x-www-form-urlencoded')) return 'x-www-form-urlencoded'
  if (contentType.includes('json') || /^[\[{]/.test(body.trim())) return 'json'
  if (contentType.includes('xml') || /^</.test(body.trim())) return 'xml'
  return 'text'
}

function findHeader(headers: RequestEntry[], key: string) {
  return headers.find((header) => header.key.toLowerCase() === key)?.value
}

function findBearer(headers: RequestEntry[]) {
  return /^bearer\s+(.+)$/i.exec(findHeader(headers, 'authorization') || '')?.[1]
}

function parseBasicAuth(value: string): ParsedCurlRequest['auth'] {
  const index = value.indexOf(':')
  return index < 0
    ? { type: 'basic', username: value, password: '' }
    : { type: 'basic', username: value.slice(0, index), password: value.slice(index + 1) }
}
