'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs/promises')
const os = require('node:os')
const path = require('node:path')
const { execFile } = require('node:child_process')
const { promisify } = require('node:util')
const run = promisify(execFile)
const { binaryFilename, createSidecarClient } = require('../preload/sidecarClient')

const binaryPath = path.join(__dirname, '..', 'preload', 'bin', binaryFilename())
const sidecar = createSidecarClient({ binaryPath, timeoutMs: 10000 })

const provider = {
  name: 'Integration Provider',
  apiKey: 'sk-integration',
  baseUrl: 'https://api.example.com/v1',
  model: 'integration-model',
  wireApi: 'chat_completions',
  claudeAuthField: 'ANTHROPIC_API_KEY'
}

test('Rust sidecar responds over JSON Lines', { skip: !sidecar.isAvailable() }, async () => {
  const info = await sidecar.ping()
  assert.equal(info.name, 'cc-switch-sidecar')
  assert.equal(info.protocol, 1)
})

test('Rust sidecar applies all client configurations transactionally', { skip: !sidecar.isAvailable() }, async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'ztools-sidecar-integration-'))
  t.after(() => fs.rm(root, { recursive: true, force: true }))

  await fs.mkdir(path.join(root, '.claude'), { recursive: true })
  await fs.writeFile(path.join(root, '.claude', 'settings.json'), JSON.stringify({ env: { KEEP: 'yes' } }))
  await sidecar.applyClient('claude', root, provider)
  const claude = JSON.parse(await fs.readFile(path.join(root, '.claude', 'settings.json'), 'utf8'))
  assert.equal(claude.env.KEEP, 'yes')
  assert.equal(claude.env.ANTHROPIC_API_KEY, provider.apiKey)
  assert.equal(claude.env.ANTHROPIC_AUTH_TOKEN, undefined)
  assert.ok(await fs.stat(path.join(root, '.claude', 'settings.json.bak')))

  await fs.mkdir(path.join(root, '.codex'), { recursive: true })
  await fs.writeFile(path.join(root, '.codex', 'config.toml'), 'approval_policy = "on-request"\n')
  await fs.writeFile(path.join(root, '.codex', 'auth.json'), JSON.stringify({ tokens: { access_token: 'keep' } }))
  await sidecar.applyClient('codex', root, provider)
  const codex = await fs.readFile(path.join(root, '.codex', 'config.toml'), 'utf8')
  const auth = JSON.parse(await fs.readFile(path.join(root, '.codex', 'auth.json'), 'utf8'))
  assert.match(codex, /wire_api = "chat_completions"/)
  assert.match(codex, /approval_policy = "on-request"/)
  assert.equal(auth.tokens.access_token, 'keep')
  assert.equal(auth.OPENAI_API_KEY, provider.apiKey)

  await fs.mkdir(path.join(root, '.gemini'), { recursive: true })
  await fs.writeFile(path.join(root, '.gemini', '.env'), 'KEEP=value\nGEMINI_API_KEY=old\n')
  await sidecar.applyClient('gemini', root, provider)
  const geminiEnv = await fs.readFile(path.join(root, '.gemini', '.env'), 'utf8')
  const geminiSettings = JSON.parse(await fs.readFile(path.join(root, '.gemini', 'settings.json'), 'utf8'))
  assert.match(geminiEnv, /KEEP=value/)
  assert.equal((geminiEnv.match(/GEMINI_API_KEY=/g) || []).length, 1)
  assert.equal(geminiSettings.security.auth.selectedType, 'gemini-api-key')
})

test('Rust sidecar 结构化合并、剥离并提取 Codex 通用 TOML', { skip: !sidecar.isAvailable() }, async () => {
  const config = '# keep\napproval_policy = "on-request"\nmodel = "gpt"\n[model_providers.custom]\nbase_url = "https://api.example.com"\n[mcp_servers.demo]\ncommand = "npx"\n'
  const snippet = '# shared\napproval_policy = "never"\n[tui]\nnotifications = false\n'
  const merged = await sidecar.updateTomlCommonConfig(config, snippet, true)
  assert.match(merged, /# keep/); assert.match(merged, /approval_policy = "never"/); assert.match(merged, /\[tui\]/)
  const removed = await sidecar.updateTomlCommonConfig(merged, snippet, false)
  assert.doesNotMatch(removed, /\[tui\]/)
  const extracted = await sidecar.extractCodexCommonConfig(config)
  assert.match(extracted, /approval_policy/); assert.doesNotMatch(extracted, /model_providers|mcp_servers|model =/)
})

test('Rust sidecar owns and reverses the Codex unified-history TOML route', { skip: !sidecar.isAvailable() }, async () => {
  const enabled = await sidecar.updateCodexHistoryToml('approval_policy = "on-request"\n', true)
  assert.equal(enabled.changed, true); assert.match(enabled.configToml, /model_provider = "ztools_cc_switch"/); assert.match(enabled.configToml, /requires_openai_auth = true/)
  const disabled = await sidecar.updateCodexHistoryToml(enabled.configToml, false)
  assert.equal(disabled.changed, true); assert.doesNotMatch(disabled.configToml, /model_provider/); assert.match(disabled.configToml, /approval_policy/)
})

test('Rust sidecar transactionally migrates Codex state SQLite with a consistent backup', { skip: !sidecar.isAvailable() }, async (t) => {
  try { await run('sqlite3', ['-version']) } catch { t.skip('sqlite3 CLI unavailable for fixture creation'); return }
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'ztools-sidecar-state-')); t.after(() => fs.rm(root, { recursive: true, force: true }))
  const db = path.join(root, 'state_5.sqlite'); const backup = path.join(root, 'backup')
  await run('sqlite3', [db, "CREATE TABLE threads(id TEXT PRIMARY KEY, model_provider TEXT); INSERT INTO threads VALUES('a','openai'),('b','openai');"])
  const result = await sidecar.updateCodexStateProviders({ dbPaths: [db], sourceProvider: 'openai', targetProvider: 'ztools_cc_switch', threadIds: ['a'], filterThreadIds: true, backupDir: backup })
  assert.equal(result.changedRows, 1); assert.deepEqual(result.threadIds, ['a'])
  assert.equal((await run('sqlite3', [db, "SELECT model_provider FROM threads WHERE id='a';"])).stdout.trim(), 'ztools_cc_switch')
  assert.equal((await run('sqlite3', [db, "SELECT model_provider FROM threads WHERE id='b';"])).stdout.trim(), 'openai')
  assert.ok((await fs.readdir(backup)).some((name) => name.endsWith('state_5.sqlite')))
})
