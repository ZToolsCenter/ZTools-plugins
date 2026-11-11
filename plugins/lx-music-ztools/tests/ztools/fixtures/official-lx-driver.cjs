// Test-only launch/drive harness. The official executable and app.asar remain unchanged.
const { spawn } = require('node:child_process')
const { mkdirSync, realpathSync, writeFileSync } = require('node:fs')
const path = require('node:path')
const root = __dirname
const exe = path.join(root, 'official', 'lx-music-desktop.exe')
const wait = ms => new Promise(resolve => setTimeout(resolve, ms))

async function createPeer() {
  // Original setUserDataPath uses exe-adjacent portable/userData; this directory is mandatory.
  const portable = path.join(root, 'official', 'portable')
  const userData = path.join(portable, 'userData')
  mkdirSync(userData, { recursive: true })
  const resolved = realpathSync(portable)
  if (!resolved.startsWith(realpathSync(root) + path.sep)) throw new Error('Data isolation escaped peer root')
  const child = spawn(exe, ['--inspect-brk=0', '--remote-debugging-port=0', '--user-data-dir=' + userData], {
    cwd: root, windowsHide: true,
    env: { ...process.env, APPDATA: portable, LOCALAPPDATA: portable },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  let output = '', exited = false
  child.once('exit', () => { exited = true })
  let resolveInspector, rejectInspector
  const inspector = new Promise((resolve, reject) => { resolveInspector = resolve; rejectInspector = reject })
  const onText = chunk => {
    output += chunk.toString()
    const match = /Debugger listening on (ws:\/\/[^\s]+)/.exec(output)
    if (match) resolveInspector(match[1])
  }
  child.stdout.on('data', onText); child.stderr.on('data', onText)
  child.once('error', rejectInspector)
  child.once('exit', code => rejectInspector(new Error('Peer exited before debugger: ' + code + '\n' + output)))
  let socket, nextId = 0
  const requests = new Map(), events = new Map(), earlyEvents = new Map()
  const onceEvent = name => {
    if (earlyEvents.has(name)) { const e = earlyEvents.get(name); earlyEvents.delete(name); return Promise.resolve(e) }
    return new Promise(resolve => events.set(name, resolve))
  }
  const send = (method, params = {}) => new Promise((resolve, reject) => {
    const id = ++nextId
    requests.set(id, { resolve, reject, method })
    socket.send(JSON.stringify({ id, method, params }))
  })
  async function close() {
    if (socket?.readyState === 1) {
      try { socket.send(JSON.stringify({ id: ++nextId, method: 'Runtime.evaluate', params: { expression: 'global.__lxPeerHost.app.quit()' } })) } catch {}
      socket.close()
    }
    for (let i = 0; i < 100 && !exited; i++) await wait(100)
    if (!exited) { child.kill(); for (let i = 0; i < 30 && !exited; i++) await wait(100) }
    writeFileSync(path.join(root, 'last-peer-console.log'), output)
  }
  try {
    const timer = setTimeout(() => rejectInspector(new Error('No inspector endpoint\n' + output)), 20000)
    const url = await inspector.finally(() => clearTimeout(timer))
    socket = new WebSocket(url)
    socket.addEventListener('message', event => {
      const msg = JSON.parse(event.data)
      if (msg.method === 'NodeWorker.attachedToWorker') {
        void send('NodeWorker.sendMessageToWorker', { sessionId: msg.params.sessionId, message: JSON.stringify({ id: 1, method: 'Runtime.runIfWaitingForDebugger' }) }).catch(() => {})
      }
      if (msg.id) {
        const req = requests.get(msg.id); if (!req) return
        requests.delete(msg.id)
        if (msg.error) req.reject(new Error(req.method + ': ' + JSON.stringify(msg.error))); else req.resolve(msg.result)
      } else if (events.has(msg.method)) {
        events.get(msg.method)(msg.params); events.delete(msg.method)
      } else earlyEvents.set(msg.method, msg.params)
    })
    await new Promise((resolve, reject) => { socket.addEventListener('open', resolve, { once: true }); socket.addEventListener('error', reject, { once: true }) })
    await send('Runtime.enable'); await send('Debugger.enable')
    await send('NodeWorker.enable', { waitForDebuggerOnStart: true })
    const paused = onceEvent('Debugger.paused')
    await send('Runtime.runIfWaitingForDebugger')
    const pause = await paused
    const setup = await send('Debugger.evaluateOnCallFrame', {
      callFrameId: pause.callFrames[0].callFrameId,
      expression: `(() => { const e = require('electron'); global.__lxPeerHost = e; for (let i = process.execArgv.length - 1; i >= 0; i--) if (process.execArgv[i].startsWith('--inspect')) process.execArgv.splice(i, 1); e.app.setPath('appData', ${JSON.stringify(portable)}); e.app.setPath('userData', ${JSON.stringify(userData)}); e.app.setAsDefaultProtocolClient = () => false; e.app.removeAsDefaultProtocolClient = () => false; return { versions: process.versions, userData: e.app.getPath('userData'), portable: ${JSON.stringify(portable)} }; })()`,
      returnByValue: true,
    })
    if (setup.exceptionDetails) throw new Error('Pre-main isolation failed: ' + JSON.stringify(setup.exceptionDetails))
    await send('Debugger.resume'); await send('Debugger.disable')
    await wait(1500)
    const evaluate = async expression => {
      const res = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })
      if (res.exceptionDetails) throw new Error(JSON.stringify(res.exceptionDetails))
      return res.result.value
    }
    let state
    for (let i = 0; i < 300; i++) {
      state = await evaluate(`global.lx?.inited && global.__lxPeerHost.ipcMain._invokeHandlers.has('winMain_sync_action') ? { inited: global.lx.inited, dataPath: global.lxDataPath, userData: global.__lxPeerHost.app.getPath('userData'), version: global.__lxPeerHost.app.getVersion(), syncEnabled: global.lx.appSetting['sync.enable'] } : null`)
      if (state) break
      if (exited) throw new Error('Peer exited during startup\n' + output)
      await wait(100)
    }
    if (!state) throw new Error('Peer startup timed out\n' + output)
    if (realpathSync(state.dataPath) !== realpathSync(path.join(userData, 'LxDatas'))) throw new Error('Original LX used unexpected directory: ' + JSON.stringify(state))
    // Calls registered ORIGINAL IPC handlers; no sync transport implementation exists here.
    const invoke = (channel, params) => evaluate(`global.__lxPeerHost.ipcMain._invokeHandlers.get(${JSON.stringify(channel)})({ sender: global.__lxPeerHost.BrowserWindow.getAllWindows()[0]?.webContents ?? null }, ${JSON.stringify(params)})`)
    const action = params => invoke('winMain_sync_action', params)
    for (let i = 0; i < 100; i++) {
      if (await evaluate(`global.__lxPeerHost.BrowserWindow.getAllWindows().length > 0`)) break
      await wait(100)
    }
    await evaluate(`global.__lxPeerHost.BrowserWindow.getAllWindows()[0].webContents.executeJavaScript(${JSON.stringify("globalThis.__lxPeerActions = []; require('electron').ipcRenderer.on('winMain_sync_action', (_event, action) => globalThis.__lxPeerActions.push(action)); true")})`)
    const takeActions = () => evaluate(`global.__lxPeerHost.BrowserWindow.getAllWindows()[0].webContents.executeJavaScript('globalThis.__lxPeerActions.splice(0)')`)
    return { pid: child.pid, state, setup: setup.result.value, evaluate, invoke, action, takeActions, close }
  } catch (error) { await close(); throw error }
}

module.exports = { createPeer }
if (require.main === module) {
  ;(async () => {
    const peer = await createPeer()
    try {
      const evidence = { pid: peer.pid, state: peer.state, versions: peer.setup.versions,
        server: await peer.action({ action: 'get_server_status' }),
        client: await peer.action({ action: 'get_client_status' }),
        lists: await peer.evaluate(`(async () => ({ userList: await global.lx.worker.dbService.getAllUserList(), defaultList: await global.lx.worker.dbService.getListMusics('default'), loveList: await global.lx.worker.dbService.getListMusics('love'), dislike: await global.lx.worker.dbService.getDislikeListInfo() }))()`),
      }
      writeFileSync(path.join(root, 'smoke-result.json'), JSON.stringify(evidence, null, 2))
      console.log(JSON.stringify(evidence, null, 2))
    } finally { await peer.close() }
  })().catch(error => { console.error(error); process.exitCode = 1 })
}
