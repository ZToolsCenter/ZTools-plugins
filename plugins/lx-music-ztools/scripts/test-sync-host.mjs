// Actual installed ZTools + original Vue + original three Sync IPCs.
// This driver contains no LX wire implementation and never loads a music source.
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { createRequire } from 'node:module'
import { startHost } from './host-fixture.mjs'

const require = createRequire(import.meta.url)
const wait = ms => new Promise(resolve => setTimeout(resolve, ms))
const sha256 = value => createHash('sha256').update(value).digest('hex')
const music = id => ({ id, name: `宿主合成-${id}`, singer: '虚构歌手', source: 'local', interval: '03:00', meta: { songId: id, albumName: '无音源同步验收' } })
const list = id => ({ id, name: `宿主列表-${id}`, source: null, sourceListId: null, locationUpdateTime: null })
const required = [
  'src-ztools/dist/lx.html', 'src-ztools/plugin.json', 'src-ztools/preload/services.js',
  'src-ztools/preload/runtime/sync/index.cjs', 'src-ztools/preload/upstream/common/ipcNames.cjs',
  'src-ztools/preload/upstream/main/modules/sync/client/index.cjs',
  'src-ztools/preload/upstream/main/modules/sync/server/index.cjs',
  'vendor/lx/src/renderer/components/layout/SyncModeModal.vue',
  'tests/ztools/fixtures/lx-sync-peer.cjs', 'tests/ztools/fixtures/official-lx-driver.cjs',
]

function preflight() {
  for (const file of required) assert.ok(existsSync(resolve(file)), `FAIL: missing required source/build reference: ${file}`)
  const executable = process.env.ZTOOLS_EXECUTABLE || resolve('../tmp/lx-electron-42/electron.exe')
  const app = process.env.ZTOOLS_APP || 'D:/Program Files/ZTools/resources/app.asar'
  assert.ok(existsSync(executable), `BLOCKED: ZTools Electron executable missing: ${executable}`)
  assert.ok(existsSync(app), `BLOCKED: installed ZTools app.asar missing: ${app}`)
  assert.ok(process.env.LX_ORIGINAL_PEER, 'BLOCKED: set LX_ORIGINAL_PEER to the official LX 2.12.6 archive directory')
  const archive = join(process.env.LX_ORIGINAL_PEER, 'lx-music-desktop-v2.12.6-win_x64-green.7z')
  assert.ok(existsSync(archive), `BLOCKED: official LX archive missing: ${archive}`)
  assert.equal(sha256(readFileSync(archive)), 'a07d2a15dbcf06ce689bf8b99c64241b06deb28fdfb6ffe79b6dcdfbb0d157a5', 'FAIL: official archive identity changed')
  if (process.env.ZTOOLS_PLUGIN_ZIP) assert.ok(existsSync(resolve(process.env.ZTOOLS_PLUGIN_ZIP)), 'BLOCKED: production ZIP missing')
  return { executable, app, installedAsarSha256: sha256(readFileSync(app)), archiveSha256: sha256(readFileSync(archive)), zip: process.env.ZTOOLS_PLUGIN_ZIP || null }
}

function normalize(value) {
  const copy = structuredClone(value)
  // Original local ordering timestamps are independently generated. Keep raw evidence.
  for (const info of copy.lists) delete info.locationUpdateTime
  return copy
}

async function freePort() {
  const server = createServer()
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve) })
  const port = server.address().port
  await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()))
  return port
}

async function assertPortReleased(port) {
  const server = createServer()
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(port, '0.0.0.0', resolve) })
  await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()))
}

// Only the affected authentication commit boundaries. Data is read immediately
// after original business IPC returns, before stop/dispose/flush. The official
// binary is an unchanged oracle; this driver never implements the wire protocol.
async function runAuthCommit(environment, output) {
  const result = { status: 'RUNNING', environment, checks: [], startedAt: new Date().toISOString() }
  let host, peer
  const checkpoint = name => { result.checks.push(name); console.log(`PASS auth-commit ${name}`) }
  try {
    const { createOfficialPeer } = require('../tests/ztools/fixtures/lx-sync-peer.cjs')
    peer = await createOfficialPeer()
    assert.equal(peer.state.version, '2.12.6')
    result.officialVersion = peer.state.version
    host = await startHost('dist/lx.html')
    result.hostData = host.data
    const invoke = (channel, params) => host.evaluate(`lxHost.invoke(${JSON.stringify(channel)},${JSON.stringify(params)})`)
    const action = params => invoke('winMain_sync_action', params)
    const data = await host.evaluate('ztools.getPath("pluginData")')
    const devicesFile = join(data, 'sync/server/devices.json'), identityFile = join(data, 'sync/server/serverInfo.json')
    const serverPort = await freePort(), serverAddress = `http://127.0.0.1:${serverPort}`
    await action({ action: 'enable_server', data: { enable: true, port: String(serverPort) } })
    const identity = JSON.parse(readFileSync(identityFile, 'utf8'))
    assert.equal(await (await fetch(serverAddress + '/id')).text(), 'OjppZDo6' + identity.serverId)
    checkpoint('first server identity is already recoverable when listener succeeds')

    const connectOfficial = authCode => peer.action({ action: 'enable_client', data: { enable: true, host: serverAddress, ...(authCode ? { authCode } : {}) } })
    const disconnectOfficial = () => peer.action({ action: 'enable_client', data: { enable: false, host: serverAddress } })
    await connectOfficial((await action({ action: 'get_server_status' })).code)
    const granted = await invoke('winMain_sync_get_server_devices')
    assert.equal(granted.length, 1)
    assert.equal(JSON.parse(readFileSync(devicesFile, 'utf8')).clients[granted[0].clientId].key, granted[0].key)
    checkpoint('official client authentication returns only after new server key is on disk')
    await invoke('winMain_sync_remove_server_device', granted[0].clientId)
    assert.equal(JSON.parse(readFileSync(devicesFile, 'utf8')).clients[granted[0].clientId], undefined)
    checkpoint('original removeDevice success already excludes revoked key on disk')
    await disconnectOfficial()
    await assert.rejects(connectOfficial(), /Auth failed/)
    checkpoint('unchanged official client cannot authenticate with revoked saved key')
    await connectOfficial(await action({ action: 'generate_code' }))
    const replacement = await invoke('winMain_sync_get_server_devices')
    assert.equal(replacement.length, 1)
    assert.notEqual(replacement[0].clientId, granted[0].clientId)
    const persisted = JSON.parse(readFileSync(devicesFile, 'utf8'))
    assert.equal(persisted.clients[granted[0].clientId], undefined)
    assert.equal(persisted.clients[replacement[0].clientId].key, replacement[0].key)
    checkpoint('fresh official pairing persists replacement without restoring old key')
    await disconnectOfficial()
    await action({ action: 'enable_server', data: { enable: false, port: String(serverPort) } })
    await assertPortReleased(serverPort)

    const peerPort = await freePort(), peerAddress = `http://127.0.0.1:${peerPort}`
    await peer.action({ action: 'enable_server', data: { enable: true, port: String(peerPort) } })
    const code = (await peer.action({ action: 'get_server_status' })).code
    await action({ action: 'enable_client', data: { enable: true, host: peerAddress, authCode: code } })
    const serverId = (await (await fetch(peerAddress + '/id')).text()).replace('OjppZDo6', '')
    const clientKeys = JSON.parse(readFileSync(join(data, 'sync/client/syncAuthKey.json'), 'utf8'))
    assert.ok(clientKeys[serverId]?.key)
    const officialDevices = await peer.invoke('winMain_sync_get_server_devices')
    assert.equal(officialDevices.find(info => info.clientId === clientKeys[serverId].clientId)?.key, clientKeys[serverId].key)
    checkpoint('plugin client authentication returns only after local key matches official server')
    await action({ action: 'enable_client', data: { enable: false, host: peerAddress } })
    await action({ action: 'enable_client', data: { enable: true, host: peerAddress } })
    assert.deepEqual(JSON.parse(readFileSync(join(data, 'sync/client/syncAuthKey.json'), 'utf8')), clientKeys)
    checkpoint('plugin reconnect uses committed local key with unchanged official server')
    await action({ action: 'enable_client', data: { enable: false, host: peerAddress } })
    await peer.action({ action: 'enable_server', data: { enable: false, port: String(peerPort) } })
    await assertPortReleased(peerPort)
    result.status = 'PASS'
  } catch (error) {
    result.status = 'FAIL'; result.error = String(error.stack || error)
    result.hostLogs = await host?.logs().catch(() => [])
    throw error
  } finally {
    try { await host?.close() } finally { await peer?.close() }
    result.finishedAt = new Date().toISOString()
    writeFileSync(join(output, 'auth-commit.json'), JSON.stringify(result, null, 2))
    console.log(`SYNC_AUTH_COMMIT_EVIDENCE ${join(output, 'auth-commit.json')}`)
  }
}

async function runRole(role, environment, output) {
  const result = { role, status: 'RUNNING', environment, startedAt: new Date().toISOString(), checks: [], choices: [] }
  let host, peer, port
  const checkpoint = name => { result.checks.push(name); console.log(`[${role}] PASS ${name}`) }
  try {
    // createOfficialPeer validates both official archive and extracted app.asar hashes.
    const { createOfficialPeer } = require('../tests/ztools/fixtures/lx-sync-peer.cjs')
    const { WIN_MAIN_RENDERER_EVENT_NAME: names, PLAYER_EVENT_NAME: player, DISLIKE_EVENT_NAME: dislike } = require('../src-ztools/preload/upstream/common/ipcNames.cjs')
    peer = await createOfficialPeer()
    result.official = { root: peer.root, pid: peer.pid, state: peer.state, versions: peer.setup.versions }
    assert.equal(peer.state.version, '2.12.6')
    host = await startHost('dist/lx.html')
    result.hostData = host.data
    result.hostPid = host.app.process().pid
    const invoke = (channel, params) => host.evaluate(`lxHost.invoke(${JSON.stringify(channel)},${JSON.stringify(params)})`)
    const action = params => invoke(names.sync_action, params)
    const pendingChoices = []
    const ready = []
    const processActions = async () => {
      const events = await host.evaluate('globalThis.__lxSyncHostActions.splice(0)')
      for (const event of events) {
        if (event.action === 'select_mode') pendingChoices.push(event)
        if (event.action === 'client_status' && event.data.status) ready.push('plugin')
      }
      if (pendingChoices.length) {
        // Click the ORIGINAL Vue SyncModeModal button, allowing its own IPC dispatch.
        // Never call a Vue private instance/store or bypass the dialog with select_mode.
        const clicked = await host.evaluate(`(() => {
          const visible = el => el.getClientRects().length && getComputedStyle(el).visibility !== 'hidden';
          const button = [...document.querySelectorAll('button')].find(el => visible(el) && el.textContent.trim() === '「本机列表」合并「远程列表」');
          if (!button) return null;
          const title = [...document.querySelectorAll('h2')].filter(visible).map(el => el.textContent).join(' | ');
          button.click(); return { title, label: button.textContent.trim() };
        })()`)
        if (clicked) {
          const event = pendingChoices.shift()
          result.choices.push({ side: 'plugin-original-vue', type: event.data.type, mode: 'merge_local_remote', ...clicked })
        }
      }
      for (const event of await peer.takeActions()) {
        if (event.action === 'client_status' && event.data.status) ready.push('official')
        if (event.action === 'select_mode') {
          result.choices.push({ side: 'official-original-ipc', type: event.data.type, mode: 'merge_local_remote' })
          await peer.action({ action: 'select_mode', data: { type: event.data.type, mode: 'merge_local_remote' } })
        }
      }
    }
    const until = async (predicate, name, timeout = 30000) => {
      const end = Date.now() + timeout
      while (Date.now() < end) { await processActions(); if (await predicate()) return; await wait(100) }
      const describe = ({ status, message }) => ({ status, message })
      const status = { client: describe(await action({ action: 'get_client_status' })), server: describe(await action({ action: 'get_server_status' })) }
      throw new Error(`Deadline: ${name}; status=${JSON.stringify(status)}; choices=${JSON.stringify(result.choices)}`)
    }
    // Original renderer must have mounted before observing its original dialogs.
    const end = Date.now() + 20000
    while (Date.now() < end && !await host.evaluate('Boolean(document.querySelector("#root")?.__vue_app__)')) await wait(100)
    assert.equal(await host.evaluate('Boolean(document.querySelector("#root")?.__vue_app__)'), true, 'original LX Vue root failed to mount')
    await host.evaluate(`globalThis.__lxSyncHostActions=[]; globalThis.__lxSyncHostErrors=[]; globalThis.__lxSyncChanges=0;
      lxHost.subscribe(${JSON.stringify(names.sync_action)}, event=>globalThis.__lxSyncHostActions.push(event));
      lxHost.subscribe('bridge:error', error=>globalThis.__lxSyncHostErrors.push(error));
      for (const channel of ${JSON.stringify([player.list_add, player.list_remove, player.list_update, player.list_update_position, player.list_music_add, player.list_music_remove, player.list_music_update_position, dislike.add_dislike_music_infos, dislike.overwrite_dislike_music_infos, dislike.clear_dislike_music_infos])}) lxHost.subscribe(channel,()=>globalThis.__lxSyncChanges++); undefined`)
    await invoke('common_set_app_setting', { 'common.isAgreePact': true, 'common.showChangeLog': false, 'common.langId': 'zh-cn' })
    result.host = await host.evaluate('services.diagnose()')
    assert.equal((await action({ action: 'get_server_status' })).status, false)
    assert.equal((await action({ action: 'get_client_status' })).status, false)
    checkpoint('installed host, original Vue mounted, Sync default disabled')

    const readHost = async () => {
      const lists = await invoke(player.list_get)
      return { lists: await Promise.all(lists.map(async info => ({ ...info, list: await invoke(player.list_music_get, info.id) }))), default: await invoke(player.list_music_get, 'default'), love: await invoke(player.list_music_get, 'love'), rules: (await invoke(dislike.get_dislike_music_infos)).rules }
    }
    const readPeer = () => peer.evaluate(`(async()=>{const db=global.lx.worker.dbService;const lists=await db.getAllUserList();return {lists:await Promise.all(lists.map(async info=>({...info,list:await db.getListMusics(info.id)}))),default:await db.getListMusics('default'),love:await db.getListMusics('love'),rules:(await db.getDislikeListInfo()).rules}})()`)
    const peerEvent = (type, method, ...args) => peer.evaluate(`global.lx.event_${type}[${JSON.stringify(method)}](...${JSON.stringify(args)})`)
    const equal = async name => {
      let local, official
      await until(async () => { local = normalize(await readHost()); official = normalize(await readPeer()); return JSON.stringify(local) === JSON.stringify(official) }, name)
      assert.deepEqual(local, official)
      for (const values of [local.lists, ...local.lists.map(info => info.list), local.default, local.love]) assert.equal(new Set(values.map(info => info.id)).size, values.length, `${name}: duplicate id`)
      checkpoint(name)
      return local
    }
    await invoke(player.list_add, { position: 0, listInfos: [list('plugin-seed')] })
    await invoke(player.list_music_add, { id: 'plugin-seed', musicInfos: [music('p1'), music('p2')], addMusicLocationType: 'bottom' })
    await invoke(dislike.overwrite_dislike_music_infos, 'plugin-seed-rule')
    await peerEvent('list', 'list_create', 0, [list('peer-seed')])
    await peerEvent('list', 'list_music_add', 'peer-seed', [music('r1'), music('r2')], 'bottom')
    await peerEvent('dislike', 'dislike_data_overwrite', 'peer-seed-rule')
    port = await freePort()
    const address = `http://127.0.0.1:${port}`
    result.port = port
    if (role === 'client') {
      await peer.action({ action: 'enable_server', data: { enable: true, port: String(port) } })
      const code = (await peer.action({ action: 'get_server_status' })).code
      await assert.rejects(action({ action: 'enable_client', data: { enable: true, host: address, authCode: 'wrong-test-code' } }), /Auth failed/)
      assert.equal((await action({ action: 'get_client_status' })).status, false)
      await processActions(); assert.equal(ready.length, 0)
      checkpoint('wrong authentication rejected through original Sync IPC')
      await action({ action: 'enable_client', data: { enable: true, host: address, authCode: code } })
    } else {
      await action({ action: 'enable_server', data: { enable: true, port: String(port) } })
      const code = (await action({ action: 'get_server_status' })).code
      assert.equal((await fetch(address + '/hello')).status, 200)
      await assert.rejects(peer.action({ action: 'enable_client', data: { enable: true, host: address, authCode: 'wrong-test-code' } }), /Auth failed/)
      assert.equal((await peer.action({ action: 'get_client_status' })).status, false)
      await processActions(); assert.equal(ready.length, 0)
      checkpoint('wrong authentication rejected by host Sync server')
      await peer.action({ action: 'enable_client', data: { enable: true, host: address, authCode: code } })
    }
    await equal('authenticated first list/dislike merge')
    await until(async () => role === 'client' ? (await action({ action: 'get_client_status' })).status : (await peer.action({ action: 'get_client_status' })).status, 'ready')
    assert.equal((await readHost()).lists.length, 2)
    assert.ok(result.choices.some(choice => choice.type === 'list'))
    assert.ok(result.choices.some(choice => choice.type === 'dislike'))
    // In server mode both merge decisions must traverse the real plugin Vue dialog.
    if (role === 'server') for (const type of ['list', 'dislike']) assert.ok(result.choices.some(choice => choice.side === 'plugin-original-vue' && choice.type === type), `missing real Vue ${type} choice`)

    await invoke(player.list_add, { position: 0, listInfos: [list('plugin-added')] })
    await invoke(player.list_music_add, { id: 'plugin-added', musicInfos: Array.from({ length: 12 }, (_, i) => music(`compressed-${i}`)), addMusicLocationType: 'bottom' })
    await equal('host list create and compressed music addition reaches official')
    await peerEvent('list', 'list_create', 0, [list('peer-added')])
    await peerEvent('list', 'list_music_add', 'peer-added', [music('peer-added-song')], 'bottom')
    await equal('official list and music addition reaches host')
    await invoke(player.list_update, [{ ...list('plugin-seed'), name: '宿主重命名' }])
    await invoke(player.list_music_update_position, { listId: 'plugin-seed', position: 0, ids: ['p2'] })
    await invoke(player.list_update_position, { position: 0, ids: ['plugin-seed'] })
    await equal('host rename and ordered list/music mutation')
    await peerEvent('list', 'list_update', [{ ...list('peer-seed'), name: '官方重命名' }])
    await peerEvent('list', 'list_music_update_position', 'peer-seed', 0, ['r2'])
    await peerEvent('list', 'list_update_position', 0, ['peer-seed'])
    await equal('official rename and ordered list/music mutation')
    await invoke(dislike.add_dislike_music_infos, [{ name: '宿主不喜欢', singer: '甲' }])
    await equal('host dislike addition')
    await peerEvent('dislike', 'dislike_music_add', [{ name: '官方不喜欢', singer: '乙' }])
    await equal('official dislike addition')
    await invoke(dislike.clear_dislike_music_infos)
    await equal('host dislike clear')
    await peerEvent('dislike', 'dislike_data_overwrite', 'host-final-rule')
    await equal('official dislike overwrite')
    await invoke(player.list_remove, ['plugin-added'])
    await peerEvent('list', 'list_remove', ['peer-added'])
    await equal('both sides list removal')

    const disableClient = () => role === 'client' ? action({ action: 'enable_client', data: { enable: false, host: address } }) : peer.action({ action: 'enable_client', data: { enable: false, host: address } })
    const enableClient = authCode => role === 'client' ? action({ action: 'enable_client', data: { enable: true, host: address, ...(authCode ? { authCode } : {}) } }) : peer.action({ action: 'enable_client', data: { enable: true, host: address, ...(authCode ? { authCode } : {}) } })
    await disableClient(); await wait(250)
    await invoke(player.list_music_add, { id: 'plugin-seed', musicInfos: [music('offline-host-a'), music('offline-host-b')], addMusicLocationType: 'bottom' })
    await invoke(player.list_music_update_position, { listId: 'plugin-seed', position: 0, ids: ['offline-host-b'] })
    await peerEvent('list', 'list_music_add', 'peer-seed', [music('offline-peer-a'), music('offline-peer-b')], 'bottom')
    await peerEvent('list', 'list_music_update_position', 'peer-seed', 0, ['offline-peer-b'])
    await enableClient()
    const final = await equal('saved authentication reconnect with both offline sorts')
    for (const id of ['offline-host-a', 'offline-host-b', 'offline-peer-a', 'offline-peer-b']) assert.ok(final.lists.some(info => info.list.some(m => m.id === id)), `missing ${id}`)
    await host.evaluate('ztools.outPlugin(false)')
    await wait(700); assert.deepEqual(await equal('hidden plugin keeps sync and data stable'), final)
    const count = await host.evaluate('globalThis.__lxSyncChanges')
    await wait(700); assert.deepEqual(await equal('second bounded stable window'), final)
    assert.equal(await host.evaluate('globalThis.__lxSyncChanges'), count, 'infinite remote replay')
    checkpoint('hide retains connection and two bounded stable windows')

    const devices = role === 'server' ? await invoke(names.sync_get_server_devices) : await peer.invoke(names.sync_get_server_devices)
    assert.equal(devices.length, 1)
    if (role === 'server') await invoke(names.sync_remove_server_device, devices[0].clientId)
    else await peer.invoke(names.sync_remove_server_device, devices[0].clientId)
    await wait(300); await disableClient()
    await assert.rejects(enableClient(), /Auth failed/)
    const code = role === 'server' ? await action({ action: 'generate_code' }) : await peer.action({ action: 'generate_code' })
    await enableClient(code)
    await equal('device revocation and fresh code reauthentication')
    await until(async () => role === 'client' ? (await action({ action: 'get_client_status' })).status : (await peer.action({ action: 'get_client_status' })).status, 'reauthenticated ready')
    const replacement = role === 'server' ? await invoke(names.sync_get_server_devices) : await peer.invoke(names.sync_get_server_devices)
    assert.equal(replacement.length, 1)
    assert.notEqual(replacement[0].clientId, devices[0].clientId)
    checkpoint('original get/remove device IPC and renewed device identity')
    result.localRaw = await readHost(); result.officialRaw = await readPeer()
    result.final = normalize(result.localRaw)
    assert.deepEqual(result.final, normalize(result.officialRaw))
    result.summarySha256 = sha256(JSON.stringify(result.final))
    result.bridgeErrors = await host.evaluate('globalThis.__lxSyncHostErrors')
    assert.deepEqual(result.bridgeErrors, [])
    await disableClient()
    if (role === 'server') {
      // Stop through original IPC, then restart and kill through public host API.
      await action({ action: 'enable_server', data: { enable: false, port: String(port) } })
      await assertPortReleased(port)
      await action({ action: 'enable_server', data: { enable: true, port: String(port) } })
      await host.evaluate('ztools.outPlugin(true)')
      const end = Date.now() + 10000
      let released = false
      while (Date.now() < end) { try { await assertPortReleased(port); released = true; break } catch { await wait(100) } }
      assert.equal(released, true, 'public plugin kill must release listener')
      checkpoint('original stop IPC and public plugin kill release host listener')
    } else {
      await peer.action({ action: 'enable_server', data: { enable: false, port: String(port) } })
      await assertPortReleased(port)
      checkpoint('both original services stop and release peer listener')
    }
    result.status = 'PASS'
  } catch (error) {
    result.status = 'FAIL'; result.error = String(error.stack || error)
    result.hostLogs = await host?.logs().catch(() => [])
    result.renderer = await host?.evaluate('({body:document.body.innerText,bootstrapError:globalThis.lxBootstrapError,actions:globalThis.__lxSyncHostActions,errors:globalThis.__lxSyncHostErrors})').catch(error => String(error))
    throw error
  } finally {
    const cleanupErrors = []
    try { await host?.close() } catch (error) { cleanupErrors.push(`host: ${error.stack || error}`) }
    try { await peer?.close() } catch (error) { cleanupErrors.push(`peer: ${error.stack || error}`) }
    result.cleanupErrors = cleanupErrors
    if (cleanupErrors.length) { result.status = 'FAIL'; process.exitCode = 1 }
    result.finishedAt = new Date().toISOString()
    writeFileSync(join(output, `${role}.json`), JSON.stringify(result, null, 2))
    console.log(`SYNC_HOST_EVIDENCE ${join(output, `${role}.json`)}`)
  }
  assert.equal(result.status, 'PASS', 'cleanup failed')
  return result
}

try {
  const environment = preflight()
  if (process.argv.includes('--check-only')) {
    console.log('PASS preflight only; no Electron or official peer was started')
  } else {
    const output = mkdtempSync(join(tmpdir(), 'lx-sync-host-'))
    console.log(`SYNC_HOST_OUTPUT ${output}`)
    if (process.argv.includes('--auth-commit-only')) {
      await runAuthCommit(environment, output)
    } else {
    const roles = process.env.LX_SYNC_ROLE ? [process.env.LX_SYNC_ROLE] : ['client', 'server']
    assert.ok(roles.every(role => ['client', 'server'].includes(role)), 'FAIL: LX_SYNC_ROLE must be client or server')
    const results = []
    for (const role of roles) {
      try { results.push(await runRole(role, environment, output)) }
      catch (error) {
        console.error(`[${role}] FAIL ${error.stack || error}`)
        results.push(JSON.parse(readFileSync(join(output, `${role}.json`), 'utf8')))
      }
    }
    const status = results.every(result => result.status === 'PASS') ? 'PASS' : 'FAIL'
    writeFileSync(join(output, 'summary.json'), JSON.stringify({ status, evidence: 'Actual installed ZTools app.asar, original Vue and original Sync IPC, unchanged official LX 2.12.6', results: results.map(({ role, status, summarySha256, checks, error }) => ({ role, status, summarySha256, checks, error })) }, null, 2))
    console.log(`${status} installed-host official Sync interoperability: ${roles.join(', ')}`)
    if (status !== 'PASS') process.exitCode = 1
    }
  }
} catch (error) {
  console.error(String(error.stack || error))
  process.exitCode = /BLOCKED:/.test(String(error)) ? 2 : 1
}
