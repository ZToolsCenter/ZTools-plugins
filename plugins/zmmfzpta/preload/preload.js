const fs = require('node:fs')
const path = require('node:path')
const http = require('node:http')
const https = require('node:https')
const net = require('node:net')
const crypto = require('node:crypto')
const { spawn } = require('node:child_process')
const os = require('node:os')
const url = require('node:url')

let _hljsCss = ''
let _hljsJs = ''
try {
  _hljsCss = fs.readFileSync(path.join(__dirname, 'highlight', 'github.min.css'), 'utf8')
  _hljsJs = fs.readFileSync(path.join(__dirname, 'highlight', 'highlight.min.js'), 'utf8')
} catch (_) {}

window.http = http
window.https = https

window.startImgProxy = function() {
  const server = http.createServer((req, res) => {
    const imageUrl = req.url.slice(1)
    if (!imageUrl) {
      res.statusCode = 400
      res.end('Missing image URL')
      return
    }

    let referer = ''
    try {
      referer = new URL(imageUrl).origin + '/'
    } catch(e) {}

    const options = {
      headers: {
        'Referer': referer,
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
      }
    }

    const client = imageUrl.startsWith('https') ? https : http
    client.get(imageUrl, options, (imgRes) => {
      if (imgRes.statusCode >= 300 && imgRes.statusCode < 400 && imgRes.headers.location) {
        const redirectUrl = imgRes.headers.location
        const redirectClient = redirectUrl.startsWith('https') ? https : http
        let redirectReferer = ''
        try {
          redirectReferer = new URL(redirectUrl).origin + '/'
        } catch(e) {}
        redirectClient.get(redirectUrl, {
          headers: {
            'Referer': redirectReferer,
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
          }
        }, (redirectRes) => {
          res.setHeader('content-type', redirectRes.headers['content-type'] || 'image/jpeg')
          redirectRes.pipe(res)
        }).on('error', (e) => {
          res.statusCode = 500
          res.end('Error fetching image')
        })
        return
      }
      res.setHeader('content-type', imgRes.headers['content-type'] || 'image/jpeg')
      imgRes.pipe(res)
    }).on('error', (e) => {
      res.statusCode = 500
      res.end('Error fetching image')
    })
  })

  server.listen(51984, () => {
    console.log('Image proxy running on http://localhost:51984')
  })
}

window.dbPut = function(key, value) {
  //console.log('dbPut', key, value)
  ztools.dbStorage.setItem(key, value)
}

window.dbGet = function(key) {
  let ret = ztools.dbStorage.getItem(key)
  //console.log('dbGet', key, ret)
  return ret
}

window.dbRemove = function(key) {
  //console.log('dbRemove', key)
  ztools.dbStorage.removeItem(key)
}

window.openExternal = function(url) {
  if (!url) return
  try {
    ztools.shellOpenExternal(url)
  } catch (e) {
    console.error('openExternal failed:', e)
  }
}

window.addStock = function(sid) {
  if (window.stocks == undefined) {
    window.stocks = window.dbGet('stock_fav') || []
  }
  if (!window.hasStock(sid)) {
    window.stocks.push(sid)
    window.dbPut('stock_fav', window.stocks)
  }
}

window.removeStock = function(sid) {
  if (window.stocks == undefined) {
    window.stocks = window.dbGet('stock_fav') || []
  }
  for (let i = window.stocks.length - 1; i >= 0; i--) {
    if (window.stocks[i] == sid) {
      window.stocks.splice(i, 1)
    }
  }
  window.dbPut('stock_fav', window.stocks)
}

window.hasStock = function(sid) {
  if (window.stocks == undefined) {
    window.stocks = window.dbGet('stock_fav') || []
  }
  for (let i = window.stocks.length - 1; i >= 0; i--) {
    if (window.stocks[i] == sid) {
      return true
    }
  }
  return false
}

window.getAllStock = function() {
  if (window.stocks == undefined) {
    window.stocks = window.dbGet('stock_fav') || []
  }
  return window.stocks
}

// ========== HTTP 文件服务器 ==========
let toolServer = null
let toolServerDir = null
let toolServerPort = null
let toolServerLogs = []
let toolServerStats = { files: 0, bytes: 0, uploads: 0, uploadBytes: 0 }
let toolServerLive = {
  connections: 0,
  windowDown: 0,
  windowUp: 0,
  windowStart: Date.now(),
  downRate: 0,
  upRate: 0,
}
let toolServerUploadEnabled = false
let toolServerUploadDir = null
let toolServerManageEnabled = false
let toolServerPassword = '' // 空字符串=无需密码；非空=需 Basic Auth
let toolServerPushClients = new Set() // { res, ip, since, pingTimer, closed }
let toolServerAutoStopAt = null
let toolServerAutoStopTimer = null

const TOOL_UPLOAD_MAX_BODY = 200 * 1024 * 1024
const TOOL_UPLOAD_MAX_FILES = 10
const TOOL_MKDIR_MAX_BODY = 64 * 1024

function toolNoteDown(n) {
  if (n > 0) toolServerLive.windowDown += n
}

function toolNoteUp(n) {
  if (n > 0) toolServerLive.windowUp += n
}

function toolSettleRates() {
  const now = Date.now()
  const dt = Math.max(0.25, (now - toolServerLive.windowStart) / 1000)
  toolServerLive.downRate = Math.round(toolServerLive.windowDown / dt)
  toolServerLive.upRate = Math.round(toolServerLive.windowUp / dt)
  toolServerLive.windowDown = 0
  toolServerLive.windowUp = 0
  toolServerLive.windowStart = now
}

function toolResetLive() {
  toolServerLive = {
    connections: 0,
    windowDown: 0,
    windowUp: 0,
    windowStart: Date.now(),
    downRate: 0,
    upRate: 0,
  }
}

function toolClearAutoStop() {
  if (toolServerAutoStopTimer) {
    clearTimeout(toolServerAutoStopTimer)
    toolServerAutoStopTimer = null
  }
  toolServerAutoStopAt = null
}

function toolScheduleAutoStop(atMs) {
  toolClearAutoStop()
  const at = Number(atMs)
  if (!at || at <= Date.now()) return
  toolServerAutoStopAt = at
  toolServerAutoStopTimer = setTimeout(() => {
    toolServerAutoStopTimer = null
    toolServerAutoStopAt = null
    try {
      window.toolStopServer()
    } catch (_) {}
  }, Math.max(0, at - Date.now()))
}

function toolProbePortFree(port) {
  return new Promise((resolve) => {
    const s = net.createServer()
    s.unref()
    s.once('error', () => resolve(false))
    s.once('listening', () => {
      s.close(() => resolve(true))
    })
    try {
      s.listen(port, '0.0.0.0')
    } catch (_) {
      resolve(false)
    }
  })
}

async function toolFindFreePort(start, tries) {
  let p = Math.max(1, Math.min(65535, Number(start) || 8000))
  const n = Math.max(1, Number(tries) || 30)
  for (let i = 0; i < n; i++) {
    if (p > 65535) p = 1024
    if (await toolProbePortFree(p)) return p
    p++
  }
  return null
}

function toolClassifyIface(name) {
  const raw = String(name || '')
  const n = raw.toLowerCase()
  if (/utun|ipsec|ppp|tun\d*|tap\d*|wg\d*|tailscale|zerotier|zt|vpn|wireguard/.test(n)) {
    return { kind: 'vpn', label: 'VPN' }
  }
  if (/wi-?fi|wlan|airport|wl[^a-z]|无线/.test(n)) {
    return { kind: 'wifi', label: 'Wi‑Fi' }
  }
  if (/ethernet|eth\d+|有线|以太网/.test(n)) {
    return { kind: 'ethernet', label: '有线' }
  }
  if (/bridge|ap\d+|热点|hotspot|personal.?hotspot/.test(n)) {
    return { kind: 'hotspot', label: '热点' }
  }
  if (process.platform === 'darwin') {
    const map = toolLoadMacIfaceMap()
    const hw = map && map[raw]
    if (hw) {
      const h = String(hw).toLowerCase()
      if (/wi-?fi|airport|wireless/.test(h)) return { kind: 'wifi', label: 'Wi‑Fi' }
      if (/ethernet|thunderbolt|usb|lan|有线/.test(h)) return { kind: 'ethernet', label: '有线' }
      if (/bridge|hotspot|iphone|ipad|bluetooth|pan/.test(h)) return { kind: 'hotspot', label: '热点' }
      const short = String(hw).replace(/\s+Adapter$/i, '').trim()
      return { kind: 'lan', label: short || raw }
    }
    // 常见默认：现代 Mac 的 en0 多为 Wi‑Fi
    if (/^en0$/i.test(raw)) return { kind: 'wifi', label: 'Wi‑Fi' }
    if (/^en\d+$/i.test(raw)) return { kind: 'ethernet', label: '有线' }
  }
  if (/^en\d+$/i.test(raw)) {
    return { kind: 'lan', label: raw }
  }
  if (raw) return { kind: 'other', label: raw }
  return { kind: 'other', label: '网卡' }
}

let toolMacIfaceMap = null
let toolMacIfaceMapAt = 0

function toolLoadMacIfaceMap() {
  if (process.platform !== 'darwin') return null
  const now = Date.now()
  if (toolMacIfaceMap && now - toolMacIfaceMapAt < 60000) return toolMacIfaceMap
  try {
    const { execSync } = require('node:child_process')
    const out = execSync('networksetup -listallhardwareports', {
      encoding: 'utf8',
      timeout: 3000,
      stdio: ['ignore', 'pipe', 'ignore'],
    })
    const map = Object.create(null)
    let portName = ''
    String(out).split(/\r?\n/).forEach((line) => {
      const hp = line.match(/^Hardware Port:\s*(.+)\s*$/i)
      if (hp) {
        portName = hp[1].trim()
        return
      }
      const dev = line.match(/^Device:\s*(\S+)\s*$/i)
      if (dev && portName) {
        map[dev[1]] = portName
        portName = ''
      }
    })
    toolMacIfaceMap = map
    toolMacIfaceMapAt = now
    return map
  } catch (_) {
    toolMacIfaceMap = Object.create(null)
    toolMacIfaceMapAt = now
    return toolMacIfaceMap
  }
}

function toolCollectEndpoints(port, suffix) {
  const list = [{
    url: toolSanitizeQrUrl('http://localhost:' + port + suffix),
    iface: 'loopback',
    kind: 'loopback',
    label: '本机',
  }]
  try {
    const ifaces = os.networkInterfaces()
    for (const name in ifaces) {
      for (const it of ifaces[name]) {
        const family = it.family
        const isV4 = family === 'IPv4' || family === 4
        if (!isV4 || it.internal) continue
        const meta = toolClassifyIface(name)
        list.push({
          url: toolSanitizeQrUrl('http://' + it.address + ':' + port + suffix),
          iface: name,
          kind: meta.kind,
          label: meta.label,
        })
      }
    }
  } catch (_) {}
  return list
}

function toolTrackRequest(req, res) {
  toolServerLive.connections++
  let ended = false
  const done = () => {
    if (ended) return
    ended = true
    toolServerLive.connections = Math.max(0, toolServerLive.connections - 1)
  }
  res.on('finish', done)
  res.on('close', done)

  const origWrite = res.write
  res.write = function(chunk, encoding, cb) {
    if (chunk != null && typeof chunk !== 'function') {
      const len = Buffer.isBuffer(chunk)
        ? chunk.length
        : Buffer.byteLength(chunk, typeof encoding === 'string' ? encoding : 'utf8')
      toolNoteDown(len)
    }
    return origWrite.call(this, chunk, encoding, cb)
  }
  const origEnd = res.end
  res.end = function(chunk, encoding, cb) {
    if (chunk != null && typeof chunk !== 'function') {
      const len = Buffer.isBuffer(chunk)
        ? chunk.length
        : Buffer.byteLength(String(chunk), typeof encoding === 'string' ? encoding : 'utf8')
      toolNoteDown(len)
    }
    return origEnd.call(this, chunk, encoding, cb)
  }
  req.on('data', (chunk) => {
    toolNoteUp(chunk.length)
  })
}

function toolWantJson(req, q) {
  return /application\/json/i.test(String(req.headers.accept || '')) || (q && q.ajax === '1')
}

function toolEndJsonOrText(res, req, q, status, payload) {
  if (toolWantJson(req, q)) {
    res.statusCode = status
    res.setHeader('content-type', 'application/json; charset=utf-8')
    if (typeof payload === 'string') {
      res.end(JSON.stringify({ ok: false, error: payload }))
    } else {
      res.end(JSON.stringify(payload))
    }
  } else {
    res.statusCode = status
    res.end(typeof payload === 'string' ? payload : JSON.stringify(payload))
  }
}

function toolIsLocalIp(ip) {
  if (!ip) return false
  const clean = ip.replace('::ffff:', '')
  if (clean === '127.0.0.1' || clean === '::1') return true
  try {
    const ifaces = os.networkInterfaces()
    for (const name of Object.keys(ifaces)) {
      for (const inf of ifaces[name]) {
        if (inf.family === 'IPv4' && inf.address === clean) return true
      }
    }
  } catch (_) {}
  return false
}

function toolCheckAuth(req) {
  if (!toolServerPassword) return true
  const auth = req.headers.authorization
  if (!auth || !auth.startsWith('Basic ')) return false
  try {
    const decoded = Buffer.from(auth.slice(6), 'base64').toString('utf8')
    const idx = decoded.indexOf(':')
    if (idx < 0) return false
    return decoded.slice(idx + 1) === toolServerPassword
  } catch (e) { return false }
}

// ========== 文本/代码片段直发（SSE 推送） ==========
let toolHljsCache = null // { js, css } 或 null（读取失败）
function toolLoadHljsAssets() {
  if (toolHljsCache) return toolHljsCache
  try {
    const dir = (typeof __dirname !== 'undefined') ? path.join(__dirname, 'highlight') : null
    if (!dir) return null
    const js = fs.readFileSync(path.join(dir, 'highlight.min.js'), 'utf8')
    const css = fs.readFileSync(path.join(dir, 'github.min.css'), 'utf8')
    toolHljsCache = { js: js, css: css }
    return toolHljsCache
  } catch (e) {
    toolHljsCache = null
    return null
  }
}

function toolHandlePushStream(req, res) {
  if (!toolCheckAuth(req)) {
    res.statusCode = 401
    res.setHeader('WWW-Authenticate', 'Basic realm="FileShare"')
    res.end('401')
    return
  }
  res.statusCode = 200
  res.setHeader('Content-Type', 'text/event-stream; charset=utf-8')
  res.setHeader('Cache-Control', 'no-cache, no-transform')
  res.setHeader('Connection', 'keep-alive')
  res.setHeader('X-Accel-Buffering', 'no')
  try { res.write(': connected\n\n') } catch (e) { return }
  const client = {
    res: res,
    ip: (req.socket.remoteAddress || '').replace('::ffff:', ''),
    since: Date.now(),
    closed: false,
  }
  toolServerPushClients.add(client)
  const pingTimer = setInterval(() => {
    if (client.closed) return
    try { res.write(': ping\n\n') } catch (e) { finish() }
  }, 25000)
  client.pingTimer = pingTimer
  function finish() {
    if (client.closed) return
    client.closed = true
    if (client.pingTimer) clearInterval(client.pingTimer)
    toolServerPushClients.delete(client)
  }
  req.on('close', finish)
  res.on('close', finish)
  res.on('error', finish)
}

// 注入到网页端（目录列表 / 文件预览）的推送客户端：连接 SSE、接收片段、高亮展示、历史回看
function toolPushClientBlock(pushUrl) {
  if (!pushUrl) return ''
  const base = ''
  const hljsUrl = base + '/__hljs__.js'
  const hlcssUrl = base + '/__hlcss__.css'
  return [
    '<style>',
    '.push-overlay{position:fixed;inset:0;background:rgba(0,0,0,.55);display:none;align-items:center;justify-content:center;z-index:9999;padding:16px}',
    '.push-overlay.show{display:flex}',
    '.push-card{background:#fff;border-radius:14px;max-width:760px;width:100%;max-height:80vh;display:flex;flex-direction:column;overflow:hidden;box-shadow:0 20px 60px rgba(0,0,0,.3)}',
    '.push-head{display:flex;align-items:center;gap:8px;padding:10px 14px;border-bottom:1px solid #f0f1f3;background:#fafbfc;flex-wrap:wrap}',
    '.push-title{font-size:13px;font-weight:600;color:#1a1a1a;margin-right:auto}',
    '.push-nav{display:none;align-items:center;gap:4px}',
    '.push-nav.show{display:inline-flex}',
    '.push-nav-btn{width:24px;height:24px;display:inline-flex;align-items:center;justify-content:center;border:1px solid #e8eaed;background:#fff;color:#666;border-radius:6px;font-size:12px;line-height:1;cursor:pointer;padding:0}',
    '.push-nav-btn:hover:not(:disabled){border-color:#ed4c40;color:#ed4c40}',
    '.push-nav-btn:disabled{opacity:.4;cursor:default}',
    '.push-counter{font-size:11px;color:#999;min-width:38px;text-align:center}',
    '.push-head-actions{display:flex;gap:6px}',
    '.push-btn{font-size:12px;font-weight:500;color:#ed4c40;background:#fff;border:1px solid rgba(237,76,64,.35);border-radius:7px;padding:5px 12px;cursor:pointer}',
    '.push-btn:hover{background:#fff5f4}',
    '.push-body{margin:0;padding:14px 16px;overflow:auto;flex:1;font-family:ui-monospace,SFMono-Regular,Menlo,Monaco,Consolas,monospace;font-size:12px;line-height:1.6;white-space:pre;background:#fafbfc;color:#222}',
    '.push-body code{font-family:inherit;font-size:inherit;background:transparent;padding:0}',
    '@media(max-width:600px){.push-card{max-width:100%;border-radius:12px}.push-title{width:100%;margin-right:0}}',
    '.push-hist-overlay{position:fixed;inset:0;background:rgba(0,0,0,.55);display:none;align-items:center;justify-content:center;z-index:9998;padding:16px}',
    '.push-hist-overlay.show{display:flex}',
    '.push-hist-card{background:#fff;border-radius:14px;max-width:520px;width:100%;max-height:80vh;display:flex;flex-direction:column;overflow:hidden;box-shadow:0 20px 60px rgba(0,0,0,.3)}',
    '.push-hist-head{display:flex;align-items:center;gap:8px;padding:10px 14px;border-bottom:1px solid #f0f1f3;background:#fafbfc}',
    '.push-hist-title{font-size:13px;font-weight:600;color:#1a1a1a;margin-right:auto}',
    '.push-hist-list{overflow:auto;flex:1;padding:6px 0}',
    '.push-hist-empty{padding:28px 16px;text-align:center;font-size:13px;color:#aaa}',
    '.push-hist-item{display:flex;flex-direction:column;gap:4px;width:100%;padding:10px 14px;cursor:pointer;border:none;border-bottom:1px solid #f5f6f8;background:transparent;text-align:left;font:inherit;color:inherit}',
    '.push-hist-item:hover{background:#fff5f4}',
    '.push-hist-item-main{display:flex;align-items:baseline;gap:8px;min-width:0}',
    '.push-hist-lang{flex-shrink:0;font-size:11px;font-weight:600;color:#ed4c40;background:#fff5f4;border-radius:4px;padding:1px 6px}',
    '.push-hist-preview{flex:1;min-width:0;font-size:12px;color:#333;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
    '.push-hist-time{font-size:11px;color:#999}',
    '.push-hist-fab{position:fixed;right:16px;bottom:16px;z-index:40;font-size:12px;font-weight:500;color:#ed4c40;background:#fff;border:1px solid rgba(237,76,64,.35);border-radius:999px;padding:8px 14px;cursor:pointer;box-shadow:0 4px 16px rgba(0,0,0,.1)}',
    '.push-hist-fab:hover{background:#fff5f4}',
    '</style>',
    '<div id="push-hist-overlay" class="push-hist-overlay" aria-hidden="true">',
    '<div class="push-hist-card">',
    '<div class="push-hist-head"><span class="push-hist-title">历史片段</span><button type="button" id="push-hist-close" class="push-btn">关闭</button></div>',
    '<div id="push-hist-list" class="push-hist-list"></div>',
    '</div></div>',
    '<div id="push-overlay" class="push-overlay" aria-hidden="true">',
    '<div class="push-card">',
    '<div class="push-head">',
    '<span class="push-title">收到文本片段</span>',
    '<div id="push-nav" class="push-nav">',
    '<button type="button" id="push-prev" class="push-nav-btn" aria-label="上一条">‹</button>',
    '<span id="push-counter" class="push-counter"></span>',
    '<button type="button" id="push-next" class="push-nav-btn" aria-label="下一条">›</button>',
    '</div>',
    '<div class="push-head-actions"><button type="button" id="push-copy" class="push-btn">复制</button><button type="button" id="push-close" class="push-btn">关闭</button></div>',
    '</div>',
    '<pre class="push-body"><code id="push-code"></code></pre>',
    '</div></div>',
    '<script>',
    '(function(){',
    'var PUSH_URL=' + JSON.stringify(pushUrl) + ';',
    'var HLJS_URL=' + JSON.stringify(hljsUrl) + ';',
    'var HLCSS_URL=' + JSON.stringify(hlcssUrl) + ';',
    'var MAX_HIST=50;',
    'var overlay=document.getElementById("push-overlay");',
    'var codeEl=document.getElementById("push-code");',
    'var copyBtn=document.getElementById("push-copy");',
    'var closeBtn=document.getElementById("push-close");',
    'var navEl=document.getElementById("push-nav");',
    'var prevBtn=document.getElementById("push-prev");',
    'var nextBtn=document.getElementById("push-next");',
    'var counterEl=document.getElementById("push-counter");',
    'var histOverlay=document.getElementById("push-hist-overlay");',
    'var histCloseBtn=document.getElementById("push-hist-close");',
    'var history=[];var idx=-1;var fromList=false;',
    'var hljsLoading=false,hljsReady=false;',
    'function previewText(s){',
    's=String(s||"").replace(/\\s+/g," ").trim();',
    'if(s.length>80)s=s.slice(0,80)+"…";',
    'return s||"(空)";',
    '}',
    'function formatTs(ts){',
    'if(!ts)return "";',
    'var d=new Date(ts);',
    'var hh=String(d.getHours()).padStart(2,"0");',
    'var mm=String(d.getMinutes()).padStart(2,"0");',
    'return hh+":"+mm;',
    '}',
    'function langLabel(lang){return lang?lang:"文本";}',
    'function updateHistBtn(){',
    'var label=history.length?("历史片段 ("+history.length+")"):"历史片段";',
    'var btn=document.getElementById("push-hist-btn");',
    'var fab=document.getElementById("push-hist-fab");',
    'if(btn)btn.textContent=label;',
    'if(fab)fab.textContent=label;',
    '}',
    'function renderHistList(){',
    'var list=document.getElementById("push-hist-list");',
    'if(!list)return;',
    'if(!history.length){list.innerHTML=\'<div class="push-hist-empty">还没有收到片段</div>\';return;}',
    'list.innerHTML=history.map(function(item,i){',
    'return \'<button type="button" class="push-hist-item" data-idx="\'+i+\'">\'',
    '+\'<div class="push-hist-item-main"><span class="push-hist-lang"></span>\'',
    '+\'<span class="push-hist-preview"></span></div>\'',
    '+\'<div class="push-hist-time"></div></button>\';',
    '}).join("");',
    'var nodes=list.querySelectorAll(".push-hist-item");',
    'for(var i=0;i<nodes.length;i++){',
    'nodes[i].querySelector(".push-hist-lang").textContent=langLabel(history[i].lang);',
    'nodes[i].querySelector(".push-hist-preview").textContent=previewText(history[i].content);',
    'nodes[i].querySelector(".push-hist-time").textContent=formatTs(history[i].ts);',
    'nodes[i].addEventListener("click",function(){',
    'var n=+this.getAttribute("data-idx");',
    'openDetail(n,true);',
    '});',
    '}',
    '}',
    'function openHistList(){',
    'renderHistList();',
    'histOverlay.classList.add("show");',
    'histOverlay.setAttribute("aria-hidden","false");',
    '}',
    'function closeHistList(){',
    'histOverlay.classList.remove("show");',
    'histOverlay.setAttribute("aria-hidden","true");',
    '}',
    'function loadHljs(){',
    'if(hljsReady||hljsLoading)return;',
    'hljsLoading=true;',
    'var l=document.createElement("link");l.rel="stylesheet";l.href=HLCSS_URL;document.head.appendChild(l);',
    'var s=document.createElement("script");s.src=HLJS_URL;s.onload=function(){hljsReady=true;tryHl();};s.onerror=function(){hljsLoading=false;};document.head.appendChild(s);',
    '}',
    'function tryHl(){if(window.hljs&&codeEl){try{hljs.highlightElement(codeEl);}catch(e){}}}',
    'function renderCurrent(){',
    'if(idx<0||idx>=history.length)return;',
    'var item=history[idx];',
    'codeEl.textContent=item.content||"";',
    'codeEl.className=item.lang?("language-"+item.lang):"";',
    'if(history.length>1){navEl.classList.add("show");counterEl.textContent=(idx+1)+" / "+history.length;prevBtn.disabled=(idx<=0);nextBtn.disabled=(idx>=history.length-1);}else{navEl.classList.remove("show");}',
    'if(item.lang){loadHljs();if(hljsReady)tryHl();}',
    'overlay.classList.add("show");overlay.setAttribute("aria-hidden","false");',
    '}',
    'function openDetail(i,viaList){',
    'if(i<0||i>=history.length)return;',
    'idx=i;',
    'fromList=!!viaList;',
    'if(fromList)closeHistList();',
    'renderCurrent();',
    '}',
    'function closeDetail(){',
    'overlay.classList.remove("show");',
    'overlay.setAttribute("aria-hidden","true");',
    'if(fromList){fromList=false;openHistList();}',
    '}',
    'function showSnippet(raw){',
    'var data=null;try{data=JSON.parse(raw);}catch(e){return;}',
    'history.push({content:data.content||"",lang:data.lang||"",ts:data.ts||Date.now()});',
    'if(history.length>MAX_HIST)history.shift();',
    'updateHistBtn();',
    'fromList=false;',
    'closeHistList();',
    'openDetail(history.length-1,false);',
    '}',
    'function connect(){',
    'try{var es=new EventSource(PUSH_URL);es.addEventListener("snippet",function(e){showSnippet(e.data);});es.onerror=function(){try{es.close();}catch(_){}setTimeout(connect,5000);};}catch(e){setTimeout(connect,5000);}',
    '}',
    'connect();',
    'prevBtn.addEventListener("click",function(){if(idx>0){idx--;renderCurrent();}});',
    'nextBtn.addEventListener("click",function(){if(idx<history.length-1){idx++;renderCurrent();}});',
    'copyBtn.addEventListener("click",function(){',
    'var t=codeEl.textContent||"";',
    'function ok(){copyBtn.textContent="已复制";setTimeout(function(){copyBtn.textContent="复制";},1200);}',
    'function fb(){var ta=document.createElement("textarea");ta.value=t;document.body.appendChild(ta);ta.select();try{document.execCommand("copy");ok();}catch(e){}document.body.removeChild(ta);}',
    'if(navigator.clipboard&&navigator.clipboard.writeText){navigator.clipboard.writeText(t).then(ok).catch(function(){fb();});}else fb();',
    '});',
    'closeBtn.addEventListener("click",closeDetail);',
    'overlay.addEventListener("click",function(e){if(e.target===overlay)closeDetail();});',
    'if(histCloseBtn)histCloseBtn.addEventListener("click",closeHistList);',
    'if(histOverlay)histOverlay.addEventListener("click",function(e){if(e.target===histOverlay)closeHistList();});',
    'var histBtn=document.getElementById("push-hist-btn");',
    'if(histBtn){histBtn.addEventListener("click",openHistList);}else{',
    'var fab=document.createElement("button");',
    'fab.type="button";fab.id="push-hist-fab";fab.className="push-hist-fab";fab.textContent="历史片段";',
    'fab.addEventListener("click",openHistList);',
    'document.body.appendChild(fab);',
    '}',
    'updateHistBtn();',
    '})();',
    '<\/script>',
  ].join('')
}

function toolSanitizeDirName(name) {
  const raw = String(name || '').trim()
  if (!raw || /[/\\]/.test(raw)) return null
  const base = path.basename(raw)
  if (!base || base !== raw || base === '.' || base === '..') return null
  return base
}

function toolIsInside(child, parent) {
  const c = path.resolve(child)
  const p = path.resolve(parent)
  return c === p || c.startsWith(p + path.sep)
}

function toolUniquePath(dirPath, filename) {
  const base = path.basename(filename)
  if (!base || base === '.' || base === '..') return null
  let candidate = path.join(dirPath, base)
  if (!fs.existsSync(candidate)) return candidate
  const ext = path.extname(base)
  const stem = ext ? base.slice(0, -ext.length) : base
  for (let i = 1; i < 10000; i++) {
    candidate = path.join(dirPath, stem + '_' + i + ext)
    if (!fs.existsSync(candidate)) return candidate
  }
  return null
}

function toolReadRequestBody(req, limit) {
  return new Promise((resolve, reject) => {
    const chunks = []
    let size = 0
    req.on('data', (chunk) => {
      size += chunk.length
      if (size > limit) {
        const err = new Error('payload too large')
        err.code = 'LIMIT'
        reject(err)
        try { req.destroy() } catch (_) {}
        return
      }
      chunks.push(chunk)
    })
    req.on('end', () => resolve(Buffer.concat(chunks)))
    req.on('error', reject)
  })
}

function toolParseMultipart(buf, boundary) {
  const files = []
  const sep = Buffer.from('--' + boundary)
  let pos = buf.indexOf(sep)
  while (pos !== -1) {
    pos += sep.length
    if (buf[pos] === 0x2d && buf[pos + 1] === 0x2d) break
    if (buf[pos] === 0x0d) pos++
    if (buf[pos] === 0x0a) pos++
    const headerEnd = buf.indexOf('\r\n\r\n', pos)
    if (headerEnd < 0) break
    const header = buf.slice(pos, headerEnd).toString('utf8')
    const bodyStart = headerEnd + 4
    const next = buf.indexOf(sep, bodyStart)
    if (next < 0) break
    let bodyEnd = next
    if (bodyEnd >= 2 && buf[bodyEnd - 2] === 0x0d && buf[bodyEnd - 1] === 0x0a) bodyEnd -= 2
    const nameMatch = /name="([^"]*)"/i.exec(header)
    const fileMatch = /filename="([^"]*)"/i.exec(header)
    if (nameMatch && nameMatch[1] === 'file' && fileMatch && fileMatch[1]) {
      let filename = fileMatch[1]
      try { filename = decodeURIComponent(filename) } catch (_) {}
      filename = path.basename(filename.replace(/\\/g, '/'))
      if (filename && filename !== '.' && filename !== '..') {
        files.push({ filename, data: buf.slice(bodyStart, bodyEnd) })
      }
    }
    pos = next
  }
  return files
}

const TOOL_IMAGE_EXTS = new Set(['jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp', 'svg', 'ico', 'avif'])
const TOOL_VIDEO_EXTS = new Set(['mp4', 'webm', 'm4v'])
const TOOL_AUDIO_EXTS = new Set(['mp3', 'wav', 'ogg', 'm4a', 'aac'])
const TOOL_TEXT_MAX = 2 * 1024 * 1024

// 无扩展名 / 特殊文件名，按文本打开
const TOOL_TEXT_NAMES = new Set([
  'dockerfile', 'containerfile', 'makefile', 'gnumakefile', 'cmakelists.txt',
  'gemfile', 'rakefile', 'podfile', 'brewfile',
  'procfile', 'vagrantfile', 'jenkinsfile', 'fastfile',
  'license', 'licence', 'copying', 'authors', 'contributors',
  'readme', 'changelog', 'changes', 'news', 'todo', 'history',
  'gitignore', 'gitattributes', 'gitmodules', 'editorconfig',
  'npmrc', 'nvmrc', 'babelrc', 'eslintrc', 'prettierrc', 'stylelintrc',
  'dockerignore', 'eslintignore', 'prettierignore', 'npmignore',
  'htaccess', 'nginx.conf', 'apache.conf',
  'go.mod', 'go.sum', 'cargo.toml', 'cargo.lock', 'package.json', 'tsconfig.json',
])

const TOOL_TEXT_EXTS = new Set([
  // 文档 / 标记
  'txt', 'text', 'md', 'markdown', 'mdx', 'rst', 'adoc', 'asciidoc', 'org',
  'log', 'csv', 'tsv', 'rtf',
  // Web / 前端
  'html', 'htm', 'xhtml', 'css', 'scss', 'sass', 'less', 'styl',
  'js', 'mjs', 'cjs', 'jsx', 'ts', 'tsx', 'vue', 'svelte', 'astro',
  'json', 'jsonc', 'json5', 'jsonl', 'geojson',
  'xml', 'xsl', 'xsd', 'plist',
  'yml', 'yaml', 'toml', 'ini', 'cfg', 'conf', 'config', 'properties', 'env',
  // 脚本 / Shell
  'sh', 'bash', 'zsh', 'fish', 'ps1', 'psm1', 'bat', 'cmd', 'command',
  // C / C++
  'c', 'cc', 'cpp', 'cxx', 'h', 'hh', 'hpp', 'hxx', 'inl', 'ipp', 'ixx', 'tcc',
  // C# / .NET / F#
  'cs', 'csx', 'fs', 'fsx', 'fsi', 'vb', 'vbs',
  // Java / JVM
  'java', 'kt', 'kts', 'groovy', 'gradle', 'scala', 'clj', 'cljs', 'cljc', 'edn',
  // Go / Rust / Zig
  'go', 'mod', 'sum', 'rs', 'zig', 'zon',
  // Python
  'py', 'pyw', 'pyi', 'pyx', 'pxd', 'ipynb',
  // Ruby / PHP / Perl
  'rb', 'erb', 'rake', 'gemspec', 'php', 'phtml', 'pl', 'pm',
  // Swift / ObjC
  'swift', 'm', 'mm',
  // Dart
  'dart',
  // Lua / R / Julia
  'lua', 'r', 'jl',
  // Haskell / Elixir / Erlang / OCaml
  'hs', 'lhs', 'ex', 'exs', 'erl', 'hrl', 'ml', 'mli',
  // SQL / 数据
  'sql', 'ddl', 'dml', 'prisma',
  // 构建 / 工程
  'cmake', 'make', 'mak', 'ninja', 'bazel', 'bzl', 'pro', 'pri', 'sbt', 'pom',
  // 汇编 / WASM
  'asm', 's', 'nasm', 'wat',
  // IDL / API
  'proto', 'thrift', 'avsc', 'graphql', 'gql',
  // Infra
  'tf', 'tfvars', 'hcl', 'nomad', 'nix', 'dhall',
  // Diff / 其它
  'diff', 'patch', 'lock', 'http', 'rest',
  'gitignore', 'gitattributes', 'gitmodules', 'editorconfig',
  'eslintrc', 'prettierrc', 'babelrc', 'npmrc', 'nvmrc', 'dockerignore',
])

// 文件类型色点
function toolFileColor(name, isDir) {
  if (isDir) return '#5b8def'
  const ext = toolExt(name)
  const base = path.basename(name).toLowerCase()
  if (ext === 'pdf') return '#e74c3c'
  if (TOOL_IMAGE_EXTS.has(ext)) return '#27ae60'
  if (['mp4', 'mkv', 'mov', 'avi', 'wmv', 'flv', 'webm', 'm4v'].includes(ext)) return '#9b59b6'
  if (['zip', 'rar', '7z', 'tar', 'gz', 'bz2', 'xz', 'tgz'].includes(ext)) return '#e67e22'
  if (['mp3', 'flac', 'wav', 'aac', 'ogg', 'm4a', 'wma'].includes(ext)) return '#e84393'
  if (TOOL_TEXT_EXTS.has(ext) || TOOL_TEXT_NAMES.has(base) || TOOL_TEXT_NAMES.has(base.replace(/^\./, ''))) return '#95a5a6'
  return '#b0b0b0'
}

// 文件大小格式化
function toolFormatSize(b) {
  if (b < 1024) return b + 'B'
  if (b < 1024 * 1024) return (b / 1024).toFixed(1) + 'KB'
  if (b < 1024 * 1024 * 1024) return (b / 1024 / 1024).toFixed(1) + 'MB'
  return (b / 1024 / 1024 / 1024).toFixed(2) + 'GB'
}

function toolExt(name) {
  const base = path.basename(name).toLowerCase()
  if (TOOL_TEXT_NAMES.has(base)) {
    if (base.includes('.')) return base.slice(base.lastIndexOf('.') + 1)
    return base.replace(/^\./, '')
  }
  const i = base.lastIndexOf('.')
  if (i <= 0) return ''
  return base.slice(i + 1)
}

function toolFileKind(name) {
  const base = path.basename(name).toLowerCase()
  const ext = toolExt(name)
  if (TOOL_IMAGE_EXTS.has(ext)) return 'image'
  if (TOOL_VIDEO_EXTS.has(ext)) return 'video'
  if (TOOL_AUDIO_EXTS.has(ext)) return 'audio'
  if (ext === 'pdf') return 'pdf'
  if (TOOL_TEXT_NAMES.has(base) || TOOL_TEXT_EXTS.has(ext)) return 'text'
  if (base.startsWith('.')) {
    const dotName = base.slice(1)
    if (TOOL_TEXT_EXTS.has(dotName) || TOOL_TEXT_NAMES.has(dotName)) return 'text'
    if (TOOL_TEXT_EXTS.has(ext)) return 'text'
  }
  return 'other'
}

function toolMime(name) {
  const ext = toolExt(name)
  const map = {
    jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', gif: 'image/gif',
    webp: 'image/webp', bmp: 'image/bmp', svg: 'image/svg+xml',
    pdf: 'application/pdf',
    mp4: 'video/mp4', webm: 'video/webm', m4v: 'video/mp4',
    mp3: 'audio/mpeg', wav: 'audio/wav', ogg: 'audio/ogg',
    m4a: 'audio/mp4', aac: 'audio/aac',
    txt: 'text/plain; charset=utf-8', md: 'text/markdown; charset=utf-8',
    markdown: 'text/markdown; charset=utf-8', json: 'application/json; charset=utf-8',
    js: 'text/javascript; charset=utf-8', mjs: 'text/javascript; charset=utf-8',
    cjs: 'text/javascript; charset=utf-8', ts: 'text/plain; charset=utf-8',
    css: 'text/css; charset=utf-8', html: 'text/html; charset=utf-8',
    htm: 'text/html; charset=utf-8', xml: 'application/xml; charset=utf-8',
    csv: 'text/csv; charset=utf-8',
  }
  if (map[ext]) return map[ext]
  if (TOOL_TEXT_EXTS.has(ext)) return 'text/plain; charset=utf-8'
  return 'application/octet-stream'
}

function toolEscHtml(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

function toolParentHref(relFile) {
  const parts = relFile.split(/[/\\]/).filter(Boolean)
  if (parts.length <= 1) return '/'
  return '/' + parts.slice(0, -1).join('/')
}

function toolImageNeighbors(dirPath, fileName) {
  let names = []
  try {
    names = fs.readdirSync(dirPath).filter((n) => {
      try {
        const st = fs.statSync(path.join(dirPath, n))
        return st.isFile() && toolFileKind(n) === 'image'
      } catch (_) {
        return false
      }
    })
  } catch (_) {
    return { prev: null, next: null }
  }
  names.sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base', numeric: true }))
  const i = names.indexOf(fileName)
  if (i < 0) return { prev: null, next: null }
  return {
    prev: i > 0 ? names[i - 1] : null,
    next: i < names.length - 1 ? names[i + 1] : null,
  }
}

function toolHrefEncode(href) {
  if (!href || href === '/') return '/'
  return '/' + String(href).split('/').filter(Boolean).map(encodeURIComponent).join('/')
}

function toolPublicPath(href) {
  return toolHrefEncode(href)
}

function toolWithToken(href, token) {
  return toolPublicPath(href)
}

/** 修正二维码/分享 URL（去除 ".http://"、"/.http:/" 等误拼接） */
function toolSanitizeQrUrl(raw) {
  let u = String(raw || '').trim()
  if (!u) return u
  const pickScheme = u.match(/^[\s./\\]*(https?:\/{1,2}.+)$/i)
  if (pickScheme) u = pickScheme[1]
  u = u.replace(/^(https?):\/(?!\/)/i, '$1://')
  u = u.replace(/^\.+(?=https?:\/\/)/i, '')
  const badScheme = u.match(/^\/+\.?(https?):\/([^?#]*)(\?[^#]*)?$/i)
  if (badScheme) {
    u = badScheme[1] + '://' + badScheme[2] + (badScheme[3] || '')
  }
  const rel = u.match(/^\/+\.?(https?:\/\/.+)$/i)
  if (rel) u = rel[1]
  const embedAt = u.search(/\/\.?(https?):\/[^?#]/)
  if (embedAt > 0 && /^https?:\/\//i.test(u.slice(0, embedAt))) {
    const tail = u.slice(embedAt)
    const m = tail.match(/^\/+\.?(https?):\/([^?#]*)(\?[^#]*)?$/)
    if (m) u = m[1] + '://' + m[2] + (m[3] || '')
  }
  return u
}

function toolNormalizeUrlPath(pathname) {
  let p = pathname || '/'
  try { p = decodeURIComponent(p) } catch (_) {}
  const parts = String(p).split('/').filter(Boolean)
  const out = []
  for (const seg of parts) {
    if (seg === '.') continue
    if (seg === '..') {
      if (out.length) out.pop()
      continue
    }
    out.push(seg)
  }
  return out.length ? '/' + out.join('/') : '/'
}

function toolHighlightLang(name) {
  const ext = toolExt(name)
  const map = {
    js: 'javascript', mjs: 'javascript', cjs: 'javascript',
    ts: 'typescript', tsx: 'typescript', jsx: 'javascript',
    json: 'json', md: 'markdown', markdown: 'markdown',
    css: 'css', scss: 'scss', less: 'less',
    html: 'xml', htm: 'xml', xml: 'xml', svg: 'xml',
    py: 'python', rb: 'ruby', go: 'go', rs: 'rust',
    java: 'java', kt: 'kotlin', c: 'c', h: 'c',
    cpp: 'cpp', cc: 'cpp', cxx: 'cpp', hpp: 'cpp',
    cs: 'csharp', php: 'php', sh: 'bash', bash: 'bash',
    zsh: 'bash', yml: 'yaml', yaml: 'yaml', toml: 'ini',
    ini: 'ini', conf: 'ini', sql: 'sql', vue: 'xml',
  }
  return map[ext] || ''
}

function renderFilePreview(opts) {
  const name = opts.name
  const parentHref = opts.parentHref
  const downloadHref = opts.downloadHref
  const rawHref = opts.rawHref
  const kind = opts.kind
  const body = opts.body || ''
  const truncated = !!opts.truncated
  const prevHref = opts.prevHref || ''
  const nextHref = opts.nextHref || ''
  const esc = toolEscHtml
  const tHref = (href) => toolPublicPath(href)
  const pushUrl = '/__push__'
  const css = [
    '*{box-sizing:border-box}',
    'body{font-family:-apple-system,BlinkMacSystemFont,system-ui,sans-serif;margin:0;background:#f3f4f6;color:#1a1a1a}',
    '.header{background:#fff;border-bottom:1px solid #e8eaed;position:sticky;top:0;z-index:10}',
    '.back-bar{display:flex;align-items:center;gap:8px;padding:12px 20px;border-bottom:1px solid #f0f1f3;color:#ed4c40;text-decoration:none;font-size:14px;font-weight:500;line-height:1.4;background:#fff}',
    '.back-bar:hover,.back-bar:active{background:#fff5f4}',
    '.back-arrow{font-size:16px;line-height:1;flex-shrink:0}',
    '.header-body{padding:12px 20px 14px;display:flex;align-items:flex-start;gap:12px;flex-wrap:wrap}',
    '.header-body h2{margin:0;flex:1;min-width:0;font-size:15px;font-weight:600;word-break:break-word;overflow-wrap:anywhere;line-height:1.4}',
    '.header-actions{display:flex;flex-wrap:wrap;gap:8px;align-items:center}',
    '.dl,.nav-btn,.copy-btn{flex-shrink:0;font-size:13px;font-weight:500;color:#ed4c40;text-decoration:none;padding:6px 12px;border:1px solid rgba(237,76,64,.35);border-radius:8px;background:#fff;cursor:pointer}',
    '.dl:hover,.nav-btn:hover,.copy-btn:hover{background:#fff5f4}',
    '.nav-btn.disabled{opacity:.35;pointer-events:none}',
    '.wrap{max-width:960px;margin:16px auto;padding:0 12px 32px}',
    '.card{background:#fff;border:1px solid #e8eaed;border-radius:12px;padding:16px;overflow:auto}',
    '.preview-img{display:block;max-width:100%;height:auto;margin:0 auto}',
    '.preview-video{display:block;width:100%;max-height:calc(100vh - 180px);background:#111;border-radius:8px}',
    '.preview-audio{display:block;width:100%;margin:8px 0}',
    '.img-nav{display:flex;justify-content:space-between;gap:12px;margin-top:14px}',
    '.code-wrap{display:flex;align-items:stretch;overflow:auto;max-height:calc(100vh - 160px);border-radius:8px;background:#fafbfc;border:1px solid #f0f1f3}',
    '.gutter{flex-shrink:0;padding:12px 0;background:#f3f4f6;color:#aaa;font-family:ui-monospace,SFMono-Regular,Menlo,Monaco,Consolas,monospace;font-size:12px;line-height:1.6;text-align:right;user-select:none;border-right:1px solid #e8eaed;min-width:3em}',
    '.gutter span{display:block;padding:0 10px}',
    '.code-main{flex:1;min-width:0;margin:0;padding:12px 14px;overflow:auto;font-family:ui-monospace,SFMono-Regular,Menlo,Monaco,Consolas,monospace;font-size:12px;line-height:1.6;white-space:pre;tab-size:2;color:#222;background:transparent}',
    '.code-main code{font-family:inherit;font-size:inherit;background:transparent;padding:0}',
    '.preview-pre{margin:0;font-family:ui-monospace,SFMono-Regular,Menlo,Monaco,Consolas,monospace;font-size:12px;line-height:1.6;white-space:pre-wrap;word-break:break-word;color:#222}',
    '.tip{margin:0 0 12px;padding:8px 12px;border-radius:8px;background:#fff8e6;color:#8a6d1d;font-size:12px}',
    '.copy-toast{display:none;position:fixed;left:50%;bottom:24px;transform:translateX(-50%);background:rgba(0,0,0,.78);color:#fff;font-size:13px;padding:8px 14px;border-radius:8px;z-index:50}',
    '.copy-toast.show{display:block}',
    '@media(max-width:600px){.back-bar,.header-body,.wrap{padding-left:14px;padding-right:14px}}',
  ].join('')
  let content = ''
  let extraHead = ''
  let extraScript = ''
  const actions = []
  if (kind === 'image') {
    if (prevHref) actions.push(`<a class="nav-btn" id="prev-btn" href="${esc(prevHref)}">上一张</a>`)
    if (nextHref) actions.push(`<a class="nav-btn" id="next-btn" href="${esc(nextHref)}">下一张</a>`)
    actions.push(`<a class="dl" href="${esc(downloadHref)}">下载</a>`)
    content = `<img class="preview-img" src="${esc(rawHref)}" alt="${esc(name)}" />`
      + `<div class="img-nav">${prevHref ? `<a class="nav-btn" href="${esc(prevHref)}">← 上一张</a>` : '<span></span>'}${nextHref ? `<a class="nav-btn" href="${esc(nextHref)}">下一张 →</a>` : '<span></span>'}</div>`
    extraScript = [
      '(function(){',
      'document.addEventListener("keydown",function(e){',
      'if(e.key==="ArrowLeft"){var a=document.getElementById("prev-btn");if(a)location.href=a.href;}',
      'if(e.key==="ArrowRight"){var b=document.getElementById("next-btn");if(b)location.href=b.href;}',
      '});',
      '})();',
    ].join('')
  } else if (kind === 'video') {
    actions.push(`<a class="dl" href="${esc(downloadHref)}">下载</a>`)
    content = `<video class="preview-video" controls playsinline preload="metadata" src="${esc(rawHref)}">您的浏览器不支持视频播放</video>`
  } else if (kind === 'audio') {
    actions.push(`<a class="dl" href="${esc(downloadHref)}">下载</a>`)
    content = `<audio class="preview-audio" controls preload="metadata" src="${esc(rawHref)}">您的浏览器不支持音频播放</audio>`
  } else {
    actions.push('<button type="button" class="copy-btn" id="copy-btn">复制全文</button>')
    actions.push(`<a class="dl" href="${esc(downloadHref)}">下载</a>`)
    const lang = toolHighlightLang(name)
    const lines = String(body).split('\n')
    const gutter = lines.map((_, i) => `<span>${i + 1}</span>`).join('')
    const langClass = lang ? ` language-${lang}` : ''
    content = (truncated ? '<div class="tip">文件过大，已截断显示前 2MB</div>' : '')
      + `<div class="code-wrap"><div class="gutter" aria-hidden="true">${gutter}</div><pre class="code-main"><code id="code-body" class="${langClass.trim()}">${esc(body)}</code></pre></div>`
      + '<div id="copy-toast" class="copy-toast">已复制</div>'
    extraHead = [
      '<link rel="stylesheet" href="https://cdn.jsdelivr.net/gh/highlightjs/cdn-release@11.9.0/build/styles/github.min.css">',
      '<script src="https://cdn.jsdelivr.net/gh/highlightjs/cdn-release@11.9.0/build/highlight.min.js"><\/script>',
    ].join('')
    extraScript = [
      '(function(){',
      'var raw=' + JSON.stringify(body) + ';',
      'var btn=document.getElementById("copy-btn");',
      'var toast=document.getElementById("copy-toast");',
      'function showToast(){if(!toast)return;toast.classList.add("show");setTimeout(function(){toast.classList.remove("show");},1200);}',
      'function copyText(){',
      'if(navigator.clipboard&&navigator.clipboard.writeText){',
      'navigator.clipboard.writeText(raw).then(showToast).catch(function(){fallback();});',
      '}else fallback();',
      '}',
      'function fallback(){',
      'var ta=document.createElement("textarea");ta.value=raw;document.body.appendChild(ta);ta.select();',
      'try{document.execCommand("copy");showToast();}catch(e){}',
      'document.body.removeChild(ta);',
      '}',
      'if(btn)btn.addEventListener("click",copyText);',
      'function tryHl(){',
      'var el=document.getElementById("code-body");',
      'if(window.hljs&&el){try{hljs.highlightElement(el);}catch(e){}}',
      '}',
      'tryHl();',
      '})();',
    ].join('')
  }
  actions.push('<button type="button" class="copy-btn" id="push-hist-btn">历史片段</button>')
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(name)}</title><style>${css}</style>${extraHead}</head><body><div class="header"><a class="back-bar" href="${tHref(parentHref)}"><span class="back-arrow">←</span><span>返回上一层</span></a><div class="header-body"><h2>${esc(name)}</h2><div class="header-actions">${actions.join('')}</div></div></div><div class="wrap"><div class="card">${content}</div></div>${extraScript ? `<script>${extraScript}</script>` : ''}${toolPushClientBlock(pushUrl)}</body></html>`
}

function toolParseByteRange(rangeHeader, size) {
  if (!rangeHeader || size <= 0) return null
  // 仅支持单段：bytes=start-end / bytes=start- / bytes=-suffix
  const m = /^bytes=(\d*)-(\d*)$/i.exec(String(rangeHeader).trim().split(',')[0].trim())
  if (!m) return { error: true }
  const hasStart = m[1] !== ''
  const hasEnd = m[2] !== ''
  if (!hasStart && !hasEnd) return { error: true }
  let start
  let end
  if (!hasStart) {
    const suffix = parseInt(m[2], 10)
    if (!Number.isFinite(suffix) || suffix <= 0) return { error: true }
    start = Math.max(0, size - suffix)
    end = size - 1
  } else {
    start = parseInt(m[1], 10)
    end = hasEnd ? parseInt(m[2], 10) : size - 1
    if (!Number.isFinite(start) || !Number.isFinite(end)) return { error: true }
  }
  if (start < 0 || start >= size || end < start) return { error: true }
  end = Math.min(end, size - 1)
  return { start, end, length: end - start + 1 }
}

function toolPipeFile(req, res, fsPath, fstats, reqUrl, mime, disposition, logKind) {
  const size = fstats.size
  const kind = logKind || (disposition === 'attachment' ? 'download' : 'preview')
  res.setHeader('content-type', mime)
  res.setHeader('content-disposition', `${disposition}; filename="${encodeURIComponent(path.basename(fsPath))}"`)
  res.setHeader('Accept-Ranges', 'bytes')

  let start = 0
  let end = size > 0 ? size - 1 : 0
  let length = size
  let status = 200

  if (req.headers.range) {
    const parsed = toolParseByteRange(req.headers.range, size)
    if (!parsed || parsed.error) {
      res.statusCode = 416
      res.setHeader('Content-Range', `bytes */${size}`)
      res.end()
      toolPushLog(req, reqUrl, 416, kind)
      return
    }
    start = parsed.start
    end = parsed.end
    length = parsed.length
    status = 206
    res.statusCode = 206
    res.setHeader('Content-Range', `bytes ${start}-${end}/${size}`)
  }

  if (length >= 0) res.setHeader('content-length', length)

  if (req.method === 'HEAD') {
    res.statusCode = status
    res.end()
    toolPushLog(req, reqUrl, status, kind)
    return
  }

  const stream = size > 0
    ? fs.createReadStream(fsPath, status === 206 ? { start, end } : undefined)
    : fs.createReadStream(fsPath)
  stream.on('error', () => {
    if (!res.headersSent) {
      res.statusCode = 500
      res.end('500 Read Error')
    } else {
      res.destroy()
    }
  })
  stream.pipe(res)
  res.on('finish', () => {
    if (res.statusCode === 200 || res.statusCode === 206) {
      toolServerStats.files++
      toolServerStats.bytes += length
    }
    toolPushLog(req, reqUrl, res.statusCode, kind)
  })
}

// 渲染目录列表 HTML
function renderDirList(fsPath, dir, entries) {
  const relBaseRaw = path.relative(dir, fsPath)
  const relBase = relBaseRaw && relBaseRaw !== '.' ? relBaseRaw : ''
  const titleName = path.basename(fsPath) || fsPath
  const parts = relBase ? relBase.split(/[/\\]/).filter(Boolean) : []
  const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
  const canManage = !!toolServerManageEnabled
  const tHref = (href) => toolPublicPath(href)
  const pushUrl = '/__push__'

  let crumbHtml = parts.length === 0
    ? '<span class="crumb-cur">根目录</span>'
    : `<a href="${tHref('/')}">根目录</a>`
  let acc = ''
  parts.forEach((p, i) => {
    acc += (acc ? '/' : '') + p
    const sep = ' <span class="sep">/</span> '
    if (i === parts.length - 1) {
      crumbHtml += sep + `<span class="crumb-cur">${esc(p)}</span>`
    } else {
      crumbHtml += sep + `<a href="${tHref('/' + acc)}">${esc(p)}</a>`
    }
  })

  const rows = entries.map(en => {
    const isDir = en.isDirectory()
    const full = path.join(fsPath, en.name)
    let sizeLabel = '—'
    let sizeNum = 0
    let mtimeLabel = '—'
    let mtimeNum = 0
    try {
      const st = fs.statSync(full)
      sizeNum = isDir ? -1 : st.size
      sizeLabel = isDir ? '—' : toolFormatSize(st.size)
      mtimeNum = st.mtimeMs || 0
      const d = new Date(mtimeNum)
      mtimeLabel = String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0') + ' ' + String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0')
    } catch (_) {}
    let empty = false
    if (isDir) {
      try {
        empty = fs.readdirSync(full).length === 0
      } catch (_) {
        empty = false
      }
    }
    const href = toolNormalizeUrlPath('/' + path.relative(dir, full).split(path.sep).join('/'))
    const color = toolFileColor(en.name, isDir)
    const encHref = tHref(href)
    const isImage = !isDir && toolFileKind(en.name) === 'image'
    return {
      isDir,
      isImage,
      empty,
      name: en.name,
      sizeLabel,
      sizeNum,
      mtimeLabel,
      mtimeNum,
      color,
      encHref,
    }
  })

  // 默认：文件夹优先，再按名称升序
  rows.sort((a, b) => {
    if (a.isDir !== b.isDir) return a.isDir ? -1 : 1
    return a.name.localeCompare(b.name, undefined, { sensitivity: 'base', numeric: true })
  })

  const imageList = []
  const items = rows.map(r => {
    let linkClass = ''
    let dataIdx = ''
    if (r.isImage) {
      const idx = imageList.length
      imageList.push({
        name: r.name,
        href: r.encHref,
        raw: r.encHref + '?raw=1',
        download: r.encHref + '?download=1',
      })
      linkClass = ' class="file-img"'
      dataIdx = ` data-idx="${idx}"`
    }
    let opsCell = ''
    if (canManage) {
      if (!r.isDir) {
        opsCell = `<td class="ops"><div class="ops-btns"><button type="button" class="op-btn op-rename" data-name="${esc(r.name)}">重命名</button><button type="button" class="op-btn op-del" data-name="${esc(r.name)}" data-kind="file">删除</button></div></td>`
      } else if (r.empty) {
        opsCell = `<td class="ops"><div class="ops-btns"><button type="button" class="op-btn op-del" data-name="${esc(r.name)}" data-kind="dir">删除</button></div></td>`
      } else {
        opsCell = '<td class="ops"><span class="ops-na">—</span></td>'
      }
    }
    return `<tr data-name="${encodeURIComponent(r.name.toLowerCase())}" data-size="${r.sizeNum}" data-mtime="${r.mtimeNum}" data-dir="${r.isDir ? 1 : 0}" data-empty="${r.isDir && r.empty ? 1 : 0}"><td><span class="dot" style="background:${r.color}"></span><a href="${r.encHref}"${linkClass}${dataIdx}>${esc(r.name)}${r.isDir ? '/' : ''}</a></td><td>${r.sizeLabel}</td><td>${r.mtimeLabel}</td>${opsCell}</tr>`
  }).join('')

  // 移动端卡片：与表格共用 data-*，图片索引与表格一致（imageList 已在上一步填好）
  let imageIdx = 0
  const cards = rows.map(r => {
    let linkClass = 'file-card-main'
    let dataIdx = ''
    if (r.isImage) {
      linkClass += ' file-img'
      dataIdx = ` data-idx="${imageIdx++}"`
    }
    const meta = r.isDir ? r.mtimeLabel : `${r.sizeLabel} · ${r.mtimeLabel}`
    let more = ''
    if (canManage) {
      const menuBtns = []
      if (!r.isDir) {
        menuBtns.push(`<button type="button" class="op-rename" data-name="${esc(r.name)}">重命名</button>`)
        menuBtns.push(`<button type="button" class="op-del" data-name="${esc(r.name)}" data-kind="file">删除</button>`)
      } else if (r.empty) {
        menuBtns.push(`<button type="button" class="op-del" data-name="${esc(r.name)}" data-kind="dir">删除</button>`)
      }
      if (menuBtns.length) {
        more = `<div class="file-card-more"><button type="button" class="more-btn" aria-label="更多">⋯</button><div class="more-menu">${menuBtns.join('')}</div></div>`
      }
    }
    return `<div class="file-card" data-name="${encodeURIComponent(r.name.toLowerCase())}" data-size="${r.sizeNum}" data-mtime="${r.mtimeNum}" data-dir="${r.isDir ? 1 : 0}" data-empty="${r.isDir && r.empty ? 1 : 0}"><a class="${linkClass}" href="${r.encHref}"${dataIdx}><span class="dot" style="background:${r.color}"></span><span class="file-card-text"><span class="file-card-name">${esc(r.name)}${r.isDir ? '/' : ''}</span><span class="file-card-meta">${meta}</span></span><span class="file-card-chev" aria-hidden="true">›</span></a>${more}</div>`
  }).join('')

  const parentSegs = relBase ? relBase.split(/[/\\]/).filter(Boolean) : []
  const parentHref = parentSegs.length > 1
    ? '/' + parentSegs.slice(0, -1).join('/')
    : '/'
  const backBar = relBase
    ? `<a class="back-bar" href="${tHref(parentHref)}"><span class="back-arrow">←</span><span class="back-text">返回上一层</span></a>`
    : ''

  const css = [
    '*{box-sizing:border-box}',
    'body{font-family:-apple-system,BlinkMacSystemFont,system-ui,sans-serif;margin:0;background:linear-gradient(180deg,#f6f7f9 0%,#eef0f3 100%);color:#1a1a1a;min-height:100vh}',
    '.header{background:#fff;border-bottom:1px solid #e8eaed;position:sticky;top:0;z-index:10}',
    '.back-bar{display:flex;align-items:center;gap:8px;padding:12px 20px;border-bottom:1px solid #f0f1f3;color:#ed4c40;text-decoration:none;font-size:14px;font-weight:500;line-height:1.4;background:#fff}',
    '.back-bar:active,.back-bar:hover{background:#fff5f4}',
    '.back-arrow{font-size:16px;line-height:1;flex-shrink:0}',
    '.back-text{flex:1;min-width:0}',
    '.header-body{padding:12px 20px 14px}',
    '.header h2{margin:0;font-size:15px;font-weight:600;color:#1a1a1a;word-break:break-word;overflow-wrap:anywhere;line-height:1.4}',
    '.crumbs-row{display:flex;flex-wrap:wrap;align-items:center;gap:8px 12px;margin-top:8px}',
    '.crumbs{flex:1;min-width:140px;font-size:12px;color:#999;word-break:break-word;overflow-wrap:anywhere;line-height:1.55}',
    '.crumb-actions{display:flex;flex-wrap:wrap;align-items:center;gap:6px;margin-left:auto}',
    '.crumb-actions button{font-size:12px;font-weight:500;color:#ed4c40;background:#fff;border:1px solid rgba(237,76,64,.35);border-radius:8px;padding:5px 10px;cursor:pointer;line-height:1.2;white-space:nowrap}',
    '.crumb-actions button:hover{background:#fff5f4}',
    '.crumb-actions button:disabled{opacity:.5;cursor:not-allowed}',
    '.crumb-actions button.crumb-primary{color:#fff;background:#ed4c40;border-color:#ed4c40}',
    '.crumb-actions button.crumb-primary:hover{opacity:.92}',
    '#upload-input{display:none}',
    '.upload-toast{display:none;position:fixed;left:50%;bottom:24px;transform:translateX(-50%);z-index:80;max-width:min(90vw,420px);padding:8px 14px;border-radius:8px;font-size:13px;line-height:1.4;box-shadow:0 8px 24px rgba(0,0,0,.12)}',
    '.upload-toast.show{display:block}',
    '.upload-toast.ok{background:#e8f8ef;color:#0f7a45}',
    '.upload-toast.err{background:#fdecea;color:#c0392b}',
    'body.drag-upload{outline:3px solid rgba(237,76,64,.45);outline-offset:-3px}',
    'body.drag-upload::after{content:"松开以上传到当前文件夹";position:fixed;left:50%;top:50%;transform:translate(-50%,-50%);z-index:90;background:rgba(237,76,64,.92);color:#fff;font-size:14px;font-weight:600;padding:12px 18px;border-radius:12px;pointer-events:none;box-shadow:0 12px 40px rgba(0,0,0,.2)}',
    '.crumbs a{color:#ed4c40;text-decoration:none}',
    '.crumbs a:hover{text-decoration:underline}',
    '.crumbs .sep{color:#ccc;margin:0 2px}',
    '.crumbs .crumb-cur{color:#666}',
    '.wrap{max-width:900px;margin:12px auto;padding:0 12px 24px}',
    '.card{background:#fff;border:1px solid #e8eaed;border-radius:12px;overflow:visible;box-shadow:0 1px 3px rgba(0,0,0,.04)}',
    '.toolbar{display:flex;align-items:center;gap:8px;padding:12px 14px;border-bottom:1px solid #f0f1f3;background:#fafbfc}',
    '.search-wrap{position:relative;flex:1;min-width:0}',
    '.search-wrap input{width:100%;box-sizing:border-box;font-size:16px;padding:10px 36px 10px 12px;border:1px solid #d0d5dd;border-radius:10px;outline:none;background:#fff;transition:border-color .15s,box-shadow .15s}',
    '.search-wrap input:focus{border-color:#ed4c40;box-shadow:0 0 0 3px rgba(237,76,64,.12)}',
    '.search-clear{position:absolute;right:6px;top:50%;transform:translateY(-50%);border:none;background:transparent;color:#999;font-size:18px;line-height:1;padding:4px 8px;cursor:pointer;border-radius:6px}',
    '.search-clear:hover{color:#666;background:#f0f1f3}',
    '.sort-mobile{display:none;flex-shrink:0;font-size:13px;padding:9px 10px;border:1px solid #d0d5dd;border-radius:10px;background:#fff;color:#444}',
    '.filter-empty{display:none;text-align:center;padding:28px 16px;color:#999;font-size:13px}',
    '.filter-empty.show{display:block}',
    '.filter-empty button{margin-left:8px;border:none;background:transparent;color:#ed4c40;font-size:13px;cursor:pointer}',
    '.view-cards{display:none}',
    '.file-list{display:flex;flex-direction:column;gap:8px;padding:12px}',
    '.file-card{display:flex;align-items:stretch;background:#fff;border:1px solid #e8eaed;border-radius:12px;box-shadow:0 1px 2px rgba(0,0,0,.04);overflow:visible;animation:cardIn .15s ease}',
    '@keyframes cardIn{from{opacity:0;transform:translateY(4px)}to{opacity:1;transform:none}}',
    '.file-card-main{flex:1;display:flex;align-items:center;gap:10px;padding:14px 12px;text-decoration:none;color:#1a1a1a;min-width:0;border-radius:12px}',
    '.file-card-main:active{background:#f7f7f8}',
    '.file-card-text{flex:1;min-width:0}',
    '.file-card-name{display:block;font-size:14px;font-weight:600;word-break:break-word;overflow-wrap:anywhere;line-height:1.35}',
    '.file-card-meta{display:block;margin-top:4px;font-size:12px;color:#999;line-height:1.3}',
    '.file-card-chev{color:#ccc;font-size:18px;flex-shrink:0;line-height:1}',
    '.file-card-more{position:relative;flex-shrink:0;display:flex;align-items:center;border-left:1px solid #f0f1f3}',
    '.more-btn{border:none;background:transparent;padding:0 14px;height:100%;min-height:56px;font-size:20px;color:#888;cursor:pointer;line-height:1}',
    '.more-btn:active{background:#f7f7f8}',
    '.more-menu{display:none;position:absolute;right:8px;top:calc(100% - 8px);background:#fff;border:1px solid #e8eaed;border-radius:10px;box-shadow:0 8px 24px rgba(0,0,0,.12);min-width:128px;z-index:20;overflow:hidden}',
    '.file-card-more.open .more-menu{display:block}',
    '.more-menu button{display:block;width:100%;text-align:left;border:none;background:#fff;padding:11px 14px;font-size:13px;cursor:pointer;color:#1a1a1a}',
    '.more-menu button:hover,.more-menu button:active{background:#fafbfc}',
    '.more-menu .op-del{color:#c0392b}',
    'table{width:100%;border-collapse:collapse;table-layout:auto}',
    'th{background:#fafbfc;font-size:11px;font-weight:500;color:#aaa;letter-spacing:.03em;user-select:none}',
    'th.sortable{cursor:pointer;transition:color .15s ease}',
    'th.sortable:hover{color:#666}',
    'th.sortable .arrow{display:inline-block;margin-left:4px;opacity:.35;font-size:10px}',
    'th.sortable.active{color:#ed4c40}',
    'th.sortable.active .arrow{opacity:1}',
    'th,td{padding:11px 16px;text-align:left;border-bottom:1px solid #f5f5f5;vertical-align:middle}',
    'tr:last-child td{border-bottom:none}',
    'tr:hover td{background:#fafbfc}',
    'th:nth-child(1),td:nth-child(1){width:auto}',
    'th:nth-child(2),td:nth-child(2){text-align:right;white-space:nowrap;font-size:12px;color:#666;width:1%}',
    'th:nth-child(3),td:nth-child(3){text-align:right;white-space:nowrap;font-size:12px;color:#999;width:1%}',
    'th:nth-child(2).sortable,th:nth-child(3).sortable{text-align:right}',
    'td a{color:#1a1a1a;text-decoration:none;font-size:13px;font-weight:500;word-break:break-word;overflow-wrap:anywhere}',
    'td a:hover{color:#ed4c40}',
    '.dot{display:inline-block;width:8px;height:8px;border-radius:50%;margin-right:10px;vertical-align:middle;flex-shrink:0}',
    '.file-card-main .dot{margin-right:0}',
    '.empty{text-align:center;padding:40px;color:#ccc;font-size:13px}',
    'td.ops{white-space:nowrap;text-align:right;width:1%;vertical-align:middle}',
    '.ops-na{color:#ccc;font-size:12px}',
    '.ops-btns{display:inline-flex;flex-direction:column;align-items:stretch;gap:4px}',
    '.op-btn{font-size:12px;font-weight:500;color:#ed4c40;background:#fff;border:1px solid rgba(237,76,64,.35);padding:6px 10px;cursor:pointer;border-radius:8px;line-height:1.2;white-space:nowrap}',
    '.op-btn:hover{background:#fff5f4}',
    '.op-btn.op-del{color:#c0392b;border-color:rgba(192,57,43,.35)}',
    '.manage-note{padding:8px 20px;font-size:11px;color:#aaa;border-bottom:1px solid #f0f1f3;background:#fafbfc}',
    '.dlg{display:none;position:fixed;inset:0;z-index:120;background:rgba(0,0,0,.45);align-items:center;justify-content:center;padding:16px}',
    '.dlg.show{display:flex}',
    '.dlg-card{width:100%;max-width:360px;background:#fff;border-radius:14px;padding:16px;box-shadow:0 12px 40px rgba(0,0,0,.18)}',
    '.dlg-title{margin:0 0 12px;font-size:15px;font-weight:600;color:#1a1a1a}',
    '.dlg-input{width:100%;box-sizing:border-box;font-size:16px;padding:10px 12px;border:1px solid #d0d5dd;border-radius:10px;outline:none}',
    '.dlg-input:focus{border-color:#ed4c40;box-shadow:0 0 0 3px rgba(237,76,64,.12)}',
    '.dlg-actions{display:flex;justify-content:flex-end;gap:8px;margin-top:14px}',
    '.dlg-actions button{font-size:14px;font-weight:500;padding:8px 14px;border-radius:8px;border:1px solid #d0d5dd;background:#fff;cursor:pointer}',
    '.dlg-actions .dlg-ok{color:#fff;background:#ed4c40;border-color:#ed4c40}',
    '.lb{display:none;position:fixed;inset:0;z-index:100;background:rgba(0,0,0,.82);align-items:center;justify-content:center;padding:16px}',
    '.lb.show{display:flex}',
    '.lb-inner{position:relative;max-width:min(960px,100%);max-height:100%;display:flex;flex-direction:column;align-items:center;gap:10px}',
    '.lb-inner img{max-width:100%;max-height:calc(100vh - 100px);object-fit:contain;border-radius:8px;background:#111}',
    '.lb-bar{display:flex;flex-wrap:wrap;gap:8px;justify-content:center;align-items:center}',
    '.lb-bar button,.lb-bar a{font-size:13px;font-weight:500;color:#fff;background:rgba(255,255,255,.14);border:1px solid rgba(255,255,255,.25);border-radius:8px;padding:7px 12px;cursor:pointer;text-decoration:none}',
    '.lb-bar button:disabled{opacity:.35;cursor:not-allowed}',
    '.lb-name{color:#eee;font-size:13px;max-width:80vw;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;text-align:center}',
    '@media(max-width:720px){.view-table{display:none}.view-cards{display:block}.sort-mobile{display:block}.back-bar,.header-body,.manage-note,.toolbar{padding-left:14px;padding-right:14px}}',
    '@media(min-width:721px){.view-table{display:block}.view-cards{display:none}}',
  ].join('')

  const curHref = relBase ? toolNormalizeUrlPath('/' + relBase.split(/[/\\]/).join('/')) : '/'
  const canUpload = !!(toolServerUploadEnabled && toolServerUploadDir && toolIsInside(fsPath, toolServerUploadDir))
  const uploadAction = tHref(curHref)

  const sortJs = [
    '(function(){',
    'var key="name",dir=1;',
    'var ths=document.querySelectorAll("th.sortable");',
    'var search=document.getElementById("dir-search");',
    'var clearBtn=document.getElementById("search-clear");',
    'var sortMobile=document.getElementById("sort-mobile");',
    'var filterEmpty=document.getElementById("filter-empty");',
    'var filterClear=document.getElementById("filter-empty-clear");',
    'function collect(){',
    'return{',
    'rows:[].slice.call(document.querySelectorAll(".view-table tbody tr[data-name]")),',
    'cards:[].slice.call(document.querySelectorAll(".file-card[data-name]")),',
    '};',
    '}',
    'function cmp(a,b,k,d){',
    'var da=+a.getAttribute("data-dir"),db=+b.getAttribute("data-dir");',
    'if(da!==db)return db-da;',
    'var va=a.getAttribute("data-"+k),vb=b.getAttribute("data-"+k);',
    'if(k==="name"){',
    'return d*decodeURIComponent(va).localeCompare(decodeURIComponent(vb),undefined,{sensitivity:"base",numeric:true});',
    '}',
    'return d*((+va)-(+vb));',
    '}',
    'function paintTh(){',
    'ths.forEach(function(th){',
    'var on=th.getAttribute("data-key")===key;',
    'th.classList.toggle("active",on);',
    'var a=th.querySelector(".arrow");',
    'if(a)a.textContent=on?(dir>0?"\\u25B2":"\\u25BC"):"\\u25B2";',
    '});',
    'if(sortMobile)sortMobile.value=key+":"+dir;',
    '}',
    'function sortBoth(k,d){',
    'key=k;dir=d;',
    'var x=collect();',
    'var tb=document.querySelector(".view-table tbody");',
    'var list=document.querySelector(".file-list");',
    'x.rows.sort(function(a,b){return cmp(a,b,key,dir);}).forEach(function(r){if(tb)tb.appendChild(r);});',
    'x.cards.sort(function(a,b){return cmp(a,b,key,dir);}).forEach(function(c){if(list)list.appendChild(c);});',
    'paintTh();',
    '}',
    'function sortBy(k){',
    'if(key===k)dir=-dir;else{key=k;dir=1;}',
    'sortBoth(key,dir);',
    '}',
    'function applyFilter(q){',
    'q=(q||"").trim().toLowerCase();',
    'var n=0;',
    'function hit(el){',
    'var name=decodeURIComponent(el.getAttribute("data-name")||"");',
    'var ok=!q||name.indexOf(q)!==-1;',
    'el.style.display=ok?"":"none";',
    'if(ok)n++;',
    '}',
    'var x=collect();',
    'x.rows.forEach(hit);',
    'x.cards.forEach(hit);',
    'if(filterEmpty)filterEmpty.classList.toggle("show",!!q&&n===0);',
    'if(clearBtn)clearBtn.hidden=!q;',
    '}',
    'function clearSearch(){',
    'if(search)search.value="";',
    'applyFilter("");',
    'if(search)search.focus();',
    '}',
    'ths.forEach(function(th){th.addEventListener("click",function(){sortBy(th.getAttribute("data-key"));});});',
    'if(sortMobile)sortMobile.addEventListener("change",function(){',
    'var p=(sortMobile.value||"name:1").split(":");',
    'sortBoth(p[0]||"name",+(p[1]||1)||1);',
    '});',
    'if(search){',
    'search.addEventListener("input",function(){applyFilter(search.value);});',
    'search.addEventListener("keydown",function(e){if(e.key==="Escape"){e.preventDefault();clearSearch();}});',
    '}',
    'if(clearBtn)clearBtn.addEventListener("click",clearSearch);',
    'if(filterClear)filterClear.addEventListener("click",clearSearch);',
    'paintTh();',
    '})();',
  ].join('')

  const uploadJs = canUpload ? [
    '(function(){',
    'var action=' + JSON.stringify(uploadAction) + ';',
    'var input=document.getElementById("upload-input");',
    'var btn=document.getElementById("upload-btn");',
    'var toast=document.getElementById("upload-toast");',
    'var toastTimer=null;',
    'function setToast(text,ok){',
    'if(!toast)return;',
    'toast.textContent=text||"";',
    'toast.className="upload-toast show "+(ok?"ok":"err");',
    'if(toastTimer)clearTimeout(toastTimer);',
    'toastTimer=setTimeout(function(){toast.className="upload-toast";},3200);',
    '}',
    'function setBusy(on){if(btn)btn.disabled=!!on;}',
    'function uploadFiles(fileList){',
    'var files=[].slice.call(fileList||[]);',
    'if(!files.length){setToast("请先选择文件",false);return;}',
    'if(files.length>10){setToast("一次最多 10 个文件",false);return;}',
    'var total=0;for(var i=0;i<files.length;i++)total+=files[i].size;',
    'if(total>200*1024*1024){setToast("合计超过 200MB，请分批上传",false);return;}',
    'var fd=new FormData();',
    'files.forEach(function(f){fd.append("file",f,f.name);});',
    'var xhr=new XMLHttpRequest();',
    'xhr.open("POST",action);',
    'xhr.setRequestHeader("Accept","application/json");',
    'xhr.onload=function(){',
    'var ok=xhr.status>=200&&xhr.status<300;',
    'var data=null;try{data=JSON.parse(xhr.responseText);}catch(e){}',
    'if(ok&&data&&data.ok){',
    'setBusy(false);',
    'setToast("上传成功 "+data.count+" 个文件，正在刷新…",true);',
    'setTimeout(function(){location.reload();},500);',
    '}else{',
    'setBusy(false);',
    'var err=(data&&data.error)||xhr.responseText||("上传失败 ("+xhr.status+")");',
    'if(xhr.status===403)err="上传已关闭或不在允许目录，请刷新页面后重试";',
    'if(xhr.status===413)err="文件过大（单次合计 ≤ 200MB）";',
    'setToast(err,false);',
    '}',
    '};',
    'xhr.onerror=function(){setBusy(false);setToast("网络错误，上传失败",false);};',
    'setBusy(true);',
    'xhr.send(fd);',
    '}',
    'if(btn&&input){',
    'btn.addEventListener("click",function(){input.click();});',
    'input.addEventListener("change",function(){uploadFiles(input.files);input.value="";});',
    '}',
    'var dragDepth=0;',
    'function hasFiles(e){var dt=e.dataTransfer;if(!dt||!dt.types)return false;return [].slice.call(dt.types).indexOf("Files")!==-1;}',
    'document.addEventListener("dragenter",function(e){if(!hasFiles(e))return;e.preventDefault();dragDepth++;document.body.classList.add("drag-upload");});',
    'document.addEventListener("dragover",function(e){if(!hasFiles(e))return;e.preventDefault();});',
    'document.addEventListener("dragleave",function(e){if(!hasFiles(e))return;e.preventDefault();dragDepth=Math.max(0,dragDepth-1);if(dragDepth===0)document.body.classList.remove("drag-upload");});',
    'document.addEventListener("drop",function(e){',
    'if(!hasFiles(e))return;',
    'e.preventDefault();dragDepth=0;document.body.classList.remove("drag-upload");',
    'var dt=e.dataTransfer;if(dt&&dt.files&&dt.files.length)uploadFiles(dt.files);',
    '});',
    'var mkdirDlg=document.getElementById("mkdir-dlg");',
    'var mkdirInput=document.getElementById("mkdir-input");',
    'var mkdirBtn=document.getElementById("mkdir-btn");',
    'var mkdirCancel=document.getElementById("mkdir-cancel");',
    'var mkdirOk=document.getElementById("mkdir-ok");',
    'function openMkdir(){',
    'if(!mkdirDlg||!mkdirInput)return;',
    'mkdirInput.value="";',
    'mkdirDlg.classList.add("show");',
    'setTimeout(function(){mkdirInput.focus();},50);',
    '}',
    'function closeMkdir(){if(mkdirDlg)mkdirDlg.classList.remove("show");}',
    'function doMkdir(){',
    'var name=(mkdirInput&&mkdirInput.value||"").trim();',
    'if(!name){setToast("请输入文件夹名",false);return;}',
    'if(/[\\\\/]/.test(name)||name==="."||name===".."){setToast("文件夹名不合法",false);return;}',
    'if(mkdirOk)mkdirOk.disabled=true;',
    'if(mkdirBtn)mkdirBtn.disabled=true;',
    'var xhr=new XMLHttpRequest();',
    'xhr.open("POST",action);',
    'xhr.setRequestHeader("Content-Type","application/x-www-form-urlencoded");',
    'xhr.setRequestHeader("Accept","application/json");',
    'xhr.onload=function(){',
    'if(mkdirOk)mkdirOk.disabled=false;',
    'if(mkdirBtn)mkdirBtn.disabled=false;',
    'var data=null;try{data=JSON.parse(xhr.responseText);}catch(e){}',
    'if(xhr.status>=200&&xhr.status<300&&data&&data.ok){',
    'closeMkdir();',
    'setToast("已创建 "+(data.name||name)+"，正在刷新…",true);',
    'setTimeout(function(){location.reload();},400);',
    '}else{',
    'var err=(data&&data.error)||xhr.responseText||("创建失败 ("+xhr.status+")");',
    'if(xhr.status===403)err="上传已关闭或不在允许目录，请刷新页面后重试";',
    'setToast(err,false);',
    '}',
    '};',
    'xhr.onerror=function(){',
    'if(mkdirOk)mkdirOk.disabled=false;',
    'if(mkdirBtn)mkdirBtn.disabled=false;',
    'setToast("网络错误，创建失败",false);',
    '};',
    'xhr.send("action=mkdir&name="+encodeURIComponent(name));',
    '}',
    'if(mkdirBtn)mkdirBtn.addEventListener("click",function(e){e.preventDefault();openMkdir();});',
    'if(mkdirCancel)mkdirCancel.addEventListener("click",closeMkdir);',
    'if(mkdirOk)mkdirOk.addEventListener("click",doMkdir);',
    'if(mkdirDlg)mkdirDlg.addEventListener("click",function(e){if(e.target===mkdirDlg)closeMkdir();});',
    'if(mkdirInput)mkdirInput.addEventListener("keydown",function(e){',
    'if(e.key==="Enter"){e.preventDefault();doMkdir();}',
    'if(e.key==="Escape"){e.preventDefault();closeMkdir();}',
    '});',
    '})();',
  ].join('') : ''

  const safeTitle = esc(titleName)
  const colCount = canManage ? 4 : 3
  const thead = '<tr>'
    + '<th class="sortable active" data-key="name">名称<span class="arrow">▲</span></th>'
    + '<th class="sortable" data-key="size">大小<span class="arrow">▲</span></th>'
    + '<th class="sortable" data-key="mtime">修改时间<span class="arrow">▲</span></th>'
    + (canManage ? '<th>操作</th>' : '')
    + '</tr>'

  const manageNote = canManage
    ? '<div class="manage-note">可重命名 / 删除文件与空文件夹 · 若提示禁止操作请刷新页面</div>'
    : ''

  const manageJs = canManage ? [
    '(function(){',
    'var action=' + JSON.stringify(uploadAction) + ';',
    'var dlg=document.getElementById("rename-dlg");',
    'var dlgInput=document.getElementById("rename-input");',
    'var dlgCancel=document.getElementById("rename-cancel");',
    'var dlgOk=document.getElementById("rename-ok");',
    'var renameFrom="";',
    'function post(body){',
    'var xhr=new XMLHttpRequest();',
    'xhr.open("POST",action);',
    'xhr.setRequestHeader("Content-Type","application/x-www-form-urlencoded");',
    'xhr.setRequestHeader("Accept","application/json");',
    'xhr.onload=function(){',
    'var data=null;try{data=JSON.parse(xhr.responseText);}catch(e){}',
    'if(xhr.status>=200&&xhr.status<300&&data&&data.ok){',
    'location.reload();',
    '}else{',
    'var err=(data&&data.error)||xhr.responseText||("操作失败 ("+xhr.status+")");',
    'if(xhr.status===403)err="管理已关闭，请刷新页面后重试";',
    'if(xhr.status===400&&/not empty/i.test(err))err="目录非空，无法删除";',
    'alert(err);',
    '}',
    '};',
    'xhr.onerror=function(){alert("网络错误");};',
    'xhr.send(body);',
    '}',
    'function openRename(name){',
    'renameFrom=name||"";',
    'if(!dlg||!dlgInput)return;',
    'dlgInput.value=renameFrom;',
    'dlg.classList.add("show");',
    'setTimeout(function(){dlgInput.focus();dlgInput.select();},50);',
    '}',
    'function closeRename(){if(dlg)dlg.classList.remove("show");renameFrom="";}',
    'function submitRename(){',
    'var to=(dlgInput&&dlgInput.value||"").trim();',
    'if(!renameFrom){closeRename();return;}',
    'if(!to){alert("请输入新文件名");return;}',
    'if(to===renameFrom){closeRename();return;}',
    'if(/[\\\\/]/.test(to)||to==="."||to===".."){alert("文件名不合法");return;}',
    'closeRename();',
    'post("action=rename&name="+encodeURIComponent(renameFrom)+"&to="+encodeURIComponent(to));',
    '}',
    'function bindDel(btn){',
    'btn.addEventListener("click",function(e){',
    'e.preventDefault();e.stopPropagation();',
    'var name=btn.getAttribute("data-name")||"";',
    'if(!name)return;',
    'var kind=btn.getAttribute("data-kind")||"file";',
    'var tip=kind==="dir"?("确定删除空文件夹「"+name+"」？"):("确定删除文件「"+name+"」？此操作不可恢复。");',
    'if(!confirm(tip))return;',
    'post("action=delete&name="+encodeURIComponent(name));',
    '});',
    '}',
    'function bindRename(btn){',
    'btn.addEventListener("click",function(e){',
    'e.preventDefault();e.stopPropagation();',
    'openRename(btn.getAttribute("data-name")||"");',
    '});',
    '}',
    'document.querySelectorAll(".op-del").forEach(bindDel);',
    'document.querySelectorAll(".op-rename").forEach(bindRename);',
    'document.querySelectorAll(".more-btn").forEach(function(btn){',
    'btn.addEventListener("click",function(e){',
    'e.preventDefault();e.stopPropagation();',
    'var wrap=btn.closest(".file-card-more");',
    'var open=wrap&&wrap.classList.contains("open");',
    'document.querySelectorAll(".file-card-more.open").forEach(function(el){el.classList.remove("open");});',
    'if(wrap&&!open)wrap.classList.add("open");',
    '});',
    '});',
    'document.addEventListener("click",function(){',
    'document.querySelectorAll(".file-card-more.open").forEach(function(el){el.classList.remove("open");});',
    '});',
    'if(dlgCancel)dlgCancel.addEventListener("click",closeRename);',
    'if(dlgOk)dlgOk.addEventListener("click",submitRename);',
    'if(dlg)dlg.addEventListener("click",function(e){if(e.target===dlg)closeRename();});',
    'if(dlgInput)dlgInput.addEventListener("keydown",function(e){',
    'if(e.key==="Enter"){e.preventDefault();submitRename();}',
    'if(e.key==="Escape"){e.preventDefault();closeRename();}',
    '});',
    '})();',
  ].join('') : ''

  const renameDlgHtml = canManage
    ? '<div id="rename-dlg" class="dlg" role="dialog" aria-modal="true"><div class="dlg-card"><h3 class="dlg-title">重命名</h3><input id="rename-input" class="dlg-input" type="text" maxlength="200" autocomplete="off" /><div class="dlg-actions"><button type="button" id="rename-cancel">取消</button><button type="button" class="dlg-ok" id="rename-ok">确定</button></div></div></div>'
    : ''

  const shareDlgHtml = ''

  const crumbActions = []
  if (canUpload) {
    crumbActions.push('<input id="upload-input" type="file" name="file" multiple />')
    crumbActions.push('<button type="button" id="upload-btn" class="crumb-primary">上传</button>')
    crumbActions.push('<button type="button" id="mkdir-btn">新建文件夹</button>')
  }
  if (pushUrl) {
    crumbActions.push('<button type="button" id="push-hist-btn">历史片段</button>')
  }
  const crumbsRow = `<div class="crumbs-row"><div class="crumbs">${crumbHtml}</div>${crumbActions.length ? `<div id="crumb-actions" class="crumb-actions">${crumbActions.join('')}</div>` : ''}</div>`
  const mkdirDlgHtml = canUpload
    ? '<div id="mkdir-dlg" class="dlg" role="dialog" aria-modal="true"><div class="dlg-card"><h3 class="dlg-title">新建文件夹</h3><input id="mkdir-input" class="dlg-input" type="text" maxlength="200" autocomplete="off" placeholder="文件夹名" /><div class="dlg-actions"><button type="button" id="mkdir-cancel">取消</button><button type="button" class="dlg-ok" id="mkdir-ok">确定</button></div></div></div>'
    : ''
  const uploadToastHtml = canUpload
    ? '<div id="upload-toast" class="upload-toast" role="status"></div>'
    : ''

  const lightboxJs = imageList.length ? [
    '(function(){',
    'var imgs=' + JSON.stringify(imageList) + ';',
    'var idx=0;',
    'var lb=document.getElementById("lb");',
    'var imgEl=document.getElementById("lb-img");',
    'var nameEl=document.getElementById("lb-name");',
    'var prevBtn=document.getElementById("lb-prev");',
    'var nextBtn=document.getElementById("lb-next");',
    'var openA=document.getElementById("lb-open");',
    'var dlA=document.getElementById("lb-dl");',
    'function paint(){',
    'var it=imgs[idx];if(!it)return;',
    'imgEl.src=it.raw;imgEl.alt=it.name;',
    'nameEl.textContent=it.name;',
    'openA.href=it.href;dlA.href=it.download;',
    'prevBtn.disabled=idx<=0;nextBtn.disabled=idx>=imgs.length-1;',
    '}',
    'function openAt(i){if(i<0||i>=imgs.length)return;idx=i;paint();lb.classList.add("show");}',
    'function close(){lb.classList.remove("show");imgEl.removeAttribute("src");}',
    'document.querySelectorAll("a.file-img").forEach(function(a){',
    'a.addEventListener("click",function(e){e.preventDefault();openAt(+a.getAttribute("data-idx")||0);});',
    '});',
    'prevBtn.addEventListener("click",function(){if(idx>0){idx--;paint();}});',
    'nextBtn.addEventListener("click",function(){if(idx<imgs.length-1){idx++;paint();}});',
    'document.getElementById("lb-close").addEventListener("click",close);',
    'lb.addEventListener("click",function(e){if(e.target===lb)close();});',
    'document.addEventListener("keydown",function(e){',
    'if(!lb.classList.contains("show"))return;',
    'if(e.key==="Escape")close();',
    'if(e.key==="ArrowLeft"&&idx>0){idx--;paint();}',
    'if(e.key==="ArrowRight"&&idx<imgs.length-1){idx++;paint();}',
    '});',
    '})();',
  ].join('') : ''

  const shareJs = ''

  const lightboxHtml = imageList.length
    ? '<div id="lb" class="lb" role="dialog" aria-modal="true"><div class="lb-inner"><img id="lb-img" alt="" /><div class="lb-name" id="lb-name"></div><div class="lb-bar"><button type="button" id="lb-prev">上一张</button><button type="button" id="lb-next">下一张</button><a id="lb-open" href="#">打开预览页</a><a id="lb-dl" href="#">下载</a><button type="button" id="lb-close">关闭</button></div></div></div>'
    : ''

  const toolbarHtml = '<div class="toolbar"><div class="search-wrap"><input id="dir-search" type="search" placeholder="搜索当前目录" autocomplete="off" /><button type="button" id="search-clear" class="search-clear" hidden aria-label="清除">×</button></div><select id="sort-mobile" class="sort-mobile" aria-label="排序"><option value="name:1">名称 ↑</option><option value="name:-1">名称 ↓</option><option value="size:1">大小 ↑</option><option value="size:-1">大小 ↓</option><option value="mtime:1">时间 ↑</option><option value="mtime:-1">时间 ↓</option></select></div>'

  const tableBody = items || `<tr><td colspan="${colCount}" class="empty">空目录</td></tr>`
  const cardsBody = cards || '<div class="empty">空目录</div>'

  return `<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${safeTitle}</title><style>${css}</style></head><body><div class="header">${backBar}${manageNote}<div class="header-body"><h2>${safeTitle}</h2>${crumbsRow}</div></div><div class="wrap"><div class="card">${toolbarHtml}<div id="filter-empty" class="filter-empty">无匹配文件 <button type="button" id="filter-empty-clear">清除搜索</button></div><div class="view-table"><table${canManage ? ' class="has-ops"' : ''}><thead>${thead}</thead><tbody>${tableBody}</tbody></table></div><div class="view-cards"><div class="file-list">${cardsBody}</div></div></div></div>${lightboxHtml}${renameDlgHtml}${mkdirDlgHtml}${uploadToastHtml}<script>${sortJs}</script>${uploadJs ? `<script>${uploadJs}</script>` : ''}${manageJs ? `<script>${manageJs}</script>` : ''}${lightboxJs ? `<script>${lightboxJs}</script>` : ''}${toolPushClientBlock(pushUrl)}</body></html>`

}

window.toolStartServer = function(dir, port, opts) {
  if (toolServer) {
    return { ok: false, error: '服务器已在运行' }
  }
  opts = opts || {}
  const shareRoot = path.resolve(dir)
  let uploadEnabled = !!opts.uploadEnabled
  let uploadDir = opts.uploadDir ? path.resolve(opts.uploadDir) : shareRoot
  if (uploadEnabled) {
    if (!toolIsInside(uploadDir, shareRoot)) {
      return { ok: false, error: '上传目录必须在分享目录内' }
    }
  } else {
    uploadDir = shareRoot
  }
  toolServerLogs = []
  toolServerStats = { files: 0, bytes: 0, uploads: 0, uploadBytes: 0 }
  toolResetLive()
  toolServerUploadEnabled = uploadEnabled
  toolServerUploadDir = uploadDir
  toolServerManageEnabled = !!opts.manageEnabled
  toolServerPassword = opts.password || ''
  try {
    const server = http.createServer((req, res) => {
      const parsed = url.parse(req.url, true)
      const reqPath = toolNormalizeUrlPath(parsed.pathname || '/')
      if (!toolCheckAuth(req)) {
        res.statusCode = 401
        res.setHeader('WWW-Authenticate', 'Basic realm="FileShare"')
        res.end('401 Unauthorized')
        return
      }
      if (reqPath === '/__push__' && req.method === 'GET') {
        toolHandlePushStream(req, res)
        return
      }
      if (reqPath === '/__hljs__.js' && req.method === 'GET') {
        const assets = toolLoadHljsAssets()
        if (assets) {
          res.statusCode = 200
          res.setHeader('content-type', 'application/javascript; charset=utf-8')
          res.setHeader('cache-control', 'public, max-age=86400')
          res.end(assets.js)
        } else {
          res.statusCode = 404
          res.end('404')
        }
        return
      }
      if (reqPath === '/__hlcss__.css' && req.method === 'GET') {
        const assets = toolLoadHljsAssets()
        if (assets) {
          res.statusCode = 200
          res.setHeader('content-type', 'text/css; charset=utf-8')
          res.setHeader('cache-control', 'public, max-age=86400')
          res.end(assets.css)
        } else {
          res.statusCode = 404
          res.end('404')
        }
        return
      }
      toolTrackRequest(req, res)
      let reqUrl = reqPath
      const q = parsed.query || {}
      const wantDownload = q.download === '1'
      const wantRaw = q.raw === '1'
      const shareRootNow = path.resolve(toolServerDir || dir)
      const fsPath = path.resolve(shareRootNow, '.' + reqUrl)
      if (!toolIsInside(fsPath, shareRootNow)) {
        res.statusCode = 403
        res.end('403 Forbidden')
        toolPushLog(req, reqUrl, 403)
        return
      }

      if (req.method === 'POST') {
        const ctype = String(req.headers['content-type'] || '')
        const isUrlEncoded = /application\/x-www-form-urlencoded/i.test(ctype)
        if (isUrlEncoded) {
          toolReadRequestBody(req, TOOL_MKDIR_MAX_BODY).then((body) => {
            fs.stat(fsPath, (err, fstats) => {
              if (err || !fstats.isDirectory()) {
                toolEndJsonOrText(res, req, q, 400, '400 Not a directory')
                toolPushLog(req, reqUrl, 400)
                return
              }
              let params
              try {
                params = new URLSearchParams(body.toString('utf8'))
              } catch (e) {
                toolEndJsonOrText(res, req, q, 400, '400 Bad form')
                toolPushLog(req, reqUrl, 400)
                return
              }
              const action = params.get('action')

              if (action === 'delete' || action === 'rename') {
                if (!toolServerManageEnabled) {
                  toolEndJsonOrText(res, req, q, 403, '403 Manage Disabled')
                  toolPushLog(req, reqUrl, 403, action)
                  return
                }
                const fileName = toolSanitizeDirName(params.get('name'))
                if (!fileName) {
                  toolEndJsonOrText(res, req, q, 400, '400 Invalid name')
                  toolPushLog(req, reqUrl, 400, action)
                  return
                }
                const target = path.join(fsPath, fileName)
                if (!toolIsInside(target, shareRootNow)) {
                  toolEndJsonOrText(res, req, q, 403, '403 Forbidden')
                  toolPushLog(req, reqUrl, 403, action)
                  return
                }
                let st
                try {
                  st = fs.statSync(target)
                } catch (e) {
                  toolEndJsonOrText(res, req, q, 400, '400 Not found')
                  toolPushLog(req, reqUrl, 400, action)
                  return
                }
                if (!st.isFile() && !st.isDirectory()) {
                  toolEndJsonOrText(res, req, q, 400, '400 Not a file')
                  toolPushLog(req, reqUrl, 400, action)
                  return
                }
                if (action === 'delete') {
                  if (st.isFile()) {
                    try {
                      fs.unlinkSync(target)
                    } catch (e) {
                      toolEndJsonOrText(res, req, q, 500, '500 Delete Error')
                      toolPushLog(req, reqUrl, 500, 'delete')
                      return
                    }
                  } else {
                    let kids
                    try {
                      kids = fs.readdirSync(target)
                    } catch (e) {
                      toolEndJsonOrText(res, req, q, 500, '500 Delete Error')
                      toolPushLog(req, reqUrl, 500, 'delete')
                      return
                    }
                    if (kids.length > 0) {
                      toolEndJsonOrText(res, req, q, 400, '400 Directory not empty')
                      toolPushLog(req, reqUrl, 400, 'delete')
                      return
                    }
                    try {
                      fs.rmdirSync(target)
                    } catch (e) {
                      toolEndJsonOrText(res, req, q, 500, '500 Delete Error')
                      toolPushLog(req, reqUrl, 500, 'delete')
                      return
                    }
                  }
                  toolPushLog(req, reqUrl + '/' + fileName, 200, 'delete')
                  if (toolWantJson(req, q)) {
                    res.statusCode = 200
                    res.setHeader('content-type', 'application/json; charset=utf-8')
                    res.end(JSON.stringify({ ok: true, name: fileName }))
                  } else {
                    res.statusCode = 302
                    res.setHeader('Location', reqUrl)
                    res.end()
                  }
                  return
                }
                if (!st.isFile()) {
                  toolEndJsonOrText(res, req, q, 400, '400 Not a file')
                  toolPushLog(req, reqUrl, 400, action)
                  return
                }
                const toName = toolSanitizeDirName(params.get('to'))
                if (!toName) {
                  toolEndJsonOrText(res, req, q, 400, '400 Invalid new name')
                  toolPushLog(req, reqUrl, 400, 'rename')
                  return
                }
                const dest = path.join(fsPath, toName)
                if (!toolIsInside(dest, shareRootNow)) {
                  toolEndJsonOrText(res, req, q, 403, '403 Forbidden')
                  toolPushLog(req, reqUrl, 403, 'rename')
                  return
                }
                if (fs.existsSync(dest)) {
                  toolEndJsonOrText(res, req, q, 400, '400 Target exists')
                  toolPushLog(req, reqUrl, 400, 'rename')
                  return
                }
                try {
                  fs.renameSync(target, dest)
                } catch (e) {
                  toolEndJsonOrText(res, req, q, 500, '500 Rename Error')
                  toolPushLog(req, reqUrl, 500, 'rename')
                  return
                }
                toolPushLog(req, reqUrl + '/' + toName, 200, 'rename')
                if (toolWantJson(req, q)) {
                  res.statusCode = 200
                  res.setHeader('content-type', 'application/json; charset=utf-8')
                  res.end(JSON.stringify({ ok: true, name: fileName, to: toName }))
                } else {
                  res.statusCode = 302
                  res.setHeader('Location', reqUrl)
                  res.end()
                }
                return
              }

              if (action !== 'mkdir') {
                toolEndJsonOrText(res, req, q, 400, '400 Unknown action')
                toolPushLog(req, reqUrl, 400)
                return
              }
              if (!toolServerUploadEnabled || !toolServerUploadDir) {
                toolEndJsonOrText(res, req, q, 403, '403 Upload Disabled')
                toolPushLog(req, reqUrl, 403, 'mkdir')
                return
              }
              if (!toolIsInside(fsPath, toolServerUploadDir)) {
                toolEndJsonOrText(res, req, q, 403, '403 Outside Upload Root')
                toolPushLog(req, reqUrl, 403, 'mkdir')
                return
              }
              const dirName = toolSanitizeDirName(params.get('name'))
              if (!dirName) {
                toolEndJsonOrText(res, req, q, 400, '400 Invalid folder name')
                toolPushLog(req, reqUrl, 400, 'mkdir')
                return
              }
              const dest = toolUniquePath(fsPath, dirName)
              if (!dest || !toolIsInside(dest, shareRootNow) || !toolIsInside(dest, toolServerUploadDir)) {
                toolEndJsonOrText(res, req, q, 403, '403 Forbidden')
                toolPushLog(req, reqUrl, 403, 'mkdir')
                return
              }
              try {
                fs.mkdirSync(dest)
              } catch (e) {
                toolEndJsonOrText(res, req, q, 500, '500 Mkdir Error')
                toolPushLog(req, reqUrl, 500, 'mkdir')
                return
              }
              const created = path.basename(dest)
              toolPushLog(req, reqUrl + '/' + created, 201, 'mkdir')
              if (toolWantJson(req, q)) {
                res.statusCode = 200
                res.setHeader('content-type', 'application/json; charset=utf-8')
                res.end(JSON.stringify({ ok: true, name: created }))
              } else {
                res.statusCode = 302
                res.setHeader('Location', reqUrl)
                res.end()
              }
            })
          }).catch((e) => {
            if (e && e.code === 'LIMIT') {
              toolEndJsonOrText(res, req, q, 413, '413 Payload Too Large')
              toolPushLog(req, reqUrl, 413)
            } else {
              toolEndJsonOrText(res, req, q, 500, '500 Read Body Error')
              toolPushLog(req, reqUrl, 500)
            }
          })
          return
        }

        if (!toolServerUploadEnabled || !toolServerUploadDir) {
          toolEndJsonOrText(res, req, q, 403, '403 Upload Disabled')
          toolPushLog(req, reqUrl, 403, 'upload')
          return
        }
        if (!toolIsInside(fsPath, toolServerUploadDir)) {
          toolEndJsonOrText(res, req, q, 403, '403 Outside Upload Root')
          toolPushLog(req, reqUrl, 403, 'upload')
          return
        }
        const bMatch = /boundary=(?:"([^"]+)"|([^;]+))/i.exec(ctype)
        if (!bMatch) {
          toolEndJsonOrText(res, req, q, 400, '400 Bad multipart')
          toolPushLog(req, reqUrl, 400, 'upload')
          return
        }
        const boundary = (bMatch[1] || bMatch[2] || '').trim()
        const len = parseInt(req.headers['content-length'] || '0', 10)
        if (len > TOOL_UPLOAD_MAX_BODY) {
          toolEndJsonOrText(res, req, q, 413, '413 Payload Too Large')
          toolPushLog(req, reqUrl, 413, 'upload')
          return
        }
        toolReadRequestBody(req, TOOL_UPLOAD_MAX_BODY).then((body) => {
          fs.stat(fsPath, (err, fstats) => {
            if (err || !fstats.isDirectory()) {
              toolEndJsonOrText(res, req, q, 400, '400 Not a directory')
              toolPushLog(req, reqUrl, 400, 'upload')
              return
            }
            let files
            try {
              files = toolParseMultipart(body, boundary)
            } catch (e) {
              toolEndJsonOrText(res, req, q, 400, '400 Parse Error')
              toolPushLog(req, reqUrl, 400, 'upload')
              return
            }
            if (!files.length) {
              toolEndJsonOrText(res, req, q, 400, '400 No files')
              toolPushLog(req, reqUrl, 400, 'upload')
              return
            }
            if (files.length > TOOL_UPLOAD_MAX_FILES) {
              toolEndJsonOrText(res, req, q, 400, '400 Too many files')
              toolPushLog(req, reqUrl, 400, 'upload')
              return
            }
            let uploaded = 0
            let uploadedBytes = 0
            for (const f of files) {
              if (f.data.length > TOOL_UPLOAD_MAX_BODY) {
                toolEndJsonOrText(res, req, q, 413, '413 File Too Large')
                toolPushLog(req, reqUrl, 413, 'upload')
                return
              }
              const dest = toolUniquePath(fsPath, f.filename)
              if (!dest || !toolIsInside(dest, shareRootNow) || !toolIsInside(dest, toolServerUploadDir)) {
                toolEndJsonOrText(res, req, q, 403, '403 Forbidden')
                toolPushLog(req, reqUrl, 403, 'upload')
                return
              }
              try {
                fs.writeFileSync(dest, f.data)
                uploaded++
                uploadedBytes += f.data.length
              } catch (e) {
                toolEndJsonOrText(res, req, q, 500, '500 Write Error')
                toolPushLog(req, reqUrl, 500, 'upload')
                return
              }
            }
            toolServerStats.uploads += uploaded
            toolServerStats.uploadBytes += uploadedBytes
            toolPushLog(req, reqUrl, 201, 'upload')
            if (toolWantJson(req, q)) {
              res.statusCode = 200
              res.setHeader('content-type', 'application/json; charset=utf-8')
              res.end(JSON.stringify({ ok: true, count: uploaded, bytes: uploadedBytes }))
            } else {
              res.statusCode = 302
              res.setHeader('Location', reqUrl)
              res.end()
            }
          })
        }).catch((e) => {
          if (e && e.code === 'LIMIT') {
            toolEndJsonOrText(res, req, q, 413, '413 Payload Too Large')
            toolPushLog(req, reqUrl, 413, 'upload')
          } else {
            toolEndJsonOrText(res, req, q, 500, '500 Read Body Error')
            toolPushLog(req, reqUrl, 500, 'upload')
          }
        })
        return
      }

      fs.stat(fsPath, (err, fstats) => {
        if (err) {
          res.statusCode = 404
          res.end('404 Not Found')
          toolPushLog(req, reqUrl, 404)
          return
        }
        if (fstats.isDirectory()) {
          fs.readdir(fsPath, { withFileTypes: true }, (e, entries) => {
            if (e) {
              res.statusCode = 500
              res.end('500 Read Dir Error')
              toolPushLog(req, reqUrl, 500)
              return
            }
            res.setHeader('content-type', 'text/html; charset=utf-8')
            res.end(renderDirList(fsPath, shareRootNow, entries))
            toolPushLog(req, reqUrl, 200)
          })
          return
        }

        const baseName = path.basename(fsPath)
        const kind = toolFileKind(baseName)
        const mime = toolMime(baseName)
        const relFile = path.relative(shareRootNow, fsPath).split(path.sep).join('/')
        const fileHref = toolNormalizeUrlPath('/' + relFile)
        const parentHref = toolParentHref(relFile)

        if (wantDownload) {
          toolPipeFile(req, res, fsPath, fstats, reqUrl, mime, 'attachment', 'download')
          return
        }
        if (wantRaw) {
          toolPipeFile(req, res, fsPath, fstats, reqUrl, mime, 'inline', 'preview')
          return
        }
        if (kind === 'pdf') {
          toolPipeFile(req, res, fsPath, fstats, reqUrl, 'application/pdf', 'inline', 'preview')
          return
        }
        if (kind === 'image') {
          const neighbors = toolImageNeighbors(path.dirname(fsPath), baseName)
          const dirRel = path.relative(shareRootNow, path.dirname(fsPath)).split(path.sep).join('/')
          const toPreviewHref = (n) => {
            if (!n) return ''
            const h = dirRel ? '/' + dirRel + '/' + n : '/' + n
            return toolPublicPath(h)
          }
          const html = renderFilePreview({
            kind: 'image',
            name: baseName,
            parentHref,
            downloadHref: toolPublicPath(fileHref) + '?download=1',
            rawHref: toolPublicPath(fileHref) + '?raw=1',
            prevHref: toPreviewHref(neighbors.prev),
            nextHref: toPreviewHref(neighbors.next),
          })
          res.setHeader('content-type', 'text/html; charset=utf-8')
          res.end(html)
          toolPushLog(req, reqUrl, 200, 'preview')
          return
        }
        if (kind === 'video' || kind === 'audio') {
          const html = renderFilePreview({
            kind,
            name: baseName,
            parentHref,
            downloadHref: toolPublicPath(fileHref) + '?download=1',
            rawHref: toolPublicPath(fileHref) + '?raw=1',
          })
          res.setHeader('content-type', 'text/html; charset=utf-8')
          res.end(html)
          toolPushLog(req, reqUrl, 200, 'preview')
          return
        }
        if (kind === 'text') {
          const readSize = Math.min(fstats.size, TOOL_TEXT_MAX)
          const truncated = fstats.size > TOOL_TEXT_MAX
          fs.open(fsPath, 'r', (openErr, fd) => {
            if (openErr) {
              res.statusCode = 500
              res.end('500 Read Error')
              toolPushLog(req, reqUrl, 500)
              return
            }
            const buf = Buffer.alloc(readSize)
            fs.read(fd, buf, 0, readSize, 0, (readErr, bytesRead) => {
              fs.close(fd, () => {})
              if (readErr) {
                res.statusCode = 500
                res.end('500 Read Error')
                toolPushLog(req, reqUrl, 500)
                return
              }
              const text = buf.slice(0, bytesRead).toString('utf8')
              const html = renderFilePreview({
                kind: 'text',
                name: baseName,
                parentHref,
                downloadHref: toolPublicPath(fileHref) + '?download=1',
                body: text,
                truncated,
              })
              res.setHeader('content-type', 'text/html; charset=utf-8')
              res.end(html)
              toolPushLog(req, reqUrl, 200)
            })
          })
          return
        }
        toolPipeFile(req, res, fsPath, fstats, reqUrl, 'application/octet-stream', 'attachment', 'download')
      })
    })
    let resolveStart = null
    const startPromise = new Promise((resolve) => {
      resolveStart = resolve
    })
    server.on('error', (e) => {
      toolServer = null
      toolServerUploadEnabled = false
      toolServerUploadDir = null
      toolServerManageEnabled = false
      toolServerPassword = ''
      toolClearAutoStop()
      toolResetLive()
      if (e.code === 'EADDRINUSE') {
        toolFindFreePort(Number(port) + 1).then((suggested) => {
          resolveStart({
            ok: false,
            error: '端口 ' + port + ' 已被占用',
            code: 'EADDRINUSE',
            suggestedPort: suggested || null,
          })
        })
      } else {
        resolveStart({ ok: false, error: String(e && e.message ? e.message : e) })
      }
    })
    server.listen(port, () => {
      toolServer = server
      toolServerDir = shareRoot
      toolServerPort = port
      toolClearAutoStop()
      const mins = Number(opts.autoStopMinutes) || 0
      if (mins > 0) {
        toolScheduleAutoStop(Date.now() + mins * 60 * 1000)
      }
      resolveStart({ ok: true, autoStopAt: toolServerAutoStopAt })
    })
    return startPromise
  } catch (e) {
    toolServerUploadEnabled = false
    toolServerUploadDir = null
    toolServerManageEnabled = false
    toolServerPassword = ''
    toolClearAutoStop()
    toolResetLive()
    return { ok: false, error: String(e) }
  }
}

function toolPushLog(req, reqUrl, code, kind) {
  const ip = (req.socket.remoteAddress || '').replace('::ffff:', '')
  let k = kind
  if (!k) {
    if (req.method === 'POST') k = 'upload'
    else k = 'access'
  }
  toolServerLogs.unshift({
    time: Date.now(),
    ip: ip,
    method: req.method,
    url: reqUrl,
    code: code,
    kind: k,
  })
  if (toolServerLogs.length > 200) {
    toolServerLogs.length = 200
  }
}

window.toolStopServer = function() {
  toolClearAutoStop()
  if (toolServer) {
    toolServer.close()
    toolServer = null
    toolServerDir = null
    toolServerPort = null
    toolServerUploadEnabled = false
    toolServerUploadDir = null
    toolServerManageEnabled = false
    for (const c of toolServerPushClients) {
      c.closed = true
      if (c.pingTimer) clearInterval(c.pingTimer)
      try { c.res.end() } catch (e) {}
    }
    toolServerPushClients = new Set()
    toolServerPassword = ''
    toolResetLive()
  }
  return { ok: true }
}

window.toolSetAutoStop = function(opts) {
  opts = opts || {}
  if (!toolServer) {
    return { ok: false, error: '服务器未运行' }
  }
  const minutes = Number(opts.minutes)
  if (!minutes || minutes <= 0) {
    toolClearAutoStop()
    return { ok: true, autoStopAt: null }
  }
  toolScheduleAutoStop(Date.now() + minutes * 60 * 1000)
  return { ok: true, autoStopAt: toolServerAutoStopAt }
}

window.toolSetUpload = function(opts) {
  opts = opts || {}
  if (!toolServer || !toolServerDir) {
    return { ok: false, error: '服务器未运行' }
  }
  if (!opts.enabled) {
    toolServerUploadEnabled = false
    return { ok: true }
  }
  const uploadDir = path.resolve(opts.dir || toolServerDir)
  if (!toolIsInside(uploadDir, toolServerDir)) {
    return { ok: false, error: '上传目录必须在分享目录内' }
  }
  try {
    if (!fs.statSync(uploadDir).isDirectory()) {
      return { ok: false, error: '上传路径不是目录' }
    }
  } catch (e) {
    return { ok: false, error: '上传目录不存在' }
  }
  toolServerUploadEnabled = true
  toolServerUploadDir = uploadDir
  return { ok: true }
}

window.toolSetManage = function(opts) {
  opts = opts || {}
  if (!toolServer || !toolServerDir) {
    return { ok: false, error: '服务器未运行' }
  }
  toolServerManageEnabled = !!opts.enabled
  return { ok: true }
}

window.toolSetPassword = function(opts) {
  opts = opts || {}
  if (!toolServer) return { ok: false, error: '服务器未运行' }
  toolServerPassword = String(opts.password || '')
  return { ok: true }
}

window.toolSanitizeQrUrl = toolSanitizeQrUrl

window.toolPushSnippet = function(opts) {
  opts = opts || {}
  if (!toolServer) return { ok: false, error: '服务器未运行' }
  const content = String(opts.content || '')
  if (!content) return { ok: false, error: '内容为空' }
  const lang = String(opts.lang || '')
  const title = String(opts.title || '')
  const payload = JSON.stringify({ content: content, lang: lang, title: title, ts: Date.now() })
  const dataLines = payload.split('\n').map((l) => 'data: ' + l).join('\n')
  let sent = 0
  const dead = []
  for (const client of toolServerPushClients) {
    if (client.closed) { dead.push(client); continue }
    try {
      client.res.write('event: snippet\n' + dataLines + '\n\n')
      sent++
    } catch (e) {
      client.closed = true
      dead.push(client)
    }
  }
  for (const c of dead) {
    if (c.pingTimer) clearInterval(c.pingTimer)
    toolServerPushClients.delete(c)
  }
  return { ok: true, sent: sent, total: toolServerPushClients.size }
}

window.toolServerStatus = function() {
  if (!toolServer) {
    return {
      running: false, port: 0, dir: '', urls: [], endpoints: [], logs: [],
      uploadEnabled: false, uploadDir: '',
      manageEnabled: false,
      passwordEnabled: false,
      pushClients: 0,
      autoStopAt: null,
      stats: {
        files: 0, bytes: 0, uploads: 0, uploadBytes: 0,
        connections: 0, downRate: 0, upRate: 0,
      },
    }
  }
  toolSettleRates()
  const suffix = '/'
  const endpoints = toolCollectEndpoints(toolServerPort, suffix)
  return {
    running: true,
    port: toolServerPort,
    dir: toolServerDir,
    urls: endpoints.map((e) => e.url),
    endpoints: endpoints,
    logs: toolServerLogs.slice(0, 200),
    uploadEnabled: !!toolServerUploadEnabled,
    uploadDir: toolServerUploadDir || '',
    manageEnabled: !!toolServerManageEnabled,
    passwordEnabled: !!toolServerPassword,
    pushClients: toolServerPushClients.size,
    autoStopAt: toolServerAutoStopAt,
    stats: {
      files: toolServerStats.files,
      bytes: toolServerStats.bytes,
      uploads: toolServerStats.uploads || 0,
      uploadBytes: toolServerStats.uploadBytes || 0,
      connections: toolServerLive.connections,
      downRate: toolServerLive.downRate,
      upRate: toolServerLive.upRate,
    },
  }
}

window.toolClearLogs = function() {
  toolServerLogs = []
  return { ok: true }
}

window.toolPathIsDir = function(p) {
  try {
    return fs.statSync(String(p || '')).isDirectory()
  } catch (_) {
    return false
  }
}

// ========== ADB ==========
// GUI 应用（uTools/Electron）通常不继承 shell 的 PATH，需自行解析 adb 路径
let adbBinCached = null
function resolveAdbBin() {
  if (adbBinCached) return adbBinCached
  const isWin = process.platform === 'win32'
  const binName = isWin ? 'adb.exe' : 'adb'
  const home = os.homedir()
  const candidates = []
  const sdkRoots = [
    process.env.ANDROID_HOME,
    process.env.ANDROID_SDK_ROOT,
    process.env.ANDROID_SDK,
    path.join(home, 'Library', 'Android', 'sdk'),
    path.join(home, 'Android', 'Sdk'),
  ]
  if (isWin && process.env.LOCALAPPDATA) {
    sdkRoots.push(path.join(process.env.LOCALAPPDATA, 'Android', 'Sdk'))
  }
  for (const root of sdkRoots) {
    if (root) candidates.push(path.join(root, 'platform-tools', binName))
  }
  for (const dir of (process.env.PATH || '').split(path.delimiter)) {
    if (dir) candidates.push(path.join(dir, binName))
  }
  for (const c of candidates) {
    try {
      if (fs.existsSync(c)) {
        adbBinCached = c
        return adbBinCached
      }
    } catch (_) {}
  }
  // 回退：从登录 shell 取 PATH（用户常把 platform-tools 写在 .zshrc）
  if (!isWin) {
    try {
      const { execSync } = require('node:child_process')
      const shell = process.env.SHELL || '/bin/zsh'
      const out = execSync(shell + ' -lc "command -v adb"', {
        encoding: 'utf8',
        timeout: 3000,
        env: process.env,
      }).trim().split('\n')[0]
      if (out && fs.existsSync(out)) {
        adbBinCached = out
        return adbBinCached
      }
    } catch (_) {}
  }
  adbBinCached = binName
  return adbBinCached
}

window.readFileAsBase64 = function(filePath) {
  try {
    const buf = fs.readFileSync(filePath)
    return buf.toString('base64')
  } catch (e) {
    return null
  }
}

window.writeFile = function(filePath, data) {
  try {
    fs.writeFileSync(filePath, data)
    return { ok: true }
  } catch (e) {
    return { ok: false, error: String(e) }
  }
}

window.getTempDir = function() {
  return os.tmpdir()
}

// ===== 便签图片外置落盘 =====
// 持久化目录：userData/sticky-images（随插件配置走，不丢）
function stickyImagesDir() {
  let base
  try { base = ztools.getPath('userData') } catch (_) { base = os.tmpdir() }
  const dir = path.join(base, 'sticky-images')
  try { if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true }) } catch (_) {}
  return dir
}

window.getStickyImagesDir = function() {
  return stickyImagesDir()
}

/**
 * 保存 base64 图片到磁盘
 * @param {string} base64Data 不含 data: 前缀的纯 base64
 * @param {string} mime 如 image/jpeg
 * @returns {{ ok: boolean, filename?: string, error?: string }}
 */
window.saveStickyImage = function(base64Data, mime) {
  try {
    const ext = mime === 'image/png' ? 'png'
      : mime === 'image/webp' ? 'webp'
      : 'jpg'
    const name = `${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}.${ext}`
    const dest = path.join(stickyImagesDir(), name)
    fs.writeFileSync(dest, Buffer.from(base64Data, 'base64'))
    return { ok: true, filename: name }
  } catch (e) {
    return { ok: false, error: String(e) }
  }
}

/**
 * 读取便签图片为 data URL
 * @param {string} filename 文件名（不含路径）
 * @returns {string|null} data URL，失败返回 null
 */
window.readStickyImage = function(filename) {
  try {
    const f = path.join(stickyImagesDir(), filename)
    if (!fs.existsSync(f)) return null
    const buf = fs.readFileSync(f)
    const ext = path.extname(filename).slice(1).toLowerCase()
    const mime = ext === 'png' ? 'image/png'
      : ext === 'webp' ? 'image/webp'
      : ext === 'gif' ? 'image/gif'
      : 'image/jpeg'
    return `data:${mime};base64,${buf.toString('base64')}`
  } catch (_) {
    return null
  }
}

/** 删除便签图片 */
window.deleteStickyImage = function(filename) {
  try {
    const f = path.join(stickyImagesDir(), filename)
    if (fs.existsSync(f)) fs.unlinkSync(f)
    return true
  } catch (_) {
    return false
  }
}

/**
 * 枚举磁盘上所有便签图片文件名
 * @returns {string[]} 文件名数组（失败返回空数组）
 */
window.listStickyImages = function() {
  try {
    const dir = stickyImagesDir()
    return fs.readdirSync(dir).filter(name => fs.statSync(path.join(dir, name)).isFile())
  } catch (_) {
    return []
  }
}

window.joinPath = function(...args) {
  return path.join(...args)
}

window.openPath = function(filePath) {
  try {
    const platform = process.platform
    let cmd, args
    if (platform === 'darwin') {
      cmd = 'open'
      args = [filePath]
    } else if (platform === 'win32') {
      cmd = 'cmd'
      args = ['/c', 'start', '', filePath]
    } else {
      cmd = 'xdg-open'
      args = [filePath]
    }
    spawn(cmd, args, { shell: false, detached: true, stdio: 'ignore' }).unref()
    return { ok: true }
  } catch (e) {
    return { ok: false, error: String(e) }
  }
}

window.showItemInFolder = function(filePath) {
  try {
    const platform = process.platform
    let cmd, args
    if (platform === 'darwin') {
      cmd = 'open'
      args = ['-R', filePath]
    } else if (platform === 'win32') {
      cmd = 'explorer'
      args = ['/select,', filePath]
    } else {
      // Linux 无统一标准，打开所在目录
      cmd = 'xdg-open'
      args = [path.dirname(filePath)]
    }
    spawn(cmd, args, { shell: false, detached: true, stdio: 'ignore' }).unref()
    return { ok: true }
  } catch (e) {
    return { ok: false, error: String(e) }
  }
}

window.readDir = function(dirPath, recursive, extFilter) {
  try {
    const results = []
    const extSet = extFilter && extFilter.length > 0 ? new Set(extFilter.map(e => e.toLowerCase().replace(/^\./, ''))) : null

    function walk(dir) {
      let entries
      try {
        entries = fs.readdirSync(dir, { withFileTypes: true })
      } catch (e) {
        return
      }
      for (const entry of entries) {
        const fullPath = path.join(dir, entry.name)
        if (entry.isDirectory()) {
          if (recursive) walk(fullPath)
        } else if (entry.isFile()) {
          try {
            const stat = fs.statSync(fullPath)
            const ext = path.extname(entry.name).toLowerCase().replace(/^\./, '')
            if (extSet && !extSet.has(ext)) continue
            results.push({
              path: fullPath,
              name: entry.name,
              ext: ext,
              size: stat.size,
              mtime: stat.mtimeMs,
              isDir: false,
            })
          } catch (_) {}
        }
      }
    }

    walk(dirPath)
    results.sort((a, b) => a.name.localeCompare(b.name))
    return results
  } catch (e) {
    return []
  }
}

window.renameFile = function(oldPath, newPath) {
  try {
    fs.renameSync(oldPath, newPath)
    return { ok: true }
  } catch (e) {
    return { ok: false, error: String(e) }
  }
}

window.pathExists = function(filePath) {
  try {
    return fs.existsSync(filePath)
  } catch (e) {
    return false
  }
}

window.isDir = function(filePath) {
  try {
    return fs.statSync(filePath).isDirectory()
  } catch (e) {
    return false
  }
}

window.getFileStat = function(filePath) {
  try {
    const stat = fs.statSync(filePath)
    return { size: stat.size, mtime: stat.mtimeMs }
  } catch (e) {
    return null
  }
}

window.readTextFile = function(filePath, maxBytes) {
  try {
    const stat = fs.statSync(filePath)
    if (maxBytes && stat.size > maxBytes) return null
    const fd = fs.openSync(filePath, 'r')
    const bytesToRead = maxBytes ? Math.min(stat.size, maxBytes) : stat.size
    const buf = Buffer.alloc(bytesToRead)
    fs.readSync(fd, buf, 0, bytesToRead, 0)
    fs.closeSync(fd)
    return buf.toString('utf-8')
  } catch (e) {
    return null
  }
}

window.readDirTree = function(dirPath, ignoreDirs, maxDepth) {
  try {
    // 解析忽略列表：支持目录名/文件名/扩展名(.log)/通配符(*.tmp)
    const ignoreSet = new Set()
    const ignorePatterns = []
    for (const raw of (ignoreDirs || [])) {
      const s = String(raw).trim()
      if (!s) continue
      if (s.includes('*') || s.includes('?')) {
        // 通配符转正则：* -> .*，? -> .，其余转义
        const re = new RegExp('^' + s.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\?/g, '.') + '$')
        ignorePatterns.push(re)
      } else {
        ignoreSet.add(s)
      }
    }
    const visitedDirs = new Set()
    maxDepth = maxDepth || 20

    function shouldIgnore(name) {
      if (ignoreSet.has(name)) return true
      // 支持扩展名简写: .log 匹配 xxx.log
      for (const s of ignoreSet) {
        if (s.startsWith('.') && s.length > 1 && name.toLowerCase().endsWith(s.toLowerCase())) return true
      }
      for (const re of ignorePatterns) {
        if (re.test(name)) return true
      }
      return false
    }

    function walk(dir, depth) {
      if (depth > maxDepth) return []
      let entries
      try {
        entries = fs.readdirSync(dir, { withFileTypes: true })
      } catch (e) {
        return []
      }
      const result = []
      for (const entry of entries) {
        const fullPath = path.join(dir, entry.name)
        if (entry.isDirectory()) {
          if (shouldIgnore(entry.name)) continue
          try {
            const realPath = fs.realpathSync(fullPath)
            if (realPath !== fullPath && visitedDirs.has(realPath)) continue
            visitedDirs.add(realPath)
          } catch (_) {}
          const children = walk(fullPath, depth + 1)
          result.push({
            name: entry.name,
            path: fullPath,
            isDir: true,
            children: children,
          })
        } else if (entry.isFile()) {
          if (shouldIgnore(entry.name)) continue
          let size = 0
          try { size = fs.statSync(fullPath).size } catch (_) {}
          result.push({
            name: entry.name,
            path: fullPath,
            isDir: false,
            size: size,
          })
        }
      }
      result.sort((a, b) => {
        if (a.isDir !== b.isDir) return a.isDir ? -1 : 1
        return a.name.localeCompare(b.name)
      })
      return result
    }

    return walk(dirPath, 0)
  } catch (e) {
    return []
  }
}

// Everything 文件搜索：扁平化扫描目录，返回所有文件和子目录
// 返回 [{name, path, dir, ext, size, mtime, isDir}]
// size: 文件字节数；目录为 -1
window.scanFiles = function(dirPath, ignoreDirs) {
  try {
    const ignoreSet = new Set()
    const ignorePatterns = []
    for (const raw of (ignoreDirs || [])) {
      const s = String(raw).trim()
      if (!s) continue
      if (s.includes('*') || s.includes('?')) {
        const re = new RegExp('^' + s.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\?/g, '.') + '$')
        ignorePatterns.push(re)
      } else {
        ignoreSet.add(s)
      }
    }
    const visitedDirs = new Set()
    const result = []

    function shouldIgnore(name) {
      if (ignoreSet.has(name)) return true
      for (const s of ignoreSet) {
        if (s.startsWith('.') && s.length > 1 && name.toLowerCase().endsWith(s.toLowerCase())) return true
      }
      for (const re of ignorePatterns) {
        if (re.test(name)) return true
      }
      return false
    }

    function walk(dir) {
      let entries
      try {
        entries = fs.readdirSync(dir, { withFileTypes: true })
      } catch (e) {
        return
      }
      for (const entry of entries) {
        const fullPath = path.join(dir, entry.name)
        if (entry.isDirectory()) {
          if (shouldIgnore(entry.name)) continue
          try {
            const realPath = fs.realpathSync(fullPath)
            if (realPath !== fullPath && visitedDirs.has(realPath)) continue
            visitedDirs.add(realPath)
          } catch (_) {}
          let mtime = 0
          try { mtime = fs.statSync(fullPath).mtimeMs } catch (_) {}
          result.push({
            name: entry.name,
            path: fullPath,
            dir: dir,
            ext: '',
            size: -1,
            mtime: mtime,
            isDir: true,
          })
          walk(fullPath)
        } else if (entry.isFile()) {
          if (shouldIgnore(entry.name)) continue
          let size = 0, mtime = 0
          try {
            const st = fs.statSync(fullPath)
            size = st.size
            mtime = st.mtimeMs
          } catch (_) {}
          const dot = entry.name.lastIndexOf('.')
          const ext = dot > 0 ? entry.name.slice(dot + 1).toLowerCase() : ''
          result.push({
            name: entry.name,
            path: fullPath,
            dir: dir,
            ext: ext,
            size: size,
            mtime: mtime,
            isDir: false,
          })
        }
      }
    }

    // 包含根目录自身
    try {
      const rootStat = fs.statSync(dirPath)
      if (rootStat.isDirectory()) {
        result.push({
          name: path.basename(dirPath) || dirPath,
          path: dirPath,
          dir: path.dirname(dirPath),
          ext: '',
          size: -1,
          mtime: rootStat.mtimeMs,
          isDir: true,
        })
        visitedDirs.add(fs.realpathSync(dirPath))
      }
    } catch (_) {}
    walk(dirPath)
    return result
  } catch (e) {
    return []
  }
}

window.gitStat = function(dirPath) {
  const { execSync } = require('node:child_process')
  const SEP = '\x1f' // unit separator between fields
  const TIMEOUT = 8000

  function run(args) {
    return execSync(args, {
      cwd: dirPath,
      encoding: 'utf8',
      timeout: TIMEOUT,
      maxBuffer: 10 * 1024 * 1024,
      stdio: ['pipe', 'pipe', 'ignore'],
    })
  }

  try {
    // 确认是 git 仓库
    run('git rev-parse --is-inside-work-tree')
  } catch (e) {
    return null
  }

  function safe(args, fallback) {
    try {
      const out = run(args)
      return out == null ? fallback : out
    } catch (e) {
      return fallback
    }
  }

  const info = { isRepo: true }

  // 分支
  info.branch = safe('git rev-parse --abbrev-ref HEAD', '').trim() || '(detached)'

  // 分支总数（本地 + 远程）+ 分支详情
  const localBranchesOut = safe('git branch --list', '')
  const localBranchNames = localBranchesOut.split('\n').filter(l => l.trim() && !l.includes('->')).map(l => l.replace(/^\*?\s+/, '').trim())
  info.localBranchCount = localBranchNames.length
  const remoteBranchesOut = safe('git branch -r', '')
  const remoteBranchNames = remoteBranchesOut.split('\n').filter(l => l.trim() && !l.includes('->')).map(l => l.trim())
  info.remoteBranchCount = remoteBranchNames.length
  info.totalBranchCount = info.localBranchCount + info.remoteBranchCount

  // 日志格式（供分支详情、最近提交等复用）
  const logFmt = '%h' + SEP + '%an' + SEP + '%ad' + SEP + '%ar' + SEP + '%s'

  // 全部分支详情（名字 + 最新提交）
  const allBranchNames = [...localBranchNames, ...remoteBranchNames]
  info.allBranches = []
  for (const name of allBranchNames) {
    const bLog = safe('git -c core.quotepath=false log -1 --date=short --pretty=format:' + logFmt + ' ' + name, '')
    if (bLog) {
      const p = bLog.split(SEP)
      info.allBranches.push({
        name,
        isLocal: localBranchNames.includes(name),
        isCurrent: name === info.branch,
        lastCommit: { hash: p[0] || '', author: p[1] || '', date: p[2] || '', relative: p[3] || '', subject: p[4] || '' },
      })
    }
  }

  // 提交总数
  const countOut = safe('git rev-list --count HEAD', '0').trim()
  info.totalCommits = parseInt(countOut, 10) || 0

  // 最近提交 (10 条): hash|author|date(short)|relative|subject
  const logOut = safe('git -c core.quotepath=false log -10 --date=short --pretty=format:' + logFmt, '')
  info.recentCommits = logOut.split('\n').filter(Boolean).map(line => {
    const p = line.split(SEP)
    return { hash: p[0] || '', author: p[1] || '', date: p[2] || '', relative: p[3] || '', subject: p[4] || '' }
  })

  // 最新提交
  const lastOut = safe('git -c core.quotepath=false log -1 --date=short --pretty=format:' + logFmt, '')
  if (lastOut) {
    const p = lastOut.split(SEP)
    info.lastCommit = { hash: p[0] || '', author: p[1] || '', date: p[2] || '', relative: p[3] || '', subject: p[4] || '' }
  } else {
    info.lastCommit = null
  }

  // 最早提交（仓库年龄）
  const firstOut = safe('git -c core.quotepath=false log --reverse --date=short --pretty=format:%ad', '').trim()
  info.firstCommitDate = firstOut ? firstOut.split('\n')[0] : ''

  // 贡献者（按总/年/月/周分组统计）
  const contribLogOut = safe('git -c core.quotepath=false log --all --date=short --pretty=format:%an' + SEP + '%ad', '')
  const contribEntries = contribLogOut.split('\n').filter(Boolean).map(line => {
    const p = line.split(SEP)
    return { author: p[0] || '', date: p[1] || '' }
  })
  const nowD = new Date()
  const yearAgo = new Date(nowD); yearAgo.setFullYear(yearAgo.getFullYear() - 1)
  const monthAgo = new Date(nowD); monthAgo.setMonth(monthAgo.getMonth() - 1)
  const weekAgo = new Date(nowD); weekAgo.setDate(weekAgo.getDate() - 7)
  const contribMap = new Map()
  for (const e of contribEntries) {
    if (!e.author) continue
    if (!contribMap.has(e.author)) contribMap.set(e.author, { total: 0, year: 0, month: 0, week: 0 })
    const c = contribMap.get(e.author)
    c.total++
    const parts = e.date.split('-')
    if (parts.length === 3) {
      const d = new Date(parseInt(parts[0], 10), parseInt(parts[1], 10) - 1, parseInt(parts[2], 10))
      if (!isNaN(d.getTime())) {
        if (d >= yearAgo) c.year++
        if (d >= monthAgo) c.month++
        if (d >= weekAgo) c.week++
      }
    }
  }
  const contributors = [...contribMap.entries()]
    .map(([name, counts]) => ({ name, ...counts }))
    .sort((a, b) => b.total - a.total)
  info.contributors = contributors.length
  info.allContributors = contributors

  // 未提交改动数
  const statusOut = safe('git status --porcelain', '')
  info.dirtyCount = statusOut.split('\n').filter(Boolean).length

  // 远程仓库
  const remoteOut = safe('git remote', '')
  const remotes = remoteOut.split('\n').filter(Boolean)
  info.remoteCount = remotes.length
  info.remotes = remotes.slice(0, 5).map(name => {
    const url = safe('git remote get-url ' + name, '').trim()
    return { name, url }
  })

  return info
}

window.adbExec = function(args) {
  return new Promise(resolve => {
    let child
    const adbBin = resolveAdbBin()
    try {
      child = spawn(adbBin, args, { shell: false })
    } catch (e) {
      resolve({ ok: false, error: 'adb 未安装或不在 PATH' })
      return
    }
    let stdout = ''
    let stderr = ''
    let settled = false
    const timer = setTimeout(() => {
      if (!settled) {
        settled = true
        try { child.kill('SIGKILL') } catch (_) {}
        resolve({ ok: false, error: '执行超时' })
      }
    }, 30000)
    child.on('error', (e) => {
      if (!settled) {
        settled = true
        clearTimeout(timer)
        if (e.code === 'ENOENT') {
          resolve({ ok: false, error: 'adb 未安装或不在 PATH' })
        } else {
          resolve({ ok: false, error: String(e) })
        }
      }
    })
    child.stdout.on('data', (d) => { stdout += d.toString() })
    child.stderr.on('data', (d) => { stderr += d.toString() })
    child.on('close', (code) => {
      if (!settled) {
        settled = true
        clearTimeout(timer)
        if (code === 0) {
          resolve({ ok: true, stdout, stderr })
        } else {
          resolve({ ok: false, stdout, stderr })
        }
      }
    })
  })
}

/** Binary-safe adb exec (stdout as Buffer). Prefer this in hot paths to avoid base64 roundtrips. */
window.adbExecBinaryBuffer = function(args, timeoutMs) {
  const ms = typeof timeoutMs === 'number' ? timeoutMs : 8000
  return new Promise(resolve => {
    let child
    const adbBin = resolveAdbBin()
    try {
      child = spawn(adbBin, args, { shell: false })
    } catch (e) {
      resolve({ ok: false, error: 'adb 未安装或不在 PATH', buffer: null, stderr: '' })
      return
    }
    const chunks = []
    let stderr = ''
    let settled = false
    const timer = setTimeout(() => {
      if (!settled) {
        settled = true
        try { child.kill('SIGKILL') } catch (_) {}
        const buf = Buffer.concat(chunks)
        resolve({
          ok: false,
          error: '执行超时',
          buffer: buf.length ? buf : null,
          bytes: buf.length,
          stderr,
        })
      }
    }, ms)
    child.on('error', (e) => {
      if (!settled) {
        settled = true
        clearTimeout(timer)
        if (e.code === 'ENOENT') {
          resolve({ ok: false, error: 'adb 未安装或不在 PATH', buffer: null, stderr })
        } else {
          resolve({ ok: false, error: String(e), buffer: null, stderr })
        }
      }
    })
    child.stdout.on('data', (d) => { chunks.push(Buffer.isBuffer(d) ? d : Buffer.from(d)) })
    child.stderr.on('data', (d) => { stderr += d.toString() })
    child.on('close', (code) => {
      if (!settled) {
        settled = true
        clearTimeout(timer)
        const buf = Buffer.concat(chunks)
        if (code === 0 && buf.length > 0) {
          resolve({ ok: true, buffer: buf, bytes: buf.length, stderr })
        } else {
          resolve({
            ok: false,
            buffer: buf.length ? buf : null,
            bytes: buf.length,
            stderr,
            error: code === 0 ? '空输出' : ('exit ' + code),
          })
        }
      }
    })
  })
}

/** Binary-safe adb exec (stdout as Buffer → base64). */
window.adbExecBinary = async function(args, timeoutMs) {
  const r = await window.adbExecBinaryBuffer(args, timeoutMs)
  if (!r.buffer) {
    return { ok: false, base64: '', bytes: r.bytes || 0, stderr: r.stderr || '', error: r.error || '' }
  }
  // 即使 exit≠0 也带回 stdout（uiautomator dump 等偶发非 0 但仍有 XML）
  return {
    ok: !!r.ok,
    base64: r.buffer.toString('base64'),
    bytes: r.buffer.length,
    stderr: r.stderr || '',
    error: r.error || '',
  }
}

function stripToPng(buf) {
  if (!buf || buf.length < 8) return buf
  if (buf[0] === 0x89 && buf[1] === 0x50) return buf
  for (let i = 0; i < Math.min(buf.length - 8, 64); i++) {
    if (buf[i] === 0x89 && buf[i + 1] === 0x50 && buf[i + 2] === 0x4E && buf[i + 3] === 0x47) {
      return buf.subarray(i)
    }
  }
  return buf
}

let nativeImageApi = null
function getNativeImage() {
  if (nativeImageApi !== null) return nativeImageApi
  try {
    nativeImageApi = require('electron').nativeImage
  } catch (_) {
    nativeImageApi = false
  }
  return nativeImageApi
}

let zlibApi = null
function getZlib() {
  if (zlibApi !== null) return zlibApi
  try {
    zlibApi = require('node:zlib')
  } catch (_) {
    zlibApi = false
  }
  return zlibApi
}

/** serial → 'gzip-raw' | 'png' ，成功后缓存，避免每帧探测 */
const screencapModeBySerial = Object.create(null)

/**
 * Electron createFromBitmap / toBitmap 通道顺序因平台与版本而异。
 * 用 1×1 红像素 PNG 探测一次，避免 macOS 上 R/B 互换导致桌面偏色。
 * @returns {'bgra'|'rgba'}
 */
let bitmapOrderCache = null
function getBitmapOrder() {
  if (bitmapOrderCache) return bitmapOrderCache
  // 默认按 Skia LE（BGRA）；探测失败时也走 BGRA（比错成 RGBA 更常见）
  bitmapOrderCache = 'bgra'
  try {
    const ni = getNativeImage()
    if (!ni) return bitmapOrderCache
    // 1x1 #FF0000 RGB PNG（自生成，避免透明/调色板歧义）
    const redPng = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGP4z8AAAAMBAQDJ/pLvAAAAAElFTkSuQmCC',
      'base64',
    )
    const img = ni.createFromBuffer(redPng)
    if (!img || img.isEmpty()) return bitmapOrderCache
    const bmp = img.toBitmap()
    if (!bmp || bmp.length < 4) return bitmapOrderCache
    // BGRA: B≈0 G≈0 R≈255；RGBA: R≈255 G≈0 B≈0
    if (bmp[0] > 200 && bmp[2] < 50) bitmapOrderCache = 'rgba'
    else if (bmp[2] > 200 && bmp[0] < 50) bitmapOrderCache = 'bgra'
  } catch (_) {}
  return bitmapOrderCache
}

function swapRB(buf) {
  const out = Buffer.allocUnsafe(buf.length)
  for (let i = 0; i < buf.length; i += 4) {
    out[i] = buf[i + 2]
    out[i + 1] = buf[i + 1]
    out[i + 2] = buf[i]
    out[i + 3] = buf[i + 3]
  }
  return out
}

/** Android RGBA 字节序 → Electron createFromBitmap 所需顺序 */
function rgbaToBitmap(rgba) {
  return getBitmapOrder() === 'rgba' ? rgba : swapRB(rgba)
}

/** Android BGRA 字节序 → Electron createFromBitmap 所需顺序 */
function bgraToBitmap(bgra) {
  return getBitmapOrder() === 'bgra' ? bgra : swapRB(bgra)
}

/**
 * 解析 screencap 原始输出（无 -p）：[w][h][format]([colorSpace])[pixels]
 * @returns {{ width: number, height: number, bitmap: Buffer } | null}
 */
function parseRawScreencap(buf) {
  if (!buf || buf.length < 16) return null
  const w = buf.readUInt32LE(0)
  const h = buf.readUInt32LE(4)
  const f = buf.readUInt32LE(8)
  if (w < 16 || h < 16 || w > 8192 || h > 8192) return null

  const bppMap = { 1: 4, 2: 4, 3: 3, 4: 2, 5: 4 }
  const bpp = bppMap[f]
  if (!bpp) return null
  const pixelBytes = w * h * bpp

  let header = 12
  if (buf.length === 16 + pixelBytes) header = 16
  else if (buf.length === 12 + pixelBytes) header = 12
  else if (buf.length >= 16 + pixelBytes) header = 16
  else if (buf.length >= 12 + pixelBytes) header = 12
  else return null

  const pixels = buf.subarray(header, header + pixelBytes)
  let bitmap
  if (f === 1 || f === 2) {
    // RGBA / RGBX
    if (f === 2) {
      // 确保 alpha 不透明，避免部分机型 RGBX alpha=0
      bitmap = Buffer.from(pixels)
      for (let i = 3; i < bitmap.length; i += 4) bitmap[i] = 255
    } else {
      bitmap = pixels
    }
    bitmap = rgbaToBitmap(bitmap, w, h)
  } else if (f === 5) {
    bitmap = bgraToBitmap(pixels, w, h)
  } else if (f === 3) {
    // RGB888 → RGBA/BGRA
    const out = Buffer.allocUnsafe(w * h * 4)
    for (let i = 0, j = 0; i < pixels.length; i += 3, j += 4) {
      out[j] = pixels[i]
      out[j + 1] = pixels[i + 1]
      out[j + 2] = pixels[i + 2]
      out[j + 3] = 255
    }
    bitmap = rgbaToBitmap(out, w, h)
  } else if (f === 4) {
    // RGB565 → RGBA
    const out = Buffer.allocUnsafe(w * h * 4)
    for (let i = 0, j = 0; i < pixels.length; i += 2, j += 4) {
      const v = pixels[i] | (pixels[i + 1] << 8)
      out[j] = Math.round(((v >> 11) & 0x1f) * 255 / 31)
      out[j + 1] = Math.round(((v >> 5) & 0x3f) * 255 / 63)
      out[j + 2] = Math.round((v & 0x1f) * 255 / 31)
      out[j + 3] = 255
    }
    bitmap = rgbaToBitmap(out, w, h)
  } else {
    return null
  }

  return { width: w, height: h, bitmap }
}

function jpegFromNativeImage(img, jpegQuality, originW, originH) {
  if (!img || img.isEmpty()) return null
  const jpeg = img.toJPEG(jpegQuality)
  if (!jpeg || jpeg.length === 0) return null
  return {
    ok: true,
    mime: 'image/jpeg',
    base64: jpeg.toString('base64'),
    bytes: jpeg.length,
    width: originW,
    height: originH,
  }
}

/** 最近邻缩小 RGBA/BGRA，避免先建全分辨率 nativeImage 再 resize */
function downsampleBitmap(bitmap, sw, sh, scale) {
  if (scale >= 0.999) return { bitmap, width: sw, height: sh }
  const dw = Math.max(1, Math.round(sw * scale))
  const dh = Math.max(1, Math.round(sh * scale))
  if (dw >= sw && dh >= sh) return { bitmap, width: sw, height: sh }
  const dst = Buffer.allocUnsafe(dw * dh * 4)
  for (let y = 0; y < dh; y++) {
    const sy = (y * sh / dh) | 0
    const srcRow = sy * sw * 4
    const dstRow = y * dw * 4
    for (let x = 0; x < dw; x++) {
      const sx = (x * sw / dw) | 0
      const si = srcRow + sx * 4
      const di = dstRow + x * 4
      dst[di] = bitmap[si]
      dst[di + 1] = bitmap[si + 1]
      dst[di + 2] = bitmap[si + 2]
      dst[di + 3] = bitmap[si + 3]
    }
  }
  return { bitmap: dst, width: dw, height: dh }
}

function jpegFromRawBuffer(rawBuf, scale, jpegQuality) {
  const parsed = parseRawScreencap(rawBuf)
  if (!parsed) return null
  const ni = getNativeImage()
  if (!ni) return null
  try {
    const small = downsampleBitmap(parsed.bitmap, parsed.width, parsed.height, scale)
    const img = ni.createFromBitmap(small.bitmap, {
      width: small.width,
      height: small.height,
    })
    return jpegFromNativeImage(img, jpegQuality, parsed.width, parsed.height)
  } catch (_) {
    return null
  }
}

function jpegFromPngBuffer(pngBuf, scale, jpegQuality) {
  const buf = stripToPng(pngBuf)
  const ni = getNativeImage()
  if (!ni) {
    return {
      ok: true,
      mime: 'image/png',
      base64: buf.toString('base64'),
      bytes: buf.length,
      width: 0,
      height: 0,
    }
  }
  try {
    let img = ni.createFromBuffer(buf)
    if (img.isEmpty()) return null
    const size = img.getSize()
    const originW = size.width || 0
    const originH = size.height || 0
    if (scale < 0.999 && originW > 0) {
      const w = Math.max(1, Math.round(originW * scale))
      img = img.resize({ width: w, quality: 'good' })
    }
    return jpegFromNativeImage(img, jpegQuality, originW, originH)
  } catch (_) {
    return null
  }
}

async function fetchGzipRawBuffer(serialArgs) {
  const zlib = getZlib()
  if (!zlib) return null
  const startedAt = Date.now()
  const args = serialArgs.concat(['exec-out', 'sh', '-c', 'screencap 2>/dev/null | gzip -1'])
  const r = await window.adbExecBinaryBuffer(args, 8000)
  if (!r.ok || !r.buffer) return null
  try {
    return { kind: 'raw', buffer: zlib.gunzipSync(r.buffer), startedAt }
  } catch (_) {
    return null
  }
}

async function fetchPngBuffer(serialArgs) {
  const startedAt = Date.now()
  const args = serialArgs.concat(['exec-out', 'screencap', '-p'])
  const r = await window.adbExecBinaryBuffer(args, 8000)
  if (!r.ok || !r.buffer) return null
  return { kind: 'png', buffer: r.buffer, startedAt }
}

function encodeFetched(fetched, scale, jpegQuality) {
  if (!fetched || !fetched.buffer) return null
  if (fetched.kind === 'raw') return jpegFromRawBuffer(fetched.buffer, scale, jpegQuality)
  return jpegFromPngBuffer(fetched.buffer, scale, jpegQuality)
}

/** 下一帧预取：编码当前帧时并行拉下一帧，隐藏 adb 往返 */
const screencapPrefetch = Object.create(null)

function prefetchKey(serial) {
  return serial ? String(serial) : '_'
}

function startPrefetch(modeKey, serialArgs, mode) {
  const fetchPromise = mode === 'png'
    ? fetchPngBuffer(serialArgs)
    : fetchGzipRawBuffer(serialArgs)
  screencapPrefetch[modeKey] = { mode, promise: fetchPromise, serialArgs }
  return fetchPromise
}

window.adbScreencapClearPrefetch = function(serial) {
  const key = prefetchKey(serial)
  delete screencapPrefetch[key]
}

/** 常驻推流会话：一台设备一个 */
const screencapLive = Object.create(null)

const LIVE_SHELL = [
  'F=/data/local/tmp/zkit_sc.gz',
  'if [ ! -w /data/local/tmp ]; then F=/sdcard/zkit_sc.gz; fi',
  'while true; do',
  '  screencap 2>/dev/null | gzip -1 > "$F" || exit 1',
  '  wc -c < "$F" | tr -d " \\r\\t"',
  '  cat "$F" || exit 1',
  'done',
].join('\n')

function stopLiveSession(key) {
  const s = screencapLive[key]
  if (!s) return
  s.dead = true
  try { if (s.child) s.child.kill('SIGKILL') } catch (_) {}
  delete screencapLive[key]
}

function pumpLiveEncode(key) {
  const s = screencapLive[key]
  if (!s || s.dead || s.encoding) return
  if (!s.pendingGz) return
  s.encoding = true

  const run = () => {
    while (s && !s.dead && s.pendingGz) {
      const gz = s.pendingGz
      const startedAt = s.pendingStartedAt || Date.now()
      s.pendingGz = null
      s.pendingStartedAt = 0
      let raw
      try {
        const zlib = getZlib()
        if (!zlib) break
        raw = zlib.gunzipSync(gz)
      } catch (_) {
        s.failCount = (s.failCount || 0) + 1
        continue
      }
      const out = jpegFromRawBuffer(raw, s.scale, s.jpegQuality)
      if (out && out.ok && typeof s.onFrame === 'function') {
        s.failCount = 0
        s.gotFrame = true
        if (s.timer) {
          clearTimeout(s.timer)
          s.timer = null
        }
        out.startedAt = startedAt
        out.ms = Date.now() - startedAt
        try { s.onFrame(out) } catch (_) {}
      } else {
        s.failCount = (s.failCount || 0) + 1
      }
      // 连续解码失败 → 回退
      if ((s.failCount || 0) >= 3) {
        const onError = s.onError
        stopLiveSession(key)
        if (typeof onError === 'function') {
          try { onError('常驻推流解码失败') } catch (_) {}
        }
        return
      }
    }
    if (s) s.encoding = false
    if (s && !s.dead && s.pendingGz) pumpLiveEncode(key)
  }

  setTimeout(run, 0)
}

/**
 * 常驻 screencap 推流（单进程循环，省掉每帧 adb 启动开销）。
 * 失败时返回 ok:false，调用方回退到 adbScreencapFrame 轮询。
 * @param {{ serial?: string, scale?: number, jpegQuality?: number, onFrame: Function, onError?: Function }} opts
 */
window.adbScreencapStreamStart = function(opts) {
  const options = opts || {}
  const key = prefetchKey(options.serial)
  stopLiveSession(key)
  window.adbScreencapClearPrefetch(options.serial)

  if (!getZlib() || !getNativeImage()) {
    return { ok: false, error: '缺少 zlib/nativeImage' }
  }

  const serialArgs = []
  if (options.serial) serialArgs.push('-s', String(options.serial))
  const adbBin = resolveAdbBin()
  let child
  try {
    child = spawn(adbBin, serialArgs.concat(['exec-out', 'sh', '-c', LIVE_SHELL]), { shell: false })
  } catch (e) {
    return { ok: false, error: String(e) }
  }

  const session = {
    child,
    dead: false,
    scale: Math.min(1, Math.max(0.15, Number(options.scale) || 1)),
    jpegQuality: Math.min(100, Math.max(20, Math.round(Number(options.jpegQuality) || 70))),
    onFrame: options.onFrame,
    onError: options.onError,
    buf: Buffer.alloc(0),
    state: 'size', // size | data
    expect: 0,
    pendingGz: null,
    // 下一帧在设备上开始抓屏的近似时间（上一帧传完后 shell 立刻进入下一轮 screencap）
    nextCaptureAt: Date.now(),
    pendingStartedAt: 0,
    encoding: false,
    gotFrame: false,
    failCount: 0,
    timer: null,
  }
  screencapLive[key] = session

  // 5s 内收不到可解码首帧则视为失败
  session.timer = setTimeout(() => {
    if (session.dead || session.gotFrame) return
    const err = '常驻推流首帧超时'
    stopLiveSession(key)
    if (typeof session.onError === 'function') {
      try { session.onError(err) } catch (_) {}
    }
  }, 5000)

  child.stdout.on('data', (chunk) => {
    if (session.dead) return
    session.buf = Buffer.concat([session.buf, Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)])
    // 防止异常堆积
    if (session.buf.length > 64 * 1024 * 1024) {
      session.buf = Buffer.alloc(0)
      session.state = 'size'
      return
    }
    while (!session.dead) {
      if (session.state === 'size') {
        const nl = session.buf.indexOf(0x0a)
        if (nl < 0) break
        let line = session.buf.subarray(0, nl).toString('utf8').trim()
        session.buf = session.buf.subarray(nl + 1)
        // 兼容 \r\n
        if (line.endsWith('\r')) line = line.slice(0, -1)
        const n = parseInt(line, 10)
        if (!Number.isFinite(n) || n < 32 || n > 40 * 1024 * 1024) {
          // 同步噪音，继续找下一行
          continue
        }
        session.expect = n
        session.state = 'data'
        // size 行：设备端本帧 screencap|gzip 已完成；起点用上一帧传完后的标记（覆盖旧帧，避免丢帧拖高延迟）
        session.pendingStartedAt = session.nextCaptureAt || Date.now()
      } else {
        if (session.buf.length < session.expect) break
        const gz = Buffer.from(session.buf.subarray(0, session.expect))
        session.buf = session.buf.subarray(session.expect)
        session.state = 'size'
        // 本帧数据收齐；下一帧设备马上开始 screencap
        session.pendingGz = gz
        if (!session.pendingStartedAt) {
          session.pendingStartedAt = session.nextCaptureAt || Date.now()
        }
        session.nextCaptureAt = Date.now()
        pumpLiveEncode(key)
      }
    }
  })

  child.stderr.on('data', () => {})
  child.on('error', (e) => {
    if (session.dead) return
    const err = String(e)
    stopLiveSession(key)
    if (typeof session.onError === 'function') {
      try { session.onError(err) } catch (_) {}
    }
  })
  child.on('close', () => {
    if (session.dead) return
    const onError = session.onError
    stopLiveSession(key)
    if (typeof onError === 'function') {
      try { onError('常驻推流已退出') } catch (_) {}
    }
  })

  return { ok: true }
}

window.adbScreencapStreamUpdate = function(opts) {
  const options = opts || {}
  const s = screencapLive[prefetchKey(options.serial)]
  if (!s || s.dead) return { ok: false }
  if (options.scale != null) {
    s.scale = Math.min(1, Math.max(0.15, Number(options.scale) || 1))
  }
  if (options.jpegQuality != null) {
    s.jpegQuality = Math.min(100, Math.max(20, Math.round(Number(options.jpegQuality) || 70)))
  }
  return { ok: true }
}

window.adbScreencapStreamStop = function(serial) {
  stopLiveSession(prefetchKey(serial))
  return { ok: true }
}

/**
 * Fast screencap frame: raw+gzip 优先；预取下一帧与 JPEG 编码重叠。
 * @param {{ serial?: string, scale?: number, jpegQuality?: number }} opts
 */
window.adbScreencapFrame = async function(opts) {
  const options = opts || {}
  const scale = Math.min(1, Math.max(0.15, Number(options.scale) || 1))
  const jpegQuality = Math.min(100, Math.max(20, Math.round(Number(options.jpegQuality) || 70)))
  const serialArgs = []
  if (options.serial) serialArgs.push('-s', String(options.serial))
  const modeKey = prefetchKey(options.serial)
  let mode = screencapModeBySerial[modeKey] || 'gzip-raw'

  let fetched = null
  const slot = screencapPrefetch[modeKey]
  if (slot && slot.promise && slot.mode === mode) {
    fetched = await slot.promise
    slot.promise = null
  }
  if (!fetched) {
    fetched = mode === 'png'
      ? await fetchPngBuffer(serialArgs)
      : await fetchGzipRawBuffer(serialArgs)
  }

  // gzip-raw 不可用时回退并锁定 png
  if ((!fetched || !fetched.buffer) && mode !== 'png') {
    screencapModeBySerial[modeKey] = 'png'
    mode = 'png'
    fetched = await fetchPngBuffer(serialArgs)
  }

  if (fetched && fetched.kind === 'raw') {
    screencapModeBySerial[modeKey] = 'gzip-raw'
    mode = 'gzip-raw'
  } else if (fetched && fetched.kind === 'png') {
    // 本帧是 png：若此前未确认 gzip，则锁定 png
    if (screencapModeBySerial[modeKey] !== 'gzip-raw') {
      screencapModeBySerial[modeKey] = 'png'
      mode = 'png'
    }
  }

  // 编码前踢下一帧预取，与 toJPEG/downsample 重叠
  if (fetched && fetched.buffer) {
    startPrefetch(modeKey, serialArgs, mode === 'png' ? 'png' : 'gzip-raw')
  }

  let out = encodeFetched(fetched, scale, jpegQuality)
  if (out && out.ok) {
    // startedAt = 本帧 adb 真正开始的时间（含预取），供 UI 算真实延迟
    out.startedAt = fetched.startedAt || Date.now()
    out.ms = Date.now() - out.startedAt
    return out
  }

  // raw 解码失败 → 改走 png
  if (mode !== 'png') {
    screencapModeBySerial[modeKey] = 'png'
    const pngFetched = await fetchPngBuffer(serialArgs)
    startPrefetch(modeKey, serialArgs, 'png')
    out = encodeFetched(pngFetched, scale, jpegQuality)
    if (out && out.ok) {
      out.startedAt = (pngFetched && pngFetched.startedAt) || Date.now()
      out.ms = Date.now() - out.startedAt
      return out
    }
  }

  return { ok: false, error: 'screencap 失败', mime: '', base64: '' }
}

window.adbSpawn = function(args, onLine, onExit) {
  const adbBin = resolveAdbBin()
  let child
  try {
    child = spawn(adbBin, args, { shell: false })
  } catch (e) {
    if (onExit) onExit(-1, 'adb 未安装或不在 PATH')
    return { kill() {} }
  }
  let buf = ''
  child.stdout.on('data', (d) => {
    buf += d.toString()
    const lines = buf.split('\n')
    buf = lines.pop()
    for (const line of lines) {
      if (line) onLine(line)
    }
  })
  child.stderr.on('data', (d) => {
    const text = d.toString()
    for (const line of text.split('\n')) {
      if (line) onLine(line)
    }
  })
  child.on('close', (code) => {
    if (buf) { onLine(buf); buf = '' }
    if (onExit) onExit(code || 0, '')
  })
  child.on('error', (e) => {
    if (onExit) onExit(-1, String(e))
  })
  return {
    kill() {
      try { child.kill('SIGKILL') } catch (_) {}
    }
  }
}

// ========== scrcpy ==========
let scrcpyBinCached = null
function resolveScrcpyBin() {
  if (scrcpyBinCached) return scrcpyBinCached
  const isWin = process.platform === 'win32'
  const binName = isWin ? 'scrcpy.exe' : 'scrcpy'
  const home = os.homedir()
  const candidates = []

  // 常见安装路径
  candidates.push(
    path.join('/opt/homebrew/bin', binName),
    path.join('/usr/local/bin', binName),
    path.join(home, '.local', 'bin', binName),
  )
  if (isWin) {
    if (process.env.LOCALAPPDATA) {
      candidates.push(path.join(process.env.LOCALAPPDATA, 'scrcpy', binName))
      candidates.push(path.join(process.env.LOCALAPPDATA, 'Programs', 'scrcpy', binName))
    }
    if (process.env.ProgramFiles) {
      candidates.push(path.join(process.env.ProgramFiles, 'scrcpy', binName))
    }
    candidates.push(path.join('C:\\scrcpy', binName))
  }

  for (const dir of (process.env.PATH || '').split(path.delimiter)) {
    if (dir) candidates.push(path.join(dir, binName))
  }

  for (const c of candidates) {
    try {
      if (fs.existsSync(c)) {
        scrcpyBinCached = c
        return scrcpyBinCached
      }
    } catch (_) {}
  }

  if (!isWin) {
    try {
      const { execSync } = require('node:child_process')
      const shell = process.env.SHELL || '/bin/zsh'
      const out = execSync(shell + ' -lc "command -v scrcpy"', {
        encoding: 'utf8',
        timeout: 3000,
        env: process.env,
      }).trim().split('\n')[0]
      if (out && fs.existsSync(out)) {
        scrcpyBinCached = out
        return scrcpyBinCached
      }
    } catch (_) {}
  }

  scrcpyBinCached = binName
  return scrcpyBinCached
}

/** serial -> { child, logs, startedAt, args } */
const scrcpySessions = Object.create(null)
const SCRCPY_LOG_MAX = 200

function scrcpySessionKey(serial) {
  return serial ? String(serial) : '_'
}

function pushScrcpyLog(session, line) {
  if (!session || !line) return
  session.logs.push({
    time: new Date().toLocaleTimeString(),
    text: String(line).replace(/\s+$/, ''),
  })
  if (session.logs.length > SCRCPY_LOG_MAX) {
    session.logs.splice(0, session.logs.length - SCRCPY_LOG_MAX)
  }
}

function killScrcpySession(key, opts) {
  const options = opts || {}
  const s = scrcpySessions[key]
  if (!s) return false
  const serial = s.serial
  const prevStayOn = s.prevStayOn
  const usedStayAwake = s.usedStayAwake
  const child = s.child
  delete scrcpySessions[key]

  const force = !!options.force
  try {
    if (child) child.kill(force ? 'SIGKILL' : 'SIGTERM')
  } catch (_) {}

  // 先给 scrcpy CleanUp 一点时间还原设置，再强杀 + 兜底清理
  const delay = force ? 100 : 1500
  setTimeout(() => {
    try {
      if (child && !child.killed) child.kill('SIGKILL')
    } catch (_) {}
    cleanupDeviceAfterScrcpy(serial, { prevStayOn, usedStayAwake })
  }, delay)
  return true
}

function adbShellQuick(serial, shellArgs, timeoutMs) {
  try {
    const { execFileSync } = require('node:child_process')
    const adbBin = resolveAdbBin()
    const args = []
    if (serial) args.push('-s', String(serial))
    args.push('shell')
    for (const a of shellArgs) args.push(String(a))
    return execFileSync(adbBin, args, {
      encoding: 'utf8',
      timeout: typeof timeoutMs === 'number' ? timeoutMs : 3000,
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim()
  } catch (_) {
    return ''
  }
}

/**
 * 清理设备端残留 scrcpy，并还原 stay-awake 等设置（异常断开时 CleanUp 常跑不完，手机会一直“充电常亮”导致发烫卡顿）
 */
function cleanupDeviceAfterScrcpy(serial, opts) {
  const options = opts || {}
  const adbBin = resolveAdbBin()
  const prefix = []
  if (serial) prefix.push('-s', String(serial))

  let stayRestore = '0'
  if (options.prevStayOn != null && String(options.prevStayOn).trim() !== '' && String(options.prevStayOn).trim() !== 'null') {
    stayRestore = String(options.prevStayOn).trim()
  } else if (options.usedStayAwake || options.forceRestoreStayOn) {
    stayRestore = '0'
  }

  const script = [
    // 杀残留 server（多种进程名）
    'pkill -f scrcpy-server >/dev/null 2>&1 || true',
    'pkill -f app_process.*scrcpy >/dev/null 2>&1 || true',
    'pkill -f com.genymobile.scrcpy >/dev/null 2>&1 || true',
    // 还原「充电时保持唤醒」——投屏后卡顿的常见原因
    'settings put global stay_on_while_plugged_in ' + stayRestore + ' >/dev/null 2>&1 || true',
    // 顺手关掉可能残留的显示触摸
    'settings put system show_touches 0 >/dev/null 2>&1 || true',
    // 亮一下屏，方便后续桌面抓帧
    'input keyevent 224 >/dev/null 2>&1 || true',
    'true',
  ].join('; ')

  const killArgs = prefix.concat(['shell', 'sh', '-c', script])
  try {
    const c = spawn(adbBin, killArgs, { shell: false, stdio: 'ignore' })
    c.on('error', () => {})
  } catch (_) {}
}

window.scrcpyCheck = function() {
  const bin = resolveScrcpyBin()

  return new Promise((resolve) => {
    let child
    try {
      child = spawn(bin, ['--version'], { shell: false })
    } catch (e) {
      resolve({
        ok: false,
        path: bin,
        version: '',
        error: '未找到 scrcpy，请先安装（macOS: brew install scrcpy）',
      })
      return
    }
    let out = ''
    let err = ''
    const timer = setTimeout(() => {
      try { child.kill('SIGKILL') } catch (_) {}
      resolve({
        ok: false,
        path: bin,
        version: '',
        error: 'scrcpy --version 超时',
      })
    }, 4000)
    child.stdout.on('data', (d) => { out += d.toString() })
    child.stderr.on('data', (d) => { err += d.toString() })
    child.on('error', (e) => {
      clearTimeout(timer)
      resolve({
        ok: false,
        path: bin,
        version: '',
        error: e.code === 'ENOENT'
          ? '未找到 scrcpy，请先安装（macOS: brew install scrcpy）'
          : String(e),
      })
    })
    child.on('close', (code) => {
      clearTimeout(timer)
      const text = (out || err || '').trim()
      if (code === 0 || /scrcpy\s+\d/i.test(text)) {
        const ver = (text.split('\n')[0] || '').trim()
        scrcpyBinCached = bin
        resolve({ ok: true, path: bin, version: ver, error: '' })
      } else {
        resolve({
          ok: false,
          path: bin,
          version: '',
          error: text || 'scrcpy 不可用',
        })
      }
    })
  })
}

window.scrcpyStatus = function(serial) {
  if (serial != null && serial !== '') {
    const key = scrcpySessionKey(serial)
    const s = scrcpySessions[key]
    return {
      running: !!(s && s.child),
      serial: s ? s.serial : '',
      startedAt: s ? s.startedAt : 0,
      args: s ? s.args.slice() : [],
      logs: s ? s.logs.slice() : [],
    }
  }
  const keys = Object.keys(scrcpySessions)
  const list = keys.map((k) => {
    const s = scrcpySessions[k]
    return {
      serial: s.serial,
      startedAt: s.startedAt,
      args: s.args.slice(),
    }
  })
  return { running: list.length > 0, sessions: list }
}

window.scrcpyGetLogs = function(serial) {
  const s = scrcpySessions[scrcpySessionKey(serial)]
  return s ? s.logs.slice() : []
}

/**
 * @param {{
 *   serial?: string,
 *   maxSize?: number,
 *   bitRate?: string|number,
 *   maxFps?: number,
 *   stayAwake?: boolean,
 *   turnScreenOff?: boolean,
 *   onLog?: (line: string) => void,
 *   onExit?: (code: number, signal?: string) => void,
 * }} opts
 */
window.scrcpyStart = function(opts) {
  const options = opts || {}
  const serial = options.serial ? String(options.serial) : ''
  const key = scrcpySessionKey(serial)

  if (scrcpySessions[key] && scrcpySessions[key].child) {
    return { ok: false, error: '该设备已在投屏中' }
  }

  const bin = resolveScrcpyBin()
  const adbBin = resolveAdbBin()
  const args = []
  if (serial) args.push('-s', serial)

  const maxSize = Number(options.maxSize) || 0
  if (maxSize > 0) args.push('--max-size=' + maxSize)

  let bitRate = options.bitRate
  if (bitRate != null && bitRate !== '' && bitRate !== 0) {
    bitRate = String(bitRate)
    if (!/^\d+[kKmMgG]?$/.test(bitRate)) bitRate = '8M'
    args.push('--video-bit-rate=' + bitRate)
  }

  const maxFps = Number(options.maxFps) || 0
  if (maxFps > 0) args.push('--max-fps=' + maxFps)

  if (options.stayAwake) args.push('--stay-awake')
  if (options.turnScreenOff) args.push('--turn-screen-off')
  // 默认不开音频，减轻手机编码压力
  if (options.audio !== true) args.push('--no-audio')

  // 窗口标题便于识别
  if (serial) args.push('--window-title=zkit scrcpy (' + serial + ')')
  else args.push('--window-title=zkit scrcpy')

  const env = Object.assign({}, process.env, {
    ADB: adbBin,
  })

  // 记录 stay_on 原值，断开时还原（异常杀进程时 scrcpy CleanUp 经常跑不完）
  let prevStayOn = ''
  if (options.stayAwake) {
    prevStayOn = adbShellQuick(serial, ['settings', 'get', 'global', 'stay_on_while_plugged_in'])
  }

  let child
  try {
    child = spawn(bin, args, {
      shell: false,
      env,
    })
  } catch (e) {
    return {
      ok: false,
      error: e.code === 'ENOENT'
        ? '未找到 scrcpy，请先安装（macOS: brew install scrcpy）'
        : String(e),
    }
  }

  const session = {
    serial,
    child,
    args: args.slice(),
    startedAt: Date.now(),
    logs: [],
    prevStayOn,
    usedStayAwake: !!options.stayAwake,
    onLog: typeof options.onLog === 'function' ? options.onLog : null,
    onExit: typeof options.onExit === 'function' ? options.onExit : null,
  }
  scrcpySessions[key] = session

  pushScrcpyLog(session, 'start: ' + bin + ' ' + args.join(' '))
  if (prevStayOn !== '') {
    pushScrcpyLog(session, 'stay_on_while_plugged_in was ' + prevStayOn)
  }
  if (session.onLog) {
    try { session.onLog('start: ' + bin + ' ' + args.join(' ')) } catch (_) {}
  }

  const onChunk = (d) => {
    const text = d.toString()
    for (const line of text.split(/\r?\n/)) {
      if (!line) continue
      pushScrcpyLog(session, line)
      if (session.onLog) {
        try { session.onLog(line) } catch (_) {}
      }
    }
  }
  child.stdout.on('data', onChunk)
  child.stderr.on('data', onChunk)

  child.on('error', (e) => {
    const msg = e.code === 'ENOENT'
      ? '未找到 scrcpy，请先安装（macOS: brew install scrcpy）'
      : String(e)
    pushScrcpyLog(session, 'error: ' + msg)
    if (session.onLog) {
      try { session.onLog('error: ' + msg) } catch (_) {}
    }
    if (scrcpySessions[key] === session) delete scrcpySessions[key]
    cleanupDeviceAfterScrcpy(serial, {
      prevStayOn: session.prevStayOn,
      usedStayAwake: session.usedStayAwake,
    })
    if (session.onExit) {
      try { session.onExit(-1, msg) } catch (_) {}
    }
  })

  child.on('close', (code, signal) => {
    pushScrcpyLog(session, 'exit: code=' + (code == null ? '?' : code) + (signal ? ' signal=' + signal : ''))
    if (session.onLog) {
      try {
        session.onLog('exit: code=' + (code == null ? '?' : code) + (signal ? ' signal=' + signal : ''))
      } catch (_) {}
    }
    if (scrcpySessions[key] === session) delete scrcpySessions[key]
    // 正常退出也兜底清理一次（部分机型 CleanUp 不可靠）
    cleanupDeviceAfterScrcpy(serial, {
      prevStayOn: session.prevStayOn,
      usedStayAwake: session.usedStayAwake,
    })
    if (session.onExit) {
      try { session.onExit(code == null ? -1 : code, signal || '') } catch (_) {}
    }
  })

  return { ok: true, path: bin, args: args.slice() }
}

window.scrcpyStop = function(serial) {
  if (serial != null && serial !== '') {
    const key = scrcpySessionKey(serial)
    const killed = killScrcpySession(key, { force: false })
    // 无会话时也清理残留
    if (!killed) cleanupDeviceAfterScrcpy(serial, { forceRestoreStayOn: true })
    return { ok: true, killed }
  }
  const keys = Object.keys(scrcpySessions)
  for (const k of keys) killScrcpySession(k, { force: false })
  if (keys.length === 0) cleanupDeviceAfterScrcpy('', { forceRestoreStayOn: true })
  return { ok: true, killed: keys.length > 0 }
}

/** 桌面投屏前调用：停掉 scrcpy、清设备残留、亮屏 */
window.adbPrepareDesktopCapture = function(serial) {
  const key = scrcpySessionKey(serial)
  killScrcpySession(key, { force: true })
  cleanupDeviceAfterScrcpy(serial || '', { forceRestoreStayOn: true })
  const modeKey = serial ? String(serial) : '_'
  delete screencapModeBySerial[modeKey]
  try { window.adbScreencapStreamStop(serial) } catch (_) {}
  try { window.adbScreencapClearPrefetch(serial) } catch (_) {}
  return { ok: true }
}

/** 手动修复：清 scrcpy 残留并关闭「充电保持唤醒」 */
window.scrcpyFixDevice = function(serial) {
  const key = scrcpySessionKey(serial || '')
  killScrcpySession(key, { force: true })
  cleanupDeviceAfterScrcpy(serial || '', { forceRestoreStayOn: true })
  return { ok: true }
}