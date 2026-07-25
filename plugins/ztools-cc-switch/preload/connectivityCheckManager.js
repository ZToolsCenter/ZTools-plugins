'use strict'

const fsp = require('node:fs/promises')
const path = require('node:path')

const DEFAULT_CONFIG = Object.freeze({ timeoutSecs: 8, maxRetries: 1, degradedThresholdMs: 6000 })
const RETAIN_MS = 7 * 24 * 60 * 60 * 1000

function normalizeConfig(value = {}) {
  const retries = Number.parseInt(value.maxRetries, 10)
  return {
    timeoutSecs: Math.min(Math.max(Number.parseInt(value.timeoutSecs, 10) || 8, 2), 60),
    maxRetries: Math.min(Math.max(Number.isFinite(retries) ? retries : 1, 0), 5),
    degradedThresholdMs: Math.min(Math.max(Number.parseInt(value.degradedThresholdMs, 10) || 6000, 1000), 30000)
  }
}

function shouldRetry(error) {
  const text = `${error?.name || ''} ${error?.message || error || ''}`.toLowerCase()
  return text.includes('timeout') || text.includes('abort') || text.includes('timed out')
}

function safeProviderId(value) {
  const id = String(value || '').trim()
  if (!id || id.length > 200 || /[\0\r\n]/.test(id)) throw new Error('Provider ID 无效')
  return id
}

function createConnectivityCheckManager(options = {}) {
  const dataDir = path.resolve(options.dataDir)
  const configManager = options.configManager
  const fetchImpl = options.fetchImpl || globalThis.fetch
  const now = options.now || (() => performance.now())
  const configPath = path.join(dataDir, 'connectivity-check-config.json')
  const logPath = path.join(dataDir, 'connectivity-check-logs.jsonl')
  let logQueue = Promise.resolve()

  async function getConfig() {
    try { return normalizeConfig(JSON.parse(await fsp.readFile(configPath, 'utf8'))) }
    catch (error) { if (error.code === 'ENOENT') return { ...DEFAULT_CONFIG }; throw new Error(`读取连通检测配置失败: ${error.message}`) }
  }
  async function saveConfig(input) {
    const config = normalizeConfig(input)
    await fsp.mkdir(dataDir, { recursive: true, mode: 0o700 })
    const temp = `${configPath}.${process.pid}.${Date.now()}.tmp`
    await fsp.writeFile(temp, `${JSON.stringify(config, null, 2)}\n`, { mode: 0o600 }); await fsp.rename(temp, configPath)
    return config
  }
  async function writeLog(entry) {
    await fsp.mkdir(dataDir, { recursive: true, mode: 0o700 })
    let recent = []
    try {
      const cutoff = Date.now() - RETAIN_MS
      recent = (await fsp.readFile(logPath, 'utf8')).split(/\r?\n/).filter(Boolean).flatMap((line) => { try { const value = JSON.parse(line); return Number(value.testedAt) >= cutoff ? [value] : [] } catch { return [] } })
    } catch (error) { if (error.code !== 'ENOENT') throw error }
    recent.push(entry)
    await fsp.writeFile(logPath, `${recent.slice(-5000).map(JSON.stringify).join('\n')}\n`, { mode: 0o600 })
  }
  function appendLog(entry) {
    const task = logQueue.then(() => writeLog(entry))
    logQueue = task.catch(() => {})
    return task
  }
  async function probe(provider, client, config) {
    const baseUrl = String(provider.baseUrl || '').trim()
    let parsed
    try { parsed = new URL(baseUrl) } catch { throw new Error('Provider Base URL 无效') }
    if (!['http:', 'https:'].includes(parsed.protocol)) throw new Error('Provider Base URL 必须使用 HTTP(S)')
    const headers = { accept: '*/*', 'accept-encoding': 'identity' }
    if (provider.customUserAgent && !/[\r\n]/.test(provider.customUserAgent)) headers['user-agent'] = String(provider.customUserAgent).trim()
    let last = null
    for (let attempt = 0; attempt <= config.maxRetries; attempt += 1) {
      const controller = new AbortController(); const timer = setTimeout(() => controller.abort(new Error('Request timeout')), config.timeoutSecs * 1000); const started = now()
      try {
        const response = await fetchImpl(parsed, { method: 'GET', headers, signal: controller.signal, redirect: 'manual' })
        const responseTimeMs = Math.round(now() - started)
        return { status: responseTimeMs <= config.degradedThresholdMs ? 'operational' : 'degraded', success: true, message: 'Reachable', responseTimeMs, httpStatus: response.status, modelUsed: '', testedAt: Date.now(), retryCount: attempt, errorCategory: null, providerId: provider.id, providerName: provider.name, client }
      } catch (error) {
        const responseTimeMs = Math.round(now() - started)
        last = { status: 'failed', success: false, message: shouldRetry(error) ? 'Request timeout' : `Connection failed: ${error.message}`, responseTimeMs, httpStatus: null, modelUsed: '', testedAt: Date.now(), retryCount: attempt, errorCategory: null, providerId: provider.id, providerName: provider.name, client }
        if (!shouldRetry(error) || attempt >= config.maxRetries) return last
      } finally { clearTimeout(timer) }
    }
    return last
  }
  async function checkProvider(clientInput, providerIdInput) {
    const client = String(clientInput || '').trim(); const providerId = safeProviderId(providerIdInput)
    const data = await configManager.listProviders(); const provider = data.providers.find((item) => item.id === providerId && item.clients?.includes(client))
    if (!provider) throw new Error('Provider 不存在或不适用于该客户端')
    const result = await probe(provider, client, await getConfig()); await appendLog(result).catch(() => {}); return result
  }
  async function checkAll(clientInput, proxyTargetsOnly = false) {
    const client = String(clientInput || '').trim(); const data = await configManager.listProviders()
    const providers = data.providers.filter((item) => item.clients?.includes(client) && item.baseUrl && (!proxyTargetsOnly || item.id === data.active?.[client] || Number(item.failoverPriority) > 0))
    const config = await getConfig(); const results = []
    for (const provider of providers) {
      try { const result = await probe(provider, client, config); results.push([provider.id, result]); await appendLog(result).catch(() => {}) }
      catch (error) { const result = { status: 'failed', success: false, message: error.message, responseTimeMs: null, httpStatus: null, modelUsed: '', testedAt: Date.now(), retryCount: 0, errorCategory: null, providerId: provider.id, providerName: provider.name, client }; results.push([provider.id, result]); await appendLog(result).catch(() => {}) }
    }
    return results
  }
  async function listLogs(limit = 200) {
    try { return (await fsp.readFile(logPath, 'utf8')).split(/\r?\n/).filter(Boolean).flatMap((line) => { try { return [JSON.parse(line)] } catch { return [] } }).slice(-Math.min(Math.max(Number(limit) || 200, 1), 1000)).reverse() }
    catch (error) { if (error.code === 'ENOENT') return []; throw error }
  }
  return { getConfig, saveConfig, checkProvider, checkAll, listLogs }
}

module.exports = { DEFAULT_CONFIG, normalizeConfig, shouldRetry, createConnectivityCheckManager }
