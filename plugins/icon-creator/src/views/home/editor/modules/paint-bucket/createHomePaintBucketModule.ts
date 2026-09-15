import type { Canvas, FabricObject } from 'fabric'
import { ref, type Ref } from 'vue'
import type { EditorModule } from '../../runtime/editorTypes'
import {
  collectObjectsContainingPoint,
  isSolidFillMatched,
  isSolidStrokeMatched,
  resolvePaintRegionHit,
  type PaintPoint
} from '../../../geometry/paintRegion'

/**
 * 油漆桶点击结果统计。
 * - target：命中的目标对象（区域命中时为区域包含点击点的最上层对象；边界命中时为 Fabric 命中对象）；
 * - mode：行为模式（fill=改填充色，stroke=改描边色）；
 * - skipped：因已是目标纯色而跳过的对象数。
 */
export type PaintBucketApplyResult = {
  applied: boolean
  mode: PaintBucketBehavior
  target: FabricObject | null
  skipped: number
}

/** 油漆桶上色行为：fill = 改填充色（默认），stroke = 改描边色。 */
export type PaintBucketBehavior = 'fill' | 'stroke'

export interface HomePaintBucketState {
  paintBucketActive: Ref<boolean>
  /** 前景颜料（上色用色，PS 语义：上层色块）。 */
  paintForegroundColor: Ref<string>
  /** 背景颜料（备用色，PS 语义：下层色块，与前景可交换）。 */
  paintBackgroundColor: Ref<string>
  /** 点击画布时改填充还是描边（hover 弹窗内切换）。 */
  paintBehavior: Ref<PaintBucketBehavior>
}

export interface HomePaintBucketCommands {
  activate: () => void
  deactivate: () => void
  /** 处理画布左键按下：按当前行为模式对命中对象上色；返回结果供页面层提交撤销记录与提示。 */
  handlePaintBucketClick: (scenePoint: PaintPoint, fabricTarget: FabricObject | null | undefined) => PaintBucketApplyResult
  /** 预判点击点命中类型（hover 光标/状态提示用）：inside=有可上色区域，boundary=命中对象本体，null=无效果。 */
  previewHitAt: (scenePoint: PaintPoint, fabricTarget: FabricObject | null | undefined) => 'inside' | 'boundary' | null
  /** 设置前景颜料（页面层色板/颜色选择器入口）。 */
  setForegroundColor: (color: string) => void
  /** 设置背景颜料。 */
  setBackgroundColor: (color: string) => void
  /** 交换前景/背景颜料（PS 式色块交换语义）。 */
  swapColors: () => void
  /** 切换上色行为：fill ↔ stroke（工具栏 hover 弹窗内的行为开关）。 */
  toggleBehavior: () => void
  /** 设置上色行为（弹窗内两个选项按钮共用）。 */
  setBehavior: (behavior: PaintBucketBehavior) => void
}

export interface HomePaintBucketController {
  commands: HomePaintBucketCommands
  state: HomePaintBucketState
}

export interface CreateHomePaintBucketModuleOptions {
  getFabricCanvas: () => Canvas | null
  /** 前景颜料种子（缺省黑，PS 语义：上色用的颜色）。 */
  getForegroundColor?: () => string
  /** 背景颜料种子（缺省白，PS 语义：备用色）。 */
  getBackgroundColor?: () => string
  /** 候选对象列表（画布顶层对象，z 序递增）；缺省时回退画布全量对象并排除排除项。 */
  getPaintCandidates?: () => FabricObject[]
  /** 不可作为油漆桶目标的对象（布尔预览、万花筒实例等）。 */
  isExcludedTarget: (obj: FabricObject | null | undefined) => boolean
  /** 对象填充色应用回调（页面层实现：写 lastFill 元数据、触发万花筒同步、重渲染、快照等）。
   * 返回 false 表示对象不接受填充（如位图）。
   */
  applyObjectFill: (obj: FabricObject, color: string) => boolean
  /** 对象描边色应用回调（页面层实现含描边宽度补齐逻辑）。 */
  applyObjectStroke: (obj: FabricObject, color: string) => boolean
}

export interface CreateHomePaintBucketModuleResult {
  controller: HomePaintBucketController
  module: EditorModule
}

/** 前景/背景颜料默认值（与 PS 一致：前景黑、背景白）。 */
export const DEFAULT_PAINT_FOREGROUND_COLOR = '#000000'
export const DEFAULT_PAINT_BACKGROUND_COLOR = '#ffffff'

/**
 * 创建油漆桶工具模块：激活后点击画布，按当前行为模式对鼠标所在的目标上色。
 *
 * 颜料与行为模型（与 PS 工具栏语义对齐）：
 * - 前景/背景双颜料独立于画布选中对象，默认黑/白，跨激活持久；
 *   点击上色始终使用前景色，背景色仅作备用（可与前景交换）；
 * - 行为模式 fill/stroke 由工具栏 hover 弹窗切换，决定点击改填充色还是描边色：
 *   - fill：点击落在对象封闭区域内即把该对象填充改为前景色；
 *     多层重叠时取最上层（视觉上最先被"泼到"的对象）；
 *     区域判定只看几何（paintRegion 按 fabric 矩阵上屏），不看 fill 状态——
 *     未开启填充（transparent）的目标同样命中，由页面层写色即自动开启填充；
 *   - stroke：点击命中对象本体（Fabric 命中描边/路径/填充区）即把该对象描边改为前景色；
 * - 空白区域点击不产生效果（画布背景保持专用设置入口，不参与油漆桶）。
 *
 * 模块只维护激活状态、颜料与点击判定；对象排除规则、上色副作用通过注入回调回到页面层，
 * 与钢笔工具的模块划分保持一致。
 */
export function createHomePaintBucketModule(
  options: CreateHomePaintBucketModuleOptions
): CreateHomePaintBucketModuleResult {
  const paintBucketActive = ref(false)
  // PS 式双颜料：构造时种子一次（缺省黑/白），此后跨激活持久，不随选中对象或外部颜色源变化。
  const paintForegroundColor = ref(options.getForegroundColor?.() ?? DEFAULT_PAINT_FOREGROUND_COLOR)
  const paintBackgroundColor = ref(options.getBackgroundColor?.() ?? DEFAULT_PAINT_BACKGROUND_COLOR)
  const paintBehavior = ref<PaintBucketBehavior>('fill')

  /**
   * 激活油漆桶工具（已激活则退出）；激活时清空活动选区，
   * 避免选中框干扰区域判定视觉。颜料与行为模式跨激活保留（PS 语义）。
   */
  function activate() {
    if (paintBucketActive.value) {
      paintBucketActive.value = false
      return
    }
    paintBucketActive.value = true
    options.getFabricCanvas()?.discardActiveObject()
    options.getFabricCanvas()?.requestRenderAll()
  }

  /** 退出油漆桶工具（无中间态需要提交，直接复位激活标志）。 */
  function deactivate() {
    paintBucketActive.value = false
  }

  /** 设置前景颜料；非法值静默忽略，保持上次有效颜色。 */
  function setForegroundColor(color: string) {
    if (typeof color !== 'string' || !color.trim()) return
    paintForegroundColor.value = color
  }

  /** 设置背景颜料；非法值静默忽略，保持上次有效颜色。 */
  function setBackgroundColor(color: string) {
    if (typeof color !== 'string' || !color.trim()) return
    paintBackgroundColor.value = color
  }

  /** 交换前景/背景颜料。 */
  function swapColors() {
    const foreground = paintForegroundColor.value
    paintForegroundColor.value = paintBackgroundColor.value
    paintBackgroundColor.value = foreground
  }

  /** 切换上色行为（fill ↔ stroke）。 */
  function toggleBehavior() {
    paintBehavior.value = paintBehavior.value === 'fill' ? 'stroke' : 'fill'
  }

  /** 设置上色行为；非法值静默忽略。 */
  function setBehavior(behavior: PaintBucketBehavior) {
    if (behavior !== 'fill' && behavior !== 'stroke') return
    paintBehavior.value = behavior
  }

  /**
   * 收集参与区域判定的候选对象：优先注入的候选列表，缺省回退画布全量对象；
   * 排除项（布尔预览、万花筒实例等）一律不参与。
   */
  function collectCandidates(): FabricObject[] {
    const fabricCanvas = options.getFabricCanvas()
    if (!fabricCanvas) return []
    const objects = options.getPaintCandidates
      ? options.getPaintCandidates()
      : fabricCanvas.getObjects()
    return objects.filter((obj) => !options.isExcludedTarget(obj))
  }

  /**
   * 处理油漆桶点击（按行为模式分派）：
   * - fill：几何区域判定——收集区域包含点击点的全部对象，从最上层开始应用前景色；
   * - stroke：Fabric 命中对象（含排除项回退到区域判定的对象，见下）时应用描边前景色；
   * - 全部候选已是目标纯色时跳过（applied=false, skipped=n），避免产生空撤销记录。
   */
  function handlePaintBucketClick(
    scenePoint: PaintPoint,
    fabricTarget: FabricObject | null | undefined
  ): PaintBucketApplyResult {
    const skipped = { applied: false, mode: paintBehavior.value, target: null, skipped: 0 }
    if (!paintBucketActive.value) return skipped
    const color = paintForegroundColor.value
    const isFillMode = paintBehavior.value === 'fill'

    // ── 描边行为：Fabric 命中的可交互对象，把描边改为前景色 ──
    if (!isFillMode) {
      const strokeTarget = fabricTarget && !options.isExcludedTarget(fabricTarget)
        ? fabricTarget
        // 未命中本体（或命中排除项）时回退区域判定：点击封闭区域内最上层对象
        : topCandidateAt(scenePoint)
      if (!strokeTarget) return skipped
      if (isSolidStrokeMatched(strokeTarget, color)) {
        return { ...skipped, mode: 'stroke', target: strokeTarget, skipped: 1 }
      }
      const applied = options.applyObjectStroke(strokeTarget, color)
      return { applied, mode: 'stroke', target: strokeTarget, skipped: applied ? 0 : 1 }
    }

    // ── 填充行为：几何判定封闭区域，从最上层开始应用前景色 ──
    const candidates = collectCandidates()
    // collectObjectsContainingPoint 保持对象列表顺序（z 序递增）；
    // 从后往前遍历即"最上层优先"，命中第一个成功应用的对象即止。
    const containing = collectObjectsContainingPoint(scenePoint, candidates)
    for (let index = containing.length - 1; index >= 0; index -= 1) {
      const target = containing[index] as FabricObject
      if (isSolidFillMatched(target, color)) continue
      const applied = options.applyObjectFill(target, color)
      if (applied) {
        return { applied: true, mode: 'fill', target, skipped: 0 }
      }
    }
    const skippedCount = containing.filter((obj) => isSolidFillMatched(obj, color)).length
    return { ...skipped, mode: 'fill', target: null, skipped: skippedCount }
  }

  /** 点击点所在封闭区域的最上层候选对象（描边行为无本体命中时的回退目标）。 */
  function topCandidateAt(scenePoint: PaintPoint): FabricObject | null {
    const candidates = collectCandidates()
    const containing = collectObjectsContainingPoint(scenePoint, candidates)
    return containing.length ? (containing[containing.length - 1] as FabricObject) : null
  }

  /**
   * 预判点击点相对候选对象的命中类型，用于 hover 光标预览。
   * 返回 'inside'（将上填充色）/ 'boundary'（将上描边色）/ null（无效果区域）。
   */
  function previewHitAt(scenePoint: PaintPoint, fabricTarget: FabricObject | null | undefined): 'inside' | 'boundary' | null {
    if (!paintBucketActive.value) return null
    const hasBodyHit = !!fabricTarget && !options.isExcludedTarget(fabricTarget)
    const hasRegionHit = topCandidateAt(scenePoint) !== null
    // 点击始终有效即可上色（区域命中或对象本体命中都能落到 paintBehavior 对应语义上）。
    return hasBodyHit || hasRegionHit ? 'inside' : null
  }

  const controller: HomePaintBucketController = {
    commands: {
      activate,
      deactivate,
      handlePaintBucketClick,
      previewHitAt,
      setForegroundColor,
      setBackgroundColor,
      swapColors,
      toggleBehavior,
      setBehavior
    },
    state: {
      paintBucketActive,
      paintForegroundColor,
      paintBackgroundColor,
      paintBehavior
    }
  }

  const module: EditorModule = {
    name: 'home-paint-bucket',
    onDispose() {
      paintBucketActive.value = false
    }
  }

  return { controller, module }
}
