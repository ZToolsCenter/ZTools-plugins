// 悬浮窗 preload —— 在子窗口里运行
// 暴露文件写入 / 父窗口通信能力给 floater.js

const fs = require('fs')
const path = require('path')
const { ipcRenderer } = require('electron')

let winId = null
ipcRenderer.on('init', function (event, data) {
  winId = data && data.winId
})

function notify(text) {
  try {
    if (window.ztools && window.ztools.showNotification) {
      window.ztools.showNotification(text)
    }
  } catch (e) {}
}

function dataUrlToBuffer(dataUrl) {
  const idx = dataUrl.indexOf(',')
  const base64 = idx >= 0 ? dataUrl.slice(idx + 1) : dataUrl
  return Buffer.from(base64, 'base64')
}

window.floaterAPI = {
  // 当 localStorage 容量爆掉时，preload 会把图片写到临时文件，
  // floater.js 通过这个 API 把它读成 dataUrl，再喂给 <img>
  readImageFile: function (filePath) {
    try {
      if (!filePath || !fs.existsSync(filePath)) return null
      const ext = (path.extname(filePath).slice(1) || 'png').toLowerCase()
      const mime = ({
        bmp: 'image/bmp', gif: 'image/gif', jpeg: 'image/jpeg',
        jpg: 'image/jpeg', png: 'image/png', webp: 'image/webp', ico: 'image/x-icon'
      })[ext] || 'image/png'
      const buf = fs.readFileSync(filePath)
      return 'data:' + mime + ';base64,' + buf.toString('base64')
    } catch (e) { return null }
  },

  // 读完之后由 floater.js 调用，把临时文件清理掉
  cleanupTempFile: function (filePath) {
    try {
      if (!filePath) return
      if (filePath.indexOf('ztools-clipboard-paintbrush-') < 0) return // 安全保护
      fs.unlink(filePath, function () {})
    } catch (e) {}
  },


  // 弹出系统保存对话框并将合成后的 PNG 写入磁盘
  saveImage: function (dataUrl, suggestedName) {
    try {
      const downloads = (window.ztools && window.ztools.getPath) ? window.ztools.getPath('downloads') : ''
      const ts = new Date()
      const pad = function (n) { return String(n).padStart(2, '0') }
      const stamp = ts.getFullYear() + pad(ts.getMonth() + 1) + pad(ts.getDate()) +
        '_' + pad(ts.getHours()) + pad(ts.getMinutes()) + pad(ts.getSeconds())
      const baseName = suggestedName || ('annotated_' + stamp + '.png')
      const defaultPath = downloads ? path.join(downloads, baseName) : baseName

      const savePath = window.ztools.showSaveDialog({
        title: '保存涂改后的图片',
        defaultPath: defaultPath,
        buttonLabel: '保存',
        filters: [
          { name: 'PNG 图片', extensions: ['png'] }
        ]
      })

      if (!savePath) return null

      const buf = dataUrlToBuffer(dataUrl)
      fs.writeFileSync(savePath, buf)
      notify('已保存到 ' + savePath)
      return savePath
    } catch (e) {
      notify('保存失败: ' + (e && e.message ? e.message : e))
      return null
    }
  },

  copyImage: function (dataUrl) {
    try {
      window.ztools.copyImage(dataUrl)
      notify('已复制涂改后的图片到剪贴板')
      return true
    } catch (e) {
      notify('复制失败: ' + (e && e.message ? e.message : e))
      return false
    }
  },

  // 向父窗口（preload.js 上下文）请求改变窗口位置/大小/透明度
  move: function (dx, dy) {
    try { window.ztools.sendToParent('floater:move', { winId: winId, dx: dx, dy: dy }) } catch (e) {}
  },
  setOpacityDelta: function (delta) {
    try { window.ztools.sendToParent('floater:setOpacity', { winId: winId, delta: delta }) } catch (e) {}
  },
  requestResize: function (rect) {
    try { window.ztools.sendToParent('floater:resize', Object.assign({ winId: winId }, rect)) } catch (e) {}
  },
  close: function () {
    try { window.close() } catch (e) {}
  }
}
