import type { Canvas, Control, FabricObject, Point } from 'fabric'
import { computed, ref, shallowRef, type ComputedRef, type Ref, type ShallowRef } from 'vue'
import type { ArrowRenderMode, EditablePathObject, EditableSegmentRef } from '../../../geometry/editablePath'
import type { FabricControls } from '../../../types'
import type { EditorModule } from '../../runtime/editorTypes'

type HomeDirectEditSelectionMode = 'shape' | 'point' | 'segment'

type PointGestureSource = 'blank' | 'point-control'
type PointGestureKind = 'none' | 'pending' | 'box-select' | 'single-drag' | 'group-drag'

type PointGestureState = {
  active: boolean
  source: PointGestureSource
  kind: PointGestureKind
  modifierAtStart: boolean
  startedFromSelectedPoint: boolean
  startPointIndex: number | null
  initialSelection: number[]
  startViewport: { x: number; y: number } | null
  currentViewport: { x: number; y: number } | null
  startScene: { x: number; y: number } | null
  currentScene: { x: number; y: number } | null
  previewHitIndices: number[]
  thresholdExceeded: boolean
  pendingCollapseIndex: number | null
  preDragSelection: number[] | null
}

type CanvasAssistColors = {
  primary: string
  primarySoft: string
  primaryOverlay: string
  primaryStrong: string
  textOnPrimary: string
}

type CanvasPointerEventLike = {
  viewportPoint?: Point
  scenePoint?: Point
  e: MouseEvent | TouchEvent
}

const POINT_GESTURE_DRAG_THRESHOLD = 4

export interface HomeDirectEditState {
  activeEditablePathObject: ComputedRef<EditablePathObject | null>
  editablePathMetadataVersion: Ref<number>
  hasEditablePoints: ComputedRef<boolean>
  hasSelectedPoint: ComputedRef<boolean>
  pointGestureRenderTick: Ref<number>
  selectedEditableSegment: ComputedRef<EditableSegmentRef | null>
  selectedPointIndex: ComputedRef<number | null>
  selectedPointIndices: Ref<number[]>
  selectedSegmentRef: ShallowRef<EditableSegmentRef | null>
  selectionMode: Ref<HomeDirectEditSelectionMode>
}

export interface HomeDirectEditCommands {
  beginBlankPointGesture: (event: MouseEvent | TouchEvent | null | undefined) => void
  beginPointControlGesture: (editable: EditablePathObject, pointIndex: number, event: MouseEvent | TouchEvent | null | undefined) => void
  bumpPointGestureRender: () => void
  clearEditableAssistSelection: () => void
  clearPointEditing: () => void
  clearSelectedPoint: () => void
  clearSelectedSegment: () => void
  cloneCurrentControls: (owner: FabricObject) => FabricControls
  consumePointModeSwitchPending: () => boolean
  consumeRestoreActiveObjectAfterSelectionClear: () => boolean
  drawPointGestureMarquee: () => void
  finishPointGesture: () => void
  getLiveEditableSegmentRef: (segmentRef: EditableSegmentRef | null) => EditableSegmentRef | null
  getPointGestureState: () => Readonly<PointGestureState>
  handlePointGestureCanvasMove: (event: CanvasPointerEventLike) => void
  installTemporaryControls: (owner: FabricObject, controls: FabricControls, options?: { hideBorders?: boolean }) => void
  isMultiSelectModifierPressed: (event?: Partial<Pick<MouseEvent, 'ctrlKey' | 'shiftKey' | 'metaKey'>> | null) => boolean
  isPointGestureActive: () => boolean
  isPointModeSwitchPending: () => boolean
  isRestoreActiveObjectAfterSelectionClear: () => boolean
  normalizeSelectedPointIndices: (obj: EditablePathObject, indices: number[]) => number[]
  updatePointGestureFromCanvasCoord: (x: number, y: number) => void
  refreshEditablePathMetadata: () => void
  renderPointControl: (this: Control & { pointIndex?: number }, ctx: CanvasRenderingContext2D, left: number, top: number) => void
  resetPointGestureState: () => void
  restorePointControls: () => void
  selectEditablePoint: (obj: EditablePathObject, pointIndex: number, multi?: boolean) => void
  setPointModeSwitchPending: (value?: boolean) => void
  setRestoreActiveObjectAfterSelectionClear: (value?: boolean) => void
  setSelectedEditablePoints: (obj: EditablePathObject, indices: number[]) => void
  setSelectedEditableSegment: (obj: EditablePathObject, segmentRef: EditableSegmentRef | null) => void
  setSelectionMode: (mode: HomeDirectEditSelectionMode) => void
  shouldProtectPointGestureSelection: () => boolean
}

export interface HomeDirectEditController {
  commands: HomeDirectEditCommands
  state: HomeDirectEditState
}

export interface CreateHomeDirectEditModuleOptions {
  activeObject: ShallowRef<FabricObject | null>
  getArrowRenderMode: (obj: EditablePathObject) => ArrowRenderMode
  getCanvasAssistColors: () => CanvasAssistColors
  getFabricCanvas: () => Canvas | null
  getSelectableEditablePoints: (obj: EditablePathObject) => Array<{ index: number }>
  getViewportPointForEditablePoint: (obj: EditablePathObject, pointIndex: number) => Point
  isEditablePathObject: (obj: FabricObject | null | undefined) => obj is EditablePathObject
  isKaleidoscopeInstance: (obj: FabricObject | null | undefined) => boolean
  resolveEditableSegmentRef: (obj: EditablePathObject, segmentRef: EditableSegmentRef | null) => EditableSegmentRef | null
  syncCanvasInteractionMode: () => void
  syncObjProps: () => void
  updateCurveControls: () => void
}

export interface CreateHomeDirectEditModuleResult {
  controller: HomeDirectEditController
  module: EditorModule
}

/**
 * 创建直接编辑模块，集中维护点/边选择状态、点位手势状态机和临时 Fabric 控制点生命周期。
 * 页面层仍负责拼装具体控制点，所有选择模式切换、点选集合、框选手势和控制点恢复都通过该控制器完成。
 */
export function createHomeDirectEditModule(
  options: CreateHomeDirectEditModuleOptions
): CreateHomeDirectEditModuleResult {
  const selectedPointIndices = ref<number[]>([])
  const editablePathMetadataVersion = ref(0)
  const selectedSegmentRef = shallowRef<EditableSegmentRef | null>(null)
  const selectionMode = ref<HomeDirectEditSelectionMode>('shape')
  const pointControlsOwner = shallowRef<FabricObject | null>(null)
  const originalControlsMap = new WeakMap<FabricObject, FabricControls>()
  const originalHasBordersMap = new WeakMap<FabricObject, boolean | undefined>()
  const pointGestureState = createInitialPointGestureState()
  const pointGestureRenderTick = ref(0)
  let restoreActiveObjectAfterSelectionClear = false
  let pointModeSwitchPending = false

  const activeEditablePathObject = computed(() => {
    const obj = options.activeObject.value
    return obj && !options.isKaleidoscopeInstance(obj) && options.isEditablePathObject(obj) ? obj : null
  })

  const hasEditablePoints = computed(() => {
    const obj = activeEditablePathObject.value
    return !!obj && options.getSelectableEditablePoints(obj).length > 0
  })

  const selectedPointIndex = computed(() => (
    selectedPointIndices.value.length === 1 ? selectedPointIndices.value[0] : null
  ))

  const hasSelectedPoint = computed(() => selectedPointIndices.value.length > 0)

  const selectedEditableSegment = computed(() => {
    if (selectionMode.value !== 'segment') return null
    return getLiveEditableSegmentRef(selectedSegmentRef.value)
  })

  /**
   * 创建点编辑手势的空状态，供清理和新一轮点位拖拽 / 框选开始时复用。
   */
  function createInitialPointGestureState(): PointGestureState {
    return {
      active: false,
      source: 'blank',
      kind: 'none',
      modifierAtStart: false,
      startedFromSelectedPoint: false,
      startPointIndex: null,
      initialSelection: [],
      startViewport: null,
      currentViewport: null,
      startScene: null,
      currentScene: null,
      previewHitIndices: [],
      thresholdExceeded: false,
      pendingCollapseIndex: null,
      preDragSelection: null
    }
  }

  /**
   * 递增路径元数据版本号，让依赖路径点、箭头或边类型的 computed 重新取值。
   */
  function refreshEditablePathMetadata() {
    editablePathMetadataVersion.value += 1
  }

  /**
   * 递增手势绘制版本号，驱动点控件和框选 marquee 重新渲染。
   */
  function bumpPointGestureRender() {
    pointGestureRenderTick.value = (pointGestureRenderTick.value + 1) | 0
  }

  /**
   * 将点编辑手势恢复为空闲状态，保留当前已提交点选结果。
   */
  function resetPointGestureState() {
    Object.assign(pointGestureState, createInitialPointGestureState())
  }

  /**
   * 根据当前可选点集合过滤并排序点位索引，防止删除点或切换对象后残留无效索引。
   */
  function normalizeSelectedPointIndices(obj: EditablePathObject, indices: number[]) {
    const selectable = new Set(options.getSelectableEditablePoints(obj).map(({ index }) => index))
    return Array.from(new Set(indices))
      .filter((index) => selectable.has(index))
      .sort((a, b) => a - b)
  }

  /**
   * 清空点选择集合，但不影响当前边选择或选择模式。
   */
  function clearSelectedPoint() {
    selectedPointIndices.value = []
  }

  /**
   * 清空边选择引用，但不影响当前点选择或选择模式。
   */
  function clearSelectedSegment() {
    selectedSegmentRef.value = null
  }

  /**
   * 清空点/边直接编辑辅助选择，用于回到普通图形选择或切换活动对象。
   */
  function clearEditableAssistSelection() {
    clearSelectedPoint()
    clearSelectedSegment()
  }

  /**
   * 恢复当前对象的原始 Fabric 控制点与边框状态，避免直接编辑控件泄漏到普通选择模式。
   */
  function restorePointControls() {
    const owner = pointControlsOwner.value
    if (!owner) return
    const original = originalControlsMap.get(owner)
    if (original) {
      owner.controls = original
      originalControlsMap.delete(owner)
    }
    if (originalHasBordersMap.has(owner)) {
      owner.set('hasBorders', originalHasBordersMap.get(owner) ?? true)
      originalHasBordersMap.delete(owner)
    }
    owner.setCoords()
    pointControlsOwner.value = null
  }

  /**
   * 完整退出点/边直接编辑：清空辅助选择、重置手势状态，并恢复被替换的 Fabric 控件。
   */
  function clearPointEditing() {
    clearEditableAssistSelection()
    resetPointGestureState()
    bumpPointGestureRender()
    restorePointControls()
  }

  /**
   * 克隆对象当前控制点映射，调用方可在副本上追加点/边编辑控件后再安装回对象。
   */
  function cloneCurrentControls(owner: FabricObject): FabricControls {
    return { ...(owner.controls as FabricControls) }
  }

  /**
   * 安装一组临时控制点并保存原始控制点；dispose、模式切换或下一次安装时会自动恢复。
   */
  function installTemporaryControls(owner: FabricObject, controls: FabricControls, installOptions: { hideBorders?: boolean } = {}) {
    restorePointControls()
    originalControlsMap.set(owner, owner.controls as FabricControls)
    if (installOptions.hideBorders) {
      originalHasBordersMap.set(owner, owner.hasBorders)
      owner.set('hasBorders', false)
    }
    owner.controls = controls
    pointControlsOwner.value = owner
    owner.setCoords()
  }

  /**
   * 把传入边引用解析为当前路径模型中的实时引用，避免点位修改后继续使用旧对象。
   */
  function getLiveEditableSegmentRef(segmentRef: EditableSegmentRef | null) {
    const obj = activeEditablePathObject.value
    if (!obj) return null
    return options.resolveEditableSegmentRef(obj, segmentRef)
  }

  /**
   * 设置当前点选择集合，并同步清空边选择，使 point 模式保持 point-only 语义。
   */
  function setSelectedEditablePoints(obj: EditablePathObject, indices: number[]) {
    selectedSegmentRef.value = null
    selectedPointIndices.value = normalizeSelectedPointIndices(obj, indices)
    options.syncObjProps()
    obj.canvas?.requestRenderAll()
  }

  /**
   * 设置当前边选择引用，并刷新曲线控制点，供 segment 模式点击中点或快捷切换时使用。
   */
  function setSelectedEditableSegment(obj: EditablePathObject, segmentRef: EditableSegmentRef | null) {
    clearSelectedPoint()
    selectedSegmentRef.value = options.resolveEditableSegmentRef(obj, segmentRef)
    options.updateCurveControls()
    options.syncObjProps()
    obj.canvas?.requestRenderAll()
  }

  /**
   * 按单选或修饰键多选规则更新点选择集合。
   */
  function selectEditablePoint(obj: EditablePathObject, pointIndex: number, multi = false) {
    if (!multi) {
      setSelectedEditablePoints(obj, [pointIndex])
      return
    }
    const next = selectedPointIndices.value.includes(pointIndex)
      ? selectedPointIndices.value.filter((index) => index !== pointIndex)
      : [...selectedPointIndices.value, pointIndex]
    setSelectedEditablePoints(obj, next)
  }

  /**
   * 切换图形 / 点 / 边选择模式，并同步 Fabric 选择能力、临时控件和属性面板状态。
   */
  function setSelectionMode(mode: HomeDirectEditSelectionMode) {
    const editable = activeEditablePathObject.value
    const nextMode = mode === 'segment' && editable && options.getArrowRenderMode(editable) === 'hollow-shaft'
      ? 'point'
      : mode
    if (nextMode === 'shape' || editable) {
      selectionMode.value = nextMode
    } else {
      selectionMode.value = 'shape'
    }
    if (mode === 'shape') {
      clearEditableAssistSelection()
    } else if (mode === 'point') {
      clearSelectedSegment()
    } else {
      clearSelectedPoint()
    }
    restoreActiveObjectAfterSelectionClear = false
    resetPointGestureState()
    bumpPointGestureRender()
    options.syncCanvasInteractionMode()
    const fabricCanvas = options.getFabricCanvas()
    if (fabricCanvas && options.activeObject.value) {
      fabricCanvas.setActiveObject(options.activeObject.value)
    }
    options.updateCurveControls()
    if (options.activeObject.value) {
      options.syncObjProps()
    }
  }

  /**
   * 判断鼠标事件是否按下点多选修饰键，兼容 Ctrl / Shift / Meta。
   */
  function isMultiSelectModifierPressed(
    event?: Partial<Pick<MouseEvent, 'ctrlKey' | 'shiftKey' | 'metaKey'>> | null
  ) {
    return !!event && !!(event.ctrlKey || event.shiftKey || event.metaKey)
  }

  /**
   * 从原生指针事件读取 viewport 坐标，缺少 canvas 或事件时返回原点作为安全兜底。
   */
  function getPointerViewportFromEvent(event: MouseEvent | TouchEvent | null | undefined) {
    const fabricCanvas = options.getFabricCanvas()
    if (!fabricCanvas || !event) return { x: 0, y: 0 }
    const point = fabricCanvas.getViewportPoint(event as MouseEvent)
    return { x: point.x, y: point.y }
  }

  /**
   * 从原生指针事件读取 scene 坐标，供点拖拽和框选手势记录当前画布位置。
   */
  function getPointerSceneFromEvent(event: MouseEvent | TouchEvent | null | undefined) {
    const fabricCanvas = options.getFabricCanvas()
    if (!fabricCanvas || !event) return { x: 0, y: 0 }
    const point = fabricCanvas.getScenePoint(event as MouseEvent)
    return { x: point.x, y: point.y }
  }

  /**
   * 判断指针是否已超过点编辑拖拽阈值，用于区分点击、拖拽和框选。
   */
  function exceededViewportThreshold(start: { x: number; y: number }, current: { x: number; y: number }) {
    const dx = current.x - start.x
    const dy = current.y - start.y
    return Math.hypot(dx, dy) >= POINT_GESTURE_DRAG_THRESHOLD
  }

  /**
   * 从点控件按下开始一轮手势，先记录初始选择，等待 move 阶段判定单点拖拽、组选拖拽或框选。
   */
  function beginPointControlGesture(
    editable: EditablePathObject,
    pointIndex: number,
    event: MouseEvent | TouchEvent | null | undefined
  ) {
    resetPointGestureState()
    const modifier = isMultiSelectModifierPressed(event as MouseEvent | undefined)
    const initialSelection = [...selectedPointIndices.value]
    const startedFromSelectedPoint = initialSelection.includes(pointIndex)
    const viewport = getPointerViewportFromEvent(event ?? null)
    const scene = getPointerSceneFromEvent(event ?? null)
    pointGestureState.active = true
    pointGestureState.source = 'point-control'
    pointGestureState.kind = 'pending'
    pointGestureState.modifierAtStart = modifier
    pointGestureState.startedFromSelectedPoint = startedFromSelectedPoint
    pointGestureState.startPointIndex = pointIndex
    pointGestureState.initialSelection = initialSelection
    pointGestureState.startViewport = viewport
    pointGestureState.currentViewport = viewport
    pointGestureState.startScene = scene
    pointGestureState.currentScene = scene
    pointGestureState.previewHitIndices = []
    pointGestureState.thresholdExceeded = false
    pointGestureState.pendingCollapseIndex = null
    pointGestureState.preDragSelection = initialSelection

    if (modifier) {
      selectEditablePoint(editable, pointIndex, true)
      return
    }

    if (startedFromSelectedPoint && initialSelection.length > 1) {
      pointGestureState.pendingCollapseIndex = pointIndex
      return
    }

    selectEditablePoint(editable, pointIndex, false)
  }

  /**
   * 从空白区域按下开始一轮点编辑手势，主要用于修饰键框选追加点位。
   */
  function beginBlankPointGesture(event: MouseEvent | TouchEvent | null | undefined) {
    resetPointGestureState()
    const modifier = isMultiSelectModifierPressed(event as MouseEvent | undefined)
    const initialSelection = [...selectedPointIndices.value]
    const viewport = getPointerViewportFromEvent(event ?? null)
    const scene = getPointerSceneFromEvent(event ?? null)
    pointGestureState.active = true
    pointGestureState.source = 'blank'
    pointGestureState.kind = 'pending'
    pointGestureState.modifierAtStart = modifier
    pointGestureState.startedFromSelectedPoint = false
    pointGestureState.startPointIndex = null
    pointGestureState.initialSelection = initialSelection
    pointGestureState.startViewport = viewport
    pointGestureState.currentViewport = viewport
    pointGestureState.startScene = scene
    pointGestureState.currentScene = scene
    pointGestureState.previewHitIndices = []
    pointGestureState.thresholdExceeded = false
    pointGestureState.pendingCollapseIndex = null
    pointGestureState.preDragSelection = null
  }

  /**
   * 供 Fabric actionHandler 兼容调用的重绘触发器，真正坐标更新由 canvas mouse:move 统一驱动。
   */
  function updatePointGestureFromCanvasCoord(_x: number, _y: number) {
    bumpPointGestureRender()
    options.getFabricCanvas()?.requestRenderAll()
  }

  /**
   * 计算当前框选 marquee 的 viewport 包围盒；未处于有效拖拽时返回 null。
   */
  function getMarqueeViewportBounds() {
    const start = pointGestureState.startViewport
    const current = pointGestureState.currentViewport
    if (!start || !current) return null
    const x1 = Math.min(start.x, current.x)
    const y1 = Math.min(start.y, current.y)
    const x2 = Math.max(start.x, current.x)
    const y2 = Math.max(start.y, current.y)
    return { x1, y1, x2, y2 }
  }

  /**
   * 根据当前 marquee 命中可选点索引，仅生成预览结果，最终提交由 mouseup 统一处理。
   */
  function computeBoxSelectPreviewHits(): number[] {
    const editable = activeEditablePathObject.value
    if (!editable) return []
    const bounds = getMarqueeViewportBounds()
    if (!bounds) return []
    const hits: number[] = []
    for (const { index } of options.getSelectableEditablePoints(editable)) {
      const vp = options.getViewportPointForEditablePoint(editable, index)
      if (vp.x >= bounds.x1 && vp.x <= bounds.x2 && vp.y >= bounds.y1 && vp.y <= bounds.y2) {
        hits.push(index)
      }
    }
    return hits
  }

  /**
   * 合并框选命中和手势开始前的点选集合，保持修饰键框选的追加语义。
   */
  function unionBoxSelectFinalIndices(): number[] {
    const set = new Set<number>(pointGestureState.initialSelection)
    for (const i of pointGestureState.previewHitIndices) set.add(i)
    return Array.from(set).sort((a, b) => a - b)
  }

  /**
   * 处理 canvas mouse:move，在超过阈值后判定手势类型并刷新框选预览。
   */
  function handlePointGestureCanvasMove(event: CanvasPointerEventLike) {
    const fabricCanvas = options.getFabricCanvas()
    if (!fabricCanvas) return
    if (selectionMode.value !== 'point') return
    if (!pointGestureState.active) return
    const viewport = event.viewportPoint ?? fabricCanvas.getViewportPoint(event.e as MouseEvent)
    const scene = event.scenePoint ?? fabricCanvas.getScenePoint(event.e as MouseEvent)
    pointGestureState.currentViewport = { x: viewport.x, y: viewport.y }
    pointGestureState.currentScene = { x: scene.x, y: scene.y }
    if (!pointGestureState.thresholdExceeded) {
      const start = pointGestureState.startViewport
      if (!start) return
      if (!exceededViewportThreshold(start, pointGestureState.currentViewport)) return
      pointGestureState.thresholdExceeded = true
      if (pointGestureState.modifierAtStart) {
        if (pointGestureState.source === 'point-control') {
          const editable = activeEditablePathObject.value
          if (editable) {
            setSelectedEditablePoints(editable, pointGestureState.initialSelection)
          }
        }
        pointGestureState.kind = 'box-select'
        pointGestureState.pendingCollapseIndex = null
      } else if (pointGestureState.source === 'point-control') {
        if (pointGestureState.startedFromSelectedPoint && pointGestureState.initialSelection.length > 1) {
          pointGestureState.kind = 'group-drag'
        } else {
          pointGestureState.kind = 'single-drag'
        }
      } else {
        pointGestureState.kind = 'pending'
      }
    }
    if (pointGestureState.kind === 'box-select') {
      pointGestureState.previewHitIndices = computeBoxSelectPreviewHits()
      bumpPointGestureRender()
      fabricCanvas.requestRenderAll()
    }
  }

  /**
   * 在 mouseup 阶段提交框选或多选点击 collapse 决议，并清理本轮手势状态。
   */
  function finishPointGesture() {
    if (selectionMode.value !== 'point') return
    if (!pointGestureState.active) return
    const editable = activeEditablePathObject.value
    try {
      if (pointGestureState.kind === 'box-select' && editable) {
        setSelectedEditablePoints(editable, unionBoxSelectFinalIndices())
      } else if (
        pointGestureState.source === 'point-control'
        && !pointGestureState.thresholdExceeded
        && !pointGestureState.modifierAtStart
        && pointGestureState.pendingCollapseIndex != null
        && editable
      ) {
        setSelectedEditablePoints(editable, [pointGestureState.pendingCollapseIndex])
      }
    } finally {
      resetPointGestureState()
      bumpPointGestureRender()
      options.getFabricCanvas()?.requestRenderAll()
    }
  }

  /**
   * 在 Fabric 顶层 canvas 上绘制点编辑框选矩形，避免新增真实对象污染画布历史。
   */
  function drawPointGestureMarquee() {
    const fabricCanvas = options.getFabricCanvas()
    if (!fabricCanvas) return
    if (selectionMode.value !== 'point') return
    if (pointGestureState.kind !== 'box-select') return
    const bounds = getMarqueeViewportBounds()
    if (!bounds) return
    const ctx = (fabricCanvas as any).getTopContext?.() ?? (fabricCanvas as any).contextTop
    if (!ctx) return
    const x = bounds.x1
    const y = bounds.y1
    const w = bounds.x2 - bounds.x1
    const h = bounds.y2 - bounds.y1
    if (w <= 0 || h <= 0) return
    const colors = options.getCanvasAssistColors()
    ctx.save()
    ctx.fillStyle = colors.primaryOverlay
    ctx.strokeStyle = colors.primaryStrong
    ctx.lineWidth = 1
    ctx.fillRect(x, y, w, h)
    ctx.strokeRect(x + 0.5, y + 0.5, Math.max(0, w - 1), Math.max(0, h - 1))
    ctx.restore()
  }

  /**
   * 渲染点编辑控制点，根据已提交选择和框选预览状态显示不同颜色。
   */
  function renderPointControl(this: Control & { pointIndex?: number }, ctx: CanvasRenderingContext2D, left: number, top: number) {
    const key = this.pointIndex
    const committed = key != null && selectedPointIndices.value.includes(key)
    const previewAdded = !committed
      && pointGestureState.kind === 'box-select'
      && key != null
      && pointGestureState.previewHitIndices.includes(key)
    void pointGestureRenderTick.value
    const colors = options.getCanvasAssistColors()
    ctx.save()
    ctx.beginPath()
    if (previewAdded) {
      ctx.arc(left, top, 5, 0, Math.PI * 2)
      ctx.fillStyle = colors.primarySoft
      ctx.strokeStyle = colors.primary
      ctx.lineWidth = 2
    } else if (committed) {
      ctx.arc(left, top, 5, 0, Math.PI * 2)
      ctx.fillStyle = colors.primary
      ctx.strokeStyle = colors.primary
      ctx.lineWidth = 2
    } else {
      ctx.arc(left, top, 4, 0, Math.PI * 2)
      ctx.fillStyle = colors.textOnPrimary
      ctx.strokeStyle = colors.primary
      ctx.lineWidth = 2
    }
    ctx.fill()
    ctx.stroke()
    ctx.restore()
  }

  /**
   * 标记 point 模式正在切换到另一个 Fabric 对象，selection:cleared 会据此跳过中间态清空。
   */
  function setPointModeSwitchPending(value = true) {
    pointModeSwitchPending = value
  }

  /**
   * 读取并消费 point 模式切换标记，保证一次 Fabric selection 流程只处理一次。
   */
  function consumePointModeSwitchPending() {
    if (!pointModeSwitchPending) return false
    pointModeSwitchPending = false
    return true
  }

  /**
   * 只读判断 point 模式切换标记，供 selection:cleared 决定是否等待后续 selection:created。
   */
  function isPointModeSwitchPending() {
    return pointModeSwitchPending
  }

  /**
   * 控制 selection:cleared 后是否恢复当前活动对象，用于直接编辑模式拦截 Fabric 默认清选。
   */
  function setRestoreActiveObjectAfterSelectionClear(value = true) {
    restoreActiveObjectAfterSelectionClear = value
  }

  /**
   * 读取并消费活动对象恢复标记，避免一次清选流程重复恢复。
   */
  function consumeRestoreActiveObjectAfterSelectionClear() {
    const current = restoreActiveObjectAfterSelectionClear
    restoreActiveObjectAfterSelectionClear = false
    return current
  }

  /**
   * 只读判断活动对象恢复标记，便于外部在不消费状态时做分支。
   */
  function isRestoreActiveObjectAfterSelectionClear() {
    return restoreActiveObjectAfterSelectionClear
  }

  /**
   * 只读暴露当前点编辑手势状态，供点控件 actionHandler 判断拖拽类型而不直接持有内部对象所有权。
   */
  function getPointGestureState(): Readonly<PointGestureState> {
    return pointGestureState
  }

  /**
   * 判断当前是否有活动点编辑手势。
   */
  function isPointGestureActive() {
    return pointGestureState.active
  }

  /**
   * 判断 selection:cleared 是否应该保护正在点编辑的活动对象。
   */
  function shouldProtectPointGestureSelection() {
    return selectionMode.value === 'point' && pointGestureState.active && !!options.activeObject.value
  }

  const controller: HomeDirectEditController = {
    commands: {
      beginBlankPointGesture,
      beginPointControlGesture,
      bumpPointGestureRender,
      clearEditableAssistSelection,
      clearPointEditing,
      clearSelectedPoint,
      clearSelectedSegment,
      cloneCurrentControls,
      consumePointModeSwitchPending,
      consumeRestoreActiveObjectAfterSelectionClear,
      drawPointGestureMarquee,
      finishPointGesture,
      getLiveEditableSegmentRef,
      getPointGestureState,
      handlePointGestureCanvasMove,
      installTemporaryControls,
      isMultiSelectModifierPressed,
      isPointGestureActive,
      isPointModeSwitchPending,
      isRestoreActiveObjectAfterSelectionClear,
      normalizeSelectedPointIndices,
      updatePointGestureFromCanvasCoord,
      refreshEditablePathMetadata,
      renderPointControl,
      resetPointGestureState,
      restorePointControls,
      selectEditablePoint,
      setPointModeSwitchPending,
      setRestoreActiveObjectAfterSelectionClear,
      setSelectedEditablePoints,
      setSelectedEditableSegment,
      setSelectionMode,
      shouldProtectPointGestureSelection
    },
    state: {
      activeEditablePathObject,
      editablePathMetadataVersion,
      hasEditablePoints,
      hasSelectedPoint,
      pointGestureRenderTick,
      selectedEditableSegment,
      selectedPointIndex,
      selectedPointIndices,
      selectedSegmentRef,
      selectionMode
    }
  }

  const module: EditorModule = {
    name: 'home-direct-edit',
    onDispose() {
      clearPointEditing()
      pointModeSwitchPending = false
      restoreActiveObjectAfterSelectionClear = false
    }
  }

  return { controller, module }
}
