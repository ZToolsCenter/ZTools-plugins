const { spawn, spawnSync } = require('child_process')
const fs = require('fs')
const path = require('path')

// ============================================================
// QuickTerm preload 服务
// 职责：路径校验 → 终端探测 → child_process.spawn 在终端打开目录
// 数据持久化由渲染层走 ztools.dbStorage；本文件的 loadStorage/saveStorage
// 仅用于读取历史版本（本地文件方案）遗留数据，供迁移使用
// 注意：本文件为 CommonJS，禁止打包/压缩/混淆
// ============================================================

// ---------- 内部工具 ----------

// 在 PATH 中查找可执行文件，返回完整路径（找不到返回 null）
// win32 用 where.exe，macOS/Linux 用 which
function which(exe) {
  try {
    const cmd = process.platform === 'win32' ? 'where.exe' : 'which'
    const res = spawnSync(cmd, [exe], { windowsHide: true, encoding: 'utf-8' })
    if (res.status !== 0) return null
    const first = String(res.stdout || '')
      .split(/\r?\n/)
      .map((s) => s.trim())
      .filter(Boolean)[0]
    return first || null
  } catch (e) {
    return null
  }
}

function exists(p) {
  try {
    return !!p && fs.existsSync(p)
  } catch (e) {
    return false
  }
}

// ---------- 历史遗留数据的迁移读取（已弃用文件持久化，仅为兼容保留） ----------

function storageFile() {
  return path.join(window.ztools.getPath('userData'), 'quickterm-storage.json')
}

// 读取全部本地数据（无文件返回 null）
function loadStorage() {
  try {
    return JSON.parse(fs.readFileSync(storageFile(), 'utf-8'))
  } catch (e) {
    return null
  }
}

// 写入全部本地数据
function saveStorage(data) {
  try {
    const file = storageFile()
    fs.mkdirSync(path.dirname(file), { recursive: true })
    fs.writeFileSync(file, JSON.stringify(data, null, 2), 'utf-8')
    return true
  } catch (e) {
    console.warn('[QuickTerm] saveStorage failed:', e)
    return false
  }
}

// ---------- 路径校验 ----------

// 校验路径存在且为目录；是文件则取父目录兜底
function normalizeTarget(p) {
  let target = String(p || '').trim().replace(/^"(.*)"$/, '$1')
  if (!target) throw new Error('路径为空')
  let st
  try {
    st = fs.statSync(target)
  } catch (e) {
    throw new Error('路径不存在: ' + target)
  }
  if (st.isFile()) {
    // 粘贴的是文件而非文件夹：取父目录
    target = path.dirname(target)
  } else if (!st.isDirectory()) {
    throw new Error('目标不是文件夹: ' + target)
  }
  return path.resolve(target)
}

// ---------- 终端探测 ----------

function resolvePowershell() {
  const found = which('powershell.exe')
  if (found) return found
  const fallback = 'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe'
  return exists(fallback) ? fallback : null
}

// Git Bash 检测顺序：设置手动指定 → 常见安装路径 → where git 反推 → where bash（排除 WSL 的 System32 bash）
function resolveGitBash(settings) {
  if (settings && settings.gitBashPath && exists(settings.gitBashPath)) return settings.gitBashPath
  const candidates = [
    'C:\\Program Files\\Git\\bin\\bash.exe',
    'C:\\Program Files (x86)\\Git\\bin\\bash.exe',
    path.join(process.env.LOCALAPPDATA || '', 'Programs', 'Git', 'bin', 'bash.exe')
  ]
  for (const c of candidates) {
    if (exists(c)) return c
  }
  const git = which('git.exe')
  if (git) {
    // <安装目录>\cmd\git.exe → <安装目录>\bin\bash.exe
    const guess = path.join(path.dirname(path.dirname(git)), 'bin', 'bash.exe')
    if (exists(guess)) return guess
  }
  const bash = which('bash.exe')
  // System32 下的 bash.exe 是 WSL，不支持 --cd 参数，必须排除
  if (bash && !/system32|windowsapps/i.test(bash)) return bash
  return null
}

// 探测本机可用终端，返回 [{ type, label, available, exe?, path? }]
function detectTerminals() {
  if (process.platform === 'darwin') return detectTerminalsMac()
  return detectTerminalsWindows()
}

function detectTerminalsWindows() {
  let settings = {}
  try {
    settings = window.ztools.dbStorage.getItem('qt-settings') || {}
  } catch (e) {
    settings = {}
  }
  const wt = which('wt.exe')
  const pwsh = which('pwsh.exe')
  const powershell = resolvePowershell()
  const cmd = which('cmd.exe') || (exists('C:\\Windows\\System32\\cmd.exe') ? 'C:\\Windows\\System32\\cmd.exe' : null)
  const gitbash = resolveGitBash(settings)
  return [
    { type: 'wt', label: 'Windows Terminal', available: !!wt, exe: wt || undefined },
    { type: 'pwsh', label: 'PowerShell 7', available: !!pwsh, exe: pwsh || undefined },
    { type: 'powershell', label: 'Windows PowerShell', available: !!powershell, exe: powershell || undefined },
    { type: 'cmd', label: 'CMD', available: !!cmd, exe: cmd || undefined },
    { type: 'gitbash', label: 'Git Bash', available: !!gitbash, path: gitbash || undefined }
  ]
}

// macOS 终端探测：Terminal.app 系统自带必有；iTerm2 常见装在 /Applications 或 ~/Applications
function detectTerminalsMac() {
  const terminalApp =
    ['/System/Applications/Utilities/Terminal.app', '/Applications/Utilities/Terminal.app'].find(exists) || null
  const itermApp = ['/Applications/iTerm.app', path.join(process.env.HOME || '', 'Applications', 'iTerm.app')].find(
    exists
  )
  return [
    { type: 'terminal', label: 'Terminal (系统终端)', available: !!terminalApp, path: terminalApp || undefined },
    { type: 'iterm', label: 'iTerm2', available: !!itermApp, path: itermApp || undefined }
  ]
}

// ---------- 核心能力 ----------

// 经 cmd start 启动控制台类终端，强制创建新控制台窗口
// 坑：start 的第一个【带引号】参数会被当作窗口标题而非程序名！
// 用空字符串 ''（node 传参时引号化为 ""）占住标题位，否则程序名会被误当标题导致静默失败
function startConsoleTerminal(exe, args, cwd) {
  const cmdArgs = ['/c', 'start', '', exe].concat(args)
  const res = spawnSync('cmd.exe', cmdArgs, {
    windowsHide: true,
    cwd: cwd,
    encoding: 'utf-8'
  })
  if (res.error) throw new Error('启动终端失败: ' + res.error.message)
  if (res.status !== 0) {
    const detail = String(res.stderr || res.stdout || '').trim()
    throw new Error('启动终端失败: ' + (detail || 'exit code ' + res.status))
  }
}

// POSIX 单引号转义（用于拼进 AppleScript 的 cd 命令）
function posixQuote(s) {
  return "'" + String(s).replace(/'/g, "'\\''") + "'"
}

// 执行 osascript（AppleScript），失败抛出真实错误
function runAppleScript(script) {
  const res = spawnSync('osascript', ['-e', script], { encoding: 'utf-8', timeout: 10000 })
  if (res.error) throw new Error('启动终端失败: ' + res.error.message)
  if (res.status !== 0) {
    const detail = String(res.stderr || res.stdout || '').trim()
    throw new Error('启动终端失败: ' + (detail || 'exit code ' + res.status))
  }
}

function openInTerminalMac(target, type) {
  if (type === 'terminal') {
    // open -a Terminal <dir>：新开窗口，工作目录即该文件夹
    const res = spawnSync('open', ['-a', 'Terminal', target], { encoding: 'utf-8' })
    if (res.error) throw new Error('启动终端失败: ' + res.error.message)
    if (res.status !== 0) {
      const detail = String(res.stderr || res.stdout || '').trim()
      throw new Error('启动终端失败: ' + (detail || 'exit code ' + res.status))
    }
    return
  }
  if (type === 'iterm') {
    // iTerm2 不支持 open -a 直接定位目录，走 AppleScript 新建窗口并 cd
    const script =
      'tell application "iTerm"\n' +
      '  activate\n' +
      '  create window with default profile\n' +
      '  tell current session of current window to write text "cd ' +
      posixQuote(target) +
      '"\n' +
      'end tell'
    runAppleScript(script)
    return
  }
  throw new Error('不支持的终端类型: ' + type)
}

// 在指定终端打开目标路径；terminalType 为 'auto' 时按降级链自动选择
// 成功返回 { type: 实际使用的终端 }，失败抛 Error
function openInTerminal(targetPath, terminalType) {
  const target = normalizeTarget(targetPath)
  if (process.platform === 'darwin') {
    const list = detectTerminalsMac()
    let type = terminalType || 'auto'
    if (type === 'auto') {
      // 降级链：iTerm2 → Terminal.app（Terminal.app 系统自带，实际必有可用项）
      const picked = ['iterm', 'terminal'].find((t) => list.some((x) => x.type === t && x.available))
      if (!picked) throw new Error('未找到可用的终端')
      type = picked
    }
    const info = list.find((x) => x.type === type)
    if (!info || !info.available) throw new Error('所选终端在本机不可用: ' + type)
    openInTerminalMac(target, type)
    return { type }
  }

  const list = detectTerminals()
  let type = terminalType || 'auto'
  if (type === 'auto') {
    // 降级链：wt → pwsh → powershell → cmd，gitbash 独立兜底
    const chain = ['wt', 'pwsh', 'powershell', 'cmd', 'gitbash']
    const picked = chain.find((t) => list.some((x) => x.type === t && x.available))
    if (!picked) throw new Error('未找到可用的终端')
    type = picked
  }
  const info = list.find((x) => x.type === type)
  if (!info || !info.available) throw new Error('所选终端在本机不可用: ' + type)

  if (type === 'wt') {
    // wt.exe 是 GUI 程序，直接 spawn 即可弹出窗口；异步错误走系统通知
    const child = spawn(info.exe || 'wt.exe', ['-d', target], { detached: true, stdio: 'ignore' })
    child.on('error', (e) => {
      try {
        window.ztools.showNotification('QuickTerm: ' + ((e && e.message) || '终端启动失败'))
      } catch (_) {}
    })
    child.unref()
  } else if (type === 'pwsh' || type === 'powershell') {
    startConsoleTerminal(info.exe, ['-NoExit'], target)
  } else if (type === 'cmd') {
    startConsoleTerminal('cmd.exe', ['/K', 'cd', '/d', target], target)
  } else if (type === 'gitbash') {
    // gitbash：--cd 指定工作目录
    startConsoleTerminal(info.path, ['--cd=' + target])
  } else {
    throw new Error('不支持的终端类型: ' + type)
  }
  return { type }
}

// 弹系统目录选择框（可多选），返回选中路径数组（取消返回空数组）
function pickFolders() {
  const res = window.ztools.showOpenDialog({
    title: '选择要收藏的文件夹',
    properties: ['openDirectory', 'createDirectory', 'multiSelections']
  })
  return Array.isArray(res) ? res : []
}

// 通过 window 对象向渲染进程注入能力
window.services = {
  loadStorage,
  saveStorage,
  normalizeTarget,
  detectTerminals,
  openInTerminal,
  pickFolders
}
