'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs/promises')
const os = require('node:os')
const path = require('node:path')
const { createBackupManager } = require('../preload/backupManager')
const { createMemoryStorage } = require('../preload/webdavSyncManager')
const { SECRET_KEY, signRequest, createS3SyncManager } = require('../preload/s3SyncManager')

test('AWS SigV4 signs the canonical host, payload and credential scope', () => {
  const headers = signRequest({ method: 'PUT', url: 'https://bucket.s3.us-west-2.amazonaws.com/root/a.json', headers: { 'content-type': 'application/json' }, body: Buffer.from('{}'), accessKeyId: 'AKID', secretAccessKey: 'SECRET', region: 'us-west-2', now: new Date('2026-07-22T01:02:03Z') })
  assert.equal(headers.host, 'bucket.s3.us-west-2.amazonaws.com')
  assert.equal(headers['x-amz-date'], '20260722T010203Z')
  assert.equal(headers['x-amz-content-sha256'], '44136fa355b3678a1146ad16f7e8649e94fb4fc21fe77e8310c060f61caaff8a')
  assert.match(headers.authorization, /^AWS4-HMAC-SHA256 Credential=AKID\/20260722\/us-west-2\/s3\/aws4_request/)
})

test('S3 sync uploads manifest last, detects conflict, verifies and restores backup', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'ztools-s3-test-')); t.after(() => fs.rm(root, { recursive: true, force: true }))
  const dataDir = path.join(root, 'data'); await fs.mkdir(dataDir); const providersPath = path.join(dataDir, 'providers.json')
  await fs.writeFile(providersPath, JSON.stringify({ providers: [{ name: 'initial', apiKey: 'secret' }] }))
  const objects = new Map(); const calls = []; let etag = 0
  const fakeFetch = async (url, options = {}) => {
    const target = new URL(url); const key = decodeURIComponent(target.pathname).replace(/^\/bucket\/?/, '')
    calls.push({ method: options.method, key, headers: options.headers })
    assert.match(options.headers.authorization, /^AWS4-HMAC-SHA256 /)
    if (options.method === 'HEAD') return new Response(null, { status: 200 })
    if (options.method === 'PUT') { objects.set(key, Buffer.from(options.body)); etag += 1; return new Response(null, { status: 200, headers: { etag: `"v${etag}"` } }) }
    if (options.method === 'GET') { const value = objects.get(key); return value ? new Response(value, { status: 200, headers: { etag: `"v${etag}"` } }) : new Response(null, { status: 404 }) }
    return new Response(null, { status: 405 })
  }
  const storage = createMemoryStorage(); const codec = { secure: true, encode: (v) => `enc:${Buffer.from(v).toString('base64')}`, decode: (v) => Buffer.from(v.slice(4), 'base64').toString() }
  const manager = createS3SyncManager({ backupManager: createBackupManager({ dataDir }), storage, secretCodec: codec, fetchImpl: fakeFetch, now: () => new Date('2026-07-22T01:02:03Z') })
  await manager.saveConfig({ enabled: true, region: 'us-east-1', bucket: 'bucket', accessKeyId: 'AKID', secretAccessKey: 'SECRET', endpoint: 'https://s3.example.com', remoteRoot: 'cc-switch-sync', profile: 'default' })
  assert.equal(manager.getConfig().hasSecretAccessKey, true); assert.equal(storage.getItem(SECRET_KEY).includes('SECRET'), false)
  assert.equal((await manager.checkConnection()).ok, true)
  const uploaded = await manager.upload(); assert.equal(uploaded.direction, 'upload')
  assert.deepEqual(calls.filter((call) => call.method === 'PUT').map((call) => path.basename(call.key)), ['backup.json', 'manifest.json'])
  const manifest = JSON.parse(objects.get('cc-switch-sync/v2/json-v1/default/manifest.json'))
  assert.equal(manifest.protocolVersion, 2); assert.equal(manifest.artifacts['backup.json'].size, objects.get('cc-switch-sync/v2/json-v1/default/backup.json').length)
  const info = await manager.fetchRemoteInfo(); assert.equal(info.deviceName, os.hostname()); assert.equal(info.compatible, true)
  const unchanged = await manager.sync(); assert.equal(unchanged.state, 'synced'); assert.match(unchanged.message, /已同步/)
  await fs.writeFile(providersPath, JSON.stringify({ providers: [{ name: 'local-change' }] }))
  etag += 1
  const conflict = await manager.sync(); assert.equal(conflict.state, 'conflict')
  const restored = await manager.sync({ strategy: 'remote' }); assert.equal(restored.direction, 'download')
  const data = JSON.parse(await fs.readFile(providersPath, 'utf8')); assert.equal(data.providers[0].name, 'initial')
})

test('S3 Endpoint 拒绝远程 HTTP，但允许回环 HTTP', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'ztools-s3-security-')); t.after(() => fs.rm(root, { recursive: true, force: true }))
  const dataDir = path.join(root, 'data'); await fs.mkdir(dataDir); await fs.writeFile(path.join(dataDir, 'providers.json'), '{}')
  const storage = createMemoryStorage(); const codec = { secure: true, encode: v => v, decode: v => v }
  const manager = createS3SyncManager({ backupManager: createBackupManager({ dataDir }), storage, secretCodec: codec, fetchImpl: async () => new Response(null, { status: 200 }) })
  const base = { region: 'us-east-1', bucket: 'bucket', accessKeyId: 'AKID', secretAccessKey: 'SECRET' }
  await manager.saveConfig({ ...base, endpoint: 'http://s3.example.com' })
  await assert.rejects(() => manager.checkConnection(), /远程地址必须使用 HTTPS/)
  await manager.saveConfig({ ...base, endpoint: 'http://localhost:9000' })
  assert.equal((await manager.checkConnection()).ok, true)
})
