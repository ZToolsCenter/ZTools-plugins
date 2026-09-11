'use strict'

const crypto = require('node:crypto')
const fs = require('node:fs')
const http = require('node:http')
const os = require('node:os')
const path = require('node:path')
const { WebSocketServer, WebSocket } = require('ws')
const {
  decryptBytes,
  decryptJson,
  derivePairKey,
  encryptBytes,
  encryptJson,
  pairingProof,
  randomId,
  resumeProof,
  secureEqual,
} = require('./crypto')
const { cleanDeviceName, cleanText, detectKind, isPrivateAddress, safeFilename } = require('./validation')

const PAIRING_TTL_MS = 30 * 60 * 1000
const SESSION_TTL_MS = 24 * 60 * 60 * 1000
const RESUME_CHALLENGE_TTL_MS = 2 * 60 * 1000
const TRANSFER_TTL_MS = 30 * 60 * 1000
const LOCKOUT_MS = 10 * 60 * 1000
const MAX_PAIR_ATTEMPTS = 5
const MAX_SESSIONS = 128
const MAX_RESUME_CHALLENGES = 256
const MAX_ACTIVE_TRANSFERS = 16
const MAX_ACTIVE_TRANSFERS_PER_SESSION = 4
const JSON_BODY_LIMIT = 256 * 1024
const CHUNK_SIZE = 4 * 1024 * 1024
const SHARED_CONVERSATION_ID = 'shared'

class HttpError extends Error {
  constructor(status, message, extra = {}, cause) {
    super(message)
    this.status = status
    this.extra = extra
    if (cause) this.cause = cause
  }
}

function getLanIPs() {
  const values = []
  for (const interfaces of Object.values(os.networkInterfaces())) {
    for (const info of interfaces || []) {
      if (info.family === 'IPv4' && !info.internal && isPrivateAddress(info.address)) values.push(info.address)
    }
  }
  return [...new Set(values)].sort((a, b) => Number(!a.startsWith('192.168.')) - Number(!b.startsWith('192.168.')))
}

function bearerToken(request) {
  const header = String(request.headers.authorization || '')
  return header.startsWith('Bearer ') ? header.slice(7) : ''
}

function messageView(message, desktopDeviceId = '') {
  return {
    ...message,
    ...(desktopDeviceId ? { conversationId: messageConversationId(message, desktopDeviceId) } : {}),
    attachments: (message.attachments || []).map(({ path: _path, ...attachment }) => attachment),
  }
}

function privateConversationId(deviceId) {
  return `device:${deviceId}`
}

function messageConversationId(message, desktopDeviceId) {
  if (message?.conversationId === SHARED_CONVERSATION_ID || String(message?.conversationId || '').startsWith('device:')) {
    return message.conversationId
  }
  // Messages created before multi-conversation support were broadcast when sent
  // by the desktop, while incoming messages only belong to their sender.
  return message?.senderId === desktopDeviceId ? SHARED_CONVERSATION_ID : privateConversationId(message?.senderId || '')
}

function createPairingState(pairingCode, ttlMs = PAIRING_TTL_MS) {
  return {
    secret: randomId(32),
    manualKey: randomId(32),
    code: pairingCode,
    // QR links carry this one-generation-only value. Keep the human-entered
    // pairing code separate so a QR proof cannot be replayed as a manual
    // proof (or vice versa).
    qrCode: String(crypto.randomInt(0, 10 ** 12)).padStart(12, '0'),
    sessionId: randomId(16),
    salt: randomId(16),
    challenge: randomId(24),
    expiresAt: Date.now() + ttlMs,
    claimed: false,
  }
}

function readBody(request, maxBytes) {
  return new Promise((resolve, reject) => {
    const chunks = []
    let total = 0
    let tooLarge = false
    request.on('data', (chunk) => {
      total += chunk.length
      if (total > maxBytes) {
        tooLarge = true
        chunks.length = 0
      } else if (!tooLarge) chunks.push(chunk)
    })
    request.on('end', () => {
      if (tooLarge) reject(new HttpError(413, '请求内容超过安全上限'))
      else resolve(Buffer.concat(chunks))
    })
    request.on('aborted', () => reject(new HttpError(400, '请求已中断')))
    request.on('error', reject)
  })
}

async function readJson(request) {
  const contentType = String(request.headers['content-type'] || '').split(';')[0]
  if (contentType !== 'application/json') throw new HttpError(415, '请求必须使用 application/json')
  const body = await readBody(request, JSON_BODY_LIMIT)
  try {
    return body.length ? JSON.parse(body.toString('utf8')) : {}
  } catch {
    throw new HttpError(400, 'JSON 请求格式无效')
  }
}

function sendJson(response, status, value) {
  const body = Buffer.from(JSON.stringify(value))
  response.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': body.length,
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
  })
  response.end(body)
}

function mobileSecurityHeaders(html) {
  const scripts = [...html.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/gi)]
    .map((match) => `'sha256-${crypto.createHash('sha256').update(match[1]).digest('base64')}'`)
    .join(' ')
  return {
    'Content-Security-Policy': `default-src 'none'; script-src 'self'${scripts ? ` ${scripts}` : ''}; style-src 'unsafe-inline'; img-src 'self' data:; connect-src 'self' ws: wss:; font-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'`,
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    'Referrer-Policy': 'no-referrer',
    'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
    'Cache-Control': 'no-store',
  }
}

async function createDeviceLinkServer(options) {
  const {
    repository,
    deviceId,
    deviceName,
    port,
    pairingCode,
    maxIncomingFileBytes,
    onEvent,
    onError = () => {},
    onPairingChanged = () => {},
    onPairingExpired = async (currentCode) => currentCode,
    pairingTtlMs = PAIRING_TTL_MS,
    transferTtlMs = TRANSFER_TTL_MS,
    protectCredential = (value) => value,
    unprotectCredential = (value) => value,
  } = options
  const sessions = new Map()
  const attempts = new Map()
  const resumeChallenges = new Map()
  const transfers = new Map()
  let pairing = createPairingState(pairingCode, pairingTtlMs)
  let status = null
  let closing = false
  let pairingExpiryTimer = null
  let pairingRefreshPromise = null
  let activePairingMutation = null
  let closePromise = null
  const deviceCredentialMutations = new Map()

  const webRoot = path.join(__dirname, '..', '..', 'web')
  const mobileHtml = await fs.promises.readFile(path.join(webRoot, 'index.html'))
  const fallbackCryptoScript = await fs.promises.readFile(path.join(webRoot, 'crypto-fallback.js'))
  const mobileAppScript = await fs.promises.readFile(path.join(webRoot, 'app.js'))
  const securityHeaders = mobileSecurityHeaders(mobileHtml.toString('utf8'))

  function schedulePairingExpiry() {
    if (pairingExpiryTimer !== null) clearTimeout(pairingExpiryTimer)
    pairingExpiryTimer = null
    if (closing) return
    pairingExpiryTimer = setTimeout(() => {
      pairingExpiryTimer = null
      void refreshExpiredPairing()
        .then((rotated) => { if (!rotated && !closing && !pairing.claimed) schedulePairingExpiry() })
        .catch(() => { if (!closing && !pairing.claimed) schedulePairingExpiry() })
    }, Math.max(0, pairing.expiresAt - Date.now()))
    // ZTools' renderer preload may expose browser-style numeric timer handles.
    if (typeof pairingExpiryTimer?.unref === 'function') pairingExpiryTimer.unref()
  }

  function replacePairing(nextCode = pairing.code, notify = false) {
    pairing = createPairingState(nextCode, pairingTtlMs)
    schedulePairingExpiry()
    if (notify) {
      try { onPairingChanged() } catch {}
    }
    return { ...pairing }
  }

  async function refreshExpiredPairing() {
    if (closing || pairing.claimed || pairing.expiresAt > Date.now()) return false
    if (!pairingRefreshPromise) {
      pairingRefreshPromise = (async () => {
        if (closing || pairing.claimed || pairing.expiresAt > Date.now()) return false
        const expiredSessionId = pairing.sessionId
        let nextCode = pairing.code
        try { nextCode = await onPairingExpired(pairing.code) || pairing.code } catch {}
        if (closing || pairing.sessionId !== expiredSessionId || pairing.expiresAt > Date.now()) return false
        replacePairing(nextCode, true)
        return true
      })().finally(() => { pairingRefreshPromise = null })
    }
    return pairingRefreshPromise
  }

  function currentSession(request) {
    const token = bearerToken(request)
    const session = sessions.get(token)
    if (!session || session.expiresAt < Date.now()) {
      if (session) revokeSession(token, session, 4001, 'Session expired')
      return null
    }
    session.lastSeenAt = new Date().toISOString()
    return { token, session }
  }

  function requireSession(request) {
    const auth = currentSession(request)
    if (!auth) throw new HttpError(401, '配对会话已失效，请重新配对')
    return auth
  }

  function publicDevice(device, connected = Boolean(device.connected)) {
    const { resumeCredential: _resumeCredential, ...value } = device
    return { ...value, connected }
  }

  function revokeDeviceSessions(pairedDeviceId, reason, keepToken = '') {
    for (const [existingToken, existingSession] of sessions) {
      if (existingToken !== keepToken && existingSession.deviceId === pairedDeviceId) {
        revokeSession(existingToken, existingSession, 4000, reason)
      }
    }
  }

  function sessionCountAfterReplacing(pairedDeviceId) {
    let count = 0
    for (const session of sessions.values()) {
      if (session.deviceId !== pairedDeviceId) count += 1
    }
    return count
  }

  async function findStoredDevice(storedDeviceId) {
    try {
      return (await repository.listDevices()).find((item) => item.id === storedDeviceId)
    } catch (error) {
      throw new HttpError(503, '无法读取设备授权，请检查电脑端存储', {}, error)
    }
  }

  // Pairing and trusted-device resume both replace the persisted credential for
  // a device. Serialize that read/verify/write transaction per device so a
  // stale resume proof is always checked against the credential it will use.
  async function withDeviceCredentialMutation(targetDeviceId, action) {
    if (closing) throw new HttpError(503, '服务正在停止，请稍后重试')
    const previous = deviceCredentialMutations.get(targetDeviceId)
    let release
    const current = new Promise((resolve) => { release = resolve })
    deviceCredentialMutations.set(targetDeviceId, current)
    if (previous) await previous
    try {
      return await action()
    } finally {
      release()
      if (deviceCredentialMutations.get(targetDeviceId) === current) {
        deviceCredentialMutations.delete(targetDeviceId)
      }
    }
  }

  async function waitForDeviceCredentialMutations() {
    // Once closing is true no new mutation can enqueue, so the current tails
    // cover every pending write (and each tail already waits for its chain).
    await Promise.all([...new Set(deviceCredentialMutations.values())])
  }

  function createSession(device, resumeCredential) {
    return {
      token: randomId(32),
      key: Buffer.from(randomId(32), 'base64url'),
      deviceId: device.id,
      deviceName: cleanDeviceName(device.name || '移动设备'),
      platform: cleanDeviceName(device.platform || 'browser'),
      pairedAt: device.pairedAt || new Date().toISOString(),
      lastSeenAt: new Date().toISOString(),
      expiresAt: Date.now() + SESSION_TTL_MS,
      permissions: device.permissions || { text: true, files: true, clipboard: true, autoDownload: false },
      resumeCredential,
      socket: null,
      activeTransfers: new Set(),
    }
  }

  async function registerDevice(session) {
    const now = new Date().toISOString()
    const device = {
      id: session.deviceId,
      name: session.deviceName,
      platform: session.platform,
      connected: true,
      pairedAt: session.pairedAt,
      lastSeenAt: now,
      permissions: session.permissions,
      resumeCredential: session.resumeCredential,
    }
    await repository.putDevice(device)
    try { onEvent('device:changed', publicDevice(device, true)) } catch {}
  }

  async function activateSession(session) {
    sessions.set(session.token, session)
    try {
      await registerDevice(session)
    } catch (error) {
      sessions.delete(session.token)
      throw error
    }
  }

  async function rollbackActivatedPairing(session, previousDevice) {
    revokeSession(session.token, session, 4000, 'Pairing generation replaced')
    try {
      if (previousDevice) {
        await repository.putDevice(previousDevice)
        const connected = [...sessions.values()].some((existingSession) => existingSession.deviceId === previousDevice.id && existingSession.socket)
        try { onEvent('device:changed', publicDevice(previousDevice, Boolean(connected))) } catch {}
      } else {
        await repository.removeDevice(session.deviceId)
        try { onEvent('device:deleted', { id: session.deviceId }) } catch {}
      }
    } catch (error) {
      throw new HttpError(503, '无法回滚失效的设备授权，请检查电脑端存储', {}, error)
    }
  }

  async function revokeDeviceAuthorization(targetDeviceId) {
    const normalizedDeviceId = typeof targetDeviceId === 'string' ? targetDeviceId.slice(0, 100) : ''
    if (!normalizedDeviceId) return null
    return withDeviceCredentialMutation(normalizedDeviceId, async () => {
      revokeDeviceSessions(normalizedDeviceId, 'Device authorization revoked')
      for (const [challengeId, challenge] of resumeChallenges) {
        if (challenge.deviceId === normalizedDeviceId) resumeChallenges.delete(challengeId)
      }
      const removed = await repository.removeDevice(normalizedDeviceId)
      if (removed) {
        try { onEvent('device:deleted', { id: normalizedDeviceId }) } catch {}
      }
      return removed
    })
  }

  function sessionEnvelope(session, type, data) {
    return JSON.stringify({ data: encryptJson(session.key, { type, data }, `ws:${session.deviceId}`) })
  }

  function sendToSession(session, type, data) {
    if (session.socket?.readyState === WebSocket.OPEN) {
      try { session.socket.send(sessionEnvelope(session, type, data)) } catch {}
    }
  }

  function normalizeSessionConversation(conversationId, session) {
    const value = String(conversationId || '')
    if (value === SHARED_CONVERSATION_ID || value === privateConversationId(session.deviceId)) return value
    throw new HttpError(403, '该设备无权访问此会话')
  }

  function sessionCanAccessMessage(session, message) {
    const conversationId = messageConversationId(message, deviceId)
    return conversationId === SHARED_CONVERSATION_ID || conversationId === privateConversationId(session.deviceId)
  }

  function listSessionMessages(session, limit = 1000) {
    return repository.listMessages(limit, {
      filter: (message) => sessionCanAccessMessage(session, message),
      groupBy: (message) => messageConversationId(message, deviceId),
    })
  }

  function sendToConversation(conversationId, type, data) {
    for (const session of sessions.values()) {
      if (conversationId === SHARED_CONVERSATION_ID || conversationId === privateConversationId(session.deviceId)) {
        sendToSession(session, type, data)
      }
    }
  }

  async function publishMessage(message, requestedConversationId = message?.conversationId) {
    const conversationId = requestedConversationId || messageConversationId(message, deviceId)
    const stored = { ...message, conversationId }
    await repository.putMessage(stored)
    sendToConversation(conversationId, 'message:new', messageView(stored, deviceId))
    try { onEvent('message:new', stored) } catch {}
    return stored
  }

  async function removeTransfer(transfer) {
    transfers.delete(transfer.id)
    transfer.session.activeTransfers.delete(transfer.id)
    try {
      await fs.promises.rm(transfer.path, { force: true })
    } catch {}
  }

  async function cleanupOrphanTransferFiles(now = Date.now()) {
    if (!repository.transfersDir) return
    let entries
    try { entries = await fs.promises.readdir(repository.transfersDir, { withFileTypes: true }) } catch { return }
    const activePaths = new Set([...transfers.values()].map((transfer) => path.resolve(transfer.path)))
    await Promise.all(entries.map(async (entry) => {
      if (!entry.isFile() || !entry.name.endsWith('.part')) return
      const filePath = path.join(repository.transfersDir, entry.name)
      if (activePaths.has(path.resolve(filePath))) return
      try {
        const stat = await fs.promises.stat(filePath)
        if (stat.mtimeMs + transferTtlMs < now) await fs.promises.rm(filePath, { force: true })
      } catch {}
    }))
  }

  function revokeSession(token, session, code = 4001, reason = 'Authorization revoked') {
    session.socket?.close(code, reason)
    sessions.delete(token)
    for (const transferId of [...session.activeTransfers]) {
      const transfer = transfers.get(transferId)
      if (transfer) void removeTransfer(transfer)
    }
  }

  async function findAttachment(id, session = null) {
    const messages = await listSessionMessages(session, Number.MAX_SAFE_INTEGER)
    for (const message of messages) {
      if (session && !sessionCanAccessMessage(session, message)) continue
      const attachment = (message.attachments || []).find((item) => item.id === id)
      if (attachment) return attachment
    }
    return null
  }

  async function route(request, response) {
    const address = String(request.socket?.remoteAddress || '')
    if (!isPrivateAddress(address)) throw new HttpError(403, '仅允许局域网设备访问')
    const url = new URL(request.url || '/', 'http://device-link.local')
    let pathname
    try { pathname = decodeURIComponent(url.pathname) } catch { throw new HttpError(400, '请求路径格式无效') }

    if ((request.method === 'GET' || request.method === 'HEAD') && (pathname === '/' || pathname === '/index.html')) {
      response.writeHead(200, { ...securityHeaders, 'Content-Type': 'text/html; charset=utf-8', 'Content-Length': mobileHtml.length })
      response.end(request.method === 'HEAD' ? undefined : mobileHtml)
      return
    }

    if ((request.method === 'GET' || request.method === 'HEAD') && pathname === '/crypto-fallback.js') {
      response.writeHead(200, {
        'Content-Type': 'application/javascript; charset=utf-8',
        'Content-Length': fallbackCryptoScript.length,
        'Cache-Control': 'public, max-age=86400',
        'X-Content-Type-Options': 'nosniff',
      })
      response.end(request.method === 'HEAD' ? undefined : fallbackCryptoScript)
      return
    }

    if ((request.method === 'GET' || request.method === 'HEAD') && pathname === '/app.js') {
      response.writeHead(200, {
        'Content-Type': 'application/javascript; charset=utf-8',
        'Content-Length': mobileAppScript.length,
        'Cache-Control': 'no-store',
        'X-Content-Type-Options': 'nosniff',
      })
      response.end(request.method === 'HEAD' ? undefined : mobileAppScript)
      return
    }

    if (request.method === 'GET' && pathname === '/api/pairing') {
      await refreshExpiredPairing()
      sendJson(response, 200, {
        version: 1,
        sessionId: pairing.sessionId,
        salt: pairing.salt,
        challenge: pairing.challenge,
        manualKey: pairing.manualKey,
        expiresAt: new Date(pairing.expiresAt).toISOString(),
        deviceName,
        serverDeviceId: deviceId,
        iterations: 210000,
      })
      return
    }

    if (request.method === 'POST' && pathname === '/api/pair') {
      await refreshExpiredPairing()
      const body = await readJson(request)
      const attempt = attempts.get(address) || { count: 0, lockedUntil: 0, lastAttemptAt: Date.now() }
      if (attempt.lockedUntil > Date.now()) throw new HttpError(429, '匹配码错误次数过多，请稍后再试')
      if (body.mode !== 'manual' && body.mode !== 'qr') throw new HttpError(400, '配对方式无效')
      const pairingGeneration = pairing
      if (pairingGeneration.expiresAt < Date.now() || body.sessionId !== pairingGeneration.sessionId) throw new HttpError(410, '配对信息已过期，请在电脑端刷新二维码')
      let pairKey
      try {
        const pairingSecret = body.mode === 'manual' ? pairingGeneration.manualKey : pairingGeneration.secret
        const pairingCode = body.mode === 'manual' ? pairingGeneration.code : pairingGeneration.qrCode
        pairKey = derivePairKey(pairingSecret, pairingCode, pairingGeneration.salt)
        const expected = pairingProof(pairKey, pairingGeneration.sessionId, pairingGeneration.challenge)
        if (!secureEqual(expected, body.proof)) throw new Error('proof mismatch')
      } catch {
        attempt.count += 1
        attempt.lastAttemptAt = Date.now()
        if (attempt.count >= MAX_PAIR_ATTEMPTS) {
          attempt.count = 0
          attempt.lockedUntil = Date.now() + LOCKOUT_MS
        }
        attempts.set(address, attempt)
        throw new HttpError(401, '匹配码不正确')
      }

      if (pairing !== pairingGeneration) {
        throw new HttpError(410, '配对信息已过期，请在电脑端刷新二维码')
      }
      if (pairingGeneration.claimed) {
        throw new HttpError(409, '此配对正在处理中，请稍后刷新二维码')
      }
      // A desktop refresh can replace the pairing generation while an earlier
      // request is awaiting persistence. Do not allow a new generation to
      // commit until the earlier mutation (including its rollback) has settled.
      if (activePairingMutation) {
        throw new HttpError(409, '另一台设备的配对正在处理中，请稍后重试')
      }
      if (pairing !== pairingGeneration) {
        throw new HttpError(410, '配对信息已过期，请在电脑端刷新二维码')
      }
      if (pairingGeneration.claimed) {
        throw new HttpError(409, '此配对正在处理中，请稍后刷新二维码')
      }
      pairingGeneration.claimed = true
      activePairingMutation = pairingGeneration
      try {
        attempts.delete(address)
        const pairedDeviceId = typeof body.deviceId === 'string' && body.deviceId.length >= 12 ? body.deviceId.slice(0, 100) : randomId(16)
        if (sessionCountAfterReplacing(pairedDeviceId) >= MAX_SESSIONS) throw new HttpError(503, '已配对设备过多，请先移除旧设备')
        const resumeSecret = randomId(32)
        let resumeCredential
        try {
          resumeCredential = protectCredential(resumeSecret)
        } catch (error) {
          throw new HttpError(503, '电脑端安全存储暂时不可用，请重试', {}, error)
        }
        if (typeof resumeCredential !== 'string' || !resumeCredential) {
          throw new HttpError(503, '电脑端安全存储暂时不可用，请重试')
        }
        const session = createSession({
          id: pairedDeviceId,
          name: body.deviceName,
          platform: body.platform,
        }, resumeCredential)
        await withDeviceCredentialMutation(pairedDeviceId, async () => {
          const previousDevice = await findStoredDevice(pairedDeviceId)
          if (pairing !== pairingGeneration) throw new HttpError(410, '配对信息已过期，请在电脑端刷新二维码')
          await activateSession(session)
          if (pairing !== pairingGeneration) {
            await rollbackActivatedPairing(session, previousDevice)
            throw new HttpError(410, '配对信息已过期，请在电脑端刷新二维码')
          }
          revokeDeviceSessions(pairedDeviceId, 'Device paired again', session.token)
        })
        replacePairing(pairingGeneration.code, true)
        sendJson(response, 200, {
          package: encryptJson(pairKey, {
            token: session.token,
            sessionKey: session.key.toString('base64url'),
            resumeSecret,
            deviceId: session.deviceId,
            serverDeviceId: deviceId,
            expiresAt: new Date(session.expiresAt).toISOString(),
          }, `pair:${body.sessionId}`),
        })
      } catch (error) {
        if (pairing === pairingGeneration) {
          pairingGeneration.claimed = false
          schedulePairingExpiry()
        }
        if (error instanceof HttpError) throw error
        throw new HttpError(503, '无法保存设备授权，请检查电脑端存储', {}, error)
      } finally {
        if (activePairingMutation === pairingGeneration) {
          activePairingMutation = null
        }
      }
      return
    }

    if (request.method === 'POST' && pathname === '/api/resume/challenge') {
      const body = await readJson(request)
      const resumeDeviceId = typeof body.deviceId === 'string' ? body.deviceId.slice(0, 100) : ''
      if (resumeDeviceId.length < 12) throw new HttpError(400, '设备标识无效')
      const stored = await findStoredDevice(resumeDeviceId)
      if (!stored?.resumeCredential) throw new HttpError(401, '该设备需要重新配对')
      const challenge = {
        id: randomId(16),
        value: randomId(24),
        deviceId: resumeDeviceId,
        address,
        expiresAt: Date.now() + RESUME_CHALLENGE_TTL_MS,
      }
      if (resumeChallenges.size >= MAX_RESUME_CHALLENGES) resumeChallenges.delete(resumeChallenges.keys().next().value)
      resumeChallenges.set(challenge.id, challenge)
      sendJson(response, 200, {
        challengeId: challenge.id,
        challenge: challenge.value,
        expiresAt: new Date(challenge.expiresAt).toISOString(),
        serverDeviceId: deviceId,
      })
      return
    }

    if (request.method === 'POST' && pathname === '/api/resume') {
      const body = await readJson(request)
      const resumeDeviceId = typeof body.deviceId === 'string' ? body.deviceId.slice(0, 100) : ''
      const challengeId = typeof body.challengeId === 'string' ? body.challengeId : ''
      const challenge = resumeChallenges.get(challengeId)
      resumeChallenges.delete(challengeId)
      if (!challenge || challenge.deviceId !== resumeDeviceId || challenge.address !== address || challenge.expiresAt < Date.now()) {
        throw new HttpError(401, '自动连接凭据已失效，请重新配对')
      }
      const resumed = await withDeviceCredentialMutation(resumeDeviceId, async () => {
        // Re-read after waiting for a QR re-pair. A proof for the replaced
        // credential must not be allowed to restore the old authorization.
        const stored = await findStoredDevice(resumeDeviceId)
        let resumeSecret
        try {
          resumeSecret = unprotectCredential(stored?.resumeCredential || '')
          const expected = resumeProof(resumeSecret, challenge.id, challenge.value)
          if (!secureEqual(expected, body.proof)) throw new Error('proof mismatch')
        } catch (error) {
          if (error?.code === 'CREDENTIAL_BACKEND_UNAVAILABLE') {
            throw new HttpError(503, '电脑端安全存储暂时不可用，请稍后重试', {}, error)
          }
          throw new HttpError(401, '自动连接凭据已失效，请重新配对')
        }
        if (sessionCountAfterReplacing(resumeDeviceId) >= MAX_SESSIONS) throw new HttpError(503, '已配对设备过多，请先移除旧设备')
        const session = createSession(stored, stored.resumeCredential)
        try {
          await activateSession(session)
        } catch (error) {
          throw new HttpError(503, '无法恢复设备授权，请检查电脑端存储', {}, error)
        }
        revokeDeviceSessions(resumeDeviceId, 'Device resumed elsewhere', session.token)
        return { session, resumeSecret }
      })
      const resumeKey = Buffer.from(resumed.resumeSecret, 'base64url')
      sendJson(response, 200, {
        package: encryptJson(resumeKey, {
          token: resumed.session.token,
          sessionKey: resumed.session.key.toString('base64url'),
          deviceId: resumed.session.deviceId,
          serverDeviceId: deviceId,
          expiresAt: new Date(resumed.session.expiresAt).toISOString(),
        }, `resume:${resumed.session.deviceId}:${challenge.id}`),
      })
      return
    }

    if (request.method === 'GET' && pathname === '/api/messages') {
      const auth = requireSession(request)
      const messages = (await listSessionMessages(auth.session)).map((message) => messageView(message, deviceId))
      sendJson(response, 200, { data: encryptJson(auth.session.key, messages, `messages:${auth.session.deviceId}`) })
      return
    }

    if (request.method === 'POST' && pathname === '/api/transfers') {
      const auth = requireSession(request)
      if (!auth.session.permissions.files) throw new HttpError(403, '该设备没有文件发送权限')
      if (transfers.size >= MAX_ACTIVE_TRANSFERS || auth.session.activeTransfers.size >= MAX_ACTIVE_TRANSFERS_PER_SESSION) {
        throw new HttpError(429, '进行中的文件传输过多，请等待现有任务完成')
      }
      const body = await readJson(request)
      let metadata
      try {
        metadata = decryptJson(auth.session.key, body.data, `transfer:new:${auth.session.deviceId}`)
      } catch {
        throw new HttpError(400, '无法验证传输信息')
      }
      const size = Number(metadata.size)
      if (!Number.isSafeInteger(size) || size < 0 || size > maxIncomingFileBytes) throw new HttpError(413, '文件大小超出接收限制')
      const id = randomId(18)
      const transfer = {
        id,
        session: auth.session,
        name: safeFilename(metadata.name),
        mime: String(metadata.mime || 'application/octet-stream').slice(0, 120),
        size,
        received: 0,
        expectedIndex: 0,
        path: repository.newTransferPath(id),
        text: typeof metadata.text === 'string' ? metadata.text.slice(0, 2000) : '',
        conversationId: normalizeSessionConversation(metadata.conversationId || privateConversationId(auth.session.deviceId), auth.session),
        createdAt: Date.now(),
        lastActivityAt: Date.now(),
        busy: false,
        hash: crypto.createHash('sha256'),
      }
      await fs.promises.writeFile(transfer.path, Buffer.alloc(0), { flag: 'wx' })
      transfers.set(id, transfer)
      auth.session.activeTransfers.add(id)
      sendJson(response, 200, { data: encryptJson(auth.session.key, { id, chunkSize: CHUNK_SIZE, nextIndex: 0 }, `transfer:created:${auth.session.deviceId}`) })
      return
    }

    let match = /^\/api\/transfers\/([A-Za-z0-9_-]+)\/(\d+)$/.exec(pathname)
    if (request.method === 'PUT' && match) {
      const auth = requireSession(request)
      const transfer = transfers.get(match[1])
      const index = Number(match[2])
      if (!transfer || transfer.session !== auth.session) throw new HttpError(404, '传输任务不存在')
      if (transfer.busy) throw new HttpError(409, '传输任务正在处理上一分块', { nextIndex: transfer.expectedIndex })
      if (index !== transfer.expectedIndex) throw new HttpError(409, '分块顺序错误', { nextIndex: transfer.expectedIndex })
      transfer.busy = true
      try {
        const envelope = await readBody(request, CHUNK_SIZE + 64 * 1024)
        let plain
        try {
          plain = decryptBytes(auth.session.key, envelope, `transfer:${transfer.id}:${index}`)
        } catch {
          throw new HttpError(400, '文件分块校验失败')
        }
        if (plain.length > CHUNK_SIZE || transfer.received + plain.length > transfer.size) throw new HttpError(413, '文件分块超出限制')
        if (plain.length === 0 && transfer.received < transfer.size) throw new HttpError(400, '文件分块不能为空')
        const descriptor = await fs.promises.open(transfer.path, 'r+')
        try {
          await descriptor.write(plain, 0, plain.length, transfer.received)
        } finally {
          await descriptor.close()
        }
        transfer.hash.update(plain)
        transfer.received += plain.length
        transfer.expectedIndex += 1
        transfer.lastActivityAt = Date.now()
        try { onEvent('transfer:progress', { id: transfer.id, name: transfer.name, received: transfer.received, size: transfer.size }) } catch {}
        sendJson(response, 200, { nextIndex: transfer.expectedIndex, received: transfer.received })
      } finally {
        transfer.busy = false
      }
      return
    }

    match = /^\/api\/transfers\/([A-Za-z0-9_-]+)\/complete$/.exec(pathname)
    if (request.method === 'POST' && match) {
      const auth = requireSession(request)
      await readJson(request)
      const transfer = transfers.get(match[1])
      if (!transfer || transfer.session !== auth.session) throw new HttpError(404, '传输任务不存在')
      if (transfer.busy) throw new HttpError(409, '传输任务仍在写入')
      if (transfer.received !== transfer.size) throw new HttpError(409, '文件尚未传输完成', { received: transfer.received })
      transfer.busy = true
      const digest = transfer.digest || (transfer.digest = transfer.hash.digest('hex'))
      const destination = repository.newAttachmentPath(transfer.name)
      let committed = false
      try {
        await fs.promises.rename(transfer.path, destination)
        const now = new Date().toISOString()
        const attachment = {
          id: randomId(18),
          name: transfer.name,
          size: transfer.size,
          mime: transfer.mime,
          path: destination,
          sha256: digest,
          chunkSize: CHUNK_SIZE,
          chunks: Math.ceil(transfer.size / CHUNK_SIZE),
        }
        const message = {
          id: randomId(18),
          senderId: auth.session.deviceId,
          senderName: auth.session.deviceName,
          conversationId: transfer.conversationId,
          direction: 'incoming',
          kind: transfer.mime.startsWith('image/') ? 'image' : 'file',
          text: transfer.text,
          attachments: [attachment],
          createdAt: now,
          updatedAt: now,
          status: 'received',
        }
        const storedMessage = await publishMessage(message, transfer.conversationId)
        committed = true
        transfers.delete(transfer.id)
        auth.session.activeTransfers.delete(transfer.id)
        sendJson(response, 200, { data: encryptJson(auth.session.key, messageView(storedMessage, deviceId), `transfer:complete:${auth.session.deviceId}`) })
      } catch (error) {
        if (!committed) {
          try { await fs.promises.rename(destination, transfer.path) } catch {}
          transfer.busy = false
          transfer.lastActivityAt = Date.now()
        }
        throw error
      }
      return
    }

    match = /^\/api\/attachments\/([A-Za-z0-9_-]+)\/meta$/.exec(pathname)
    if (request.method === 'GET' && match) {
      const auth = requireSession(request)
      const attachment = await findAttachment(match[1], auth.session)
      if (!attachment?.path) throw new HttpError(404, '附件不存在或尚未同步到本机')
      try { await fs.promises.access(attachment.path, fs.constants.R_OK) } catch { throw new HttpError(404, '附件不存在或尚未同步到本机') }
      const { path: _path, ...metadata } = attachment
      metadata.chunkSize = CHUNK_SIZE
      metadata.chunks = Math.ceil(metadata.size / CHUNK_SIZE)
      sendJson(response, 200, { data: encryptJson(auth.session.key, metadata, `attachment:meta:${auth.session.deviceId}`) })
      return
    }

    match = /^\/api\/attachments\/([A-Za-z0-9_-]+)\/chunks\/(\d+)$/.exec(pathname)
    if (request.method === 'GET' && match) {
      const auth = requireSession(request)
      const attachment = await findAttachment(match[1], auth.session)
      const index = Number(match[2])
      if (!attachment?.path || !Number.isSafeInteger(index) || index < 0) throw new HttpError(404, '附件分块不存在')
      const descriptor = await fs.promises.open(attachment.path, 'r').catch(() => null)
      if (!descriptor) throw new HttpError(404, '附件分块不存在')
      try {
        const buffer = Buffer.allocUnsafe(CHUNK_SIZE)
        const { bytesRead } = await descriptor.read(buffer, 0, CHUNK_SIZE, index * CHUNK_SIZE)
        if (bytesRead === 0 && attachment.size > 0) throw new HttpError(416, '附件分块越界')
        const envelope = encryptBytes(auth.session.key, buffer.subarray(0, bytesRead), `attachment:${attachment.id}:${index}`)
        response.writeHead(200, {
          'Content-Type': 'application/octet-stream',
          'Content-Length': envelope.length,
          'Cache-Control': 'no-store',
          'X-Content-Type-Options': 'nosniff',
        })
        response.end(envelope)
      } finally {
        await descriptor.close()
      }
      return
    }

    throw new HttpError(404, '请求的资源不存在')
  }

  const server = http.createServer((request, response) => {
    route(request, response).catch((error) => {
      if (response.headersSent) {
        response.destroy()
        return
      }
      const statusCode = error instanceof HttpError ? error.status : 500
      const message = error instanceof HttpError ? error.message : '服务处理请求时发生错误'
      if (statusCode >= 500) {
        let pathname = '/'
        try { pathname = new URL(request.url, 'http://device-link.local').pathname } catch {}
        try {
          onError(error.cause || error, {
            method: request.method || 'UNKNOWN',
            pathname,
            statusCode,
          })
        } catch {}
      }
      sendJson(response, statusCode, { error: message, ...(error.extra || {}) })
    })
  })
  server.requestTimeout = 5 * 60 * 1000
  server.headersTimeout = 30 * 1000
  server.keepAliveTimeout = 5 * 1000
  server.maxHeadersCount = 64
  server.maxConnections = 64

  const wss = new WebSocketServer({ noServer: true, maxPayload: 512 * 1024 })
  server.on('upgrade', (request, socket, head) => {
    try {
      if (!isPrivateAddress(request.socket.remoteAddress || '')) return socket.destroy()
      const url = new URL(request.url, 'http://device-link.local')
      if (url.pathname !== '/ws') return socket.destroy()
      const session = sessions.get(url.searchParams.get('token') || '')
      if (!session || session.expiresAt < Date.now()) return socket.destroy()
      wss.handleUpgrade(request, socket, head, (client) => wss.emit('connection', client, session))
    } catch {
      socket.destroy()
    }
  })

  wss.on('connection', async (socket, session) => {
    try {
      const initialized = await withDeviceCredentialMutation(session.deviceId, async () => {
        // The upgrade can capture a session just before an explicit revoke.
        // Do not let that stale connection write its device credential back.
        if (sessions.get(session.token) !== session) {
          socket.close(4001, 'Authorization revoked')
          return false
        }
        session.socket?.close(4000, 'Replaced by a newer connection')
        session.socket = socket
        session.lastSeenAt = new Date().toISOString()
        await registerDevice(session)
        return true
      })
      if (!initialized) return
      sendToSession(session, 'session:ready', { deviceId, deviceName, expiresAt: new Date(session.expiresAt).toISOString() })
      sendToSession(session, 'messages:sync', (await listSessionMessages(session)).map((message) => messageView(message, deviceId)))
    } catch {
      socket.close(1011, 'Unable to initialize session')
    }

    socket.on('message', async (raw) => {
      try {
        const outer = JSON.parse(raw.toString())
        const message = decryptJson(session.key, outer.data, `ws:${session.deviceId}`)
        if (message.type === 'send:text' && session.permissions.text) {
          const text = cleanText(message.data?.text)
          const conversationId = normalizeSessionConversation(message.data?.conversationId || privateConversationId(session.deviceId), session)
          const now = new Date().toISOString()
          const record = {
            id: randomId(18),
            senderId: session.deviceId,
            senderName: session.deviceName,
            conversationId,
            direction: 'incoming',
            kind: detectKind(text),
            text,
            attachments: [],
            createdAt: now,
            updatedAt: now,
            status: 'received',
          }
          await publishMessage(record, conversationId)
        }
      } catch {
        socket.close(4003, 'Invalid encrypted message')
      }
    })

    socket.on('close', async () => {
      if (session.socket === socket) session.socket = null
      const stored = (await repository.listDevices()).find((item) => item.id === session.deviceId)
      if (stored) {
        try { onEvent('device:changed', publicDevice(stored, false)) } catch {}
      }
    })
  })

  const cleanupTimer = setInterval(() => {
    const now = Date.now()
    for (const [token, session] of sessions) {
      if (session.expiresAt < now) revokeSession(token, session, 4001, 'Session expired')
    }
    for (const [address, attempt] of attempts) {
      if (attempt.lockedUntil < now && attempt.lastAttemptAt + LOCKOUT_MS < now) attempts.delete(address)
    }
    for (const [challengeId, challenge] of resumeChallenges) {
      if (challenge.expiresAt < now) resumeChallenges.delete(challengeId)
    }
    for (const transfer of transfers.values()) {
      if (!transfer.busy && transfer.lastActivityAt + transferTtlMs < now) void removeTransfer(transfer)
    }
    void cleanupOrphanTransferFiles(now)
  }, Math.min(60 * 1000, Math.max(1000, transferTtlMs)))
  // In ZTools' renderer preload, the browser timer implementation can return
  // a numeric handle instead of Node.js' Timeout object.
  if (typeof cleanupTimer?.unref === 'function') cleanupTimer.unref()
  await cleanupOrphanTransferFiles()

  await new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(port, '0.0.0.0', () => {
      server.off('error', reject)
      resolve()
    })
  })
  const lanIPs = getLanIPs()
  const selectedIP = lanIPs[0] || '127.0.0.1'
  const accessUrl = `http://${selectedIP}:${port}`
  status = { running: true, port, lanIPs, selectedIP, accessUrl }
  schedulePairingExpiry()

  return {
    get status() {
      return { ...status }
    },
    get pairing() {
      return { ...pairing }
    },
    regeneratePairing(nextCode = pairing.code) {
      return replacePairing(nextCode)
    },
    updatePairingCode(nextCode) {
      replacePairing(nextCode)
    },
    publishMessage,
    connectedDevices() {
      return [...sessions.values()].filter((session) => session.socket).map((session) => session.deviceId)
    },
    disconnectDevice(id) {
      return revokeDeviceAuthorization(id)
    },
    revokeDeviceAuthorization,
    close() {
      if (closePromise) return closePromise
      closing = true
      closePromise = (async () => {
        clearInterval(cleanupTimer)
        if (pairingExpiryTimer !== null) clearTimeout(pairingExpiryTimer)
        pairingExpiryTimer = null
        // Stop accepting new traffic immediately. Existing handlers can finish
        // only after their credential mutation tail has drained below.
        const websocketClosed = new Promise((resolve) => wss.close(() => resolve()))
        const httpClosed = new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()))
        for (const session of sessions.values()) session.socket?.close(1001, 'Server stopped')
        await Promise.all([...transfers.values()].map(removeTransfer))
        await waitForDeviceCredentialMutations()
        sessions.clear()
        resumeChallenges.clear()
        await Promise.all([websocketClosed, httpClosed])
        status = { running: false, port, lanIPs: [], selectedIP: '', accessUrl: '' }
      })()
      return closePromise
    },
  }
}

module.exports = {
  CHUNK_SIZE,
  MAX_ACTIVE_TRANSFERS,
  MAX_ACTIVE_TRANSFERS_PER_SESSION,
  TRANSFER_TTL_MS,
  createDeviceLinkServer,
  getLanIPs,
  messageView,
}
