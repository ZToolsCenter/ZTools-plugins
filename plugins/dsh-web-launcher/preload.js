// DSH 启动器：ZTools 无界面插件，提供三条指令
//   dsh         启动 DSH Web（已在运行则直接打开浏览器）
//   dsh update  更新 DSH
//   dsh config  打开启动器配置文件
// 本文件是插件 preload，运行在 contextIsolation:false / sandbox:false 的 preload 上下文
// 因此可以直接使用 Node.js 的 require 与 __dirname
'use strict'

const fs = require('node:fs')
const net = require('node:net')
const os = require('node:os')
const path = require('node:path')
const { spawn } = require('node:child_process')

const FEATURE_WEB = 'dsh-web'
const FEATURE_UPDATE = 'dsh-update'
const FEATURE_CONFIG = 'dsh-config'

// 配置文件放在用户目录，覆盖安装插件不会丢
// 环境变量可把它挪到别处，主要用于测试与多份配置共存
const CONFIG_PATH = process.env.DSH_WEB_LAUNCHER_CONFIG || path.join(os.homedir(), '.dsh-web-launcher.json')

// dsh web 的默认监听地址，与 dsh 自带默认值保持一致
const DEFAULT_HOST = '127.0.0.1'
const DEFAULT_PORT = 3080

// 探活超时，避免已在运行判定拖慢启动
const PROBE_TIMEOUT_MS = 500

// 内置默认值，同时用于首次运行时生成配置文件
const FALLBACK_CONFIG = {
  dshCommand: 'dsh',
  defaultCwd: os.homedir(),
  webArgs: [],
  updateCommand: 'npm install -g @deepseek-ai/dsh@latest',
  keepWindowOpen: true,
  reuseRunningInstance: true
}

// 读取配置文件，缺失或损坏时退回内置默认值
function readConfig() {
  let parsed = null
  try {
    parsed = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'))
  } catch (error) {
    parsed = null
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return Object.assign({}, FALLBACK_CONFIG)
  }
  const merged = Object.assign({}, FALLBACK_CONFIG, parsed)
  // 兼容 1.0.x 的 command 字段
  if (typeof parsed.dshCommand !== 'string' && typeof parsed.command === 'string') {
    merged.dshCommand = parsed.command
  }
  return merged
}

// 配置文件不存在时按默认值生成一份，返回是否新建
function ensureConfigFile() {
  try {
    if (fs.existsSync(CONFIG_PATH)) {
      return { path: CONFIG_PATH, created: false }
    }
    fs.mkdirSync(path.dirname(CONFIG_PATH), { recursive: true })
    fs.writeFileSync(CONFIG_PATH, JSON.stringify(FALLBACK_CONFIG, null, 2) + '\n', 'utf8')
    return { path: CONFIG_PATH, created: true }
  } catch (error) {
    return { path: CONFIG_PATH, created: false, error: String((error && error.message) || error) }
  }
}

// 从搜索框文本里取出目录参数，例如 dsh D:\work 取到 D:\work
function parseDirArgument(payload) {
  if (typeof payload !== 'string') return ''
  const trigger = /^\s*dsh(\s+(web|update|config))?\s*/i
  let text = payload.replace(trigger, '').trim()
  if (text.length >= 2) {
    const first = text.charAt(0)
    const last = text.charAt(text.length - 1)
    const quoted = (first === '"' && last === '"') || (first === "'" && last === "'")
    if (quoted) text = text.slice(1, -1).trim()
  }
  return text
}

// 判断路径存在且是目录
function isDirectory(target) {
  try {
    return fs.existsSync(target) && fs.statSync(target).isDirectory()
  } catch (error) {
    return false
  }
}

// 目录优先级：搜索框参数 > 配置文件的 defaultCwd > 当前用户主目录
function resolveCwd(payload, config) {
  const fromPayload = parseDirArgument(payload)
  if (fromPayload && isDirectory(fromPayload)) {
    return { cwd: fromPayload, source: 'payload' }
  }
  const configured = config && typeof config.defaultCwd === 'string' ? config.defaultCwd.trim() : ''
  if (configured && isDirectory(configured)) {
    return { cwd: configured, source: 'config' }
  }
  return { cwd: os.homedir(), source: 'home' }
}

// 读取 dsh 命令位置，可以是 PATH 上的 dsh，也可以是 dsh.cmd 的绝对路径
function readDshCommand(config) {
  const value = config && typeof config.dshCommand === 'string' ? config.dshCommand.trim() : ''
  return value === '' ? FALLBACK_CONFIG.dshCommand : value
}

// 程序路径含空白时必须自己加引号：cmd 是按空格分词的
// 用户已经在配置里自己写了引号时原样保留
function quoteProgram(program) {
  if (typeof program !== 'string' || program === '') return program
  if (program.charAt(0) === '"') return program
  return /\s/.test(program) ? '"' + program + '"' : program
}

// 组装 dsh web 的命令行文本，webArgs 用于附加 --port / --no-open 之类的参数
function buildWebCommandLine(config) {
  const extra = config && Array.isArray(config.webArgs) ? config.webArgs.map(String) : []
  return [quoteProgram(readDshCommand(config)), 'web'].concat(extra).join(' ')
}

// 组装更新命令，默认走 npm 全局安装
function buildUpdateCommandLine(config) {
  const value = config && typeof config.updateCommand === 'string' ? config.updateCommand.trim() : ''
  return value === '' ? FALLBACK_CONFIG.updateCommand : value
}

// 从参数里读取 --name value 或 --name=value，取不到返回空串
function readOptionValue(args, name) {
  for (let index = 0; index < args.length; index += 1) {
    const token = args[index]
    if (token === name) {
      const next = args[index + 1]
      return next === undefined ? '' : String(next)
    }
    if (token.indexOf(name + '=') === 0) {
      return token.slice(name.length + 1)
    }
  }
  return ''
}

// 推导 dsh web 的监听地址：优先 --port / --host，缺省回到 3080 / 127.0.0.1
// port 为 0 表示让系统随机分配端口，此时无法复用已有实例
function resolveServerEndpoint(config) {
  const extra = config && Array.isArray(config.webArgs) ? config.webArgs.map(String) : []
  const args = ['web'].concat(extra)
  const portText = readOptionValue(args, '--port') || readOptionValue(args, '-p')
  const parsedPort = portText === '' ? NaN : Number.parseInt(portText, 10)
  const port = Number.isInteger(parsedPort) && parsedPort >= 0 && parsedPort <= 65535 ? parsedPort : DEFAULT_PORT
  let host = readOptionValue(args, '--host') || DEFAULT_HOST
  if (host === '' || host === '0.0.0.0' || host === '::') host = DEFAULT_HOST
  return { host: host, port: port, url: 'http://' + host + ':' + port }
}

// TCP 探活：能连上说明端口已经有实例在监听
function isPortListening(host, port) {
  return new Promise(function (resolve) {
    let settled = false
    const socket = net.connect({ host: host, port: port })
    const finish = function (result) {
      if (settled) return
      settled = true
      socket.destroy()
      resolve(result)
    }
    socket.setTimeout(PROBE_TIMEOUT_MS)
    socket.once('connect', function () {
      finish(true)
    })
    socket.once('timeout', function () {
      finish(false)
    })
    socket.once('error', function () {
      finish(false)
    })
  })
}

// 用默认浏览器打开已有实例
function openInBrowser(url) {
  try {
    const ztools = window.ztools
    if (ztools && typeof ztools.shellOpenExternal === 'function') {
      ztools.shellOpenExternal(url)
    }
  } catch (error) {
    // 打开浏览器失败不影响后续流程
  }
}

// 收起 ZTools 主窗口，把焦点还给启动前的窗口
function hideLauncher() {
  try {
    const ztools = window.ztools
    if (ztools && typeof ztools.hideMainWindow === 'function') {
      Promise.resolve(ztools.hideMainWindow()).catch(function () {})
    }
  } catch (error) {
    // 隐藏失败不影响命令启动
  }
}

// 打开独立 cmd 窗口执行命令
// 必须经 start 显式新建控制台：detached 的 spawn 会让子进程没有控制台，
// 而 stdio 为 ignore 时 cmd /k 会从 NUL 读到 EOF 后立刻退出，窗口一闪就没
// 整条命令行自己拼接、并以 windowsVerbatimArguments 逐字交给 CreateProcess：
// Node 默认按 MSVCRT 规则用反斜杠转义参数里的引号，cmd.exe 不认这种转义，
// 会让带空格的程序路径被按空格切开，报「不是内部或外部命令」
function spawnConsole(commandLine, cwd, keepWindowOpen) {
  const shell = process.env.ComSpec || process.env.COMSPEC || 'cmd.exe'
  const program = quoteProgram(shell)
  const line = program + ' /c start "" ' + program + ' ' + (keepWindowOpen ? '/k' : '/c') + ' "' + commandLine + '"'
  const child = spawn(shell, [line], {
    cwd: cwd,
    detached: true,
    stdio: 'ignore',
    windowsHide: false,
    shell: false,
    windowsVerbatimArguments: true
  })
  // 必须消费 error 事件，否则 spawn 失败会变成 preload 的未捕获异常
  child.on('error', function () {})
  child.unref()
  return child
}

// dsh：已在运行则打开浏览器，否则新开 cmd 窗口跑 dsh web
async function runWeb(action) {
  const config = readConfig()
  const target = resolveCwd(action ? action.payload : '', config)
  const commandLine = buildWebCommandLine(config)
  const endpoint = resolveServerEndpoint(config)

  if (config.reuseRunningInstance !== false && endpoint.port > 0) {
    const alive = await isPortListening(endpoint.host, endpoint.port)
    if (alive) {
      openInBrowser(endpoint.url)
      hideLauncher()
      return {
        ok: true,
        reused: true,
        url: endpoint.url,
        cwd: target.cwd,
        cwdSource: target.source
      }
    }
  }

  spawnConsole(commandLine, target.cwd, config.keepWindowOpen !== false)
  hideLauncher()

  return {
    ok: true,
    reused: false,
    commandLine: commandLine,
    url: endpoint.url,
    cwd: target.cwd,
    cwdSource: target.source
  }
}

// dsh update：新开 cmd 窗口执行更新命令，/k 让 npm 的输出留在窗口里
function runUpdate() {
  const config = readConfig()
  const target = resolveCwd('', config)
  const commandLine = buildUpdateCommandLine(config)
  spawnConsole(commandLine, target.cwd, config.keepWindowOpen !== false)
  hideLauncher()
  return {
    ok: true,
    commandLine: commandLine,
    cwd: target.cwd
  }
}

// dsh config：配置文件不存在就先写默认值，然后打开文件并在资源管理器中定位
function runConfig() {
  const ensured = ensureConfigFile()
  let opened = false
  let revealed = false
  try {
    const ztools = window.ztools
    if (ztools && typeof ztools.shellOpenPath === 'function') {
      ztools.shellOpenPath(ensured.path)
      opened = true
    }
    if (ztools && typeof ztools.shellShowItemInFolder === 'function') {
      ztools.shellShowItemInFolder(ensured.path)
      revealed = true
    }
    if (ztools && typeof ztools.showToast === 'function') {
      const prefix = ensured.created ? '已生成配置 ' : '已打开配置 '
      Promise.resolve(ztools.showToast(prefix + ensured.path, { type: 'success', duration: 4000 })).catch(function () {})
    }
  } catch (error) {
    // 打开失败不回滚已生成的配置文件
  }
  hideLauncher()
  return {
    ok: ensured.error === undefined,
    configPath: ensured.path,
    created: ensured.created,
    opened: opened,
    revealed: revealed,
    error: ensured.error
  }
}

// 统一入口：任何异常都转成结构化结果，避免宿主只看到 30 秒超时
function safeEnter(handler) {
  return function (action) {
    return Promise.resolve()
      .then(function () {
        return handler(action)
      })
      .catch(function (error) {
        return { ok: false, error: String((error && error.message) || error) }
      })
  }
}

// ZTools 无界面插件入口：feature 的 mode 为 none 时宿主调用 args.enter(action)
window.exports = {}
window.exports[FEATURE_WEB] = { mode: 'none', args: { enter: safeEnter(runWeb) } }
window.exports[FEATURE_UPDATE] = { mode: 'none', args: { enter: safeEnter(runUpdate) } }
window.exports[FEATURE_CONFIG] = { mode: 'none', args: { enter: safeEnter(runConfig) } }

// 便于在 Node 环境下做单元测试，preload 运行时会忽略这段导出
if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    FEATURE_WEB: FEATURE_WEB,
    FEATURE_UPDATE: FEATURE_UPDATE,
    FEATURE_CONFIG: FEATURE_CONFIG,
    CONFIG_PATH: CONFIG_PATH,
    FALLBACK_CONFIG: FALLBACK_CONFIG,
    DEFAULT_HOST: DEFAULT_HOST,
    DEFAULT_PORT: DEFAULT_PORT,
    readConfig: readConfig,
    ensureConfigFile: ensureConfigFile,
    parseDirArgument: parseDirArgument,
    resolveCwd: resolveCwd,
    readDshCommand: readDshCommand,
    buildWebCommandLine: buildWebCommandLine,
    buildUpdateCommandLine: buildUpdateCommandLine,
    resolveServerEndpoint: resolveServerEndpoint,
    isPortListening: isPortListening
  }
}
