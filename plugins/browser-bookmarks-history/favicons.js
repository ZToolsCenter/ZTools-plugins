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

function getOrigin (url) {
  try { return new URL(url).origin } catch (e) { return '' }
}

async function readFavicons (dataDirs) {
  const SQL = await getSQL()
  const map = new Map()
  const tmpFiles = []
  const seenFiles = new Set()
  for (const { browser, dir } of dataDirs) {
    if (!dir) continue
    try { if (!fs.existsSync(dir)) continue } catch (e) { continue }
    // 支持两种配置：目录直接是个人资料目录（Default 本身，直接含 Favicons 文件）
    // 或 User Data 根目录（含 Default / Profile N 子目录）
    const candidateDirs = []
    if (fs.existsSync(path.join(dir, 'Favicons'))) {
      candidateDirs.push(dir)
    } else {
      for (const profile of PROFILES) {
        if (fs.existsSync(path.join(dir, profile, 'Favicons'))) candidateDirs.push(path.join(dir, profile))
      }
    }
    for (const profileDir of candidateDirs) {
      const f = path.join(profileDir, 'Favicons')
      try { if (!fs.existsSync(f)) continue } catch (e) { continue }
      // 按文件去重：同一浏览器下同一 Favicons 文件只读一次（与书签/历史去重逻辑一致）
      let fk
      try { fk = browser + '::' + path.resolve(f) } catch (e) { fk = browser + '::' + f }
      if (seenFiles.has(fk)) continue
      seenFiles.add(fk)
      let buf
      try {
        buf = fs.readFileSync(f)
      } catch (e) {
        const tmp = path.join(os.tmpdir(), `zt_fav_${browser}_${path.basename(profileDir)}_${Date.now()}_${Math.random().toString(36).slice(2, 6)}.db`)
        try {
          fs.copyFileSync(f, tmp)
          tmpFiles.push(tmp)
          buf = fs.readFileSync(tmp)
        } catch (e2) { continue }
      }
      try {
        const db = new SQL.Database(buf)
        const idToUrl = new Map()
        // 图标地址：只保留可被界面直接加载的 http(s) 地址；
        // file:// 等本地缓存路径在 ztools 渲染环境中无法显示（表现为空白），
        // 丢弃后由 attachFavicon 回退为浏览器图标；http(s) 加载失败时由界面层检测后再回退
        const favRows = db.exec('SELECT id, url FROM favicons')
        if (favRows && favRows[0]) {
          for (const row of favRows[0].values) {
            if (row[0] != null && row[1] && /^https?:\/\//i.test(row[1])) idToUrl.set(row[0], row[1])
          }
        }
        const mapRows = db.exec('SELECT page_url, icon_id FROM icon_mapping')
        if (mapRows && mapRows[0]) {
          for (const row of mapRows[0].values) {
            const pageUrl = row[0]
            const iconId = row[1]
            const favUrl = idToUrl.get(iconId)
            if (!pageUrl || !favUrl) continue
            const origin = getOrigin(pageUrl)
            if (origin && !map.has(origin)) map.set(origin, favUrl)
          }
        }
        db.close()
      } catch (e) {}
    }
  }
  for (const t of tmpFiles) { try { fs.unlinkSync(t) } catch (e) {} }
  return map
}

function getFaviconUrl (url, faviconMap) {
  if (!url || !faviconMap) return null
  const origin = getOrigin(url)
  if (!origin) return null
  return faviconMap.get(origin) || null
}

module.exports = { readFavicons, getFaviconUrl }
