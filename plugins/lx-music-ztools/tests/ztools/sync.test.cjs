const { test } = require('node:test')
const assert = require('node:assert/strict')
const http = require('node:http')
const { once } = require('node:events')
const { mkdtempSync } = require('node:fs')
const { tmpdir } = require('node:os')
const { join } = require('node:path')
const { createBridge } = require('../../src-ztools/preload/runtime/bridge.cjs')
const { initializeRuntime } = require('../../src-ztools/preload/runtime/index.cjs')

test('sync is opt-in, validates ports, serializes lifecycle, cleans failed listeners and does not bind window close', { timeout: 15000 }, async t => {
  const { createSync } = require('../../src-ztools/preload/runtime/sync/index.cjs')
  const bridge = createBridge()
  const runtime = initializeRuntime({ bridge, directory: mkdtempSync(join(tmpdir(), 'lx-sync-unit-')) })
  const sync = runtime.sync || createSync({ bridge })
  t.after(async () => { await sync.dispose(); await runtime.dispose() })
  const context = require('../../src-ztools/preload/runtime/context.cjs')
  assert.equal(sync.getStatus().status, false)
  assert.equal(context.lx.event_app.listenerCount('main_window_close'), 0)
  for (const port of ['NaN', 0, -1, 65536, '12.4', ' 123 ']) await assert.rejects(sync.start({ mode: 'server', enable: true, port }), /port|端口/)
  const reservation = http.createServer()
  t.after(() => reservation.listening ? new Promise(resolve => reservation.close(resolve)) : undefined)
  reservation.listen(0, '0.0.0.0'); await once(reservation, 'listening')
  const port = reservation.address().port
  await assert.rejects(sync.start({ mode: 'server', port: String(port) }), /EADDRINUSE|in use/)
  assert.match(sync.getStatus().message, /EADDRINUSE|in use/)
  await new Promise(resolve => reservation.close(resolve))
  const snapshots = []
  const off = sync.subscribe(status => snapshots.push(status))
  await sync.start({ mode: 'server', port })
  assert.equal(sync.getStatus().status, true)
  assert.match(await (await fetch(`http://127.0.0.1:${port}/hello`)).text(), /Hello.*v4/)
  context.lx.event_app.emit('main_window_close')
  assert.equal(sync.getStatus().status, true)
  await Promise.all([sync.stop(), sync.start({ mode: 'server', port }), sync.stop()])
  assert.equal(sync.getStatus().status, false)
  assert.equal(snapshots.some(s => s.status), true)
  assert.equal(snapshots.find(s => s.status).status, true, 'historical snapshots remain immutable')
  off()
  reservation.listen(port); await once(reservation, 'listening')
  await new Promise(resolve => reservation.close(resolve))
})

test('sync HTTP adapter preserves raw numeric/base64 text and cancels its own pending authentication', async t => {
  const context = require('../../src-ztools/preload/runtime/context.cjs')
  const { createNetwork } = require('../../src-ztools/preload/runtime/network.cjs')
  const { httpFetch, cancelRequests } = require('../../src-ztools/preload/runtime/sync/request.cjs')
  const network = createNetwork()
  context.lx = { network }
  const sockets = new Set()
  const server = http.createServer((req, res) => { if (req.url === '/pending') return; res.end(req.url === '/numeric' ? '123456' : 'YWJjZA==') })
  server.on('connection', socket => { sockets.add(socket); socket.on('close', () => sockets.delete(socket)) })
  server.listen(0, '127.0.0.1'); await once(server, 'listening')
  t.after(async () => { network.dispose(); context.lx = null; for (const socket of sockets) socket.destroy(); await new Promise(resolve => server.close(resolve)) })
  const base = `http://127.0.0.1:${server.address().port}`
  assert.equal((await httpFetch(base + '/numeric')).body, '123456')
  assert.equal((await httpFetch(base + '/base64')).body, 'YWJjZA==')
  const pending = httpFetch(base + '/pending')
  cancelRequests()
  await assert.rejects(pending, /取消/)
})

test('sync storage flush persists the latest throttled state and propagates write failures', async () => {
  const fs = require('node:fs')
  const { throttle, writeFile, flush } = require('../../src-ztools/preload/runtime/sync/storage.cjs')
  const directory = mkdtempSync(join(tmpdir(), 'lx-sync-storage-'))
  const file = join(directory, 'snapshot.json')
  const save = throttle(value => writeFile(file, value, () => {}), 10000)
  save('first'); save('latest')
  await flush()
  assert.equal(fs.readFileSync(file, 'utf8'), 'latest')
  writeFile(join(directory, 'missing', 'devices.json'), '{}', () => {})
  await assert.rejects(flush(), /认证数据保存失败/)
  fs.mkdirSync(join(directory, 'missing'))
  await flush()
  assert.equal(fs.readFileSync(join(directory, 'missing', 'devices.json'), 'utf8'), '{}')
})

test('sync host patches reject upstream source drift and retain wire/merge modules byte-for-byte', () => {
  const { adaptSyncSource } = require('../../src-ztools/preload/runtime/sync/adapt-source.cjs')
  const fs = require('node:fs')
  const root = join(__dirname, '../../vendor/lx/src/')
  for (const file of ['main/modules/sync/server/utils/tools.ts', 'main/modules/sync/server/modules/list/sync/sync.ts', 'main/modules/sync/server/modules/dislike/sync/sync.ts', 'main/modules/sync/utils.ts']) {
    const source = fs.readFileSync(join(root, file), 'utf8').replaceAll('\r\n', '\n')
    assert.equal(adaptSyncSource(file, source), source)
  }
  assert.throws(() => adaptSyncSource('main/modules/sync/client/client.ts', 'upstream changed'), /shape changed/)
  for (const file of ['main/modules/sync/server/user/data.ts', 'main/modules/sync/server/server/auth.ts']) assert.throws(() => adaptSyncSource(file, 'upstream changed'), /shape changed/)
})

test('concurrent snapshot pruning retains protected device snapshots and flush drains maintenance', async () => {
  const fs = require('node:fs')
  const context = require('../../src-ztools/preload/runtime/context.cjs')
  const storage = require('../../src-ztools/preload/runtime/sync/storage.cjs')
  context.lx = { appSetting: { 'sync.server.maxSsnapshotNum': 1 } }
  const { SnapshotDataManage } = require('../../src-ztools/preload/upstream/main/modules/sync/server/modules/list/snapshotDataManage.cjs')
  const manager = new SnapshotDataManage({ userDir: mkdtempSync(join(tmpdir(), 'lx-sync-prune-')), userName: 'default' })
  manager.snapshotInfo = { latest: 'current', time: 0, list: ['a', 'b', 'protected'], clients: { device: { snapshotKey: 'protected', lastSyncDate: 0 } } }
  manager.clientSnapshotKeys = ['protected']
  for (const name of ['a', 'b', 'protected', 'current']) fs.writeFileSync(join(manager.snapshotDir, 'snapshot_' + name), '{}')
  try {
    await Promise.all([manager.clearOldSnapshot(), manager.clearOldSnapshot()])
    await storage.flush()
    assert.deepEqual(manager.snapshotInfo.list, ['a', 'protected'])
    assert.equal(fs.existsSync(join(manager.snapshotDir, 'snapshot_protected')), true)
  } finally { context.lx = null }
})

test('concurrent snapshot creation records a previous snapshot only once', async () => {
  const context = require('../../src-ztools/preload/runtime/context.cjs')
  const storage = require('../../src-ztools/preload/runtime/sync/storage.cjs')
  const bridge = createBridge()
  const directory = mkdtempSync(join(tmpdir(), 'lx-sync-create-'))
  const runtime = initializeRuntime({ bridge, directory })
  const { ListManage } = require('../../src-ztools/preload/upstream/main/modules/sync/server/modules/list/manage.cjs')
  context.lx.appSetting['sync.server.maxSsnapshotNum'] = 100
  const manager = new ListManage({ userDir: directory, userName: 'default' })
  manager.snapshotDataManage.snapshotInfo.latest = 'previous'
  try {
    const keys = await Promise.all([manager.createSnapshot(), manager.createSnapshot()])
    await storage.flush()
    assert.equal(keys[0], keys[1])
    assert.deepEqual(manager.snapshotDataManage.snapshotInfo.list, ['previous'])
  } finally { await runtime.dispose() }
})

test('terminating the production runtime process releases its sync listener', { timeout: 10000 }, async t => {
  const { spawn } = require('node:child_process')
  const reservation = http.createServer()
  reservation.listen(0, '0.0.0.0'); await once(reservation, 'listening')
  const port = reservation.address().port
  await new Promise(resolve => reservation.close(resolve))
  const directory = mkdtempSync(join(tmpdir(), 'lx-sync-kill-'))
  const source = `
    const {createBridge}=require('./src-ztools/preload/runtime/bridge.cjs');
    const {initializeRuntime}=require('./src-ztools/preload/runtime/index.cjs');
    const runtime=initializeRuntime({bridge:createBridge(),directory:${JSON.stringify(directory)}});
    runtime.sync.start({mode:'server',port:${port}}).then(()=>process.send({ready:true}),error=>process.send({error:error.message}));
  `
  const child = spawn(process.execPath, ['-e', source], { cwd: join(__dirname, '../..'), windowsHide: true, stdio: ['ignore', 'ignore', 'ignore', 'ipc'] })
  t.after(async () => { if (child.exitCode == null && child.signalCode == null) { child.kill(); await once(child, 'exit') } })
  const [message] = await once(child, 'message')
  assert.equal(message.ready, true, message.error)
  assert.equal(await (await fetch(`http://127.0.0.1:${port}/hello`)).text(), 'Hello~::^-^::~v4~')
  const exited = once(child, 'exit'); child.kill(); await exited
  reservation.listen(port, '0.0.0.0'); await once(reservation, 'listening')
  await new Promise(resolve => reservation.close(resolve))
})

for (const kind of ['list', 'dislike']) test(`${kind} snapshot promotion shares the pruning critical section and never points latest at an unlinked file`, { timeout: 5000 }, async () => {
  const fs = require('node:fs')
  const { createHash } = require('node:crypto')
  const context = require('../../src-ztools/preload/runtime/context.cjs')
  const storage = require('../../src-ztools/preload/runtime/sync/storage.cjs')
  const directory = mkdtempSync(join(tmpdir(), 'lx-sync-promote-prune-'))
  const runtime = initializeRuntime({ bridge: createBridge(), directory })
  const Manager = require(`../../src-ztools/preload/upstream/main/modules/sync/server/modules/${kind}/manage.cjs`)[kind === 'list' ? 'ListManage' : 'DislikeManage']
  context.lx.appSetting['sync.server.maxSsnapshotNum'] = 10
  const manager = new Manager({ userDir: directory, userName: 'default' })
  const snapshots = manager.snapshotDataManage
  const data = kind === 'list' ? JSON.stringify(await manager.getListData()) : await manager.getDislikeRules()
  const restoredKey = createHash('md5').update(data).digest('hex')
  const history = [...Array.from({ length: 10 }, (_, i) => 'history-' + i), restoredKey]
  snapshots.snapshotInfo = { latest: 'previous-latest', time: 0, list: history, clients: {} }
  for (const key of [...history, 'previous-latest']) fs.writeFileSync(join(snapshots.snapshotDir, 'snapshot_' + key), key === restoredKey ? data : '{}')
  let entered, release
  const removing = new Promise(resolve => { entered = resolve })
  const barrier = new Promise(resolve => { release = resolve })
  const remove = snapshots.removeSnapshot
  snapshots.removeSnapshot = async key => { if (key === restoredKey) { entered(); await barrier } return remove(key) }
  try {
    const pruning = snapshots.clearOldSnapshot()
    await removing
    const promotion = manager.createSnapshot()
    await new Promise(resolve => setImmediate(resolve))
    release()
    const [, createdKey] = await Promise.all([pruning, promotion])
    await storage.flush()
    assert.equal(createdKey, restoredKey)
    assert.equal(snapshots.snapshotInfo.latest, restoredKey)
    assert.equal(fs.existsSync(join(snapshots.snapshotDir, 'snapshot_' + restoredKey)), true, 'latest must reference a real snapshot after prune/promotion interleaving')
    assert.equal(fs.readFileSync(join(snapshots.snapshotDir, 'snapshot_' + restoredKey), 'utf8'), data)
    assert.ok(snapshots.snapshotInfo.list.includes('history-8'), 'the old splice(-1) path must not remove an unrelated retained history')
  } finally { release(); await runtime.dispose() }
})

for (const change of ['stop', 'reconfigure', 'dispose']) test(`${change} cancels pending authentication before joining the lifecycle queue`, { timeout: 10000 }, async () => {
  const sockets = new Set()
  const server = http.createServer(() => {})
  server.on('connection', socket => { sockets.add(socket); socket.on('close', () => sockets.delete(socket)) })
  server.listen(0, '127.0.0.1'); await once(server, 'listening')
  const runtime = initializeRuntime({ bridge: createBridge(), directory: mkdtempSync(join(tmpdir(), 'lx-sync-cancel-')) })
  const { sync } = runtime
  const requested = once(server, 'request')
  const starting = sync.start({ mode: 'client', host: `http://127.0.0.1:${server.address().port}` }).then(() => null, error => error)
  await requested
  let port
  if (change === 'reconfigure') {
    const reservation = http.createServer(); reservation.listen(0, '0.0.0.0'); await once(reservation, 'listening')
    port = reservation.address().port; await new Promise(resolve => reservation.close(resolve))
  }
  const operation = change === 'reconfigure' ? sync.start({ mode: 'server', port }) : sync[change]()
  let timely
  try {
    timely = await Promise.race([operation.then(() => true), new Promise(resolve => setTimeout(() => resolve(false), 150))])
    if (timely && change === 'reconfigure') assert.equal(await (await fetch(`http://127.0.0.1:${port}/hello`)).text(), 'Hello~::^-^::~v4~')
  } finally {
    for (const socket of sockets) socket.destroy()
    await starting; await operation
    await runtime.dispose(); await new Promise(resolve => server.close(resolve))
  }
  assert.equal(timely, true, `${change} must cancel authentication without waiting for its 10 second timeout`)
})

test('dispose always removes subscriptions after flush failure and retries the unsaved write', async () => {
  const fs = require('node:fs')
  const storage = require('../../src-ztools/preload/runtime/sync/storage.cjs')
  const { WIN_MAIN_RENDERER_EVENT_NAME: names } = require('../../src-ztools/preload/upstream/common/ipcNames.cjs')
  const directory = mkdtempSync(join(tmpdir(), 'lx-sync-dispose-failed-'))
  const bridge = createBridge()
  const runtime = initializeRuntime({ bridge, directory })
  let notifications = 0
  runtime.sync.subscribe(() => { notifications++ })
  const target = join(directory, 'missing', 'devices.json')
  storage.writeFile(target, '{"retry":"latest-state"}', () => {})
  try {
    const disposing = runtime.sync.dispose()
    assert.equal(runtime.sync.dispose(), disposing, 'concurrent disposal must share the same settlement')
    await assert.rejects(disposing, /认证数据保存失败/)
    notifications = 0
    bridge.emit(names.sync_action, { action: 'server_status', data: { status: false, message: '' } })
    const leaked = notifications
    fs.mkdirSync(join(directory, 'missing'))
    await runtime.sync.dispose()
    assert.equal(leaked, 0, 'flush failure must still detach the bridge listener and subscribers')
    assert.equal(fs.readFileSync(target, 'utf8'), '{"retry":"latest-state"}', 'retry must persist the original failed write before reporting disposal success')
  } finally {
    fs.mkdirSync(join(directory, 'missing'), { recursive: true })
    await storage.flush(); await runtime.dispose()
  }
})

for (const ordering of ['new-before-flush', 'flush-before-new']) test(`flush never retries superseded failed metadata (${ordering})`, async () => {
  const fs = require('node:fs')
  const storage = require('../../src-ztools/preload/runtime/sync/storage.cjs')
  const target = join(mkdtempSync(join(tmpdir(), 'lx-sync-retry-order-')), 'devices.json')
  const originalWrite = fs.writeFile
  const issued = [], pending = []
  let failed = false
  fs.writeFile = (...args) => {
    if (String(args[0]) !== target) return originalWrite(...args)
    const callback = args.pop()
    if (!failed) { failed = true; queueMicrotask(() => callback(Object.assign(new Error('injected ENOSPC'), { code: 'ENOSPC' }))); return }
    issued.push(String(args[1]))
    pending.push(() => new Promise(resolve => originalWrite(...args, error => { callback(error); resolve() })))
  }
  try {
    await new Promise(resolve => storage.writeFile(target, 'old-state', error => { if (error) assert.equal(error.code, 'ENOSPC'); resolve() }))
    await new Promise(resolve => setImmediate(resolve))
    let flushing
    if (ordering === 'flush-before-new') flushing = storage.flush()
    storage.writeFile(target, 'new-state', () => {})
    if (!flushing) flushing = storage.flush()
    await new Promise(resolve => setImmediate(resolve))
    // Real filesystem writes complete in the exact bad order: B first, then any
    // stale A that flush incorrectly submitted behind B.
    while (pending.length) { await pending.shift()(); await new Promise(resolve => setImmediate(resolve)) }
    await flushing
    assert.deepEqual(issued, ['new-state'], 'the obsolete failed A must never be submitted after B')
    assert.equal(fs.readFileSync(target, 'utf8'), 'new-state')
  } finally { fs.writeFile = originalWrite; await storage.flush() }
})

test('actual writes to one metadata file finish in submission order', async () => {
  const fs = require('node:fs')
  const storage = require('../../src-ztools/preload/runtime/sync/storage.cjs')
  const target = join(mkdtempSync(join(tmpdir(), 'lx-sync-file-queue-')), 'devices.json')
  const originalWrite = fs.writeFile
  const pending = [], issued = []
  fs.writeFile = (...args) => {
    if (String(args[0]) !== target) return originalWrite(...args)
    const callback = args.pop()
    issued.push(String(args[1]))
    pending.push(() => new Promise(resolve => originalWrite(...args, error => { callback(error); resolve() })))
  }
  try {
    storage.writeFile(target, 'first', () => {})
    storage.writeFile(target, 'latest', () => {})
    await new Promise(resolve => setImmediate(resolve))
    assert.deepEqual(issued, ['first'], 'the second actual fs.writeFile must wait for the first callback')
    while (pending.length) { await pending.shift()(); await new Promise(resolve => setImmediate(resolve)) }
    await storage.flush()
    assert.deepEqual(issued, ['first', 'latest'])
    assert.equal(fs.readFileSync(target, 'utf8'), 'latest')
  } finally {
    while (pending.length) { await pending.shift()(); await new Promise(resolve => setImmediate(resolve)) }
    fs.writeFile = originalWrite; await storage.flush()
  }
})

test('stop during server migration prevents an obsolete listener from becoming ready', async () => {
  const migration = require('../../src-ztools/preload/upstream/main/modules/sync/migrate.cjs')
  const original = migration.default
  const { WIN_MAIN_RENDERER_EVENT_NAME: names } = require('../../src-ztools/preload/upstream/common/ipcNames.cjs')
  const bridge = createBridge()
  const runtime = initializeRuntime({ bridge, directory: mkdtempSync(join(tmpdir(), 'lx-sync-server-preflight-')) })
  const reservation = http.createServer(); reservation.listen(0, '0.0.0.0'); await once(reservation, 'listening')
  const port = reservation.address().port; await new Promise(resolve => reservation.close(resolve))
  let entered, release, wasReady = false
  const preparing = new Promise(resolve => { entered = resolve })
  const barrier = new Promise(resolve => { release = resolve })
  migration.default = async (...args) => { entered(); await barrier; return original(...args) }
  const off = bridge.subscribe(names.sync_action, event => { if (event.action === 'server_status' && event.data.status) wasReady = true })
  try {
    const starting = runtime.sync.start({ mode: 'server', port })
    await preparing
    const stopping = runtime.sync.stop(); release()
    await Promise.all([starting, stopping])
    assert.equal(wasReady, false, 'cancelled preflight must not open and publish a listener before queued stop')
  } finally { release(); migration.default = original; off(); await runtime.dispose() }
})

for (const stage of ['preflight flush', 'client migration']) test(`stop during ${stage} prevents a superseded start from issuing fresh authentication`, { timeout: 5000 }, async () => {
  const storage = require('../../src-ztools/preload/runtime/sync/storage.cjs')
  const migration = require('../../src-ztools/preload/upstream/main/modules/sync/migrate.cjs')
  const owner = stage === 'preflight flush' ? storage : migration
  const method = stage === 'preflight flush' ? 'flush' : 'default'
  const original = owner[method]
  const server = http.createServer(() => {})
  const sockets = new Set()
  let requests = 0, entered, release, paused = false
  server.on('request', () => { requests++ })
  server.on('connection', socket => { sockets.add(socket); socket.on('close', () => sockets.delete(socket)) })
  server.listen(0, '127.0.0.1'); await once(server, 'listening')
  const runtime = initializeRuntime({ bridge: createBridge(), directory: mkdtempSync(join(tmpdir(), 'lx-sync-preflight-')) })
  const barrier = new Promise(resolve => { release = resolve })
  const preparing = new Promise(resolve => { entered = resolve })
  owner[method] = async (...args) => { if (!paused) { paused = true; entered(); await barrier } return original(...args) }
  const starting = runtime.sync.start({ mode: 'client', host: `http://127.0.0.1:${server.address().port}` }).catch(error => error)
  await preparing
  const stopping = runtime.sync.stop()
  release()
  let timely
  try {
    timely = await Promise.race([stopping.then(() => true), new Promise(resolve => setTimeout(() => resolve(false), 150))])
  } finally {
    owner[method] = original
    for (const socket of sockets) socket.destroy()
    await starting; await stopping; await runtime.dispose()
    await new Promise(resolve => server.close(resolve))
  }
  assert.equal(requests, 0, 'requestStartedAfterStop must remain false')
  assert.equal(timely, true, 'stop must not wait for authentication that began after cancellation')
})
