import { Canvas, type FabricObject } from 'fabric'
import type { Ref } from 'vue'
import { AligningGuidelines } from '../../../../../fabric-aligning-guidelines'
import type { EditorModule } from '../../runtime/editorTypes'

type HomeCanvasSelectionMode = 'shape' | 'point' | 'segment'

type CanvasAssistColors = {
  primary: string
  primaryOverlay: string
  primaryStrong: string
}

export interface HomeCanvasKernelController {
  applyBackground: (value: string) => void
  applyTheme: () => void
  applyThemeToObject: (obj: FabricObject | null | undefined) => void
  fitInView: () => void
  setZoom: (value: number) => void
  syncBackgroundFromCanvas: () => void
  syncInteractionMode: () => void
}

export interface CreateHomeCanvasKernelModuleOptions {
  getCanvas: () => Canvas | null
  setCanvas: (canvas: Canvas | null) => void
  canvasElRef: Ref<HTMLCanvasElement | null>
  canvasAreaRef: Ref<HTMLElement | null>
  canvasWidth: Ref<number>
  canvasHeight: Ref<number>
  canvasBg: Ref<string>
  lastOpaqueCanvasBg: Ref<string>
  zoom: Ref<number>
  panX: Ref<number>
  panY: Ref<number>
  sizeRatioLocked: Ref<boolean>
  selectionMode: Ref<HomeCanvasSelectionMode>
  snapToPixelGrid: Ref<boolean>
  /** 工具态选择抑制开关（钢笔/油漆桶激活时为 true）：禁用框选并跳过命中，避免点击对象被选中/拖拽。 */
  suppressSelection: Ref<boolean>
  isTransparentCanvasBg: (value: unknown) => boolean
  getCanvasAssistColors: () => CanvasAssistColors
  getAligningObjectsByTarget: (target: FabricObject) => Iterable<FabricObject>
  ensureCanvasObjectMetadata: () => void
  setupCanvasEvents: () => void
}

export interface CreateHomeCanvasKernelModuleResult {
  controller: HomeCanvasKernelController
  module: EditorModule
}

/**
 * 创建 Home 编辑器的 Canvas Kernel，统一接管 Fabric Canvas 的生命周期、主题、缩放和对齐辅助线初始化。
 * 页面层继续保留业务回调，但不再持有画布创建/销毁与基础视口编排细节。
 */
export function createHomeCanvasKernelModule(
  options: CreateHomeCanvasKernelModuleOptions
): CreateHomeCanvasKernelModuleResult {
  let aligningGuidelines: AligningGuidelines | null = null

  /**
   * 根据当前主题刷新单个对象的控制点和边框样式，保证新建、恢复和克隆对象都复用同一套视觉规则。
   */
  function applyThemeToObject(obj: FabricObject | null | undefined) {
    if (!obj) return
    const colors = options.getCanvasAssistColors()
    obj.set({
      borderColor: colors.primaryStrong,
      cornerColor: colors.primary,
      cornerStrokeColor: colors.primary,
      transparentCorners: true,
      cornerStyle: 'rect'
    })
    obj.setCoords()
  }

  /**
   * 将当前主题投影到 Fabric 选择框和现有对象，供主题切换与画布恢复后统一复用。
   */
  function applyTheme() {
    const canvas = options.getCanvas()
    if (!canvas) return
    const colors = options.getCanvasAssistColors()
    canvas.selectionColor = colors.primaryOverlay
    canvas.selectionBorderColor = colors.primaryStrong
    canvas.selectionLineWidth = 1
    canvas.forEachObject((obj) => {
      applyThemeToObject(obj)
    })
  }

  /**
   * 同步画布的交互模式，把选择模式、等比缩放和网格角度吸附统一映射到 Fabric 配置。
   * 工具态选择抑制（钢笔/油漆桶）优先于选择模式：保留命中检测（skipTargetFind 不动，
   * mouse:down:before 的 event.target 仍可用于边界上色判定），但禁用框选并取消全部对象的
   * selectable，使 Fabric 内置的 setActiveObject/拖拽不抢占"点画布产生效果"的工具点击。
   */
  function syncInteractionMode() {
    const canvas = options.getCanvas()
    if (!canvas) return
    const toolSuppress = options.suppressSelection.value
    canvas.selection = !toolSuppress && options.selectionMode.value === 'shape'
    canvas.uniformScaling = options.sizeRatioLocked.value
    canvas.getObjects().forEach((obj) => {
      obj.selectable = !toolSuppress
      obj.snapAngle = options.snapToPixelGrid.value ? 15 : undefined
    })
  }

  /**
   * 将响应式画布背景色写回 Fabric Canvas；透明背景保持空字符串，避免导出与预览出现额外底色。
   */
  function applyBackground(value: string) {
    const canvas = options.getCanvas()
    if (!canvas) return
    canvas.backgroundColor = options.isTransparentCanvasBg(value) ? '' : value
  }

  /**
   * 从 Fabric Canvas 回写当前背景色，供工程恢复或外部直接修改画布背景后同步响应式状态。
   */
  function syncBackgroundFromCanvas() {
    const canvas = options.getCanvas()
    if (!canvas) return
    const bg = canvas.backgroundColor
    if (options.isTransparentCanvasBg(bg)) {
      options.canvasBg.value = 'transparent'
      return
    }
    const next = String(bg)
    options.canvasBg.value = next
    options.lastOpaqueCanvasBg.value = next
  }

  /**
   * 统一设置缩放比例并同步 Fabric 内部 viewport 尺寸，避免页面反复重复 setZoom / setDimensions 细节。
   */
  function setZoom(value: number) {
    const canvas = options.getCanvas()
    if (!canvas) return
    options.zoom.value = Math.round(Math.max(0.1, Math.min(5, value)) * 100) / 100
    canvas.setZoom(options.zoom.value)
    canvas.setDimensions({
      width: options.canvasWidth.value * options.zoom.value,
      height: options.canvasHeight.value * options.zoom.value
    })
    canvas.requestRenderAll()
  }

  /**
   * 按当前画布尺寸和容器可视区域计算适配缩放，并把画布重置到容器中心附近作为新的初始视图。
   */
  function fitInView() {
    const canvas = options.getCanvas()
    const area = options.canvasAreaRef.value
    if (!canvas || !area) return
    const scaleX = (area.clientWidth - 40) / options.canvasWidth.value
    const scaleY = (area.clientHeight - 40) / options.canvasHeight.value
    setZoom(Math.min(scaleX, scaleY, 1))
    const centeredX = Math.max(20, (area.clientWidth - options.canvasWidth.value * options.zoom.value) / 2)
    const centeredY = Math.max(20, (area.clientHeight - options.canvasHeight.value * options.zoom.value) / 2)
    options.panX.value = centeredX
    options.panY.value = centeredY
  }

  /**
   * 初始化对齐辅助线实例；重复执行时会先释放旧实例，避免事件和绘制状态残留。
   */
  function initAligningGuidelines() {
    const canvas = options.getCanvas()
    if (!canvas) return
    aligningGuidelines?.dispose()
    aligningGuidelines = new AligningGuidelines(canvas, {
      margin: 4,
      width: 1,
      color: () => options.getCanvasAssistColors().primaryStrong,
      getObjectsByTarget: options.getAligningObjectsByTarget
    })
  }

  /**
   * 创建 Fabric Canvas 并接入 runtime 上下文；当前阶段仍由页面提供业务级事件处理回调。
   */
  const module: EditorModule = {
    name: 'home-canvas-kernel',
    onMount(context) {
      if (!options.canvasElRef.value) return
      const canvas = new Canvas(options.canvasElRef.value, {
        width: options.canvasWidth.value,
        height: options.canvasHeight.value,
        backgroundColor: options.isTransparentCanvasBg(options.canvasBg.value) ? '' : options.canvasBg.value,
        preserveObjectStacking: true,
        selection: true,
        selectionKey: ['shiftKey', 'ctrlKey'],
        uniformScaling: options.sizeRatioLocked.value
      })

      // 阻止 canvas 元素的默认右键菜单，确保自定义上下文菜单能够正常显示
      const canvasEl = options.canvasElRef.value
      if (canvasEl) {
        canvasEl.addEventListener('contextmenu', (e) => {
          e.preventDefault()
        })
      }

      options.setCanvas(canvas)
      context.setCanvas(canvas)
    },
    onCanvasReady() {
      options.ensureCanvasObjectMetadata()
      applyTheme()
      syncInteractionMode()
      initAligningGuidelines()
      options.setupCanvasEvents()
    },
    onDispose(context) {
      aligningGuidelines?.dispose()
      aligningGuidelines = null
      options.getCanvas()?.dispose()
      options.setCanvas(null)
      context.setCanvas(null)
    }
  }

  return {
    controller: {
      applyBackground,
      applyTheme,
      applyThemeToObject,
      fitInView,
      setZoom,
      syncBackgroundFromCanvas,
      syncInteractionMode
    },
    module
  }
}
