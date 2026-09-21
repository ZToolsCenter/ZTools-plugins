import { ActiveSelection, Group, type Canvas, type FabricObject } from 'fabric'
import { computed, ref, type ComputedRef, type Ref } from 'vue'

export interface HomeSelectionState {
  canAlignSelection: ComputedRef<boolean>
  canBoolean: ComputedRef<boolean>
  canConvertStrokeSelection: ComputedRef<boolean>
  canConvertTextSelection: ComputedRef<boolean>
  canDirectionalSubtract: ComputedRef<boolean>
  canDistributeSelection: ComputedRef<boolean>
  canGroup: ComputedRef<boolean>
  canSaveUserAsset: ComputedRef<boolean>
  canUngroup: ComputedRef<boolean>
  canVectorizeBitmapSelection: ComputedRef<boolean>
  hasKaleidoscopeSelection: ComputedRef<boolean>
  layerVersion: Ref<number>
  selectedObjects: ComputedRef<FabricObject[]>
}

export interface HomeSelectionCommands {
  refreshLayers: () => void
}

export interface HomeSelectionController {
  commands: HomeSelectionCommands
  state: HomeSelectionState
}

export interface CreateHomeSelectionModuleOptions {
  activeObject: Ref<FabricObject | null>
  getCurrentCopyTargets: () => FabricObject[]
  getFabricCanvas: () => Canvas | null
  getSelectedLayoutTargets: () => FabricObject[]
  getStrokeOutlineUnsupportedReason: (obj: FabricObject) => string | null
  isBitmapObject: (obj: FabricObject) => boolean
  isKaleidoscopeObject: (obj: FabricObject | null | undefined) => boolean
  isKaleidoscopeInstance: (obj: FabricObject | null | undefined) => boolean
  isTextObject: (obj: FabricObject) => boolean
  isBooleanCandidate: (obj: FabricObject) => boolean
  bitmapTraceBusy: Ref<boolean>
  booleanBusy: Ref<boolean>
  strokeOutlineBusy: Ref<boolean>
  textOutlineBusy: Ref<boolean>
}

export interface CreateHomeSelectionModuleResult {
  controller: HomeSelectionController
}

/**
 * 创建 Selection / Inspector 投影控制器，集中维护当前选择、图层刷新版本和右侧面板可操作性判断。
 * 页面层继续执行具体命令，面板只消费这里投影出的 selectedObjects / canXxx 状态，避免到处重复读取 Fabric 选区细节。
 */
export function createHomeSelectionModule(
  options: CreateHomeSelectionModuleOptions
): CreateHomeSelectionModuleResult {
  const layerVersion = ref(0)

  const selectedObjects = computed(() => {
    void layerVersion.value
    return options.getFabricCanvas()?.getActiveObjects() ?? []
  })

  const hasKaleidoscopeSelection = computed(() => selectedObjects.value.some((obj) => options.isKaleidoscopeObject(obj)))

  const hasKaleidoscopeInstanceSelection = computed(() => selectedObjects.value.some((obj) => options.isKaleidoscopeInstance(obj)))

  const canGroup = computed(() => {
    const obj = options.activeObject.value
    return obj instanceof ActiveSelection && (obj as ActiveSelection).size() > 1
  })

  const canUngroup = computed(() => {
    const obj = options.activeObject.value
    return obj instanceof Group && !(obj instanceof ActiveSelection)
  })

  const canAlignSelection = computed(() => {
    void options.activeObject.value
    void layerVersion.value
    return options.getSelectedLayoutTargets().length >= 2
  })

  const canDistributeSelection = computed(() => {
    void options.activeObject.value
    void layerVersion.value
    return options.getSelectedLayoutTargets().length >= 3
  })

  const canBoolean = computed(() => {
    return !options.booleanBusy.value
      && !hasKaleidoscopeInstanceSelection.value
      && selectedObjects.value.length >= 2
      && selectedObjects.value.every((obj) => options.isBooleanCandidate(obj))
  })

  const canConvertStrokeSelection = computed(() => {
    return !options.strokeOutlineBusy.value
      && selectedObjects.value.length > 0
      && selectedObjects.value.every((obj) => options.getStrokeOutlineUnsupportedReason(obj) == null)
  })

  const canConvertTextSelection = computed(() => {
    return !options.textOutlineBusy.value
      && selectedObjects.value.length > 0
      && selectedObjects.value.every((obj) => options.isTextObject(obj))
  })

  const canVectorizeBitmapSelection = computed(() => {
    return !options.bitmapTraceBusy.value
      && selectedObjects.value.length > 0
      && selectedObjects.value.every((obj) => options.isBitmapObject(obj))
  })

  const canDirectionalSubtract = computed(() => canBoolean.value && selectedObjects.value.length === 2)

  const canSaveUserAsset = computed(() => {
    void options.activeObject.value
    void layerVersion.value
    return options.getCurrentCopyTargets().length > 0
  })

  /**
   * 递增选择/图层投影版本号，驱动依赖 Fabric 内部对象数组的 computed 重新同步。
   */
  function refreshLayers() {
    layerVersion.value += 1
  }

  return {
    controller: {
      commands: {
        refreshLayers
      },
      state: {
        canAlignSelection,
        canBoolean,
        canConvertStrokeSelection,
        canConvertTextSelection,
        canDirectionalSubtract,
        canDistributeSelection,
        canGroup,
        canSaveUserAsset,
        canUngroup,
        canVectorizeBitmapSelection,
        hasKaleidoscopeSelection,
        layerVersion,
        selectedObjects
      }
    }
  }
}
