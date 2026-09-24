'use strict'

const crypto = require('node:crypto')

const STORAGE_KEY = 'cc-switch:coding-plan-credentials-v1'
const MAX_RESPONSE_BYTES = 1024 * 1024
const VOLC_HOST = 'open.volcengineapi.com'
const VOLC_VERSION = '2024-01-01'
const VOLC_SERVICE = 'ark'
const VOLC_CONTENT_TYPE = 'application/json; charset=utf-8'
const VOLC_SIGNED_HEADERS = 'host;x-date;x-content-sha256;content-type'

function detectCodingPlanProvider(baseUrl) {
  const value = String(baseUrl || '').toLowerCase()
  if (value.includes('api.kimi.com/coding')) return 'kimi'
  if (value.includes('open.bigmodel.cn') || value.includes('bigmodel.cn')) return 'zhipu_cn'
  if (value.includes('api.z.ai')) return 'zhipu_en'
  if (value.includes('api.minimaxi.com')) return 'minimax_cn'
  if (value.includes('api.minimax.io')) return 'minimax_en'
  if (value.includes('zenmux')) return 'zenmux'
  if (value.includes('volces.com/api/coding')) return 'volcengine'
  return ''
}

function numberValue(value) { const number = Number(value); return Number.isFinite(number) ? number : null }
function resetTime(value) {
  if (typeof value === 'string') return value
  const number = Number(value)
  if (!Number.isFinite(number) || number <= 0) return null
  return new Date(number < 1e12 ? number * 1000 : number).toISOString()
}
function tier(name, utilization, resetsAt = null, extra = {}) { return { name, utilization, resetsAt, ...extra } }
function result(success, fields = {}) { return { tool: 'coding_plan', credentialStatus: success ? 'valid' : 'valid', credentialMessage: null, success, tiers: [], extraUsage: null, error: null, queriedAt: Date.now(), ...fields } }
function notFound(message) { return result(false, { credentialStatus: 'not_found', error: message, queriedAt: null }) }
function authError(message) { return result(false, { credentialStatus: 'expired', credentialMessage: 'Invalid API key', error: message }) }
function apiError(message) { return result(false, { error: message }) }

function parseKimi(body) {
  const tiers = []
  for (const item of Array.isArray(body?.limits) ? body.limits : []) {
    const detail = item?.detail || {}; const limit = numberValue(detail.limit) ?? 1; const remaining = numberValue(detail.remaining) ?? 0
    tiers.push(tier('five_hour', limit > 0 ? Math.max(0, limit - remaining) / limit * 100 : 0, resetTime(detail.resetTime)))
  }
  if (body?.usage) {
    const limit = numberValue(body.usage.limit) ?? 1; const remaining = numberValue(body.usage.remaining) ?? 0
    tiers.push(tier('weekly_limit', limit > 0 ? Math.max(0, limit - remaining) / limit * 100 : 0, resetTime(body.usage.resetTime)))
  }
  return tiers
}

function parseZhipu(body) {
  if (body?.success === false) return apiError(`API error: ${body.msg || 'Unknown error'}`)
  if (!body?.data) return apiError("Missing 'data' field in response")
  const slots = { five_hour: null, weekly_limit: null }; const unknown = []
  for (const item of Array.isArray(body.data.limits) ? body.data.limits : []) {
    if (String(item?.type || '').toUpperCase() !== 'TOKENS_LIMIT') continue
    const entry = { reset: numberValue(item.nextResetTime), value: numberValue(item.percentage) ?? 0, resetsAt: resetTime(item.nextResetTime) }
    if (Number(item.unit) === 3 && !slots.five_hour) slots.five_hour = entry
    else if (Number(item.unit) === 6 && !slots.weekly_limit) slots.weekly_limit = entry
    else unknown.push(entry)
  }
  unknown.sort((a, b) => Number(a.reset !== null) - Number(b.reset !== null) || (a.reset ?? -Infinity) - (b.reset ?? -Infinity))
  for (const entry of unknown) { if (!slots.five_hour) slots.five_hour = entry; else if (!slots.weekly_limit) slots.weekly_limit = entry }
  return result(true, { credentialMessage: typeof body.data.level === 'string' ? body.data.level : null, tiers: Object.entries(slots).filter(([, item]) => item).map(([name, item]) => tier(name, item.value, item.resetsAt)) })
}

function parseMiniMax(body) {
  if (body?.base_resp && Number(body.base_resp.status_code) !== 0) return apiError(`API error (code ${body.base_resp.status_code}): ${body.base_resp.status_msg || 'Unknown error'}`)
  const item = (Array.isArray(body?.model_remains) ? body.model_remains : []).find((entry) => entry?.model_name === 'general')
  const tiers = []
  if (item && numberValue(item.current_interval_remaining_percent) !== null) tiers.push(tier('five_hour', 100 - Number(item.current_interval_remaining_percent), resetTime(item.end_time)))
  if (item && Number(item.current_weekly_status) === 1 && numberValue(item.current_weekly_remaining_percent) !== null) tiers.push(tier('weekly_limit', 100 - Number(item.current_weekly_remaining_percent), resetTime(item.weekly_end_time)))
  return result(true, { tiers })
}

function parseZenMux(body) {
  if (body?.success !== true) return apiError(`API error: ${body?.message || 'Unknown error'}`)
  if (!body?.data) return apiError("Missing 'data' field in response")
  const tiers = []
  for (const [key, name] of [['quota_5_hour', 'five_hour'], ['quota_7_day', 'weekly_limit']]) {
    const item = body.data[key]; if (!item) continue
    tiers.push(tier(name, (numberValue(item.usage_percentage) ?? 0) * 100, item.resets_at || null, { usedValueUsd: numberValue(item.used_value_usd), maxValueUsd: numberValue(item.max_value_usd) }))
  }
  const plan = body.data?.plan?.tier; const status = body.data?.account_status
  return result(true, { tiers, credentialMessage: plan ? `${plan}${status ? ` (${status})` : ''}` : null })
}

function parseVolcAfp(value) {
  const tiers = []
  for (const [key, name] of [['AFPFiveHour', 'five_hour'], ['AFPWeekly', 'weekly_limit'], ['AFPMonthly', 'monthly']]) {
    const item = value?.[key]; const quota = numberValue(item?.Quota) ?? 0
    if (quota > 0) tiers.push(tier(name, (numberValue(item?.Used) ?? 0) / quota * 100, resetTime(item?.ResetTime)))
  }
  return tiers
}
function parseVolcCoding(value) {
  const names = { session: 'five_hour', '5h': 'five_hour', fivehour: 'five_hour', five_hour: 'five_hour', rolling_5h: 'five_hour', weekly: 'weekly_limit', week: 'weekly_limit', '7d': 'weekly_limit', monthly: 'monthly', month: 'monthly' }
  const list = value?.QuotaUsage || value?.Usages || value?.Details || []
  return (Array.isArray(list) ? list : []).flatMap((item) => {
    const label = String(item.Level || item.Type || item.Period || item.Label || item.Window || '').toLowerCase(); const name = names[label]
    if (!name) return []
    return [tier(name, numberValue(item.Percent ?? item.UsedPercent ?? item.UsagePercent) ?? 0, resetTime(item.ResetTime ?? item.ResetTimestamp))]
  })
}

function sha256(value) { return crypto.createHash('sha256').update(value).digest('hex') }
function hmac(key, value) { return crypto.createHmac('sha256', key).update(value).digest() }
function volcRegion(baseUrl) {
  try { return new URL(baseUrl).hostname.split('.').find((part) => part.startsWith('cn-') || part.startsWith('ap-')) || 'cn-beijing' }
  catch { return 'cn-beijing' }
}
function volcCanonicalQuery(action, region) { return [['Action', action], ['Region', region], ['Version', VOLC_VERSION]].sort(([a], [b]) => a.localeCompare(b)).map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(value)}`).join('&') }
function volcSign(accessKeyId, secretAccessKey, region, query, date = new Date()) {
  const xDate = date.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z'); const shortDate = xDate.slice(0, 8); const bodyHash = sha256('')
  const canonicalHeaders = `host:${VOLC_HOST}\nx-date:${xDate}\nx-content-sha256:${bodyHash}\ncontent-type:${VOLC_CONTENT_TYPE}\n`
  const canonicalRequest = `POST\n/\n${query}\n${canonicalHeaders}\n${VOLC_SIGNED_HEADERS}\n${bodyHash}`
  const scope = `${shortDate}/${region}/${VOLC_SERVICE}/request`; const stringToSign = `HMAC-SHA256\n${xDate}\n${scope}\n${sha256(canonicalRequest)}`
  const signature = hmac(hmac(hmac(hmac(Buffer.from(secretAccessKey), shortDate), region), VOLC_SERVICE), 'request'); const signatureHex = crypto.createHmac('sha256', signature).update(stringToSign).digest('hex')
  return { authorization: `HMAC-SHA256 Credential=${accessKeyId}/${scope}, SignedHeaders=${VOLC_SIGNED_HEADERS}, Signature=${signatureHex}`, xDate, bodyHash }
}

function createCodingPlanManager(options = {}) {
  const fetchImpl = options.fetchImpl || fetch
  const storage = options.storage
  const secretCodec = options.secretCodec
  const getProvider = options.getProvider
  const listProviders = options.listProviders

  function readCredentials() {
    const saved = storage?.getItem(STORAGE_KEY)
    if (!saved) return {}
    try { return JSON.parse(secretCodec.decode(String(saved))) }
    catch { return {} }
  }
  function writeCredentials(value) { storage?.setItem(STORAGE_KEY, secretCodec.encode(JSON.stringify(value))) }
  function validatePlain(value, label) { const text = String(value || '').trim(); if (/[\u0000\u000a\u000d]/.test(text)) throw new Error(label + ' 不能包含换行或空字符'); return text }
  function saveCredentials(providerId, patch = {}) {
    const all = readCredentials(); const current = all[providerId] || {}
    const next = {
      codingPlanProvider: ['auto', 'zhipu_team'].includes(patch.codingPlanProvider) ? patch.codingPlanProvider : (current.codingPlanProvider || 'auto'),
      accessKeyId: patch.accessKeyId === undefined || patch.accessKeyId === '' ? current.accessKeyId || '' : validatePlain(patch.accessKeyId, 'AccessKey ID'),
      secretAccessKey: patch.secretAccessKey === undefined || patch.secretAccessKey === '' ? current.secretAccessKey || '' : validatePlain(patch.secretAccessKey, 'Secret AccessKey'),
      teamOrganizationId: patch.teamOrganizationId === undefined || patch.teamOrganizationId === '' ? current.teamOrganizationId || '' : validatePlain(patch.teamOrganizationId, 'Organization ID'),
      teamProjectId: patch.teamProjectId === undefined || patch.teamProjectId === '' ? current.teamProjectId || '' : validatePlain(patch.teamProjectId, 'Project ID')
    }
    all[providerId] = next; writeCredentials(all); return credentialStatus(next)
  }
  function credentialStatus(value) { return { codingPlanProvider: value.codingPlanProvider || 'auto', hasAccessKeyId: Boolean(value.accessKeyId), hasSecretAccessKey: Boolean(value.secretAccessKey), hasTeamOrganizationId: Boolean(value.teamOrganizationId), hasTeamProjectId: Boolean(value.teamProjectId), secureStorage: Boolean(secretCodec?.secure) } }
  async function listCandidates() {
    const data = await listProviders(); const credentials = readCredentials()
    return data.providers.flatMap((provider) => {
      const detected = detectCodingPlanProvider(provider.baseUrl); const explicit = credentials[provider.id]?.codingPlanProvider === 'zhipu_team' ? 'zhipu_team' : detected
      return explicit ? [{ id: provider.id, name: provider.name, baseUrl: provider.baseUrl, type: explicit, hasApiKey: Boolean(provider.apiKey), ...credentialStatus(credentials[provider.id] || {}) }] : []
    })
  }

  async function request(url, init = {}) {
    const controller = new AbortController(); const timer = setTimeout(() => controller.abort(), 15000)
    try {
      const response = await fetchImpl(url, { ...init, signal: controller.signal })
      const text = await response.text(); if (Buffer.byteLength(text) > MAX_RESPONSE_BYTES) throw new Error('Coding Plan 响应超过 1 MB 限制')
      let body; try { body = text ? JSON.parse(text) : {} } catch { body = { _parseError: true, _text: text.slice(0, 512) } }
      return { response, body, text: text.slice(0, 700) }
    } catch (error) { if (error.name === 'AbortError') throw new Error('Coding Plan 请求超时'); throw error }
    finally { clearTimeout(timer) }
  }
  function failure(call) {
    if ([401, 403].includes(call.response.status)) return authError(`Authentication failed (HTTP ${call.response.status})`)
    if (!call.response.ok) return apiError(`API error (HTTP ${call.response.status}): ${call.text.slice(0, 512)}`)
    if (call.body._parseError) return apiError('Failed to parse response')
    return null
  }
  async function bearer(url, apiKey, parser, authorization = `Bearer ${apiKey}`, headers = {}) {
    const call = await request(url, { headers: { authorization, accept: 'application/json', ...headers } }); const failed = failure(call); return failed || parser(call.body)
  }
  async function queryZhipu(apiKey, baseUrl, credentials, team) {
    const url = team ? 'https://open.bigmodel.cn/api/monitor/usage/quota/limit?type=2' : `${baseUrl.toLowerCase().includes('bigmodel.cn') ? 'https://open.bigmodel.cn' : 'https://api.z.ai'}/api/monitor/usage/quota/limit`
    const headers = { 'content-type': 'application/json', 'accept-language': 'en-US,en' }
    if (team) { headers['bigmodel-organization'] = credentials.teamOrganizationId; headers['bigmodel-project'] = credentials.teamProjectId }
    return bearer(url, apiKey, parseZhipu, apiKey, headers)
  }
  async function volcCall(provider, credentials, action) {
    const region = volcRegion(provider.baseUrl); const query = volcCanonicalQuery(action, region); const signed = volcSign(credentials.accessKeyId, credentials.secretAccessKey, region, query)
    const call = await request(`https://${VOLC_HOST}/?${query}`, { method: 'POST', headers: { host: VOLC_HOST, 'x-date': signed.xDate, 'x-content-sha256': signed.bodyHash, 'content-type': VOLC_CONTENT_TYPE, authorization: signed.authorization }, body: '' })
    const envelope = call.body?.ResponseMetadata?.Error || call.body?.Error; const code = String(envelope?.Code || ''); const message = String(envelope?.Message || '')
    if ([401, 403].includes(call.response.status) || /auth|signature|accessdenied|denied|unauthorized|forbidden|credential|token/i.test(code)) return { kind: 'auth', message: `Authentication failed${code ? ` (${code})` : ''}: ${message}` }
    if (!call.response.ok || call.body._parseError || envelope) return { kind: 'soft', message: envelope ? `API error (${code}): ${message}` : `API error (HTTP ${call.response.status}): ${call.text}` }
    return { kind: 'body', body: call.body }
  }
  async function queryVolc(provider, credentials) {
    const errors = []; const empty = []
    for (const [action, parser, label] of [['GetAFPUsage', parseVolcAfp, 'Agent Plan'], ['GetCodingPlanUsage', parseVolcCoding, 'Coding Plan']]) {
      const call = await volcCall(provider, credentials, action)
      if (call.kind === 'auth') return authError(`${call.message}. Check the AccessKey ID / Secret and Ark usage-query permission.`)
      if (call.kind === 'soft') { errors.push(`${action}: ${call.message}`); continue }
      const payload = call.body.Result || call.body; const tiers = parser(payload)
      if (tiers.length) return result(true, { tiers, credentialMessage: label === 'Agent Plan' && payload.PlanType ? `Agent Plan ${payload.PlanType}` : label })
      empty.push(`${action}=${JSON.stringify(call.body).slice(0, 700)}`)
    }
    return apiError(errors.length ? errors.join('; ') : `No active subscription found (signature OK). Raw: ${empty.join(' || ')}`)
  }
  async function queryProvider(providerId) {
    const provider = await getProvider(String(providerId || '')); if (!provider) throw new Error('Provider 不存在')
    const credentials = readCredentials()[provider.id] || {}; const team = credentials.codingPlanProvider === 'zhipu_team'; const type = team ? 'zhipu_team' : detectCodingPlanProvider(provider.baseUrl)
    if (!type) return notFound('Unknown coding plan provider')
    if (type === 'volcengine') {
      if (!credentials.accessKeyId || !credentials.secretAccessKey) return notFound('Volcengine usage query needs the account AccessKey ID + Secret')
      return queryVolc(provider, credentials)
    }
    if (!provider.apiKey) return notFound('API key is empty')
    if (team) {
      if (!credentials.teamOrganizationId || !credentials.teamProjectId) return notFound('Zhipu team plan needs the API key + organization ID + project ID')
      return queryZhipu(provider.apiKey, provider.baseUrl, credentials, true)
    }
    if (type === 'kimi') return bearer('https://api.kimi.com/coding/v1/usages', provider.apiKey, (body) => result(true, { tiers: parseKimi(body) }))
    if (type === 'zhipu_cn' || type === 'zhipu_en') return queryZhipu(provider.apiKey, provider.baseUrl, credentials, false)
    if (type === 'minimax_cn' || type === 'minimax_en') return bearer(`https://${type === 'minimax_cn' ? 'api.minimaxi.com' : 'api.minimax.io'}/v1/api/openplatform/coding_plan/remains`, provider.apiKey, parseMiniMax)
    return bearer(provider.baseUrl, provider.apiKey, parseZenMux)
  }

  return { listCandidates, queryProvider, saveCredentials, detectCodingPlanProvider }
}

module.exports = { detectCodingPlanProvider, parseKimi, parseZhipu, parseMiniMax, parseZenMux, parseVolcAfp, parseVolcCoding, volcRegion, volcCanonicalQuery, volcSign, createCodingPlanManager }
