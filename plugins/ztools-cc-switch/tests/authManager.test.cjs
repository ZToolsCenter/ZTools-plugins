'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const { META_KEY, SECRET_KEY, createMemoryStorage, normalizeGithubDomain, decodeJwtPayload, createAuthManager } = require('../preload/authManager')

function jwt(payload) {
  const part = (value) => Buffer.from(JSON.stringify(value)).toString('base64url')
  return `${part({ alg: 'none' })}.${part(payload)}.`
}
function json(value, status = 200) { return new Response(JSON.stringify(value), { status, headers: { 'content-type': 'application/json' } }) }

test('normalizes GitHub domains and extracts untrusted JWT identity payloads', () => {
  assert.equal(normalizeGithubDomain('https://GitHub.COM/'), 'github.com')
  assert.throws(() => normalizeGithubDomain('github.com/path'), /无效/)
  assert.equal(decodeJwtPayload(jwt({ sub: 'u1' })).sub, 'u1')
  assert.deepEqual(decodeJwtPayload('invalid'), {})
})

test('Codex device flow stores encrypted secrets and coalesces concurrent refreshes', async () => {
  let clock = 1_700_000_000_000; let refreshCalls = 0
  const storage = createMemoryStorage()
  const calls = []
  const fetchImpl = async (url, options = {}) => {
    calls.push({ url: String(url), options })
    if (String(url).endsWith('/deviceauth/usercode')) return json({ device_auth_id: 'dev-1', user_code: 'ABCD-EFGH', interval: 1, expires_in: 900 })
    if (String(url).endsWith('/deviceauth/token')) return json({ authorization_code: 'auth-code', code_verifier: 'verifier' })
    if (String(url).endsWith('/oauth/token')) {
      const body = String(options.body)
      if (body.includes('refresh_token')) { refreshCalls += 1; await new Promise((resolve) => setTimeout(resolve, 5)); return json({ access_token: 'refreshed-access', refresh_token: 'refresh-2', expires_in: 3600 }) }
      return json({ access_token: 'initial-access', refresh_token: 'refresh-1', id_token: jwt({ email: 'dev@example.com', 'https://api.openai.com/auth': { chatgpt_account_id: 'acct-1' } }), expires_in: 60 })
    }
    throw new Error(`unexpected ${url}`)
  }
  const manager = createAuthManager({ storage, fetchImpl, now: () => clock, secretCodec: { secure: true, encode: (v) => `ENC(${Buffer.from(v).toString('base64')})`, decode: (v) => Buffer.from(v.slice(4, -1), 'base64').toString() } })
  const flow = await manager.startLogin('codex_oauth')
  assert.equal(flow.userCode, 'ABCD-EFGH'); assert.equal(flow.verificationUri, 'https://auth.openai.com/codex/device')
  const loggedIn = await manager.pollLogin(flow.flowId)
  assert.equal(loggedIn.state, 'authenticated'); assert.equal(loggedIn.account.id, 'acct-1')
  assert.equal(manager.getStatus('codex_oauth').defaultAccountId, 'acct-1')
  const stored = storage.getItem(SECRET_KEY)
  assert.ok(stored.startsWith('ENC(')); assert.equal(stored.includes('refresh-1'), false); assert.equal(JSON.stringify(storage.getItem(META_KEY)).includes('refresh-1'), false)
  clock += 10_000
  const [one, two] = await Promise.all([manager.getValidToken('codex_oauth', 'acct-1'), manager.getValidToken('codex_oauth', 'acct-1')])
  assert.equal(one.token, 'refreshed-access'); assert.equal(two.token, 'refreshed-access'); assert.equal(refreshCalls, 1)
  const tokenExchange = calls.find((call) => call.url.endsWith('/oauth/token') && String(call.options.body).includes('authorization_code'))
  assert.match(String(tokenExchange.options.body), /code_verifier=verifier/)
})

test('xAI discovery handles slow_down and saves stable sub account', async () => {
  let clock = 1_700_000_000_000; let polls = 0
  const manager = createAuthManager({ storage: createMemoryStorage(), now: () => clock, fetchImpl: async (url) => {
    url = String(url)
    if (url.endsWith('/.well-known/openid-configuration')) return json({ issuer: 'https://auth.x.ai', device_authorization_endpoint: 'https://auth.x.ai/device', token_endpoint: 'https://auth.x.ai/token' })
    if (url.endsWith('/device')) return json({ device_code: 'x-device', user_code: 'XAI-CODE', verification_uri: 'https://auth.x.ai/activate', interval: 1, expires_in: 600 })
    if (url.endsWith('/token')) { polls += 1; return polls === 1 ? json({ error: 'slow_down' }, 400) : json({ access_token: jwt({ sub: 'x-user', email: 'x@example.com' }), refresh_token: 'x-refresh', expires_in: 3600 }) }
    throw new Error(`unexpected ${url}`)
  } })
  const flow = await manager.startLogin('xai_oauth')
  const pending = await manager.pollLogin(flow.flowId); assert.equal(pending.state, 'pending'); assert.ok(pending.retryAfterMs >= 6000)
  clock += pending.retryAfterMs
  const result = await manager.pollLogin(flow.flowId)
  assert.equal(result.state, 'authenticated'); assert.equal(result.account.id, 'x-user')
})

test('GitHub Copilot login supports GHES and coalesces Copilot token exchange', async () => {
  let tokenCalls = 0
  const storage = createMemoryStorage()
  const manager = createAuthManager({ storage, fetchImpl: async (url, options = {}) => {
    url = String(url)
    if (url === 'https://ghe.example.com/login/device/code') return json({ device_code: 'gh-dev', user_code: 'GH-CODE', verification_uri: 'https://ghe.example.com/login/device', interval: 1, expires_in: 900 })
    if (url === 'https://ghe.example.com/login/oauth/access_token') return json({ access_token: 'github-secret' })
    if (url === 'https://ghe.example.com/api/v3/user') { assert.equal(options.headers.authorization, 'token github-secret'); return json({ id: 42, login: 'octocat', avatar_url: 'https://example.com/a.png' }) }
    if (url === 'https://ghe.example.com/api/v3/copilot_internal/v2/token') { tokenCalls += 1; await new Promise((resolve) => setTimeout(resolve, 5)); return json({ token: 'copilot-short', expires_at: Math.floor(Date.now() / 1000) + 1800 }) }
    throw new Error(`unexpected ${url}`)
  } })
  const flow = await manager.startLogin('github_copilot', { domain: 'ghe.example.com' })
  const login = await manager.pollLogin(flow.flowId); assert.equal(login.account.id, 'ghe.example.com:42')
  const [one, two] = await Promise.all([manager.getValidToken('github_copilot'), manager.getValidToken('github_copilot')])
  assert.equal(one.token, 'copilot-short'); assert.equal(two.token, 'copilot-short'); assert.equal(tokenCalls, 1)
  assert.equal(storage.getItem(SECRET_KEY).includes('github-secret'), false)
  await manager.removeAccount('github_copilot', login.account.id)
  assert.equal(manager.getStatus('github_copilot').accounts.length, 0)
})
