// public/preload/terminals.js
// 检测本机已安装的终端应用，并提供"在终端中执行命令"能力。
// 分层执行模型（macOS）：
//   applescript - Terminal/iTerm2，AppleScript 可靠执行命令
//   openargs    - Alacritty/Ghostty/WezTerm 等，open -a <App> --args -e 执行
//   none        - Warp/Tabby/XTerminal/VS Code 等无外部自动执行 API，打开应用 + 提示手动执行

const { execFile } = require('node:child_process')
const fs = require('node:fs')

// 各平台终端应用定义（数组顺序即默认优先级，从高到低）
// execType: applescript | openargs | none
function terminalDefs() {
  if (process.platform === 'darwin') {
    return [
      { id: 'iterm', name: 'iTerm2', path: '/Applications/iTerm.app', execType: 'applescript' },
      { id: 'terminal', name: 'Terminal', path: '/System/Applications/Utilities/Terminal.app', execType: 'applescript' },
      { id: 'alacritty', name: 'Alacritty', path: '/Applications/Alacritty.app', execType: 'openargs' },
      { id: 'ghostty', name: 'Ghostty', path: '/Applications/Ghostty.app', execType: 'openargs' },
      { id: 'wezterm', name: 'WezTerm', path: '/Applications/WezTerm.app', execType: 'openargs' },
      { id: 'warp', name: 'Warp', path: '/Applications/Warp.app', execType: 'none' },
      { id: 'tabby', name: 'Tabby', path: '/Applications/Tabby.app', execType: 'none' },
      { id: 'xterminal', name: 'XTerminal', path: '/Applications/XTerminal.app', execType: 'none' },
      { id: 'vscode', name: 'VS Code', path: '/Applications/Visual Studio Code.app', execType: 'none' }
    ]
  }
  if (process.platform === 'win32') {
    return [
      { id: 'wt', name: 'Windows Terminal', path: 'wt', execType: 'openargs' },
      { id: 'cmd', name: '命令提示符', path: 'cmd', execType: 'openargs' }
    ]
  }
  return [
    { id: 'gnome-terminal', name: 'GNOME Terminal', path: 'gnome-terminal', execType: 'openargs' },
    { id: 'konsole', name: 'Konsole', path: 'konsole', execType: 'openargs' },
    { id: 'xterm', name: 'XTerm', path: 'xterm', execType: 'openargs' }
  ]
}

// 过滤出已安装的终端，保持定义顺序（即优先级）。绝对路径(.app)用 existsSync，
// 命令名终端（wt/cmd/gnome-terminal 等）交由 PATH 解析，暂视为可用。
function detectTerminals() {
  return terminalDefs().filter((t) => {
    if (t.path.includes('/')) return fs.existsSync(t.path)
    return true
  })
}

// AppleScript 字符串转义（反斜杠与双引号）
function escapeAppleScript(text) {
  return String(text).replace(/\\/g, '\\\\').replace(/"/g, '\\"')
}

function execOsascript(args) {
  return new Promise((resolve) => {
    execFile('/usr/bin/osascript', ['-e', ...args], { timeout: 10000 }, (err, stdout, stderr) => {
      if (err) resolve({ ok: false, message: (stderr || err.message || 'osascript 执行失败').trim() })
      else resolve({ ok: true, message: '' })
    })
  })
}

function execOpen(appName, args) {
  return new Promise((resolve) => {
    execFile('/usr/bin/open', ['-a', appName, ...args], { timeout: 10000 }, (err, stdout, stderr) => {
      if (err) resolve({ ok: false, message: (stderr || err.message || `无法打开 ${appName}`).trim() })
      else resolve({ ok: true, message: '' })
    })
  })
}

// 用指定终端打开并执行命令（macOS 分层执行；其余平台留待扩展）
function openTerminal(id, command) {
  const cmd = String(command || '')
  if (process.platform !== 'darwin') {
    return Promise.resolve({ ok: false, message: '当前平台终端执行待扩展' })
  }
  const installed = detectTerminals()
  const term = installed.find((t) => t.id === id) || installed[0]
  if (!term) return Promise.resolve({ ok: false, message: '未检测到可用终端' })

  // applescript：Terminal / iTerm2
  if (term.execType === 'applescript') {
    if (term.id === 'iterm') {
      // 显式持有新窗口引用并延时，避免会话未就绪时 write text 丢失
      const script = [
        'tell application "iTerm"',
        '  set win to (create window with default profile)',
        '  delay 0.4',
        `  tell current session of win to write text "${escapeAppleScript(cmd)}"`,
        'end tell'
      ].join('\n')
      return execOsascript([script]).then((r) => ({ ...r, used: term.name }))
    }
    return execOsascript([`tell application "Terminal" to do script "${escapeAppleScript(cmd)}"`]).then((r) => ({
      ...r,
      used: term.name
    }))
  }

  // openargs：Alacritty / Ghostty / WezTerm 等，open -a <App> --args -e bash -lc "<cmd>"
  if (term.execType === 'openargs') {
    return execOpen(term.name, ['--args', '-e', 'bash', '-lc', cmd]).then((r) => ({
      ...r,
      used: term.name
    }))
  }

  // none：Warp / Tabby / XTerminal / VS Code 等无外部自动执行 API，打开应用 + 提示手动执行
  return execOpen(term.name, []).then((r) =>
    r.ok
      ? { ok: true, used: term.name, message: `已打开 ${term.name}，请手动执行：${cmd}` }
      : r
  )
}

module.exports = {
  terminalDefs,
  detectTerminals,
  openTerminal,
  escapeAppleScript
}
