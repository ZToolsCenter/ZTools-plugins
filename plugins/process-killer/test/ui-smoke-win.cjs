const path = require('path')
const http = require('http')
const fs = require('fs')
const { execFileSync } = require('child_process')

// playwright 走环境变量：本机没有全局安装，指到已有的那份即可
const playwrightPath = process.env.PLAYWRIGHT_PATH || require.resolve('playwright')
const { chromium } = require(playwrightPath)
const CHROME = process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe'
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
    platform: 'win32',
    snapshot: async () => ({
      processes: [
        { pid: 4096, ppid: 1, user: '', cpu: 3.5, mem: 12.4, rss: 4358144, path: '"C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe" --type=renderer', name: 'chrome.exe', listen: [], conn: [9222], portCount: 1, app: null },
        { pid: 8192, ppid: 4096, user: '', cpu: 5.5, mem: 2.0, rss: 350000, path: '"C:\\Program Files\\Redis\\redis-server.exe"', name: 'redis-server.exe', listen: [6379], conn: [], portCount: 1, app: null },
        { pid: 512, ppid: 4, user: '', cpu: 0, mem: 0.1, rss: 12000, path: '', name: 'System Idle Process', listen: [], conn: [], portCount: 0, app: null }
      ],
      portWarning: null
    }),
    detail: async () => ({ command: '"C:\\Program Files\\Redis\\redis-server.exe" --port 6379' }),
    icon: async () => null,
    kill: async pid => ({ ok: false, pid, reason: 'permission' }),
    forceKill: async pid => ({ ok: true, pid, signal: 'TerminateProcess' }),
    restart: async pid => ({ ok: false, pid, reason: 'not_an_app' }),
    copy: () => true, reveal: () => true, notify: () => {}
  }
}

;(async () => {
  await new Promise(r => server.listen(0, '127.0.0.1', r))
  const port = server.address().port
  const browser = await chromium.launch({ executablePath: CHROME })
  const page = await browser.newPage({ viewport: { width: 900, height: 560 } })
  const errors = []
  page.on('pageerror', e => errors.push(e.message))
  await page.addInitScript(MOCK)

  await page.goto('http://127.0.0.1:' + port + '/index.html')
  await page.waitForSelector('.row')

  const rows = await page.$$eval('.row', els => els.map(e => e.dataset.pid))
  const banner = await page.textContent('#banner')
  const summary = await page.textContent('#summary')
  const hint = await page.textContent('.hint')

  // 端口搜索
  await page.fill('#search', '6379')
  await page.waitForFunction(() => document.querySelectorAll('.row').length === 1)
  const afterPort = await page.$$eval('.row', els => els.map(e => e.dataset.pid))

  await page.fill('#search', '')
  await page.waitForFunction(() => document.querySelectorAll('.row').length === 3)
  // 名称排序，确认表头、端口列都在
  await page.click('#sorts button[data-sort="ports"]')
  const portOrder = await page.$$eval('.row', els => els.map(e => e.dataset.pid))

  // WM_CLOSE 被拒 -> 提示权限不足；再强杀 -> 成功提示
  await page.click('.row[data-pid="4096"]')
  await page.keyboard.press('Enter')
  await page.waitForSelector('#confirm:not([hidden])')
  const confirmBody = await page.textContent('#confirm-body')
  await page.click('#confirm-ok')
  await page.waitForSelector('#toast:not([hidden])')
  const toast = await page.textContent('#toast')

  // 右键菜单：强制结束走 TerminateProcess
  await page.click('.row[data-pid="8192"]', { button: 'right' })
  await page.waitForSelector('#menu:not([hidden])')
  await page.click('#menu button[data-act="force"]')
  await page.waitForSelector('#confirm:not([hidden])')
  await page.click('#confirm-ok')
  await page.waitForFunction(() => document.querySelector('#toast') && document.querySelector('#toast').textContent.includes('TerminateProcess'))
  const toast2 = await page.textContent('#toast')

  // 详情：Windows 上不标“累计值”
  await page.click('.row[data-pid="8192"]')
  await page.keyboard.press('Shift+Enter')
  await page.waitForSelector('#dialog:not([hidden])')
  const dialogText = await page.textContent('#dialog-body')
  await page.keyboard.press('Escape')

  await page.waitForTimeout(300)
  await page.screenshot({ path: path.join(__dirname, '..', 'ui-smoke.png') })

  await browser.close()
  server.close()

  const result = { rows, banner, summary, hint, afterPort, portOrder, confirmBody, toast, toast2, dialogHasCmd: dialogText.includes('--port 6379'), dialogNoCumulative: !dialogText.includes('累计值'), errors }
  console.log(JSON.stringify(result, null, 2))
  const ok = rows.length === 3 && afterPort[0] === '8192' && portOrder[0] === '4096'
    && toast.includes('权限') && toast2.includes('TerminateProcess') && result.dialogHasCmd && result.dialogNoCumulative
    && hint.includes('Ctrl') && hint.includes('Ctrl+⏎') && confirmBody.includes('关闭请求') && errors.length === 0
  console.log(ok ? 'SMOKE OK' : 'SMOKE FAIL')
  process.exit(ok ? 0 : 1)
})()
