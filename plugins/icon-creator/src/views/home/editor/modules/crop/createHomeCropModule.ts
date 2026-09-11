import { Control, FabricImage, Rect, controlsUtils, util, type Canvas, type FabricObject } from 'fabric'
import { ref, type Ref, type ShallowRef } from 'vue'
import {
  applyBitmapCropSourceRect,
  computeBitmapCropFromOverlayRect,
  type BitmapCropSourceRect
} from '../../../fabric/imageCrop'

/**
 * 位图裁剪会话模块：进入裁剪模式后在图片上方放置一块与图片共享变换（角度/缩放/斜切一致）的
 * 覆盖层矩形，用户用 8 个缩放手柄拖出裁剪区域；确认时把覆盖层矩形换算为图片源像素区域
 * 写入 fabric 原生 cropX/cropY/width/height（图片元素不动，支持连续裁剪与序列化 round-trip）。
 *
 * 会话期间：
 * - 覆盖层矩形标记 excludeFromExport，撤销快照 / 草稿 / 工程保存都不会把它序列化进画布；
 * - 裁剪区域外通过 contextTop 绘制半透明遮罩提示（after:render 钩子重绘）；
 * - Esc / 取消按钮 / 点击其他对象 / 撤销重做 / 图片被删除都会静默退出且不留任何脏数据。
 */

type CanvasAssistColors = {
  primary: string
  primaryStrong: string
}

export interface CreateHomeCropModuleOptions {
  activeObject: ShallowRef<FabricObject | null>
  getCanvasAssistColors: () => CanvasAssistColors
  getFabricCanvas: () => Canvas | null
  /** 裁剪应用成功后的运行时收尾：刷新面板/图层、触发万花筒同步并提交一条撤销记录。 */
  onCropApplied: (image: FabricImage, description: string) => void
  /** 裁剪区域过小等用户可纠正的错误提示。 */
  showToast: (message: string, type?: 'success' | 'error' | 'info' | 'warning') => void
}

export interface HomeCropState {
  cropModeActive: Ref<boolean>
}

export interface HomeCropCommands {
  /** 对当前选中的单个位图进入裁剪模式；目标不是位图时返回 false。 */
  beginCropSession: () => boolean
  /** 应用当前覆盖层区域为裁剪结果（一条撤销记录），并退出裁剪模式。 */
  confirmCropSession: () => boolean
  /**
   * 退出裁剪模式且不修改图片（取消语义）：移除覆盖层、恢复选中、不留撤销记录。
   * 供 Esc、取消按钮、撤销/重做守卫与选区变更守卫共同调用，可安全重复调用。
   */
  cancelCropSession: () => void
  isCropSessionActive: () => boolean
}

export interface HomeCropController {
  commands: HomeCropCommands
  state: HomeCropState
}

export interface CreateHomeCropModuleResult {
  controller: HomeCropController
  module: import('../../runtime/editorTypes').EditorModule
}

/** 裁剪会话的运行期上下文：覆盖层矩形、目标图片与画布事件解绑器。 */
type CropSession = {
  image: FabricImage
  overlay: Rect
  detachEvents: () => void
}

/**
 * 创建位图裁剪模块。模块自身维护"至多一个活动会话"的互斥状态，
 * 事件监听在进入会话时挂载、退出时解绑，避免常驻监听干扰普通编辑。
 */
export function createHomeCropModule(options: CreateHomeCropModuleOptions): CreateHomeCropModuleResult {
  const cropModeActive = ref(false)
  let session: CropSession | null = null

  /** 构建裁剪覆盖层的 8 个缩放手柄：四角等比缩放、四边单轴缩放，无旋转无斜切手柄。 */
  function createCropControls(): Record<string, Control> {
    const corner = (x: number, y: number) =>
      new Control({
        x,
        y,
        cursorStyleHandler: controlsUtils.scaleCursorStyleHandler,
        actionHandler: controlsUtils.scalingEqually
      })
    const edgeX = (x: number) =>
      new Control({
        x,
        y: 0,
        cursorStyleHandler: controlsUtils.scaleCursorStyleHandler,
        actionHandler: controlsUtils.scalingX
      })
    const edgeY = (y: number) =>
      new Control({
        x: 0,
        y,
        cursorStyleHandler: controlsUtils.scaleCursorStyleHandler,
        actionHandler: controlsUtils.scalingY
      })
    return {
      tl: corner(-0.5, -0.5),
      tr: corner(0.5, -0.5),
      br: corner(0.5, 0.5),
      bl: corner(-0.5, 0.5),
      ml: edgeX(-0.5),
      mr: edgeX(0.5),
      mt: edgeY(-0.5),
      mb: edgeY(0.5)
    }
  }

  /**
   * 在 contextTop 上绘制裁剪遮罩：整屏半透明黑 + destination-out 打出裁剪区域孔洞，
   * 再沿覆盖层四角描一圈主色边框，让保留区域外的内容全部变暗。
   * 坐标基与点编辑框选 marquee 一致：viewport 像素 + contextTop 环境变换（含 DPR），不重置变换矩阵。
   */
  function drawCropOverlay() {
    const canvas = options.getFabricCanvas()
    const current = session
    if (!canvas || !current) return
    const ctx = (canvas as unknown as { getTopContext?: () => CanvasRenderingContext2D }).getTopContext?.()
      ?? (canvas as unknown as { contextTop?: CanvasRenderingContext2D }).contextTop
    if (!ctx) return
    const width = canvas.getWidth()
    const height = canvas.getHeight()
    const viewportTransform = canvas.viewportTransform
    const corners = current.overlay.getCoords().map((point) => util.transformPoint(point, viewportTransform))
    if (!corners.length) return
    const colors = options.getCanvasAssistColors()
    ctx.save()
    ctx.fillStyle = 'rgba(0, 0, 0, 0.45)'
    ctx.fillRect(0, 0, width, height)
    ctx.globalCompositeOperation = 'destination-out'
    ctx.beginPath()
    corners.forEach((point, index) => {
      if (index === 0) ctx.moveTo(point.x, point.y)
      else ctx.lineTo(point.x, point.y)
    })
    ctx.closePath()
    ctx.fill()
    ctx.globalCompositeOperation = 'source-over'
    ctx.beginPath()
    corners.forEach((point, index) => {
      if (index === 0) ctx.moveTo(point.x, point.y)
      else ctx.lineTo(point.x, point.y)
    })
    ctx.closePath()
    ctx.strokeStyle = colors.primaryStrong
    ctx.lineWidth = 1
    ctx.stroke()
    ctx.restore()
  }

  /** 把覆盖层矩形设为活动对象并重绘，让 fabric 的手柄与遮罩立即生效。 */
  function focusOverlay(canvas: Canvas) {
    const current = session
    if (!current) return
    canvas.setActiveObject(current.overlay)
    canvas.requestRenderAll()
  }

  /** 清理会话状态并移除覆盖层；restoreSelection 时把选中焦点还给目标图片。 */
  function teardownSession(restoreSelection: boolean) {
    const current = session
    if (!current) return
    session = null
    cropModeActive.value = false
    current.detachEvents()
    const canvas = options.getFabricCanvas()
    if (canvas) {
      if (canvas.getObjects().includes(current.overlay)) {
        canvas.remove(current.overlay)
      }
      if (restoreSelection && canvas.getObjects().includes(current.image)) {
        canvas.setActiveObject(current.image)
      }
      canvas.requestRenderAll()
    }
  }

  /**
   * 对当前选中的单个位图进入裁剪模式：
   * 覆盖层矩形复刻图片的完整变换矩阵（left/top/scale/angle/flip/skew），两本地坐标系重合，
   * 用户对覆盖层的拖拽/缩放可直接换算为图片本地裁剪矩形。
   */
  function beginCropSession(): boolean {
    const canvas = options.getFabricCanvas()
    const target = options.activeObject.value
    if (!canvas || session || !(target instanceof FabricImage)) return false
    // 图片元素未加载完成（源尺寸为 0）时无法确定裁剪区域，拒绝进入会话。
    if (!(Number(target.width ?? 0) > 0) || !(Number(target.height ?? 0) > 0)) {
      options.showToast('图片尚未加载完成，稍后再试', 'warning')
      return false
    }
    const center = target.getCenterPoint()
    const overlay = new Rect({
      width: target.width,
      height: target.height,
      scaleX: target.scaleX,
      scaleY: target.scaleY,
      angle: target.angle,
      flipX: target.flipX,
      flipY: target.flipY,
      skewX: target.skewX,
      skewY: target.skewY,
      originX: 'center',
      originY: 'center',
      left: center.x,
      top: center.y,
      fill: 'transparent',
      stroke: options.getCanvasAssistColors().primary,
      strokeWidth: 1,
      strokeUniform: true,
      strokeDashArray: [6, 4],
      cornerColor: '#ffffff',
      cornerStrokeColor: options.getCanvasAssistColors().primary,
      cornerStyle: 'circle',
      cornerSize: 8,
      transparentCorners: false,
      lockRotation: true,
      excludeFromExport: true,
      objectCaching: false
    })
    overlay.controls = createCropControls()

    // 选区/删除守卫：任何把焦点移出覆盖层的操作（点击其他对象、点击空白、删除图片）都退出裁剪。
    // 事件参数不直接使用，统一以画布当前活动对象判断，规避 fabric 泛型事件签名的兼容问题。
    const handleSelectionChanged = () => {
      if (!session) return
      if (options.getFabricCanvas()?.getActiveObject() === session.overlay) return
      teardownSession(true)
    }
    const handleSelectionCleared = () => {
      // fabric 点击空白会先清选区：若清空后活动对象不是覆盖层则退出会话。
      if (!session) return
      if (options.getFabricCanvas()?.getActiveObject() !== session.overlay) {
        teardownSession(true)
      }
    }
    const handleObjectRemoved = (event: { target: FabricObject }) => {
      if (!session) return
      if (event.target === session.image || event.target === session.overlay) {
        teardownSession(false)
      }
    }

    canvas.add(overlay)
    canvas.bringObjectToFront(overlay)
    session = { image: target, overlay, detachEvents: detach }
    cropModeActive.value = true

    function detach() {
      canvas.off('selection:created', handleSelectionChanged)
      canvas.off('selection:updated', handleSelectionChanged)
      canvas.off('selection:cleared', handleSelectionCleared)
      canvas.off('object:removed', handleObjectRemoved)
      canvas.off('after:render', drawCropOverlay)
    }

    canvas.on('selection:created', handleSelectionChanged)
    canvas.on('selection:updated', handleSelectionChanged)
    canvas.on('selection:cleared', handleSelectionCleared)
    canvas.on('object:removed', handleObjectRemoved)
    canvas.on('after:render', drawCropOverlay)
    focusOverlay(canvas)
    return true
  }

  /** 应用裁剪：换算覆盖层区域 → 写入 cropX/cropY/width/height → 提交一条撤销记录。 */
  function confirmCropSession(): boolean {
    const current = session
    const canvas = options.getFabricCanvas()
    if (!current || !canvas) return false
    const sourceRect: BitmapCropSourceRect | null = computeBitmapCropFromOverlayRect(current.image, current.overlay)
    if (!sourceRect) {
      options.showToast('裁剪区域过小，请拖大裁剪框后再确认', 'warning')
      return false
    }
    const image = current.image
    teardownSession(true)
    applyBitmapCropSourceRect(image, sourceRect)
    image.setCoords()
    canvas.requestRenderAll()
    const name = String((image as unknown as { name?: unknown }).name ?? '图片')
    options.onCropApplied(image, `裁剪位图: ${name}`)
    return true
  }

  /** 取消裁剪：图片保持进入裁剪前的状态，不留撤销记录与脏数据。 */
  function cancelCropSession() {
    teardownSession(true)
  }

  function isCropSessionActive() {
    return !!session
  }

  const controller: HomeCropController = {
    commands: {
      beginCropSession,
      confirmCropSession,
      cancelCropSession,
      isCropSessionActive
    },
    state: { cropModeActive }
  }

  const module: import('../../runtime/editorTypes').EditorModule = {
    name: 'home-crop',
    onDispose() {
      teardownSession(false)
    }
  }

  return { controller, module }
}
