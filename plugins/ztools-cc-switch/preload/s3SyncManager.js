'use strict'

const crypto = require('node:crypto')
const fsp = require('node:fs/promises')
const os = require('node:os')
const path = require('node:path')
const { requireSecureHttpUrl } = require('./networkSecurity')

const CONFIG_KEY = 'cc-switch:s3-config-v1'
const SECRET_KEY = 'cc-switch:s3-secret-v1'
const STATE_KEY = 'cc-switch:s3-state-v1'
const MAX_OBJECT_BYTES = 100 * 1024 * 1024
const PROTOCOL_VERSION = 2
const DATA_VERSION = 1

function sha256(value, encoding = 'hex') { return crypto.createHash('sha256').update(value).digest(encoding) }
function hmac(key, value, encoding) { return crypto.createHmac('sha256', key).update(value).digest(encoding) }
function awsEncode(value) { return encodeURIComponent(value).replace(/[!'()*]/g, (character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`) }
function canonicalPath(pathname) { return String(pathname || '/').split('/').map((segment) => { try { return awsEncode(decodeURIComponent(segment)) } catch { return awsEncode(segment) } }).join('/').replace(/^$/, '/') }
function stableBundleHash(bytes) {
  try { const value = JSON.parse(Buffer.from(bytes).toString('utf8')); return sha256(JSON.stringify({ format: value.format, version: value.version, files: value.files })) }
  catch { return sha256(bytes) }
}
function normalizedSegment(value, fallback) {
  const result = String(value || fallback).trim().replace(/^\/+|\/+$/g, '')
  if (!result || result.split('/').some((part) => !part || part === '.' || part === '..')) throw new Error('S3 远端目录或配置名称无效')
  return result
}

function signRequest({ method, url, headers = {}, body = Buffer.alloc(0), accessKeyId, secretAccessKey, region, service = 's3', now = new Date() }) {
  if (!accessKeyId || !secretAccessKey) throw new Error('S3 Access Key 尚未配置')
  const target = new URL(url)
  const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, '')
  const dateStamp = amzDate.slice(0, 8)
  const payloadHash = sha256(body)
  const normalizedHeaders = {}
  for (const [key, value] of Object.entries(headers)) normalizedHeaders[key.toLowerCase()] = String(value).trim().replace(/\s+/g, ' ')
  normalizedHeaders.host = target.host
  normalizedHeaders['x-amz-content-sha256'] = payloadHash
  normalizedHeaders['x-amz-date'] = amzDate
  const headerNames = Object.keys(normalizedHeaders).sort()
  const canonicalHeaders = headerNames.map((name) => `${name}:${normalizedHeaders[name]}\n`).join('')
  const query = [...target.searchParams.entries()].sort(([ak, av], [bk, bv]) => ak.localeCompare(bk) || av.localeCompare(bv)).map(([key, value]) => `${awsEncode(key)}=${awsEncode(value)}`).join('&')
  const canonicalRequest = [method.toUpperCase(), canonicalPath(target.pathname), query, canonicalHeaders, headerNames.join(';'), payloadHash].join('\n')
  const scope = `${dateStamp}/${region}/${service}/aws4_request`
  const stringToSign = `AWS4-HMAC-SHA256\n${amzDate}\n${scope}\n${sha256(canonicalRequest)}`
  const dateKey = hmac(Buffer.from(`AWS4${secretAccessKey}`), dateStamp)
  const regionKey = hmac(dateKey, region)
  const serviceKey = hmac(regionKey, service)
  const signingKey = hmac(serviceKey, 'aws4_request')
  const signature = hmac(signingKey, stringToSign, 'hex')
  return { ...normalizedHeaders, authorization: `AWS4-HMAC-SHA256 Credential=${accessKeyId}/${scope}, SignedHeaders=${headerNames.join(';')}, Signature=${signature}` }
}

function createS3SyncManager(options = {}) {
  const backupManager = options.backupManager
  const storage = options.storage
  const secretCodec = options.secretCodec
  const fetchImpl = options.fetchImpl || fetch
  const clock = options.now || (() => new Date())
  const listeners = new Set()
  let activeOperation = null
  let timer = null
  let status = { state: 'idle', message: '尚未同步', lastSyncAt: null, direction: null }

  function read(key, fallback) { const value = storage.getItem(key); return value === undefined || value === null ? fallback : value }
  function emit(patch) { status = { ...status, ...patch }; for (const listener of listeners) { try { listener({ ...status }) } catch {} }; return { ...status } }
  function subscribe(listener) { if (typeof listener !== 'function') return () => {}; listeners.add(listener); listener({ ...status }); return () => listeners.delete(listener) }
  function getConfig() {
    const value = read(CONFIG_KEY, {}) || {}
    return {
      enabled: Boolean(value.enabled), autoSync: Boolean(value.autoSync), intervalMinutes: Math.min(Math.max(Number(value.intervalMinutes) || 30, 5), 1440),
      region: String(value.region || 'us-east-1').trim(), bucket: String(value.bucket || '').trim(), accessKeyId: String(value.accessKeyId || '').trim(),
      endpoint: String(value.endpoint || '').trim().replace(/\/+$/, ''), remoteRoot: normalizedSegment(value.remoteRoot, 'cc-switch-sync'), profile: normalizedSegment(value.profile, 'default'),
      includeLogs: value.includeLogs !== false, conflictStrategy: ['ask', 'local', 'remote'].includes(value.conflictStrategy) ? value.conflictStrategy : 'ask',
      hasSecretAccessKey: Boolean(read(SECRET_KEY, '')), secureStorage: Boolean(secretCodec.secure)
    }
  }
  function secretAccessKey() { const encoded = read(SECRET_KEY, ''); return encoded ? secretCodec.decode(encoded) : '' }
  async function saveConfig(patch = {}) {
    const current = getConfig(); const next = { ...current, ...patch }
    next.remoteRoot = normalizedSegment(next.remoteRoot, 'cc-switch-sync'); next.profile = normalizedSegment(next.profile, 'default')
    delete next.hasSecretAccessKey; delete next.secureStorage; delete next.secretAccessKey; delete next.clearSecretAccessKey
    storage.setItem(CONFIG_KEY, next)
    if (typeof patch.secretAccessKey === 'string' && patch.secretAccessKey) storage.setItem(SECRET_KEY, secretCodec.encode(patch.secretAccessKey))
    if (patch.clearSecretAccessKey) storage.removeItem(SECRET_KEY)
    scheduleAutoSync(); return getConfig()
  }
  function validate(config) {
    if (!config.region || !/^[a-z0-9-]+$/i.test(config.region)) throw new Error('S3 Region 无效')
    if (!config.bucket || !/^[a-z0-9][a-z0-9._-]{1,61}[a-z0-9]$/i.test(config.bucket)) throw new Error('S3 Bucket 名称无效')
    if (!config.accessKeyId || !(config._secretAccessKey || secretAccessKey())) throw new Error('S3 Access Key 尚未完整保存')
    if (config.endpoint) requireSecureHttpUrl(config.endpoint, 'S3 Endpoint')
  }
  function remotePrefix(config) { return `${config.remoteRoot}/v${PROTOCOL_VERSION}/json-v${DATA_VERSION}/${config.profile}` }
  function objectUrl(config, key = '') {
    if (config.endpoint) {
      const url = new URL(config.endpoint); url.pathname = `${url.pathname.replace(/\/+$/, '')}/${awsEncode(config.bucket)}${key ? `/${key.split('/').map(awsEncode).join('/')}` : ''}`; return url
    }
    const host = config.region === 'us-east-1' ? `${config.bucket}.s3.amazonaws.com` : `${config.bucket}.s3.${config.region}.amazonaws.com`
    return new URL(`https://${host}/${key.split('/').map(awsEncode).join('/')}`)
  }
  async function signedFetch(config, method, key, body = Buffer.alloc(0), contentType = '') {
    validate(config)
    const url = objectUrl(config, key)
    const baseHeaders = contentType ? { 'content-type': contentType } : {}
    const headers = signRequest({ method, url, headers: baseHeaders, body, accessKeyId: config.accessKeyId, secretAccessKey: config._secretAccessKey || secretAccessKey(), region: config.region, now: clock() })
    const controller = new AbortController(); const timeout = setTimeout(() => controller.abort(), 30_000)
    try { return await fetchImpl(url, { method, headers, body: ['GET', 'HEAD'].includes(method) ? undefined : body, signal: controller.signal, redirect: 'manual' }) }
    catch (error) { if (error.name === 'AbortError') throw new Error('S3 请求超时'); throw error }
    finally { clearTimeout(timeout) }
  }
  async function responseBytes(response, maxBytes = MAX_OBJECT_BYTES) {
    if (!response.body) return Buffer.alloc(0)
    const chunks = []; let size = 0
    for await (const chunk of response.body) { size += chunk.length; if (size > maxBytes) throw new Error('S3 对象超过 100 MB 安全限制'); chunks.push(Buffer.from(chunk)) }
    return Buffer.concat(chunks)
  }
  async function checkConnection(patch) {
    const config = { ...getConfig(), ...(patch || {}), _secretAccessKey: patch?.secretAccessKey || secretAccessKey() }
    const response = await signedFetch(config, 'HEAD', '')
    if (!response.ok) throw new Error(`S3 连接失败：HTTP ${response.status}`)
    return { ok: true, message: 'S3 连接成功' }
  }
  async function createBundle(config) {
    const directory = await fsp.mkdtemp(path.join(os.tmpdir(), 'ztools-s3-')); const file = path.join(directory, 'backup.json')
    await backupManager.exportBackup(file, { includeSecrets: true, includeLogs: config.includeLogs })
    const bytes = await fsp.readFile(file); return { directory, bytes, artifactHash: sha256(bytes), localHash: stableBundleHash(bytes) }
  }
  async function put(config, key, bytes, type) {
    const response = await signedFetch(config, 'PUT', key, bytes, type)
    if (!response.ok) throw new Error(`S3 上传失败 (${key})：HTTP ${response.status}`)
    return response.headers.get('etag') || ''
  }
  async function fetchManifest(config) {
    const key = `${remotePrefix(config)}/manifest.json`; const response = await signedFetch(config, 'GET', key)
    if (response.status === 404) return null
    if (!response.ok) throw new Error(`读取 S3 manifest 失败：HTTP ${response.status}`)
    const bytes = await responseBytes(response, 1024 * 1024)
    let manifest; try { manifest = JSON.parse(bytes.toString('utf8')) } catch { throw new Error('S3 manifest 不是有效 JSON') }
    if (manifest.protocolVersion !== PROTOCOL_VERSION || manifest.dataVersion !== DATA_VERSION) throw new Error('远端 S3 快照版本不兼容')
    return { manifest, bytes, etag: response.headers.get('etag') || '' }
  }
  async function fetchRemoteInfo() {
    const config = getConfig(); const remote = await fetchManifest(config)
    if (!remote) return null
    return { deviceName: remote.manifest.deviceName, createdAt: remote.manifest.createdAt, snapshotId: remote.manifest.snapshotId, version: remote.manifest.version, protocolVersion: remote.manifest.protocolVersion, dataVersion: remote.manifest.dataVersion, compatible: true, artifacts: Object.keys(remote.manifest.artifacts || {}), remotePath: `${config.bucket}/${remotePrefix(config)}`, etag: remote.etag }
  }
  async function upload(options = {}) {
    const config = getConfig(); emit({ state: 'uploading', message: '正在上传 S3 快照…', direction: 'upload' })
    const bundle = await createBundle(config)
    try {
      const prefix = remotePrefix(config); const artifactKey = `${prefix}/backup.json`
      await put(config, artifactKey, bundle.bytes, 'application/json')
      const manifest = { version: 1, protocolVersion: PROTOCOL_VERSION, dataVersion: DATA_VERSION, snapshotId: crypto.randomUUID(), deviceName: os.hostname(), createdAt: new Date().toISOString(), artifacts: { 'backup.json': { sha256: bundle.artifactHash, size: bundle.bytes.length, contentType: 'application/json' } } }
      const manifestBytes = Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`)
      const etag = await put(config, `${prefix}/manifest.json`, manifestBytes, 'application/json')
      const state = { localHash: bundle.localHash, remoteEtag: etag, lastSyncAt: new Date().toISOString() }; storage.setItem(STATE_KEY, state)
      return emit({ state: 'synced', message: 'S3 快照上传完成', lastSyncAt: state.lastSyncAt, direction: 'upload', snapshotId: manifest.snapshotId })
    } finally { await fsp.rm(bundle.directory, { recursive: true, force: true }) }
  }
  async function download() {
    const config = getConfig(); emit({ state: 'downloading', message: '正在下载 S3 快照…', direction: 'download' })
    const remote = await fetchManifest(config); if (!remote) throw new Error('S3 远端尚无快照')
    const meta = remote.manifest.artifacts?.['backup.json']; if (!meta || Number(meta.size) > MAX_OBJECT_BYTES) throw new Error('S3 manifest 缺少有效 backup.json')
    const response = await signedFetch(config, 'GET', `${remotePrefix(config)}/backup.json`)
    if (!response.ok) throw new Error(`下载 S3 快照失败：HTTP ${response.status}`)
    const bytes = await responseBytes(response); if (bytes.length !== Number(meta.size) || sha256(bytes) !== meta.sha256) throw new Error('S3 快照完整性校验失败')
    const directory = await fsp.mkdtemp(path.join(os.tmpdir(), 'ztools-s3-import-')); const file = path.join(directory, 'backup.json')
    try { await fsp.writeFile(file, bytes, { mode: 0o600 }); await backupManager.importBackup(file) }
    finally { await fsp.rm(directory, { recursive: true, force: true }) }
    const state = { localHash: stableBundleHash(bytes), remoteEtag: remote.etag, lastSyncAt: new Date().toISOString() }; storage.setItem(STATE_KEY, state)
    return emit({ state: 'synced', message: 'S3 快照下载并恢复完成', lastSyncAt: state.lastSyncAt, direction: 'download' })
  }
  async function performSync(options = {}) {
    const config = getConfig(); emit({ state: 'checking', message: '正在比较本地与 S3 快照…' })
    const bundle = await createBundle(config)
    try {
      const remote = await fetchManifest(config); if (!remote) return upload({ force: true })
      const previous = read(STATE_KEY, {}) || {}; const localChanged = !previous.localHash || previous.localHash !== bundle.localHash; const remoteChanged = !previous.remoteEtag || previous.remoteEtag !== remote.etag
      if (!localChanged && !remoteChanged) return emit({ state: 'synced', message: '本地与 S3 已同步', lastSyncAt: previous.lastSyncAt || null })
      if (localChanged && remoteChanged) {
        const strategy = options.strategy || config.conflictStrategy
        if (strategy === 'local') return upload({ force: true })
        if (strategy === 'remote') return download()
        return emit({ state: 'conflict', message: '本地与 S3 均有修改，请选择保留版本', conflict: { localHash: bundle.localHash, remoteEtag: remote.etag } })
      }
      return remoteChanged ? download() : upload({ force: true })
    } finally { await fsp.rm(bundle.directory, { recursive: true, force: true }) }
  }
  function sync(options = {}) { if (activeOperation) return activeOperation; activeOperation = performSync(options).catch((error) => emit({ state: 'error', message: error.message })).finally(() => { activeOperation = null }); return activeOperation }
  function scheduleAutoSync() { if (timer) clearInterval(timer); timer = null; const config = getConfig(); if (!config.enabled || !config.autoSync || !config.hasSecretAccessKey) return; timer = setInterval(() => sync().catch(() => {}), config.intervalMinutes * 60 * 1000); timer.unref?.() }
  scheduleAutoSync()
  return { getConfig, saveConfig, getStatus: () => ({ ...status }), subscribe, checkConnection, fetchRemoteInfo, upload, download, sync, scheduleAutoSync }
}

module.exports = { CONFIG_KEY, SECRET_KEY, STATE_KEY, PROTOCOL_VERSION, DATA_VERSION, awsEncode, stableBundleHash, signRequest, createS3SyncManager }
