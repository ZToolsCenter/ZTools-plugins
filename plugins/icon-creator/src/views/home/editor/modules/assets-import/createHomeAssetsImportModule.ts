import { computed, reactive, ref, type ComputedRef, type Ref } from 'vue'
import {
  FabricImage,
  Group,
  StaticCanvas,
  loadSVGFromString,
  util,
  type Canvas,
  type FabricObject
} from 'fabric'
import {
  ICONIFY_BROWSE_BATCH_SIZE,
  ICONIFY_COLLECTIONS_CACHE_TTL,
  ICONIFY_COLLECTIONS_STORAGE_KEY,
  ICONIFY_SEARCH_LIMIT,
  USER_ASSET_MAX_THUMBNAIL_SOURCE_SIZE,
  USER_ASSET_STORAGE_KEY,
  USER_ASSET_THUMBNAIL_SIZE
} from '../../../constants'
import {
  basicShapes,
  iconTemplates,
  textPresets
} from '../../../editorCatalog'
import type {
  IconTemplateItem,
  ShapeLibraryItem,
  TextLibraryItem
} from '../../../editorCatalog'
import {
  SERIALIZED_OBJECT_PROPS,
  applyDefaultEndpointSnapMargin,
  applyDefaultFillGradientMetadata,
  applyDefaultKaleidoscopeMetadata,
  applyDefaultSizeRatioLockMetadata,
  clearKaleidoscopeMetadata,
  getKaleidoscopeMetadata,
  normalizeKaleidoscopeCount,
  type AnyFabricObject
} from '../../../fabric/objectMetadata'
import { isTransparentCanvasBg, normalizeCanvasBg } from '../../../canvasSettings'
import type { HomeShowToast, HomeSnapshotGate } from '../../../composables/contracts'
import type { EditorModule } from '../../runtime/editorTypes'
import type {
  IconCreatorProjectFile,
  IconifyCollectionInfo,
  IconifySearchResponse,
  IconifySearchState,
  PasteSVGDialogState,
  ProjectLoadOptions,
  UserAssetDialogState,
  UserAssetItem
} from '../../../types'
import type { HomeAssetsImportController, InsertScenePoint } from './assetsImportTypes'
import { readInsertDragPayload } from './insertDragPayload'
import { readFileAsDataURL } from '../../../fileUtils'

export interface CreateHomeAssetsImportModuleOptions {
  svgInputRef: Ref<HTMLInputElement | null>
  imgInputRef: Ref<HTMLInputElement | null>
  getFabricCanvas: () => Canvas | null
  canvasWidth: Ref<number>
  canvasHeight: Ref<number>
  canvasBg: Ref<string>
  lastOpaqueCanvasBg: Ref<string>
  canSaveUserAsset: Ref<boolean>
  snapshotGate: HomeSnapshotGate
  snapshot: () => void
  newDoc: () => void
  clearStoredDraft: () => void
  /** 模板应用为新建文档完成后的页面层钩子：多标签场景由页面层立即补写草稿，避免丢失其他标签内容。 */
  onTemplateAppliedAsDocument?: () => void
  resetHistoryToCurrentCanvas: () => void
  createProjectFile: () => IconCreatorProjectFile
  loadProjectFile: (project: IconCreatorProjectFile, options?: ProjectLoadOptions) => Promise<void>
  showToast: HomeShowToast
  clearBooleanPreview: () => void
  clearPointEditing: () => void
  addShape: (item: ShapeLibraryItem, scenePoint?: InsertScenePoint | null) => void
  addText: (item: TextLibraryItem, scenePoint?: InsertScenePoint | null) => void
  /** 插入文档符号实例（拖拽落点插入复用，见 symbols.ts 说明）；symbolId 不存在时抛中文错误。 */
  insertSymbolById: (symbolId: string, scenePoint: InsertScenePoint | null) => Promise<void>
  refreshLayers: () => void
  syncActiveObjectPreservingPointMode: (obj: FabricObject | null) => void
  setSelectionMode: (mode: 'shape' | 'point' | 'segment') => void
  applyActiveObjectsSelection: (objects: FabricObject[], event?: MouseEvent) => void
  applyCanvasBgToFabric: (value: string) => void
  applyCanvasSize: () => void
  ensureEditorObjectId: (obj: FabricObject | null | undefined) => string
  nextName: (type: string) => string
  /** 无序号优先命名：画布无同名对象时直接返回 type，重名时返回最小的 `type N`（SVG 导入命名链路使用）。 */
  nextNameUnique: (type: string) => string
  prepareClonedObjectMetadata: (obj: FabricObject) => void
  normalizeEndpointAttachments: (obj: FabricObject) => void
  applyCanvasThemeToObject: (obj: FabricObject | null | undefined) => void
  createKaleidoscopeSourceId: () => string
  canUseKaleidoscopeAsSource: (obj: FabricObject | null | undefined) => boolean
  isKaleidoscopeSource: (obj: FabricObject | null | undefined) => boolean
  getCurrentCopyTargets: () => FabricObject[]
  createClipboardEntry: (obj: FabricObject) => { object: Record<string, unknown> }
  getObjectDisplayName: (obj: FabricObject) => string
  cloneSerializedObjectData: (value: Record<string, unknown>) => Record<string, unknown>
  getObjectsCombinedBounds: (objects: FabricObject[]) => { left: number; top: number; width: number; height: number } | null
  rebuildKaleidoscopeInstances: (obj: FabricObject) => Promise<void>
  markObjectSizeRatioLocked: (obj: FabricObject, locked?: boolean) => void
}

export interface CreateHomeAssetsImportModuleResult {
  controller: HomeAssetsImportController
  module: EditorModule
}

/**
 * 创建 Home 编辑器的 Assets / Import 模块，把模板、用户素材、文件导入和 Iconify 工作流集中到统一控制器。
 * 页面层只保留状态透传和命令触发，导入后的命名、元数据补齐、选中与快照都收敛在模块内部完成。
 */
export function createHomeAssetsImportModule(
  options: CreateHomeAssetsImportModuleOptions
): CreateHomeAssetsImportModuleResult {
  const userAssets = ref<UserAssetItem[]>([])
  const userAssetDialog = reactive<UserAssetDialogState>({
    show: false,
    mode: 'create',
    name: '',
    error: '',
    targetId: ''
  })
  const iconifySearch = reactive<IconifySearchState>({
    query: '',
    lastQuery: '',
    loading: false,
    loadingMore: false,
    error: '',
    results: [],
    total: 0,
    inserting: '',
    collectionFilter: '',
    mode: 'browse',
    hasMore: false,
    collections: [],
    collectionsLoading: false
  })
  // 已拉取的「浏览模式 + 指定图标集」图标名缓存：供首次展示与「加载更多」分页复用。
  let collectionBrowseCache: { prefix: string; names: string[]; total: number } | null = null
  const pasteSVGDialog = reactive<PasteSVGDialogState>({
    show: false,
    value: '',
    error: '',
    loading: false
  })
  const DEFAULT_ICONIFY_BROWSE_COLLECTIONS = [
    { prefix: 'mdi', icons: ['home', 'account', 'heart', 'star', 'cog', 'bell', 'plus', 'check', 'close', 'arrow-right', 'menu', 'magnify'] },
    { prefix: 'tabler', icons: ['home', 'user', 'heart', 'star', 'settings', 'bell', 'plus', 'check', 'x', 'arrow-right', 'menu-2', 'search'] },
    { prefix: 'lucide', icons: ['house', 'user', 'heart', 'star', 'settings', 'bell', 'plus', 'check', 'x', 'arrow-right', 'menu', 'search'] },
    { prefix: 'ph', icons: ['house', 'user', 'heart', 'star', 'gear', 'bell', 'plus', 'check', 'x', 'arrow-right', 'list', 'magnifying-glass'] },
    { prefix: 'solar', icons: ['home-2-bold', 'user-bold', 'heart-bold', 'star-bold', 'settings-bold', 'bell-bold', 'add-circle-bold', 'check-circle-bold', 'close-circle-bold', 'alt-arrow-right-bold', 'hamburger-menu-bold', 'magnifer-bold'] },
    { prefix: 'mingcute', icons: ['home-4-fill', 'user-4-fill', 'heart-fill', 'star-fill', 'settings-3-fill', 'notification-fill', 'add-circle-fill', 'check-circle-fill', 'close-circle-fill', 'right-line', 'menu-fill', 'search-line'] }
  ] as const

  function getDefaultIconifyBrowseResults() {
    return DEFAULT_ICONIFY_BROWSE_COLLECTIONS.flatMap((collection) => collection.icons.map((name) => `${collection.prefix}:${name}`))
  }

  /**
   * 为 Iconify 默认浏览模式返回当前批次结果；顺序固定，便于首屏展示和后续“加载更多”延续同一浏览路径。
   */
  function getIconifyBrowseBatch(limit: number) {
    return getDefaultIconifyBrowseResults().slice(0, Math.max(0, limit))
  }

  function normalizeStoredUserAsset(value: unknown): UserAssetItem | null {
    const source = value && typeof value === 'object' ? value as Partial<UserAssetItem> : null
    if (!source || typeof source.id !== 'string' || typeof source.name !== 'string') return null
    if (!Array.isArray(source.objects) || !source.objects.length) return null
    const objects = source.objects.filter((item): item is Record<string, unknown> => !!item && typeof item === 'object')
    if (!objects.length) return null
    const now = new Date().toISOString()
    return {
      id: source.id,
      name: normalizeUserAssetName(source.name),
      createdAt: typeof source.createdAt === 'string' ? source.createdAt : now,
      updatedAt: typeof source.updatedAt === 'string' ? source.updatedAt : now,
      objects,
      layerOrder: Array.isArray(source.layerOrder) ? source.layerOrder.filter((id): id is string => typeof id === 'string') : [],
      thumbnail: typeof source.thumbnail === 'string' ? source.thumbnail : ''
    }
  }

  /**
   * 生成个人素材唯一标识，避免重启后素材重命名或重新排序影响插入与编辑操作。
   */
  function createUserAssetId() {
    return `asset-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
  }

  /**
   * 规范用户输入的素材名；空名称会回退到可读默认名，避免素材库出现不可点击的空标题。
   */
  function normalizeUserAssetName(value: string, fallback = '素材') {
    const trimmed = value.trim()
    return trimmed || fallback
  }

  /**
   * 把当前选区序列化为素材对象列表，保留渐变、可编辑路径等自定义元数据并记录原始图层顺序。
   */
  function serializeCurrentSelectionForUserAsset() {
    const targets = options.getCurrentCopyTargets()
    const objects = targets.map((obj) => options.cloneSerializedObjectData((obj as AnyFabricObject).toObject(SERIALIZED_OBJECT_PROPS as unknown as string[]) as Record<string, unknown>))
    const layerOrder = targets.map((obj) => options.ensureEditorObjectId(obj))
    return { objects, layerOrder }
  }

  /**
   * 根据当前选区生成新素材的默认名称，多对象选区使用统一名称，单对象选区沿用图层显示名。
   */
  function getDefaultUserAssetName() {
    const targets = options.getCurrentCopyTargets()
    if (targets.length === 1) return options.getObjectDisplayName(targets[0])
    return `素材 ${userAssets.value.length + 1}`
  }

  /**
   * 为素材列表生成透明 PNG 缩略图；通过临时 StaticCanvas 渲染克隆对象，不污染当前编辑画布。
   */
  async function createUserAssetThumbnail(serializedObjects: Record<string, unknown>[]) {
    const objects = await util.enlivenObjects(serializedObjects.map(options.cloneSerializedObjectData)) as FabricObject[]
    const bounds = options.getObjectsCombinedBounds(objects)
    if (!bounds) return ''
    const sourceMaxSize = Math.max(bounds.width, bounds.height)
    const sourceScale = sourceMaxSize > USER_ASSET_MAX_THUMBNAIL_SOURCE_SIZE
      ? USER_ASSET_MAX_THUMBNAIL_SOURCE_SIZE / sourceMaxSize
      : 1
    const renderWidth = Math.max(1, Math.ceil(bounds.width * sourceScale))
    const renderHeight = Math.max(1, Math.ceil(bounds.height * sourceScale))
    const sourceCanvasEl = document.createElement('canvas')
    const sourceCanvas = new StaticCanvas(sourceCanvasEl, {
      width: renderWidth,
      height: renderHeight,
      backgroundColor: ''
    })
    sourceCanvas.viewportTransform = [sourceScale, 0, 0, sourceScale, -bounds.left * sourceScale, -bounds.top * sourceScale]
    objects.forEach((obj) => sourceCanvas.add(obj as AnyFabricObject))
    sourceCanvas.renderAll()

    const thumbCanvas = document.createElement('canvas')
    thumbCanvas.width = USER_ASSET_THUMBNAIL_SIZE
    thumbCanvas.height = USER_ASSET_THUMBNAIL_SIZE
    const ctx = thumbCanvas.getContext('2d')
    if (!ctx) {
      sourceCanvas.dispose()
      return ''
    }
    const padding = 8
    const drawScale = Math.min(
      (USER_ASSET_THUMBNAIL_SIZE - padding * 2) / Math.max(1, renderWidth),
      (USER_ASSET_THUMBNAIL_SIZE - padding * 2) / Math.max(1, renderHeight)
    )
    const drawWidth = Math.max(1, renderWidth * drawScale)
    const drawHeight = Math.max(1, renderHeight * drawScale)
    ctx.clearRect(0, 0, USER_ASSET_THUMBNAIL_SIZE, USER_ASSET_THUMBNAIL_SIZE)
    ctx.drawImage(
      sourceCanvas.getElement(),
      (USER_ASSET_THUMBNAIL_SIZE - drawWidth) / 2,
      (USER_ASSET_THUMBNAIL_SIZE - drawHeight) / 2,
      drawWidth,
      drawHeight
    )
    const dataUrl = thumbCanvas.toDataURL('image/png')
    sourceCanvas.dispose()
    return dataUrl
  }

  /**
   * 根据静态目录 id 找到基础形状定义；拖拽负载可能来自旧 DOM，查不到时返回 null 供上层安全忽略。
   */
  function findShapeLibraryItem(itemId: string) {
    return basicShapes.find((item) => item.id === itemId) ?? null
  }

  /**
   * 根据预设 id 找到文字模板，供点击插入与拖拽插入共用同一份目录数据。
   */
  function findTextPreset(itemId: string) {
    return textPresets.find((item) => item.id === itemId) ?? null
  }

  /**
   * 根据模板 id 找到内置模板定义；拖拽结束前模板列表可能发生切换，因此这里始终按最新目录兜底解析。
   */
  function findIconTemplate(itemId: string) {
    return iconTemplates.find((item) => item.id === itemId) ?? null
  }

  /**
   * 根据素材 id 从当前本地列表中查找素材，供左栏卡片拖放时恢复具体对象内容。
   */
  function findUserAsset(itemId: string) {
    return userAssets.value.find((item) => item.id === itemId) ?? null
  }

  /**
   * 将拖拽事件换算为画布场景坐标，供左侧插入项落点插入时复用；拿不到画布时返回 null 避免误插入。
   */
  function getScenePointFromDragEvent(event: DragEvent): InsertScenePoint | null {
    const fabricCanvas = options.getFabricCanvas()
    if (!fabricCanvas) return null
    const scenePoint = fabricCanvas.getScenePoint(event)
    if (!Number.isFinite(scenePoint.x) || !Number.isFinite(scenePoint.y)) return null
    return { x: scenePoint.x, y: scenePoint.y }
  }

  /**
   * 把对象包围盒中心移动到指定场景坐标，用于拖拽插入时让落点与用户鼠标位置尽量对齐。
   */
  function moveObjectBoundsCenterToScenePoint(object: FabricObject, scenePoint: InsertScenePoint) {
    object.setCoords()
    const bounds = object.getBoundingRect()
    if (!Number.isFinite(bounds.width) || !Number.isFinite(bounds.height)) return
    const dx = scenePoint.x - (bounds.left + bounds.width / 2)
    const dy = scenePoint.y - (bounds.top + bounds.height / 2)
    object.set({
      left: (object.left ?? 0) + dx,
      top: (object.top ?? 0) + dy
    })
    object.setCoords()
  }

  /**
   * 将一组对象作为整体移动到指定场景坐标，保持组内相对位置不变，供素材拖拽落点插入复用。
   */
  function moveObjectsBoundsCenterToScenePoint(objects: FabricObject[], scenePoint: InsertScenePoint) {
    const bounds = options.getObjectsCombinedBounds(objects)
    if (!bounds) return
    const dx = scenePoint.x - (bounds.left + bounds.width / 2)
    const dy = scenePoint.y - (bounds.top + bounds.height / 2)
    objects.forEach((obj) => {
      obj.set({
        left: (obj.left ?? 0) + dx,
        top: (obj.top ?? 0) + dy
      })
      obj.setCoords()
    })
  }

  /**
   * 将素材列表写回 localStorage，使用户重启插件后仍能继续插入常用素材。
   */
  function saveUserAssets() {
    try {
      window.localStorage.setItem(USER_ASSET_STORAGE_KEY, JSON.stringify({
        schemaVersion: 1,
        assets: userAssets.value
      }))
    } catch (error) {
      console.warn('保存个人素材失败', error)
      throw new Error('保存个人素材失败，请检查浏览器本地存储空间')
    }
  }

  /**
   * 启动时加载本地个人素材；解析失败时只清空内存列表，不删除原始存储，方便后续排查。
   */
  function loadUserAssets() {
    try {
      const raw = window.localStorage.getItem(USER_ASSET_STORAGE_KEY)
      if (!raw) return
      const parsed = JSON.parse(raw) as { assets?: unknown } | unknown[]
      const rawAssets = Array.isArray(parsed) ? parsed : Array.isArray(parsed.assets) ? parsed.assets : []
      userAssets.value = rawAssets
        .map(normalizeStoredUserAsset)
        .filter((asset): asset is UserAssetItem => !!asset)
    } catch (error) {
      console.warn('读取个人素材失败', error)
      userAssets.value = []
    }
  }

  /**
   * 基于当前选区创建一条个人素材，包含可编辑对象 JSON、图层顺序和列表缩略图。
   */
  async function createUserAssetFromSelection(name: string) {
    const { objects, layerOrder } = serializeCurrentSelectionForUserAsset()
    if (!objects.length) throw new Error('请先选中要保存的对象')
    const now = new Date().toISOString()
    const asset: UserAssetItem = {
      id: createUserAssetId(),
      name: normalizeUserAssetName(name, getDefaultUserAssetName()),
      createdAt: now,
      updatedAt: now,
      objects,
      layerOrder,
      thumbnail: await createUserAssetThumbnail(objects)
    }
    userAssets.value = [asset, ...userAssets.value]
    saveUserAssets()
  }

  /**
   * 插入素材前为克隆对象换新内部 id、清理外部端点引用，并递归处理组内子对象元数据。
   * 素材来自当前编辑器导出的序列化数据，需要保留已有的比例锁定标记，缺失时再补默认值。
   */
  function prepareUserAssetObjectForInsert(obj: FabricObject, assetName: string, index: number, isRoot = true) {
    options.prepareClonedObjectMetadata(obj)
    applyDefaultKaleidoscopeMetadata(obj)
    applyDefaultEndpointSnapMargin(obj)
    options.normalizeEndpointAttachments(obj)
    applyDefaultFillGradientMetadata(obj)
    applyDefaultSizeRatioLockMetadata(obj)
    if (isRoot) {
      ;(obj as AnyFabricObject).name = options.nextName(index === 0 ? assetName : `${assetName} 元素`)
    } else if (!String((obj as AnyFabricObject).name || '').trim()) {
      ;(obj as AnyFabricObject).name = options.nextName(`${assetName} 元素`)
    }
    if (obj instanceof Group) {
      obj.getObjects().forEach((child, childIndex) => prepareUserAssetObjectForInsert(child, assetName, childIndex, false))
    }
    options.applyCanvasThemeToObject(obj)
    obj.setCoords()
  }

  /**
   * 将素材对象整体移动到当前画布中心，若素材明显大于画布则等比缩小以保证插入后可见。
   */
  function placeUserAssetObjects(objects: FabricObject[]) {
    const bounds = options.getObjectsCombinedBounds(objects)
    if (!bounds) return { dx: 0, dy: 0 }
    const maxWidth = options.canvasWidth.value * 0.82
    const maxHeight = options.canvasHeight.value * 0.82
    const scaleRatio = Math.min(
      1,
      bounds.width > 0 ? maxWidth / bounds.width : 1,
      bounds.height > 0 ? maxHeight / bounds.height : 1
    )
    if (Number.isFinite(scaleRatio) && scaleRatio > 0 && scaleRatio < 1) {
      objects.forEach((obj) => {
        obj.set({
          left: bounds.left + ((obj.left ?? 0) - bounds.left) * scaleRatio,
          top: bounds.top + ((obj.top ?? 0) - bounds.top) * scaleRatio,
          scaleX: (obj.scaleX || 1) * scaleRatio,
          scaleY: (obj.scaleY || 1) * scaleRatio
        })
        obj.setCoords()
      })
    }
    const nextBounds = options.getObjectsCombinedBounds(objects) ?? bounds
    const dx = options.canvasWidth.value / 2 - (nextBounds.left + nextBounds.width / 2)
    const dy = options.canvasHeight.value / 2 - (nextBounds.top + nextBounds.height / 2)
    objects.forEach((obj) => {
      obj.set({
        left: (obj.left || 0) + dx,
        top: (obj.top || 0) + dy
      })
      obj.setCoords()
    })
    return { dx, dy }
  }

  /**
   * 素材插入后重置万花筒源 id，并把中心点随对象移动，避免新素材继续引用旧画布中的源对象。
   */
  function resetInsertedAssetKaleidoscopeMetadata(obj: FabricObject, dx: number, dy: number) {
    if (obj instanceof Group) {
      obj.getObjects().forEach((child) => resetInsertedAssetKaleidoscopeMetadata(child, dx, dy))
    }
    applyDefaultKaleidoscopeMetadata(obj)
    const metadata = getKaleidoscopeMetadata(obj)
    if (!metadata) return
    if (metadata.kaleidoscopeManaged || metadata.kaleidoscopeInstanceOf) {
      clearKaleidoscopeMetadata(obj)
      return
    }
    if (metadata.kaleidoscopeEnabled && options.canUseKaleidoscopeAsSource(obj)) {
      metadata.kaleidoscopeSourceId = options.createKaleidoscopeSourceId()
      metadata.kaleidoscopeCenterX = (metadata.kaleidoscopeCenterX || 0) + dx
      metadata.kaleidoscopeCenterY = (metadata.kaleidoscopeCenterY || 0) + dy
      metadata.kaleidoscopeCount = normalizeKaleidoscopeCount(metadata.kaleidoscopeCount)
      metadata.kaleidoscopeManaged = false
      metadata.kaleidoscopeInstanceOf = ''
      metadata.kaleidoscopeInstanceIndex = 0
    }
  }

  /**
   * 将导入对象统一加入画布并执行标准收尾，确保命名、选区、渲染与撤销快照行为保持一致。
   */
  async function commitImportedObjects(objects: FabricObject[], preservePointMode = true) {
    const fabricCanvas = options.getFabricCanvas()
    if (!fabricCanvas || !objects.length) return
    const previousSnapshotGate = options.snapshotGate.get()
    options.snapshotGate.set(true)
    try {
      for (const obj of objects) {
        fabricCanvas.add(obj as AnyFabricObject)
        if (options.isKaleidoscopeSource(obj)) {
          await options.rebuildKaleidoscopeInstances(obj)
        }
      }
    } finally {
      options.snapshotGate.set(previousSnapshotGate)
    }

    if (objects.length === 1) {
      if (preservePointMode) {
        fabricCanvas.setActiveObject(objects[0])
        options.syncActiveObjectPreservingPointMode(objects[0])
      } else {
        options.setSelectionMode('shape')
        options.applyActiveObjectsSelection([objects[0]])
      }
    } else {
      options.setSelectionMode('shape')
      options.applyActiveObjectsSelection(objects)
    }

    options.refreshLayers()
    fabricCanvas.requestRenderAll()
    options.snapshot()
  }

  /**
   * 将个人素材重新反序列化为 Fabric 对象插入画布，插入后保持可编辑并生成一次撤销快照。
   * 传入落点时会改为按鼠标位置居中放置，未传入时仍保持原有“画布中心插入”行为。
   */
  async function insertUserAsset(asset: UserAssetItem, scenePoint: InsertScenePoint | null = null) {
    const fabricCanvas = options.getFabricCanvas()
    if (!fabricCanvas) return
    options.clearBooleanPreview()
    options.clearPointEditing()
    const objects = await util.enlivenObjects(asset.objects.map(options.cloneSerializedObjectData)) as FabricObject[]
    if (!objects.length) return
    objects.forEach((obj, index) => {
      prepareUserAssetObjectForInsert(obj, asset.name, index)
    })
    const { dx, dy } = placeUserAssetObjects(objects)
    objects.forEach((obj) => {
      resetInsertedAssetKaleidoscopeMetadata(obj, dx, dy)
    })
    if (scenePoint) {
      moveObjectsBoundsCenterToScenePoint(objects, scenePoint)
    }
    await commitImportedObjects(objects, false)
  }

  /**
   * 判断用户选择的文件是否可以按 SVG 文本解析，兼容系统 MIME 为空时的扩展名识别。
   */
  function isSVGFile(file: File) {
    return file.type === 'image/svg+xml' || /\.svg$/i.test(file.name)
  }

  /**
   * 从文件名提取导入对象的基础图层名，避免把扩展名展示到图层面板里。
   */
  function getImportSVGDisplayName(fileName: string) {
    const baseName = fileName.replace(/\.svg$/i, '').trim()
    return baseName || 'SVG'
  }

  /**
   * 根据 Iconify 图标名生成简短图层名；保留集合前缀方便区分不同来源的同名图标。
   */
  function getIconifyDisplayName(iconName: string) {
    const normalized = iconName.trim()
    return normalized ? `Iconify ${normalized}` : 'Iconify 图标'
  }

  /**
   * 借助浏览器实体解析能力解码 path 标签里的 d 属性，避免 &quot; 等实体进入 Fabric 解析。
   */
  function decodeSVGAttribute(value: string) {
    const textarea = document.createElement('textarea')
    textarea.innerHTML = value
    return textarea.value
  }

  /**
   * 转义裸 path 数据后再包裹到 SVG 属性中，避免引号或尖括号破坏临时 SVG 结构。
   */
  function escapeSVGAttribute(value: string) {
    return value
      .replace(/&/g, '&amp;')
      .replace(/"/g, '&quot;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
  }

  /**
   * 从单个 path 标签中提取 d 属性，支持单双引号并忽略其他属性。
   */
  function extractPathDataFromPathElement(input: string) {
    const match = input.match(/<path\b[^>]*\sd\s*=\s*(["'])([\s\S]*?)\1[^>]*>/i)
    return match ? decodeSVGAttribute(match[2]).trim() : ''
  }

  /**
   * 粗略判断一段纯文本是否像 SVG path d 数据，防止普通文本被错误包裹成 SVG。
   */
  function looksLikeSVGPathData(input: string) {
    if (!input || /<[^>]+>/.test(input)) return false
    if (!/[a-zA-Z]/.test(input) || !/[\d.]/.test(input)) return false
    return /^[\sMmZzLlHhVvCcSsQqTtAa\d.,+\-eE]+$/.test(input)
  }

  /**
   * 将粘贴内容归一为完整 SVG 文本，允许用户直接粘贴完整 SVG、path 标签或裸 path d 数据。
   */
  function normalizePastedSVGText(input: string) {
    const text = input.trim()
    if (!text) throw new Error('请输入 SVG 代码或 path 数据')
    if (/<svg[\s>]/i.test(text)) return text
    const pathData = extractPathDataFromPathElement(text) || (looksLikeSVGPathData(text) ? text : '')
    if (!pathData) throw new Error('未识别到有效的 SVG 或 path d 数据')
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512"><path d="${escapeSVGAttribute(pathData)}" fill="#000000" /></svg>`
  }

  /**
   * 为导入对象补齐编辑器自定义元数据和可读图层名，确保后续图层、草稿和属性面板都能识别。
   * `lockSizeRatio` 用于区分模板/普通 SVG 导入与 Iconify 等需要默认等比缩放的来源。
   */
  function prepareImportedSVGObjectMetadata(obj: FabricObject, displayName: string, optionsBySource: { isRoot?: boolean; lockSizeRatio?: boolean } = {}) {
    const { isRoot = true, lockSizeRatio = false } = optionsBySource
    const target = obj as AnyFabricObject
    applyDefaultFillGradientMetadata(obj)
    applyDefaultKaleidoscopeMetadata(obj)
    applyDefaultEndpointSnapMargin(obj)
    options.normalizeEndpointAttachments(obj)
    options.ensureEditorObjectId(obj)
    applyDefaultSizeRatioLockMetadata(obj)
    if (lockSizeRatio) {
      options.markObjectSizeRatioLocked(obj)
    }
    // SVG 导入命名走 nextNameUnique：首次导入不带序号，仅与画布现有对象重名时追加最小可用序号
    if (isRoot) {
      target.name = options.nextNameUnique(displayName)
    } else if (!String(target.name || '').trim()) {
      target.name = options.nextNameUnique('SVG 元素')
    }
    if (typeof obj.fill === 'string' && obj.fill.trim() && obj.fill !== 'transparent') {
      target.lastFill = obj.fill
    }
    if (typeof obj.stroke === 'string' && obj.stroke.trim() && obj.stroke !== 'transparent' && Number(obj.strokeWidth || 0) > 0) {
      target.lastStroke = obj.stroke
      target.lastStrokeWidth = obj.strokeWidth || target.lastStrokeWidth || 1
      target.lastStrokeDashArray = Array.isArray(obj.strokeDashArray) ? [...obj.strokeDashArray] : null
    }
    if (obj instanceof Group) {
      obj.getObjects().forEach((child) => prepareImportedSVGObjectMetadata(child, displayName, { isRoot: false, lockSizeRatio }))
    }
    obj.setCoords()
  }

  /**
   * 将导入 SVG 放到画布中心，超出画布时按比例缩小以便用户导入后能立即看到和操作。
   */
  function placeImportedSVGObject(obj: FabricObject) {
    obj.setCoords()
    let bounds = obj.getBoundingRect()
    const maxWidth = options.canvasWidth.value * 0.82
    const maxHeight = options.canvasHeight.value * 0.82
    const scaleRatio = Math.min(
      1,
      bounds.width > 0 ? maxWidth / bounds.width : 1,
      bounds.height > 0 ? maxHeight / bounds.height : 1
    )
    if (Number.isFinite(scaleRatio) && scaleRatio > 0 && scaleRatio < 1) {
      obj.set({
        scaleX: (obj.scaleX || 1) * scaleRatio,
        scaleY: (obj.scaleY || 1) * scaleRatio
      })
      obj.setCoords()
      bounds = obj.getBoundingRect()
    }
    const dx = options.canvasWidth.value / 2 - (bounds.left + bounds.width / 2)
    const dy = options.canvasHeight.value / 2 - (bounds.top + bounds.height / 2)
    obj.set({
      left: (obj.left || 0) + dx,
      top: (obj.top || 0) + dy
    })
    obj.setCoords()
  }

  /**
   * 使用 Fabric 的 SVG 解析能力把完整 SVG 文本转换成一个可编辑对象，并加入当前画布。
   * `lockSizeRatio` 为 true 时会给导入结果补上默认等比缩放标记，供 Iconify 等需要保持原始比例的入口复用。
   */
  async function importSVGText(
    svgText: string,
    displayName: string,
    lockSizeRatio = false,
    scenePoint: InsertScenePoint | null = null
  ) {
    if (!options.getFabricCanvas()) return
    options.clearBooleanPreview()
    options.clearPointEditing()
    const normalizedText = svgText.trim()
    if (!normalizedText) throw new Error('SVG 内容为空')
    if (!/<svg[\s>]/i.test(normalizedText)) throw new Error('未找到有效的 <svg> 内容')
    const { objects, options: svgOptions } = await loadSVGFromString(normalizedText)
    const svgObjects = objects.filter((obj): obj is FabricObject => !!obj)
    if (!svgObjects.length) throw new Error('SVG 中没有可导入的图形')
    const imported = util.groupSVGElements(svgObjects, svgOptions) as FabricObject
    prepareImportedSVGObjectMetadata(imported, displayName, { lockSizeRatio })
    placeImportedSVGObject(imported)
    if (scenePoint) {
      moveObjectBoundsCenterToScenePoint(imported, scenePoint)
    }
    await commitImportedObjects([imported])
  }

  /**
   * 调用文件选择器读取本地 SVG，导入失败时只重置输入框并保留当前画布内容。
   */
  async function onSVGFileChosen(event: Event) {
    const input = event.target as HTMLInputElement
    const file = input.files?.[0]
    if (!file) return
    try {
      if (!isSVGFile(file)) throw new Error('请选择 .svg 文件')
      await importSVGText(await file.text(), getImportSVGDisplayName(file.name), true)
    } catch (error) {
      options.showToast(error instanceof Error ? error.message : '导入 SVG 失败', 'error')
    } finally {
      input.value = ''
    }
  }

  /**
   * 把本地图片文件导入为 Fabric Image，并补齐编辑器元数据后放到画布中心附近。
   * 图片资源默认锁定宽高比例，避免拖拽缩放时把位图和外部素材意外拉伸变形。
   * 先用 FileReader 读成 base64 dataURL 再建图，使对象 src 可随工程 JSON 持久化，刷新后仍能恢复；
   * 读取或解码失败时异常向上抛出，由调用方统一 toast 提示。
   */
  async function importImageFile(file: File) {
    if (!options.getFabricCanvas()) return
    const dataUrl = await readFileAsDataURL(file)
    const image = await FabricImage.fromURL(dataUrl)
    applyDefaultKaleidoscopeMetadata(image)
    applyDefaultEndpointSnapMargin(image)
    applyDefaultSizeRatioLockMetadata(image)
    options.markObjectSizeRatioLocked(image)
    image.set({
      left: options.canvasWidth.value / 2 - (image.width || 60) / 2,
      top: options.canvasHeight.value / 2 - (image.height || 60) / 2,
      name: options.nextName(file.name)
    })
    options.ensureEditorObjectId(image)
    image.setCoords()
    await commitImportedObjects([image])
  }

  /**
   * 调用文件选择器读取本地图片，导入失败时复位 input 并通过 toast 反馈具体错误。
   */
  async function onImageFileChosen(event: Event) {
    const input = event.target as HTMLInputElement
    const file = input.files?.[0]
    if (!file) return
    try {
      await importImageFile(file)
    } catch (error) {
      options.showToast(error instanceof Error ? error.message : '导入图片失败', 'error')
    } finally {
      input.value = ''
    }
  }

  /**
   * 把模板 SVG 插入当前画布，作为普通可编辑对象继续参与图层、属性、导出和撤销流程。
   * 拖拽插入会按落点定位，点击插入则沿用默认中心布局。
   */
  async function insertIconTemplate(template: IconTemplateItem, scenePoint: InsertScenePoint | null = null) {
    await importSVGText(template.svg, template.name, false, scenePoint)
  }

  /**
   * 用模板尺寸、背景和 SVG 内容创建一份新文档；应用失败时保留已有画布，避免误清空当前作品。
   */
  async function applyIconTemplateAsDocument(template: IconTemplateItem) {
    if (!options.getFabricCanvas()) return
    const previousProject = options.createProjectFile()
    try {
      options.newDoc()
      options.canvasWidth.value = template.width
      options.canvasHeight.value = template.height
      options.canvasBg.value = normalizeCanvasBg(template.background)
      if (!isTransparentCanvasBg(options.canvasBg.value)) {
        options.lastOpaqueCanvasBg.value = options.canvasBg.value
      }
      options.applyCanvasBgToFabric(options.canvasBg.value)
      options.applyCanvasSize()
      await importSVGText(template.svg, template.name)
      options.clearStoredDraft()
      options.resetHistoryToCurrentCanvas()
      // 模板应用内部清空了草稿；多标签场景由页面层立即补写，保留其他标签的未保存内容
      options.onTemplateAppliedAsDocument?.()
    } catch (error) {
      await options.loadProjectFile(previousProject, { keepDraft: true })
      options.showToast(error instanceof Error ? error.message : '应用模板失败', 'error')
    }
  }

  /**
   * 打开保存素材弹窗，并使用当前选区名称作为默认值以减少重复输入。
   */
  function openCreateUserAssetDialog() {
    if (!options.canSaveUserAsset.value) return
    userAssetDialog.mode = 'create'
    userAssetDialog.name = getDefaultUserAssetName()
    userAssetDialog.targetId = ''
    userAssetDialog.error = ''
    userAssetDialog.show = true
  }

  /**
   * 打开素材重命名弹窗，保留目标 id，确认时只修改素材库数据而不影响画布上已插入对象。
   */
  function openRenameUserAssetDialog(asset: UserAssetItem) {
    userAssetDialog.mode = 'rename'
    userAssetDialog.name = asset.name
    userAssetDialog.targetId = asset.id
    userAssetDialog.error = ''
    userAssetDialog.show = true
  }

  /**
   * 关闭素材弹窗时清空临时状态，避免下一次保存或重命名沿用旧错误信息。
   */
  function handleUserAssetDialogShowChange(show: boolean) {
    userAssetDialog.show = show
    if (show) return
    userAssetDialog.name = ''
    userAssetDialog.error = ''
    userAssetDialog.targetId = ''
  }

  /**
   * 确认保存或重命名素材；失败时把错误留在弹窗内，便于用户改名或释放存储空间后重试。
   */
  async function confirmUserAssetDialog() {
    const name = normalizeUserAssetName(userAssetDialog.name)
    try {
      if (userAssetDialog.mode === 'create') {
        await createUserAssetFromSelection(name)
      } else {
        const asset = userAssets.value.find((item) => item.id === userAssetDialog.targetId)
        if (!asset) throw new Error('素材不存在')
        asset.name = name
        asset.updatedAt = new Date().toISOString()
        userAssets.value = [...userAssets.value]
        saveUserAssets()
      }
      handleUserAssetDialogShowChange(false)
    } catch (error) {
      userAssetDialog.error = error instanceof Error ? error.message : '保存素材失败'
    }
  }

  /**
   * 删除素材前进行二次确认，防止误删本地收藏；删除后立即写回 localStorage。
   */
  function deleteUserAsset(asset: UserAssetItem) {
    const confirmed = window.confirm(`确定删除素材“${asset.name}”吗？`)
    if (!confirmed) return
    userAssets.value = userAssets.value.filter((item) => item.id !== asset.id)
    saveUserAssets()
  }

  /**
   * 打开粘贴导入弹窗，用户可输入完整 SVG、path 标签或 path d 数据后复用同一套导入流程。
   */
  function openPasteSVGDialog() {
    pasteSVGDialog.show = true
    pasteSVGDialog.error = ''
  }

  /**
   * 关闭粘贴弹窗时清理临时输入和错误状态，避免下一次打开沿用旧数据。
   */
  function handlePasteSVGDialogShowChange(show: boolean) {
    pasteSVGDialog.show = show
    if (show) return
    pasteSVGDialog.value = ''
    pasteSVGDialog.error = ''
    pasteSVGDialog.loading = false
  }

  /**
   * 主动读取系统剪贴板文本填入弹窗；浏览器权限或空内容异常会展示在弹窗内。
   */
  async function readClipboardIntoPasteSVGDialog() {
    pasteSVGDialog.error = ''
    try {
      const text = await navigator.clipboard?.readText?.()
      if (!text || !text.trim()) throw new Error('剪贴板中没有可读取的文本')
      pasteSVGDialog.value = text
    } catch (error) {
      pasteSVGDialog.error = error instanceof Error ? error.message : '读取剪贴板失败'
    }
  }

  /**
   * 校验并导入弹窗内的 SVG / path 文本，失败时保留输入以便用户继续修改。
   */
  async function confirmPasteSVGImport() {
    if (pasteSVGDialog.loading) return
    pasteSVGDialog.error = ''
    pasteSVGDialog.loading = true
    try {
      await importSVGText(normalizePastedSVGText(pasteSVGDialog.value), '粘贴 SVG', true)
      handlePasteSVGDialogShowChange(false)
    } catch (error) {
      pasteSVGDialog.error = error instanceof Error ? error.message : '导入 SVG 失败'
    } finally {
      pasteSVGDialog.loading = false
    }
  }

  /**
   * 调用隐藏的 SVG 文件选择器，让顶栏和导入工作流保持命令式接线。
   */
  function importSVG() {
    options.svgInputRef.value?.click()
  }

  /**
   * 调用隐藏的图片文件选择器，让顶栏和拖拽导入复用同一套图片处理流程。
   */
  function importImage() {
    options.imgInputRef.value?.click()
  }

  /**
   * 监听画布区域拖入文件，支持 SVG 和位图导入。
   */
  function handleCanvasDragOver(event: DragEvent) {
    event.preventDefault()
    if (event.dataTransfer) {
      event.dataTransfer.dropEffect = 'copy'
    }
  }

  /**
   * 处理左侧插入项拖放到画布的场景：优先消费自定义插入负载，未命中时再退回到文件导入流程。
   */
  async function handleCanvasDrop(event: DragEvent) {
    event.preventDefault()
    const insertPayload = readInsertDragPayload(event.dataTransfer)
    if (insertPayload) {
      const scenePoint = getScenePointFromDragEvent(event)
      switch (insertPayload.kind) {
        case 'shape': {
          const shape = findShapeLibraryItem(insertPayload.itemId)
          if (shape) options.addShape(shape, scenePoint)
          break
        }
        case 'text': {
          const preset = findTextPreset(insertPayload.itemId)
          if (preset) options.addText(preset, scenePoint)
          break
        }
        case 'template': {
          const template = findIconTemplate(insertPayload.itemId)
          if (template) await insertIconTemplate(template, scenePoint)
          break
        }
        case 'user-asset': {
          const asset = findUserAsset(insertPayload.itemId)
          if (asset) await insertUserAsset(asset, scenePoint)
          break
        }
        case 'symbol': {
          try {
            await options.insertSymbolById(insertPayload.itemId, scenePoint)
          } catch (error) {
            options.showToast(error instanceof Error ? error.message : '插入符号实例失败', 'error')
          }
          break
        }
        case 'iconify':
          await insertIconifyIcon(insertPayload.iconName, scenePoint)
          break
      }
      return
    }

    const files = Array.from(event.dataTransfer?.files ?? [])
    if (!files.length) return
    for (const file of files) {
      if (isSVGFile(file)) {
        try {
          await importSVGText(await file.text(), getImportSVGDisplayName(file.name), true)
        } catch (error) {
          options.showToast(error instanceof Error ? error.message : '导入 SVG 失败', 'error')
        }
      } else if (file.type.startsWith('image/')) {
        try {
          await importImageFile(file)
        } catch (error) {
          options.showToast(error instanceof Error ? error.message : '导入图片失败', 'error')
        }
      }
    }
  }

  /**
   * 调用 Iconify 在线搜索接口并展示前若干个图标名；失败时保留上一次输入，方便用户换关键词重试。
   * 已选图标集时通过 prefixes 参数把结果限制在该集合内；空条件搜索视为重置搜索条件：
   * 清空关键词与图标集筛选，回到默认浏览模式。
   */
  async function searchIconifyIcons() {
    const query = iconifySearch.query.trim()
    if (iconifySearch.loading) return
    if (!query) {
      iconifySearch.query = ''
      initializeIconifyBrowseResults()
      return
    }
    iconifySearch.loading = true
    iconifySearch.error = ''
    iconifySearch.lastQuery = query
    iconifySearch.mode = 'search'
    const collection = iconifySearch.collectionFilter
    const prefixes = collection ? `&prefixes=${encodeURIComponent(collection)}` : ''
    try {
      const response = await fetch(`https://api.iconify.design/search?query=${encodeURIComponent(query)}&limit=${ICONIFY_SEARCH_LIMIT}${prefixes}`)
      if (!response.ok) throw new Error(`Iconify 搜索失败：${response.status}`)
      const data = await response.json() as IconifySearchResponse
      const icons = Array.isArray(data.icons) ? data.icons.filter((item): item is string => typeof item === 'string') : []
      iconifySearch.results = icons
      iconifySearch.total = Number.isFinite(Number(data.total)) ? Number(data.total) : icons.length
      iconifySearch.hasMore = false
    } catch (error) {
      iconifySearch.results = []
      iconifySearch.total = 0
      iconifySearch.hasMore = false
      iconifySearch.error = error instanceof Error ? error.message : 'Iconify 搜索失败'
    } finally {
      iconifySearch.loading = false
    }
  }

  /**
   * 初始化 Iconify 默认浏览结果；当前阶段先提供一组稳定的常用集合与图标顺序，后续可继续扩展为真实接口分页。
   */
  function initializeIconifyBrowseResults() {
    const results = getIconifyBrowseBatch(ICONIFY_BROWSE_BATCH_SIZE)
    iconifySearch.mode = 'browse'
    iconifySearch.lastQuery = ''
    iconifySearch.error = ''
    iconifySearch.collectionFilter = ''
    iconifySearch.results = results
    iconifySearch.total = getDefaultIconifyBrowseResults().length
    iconifySearch.hasMore = results.length < iconifySearch.total
  }

  /**
   * 拉取指定图标集的图标名列表并展示首批；canonical 名称取 uncategorized + categories，
   * 剔除 hidden 列表与 alias 条目，保证展示的是该集合真实可用的主名称。
   */
  async function browseCollectionIcons(collection: string) {
    if (!collectionBrowseCache || collectionBrowseCache.prefix !== collection) {
      iconifySearch.loading = true
      iconifySearch.error = ''
      try {
        const response = await fetch(`https://api.iconify.design/collection?prefix=${encodeURIComponent(collection)}`)
        if (!response.ok) throw new Error(`获取图标集失败：${response.status}`)
        const data = await response.json() as {
          total?: unknown
          uncategorized?: unknown
          categories?: unknown
          hidden?: unknown
        }
        const hidden = new Set(Array.isArray(data.hidden) ? data.hidden.filter((n): n is string => typeof n === 'string') : [])
        const names = [
          ...(Array.isArray(data.uncategorized) ? data.uncategorized : []),
          ...(data.categories && typeof data.categories === 'object'
            ? Object.values(data.categories).flat()
            : [])
        ].filter((n): n is string => typeof n === 'string' && !hidden.has(n))
        collectionBrowseCache = {
          prefix: collection,
          names,
          total: Number.isFinite(Number(data.total)) ? Number(data.total) : names.length
        }
      } catch (error) {
        collectionBrowseCache = null
        iconifySearch.results = []
        iconifySearch.total = 0
        iconifySearch.hasMore = false
        iconifySearch.error = error instanceof Error ? error.message : '获取图标集失败'
        return
      } finally {
        iconifySearch.loading = false
      }
    }
    const cache = collectionBrowseCache!
    const batch = cache.names.slice(0, ICONIFY_BROWSE_BATCH_SIZE).map((name) => `${cache.prefix}:${name}`)
    iconifySearch.mode = 'browse'
    iconifySearch.error = ''
    iconifySearch.results = batch
    iconifySearch.total = cache.total
    iconifySearch.hasMore = batch.length < cache.names.length
  }

  /**
   * 响应图标集筛选变化：有关键词时带着 prefixes 重新搜索；
   * 浏览模式下选「全部」回到内置常用列表，选具体图标集则拉取该集合的图标。
   */
  async function setIconifyCollectionFilter(collection: string) {
    if (iconifySearch.collectionFilter === collection) return
    iconifySearch.collectionFilter = collection
    if (iconifySearch.query.trim()) {
      await searchIconifyIcons()
      return
    }
    if (!collection) {
      initializeIconifyBrowseResults()
      return
    }
    await browseCollectionIcons(collection)
  }

  /**
   * 为「浏览模式 + 指定图标集」追加下一批图标；数据来自已拉取的集合缓存，超出后关闭“加载更多”。
   */
  function loadMoreIconifyBrowseResults() {
    if (iconifySearch.mode !== 'browse' || iconifySearch.loadingMore || !iconifySearch.hasMore) return
    const cache = collectionBrowseCache
    if (cache && iconifySearch.collectionFilter === cache.prefix) {
      const nextSize = iconifySearch.results.length + ICONIFY_BROWSE_BATCH_SIZE
      const nextBatch = cache.names.slice(0, nextSize).map((name) => `${cache.prefix}:${name}`)
      iconifySearch.results = nextBatch
      iconifySearch.total = cache.total
      iconifySearch.hasMore = nextBatch.length < cache.names.length
      return
    }
    iconifySearch.loadingMore = true
    try {
      const nextSize = iconifySearch.results.length + ICONIFY_BROWSE_BATCH_SIZE
      const nextBatch = getIconifyBrowseBatch(nextSize)
      iconifySearch.results = nextBatch
      iconifySearch.total = getDefaultIconifyBrowseResults().length
      iconifySearch.hasMore = nextBatch.length < iconifySearch.total
    } finally {
      iconifySearch.loadingMore = false
    }
  }

  // 从本地存储读取图标集列表缓存；缺失、过期或脏数据按无缓存处理。
  function readCollectionsCache(): IconifyCollectionInfo[] | null {
    try {
      const raw = window.localStorage.getItem(ICONIFY_COLLECTIONS_STORAGE_KEY)
      if (!raw) return null
      const parsed = JSON.parse(raw) as { cachedAt?: unknown; collections?: unknown }
      if (!Array.isArray(parsed.collections)) return null
      if (typeof parsed.cachedAt !== 'number' || Date.now() - parsed.cachedAt > ICONIFY_COLLECTIONS_CACHE_TTL) return null
      const collections = parsed.collections.filter((item): item is IconifyCollectionInfo =>
        !!item && typeof item === 'object'
        && typeof (item as IconifyCollectionInfo).prefix === 'string'
        && typeof (item as IconifyCollectionInfo).name === 'string'
      )
      return collections.length ? collections : null
    } catch {
      return null
    }
  }

  // 图标集列表写入本地缓存；写入失败只忽略，下次启动重新拉取即可。
  function writeCollectionsCache(collections: IconifyCollectionInfo[]) {
    try {
      window.localStorage.setItem(ICONIFY_COLLECTIONS_STORAGE_KEY, JSON.stringify({
        cachedAt: Date.now(),
        collections
      }))
    } catch {
      // 存储配额等异常不影响主流程
    }
  }

  /**
   * 拉取 Iconify 全量图标集列表（接口返回顶层以前缀为 key 的扁平对象，条目带 hidden 标记），
   * 跳过 hidden 集合后按前缀排序；优先使用 7 天内的本地缓存，失败只记录警告，下拉框仍可用「全部图标集」。
   * 请求追加 time 参数做缓存穿透，避免宿主 webview 缓存导致拿到旧数据。
   */
  async function loadIconifyCollections() {
    if (iconifySearch.collectionsLoading || iconifySearch.collections.length) return
    iconifySearch.collectionsLoading = true
    try {
      let collections = readCollectionsCache()
      if (!collections) {
        const response = await fetch(`https://api.iconify.design/collections?time=${Date.now()}`)
        if (!response.ok) throw new Error(`获取图标集列表失败：${response.status}`)
        const data = await response.json() as Record<string, {
          name?: unknown
          total?: unknown
          hidden?: unknown
        } | undefined>
        collections = Object.entries(data ?? {})
          .filter(([, info]) => !!info && typeof info === 'object' && (info as { hidden?: unknown }).hidden !== true)
          .map(([prefix, info]) => ({
            prefix,
            name: typeof info!.name === 'string' && info!.name ? info!.name : prefix,
            totalIcons: Number.isFinite(Number(info!.total)) ? Number(info!.total) : 0
          }))
          .sort((a, b) => a.prefix.localeCompare(b.prefix))
        if (collections.length) writeCollectionsCache(collections)
      }
      iconifySearch.collections = collections ?? []
    } catch (error) {
      console.warn('加载图标集列表失败', error)
    } finally {
      iconifySearch.collectionsLoading = false
    }
  }

  /**
   * 将 Iconify 的 `collection:name` 图标名转换成 SVG API 地址，并指定黑色填充便于 Fabric 正确解析为可编辑颜色。
   */
  function buildIconifySVGUrl(iconName: string) {
    const [prefix, ...nameParts] = iconName.split(':')
    const name = nameParts.join(':')
    if (!prefix || !name) throw new Error('Iconify 图标名格式无效')
    const path = `${encodeURIComponent(prefix)}/${encodeURIComponent(name)}.svg`
    return `https://api.iconify.design/${path}?width=64&height=64&color=%23000000`
  }

  /**
   * 获取指定 Iconify 图标的 SVG 并复用 SVG 导入流程，使插入结果保持可改色、缩放和导出。
   * Iconify 图标默认锁定宽高比例，避免图标被非等比拉伸后出现视觉失真。
   */
  async function insertIconifyIcon(iconName: string, scenePoint: InsertScenePoint | null = null) {
    if (!options.getFabricCanvas() || iconifySearch.inserting) return
    iconifySearch.inserting = iconName
    iconifySearch.error = ''
    try {
      const response = await fetch(buildIconifySVGUrl(iconName))
      if (!response.ok) throw new Error(`Iconify 图标获取失败：${response.status}`)
      await importSVGText(await response.text(), getIconifyDisplayName(iconName), true, scenePoint)
    } catch (error) {
      iconifySearch.error = error instanceof Error ? error.message : 'Iconify 图标插入失败'
    } finally {
      iconifySearch.inserting = ''
    }
  }

  /**
   * 监听全局粘贴事件，支持从剪贴板导入 SVG 文本或位图。
   */
  async function handleWindowPaste(event: ClipboardEvent) {
    if (!options.getFabricCanvas()) return
    const activeElement = document.activeElement
    if (activeElement && (activeElement.tagName === 'INPUT' || activeElement.tagName === 'TEXTAREA')) return
    const items = Array.from(event.clipboardData?.items ?? [])
    for (const item of items) {
      if (item.type.startsWith('image/')) {
        const file = item.getAsFile()
        if (!file) continue
        try {
          await importImageFile(file)
          return
        } catch (error) {
          console.error('粘贴图片失败:', error)
        }
      }
    }
    const text = event.clipboardData?.getData('text/plain')?.trim()
    if (!text) return
    if (/<svg[\s>]/i.test(text) || /<path[\s>]/i.test(text)) {
      try {
        await importSVGText(normalizePastedSVGText(text), '粘贴 SVG', true)
      } catch (error) {
        console.error('粘贴 SVG 失败:', error)
      }
    }
  }

  // 全量图标集下拉选项：首项「全部」+ 已加载的完整集合列表，label 同时包含前缀与名称便于输入过滤。
  // 全量图标集下拉选项：首项「全部」，其余项 label 为集合名称、tag 为前缀（下拉里渲染成名称后的小标签）。
  const iconifyCollectionOptions = computed(() => [
    { label: '全部图标集', value: '' },
    ...iconifySearch.collections.map((collection) => ({
      label: collection.name,
      value: collection.prefix,
      tag: collection.prefix
    }))
  ])

  const filteredIconifyResults = computed(() => {
    const collection = iconifySearch.collectionFilter
    if (!collection) return iconifySearch.results
    return iconifySearch.results.filter((name) => name.startsWith(`${collection}:`))
  })

  const controller: HomeAssetsImportController = {
    state: {
      filteredIconifyResults: filteredIconifyResults as ComputedRef<string[]>,
      iconifyCollectionOptions: iconifyCollectionOptions as ComputedRef<Array<{ label: string; value: string }>>,
      iconifySearch,
      pasteSVGDialog,
      userAssetDialog,
      userAssets
    },
    commands: {
      applyIconTemplateAsDocument,
      confirmPasteSVGImport,
      confirmUserAssetDialog,
      deleteUserAsset,
      handleCanvasDragOver,
      handleCanvasDrop,
      handlePasteSVGDialogShowChange,
      handleUserAssetDialogShowChange,
      handleWindowPaste,
      importImage,
      importSVG,
      insertIconTemplate,
      insertIconifyIcon,
      insertUserAsset,
      onImageFileChosen,
      onSVGFileChosen,
      openCreateUserAssetDialog,
      openPasteSVGDialog,
      openRenameUserAssetDialog,
      readClipboardIntoPasteSVGDialog,
      loadMoreIconifyBrowseResults,
      searchIconifyIcons,
      setIconifyCollectionFilter
    }
  }

  const module: EditorModule = {
    name: 'home-assets-import',
    onMount() {
      loadUserAssets()
      initializeIconifyBrowseResults()
      void loadIconifyCollections()
    }
  }

  return {
    controller,
    module
  }
}
