import { reactive } from 'vue'

export type LegacyBodyType = 'none' | 'json' | 'formdata' | 'urlencoded' | 'raw'
export type BodyKind = 'none' | 'text' | 'structured' | 'binary' | 'other'

export interface BodyFormDataField {
  key: string
  value: string
  enabled: boolean
  isFile: boolean
  fileToken?: string
}

export interface RequestBodyState {
  // legacy compatibility field for persisted data
  type: LegacyBodyType
  kind: BodyKind
  contentType: string
  raw: string
  formData: BodyFormDataField[]
  binary: {
    fileToken?: string
    fileName?: string
    fileSize?: number
    fileType?: string
  }
}

export interface RequestState {
  method: string
  url: string
  params: Array<{ key: string; value: string; enabled: boolean }>
  headers: Array<{ key: string; value: string; enabled: boolean }>
  auth: {
    type: 'none' | 'bearer' | 'basic' | 'apikey' | 'jwt-bearer' | 'digest'
    token: string
    username: string
    password: string
    apiKey: string
    apiKeyLocation: 'header' | 'query'
    apiKeyHeader: string
    jwtSecret: string
    jwtAlgorithm: 'HS256' | 'HS384' | 'HS512'
    jwtHeaderPrefix: string
    jwtHeader: string
    jwtPayload: string
    jwtAutoIat: boolean
    jwtAutoExp: boolean
    jwtExpSeconds: string
    digestUsername: string
    digestPassword: string
    digestAlgorithm: 'MD5' | 'MD5-sess' | 'SHA-256' | 'SHA-256-sess'
  }
  body: RequestBodyState
  cookiePolicy: {
    mode: 'inherit' | 'enable' | 'disable'
  }
  socket: {
    status: 'disconnected' | 'connecting' | 'connected'
    messages: Array<{ id: string; type: 'sent' | 'received' | 'system'; data: string; time: number }>
    messageType: 'Text' | 'JSON' | 'Binary'
  }
}

export interface ResponseState {
  status: number | null
  statusText: string
  time: number | null
  size: number | null
  headers: Record<string, string>
  headersRaw: Array<{ name: string; value: string }>
  body: string
  raw: string
  error: string | null
  contentType: string
  isBinary: boolean
  base64Body: string | null
  fileName: string | null
}

const defaultRequest: RequestState = {
  method: 'GET',
  url: '',
  params: [],
  headers: [],
  auth: {
    type: 'none',
    token: '',
    username: '',
    password: '',
    apiKey: '',
    apiKeyLocation: 'header',
    apiKeyHeader: 'X-API-Key',
    jwtSecret: '',
    jwtAlgorithm: 'HS256',
    jwtHeaderPrefix: 'Bearer',
    jwtHeader: '{"alg":"HS256","typ":"JWT"}',
    jwtPayload: '{}',
    jwtAutoIat: true,
    jwtAutoExp: false,
    jwtExpSeconds: '3600',
    digestUsername: '',
    digestPassword: '',
    digestAlgorithm: 'MD5'
  },
  body: {
    type: 'none',
    kind: 'none',
    contentType: '',
    raw: '',
    formData: [],
    binary: {}
  },
  cookiePolicy: {
    mode: 'inherit'
  },
  socket: {
    status: 'disconnected',
    messages: [],
    messageType: 'Text'
  }
}

const defaultResponse: ResponseState = {
  status: null,
  statusText: '',
  time: null,
  size: null,
  headers: {},
  headersRaw: [],
  body: '',
  raw: '',
  error: null,
  contentType: '',
  isBinary: false,
  base64Body: null,
  fileName: null
}

const request = reactive<RequestState>({ ...defaultRequest })
const response = reactive<ResponseState>({ ...defaultResponse })

function cloneState<T>(state: T): T {
  return JSON.parse(JSON.stringify(state)) as T
}

function isTextContentType(contentType: string): boolean {
  const textTypes = [
    'application/xml',
    'text/xml',
    'application/ld+json',
    'application/hal+json',
    'application/vnd.api+json'
  ]
  return textTypes.includes(contentType)
}

function inferBodyFromLegacy(
  body: Partial<RequestBodyState> | undefined
): Pick<RequestBodyState, 'type' | 'kind' | 'contentType'> {
  const legacyType = body?.type ?? 'none'

  if (legacyType === 'json') {
    return {
      type: 'json',
      kind: 'text',
      contentType: body?.contentType || 'application/json'
    }
  }

  if (legacyType === 'raw') {
    const guessed = body?.contentType || 'text/plain'
    const isBinary = guessed === 'application/octet-stream'
    const kind: BodyKind = isBinary ? 'binary' : (isTextContentType(guessed) ? 'text' : 'other')
    return {
      type: 'raw',
      kind,
      contentType: guessed
    }
  }

  if (legacyType === 'urlencoded') {
    return {
      type: 'urlencoded',
      kind: 'structured',
      contentType: 'application/x-www-form-urlencoded'
    }
  }

  if (legacyType === 'formdata') {
    return {
      type: 'formdata',
      kind: 'structured',
      contentType: 'multipart/form-data'
    }
  }

  return {
    type: 'none',
    kind: 'none',
    contentType: ''
  }
}

function inferLegacyTypeFromUnified(kind: BodyKind, contentType: string): LegacyBodyType {
  if (kind === 'none') {
    return 'none'
  }
  if (kind === 'structured') {
    return contentType === 'multipart/form-data' ? 'formdata' : 'urlencoded'
  }
  if (kind === 'text' && contentType === 'application/json') {
    return 'json'
  }
  return 'raw'
}

function normalizeBodyState(body: Partial<RequestBodyState> | undefined): RequestBodyState {
  const merged = {
    ...defaultRequest.body,
    ...body,
    binary: {
      ...defaultRequest.body.binary,
      ...body?.binary
    }
  }

  const hasUnified = typeof body?.kind === 'string'
  const resolved = hasUnified
    ? {
      type: inferLegacyTypeFromUnified(merged.kind, merged.contentType),
      kind: merged.kind,
      contentType: merged.contentType
    }
    : inferBodyFromLegacy(body)

  return {
    ...merged,
    ...resolved,
    formData: body?.formData ? cloneState(body.formData) : []
  }
}

function normalizeRequestState(data: Partial<RequestState>): RequestState {
  return {
    ...defaultRequest,
    ...data,
    auth: {
      ...defaultRequest.auth,
      ...data.auth
    },
    body: {
      ...normalizeBodyState(data.body)
    },
    cookiePolicy: {
      ...defaultRequest.cookiePolicy,
      ...data.cookiePolicy
    },
    params: data.params ? cloneState(data.params) : [],
    headers: data.headers ? cloneState(data.headers) : [],
    socket: {
      ...defaultRequest.socket,
      ...data.socket,
      messages: data.socket?.messages ? cloneState(data.socket.messages) : []
    }
  }
}

export function useRequestStore(): {
  request: RequestState
  response: ResponseState
  setRequest: (data: Partial<RequestState>) => void
  loadRequest: (data: RequestState) => void
  resetRequest: () => void
  setResponse: (data: Partial<ResponseState>) => void
  resetResponse: () => void
  getRequestSnapshot: () => RequestState
} {
  function setRequest(data: Partial<RequestState>): void {
    Object.assign(request, normalizeRequestState({ ...request, ...data }))
  }

  function loadRequest(data: RequestState): void {
    Object.assign(request, normalizeRequestState(cloneState(data)))
  }

  function resetRequest(): void {
    Object.assign(request, cloneState(defaultRequest))
  }

  function setResponse(data: Partial<ResponseState>): void {
    Object.assign(response, data)
  }

  function resetResponse(): void {
    Object.assign(response, cloneState(defaultResponse))
  }

  function getRequestSnapshot(): RequestState {
    return JSON.parse(JSON.stringify(request))
  }

  return {
    request,
    response,
    setRequest,
    loadRequest,
    resetRequest,
    setResponse,
    resetResponse,
    getRequestSnapshot
  }
}
