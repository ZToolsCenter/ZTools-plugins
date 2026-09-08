'use strict'

const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const crypto = require('node:crypto')
const QRCode = require('qrcode')
const { clipboard, nativeImage, safeStorage, shell, webUtils } = require('electron')
const { saveAttachmentFile } = require('./core/attachment')
const { createCredentialStorage } = require('./core/credential-storage')
const { resolveDroppedFilePaths } = require('./core/drop')
const { detectHostCompatibility, resolveDataDirectories } = require('./core/host-compat')
const { EARLY_KEY_FALLBACK_DIR, preparePluginDataMigration } = require('./core/plugin-data-migration')
const { clearMessageHistory, removeMessageFromHistory } = require('./core/history')
const { createRepository } = require('./core/repository')
const { CHUNK_SIZE, createDeviceLinkServer } = require('./core/server')
const { randomDigits, randomId } = require('./core/crypto')
const {
  cleanDeviceName,
  cleanText,
  detectKind,
  normalizePort,
  safeFilename,
  validatePairingCode,
  validateWebDavUrl,
} = require('./core/validation')
const { runWebDavSync } = require('./core/webdav')

const ztools = window.ztools
const hostCompatibility = detectHostCompatibility(ztools)
if (hostCompatibility.requiresUpgrade) {
  // Keep the preload inert so the renderer can show its upgrade-only view even
  // when an older/invalid host lacks APIs used by the full service layer.
  window.deviceLink = Object.freeze({})
} else {
const resolvedDirectories = resolveDataDirectories(ztools)
const legacyDataDir = resolvedDirectories.legacyDataDir
const migration = preparePluginDataMigration(ztools.db.promises, resolvedDirectories.dataDir, legacyDataDir)
migration.ready.catch((error) => console.error('[device-link] pluginData migration failed', error))
const dataDir = migration.dataDir
fs.mkdirSync(dataDir, { recursive: true })

const repository = createRepository(ztools.db.promises, dataDir, { ready: migration.ready })
let server = null
const SHARED_CONVERSATION_ID = 'shared'

function privateConversationId(deviceId) {
  return `device:${deviceId}`
}

const DEFAULT_SETTINGS = {
  deviceId: '',
  deviceName: os.hostname() || '我的电脑',
  port: 32125,
  pairingCodeMode: 'random',
  customPairingCode: '',
  autoAcceptTrustedText: true,
  autoAcceptTrustedFiles: false,
  maxIncomingFileBytes: 10 * 1024 * 1024 * 1024,
}

const DEFAULT_WEBDAV = {
  enabled: false,
  baseUrl: '',
  username: '',
  password: '',
  syncPassword: '',
  salt: '',
  lastSyncedAt: '',
  status: 'disabled',
}

function emit(type, data) {
  window.dispatchEvent(new CustomEvent('device-link:event', { detail: { type, data } }))
}

function fallbackKey() {
  const nativeId = typeof ztools.getNativeId === 'function' ? ztools.getNativeId() : os.hostname()
  // Keep the original key seed even after moving files to pluginData. Existing
  // local: records live in the ZTools database and must survive both upgrade
  // and downgrade without silently invalidating encrypted credentials.
  return crypto.createHash('sha256').update(`device-link-local:${nativeId}:${legacyDataDir}`).digest()
}

const { seal, unseal } = createCredentialStorage({
  dataDir,
  safeStorage,
  legacyKey: fallbackKey(),
  localKeyDataDir: dataDir,
  fallbackLocalKeyDataDirs: dataDir === legacyDataDir ? [] : [path.join(dataDir, EARLY_KEY_FALLBACK_DIR)],
})

async function getSettingsRecord() {
  const stored = (await repository.getSettings()) || {}
  const settings = { ...DEFAULT_SETTINGS, ...stored }
  if (!Number.isSafeInteger(settings.maxIncomingFileBytes) || settings.maxIncomingFileBytes < 1024 * 1024 || settings.maxIncomingFileBytes > 1024 ** 4) {
    settings.maxIncomingFileBytes = DEFAULT_SETTINGS.maxIncomingFileBytes
  }
  if (!settings.deviceId) {
    settings.deviceId = typeof ztools.getNativeId === 'function' ? ztools.getNativeId() : randomId(16)
    await repository.putSettings(settings)
  }
  return settings
}

async function getWebDavRecord() {
  return { ...DEFAULT_WEBDAV, ...((await repository.getSyncSettings()) || {}) }
}

function publicWebDav(settings) {
  return {
    enabled: Boolean(settings.enabled),
    baseUrl: settings.baseUrl || '',
    username: settings.username || '',
    hasPassword: Boolean(settings.password),
    hasSyncPassword: Boolean(settings.syncPassword),
    lastSyncedAt: settings.lastSyncedAt || undefined,
    status: settings.status || 'disabled',
  }
}

async function publicSettings() {
  const settings = await getSettingsRecord()
  return {
    deviceName: settings.deviceName,
    port: settings.port,
    pairingCodeMode: settings.pairingCodeMode,
    customPairingCodeSet: Boolean(settings.customPairingCode),
    autoAcceptTrustedText: settings.autoAcceptTrustedText,
    autoAcceptTrustedFiles: settings.autoAcceptTrustedFiles,
    maxIncomingFileBytes: settings.maxIncomingFileBytes,
    webdav: publicWebDav(await getWebDavRecord()),
  }
}

async function currentPairingCode(settings) {
  if (settings.pairingCodeMode === 'custom') {
    const code = unseal(settings.customPairingCode)
    if (code) return code
  }
  return randomDigits(6)
}

async function serverStatus() {
  if (!server) {
    return {
      running: false,
      port: (await getSettingsRecord()).port,
      lanIPs: [],
      selectedIP: '',
      accessUrl: '',
      pairingUrl: '',
      pairingCode: '',
      pairingExpiresAt: '',
      qrDataUrl: '',
    }
  }
  // QR generation is asynchronous. If another device pairs while it is running,
  // retry with the newest state so an older QR can never overwrite the UI.
  while (server) {
    const currentServer = server
    const pairing = currentServer.pairing
    const base = currentServer.status
    const pairingUrl = `${base.accessUrl}/?pairing=${encodeURIComponent(pairing.sessionId)}#pair=${encodeURIComponent(pairing.secret)}&code=${encodeURIComponent(pairing.qrCode)}&auto=1`
    const qrDataUrl = await QRCode.toDataURL(pairingUrl, { width: 360, margin: 1, errorCorrectionLevel: 'M' })
    if (server !== currentServer || currentServer.pairing.sessionId !== pairing.sessionId) continue
    return {
      ...base,
      pairingUrl,
      pairingCode: pairing.code,
      pairingExpiresAt: new Date(pairing.expiresAt).toISOString(),
      qrDataUrl,
    }
  }
  return serverStatus()
}

async function startServer() {
  if (server) return serverStatus()
  const settings = await getSettingsRecord()
  server = await createDeviceLinkServer({
    repository,
    deviceId: settings.deviceId,
    deviceName: settings.deviceName,
    port: settings.port,
    pairingCode: await currentPairingCode(settings),
    maxIncomingFileBytes: settings.maxIncomingFileBytes,
    onEvent: emit,
    async onPairingExpired() {
      return currentPairingCode(await getSettingsRecord())
    },
    onPairingChanged() {
      void serverStatus().then((status) => emit('server:changed', status)).catch(() => {})
    },
    onError(error, context) {
      console.error('[device-link] service request failed', {
        ...context,
        name: error?.name || 'Error',
        message: error?.message || String(error),
        stack: error?.stack || '',
      })
    },
    protectCredential: seal,
    unprotectCredential: unseal,
  })
  const status = await serverStatus()
  emit('server:changed', status)
  return status
}

async function stopServer() {
  if (server) await server.close()
  server = null
  const status = await serverStatus()
  emit('server:changed', status)
  return status
}

async function regeneratePairingCode() {
  if (!server) return startServer()
  const settings = await getSettingsRecord()
  server.regeneratePairing(await currentPairingCode(settings))
  const status = await serverStatus()
  emit('server:changed', status)
  return status
}

async function validateConversationId(conversationId) {
  const value = String(conversationId || '')
  if (value === SHARED_CONVERSATION_ID) return value
  if (!value.startsWith('device:')) throw new TypeError('请选择要发送到的会话')
  const targetDeviceId = value.slice('device:'.length)
  if (!(await repository.listDevices()).some((device) => device.id === targetDeviceId)) throw new TypeError('目标设备不存在或授权已撤销')
  return value
}

function newMessageBase(settings, kind, conversationId) {
  const now = new Date().toISOString()
  return {
    id: randomId(18),
    senderId: settings.deviceId,
    senderName: settings.deviceName,
    conversationId,
    direction: 'outgoing',
    kind,
    attachments: [],
    createdAt: now,
    updatedAt: now,
    status: 'sent',
  }
}

async function publishDesktopMessage(message) {
  if (!server) await startServer()
  return server.publishMessage(message, message.conversationId)
}

async function desktopMessages() {
  const settings = await getSettingsRecord()
  return (await repository.listMessages(1000, {
    groupBy: (message) => message.conversationId || (message.senderId === settings.deviceId ? SHARED_CONVERSATION_ID : privateConversationId(message.senderId)),
  })).map((message) => ({
    ...message,
    conversationId: message.conversationId || (message.senderId === settings.deviceId ? SHARED_CONVERSATION_ID : privateConversationId(message.senderId)),
    direction: message.senderId === settings.deviceId ? 'outgoing' : 'incoming',
  }))
}

function mimeFor(filePath) {
  const ext = path.extname(filePath).toLowerCase()
  const known = {
    '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp', '.svg': 'image/svg+xml',
    '.pdf': 'application/pdf', '.zip': 'application/zip', '.json': 'application/json', '.md': 'text/markdown', '.txt': 'text/plain',
    '.mp4': 'video/mp4', '.mov': 'video/quicktime', '.mp3': 'audio/mpeg', '.wav': 'audio/wav',
  }
  return known[ext] || 'application/octet-stream'
}

function collectFiles(paths, maxFiles = 1000) {
  const files = []
  const visit = (candidate) => {
    if (files.length >= maxFiles) throw new RangeError(`单次最多发送 ${maxFiles} 个文件`)
    const stat = fs.lstatSync(candidate)
    if (stat.isSymbolicLink()) return
    if (stat.isDirectory()) {
      for (const child of fs.readdirSync(candidate)) visit(path.join(candidate, child))
    } else if (stat.isFile()) {
      files.push({ path: candidate, stat })
    }
  }
  for (const candidate of paths) visit(candidate)
  return files
}

async function sendFiles(paths, requestedConversationId) {
  if (!Array.isArray(paths) || paths.length === 0) throw new TypeError('请选择要发送的文件')
  const settings = await getSettingsRecord()
  const conversationId = await validateConversationId(requestedConversationId)
  const files = collectFiles(paths.map(String))
  if (files.length === 0) throw new TypeError('没有可发送的普通文件')
  const message = newMessageBase(settings, files.every(({ path: filePath }) => mimeFor(filePath).startsWith('image/')) ? 'image' : 'file', conversationId)
  message.attachments = files.map(({ path: filePath, stat }) => ({
    id: randomId(18),
    name: safeFilename(path.basename(filePath)),
    size: stat.size,
    mime: mimeFor(filePath),
    path: filePath,
    chunkSize: CHUNK_SIZE,
    chunks: Math.ceil(stat.size / CHUNK_SIZE),
  }))
  return publishDesktopMessage(message)
}

async function sendImage(dataUrl, conversationId) {
  const match = /^data:image\/([a-z0-9.+-]{1,30});base64,([a-z0-9+/=]+)$/i.exec(String(dataUrl || ''))
  if (!match) throw new TypeError('图片数据格式无效')
  const bytes = Buffer.from(match[2], 'base64')
  if (bytes.length > 32 * 1024 * 1024) throw new RangeError('剪贴板图片不能超过 32 MiB')
  const extension = match[1] === 'jpeg' ? 'jpg' : match[1].replace(/[^a-z0-9]/gi, '')
  const destination = repository.newAttachmentPath(`clipboard-${Date.now()}.${extension}`)
  fs.writeFileSync(destination, bytes, { flag: 'wx' })
  try {
    return await sendFiles([destination], conversationId)
  } catch (error) {
    try { fs.rmSync(destination, { force: true }) } catch {}
    throw error
  }
}

async function sendText(text, requestedConversationId) {
  const content = cleanText(text)
  const settings = await getSettingsRecord()
  const conversationId = await validateConversationId(requestedConversationId)
  const message = { ...newMessageBase(settings, detectKind(content), conversationId), text: content }
  return publishDesktopMessage(message)
}

async function localAttachment(messageId, attachmentId) {
  const message = await repository.getMessage(messageId)
  return message?.attachments?.find((item) => item.id === attachmentId) || null
}

window.deviceLink = {
  async getState() {
    const running = await startServer()
    const connected = new Set(server?.connectedDevices() || [])
    const devices = (await repository.listDevices()).map(({ resumeCredential: _resumeCredential, ...device }) => ({ ...device, connected: connected.has(device.id) }))
    return {
      settings: await publicSettings(),
      server: running,
      devices,
      messages: await desktopMessages(),
    }
  },
  startServer,
  stopServer,
  regeneratePairingCode,
  async saveSettings(input) {
    const current = await getSettingsRecord()
    const requestedFileLimit = Number(input.maxIncomingFileBytes)
    if (!Number.isSafeInteger(requestedFileLimit) || requestedFileLimit < 1024 * 1024) throw new TypeError('文件接收上限无效')
    const next = {
      ...current,
      deviceName: cleanDeviceName(input.deviceName),
      port: normalizePort(input.port),
      pairingCodeMode: input.pairingCodeMode === 'custom' ? 'custom' : 'random',
      autoAcceptTrustedText: Boolean(input.autoAcceptTrustedText),
      autoAcceptTrustedFiles: Boolean(input.autoAcceptTrustedFiles),
      maxIncomingFileBytes: Math.min(requestedFileLimit, 1024 * 1024 * 1024 * 1024),
    }
    if (input.customPairingCode) next.customPairingCode = seal(validatePairingCode(input.customPairingCode))
    if (next.pairingCodeMode === 'custom' && !next.customPairingCode) throw new TypeError('请设置自定义匹配码')
    const restart = server && (next.port !== current.port || next.deviceName !== current.deviceName || next.maxIncomingFileBytes !== current.maxIncomingFileBytes)
    await repository.putSettings(next)
    if (restart) {
      await stopServer()
      await startServer()
    } else if (server) {
      server.updatePairingCode(await currentPairingCode(next))
      emit('server:changed', await serverStatus())
    }
    return publicSettings()
  },
  async saveWebDavSettings(input) {
    const current = await getWebDavRecord()
    const next = {
      ...current,
      enabled: Boolean(input.enabled),
      baseUrl: input.baseUrl ? validateWebDavUrl(input.baseUrl) : '',
      username: String(input.username || '').trim(),
      status: input.enabled ? 'ready' : 'disabled',
    }
    if (input.password) next.password = seal(input.password)
    if (input.syncPassword) next.syncPassword = seal(input.syncPassword)
    if (next.enabled && (!next.baseUrl || !next.username || !next.password || !next.syncPassword)) throw new TypeError('启用 WebDAV 前请完整填写地址、用户名、密码和同步密码')
    await repository.putSyncSettings(next)
    return publicWebDav(next)
  },
  async syncWebDav() {
    const settings = await getWebDavRecord()
    if (!settings.enabled) throw new Error('请先启用 WebDAV 同步')
    await repository.putSyncSettings({ ...settings, status: 'syncing' })
    emit('sync:changed', { status: 'syncing' })
    try {
      const result = await runWebDavSync({
        repository,
        baseUrl: settings.baseUrl,
        username: settings.username,
        password: unseal(settings.password),
        syncPassword: unseal(settings.syncPassword),
        salt: settings.salt,
      })
      const completed = { ...settings, salt: result.salt, status: 'success', lastSyncedAt: new Date().toISOString() }
      await repository.putSyncSettings(completed)
      emit('sync:changed', publicWebDav(completed))
      emit('messages:changed', await desktopMessages())
      return result
    } catch (error) {
      await repository.putSyncSettings({ ...settings, status: 'failed' })
      emit('sync:changed', { status: 'failed', error: error.message })
      throw error
    }
  },
  sendText,
  sendFiles,
  sendImage,
  sendDroppedFiles(files, conversationId) {
    const getPathForFile = typeof webUtils?.getPathForFile === 'function' ? (file) => webUtils.getPathForFile(file) : undefined
    return sendFiles(resolveDroppedFilePaths(files, getPathForFile), conversationId)
  },
  async selectFiles() {
    const result = ztools.showOpenDialog({ title: '选择要发送的文件或文件夹', properties: ['openFile', 'openDirectory', 'multiSelections'] })
    return Array.isArray(result) ? result : []
  },
  async copyMessage(messageId) {
    const message = (await repository.listMessages(Number.MAX_SAFE_INTEGER)).find((item) => item.id === messageId)
    if (!message) return false
    if (message.text) clipboard.writeText(message.text)
    else if (message.attachments?.[0]?.path) {
      const attachment = message.attachments[0]
      if (attachment.mime.startsWith('image/')) clipboard.writeImage(nativeImage.createFromPath(attachment.path))
      else ztools.copyFile(attachment.path)
    } else return false
    return true
  },
  async openAttachment(messageId, attachmentId) {
    const attachment = await localAttachment(messageId, attachmentId)
    if (!attachment?.path || !fs.existsSync(attachment.path)) return false
    await shell.openPath(attachment.path)
    return true
  },
  async saveAttachment(messageId, attachmentId) {
    return saveAttachmentFile(await localAttachment(messageId, attachmentId), ztools)
  },
  async deleteMessage(messageId) {
    const message = (await repository.listMessages(Number.MAX_SAFE_INTEGER)).find((item) => item.id === messageId)
    if (!message) return false
    const settings = await getSettingsRecord()
    await removeMessageFromHistory(repository, message, settings.deviceId, new Date().toISOString())
    emit('message:deleted', { id: messageId })
    return true
  },
  async clearHistory() {
    const settings = await getSettingsRecord()
    const result = await clearMessageHistory(repository, settings.deviceId)
    emit('messages:changed', [])
    return result
  },
  async disconnectDevice(deviceId) {
    if (server) return Boolean(await server.revokeDeviceAuthorization(deviceId))
    const removed = await repository.removeDevice(deviceId)
    if (removed) emit('device:deleted', { id: deviceId })
    return Boolean(removed)
  },
  subscribe(callback) {
    const listener = (event) => callback(event.detail)
    window.addEventListener('device-link:event', listener)
    return () => window.removeEventListener('device-link:event', listener)
  },
}
}
