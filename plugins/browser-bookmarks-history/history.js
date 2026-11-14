const path = require('path')
const fs = require('fs')
const os = require('os')
const initSqlJs = require('./lib/sql-wasm.js')

let _SQL = null
async function getSQL () {
  if (!_SQL) {
    const wasmBinary = fs.readFileSync(path.join(__dirname, 'lib', 'sql-wasm.wasm'))
    _SQL = await initSqlJs({ wasmBinary })
  }
  return _SQL
}

const PROFILES = ['Default', 'Profile 1', 'Profile 2', 'Profile 3', 'Profile 4']

// Windows FILETIME(100ns, 1601起) → 毫秒。部分来源的历史库时间单位异常（毫秒/微秒），
// 标准解释不合理时按其他单位回退，保证 1643 年这类错误不会出现；仍不合理返回 null。
const MS_FROM_FILETIME = 11644473600000
function _msInRange (ms) {
  const d = new Date(ms)
  return !isNaN(d.getTime()) && d.getFullYear() >= 2000 && d.getFullYear() <= 2100
}
function filetimeToMs (ft) {
  try {
    const raw = Number(ft)
    if (!isFinite(raw) || raw <= 0) return null
    const ms1 = Math.floor(raw / 10000) - MS_FROM_FILETIME
    if (_msInRange(ms1)) return ms1
    const ms2 = raw - MS_FROM_FILETIME
    if (_msInRange(ms2)) return ms2
    const ms3 = Math.floor(raw / 1000) - MS_FROM_FILETIME
    if (_msInRange(ms3)) return ms3
    return null
  } catch (e) { return null }
}
// 毫秒 → 本地日期 YYYY-MM-DD（无效返回空）
function msToDate (ms) {
  if (ms == null) return ''
  const d = new Date(ms)
  if (isNaN(d.getTime())) return ''
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const dd = String(d.getDate()).padStart(2, '0')
  return y + '-' + m + '-' + dd
}
function filetimeToDate (ft) {
  return msToDate(filetimeToMs(ft))
}

// 跳转中间 URL：浏览器历史页不显示这类跳转链接（Google goto、以及常见统计/跳转网关如
// api.limestart.cn/backend/counter-v2/redirect、/url、/jump、/redirect 等）
function isRedirectJump (url) {
  try {
    const u = new URL(url)
    const host = u.hostname || ''
    // Google 搜索跳转
    if (/^(www\.)?google\.(com|com\.hk|cn|co\.jp|de|fr|co\.uk|com\.tw)$/i.test(host) &&
        (u.pathname === '/goto' || u.pathname === '/url' || /^\/url(\/|$)/.test(u.pathname))) {
      return true
    }
    // 通用跳转网关：路径中独立出现 redirect / jump / goto / link 段（如
    // api.limestart.cn/backend/counter-v2/redirect?name=xxx 这类仅用于计数/中转的链接）
    const segments = u.pathname.split('/').filter(Boolean)
    for (const seg of segments) {
      if (/^(redirect|jump|goto|go|url|link|jumper|forward|proxy)$/i.test(seg)) {
        // 路径以跳转段结尾（后面只有参数），视为中间跳转链接
        if (seg === segments[segments.length - 1]) return true
      }
    }
  } catch (e) {}
  return false
}

function collectHistoryFiles (dataDirs) {
  const out = []
  const seenFiles = new Set()
  const pushFile = (browser, profile, file) => {
    if (!file) return
    let k
    try { k = browser + '::' + path.resolve(file) } catch (e) { k = browser + '::' + file }
    if (seenFiles.has(k)) return
    seenFiles.add(k)
    out.push({ browser, profile, file })
  }
  for (const { browser, dir } of dataDirs) {
    if (!dir) continue
    try { if (!fs.existsSync(dir)) continue } catch (e) { continue }
    // 支持两种配置：目录直接是个人资料目录（Default 本身，直接含 History 文件）
    // 或 User Data 根目录（含 Default / Profile N 子目录）
    const direct = path.join(dir, 'History')
    if (fs.existsSync(direct)) {
      pushFile(browser, path.basename(dir), direct)
      continue
    }
    for (const p of PROFILES) {
      const h = path.join(dir, p, 'History')
      try { if (fs.existsSync(h)) pushFile(browser, p, h) } catch (e) {}
    }
  }
  return out
}

async function readHistory (extraDirs, limit = 3000) {
  const dirs = []
  // 去重：同一数据目录只读取一次。
  // 安装版浏览器会被自动填入配置（cfg.edgeDirs 等）且默认路径也会无条件读取，两者指向同一目录时
  // 会导致历史记录条目重复（与书签去重逻辑一致）。
  const seen = new Set()
  const push = (browser, dir) => {
    if (!dir) return
    let key
    try { key = browser + '::' + path.resolve(dir) } catch (e) { key = browser + '::' + dir }
    if (seen.has(key)) return
    seen.add(key)
    dirs.push({ browser, dir })
  }
  if (process.platform === 'win32') {
    const la = process.env.LOCALAPPDATA
    if (la) {
      push('chrome', path.join(la, 'Google/Chrome/User Data'))
      push('edge', path.join(la, 'Microsoft/Edge/User Data'))
    }
  } else if (process.platform === 'darwin') {
    const home = process.env.HOME
    if (home) {
      push('chrome', path.join(home, 'Library/Application Support/Google/Chrome'))
      push('edge', path.join(home, 'Library/Application Support/Microsoft Edge'))
    }
  }
  if (extraDirs) {
    const chromeDirs = Array.isArray(extraDirs.chrome) ? extraDirs.chrome : []
    const edgeDirs = Array.isArray(extraDirs.edge) ? extraDirs.edge : []
    chromeDirs.forEach(d => push('chrome', d))
    edgeDirs.forEach(d => push('edge', d))
  }
  const SQL = await getSQL()
  let results = []
  const tmpFiles = []
  for (const { browser, profile, file } of collectHistoryFiles(dirs)) {
    const tmp = path.join(os.tmpdir(), `zt_bh_hist_${browser}_${profile}_${Date.now()}_${Math.random().toString(36).slice(2, 6)}.db`)
    try {
      // 只复制主数据库文件读取。
      // 说明：sql.js 从内存字节加载，无法回放 -wal 文件，复制 WAL/SHM 无效；
      // 且浏览器运行中主库处于 WAL 状态时用字节加载可能报错，导致整个历史读取失败。
      // 浏览器正常关闭时 Chromium 会把 WAL checkpoint 合并进主库，此时读取完整。
      fs.copyFileSync(file, tmp)
      tmpFiles.push(tmp)
      const db = new SQL.Database(fs.readFileSync(tmp))
      try {
        const r = db.exec(`SELECT url, title, visit_count, last_visit_time FROM urls ORDER BY last_visit_time DESC LIMIT ${limit}`)
        const rows = r && r[0] ? r[0].values : []
        for (const row of rows) {
          const url = row[0] || ''
          const title = row[1] || ''
          if (/^(chrome|edge|devtools|view-source|about|brave|vivaldi|opera):/i.test(url)) continue
          if (/^(chrome-extension|moz-extension):/i.test(url)) continue
          if (!/^https?:/i.test(url)) continue
          // 过滤搜索跳转中间 URL（与浏览器历史页显示一致）
          if (isRedirectJump(url)) continue
          results.push({ title, url, visits: row[2] || 0, lastVisit: row[3] || 0, browser, source: 'history', file })
        }
      } finally { db.close() }
    } catch (e) {}
  }
  for (const t of tmpFiles) { try { fs.unlinkSync(t) } catch (e) {} }
  // 按浏览器历史页的显示逻辑去重：同一天内同一网址只显示最近访问的一条（无论记录在哪个
  // 个人资料目录/文件里），不同天访问同一网址各保留一条（跨天重复访问是真实历史）。
  results.sort((a, b) => (b.lastVisit || 0) - (a.lastVisit || 0))
  const seenEntries = new Set()
  results = results.filter(x => {
    const date = filetimeToDate(x.lastVisit)
    const k = x.browser + '::' + (x.url || '') + '::' + date
    if (seenEntries.has(k)) return false
    seenEntries.add(k)
    return true
  })
  return results
}

// 删除指定 History 数据库文件中匹配 url 的历史记录（含关联的 visits 行）
async function deleteHistoryEntry (file, url) {
  if (!file || !fs.existsSync(file)) return { ok: false, msg: '历史数据库不存在：' + file }
  let SQL
  try {
    SQL = await getSQL()
  } catch (e) {
    return { ok: false, msg: 'SQL 引擎初始化失败：' + (e.message || e) }
  }
  const tmp = path.join(os.tmpdir(), `zt_bh_del_${Date.now()}_${Math.random().toString(36).slice(2, 6)}.db`)
  try {
    fs.copyFileSync(file, tmp)
    const db = new SQL.Database(fs.readFileSync(tmp))
    try {
      // visits 表按 url 删除，urls 表按 url 删除
      db.run('DELETE FROM visits WHERE url = ?', [url])
      db.run('DELETE FROM urls WHERE url = ?', [url])
    } catch (e) {
      db.close()
      return { ok: false, msg: '删除失败：' + (e.message || e) }
    }
    const out = db.export()
    db.close()
    try {
      fs.copyFileSync(file, file + '.bak-' + Date.now())
    } catch (e) {}
    try {
      fs.writeFileSync(file, Buffer.from(out))
    } catch (e) {
      return { ok: false, msg: '写入历史数据库失败（请先关闭浏览器）：' + (e.message || e) }
    }
    return { ok: true, msg: '历史记录已删除' }
  } catch (e) {
    return { ok: false, msg: '删除失败：' + (e.message || e) }
  } finally {
    try { fs.unlinkSync(tmp) } catch (e) {}
  }
}

module.exports = { readHistory, deleteHistoryEntry, collectHistoryFiles, filetimeToMs, msToDate, filetimeToDate }
