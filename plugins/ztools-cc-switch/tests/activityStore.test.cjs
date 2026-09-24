'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs/promises')
const os = require('node:os')
const path = require('node:path')
const { createActivityStore } = require('../preload/activityStore')

test('批量导入按稳定 ID 去重并保留数据来源', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'cc-switch-activity-')); t.after(() => fs.rm(root, { recursive: true, force: true }))
  const store = createActivityStore({ dataDir: root })
  const entry = { id: 'session:one', createdAt: 1000, client: 'claude', model: 'claude-sonnet', inputTokens: 10, outputTokens: 5, statusCode: 200, dataSource: 'session_log' }
  assert.deepEqual(await store.importMany([entry, entry]), { imported: 1, skipped: 1, proxyDuplicates: 0 })
  assert.deepEqual(await store.importMany([entry]), { imported: 0, skipped: 1, proxyDuplicates: 0 })
  const sources = await store.dataSources()
  assert.equal(sources[0].dataSource, 'session_log')
  assert.equal(sources[0].requestCount, 1)
})

test('按数据来源重置会先备份，只删除目标记录并原样保留损坏行', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'cc-switch-activity-reset-')); t.after(() => fs.rm(root, { recursive: true, force: true }))
  const store = createActivityStore({ dataDir: root })
  const logPath = path.join(root, 'request-logs.jsonl')
  const proxy = { id: 'proxy:kept', client: 'codex', inputTokens: 1, outputTokens: 1, dataSource: 'proxy' }
  const codex = { id: 'codex:removed', client: 'codex', inputTokens: 2, outputTokens: 1, dataSource: 'codex_session' }
  const claude = { id: 'claude:kept', client: 'claude', inputTokens: 3, outputTokens: 1, dataSource: 'session_log' }
  const malformed = '{"id":"broken",not-json}'
  const original = `${JSON.stringify(proxy)}\n${malformed}\n${JSON.stringify(codex)}\n${JSON.stringify(claude)}\n`
  await fs.mkdir(root, { recursive: true }); await fs.writeFile(logPath, original)

  const result = await store.backupAndResetDataSource('codex_session')
  assert.equal(result.removed, 1)
  assert.equal(await fs.readFile(result.backupPath, 'utf8'), original)
  const current = await fs.readFile(logPath, 'utf8')
  assert.ok(current.includes(malformed))
  assert.ok(current.includes('proxy:kept'))
  assert.ok(current.includes('claude:kept'))
  assert.equal(current.includes('codex:removed'), false)
  await assert.rejects(() => store.backupAndResetDataSource('../codex'), /数据来源无效/)
})

test('会话记录与十分钟内同指纹代理记录跨源去重', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'cc-switch-activity-')); t.after(() => fs.rm(root, { recursive: true, force: true }))
  const store = createActivityStore({ dataDir: root })
  await store.append({ id: 'proxy:one', createdAt: 1_000_000, client: 'codex', model: 'gpt-5', inputTokens: 100, outputTokens: 20, cacheReadTokens: 50, cacheCreationTokens: 99, statusCode: 200 })
  const result = await store.importMany([{ id: 'codex_session:one', createdAt: 1_300_000, client: 'codex', model: 'gpt-5', inputTokens: 100, outputTokens: 20, cacheReadTokens: 50, cacheCreationTokens: 0, statusCode: 200, dataSource: 'codex_session' }])
  assert.deepEqual(result, { imported: 0, skipped: 1, proxyDuplicates: 1 })
})

test('按上游定价语义计算成本并生成趋势、Provider 与模型统计', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'cc-switch-analytics-')); t.after(() => fs.rm(root, { recursive: true, force: true }))
  const store = createActivityStore({ dataDir: root })
  const first = await store.append({ id: 'claude-priced', createdAt: Date.UTC(2026, 6, 20, 10), client: 'claude', providerId: 'anthropic', providerName: 'Anthropic', model: 'claude-sonnet-4-5-20250929', inputTokens: 1_000_000, outputTokens: 100_000, cacheReadTokens: 200_000, statusCode: 200, latencyMs: 500, streaming: true, firstTokenMs: 120 })
  assert.equal(Number(first.totalCostUsd), 4.56)
  const second = await store.append({ id: 'codex-priced', createdAt: Date.UTC(2026, 6, 21, 11), client: 'codex', providerId: 'openai', providerName: 'OpenAI', model: 'gpt-5', inputTokens: 1_000_000, outputTokens: 100_000, cacheReadTokens: 200_000, statusCode: 500, latencyMs: 1500 })
  assert.equal(Number(second.totalCostUsd), 2.025)

  const summary = await store.summary()
  assert.equal(summary.totalRequests, 2)
  assert.equal(summary.successRate, 0.5)
  assert.equal(summary.realTotalTokens, 2_600_000)
  assert.equal((await store.trends()).length, 2)
  assert.equal((await store.providerStats())[0].requestCount, 1)
  assert.equal((await store.modelStats()).length, 2)
  const detail = await store.detail('claude-priced')
  assert.equal(detail.requestId, 'claude-priced')
  assert.equal(detail.appType, 'claude')
  assert.equal(detail.firstTokenMs, 120)
  assert.equal((await store.paginated({}, 0, 1)).total, 2)
})

test('自定义模型价格回填未定价历史记录并支持删除覆盖', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'cc-switch-pricing-')); t.after(() => fs.rm(root, { recursive: true, force: true }))
  const store = createActivityStore({ dataDir: root })
  await store.append({ id: 'custom-unpriced', client: 'claude', model: 'vendor/custom-model', inputTokens: 1_000_000, outputTokens: 500_000, statusCode: 200 })
  assert.equal(Number((await store.detail('custom-unpriced')).totalCostUsd), 0)
  const saved = await store.updatePricing({ modelId: 'custom-model', displayName: 'Custom Model', inputCostPerMillion: '2', outputCostPerMillion: '8', cacheReadCostPerMillion: '0.2', cacheCreationCostPerMillion: '2.5' })
  assert.equal(saved.backfilled, 1)
  assert.equal(Number((await store.detail('custom-unpriced')).totalCostUsd), 6)
  assert.ok((await store.listPricing()).some((item) => item.modelId === 'custom-model' && item.builtin === false))
  await store.deletePricing('custom-model')
  assert.equal((await store.listPricing()).some((item) => item.modelId === 'custom-model'), false)
  await assert.rejects(() => store.updatePricing({ modelId: '../bad', displayName: 'Bad', inputCost: '-1', outputCost: '0', cacheReadCost: '0', cacheCreationCost: '0' }), /模型 ID|非负/)
})

test('Provider 成本倍率和日月限额使用本地时区精确累计', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'cc-switch-limits-')); t.after(() => fs.rm(root, { recursive: true, force: true }))
  const store = createActivityStore({ dataDir: root })
  const now = Date.now()
  const item = await store.append({ id: 'limited', createdAt: now, client: 'codex', providerId: 'metered', model: 'gpt-5', inputTokens: 1_000_000, outputTokens: 0, costMultiplier: '2', statusCode: 200 })
  assert.equal(Number(item.totalCostUsd), 2.5)
  const status = await store.checkProviderLimits({ id: 'metered', limitDailyUsd: '2.5', limitMonthlyUsd: '10' })
  assert.equal(status.dailyExceeded, true)
  assert.equal(status.monthlyExceeded, false)
  assert.equal(Number(status.dailyUsage), 2.5)
})

test('应用级计费默认值支持 Provider 覆盖并让 Claude Desktop 继承 Claude', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'cc-switch-billing-defaults-')); t.after(() => fs.rm(root, { recursive: true, force: true }))
  const store = createActivityStore({ dataDir: root })
  assert.deepEqual((await store.getBillingDefaults()).codex, { multiplier: '1', source: 'response' })
  await store.saveBillingDefaults({ claude: { multiplier: '1.5', source: 'request' }, codex: { multiplier: '2', source: 'response' }, gemini: { multiplier: '0.8', source: 'request' }, grokbuild: { multiplier: '1.2', source: 'response' } })
  assert.deepEqual(await store.resolveBillingConfig({}, 'claude-desktop'), { multiplier: '1.5', source: 'request', inherited: true })
  assert.deepEqual(await store.resolveBillingConfig({ costMultiplier: '3', pricingModelSource: 'response' }, 'claude'), { multiplier: '3', source: 'response', inherited: false })
  assert.deepEqual(await store.resolveBillingConfig({ costMultiplier: '', pricingModelSource: '' }, 'gemini'), { multiplier: '0.8', source: 'request', inherited: true })
  await assert.rejects(() => store.saveBillingDefaults({ claude: { multiplier: '-1' } }), /非负十进制数/)
})
