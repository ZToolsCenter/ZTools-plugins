'use strict'

const KNOWN_COMPAT_SUFFIXES = ['/api/claudecode', '/api/anthropic', '/apps/anthropic', '/api/coding', '/claudecode', '/anthropic', '/step_plan', '/coding', '/claude']
const TIMEOUT_MS = 15000
const ERROR_BODY_MAX = 512

function validateUrl(value, label = 'URL') {
  let url
  try { url = new URL(String(value || '').trim()) } catch { throw new Error(`${label} 无效`) }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) throw new Error(`${label} 必须是无内嵌凭据的 HTTP(S) URL`)
  return url.href.replace(/\/$/, '')
}
function endsWithVersionSegment(value) { const last = String(value).split('/').at(-1) || ''; return /^v\d+$/.test(last) }
function stripCompatSuffix(value) { for (const suffix of KNOWN_COMPAT_SUFFIXES) if (value.endsWith(suffix)) return value.slice(0, -suffix.length); return null }
function buildModelsUrlCandidates(baseUrl, isFullUrl = false, modelsUrl = '') {
  if (String(modelsUrl || '').trim()) return [validateUrl(modelsUrl, 'Models URL')]
  const base = validateUrl(baseUrl, 'Base URL').replace(/\/$/, '')
  const candidates = []
  if (isFullUrl) {
    const v1 = base.indexOf('/v1/')
    if (v1 >= 0) candidates.push(`${base.slice(0, v1)}/v1/models`)
    else { const parsed = new URL(base); const parts = parsed.pathname.split('/').filter(Boolean); if (parts.length) { parts.pop(); parsed.pathname = parts.length ? `/${parts.join('/')}/v1/models` : '/v1/models'; candidates.push(parsed.href.replace(/\/$/, '')) } }
    if (!candidates.length) throw new Error('无法从完整请求 URL 推导 Models 端点')
    return candidates
  }
  if (endsWithVersionSegment(base)) { candidates.push(`${base}/models`); if (!base.endsWith('/v1')) candidates.push(`${base}/v1/models`) }
  else candidates.push(`${base}/v1/models`)
  const stripped = stripCompatSuffix(base)
  if (stripped) { const root = stripped.replace(/\/$/, ''); candidates.push(`${root}/v1/models`, `${root}/models`) }
  return [...new Set(candidates)]
}
function truncate(value) { const text = String(value || ''); return text.length <= ERROR_BODY_MAX ? text : `${text.slice(0, ERROR_BODY_MAX)}…` }
function parseModels(payload, defaultOwner = null) {
  const output = []
  const push = (entry, fallbackId = '') => {
    if (typeof entry === 'string') { if (entry.trim()) output.push({ id: entry.trim(), ownedBy: defaultOwner }); return }
    if (!entry || typeof entry !== 'object') { if (fallbackId) output.push({ id: fallbackId, ownedBy: defaultOwner }); return }
    const id = [entry.slug, entry.id, entry.model, entry.name, fallbackId].find((value) => typeof value === 'string' && value.trim())
    if (!id) return
    const owner = [entry.owned_by, entry.ownedBy, entry.provider, entry.vendor, entry.category, entry.owner].find((value) => typeof value === 'string' && value.trim()) || defaultOwner
    output.push({ id: id.trim(), ownedBy: owner })
  }
  const entries = Array.isArray(payload) ? payload : Array.isArray(payload?.data) ? payload.data : Array.isArray(payload?.models) ? payload.models : Array.isArray(payload?.items) ? payload.items : []
  entries.forEach((entry) => push(entry))
  if (payload?.models && !Array.isArray(payload.models) && typeof payload.models === 'object') for (const [id, entry] of Object.entries(payload.models)) push(entry, id)
  return [...new Map(output.map((item) => [item.id, item])).values()].sort((a, b) => a.id.localeCompare(b.id))
}

function createModelFetchManager(options = {}) {
  const fetchImpl = options.fetchImpl || globalThis.fetch
  const resolveAuth = options.resolveAuth
  const clientVersion = String(options.clientVersion || '0.0.0')
  async function request(url, headers) {
    const controller = new AbortController(); const timer = setTimeout(() => controller.abort(new Error('Request timeout')), TIMEOUT_MS)
    try { return await fetchImpl(url, { method: 'GET', headers, signal: controller.signal, redirect: 'manual' }) }
    catch (error) { throw new Error(`Request failed: ${error.message}`) }
    finally { clearTimeout(timer) }
  }
  async function fetchModels(config = {}) {
    const apiKey = String(config.apiKey || '').trim(); if (!apiKey) throw new Error('API Key is required to fetch models')
    const candidates = buildModelsUrlCandidates(config.baseUrl, Boolean(config.isFullUrl), config.modelsUrl)
    let lastError = 'no candidates'
    for (const url of candidates) {
      const headers = { authorization: `Bearer ${apiKey}`, accept: 'application/json' }
      const userAgent = String(config.customUserAgent || '').trim(); if (userAgent && !/[\r\n]/.test(userAgent)) headers['user-agent'] = userAgent
      const response = await request(url, headers)
      if (response.ok) {
        let payload
        try { payload = await response.json() } catch (error) { throw new Error(`Failed to parse response: ${error.message}`) }
        return parseModels(payload)
      }
      const body = truncate(await response.text().catch(() => ''))
      if ([404, 405].includes(response.status)) { lastError = `HTTP ${response.status}: ${body}`; continue }
      throw new Error(`HTTP ${response.status}: ${body}`)
    }
    throw new Error(`All candidates failed: ${lastError}`)
  }
  async function fetchManaged(authProvider, accountId, baseUrl = '') {
    if (!resolveAuth) throw new Error('托管账号模型获取不可用')
    const auth = await resolveAuth(String(authProvider || ''), String(accountId || ''))
    let url; let owner = null; const headers = { authorization: `Bearer ${auth.token}`, accept: 'application/json' }
    if (authProvider === 'codex_oauth') {
      url = `https://chatgpt.com/backend-api/codex/models?client_version=${encodeURIComponent(clientVersion)}`; owner = 'Codex'; headers.originator = 'cc-switch'; headers['chatgpt-account-id'] = auth.accountId
    } else if (authProvider === 'xai_oauth') { url = 'https://api.x.ai/v1/models'; owner = 'xAI' }
    else if (authProvider === 'github_copilot') { url = `${String(auth.baseUrl || baseUrl || 'https://api.githubcopilot.com').replace(/\/$/, '')}/models`; owner = 'GitHub Copilot'; headers['copilot-integration-id'] = 'vscode-chat' }
    else throw new Error('不支持的托管认证类型')
    const response = await request(url, headers)
    if (!response.ok) throw new Error(`HTTP ${response.status}: ${truncate(await response.text().catch(() => ''))}`)
    let payload; try { payload = await response.json() } catch (error) { throw new Error(`Failed to parse response: ${error.message}`) }
    return parseModels(payload, owner)
  }
  return { fetchModels, fetchManaged }
}

module.exports = { KNOWN_COMPAT_SUFFIXES, buildModelsUrlCandidates, parseModels, createModelFetchManager }
