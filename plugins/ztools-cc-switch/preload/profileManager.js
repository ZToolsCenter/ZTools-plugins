'use strict'

const fsp = require('node:fs/promises')
const path = require('node:path')
const crypto = require('node:crypto')

const SCOPES = new Set(['claude', 'claude-desktop', 'codex'])

function createProfileManager(options = {}) {
  const dataDir = path.resolve(options.dataDir)
  const storePath = path.join(dataDir, 'profiles.json')
  const configManager = options.configManager
  const extensionManager = options.extensionManager
  const skillManager = options.skillManager
  const applyProvider = options.applyProvider
  const disableRouting = options.disableRouting || (async () => {})

  function scope(value) {
    const result = String(value || '')
    if (!SCOPES.has(result)) throw new Error(`不支持的 Profile 分组: ${result}`)
    return result
  }

  function profileName(value) {
    const result = String(value || '').trim()
    if (!result || result.length > 80) throw new Error('Profile 名称必须为 1–80 个字符')
    return result
  }

  function emptyPayload() {
    return { providers: {}, mcp: {}, skills: {}, prompts: {} }
  }

  async function readStore() {
    try {
      const value = JSON.parse(await fsp.readFile(storePath, 'utf8'))
      return { version: 1, profiles: Array.isArray(value.profiles) ? value.profiles : [], currentIds: value.currentIds && typeof value.currentIds === 'object' ? value.currentIds : {} }
    } catch (error) {
      if (error.code === 'ENOENT') return { version: 1, profiles: [], currentIds: {} }
      throw new Error(`读取 Profiles 失败: ${error.message}`)
    }
  }

  async function writeStore(store) {
    await fsp.mkdir(dataDir, { recursive: true, mode: 0o700 })
    const temp = `${storePath}.${process.pid}.${Date.now()}.tmp`
    await fsp.writeFile(temp, `${JSON.stringify(store, null, 2)}\n`, { mode: 0o600 })
    await fsp.rename(temp, storePath)
  }

  async function snapshotCurrent(scopeInput) {
    const app = scope(scopeInput)
    const [providers, extensions, skills] = await Promise.all([
      configManager.listProviders(), extensionManager.listExtensions(), skillManager.listSkills()
    ])
    return {
      providers: { [app]: providers.active?.[app] || null },
      mcp: { [app]: extensions.mcpServers.filter((item) => item.apps?.[app]).map((item) => item.id) },
      skills: { [app]: skills.skills.filter((item) => item.apps?.[app]).map((item) => item.directory) },
      prompts: { [app]: extensions.prompts.find((item) => item.apps?.[app])?.id || null }
    }
  }

  function mergeScope(payload, snapshot, app) {
    const next = { ...emptyPayload(), ...(payload || {}) }
    for (const key of ['providers', 'mcp', 'skills', 'prompts']) next[key] = { ...(next[key] || {}), [app]: snapshot[key][app] }
    return next
  }

  async function listProfiles() {
    const store = await readStore()
    return { profiles: store.profiles.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0)), currentIds: { claude: store.currentIds.claude || null, 'claude-desktop': store.currentIds['claude-desktop'] || null, codex: store.currentIds.codex || null } }
  }

  async function createProfile(nameInput, scopeInput) {
    const app = scope(scopeInput)
    const store = await readStore()
    const now = Date.now()
    const profile = { id: crypto.randomUUID(), name: profileName(nameInput), payload: await snapshotCurrent(app), createdAt: now, updatedAt: now }
    store.profiles.push(profile)
    store.currentIds[app] = profile.id
    await writeStore(store)
    return profile
  }

  async function updateProfile(idInput, patch = {}) {
    const id = String(idInput || '')
    const store = await readStore()
    const profile = store.profiles.find((item) => item.id === id)
    if (!profile) throw new Error('Profile 不存在')
    if (patch.name !== undefined) profile.name = profileName(patch.name)
    if (patch.resnapshot) {
      const app = scope(patch.scope)
      profile.payload = mergeScope(profile.payload, await snapshotCurrent(app), app)
    }
    profile.updatedAt = Date.now()
    await writeStore(store)
    return profile
  }

  async function deleteProfile(idInput) {
    const id = String(idInput || '')
    const store = await readStore()
    store.profiles = store.profiles.filter((item) => item.id !== id)
    for (const app of SCOPES) if (store.currentIds[app] === id) delete store.currentIds[app]
    await writeStore(store)
    return true
  }

  async function applyProfile(idInput, scopeInput) {
    const id = String(idInput || '')
    const app = scope(scopeInput)
    const store = await readStore()
    const profile = store.profiles.find((item) => item.id === id)
    if (!profile) throw new Error('Profile 不存在')
    const warnings = []

    const oldId = store.currentIds[app]
    if (oldId && oldId !== id) {
      const old = store.profiles.find((item) => item.id === oldId)
      if (old) {
        try { old.payload = mergeScope(old.payload, await snapshotCurrent(app), app); old.updatedAt = Date.now() }
        catch (error) { warnings.push(`切换前自动保存失败: ${error.message}`) }
      }
    }

    const captured = ['providers', 'mcp', 'skills', 'prompts'].some((key) => Object.hasOwn(profile.payload?.[key] || {}, app))
    if (!captured) warnings.push(`该 Profile 尚未保存 ${app} 配置；已设为当前项目，切换离开时会自动保存`)
    else {
      try { await disableRouting(app) } catch (error) { warnings.push(`关闭 ${app} 本地接管失败: ${error.message}`) }
      const targetProvider = profile.payload?.providers?.[app]
      if (targetProvider) {
        try { await applyProvider(app, targetProvider) } catch (error) { warnings.push(`Provider 切换失败: ${error.message}`) }
      }
      try {
        const extensions = await extensionManager.listExtensions()
        if (Array.isArray(profile.payload?.mcp?.[app])) {
          const targets = new Set(profile.payload.mcp[app])
          for (const item of extensions.mcpServers) if (Boolean(item.apps?.[app]) !== targets.has(item.id)) await extensionManager.setMcpEnabled(item.id, app, targets.has(item.id))
        }
        const targetPrompt = profile.payload?.prompts?.[app]
        if (targetPrompt) {
          const item = extensions.prompts.find((entry) => entry.id === targetPrompt)
          if (item && !item.apps?.[app]) await extensionManager.setPromptEnabled(item.id, app, true)
          else if (!item) warnings.push(`Prompt「${targetPrompt}」已不存在`)
        }
      } catch (error) { warnings.push(`MCP / Prompt 应用失败: ${error.message}`) }
      try {
        if (Array.isArray(profile.payload?.skills?.[app])) {
          const targets = new Set(profile.payload.skills[app])
          const current = (await skillManager.listSkills()).skills
          for (const item of current) if (Boolean(item.apps?.[app]) !== targets.has(item.directory)) await skillManager.setSkillEnabled(item.directory, app, targets.has(item.directory))
        }
      } catch (error) { warnings.push(`Skills 应用失败: ${error.message}`) }
    }
    store.currentIds[app] = id
    profile.updatedAt = Date.now()
    await writeStore(store)
    return { profile, warnings }
  }

  async function clearCurrentProfile(scopeInput) {
    const app = scope(scopeInput)
    const store = await readStore()
    delete store.currentIds[app]
    await writeStore(store)
    return true
  }

  return { listProfiles, createProfile, updateProfile, deleteProfile, applyProfile, clearCurrentProfile, snapshotCurrent }
}

module.exports = { createProfileManager }
