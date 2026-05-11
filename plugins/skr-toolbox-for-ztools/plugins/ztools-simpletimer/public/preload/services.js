const runningTimers = []
const TIMER_SIZE_DB_ID = 'timer_window_size'
const TIMER_SIZE_VERSION = 4
const DEFAULT_SIZE = {
  width: 200,
  height: 139
}
const MIN_SIZE = {
  width: 200,
  height: 139
}
const MAX_SIZE = {
  width: 336,
  height: 234
}
const ASPECT_RATIO = DEFAULT_SIZE.width / DEFAULT_SIZE.height

let lastLaunch = {
  mode: '',
  time: 0
}

function normalizeMode(mode) {
  return mode === 'countdown' || mode === '倒计时' ? 'countdown' : 'stopwatch'
}

function getTimerUrl(mode) {
  const timerMode = normalizeMode(mode)
  const size = readSavedWindowSize()
  return `timer.html?mode=${timerMode}&w=${size.width}&h=${size.height}`
}

function pruneClosedWindows() {
  for (let i = runningTimers.length - 1; i >= 0; i -= 1) {
    const item = runningTimers[i]
    if (!item.win || item.win.isDestroyed?.()) {
      runningTimers.splice(i, 1)
    }
  }
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value))
}

function normalizeWindowSize(size) {
  const rawWidth = Number(size && size.width) || DEFAULT_SIZE.width
  const width = clamp(rawWidth, MIN_SIZE.width, MAX_SIZE.width)

  return {
    width: Math.round(width),
    height: Math.round(width / ASPECT_RATIO)
  }
}

function readSavedWindowSize() {
  try {
    const doc = window.ztools.db.get(TIMER_SIZE_DB_ID)
    if (doc && doc.version === TIMER_SIZE_VERSION) {
      return normalizeWindowSize(doc)
    }
  } catch (err) {}

  return { ...DEFAULT_SIZE }
}

function saveWindowSize(size) {
  const normalized = normalizeWindowSize(size)

  try {
    const existing = window.ztools.db.get(TIMER_SIZE_DB_ID)
    if (existing) window.ztools.db.remove(existing)

    window.ztools.db.put({
      _id: TIMER_SIZE_DB_ID,
      version: TIMER_SIZE_VERSION,
      width: normalized.width,
      height: normalized.height,
      timestamp: Date.now()
    })
  } catch (err) {
    console.error('保存窗口尺寸失败:', err)
  }
}

function saveWindowInstanceSize(win) {
  try {
    const bounds = win.getBounds?.()
    if (bounds && bounds.width) {
      saveWindowSize(bounds)
      return
    }

    const size = win.getSize?.()
    if (Array.isArray(size)) {
      saveWindowSize({ width: size[0], height: size[1] })
    }
  } catch (err) {}
}

function createTimerWindow(mode) {
  const timerMode = normalizeMode(mode)
  const now = Date.now()

  if (lastLaunch.mode === timerMode && now - lastLaunch.time < 800) {
    return null
  }

  lastLaunch = {
    mode: timerMode,
    time: now
  }

  pruneClosedWindows()
  const size = readSavedWindowSize()

  let win = null

  try {
    win = window.ztools.createBrowserWindow(getTimerUrl(timerMode), {
      width: size.width,
      height: size.height,
      frame: false,
      transparent: true,
      alwayOnTop: true,
      alwaysOnTop: true,
      skipTaskbar: true,
      resizable: true,
      hasShadow: false,
      backgroundColor: '#00000000',
      minWidth: MIN_SIZE.width,
      minHeight: MIN_SIZE.height,
      maxWidth: MAX_SIZE.width,
      maxHeight: MAX_SIZE.height,
      webPreferences: {
        nodeIntegration: true,
        contextIsolation: false,
        zoomFactor: 1
      }
    })
  } catch (err) {
    console.error('创建计时器窗口失败:', err)
  }

  if (!win) {
    return null
  }

  win.show?.()

  try {
    win.setAlwaysOnTop?.(true)
    win.setMinimumSize?.(MIN_SIZE.width, MIN_SIZE.height)
    win.setMaximumSize?.(MAX_SIZE.width, MAX_SIZE.height)
    win.setAspectRatio?.(ASPECT_RATIO)
  } catch (err) {
    console.error('设置窗口属性失败:', err)
  }

  let sizeSaveTimer = null
  const scheduleSizeSave = () => {
    if (sizeSaveTimer) clearTimeout(sizeSaveTimer)
    sizeSaveTimer = setTimeout(() => saveWindowInstanceSize(win), 300)
  }

  try {
    win.on?.('resize', scheduleSizeSave)
    win.on?.('resized', scheduleSizeSave)
    win.on?.('move', scheduleSizeSave)
    win.on?.('close', () => saveWindowInstanceSize(win))
  } catch (err) {}

  runningTimers.push({
    id: now,
    mode: timerMode,
    win
  })

  global.timerWindows = global.timerWindows || []
  global.timerWindows.push(win)

  return win
}

function openTimer(mode) {
  const win = createTimerWindow(mode)

  setTimeout(() => {
    try {
      window.ztools.hideMainWindow()
      window.ztools.outPlugin(false)
    } catch (err) {
      console.error('隐藏主窗口失败:', err)
    }
  }, 300)

  return win
}

window.timerAPI = {
  createFloatingWindow: createTimerWindow,
  hideMainWindow() {
    return window.ztools.hideMainWindow()
  },
  openTimer,
  showNotification(title, body) {
    if (window.ztools.showNotification) {
      window.ztools.showNotification(body || title, title)
      return
    }

    new Notification(title, { body })
  }
}

window.ztools.onPluginEnter((action) => {
  if (action.code === 'stopwatch' || action.code === '正计时') {
    openTimer('stopwatch')
  }

  if (action.code === 'countdown' || action.code === '倒计时') {
    openTimer('countdown')
  }
})
