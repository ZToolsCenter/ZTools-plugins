const fs = require('node:fs')
const path = require('node:path')
const http = require('node:http')
const net = require('node:net')
const os = require('node:os')
const zlib = require('node:zlib')
const crypto = require('node:crypto')
const { pipeline, Transform, Writable } = require('node:stream')

// ============================================================
//  State
// ============================================================
let server = null
let loopServer = null // extra 127.0.0.1 listener so local URLs work too
let serverConfig = {
  port: 23456,
  ip: '',
  token: '',
  running: false
}
// Whether the server should auto-start when the plugin UI is opened.
// Reset to true only when the plugin process is freshly loaded;
// set to false when the user manually stops the server.
let autoStartEnabled = true
let shareItems = []
let shareIdCounter = 0
let webUiHtml = ''
let downloadLogs = []       // { type, ip, filePath, fileName, size, timestamp }
let ipWhitelist = []        // ['192.168.1.100', ...]
let lastLogMap = {}         // dedup: { 'ip|path': timestamp }
let uploadsDir = ''         // where client uploads are stored
let pendingUploads = new Map() // unresolved upload conflicts: id -> { name, data, hash, ip, expires }

// ============================================================
//  P2P private-messaging state
// ============================================================
let p2pSessions = []        // P2pSession[]
let p2pMessages = {}        // sessionId -> P2pMessage[]
let p2pPeerKeys = {}        // ip -> { key, peerId, createdAt }
let p2pEventLog = []        // ring buffer of { seq, type, data, ts, sessionId }
let p2pEventSeq = 0
let sseClients = {}         // ip -> { res } (one live SSE connection per client IP)
let p2pDir = ''             // <downloads>/z-share-p2p/<sessionId>/
let p2pMsgSeq = {}          // sessionId -> last message seq
let p2pRequestCooldown = {} // ip -> timestamp (rate-limit connection requests)

// ============================================================
//  Persistence helpers
// ============================================================
function loadState() {
  try {
    const savedShares = window.ztools.dbStorage.getItem('z-share-shares')
    if (savedShares) shareItems = savedShares
    const savedCounter = window.ztools.dbStorage.getItem('z-share-counter')
    if (savedCounter !== null && savedCounter !== undefined) shareIdCounter = savedCounter
    const savedConfig = window.ztools.dbStorage.getItem('z-share-config')
    if (savedConfig) {
      serverConfig.port = savedConfig.port || 23456
      serverConfig.ip = savedConfig.ip || ''
      serverConfig.token = savedConfig.token || ''
    }
    if (!serverConfig.token) {
      serverConfig.token = crypto.randomBytes(8).toString('hex')
      saveConfig()
    }
    const savedLogs = window.ztools.dbStorage.getItem('z-share-logs')
    if (savedLogs) downloadLogs = savedLogs
    const savedWhitelist = window.ztools.dbStorage.getItem('z-share-whitelist')
    if (savedWhitelist) ipWhitelist = savedWhitelist
  } catch (_e) { /* ignore */ }
}

function saveShares() {
  try {
    window.ztools.dbStorage.setItem('z-share-shares', shareItems)
    window.ztools.dbStorage.setItem('z-share-counter', shareIdCounter)
  } catch (_e) { /* ignore */ }
}

function saveConfig() {
  try {
    window.ztools.dbStorage.setItem('z-share-config', {
      port: serverConfig.port,
      ip: serverConfig.ip,
      token: serverConfig.token
    })
  } catch (_e) { /* ignore */ }
}

function saveLogs() {
  try {
    if (downloadLogs.length > 500) downloadLogs = downloadLogs.slice(-500)
    window.ztools.dbStorage.setItem('z-share-logs', downloadLogs)
  } catch (_e) { /* ignore */ }
}

function saveWhitelist() {
  try {
    window.ztools.dbStorage.setItem('z-share-whitelist', ipWhitelist)
  } catch (_e) { /* ignore */ }
}

// Module-level whitelist mutations so both the plugin API and the local
// browser management console (/api/host/whitelist) share the same logic.
function addWhitelistEntry(ip) {
  const trimmed = String(ip || '').trim()
  if (!trimmed || ipWhitelist.includes(trimmed)) return false
  // Basic IPv4 validation
  if (!/^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(trimmed)) return false
  ipWhitelist.push(trimmed)
  saveWhitelist()
  return true
}

function removeWhitelistEntry(ip) {
  const idx = ipWhitelist.indexOf(ip)
  if (idx === -1) return false
  ipWhitelist.splice(idx, 1)
  saveWhitelist()
  return true
}

function ensureUploadsDir() {
  try {
    uploadsDir = path.join(window.ztools.getPath('downloads'), 'z-share-uploads')
    fs.mkdirSync(uploadsDir, { recursive: true })
  } catch (_e) {
    uploadsDir = ''
  }
}

// ---- P2P persistence (incremental keys, independent from share data) ----
function loadP2pState() {
  try {
    const s = window.ztools.dbStorage.getItem('z-share-p2p-sessions')
    if (s) p2pSessions = s
    const m = window.ztools.dbStorage.getItem('z-share-p2p-msgs')
    if (m) p2pMessages = m
    const k = window.ztools.dbStorage.getItem('z-share-p2p-peerkey')
    if (k) p2pPeerKeys = k
    for (const sess of p2pSessions) p2pMsgSeq[sess.id] = (p2pMessages[sess.id] || []).length
  } catch (_e) { /* ignore */ }
  // Hard cleanup: drop any session that is not pending/active (legacy logical
  // tombstones, rejected leftovers) together with their messages and received
  // files, so stale records never accumulate or confuse the client again.
  cleanupStaleP2pSessions()
}

// Purge every non-actionable session and free its received files.
function cleanupStaleP2pSessions() {
  const stale = p2pSessions.filter(s => s.status !== 'pending' && s.status !== 'active')
  if (stale.length === 0) return
  for (const s of stale) {
    const arr = p2pMessages[s.id] || []
    for (const m of arr) cleanupP2pFiles(m)
    delete p2pMessages[s.id]
    delete p2pMsgSeq[s.id]
  }
  p2pSessions = p2pSessions.filter(s => s.status === 'pending' || s.status === 'active')
  saveP2pSessions()
  saveP2pMessages()
}

function saveP2pSessions() {
  try { window.ztools.dbStorage.setItem('z-share-p2p-sessions', p2pSessions) } catch (_e) { /* ignore */ }
}

function saveP2pMessages() {
  try { window.ztools.dbStorage.setItem('z-share-p2p-msgs', p2pMessages) } catch (_e) { /* ignore */ }
}

function saveP2pPeerKeys() {
  try { window.ztools.dbStorage.setItem('z-share-p2p-peerkey', p2pPeerKeys) } catch (_e) { /* ignore */ }
}

function ensureP2pDir() {
  try {
    p2pDir = path.join(window.ztools.getPath('downloads'), 'z-share-p2p')
    fs.mkdirSync(p2pDir, { recursive: true })
  } catch (_e) {
    p2pDir = ''
  }
}

// ============================================================
//  Share-scope validation (prevents arbitrary file access)
// ============================================================
function normalizePathForCompare(p) {
  let n = path.resolve(p)
  if (process.platform === 'win32') n = n.toLowerCase()
  return n.replace(/\\/g, '/')
}

// Recursively check that a file/directory is inside an *enabled* share item
function isPathShared(items, filePath) {
  const target = normalizePathForCompare(filePath)
  for (const item of items) {
    if (!item.enabled) continue
    const itemPath = normalizePathForCompare(item.path)
    if (item.isDirectory) {
      if (target === itemPath) return true
      if (target.startsWith(itemPath + '/')) {
        if (item.children && item.children.length > 0) {
          return isPathShared(item.children, target)
        }
        return false
      }
    } else if (target === itemPath) {
      return true
    }
  }
  return false
}

// ============================================================
//  MIME type mapping
// ============================================================
const MIME_TYPES = {
  '.html': 'text/html', '.htm': 'text/html', '.css': 'text/css',
  '.js': 'application/javascript', '.mjs': 'application/javascript',
  '.ts': 'text/typescript', '.tsx': 'text/typescript', '.jsx': 'text/javascript',
  '.json': 'application/json', '.xml': 'application/xml',
  '.txt': 'text/plain', '.log': 'text/plain', '.csv': 'text/csv',
  '.md': 'text/markdown', '.markdown': 'text/markdown',
  '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png',
  '.gif': 'image/gif', '.svg': 'image/svg+xml', '.webp': 'image/webp',
  '.bmp': 'image/bmp', '.ico': 'image/x-icon',
  '.mp3': 'audio/mpeg', '.wav': 'audio/wav', '.ogg': 'audio/ogg',
  '.flac': 'audio/flac', '.aac': 'audio/aac', '.m4a': 'audio/mp4',
  '.wma': 'audio/x-ms-wma',
  '.mp4': 'video/mp4', '.webm': 'video/webm', '.mkv': 'video/x-matroska',
  '.avi': 'video/x-msvideo', '.mov': 'video/quicktime',
  '.flv': 'video/x-flv', '.wmv': 'video/x-ms-wmv',
  '.pdf': 'application/pdf',
  '.zip': 'application/zip', '.tar': 'application/x-tar',
  '.gz': 'application/gzip', '.7z': 'application/x-7z-compressed',
  '.py': 'text/x-python', '.java': 'text/x-java',
  '.c': 'text/x-c', '.cpp': 'text/x-c++', '.h': 'text/x-c',
  '.rs': 'text/x-rust', '.go': 'text/x-go',
  '.rb': 'text/x-ruby', '.php': 'text/x-php',
  '.swift': 'text/x-swift', '.kt': 'text/x-kotlin',
  '.sh': 'text/x-shellscript', '.bat': 'text/x-batch',
  '.ps1': 'text/x-powershell', '.sql': 'text/x-sql',
  '.yml': 'text/yaml', '.yaml': 'text/yaml', '.toml': 'text/toml',
  '.ini': 'text/plain', '.cfg': 'text/plain', '.conf': 'text/plain',
  '.env': 'text/plain', '.scss': 'text/x-scss', '.less': 'text/x-less',
  '.vue': 'text/x-vue', '.svelte': 'text/x-svelte',
  '.scala': 'text/x-scala', '.dart': 'text/x-dart',
  '.lua': 'text/x-lua', '.r': 'text/x-r',
}

function getMimeType(filePath) {
  const ext = path.extname(filePath).toLowerCase()
  return MIME_TYPES[ext] || 'application/octet-stream'
}

// ============================================================
//  Web UI HTML loader
// ============================================================
function loadWebUi() {
  try {
    const htmlPath = path.join(__dirname, '..', 'web', 'index.html')
    if (fs.existsSync(htmlPath)) {
      webUiHtml = fs.readFileSync(htmlPath, 'utf-8')
    }
  } catch (_e) {
    webUiHtml = '<!doctype html><html><body><h1>File Share</h1><p>Web UI not found.</p></body></html>'
  }
}

// ============================================================
//  File scanning
// ============================================================
function scanDirectory(dirPath) {
  const result = { fileCount: 0, files: [] }
  try {
    const entries = fs.readdirSync(dirPath, { withFileTypes: true })
    for (const entry of entries) {
      if (entry.name.startsWith('.')) continue
      const fullPath = path.join(dirPath, entry.name)
      try {
        if (entry.isDirectory()) {
          result.files.push({ path: fullPath, name: entry.name, isDirectory: true })
          const sub = scanDirectory(fullPath)
          result.fileCount += sub.fileCount
          result.files.push(...sub.files)
        } else if (entry.isFile()) {
          result.files.push({ path: fullPath, name: entry.name, isDirectory: false })
          result.fileCount++
        }
      } catch (_e) { /* skip */ }
    }
  } catch (_e) { /* skip */ }
  return result
}

function countFilesInDir(dirPath) {
  let count = 0
  try {
    const entries = fs.readdirSync(dirPath, { withFileTypes: true })
    for (const entry of entries) {
      if (entry.name.startsWith('.')) continue
      try {
        if (entry.isDirectory()) {
          count += countFilesInDir(path.join(dirPath, entry.name))
        } else if (entry.isFile()) {
          count++
        }
      } catch (_e) { /* skip */ }
    }
  } catch (_e) { /* skip */ }
  return count
}

// ============================================================
//  Build share tree for a directory
// ============================================================
function buildDirTree(dirPath, basePath) {
  const name = path.basename(dirPath)
  const children = []
  let fileCount = 0

  try {
    const entries = fs.readdirSync(dirPath, { withFileTypes: true })
    entries.sort((a, b) => {
      if (a.isDirectory() && !b.isDirectory()) return -1
      if (!a.isDirectory() && b.isDirectory()) return 1
      return a.name.localeCompare(b.name)
    })

    for (const entry of entries) {
      if (entry.name.startsWith('.')) continue
      const fullPath = path.join(dirPath, entry.name)
      try {
        if (entry.isDirectory()) {
          const subtree = buildDirTree(fullPath, basePath)
          children.push(subtree)
          fileCount += subtree.fileCount
        } else if (entry.isFile()) {
          children.push({
            id: String(++shareIdCounter),
            path: fullPath,
            name: entry.name,
            isDirectory: false,
            enabled: true
          })
          fileCount++
        }
      } catch (_e) { /* skip */ }
    }
  } catch (_e) { /* skip */ }

  return {
    id: String(++shareIdCounter),
    path: dirPath,
    name: name,
    isDirectory: true,
    enabled: true,
    children: children,
    fileCount: fileCount
  }
}

// ============================================================
//  Recursively find/update items in tree
// ============================================================
function findItemById(items, id) {
  for (const item of items) {
    if (item.id === id) return item
    if (item.children) {
      const found = findItemById(item.children, id)
      if (found) return found
    }
  }
  return null
}

function removeItemById(items, id) {
  const idx = items.findIndex(i => i.id === id)
  if (idx !== -1) {
    items.splice(idx, 1)
    return true
  }
  for (const item of items) {
    if (item.children) {
      if (removeItemById(item.children, id)) return true
    }
  }
  return false
}

// ============================================================
//  Build API tree, optionally scoped to a sub-path
// ============================================================
function buildApiTree(items, scopePath) {
  // If scoped, search recursively for the matching item
  if (scopePath) {
    const normScope = scopePath.replace(/\\/g, '/')
    const found = findItemByPath(items, normScope)
    if (found) {
      if (!found.enabled) return []
      const node = {
        name: found.name,
        path: found.path,
        isDirectory: found.isDirectory
      }
      if (found.origin) node.origin = found.origin
      if (found.children && found.children.length > 0) {
        node.children = buildApiTree(found.children)
        if (node.children.length === 0) return []
      }
      return [node]
    }
    return []
  }

  // No scope: return full tree
  return items
    .filter(item => item.enabled)
    .map(item => {
      const node = {
        name: item.name,
        path: item.path,
        isDirectory: item.isDirectory
      }
      if (item.origin) node.origin = item.origin
      if (item.children && item.children.length > 0) {
        node.children = buildApiTree(item.children)
        if (node.children.length === 0) return null
      }
      return node
    })
    .filter(Boolean)
}

// Find item by file system path, recursively
function findItemByPath(items, searchPath) {
  for (const item of items) {
    const itemPath = item.path.replace(/\\/g, '/')
    if (itemPath === searchPath) return item
    // Check if searchPath is inside this directory
    if (item.isDirectory && item.children && searchPath.startsWith(itemPath + '/')) {
      const found = findItemByPath(item.children, searchPath)
      if (found) return found
    }
  }
  return null
}

// ============================================================
//  Deep clone helper
// ============================================================
function deepClone(obj) {
  return JSON.parse(JSON.stringify(obj))
}

// ============================================================
//  HTTP Server
// ============================================================
// Client identity for upload ownership / whitelist / deletion checks.
// Derived strictly from the socket — client-supplied headers like
// x-forwarded-for are trivially spoofable and would let anyone claim
// another uploader's IP, so they are never trusted here.
function getClientIp(req) {
  return String(req.socket.remoteAddress || '').replace(/^::ffff:/, '')
}

// ============================================================
//  Local-host detection (is the browser on the plugin machine?)
// ============================================================
let localIpSet = new Set()

function refreshLocalIpSet() {
  const set = new Set(['127.0.0.1', '::1'])
  try {
    const interfaces = os.networkInterfaces()
    for (const addrs of Object.values(interfaces)) {
      for (const addr of (addrs || [])) {
        if (addr && addr.family === 'IPv4') set.add(addr.address)
      }
    }
  } catch (_e) { /* ignore */ }
  localIpSet = set
}

// Whether the requesting browser runs on the same machine as the plugin.
// Used only for UI hints (e.g. recommending a localhost URL), never as a
// security boundary — a source address is not an authentication factor.
function isLocalHost(clientIp) {
  const ip = String(clientIp || '').replace(/^::ffff:/, '')
  if (!ip) return false
  if (localIpSet.has(ip)) return true
  return serverConfig.running && ip === serverConfig.ip
}

function buildLocalUrl() {
  return `http://127.0.0.1:${serverConfig.port}/?token=${serverConfig.token}`
}

function buildLanUrl() {
  return serverConfig.ip ? `http://${serverConfig.ip}:${serverConfig.port}/?token=${serverConfig.token}` : ''
}

function createServer(port, ip) {
  return http.createServer((req, res) => {
    // CORS
    res.setHeader('Access-Control-Allow-Origin', '*')
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS')
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Range')

    if (req.method === 'OPTIONS') {
      res.writeHead(204)
      res.end()
      return
    }

    // Parse URL
    const urlObj = new URL(req.url, `http://${ip}:${port}`)
    const token = urlObj.searchParams.get('token') || ''

    // Auth check — skip if IP is whitelisted, or the request comes from the
    // plugin machine's own loopback (127.0.0.1 / ::1): localhost access needs
    // no token by default.
    const clientIp = getClientIp(req)
    const isWhitelisted = ipWhitelist.includes(clientIp)
    const isLoopback = clientIp === '127.0.0.1' || clientIp === '::1'

    if (token !== serverConfig.token && !isWhitelisted && !isLoopback) {
      res.writeHead(403, { 'Content-Type': 'text/html; charset=utf-8' })
      res.end('<!doctype html><html><head><meta charset="utf-8"><style>body{font-family:system-ui,sans-serif;display:flex;align-items:center;justify-content:center;height:100vh;margin:0;background:#0f172a;color:#f1f5f9}h1{font-size:1.5rem}</style></head><body><h1>访问被拒绝</h1></body></html>')
      return
    }

    const pathname = urlObj.pathname

    // --- Route: GET / ---
    if (pathname === '/' && req.method === 'GET') {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
      res.end(webUiHtml)
      return
    }

    // --- Route: GET /api/list ---
    if (pathname === '/api/list' && req.method === 'GET') {
      const scopePath = urlObj.searchParams.get('path') || ''
      const tree = buildApiTree(shareItems, scopePath || null)
      const local = isLocalHost(clientIp)
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' })
      res.end(JSON.stringify({
        files: tree,
        token: serverConfig.token,
        scoped: !!scopePath,
        scopePath: scopePath || '',
        clientIp: clientIp,
        isLocalHost: local,
        hostLocalUrl: local ? buildLocalUrl() : '',
        hostLanUrl: local ? buildLanUrl() : ''
      }))
      return
    }

    // --- Route: GET /api/file?path=xxx ---
    if (pathname === '/api/file' && req.method === 'GET') {
      const filePath = urlObj.searchParams.get('path') || ''
      const isDownload = urlObj.searchParams.get('dl') === '1'
      serveFile(req, res, filePath, isDownload, clientIp)
      return
    }

    // --- Route: GET /api/zip (stream a directory or a set of paths as ZIP) ---
    if (pathname === '/api/zip' && req.method === 'GET') {
      const paths = urlObj.searchParams.getAll('path')
      if (paths.length === 0) {
        res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' })
        res.end(JSON.stringify({ error: 'Missing path parameter' }))
        return
      }
      serveZip(res, paths, clientIp)
      return
    }

    // --- Route: POST /api/upload (multipart file upload) ---
    if (pathname === '/api/upload' && req.method === 'POST') {
      handleUpload(req, res, clientIp)
      return
    }

    // --- Route: DELETE /api/delete?path=xxx (uploader deletes own upload) ---
    if (pathname === '/api/delete' && req.method === 'DELETE') {
      handleDelete(req, res, urlObj, clientIp)
      return
    }

    // --- Route: POST /api/upload-resolve (overwrite/rename/skip pending upload) ---
    if (pathname === '/api/upload-resolve' && req.method === 'POST') {
      handleUploadResolve(req, res, clientIp)
      return
    }

    // ============================================================
    //  P2P private-messaging routes (all behind the global token gate)
    // ============================================================

    // --- GET /api/events (SSE realtime channel for web clients) ---
    if (pathname === '/api/events' && req.method === 'GET') {
      handleSse(req, res, clientIp)
      return
    }

    // --- POST /api/p2p/register (issue/refresh peerKey + peerId) ---
    if (pathname === '/api/p2p/register' && req.method === 'POST') {
      const rec = p2pPeerKeys[clientIp]
      if (rec) {
        sendJson(res, 200, { ok: true, peerKey: rec.key, peerId: rec.peerId })
      } else {
        const fresh = issuePeerKey(clientIp)
        sendJson(res, 200, { ok: true, peerKey: fresh.key, peerId: fresh.peerId })
      }
      return
    }

    // --- POST /api/p2p/request (client asks for a private connection) ---
    if (pathname === '/api/p2p/request' && req.method === 'POST') {
      readP2pJson(req, res, (body) => {
        if (!checkPeerKey(clientIp, req.headers['x-p2p-key'] || '')) {
          sendJson(res, 403, { ok: false, error: '未授权的客户端' })
          return
        }
        if (p2pSessions.some(s => s.peerIp === clientIp && s.status === 'pending')) {
          sendJson(res, 409, { ok: false, error: '已提交申请，等待主机同意' })
          return
        }
        if (p2pSessions.some(s => s.peerIp === clientIp && s.status === 'active')) {
          sendJson(res, 409, { ok: false, error: '已建立连接' })
          return
        }
        const last = p2pRequestCooldown[clientIp] || 0
        if (Date.now() - last < P2P_REQUEST_COOLDOWN) {
          sendJson(res, 429, { ok: false, error: '请求过于频繁，请稍后再试' })
          return
        }
        p2pRequestCooldown[clientIp] = Date.now()
        const rec = p2pPeerKeys[clientIp]
        const id = crypto.randomBytes(6).toString('base64url')
        const session = {
          id,
          peerIp: clientIp,
          peerName: String((body && body.name) || '访客').slice(0, 32),
          requestMessage: String((body && body.message) || '').slice(0, 200),
          peerKey: rec ? rec.key : '',
          peerId: rec ? rec.peerId : '',
          status: 'pending',
          createdAt: Date.now(),
          lastActiveAt: Date.now(),
          unreadByHost: 0,
          unreadByPeer: 0
        }
        p2pSessions.push(session)
        saveP2pSessions()
        // plugin-only event (the web client already knows it sent the request)
        pushEvent('p2p.request', {
          sessionId: id, peerIp: clientIp, peerName: session.peerName,
          requestMessage: session.requestMessage, createdAt: session.createdAt
        }, { sessionId: id, sse: false })
        try { window.ztools.showNotification(`收到点对点连接申请：${clientIp}（${session.peerName}）`) } catch (_e) { /* ignore */ }
        sendJson(res, 200, {
          ok: true,
          session: { id, peerIp: clientIp, peerName: session.peerName, status: 'pending' }
        })
      })
      return
    }

    // --- POST /api/p2p/message (client sends text) ---
    if (pathname === '/api/p2p/message' && req.method === 'POST') {
      readP2pJson(req, res, (body) => {
        const session = authorizeP2p(req, clientIp, body && body.session, req.headers['x-p2p-key'] || '')
        if (!session) { sendJson(res, 403, { ok: false, error: '无权访问该会话' }); return }
        if (session.status !== 'active') { sendJson(res, 409, { ok: false, error: '连接尚未建立或已断开' }); return }
        const text = String((body && body.text) || '').slice(0, P2P_MAX_TEXT)
        if (!text.trim()) { sendJson(res, 400, { ok: false, error: '消息为空' }); return }
        const msg = appendP2pMessage(session, {
          id: crypto.randomBytes(8).toString('hex'), from: 'peer', kind: 'text', text,
          createdAt: Date.now(), status: 'sent'
        })
        session.unreadByHost++
        session.lastActiveAt = Date.now()
        saveP2pSessions()
        pushEvent('p2p.message', sanitizeMsgForPeer(msg), { sessionId: session.id })
        sendJson(res, 200, { ok: true, msg: sanitizeMsgForPeer(msg) })
      })
      return
    }

    // --- GET /api/p2p/messages (client pulls incremental history) ---
    if (pathname === '/api/p2p/messages' && req.method === 'GET') {
      const sessionId = urlObj.searchParams.get('session') || ''
      const after = parseInt(urlObj.searchParams.get('after') || '0', 10) || 0
      const session = authorizeP2p(req, clientIp, sessionId, p2pKeyFrom(req, urlObj))
      if (!session) { sendJson(res, 403, { ok: false, error: '无权访问该会话' }); return }
      const messages = (p2pMessages[sessionId] || [])
        .filter(m => m.seq > after)
        .map(sanitizeMsgForPeer)
      sendJson(res, 200, { ok: true, sessionId, messages })
      return
    }

    // --- POST /api/p2p/file (client uploads files; all become ONE message) ---
    if (pathname === '/api/p2p/file' && req.method === 'POST') {
      const sessionId = urlObj.searchParams.get('session') || ''
      const session = authorizeP2p(req, clientIp, sessionId, p2pKeyFrom(req, urlObj))
      if (!session) { sendJson(res, 403, { ok: false, error: '无权访问该会话' }); return }
      if (session.status !== 'active') { sendJson(res, 409, { ok: false, error: '连接尚未建立或已断开' }); return }
      streamP2pUpload(req, res, session, (parts) => {
        if (!parts || parts.length === 0) {
          if (res.writableEnded) return
          sendJson(res, 200, { ok: true, files: [] })
          return
        }
        const files = parts.map(part => {
          let finalSize = part.size
          try { finalSize = fs.statSync(part.destPath).size } catch (_e) { /* ignore */ }
          return {
            fileId: part.fileId, name: part.name, size: finalSize,
            mime: getMimeType(part.destPath), direction: 'in', storedPath: part.destPath
          }
        })
        const msg = appendP2pMessage(session, {
          id: crypto.randomBytes(8).toString('hex'), from: 'peer', kind: 'files',
          files, createdAt: Date.now(), status: 'sent'
        })
        session.unreadByHost++
        session.lastActiveAt = Date.now()
        saveP2pSessions()
        pushEvent('p2p.file', sanitizeMsgForPeer(msg), { sessionId: session.id })
        sendJson(res, 200, { ok: true, files: sanitizeMsgForPeer(msg).files })
      })
      return
    }

    // --- GET /api/p2p/file (download / preview a session file) ---
    if (pathname === '/api/p2p/file' && req.method === 'GET') {
      const sessionId = urlObj.searchParams.get('session') || ''
      const fileId = urlObj.searchParams.get('file') || ''
      const session = authorizeP2p(req, clientIp, sessionId, p2pKeyFrom(req, urlObj))
      if (!session) { sendJson(res, 403, { ok: false, error: '无权访问该会话' }); return }
      serveP2pFile(req, res, session, fileId, urlObj.searchParams.get('dl') === '1')
      return
    }

    // --- DELETE /api/p2p/session (either side deletes the connection) ---
    if (pathname === '/api/p2p/session' && req.method === 'DELETE') {
      const sessionId = urlObj.searchParams.get('session') || ''
      const session = authorizeP2p(req, clientIp, sessionId, p2pKeyFrom(req, urlObj))
      if (!session) { sendJson(res, 403, { ok: false, error: '无权访问该会话' }); return }
      destroyP2pSession(session, 'peer')
      sendJson(res, 200, { ok: true })
      return
    }

    // --- DELETE /api/p2p/message (either side deletes one message; the peer
    // is notified via p2p.msgdeleted so both sides drop it) ---
    if (pathname === '/api/p2p/message' && req.method === 'DELETE') {
      const sessionId = urlObj.searchParams.get('session') || ''
      const msgId = urlObj.searchParams.get('msg') || ''
      const session = authorizeP2p(req, clientIp, sessionId, p2pKeyFrom(req, urlObj))
      if (!session) { sendJson(res, 403, { ok: false, error: '无权访问该会话' }); return }
      if (!msgId || !removeP2pMessage(session, msgId)) {
        sendJson(res, 404, { ok: false, error: '消息不存在' })
        return
      }
      pushEvent('p2p.msgdeleted', { sessionId: session.id, msgId }, { sessionId: session.id })
      sendJson(res, 200, { ok: true })
      return
    }

    // --- POST /api/p2p/read (peer marks a session read) ---
    if (pathname === '/api/p2p/read' && req.method === 'POST') {
      readP2pJson(req, res, (body) => {
        const session = authorizeP2p(req, clientIp, body && body.session, req.headers['x-p2p-key'] || '')
        if (!session) { sendJson(res, 403, { ok: false, error: '无权访问该会话' }); return }
        if (session.unreadByPeer !== 0) {
          session.unreadByPeer = 0
          saveP2pSessions()
        }
        sendJson(res, 200, { ok: true })
      })
      return
    }

    // --- GET /api/p2p/poll (fallback when SSE is unavailable) ---
    if (pathname === '/api/p2p/poll' && req.method === 'GET') {
      const since = parseInt(urlObj.searchParams.get('since') || '0', 10) || 0
      if (!checkPeerKey(clientIp, p2pKeyFrom(req, urlObj))) {
        sendJson(res, 403, { ok: false, error: '未授权' })
        return
      }
      const myIds = new Set(p2pSessions.filter(s => s.peerIp === clientIp).map(s => s.id))
      const events = p2pEventLog
        .filter(e => e.sessionId && myIds.has(e.sessionId) && e.seq > since)
        .map(e => ({ seq: e.seq, type: e.type, data: e.data }))
      const mySession = p2pSessions.find(s => s.peerIp === clientIp && s.status !== 'rejected') || null
      const snap = mySession ? { id: mySession.id, status: mySession.status, peerName: mySession.peerName } : null
      sendJson(res, 200, { ok: true, since: p2pEventSeq, events, session: snap })
      return
    }

    // ============================================================
    //  Local management console (/api/host/*) — only the plugin
    //  machine's own browser may call these (isLocalHost gate).
    // ============================================================

    // --- GET /api/host/p2p (session list for the local console) ---
    if (pathname === '/api/host/p2p' && req.method === 'GET') {
      if (!isHostRequest(res, clientIp)) return
      const sessions = p2pSessions
        .filter(s => s.status === 'pending' || s.status === 'active')
        .map(p2pSessionView)
      sendJson(res, 200, { ok: true, sessions })
      return
    }

    // --- GET /api/host/p2p/messages (raw-ish history for the host view) ---
    if (pathname === '/api/host/p2p/messages' && req.method === 'GET') {
      if (!isHostRequest(res, clientIp)) return
      const sessionId = urlObj.searchParams.get('session') || ''
      const after = parseInt(urlObj.searchParams.get('after') || '0', 10) || 0
      const session = findP2pSession(sessionId)
      if (!session) { sendJson(res, 404, { ok: false, error: '会话不存在' }); return }
      const messages = (p2pMessages[sessionId] || []).filter(m => m.seq > after)
      sendJson(res, 200, { ok: true, sessionId, messages })
      return
    }

    // --- POST /api/host/p2p/respond (accept / reject a request) ---
    if (pathname === '/api/host/p2p/respond' && req.method === 'POST') {
      if (!isHostRequest(res, clientIp)) return
      readP2pJson(req, res, (body) => {
        const s = findP2pSession(String((body && body.session) || ''))
        if (!s || s.status !== 'pending') { sendJson(res, 404, { ok: false, error: '会话不存在或已处理' }); return }
        const accept = !!body && !!body.accept
        s.status = accept ? 'active' : 'rejected'
        s.lastActiveAt = Date.now()
        saveP2pSessions()
        pushEvent(accept ? 'p2p.accepted' : 'p2p.rejected', {
          sessionId: s.id, peerIp: s.peerIp, peerName: s.peerName
        }, { sessionId: s.id })
        sendJson(res, 200, { ok: true })
      })
      return
    }

    // --- POST /api/host/p2p/read (mark a session read from the local console) ---
    if (pathname === '/api/host/p2p/read' && req.method === 'POST') {
      if (!isHostRequest(res, clientIp)) return
      readP2pJson(req, res, (body) => {
        const s = findP2pSession(String((body && body.session) || ''))
        if (!s) { sendJson(res, 404, { ok: false, error: '会话不存在' }); return }
        if (s.unreadByHost !== 0) {
          s.unreadByHost = 0
          saveP2pSessions()
        }
        sendJson(res, 200, { ok: true })
      })
      return
    }

    // --- POST /api/host/p2p/message (host sends text from the browser) ---
    if (pathname === '/api/host/p2p/message' && req.method === 'POST') {
      if (!isHostRequest(res, clientIp)) return
      readP2pJson(req, res, (body) => {
        const s = findP2pSession(String((body && body.session) || ''))
        if (!s || s.status !== 'active') { sendJson(res, 409, { ok: false, error: '连接尚未建立或已断开' }); return }
        const text = String((body && body.text) || '').slice(0, P2P_MAX_TEXT)
        if (!text.trim()) { sendJson(res, 400, { ok: false, error: '消息为空' }); return }
        const msg = appendP2pMessage(s, {
          id: crypto.randomBytes(8).toString('hex'), from: 'host', kind: 'text', text,
          createdAt: Date.now(), status: 'sent'
        })
        s.unreadByPeer++
        s.lastActiveAt = Date.now()
        saveP2pSessions()
        pushEvent('p2p.message', sanitizeMsgForPeer(msg), { sessionId: s.id })
        sendJson(res, 200, { ok: true, msg: sanitizeMsgForPeer(msg) })
      })
      return
    }

    // --- POST /api/host/p2p/file (host uploads files from the browser;
    // all become ONE 'from:host' files message, stored under the session) ---
    if (pathname === '/api/host/p2p/file' && req.method === 'POST') {
      if (!isHostRequest(res, clientIp)) return
      const sessionId = urlObj.searchParams.get('session') || ''
      const session = findP2pSession(sessionId)
      if (!session) { sendJson(res, 404, { ok: false, error: '会话不存在' }); return }
      if (session.status !== 'active') { sendJson(res, 409, { ok: false, error: '连接尚未建立或已断开' }); return }
      streamP2pUpload(req, res, session, (parts) => {
        if (!parts || parts.length === 0) {
          if (res.writableEnded) return
          sendJson(res, 200, { ok: true, files: [] })
          return
        }
        const files = parts.map(part => {
          let finalSize = part.size
          try { finalSize = fs.statSync(part.destPath).size } catch (_e) { /* ignore */ }
          return {
            fileId: part.fileId, name: part.name, size: finalSize,
            mime: getMimeType(part.destPath), direction: 'in', storedPath: part.destPath
          }
        })
        const msg = appendP2pMessage(session, {
          id: crypto.randomBytes(8).toString('hex'), from: 'host', kind: 'files',
          files, createdAt: Date.now(), status: 'sent'
        })
        session.unreadByPeer++
        session.lastActiveAt = Date.now()
        saveP2pSessions()
        pushEvent('p2p.file', sanitizeMsgForPeer(msg), { sessionId: session.id })
        sendJson(res, 200, { ok: true, files: sanitizeMsgForPeer(msg).files })
      })
      return
    }

    // --- GET /api/host/p2p/file (host previews / downloads a session file) ---
    if (pathname === '/api/host/p2p/file' && req.method === 'GET') {
      if (!isHostRequest(res, clientIp)) return
      const sessionId = urlObj.searchParams.get('session') || ''
      const fileId = urlObj.searchParams.get('file') || ''
      const session = findP2pSession(sessionId)
      if (!session) { sendJson(res, 404, { ok: false, error: '会话不存在' }); return }
      serveP2pFile(req, res, session, fileId, urlObj.searchParams.get('dl') === '1')
      return
    }

    // --- DELETE /api/host/p2p/message (host deletes a message) ---
    if (pathname === '/api/host/p2p/message' && req.method === 'DELETE') {
      if (!isHostRequest(res, clientIp)) return
      const sessionId = urlObj.searchParams.get('session') || ''
      const msgId = urlObj.searchParams.get('msg') || ''
      const session = findP2pSession(sessionId)
      if (!session) { sendJson(res, 404, { ok: false, error: '会话不存在' }); return }
      if (!msgId || !removeP2pMessage(session, msgId)) {
        sendJson(res, 404, { ok: false, error: '消息不存在' })
        return
      }
      pushEvent('p2p.msgdeleted', { sessionId: session.id, msgId }, { sessionId: session.id })
      sendJson(res, 200, { ok: true })
      return
    }

    // --- DELETE /api/host/p2p/session (host deletes the connection) ---
    if (pathname === '/api/host/p2p/session' && req.method === 'DELETE') {
      if (!isHostRequest(res, clientIp)) return
      const sessionId = urlObj.searchParams.get('session') || ''
      const session = findP2pSession(sessionId)
      if (!session) { sendJson(res, 404, { ok: false, error: '会话不存在' }); return }
      destroyP2pSession(session, 'host')
      sendJson(res, 200, { ok: true })
      return
    }

    // --- GET /api/host/logs (download log list) ---
    if (pathname === '/api/host/logs' && req.method === 'GET') {
      if (!isHostRequest(res, clientIp)) return
      sendJson(res, 200, { ok: true, logs: downloadLogs.slice().reverse() })
      return
    }

    // --- DELETE /api/host/logs (clear logs) ---
    if (pathname === '/api/host/logs' && req.method === 'DELETE') {
      if (!isHostRequest(res, clientIp)) return
      downloadLogs = []
      saveLogs()
      sendJson(res, 200, { ok: true })
      return
    }

    // --- GET /api/host/whitelist ---
    if (pathname === '/api/host/whitelist' && req.method === 'GET') {
      if (!isHostRequest(res, clientIp)) return
      sendJson(res, 200, { ok: true, whitelist: ipWhitelist.slice() })
      return
    }

    // --- POST /api/host/whitelist (add an IP) ---
    if (pathname === '/api/host/whitelist' && req.method === 'POST') {
      if (!isHostRequest(res, clientIp)) return
      readP2pJson(req, res, (body) => {
        const ok = addWhitelistEntry(String((body && body.ip) || ''))
        sendJson(res, ok ? 200 : 400, { ok, error: ok ? undefined : '无效的 IP 地址' })
      })
      return
    }

    // --- DELETE /api/host/whitelist?ip= (remove an IP) ---
    if (pathname === '/api/host/whitelist' && req.method === 'DELETE') {
      if (!isHostRequest(res, clientIp)) return
      const ip = urlObj.searchParams.get('ip') || ''
      const ok = removeWhitelistEntry(ip)
      sendJson(res, ok ? 200 : 404, { ok })
      return
    }

    // 404
    res.writeHead(404, { 'Content-Type': 'text/plain' })
    res.end('Not Found')
  })
}

function serveFile(req, res, filePath, isDownload, clientIp) {
  if (!filePath) {
    res.writeHead(400)
    res.end('Missing path parameter')
    return
  }

  const normalized = path.normalize(filePath)

  // Security: only serve files inside enabled share items
  if (!isPathShared(shareItems, normalized)) {
    res.writeHead(403)
    res.end('Forbidden')
    return
  }

  if (!fs.existsSync(normalized)) {
    res.writeHead(404)
    res.end('File not found')
    return
  }

  const stat = fs.statSync(normalized)
  if (stat.isDirectory()) {
    res.writeHead(400)
    res.end('Cannot serve directory')
    return
  }

  // --- Transfer logging (only for explicit downloads, not previews) ---
  if (isDownload) {
    logTransfer('download', clientIp || 'unknown', normalized)
  }

  const mimeType = getMimeType(normalized)
  const fileSize = stat.size
  const fileName = path.basename(normalized)
  const encodedName = encodeURIComponent(fileName)

  // Handle Range requests (for audio/video seeking)
  const range = req.headers.range
  if (range) {
    const parts = range.replace(/bytes=/, '').split('-')
    const start = parseInt(parts[0], 10)
    const end = parts[1] ? parseInt(parts[1], 10) : fileSize - 1
    const chunkSize = end - start + 1

    res.writeHead(206, {
      'Content-Type': mimeType,
      'Content-Disposition': `inline; filename*=UTF-8''${encodedName}`,
      'Content-Range': `bytes ${start}-${end}/${fileSize}`,
      'Accept-Ranges': 'bytes',
      'Content-Length': chunkSize,
      'Cache-Control': 'public, max-age=3600'
    })

    const stream = fs.createReadStream(normalized, { start, end })
    stream.pipe(res)
    stream.on('error', () => { res.end() })
    return
  }

  res.writeHead(200, {
    'Content-Type': mimeType,
    'Content-Disposition': `inline; filename*=UTF-8''${encodedName}`,
    'Content-Length': fileSize,
    'Accept-Ranges': 'bytes',
    'Cache-Control': 'public, max-age=3600'
  })

  const stream = fs.createReadStream(normalized)
  stream.pipe(res)
  stream.on('error', () => { res.end() })
}

// ============================================================
//  Transfer logging (downloads & uploads share one log store)
// ============================================================
function logTransfer(type, ip, filePath, size) {
  const dedupKey = type + '|' + ip + '|' + filePath
  const now = Date.now()
  // Dedup: skip if same type+IP+path logged within 3 seconds
  if (!lastLogMap[dedupKey] || now - lastLogMap[dedupKey] > 3000) {
    lastLogMap[dedupKey] = now
    downloadLogs.push({
      type: type,
      ip: ip,
      filePath: filePath,
      fileName: path.basename(filePath),
      size: size || 0,
      timestamp: new Date().toISOString()
    })
    saveLogs()
  }
}

// ============================================================
//  File upload (multipart/form-data, buffered with size cap)
// ============================================================
const MAX_UPLOAD_SIZE = 2 * 1024 * 1024 * 1024 // 2GB total request cap
const PENDING_UPLOAD_TTL = 10 * 60 * 1000       // unresolved uploads expire after 10 min

// Find every shared item carrying the given file name (recursive)
function findItemsByName(items, name, out) {
  out = out || []
  for (const item of items) {
    if (item.name === name) out.push(item)
    if (item.children && item.children.length > 0) findItemsByName(item.children, name, out)
  }
  return out
}

// Pick a display name that no shared item uses yet ("a.txt" → "a (1).txt")
function uniqueShareName(items, name) {
  if (findItemsByName(items, name).length === 0) return name
  const ext = path.extname(name)
  const stem = name.slice(0, name.length - ext.length)
  let n = 1
  while (findItemsByName(items, `${stem} (${n})${ext}`).length > 0) n++
  return `${stem} (${n})${ext}`
}

// SHA-256 of a shared file, cached on the item.
// Uploads store the hash the moment they are saved ("入表") and are immutable
// copies — the stored value is read directly and never recomputed. Host shares
// are hashed lazily on the first comparison and cached with a size + mtime
// guard, so an externally edited file is re-hashed instead of serving a stale
// hash.
async function getItemHash(item) {
  if (item.isDirectory) return ''
  if (item.origin && item.origin.type === 'upload') {
    // Read the stored hash; compute once only for legacy uploads saved
    // before hashing existed, then persist it.
    if (item.hash) return item.hash
    return computeFileHash(item, null, null)
  }

  let stat = null
  try { stat = fs.statSync(item.path) } catch (_e) { return '' }
  const size = stat.size
  const mtime = Math.floor(stat.mtimeMs)
  if (item.hash && item.hashSize === size && item.hashMtime === mtime) return item.hash
  return computeFileHash(item, size, mtime)
}

async function computeFileHash(item, size, mtime) {
  try {
    if (size === null) {
      let stat = null
      try { stat = fs.statSync(item.path) } catch (_e) { return '' }
      size = stat.size
      mtime = Math.floor(stat.mtimeMs)
    }
    const hash = await new Promise((resolve, reject) => {
      const h = crypto.createHash('sha256')
      const rs = fs.createReadStream(item.path)
      rs.on('data', (d) => h.update(d))
      rs.on('end', () => resolve(h.digest('hex')))
      rs.on('error', reject)
    })
    item.hash = hash
    item.hashSize = size
    item.hashMtime = mtime
    saveShares()
    return hash
  } catch (_e) {
    return ''
  }
}

function parseMultipart(buffer, boundary) {
  const parts = []
  const delim = Buffer.from('--' + boundary)
  let pos = buffer.indexOf(delim)
  while (pos !== -1) {
    let end = buffer.indexOf(delim, pos + delim.length)
    if (end === -1) break
    const section = buffer.slice(pos + delim.length, end)
    // Skip the trailing \r\n after the delimiter
    let start = 0
    if (section[0] === 0x0d && section[1] === 0x0a) start = 2
    const headerEnd = section.indexOf('\r\n\r\n', start)
    if (headerEnd === -1) { pos = end; continue }
    const headerText = section.slice(start, headerEnd).toString('utf-8')
    let data = section.slice(headerEnd + 4)
    // Strip trailing \r\n before the next boundary
    if (data.length >= 2 && data[data.length - 2] === 0x0d && data[data.length - 1] === 0x0a) {
      data = data.slice(0, data.length - 2)
    }
    if (data.length === 0) { pos = end; continue }

    // Parse Content-Disposition
    const cdMatch = headerText.match(/Content-Disposition:[^\r\n]*/i)
    if (!cdMatch) { pos = end; continue }
    const cd = cdMatch[0]
    const nameMatch = cd.match(/name="([^"]*)"/)
    if (!nameMatch || nameMatch[1] !== 'file') { pos = end; continue }

    // Filename: prefer filename*=UTF-8''..., fall back to filename="..."
    let filename = ''
    const fnStar = cd.match(/filename\*=UTF-8''([^;]+)/i)
    if (fnStar) {
      try { filename = decodeURIComponent(fnStar[1].trim().replace(/^"|"$/g, '')) } catch (_e) { filename = '' }
    }
    if (!filename) {
      const fn = cd.match(/filename="([^"]*)"/)
      if (fn) filename = fn[1]
    }
    if (!filename) { pos = end; continue }

    parts.push({ filename: filename, data: data })
    pos = end
  }
  return parts
}

function sanitizeFileName(name) {
  let base = path.basename(String(name || '')).replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_').trim()
  if (!base || base === '.' || base === '..') base = 'file'
  if (base.length > 200) {
    const ext = path.extname(base)
    base = base.slice(0, 200 - ext.length) + ext
  }
  return base
}

function uniqueUploadPath(fileName) {
  if (!uploadsDir) return ''
  let candidate = path.join(uploadsDir, fileName)
  const ext = path.extname(fileName)
  const stem = fileName.slice(0, fileName.length - ext.length)
  let n = 1
  while (fs.existsSync(candidate)) {
    candidate = path.join(uploadsDir, `${stem} (${n})${ext}`)
    n++
  }
  return candidate
}

function handleUpload(req, res, clientIp) {
  if (!uploadsDir) {
    res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' })
    res.end(JSON.stringify({ ok: false, error: '上传目录不可用' }))
    return
  }

  const contentType = req.headers['content-type'] || ''
  const boundaryMatch = contentType.match(/boundary=(?:"([^"]+)"|([^;]+))/i)
  if (!boundaryMatch) {
    res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' })
    res.end(JSON.stringify({ ok: false, error: '无效的请求格式' }))
    return
  }
  const boundary = boundaryMatch[1] || boundaryMatch[2]

  const chunks = []
  let size = 0
  let settled = false

  req.on('data', (chunk) => {
    if (settled) return
    size += chunk.length
    if (size > MAX_UPLOAD_SIZE) {
      settled = true
      res.writeHead(413, { 'Content-Type': 'application/json; charset=utf-8' })
      res.end(JSON.stringify({ ok: false, error: '文件过大，超过上传大小限制' }))
      req.destroy()
      return
    }
    chunks.push(chunk)
  })

  req.on('error', () => {
    if (!settled) { settled = true; res.end() }
  })

  req.on('end', async () => {
    if (settled) return
    settled = true

    const parts = parseMultipart(Buffer.concat(chunks), boundary)
    const saved = []
    const failed = []
    const duplicates = []   // identical content already shared → skipped
    const pending = []      // same name, different content → awaiting decision

    for (const part of parts) {
      try {
        const safeName = sanitizeFileName(part.filename)
        const partHash = crypto.createHash('sha256').update(part.data).digest('hex')

        // Compare against every shared item carrying the same name
        const candidates = findItemsByName(shareItems, safeName)
        let hashMatch = false
        for (const c of candidates) {
          const h = await getItemHash(c)
          if (h && h === partHash) { hashMatch = true; break }
        }
        if (hashMatch) {
          // Identical content is already shared — skip, write nothing
          duplicates.push({ name: safeName })
          continue
        }
        if (candidates.length > 0) {
          // Same name but different content — hold the buffered upload and
          // let the client pick overwrite/rename/skip. Overwrite is only
          // offered when a previous upload from this same IP exists.
          const canOverwrite = candidates.some(c =>
            c.origin && c.origin.type === 'upload' && c.origin.ip === clientIp)
          const id = crypto.randomBytes(8).toString('hex')
          const expires = setTimeout(() => { pendingUploads.delete(id) }, PENDING_UPLOAD_TTL)
          pendingUploads.set(id, { id, name: safeName, data: part.data, hash: partHash, ip: clientIp || 'unknown', expires })
          pending.push({ id, name: safeName, canOverwrite })
          continue
        }

        // No conflicts — save immediately
        const destPath = uniqueUploadPath(safeName)
        if (!destPath) { failed.push({ name: safeName, error: '上传目录不可用' }); continue }
        fs.writeFileSync(destPath, part.data)
        const item = {
          id: String(++shareIdCounter),
          path: destPath,
          name: safeName,
          isDirectory: false,
          enabled: true,
          hash: partHash,
          hashSize: part.data.length,
          hashMtime: Math.floor(fs.statSync(destPath).mtimeMs),
          origin: { type: 'upload', ip: clientIp || 'unknown', time: new Date().toISOString(), local: isLocalHost(clientIp) }
        }
        shareItems.push(item)
        saved.push({ name: safeName, size: part.data.length })
        logTransfer('upload', clientIp || 'unknown', destPath, part.data.length)
      } catch (_e) {
        failed.push({ name: part.filename, error: '保存失败' })
      }
    }

    if (saved.length > 0) saveShares()

    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' })
    res.end(JSON.stringify({ ok: true, files: saved, failed: failed, duplicates: duplicates, pending: pending }))
  })
}

// ============================================================
//  Upload deletion (restricted by uploader IP)
// ============================================================
function sendJson(res, status, payload) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' })
  res.end(JSON.stringify(payload))
}

// Delete an upload's on-disk copy. Uploads are copies living under the uploads
// directory, so removing them is always safe — host shares reference original
// paths and are never touched here. Best-effort with background retries:
// antivirus/indexers can briefly lock a freshly-written file on Windows.
// Retries re-check the file's mtime first, so a path that has since been
// reused (e.g. an overwrite) is never deleted by a stale retry.
function deleteUploadFileFromDisk(item) {
  if (!uploadsDir || item.isDirectory) return
  let guardedMtime = null
  try {
    const normalizedFile = normalizePathForCompare(item.path)
    const normalizedUploads = normalizePathForCompare(uploadsDir)
    if (!normalizedFile.startsWith(normalizedUploads + '/')) return
    guardedMtime = fs.statSync(item.path).mtimeMs
  } catch (_e) { return }
  const tryUnlink = (attemptsLeft) => {
    try {
      if (guardedMtime !== null) {
        const st = fs.statSync(item.path)
        if (st.mtimeMs !== guardedMtime) return // path now holds a different file
      }
      fs.unlinkSync(item.path)
    } catch (_e) {
      if (attemptsLeft > 0) setTimeout(() => tryUnlink(attemptsLeft - 1), 300)
    }
  }
  tryUnlink(2)
}

function handleDelete(req, res, urlObj, clientIp) {
  const filePath = urlObj.searchParams.get('path') || ''
  if (!filePath) {
    sendJson(res, 400, { ok: false, error: '缺少 path 参数' })
    return
  }

  const item = findItemByPath(shareItems, filePath.replace(/\\/g, '/'))
  if (!item) {
    sendJson(res, 404, { ok: false, error: '文件不存在或已被删除' })
    return
  }

  // Only client uploads may be deleted via the Web UI — host shares stay
  // managed from the plugin window, and their source files are never touched.
  if (!item.origin || item.origin.type !== 'upload') {
    sendJson(res, 403, { ok: false, error: '仅支持删除客户端上传的文件' })
    return
  }

  // Restrict by uploader IP: every visitor holds the access token, so the IP
  // of the machine that made the upload is the only reliable ownership proof.
  // The host can still remove any entry from the plugin window.
  if ((item.origin.ip || '') !== (clientIp || '')) {
    sendJson(res, 403, { ok: false, error: '仅上传者本人（相同 IP）可删除该文件' })
    return
  }

  // Remove from the share list, then free the disk copy (uploads only).
  removeItemById(shareItems, item.id)
  saveShares()
  deleteUploadFileFromDisk(item)

  sendJson(res, 200, { ok: true, removed: item.name })
}

// ============================================================
//  Pending upload resolution (overwrite / rename / skip)
// ============================================================
const MAX_RESOLVE_SIZE = 1024 * 1024 // 1MB is plenty for the small JSON body

function handleUploadResolve(req, res, clientIp) {
  const chunks = []
  let size = 0
  let settled = false

  req.on('data', (chunk) => {
    if (settled) return
    size += chunk.length
    if (size > MAX_RESOLVE_SIZE) {
      settled = true
      sendJson(res, 413, { ok: false, error: '请求过大' })
      req.destroy()
      return
    }
    chunks.push(chunk)
  })

  req.on('error', () => {
    if (!settled) { settled = true; res.end() }
  })

  req.on('end', () => {
    if (settled) return
    settled = true

    let body = {}
    try { body = JSON.parse(Buffer.concat(chunks).toString('utf-8')) } catch (_e) { /* invalid json */ }

    const rec = pendingUploads.get(body.id)
    if (!rec) {
      sendJson(res, 404, { ok: false, error: '上传会话不存在或已过期' })
      return
    }

    // Only the uploader's own IP may resolve their pending upload.
    // Checked before consuming the record so a rejected attempt doesn't
    // invalidate the real uploader's session.
    if (rec.ip !== (clientIp || '')) {
      sendJson(res, 403, { ok: false, error: '仅上传者本人可处理该文件' })
      return
    }
    pendingUploads.delete(body.id)
    clearTimeout(rec.expires)

    if (body.action === 'skip') {
      sendJson(res, 200, { ok: true, skipped: rec.name })
      return
    }
    if (body.action !== 'overwrite' && body.action !== 'rename') {
      sendJson(res, 400, { ok: false, error: '未知操作' })
      return
    }

    // Overwrite removes the uploader's previous same-name upload first.
    // Host shares and other IPs' uploads can never be overwritten.
    let finalName = rec.name
    let destPath
    if (body.action === 'overwrite') {
      const candidates = findItemsByName(shareItems, rec.name)
      const target = candidates.find(c =>
        c.origin && c.origin.type === 'upload' && c.origin.ip === rec.ip)
      if (!target) {
        sendJson(res, 403, { ok: false, error: '不可覆盖主机共享或他人上传的文件' })
        return
      }
      removeItemById(shareItems, target.id)
      deleteUploadFileFromDisk(target)
      destPath = path.join(uploadsDir, rec.name)
    } else {
      // Rename: pick a display name unused in the share list, then a disk
      // path that is free as well, so name and file always match.
      finalName = uniqueShareName(shareItems, rec.name)
      destPath = uniqueUploadPath(finalName)
    }
    try {
      fs.writeFileSync(destPath, rec.data)
      const item = {
        id: String(++shareIdCounter),
        path: destPath,
        name: finalName,
        isDirectory: false,
        enabled: true,
        hash: rec.hash,
        hashSize: rec.data.length,
        hashMtime: Math.floor(fs.statSync(destPath).mtimeMs),
        origin: { type: 'upload', ip: rec.ip, time: new Date().toISOString(), local: isLocalHost(rec.ip) }
      }
      shareItems.push(item)
      saveShares()
      logTransfer('upload', rec.ip, destPath, rec.data.length)
      sendJson(res, 200, { ok: true, saved: { name: finalName, path: destPath } })
    } catch (_e) {
      sendJson(res, 500, { ok: false, error: '保存失败，请重试' })
    }
  })
}

// ============================================================
//  ZIP streaming (deflate + data descriptor, no temp files)
// ============================================================
const CRC_TABLE = (() => {
  const table = new Uint32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) {
      c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1)
    }
    table[n] = c >>> 0
  }
  return table
})()

function updateCrc(crc, buffer) {
  let c = crc ^ 0xffffffff
  for (let i = 0; i < buffer.length; i++) {
    c = CRC_TABLE[(c ^ buffer[i]) & 0xff] ^ (c >>> 8)
  }
  return (c ^ 0xffffffff) >>> 0
}

// Extensions that are already compressed — store instead of deflating
const STORED_EXTS = new Set(['.zip', '.7z', '.rar', '.gz', '.bz2', '.xz', '.jpg', '.jpeg', '.png', '.gif', '.webp', '.mp3', '.mp4', '.mkv', '.avi', '.mov', '.flac', '.aac', '.m4a', '.pdf'])

function dosDateTime(ms) {
  const d = new Date(ms)
  const time = (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1)
  const date = (((d.getFullYear() - 1980) & 0x7f) << 9) | ((d.getMonth() + 1) << 5) | d.getDate()
  return { time, date }
}

function collectZipEntries(items, scopeList, out) {
  for (const fsPath of scopeList) {
    const found = findItemByPath(items, fsPath.replace(/\\/g, '/'))
    if (!found || !found.enabled) continue
    const stat = fs.statSync(found.path)
    if (found.isDirectory) {
      collectDirEntries(found, out, '', stat.mtimeMs)
    } else {
      out.push({ fsPath: found.path, zipPath: found.name, isDir: false, mtimeMs: stat.mtimeMs, size: stat.size })
    }
  }
  return out
}

function collectDirEntries(item, out, prefix, mtimeMs) {
  const zipPath = prefix ? prefix + '/' + item.name : item.name
  out.push({ fsPath: null, zipPath: zipPath + '/', isDir: true, mtimeMs: mtimeMs, size: 0 })
  if (!item.children) return
  for (const child of item.children) {
    if (!child.enabled) continue
    if (child.isDirectory) {
      collectDirEntries(child, out, zipPath, mtimeMs)
    } else {
      let fileStat = null
      try { fileStat = fs.statSync(child.path) } catch (_e) { /* skip missing */ }
      out.push({ fsPath: child.path, zipPath: zipPath + '/' + child.name, isDir: false, mtimeMs: fileStat ? fileStat.mtimeMs : mtimeMs, size: fileStat ? fileStat.size : 0 })
    }
  }
}

function writeChunk(res, chunk, state) {
  return new Promise((resolve) => {
    if (state.aborted || res.destroyed) { state.aborted = true; resolve(); return }
    const onDrain = () => { cleanup(); resolve() }
    const onClose = () => { state.aborted = true; cleanup(); resolve() }
    const cleanup = () => { res.off('drain', onDrain); res.off('close', onClose) }
    if (!res.write(chunk)) {
      res.once('drain', onDrain)
      res.once('close', onClose)
    } else {
      resolve()
    }
  })
}

// Pump the given streams into the HTTP response with backpressure support.
// `res` (ServerResponse) cannot be a pipeline destination directly, so a
// custom sink Writable forwards chunks to it.
function pumpToResponse(res, state, streams) {
  return new Promise((resolve) => {
    const sink = new Writable({
      write(chunk, _enc, cb) {
        if (state.aborted || res.destroyed) { state.aborted = true; cb(); return }
        if (res.write(chunk)) cb()
        else res.once('drain', cb)
      }
    })
    const cleanup = () => { for (const s of streams) s.destroy() }
    const onClose = () => { state.aborted = true; cleanup() }
    res.once('close', onClose)
    pipeline(...streams, sink, (err) => {
      res.off('close', onClose)
      resolve(err ? (state.aborted ? 'aborted' : 'error') : 'ok')
    })
  })
}

async function serveZip(res, scopeList, clientIp) {
  // Validate scope paths and build the entry list
  const entries = []
  collectZipEntries(shareItems, scopeList, entries)
  if (entries.length === 0) {
    res.writeHead(404, { 'Content-Type': 'application/json; charset=utf-8' })
    res.end(JSON.stringify({ error: 'No shared files matched' }))
    return
  }

  // Estimate total size, bail out above ~3.5GB (zip32 limits)
  let estimated = 0
  for (const e of entries) estimated += e.size || 0
  if (estimated > 3.5 * 1024 * 1024 * 1024) {
    res.writeHead(413, { 'Content-Type': 'application/json; charset=utf-8' })
    res.end(JSON.stringify({ error: '目录过大，请分批下载或选择部分文件' }))
    return
  }

  // Zip file name
  let zipName = 'share_' + new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19) + '.zip'
  const firstEntry = entries[0]
  if (scopeList.length === 1 && firstEntry && firstEntry.isDir) {
    zipName = firstEntry.zipPath.replace(/\/$/, '') + '.zip'
  }
  const encodedZipName = encodeURIComponent(zipName)
  res.writeHead(200, {
    'Content-Type': 'application/zip',
    'Content-Disposition': `attachment; filename*=UTF-8''${encodedZipName}`,
    'Cache-Control': 'no-cache'
  })

  logTransfer('download', clientIp || 'unknown', zipName, estimated)

  const state = { aborted: false, offset: 0 }
  res.on('close', () => { state.aborted = true })

  const central = []
  const usedNames = new Set()

  for (const entry of entries) {
    if (state.aborted) return

    // Make zip names unique within this archive
    let zipPath = entry.zipPath
    if (usedNames.has(zipPath)) {
      const ext = path.posix.extname(zipPath)
      const stem = zipPath.slice(0, zipPath.length - ext.length)
      let n = 1
      while (usedNames.has(`${stem} (${n})${ext}`)) n++
      zipPath = `${stem} (${n})${ext}`
    }
    usedNames.add(zipPath)

    const nameBuf = Buffer.from(zipPath, 'utf-8')
    const { time, date } = dosDateTime(entry.mtimeMs || Date.now())
    const method = entry.isDir ? 0 : (STORED_EXTS.has(path.extname(entry.fsPath).toLowerCase()) ? 0 : 8)
    const flags = 0x0800 | (entry.isDir ? 0 : 0x0008)
    const localOffset = state.offset

    // Local file header
    const header = Buffer.alloc(30)
    header.writeUInt32LE(0x04034b50, 0)
    header.writeUInt16LE(20, 4)        // version needed
    header.writeUInt16LE(flags, 6)     // general purpose flags
    header.writeUInt16LE(method, 8)    // compression method
    header.writeUInt16LE(time, 10)
    header.writeUInt16LE(date, 12)
    header.writeUInt32LE(0, 14)        // crc32 (placeholder)
    header.writeUInt32LE(0, 18)        // compressed size (placeholder)
    header.writeUInt32LE(0, 22)        // uncompressed size (placeholder)
    header.writeUInt16LE(nameBuf.length, 26)
    header.writeUInt16LE(0, 28)        // extra length
    await writeChunk(res, header, state)
    await writeChunk(res, nameBuf, state)
    state.offset += 30 + nameBuf.length
    if (state.aborted) return

    let crc = 0
    let rawSize = 0
    let compSize = 0

    if (!entry.isDir && entry.fsPath) {
      // Stream the file into the response with backpressure handling:
      //   src -> [deflater] -> [counter] -> sink -> res
      const src = fs.createReadStream(entry.fsPath, { highWaterMark: 256 * 1024 })
      src.on('data', (chunk) => {
        crc = updateCrc(crc, chunk)
        rawSize += chunk.length
      })

      let pumpResult
      if (method === 8) {
        const deflater = zlib.createDeflateRaw({ level: 6 })
        const counter = new Transform({
          transform(chunk, _enc, cb) {
            compSize += chunk.length
            cb(null, chunk)
          }
        })
        pumpResult = await pumpToResponse(res, state, [src, deflater, counter])
      } else {
        pumpResult = await pumpToResponse(res, state, [src])
      }

      if (state.aborted || pumpResult !== 'ok') return
      if (method === 0) compSize = rawSize
      state.offset += compSize

      // Data descriptor
      const descriptor = Buffer.alloc(16)
      descriptor.writeUInt32LE(0x08074b50, 0)
      descriptor.writeUInt32LE(crc, 4)
      descriptor.writeUInt32LE(compSize, 8)
      descriptor.writeUInt32LE(rawSize, 12)
      await writeChunk(res, descriptor, state)
      state.offset += 16
      if (state.aborted) return
    }

    central.push({ nameBuf, crc, compSize, rawSize, offset: localOffset, method, time, date, flags, isDir: entry.isDir })
  }

  if (state.aborted) return

  // Central directory
  const centralOffset = state.offset
  for (const rec of central) {
    const header = Buffer.alloc(46)
    header.writeUInt32LE(0x02014b50, 0)
    header.writeUInt16LE(20, 4)         // version made by
    header.writeUInt16LE(20, 6)         // version needed
    header.writeUInt16LE(rec.flags, 8)
    header.writeUInt16LE(rec.method, 10)
    header.writeUInt16LE(rec.time, 12)
    header.writeUInt16LE(rec.date, 14)
    header.writeUInt32LE(rec.crc, 16)
    header.writeUInt32LE(rec.compSize, 20)
    header.writeUInt32LE(rec.rawSize, 24)
    header.writeUInt16LE(rec.nameBuf.length, 28)
    header.writeUInt16LE(0, 30)         // extra length
    header.writeUInt16LE(0, 32)         // comment length
    header.writeUInt16LE(0, 34)         // disk number
    header.writeUInt16LE(0, 36)         // internal attrs
    header.writeUInt32LE(rec.isDir ? 0x10 : 0, 38) // external attrs
    header.writeUInt32LE(rec.offset, 42)
    await writeChunk(res, header, state)
    await writeChunk(res, rec.nameBuf, state)
    state.offset += 46 + rec.nameBuf.length
    if (state.aborted) return
  }

  const centralSize = state.offset - centralOffset
  const endRecord = Buffer.alloc(22)
  endRecord.writeUInt32LE(0x06054b50, 0)
  endRecord.writeUInt16LE(0, 4)         // disk number
  endRecord.writeUInt16LE(0, 6)         // central dir start disk
  endRecord.writeUInt16LE(central.length, 8)
  endRecord.writeUInt16LE(central.length, 10)
  endRecord.writeUInt32LE(centralSize, 12)
  endRecord.writeUInt32LE(centralOffset, 16)
  endRecord.writeUInt16LE(0, 20)        // comment length
  await writeChunk(res, endRecord, state)

  res.end()
}

// ============================================================
//  P2P private-messaging core
// ============================================================
const P2P_MAX_TEXT = 64 * 1024        // per text message
const P2P_MAX_FILE = 4 * 1024 * 1024 * 1024 // 4GB per p2p file (streamed)
const P2P_MAX_BODY = 1024 * 1024      // JSON request body cap
const P2P_MSG_KEEP = 200              // messages retained per session
const P2P_REQUEST_COOLDOWN = 60 * 1000
const P2P_MAX_EVENTS = 200

function findP2pSession(id) { return p2pSessions.find(s => s.id === id) }

// Push an event into the ring buffer, optionally to the peer's SSE channel,
// and notify the plugin renderer (CustomEvent) so the UI updates instantly.
function pushEvent(type, data, opts) {
  const o = opts || {}
  const ev = { seq: ++p2pEventSeq, type, data, ts: Date.now(), sessionId: o.sessionId || null }
  p2pEventLog.push(ev)
  if (p2pEventLog.length > P2P_MAX_EVENTS) p2pEventLog = p2pEventLog.slice(-P2P_MAX_EVENTS)
  if (o.sessionId && o.sse !== false) {
    const sess = findP2pSession(o.sessionId)
    if (sess && sseClients[sess.peerIp]) sseSend(sess.peerIp, ev)
  }
  notifyRenderer(ev)
  return ev
}

function notifyRenderer(ev) {
  try {
    if (typeof window.dispatchEvent === 'function') {
      window.dispatchEvent(new CustomEvent('zshare:p2p', { detail: ev }))
    }
  } catch (_e) { /* no renderer (headless / smoke) */ }
}

function sseSend(ip, ev) {
  const c = sseClients[ip]
  if (!c || c.res.destroyed) return
  try {
    c.res.write(`event: ${ev.type}\n`)
    c.res.write(`id: ${ev.seq}\n`)
    c.res.write(`data: ${JSON.stringify(ev.data)}\n\n`)
  } catch (_e) { /* ignore */ }
}

// One live SSE connection per client IP. On connect we send a snapshot of the
// client's session state so the web UI can recover after a drop/reconnect;
// message history is re-fetched by the client via /api/p2p/messages?after=.
function handleSse(req, res, clientIp) {
  const prev = sseClients[clientIp]
  if (prev) { try { prev.res.end() } catch (_e) { /* ignore */ } }
  sseClients[clientIp] = { res }
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive'
  })
  res.write(': connected\n\n')
  const sess = p2pSessions.find(s => s.peerIp === clientIp && s.status !== 'rejected')
  const snap = sess ? { id: sess.id, status: sess.status, peerIp: sess.peerIp, peerName: sess.peerName } : null
  res.write('event: p2p.snapshot\n')
  res.write('data: ' + JSON.stringify(snap) + '\n\n')
  const heartbeat = setInterval(() => { try { res.write(': ping\n\n') } catch (_e) { /* ignore */ } }, 25000)
  res.on('close', () => {
    clearInterval(heartbeat)
    if (sseClients[clientIp] && sseClients[clientIp].res === res) delete sseClients[clientIp]
    pushEvent('p2p.presence', { peerIp: clientIp, online: false })
  })
  pushEvent('p2p.presence', { peerIp: clientIp, online: true })
}

// ---- peerKey: a per-page secret bound to the client IP, used as CSRF
// defense on state-changing P2P calls (CORS is wide open by design). ----
function issuePeerKey(ip) {
  const rec = { key: crypto.randomBytes(16).toString('hex'), peerId: crypto.randomBytes(8).toString('base64url'), createdAt: Date.now() }
  p2pPeerKeys[ip] = rec
  saveP2pPeerKeys()
  return rec
}

function checkPeerKey(ip, key) {
  const rec = p2pPeerKeys[ip]
  return !!rec && rec.key === key
}

// Resolve a session for a web client: must exist, belong to this IP, and
// carry a valid peerKey. Host-side (plugin window) calls never go through HTTP.
// `key` may come from the X-P2P-Key header (all P2P calls) or the `p2pkey`
// query param (GET download/preview URLs, since <a>/<img> cannot send headers).
function authorizeP2p(req, clientIp, sessionId, key) {
  if (!sessionId) return null
  const session = findP2pSession(sessionId)
  if (!session || session.peerIp !== clientIp) return null
  if (!checkPeerKey(clientIp, key || '')) return null
  return session
}

function p2pKeyFrom(req, urlObj) {
  return req.headers['x-p2p-key'] || urlObj.searchParams.get('p2pkey') || ''
}

// Strip host-side paths before a message leaves the server to the peer.
function sanitizeMsgForPeer(msg) {
  const copy = Object.assign({}, msg)
  if (copy.files) {
    copy.files = copy.files.map(f => {
      const fc = Object.assign({}, f)
      delete fc.storedPath
      delete fc.refPath
      return fc
    })
  }
  return copy
}

function appendP2pMessage(session, msg) {
  const arr = p2pMessages[session.id] || (p2pMessages[session.id] = [])
  msg.seq = (p2pMsgSeq[session.id] = (p2pMsgSeq[session.id] || 0) + 1)
  arr.push(msg)
  if (arr.length > P2P_MSG_KEEP) {
    const removed = arr.splice(0, arr.length - P2P_MSG_KEEP)
    for (const m of removed) cleanupP2pFiles(m)
  }
  saveP2pMessages()
  return msg
}

// Received P2P files live under our managed directory and are cleaned when
// their message is pruned/deleted. Host-sent files are references, never touched.
function cleanupP2pFiles(msg) {
  if (!msg || msg.kind !== 'files' || !msg.files) return
  for (const f of msg.files) {
    if (f.direction === 'in' && f.storedPath) {
      try { fs.unlinkSync(f.storedPath) } catch (_e) { /* ignore */ }
    }
  }
}

// Remove one message (and its received files) from the server store.
function removeP2pMessage(session, msgId) {
  const arr = p2pMessages[session.id]
  if (!arr) return false
  const idx = arr.findIndex(m => m.id === msgId)
  if (idx === -1) return false
  cleanupP2pFiles(arr[idx])
  arr.splice(idx, 1)
  saveP2pMessages()
  return true
}

// Fully destroy a session: notify the peer first, then free every received
// file, drop the messages, and remove the session so it disappears from all
// lists. Deleting is final on the host side.
function destroyP2pSession(session, deletedBy) {
  if (!session) return false
  pushEvent('p2p.deleted', { sessionId: session.id, deletedBy, peerIp: session.peerIp }, { sessionId: session.id })
  const arr = p2pMessages[session.id] || []
  for (const m of arr) cleanupP2pFiles(m)
  delete p2pMessages[session.id]
  delete p2pMsgSeq[session.id]
  const idx = p2pSessions.indexOf(session)
  if (idx !== -1) p2pSessions.splice(idx, 1)
  saveP2pMessages()
  saveP2pSessions()
  return true
}

// Look up a file entry (by fileId) across all messages of a session.
function findP2pFileInSession(sessionId, fileId) {
  const arr = p2pMessages[sessionId] || []
  for (const m of arr) {
    if (m.kind === 'files' && m.files) {
      const f = m.files.find(x => x.fileId === fileId)
      if (f) return f
    }
  }
  return null
}

// A safe view of a session for UI consumption (plugin API + local console).
function p2pSessionView(s) {
  const arr = p2pMessages[s.id] || []
  const last = arr[arr.length - 1]
  return {
    id: s.id,
    peerIp: s.peerIp,
    peerName: s.peerName,
    requestMessage: s.requestMessage || '',
    status: s.status,
    createdAt: s.createdAt,
    lastActiveAt: s.lastActiveAt,
    unreadByHost: s.unreadByHost,
    deletedBy: s.deletedBy,
    deletedAt: s.deletedAt,
    peerOnline: !!sseClients[s.peerIp],
    lastMessage: last ? (last.kind === 'text' ? last.text : (last.files && last.files.length > 0 ? ('[文件] ' + last.files.map(f => f.name).join('、')) : '')) : ''
  }
}

// Guard for the local management console: only the plugin machine's own
// browser may reach /api/host/* (source IP is one of the host's addresses).
function isHostRequest(res, clientIp) {
  if (isLocalHost(clientIp)) return true
  sendJson(res, 403, { ok: false, error: '仅限本机管理' })
  return false
}

function readP2pJson(req, res, cb) {
  const chunks = []
  let size = 0
  let settled = false
  req.on('data', (chunk) => {
    if (settled) return
    size += chunk.length
    if (size > P2P_MAX_BODY) {
      settled = true
      sendJson(res, 413, { ok: false, error: '请求过大' })
      req.destroy()
      return
    }
    chunks.push(chunk)
  })
  req.on('error', () => { if (!settled) { settled = true; res.end() } })
  req.on('end', () => {
    if (settled) return
    settled = true
    let body = {}
    try { body = JSON.parse(Buffer.concat(chunks).toString('utf-8')) } catch (_e) { /* invalid json */ }
    cb(body)
  })
}

// ============================================================
//  P2P file receive: streamed multipart straight to disk (constant memory).
//  Collects EVERY file part and calls onDone(parts) once all streams flushed,
//  so multiple files in one request become a single chat message.
// ============================================================
function streamP2pUpload(req, res, session, onDone) {
  const contentType = req.headers['content-type'] || ''
  const boundaryMatch = contentType.match(/boundary=(?:"([^"]+)"|([^;]+))/i)
  if (!boundaryMatch) {
    sendJson(res, 400, { ok: false, error: '无效的请求格式' })
    return
  }
  const boundary = boundaryMatch[1] || boundaryMatch[2]
  const sessionDir = path.join(p2pDir, session.id)
  try { fs.mkdirSync(sessionDir, { recursive: true }) } catch (_e) { /* ignore */ }

  let buffer = Buffer.alloc(0)
  let inHeaders = true
  let headerBuf = []
  let cur = null // { fileId, name, size, ws, destPath }
  const parts = []
  let settled = false

  function fail(msg, status) {
    if (settled) return
    settled = true
    cleanup()
    sendJson(res, status || 400, { ok: false, error: msg })
  }

  function cleanup() {
    if (cur && cur.ws) { try { cur.ws.destroy() } catch (_e) { /* ignore */ } }
  }

  function writeData(data) {
    cur.size += data.length
    if (cur.size > P2P_MAX_FILE) { fail('文件过大，超过大小限制', 413); return }
    if (!cur.ws.write(data)) {
      req.pause()
      cur.ws.once('drain', () => req.resume())
    }
  }

  function closePart() {
    if (cur && cur.ws) {
      try { cur.ws.end() } catch (_e) { /* ignore */ }
      parts.push(cur)
    }
    cur = null
  }

  function finishAll() {
    const streams = parts.filter(p => p.ws).map(p => p.ws)
    if (streams.length === 0) { onDone([]); return }
    let pending = streams.length
    for (const ws of streams) {
      ws.once('finish', () => { if (--pending === 0) onDone(parts) })
    }
  }

  function scan() {
    while (!settled) {
      if (inHeaders) {
        const marker = Buffer.from('\r\n\r\n')
        const idx = buffer.indexOf(marker)
        if (idx === -1) {
          const keep = Math.max(0, buffer.length - (marker.length - 1))
          headerBuf.push(buffer.slice(0, keep))
          buffer = buffer.slice(keep)
          return
        }
        headerBuf.push(buffer.slice(0, idx))
        const headerText = Buffer.concat(headerBuf).toString('utf-8')
        headerBuf = []
        const cd = headerText.match(/Content-Disposition:[^\r\n]*/i)
        let filename = ''
        if (cd) {
          const fnStar = cd[0].match(/filename\*=UTF-8''([^;]+)/i)
          if (fnStar) { try { filename = decodeURIComponent(fnStar[1].trim().replace(/^"|"$/g, '')) } catch (_e) { filename = '' } }
          if (!filename) { const fn = cd[0].match(/filename="([^"]*)"/); if (fn) filename = fn[1] }
        }
        const safeName = sanitizeFileName(filename || 'p2p-file')
        const fileId = 'f' + Date.now().toString(36) + crypto.randomBytes(4).toString('hex')
        const destPath = path.join(sessionDir, fileId + '_' + safeName)
        cur = { fileId, name: safeName, size: 0, ws: fs.createWriteStream(destPath), destPath }
        inHeaders = false
        buffer = buffer.slice(idx + marker.length)
      } else {
        const delim = Buffer.from('\r\n--' + boundary)
        const idx = buffer.indexOf(delim)
        if (idx === -1) {
          const keep = Math.max(0, buffer.length - (delim.length - 1))
          if (cur) writeData(buffer.slice(0, keep))
          buffer = buffer.slice(keep)
          return
        }
        let data = buffer.slice(0, idx)
        if (cur) {
          cur.size += data.length
          if (cur.size > P2P_MAX_FILE) { fail('文件过大，超过大小限制', 413); return }
          if (data.length) {
            if (!cur.ws.write(data)) {
              req.pause()
              cur.ws.once('drain', () => req.resume())
            }
          }
        }
        const after = buffer.slice(idx + delim.length)
        if (after.length >= 2 && after[0] === 0x2d && after[1] === 0x2d) {
          // closing boundary — flush the last part, then report everything
          buffer = Buffer.alloc(0)
          closePart()
          settled = true
          finishAll()
          return
        }
        closePart()
        inHeaders = true
        headerBuf = []
        buffer = (after[0] === 0x0d && after[1] === 0x0a) ? after.slice(2) : after
      }
    }
  }

  req.on('data', (chunk) => {
    buffer = Buffer.concat([buffer, chunk])
    scan()
  })
  req.on('error', () => fail('上传中断', 500))
  req.on('aborted', () => fail('上传中断', 500))
  req.on('end', () => {
    if (settled) return
    settled = true
    closePart()
    finishAll()
  })
}

// ============================================================
//  P2P file serve (download/preview) with session-scope validation
// ============================================================
function serveP2pFile(req, res, session, fileId, isDownload) {
  if (session.status !== 'active') {
    sendJson(res, 403, { ok: false, error: '连接已断开' })
    return
  }
  const msgs = p2pMessages[session.id] || []
  let f = null
  for (const m of msgs) {
    if (m.kind === 'files' && m.files) {
      f = m.files.find(x => x.fileId === fileId)
      if (f) break
    }
  }
  if (!f) {
    sendJson(res, 404, { ok: false, error: '文件不存在' })
    return
  }
  const absPath = f.direction === 'out' ? f.refPath : f.storedPath
  if (!absPath || !fs.existsSync(absPath)) {
    sendJson(res, 404, { ok: false, error: '文件不存在或已被移动' })
    return
  }
  const stat = fs.statSync(absPath)
  if (stat.isDirectory()) {
    sendJson(res, 400, { ok: false, error: '不支持目录' })
    return
  }
  const mimeType = f.mime || getMimeType(absPath)
  const fileSize = stat.size
  const encodedName = encodeURIComponent(f.name || path.basename(absPath))

  const range = req.headers.range
  if (range) {
    const parts = range.replace(/bytes=/, '').split('-')
    const start = parseInt(parts[0], 10)
    const end = parts[1] ? parseInt(parts[1], 10) : fileSize - 1
    const chunkSize = end - start + 1
    res.writeHead(206, {
      'Content-Type': mimeType,
      'Content-Disposition': `inline; filename*=UTF-8''${encodedName}`,
      'Content-Range': `bytes ${start}-${end}/${fileSize}`,
      'Accept-Ranges': 'bytes',
      'Content-Length': chunkSize,
      'Cache-Control': 'no-store'
    })
    const stream = fs.createReadStream(absPath, { start, end })
    stream.pipe(res)
    stream.on('error', () => { res.end() })
    return
  }

  res.writeHead(200, {
    'Content-Type': mimeType,
    'Content-Disposition': `inline; filename*=UTF-8''${encodedName}`,
    'Content-Length': fileSize,
    'Accept-Ranges': 'bytes',
    'Cache-Control': 'no-store'
  })
  const stream = fs.createReadStream(absPath)
  stream.pipe(res)
  stream.on('error', () => { res.end() })
}

// ============================================================
//  Exported Services
// ============================================================
window.services = {
  // ---- Server control ----
  startServer(port, ip) {
    return new Promise((resolve) => {
      if (server) {
        server.close()
        server = null
      }
      if (loopServer) {
        loopServer.close()
        loopServer = null
      }
      serverConfig.port = port
      serverConfig.ip = ip
      try {
        const srv = createServer(port, ip)
        // When binding a LAN interface, also listen on 127.0.0.1 so the
        // plugin machine's own browser can reach http://127.0.0.1:port
        // (localhost URLs shown in the "本机访问" hint actually work).
        const srv2 = (ip && ip !== '127.0.0.1' && ip !== '::1' && ip !== 'localhost')
          ? createServer(port, ip)
          : null
        srv.once('error', (err) => {
          serverConfig.running = false
          server = null
          console.error('Server error:', err.message)
          resolve({ ok: false, error: err.code === 'EADDRINUSE' ? '端口已被占用，请更换端口' : err.message })
        })
        if (srv2) {
          srv2.once('error', (err) => {
            // The loopback listener is a convenience only — a failure here
            // (e.g. the OS refuses the same port on 127.0.0.1) must not break
            // the main LAN listener.
            console.error('Loopback listener error:', err.message)
          })
        }
        srv.listen(port, ip, () => {
          server = srv
          serverConfig.port = srv.address().port
          serverConfig.running = true
          autoStartEnabled = true
          saveConfig()
          refreshLocalIpSet()
          if (srv2) {
            srv2.listen(serverConfig.port, '127.0.0.1', () => {
              loopServer = srv2
            })
          }
          resolve({ ok: true })
        })
      } catch (err) {
        serverConfig.running = false
        console.error('Failed to start server:', err.message)
        resolve({ ok: false, error: err.message })
      }
    })
  },

  stopServer() {
    if (server) {
      server.close()
      server = null
    }
    if (loopServer) {
      loopServer.close()
      loopServer = null
    }
    serverConfig.running = false
    autoStartEnabled = false
    // Tear down every live SSE channel so web clients reconnect/refresh
    for (const ip of Object.keys(sseClients)) {
      try { sseClients[ip].res.end() } catch (_e) { /* ignore */ }
    }
    sseClients = {}
  },

  // Persist a new port while the server is stopped
  setPort(port) {
    if (serverConfig.running) return false
    const p = parseInt(port, 10)
    if (!Number.isFinite(p) || p < 1 || p > 65535) return false
    serverConfig.port = p
    saveConfig()
    return true
  },

  // Ask the OS for a free port on the given interface
  getFreePort(ip) {
    return new Promise((resolve) => {
      const srv = net.createServer()
      srv.once('error', () => resolve(0))
      srv.listen(0, ip || '0.0.0.0', () => {
        const p = srv.address().port
        srv.close(() => resolve(p))
      })
    })
  },

  getServerStatus() {
    return {
      port: serverConfig.port,
      ip: serverConfig.ip,
      token: serverConfig.token,
      running: serverConfig.running
    }
  },

  // Whether the server should auto-start when the UI is (re)opened.
  // True on first load; false after the user manually stops the server.
  shouldAutoStart() {
    return autoStartEnabled
  },

  // ---- Token management ----
  regenerateToken() {
    serverConfig.token = crypto.randomBytes(8).toString('hex')
    saveConfig()
    return serverConfig.token
  },

  // ---- Share management ----
  addShares(filePaths) {
    const added = []
    const skipped = []

    for (const fp of filePaths) {
      try {
        const stat = fs.statSync(fp)
        const name = path.basename(fp)

        const exists = shareItems.some(item => item.path === fp)
        if (exists) {
          skipped.push(name)
          continue
        }

        if (stat.isDirectory()) {
          const tree = buildDirTree(fp, fp)
          shareItems.push(tree)
          added.push(tree)
        } else {
          const item = {
            id: String(++shareIdCounter),
            path: fp,
            name: name,
            isDirectory: false,
            enabled: true
          }
          shareItems.push(item)
          added.push(item)
        }
      } catch (_e) {
        skipped.push(path.basename(fp))
      }
    }

    saveShares()
    return { added, skipped }
  },

  removeShare(id) {
    // Free the on-disk copy when removing a client upload — the file lives
    // under the uploads directory and is only meaningful while shared.
    // Host shares are plain references, so their source files are untouched.
    const item = findItemById(shareItems, id)
    if (item && item.origin && item.origin.type === 'upload') {
      deleteUploadFileFromDisk(item)
    }
    const removed = removeItemById(shareItems, id)
    if (removed) saveShares()
    return removed
  },

  toggleShare(id, enabled) {
    const item = findItemById(shareItems, id)
    if (item) {
      item.enabled = enabled
      saveShares()
      return true
    }
    return false
  },

  getShareList() {
    // Deep clone so Vue detects changes
    return deepClone(shareItems)
  },

  // ---- Network ----
  getNetworkInterfaces() {
    const interfaces = os.networkInterfaces()
    const result = []
    for (const [name, addrs] of Object.entries(interfaces)) {
      for (const addr of addrs) {
        if (addr.family === 'IPv4' && !addr.internal) {
          result.push({
            name: name,
            ip: addr.address,
            family: addr.family,
            internal: addr.internal
          })
        }
      }
    }
    return result
  },

  // ---- File scanning ----
  scanDirectory(dirPath) {
    const count = countFilesInDir(dirPath)
    const files = []
    try {
      const entries = fs.readdirSync(dirPath, { withFileTypes: true })
      for (const entry of entries) {
        if (entry.name.startsWith('.')) continue
        files.push({
          path: path.join(dirPath, entry.name),
          name: entry.name,
          isDirectory: entry.isDirectory()
        })
      }
    } catch (_e) { /* skip */ }
    return { fileCount: count, files }
  },

  // ---- Token ----
  getAccessToken() {
    return serverConfig.token
  },

  // ---- Web UI ----
  getWebUiHtml() {
    return webUiHtml
  },

  // ---- Download Logs ----
  getDownloadLogs() {
    return downloadLogs.slice()
  },

  clearDownloadLogs() {
    downloadLogs = []
    saveLogs()
  },

  // ---- IP Whitelist ----
  getWhitelist() {
    return ipWhitelist.slice()
  },

  addWhitelist(ip) {
    return addWhitelistEntry(ip)
  },

  removeWhitelist(ip) {
    return removeWhitelistEntry(ip)
  },

  // ---- Text Sharing ----
  shareText(text) {
    if (!text || !text.trim()) return null
    const now = new Date()
    const pad = (n) => String(n).padStart(2, '0')
    const ts = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}_${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`
    const fileName = `share_${ts}.txt`
    const filePath = path.join(window.ztools.getPath('downloads'), fileName)
    try {
      fs.writeFileSync(filePath, text, { encoding: 'utf-8' })
      const item = {
        id: String(++shareIdCounter),
        path: filePath,
        name: fileName,
        isDirectory: false,
        enabled: true
      }
      shareItems.push(item)
      saveShares()
      return item
    } catch (_e) {
      return null
    }
  },

  // ---- File Preview ----
  // Read a file for preview. Returns { type, data, mime } where:
  //   type: 'text' | 'base64'
  //   data: string content (text) or base64-encoded string (base64)
  //   mime: MIME type
  // For text-like files (<= 2MB), returns text; for images, returns base64 data URL.
  readFile(filePath) {
    try {
      const stat = fs.statSync(filePath)
      if (stat.isDirectory()) return null
      const mime = getMimeType(filePath)
      const ext = path.extname(filePath).toLowerCase()
      const textExts = ['.txt', '.log', '.csv', '.json', '.xml', '.yml', '.yaml', '.toml', '.ini', '.cfg', '.conf', '.env', '.properties', '.md', '.markdown', '.mdown', '.mkd', '.js', '.mjs', '.cjs', '.ts', '.tsx', '.jsx', '.py', '.java', '.c', '.cpp', '.h', '.hpp', '.rs', '.go', '.rb', '.php', '.swift', '.kt', '.kts', '.scala', '.dart', '.lua', '.r', '.sql', '.sh', '.bash', '.zsh', '.bat', '.cmd', '.ps1', '.html', '.htm', '.css', '.scss', '.less', '.vue', '.svelte', '.svg']
      const isText = textExts.includes(ext) || mime.startsWith('text/')
      if (isText && stat.size <= 2 * 1024 * 1024) {
        const data = fs.readFileSync(filePath, 'utf-8')
        return { type: 'text', data, mime }
      }
      // For images and other files, return base64 data URL
      if (stat.size <= 20 * 1024 * 1024) {
        const buf = fs.readFileSync(filePath)
        return { type: 'base64', data: 'data:' + mime + ';base64,' + buf.toString('base64'), mime }
      }
      return { type: 'too-large', data: '', mime }
    } catch (_e) {
      return null
    }
  },

  // Get file MIME type
  getFileMimeType(filePath) {
    return getMimeType(filePath)
  },

  // ---- P2P private messaging (plugin-side API) ----
  getP2pSummary() {
    const pending = p2pSessions.filter(s => s.status === 'pending').length
    const active = p2pSessions.filter(s => s.status === 'active').length
    const unread = p2pSessions.reduce((a, s) => a + (s.status === 'active' ? s.unreadByHost : 0), 0)
    return { pending, active, unreadTotal: pending + unread }
  },

  getP2pSessions() {
    // Only actionable sessions: pending requests + active conversations.
    // Deleted/rejected ones are never surfaced to the host lists.
    return p2pSessions.filter(s => s.status === 'pending' || s.status === 'active').map(p2pSessionView)
  },

  getP2pMessages(sessionId, after) {
    const arr = p2pMessages[sessionId] || []
    return arr.filter(m => !after || m.seq > after)
  },

  getP2pEvents(since) {
    const events = p2pEventLog.filter(e => e.seq > (since || 0))
    return { events, since: p2pEventSeq }
  },

  respondP2p(id, accept) {
    const s = findP2pSession(id)
    if (!s || s.status !== 'pending') return false
    s.status = accept ? 'active' : 'rejected'
    s.lastActiveAt = Date.now()
    saveP2pSessions()
    pushEvent(accept ? 'p2p.accepted' : 'p2p.rejected', {
      sessionId: s.id, peerIp: s.peerIp, peerName: s.peerName
    }, { sessionId: s.id })
    return true
  },

  sendP2pMessage(sessionId, text) {
    const s = findP2pSession(sessionId)
    if (!s || s.status !== 'active') return false
    const trimmed = String(text || '').slice(0, P2P_MAX_TEXT)
    if (!trimmed.trim()) return false
    const msg = appendP2pMessage(s, {
      id: crypto.randomBytes(8).toString('hex'), from: 'host', kind: 'text', text: trimmed,
      createdAt: Date.now(), status: 'sent'
    })
    s.unreadByPeer++
    s.lastActiveAt = Date.now()
    saveP2pSessions()
    pushEvent('p2p.message', sanitizeMsgForPeer(msg), { sessionId: s.id })
    return true
  },

  sendP2pFiles(sessionId, filePaths) {
    const s = findP2pSession(sessionId)
    if (!s || s.status !== 'active') return false
    const files = []
    for (const filePath of (filePaths || [])) {
      let stat = null
      try { stat = fs.statSync(filePath) } catch (_e) { continue }
      if (stat.isDirectory()) continue
      files.push({
        fileId: 'f' + Date.now().toString(36) + crypto.randomBytes(4).toString('hex'),
        name: path.basename(filePath),
        size: stat.size,
        mime: getMimeType(filePath),
        direction: 'out',
        refPath: filePath
      })
    }
    if (files.length === 0) return false
    const msg = appendP2pMessage(s, {
      id: crypto.randomBytes(8).toString('hex'), from: 'host', kind: 'files',
      files, createdAt: Date.now(), status: 'sent'
    })
    s.unreadByPeer++
    s.lastActiveAt = Date.now()
    saveP2pSessions()
    pushEvent('p2p.file', sanitizeMsgForPeer(msg), { sessionId: s.id })
    return true
  },

  deleteP2pMessage(sessionId, msgId) {
    const s = findP2pSession(sessionId)
    if (!s) return false
    if (!removeP2pMessage(s, msgId)) return false
    pushEvent('p2p.msgdeleted', { sessionId: s.id, msgId }, { sessionId: s.id })
    return true
  },

  // Mark a session's messages as read (host viewed the conversation).
  markP2pRead(sessionId) {
    const s = findP2pSession(sessionId)
    if (!s || s.unreadByHost === 0) return true
    s.unreadByHost = 0
    saveP2pSessions()
    return true
  },

  deleteP2p(sessionId) {
    const s = findP2pSession(sessionId)
    if (!s) return false
    return destroyP2pSession(s, 'host')
  },

  getP2pFileSavePath(sessionId, fileId) {
    const s = findP2pSession(sessionId)
    if (!s) return ''
    const f = findP2pFileInSession(sessionId, fileId)
    return f ? (f.storedPath || f.refPath || '') : ''
  },

  // Copy a session file to a user-chosen destination (incoming files only).
  saveP2pFileAs(sessionId, fileId, destPath) {
    const s = findP2pSession(sessionId)
    if (!s) return false
    const f = findP2pFileInSession(sessionId, fileId)
    const src = f ? (f.storedPath || f.refPath || '') : ''
    if (!src || !fs.existsSync(src)) return false
    try {
      fs.copyFileSync(src, destPath)
      return true
    } catch (_e) {
      return false
    }
  }
}

// ============================================================
//  Initialize
// ============================================================
loadState()
loadP2pState()
loadWebUi()
ensureUploadsDir()
ensureP2pDir()
refreshLocalIpSet()
