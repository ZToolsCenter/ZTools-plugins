import { describe, expect, test, beforeEach, afterEach } from 'bun:test'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const {
  parseProxyUrl,
  parseNoProxyList,
  shouldBypassProxy,
  clearProxyCache,
  getResolvedProxy,
  getProxyStatus,
  resolveProxySettings,
  WEB_FETCH_ERROR_CODES,
  assertResponseBodySize,
  decodeBody
}: {
  parseProxyUrl: (raw: string) => {
    protocol: string
    host: string
    port: number
    auth: string | null
    href: string
    kind: 'http' | 'socks'
  } | null
  parseNoProxyList: (raw: string) => string[]
  shouldBypassProxy: (hostname: string, noProxyList: string[] | string) => boolean
  clearProxyCache: () => void
  getResolvedProxy: () => string | null
  getProxyStatus: () => {
    proxy: string | null
    source: string | null
    noProxy: string[]
    socksOnly: boolean
    raw: string | null
  }
  resolveProxySettings: (forceRefresh?: boolean) => {
    proxy: { href: string; kind: string } | null
    source: string | null
    noProxy: string[]
  }
  WEB_FETCH_ERROR_CODES: Record<string, string>
  assertResponseBodySize: (receivedBytes: number, maxBytes: number) => void
  decodeBody: (buffer: Buffer, encoding: string, maxDecodedBytes: number) => Promise<Buffer>
} = require('../../preload/web-fetch.cjs')

describe('parseProxyUrl', () => {
  test('parses http proxy with host:port', () => {
    const parsed = parseProxyUrl('http://127.0.0.1:7890')
    expect(parsed).not.toBeNull()
    expect(parsed!.kind).toBe('http')
    expect(parsed!.host).toBe('127.0.0.1')
    expect(parsed!.port).toBe(7890)
    expect(parsed!.auth).toBeNull()
    expect(parsed!.href).toBe('http://127.0.0.1:7890')
  })

  test('defaults scheme to http when missing', () => {
    const parsed = parseProxyUrl('127.0.0.1:6152')
    expect(parsed!.kind).toBe('http')
    expect(parsed!.host).toBe('127.0.0.1')
    expect(parsed!.port).toBe(6152)
  })

  test('parses proxy with basic auth', () => {
    const parsed = parseProxyUrl('http://user:pass@proxy.example.com:8080')
    expect(parsed!.host).toBe('proxy.example.com')
    expect(parsed!.port).toBe(8080)
    expect(parsed!.auth).toBe('user:pass')
  })

  test('parses socks but marks kind as socks', () => {
    const parsed = parseProxyUrl('socks5://127.0.0.1:6153')
    expect(parsed!.kind).toBe('socks')
    expect(parsed!.port).toBe(6153)
  })

  test('returns null for empty or invalid input', () => {
    expect(parseProxyUrl('')).toBeNull()
    expect(parseProxyUrl('   ')).toBeNull()
    expect(parseProxyUrl('not a proxy')).toBeNull()
  })
})

describe('shouldBypassProxy / NO_PROXY', () => {
  test('always bypasses localhost and loopback', () => {
    expect(shouldBypassProxy('localhost', [])).toBe(true)
    expect(shouldBypassProxy('127.0.0.1', [])).toBe(true)
    expect(shouldBypassProxy('::1', [])).toBe(true)
  })

  test('matches exact host and domain suffix', () => {
    const list = parseNoProxyList('example.com, .internal.corp, api.test.local')
    expect(shouldBypassProxy('example.com', list)).toBe(true)
    expect(shouldBypassProxy('www.example.com', list)).toBe(true)
    expect(shouldBypassProxy('foo.internal.corp', list)).toBe(true)
    expect(shouldBypassProxy('internal.corp', list)).toBe(true)
    expect(shouldBypassProxy('api.test.local', list)).toBe(true)
    expect(shouldBypassProxy('other.com', list)).toBe(false)
  })

  test('star bypasses all', () => {
    expect(shouldBypassProxy('anything.com', parseNoProxyList('*'))).toBe(true)
  })

  test('accepts raw NO_PROXY string', () => {
    expect(shouldBypassProxy('cdn.example.com', 'example.com,localhost')).toBe(true)
    expect(shouldBypassProxy('google.com', 'example.com')).toBe(false)
  })
})

describe('resolveProxySettings from env', () => {
  const saved: Record<string, string | undefined> = {}
  const envKeys = [
    'HTTPS_PROXY',
    'https_proxy',
    'HTTP_PROXY',
    'http_proxy',
    'ALL_PROXY',
    'all_proxy',
    'NO_PROXY',
    'no_proxy'
  ]

  beforeEach(() => {
    for (const key of envKeys) {
      saved[key] = process.env[key]
      delete process.env[key]
    }
    clearProxyCache()
  })

  afterEach(() => {
    for (const key of envKeys) {
      if (saved[key] === undefined) delete process.env[key]
      else process.env[key] = saved[key]
    }
    clearProxyCache()
  })

  test('prefers HTTPS_PROXY env', () => {
    process.env.HTTPS_PROXY = 'http://127.0.0.1:17890'
    process.env.HTTP_PROXY = 'http://127.0.0.1:1111'
    const status = getProxyStatus()
    expect(status.proxy).toBe('http://127.0.0.1:17890')
    expect(status.source).toBe('env')
    expect(getResolvedProxy()).toBe('http://127.0.0.1:17890')
  })

  test('falls back to HTTP_PROXY', () => {
    process.env.HTTP_PROXY = 'http://10.0.0.2:8888'
    expect(getResolvedProxy()).toBe('http://10.0.0.2:8888')
  })

  test('socks-only env is not used as http proxy', () => {
    process.env.ALL_PROXY = 'socks5://127.0.0.1:1080'
    const status = getProxyStatus()
    expect(status.proxy).toBeNull()
    expect(status.socksOnly).toBe(true)
    expect(status.raw).toContain('socks5')
  })

  test('parses NO_PROXY into list', () => {
    process.env.HTTPS_PROXY = 'http://127.0.0.1:7890'
    process.env.NO_PROXY = 'localhost,example.com'
    const settings = resolveProxySettings(true)
    expect(settings.noProxy).toEqual(['localhost', 'example.com'])
  })

  test('caches proxy resolution briefly', () => {
    process.env.HTTPS_PROXY = 'http://127.0.0.1:1'
    expect(getResolvedProxy()).toBe('http://127.0.0.1:1')
    process.env.HTTPS_PROXY = 'http://127.0.0.1:2'
    // 缓存未过期，仍返回旧值
    expect(getResolvedProxy()).toBe('http://127.0.0.1:1')
    clearProxyCache()
    expect(getResolvedProxy()).toBe('http://127.0.0.1:2')
  })
})

describe('existing body limits still work from same module', () => {
  test('assertResponseBodySize and error codes', () => {
    expect(() => assertResponseBodySize(65 * 1024, 64 * 1024)).toThrow()
    try {
      assertResponseBodySize(65 * 1024, 64 * 1024)
    } catch (error) {
      expect((error as NodeJS.ErrnoException).code).toBe(
        WEB_FETCH_ERROR_CODES.RESPONSE_TOO_LARGE
      )
    }
  })

  test('decodeBody still rejects oversized uncompressed bodies', async () => {
    await expect(decodeBody(Buffer.alloc(70 * 1024), '', 64 * 1024)).rejects.toMatchObject({
      code: WEB_FETCH_ERROR_CODES.DECOMPRESSED_TOO_LARGE
    })
  })
})
