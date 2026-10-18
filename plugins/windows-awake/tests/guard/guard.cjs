// 独立验证唤醒守护进程：不依赖 ZTools，直接运行 PowerShell 守护脚本并检查真实行为。
// 运行方式：npm run test:guard
const assert = require('node:assert/strict')
const { spawn, spawnSync } = require('node:child_process')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')

const { GUARD_SCRIPT } = require('../../src-ztools/preload/guard-script.js')

const ES_CONTINUOUS = 0x80000000
const ES_SYSTEM_REQUIRED = 0x00000001
const ES_DISPLAY_REQUIRED = 0x00000002
const KEEP_SYSTEM_FLAGS = (ES_CONTINUOUS | ES_SYSTEM_REQUIRED) >>> 0
const KEEP_SYSTEM_AND_DISPLAY_FLAGS = (ES_CONTINUOUS | ES_SYSTEM_REQUIRED | ES_DISPLAY_REQUIRED) >>> 0
const READY_TIMEOUT_MS = 20_000
const EXIT_TIMEOUT_MS = 8_000

const workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'zvc-awake-guard-'))
const liveGuards = new Set()
const scriptPath = path.join(workDir, 'awake-guard.ps1')
const heartbeatPath = path.join(workDir, 'heartbeat.txt')
const stopFlagPath = path.join(workDir, 'stop.flag')
fs.writeFileSync(scriptPath, `\uFEFF${GUARD_SCRIPT}`, 'utf8')

/**
 * 定位 powershell.exe。
 * @returns {string} PowerShell 可执行文件路径。
 */
function powershellPath() {
  const candidate = path.join(
    process.env.SystemRoot || 'C:\\Windows',
    'System32',
    'WindowsPowerShell',
    'v1.0',
    'powershell.exe'
  )
  return fs.existsSync(candidate) ? candidate : 'powershell.exe'
}

/**
 * 等待条件成立。
 * @param {() => boolean} predicate 判定函数。
 * @param {number} timeoutMs 超时毫秒数。
 * @returns {Promise<boolean>} 条件成立返回 true。
 */
async function waitFor(predicate, timeoutMs) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (predicate()) return true
    await new Promise((resolve) => setTimeout(resolve, 100))
  }
  return predicate()
}

/**
 * 判断进程是否仍然存在。
 * @param {number} pid 进程号。
 * @returns {boolean} 存在返回 true。
 */
function isAlive(pid) {
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    return Boolean(error) && error.code === 'EPERM'
  }
}

/**
 * 读取心跳文件内容。
 * @returns {{state: string, pid: number, flags: number} | null} 解析后的心跳。
 */
function readHeartbeat() {
  try {
    const [state = '', pid = '0', flags = '0'] = fs.readFileSync(heartbeatPath, 'utf8').trim().split('|')
    return { state, pid: Number(pid), flags: Number(flags) }
  } catch {
    return null
  }
}

/**
 * 启动一次守护进程。
 * @param {Record<string, unknown>} options 启动选项。
 * @returns {{child: import('node:child_process').ChildProcess, stdout: () => string}} 进程句柄与输出读取函数。
 */
function startGuard(options) {
  fs.rmSync(heartbeatPath, { force: true })
  fs.rmSync(stopFlagPath, { force: true })
  const args = [
    '-NoProfile',
    '-NonInteractive',
    '-ExecutionPolicy',
    'Bypass',
    '-WindowStyle',
    'Hidden',
    '-File',
    scriptPath,
    '-Seconds',
    String(options.seconds ?? 0),
    '-HeartbeatFile',
    heartbeatPath,
    '-StopFile',
    stopFlagPath,
    '-AppProcessName',
    String(options.appProcessName ?? 'node'),
    '-ParentProcessId',
    String(options.parentProcessId ?? 0),
    '--zvc-awake-guard'
  ]
  if (options.keepDisplay) args.push('-KeepDisplay')
  const child = spawn(powershellPath(), args, { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] })
  liveGuards.add(child)
  child.on('exit', () => liveGuards.delete(child))
  let stdout = ''
  let stderr = ''
  child.stdout.setEncoding('utf8')
  child.stderr.setEncoding('utf8')
  child.stdout.on('data', (chunk) => {
    stdout += chunk
  })
  child.stderr.on('data', (chunk) => {
    stderr += chunk
  })
  child.on('exit', () => {
    if (stderr.trim()) console.log(`    [guard stderr] ${stderr.trim().split(/\r?\n/).pop()}`)
  })
  return { child, stdout: () => stdout }
}

/**
 * 等待守护进程结束。
 * @param {import('node:child_process').ChildProcess} child 守护进程。
 * @param {number} timeoutMs 超时毫秒数。
 * @returns {Promise<boolean>} 已结束返回 true。
 */
async function waitExit(child, timeoutMs) {
  return Promise.race([
    new Promise((resolve) => child.once('exit', () => resolve(true))),
    new Promise((resolve) => setTimeout(() => resolve(false), timeoutMs))
  ])
}

/**
 * 通过停止标记结束守护进程，并确认进程确实退出。
 * @param {import('node:child_process').ChildProcess} child 守护进程。
 * @returns {Promise<void>} 无返回值。
 */
async function stopViaFlag(child) {
  fs.writeFileSync(stopFlagPath, String(Date.now()), 'utf8')
  const exited = await waitExit(child, EXIT_TIMEOUT_MS)
  assert.equal(exited, true, '写入停止标记后守护进程应在 8 秒内退出')
  assert.equal(isAlive(child.pid), false, '守护进程退出后不应再存在')
}

/** 记录可选的系统级佐证信息。 */
function logPowerRequests() {
  const result = spawnSync('powercfg', ['/requests'], { encoding: 'utf8', windowsHide: true })
  const text = `${result.stdout || ''}${result.stderr || ''}`.trim()
  console.log(`    powercfg /requests → ${text ? text.split(/\r?\n/)[0] : '无输出（查询需要管理员权限）'}`)
}

async function main() {
  console.log(`守护脚本：${scriptPath}`)

  console.log('1. 不允许息屏：ES_CONTINUOUS | ES_SYSTEM_REQUIRED | ES_DISPLAY_REQUIRED')
  const withDisplay = startGuard({ seconds: 0, appProcessName: 'node', keepDisplay: true })
  const readyWithDisplay = await waitFor(() => withDisplay.stdout().includes('READY'), READY_TIMEOUT_MS)
  assert.equal(readyWithDisplay, true, '守护进程应输出 READY')
  const beatWithDisplay = readHeartbeat()
  assert.equal(beatWithDisplay.state, 'ready', '心跳状态应为 ready')
  assert.equal(beatWithDisplay.pid, withDisplay.child.pid, '心跳 PID 应与守护进程一致')
  assert.equal(
    beatWithDisplay.flags,
    KEEP_SYSTEM_AND_DISPLAY_FLAGS,
    '不允许息屏时应同时请求保持系统与屏幕唤醒'
  )
  await new Promise((resolve) => setTimeout(resolve, 2500))
  assert.equal(readHeartbeat().state, 'hold', '运行期间应持续刷新心跳')
  logPowerRequests()
  await stopViaFlag(withDisplay.child)

  console.log('2. 允许息屏：ES_CONTINUOUS | ES_SYSTEM_REQUIRED')
  const systemOnly = startGuard({ seconds: 0, appProcessName: 'node', keepDisplay: false })
  assert.equal(await waitFor(() => systemOnly.stdout().includes('READY'), READY_TIMEOUT_MS), true)
  assert.equal(
    readHeartbeat().flags,
    KEEP_SYSTEM_FLAGS,
    '允许息屏时不应请求保持屏幕唤醒'
  )
  await stopViaFlag(systemOnly.child)

  console.log('3. 定时唤醒：到时自动释放')
  const timed = startGuard({ seconds: 2, appProcessName: 'node', keepDisplay: false })
  assert.equal(await waitFor(() => timed.stdout().includes('READY'), READY_TIMEOUT_MS), true)
  assert.equal(await waitExit(timed.child, EXIT_TIMEOUT_MS), true, '定时唤醒应自动退出')
  assert.equal(isAlive(timed.child.pid), false, '自动退出后不应残留进程')

  console.log('4. 宿主进程消失：守护进程自行清理')
  const orphan = startGuard({ seconds: 0, appProcessName: 'zvc-no-such-process-xyz', keepDisplay: false })
  assert.equal(await waitFor(() => orphan.stdout().includes('READY'), READY_TIMEOUT_MS), true)
  assert.equal(await waitExit(orphan.child, EXIT_TIMEOUT_MS), true, '没有宿主进程时守护进程应自行退出')

  console.log('5. 父进程消失：即使同名进程仍在也自行清理')
  const noParent = startGuard({ seconds: 0, appProcessName: 'node', parentProcessId: 999999, keepDisplay: false })
  assert.equal(await waitFor(() => noParent.stdout().includes('READY'), READY_TIMEOUT_MS), true)
  assert.equal(await waitExit(noParent.child, EXIT_TIMEOUT_MS), true, '父进程不存在时守护进程应自行退出')

  console.log('全部守护进程行为检查通过')
}

main()
  .catch((error) => {
    console.error(`检查失败：${error && error.message ? error.message : error}`)
    process.exitCode = 1
  })
  .finally(async () => {
    // 断言失败时也必须结束仍在运行的守护进程，否则会一直占用唤醒状态。
    for (const child of liveGuards) {
      try {
        fs.writeFileSync(stopFlagPath, String(Date.now()), 'utf8')
        const exited = await waitExit(child, 3000)
        if (!exited) child.kill()
      } catch {
        child.kill()
      }
    }
    fs.rmSync(workDir, { recursive: true, force: true })
  })
