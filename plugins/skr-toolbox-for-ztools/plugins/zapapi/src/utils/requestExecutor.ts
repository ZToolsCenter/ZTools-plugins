import type { RequestState } from '../store/request'
import { resolveVariables } from './variableResolver'
import { normalizeHttpUrl } from './urlNormalizer'
import { createJwtToken } from './jwt'
import { createDigestAuthorization } from './digestAuth'
import { getFormDataFile } from './formDataFileStore'
import { useSettingsStore } from '../store/settings'

export interface SendResult {
  status: number
  statusText: string
  headers: Record<string, string>
  headersRaw: Array<{ name: string; value: string }>
  body: string
  raw: string
  base64Body: string | null
  contentType: string
  isBinary: boolean
  fileName: string | null
  time: number
  size: number
  error: string | null
}

export interface SendController {
  cancel: () => void
  promise: Promise<SendResult>
}

interface PreloadHttpResponsePayload {
  status: number
  statusText: string
  headersRaw: Array<{ name: string; value: string }>
  bodyBase64: string
  time: number
}

interface EncodedBodyPayload {
  bodyBase64?: string
  contentTypeOverride?: string
}

const REQUEST_TIMEOUT_MS = 15000
const MAX_REDIRECTS = 5

function getQuerySeparator(url: string): string {
  return url.includes('?') ? '&' : '?'
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = ''
  for (let i = 0; i < bytes.length; i += 1) {
    binary += String.fromCharCode(bytes[i])
  }
  return btoa(binary)
}

function base64ToBytes(base64Value: string): Uint8Array {
  try {
    // Some endpoints or integrations might return padding-less or spaced base64
    let cleaned = base64Value.replace(/[^A-Za-z0-9+/=]/g, '')
    const pad = cleaned.length % 4
    if (pad) {
      cleaned += '='.repeat(4 - pad)
    }
    const binary = atob(cleaned)
    const bytes = new Uint8Array(binary.length)
    for (let i = 0; i < binary.length; i += 1) {
      bytes[i] = binary.charCodeAt(i)
    }
    return bytes
  } catch (e) {
    console.warn('Failed to decode base64 body, fallback to empty array', e)
    return new Uint8Array(0)
  }
}

function parseContentDispositionFileName(contentDisposition: string): string | null {
  const utf8Match = /filename\*=UTF-8''([^;]+)/i.exec(contentDisposition)
  if (utf8Match && utf8Match[1]) {
    return decodeURIComponent(utf8Match[1].replace(/"/g, ''))
  }

  const normalMatch = /filename="?([^";]+)"?/i.exec(contentDisposition)
  if (normalMatch && normalMatch[1]) {
    return normalMatch[1]
  }

  return null
}

function isLikelyBinaryContent(contentType: string): boolean {
  const lowered = contentType.toLowerCase()
  if (!lowered) {
    return false
  }
  if (lowered.startsWith('text/')) {
    return false
  }
  if (lowered.includes('json') || lowered.includes('xml') || lowered.includes('javascript')) {
    return false
  }
  return true
}

function resolveBodyKind(req: RequestState): 'none' | 'text' | 'structured' | 'binary' | 'other' {
  if (req.body.kind) {
    return req.body.kind
  }
  if (req.body.type === 'none') {
    return 'none'
  }
  if (req.body.type === 'urlencoded' || req.body.type === 'formdata') {
    return 'structured'
  }
  if (req.body.type === 'json') {
    return 'text'
  }
  return 'other'
}

function resolveBodyContentType(req: RequestState): string {
  if (req.body.contentType) {
    return req.body.contentType
  }
  if (req.body.type === 'json') {
    return 'application/json'
  }
  if (req.body.type === 'urlencoded') {
    return 'application/x-www-form-urlencoded'
  }
  if (req.body.type === 'formdata') {
    return 'multipart/form-data'
  }
  return ''
}

function buildUrl(req: RequestState, variables: Record<string, string>): string {
  const normalized = normalizeHttpUrl(req.url, variables)
  if (!normalized.ok) {
    throw new Error(normalized.reason === 'unsupported_protocol' ? 'Only HTTP/HTTPS URLs are supported' : 'Invalid URL')
  }

  let url = normalized.url
  const enabledParams = req.params.filter((p) => p.enabled && p.key)
  if (enabledParams.length > 0) {
    const query = enabledParams
      .map((p) => `${encodeURIComponent(resolveVariables(p.key, variables))}=${encodeURIComponent(resolveVariables(p.value, variables))}`)
      .join('&')
    url += `${getQuerySeparator(url)}${query}`
  }

  if (req.auth.type === 'apikey' && req.auth.apiKeyLocation === 'query' && req.auth.apiKey) {
    const sep = getQuerySeparator(url)
    url += `${sep}${req.auth.apiKeyHeader || 'api_key'}=${resolveVariables(req.auth.apiKey, variables)}`
  }

  return url
}

function setHeaderCaseInsensitive(headers: Record<string, string>, name: string, value: string): void {
  const existingKey = Object.keys(headers).find((key) => key.toLowerCase() === name.toLowerCase())
  if (existingKey) {
    headers[existingKey] = value
    return
  }
  headers[name] = value
}

function buildHeaders(req: RequestState, variables: Record<string, string>): Record<string, string> {
  const headers: Record<string, string> = {}

  if (req.auth.type === 'bearer' && req.auth.token) {
    headers.Authorization = `Bearer ${resolveVariables(req.auth.token, variables)}`
  } else if (req.auth.type === 'basic' && req.auth.username) {
    const encoded = btoa(`${resolveVariables(req.auth.username, variables)}:${resolveVariables(req.auth.password, variables)}`)
    headers.Authorization = `Basic ${encoded}`
  } else if (req.auth.type === 'apikey' && req.auth.apiKeyLocation === 'header') {
    headers[req.auth.apiKeyHeader || 'X-API-Key'] = resolveVariables(req.auth.apiKey, variables)
  }

  req.headers
    .filter((h) => h.enabled && h.key)
    .forEach((h) => {
      headers[resolveVariables(h.key, variables)] = resolveVariables(h.value, variables)
    })

  const bodyKind = resolveBodyKind(req)
  const bodyContentType = resolveBodyContentType(req)
  const hasContentType = Object.keys(headers).some((key) => key.toLowerCase() === 'content-type')
  if (!hasContentType && bodyKind !== 'none' && bodyContentType && bodyContentType !== 'multipart/form-data') {
    headers['Content-Type'] = bodyContentType
  }

  return headers
}

async function injectJwtBearerHeader(req: RequestState, headers: Record<string, string>, variables: Record<string, string>): Promise<void> {
  if (req.auth.type !== 'jwt-bearer') return

  const token = await createJwtToken({
    algorithm: req.auth.jwtAlgorithm,
    headerJson: resolveVariables(req.auth.jwtHeader, variables),
    payloadJson: resolveVariables(req.auth.jwtPayload, variables),
    secret: resolveVariables(req.auth.jwtSecret, variables),
    autoIat: req.auth.jwtAutoIat,
    autoExp: req.auth.jwtAutoExp,
    expSeconds: resolveVariables(req.auth.jwtExpSeconds, variables)
  })
  const prefix = resolveVariables(req.auth.jwtHeaderPrefix, variables).trim() || 'Bearer'
  headers.Authorization = `${prefix} ${token}`
}

async function buildMultipartBody(req: RequestState, variables: Record<string, string>): Promise<EncodedBodyPayload> {
  const boundary = `----zapapi-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
  const encoder = new TextEncoder()
  const chunks: Uint8Array[] = []

  const pushText = (text: string) => {
    chunks.push(encoder.encode(text))
  }

  for (const field of req.body.formData || []) {
    if (!field.enabled || !field.key) continue
    const key = resolveVariables(field.key, variables)
    pushText(`--${boundary}\r\n`)

    if (field.isFile) {
      const file = getFormDataFile(field.fileToken)
      if (!file) {
        throw new Error(`Missing file for form-data field: ${key}`)
      }
      const fileName = file.name || 'file'
      const mime = file.type || 'application/octet-stream'
      pushText(`Content-Disposition: form-data; name="${key}"; filename="${fileName}"\r\n`)
      pushText(`Content-Type: ${mime}\r\n\r\n`)
      chunks.push(new Uint8Array(await file.arrayBuffer()))
      pushText('\r\n')
    } else {
      pushText(`Content-Disposition: form-data; name="${key}"\r\n\r\n`)
      pushText(resolveVariables(field.value, variables))
      pushText('\r\n')
    }
  }

  pushText(`--${boundary}--\r\n`)
  const totalLength = chunks.reduce((sum, chunk) => sum + chunk.length, 0)
  const merged = new Uint8Array(totalLength)
  let offset = 0
  for (const chunk of chunks) {
    merged.set(chunk, offset)
    offset += chunk.length
  }

  return {
    bodyBase64: bytesToBase64(merged),
    contentTypeOverride: `multipart/form-data; boundary=${boundary}`
  }
}

async function encodeBody(req: RequestState, variables: Record<string, string>): Promise<EncodedBodyPayload> {
  const bodyKind = resolveBodyKind(req)
  const bodyContentType = resolveBodyContentType(req)

  if (bodyKind === 'none') {
    return {}
  }

  if (bodyKind === 'text' || bodyKind === 'other') {
    const text = req.body.raw ? resolveVariables(req.body.raw, variables) : ''
    if (!text) {
      return {}
    }
    return { bodyBase64: bytesToBase64(new TextEncoder().encode(text)) }
  }

  if (bodyKind === 'binary') {
    const file = getFormDataFile(req.body.binary.fileToken)
    if (!file) {
      throw new Error('Missing binary file for request body')
    }
    return { bodyBase64: bytesToBase64(new Uint8Array(await file.arrayBuffer())) }
  }

  if (bodyKind === 'structured') {
    if (bodyContentType === 'multipart/form-data' || req.body.type === 'formdata') {
      return buildMultipartBody(req, variables)
    }

    const params = new URLSearchParams()
    for (const f of req.body.formData || []) {
      if (f.enabled && f.key) {
        params.append(resolveVariables(f.key, variables), resolveVariables(f.value, variables))
      }
    }
    const encoded = params.toString()
    if (!encoded) return {}
    return { bodyBase64: bytesToBase64(new TextEncoder().encode(encoded)) }
  }

  return {}
}

function normalizeRawHeaders(headersRaw: Array<{ name: string; value: string }>): Record<string, string> {
  const result: Record<string, string> = {}
  for (const item of headersRaw) {
    const key = item.name.toLowerCase()
    if (key in result) {
      result[key] = `${result[key]}, ${item.value}`
    } else {
      result[key] = item.value
    }
  }
  return result
}

function decodeBodyFromPreload(base64Body: string, contentType: string): { body: string; base64Body: string | null; isBinary: boolean } {
  if (!base64Body) {
    return { body: '', base64Body: null, isBinary: false }
  }

  if (isLikelyBinaryContent(contentType)) {
    return { body: '[binary data]', base64Body, isBinary: true }
  }

  return {
    body: new TextDecoder().decode(base64ToBytes(base64Body)),
    base64Body: null,
    isBinary: false
  }
}

async function executePreloadRequest(
  method: string,
  url: string,
  headers: Record<string, string>,
  bodyBase64: string | undefined,
  cookieJar: { enabled: boolean; persistSessionCookies: boolean; maxCookies?: number },
  signal?: AbortSignal
): Promise<PreloadHttpResponsePayload> {
  if (!window.services?.sendHttpRequest) {
    const start = performance.now()
    const controller = new AbortController()

    if (signal) {
      signal.addEventListener('abort', () => controller.abort(signal.reason))
      if (signal.aborted) {
        controller.abort(signal.reason)
      }
    }

    // fallback timeout since we don't have native timeout support easily without wrapping
    const timeoutId = setTimeout(() => controller.abort(new Error('Request Timeout')), REQUEST_TIMEOUT_MS)

    try {
      const init: RequestInit = {
        method,
        headers,
        signal: controller.signal
      }

      if (bodyBase64 && method !== 'GET' && method !== 'HEAD') {
        // cast to any to bypass strict TS BlobPart constraints regarding ArrayBufferLike vs ArrayBuffer
        init.body = new Blob([base64ToBytes(bodyBase64) as any])
      }

      let fetchUrl = url
      const isDev = import.meta.env.DEV
      const isLocalhost = typeof window !== 'undefined' &&
        (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1')

      if (isLocalhost) {
        fetchUrl = '/__cors_proxy'
        const proxyHeaders = init.headers as Record<string, string>
        proxyHeaders['x-target-url'] = url
      }

      const response = await fetch(fetchUrl, init)
      const end = performance.now()

      const headersRaw: Array<{ name: string; value: string }> = []
      response.headers.forEach((value, name) => {
        headersRaw.push({ name, value })
      })

      const bodyBuffer = await response.arrayBuffer()
      const bodyBase64Result = bytesToBase64(new Uint8Array(bodyBuffer))

      return {
        status: response.status,
        statusText: response.statusText,
        headersRaw,
        bodyBase64: bodyBase64Result,
        time: Math.round(end - start)
      }
    } finally {
      clearTimeout(timeoutId)
    }
  }

  return new Promise((resolve, reject) => {
    let accumulatedBase64 = ''
    window.services.sendHttpRequest({
      method,
      url,
      headers: Object.entries(headers).map(([name, value]) => ({ name, value })),
      bodyBase64,
      bodyMode: 'base64',
      timeoutMs: REQUEST_TIMEOUT_MS,
      maxRedirects: MAX_REDIRECTS,
      cookieJar,
      onChunk: (chunk: string) => {
        accumulatedBase64 += chunk
      }
    }).then((res: any) => {
      res.bodyBase64 = accumulatedBase64 + (res.bodyBase64 || '')
      resolve(res)
    }).catch(reject)
  })
}

async function executeSingleAttempt(req: RequestState, variables: Record<string, string>, externalSignal: AbortSignal): Promise<SendResult> {
  const startTime = performance.now()
  const url = buildUrl(req, variables)
  const headers = buildHeaders(req, variables)
  await injectJwtBearerHeader(req, headers, variables)
  const bodyPayload = await encodeBody(req, variables)

  if (bodyPayload.contentTypeOverride) {
    setHeaderCaseInsensitive(headers, 'Content-Type', bodyPayload.contentTypeOverride)
  }

  const settingsStore = useSettingsStore()
  const cookieJar = {
    enabled: req.cookiePolicy.mode === 'enable' || (req.cookiePolicy.mode === 'inherit' && settingsStore.isCookiesEnabled()),
    persistSessionCookies: settingsStore.shouldPersistSessionCookies(),
    maxCookies: 2000
  }

  if (req.auth.type === 'digest' && (!req.auth.digestUsername || !req.auth.digestPassword)) {
    throw new Error('Digest auth requires username and password')
  }

  try {
    if (externalSignal.aborted) {
      throw new DOMException('Request canceled', 'AbortError')
    }

    let response = await executePreloadRequest(req.method, url, headers, bodyPayload.bodyBase64, cookieJar, externalSignal)
    const responseHeaders = normalizeRawHeaders(response.headersRaw)

    if (req.auth.type === 'digest' && response.status === 401) {
      const challengeHeader = responseHeaders['www-authenticate'] || ''
      if (/^Digest\s+/i.test(challengeHeader)) {
        const digestAuth = await createDigestAuthorization({
          challengeHeader,
          method: req.method,
          requestUrl: url,
          username: resolveVariables(req.auth.digestUsername, variables),
          password: resolveVariables(req.auth.digestPassword, variables),
          algorithm: req.auth.digestAlgorithm
        })

        response = await executePreloadRequest(
          req.method,
          url,
          { ...headers, Authorization: digestAuth },
          bodyPayload.bodyBase64,
          cookieJar,
          externalSignal
        )
      }
    }

    const normalizedHeaders = normalizeRawHeaders(response.headersRaw)
    const contentType = normalizedHeaders['content-type'] || ''
    const payload = decodeBodyFromPreload(response.bodyBase64, contentType)
    const contentDisposition = normalizedHeaders['content-disposition'] || ''
    const fileName = parseContentDispositionFileName(contentDisposition)
    const size = response.bodyBase64 ? base64ToBytes(response.bodyBase64).byteLength : 0
    const endTime = performance.now()

    return {
      status: response.status,
      statusText: response.statusText,
      headers: normalizedHeaders,
      headersRaw: response.headersRaw,
      body: payload.body,
      raw: payload.isBinary ? '[binary data]' : payload.body,
      base64Body: payload.base64Body,
      contentType,
      isBinary: payload.isBinary,
      fileName,
      time: response.time || Math.round(endTime - startTime),
      size,
      error: null
    }
  } catch (error: unknown) {
    const endTime = performance.now()
    let errorMessage = 'Network error'
    if (externalSignal.aborted) {
      errorMessage = 'Request canceled'
    } else if (error instanceof Error && error.message) {
      errorMessage = error.message
    }

    return {
      status: 0,
      statusText: '',
      headers: {},
      headersRaw: [],
      body: '',
      raw: '',
      base64Body: null,
      contentType: '',
      isBinary: false,
      fileName: null,
      time: Math.round(endTime - startTime),
      size: 0,
      error: errorMessage
    }
  }
}

export function createRequestController(req: RequestState, variables: Record<string, string>): SendController {
  const controller = new AbortController()
  return {
    cancel: () => controller.abort('user-aborted'),
    promise: executeSingleAttempt(req, variables, controller.signal)
  }
}

export async function sendRequest(req: RequestState, variables: Record<string, string>): Promise<SendResult> {
  return createRequestController(req, variables).promise
}
