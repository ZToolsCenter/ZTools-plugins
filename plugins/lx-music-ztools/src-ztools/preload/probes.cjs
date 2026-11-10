const { randomUUID } = require('node:crypto')
const { pathToFileURL } = require('node:url')
const path = require('node:path')
const { startWorkerServer } = require('./worker-server.cjs')
const { DatabaseSync } = require('node:sqlite')
const fs = require('node:fs')

/** Characterize actual host storage results rather than assuming PouchDB semantics. */
function probeCapabilities(ztools) {
  const id = `lx:p0:${randomUUID()}`
  const db = ztools.db
  const initial = { _id: id, value: 'old' }
  const put = db.put(initial)
  const read = db.get(id)
  const second = db.put({ _id: id, _rev: read?._rev, value: 'new' })
  const stale = db.put({ _id: id, _rev: read?._rev, value: 'stale' })
  const size = db.put({ _id: `${id}:large`, value: 'a'.repeat(1024 * 1024 + 1) })
  const bulk = db.bulkDocs([{ _id: `${id}:valid`, value: 1 }, { _id: `${id}:large`, value: 'a'.repeat(1024 * 1024 + 1) }])
  const partial = db.get(`${id}:valid`)
  for (const key of [id, `${id}:large`, `${id}:valid`]) {
    const doc = db.get(key)
    if (doc) db.remove(doc)
  }
  const dbPath = path.join(ztools.getPath('pluginData'), `probe-${randomUUID()}.sqlite`)
  fs.mkdirSync(path.dirname(dbPath), { recursive: true })
  let sqlite = new DatabaseSync(dbPath)
  sqlite.exec('CREATE TABLE test (id INTEGER PRIMARY KEY, value TEXT); INSERT INTO test VALUES (1,\'old\')')
  try { sqlite.exec("BEGIN; UPDATE test SET value='new'; INSERT INTO test VALUES (1,'duplicate'); COMMIT") }
  catch { sqlite.exec('ROLLBACK') }
  const rollback = sqlite.prepare('SELECT value FROM test WHERE id=1').get().value === 'old'
  sqlite.close()
  sqlite = new DatabaseSync(dbPath)
  const reopen = sqlite.prepare('SELECT value FROM test WHERE id=1').get().value === 'old'
  sqlite.close(); fs.unlinkSync(dbPath)
  return {
    localSQLite: { rollback, reopen },
    host: { name: ztools.getAppName(), version: ztools.getAppVersion(), runtime: { ...process.versions } },
    storage: { roundtrip: read?.value === 'old', put, second, stale, size, bulk, partial: Boolean(partial), callerIdMutated: initial._id !== id },
    paths: { pluginData: ztools.getPath('pluginData') },
  }
}

/** Create an opaque-origin guest with a fresh session and synchronous restricted bridge. */
async function probeSourceIsolation() {
  await new Promise(resolve => setTimeout(resolve, 1000))
  const guest = document.createElement('webview')
  guest.setAttribute('partition', `lx-source-probe-${randomUUID()}`)
  guest.setAttribute('webpreferences', 'contextIsolation=yes,nodeIntegration=no,sandbox=no,webSecurity=yes,backgroundThrottling=no')
  guest.setAttribute('preload', pathToFileURL(path.join(__dirname, 'probe-guest.cjs')).href)
  guest.style.cssText = 'width:1px;height:1px;position:fixed;left:-100px;'
  const ready = new Promise((resolve, reject) => {
    guest.addEventListener('dom-ready', resolve, { once: true })
    guest.addEventListener('did-fail-load', event => reject(new Error(event.errorDescription)), { once: true })
    setTimeout(() => reject(new Error(`Guest initialization timed out: method=${typeof guest.getWebContentsId}, connected=${guest.isConnected}, html=${guest.outerHTML}`)), 8000)
  })
  guest.setAttribute('src', 'data:text/html,' + encodeURIComponent(`<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-eval'; connect-src 'none'; frame-src 'none';"><body>Isolated source</body>`))
  document.body.append(guest)
  await ready
  const result = await guest.executeJavaScript(`(async()=>({node:typeof require,ztools:typeof ztools,parentBridge:typeof parent.services,syncMd5:lxProbe.md5('abc'),hostFileReadable:await fetch('file:///C:/Windows/win.ini').then(()=>true,()=>false),origin:location.origin}))()`)
  // Keep the guest alive for the runner to inspect actual webPreferences.
  window.__lxProbeGuest = guest
  return result
}
async function probeWorkerIsolation(publicKey) {
  const server = await startWorkerServer('probe-worker.js')
  const frame = document.createElement('iframe')
  frame.style.display = 'none'
  frame.setAttribute('sandbox', 'allow-scripts allow-same-origin')
  let listener
  let probeResult
  try {
    const result = await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Worker probe timed out')), 8000)
      listener = event => {
        const { data } = event
        if (event.source !== frame.contentWindow || data.channel !== server.token) return
        if (data.type === 'ready') { frame.contentWindow.postMessage({ channel: server.token, type: 'probe', publicKey, url: server.url + '?denied' }, new URL(server.url).origin); return }
        if (data.type === 'probe-result') {
          probeResult = data.result
          frame.contentWindow.postMessage({ channel: server.token, type: 'busy' }, new URL(server.url).origin)
          setTimeout(() => frame.contentWindow.postMessage({ channel: server.token, type: 'dispose' }, new URL(server.url).origin), 200)
          return
        }
        clearTimeout(timer)
        data.type === 'error' ? reject(new Error(data.error)) : resolve({ ...probeResult, terminatedBusyWorker: data.type === 'stopped' })
      }
      window.addEventListener('message', listener)
      frame.src = server.url
      document.body.append(frame)
    })
    return { ...result, mode: 'browser-worker-csp', requests: server.getRequests() }
  } finally { window.removeEventListener('message', listener); frame.remove(); await server.close() }
}
module.exports = { probeCapabilities, probeSourceIsolation, probeWorkerIsolation }
