// 抓取 Chrome 历史记录（读取 History SQLite，经 sql.js 解析）
// Chrome 运行时会锁 History 文件 → 先复制到临时目录再读
const path = require('path')
const fs = require('fs')
const os = require('os')
const initSqlJs = require('./sql-wasm.js')

let _SQL = null
async function getSQL() {
  if (!_SQL) {
    _SQL = await initSqlJs({ locateFile: f => path.join(__dirname, f) })
  }
  return _SQL
}

function browserHistoryPaths() {
  const paths = []
  const profiles = ['Default', 'Profile 1', 'Profile 2', 'Profile 3', 'Profile 4']
  const browsers = []
  if (process.platform === 'win32') {
    const la = process.env.LOCALAPPDATA || ''
    if (la) {
      browsers.push({ browser: 'chrome', dir: path.join(la, 'Google/Chrome/User Data') })
      browsers.push({ browser: 'edge', dir: path.join(la, 'Microsoft/Edge/User Data') })
    }
  } else if (process.platform === 'darwin') {
    const home = process.env.HOME || ''
    if (home) {
      browsers.push({ browser: 'chrome', dir: path.join(home, 'Library/Application Support/Google/Chrome') })
      browsers.push({ browser: 'edge', dir: path.join(home, 'Library/Application Support/Microsoft Edge') })
    }
  }
  for (const { browser, dir } of browsers) {
    for (const p of profiles) {
      const h = path.join(dir, p, 'History')
      if (fs.existsSync(h)) paths.push({ browser, profile: p, file: h })
    }
  }
  return paths
}

// 读取历史，最多 limit 条，过滤内部页面
async function readChromeHistory(limit = 3000) {
  const SQL = await getSQL()
  const results = []
  const tmpFiles = []
  for (const { browser, profile, file } of browserHistoryPaths()) {
    // 复制避免文件锁
    const tmp = path.join(os.tmpdir(), `zt_ch_history_${browser}_${profile}_${Date.now()}_${Math.random().toString(36).slice(2, 6)}.db`)
    try {
      fs.copyFileSync(file, tmp)
      tmpFiles.push(tmp)
      const db = new SQL.Database(fs.readFileSync(tmp))
      try {
        const r = db.exec(
          `SELECT url, title, visit_count, last_visit_time FROM urls ORDER BY last_visit_time DESC LIMIT ${limit}`
        )
        const rows = r && r[0] ? r[0].values : []
        for (const row of rows) {
          const url = row[0] || ''
          const title = row[1] || ''
          // 过滤 chrome:// edge:// chrome-extension:// 等内部页
          if (/^(chrome|edge|devtools|view-source|about|brave|vivaldi|opera):/i.test(url)) continue
          if (/^(chrome-extension|moz-extension):/i.test(url)) continue
          if (!/^https?:/i.test(url)) continue
          results.push({
            title,
            url,
            visits: row[2] || 0,
            source: 'history',
            browser,
            profile
          })
        }
      } finally {
        db.close()
      }
    } catch (e) {
      // 忽略单个 profile 失败
    }
  }
  // 清理临时文件
  for (const t of tmpFiles) {
    try { fs.unlinkSync(t) } catch (e) {}
  }
  return results
}

module.exports = { readChromeHistory, browserHistoryPaths }
