// 提醒插件的最小 preload 桥接（uTools 原版 1:1 移植配套）。
// 职责：
// 1. 按兼容层计算好的几何参数创建提醒弹窗（独立 BrowserWindow），
//    弹窗页面为原版 components/remind/index.html；
// 2. 接收弹窗通过 ztools.sendToParent 发来的关闭请求，销毁对应窗口；
// 3. 插件退出时统一清理尚未关闭的弹窗。
// 说明：弹窗数据通过 ztools.dbStorage + URL 查询参数传递，无需 IPC 初始化。

const { ipcRenderer } = require('electron')

/** 已创建弹窗：弹窗 webContents.id → 窗口代理对象 */
const popupWindows = new Map()

/** 关闭并移除一个弹窗窗口 */
function closePopup(webContentsId) {
  const win = popupWindows.get(webContentsId)
  if (!win) return
  popupWindows.delete(webContentsId)
  try {
    win.destroy()
  } catch (error) {
    // 窗口可能已被用户或系统销毁，忽略即可
  }
}

// 弹窗页面调用 ztools.sendToParent('remind:popup-close') 后，
// 宿主 preload 会把消息重新派发到本进程的 ipcRenderer 上，event.senderId 即弹窗标识。
ipcRenderer.on('remind:popup-close', (event) => {
  if (event && typeof event.senderId === 'number') {
    closePopup(event.senderId)
  }
})

window.remindBridge = Object.freeze({
  /**
   * 打开提醒弹窗
   * @param {{ id: string, width?: number, height?: number, x?: number, y?: number }} request
   *   width/height/x/y 均可省略：省略尺寸时使用 Electron 默认窗口大小并居中
   *   （与原版「中间」弹窗行为一致）。
   * @returns {{ ok: boolean, error?: string }}
   */
  openRemindWindow(request) {
    const ztools = window.ztools
    if (!ztools || typeof ztools.createBrowserWindow !== 'function') {
      return { ok: false, error: '宿主窗口能力不可用' }
    }
    if (!request || typeof request.id !== 'string' || !request.id) {
      return { ok: false, error: '弹窗数据标识缺失' }
    }

    const url = `components/remind/index.html?id=${encodeURIComponent(request.id)}`
    const options = {
      alwaysOnTop: true,
      transparent: true,
      frame: false,
      resizable: false,
      backgroundColor: '#00000000',
      webPreferences: {
        devTools: true
      }
    }

    if (request.width !== undefined && request.width !== null) {
      const width = Number(request.width)
      if (!Number.isFinite(width) || width <= 0) {
        return { ok: false, error: '弹窗宽度无效' }
      }
      options.width = Math.round(width)
    }
    if (request.height !== undefined && request.height !== null) {
      const height = Number(request.height)
      if (!Number.isFinite(height) || height <= 0) {
        return { ok: false, error: '弹窗高度无效' }
      }
      options.height = Math.round(height)
    }
    const x = Number(request.x)
    const y = Number(request.y)
    if (Number.isFinite(x) && Number.isFinite(y)) {
      options.x = Math.round(x)
      options.y = Math.round(y)
    }

    let win
    try {
      win = ztools.createBrowserWindow(url, options)
    } catch (error) {
      return { ok: false, error: `创建弹窗失败：${error && error.message ? error.message : error}` }
    }
    if (!win || typeof win !== 'object' || !win.webContents || typeof win.webContents.id !== 'number') {
      return { ok: false, error: '创建弹窗失败：宿主返回了无效窗口' }
    }

    popupWindows.set(win.webContents.id, win)
    return { ok: true }
  },

  /** 关闭当前插件创建的所有提醒弹窗 */
  closeAllRemindWindows() {
    for (const id of Array.from(popupWindows.keys())) {
      closePopup(id)
    }
  },

  /** 当前未关闭的弹窗数量（调试与测试用） */
  getPopupCount() {
    return popupWindows.size
  }
})
