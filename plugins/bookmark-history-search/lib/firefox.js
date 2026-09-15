// 读取 Firefox 书签和历史（places.sqlite，SQLite）
// Firefox 的数据和 Chrome/Edge 完全不同：
// - 书签 + 历史都在 <Profile>/places.sqlite（表 moz_bookmarks / moz_places）
// - Windows 路径在 %APPDATA%\Mozilla\Firefox\Profiles\<profile>\places.sqlite
const path = require('path')
const fs = require('fs')
const os = require('os')
const initSqlJs = require('./sql-wasm.js')

let _SQL = null
async function getSQL() {
  if (!_SQL) _SQL = await initSqlJs({ locateFile: f => path.join(__dirname, f) })
  return _SQL
}

function firefoxProfilesDir() {
  if (process.platform === 'win32') {
    const appdata = process.env.APPDATA || ''
    return appdata ? path.join(appdata, 'Mozilla/Firefox/Profiles') : null
  }
  if (process.platform === 'darwin') {
    return process.env.HOME
      ? path.join(process.env.HOME, 'Library/Application Support/Firefox/Profiles')
      : null
  }
  return process.env.HOME ? path.join(process.env.HOME, '.mozilla/firefox') : null
}

// 找出所有含 places.sqlite 的 profile 目录（形如 xxxxxxxx.default-release）
function firefoxProfileDirs() {
  const dir = firefoxProfilesDir()
  if (!dir || !fs.existsSync(dir)) return []
  return fs
    .readdirSync(dir)
    .filter(p => !p.startsWith('.'))
    .map(p => path.join(dir, p))
    .filter(p => fs.existsSync(path.join(p, 'places.sqlite')))
}

// 复制 places.sqlite 到临时目录并打开（Firefox 运行时会锁/WAL）
async function openPlaces(profileDir) {
  const SQL = await getSQL()
  const src = path.join(profileDir, 'places.sqlite')
  const tmp = path.join(os.tmpdir(), `zt_fx_places_${Date.now()}_${Math.random().toString(36).slice(2, 6)}.sqlite`)
  fs.copyFileSync(src, tmp)
  const db = new SQL.Database(fs.readFileSync(tmp))
  try { fs.unlinkSync(tmp) } catch (e) {}
  return db
}

// 历史：moz_places 表
async function readFirefoxHistory(limit = 3000) {
  const out = []
  for (const profile of firefoxProfileDirs()) {
    let db
    try {
      db = await openPlaces(profile)
      const r = db.exec(
        `SELECT url, title, visit_count FROM moz_places WHERE url LIKE 'http%' AND visit_count > 0 ORDER BY last_visit_date DESC LIMIT ${limit}`
      )
      const rows = r && r[0] ? r[0].values : []
      for (const row of rows) {
        const url = row[0] || ''
        if (!/^https?:/i.test(url)) continue
        out.push({
          title: row[1] || '',
          url,
          visits: row[2] || 0,
          source: 'history',
          browser: 'firefox'
        })
      }
    } catch (e) {
    } finally {
      if (db) db.close()
    }
  }
  return out
}

// 书签：moz_bookmarks（type 1=url, 2=folder, 3=separator）关联 moz_places，递归算文件夹路径
async function readFirefoxBookmarks() {
  const out = []
  for (const profile of firefoxProfileDirs()) {
    let db
    try {
      db = await openPlaces(profile)
      const r = db.exec(
        `SELECT b.id, b.type, b.title, b.parent, p.url FROM moz_bookmarks b LEFT JOIN moz_places p ON b.fk = p.id ORDER BY b.parent, b.position`
      )
      const rows = r && r[0] ? r[0].values : []
      const byId = {}
      for (const row of rows) {
        byId[row[0]] = { id: row[0], type: row[1], title: row[2] || '', parent: row[3], url: row[4] || '', children: [], _path: undefined }
      }
      // 构建父子关系
      for (const row of rows) {
        const parent = row[3]
        if (parent != null && byId[parent]) byId[parent].children.push(row[0])
      }
      // 递归计算文件夹路径（type 2 是文件夹）
      const computeFolder = (id, inherited) => {
        const n = byId[id]
        if (!n) return
        if (n.type === 2) {
          const p = inherited ? inherited + ' / ' + n.title : n.title
          n._path = p
          n.children.forEach(c => computeFolder(c, p))
        } else {
          n._path = inherited || ''
        }
      }
      for (const row of rows) {
        if (byId[row[0]]._path === undefined) computeFolder(row[0], '')
      }
      // 收集 url 书签
      for (const row of rows) {
        if (row[1] === 1) {
          const n = byId[row[0]]
          if (n && /^https?:/i.test(n.url)) {
            out.push({
              title: n.title || n.url,
              url: n.url,
              folder: n._path || '',
              source: 'bookmark',
              browser: 'firefox'
            })
          }
        }
      }
    } catch (e) {
    } finally {
      if (db) db.close()
    }
  }
  return out
}

module.exports = { readFirefoxBookmarks, readFirefoxHistory, firefoxProfileDirs }
