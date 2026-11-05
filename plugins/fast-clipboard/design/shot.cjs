/**
 * 无头浏览器截图小工具（本地开发自检用）
 *
 *   node design/shot.cjs [url] [输出文件] ["截图前执行的 JS"]
 *
 * 例：截"文件"分类
 *   node design/shot.cjs http://localhost:5173/ design/shot-file.png \
 *     "[...document.querySelectorAll('.cat')].find(b=>b.textContent.includes('文件')).click()"
 *
 * 为什么不用 agent-browser：那套要额外装 CLI + Chrome，这里直接用系统 Chrome 的
 * 调试协议（Node 22 自带 WebSocket），零依赖，够用且稳定。
 */

const { spawn } = require('node:child_process')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')

const CHROME =
  process.env.CHROME_PATH || 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
const URL_ = process.argv[2] || 'http://localhost:5173/'
const OUT = path.resolve(process.argv[3] || path.join(__dirname, 'shot.png'))
const SCRIPT = process.argv[4] || ''
const PORT = Number(process.env.CDP_PORT || 9333)
const WIDTH = Number(process.env.SHOT_W || 900)
const HEIGHT = Number(process.env.SHOT_H || 760)

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function pickTarget() {
  for (let i = 0; i < 80; i++) {
    try {
      const res = await fetch(`http://127.0.0.1:${PORT}/json/list`)
      const list = await res.json()
      const page = list.find((t) => t.type === 'page')
      if (page?.webSocketDebuggerUrl) return page
    } catch {
      /* 端口还没起来 */
    }
    await sleep(250)
  }
  throw new Error('等待 Chrome 调试端口超时')
}

function connect(wsUrl) {
  const ws = new WebSocket(wsUrl)
  let seq = 0
  const pending = new Map()
  ws.addEventListener('message', (ev) => {
    const msg = JSON.parse(ev.data)
    const p = pending.get(msg.id)
    if (!p) return
    pending.delete(msg.id)
    msg.error ? p.reject(new Error(msg.error.message)) : p.resolve(msg.result)
  })
  const ready = new Promise((res, rej) => {
    ws.addEventListener('open', res)
    ws.addEventListener('error', rej)
  })
  const send = (method, params = {}) =>
    new Promise((resolve, reject) => {
      const id = ++seq
      pending.set(id, { resolve, reject })
      ws.send(JSON.stringify({ id, method, params }))
    })
  return { ws, ready, send }
}

async function main() {
  const profile = path.join(os.tmpdir(), 'yc-shot-profile-' + PORT)
  const chrome = spawn(
    CHROME,
    [
      '--headless=new',
      '--disable-gpu',
      '--no-first-run',
      '--no-default-browser-check',
      '--disable-extensions',
      '--hide-scrollbars',
      `--remote-debugging-port=${PORT}`,
      `--user-data-dir=${profile}`,
      `--window-size=${WIDTH},${HEIGHT}`,
      'about:blank'
    ],
    { stdio: 'ignore' }
  )

  try {
    const target = await pickTarget()
    const { ws, ready, send } = connect(target.webSocketDebuggerUrl)
    await ready
    await send('Page.enable')
    await send('Runtime.enable')
    await send('Page.navigate', { url: URL_ })
    await sleep(2200) // 等 mock 数据回来 + 首屏渲染

    if (SCRIPT) {
      const r = await send('Runtime.evaluate', { expression: SCRIPT, awaitPromise: true, returnByValue: true })
      if (r.exceptionDetails) throw new Error('页面脚本报错：' + r.exceptionDetails.text)
      // 脚本有返回值时打印出来（可当页面探针用，不只截图）
      if (r.result?.value !== undefined) console.log('页面返回：' + JSON.stringify(r.result.value))
      await sleep(700)
    }

    const shot = await send('Page.captureScreenshot', { format: 'png' })
    fs.writeFileSync(OUT, Buffer.from(shot.data, 'base64'))
    console.log('已保存 ' + OUT)
    ws.close()
  } finally {
    chrome.kill()
  }
}

main().catch((e) => {
  console.error('截图失败：' + e.message)
  process.exitCode = 1
})
