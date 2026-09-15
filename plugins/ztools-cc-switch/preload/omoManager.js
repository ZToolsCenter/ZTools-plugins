'use strict'

const fsp = require('node:fs/promises')
const path = require('node:path')
const crypto = require('node:crypto')
const JSON5 = require('json5')

const MAX_CONFIG_BYTES = 2 * 1024 * 1024
const VARIANTS = Object.freeze({
  standard: Object.freeze({
    id: 'standard', label: 'OMO', hasCategories: true,
    preferredFilename: 'oh-my-openagent.jsonc',
    candidates: ['oh-my-openagent.jsonc', 'oh-my-openagent.json', 'oh-my-opencode.jsonc', 'oh-my-opencode.json'],
    pluginName: 'oh-my-openagent@latest',
    pluginPrefixes: ['oh-my-openagent', 'oh-my-opencode']
  }),
  slim: Object.freeze({
    id: 'slim', label: 'OMO Slim', hasCategories: false,
    preferredFilename: 'oh-my-opencode-slim.jsonc',
    candidates: ['oh-my-opencode-slim.jsonc', 'oh-my-opencode-slim.json'],
    pluginName: 'oh-my-opencode-slim@latest',
    pluginPrefixes: ['oh-my-opencode-slim']
  })
})
const ALL_PLUGIN_PREFIXES = [...VARIANTS.standard.pluginPrefixes, ...VARIANTS.slim.pluginPrefixes]

function createOmoManager(options = {}) {
  const homeDir = path.resolve(options.homeDir)
  const dataDir = path.resolve(options.dataDir)
  const opencodeDir = path.join(homeDir, '.config', 'opencode')
  const opencodeConfigPath = path.join(opencodeDir, 'opencode.json')
  const storePath = path.join(dataDir, 'omo-profiles.json')

  function variantOf(input) {
    const variant = VARIANTS[String(input || '')]
    if (!variant) throw new Error('未知 OMO 类型')
    return variant
  }

  async function regularOrMissing(filePath) {
    const stat = await fsp.lstat(filePath).catch((error) => error.code === 'ENOENT' ? null : Promise.reject(error))
    if (stat && (!stat.isFile() || stat.isSymbolicLink())) throw new Error(`拒绝访问非普通文件: ${filePath}`)
    return stat
  }

  function validateTree(value, depth = 0, counter = { count: 0 }) {
    if (depth > 16) throw new Error('OMO 配置嵌套超过 16 层限制')
    if (value === null || ['string', 'boolean'].includes(typeof value)) return
    if (typeof value === 'number') { if (!Number.isFinite(value)) throw new Error('OMO 配置包含非有限数字'); return }
    if (Array.isArray(value)) { for (const item of value) validateTree(item, depth + 1, counter); return }
    if (!value || typeof value !== 'object') throw new Error('OMO 配置包含不支持的值')
    for (const [key, child] of Object.entries(value)) {
      counter.count += 1
      if (counter.count > 10000) throw new Error('OMO 配置字段超过 10000 项限制')
      if (['__proto__', 'prototype', 'constructor'].includes(key)) throw new Error(`OMO 配置包含危险字段: ${key}`)
      validateTree(child, depth + 1, counter)
    }
  }

  async function atomicWrite(filePath, content, { backup = true } = {}) {
    if (Buffer.byteLength(content) > MAX_CONFIG_BYTES) throw new Error('OMO 配置超过 2 MB 限制')
    const existing = await regularOrMissing(filePath)
    await fsp.mkdir(path.dirname(filePath), { recursive: true, mode: 0o700 })
    let backupPath = null
    if (backup && existing) { backupPath = `${filePath}.bak`; await fsp.copyFile(filePath, backupPath) }
    const temp = `${filePath}.${process.pid}.${Date.now()}.${crypto.randomBytes(4).toString('hex')}.tmp`
    try {
      await fsp.writeFile(temp, content, { mode: 0o600 })
      await fsp.rename(temp, filePath)
    } catch (error) {
      await fsp.rm(temp, { force: true }).catch(() => {})
      throw error
    }
    return backupPath
  }

  async function snapshot(filePath) {
    const stat = await regularOrMissing(filePath)
    return stat ? fsp.readFile(filePath) : null
  }

  async function restore(filePath, contents) {
    if (contents === null) { await fsp.rm(filePath, { force: true }); return }
    await atomicWrite(filePath, contents, { backup: false })
  }

  async function readObject(filePath, fallback = null) {
    await regularOrMissing(filePath)
    try {
      const source = await fsp.readFile(filePath, 'utf8')
      if (Buffer.byteLength(source) > MAX_CONFIG_BYTES) throw new Error('配置超过 2 MB 限制')
      const value = JSON5.parse(source)
      if (!value || Array.isArray(value) || typeof value !== 'object') throw new Error('配置根节点必须是对象')
      validateTree(value)
      return value
    } catch (error) {
      if (error.code === 'ENOENT' && fallback !== null) return structuredClone(fallback)
      throw new Error(`读取 ${filePath} 失败: ${error.message}`)
    }
  }

  async function readStore() {
    const store = await readObject(storePath, { version: 1, current: { standard: '', slim: '' }, profiles: [] })
    store.current = store.current && typeof store.current === 'object' ? store.current : { standard: '', slim: '' }
    store.profiles = Array.isArray(store.profiles) ? store.profiles : []
    return store
  }

  async function writeStore(store) {
    validateTree(store)
    await atomicWrite(storePath, `${JSON.stringify(store, null, 2)}\n`)
  }

  async function findConfigPath(variant) {
    for (const filename of variant.candidates) {
      const candidate = path.join(opencodeDir, filename)
      if (await regularOrMissing(candidate)) return candidate
    }
    return null
  }

  function splitConfig(value, variant) {
    const otherFields = {}
    for (const [key, child] of Object.entries(value)) if (key !== 'agents' && key !== 'categories') otherFields[key] = structuredClone(child)
    return {
      ...(value.agents !== undefined ? { agents: structuredClone(value.agents) } : {}),
      ...(variant.hasCategories && value.categories !== undefined ? { categories: structuredClone(value.categories) } : {}),
      ...(Object.keys(otherFields).length ? { otherFields } : {})
    }
  }

  function mergeConfig(settings, variant) {
    const result = settings?.otherFields && !Array.isArray(settings.otherFields) && typeof settings.otherFields === 'object'
      ? structuredClone(settings.otherFields) : {}
    if (settings?.agents !== undefined) result.agents = structuredClone(settings.agents)
    if (variant.hasCategories && settings?.categories !== undefined) result.categories = structuredClone(settings.categories)
    validateTree(result)
    return result
  }

  function matchesPrefix(plugin, prefix) {
    return plugin === prefix || (plugin.startsWith(`${prefix}@`) && plugin.length > prefix.length + 1)
  }

  async function writePluginConfig(pluginName = null, removePrefixes = ALL_PLUGIN_PREFIXES) {
    const config = await readObject(opencodeConfigPath, { $schema: 'https://opencode.ai/config.json' })
    const plugins = Array.isArray(config.plugin) ? config.plugin.filter((item) => {
      if (typeof item !== 'string') return true
      return !removePrefixes.some((prefix) => matchesPrefix(item, prefix))
    }) : []
    if (pluginName) plugins.push(pluginName)
    if (plugins.length) config.plugin = plugins
    else delete config.plugin
    await atomicWrite(opencodeConfigPath, `${JSON.stringify(config, null, 2)}\n`)
  }

  async function writeActiveProfile(profile) {
    const variant = variantOf(profile.variant)
    const target = (await findConfigPath(variant)) || path.join(opencodeDir, variant.preferredFilename)
    const targetBefore = await snapshot(target)
    const opencodeBefore = await snapshot(opencodeConfigPath)
    try {
      const merged = mergeConfig(profile.settingsConfig, variant)
      await atomicWrite(target, `${JSON.stringify(merged, null, 2)}\n`)
      await writePluginConfig(variant.pluginName)
    } catch (error) {
      await Promise.allSettled([restore(target, targetBefore), restore(opencodeConfigPath, opencodeBefore)])
      throw error
    }
    return target
  }

  function normalizeProfile(input, existing = null) {
    const variant = variantOf(input.variant || existing?.variant)
    const name = String(input.name ?? existing?.name ?? '').trim().slice(0, 100)
    if (!name) throw new Error('OMO Profile 名称不能为空')
    const settingsConfig = structuredClone(input.settingsConfig ?? existing?.settingsConfig ?? {})
    if (!settingsConfig || Array.isArray(settingsConfig) || typeof settingsConfig !== 'object') throw new Error('settingsConfig 必须是对象')
    mergeConfig(settingsConfig, variant)
    const now = Date.now()
    return {
      id: existing?.id || `omo-${variant.id}-${crypto.randomUUID()}`,
      variant: variant.id, name, settingsConfig,
      createdAt: existing?.createdAt || now, updatedAt: now
    }
  }

  async function listProfiles() {
    const store = await readStore()
    const local = {}
    for (const variant of Object.values(VARIANTS)) {
      const filePath = await findConfigPath(variant)
      local[variant.id] = { exists: Boolean(filePath), filePath: filePath || path.join(opencodeDir, variant.preferredFilename) }
    }
    return { profiles: store.profiles, current: store.current, variants: Object.values(VARIANTS).map(({ pluginPrefixes, candidates, ...item }) => item), local }
  }

  async function readLocal(variantInput) {
    const variant = variantOf(variantInput)
    const filePath = await findConfigPath(variant)
    if (!filePath) return { exists: false, filePath: path.join(opencodeDir, variant.preferredFilename), agents: null, categories: null, otherFields: null, lastModified: null }
    const value = await readObject(filePath)
    const stat = await fsp.stat(filePath)
    const split = splitConfig(value, variant)
    return { exists: true, filePath, agents: split.agents ?? null, categories: split.categories ?? null, otherFields: split.otherFields ?? null, lastModified: stat.mtime.toISOString() }
  }

  async function saveProfile(input) {
    const store = await readStore()
    const index = input.id ? store.profiles.findIndex((item) => item.id === input.id) : -1
    if (input.id && index < 0) throw new Error('OMO Profile 不存在')
    const profile = normalizeProfile(input, index >= 0 ? store.profiles[index] : null)
    if (index >= 0) store.profiles[index] = profile
    else store.profiles.push(profile)
    if (store.current[profile.variant] === profile.id) await writeActiveProfile(profile)
    await writeStore(store)
    return profile
  }

  async function activateProfile(profileId) {
    const store = await readStore()
    const profile = store.profiles.find((item) => item.id === String(profileId || ''))
    if (!profile) throw new Error('OMO Profile 不存在')
    const filePath = await writeActiveProfile(profile)
    store.current[profile.variant] = profile.id
    await writeStore(store)
    return { profile, filePath }
  }

  async function disable(variantInput) {
    const variant = variantOf(variantInput)
    const store = await readStore()
    for (const filename of variant.candidates) {
      const filePath = path.join(opencodeDir, filename)
      if (await regularOrMissing(filePath)) {
        await fsp.copyFile(filePath, `${filePath}.bak`)
        await fsp.rm(filePath)
      }
    }
    await writePluginConfig(null, variant.pluginPrefixes)
    store.current[variant.id] = ''
    await writeStore(store)
    return true
  }

  async function importLocal(variantInput) {
    const variant = variantOf(variantInput)
    const local = await readLocal(variant.id)
    if (!local.exists) throw new Error(`${variant.label} 本地配置不存在`)
    const settingsConfig = {
      ...(local.agents !== null ? { agents: local.agents } : {}),
      ...(variant.hasCategories && local.categories !== null ? { categories: local.categories } : {}),
      ...(local.otherFields !== null ? { otherFields: local.otherFields } : {})
    }
    const profile = await saveProfile({ variant: variant.id, name: `Imported ${variant.label} ${new Date().toLocaleString('sv-SE').slice(0, 16)}`, settingsConfig })
    return (await activateProfile(profile.id)).profile
  }

  async function deleteProfile(profileId) {
    const store = await readStore()
    const index = store.profiles.findIndex((item) => item.id === String(profileId || ''))
    if (index < 0) throw new Error('OMO Profile 不存在')
    const [profile] = store.profiles.splice(index, 1)
    if (store.current[profile.variant] === profile.id) {
      await disable(profile.variant)
      const refreshed = await readStore()
      refreshed.profiles = refreshed.profiles.filter((item) => item.id !== profile.id)
      await writeStore(refreshed)
      return true
    }
    await writeStore(store)
    return true
  }

  return { listProfiles, readLocal, saveProfile, activateProfile, disable, importLocal, deleteProfile, getDirectory: () => opencodeDir }
}

module.exports = { VARIANTS, createOmoManager }
