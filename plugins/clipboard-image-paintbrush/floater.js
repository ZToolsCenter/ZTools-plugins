/* 剪贴板图片涂改 - 悬浮窗主逻辑 */
(function () {
  'use strict'

  // ---------- 读取传入的图片数据 ----------
  const key = (location.hash || '').slice(1)
  let dataUrl = key ? localStorage.getItem(key + '_img') : null
  const sourcePath = key ? localStorage.getItem(key + '_src') : ''
  const imgFile = key ? localStorage.getItem(key + '_imgFile') : ''

  // localStorage 装不下大图时 preload 会回退到临时文件，这里读出来
  if (!dataUrl && imgFile && window.floaterAPI && window.floaterAPI.readImageFile) {
    dataUrl = window.floaterAPI.readImageFile(imgFile)
    if (window.floaterAPI.cleanupTempFile) window.floaterAPI.cleanupTempFile(imgFile)
  }

  if (key) {
    localStorage.removeItem(key + '_img')
    localStorage.removeItem(key + '_src')
    localStorage.removeItem(key + '_imgFile')
  }

  if (!dataUrl) {
    document.body.innerHTML =
      '<div style="padding:20px;color:#fff;background:#222;height:100%">' +
      '没有可用的图片数据。请重新触发插件。</div>'
    return
  }

  // ---------- 元素引用 ----------
  const stage = document.getElementById('stage')
  const wrap = document.getElementById('canvasWrap')
  const imgCanvas = document.getElementById('imgCanvas')
  const drawCanvas = document.getElementById('drawCanvas')
  const imgCtx = imgCanvas.getContext('2d')
  const drawCtx = drawCanvas.getContext('2d')

  const undoBtn = document.getElementById('undo')
  const redoBtn = document.getElementById('redo')
  const clearBtn = document.getElementById('clear')
  const copyBtn = document.getElementById('copyBtn')
  const saveBtn = document.getElementById('saveBtn')
  const closeBtn = document.getElementById('closeBtn')
  const swatchesEl = document.getElementById('swatches')
  const sizesEl = document.getElementById('sizes')
  const textInput = document.getElementById('textInput')
  const dragRegion = document.getElementById('dragRegion')
  const resizeGrip = document.getElementById('resizeGrip')

  // ---------- 工具状态 ----------
  const state = {
    tool: 'pen',
    color: '#ff3b30',
    size: 4,
    isDrawing: false,
    startX: 0,
    startY: 0,
    snapshot: null,
    history: [],
    historyIndex: -1
  }

  // ---------- 颜色与尺寸 ----------
  const COLORS = [
    '#ff3b30', '#ff9500', '#ffcc00', '#34c759',
    '#5ac8fa', '#007aff', '#5856d6', '#af52de',
    '#ffffff', '#000000'
  ]
  const SIZES = [2, 4, 8, 14, 22]

  COLORS.forEach(function (c) {
    const el = document.createElement('span')
    el.className = 'swatch' + (c === state.color ? ' active' : '')
    el.style.background = c
    el.dataset.color = c
    el.addEventListener('click', function () {
      state.color = c
      Array.prototype.forEach.call(swatchesEl.children, function (n) {
        n.classList.remove('active')
      })
      el.classList.add('active')
    })
    swatchesEl.appendChild(el)
  })

  SIZES.forEach(function (sz) {
    const el = document.createElement('span')
    el.className = 'size-dot' + (sz === state.size ? ' active' : '')
    el.dataset.size = String(sz)
    const inner = document.createElement('i')
    const d = Math.min(18, Math.max(4, sz))
    inner.style.width = d + 'px'
    inner.style.height = d + 'px'
    el.appendChild(inner)
    el.addEventListener('click', function () {
      state.size = sz
      Array.prototype.forEach.call(sizesEl.children, function (n) {
        n.classList.remove('active')
      })
      el.classList.add('active')
    })
    sizesEl.appendChild(el)
  })

  // ---------- 切换工具按钮 ----------
  function setTool(toolName) {
    state.tool = toolName
    Array.prototype.forEach.call(document.querySelectorAll('[data-tool]'), function (b) {
      b.classList.toggle('active', b.dataset.tool === toolName)
    })
    cancelTextInput()
  }
  Array.prototype.forEach.call(document.querySelectorAll('[data-tool]'), function (btn) {
    btn.addEventListener('click', function () { setTool(btn.dataset.tool) })
  })

  // ---------- 加载图片，初始化画布尺寸 ----------
  const img = new Image()
  img.onload = function () {
    imgCanvas.width = img.naturalWidth
    imgCanvas.height = img.naturalHeight
    drawCanvas.width = img.naturalWidth
    drawCanvas.height = img.naturalHeight
    imgCtx.drawImage(img, 0, 0)
    fitStage()
    pushHistory()
    updateUndoRedo()
  }
  img.onerror = function () {
    document.body.innerHTML = '<div style="padding:20px;color:#fff">图片解码失败</div>'
  }
  img.src = dataUrl

  // ---------- 让 stage 始终保持图片比例并在 wrap 内 contain ----------
  function fitStage() {
    if (!img.naturalWidth) return
    const wrapRect = wrap.getBoundingClientRect()
    const padding = 16
    const availW = Math.max(50, wrapRect.width - padding)
    const availH = Math.max(50, wrapRect.height - padding)
    const imgAspect = img.naturalWidth / img.naturalHeight
    const wrapAspect = availW / availH
    let w, h
    if (wrapAspect > imgAspect) {
      h = availH
      w = h * imgAspect
    } else {
      w = availW
      h = w / imgAspect
    }
    stage.style.width = Math.round(w) + 'px'
    stage.style.height = Math.round(h) + 'px'
  }

  let resizeRaf
  window.addEventListener('resize', function () {
    cancelAnimationFrame(resizeRaf)
    resizeRaf = requestAnimationFrame(fitStage)
  })

  // ---------- 鼠标坐标 -> 画布内部像素坐标 ----------
  function eventToCanvasXY(e) {
    const rect = drawCanvas.getBoundingClientRect()
    const sx = drawCanvas.width / rect.width
    const sy = drawCanvas.height / rect.height
    return {
      x: (e.clientX - rect.left) * sx,
      y: (e.clientY - rect.top) * sy
    }
  }

  // ---------- 历史 / 撤销重做 ----------
  function pushHistory() {
    try {
      const snap = drawCtx.getImageData(0, 0, drawCanvas.width, drawCanvas.height)
      state.history = state.history.slice(0, state.historyIndex + 1)
      state.history.push(snap)
      // 4K 图片单张 ImageData ≈ 35MB；20 步上限足够标注场景使用，同时避免 OOM
      if (state.history.length > 20) {
        state.history.shift()
      } else {
        state.historyIndex++
      }
    } catch (e) {
      console.warn('pushHistory failed', e)
    }
    updateUndoRedo()
  }

  function undo() {
    if (state.historyIndex <= 0) return
    state.historyIndex--
    drawCtx.putImageData(state.history[state.historyIndex], 0, 0)
    updateUndoRedo()
  }

  function redo() {
    if (state.historyIndex >= state.history.length - 1) return
    state.historyIndex++
    drawCtx.putImageData(state.history[state.historyIndex], 0, 0)
    updateUndoRedo()
  }

  function clearAll() {
    drawCtx.clearRect(0, 0, drawCanvas.width, drawCanvas.height)
    pushHistory()
  }

  function updateUndoRedo() {
    undoBtn.disabled = state.historyIndex <= 0
    redoBtn.disabled = state.historyIndex >= state.history.length - 1
  }

  function snapshotForPreview() {
    try {
      state.snapshot = drawCtx.getImageData(0, 0, drawCanvas.width, drawCanvas.height)
    } catch (e) { state.snapshot = null }
  }
  function restorePreview() {
    if (state.snapshot) drawCtx.putImageData(state.snapshot, 0, 0)
  }

  // ---------- 样式应用 ----------
  function applyStrokeStyle() {
    drawCtx.lineCap = 'round'
    drawCtx.lineJoin = 'round'
    drawCtx.strokeStyle = state.color
    drawCtx.fillStyle = state.color
    drawCtx.lineWidth = state.size

    if (state.tool === 'highlighter') {
      drawCtx.globalAlpha = 0.3
      drawCtx.globalCompositeOperation = 'source-over'
      drawCtx.lineWidth = state.size * 3
    } else if (state.tool === 'eraser') {
      drawCtx.globalAlpha = 1
      drawCtx.globalCompositeOperation = 'destination-out'
      drawCtx.lineWidth = state.size * 4
    } else {
      drawCtx.globalAlpha = 1
      drawCtx.globalCompositeOperation = 'source-over'
    }
  }
  function resetGlobals() {
    drawCtx.globalAlpha = 1
    drawCtx.globalCompositeOperation = 'source-over'
  }

  // ---------- 形状绘制 ----------
  function drawArrow(x1, y1, x2, y2) {
    const headLen = Math.max(14, state.size * 4)
    const angle = Math.atan2(y2 - y1, x2 - x1)
    drawCtx.beginPath()
    drawCtx.moveTo(x1, y1)
    drawCtx.lineTo(x2, y2)
    drawCtx.stroke()
    // 实心箭头头部
    drawCtx.beginPath()
    drawCtx.moveTo(x2, y2)
    drawCtx.lineTo(x2 - headLen * Math.cos(angle - Math.PI / 7),
                   y2 - headLen * Math.sin(angle - Math.PI / 7))
    drawCtx.lineTo(x2 - headLen * Math.cos(angle + Math.PI / 7),
                   y2 - headLen * Math.sin(angle + Math.PI / 7))
    drawCtx.closePath()
    drawCtx.fill()
  }

  function drawMosaicAt(x, y) {
    if (!imgCanvas.width || !imgCanvas.height) return
    if (!state.rawImageData) {
      try {
        state.rawImageData = imgCtx.getImageData(0, 0, imgCanvas.width, imgCanvas.height).data
      } catch (e) { return }
    }
    const data = state.rawImageData
    const w = imgCanvas.width
    const h = imgCanvas.height

    const radius = state.size * 6
    const block = Math.max(6, state.size * 2)
    const startX = Math.floor(x - radius)
    const startY = Math.floor(y - radius)
    const size = radius * 2
    for (let bx = 0; bx < size; bx += block) {
      for (let by = 0; by < size; by += block) {
        const sx = Math.floor(startX + bx + block / 2)
        const sy = Math.floor(startY + by + block / 2)
        if (sx < 0 || sy < 0 || sx >= w || sy >= h) continue
        const i = (sy * w + sx) * 4
        drawCtx.fillStyle = 'rgba(' + data[i] + ',' + data[i + 1] + ',' + data[i + 2] + ',1)'
        drawCtx.fillRect(startX + bx, startY + by, block, block)
      }
    }
  }

  // ---------- 鼠标事件 ----------
  drawCanvas.addEventListener('mousedown', function (e) {
    if (e.button !== 0) return
    const p = eventToCanvasXY(e)

    if (state.tool === 'text') {
      placeTextInputAt(e)
      return
    }

    state.isDrawing = true
    state.startX = p.x
    state.startY = p.y
    applyStrokeStyle()
    snapshotForPreview()

    if (state.tool === 'pen' || state.tool === 'highlighter' || state.tool === 'eraser') {
      drawCtx.beginPath()
      drawCtx.moveTo(p.x, p.y)
      drawCtx.lineTo(p.x + 0.01, p.y + 0.01)
      drawCtx.stroke()
    } else if (state.tool === 'mosaic') {
      drawMosaicAt(p.x, p.y)
    }
  })

  drawCanvas.addEventListener('mousemove', function (e) {
    if (!state.isDrawing) return
    const p = eventToCanvasXY(e)
    if (state.tool === 'pen' || state.tool === 'highlighter' || state.tool === 'eraser') {
      drawCtx.lineTo(p.x, p.y)
      drawCtx.stroke()
    } else if (state.tool === 'rect') {
      restorePreview()
      applyStrokeStyle()
      drawCtx.strokeRect(state.startX, state.startY, p.x - state.startX, p.y - state.startY)
    } else if (state.tool === 'ellipse') {
      restorePreview()
      applyStrokeStyle()
      const cx = (state.startX + p.x) / 2
      const cy = (state.startY + p.y) / 2
      const rx = Math.abs(p.x - state.startX) / 2
      const ry = Math.abs(p.y - state.startY) / 2
      drawCtx.beginPath()
      drawCtx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2)
      drawCtx.stroke()
    } else if (state.tool === 'arrow') {
      restorePreview()
      applyStrokeStyle()
      drawArrow(state.startX, state.startY, p.x, p.y)
    } else if (state.tool === 'mosaic') {
      drawMosaicAt(p.x, p.y)
    }
  })

  function finishStroke() {
    if (!state.isDrawing) return
    state.isDrawing = false
    resetGlobals()
    pushHistory()
  }
  drawCanvas.addEventListener('mouseup', finishStroke)
  drawCanvas.addEventListener('mouseleave', finishStroke)

  // 滚轮调整画笔大小（Ctrl/⌘ + 滚轮 = 大小，普通滚轮 = 透明度）
  drawCanvas.addEventListener('wheel', function (e) {
    e.preventDefault()
    if (e.ctrlKey || e.metaKey) {
      // 改变窗口透明度
      const delta = e.deltaY > 0 ? -0.05 : 0.05
      if (window.floaterAPI) window.floaterAPI.setOpacityDelta(delta)
    } else {
      const dir = e.deltaY < 0 ? 1 : -1
      const cur = SIZES.indexOf(state.size)
      const next = Math.max(0, Math.min(SIZES.length - 1, cur + dir))
      state.size = SIZES[next]
      Array.prototype.forEach.call(sizesEl.children, function (n) {
        n.classList.toggle('active', Number(n.dataset.size) === state.size)
      })
    }
  }, { passive: false })

  // ---------- 文字输入 ----------
  function placeTextInputAt(e) {
    const wrapRect = wrap.getBoundingClientRect()
    textInput.style.display = 'block'
    textInput.style.left = (e.clientX - wrapRect.left) + 'px'
    textInput.style.top = (e.clientY - wrapRect.top) + 'px'
    textInput.value = ''
    const scaleX = drawCanvas.width / drawCanvas.getBoundingClientRect().width
    const fontPx = Math.max(14, state.size * 4 + 12)
    textInput.style.fontSize = (fontPx / scaleX) + 'px'
    textInput.style.color = state.color
    setTimeout(function () { textInput.focus() }, 30)
    textInput.dataset.x = String(eventToCanvasXY(e).x)
    textInput.dataset.y = String(eventToCanvasXY(e).y)
  }
  function commitText() {
    const text = textInput.value
    if (!text) { cancelTextInput(); return }
    const x = Number(textInput.dataset.x)
    const y = Number(textInput.dataset.y)
    applyStrokeStyle()
    drawCtx.globalCompositeOperation = 'source-over'
    drawCtx.globalAlpha = 1
    const fontPx = Math.max(14, state.size * 4 + 12)
    drawCtx.font = 'bold ' + fontPx + 'px -apple-system, "Microsoft YaHei", sans-serif'
    drawCtx.textBaseline = 'top'
    drawCtx.fillStyle = state.color
    drawCtx.fillText(text, x, y)
    pushHistory()
    cancelTextInput()
  }
  function cancelTextInput() {
    textInput.style.display = 'none'
    textInput.value = ''
  }
  textInput.addEventListener('keydown', function (e) {
    if (e.key === 'Enter') { e.preventDefault(); commitText() }
    else if (e.key === 'Escape') { e.preventDefault(); cancelTextInput() }
    e.stopPropagation()
  })
  textInput.addEventListener('blur', function () {
    if (textInput.value) commitText(); else cancelTextInput()
  })

  // ---------- 顶部按钮 ----------
  undoBtn.addEventListener('click', undo)
  redoBtn.addEventListener('click', redo)
  clearBtn.addEventListener('click', clearAll)
  closeBtn.addEventListener('click', function () { window.close() })
  copyBtn.addEventListener('click', copyResult)
  saveBtn.addEventListener('click', saveResult)

  // ---------- 合成输出 ----------
  function compositeToDataUrl() {
    const out = document.createElement('canvas')
    out.width = img.naturalWidth
    out.height = img.naturalHeight
    const ctx = out.getContext('2d')
    ctx.drawImage(imgCanvas, 0, 0)
    ctx.drawImage(drawCanvas, 0, 0)
    return out.toDataURL('image/png')
  }

  async function copyResult() {
    const data = compositeToDataUrl()
    if (window.floaterAPI) window.floaterAPI.copyImage(data)
  }

  async function saveResult() {
    const data = compositeToDataUrl()
    let suggestedName
    if (sourcePath) {
      try {
        const base = sourcePath.split(/[\\/]/).pop()
        const dot = base.lastIndexOf('.')
        const stem = dot > 0 ? base.slice(0, dot) : base
        suggestedName = stem + '_annotated.png'
      } catch (e) {}
    }
    if (window.floaterAPI) window.floaterAPI.saveImage(data, suggestedName)
  }

  // ---------- 键盘快捷键 ----------
  document.addEventListener('keydown', function (e) {
    if (document.activeElement === textInput) return
    const mod = e.ctrlKey || e.metaKey
    if (mod && e.key.toLowerCase() === 'z' && !e.shiftKey) { e.preventDefault(); undo(); return }
    if (mod && (e.key.toLowerCase() === 'y' || (e.shiftKey && e.key.toLowerCase() === 'z'))) {
      e.preventDefault(); redo(); return
    }
    if (mod && e.key.toLowerCase() === 's') { e.preventDefault(); saveResult(); return }
    if (mod && e.key.toLowerCase() === 'c') { e.preventDefault(); copyResult(); return }
    if (e.key === 'Escape') { e.preventDefault(); window.close(); return }
    if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); /* keep image */; return }

    // 工具快捷键
    const map = { b: 'pen', h: 'highlighter', r: 'rect', o: 'ellipse', a: 'arrow', t: 'text', m: 'mosaic', e: 'eraser' }
    const k = e.key.toLowerCase()
    if (map[k]) { setTool(map[k]) }
  })

  // ---------- 自定义大小手柄（请求父进程改变窗口大小） ----------
  let resizing = false
  let resizeStart = null
  resizeGrip.addEventListener('mousedown', function (e) {
    e.preventDefault()
    resizing = true
    resizeStart = { x: e.screenX, y: e.screenY, w: window.outerWidth, h: window.outerHeight }
  })
  document.addEventListener('mousemove', function (e) {
    if (!resizing || !resizeStart) return
    const dw = e.screenX - resizeStart.x
    const dh = e.screenY - resizeStart.y
    const newW = Math.max(420, resizeStart.w + dw)
    const newH = Math.max(180, resizeStart.h + dh)
    if (window.floaterAPI) window.floaterAPI.requestResize({ width: newW, height: newH })
  })
  document.addEventListener('mouseup', function () {
    if (!resizing) return
    resizing = false
    resizeStart = null
    fitStage()
  })

  // 工具栏自定义拖拽备份（防止某些环境下 -webkit-app-region 失效）
  let dragging = false
  let dragLast = null
  dragRegion.addEventListener('mousedown', function (e) {
    if (e.button !== 0) return
    dragging = true
    dragLast = { x: e.screenX, y: e.screenY }
  })
  document.addEventListener('mousemove', function (e) {
    if (!dragging || !dragLast) return
    const dx = e.screenX - dragLast.x
    const dy = e.screenY - dragLast.y
    dragLast = { x: e.screenX, y: e.screenY }
    if (window.floaterAPI) window.floaterAPI.move(dx, dy)
  })
  document.addEventListener('mouseup', function () {
    dragging = false
    dragLast = null
  })

  // 阻止页面被拖入图片导致跳转
  ;['dragover', 'drop'].forEach(function (ev) {
    document.addEventListener(ev, function (e) { e.preventDefault() })
  })
})()
