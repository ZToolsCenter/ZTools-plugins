'use strict'

const crypto = require('node:crypto')
const { requireSecureHttpUrl } = require('./networkSecurity')

const APPS = new Set(['claude', 'codex', 'gemini', 'grokbuild', 'opencode', 'openclaw', 'hermes'])
const MCP_APPS = new Set(['claude', 'codex', 'gemini', 'grokbuild', 'opencode', 'hermes'])
const MAX_LINK_LENGTH = 64 * 1024
const MAX_DECODED_BYTES = 1024 * 1024
const PENDING_TTL_MS = 10 * 60 * 1000

function required(params, name) {
  const value = String(params.get(name) || '').trim()
  if (!value) throw new Error(`Deep Link 缺少 ${name} 参数`)
  return value
}

function optionalBoolean(value, fallback = false) {
  if (value === null || value === undefined || value === '') return fallback
  if (value === 'true') return true
  if (value === 'false') return false
  throw new Error('enabled 只能是 true 或 false')
}

function validateHttpUrl(value, label, httpsOnly = false) {
  let parsed
  try { parsed = new URL(String(value || '')) } catch { throw new Error(`${label} 不是有效 URL`) }
  if (parsed.username || parsed.password) throw new Error(`${label} 不允许包含 URL 凭据`)
  if (httpsOnly ? parsed.protocol !== 'https:' : !['http:', 'https:'].includes(parsed.protocol)) throw new Error(`${label} 协议不受支持`)
  return parsed.href.replace(/\/$/, '')
}

function validateProviderEndpoint(value, label) {
  const parsed = requireSecureHttpUrl(validateHttpUrl(value, label), label)
  return parsed.href.replace(/\/$/, '')
}

function safeMcpId(value) {
  const id = String(value || '').trim()
  if (!id || id.length > 120 || !/^[A-Za-z0-9._-]+$/.test(id)) throw new Error('MCP Server ID 无效')
  return id
}

function uniqueMcpId(value, used) {
  const id = safeMcpId(value)
  if (!used.has(id)) { used.add(id); return id }
  for (let index = 1; index <= 999; index += 1) {
    const suffix = index === 1 ? '-imported' : `-imported-${index}`
    const candidate = `${id.slice(0, 120 - suffix.length)}${suffix}`
    if (!used.has(candidate)) { used.add(candidate); return candidate }
  }
  throw new Error(`无法为 MCP Server ${id} 分配安全 ID`)
}

function maskMcpArgs(argsInput) {
  const args = Array.isArray(argsInput) ? argsInput.map((value) => String(value).slice(0, 512)) : []
  const output = []
  const sensitive = /(?:api[-_]?key|token|password|secret|authorization|auth)/i
  for (let index = 0; index < Math.min(args.length, 128); index += 1) {
    const value = args[index]
    const pair = /^(--?[^=]+)=(.*)$/.exec(value)
    if (pair && sensitive.test(pair[1])) { output.push(`${pair[1]}=••••`); continue }
    output.push(value)
    if (sensitive.test(value) && index + 1 < args.length) { output.push('••••'); index += 1 }
  }
  if (args.length > 128) output.push(`… 另有 ${args.length - 128} 项`)
  return output
}

function maskMcpUrl(value) {
  const parsed = new URL(String(value || ''))
  const sensitive = /(?:api[-_]?key|token|password|secret|authorization|auth)/i
  for (const key of [...parsed.searchParams.keys()]) if (sensitive.test(key)) parsed.searchParams.set(key, '••••')
  return parsed.href
}

function decodeBase64(value, label) {
  const input = String(value || '')
  if (!input || input.length > Math.ceil(MAX_DECODED_BYTES * 4 / 3) + 16 || !/^[A-Za-z0-9+/_=-]+$/.test(input)) throw new Error(`${label} Base64 无效或过大`)
  const normalized = input.replace(/-/g, '+').replace(/_/g, '/')
  const buffer = Buffer.from(normalized, 'base64')
  if (!buffer.length || buffer.length > MAX_DECODED_BYTES) throw new Error(`${label} 解码内容无效或过大`)
  return buffer.toString('utf8')
}

function safeName(value, label = 'name') {
  const name = String(value || '').trim()
  if (!name || name.length > 160 || /[\0\r\n]/.test(name)) throw new Error(`${label} 无效`)
  return name
}

function safeId(value) {
  const base = String(value || '').normalize('NFKD').replace(/[^A-Za-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80)
  return `${base || 'imported'}-${Date.now()}-${crypto.randomBytes(3).toString('hex')}`
}

function parseDeepLink(input) {
  const raw = String(input || '').trim()
  if (!raw || raw.length > MAX_LINK_LENGTH) throw new Error('Deep Link 为空或过长')
  let url
  try { url = new URL(raw) } catch { throw new Error('Deep Link URL 无效') }
  if (url.protocol !== 'ccswitch:' || url.hostname !== 'v1' || url.pathname !== '/import') throw new Error('仅支持 ccswitch://v1/import')
  const params = url.searchParams
  const resource = required(params, 'resource')
  const enabled = optionalBoolean(params.get('enabled'), resource === 'skill')
  if (!['provider', 'prompt', 'mcp', 'skill'].includes(resource)) throw new Error(`不支持的 Deep Link 资源: ${resource}`)

  if (resource === 'provider') {
    const usageFields = ['usageEnabled', 'usageScript', 'usageApiKey', 'usageBaseUrl', 'usageAccessToken', 'usageUserId', 'usageAutoInterval']
    if (usageFields.some((name) => params.has(name))) throw new Error('外部链接不支持用量脚本；请先导入 Provider，再在用量管理中手动配置')
    const app = required(params, 'app')
    if (!APPS.has(app)) throw new Error(`不支持的 Provider 应用: ${app}`)
    const endpoint = params.get('endpoint')?.split(',').map((item, index) => validateProviderEndpoint(item.trim(), `endpoint[${index}]`)).filter(Boolean) || []
    const homepage = params.get('homepage') ? validateHttpUrl(params.get('homepage'), 'homepage') : ''
    if (params.has('configUrl')) throw new Error('外部 Deep Link 不支持远程 configUrl；请改用内联 Base64 config')
    return {
      resource, app, enabled, name: safeName(required(params, 'name')), homepage, endpoint,
      apiKey: String(params.get('apiKey') || ''), model: String(params.get('model') || '').trim(), notes: String(params.get('notes') || '').slice(0, 4000),
      haikuModel: String(params.get('haikuModel') || '').trim(), sonnetModel: String(params.get('sonnetModel') || '').trim(), opusModel: String(params.get('opusModel') || '').trim(),
      icon: String(params.get('icon') || '').trim().slice(0, 80), config: String(params.get('config') || ''), configFormat: String(params.get('configFormat') || '').trim()
    }
  }
  if (resource === 'prompt') {
    const app = required(params, 'app'); if (!APPS.has(app)) throw new Error(`不支持的 Prompt 应用: ${app}`)
    return { resource, app, enabled, name: safeName(required(params, 'name')), content: decodeBase64(required(params, 'content'), 'content'), description: String(params.get('description') || '').slice(0, 2000) }
  }
  if (resource === 'mcp') {
    const apps = [...new Set(required(params, 'apps').split(',').map((item) => item.trim() === 'grok' ? 'grokbuild' : item.trim()))]
    if (!apps.length || apps.some((app) => app !== 'openclaw' && !MCP_APPS.has(app))) throw new Error('MCP apps 包含不支持的应用')
    const decoded = JSON.parse(decodeBase64(required(params, 'config'), 'config'))
    if (!decoded?.mcpServers || typeof decoded.mcpServers !== 'object' || Array.isArray(decoded.mcpServers) || !Object.keys(decoded.mcpServers).length) throw new Error('MCP config 必须包含非空 mcpServers 对象')
    return { resource, apps, enabled: false, requestedEnabled: enabled, mcpServers: decoded.mcpServers }
  }
  const repo = required(params, 'repo')
  const parts = repo.split('/')
  if (parts.length !== 2 || parts.some((item) => !/^[A-Za-z0-9_.-]+$/.test(item))) throw new Error('Skill repo 必须是 owner/name')
  const branch = String(params.get('branch') || 'main').trim()
  if (!branch || branch.includes('..') || !/^[A-Za-z0-9._/-]+$/.test(branch)) throw new Error('Skill branch 无效')
  return { resource, repo, owner: parts[0], name: parts[1], directory: String(params.get('directory') || '').trim(), branch, enabled }
}

function inferProviderConfig(request, configValue) {
  if (!configValue || typeof configValue !== 'object') return request
  const next = { ...request }
  if (next.app === 'claude') {
    const env = configValue.env || configValue
    next.apiKey ||= env.ANTHROPIC_AUTH_TOKEN || env.ANTHROPIC_API_KEY || ''
    next.endpoint = next.endpoint.length ? next.endpoint : [env.ANTHROPIC_BASE_URL].filter(Boolean)
    next.model ||= env.ANTHROPIC_MODEL || ''
    next.haikuModel ||= env.ANTHROPIC_DEFAULT_HAIKU_MODEL || ''
    next.sonnetModel ||= env.ANTHROPIC_DEFAULT_SONNET_MODEL || ''
    next.opusModel ||= env.ANTHROPIC_DEFAULT_OPUS_MODEL || ''
  } else if (next.app === 'codex') {
    next.apiKey ||= configValue.auth?.OPENAI_API_KEY || configValue.OPENAI_API_KEY || ''
    const text = String(configValue.config || '')
    const base = /base_url\s*=\s*["']([^"']+)/.exec(text)?.[1] || configValue.baseUrl
    const model = /^model\s*=\s*["']([^"']+)/m.exec(text)?.[1] || configValue.model
    next.endpoint = next.endpoint.length ? next.endpoint : [base].filter(Boolean); next.model ||= model || ''
  } else {
    next.apiKey ||= configValue.GEMINI_API_KEY || configValue.apiKey || ''
    next.endpoint = next.endpoint.length ? next.endpoint : [configValue.GEMINI_BASE_URL || configValue.baseUrl].filter(Boolean)
    next.model ||= configValue.GEMINI_MODEL || configValue.model || ''
  }
  return next
}

function createDeepLinkManager(options = {}) {
  const configManager = options.configManager
  const extensionManager = options.extensionManager
  const skillManager = options.skillManager
  const pending = new Map()

  function purge() { const now = Date.now(); for (const [id, item] of pending) if (item.expiresAt <= now) pending.delete(id) }
  async function prepare(url) {
    purge()
    let request = parseDeepLink(url)
    if (request.resource === 'provider' && request.config) {
      const content = decodeBase64(request.config, 'config')
      let parsed
      try { parsed = JSON.parse(content) } catch { throw new Error('Provider config 目前必须是 JSON') }
      request = inferProviderConfig(request, parsed)
    }
    if (request.resource === 'provider') {
      if (!request.apiKey) throw new Error('Provider API Key 不能为空')
      if (!request.endpoint.length) throw new Error('Provider endpoint 不能为空')
      request.endpoint = request.endpoint.map((item, index) => validateProviderEndpoint(item, `endpoint[${index}]`))
    }
    let existingMcpIds = new Set()
    if (request.resource === 'mcp') {
      const store = await extensionManager.listExtensions()
      existingMcpIds = new Set((store.mcpServers || []).map((item) => item.id))
      for (const [id, spec] of Object.entries(request.mcpServers)) {
        safeMcpId(id)
        if (typeof spec?.url === 'string') spec.url = validateProviderEndpoint(spec.url, `MCP Server ${id} URL`)
      }
    }
    const pendingId = crypto.randomUUID(); pending.set(pendingId, { request, expiresAt: Date.now() + PENDING_TTL_MS })
    const preview = request.resource === 'provider'
      ? { resource: request.resource, app: request.app, name: request.name, endpoint: request.endpoint, homepage: request.homepage, model: request.model, notes: request.notes, enabled: request.enabled, maskedApiKey: `${request.apiKey.slice(0, 4)}${'*'.repeat(12)}` }
      : request.resource === 'prompt' ? { resource: request.resource, app: request.app, name: request.name, description: request.description, contentPreview: request.content.slice(0, 240), enabled: request.enabled }
        : request.resource === 'mcp' ? (() => {
            const used = new Set(existingMcpIds)
            return {
              resource: request.resource,
              apps: request.apps,
              enabled: false,
              requestedEnabled: request.requestedEnabled,
              servers: Object.entries(request.mcpServers).map(([id, spec]) => {
                const targetId = uniqueMcpId(id, used)
                return {
                  id, targetId, conflict: targetId !== id,
                  type: typeof spec?.url === 'string' ? 'http' : 'command',
                  url: typeof spec?.url === 'string' ? maskMcpUrl(spec.url) : '',
                  command: typeof spec?.command === 'string' ? spec.command : '',
                  args: maskMcpArgs(spec?.args),
                  envKeys: spec?.env && typeof spec.env === 'object' && !Array.isArray(spec.env) ? Object.keys(spec.env) : [],
                  headerKeys: (spec?.headers || spec?.http_headers) && typeof (spec.headers || spec.http_headers) === 'object' ? Object.keys(spec.headers || spec.http_headers) : []
                }
              })
            }
          })()
          : { resource: request.resource, repo: request.repo, directory: request.directory, branch: request.branch, enabled: request.enabled }
    return { pendingId, expiresAt: Date.now() + PENDING_TTL_MS, preview }
  }
  async function confirm(pendingId) {
    purge(); const item = pending.get(String(pendingId || '')); if (!item) throw new Error('Deep Link 已过期，请重新打开')
    pending.delete(String(pendingId)); const request = item.request
    if (request.resource === 'provider') {
      const apiType = request.app === 'claude' ? 'anthropic' : request.app === 'gemini' ? 'gemini' : 'openai_compat'
      const provider = await configManager.saveProvider({ id: safeId(request.name), name: request.name, apiKey: request.apiKey, baseUrl: request.endpoint[0], model: request.model, clients: [request.app], apiType, wireApi: request.app === 'codex' ? 'responses' : 'chat_completions', claudeAuthField: 'ANTHROPIC_AUTH_TOKEN', source: 'imported', notes: request.notes, homepage: request.homepage, customEndpoints: request.endpoint.slice(1), modelMap: request.app === 'claude' ? { haiku: request.haikuModel, sonnet: request.sonnetModel, opus: request.opusModel } : {} })
      if (request.enabled) await configManager.switchProvider(request.app, provider.id)
      return { type: 'provider', id: provider.id, name: provider.name, app: request.app, enabled: request.enabled }
    }
    if (request.resource === 'prompt') {
      const prompt = await extensionManager.savePrompt({ id: safeId(request.name), name: request.name, content: request.content, description: request.description, apps: {} })
      if (request.enabled) await extensionManager.setPromptEnabled(prompt.id, request.app, true)
      return { type: 'prompt', id: prompt.id, name: prompt.name, app: request.app, enabled: request.enabled }
    }
    if (request.resource === 'mcp') {
      const importedIds = []; const failed = []
      const store = await extensionManager.listExtensions()
      const used = new Set((store.mcpServers || []).map((item) => item.id))
      for (const [id, spec] of Object.entries(request.mcpServers)) {
        try {
          const isHttp = typeof spec?.url === 'string'
          const targetId = uniqueMcpId(id, used)
          const saved = await extensionManager.saveMcp({ id: targetId, name: id, type: isHttp ? 'http' : 'command', url: spec?.url || '', headers: spec?.headers || spec?.http_headers || {}, command: spec?.command || '', args: spec?.args || [], env: spec?.env || {}, apps: {} }, { createOnly: true })
          importedIds.push(saved.id)
        } catch (error) { failed.push({ id, error: error.message }) }
      }
      return { type: 'mcp', importedCount: importedIds.length, importedIds, failed, enabled: false, requiresReview: true }
    }
    await skillManager.addSkillRepo({ owner: request.owner, name: request.name, branch: request.branch, enabled: request.enabled })
    return { type: 'skill', repo: request.repo, enabled: request.enabled }
  }
  function cancel(pendingId) { return pending.delete(String(pendingId || '')) }
  return { prepare, confirm, cancel }
}

module.exports = { APPS, MCP_APPS, parseDeepLink, decodeBase64, maskMcpArgs, maskMcpUrl, uniqueMcpId, createDeepLinkManager }
