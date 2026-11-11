const { test } = require('node:test')
const assert = require('node:assert/strict')
const http = require('node:http')
const { once } = require('node:events')
const fs = require('node:fs')
const { tmpdir } = require('node:os')
const { join } = require('node:path')
const { createBridge } = require('../../src-ztools/preload/runtime/bridge.cjs')
const { initializeRuntime } = require('../../src-ztools/preload/runtime/index.cjs')
const { createSync } = require('../../src-ztools/preload/runtime/sync/index.cjs')
const { WIN_MAIN_RENDERER_EVENT_NAME: names } = require('../../src-ztools/preload/upstream/common/ipcNames.cjs')
const { createOfficialPeer } = require('./fixtures/lx-sync-peer.cjs')
const wait = ms => new Promise(resolve => setTimeout(resolve, ms))
const music = id => ({ id, name: `合成测试-${id}`, singer: '虚构歌手', source: 'local', interval: '03:00', meta: { songId: id, albumName: '无音源测试' } })
const list = id => ({ id, name: `合成列表-${id}`, source: null, sourceListId: null, locationUpdateTime: null })

test('unchanged official LX 2.12.6 interoperates with production sync runtime', { skip: !process.env.LX_SYNC_ROLE, timeout: 180000 }, async t => {
  const role = process.env.LX_SYNC_ROLE
  const peer = await createOfficialPeer()
  t.after(() => peer.close())
  const bridge = createBridge()
  const directory = fs.mkdtempSync(join(tmpdir(), 'lx-sync-production-'))
  const runtime = initializeRuntime({ bridge, directory })
  const sync = runtime.sync || createSync({ bridge })
  const lx = require('../../src-ztools/preload/runtime/context.cjs').lx
  const baselineTimers = process.getActiveResourcesInfo().filter(type => type === 'Timeout').length
  t.after(async () => { await sync.dispose(); await runtime.dispose() })
  const choices = []
  const readyStatuses = []
  bridge.subscribe(names.sync_action, event => {
    if (event.action === 'client_status' && event.data.status) readyStatuses.push('plugin')
    if (event.action === 'select_mode') {
      choices.push({ side: 'plugin', type: event.data.type, mode: 'merge_local_remote' })
      void sync.action({ action: 'select_mode', data: { type: event.data.type, mode: 'merge_local_remote' } })
    }
  })
  const driveChoices = async () => {
    for (const event of await peer.takeActions()) {
      if (event.action === 'client_status' && event.data.status) readyStatuses.push('official')
      if (event.action === 'select_mode') {
        choices.push({ side: 'official', type: event.data.type, mode: 'merge_local_remote' })
        await peer.action({ action: 'select_mode', data: { type: event.data.type, mode: 'merge_local_remote' } })
      }
    }
  }
  const until = async (predicate, name, timeout = 25000) => {
    const end = Date.now() + timeout
    while (Date.now() < end) { await driveChoices(); if (await predicate()) return; await wait(100) }
    throw new Error(`Deadline: ${name}; plugin=${JSON.stringify({ mode: sync.getStatus().mode, status: sync.getStatus().status, message: sync.getStatus().message })}`)
  }
  const peerEvent = (type, method, ...args) => peer.evaluate(`global.lx.event_${type}[${JSON.stringify(method)}](...${JSON.stringify(args)})`)
  const readLocal = async () => {
    const lists = await lx.worker.dbService.getAllUserList()
    const result = { lists: [], default: await lx.worker.dbService.getListMusics('default'), love: await lx.worker.dbService.getListMusics('love'), rules: (await lx.worker.dbService.getDislikeListInfo()).rules }
    for (const info of lists) result.lists.push({ ...info, list: await lx.worker.dbService.getListMusics(info.id) })
    return JSON.parse(JSON.stringify(result))
  }
  const readPeer = () => peer.evaluate(`(async()=>{ const db=global.lx.worker.dbService; const lists=await db.getAllUserList(); return {lists:await Promise.all(lists.map(async info=>({...info,list:await db.getListMusics(info.id)}))), default:await db.getListMusics('default'),love:await db.getListMusics('love'),rules:(await db.getDislikeListInfo()).rules}})()`)
  const equal = async name => {
    let a, b
    await until(async () => { a = await readLocal(); b = await readPeer(); for (const side of [a, b]) for (const list of side.lists) delete list.locationUpdateTime; return JSON.stringify(a) === JSON.stringify(b) }, name)
    assert.deepEqual(a, b)
    for (const items of [...a.lists.map(list => list.list), a.default, a.love]) assert.equal(new Set(items.map(m => m.id)).size, items.length)
    assert.equal(new Set(a.lists.map(l => l.id)).size, a.lists.length)
    return a
  }
  const reserve = http.createServer(); reserve.listen(0, '0.0.0.0'); await once(reserve, 'listening')
  const port = reserve.address().port; await new Promise(resolve => reserve.close(resolve))
  const host = `http://127.0.0.1:${port}`
  await lx.event_list.list_create(0, [list('plugin-seed')])
  await lx.event_list.list_music_add('plugin-seed', [music('p1'), music('p2'), music('p3')], 'bottom')
  await lx.event_dislike.dislike_data_overwrite('plugin-seed-rule')
  await peerEvent('list', 'list_create', 0, [list('peer-seed')])
  await peerEvent('list', 'list_music_add', 'peer-seed', [music('r1'), music('r2'), music('r3')], 'bottom')
  await peerEvent('dislike', 'dislike_data_overwrite', 'peer-seed-rule')
  const failureMode = process.env.LX_SYNC_FAILURE === '1'
  const beforeFailedCommit = await readLocal()
  if (failureMode) lx.database.exec("CREATE TRIGGER sync_reject_insert BEFORE INSERT ON my_list BEGIN SELECT RAISE(ABORT, 'sync test commit rejected'); END")
  let code
  if (role === 'client') {
    await peer.action({ action: 'enable_server', data: { enable: true, port: String(port) } })
    code = (await peer.action({ action: 'get_server_status' })).code
    await assert.rejects(sync.start({ mode: role, host, authCode: 'wrong-test-code' }), /Auth failed/)
    assert.equal(sync.getStatus().status, false)
    await sync.start({ mode: role, host, authCode: code })
  } else {
    await sync.start({ mode: role, port })
    code = sync.getStatus().code
    await assert.rejects(peer.action({ action: 'enable_client', data: { enable: true, host, authCode: 'wrong-test-code' } }), /Auth failed/)
    await peer.action({ action: 'enable_client', data: { enable: true, host, authCode: code } })
  }
  if (failureMode) {
    let status
    await until(async () => {
      status = role === 'client' ? sync.getStatus() : await peer.action({ action: 'get_client_status' })
      return readyStatuses.length || /failed|commit|同步/i.test(status.message)
    }, 'failed database commit settles', 6000)
    assert.equal(readyStatuses.length, 0, 'a rejected local database commit must never produce remote finished/ready')
    const after = await readLocal()
    assert.deepEqual(after.lists, beforeFailedCommit.lists)
    assert.deepEqual(after.default, beforeFailedCommit.default)
    assert.equal(status.status, false)
    assert.match(status.message, /failed|commit|同步/i)
    await sync.stop()
    await peer.action({ action: role === 'client' ? 'enable_server' : 'enable_client', data: { enable: false, host, port: String(port) } })
    return
  }
  await equal('first merge content and ordered lists')
  assert.ok(choices.some(c => c.type === 'list')); assert.ok(choices.some(c => c.type === 'dislike'))
  await until(async () => role === 'client' ? sync.getStatus().status : (await peer.action({ action: 'get_client_status' })).status, 'finished')
  assert.equal((await readLocal()).lists.length, 2)
  // The payload exceeds LX's 1024 character compression boundary, without audio URLs.
  await lx.event_list.list_create(0, [list('plugin-add')])
  await lx.event_list.list_music_add('plugin-add', Array.from({ length: 12 }, (_, i) => music('compressed-' + i)), 'bottom')
  await equal('plugin create and compressed song add')
  await peerEvent('list', 'list_create', 0, [list('peer-add')])
  await peerEvent('list', 'list_music_add', 'peer-add', [music('peer-added')], 'bottom')
  await equal('official create and song add')
  await lx.event_list.list_update([{ ...list('plugin-add'), name: '插件重命名' }])
  await lx.event_list.list_music_update_position('plugin-seed', 0, ['p3'])
  await lx.event_list.list_update_position(0, ['plugin-seed'])
  await equal('plugin name/song/list ordering')
  await peerEvent('list', 'list_update', [{ ...list('peer-add'), name: '原版重命名' }])
  await peerEvent('list', 'list_music_update_position', 'peer-seed', 0, ['r3'])
  await peerEvent('list', 'list_update_position', 0, ['peer-seed'])
  await equal('official name/song/list ordering')
  await lx.event_list.list_music_update([{ id: 'plugin-seed', musicInfo: { ...music('p3'), name: '插件改歌名' } }])
  await equal('plugin song metadata update')
  await peerEvent('list', 'list_music_update', [{ id: 'peer-seed', musicInfo: { ...music('r3'), name: '原版改歌名' } }])
  await equal('official song metadata update')
  await lx.event_list.list_music_remove('plugin-seed', ['p2'])
  await peerEvent('list', 'list_music_remove', 'peer-seed', ['r2'])
  await equal('both song removals')
  await lx.event_list.list_music_move('plugin-seed', 'plugin-add', [music('p1')], 'bottom')
  await equal('plugin move')
  await peerEvent('list', 'list_music_move', 'peer-seed', 'peer-add', [music('r1')], 'bottom')
  await equal('official move')
  await lx.event_list.list_music_clear(['plugin-add'])
  await equal('plugin clear songs')
  await peerEvent('list', 'list_music_clear', ['peer-add'])
  await equal('official clear songs')
  await lx.event_list.list_remove(['plugin-add'])
  await peerEvent('list', 'list_remove', ['peer-add'])
  await equal('both list removals')
  await lx.event_dislike.dislike_music_add([{ name: '插件不喜欢', singer: '甲' }])
  await equal('plugin dislike add')
  await peerEvent('dislike', 'dislike_music_add', [{ name: '原版不喜欢', singer: '乙' }])
  await equal('official dislike add')
  await lx.event_dislike.dislike_music_clear()
  await equal('plugin dislike clear')
  await peerEvent('dislike', 'dislike_data_overwrite', 'reconnect-rule')
  await equal('official dislike overwrite')
  // Disconnect only the client; keep server snapshots/auth, then mutate both sides.
  if (role === 'client') await sync.stop()
  else await peer.action({ action: 'enable_client', data: { enable: false, host } })
  await wait(250)
  await lx.event_list.list_music_add('plugin-seed', [music('offline-plugin-a'), music('offline-plugin-b')], 'bottom')
  await lx.event_list.list_music_update_position('plugin-seed', 0, ['offline-plugin-b'])
  await lx.event_list.list_update_position(0, ['plugin-seed'])
  await peerEvent('list', 'list_music_add', 'peer-seed', [music('offline-peer-a'), music('offline-peer-b')], 'bottom')
  await peerEvent('list', 'list_music_update_position', 'peer-seed', 0, ['offline-peer-b'])
  await peerEvent('list', 'list_update_position', 0, ['peer-seed'])
  if (role === 'client') await sync.start({ mode: role, host })
  else await peer.action({ action: 'enable_client', data: { enable: true, host } })
  const final = await equal('offline sorting reconnect')
  assert.ok(final.lists.some(l => l.list.some(m => m.id === 'offline-plugin-a')))
  assert.ok(final.lists.some(l => l.list.some(m => m.id === 'offline-peer-a')))
  let changeCount = 0
  const changed = () => changeCount++
  lx.event_list.on('list_changed', changed); lx.event_dislike.on('dislike_changed', changed)
  await wait(700); assert.deepEqual(await equal('stable window one'), final)
  const count = changeCount
  await wait(700); assert.deepEqual(await equal('stable window two'), final)
  assert.equal(changeCount, count, 'no infinite remote replay')
  lx.event_list.off('list_changed', changed); lx.event_dislike.off('dislike_changed', changed)
  let devices
  if (role === 'server') { devices = await sync.devices(); assert.equal(devices.length, 1); await sync.removeDevice(devices[0].clientId) }
  else { devices = await peer.invoke(names.sync_get_server_devices); assert.equal(devices.length, 1); await peer.invoke(names.sync_remove_server_device, devices[0].clientId) }
  await wait(300)
  if (role === 'client') { await sync.stop(); await assert.rejects(sync.start({ mode: role, host }), /Auth failed/) }
  else {
    await peer.action({ action: 'enable_client', data: { enable: false, host } })
    await assert.rejects(peer.action({ action: 'enable_client', data: { enable: true, host } }), /Auth failed/)
  }
  // A fresh displayed code creates a new device after revocation.
  if (role === 'client') {
    code = await peer.action({ action: 'generate_code' })
    await sync.start({ mode: role, host, authCode: code })
  } else {
    code = await sync.action({ action: 'generate_code' })
    await peer.action({ action: 'enable_client', data: { enable: true, host, authCode: code } })
  }
  await equal('re-authentication after device removal')
  await until(async () => role === 'client' ? sync.getStatus().status : (await peer.action({ action: 'get_client_status' })).status, 're-authenticated finished')
  const replacementDevices = role === 'server' ? await sync.devices() : await peer.invoke(names.sync_get_server_devices)
  assert.equal(replacementDevices.length, 1)
  assert.notEqual(replacementDevices[0].clientId, devices[0].clientId)
  await sync.stop()
  await peer.action({ action: role === 'client' ? 'enable_server' : 'enable_client', data: { enable: false, host, port: String(port) } })
  reserve.listen(port, '0.0.0.0'); await once(reserve, 'listening'); await new Promise(resolve => reserve.close(resolve))
  await wait(50)
  assert.ok(process.getActiveResourcesInfo().filter(type => type === 'Timeout').length <= baselineTimers, 'stop drains heartbeat, authentication/snapshot throttles and delayed user-space release timers')
  const evidence = { role, officialVersion: '2.12.6', officialRoot: peer.root, pluginDirectory: directory, authenticationFailure: true, choices, deviceRemoved: true, newDeviceReauthenticated: true, portReleased: true, stableWindows: 2, final, localRaw: await readLocal(), officialRaw: await readPeer() }
  fs.writeFileSync(join(directory, 'interop-result.json'), JSON.stringify(evidence, null, 2))
  console.log('INTEROP_EVIDENCE ' + join(directory, 'interop-result.json'))
})
