'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const fsp = require('node:fs/promises')
const os = require('node:os')
const path = require('node:path')
const { providerEnvironment, createProviderTerminalManager } = require('../preload/providerTerminalManager')

const provider = { id: 'p1', name: 'Provider One', apiKey: "sk-a'b", baseUrl: 'https://api.example.com/v1', model: 'model-x', claudeAuthField: 'ANTHROPIC_API_KEY' }

test('按客户端生成固定白名单 Provider 环境变量', () => {
  assert.deepEqual(providerEnvironment('claude', provider), { ZTOOLS_PROVIDER_ID: 'p1', ZTOOLS_PROVIDER_NAME: 'Provider One', ANTHROPIC_API_KEY: "sk-a'b", ANTHROPIC_BASE_URL: 'https://api.example.com/v1', ANTHROPIC_MODEL: 'model-x' })
  assert.equal(providerEnvironment('codex', provider).OPENAI_API_KEY, "sk-a'b")
  assert.equal(providerEnvironment('gemini', provider).GOOGLE_GEMINI_BASE_URL, 'https://api.example.com/v1')
  assert.equal(providerEnvironment('grokbuild', provider).XAI_MODEL, 'model-x')
  assert.throws(() => providerEnvironment('unknown', provider), /不支持/)
})

test('macOS Provider 终端使用参数化 osascript 并正确引用密钥和目录', async (t) => {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'ztools-terminal-')); t.after(() => fsp.rm(root, { recursive: true, force: true }))
  const cwd = path.join(root, "work dir's"); await fsp.mkdir(cwd)
  const calls = []
  const manager = createProviderTerminalManager({ platform: 'darwin', homeDir: root, execFile: async (...args) => { calls.push(args); return { stdout: '', stderr: '' } } })
  const result = await manager.launch('claude', provider, cwd)
  assert.equal(result.launched, true); assert.equal(result.cwd, await fsp.realpath(cwd)); assert.equal(calls[0][0], 'osascript'); assert.equal(calls[0][1][0], '-e')
  const script = calls[0][1][1]
  assert.match(script, /ANTHROPIC_API_KEY/); assert.match(script, /sk-a/); assert.match(script, /exec claude/); assert.match(script, /work dir/)
  assert.equal(result.apiKey, undefined)
})

test('Provider 终端拒绝缺失密钥、非法客户端与无效工作目录', async (t) => {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'ztools-terminal-invalid-')); t.after(() => fsp.rm(root, { recursive: true, force: true }))
  const manager = createProviderTerminalManager({ platform: 'darwin', homeDir: root, execFile: async () => ({}) })
  await assert.rejects(manager.launch('claude', { ...provider, apiKey: '' }, root), /API Key/)
  await assert.rejects(manager.launch('unknown', provider, root), /不支持/)
  await assert.rejects(manager.launch('codex', provider, path.join(root, 'missing')), /不存在/)
  await assert.rejects(manager.launch('codex', provider, `${root}\nmalicious`), /非法字符/)
})
