import http from 'node:http'
import https from 'node:https'
import { URL } from 'node:url'
import type { ConnectionInput, ConnectionProfile, EsRequestOptions, EsResponse } from '../types'
import { getActiveConnection, getConnection } from './connectionStore'

function normalizeProfile(input: ConnectionInput | ConnectionProfile): ConnectionProfile {
  const now = new Date().toISOString()
  return {
    _id: '_id' in input && input._id ? input._id : 'transient',
    name: input.name?.trim() || '临时连接',
    baseUrl: input.baseUrl.trim().replace(/\/+$/, ''),
    authType: input.authType,
    username: input.authType === 'basic' ? input.username?.trim() || '' : undefined,
    password: input.authType === 'basic' ? input.password ?? '' : undefined,
    apiKey: input.authType === 'apiKey' ? input.apiKey ?? '' : undefined,
    rejectUnauthorized: input.rejectUnauthorized ?? true,
    createdAt: '_id' in input && 'createdAt' in input ? input.createdAt : now,
    updatedAt: now,
  }
}

function buildAuthHeader(profile: ConnectionProfile): string | undefined {
  if (profile.authType === 'basic') {
    const user = profile.username ?? ''
    const pass = profile.password ?? ''
    const token = Buffer.from(`${user}:${pass}`, 'utf8').toString('base64')
    return `Basic ${token}`
  }
  if (profile.authType === 'apiKey') {
    const key = (profile.apiKey ?? '').trim()
    if (!key) return undefined
    if (key.includes(':')) {
      return `ApiKey ${Buffer.from(key, 'utf8').toString('base64')}`
    }
    return `ApiKey ${key}`
  }
  return undefined
}

function joinUrl(baseUrl: string, path: string, query?: EsRequestOptions['query']): string {
  const base = baseUrl.replace(/\/+$/, '')
  const p = path.startsWith('/') ? path : `/${path}`
  const u = new URL(base + p)
  if (query) {
    for (const [k, v] of Object.entries(query)) {
      if (v === undefined) continue
      u.searchParams.set(k, String(v))
    }
  }
  return u.toString()
}

function parseBody(rawText: string): unknown {
  if (!rawText) return null
  try {
    return JSON.parse(rawText)
  } catch {
    return rawText
  }
}

function extractEsError(status: number, body: unknown, fallback: string): EsResponse['error'] {
  if (body && typeof body === 'object') {
    const err = (body as { error?: { type?: string; reason?: string; root_cause?: Array<{ reason?: string }> } }).error
    if (err) {
      return {
        message: err.reason || err.type || fallback,
        type: err.type,
        reason: err.reason ?? err.root_cause?.[0]?.reason,
      }
    }
  }
  if (status >= 400) {
    return { message: fallback }
  }
  return undefined
}

export type EsRequestWithProfile = EsRequestOptions & {
  profile?: ConnectionInput | ConnectionProfile
}

export async function esRequest(options: EsRequestWithProfile): Promise<EsResponse> {
  let profile: ConnectionProfile | null = null
  if (options.profile) {
    profile = normalizeProfile(options.profile)
  } else if (options.connectionId) {
    profile = await getConnection(options.connectionId)
  } else {
    profile = await getActiveConnection()
  }

  if (!profile) {
    return {
      ok: false,
      status: 0,
      headers: {},
      body: null,
      rawText: '',
      error: { message: '未选择连接，请先在「连接」页添加并激活' },
    }
  }

  try {
    // eslint-disable-next-line no-new
    new URL(profile.baseUrl)
  } catch {
    return {
      ok: false,
      status: 0,
      headers: {},
      body: null,
      rawText: '',
      error: { message: 'Base URL 无效' },
    }
  }

  const url = joinUrl(profile.baseUrl, options.path, options.query)
  const method = (options.method || 'GET').toUpperCase()
  const headers: Record<string, string> = {
    Accept: 'application/json',
  }
  const auth = buildAuthHeader(profile)
  if (auth) headers.Authorization = auth

  let bodyText: string | undefined
  // ES Dev Tools / _search commonly use GET with a JSON body; HEAD never has a body.
  if (options.body !== undefined && options.body !== null && method !== 'HEAD') {
    bodyText = typeof options.body === 'string' ? options.body : JSON.stringify(options.body)
    headers['Content-Type'] = 'application/json'
    headers['Content-Length'] = Buffer.byteLength(bodyText).toString()
  }

  const timeoutMs = options.timeoutMs ?? 30_000
  const parsed = new URL(url)
  const isHttps = parsed.protocol === 'https:'
  const lib = isHttps ? https : http

  return new Promise((resolve) => {
    const req = lib.request(
      {
        protocol: parsed.protocol,
        hostname: parsed.hostname,
        port: parsed.port || (isHttps ? 443 : 80),
        path: parsed.pathname + parsed.search,
        method,
        headers,
        rejectUnauthorized: profile!.rejectUnauthorized,
        timeout: timeoutMs,
      },
      (res) => {
        const chunks: Buffer[] = []
        res.on('data', (c) => chunks.push(Buffer.isBuffer(c) ? c : Buffer.from(c)))
        res.on('end', () => {
          const rawText = Buffer.concat(chunks).toString('utf8')
          const body = parseBody(rawText)
          const status = res.statusCode ?? 0
          const respHeaders: Record<string, string> = {}
          for (const [k, v] of Object.entries(res.headers)) {
            if (typeof v === 'string') respHeaders[k] = v
            else if (Array.isArray(v)) respHeaders[k] = v.join(', ')
          }
          const ok = status >= 200 && status < 300
          resolve({
            ok,
            status,
            headers: respHeaders,
            body,
            rawText,
            error: extractEsError(status, body, `HTTP ${status}`),
          })
        })
      },
    )

    req.on('timeout', () => {
      req.destroy()
      resolve({
        ok: false,
        status: 0,
        headers: {},
        body: null,
        rawText: '',
        error: { message: `请求超时（${timeoutMs}ms）` },
      })
    })

    req.on('error', (err) => {
      const msg = err.message || String(err)
      const friendly =
        /certificate|UNABLE_TO_VERIFY|self.signed/i.test(msg)
          ? `TLS 证书错误：${msg}。可在连接中关闭「校验证书」后重试。`
          : /ECONNREFUSED/i.test(msg)
            ? `无法连接：${profile!.baseUrl}`
            : msg
      resolve({
        ok: false,
        status: 0,
        headers: {},
        body: null,
        rawText: '',
        error: { message: friendly },
      })
    })

    if (bodyText) req.write(bodyText)
    req.end()
  })
}
