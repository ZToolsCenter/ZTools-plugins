'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const { buildModelsUrlCandidates, parseModels, createModelFetchManager } = require('../preload/modelFetchManager')

test('模型端点候选对照上游处理版本段、完整 URL 与兼容子路径', () => {
  assert.deepEqual(buildModelsUrlCandidates('https://api.example.com/v1'), ['https://api.example.com/v1/models'])
  assert.deepEqual(buildModelsUrlCandidates('https://open.bigmodel.cn/api/coding/paas/v4'), ['https://open.bigmodel.cn/api/coding/paas/v4/models', 'https://open.bigmodel.cn/api/coding/paas/v4/v1/models'])
  assert.deepEqual(buildModelsUrlCandidates('https://api.deepseek.com/anthropic'), ['https://api.deepseek.com/anthropic/v1/models', 'https://api.deepseek.com/v1/models', 'https://api.deepseek.com/models'])
  assert.deepEqual(buildModelsUrlCandidates('https://proxy.example.com/v1/chat/completions', true), ['https://proxy.example.com/v1/models'])
  assert.deepEqual(buildModelsUrlCandidates('https://api.example.com/messages', true), ['https://api.example.com/v1/models'])
  assert.deepEqual(buildModelsUrlCandidates('https://unused.example', false, 'https://models.example/list'), ['https://models.example/list'])
})

test('404/405 继续候选、Bearer 与 User-Agent 生效并排序模型', async () => {
  const calls = []
  const manager = createModelFetchManager({ fetchImpl: async (url, init) => {
    calls.push([String(url), init.headers])
    if (calls.length < 3) return new Response('missing', { status: calls.length === 1 ? 404 : 405 })
    return Response.json({ data: [{ id: 'z-model', owned_by: 'vendor-z' }, { id: 'a-model' }] })
  } })
  const models = await manager.fetchModels({ baseUrl: 'https://api.deepseek.com/anthropic', apiKey: 'sk-secret', customUserAgent: 'Claude-Code/test' })
  assert.deepEqual(models, [{ id: 'a-model', ownedBy: null }, { id: 'z-model', ownedBy: 'vendor-z' }])
  assert.equal(calls[0][1].authorization, 'Bearer sk-secret'); assert.equal(calls[0][1]['user-agent'], 'Claude-Code/test')
  assert.deepEqual(calls.map(([url]) => url), ['https://api.deepseek.com/anthropic/v1/models', 'https://api.deepseek.com/v1/models', 'https://api.deepseek.com/models'])
})

test('非候选错误与无效响应返回结构化错误且截断正文', async () => {
  const authFailure = createModelFetchManager({ fetchImpl: async () => new Response('x'.repeat(800), { status: 401 }) })
  await assert.rejects(() => authFailure.fetchModels({ baseUrl: 'https://api.example.com', apiKey: 'x' }), /HTTP 401:.{500}/)
  const invalid = createModelFetchManager({ fetchImpl: async () => new Response('not json', { status: 200 }) })
  await assert.rejects(() => invalid.fetchModels({ baseUrl: 'https://api.example.com', apiKey: 'x' }), /Failed to parse/)
  await assert.rejects(() => invalid.fetchModels({ baseUrl: 'https://api.example.com', apiKey: '' }), /API Key/)
})

test('Codex/xAI 托管账号使用专用端点且兼容多种模型响应', async () => {
  const calls = []
  const manager = createModelFetchManager({ clientVersion: '9.9.9', resolveAuth: async (provider) => ({ token: `${provider}-token`, accountId: 'acct-1', baseUrl: 'https://copilot.example' }), fetchImpl: async (url, init) => {
    calls.push([String(url), init.headers])
    if (String(url).includes('chatgpt.com')) return Response.json({ models: [{ slug: 'gpt-5.5' }, 'gpt-5.4'] })
    return Response.json({ data: [{ id: 'grok-4' }] })
  } })
  assert.deepEqual((await manager.fetchManaged('codex_oauth', '')).map((item) => item.id), ['gpt-5.4', 'gpt-5.5'])
  assert.deepEqual((await manager.fetchManaged('xai_oauth', 'acct-1')).map((item) => item.id), ['grok-4'])
  assert.match(calls[0][0], /client_version=9.9.9/); assert.equal(calls[0][1]['chatgpt-account-id'], 'acct-1'); assert.equal(calls[1][0], 'https://api.x.ai/v1/models')
})

test('模型解析兼容数组、models map 并按 ID 去重', () => {
  assert.deepEqual(parseModels({ models: { 'gpt-5': {}, 'gpt-6': { slug: 'gpt-6', vendor: 'OpenAI' } }, data: [{ id: 'gpt-5' }] }, 'Codex'), [{ id: 'gpt-5', ownedBy: 'Codex' }, { id: 'gpt-6', ownedBy: 'OpenAI' }])
})
