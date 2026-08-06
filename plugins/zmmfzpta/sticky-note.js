const { ipcRenderer } = require('electron')
const fs = require('node:fs')
const path = require('node:path')
const os = require('node:os')

let winId
let pendingBounds = null

// ===== 便签图片外置落盘（与主应用 preload 共用同一目录）=====
function stickyImagesDir() {
  let base
  try { base = ztools.getPath('userData') } catch (_) { base = os.tmpdir() }
  const dir = path.join(base, 'sticky-images')
  try { if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true }) } catch (_) {}
  return dir
}

window.getStickyImagesDir = function () { return stickyImagesDir() }

window.saveStickyImage = function (base64Data, mime) {
  try {
    const ext = mime === 'image/png' ? 'png' : mime === 'image/webp' ? 'webp' : 'jpg'
    const name = `${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}.${ext}`
    fs.writeFileSync(path.join(stickyImagesDir(), name), Buffer.from(base64Data, 'base64'))
    return { ok: true, filename: name }
  } catch (e) {
    return { ok: false, error: String(e) }
  }
}

window.readStickyImage = function (filename) {
  try {
    const f = path.join(stickyImagesDir(), filename)
    if (!fs.existsSync(f)) return null
    const buf = fs.readFileSync(f)
    const ext = path.extname(filename).slice(1).toLowerCase()
    const mime = ext === 'png' ? 'image/png'
      : ext === 'webp' ? 'image/webp'
      : ext === 'gif' ? 'image/gif'
      : 'image/jpeg'
    return `data:${mime};base64,${buf.toString('base64')}`
  } catch (_) {
    return null
  }
}

window.deleteStickyImage = function (filename) {
  try {
    const f = path.join(stickyImagesDir(), filename)
    if (fs.existsSync(f)) fs.unlinkSync(f)
    return true
  } catch (_) {
    return false
  }
}

window.listStickyImages = function () {
  try {
    const dir = stickyImagesDir()
    return fs.readdirSync(dir).filter(name => fs.statSync(path.join(dir, name)).isFile())
  } catch (_) {
    return []
  }
}

function noteIdFromPage() {
  try {
    return window.__stickyNoteId || new URLSearchParams(location.search).get('id') || null
  } catch (_) {
    return null
  }
}

/**
 * 用 Electron 主进程的 screen 模块获取浮窗所在屏的准确可用区域。
 * 渲染进程的 window.screen 在 Electron 下可能不准（总是返回主屏），
 * 所以必须走 preload 的 electron.screen 才能拿到正确的多屏信息。
 */
window.getNativeScreenInfo = function () {
  try {
    const electron = require('electron')
    const screen = electron.screen
    if (!screen || typeof screen.getDisplayMatching !== 'function') return null
    // window.screenX/screenY 是浮窗左上角的全局坐标，在 Electron 下准确
    const x = typeof window.screenX === 'number' ? window.screenX : 0
    const y = typeof window.screenY === 'number' ? window.screenY : 0
    const w = typeof window.outerWidth === 'number' ? window.outerWidth : 200
    const h = typeof window.outerHeight === 'number' ? window.outerHeight : 200
    const display = screen.getDisplayMatching({ x, y, width: w, height: h })
    if (!display || !display.workArea) return null
    return {
      availLeft: display.workArea.x,
      availTop: display.workArea.y,
      availWidth: display.workArea.width,
      availHeight: display.workArea.height,
    }
  } catch (_) {
    return null
  }
}

/** 与股票浮窗一致：优先 sendTo(父 webContents id) */
function sendParent(channel, ...args) {
  if (winId != null) {
    try {
      ipcRenderer.sendTo(winId, channel, ...args)
      return true
    } catch (err) {
      console.error('[sticky-note] sendTo failed', channel, err)
    }
  }
  try {
    if (typeof utools !== 'undefined' && typeof ztools.sendToParent === 'function') {
      ztools.sendToParent(channel, ...args)
      return true
    }
  } catch (err) {
    console.error('[sticky-note] sendToParent failed', channel, err)
  }
  return false
}

ipcRenderer.on('init', (event) => {
  winId = event.senderId
  if (pendingBounds != null) {
    sendParent('stickySetBounds', pendingBounds)
    sendParent('moveBounds', 0, 0, pendingBounds.width, pendingBounds.height)
    pendingBounds = null
  }
})

window.dbPut = function (key, value) {
  ztools.dbStorage.setItem(key, value)
}

window.dbGet = function (key) {
  return ztools.dbStorage.getItem(key)
}

window.moveBounds = (x, y, width, height) => {
  sendParent('moveBounds', x, y, width, height)
}

window.notifyStickyClosed = (noteId, payload) => {
  sendParent('stickyClosed', noteId || noteIdFromPage(), payload || null)
}

window.notifyStickySaved = (noteId, payload) => {
  sendParent('stickySaved', noteId || noteIdFromPage(), payload || null)
}

window.notifyStickyEditState = (noteId, editing) => {
  sendParent('stickyEditState', noteId || noteIdFromPage(), {
    editing: !!editing,
    at: Date.now(),
  })
}

window.notifyStickyDeleted = (noteId) => {
  sendParent('stickyDeleted', noteId || noteIdFromPage())
}

// 主应用 → 浮窗：推送更新（事件驱动，替代高频轮询）
ipcRenderer.on('stickyPushUpdate', (_event, noteId, patch) => {
  const id = noteId || noteIdFromPage()
  if (!id) return
  if (typeof window.__applyStickyPush === 'function') {
    window.__applyStickyPush(patch)
  }
})

window.setStickyBounds = (bounds) => {
  const payload = {
    ...(bounds || {}),
    noteId: (bounds && bounds.noteId) || noteIdFromPage(),
  }
  if (winId == null) pendingBounds = payload
  sendParent('stickySetBounds', payload)
  if (payload.width != null || payload.height != null) {
    sendParent('moveBounds', 0, 0, payload.width, payload.height)
  }
}
