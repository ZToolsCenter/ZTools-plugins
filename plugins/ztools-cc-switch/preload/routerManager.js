'use strict'

const http = require('node:http')
const fsp = require('node:fs/promises')
const path = require('node:path')
const crypto = require('node:crypto')
const { Readable } = require('node:stream')
const { prepareRequest, transformResponse } = require('./protocolAdapter')
const { transformSseStream } = require('./sseTransformer')
const { restoreResponseNamespaces, restoreNamespaceSseStream, injectPromptCacheKey, extractCodexClientSessionId } = require('./codexCompat')
const { normalizeOptimizer, normalizeCopilot, optimizeBedrockRequest, optimizeCopilotRequest } = require('./requestOptimizer')

const ROUTER_CLIENTS = Object.freeze(['claude', 'codex', 'gemini', 'opencode', 'openclaw', 'hermes', 'grokbuild'])
const MAX_TRANSFORM_RESPONSE_BYTES = 32 * 1024 * 1024
const ROUTER_HOP_HEADER = 'x-ztools-router-hop'

function inferClient(urlPath, headers = {}) {
  const explicit = String(headers['x-ztools-client'] || '').toLowerCase()
  if ([...ROUTER_CLIENTS, 'claude-desktop'].includes(explicit)) return explicit
  if (/^\/claude-desktop(?:\/|$)/i.test(urlPath)) return 'claude-desktop'
  if (/^\/opencode(?:\/|$)/i.test(urlPath)) return 'opencode'
  if (/^\/openclaw(?:\/|$)/i.test(urlPath)) return 'openclaw'
  if (/^\/hermes(?:\/|$)/i.test(urlPath)) return 'hermes'
  if (/^\/grokbuild(?:\/|$)/i.test(urlPath)) return 'grokbuild'
  if (/generateContent|streamGenerateContent|\/v1beta\//i.test(urlPath)) return 'gemini'
  if (/\/messages(?:\?|$)/i.test(urlPath)) return 'claude'
  return 'codex'
}

function joinUpstream(baseUrl, incomingPath) {
  const base = new URL(baseUrl)
  const incoming = new URL(incomingPath, 'http://local.invalid')
  const basePath = base.pathname.replace(/\/+$/, '')
  let requestPath = incoming.pathname
  if (basePath && requestPath.startsWith(`${basePath}/`)) requestPath = requestPath.slice(basePath.length)
  base.pathname = `${basePath}${requestPath.startsWith('/') ? requestPath : `/${requestPath}`}` || '/'
  base.search = incoming.search
  return base
}

function secureTokenEqual(actual, expected) {
  const left = Buffer.from(String(actual || ''))
  const right = Buffer.from(String(expected || ''))
  return left.length === right.length && left.length > 0 && crypto.timingSafeEqual(left, right)
}

function desktopRoutes(provider) {
  return (Array.isArray(provider?.claudeDesktopRoutes) ? provider.claudeDesktopRoutes : [])
    .filter((row) => row?.routeId && row?.upstreamModel)
}

function modelRole(value) {
  const model = String(value || '').toLowerCase()
  return ['opus', 'haiku', 'fable', 'sonnet'].find((role) => model.includes(role)) || ''
}

function mapClaudeDesktopModel(provider, payload) {
  if (!payload || typeof payload !== 'object') return payload
  const raw = String(payload.model || '').trim()
  if (!raw) throw Object.assign(new Error('Claude Desktop 请求缺少 model 字段'), { statusCode: 400 })
  const requested = raw.replace(/\s*\[1m\]\s*$/i, '')
  const routes = desktopRoutes(provider)
  let route = routes.find((row) => row.routeId === requested)
  if (!route && ['claude-opus-4-7', 'claude-opus-4-8'].includes(requested)) route = routes.find((row) => ['claude-opus-4-7', 'claude-opus-4-8'].includes(row.routeId))
  if (!route) {
    const role = modelRole(requested)
    if (role) route = routes.find((row) => modelRole(row.routeId) === role) || (role === 'fable' ? routes.find((row) => modelRole(row.routeId) === 'opus') : null)
  }
  if (!route) throw Object.assign(new Error(`Claude Desktop 模型路由未配置: ${raw}`), { statusCode: 400 })
  return { ...payload, model: route.upstreamModel }
}

function claudeDesktopModelsResponse(provider) {
  const data = desktopRoutes(provider).map((route) => ({
    type: 'model', id: route.routeId, created_at: '2024-01-01T00:00:00Z',
    ...(route.supports1m ? { supports1m: true } : {})
  }))
  return { data, has_more: false, first_id: data[0]?.id || null, last_id: data.at(-1)?.id || null }
}

function rectifyPayload(payload, config = {}) {
  if (!config.enabled || !payload || typeof payload !== 'object') return payload
  const result = structuredClone(payload)
  const maxTokens = Number(result.max_tokens || result.max_output_tokens || config.maxOutputTokens || 8192)
  if (result.thinking && typeof result.thinking === 'object') {
    const requested = Number(result.thinking.budget_tokens || config.defaultThinkingBudget || 4096)
    result.thinking.budget_tokens = Math.max(1024, Math.min(requested, Math.max(1024, maxTokens - 1024)))
    if (!result.thinking.type) result.thinking.type = 'enabled'
  } else if (config.injectThinking) {
    result.thinking = {
      type: 'enabled',
      budget_tokens: Math.max(1024, Math.min(Number(config.defaultThinkingBudget) || 4096, Math.max(1024, maxTokens - 1024)))
    }
  }
  if (config.reasoningEffort && !result.reasoning_effort) result.reasoning_effort = config.reasoningEffort
  return result
}

function extractUsage(text) {
  const candidates = []
  try { candidates.push(JSON.parse(text)) } catch {}
  for (const match of String(text || '').matchAll(/^data:\s*(\{.*\})\s*$/gm)) {
    try { candidates.push(JSON.parse(match[1])) } catch {}
  }
  const usageObjects = []
  function visit(value) {
    if (!value || typeof value !== 'object') return
    if (value.usage && typeof value.usage === 'object') usageObjects.push(value.usage)
    for (const child of Object.values(value)) if (child && typeof child === 'object') visit(child)
  }
  candidates.forEach(visit)
  const usage = usageObjects.at(-1) || {}
  const responseModel = candidates.map((value) => value?.response?.model || value?.model).filter(Boolean).at(-1) || ''
  return {
    inputTokens: Number(usage.input_tokens ?? usage.prompt_tokens ?? usage.promptTokenCount) || 0,
    outputTokens: Number(usage.output_tokens ?? usage.completion_tokens ?? usage.candidatesTokenCount) || 0,
    cacheReadTokens: Number(usage.cache_read_input_tokens ?? usage.cached_tokens) || 0,
    cacheCreationTokens: Number(usage.cache_creation_input_tokens) || 0,
    responseModel: String(responseModel)
  }
}

const DEFAULT_CIRCUIT_BREAKER = Object.freeze({ failureThreshold: 4, successThreshold: 2, timeoutSeconds: 60, errorRateThreshold: 0.6, minRequests: 10 })

function normalizeCircuitBreaker(value = {}) {
  return {
    failureThreshold: Math.min(Math.max(Number.parseInt(value.failureThreshold, 10) || 4, 1), 100),
    successThreshold: Math.min(Math.max(Number.parseInt(value.successThreshold, 10) || 2, 1), 100),
    timeoutSeconds: Math.min(Math.max(Number.parseInt(value.timeoutSeconds, 10) || 60, 1), 3600),
    errorRateThreshold: Math.min(Math.max(Number(value.errorRateThreshold) || 0.6, 0.01), 1),
    minRequests: Math.min(Math.max(Number.parseInt(value.minRequests, 10) || 10, 1), 10000)
  }
}

class CircuitBreaker {
  constructor(config = DEFAULT_CIRCUIT_BREAKER, now = () => Date.now()) {
    this.config = normalizeCircuitBreaker(config); this.now = now; this.reset()
  }
  updateConfig(config) { this.config = normalizeCircuitBreaker(config) }
  reset() { this.state = 'closed'; this.consecutiveFailures = 0; this.consecutiveSuccesses = 0; this.totalRequests = 0; this.failedRequests = 0; this.openedAt = null; this.halfOpenInFlight = 0 }
  refresh() {
    if (this.state === 'open' && this.openedAt !== null && this.now() - this.openedAt >= this.config.timeoutSeconds * 1000) {
      this.state = 'half_open'; this.consecutiveSuccesses = 0; this.halfOpenInFlight = 0
    }
  }
  allowRequest() {
    this.refresh()
    if (this.state === 'open') return { allowed: false, halfOpenPermit: false }
    if (this.state === 'half_open') {
      if (this.halfOpenInFlight >= 1) return { allowed: false, halfOpenPermit: false }
      this.halfOpenInFlight += 1; return { allowed: true, halfOpenPermit: true }
    }
    return { allowed: true, halfOpenPermit: false }
  }
  recordSuccess(halfOpenPermit = false) {
    if (halfOpenPermit) this.halfOpenInFlight = Math.max(0, this.halfOpenInFlight - 1)
    this.totalRequests += 1; this.consecutiveFailures = 0
    if (this.state === 'half_open') {
      this.consecutiveSuccesses += 1
      if (this.consecutiveSuccesses >= this.config.successThreshold) this.close()
    }
  }
  recordFailure(halfOpenPermit = false) {
    if (halfOpenPermit) this.halfOpenInFlight = Math.max(0, this.halfOpenInFlight - 1)
    this.totalRequests += 1; this.failedRequests += 1; this.consecutiveFailures += 1; this.consecutiveSuccesses = 0
    if (this.state === 'half_open' || this.consecutiveFailures >= this.config.failureThreshold || (this.totalRequests >= this.config.minRequests && this.failedRequests / this.totalRequests >= this.config.errorRateThreshold)) this.open()
  }
  open() { this.state = 'open'; this.openedAt = this.now(); this.consecutiveFailures = 0; this.consecutiveSuccesses = 0; this.halfOpenInFlight = 0 }
  close() { this.state = 'closed'; this.openedAt = null; this.consecutiveFailures = 0; this.consecutiveSuccesses = 0; this.totalRequests = 0; this.failedRequests = 0; this.halfOpenInFlight = 0 }
  stats() {
    this.refresh()
    return { state: this.state, consecutiveFailures: this.consecutiveFailures, consecutiveSuccesses: this.consecutiveSuccesses, totalRequests: this.totalRequests, failedRequests: this.failedRequests, errorRate: this.totalRequests ? this.failedRequests / this.totalRequests : 0, openedAt: this.openedAt, retryAt: this.state === 'open' && this.openedAt !== null ? this.openedAt + this.config.timeoutSeconds * 1000 : null }
  }
}

function createRouterManager(options = {}) {
  const dataDir = path.resolve(options.dataDir)
  const configPath = path.join(dataDir, 'router-config.json')
  const activityStore = options.activityStore
  const getActiveProvider = options.getActiveProvider
  const getProviderCandidates = options.getProviderCandidates || (async (client) => {
    const provider = await getActiveProvider(client)
    return provider ? [provider] : []
  })
  const resolveProviderAuth = options.resolveProviderAuth || (async () => null)
  const getClaudeDesktopContext = options.getClaudeDesktopContext || (async () => ({ provider: null, gatewayToken: '' }))
  const fetchImpl = options.fetchImpl || globalThis.fetch
  let server = null
  let startedAt = null
  let activeConnections = 0
  let requestCount = 0
  const circuitBreakers = new Map()

  function circuitKey(client, providerId) { return `${client}:${providerId}` }
  function getCircuitBreaker(client, providerId, config) {
    const key = circuitKey(client, providerId)
    if (!circuitBreakers.has(key)) circuitBreakers.set(key, new CircuitBreaker(config))
    const breaker = circuitBreakers.get(key); breaker.updateConfig(config); return breaker
  }

  async function loadConfig() {
    try {
      const value = JSON.parse(await fsp.readFile(configPath, 'utf8'))
      return normalizeConfig(value)
    } catch (error) {
      if (error.code !== 'ENOENT') throw new Error(`读取路由配置失败: ${error.message}`)
      return normalizeConfig({ failover: { enabled: Object.fromEntries(ROUTER_CLIENTS.map((client) => [client, false])) } })
    }
  }

  function normalizeConfig(value) {
    const host = '127.0.0.1'
    const port = Math.min(Math.max(Number(value.port) || 15721, 1024), 65535)
    return {
      host,
      port,
      logging: value.logging !== false,
      routes: {
        claude: Boolean(value.routes?.claude),
        'claude-desktop': Boolean(value.routes?.['claude-desktop']),
        codex: Boolean(value.routes?.codex),
        gemini: Boolean(value.routes?.gemini),
        opencode: Boolean(value.routes?.opencode),
        openclaw: Boolean(value.routes?.openclaw),
        hermes: Boolean(value.routes?.hermes),
        grokbuild: Boolean(value.routes?.grokbuild)
      },
      rectifier: {
        enabled: Boolean(value.rectifier?.enabled),
        injectThinking: Boolean(value.rectifier?.injectThinking),
        defaultThinkingBudget: Number(value.rectifier?.defaultThinkingBudget) || 4096,
        maxOutputTokens: Number(value.rectifier?.maxOutputTokens) || 8192,
        reasoningEffort: ['low', 'medium', 'high'].includes(value.rectifier?.reasoningEffort)
          ? value.rectifier.reasoningEffort
          : ''
      },
      optimizer: normalizeOptimizer(value.optimizer),
      copilotOptimizer: normalizeCopilot(value.copilotOptimizer),
      failover: {
        enabled: {
          claude: value.failover?.enabled?.claude !== false,
          'claude-desktop': value.failover?.enabled?.['claude-desktop'] !== false,
          codex: value.failover?.enabled?.codex !== false,
          gemini: value.failover?.enabled?.gemini !== false,
          opencode: value.failover?.enabled?.opencode !== false,
          openclaw: value.failover?.enabled?.openclaw !== false,
          hermes: value.failover?.enabled?.hermes !== false,
          grokbuild: value.failover?.enabled?.grokbuild !== false
        },
        circuitBreaker: normalizeCircuitBreaker(value.failover?.circuitBreaker)
      }
    }
  }

  async function saveConfig(patch = {}) {
    if (server && (patch.host || patch.port)) throw new Error('修改监听地址或端口前请先停止路由服务')
    const current = await loadConfig()
    const next = normalizeConfig({
      ...current,
      ...patch,
      routes: { ...current.routes, ...(patch.routes || {}) },
      rectifier: { ...current.rectifier, ...(patch.rectifier || {}) },
      optimizer: { ...current.optimizer, ...(patch.optimizer || {}) },
      copilotOptimizer: { ...current.copilotOptimizer, ...(patch.copilotOptimizer || {}) }
      , failover: { ...current.failover, ...(patch.failover || {}), enabled: { ...current.failover.enabled, ...(patch.failover?.enabled || {}) }, circuitBreaker: { ...current.failover.circuitBreaker, ...(patch.failover?.circuitBreaker || {}) } }
    })
    await fsp.mkdir(dataDir, { recursive: true })
    const temp = `${configPath}.${process.pid}.${Date.now()}.tmp`
    await fsp.writeFile(temp, `${JSON.stringify(next, null, 2)}\n`, { mode: 0o600 })
    await fsp.rename(temp, configPath)
    for (const breaker of circuitBreakers.values()) breaker.updateConfig(next.failover.circuitBreaker)
    return next
  }

  async function readBody(request, maxBytes = 20 * 1024 * 1024) {
    const chunks = []
    let size = 0
    for await (const chunk of request) {
      size += chunk.length
      if (size > maxBytes) throw new Error('请求体超过 20 MB 安全限制')
      chunks.push(chunk)
    }
    return Buffer.concat(chunks)
  }

  async function readUpstreamBody(upstreamResponse, maxBytes = MAX_TRANSFORM_RESPONSE_BYTES) {
    const declared = Number(upstreamResponse.headers?.get?.('content-length') || 0)
    if (declared > maxBytes) {
      await upstreamResponse.body?.cancel?.().catch(() => {})
      throw Object.assign(new Error('上游转换响应超过 32 MB 安全限制'), { statusCode: 502 })
    }
    const chunks = []; let size = 0
    const reader = upstreamResponse.body.getReader()
    try {
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        size += value.byteLength
        if (size > maxBytes) {
          await reader.cancel().catch(() => {})
          throw Object.assign(new Error('上游转换响应超过 32 MB 安全限制'), { statusCode: 502 })
        }
        chunks.push(Buffer.from(value))
      }
    } finally { reader.releaseLock() }
    return Buffer.concat(chunks)
  }

  async function handleRequest(request, response) {
    const start = performance.now()
    let firstTokenMs = null
    let client = 'unknown'
    let provider = null
    let statusCode = 500
    let requestModel = ''
    activeConnections += 1
    requestCount += 1
    try {
      const config = await loadConfig()
      const hop = Number.parseInt(String(request.headers[ROUTER_HOP_HEADER] || '0'), 10)
      if (Number.isFinite(hop) && hop > 0) throw Object.assign(new Error('检测到本地路由递归请求'), { statusCode: 508 })
      client = inferClient(request.url || '/', request.headers)
      if (!config.routes[client]) throw Object.assign(new Error(`${client} 路由未启用`), { statusCode: 404 })
      if (client === 'claude-desktop') {
        const context = await getClaudeDesktopContext()
        const authorization = String(request.headers.authorization || '')
        const token = authorization.replace(/^bearer\s+/i, '').trim()
        if (!secureTokenEqual(token, context.gatewayToken)) throw Object.assign(new Error('Claude Desktop gateway token 无效'), { statusCode: 401 })
        if (request.method === 'GET' && /^\/claude-desktop\/v1\/models(?:\?|$)/i.test(request.url || '')) {
          if (!context.provider) throw Object.assign(new Error('Claude Desktop 没有已启用的 Provider'), { statusCode: 503 })
          const body = JSON.stringify(claudeDesktopModelsResponse(context.provider))
          response.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'content-length': Buffer.byteLength(body) })
          response.end(body)
          statusCode = 200
          return
        }
      }
      const allCandidates = await getProviderCandidates(client)
      const candidates = config.failover.enabled[client] ? allCandidates : allCandidates.slice(0, 1)
      provider = candidates[0]
      if (!provider) throw Object.assign(new Error(`${client} 没有已启用的 Provider`), { statusCode: 503 })

      const body = await readBody(request)
      let requestPayload = null
      const contentType = String(request.headers['content-type'] || '')
      if (body.length && contentType.includes('json')) {
        try {
          requestPayload = rectifyPayload(JSON.parse(body.toString('utf8')), config.rectifier)
          requestModel = String(requestPayload.model || provider.model || '')
        } catch {}
      }

      let upstreamResponse = null
      let lastError = null
      let prepared = null
      for (let index = 0; index < candidates.length; index += 1) {
        provider = candidates[index]
        const breaker = getCircuitBreaker(client, provider.id, config.failover.circuitBreaker)
        const permit = breaker.allowRequest()
        if (!permit.allowed) {
          lastError = Object.assign(new Error(`${provider.name} 熔断器已打开`), { statusCode: 503 })
          continue
        }
        try {
        const managedAuth = provider.authProvider ? await resolveProviderAuth(provider) : null
        if (managedAuth?.baseUrl) provider = { ...provider, baseUrl: managedAuth.baseUrl }
        const incomingPath = ['opencode', 'openclaw', 'hermes', 'grokbuild', 'claude-desktop'].includes(client)
          ? String(request.url || '/').replace(new RegExp(`^/${client}(?=/)`, 'i'), '')
          : (request.url || '/')
        let candidatePayload = requestPayload
        let optimizerHeaders = {}
        let candidateProvider = provider
        if (client === 'claude-desktop') {
          candidatePayload = mapClaudeDesktopModel(provider, candidatePayload)
          candidateProvider = { ...provider, model: candidatePayload?.model || provider.model }
        }
        if (candidatePayload && provider.isBedrock) candidatePayload = optimizeBedrockRequest(candidatePayload, config.optimizer)
        if (candidatePayload && provider.authProvider === 'github_copilot') {
          const optimized = optimizeCopilotRequest(candidatePayload, request.headers, config.copilotOptimizer)
          candidatePayload = optimized.body; optimizerHeaders = optimized.headers
          if (optimized.classification?.isWarmup && config.copilotOptimizer.warmupDowngrade) candidateProvider = { ...provider, model: candidatePayload.model }
        }
        prepared = prepareRequest({ client: client === 'claude-desktop' ? 'claude' : client, provider: candidateProvider, incomingPath, body: candidatePayload })
        if (client === 'codex' && prepared.sourceProtocol === 'responses' && prepared.targetProtocol === 'openai_compat' && prepared.body) {
          injectPromptCacheKey(provider, prepared.body, requestPayload?.prompt_cache_key, extractCodexClientSessionId(request.headers, requestPayload))
        }
        if (provider.authProvider === 'codex_oauth') {
          prepared.path = String(prepared.path || '').replace(/^\/v1(?=\/)/, '')
          if (prepared.body && typeof prepared.body === 'object') {
            const include = Array.isArray(prepared.body.include) ? [...prepared.body.include] : []
            if (!include.includes('reasoning.encrypted_content')) include.push('reasoning.encrypted_content')
            prepared.body = {
              ...prepared.body,
              store: false,
              include,
              instructions: prepared.body.instructions || '',
              tools: Array.isArray(prepared.body.tools) ? prepared.body.tools : [],
              parallel_tool_calls: Boolean(prepared.body.parallel_tool_calls),
              stream: true,
              ...(provider.fastMode ? { service_tier: 'priority' } : {})
            }
            delete prepared.body.max_output_tokens
            delete prepared.body.temperature
            delete prepared.body.top_p
          }
        }
        const upstream = joinUpstream(provider.baseUrl, prepared.path)
        const routerOrigin = `http://127.0.0.1:${config.port}`
        if (upstream.origin === routerOrigin) throw Object.assign(new Error('Provider Base URL 不能指向当前本地路由'), { statusCode: 508 })
        const headers = { ...request.headers }
        delete headers.host; delete headers['content-length']; delete headers['x-ztools-client']
        headers[ROUTER_HOP_HEADER] = '1'
        headers.accept = headers.accept || 'application/json'
        Object.assign(headers, optimizerHeaders)
        const credential = managedAuth?.token || provider.apiKey
        if (!credential) throw new Error(`${provider.name} 缺少可用的认证凭据`)
        if (provider.authProvider === 'codex_oauth') {
          headers.authorization = `Bearer ${credential}`
          headers['chatgpt-account-id'] = managedAuth.accountId
          headers.originator = 'codex_cli_rs'
          headers.version = '0.115.0'
          headers['user-agent'] = 'codex_cli_rs/0.115.0'
          delete headers['x-api-key']
        } else if (provider.authProvider === 'github_copilot') {
          headers.authorization = `Bearer ${credential}`
          headers['user-agent'] = 'GitHubCopilotChat/0.38.2'
          headers['editor-version'] = 'vscode/1.110.1'
          headers['editor-plugin-version'] = 'copilot-chat/0.38.2'
          headers['copilot-integration-id'] = 'vscode-chat'
          headers['x-github-api-version'] = '2025-10-01'
          delete headers['x-api-key']
        } else if (prepared.targetProtocol === 'anthropic') {
          headers['x-api-key'] = credential; headers['anthropic-version'] = headers['anthropic-version'] || '2023-06-01'; delete headers.authorization
        } else if (prepared.targetProtocol === 'gemini') {
          upstream.searchParams.set('key', credential); delete headers.authorization
        } else { headers.authorization = `Bearer ${credential}`; delete headers['x-api-key'] }
        const candidateBody = requestPayload ? Buffer.from(JSON.stringify(prepared.body)) : body
          upstreamResponse = await fetchImpl(upstream, { method: request.method, headers, body: ['GET', 'HEAD'].includes(request.method) ? undefined : candidateBody, redirect: 'manual' })
          const retryable = upstreamResponse.status === 408 || upstreamResponse.status === 429 || upstreamResponse.status >= 500
          if (retryable) breaker.recordFailure(permit.halfOpenPermit)
          else breaker.recordSuccess(permit.halfOpenPermit)
          if (!retryable || index === candidates.length - 1) break
          await upstreamResponse.body?.cancel().catch(() => {})
        } catch (error) {
          breaker.recordFailure(permit.halfOpenPermit)
          lastError = error
          if (index === candidates.length - 1) throw error
        }
      }
      if (!upstreamResponse) throw lastError || new Error('所有 Provider 均不可用')
      statusCode = upstreamResponse.status
      response.statusCode = upstreamResponse.status
      upstreamResponse.headers.forEach((value, key) => {
        if (!['content-length', 'content-encoding', 'transfer-encoding', 'connection'].includes(key.toLowerCase()) && !(prepared?.transformed && key.toLowerCase() === 'content-type')) {
          response.setHeader(key, value)
        }
      })
      response.setHeader('x-ztools-provider', provider.id)

      const captured = []
      let capturedBytes = 0
      if (upstreamResponse.body && prepared?.transformed && prepared.stream) {
        response.setHeader('content-type', 'text/event-stream; charset=utf-8')
        response.setHeader('cache-control', 'no-cache')
        const transformedStream = transformSseStream(upstreamResponse.body, prepared.sourceProtocol, prepared.targetProtocol)
        const responseStream = prepared.namespaceRestoreMap?.size ? restoreNamespaceSseStream(transformedStream, prepared.namespaceRestoreMap) : transformedStream
        for await (const chunk of responseStream) {
          if (firstTokenMs === null) firstTokenMs = Math.round(performance.now() - start)
          if (capturedBytes < 2 * 1024 * 1024) { captured.push(chunk); capturedBytes += chunk.length }
          if (!response.write(chunk)) await new Promise((resolve) => response.once('drain', resolve))
        }
      } else if (upstreamResponse.body && prepared?.transformed) {
        const upstreamBytes = await readUpstreamBody(upstreamResponse)
        if (firstTokenMs === null && upstreamBytes.length) firstTokenMs = Math.round(performance.now() - start)
        const upstreamText = upstreamBytes.toString('utf8')
        captured.push(Buffer.from(upstreamText)); capturedBytes = Buffer.byteLength(upstreamText)
        const converted = transformResponse({ sourceProtocol: prepared.sourceProtocol, targetProtocol: prepared.targetProtocol, bodyText: upstreamText, streaming: prepared.stream })
        if (prepared.namespaceRestoreMap?.size) {
          const restored = restoreResponseNamespaces(JSON.parse(converted.body), prepared.namespaceRestoreMap)
          converted.body = JSON.stringify(restored.value)
        }
        response.setHeader('content-type', converted.contentType)
        response.write(converted.body)
      } else if (upstreamResponse.body && prepared?.namespaceTransformed && prepared.stream) {
        response.setHeader('content-type', 'text/event-stream; charset=utf-8')
        response.setHeader('cache-control', 'no-cache')
        for await (const chunk of restoreNamespaceSseStream(upstreamResponse.body, prepared.namespaceRestoreMap)) {
          if (firstTokenMs === null) firstTokenMs = Math.round(performance.now() - start)
          if (capturedBytes < 2 * 1024 * 1024) { captured.push(chunk); capturedBytes += chunk.length }
          if (!response.write(chunk)) await new Promise((resolve) => response.once('drain', resolve))
        }
      } else if (upstreamResponse.body && prepared?.namespaceTransformed) {
        const upstreamText = (await readUpstreamBody(upstreamResponse)).toString('utf8')
        const restored = restoreResponseNamespaces(JSON.parse(upstreamText), prepared.namespaceRestoreMap)
        const outputText = JSON.stringify(restored.value)
        captured.push(Buffer.from(outputText)); capturedBytes = Buffer.byteLength(outputText)
        response.setHeader('content-type', 'application/json; charset=utf-8')
        response.write(outputText)
      } else if (upstreamResponse.body) {
        for await (const chunk of Readable.fromWeb(upstreamResponse.body)) {
          if (firstTokenMs === null) firstTokenMs = Math.round(performance.now() - start)
          if (capturedBytes < 2 * 1024 * 1024) {
            captured.push(chunk)
            capturedBytes += chunk.length
          }
          if (!response.write(chunk)) await new Promise((resolve) => response.once('drain', resolve))
        }
      }
      const usage = extractUsage(Buffer.concat(captured).toString('utf8'))
      if (config.logging && activityStore) {
        const billing = activityStore.resolveBillingConfig ? await activityStore.resolveBillingConfig(provider, client) : { multiplier: provider.costMultiplier || '1', source: provider.pricingModelSource || 'response' }
        const outboundModel = String(prepared?.body?.model || prepared?.model || provider.model || requestModel)
        await activityStore.append({
          client,
          providerId: provider.id,
          providerName: provider.name,
          model: usage.responseModel || provider.model || requestModel,
          requestModel: requestModel || null,
          pricingModel: billing.source === 'request' ? outboundModel : (usage.responseModel || provider.model || requestModel),
          costMultiplier: billing.multiplier,
          ...Object.fromEntries(Object.entries(usage).filter(([key]) => key !== 'responseModel')),
          latencyMs: Math.round(performance.now() - start),
          firstTokenMs,
          statusCode,
          streaming: String(upstreamResponse.headers.get('content-type')).includes('event-stream')
        }).catch((error) => console.warn('[cc-switch] 请求日志写入失败:', error.message))
      }
      response.end()
    } catch (error) {
      statusCode = error.statusCode || 502
      if (!response.headersSent) {
        response.writeHead(statusCode, { 'content-type': 'application/json; charset=utf-8' })
        response.end(JSON.stringify({ error: { message: error.message, type: 'ztools_router_error' } }))
      } else response.end()
      const config = await loadConfig().catch(() => ({ logging: true }))
      if (config.logging && activityStore) {
        await activityStore.append({
          client,
          providerId: provider?.id,
          providerName: provider?.name,
          model: requestModel || provider?.model,
          latencyMs: Math.round(performance.now() - start),
          firstTokenMs,
          statusCode,
          error: error.message
        }).catch(() => {})
      }
    } finally {
      activeConnections -= 1
    }
  }

  async function start() {
    if (server) return status()
    const config = await loadConfig()
    server = http.createServer((request, response) => {
      handleRequest(request, response).catch((error) => {
        console.error('[cc-switch] 路由请求异常:', error)
        if (!response.headersSent) response.writeHead(500)
        response.end()
      })
    })
    server.requestTimeout = 10 * 60 * 1000
    await new Promise((resolve, reject) => {
      server.once('error', reject)
      server.listen(config.port, config.host, resolve)
    }).catch((error) => { server = null; throw new Error(`路由服务启动失败: ${error.message}`) })
    startedAt = Date.now()
    return status()
  }

  async function stop() {
    if (!server) return status()
    const current = server
    server = null
    await new Promise((resolve) => current.close(resolve))
    startedAt = null
    return status()
  }

  async function status() {
    const config = await loadConfig()
    return {
      running: Boolean(server),
      url: `http://${config.host}:${config.port}`,
      startedAt,
      uptimeMs: startedAt ? Date.now() - startedAt : 0,
      activeConnections,
      requestCount,
      config
      , circuitBreakers: [...circuitBreakers.entries()].map(([key, breaker]) => { const [client, ...parts] = key.split(':'); return { client, providerId: parts.join(':'), ...breaker.stats() } })
    }
  }

  async function getCircuitBreakerStats(client, providerId) {
    const config = await loadConfig(); const breaker = circuitBreakers.get(circuitKey(String(client || ''), String(providerId || '')))
    return breaker ? { client: String(client), providerId: String(providerId), ...breaker.stats() } : { client: String(client), providerId: String(providerId), state: 'closed', consecutiveFailures: 0, consecutiveSuccesses: 0, totalRequests: 0, failedRequests: 0, errorRate: 0, openedAt: null, retryAt: null, configured: config.failover.circuitBreaker }
  }

  function resetCircuitBreaker(client, providerId) {
    const breaker = circuitBreakers.get(circuitKey(String(client || ''), String(providerId || ''))); if (breaker) breaker.reset()
    return true
  }

  return { start, stop, status, loadConfig, saveConfig, getCircuitBreakerStats, resetCircuitBreaker }
}

module.exports = { ROUTER_CLIENTS, DEFAULT_CIRCUIT_BREAKER, MAX_TRANSFORM_RESPONSE_BYTES, ROUTER_HOP_HEADER, normalizeCircuitBreaker, CircuitBreaker, inferClient, joinUpstream, rectifyPayload, extractUsage, secureTokenEqual, mapClaudeDesktopModel, claudeDesktopModelsResponse, createRouterManager }
