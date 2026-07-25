'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs/promises')
const os = require('node:os')
const path = require('node:path')
const http = require('node:http')
const { CircuitBreaker, normalizeCircuitBreaker, inferClient, joinUpstream, rectifyPayload, extractUsage, mapClaudeDesktopModel, claudeDesktopModelsResponse, createRouterManager } = require('../preload/routerManager')
const { createActivityStore } = require('../preload/activityStore')

test('router helpers infer clients, join paths and rectify thinking budgets', () => {
  assert.equal(inferClient('/v1/messages', {}), 'claude')
  assert.equal(inferClient('/v1beta/models/x:generateContent', {}), 'gemini')
  assert.equal(inferClient('/grokbuild/v1/responses', {}), 'grokbuild')
  assert.equal(inferClient('/opencode/v1/chat/completions', {}), 'opencode')
  assert.equal(inferClient('/openclaw/v1/chat/completions', {}), 'openclaw')
  assert.equal(inferClient('/hermes/v1/responses', {}), 'hermes')
  assert.equal(inferClient('/v1/responses', { 'x-ztools-client': 'openclaw' }), 'openclaw')
  assert.equal(inferClient('/claude-desktop/v1/messages', {}), 'claude-desktop')
  assert.equal(joinUpstream('https://api.example.com/v1', '/v1/responses?x=1').toString(), 'https://api.example.com/v1/responses?x=1')
  const result = rectifyPayload({ max_tokens: 3000, thinking: { budget_tokens: 9000 } }, { enabled: true })
  assert.equal(result.thinking.budget_tokens, 1976)
  assert.deepEqual(extractUsage(JSON.stringify({ model: 'response-model', usage: { input_tokens: 10, output_tokens: 4 } })), {
    inputTokens: 10, outputTokens: 4, cacheReadTokens: 0, cacheCreationTokens: 0, responseModel: 'response-model'
  })
})

test('router config always normalizes listening host to loopback', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'ztools-router-host-')); t.after(() => fs.rm(root, { recursive: true, force: true }))
  const router = createRouterManager({ dataDir: root, getActiveProvider: async () => null })
  const config = await router.saveConfig({ host: '0.0.0.0' })
  assert.equal(config.host, '127.0.0.1')
})

test('router rejects self-recursive upstream and forwarded router hops', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'ztools-router-recursion-')); t.after(() => fs.rm(root, { recursive: true, force: true }))
  const probe = http.createServer(); await new Promise(r => probe.listen(0, '127.0.0.1', r)); const port = probe.address().port; await new Promise(r => probe.close(r))
  const router = createRouterManager({ dataDir: root, getActiveProvider: async () => ({ id: 'loop', name: 'Loop', apiKey: 'key', baseUrl: `http://127.0.0.1:${port}`, model: 'gpt', apiType: 'responses' }) })
  await router.saveConfig({ port, routes: { codex: true } }); await router.start(); t.after(() => router.stop())
  const options = { method: 'POST', headers: { 'content-type': 'application/json', 'x-ztools-client': 'codex' }, body: '{}' }
  let response = await fetch(`http://127.0.0.1:${port}/v1/responses`, options)
  assert.equal(response.status, 508); assert.match((await response.json()).error.message, /不能指向当前本地路由/)
  response = await fetch(`http://127.0.0.1:${port}/v1/responses`, { ...options, headers: { ...options.headers, 'x-ztools-router-hop': '1' } })
  assert.equal(response.status, 508); assert.match((await response.json()).error.message, /递归/)
})

test('router caps buffered transformed responses before conversion', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'ztools-router-response-limit-')); t.after(() => fs.rm(root, { recursive: true, force: true }))
  const probe = http.createServer(); await new Promise(r => probe.listen(0, '127.0.0.1', r)); const port = probe.address().port; await new Promise(r => probe.close(r))
  const router = createRouterManager({
    dataDir: root,
    fetchImpl: async () => new Response('{"choices":[]}', { status: 200, headers: { 'content-type': 'application/json', 'content-length': String(32 * 1024 * 1024 + 1) } }),
    getActiveProvider: async () => ({ id: 'chat', name: 'Chat', apiKey: 'key', baseUrl: 'https://api.example.com/v1', model: 'gpt', apiType: 'openai_compat' })
  })
  await router.saveConfig({ port, routes: { codex: true } }); await router.start(); t.after(() => router.stop())
  const response = await fetch(`http://127.0.0.1:${port}/v1/responses`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-ztools-client': 'codex' }, body: '{}' })
  assert.equal(response.status, 502); assert.match((await response.json()).error.message, /超过 32 MB/)
})

test('Claude Desktop helpers expose safe catalog ids and map aliases, roles and 1M suffixes', () => {
  const provider = { claudeDesktopRoutes: [{ routeId: 'claude-opus-4-8', upstreamModel: 'kimi-k2.7', supports1m: true }, { routeId: 'claude-haiku-4-5', upstreamModel: 'kimi-k2.7-fast' }] }
  assert.equal(claudeDesktopModelsResponse(provider).data[0].supports1m, true)
  assert.equal(mapClaudeDesktopModel(provider, { model: 'claude-opus-4-7[1M]' }).model, 'kimi-k2.7')
  assert.equal(mapClaudeDesktopModel(provider, { model: 'claude-haiku-4-5-20251001' }).model, 'kimi-k2.7-fast')
  assert.throws(() => mapClaudeDesktopModel(provider, { model: 'unknown' }), /路由未配置/)
})

test('circuit breaker transitions closed → open → half_open → closed', () => {
  let now = 1000
  const breaker = new CircuitBreaker({ failureThreshold: 2, successThreshold: 2, timeoutSeconds: 5, errorRateThreshold: 1, minRequests: 100 }, () => now)
  breaker.recordFailure(); assert.equal(breaker.stats().state, 'closed')
  breaker.recordFailure(); assert.equal(breaker.stats().state, 'open'); assert.equal(breaker.allowRequest().allowed, false)
  now += 5000
  const firstProbe = breaker.allowRequest(); assert.deepEqual(firstProbe, { allowed: true, halfOpenPermit: true }); assert.equal(breaker.allowRequest().allowed, false)
  breaker.recordSuccess(firstProbe.halfOpenPermit); assert.equal(breaker.stats().state, 'half_open')
  const secondProbe = breaker.allowRequest(); breaker.recordSuccess(secondProbe.halfOpenPermit); assert.equal(breaker.stats().state, 'closed')
  assert.deepEqual(normalizeCircuitBreaker({ failureThreshold: -1, timeoutSeconds: 99999 }), { failureThreshold: 1, successThreshold: 2, timeoutSeconds: 3600, errorRateThreshold: 0.6, minRequests: 10 })
})

test('routes GrokBuild prefixed Responses path without leaking local prefix upstream', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'ztools-grok-router-')); t.after(() => fs.rm(root, { recursive: true, force: true }))
  const upstream = http.createServer(async (request, response) => {
    assert.equal(request.url, '/v1/responses'); assert.equal(request.headers.authorization, 'Bearer xai-key')
    response.writeHead(200, { 'content-type': 'application/json' }); response.end(JSON.stringify({ id: 'r1', object: 'response', status: 'completed', model: 'grok-4.5', output: [], usage: { input_tokens: 1, output_tokens: 1 } }))
  })
  await new Promise((resolve) => upstream.listen(0, '127.0.0.1', resolve)); t.after(() => new Promise((resolve) => upstream.close(resolve)))
  const probe = http.createServer(); await new Promise((resolve) => probe.listen(0, '127.0.0.1', resolve)); const port = probe.address().port; await new Promise((resolve) => probe.close(resolve))
  const router = createRouterManager({ dataDir: root, activityStore: createActivityStore({ dataDir: root }), getProviderCandidates: async (client) => { assert.equal(client, 'grokbuild'); return [{ id: 'xai', name: 'xAI', apiKey: 'xai-key', baseUrl: `http://127.0.0.1:${upstream.address().port}/v1`, model: 'grok-4.5', apiType: 'responses' }] } })
  await router.saveConfig({ port, routes: { grokbuild: true } }); await router.start(); t.after(() => router.stop())
  const response = await fetch(`http://127.0.0.1:${port}/grokbuild/v1/responses`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ model: 'grok-4.5', input: 'hello' }) })
  assert.equal(response.status, 200); assert.equal((await response.json()).object, 'response')
})

test('routes OpenCode、OpenClaw 与 Hermes through isolated path prefixes', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'ztools-agent-router-')); t.after(() => fs.rm(root, { recursive: true, force: true }))
  const upstream = http.createServer(async (request, response) => {
    assert.equal(request.url, '/v1/chat/completions')
    response.writeHead(200, { 'content-type': 'application/json' })
    response.end(JSON.stringify({ id: 'chat-1', object: 'chat.completion', model: 'model', choices: [{ message: { role: 'assistant', content: 'ok' }, finish_reason: 'stop' }], usage: { prompt_tokens: 1, completion_tokens: 1 } }))
  })
  await new Promise((resolve) => upstream.listen(0, '127.0.0.1', resolve)); t.after(() => new Promise((resolve) => upstream.close(resolve)))
  const probe = http.createServer(); await new Promise((resolve) => probe.listen(0, '127.0.0.1', resolve)); const port = probe.address().port; await new Promise((resolve) => probe.close(resolve))
  const seen = []
  const router = createRouterManager({ dataDir: root, activityStore: createActivityStore({ dataDir: root }), getProviderCandidates: async (client) => { seen.push(client); return [{ id: 'provider', name: 'Provider', apiKey: 'key', baseUrl: `http://127.0.0.1:${upstream.address().port}/v1`, model: 'model', apiType: 'openai_compat' }] } })
  await router.saveConfig({ port, routes: { opencode: true, openclaw: true, hermes: true } }); await router.start(); t.after(() => router.stop())
  for (const client of ['opencode', 'openclaw', 'hermes']) {
    const response = await fetch(`http://127.0.0.1:${port}/${client}/v1/chat/completions`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ model: 'model', messages: [{ role: 'user', content: 'hello' }] }) })
    assert.equal(response.status, 200)
  }
  assert.deepEqual(seen, ['opencode', 'openclaw', 'hermes'])
})

test('local router forwards requests and records usage logs', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'ztools-router-test-'))
  t.after(() => fs.rm(root, { recursive: true, force: true }))
  const upstream = http.createServer(async (request, response) => {
    const chunks = []
    for await (const chunk of request) chunks.push(chunk)
    const body = JSON.parse(Buffer.concat(chunks).toString('utf8'))
    assert.equal(request.headers.authorization, 'Bearer sk-test')
    assert.equal(body.model, 'test-model')
    response.writeHead(200, { 'content-type': 'application/json' })
    response.end(JSON.stringify({ id: 'chat-1', model: 'response-alias', choices: [{ message: { role: 'assistant', content: 'ok' }, finish_reason: 'stop' }], usage: { prompt_tokens: 7, completion_tokens: 3 } }))
  })
  await new Promise((resolve) => upstream.listen(0, '127.0.0.1', resolve))
  t.after(() => new Promise((resolve) => upstream.close(resolve)))
  const upstreamPort = upstream.address().port
  const probe = http.createServer()
  await new Promise((resolve) => probe.listen(0, '127.0.0.1', resolve))
  const routerPort = probe.address().port
  await new Promise((resolve) => probe.close(resolve))
  const activityStore = createActivityStore({ dataDir: root })
  await activityStore.saveBillingDefaults({ codex: { multiplier: '1.5', source: 'request' } })
  const router = createRouterManager({
    dataDir: root,
    activityStore,
    getActiveProvider: async () => ({
      id: 'test', name: 'Test', apiKey: 'sk-test',
      baseUrl: `http://127.0.0.1:${upstreamPort}/v1`, model: 'test-model', apiType: 'openai_compat', costMultiplier: '', pricingModelSource: ''
    })
  })
  await router.saveConfig({ port: routerPort, routes: { codex: true } })
  await router.start()
  t.after(() => router.stop())
  const response = await fetch(`http://127.0.0.1:${routerPort}/v1/responses`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-ztools-client': 'codex' },
    body: JSON.stringify({ model: 'test-model', input: 'hello' })
  })
  assert.equal(response.status, 200)
  const responseBody = await response.json()
  assert.equal(responseBody.object, 'response')
  assert.equal(responseBody.output[0].content[0].text, 'ok')
  const summary = await activityStore.summary()
  assert.equal(summary.requests, 1)
  assert.equal(summary.inputTokens, 7)
  assert.equal(summary.outputTokens, 3)
  const detail = (await activityStore.query())[0]
  assert.equal(detail.model, 'response-alias')
  assert.equal(detail.requestModel, 'test-model')
  assert.equal(detail.pricingModel, 'test-model')
  assert.equal(detail.costMultiplier, '1.5')
})

test('native xAI Responses route flattens Codex namespace tools and restores calls', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'ztools-codex-namespace-router-')); t.after(() => fs.rm(root, { recursive: true, force: true }))
  const upstream = http.createServer(async (request, response) => {
    const chunks = []; for await (const chunk of request) chunks.push(chunk); const body = JSON.parse(Buffer.concat(chunks).toString())
    assert.equal(body.tools[0].type, 'function'); assert.equal(body.tools[0].name, 'mcp__files____read')
    assert.equal(body.input[0].name, 'mcp__files____read'); assert.equal(body.input[0].namespace, undefined)
    response.writeHead(200, { 'content-type': 'application/json' }); response.end(JSON.stringify({ id: 'r1', object: 'response', status: 'completed', output: [{ type: 'function_call', name: 'mcp__files____read', call_id: 'c1', arguments: '{}' }], usage: {} }))
  })
  await new Promise(r => upstream.listen(0, '127.0.0.1', r)); t.after(() => new Promise(r => upstream.close(r)))
  const probe = http.createServer(); await new Promise(r => probe.listen(0, '127.0.0.1', r)); const port = probe.address().port; await new Promise(r => probe.close(r))
  const router = createRouterManager({ dataDir: root, activityStore: createActivityStore({ dataDir: root }), getProviderCandidates: async () => [{ id: 'xai', name: 'xAI', apiKey: 'key', authProvider: 'xai_oauth', baseUrl: `http://127.0.0.1:${upstream.address().port}`, apiType: 'responses', model: 'grok-4.5' }], resolveProviderAuth: async () => ({ token: 'managed-xai' }) })
  await router.saveConfig({ port, routes: { codex: true } }); await router.start(); t.after(() => router.stop())
  const response = await fetch(`http://127.0.0.1:${port}/v1/responses`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-ztools-client': 'codex' }, body: JSON.stringify({ tools: [{ type: 'namespace', name: 'mcp__files__', tools: [{ type: 'function', name: 'read', parameters: {} }] }], input: [{ type: 'function_call', name: 'read', namespace: 'mcp__files__', call_id: 'c1', arguments: '{}' }] }) })
  const body = await response.json(); assert.equal(response.status, 200); assert.equal(body.output[0].name, 'read'); assert.equal(body.output[0].namespace, 'mcp__files__')
})

test('Responses to Chat injects stable prompt cache routing without using response cursors', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'ztools-codex-cache-router-')); t.after(() => fs.rm(root, { recursive: true, force: true }))
  const seen = []
  const upstream = http.createServer(async (request, response) => { const chunks=[]; for await (const chunk of request) chunks.push(chunk); seen.push(JSON.parse(Buffer.concat(chunks).toString())); response.writeHead(200, {'content-type':'application/json'}); response.end(JSON.stringify({id:'c1',model:'gpt',choices:[{message:{role:'assistant',content:'ok'},finish_reason:'stop'}],usage:{}})) })
  await new Promise(r => upstream.listen(0,'127.0.0.1',r)); t.after(()=>new Promise(r=>upstream.close(r)))
  const probe=http.createServer(); await new Promise(r=>probe.listen(0,'127.0.0.1',r)); const port=probe.address().port; await new Promise(r=>probe.close(r))
  const router=createRouterManager({dataDir:root,activityStore:createActivityStore({dataDir:root}),getProviderCandidates:async()=>[{id:'chat',name:'Chat',apiKey:'key',baseUrl:`http://127.0.0.1:${upstream.address().port}`,apiType:'openai_compat',model:'gpt',promptCacheRouting:'enabled'}]})
  await router.saveConfig({port,routes:{codex:true}}); await router.start(); t.after(()=>router.stop())
  let response=await fetch(`http://127.0.0.1:${port}/v1/responses`,{method:'POST',headers:{'content-type':'application/json','x-session-id':'12345678-1234-1234-1234-123456789012'},body:JSON.stringify({input:'hello',previous_response_id:'resp_random'})}); await response.text(); assert.equal(seen[0].prompt_cache_key,'12345678-1234-1234-1234-123456789012')
  response=await fetch(`http://127.0.0.1:${port}/v1/responses`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({input:'again',previous_response_id:'resp_random_2'})}); await response.text(); assert.equal(seen[1].prompt_cache_key,undefined)
})

test('local router fails over on retryable upstream status', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'ztools-failover-test-')); t.after(() => fs.rm(root, { recursive: true, force: true }))
  let primaryRequests = 0
  const primary = http.createServer((_req, res) => { primaryRequests += 1; res.writeHead(503); res.end('unavailable') })
  const backup = http.createServer((_req, res) => { res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify({ provider: 'backup' })) })
  await Promise.all([new Promise(r => primary.listen(0, '127.0.0.1', r)), new Promise(r => backup.listen(0, '127.0.0.1', r))])
  t.after(() => Promise.all([new Promise(r => primary.close(r)), new Promise(r => backup.close(r))]))
  const probe = http.createServer(); await new Promise(r => probe.listen(0, '127.0.0.1', r)); const port = probe.address().port; await new Promise(r => probe.close(r))
  const make = (id, upstreamPort) => ({ id, name: id, apiKey: 'key', baseUrl: `http://127.0.0.1:${upstreamPort}`, apiType: 'responses' })
  const router = createRouterManager({ dataDir: root, activityStore: createActivityStore({ dataDir: root }), getProviderCandidates: async () => [make('primary', primary.address().port), make('backup', backup.address().port)] })
  await router.saveConfig({ port, routes: { codex: true }, failover: { enabled: { codex: true }, circuitBreaker: { failureThreshold: 1, successThreshold: 1, timeoutSeconds: 60, errorRateThreshold: 1, minRequests: 100 } } }); await router.start(); t.after(() => router.stop())
  const response = await fetch(`http://127.0.0.1:${port}/v1/responses`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-ztools-client': 'codex' }, body: '{}' })
  assert.equal(response.headers.get('x-ztools-provider'), 'backup'); assert.equal((await response.json()).provider, 'backup')
  assert.equal((await router.getCircuitBreakerStats('codex', 'primary')).state, 'open')
  const second = await fetch(`http://127.0.0.1:${port}/v1/responses`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-ztools-client': 'codex' }, body: '{}' })
  assert.equal(second.headers.get('x-ztools-provider'), 'backup'); await second.text(); assert.equal(primaryRequests, 1)
  router.resetCircuitBreaker('codex', 'primary')
  const third = await fetch(`http://127.0.0.1:${port}/v1/responses`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-ztools-client': 'codex' }, body: '{}' })
  assert.equal(third.headers.get('x-ztools-provider'), 'backup'); await third.text(); assert.equal(primaryRequests, 2)
})

test('routes Claude through an OpenAI-compatible provider with protocol and auth conversion', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'ztools-claude-chat-test-')); t.after(() => fs.rm(root, { recursive: true, force: true }))
  const upstream = http.createServer(async (request, response) => {
    assert.equal(request.url, '/v1/chat/completions')
    assert.equal(request.headers.authorization, 'Bearer openai-key')
    assert.equal(request.headers['x-api-key'], undefined)
    const chunks = []; for await (const chunk of request) chunks.push(chunk); const body = JSON.parse(Buffer.concat(chunks).toString('utf8'))
    assert.equal(body.messages[0].role, 'system'); assert.equal(body.messages[1].content, 'hello'); assert.equal(body.model, 'gpt-5.2')
    response.writeHead(200, { 'content-type': 'application/json' }); response.end(JSON.stringify({ id: 'chat-claude', model: 'gpt-5.2', choices: [{ message: { role: 'assistant', content: 'world' }, finish_reason: 'stop' }], usage: { prompt_tokens: 4, completion_tokens: 1 } }))
  })
  await new Promise(r => upstream.listen(0, '127.0.0.1', r)); t.after(() => new Promise(r => upstream.close(r)))
  const probe = http.createServer(); await new Promise(r => probe.listen(0, '127.0.0.1', r)); const port = probe.address().port; await new Promise(r => probe.close(r))
  const router = createRouterManager({ dataDir: root, activityStore: createActivityStore({ dataDir: root }), getProviderCandidates: async () => [{ id: 'openai', name: 'OpenAI', apiKey: 'openai-key', baseUrl: `http://127.0.0.1:${upstream.address().port}`, apiType: 'openai_compat', model: 'gpt-5', modelMap: { 'claude-sonnet': 'gpt-5.2' } }] })
  await router.saveConfig({ port, routes: { claude: true } }); await router.start(); t.after(() => router.stop())
  const response = await fetch(`http://127.0.0.1:${port}/v1/messages`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-ztools-client': 'claude' }, body: JSON.stringify({ model: 'claude-sonnet', system: 'Be useful', max_tokens: 2000, messages: [{ role: 'user', content: 'hello' }] }) })
  const body = await response.json(); assert.equal(response.status, 200); assert.equal(body.type, 'message'); assert.equal(body.content[0].text, 'world'); assert.deepEqual(body.usage, { input_tokens: 4, output_tokens: 1 })
})

test('Claude Desktop gateway authenticates, serves its catalog and maps route ids upstream', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'ztools-desktop-router-')); t.after(() => fs.rm(root, { recursive: true, force: true }))
  const upstream = http.createServer(async (request, response) => {
    assert.equal(request.url, '/v1/chat/completions')
    assert.equal(request.headers.authorization, 'Bearer provider-key')
    const chunks = []; for await (const chunk of request) chunks.push(chunk)
    const body = JSON.parse(Buffer.concat(chunks).toString('utf8'))
    assert.equal(body.model, 'kimi-k2.7')
    response.writeHead(200, { 'content-type': 'application/json' })
    response.end(JSON.stringify({ id: 'desktop-1', model: body.model, choices: [{ message: { role: 'assistant', content: 'desktop ok' }, finish_reason: 'stop' }], usage: { prompt_tokens: 2, completion_tokens: 1 } }))
  })
  await new Promise((resolve) => upstream.listen(0, '127.0.0.1', resolve)); t.after(() => new Promise((resolve) => upstream.close(resolve)))
  const probe = http.createServer(); await new Promise((resolve) => probe.listen(0, '127.0.0.1', resolve)); const port = probe.address().port; await new Promise((resolve) => probe.close(resolve))
  const provider = { id: 'desktop-kimi', name: 'Kimi', apiKey: 'provider-key', baseUrl: `http://127.0.0.1:${upstream.address().port}`, apiType: 'openai_compat', model: 'kimi-k2.7', claudeDesktopRoutes: [{ routeId: 'claude-sonnet-5', upstreamModel: 'kimi-k2.7', supports1m: true }] }
  const router = createRouterManager({
    dataDir: root,
    activityStore: createActivityStore({ dataDir: root }),
    getProviderCandidates: async (client) => { assert.equal(client, 'claude-desktop'); return [provider] },
    getClaudeDesktopContext: async () => ({ provider, gatewayToken: 'ccs-local-secret' })
  })
  await router.saveConfig({ port, routes: { 'claude-desktop': true } }); await router.start(); t.after(() => router.stop())
  const denied = await fetch(`http://127.0.0.1:${port}/claude-desktop/v1/models`)
  assert.equal(denied.status, 401)
  const catalog = await fetch(`http://127.0.0.1:${port}/claude-desktop/v1/models`, { headers: { authorization: 'Bearer ccs-local-secret' } })
  assert.equal(catalog.status, 200); assert.deepEqual((await catalog.json()).data[0], { type: 'model', id: 'claude-sonnet-5', created_at: '2024-01-01T00:00:00Z', supports1m: true })
  const response = await fetch(`http://127.0.0.1:${port}/claude-desktop/v1/messages`, { method: 'POST', headers: { authorization: 'Bearer ccs-local-secret', 'content-type': 'application/json' }, body: JSON.stringify({ model: 'claude-sonnet-5[1M]', max_tokens: 100, messages: [{ role: 'user', content: 'hello' }] }) })
  assert.equal(response.status, 200); const body = await response.json(); assert.equal(body.content[0].text, 'desktop ok')
})

test('routes Codex through managed OAuth without exposing a stored API key', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'ztools-codex-oauth-router-')); t.after(() => fs.rm(root, { recursive: true, force: true }))
  const upstream = http.createServer(async (request, response) => {
    assert.equal(request.url, '/backend-api/codex/responses')
    assert.equal(request.headers.authorization, 'Bearer oauth-access')
    assert.equal(request.headers['chatgpt-account-id'], 'account-42')
    assert.equal(request.headers.originator, 'codex_cli_rs')
    const chunks = []; for await (const chunk of request) chunks.push(chunk); const body = JSON.parse(Buffer.concat(chunks).toString('utf8'))
    assert.equal(body.store, false); assert.equal(body.stream, true); assert.equal(body.service_tier, 'priority')
    assert.equal(body.max_output_tokens, undefined); assert.ok(body.include.includes('reasoning.encrypted_content'))
    response.writeHead(200, { 'content-type': 'text/event-stream' })
    response.end('data: {"type":"response.completed","response":{"id":"r1","status":"completed","model":"gpt-5","output":[],"usage":{"input_tokens":1,"output_tokens":1}}}\n\ndata: [DONE]\n\n')
  })
  await new Promise(r => upstream.listen(0, '127.0.0.1', r)); t.after(() => new Promise(r => upstream.close(r)))
  const probe = http.createServer(); await new Promise(r => probe.listen(0, '127.0.0.1', r)); const port = probe.address().port; await new Promise(r => probe.close(r))
  let resolves = 0
  const router = createRouterManager({
    dataDir: root, activityStore: createActivityStore({ dataDir: root }),
    getProviderCandidates: async () => [{ id: 'official', name: 'ChatGPT', apiKey: '', authProvider: 'codex_oauth', authAccountId: 'account-42', fastMode: true, baseUrl: `http://127.0.0.1:${upstream.address().port}/backend-api/codex`, apiType: 'responses', model: 'gpt-5' }],
    resolveProviderAuth: async () => { resolves += 1; return { token: 'oauth-access', accountId: 'account-42' } }
  })
  await router.saveConfig({ port, routes: { codex: true } }); await router.start(); t.after(() => router.stop())
  const response = await fetch(`http://127.0.0.1:${port}/v1/responses`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-ztools-client': 'codex' }, body: JSON.stringify({ model: 'gpt-5', input: 'hello', stream: true, max_output_tokens: 999 }) })
  assert.equal(response.status, 200); assert.equal(resolves, 1); assert.match(await response.text(), /response.completed/)
})

test('streams converted Claude SSE before the OpenAI upstream finishes', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'ztools-live-sse-test-')); t.after(() => fs.rm(root, { recursive: true, force: true }))
  let releaseUpstream
  const gate = new Promise((resolve) => { releaseUpstream = resolve })
  const upstream = http.createServer(async (_request, response) => {
    response.writeHead(200, { 'content-type': 'text/event-stream' })
    response.write('data: {"id":"live","model":"gpt","choices":[{"delta":{"content":"first"},"finish_reason":null}]}\n\n')
    await gate
    response.write('data: {"id":"live","model":"gpt","choices":[{"delta":{"content":"last"},"finish_reason":"stop"}],"usage":{"prompt_tokens":1,"completion_tokens":2}}\n\n')
    response.end('data: [DONE]\n\n')
  })
  await new Promise(r => upstream.listen(0, '127.0.0.1', r)); t.after(() => new Promise(r => upstream.close(r)))
  const probe = http.createServer(); await new Promise(r => probe.listen(0, '127.0.0.1', r)); const port = probe.address().port; await new Promise(r => probe.close(r))
  const router = createRouterManager({ dataDir: root, activityStore: createActivityStore({ dataDir: root }), getProviderCandidates: async () => [{ id: 'chat', name: 'Chat', apiKey: 'key', baseUrl: `http://127.0.0.1:${upstream.address().port}`, apiType: 'openai_compat', model: 'gpt' }] })
  await router.saveConfig({ port, routes: { claude: true } }); await router.start(); t.after(() => router.stop())
  const response = await fetch(`http://127.0.0.1:${port}/v1/messages`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-ztools-client': 'claude' }, body: JSON.stringify({ model: 'claude', max_tokens: 100, stream: true, messages: [{ role: 'user', content: 'hello' }] }) })
  const reader = response.body.getReader()
  const arrivedBeforeFinish = await Promise.race([reader.read().then(() => true), new Promise((resolve) => setTimeout(() => resolve(false), 250))])
  assert.equal(arrivedBeforeFinish, true)
  releaseUpstream()
  let rest = ''; while (true) { const result = await reader.read(); if (result.done) break; rest += Buffer.from(result.value).toString('utf8') }
  assert.match(rest, /first|last/); assert.match(rest, /message_stop/)
})

test('Router 在发送前按 Provider 应用 Bedrock 与 Copilot Optimizer', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'ztools-optimizer-router-')); t.after(() => fs.rm(root, { recursive: true, force: true }))
  let mode = 'bedrock'
  const seen = []
  const upstream = http.createServer(async (request, response) => {
    const chunks=[]; for await (const chunk of request) chunks.push(chunk); const body=JSON.parse(Buffer.concat(chunks).toString())
    seen.push({mode,headers:{...request.headers},body})
    response.writeHead(200,{'content-type':'application/json'}); response.end(mode === 'bedrock' ? JSON.stringify({type:'message',role:'assistant',content:[{type:'text',text:'ok'}],model:'claude-opus-4.8',stop_reason:'end_turn',usage:{input_tokens:1,output_tokens:1}}) : JSON.stringify({id:'c',model:body.model,choices:[{message:{role:'assistant',content:'ok'},finish_reason:'stop'}],usage:{prompt_tokens:1,completion_tokens:1}}))
  })
  await new Promise(r=>upstream.listen(0,'127.0.0.1',r)); t.after(()=>new Promise(r=>upstream.close(r)))
  const probe=http.createServer(); await new Promise(r=>probe.listen(0,'127.0.0.1',r)); const port=probe.address().port; await new Promise(r=>probe.close(r))
  let provider={id:'bedrock',name:'Bedrock',apiKey:'key',baseUrl:`http://127.0.0.1:${upstream.address().port}`,apiType:'anthropic',model:'claude-opus-4.8',isBedrock:true}
  const router=createRouterManager({dataDir:root,activityStore:createActivityStore({dataDir:root}),getProviderCandidates:async()=>[provider],resolveProviderAuth:async()=>({token:'copilot-token'})})
  await router.saveConfig({port,routes:{claude:true},optimizer:{enabled:true},copilotOptimizer:{enabled:true}}); await router.start(); t.after(()=>router.stop())
  let response=await fetch(`http://127.0.0.1:${port}/v1/messages`,{method:'POST',headers:{'content-type':'application/json','anthropic-beta':'warmup','x-session-id':'session-1'},body:JSON.stringify({model:'claude-opus-4.8',max_tokens:1000,system:'sys',tools:[{name:'read'}],messages:[{role:'user',content:[{type:'text',text:'hello'}]}]})}); assert.equal(response.status,200); await response.text(); assert.equal(seen[0].body.thinking.type,'adaptive'); assert.equal(seen[0].body.output_config.effort,'max'); assert.ok(seen[0].body.anthropic_beta.includes('context-1m-2025-08-07')); assert.ok(JSON.stringify(seen[0].body).includes('cache_control'))
  mode='copilot'; provider={id:'copilot',name:'Copilot',apiKey:'',authProvider:'github_copilot',baseUrl:`http://127.0.0.1:${upstream.address().port}`,apiType:'openai_compat',model:'claude-sonnet'}
  response=await fetch(`http://127.0.0.1:${port}/v1/messages`,{method:'POST',headers:{'content-type':'application/json','anthropic-beta':'warmup','x-session-id':'session-2'},body:JSON.stringify({model:'claude-sonnet',max_tokens:1000,messages:[{role:'user',content:'hello'}],tools:[]})}); assert.equal(response.status,200); await response.text(); assert.equal(seen[1].headers['x-initiator'],'user'); assert.match(seen[1].headers['x-request-id'],/^[0-9a-f-]{36}$/); assert.match(seen[1].headers['x-interaction-id'],/^[0-9a-f-]{36}$/); assert.equal(seen[1].body.model,'gpt-5-mini')
})
