'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs/promises')
const os = require('node:os')
const path = require('node:path')
const { createConfigManager, getClientPaths } = require('../preload/configManager')
const { createClaudeDesktopManager, OFFICIAL_PROVIDER_ID } = require('../preload/claudeDesktopManager')

async function fixture() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'ztools-cc-switch-test-'))
  const homeDir = path.join(root, 'home')
  const dataDir = path.join(root, 'data')
  const rulesPath = path.join(root, 'rules.json')
  await fs.mkdir(homeDir, { recursive: true })
  await fs.writeFile(rulesPath, JSON.stringify({ providers: [] }))
  return {
    root,
    homeDir,
    dataDir,
    rulesPath,
    manager: createConfigManager({ homeDir, dataDir, bundledRulesPath: rulesPath })
  }
}

const provider = {
  id: 'test-provider',
  name: 'Test Provider',
  apiKey: 'sk-test-secret',
  baseUrl: 'https://api.example.com',
  model: 'test-model',
  clients: ['claude', 'codex', 'gemini'],
  color: '#5EEAD4'
}

test('switches Claude while preserving unknown settings and creates backup', async (t) => {
  const ctx = await fixture()
  t.after(() => fs.rm(ctx.root, { recursive: true, force: true }))
  const paths = getClientPaths(ctx.homeDir)
  await fs.mkdir(path.dirname(paths.claude.settings), { recursive: true })
  await fs.writeFile(paths.claude.settings, JSON.stringify({ permissions: { allow: ['Bash'] }, env: { KEEP: 'yes' } }))
  await ctx.manager.saveProvider(provider)
  await ctx.manager.switchProvider('claude', provider.id)

  const settings = JSON.parse(await fs.readFile(paths.claude.settings, 'utf8'))
  const backup = JSON.parse(await fs.readFile(`${paths.claude.settings}.bak`, 'utf8'))
  assert.deepEqual(settings.permissions, { allow: ['Bash'] })
  assert.equal(settings.env.KEEP, 'yes')
  assert.equal(settings.env.ANTHROPIC_BASE_URL, provider.baseUrl)
  assert.equal(settings.env.ANTHROPIC_AUTH_TOKEN, provider.apiKey)
  assert.equal(settings.env.ANTHROPIC_API_KEY, undefined)
  assert.equal(backup.env.KEEP, 'yes')
  assert.equal(backup.env.ANTHROPIC_BASE_URL, undefined)
})

test('switches Codex with managed TOML block and preserves login material', async (t) => {
  const ctx = await fixture()
  t.after(() => fs.rm(ctx.root, { recursive: true, force: true }))
  const paths = getClientPaths(ctx.homeDir)
  await fs.mkdir(path.dirname(paths.codex.config), { recursive: true })
  await fs.writeFile(paths.codex.config, 'model = "old"\napproval_policy = "on-request"\n')
  await fs.writeFile(paths.codex.auth, JSON.stringify({ tokens: { access_token: 'keep-me' } }))
  await ctx.manager.saveProvider(provider)
  await ctx.manager.switchProvider('codex', provider.id)

  const config = await fs.readFile(paths.codex.config, 'utf8')
  const auth = JSON.parse(await fs.readFile(paths.codex.auth, 'utf8'))
  assert.match(config, /approval_policy = "on-request"/)
  assert.match(config, /model_provider = "ztools_cc_switch"/)
  assert.match(config, /base_url = "https:\/\/api\.example\.com"/)
  assert.match(config, /wire_api = "responses"/)
  assert.doesNotMatch(config, /model = "old"/)
  assert.equal(auth.tokens.access_token, 'keep-me')
  assert.equal(auth.OPENAI_API_KEY, provider.apiKey)
})

test('switches Gemini and preserves unrelated env values', async (t) => {
  const ctx = await fixture()
  t.after(() => fs.rm(ctx.root, { recursive: true, force: true }))
  const paths = getClientPaths(ctx.homeDir)
  await fs.mkdir(path.dirname(paths.gemini.env), { recursive: true })
  await fs.writeFile(paths.gemini.env, '# user comment\nKEEP=value\n\nGEMINI_API_KEY=old-key\n')
  await ctx.manager.saveProvider(provider)
  await ctx.manager.switchProvider('gemini', provider.id)

  const env = await fs.readFile(paths.gemini.env, 'utf8')
  const settings = JSON.parse(await fs.readFile(paths.gemini.settings, 'utf8'))
  assert.match(env, /KEEP=value/)
  assert.match(env, /# user comment/)
  assert.match(env, /GEMINI_API_KEY=sk-test-secret/)
  assert.match(env, /GOOGLE_GEMINI_BASE_URL=https:\/\/api\.example\.com/)
  assert.equal((env.match(/GEMINI_API_KEY=/g) || []).length, 1)
  assert.equal(settings.security.auth.selectedType, 'gemini-api-key')
})

test('switches OpenCode, OpenClaw and Hermes while preserving unrelated settings', async (t) => {
  const ctx = await fixture()
  t.after(() => fs.rm(ctx.root, { recursive: true, force: true }))
  const paths = getClientPaths(ctx.homeDir)
  const extended = { ...provider, clients: ['opencode', 'openclaw', 'hermes'] }

  await fs.mkdir(path.dirname(paths.opencode.config), { recursive: true })
  await fs.writeFile(paths.opencode.config, JSON.stringify({ theme: 'system', provider: { keep: { name: 'Keep' } } }))
  await fs.mkdir(path.dirname(paths.openclaw.config), { recursive: true })
  await fs.writeFile(paths.openclaw.config, JSON.stringify({ tools: { profile: 'coding' } }))
  await fs.mkdir(path.dirname(paths.hermes.config), { recursive: true })
  await fs.writeFile(paths.hermes.config, 'agent:\n  max_turns: 42\n')

  await ctx.manager.saveProvider(extended)
  await ctx.manager.switchProvider('opencode', extended.id)
  await ctx.manager.switchProvider('openclaw', extended.id)
  await ctx.manager.switchProvider('hermes', extended.id)

  const opencode = JSON.parse(await fs.readFile(paths.opencode.config, 'utf8'))
  const openclaw = JSON.parse(await fs.readFile(paths.openclaw.config, 'utf8'))
  const hermes = await fs.readFile(paths.hermes.config, 'utf8')
  assert.equal(opencode.theme, 'system')
  assert.equal(opencode.provider.keep.name, 'Keep')
  assert.equal(opencode.provider[extended.id].options.apiKey, extended.apiKey)
  assert.equal(opencode.model, `${extended.id}/${extended.model}`)
  assert.equal(openclaw.tools.profile, 'coding')
  assert.equal(openclaw.models.providers[extended.id].apiKey, extended.apiKey)
  assert.equal(openclaw.agents.defaults.model.primary, `${extended.id}/${extended.model}`)
  assert.match(hermes, /max_turns: 42/)
  assert.match(hermes, /name: test-provider/)
  assert.match(hermes, /api_key: sk-test-secret/)
  assert.ok(await fs.stat(`${paths.opencode.config}.bak`))
  assert.ok(await fs.stat(`${paths.openclaw.config}.bak`))
  assert.ok(await fs.stat(`${paths.hermes.config}.bak`))
})

test('lists, redacts and removes additive live Provider fragments while preserving managed records', async (t) => {
  const ctx = await fixture(); t.after(() => fs.rm(ctx.root, { recursive: true, force: true }))
  const paths = getClientPaths(ctx.homeDir); const extended = { ...provider, clients: ['opencode', 'openclaw', 'hermes'] }
  await ctx.manager.saveProvider(extended)
  for (const client of extended.clients) await ctx.manager.switchProvider(client, extended.id)

  assert.deepEqual(await ctx.manager.listLiveProviderIds('opencode'), [extended.id])
  assert.deepEqual(await ctx.manager.listLiveProviderIds('openclaw'), [extended.id])
  assert.deepEqual(await ctx.manager.listLiveProviderIds('hermes'), [extended.id])
  const fragment = await ctx.manager.getLiveProviderFragment('opencode', extended.id)
  assert.equal(fragment.options.apiKey, '••••••••')
  assert.doesNotMatch(JSON.stringify(fragment), /sk-test-secret/)
  for (const client of extended.clients) assert.equal((await ctx.manager.removeProviderFromLiveConfig(client, extended.id)).removed, true)
  assert.ok(await ctx.manager.getProvider(extended.id))
  await assert.rejects(() => ctx.manager.removeProviderFromLiveConfig('claude', extended.id), /不支持/)
})

test('switches and routes GrokBuild while preserving MCP TOML and restoring exact config', async (t) => {
  const ctx = await fixture(); t.after(() => fs.rm(ctx.root, { recursive: true, force: true }))
  const paths = getClientPaths(ctx.homeDir); const grokProvider = { ...provider, clients: ['grokbuild'], wireApi: 'responses', grokContextWindow: 600000 }
  await fs.mkdir(path.dirname(paths.grokbuild.config), { recursive: true })
  const original = '[mcp_servers.keep]\ncommand = "keep"\n\n[models]\ndefault = "old"\n\n[model.old]\nmodel = "old"\nbase_url = "https://old.example"\nname = "Old"\napi_key = "old-key"\napi_backend = "responses"\ncontext_window = 1000\n'
  await fs.writeFile(paths.grokbuild.config, original)
  await ctx.manager.saveProvider(grokProvider); await ctx.manager.switchProvider('grokbuild', grokProvider.id)
  const direct = await fs.readFile(paths.grokbuild.config, 'utf8')
  assert.match(direct, /\[mcp_servers\.keep]/); assert.match(direct, /default = "ztools_cc_switch"/); assert.match(direct, /base_url = "https:\/\/api\.example\.com"/); assert.match(direct, /context_window = 600000/)
  await ctx.manager.setClientRouting('grokbuild', true, 'http://127.0.0.1:15721')
  assert.match(await fs.readFile(paths.grokbuild.config, 'utf8'), /base_url = "http:\/\/127\.0\.0\.1:15721\/grokbuild\/v1"/)
  await ctx.manager.setClientRouting('grokbuild', false, 'http://127.0.0.1:15721')
  assert.equal(await fs.readFile(paths.grokbuild.config, 'utf8'), direct)
})

test('local routing takeover preserves active Provider and restores exact client files', async (t) => {
  const ctx = await fixture()
  t.after(() => fs.rm(ctx.root, { recursive: true, force: true }))
  const paths = getClientPaths(ctx.homeDir)
  await fs.mkdir(path.dirname(paths.claude.settings), { recursive: true })
  const original = `${JSON.stringify({ permissions: { allow: ['Read'] }, env: { KEEP: 'yes' } }, null, 2)}\n`
  await fs.writeFile(paths.claude.settings, original)
  await ctx.manager.saveProvider(provider)
  await ctx.manager.switchProvider('claude', provider.id)
  const direct = await fs.readFile(paths.claude.settings, 'utf8')

  await ctx.manager.setClientRouting('claude', true, 'http://127.0.0.1:15721')
  let routed = JSON.parse(await fs.readFile(paths.claude.settings, 'utf8'))
  assert.equal(routed.env.ANTHROPIC_BASE_URL, 'http://127.0.0.1:15721')
  const second = await ctx.manager.saveProvider({ ...provider, id: 'second', name: 'Second' })
  const switched = await ctx.manager.switchProvider('claude', second.id)
  assert.equal(switched.routed, true)
  routed = JSON.parse(await fs.readFile(paths.claude.settings, 'utf8'))
  assert.equal(routed.env.ANTHROPIC_BASE_URL, 'http://127.0.0.1:15721')

  await ctx.manager.setClientRouting('claude', false, 'http://127.0.0.1:15721')
  assert.equal(await fs.readFile(paths.claude.settings, 'utf8'), direct)
})

test('OpenCode、OpenClaw 与 Hermes 使用独立路由入口并精确恢复', async (t) => {
  const ctx = await fixture()
  t.after(() => fs.rm(ctx.root, { recursive: true, force: true }))
  const paths = getClientPaths(ctx.homeDir)
  const routedProvider = { ...provider, clients: ['opencode', 'openclaw', 'hermes'] }
  await ctx.manager.saveProvider(routedProvider)

  const expectations = {
    opencode: ['config', 'http://127.0.0.1:15721/opencode/v1'],
    openclaw: ['config', 'http://127.0.0.1:15721/openclaw/v1'],
    hermes: ['config', 'http://127.0.0.1:15721/hermes/v1']
  }
  for (const [client, [fileKey, expectedUrl]] of Object.entries(expectations)) {
    await ctx.manager.switchProvider(client, routedProvider.id)
    const direct = await fs.readFile(paths[client][fileKey], 'utf8')
    await ctx.manager.setClientRouting(client, true, 'http://127.0.0.1:15721')
    assert.match(await fs.readFile(paths[client][fileKey], 'utf8'), new RegExp(expectedUrl.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')))
    await ctx.manager.setClientRouting(client, false, 'http://127.0.0.1:15721')
    assert.equal(await fs.readFile(paths[client][fileKey], 'utf8'), direct)
  }
})

test('rolls back Codex config when auth.json cannot be updated', async (t) => {
  const ctx = await fixture()
  t.after(() => fs.rm(ctx.root, { recursive: true, force: true }))
  const paths = getClientPaths(ctx.homeDir)
  await fs.mkdir(path.dirname(paths.codex.config), { recursive: true })
  const original = 'model = "original"\napproval_policy = "on-request"\n'
  await fs.writeFile(paths.codex.config, original)
  await fs.writeFile(paths.codex.auth, '{broken json')
  await ctx.manager.saveProvider(provider)

  await assert.rejects(() => ctx.manager.switchProvider('codex', provider.id), /读取 JSON 失败/)
  assert.equal(await fs.readFile(paths.codex.config, 'utf8'), original)
})

test('rolls back Gemini env when settings.json cannot be updated', async (t) => {
  const ctx = await fixture()
  t.after(() => fs.rm(ctx.root, { recursive: true, force: true }))
  const paths = getClientPaths(ctx.homeDir)
  await fs.mkdir(path.dirname(paths.gemini.env), { recursive: true })
  const original = '# keep this\nKEEP=value\n'
  await fs.writeFile(paths.gemini.env, original)
  await fs.writeFile(paths.gemini.settings, '{broken json')
  await ctx.manager.saveProvider(provider)

  await assert.rejects(() => ctx.manager.switchProvider('gemini', provider.id), /读取 JSON 失败/)
  assert.equal(await fs.readFile(paths.gemini.env, 'utf8'), original)
})

test('rejects newline injection in env-backed provider fields', async (t) => {
  const ctx = await fixture()
  t.after(() => fs.rm(ctx.root, { recursive: true, force: true }))
  await assert.rejects(
    () => ctx.manager.saveProvider({ ...provider, apiKey: 'safe\nINJECTED=value' }),
    /不能包含换行/
  )
})

test('refreshes preset fields from rules while preserving the API key', async (t) => {
  const ctx = await fixture()
  t.after(() => fs.rm(ctx.root, { recursive: true, force: true }))
  const initial = { ...provider, id: 'preset-one', source: undefined, apiKey: '', baseUrl: 'https://old.example.com' }
  await fs.writeFile(ctx.rulesPath, JSON.stringify({ providers: [initial] }))
  let data = await ctx.manager.listProviders()
  await ctx.manager.saveProvider({ ...data.providers.find((item) => item.id === initial.id), apiKey: 'keep-this-key' })

  await fs.writeFile(ctx.rulesPath, JSON.stringify({ providers: [{
    ...initial,
    baseUrl: 'https://new.example.com',
    model: 'new-model'
  }] }))
  data = await ctx.manager.listProviders()
  const refreshed = data.providers.find((item) => item.id === initial.id)
  assert.equal(refreshed.baseUrl, 'https://new.example.com')
  assert.equal(refreshed.model, 'new-model')
  assert.equal(refreshed.apiKey, 'keep-this-key')
})

test('detects active providers from live client files and clears stale state', async (t) => {
  const ctx = await fixture()
  t.after(() => fs.rm(ctx.root, { recursive: true, force: true }))
  const paths = getClientPaths(ctx.homeDir)
  await ctx.manager.saveProvider(provider)
  await ctx.manager.switchProvider('claude', provider.id)
  await ctx.manager.switchProvider('codex', provider.id)
  await ctx.manager.switchProvider('gemini', provider.id)

  let data = await ctx.manager.listProviders()
  assert.deepEqual(data.active, {
    claude: provider.id,
    codex: provider.id,
    gemini: provider.id
  })

  const claude = JSON.parse(await fs.readFile(paths.claude.settings, 'utf8'))
  claude.env.ANTHROPIC_BASE_URL = 'https://externally-changed.example.com'
  await fs.writeFile(paths.claude.settings, JSON.stringify(claude))
  data = await ctx.manager.listProviders()
  assert.equal(data.active.claude, undefined)
  assert.equal(data.active.codex, provider.id)
  assert.equal(data.active.gemini, provider.id)
})

test('supports custom Provider create, update and delete', async (t) => {
  const ctx = await fixture()
  t.after(() => fs.rm(ctx.root, { recursive: true, force: true }))
  const created = await ctx.manager.saveProvider({ ...provider, id: '', costMultiplier: '1.5', pricingModelSource: 'request', limitDailyUsd: '5', limitMonthlyUsd: '50' })
  assert.ok(created.id)
  assert.equal(created.costMultiplier, '1.5')
  assert.equal(created.pricingModelSource, 'request')
  assert.equal(created.limitDailyUsd, '5')
  let data = await ctx.manager.listProviders()
  assert.equal(data.providers.find((item) => item.id === created.id).name, provider.name)

  await ctx.manager.saveProvider({ ...created, name: 'Updated Provider' })
  data = await ctx.manager.listProviders()
  assert.equal(data.providers.find((item) => item.id === created.id).name, 'Updated Provider')

  assert.equal(await ctx.manager.deleteProvider(created.id), true)
  data = await ctx.manager.listProviders()
  assert.equal(data.providers.some((item) => item.id === created.id), false)
  await assert.rejects(() => ctx.manager.saveProvider({ ...provider, id: '', costMultiplier: '-1' }), /成本倍率/)
})

test('supports concurrent first-load calls without temporary-file collisions', async (t) => {
  const ctx = await fixture()
  t.after(() => fs.rm(ctx.root, { recursive: true, force: true }))
  const results = await Promise.all([
    ctx.manager.listProviders(),
    ctx.manager.getClientStatus(),
    ctx.manager.listProviders(),
    ctx.manager.getClientStatus()
  ])
  assert.equal(results[0].clients.length, 8)
  assert.equal(Object.keys(results[1]).length, 7)
})

test('客户端配置目录只从固定路径解析并拒绝未知客户端', async (t) => {
  const ctx = await fixture()
  t.after(() => fs.rm(ctx.root, { recursive: true, force: true }))
  const claude = await ctx.manager.getClientConfigDirectoryInfo('claude')
  const codex = await ctx.manager.getClientConfigDirectoryInfo('codex')
  assert.equal(claude.path, path.join(ctx.homeDir, '.claude'))
  assert.equal(codex.path, path.join(ctx.homeDir, '.codex'))
  assert.equal(claude.exists, false)
  await fs.mkdir(claude.path, { recursive: true })
  assert.equal((await ctx.manager.getClientConfigDirectoryInfo('claude')).exists, true)
  await assert.rejects(() => ctx.manager.getClientConfigDirectoryInfo('../unknown'), /不支持的客户端/)
})

test('delegates client writes to the Rust sidecar when available', async (t) => {
  const ctx = await fixture()
  t.after(() => fs.rm(ctx.root, { recursive: true, force: true }))
  const calls = []
  const manager = createConfigManager({
    homeDir: ctx.homeDir,
    dataDir: ctx.dataDir,
    bundledRulesPath: ctx.rulesPath,
    sidecar: {
      isAvailable: () => true,
      applyClient: async (client, homeDir, value) => {
        calls.push({ client, homeDir, value })
        return { files: [], backups: [] }
      }
    }
  })
  await manager.saveProvider(provider)
  await manager.switchProvider('codex', provider.id)
  assert.equal(calls.length, 1)
  assert.equal(calls[0].client, 'codex')
  assert.equal(calls[0].homeDir, ctx.homeDir)
  assert.equal(calls[0].value.id, provider.id)
  await assert.rejects(() => fs.stat(getClientPaths(ctx.homeDir).codex.config), /ENOENT/)
})

test('imports existing live client configurations with stable ids and upstream-compatible fields', async (t) => {
  const ctx = await fixture()
  t.after(() => fs.rm(ctx.root, { recursive: true, force: true }))
  const paths = getClientPaths(ctx.homeDir)

  await fs.mkdir(path.dirname(paths.claude.settings), { recursive: true })
  await fs.writeFile(paths.claude.settings, JSON.stringify({
    env: {
      ANTHROPIC_API_KEY: 'claude-key',
      ANTHROPIC_BASE_URL: 'https://claude.example.com',
      ANTHROPIC_MODEL: 'claude-test'
    }
  }))

  await fs.mkdir(path.dirname(paths.codex.config), { recursive: true })
  await fs.writeFile(paths.codex.config, [
    'model = "codex-test"',
    'model_provider = "custom"',
    '',
    '[model_providers.custom]',
    'base_url = "https://codex.example.com/v1"',
    'wire_api = "chat_completions"',
    ''
  ].join('\n'))
  await fs.writeFile(paths.codex.auth, JSON.stringify({ OPENAI_API_KEY: 'codex-key' }))

  await fs.mkdir(path.dirname(paths.gemini.env), { recursive: true })
  await fs.writeFile(paths.gemini.env, [
    'GOOGLE_API_KEY=gemini-key',
    'GOOGLE_GEMINI_BASE_URL=https://gemini.example.com',
    'GEMINI_MODEL=gemini-test',
    ''
  ].join('\n'))
  await fs.mkdir(path.dirname(paths.grokbuild.config), { recursive: true })
  await fs.writeFile(paths.grokbuild.config, '[models]\ndefault = "relay"\n\n[model.relay]\nmodel = "grok-test"\nbase_url = "https://grok.example.com/v1"\nname = "Grok Relay"\napi_key = "grok-key"\napi_backend = "responses"\ncontext_window = 500000\n')

  const first = await ctx.manager.importLiveProviders()
  assert.equal(first.imported.length, 4)
  let data = await ctx.manager.listProviders()
  const claude = data.providers.find((item) => item.id === 'imported-claude-current')
  const codex = data.providers.find((item) => item.id === 'imported-codex-current')
  const gemini = data.providers.find((item) => item.id === 'imported-gemini-current')
  const grok = data.providers.find((item) => item.id === 'imported-grokbuild-current')
  assert.equal(claude.claudeAuthField, 'ANTHROPIC_API_KEY')
  assert.equal(codex.wireApi, 'chat_completions')
  assert.equal(gemini.apiKey, 'gemini-key')
  assert.equal(grok.model, 'grok-test')
  assert.deepEqual(data.active, {
    claude: claude.id,
    codex: codex.id,
    gemini: gemini.id,
    grokbuild: grok.id
  })

  await ctx.manager.importLiveProviders()
  data = await ctx.manager.listProviders()
  assert.equal(data.providers.filter((item) => item.source === 'imported').length, 4)
})

test('tests Provider connectivity with client-specific endpoints and latency', async (t) => {
  const ctx = await fixture()
  t.after(() => fs.rm(ctx.root, { recursive: true, force: true }))
  await ctx.manager.saveProvider(provider)
  const originalFetch = global.fetch
  const calls = []
  global.fetch = async (url, options) => {
    calls.push({ url: String(url), headers: options.headers })
    return new Response(JSON.stringify({ data: [] }), { status: 200 })
  }
  t.after(() => { global.fetch = originalFetch })

  const claude = await ctx.manager.testProvider(provider.id, 'claude')
  const codex = await ctx.manager.testProvider(provider.id, 'codex')
  const gemini = await ctx.manager.testProvider(provider.id, 'gemini')
  assert.equal(claude.ok, true)
  assert.equal(codex.ok, true)
  assert.equal(gemini.ok, true)
  assert.ok(Number.isFinite(codex.latency))
  assert.equal(calls[0].url, 'https://api.example.com/v1/models')
  assert.equal(calls[0].headers['x-api-key'], provider.apiKey)
  assert.equal(calls[1].headers.Authorization, `Bearer ${provider.apiKey}`)
  assert.equal(calls[2].url, `https://api.example.com/v1beta/models?key=${provider.apiKey}`)
})

test('returns a structured connectivity failure instead of throwing', async (t) => {
  const ctx = await fixture()
  t.after(() => fs.rm(ctx.root, { recursive: true, force: true }))
  await ctx.manager.saveProvider(provider)
  const originalFetch = global.fetch
  global.fetch = async () => { throw new Error('offline') }
  t.after(() => { global.fetch = originalFetch })

  const result = await ctx.manager.testProvider(provider.id, 'codex')
  assert.equal(result.ok, false)
  assert.equal(result.reachable, false)
  assert.match(result.message, /offline/)
})

test('Provider 排序按客户端完整校验并持久化', async (t) => {
  const ctx = await fixture(); t.after(() => fs.rm(ctx.root, { recursive: true, force: true }))
  await ctx.manager.saveProvider({ ...provider, id: 'one', clients: ['claude', 'codex'] })
  await ctx.manager.saveProvider({ ...provider, id: 'two', clients: ['claude'] })
  assert.deepEqual(await ctx.manager.updateProviderSortOrder('claude', ['two', 'one']), ['two', 'one'])
  assert.deepEqual((await ctx.manager.listProviders()).sortOrders.claude, ['two', 'one'])
  await assert.rejects(() => ctx.manager.updateProviderSortOrder('claude', ['one']), /完整/)
  await assert.rejects(() => ctx.manager.updateProviderSortOrder('codex', ['one', 'two']), /跨客户端/)
})

test('显式故障转移队列按 Provider 排序生效、保留认证边界并随删除清理', async (t) => {
  const ctx = await fixture(); t.after(() => fs.rm(ctx.root, { recursive: true, force: true }))
  const p1 = { ...provider, id: 'p1', clients: ['claude'] }
  const p2 = { ...provider, id: 'p2', name: 'P2', clients: ['claude'] }
  const p3 = { ...provider, id: 'p3', name: 'P3', apiKey: '', clients: ['claude'] }
  for (const item of [p1, p2, p3]) await ctx.manager.saveProvider(item)
  await ctx.manager.activateProvider('claude', p2.id)
  await ctx.manager.updateProviderSortOrder('claude', ['p2', 'p1', 'p3'])

  await ctx.manager.addToFailoverQueue('claude', p1.id)
  await ctx.manager.addToFailoverQueue('claude', p2.id)
  const queue = await ctx.manager.getFailoverQueue('claude')
  assert.deepEqual(queue.map((item) => item.providerId), ['p2', 'p1'])
  assert.equal(Object.hasOwn(queue[0], 'apiKey'), false)
  assert.deepEqual((await ctx.manager.getProviderCandidates('claude')).map((item) => item.id), ['p2', 'p1'])
  assert.deepEqual((await ctx.manager.getAvailableProvidersForFailover('claude')).map((item) => item.providerId), [])
  await assert.rejects(() => ctx.manager.addToFailoverQueue('claude', p3.id), /未配置认证/)
  await ctx.manager.removeFromFailoverQueue('claude', p2.id)
  assert.deepEqual((await ctx.manager.getFailoverQueue('claude')).map((item) => item.providerId), ['p1'])
  await ctx.manager.deleteProvider(p1.id)
  assert.deepEqual(await ctx.manager.getFailoverQueue('claude'), [])
})

test('Claude 与 Gemini 通用配置片段过滤敏感字段并在切换时合并', async (t) => {
  const ctx = await fixture(); t.after(() => fs.rm(ctx.root, { recursive: true, force: true }))
  const paths = getClientPaths(ctx.homeDir)
  await fs.mkdir(path.dirname(paths.claude.settings), { recursive: true })
  await fs.writeFile(paths.claude.settings, JSON.stringify({ permissions: { allow: ['Read'] }, env: { ANTHROPIC_API_KEY: 'never-share', KEEP: 'yes', ANTHROPIC_MODEL: 'old' } }))
  const extracted = JSON.parse(await ctx.manager.extractCommonConfigSnippet('claude'))
  assert.deepEqual(extracted.permissions, { allow: ['Read'] }); assert.equal(extracted.env.KEEP, 'yes'); assert.equal(extracted.env.ANTHROPIC_API_KEY, undefined); assert.equal(extracted.env.ANTHROPIC_MODEL, undefined)
  await ctx.manager.setCommonConfigSnippet('claude', JSON.stringify({ permissions: { deny: ['WebFetch'] }, env: { SHARED_FLAG: '1' } }))
  await ctx.manager.saveProvider({ ...provider, id: 'common-claude', clients: ['claude'], commonConfigEnabled: true })
  await ctx.manager.switchProvider('claude', 'common-claude')
  const claude = JSON.parse(await fs.readFile(paths.claude.settings, 'utf8'))
  assert.deepEqual(claude.permissions.deny, ['WebFetch']); assert.equal(claude.env.SHARED_FLAG, '1'); assert.equal(claude.env.ANTHROPIC_AUTH_TOKEN, provider.apiKey)

  await ctx.manager.setCommonConfigSnippet('gemini', JSON.stringify({ HTTP_PROXY: 'http://127.0.0.1:7890' }))
  await ctx.manager.saveProvider({ ...provider, id: 'common-gemini', clients: ['gemini'], commonConfigEnabled: true })
  await ctx.manager.switchProvider('gemini', 'common-gemini')
  const env = await fs.readFile(paths.gemini.env, 'utf8')
  assert.match(env, /# >>> ztools-common-config >>>/); assert.match(env, /HTTP_PROXY=http:\/\/127\.0\.0\.1:7890/)
  await assert.rejects(() => ctx.manager.setCommonConfigSnippet('gemini', JSON.stringify({ GOOGLE_API_KEY: 'secret' })), /凭据/)
})

test('Config Manager switches Claude Desktop through its transactional manager and preserves active state', async (t) => {
  const ctx = await fixture(); t.after(() => fs.rm(ctx.root, { recursive: true, force: true }))
  const desktop = createClaudeDesktopManager({ platform: 'darwin', homeDir: ctx.homeDir, dataDir: ctx.dataDir })
  const manager = createConfigManager({ homeDir: ctx.homeDir, dataDir: ctx.dataDir, bundledRulesPath: ctx.rulesPath, claudeDesktopManager: desktop, getRouterStatus: async () => ({ running: true, url: 'http://127.0.0.1:15721' }) })
  const saved = await manager.saveProvider({ ...provider, id: 'desktop-kimi', clients: ['claude-desktop'], apiType: 'openai_compat', claudeDesktopMode: 'proxy', claudeDesktopApiFormat: 'openai_chat', claudeDesktopRoutes: [{ routeId: 'kimi-k2', upstreamModel: 'kimi-k2' }] })
  await manager.switchProvider('claude-desktop', saved.id)
  let data = await manager.listProviders()
  assert.equal(data.active['claude-desktop'], saved.id)
  assert.equal((await desktop.getStatus({ running: true })).configured, true)
  await manager.switchProvider('claude-desktop', OFFICIAL_PROVIDER_ID)
  data = await manager.listProviders()
  assert.equal(data.active['claude-desktop'], OFFICIAL_PROVIDER_ID)
  assert.equal((await desktop.getStatus({ running: true })).configured, false)
  await manager.saveProvider({ ...provider, id: 'claude-import-source', clients: ['claude'], apiType: 'anthropic', model: 'claude-sonnet-5[1M]' })
  const imported = await manager.importClaudeDesktopProvidersFromClaude()
  assert.ok(imported.imported.includes('claude-import-source'))
  const adapted = (await manager.listProviders()).providers.find((item) => item.id === 'claude-import-source')
  assert.equal(adapted.claudeDesktopMode, 'direct')
  assert.deepEqual(adapted.claudeDesktopRoutes[0], { routeId: 'claude-sonnet-5', upstreamModel: 'claude-sonnet-5', labelOverride: '', supports1m: true })
})

test('manages per-client custom endpoints and applies a selected endpoint to the active Provider', async (t) => {
  const ctx = await fixture(); t.after(() => fs.rm(ctx.root, { recursive: true, force: true }))
  await ctx.manager.saveProvider({ ...provider, clients: ['claude'] })
  await ctx.manager.switchProvider('claude', provider.id)
  await ctx.manager.addCustomEndpoint('claude', provider.id, 'https://edge.example.com///')
  await ctx.manager.addCustomEndpoint('claude', provider.id, 'https://edge.example.com')
  let rows = await ctx.manager.getCustomEndpoints('claude', provider.id)
  assert.equal(rows.length, 1); assert.equal(rows[0].url, 'https://edge.example.com')
  const selected = await ctx.manager.selectCustomEndpoint('claude', provider.id, rows[0].url)
  assert.equal(selected.applied, true)
  assert.equal((await ctx.manager.getProvider(provider.id)).baseUrl, rows[0].url)
  assert.ok((await ctx.manager.getCustomEndpoints('claude', provider.id))[0].lastUsed)
  await ctx.manager.removeCustomEndpoint('claude', provider.id, rows[0].url)
  rows = await ctx.manager.getCustomEndpoints('claude', provider.id); assert.deepEqual(rows, [])
})
