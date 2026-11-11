const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const http = require('node:http')
const { once } = require('node:events')
const { tmpdir } = require('node:os')
const { join } = require('node:path')
const { createHash, generateKeyPairSync, privateDecrypt } = require('node:crypto')
const { createBridge } = require('../../src-ztools/preload/runtime/bridge.cjs')
const { initializeRuntime } = require('../../src-ztools/preload/runtime/index.cjs')
const storage = require('../../src-ztools/preload/runtime/sync/storage.cjs')
const dataPath = '../../src-ztools/preload/upstream/main/modules/sync/server/user/data.cjs'

function fixture(t) {
  for (const key of Object.keys(require.cache)) if (key.includes(join('upstream', 'main', 'modules', 'sync') + require('node:path').sep)) delete require.cache[key]
  const directory = fs.mkdtempSync(join(tmpdir(), 'lx-sync-auth-commit-'))
  const runtime = initializeRuntime({ bridge: createBridge(), directory })
  const data = require(dataPath)
  t.after(() => runtime.dispose())
  fs.mkdirSync(join(directory, 'sync/server'), { recursive: true })
  return { runtime, data, directory, file: join(directory, 'sync/server/devices.json'), identity: join(directory, 'sync/server/serverInfo.json') }
}
const key = id => ({ clientId: id, key: Buffer.alloc(16, 1).toString('base64'), deviceName: id, isMobile: false, lastConnectDate: 0 })
const reopened = x => new x.data.UserDataManage('default')
async function listen(x) {
  const reservation = http.createServer().listen(0, '127.0.0.1'); await once(reservation, 'listening')
  const port = reservation.address().port; await new Promise(resolve => reservation.close(resolve))
  await x.runtime.sync.start({ mode: 'server', port })
  return `http://127.0.0.1:${port}`
}
function pairing(x) {
  const { aesEncrypt } = require('../../src-ztools/preload/upstream/main/modules/sync/server/utils/tools.cjs')
  const { publicKey, privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048, publicKeyEncoding: { type: 'spki', format: 'pem' }, privateKeyEncoding: { type: 'pkcs8', format: 'pem' } })
  const password = x.runtime.sync.getStatus().code
  const secret = Buffer.from(createHash('md5').update(password).digest('hex').slice(0, 16)).toString('base64')
  const publicData = publicKey.split('\n').filter(line => line && !line.startsWith('---')).join('')
  return { headers: { m: aesEncrypt(`lx-music auth::\n${publicData}\nCommit fixture\nlx_music_desktop`, secret) }, decode: text => JSON.parse(privateDecrypt(privateKey, Buffer.from(text, 'base64')).toString()) }
}

test('new authentication HTTP 200 already contains a recoverable key without dispose or flush', async t => {
  const x = fixture(t), address = await listen(x), pair = pairing(x)
  const response = await fetch(address + '/ah', { headers: pair.headers })
  assert.equal(response.status, 200)
  const granted = pair.decode(await response.text())
  assert.equal(fs.existsSync(x.file), true, 'HTTP success must wait for devices.json publication')
  assert.equal(reopened(x).getClientKeyInfo(granted.clientId)?.key, granted.key)
})

test('business removeDevice success is immediately recoverable without dispose or flush', async t => {
  const x = fixture(t)
  const users = require('../../src-ztools/preload/upstream/main/modules/sync/server/user/index.cjs')
  await users.getUserSpace().dataManage.saveClientKeyInfo(key('revoked')); await storage.flush()
  await x.runtime.sync.removeDevice('revoked')
  assert.equal(users.getUserSpace().dataManage.getClientKeyInfo('revoked'), null)
  assert.equal(reopened(x).getClientKeyInfo('revoked'), null, 'reopening committed bytes must reject revoked credentials immediately')
})

test('first server identity and version are durable on completion, with no shutdown hook', async t => {
  const x = fixture(t)
  await x.data.initServerInfo()
  assert.equal(fs.existsSync(x.identity), true, 'initial identity must be published before it is usable')
  const id = x.data.getServerId()
  assert.equal(JSON.parse(fs.readFileSync(x.identity)).serverId, id)
  await x.data.setVersion(3)
  assert.equal(JSON.parse(fs.readFileSync(x.identity)).version, 3)
  delete require.cache[require.resolve(dataPath)]
  const restarted = require(dataPath); await restarted.initServerInfo()
  assert.equal(restarted.getServerId(), id)
  assert.equal(await restarted.getVersion(), 3)
})

test('authentication persistence failure rejects the HTTP success boundary and leaves disk/memory unchanged', async t => {
  const x = fixture(t), address = await listen(x), pair = pairing(x)
  const previous = fs.existsSync(x.file) ? fs.readFileSync(x.file, 'utf8') : null
  const rename = fs.promises.rename, write = fs.writeFile
  const failure = () => Object.assign(new Error('injected auth ENOSPC'), { code: 'ENOSPC' })
  fs.promises.rename = async (from, to) => { if (to === x.file) throw failure(); return rename(from, to) }
  fs.writeFile = (...args) => { if (String(args[0]) === x.file) { args.at(-1)(failure()); return } return write(...args) }
  try {
    const response = await fetch(address + '/ah', { headers: pair.headers })
    assert.equal(response.status, 500, 'write failure must never grant HTTP 200')
    assert.equal((await x.runtime.sync.devices()).length, 0)
    assert.equal(fs.existsSync(x.file) ? fs.readFileSync(x.file, 'utf8') : null, previous)
    assert.equal(fs.readdirSync(join(x.directory, 'sync/server')).some(name => name.endsWith('.tmp')), false)
  } finally { fs.promises.rename = rename; fs.writeFile = write }
  await storage.flush()
  assert.equal(fs.existsSync(x.file) ? fs.readFileSync(x.file, 'utf8') : null, previous, 'shutdown flush must never resurrect a failed grant')
})

test('revoke write failure propagates to the business caller and retains the previously committed authorization', async t => {
  const x = fixture(t), users = require('../../src-ztools/preload/upstream/main/modules/sync/server/user/index.cjs')
  const manager = users.getUserSpace().dataManage
  await manager.saveClientKeyInfo(key('keep')); await storage.flush()
  const original = fs.readFileSync(x.file, 'utf8'), rename = fs.promises.rename
  fs.promises.rename = async (from, to) => { if (to === x.file) throw new Error('injected revoke ENOSPC'); return rename(from, to) }
  try {
    await assert.rejects(x.runtime.sync.removeDevice('keep'), /revoke ENOSPC/)
    assert.equal(manager.getClientKeyInfo('keep')?.clientId, 'keep')
    assert.equal(fs.readFileSync(x.file, 'utf8'), original)
    assert.equal(reopened(x).getClientKeyInfo('keep')?.clientId, 'keep')
  } finally { fs.promises.rename = rename }
})

test('first identity write failure cannot publish a temporary server identity or listener', async t => {
  const x = fixture(t), rename = fs.promises.rename
  fs.promises.rename = async (from, to) => { if (to === x.identity) throw new Error('injected identity ENOSPC'); return rename(from, to) }
  try {
    await assert.rejects(listen(x), /identity ENOSPC/)
    assert.equal(x.runtime.sync.getStatus().status, false)
    assert.equal(fs.existsSync(x.identity), false)
    assert.throws(() => x.data.getServerId(), /identity|身份|serverId|undefined/)
  } finally { fs.promises.rename = rename }
  await x.data.initServerInfo()
  assert.equal(JSON.parse(fs.readFileSync(x.identity)).serverId, x.data.getServerId())
})

test('concurrent pairing, revocation and replacement cannot be overwritten by an older write', async t => {
  const x = fixture(t), manager = reopened(x)
  await Promise.all([
    manager.saveClientKeyInfo(key('old')),
    manager.removeClientKeyInfo('old'),
    manager.saveClientKeyInfo(key('replacement')),
  ])
  assert.equal(fs.existsSync(x.file), true)
  const state = reopened(x)
  assert.equal(state.getClientKeyInfo('old'), null)
  assert.equal(state.getClientKeyInfo('replacement')?.clientId, 'replacement')
  assert.deepEqual(manager.getAllClientKeyInfo(), state.getAllClientKeyInfo())
})

test('client local pairing commits atomically before authentication returns and rolls back a failed replacement', async t => {
  const x = fixture(t), address = await listen(x)
  const client = require('../../src-ztools/preload/upstream/main/modules/sync/client/data.cjs')
  const handleAuth = require('../../src-ztools/preload/upstream/main/modules/sync/client/auth.cjs').default
  const { parseUrl } = require('../../src-ztools/preload/upstream/main/modules/sync/client/utils.cjs')
  const file = join(x.directory, 'sync/client/syncAuthKey.json')
  const info = await handleAuth(parseUrl(address), x.runtime.sync.getStatus().code)
  const serverId = x.data.getServerId()
  assert.equal(JSON.parse(fs.readFileSync(file))[serverId].key, info.key)
  const before = fs.readFileSync(file, 'utf8'), rename = fs.promises.rename
  fs.promises.rename = async (from, to) => { if (to === file) throw new Error('injected client ENOSPC'); return rename(from, to) }
  try {
    await assert.rejects(handleAuth(parseUrl(address), x.runtime.sync.getStatus().code), /client ENOSPC/)
    assert.equal((await client.getSyncAuthKey(serverId)).key, info.key, 'failed replacement must retain committed client memory')
    assert.equal(fs.readFileSync(file, 'utf8'), before)
  } finally { fs.promises.rename = rename }
})

test('client concurrent identity/key writes preserve other pairings and the latest committed replacement', async t => {
  const x = fixture(t), client = require('../../src-ztools/preload/upstream/main/modules/sync/client/data.cjs')
  await client.initClientInfo()
  await Promise.all([
    client.setSyncAuthKey('one', key('old')),
    client.setSyncAuthKey('two', key('other')),
    client.setSyncAuthKey('one', key('new')),
  ])
  const state = JSON.parse(fs.readFileSync(join(x.directory, 'sync/client/syncAuthKey.json')))
  assert.equal(state.one.clientId, 'new'); assert.equal(state.two.clientId, 'other')
  assert.deepEqual(await client.getSyncAuthKey('one'), state.one)
})

test('partial temporary authentication write cannot corrupt committed JSON or publish mutated memory', async t => {
  const x = fixture(t), manager = reopened(x)
  await manager.saveClientKeyInfo(key('committed'))
  const before = fs.readFileSync(x.file, 'utf8'), open = fs.promises.open
  fs.promises.open = async (...args) => {
    const handle = await open(...args)
    if (String(args[0]).startsWith(x.file + '.')) {
      handle.writeFile = async () => { await handle.write('{partial'); throw new Error('injected partial write') }
    }
    return handle
  }
  try {
    await assert.rejects(manager.saveClientKeyInfo(key('failed')), /partial write/)
    assert.equal(fs.readFileSync(x.file, 'utf8'), before)
    assert.equal(manager.getClientKeyInfo('failed'), null)
    assert.equal(reopened(x).getClientKeyInfo('failed'), null)
    assert.equal(fs.readdirSync(join(x.directory, 'sync/server')).some(name => name.endsWith('.tmp')), false)
  } finally { fs.promises.open = open }
})

test('a delayed prior key update cannot overtake revocation and fresh pairing, including stale connection metadata', async t => {
  const x = fixture(t), manager = reopened(x), rename = fs.promises.rename
  await manager.saveClientKeyInfo(key('old'))
  let enter, release, held = false
  const entered = new Promise(resolve => { enter = resolve }), barrier = new Promise(resolve => { release = resolve })
  fs.promises.rename = async (from, to) => {
    if (to === x.file && !held) { held = true; enter(); await barrier }
    return rename(from, to)
  }
  try {
    const old = manager.updateClientKeyInfo({ ...key('old'), deviceName: 'late metadata' })
    await entered
    const revoke = manager.removeClientKeyInfo('old'), pair = manager.saveClientKeyInfo(key('replacement'))
    release(); await Promise.all([old, revoke, pair])
    assert.equal(await manager.updateClientKeyInfo(key('old')), false, 'old connection metadata must not re-add revoked keys')
    await storage.flush()
    const recovered = reopened(x)
    assert.equal(recovered.getClientKeyInfo('old'), null)
    assert.equal(recovered.getClientKeyInfo('replacement')?.clientId, 'replacement')
    assert.deepEqual(manager.getAllClientKeyInfo(), recovered.getAllClientKeyInfo())
  } finally { release(); fs.promises.rename = rename }
})

test('immediate revoke during a pending WebSocket metadata commit cannot fail or authenticate after revocation', { timeout: 5000 }, async t => {
  const x = fixture(t), address = await listen(x)
  const users = require('../../src-ztools/preload/upstream/main/modules/sync/server/user/index.cjs')
  const { aesEncrypt } = require('../../src-ztools/preload/upstream/main/modules/sync/server/utils/tools.cjs')
  const info = key('connecting'); await users.getUserSpace().dataManage.saveClientKeyInfo(info)
  const rename = fs.promises.rename
  let enter, release, held = false
  const entered = new Promise(resolve => { enter = resolve }), barrier = new Promise(resolve => { release = resolve })
  fs.promises.rename = async (from, to) => { if (to === x.file && !held) { held = true; enter(); await barrier }; return rename(from, to) }
  const WebSocket = require(require.resolve('ws', { paths: [join(__dirname, '../../src-ztools/preload')] }))
  const socket = new WebSocket(address.replace('http:', 'ws:') + '/?i=' + info.clientId + '&t=' + encodeURIComponent(aesEncrypt('lx-music connect', info.key)))
  socket.on('error', () => {})
  try {
    await once(socket, 'open'); await entered
    const removal = x.runtime.sync.removeDevice(info.clientId)
    // Observe the outcome before releasing the older write, without allowing an
    // early rejection to become an unhandled promise.
    const outcome = removal.then(() => null, error => error)
    release()
    assert.equal(await outcome, null, 'revoke must tolerate a not-yet-ready socket in wss.clients')
    assert.equal(reopened(x).getClientKeyInfo(info.clientId), null)
    assert.equal(users.getUserSpace().dataManage.getClientKeyInfo(info.clientId), null)
    assert.equal(x.runtime.sync.getStatus().devices.some(device => device.clientId === info.clientId), false)
  } finally { release(); socket.terminate(); fs.promises.rename = rename }
})
