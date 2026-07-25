'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const fsp = require('node:fs/promises')
const os = require('node:os')
const path = require('node:path')
const { extractVersion, inferInstallSource, normalizeTools, createToolRuntimeManager } = require('../preload/toolRuntimeManager')

async function executable(file) { await fsp.mkdir(path.dirname(file), { recursive: true }); await fsp.writeFile(file, '#!/bin/sh\nexit 0\n', { mode: 0o755 }) }

test('工具版本、来源与请求白名单规范化', () => {
  assert.equal(extractVersion('Claude Code v1.2.3'), '1.2.3')
  assert.equal(extractVersion('gemini 0.19.1-beta.2'), '0.19.1-beta.2')
  assert.equal(inferInstallSource('/Users/demo/.nvm/versions/node/v22/bin/codex'), 'nvm')
  assert.equal(inferInstallSource('/opt/homebrew/Cellar/opencode/1/bin/opencode'), 'homebrew')
  assert.equal(inferInstallSource('/Users/demo/.local/bin/hermes'), 'native')
  assert.deepEqual(normalizeTools(['codex', 'codex', 'evil;touch /tmp/x', 'gemini']), ['codex', 'gemini'])
})

test('探测多处安装、PATH 默认项、版本冲突与最新版本', async (t) => {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'ztools-tools-')); t.after(() => fsp.rm(root, { recursive: true, force: true }))
  const first = path.join(root, 'nvm', 'bin'); const second = path.join(root, 'homebrew', 'bin')
  await executable(path.join(first, 'codex')); await executable(path.join(second, 'codex'))
  const manager = createToolRuntimeManager({
    homeDir: path.join(root, 'home'), pathEnv: `${first}:${second}`, commonBinDirs: [],
    execFile: async (file) => ({ stdout: file.startsWith(first) ? 'codex-cli 1.2.3\n' : 'codex-cli 1.1.0\n', stderr: '' }),
    fetchImpl: async () => ({ ok: true, json: async () => ({ version: '1.3.0' }) })
  })
  const [report] = await manager.probeInstallations(['codex'])
  assert.equal(report.installs.length, 2); assert.equal(report.installs[0].isPathDefault, true); assert.equal(report.isConflict, true); assert.equal(report.needsConfirmation, true); assert.equal(report.anchored, true)
  const [version] = await manager.getToolVersions(['codex'])
  assert.equal(version.version, '1.2.3'); assert.equal(version.latestVersion, '1.3.0'); assert.equal(version.installedButBroken, false)
})

test('生命周期只执行后端生成命令并区分损坏安装', async (t) => {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'ztools-tools-run-')); t.after(() => fsp.rm(root, { recursive: true, force: true }))
  const bin = path.join(root, 'bin'); await executable(path.join(bin, 'gemini')); await executable(path.join(bin, 'npm'))
  const scripts = []
  const manager = createToolRuntimeManager({
    homeDir: path.join(root, 'home'), pathEnv: bin, commonBinDirs: [],
    execFile: async (file) => { if (file.endsWith('gemini')) { const error = new Error('broken'); error.stderr = 'Node version too old'; throw error } return { stdout: '10.0.0', stderr: '' } },
    fetchImpl: async () => ({ ok: false }), runScript: async (script) => { scripts.push(script); return { stdout: '', stderr: '' } }
  })
  const [version] = await manager.getToolVersions(['gemini'])
  assert.equal(version.installedButBroken, true); assert.match(version.error, /Node version too old/)
  const outcome = await manager.runLifecycle(['gemini', 'not-a-tool'], 'update')
  assert.equal(outcome.length, 1); assert.equal(outcome[0].success, true); assert.match(scripts[0], /npm.*@google\/gemini-cli@latest/); assert.ok(!scripts[0].includes('not-a-tool'))
  await assert.rejects(manager.runLifecycle(['not-a-tool'], 'update'), /没有选择/)
  await assert.rejects(manager.runLifecycle(['codex'], 'remove'), /不支持/)
})
