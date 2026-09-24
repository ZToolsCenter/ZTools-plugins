const { clipboard } = require('electron')

/**
 * 为页面提供只读剪贴板桥接，避免依赖浏览器权限弹窗。
 * @returns {string} 当前剪贴板中的纯文本。
 */
function readClipboardText() {
  return clipboard.readText()
}

window.sqlFormatterBridge = Object.freeze({ readClipboardText })
