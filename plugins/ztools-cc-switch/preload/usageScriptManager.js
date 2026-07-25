'use strict'

const vm = require('node:vm')

const MAX_SCRIPT_BYTES = 128 * 1024
const MAX_RESPONSE_BYTES = 2 * 1024 * 1024
const METHODS = new Set(['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'])

const TEMPLATES = Object.freeze({
  custom: `({ request: { url: "", method: "GET", headers: {} }, extractor: function (response) { return { remaining: 0, unit: "USD" }; } })`,
  general: `({ request: { url: "{{baseUrl}}/user/balance", method: "GET", headers: { "Authorization": "Bearer {{apiKey}}", "User-Agent": "cc-switch/1.0" } }, extractor: function (response) { return { isValid: response.is_active !== false, remaining: response.balance, unit: "USD" }; } })`,
  new_api: `({ request: { url: "{{baseUrl}}/api/user/self", method: "GET", headers: { "Content-Type": "application/json", "Authorization": "Bearer {{accessToken}}", "User-Agent": "cc-switch/1.0", "New-Api-User": "{{userId}}" } }, extractor: function (response) { if (response.success && response.data) return { planName: response.data.group || "Default", remaining: response.data.quota / 500000, used: response.data.used_quota / 500000, total: (response.data.quota + response.data.used_quota) / 500000, unit: "USD" }; return { isValid: false, invalidMessage: response.message || "Query failed" }; } })`
})

function isLoopback(url) { return ['localhost', '127.0.0.1', '::1', '[::1]'].includes(url.hostname.toLowerCase()) }
function validateUrl(requestUrl, baseUrl, custom) {
  let request
  try { request = new URL(requestUrl) } catch { throw new Error('用量请求 URL 无效') }
  if (request.username || request.password) throw new Error('用量请求 URL 不能包含凭据')
  if (!['http:', 'https:'].includes(request.protocol)) throw new Error('用量请求仅支持 HTTP(S)')
  if (!custom && request.protocol !== 'https:' && !isLoopback(request)) throw new Error('用量请求必须使用 HTTPS（localhost 除外）')
  if (baseUrl && !custom) {
    let base
    try { base = new URL(baseUrl) } catch { throw new Error('用量 Base URL 无效') }
    if (base.protocol !== 'https:' && !isLoopback(base)) throw new Error('用量 Base URL 必须使用 HTTPS（localhost 除外）')
    if (request.hostname !== base.hostname || request.port !== base.port || request.protocol !== base.protocol) throw new Error('用量请求必须与 Base URL 同源')
  }
  return request
}

function validateUsageItem(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('用量脚本必须返回对象或对象数组')
  const types = { isValid: 'boolean', invalidMessage: 'string', remaining: 'number', unit: 'string', total: 'number', used: 'number', planName: 'string', extra: 'string' }
  for (const [key, type] of Object.entries(types)) if (value[key] !== undefined && value[key] !== null && typeof value[key] !== type) throw new Error(`${key} 类型必须为 ${type}`)
  return value
}
function validateUsageResult(value) {
  if (Array.isArray(value)) { if (!value.length) throw new Error('用量脚本返回数组不能为空'); value.forEach(validateUsageItem); return value }
  return validateUsageItem(value)
}

function createUsageScriptManager(options = {}) {
  const configManager = options.configManager
  const storage = options.storage
  const secretCodec = options.secretCodec
  const fetchImpl = options.fetchImpl || globalThis.fetch
  const secretKey = (providerId, name) => `cc-switch:usage-script:${providerId}:${name}`
  function readSecret(providerId, name) { const value = storage.getItem(secretKey(providerId, name)); if (!value) return ''; try { return secretCodec.decode(value) } catch { return '' } }
  function writeSecret(providerId, name, value, clear = false) { const key = secretKey(providerId, name); if (clear) storage.removeItem(key); else if (String(value || '').trim()) storage.setItem(key, secretCodec.encode(String(value).trim())) }
  function normalize(input = {}) {
    const code = String(input.code || '').trim()
    if (Buffer.byteLength(code) > MAX_SCRIPT_BYTES) throw new Error('用量脚本不能超过 128 KB')
    const templateType = ['custom', 'general', 'new_api'].includes(input.templateType) ? input.templateType : 'custom'
    return { enabled: Boolean(input.enabled), templateType, code: code || TEMPLATES[templateType], baseUrl: String(input.baseUrl || '').trim(), timeout: Math.min(Math.max(Number.parseInt(input.timeout, 10) || 10, 2), 30), autoQueryInterval: Math.min(Math.max(Number.parseInt(input.autoQueryInterval, 10) || 0, 0), 1440) }
  }
  async function provider(providerId) { const value = await configManager.getProvider(String(providerId || '')); if (!value) throw new Error('Provider 不存在'); return value }
  async function getConfig(providerId) {
    const value = await provider(providerId); const config = normalize(value.usageScript || {})
    return { ...config, hasApiKey: Boolean(readSecret(value.id, 'apiKey')), hasAccessToken: Boolean(readSecret(value.id, 'accessToken')), hasUserId: Boolean(readSecret(value.id, 'userId')), secureStorage: Boolean(secretCodec.secure) }
  }
  async function saveConfig(providerId, input = {}) {
    const value = await provider(providerId); const config = normalize(input)
    writeSecret(value.id, 'apiKey', input.apiKey, input.clearApiKey); writeSecret(value.id, 'accessToken', input.accessToken, input.clearAccessToken); writeSecret(value.id, 'userId', input.userId, input.clearUserId)
    await configManager.saveProvider({ ...value, usageScript: config })
    return getConfig(value.id)
  }
  function buildCode(config, credentials) {
    return config.code.replaceAll('{{apiKey}}', credentials.apiKey).replaceAll('{{baseUrl}}', credentials.baseUrl).replaceAll('{{accessToken}}', credentials.accessToken).replaceAll('{{userId}}', credentials.userId)
  }
  function evaluateConfig(code) {
    const sandbox = Object.create(null); const context = vm.createContext(sandbox, { codeGeneration: { strings: false, wasm: false } })
    const script = new vm.Script(`"use strict";(${code})`, { filename: 'provider-usage-script.vm' })
    const config = script.runInContext(context, { timeout: 200 })
    if (!config || typeof config !== 'object' || typeof config.extractor !== 'function' || !config.request || typeof config.request !== 'object') throw new Error('用量脚本必须包含 request 和 extractor')
    const request = JSON.parse(JSON.stringify(config.request))
    return { context, extractor: config.extractor, request }
  }
  async function readResponse(response) {
    const declared = Number(response.headers.get('content-length') || 0); if (declared > MAX_RESPONSE_BYTES) throw new Error('用量响应超过 2 MB')
    if (!response.body) return ''
    const reader = response.body.getReader(); const chunks = []; let size = 0
    try { while (true) { const { done, value } = await reader.read(); if (done) break; size += value.byteLength; if (size > MAX_RESPONSE_BYTES) { await reader.cancel(); throw new Error('用量响应超过 2 MB') } chunks.push(Buffer.from(value)) } } finally { reader.releaseLock() }
    return Buffer.concat(chunks).toString('utf8')
  }
  async function execute(value, config, overrides = {}) {
    const credentials = { apiKey: String(overrides.apiKey || readSecret(value.id, 'apiKey') || value.apiKey || ''), baseUrl: String(overrides.baseUrl || config.baseUrl || value.baseUrl || ''), accessToken: String(overrides.accessToken || readSecret(value.id, 'accessToken') || ''), userId: String(overrides.userId || readSecret(value.id, 'userId') || '') }
    const evaluated = evaluateConfig(buildCode(config, credentials)); const method = String(evaluated.request.method || 'GET').toUpperCase()
    if (!METHODS.has(method)) throw new Error(`不支持的用量请求方法: ${method}`)
    const url = validateUrl(String(evaluated.request.url || ''), credentials.baseUrl, config.templateType === 'custom')
    const headers = {}; for (const [key, headerValue] of Object.entries(evaluated.request.headers || {})) { if (/^(host|content-length|connection)$/i.test(key)) continue; headers[key] = String(headerValue) }
    const controller = new AbortController(); const timer = setTimeout(() => controller.abort(), config.timeout * 1000)
    let response
    try { response = await fetchImpl(url, { method, headers, body: ['GET', 'HEAD'].includes(method) ? undefined : String(evaluated.request.body ?? ''), redirect: 'manual', signal: controller.signal }) }
    catch (error) { throw new Error(error.name === 'AbortError' ? `用量请求超时（${config.timeout}s）` : `用量请求失败: ${error.message}`) } finally { clearTimeout(timer) }
    const text = await readResponse(response); if (!response.ok) throw new Error(`HTTP ${response.status}: ${text.slice(0, 200)}`)
    let payload; try { payload = JSON.parse(text) } catch { throw new Error('用量响应不是有效 JSON') }
    evaluated.context.__extractor = evaluated.extractor
    const result = new vm.Script(`__extractor(JSON.parse(${JSON.stringify(JSON.stringify(payload))}))`, { filename: 'provider-usage-extractor.vm' }).runInContext(evaluated.context, { timeout: 200 })
    return JSON.parse(JSON.stringify(validateUsageResult(result)))
  }
  async function query(providerId) { const value = await provider(providerId); const config = normalize(value.usageScript || {}); if (!config.enabled) throw new Error('Provider 用量查询未启用'); const data = await execute(value, config); return { success: true, data: Array.isArray(data) ? data : [data], queriedAt: Date.now(), error: null } }
  async function test(providerId, input = {}) { const value = await provider(providerId); const config = normalize(input); const data = await execute(value, config, input); return { success: true, data: Array.isArray(data) ? data : [data], queriedAt: Date.now(), error: null } }
  async function listConfigured() { const values = (await configManager.listProviders()).providers; const result = []; for (const value of values) if (value.usageScript?.enabled) result.push({ id: value.id, name: value.name, clients: value.clients, ...(await getConfig(value.id)) }); return result }
  function clearSecrets(providerId) { for (const name of ['apiKey', 'accessToken', 'userId']) storage.removeItem(secretKey(String(providerId || ''), name)); return true }
  function getTemplates() { return structuredClone(TEMPLATES) }
  return { getConfig, saveConfig, query, test, listConfigured, clearSecrets, getTemplates, _internal: { normalize, validateUrl, validateUsageResult, evaluateConfig } }
}

module.exports = { TEMPLATES, validateUrl, validateUsageResult, createUsageScriptManager }
