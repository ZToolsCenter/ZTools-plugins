'use strict'

const crypto = require('node:crypto')
const fs = require('node:fs')
const http = require('node:http')
const https = require('node:https')
const { decryptBytes, decryptJson, deriveVaultKey, encryptBytes, encryptJson, randomId, sha256File } = require('./crypto')
const { safeFilename, validateWebDavUrl } = require('./validation')

const MAX_INDEX_BYTES = 64 * 1024 * 1024
const SYNC_CHUNK_SIZE = 4 * 1024 * 1024

function webDavRequest(baseUrl, credentials, method, relativePath, options = {}) {
  const target = new URL(relativePath, baseUrl)
  const expected = new URL(baseUrl)
  if (target.origin !== expected.origin || !target.pathname.startsWith(expected.pathname)) {
    return Promise.reject(new TypeError('WebDAV 请求越过了配置的同步目录'))
  }
  const transport = target.protocol === 'https:' ? https : http
  const headers = {
    Authorization: `Basic ${Buffer.from(`${credentials.username}:${credentials.password}`).toString('base64')}`,
    'User-Agent': 'ZTools-Device-Link/0.2',
    ...options.headers,
  }
  if (options.body) headers['Content-Length'] = Buffer.byteLength(options.body)

  return new Promise((resolve, reject) => {
    const request = transport.request(target, { method, headers, timeout: 60_000 }, (response) => {
      const chunks = []
      let total = 0
      let exceeded = false
      response.on('data', (chunk) => {
        total += chunk.length
        if (total > (options.maxBytes || MAX_INDEX_BYTES)) {
          exceeded = true
          chunks.length = 0
          response.destroy(new RangeError('WebDAV 响应超过安全上限'))
        } else chunks.push(chunk)
      })
      response.on('end', () => {
        if (!exceeded) resolve({
          status: response.statusCode || 0,
          headers: response.headers,
          body: Buffer.concat(chunks),
        })
      })
      response.on('error', reject)
    })
    request.on('timeout', () => request.destroy(new Error('WebDAV 请求超时')))
    request.on('error', reject)
    if (options.body) request.write(options.body)
    request.end()
  })
}

async function ensureCollection(baseUrl, credentials, relativePath = '') {
  const response = await webDavRequest(baseUrl, credentials, 'MKCOL', relativePath)
  if (![201, 405].includes(response.status)) throw new Error(`WebDAV 创建目录失败（${response.status}）`)
}

function remoteMessage(message) {
  return {
    ...message,
    attachments: (message.attachments || []).map(({ path: _path, ...attachment }) => attachment),
  }
}

function mergeMessages(left, right) {
  const map = new Map()
  for (const message of [...left, ...right]) {
    const current = map.get(message.id)
    if (!current || String(message.updatedAt) > String(current.updatedAt)) map.set(message.id, message)
  }
  return [...map.values()].sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt)))
}

function messageConversationKey(message) {
  return message.conversationId || `legacy:${message.senderId || 'unknown'}`
}

function limitMessagesPerConversation(messages, limit = 1000) {
  const groups = new Map()
  for (const message of [...messages].sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt)))) {
    const key = messageConversationKey(message)
    const group = groups.get(key) || []
    group.push(message)
    groups.set(key, group)
  }
  return [...groups.values()]
    .flatMap((group) => group.slice(-limit))
    .sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt)))
}

function mergeTombstones(left, right) {
  const map = new Map()
  for (const tombstone of [...left, ...right]) {
    if (!tombstone?.id || !tombstone.deletedAt) continue
    const current = map.get(tombstone.id)
    if (!current || String(tombstone.deletedAt) > String(current.deletedAt)) map.set(tombstone.id, tombstone)
  }
  return [...map.values()].sort((a, b) => String(a.deletedAt).localeCompare(String(b.deletedAt)))
}

function applyTombstones(messages, tombstones) {
  const deleted = new Map(tombstones.map((item) => [item.id, item]))
  return messages.filter((message) => !deleted.has(message.id))
}

async function initializeVault(baseUrl, credentials, localSalt) {
  await ensureCollection(baseUrl, credentials)
  await ensureCollection(baseUrl, credentials, 'blobs/')
  const existing = await webDavRequest(baseUrl, credentials, 'GET', 'vault.json', { maxBytes: 64 * 1024 })
  if (existing.status === 200) {
    const manifest = JSON.parse(existing.body.toString('utf8'))
    if (manifest.version !== 1 || typeof manifest.salt !== 'string') throw new Error('WebDAV 中的 Device Link 数据版本不受支持')
    return manifest
  }
  if (existing.status !== 404) throw new Error(`读取 WebDAV 同步信息失败（${existing.status}）`)
  const manifest = { version: 1, salt: localSalt || randomId(16), createdAt: new Date().toISOString() }
  const created = await webDavRequest(baseUrl, credentials, 'PUT', 'vault.json', {
    headers: { 'Content-Type': 'application/json', 'If-None-Match': '*' },
    body: Buffer.from(JSON.stringify(manifest)),
  })
  if (![200, 201, 204, 412].includes(created.status)) throw new Error(`创建 WebDAV 同步信息失败（${created.status}）`)
  if (created.status === 412) return initializeVault(baseUrl, credentials, localSalt)
  return manifest
}

async function readFileChunk(descriptor, position, size) {
  const buffer = Buffer.allocUnsafe(size)
  let offset = 0
  while (offset < size) {
    const { bytesRead } = await descriptor.read(buffer, offset, size - offset, position + offset)
    if (!bytesRead) break
    offset += bytesRead
  }
  return buffer.subarray(0, offset)
}

async function writeFileChunk(descriptor, bytes, position) {
  let offset = 0
  while (offset < bytes.length) {
    const { bytesWritten } = await descriptor.write(bytes, offset, bytes.length - offset, position + offset)
    if (!bytesWritten) throw new Error('写入同步附件失败')
    offset += bytesWritten
  }
}

async function uploadBlob(baseUrl, credentials, key, attachment) {
  if (!attachment.path) return false
  try { await fs.promises.access(attachment.path, fs.constants.R_OK) } catch { return false }
  const stat = await fs.promises.stat(attachment.path)
  if (!stat.isFile() || stat.size !== attachment.size) throw new Error(`附件大小已发生变化：${attachment.name}`)
  const blobId = attachment.sha256 || await sha256File(attachment.path)
  const chunks = Math.ceil(attachment.size / SYNC_CHUNK_SIZE)
  await ensureCollection(baseUrl, credentials, `blobs/${blobId}/`)
  const existingManifest = await webDavRequest(baseUrl, credentials, 'GET', `blobs/${blobId}/manifest.enc`, { maxBytes: 64 * 1024 })
  if (existingManifest.status === 200) {
    let existing
    try {
      existing = decryptJson(key, existingManifest.body.toString('utf8'), `webdav:blob-manifest:${blobId}`)
    } catch {
      throw new Error('WebDAV 现有附件清单无法验证')
    }
    if (existing.version !== 2 || existing.blobId !== blobId || existing.size !== attachment.size ||
        existing.chunkSize !== SYNC_CHUNK_SIZE || existing.chunks !== chunks) {
      throw new Error('WebDAV 现有附件清单与本地文件不一致')
    }
    attachment.sha256 = blobId
    attachment.chunkSize = SYNC_CHUNK_SIZE
    attachment.chunks = chunks
    return true
  }
  if (existingManifest.status !== 404) throw new Error(`读取附件清单失败（${existingManifest.status}）`)
  const descriptor = await fs.promises.open(attachment.path, 'r')
  try {
    for (let index = 0; index < chunks; index += 1) {
      const size = Math.min(SYNC_CHUNK_SIZE, attachment.size - index * SYNC_CHUNK_SIZE)
      const plain = await readFileChunk(descriptor, index * SYNC_CHUNK_SIZE, size)
      if (plain.length !== size) throw new Error(`读取附件分块失败：${attachment.name}`)
      const encrypted = encryptBytes(key, plain, `webdav:blob:${blobId}:${index}`)
      const result = await webDavRequest(baseUrl, credentials, 'PUT', `blobs/${blobId}/${index}.enc`, {
        headers: { 'Content-Type': 'application/octet-stream', 'If-None-Match': '*' },
        body: encrypted,
        maxBytes: 64 * 1024,
      })
      if (![200, 201, 204, 412].includes(result.status)) throw new Error(`上传附件分块失败（${result.status}）`)
    }
  } finally {
    await descriptor.close()
  }
  const manifest = Buffer.from(encryptJson(key, {
    version: 2,
    blobId,
    size: attachment.size,
    chunkSize: SYNC_CHUNK_SIZE,
    chunks,
  }, `webdav:blob-manifest:${blobId}`))
  const completed = await webDavRequest(baseUrl, credentials, 'PUT', `blobs/${blobId}/manifest.enc`, {
    headers: { 'Content-Type': 'application/octet-stream', 'If-None-Match': '*' },
    body: manifest,
    maxBytes: 64 * 1024,
  })
  if (![200, 201, 204, 412].includes(completed.status)) throw new Error(`写入附件清单失败（${completed.status}）`)
  attachment.sha256 = blobId
  attachment.chunkSize = SYNC_CHUNK_SIZE
  attachment.chunks = chunks
  return true
}

async function downloadBlob(baseUrl, credentials, key, repository, attachment) {
  const blobId = attachment.sha256
  if (!blobId) return false
  const manifestResult = await webDavRequest(baseUrl, credentials, 'GET', `blobs/${blobId}/manifest.enc`, { maxBytes: 64 * 1024 })
  if (manifestResult.status === 404) return false
  if (manifestResult.status !== 200) throw new Error(`下载附件清单失败（${manifestResult.status}）`)
  let manifest
  try {
    manifest = decryptJson(key, manifestResult.body.toString('utf8'), `webdav:blob-manifest:${blobId}`)
  } catch {
    throw new Error('WebDAV 附件清单完整性校验失败')
  }
  if (manifest.version !== 2 || manifest.blobId !== blobId || manifest.size !== attachment.size ||
      manifest.chunkSize !== SYNC_CHUNK_SIZE || manifest.chunks !== Math.ceil(attachment.size / SYNC_CHUNK_SIZE)) {
    throw new Error('WebDAV 附件清单与消息索引不一致')
  }

  const temporary = repository.newTransferPath(`webdav-${randomId(12)}`)
  const destination = repository.newAttachmentPath(safeFilename(attachment.name))
  const descriptor = await fs.promises.open(temporary, 'wx')
  const hash = crypto.createHash('sha256')
  let received = 0
  try {
    for (let index = 0; index < manifest.chunks; index += 1) {
      const result = await webDavRequest(baseUrl, credentials, 'GET', `blobs/${blobId}/${index}.enc`, {
        maxBytes: SYNC_CHUNK_SIZE + 64 * 1024,
      })
      if (result.status !== 200) throw new Error(`下载附件分块失败（${result.status}）`)
      let plain
      try {
        plain = decryptBytes(key, result.body, `webdav:blob:${blobId}:${index}`)
      } catch {
        throw new Error('WebDAV 附件分块完整性校验失败')
      }
      const expected = Math.min(SYNC_CHUNK_SIZE, attachment.size - received)
      if (plain.length !== expected) throw new Error('WebDAV 附件分块大小不正确')
      await writeFileChunk(descriptor, plain, received)
      hash.update(plain)
      received += plain.length
    }
    await descriptor.close()
    if (received !== attachment.size || hash.digest('hex') !== blobId) throw new Error('WebDAV 附件完整性校验失败')
    await fs.promises.rename(temporary, destination)
    attachment.path = destination
    attachment.chunkSize = SYNC_CHUNK_SIZE
    attachment.chunks = manifest.chunks
    return true
  } catch (error) {
    try { await descriptor.close() } catch {}
    try { await fs.promises.rm(temporary, { force: true }) } catch {}
    try { await fs.promises.rm(destination, { force: true }) } catch {}
    throw error
  }
}

async function runWebDavSync(input) {
  const baseUrl = validateWebDavUrl(input.baseUrl)
  const credentials = { username: input.username, password: input.password }
  const manifest = await initializeVault(baseUrl, credentials, input.salt)
  const key = deriveVaultKey(input.syncPassword, manifest.salt)
  const local = await input.repository.listMessages(1000, {
    groupBy: messageConversationKey,
  })
  const localTombstones = typeof input.repository.listTombstones === 'function' ? await input.repository.listTombstones() : []
  let uploaded = 0
  let downloaded = 0
  let deleted = 0
  let skippedAttachments = 0

  for (const message of local) {
    let changed = false
    for (const attachment of message.attachments || []) {
      const previousHash = attachment.sha256
      const previousChunkSize = attachment.chunkSize
      const previousChunks = attachment.chunks
      if (await uploadBlob(baseUrl, credentials, key, attachment)) {
        uploaded += 1
        changed ||= previousHash !== attachment.sha256 || previousChunkSize !== attachment.chunkSize || previousChunks !== attachment.chunks
      } else if (attachment.path) skippedAttachments += 1
    }
    if (changed) await input.repository.putMessage(message)
  }

  const remoteResult = await webDavRequest(baseUrl, credentials, 'GET', 'index.enc')
  let remoteMessages = []
  let remoteTombstones = []
  let etag = null
  if (remoteResult.status === 200) {
    const remoteIndex = decryptJson(key, remoteResult.body.toString('utf8'), 'webdav:index:v1')
    remoteMessages = remoteIndex.messages || []
    remoteTombstones = remoteIndex.tombstones || []
    etag = remoteResult.headers.etag || null
  } else if (remoteResult.status !== 404) {
    throw new Error(`读取 WebDAV 消息索引失败（${remoteResult.status}）`)
  }

  const tombstones = mergeTombstones(localTombstones, remoteTombstones)
  const merged = limitMessagesPerConversation(applyTombstones(mergeMessages(local.map(remoteMessage), remoteMessages), tombstones))
  const mergedIds = new Set(merged.map((message) => message.id))
  const localMessagesById = new Map(local.map((message) => [message.id, message]))
  const localTombstoneMap = new Map(localTombstones.map((tombstone) => [tombstone.id, tombstone]))
  for (const tombstone of tombstones) {
    const current = localTombstoneMap.get(tombstone.id)
    if (!current || String(current.deletedAt) < String(tombstone.deletedAt)) {
      await input.repository.removeMessage(tombstone.id, { removeOwnedAttachments: true })
      if (typeof input.repository.putTombstone === 'function') await input.repository.putTombstone(tombstone)
      deleted += 1
    }
  }
  for (const message of local) {
    if (!mergedIds.has(message.id)) await input.repository.removeMessage(message.id, { removeOwnedAttachments: true })
  }
  for (const message of merged) {
    const localMessage = localMessagesById.get(message.id)
    if (!localMessage || String(message.updatedAt) > String(localMessage.updatedAt)) {
      for (const attachment of message.attachments || []) {
        if (await downloadBlob(baseUrl, credentials, key, input.repository, attachment)) downloaded += 1
        else if (attachment.sha256) skippedAttachments += 1
      }
      await input.repository.putMessage({ ...message, status: 'synced' })
      downloaded += 1
    }
  }

  const encryptedIndex = Buffer.from(encryptJson(key, {
    version: 2,
    updatedAt: new Date().toISOString(),
    messages: merged.map(remoteMessage),
    tombstones,
  }, 'webdav:index:v1'))
  const put = await webDavRequest(baseUrl, credentials, 'PUT', 'index.enc', {
    headers: {
      'Content-Type': 'application/octet-stream',
      ...(etag ? { 'If-Match': etag } : { 'If-None-Match': '*' }),
    },
    body: encryptedIndex,
  })
  if (put.status === 412) throw new Error('WebDAV 同步发生并发冲突，请立即重试')
  if (![200, 201, 204].includes(put.status)) throw new Error(`写入 WebDAV 消息索引失败（${put.status}）`)

  return { status: 'success', uploaded, downloaded, deleted, skippedAttachments, salt: manifest.salt }
}

module.exports = {
  SYNC_CHUNK_SIZE,
  applyTombstones,
  limitMessagesPerConversation,
  mergeMessages,
  mergeTombstones,
  runWebDavSync,
  webDavRequest,
}
