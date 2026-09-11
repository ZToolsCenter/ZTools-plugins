'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const fsp = require('node:fs/promises')
const os = require('node:os')
const path = require('node:path')
const { createUniversalProviderManager } = require('../preload/universalProviderManager')

async function fixture() {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'ztools-universal-'))
  const values = new Map()
  const calls = []
  const manager = createUniversalProviderManager({
    dataDir: root,
    storage: { getItem: (key) => values.get(key), setItem: (key, value) => values.set(key, value), removeItem: (key) => values.delete(key) },
    secretCodec: { encode: (value) => Buffer.from(value).toString('base64'), decode: (value) => Buffer.from(value, 'base64').toString() },
    configManager: {
      saveProvider: async (provider) => { calls.push(['save', provider]); return provider },
      deleteProvider: async (id) => { calls.push(['delete', id]); return true }
    }
  })
  return { root, values, calls, manager }
}

const universal = {
  id: 'gateway', name: 'NewAPI', providerType: 'newapi', baseUrl: 'https://gateway.example.com', apiKey: 'secret-value',
  apps: { claude: true, codex: true, gemini: false },
  models: {
    claude: { model: 'claude-main', haikuModel: 'claude-fast', sonnetModel: 'claude-main', opusModel: 'claude-big' },
    codex: { model: 'gpt-main', reasoningEffort: 'high' }, gemini: { model: 'gemini-main' }
  }
}

test('统一 Provider 密钥只进安全存储且列表脱敏', async (t) => {
  const ctx = await fixture(); t.after(() => fsp.rm(ctx.root, { recursive: true, force: true }))
  const saved = await ctx.manager.upsert(universal)
  assert.equal(saved.apiKey, '')
  assert.equal(saved.hasApiKey, true)
  assert.doesNotMatch(await fsp.readFile(path.join(ctx.root, 'universal-providers.json'), 'utf8'), /secret-value/)
  assert.equal((await ctx.manager.list())[0].hasApiKey, true)
})

test('同步生成稳定三端子 Provider 并移除未启用端', async (t) => {
  const ctx = await fixture(); t.after(() => fsp.rm(ctx.root, { recursive: true, force: true }))
  await ctx.manager.upsert(universal)
  const result = await ctx.manager.sync('gateway')
  assert.deepEqual(result.results.map((item) => item.action), ['synced', 'synced', 'removed'])
  const claude = ctx.calls.find(([action, item]) => action === 'save' && item.id === 'universal-claude-gateway')[1]
  const codex = ctx.calls.find(([action, item]) => action === 'save' && item.id === 'universal-codex-gateway')[1]
  assert.equal(claude.apiKey, 'secret-value')
  assert.equal(claude.claudeHaikuModel, 'claude-fast')
  assert.equal(codex.baseUrl, 'https://gateway.example.com/v1')
  assert.equal(codex.codexReasoningEffort, 'high')
  assert.ok(ctx.calls.some(([action, id]) => action === 'delete' && id === 'universal-gemini-gateway'))
})

test('删除母配置同步删除三个子 Provider 与安全密钥', async (t) => {
  const ctx = await fixture(); t.after(() => fsp.rm(ctx.root, { recursive: true, force: true }))
  await ctx.manager.upsert(universal)
  assert.equal(await ctx.manager.remove('gateway'), true)
  assert.equal((await ctx.manager.list()).length, 0)
  assert.equal(ctx.values.size, 0)
  assert.deepEqual(ctx.calls.filter(([action]) => action === 'delete').map(([, id]) => id), [
    'universal-claude-gateway', 'universal-codex-gateway', 'universal-gemini-gateway'
  ])
})
