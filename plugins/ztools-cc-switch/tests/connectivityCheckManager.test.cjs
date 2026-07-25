'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const fsp = require('node:fs/promises')
const os = require('node:os')
const path = require('node:path')
const { normalizeConfig, shouldRetry, createConnectivityCheckManager } = require('../preload/connectivityCheckManager')

async function temp(t) { const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'ztools-reachability-')); t.after(() => fsp.rm(root, { recursive: true, force: true })); return root }
const providers = [
  { id: 'active', name: 'Active', baseUrl: 'https://active.example/v1', clients: ['claude'], failoverPriority: 0 },
  { id: 'backup', name: 'Backup', baseUrl: 'https://backup.example/v1', clients: ['claude'], failoverPriority: 1 },
  { id: 'other', name: 'Other', baseUrl: 'https://other.example/v1', clients: ['claude'], failoverPriority: 0 }
]

test('连通检测收到任意 HTTP 响应即判定可达且不发送鉴权', async (t) => {
  const root = await temp(t); const calls = []; let clock = 0
  const manager = createConnectivityCheckManager({ dataDir: root, configManager: { listProviders: async () => ({ providers, active: { claude: 'active' } }) }, now: () => { clock += 120; return clock }, fetchImpl: async (url, init) => { calls.push([String(url), init]); return new Response('', { status: 401 }) } })
  const result = await manager.checkProvider('claude', 'active')
  assert.equal(result.success, true); assert.equal(result.status, 'operational'); assert.equal(result.httpStatus, 401); assert.equal(result.responseTimeMs, 120)
  assert.equal(calls[0][1].headers.authorization, undefined); assert.equal(calls[0][1].method, 'GET')
  assert.equal((await manager.listLogs()).length, 1)
})

test('只对超时类失败重试，并按 TTFB 标记 degraded', async (t) => {
  const root = await temp(t); let attempts = 0; let clock = 0
  const manager = createConnectivityCheckManager({ dataDir: root, configManager: { listProviders: async () => ({ providers, active: {} }) }, now: () => { clock += 7000; return clock }, fetchImpl: async () => { attempts += 1; if (attempts < 2) throw Object.assign(new Error('aborted'), { name: 'AbortError' }); return new Response('', { status: 503 }) } })
  await manager.saveConfig({ timeoutSecs: 8, maxRetries: 1, degradedThresholdMs: 6000 })
  const result = await manager.checkProvider('claude', 'backup')
  assert.equal(attempts, 2); assert.equal(result.success, true); assert.equal(result.status, 'degraded'); assert.equal(result.retryCount, 1); assert.equal(result.httpStatus, 503)
  assert.equal(shouldRetry(new Error('DNS lookup failed')), false); assert.equal(shouldRetry(new Error('Request timeout')), true)
})

test('批量检测可限制为当前与故障转移目标并规范化参数', async (t) => {
  const root = await temp(t)
  const manager = createConnectivityCheckManager({ dataDir: root, configManager: { listProviders: async () => ({ providers, active: { claude: 'active' } }) }, fetchImpl: async () => new Response('', { status: 204 }) })
  const rows = await manager.checkAll('claude', true)
  assert.deepEqual(rows.map(([id]) => id), ['active', 'backup'])
  assert.deepEqual(normalizeConfig({ timeoutSecs: 0, maxRetries: 0, degradedThresholdMs: 999999 }), { timeoutSecs: 8, maxRetries: 0, degradedThresholdMs: 30000 })
})

test('连接拒绝立即失败且不会污染路由熔断状态', async (t) => {
  const root = await temp(t); let attempts = 0
  const manager = createConnectivityCheckManager({ dataDir: root, configManager: { listProviders: async () => ({ providers, active: {} }) }, fetchImpl: async () => { attempts += 1; throw new Error('ECONNREFUSED') } })
  const result = await manager.checkProvider('claude', 'active')
  assert.equal(result.success, false); assert.match(result.message, /Connection failed/); assert.equal(attempts, 1)
})
