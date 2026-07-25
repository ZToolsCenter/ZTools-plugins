'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const {
  detectCodingPlanProvider, parseKimi, parseZhipu, parseMiniMax, parseZenMux,
  parseVolcAfp, parseVolcCoding, volcRegion, volcCanonicalQuery, volcSign, createCodingPlanManager
} = require('../preload/codingPlanManager')

function response(status, body) {
  return { status, ok: status >= 200 && status < 300, text: async () => typeof body === 'string' ? body : JSON.stringify(body) }
}
function harness(providers, fetchImpl) {
  const values = new Map()
  const storage = { getItem: (key) => values.get(key), setItem: (key, value) => values.set(key, value) }
  const secretCodec = { secure: true, encode: (value) => Buffer.from(value).toString('base64'), decode: (value) => Buffer.from(value, 'base64').toString('utf8') }
  const manager = createCodingPlanManager({ fetchImpl, storage, secretCodec, getProvider: async (id) => providers.find((item) => item.id === id), listProviders: async () => ({ providers }) })
  return { manager, values }
}

test('检测上游全部 Coding Plan 供应商并解析各类额度窗口', () => {
  assert.equal(detectCodingPlanProvider('https://api.kimi.com/coding/v1'), 'kimi')
  assert.equal(detectCodingPlanProvider('https://open.bigmodel.cn/api/coding/paas/v4'), 'zhipu_cn')
  assert.equal(detectCodingPlanProvider('https://api.z.ai/api/coding/paas/v4'), 'zhipu_en')
  assert.equal(detectCodingPlanProvider('https://api.minimaxi.com/anthropic'), 'minimax_cn')
  assert.equal(detectCodingPlanProvider('https://api.minimax.io/anthropic'), 'minimax_en')
  assert.equal(detectCodingPlanProvider('https://zenmux.ai/api/usage'), 'zenmux')
  assert.equal(detectCodingPlanProvider('https://ark.cn-beijing.volces.com/api/coding'), 'volcengine')
  assert.equal(detectCodingPlanProvider('https://example.com/v1'), '')

  assert.deepEqual(parseKimi({ limits: [{ detail: { limit: 100, remaining: 75, resetTime: 1782057600 } }], usage: { limit: '200', remaining: '50' } }).map((item) => [item.name, item.utilization]), [['five_hour', 25], ['weekly_limit', 75]])
  const zhipu = parseZhipu({ success: true, data: { level: 'pro', limits: [{ type: 'TOKENS_LIMIT', unit: 6, percentage: 42 }, { type: 'tokens_limit', unit: 3, percentage: 1 }] } })
  assert.equal(zhipu.credentialMessage, 'pro'); assert.deepEqual(zhipu.tiers.map((item) => [item.name, item.utilization]), [['five_hour', 1], ['weekly_limit', 42]])
  assert.deepEqual(parseMiniMax({ model_remains: [{ model_name: 'general', current_interval_remaining_percent: 80, current_weekly_status: 1, current_weekly_remaining_percent: 65 }] }).tiers.map((item) => item.utilization), [20, 35])
  const zen = parseZenMux({ success: true, data: { quota_5_hour: { usage_percentage: .4, used_value_usd: 2, max_value_usd: 5 }, plan: { tier: 'pro' }, account_status: 'active' } })
  assert.equal(zen.tiers[0].utilization, 40); assert.equal(zen.tiers[0].maxValueUsd, 5); assert.equal(zen.credentialMessage, 'pro (active)')
  assert.deepEqual(parseVolcAfp({ AFPFiveHour: { Quota: 100, Used: 12 }, AFPDaily: { Quota: 1, Used: 1 }, AFPMonthly: { Quota: 200, Used: 50 } }).map((item) => item.name), ['five_hour', 'monthly'])
  assert.deepEqual(parseVolcCoding({ QuotaUsage: [{ Level: 'session', Percent: 4, ResetTimestamp: -1 }, { Level: 'weekly', Percent: 20 }, { Level: 'daily', Percent: 99 }] }).map((item) => item.name), ['five_hour', 'weekly_limit'])
})

test('火山签名结构、Region 与 canonical query 对照上游语义', () => {
  assert.equal(volcRegion('https://ark.cn-shanghai.volces.com/api/coding/v3'), 'cn-shanghai')
  const query = volcCanonicalQuery('GetAFPUsage', 'cn-beijing')
  assert.equal(query, 'Action=GetAFPUsage&Region=cn-beijing&Version=2024-01-01')
  const signed = volcSign('AKLTtest', 'secretkey', 'cn-beijing', query, new Date('2024-06-21T00:00:00Z'))
  assert.equal(signed.xDate, '20240621T000000Z')
  assert.equal(signed.bodyHash, 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855')
  assert.match(signed.authorization, /^HMAC-SHA256 Credential=AKLTtest\/20240621\/cn-beijing\/ark\/request,/)
  assert.match(signed.authorization, /SignedHeaders=host;x-date;x-content-sha256;content-type,/)
  assert.match(signed.authorization, /Signature=[0-9a-f]{64}$/)
})

test('Kimi、智谱团队和 MiniMax 查询使用正确端点与鉴权头', async () => {
  const calls = []
  const providers = [
    { id: 'kimi', name: 'Kimi', baseUrl: 'https://api.kimi.com/coding/v1', apiKey: 'kimi-key' },
    { id: 'team', name: 'Zhipu Team', baseUrl: 'https://open.bigmodel.cn/api/coding/paas/v4', apiKey: 'team-key' },
    { id: 'mini', name: 'MiniMax', baseUrl: 'https://api.minimaxi.com/anthropic', apiKey: 'mini-key' }
  ]
  const { manager, values } = harness(providers, async (url, init) => {
    calls.push({ url: String(url), init })
    if (String(url).includes('kimi')) return response(200, { usage: { limit: 100, remaining: 80 } })
    if (String(url).includes('bigmodel')) return response(200, { success: true, data: { limits: [{ type: 'TOKENS_LIMIT', percentage: 20 }] } })
    return response(200, { model_remains: [{ model_name: 'general', current_interval_remaining_percent: 90 }] })
  })
  await manager.queryProvider('kimi')
  assert.equal(calls[0].url, 'https://api.kimi.com/coding/v1/usages'); assert.equal(calls[0].init.headers.authorization, 'Bearer kimi-key')
  const status = manager.saveCredentials('team', { codingPlanProvider: 'zhipu_team', teamOrganizationId: 'org-x', teamProjectId: 'proj-x' })
  assert.equal(status.hasTeamOrganizationId, true); assert.equal(status.hasTeamProjectId, true); assert.equal(status.teamOrganizationId, undefined)
  assert.ok(!String(values.values().next().value).includes('org-x'))
  await manager.queryProvider('team')
  assert.match(calls[1].url, /\?type=2$/); assert.equal(calls[1].init.headers.authorization, 'team-key'); assert.equal(calls[1].init.headers['bigmodel-organization'], 'org-x')
  await manager.queryProvider('mini')
  assert.equal(calls[2].url, 'https://api.minimaxi.com/v1/api/openplatform/coding_plan/remains')
})

test('火山额度先探测 Agent Plan，AK/SK 只返回已配置状态', async () => {
  const calls = []
  const providers = [{ id: 'volc', name: 'Ark', baseUrl: 'https://ark.cn-beijing.volces.com/api/coding', apiKey: 'inference-key' }]
  const { manager, values } = harness(providers, async (url, init) => {
    calls.push({ url: String(url), init })
    return response(200, { Result: { PlanType: 'Pro', AFPFiveHour: { Quota: 1000, Used: 250, ResetTime: 1782057600 } } })
  })
  const missing = await manager.queryProvider('volc'); assert.equal(missing.credentialStatus, 'not_found')
  const status = manager.saveCredentials('volc', { accessKeyId: 'AKLT123', secretAccessKey: 'very-secret' })
  assert.deepEqual({ hasAccessKeyId: status.hasAccessKeyId, hasSecretAccessKey: status.hasSecretAccessKey, secureStorage: status.secureStorage }, { hasAccessKeyId: true, hasSecretAccessKey: true, secureStorage: true })
  assert.ok(!String(values.values().next().value).includes('very-secret'))
  manager.saveCredentials('volc', { accessKeyId: '', secretAccessKey: '' })
  const quota = await manager.queryProvider('volc')
  assert.equal(quota.success, true); assert.equal(quota.credentialMessage, 'Agent Plan Pro'); assert.equal(quota.tiers[0].utilization, 25)
  assert.match(calls[0].url, /Action=GetAFPUsage/); assert.match(calls[0].init.headers.authorization, /^HMAC-SHA256 Credential=AKLT123/)
})
