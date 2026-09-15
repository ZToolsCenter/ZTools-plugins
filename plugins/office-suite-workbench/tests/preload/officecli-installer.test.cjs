'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const crypto = require('node:crypto')
const fs = require('node:fs/promises')
const os = require('node:os')
const path = require('node:path')
const { EventEmitter } = require('node:events')
const { PassThrough } = require('node:stream')

const {
  checksumForAsset,
  compareVersions,
  createOfficeCliInstaller,
  latestVersionFromUrl,
  releaseAsset
} = require('../../preload/officecli-installer.cjs')

test('installer selects the exact release asset for supported platforms', () => {
  assert.equal(releaseAsset('darwin', 'arm64'), 'officecli-mac-arm64')
  assert.equal(releaseAsset('darwin', 'x64'), 'officecli-mac-x64')
  assert.equal(releaseAsset('win32', 'arm64'), 'officecli-win-arm64.exe')
  assert.equal(releaseAsset('win32', 'x64'), 'officecli-win-x64.exe')
  assert.equal(releaseAsset('linux', 'x64'), 'officecli-linux-x64')
  assert.equal(releaseAsset('linux', 'arm64', true), 'officecli-linux-alpine-arm64')
  assert.throws(() => releaseAsset('freebsd', 'x64'), { code: 'UNSUPPORTED_PLATFORM' })
})

test('installer parses immutable versions and exact checksum manifest entries', () => {
  const digest = 'a'.repeat(64)
  assert.equal(latestVersionFromUrl('https://github.com/iOfficeAI/OfficeCLI/releases/tag/v1.2.3'), 'v1.2.3')
  assert.equal(latestVersionFromUrl('https://example.com/latest'), null)
  assert.equal(checksumForAsset(`${digest}  officecli-mac-arm64\n${'b'.repeat(64)}  officecli-mac-arm64-debug`, 'officecli-mac-arm64'), digest)
  assert.equal(checksumForAsset(`${digest}  another-asset`, 'officecli-mac-arm64'), null)
  assert.equal(compareVersions('1.2.3', '1.2.2'), 1)
  assert.equal(compareVersions('v1.2.3', '1.2.3'), 0)
  assert.equal(compareVersions('1.2.3-beta.1', '1.2.3'), -1)
  assert.throws(() => compareVersions('latest', '1.2.3'), { code: 'INVALID_VERSION' })
})

function fakeRequest(responses, requestUrls = []) {
  return (url, _options, callback) => {
    requestUrls.push(url)
    const request = new EventEmitter()
    request.setTimeout = () => request
    request.destroy = (error) => request.emit('error', error)
    request.end = () => {
      setImmediate(() => {
        const entry = responses.find((candidate) => candidate.match(url))
        assert.ok(entry, `Unexpected installer URL: ${url}`)
        const response = new PassThrough()
        response.statusCode = entry.status || 200
        response.headers = entry.location ? { location: entry.location } : {}
        response.url = url
        callback(response)
        response.end(entry.body || '')
      })
    }
    return request
  }
}

function versionSpawn(calls) {
  return (binaryPath, args, options) => {
    calls.push({ binaryPath, args, options })
    const child = new EventEmitter()
    child.stdout = new PassThrough()
    child.stderr = new PassThrough()
    child.kill = () => true
    setImmediate(() => {
      child.stdout.end('officecli 1.2.3\n')
      child.stderr.end()
      setImmediate(() => child.emit('close', 0, null))
    })
    return child
  }
}

test('one-click installer verifies SHA-256, stages atomically, and performs a version check', async (t) => {
  const homeDir = await fs.mkdtemp(path.join(os.tmpdir(), 'office-suite-install-'))
  const asset = 'officecli-mac-arm64'
  const binary = Buffer.from('signed-officecli-fixture')
  const checksum = crypto.createHash('sha256').update(binary).digest('hex')
  const versionUrl = 'https://d.officecli.ai/releases/tag/v1.2.3'
  const responses = [
    { match: (url) => url === 'https://d.officecli.ai/releases/latest', status: 302, location: versionUrl },
    { match: (url) => url === versionUrl, body: '' },
    { match: (url) => url.endsWith(`/releases/download/v1.2.3/${asset}`), body: binary },
    { match: (url) => url.endsWith('/releases/download/v1.2.3/SHA256SUMS'), body: `${checksum}  ${asset}\n` }
  ]
  const spawnCalls = []
  const requestUrls = []
  const installer = createOfficeCliInstaller({
    platform: 'darwin',
    arch: 'arm64',
    homeDir,
    env: { PATH: '' },
    request: fakeRequest(responses, requestUrls),
    spawn: versionSpawn(spawnCalls)
  })
  t.after(() => fs.rm(homeDir, { recursive: true, force: true }))

  const result = await installer.install()
  const expectedPath = path.join(homeDir, '.local', 'bin', 'officecli')
  assert.deepEqual(result, {
    installed: true,
    binaryPath: expectedPath,
    version: '1.2.3',
    release: 'v1.2.3',
    asset
  })
  assert.deepEqual(await fs.readFile(expectedPath), binary)
  assert.equal(spawnCalls.length, 1)
  assert.deepEqual(spawnCalls[0].args, ['--version'])
  assert.equal(spawnCalls[0].options.shell, false)
  const updateInfo = await installer.check('1.2.2')
  assert.equal(updateInfo.updateAvailable, true)
  assert.equal(updateInfo.latestVersion, '1.2.3')

  const existingPath = path.join(homeDir, 'custom', 'officecli')
  await fs.mkdir(path.dirname(existingPath), { recursive: true })
  await fs.writeFile(existingPath, 'old-version', { mode: 0o755 })
  const updated = await installer.update(existingPath)
  assert.equal(updated.binaryPath, existingPath)
  assert.deepEqual(await fs.readFile(existingPath), binary)
  assert.equal(requestUrls.every((url) => url.startsWith('https://d.officecli.ai/')), true)
  assert.equal(requestUrls.some((url) => url.startsWith('https://github.com/')), false)
  await assert.rejects(fs.access(`${expectedPath}.new`))
})
