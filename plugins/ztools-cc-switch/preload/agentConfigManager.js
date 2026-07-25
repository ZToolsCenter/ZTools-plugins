'use strict'

const fs = require('node:fs')
const fsp = require('node:fs/promises')
const path = require('node:path')
const crypto = require('node:crypto')
const JSON5 = require('json5')
const YAML = require('yaml')

const MAX_CONFIG_BYTES = 2 * 1024 * 1024
const MAX_MEMORY_BYTES = 2 * 1024 * 1024
const TOOL_PROFILES = new Set(['minimal', 'coding', 'messaging', 'full'])

function createAgentConfigManager(options = {}) {
  const homeDir = path.resolve(options.homeDir)
  const openclawPath = path.join(homeDir, '.openclaw', 'openclaw.json')
  const hermesDir = path.resolve(options.hermesHome || path.join(homeDir, '.hermes'))
  const hermesConfigPath = path.join(hermesDir, 'config.yaml')
  const memoriesDir = path.join(hermesDir, 'memories')

  async function ensureRegularOrMissing(filePath) {
    const stat = await fsp.lstat(filePath).catch((error) => error.code === 'ENOENT' ? null : Promise.reject(error))
    if (stat && (!stat.isFile() || stat.isSymbolicLink())) throw new Error(`拒绝访问非普通文件: ${filePath}`)
    return stat
  }

  async function atomicWrite(filePath, content) {
    const bytes = Buffer.byteLength(content)
    if (bytes > MAX_CONFIG_BYTES) throw new Error('配置内容超过 2 MB 限制')
    const existing = await ensureRegularOrMissing(filePath)
    await fsp.mkdir(path.dirname(filePath), { recursive: true, mode: 0o700 })
    let backupPath = null
    if (existing) { backupPath = `${filePath}.bak`; await fsp.copyFile(filePath, backupPath) }
    const temp = `${filePath}.${process.pid}.${Date.now()}.${crypto.randomBytes(4).toString('hex')}.tmp`
    try { await fsp.writeFile(temp, content, { mode: 0o600 }); await fsp.rename(temp, filePath) }
    catch (error) { await fsp.rm(temp, { force: true }).catch(() => {}); throw error }
    return backupPath
  }

  function validateJsonTree(value, depth = 0, counter = { count: 0 }) {
    if (depth > 12) throw new Error('配置嵌套超过 12 层限制')
    if (value === null || ['string', 'boolean'].includes(typeof value)) return
    if (typeof value === 'number') { if (!Number.isFinite(value)) throw new Error('配置包含非有限数字'); return }
    if (Array.isArray(value)) { for (const item of value) validateJsonTree(item, depth + 1, counter); return }
    if (!value || typeof value !== 'object') throw new Error('配置包含不支持的值')
    for (const [key, child] of Object.entries(value)) {
      counter.count += 1
      if (counter.count > 5000) throw new Error('配置字段超过 5000 项限制')
      if (['__proto__', 'prototype', 'constructor'].includes(key)) throw new Error(`配置包含危险字段: ${key}`)
      validateJsonTree(child, depth + 1, counter)
    }
  }

  async function readOpenClaw() {
    await ensureRegularOrMissing(openclawPath)
    try {
      const source = await fsp.readFile(openclawPath, 'utf8')
      if (Buffer.byteLength(source) > MAX_CONFIG_BYTES) throw new Error('OpenClaw 配置超过 2 MB 限制')
      const value = JSON5.parse(source)
      if (!value || Array.isArray(value) || typeof value !== 'object') throw new Error('OpenClaw 根配置必须是对象')
      return value
    } catch (error) {
      if (error.code === 'ENOENT') return { models: { mode: 'merge', providers: {} } }
      throw new Error(`读取 OpenClaw 配置失败: ${error.message}`)
    }
  }

  async function writeOpenClaw(config) {
    validateJsonTree(config)
    const content = `${JSON.stringify(config, null, 2)}\n`
    const backupPath = await atomicWrite(openclawPath, content)
    return { backupPath, warnings: scanHealthValue(config) }
  }

  function scanHealthValue(config) {
    const warnings = []
    const profile = config?.tools?.profile
    if (typeof profile === 'string' && !TOOL_PROFILES.has(profile)) warnings.push({ code: 'invalid_tools_profile', message: `tools.profile uses unsupported value '${profile}'.`, path: 'tools.profile' })
    if (config?.agents?.defaults && Object.hasOwn(config.agents.defaults, 'timeout')) warnings.push({ code: 'legacy_agents_timeout', message: 'agents.defaults.timeout is deprecated; use agents.defaults.timeoutSeconds.', path: 'agents.defaults.timeout' })
    if (config?.env && Object.hasOwn(config.env, 'vars') && (!config.env.vars || Array.isArray(config.env.vars) || typeof config.env.vars !== 'object')) warnings.push({ code: 'stringified_env_vars', message: 'env.vars should be an object.', path: 'env.vars' })
    if (config?.env && Object.hasOwn(config.env, 'shellEnv') && (!config.env.shellEnv || Array.isArray(config.env.shellEnv) || typeof config.env.shellEnv !== 'object')) warnings.push({ code: 'stringified_env_shell_env', message: 'env.shellEnv should be an object.', path: 'env.shellEnv' })
    return warnings
  }

  async function scanOpenClawHealth() {
    try { return scanHealthValue(await readOpenClaw()) }
    catch (error) { return [{ code: 'config_parse_failed', message: error.message, path: openclawPath }] }
  }

  async function getOpenClawAgentsDefaults() { return (await readOpenClaw()).agents?.defaults ?? null }

  function validateDefaultModel(input) {
    if (!input || Array.isArray(input) || typeof input !== 'object') throw new Error('默认模型配置必须是对象')
    const model = structuredClone(input)
    if (typeof model.primary !== 'string' || !model.primary.trim()) throw new Error('默认模型 primary 必须是非空字符串')
    model.primary = model.primary.trim()
    if (model.fallbacks === undefined) model.fallbacks = []
    if (!Array.isArray(model.fallbacks) || model.fallbacks.some((item) => typeof item !== 'string')) throw new Error('默认模型 fallbacks 必须是字符串数组')
    model.fallbacks = [...new Set(model.fallbacks.map((item) => item.trim()).filter(Boolean))]
    validateJsonTree(model)
    return model
  }

  async function getOpenClawDefaultModel() {
    const model = (await readOpenClaw()).agents?.defaults?.model
    if (model === undefined) return null
    return validateDefaultModel(model)
  }

  async function setOpenClawDefaultModel(input) {
    const model = validateDefaultModel(input)
    const config = await readOpenClaw()
    config.agents = config.agents && typeof config.agents === 'object' && !Array.isArray(config.agents) ? config.agents : {}
    config.agents.defaults = config.agents.defaults && typeof config.agents.defaults === 'object' && !Array.isArray(config.agents.defaults) ? config.agents.defaults : {}
    config.agents.defaults.model = model
    return writeOpenClaw(config)
  }

  function validateModelCatalog(input) {
    if (!input || Array.isArray(input) || typeof input !== 'object') throw new Error('模型目录必须是对象')
    const catalog = structuredClone(input)
    for (const [rawId, entry] of Object.entries(catalog)) {
      const id = rawId.trim()
      if (!id || id !== rawId || id.length > 300 || /[\r\n\0]/.test(id)) throw new Error(`模型目录包含非法 ID: ${rawId}`)
      if (!entry || Array.isArray(entry) || typeof entry !== 'object') throw new Error(`模型目录条目 ${id} 必须是对象`)
      if (entry.alias !== undefined && entry.alias !== null && typeof entry.alias !== 'string') throw new Error(`模型目录条目 ${id} 的 alias 必须是字符串`)
    }
    validateJsonTree(catalog)
    return catalog
  }

  async function getOpenClawModelCatalog() {
    const catalog = (await readOpenClaw()).agents?.defaults?.models
    if (catalog === undefined) return null
    return validateModelCatalog(catalog)
  }

  async function setOpenClawModelCatalog(input) {
    const catalog = validateModelCatalog(input)
    const config = await readOpenClaw()
    config.agents = config.agents && typeof config.agents === 'object' && !Array.isArray(config.agents) ? config.agents : {}
    config.agents.defaults = config.agents.defaults && typeof config.agents.defaults === 'object' && !Array.isArray(config.agents.defaults) ? config.agents.defaults : {}
    config.agents.defaults.models = catalog
    return writeOpenClaw(config)
  }
  async function setOpenClawAgentsDefaults(input) {
    const defaults = structuredClone(input || {})
    validateJsonTree(defaults)
    if (defaults.model !== undefined) {
      if (!defaults.model || typeof defaults.model !== 'object' || typeof defaults.model.primary !== 'string') throw new Error('agents.defaults.model.primary 必须是字符串')
      if (defaults.model.fallbacks !== undefined && (!Array.isArray(defaults.model.fallbacks) || defaults.model.fallbacks.some((item) => typeof item !== 'string'))) throw new Error('fallbacks 必须是字符串数组')
    }
    for (const key of ['timeoutSeconds', 'contextTokens', 'maxConcurrent']) if (defaults[key] !== undefined && (!Number.isFinite(Number(defaults[key])) || Number(defaults[key]) < 0)) throw new Error(`${key} 必须是非负数字`)
    delete defaults.timeout
    const config = await readOpenClaw()
    config.agents = config.agents && typeof config.agents === 'object' && !Array.isArray(config.agents) ? config.agents : {}
    config.agents.defaults = defaults
    return writeOpenClaw(config)
  }

  async function getOpenClawEnv() { return (await readOpenClaw()).env || {} }
  async function setOpenClawEnv(input) {
    if (!input || Array.isArray(input) || typeof input !== 'object') throw new Error('OpenClaw env 必须是 JSON 对象')
    validateJsonTree(input)
    const config = await readOpenClaw(); config.env = structuredClone(input); return writeOpenClaw(config)
  }

  async function getOpenClawTools() { return (await readOpenClaw()).tools || { allow: [], deny: [] } }
  async function setOpenClawTools(input) {
    if (!input || Array.isArray(input) || typeof input !== 'object') throw new Error('OpenClaw tools 必须是对象')
    const tools = structuredClone(input)
    if (tools.profile !== undefined && typeof tools.profile !== 'string') throw new Error('tools.profile 必须是字符串')
    for (const key of ['allow', 'deny']) {
      if (tools[key] !== undefined && (!Array.isArray(tools[key]) || tools[key].some((item) => typeof item !== 'string'))) throw new Error(`tools.${key} 必须是字符串数组`)
      if (Array.isArray(tools[key])) tools[key] = [...new Set(tools[key].map((item) => item.trim()).filter(Boolean))]
    }
    validateJsonTree(tools)
    const config = await readOpenClaw(); config.tools = tools; return writeOpenClaw(config)
  }

  function memoryPath(kind) {
    if (!['memory', 'user'].includes(kind)) throw new Error('未知 Hermes Memory 类型')
    return path.join(memoriesDir, kind === 'memory' ? 'MEMORY.md' : 'USER.md')
  }

  async function getHermesMemory(kind) {
    const target = memoryPath(kind)
    await ensureRegularOrMissing(target)
    try {
      const content = await fsp.readFile(target, 'utf8')
      if (Buffer.byteLength(content) > MAX_MEMORY_BYTES) throw new Error('Hermes Memory 超过 2 MB 限制')
      return content
    } catch (error) { if (error.code === 'ENOENT') return ''; throw error }
  }

  async function setHermesMemory(kind, contentInput) {
    const content = String(contentInput ?? '')
    if (Buffer.byteLength(content) > MAX_MEMORY_BYTES) throw new Error('Hermes Memory 超过 2 MB 限制')
    const backupPath = await atomicWrite(memoryPath(kind), content)
    return { backupPath }
  }

  async function readHermesConfig() {
    await ensureRegularOrMissing(hermesConfigPath)
    try {
      const source = await fsp.readFile(hermesConfigPath, 'utf8')
      if (Buffer.byteLength(source) > MAX_CONFIG_BYTES) throw new Error('Hermes 配置超过 2 MB 限制')
      const value = YAML.parse(source) || {}
      if (!value || Array.isArray(value) || typeof value !== 'object') throw new Error('Hermes 根配置必须是映射')
      return value
    } catch (error) { if (error.code === 'ENOENT') return {}; throw new Error(`读取 Hermes 配置失败: ${error.message}`) }
  }

  async function getHermesMemoryLimits() {
    const config = await readHermesConfig(); const memory = config.memory && typeof config.memory === 'object' ? config.memory : {}
    return {
      memory: Number.isFinite(Number(memory.memory_char_limit)) ? Number(memory.memory_char_limit) : 2200,
      user: Number.isFinite(Number(memory.user_char_limit)) ? Number(memory.user_char_limit) : 1375,
      memoryEnabled: memory.memory_enabled !== false,
      userEnabled: memory.user_profile_enabled !== false
    }
  }

  async function getHermesModelConfig() {
    const model = (await readHermesConfig()).model
    if (model === undefined) return null
    if (!model || Array.isArray(model) || typeof model !== 'object') throw new Error('Hermes model 配置必须是映射')
    const result = structuredClone(model)
    for (const key of ['default', 'provider', 'base_url']) if (result[key] !== undefined && result[key] !== null && typeof result[key] !== 'string') throw new Error(`Hermes model.${key} 必须是字符串`)
    for (const key of ['context_length', 'max_tokens']) if (result[key] !== undefined && (!Number.isFinite(Number(result[key])) || Number(result[key]) < 0)) throw new Error(`Hermes model.${key} 必须是非负数字`)
    validateJsonTree(result)
    return result
  }

  async function setHermesMemoryEnabled(kind, enabled) {
    memoryPath(kind)
    const config = await readHermesConfig()
    config.memory = config.memory && typeof config.memory === 'object' && !Array.isArray(config.memory) ? config.memory : {}
    config.memory[kind === 'memory' ? 'memory_enabled' : 'user_profile_enabled'] = Boolean(enabled)
    const backupPath = await atomicWrite(hermesConfigPath, YAML.stringify(config))
    return { backupPath, ...(await getHermesMemoryLimits()) }
  }

  return {
    getOpenClawDefaultModel, setOpenClawDefaultModel, getOpenClawModelCatalog, setOpenClawModelCatalog,
    getOpenClawAgentsDefaults, setOpenClawAgentsDefaults,
    getOpenClawEnv, setOpenClawEnv, getOpenClawTools, setOpenClawTools, scanOpenClawHealth,
    getHermesModelConfig, getHermesMemory, setHermesMemory, getHermesMemoryLimits, setHermesMemoryEnabled
  }
}

module.exports = { TOOL_PROFILES, createAgentConfigManager }
