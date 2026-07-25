'use strict'
const test = require('node:test'); const assert = require('node:assert/strict'); const fs = require('node:fs/promises'); const os = require('node:os'); const path = require('node:path')
const { createBackupManager } = require('../preload/backupManager')
const { createMemoryStorage, normalizeRemotePath, createWebdavSyncManager } = require('../preload/webdavSyncManager')

test('normalizes safe WebDAV paths', () => { assert.equal(normalizeRemotePath('/folder'), 'folder/backup.json'); assert.throws(() => normalizeRemotePath('../backup.json'), /无效/) })
test('uploads, detects conflicts and downloads WebDAV backups', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'ztools-webdav-test-')); t.after(() => fs.rm(root, { recursive: true, force: true }))
  const dataDir = path.join(root, 'data'); await fs.mkdir(dataDir); await fs.writeFile(path.join(dataDir, 'providers.json'), JSON.stringify({ providers: [{ name: 'initial', apiKey: 'secret' }] }))
  let remoteBody = null; let etagVersion = 0
  const fakeFetch = async (_url, options = {}) => {
    const method = options.method || 'GET'
    if (method === 'MKCOL') return new Response('', { status: 201 })
    if (method === 'HEAD') return remoteBody ? new Response(null, { status: 200, headers: { etag: `"v${etagVersion}"`, 'last-modified': new Date().toUTCString() } }) : new Response(null, { status: 404 })
    if (method === 'PUT') { remoteBody = Buffer.from(options.body); etagVersion += 1; return new Response('', { status: 201 }) }
    if (method === 'GET') return new Response(remoteBody, { status: 200, headers: { 'content-type': 'application/json' } })
    return new Response('', { status: 405 })
  }
  const manager = createWebdavSyncManager({ backupManager: createBackupManager({ dataDir }), storage: createMemoryStorage(), secretCodec: { secure: true, encode: v => `x${v}`, decode: v => v.slice(1) }, fetchImpl: fakeFetch })
  await manager.saveConfig({ url: 'https://dav.example.com/root', username: 'user', password: 'pass', remotePath: 'cc/backup.json' })
  assert.equal(manager.getConfig().secureStorage, true); assert.equal(manager.getConfig().hasPassword, true)
  assert.equal((await manager.sync()).direction, 'upload'); assert.ok(remoteBody)
  assert.equal((await manager.sync()).state, 'synced')
  await fs.writeFile(path.join(dataDir, 'providers.json'), JSON.stringify({ providers: [{ name: 'local-change' }] })); etagVersion += 1
  const conflict = await manager.sync(); assert.equal(conflict.state, 'conflict')
  const resolved = await manager.sync({ strategy: 'remote' }); assert.equal(resolved.direction, 'download')
  const restored = JSON.parse(await fs.readFile(path.join(dataDir, 'providers.json'), 'utf8')); assert.equal(restored.providers[0].name, 'initial')
})

test('WebDAV 拒绝远程 HTTP、允许回环 HTTP，并限制下载体积', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'ztools-webdav-security-')); t.after(() => fs.rm(root, { recursive: true, force: true }))
  const dataDir = path.join(root, 'data'); await fs.mkdir(dataDir); await fs.writeFile(path.join(dataDir, 'providers.json'), '{}')
  const storage = createMemoryStorage(); const codec = { secure: true, encode: v => v, decode: v => v }
  let response = new Response('{}', { status: 200 })
  const manager = createWebdavSyncManager({ backupManager: createBackupManager({ dataDir }), storage, secretCodec: codec, fetchImpl: async () => response })
  await manager.saveConfig({ url: 'http://dav.example.com', username: 'u', password: 'p' })
  await assert.rejects(() => manager.download(), /远程地址必须使用 HTTPS/)
  await manager.saveConfig({ url: 'http://127.0.0.1:9999', username: 'u' })
  response = new Response('{}', { status: 200, headers: { 'content-length': String(100 * 1024 * 1024 + 1) } })
  await assert.rejects(() => manager.download(), /超过 100 MB/)
})

test('WebDAV 请求超时后释放操作并返回可诊断错误', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'ztools-webdav-timeout-')); t.after(() => fs.rm(root, { recursive: true, force: true }))
  const dataDir = path.join(root, 'data'); await fs.mkdir(dataDir); await fs.writeFile(path.join(dataDir, 'providers.json'), '{}')
  const storage = createMemoryStorage(); const codec = { secure: true, encode: v => v, decode: v => v }
  const hangingFetch = async (_url, options) => new Promise((_resolve, reject) => options.signal.addEventListener('abort', () => { const error = new Error('aborted'); error.name = 'AbortError'; reject(error) }, { once: true }))
  const manager = createWebdavSyncManager({ backupManager: createBackupManager({ dataDir }), storage, secretCodec: codec, fetchImpl: hangingFetch, requestTimeoutMs: 100 })
  await manager.saveConfig({ url: 'https://dav.example.com', username: 'u', password: 'p' })
  await assert.rejects(() => manager.download(), /请求超时/)
})
