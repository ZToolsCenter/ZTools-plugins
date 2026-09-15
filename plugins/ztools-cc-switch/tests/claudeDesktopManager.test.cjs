'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs/promises')
const os = require('node:os')
const path = require('node:path')
const { OFFICIAL_PROVIDER_ID, PROFILE_ID, getClaudeDesktopPaths, normalizeRoutes, createClaudeDesktopManager } = require('../preload/claudeDesktopManager')

async function fixture(platform = 'darwin') {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'ztools-claude-desktop-'))
  const homeDir = path.join(root, 'home')
  const dataDir = path.join(root, 'data')
  const localAppData = path.join(root, 'local')
  const manager = createClaudeDesktopManager({ platform, homeDir, localAppData, dataDir, randomUUID: () => '11111111-2222-4333-8444-555555555555' })
  return { root, homeDir, dataDir, localAppData, manager, paths: manager.getPaths() }
}

const direct = {
  id: 'direct', name: 'Anthropic', baseUrl: 'https://api.anthropic.com', apiKey: 'sk-test', apiType: 'anthropic',
  claudeDesktopMode: 'direct', claudeDesktopApiFormat: 'anthropic', claudeDesktopRoutes: [{ routeId: 'claude-sonnet-5', upstreamModel: 'claude-sonnet-5', supports1m: true }]
}

test('resolves macOS and Windows Claude Desktop paths', async (t) => {
  const mac = await fixture(); t.after(() => fs.rm(mac.root, { recursive: true, force: true }))
  assert.match(mac.paths.profilePath, /Library\/Application Support\/Claude-3p\/configLibrary/)
  const win = await fixture('win32'); t.after(() => fs.rm(win.root, { recursive: true, force: true }))
  await fs.mkdir(path.join(win.localAppData, 'Claude-canary'), { recursive: true })
  const paths = getClaudeDesktopPaths({ platform: 'win32', homeDir: win.homeDir, localAppData: win.localAppData })
  assert.equal(paths.normalConfigPath, path.join(win.localAppData, 'Claude-canary', 'claude_desktop_config.json'))
})

test('repairs branded proxy routes and rejects unsafe direct mappings', () => {
  assert.deepEqual(normalizeRoutes([{ routeId: 'kimi-k2', upstreamModel: 'kimi-k2' }]), [{ routeId: 'claude-sonnet-5', upstreamModel: 'kimi-k2', labelOverride: 'kimi-k2', supports1m: false }])
  assert.throws(() => normalizeRoutes([{ routeId: 'claude-sonnet-5', upstreamModel: 'kimi-k2' }], 'direct'), /不能映射模型/)
})

test('applies direct provider to all four files and restores official mode', async (t) => {
  const ctx = await fixture(); t.after(() => fs.rm(ctx.root, { recursive: true, force: true }))
  await fs.mkdir(path.dirname(ctx.paths.normalConfigPath), { recursive: true })
  await fs.writeFile(ctx.paths.normalConfigPath, JSON.stringify({ keep: true }))
  await ctx.manager.applyProvider(direct)
  const normal = JSON.parse(await fs.readFile(ctx.paths.normalConfigPath, 'utf8'))
  const profile = JSON.parse(await fs.readFile(ctx.paths.profilePath, 'utf8'))
  const meta = JSON.parse(await fs.readFile(ctx.paths.metaPath, 'utf8'))
  assert.deepEqual(normal, { keep: true, deploymentMode: '3p' })
  assert.equal(profile.inferenceGatewayApiKey, 'sk-test')
  assert.deepEqual(profile.inferenceModels, [{ name: 'claude-sonnet-5', supports1m: true }])
  assert.equal(meta.appliedId, PROFILE_ID)
  assert.ok((await fs.stat(`${ctx.paths.normalConfigPath}.bak`)).isFile())

  await ctx.manager.applyProvider({ id: OFFICIAL_PROVIDER_ID })
  assert.equal(JSON.parse(await fs.readFile(ctx.paths.normalConfigPath, 'utf8')).deploymentMode, '1p')
  await assert.rejects(fs.access(ctx.paths.profilePath))
})

test('proxy mode requires router and writes a stable private gateway token', async (t) => {
  const ctx = await fixture(); t.after(() => fs.rm(ctx.root, { recursive: true, force: true }))
  const proxy = { ...direct, id: 'proxy', apiType: 'openai_compat', claudeDesktopMode: 'proxy', claudeDesktopApiFormat: 'openai_chat', claudeDesktopRoutes: [{ routeId: 'kimi-k2', upstreamModel: 'kimi-k2' }] }
  await assert.rejects(() => ctx.manager.applyProvider(proxy, { running: false }), /先启动本地路由/)
  await ctx.manager.applyProvider(proxy, { running: true, url: 'http://127.0.0.1:15721' })
  const profile = JSON.parse(await fs.readFile(ctx.paths.profilePath, 'utf8'))
  assert.equal(profile.inferenceGatewayBaseUrl, 'http://127.0.0.1:15721/claude-desktop')
  assert.equal(profile.inferenceGatewayApiKey, 'ccs-11111111222243338444555555555555')
  assert.equal(profile.inferenceModels[0].name, 'claude-sonnet-5')
  assert.equal(await ctx.manager.getGatewayToken(), profile.inferenceGatewayApiKey)
})

test('stores the Desktop gateway token through the encrypted ZTools storage adapter', async (t) => {
  const ctx = await fixture(); t.after(() => fs.rm(ctx.root, { recursive: true, force: true }))
  const values = new Map()
  const storage = { getItem: (key) => values.get(key), setItem: (key, value) => values.set(key, value) }
  const manager = createClaudeDesktopManager({ platform: 'darwin', homeDir: ctx.homeDir, dataDir: ctx.dataDir, storage, secretCodec: { encode: (value) => `encrypted:${Buffer.from(value).toString('base64')}`, decode: (value) => Buffer.from(value.slice(10), 'base64').toString() }, randomUUID: () => 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee' })
  const token = await manager.getGatewayToken()
  assert.equal(token, 'ccs-aaaaaaaabbbb4ccc8dddeeeeeeeeeeee')
  assert.doesNotMatch(values.values().next().value, /ccs-/)
  assert.equal(await manager.getGatewayToken(), token)
})

test('rolls back all files when a transactional write fails', async (t) => {
  const ctx = await fixture(); t.after(() => fs.rm(ctx.root, { recursive: true, force: true }))
  await fs.mkdir(path.dirname(ctx.paths.normalConfigPath), { recursive: true })
  await fs.writeFile(ctx.paths.normalConfigPath, '{"original":true}\n')
  let writes = 0
  const failing = createClaudeDesktopManager({ platform: 'darwin', homeDir: ctx.homeDir, dataDir: ctx.dataDir, beforeWrite: async () => { writes += 1; if (writes === 3) throw new Error('injected profile failure') } })
  await assert.rejects(() => failing.applyProvider(direct), /injected profile failure/)
  assert.equal(await fs.readFile(ctx.paths.normalConfigPath, 'utf8'), '{"original":true}\n')
  await assert.rejects(fs.access(ctx.paths.threepConfigPath))
  await assert.rejects(fs.access(ctx.paths.profilePath))
  await assert.rejects(fs.access(ctx.paths.metaPath))
})
