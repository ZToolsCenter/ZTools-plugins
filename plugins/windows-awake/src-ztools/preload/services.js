// Windows 唤醒控制插件：在 Node 侧托管一个最小化的唤醒守护进程。
// 页面只调用 start / stop / getStatus / getConfig / saveConfig，其余实现细节全部留在这里。
const { spawn, spawnSync } = require('node:child_process')
const fs = require('node:fs')
const path = require('node:path')

const { GUARD_SCRIPT, GUARD_MARKER, GUARD_SCRIPT_NAME } = require('./guard-script.js')

const CONFIG_KEY = 'awake-config'

/** 自定义时长的取值边界（分钟）。0 表示一直保持。 */
const MIN_DURATION_MINUTES = 1
const MAX_DURATION_MINUTES = 1440
const DEFAULT_CONFIG = Object.freeze({ durationMinutes: 30, keepDisplay: true })

/** 守护进程每 2 秒刷新一次心跳，超过 6 秒未刷新视为已退出。 */
const HEARTBEAT_INTERVAL_MS = 2000
const HEARTBEAT_FRESH_MS = 6000
const READY_TIMEOUT_MS = 15000
const STOP_TIMEOUT_MS = 6000
const POLL_INTERVAL_MS = 120

/** SetThreadExecutionState 的标志位。 */
const ES_CONTINUOUS = 0x80000000
const ES_SYSTEM_REQUIRED = 0x00000001
const ES_DISPLAY_REQUIRED = 0x00000002


/** 当前页面会话中启动的守护进程；页面重新打开时该引用为空，需要依赖状态文件。 */
let guardChild = null

/**
 * 读取宿主 API，延迟访问以便在开发预览中给出明确提示。
 * @returns {any} ZTools 全局对象。
 */
function ztoolsApi() {
  return window.ztools
}

/**
 * 判断当前系统是否为 Windows。
 * @returns {boolean} Windows 返回 true。
 */
function isWindows() {
  return process.platform === 'win32'
}

/**
 * 确认运行平台，非 Windows 时抛出可读错误。
 * @returns {void}
 */
function assertWindows() {
  if (!isWindows()) {
    throw new Error('该插件依赖 Windows 的 SetThreadExecutionState，只能在 Windows 上使用')
  }
}

/**
 * 获取插件数据目录，用于存放守护脚本与运行时文件。
 * @returns {string} 数据目录绝对路径。
 */
function dataDir() {
  const dir = path.join(String(ztoolsApi().getPath('userData')), 'windows-awake')
  fs.mkdirSync(dir, { recursive: true })
  return dir
}

/**
 * 计算守护脚本、状态、心跳和停止标记的文件路径。
 * @returns {{dir: string, script: string, state: string, heartbeat: string, stopFlag: string}} 文件路径集合。
 */
function filePaths() {
  const dir = dataDir()
  return {
    dir,
    script: path.join(dir, GUARD_SCRIPT_NAME),
    state: path.join(dir, 'guard-state.json'),
    heartbeat: path.join(dir, 'guard-heartbeat.txt'),
    stopFlag: path.join(dir, 'guard-stop.flag')
  }
}

/**
 * 定位 powershell.exe，避免依赖 PATH。
 * @returns {string} PowerShell 可执行文件路径。
 */
function powershellPath() {
  const root = process.env.SystemRoot || process.env.windir || 'C:\\Windows'
  const candidate = path.join(root, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe')
  return fs.existsSync(candidate) ? candidate : 'powershell.exe'
}

/**
 * 取当前应用的可执行文件名，父进程不可用时守护进程据此判断 ZTools 是否仍在运行。
 * @returns {string} 不含扩展名的进程名；无法解析时返回空字符串。
 */
function appProcessName() {
  const executable = typeof process.execPath === 'string' ? process.execPath : ''
  if (!executable) return ''
  const name = path.basename(executable, path.extname(executable))
  return name.replace(/[^A-Za-z0-9._-]/g, '')
}

/**
 * 取宿主进程号：插件页所在的渲染进程的父进程即 ZTools 主进程。
 * @returns {number} 父进程号；无法获取时返回 0。
 */
function hostProcessId() {
  const ppid = Number(process.ppid)
  return Number.isInteger(ppid) && ppid > 0 ? ppid : 0
}

/**
 * 把守护脚本写入数据目录，内容变化时覆盖。
 * @returns {string} 守护脚本路径。
 */
function ensureGuardScript() {
  const { script } = filePaths()
  try {
    if (fs.readFileSync(script, 'utf8') === GUARD_SCRIPT) return script
  } catch {
    // 文件不存在或不可读时直接重写。
  }
  // 带 BOM 写入，保证 Windows PowerShell 5.1 按 UTF-8 解析脚本。
  fs.writeFileSync(script, `\uFEFF${GUARD_SCRIPT}`, { encoding: 'utf8' })
  return script
}

/**
 * 把时长规范化为合法分钟数。
 * @param {unknown} value 原始时长。
 * @param {number} fallback 非法时使用的默认值。
 * @returns {number} 0 到 1440 之间的整数分钟，0 表示一直保持。
 */
function normalizeDuration(value, fallback) {
  const parsed = Number(value)
  if (!Number.isFinite(parsed)) return fallback
  const rounded = Math.round(parsed)
  if (rounded <= 0) return 0
  return Math.min(rounded, MAX_DURATION_MINUTES)
}

/**
 * 校验并补全配置对象。
 * @param {unknown} raw 读取到的原始配置。
 * @returns {{durationMinutes: number, keepDisplay: boolean}} 合法配置。
 */
function normalizeConfig(raw) {
  const source = raw && typeof raw === 'object' ? raw : {}
  return {
    durationMinutes: normalizeDuration(source.durationMinutes, DEFAULT_CONFIG.durationMinutes),
    keepDisplay: source.keepDisplay !== false
  }
}

/**
 * 读取持久化配置。
 * @returns {{durationMinutes: number, keepDisplay: boolean}} 当前配置。
 */
function readConfig() {
  try {
    return normalizeConfig(ztoolsApi().dbStorage.getItem(CONFIG_KEY))
  } catch {
    return { ...DEFAULT_CONFIG }
  }
}

/**
 * 写入持久化配置。
 * @param {{durationMinutes?: unknown, keepDisplay?: unknown}} patch 需要更新的字段。
 * @returns {{durationMinutes: number, keepDisplay: boolean}} 写入后的完整配置。
 */
function writeConfig(patch) {
  const merged = { ...readConfig() }
  if (patch && typeof patch === 'object') {
    if (patch.durationMinutes !== undefined) {
      merged.durationMinutes = normalizeDuration(patch.durationMinutes, merged.durationMinutes)
    }
    if (patch.keepDisplay !== undefined) {
      merged.keepDisplay = patch.keepDisplay !== false
    }
  }
  try {
    ztoolsApi().dbStorage.setItem(CONFIG_KEY, merged)
  } catch {
    // 存储不可用时仍然让本次运行生效，只是无法记忆选择。
  }
  return merged
}

/**
 * 判断进程是否仍存在。
 * @param {number} pid 进程号。
 * @returns {boolean} 存在返回 true。
 */
function isPidAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    return Boolean(error) && error.code === 'EPERM'
  }
}

/**
 * 读取心跳文件，解析守护进程状态。
 * @returns {{state: string, pid: number, flags: number, fresh: boolean} | null} 心跳信息。
 */
function readHeartbeat() {
  const { heartbeat } = filePaths()
  try {
    const stat = fs.statSync(heartbeat)
    const [state = '', pidText = '', flagsText = ''] = fs.readFileSync(heartbeat, 'utf8').trim().split('|')
    return {
      state,
      pid: Number(pidText) || 0,
      flags: Number(flagsText) || 0,
      fresh: Date.now() - stat.mtimeMs <= HEARTBEAT_FRESH_MS
    }
  } catch {
    return null
  }
}

/**
 * 判断心跳是否表示守护进程正在正常工作。
 * @param {{state: string, pid: number, flags: number, fresh: boolean} | null} heartbeat 心跳信息。
 * @param {number} pid 期望的进程号。
 * @returns {boolean} 心跳有效返回 true。
 */
function isHeartbeatHealthy(heartbeat, pid) {
  return Boolean(heartbeat) && heartbeat.pid === pid && heartbeat.flags > 0 && heartbeat.fresh
}

/**
 * 读取守护进程状态文件。
 * @returns {{pid: number, startedAt: number, endsAt: number | null, keepDisplay: boolean, durationMinutes: number} | null} 状态信息。
 */
function readGuardState() {
  try {
    const parsed = JSON.parse(fs.readFileSync(filePaths().state, 'utf8'))
    if (!parsed || typeof parsed !== 'object') return null
    const pid = Number(parsed.pid)
    if (!Number.isInteger(pid) || pid <= 0) return null
    return {
      pid,
      startedAt: Number(parsed.startedAt) || 0,
      endsAt: parsed.endsAt === null || parsed.endsAt === undefined ? null : Number(parsed.endsAt) || 0,
      keepDisplay: parsed.keepDisplay !== false,
      durationMinutes: Number(parsed.durationMinutes) || 0
    }
  } catch {
    return null
  }
}

/**
 * 删除运行时文件。
 * @returns {void}
 */
function cleanupRuntimeFiles() {
  const paths = filePaths()
  for (const file of [paths.state, paths.heartbeat, paths.stopFlag]) {
    try {
      fs.rmSync(file, { force: true })
    } catch {
      // 文件已被删除或暂时被占用时忽略。
    }
  }
}

/**
 * 汇总当前状态，供页面渲染。
 * @returns {object} 状态对象。
 */
function collectStatus() {
  const base = {
    supported: isWindows(),
    active: false,
    stale: false,
    pid: 0,
    startedAt: 0,
    endsAt: null,
    durationMinutes: 0,
    keepDisplay: DEFAULT_CONFIG.keepDisplay,
    remainingSeconds: null,
    elapsedSeconds: 0,
    flags: 0
  }
  if (!base.supported) return base

  const state = readGuardState()
  if (!state) return base

  const heartbeat = readHeartbeat()
  const ownedByThisPage = Boolean(guardChild) && guardChild.pid === state.pid
  const alive = ownedByThisPage || isPidAlive(state.pid)
  // 心跳既确认进程存活，也证明 SetThreadExecutionState 调用成功（flags 非 0）。
  if (!alive || !isHeartbeatHealthy(heartbeat, state.pid)) {
    return {
      ...base,
      stale: true,
      pid: state.pid,
      startedAt: state.startedAt,
      endsAt: state.endsAt,
      keepDisplay: state.keepDisplay,
      durationMinutes: state.durationMinutes
    }
  }

  const now = Date.now()
  return {
    ...base,
    active: true,
    pid: state.pid,
    startedAt: state.startedAt,
    endsAt: state.endsAt,
    durationMinutes: state.durationMinutes,
    keepDisplay: state.keepDisplay,
    remainingSeconds: state.endsAt === null ? null : Math.max(0, Math.round((state.endsAt - now) / 1000)),
    elapsedSeconds: state.startedAt ? Math.max(0, Math.round((now - state.startedAt) / 1000)) : 0,
    flags: heartbeat.flags
  }
}

/**
 * 轮询等待条件成立。
 * @param {() => boolean} predicate 判定函数。
 * @param {number} timeoutMs 超时毫秒数。
 * @returns {Promise<boolean>} 条件成立返回 true，超时返回 false。
 */
async function waitUntil(predicate, timeoutMs) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (predicate()) return true
    await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS))
  }
  return predicate()
}

/**
 * 校验 PID 归属后强制结束守护进程，避免误杀复用同一 PID 的其他进程。
 * @param {number} pid 进程号。
 * @returns {boolean} 该进程已不存在时返回 true。
 */
function killGuardProcess(pid) {
  if (!isPidAlive(pid)) return true
  const command = `$p = Get-CimInstance Win32_Process -Filter 'ProcessId = ${pid}' -ErrorAction SilentlyContinue; if ($p -and $p.CommandLine -like '*${GUARD_SCRIPT_NAME}*' -and $p.CommandLine -like '*${GUARD_MARKER}*') { Stop-Process -Id ${pid} -Force }`
  try {
    spawnSync(powershellPath(), ['-NoProfile', '-NonInteractive', '-Command', command], {
      windowsHide: true,
      timeout: 15000
    })
  } catch {
    // 校验或结束失败时不清除状态文件，让用户看到真实状态。
  }
  return !isPidAlive(pid)
}

/**
 * 停止守护进程并清理运行时文件。
 * @returns {Promise<object>} 停止后的状态。
 */
async function stopGuard() {
  const state = readGuardState()
  if (!state) {
    guardChild = null
    cleanupRuntimeFiles()
    return collectStatus()
  }

  const paths = filePaths()
  try {
    fs.writeFileSync(paths.stopFlag, String(Date.now()), { encoding: 'utf8' })
  } catch {
    // 无法写入停止标记时仍继续尝试等待与强制结束。
  }

  const child = guardChild && guardChild.pid === state.pid ? guardChild : null
  let exited = Boolean(child) && (child.exitCode !== null || child.signalCode !== null)
  if (child && !exited) {
    exited = await Promise.race([
      new Promise((resolve) => child.once('exit', () => resolve(true))),
      new Promise((resolve) => setTimeout(() => resolve(false), STOP_TIMEOUT_MS))
    ])
  }
  if (!exited) {
    // 页面重载后没有子进程引用，改用进程存在性与心跳判断。
    exited = await waitUntil(
      () => !isPidAlive(state.pid) || !isHeartbeatHealthy(readHeartbeat(), state.pid),
      STOP_TIMEOUT_MS
    )
  }
  if (!exited) exited = killGuardProcess(state.pid)

  guardChild = null
  if (exited || !isPidAlive(state.pid)) {
    cleanupRuntimeFiles()
  }
  return collectStatus()
}

/**
 * 启动守护进程，并按需保留剩余时长。
 * @param {{durationMinutes?: unknown, keepDisplay?: unknown, preserveRemaining?: unknown}} payload 启动参数。
 * @returns {Promise<object>} 启动后的状态。
 * @throws 守护进程未能在限定时间内就绪时抛出可读错误。
 */
async function startGuard(payload) {
  assertWindows()
  const patch = payload && typeof payload === 'object' ? payload : {}
  const config = readConfig()
  const durationMinutes =
    patch.durationMinutes === undefined
      ? config.durationMinutes
      : normalizeDuration(patch.durationMinutes, config.durationMinutes)
  const keepDisplay = patch.keepDisplay === undefined ? config.keepDisplay : patch.keepDisplay !== false

  const previous = collectStatus()
  let seconds = durationMinutes === 0 ? 0 : durationMinutes * 60
  if (patch.preserveRemaining && previous.active && previous.remainingSeconds !== null) {
    seconds = Math.max(0, previous.remainingSeconds)
  }

  await stopGuard()

  const paths = filePaths()
  const script = ensureGuardScript()
  const startedAt = Date.now()
  const endsAt = seconds > 0 ? startedAt + seconds * 1000 : null
  const args = [
    '-NoProfile',
    '-NonInteractive',
    '-ExecutionPolicy',
    'Bypass',
    '-WindowStyle',
    'Hidden',
    '-File',
    script,
    '-Seconds',
    String(seconds),
    '-HeartbeatFile',
    paths.heartbeat,
    '-StopFile',
    paths.stopFlag,
    '-AppProcessName',
    appProcessName(),
    '-ParentProcessId',
    String(hostProcessId()),
    GUARD_MARKER
  ]
  if (keepDisplay) args.push('-KeepDisplay')

  let stderr = ''
  const child = spawn(powershellPath(), args, {
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe']
  })
  guardChild = child
  child.stdout.setEncoding('utf8')
  child.stdout.on('data', () => {})
  child.stderr.setEncoding('utf8')
  child.stderr.on('data', (chunk) => {
    stderr = `${stderr}${chunk}`.slice(-2000)
  })
  child.on('exit', () => {
    if (guardChild === child) guardChild = null
  })
  // 先落盘状态，保证页面重载后仍能读到本次唤醒。
  fs.writeFileSync(
    paths.state,
    JSON.stringify({ pid: child.pid, startedAt, endsAt, keepDisplay, durationMinutes }),
    { encoding: 'utf8' }
  )

  // 守护进程成功调用 SetThreadExecutionState 后会写入 ready/hold 心跳。
  await waitUntil(() => {
    const heartbeat = readHeartbeat()
    if (heartbeat && heartbeat.pid === child.pid && ['ready', 'hold'].includes(heartbeat.state)) return true
    return child.exitCode !== null
  }, READY_TIMEOUT_MS)

  const heartbeat = readHeartbeat()
  const started =
    Boolean(heartbeat) && heartbeat.pid === child.pid && ['ready', 'hold'].includes(heartbeat.state)
  if (!started) {
    killGuardProcess(child.pid)
    guardChild = null
    cleanupRuntimeFiles()
    const detail = stderr.trim().split(/\r?\n/).filter(Boolean).pop()
    throw new Error(
      `唤醒守护进程启动失败${detail ? `：${detail}` : '，请确认 PowerShell 可用且未被安全策略限制'}`
    )
  }

  writeConfig({ durationMinutes, keepDisplay })
  return collectStatus()
}

// 只暴露页面需要的业务方法。
window.awakeBridge = Object.freeze({
  /** 读取当前配置。 */
  async getConfig() {
    return readConfig()
  },
  /** 保存页面上的时长与息屏选择。 */
  async saveConfig(patch) {
    return writeConfig(patch)
  },
  /** 读取当前唤醒状态，并清理已失效的守护进程。 */
  async getStatus() {
    const status = collectStatus()
    // 启动阶段会短暂缺少心跳，只有在启动窗口结束后才判定为幺留进程。
    if (status.stale && Date.now() - status.startedAt > READY_TIMEOUT_MS) {
      await stopGuard()
      return collectStatus()
    }
    return status
  },
  /** 开始保持唤醒。 */
  async start(payload) {
    return startGuard(payload)
  },
  /** 停止保持唤醒。 */
  async stop() {
    return stopGuard()
  },
  /** 页面渲染需要的边界值。 */
  constants: Object.freeze({
    MIN_DURATION_MINUTES,
    MAX_DURATION_MINUTES,
    HEARTBEAT_INTERVAL_MS,
    ES_CONTINUOUS,
    ES_SYSTEM_REQUIRED,
    ES_DISPLAY_REQUIRED
  })
})
