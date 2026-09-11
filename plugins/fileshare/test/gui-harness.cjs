// GUI test harness — stubs window, loads services.js, seeds fixtures and keeps
// the server alive for browser-based GUI testing.
const fs = require('node:fs')
const path = require('node:path')
const os = require('node:os')

const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'fs-gui-'))
const downloads = path.join(tmpRoot, 'downloads')
fs.mkdirSync(downloads, { recursive: true })

const sharedDir = path.join(tmpRoot, '项目资料')
fs.mkdirSync(path.join(sharedDir, '代码'), { recursive: true })
fs.writeFileSync(path.join(sharedDir, 'README.md'), '# 项目说明\n\n这是一个测试项目。')
fs.writeFileSync(path.join(sharedDir, '设计稿.png'), Buffer.from('fake-png'))
fs.writeFileSync(path.join(sharedDir, '代码', 'main.js'), 'console.log("hello")')
fs.writeFileSync(path.join(sharedDir, '代码', 'utils.py'), 'print("hello")')
fs.writeFileSync(path.join(tmpRoot, '会议记录.txt'), '会议纪要内容')

global.window = {
  ztools: {
    dbStorage: { getItem: () => null, setItem: () => {}, removeItem: () => {} },
    getPath: (name) => downloads,
    showNotification: () => {},
    copyText: () => true,
    shellShowItemInFolder: () => {},
    showOpenDialog: () => null
  }
}

require('../public/preload/services.js')

async function main() {
  window.services.addShares([sharedDir, path.join(tmpRoot, '会议记录.txt')])

  const free = await window.services.getFreePort('127.0.0.1')
  const res = await window.services.startServer(free, '127.0.0.1')
  if (!res.ok) { console.error('start failed', res); process.exit(1) }
  const status = window.services.getServerStatus()
  const base = `http://127.0.0.1:${status.port}`

  // Seed two client uploads from 127.0.0.1 via the real upload endpoint
  const boundary = '----guiBoundary'
  for (const [name, content] of [['手机照片.jpg', Buffer.from('fake-jpg')], ['同事发来的文档.txt', Buffer.from('doc content')]]) {
    const body = Buffer.concat([
      Buffer.from(`--${boundary}\r\n`),
      Buffer.from(`Content-Disposition: form-data; name="file"; filename="${name}"\r\n`),
      Buffer.from('Content-Type: application/octet-stream\r\n\r\n'),
      content,
      Buffer.from(`\r\n--${boundary}--\r\n`)
    ])
    await fetch(`${base}/api/upload?token=${status.token}`, {
      method: 'POST',
      headers: { 'Content-Type': `multipart/form-data; boundary=${boundary}` },
      body
    })
  }

  console.log('GUI_URL=' + base + '/?token=' + status.token)
  console.log('READY')
  setInterval(() => {}, 60000) // keep alive
}

main().catch(e => { console.error(e); process.exit(1) })
