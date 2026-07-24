// 剪贴板图片涂改 - 主 preload
// 负责：从剪贴板/payload/文件中拿到图片 -> 创建一个无边框、置顶、透明的悬浮窗
// 同时通过 onMainPush 在 ZTools 主搜索框中推送 [涂改/保存] 两个选项

const { clipboard, ipcRenderer } = require('electron')
const fs = require('fs')
const path = require('path')
const os = require('os')

const MIME_MAP = {
  bmp: 'image/bmp',
  gif: 'image/gif',
  heic: 'image/heic',
  jpeg: 'image/jpeg',
  jpg: 'image/jpeg',
  jpe: 'image/jpeg',
  png: 'image/png',
  svg: 'image/svg+xml',
  webp: 'image/webp',
  ico: 'image/x-icon'
}

// ===================== 通用辅助 =====================

function uuid() {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) {
    const r = (Math.random() * 16) | 0
    const v = c === 'x' ? r : (r & 0x3) | 0x8
    return v.toString(16)
  })
}

function notify(text) {
  try {
    if (window.ztools && window.ztools.showNotification) {
      window.ztools.showNotification(text)
    }
  } catch (e) {}
}

function exitPlugin() {
  setTimeout(function () {
    try { window.ztools && window.ztools.outPlugin && window.ztools.outPlugin() } catch (e) {}
  }, 50)
}

function fileToDataUrl(filePath) {
  return new Promise(function (resolve, reject) {
    const ext = path.extname(filePath).slice(1).toLowerCase()
    const mime = MIME_MAP[ext]
    if (!mime) {
      reject(new Error('不支持的图片格式: ' + ext))
      return
    }
    fs.readFile(filePath, function (err, data) {
      if (err) reject(err)
      else resolve('data:' + mime + ';base64,' + data.toString('base64'))
    })
  })
}

function readClipboardImageAsDataUrl() {
  try {
    const img = clipboard.readImage()
    if (!img || img.isEmpty()) return null
    return img.toDataURL()
  } catch (e) {
    return null
  }
}

function nowStamp() {
  const ts = new Date()
  const pad = function (n) { return String(n).padStart(2, '0') }
  return ts.getFullYear() + pad(ts.getMonth() + 1) + pad(ts.getDate()) +
    '_' + pad(ts.getHours()) + pad(ts.getMinutes()) + pad(ts.getSeconds())
}

// ===================== 保存（dataUrl / file） =====================

function saveDataUrlAs(dataUrl, suggestedName) {
  try {
    if (!dataUrl) {
      notify('没有可保存的图片')
      return null
    }
    const downloads = (window.ztools && window.ztools.getPath) ? window.ztools.getPath('downloads') : ''
    const baseName = suggestedName || ('clipboard_' + nowStamp() + '.png')
    const defaultPath = downloads ? path.join(downloads, baseName) : baseName

    const savePath = window.ztools.showSaveDialog({
      title: '保存剪贴板图片',
      defaultPath: defaultPath,
      buttonLabel: '保存',
      filters: [
        { name: 'PNG 图片', extensions: ['png'] }
      ]
    })
    if (!savePath) return null

    const comma = dataUrl.indexOf(',')
    const base64 = comma >= 0 ? dataUrl.slice(comma + 1) : dataUrl
    const buf = Buffer.from(base64, 'base64')
    fs.writeFileSync(savePath, buf)
    notify('已保存到 ' + savePath)
    return savePath
  } catch (e) {
    notify('保存失败: ' + (e && e.message ? e.message : e))
    return null
  }
}

function saveFileAs(srcPath) {
  try {
    if (!srcPath || !fs.existsSync(srcPath)) {
      notify('源文件不存在')
      return null
    }
    const base = path.basename(srcPath)
    const dot = base.lastIndexOf('.')
    const stem = dot > 0 ? base.slice(0, dot) : base
    const ext = dot > 0 ? base.slice(dot) : '.png'
    const downloads = (window.ztools && window.ztools.getPath) ? window.ztools.getPath('downloads') : ''
    const defaultPath = downloads ? path.join(downloads, stem + '_copy' + ext) : (stem + '_copy' + ext)

    const savePath = window.ztools.showSaveDialog({
      title: '另存图片',
      defaultPath: defaultPath,
      buttonLabel: '保存',
      filters: [
        { name: '图片文件', extensions: ['png', 'jpg', 'jpeg', 'gif', 'bmp', 'webp'] }
      ]
    })
    if (!savePath) return null

    fs.copyFileSync(srcPath, savePath)
    notify('已保存到 ' + savePath)
    return savePath
  } catch (e) {
    notify('保存失败: ' + (e && e.message ? e.message : e))
    return null
  }
}

// ===================== 创建悬浮窗 =====================

function openFloater(dataUrl, sourcePath) {
  if (!dataUrl) {
    notify('未在剪贴板或参数中检测到图片')
    return
  }

  const probe = new Image()
  probe.onload = function () {
    const isMac = !!(window.ztools && window.ztools.isMacOs && window.ztools.isMacOs())
    let pxW = probe.naturalWidth / (isMac ? 2 : 1)
    let pxH = probe.naturalHeight / (isMac ? 2 : 1)

    try {
      const display = window.ztools.getDisplayNearestPoint(window.ztools.getCursorScreenPoint())
      if (display && display.size) {
        const maxW = display.size.width * 0.8
        const maxH = display.size.height * 0.8
        const scale = Math.min(maxW / pxW, maxH / pxH, 1)
        pxW *= scale
        pxH *= scale
      }
    } catch (e) {}

    const TOOLBAR_HEIGHT = 56
    const winW = Math.max(420, Math.round(pxW))
    const winH = Math.max(180, Math.round(pxH + TOOLBAR_HEIGHT))

    let x = null, y = null
    try {
      const cursor = window.ztools.getCursorScreenPoint()
      const display = window.ztools.getDisplayNearestPoint(cursor)
      if (display && display.bounds) {
        x = Math.round(display.bounds.x + (display.bounds.width - winW) / 2)
        y = Math.round(display.bounds.y + (display.bounds.height - winH) / 2)
      }
    } catch (e) {}

    const key = uuid()
    // 优先用 localStorage 跨页传递；如果图片过大触发 QuotaExceededError，
    // 自动回退到把图片写到系统临时文件，floater 通过 _imgFile 路径再读回来
    let usedFile = ''
    try {
      localStorage.setItem(key + '_img', dataUrl)
    } catch (e) {
      try { localStorage.removeItem(key + '_img') } catch (_) {}
      try {
        const tmpPath = path.join(os.tmpdir(), 'ztools-clipboard-paintbrush-' + key + '.png')
        const comma = dataUrl.indexOf(',')
        const base64 = comma >= 0 ? dataUrl.slice(comma + 1) : dataUrl
        fs.writeFileSync(tmpPath, Buffer.from(base64, 'base64'))
        usedFile = tmpPath
        localStorage.setItem(key + '_imgFile', tmpPath)
      } catch (e2) {
        notify('图片过大且写入临时文件失败：' + (e2 && e2.message ? e2.message : e2))
        return
      }
    }
    localStorage.setItem(key + '_src', sourcePath || '')

    const win = window.ztools.createBrowserWindow(
      'floater.html#' + key,
      {
        title: '剪贴板图片涂改',
        x: x,
        y: y,
        width: winW,
        height: winH,
        useContentSize: true,
        skipTaskbar: true,
        minimizable: false,
        maximizable: false,
        fullscreenable: false,
        transparent: true,
        backgroundColor: '#00000000',
        frame: false,
        alwaysOnTop: true,
        hasShadow: false,
        resizable: true,
        webPreferences: {
          preload: 'floater-preload.js',
          devTools: true,
          nodeIntegration: false,
          contextIsolation: false
        }
      },
      function () {
        try {
          const wid = win.webContents.id
          for (let i = 0; i < 5; i++) {
            setTimeout(function () {
              try { ipcRenderer.sendTo(wid, 'init', { winId: wid }) } catch (e) {}
            }, i * 150)
          }
        } catch (e) {}
      }
    )

    ipcRenderer.on('floater:move', function (event, data) {
      try {
        if (!win) return
        const b = win.getBounds()
        win.setBounds({
          x: Math.round(b.x + (data.dx || 0)),
          y: Math.round(b.y + (data.dy || 0)),
          width: b.width,
          height: b.height
        })
      } catch (e) {}
    })

    ipcRenderer.on('floater:setOpacity', function (event, data) {
      try {
        if (!win) return
        const cur = win.getOpacity()
        win.setOpacity(Math.max(0.1, Math.min(1, cur + (data.delta || 0))))
      } catch (e) {}
    })

    ipcRenderer.on('floater:resize', function (event, data) {
      try {
        if (!win) return
        const b = win.getBounds()
        win.setBounds({
          x: data.x != null ? Math.round(data.x) : b.x,
          y: data.y != null ? Math.round(data.y) : b.y,
          width: data.width != null ? Math.max(420, Math.round(data.width)) : b.width,
          height: data.height != null ? Math.max(180, Math.round(data.height)) : b.height
        })
      } catch (e) {}
    })

    ipcRenderer.on('floater:close', function () {
      try { win && win.close() } catch (e) {}
    })
  }

  probe.onerror = function () {
    notify('无法解析图片数据')
  }
  probe.src = dataUrl
}

// ===================== feature exports =====================

window.exports = {
  // ----- 文本指令：剪贴板 -----
  'annotate-clipboard': {
    mode: 'none',
    args: {
      enter: function () {
        try { window.ztools.hideMainWindow() } catch (e) {}
        const dataUrl = readClipboardImageAsDataUrl()
        if (!dataUrl) {
          notify('剪贴板中没有图片，请先复制一张图片或截图后再触发')
        } else {
          openFloater(dataUrl)
        }
        exitPlugin()
      }
    }
  },

  'save-clipboard': {
    mode: 'none',
    args: {
      enter: function () {
        try { window.ztools.hideMainWindow() } catch (e) {}
        const dataUrl = readClipboardImageAsDataUrl()
        if (!dataUrl) {
          notify('剪贴板中没有图片，请先复制一张图片或截图后再触发')
        } else {
          saveDataUrlAs(dataUrl)
        }
        exitPlugin()
      }
    }
  },

  // ----- 粘贴图片到搜索框 -----
  'annotate-img': {
    mode: 'none',
    args: {
      enter: function (action) {
        try { window.ztools.hideMainWindow() } catch (e) {}
        openFloater(action && action.payload)
        exitPlugin()
      }
    }
  },

  'save-img': {
    mode: 'none',
    args: {
      enter: function (action) {
        try { window.ztools.hideMainWindow() } catch (e) {}
        const data = action && action.payload
        if (!data) {
          notify('没有可用图片')
        } else {
          saveDataUrlAs(data)
        }
        exitPlugin()
      }
    }
  },

  // ----- 粘贴图片文件到搜索框 -----
  'annotate-files': {
    mode: 'none',
    args: {
      enter: function (action) {
        try { window.ztools.hideMainWindow() } catch (e) {}
        const payload = action && action.payload
        if (!payload || !payload.length) {
          notify('没有可用的图片文件')
          exitPlugin()
          return
        }
        const first = payload[0]
        const filePath = first && (first.path || first)
        fileToDataUrl(filePath)
          .then(function (dataUrl) { openFloater(dataUrl, filePath) })
          .catch(function (err) { notify(err && err.message ? err.message : String(err)) })
          .finally(exitPlugin)
      }
    }
  },

  'save-files': {
    mode: 'none',
    args: {
      enter: function (action) {
        try { window.ztools.hideMainWindow() } catch (e) {}
        const payload = action && action.payload
        if (!payload || !payload.length) {
          notify('没有可用的图片文件')
        } else {
          const first = payload[0]
          const filePath = first && (first.path || first)
          saveFileAs(filePath)
        }
        exitPlugin()
      }
    }
  },

  // ----- mainPush 入口（搜索框检测剪贴板图片） -----
  'clipboard-detect': {
    mode: 'none',
    args: {
      // 1. 用户搜索 -> 返回是否要展示我们的两个推送项
      mainPush: function (queryData) {
        const dataUrl = readClipboardImageAsDataUrl()
        if (!dataUrl) return []

        // 仅做简单的关键词约束：避免对所有搜索都强行插队
        // 但默认仍然展示（用户经常空 / 短查询时希望看到提示）
        const searchWord = (typeof queryData === 'string')
          ? queryData
          : ((queryData && (queryData.searchWord || queryData.payload)) || '')

        const sw = String(searchWord || '').trim()
        // 当查询很长且明显与图片无关时，隐藏推送，避免干扰
        if (sw.length > 12 && !/图|片|剪|clip|image|picture|paste|save|edit|paint/i.test(sw)) {
          return []
        }

        return [
          {
            icon: 'logo.png',
            text: '📝 涂改剪贴板里的图片',
            title: '📝 涂改剪贴板里的图片',
            description: '在悬浮窗中标注、画箭头、马赛克、加文字',
            _action: 'annotate'
          },
          {
            icon: 'logo.png',
            text: '💾 保存剪贴板里的图片到本地',
            title: '💾 保存剪贴板里的图片到本地',
            description: '直接保存为 PNG 文件',
            _action: 'save'
          }
        ]
      },

      // 2. 用户点了某条推送项 -> 直接处理（不进入插件 UI）
      enter: function (action) {
        try { window.ztools.hideMainWindow() } catch (e) {}
        const dataUrl = readClipboardImageAsDataUrl()
        if (!dataUrl) {
          notify('剪贴板里已经没有图片了')
          exitPlugin()
          return
        }
        const which = action && (action._action || (action.payload && action.payload._action))
        if (which === 'save') {
          saveDataUrlAs(dataUrl)
        } else {
          openFloater(dataUrl)
        }
        exitPlugin()
      }
    }
  }
}

// ===================== 全局 onMainPush =====================
// 兼容旧 API：有些 ZTools 版本通过 ztools.onMainPush 注册而非 feature.mainPush

if (window.ztools && typeof window.ztools.onMainPush === 'function') {
  try {
    window.ztools.onMainPush(
      function (queryData) {
        const dataUrl = readClipboardImageAsDataUrl()
        if (!dataUrl) return []

        const searchWord = (typeof queryData === 'string')
          ? queryData
          : ((queryData && (queryData.searchWord || queryData.payload)) || '')
        const sw = String(searchWord || '').trim()
        if (sw.length > 12 && !/图|片|剪|clip|image|picture|paste|save|edit|paint/i.test(sw)) {
          return []
        }

        return [
          {
            icon: 'logo.png',
            text: '📝 涂改剪贴板里的图片',
            title: '📝 涂改剪贴板里的图片',
            description: '在悬浮窗中标注、画箭头、马赛克、加文字',
            _action: 'annotate',
            _dataUrl: dataUrl
          },
          {
            icon: 'logo.png',
            text: '💾 保存剪贴板里的图片到本地',
            title: '💾 保存剪贴板里的图片到本地',
            description: '直接保存为 PNG 文件',
            _action: 'save',
            _dataUrl: dataUrl
          }
        ]
      },
      function (selectData) {
        try { window.ztools.hideMainWindow() } catch (e) {}
        const dataUrl = (selectData && selectData._dataUrl) || readClipboardImageAsDataUrl()
        if (!dataUrl) {
          notify('剪贴板里已经没有图片了')
          return false
        }
        if (selectData && selectData._action === 'save') {
          saveDataUrlAs(dataUrl)
        } else {
          openFloater(dataUrl)
        }
        return false // 不进入插件 UI
      }
    )
  } catch (e) { /* ignore */ }
}
