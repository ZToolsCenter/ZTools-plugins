const { execFile, spawn } = require('node:child_process')
const path = require('node:path')
const fs = require('node:fs')

const SIGTERM_GRACE_MS = 3000
const WIN = process.platform === 'win32'
const TASKKILL = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'taskkill.exe')

function sleep(ms) { return new Promise(r => setTimeout(r, ms)) }

function isAlive(pid) {
  try { process.kill(pid, 0); return true } catch (e) { return e.code === 'EPERM' }
}

async function waitGone(pid, timeout) {
  const deadline = Date.now() + timeout
  while (Date.now() < deadline) {
    if (!isAlive(pid)) return true
    await sleep(100)
  }
  return !isAlive(pid)
}

// Windows 没有信号：taskkill 不带 /F 是发 WM_CLOSE 请窗口自己退出，/F 是 TerminateProcess。
// 不加 /T：拒绝访问的子进程会让整个调用报错 255。退出码：1 没有可关闭的窗口（进程还在），
// 128 是拒绝访问、进程不存在或 -C 没匹配到，看进程还在不在区分
function taskkill(pid, force) {
  return new Promise(resolve => {
    const args = ['/PID', String(pid)]
    if (force) args.push('/F')
    execFile(TASKKILL, args, { encoding: 'utf8', windowsHide: true }, async err => {
      if (!err) return resolve(null)
      await sleep(150)
      if (!isAlive(pid)) return resolve('gone')
      resolve(err.code === 1 || err.code === 128 ? 'permission' : 'failed')
    })
  })
}

// 返回 { ok, pid, signal?, reason? }；reason 区分无权限 / 已退出 / 仍需强杀
async function kill(pid, options = {}) {
  const target = Number(pid)
  if (!Number.isInteger(target) || target <= 0) return { ok: false, pid: target, reason: 'invalid_pid' }
  if (target === process.pid) return { ok: false, pid: target, reason: 'self' }
  if (!isAlive(target)) return { ok: false, pid: target, reason: 'gone' }

  if (WIN) {
    const why = await taskkill(target, Boolean(options.force))
    if (why) return { ok: false, pid: target, reason: why }
    const signal = options.force ? 'TerminateProcess' : 'WM_CLOSE'
    if (options.force || await waitGone(target, SIGTERM_GRACE_MS)) return { ok: true, pid: target, signal }
    return { ok: false, pid: target, reason: 'still_alive', signal }
  }

  try {
    process.kill(target, 'SIGTERM')
  } catch (e) {
    return { ok: false, pid: target, reason: e.code === 'EPERM' ? 'permission' : 'failed', error: e.message }
  }

  if (options.force) {
    process.kill(target, 'SIGKILL')
    return { ok: true, pid: target, signal: 'SIGKILL' }
  }

  const gone = await waitGone(target, SIGTERM_GRACE_MS)
  if (gone) return { ok: true, pid: target, signal: 'SIGTERM' }
  return { ok: false, pid: target, reason: 'still_alive', signal: 'SIGTERM' }
}

async function forceKill(pid) {
  if (WIN) return kill(pid, { force: true })
  try {
    process.kill(Number(pid), 'SIGKILL')
    return { ok: true, pid: Number(pid), signal: 'SIGKILL' }
  } catch (e) {
    return { ok: false, pid: Number(pid), reason: e.code === 'EPERM' ? 'permission' : 'failed', error: e.message }
  }
}

// Windows 上命令行里第一个带引号的路径（路径含空格时 Windows 会加引号）就是程序本体
function exeFromCommandLine(cmd) {
  const m = /^"([^"]+\.exe)"/i.exec(cmd || '')
  return m ? m[1] : null
}

function commandLine(pid) {
  const exe = WIN ? path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe') : '/bin/ps'
  const args = WIN
    ? ['-NoProfile', '-NonInteractive', '-Command', '(Get-CimInstance Win32_Process -Filter "ProcessId=' + Number(pid) + '").CommandLine']
    : ['-ww', '-o', 'command=', '-p', String(pid)]
  return new Promise(resolve => {
    execFile(exe, args, { encoding: WIN ? 'latin1' : 'utf8', maxBuffer: 4 * 1024 * 1024 },
      (err, stdout) => resolve(err ? '' : Buffer.from(String(stdout || ''), WIN ? 'latin1' : 'utf8').toString('utf8').trim()))
  })
}

// 只重启 .app / .exe：命令行拆分启动会丢环境变量和参数，宁可明确失败
async function restart(pid, info = {}) {
  const cmd = await commandLine(pid)
  const app = info.app || (/(\/.*?\.app)\//.exec(cmd) || [])[1] || (WIN ? exeFromCommandLine(cmd) : null)
  if (!app || !fs.existsSync(app)) return { ok: false, pid: Number(pid), reason: 'not_an_app' }
  try {
    // Windows 上不能要求提权启动（UAC 会弹框），拿不到同一个权限就报错
    const child = WIN
      ? spawn(app, [], { detached: true, stdio: 'ignore', cwd: path.dirname(app) })
      : spawn('/usr/bin/open', ['-n', app], { detached: true, stdio: 'ignore' })
    child.unref()
    return { ok: true, pid: Number(pid), launched: app }
  } catch (e) {
    return { ok: false, pid: Number(pid), reason: 'spawn_failed', error: e.message }
  }
}

// 从 .icns 中切出最大的 PNG 片段转 base64，供列表显示应用图标
function icnsToBase64(icnsPath) {
  const buf = fs.readFileSync(icnsPath)
  const head = Buffer.from([0x89, 0x50, 0x4e, 0x47])
  const tail = Buffer.from([0x49, 0x45, 0x4e, 0x44, 0xae, 0x42, 0x60, 0x82])
  let best = null
  let i = buf.indexOf(head)
  while (i !== -1) {
    const end = buf.indexOf(tail, i)
    if (end === -1) break
    const chunk = buf.subarray(i, end + tail.length)
    if (!best || chunk.length > best.length) best = chunk
    i = buf.indexOf(head, end + tail.length)
  }
  return best ? 'data:image/png;base64,' + best.toString('base64') : null
}

function iconOf(bundlePath) {
  try {
    if (!bundlePath) return null
    const infoPlist = path.join(bundlePath, 'Contents', 'Info.plist')
    if (!fs.existsSync(infoPlist)) return null
    const raw = fs.readFileSync(infoPlist, 'utf8')
    const m = /CFBundleIconFile<\/key>\s*<string>([^<]+)<\/string>/.exec(raw)
    if (!m) return null
    let name = m[1].trim()
    if (!name.endsWith('.icns')) name += '.icns'
    const file = path.join(bundlePath, 'Contents', 'Resources', name)
    if (!fs.existsSync(file)) return null
    return icnsToBase64(file)
  } catch (e) {
    return null
  }
}

// Windows 上命令行里第一个带引号的 .exe（路径含空格时 Windows 会给它加引号）就是程序本体
function exeFromCommandLine(cmd) {
  const m = /^"([^"]+\.exe)"/i.exec(cmd || '')
  return m ? m[1] : null
}

module.exports = { kill, forceKill, commandLine, restart, iconOf, isAlive, waitGone, exeFromCommandLine }
