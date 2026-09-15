;(function initSingleLinePreload() {
  'use strict'

  const SNAPSHOT_KEY = 'weread_reader/singleLineSnapshot'
  const SETTINGS_KEY = 'weread_reader/singleLineSettings'
  const FONT_FAMILIES = new Set([
    'system-ui, sans-serif',
    '"Microsoft YaHei UI", "Microsoft YaHei", sans-serif',
    'SimSun, serif',
    'FangSong, serif',
    'SimHei, sans-serif',
    'Consolas, monospace',
  ])
  const DEFAULT_SETTINGS = Object.freeze({
    width: 880,
    backgroundColor: '#202124',
    backgroundOpacity: 0.88,
    textColor: '#e8eaed',
    textOpacity: 1,
    fontSize: 17,
    fontFamily: '"Microsoft YaHei UI", "Microsoft YaHei", sans-serif',
    fontWeight: 400,
    autoPlayDelay: 900,
  })

  let ipcRenderer = null
  try {
    ;({ ipcRenderer } = require('electron'))
  } catch (error) {}

  function ztoolsApi() {
    return window.ztools
  }

  function clampNumber(value, minimum, maximum, fallback, precision = 0) {
    const parsed = Number(value)
    if (!Number.isFinite(parsed)) return fallback
    const clamped = Math.min(maximum, Math.max(minimum, parsed))
    const factor = 10 ** precision
    return Math.round(clamped * factor) / factor
  }

  function normalizeColor(value, fallback) {
    return typeof value === 'string' && /^#[0-9a-f]{6}$/i.test(value) ? value.toLowerCase() : fallback
  }

  function normalizeSnapshot(rawSnapshot) {
    if (!rawSnapshot || typeof rawSnapshot !== 'object') return null

    const lines = (Array.isArray(rawSnapshot.lines) ? rawSnapshot.lines : [])
      .filter((line) => typeof line === 'string' && line.trim())
      .map((line) => line.replace(/\s+/g, ' ').trim().slice(0, 4000))
      .slice(0, 2000)
    if (!lines.length) return null

    return {
      title: typeof rawSnapshot.title === 'string' ? rawSnapshot.title.trim().slice(0, 120) : '微信读书',
      lines,
      initialLine: clampNumber(rawSnapshot.initialLine, 0, lines.length - 1, 0),
      pageKey: lines.join('\n'),
      mode: ['horizontal', 'vertical', 'dom'].includes(rawSnapshot.mode)
        ? rawSnapshot.mode
        : 'dom',
    }
  }

  function normalizeSettings(rawSettings) {
    const settings = rawSettings && typeof rawSettings === 'object' ? rawSettings : {}
    return {
      width: clampNumber(settings.width, 420, 1400, DEFAULT_SETTINGS.width),
      backgroundColor: normalizeColor(settings.backgroundColor, DEFAULT_SETTINGS.backgroundColor),
      backgroundOpacity: clampNumber(
        settings.backgroundOpacity,
        0.05,
        1,
        DEFAULT_SETTINGS.backgroundOpacity,
        2,
      ),
      textColor: normalizeColor(settings.textColor, DEFAULT_SETTINGS.textColor),
      textOpacity: clampNumber(settings.textOpacity, 0.1, 1, DEFAULT_SETTINGS.textOpacity, 2),
      fontSize: clampNumber(settings.fontSize, 12, 36, DEFAULT_SETTINGS.fontSize),
      fontFamily: FONT_FAMILIES.has(settings.fontFamily) ? settings.fontFamily : DEFAULT_SETTINGS.fontFamily,
      fontWeight: Number(settings.fontWeight) === 700 ? 700 : 400,
      autoPlayDelay: clampNumber(settings.autoPlayDelay, 250, 4000, DEFAULT_SETTINGS.autoPlayDelay),
    }
  }

  function getSnapshot() {
    try {
      return normalizeSnapshot(ztoolsApi().dbStorage.getItem(SNAPSHOT_KEY))
    } catch (error) {
      return null
    }
  }

  function getSettings() {
    try {
      return normalizeSettings(ztoolsApi().dbStorage.getItem(SETTINGS_KEY))
    } catch (error) {
      return normalizeSettings(null)
    }
  }

  function saveSettings(rawSettings) {
    const settings = normalizeSettings(rawSettings)
    try {
      ztoolsApi().dbStorage.setItem(SETTINGS_KEY, settings)
    } catch (error) {}
    return settings
  }

  async function pickScreenColor() {
    try {
      if (typeof ztoolsApi().screenColorPick !== 'function') return null
      let pickedColor = null
      await ztoolsApi().screenColorPick((result) => {
        if (typeof result?.hex === 'string' && /^#[0-9a-f]{6}$/i.test(result.hex)) {
          pickedColor = result.hex.toLowerCase()
        }
      })
      return pickedColor
    } catch (error) {
      return null
    }
  }

  function sendToParent(channel, payload) {
    try {
      ztoolsApi().sendToParent(channel, payload)
      return true
    } catch (error) {
      return false
    }
  }

  const bridge = Object.freeze({
    getSnapshot,
    getSettings,
    saveSettings,
    pickScreenColor,

    resizeWindow(width, expanded) {
      return sendToParent('weread:single-line:resize', { width, expanded: Boolean(expanded) })
    },

    hideWindow() {
      return sendToParent('weread:single-line:hide')
    },

    closeWindow() {
      return sendToParent('weread:single-line:close')
    },

    requestNextPage() {
      return sendToParent('weread:single-line:next')
    },

    requestPreviousPage() {
      return sendToParent('weread:single-line:previous')
    },

    selectBufferedPage(rawSnapshot) {
      const snapshot = normalizeSnapshot(rawSnapshot)
      return snapshot ? sendToParent('weread:single-line:select-page', snapshot) : false
    },
  })

  Object.defineProperty(window, 'singleLineBridge', {
    value: bridge,
    enumerable: false,
    configurable: false,
    writable: false,
  })

  if (ipcRenderer) {
    ipcRenderer.on('weread:single-line:snapshot', function receiveSnapshot(event, rawSnapshot) {
      const snapshot = normalizeSnapshot(rawSnapshot)
      if (!snapshot) return
      window.dispatchEvent(new CustomEvent('weread:single-line:snapshot', { detail: snapshot }))
    })

    ipcRenderer.on('weread:single-line:append', function appendSnapshot(event, rawSnapshot) {
      const snapshot = normalizeSnapshot(rawSnapshot)
      if (!snapshot) return
      window.dispatchEvent(new CustomEvent('weread:single-line:append', { detail: snapshot }))
    })

    ipcRenderer.on('weread:single-line:prepend', function prependSnapshot(event, rawSnapshot) {
      const snapshot = normalizeSnapshot(rawSnapshot)
      if (!snapshot) return
      window.dispatchEvent(new CustomEvent('weread:single-line:prepend', { detail: snapshot }))
    })

    ipcRenderer.on('weread:single-line:buffer-next', function bufferNextSnapshot(event, rawSnapshot) {
      const snapshot = normalizeSnapshot(rawSnapshot)
      if (!snapshot) return
      window.dispatchEvent(
        new CustomEvent('weread:single-line:buffer-next', { detail: snapshot }),
      )
    })

    ipcRenderer.on('weread:single-line:next-result', function finishNextRequest(event, result) {
      window.dispatchEvent(new CustomEvent('weread:single-line:next-result', { detail: result || {} }))
    })

    ipcRenderer.on('weread:single-line:pointer-state', function receivePointerState(event, state) {
      window.dispatchEvent(
        new CustomEvent('weread:single-line:pointer-state', {
          detail: { inside: Boolean(state?.inside) },
        }),
      )
    })
  }
})()
