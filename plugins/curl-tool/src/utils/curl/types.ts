export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE' | 'HEAD' | 'OPTIONS'

export type RequestBodyType =
  | 'none'
  | 'form-data'
  | 'x-www-form-urlencoded'
  | 'json'
  | 'xml'
  | 'text'
  | 'binary'

export interface RequestEntry {
  id: string
  enabled: boolean
  key: string
  value: string
  file?: File
  valueType?: 'string' | 'integer' | 'boolean' | 'number' | 'file' | 'array'
}

export interface CurlAuth {
  type: 'basic' | 'bearer'
  username?: string
  password?: string
  token?: string
}

export interface CurlRequestOptions {
  compressed: boolean
  insecure: boolean
  followRedirects: boolean
  timeoutMs?: number
}

export interface ParsedCurlRequest {
  method: HttpMethod
  url: string
  baseUrl: string
  queryParams: RequestEntry[]
  headers: RequestEntry[]
  cookies: RequestEntry[]
  body: string
  bodyType: RequestBodyType
  auth?: CurlAuth
  options: CurlRequestOptions
  rawCommand: string
  warnings: string[]
}

export interface CurlParseResult {
  ok: boolean
  request?: ParsedCurlRequest
  error?: string
  warnings: string[]
}

export interface HistoryItem {
  id: string
  title: string
  method: string
  url: string
  subtitle: string
  command: string
  createdAt: number
}

export interface ResponseState {
  status: number
  statusText: string
  duration: number
  size: number
  headers: RequestEntry[]
  contentType: string
  body: string
  bodyBase64: string
}
