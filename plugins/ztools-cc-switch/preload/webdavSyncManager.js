'use strict'

const fsp = require('node:fs/promises')
const path = require('node:path')
const os = require('node:os')
const crypto = require('node:crypto')
const { requireSecureHttpUrl } = require('./networkSecurity')

const CONFIG_KEY = 'cc-switch:webdav-config-v1'
const SECRET_KEY = 'cc-switch:webdav-secret-v1'
const STATE_KEY = 'cc-switch:webdav-state-v1'
const MAX_BACKUP_BYTES = 100 * 1024 * 1024
function stableBackupHash(bytes) {
  try { const value = JSON.parse(Buffer.from(bytes).toString('utf8')); return crypto.createHash('sha256').update(JSON.stringify({ format: value.format, version: value.version, files: value.files })).digest('hex') }
  catch { return crypto.createHash('sha256').update(bytes).digest('hex') }
}

function createMemoryStorage() {
  const values = new Map()
  return { getItem: (key) => values.get(key), setItem: (key, value) => values.set(key, value), removeItem: (key) => values.delete(key) }
}

function normalizeRemotePath(value) {
  const result = String(value || 'ai-provider-switch/backup.json').trim().replace(/^\/+/, '')
  if (!result || result.split('/').some((part) => !part || part === '.' || part === '..')) throw new Error('WebDAV 远端路径无效')
  return result.endsWith('.json') ? result : `${result.replace(/\/+$/, '')}/backup.json`
}

function createWebdavSyncManager(options = {}) {
  const backupManager = options.backupManager
  const storage = options.storage || createMemoryStorage()
  const secretCodec = options.secretCodec || { secure: false, encode: (value) => Buffer.from(value).toString('base64'), decode: (value) => Buffer.from(value, 'base64').toString('utf8') }
  const fetchImpl = options.fetchImpl || fetch
  const requestTimeoutMs = Math.min(Math.max(Number(options.requestTimeoutMs) || 30_000, 100), 120_000)
  const listeners = new Set()
  let syncing = null
  let timer = null
  let status = { state: 'idle', message: '尚未同步', lastSyncAt: null, direction: null }

  function emit(patch) {
    status = { ...status, ...patch }
    for (const listener of listeners) { try { listener({ ...status }) } catch {} }
    return { ...status }
  }
  function subscribe(listener) { if (typeof listener !== 'function') return () => {}; listeners.add(listener); listener({ ...status }); return () => listeners.delete(listener) }
  function readValue(key, fallback) { const value = storage.getItem(key); return value === undefined || value === null ? fallback : value }
  function getConfig() {
    const stored = readValue(CONFIG_KEY, {}) || {}
    return {
      url: String(stored.url || ''), username: String(stored.username || ''), remotePath: normalizeRemotePath(stored.remotePath || 'ai-provider-switch/backup.json'),
      autoSync: Boolean(stored.autoSync), intervalMinutes: Math.min(Math.max(Number(stored.intervalMinutes) || 30, 5), 1440),
      conflictStrategy: ['ask', 'local', 'remote', 'newest'].includes(stored.conflictStrategy) ? stored.conflictStrategy : 'ask',
      includeLogs: stored.includeLogs !== false, hasPassword: Boolean(readValue(SECRET_KEY, '')), secureStorage: Boolean(secretCodec.secure)
    }
  }
  function password() { const encoded = readValue(SECRET_KEY, ''); return encoded ? secretCodec.decode(encoded) : '' }
  async function request(url, init = {}) {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), requestTimeoutMs)
    try { return await fetchImpl(url, { ...init, signal: controller.signal }) }
    catch (error) { if (controller.signal.aborted) throw new Error('WebDAV 请求超时'); throw error }
    finally { clearTimeout(timer) }
  }
  function validateConfig(config) {
    requireSecureHttpUrl(config.url, 'WebDAV URL')
    if (!config.username) throw new Error('WebDAV 用户名不能为空')
    if (!password()) throw new Error('WebDAV 密码尚未保存')
  }
  async function responseBytes(response, maxBytes = MAX_BACKUP_BYTES) {
    const declared = Number(response.headers?.get?.('content-length') || 0)
    if (declared > maxBytes) {
      await response.body?.cancel?.().catch(() => {})
      throw new Error('WebDAV 备份超过 100 MB 安全限制')
    }
    if (!response.body) return Buffer.alloc(0)
    const chunks = []; let size = 0
    const reader = response.body.getReader()
    try {
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        size += value.byteLength
        if (size > maxBytes) {
          await reader.cancel().catch(() => {})
          throw new Error('WebDAV 备份超过 100 MB 安全限制')
        }
        chunks.push(Buffer.from(value))
      }
    } finally { reader.releaseLock() }
    return Buffer.concat(chunks)
  }
  async function saveConfig(patch = {}) {
    const current = getConfig()
    const next = { ...current, ...patch, remotePath: normalizeRemotePath(patch.remotePath || current.remotePath) }
    delete next.hasPassword; delete next.secureStorage; delete next.password
    storage.setItem(CONFIG_KEY, next)
    if (typeof patch.password === 'string' && patch.password) storage.setItem(SECRET_KEY, secretCodec.encode(patch.password))
    if (patch.clearPassword) storage.removeItem(SECRET_KEY)
    scheduleAutoSync()
    return getConfig()
  }
  function authHeaders(config) { return { Authorization: `Basic ${Buffer.from(`${config.username}:${password()}`).toString('base64')}`, 'User-Agent': 'ztools-cc-switch/1.2' } }
  function remoteUrl(config) { const base = new URL(config.url); base.pathname = `${base.pathname.replace(/\/+$/, '')}/${config.remotePath}`; return base }
  async function ensureCollections(config) {
    const base = new URL(config.url); const parts = config.remotePath.split('/').slice(0, -1); let current = base.pathname.replace(/\/+$/, '')
    for (const part of parts) {
      current += `/${encodeURIComponent(part)}`; const url = new URL(base); url.pathname = current
      const response = await request(url, { method: 'MKCOL', headers: authHeaders(config), redirect: 'error' })
      if (![201, 405, 301, 302].includes(response.status) && !response.ok) throw new Error(`创建 WebDAV 目录失败：HTTP ${response.status}`)
    }
  }
  async function remoteInfo(config) {
    const response = await request(remoteUrl(config), { method: 'HEAD', headers: authHeaders(config), redirect: 'error' })
    if (response.status === 404) return { exists: false, etag: '', modifiedAt: 0 }
    if (!response.ok) throw new Error(`读取 WebDAV 元数据失败：HTTP ${response.status}`)
    return { exists: true, etag: response.headers.get('etag') || '', modifiedAt: Date.parse(response.headers.get('last-modified') || '') || 0 }
  }
  async function createLocalBundle(config) {
    const directory = await fsp.mkdtemp(path.join(os.tmpdir(), 'ztools-webdav-')); const file = path.join(directory, 'backup.json')
    await backupManager.exportBackup(file, { includeSecrets: true, includeLogs: config.includeLogs })
    const bytes = await fsp.readFile(file); return { directory, file, bytes, hash: stableBackupHash(bytes) }
  }
  async function upload(options = {}) {
    const config = getConfig(); validateConfig(config); emit({ state: 'uploading', message: '正在上传 WebDAV 备份…', direction: 'upload' })
    const bundle = await createLocalBundle(config)
    try {
      await ensureCollections(config); const headers = { ...authHeaders(config), 'Content-Type': 'application/json' }
      if (options.expectedEtag && !options.force) headers['If-Match'] = options.expectedEtag
      const response = await request(remoteUrl(config), { method: 'PUT', headers, body: bundle.bytes, redirect: 'error' })
      if (response.status === 412) throw Object.assign(new Error('远端备份已变化，请先处理同步冲突'), { code: 'CONFLICT' })
      if (!response.ok) throw new Error(`WebDAV 上传失败：HTTP ${response.status}`)
      const info = await remoteInfo(config); const state = { etag: info.etag, localHash: bundle.hash, lastSyncAt: new Date().toISOString() }; storage.setItem(STATE_KEY, state)
      return emit({ state: 'synced', message: 'WebDAV 上传完成', lastSyncAt: state.lastSyncAt, direction: 'upload' })
    } finally { await fsp.rm(bundle.directory, { recursive: true, force: true }) }
  }
  async function download() {
    const config = getConfig(); validateConfig(config); emit({ state: 'downloading', message: '正在下载 WebDAV 备份…', direction: 'download' })
    const response = await request(remoteUrl(config), { method: 'GET', headers: authHeaders(config), redirect: 'error' })
    if (response.status === 404) throw new Error('远端尚无备份')
    if (!response.ok) throw new Error(`WebDAV 下载失败：HTTP ${response.status}`)
    const bytes = await responseBytes(response); const directory = await fsp.mkdtemp(path.join(os.tmpdir(), 'ztools-webdav-import-')); const file = path.join(directory, 'backup.json')
    try {
      await fsp.writeFile(file, bytes, { mode: 0o600 }); await backupManager.importBackup(file)
      const info = await remoteInfo(config); const state = { etag: info.etag, localHash: stableBackupHash(bytes), lastSyncAt: new Date().toISOString() }; storage.setItem(STATE_KEY, state)
      return emit({ state: 'synced', message: 'WebDAV 下载并恢复完成', lastSyncAt: state.lastSyncAt, direction: 'download' })
    } finally { await fsp.rm(directory, { recursive: true, force: true }) }
  }
  async function performSync(options = {}) {
    const config = getConfig(); validateConfig(config); emit({ state: 'checking', message: '正在比较本地与 WebDAV…' })
    const bundle = await createLocalBundle(config)
    try {
      const remote = await remoteInfo(config); const previous = readValue(STATE_KEY, {}) || {}
      if (!remote.exists) return upload({ force: true })
      const localChanged = !previous.localHash || previous.localHash !== bundle.hash
      const remoteChanged = !previous.etag || previous.etag !== remote.etag
      if (!localChanged && !remoteChanged) return emit({ state: 'synced', message: '本地与 WebDAV 已同步', lastSyncAt: previous.lastSyncAt || null })
      if (localChanged && remoteChanged) {
        const strategy = options.strategy || config.conflictStrategy
        if (strategy === 'local') return upload({ force: true })
        if (strategy === 'remote') return download()
        if (strategy === 'newest') {
          const localModified = Date.now()
          return remote.modifiedAt > localModified ? download() : upload({ force: true })
        }
        return emit({ state: 'conflict', message: '本地与远端均有修改，请选择保留版本', conflict: { localHash: bundle.hash, remoteEtag: remote.etag } })
      }
      return remoteChanged ? download() : upload({ expectedEtag: remote.etag })
    } finally { await fsp.rm(bundle.directory, { recursive: true, force: true }) }
  }
  function sync(options = {}) {
    if (syncing) return syncing
    syncing = performSync(options).catch((error) => emit({ state: error.code === 'CONFLICT' ? 'conflict' : 'error', message: error.message })).finally(() => { syncing = null })
    return syncing
  }
  function scheduleAutoSync() {
    if (timer) clearInterval(timer); timer = null
    const config = getConfig(); if (!config.autoSync || !config.hasPassword || !config.url) return
    timer = setInterval(() => sync().catch(() => {}), config.intervalMinutes * 60 * 1000); timer.unref?.()
  }
  scheduleAutoSync()
  return { getConfig, saveConfig, getStatus: () => ({ ...status }), subscribe, upload, download, sync, scheduleAutoSync }
}

module.exports = { CONFIG_KEY, SECRET_KEY, STATE_KEY, MAX_BACKUP_BYTES, normalizeRemotePath, stableBackupHash, createMemoryStorage, createWebdavSyncManager }
