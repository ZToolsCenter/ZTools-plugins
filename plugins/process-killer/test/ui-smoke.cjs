// 在真实 Chrome 里经 http 加载 dist，注入 window.services 模拟 preload
const path = require('path')
const http = require('http')
const fs = require('fs')
// playwright 与 Chrome 路径可用 PLAYWRIGHT_PATH / CHROME_PATH 覆盖
const { chromium } = require(process.env.PLAYWRIGHT_PATH || require.resolve('playwright'))

const dist = path.join(__dirname, '..', 'dist')
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.json': 'application/json' }

const server = http.createServer((req, res) => {
  const file = path.join(dist, decodeURIComponent(req.url.split('?')[0]).replace(/^\/+/, '') || 'index.html')
  fs.readFile(file, (err, buf) => {
    if (err) { res.writeHead(404); return res.end('not found') }
    res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream' })
    res.end(buf)
  })
})

const MOCK = () => {
  window.services = {
    platform: 'darwin',
    snapshot: async () => ({
      processes: [
        { pid: 101, ppid: 1, user: 'me', cpu: 1.5, mem: 4.2, rss: 720896, path: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', name: 'Google Chrome', listen: [9222], conn: [], portCount: 1, app: '/Applications/Google Chrome.app' },
        { pid: 202, ppid: 1, user: 'me', cpu: 0.5, mem: 2.0, rss: 350000, path: '/usr/local/bin/redis-server', name: 'redis-server', listen: [6379], conn: [], portCount: 1, app: null },
        { pid: 303, ppid: 1, user: 'root', cpu: 0, mem: 0.1, rss: 12000, path: '/sbin/launchd', name: 'launchd', listen: [], conn: [], portCount: 0, app: null }
      ],
      portWarning: '端口信息受限：可能缺少显示其他用户进程的权限'
    }),
    detail: async () => ({ command: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome --foo' }),
    icon: async () => null,
    kill: async pid => ({ ok: false, pid, reason: 'permission' }),
    forceKill: async pid => ({ ok: true, pid, signal: 'SIGKILL' }),
    restart: async pid => ({ ok: false, pid, reason: 'not_an_app' }),
    copy: () => true, reveal: () => true, notify: () => {}
  }
}

;(async () => {
  await new Promise(r => server.listen(0, '127.0.0.1', r))
  const port = server.address().port
  const browser = await chromium.launch({
    executablePath: process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
  })
  const page = await browser.newPage({ viewport: { width: 900, height: 560 } })
  const errors = []
  page.on('pageerror', e => errors.push(e.message))
  await page.addInitScript(MOCK)

  await page.goto('http://127.0.0.1:' + port + '/index.html')
  await page.waitForSelector('.row')

  const rows = await page.$$eval('.row', els => els.map(e => e.dataset.pid))
  const banner = await page.textContent('#banner')
  const summary = await page.textContent('#summary')

  await page.fill('#search', 'redis')
  await page.waitForFunction(() => document.querySelectorAll('.row').length === 1)
  const afterSearch = await page.$$eval('.row', els => els.map(e => e.dataset.pid))

  await page.fill('#search', '')
  await page.waitForFunction(() => document.querySelectorAll('.row').length === 3)
  await page.click('#sorts button[data-sort="ports"]')
  const portOrder = await page.$$eval('.row', els => els.map(e => e.dataset.pid))

  // 回车先弹确认框，确认后才真正执行
  await page.keyboard.press('ArrowDown')
  await page.keyboard.press('Enter')
  await page.waitForSelector('#confirm:not([hidden])')
  const confirmShown = await page.textContent('#confirm-title')

  // 取消路径：不应产生任何提示
  await page.click('#confirm-cancel')
  const cancelToastHidden = await page.$eval('#toast', el => el.hidden)

  // 确认路径：走真正的 kill
  await page.keyboard.press('Enter')
  await page.waitForSelector('#confirm:not([hidden])')
  await page.click('#confirm-ok')
  await page.waitForSelector('#toast:not([hidden])')
  const toast = await page.textContent('#toast')

  await page.fill('#search', 'launchd')
  await page.waitForFunction(() => document.querySelectorAll('.row').length === 1)
  await page.keyboard.press('Shift+Enter')
  await page.waitForSelector('#dialog:not([hidden])')
  const dialogText = await page.textContent('#dialog-body')
  await page.keyboard.press('Escape')

  await page.click('#sorts button[data-sort="mem"]')
  await page.waitForTimeout(300)
  await page.screenshot({ path: path.join(__dirname, '..', 'ui-smoke.png') })

  await browser.close()
  server.close()

  const result = { rows, banner, summary, afterSearch, portOrder, confirmShown, cancelToastHidden, toast, dialogHasCommand: dialogText.includes('--foo'), errors }
  console.log(JSON.stringify(result, null, 2))
  const ok = rows.length === 3 && afterSearch[0] === '202' && portOrder[0] === '101'
    && toast.includes('权限') && result.dialogHasCommand && errors.length === 0 && banner.includes('端口')
    && confirmShown.includes('确认') && cancelToastHidden
  console.log(ok ? 'SMOKE OK' : 'SMOKE FAIL')
  process.exit(ok ? 0 : 1)
})()
