import { clearShopApiAuth, getShopApiRuntimeConfig } from '../config/runtimeConfig'

export class HttpClientError extends Error {
  status: number
  data: unknown

  constructor(message: string, status: number, data: unknown) {
    super(message)
    this.name = 'HttpClientError'
    this.status = status
    this.data = data
  }
}

interface RequestOptions {
  path: string
  method?: string
  headers?: Record<string, string>
  body?: BodyInit | null
}

function buildRequestUrl(path: string): string {
  const normalizedPath = path.startsWith('/') ? path : `/${path}`
  return `${getShopApiRuntimeConfig().baseUrl}${normalizedPath}`
}

async function parseResponseBody(response: Response): Promise<unknown> {
  if (response.status === 204) {
    return null
  }

  const contentType = response.headers.get('content-type') || ''

  if (contentType.includes('application/json')) {
    try {
      return await response.json()
    } catch {
      return null
    }
  }

  const text = await response.text()
  return text || null
}

function extractResponseMessage(response: Response, data: unknown): string {
  if (typeof data === 'object' && data && 'message' in data && typeof data.message === 'string') {
    return data.message
  }

  if (typeof data === 'string' && data.trim()) {
    return data
  }

  return response.ok ? '请求成功' : `请求失败 (${response.status})`
}

async function request<TResponse>({
  path,
  method = 'GET',
  headers = {},
  body = null,
}: RequestOptions): Promise<TResponse> {
  const runtimeConfig = getShopApiRuntimeConfig()
  const nextHeaders = new Headers(headers)

  if (runtimeConfig.token) {
    nextHeaders.set('Authorization', `Bearer ${runtimeConfig.token}`)
  }

  if (!nextHeaders.has('Accept')) {
    nextHeaders.set('Accept', 'application/json')
  }

  let response: Response
  try {
    response = await fetch(buildRequestUrl(path), {
      method,
      headers: nextHeaders,
      body,
    })
  } catch (error) {
    throw new Error(error instanceof Error ? error.message : '请求失败')
  }

  const data = await parseResponseBody(response)

  if (response.status === 401) {
    clearShopApiAuth()
  }

  if (!response.ok) {
    throw new HttpClientError(extractResponseMessage(response, data), response.status, data)
  }

  return data as TResponse
}

export function requestJson<TResponse, TBody = unknown>(options: {
  path: string
  method?: string
  body?: TBody
  headers?: Record<string, string>
}): Promise<TResponse> {
  return request<TResponse>({
    path: options.path,
    method: options.method,
    headers: {
      'Content-Type': 'application/json',
      ...(options.headers || {}),
    },
    body: options.body === undefined ? null : JSON.stringify(options.body),
  })
}

export function requestFormData<TResponse>(options: {
  path: string
  method?: string
  body: FormData
  headers?: Record<string, string>
}): Promise<TResponse> {
  return request<TResponse>({
    path: options.path,
    method: options.method,
    headers: options.headers,
    body: options.body,
  })
}
