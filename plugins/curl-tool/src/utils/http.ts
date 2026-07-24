import type { ParsedCurlRequest, RequestBodyType, RequestEntry, ResponseState } from './curl/types'
import { normalizeUrl } from './curl/parser'

export interface SendPayload {
  request: ParsedCurlRequest
  bodyType: RequestBodyType
  formEntries: RequestEntry[]
  binaryFile?: File | null
}

interface RequestOptions {
  method: string
  url: string
  headers: Record<string, string>
  body?: string
  bodyBase64?: string
  insecure: boolean
  timeoutMs: number
}

export async function sendHttpRequest(payload: SendPayload): Promise<ResponseState> {
  const options = await createServiceOptions(payload)
  const services = (window as any).services
  if (services?.sendHttpRequest) return services.sendHttpRequest(options)

  const response = await fetch('/__curl_tool_proxy', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(options)
  })
  const json = await response.json()
  if (!response.ok) throw new Error(json.error || '请求失败')
  return json
}

export async function createServiceOptions({ request, bodyType, formEntries, binaryFile }: SendPayload) {
  const headers = entriesToHeaders(request.headers)
  const cookies = entriesToCookie(request.cookies)
  if (cookies && !hasHeader(headers, 'cookie')) headers.cookie = cookies

  if (request.auth?.type === 'basic' && request.auth.username) {
    headers.authorization = `Basic ${btoa(`${request.auth.username}:${request.auth.password || ''}`)}`
  } else if (request.auth?.type === 'bearer' && request.auth.token) {
    headers.authorization = `Bearer ${request.auth.token}`
  }

  const bodyPayload = await buildBody(bodyType, request.body, formEntries, headers, binaryFile)
  return {
    method: request.method,
    url: buildUrl(request),
    headers,
    ...bodyPayload,
    insecure: request.options.insecure,
    timeoutMs: request.options.timeoutMs || 30000
  } satisfies RequestOptions
}

export function buildUrl(request: ParsedCurlRequest) {
  const normalized = normalizeUrl(request.baseUrl || request.url)
  const url = new URL(normalized)
  request.queryParams.filter((item) => item.enabled && item.key).forEach((item) => url.searchParams.set(item.key, item.value))
  return url.toString()
}

function entriesToHeaders(entries: RequestEntry[]) {
  return entries.filter((item) => item.enabled && item.key).reduce<Record<string, string>>((headers, item) => {
    headers[item.key] = item.value
    return headers
  }, {})
}

function entriesToCookie(entries: RequestEntry[]) {
  return entries
    .filter((item) => item.enabled && item.key)
    .map((item) => `${item.key}=${item.value}`)
    .join('; ')
}

async function buildBody(
  bodyType: RequestBodyType,
  rawBody: string,
  formEntries: RequestEntry[],
  headers: Record<string, string>,
  binaryFile?: File | null
) {
  if (bodyType === 'none') return {}
  if (bodyType === 'x-www-form-urlencoded') {
    setHeaderIfMissing(headers, 'content-type', 'application/x-www-form-urlencoded; charset=utf-8')
    return { body: new URLSearchParams(enabledPairs(formEntries)).toString() }
  }
  if (bodyType === 'form-data') {
    const boundary = `----CurlTool${Date.now().toString(16)}`
    setHeaderIfMissing(headers, 'content-type', `multipart/form-data; boundary=${boundary}`)
    return { bodyBase64: await buildMultipartBody(formEntries, boundary) }
  }
  if (bodyType === 'binary' && binaryFile) {
    setHeaderIfMissing(headers, 'content-type', binaryFile.type || 'application/octet-stream')
    return { bodyBase64: await fileToBase64(binaryFile) }
  }
  if (bodyType === 'json') setHeaderIfMissing(headers, 'content-type', 'application/json; charset=utf-8')
  if (bodyType === 'xml') setHeaderIfMissing(headers, 'content-type', 'application/xml; charset=utf-8')
  if (bodyType === 'text') setHeaderIfMissing(headers, 'content-type', 'text/plain; charset=utf-8')
  return { body: rawBody }
}

function enabledPairs(entries: RequestEntry[]) {
  return entries.filter((item) => item.enabled && item.key).map((item) => [item.key, item.value] as [string, string])
}

function hasHeader(headers: Record<string, string>, key: string) {
  return Object.keys(headers).some((headerKey) => headerKey.toLowerCase() === key)
}

function setHeaderIfMissing(headers: Record<string, string>, key: string, value: string) {
  if (!hasHeader(headers, key)) headers[key] = value
}

function escapeName(value: string) {
  return value.replace(/"/g, '\\"')
}

async function buildMultipartBody(entries: RequestEntry[], boundary: string) {
  const encoder = new TextEncoder()
  const chunks: Uint8Array[] = []

  for (const entry of entries.filter((item) => item.enabled && item.key)) {
    if (entry.valueType === 'file' && entry.file) {
      const contentType = entry.file.type || 'application/octet-stream'
      chunks.push(
        encoder.encode(
          `--${boundary}\r\nContent-Disposition: form-data; name="${escapeName(entry.key)}"; filename="${escapeName(entry.file.name)}"\r\nContent-Type: ${contentType}\r\n\r\n`
        ),
        new Uint8Array(await entry.file.arrayBuffer()),
        encoder.encode('\r\n')
      )
    } else {
      chunks.push(
        encoder.encode(
          `--${boundary}\r\nContent-Disposition: form-data; name="${escapeName(entry.key)}"\r\n\r\n${entry.value}\r\n`
        )
      )
    }
  }

  chunks.push(encoder.encode(`--${boundary}--\r\n`))
  return bytesToBase64(concatBytes(chunks))
}

async function fileToBase64(file: File) {
  return bytesToBase64(new Uint8Array(await file.arrayBuffer()))
}

function concatBytes(chunks: Uint8Array[]) {
  const size = chunks.reduce((total, chunk) => total + chunk.byteLength, 0)
  const bytes = new Uint8Array(size)
  let offset = 0
  for (const chunk of chunks) {
    bytes.set(chunk, offset)
    offset += chunk.byteLength
  }
  return bytes
}

function bytesToBase64(bytes: Uint8Array) {
  let binary = ''
  const chunkSize = 0x8000
  for (let index = 0; index < bytes.length; index += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(index, index + chunkSize))
  }
  return btoa(binary)
}
