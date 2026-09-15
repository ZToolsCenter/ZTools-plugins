'use strict'

const fsp = require('node:fs/promises')
const path = require('node:path')
const { execFile: execFileCallback } = require('node:child_process')
const { promisify } = require('node:util')
const execFile = promisify(execFileCallback)

// Public installed-app OAuth credentials published in the official Gemini CLI.
// They are used only to refresh an existing local Gemini CLI session before a quota query;
// they are not user credentials and are intentionally kept private to this module.
// Source: https://github.com/google-gemini/gemini-cli/blob/69b51f8fa2af0abf717daaba4dca1c627023d82d/packages/core/src/code_assist/oauth2.ts
const GEMINI_CLIENT_ID = '681255809395-oo8ft2oprdrnp9e3aqf6av3hmdib135j.apps.googleusercontent.com'
const GEMINI_CLIENT_SECRET = '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'
const MAX_RESPONSE_BYTES = 1024 * 1024
const CACHE_TTL_MS = 5 * 60 * 1000

function quotaError(tool, credentialStatus, message) { return { tool, credentialStatus, credentialMessage: message || null, success: false, tiers: [], extraUsage: null, error: message || null, queriedAt: Date.now() } }
function notFound(tool, message = null) { return { tool, credentialStatus: 'not_found', credentialMessage: message, success: false, tiers: [], extraUsage: null, error: null, queriedAt: null } }
function timestampExpired(value, now = Date.now()) {
  if (value === undefined || value === null || value === '') return false
  if (typeof value === 'number') return (value > 1e12 ? value : value * 1000) < now
  const parsed = Date.parse(String(value)); return Number.isFinite(parsed) ? parsed < now : false
}
function parseClaudeCredentials(value, now) {
  try {
    const parsed = typeof value === 'string' ? JSON.parse(value) : value
    const entry = parsed?.claudeAiOauth || parsed?.['claude.ai_oauth']
    if (!entry?.accessToken) return { status: 'parse_error', message: 'Claude OAuth 凭据缺少 accessToken' }
    return { token: entry.accessToken, status: timestampExpired(entry.expiresAt, now) ? 'expired' : 'valid', message: timestampExpired(entry.expiresAt, now) ? 'Claude OAuth Token 已过期' : null }
  } catch (error) { return { status: 'parse_error', message: `Claude OAuth 凭据解析失败：${error.message}` } }
}
function parseCodexCredentials(value, now) {
  try {
    const parsed = typeof value === 'string' ? JSON.parse(value) : value
    if (parsed?.auth_mode !== 'chatgpt') return { status: 'not_found', message: 'Codex 当前不是 ChatGPT OAuth 模式' }
    const token = parsed?.tokens?.access_token; if (!token) return { status: 'parse_error', message: 'Codex OAuth 凭据缺少 access_token' }
    const stale = parsed.last_refresh && Number(now ?? Date.now()) - Date.parse(parsed.last_refresh) > 8 * 24 * 60 * 60 * 1000
    return { token, accountId: parsed.tokens.account_id || '', status: stale ? 'expired' : 'valid', message: stale ? 'Codex Token 距上次刷新已超过 8 天' : null }
  } catch (error) { return { status: 'parse_error', message: `Codex OAuth 凭据解析失败：${error.message}` } }
}
function parseGeminiCredentials(value, now = Date.now()) {
  try {
    const parsed = typeof value === 'string' ? JSON.parse(value) : value
    const entry = parsed?.token || parsed || {}
    const token = entry.accessToken || entry.access_token
    const refreshToken = entry.refreshToken || entry.refresh_token
    const expiresAt = entry.expiresAt ?? entry.expiry_date
    if (!token) return { refreshToken, status: 'parse_error', message: 'Gemini OAuth 凭据缺少 access token' }
    const expired = timestampExpired(expiresAt, now)
    return { token, refreshToken, status: expired ? 'expired' : 'valid', message: expired ? 'Gemini OAuth Token 已过期' : null }
  } catch (error) { return { status: 'parse_error', message: `Gemini OAuth 凭据解析失败：${error.message}` } }
}
function windowName(seconds) {
  const value = Number(seconds) || 0
  if (value === 18000) return 'five_hour'; if (value === 604800) return 'seven_day'; if (value === 2592000) return '30_day'
  const hours = Math.floor(value / 3600); return hours >= 24 ? `${Math.floor(hours / 24)}_day` : `${hours}_hour`
}
function classifyGemini(model) { const value = String(model || 'unknown'); return value.includes('flash-lite') ? 'gemini_flash_lite' : value.includes('flash') ? 'gemini_flash' : value.includes('pro') ? 'gemini_pro' : value }

function createSubscriptionManager(options = {}) {
  const homeDir = path.resolve(options.homeDir)
  const authManager = options.authManager
  const fetchImpl = options.fetchImpl || fetch
  const now = options.now || (() => Date.now())
  const readKeychain = options.readKeychain || (async (service, account) => {
    if (process.platform !== 'darwin') return null
    try { const args = ['find-generic-password', '-s', service]; if (account) args.push('-a', account); args.push('-w'); const result = await execFile('security', args, { timeout: 5000, maxBuffer: MAX_RESPONSE_BYTES }); return result.stdout.trim() || null } catch { return null }
  })
  const cache = new Map()

  async function readFileJson(file) { try { return JSON.parse(await fsp.readFile(file, 'utf8')) } catch (error) { if (error.code === 'ENOENT') return null; throw error } }
  async function responseJson(response) {
    const chunks = []; let size = 0
    if (response.body) for await (const chunk of response.body) { size += chunk.length; if (size > MAX_RESPONSE_BYTES) throw new Error('订阅 API 响应超过 1 MB 安全限制'); chunks.push(Buffer.from(chunk)) }
    const text = Buffer.concat(chunks).toString('utf8'); try { return text ? JSON.parse(text) : {} } catch { return { _parseError: true, _text: text.slice(0, 500) } }
  }
  async function requestJson(url, init = {}) {
    const controller = new AbortController(); const timer = setTimeout(() => controller.abort(), 15_000)
    try { const response = await fetchImpl(url, { ...init, signal: controller.signal }); return { response, body: await responseJson(response) } }
    catch (error) { if (error.name === 'AbortError') throw new Error('订阅 API 请求超时'); throw error }
    finally { clearTimeout(timer) }
  }
  function success(tool, tiers, extraUsage = null) { return { tool, credentialStatus: 'valid', credentialMessage: null, success: true, tiers, extraUsage, error: null, queriedAt: now() } }
  function deterministicFailure(tool, response, body, loginHint) {
    if ([401, 403].includes(response.status)) return quotaError(tool, 'expired', `${loginHint}（HTTP ${response.status}）`)
    if (!response.ok) return quotaError(tool, 'valid', `额度 API 返回 HTTP ${response.status}${body?._text ? `：${body._text}` : ''}`)
    if (body?._parseError) return quotaError(tool, 'valid', '额度 API 返回了无效 JSON')
    return null
  }
  async function readClaude() {
    const keychain = await readKeychain('Claude Code-credentials')
    if (keychain) return parseClaudeCredentials(keychain, now())
    const file = await readFileJson(path.join(homeDir, '.claude', '.credentials.json')); return file ? parseClaudeCredentials(file, now()) : { status: 'not_found' }
  }
  async function readCodex() {
    const keychain = await readKeychain('Codex Auth')
    if (keychain) return parseCodexCredentials(keychain, now())
    const file = await readFileJson(path.join(homeDir, '.codex', 'auth.json')); return file ? parseCodexCredentials(file, now()) : { status: 'not_found' }
  }
  async function readGemini() {
    const keychain = await readKeychain('gemini-cli-oauth', 'main-account')
    if (keychain) return parseGeminiCredentials(keychain, now())
    const file = await readFileJson(path.join(homeDir, '.gemini', 'oauth_creds.json')); return file ? parseGeminiCredentials(file, now()) : { status: 'not_found' }
  }
  async function queryClaude(token) {
    const result = await requestJson('https://api.anthropic.com/api/oauth/usage', { headers: { authorization: `Bearer ${token}`, 'anthropic-beta': 'oauth-2025-04-20', accept: 'application/json' } })
    const failure = deterministicFailure('claude', result.response, result.body, 'Claude OAuth 已失效，请重新登录 Claude CLI'); if (failure) return failure
    const tiers = []
    for (const [name, value] of Object.entries(result.body)) if (name !== 'extra_usage' && value && Number.isFinite(Number(value.utilization))) tiers.push({ name, utilization: Number(value.utilization), resetsAt: value.resets_at || null })
    const extra = result.body.extra_usage ? { isEnabled: Boolean(result.body.extra_usage.is_enabled), monthlyLimit: result.body.extra_usage.monthly_limit ?? null, usedCredits: result.body.extra_usage.used_credits ?? null, utilization: result.body.extra_usage.utilization ?? null, currency: result.body.extra_usage.currency ?? null } : null
    return success('claude', tiers, extra)
  }
  async function queryCodex(token, accountId, label = 'codex') {
    const headers = { authorization: `Bearer ${token}`, 'user-agent': 'codex-cli', accept: 'application/json' }; if (accountId) headers['chatgpt-account-id'] = accountId
    const result = await requestJson('https://chatgpt.com/backend-api/wham/usage', { headers })
    const failure = deterministicFailure(label, result.response, result.body, 'Codex OAuth 已失效，请重新登录'); if (failure) return failure
    const windows = [result.body?.rate_limit?.primary_window, result.body?.rate_limit?.secondary_window].filter(Boolean)
    return success(label, windows.filter((item) => Number.isFinite(Number(item.used_percent))).map((item) => ({ name: windowName(item.limit_window_seconds), utilization: Number(item.used_percent), resetsAt: item.reset_at ? new Date(Number(item.reset_at) * 1000).toISOString() : null })))
  }
  async function refreshGemini(refreshToken) {
    if (!refreshToken) return null
    const body = new URLSearchParams({ client_id: GEMINI_CLIENT_ID, client_secret: GEMINI_CLIENT_SECRET, refresh_token: refreshToken, grant_type: 'refresh_token' })
    const result = await requestJson('https://oauth2.googleapis.com/token', { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body })
    return result.response.ok ? result.body.access_token || null : null
  }
  async function queryGemini(token) {
    const headers = { authorization: `Bearer ${token}`, 'content-type': 'application/json' }
    const load = await requestJson('https://cloudcode-pa.googleapis.com/v1internal:loadCodeAssist', { method: 'POST', headers, body: JSON.stringify({ metadata: { ideType: 'GEMINI_CLI', pluginType: 'GEMINI' } }) })
    const loadFailure = deterministicFailure('gemini', load.response, load.body, 'Gemini OAuth 已失效，请重新登录 Gemini CLI'); if (loadFailure) return loadFailure
    const projectValue = load.body.cloudaicompanionProject; const project = typeof projectValue === 'string' ? projectValue : projectValue?.id || projectValue?.projectId
    const quota = await requestJson('https://cloudcode-pa.googleapis.com/v1internal:retrieveUserQuota', { method: 'POST', headers, body: JSON.stringify(project ? { project } : {}) })
    const quotaFailure = deterministicFailure('gemini', quota.response, quota.body, 'Gemini OAuth 已失效，请重新登录 Gemini CLI'); if (quotaFailure) return quotaFailure
    const categories = new Map()
    for (const bucket of quota.body.buckets || []) { const name = classifyGemini(bucket.modelId); const remaining = Math.min(Math.max(Number(bucket.remainingFraction ?? 1), 0), 1); const previous = categories.get(name); if (!previous || remaining < previous.remaining) categories.set(name, { remaining, resetsAt: bucket.resetTime || null }) }
    const order = { gemini_pro: 0, gemini_flash: 1, gemini_flash_lite: 2 }
    const tiers = [...categories].map(([name, item]) => ({ name, utilization: (1 - item.remaining) * 100, resetsAt: item.resetsAt })).sort((a, b) => (order[a.name] ?? 3) - (order[b.name] ?? 3))
    return success('gemini', tiers)
  }
  async function queryQuota(tool, options = {}) {
    const cacheKey = `${tool}:${options.accountId || ''}`; const cached = cache.get(cacheKey)
    if (!options.force && cached && now() - cached.cachedAt < CACHE_TTL_MS) return { ...cached.value, cached: true }
    let credentials; let result
    if (tool === 'codex_oauth') {
      try { const auth = await authManager.getValidToken('codex_oauth', options.accountId); result = await queryCodex(auth.token, auth.accountId, 'codex_oauth') }
      catch (error) { result = quotaError(tool, 'expired', error.message) }
    } else {
      credentials = tool === 'claude' ? await readClaude() : tool === 'codex' ? await readCodex() : tool === 'gemini' ? await readGemini() : { status: 'not_found' }
      if (credentials.status === 'not_found') result = notFound(tool, credentials.message)
      else if (credentials.status === 'parse_error') result = quotaError(tool, 'parse_error', credentials.message)
      else if (tool === 'claude') result = await queryClaude(credentials.token)
      else if (tool === 'codex') result = await queryCodex(credentials.token, credentials.accountId)
      else {
        let token = credentials.token
        if (credentials.status === 'expired' && credentials.refreshToken) token = await refreshGemini(credentials.refreshToken) || token
        result = await queryGemini(token)
      }
      if (credentials.status === 'expired' && !result.success && result.credentialStatus !== 'valid') result.credentialMessage ||= credentials.message
    }
    cache.set(cacheKey, { cachedAt: now(), value: result }); return result
  }
  async function queryAll(options = {}) {
    const base = await Promise.all(['claude', 'codex', 'gemini'].map((tool) => queryQuota(tool, options)))
    const auth = authManager?.getStatus('codex_oauth')
    const managed = auth?.accounts?.length ? await Promise.all(auth.accounts.map((account) => queryQuota('codex_oauth', { ...options, accountId: account.id }).then((quota) => ({ ...quota, accountId: account.id, accountLabel: account.label })))) : []
    return [...base, ...managed]
  }
  async function testEndpoints(urls, timeoutSeconds = 8) {
    const timeoutMs = Math.min(Math.max(Number(timeoutSeconds) || 8, 2), 30) * 1000
    return Promise.all((Array.isArray(urls) ? urls : []).slice(0, 50).map(async (raw) => {
      const value = String(raw || '').trim(); let url
      try { url = new URL(value); if (!['http:', 'https:'].includes(url.protocol)) throw new Error('unsupported') } catch { return { url: value, latency: null, status: null, error: 'URL 无效' } }
      async function request(measure) { const controller = new AbortController(); const timer = setTimeout(() => controller.abort(), timeoutMs); const start = performance.now(); try { const response = await fetchImpl(url, { method: 'GET', signal: controller.signal, redirect: 'manual' }); await response.body?.cancel().catch(() => {}); return { status: response.status, latency: measure ? Math.round(performance.now() - start) : null } } finally { clearTimeout(timer) } }
      try { await request(false); const measured = await request(true); return { url: value, ...measured, error: null } }
      catch (error) { return { url: value, latency: null, status: null, error: error.name === 'AbortError' ? '请求超时' : `连接失败：${error.message}` } }
    }))
  }
  return { queryQuota, queryAll, testEndpoints, clearCache: () => cache.clear() }
}

module.exports = { timestampExpired, parseClaudeCredentials, parseCodexCredentials, parseGeminiCredentials, windowName, classifyGemini, createSubscriptionManager }
