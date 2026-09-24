;(function initSingleLineReader() {
  'use strict'

  const bridge = window.singleLineBridge
  const root = document.documentElement
  const readerBar = document.getElementById('readerBar')
  const lineText = document.getElementById('lineText')
  const lineProgress = document.getElementById('lineProgress')
  const autoPlayButton = document.getElementById('autoPlayButton')
  const settingsButton = document.getElementById('settingsButton')
  const settingsPanel = document.getElementById('settingsPanel')
  const widthInput = document.getElementById('widthInput')
  const widthOutput = document.getElementById('widthOutput')
  const backgroundColorInput = document.getElementById('backgroundColorInput')
  const backgroundScreenPickButton = document.getElementById('backgroundScreenPickButton')
  const backgroundOpacityInput = document.getElementById('backgroundOpacityInput')
  const textColorInput = document.getElementById('textColorInput')
  const textScreenPickButton = document.getElementById('textScreenPickButton')
  const textOpacityInput = document.getElementById('textOpacityInput')
  const fontFamilyInput = document.getElementById('fontFamilyInput')
  const fontSizeInput = document.getElementById('fontSizeInput')
  const fontWeightInput = document.getElementById('fontWeightInput')
  const autoPlayDelayInput = document.getElementById('autoPlayDelayInput')

  let snapshot = bridge.getSnapshot()
  let bufferedPages = snapshot ? [snapshot] : []
  let bufferedPageIndex = 0
  let settings = bridge.getSettings()
  let lineIndex = snapshot?.initialLine || 0
  let characterOffset = 0
  let settingsOpen = false
  let autoPlayTimer = null
  let wheelDelta = 0
  let nextPagePending = false
  let previousPagePending = false
  let autoHideTimer = null
  let pointerInsideWindow = null

  function hexToRgba(hex, alpha) {
    const value = Number.parseInt(hex.slice(1), 16)
    const red = (value >> 16) & 255
    const green = (value >> 8) & 255
    const blue = value & 255
    return `rgba(${red}, ${green}, ${blue}, ${alpha})`
  }

  function syncSettingsControls() {
    widthInput.value = String(settings.width)
    widthOutput.value = `${settings.width}px`
    backgroundColorInput.value = settings.backgroundColor
    backgroundOpacityInput.value = String(settings.backgroundOpacity)
    textColorInput.value = settings.textColor
    textOpacityInput.value = String(settings.textOpacity)
    fontFamilyInput.value = settings.fontFamily
    fontSizeInput.value = String(settings.fontSize)
    fontWeightInput.value = String(settings.fontWeight)
    autoPlayDelayInput.value = String(settings.autoPlayDelay)

    backgroundOpacityInput.title = `${Math.round(settings.backgroundOpacity * 100)}%`
    textOpacityInput.title = `${Math.round(settings.textOpacity * 100)}%`
    fontSizeInput.title = `${settings.fontSize}px`
    autoPlayDelayInput.title = `${settings.autoPlayDelay}ms`
  }

  function applySettings() {
    root.style.setProperty(
      '--reader-background',
      hexToRgba(settings.backgroundColor, settings.backgroundOpacity),
    )
    root.style.setProperty('--reader-text', hexToRgba(settings.textColor, settings.textOpacity))
    root.style.setProperty('--reader-font-family', settings.fontFamily)
    root.style.setProperty('--reader-font-size', `${settings.fontSize}px`)
    root.style.setProperty('--reader-font-weight', String(settings.fontWeight))
    syncSettingsControls()
    bridge.resizeWindow(settings.width, settingsOpen)
  }

  function saveSettingsFromControls() {
    settings = bridge.saveSettings({
      width: widthInput.value,
      backgroundColor: backgroundColorInput.value,
      backgroundOpacity: backgroundOpacityInput.value,
      textColor: textColorInput.value,
      textOpacity: textOpacityInput.value,
      fontFamily: fontFamilyInput.value,
      fontSize: fontSizeInput.value,
      fontWeight: fontWeightInput.value,
      autoPlayDelay: autoPlayDelayInput.value,
    })
    applySettings()
    if (autoPlayTimer) startAutoPlay()
  }

  async function pickScreenColor(input, button) {
    const label = button.textContent
    button.disabled = true
    button.textContent = '…'
    try {
      const color = await bridge.pickScreenColor()
      if (!color) return
      input.value = color
      saveSettingsFromControls()
    } finally {
      button.disabled = false
      button.textContent = label
    }
  }

  function currentLine() {
    return snapshot?.lines?.[lineIndex] || ''
  }

  function renderProgress(status = '') {
    const parts = []
    if (snapshot?.lines?.length > 1) parts.push(`${lineIndex + 1}/${snapshot.lines.length}`)
    const prefetchedPages = Math.max(0, bufferedPages.length - bufferedPageIndex - 1)
    if (prefetchedPages > 0) {
      const unit = snapshot?.mode === 'vertical' ? '章' : '页'
      parts.push(`已预载 ${prefetchedPages} ${unit}`)
    }
    if (status) parts.push(status)
    lineProgress.textContent = parts.join(' · ')
  }

  function renderLine() {
    if (!snapshot?.lines?.length) {
      lineText.textContent = '没有读取到正文，请返回阅读页后重新打开单行阅读。'
      lineProgress.textContent = ''
      return
    }

    const line = currentLine()
    characterOffset = Math.min(Math.max(0, characterOffset), Math.max(0, line.length - 1))
    lineText.textContent = line.slice(characterOffset) || '　'
    lineText.title = line
    renderProgress()
    document.title = snapshot.title || '微信读书'
  }

  function switchBufferedPage(direction) {
    const nextIndex = bufferedPageIndex + (direction === 'previous' ? -1 : 1)
    if (nextIndex < 0 || nextIndex >= bufferedPages.length) return false

    bufferedPageIndex = nextIndex
    snapshot = bufferedPages[bufferedPageIndex]
    lineIndex = direction === 'previous' ? Math.max(0, snapshot.lines.length - 1) : 0
    characterOffset =
      direction === 'previous' ? Math.max(0, currentLine().length - 1) : 0
    nextPagePending = false
    previousPagePending = false
    bridge.selectBufferedPage(snapshot)
    renderLine()
    return true
  }

  function moveToLine(nextIndex) {
    if (!snapshot?.lines?.length) return false
    if (nextIndex >= snapshot.lines.length && lineIndex === snapshot.lines.length - 1) {
      if (switchBufferedPage('next')) return true
      return requestNextPage()
    }
    if (nextIndex < 0 && lineIndex === 0) {
      if (switchBufferedPage('previous')) return true
      return requestPreviousPage()
    }
    const clampedIndex = Math.min(snapshot.lines.length - 1, Math.max(0, nextIndex))
    if (clampedIndex === lineIndex && characterOffset === 0) return false
    lineIndex = clampedIndex
    characterOffset = 0
    renderLine()
    return true
  }

  function requestNextPage() {
    if (nextPagePending) return true
    nextPagePending = bridge.requestNextPage()
    if (nextPagePending) renderProgress('加载中')
    return nextPagePending
  }

  function requestPreviousPage() {
    if (previousPagePending) return true
    previousPagePending = bridge.requestPreviousPage()
    if (previousPagePending) renderProgress('加载中')
    return previousPagePending
  }

  function moveNextCharacter() {
    const line = currentLine()
    if (!line) return false
    if (characterOffset < line.length - 1) {
      characterOffset += 1
      renderLine()
      return true
    }
    if (lineIndex < snapshot.lines.length - 1) return moveToLine(lineIndex + 1)
    if (switchBufferedPage('next')) return true
    return requestNextPage()
  }

  function movePreviousCharacter() {
    if (!snapshot?.lines?.length) return false
    if (characterOffset > 0) {
      characterOffset -= 1
      renderLine()
      return true
    }
    if (lineIndex === 0) {
      if (switchBufferedPage('previous')) return true
      return requestPreviousPage()
    }
    lineIndex -= 1
    characterOffset = Math.max(0, currentLine().length - 1)
    renderLine()
    return true
  }

  function stopAutoPlay() {
    if (autoPlayTimer) window.clearInterval(autoPlayTimer)
    autoPlayTimer = null
    autoPlayButton.textContent = '▶'
    autoPlayButton.setAttribute('aria-pressed', 'false')
    autoPlayButton.title = '自动滚动（空格）'
  }

  function startAutoPlay() {
    stopAutoPlay()
    autoPlayTimer = window.setInterval(function advanceAutomatically() {
      if (!moveNextCharacter()) stopAutoPlay()
    }, settings.autoPlayDelay)
    autoPlayButton.textContent = 'Ⅱ'
    autoPlayButton.setAttribute('aria-pressed', 'true')
    autoPlayButton.title = '暂停自动滚动（空格）'
  }

  function toggleAutoPlay() {
    if (autoPlayTimer) stopAutoPlay()
    else startAutoPlay()
  }

  function setSettingsOpen(isOpen) {
    settingsOpen = Boolean(isOpen)
    settingsPanel.hidden = !settingsOpen
    document.body.classList.toggle('settings-open', settingsOpen)
    settingsButton.setAttribute('aria-expanded', String(settingsOpen))
    settingsButton.title = settingsOpen ? '收起阅读设置' : '阅读设置'
    bridge.resizeWindow(settings.width, settingsOpen)
  }

  function cancelAutoHide() {
    if (autoHideTimer) window.clearTimeout(autoHideTimer)
    autoHideTimer = null
  }

  function scheduleAutoHide() {
    cancelAutoHide()
    autoHideTimer = window.setTimeout(function hideAfterPointerLeave() {
      autoHideTimer = null
      readerBar.classList.add('is-auto-hidden')
    }, 250)
  }

  window.addEventListener('weread:single-line:pointer-state', function handlePointerState(event) {
    const isInside = Boolean(event.detail?.inside)
    if (isInside === pointerInsideWindow) return
    pointerInsideWindow = isInside

    if (isInside) {
      cancelAutoHide()
      readerBar.classList.remove('is-auto-hidden')
    } else {
      scheduleAutoHide()
    }
  })

  readerBar.addEventListener(
    'wheel',
    function moveFromWheel(event) {
      event.preventDefault()
      wheelDelta += Math.abs(event.deltaY) >= Math.abs(event.deltaX) ? event.deltaY : event.deltaX
      if (Math.abs(wheelDelta) < 18) return

      const direction = wheelDelta > 0 ? 1 : -1
      const steps = Math.min(5, Math.max(1, Math.floor(Math.abs(wheelDelta) / 48)))
      wheelDelta = 0
      for (let index = 0; index < steps; index += 1) {
        if (direction > 0) moveNextCharacter()
        else movePreviousCharacter()
      }
    },
    { passive: false },
  )

  document.addEventListener('keydown', function handleKeyboard(event) {
    if (event.key === 'Escape') {
      event.preventDefault()
      if (settingsOpen) setSettingsOpen(false)
      else bridge.hideWindow()
      return
    }

    if (event.target.closest('input, select, button')) return

    if (event.key === ' ' || event.code === 'Space') {
      event.preventDefault()
      toggleAutoPlay()
      return
    }

    const key = event.key.toLowerCase()
    if (key === 'd' || event.key === 'ArrowRight') {
      event.preventDefault()
      moveNextCharacter()
    } else if (key === 'a' || event.key === 'ArrowLeft') {
      event.preventDefault()
      movePreviousCharacter()
    } else if (key === 's' || event.key === 'ArrowDown') {
      event.preventDefault()
      moveToLine(lineIndex + 1)
    } else if (key === 'w' || event.key === 'ArrowUp') {
      event.preventDefault()
      moveToLine(lineIndex - 1)
    }
  })

  autoPlayButton.addEventListener('click', toggleAutoPlay)
  settingsButton.addEventListener('click', function toggleSettings() {
    setSettingsOpen(!settingsOpen)
  })
  backgroundScreenPickButton.addEventListener('click', function pickBackgroundColor() {
    pickScreenColor(backgroundColorInput, backgroundScreenPickButton)
  })
  textScreenPickButton.addEventListener('click', function pickTextColor() {
    pickScreenColor(textColorInput, textScreenPickButton)
  })
  document.getElementById('hideButton').addEventListener('click', function hideReader() {
    bridge.hideWindow()
  })
  document.getElementById('closeButton').addEventListener('click', function closeReader() {
    bridge.closeWindow()
  })

  for (const control of settingsPanel.querySelectorAll('input, select')) {
    control.addEventListener('input', saveSettingsFromControls)
    control.addEventListener('change', saveSettingsFromControls)
  }

  window.addEventListener('weread:single-line:snapshot', function updateSnapshot(event) {
    snapshot = event.detail
    bufferedPages = [snapshot]
    bufferedPageIndex = 0
    lineIndex = snapshot.initialLine || 0
    characterOffset = 0
    nextPagePending = false
    previousPagePending = false
    pointerInsideWindow = null
    cancelAutoHide()
    readerBar.classList.remove('is-auto-hidden')
    stopAutoPlay()
    renderLine()
  })

  window.addEventListener('weread:single-line:append', function appendSnapshot(event) {
    const nextSnapshot = event.detail
    let nextIndex = bufferedPages.findIndex((page) => page.pageKey === nextSnapshot.pageKey)
    if (nextIndex < 0) {
      bufferedPages = bufferedPages.slice(0, bufferedPageIndex + 1)
      bufferedPages.push(nextSnapshot)
      nextIndex = bufferedPages.length - 1
    }
    bufferedPageIndex = nextIndex
    snapshot = bufferedPages[bufferedPageIndex]
    nextPagePending = false
    lineIndex = 0
    characterOffset = 0
    renderLine()
  })

  window.addEventListener('weread:single-line:prepend', function prependSnapshot(event) {
    const previousSnapshot = event.detail
    let previousIndex = bufferedPages.findIndex(
      (page) => page.pageKey === previousSnapshot.pageKey,
    )
    if (previousIndex < 0) {
      bufferedPages.unshift(previousSnapshot)
      previousIndex = 0
    }
    bufferedPageIndex = previousIndex
    snapshot = bufferedPages[bufferedPageIndex]
    previousPagePending = false
    lineIndex = Math.max(0, snapshot.lines.length - 1)
    characterOffset = Math.max(0, currentLine().length - 1)
    renderLine()
  })

  window.addEventListener('weread:single-line:buffer-next', function bufferNextSnapshot(event) {
    const nextSnapshot = event.detail
    if (bufferedPages.some((page) => page.pageKey === nextSnapshot.pageKey)) return
    bufferedPages.push(nextSnapshot)
    renderProgress()
  })

  window.addEventListener('weread:single-line:next-result', function finishNextPage(event) {
    nextPagePending = false
    previousPagePending = false
    stopAutoPlay()
    lineProgress.textContent = event.detail?.reason || '已经读到当前内容末尾'
  })

  applySettings()
  renderLine()
  lineText.focus()
})()
