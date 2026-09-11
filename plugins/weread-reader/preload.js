/**
 * ZTools 微信读书插件 preload。
 *
 * 阅读页直接运行在 ZTools 主窗口的插件内容区。远程微信读书仍位于
 * 隔离的持久化 webview 中，不能访问 Node.js、文件系统或 ZTools API。
 */
;(function initWereadPreload() {
  'use strict'

  const HOME_URL = 'https://weread.qq.com/'
  const STORAGE_KEY = 'weread_reader/lastReaderUrl'
  const SINGLE_LINE_SNAPSHOT_KEY = 'weread_reader/singleLineSnapshot'
  const SINGLE_LINE_SETTINGS_KEY = 'weread_reader/singleLineSettings'
  const SINGLE_LINE_COLLAPSED_HEIGHT = 68
  const SINGLE_LINE_EXPANDED_HEIGHT = 314
  const DEFAULT_CODE = 'weread'
  const VALID_CODES = new Set(['weread', 'weread_continue', 'weread_shelf'])

  let lastLaunchCode = DEFAULT_CODE
  let singleLineWindow = null
  let singleLineWasVisible = false
  let singleLinePointerTimer = null

  const ipcRenderer = electronIpcRenderer()

  function ztoolsApi() {
    return window.ztools
  }

  function normalizeWereadUrl(rawUrl) {
    if (typeof rawUrl !== 'string' || rawUrl.length > 4096) return null

    try {
      const url = new URL(rawUrl)
      if (url.protocol !== 'https:') return null
      if (url.hostname !== 'weread.qq.com') return null
      if (url.port || url.username || url.password) return null
      return url.href
    } catch (error) {
      return null
    }
  }

  function normalizeReaderUrl(rawUrl) {
    const allowedUrl = normalizeWereadUrl(rawUrl)
    if (!allowedUrl) return null

    const url = new URL(allowedUrl)
    if (!/^\/web\/reader(?:\/|$)/.test(url.pathname)) return null
    return url.href
  }

  function getSavedReaderUrl() {
    try {
      const saved = ztoolsApi().dbStorage.getItem(STORAGE_KEY)
      const normalized = normalizeReaderUrl(saved)
      if (!normalized && saved) ztoolsApi().dbStorage.removeItem(STORAGE_KEY)
      return normalized
    } catch (error) {
      console.warn('[WeRead] 读取续读地址失败:', error)
      return null
    }
  }

  function saveReaderUrl(rawUrl) {
    const normalized = normalizeReaderUrl(rawUrl)
    if (!normalized) return false

    try {
      ztoolsApi().dbStorage.setItem(STORAGE_KEY, normalized)
      return true
    } catch (error) {
      console.warn('[WeRead] 保存续读地址失败:', error)
      return false
    }
  }

  function getAvailableScreenHeight() {
    try {
      const cursor = ztoolsApi().getCursorScreenPoint()
      const display = ztoolsApi().getDisplayNearestPoint(cursor)
      return (
        display?.workAreaSize?.height ||
        display?.workArea?.height ||
        display?.size?.height ||
        display?.bounds?.height ||
        920
      )
    } catch (error) {
      return 920
    }
  }

  function fitPanelHeight() {
    try {
      const height = Math.max(520, Math.min(620, getAvailableScreenHeight() - 180))
      ztoolsApi().setExpendHeight(height)
    } catch (error) {
      console.warn('[WeRead] 调整主面板高度失败:', error)
    }
  }

  function isDarkColors() {
    try {
      return Boolean(ztoolsApi().isDarkColors())
    } catch (error) {
      return window.matchMedia?.('(prefers-color-scheme: dark)').matches || false
    }
  }

  function electronIpcRenderer() {
    try {
      if (typeof require !== 'function') return null
      return require('electron')?.ipcRenderer || null
    } catch (error) {
      return null
    }
  }

  async function setHostTheme(rawTheme) {
    const theme = rawTheme === 'dark' ? 'dark' : rawTheme === 'light' ? 'light' : null
    const result = { applied: false, persisted: false }
    if (!theme) return result

    const ipcRenderer = electronIpcRenderer()
    if (!ipcRenderer || typeof ipcRenderer.invoke !== 'function') return result

    try {
      await ipcRenderer.invoke('set-theme', theme)
      result.applied = true
    } catch (error) {
      console.warn('[WeRead] 同步 ZTools 主题失败:', error)
      return result
    }

    try {
      const savedSettings = await ipcRenderer.invoke('ztools:db-get', 'settings-general')
      const nextSettings =
        savedSettings && typeof savedSettings === 'object' && !Array.isArray(savedSettings)
          ? { ...savedSettings, theme }
          : { theme }
      await ipcRenderer.invoke('ztools:db-put', 'settings-general', nextSettings)
      result.persisted = true
    } catch (error) {
      console.warn('[WeRead] 保存 ZTools 主题设置失败:', error)
    }

    return result
  }

  function clampNumber(value, minimum, maximum, fallback) {
    const parsed = Number(value)
    if (!Number.isFinite(parsed)) return fallback
    return Math.min(maximum, Math.max(minimum, Math.round(parsed)))
  }

  function normalizeSingleLineSnapshot(rawSnapshot) {
    if (!rawSnapshot || typeof rawSnapshot !== 'object') return null

    const lines = []
    let totalLength = 0
    for (const rawLine of Array.isArray(rawSnapshot.lines) ? rawSnapshot.lines : []) {
      if (typeof rawLine !== 'string') continue
      const line = rawLine.replace(/\s+/g, ' ').trim().slice(0, 4000)
      if (!line || line === lines[lines.length - 1]) continue
      if (totalLength + line.length > 120000) break
      lines.push(line)
      totalLength += line.length
      if (lines.length >= 2000) break
    }

    if (!lines.length) return null

    return {
      title: typeof rawSnapshot.title === 'string' ? rawSnapshot.title.trim().slice(0, 120) : '微信读书',
      readerUrl: normalizeReaderUrl(rawSnapshot.readerUrl),
      lines,
      initialLine: clampNumber(rawSnapshot.initialLine, 0, lines.length - 1, 0),
      pageKey: lines.join('\n'),
      mode: ['horizontal', 'vertical', 'dom'].includes(rawSnapshot.mode)
        ? rawSnapshot.mode
        : 'dom',
    }
  }

  function getSingleLineWidth() {
    try {
      const settings = ztoolsApi().dbStorage.getItem(SINGLE_LINE_SETTINGS_KEY)
      return clampNumber(settings?.width, 420, 1400, 880)
    } catch (error) {
      return 880
    }
  }

  function hasSingleLineWindow() {
    try {
      return Boolean(singleLineWindow && !singleLineWindow.isDestroyed())
    } catch (error) {
      return false
    }
  }

  function stopSingleLinePointerTracking() {
    if (singleLinePointerTimer) window.clearInterval(singleLinePointerTimer)
    singleLinePointerTimer = null
  }

  function sendSingleLinePointerState() {
    if (!hasSingleLineWindow()) {
      stopSingleLinePointerTracking()
      return
    }

    try {
      const cursor = ztoolsApi().getCursorScreenPoint()
      const bounds = singleLineWindow.getBounds()
      const inside =
        cursor.x >= bounds.x &&
        cursor.x < bounds.x + bounds.width &&
        cursor.y >= bounds.y &&
        cursor.y < bounds.y + bounds.height
      singleLineWindow.webContents.send('weread:single-line:pointer-state', { inside })
    } catch (error) {}
  }

  function startSingleLinePointerTracking() {
    stopSingleLinePointerTracking()
    sendSingleLinePointerState()
    singleLinePointerTimer = window.setInterval(sendSingleLinePointerState, 80)
  }

  function getSingleLineWindowPosition(width, height) {
    const cursor = ztoolsApi().getCursorScreenPoint()
    const display = ztoolsApi().getDisplayNearestPoint(cursor)
    const workArea = display?.workArea || display?.bounds || { x: 0, y: 0, width, height }
    const maxX = workArea.x + Math.max(0, workArea.width - width)
    const maxY = workArea.y + Math.max(0, workArea.height - height)

    return {
      x: Math.round(Math.min(maxX, Math.max(workArea.x, cursor.x - width / 2))),
      y: Math.round(Math.min(maxY, Math.max(workArea.y, cursor.y + 24))),
    }
  }

  function showSingleLineWindow() {
    if (!hasSingleLineWindow()) return false

    try {
      singleLineWindow.show()
      singleLineWindow.focus()
      singleLineWindow.setAlwaysOnTop(true)
      startSingleLinePointerTracking()
      return true
    } catch (error) {
      stopSingleLinePointerTracking()
      return false
    }
  }

  function resizeSingleLineWindow(rawSize) {
    if (!hasSingleLineWindow() || !rawSize || typeof rawSize !== 'object') return

    const width = clampNumber(rawSize.width, 420, 1400, getSingleLineWidth())
    const height = rawSize.expanded ? SINGLE_LINE_EXPANDED_HEIGHT : SINGLE_LINE_COLLAPSED_HEIGHT

    try {
      const position = singleLineWindow.getPosition()
      const display = ztoolsApi().getDisplayNearestPoint({ x: position[0], y: position[1] })
      const workArea = display?.workArea || display?.bounds
      const maxX = workArea ? workArea.x + Math.max(0, workArea.width - width) : position[0]
      const maxY = workArea ? workArea.y + Math.max(0, workArea.height - height) : position[1]
      singleLineWindow.setBounds({
        x: Math.min(maxX, Math.max(workArea?.x ?? position[0], position[0])),
        y: Math.min(maxY, Math.max(workArea?.y ?? position[1], position[1])),
        width,
        height,
      })
    } catch (error) {
      try {
        singleLineWindow.setSize(width, height)
      } catch (resizeError) {}
    }
  }

  function openSingleLineReader(rawSnapshot) {
    const snapshot = normalizeSingleLineSnapshot(rawSnapshot)
    if (!snapshot) return { ok: false, reason: '当前章节没有可读取的正文。' }

    try {
      ztoolsApi().dbStorage.setItem(SINGLE_LINE_SNAPSHOT_KEY, snapshot)

      if (hasSingleLineWindow()) {
        singleLineWindow.webContents.send('weread:single-line:snapshot', snapshot)
        singleLineWasVisible = true
        showSingleLineWindow()
        return { ok: true, reused: true }
      }

      const width = getSingleLineWidth()
      const position = getSingleLineWindowPosition(width, SINGLE_LINE_COLLAPSED_HEIGHT)
      let createdWindow = null
      createdWindow = ztoolsApi().createBrowserWindow(
        'single-line.html',
        {
          show: false,
          title: '微信读书',
          x: position.x,
          y: position.y,
          width,
          height: SINGLE_LINE_COLLAPSED_HEIGHT,
          minWidth: 420,
          maxWidth: 1400,
          resizable: false,
          movable: true,
          closable: true,
          minimizable: false,
          maximizable: false,
          fullscreenable: false,
          frame: false,
          transparent: true,
          backgroundColor: '#00000000',
          alwaysOnTop: true,
          skipTaskbar: true,
          autoHideMenuBar: true,
          roundedCorners: false,
          hasShadow: false,
          webPreferences: {
            preload: 'single-line-preload.js',
          },
        },
        function onSingleLineWindowReady() {
          if (createdWindow !== singleLineWindow) return
          showSingleLineWindow()
          createdWindow.webContents.send('weread:single-line:snapshot', snapshot)
        },
      )

      if (!createdWindow) return { ok: false, reason: 'ZTools 没有成功创建单行阅读窗口。' }
      singleLineWindow = createdWindow
      singleLineWasVisible = true
      return { ok: true, reused: false }
    } catch (error) {
      console.warn('[WeRead] 创建单行阅读窗口失败:', error)
      singleLineWindow = null
      singleLineWasVisible = false
      return { ok: false, reason: '创建单行阅读窗口失败，请确认 ZTools 已更新到最新版本。' }
    }
  }

  function appendSingleLineReader(rawSnapshot) {
    const snapshot = normalizeSingleLineSnapshot(rawSnapshot)
    if (!snapshot || !hasSingleLineWindow()) return false

    try {
      ztoolsApi().dbStorage.setItem(SINGLE_LINE_SNAPSHOT_KEY, snapshot)
      singleLineWindow.webContents.send('weread:single-line:append', snapshot)
      return true
    } catch (error) {
      return false
    }
  }

  function prependSingleLineReader(rawSnapshot) {
    const snapshot = normalizeSingleLineSnapshot(rawSnapshot)
    if (!snapshot || !hasSingleLineWindow()) return false

    try {
      ztoolsApi().dbStorage.setItem(SINGLE_LINE_SNAPSHOT_KEY, snapshot)
      singleLineWindow.webContents.send('weread:single-line:prepend', snapshot)
      return true
    } catch (error) {
      return false
    }
  }

  function bufferNextSingleLineReader(rawSnapshot) {
    const snapshot = normalizeSingleLineSnapshot(rawSnapshot)
    if (!snapshot || !hasSingleLineWindow()) return false

    try {
      singleLineWindow.webContents.send('weread:single-line:buffer-next', snapshot)
      return true
    } catch (error) {
      return false
    }
  }

  function finishSingleLinePage(rawReason) {
    if (!hasSingleLineWindow()) return false

    try {
      const reason =
        typeof rawReason === 'string' ? rawReason.trim().slice(0, 120) : '已经读到当前内容末尾。'
      singleLineWindow.webContents.send('weread:single-line:next-result', { ok: false, reason })
      return true
    } catch (error) {
      return false
    }
  }

  if (ipcRenderer) {
    ipcRenderer.on('weread:single-line:resize', function onSingleLineResize(event, size) {
      resizeSingleLineWindow(size)
    })

    ipcRenderer.on('weread:single-line:hide', function onSingleLineHide() {
      if (!hasSingleLineWindow()) return
      singleLineWasVisible = false
      stopSingleLinePointerTracking()
      try {
        singleLineWindow.hide()
      } catch (error) {}
    })

    ipcRenderer.on('weread:single-line:close', function onSingleLineClose() {
      if (!hasSingleLineWindow()) return
      singleLineWasVisible = false
      stopSingleLinePointerTracking()
      window.dispatchEvent(new CustomEvent('weread:single-line:closed'))
      try {
        singleLineWindow.close()
      } catch (error) {}
      singleLineWindow = null
    })

    ipcRenderer.on('weread:single-line:next', function onSingleLineNext() {
      window.dispatchEvent(new CustomEvent('weread:single-line:next-request'))
    })

    ipcRenderer.on('weread:single-line:previous', function onSingleLinePrevious() {
      window.dispatchEvent(new CustomEvent('weread:single-line:previous-request'))
    })

    ipcRenderer.on('weread:single-line:select-page', function onSingleLineSelectPage(event, rawSnapshot) {
      const snapshot = normalizeSingleLineSnapshot(rawSnapshot)
      if (!snapshot) return
      try {
        ztoolsApi().dbStorage.setItem(SINGLE_LINE_SNAPSHOT_KEY, snapshot)
      } catch (error) {}
      window.dispatchEvent(
        new CustomEvent('weread:single-line:select-page', { detail: snapshot }),
      )
    })
  }

  function emitLaunchIntent(code) {
    window.dispatchEvent(
      new CustomEvent('weread:plugin-enter', {
        detail: { code },
      }),
    )
  }

  const bridge = Object.freeze({
    homeUrl: HOME_URL,
    isStandalone: false,
    launchesStandalone: false,

    getLaunchState() {
      return {
        code: lastLaunchCode,
        savedReaderUrl: getSavedReaderUrl(),
      }
    },

    getSavedReaderUrl,
    saveReaderUrl,
    normalizeWereadUrl,
    isDarkColors,
    setHostTheme,
    openSingleLineReader,
    appendSingleLineReader,
    prependSingleLineReader,
    bufferNextSingleLineReader,
    finishSingleLinePage,

    openInSystemBrowser(rawUrl) {
      const normalized = normalizeWereadUrl(rawUrl)
      if (!normalized) return false
      return Boolean(ztoolsApi().shellOpenExternal(normalized))
    },
  })

  Object.defineProperty(window, 'wereadBridge', {
    value: bridge,
    enumerable: false,
    configurable: false,
    writable: false,
  })

  ztoolsApi().onPluginEnter(function onPluginEnter(param) {
    const requestedCode = typeof param?.code === 'string' ? param.code : DEFAULT_CODE
    lastLaunchCode = VALID_CODES.has(requestedCode) ? requestedCode : DEFAULT_CODE
    fitPanelHeight()
    emitLaunchIntent(lastLaunchCode)
    if (singleLineWasVisible) showSingleLineWindow()
  })

  ztoolsApi().onPluginOut(function onPluginOut() {
    if (!hasSingleLineWindow()) return
    stopSingleLinePointerTracking()
    try {
      singleLineWasVisible = singleLineWindow.isVisible()
      singleLineWindow.hide()
    } catch (error) {}
  })

  window.addEventListener('DOMContentLoaded', fitPanelHeight, { once: true })
})()
