const { clipboard } = require('electron')

// 通过 window 对象向渲染进程注入 nodejs 能力
window.services = {
  // 文本写入系统剪贴板
  copyText(text) {
    try {
      clipboard.writeText(text)
      return true
    } catch (err) {
      return false
    }
  }
}
