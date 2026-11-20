// 验证：自动刷新不被搜索/选中打断；刷新后选中按 PID 保持
const path = require('path')
const http = require('http')
const fs = require('fs')
// Windows 上换成本机 Chrome，路径也可用 CHROME_PATH / PLAYWRIGHT_PATH 覆盖
const { chromium } = require(process.env.PLAYWRIGHT_PATH || require.resolve('playwright'))

const dist = path.join(__dirname, '..', 'dist')
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png' }

const server = http.createServer((req, res) => {
  const f = path.join(dist, decodeURIComponent(req.url.split('?')[0]).replace(/^\/+/, '') || 'index.html')
  fs.readFile(f, (e, b) => {
    if (e) { res.writeHead(404); return res.end() }
    res.writeHead(200, { 'Content-Type': TYPES[path.extname(f)] || 'application/octet-stream' })
    res.end(b)
  })
})

;(async () => {
  await new Promise(r => server.listen(0, '127.0.0.1', r))
  const port = server.address().port
  const chromePath = process.env.CHROME_PATH || (process.platform === 'win32'
    ? 'C:/Program Files/Google/Chrome/Application/chrome.exe'
    : '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome')
  const browser = await chromium.launch({ executablePath: chromePath })
  const page = await browser.newPage({ viewport: { width: 900, height: 560 } })
  const errors = []
  page.on('pageerror', e => errors.push(e.message))

  await page.addInitScript(() => {
    let n = 0
    window.__calls = 0
    const mk = (pid, name, mem) => ({ pid, ppid: 1, user: 'me', cpu: 0, mem, rss: mem * 1024, path: '/bin/' + name, name, listen: [], conn: [], portCount: 0, app: null })
    window.services = {
      snapshot: async () => {
        n++
        window.__calls = n
        // 第 2 次起 alpha 变成最大，触发排序变化
        return { processes: [mk(1, 'alpha', n >= 2 ? 90 : 1), mk(2, 'beta', 50), mk(3, 'gamma', 30)], portWarning: null }
      },
      icon: async () => null,
      detail: async () => ({ command: 'x' }),
      kill: async () => ({ ok: true, signal: 'SIGTERM' })
    }
  })

  await page.goto('http://127.0.0.1:' + port + '/index.html')
  await page.waitForSelector('.row')

  const pidList = () => page.$$eval('.row', els => els.map(e => e.dataset.pid))
  const selPid = () => page.$eval('.row.selected', el => el.dataset.pid).catch(() => null)

  const before = await pidList()
  const callsStart = await page.evaluate(() => window.__calls)

  // 选中第 3 行 gamma
  await page.keyboard.press('ArrowDown')
  await page.keyboard.press('ArrowDown')
  const selectedBefore = await selPid()

  await page.waitForTimeout(4000)
  const after = await pidList()
  const selectedAfter = await selPid()
  const callsAfterWait = await page.evaluate(() => window.__calls)

  // 搜索状态下继续刷新
  await page.fill('#search', 'a')
  await page.waitForTimeout(500)
  const callsSearch1 = await page.evaluate(() => window.__calls)
  await page.waitForTimeout(4000)
  const callsSearch2 = await page.evaluate(() => window.__calls)
  const searchStillShows = (await pidList()).length

  const result = {
    before,
    after,
    callsStart,
    callsAfterWait,
    refreshedWhileSelected: callsAfterWait > callsStart,
    reordered: JSON.stringify(before) !== JSON.stringify(after),
    selectedBefore,
    selectedAfter,
    selectionKept: selectedBefore === selectedAfter,
    callsSearch1,
    callsSearch2,
    refreshedWhileSearching: callsSearch2 > callsSearch1,
    searchStillShows,
    errors
  }
  console.log(JSON.stringify(result, null, 1))

  const ok = result.refreshedWhileSelected && result.reordered && result.selectionKept
    && result.refreshedWhileSearching && result.searchStillShows > 0 && errors.length === 0
  console.log(ok ? 'AUTO-REFRESH OK' : 'AUTO-REFRESH FAIL')
  await browser.close()
  server.close()
  process.exit(ok ? 0 : 1)
})()
