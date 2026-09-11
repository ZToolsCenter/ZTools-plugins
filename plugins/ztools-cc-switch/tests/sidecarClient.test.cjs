const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const fsp = require('node:fs/promises')
const os = require('node:os')
const path = require('node:path')
const { binaryFilename, isAsarPath, createSidecarClient } = require('../preload/sidecarClient')

test('sidecar filenames cover macOS, Windows and Linux', () => {
  assert.equal(binaryFilename('darwin', 'arm64'), 'cc-switch-sidecar-darwin-arm64')
  assert.equal(binaryFilename('darwin', 'x64'), 'cc-switch-sidecar-darwin-x64')
  assert.equal(binaryFilename('win32', 'x64'), 'cc-switch-sidecar-win32-x64.exe')
  assert.equal(binaryFilename('linux', 'x64'), 'cc-switch-sidecar-linux-x64')
  assert.equal(binaryFilename('freebsd', 'x64'), null)
})

test('识别 ASAR 路径并把 sidecar 原子释放到真实目录执行', async (t) => {
  if (process.platform === 'win32') return t.skip('fixture 使用 POSIX shebang')
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'cc-switch-asar-'))
  t.after(() => fsp.rm(root, { recursive: true, force: true }))
  const filename = binaryFilename(process.platform, process.arch)
  const bundled = path.join(root, 'plugin.asar', 'preload', 'bin', filename)
  const extractDir = path.join(root, 'user-data', 'runtime', 'sidecar')
  await fsp.mkdir(path.dirname(bundled), { recursive: true })
  await fsp.writeFile(bundled, `#!/usr/bin/env node
let input = ''
process.stdin.setEncoding('utf8')
process.stdin.on('data', chunk => { input += chunk })
process.stdin.on('end', () => {
  const request = JSON.parse(input.trim())
  process.stdout.write(JSON.stringify({ id: request.id, ok: true, result: { protocol: 1 } }) + '\\n')
})
`, { mode: 0o600 })

  assert.equal(isAsarPath(bundled), true)
  const client = createSidecarClient({ binaryPath: bundled, extractDir, timeoutMs: 3000 })
  assert.equal(client.isAvailable(), true)
  assert.equal(client.binaryPath, path.join(extractDir, filename))
  assert.notEqual(client.binaryPath, client.bundledBinaryPath)
  assert.ok(fs.statSync(client.binaryPath).mode & 0o100)
  assert.deepEqual(await client.ping(), { protocol: 1 })
  assert.equal((await client.getStatus()).extracted, true)
})

test('ASAR sidecar 没有释放目录时安全判定为不可用', async (t) => {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'cc-switch-asar-missing-'))
  t.after(() => fsp.rm(root, { recursive: true, force: true }))
  const bundled = path.join(root, 'plugin.asar', 'preload', 'bin', binaryFilename(process.platform, process.arch))
  await fsp.mkdir(path.dirname(bundled), { recursive: true })
  await fsp.writeFile(bundled, 'fixture')
  const client = createSidecarClient({ binaryPath: bundled })
  assert.equal(client.isAvailable(), false)
  await assert.rejects(() => client.ping(), /需要释放目录/)
})
