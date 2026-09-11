const fs = require('node:fs')
const path = require('node:path')
const { ipcRenderer } = require('electron')

// 子窗口渠道与回调函数的映射，key 为消息渠道名
const childHandlers = {}

// 本次录制临时文件统一放在系统临时目录下，避免污染插件目录
function getTmpRoot() {
  const root = path.join(window.ztools.getPath('temp'), 'ztools-gif-recorder')
  fs.mkdirSync(root, { recursive: true })
  return root
}

// 生成唯一的临时文件，ext 不包含点号
function createTempFile(ext) {
  const name = `gif-rec-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`
  return path.join(getTmpRoot(), name)
}

// 向插件页面注入 Node 能力和辅助窗口能力
window.services = {
  // 生成录制临时 webm/gif 文件路径
  createTempFile(ext) {
    return createTempFile(ext)
  },

  // 写入 MediaRecorder 分片数据
  appendFile(filePath, data) {
    fs.appendFileSync(filePath, Buffer.from(data))
  },

  // 删除临时文件
  removeFile(filePath) {
    if (!filePath) return
    try {
      fs.rmSync(filePath, { force: true })
    } catch {
      // 文件已被外部清理时忽略
    }
  },

  // 读取 GIF 文件并返回 data URL 供页面预览
  readFileAsDataUrl(filePath) {
    const buffer = fs.readFileSync(filePath)
    return `data:image/gif;base64,${buffer.toString('base64')}`
  },

  // 弹出保存对话框，将 GIF 复制到用户选择的位置
  saveGifTo(filePath) {
    const downloads = window.ztools.getPath('downloads')
    const defaultName = `gif动画-${Date.now()}.gif`
    const dialogPath = window.ztools.showSaveDialog({
      title: '保存 GIF 动图',
      defaultPath: path.join(downloads, defaultName),
      filters: [{ name: 'GIF 动图', extensions: ['gif'] }]
    })
    if (!dialogPath) return ''
    fs.copyFileSync(filePath, dialogPath)
    return dialogPath
  },

  // 注册子窗口通过 sendToParent 发送过来的消息
  onChildMessage(channel, callback) {
    if (childHandlers[channel]) {
      ipcRenderer.removeListener(channel, childHandlers[channel])
    }
    const handler = (_event, payload) => {
      if (typeof callback === 'function') callback(payload)
    }
    childHandlers[channel] = handler
    ipcRenderer.on(channel, handler)
  },

  // 打开透明全屏区域框选窗口
  // initialAutoStopSeconds 用于让区域框选窗口默认选中主界面当前的停止时长
  openRegionWindow(display, initialAutoStopSeconds = 0) {
    const autoStopSeconds = Math.max(0, Number(initialAutoStopSeconds) || 0)
    const win = window.ztools.createBrowserWindow(`region.html?autoStop=${autoStopSeconds}`, {
      x: display.bounds.x,
      y: display.bounds.y,
      width: display.bounds.width,
      height: display.bounds.height,
      frame: false,
      transparent: true,
      resizable: false,
      movable: false,
      fullscreenable: true,
      fullscreen: false,
      skipTaskbar: true,
      autoHideMenuBar: true,
      alwaysOnTop: true,
      hasShadow: false,
      thickFrame: false,
      backgroundColor: '#00000000',
      roundedCorners: false,
      enableLargerThanScreen: true,
      webPreferences: {
        preload: 'region-preload.js'
      }
    })
    try {
      win.setAlwaysOnTop(true, 'screen-saver')
      win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })
    } catch {
      // 平台不支持时保持默认
    }
    win.showInactive()
    return win
  },

  // 打开录制中的置顶停止控制条
  openControlsWindow() {
    const display = window.ztools.getPrimaryDisplay()
    const width = 300
    const height = 76
    const x = display.workArea.x + Math.round((display.workAreaSize.width - width) / 2)
    const y = display.workArea.y + 18
    const win = window.ztools.createBrowserWindow('controls.html', {
      x,
      y,
      width,
      height,
      frame: false,
      transparent: true,
      resizable: false,
      movable: true,
      skipTaskbar: true,
      alwaysOnTop: true,
      hasShadow: true,
      backgroundColor: '#00000000',
      webPreferences: {
        preload: 'controls-preload.js'
      }
    })
    try {
      win.setAlwaysOnTop(true, 'floating')
    } catch {
      // 平台不支持时保持默认
    }
    win.show()
    return win
  },

  // 关闭辅助窗口
  closeWindow(win) {
    if (!win || win.isDestroyed?.()) return
    try {
      if (typeof win.close === 'function') win.close()
    } catch {
      // 窗口已经销毁时忽略
    }
  }
}
