'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const crypto = require('node:crypto')
const fs = require('node:fs')
const net = require('node:net')
const os = require('node:os')
const path = require('node:path')
const { WebSocket } = require('ws')
const { CHUNK_SIZE, createDeviceLinkServer } = require('../public/preload/core/server')
const { createCredentialStorage } = require('../public/preload/core/credential-storage')
const { decryptJson, derivePairKey, encryptBytes, encryptJson, pairingProof, resumeProof, sha256 } = require('../public/preload/core/crypto')

async function freePort() {
  const socket = net.createServer()
  await new Promise((resolve) => socket.listen(0, '127.0.0.1', resolve))
  const port = socket.address().port
  await new Promise((resolve) => socket.close(resolve))
  return port
}

function memoryRepository(root) {
  const messages = []
  const devices = []
  return {
    messages,
    devices,
    newTransferPath(id) { return path.join(root, `${id}.part`) },
    newAttachmentPath(name) { return path.join(root, `${Date.now()}-${name}`) },
    async putMessage(message) { const index = messages.findIndex((item) => item.id === message.id); index >= 0 ? messages.splice(index, 1, message) : messages.push(message); return message },
    async listMessages(limit = 1000, options = {}) {
      const filtered = messages.filter((message) => typeof options.filter !== 'function' || options.filter(message))
      if (typeof options.groupBy !== 'function') return filtered.slice(-limit)
      const groups = new Map()
      for (const message of filtered) {
        const key = String(options.groupBy(message))
        groups.set(key, [...(groups.get(key) || []), message])
      }
      return [...groups.values()].flatMap((group) => group.slice(-limit)).sort((a, b) => a.createdAt.localeCompare(b.createdAt))
    },
    async putDevice(device) { const index = devices.findIndex((item) => item.id === device.id); index >= 0 ? devices.splice(index, 1, device) : devices.push(device); return device },
    async listDevices() { return [...devices] },
    async removeDevice(id) { const index = devices.findIndex((item) => item.id === id); return index >= 0 ? devices.splice(index, 1)[0] : null },
  }
}

async function requestPairing(server, base, code, deviceId, deviceName, mode = 'qr') {
  const state = await (await fetch(`${base}/api/pairing`)).json()
  const pairingSecret = mode === 'manual' ? state.manualKey : server.pairing.secret
  const pairingCode = mode === 'manual' ? code : server.pairing.qrCode
  const pairKey = derivePairKey(pairingSecret, pairingCode, state.salt)
  const proof = pairingProof(pairKey, state.sessionId, state.challenge)
  const response = await fetch(`${base}/api/pair`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ sessionId: state.sessionId, mode, proof, deviceName, deviceId, platform: 'test' }),
  })
  return { state, pairKey, response }
}

function pairRequestPayload(server, state, {
  code = '834921',
  deviceId = 'pair-test-device-1234',
  deviceName = 'Test Phone',
  mode = 'qr',
  platform = 'test',
} = {}) {
  const pairingSecret = mode === 'manual' ? state.manualKey : server.pairing.secret
  const pairingCode = mode === 'manual' ? code : server.pairing.qrCode
  const pairKey = derivePairKey(pairingSecret, pairingCode, state.salt)
  return {
    pairKey,
    body: {
      sessionId: state.sessionId,
      mode,
      proof: pairingProof(pairKey, state.sessionId, state.challenge),
      deviceName,
      deviceId,
      platform,
    },
  }
}

async function postPairing(base, body) {
  return fetch(`${base}/api/pair`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

async function pairTestDevice(server, base, code, deviceId, deviceName, mode = 'qr') {
  const { state, pairKey, response } = await requestPairing(server, base, code, deviceId, deviceName, mode)
  assert.equal(response.status, 200)
  const body = await response.json()
  const session = decryptJson(pairKey, body.package, `pair:${state.sessionId}`)
  return { ...session, key: Buffer.from(session.sessionKey, 'base64url') }
}

async function openTestSocket(port, session) {
  const socket = new WebSocket(`ws://127.0.0.1:${port}/ws?token=${encodeURIComponent(session.token)}`)
  const received = []
  socket.on('message', (raw) => {
    const outer = JSON.parse(raw.toString())
    received.push(decryptJson(session.key, outer.data, `ws:${session.deviceId}`))
  })
  await new Promise((resolve, reject) => {
    socket.once('open', resolve)
    socket.once('error', reject)
  })
  return { socket, received }
}

async function waitForMessage(received, predicate, timeoutMs = 3000) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const found = received.find(predicate)
    if (found) return found
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
  throw new Error('message timeout')
}

test('server accepts browser-style numeric timer handles', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'device-link-timer-test-'))
  const repository = memoryRepository(root)
  const port = await freePort()
  const nativeSetInterval = global.setInterval
  const nativeClearInterval = global.clearInterval
  const nativeSetTimeout = global.setTimeout
  const nativeClearTimeout = global.clearTimeout
  const handles = new Map()
  const timeoutHandles = new Map()
  let nextHandle = 1
  let server

  global.setInterval = (...args) => {
    const handle = nextHandle++
    handles.set(handle, nativeSetInterval(...args))
    return handle
  }
  global.clearInterval = (handle) => {
    const nativeHandle = handles.get(handle)
    handles.delete(handle)
    return nativeClearInterval(nativeHandle ?? handle)
  }
  global.setTimeout = (...args) => {
    const handle = nextHandle++
    timeoutHandles.set(handle, nativeSetTimeout(...args))
    return handle
  }
  global.clearTimeout = (handle) => {
    const nativeHandle = timeoutHandles.get(handle)
    timeoutHandles.delete(handle)
    return nativeClearTimeout(nativeHandle ?? handle)
  }

  try {
    server = await createDeviceLinkServer({
      repository,
      deviceId: 'desktop-device',
      deviceName: 'Test Desktop',
      port,
      pairingCode: '834921',
      maxIncomingFileBytes: 10 * 1024 * 1024,
      onEvent() {},
    })
    assert.equal(server.status.running, true)
    await server.close()
    server = null
    assert.equal(handles.size, 0)
    assert.equal(timeoutHandles.size, 0)
  } finally {
    if (server) await server.close()
    for (const handle of handles.values()) nativeClearInterval(handle)
    for (const handle of timeoutHandles.values()) nativeClearTimeout(handle)
    global.setInterval = nativeSetInterval
    global.clearInterval = nativeClearInterval
    global.setTimeout = nativeSetTimeout
    global.clearTimeout = nativeClearTimeout
    fs.rmSync(root, { recursive: true, force: true })
  }
})

test('expired pairing state rotates automatically and refreshes the desktop QR', async (context) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'device-link-pairing-expiry-test-'))
  const repository = memoryRepository(root)
  const port = await freePort()
  let pairingChangeCount = 0
  let pairingExpiryCount = 0
  const server = await createDeviceLinkServer({
    repository,
    deviceId: 'desktop-device',
    deviceName: 'Test Desktop',
    port,
    pairingCode: '834921',
    pairingTtlMs: 40,
    maxIncomingFileBytes: 10 * 1024 * 1024,
    onEvent() {},
    async onPairingExpired() {
      pairingExpiryCount += 1
      return '679776'
    },
    onPairingChanged() { pairingChangeCount += 1 },
  })
  context.after(async () => {
    await server.close()
    fs.rmSync(root, { recursive: true, force: true })
  })

  const initial = server.pairing
  const deadline = Date.now() + 2000
  while (server.pairing.sessionId === initial.sessionId && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 10))
  }

  assert.notEqual(server.pairing.sessionId, initial.sessionId)
  assert.equal(server.pairing.code, '679776')
  assert.equal(pairingExpiryCount, 1)
  assert.equal(pairingChangeCount, 1)
  const latest = await (await fetch(`http://127.0.0.1:${port}/api/pairing`)).json()
  assert.equal(latest.sessionId, server.pairing.sessionId)
})

test('pairing endpoint lazily rotates expired state after sleep', async (context) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'device-link-pairing-wake-test-'))
  const repository = memoryRepository(root)
  const port = await freePort()
  const nativeDateNow = Date.now
  let nowOffset = 0
  Date.now = () => nativeDateNow() + nowOffset
  const server = await createDeviceLinkServer({
    repository,
    deviceId: 'desktop-device',
    deviceName: 'Test Desktop',
    port,
    pairingCode: '834921',
    pairingTtlMs: 60 * 1000,
    maxIncomingFileBytes: 10 * 1024 * 1024,
    onEvent() {},
    async onPairingExpired() { return '679776' },
  })
  context.after(async () => {
    Date.now = nativeDateNow
    await server.close()
    fs.rmSync(root, { recursive: true, force: true })
  })

  const initial = server.pairing
  nowOffset = 61 * 1000
  const latest = await (await fetch(`http://127.0.0.1:${port}/api/pairing`)).json()

  assert.notEqual(latest.sessionId, initial.sessionId)
  assert.equal(server.pairing.code, '679776')
})

test('pairing keeps the manual code separate from the QR-only code and rejects unknown modes', async (context) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'device-link-pairing-mode-test-'))
  const repository = memoryRepository(root)
  const port = await freePort()
  const server = await createDeviceLinkServer({
    repository,
    deviceId: 'desktop-device',
    deviceName: 'Test Desktop',
    port,
    pairingCode: '834921',
    maxIncomingFileBytes: 10 * 1024 * 1024,
    onEvent() {},
  })
  context.after(async () => {
    await server.close()
    fs.rmSync(root, { recursive: true, force: true })
  })

  const base = `http://127.0.0.1:${port}`
  const state = await (await fetch(`${base}/api/pairing`)).json()
  assert.notEqual(server.pairing.qrCode, server.pairing.code)
  assert.equal(state.qrCode, undefined)

  const wrongQrKey = derivePairKey(server.pairing.secret, '834921', state.salt)
  const wrongQrResponse = await postPairing(base, {
    sessionId: state.sessionId,
    mode: 'qr',
    proof: pairingProof(wrongQrKey, state.sessionId, state.challenge),
    deviceName: 'QR Phone',
    deviceId: 'qr-phone-123456',
    platform: 'test',
  })
  assert.equal(wrongQrResponse.status, 401)

  const invalidModeResponse = await postPairing(base, {
    ...pairRequestPayload(server, state, { mode: 'qr' }).body,
    mode: 'scan',
  })
  assert.equal(invalidModeResponse.status, 400)
  assert.equal(server.pairing.sessionId, state.sessionId)

  const manual = pairRequestPayload(server, state, { mode: 'manual', deviceId: 'manual-phone-1234' })
  const manualResponse = await postPairing(base, manual.body)
  assert.equal(manualResponse.status, 200)
  const manualBody = await manualResponse.json()
  assert.equal(decryptJson(manual.pairKey, manualBody.package, `pair:${state.sessionId}`).deviceId, 'manual-phone-1234')

  const qrState = await (await fetch(`${base}/api/pairing`)).json()
  const qr = pairRequestPayload(server, qrState, { mode: 'qr', deviceId: 'qr-phone-123456' })
  const qrResponse = await postPairing(base, qr.body)
  assert.equal(qrResponse.status, 200)
  const qrBody = await qrResponse.json()
  assert.equal(decryptJson(qr.pairKey, qrBody.package, `pair:${qrState.sessionId}`).deviceId, 'qr-phone-123456')
})

test('pairing claims a generation so concurrent requests have one winner and stale replay fails', async (context) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'device-link-pairing-claim-test-'))
  const repository = memoryRepository(root)
  const originalPutDevice = repository.putDevice.bind(repository)
  const port = await freePort()
  let releaseFirstWrite
  let enterFirstWrite
  const firstWriteEntered = new Promise((resolve) => { enterFirstWrite = resolve })
  const firstWriteReleased = new Promise((resolve) => { releaseFirstWrite = resolve })
  let firstWrite = true
  repository.putDevice = async (device) => {
    if (firstWrite) {
      firstWrite = false
      enterFirstWrite()
      await firstWriteReleased
    }
    return originalPutDevice(device)
  }
  const server = await createDeviceLinkServer({
    repository,
    deviceId: 'desktop-device',
    deviceName: 'Test Desktop',
    port,
    pairingCode: '834921',
    maxIncomingFileBytes: 10 * 1024 * 1024,
    onEvent() {},
  })
  context.after(async () => {
    releaseFirstWrite?.()
    await server.close()
    fs.rmSync(root, { recursive: true, force: true })
  })

  const base = `http://127.0.0.1:${port}`
  const state = await (await fetch(`${base}/api/pairing`)).json()
  const request = pairRequestPayload(server, state, { deviceId: 'claim-phone-123456' })
  const firstResponsePromise = postPairing(base, request.body)
  await firstWriteEntered
  const secondResponse = await postPairing(base, request.body)
  assert.equal(secondResponse.status, 409)

  releaseFirstWrite()
  const firstResponse = await firstResponsePromise
  assert.equal(firstResponse.status, 200)
  assert.notEqual(server.pairing.sessionId, state.sessionId)
  assert.equal(repository.devices.length, 1)

  const replayResponse = await postPairing(base, request.body)
  assert.equal(replayResponse.status, 410)
})

test('regenerating pairing during persistence invalidates the claimed request without leaving a device', async (context) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'device-link-pairing-regenerate-race-test-'))
  const repository = memoryRepository(root)
  const originalPutDevice = repository.putDevice.bind(repository)
  const port = await freePort()
  let releaseWrite
  let enterWrite
  const writeEntered = new Promise((resolve) => { enterWrite = resolve })
  const writeReleased = new Promise((resolve) => { releaseWrite = resolve })
  repository.putDevice = async (device) => {
    enterWrite()
    await writeReleased
    return originalPutDevice(device)
  }
  const server = await createDeviceLinkServer({
    repository,
    deviceId: 'desktop-device',
    deviceName: 'Test Desktop',
    port,
    pairingCode: '834921',
    maxIncomingFileBytes: 10 * 1024 * 1024,
    onEvent() {},
  })
  context.after(async () => {
    releaseWrite?.()
    await server.close()
    fs.rmSync(root, { recursive: true, force: true })
  })

  const base = `http://127.0.0.1:${port}`
  const state = await (await fetch(`${base}/api/pairing`)).json()
  const request = pairRequestPayload(server, state, { deviceId: 'regenerate-phone-123456' })
  const responsePromise = postPairing(base, request.body)
  await writeEntered
  const refreshed = server.regeneratePairing()
  assert.notEqual(refreshed.sessionId, state.sessionId)

  releaseWrite()
  const response = await responsePromise
  assert.equal(response.status, 410)
  assert.equal(server.pairing.sessionId, refreshed.sessionId)
  assert.equal(repository.devices.length, 0)
  assert.deepEqual(server.connectedDevices(), [])
})

test('a refreshed generation retries after an invalidated write rollback before pairing the same device', async (context) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'device-link-pairing-mutation-barrier-test-'))
  const repository = memoryRepository(root)
  const originalPutDevice = repository.putDevice.bind(repository)
  const port = await freePort()
  let releaseFirstWrite
  let enterFirstWrite
  const firstWriteEntered = new Promise((resolve) => { enterFirstWrite = resolve })
  const firstWriteReleased = new Promise((resolve) => { releaseFirstWrite = resolve })
  let putCount = 0
  repository.putDevice = async (device) => {
    putCount += 1
    if (putCount === 1) {
      enterFirstWrite()
      await firstWriteReleased
    }
    return originalPutDevice(device)
  }
  const server = await createDeviceLinkServer({
    repository,
    deviceId: 'desktop-device',
    deviceName: 'Test Desktop',
    port,
    pairingCode: '834921',
    maxIncomingFileBytes: 10 * 1024 * 1024,
    onEvent() {},
  })
  context.after(async () => {
    releaseFirstWrite?.()
    await server.close()
    fs.rmSync(root, { recursive: true, force: true })
  })

  const base = `http://127.0.0.1:${port}`
  const deviceId = 'shared-race-phone-123456'
  const stateA = await (await fetch(`${base}/api/pairing`)).json()
  const requestA = pairRequestPayload(server, stateA, { deviceId })
  const responseAPromise = postPairing(base, requestA.body)
  await firstWriteEntered

  const refreshed = server.regeneratePairing()
  const stateB = await (await fetch(`${base}/api/pairing`)).json()
  assert.equal(stateB.sessionId, refreshed.sessionId)
  const requestB = pairRequestPayload(server, stateB, { deviceId })
  const blockedB = await postPairing(base, requestB.body)
  assert.equal(blockedB.status, 409)
  assert.equal(putCount, 1)

  releaseFirstWrite()
  const responseA = await responseAPromise
  assert.equal(responseA.status, 410)
  const responseB = await postPairing(base, requestB.body)
  assert.equal(responseB.status, 200)
  const pairedB = decryptJson(requestB.pairKey, (await responseB.json()).package, `pair:${stateB.sessionId}`)
  assert.equal(repository.devices.length, 1)
  assert.equal(repository.devices[0].id, deviceId)
  assert.equal(repository.devices[0].resumeCredential, pairedB.resumeSecret)
})

test('a persistence failure releases the pairing claim for a retry', async (context) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'device-link-pairing-claim-retry-test-'))
  const repository = memoryRepository(root)
  const originalPutDevice = repository.putDevice.bind(repository)
  let failOnce = true
  repository.putDevice = async (device) => {
    if (failOnce) {
      failOnce = false
      throw new Error('temporary database failure')
    }
    return originalPutDevice(device)
  }
  const port = await freePort()
  const server = await createDeviceLinkServer({
    repository,
    deviceId: 'desktop-device',
    deviceName: 'Test Desktop',
    port,
    pairingCode: '834921',
    maxIncomingFileBytes: 10 * 1024 * 1024,
    protectCredential(value) { return `sealed:${value}` },
    onEvent() {},
  })
  context.after(async () => {
    await server.close()
    fs.rmSync(root, { recursive: true, force: true })
  })

  const base = `http://127.0.0.1:${port}`
  const state = await (await fetch(`${base}/api/pairing`)).json()
  const request = pairRequestPayload(server, state, { deviceId: 'retry-phone-123456' })
  const firstResponse = await postPairing(base, request.body)
  assert.equal(firstResponse.status, 503)
  assert.equal(server.pairing.sessionId, state.sessionId)

  const secondResponse = await postPairing(base, request.body)
  assert.equal(secondResponse.status, 200)
  assert.notEqual(server.pairing.sessionId, state.sessionId)
})

test('pairing establishes an encrypted session and supports text plus chunked files', async (context) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'device-link-test-'))
  const repository = memoryRepository(root)
  const port = await freePort()
  const events = []
  let pairingChangeCount = 0
  const server = await createDeviceLinkServer({
    repository,
    deviceId: 'desktop-device',
    deviceName: 'Test Desktop',
    port,
    pairingCode: '834921',
    maxIncomingFileBytes: 10 * 1024 * 1024,
    transferTtlMs: 50,
    onEvent(type, data) { events.push({ type, data }) },
    onPairingChanged() { pairingChangeCount += 1 },
  })
  context.after(async () => {
    await server.close()
    fs.rmSync(root, { recursive: true, force: true })
  })

  const base = `http://127.0.0.1:${port}`
  const pairingResponse = await fetch(`${base}/api/pairing`)
  assert.equal(pairingResponse.headers.get('cache-control'), 'no-store')
  const pageResponse = await fetch(base)
  assert.match(pageResponse.headers.get('content-security-policy'), /script-src 'self'/)
  assert.equal(pageResponse.headers.get('x-frame-options'), 'DENY')
  const fallbackCrypto = await fetch(`${base}/crypto-fallback.js`)
  assert.equal(fallbackCrypto.status, 200)
  assert.match(await fallbackCrypto.text(), /deviceLinkCryptoFallback/)
  const mobileApp = await fetch(`${base}/app.js`)
  assert.equal(mobileApp.status, 200)
  assert.equal(mobileApp.headers.get('cache-control'), 'no-store')
  assert.match(await mobileApp.text(), /currentConversationId/)
  const state = await pairingResponse.json()
  const pairKey = derivePairKey(server.pairing.secret, server.pairing.qrCode, state.salt)
  const proof = pairingProof(pairKey, state.sessionId, state.challenge)
  const pairResponse = await fetch(`${base}/api/pair`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ sessionId: state.sessionId, mode: 'qr', proof, deviceName: 'Test Phone', deviceId: 'phone-device-1234', platform: 'test' }),
  })
  assert.equal(pairResponse.status, 200)
  const pairBody = await pairResponse.json()
  const session = decryptJson(pairKey, pairBody.package, `pair:${state.sessionId}`)
  const sessionKey = Buffer.from(session.sessionKey, 'base64url')
  assert.equal(repository.devices[0].name, 'Test Phone')
  assert.equal(pairingChangeCount, 1)
  assert.notEqual(server.pairing.sessionId, state.sessionId)

  const historyResponse = await fetch(`${base}/api/messages`, { headers: { Authorization: `Bearer ${session.token}` } })
  const history = await historyResponse.json()
  assert.deepEqual(decryptJson(sessionKey, history.data, `messages:${session.deviceId}`), [])

  const socket = new WebSocket(`ws://127.0.0.1:${port}/ws?token=${encodeURIComponent(session.token)}`)
  const received = []
  socket.on('message', (raw) => {
    const outer = JSON.parse(raw.toString())
    received.push(decryptJson(sessionKey, outer.data, `ws:${session.deviceId}`))
  })
  await new Promise((resolve, reject) => {
    socket.once('open', resolve)
    socket.once('error', reject)
  })
  socket.send(JSON.stringify({ data: encryptJson(sessionKey, { type: 'send:text', data: { text: 'hello from phone' } }, `ws:${session.deviceId}`) }))
  await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('message timeout')), 3000)
    const check = () => {
      if (received.some((item) => item.type === 'message:new')) { clearTimeout(timeout); resolve() }
      else setTimeout(check, 10)
    }
    check()
  })
  assert.equal(repository.messages[0].text, 'hello from phone')

  const content = Buffer.alloc(CHUNK_SIZE * 2 + 37, 0x5a)
  const transferResponse = await fetch(`${base}/api/transfers`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${session.token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ data: encryptJson(sessionKey, { name: '../safe.txt', size: content.length, mime: 'text/plain' }, `transfer:new:${session.deviceId}`) }),
  })
  assert.equal(transferResponse.status, 200)
  const transferBody = await transferResponse.json()
  const transfer = decryptJson(sessionKey, transferBody.data, `transfer:created:${session.deviceId}`)
  for (let index = 0, offset = 0; offset < content.length; index += 1, offset += CHUNK_SIZE) {
    const chunk = content.subarray(offset, offset + CHUNK_SIZE)
    const chunkResponse = await fetch(`${base}/api/transfers/${transfer.id}/${index}`, {
      method: 'PUT',
      headers: { Authorization: `Bearer ${session.token}`, 'Content-Type': 'application/octet-stream' },
      body: encryptBytes(sessionKey, chunk, `transfer:${transfer.id}:${index}`),
    })
    assert.equal(chunkResponse.status, 200)
  }
  const complete = await fetch(`${base}/api/transfers/${transfer.id}/complete`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${session.token}`, 'Content-Type': 'application/json' },
    body: '{}',
  })
  assert.equal(complete.status, 200)
  assert.equal(repository.messages[1].attachments[0].name, 'safe.txt')
  assert.equal(repository.messages[1].attachments[0].sha256, sha256(content))
  assert.deepEqual(fs.readFileSync(repository.messages[1].attachments[0].path), content)
  assert.equal(events.some((event) => event.type === 'transfer:progress'), true)

  const abandoned = []
  for (let index = 0; index < 4; index += 1) {
    const response = await fetch(`${base}/api/transfers`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${session.token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ data: encryptJson(sessionKey, { name: `pending-${index}.bin`, size: 1 }, `transfer:new:${session.deviceId}`) }),
    })
    assert.equal(response.status, 200)
    const task = decryptJson(sessionKey, (await response.json()).data, `transfer:created:${session.deviceId}`)
    abandoned.push(repository.newTransferPath(task.id))
  }
  const limited = await fetch(`${base}/api/transfers`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${session.token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ data: encryptJson(sessionKey, { name: 'too-many.bin', size: 1 }, `transfer:new:${session.deviceId}`) }),
  })
  assert.equal(limited.status, 429)
  const cleanupDeadline = Date.now() + 2500
  while (abandoned.some((filePath) => fs.existsSync(filePath)) && Date.now() < cleanupDeadline) {
    await new Promise((resolve) => setTimeout(resolve, 50))
  }
  assert.equal(abandoned.some((filePath) => fs.existsSync(filePath)), false)
  socket.close()
})

test('two phones pair independently and only shared conversations cross device boundaries', async (context) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'device-link-multi-device-test-'))
  const repository = memoryRepository(root)
  const port = await freePort()
  const server = await createDeviceLinkServer({
    repository,
    deviceId: 'desktop-device',
    deviceName: 'Test Desktop',
    port,
    pairingCode: '834921',
    maxIncomingFileBytes: 10 * 1024 * 1024,
    onEvent() {},
  })
  const sockets = []
  context.after(async () => {
    for (const socket of sockets) socket.close()
    await server.close()
    fs.rmSync(root, { recursive: true, force: true })
  })

  const base = `http://127.0.0.1:${port}`
  const phoneA = await pairTestDevice(server, base, '834921', 'phone-device-aaaa', 'Phone A')
  const phoneB = await pairTestDevice(server, base, '834921', 'phone-device-bbbb', 'Phone B')
  assert.deepEqual(repository.devices.map((device) => device.id).sort(), ['phone-device-aaaa', 'phone-device-bbbb'])

  const channelA = await openTestSocket(port, phoneA)
  const channelB = await openTestSocket(port, phoneB)
  sockets.push(channelA.socket, channelB.socket)
  await Promise.all([
    waitForMessage(channelA.received, (item) => item.type === 'messages:sync'),
    waitForMessage(channelB.received, (item) => item.type === 'messages:sync'),
  ])

  const now = new Date().toISOString()
  await server.publishMessage({
    id: 'private-for-a', conversationId: 'device:phone-device-aaaa', senderId: 'desktop-device', senderName: 'Test Desktop',
    direction: 'outgoing', kind: 'text', text: 'only A', attachments: [], createdAt: now, updatedAt: now, status: 'sent',
  })
  await waitForMessage(channelA.received, (item) => item.type === 'message:new' && item.data.id === 'private-for-a')
  await new Promise((resolve) => setTimeout(resolve, 80))
  assert.equal(channelB.received.some((item) => item.type === 'message:new' && item.data.id === 'private-for-a'), false)

  await server.publishMessage({
    id: 'shared-for-all', conversationId: 'shared', senderId: 'desktop-device', senderName: 'Test Desktop',
    direction: 'outgoing', kind: 'text', text: 'for everyone', attachments: [], createdAt: now, updatedAt: now, status: 'sent',
  })
  await Promise.all([
    waitForMessage(channelA.received, (item) => item.type === 'message:new' && item.data.id === 'shared-for-all'),
    waitForMessage(channelB.received, (item) => item.type === 'message:new' && item.data.id === 'shared-for-all'),
  ])

  channelB.socket.send(JSON.stringify({ data: encryptJson(phoneB.key, {
    type: 'send:text', data: { text: 'shared from B', conversationId: 'shared' },
  }, `ws:${phoneB.deviceId}`) }))
  await Promise.all([
    waitForMessage(channelA.received, (item) => item.type === 'message:new' && item.data.text === 'shared from B'),
    waitForMessage(channelB.received, (item) => item.type === 'message:new' && item.data.text === 'shared from B'),
  ])

  channelB.socket.send(JSON.stringify({ data: encryptJson(phoneB.key, {
    type: 'send:text', data: { text: 'private from B', conversationId: 'device:phone-device-bbbb' },
  }, `ws:${phoneB.deviceId}`) }))
  await waitForMessage(channelB.received, (item) => item.type === 'message:new' && item.data.text === 'private from B')
  await new Promise((resolve) => setTimeout(resolve, 80))
  assert.equal(channelA.received.some((item) => item.type === 'message:new' && item.data.text === 'private from B'), false)

  const historyAEnvelope = await (await fetch(`${base}/api/messages`, { headers: { Authorization: `Bearer ${phoneA.token}` } })).json()
  const historyBEnvelope = await (await fetch(`${base}/api/messages`, { headers: { Authorization: `Bearer ${phoneB.token}` } })).json()
  const historyA = decryptJson(phoneA.key, historyAEnvelope.data, `messages:${phoneA.deviceId}`)
  const historyB = decryptJson(phoneB.key, historyBEnvelope.data, `messages:${phoneB.deviceId}`)
  assert.deepEqual(historyA.map((message) => message.text).sort(), ['for everyone', 'only A', 'shared from B'])
  assert.deepEqual(historyB.map((message) => message.text).sort(), ['for everyone', 'private from B', 'shared from B'])

  const privateFile = path.join(root, 'private-a.txt')
  fs.writeFileSync(privateFile, 'private attachment')
  await server.publishMessage({
    id: 'private-file-a', conversationId: 'device:phone-device-aaaa', senderId: 'desktop-device', senderName: 'Test Desktop',
    direction: 'outgoing', kind: 'file', attachments: [{ id: 'attachment-private-a', name: 'private-a.txt', size: 18, mime: 'text/plain', path: privateFile }],
    createdAt: now, updatedAt: now, status: 'sent',
  })
  for (let index = 0; index < 1001; index += 1) {
    const createdAt = new Date(Date.parse(now) + index + 1).toISOString()
    await repository.putMessage({
      id: `private-b-noise-${index}`, conversationId: 'device:phone-device-bbbb', senderId: 'phone-device-bbbb', senderName: 'Phone B',
      direction: 'incoming', kind: 'text', text: `B ${index}`, attachments: [], createdAt, updatedAt: createdAt, status: 'received',
    })
  }
  const retainedEnvelope = await (await fetch(`${base}/api/messages`, { headers: { Authorization: `Bearer ${phoneA.token}` } })).json()
  const retainedHistory = decryptJson(phoneA.key, retainedEnvelope.data, `messages:${phoneA.deviceId}`)
  assert.equal(retainedHistory.some((message) => message.id === 'private-file-a'), true)
  assert.equal(retainedHistory.some((message) => message.id.startsWith('private-b-noise-')), false)
  const attachmentForA = await fetch(`${base}/api/attachments/attachment-private-a/meta`, { headers: { Authorization: `Bearer ${phoneA.token}` } })
  const attachmentForB = await fetch(`${base}/api/attachments/attachment-private-a/meta`, { headers: { Authorization: `Bearer ${phoneB.token}` } })
  assert.equal(attachmentForA.status, 200)
  assert.equal(attachmentForB.status, 404)
})

test('manual pairing persists a trusted device that resumes after server restart', async (context) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'device-link-resume-test-'))
  const repository = memoryRepository(root)
  const port = await freePort()
  const events = []
  let server
  const start = () => {
    const credentials = createCredentialStorage({
      dataDir: root,
      safeStorage: undefined,
      legacyKey: crypto.randomBytes(32),
    })
    return createDeviceLinkServer({
      repository,
      deviceId: 'desktop-device',
      deviceName: 'Test Desktop',
      port,
      pairingCode: '834921',
      maxIncomingFileBytes: 10 * 1024 * 1024,
      protectCredential: credentials.seal,
      unprotectCredential: credentials.unseal,
      onEvent(type, data) { events.push({ type, data }) },
    })
  }
  context.after(async () => {
    if (server?.status.running) await server.close()
    fs.rmSync(root, { recursive: true, force: true })
  })

  server = await start()
  const base = `http://127.0.0.1:${port}`
  const paired = await pairTestDevice(server, base, '834921', 'trusted-phone-1234', 'Trusted Phone', 'manual')
  assert.equal(typeof paired.resumeSecret, 'string')
  assert.equal(Buffer.from(paired.resumeSecret, 'base64url').length, 32)
  assert.match(repository.devices[0].resumeCredential, /^local:v2:/)
  assert.equal(repository.devices[0].resumeCredential.includes(paired.resumeSecret), false)
  const connectedEvent = events.find((event) => event.type === 'device:changed')
  assert.equal(Object.hasOwn(connectedEvent.data, 'resumeCredential'), false)
  const originalPairedAt = repository.devices[0].pairedAt

  await server.close()
  server = await start()
  const challengeResponse = await fetch(`${base}/api/resume/challenge`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ deviceId: paired.deviceId }),
  })
  assert.equal(challengeResponse.status, 200)
  const challenge = await challengeResponse.json()
  const proof = resumeProof(paired.resumeSecret, challenge.challengeId, challenge.challenge)
  const resumeResponse = await fetch(`${base}/api/resume`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ deviceId: paired.deviceId, challengeId: challenge.challengeId, proof }),
  })
  assert.equal(resumeResponse.status, 200)
  const resumeBody = await resumeResponse.json()
  const resumed = decryptJson(Buffer.from(paired.resumeSecret, 'base64url'), resumeBody.package, `resume:${paired.deviceId}:${challenge.challengeId}`)
  assert.equal(resumed.deviceId, paired.deviceId)
  assert.notEqual(resumed.token, paired.token)
  assert.equal(repository.devices[0].pairedAt, originalPairedAt)

  const historyResponse = await fetch(`${base}/api/messages`, { headers: { Authorization: `Bearer ${resumed.token}` } })
  assert.equal(historyResponse.status, 200)
  const historyBody = await historyResponse.json()
  assert.deepEqual(decryptJson(Buffer.from(resumed.sessionKey, 'base64url'), historyBody.data, `messages:${resumed.deviceId}`), [])

  const replayResponse = await fetch(`${base}/api/resume`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ deviceId: paired.deviceId, challengeId: challenge.challengeId, proof }),
  })
  assert.equal(replayResponse.status, 401)

  repository.devices.splice(0)
  const removedDeviceResponse = await fetch(`${base}/api/resume/challenge`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ deviceId: paired.deviceId }),
  })
  assert.equal(removedDeviceResponse.status, 401)
})

test('serializes same-device resume and QR pairing credential mutations', async (context) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'device-link-resume-pair-race-test-'))
  const repository = memoryRepository(root)
  const port = await freePort()
  const server = await createDeviceLinkServer({
    repository,
    deviceId: 'desktop-device',
    deviceName: 'Test Desktop',
    port,
    pairingCode: '834921',
    maxIncomingFileBytes: 10 * 1024 * 1024,
    onEvent() {},
  })
  context.after(async () => {
    await server.close()
    fs.rmSync(root, { recursive: true, force: true })
  })

  const base = `http://127.0.0.1:${port}`
  const original = await pairTestDevice(server, base, '834921', 'race-phone-1234', 'Race Phone', 'manual')
  const originalPutDevice = repository.putDevice.bind(repository)
  const originalCredential = repository.devices[0].resumeCredential

  const resumeChallenge = await (await fetch(`${base}/api/resume/challenge`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ deviceId: original.deviceId }),
  })).json()
  const resumeProofValue = resumeProof(original.resumeSecret, resumeChallenge.challengeId, resumeChallenge.challenge)
  let releaseResumeWrite
  const resumeWriteReleased = new Promise((resolve) => { releaseResumeWrite = resolve })
  let signalResumeWrite
  const resumeWriteStarted = new Promise((resolve) => { signalResumeWrite = resolve })
  let resumeWriteBlocked = false
  repository.putDevice = async (device) => {
    if (!resumeWriteBlocked && device.id === original.deviceId && device.resumeCredential === originalCredential) {
      resumeWriteBlocked = true
      signalResumeWrite()
      await resumeWriteReleased
    }
    return originalPutDevice(device)
  }

  try {
    const resumeResponsePromise = fetch(`${base}/api/resume`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ deviceId: original.deviceId, challengeId: resumeChallenge.challengeId, proof: resumeProofValue }),
    })
    await resumeWriteStarted

    const firstQrState = await (await fetch(`${base}/api/pairing`)).json()
    const firstQrPayload = pairRequestPayload(server, firstQrState, {
      deviceId: original.deviceId,
      deviceName: 'Race Phone Repaired',
    })
    let firstQrSettled = false
    const firstQrResponsePromise = postPairing(base, firstQrPayload.body).then((response) => {
      firstQrSettled = true
      return response
    })
    await new Promise((resolve) => setTimeout(resolve, 20))
    assert.equal(firstQrSettled, false, 'QR pairing waits for the in-flight resume write')

    releaseResumeWrite()
    const [resumeResponse, firstQrResponse] = await Promise.all([resumeResponsePromise, firstQrResponsePromise])
    assert.equal(resumeResponse.status, 200)
    assert.equal(firstQrResponse.status, 200)
    const firstQrBody = await firstQrResponse.json()
    const firstQrSession = decryptJson(firstQrPayload.pairKey, firstQrBody.package, `pair:${firstQrState.sessionId}`)
    assert.equal(repository.devices.find((device) => device.id === original.deviceId).resumeCredential, firstQrSession.resumeSecret)

    repository.putDevice = originalPutDevice
    const staleChallenge = await (await fetch(`${base}/api/resume/challenge`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ deviceId: original.deviceId }),
    })).json()
    const staleProof = resumeProof(firstQrSession.resumeSecret, staleChallenge.challengeId, staleChallenge.challenge)
    const secondQrState = await (await fetch(`${base}/api/pairing`)).json()
    const secondQrPayload = pairRequestPayload(server, secondQrState, {
      deviceId: original.deviceId,
      deviceName: 'Race Phone Repaired Again',
    })
    let releaseQrWrite
    const qrWriteReleased = new Promise((resolve) => { releaseQrWrite = resolve })
    let signalQrWrite
    const qrWriteStarted = new Promise((resolve) => { signalQrWrite = resolve })
    let qrWriteBlocked = false
    repository.putDevice = async (device) => {
      if (!qrWriteBlocked && device.id === original.deviceId && device.resumeCredential !== firstQrSession.resumeSecret) {
        qrWriteBlocked = true
        signalQrWrite()
        await qrWriteReleased
      }
      return originalPutDevice(device)
    }

    const secondQrResponsePromise = postPairing(base, secondQrPayload.body)
    await qrWriteStarted
    const staleResumeResponsePromise = fetch(`${base}/api/resume`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ deviceId: original.deviceId, challengeId: staleChallenge.challengeId, proof: staleProof }),
    })
    releaseQrWrite()

    const [secondQrResponse, staleResumeResponse] = await Promise.all([secondQrResponsePromise, staleResumeResponsePromise])
    assert.equal(secondQrResponse.status, 200)
    assert.equal(staleResumeResponse.status, 401)
    const secondQrBody = await secondQrResponse.json()
    const secondQrSession = decryptJson(secondQrPayload.pairKey, secondQrBody.package, `pair:${secondQrState.sessionId}`)
    assert.equal(repository.devices.find((device) => device.id === original.deviceId).resumeCredential, secondQrSession.resumeSecret)
  } finally {
    releaseResumeWrite?.()
    repository.putDevice = originalPutDevice
  }
})

test('explicit revocation waits for an in-flight pairing write and wins', async (context) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'device-link-revoke-pair-race-test-'))
  const repository = memoryRepository(root)
  const port = await freePort()
  const events = []
  const server = await createDeviceLinkServer({
    repository,
    deviceId: 'desktop-device',
    deviceName: 'Test Desktop',
    port,
    pairingCode: '834921',
    maxIncomingFileBytes: 10 * 1024 * 1024,
    onEvent(type, data) { events.push({ type, data }) },
  })
  context.after(async () => {
    await server.close()
    fs.rmSync(root, { recursive: true, force: true })
  })

  const base = `http://127.0.0.1:${port}`
  const original = await pairTestDevice(server, base, '834921', 'revoke-race-phone-1234', 'Revoked Phone', 'manual')
  const originalPutDevice = repository.putDevice.bind(repository)
  const originalCredential = repository.devices[0].resumeCredential
  let releasePairWrite
  const pairWriteReleased = new Promise((resolve) => { releasePairWrite = resolve })
  let signalPairWrite
  const pairWriteStarted = new Promise((resolve) => { signalPairWrite = resolve })
  let pairWriteBlocked = false
  repository.putDevice = async (device) => {
    if (!pairWriteBlocked && device.id === original.deviceId && device.resumeCredential !== originalCredential) {
      pairWriteBlocked = true
      signalPairWrite()
      await pairWriteReleased
    }
    return originalPutDevice(device)
  }

  try {
    const pairingState = await (await fetch(`${base}/api/pairing`)).json()
    const pairingRequest = pairRequestPayload(server, pairingState, {
      deviceId: original.deviceId,
      deviceName: 'Repaired Then Revoked Phone',
    })
    const pairResponsePromise = postPairing(base, pairingRequest.body)
    await pairWriteStarted

    let revokeSettled = false
    const revokePromise = server.revokeDeviceAuthorization(original.deviceId).then((removed) => {
      revokeSettled = true
      return removed
    })
    await new Promise((resolve) => setTimeout(resolve, 20))
    assert.equal(revokeSettled, false, 'revoke waits for the in-flight device credential write')

    releasePairWrite()
    const [pairResponse, removed] = await Promise.all([pairResponsePromise, revokePromise])
    assert.equal(pairResponse.status, 200)
    assert.equal(removed.id, original.deviceId)
    assert.equal(repository.devices.some((device) => device.id === original.deviceId), false)
    assert.equal(events.some((event) => event.type === 'device:deleted' && event.data.id === original.deviceId), true)

    const pairBody = await pairResponse.json()
    const paired = decryptJson(pairingRequest.pairKey, pairBody.package, `pair:${pairingState.sessionId}`)
    const sessionResponse = await fetch(`${base}/api/messages`, {
      headers: { Authorization: `Bearer ${paired.token}` },
    })
    assert.equal(sessionResponse.status, 401)
    const resumeChallengeResponse = await fetch(`${base}/api/resume/challenge`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ deviceId: original.deviceId }),
    })
    assert.equal(resumeChallengeResponse.status, 401)
  } finally {
    releasePairWrite?.()
    repository.putDevice = originalPutDevice
  }
})

test('close waits for a gated WebSocket device write before offline removal', async (context) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'device-link-close-ws-race-test-'))
  const repository = memoryRepository(root)
  const port = await freePort()
  const server = await createDeviceLinkServer({
    repository,
    deviceId: 'desktop-device',
    deviceName: 'Test Desktop',
    port,
    pairingCode: '834921',
    maxIncomingFileBytes: 10 * 1024 * 1024,
    onEvent() {},
  })
  context.after(async () => {
    await server.close()
    fs.rmSync(root, { recursive: true, force: true })
  })

  const base = `http://127.0.0.1:${port}`
  const paired = await pairTestDevice(server, base, '834921', 'close-ws-phone-1234', 'Close Race Phone', 'manual')
  const originalPutDevice = repository.putDevice.bind(repository)
  let releaseRegisterWrite
  const registerWriteReleased = new Promise((resolve) => { releaseRegisterWrite = resolve })
  let signalRegisterWrite
  const registerWriteStarted = new Promise((resolve) => { signalRegisterWrite = resolve })
  let registerWriteBlocked = false
  repository.putDevice = async (device) => {
    if (!registerWriteBlocked && device.id === paired.deviceId) {
      registerWriteBlocked = true
      signalRegisterWrite()
      await registerWriteReleased
    }
    return originalPutDevice(device)
  }

  try {
    const channel = await openTestSocket(port, paired)
    await registerWriteStarted

    let closeSettled = false
    const closeOperation = server.close()
    const closePromise = closeOperation.then(() => { closeSettled = true })
    assert.equal(server.close(), closeOperation, 'repeated close joins the same shutdown operation')
    await new Promise((resolve) => setTimeout(resolve, 20))
    assert.equal(closeSettled, false, 'close waits for the in-flight WebSocket device write')

    releaseRegisterWrite()
    await closePromise
    await assert.rejects(
      server.revokeDeviceAuthorization(paired.deviceId),
      (error) => error?.status === 503 && error.message === '服务正在停止，请稍后重试',
    )
    await repository.removeDevice(paired.deviceId)
    await new Promise((resolve) => setTimeout(resolve, 20))
    assert.equal(repository.devices.some((device) => device.id === paired.deviceId), false)
    channel.socket.terminate()
  } finally {
    releaseRegisterWrite?.()
    repository.putDevice = originalPutDevice
  }
})

test('pairing reports an unavailable credential backend without rotating pairing state', async (context) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'device-link-credential-error-test-'))
  const repository = memoryRepository(root)
  const port = await freePort()
  const errors = []
  const server = await createDeviceLinkServer({
    repository,
    deviceId: 'desktop-device',
    deviceName: 'Test Desktop',
    port,
    pairingCode: '834921',
    maxIncomingFileBytes: 10 * 1024 * 1024,
    protectCredential() { throw new Error('renderer safeStorage is unavailable') },
    onError(error, metadata) { errors.push({ error, metadata }) },
    onEvent() {},
  })
  context.after(async () => {
    await server.close()
    fs.rmSync(root, { recursive: true, force: true })
  })

  const initialSessionId = server.pairing.sessionId
  const { response } = await requestPairing(server, `http://127.0.0.1:${port}`, '834921', 'credential-error-phone', 'Test Phone')
  assert.equal(response.status, 503)
  assert.deepEqual(await response.json(), { error: '电脑端安全存储暂时不可用，请重试' })
  assert.equal(repository.devices.length, 0)
  assert.equal(server.pairing.sessionId, initialSessionId)
  assert.equal(errors.length, 1)
  assert.equal(errors[0].metadata.pathname, '/api/pair')
  assert.equal(errors[0].error.message, 'renderer safeStorage is unavailable')
})

test('pairing rolls back and reports device authorization persistence failures', async (context) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'device-link-storage-error-test-'))
  const repository = memoryRepository(root)
  repository.putDevice = async () => { throw new Error('database unavailable') }
  const port = await freePort()
  const server = await createDeviceLinkServer({
    repository,
    deviceId: 'desktop-device',
    deviceName: 'Test Desktop',
    port,
    pairingCode: '834921',
    maxIncomingFileBytes: 10 * 1024 * 1024,
    protectCredential(value) { return `sealed:${value}` },
    onEvent() {},
  })
  context.after(async () => {
    await server.close()
    fs.rmSync(root, { recursive: true, force: true })
  })

  const initialSessionId = server.pairing.sessionId
  const { response } = await requestPairing(server, `http://127.0.0.1:${port}`, '834921', 'storage-error-phone', 'Test Phone')
  assert.equal(response.status, 503)
  assert.deepEqual(await response.json(), { error: '无法保存设备授权，请检查电脑端存储' })
  assert.equal(repository.devices.length, 0)
  assert.equal(server.pairing.sessionId, initialSessionId)
})

test('failed replacement pairing keeps the previous session active', async (context) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'device-link-replacement-error-test-'))
  const repository = memoryRepository(root)
  const port = await freePort()
  const server = await createDeviceLinkServer({
    repository,
    deviceId: 'desktop-device',
    deviceName: 'Test Desktop',
    port,
    pairingCode: '834921',
    maxIncomingFileBytes: 10 * 1024 * 1024,
    protectCredential(value) { return `sealed:${value}` },
    onEvent() {},
  })
  context.after(async () => {
    await server.close()
    fs.rmSync(root, { recursive: true, force: true })
  })

  const base = `http://127.0.0.1:${port}`
  const original = await pairTestDevice(server, base, '834921', 'replacement-phone-1234', 'Original Phone')
  repository.putDevice = async () => { throw new Error('database unavailable') }
  const { response } = await requestPairing(server, base, '834921', original.deviceId, 'Replacement Phone')
  assert.equal(response.status, 503)
  assert.deepEqual(await response.json(), { error: '无法保存设备授权，请检查电脑端存储' })
  assert.equal(repository.devices.length, 1)
  const originalSessionResponse = await fetch(`${base}/api/messages`, {
    headers: { Authorization: `Bearer ${original.token}` },
  })
  assert.equal(originalSessionResponse.status, 200)
})

test('trusted-device storage read failures return a retryable response', async (context) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'device-link-device-read-error-test-'))
  const repository = memoryRepository(root)
  repository.listDevices = async () => { throw new Error('database unavailable') }
  const port = await freePort()
  const server = await createDeviceLinkServer({
    repository,
    deviceId: 'desktop-device',
    deviceName: 'Test Desktop',
    port,
    pairingCode: '834921',
    maxIncomingFileBytes: 10 * 1024 * 1024,
    onEvent() {},
  })
  context.after(async () => {
    await server.close()
    fs.rmSync(root, { recursive: true, force: true })
  })

  const response = await fetch(`http://127.0.0.1:${port}/api/resume/challenge`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ deviceId: 'trusted-phone-1234' }),
  })
  assert.equal(response.status, 503)
  assert.deepEqual(await response.json(), { error: '无法读取设备授权，请检查电脑端存储' })
})

test('temporary credential backend failures do not invalidate trusted-device proof', async (context) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'device-link-resume-backend-test-'))
  const repository = memoryRepository(root)
  const port = await freePort()
  const protectCredential = (value) => `sealed:${[...value].reverse().join('')}`
  let server = await createDeviceLinkServer({
    repository,
    deviceId: 'desktop-device',
    deviceName: 'Test Desktop',
    port,
    pairingCode: '834921',
    maxIncomingFileBytes: 10 * 1024 * 1024,
    protectCredential,
    onEvent() {},
  })
  context.after(async () => {
    if (server?.status.running) await server.close()
    fs.rmSync(root, { recursive: true, force: true })
  })

  const paired = await pairTestDevice(server, `http://127.0.0.1:${port}`, '834921', 'resume-backend-phone', 'Trusted Phone', 'manual')
  await server.close()
  server = await createDeviceLinkServer({
    repository,
    deviceId: 'desktop-device',
    deviceName: 'Test Desktop',
    port,
    pairingCode: '834921',
    maxIncomingFileBytes: 10 * 1024 * 1024,
    protectCredential,
    unprotectCredential() {
      const error = new Error('credential backend unavailable')
      error.code = 'CREDENTIAL_BACKEND_UNAVAILABLE'
      throw error
    },
    onEvent() {},
  })
  const base = `http://127.0.0.1:${port}`
  const challenge = await (await fetch(`${base}/api/resume/challenge`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ deviceId: paired.deviceId }),
  })).json()
  const proof = resumeProof(paired.resumeSecret, challenge.challengeId, challenge.challenge)
  const response = await fetch(`${base}/api/resume`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ deviceId: paired.deviceId, challengeId: challenge.challengeId, proof }),
  })
  assert.equal(response.status, 503)
  assert.deepEqual(await response.json(), { error: '电脑端安全存储暂时不可用，请稍后重试' })
  assert.equal(repository.devices.length, 1)
})
