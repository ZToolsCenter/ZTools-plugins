export type AuthType = 'none' | 'basic' | 'apiKey'

export type ConnectionProfile = {
  _id: string
  _rev?: string
  name: string
  baseUrl: string
  authType: AuthType
  username?: string
  password?: string
  apiKey?: string
  rejectUnauthorized: boolean
  createdAt: string
  updatedAt: string
}

export type ConnectionInput = {
  name: string
  baseUrl: string
  authType: AuthType
  username?: string
  password?: string
  apiKey?: string
  rejectUnauthorized?: boolean
}

export type SettingsDoc = {
  _id: 'settings'
  activeConnectionId: string | null
}

export type EsRequestOptions = {
  method: string
  path: string
  query?: Record<string, string | number | boolean | undefined>
  body?: unknown
  connectionId?: string
  timeoutMs?: number
}

export type EsResponse = {
  ok: boolean
  status: number
  headers: Record<string, string>
  body: unknown
  rawText: string
  error?: {
    message: string
    type?: string
    reason?: string
  }
}

export type DslIssue = {
  severity: 'error' | 'warning'
  message: string
  path?: string
}

export type MappingField = {
  path: string
  type: string
}
