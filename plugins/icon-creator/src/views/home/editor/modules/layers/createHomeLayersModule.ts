import { computed, reactive, ref, shallowRef, watch, type ComputedRef, type Ref, type ShallowRef } from 'vue'
import type { Canvas, FabricObject } from 'fabric'
import type { AnyFabricObject } from '../../../fabric/objectMetadata'
import type { LayerContextMenuAction, LayerContextMenuItem, LayerContextMenuState, LayerItem, LayerRenameDialogState } from '../../../types'

type HomeSelectionMode = 'shape' | 'point' | 'segment'

export interface HomeLayersState {
  filteredLayers: ComputedRef<LayerItem[]>
  isLayerDragDisabled: ComputedRef<boolean>
  isLayerDragging: Ref<boolean>
  layerContextMenu: LayerContextMenuState
  layerContextMenuItems: ComputedRef<LayerContextMenuItem[]>
  layerDragItems: ShallowRef<LayerItem[]>
  layerRenameDialog: LayerRenameDialogState
  layerSearch: Ref<string>
}

export interface HomeLayersCommands {
  confirmLayerRename: () => void
  handleLayerContextMenuSelect: (key: string) => void
  handleLayerMouseDown: (obj: FabricObject, event: MouseEvent) => void
  handleLayerRenameDialogShowChange: (show: boolean) => void
  isLayerActive: (obj: FabricObject) => boolean
  openLayerContextMenu: (obj: FabricObject, event: MouseEvent) => void
  removeObject: (obj: FabricObject) => void
  reorderLayers: () => void
  /** 批量设置对象可见性（MCP 与右键菜单共用的底层入口）。 */
  setObjectsLocked: (objects: FabricObject[], locked: boolean) => void
  setObjectsVisible: (objects: FabricObject[], visible: boolean) => void
  toggleLock: (obj: FabricObject) => void
  toggleVisible: (obj: FabricObject) => void
}

export interface HomeLayersController {
  commands: HomeLayersCommands
  state: HomeLayersState
}

export interface CreateHomeLayersModuleOptions {
  activeObject: Ref<FabricObject | null>
  applyActiveObjectsSelection: (objects: FabricObject[], event?: MouseEvent) => void
  canGroup: ComputedRef<boolean>
  canSaveUserAsset: ComputedRef<boolean>
  canUngroup: ComputedRef<boolean>
  canPasteStyle: ComputedRef<boolean>
  clearBooleanPreview: () => void
  clearKaleidoscopeMetadata: (obj: FabricObject) => void
  copyStyle: () => void
  deleteObjects: (objects?: FabricObject[]) => void
  /** 解除选中对象的符号关联（符号实例转普通对象，一条撤销记录），见 symbols.ts 说明。 */
  detachSymbolInstances: (objects: FabricObject[]) => void
  duplicateSelection: () => Promise<boolean>
  ensureEditorObjectId: (obj: FabricObject | null | undefined) => string
  getFabricCanvas: () => Canvas | null
  getKaleidoscopeInstanceSourceId: (obj: FabricObject | null | undefined) => string
  findKaleidoscopeSourceById: (sourceId: string) => FabricObject | null
  groupObjects: () => void
  isBooleanPreviewObject: (obj: FabricObject | null | undefined) => boolean
  isKaleidoscopeInstance: (obj: FabricObject | null | undefined) => boolean
  /** 判断对象是否为符号实例（携带合法 symbolId / symbolInstanceId 元数据）。 */
  isSymbolInstance: (obj: FabricObject | null | undefined) => boolean
  layerBottom: () => void
  layerDown: () => void
  layerTop: () => void
  layerUp: () => void
  layerVersion: Ref<number>
  /** 打开「创建为符号」命名弹窗（以当前选区为内容）。 */
  openCreateSymbolDialog: () => void
  openCreateUserAssetDialog: () => void
  pasteStyle: () => void
  refreshActiveObject: () => void
  refreshLayers: () => void
  selectedObjects: ComputedRef<FabricObject[]>
  selectionMode: Ref<HomeSelectionMode>
  setKaleidoscopeInstanceManagedState: (obj: FabricObject, managed: boolean) => void
  setSelectionMode: (mode: HomeSelectionMode) => void
  snapshot: () => void
  syncObjProps: () => void
  triggerKaleidoscopeVisibilitySync: (obj: FabricObject | null | undefined) => void
  ungroupObject: () => void
  withSnapshotSuppressed: <T>(callback: () => T) => T
}

export interface CreateHomeLayersModuleResult {
  controller: HomeLayersController
}

/**
 * 创建图层面板模块，集中维护图层列表投影、搜索、拖拽排序、右键菜单和重命名弹窗状态。
 * 调用方提供实际对象操作命令，模块负责把面板事件翻译为稳定的图层工作流，避免页面继续拼接 LayerPanel 所需状态。
 */
export function createHomeLayersModule(options: CreateHomeLayersModuleOptions): CreateHomeLayersModuleResult {
  const layerSearch = ref('')
  const layerSelectionAnchorId = ref('')
  const layerDragItems = shallowRef<LayerItem[]>([])
  const isLayerDragging = ref(false)
  const layerContextMenu = reactive<LayerContextMenuState>({
    show: false,
    x: 0,
    y: 0
  })
  const layerRenameDialog = reactive({
    show: false,
    value: '',
    target: null as FabricObject | null
  })

  const filteredLayers = computed(() => {
    void options.layerVersion.value
    const fabricCanvas = options.getFabricCanvas()
    if (!fabricCanvas) return []
    const q = layerSearch.value.toLowerCase()
    const objects = fabricCanvas.getObjects()
    const items: LayerItem[] = []
    for (let i = objects.length - 1; i >= 0; i--) {
      const obj = objects[i]
      if (options.isBooleanPreviewObject(obj)) continue
      const name = (obj as AnyFabricObject).name || obj.type || '对象'
      if (!q || String(name).toLowerCase().includes(q)) {
        items.push({
          id: options.ensureEditorObjectId(obj),
          canvasIndex: i,
          name: String(name),
          obj
        })
      }
    }
    return items
  })

  const isLayerDragDisabled = computed(() => !!layerSearch.value.trim())

  const layerContextMenuTargets = computed(() => {
    const objects = options.selectedObjects.value.filter((obj) => !options.isBooleanPreviewObject(obj))
    if (objects.length) return objects
    const active = options.activeObject.value
    return active && !options.isBooleanPreviewObject(active) ? [active] : []
  })

  const singleLayerContextTarget = computed(() => (
    layerContextMenuTargets.value.length === 1 ? layerContextMenuTargets.value[0] : null
  ))

  const layerContextMenuSourceTarget = computed(() => {
    const target = singleLayerContextTarget.value
    return target && options.isKaleidoscopeInstance(target)
      ? options.findKaleidoscopeSourceById(options.getKaleidoscopeInstanceSourceId(target))
      : null
  })

  const canLayerContextDetach = computed(() => layerContextMenuTargets.value.some((obj) => options.isKaleidoscopeInstance(obj)))
  const canLayerContextSelectSource = computed(() => !!layerContextMenuSourceTarget.value)
  // 选中集合中存在符号实例时才允许解除符号关联（见 symbols.ts 说明）。
  const canLayerContextDetachSymbol = computed(() => layerContextMenuTargets.value.some((obj) => options.isSymbolInstance(obj)))
  const canLayerContextMove = computed(() => {
    const target = singleLayerContextTarget.value
    return !!target && !isLayerKaleidoscopeLocked(target)
  })

  const layerContextMenuItems = computed<LayerContextMenuItem[]>(() => {
    const targets = layerContextMenuTargets.value
    if (!targets.length) return []
    if (targets.length === 1) {
      const target = targets[0]
      const visible = target.visible !== false
      const locked = !!target.lockMovementX
      const isTop = target === filteredLayers.value[0]?.obj
      const isBottom = target === filteredLayers.value[filteredLayers.value.length - 1]?.obj
      return [
        { key: 'duplicate', label: '复制' },
        { type: 'separator' },
        { key: 'rename', label: '重命名' },
        { key: visible ? 'hide' : 'show', label: visible ? '隐藏' : '显示' },
        { key: locked ? 'unlock' : 'lock', label: locked ? '解锁' : '锁定' },
        { type: 'separator' },
        {
          type: 'icon-row',
          actions: [
            { key: 'move-up', icon: 'mdi:arrow-up', title: '上移一层', disabled: !canLayerContextMove.value || isTop },
            { key: 'move-top', icon: 'mdi:arrow-collapse-up', title: '上移到最顶层', disabled: !canLayerContextMove.value || isTop },
            { key: 'move-down', icon: 'mdi:arrow-down', title: '下移一层', disabled: !canLayerContextMove.value || isBottom },
            { key: 'move-bottom', icon: 'mdi:arrow-collapse-down', title: '下移到最底层', disabled: !canLayerContextMove.value || isBottom }
          ]
        },
        { type: 'separator' },
        { key: 'copy-style', label: '复制样式', icon: 'mdi:content-copy' },
        { key: 'paste-style', label: '粘贴样式', icon: 'mdi:content-paste', disabled: !options.canPasteStyle.value },
        { type: 'separator' },
        { key: 'delete', label: '删除', danger: true },
        { key: 'detach-source', label: '脱离源对象', disabled: !options.isKaleidoscopeInstance(target) },
        { key: 'select-source', label: '选中源对象', disabled: !canLayerContextSelectSource.value },
        { type: 'separator' },
        { key: 'save-user-asset', label: '保存到素材库', disabled: !options.canSaveUserAsset.value },
        { key: 'create-symbol', label: '创建为符号' },
        { key: 'detach-symbol', label: '解除符号关联', disabled: !options.isSymbolInstance(target) }
      ]
    }
    return [
      { key: 'duplicate', label: '复制' },
      { type: 'separator' },
      { key: 'group', label: '成组', disabled: !options.canGroup.value },
      { key: 'ungroup', label: '解组', disabled: !options.canUngroup.value },
      { key: 'save-user-asset', label: '保存到素材库', disabled: !options.canSaveUserAsset.value },
      { key: 'create-symbol', label: '创建为符号' },
      { key: 'delete', label: '删除', danger: true },
      { type: 'separator' },
      { key: 'copy-style', label: '复制样式', icon: 'mdi:content-copy' },
      { key: 'paste-style', label: '粘贴样式', icon: 'mdi:content-paste', disabled: !options.canPasteStyle.value },
      { type: 'separator' },
      { key: 'hide', label: '隐藏', disabled: !targets.some((obj) => obj.visible !== false) },
      { key: 'lock', label: '锁定', disabled: !targets.some((obj) => !obj.lockMovementX) },
      { key: 'unlock', label: '解锁', disabled: !targets.some((obj) => !!obj.lockMovementX) },
      { key: 'detach-source', label: '脱离源对象', disabled: !canLayerContextDetach.value },
      { key: 'detach-symbol', label: '解除符号关联', disabled: !canLayerContextDetachSymbol.value }
    ]
  })

  /**
   * 在非拖拽状态下用最新图层投影刷新 VueDraggable 的本地排序数据。
   */
  function syncLayerDragItems() {
    if (isLayerDragging.value) return
    layerDragItems.value = filteredLayers.value.map((item) => ({ ...item }))
  }

  watch(filteredLayers, () => {
    syncLayerDragItems()
  }, { immediate: true })

  /**
   * 图层面板动作统一落在图形选择模式，避免点/边编辑状态拦截图层选择或排序。
   */
  function ensureShapeSelectionForLayerActions() {
    if (options.selectionMode.value !== 'shape') {
      options.setSelectionMode('shape')
    }
  }

  /**
   * 根据最近一次图层锚点和目标对象计算 Shift 多选范围。
   */
  function getLayerRangeObjects(target: FabricObject) {
    const anchorId = layerSelectionAnchorId.value
    const items = filteredLayers.value
    const targetIndex = items.findIndex((item) => item.obj === target)
    const anchorIndex = items.findIndex((item) => item.id === anchorId)
    if (targetIndex < 0 || anchorIndex < 0) return [target]
    const [start, end] = anchorIndex <= targetIndex ? [anchorIndex, targetIndex] : [targetIndex, anchorIndex]
    return items.slice(start, end + 1).map((item) => item.obj)
  }

  /**
   * 记录当前图层选择锚点，供后续 Shift 范围选择复用稳定对象 id。
   */
  function setLayerSelectionAnchor(obj: FabricObject) {
    layerSelectionAnchorId.value = options.ensureEditorObjectId(obj)
  }

  /**
   * 获取右键菜单当前作用对象，优先使用 Fabric 当前多选结果。
   */
  function getCurrentLayerContextTargets() {
    return layerContextMenuTargets.value
  }

  /**
   * 关闭图层右键菜单但保留当前选择上下文。
   */
  function closeLayerContextMenu() {
    layerContextMenu.show = false
  }

  /**
   * 批量切换图层可见性，并同步万花筒实例可见状态和历史快照。
   */
  function setObjectsVisible(objects: FabricObject[], visible: boolean) {
    const fabricCanvas = options.getFabricCanvas()
    if (!fabricCanvas) return
    options.withSnapshotSuppressed(() => {
      objects.forEach((obj) => {
        obj.visible = visible
        options.triggerKaleidoscopeVisibilitySync(obj)
      })
    })
    fabricCanvas.requestRenderAll()
    options.refreshActiveObject()
    options.snapshot()
  }

  /**
   * 批量切换图层锁定状态，并同步 Fabric 控制点可用性。
   */
  function setObjectsLocked(objects: FabricObject[], locked: boolean) {
    const fabricCanvas = options.getFabricCanvas()
    if (!fabricCanvas) return
    options.withSnapshotSuppressed(() => {
      objects.forEach((obj) => {
        obj.set({
          lockMovementX: locked,
          lockMovementY: locked,
          lockScalingX: locked,
          lockScalingY: locked,
          lockRotation: locked,
          hasControls: !locked,
          selectable: true
        })
      })
    })
    fabricCanvas.requestRenderAll()
    options.refreshActiveObject()
    options.snapshot()
  }

  /**
   * 打开图层重命名弹窗，使用当前对象名称填充输入框。
   */
  function openLayerRenameDialog(obj: FabricObject) {
    layerRenameDialog.target = obj
    layerRenameDialog.value = String((obj as AnyFabricObject).name || obj.type || '对象')
    layerRenameDialog.show = true
  }

  /**
   * 关闭重命名弹窗时同步清空临时输入与目标对象，避免旧状态污染下一次重命名。
   */
  function handleLayerRenameDialogShowChange(show: boolean) {
    layerRenameDialog.show = show
    if (show) return
    layerRenameDialog.value = ''
    layerRenameDialog.target = null
  }

  /**
   * 提交图层重命名，只在有目标对象且名称有效时落盘并生成一次快照。
   */
  function confirmLayerRename() {
    const obj = layerRenameDialog.target
    if (!obj) {
      handleLayerRenameDialogShowChange(false)
      return
    }
    const currentName = String((obj as AnyFabricObject).name || obj.type || '对象')
    const trimmed = layerRenameDialog.value.trim()
    if (!trimmed || trimmed === currentName) {
      handleLayerRenameDialogShowChange(false)
      return
    }
    ;(obj as AnyFabricObject).name = trimmed
    options.refreshLayers()
    options.refreshActiveObject()
    options.snapshot()
    handleLayerRenameDialogShowChange(false)
  }

  /**
   * 从万花筒实例定位并选中源对象，保持图层锚点同步到源对象。
   */
  function selectLayerSourceObject(obj: FabricObject) {
    const source = options.isKaleidoscopeInstance(obj)
      ? options.findKaleidoscopeSourceById(options.getKaleidoscopeInstanceSourceId(obj))
      : null
    if (!source) return
    ensureShapeSelectionForLayerActions()
    options.applyActiveObjectsSelection([source])
    setLayerSelectionAnchor(source)
  }

  /**
   * 将选中的万花筒实例脱离源对象，保留当前外观并转为普通可编辑图层。
   */
  function detachLayerSources(objects: FabricObject[]) {
    const targets = objects.filter((obj) => options.isKaleidoscopeInstance(obj))
    const fabricCanvas = options.getFabricCanvas()
    if (!targets.length || !fabricCanvas) return
    options.withSnapshotSuppressed(() => {
      targets.forEach((instance) => {
        options.clearKaleidoscopeMetadata(instance)
        options.setKaleidoscopeInstanceManagedState(instance, false)
        instance.setCoords()
      })
    })
    fabricCanvas.requestRenderAll()
    options.refreshLayers()
    options.refreshActiveObject()
    options.snapshot()
    options.syncObjProps()
  }

  /**
   * 将拖拽后的顶部优先列表转换回 Fabric 的底部到顶部对象顺序。
   */
  function moveObjectsToLayerOrder(items: LayerItem[]) {
    const fabricCanvas = options.getFabricCanvas()
    if (!fabricCanvas) return
    const reversed = [...items].reverse()
    reversed.forEach((item, index) => {
      fabricCanvas.moveObjectTo(item.obj as AnyFabricObject, index)
    })
  }

  /**
   * 提交图层拖拽排序；搜索状态下排序禁用，会自动恢复当前投影顺序。
   */
  function reorderLayers() {
    const fabricCanvas = options.getFabricCanvas()
    isLayerDragging.value = false
    if (!fabricCanvas) return
    if (isLayerDragDisabled.value) {
      syncLayerDragItems()
      return
    }
    options.clearBooleanPreview()
    options.withSnapshotSuppressed(() => {
      moveObjectsToLayerOrder(layerDragItems.value)
    })
    fabricCanvas.requestRenderAll()
    options.refreshLayers()
    options.snapshot()
  }

  /**
   * 打开图层右键菜单；若目标不在当前选择中，会先同步为单选目标。
   */
  function openLayerContextMenu(obj: FabricObject, event: MouseEvent) {
    ensureShapeSelectionForLayerActions()
    const activeObjects = options.getFabricCanvas()?.getActiveObjects() ?? []
    if (!activeObjects.includes(obj)) {
      options.applyActiveObjectsSelection([obj], event)
      setLayerSelectionAnchor(obj)
    }
    layerContextMenu.x = event.clientX
    layerContextMenu.y = event.clientY
    layerContextMenu.show = true
  }

  /**
   * 执行图层右键菜单动作，将菜单 key 映射到可见性、锁定、排序、复制、成组等编辑命令。
   */
  function handleLayerContextMenuSelect(key: string) {
    const action = key as LayerContextMenuAction
    const targets = getCurrentLayerContextTargets()
    const single = singleLayerContextTarget.value
    // 层级调整属于可连续触发的操作，保持菜单常驻，禁用态由计算属性实时刷新。
    const keepMenuOpen = action === 'move-up' || action === 'move-top' || action === 'move-down' || action === 'move-bottom'
    if (!keepMenuOpen) closeLayerContextMenu()
    if (!targets.length) return
    switch (action) {
      case 'rename':
        if (single) openLayerRenameDialog(single)
        return
      case 'show':
        setObjectsVisible(targets, true)
        return
      case 'hide':
        setObjectsVisible(targets, false)
        return
      case 'lock':
        setObjectsLocked(targets, true)
        return
      case 'unlock':
        setObjectsLocked(targets, false)
        return
      case 'delete':
        options.deleteObjects(targets)
        return
      case 'detach-source':
        detachLayerSources(targets)
        return
      case 'select-source':
        if (single) selectLayerSourceObject(single)
        return
      case 'move-up':
        options.layerUp()
        return
      case 'move-top':
        options.layerTop()
        return
      case 'move-down':
        options.layerDown()
        return
      case 'move-bottom':
        options.layerBottom()
        return
      case 'duplicate':
        void options.duplicateSelection()
        return
      case 'group':
        options.groupObjects()
        return
      case 'ungroup':
        options.ungroupObject()
        return
      case 'save-user-asset':
        options.openCreateUserAssetDialog()
        return
      case 'create-symbol':
        options.openCreateSymbolDialog()
        return
      case 'detach-symbol':
        options.detachSymbolInstances(targets)
        return
      case 'copy-style':
        options.copyStyle()
        return
      case 'paste-style':
        options.pasteStyle()
        return
    }
  }

  /**
   * 判断某个图层对象是否属于当前 Fabric 选择结果。
   */
  function isLayerActive(obj: FabricObject) {
    return options.getFabricCanvas()?.getActiveObjects().includes(obj) ?? false
  }

  /**
   * 处理图层列表左键选择，忽略非主键点击。
   */
  function handleLayerMouseDown(obj: FabricObject, event: MouseEvent) {
    if (event.button !== 0) return
    selectLayer(obj, event)
  }

  /**
   * 万花筒实例由源对象驱动，不允许在图层面板中直接调整层级。
   */
  function isLayerKaleidoscopeLocked(obj: FabricObject) {
    return options.isKaleidoscopeInstance(obj)
  }

  /**
   * 根据普通点击、Ctrl/Meta 多选和 Shift 范围选择更新 Fabric 当前选区。
   */
  function selectLayer(obj: FabricObject, event?: MouseEvent | PointerEvent) {
    const fabricCanvas = options.getFabricCanvas()
    if (!fabricCanvas) return
    ensureShapeSelectionForLayerActions()
    const selected = fabricCanvas.getActiveObjects()
    const hasCtrlLike = !!event && !!(event.ctrlKey || event.metaKey)
    const hasShift = !!event?.shiftKey
    if (hasShift) {
      const rangeObjects = getLayerRangeObjects(obj)
      const nextSelection = hasCtrlLike
        ? [...selected, ...rangeObjects]
        : rangeObjects
      options.applyActiveObjectsSelection(nextSelection, event as MouseEvent | undefined)
      setLayerSelectionAnchor(obj)
      return
    }
    if (hasCtrlLike) {
      const nextSelection = selected.includes(obj)
        ? selected.filter((item) => item !== obj)
        : [...selected, obj]
      options.applyActiveObjectsSelection(nextSelection, event as MouseEvent | undefined)
      setLayerSelectionAnchor(obj)
      return
    }
    fabricCanvas.setActiveObject(obj, event as MouseEvent | undefined)
    options.applyActiveObjectsSelection([fabricCanvas.getActiveObject() ?? obj], event as MouseEvent | undefined)
    fabricCanvas.requestRenderAll()
    setLayerSelectionAnchor(obj)
  }

  /**
   * 切换单个对象可见性，复用批量可见性流程。
   */
  function toggleVisible(obj: FabricObject) {
    setObjectsVisible([obj], obj.visible === false)
  }

  /**
   * 切换单个对象锁定状态，复用批量锁定流程。
   */
  function toggleLock(obj: FabricObject) {
    setObjectsLocked([obj], !obj.lockMovementX)
  }

  /**
   * 从画布中删除单个图层对象。
   */
  function removeObject(obj: FabricObject) {
    options.deleteObjects([obj])
  }

  return {
    controller: {
      commands: {
        confirmLayerRename,
        handleLayerContextMenuSelect,
        handleLayerMouseDown,
        handleLayerRenameDialogShowChange,
        isLayerActive,
        openLayerContextMenu,
        removeObject,
        reorderLayers,
        setObjectsLocked,
        setObjectsVisible,
        toggleLock,
        toggleVisible
      },
      state: {
        filteredLayers,
        isLayerDragDisabled,
        isLayerDragging,
        layerContextMenu,
        layerContextMenuItems,
        layerDragItems,
        layerRenameDialog: layerRenameDialog as LayerRenameDialogState,
        layerSearch
      }
    }
  }
}
