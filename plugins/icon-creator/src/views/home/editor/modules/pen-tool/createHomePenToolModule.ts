import { Point } from 'fabric'
import type { Canvas } from 'fabric'
import { ref, shallowRef, type Ref, type ShallowRef } from 'vue'
import type { EditorModule } from '../../runtime/editorTypes'

export type PenPoint = { x: number; y: number }

/**
 * 钢笔已落点：在坐标之外携带贝塞尔控制柄（均为场景坐标）。
 * - handleOut：出柄（拖拽产生），作为"下一段"的 cp1；
 * - handleIn：入柄，作为"上一段"的 cp2；普通拖拽时与出柄关于锚点镜像（平滑对称），
 *   按住 Alt 拖拽时为 null（断开对称，该点视为角点收尾）。
 */
export type PenPlacedPoint = PenPoint & {
  handleOut: PenPoint | null
  handleIn: PenPoint | null
}

export type PenPathSegmentData =
  | { type: 'line'; to: number }
  | { type: 'cubic'; cp1: PenPoint; cp2: PenPoint; to: number }

/**
 * 钢笔提交给 addPenPathObject 的路径数据：锚点 + 显式段（可为直线/曲线混合）。
 * segments 为空数组时退化为纯直线折线（与旧版 polygonEditablePath 行为一致）。
 */
export type PenPathData = {
  points: PenPoint[]
  segments: PenPathSegmentData[]
  closed: boolean
}

type CanvasAssistColors = {
  primary: string
  primarySoft: string
  primaryOverlay: string
  primaryStrong: string
  textOnPrimary: string
  neutralSurface?: string
  neutralBorder?: string
}

type CanvasPointerEventLike = {
  viewportPoint?: Point
  scenePoint?: Point
  e: MouseEvent | TouchEvent
}

// 落点基础半径（视口像素）。
const POINT_RADIUS_BASE = 4
// 鼠标靠近时的目标半径（视口像素）。
const POINT_RADIUS_HOVERED = 8
// 每帧缓动系数（0~1，越大收敛越快）。
const HOVER_EASE_FACTOR = 0.25
// 收敛判定阈值，低于该值即停止缓动循环，避免长时间空转重绘。
const HOVER_SETTLE_EPSILON = 0.01
// 判定「点击首点闭合」的视口像素容差。
const CLOSE_THRESHOLD_VIEWPORT = 10
// 判定双击的间隔（毫秒）。
const DBLCLICK_INTERVAL_MS = 300
// 判定双击的视口像素位移容差。
const DBLCLICK_DISTANCE_VIEWPORT = 5
// 悬停判定半径（视口像素）。
const HOVER_RADIUS_VIEWPORT = 10
// 连续重复点去重阈值（场景单位）。
const DUPLICATE_THRESHOLD_SCENE = 0.5
// 按下-拖拽判定为曲线点的视口像素位移阈值。
const DRAG_THRESHOLD_VIEWPORT = 4

export interface HomePenToolState {
  penToolActive: Ref<boolean>
  penPoints: ShallowRef<PenPlacedPoint[]>
  penHoverIndex: Ref<number | null>
  penRenderTick: Ref<number>
}

export interface HomePenToolCommands {
  activate: () => void
  deactivate: (commit?: boolean) => void
  handlePenLeftDown: (scenePoint: PenPoint) => void
  handlePenRightClick: () => void
  handlePenPointerMove: (event: CanvasPointerEventLike) => void
  handlePenPointerUp: () => void
  handlePenEnter: () => void
  drawPenOverlay: () => void
}

export interface HomePenToolController {
  commands: HomePenToolCommands
  state: HomePenToolState
}

export interface CreateHomePenToolModuleOptions {
  getFabricCanvas: () => Canvas | null
  getCanvasAssistColors: () => CanvasAssistColors
  getZoom: () => number
  snapScenePoint: (point: Point) => Point
  addPenPathObject: (data: PenPathData) => void
  discardActiveObject: () => void
}

export interface CreateHomePenToolModuleResult {
  controller: HomePenToolController
  module: EditorModule
}

/**
 * 创建钢笔描点工具模块，集中维护描点过程中的已落点、悬停态与覆盖层绘制。
 * 交互：点击 = 直线角点；按下-拖拽 = 曲线点（拖拽方向/距离决定出柄，入柄镜像对称，Alt 断开对称）。
 * 模块只持有状态机和绘制逻辑；落点吸附、生成图形对象、清除活动选区等副作用通过注入的回调回到页面层。
 */
export function createHomePenToolModule(
  options: CreateHomePenToolModuleOptions
): CreateHomePenToolModuleResult {
  const penToolActive = ref(false)
  const penPoints = shallowRef<PenPlacedPoint[]>([])
  const penHoverIndex = ref<number | null>(null)
  const penRenderTick = ref(0)

  // 每个已落点当前的缓动半径（视口像素），与 penPoints 一一对应。
  let hoverRadiusByIndex: number[] = []
  // 橡皮筋预览端点（场景坐标），mouse:move 持续更新；为空时不绘制预览线。
  let liveCursorScenePoint: PenPoint | null = null
  // 双击计时的上次 left-down 时刻与场景坐标。
  let lastDownTime = 0
  let lastDownScenePoint: PenPoint | null = null
  // 缓动循环的 rAF 句柄，无待收敛半径时为 0。
  let hoverEaseHandle = 0
  // 按下后待判定的拖拽：index 为本次落点下标，startScene 为按下位置，active 表示已超过拖拽阈值。
  let pendingDrag: { index: number; startScene: PenPoint; active: boolean } | null = null

  /**
   * 递增覆盖层渲染版本号并触发 Fabric 重绘，驱动 drawPenOverlay 重新执行。
   */
  function bumpPenRender() {
    penRenderTick.value = (penRenderTick.value + 1) | 0
    options.getFabricCanvas()?.requestRenderAll()
  }

  /**
   * 计算两个场景点之间的欧氏距离。
   */
  function distance(a: PenPoint, b: PenPoint) {
    return Math.hypot(a.x - b.x, a.y - b.y)
  }

  /**
   * 把场景点转换为视口坐标（Fabric 内部 viewportTransform 为纯 scale，平移走 CSS transform 不影响 top context）。
   */
  function sceneToViewport(point: PenPoint) {
    const zoom = options.getZoom()
    return { x: point.x * zoom, y: point.y * zoom }
  }

  /**
   * 落点吸附到当前像素网格后返回场景坐标；未开启吸附时由注入回调原样返回。
   */
  function snapPoint(point: PenPoint) {
    const snapped = options.snapScenePoint(new Point(point.x, point.y))
    return { x: snapped.x, y: snapped.y }
  }

  /**
   * 读取指针事件是否按住 Alt（触控事件无该字段时按未按处理）。
   */
  function isAltPressed(event: MouseEvent | TouchEvent) {
    return 'altKey' in event ? !!event.altKey : false
  }

  /**
   * 求一段"起点 → 终点"的有效曲线控制柄：
   * cp1 取起点出柄、cp2 取终点入柄；某侧缺失时用对侧柄关于段中点的镜像补齐（平行切线的对称曲线），
   * 保证橡皮筋预览与最终提交的曲线一致；两侧均无柄时返回 null（应绘制直线段）。
   */
  function resolveSegmentHandles(from: PenPlacedPoint, to: PenPlacedPoint): { cp1: PenPoint; cp2: PenPoint } | null {
    const cp1 = from.handleOut
    const cp2 = to.handleIn
    if (!cp1 && !cp2) return null
    const midX = (from.x + to.x) / 2
    const midY = (from.y + to.y) / 2
    return {
      cp1: cp1 ?? { x: 2 * midX - cp2.x, y: 2 * midY - cp2.y },
      cp2: cp2 ?? { x: 2 * midX - cp1.x, y: 2 * midY - cp1.y }
    }
  }

  /**
   * 把已落点序列换算为提交数据：相邻点按柄的存在与否生成直线/曲线段；
   * closed 为 true 时追加"末点 → 首点"的闭合段（首点为曲线点时其入柄参与闭合段形状）。
   */
  function buildPenPathData(points: PenPlacedPoint[], closed: boolean): PenPathData {
    const count = points.length
    const maxSegments = closed ? count : count - 1
    const segments: PenPathSegmentData[] = []
    for (let i = 0; i < maxSegments; i += 1) {
      const to = (i + 1) % count
      const handles = resolveSegmentHandles(points[i], points[to])
      segments.push(handles
        ? { type: 'cubic', cp1: handles.cp1, cp2: handles.cp2, to }
        : { type: 'line', to })
    }
    return {
      points: points.map((point) => ({ x: point.x, y: point.y })),
      segments,
      closed
    }
  }

  /**
   * 启动/保持悬停半径缓动循环，直到所有点半径收敛后自动停止，避免空闲时持续重绘。
   */
  function scheduleHoverEaseLoop() {
    if (hoverEaseHandle) return
    const tick = () => {
      hoverEaseHandle = 0
      const points = penPoints.value
      let pending = false
      for (let i = 0; i < points.length; i++) {
        const target = i === penHoverIndex.value ? POINT_RADIUS_HOVERED : POINT_RADIUS_BASE
        const current = hoverRadiusByIndex[i] ?? POINT_RADIUS_BASE
        const next = current + (target - current) * HOVER_EASE_FACTOR
        hoverRadiusByIndex[i] = next
        if (Math.abs(target - next) > HOVER_SETTLE_EPSILON) pending = true
      }
      bumpPenRender()
      if (pending) {
        hoverEaseHandle = requestAnimationFrame(tick)
      }
    }
    hoverEaseHandle = requestAnimationFrame(tick)
  }

  /**
   * 清空描点过程中的所有状态，用于提交/退出/销毁时统一复位。
   */
  function resetPenState() {
    penPoints.value = []
    hoverRadiusByIndex = []
    penHoverIndex.value = null
    liveCursorScenePoint = null
    lastDownTime = 0
    lastDownScenePoint = null
    pendingDrag = null
    if (hoverEaseHandle) {
      cancelAnimationFrame(hoverEaseHandle)
      hoverEaseHandle = 0
    }
  }

  /**
   * 提交当前描点结果为图形对象（>=2 点时）后退出钢笔态；closed 控制闭合多边形/开放折线。
   */
  function commitAndExit(closed: boolean) {
    const points = [...penPoints.value]
    const hasPoints = points.length >= 2
    resetPenState()
    penToolActive.value = false
    if (hasPoints) {
      options.addPenPathObject(buildPenPathData(points, closed))
    }
    bumpPenRender()
  }

  /**
   * 激活钢笔工具（已激活则切换回普通态）；激活时清除当前活动选区，避免选中态干扰描点。
   */
  function activate() {
    if (penToolActive.value) {
      deactivate(false)
      return
    }
    resetPenState()
    penToolActive.value = true
    options.discardActiveObject()
    bumpPenRender()
  }

  /**
   * 退出钢笔工具；commit 为 true 且点数足够时把描点结果生成为图形对象。
   */
  function deactivate(commit = true) {
    if (!penToolActive.value) return
    if (commit) {
      commitAndExit(false)
    } else {
      resetPenState()
      penToolActive.value = false
      bumpPenRender()
    }
  }

  /**
   * 处理左键落点：先判双击提交，再判点击首点闭合，去重后追加新点并进入拖拽判定
   * （松开前若拖出阈值则把该点变成曲线点；Alt 状态由 pointermove 实时读取）。
   */
  function handlePenLeftDown(scenePoint: PenPoint) {
    if (!penToolActive.value) return
    const now = Date.now()
    const points = penPoints.value

    // ── 双击判定 ──：距上次 left-down 时间与位移均在阈值内且落在已落点上 → 提交并退出。
    if (lastDownTime && lastDownScenePoint && now - lastDownTime <= DBLCLICK_INTERVAL_MS) {
      const zoom = options.getZoom()
      const dx = (scenePoint.x - lastDownScenePoint.x) * zoom
      const dy = (scenePoint.y - lastDownScenePoint.y) * zoom
      if (Math.hypot(dx, dy) <= DBLCLICK_DISTANCE_VIEWPORT && points.length >= 2) {
        lastDownTime = 0
        lastDownScenePoint = null
        pendingDrag = null
        commitAndExit(false)
        return
      }
    }

    const snapped = snapPoint(scenePoint)

    // ── 点击首点闭合 ──：已有 >=3 点且落在首点容差内 → 闭合多边形并退出。
    if (points.length >= 3) {
      const zoom = options.getZoom()
      const closeThreshold = CLOSE_THRESHOLD_VIEWPORT / zoom
      if (distance(snapped, points[0]) <= closeThreshold) {
        lastDownTime = 0
        lastDownScenePoint = null
        pendingDrag = null
        commitAndExit(true)
        return
      }
    }

    // ── 去重 ──：与上一点过近则跳过，避免退化几何。
    const last = points[points.length - 1]
    if (last && distance(snapped, last) < DUPLICATE_THRESHOLD_SCENE) {
      lastDownTime = now
      lastDownScenePoint = snapped
      pendingDrag = null
      bumpPenRender()
      return
    }

    points.push({ x: snapped.x, y: snapped.y, handleOut: null, handleIn: null })
    penPoints.value = [...points]
    hoverRadiusByIndex.push(POINT_RADIUS_BASE)
    lastDownTime = now
    lastDownScenePoint = snapped
    // 记录待判定拖拽：pointermove 超过阈值后把该点升级为曲线点
    pendingDrag = {
      index: points.length - 1,
      startScene: { x: snapped.x, y: snapped.y },
      active: false
    }
    bumpPenRender()
  }

  /**
   * 拖拽进行中把最新光标位置写入当前点的控制柄：
   * 出柄跟随光标；未按 Alt 时入柄取其关于锚点的镜像（平滑对称），按 Alt 则置空（断开对称）。
   */
  function updatePendingDragHandles(cursorScene: PenPoint, altKey: boolean) {
    if (!pendingDrag) return
    const points = penPoints.value
    const point = points[pendingDrag.index]
    if (!point) return
    point.handleOut = { x: cursorScene.x, y: cursorScene.y }
    point.handleIn = altKey ? null : { x: 2 * point.x - cursorScene.x, y: 2 * point.y - cursorScene.y }
    penPoints.value = [...points]
  }

  /**
   * 右键撤销最后一个落点；空数组时为 no-op，不退出钢笔态。
   */
  function handlePenRightClick() {
    if (!penToolActive.value) return
    const points = penPoints.value
    if (!points.length) return
    points.pop()
    penPoints.value = [...points]
    hoverRadiusByIndex.length = points.length
    penHoverIndex.value = null
    lastDownTime = 0
    lastDownScenePoint = null
    pendingDrag = null
    bumpPenRender()
  }

  /**
   * 处理画布 mouse:move：更新橡皮筋预览端点与悬停命中点；按下拖拽超过阈值后实时更新当前点控制柄。
   */
  function handlePenPointerMove(event: CanvasPointerEventLike) {
    if (!penToolActive.value) return
    const fabricCanvas = options.getFabricCanvas()
    if (!fabricCanvas) return
    const scene = event.scenePoint ?? fabricCanvas.getScenePoint(event.e as MouseEvent)
    liveCursorScenePoint = { x: scene.x, y: scene.y }

    // ── 拖拽判定与曲线柄更新 ──
    if (pendingDrag) {
      const zoom = options.getZoom()
      const dxViewport = (liveCursorScenePoint.x - pendingDrag.startScene.x) * zoom
      const dyViewport = (liveCursorScenePoint.y - pendingDrag.startScene.y) * zoom
      if (pendingDrag.active || Math.hypot(dxViewport, dyViewport) >= DRAG_THRESHOLD_VIEWPORT) {
        pendingDrag.active = true
        updatePendingDragHandles(liveCursorScenePoint, isAltPressed(event.e))
      }
    }

    const points = penPoints.value
    const zoom = options.getZoom()
    const hoverRadiusScene = HOVER_RADIUS_VIEWPORT / zoom
    let nearestIndex: number | null = null
    let nearestDistance = hoverRadiusScene
    for (let i = 0; i < points.length; i++) {
      const d = distance(liveCursorScenePoint, points[i])
      if (d <= nearestDistance) {
        nearestDistance = d
        nearestIndex = i
      }
    }
    const changed = nearestIndex !== penHoverIndex.value
    penHoverIndex.value = nearestIndex
    bumpPenRender()
    if (changed && points.length) scheduleHoverEaseLoop()
  }

  /**
   * 处理 pointer up：结束拖拽判定，保留已生成的控制柄；未拖拽过的点保持角点。
   */
  function handlePenPointerUp() {
    pendingDrag = null
  }

  /**
   * 处理 Enter 键：点数足够时按闭合多边形提交并退出（与点击首点闭合等价）。
   */
  function handlePenEnter() {
    if (!penToolActive.value) return
    if (penPoints.value.length >= 3) {
      commitAndExit(true)
    }
  }

  /**
   * 绘制两点之间的路径段：任一侧存在控制柄时画三次贝塞尔（与提交规则同源），否则画直线。
   */
  function pathSegmentOnCtx(
    ctx: CanvasRenderingContext2D,
    from: PenPlacedPoint,
    to: PenPlacedPoint
  ) {
    const handles = resolveSegmentHandles(from, to)
    if (handles) {
      const cp1 = sceneToViewport(handles.cp1)
      const cp2 = sceneToViewport(handles.cp2)
      const end = sceneToViewport(to)
      ctx.bezierCurveTo(cp1.x, cp1.y, cp2.x, cp2.y, end.x, end.y)
    } else {
      const end = sceneToViewport(to)
      ctx.lineTo(end.x, end.y)
    }
  }

  /**
   * 绘制单个锚点的控制柄指示：锚点到柄的细连线 + 柄端小圆点。
   */
  function drawHandlesForPoint(
    ctx: CanvasRenderingContext2D,
    point: PenPlacedPoint,
    colors: CanvasAssistColors
  ) {
    const anchor = sceneToViewport(point)
    for (const handle of [point.handleIn, point.handleOut]) {
      if (!handle) continue
      const handleViewport = sceneToViewport(handle)
      ctx.beginPath()
      ctx.moveTo(anchor.x, anchor.y)
      ctx.lineTo(handleViewport.x, handleViewport.y)
      ctx.strokeStyle = colors.primarySoft
      ctx.lineWidth = 1
      ctx.stroke()
      ctx.beginPath()
      ctx.arc(handleViewport.x, handleViewport.y, 2.5, 0, Math.PI * 2)
      ctx.fillStyle = colors.primaryStrong
      ctx.fill()
    }
  }

  /**
   * 在 Fabric 顶层 canvas 上绘制描点覆盖层：已落点连线（含曲线）、控制柄指示、
   * 橡皮筋预览（末点带出柄时为三次贝塞尔虚线）、各落点圆圈（悬停点放大）。
   */
  function drawPenOverlay() {
    const fabricCanvas = options.getFabricCanvas()
    if (!fabricCanvas || !penToolActive.value) return
    const ctx = (fabricCanvas as any).getTopContext?.() ?? (fabricCanvas as any).contextTop
    if (!ctx) return
    const points = penPoints.value
    if (!points.length) return
    void penRenderTick.value
    const colors = options.getCanvasAssistColors()
    const zoom = options.getZoom()
    const viewports = points.map(sceneToViewport)

    ctx.save()
    ctx.lineJoin = 'round'
    ctx.lineCap = 'round'

    // ── 已落点连线（实线，直线/曲线混合） ──
    if (viewports.length >= 2) {
      ctx.beginPath()
      ctx.moveTo(viewports[0].x, viewports[0].y)
      for (let i = 1; i < viewports.length; i++) {
        pathSegmentOnCtx(ctx, points[i - 1], points[i])
      }
      ctx.strokeStyle = colors.primary
      ctx.lineWidth = Math.max(1, 2 * Math.min(zoom, 1.5))
      ctx.stroke()
    }

    // ── 控制柄指示 ──
    for (const point of points) {
      drawHandlesForPoint(ctx, point, colors)
    }

    // ── 末点到光标的橡皮筋预览（虚线） ──
    if (liveCursorScenePoint) {
      const last = points[points.length - 1]
      const closeThreshold = CLOSE_THRESHOLD_VIEWPORT
      // 光标悬停首点且可闭合时，按闭合段预览（带上首点的入柄），与最终闭合形状一致
      const previewTarget: PenPlacedPoint = points.length >= 3
        && distance(sceneToViewport(liveCursorScenePoint), viewports[0]) <= closeThreshold
        ? points[0]
        : { x: liveCursorScenePoint.x, y: liveCursorScenePoint.y, handleOut: null, handleIn: null }
      ctx.beginPath()
      ctx.moveTo(viewports[viewports.length - 1].x, viewports[viewports.length - 1].y)
      pathSegmentOnCtx(ctx, last, previewTarget)
      ctx.setLineDash([4, 3])
      ctx.strokeStyle = colors.primaryStrong
      ctx.lineWidth = 1
      ctx.stroke()
      ctx.setLineDash([])
    }

    // ── 各落点圆圈 ──：悬停命中点用缓动半径放大；>=3 点且光标在首点容差内时高亮首点提示可闭合。
    const canClose =
      points.length >= 3
      && !!liveCursorScenePoint
      && distance(sceneToViewport(liveCursorScenePoint), viewports[0]) <= CLOSE_THRESHOLD_VIEWPORT
    for (let i = 0; i < viewports.length; i++) {
      const isFirst = i === 0
      const radius = isFirst && canClose ? POINT_RADIUS_HOVERED : (hoverRadiusByIndex[i] ?? POINT_RADIUS_BASE)
      ctx.beginPath()
      ctx.arc(viewports[i].x, viewports[i].y, radius, 0, Math.PI * 2)
      ctx.fillStyle = isFirst && canClose ? colors.primaryStrong : colors.primary
      ctx.fill()
      ctx.lineWidth = 2
      ctx.strokeStyle = colors.primary
      ctx.stroke()
      // 中心小白点增强可读性（参考 renderPointControl 的已提交样式）。
      ctx.beginPath()
      ctx.arc(viewports[i].x, viewports[i].y, Math.max(1, radius - 2.5), 0, Math.PI * 2)
      ctx.fillStyle = colors.textOnPrimary
      ctx.fill()
    }

    ctx.restore()
  }

  const controller: HomePenToolController = {
    commands: {
      activate,
      deactivate,
      handlePenLeftDown,
      handlePenRightClick,
      handlePenPointerMove,
      handlePenPointerUp,
      handlePenEnter,
      drawPenOverlay
    },
    state: {
      penToolActive,
      penPoints,
      penHoverIndex,
      penRenderTick
    }
  }

  const module: EditorModule = {
    name: 'home-pen-tool',
    onDispose() {
      resetPenState()
      penToolActive.value = false
    }
  }

  return { controller, module }
}
