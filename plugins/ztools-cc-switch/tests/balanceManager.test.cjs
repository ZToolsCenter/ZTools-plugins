'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const { detectBalanceProvider, parseBalance, createBalanceManager } = require('../preload/balanceManager')

function response(status, body) { return { status, ok: status >= 200 && status < 300, text: async () => typeof body === 'string' ? body : JSON.stringify(body) } }

test('detects every upstream native balance provider', () => {
  assert.equal(detectBalanceProvider('https://api.deepseek.com/v1'), 'deepseek')
  assert.equal(detectBalanceProvider('https://api.stepfun.ai/v1'), 'stepfun')
  assert.equal(detectBalanceProvider('https://api.siliconflow.cn/v1'), 'siliconflow_cn')
  assert.equal(detectBalanceProvider('https://api.siliconflow.com/v1'), 'siliconflow_en')
  assert.equal(detectBalanceProvider('https://openrouter.ai/api/v1'), 'openrouter')
  assert.equal(detectBalanceProvider('https://api.novita.ai/v3'), 'novita')
})

test('parses DeepSeek, OpenRouter and Novita units exactly', () => {
  assert.deepEqual(parseBalance('deepseek', { is_available: true, balance_infos: [{ currency: 'CNY', total_balance: '12.5' }] }).data[0].remaining, 12.5)
  assert.deepEqual(parseBalance('openrouter', { data: { total_credits: 20, total_usage: 7.25 } }).data[0], { planName: 'OpenRouter', remaining: 12.75, total: 20, used: 7.25, unit: 'USD', isValid: true, invalidMessage: null })
  assert.equal(parseBalance('novita', { availableBalance: 123456 }).data[0].remaining, 12.3456)
})

test('queries canonical endpoints without exposing credentials in results', async () => {
  const calls = []
  const manager = createBalanceManager({ fetchImpl: async (url, init) => { calls.push([url, init.headers.authorization]); return response(200, { data: { total_credits: 10, total_usage: 2 } }) } })
  const result = await manager.queryProvider({ baseUrl: 'https://openrouter.ai/api/v1', apiKey: 'secret' })
  assert.equal(calls[0][0], 'https://openrouter.ai/api/v1/credits'); assert.equal(calls[0][1], 'Bearer secret')
  assert.equal(result.data[0].remaining, 8); assert.doesNotMatch(JSON.stringify(result), /secret/)
})

test('keeps auth and deterministic API failures structured while transport errors reject', async () => {
  let manager = createBalanceManager({ fetchImpl: async () => response(401, {}) })
  let result = await manager.queryProvider({ baseUrl: 'https://api.deepseek.com', apiKey: 'bad' })
  assert.equal(result.success, false); assert.equal(result.data[0].isValid, false)
  manager = createBalanceManager({ fetchImpl: async () => response(500, 'upstream down') })
  result = await manager.queryProvider({ baseUrl: 'https://api.stepfun.com', apiKey: 'key' }); assert.match(result.error, /HTTP 500/)
  manager = createBalanceManager({ fetchImpl: async () => { throw new Error('offline') } })
  await assert.rejects(() => manager.queryProvider({ baseUrl: 'https://api.novita.ai', apiKey: 'key' }), /Network error/)
})
