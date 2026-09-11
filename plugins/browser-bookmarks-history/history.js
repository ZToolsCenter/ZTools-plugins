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

function collectHistoryFiles (dataDirs) {
  const out = []
  for (const { browser, dir } of dataDirs) {
    if (!dir) continue
    try { if (!fs.existsSync(dir)) continue } catch (e) { continue }
    for (const p of PROFILES) {
      const h = path.join(dir, p, 'History')
      try { if (fs.existsSync(h)) out.push({ browser, profile: p, file: h }) } catch (e) {}
    }
  }
  return out
}

async function readHistory (extraDirs, limit = 3000) {
  const dirs = []
  if (process.platform === 'win32') {
    const la = process.env.LOCALAPPDATA
    if (la) {
      dirs.push({ browser: 'chrome', dir: path.join(la, 'Google/Chrome/User Data') })
      dirs.push({ browser: 'edge', dir: path.join(la, 'Microsoft/Edge/User Data') })
    }
  } else if (process.platform === 'darwin') {
    const home = process.env.HOME
    if (home) {
      dirs.push({ browser: 'chrome', dir: path.join(home, 'Library/Application Support/Google/Chrome') })
      dirs.push({ browser: 'edge', dir: path.join(home, 'Library/Application Support/Microsoft Edge') })
    }
  }
  if (extraDirs) {
    const chromeDirs = Array.isArray(extraDirs.chrome) ? extraDirs.chrome : []
    const edgeDirs = Array.isArray(extraDirs.edge) ? extraDirs.edge : []
    chromeDirs.forEach(d => dirs.push({ browser: 'chrome', dir: d }))
    edgeDirs.forEach(d => dirs.push({ browser: 'edge', dir: d }))
  }
  const SQL = await getSQL()
  const results = []
  const tmpFiles = []
  for (const { browser, profile, file } of collectHistoryFiles(dirs)) {
    const tmp = path.join(os.tmpdir(), `zt_bh_hist_${browser}_${profile}_${Date.now()}_${Math.random().toString(36).slice(2, 6)}.db`)
    try {
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
          results.push({ title, url, visits: row[2] || 0, lastVisit: row[3] || 0, browser, source: 'history' })
        }
      } finally { db.close() }
    } catch (e) {}
  }
  for (const t of tmpFiles) { try { fs.unlinkSync(t) } catch (e) {} }
  results.sort((a, b) => (b.lastVisit || 0) - (a.lastVisit || 0))
  return results
}

module.exports = { readHistory }
