'use strict'

/**
 * Provider 数据与客户端配置管理器。
 *
 * 设计原则：
 * 1. 只修改各客户端明确支持的配置字段，保留用户的其他设置。
 * 2. 所有写入都先生成 `.bak`，再通过同目录临时文件原子替换。
 * 3. Provider 数据独立保存在 ZTools userData，不把密钥写进前端存储。
 */

const fs = require('node:fs')
const fsp = require('node:fs/promises')
const os = require('node:os')
const path = require('node:path')
const crypto = require('node:crypto')
const JSON5 = require('json5')
const YAML = require('yaml')
const { OFFICIAL_PROVIDER_ID, PROFILE_ID, normalizeRoutes } = require('./claudeDesktopManager')

const CLIENTS = Object.freeze({
  claude: { id: 'claude', name: 'Claude Code', accent: '#E8A66A' },
  'claude-desktop': { id: 'claude-desktop', name: 'Claude Desktop', accent: '#D97757' },
  codex: { id: 'codex', name: 'Codex', accent: '#5EEAD4' },
  gemini: { id: 'gemini', name: 'Gemini CLI', accent: '#79A7FF' },
  opencode: { id: 'opencode', name: 'OpenCode', accent: '#A78BFA' },
  openclaw: { id: 'openclaw', name: 'OpenClaw', accent: '#FB7185' },
  hermes: { id: 'hermes', name: 'Hermes Agent', accent: '#FBBF24' },
  grokbuild: { id: 'grokbuild', name: 'GrokBuild', accent: '#93C5FD' }
})

function getHomeDir() {
  const value = process.env.HOME || process.env.USERPROFILE || os.homedir()
  if (!value) throw new Error('无法获取当前用户 Home 目录')
  return path.resolve(value)
}

function getClientPaths(homeDir = getHomeDir()) {
  return {
    claude: {
      settings: path.join(homeDir, '.claude', 'settings.json'),
      pluginConfig: path.join(homeDir, '.claude', 'config.json'),
      legacyState: path.join(homeDir, '.claude.json')
    },
    codex: {
      config: path.join(homeDir, '.codex', 'config.toml'),
      auth: path.join(homeDir, '.codex', 'auth.json')
    },
    gemini: {
      env: path.join(homeDir, '.gemini', '.env'),
      settings: path.join(homeDir, '.gemini', 'settings.json')
    },
    opencode: {
      config: path.join(homeDir, '.config', 'opencode', 'opencode.json'),
      env: path.join(homeDir, '.config', 'opencode', '.env')
    },
    openclaw: {
      config: path.join(homeDir, '.openclaw', 'openclaw.json')
    },
    hermes: {
      config: path.join(process.env.HERMES_HOME || path.join(homeDir, '.hermes'), 'config.yaml')
    },
    grokbuild: {
      config: path.join(homeDir, '.grok', 'config.toml')
    }
  }
}

function createConfigManager(options = {}) {
  const fetchImpl = options.fetchImpl || ((...args) => globalThis.fetch(...args))
  const homeDir = path.resolve(options.homeDir || getHomeDir())
  const dataDir = path.resolve(options.dataDir || path.join(homeDir, '.ztools', 'cc-switch'))
  const bundledRulesPath = options.bundledRulesPath
    ? path.resolve(options.bundledRulesPath)
    : path.join(__dirname, '..', 'default-rules.json')
  const paths = getClientPaths(homeDir)
  const providerStorePath = path.join(dataDir, 'providers.json')
  const commonConfigPath = path.join(dataDir, 'common-config-snippets.json')
  const sidecar = options.sidecar || null
  const resolveProviderAuth = options.resolveProviderAuth || null
  const claudeDesktopManager = options.claudeDesktopManager || null
  const getRouterStatus = options.getRouterStatus || (async () => ({ running: false, url: '' }))

  async function ensureDataDir() {
    await fsp.mkdir(dataDir, { recursive: true })
  }

  async function readJson(filePath, fallback = {}) {
    try {
      return JSON.parse(await fsp.readFile(filePath, 'utf8'))
    } catch (error) {
      if (error.code === 'ENOENT') return fallback
      throw new Error(`读取 JSON 失败 (${filePath}): ${error.message}`)
    }
  }

  async function readJson5(filePath, fallback = {}) {
    try {
      return JSON5.parse(await fsp.readFile(filePath, 'utf8'))
    } catch (error) {
      if (error.code === 'ENOENT') return fallback
      throw new Error(`读取 JSON5 失败 (${filePath}): ${error.message}`)
    }
  }

  async function backupFile(filePath) {
    try {
      await fsp.access(filePath)
      await fsp.copyFile(filePath, `${filePath}.bak`)
      return `${filePath}.bak`
    } catch (error) {
      if (error.code === 'ENOENT') return null
      throw error
    }
  }

  async function atomicWrite(filePath, content) {
    await fsp.mkdir(path.dirname(filePath), { recursive: true })
    await backupFile(filePath)
    const tempPath = `${filePath}.${process.pid}.${Date.now()}.${crypto.randomBytes(4).toString('hex')}.tmp`
    try {
      await fsp.writeFile(tempPath, content, { encoding: 'utf8', mode: 0o600 })
      await fsp.rename(tempPath, filePath)
    } catch (error) {
      await fsp.rm(tempPath, { force: true }).catch(() => {})
      throw error
    }
  }

  async function writeJson(filePath, value) {
    await atomicWrite(filePath, `${JSON.stringify(value, null, 2)}\n`)
  }

  function validateProvider(input) {
    const provider = { ...input }
    provider.id = String(provider.id || '').trim() || crypto.randomUUID()
    provider.name = String(provider.name || '').trim()
    provider.apiKey = String(provider.apiKey || '').trim()
    provider.baseUrl = String(provider.baseUrl || '').trim().replace(/\/+$/, '')
    provider.model = String(provider.model || '').trim()
    provider.modelsUrl = String(provider.modelsUrl || '').trim()
    provider.customUserAgent = String(provider.customUserAgent || '').trim()
    provider.isFullUrl = Boolean(provider.isFullUrl)
    // Codex 当前支持的标准 wire_api 值为 responses / chat_completions。
    // 兼容本插件 1.0.0 规则中曾使用的简写 chat，并在保存时自动迁移。
    provider.wireApi = ['chat', 'chat_completions'].includes(provider.wireApi)
      ? 'chat_completions'
      : 'responses'
    provider.claudeAuthField = provider.claudeAuthField === 'ANTHROPIC_API_KEY'
      ? 'ANTHROPIC_API_KEY'
      : 'ANTHROPIC_AUTH_TOKEN'
    provider.apiType = ['anthropic', 'openai_compat', 'responses', 'gemini'].includes(provider.apiType)
      ? provider.apiType
      : 'openai_compat'
    provider.authProvider = ['codex_oauth', 'xai_oauth', 'github_copilot'].includes(provider.authProvider)
      ? provider.authProvider
      : ''
    provider.authAccountId = String(provider.authAccountId || '').trim()
    provider.fastMode = Boolean(provider.fastMode)
    provider.isBedrock = Boolean(provider.isBedrock)
    provider.claudeDesktopMode = provider.claudeDesktopMode === 'proxy' ? 'proxy' : 'direct'
    provider.claudeDesktopApiFormat = ['anthropic', 'openai_chat', 'openai_responses', 'gemini_native'].includes(provider.claudeDesktopApiFormat)
      ? provider.claudeDesktopApiFormat
      : ({ openai_compat: 'openai_chat', responses: 'openai_responses', gemini: 'gemini_native' }[provider.apiType] || 'anthropic')
    provider.claudeDesktopRoutes = normalizeRoutes(provider.claudeDesktopRoutes || [], provider.claudeDesktopMode)
    provider.commonConfigEnabled = Boolean(provider.commonConfigEnabled)
    provider.claudeHaikuModel = String(provider.claudeHaikuModel || '').trim()
    provider.claudeSonnetModel = String(provider.claudeSonnetModel || '').trim()
    provider.claudeOpusModel = String(provider.claudeOpusModel || '').trim()
    provider.codexReasoningEffort = String(provider.codexReasoningEffort || '').trim()
    provider.promptCacheRouting = ['enabled', 'disabled'].includes(provider.promptCacheRouting) ? provider.promptCacheRouting : 'auto'
    provider.grokContextWindow = Math.min(Math.max(Number.parseInt(provider.grokContextWindow, 10) || 500000, 1024), 10000000)
    provider.failoverPriority = Math.min(Math.max(Number.parseInt(provider.failoverPriority, 10) || 0, 0), 99)
    const multiplier = String(provider.costMultiplier ?? '').trim()
    if (multiplier && (!/^\d+(?:\.\d+)?$/.test(multiplier) || !Number.isFinite(Number(multiplier)))) throw new Error('成本倍率必须是非负十进制数')
    provider.costMultiplier = multiplier
    provider.pricingModelSource = ['request', 'response'].includes(provider.pricingModelSource) ? provider.pricingModelSource : ''
    for (const field of ['limitDailyUsd', 'limitMonthlyUsd']) {
      const value = String(provider[field] ?? '').trim()
      if (value && (!/^\d+(?:\.\d+)?$/.test(value) || !Number.isFinite(Number(value)))) throw new Error(`${field} 必须是非负十进制数`)
      provider[field] = value
    }
    provider.endpointAutoSelect = Boolean(provider.endpointAutoSelect)
    const endpointInput = provider.customEndpointsByClient && typeof provider.customEndpointsByClient === 'object' && !Array.isArray(provider.customEndpointsByClient)
      ? provider.customEndpointsByClient
      : (Array.isArray(provider.customEndpoints) && provider.clients?.[0] ? { [provider.clients[0]]: provider.customEndpoints } : {})
    provider.customEndpointsByClient = Object.fromEntries(Object.entries(endpointInput).filter(([client]) => CLIENTS[client]).map(([client, rows]) => {
      const unique = new Map()
      for (const row of Array.isArray(rows) ? rows : []) {
        const raw = typeof row === 'string' ? row : row?.url
        const url = normalizeEndpointUrl(raw)
        if (url) unique.set(url, { url, addedAt: Number(row?.addedAt ?? row?.added_at) || Date.now(), lastUsed: Number(row?.lastUsed ?? row?.last_used) || null })
      }
      return [client, [...unique.values()].sort((a, b) => b.addedAt - a.addedAt)]
    }))
    delete provider.customEndpoints
    provider.modelMap = provider.modelMap && typeof provider.modelMap === 'object' && !Array.isArray(provider.modelMap)
      ? Object.fromEntries(Object.entries(provider.modelMap).map(([key, value]) => [String(key), String(value)]).filter(([key, value]) => key && value))
      : {}
    provider.color = /^#[0-9a-f]{6}$/i.test(String(provider.color || ''))
      ? String(provider.color)
      : '#64748B'
    provider.clients = Array.from(new Set(
      (Array.isArray(provider.clients) ? provider.clients : [])
        .filter((client) => CLIENTS[client])
    ))
    provider.source = ['preset', 'imported'].includes(provider.source) ? provider.source : 'custom'

    if (!provider.name) throw new Error('Provider 名称不能为空')
    if (/[\r\n\0]/.test(provider.apiKey) || /[\r\n\0]/.test(provider.model) || /[\r\n\0]/.test(provider.customUserAgent)) {
      throw new Error('API Key 与模型名称不能包含换行或空字符')
    }
    if (!provider.clients.length) throw new Error('请至少选择一个客户端')
    const officialDesktop = provider.id === OFFICIAL_PROVIDER_ID && provider.clients.includes('claude-desktop')
    if (!provider.baseUrl && !officialDesktop) throw new Error('Base URL 不能为空')
    if (officialDesktop) return provider
    try {
      const parsed = new URL(provider.baseUrl)
      if (!['http:', 'https:'].includes(parsed.protocol)) throw new Error('unsupported')
    } catch {
      throw new Error('Base URL 必须是有效的 HTTP(S) 地址')
    }
    if (provider.modelsUrl) {
      try {
        const parsed = new URL(provider.modelsUrl)
        if (!['http:', 'https:'].includes(parsed.protocol)) throw new Error('unsupported')
      } catch {
        throw new Error('Models URL 必须是有效的 HTTP(S) 地址')
      }
    }
    return provider
  }

  async function loadRuleProviders() {
    const candidates = [bundledRulesPath]
    for (const candidate of candidates) {
      try {
        const data = await readJson(candidate, null)
        const providers = Array.isArray(data) ? data : data && data.providers
        if (Array.isArray(providers)) {
          return providers.map((item) => validateProvider({ ...item, apiKey: '', source: 'preset' }))
        }
      } catch (error) {
        console.warn(`[cc-switch] 忽略无效规则文件 ${candidate}:`, error.message)
      }
    }
    return []
  }

  async function loadStore() {
    await ensureDataDir()
    const store = await readJson(providerStorePath, {
      version: 1,
      providers: [],
      active: {},
      routes: {},
      sortOrders: {},
      failoverQueues: {},
      hiddenPresetIds: []
    })
    store.providers = Array.isArray(store.providers) ? store.providers : []
    store.active = store.active && typeof store.active === 'object' ? store.active : {}
    store.routes = store.routes && typeof store.routes === 'object' ? store.routes : {}
    store.sortOrders = store.sortOrders && typeof store.sortOrders === 'object' ? store.sortOrders : {}
    store.failoverQueues = store.failoverQueues && typeof store.failoverQueues === 'object' ? store.failoverQueues : {}
    const knownProviderIds = new Set(store.providers.map((item) => item.id))
    for (const client of Object.keys(CLIENTS)) store.failoverQueues[client] = [...new Set((Array.isArray(store.failoverQueues[client]) ? store.failoverQueues[client] : []).filter((id) => knownProviderIds.has(id)))]
    store.hiddenPresetIds = Array.isArray(store.hiddenPresetIds) ? store.hiddenPresetIds : []
    let changed = false

    // 官方 Claude Desktop 项始终保留，用于从 3P 配置安全恢复到 1P 模式。
    if (!store.providers.some((item) => item.id === OFFICIAL_PROVIDER_ID)) {
      store.providers.push(validateProvider({
        id: OFFICIAL_PROVIDER_ID,
        name: 'Claude Desktop Official',
        clients: ['claude-desktop'],
        baseUrl: '',
        apiKey: '',
        model: '',
        apiType: 'anthropic',
        claudeDesktopMode: 'direct',
        claudeDesktopApiFormat: 'anthropic',
        color: '#D97757',
        source: 'preset'
      }))
      changed = true
    }

    // 热更新后自动补入新增预设；用户删除过的预设通过 tombstone 保持隐藏。
    const existingIds = new Set(store.providers.map((item) => item.id))
    const hiddenIds = new Set(store.hiddenPresetIds)
    const rules = await loadRuleProviders()
    for (const rule of rules) {
      const existingIndex = store.providers.findIndex((item) => item.id === rule.id)
      if (existingIndex >= 0 && store.providers[existingIndex].source === 'preset') {
        // 预设定义跟随热更新，但永远保留用户填写的密钥。
        const merged = { ...store.providers[existingIndex], ...rule, apiKey: store.providers[existingIndex].apiKey || '' }
        if (JSON.stringify(merged) !== JSON.stringify(store.providers[existingIndex])) {
          store.providers.splice(existingIndex, 1, merged)
          changed = true
        }
      } else if (!existingIds.has(rule.id) && !hiddenIds.has(rule.id)) {
        store.providers.push(rule)
        changed = true
      }
    }
    if (changed) await writeJson(providerStorePath, store)
    return store
  }

  async function saveStore(store) {
    await ensureDataDir()
    await writeJson(providerStorePath, store)
  }

  async function loadCommonConfigStore() {
    const value = await readJson(commonConfigPath, { snippets: {}, cleared: {} })
    value.snippets = value.snippets && typeof value.snippets === 'object' ? value.snippets : {}
    value.cleared = value.cleared && typeof value.cleared === 'object' ? value.cleared : {}
    return value
  }

  function deepMerge(target, source) {
    if (!source || typeof source !== 'object' || Array.isArray(source)) return source
    const output = target && typeof target === 'object' && !Array.isArray(target) ? target : {}
    for (const [key, value] of Object.entries(source)) output[key] = value && typeof value === 'object' && !Array.isArray(value) ? deepMerge(output[key], value) : value
    return output
  }

  function deepRemove(target, source) {
    if (!target || !source || typeof target !== 'object' || typeof source !== 'object') return
    for (const [key, value] of Object.entries(source)) {
      if (!Object.hasOwn(target, key)) continue
      if (value && typeof value === 'object' && !Array.isArray(value) && target[key] && typeof target[key] === 'object') {
        deepRemove(target[key], value); if (!Object.keys(target[key]).length) delete target[key]
      } else if (JSON.stringify(target[key]) === JSON.stringify(value)) delete target[key]
    }
  }

  function sensitiveKey(name) {
    const upper = String(name).toUpperCase()
    return ['APIKEY','API_KEY','TOKEN','SECRET','PASSWORD','CREDENTIALS'].includes(upper) || /(_API_KEY|_APIKEY|_AUTH_TOKEN|_TOKEN|_ACCESS_KEY|_ACCESS_KEY_ID|_KEY_ID|_PRIVATE_KEY)$/.test(upper) || /(SECRET|PASSWORD|PASSWD|CREDENTIAL|PRIVATE_KEY|BEARER_TOKEN)/.test(upper)
  }

  async function getCommonConfigSnippet(client) {
    if (!['claude', 'codex', 'gemini'].includes(client)) throw new Error('仅 Claude、Codex 与 Gemini 支持通用配置片段')
    return (await loadCommonConfigStore()).snippets[client] || ''
  }

  async function setCommonConfigSnippet(client, snippet) {
    if (!['claude', 'codex', 'gemini'].includes(client)) throw new Error('仅 Claude、Codex 与 Gemini 支持通用配置片段')
    const text = String(snippet || '')
    if (client === 'codex') {
      if (!sidecar?.isAvailable()) throw new Error('Codex 通用配置校验需要 Rust sidecar')
      await sidecar.updateTomlCommonConfig('', text, true)
    } else {
      const parsed = text.trim() ? JSON.parse(text) : {}
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('通用配置必须是 JSON 对象')
      if (client === 'gemini') {
        for (const [key, value] of Object.entries(parsed)) {
          if (['GOOGLE_GEMINI_BASE_URL', 'GEMINI_API_KEY'].includes(key) || sensitiveKey(key)) throw new Error(`Gemini 通用配置不能包含凭据或端点字段: ${key}`)
          if (typeof value !== 'string') throw new Error('Gemini 通用配置值必须是字符串')
        }
      }
    }
    const store = await loadCommonConfigStore(); const old = store.snippets[client] || ''
    // 先从 live 中按值剥离旧片段，避免编辑片段后残留旧字段。
    if (old && client === 'claude') {
      const live = await readJson(paths.claude.settings, {}); deepRemove(live, JSON.parse(old)); await writeJson(paths.claude.settings, live)
    }
    if (old && client === 'codex' && fs.existsSync(paths.codex.config)) {
      const live = await readText(paths.codex.config); await atomicWrite(paths.codex.config, await sidecar.updateTomlCommonConfig(live, old, false))
    }
    if (text.trim()) store.snippets[client] = text
    else delete store.snippets[client]
    store.cleared[client] = !text.trim()
    await writeJson(commonConfigPath, store)
    const providerStore = await loadStore(); const activeId = providerStore.active[client]
    const activeProvider = providerStore.providers.find((item) => item.id === activeId)
    if (activeProvider?.commonConfigEnabled && !providerStore.routes[client]?.enabled) await switchProvider(client, activeId)
    return text
  }

  async function extractCommonConfigSnippet(client) {
    if (client === 'claude') {
      const config = await readJson(paths.claude.settings, {})
      if (config.env && typeof config.env === 'object') {
        for (const key of Object.keys(config.env)) if (sensitiveKey(key) || ['ANTHROPIC_MODEL','ANTHROPIC_REASONING_MODEL','ANTHROPIC_DEFAULT_HAIKU_MODEL','ANTHROPIC_DEFAULT_HAIKU_MODEL_NAME','ANTHROPIC_DEFAULT_OPUS_MODEL','ANTHROPIC_DEFAULT_OPUS_MODEL_NAME','ANTHROPIC_DEFAULT_SONNET_MODEL','ANTHROPIC_DEFAULT_SONNET_MODEL_NAME','ANTHROPIC_DEFAULT_FABLE_MODEL','ANTHROPIC_DEFAULT_FABLE_MODEL_NAME','CLAUDE_CODE_SUBAGENT_MODEL','CLAUDE_CODE_MAX_CONTEXT_TOKENS','CLAUDE_CODE_AUTO_COMPACT_WINDOW','ANTHROPIC_BASE_URL'].includes(key)) delete config.env[key]
        if (!Object.keys(config.env).length) delete config.env
      }
      for (const key of Object.keys(config)) if (sensitiveKey(key) || ['apiBaseUrl','primaryModel','smallFastModel'].includes(key)) delete config[key]
      return JSON.stringify(config, null, 2)
    }
    if (client === 'codex') {
      if (!sidecar?.isAvailable()) throw new Error('Codex 通用配置提取需要 Rust sidecar')
      return sidecar.extractCodexCommonConfig(await readText(paths.codex.config))
    }
    if (client === 'gemini') {
      const env = parseEnvValues(await readText(paths.gemini.env)); const result = {}
      for (const [key, value] of Object.entries(env)) if (!['GOOGLE_GEMINI_BASE_URL','GEMINI_API_KEY'].includes(key) && !sensitiveKey(key) && value.trim()) result[key] = value.trim()
      return JSON.stringify(result, null, 2)
    }
    throw new Error('仅 Claude、Codex 与 Gemini 支持通用配置片段')
  }

  function normalizeUrl(value) {
    return String(value || '').trim().replace(/\/+$/, '')
  }

  function parseEnvValues(content) {
    const values = {}
    for (const rawLine of String(content || '').split(/\r?\n/)) {
      const match = /^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(rawLine.trim())
      if (!match) continue
      let value = match[2].trim()
      if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
        value = value.slice(1, -1)
      }
      values[match[1]] = value
    }
    return values
  }

  function unescapeTomlString(value) {
    try { return JSON.parse(value) } catch { return value.slice(1, -1) }
  }

  function parseCodexRouting(content) {
    const text = String(content || '')
    const providerMatch = /^\s*model_provider\s*=\s*("(?:[^"\\]|\\.)*")\s*$/m.exec(text)
    const modelMatch = /^\s*model\s*=\s*("(?:[^"\\]|\\.)*")\s*$/m.exec(text)
    if (!providerMatch) return { baseUrl: '', model: modelMatch ? unescapeTomlString(modelMatch[1]) : '' }
    const providerId = unescapeTomlString(providerMatch[1])
    const escapedId = providerId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    const sectionMatch = new RegExp(
      `^\\s*\\[model_providers\\.${escapedId}\\]\\s*$([\\s\\S]*?)(?=^\\s*\\[|(?![\\s\\S]))`,
      'm'
    ).exec(text)
    const baseMatch = sectionMatch
      ? /^\s*base_url\s*=\s*("(?:[^"\\]|\\.)*")\s*$/m.exec(sectionMatch[1])
      : null
    const wireApiMatch = sectionMatch
      ? /^\s*wire_api\s*=\s*("(?:[^"\\]|\\.)*")\s*$/m.exec(sectionMatch[1])
      : null
    return {
      baseUrl: baseMatch ? unescapeTomlString(baseMatch[1]) : '',
      model: modelMatch ? unescapeTomlString(modelMatch[1]) : '',
      wireApi: wireApiMatch ? unescapeTomlString(wireApiMatch[1]) : 'responses'
    }
  }

  function parseTomlSection(text, section) {
    const escaped = section.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    const match = new RegExp(`^\\s*\\[${escaped}]\\s*$([\\s\\S]*?)(?=^\\s*\\[|(?![\\s\\S]))`, 'm').exec(String(text || ''))
    return match?.[1] || ''
  }

  function tomlString(section, key) {
    const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    const match = new RegExp(`^\\s*${escaped}\\s*=\\s*("(?:[^"\\\\]|\\\\.)*")\\s*$`, 'm').exec(section)
    return match ? unescapeTomlString(match[1]) : ''
  }

  function parseGrokRouting(content) {
    const models = parseTomlSection(content, 'models')
    const profile = tomlString(models, 'default')
    if (!profile) return { profile: '', baseUrl: '', model: '', apiKey: '', apiBackend: 'responses', contextWindow: 500000 }
    const quoted = `model\\.${JSON.stringify(profile).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`
    const bare = `model\\.${profile.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`
    const sectionMatch = new RegExp(`^\\s*\\[(?:${quoted}|${bare})]\\s*$([\\s\\S]*?)(?=^\\s*\\[|(?![\\s\\S]))`, 'm').exec(String(content || ''))
    const section = sectionMatch?.[1] || ''
    const contextMatch = /^\s*context_window\s*=\s*(\d+)\s*$/m.exec(section)
    const envKey = tomlString(section, 'env_key')
    return {
      profile,
      baseUrl: tomlString(section, 'base_url'),
      model: tomlString(section, 'model') || profile,
      name: tomlString(section, 'name'),
      apiKey: tomlString(section, 'api_key') || (envKey ? String(process.env[envKey] || '') : ''),
      apiBackend: tomlString(section, 'api_backend') || 'responses',
      contextWindow: Number(contextMatch?.[1]) || 500000
    }
  }

  function firstNonEmpty(object, keys) {
    if (!object || typeof object !== 'object') return ''
    for (const key of keys) {
      const value = object[key]
      if (typeof value === 'string' && value.trim()) return value.trim()
    }
    return ''
  }

  async function readText(filePath) {
    try {
      return await fsp.readFile(filePath, 'utf8')
    } catch (error) {
      if (error.code === 'ENOENT') return ''
      throw error
    }
  }

  /**
   * 按 cc-switch 的首次启动语义，将各客户端当前正在使用的配置导入为本地 Provider。
   * 每个客户端使用稳定 ID，重复导入会更新同一条记录，不会不断制造副本。
   */
  async function importLiveProviders() {
    const store = await loadStore()
    const candidates = []
    const skipped = []

    try {
      const settings = await readJson(paths.claude.settings, null)
      const env = settings && settings.env && typeof settings.env === 'object' ? settings.env : null
      const apiKey = firstNonEmpty(env, [
        'ANTHROPIC_AUTH_TOKEN',
        'ANTHROPIC_API_KEY',
        'OPENROUTER_API_KEY',
        'GOOGLE_API_KEY'
      ])
      if (env && apiKey) {
        candidates.push({
          id: 'imported-claude-current',
          name: 'Claude 当前配置',
          apiKey,
          baseUrl: firstNonEmpty(env, ['ANTHROPIC_BASE_URL']) || 'https://api.anthropic.com',
          model: firstNonEmpty(env, ['ANTHROPIC_MODEL']),
          claudeAuthField: firstNonEmpty(env, ['ANTHROPIC_AUTH_TOKEN'])
            ? 'ANTHROPIC_AUTH_TOKEN'
            : 'ANTHROPIC_API_KEY',
          clients: ['claude'],
          color: CLIENTS.claude.accent,
          source: 'imported'
        })
      } else {
        skipped.push({ client: 'claude', reason: '未发现可导入的 API Key' })
      }
    } catch (error) {
      skipped.push({ client: 'claude', reason: error.message })
    }

    try {
      const [configText, auth] = await Promise.all([
        readText(paths.codex.config),
        readJson(paths.codex.auth, {})
      ])
      const routing = parseCodexRouting(configText)
      const apiKey = firstNonEmpty(auth, ['OPENAI_API_KEY'])
      if (apiKey) {
        candidates.push({
          id: 'imported-codex-current',
          name: 'Codex 当前配置',
          apiKey,
          baseUrl: routing.baseUrl || 'https://api.openai.com/v1',
          model: routing.model,
          wireApi: routing.wireApi,
          clients: ['codex'],
          color: CLIENTS.codex.accent,
          source: 'imported'
        })
      } else {
        skipped.push({ client: 'codex', reason: '未发现 OPENAI_API_KEY' })
      }
    } catch (error) {
      skipped.push({ client: 'codex', reason: error.message })
    }

    try {
      const env = parseEnvValues(await readText(paths.gemini.env))
      const apiKey = firstNonEmpty(env, ['GEMINI_API_KEY', 'GOOGLE_API_KEY'])
      if (apiKey) {
        candidates.push({
          id: 'imported-gemini-current',
          name: 'Gemini 当前配置',
          apiKey,
          baseUrl: firstNonEmpty(env, ['GOOGLE_GEMINI_BASE_URL']) || 'https://generativelanguage.googleapis.com',
          model: firstNonEmpty(env, ['GEMINI_MODEL']),
          clients: ['gemini'],
          color: CLIENTS.gemini.accent,
          source: 'imported'
        })
      } else {
        skipped.push({ client: 'gemini', reason: '未发现 GEMINI_API_KEY 或 GOOGLE_API_KEY' })
      }
    } catch (error) {
      skipped.push({ client: 'gemini', reason: error.message })
    }

    try {
      const config = await readJson5(paths.opencode.config, {})
      const modelRef = String(config.model || '')
      const [providerId, model] = modelRef.split('/', 2)
      const item = config.provider && config.provider[providerId]
      const options = item && item.options
      const apiKey = firstNonEmpty(options, ['apiKey', 'api_key'])
      if (item && options && apiKey) {
        candidates.push({
          id: 'imported-opencode-current',
          name: item.name || 'OpenCode 当前配置',
          apiKey,
          baseUrl: firstNonEmpty(options, ['baseURL', 'baseUrl']) || 'https://api.openai.com/v1',
          model,
          clients: ['opencode'],
          color: CLIENTS.opencode.accent,
          source: 'imported'
        })
      } else skipped.push({ client: 'opencode', reason: '未发现当前 Provider API Key' })
    } catch (error) {
      skipped.push({ client: 'opencode', reason: error.message })
    }

    try {
      const config = await readJson5(paths.openclaw.config, {})
      const primary = config.agents?.defaults?.model?.primary || ''
      const [providerId, model] = String(primary).split('/', 2)
      const item = config.models?.providers?.[providerId]
      if (item && item.apiKey) {
        candidates.push({
          id: 'imported-openclaw-current',
          name: item.name || 'OpenClaw 当前配置',
          apiKey: item.apiKey,
          baseUrl: item.baseUrl || 'https://api.openai.com/v1',
          model: model || item.models?.[0]?.id || '',
          clients: ['openclaw'],
          color: CLIENTS.openclaw.accent,
          source: 'imported'
        })
      } else skipped.push({ client: 'openclaw', reason: '未发现当前 Provider API Key' })
    } catch (error) {
      skipped.push({ client: 'openclaw', reason: error.message })
    }

    try {
      const config = YAML.parse(await readText(paths.hermes.config)) || {}
      const item = (config.custom_providers || []).find((entry) => entry.name === config.model?.provider)
      if (item && item.api_key) {
        candidates.push({
          id: 'imported-hermes-current',
          name: item.name || 'Hermes 当前配置',
          apiKey: item.api_key,
          baseUrl: item.base_url || config.model?.base_url || 'https://api.openai.com/v1',
          model: config.model?.default || item.model || '',
          clients: ['hermes'],
          color: CLIENTS.hermes.accent,
          source: 'imported'
        })
      } else skipped.push({ client: 'hermes', reason: '未发现当前 Provider API Key' })
    } catch (error) {
      skipped.push({ client: 'hermes', reason: error.message })
    }

    try {
      const parsed = parseGrokRouting(await readText(paths.grokbuild.config))
      if (parsed.baseUrl && parsed.apiKey) candidates.push({ id: 'imported-grokbuild-current', name: parsed.name || 'GrokBuild 当前配置', apiKey: parsed.apiKey, baseUrl: parsed.baseUrl, model: parsed.model, wireApi: parsed.apiBackend, grokContextWindow: parsed.contextWindow, clients: ['grokbuild'], color: CLIENTS.grokbuild.accent, source: 'imported' })
      else skipped.push({ client: 'grokbuild', reason: '未发现自定义模型 API Key 与 Base URL' })
    } catch (error) { skipped.push({ client: 'grokbuild', reason: error.message }) }

    const imported = []
    for (const input of candidates) {
      const provider = validateProvider(input)
      const index = store.providers.findIndex((item) => item.id === provider.id)
      if (index >= 0) store.providers.splice(index, 1, provider)
      else store.providers.push(provider)
      store.active[provider.clients[0]] = provider.id
      imported.push({ id: provider.id, name: provider.name, client: provider.clients[0] })
    }
    if (imported.length) await saveStore(store)
    return { imported, skipped }
  }

  function matchLiveProvider(providers, client, live) {
    const liveBase = normalizeUrl(live.baseUrl)
    if (!liveBase) return null
    const candidates = providers.filter((provider) =>
      provider.clients.includes(client) && normalizeUrl(provider.baseUrl) === liveBase
    )
    if (!candidates.length) return null
    if (live.model) {
      const exactModel = candidates.find((provider) => provider.model === live.model)
      if (exactModel) return exactModel.id
    }
    return candidates[0].id
  }

  async function detectActiveProviders(store) {
    const detected = {}
    try {
      const claudeSettings = await readJson(paths.claude.settings, null)
      if (claudeSettings && claudeSettings.env) {
        detected.claude = matchLiveProvider(store.providers, 'claude', {
          baseUrl: claudeSettings.env.ANTHROPIC_BASE_URL,
          model: claudeSettings.env.ANTHROPIC_MODEL
        })
      }
    } catch (error) {
      console.warn('[cc-switch] 无法识别 Claude Code 当前 Provider:', error.message)
    }
    try {
      const codexText = await fsp.readFile(paths.codex.config, 'utf8')
      detected.codex = matchLiveProvider(store.providers, 'codex', parseCodexRouting(codexText))
    } catch (error) {
      if (error.code !== 'ENOENT') console.warn('[cc-switch] 无法识别 Codex 当前 Provider:', error.message)
    }
    try {
      const geminiText = await fsp.readFile(paths.gemini.env, 'utf8')
      const env = parseEnvValues(geminiText)
      detected.gemini = matchLiveProvider(store.providers, 'gemini', {
        baseUrl: env.GOOGLE_GEMINI_BASE_URL,
        model: env.GEMINI_MODEL
      })
    } catch (error) {
      if (error.code !== 'ENOENT') console.warn('[cc-switch] 无法识别 Gemini 当前 Provider:', error.message)
    }
    try {
      const config = await readJson5(paths.opencode.config, {})
      const [providerId, model] = String(config.model || '').split('/', 2)
      const item = config.provider?.[providerId]
      detected.opencode = matchLiveProvider(store.providers, 'opencode', {
        baseUrl: item?.options?.baseURL || item?.options?.baseUrl,
        model
      })
    } catch (error) {
      console.warn('[cc-switch] 无法识别 OpenCode 当前 Provider:', error.message)
    }
    try {
      const config = await readJson5(paths.openclaw.config, {})
      const [providerId, model] = String(config.agents?.defaults?.model?.primary || '').split('/', 2)
      const item = config.models?.providers?.[providerId]
      detected.openclaw = matchLiveProvider(store.providers, 'openclaw', { baseUrl: item?.baseUrl, model })
    } catch (error) {
      console.warn('[cc-switch] 无法识别 OpenClaw 当前 Provider:', error.message)
    }
    try {
      const config = YAML.parse(await readText(paths.hermes.config)) || {}
      const item = (config.custom_providers || []).find((entry) => entry.name === config.model?.provider)
      detected.hermes = matchLiveProvider(store.providers, 'hermes', {
        baseUrl: item?.base_url || config.model?.base_url,
        model: config.model?.default || item?.model
      })
    } catch (error) {
      console.warn('[cc-switch] 无法识别 Hermes 当前 Provider:', error.message)
    }
    try {
      detected.grokbuild = matchLiveProvider(store.providers, 'grokbuild', parseGrokRouting(await readText(paths.grokbuild.config)))
    } catch (error) { console.warn('[cc-switch] 无法识别 GrokBuild 当前 Provider:', error.message) }
    if (claudeDesktopManager && store.active['claude-desktop']) {
      try {
        const desktopStatus = await claudeDesktopManager.getStatus(await getRouterStatus())
        if (store.active['claude-desktop'] === OFFICIAL_PROVIDER_ID || (desktopStatus.configured && desktopStatus.appliedId === PROFILE_ID)) detected['claude-desktop'] = store.active['claude-desktop']
      } catch (error) { console.warn('[cc-switch] 无法识别 Claude Desktop 当前 Provider:', error.message) }
    }

    const nextActive = {}
    for (const client of Object.keys(CLIENTS)) {
      if (store.routes[client]?.enabled && store.active[client]) nextActive[client] = store.active[client]
      else if (detected[client]) nextActive[client] = detected[client]
    }
    if (JSON.stringify(nextActive) !== JSON.stringify(store.active)) {
      store.active = nextActive
      await saveStore(store)
    }
    return store
  }

  async function listProviders() {
    const store = await detectActiveProviders(await loadStore())
    return {
      providers: store.providers,
      active: store.active,
      sortOrders: store.sortOrders,
      clients: Object.values(CLIENTS)
    }
  }

  async function getActiveProvider(client) {
    if (!CLIENTS[client]) throw new Error(`不支持的客户端: ${client}`)
    const store = await loadStore()
    const providerId = store.active[client]
    return store.providers.find((item) => item.id === providerId) || null
  }

  async function getProvider(providerId) {
    const store = await loadStore()
    return store.providers.find((item) => item.id === providerId) || null
  }

  async function activateProvider(client, providerId) {
    if (!CLIENTS[client]) throw new Error(`不支持的客户端: ${client}`)
    const store = await loadStore()
    const provider = store.providers.find((item) => item.id === providerId)
    if (!provider || !provider.clients.includes(client)) throw new Error('Provider 不存在或不适用于该客户端')
    store.active[client] = provider.id
    await saveStore(store)
    return provider
  }

  async function getProviderCandidates(client) {
    if (!CLIENTS[client]) throw new Error(`不支持的客户端: ${client}`)
    const store = await loadStore()
    const active = store.providers.find((item) => item.id === store.active[client])
    const explicitQueue = await getFailoverQueueFromStore(store, client)
    const failover = explicitQueue.length
      ? explicitQueue.filter((item) => item.id !== active?.id)
      : store.providers.filter((item) => item.id !== active?.id && item.clients.includes(client) && (item.apiKey || item.authProvider) && item.failoverPriority > 0).sort((left, right) => left.failoverPriority - right.failoverPriority)
    return active ? [active, ...failover] : failover
  }

  function providerSummary(provider, client, priority = null) {
    return { providerId: provider.id, name: provider.name, client, priority, model: provider.model || '', color: provider.color || CLIENTS[client].accent, authConfigured: Boolean(provider.apiKey || provider.authProvider) }
  }

  async function getFailoverQueueFromStore(store, client) {
    if (!CLIENTS[client]) throw new Error(`不支持的客户端: ${client}`)
    const membership = new Set(store.failoverQueues[client] || [])
    const eligible = store.providers.filter((item) => membership.has(item.id) && item.clients.includes(client) && (item.apiKey || item.authProvider))
    const order = store.sortOrders[client] || store.providers.filter((item) => item.clients.includes(client)).map((item) => item.id)
    const index = new Map(order.map((id, position) => [id, position]))
    return eligible.sort((left, right) => (index.get(left.id) ?? Number.MAX_SAFE_INTEGER) - (index.get(right.id) ?? Number.MAX_SAFE_INTEGER))
  }

  async function getFailoverQueue(client) {
    const store = await loadStore(); const queue = await getFailoverQueueFromStore(store, client)
    return queue.map((provider, index) => providerSummary(provider, client, index + 1))
  }

  async function getAvailableProvidersForFailover(client) {
    if (!CLIENTS[client]) throw new Error(`不支持的客户端: ${client}`)
    const store = await loadStore(); const membership = new Set(store.failoverQueues[client] || [])
    return store.providers.filter((item) => item.clients.includes(client) && !membership.has(item.id) && (item.apiKey || item.authProvider)).map((item) => providerSummary(item, client))
  }

  async function addToFailoverQueue(client, providerIdInput) {
    if (!CLIENTS[client]) throw new Error(`不支持的客户端: ${client}`)
    const providerId = String(providerIdInput || ''); const store = await loadStore()
    const provider = store.providers.find((item) => item.id === providerId && item.clients.includes(client) && (item.apiKey || item.authProvider))
    if (!provider) throw new Error('Provider 不存在、不适用于该客户端或未配置认证')
    store.failoverQueues[client] = store.failoverQueues[client] || []
    if (!store.failoverQueues[client].includes(providerId)) store.failoverQueues[client].push(providerId)
    await saveStore(store); return getFailoverQueue(client)
  }

  async function removeFromFailoverQueue(client, providerIdInput) {
    if (!CLIENTS[client]) throw new Error(`不支持的客户端: ${client}`)
    const providerId = String(providerIdInput || ''); const store = await loadStore()
    store.failoverQueues[client] = (store.failoverQueues[client] || []).filter((id) => id !== providerId)
    await saveStore(store); return getFailoverQueue(client)
  }

  async function saveProvider(input) {
    const provider = validateProvider(input)
    const store = await loadStore()
    const index = store.providers.findIndex((item) => item.id === provider.id)
    if (index >= 0) {
      provider.source = store.providers[index].source || provider.source
      store.providers.splice(index, 1, provider)
    } else {
      provider.source = 'custom'
      store.providers.push(provider)
    }
    store.hiddenPresetIds = store.hiddenPresetIds.filter((id) => id !== provider.id)
    await saveStore(store)
    return provider
  }

  async function updateProviderSortOrder(client, orderedIds) {
    if (!CLIENTS[client]) throw new Error(`不支持的客户端: ${client}`)
    if (!Array.isArray(orderedIds)) throw new Error('排序列表必须是数组')
    const store = await loadStore()
    const eligible = store.providers.filter((item) => item.clients.includes(client)).map((item) => item.id)
    const expected = new Set(eligible)
    const normalized = orderedIds.map((id) => String(id || '')).filter(Boolean)
    if (normalized.length !== eligible.length || new Set(normalized).size !== normalized.length || normalized.some((id) => !expected.has(id))) {
      throw new Error('排序列表必须完整且不能包含重复或跨客户端 Provider')
    }
    store.sortOrders[client] = normalized
    await saveStore(store)
    return normalized
  }

  function normalizeEndpointUrl(value, required = false) {
    const raw = String(value || '').trim().replace(/\/+$/, '')
    if (!raw) { if (required) throw new Error('URL 不能为空'); return '' }
    let parsed
    try { parsed = new URL(raw) } catch { throw new Error('端点 URL 无效') }
    if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password) throw new Error('端点必须是无内嵌凭据的 HTTP(S) URL')
    return parsed.href.replace(/\/$/, '')
  }

  async function getCustomEndpoints(client, providerId) {
    if (!CLIENTS[client]) throw new Error('未知客户端')
    const provider = await getProvider(providerId)
    if (!provider || !provider.clients.includes(client)) return []
    return [...(provider.customEndpointsByClient?.[client] || [])].sort((a, b) => b.addedAt - a.addedAt)
  }

  async function addCustomEndpoint(client, providerId, value) {
    const url = normalizeEndpointUrl(value, true)
    const store = await loadStore(); const provider = store.providers.find((item) => item.id === providerId)
    if (!provider || !provider.clients.includes(client)) throw new Error('Provider 不存在或不适用于该客户端')
    provider.customEndpointsByClient = provider.customEndpointsByClient && typeof provider.customEndpointsByClient === 'object' ? provider.customEndpointsByClient : {}
    const rows = Array.isArray(provider.customEndpointsByClient[client]) ? provider.customEndpointsByClient[client] : []
    if (!rows.some((item) => item.url === url)) rows.unshift({ url, addedAt: Date.now(), lastUsed: null })
    provider.customEndpointsByClient[client] = rows
    await saveStore(store)
    return rows
  }

  async function removeCustomEndpoint(client, providerId, value) {
    const url = normalizeEndpointUrl(value, true)
    const store = await loadStore(); const provider = store.providers.find((item) => item.id === providerId)
    if (!provider) return false
    provider.customEndpointsByClient = provider.customEndpointsByClient || {}
    provider.customEndpointsByClient[client] = (provider.customEndpointsByClient[client] || []).filter((item) => item.url !== url)
    await saveStore(store); return true
  }

  async function selectCustomEndpoint(client, providerId, value) {
    const url = normalizeEndpointUrl(value, true)
    const store = await loadStore(); const provider = store.providers.find((item) => item.id === providerId)
    if (!provider || !provider.clients.includes(client)) throw new Error('Provider 不存在或不适用于该客户端')
    const endpoint = (provider.customEndpointsByClient?.[client] || []).find((item) => item.url === url)
    if (!endpoint && normalizeEndpointUrl(provider.baseUrl) !== url) throw new Error('端点不属于该 Provider')
    provider.baseUrl = url
    if (endpoint) endpoint.lastUsed = Date.now()
    await saveStore(store)
    if (store.active[client] === provider.id) await switchProvider(client, provider.id)
    return { providerId, client, baseUrl: url, applied: store.active[client] === provider.id }
  }

  async function deleteProvider(providerId) {
    if (providerId === OFFICIAL_PROVIDER_ID) throw new Error('Claude Desktop Official Provider 不能删除')
    const store = await loadStore()
    const existing = store.providers.find((item) => item.id === providerId)
    if (!existing) return false
    store.providers = store.providers.filter((item) => item.id !== providerId)
    if (existing.source === 'preset' && !store.hiddenPresetIds.includes(providerId)) {
      store.hiddenPresetIds.push(providerId)
    }
    for (const client of Object.keys(store.active)) {
      if (store.active[client] === providerId) delete store.active[client]
    }
    for (const client of Object.keys(store.failoverQueues || {})) store.failoverQueues[client] = (store.failoverQueues[client] || []).filter((id) => id !== providerId)
    await saveStore(store)
    return true
  }

  async function writeClaude(provider) {
    const settings = await readJson(paths.claude.settings, {})
    settings.env = settings.env && typeof settings.env === 'object' ? settings.env : {}
    const authField = provider.claudeAuthField === 'ANTHROPIC_API_KEY'
      ? 'ANTHROPIC_API_KEY'
      : 'ANTHROPIC_AUTH_TOKEN'
    const staleField = authField === 'ANTHROPIC_API_KEY'
      ? 'ANTHROPIC_AUTH_TOKEN'
      : 'ANTHROPIC_API_KEY'
    settings.env[authField] = provider.apiKey
    delete settings.env[staleField]
    settings.env.ANTHROPIC_BASE_URL = provider.baseUrl
    if (provider.model) settings.env.ANTHROPIC_MODEL = provider.model
    else delete settings.env.ANTHROPIC_MODEL
    for (const [field, value] of Object.entries({
      ANTHROPIC_DEFAULT_HAIKU_MODEL: provider.claudeHaikuModel,
      ANTHROPIC_DEFAULT_SONNET_MODEL: provider.claudeSonnetModel,
      ANTHROPIC_DEFAULT_OPUS_MODEL: provider.claudeOpusModel
    })) {
      if (value) settings.env[field] = value
      else delete settings.env[field]
    }
    if (provider.commonConfigEnabled) {
      const snippet = await getCommonConfigSnippet('claude')
      if (snippet.trim()) deepMerge(settings, JSON.parse(snippet))
    }
    await writeJson(paths.claude.settings, settings)
  }

  function escapeToml(value) {
    return JSON.stringify(String(value))
  }

  function stripManagedCodexConfig(input) {
    const lines = String(input || '').split(/\r?\n/)
    const output = []
    let inManagedBlock = false
    let inZtoolsSection = false
    let currentSection = ''

    for (const line of lines) {
      if (line.trim() === '# >>> ztools-cc-switch >>>') {
        inManagedBlock = true
        continue
      }
      if (line.trim() === '# <<< ztools-cc-switch <<<') {
        inManagedBlock = false
        continue
      }
      if (inManagedBlock) continue

      const sectionMatch = /^\s*\[([^\]]+)]\s*$/.exec(line)
      if (sectionMatch) {
        currentSection = sectionMatch[1]
        inZtoolsSection = currentSection === 'model_providers.ztools_cc_switch'
        if (inZtoolsSection) continue
      } else if (inZtoolsSection) {
        continue
      }

      // 顶层 model/model_provider 会与托管段冲突；其他 section 内同名字段保留。
      if (!currentSection && /^\s*(model|model_provider)\s*=/.test(line)) continue
      output.push(line)
    }
    return output.join('\n').trimEnd()
  }

  async function writeCodex(provider) {
    const currentToml = await fsp.readFile(paths.codex.config, 'utf8').catch((error) => {
      if (error.code === 'ENOENT') return ''
      throw error
    })
    const preserved = stripManagedCodexConfig(currentToml)
    const block = [
      '# >>> ztools-cc-switch >>>',
      `model = ${escapeToml(provider.model || 'gpt-5')}`,
      ...(provider.codexReasoningEffort ? [`model_reasoning_effort = ${escapeToml(provider.codexReasoningEffort)}`] : []),
      'model_provider = "ztools_cc_switch"',
      '',
      '[model_providers.ztools_cc_switch]',
      `name = ${escapeToml(provider.name)}`,
      `base_url = ${escapeToml(provider.baseUrl)}`,
      'env_key = "OPENAI_API_KEY"',
      `wire_api = ${escapeToml(provider.wireApi || 'responses')}`,
      '# <<< ztools-cc-switch <<<'
    ].join('\n')
    const configExisted = fs.existsSync(paths.codex.config)
    let nextConfig = `${preserved ? `${preserved}\n\n` : ''}${block}\n`
    if (provider.commonConfigEnabled) {
      const snippet = await getCommonConfigSnippet('codex')
      if (snippet.trim()) {
        if (!sidecar?.isAvailable()) throw new Error('Codex 通用配置应用需要 Rust sidecar')
        nextConfig = await sidecar.updateTomlCommonConfig(nextConfig, snippet, true)
      }
    }
    await atomicWrite(paths.codex.config, nextConfig)

    try {
      // 只更新 API Key，保留 Codex/ChatGPT 既有登录材料。
      const auth = await readJson(paths.codex.auth, {})
      auth.OPENAI_API_KEY = provider.apiKey
      await writeJson(paths.codex.auth, auth)
    } catch (error) {
      // 两文件切换失败时恢复 config.toml，避免出现半切换状态。
      if (configExisted) await replaceWithoutBackup(paths.codex.config, currentToml)
      else await fsp.rm(paths.codex.config, { force: true })
      throw error
    }
  }

  async function replaceWithoutBackup(filePath, content) {
    await fsp.mkdir(path.dirname(filePath), { recursive: true })
    const tempPath = `${filePath}.${process.pid}.${Date.now()}.${crypto.randomBytes(4).toString('hex')}.restore.tmp`
    try {
      await fsp.writeFile(tempPath, content, { encoding: 'utf8', mode: 0o600 })
      await fsp.rename(tempPath, filePath)
    } catch (error) {
      await fsp.rm(tempPath, { force: true }).catch(() => {})
      throw error
    }
  }

  function updateGeminiEnv(content, provider, common = {}) {
    const managedKeys = new Set(['GEMINI_API_KEY', 'GOOGLE_GEMINI_BASE_URL', 'GEMINI_MODEL'])
    const lines = String(content || '').split(/\r?\n/)
    const preserved = []
    let inManagedBlock = false
    for (const rawLine of lines) {
      const trimmed = rawLine.trim()
      if (trimmed === '# >>> ztools-cc-switch >>>') {
        inManagedBlock = true
        continue
      }
      if (trimmed === '# <<< ztools-cc-switch <<<') {
        inManagedBlock = false
        continue
      }
      if (inManagedBlock) continue
      const assignment = /^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=/.exec(trimmed)
      if (assignment && managedKeys.has(assignment[1])) continue
      preserved.push(rawLine)
    }
    while (preserved.length && !preserved[preserved.length - 1].trim()) preserved.pop()
    let commonBlock = false
    const filtered = []
    for (const rawLine of preserved) {
      const value = rawLine.trim()
      if (value === '# >>> ztools-common-config >>>') { commonBlock = true; continue }
      if (value === '# <<< ztools-common-config <<<') { commonBlock = false; continue }
      if (!commonBlock) filtered.push(rawLine)
    }
    const managed = [
      '# >>> ztools-cc-switch >>>',
      `GEMINI_API_KEY=${provider.apiKey}`,
      `GOOGLE_GEMINI_BASE_URL=${provider.baseUrl}`,
      ...(provider.model ? [`GEMINI_MODEL=${provider.model}`] : []),
      '# <<< ztools-cc-switch <<<'
    ]
    const commonLines = Object.entries(common).map(([key, value]) => `${key}=${value}`)
    if (commonLines.length) commonLines.unshift('# >>> ztools-common-config >>>'), commonLines.push('# <<< ztools-common-config <<<')
    return `${filtered.length ? `${filtered.join('\n')}\n\n` : ''}${managed.join('\n')}${commonLines.length ? `\n\n${commonLines.join('\n')}` : ''}\n`
  }

  async function writeGemini(provider) {
    const currentEnv = await fsp.readFile(paths.gemini.env, 'utf8').catch((error) => {
      if (error.code === 'ENOENT') return ''
      throw error
    })
    const envExisted = fs.existsSync(paths.gemini.env)
    const snippet = provider.commonConfigEnabled ? await getCommonConfigSnippet('gemini') : ''
    const common = snippet.trim() ? JSON.parse(snippet) : {}
    await atomicWrite(paths.gemini.env, updateGeminiEnv(currentEnv, provider, common))

    try {
      const settings = await readJson(paths.gemini.settings, {})
      settings.security = settings.security && typeof settings.security === 'object' ? settings.security : {}
      settings.security.auth = settings.security.auth && typeof settings.security.auth === 'object'
        ? settings.security.auth
        : {}
      settings.security.auth.selectedType = 'gemini-api-key'
      await writeJson(paths.gemini.settings, settings)
    } catch (error) {
      if (envExisted) await replaceWithoutBackup(paths.gemini.env, currentEnv)
      else await fsp.rm(paths.gemini.env, { force: true })
      throw error
    }
  }

  async function writeOpenCode(provider) {
    const config = await readJson5(paths.opencode.config, { $schema: 'https://opencode.ai/config.json' })
    config.provider = config.provider && typeof config.provider === 'object' ? config.provider : {}
    if (provider.id !== 'ztools_cc_switch') delete config.provider.ztools_cc_switch
    config.provider[provider.id] = {
      name: provider.name,
      npm: '@ai-sdk/openai-compatible',
      options: { baseURL: provider.baseUrl, apiKey: provider.apiKey },
      models: provider.model ? { [provider.model]: { name: provider.model } } : {}
    }
    if (provider.model) config.model = `${provider.id}/${provider.model}`
    await writeJson(paths.opencode.config, config)
  }

  async function writeOpenClaw(provider) {
    const config = await readJson5(paths.openclaw.config, {})
    config.models = config.models && typeof config.models === 'object' ? config.models : {}
    config.models.mode = config.models.mode || 'merge'
    config.models.providers = config.models.providers && typeof config.models.providers === 'object'
      ? config.models.providers
      : {}
    if (provider.id !== 'ztools_cc_switch') delete config.models.providers.ztools_cc_switch
    config.models.providers[provider.id] = {
      baseUrl: provider.baseUrl,
      apiKey: provider.apiKey,
      api: provider.apiType === 'anthropic' ? 'anthropic-messages' : 'openai-completions',
      models: provider.model ? [{ id: provider.model, name: provider.model }] : []
    }
    config.agents = config.agents && typeof config.agents === 'object' ? config.agents : {}
    config.agents.defaults = config.agents.defaults && typeof config.agents.defaults === 'object'
      ? config.agents.defaults
      : {}
    config.agents.defaults.model = {
      ...(config.agents.defaults.model && typeof config.agents.defaults.model === 'object'
        ? config.agents.defaults.model
        : {}),
      primary: `${provider.id}/${provider.model}`
    }
    await writeJson(paths.openclaw.config, config)
  }

  async function writeHermes(provider) {
    const source = await readText(paths.hermes.config)
    let config = {}
    try { config = YAML.parse(source) || {} } catch (error) {
      throw new Error(`读取 YAML 失败 (${paths.hermes.config}): ${error.message}`)
    }
    config.model = config.model && typeof config.model === 'object' ? config.model : {}
    config.model.default = provider.model
    config.model.provider = provider.id
    config.model.base_url = provider.baseUrl
    const providers = Array.isArray(config.custom_providers) ? config.custom_providers : []
    if (provider.id !== 'ztools_cc_switch') {
      const legacyIndex = providers.findIndex((item) => item?.name === 'ztools_cc_switch')
      if (legacyIndex >= 0) providers.splice(legacyIndex, 1)
    }
    const managed = {
      name: provider.id,
      base_url: provider.baseUrl,
      api_key: provider.apiKey,
      model: provider.model
    }
    const index = providers.findIndex((item) => item?.name === managed.name)
    if (index >= 0) providers.splice(index, 1, { ...providers[index], ...managed })
    else providers.push(managed)
    config.custom_providers = providers
    await atomicWrite(paths.hermes.config, YAML.stringify(config))
  }

  function safeLiveProviderId(value) {
    const id = String(value || '').trim()
    if (!id || id === '__proto__' || id === 'constructor' || id === 'prototype' || id.length > 240 || /[\0\r\n]/.test(id)) throw new Error('Live Provider ID 无效')
    return id
  }

  async function readAdditiveLiveConfig(client) {
    if (client === 'opencode') return readJson5(paths.opencode.config, {})
    if (client === 'openclaw') return readJson5(paths.openclaw.config, {})
    if (client === 'hermes') {
      const source = await readText(paths.hermes.config)
      try { return YAML.parse(source) || {} } catch (error) { throw new Error(`读取 YAML 失败 (${paths.hermes.config}): ${error.message}`) }
    }
    throw new Error(`${CLIENTS[client]?.name || client} 不支持累加式 Live Provider`)
  }

  function additiveLiveEntries(client, config) {
    if (client === 'opencode') return config.provider && typeof config.provider === 'object' ? config.provider : {}
    if (client === 'openclaw') return config.models?.providers && typeof config.models.providers === 'object' ? config.models.providers : {}
    const result = {}
    for (const item of Array.isArray(config.custom_providers) ? config.custom_providers : []) if (item?.name) result[item.name] = item
    for (const [key, item] of Object.entries(config.providers && typeof config.providers === 'object' ? config.providers : {})) {
      const name = String(item?.name || key)
      if (!Object.hasOwn(result, name)) result[name] = { ...item, _readOnlyOverlay: true }
    }
    return result
  }

  async function listLiveProviderIds(clientInput) {
    const client = String(clientInput || '')
    return Object.keys(additiveLiveEntries(client, await readAdditiveLiveConfig(client))).sort((a, b) => a.localeCompare(b))
  }

  function redactLiveFragment(value) {
    if (Array.isArray(value)) return value.map(redactLiveFragment)
    if (!value || typeof value !== 'object') return value
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, /(?:api.?key|token|secret|password|authorization)/i.test(key) ? (item ? '••••••••' : item) : redactLiveFragment(item)]))
  }

  async function getLiveProviderFragment(clientInput, idInput) {
    const client = String(clientInput || ''); const id = safeLiveProviderId(idInput)
    const item = additiveLiveEntries(client, await readAdditiveLiveConfig(client))[id]
    return item ? redactLiveFragment(item) : null
  }

  async function removeProviderFromLiveConfig(clientInput, idInput) {
    const client = String(clientInput || ''); const id = safeLiveProviderId(idInput)
    const config = await readAdditiveLiveConfig(client)
    let removed = false
    if (client === 'opencode') {
      if (config.provider && typeof config.provider === 'object') removed = delete config.provider[id]
      if (removed) await writeJson(paths.opencode.config, config)
    } else if (client === 'openclaw') {
      const providers = config.models?.providers
      if (providers && typeof providers === 'object') removed = delete providers[id]
      if (removed) await writeJson(paths.openclaw.config, config)
    } else {
      const custom = Array.isArray(config.custom_providers) ? config.custom_providers : []
      const next = custom.filter((item) => item?.name !== id)
      if (next.length !== custom.length) { config.custom_providers = next; removed = true; await atomicWrite(paths.hermes.config, YAML.stringify(config)) }
      else if (additiveLiveEntries(client, config)[id]?._readOnlyOverlay) throw new Error('该 Provider 由 Hermes providers 映射管理，请在 Hermes Web UI 中移除')
    }
    return { client, id, removed }
  }

  function stripManagedGrokConfig(input) {
    const lines = String(input || '').split(/\r?\n/); const output = []; let managed = false; let skipSection = false
    for (const line of lines) {
      if (line.trim() === '# >>> ztools-cc-switch-grok >>>') { managed = true; continue }
      if (line.trim() === '# <<< ztools-cc-switch-grok <<<') { managed = false; continue }
      if (managed) continue
      const section = /^\s*\[([^\]]+)]\s*$/.exec(line)
      if (section) skipSection = section[1] === 'models' || section[1] === 'model.ztools_cc_switch' || section[1] === 'model."ztools_cc_switch"'
      if (!skipSection) output.push(line)
    }
    return output.join('\n').trimEnd()
  }

  async function writeGrokBuild(provider) {
    const current = await readText(paths.grokbuild.config); const preserved = stripManagedGrokConfig(current)
    const block = ['# >>> ztools-cc-switch-grok >>>', '[models]', 'default = "ztools_cc_switch"', '', '[model.ztools_cc_switch]', `model = ${escapeToml(provider.model || 'grok-4.5')}`, `base_url = ${escapeToml(provider.baseUrl)}`, `name = ${escapeToml(provider.name)}`, `api_key = ${escapeToml(provider.apiKey)}`, `api_backend = ${escapeToml(provider.wireApi || 'responses')}`, `context_window = ${Math.max(1, Number(provider.grokContextWindow) || 500000)}`, '# <<< ztools-cc-switch-grok <<<'].join('\n')
    await atomicWrite(paths.grokbuild.config, `${preserved ? `${preserved}\n\n` : ''}${block}\n`)
  }

  async function captureClientFiles(client) {
    const snapshots = {}
    for (const [name, filePath] of Object.entries(paths[client])) {
      try {
        snapshots[name] = { path: filePath, existed: true, data: (await fsp.readFile(filePath)).toString('base64') }
      } catch (error) {
        if (error.code !== 'ENOENT') throw error
        snapshots[name] = { path: filePath, existed: false, data: '' }
      }
    }
    return snapshots
  }

  async function restoreClientFiles(snapshots) {
    for (const snapshot of Object.values(snapshots || {})) {
      if (snapshot.existed) await replaceWithoutBackup(snapshot.path, Buffer.from(snapshot.data, 'base64'))
      else await fsp.rm(snapshot.path, { force: true })
    }
  }

  async function setClientRouting(client, enabled, routerUrl) {
    if (!['claude', 'codex', 'gemini', 'opencode', 'openclaw', 'hermes', 'grokbuild'].includes(client)) throw new Error(`${CLIENTS[client]?.name || client} 暂不支持本地路由接管`)
    const store = await loadStore()
    const current = store.routes[client]
    if (enabled) {
      if (current?.enabled) return { client, enabled: true, providerId: store.active[client] }
      const provider = store.providers.find((item) => item.id === store.active[client])
      if (!provider) throw new Error(`请先为 ${CLIENTS[client].name} 启用一个 Provider`)
      const parsed = new URL(routerUrl)
      if (!['127.0.0.1', 'localhost', '[::1]'].includes(parsed.hostname)) throw new Error('路由接管地址必须是本机回环地址')
      const snapshots = await captureClientFiles(client)
      const routePrefixes = { codex: '/v1', opencode: '/opencode/v1', openclaw: '/openclaw/v1', hermes: '/hermes/v1', grokbuild: '/grokbuild/v1' }
      const routedProvider = {
        ...provider,
        baseUrl: `${parsed.origin}${routePrefixes[client] || ''}`
      }
      try {
        if (sidecar && sidecar.isAvailable() && ['claude', 'codex', 'gemini'].includes(client) && !routedProvider.commonConfigEnabled) await sidecar.applyClient(client, homeDir, routedProvider)
        else {
          if (client === 'claude') await writeClaude(routedProvider)
          if (client === 'codex') await writeCodex(routedProvider)
          if (client === 'gemini') await writeGemini(routedProvider)
          if (client === 'opencode') await writeOpenCode(routedProvider)
          if (client === 'openclaw') await writeOpenClaw(routedProvider)
          if (client === 'hermes') await writeHermes(routedProvider)
          if (client === 'grokbuild') await writeGrokBuild(routedProvider)
        }
      } catch (error) {
        await restoreClientFiles(snapshots).catch(() => {})
        throw error
      }
      store.routes[client] = { enabled: true, routerUrl: parsed.origin, snapshots, enabledAt: Date.now() }
      await saveStore(store)
      return { client, enabled: true, providerId: provider.id }
    }
    if (!current?.enabled) return { client, enabled: false, providerId: store.active[client] || null }
    await restoreClientFiles(current.snapshots)
    delete store.routes[client]
    await saveStore(store)
    return { client, enabled: false, providerId: store.active[client] || null }
  }

  async function switchProvider(client, providerId) {
    if (!CLIENTS[client]) throw new Error(`不支持的客户端: ${client}`)
    const store = await loadStore()
    const provider = store.providers.find((item) => item.id === providerId)
    if (!provider) throw new Error('Provider 不存在')
    if (!provider.clients.includes(client)) throw new Error(`${provider.name} 不支持 ${CLIENTS[client].name}`)
    if (client === 'claude-desktop') {
      if (!claudeDesktopManager) throw new Error('Claude Desktop 管理器未加载')
      if (provider.id !== OFFICIAL_PROVIDER_ID && !provider.apiKey && !provider.authProvider) throw new Error('请先填写 API Key 或绑定登录账号')
      await claudeDesktopManager.applyProvider(provider, await getRouterStatus())
      store.active[client] = provider.id
      await saveStore(store)
      return { client, providerId, providerName: provider.name, routed: provider.claudeDesktopMode === 'proxy' }
    }
    if (!provider.apiKey) throw new Error('请先填写 API Key')

    if (store.routes[client]?.enabled) {
      store.active[client] = provider.id
      await saveStore(store)
      return { client, providerId, providerName: provider.name, routed: true }
    }
    if (sidecar && sidecar.isAvailable() && ['claude', 'codex', 'gemini'].includes(client) && !provider.commonConfigEnabled) {
      await sidecar.applyClient(client, homeDir, provider)
    } else {
      // 开发环境和未提供当前平台二进制的源码运行保持可测试降级；
      // 正式 build 会先强制生成并打包 sidecar。
      if (client === 'claude') await writeClaude(provider)
      if (client === 'codex') await writeCodex(provider)
      if (client === 'gemini') await writeGemini(provider)
      if (client === 'opencode') await writeOpenCode(provider)
      if (client === 'openclaw') await writeOpenClaw(provider)
      if (client === 'hermes') await writeHermes(provider)
      if (client === 'grokbuild') await writeGrokBuild(provider)
    }
    store.active[client] = provider.id
    await saveStore(store)
    return { client, providerId, providerName: provider.name }
  }

  function modelsEndpoint(provider, client) {
    const base = provider.baseUrl.replace(/\/+$/, '')
    if (client === 'gemini') {
      const root = base.replace(/\/v1beta$/i, '')
      return `${root}/v1beta/models?key=${encodeURIComponent(provider.apiKey)}`
    }
    if (/\/v1$/i.test(base)) return `${base}/models`
    return `${base}/v1/models`
  }

  async function testProvider(providerId, client) {
    if (!CLIENTS[client]) throw new Error('未知客户端')
    const store = await loadStore()
    const provider = store.providers.find((item) => item.id === providerId)
    if (!provider) throw new Error('Provider 不存在')
    let credential = provider.apiKey
    if (!credential && provider.authProvider && resolveProviderAuth) credential = (await resolveProviderAuth(provider))?.token || ''
    if (!credential) throw new Error(provider.authProvider ? '绑定账号不可用，请前往认证中心重新登录' : '请先填写 API Key')

    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 10000)
    const start = performance.now()
    try {
      const headers = { Accept: 'application/json' }
      if (client === 'claude' || client === 'claude-desktop' || provider.apiType === 'anthropic') {
        headers['x-api-key'] = credential
        headers['anthropic-version'] = '2023-06-01'
      } else if (client !== 'gemini') {
        headers.Authorization = `Bearer ${credential}`
      }
      const response = await fetchImpl(modelsEndpoint(provider, client), {
        method: 'GET',
        headers,
        signal: controller.signal
      })
      const latency = Math.round(performance.now() - start)
      const ok = response.ok
      return {
        ok,
        reachable: response.status < 500,
        latency,
        status: response.status,
        message: ok ? `连接成功 · ${latency} ms` : `服务已响应 · HTTP ${response.status}`
      }
    } catch (error) {
      const timeoutError = error.name === 'AbortError'
      return {
        ok: false,
        reachable: false,
        latency: Math.round(performance.now() - start),
        status: 0,
        message: timeoutError ? '连接超时（10 秒）' : `连接失败：${error.message}`
      }
    } finally {
      clearTimeout(timeout)
    }
  }

  async function getClientStatus() {
    const store = await detectActiveProviders(await loadStore())
    const result = {}
    for (const [client, clientPaths] of Object.entries(paths)) {
      const entries = {}
      for (const [name, filePath] of Object.entries(clientPaths)) {
        entries[name] = { path: filePath, exists: fs.existsSync(filePath) }
      }
      result[client] = {
        ...CLIENTS[client],
        activeProviderId: store.active[client] || null,
        routed: Boolean(store.routes[client]?.enabled),
        paths: entries
      }
      if (['opencode', 'openclaw', 'hermes'].includes(client)) result[client].liveProviderIds = await listLiveProviderIds(client)
    }
    if (claudeDesktopManager) {
      const desktopStatus = await claudeDesktopManager.getStatus(await getRouterStatus())
      result['claude-desktop'] = {
        ...CLIENTS['claude-desktop'],
        activeProviderId: desktopStatus.configured ? (store.active['claude-desktop'] || null) : null,
        routed: Boolean(store.active['claude-desktop'] && store.providers.find((item) => item.id === store.active['claude-desktop'])?.claudeDesktopMode === 'proxy'),
        supported: desktopStatus.supported,
        desktopStatus,
        paths: desktopStatus.supported ? {
          profile: { path: desktopStatus.profilePath, exists: desktopStatus.configured },
          configLibrary: { path: desktopStatus.configLibraryPath, exists: fs.existsSync(desktopStatus.configLibraryPath) }
        } : {}
      }
    }
    return result
  }

  async function getClientConfigDirectoryInfo(clientInput) {
    const client = String(clientInput || '')
    if (!CLIENTS[client]) throw new Error('不支持的客户端')
    if (client === 'claude-desktop') {
      if (!claudeDesktopManager) throw new Error('当前平台不支持 Claude Desktop 配置库')
      const status = await claudeDesktopManager.getStatus(await getRouterStatus())
      if (!status.supported || !status.configLibraryPath) throw new Error('当前平台不支持 Claude Desktop 配置库')
      return { client, name: CLIENTS[client].name, path: path.resolve(status.configLibraryPath), exists: fs.existsSync(status.configLibraryPath) }
    }
    const primaryKeys = { claude: 'settings', codex: 'config', gemini: 'settings', opencode: 'config', openclaw: 'config', hermes: 'config', grokbuild: 'config' }
    const primaryFile = paths[client]?.[primaryKeys[client]]
    if (!primaryFile) throw new Error(`${CLIENTS[client].name} 主配置路径不存在`)
    // Claude 的兼容状态文件位于 ~/.claude.json；仍只打开固定主目录 ~/.claude，绝不向上扩大到整个 Home。
    const directory = path.dirname(path.resolve(primaryFile))
    return { client, name: CLIENTS[client].name, path: directory, exists: fs.existsSync(directory) }
  }

  async function importClaudeDesktopProvidersFromClaude() {
    const store = await loadStore()
    const imported = []
    for (const source of store.providers.filter((item) => item.clients.includes('claude') && item.id !== OFFICIAL_PROVIDER_ID)) {
      if (source.clients.includes('claude-desktop')) continue
      const requested = [source.claudeSonnetModel, source.claudeOpusModel, source.claudeHaikuModel, source.model].filter(Boolean)
      const direct = source.apiType === 'anthropic' && !source.authProvider && !source.isFullUrl && requested.every((model) => /^((anthropic\/)?claude-)/i.test(model))
      const routes = requested.map((model, index) => {
        const normalizedModel = model.replace(/\s*\[1m\]\s*$/i, '')
        return {
        routeId: direct ? normalizedModel : ['claude-sonnet-5', 'claude-opus-4-8', 'claude-haiku-4-5'][Math.min(index, 2)],
        upstreamModel: normalizedModel,
        labelOverride: direct ? '' : normalizedModel,
        supports1m: /\[1m\]$/i.test(model)
      } })
      source.clients = [...source.clients, 'claude-desktop']
      source.claudeDesktopMode = direct ? 'direct' : 'proxy'
      source.claudeDesktopApiFormat = ({ openai_compat: 'openai_chat', responses: 'openai_responses', gemini: 'gemini_native' }[source.apiType] || 'anthropic')
      source.claudeDesktopRoutes = normalizeRoutes(routes, source.claudeDesktopMode)
      imported.push(source.id)
    }
    if (imported.length) await saveStore(store)
    return { imported, skipped: store.providers.filter((item) => item.clients.includes('claude') && !imported.includes(item.id)).map((item) => item.id) }
  }

  async function getClaudeOnboardingStatus() {
    const filePath = paths.claude.legacyState
    const root = await readJson(filePath, {})
    if (!root || typeof root !== 'object' || Array.isArray(root)) throw new Error('~/.claude.json 根必须是对象')
    return { enabled: root.hasCompletedOnboarding === true, configured: Object.hasOwn(root, 'hasCompletedOnboarding'), path: filePath }
  }

  async function setClaudeOnboardingSkip(enabled) {
    const filePath = paths.claude.legacyState
    if (!enabled && !fs.existsSync(filePath)) return { enabled: false, changed: false, path: filePath }
    const root = await readJson(filePath, {})
    if (!root || typeof root !== 'object' || Array.isArray(root)) throw new Error('~/.claude.json 根必须是对象')
    const current = root.hasCompletedOnboarding === true
    if (enabled && current) return { enabled: true, changed: false, path: filePath }
    if (!enabled && !Object.hasOwn(root, 'hasCompletedOnboarding')) return { enabled: false, changed: false, path: filePath }
    if (enabled) root.hasCompletedOnboarding = true
    else delete root.hasCompletedOnboarding
    await writeJson(filePath, root)
    return { enabled: Boolean(enabled), changed: true, path: filePath }
  }

  async function getClaudePluginIntegrationStatus() {
    const filePath = paths.claude.pluginConfig
    const exists = fs.existsSync(filePath)
    if (!exists) return { enabled: false, exists: false, path: filePath }
    try {
      const root = await readJson(filePath, {})
      return { enabled: root?.primaryApiKey === 'any', exists: true, path: filePath }
    } catch { return { enabled: false, exists: true, path: filePath, parseError: true } }
  }

  async function setClaudePluginIntegration(enabled) {
    const filePath = paths.claude.pluginConfig
    if (!enabled && !fs.existsSync(filePath)) return { enabled: false, changed: false, exists: false, path: filePath }
    let root
    try { root = await readJson(filePath, {}) } catch { root = {} }
    if (!root || typeof root !== 'object' || Array.isArray(root)) root = {}
    if (enabled) {
      if (root.primaryApiKey === 'any') return { enabled: true, changed: false, exists: true, path: filePath }
      root.primaryApiKey = 'any'
    } else {
      if (!Object.hasOwn(root, 'primaryApiKey')) return { enabled: false, changed: false, exists: true, path: filePath }
      delete root.primaryApiKey
    }
    await writeJson(filePath, root)
    return { enabled: Boolean(enabled), changed: true, exists: true, path: filePath }
  }

  return {
    getHomeDir: () => homeDir,
    getDataDir: () => dataDir,
    getClientPaths: () => paths,
    listProviders,
    getActiveProvider,
    getProvider,
    activateProvider,
    getProviderCandidates,
    getFailoverQueue,
    getAvailableProvidersForFailover,
    addToFailoverQueue,
    removeFromFailoverQueue,
    saveProvider,
    updateProviderSortOrder,
    getCustomEndpoints,
    addCustomEndpoint,
    removeCustomEndpoint,
    selectCustomEndpoint,
    deleteProvider,
    listLiveProviderIds,
    getLiveProviderFragment,
    removeProviderFromLiveConfig,
    importLiveProviders,
    importClaudeDesktopProvidersFromClaude,
    switchProvider,
    setClientRouting,
    testProvider,
    getClientStatus,
    getClientConfigDirectoryInfo,
    getClaudeOnboardingStatus,
    setClaudeOnboardingSkip,
    getClaudePluginIntegrationStatus,
    setClaudePluginIntegration,
    getCommonConfigSnippet,
    setCommonConfigSnippet,
    extractCommonConfigSnippet,
    _internal: {
      atomicWrite,
      readJson,
      stripManagedCodexConfig,
      updateGeminiEnv,
      parseCodexRouting,
      parseGrokRouting,
      stripManagedGrokConfig,
      parseEnvValues,
      matchLiveProvider
    }
  }
}

module.exports = { CLIENTS, getHomeDir, getClientPaths, createConfigManager }
