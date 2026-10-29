const fs = require('node:fs')
const path = require('node:path')
const os = require('node:os')
const { DatabaseSync } = require('node:sqlite')

const CHANNEL = 'cafe-notice:notice'
const INSTANCE = Math.random().toString(36).slice(2, 8)
const WPN_DIR = path.join(process.env.LOCALAPPDATA || '', 'Microsoft', 'Windows', 'Notifications')
const WPN_COPY_DIR = path.join(os.tmpdir(), 'cafe-notice-wpn')
const POLL_MS = 1500

let ipcRenderer = null
try {
  ipcRenderer = require('electron').ipcRenderer
} catch (e) {
  /* 无 IPC 时浮层收不到推送，历史与主窗口仍可用 */
}

const KNOWN_APPS = {
  'com.qoder.app': 'Qoder',
  'top.z-tools': 'ZTools',
  'windows.immersivecontrolpanel': '设置',
  'Microsoft.Windows.ContentDeliveryManager': 'Windows 聚焦',
  'Microsoft.WindowsStore_8wekyb3d8bbwe!App': 'Microsoft Store',
  'Microsoft.MicrosoftEdge_8wekyb3d8bbwe!MicrosoftEdge': 'Edge'
}

const PALETTE = ['#4f8cff', '#a06bff', '#ff8f4f', '#3ecf6b', '#ff5c7a', '#22b8cf', '#f2c94c', '#9575cd']

const DEFAULT_CONFIG = {
  enabled: '1',
  danmaku: '1',
  list: '1',
  stayMs: '4000',
  keepDays: '30',
  keepMax: '5000',
  historyLimit: '200',
  mergeWindowMs: '5000',
  mergeAfter: '3',
  dmSpeed: '140',
  dmDirection: 'rtl',
  dmPosition: 'top',
  dmLanes: '3',
  dmFontSize: '13',
  dmBg: '#14161c',
  dmOpacity: '0.78',
  dmSpan: 'all',
  dmText: '',
  dmBorder: 'none',
  dmEmoji: '',
  showApp: '1',
  showTime: '0',
  listDisplay: 'primary',
  listCorner: 'tr',
  listWidth: '380',
  listMax: '6',
  listBg: '#181a20',
  listOpacity: '0.92',
  listText: ''
}

let db = null
function getDb() {
  if (db) return db
  const dir = path.join(window.ztools.getPath('userData'), 'cafe-notice')
  fs.mkdirSync(dir, { recursive: true })
  db = new DatabaseSync(path.join(dir, 'history.db'))
  db.exec(`
    CREATE TABLE IF NOT EXISTS notice(
      id INTEGER PRIMARY KEY,
      aumid TEXT NOT NULL DEFAULT '',
      title TEXT NOT NULL DEFAULT '',
      body TEXT NOT NULL DEFAULT '',
      logo TEXT NOT NULL DEFAULT '',
      arrived_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS app_config(
      aumid TEXT PRIMARY KEY,
      name TEXT,
      color TEXT,
      mode TEXT,
      muted INTEGER NOT NULL DEFAULT 0
    );
    CREATE TABLE IF NOT EXISTS config(key TEXT PRIMARY KEY, value TEXT);
  `)
  try {
    db.exec('alter table app_config add column suppress_banner INTEGER NOT NULL DEFAULT 0')
  } catch (e) {
    /* 列已存在 */
  }
  return db
}

// Statement 不缓存会每次查询泄漏一个原生句柄（内存持续增长的来源）
const stmtCache = new Map()
function prep(sql) {
  let s = stmtCache.get(sql)
  if (!s) {
    s = getDb().prepare(sql)
    stmtCache.set(sql, s)
  }
  return s
}

function getConfig() {
  const cfg = Object.assign({}, DEFAULT_CONFIG)
  for (const row of prep('select key, value from config').all()) cfg[row.key] = row.value
  return cfg
}

function setConfig(patch) {
  const stmt = prep(
    'insert into config(key, value) values(?, ?) on conflict(key) do update set value = excluded.value'
  )
  for (const [key, value] of Object.entries(patch || {})) stmt.run(key, String(value))
}

function getAppConfig(aumid) {
  return prep('select * from app_config where aumid = ?').get(aumid) || null
}

function setAppConfig(aumid, patch) {
  const cur = getAppConfig(aumid) || {}
  const next = {
    name: patch.name !== undefined ? patch.name : cur.name || null,
    color: patch.color !== undefined ? patch.color : cur.color || null,
    mode: patch.mode !== undefined ? patch.mode : cur.mode || null,
    muted: patch.muted !== undefined ? (patch.muted ? 1 : 0) : cur.muted || 0,
    suppress_banner:
      patch.suppressBanner !== undefined ? (patch.suppressBanner ? 1 : 0) : cur.suppress_banner || 0
  }
  prep(
      `insert into app_config(aumid, name, color, mode, muted, suppress_banner) values(?, ?, ?, ?, ?, ?)
       on conflict(aumid) do update set name = excluded.name, color = excluded.color,
         mode = excluded.mode, muted = excluded.muted, suppress_banner = excluded.suppress_banner`
    )
    .run(aumid, next.name, next.color, next.mode, next.muted, next.suppress_banner)
}

function hashText(text) {
  let h = 5381
  for (let i = 0; i < text.length; i++) h = ((h << 5) + h + text.charCodeAt(i)) | 0
  return Math.abs(h)
}

function deriveName(aumid) {
  const s = String(aumid)
  if (/^NotifyIconGeneratedAumid_/i.test(s) || /^\{[0-9a-f-]+\}$/i.test(s)) return '未知应用'
  const seg = s
    .split('!')[0]
    .split('.')
    .filter((x) => x && !/^(com|org|net|cn|io|app|electron)$/i.test(x))
  let base = seg[1] || seg[0] || s
  if (/^(windows|microsoft|system)$/i.test(base) && seg[2]) base = seg[2]
  base = base.replace(/_.*$/, '')
  const PRETTY = {
    SystemToast: '系统通知',
    ActionCenter: '通知中心',
    SecurityCenter: 'Windows 安全中心',
    Defender: 'Windows 安全中心',
    immersivecontrolpanel: '设置',
    MicrosoftOfficeHub: 'Office',
    SkyDrive: 'OneDrive',
    windowscommunicationsapps: '邮件/日历',
    YourPhone: '手机连接',
    InputSwitch: '输入法',
    AutoPlay: '自动播放'
  }
  for (const key of Object.keys(PRETTY)) {
    if (base.toLowerCase().startsWith(key.toLowerCase())) return PRETTY[key]
  }
  return base
}

// 外部进程一律异步：spawnSync 会阻塞渲染进程主线程，造成切页/发通知卡顿
const { execFile } = require('node:child_process')
function run(file, args) {
  return new Promise((resolve) => {
    execFile(file, args, { windowsHide: true, timeout: 25000, encoding: 'buffer' }, (err, stdout, stderr) => {
      const buf = stdout || Buffer.alloc(0)
      resolve({ err, text: new TextDecoder('gbk').decode(buf), stderr: String(stderr || '') })
    })
  })
}

// 非打包应用（IDEA 等）用生成 AUMID，真实显示名在 AppUserModelId 键的 DisplayName
const AUMID_KEY = 'HKCU\\Software\\Classes\\AppUserModelId\\'
const nameValue = new Map()
const namePending = new Map()
function warmName(aumid) {
  if (nameValue.has(aumid)) return Promise.resolve(nameValue.get(aumid))
  if (namePending.has(aumid)) return namePending.get(aumid)
  const p = run('reg.exe', ['query', AUMID_KEY + aumid, '/v', 'DisplayName']).then((r) => {
    let name = null
    if (!r.err) {
      const m = /DisplayName\s+REG_SZ\s+(.+)/.exec(r.text)
      if (m) name = m[1].trim()
    }
    nameValue.set(aumid, name)
    namePending.delete(aumid)
    return name
  })
  namePending.set(aumid, p)
  return p
}
function warmNames(aumids) {
  return Promise.all(Array.from(new Set(aumids)).map(warmName))
}

function resolveApp(aumid) {
  const cfg = getAppConfig(aumid)
  return {
    aumid,
    name: (cfg && cfg.name) || KNOWN_APPS[aumid] || nameValue.get(aumid) || deriveName(aumid),
    color: (cfg && cfg.color) || PALETTE[hashText(aumid) % PALETTE.length],
    mode: (cfg && cfg.mode) || 'both',
    muted: !!(cfg && cfg.muted),
    suppressBanner: !!(cfg && cfg.suppress_banner)
  }
}

const BANNER_BASE = 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Notifications\\Settings'
const BANNER_KEY = BANNER_BASE + '\\'

let appListCache = { at: 0, list: [] }
async function registryAppList() {
  if (Date.now() - appListCache.at < 60000) return appListCache.list
  const r = await run('reg.exe', ['query', BANNER_BASE])
  const list = []
  if (!r.err) {
    for (const line of r.text.split(/\r?\n/)) {
      const t = line.trim()
      if (!t.startsWith('HKEY_')) continue
      const aumid = t.slice(t.lastIndexOf('\\') + 1)
      if (aumid) list.push(aumid)
    }
  }
  appListCache = { at: Date.now(), list }
  return list
}

async function readBanner(aumid) {
  const r = await run('reg.exe', ['query', BANNER_KEY + aumid, '/v', 'ShowBanner'])
  if (r.err) return null
  const m = /ShowBanner\s+REG_DWORD\s+0x([0-9a-f]+)/i.exec(r.text)
  return m ? parseInt(m[1], 16) : null
}

async function writeBanner(aumid, value) {
  const args =
    value === null
      ? ['delete', BANNER_KEY + aumid, '/v', 'ShowBanner', '/f']
      : ['add', BANNER_KEY + aumid, '/v', 'ShowBanner', '/t', 'REG_DWORD', '/d', String(value), '/f']
  const r = await run('reg.exe', args)
  return !r.err
}

const TEST_AUMID = 'cafe.notice.test'
let testIdentityReady = false

async function ensureTestIdentity() {
  if (testIdentityReady) return
  testIdentityReady = true
  await run('reg.exe', ['add', AUMID_KEY + TEST_AUMID, '/v', 'DisplayName', '/t', 'REG_SZ', '/d', 'cafe-notice 测试', '/f'])
  await writeBanner(TEST_AUMID, 0)
}

/** 测试通知用自己的 AUMID 身份发 WinRT toast，不顶 ZTools 的名字 */
async function sendTestNotification() {
  if (process.platform !== 'win32') return false
  await ensureTestIdentity()
  const stamp = new Date().toLocaleTimeString('zh-CN')
  const xml =
    '<toast><visual><binding template="ToastGeneric"><text>测试通知</text><text>' +
    stamp +
    ' · 来自 cafe-notice</text></binding></visual></toast>'
  const ps = [
    '[Windows.UI.Notifications.ToastNotificationManager, Windows.UI.Notifications, ContentType=WindowsRuntime] | Out-Null',
    '[Windows.Data.Xml.Dom.XmlDocument, Windows.Data.Xml.Dom, ContentType=WindowsRuntime] | Out-Null',
    '$xml = New-Object Windows.Data.Xml.Dom.XmlDocument',
    "$xml.LoadXml('" + xml.replace(/'/g, "''") + "')",
    '$toast = New-Object Windows.UI.Notifications.ToastNotification $xml',
    "[Windows.UI.Notifications.ToastNotificationManager]::CreateToastNotifier('" + TEST_AUMID + "').Show($toast)"
  ].join('\n')
  const r = await run('powershell.exe', [
    '-NoProfile',
    '-NonInteractive',
    '-EncodedCommand',
    Buffer.from(ps, 'utf16le').toString('base64')
  ])
  return !r.err
}

/** 接管/恢复某应用的原生横幅；通知仍进通知中心与采集库 */
async function setSuppressBanner(aumid, on) {
  const origKey = 'bannerOrig:' + aumid
  if (on) {
    if (getConfig()[origKey] === undefined) {
      const cur = await readBanner(aumid)
      setConfig({ [origKey]: cur === null ? 'absent' : String(cur) })
    }
    await writeBanner(aumid, 0)
  } else {
    const orig = getConfig()[origKey]
    await writeBanner(aumid, orig === undefined || orig === 'absent' ? null : Number(orig))
  }
  setAppConfig(aumid, { suppressBanner: on ? 1 : 0 })
  return readBanner(aumid)
}

function decodeEntities(text) {
  return text
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&amp;/g, '&')
}

function parseToast(payload) {
  const buf = Buffer.isBuffer(payload) ? payload : Buffer.from(payload)
  let xml = buf.toString('utf16le')
  if (xml.indexOf('<') < 0 || xml.indexOf('\u0000') >= 0) xml = buf.toString('utf8')
  const texts = []
  const re = /<text[^>]*>([\s\S]*?)<\/text>/g
  let m
  while ((m = re.exec(xml))) texts.push(decodeEntities(m[1]).trim())
  const logo = /<image[^>]*\ssrc="([^"]*)"/.exec(xml)
  return {
    title: texts[0] || '',
    body: texts.slice(1).filter(Boolean).join('\n'),
    logo: logo ? logo[1] : ''
  }
}

function nowFiletime() {
  return (BigInt(Date.now()) + 11644473600000n) * 10000n
}

function filetimeToMs(filetime) {
  return Number(BigInt(filetime) / 10000n - 11644473600000n)
}

const status = { lastPollAt: 0, lastError: null, pollCount: 0, collected: 0, overlayError: null }

const LIST_MAX_HEIGHT = 560
const overlays = { danmaku: null, list: null }
let listReady = false
const listBacklog = []
const overlayIdByMode = { danmaku: null, list: null }
const modeById = new Map()
const pingAt = { danmaku: 0, list: 0 }
const bornAt = { danmaku: 0, list: 0 }
const overlayIds = new Set()
const messageListeners = []
let hostId = null
let lastPong = Date.now()

if (ipcRenderer) {
  ipcRenderer.on(CHANNEL, (event, msg) => {
    if (msg && msg.t === 'hello' && event && event.senderId) {
      overlayIds.add(event.senderId)
      if (msg.mode === 'list') {
        listReady = true
        for (const entry of listBacklog.splice(0, listBacklog.length)) {
          try {
            ipcRenderer.sendTo(event.senderId, CHANNEL, { t: 'notice', entry })
          } catch (e) {
            /* 窗已死 */
          }
        }
      }
      return
    }
    if (msg && msg.t === 'ping' && msg.mode) {
      pingAt[msg.mode] = Date.now()
      if (event && event.senderId && ipcRenderer) {
        try {
          ipcRenderer.sendTo(event.senderId, CHANNEL, { t: 'pong' })
        } catch (e) {
          /* 浮层已死 */
        }
      }
      return
    }
    if (msg && msg.t === 'pong') {
      lastPong = Date.now()
      return
    }
    if (msg && msg.t === 'notice') {
      if (event && event.senderId) hostId = event.senderId
      for (const fn of messageListeners.slice()) {
        try {
          fn(msg.entry)
        } catch (e) {
          /* 单个监听器异常不影响其他 */
        }
      }
      return
    }
    if (msg && msg.t === 'listHeight') applyListHeight(msg.h)
  })
}


function allDisplays() {
  try {
    const ds = window.ztools.getAllDisplays()
    if (ds && ds.length) return ds
  } catch (e) {
    /* 回退主屏 */
  }
  return [window.ztools.getPrimaryDisplay()]
}

function unionWorkArea() {
  let x1 = Infinity
  let y1 = Infinity
  let x2 = -Infinity
  let y2 = -Infinity
  for (const d of allDisplays()) {
    const w = d.workArea
    x1 = Math.min(x1, w.x)
    y1 = Math.min(y1, w.y)
    x2 = Math.max(x2, w.x + w.width)
    y2 = Math.max(y2, w.y + w.height)
  }
  return { x: x1, y: y1, width: x2 - x1, height: y2 - y1 }
}

function geometryFor(mode, cfg, currentHeight) {
  if (mode === 'danmaku') {
    const lanes = Math.max(1, Number(cfg.dmLanes) || 3)
    const height = lanes * 48 + 8
    const area = cfg.dmSpan === 'primary' ? window.ztools.getPrimaryDisplay().workArea : unionWorkArea()
    const y =
      cfg.dmPosition === 'bottom'
        ? area.y + area.height - height
        : cfg.dmPosition === 'middle'
          ? area.y + Math.round((area.height - height) / 2)
          : area.y
    return { x: area.x, y, width: area.width, height }
  }
  const ds = allDisplays()
  const d =
    cfg.listDisplay === 'primary'
      ? window.ztools.getPrimaryDisplay()
      : ds.find((x) => String(x.id) === String(cfg.listDisplay)) || window.ztools.getPrimaryDisplay()
  const width = Number(cfg.listWidth) || 380
  const height = Math.max(1, Math.round(currentHeight || 1))
  const wa = d.workArea
  const m = 16
  const corner = cfg.listCorner || 'tr'
  const x = corner.includes('l') ? wa.x + m : wa.x + wa.width - width - m
  const y = corner.includes('t') ? wa.y + m : wa.y + wa.height - height - m
  return { x, y, width, height }
}

function overlayOptions(mode) {
  const base = {
    frame: false,
    transparent: true,
    alwaysOnTop: true,
    resizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    hasShadow: false,
    focusable: false,
    backgroundColor: '#00000000',
    webPreferences: { preload: 'preload/services.js', zoomFactor: 1 }
  }
  return Object.assign(base, geometryFor(mode, getConfig(), 1), {
    show: true,
    title: 'cafe-notice-' + mode
  })
}

/** 进入插件会新建 preload 实例而后台旧实例仍活着：用带心跳的锁选主，避免双采集器抢库 */
function isLeader() {
  // 浮层实例没有插件上下文（createBrowserWindow 会报 plugin not found），不能当 leader
  if (window.ztools.getWindowType() !== 'main') return false
  const now = Date.now()
  const raw = getConfig().collectorLock
  if (raw) {
    try {
      const lock = JSON.parse(raw)
      if (lock.instance !== INSTANCE && now - lock.at < 2500) return false
    } catch (e) {
      /* 坏锁当无锁 */
    }
  }
  setConfig({ collectorLock: JSON.stringify({ instance: INSTANCE, at: now }) })
  return true
}

function syncVisibility() {
  const cfg = getConfig()
  const dm = overlays.danmaku
  if (dm && !dm.isDestroyed()) {
    if (cfg.danmaku === '1') dm.show()
    else dm.hide()
  }
  const ls = overlays.list
  if (ls && cfg.list !== '1') destroyListWindow()
}

function createOverlay(mode) {
  const win = window.ztools.createBrowserWindow('dist/overlay.html?mode=' + mode, overlayOptions(mode))
  overlays[mode] = win
  overlayIdByMode[mode] = win.webContents.id
  modeById.set(win.webContents.id, mode)
  bornAt[mode] = Date.now()
  pingAt[mode] = Date.now()
  overlayIds.add(win.webContents.id)
  if (mode === 'danmaku') win.setIgnoreMouseEvents(true)
  if (mode === 'list') listReady = false
  return win
}

function destroyListWindow() {
  const win = overlays.list
  if (!win) return
  try {
    if (!win.isDestroyed()) win.destroy()
  } catch (e) {
    /* 已死 */
  }
  if (overlayIdByMode.list) {
    overlayIds.delete(overlayIdByMode.list)
    modeById.delete(overlayIdByMode.list)
  }
  overlayIdByMode.list = null
  overlays.list = null
  listReady = false
}

// 卡片窗按需创建、空闲销毁：省一个常驻渲染进程（约 60MB）
function ensureListWindow() {
  if (overlays.list && !overlays.list.isDestroyed()) return overlays.list
  try {
    return createOverlay('list')
  } catch (e) {
    status.overlayError = String((e && e.message) || e)
    return null
  }
}

function ensureOverlays() {
  if (!isLeader()) return
  const cfg = getConfig()
  const want = { danmaku: cfg.danmaku === '1', list: cfg.list === '1' }
  for (const mode of ['danmaku', 'list']) {
    let win = overlays[mode]
    // isDestroyed 有时不报真：渲染器心跳超 8s 也判死
    const stale =
      win && bornAt[mode] && Date.now() - bornAt[mode] > 8000 && Date.now() - (pingAt[mode] || 0) > 8000
    if (win && ((win.isDestroyed && win.isDestroyed()) || stale)) {
      if (overlayIdByMode[mode]) {
        overlayIds.delete(overlayIdByMode[mode])
        modeById.delete(overlayIdByMode[mode])
      }
      overlayIdByMode[mode] = null
      win = overlays[mode] = null
      if (mode === 'list') listReady = false
    }
    if (mode === 'danmaku' && want.danmaku && !win) {
      try {
        win = createOverlay('danmaku')
      } catch (e) {
        status.overlayError = String((e && e.message) || e)
      }
    }
    if (mode === 'list' && !want.list && win) {
      destroyListWindow()
      continue
    }
    if (win && !win.isDestroyed()) {
      if (mode === 'danmaku') {
        if (want.danmaku) win.show()
        else win.hide()
      }
      const cur = win.getBounds()
      const target = geometryFor(mode, cfg, cur.height)
      if (cur.x !== target.x || cur.y !== target.y || cur.width !== target.width || cur.height !== target.height) {
        win.setBounds(target)
      }
      // 置顶窗之间按激活顺序排：主窗一聚焦就会盖住浮层，每 tick 抬一次
      if (win.isVisible()) win.moveTop()
    }
  }
}

function applyListHeight(h) {
  const height = Math.round(Number(h) || 0)
  if (height > 0) {
    const win = ensureListWindow()
    if (!win) return
    win.setBounds(geometryFor('list', getConfig(), Math.min(height, LIST_MAX_HEIGHT)))
    win.show()
  } else {
    destroyListWindow()
  }
}

/** 同应用 mergeWindowMs 内第 mergeAfter+1 条起合并成「+N 条」；mergeAfter=0 关闭 */
const recentByApp = new Map()
function throttled(entry) {
  const cfg = getConfig()
  const after = Number(cfg.mergeAfter)
  if (!(after > 0)) return entry
  const windowMs = Number(cfg.mergeWindowMs) || 5000
  const now = Date.now()
  const rec = recentByApp.get(entry.aumid) || { times: [], extra: 0 }
  rec.times = rec.times.filter((t) => now - t < windowMs)
  if (rec.times.length === 0) rec.extra = 0
  rec.times.push(now)
  recentByApp.set(entry.aumid, rec)
  if (rec.times.length <= after) return entry
  rec.extra += 1
  return Object.assign({}, entry, { title: entry.name, body: '+' + rec.extra + ' 条', merged: rec.extra })
}

function broadcast(entry) {
  if (!ipcRenderer) return
  if (overlayIds.size === 0) ensureOverlays()
  const payload = throttled(entry)
  // 卡片窗按需重建期间渲染器还没挂载：先积压，hello 时补发
  if (payload.modes.includes('list') && !listReady) {
    listBacklog.push(payload)
    if (listBacklog.length > 4) listBacklog.shift()
    ensureListWindow()
  }
  for (const id of Array.from(overlayIds)) {
    try {
      ipcRenderer.sendTo(id, CHANNEL, { t: 'notice', entry: payload })
    } catch (e) {
      overlayIds.delete(id)
      const dead = modeById.get(id)
      if (dead) {
        modeById.delete(id)
        overlayIdByMode[dead] = null
        overlays[dead] = null
      }
    }
  }
}

function modesOf(app) {
  const cfg = getConfig()
  const global = []
  if (cfg.danmaku === '1') global.push('danmaku')
  if (cfg.list === '1') global.push('list')
  if (app.muted) return []
  if (app.mode === 'both') return global
  return global.filter((m) => m === app.mode)
}

function toView(row) {
  const app = resolveApp(row.aumid || '')
  return Object.assign({}, app, {
    id: Number(row.id),
    title: row.title || '',
    body: row.body || '',
    logo: row.logo || '',
    at: Number(row.arrived_at),
    modes: modesOf(app)
  })
}

async function pollOnce() {
  const out = { rows: 0, entries: [], error: null }
  fs.mkdirSync(WPN_COPY_DIR, { recursive: true })
  for (const file of ['wpndatabase.db', 'wpndatabase.db-wal', 'wpndatabase.db-shm']) {
    try {
      fs.copyFileSync(path.join(WPN_DIR, file), path.join(WPN_COPY_DIR, file))
    } catch (e) {
      /* wal/shm 并非时刻存在 */
    }
  }

  let snap
  try {
    snap = new DatabaseSync(path.join(WPN_COPY_DIR, 'wpndatabase.db'), { readOnly: true })
  } catch (e) {
    out.error = String((e && e.message) || e)
    return out
  }

  let rows
  try {
    const since = String(getConfig().lastFiletime || '0').padStart(20, '0')
    rows = snap
      .prepare(
        `select n.Id as id, cast(n.ArrivalTime as TEXT) as arrival, n.Payload as payload,
                h.PrimaryId as aumid
         from Notification n left join NotificationHandler h on h.RecordId = n.HandlerId
         where printf('%020d', n.ArrivalTime) > ?
         order by n.ArrivalTime`
      )
      .all(since)
  } catch (e) {
    out.error = String((e && e.message) || e)
    return out
  } finally {
    snap.close()
  }

  await warmNames(rows.map((r) => r.aumid || ''))

  const insert = prep(
    'insert or ignore into notice(id, aumid, title, body, logo, arrived_at) values(?, ?, ?, ?, ?, ?)'
  )
  let maxFiletime = 0n
  for (const row of rows) {
    const filetime = BigInt(row.arrival || '0')
    if (filetime > maxFiletime) maxFiletime = filetime
    const parsed = parseToast(row.payload || new Uint8Array(0))
    const changed = insert.run(
      Number(row.id),
      row.aumid || '',
      parsed.title,
      parsed.body,
      parsed.logo,
      filetimeToMs(row.arrival)
    )
    if (changed.changes > 0) {
      const entry = toView({
        id: row.id,
        aumid: row.aumid,
        title: parsed.title,
        body: parsed.body,
        logo: parsed.logo,
        arrived_at: filetimeToMs(row.arrival)
      })
      out.entries.push(entry)
      broadcast(entry)
    }
  }
  out.rows = rows.length
  if (maxFiletime > 0n) setConfig({ lastFiletime: String(maxFiletime) })
  return out
}

function prune() {
  const cfg = getConfig()
  const cutoff = Date.now() - Number(cfg.keepDays || 30) * 86400000
  prep('delete from notice where arrived_at < ?').run(cutoff)
  prep('delete from notice where id not in (select id from notice order by arrived_at desc limit ?)')
    .run(Number(cfg.keepMax || 5000))
}

let timer = null
function startCollector() {
  if (timer) return
  timer = setInterval(() => {
    if (getConfig().enabled !== '1') return
    if (!isLeader()) return
    ensureOverlays()
    pollOnce().then((res) => {
      status.lastPollAt = Date.now()
      status.pollCount += 1
      status.lastError = res.error
      status.collected += res.entries.length
      setConfig({
        stats: JSON.stringify({
          pollCount: status.pollCount,
          collected: status.collected,
          lastPollAt: status.lastPollAt,
          lastError: status.lastError,
          overlayCount: overlayIds.size,
          leader: INSTANCE
        })
      })
      if (status.pollCount % 120 === 0) prune()
    })
  }, POLL_MS)
}

if (!getConfig().lastFiletime) setConfig({ lastFiletime: String(nowFiletime()) })
// 采集依赖 wpndatabase / 注册表 / WinRT，仅 Windows 有意义；被侧载到其他平台时静默待命
const IS_WIN = process.platform === 'win32'
if (IS_WIN) {
  ensureTestIdentity()
  startCollector()
  for (const row of prep('select aumid from app_config where suppress_banner = 1').all()) {
    writeBanner(row.aumid, 0)
  }
}
// 僵尸浮层自检：leader 死后无人回 pong，8s 自关，避免孤儿窗越积越多
if (ipcRenderer && window.ztools.getWindowType() === 'browser') {
  setInterval(() => {
    if (Date.now() - lastPong > 8000) window.close()
  }, 2000)
}

setTimeout(() => {
  if (IS_WIN) ensureOverlays()
}, 300)

window.services = {
  notice: {
    getStatus() {
      let shared = {}
      try {
        shared = JSON.parse(getConfig().stats || '{}')
      } catch (e) {
        /* 无统计 */
      }
      return Object.assign({}, status, shared, {
        enabled: getConfig().enabled === '1',
        overlayCount: shared.overlayCount || overlayIds.size,
        historyCount: prep('select count(*) as c from notice').get().c
      })
    },
    setEnabled(on) {
      setConfig({ enabled: on ? '1' : '0' })
      if (on) startCollector()
      ensureOverlays()
    },
    getConfig,
    getDisplays() {
      return allDisplays().map((d) => ({
        id: String(d.id),
        label: (d.label || '显示器 ' + d.id) + ' · ' + d.size.width + '×' + d.size.height,
        primary: d.id === window.ztools.getPrimaryDisplay().id
      }))
    },
    setConfig(patch) {
      setConfig(patch)
      if (isLeader()) syncVisibility()
    },
    helloOverlay(mode) {
      try {
        window.ztools.sendToParent(CHANNEL, { t: 'hello', mode })
      } catch (e) {
        /* preload 建窗路径已登记，主窗缺席时不影响 */
      }
    },
    onMessage(fn) {
      if (typeof fn === 'function') messageListeners.push(fn)
    },
    pingOverlay(mode) {
      try {
        if (hostId && ipcRenderer) ipcRenderer.sendTo(hostId, CHANNEL, { t: 'ping', mode })
        else window.ztools.sendToParent(CHANNEL, { t: 'ping', mode })
      } catch (e) {
        /* 心跳失败下一轮再试 */
      }
    },
    bumpOverlays() {
      if (!isLeader()) return
      for (const mode of ['danmaku', 'list']) {
        const win = overlays[mode]
        if (win && !win.isDestroyed() && win.isVisible()) win.moveTop()
      }
    },
    reportListHeight(h) {
      // 窗口句柄只在主窗的 preload 实例里；子窗调用必须转回主窗
      if (window.ztools.getWindowType() !== 'main') {
        try {
          if (hostId && ipcRenderer) ipcRenderer.sendTo(hostId, CHANNEL, { t: 'listHeight', h })
          else window.ztools.sendToParent(CHANNEL, { t: 'listHeight', h })
        } catch (e) {
        }
        return
      }
      applyListHeight(h)
    },
    setSuppressBanner,
    ensureOverlays,
    collectOnce: pollOnce,
    getRecent(limit) {
      return prep('select * from notice order by arrived_at desc limit ?')
        .all(Number(limit) || 60)
        .map(toView)
    },
    search(keyword, limit) {
      const like = '%' + String(keyword || '') + '%'
      return prep('select * from notice where title like ? or body like ? order by arrived_at desc limit ?')
        .all(like, like, Number(limit) || 200)
        .map(toView)
    },
    async getApps() {
      const map = new Map()
      for (const row of prep('select aumid, count(*) as count, max(arrived_at) as lastAt from notice group by aumid').all()) {
        map.set(row.aumid, { count: row.count, lastAt: row.lastAt })
      }
      // 系统通知设置里登记过的应用 ⊇ 已采集应用，含从未被我们采到的
      for (const aumid of await registryAppList()) {
        if (!map.has(aumid)) map.set(aumid, { count: 0, lastAt: 0 })
      }
      await warmNames(Array.from(map.keys()))
      return Array.from(map.entries())
        .map(([aumid, v]) => Object.assign(resolveApp(aumid), v))
        .sort((a, b) => b.count - a.count)
    },
    setAppConfig,
    sendTestNotification,
    exportHistory(format, keyword, aumid) {
      let rows = prep('select * from notice order by arrived_at desc').all()
      if (aumid) rows = rows.filter((r) => r.aumid === aumid)
      if (keyword) {
        const k = String(keyword).toLowerCase()
        rows = rows.filter((r) => (r.title + r.body).toLowerCase().includes(k))
      }
      const views = rows.map(toView)
      const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
      const file = path.join(
        window.ztools.getPath('downloads'),
        'cafe-notice-' + stamp + '.' + (format === 'csv' ? 'csv' : 'json')
      )
      if (format === 'csv') {
        const esc = (v) => '"' + String(v == null ? '' : v).replace(/"/g, '""') + '"'
        const lines = ['时间,应用,AUMID,标题,正文'].concat(
          views.map((v) => [new Date(v.at).toLocaleString('zh-CN'), v.name, v.aumid, v.title, v.body].map(esc).join(','))
        )
        fs.writeFileSync(file, '﻿' + lines.join('\r\n'), 'utf-8')
      } else {
        fs.writeFileSync(file, JSON.stringify(views, null, 2), 'utf-8')
      }
      return file
    },
    clearHistory() {
      prep('delete from notice').run()
    }
  }
}
