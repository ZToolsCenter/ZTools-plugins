'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs/promises')
const os = require('node:os')
const path = require('node:path')
const { parseClaudeCredentials, parseCodexCredentials, parseGeminiCredentials, windowName, classifyGemini, createSubscriptionManager } = require('../preload/subscriptionManager')

function json(value, status = 200) { return new Response(JSON.stringify(value), { status, headers: { 'content-type': 'application/json' } }) }

test('parses CLI OAuth credential formats and quota tier names', () => {
  const now = 1_700_000_000_000
  assert.equal(parseClaudeCredentials({ claudeAiOauth: { accessToken: 'c', expiresAt: now + 1 } }, now).status, 'valid')
  assert.equal(parseClaudeCredentials({ 'claude.ai_oauth': { accessToken: 'c', expiresAt: now - 1 } }, now).status, 'expired')
  assert.equal(parseCodexCredentials({ auth_mode: 'chatgpt', tokens: { access_token: 'x', account_id: 'a' }, last_refresh: new Date(now).toISOString() }, now).accountId, 'a')
  assert.equal(parseGeminiCredentials({ token: { accessToken: 'g', refreshToken: 'r', expiresAt: now - 1 } }, now).status, 'expired')
  assert.equal(windowName(18000), 'five_hour'); assert.equal(windowName(2592000), '30_day'); assert.equal(classifyGemini('gemini-2.5-flash-lite'), 'gemini_flash_lite')
})

test('queries Claude, Codex CLI, managed Codex and refreshed Gemini quotas without exposing tokens', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'ztools-subscription-')); t.after(() => fs.rm(root, { recursive: true, force: true }))
  await fs.mkdir(path.join(root, '.claude'), { recursive: true }); await fs.mkdir(path.join(root, '.codex'), { recursive: true }); await fs.mkdir(path.join(root, '.gemini'), { recursive: true })
  await fs.writeFile(path.join(root, '.claude', '.credentials.json'), JSON.stringify({ claudeAiOauth: { accessToken: 'claude-token', expiresAt: Date.now() + 100000 } }))
  await fs.writeFile(path.join(root, '.codex', 'auth.json'), JSON.stringify({ auth_mode: 'chatgpt', tokens: { access_token: 'codex-token', account_id: 'codex-account' }, last_refresh: new Date().toISOString() }))
  await fs.writeFile(path.join(root, '.gemini', 'oauth_creds.json'), JSON.stringify({ access_token: 'old-gemini', refresh_token: 'gemini-refresh', expiry_date: Date.now() - 1000 }))
  const calls = []
  const fetchImpl = async (url, options = {}) => {
    url = String(url); calls.push({ url, options })
    if (url.includes('api.anthropic.com')) { assert.equal(options.headers.authorization, 'Bearer claude-token'); return json({ five_hour: { utilization: 12.5, resets_at: '2026-07-23T00:00:00Z' }, extra_usage: { is_enabled: true, monthly_limit: 100, used_credits: 8, utilization: 8, currency: 'USD' } }) }
    if (url.includes('/wham/usage')) { assert.match(options.headers.authorization, /^Bearer (codex-token|managed-token)$/); return json({ rate_limit: { primary_window: { used_percent: 30, limit_window_seconds: 18000, reset_at: 1800000000 }, secondary_window: { used_percent: 40, limit_window_seconds: 604800, reset_at: 1801000000 } } }) }
    if (url.includes('oauth2.googleapis.com/token')) { assert.match(String(options.body), /refresh_token=gemini-refresh/); return json({ access_token: 'new-gemini' }) }
    if (url.includes('loadCodeAssist')) { assert.equal(options.headers.authorization, 'Bearer new-gemini'); return json({ cloudaicompanionProject: { id: 'project-1' } }) }
    if (url.includes('retrieveUserQuota')) { assert.equal(JSON.parse(options.body).project, 'project-1'); return json({ buckets: [{ modelId: 'gemini-2.5-pro', remainingFraction: .75, resetTime: '2026-07-23T00:00:00Z' }, { modelId: 'gemini-2.5-pro-preview', remainingFraction: .5 }, { modelId: 'gemini-2.5-flash', remainingFraction: .9 }] }) }
    throw new Error(`unexpected ${url}`)
  }
  const authManager = { getValidToken: async () => ({ token: 'managed-token', accountId: 'managed-account' }), getStatus: () => ({ accounts: [{ id: 'managed-account', label: 'managed@example.com' }] }) }
  const manager = createSubscriptionManager({ homeDir: root, authManager, fetchImpl, readKeychain: async () => null })
  const results = await manager.queryAll({ force: true })
  assert.equal(results.length, 4)
  assert.equal(results.find((item) => item.tool === 'claude').tiers[0].utilization, 12.5)
  assert.deepEqual(results.find((item) => item.tool === 'codex').tiers.map((item) => item.name), ['five_hour', 'seven_day'])
  assert.equal(results.find((item) => item.tool === 'gemini').tiers[0].utilization, 50)
  assert.equal(results.find((item) => item.tool === 'codex_oauth').accountLabel, 'managed@example.com')
  assert.equal(JSON.stringify(results).includes('managed-token'), false)
  const before = calls.length; const cached = await manager.queryQuota('claude'); assert.equal(cached.cached, true); assert.equal(calls.length, before)
})

test('keeps deterministic auth failures structured and speedtests with warm-up requests', async () => {
  let requests = 0
  const manager = createSubscriptionManager({ homeDir: os.tmpdir(), readKeychain: async (service) => service === 'Claude Code-credentials' ? JSON.stringify({ claudeAiOauth: { accessToken: 'expired-server-side' } }) : null, authManager: { getStatus: () => ({ accounts: [] }) }, fetchImpl: async (url) => {
    requests += 1
    if (String(url).includes('anthropic')) return json({ error: 'expired' }, 401)
    return new Response(null, { status: 204 })
  } })
  const quota = await manager.queryQuota('claude', { force: true }); assert.equal(quota.success, false); assert.equal(quota.credentialStatus, 'expired')
  const speed = await manager.testEndpoints(['https://one.example.com', 'bad url'], 2)
  assert.equal(speed[0].status, 204); assert.ok(speed[0].latency >= 0); assert.equal(speed[1].error, 'URL 无效'); assert.equal(requests, 3)
})
