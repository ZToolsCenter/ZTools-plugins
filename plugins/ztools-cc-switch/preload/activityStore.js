'use strict'

const fsp = require('node:fs/promises')
const path = require('node:path')
const crypto = require('node:crypto')

const DEFAULT_PRICING = Object.freeze([
  ['claude-opus-4-8', 'Claude Opus 4.8', '5', '25', '0.50', '6.25'],
  ['claude-sonnet-5', 'Claude Sonnet 5', '3', '15', '0.30', '3.75'],
  ['claude-opus-4-6-20260206', 'Claude Opus 4.6', '5', '25', '0.50', '6.25'],
  ['claude-sonnet-4-6-20260217', 'Claude Sonnet 4.6', '3', '15', '0.30', '3.75'],
  ['claude-opus-4-5-20251101', 'Claude Opus 4.5', '5', '25', '0.50', '6.25'],
  ['claude-sonnet-4-5-20250929', 'Claude Sonnet 4.5', '3', '15', '0.30', '3.75'],
  ['claude-haiku-4-5-20251001', 'Claude Haiku 4.5', '1', '5', '0.10', '1.25'],
  ['gpt-5.6-sol', 'GPT-5.6 Sol', '5', '30', '0.50', '6.25'],
  ['gpt-5.6-terra', 'GPT-5.6 Terra', '2.50', '15', '0.25', '3.125'],
  ['gpt-5.6-luna', 'GPT-5.6 Luna', '1', '6', '0.10', '1.25'],
  ['gpt-5.6', 'GPT-5.6 Sol', '5', '30', '0.50', '6.25'],
  ['gpt-5.5', 'GPT-5.5', '5', '30', '0.50', '0'],
  ['gpt-5.4', 'GPT-5.4', '2.50', '15', '0.25', '0'],
  ['gpt-5.4-mini', 'GPT-5.4 Mini', '0.75', '4.50', '0.075', '0'],
  ['gpt-5.2', 'GPT-5.2', '1.75', '14', '0.175', '0'],
  ['gpt-5', 'GPT-5', '1.25', '10', '0.125', '0'],
  ['gpt-5-mini', 'GPT-5 Mini', '0.25', '2', '0.025', '0'],
  ['gpt-5-nano', 'GPT-5 Nano', '0.05', '0.40', '0.005', '0'],
  ['gemini-3-pro-preview', 'Gemini 3 Pro Preview', '2', '12', '0.2', '0'],
  ['gemini-3-flash-preview', 'Gemini 3 Flash Preview', '0.5', '3', '0.05', '0'],
  ['gemini-2.5-pro', 'Gemini 2.5 Pro', '1.25', '10', '0.125', '0'],
  ['gemini-2.5-flash', 'Gemini 2.5 Flash', '0.3', '2.5', '0.03', '0'],
  ['gemini-2.5-flash-lite', 'Gemini 2.5 Flash Lite', '0.10', '0.40', '0.01', '0'],
  ['gemini-2.0-flash', 'Gemini 2.0 Flash', '0.10', '0.40', '0.025', '0']
].map(([modelId, displayName, inputCostPerMillion, outputCostPerMillion, cacheReadCostPerMillion, cacheCreationCostPerMillion]) => ({ modelId, displayName, inputCostPerMillion, outputCostPerMillion, cacheReadCostPerMillion, cacheCreationCostPerMillion })))

const DECIMAL = /^\d+(?:\.\d+)?$/
const BILLING_APPS = Object.freeze(['claude', 'codex', 'gemini', 'grokbuild'])

function createActivityStore(options = {}) {
  const dataDir = path.resolve(options.dataDir)
  const logPath = path.join(dataDir, 'request-logs.jsonl')
  const pricingPath = path.join(dataDir, 'model-pricing.json')
  const billingDefaultsPath = path.join(dataDir, 'billing-defaults.json')
  const maxEntries = Number(options.maxEntries) || 10000
  let mutationQueue = Promise.resolve()

  function serialize(task) { const next = mutationQueue.then(task, task); mutationQueue = next.catch(() => {}); return next }
  function decimal(value, fallback = '0') { return Number.isFinite(Number(value)) && Number(value) >= 0 ? String(value) : fallback }

  function normalizeBillingDefaults(input = {}) {
    const result = {}
    for (const app of BILLING_APPS) {
      const multiplier = String(input?.[app]?.multiplier ?? '1').trim()
      if (!DECIMAL.test(multiplier) || !Number.isFinite(Number(multiplier))) throw new Error(`${app} 默认成本倍率必须是非负十进制数`)
      result[app] = { multiplier, source: input?.[app]?.source === 'request' ? 'request' : 'response' }
    }
    return result
  }

  async function getBillingDefaults() {
    try { return normalizeBillingDefaults(JSON.parse(await fsp.readFile(billingDefaultsPath, 'utf8'))?.apps) }
    catch (error) { if (error.code === 'ENOENT') return normalizeBillingDefaults(); throw new Error(`读取应用计费默认值失败: ${error.message}`) }
  }

  async function saveBillingDefaults(input) {
    const apps = normalizeBillingDefaults(input)
    return serialize(async () => {
      await fsp.mkdir(dataDir, { recursive: true, mode: 0o700 })
      const temp = `${billingDefaultsPath}.${process.pid}.${Date.now()}.tmp`
      await fsp.writeFile(temp, `${JSON.stringify({ version: 1, apps }, null, 2)}\n`, { mode: 0o600 }); await fsp.rename(temp, billingDefaultsPath)
      return apps
    })
  }

  async function resolveBillingConfig(provider = {}, clientInput = '') {
    const client = clientInput === 'claude-desktop' ? 'claude' : String(clientInput || '')
    const defaults = await getBillingDefaults(); const fallback = defaults[client] || { multiplier: '1', source: 'response' }
    const providerMultiplier = String(provider.costMultiplier ?? '').trim()
    const providerSource = String(provider.pricingModelSource ?? '').trim()
    return {
      multiplier: providerMultiplier && DECIMAL.test(providerMultiplier) ? providerMultiplier : fallback.multiplier,
      source: ['request', 'response'].includes(providerSource) ? providerSource : fallback.source,
      inherited: !providerMultiplier || !['request', 'response'].includes(providerSource)
    }
  }

  function normalize(entry) {
    return {
      id: String(entry.id || entry.requestId || crypto.randomUUID()),
      createdAt: Number(entry.createdAt) || Date.now(),
      client: String(entry.client || entry.appType || 'unknown'),
      providerId: String(entry.providerId || ''), providerName: String(entry.providerName || ''),
      model: String(entry.model || ''), requestModel: entry.requestModel ? String(entry.requestModel) : null,
      pricingModel: entry.pricingModel === undefined || entry.pricingModel === null ? null : String(entry.pricingModel),
      costMultiplier: decimal(entry.costMultiplier, '1'),
      inputTokens: Math.max(0, Number(entry.inputTokens) || 0), outputTokens: Math.max(0, Number(entry.outputTokens) || 0),
      cacheReadTokens: Math.max(0, Number(entry.cacheReadTokens) || 0), cacheCreationTokens: Math.max(0, Number(entry.cacheCreationTokens) || 0),
      inputCostUsd: decimal(entry.inputCostUsd), outputCostUsd: decimal(entry.outputCostUsd),
      cacheReadCostUsd: decimal(entry.cacheReadCostUsd), cacheCreationCostUsd: decimal(entry.cacheCreationCostUsd), totalCostUsd: decimal(entry.totalCostUsd),
      latencyMs: Math.max(0, Number(entry.latencyMs) || 0), firstTokenMs: Number.isFinite(Number(entry.firstTokenMs)) ? Number(entry.firstTokenMs) : null,
      durationMs: Number.isFinite(Number(entry.durationMs)) ? Number(entry.durationMs) : null,
      statusCode: Number(entry.statusCode) || 0, streaming: Boolean(entry.streaming ?? entry.isStreaming),
      error: entry.error || entry.errorMessage ? String(entry.error || entry.errorMessage).slice(0, 2000) : null,
      dataSource: String(entry.dataSource || 'proxy'), sessionId: entry.sessionId ? String(entry.sessionId) : null
    }
  }

  async function readPricing() {
    let custom = []
    try { const value = JSON.parse(await fsp.readFile(pricingPath, 'utf8')); custom = Array.isArray(value.models) ? value.models : [] }
    catch (error) { if (error.code !== 'ENOENT') throw new Error(`读取模型定价失败: ${error.message}`) }
    const merged = new Map(DEFAULT_PRICING.map((item) => [item.modelId, { ...item, builtin: true }]))
    for (const item of custom) merged.set(item.modelId, { ...item, builtin: false })
    return [...merged.values()].sort((a, b) => a.displayName.localeCompare(b.displayName))
  }

  async function writeCustomPricing(models) {
    await fsp.mkdir(dataDir, { recursive: true, mode: 0o700 })
    const temp = `${pricingPath}.${process.pid}.${Date.now()}.tmp`
    await fsp.writeFile(temp, `${JSON.stringify({ version: 1, models }, null, 2)}\n`, { mode: 0o600 }); await fsp.rename(temp, pricingPath)
  }

  function pricingCandidates(modelInput) {
    const original = String(modelInput || '').trim().toLowerCase()
    const last = original.split('/').at(-1)
    const noVariant = last.split('@')[0]
    const noEffort = noVariant.replace(/-(minimal|low|medium|high|xhigh)$/, '')
    const candidates = [original, last, noVariant, noEffort]
    if (/^claude-(opus|sonnet|haiku)-4-6(?:$|-)/.test(noEffort)) candidates.push(`claude-${RegExp.$1}-4-6-${RegExp.$1 === 'opus' ? '20260206' : '20260217'}`)
    if (/^claude-(opus|sonnet|haiku)-4-5(?:$|-)/.test(noEffort)) candidates.push(`claude-${RegExp.$1}-4-5-${RegExp.$1 === 'opus' ? '20251101' : RegExp.$1 === 'sonnet' ? '20250929' : '20251001'}`)
    return [...new Set(candidates.filter(Boolean))]
  }

  function findPricing(pricing, model) {
    const map = new Map(pricing.map((item) => [item.modelId.toLowerCase(), item]))
    for (const candidate of pricingCandidates(model)) if (map.has(candidate)) return map.get(candidate)
    return null
  }

  function calculate(entry, pricing, force = false) {
    const value = normalize(entry)
    if (!force && Number(value.totalCostUsd) > 0) return value
    const pricingModel = value.pricingModel || value.model || value.requestModel
    const selected = findPricing(pricing, pricingModel)
    if (!selected) return value
    const cacheInclusive = ['codex', 'gemini', 'grokbuild'].includes(value.client)
    const freshInput = cacheInclusive ? Math.max(0, value.inputTokens - value.cacheReadTokens) : value.inputTokens
    const parsedMultiplier = Number(value.costMultiplier)
    const multiplier = Number.isFinite(parsedMultiplier) && parsedMultiplier >= 0 ? parsedMultiplier : 1
    const cost = (tokens, rate) => tokens * Number(rate) / 1_000_000
    value.pricingModel = selected.modelId
    value.inputCostUsd = String(cost(freshInput, selected.inputCostPerMillion))
    value.outputCostUsd = String(cost(value.outputTokens, selected.outputCostPerMillion))
    value.cacheReadCostUsd = String(cost(value.cacheReadTokens, selected.cacheReadCostPerMillion))
    value.cacheCreationCostUsd = String(cost(value.cacheCreationTokens, selected.cacheCreationCostPerMillion))
    value.totalCostUsd = String((Number(value.inputCostUsd) + Number(value.outputCostUsd) + Number(value.cacheReadCostUsd) + Number(value.cacheCreationCostUsd)) * multiplier)
    return value
  }

  async function append(entry) {
    return serialize(async () => {
      await fsp.mkdir(dataDir, { recursive: true, mode: 0o700 })
      const normalized = calculate(entry, await readPricing())
      await fsp.appendFile(logPath, `${JSON.stringify(normalized)}\n`, { encoding: 'utf8', mode: 0o600 })
      return normalized
    })
  }

  async function readAll(all = false) {
    try {
      const content = await fsp.readFile(logPath, 'utf8'); const lines = content.split(/\r?\n/).filter(Boolean)
      return (all ? lines : lines.slice(-maxEntries)).map((line) => { try { return JSON.parse(line) } catch { return null } }).filter(Boolean)
    } catch (error) { if (error.code === 'ENOENT') return []; throw error }
  }

  async function filteredRows(filters = {}, all = false) {
    const pricing = await readPricing()
    let rows = (await readAll(all)).map((item) => calculate(item, pricing))
    const client = filters.client || filters.appType
    if (client) rows = rows.filter((item) => item.client === client)
    if (filters.providerId) rows = rows.filter((item) => item.providerId === filters.providerId)
    if (filters.providerName) rows = rows.filter((item) => item.providerName === filters.providerName)
    if (filters.model) rows = rows.filter((item) => (item.pricingModel || item.model) === filters.model)
    if (filters.statusCode) rows = rows.filter((item) => item.statusCode === Number(filters.statusCode))
    const from = filters.from ?? filters.startDate; const to = filters.to ?? filters.endDate
    if (from) rows = rows.filter((item) => item.createdAt >= Number(from))
    if (to) rows = rows.filter((item) => item.createdAt <= Number(to))
    return rows
  }

  async function query(filters = {}) {
    const limit = Math.min(Math.max(Number(filters.limit) || 200, 1), 2000)
    return (await filteredRows(filters)).slice(-limit).reverse()
  }

  async function paginated(filters = {}, page = 0, pageSize = 20) {
    const size = Math.min(Math.max(Number(pageSize) || 20, 1), 200)
    const index = Math.max(Number(page) || 0, 0)
    const rows = (await filteredRows(filters)).reverse()
    return { data: rows.slice(index * size, (index + 1) * size), total: rows.length, page: index, pageSize: size }
  }

  function aggregate(rows) {
    const totals = rows.reduce((value, item) => {
      value.requests += 1; if (item.statusCode >= 200 && item.statusCode < 400) value.success += 1
      for (const key of ['inputTokens', 'outputTokens', 'cacheReadTokens', 'cacheCreationTokens', 'latencyMs']) value[key] += Number(item[key]) || 0
      value.totalCost += Number(item.totalCostUsd) || 0; return value
    }, { requests: 0, success: 0, inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheCreationTokens: 0, latencyMs: 0, totalCost: 0 })
    const cacheable = totals.inputTokens + totals.cacheCreationTokens + totals.cacheReadTokens
    return { ...totals, totalRequests: totals.requests, totalCost: String(totals.totalCost), totalInputTokens: totals.inputTokens, totalOutputTokens: totals.outputTokens, totalCacheReadTokens: totals.cacheReadTokens, totalCacheCreationTokens: totals.cacheCreationTokens, realTotalTokens: totals.inputTokens + totals.outputTokens + totals.cacheReadTokens + totals.cacheCreationTokens, cacheHitRate: cacheable ? totals.cacheReadTokens / cacheable : 0, successRate: totals.requests ? totals.success / totals.requests : 0, averageLatencyMs: totals.requests ? Math.round(totals.latencyMs / totals.requests) : 0 }
  }

  async function summary(filters = {}) { return aggregate(await filteredRows(filters)) }
  async function summaryByApp(filters = {}) {
    const grouped = new Map()
    for (const row of await filteredRows(filters)) { const app = row.client === 'claude-desktop' ? 'claude' : row.client; if (!grouped.has(app)) grouped.set(app, []); grouped.get(app).push(row) }
    return [...grouped.entries()].map(([appType, rows]) => ({ appType, summary: aggregate(rows) })).sort((a, b) => b.summary.totalRequests - a.summary.totalRequests)
  }

  async function trends(filters = {}) {
    const rows = await filteredRows(filters)
    const duration = Number(filters.to ?? filters.endDate ?? Date.now()) - Number(filters.from ?? filters.startDate ?? 0)
    const hourly = duration > 0 && duration <= 24 * 60 * 60 * 1000
    const grouped = new Map()
    for (const row of rows) {
      const date = new Date(row.createdAt)
      if (hourly) date.setMinutes(0, 0, 0); else date.setHours(0, 0, 0, 0)
      const key = date.toISOString()
      const item = grouped.get(key) || { date: key, requestCount: 0, totalCost: 0, totalTokens: 0, totalInputTokens: 0, totalOutputTokens: 0, totalCacheCreationTokens: 0, totalCacheReadTokens: 0 }
      item.requestCount += 1; item.totalCost += Number(row.totalCostUsd) || 0; item.totalInputTokens += row.inputTokens; item.totalOutputTokens += row.outputTokens; item.totalCacheCreationTokens += row.cacheCreationTokens; item.totalCacheReadTokens += row.cacheReadTokens; item.totalTokens += row.inputTokens + row.outputTokens + row.cacheCreationTokens + row.cacheReadTokens; grouped.set(key, item)
    }
    return [...grouped.values()].sort((a, b) => a.date.localeCompare(b.date)).map((item) => ({ ...item, totalCost: String(item.totalCost) }))
  }

  async function providerStats(filters = {}) {
    const grouped = new Map()
    for (const row of await filteredRows(filters)) { const key = row.providerId || row.providerName || '_unknown'; if (!grouped.has(key)) grouped.set(key, []); grouped.get(key).push(row) }
    return [...grouped.entries()].map(([providerId, rows]) => { const total = aggregate(rows); return { providerId, providerName: rows[0]?.providerName || providerId, requestCount: rows.length, totalTokens: total.realTotalTokens, totalCost: total.totalCost, successRate: total.successRate, avgLatencyMs: total.averageLatencyMs } }).sort((a, b) => b.requestCount - a.requestCount)
  }

  async function modelStats(filters = {}) {
    const grouped = new Map()
    for (const row of await filteredRows(filters)) { const key = row.pricingModel || row.model || 'unknown'; if (!grouped.has(key)) grouped.set(key, []); grouped.get(key).push(row) }
    return [...grouped.entries()].map(([model, rows]) => { const total = aggregate(rows); return { model, requestCount: rows.length, totalTokens: total.realTotalTokens, totalCost: total.totalCost, avgCostPerRequest: String(rows.length ? Number(total.totalCost) / rows.length : 0) } }).sort((a, b) => b.requestCount - a.requestCount)
  }

  async function detail(idInput) { const id = String(idInput || ''); const row = (await filteredRows({}, true)).find((item) => item.id === id); return row ? { ...row, requestId: row.id, appType: row.client, isStreaming: row.streaming, errorMessage: row.error } : null }

  function matchesProxy(imported, proxy) {
    if ((proxy.dataSource || 'proxy') !== 'proxy' || proxy.statusCode < 200 || proxy.statusCode >= 300) return false
    if (proxy.client !== imported.client || Math.abs(proxy.createdAt - imported.createdAt) > 10 * 60 * 1000) return false
    const modelMatches = !proxy.model || !imported.model || proxy.model === 'unknown' || imported.model === 'unknown' || proxy.model.toLowerCase() === imported.model.toLowerCase()
    if (!modelMatches || proxy.inputTokens !== imported.inputTokens || proxy.outputTokens !== imported.outputTokens || proxy.cacheReadTokens !== imported.cacheReadTokens) return false
    const missingCreationAllowed = ['codex', 'gemini', 'opencode'].includes(imported.client) && imported.cacheCreationTokens === 0
    return missingCreationAllowed || proxy.cacheCreationTokens === imported.cacheCreationTokens
  }

  async function importMany(entries) {
    return serialize(async () => {
      const existing = await readAll(true); const ids = new Set(existing.map((item) => item.id)); const proxies = existing.filter((item) => (item.dataSource || 'proxy') === 'proxy'); const pricing = await readPricing()
      const accepted = []; let skipped = 0; let proxyDuplicates = 0
      for (const raw of Array.isArray(entries) ? entries : []) {
        const entry = calculate(raw, pricing); const hasTokens = entry.inputTokens || entry.outputTokens || entry.cacheReadTokens || entry.cacheCreationTokens
        if (!hasTokens || ids.has(entry.id)) { skipped += 1; continue }
        if (proxies.some((proxy) => matchesProxy(entry, proxy))) { skipped += 1; proxyDuplicates += 1; ids.add(entry.id); continue }
        ids.add(entry.id); accepted.push(entry)
      }
      if (accepted.length) { await fsp.mkdir(dataDir, { recursive: true, mode: 0o700 }); await fsp.appendFile(logPath, `${accepted.map((entry) => JSON.stringify(entry)).join('\n')}\n`, { encoding: 'utf8', mode: 0o600 }) }
      return { imported: accepted.length, skipped, proxyDuplicates }
    })
  }

  async function backupAndResetDataSource(dataSourceInput) {
    const dataSource = String(dataSourceInput || '')
    if (!/^[A-Za-z0-9._-]+$/.test(dataSource)) throw new Error('用量数据来源无效')
    return serialize(async () => {
      let content
      try { content = await fsp.readFile(logPath, 'utf8') } catch (error) {
        if (error.code === 'ENOENT') return { dataSource, removed: 0, backupPath: null }
        throw error
      }
      const backupPath = `${logPath}.bak-${dataSource}-${Date.now()}`
      await fsp.copyFile(logPath, backupPath)
      const kept = []; let removed = 0
      for (const line of content.split(/\r?\n/).filter(Boolean)) {
        try {
          const row = JSON.parse(line)
          if (String(row.dataSource || 'proxy') === dataSource) { removed += 1; continue }
        } catch { /* 损坏行不属于可证明的目标来源，原样保留。 */ }
        kept.push(line)
      }
      const temp = `${logPath}.${process.pid}.${Date.now()}.reset.tmp`
      try { await fsp.writeFile(temp, kept.length ? `${kept.join('\n')}\n` : '', { mode: 0o600 }); await fsp.rename(temp, logPath) }
      catch (error) { await fsp.rm(temp, { force: true }).catch(() => {}); throw error }
      return { dataSource, removed, backupPath }
    })
  }

  async function dataSources() {
    const grouped = new Map()
    for (const row of await filteredRows({}, true)) { const key = row.dataSource || 'proxy'; const current = grouped.get(key) || { dataSource: key, requestCount: 0, inputTokens: 0, outputTokens: 0, totalCostUsd: 0 }; current.requestCount += 1; current.inputTokens += row.inputTokens; current.outputTokens += row.outputTokens; current.totalCostUsd += Number(row.totalCostUsd) || 0; grouped.set(key, current) }
    return [...grouped.values()].map((item) => ({ ...item, totalCostUsd: String(item.totalCostUsd) })).sort((a, b) => b.requestCount - a.requestCount)
  }

  async function checkProviderLimits(provider) {
    if (!provider?.id) throw new Error('Provider 不存在')
    const now = new Date(); const startOfDay = new Date(now); startOfDay.setHours(0, 0, 0, 0)
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1)
    const rows = await filteredRows({ providerId: provider.id }, true)
    const sumSince = (start) => rows.filter((row) => row.createdAt >= start.getTime()).reduce((total, row) => total + (Number(row.totalCostUsd) || 0), 0)
    const dailyUsage = sumSince(startOfDay); const monthlyUsage = sumSince(startOfMonth)
    const dailyLimit = provider.limitDailyUsd === '' || provider.limitDailyUsd === undefined ? null : Number(provider.limitDailyUsd)
    const monthlyLimit = provider.limitMonthlyUsd === '' || provider.limitMonthlyUsd === undefined ? null : Number(provider.limitMonthlyUsd)
    return { providerId: provider.id, dailyUsage: String(dailyUsage), dailyLimit: dailyLimit === null ? null : String(dailyLimit), dailyExceeded: dailyLimit !== null && dailyUsage >= dailyLimit, monthlyUsage: String(monthlyUsage), monthlyLimit: monthlyLimit === null ? null : String(monthlyLimit), monthlyExceeded: monthlyLimit !== null && monthlyUsage >= monthlyLimit }
  }

  function validatePricing(input) {
    const item = { modelId: String(input.modelId || '').trim(), displayName: String(input.displayName || '').trim(), inputCostPerMillion: String(input.inputCostPerMillion ?? input.inputCost ?? '').trim(), outputCostPerMillion: String(input.outputCostPerMillion ?? input.outputCost ?? '').trim(), cacheReadCostPerMillion: String(input.cacheReadCostPerMillion ?? input.cacheReadCost ?? '').trim(), cacheCreationCostPerMillion: String(input.cacheCreationCostPerMillion ?? input.cacheCreationCost ?? '').trim() }
    if (!item.modelId || item.modelId.length > 200 || !/^[A-Za-z0-9._:/@-]+$/.test(item.modelId)) throw new Error('模型 ID 无效')
    if (!item.displayName || item.displayName.length > 200) throw new Error('显示名称不能为空或过长')
    for (const [key, value] of Object.entries(item).slice(2)) if (!DECIMAL.test(value) || !Number.isFinite(Number(value))) throw new Error(`${key} 必须是非负十进制数`)
    return item
  }

  async function updatePricing(input) {
    const item = validatePricing(input)
    return serialize(async () => {
      let custom = []
      try { const value = JSON.parse(await fsp.readFile(pricingPath, 'utf8')); custom = Array.isArray(value.models) ? value.models : [] } catch (error) { if (error.code !== 'ENOENT') throw error }
      const index = custom.findIndex((entry) => entry.modelId === item.modelId); if (index >= 0) custom[index] = item; else custom.push(item); await writeCustomPricing(custom)
      const pricing = await readPricing(); const rows = await readAll(true); let changed = 0
      const repriced = rows.map((row) => { if (Number(row.totalCostUsd) > 0 || !pricingCandidates(row.pricingModel || row.model).includes(item.modelId.toLowerCase())) return row; changed += 1; return calculate(row, pricing, true) })
      if (changed) { const temp = `${logPath}.${process.pid}.${Date.now()}.tmp`; await fsp.writeFile(temp, `${repriced.map((row) => JSON.stringify(row)).join('\n')}\n`, { mode: 0o600 }); await fsp.rename(temp, logPath) }
      return { ...item, backfilled: changed }
    })
  }

  async function deletePricing(modelIdInput) {
    const modelId = String(modelIdInput || '').trim()
    return serialize(async () => { let custom = []; try { const value = JSON.parse(await fsp.readFile(pricingPath, 'utf8')); custom = Array.isArray(value.models) ? value.models : [] } catch (error) { if (error.code !== 'ENOENT') throw error }; await writeCustomPricing(custom.filter((item) => item.modelId !== modelId)); return true })
  }

  async function clear() { return serialize(async () => { const backupPath = `${logPath}.bak-${Date.now()}`; try { await fsp.rename(logPath, backupPath); return { cleared: true, backupPath } } catch (error) { if (error.code === 'ENOENT') return { cleared: true, backupPath: null }; throw error } }) }

  return { append, importMany, backupAndResetDataSource, query, paginated, summary, summaryByApp, trends, providerStats, modelStats, detail, listPricing: readPricing, updatePricing, deletePricing, getBillingDefaults, saveBillingDefaults, resolveBillingConfig, dataSources, checkProviderLimits, clear, getLogPath: () => logPath }
}

module.exports = { BILLING_APPS, DEFAULT_PRICING, createActivityStore }
