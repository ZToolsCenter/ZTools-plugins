const { execSync } = require('node:child_process')
const fs = require('node:fs')
const path = require('node:path')
const os = require('node:os')

const IS_WIN = process.platform === 'win32'
const IS_MAC = process.platform === 'darwin'
const IS_LINUX = process.platform === 'linux'

// ─── Windows: VBS 脚本（只写一次，复用） ──────────────────────────
const VBS_PATH = path.join(os.tmpdir(), 'ztools_wechat_send.vbs')
if (IS_WIN && !fs.existsSync(VBS_PATH)) {
  fs.writeFileSync(VBS_PATH, `
Set WshShell = WScript.CreateObject("WScript.Shell")
WshShell.SendKeys "^%w"
WScript.Sleep 400
WshShell.SendKeys "^v"
`.trim(), { encoding: 'utf-8' })
}

// ─── 模拟键盘：唤起微信 + 粘贴 ────────────────────────────────────

function _activateWeChatAndPaste() {
  if (IS_WIN) {
    // cscript 启动 <100ms，远快于 PowerShell
    execSync(`cscript //NoLogo "${VBS_PATH}"`, { timeout: 10000, windowsHide: true })
  } else if (IS_MAC) {
    // AppleScript: 直接 activate 微信（更可靠，不依赖快捷键）
    execSync(`osascript -e '
tell application "WeChat" to activate
delay 0.4
tell application "System Events"
  tell process "WeChat"
    keystroke "v" using command down
  end tell
end tell
'`, { timeout: 10000 })
  } else if (IS_LINUX) {
    // xdotool: 查找微信窗口并激活 → 粘贴
    execSync(
      `xdotool search --class "wechat" windowactivate --sync 2>/dev/null || ` +
      `xdotool search --name "微信" windowactivate --sync 2>/dev/null; ` +
      `sleep 0.4; xdotool key ctrl+v`,
      { timeout: 10000 }
    )
  }
}

// ─── 剪贴板：文件复制 ─────────────────────────────────────────────

function _copyFilesToClipboard(filePaths) {
  const valid = filePaths.filter(p => {
    try { return fs.existsSync(p) && fs.statSync(p).isFile() }
    catch (_) { return false }
  })
  if (valid.length === 0) return false

  if (IS_WIN) {
    if (valid.length === 1) {
      window.ztools.copyFile(valid[0])
    } else {
      const list = valid.map(p => `'${p.replace(/'/g, "''")}'`).join(',')
      execSync(
        `powershell -NoProfile -WindowStyle Hidden -Command "Set-Clipboard -Path ${list}"`,
        { timeout: 10000 }
      )
    }
  } else if (IS_MAC) {
    // 用 osascript 设置文件剪贴板（POSIX file 列表）
    const fileList = valid.map(p => `POSIX file "${p}"`).join(', ')
    execSync(`osascript -e 'tell app "Finder" to set the clipboard to {${fileList}}'`, { timeout: 10000 })
  } else if (IS_LINUX) {
    // xclip 需要文件路径列表（复制为文件 URI 列表）
    const list = valid.map(p => `file://${p}`).join('\n')
    execSync(`echo "${list.replace(/"/g, '\\"')}" | xclip -selection clipboard -t text/uri-list`, { timeout: 10000 })
  }
  return true
}

// ─── 对外 API ──────────────────────────────────────────────────────

function sendTextToWeChat(text) {
  if (!text || !text.trim()) {
    window.ztools.showNotification('没有可发送的内容')
    return
  }
  if (!window.ztools.copyText(text)) {
    window.ztools.showNotification('复制文本失败')
    return
  }
  try {
    _activateWeChatAndPaste()
  } catch (err) {
    window.ztools.showNotification('发送失败：' + err.message)
  }
}

function sendFilesToWeChat(filePaths) {
  if (!filePaths || filePaths.length === 0) {
    window.ztools.showNotification('没有可发送的文件')
    return
  }
  if (!_copyFilesToClipboard(filePaths)) {
    window.ztools.showNotification('未找到可发送的文件')
    return
  }
  try {
    _activateWeChatAndPaste()
  } catch (err) {
    window.ztools.showNotification('发送失败：' + err.message)
  }
}

window.services = {
  sendTextToWeChat,
  sendFilesToWeChat
}
