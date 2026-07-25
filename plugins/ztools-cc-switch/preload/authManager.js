'use strict'

const crypto = require('node:crypto')

const META_KEY = 'cc-switch:auth-accounts-v1'
const SECRET_KEY = 'cc-switch:auth-secrets-v1'
const MAX_RESPONSE_BYTES = 1024 * 1024
const REFRESH_BUFFER_MS = 60_000

const PROVIDERS = Object.freeze({
  codex_oauth: {
    id: 'codex_oauth', name: 'ChatGPT / Codex', kind: 'codex',
    clientId: 'app_EMoamEEZ73f0CkXaXp7hrann',
    deviceUrl: 'https://auth.openai.com/api/accounts/deviceauth/usercode',
    pollUrl: 'https://auth.openai.com/api/accounts/deviceauth/token',
    tokenUrl: 'https://auth.openai.com/oauth/token',
    verificationUri: 'https://auth.openai.com/codex/device',
    redirectUri: 'https://auth.openai.com/deviceauth/callback'
  },
  xai_oauth: {
    id: 'xai_oauth', name: 'xAI / Grok', kind: 'xai',
    clientId: 'b1a00492-073a-47ea-816f-4c329264a828',
    discoveryUrl: 'https://auth.x.ai/.well-known/openid-configuration',
    issuer: 'https://auth.x.ai',
    scope: 'openid profile email offline_access grok-cli:access api:access'
  },
  github_copilot: {
    id: 'github_copilot', name: 'GitHub Copilot', kind: 'github',
    publicClientId: 'Iv1.b507a08c87ecfe98', enterpriseClientId: 'Ov23li8tweQw6odWQebz'
  }
})

function createMemoryStorage() {
  const values = new Map()
  return { getItem: (key) => values.get(key), setItem: (key, value) => values.set(key, value), removeItem: (key) => values.delete(key) }
}

function normalizeGithubDomain(value) {
  const raw = String(value || 'github.com').trim().toLowerCase().replace(/^https?:\/\//, '').replace(/\/+$/, '')
  if (!raw || raw.includes('/') || raw.includes('@') || raw.includes(':')) throw new Error('GitHub 域名无效')
  return raw
}

function decodeJwtPayload(token) {
  try {
    const part = String(token || '').split('.')[1]
    if (!part) return {}
    return JSON.parse(Buffer.from(part.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8'))
  } catch { return {} }
}

function createAuthManager(options = {}) {
  const storage = options.storage || createMemoryStorage()
  const secretCodec = options.secretCodec || { secure: false, encode: (v) => Buffer.from(v).toString('base64'), decode: (v) => Buffer.from(v, 'base64').toString('utf8') }
  const fetchImpl = options.fetchImpl || fetch
  const now = options.now || (() => Date.now())
  const pending = new Map()
  const refreshLocks = new Map()
  const accessCache = new Map()
  const discoveryCache = new Map()
  const endpointCache = new Map()

  function read(key, fallback) {
    const value = storage.getItem(key)
    return value === undefined || value === null ? fallback : value
  }
  function readMeta() {
    const value = read(META_KEY, {})
    return value && typeof value === 'object' ? value : {}
  }
  function writeMeta(value) { storage.setItem(META_KEY, value) }
  function readSecrets() {
    const encoded = read(SECRET_KEY, '')
    if (!encoded) return {}
    try { return JSON.parse(secretCodec.decode(encoded)) } catch { throw new Error('认证密钥存储无法解密') }
  }
  function writeSecrets(value) {
    const keys = Object.values(value).some((accounts) => accounts && Object.keys(accounts).length)
    if (!keys) storage.removeItem(SECRET_KEY)
    else storage.setItem(SECRET_KEY, secretCodec.encode(JSON.stringify(value)))
  }
  function providerMeta(providerId, all = readMeta()) {
    return all[providerId] || { accounts: {}, defaultAccountId: '' }
  }
  function publicAccount(account, defaultId) { return { ...account, isDefault: account.id === defaultId } }
  function listProviders() {
    const meta = readMeta()
    return Object.values(PROVIDERS).map((definition) => {
      const state = providerMeta(definition.id, meta)
      const accounts = Object.values(state.accounts || {}).sort((a, b) => Number(b.id === state.defaultAccountId) - Number(a.id === state.defaultAccountId) || b.authenticatedAt - a.authenticatedAt)
      return { id: definition.id, name: definition.name, secureStorage: Boolean(secretCodec.secure), defaultAccountId: state.defaultAccountId || '', authenticated: accounts.some((a) => !a.requiresReauth), accounts: accounts.map((a) => publicAccount(a, state.defaultAccountId)) }
    })
  }
  function getStatus(providerId) {
    const result = listProviders().find((item) => item.id === providerId)
    if (!result) throw new Error(`不支持的认证类型: ${providerId}`)
    return result
  }

  async function readJsonResponse(response) {
    const chunks = []; let size = 0
    if (response.body) {
      for await (const chunk of response.body) {
        size += chunk.length
        if (size > MAX_RESPONSE_BYTES) throw new Error('OAuth 响应超过 1 MB 安全限制')
        chunks.push(Buffer.from(chunk))
      }
    }
    const text = Buffer.concat(chunks).toString('utf8')
    try { return text ? JSON.parse(text) : {} } catch { throw new Error(`OAuth 服务返回了无效 JSON（HTTP ${response.status}）`) }
  }
  async function requestJson(url, init = {}) {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), options.timeoutMs || 15_000)
    try {
      const response = await fetchImpl(url, { redirect: 'manual', ...init, signal: controller.signal })
      const value = await readJsonResponse(response)
      return { response, value }
    } catch (error) {
      if (error.name === 'AbortError') throw new Error('OAuth 请求超时')
      throw error
    } finally { clearTimeout(timer) }
  }
  function formBody(values) { return new URLSearchParams(Object.entries(values).filter(([, value]) => value !== undefined && value !== null && value !== '')) }
  function oauthError(value, response, fallback) { return new Error(value.error_description || value.error || `${fallback}：HTTP ${response.status}`) }

  async function discoverXai() {
    if (discoveryCache.has('xai')) return discoveryCache.get('xai')
    const promise = requestJson(PROVIDERS.xai_oauth.discoveryUrl, { headers: { 'user-agent': 'ztools-cc-switch-xai-oauth' } }).then(({ response, value }) => {
      if (!response.ok) throw oauthError(value, response, 'xAI OIDC discovery 失败')
      if (String(value.issuer || '').replace(/\/+$/, '') !== PROVIDERS.xai_oauth.issuer) throw new Error('xAI OIDC issuer 不可信')
      for (const key of ['device_authorization_endpoint', 'token_endpoint']) {
        const endpoint = new URL(value[key]); if (endpoint.protocol !== 'https:' || endpoint.hostname !== 'auth.x.ai') throw new Error(`xAI ${key} 不可信`)
      }
      return { deviceUrl: value.device_authorization_endpoint, tokenUrl: value.token_endpoint }
    }).catch((error) => { discoveryCache.delete('xai'); throw error })
    discoveryCache.set('xai', promise)
    return promise
  }

  async function startLogin(providerId, input = {}) {
    const definition = PROVIDERS[providerId]
    if (!definition) throw new Error(`不支持的认证类型: ${providerId}`)
    let value; let opaque
    if (definition.kind === 'codex') {
      const result = await requestJson(definition.deviceUrl, { method: 'POST', headers: { 'content-type': 'application/json', 'user-agent': 'ztools-cc-switch-codex-oauth' }, body: JSON.stringify({ client_id: definition.clientId }) })
      if (!result.response.ok) throw oauthError(result.value, result.response, 'Codex 设备码获取失败')
      value = { user_code: result.value.user_code, verification_uri: definition.verificationUri, interval: Number(result.value.interval) || 5, expires_in: Number(result.value.expires_in) || 900 }
      opaque = { deviceAuthId: result.value.device_auth_id }
      if (!opaque.deviceAuthId || !value.user_code) throw new Error('Codex 设备码响应缺少必要字段')
    } else if (definition.kind === 'xai') {
      const endpoints = await discoverXai()
      const result = await requestJson(endpoints.deviceUrl, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded', 'user-agent': 'ztools-cc-switch-xai-oauth' }, body: formBody({ client_id: definition.clientId, scope: definition.scope }) })
      if (!result.response.ok) throw oauthError(result.value, result.response, 'xAI 设备码获取失败')
      value = result.value; opaque = { deviceCode: value.device_code, tokenUrl: endpoints.tokenUrl }
    } else {
      const domain = normalizeGithubDomain(input.domain)
      const clientId = domain === 'github.com' ? definition.publicClientId : definition.enterpriseClientId
      const result = await requestJson(`https://${domain}/login/device/code`, { method: 'POST', headers: { accept: 'application/json', 'content-type': 'application/x-www-form-urlencoded', 'user-agent': 'ztools-cc-switch-copilot' }, body: formBody({ client_id: clientId, scope: 'read:user' }) })
      if (!result.response.ok) throw oauthError(result.value, result.response, 'GitHub 设备码获取失败')
      value = result.value; opaque = { deviceCode: value.device_code, domain, clientId }
    }
    const flowId = crypto.randomUUID()
    const expiresIn = Math.min(Math.max(Number(value.expires_in) || 900, 1), 1800)
    pending.set(flowId, { providerId, ...opaque, userCode: value.user_code, expiresAt: now() + expiresIn * 1000, interval: Math.max(Number(value.interval) || 5, 1), nextPollAt: 0 })
    return { flowId, providerId, userCode: value.user_code, verificationUri: value.verification_uri_complete || value.verification_uri || value.verification_url, expiresIn, interval: Math.max(Number(value.interval) || 5, 1) }
  }

  function identityFor(providerId, tokens, extras = {}) {
    const claims = { ...decodeJwtPayload(tokens.access_token), ...decodeJwtPayload(tokens.id_token) }
    if (providerId === 'codex_oauth') {
      const nested = claims['https://api.openai.com/auth'] || {}
      const id = claims.chatgpt_account_id || nested.chatgpt_account_id || claims.sub
      if (!id) throw new Error('Codex Token 缺少账号标识')
      return { id: String(id), label: claims.email || `ChatGPT ${String(id).slice(0, 8)}`, email: claims.email || '', avatarUrl: '', domain: 'chatgpt.com' }
    }
    const id = claims.sub
    if (!id) throw new Error('xAI Token 缺少稳定的 sub 标识')
    return { id: String(id), label: claims.email || claims.preferred_username || `xAI ${String(id).slice(0, 8)}`, email: claims.email || '', avatarUrl: '', domain: 'x.ai', ...extras }
  }

  function saveAccount(providerId, account, tokens) {
    const meta = readMeta(); const state = providerMeta(providerId, meta)
    state.accounts = { ...(state.accounts || {}), [account.id]: { ...account, authProvider: providerId, authenticatedAt: now(), requiresReauth: false } }
    state.defaultAccountId = state.defaultAccountId && state.accounts[state.defaultAccountId] ? state.defaultAccountId : account.id
    meta[providerId] = state; writeMeta(meta)
    const secrets = readSecrets(); secrets[providerId] = { ...(secrets[providerId] || {}), [account.id]: tokens }; writeSecrets(secrets)
    return publicAccount(state.accounts[account.id], state.defaultAccountId)
  }

  async function pollLogin(flowId) {
    const flow = pending.get(String(flowId || ''))
    if (!flow) throw new Error('登录流程不存在或插件已重新加载，请重新登录')
    if (flow.expiresAt <= now()) { pending.delete(flowId); return { state: 'expired', message: '设备码已过期，请重新登录' } }
    if (flow.nextPollAt > now()) return { state: 'pending', retryAfterMs: flow.nextPollAt - now(), message: '等待浏览器授权' }
    flow.nextPollAt = now() + flow.interval * 1000
    let result
    if (flow.providerId === 'codex_oauth') {
      result = await requestJson(PROVIDERS.codex_oauth.pollUrl, { method: 'POST', headers: { 'content-type': 'application/json', 'user-agent': 'ztools-cc-switch-codex-oauth' }, body: JSON.stringify({ device_auth_id: flow.deviceAuthId, user_code: flow.userCode }) })
      if (!result.response.ok || result.value.error) {
        const code = result.value.error
        if (['authorization_pending', 'pending'].includes(code) || [403, 404].includes(result.response.status)) return { state: 'pending', retryAfterMs: flow.interval * 1000, message: '等待浏览器授权' }
        if (code === 'access_denied') { pending.delete(flowId); return { state: 'denied', message: '用户拒绝了授权' } }
        if (code === 'expired_token') { pending.delete(flowId); return { state: 'expired', message: '设备码已过期，请重新登录' } }
        throw oauthError(result.value, result.response, 'Codex 授权轮询失败')
      }
      if (!result.value.authorization_code || !result.value.code_verifier) return { state: 'pending', retryAfterMs: flow.interval * 1000, message: '等待浏览器授权' }
      result = await requestJson(PROVIDERS.codex_oauth.tokenUrl, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded', 'user-agent': 'ztools-cc-switch-codex-oauth' }, body: formBody({ grant_type: 'authorization_code', code: result.value.authorization_code, redirect_uri: PROVIDERS.codex_oauth.redirectUri, client_id: PROVIDERS.codex_oauth.clientId, code_verifier: result.value.code_verifier }) })
    } else if (flow.providerId === 'xai_oauth') {
      result = await requestJson(flow.tokenUrl, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded', 'user-agent': 'ztools-cc-switch-xai-oauth' }, body: formBody({ grant_type: 'urn:ietf:params:oauth:grant-type:device_code', client_id: PROVIDERS.xai_oauth.clientId, device_code: flow.deviceCode }) })
    } else {
      result = await requestJson(`https://${flow.domain}/login/oauth/access_token`, { method: 'POST', headers: { accept: 'application/json', 'content-type': 'application/x-www-form-urlencoded', 'user-agent': 'ztools-cc-switch-copilot' }, body: formBody({ client_id: flow.clientId, device_code: flow.deviceCode, grant_type: 'urn:ietf:params:oauth:grant-type:device_code' }) })
    }
    const errorCode = result.value.error
    if (errorCode) {
      if (errorCode === 'slow_down') { flow.interval += 5; flow.nextPollAt = now() + flow.interval * 1000; return { state: 'pending', retryAfterMs: flow.interval * 1000, message: '授权服务要求降低轮询频率' } }
      if (errorCode === 'authorization_pending') return { state: 'pending', retryAfterMs: flow.interval * 1000, message: '等待浏览器授权' }
      pending.delete(flowId)
      if (errorCode === 'access_denied') return { state: 'denied', message: '用户拒绝了授权' }
      if (errorCode === 'expired_token') return { state: 'expired', message: '设备码已过期，请重新登录' }
      throw oauthError(result.value, result.response, 'OAuth 授权失败')
    }
    if (!result.response.ok || !result.value.access_token) throw oauthError(result.value, result.response, 'OAuth Token 获取失败')
    let account
    if (flow.providerId === 'github_copilot') {
      const apiBase = flow.domain === 'github.com' ? 'https://api.github.com' : `https://${flow.domain}/api/v3`
      const userResult = await requestJson(`${apiBase}/user`, { headers: { authorization: `token ${result.value.access_token}`, accept: 'application/vnd.github+json', 'user-agent': 'ztools-cc-switch-copilot', 'x-github-api-version': '2025-10-01' } })
      if (!userResult.response.ok || !userResult.value.id) throw oauthError(userResult.value, userResult.response, 'GitHub 用户信息获取失败')
      account = { id: `${flow.domain}:${userResult.value.id}`, label: userResult.value.login, email: userResult.value.email || '', avatarUrl: userResult.value.avatar_url || '', domain: flow.domain }
    } else account = identityFor(flow.providerId, result.value)
    const expiresIn = Math.max(Number(result.value.expires_in) || 3600, 60)
    const tokens = flow.providerId === 'github_copilot'
      ? { githubToken: result.value.access_token }
      : { accessToken: result.value.access_token, refreshToken: result.value.refresh_token, idToken: result.value.id_token || '', expiresAt: now() + expiresIn * 1000, tokenUrl: flow.tokenUrl || PROVIDERS.codex_oauth.tokenUrl }
    if (flow.providerId !== 'github_copilot' && !tokens.refreshToken) throw new Error('OAuth 成功响应缺少 refresh_token，未保存账号')
    pending.delete(flowId); accessCache.delete(`${flow.providerId}:${account.id}`)
    return { state: 'authenticated', account: saveAccount(flow.providerId, account, tokens), message: `${account.label} 已连接` }
  }

  function resolveAccount(providerId, requestedId) {
    const state = providerMeta(providerId)
    const id = requestedId || state.defaultAccountId
    const account = state.accounts?.[id]
    if (!account) throw new Error(`${PROVIDERS[providerId]?.name || providerId} 账号不存在`)
    if (account.requiresReauth) throw new Error(`${account.label} 需要重新登录`)
    return account
  }
  async function setDefault(providerId, accountId) {
    const meta = readMeta(); const state = providerMeta(providerId, meta)
    if (!state.accounts?.[accountId]) throw new Error('账号不存在')
    if (state.accounts[accountId].requiresReauth) throw new Error('该账号需要重新登录')
    state.defaultAccountId = accountId; meta[providerId] = state; writeMeta(meta)
    return getStatus(providerId)
  }
  async function removeAccount(providerId, accountId) {
    const meta = readMeta(); const state = providerMeta(providerId, meta)
    if (!state.accounts?.[accountId]) return false
    delete state.accounts[accountId]
    if (state.defaultAccountId === accountId) state.defaultAccountId = Object.keys(state.accounts).find((id) => !state.accounts[id].requiresReauth) || ''
    meta[providerId] = state; writeMeta(meta)
    const secrets = readSecrets(); if (secrets[providerId]) { delete secrets[providerId][accountId]; writeSecrets(secrets) }
    accessCache.delete(`${providerId}:${accountId}`); refreshLocks.delete(`${providerId}:${accountId}`)
    return true
  }
  function markReauth(providerId, accountId) {
    const meta = readMeta(); const state = providerMeta(providerId, meta)
    if (state.accounts?.[accountId]) { state.accounts[accountId].requiresReauth = true; meta[providerId] = state; writeMeta(meta) }
  }

  async function refreshOAuth(providerId, account, tokens) {
    const definition = PROVIDERS[providerId]
    const tokenUrl = tokens.tokenUrl || (providerId === 'codex_oauth' ? definition.tokenUrl : (await discoverXai()).tokenUrl)
    const result = await requestJson(tokenUrl, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded', 'user-agent': `ztools-cc-switch-${providerId}` }, body: formBody({ grant_type: 'refresh_token', client_id: definition.clientId, refresh_token: tokens.refreshToken }) })
    if (!result.response.ok || result.value.error || !result.value.access_token) {
      if (['invalid_grant', 'invalid_token'].includes(result.value.error) || result.response.status === 401) markReauth(providerId, account.id)
      throw oauthError(result.value, result.response, 'OAuth Token 刷新失败')
    }
    const next = { ...tokens, accessToken: result.value.access_token, refreshToken: result.value.refresh_token || tokens.refreshToken, idToken: result.value.id_token || tokens.idToken || '', expiresAt: now() + Math.max(Number(result.value.expires_in) || 3600, 60) * 1000, tokenUrl }
    const secrets = readSecrets(); secrets[providerId][account.id] = next; writeSecrets(secrets)
    return next
  }
  async function getOAuthToken(providerId, account) {
    const key = `${providerId}:${account.id}`
    const secrets = readSecrets(); const stored = secrets[providerId]?.[account.id]
    if (!stored) throw new Error('账号密钥不存在，请重新登录')
    if (stored.accessToken && Number(stored.expiresAt) - now() > REFRESH_BUFFER_MS) return stored.accessToken
    if (refreshLocks.has(key)) return refreshLocks.get(key)
    const promise = refreshOAuth(providerId, account, stored).then((next) => next.accessToken).finally(() => refreshLocks.delete(key))
    refreshLocks.set(key, promise); return promise
  }
  async function getCopilotToken(account) {
    const key = `github_copilot:${account.id}`; const cached = accessCache.get(key)
    if (cached && cached.expiresAt * 1000 - now() > REFRESH_BUFFER_MS) return cached.token
    if (refreshLocks.has(key)) return refreshLocks.get(key)
    const promise = (async () => {
      const stored = readSecrets().github_copilot?.[account.id]
      if (!stored?.githubToken) throw new Error('GitHub 账号密钥不存在，请重新登录')
      const apiBase = account.domain === 'github.com' ? 'https://api.github.com' : `https://${account.domain}/api/v3`
      const result = await requestJson(`${apiBase}/copilot_internal/v2/token`, { headers: { authorization: `token ${stored.githubToken}`, accept: 'application/json', 'user-agent': 'GitHubCopilotChat/0.38.2', 'editor-version': 'vscode/1.110.1', 'editor-plugin-version': 'copilot-chat/0.38.2', 'x-github-api-version': '2025-10-01' } })
      if (!result.response.ok || !result.value.token) { if (result.response.status === 401) markReauth('github_copilot', account.id); throw oauthError(result.value, result.response, 'Copilot Token 获取失败') }
      const token = { token: result.value.token, expiresAt: Number(result.value.expires_at) || Math.floor(now() / 1000) + 1800 }
      accessCache.set(key, token); return token.token
    })().finally(() => refreshLocks.delete(key))
    refreshLocks.set(key, promise); return promise
  }

  async function getCopilotEndpoint(account) {
    if (endpointCache.has(account.id)) return endpointCache.get(account.id)
    const fallback = account.domain === 'github.com' ? 'https://api.githubcopilot.com' : `https://copilot-api.${account.domain}`
    try {
      const stored = readSecrets().github_copilot?.[account.id]
      if (!stored?.githubToken) return fallback
      const apiBase = account.domain === 'github.com' ? 'https://api.github.com' : `https://${account.domain}/api/v3`
      const result = await requestJson(`${apiBase}/copilot_internal/user`, { headers: { authorization: `token ${stored.githubToken}`, accept: 'application/json', 'user-agent': 'GitHubCopilotChat/0.38.2', 'editor-version': 'vscode/1.110.1', 'editor-plugin-version': 'copilot-chat/0.38.2', 'x-github-api-version': '2025-10-01' } })
      const candidate = String(result.value?.endpoints?.api || '')
      if (result.response.ok && candidate) {
        const parsed = new URL(candidate)
        if (parsed.protocol === 'https:') { const value = parsed.href.replace(/\/$/, ''); endpointCache.set(account.id, value); return value }
      }
    } catch {}
    endpointCache.set(account.id, fallback)
    return fallback
  }

  async function getValidToken(providerId, accountId) {
    if (!PROVIDERS[providerId]) throw new Error(`不支持的认证类型: ${providerId}`)
    const account = resolveAccount(providerId, accountId)
    const token = providerId === 'github_copilot' ? await getCopilotToken(account) : await getOAuthToken(providerId, account)
    const baseUrl = providerId === 'codex_oauth'
      ? 'https://chatgpt.com/backend-api/codex'
      : providerId === 'xai_oauth' ? 'https://api.x.ai/v1' : await getCopilotEndpoint(account)
    return { token, accountId: account.id, account, baseUrl }
  }

  return { listProviders, getStatus, startLogin, pollLogin, setDefault, removeAccount, getValidToken, normalizeGithubDomain, secureStorage: Boolean(secretCodec.secure) }
}

module.exports = { META_KEY, SECRET_KEY, PROVIDERS, createMemoryStorage, normalizeGithubDomain, decodeJwtPayload, createAuthManager }
