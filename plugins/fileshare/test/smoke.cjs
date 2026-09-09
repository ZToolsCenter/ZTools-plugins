// Temporary smoke test for services.js — stubs window, exercises the HTTP API
const fs = require('node:fs')
const path = require('node:path')
const os = require('node:os')
const http = require('node:http')
const crypto = require('node:crypto')
const zlib = require('node:zlib')

const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'fs-smoke-'))
const downloads = path.join(tmpRoot, 'downloads')
fs.mkdirSync(downloads, { recursive: true })

// Fixture: shared dir with nested files, plus a secret outside the share list
const sharedDir = path.join(tmpRoot, 'shared')
fs.mkdirSync(path.join(sharedDir, 'sub'), { recursive: true })
fs.writeFileSync(path.join(sharedDir, 'a.txt'), 'hello world A')
fs.writeFileSync(path.join(sharedDir, 'sub', 'b.txt'), 'nested content B')
const secretFile = path.join(tmpRoot, 'secret.txt')
fs.writeFileSync(secretFile, 'TOP SECRET')

// Stub window
global.window = {
  ztools: {
    dbStorage: { getItem: () => null, setItem: () => {}, removeItem: () => {} },
    getPath: (name) => downloads,
    showNotification: () => {},
    copyText: () => true,
    shellShowItemInFolder: () => {},
    showOpenDialog: () => null
  }
}

require('../public/preload/services.js')

const results = []
function check(name, cond, extra) {
  results.push({ name, pass: !!cond, extra })
  console.log((cond ? 'PASS' : 'FAIL') + ' | ' + name + (extra ? ' | ' + extra : ''))
}

function waitUntil(fn, timeoutMs) {
  return new Promise((resolve) => {
    const start = Date.now()
    const tick = () => {
      if (fn()) return resolve(true)
      if (Date.now() - start > timeoutMs) return resolve(false)
      setTimeout(tick, 100)
    }
    tick()
  })
}

// Raw HTTP request with a pinned source address. Used to simulate requests
// from different client IPs (127.0.0.x loopback aliases) without relying on
// the spoofable x-forwarded-for header, which the server must ignore.
function rawReq(base, method, reqPath, opts) {
  const o = opts || {}
  const u = new URL(base + reqPath)
  return new Promise((resolve, reject) => {
    const req = http.request({
      host: u.hostname,
      port: u.port,
      path: u.pathname + u.search,
      method: method,
      localAddress: o.localAddress,
      headers: o.headers || {}
    }, (res) => {
      const chunks = []
      res.on('data', (c) => chunks.push(c))
      res.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf-8')
        let json = null
        try { json = JSON.parse(text) } catch (_e) { /* not json */ }
        resolve({ status: res.statusCode, text, json })
      })
    })
    req.on('error', reject)
    if (o.body) req.write(o.body)
    req.end()
  })
}

async function main() {
  window.services.addShares([sharedDir])
  const res = await window.services.startServer(0, '127.0.0.1')
  check('server starts', res.ok, JSON.stringify(res))
  const status = window.services.getServerStatus()
  const port = status.port
  const token = status.token
  const base = `http://127.0.0.1:${port}`

  // 1. Security: arbitrary file outside share list must be 403
  let r = await fetch(`${base}/api/file?path=${encodeURIComponent(secretFile)}&token=${token}`)
  check('path traversal blocked (403)', r.status === 403, 'got ' + r.status)

  // 2. Normal shared file must be 200
  r = await fetch(`${base}/api/file?path=${encodeURIComponent(path.join(sharedDir, 'a.txt'))}&token=${token}`)
  const text = await r.text()
  check('shared file serves (200)', r.status === 200 && text === 'hello world A', 'got ' + r.status)

  // 3. Disabled item must be 403
  const list = window.services.getShareList()
  const aItem = list[0].children.find(c => c.name === 'a.txt')
  window.services.toggleShare(aItem.id, false)
  r = await fetch(`${base}/api/file?path=${encodeURIComponent(path.join(sharedDir, 'a.txt'))}&token=${token}`)
  check('disabled item blocked (403)', r.status === 403, 'got ' + r.status)
  window.services.toggleShare(aItem.id, true)

  // 4. Upload multipart
  const boundary = '----smokeBoundary42'
  const body = Buffer.concat([
    Buffer.from(`--${boundary}\r\n`),
    Buffer.from('Content-Disposition: form-data; name="file"; filename="hello.txt"\r\n'),
    Buffer.from('Content-Type: text/plain\r\n\r\n'),
    Buffer.from('hello upload'),
    Buffer.from(`\r\n--${boundary}--\r\n`)
  ])
  r = await fetch(`${base}/api/upload?token=${token}`, {
    method: 'POST',
    headers: { 'Content-Type': `multipart/form-data; boundary=${boundary}` },
    body: body
  })
  const upJson = await r.json()
  check('upload returns ok', r.status === 200 && upJson.ok === true, JSON.stringify(upJson))
  const savedPath = path.join(downloads, 'z-share-uploads', 'hello.txt')
  check('upload saved to disk', fs.existsSync(savedPath) && fs.readFileSync(savedPath, 'utf-8') === 'hello upload')
  const list2 = window.services.getShareList()
  const upItem = list2.find(i => i.path === savedPath)
  check('upload added to share list with origin', !!upItem && upItem.origin && upItem.origin.type === 'upload' && upItem.origin.ip === '127.0.0.1', JSON.stringify(upItem && upItem.origin))
  check('upload item stores hash at save time', !!upItem && upItem.hash === crypto.createHash('sha256').update('hello upload').digest('hex'), JSON.stringify(upItem && { hash: upItem.hash, size: upItem.hashSize }))
  const logs = window.services.getDownloadLogs()
  check('upload logged with type', logs.some(l => l.type === 'upload' && l.fileName === 'hello.txt'), JSON.stringify(logs))

  // 4b. /api/list exposes clientIp so the Web UI can gate delete buttons
  r = await fetch(`${base}/api/list?token=${token}`)
  const listJson = await r.json()
  check('list exposes clientIp', r.status === 200 && listJson.clientIp === '127.0.0.1',
    JSON.stringify({ clientIp: listJson.clientIp }))

  // 4b1. Local-host detection: loopback access is flagged local and gets a
  // localhost URL; a different loopback alias is not the host machine
  check('loopback access flagged isLocalHost', listJson.isLocalHost === true,
    JSON.stringify({ isLocalHost: listJson.isLocalHost, hostLocalUrl: listJson.hostLocalUrl }))
  check('local access exposes localhost URL', typeof listJson.hostLocalUrl === 'string' && listJson.hostLocalUrl.includes('127.0.0.1'),
    listJson.hostLocalUrl)
  r = await rawReq(base, 'GET', `/api/list?token=${token}`, { localAddress: '127.0.0.2' })
  const remoteList = r.json
  check('other machine (127.0.0.2) not flagged local', remoteList.isLocalHost === false,
    JSON.stringify({ isLocalHost: remoteList.isLocalHost }))

  // 4c. DELETE /api/delete — restricted by the uploader's real socket IP
  // A different source IP cannot delete the upload
  r = await rawReq(base, 'DELETE', `/api/delete?path=${encodeURIComponent(savedPath)}&token=${token}`, { localAddress: '127.0.0.2' })
  check('delete blocked for other IP (403)', r.status === 403, 'got ' + r.status)

  // Spoofed x-forwarded-for must be ignored — identity comes from the socket
  r = await rawReq(base, 'DELETE', `/api/delete?path=${encodeURIComponent(savedPath)}&token=${token}`, {
    localAddress: '127.0.0.2',
    headers: { 'x-forwarded-for': '127.0.0.1' }
  })
  check('x-forwarded-for spoof ignored (403)', r.status === 403, 'got ' + r.status)

  // A non-upload (host share) cannot be deleted via the Web API even with matching IP
  r = await rawReq(base, 'DELETE', `/api/delete?path=${encodeURIComponent(path.join(sharedDir, 'a.txt'))}&token=${token}`, {})
  check('delete rejected for host share (403)', r.status === 403, 'got ' + r.status)

  // The uploader's own IP can delete it
  r = await rawReq(base, 'DELETE', `/api/delete?path=${encodeURIComponent(savedPath)}&token=${token}`, {})
  const delJson = r.json
  check('delete allowed for uploader IP (200)', r.status === 200 && delJson.ok === true, 'got ' + r.status + ' ' + JSON.stringify(delJson))
  const diskGone = await waitUntil(() => !fs.existsSync(savedPath), 3000)
  check('deleted upload removed from disk', diskGone)
  const listAfterDel = window.services.getShareList()
  check('deleted upload removed from share list', !listAfterDel.some(i => i.path === savedPath))

  // Even with the valid token, a different IP cannot delete another IP's upload
  const boundary2 = '----smokeBoundary43'
  const body2 = Buffer.concat([
    Buffer.from(`--${boundary2}\r\n`),
    Buffer.from('Content-Disposition: form-data; name="file"; filename="other-ip.txt"\r\n'),
    Buffer.from('Content-Type: text/plain\r\n\r\n'),
    Buffer.from('uploaded from another ip'),
    Buffer.from(`\r\n--${boundary2}--\r\n`)
  ])
  r = await rawReq(base, 'POST', `/api/upload?token=${token}`, {
    localAddress: '127.0.0.2',
    headers: { 'Content-Type': `multipart/form-data; boundary=${boundary2}` },
    body: body2
  })
  const otherIpPath = path.join(downloads, 'z-share-uploads', 'other-ip.txt')
  check('upload from other IP saved with origin 127.0.0.2', r.status === 200 && fs.existsSync(otherIpPath))
  const otherItem = window.services.getShareList().find(i => i.path === otherIpPath)
  check('other-IP upload origin tracked', !!otherItem && otherItem.origin && otherItem.origin.ip === '127.0.0.2', JSON.stringify(otherItem && otherItem.origin))

  r = await rawReq(base, 'DELETE', `/api/delete?path=${encodeURIComponent(otherIpPath)}&token=${token}`, {})
  check('token holder on different IP blocked (403)', r.status === 403, 'got ' + r.status)
  check('blocked delete leaves file on disk', fs.existsSync(otherIpPath))

  // 4d. Plugin-window removal semantics: uploads free their disk copy,
  // host shares keep their source files (they are plain references)
  const otherItemAfter = window.services.getShareList().find(i => i.path === otherIpPath)
  check('other-IP upload still shared before removal', !!otherItemAfter)
  window.services.removeShare(otherItemAfter.id)
  const uploadFreed = await waitUntil(() => !fs.existsSync(otherIpPath), 3000)
  check('plugin removeShare frees upload disk copy', uploadFreed)

  const hostOnlyFile = path.join(tmpRoot, 'host-only.txt')
  fs.writeFileSync(hostOnlyFile, 'host only')
  window.services.addShares([hostOnlyFile])
  const hostOnlyItem = window.services.getShareList().find(i => i.path === hostOnlyFile)
  check('host-only share added', !!hostOnlyItem)
  window.services.removeShare(hostOnlyItem.id)
  check('plugin removeShare keeps host source file', fs.existsSync(hostOnlyFile))

  // 4e. Upload dedupe & same-name conflict resolution
  const dupBoundary = '----smokeDup'
  const dupBody = (name, content) => Buffer.concat([
    Buffer.from(`--${dupBoundary}\r\n`),
    Buffer.from(`Content-Disposition: form-data; name="file"; filename="${name}"\r\n`),
    Buffer.from('Content-Type: application/octet-stream\r\n\r\n'),
    Buffer.from(content),
    Buffer.from(`\r\n--${dupBoundary}--\r\n`)
  ])
  const dupUpload = (name, content) => fetch(`${base}/api/upload?token=${token}`, {
    method: 'POST',
    headers: { 'Content-Type': `multipart/form-data; boundary=${dupBoundary}` },
    body: dupBody(name, content)
  })
  const uploadsDirPath = path.join(downloads, 'z-share-uploads')

  // First upload succeeds
  r = await dupUpload('dedupe.txt', 'content-A')
  const dup1 = await r.json()
  check('first upload saved', r.status === 200 && dup1.ok && dup1.files.length === 1 && dup1.files[0].name === 'dedupe.txt', JSON.stringify(dup1))

  // Identical re-upload is skipped as duplicate, nothing written
  r = await dupUpload('dedupe.txt', 'content-A')
  const dup2 = await r.json()
  check('identical re-upload flagged duplicate', r.status === 200 && dup2.duplicates.length === 1 && dup2.files.length === 0, JSON.stringify(dup2))
  check('duplicate not saved to disk twice', fs.readdirSync(uploadsDirPath).filter(n => n.startsWith('dedupe')).length === 1)

  // Same name, different content → held pending (own upload → can overwrite)
  r = await dupUpload('dedupe.txt', 'content-B')
  const dup3 = await r.json()
  check('same-name different content held pending', r.status === 200 && dup3.pending.length === 1 && dup3.pending[0].canOverwrite === true, JSON.stringify(dup3))
  check('pending upload not written yet', fs.readFileSync(path.join(uploadsDirPath, 'dedupe.txt'), 'utf-8') === 'content-A')

  // A different IP cannot resolve the pending upload
  r = await rawReq(base, 'POST', `/api/upload-resolve?token=${token}`, {
    localAddress: '127.0.0.2',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ id: dup3.pending[0].id, action: 'overwrite' })
  })
  check('pending resolve blocked for other IP (403)', r.status === 403, 'got ' + r.status)

  // Overwrite replaces the previous upload
  r = await fetch(`${base}/api/upload-resolve?token=${token}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ id: dup3.pending[0].id, action: 'overwrite' })
  })
  const ov = await r.json()
  check('overwrite applied', r.status === 200 && ov.ok && ov.saved && ov.saved.name === 'dedupe.txt', JSON.stringify(ov))
  check('overwrite replaced disk content', fs.readFileSync(path.join(uploadsDirPath, 'dedupe.txt'), 'utf-8') === 'content-B')
  const dedupeEntries = window.services.getShareList().filter(i => i.name.startsWith('dedupe'))
  check('overwrite keeps single share entry', dedupeEntries.length === 1)

  // Same name as a host share → cannot overwrite; rename works
  r = await dupUpload('a.txt', 'different content from client')
  const hostConflict = await r.json()
  check('host-share name conflict cannot overwrite', hostConflict.pending.length === 1 && hostConflict.pending[0].canOverwrite === false, JSON.stringify(hostConflict))
  r = await fetch(`${base}/api/upload-resolve?token=${token}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ id: hostConflict.pending[0].id, action: 'rename' })
  })
  const renamed = await r.json()
  check('rename resolves host-share conflict', r.status === 200 && renamed.ok && renamed.saved.name === 'a (1).txt', JSON.stringify(renamed))
  check('host share untouched by rename', fs.readFileSync(path.join(sharedDir, 'a.txt'), 'utf-8') === 'hello world A')

  // Identical content to a host share → duplicate (lazy host hashing works)
  r = await dupUpload('a.txt', 'hello world A')
  const hostDup = await r.json()
  check('same content as host share flagged duplicate', hostDup.duplicates.length === 1, JSON.stringify(hostDup))

  // 5. ZIP download: valid archive, correct entry list, content round-trips
  r = await fetch(`${base}/api/zip?token=${token}&path=${encodeURIComponent(sharedDir)}`)
  const zipBuf = Buffer.from(await r.arrayBuffer())
  check('zip returns 200', r.status === 200, 'status=' + r.status + ' size=' + zipBuf.length)
  check('zip signature PK', zipBuf[0] === 0x50 && zipBuf[1] === 0x4b && zipBuf[2] === 0x03 && zipBuf[3] === 0x04)

  // Parse central directory to verify entries + extract a.txt content
  const eocd = zipBuf.length - 22
  const cdCount = zipBuf.readUInt16LE(eocd + 10)
  const cdOffset = zipBuf.readUInt32LE(eocd + 16)
  const entries = []
  let p = cdOffset
  for (let i = 0; i < cdCount; i++) {
    const method = zipBuf.readUInt16LE(p + 10)
    const compSize = zipBuf.readUInt32LE(p + 20)
    const nameLen = zipBuf.readUInt16LE(p + 28)
    const extraLen = zipBuf.readUInt16LE(p + 30)
    const commentLen = zipBuf.readUInt16LE(p + 32)
    const localOffset = zipBuf.readUInt32LE(p + 42)
    const name = zipBuf.slice(p + 46, p + 46 + nameLen).toString('utf-8')
    entries.push({ name, method, compSize, localOffset })
    p += 46 + nameLen + extraLen + commentLen
  }
  const names = entries.map(e => e.name).sort()
  check('zip contains dir + nested files', JSON.stringify(names) === JSON.stringify(['shared/', 'shared/a.txt', 'shared/sub/', 'shared/sub/b.txt']), JSON.stringify(names))

  // Extract a.txt and compare
  const aEntry = entries.find(e => e.name === 'shared/a.txt')
  const lnLen = zipBuf.readUInt16LE(aEntry.localOffset + 26)
  const lnExtra = zipBuf.readUInt16LE(aEntry.localOffset + 28)
  const dataStart = aEntry.localOffset + 30 + lnLen + lnExtra
  const comp = zipBuf.slice(dataStart, dataStart + aEntry.compSize)
  const extracted = aEntry.method === 8 ? zlib.inflateRawSync(comp) : comp
  check('zip a.txt content matches', extracted.toString('utf-8') === 'hello world A', extracted.toString('utf-8'))

  // 6. Zip scope validation: non-shared path must 404
  r = await fetch(`${base}/api/zip?token=${token}&path=${encodeURIComponent(secretFile)}`)
  check('zip rejects non-shared path (404)', r.status === 404, 'got ' + r.status)

  // 7. Port conflict detection
  const net = require('node:net')
  const blocker = net.createServer()
  await new Promise(res => blocker.listen(0, '127.0.0.1', res))
  const busyPort = blocker.address().port
  const conflict = await window.services.startServer(busyPort, '127.0.0.1')
  check('port conflict reported', conflict.ok === false && /占用|EADDRINUSE|address/i.test(conflict.error || ''), JSON.stringify(conflict))
  blocker.close()
  const free = await window.services.getFreePort('127.0.0.1')
  check('getFreePort returns port', free > 0, String(free))

  window.services.stopServer()
  blocker.close()

  const failed = results.filter(r => !r.pass)
  console.log('\n' + (failed.length === 0 ? 'ALL PASS' : failed.length + ' FAILED'))
  // Give closing handles a moment to settle before exiting (avoids a libuv
  // assertion on Windows when the process tears down mid-close)
  setTimeout(() => process.exit(failed.length === 0 ? 0 : 1), 300)
}

main().catch(err => { console.error('TEST CRASH:', err); process.exit(1) })
