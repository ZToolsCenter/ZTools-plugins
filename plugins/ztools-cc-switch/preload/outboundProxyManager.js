'use strict'

const net = require('node:net')
const { Readable } = require('node:stream')
const nodeFetch = require('node-fetch')
const { ProxyAgent } = require('proxy-agent')
const { getProxyForUrl } = require('proxy-from-env')

const CONFIG_KEY = 'cc-switch:outbound-proxy-v1'
const SECRET_KEY = 'cc-switch:outbound-proxy-secret-v1'
const PROXY_PORTS = Object.freeze([
  [7890, 'http', true], [7891, 'socks5', false], [1080, 'socks5', false],
  [8080, 'http', false], [8888, 'http', false], [3128, 'http', false],
  [10808, 'socks5', false], [10809, 'http', false]
])

function normalizeProxyUrl(value, ownPort = 15721) {
  const input = String(value || '').trim()
  if (!input) return ''
  let parsed
  try { parsed = new URL(input) } catch { throw new Error('代理 URL 无效') }
  if (!['http:', 'https:', 'socks5:', 'socks5h:'].includes(parsed.protocol)) throw new Error('代理仅支持 http、https、socks5 或 socks5h')
  if (!parsed.hostname) throw new Error('代理 URL 缺少主机名')
  if (parsed.pathname !== '/' || parsed.search || parsed.hash) throw new Error('代理 URL 不能包含路径、查询参数或片段')
  const port = Number(parsed.port || ({ 'http:': 80, 'https:': 443, 'socks5:': 1080, 'socks5h:': 1080 })[parsed.protocol])
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('代理端口无效')
  if (['127.0.0.1', 'localhost', '::1'].includes(parsed.hostname.toLowerCase()) && port === Number(ownPort)) throw new Error('全局代理不能指向 AI Provider Switch 自身的本地路由端口')
  parsed.username = ''; parsed.password = ''
  return parsed.toString().replace(/\/$/, '')
}

function maskProxyUrl(value) {
  if (!value) return ''
  const parsed = new URL(value)
  return `${parsed.protocol}//${parsed.hostname}${parsed.port ? `:${parsed.port}` : ''}`
}

function createOutboundProxyManager(options = {}) {
  const storage = options.storage
  const secretCodec = options.secretCodec
  const ownPort = options.ownPort || (() => 15721)
  const fetchImpl = options.nodeFetch || nodeFetch
  const connector = options.connector || ((port, host) => net.createConnection({ port, host }))
  let cachedSignature = ''
  let cachedAgent = null

  function stored() {
    const value = storage.getItem(CONFIG_KEY) || {}
    return { url: normalizeProxyUrl(value.url || '', ownPort()), username: String(value.username || '').slice(0, 256), enabled: Boolean(value.enabled && value.url) }
  }

  function password() {
    const encoded = storage.getItem(SECRET_KEY)
    if (!encoded) return ''
    try { return secretCodec.decode(encoded) } catch { return '' }
  }

  function withCredentials(url, username, secret) {
    if (!url || !username) return url
    const parsed = new URL(url)
    parsed.username = username
    if (secret) parsed.password = secret
    return parsed.toString()
  }

  function envProxyFor(target) {
    const candidate = getProxyForUrl(String(target || ''))
    if (!candidate) return ''
    try { return normalizeProxyUrl(candidate, ownPort()) } catch { return '' }
  }

  function effectiveUrl(target) {
    const config = stored()
    if (config.enabled) return withCredentials(config.url, config.username, password())
    return envProxyFor(target)
  }

  function getAgent(target) {
    const explicit = effectiveUrl(target)
    const signature = explicit || 'direct'
    if (signature === cachedSignature && cachedAgent) return explicit ? cachedAgent : undefined
    cachedSignature = signature
    cachedAgent = explicit ? new ProxyAgent({ getProxyForUrl: () => explicit }) : null
    return cachedAgent || undefined
  }

  async function proxyFetch(input, init = {}) {
    const target = input instanceof URL ? input.href : String(input)
    const agent = getAgent(target)
    if (!agent) return globalThis.fetch(input, init)
    const response = await fetchImpl(target, { ...init, agent })
    const body = response.body && typeof response.body.pipe === 'function' ? Readable.toWeb(response.body) : (response.body || null)
    return new Response(body, { status: response.status, statusText: response.statusText, headers: response.headers })
  }

  function getConfig() {
    const config = stored()
    const systemProxy = envProxyFor('https://api.anthropic.com')
    return {
      ...config,
      hasPassword: Boolean(storage.getItem(SECRET_KEY)),
      secureStorage: Boolean(secretCodec.secure),
      maskedUrl: maskProxyUrl(config.url),
      systemProxy: systemProxy ? maskProxyUrl(systemProxy) : null,
      effectiveMode: config.enabled ? 'explicit' : systemProxy ? 'system' : 'direct'
    }
  }

  function saveConfig(patch = {}) {
    const current = stored()
    const next = {
      url: patch.url !== undefined ? normalizeProxyUrl(patch.url, ownPort()) : current.url,
      username: patch.username !== undefined ? String(patch.username || '').trim().slice(0, 256) : current.username,
      enabled: patch.enabled !== undefined ? Boolean(patch.enabled) : current.enabled
    }
    if (!next.url) next.enabled = false
    storage.setItem(CONFIG_KEY, next)
    if (typeof patch.password === 'string' && patch.password) storage.setItem(SECRET_KEY, secretCodec.encode(patch.password))
    if (patch.clearPassword || !next.username) storage.removeItem(SECRET_KEY)
    cachedSignature = ''; cachedAgent?.destroy?.(); cachedAgent = null
    return getConfig()
  }

  async function testProxy(patch = {}) {
    const current = stored()
    const url = normalizeProxyUrl(patch.url !== undefined ? patch.url : current.url, ownPort())
    if (!url) throw new Error('请先填写代理 URL')
    const username = patch.username !== undefined ? String(patch.username || '').trim() : current.username
    const secret = typeof patch.password === 'string' && patch.password ? patch.password : password()
    const fullUrl = withCredentials(url, username, secret)
    const agent = new ProxyAgent({ getProxyForUrl: () => fullUrl })
    const started = performance.now()
    let lastError
    try {
      for (const target of ['https://httpbin.org/get', 'https://api.anthropic.com']) {
        try {
          const response = await fetchImpl(target, { method: 'HEAD', agent, signal: AbortSignal.timeout(10000), redirect: 'manual' })
          response.body?.destroy?.()
          return { success: true, latencyMs: Math.round(performance.now() - started), status: response.status, error: null }
        } catch (error) { lastError = error }
      }
      return { success: false, latencyMs: Math.round(performance.now() - started), status: 0, error: lastError?.message || '代理测试失败' }
    } finally { agent.destroy?.() }
  }

  function probePort(port, timeoutMs = 120) {
    return new Promise((resolve) => {
      const socket = connector(port, '127.0.0.1')
      let done = false
      const finish = (open) => { if (done) return; done = true; socket.destroy?.(); resolve(open) }
      socket.once('connect', () => finish(true)); socket.once('error', () => finish(false)); socket.setTimeout?.(timeoutMs, () => finish(false))
    })
  }

  async function scanLocalProxies() {
    const found = []
    const results = await Promise.all(PROXY_PORTS.map(async ([port, type, mixed]) => ({ port, type, mixed, open: await probePort(port) })))
    for (const item of results) {
      if (!item.open || item.port === Number(ownPort())) continue
      found.push({ url: `${item.type}://127.0.0.1:${item.port}`, proxyType: item.type, port: item.port })
      if (item.mixed) {
        const alternate = item.type === 'http' ? 'socks5' : 'http'
        found.push({ url: `${alternate}://127.0.0.1:${item.port}`, proxyType: alternate, port: item.port })
      }
    }
    return found
  }

  return { getConfig, saveConfig, testProxy, scanLocalProxies, fetch: proxyFetch, effectiveUrl }
}

module.exports = { PROXY_PORTS, normalizeProxyUrl, maskProxyUrl, createOutboundProxyManager }
