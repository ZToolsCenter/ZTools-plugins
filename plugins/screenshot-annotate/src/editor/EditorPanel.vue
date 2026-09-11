<script setup lang="ts">
import { onBeforeUnmount, onMounted, reactive, ref } from 'vue'
import { EditorController } from './annotation-controller'
import type { ToolKind } from './annotations'

const props = defineProps<{
  dataUrl: string
  width: number
  height: number
  onCopy: (dataURL: string) => void
  onSave: (dataURL: string) => void
  onPin?: (dataURL: string) => void
  onClose: () => void
}>()

const canvasRef = ref<HTMLCanvasElement>()
const stageRef = ref<HTMLElement>()
let ctrl: EditorController | null = null
let source: HTMLImageElement | null = null

// ── 画布视图变换（平移/缩放）。canvas 固有尺寸=图片像素，CSS transform 负责显示缩放与位移。
//    原点为变换中心，getBoundingClientRect 已含变换，localPoint 用 r.width/cv.width 还原 → 坐标映射始终正确。
const view = reactive({ scale: 1, tx: 0, ty: 0 })
let fit = 1 // 当前恰好铺满窗口的基础缩放（随窗口尺寸变化）
let ro: ResizeObserver | null = null

function applyView() {
  const cv = canvasRef.value
  if (cv) {
    cv.style.transform = `translate(${view.tx}px, ${view.ty}px) scale(${view.scale})`
  }
}
function recomputeFit() {
  const stage = stageRef.value
  const cv = canvasRef.value
  if (!stage || !cv || cv.width === 0) return
  const sw = stage.clientWidth
  const sh = stage.clientHeight
  if (!sw || !sh) return
  // 基础缩放 = 铺满；保留当前 zoom 比例 -> 实际 scale = fit * zoomRatio
  const newFit = Math.min(sw / cv.width, sh / cv.height)
  const zoomRatio = view.scale / fit
  fit = newFit
  view.scale = newFit * zoomRatio
  applyView()
}
function zoomBy(factor: number) {
  const stage = stageRef.value
  if (!stage) return
  const min = Math.min(fit * 0.2, 0.1)
  view.scale = Math.max(min, Math.min(fit * 8, view.scale * factor))
  applyView()
}

// 主预览画布：图片像素 = canvas.width，CSS 显示用 contain 缩放
// 工具箱
const tools: { kind: ToolKind; label: string }[] = [
  { kind: 'select', label: '选择/移动' },
  { kind: 'rect', label: '矩形' },
  { kind: 'ellipse', label: '圆形/椭圆' },
  { kind: 'arrow', label: '箭头' },
  { kind: 'pen', label: '画笔' },
  { kind: 'text', label: '文字' },
  { kind: 'serial', label: '序号' },
  { kind: 'mosaic', label: '马赛克' },
  { kind: 'line', label: '直线' },
  { kind: 'highlight', label: '高亮' }
]
/** 每个工具按钮的 SVG path（24×24，stroke 线性） */
const iconPath: Record<ToolKind, string[]> = {
  select: ['M3 3 L21 12 L12.5 13.5 L11 21 Z'],
  pen: ['M3 16 L15 4 L20 4 L20 9 L8 21 L3 21 Z', 'M13 6 L18 11'],
  line: ['M4 20 L20 4'],
  arrow: ['M4 20 L19 5', 'M10 5 H19 V14'],
  rect: ['M5 5 H19 V19 H5 Z'],
  ellipse: ['M12 4 C18.5 4 21 8.5 21 12 C21 15.5 18.5 20 12 20 C5.5 20 3 15.5 3 12 C3 8.5 5.5 4 12 4 Z'],
  highlight: ['M5 6 L19 3 L20.5 8 L6.5 11 Z'],
  text: ['M5 5 H19', 'M12 5 V19'],
  mosaic: ['M6 6 H12 V12 H6 Z', 'M12 6 H18 V12 H12 Z', 'M6 12 H12 V18 H6 Z', 'M12 12 H18 V18 H12 Z'],
  serial: ['M12 4 A8 8 0 0 1 12 20 A8 8 0 0 1 12 4 Z', 'M11 16 V11 L9.5 12.2 V10 L12 8.5 H13.5 V16 Z']
}
/** 自定义取色器当前值（唯一取色方式，默认红色） */
const customColor = ref('#e5484d')
const currentTool = ref<ToolKind>('select')
const color = ref('#e5484d')
const lineWidth = ref(3)
const fill = ref(false)
const textSize = ref(28)
const textBold = ref(false)
/** 当前选中了文字标注（控制工具栏字号/粗体控件显示） */
const selectedIsText = ref(false)
const mosaicShape = ref<'rect' | 'round'>('rect')
const mosaicCell = ref(14)
/** 马赛克涂抹时光标跟随的球/方块预览（canvas 坐标系，null=隐藏） */
const mosaicPreview = ref<{ left: number; top: number; size: number; round: boolean } | null>(null)
const canUndo = ref(false)
const canRedo = ref(false)

// 固定默认值（无可视化设置界面）
const DEFAULT_COLOR = '#e5484d'
const DEFAULT_LINE_WIDTH = 3

// 文字输入浮层
const textInputRef = ref<HTMLTextAreaElement>()

function undo() {
  ctrl?.undo()
  canUndo.value = !!ctrl?.canUndo
  canRedo.value = !!ctrl?.canRedo
}
function redo() {
  ctrl?.redo()
  canUndo.value = !!ctrl?.canUndo
  canRedo.value = !!ctrl?.canRedo
}
function pickTool(t: ToolKind) {
  currentTool.value = t
  ctrl?.setTool(t)
}
function pickColor(c: string) {
  color.value = c
  ctrl?.setColor(c)
  applyStyleToSelectedText({ color: c })
}
function pickWidth(w: number) {
  lineWidth.value = w
  ctrl?.setLineWidth(w)
}
function toggleFill() {
  fill.value = !fill.value
  ctrl?.setFill(fill.value)
}
function pickMosaicShape(s: 'rect' | 'round') {
  mosaicShape.value = s
  ctrl?.setMosaicShape(s)
}
function pickMosaicCell(c: number) {
  mosaicCell.value = c
  ctrl?.setMosaicCell(c)
}
function pickTextSize(s: number) {
  textSize.value = s
  ctrl?.setTextSize(s)
  applyStyleToSelectedText({ size: s })
}
function pickTextBold() {
  textBold.value = !textBold.value
  ctrl?.setTextBold(textBold.value)
  applyStyleToSelectedText({ bold: textBold.value })
}

/** 若选中了文字，把样式变更应用到它；新建文字仍由 setTextSize/setTextBold/setColor 覆盖默认值 */
function applyStyleToSelectedText(partial: { size?: number; bold?: boolean; color?: string }) {
  const applied = ctrl?.applyStyleToSelected(partial)
  if (applied) syncTextStyleFromSelection()
}

/** 从当前选中的文字同步工具栏回显（选中的字号/粗体/颜色） */
function syncTextStyleFromSelection() {
  const st = ctrl?.getSelectedTextStyle()
  if (st) {
    textSize.value = st.size
    textBold.value = !!st.bold
    color.value = st.color
    selectedIsText.value = true
  } else {
    selectedIsText.value = false
  }
}

// 文字输入状态：定位到选中框内（居中浮层 → 改为画布框内）+ 落地
const showTextDialog = ref(false)
const editingText = ref('')
/** 就地编辑层在 canvas-wrap 内的 CSS 坐标（由文字框/落点图片像素折算） */
const textPosCss = ref({ left: 0, top: 0, width: 200, height: 40 })

function commitText() {
  if (!ctrl) return
  ctrl.commitText(editingText.value)
  showTextDialog.value = false
}
function cancelText() {
  showTextDialog.value = false
  ctrl?.cancelText()
}

/** 把图片像素坐标折算成 canvas-wrap 内 CSS 坐标（带 view scale/translate） */
function openTextInput(rect: { x: number; y: number; w: number; h: number }) {
  const cv = canvasRef.value
  const stage = stageRef.value
  if (!cv || !stage) return
  const cr = cv.getBoundingClientRect()
  const sr = stage.getBoundingClientRect()
  const sx = cr.width / cv.width
  const sy = cr.height / cv.height
  textPosCss.value = {
    left: cr.left - sr.left + rect.x * sx,
    top: cr.top - sr.top + rect.y * sy,
    width: Math.max(120, rect.w * sx),
    height: Math.max(28, rect.h * sy)
  }
  // 正在重编辑文字时回填其内容
  const sel = ctrl?.selected
  editingText.value = sel && (sel.type === 'text' || sel.type === 'serial') ? sel.text : ''
  showTextDialog.value = true
  setTimeout(() => textInputRef.value?.focus(), 10)
}

/** 画布上双击：若命中的是文字/序号标注，进入就原框就地编辑 */
function onDblClick(e: PointerEvent | MouseEvent) {
  if (!ctrl) return
  const p = localPoint(e as PointerEvent)
  ctrl.selectAt(p.x, p.y)
  const sel = ctrl.selected
  if (sel && (sel.type === 'text' || sel.type === 'serial')) {
    ctrl.startEditSelectedText()
  }
}

function localPoint(e: PointerEvent): { x: number; y: number } {
  const cv = canvasRef.value!
  const r = cv.getBoundingClientRect()
  return {
    x: ((e.clientX - r.left) * cv.width) / r.width,
    y: ((e.clientY - r.top) * cv.height) / r.height
  }
}

// ── 平移 / 绘制模式切换 ──
// ── 图片区手势：点击=绘制（两点式），拖动=移动整个窗口 ──
const winId = new URLSearchParams(window.location.search).get('win') || ''
let dragging = false
let dragMoved = false
let dragStartX = 0
let dragStartY = 0
let lastX = 0
let lastY = 0

/**
 * 拖动"窗口"采用屏幕绝对坐标定位，彻底规避回环震动：
 *  `screenX - clientX` 恒等于窗口左上角屏幕坐标（frame:false 窗口），
 * 它由指针绝对位置算出，**不含任何窗口当前位置**，窗口被 setPosition 移动后
 * 不会反馋进下一次目标计算（clientX 增量方案会：窗口一动 clientX 就反向变化 → 窗口往返震）。
 * flushMove 只在目标坐标变化时才 setPosition（静止零 IPC、零重绘）。
 */
let moveTargetX = 0
let moveTargetY = 0
let rafPending = false
/** 拖动开始时指针相对窗口的位置（固定基准）。移窗用 startClient 而非实时 e.clientX：
 *  实时 clientX 随窗口移动变化，与 screenX 同步相减后得到"窗口当前位置"常数 → setPosition(原位) 永远移不动（拖不动）。
 *  用固定 startClient 则目标随 screenX 单调变化 → 窗口跟随移动。 */
let winStartClientX = 0
let winStartClientY = 0
/** 当前拖动手势类型：无 / 移窗 / 拖动选中标注 / 拖缩放手柄改大小 */
let dragType: 'none' | 'window' | 'annotation' | 'resize' | 'mosaic' = 'none'

/** 经 sendToParent 送主窗口移动编辑器窗口到绝对屏幕坐标（子窗口无法直接操作主窗口建的窗口） */
function moveEditorWindow(x: number, y: number) {
  const anyZtools = window.ztools as unknown as {
    sendToParent?: (channel: string, ...args: unknown[]) => void
  }
  if (winId && typeof anyZtools.sendToParent === 'function') {
    anyZtools.sendToParent('screenshot-annotate:editor-move', { winId, x: Math.round(x), y: Math.round(y) })
  }
}

/** 移窗：把最新绝对目标发给窗口落位（pointermove 只在指针真正移动时触发，被调度即已动过，直接发） */
function flushMove() {
  rafPending = false
  // 不做 `target===lastSent` 去重：在坐标恒等于初始值时会永远拦截、把窗口钉死原地（"完全拖不动"）。
  // rAF 节流本身已保证静止（无 pointermove）不产生 IPC。
  moveEditorWindow(moveTargetX, moveTargetY)
}
function onDown(e: PointerEvent) {
  // 文字输入框打开时，点击画布任意处（输入框外）→ 直接保存
  if (showTextDialog.value && !(e.target as HTMLElement).closest('.text-dialog')) {
    commitText()
    return
  }
  // 捕获指针：即使移出画布也持续收到 pointermove/pointerup，避免拖窗时松开在窗外导致 mouseup 丢失
  try {
    canvasRef.value?.setPointerCapture(e.pointerId)
  } catch {
    /* 捕获失败不影响后续（onMove 另有 buttons 兜底） */
  }
  dragging = true
  dragMoved = false
  dragStartX = e.clientX
  dragStartY = e.clientY
  lastX = e.clientX
  lastY = e.clientY
  // 记录移动窗口专用的固定基准（避免拖窗分支反复用实时 e.clientX 导致目标恒为原位）
  winStartClientX = e.clientX
  winStartClientY = e.clientY
  // 初始化绝对定位基准：当前窗口左上角屏幕坐标 = screenX - clientX
  moveTargetX = e.screenX - winStartClientX
  moveTargetY = e.screenY - winStartClientY
  // 微信截图式：不切工具也能直接跟手拖/缩放已存在的标注。指针按下先全局命中已有标注：
  //   - 命中 → 选中；若落在其缩放手柄上 → `resize`（改大小），否则跟手移动（文字后续可单击编辑）
  //   - 未命中 → 按当前工具：select 拖窗口，绘制/文字工具正常作画
  // 用 selectAt（命中即选中）而非 beginDragSelected（要求"已选中"）：首击点到未选中标注时
  // beginDragSelected 返回 false 会误拖整窗 → 选不中原 bug。selectAt 命中首击即选中。
  const p = localPoint(e)
  // 马赛克：自由涂抹，按下即沿轨迹打码，不做"点击已有标注→拖动/缩放"的命中判定
  if (currentTool.value === 'mosaic') {
    dragType = 'mosaic'
    ctrl?.pointerDown(p.x, p.y)
    return
  }
  if (ctrl?.selectAt(p.x, p.y)) {
    if (ctrl?.hitHandleAt(p.x, p.y) && ctrl.beginResize(p.x, p.y)) {
      dragType = 'resize'
    } else {
      dragType = 'annotation'
    }
  } else if (currentTool.value === 'select') {
    dragType = 'window'
  } else {
    dragType = 'none'
    ctrl?.pointerDown(p.x, p.y)
  }
}
/** 强制结束本次拖拽：左键已松开（mouseup 丢失兜底），复位拖动状态、停止窗口/标注移动 */
function forceEndDrag(pointerId?: number) {
  if (dragType === 'annotation' && dragMoved) ctrl?.endDragSelected()
  if (dragType === 'resize' && dragMoved) ctrl?.endResize()
  dragType = 'none'
  dragging = false
  dragMoved = false
  if (pointerId !== undefined) {
    try {
      canvasRef.value?.releasePointerCapture(pointerId)
    } catch {
      /* 忽略 */
    }
  }
}

/** 马赛克工具：光标跟随的球/方块预览（随指针与 cell 大小更新），非马赛克时隐藏 */
function updateMosaicPreview(e: PointerEvent) {
  const cv = canvasRef.value
  const stage = stageRef.value
  if (!cv || !stage || currentTool.value !== 'mosaic' || !ctrl) {
    mosaicPreview.value = null
    return
  }
  const cr = cv.getBoundingClientRect()
  const sr = stage.getBoundingClientRect()
  const sx = cr.width / cv.width
  const cell = Math.max(6, ctrl.settings.mosaicCell)
  const p = localPoint(e)
  const size = cell * sx
  mosaicPreview.value = {
    left: cr.left - sr.left + p.x * sx - size / 2,
    top: cr.top - sr.top + p.y * sx - size / 2,
    size,
    round: ctrl.settings.mosaicShape === 'round'
  }
}
function clearMosaicPreview() {
  mosaicPreview.value = null
}

function onMove(e: PointerEvent) {
  updateMosaicPreview(e)
  const cv = canvasRef.value
  if (!dragging) {
    // 未拖动：hover 在选中标注的缩放手柄上 → 显示缩放光标（line/arrow 端点用移动光标）
    if (cv) {
      const p = localPoint(e)
      const onHandle = !!(ctrl?.selected && ctrl?.hitHandleAt(p.x, p.y))
      const selType = ctrl?.selected?.type
      // 马赛克：隐藏系统光标，由 mosaic-preview 圆/方颗粒跟随充当自定义光标
      if (currentTool.value === 'mosaic') {
        cv.style.cursor = 'none'
      } else {
        cv.style.cursor = onHandle && selType !== 'line' && selType !== 'arrow' ? 'nwse-resize' : 'crosshair'
      }
    }
    return
  }
  // 兜底：左键实际已松开（e.buttons 左键位为 0）但 pointerup 丢失 → 强制复位，防拖窗残留闪烁
  if (e.buttons !== undefined && (e.buttons & 1) === 0) {
    forceEndDrag(e.pointerId)
    return
  }
  // 位移阈值界定是否算拖动（拖窗/拖标注区分单击）
  if (dragType !== 'none' && !dragMoved &&
      Math.abs(e.clientX - dragStartX) + Math.abs(e.clientY - dragStartY) > 4) {
    dragMoved = true
  }
  if (dragType === 'annotation') {
    // 拖动选中标注：屏px 转为画布像素增量（除以缩放），纯本地移动零 IPC
    if (!dragMoved) return
    const dx = e.clientX - lastX
    const dy = e.clientY - lastY
    lastX = e.clientX
    lastY = e.clientY
    const s = Math.max(view.scale, 0.01)
    ctrl?.moveSelectedBy(dx / s, dy / s)
    return
  }
  if (dragType === 'resize') {
    // 拖缩放手柄：指针画布坐标直接交给 controller 按锚点缩放
    if (!dragMoved) return
    const p = localPoint(e)
    ctrl?.resizeTo(p.x, p.y)
    return
  }
  if (dragType === 'window') {
    // 拖窗口：目标 = screenX - 固定基准 winStartClient（非实时 e.clientX），
    // 使目标随指针屏幕位置单调变化（跟随移动），避免实时 clientX 抵消 → 目标恒原位 → 拖不动
    moveTargetX = e.screenX - winStartClientX
    moveTargetY = e.screenY - winStartClientY
    if (!rafPending) {
      rafPending = true
      requestAnimationFrame(flushMove)
    }
    return
  }
  // 绘制工具：实时绘制
  const p = localPoint(e)
  ctrl?.pointerMove(p.x, p.y)
}
function onUp(e: PointerEvent) {
  dragging = false
  if (dragType === 'annotation') {
    if (dragMoved) {
      ctrl?.endDragSelected()
    }
    // 单击未拖：仅保持选中；双击（onDblClick）才进就原框就地编辑
    dragType = 'none'
    canUndo.value = !!ctrl?.canUndo
    canRedo.value = !!ctrl?.canRedo
    return
  }
  if (dragType === 'window') {
    dragType = 'none'
    // 把最后一次未提交的目标发出，避免拖尾残留
    if (rafPending) {
      rafPending = false
      flushMove()
    }
    return
  }
  if (dragType === 'resize') {
    // 缩放结束（拖前状态已在首次 move 入栈；纯单击未拖则无副作用）
    ctrl?.endResize()
    dragType = 'none'
    canUndo.value = !!ctrl?.canUndo
    canRedo.value = !!ctrl?.canRedo
    return
  }
  dragType = 'none'
  ctrl?.pointerUp()
  canUndo.value = !!ctrl?.canUndo
  canRedo.value = !!ctrl?.canRedo
}
function onWheel(e: WheelEvent) {
  e.preventDefault()
  zoomBy(e.deltaY < 0 ? 1.15 : 1 / 1.15)
}

function exportDataURL(): string {
  return ctrl!.canvasElement.toDataURL('image/png')
}

/** 数字/字母键 → 工具映射（仅当焦点不在输入框内时生效） */
const toolKeyMap: Record<string, ToolKind> = {
  '1': 'select',
  '2': 'rect',
  '3': 'ellipse',
  '4': 'arrow',
  '5': 'pen',
  '6': 'text',
  '7': 'serial',
  '8': 'mosaic',
  '9': 'line',
  '0': 'highlight',
  v: 'select',
  r: 'rect',
  o: 'ellipse',
  a: 'arrow',
  b: 'pen',
  t: 'text',
  s: 'serial',
  m: 'mosaic',
  l: 'line',
  h: 'highlight'
}

/** 焦点是否在可编辑元素里（数字/颜色输入、文字输入框）——此时不拦截按键 */
function focusIsEditable(): boolean {
  const t = document.activeElement
  if (!t) return false
  const tag = t.tagName
  return tag === 'INPUT' || tag === 'TEXTAREA' || (t as HTMLElement).isContentEditable
}

/**
 * 全局按键（焦点不在输入框内时）：
 *   Esc 关闭；Delete/Backspace 删除选中；Ctrl+Z/Y 撤销/重做；Ctrl+C 复制；Ctrl+S 保存；
 *   Ctrl+P 钉图；数字/字母键切换工具。
 */
function onGlobalKey(e: KeyboardEvent) {
  if (focusIsEditable()) return
  const k = e.key
  if (k === 'Escape') {
    props.onClose()
    return
  }
  if (e.ctrlKey || e.metaKey) {
    const lk = k.toLowerCase()
    if (lk === 'z') {
      e.preventDefault()
      undo()
      return
    }
    if (lk === 'y') {
      e.preventDefault()
      redo()
      return
    }
    if (lk === 'c') {
      e.preventDefault()
      props.onCopy(exportDataURL())
      return
    }
    if (lk === 's') {
      e.preventDefault()
      props.onSave(exportDataURL())
      return
    }
    // Ctrl+P：钉图
    if (lk === 'p') {
      e.preventDefault()
      props.onPin?.(exportDataURL())
      return
    }
    return
  }
  if (k === 'Delete' || k === 'Backspace') {
    e.preventDefault()
    ctrl?.deleteSelected()
    canUndo.value = !!ctrl?.canUndo
    canRedo.value = !!ctrl?.canRedo
    return
  }
  // 数字/字母键切换工具
  const mapped = toolKeyMap[k.toLowerCase()]
  if (mapped) {
    pickTool(mapped)
  }
}

/** 应用固定默认颜色/线宽（若已实例化 ctrl 立即同步） */
function applySettings() {
  if (!ctrl) return
  color.value = DEFAULT_COLOR
  lineWidth.value = DEFAULT_LINE_WIDTH
  ctrl.setColor(DEFAULT_COLOR)
  ctrl.setLineWidth(DEFAULT_LINE_WIDTH)
}

onMounted(() => {
  const img = document.createElement('img')
  img.onload = () => {
    source = img
    const cv = canvasRef.value!
    ctrl = new EditorController(cv, img, props.width, props.height)
    ctrl.onTextRequest = openTextInput
    ctrl.onSelectionChange = syncTextStyleFromSelection
    applySettings()
    ctrl.render()
    recomputeFit()
  }
  img.src = props.dataUrl
  recomputeFit()
  // 窗口尺寸变化时重算铺满基础缩放；首次给一次延迟确保布局就绪
  const stage = stageRef.value
  if (stage) {
    ro = new ResizeObserver(() => recomputeFit())
    ro.observe(stage)
  }
  window.addEventListener('keydown', onGlobalKey)
})

onBeforeUnmount(() => {
  window.removeEventListener('keydown', onGlobalKey)
  ro?.disconnect()
  ctrl = null
  source = null
})

defineExpose({ exportDataURL })
</script>

<template>
  <div class="editor-canvas-stage">
    <div ref="stageRef" class="canvas-wrap">
      <div
        v-if="showTextDialog"
        class="text-dialog"
        :style="{ left: textPosCss.left + 'px', top: textPosCss.top + 'px', width: textPosCss.width + 'px', height: textPosCss.height + 'px' }"
      >
        <textarea
          ref="textInputRef"
          v-model="editingText"
          class="text-input"
          rows="1"
          placeholder="输入文字，回车确认"
          :style="{ color, fontSize: `${Math.round(textSize / Math.max(view.scale, 0.2))}px`, fontWeight: textBold ? 'bold' : 'normal' }"
          @keydown.enter.prevent="commitText"
          @keydown.esc="cancelText"
          @blur="commitText"
        />
      </div>
      <canvas
        ref="canvasRef"
        class="editor-canvas"
        :style="{ transform: `translate(${view.tx}px, ${view.ty}px) scale(${view.scale})` }"
        @pointerdown="onDown"
        @pointermove="onMove"
        @pointerup="onUp"
        @dblclick="onDblClick"
        @wheel="onWheel"
        @mouseleave="clearMosaicPreview"
      />
      <div
        v-if="mosaicPreview"
        class="mosaic-preview"
        :class="{ round: mosaicPreview.round }"
        :style="{ left: mosaicPreview.left + 'px', top: mosaicPreview.top + 'px', width: mosaicPreview.size + 'px', height: mosaicPreview.size + 'px' }"
      />
    </div>

    <div class="wx-toolbar">
      <!-- 顶部第 1 组：工具图标 -->
      <div class="tb-group">
        <button
          v-for="t in tools"
          :key="t.kind"
          class="tb-icon"
          :class="{ on: currentTool === t.kind }"
          :title="t.label"
          @click="pickTool(t.kind)"
        >
          <svg viewBox="0 0 24 24" class="tb-svg">
            <path v-for="(d, i) in iconPath[t.kind]" :key="i" :d="d" />
          </svg>
        </button>
      </div>

      <div class="tb-line" />

      <!-- 撤销/重做 -->
      <div class="tb-group">
        <button class="tb-icon" :disabled="!canUndo" title="撤销 (Ctrl+Z)" @click="undo">
          <svg viewBox="0 0 24 24" class="tb-svg"><path d="M8 5 L3 10 L8 15" /><path d="M4 10 H16 A4 4 0 0 1 16 18 H12" /></svg>
        </button>
        <button class="tb-icon" :disabled="!canRedo" title="重做 (Ctrl+Y)" @click="redo">
          <svg viewBox="0 0 24 24" class="tb-svg"><path d="M16 5 L21 10 L16 15" /><path d="M20 10 H8 A4 4 0 0 0 8 18 H12" /></svg>
        </button>
      </div>

      <div class="tb-line" />

      <div class="tb-spacer" />

      <!-- 底部操作：取消/复制/保存/钉图 -->
      <div class="tb-group">
        <button class="tb-icon danger" title="取消 (Esc)" @click="props.onClose">
          <svg viewBox="0 0 24 24" class="tb-svg"><path d="M6 6 L18 18 M18 6 L6 18" /></svg>
        </button>
        <button class="tb-icon primary" title="复制 (Ctrl+C)" @click="props.onCopy(exportDataURL())">
          <svg viewBox="0 0 24 24" class="tb-svg"><rect x="8" y="8" width="12" height="12" /><path d="M4 16 V4 H16" /></svg>
        </button>
        <button class="tb-icon primary" title="保存 (Ctrl+S)" @click="props.onSave(exportDataURL())">
          <svg viewBox="0 0 24 24" class="tb-svg"><path d="M12 4 V16 M6 11 L12 17 L18 11" /><path d="M4 19 V20 H20 V19" /></svg>
        </button>
        <button v-if="props.onPin" class="tb-icon primary" title="钉图 (Ctrl+P)" @click="props.onPin!(exportDataURL())">
          <svg viewBox="0 0 24 24" class="tb-svg"><path d="M8 21 L9 16 L5 12 V10 H19 V12 L15 16 L16 21 Z" /></svg>
        </button>
      </div>
    </div>

    <!-- 工具定制条（仿微信：选中需要定制的工具时，在菜单栏正下方滑出的专属选项条） -->
    <Transition name="wx-subbar">
      <div
        v-if="
          currentTool === 'mosaic' ||
          currentTool === 'rect' || currentTool === 'ellipse' || currentTool === 'arrow' ||
          currentTool === 'pen' || currentTool === 'line' || currentTool === 'highlight' ||
          currentTool === 'text' || currentTool === 'serial' || selectedIsText
        "
        class="wx-subbar"
      >
        <template v-if="currentTool === 'mosaic'">
          <span class="subbar-label">马赛克</span>
          <button class="tb-icon subbar-btn" :class="{ on: mosaicShape === 'rect' }" title="方格" @click="pickMosaicShape('rect')">
            <svg viewBox="0 0 24 24" class="tb-svg"><path d="M4 4 H20 V20 H4 Z M4 12 H20 M12 4 V20" /></svg>
          </button>
          <button class="tb-icon subbar-btn" :class="{ on: mosaicShape === 'round' }" title="球状" @click="pickMosaicShape('round')">
            <svg viewBox="0 0 24 24" class="tb-svg"><path d="M12 4 A8 8 0 0 1 12 20 A8 8 0 0 1 12 4 Z M7 7 H17 M7 12 H17 M7 17 H17 M12 7 V17" /></svg>
          </button>
          <span class="subbar-sep" />
          <input
            v-model.number="mosaicCell"
            class="num-input"
            type="number"
            min="4"
            max="80"
            title="马赛克格大小(px)"
            @change="pickMosaicCell(Number(mosaicCell) || 14)"
          />
          <span class="num-label">px</span>
        </template>

        <template v-else>
          <span v-if="selectedIsText" class="subbar-label">标注</span>
          <label class="custom-color" title="自定义颜色">
            <input
              v-model="customColor"
              type="color"
              @input="pickColor(customColor)"
            />
          </label>
          <span class="subbar-sep" />
          <input
            v-model.number="lineWidth"
            class="num-input"
            type="number"
            min="1"
            max="40"
            title="线宽(px)"
            @change="pickWidth(Number(lineWidth) || 3)"
          />
          <span class="num-label">px</span>
          <button class="tb-icon subbar-btn" :class="{ on: fill }" title="填充" @click="toggleFill">
            <svg viewBox="0 0 24 24" class="tb-svg"><path d="M4 6 H20 V12 H4 Z M4 14 H20 V18 H4 Z" /></svg>
          </button>
          <template v-if="currentTool === 'text' || currentTool === 'serial' || selectedIsText">
            <span class="subbar-sep" />
            <button class="tb-icon subbar-btn" :class="{ on: textBold }" title="粗体" @click="pickTextBold">
              <svg viewBox="0 0 24 24" class="tb-svg"><path d="M7 4 H14 A3.5 3.5 0 0 1 14 11 H7 Z M7 11 H15 A3 3 0 0 1 15 18 H7 Z" /></svg>
            </button>
            <input
              v-model.number="textSize"
              class="num-input"
              type="number"
              min="12"
              max="96"
              title="字号"
              @change="pickTextSize(Number(textSize) || 28)"
            />
            <span class="num-label">px</span>
          </template>
        </template>
      </div>
    </Transition>
  </div>
</template>

<style scoped>
/* ── 透明承载窗口（截图标注编辑）── */
.editor-canvas-stage {
  position: relative;
  width: 100%;
  height: 100%;
  display: flex;
  flex-direction: column;
  /* 透明：图片与底部悬浮工具条之间、四周均为可见透明区，构成"图片外独立窗口"的观感 */
  background: transparent;
  overflow: hidden;
  user-select: none;
}
/* 图片区 + 图片四周的透明留白：透明留白设为可拖拽区（-webkit-app-region drag），
   用户可从这里拖动整个窗口；canvas 本身 no-drag 覆盖，保证绘制/选择不被拖拽拦截 */
.canvas-wrap {
  flex: 1;
  min-height: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  overflow: hidden;
  -webkit-app-region: drag;
}
/* 图片区域：圆角 + 阴影悬浮于透明窗口之上，类似 shortcut-capture 的图片卡片 */
.editor-canvas {
  display: block;
  background: #000;
  cursor: crosshair;
  border-radius: 8px;
  box-shadow: 0 8px 28px rgba(0, 0, 0, 0.28);
  transform-origin: center center;
  touch-action: none;
  -webkit-app-region: no-drag;
}
/* 马赛克涂抹光标预览：跟随鼠标的球/方块（形状随 tangent 配置） */
.mosaic-preview {
  position: absolute;
  z-index: 25;
  pointer-events: none;
  box-sizing: border-box;
  border: 1.5px solid rgba(58, 118, 240, 0.9);
  background: rgba(58, 118, 240, 0.18);
  border-radius: 2px;
}
.mosaic-preview.round {
  border-radius: 50%;
}
/* 就地编辑层：覆盖在文字原包围盒上方，透明背景 + 虚线蓝框，「所见即所得」在原框修改 */
.text-dialog {
  position: absolute;
  z-index: 30;
  transform-origin: 0 0;
  min-height: 38px;
  -webkit-app-region: no-drag;
}
.text-input {
  box-sizing: border-box;
  width: 100%;
  min-height: 100%;
  margin: 0;
  padding: 0;
  background: transparent;
  color: var(--edit-color, #fff);
  border: 1.5px dashed #3a76f0;
  border-radius: 3px;
  outline: none;
  font-family: sans-serif;
  line-height: 1.2;
  resize: none;
  white-space: pre-wrap;
  word-break: break-all;
  overflow: auto;
  text-align: left;
  caret-color: #3a76f0;
}
.text-input::placeholder {
  color: rgba(255, 255, 255, 0.55);
}

/* ── 独立悬浮工具条（仿 shortcut-capture）：位于图片下方透明区、与图片分离的毛玻璃条 ── */
.wx-toolbar {
  flex: 0 0 auto;
  z-index: 20;
  display: flex;
  flex-direction: row;
  flex-wrap: wrap;
  justify-content: center;
  align-items: center;
  gap: 6px;
  width: fit-content;
  max-width: calc(100% - 16px);
  margin: 2px auto 12px;
  padding: 8px 12px;
  border-radius: 10px;
  background: rgba(20, 22, 28, 0.88);
  border: 1px solid rgba(255, 255, 255, 0.1);
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.32);
  backdrop-filter: blur(16px) saturate(1.3);
  -webkit-backdrop-filter: blur(16px) saturate(1.3);
  -webkit-app-region: no-drag;
  user-select: none;
}
.tb-group {
  display: flex;
  flex-direction: row;
  align-items: center;
  gap: 2px;
}
.tb-line {
  width: 1px;
  height: 24px;
  background: rgba(255, 255, 255, 0.16);
  margin: 0 4px;
}
.tb-spacer {
  width: 6px;
}
/* 工具定制条（仿微信）：出现在主菜单栏正下方，选中需要定制的工具才滑出 */
.wx-subbar {
  flex: 0 0 auto;
  z-index: 19;
  display: flex;
  flex-direction: row;
  align-items: center;
  justify-content: center;
  gap: 8px;
  width: fit-content;
  max-width: calc(100% - 16px);
  margin: -4px auto 12px;
  padding: 6px 14px;
  border-radius: 10px;
  background: rgba(28, 30, 38, 0.82);
  border: 1px solid rgba(255, 255, 255, 0.08);
  box-shadow: 0 6px 18px rgba(0, 0, 0, 0.28);
  backdrop-filter: blur(12px) saturate(1.3);
  -webkit-backdrop-filter: blur(12px) saturate(1.3);
  -webkit-app-region: no-drag;
  user-select: none;
}
.subbar-label {
  font-size: 12px;
  color: #8a90a0;
  margin-right: 2px;
}
.subbar-btn {
  width: 32px;
  height: 32px;
  margin: 0;
}
.subbar-sep {
  width: 1px;
  height: 18px;
  background: rgba(255, 255, 255, 0.14);
  margin: 0 2px;
}
/* 滑出/收起过渡 */
.wx-subbar-enter-active,
.wx-subbar-leave-active {
  transition: opacity 0.18s ease, transform 0.18s ease;
}
.wx-subbar-enter-from,
.wx-subbar-leave-to {
  opacity: 0;
  transform: translateY(-8px);
}
.tb-icon {
  width: 36px;
  height: 36px;
  margin: 1px;
  display: flex;
  align-items: center;
  justify-content: center;
  border: none;
  background: transparent;
  color: #c8ccd4;
  border-radius: 9px;
  cursor: pointer;
  transition: background 0.15s, color 0.15s;
  -webkit-app-region: no-drag;
}
.tb-icon:hover {
  background: rgba(255, 255, 255, 0.1);
  color: #fff;
}
.tb-icon.on {
  background: #3a76f0;
  color: #fff;
}
.tb-icon.danger:hover {
  background: #e5484d;
  color: #fff;
}
.tb-icon.primary {
  color: #fff;
}
.tb-icon.primary:hover {
  background: rgba(255, 255, 255, 0.14);
}
.tb-icon:disabled {
  opacity: 0.3;
  cursor: default;
  background: transparent;
}
.tb-svg {
  width: 21px;
  height: 21px;
  fill: none;
  stroke: currentColor;
  stroke-width: 1.8;
  stroke-linecap: round;
  stroke-linejoin: round;
}
/* 自定义取色器：彩虹渐变指示条 + 原生 color 输入，点击打开系统色板 */
.custom-color {
  position: relative;
  width: 20px;
  height: 20px;
  margin: 0 2px;
  border-radius: 50%;
  border: 1px solid rgba(255, 255, 255, 0.25);
  overflow: hidden;
  cursor: pointer;
  background: conic-gradient(
    #ff0000, #ffff00, #00ff00, #00ffff, #0000ff, #ff00ff, #ff0000
  );
  box-shadow: inset 0 0 0 1px rgba(0, 0, 0, 0.2);
  -webkit-app-region: no-drag;
}
.custom-color input {
  position: absolute;
  inset: -10px;
  width: 40px;
  height: 40px;
  border: 0;
  padding: 0;
  opacity: 0;
  cursor: pointer;
  -webkit-app-region: no-drag;
}
/* 数字输入框：线宽/字号动态调节 */
.num-input {
  width: 52px;
  height: 30px;
  margin: 0 2px;
  padding: 0 6px;
  box-sizing: border-box;
  border: 1px solid rgba(255, 255, 255, 0.2);
  border-radius: 8px;
  background: rgba(255, 255, 255, 0.08);
  color: #e6e9ef;
  font-size: 12px;
  text-align: center;
  outline: none;
  -webkit-app-region: no-drag;
}
.num-input:focus {
  border-color: #3a76f0;
  background: rgba(58, 118, 240, 0.15);
}
.num-label {
  color: #8b93a1;
  font-size: 11px;
  margin-left: 2px;
}
/* 线宽小号 */
.tb-w {
  min-width: 30px;
  height: 30px;
  padding: 0 6px;
  display: flex;
  align-items: center;
  justify-content: center;
  border: none;
  background: transparent;
  color: #c8ccd4;
  border-radius: 8px;
  font-size: 12px;
  cursor: pointer;
  -webkit-app-region: no-drag;
}
.tb-w:hover {
  background: rgba(255, 255, 255, 0.1);
  color: #fff;
}
.tb-w.on {
  background: #3a76f0;
  color: #fff;
}
</style>