// Host lifecycle fixes only. Protocol, RPC, cryptography and merge algorithms
// remain the original LX implementation. Shape checks fail closed on upgrades.
function replaceOnce(source, from, to, name) {
  if (!source.includes(from) || source.indexOf(from) !== source.lastIndexOf(from)) throw new Error(`LX sync source shape changed: ${name}`)
  return source.replace(from, to)
}
function adaptSyncSource(relativePath, source) {
  source = source.replaceAll('\r\n', '\n')
  const file = relativePath.replaceAll('\\', '/')
  if (!file.startsWith('main/modules/sync/')) return source
  const patch = (from, to, name) => { source = replaceOnce(source, from, to, `${file}: ${name}`) }
  if (file.endsWith('/server/user/data.ts') || file.endsWith('/snapshotDataManage.ts')) {
    patch("import { throttle } from '@common/utils/common'", "import { throttle, writeFile, serial, authTransaction, atomicWriteJSON, readAuthJSON } from '@ztools/sync/storage'", 'managed throttle')
    source = source.replaceAll('fs.writeFile(', 'writeFile(')
  }
  if (file.endsWith('/server/user/data.ts')) {
    patch(`const saveServerInfoThrottle = throttle(() => {
  writeFile(path.join(global.lxDataPath, File.serverDataPath, File.serverInfoJSON), JSON.stringify(serverInfo), (err) => {
    if (err) console.error(err)
  })
})
let serverInfo: ServerInfo
export const initServerInfo = async() => {
  if (serverInfo != null) return
  const serverInfoFilePath = path.join(global.lxDataPath, File.serverDataPath, File.serverInfoJSON)
  if (await exists(serverInfoFilePath)) {
    // eslint-disable-next-line require-atomic-updates
    serverInfo = JSON.parse((await fs.promises.readFile(serverInfoFilePath)).toString())
  } else {
    // eslint-disable-next-line require-atomic-updates
    serverInfo = {
      serverId: randomBytes(4 * 4).toString('base64'),
      version: 2,
    }
    const syncDataPath = path.join(global.lxDataPath, File.serverDataPath)
    if (!await exists(syncDataPath)) {
      await fs.promises.mkdir(syncDataPath, { recursive: true })
    }
    saveServerInfoThrottle()
  }
}
export const getServerId = () => {
  return serverInfo.serverId
}
export const getVersion = async() => {
  await initServerInfo()
  return serverInfo.version ?? 1
}
export const setVersion = async(version: number) => {
  await initServerInfo()
  serverInfo.version = version
  saveServerInfoThrottle()
}`, `let serverInfo: ServerInfo | undefined
let committedServerInfoPath: string | undefined
const serverInfoPath = () => path.join(global.lxDataPath, File.serverDataPath, File.serverInfoJSON)
export const initServerInfo = async() => {
  const file = serverInfoPath()
  return authTransaction(file, async() => {
    if (serverInfo && committedServerInfoPath === file) return
    let next = await readAuthJSON(file)
    if (!next) {
      next = { serverId: randomBytes(4 * 4).toString('base64'), version: 2 }
      await fs.promises.mkdir(path.dirname(file), { recursive: true })
      await atomicWriteJSON(file, next)
    }
    serverInfo = next
    committedServerInfoPath = file
  })
}
export const getServerId = () => {
  if (!serverInfo || committedServerInfoPath !== serverInfoPath()) throw new Error('Sync server identity is not committed')
  return serverInfo.serverId
}
export const getVersion = async() => {
  await initServerInfo()
  return serverInfo!.version ?? 1
}
export const setVersion = async(version: number) => {
  await initServerInfo()
  const file = serverInfoPath()
  return authTransaction(file, async() => {
    const next = { ...await readAuthJSON(file), version }
    await atomicWriteJSON(file, next)
    serverInfo = next
    committedServerInfoPath = file
  })
}`, 'commit server identity before publication')
    patch('  private readonly saveDevicesInfoThrottle: () => void\n', '', 'remove deferred authentication writer')
    patch('return Object.values(this.devicesInfo.clients).sort(', 'return Object.values(this.devicesInfo.clients).map(info => ({ ...info })).sort(', 'return detached device list')
    patch(`  saveClientKeyInfo = (keyInfo: LX.Sync.ServerKeyInfo) => {
    if (this.devicesInfo.clients[keyInfo.clientId] == null && Object.keys(this.devicesInfo.clients).length > 101) throw new Error('max keys')
    this.devicesInfo.clients[keyInfo.clientId] = keyInfo
    this.saveDevicesInfoThrottle()
  }`, `  private commitClientKeyInfo = (keyInfo: LX.Sync.ServerKeyInfo, existingOnly = false) => {
    const value = { ...keyInfo }
    return authTransaction(this.devicesFilePath, async() => {
      const next: DevicesInfo = await readAuthJSON(this.devicesFilePath, { userName: this.userName, clients: {} })
      if (existingOnly && !next.clients[value.clientId]) { this.devicesInfo = next; return false }
      if (next.clients[value.clientId] == null && Object.keys(next.clients).length > 101) throw new Error('max keys')
      next.clients[value.clientId] = value
      await atomicWriteJSON(this.devicesFilePath, next)
      this.devicesInfo = next
      return true
    })
  }
  saveClientKeyInfo = (keyInfo: LX.Sync.ServerKeyInfo) => this.commitClientKeyInfo(keyInfo)
  updateClientKeyInfo = (keyInfo: LX.Sync.ServerKeyInfo) => this.commitClientKeyInfo(keyInfo, true)`, 'stage and commit device grants')
    patch('    return this.devicesInfo.clients[clientId] ?? null', '    const info = this.devicesInfo.clients[clientId]\n    return info ? { ...info } : null', 'prevent metadata mutation before commit')
    patch(`  removeClientKeyInfo = async(clientId: string) => {
    // eslint-disable-next-line @typescript-eslint/no-dynamic-delete
    delete this.devicesInfo.clients[clientId]
    this.saveDevicesInfoThrottle()
  }`, `  removeClientKeyInfo = (clientId: string) => authTransaction(this.devicesFilePath, async() => {
    const next: DevicesInfo = await readAuthJSON(this.devicesFilePath, { userName: this.userName, clients: {} })
    delete next.clients[clientId]
    await atomicWriteJSON(this.devicesFilePath, next)
    this.devicesInfo = next
  })`, 'commit revocation before acknowledgement')
    patch(`
    this.saveDevicesInfoThrottle = throttle(() => {
      writeFile(this.devicesFilePath, JSON.stringify(this.devicesInfo), 'utf8', (err) => {
        if (err) console.error(err)
      })
    })`, '', 'remove deferred device persistence')
  }
  if (file.endsWith('/server/server/auth.ts')) {
    patch('const verifyByKey = (encryptMsg:', 'const verifyByKey = async(encryptMsg:', 'await existing credential metadata')
    patch(`    if (deviceName != keyInfo.deviceName) {
      keyInfo.deviceName = deviceName
      userSpace.dataManage.saveClientKeyInfo(keyInfo)
    }`, `    keyInfo.deviceName = deviceName
    if (!await userSpace.dataManage.updateClientKeyInfo(keyInfo)) return null`, 'do not resurrect revoked credentials')
    patch('const verifyByCode = (encryptMsg:', 'const verifyByCode = async(encryptMsg:', 'await new credential commit')
    patch('    userSpace.dataManage.saveClientKeyInfo(keyInfo)', '    await userSpace.dataManage.saveClientKeyInfo(keyInfo)', 'commit grant before RSA response')
    patch('const _msg = typeof userId', 'const _msg = await (typeof userId', 'await authentication outcome')
    patch(': verifyByCode(req.headers.m, password)', ': verifyByCode(req.headers.m, password))', 'await either authentication method')
  }
  if (file.endsWith('/snapshotDataManage.ts')) {
    patch('  clearOldSnapshot = async() => {', '  clearOldSnapshot = serial(async() => {', 'serialize snapshot maintenance')
    patch('  }\n\n  updateDeviceSnapshotKey', '  }, () => this)\n\n  updateDeviceSnapshotKey', 'share snapshot manager critical section')
    patch('this.snapshotInfo.list.filter(key => !this.isIncluedsDevice(key))', 'this.snapshotInfo.list.filter(key => key !== this.snapshotInfo.latest && !this.isIncluedsDevice(key))', 'protect latest during pruning')
    patch(`      if (name) {
        await this.removeSnapshot(name)
        this.snapshotInfo.list.splice(this.snapshotInfo.list.indexOf(name), 1)`, `      if (name) {
        if (name === this.snapshotInfo.latest || this.isIncluedsDevice(name)) continue
        await this.removeSnapshot(name)
        const index = this.snapshotInfo.list.indexOf(name)
        if (index >= 0) this.snapshotInfo.list.splice(index, 1)`, 'recheck protection and valid history index')
  }
  if (file.endsWith('/server/modules/list/manage.ts') || file.endsWith('/server/modules/dislike/manage.ts')) {
    source = "import { serial } from '@ztools/sync/storage'\n" + source
    patch('  createSnapshot = async() => {', '  createSnapshot = serial(async() => {', 'serialize snapshot creation')
    patch('  }\n\n  getCurrentListInfoKey', '  }, () => this.snapshotDataManage)\n\n  getCurrentListInfoKey', 'share snapshot creation critical section')
  }
  if (file.endsWith('/client/data.ts')) {
    source = "import { authTransaction, atomicWriteJSON, readAuthJSON } from '@ztools/sync/storage'\n" + source
    patch(`let syncAuthKeys: Record<string, LX.Sync.ClientKeyInfo>


const saveSyncAuthKeys = async() => {
  const syncAuthKeysFilePath = path.join(global.lxDataPath, File.clientDataPath, File.syncAuthKeysJSON)
  return fs.promises.writeFile(syncAuthKeysFilePath, JSON.stringify(syncAuthKeys), 'utf8')
}

export const initClientInfo = async() => {
  if (syncAuthKeys != null) return
  const syncAuthKeysFilePath = path.join(global.lxDataPath, File.clientDataPath, File.syncAuthKeysJSON)
  if (await fs.promises.stat(syncAuthKeysFilePath).then(() => true).catch(() => false)) {
    // eslint-disable-next-line require-atomic-updates
    syncAuthKeys = JSON.parse((await fs.promises.readFile(syncAuthKeysFilePath)).toString())
  } else {
    // eslint-disable-next-line require-atomic-updates
    syncAuthKeys = {}
    const syncDataPath = path.join(global.lxDataPath, File.clientDataPath)
    if (!await exists(syncDataPath)) {
      await fs.promises.mkdir(syncDataPath, { recursive: true })
    }
    void saveSyncAuthKeys()
  }
}

export const getSyncAuthKey = async(serverId: string) => {
  await initClientInfo()
  return syncAuthKeys[serverId] ?? null
}
export const setSyncAuthKey = async(serverId: string, info: LX.Sync.ClientKeyInfo) => {
  await initClientInfo()
  syncAuthKeys[serverId] = info
  void saveSyncAuthKeys()
}`, `let syncAuthKeys: Record<string, LX.Sync.ClientKeyInfo>
let committedAuthPath: string | undefined
const authPath = () => path.join(global.lxDataPath, File.clientDataPath, File.syncAuthKeysJSON)
export const initClientInfo = async() => {
  const file = authPath()
  return authTransaction(file, async() => {
    if (syncAuthKeys && committedAuthPath === file) return
    let next = await readAuthJSON(file)
    if (!next) {
      next = {}
      await fs.promises.mkdir(path.dirname(file), { recursive: true })
      await atomicWriteJSON(file, next)
    }
    syncAuthKeys = next
    committedAuthPath = file
  })
}
export const getSyncAuthKey = async(serverId: string) => {
  await initClientInfo()
  const info = syncAuthKeys[serverId]
  return info ? { ...info } : null
}
export const setSyncAuthKey = async(serverId: string, info: LX.Sync.ClientKeyInfo) => {
  const value = { ...info }
  await initClientInfo()
  const file = authPath()
  return authTransaction(file, async() => {
    const next = { ...await readAuthJSON(file), [serverId]: value }
    await atomicWriteJSON(file, next)
    syncAuthKeys = next
    committedAuthPath = file
  })
}`, 'atomic client identity and pairing transactions')
  }
  if (file === 'main/modules/sync/client/index.ts') {
    patch('let connectId = 0', 'let connectId = 0\nexport const cancelPendingConnect = () => { connectId++ }', 'invalidate pending authentication before queued stop')
    patch('  await migrateData(global.lxDataPath)\n\n  return handleConnect', '  await migrateData(global.lxDataPath)\n  if (id != connectId) return\n\n  return handleConnect', 'preserve connection generation across migration')
  }
  if (file.endsWith('/client/auth.ts')) {
    patch("  console.log('connect: ', urlInfo.href, authCode)", "  // Credentials never enter host logs.", 'redact authentication code')
    patch('    void setSyncAuthKey(serverId, info)', '    await setSyncAuthKey(serverId, info)', 'persist authentication before success')
  }
  if (file.endsWith('/server/server/server.ts')) {
    patch('  userSpace.dataManage.saveClientKeyInfo(keyInfo)', `  // The key is already committed; expose socket ownership before awaiting its metadata update.
  socket.keyInfo = keyInfo
  socket.userInfo = { name: 'default' }
  if (!await userSpace.dataManage.updateClientKeyInfo(keyInfo).catch(error => { log.warn(error); return false })) {
    socket.close(SYNC_CLOSE_CODE.failed)
    return
  }
  if (!wss || socket.readyState !== 1) return`, 'commit connection metadata without restoring revoked key')
    patch('if (client.keyInfo.clientId == clientId)', 'if (client.keyInfo?.clientId == clientId)', 'allow revocation during connection setup')
    patch('client.keyInfo.clientId != newSocket.keyInfo.clientId', 'client.keyInfo?.clientId != newSocket.keyInfo.clientId', 'ignore unowned sockets during duplicate checks')
    patch('        void authCode(req, res, status.code)', `        void authCode(req, res, status.code).catch(error => {
          log.error(error)
          if (!res.headersSent) res.writeHead(500)
          res.end(SYNC_CODE.msgAuthFailed)
        })`, 'return failed auth commit to HTTP caller')
    patch('export const startServer = async(port: number) => {', 'export const startServer = async(port: number, isCurrent: () => boolean = () => true) => {', 'accept host startup generation')
    patch('  await migrateData(global.lxDataPath)\n  await initServerInfo()', '  await migrateData(global.lxDataPath)\n  if (!isCurrent()) return\n  await initServerInfo()\n  if (!isCurrent()) return', 'cancel obsolete server preflight before listening')
    patch("    log.warn(err)\n    return", "    log.warn(err)\n    socket.close(SYNC_CLOSE_CODE.failed)\n    return", 'failed module never becomes connected')
    patch("httpServer.on('error', error => {\n    console.log(error)\n    reject(error)", "httpServer.on('error', error => {\n    clearInterval(interval)\n    wss?.close()\n    wss = null\n    for (const socket of sockets) socket.destroy()\n    sockets.clear()\n    reject(error)", 'startup failure cleanup')
    patch(`const handleStopServer = async() => new Promise<void>((resolve, reject) => {
  if (!wss) return
  for (const client of wss.clients) client.close(SYNC_CLOSE_CODE.normal)
  unregisterLocalSyncEvent()
  wss.close()
  wss = null
  httpServer.close((err) => {
    if (err) {
      reject(err)
      return
    }
    resolve()
  })
  for (const socket of sockets) socket.destroy()
  sockets.clear()
})`, `const handleStopServer = async() => {
  const server = wss
  if (!server) return
  unregisterLocalSyncEvent()
  wss = null
  const websocketClosed = new Promise<void>(resolve => server.close(() => resolve()))
  const httpClosed = new Promise<void>((resolve, reject) => httpServer.close(err => err ? reject(err) : resolve()))
  for (const client of server.clients) client.close(SYNC_CLOSE_CODE.normal)
  for (const socket of sockets) socket.destroy()
  sockets.clear()
  await Promise.all([websocketClosed, httpClosed])
}`, 'await complete websocket shutdown')
    patch('if (!status.status) {', 'if (!status.status && !wss) {', 'failed listener can stop')
    patch("status.message = ''\n    status.address = []\n    status.code = ''\n  }).catch", "status.message = ''\n    status.address = []\n    status.code = ''\n    status.devices = []\n  }).catch", 'clear connected device status')
  }
  if (file.endsWith('/server/server/sync/sync.ts')) {
    patch('await modules[moduleName].sync(socket).catch(_ => _)', 'await modules[moduleName].sync(socket)', 'propagate failed business commit')
  }
  if (file.endsWith('/client/sync/handler.ts')) {
    const count = source.split('        return features').length - 1
    if (count !== 2) throw new Error(`LX sync feature negotiation shape changed: ${file}`)
    source = source.replaceAll('        return features', '        socket.feature = features\n        return features')
  }
  if (file.endsWith('/server/user/index.ts')) {
    patch('users.delete(userName)\n  }, delayTime)', 'delayReleaseTimeouts.delete(userName)\n    users.delete(userName)\n  }, delayTime)', 'release timer bookkeeping')
  }
  if (file.endsWith('/client/client.ts')) {
    // Each closure owns its socket. Late crypto/messages can no longer send to,
    // mark ready, or close a newer connection held in the module-level variable.
    const begin = source.indexOf('export const connect = ')
    const end = source.indexOf('export const disconnect = ')
    if (begin < 0 || end < begin) throw new Error('LX sync client connect shape changed')
    let connect = source.slice(begin, end)
    connect = replaceOnce(connect, '  client = new WebSocket(', '  const socket = new WebSocket(', 'socket ownership')
    connect = connect.replace(/\bclient\b/g, 'socket')
    connect = replaceOnce(connect, '  socket.data = {', '  client = socket\n  socket.data = {', 'publish active socket')
    connect = replaceOnce(connect, '      finished() {', `      finished() {
        if (client !== socket) return
        if (Object.keys(socket.feature ?? {}).some(name => !socket.moduleReadys?.[name])) {
          sendSyncStatus({ status: false, message: 'Sync module failed' })
          socket.close(SYNC_CLOSE_CODE.failed)
          throw new Error('Sync module failed')
        }`, 'reject premature finished')
    connect = connect.replace('      return [socket, ...rawArgs]', "      if (client !== socket) throw new Error('stale sync connection')\n      return [socket, ...rawArgs]")
    connect = connect.replace("  socket.addEventListener('open', () => {", "  socket.addEventListener('open', () => {\n    if (client !== socket) return")
    connect = connect.replace("  socket.addEventListener('error', ({ message }) => {", "  socket.addEventListener('error', ({ message }) => {\n    if (client !== socket) return")
    connect = connect.replace('    switch (code) {', '    if (client !== socket) return\n    switch (code) {')
    source = source.slice(0, begin) + connect + source.slice(end)
    patch("  client.close(SYNC_CLOSE_CODE.normal)\n  client = null\n  heartbeatTools.clearTimeout()\n  heartbeatTools.failedNum = 0", "  const socket = client\n  client = null\n  heartbeatTools.clearTimeout()\n  heartbeatTools.failedNum = 0\n  await new Promise<void>(resolve => {\n    if (socket.readyState === WebSocket.CLOSED) { resolve(); return }\n    const timer = setTimeout(() => socket.terminate(), 1000)\n    socket.once('close', () => { clearTimeout(timer); resolve() })\n    socket.close(SYNC_CLOSE_CODE.normal)\n  })", 'wait close before reconfigure')
    patch("    socket.on('open', () => {", "    socket.on('open', () => {\n      if (client !== socket) return", 'stale heartbeat open')
    patch("    socket.on('ping', () => {", "    socket.on('ping', () => {\n      if (client !== socket) return", 'stale heartbeat ping')
    patch("    socket.on('close', (code) => {", "    socket.on('close', (code) => {\n      if (client !== socket) return", 'stale heartbeat reconnect')
  }
  return source
}
module.exports = { adaptSyncSource }
