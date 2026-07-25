'use strict'

const fsp = require('node:fs/promises')
const path = require('node:path')
const crypto = require('node:crypto')

const APPS = Object.freeze(['claude', 'codex', 'gemini'])

function createUniversalProviderManager(options = {}) {
  const dataDir = path.resolve(options.dataDir)
  const configManager = options.configManager
  const storage = options.storage
  const secretCodec = options.secretCodec
  const storePath = path.join(dataDir, 'universal-providers.json')
  const secretKey = (id) => `cc-switch:universal-provider-secret:${id}`

  async function readStore() {
    try {
      const value = JSON.parse(await fsp.readFile(storePath, 'utf8'))
      return value && typeof value === 'object' && !Array.isArray(value) ? value : {}
    } catch (error) {
      if (error.code === 'ENOENT') return {}
      throw new Error(`读取统一 Provider 失败: ${error.message}`)
    }
  }

  async function writeStore(value) {
    await fsp.mkdir(dataDir, { recursive: true })
    try { await fsp.copyFile(storePath, `${storePath}.bak`) } catch (error) { if (error.code !== 'ENOENT') throw error }
    const temp = `${storePath}.${process.pid}.${Date.now()}.tmp`
    await fsp.writeFile(temp, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 })
    await fsp.rename(temp, storePath)
  }

  function cleanText(value, max = 500) {
    const text = String(value || '').trim()
    if (/\0/.test(text)) throw new Error('字段不能包含空字符')
    return text.slice(0, max)
  }

  function normalizeModel(value, defaults = {}) {
    const source = value && typeof value === 'object' && !Array.isArray(value) ? value : {}
    return Object.fromEntries(Object.keys(defaults).map((key) => [key, cleanText(source[key], 200)]).filter(([, item]) => item))
  }

  function validate(input, existing = null) {
    const id = cleanText(input?.id || existing?.id || crypto.randomUUID(), 120)
    if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(id)) throw new Error('统一 Provider ID 只能包含字母、数字、点、下划线和短横线')
    const name = cleanText(input?.name, 120)
    if (!name) throw new Error('名称不能为空')
    const baseUrl = cleanText(input?.baseUrl, 1000).replace(/\/+$/, '')
    try { if (!['http:', 'https:'].includes(new URL(baseUrl).protocol)) throw new Error('protocol') } catch { throw new Error('Base URL 必须是有效的 HTTP(S) 地址') }
    const apps = Object.fromEntries(APPS.map((app) => [app, Boolean(input?.apps?.[app])]))
    if (!Object.values(apps).some(Boolean)) throw new Error('请至少启用一个应用')
    const models = {
      claude: normalizeModel(input?.models?.claude, { model: '', haikuModel: '', sonnetModel: '', opusModel: '' }),
      codex: normalizeModel(input?.models?.codex, { model: '', reasoningEffort: '' }),
      gemini: normalizeModel(input?.models?.gemini, { model: '' })
    }
    return {
      id, name, providerType: cleanText(input?.providerType || 'custom_gateway', 80), apps, baseUrl, models,
      websiteUrl: cleanText(input?.websiteUrl, 1000), notes: cleanText(input?.notes, 2000),
      icon: cleanText(input?.icon, 80), iconColor: /^#[0-9a-f]{6}$/i.test(String(input?.iconColor || '')) ? input.iconColor : '#5EEAD4',
      createdAt: Number(existing?.createdAt || input?.createdAt) || Date.now(), sortIndex: Number.isInteger(input?.sortIndex) ? input.sortIndex : existing?.sortIndex
    }
  }

  function saveSecret(id, apiKey) {
    const value = String(apiKey || '').trim()
    if (!value) return
    if (/\r|\n|\0/.test(value)) throw new Error('API Key 不能包含换行或空字符')
    storage.setItem(secretKey(id), secretCodec.encode(value))
  }

  function readSecret(id) {
    const encoded = storage.getItem(secretKey(id))
    if (!encoded) return ''
    try { return secretCodec.decode(encoded) } catch { throw new Error('统一 Provider 密钥无法解密，请重新填写') }
  }

  function publicValue(provider) {
    return { ...provider, apiKey: '', hasApiKey: Boolean(storage.getItem(secretKey(provider.id))) }
  }

  async function list() {
    const store = await readStore()
    return Object.values(store).sort((a, b) => (a.sortIndex ?? Number.MAX_SAFE_INTEGER) - (b.sortIndex ?? Number.MAX_SAFE_INTEGER) || a.createdAt - b.createdAt).map(publicValue)
  }

  async function get(id) {
    const item = (await readStore())[String(id || '')]
    return item ? publicValue(item) : null
  }

  async function upsert(input) {
    const store = await readStore()
    const provider = validate(input, store[input?.id])
    saveSecret(provider.id, input?.apiKey)
    if (!storage.getItem(secretKey(provider.id))) throw new Error('API Key 不能为空')
    store[provider.id] = provider
    await writeStore(store)
    return publicValue(provider)
  }

  function childId(app, id) { return `universal-${app}-${id}` }

  async function sync(id) {
    const store = await readStore()
    const provider = store[String(id || '')]
    if (!provider) throw new Error('统一 Provider 不存在')
    const apiKey = readSecret(provider.id)
    if (!apiKey) throw new Error('统一 Provider 尚未配置 API Key')
    const results = []
    for (const app of APPS) {
      const generatedId = childId(app, provider.id)
      if (!provider.apps[app]) {
        await configManager.deleteProvider(generatedId)
        results.push({ app, action: 'removed' })
        continue
      }
      const modelConfig = provider.models[app] || {}
      const baseUrl = app === 'codex' && /^https?:\/\/[^/]+$/i.test(provider.baseUrl) ? `${provider.baseUrl}/v1` : provider.baseUrl
      await configManager.saveProvider({
        id: generatedId, name: provider.name, apiKey, baseUrl,
        model: modelConfig.model || (app === 'claude' ? 'claude-sonnet-4-20250514' : app === 'codex' ? 'gpt-4o' : 'gemini-2.5-pro'),
        clients: [app], color: provider.iconColor, source: 'custom', wireApi: 'responses',
        claudeHaikuModel: modelConfig.haikuModel || '', claudeSonnetModel: modelConfig.sonnetModel || '', claudeOpusModel: modelConfig.opusModel || '',
        codexReasoningEffort: modelConfig.reasoningEffort || ''
      })
      results.push({ app, action: 'synced', providerId: generatedId })
    }
    return { id: provider.id, results }
  }

  async function remove(id) {
    const key = String(id || '')
    const store = await readStore()
    if (!store[key]) return false
    delete store[key]
    for (const app of APPS) await configManager.deleteProvider(childId(app, key))
    storage.removeItem(secretKey(key))
    await writeStore(store)
    return true
  }

  return { list, get, upsert, sync, remove, _internal: { validate, childId, readStore } }
}

module.exports = { createUniversalProviderManager }
