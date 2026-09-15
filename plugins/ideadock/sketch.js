// 临时画板 —— 从 app.js 拆出。经典脚本、全局作用域，须在 app.js 之后加载。
// 模型：无边世界画布 + 平移浏览。笔画/文字是「对象」，以世界坐标（设备像素）保留在数组里，
// 每帧整体重绘。橡皮只删除笔迹/文字对象；图片等素材通过选中后 Del 删除。

let sketchCtx = null
let sketchTextInput = null
let sketchResizing = false

// 模式：hand 选择/移动/缩放 + 空白平移 / pen 画笔 / eraser 对象橡皮 / shape 拉框放图形
let sketchMode = 'pen'

// shape 模式下待放置的图形名（rect/roundRect/diamond/parallelogram/ellipse/line/arrow/doubleArrow）
let sketchPendingShape = null

// 线型图形：用带符号的 w/h 记录方向（可为负），缩放不夹到 1、按端点距离判最小尺寸
const SKETCH_LINE_SHAPES = ['line', 'arrow', 'doubleArrow']
function isLineShape(name) { return SKETCH_LINE_SHAPES.includes(name) }

// 视口相对世界原点的平移量（设备像素）。世界点 W 落在画布像素 W + pan 处。
let sketchPanX = 0
let sketchPanY = 0

// 保留式内容：按创建顺序排成一条列表，重绘据此生成。
// stroke: { type:'stroke', color, size, points:[{x,y}...] }（世界坐标/设备像素）
// text:   { type:'text', x, y, color, fontSize, lines:[...] }
// image:  { type:'image', x, y, w, h, dataUrl }
const sketchItems = []
const sketchImageCache = new Map()

// 当前选中的对象（引用 sketchItems 中的某一项），null 表示无
let sketchSelected = null

// 指针交互状态机：null | 'draw' | 'pan' | 'move' | 'scale' | 'erase' | 'shape'
let sketchAction = null

// shape 拉框过程中的临时图形（未提交进 sketchItems）
let sketchShapeDraft = null

// 本次手势是否改动了内容（move/scale/erase 用，决定是否记入历史）
let sketchDirty = false

// 撤销/重做：sketchItems 的深拷贝快照栈，sketchHistoryIndex 指向当前状态
const sketchHistory = []
let sketchHistoryIndex = -1
const SKETCH_HISTORY_MAX = 100

// draw
let sketchCurStroke = null
let sketchLastPoint = null
let sketchStartPoint = null
let sketchHasMoved = false
let sketchShiftReturnMode = null
let sketchShiftRestorePending = false
// pan
let sketchPanStart = null   // { clientX, clientY, panX, panY }
// move
let sketchMoveLast = null    // 上一帧的世界坐标
// scale
let sketchScaleData = null   // { anchor, origDist, snapshot }

const SKETCH_DRAW_THRESHOLD = 3
const SKETCH_HANDLE = 7       // 角手柄半尺寸（CSS 像素）
const SKETCH_GRID_KEY = 'sketch.grid'

// 辅助定位用的虚线方格网格，顶部开关控制显隐（默认关，状态持久化）
let sketchGridOn = false

// 画板内部按至少 2x 分辨率渲染，避免普通屏（dpr=1）上文字/线条发虚
function sketchScale() {
  return Math.max(2, window.devicePixelRatio || 1)
}

function isSketchOpen() {
  return $('app').classList.contains('sketch-open')
}

function openSketchBoard() {
  if (window.closeCalcBoard) window.closeCalcBoard()
  if (window.closeClipboard) window.closeClipboard()
  $('sketch-panel').style.width = ''
  $('app').classList.add('sketch-open')
  $('btn-sketch-board').classList.add('active')
  requestAnimationFrame(resizeSketchCanvas)
}

function resetSketchInteraction() {
  sketchAction = null
  sketchCurStroke = null
  sketchLastPoint = null
  sketchStartPoint = null
  sketchHasMoved = false
  sketchPanStart = null
  sketchMoveLast = null
  sketchScaleData = null
  sketchShapeDraft = null
  sketchDirty = false
  $('sketch-panel').classList.remove('panning')
}

// ---- 撤销 / 重做 ----

function pushSketchHistory() {
  sketchHistory.splice(sketchHistoryIndex + 1)   // 丢弃 redo 分支
  sketchHistory.push(JSON.parse(JSON.stringify(sketchItems)))
  if (sketchHistory.length > SKETCH_HISTORY_MAX) sketchHistory.shift()
  sketchHistoryIndex = sketchHistory.length - 1
  updateSketchUndoButtons()
}

function restoreSketchHistory() {
  const snap = sketchHistory[sketchHistoryIndex] || []
  sketchItems.length = 0
  for (const it of snap) sketchItems.push(JSON.parse(JSON.stringify(it)))
  sketchSelected = null
  resetSketchInteraction()
  redrawSketch()
  updateSketchUndoButtons()
}

function sketchUndo() {
  commitSketchTextInput()
  if (sketchHistoryIndex <= 0) return
  sketchHistoryIndex--
  restoreSketchHistory()
}

function sketchRedo() {
  if (sketchHistoryIndex >= sketchHistory.length - 1) return
  sketchHistoryIndex++
  restoreSketchHistory()
}

function updateSketchUndoButtons() {
  $('sketch-undo').disabled = sketchHistoryIndex <= 0
  $('sketch-redo').disabled = sketchHistoryIndex >= sketchHistory.length - 1
}

function closeSketchBoard() {
  commitSketchTextInput()
  $('app').classList.remove('sketch-open')
  $('btn-sketch-board').classList.remove('active')
  sketchSelected = null
  resetSketchInteraction()
}

function getSketchContext() {
  if (!sketchCtx) {
    sketchCtx = $('sketch-canvas').getContext('2d')
    sketchCtx.lineCap = 'round'
    sketchCtx.lineJoin = 'round'
  }
  return sketchCtx
}

// 后备缓冲只按视口大小分配（内存与视口成正比，与画布"无边"无关）。
// 尺寸变化时不再缩放旧位图（会糊），而是按矢量数据整帧重绘。
function resizeSketchCanvas() {
  const canvas = $('sketch-canvas')
  const rect = canvas.getBoundingClientRect()
  if (rect.width <= 0 || rect.height <= 0) return
  const scale = sketchScale()
  const nextW = Math.round(rect.width * scale)
  const nextH = Math.round(rect.height * scale)
  if (canvas.width === nextW && canvas.height === nextH) return
  canvas.width = nextW
  canvas.height = nextH
  sketchCtx = canvas.getContext('2d')
  sketchCtx.lineCap = 'round'
  sketchCtx.lineJoin = 'round'
  redrawSketch()
}

// 屏幕事件 → 世界坐标（设备像素）
function sketchWorldFromEvent(e) {
  const rect = $('sketch-canvas').getBoundingClientRect()
  const scale = sketchScale()
  return {
    x: (e.clientX - rect.left) * scale - sketchPanX,
    y: (e.clientY - rect.top) * scale - sketchPanY
  }
}

function sketchViewportCenterWorld() {
  const canvas = $('sketch-canvas')
  return {
    x: canvas.width / 2 - sketchPanX,
    y: canvas.height / 2 - sketchPanY
  }
}

// ---- 几何：包围盒 / 命中检测 / 角点 ----

function pointSegDist(p, a, b) {
  const vx = b.x - a.x, vy = b.y - a.y
  const wx = p.x - a.x, wy = p.y - a.y
  const len2 = vx * vx + vy * vy
  let t = len2 ? (wx * vx + wy * vy) / len2 : 0
  t = Math.max(0, Math.min(1, t))
  const dx = p.x - (a.x + t * vx)
  const dy = p.y - (a.y + t * vy)
  return Math.hypot(dx, dy)
}

// 对象在世界坐标下的包围盒 { x, y, w, h }
function itemBounds(item) {
  if (item.type === 'image') return { x: item.x, y: item.y, w: item.w, h: item.h }
  if (item.type === 'text') {
    const ctx = getSketchContext()
    ctx.font = `${item.fontSize}px ${getComputedStyle(document.body).fontFamily}`
    let w = 0
    for (const line of item.lines) w = Math.max(w, ctx.measureText(line).width)
    const h = item.lines.length * item.fontSize * 1.35
    return { x: item.x, y: item.y, w: w || item.fontSize, h }
  }
  if (item.type === 'shape') {
    // 箭头用带符号的 w/h 记录方向，包围盒需归一化
    return {
      x: Math.min(item.x, item.x + item.w),
      y: Math.min(item.y, item.y + item.h),
      w: Math.abs(item.w),
      h: Math.abs(item.h)
    }
  }
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
  for (const p of item.points) {
    if (p.x < minX) minX = p.x
    if (p.y < minY) minY = p.y
    if (p.x > maxX) maxX = p.x
    if (p.y > maxY) maxY = p.y
  }
  const pad = item.size / 2
  return { x: minX - pad, y: minY - pad, w: (maxX - minX) + item.size, h: (maxY - minY) + item.size }
}

function sketchCorners(b) {
  return [
    { x: b.x, y: b.y },                 // 0 左上
    { x: b.x + b.w, y: b.y },           // 1 右上
    { x: b.x, y: b.y + b.h },           // 2 左下
    { x: b.x + b.w, y: b.y + b.h }      // 3 右下
  ]
}

// 世界点 W 是否命中对象（tol：容差半径，设备像素）
function sketchItemHit(item, W, tol) {
  const b = itemBounds(item)
  if (item.type === 'text' || item.type === 'shape' || item.type === 'image') {
    return W.x >= b.x - tol && W.x <= b.x + b.w + tol && W.y >= b.y - tol && W.y <= b.y + b.h + tol
  }
  const r = item.size / 2 + tol
  const pts = item.points
  if (pts.length === 1) return Math.hypot(W.x - pts[0].x, W.y - pts[0].y) <= r
  for (let i = 1; i < pts.length; i++) {
    if (pointSegDist(W, pts[i - 1], pts[i]) <= r) return true
  }
  return false
}

// 最上层命中的对象（后画的在上，故倒序）
function sketchItemAt(W) {
  const tol = 6 * sketchScale()
  for (let i = sketchItems.length - 1; i >= 0; i--) {
    if (sketchItemHit(sketchItems[i], W, tol)) return sketchItems[i]
  }
  return null
}

// 指针是否落在选中对象的某个角手柄上，返回角索引 0..3，否则 -1
function sketchHandleAt(e) {
  if (!sketchSelected) return -1
  const b = itemBounds(sketchSelected)
  const rect = $('sketch-canvas').getBoundingClientRect()
  const scale = sketchScale()
  const px = (e.clientX - rect.left) * scale
  const py = (e.clientY - rect.top) * scale
  const hs = SKETCH_HANDLE * scale
  const corners = sketchCorners(b)
  for (let i = 0; i < 4; i++) {
    const cx = corners[i].x + sketchPanX
    const cy = corners[i].y + sketchPanY
    if (Math.abs(px - cx) <= hs && Math.abs(py - cy) <= hs) return i
  }
  return -1
}

// ---- 对象编辑：移动 / 缩放 / 删除 ----

function moveSketchItem(item, dx, dy) {
  if (item.type === 'text' || item.type === 'shape' || item.type === 'image') {
    item.x += dx
    item.y += dy
  } else {
    for (const p of item.points) { p.x += dx; p.y += dy }
  }
}

function snapshotSketchItem(item) {
  if (item.type === 'text') return { x: item.x, y: item.y, fontSize: item.fontSize }
  if (item.type === 'image') return { x: item.x, y: item.y, w: item.w, h: item.h }
  if (item.type === 'shape') return { x: item.x, y: item.y, w: item.w, h: item.h }
  return { points: item.points.map(p => ({ x: p.x, y: p.y })), size: item.size }
}

function startSketchScale(cornerIndex, W) {
  const corners = sketchCorners(itemBounds(sketchSelected))
  const anchor = corners[3 - cornerIndex]   // 对角固定：0↔3，1↔2
  const handle = corners[cornerIndex]
  const origDist = Math.hypot(handle.x - anchor.x, handle.y - anchor.y) || 1
  sketchScaleData = { anchor, origDist, snapshot: snapshotSketchItem(sketchSelected) }
  sketchAction = 'scale'
}

// 以固定对角为锚点，对快照做等比缩放
function applySketchScale(factor) {
  const { anchor, snapshot } = sketchScaleData
  const item = sketchSelected
  if (item.type === 'text') {
    item.x = anchor.x + (snapshot.x - anchor.x) * factor
    item.y = anchor.y + (snapshot.y - anchor.y) * factor
    item.fontSize = Math.max(4, snapshot.fontSize * factor)
  } else if (item.type === 'image') {
    item.x = anchor.x + (snapshot.x - anchor.x) * factor
    item.y = anchor.y + (snapshot.y - anchor.y) * factor
    item.w = Math.max(1, snapshot.w * factor)
    item.h = Math.max(1, snapshot.h * factor)
  } else if (item.type === 'shape') {
    item.x = anchor.x + (snapshot.x - anchor.x) * factor
    item.y = anchor.y + (snapshot.y - anchor.y) * factor
    if (isLineShape(item.shape)) {
      // 线型保留带符号 w/h（方向 + 可为负），不能夹到 1
      item.w = snapshot.w * factor
      item.h = snapshot.h * factor
    } else {
      item.w = Math.max(1, snapshot.w * factor)
      item.h = Math.max(1, snapshot.h * factor)
    }
  } else {
    for (let i = 0; i < item.points.length; i++) {
      item.points[i].x = anchor.x + (snapshot.points[i].x - anchor.x) * factor
      item.points[i].y = anchor.y + (snapshot.points[i].y - anchor.y) * factor
    }
    item.size = Math.max(1, snapshot.size * factor)
  }
}

function sketchErasableItem(item) {
  return item.type === 'stroke' || item.type === 'text'
}

function deleteSketchSelected() {
  if (!sketchSelected) return false
  const index = sketchItems.indexOf(sketchSelected)
  if (index < 0) {
    sketchSelected = null
    redrawSketch()
    return false
  }
  sketchItems.splice(index, 1)
  sketchSelected = null
  resetSketchInteraction()
  redrawSketch()
  pushSketchHistory()
  return true
}

// 对象级橡皮：删除半径内命中的笔迹/文字，图片和图形保留给手型选择 + Del 删除
function sketchEraseAt(W) {
  const radius = Number($('sketch-eraser-size').value) / 2 * sketchScale()
  let changed = false
  for (let i = sketchItems.length - 1; i >= 0; i--) {
    if (!sketchErasableItem(sketchItems[i])) continue
    if (sketchItemHit(sketchItems[i], W, radius)) {
      if (sketchItems[i] === sketchSelected) sketchSelected = null
      sketchItems.splice(i, 1)
      changed = true
    }
  }
  if (changed) { sketchDirty = true; redrawSketch() }
}

// ---- 绘制 ----

// 淡点阵网格：用 destination-over 画在所有内容之后（背景层）
function drawSketchGrid(ctx, canvas) {
  const scale = sketchScale()
  const gap = 26 * scale
  const ox = ((sketchPanX % gap) + gap) % gap
  const oy = ((sketchPanY % gap) + gap) % gap
  const r = Math.max(1, scale * 0.9)
  ctx.save()
  ctx.globalCompositeOperation = 'destination-over'
  ctx.fillStyle = 'rgba(120,120,140,0.16)'
  for (let x = ox; x < canvas.width; x += gap) {
    for (let y = oy; y < canvas.height; y += gap) ctx.fillRect(x, y, r, r)
  }
  ctx.restore()
}

// 辅助虚线方格：随平移滚动，只覆盖可视范围，画在背景层（destination-over）
function drawSketchGuideGrid(ctx, canvas) {
  const scale = sketchScale()
  const gap = 26 * scale
  const ox = ((sketchPanX % gap) + gap) % gap
  const oy = ((sketchPanY % gap) + gap) % gap
  ctx.save()
  ctx.globalCompositeOperation = 'destination-over'
  ctx.strokeStyle = 'rgba(120,120,140,0.22)'
  ctx.lineWidth = Math.max(1, scale * 0.5)
  ctx.setLineDash([3 * scale, 4 * scale])
  ctx.beginPath()
  for (let x = ox; x < canvas.width; x += gap) { ctx.moveTo(x, 0); ctx.lineTo(x, canvas.height) }
  for (let y = oy; y < canvas.height; y += gap) { ctx.moveTo(0, y); ctx.lineTo(canvas.width, y) }
  ctx.stroke()
  ctx.restore()
}

function drawSketchStroke(ctx, s) {
  if (s.points.length < 2) return
  ctx.save()
  ctx.beginPath()
  ctx.moveTo(s.points[0].x + sketchPanX, s.points[0].y + sketchPanY)
  for (let i = 1; i < s.points.length; i++) {
    ctx.lineTo(s.points[i].x + sketchPanX, s.points[i].y + sketchPanY)
  }
  ctx.strokeStyle = s.color
  ctx.lineWidth = s.size
  ctx.stroke()
  ctx.restore()
}

function sketchRoundRectPath(ctx, x, y, w, h, r) {
  r = Math.min(r, w / 2, h / 2)
  ctx.moveTo(x + r, y)
  ctx.arcTo(x + w, y, x + w, y + h, r)
  ctx.arcTo(x + w, y + h, x, y + h, r)
  ctx.arcTo(x, y + h, x, y, r)
  ctx.arcTo(x, y, x + w, y, r)
  ctx.closePath()
}

// 流程图形状：描边空心，颜色/线宽复用画笔设置
function drawSketchShape(ctx, s) {
  const x = s.x + sketchPanX, y = s.y + sketchPanY, w = s.w, h = s.h
  ctx.save()
  ctx.beginPath()
  if (s.shape === 'rect') {
    ctx.rect(x, y, w, h)
  } else if (s.shape === 'roundRect') {
    sketchRoundRectPath(ctx, x, y, w, h, Math.min(w, h) * 0.22)
  } else if (s.shape === 'ellipse') {
    ctx.ellipse(x + w / 2, y + h / 2, w / 2, h / 2, 0, 0, Math.PI * 2)
  } else if (s.shape === 'diamond') {
    ctx.moveTo(x + w / 2, y)
    ctx.lineTo(x + w, y + h / 2)
    ctx.lineTo(x + w / 2, y + h)
    ctx.lineTo(x, y + h / 2)
    ctx.closePath()
  } else if (s.shape === 'parallelogram') {
    const off = w * 0.25
    ctx.moveTo(x + off, y)
    ctx.lineTo(x + w, y)
    ctx.lineTo(x + w - off, y + h)
    ctx.lineTo(x, y + h)
    ctx.closePath()
  } else if (isLineShape(s.shape)) {
    // 从起点(x,y)指向终点(x+w,y+h)，带符号 w/h 决定方向
    const x2 = x + w, y2 = y + h
    const ang = Math.atan2(h, w)
    const head = Math.min(Math.hypot(w, h) * 0.4, Math.max(10 * sketchScale(), s.size * 4))
    ctx.moveTo(x, y)
    ctx.lineTo(x2, y2)
    if (s.shape !== 'line') {
      // 终点箭头
      ctx.moveTo(x2, y2)
      ctx.lineTo(x2 - head * Math.cos(ang - Math.PI / 6), y2 - head * Math.sin(ang - Math.PI / 6))
      ctx.moveTo(x2, y2)
      ctx.lineTo(x2 - head * Math.cos(ang + Math.PI / 6), y2 - head * Math.sin(ang + Math.PI / 6))
    }
    if (s.shape === 'doubleArrow') {
      // 起点箭头（指回起点方向）
      ctx.moveTo(x, y)
      ctx.lineTo(x + head * Math.cos(ang - Math.PI / 6), y + head * Math.sin(ang - Math.PI / 6))
      ctx.moveTo(x, y)
      ctx.lineTo(x + head * Math.cos(ang + Math.PI / 6), y + head * Math.sin(ang + Math.PI / 6))
    }
  }
  ctx.strokeStyle = s.color
  ctx.lineWidth = s.size
  ctx.stroke()
  ctx.restore()
}

function drawSketchTextItem(ctx, t) {
  ctx.save()
  ctx.fillStyle = t.color
  ctx.font = `${t.fontSize}px ${getComputedStyle(document.body).fontFamily}`
  ctx.textBaseline = 'top'
  t.lines.forEach((line, i) => {
    ctx.fillText(line, t.x + sketchPanX, t.y + sketchPanY + i * t.fontSize * 1.35)
  })
  ctx.restore()
}

function getSketchImage(dataUrl) {
  let cached = sketchImageCache.get(dataUrl)
  if (cached) return cached
  cached = { img: new Image(), loaded: false, failed: false }
  cached.img.onload = () => { cached.loaded = true; redrawSketch() }
  cached.img.onerror = () => { cached.failed = true }
  cached.img.src = dataUrl
  sketchImageCache.set(dataUrl, cached)
  return cached
}

function drawSketchImageItem(ctx, item) {
  const cached = getSketchImage(item.dataUrl)
  const x = item.x + sketchPanX
  const y = item.y + sketchPanY
  ctx.save()
  if (cached.loaded) {
    ctx.drawImage(cached.img, x, y, item.w, item.h)
  } else {
    ctx.fillStyle = 'rgba(120,120,140,0.12)'
    ctx.strokeStyle = 'rgba(120,120,140,0.45)'
    ctx.lineWidth = Math.max(1, sketchScale())
    ctx.fillRect(x, y, item.w, item.h)
    ctx.strokeRect(x, y, item.w, item.h)
  }
  ctx.restore()
}

// 选中对象的外框 + 四角缩放手柄（画在最上层）
function drawSketchSelection(ctx) {
  if (!sketchSelected) return
  const b = itemBounds(sketchSelected)
  const scale = sketchScale()
  const x = b.x + sketchPanX
  const y = b.y + sketchPanY
  ctx.save()
  ctx.strokeStyle = '#2ea043'
  ctx.lineWidth = 1.4 * scale
  ctx.setLineDash([5 * scale, 4 * scale])
  ctx.strokeRect(x, y, b.w, b.h)
  ctx.setLineDash([])
  ctx.fillStyle = '#ffffff'
  ctx.lineWidth = 1.2 * scale
  const hs = SKETCH_HANDLE * scale
  for (const c of sketchCorners({ x, y, w: b.w, h: b.h })) {
    ctx.beginPath()
    ctx.rect(c.x - hs, c.y - hs, hs * 2, hs * 2)
    ctx.fill()
    ctx.stroke()
  }
  ctx.restore()
}

function redrawSketch() {
  const ctx = getSketchContext()
  const canvas = $('sketch-canvas')
  ctx.clearRect(0, 0, canvas.width, canvas.height)
  for (const item of sketchItems) {
    if (item.type === 'text') drawSketchTextItem(ctx, item)
    else if (item.type === 'image') drawSketchImageItem(ctx, item)
    else if (item.type === 'shape') drawSketchShape(ctx, item)
    else drawSketchStroke(ctx, item)
  }
  if (sketchShapeDraft) drawSketchShape(ctx, sketchShapeDraft)
  if (sketchGridOn) drawSketchGuideGrid(ctx, canvas)
  drawSketchGrid(ctx, canvas)
  drawSketchSelection(ctx)
}

// 绘制过程中的即时反馈：直接画当前这一小段（与整帧重绘一致，落笔不闪）
function strokeSegment(a, b, s) {
  const ctx = getSketchContext()
  ctx.save()
  ctx.beginPath()
  ctx.moveTo(a.x + sketchPanX, a.y + sketchPanY)
  ctx.lineTo(b.x + sketchPanX, b.y + sketchPanY)
  ctx.strokeStyle = s.color
  ctx.lineWidth = s.size
  ctx.stroke()
  ctx.restore()
}

// ---- 文字输入 ----

function commitSketchTextInput() {
  if (!sketchTextInput) return
  const input = sketchTextInput
  sketchTextInput = null
  const text = input.value.trim()
  const wx = Number(input.dataset.worldX)
  const wy = Number(input.dataset.worldY)
  input.remove()
  if (!text) return
  const fontSize = Number($('sketch-text-size').value) * sketchScale()
  sketchItems.push({
    type: 'text',
    x: wx,
    y: wy,
    color: $('sketch-text-color').value,
    fontSize,
    lines: text.split(/\r?\n/)
  })
  redrawSketch()
  pushSketchHistory()
}

function cancelSketchTextInput() {
  if (!sketchTextInput) return
  sketchTextInput.remove()
  sketchTextInput = null
}

function openSketchTextInput(e) {
  commitSketchTextInput()
  const wrap = document.querySelector('.sketch-canvas-wrap')
  const wrapRect = wrap.getBoundingClientRect()
  const point = sketchWorldFromEvent(e)
  const input = document.createElement('textarea')
  input.className = 'sketch-text-input'
  input.placeholder = '输入文本'
  input.rows = 1
  input.dataset.worldX = String(point.x)
  input.dataset.worldY = String(point.y)
  input.style.left = `${e.clientX - wrapRect.left}px`
  input.style.top = `${e.clientY - wrapRect.top}px`
  input.style.fontSize = `${Number($('sketch-text-size').value)}px`
  input.style.color = $('sketch-text-color').value
  input.addEventListener('keydown', ev => {
    if (ev.key === 'Escape') {
      ev.preventDefault()
      cancelSketchTextInput()
      return
    }
    if (ev.key === 'Enter' && !ev.shiftKey) {
      ev.preventDefault()
      commitSketchTextInput()
    }
  })
  input.addEventListener('input', () => {
    input.style.height = 'auto'
    input.style.height = `${input.scrollHeight}px`
  })
  input.addEventListener('blur', commitSketchTextInput)
  wrap.appendChild(input)
  sketchTextInput = input
  input.focus()
}

function addSketchImageFromDataUrl(dataUrl, naturalW, naturalH) {
  resizeSketchCanvas()
  commitSketchTextInput()
  const center = sketchViewportCenterWorld()
  const maxW = $('sketch-canvas').width * 0.72
  const maxH = $('sketch-canvas').height * 0.72
  const rawW = Math.max(1, naturalW || 240)
  const rawH = Math.max(1, naturalH || 160)
  const fit = Math.min(1, maxW / rawW, maxH / rawH)
  const w = Math.max(1, rawW * fit)
  const h = Math.max(1, rawH * fit)
  const item = {
    type: 'image',
    x: center.x - w / 2,
    y: center.y - h / 2,
    w,
    h,
    dataUrl
  }
  sketchItems.push(item)
  sketchSelected = item
  setSketchMode('hand')
  redrawSketch()
  pushSketchHistory()
}

function pasteSketchImageFile(file) {
  const reader = new FileReader()
  reader.onload = () => {
    const dataUrl = String(reader.result || '')
    if (!dataUrl) return
    const img = new Image()
    img.onload = () => addSketchImageFromDataUrl(dataUrl, img.naturalWidth, img.naturalHeight)
    img.onerror = () => addSketchImageFromDataUrl(dataUrl, 0, 0)
    img.src = dataUrl
  }
  reader.readAsDataURL(file)
}

// ---- 光标 ----

// 橡皮光标：一个圆圈，直径 = 橡皮大小（CSS 像素），做到所见即所擦
function eraserCursorCss() {
  const d = Math.max(4, Math.round(Number($('sketch-eraser-size').value)))
  const s = d + 2
  const c = (s / 2).toFixed(1)
  const r = (d / 2).toFixed(1)
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${s}" height="${s}"><circle cx="${c}" cy="${c}" r="${r}" fill="none" stroke="#666666" stroke-width="1.4"/></svg>`
  const hot = Math.round(s / 2)
  return `url("data:image/svg+xml,${encodeURIComponent(svg)}") ${hot} ${hot}, auto`
}

// 橡皮 → 圆圈；其它模式清空内联 cursor，回落到 CSS（grab/crosshair）
function updateSketchCursor() {
  $('sketch-canvas').style.cursor = sketchMode === 'eraser' ? eraserCursorCss() : ''
}

// 手模式悬停：手柄→缩放光标，对象→移动光标，空白→抓手（回落 CSS）
function updateHandHoverCursor(e) {
  const canvas = $('sketch-canvas')
  if (sketchSelected) {
    const hi = sketchHandleAt(e)
    if (hi >= 0) {
      canvas.style.cursor = (hi === 0 || hi === 3) ? 'nwse-resize' : 'nesw-resize'
      return
    }
  }
  canvas.style.cursor = sketchItemAt(sketchWorldFromEvent(e)) ? 'move' : ''
}

function setSketchMode(mode) {
  sketchMode = mode
  if (mode !== 'hand') sketchSelected = null   // 非手模式不显示选中框
  const panel = $('sketch-panel')
  for (const m of ['hand', 'pen', 'eraser']) {
    const on = m === mode
    $('sketch-mode-' + m).classList.toggle('active', on)
    $('sketch-mode-' + m).setAttribute('aria-pressed', String(on))
    panel.classList.toggle('mode-' + m, on)
  }
  panel.classList.toggle('mode-shape', mode === 'shape')
  $('sketch-shapes-btn').classList.toggle('active', mode === 'shape')
  if (mode !== 'shape') sketchPendingShape = null
  updateSketchCursor()
  if (isSketchOpen()) redrawSketch()
}

// 改橡皮大小时，圆圈光标同步变大变小
$('sketch-eraser-size').addEventListener('input', updateSketchCursor)

// ---- 设置弹窗：主色色块、粗细/大小数值、开合 ----
const SKETCH_COLORS = ['#1a1b20', '#6b7280', '#e5484d', '#f5a623', '#2ea043', '#3b82f6', '#8b5cf6', '#ec4899']

function buildSketchSwatches(containerId, colorInputId) {
  const container = $(containerId)
  const input = $(colorInputId)
  SKETCH_COLORS.forEach(col => {
    const b = document.createElement('button')
    b.type = 'button'
    b.className = 'sketch-swatch'
    b.style.background = col
    b.dataset.color = col
    b.title = col
    b.addEventListener('click', () => {
      input.value = col
      refreshSketchSwatches()
    })
    container.appendChild(b)
  })
}

function markSwatchActive(containerId, colorInputId) {
  const val = $(colorInputId).value.toLowerCase()
  $(containerId).querySelectorAll('.sketch-swatch').forEach(s => {
    s.classList.toggle('active', s.dataset.color.toLowerCase() === val)
  })
}

function refreshSketchSwatches() {
  markSwatchActive('sketch-pen-swatches', 'sketch-color')
  markSwatchActive('sketch-text-swatches', 'sketch-text-color')
}

buildSketchSwatches('sketch-pen-swatches', 'sketch-color')
buildSketchSwatches('sketch-text-swatches', 'sketch-text-color')
refreshSketchSwatches()

$('sketch-color').addEventListener('input', refreshSketchSwatches)
$('sketch-text-color').addEventListener('input', refreshSketchSwatches)
$('sketch-size').addEventListener('input', () => { $('sketch-size-val').textContent = $('sketch-size').value })
$('sketch-text-size').addEventListener('input', () => { $('sketch-text-size-val').textContent = $('sketch-text-size').value })
$('sketch-eraser-size').addEventListener('input', () => { $('sketch-eraser-size-val').textContent = $('sketch-eraser-size').value })

// 弹窗交互：鼠标悬浮到按钮组即打开（互斥），移开或点击按钮即收起。
// 弹窗紧贴按钮（CSS top:100%），中间无空档，hover 才不会因穿过间隙而闪。
const SKETCH_POPUPS = [
  ['sketch-settings-popup', 'sketch-settings-btn'],
  ['sketch-shapes-popup', 'sketch-shapes-btn']
]

function closeAllSketchPopups() {
  for (const [pid, bid] of SKETCH_POPUPS) {
    $(pid).hidden = true
    $(bid).setAttribute('aria-expanded', 'false')
  }
}

function wireSketchPopupHover(wrapClass, popupId, btnId) {
  const wrap = document.querySelector('.' + wrapClass)
  wrap.addEventListener('mouseenter', () => {
    closeAllSketchPopups()
    $(popupId).hidden = false
    $(btnId).setAttribute('aria-expanded', 'true')
  })
  wrap.addEventListener('mouseleave', () => {
    $(popupId).hidden = true
    $(btnId).setAttribute('aria-expanded', 'false')
  })
  $(btnId).addEventListener('click', e => {
    e.stopPropagation()
    $(popupId).hidden = true
    $(btnId).setAttribute('aria-expanded', 'false')
  })
}

wireSketchPopupHover('sketch-settings-wrap', 'sketch-settings-popup', 'sketch-settings-btn')

// ---- 图形弹窗：选图形 → 进入 shape 模式拉框放置 ----
wireSketchPopupHover('sketch-shapes-wrap', 'sketch-shapes-popup', 'sketch-shapes-btn')

$('sketch-shapes-popup').querySelectorAll('.sketch-shape-item').forEach(btn => {
  btn.addEventListener('click', () => {
    sketchPendingShape = btn.dataset.shape
    setSketchMode('shape')
    $('sketch-shapes-popup').hidden = true
    $('sketch-shapes-btn').setAttribute('aria-expanded', 'false')
  })
})

$('btn-sketch-board').addEventListener('click', () => {
  isSketchOpen() ? closeSketchBoard() : openSketchBoard()
})

$('btn-sketch-collapse').addEventListener('click', closeSketchBoard)

;['hand', 'pen', 'eraser'].forEach(m => {
  $('sketch-mode-' + m).addEventListener('click', () => setSketchMode(m))
})
setSketchMode('pen')

$('sketch-clear').addEventListener('click', () => {
  cancelSketchTextInput()
  if (sketchItems.length === 0) return
  sketchItems.length = 0
  sketchSelected = null
  redrawSketch()
  pushSketchHistory()
})

// 导出画板内容为离屏画布：裁剪到内容并集包围盒，白底、无网格/无选中框
function renderSketchToCanvas() {
  if (sketchItems.length === 0) return null
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
  for (const item of sketchItems) {
    const b = itemBounds(item)
    if (b.x < minX) minX = b.x
    if (b.y < minY) minY = b.y
    if (b.x + b.w > maxX) maxX = b.x + b.w
    if (b.y + b.h > maxY) maxY = b.y + b.h
  }
  if (!isFinite(minX)) return null
  const pad = 24 * sketchScale()
  const off = document.createElement('canvas')
  off.width = Math.ceil(maxX - minX + pad * 2)
  off.height = Math.ceil(maxY - minY + pad * 2)
  const ctx = off.getContext('2d')
  ctx.lineCap = 'round'
  ctx.lineJoin = 'round'
  ctx.fillStyle = '#fff'   // 与画板背景一致，保证深色墨迹可见
  ctx.fillRect(0, 0, off.width, off.height)
  // 复用现有绘制函数：临时改 pan，使内容映射进离屏画布
  const savedPanX = sketchPanX, savedPanY = sketchPanY
  sketchPanX = -minX + pad
  sketchPanY = -minY + pad
  for (const item of sketchItems) {
    if (item.type === 'text') drawSketchTextItem(ctx, item)
    else if (item.type === 'image') drawSketchImageItem(ctx, item)
    else if (item.type === 'shape') drawSketchShape(ctx, item)
    else drawSketchStroke(ctx, item)
  }
  sketchPanX = savedPanX
  sketchPanY = savedPanY
  return off
}

$('sketch-capture').addEventListener('click', () => {
  commitSketchTextInput()
  const off = renderSketchToCanvas()
  if (!off) { showToast('画板为空'); return }
  off.toBlob(blob => {
    if (!blob) { showToast('画板导出失败'); return }
    insertImageBlob(blob)
  }, 'image/png')
})

$('sketch-undo').addEventListener('click', sketchUndo)
$('sketch-redo').addEventListener('click', sketchRedo)

function updateSketchGridToggle() {
  $('sketch-grid-toggle').classList.toggle('active', sketchGridOn)
  $('sketch-grid-toggle').setAttribute('aria-pressed', String(sketchGridOn))
}
$('sketch-grid-toggle').addEventListener('click', () => {
  sketchGridOn = !sketchGridOn
  storeSet(SKETCH_GRID_KEY, sketchGridOn ? '1' : '0')
  updateSketchGridToggle()
  if (isSketchOpen()) redrawSketch()
})
sketchGridOn = storeGet(SKETCH_GRID_KEY) === '1'
updateSketchGridToggle()

function sketchEditableTarget(target) {
  const tag = (target.tagName || '').toLowerCase()
  return tag === 'input' || tag === 'textarea' || target.isContentEditable
}

function activateSketchShiftHand() {
  if (sketchShiftReturnMode || sketchMode !== 'pen' || sketchAction) return
  sketchShiftReturnMode = sketchMode
  setSketchMode('hand')
}

function restoreSketchShiftHand() {
  if (!sketchShiftReturnMode) return
  const mode = sketchShiftReturnMode
  sketchShiftReturnMode = null
  sketchShiftRestorePending = false
  setSketchMode(mode)
}

document.addEventListener('keydown', e => {
  if (!isSketchOpen()) return
  if (sketchEditableTarget(e.target)) return   // 不劫持编辑器/文字输入的原生撤销
  if (e.key === 'Delete' || e.key === 'Backspace') {
    if (deleteSketchSelected()) e.preventDefault()
    return
  }
  if (e.key === 'Shift') {
    activateSketchShiftHand()
    return
  }
  if (!(e.ctrlKey || e.metaKey)) return
  const k = e.key.toLowerCase()
  if (k === 'z' && !e.shiftKey) { e.preventDefault(); sketchUndo() }
  else if ((k === 'z' && e.shiftKey) || k === 'y') { e.preventDefault(); sketchRedo() }
})

document.addEventListener('keyup', e => {
  if (e.key !== 'Shift' || !sketchShiftReturnMode) return
  if (sketchAction) {
    sketchShiftRestorePending = true
    return
  }
  restoreSketchShiftHand()
})

document.addEventListener('paste', e => {
  if (!isSketchOpen()) return
  if (sketchEditableTarget(e.target)) return
  const items = Array.from(e.clipboardData?.items || [])
  const imageItem = items.find(item => item.kind === 'file' && item.type.startsWith('image/'))
  if (!imageItem) return
  const file = imageItem.getAsFile()
  if (!file) return
  e.preventDefault()
  pasteSketchImageFile(file)
})

// 初始空状态入栈，作为撤销的终点
pushSketchHistory()

function applySketchWidth(px) {
  const w = Math.max(320, Math.min(window.innerWidth - 56, px))
  $('sketch-panel').style.width = w + 'px'
  return w
}

$('sketch-resize').addEventListener('pointerdown', e => {
  e.preventDefault()
  commitSketchTextInput()
  sketchResizing = true
  if (window.beginEditorLayoutResize) window.beginEditorLayoutResize()
  $('sketch-resize').setPointerCapture(e.pointerId)
})

$('sketch-resize').addEventListener('pointermove', e => {
  if (!sketchResizing) return
  // 面板右缘贴着右侧 28px 宽的竖条，左缘跟随指针
  applySketchWidth(window.innerWidth - 28 - e.clientX)
})

function endSketchResize(e) {
  if (!sketchResizing) return
  sketchResizing = false
  try { $('sketch-resize').releasePointerCapture(e.pointerId) } catch {}
  if (window.endEditorLayoutResize) window.endEditorLayoutResize()
  resizeSketchCanvas()
}

$('sketch-resize').addEventListener('pointerup', endSketchResize)
$('sketch-resize').addEventListener('pointercancel', endSketchResize)

// ---- 画布指针交互 ----

$('sketch-canvas').addEventListener('pointerdown', e => {
  resizeSketchCanvas()
  commitSketchTextInput()
  if (e.shiftKey && sketchMode === 'pen') activateSketchShiftHand()
  $('sketch-canvas').setPointerCapture(e.pointerId)
  const W = sketchWorldFromEvent(e)

  if (sketchMode === 'pen') {
    sketchAction = 'draw'
    sketchHasMoved = false
    sketchStartPoint = W
    sketchLastPoint = W
    sketchCurStroke = {
      type: 'stroke',
      color: $('sketch-color').value,
      size: Number($('sketch-size').value) * sketchScale(),
      points: [W]
    }
    return
  }

  if (sketchMode === 'eraser') {
    sketchAction = 'erase'
    sketchEraseAt(W)
    return
  }

  if (sketchMode === 'shape') {
    sketchAction = 'shape'
    sketchStartPoint = W
    sketchShapeDraft = {
      type: 'shape',
      shape: sketchPendingShape || 'rect',
      x: W.x, y: W.y, w: 0, h: 0,
      color: $('sketch-color').value,
      size: Number($('sketch-size').value) * sketchScale()
    }
    return
  }

  // hand：优先角手柄缩放 → 命中对象则选中并可移动 → 空白则取消选中并平移
  if (sketchSelected) {
    const hi = sketchHandleAt(e)
    if (hi >= 0) { startSketchScale(hi, W); return }
  }
  const hit = sketchItemAt(W)
  if (hit) {
    sketchSelected = hit
    sketchAction = 'move'
    sketchMoveLast = W
    redrawSketch()
    return
  }
  const hadSel = !!sketchSelected
  sketchSelected = null
  sketchAction = 'pan'
  $('sketch-panel').classList.add('panning')
  sketchPanStart = { clientX: e.clientX, clientY: e.clientY, panX: sketchPanX, panY: sketchPanY }
  if (hadSel) redrawSketch()
})

$('sketch-canvas').addEventListener('dblclick', e => {
  e.preventDefault()
  resetSketchInteraction()
  if (sketchMode !== 'pen' && sketchMode !== 'hand') return
  resizeSketchCanvas()
  openSketchTextInput(e)
})

$('sketch-canvas').addEventListener('pointermove', e => {
  if (!sketchAction) {
    if (sketchMode === 'hand') updateHandHoverCursor(e)
    return
  }
  const W = sketchWorldFromEvent(e)

  if (sketchAction === 'draw') {
    if (!sketchLastPoint) return
    if (!sketchHasMoved) {
      const dx = W.x - sketchStartPoint.x
      const dy = W.y - sketchStartPoint.y
      if (Math.hypot(dx, dy) < SKETCH_DRAW_THRESHOLD * sketchScale()) return
      sketchHasMoved = true
    }
    sketchCurStroke.points.push(W)
    strokeSegment(sketchLastPoint, W, sketchCurStroke)
    sketchLastPoint = W
    return
  }

  if (sketchAction === 'erase') { sketchEraseAt(W); return }

  if (sketchAction === 'shape') {
    if (isLineShape(sketchShapeDraft.shape)) {
      // 线型：起点固定，终点跟随，带符号记录方向
      sketchShapeDraft.x = sketchStartPoint.x
      sketchShapeDraft.y = sketchStartPoint.y
      sketchShapeDraft.w = W.x - sketchStartPoint.x
      sketchShapeDraft.h = W.y - sketchStartPoint.y
    } else {
      sketchShapeDraft.x = Math.min(sketchStartPoint.x, W.x)
      sketchShapeDraft.y = Math.min(sketchStartPoint.y, W.y)
      sketchShapeDraft.w = Math.abs(W.x - sketchStartPoint.x)
      sketchShapeDraft.h = Math.abs(W.y - sketchStartPoint.y)
    }
    redrawSketch()
    return
  }

  if (sketchAction === 'pan') {
    const scale = sketchScale()
    sketchPanX = sketchPanStart.panX + (e.clientX - sketchPanStart.clientX) * scale
    sketchPanY = sketchPanStart.panY + (e.clientY - sketchPanStart.clientY) * scale
    redrawSketch()
    return
  }

  if (sketchAction === 'move') {
    moveSketchItem(sketchSelected, W.x - sketchMoveLast.x, W.y - sketchMoveLast.y)
    sketchMoveLast = W
    sketchDirty = true
    redrawSketch()
    return
  }

  if (sketchAction === 'scale') {
    const d = Math.hypot(W.x - sketchScaleData.anchor.x, W.y - sketchScaleData.anchor.y)
    applySketchScale(Math.max(0.05, d / sketchScaleData.origDist))
    sketchDirty = true
    redrawSketch()
  }
})

function endSketchInteraction(e) {
  let changed = false
  if (sketchAction === 'draw' && sketchHasMoved && sketchCurStroke && sketchCurStroke.points.length >= 2) {
    sketchItems.push(sketchCurStroke)
    changed = true
  }
  // 图形拉框结束：达到最小尺寸才落入，随后选中它并切回手型便于立即调整
  if (sketchAction === 'shape' && sketchShapeDraft) {
    const d = sketchShapeDraft
    const min = 3 * sketchScale()
    const ok = isLineShape(d.shape) ? Math.hypot(d.w, d.h) >= min : (d.w >= min && d.h >= min)
    if (ok) {
      sketchItems.push(d)
      resetSketchInteraction()
      sketchSelected = d
      pushSketchHistory()
      setSketchMode('hand')
      try { $('sketch-canvas').releasePointerCapture(e.pointerId) } catch {}
      return
    }
    resetSketchInteraction()
    redrawSketch()
    try { $('sketch-canvas').releasePointerCapture(e.pointerId) } catch {}
    return
  }
  if (sketchDirty) changed = true   // move / scale / erase
  resetSketchInteraction()
  if (changed) pushSketchHistory()
  if (sketchShiftRestorePending) restoreSketchShiftHand()
  try { $('sketch-canvas').releasePointerCapture(e.pointerId) } catch {}
}

$('sketch-canvas').addEventListener('pointerup', endSketchInteraction)
$('sketch-canvas').addEventListener('pointercancel', endSketchInteraction)
