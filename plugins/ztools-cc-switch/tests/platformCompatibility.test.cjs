'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const fsp = require('node:fs/promises')
const os = require('node:os')
const path = require('node:path')
const { createConfigManager, getClientPaths } = require('../preload/configManager')
const { createSessionManager } = require('../preload/sessionManager')

test('current OS can switch every CLI client with the JavaScript fallback', async (t) => {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'ztools-platform-switch-'))
  t.after(() => fsp.rm(root, { recursive: true, force: true }))
  const homeDir = path.join(root, 'home')
  const dataDir = path.join(root, 'data')
  const rules = path.join(root, 'rules.json')
  await fsp.mkdir(homeDir, { recursive: true })
  await fsp.writeFile(rules, '{"providers":[]}')
  const manager = createConfigManager({ homeDir, dataDir, bundledRulesPath: rules })
  const provider = await manager.saveProvider({
    id: 'platform-provider', name: 'Platform Provider', apiKey: 'platform-secret',
    baseUrl: 'https://api.example.com/v1', model: 'platform-model',
    clients: ['claude', 'codex', 'gemini', 'opencode', 'openclaw', 'hermes', 'grokbuild']
  })
  for (const client of provider.clients) await manager.switchProvider(client, provider.id)
  const paths = getClientPaths(homeDir)
  for (const [client, key] of Object.entries({ claude: 'settings', codex: 'config', gemini: 'env', opencode: 'config', openclaw: 'config', hermes: 'config', grokbuild: 'config' })) {
    assert.equal((await fsp.stat(paths[client][key])).isFile(), true, `${client} config was not created on ${process.platform}`)
  }
})

test('plugin manifest advertises all supported ZTools desktop platforms', async () => {
  const manifest = JSON.parse(await fsp.readFile(path.join(__dirname, '..', 'plugin.json'), 'utf8'))
  assert.deepEqual(new Set(manifest.platform), new Set(['darwin', 'win32', 'linux']))
})

test('Windows and Linux session restore use only fixed terminal executables', async (t) => {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'ztools-platform-session-'))
  t.after(() => fsp.rm(root, { recursive: true, force: true }))
  const home = path.join(root, 'home')
  const source = path.join(home, '.claude', 'projects', 'p', 'session.jsonl')
  await fsp.mkdir(path.dirname(source), { recursive: true })
  await fsp.writeFile(source, `${JSON.stringify({ sessionId: 'platform-session', cwd: home, type: 'user', message: { role: 'user', content: 'resume' } })}\n`)
  for (const [platform, executable] of [['win32', 'powershell.exe'], ['linux', 'x-terminal-emulator']]) {
    const calls = []
    const manager = createSessionManager({ platform, homeDir: home, dataDir: path.join(root, `data-${platform}`), execFile: async (...args) => { calls.push(args); return { stdout: '', stderr: '' } } })
    await manager.launchSession('claude', 'platform-session', source)
    assert.equal(calls.at(-1)[0], executable)
  }
})
