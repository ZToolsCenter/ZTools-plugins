'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const { createUsageScriptManager, validateUrl, validateUsageResult } = require('../preload/usageScriptManager')

function fixture(fetchImpl) {
  const values = new Map(); let provider = { id: 'provider-1', name: 'Provider', apiKey: 'provider-key', baseUrl: 'https://api.example.com', clients: ['claude'] }
  const configManager = {
    getProvider: async (id) => id === provider.id ? structuredClone(provider) : null,
    saveProvider: async (value) => { provider = structuredClone(value); return structuredClone(provider) },
    listProviders: async () => ({ providers: [structuredClone(provider)] })
  }
  const storage = { getItem: (key) => values.get(key), setItem: (key, value) => values.set(key, value), removeItem: (key) => values.delete(key) }
  const secretCodec = { secure: true, encode: (value) => `enc:${value}`, decode: (value) => value.slice(4) }
  return { manager: createUsageScriptManager({ configManager, storage, secretCodec, fetchImpl }), values, getProvider: () => provider }
}

test('用量脚本凭据进入安全存储且网页配置只返回配置状态', async () => {
  let request
  const ctx = fixture(async (url, init) => { request = { url: String(url), ...init }; return new Response(JSON.stringify({ balance: 12.5, is_active: true }), { status: 200, headers: { 'content-type': 'application/json' } }) })
  const templates = ctx.manager.getTemplates()
  const saved = await ctx.manager.saveConfig('provider-1', { enabled: true, templateType: 'general', code: templates.general, apiKey: 'usage-secret', timeout: 5, autoQueryInterval: 30 })
  assert.equal(saved.hasApiKey, true); assert.equal(saved.apiKey, undefined); assert.match([...ctx.values.values()][0], /^enc:/)
  assert.equal(ctx.getProvider().usageScript.code, templates.general)
  const result = await ctx.manager.query('provider-1')
  assert.equal(result.data[0].remaining, 12.5)
  assert.equal(request.url, 'https://api.example.com/user/balance')
  assert.equal(request.headers.Authorization, 'Bearer usage-secret')
})

test('New API 模板替换 Token 与 User ID 并允许测试时临时覆盖', async () => {
  const ctx = fixture(async (_url, init) => {
    assert.equal(init.headers.Authorization, 'Bearer temp-token'); assert.equal(init.headers['New-Api-User'], '42')
    return new Response(JSON.stringify({ success: true, data: { group: 'pro', quota: 1_000_000, used_quota: 500_000 } }), { status: 200 })
  })
  const result = await ctx.manager.test('provider-1', { templateType: 'new_api', code: ctx.manager.getTemplates().new_api, accessToken: 'temp-token', userId: '42', timeout: 2 })
  assert.deepEqual(result.data[0], { planName: 'pro', remaining: 2, used: 1, total: 3, unit: 'USD' })
})

test('非自定义脚本强制 HTTPS 同源并限制提取器执行时间与结果类型', async () => {
  assert.throws(() => validateUrl('https://other.example.com/quota', 'https://api.example.com', false), /同源/)
  assert.throws(() => validateUrl('http://api.example.com/quota', 'http://api.example.com', false), /HTTPS/)
  assert.doesNotThrow(() => validateUrl('http://127.0.0.1:3000/quota', 'http://127.0.0.1:3000', false))
  assert.throws(() => validateUsageResult({ remaining: '12' }), /remaining/)
  const ctx = fixture(async () => new Response('{}', { status: 200 }))
  await assert.rejects(() => ctx.manager.test('provider-1', { templateType: 'custom', code: `({request:{url:'https://api.example.com/quota',method:'GET'},extractor:function(){while(true){}}})` }), /timed out|Script execution/)
})

test('确定性 HTTP 与响应格式错误保持结构化异常', async () => {
  const ctx = fixture(async () => new Response('denied', { status: 401 }))
  await assert.rejects(() => ctx.manager.test('provider-1', { templateType: 'custom', code: `({request:{url:'https://api.example.com/quota',method:'GET'},extractor:function(v){return v}})` }), /HTTP 401: denied/)
  const invalid = fixture(async () => new Response('not-json', { status: 200 }))
  await assert.rejects(() => invalid.manager.test('provider-1', { templateType: 'custom', code: `({request:{url:'https://api.example.com/quota',method:'GET'},extractor:function(v){return v}})` }), /有效 JSON/)
})
