import type { FabricObject } from 'fabric'
import { FabricImage, Text, util } from 'fabric'
import type { IconCreatorProjectFile, KeylineTemplate } from '../types'
import type { AnyFabricObject } from '../fabric/objectMetadata'
import { EDITOR_OBJECT_ID_PREFIX, getShadowEffectsMetadata } from '../fabric/objectMetadata'
import {
  compositeOperationToBlendMode,
  readBitmapFilterSettings,
  type BitmapFilterSetting
} from '../bitmapFilters'
import type { BooleanOperation, SubtractDirection } from '../geometry/booleanOps'
import {
  BUILTIN_STYLE_PRESETS,
  findDocumentStylePreset,
  listDocumentStylePresets,
  normalizeDocumentStylePresetStyle
} from '../documentStyleMeta'
import type { DocumentStylePreset, DocumentStylePresetStyle, DocumentStylePresetSummary, DocumentSwatch } from '../documentStyleMeta'
import {
  MAX_DOCUMENT_CANVAS_SNAPSHOTS,
  SNAPSHOT_BACKUP_NAME_PREFIX,
  createDocumentSnapshotBackupName,
  getDocumentCanvasSnapshotObjectCount
} from '../documentSnapshots'
import type { DocumentCanvasSnapshot } from '../documentSnapshots'
import type { ProjectSymbol } from '../symbols'
import { normalizeColorKey } from '../colorReplace'
import {
  normalizeStylePropValue,
  serializeShadowSummary,
  serializeStyleFillSummary
} from './styleValueParser'
import type {
  ExportIconContainerRequest,
  ExportIconContainerResult,
  ExportSizeSetRequest,
  ExportSizeSetResult
} from '../editor/modules/export-delivery/exportDeliveryTypes'
import { basicShapes, textPresets, iconTemplates } from '../editorCatalog'
import type { ShapeLibraryItem, TextLibraryItem, IconTemplateItem } from '../editorCatalog'
import { normalizeCanvasBg, normalizeKeylineTemplate, normalizePixelGridSize } from '../canvasSettings'
import { parseProjectFileText, stringifyProjectFile } from '../projectFile'
import type {
  McpBatchPropsItem,
  McpCanvasOverview,
  McpCanvasThumbnailOptions,
  McpCanvasThumbnailResult,
  McpCreateObjectItem,
  McpCreateStyleSettings,
  McpEditorGateway,
  McpEditorGatewayInternals,
  McpExportIconContainerOptions,
  McpExportIconContainerResult,
  McpExportPngDataUrlOptions,
  McpExportPngFileOptions,
  McpExportSizeSetOptions,
  McpExportSizeSetResult,
  McpExportSvgFileOptions,
  McpExportSvgTextOptions,
  McpGuide,
  McpGuideInput,
  McpObjectSummary,
  McpPatternFillRequest,
  McpSnapshotRestoreResult,
  McpSnapshotSaveResult,
  McpSnapshotSummary,
  McpSymbolInstanceInsertResult,
  McpSymbolSummary,
  McpUpdateTextRequest
} from './mcpGatewayTypes'

/**
 * useHomeEditorRuntime 提供给 MCP 网关的全部依赖句柄。
 * 依赖以 getter/函数形式传入（而非直接捕获 refs），保证网关实现不关心
 * 组合式函数内部的变量顺序，也便于后续模块化迁移时替换来源。
 */
export interface McpEditorGatewayOptions {
  getFabricCanvas: () => import('fabric').Canvas | null
  getActiveObject: () => FabricObject | null
  getObjects: () => FabricObject[]
  getSelection: () => FabricObject[]
  ensureEditorObjectId: (obj: FabricObject | null | undefined) => string
  isBooleanPreviewObject: (obj: FabricObject | null | undefined) => boolean

  // 画布状态 refs
  canvasWidth: () => number
  canvasHeight: () => number
  canvasBg: () => string
  zoom: () => number
  showPixelGrid: () => boolean
  snapToPixelGrid: () => boolean
  pixelGridSize: () => number
  keylineTemplate: () => KeylineTemplate

  // 画布操作
  setCanvasSize: (dim: 'width' | 'height', value: number) => void
  setCanvasBg: (color: string) => void
  setPixelGridVisible: (visible: boolean) => void
  setSnapToPixelGrid: (enabled: boolean) => void
  setPixelGridSize: (value: number) => void
  setKeylineTemplate: (template: KeylineTemplate) => void
  setKeylineMargin: (value: number) => void
  setSelectionMode: (mode: 'shape' | 'point' | 'segment') => void
  setZoom: (value: number) => void
  fitCanvasInView: () => void

  // 对象增删
  addShape: (
    item: ShapeLibraryItem,
    scenePoint: { x: number; y: number } | null,
    size?: { width?: number; height?: number }
  ) => void
  addText: (preset: TextLibraryItem, scenePoint: { x: number; y: number } | null) => void
  setObjProp: (prop: string, value: unknown) => void
  applyActiveObjectsSelection: (objects: FabricObject[]) => void
  selectAllByMode: () => void
  deleteObjects: (objects?: FabricObject[]) => void
  duplicateSelection: () => Promise<boolean>
  flipObject: (axis: 'x' | 'y') => void
  layerUp: () => void
  layerDown: () => void
  layerTop: () => void
  layerBottom: () => void
  lockObject: () => void
  groupObjects: () => void
  ungroupObject: () => void
  scaleObjectToDisplaySize: (obj: FabricObject, width: number, height: number) => void
  importSVGText: (
    svgText: string,
    displayName: string,
    importOptions?: { fitToCanvas?: boolean; scale?: number }
  ) => Promise<void>
  insertIconifyIcon: (iconName: string, scenePoint?: { x: number; y: number } | null) => Promise<void>
  insertIconTemplate: (template: IconTemplateItem, scenePoint?: { x: number; y: number } | null) => Promise<void>
  applyIconTemplateAsDocument: (template: IconTemplateItem) => Promise<void>

  // 图层显示/锁定（来自 layers 模块的批量能力）
  setObjectsVisible: (objects: FabricObject[], visible: boolean) => void
  setObjectsLocked: (objects: FabricObject[], locked: boolean) => void

  // 对象命名与程序化排版（MCP 与界面操作共用运行时实现）
  /** 设置对象图层名并刷新图层面板，实际写入返回 true。 */
  setObjectName: (object: FabricObject, name: string) => boolean
  /** 以对象集合公共包围盒为基准对齐，mode 为六个对齐方向之一。 */
  alignObjectsLayout: (
    objects: FabricObject[],
    mode: 'left' | 'center' | 'right' | 'top' | 'middle' | 'bottom'
  ) => boolean
  /** 在首尾对象之间等间距分布，axis 为 'x'/'y'，mode 为 'edge'/'center'。 */
  distributeObjectsLayout: (objects: FabricObject[], axis: 'x' | 'y', mode?: 'edge' | 'center') => boolean

  // 文档级样式元数据（命名色板与自定义样式预设），由运行时持有并随工程/撤销持久化
  /** 读取当前文档级命名色板。 */
  getDocumentSwatches: () => DocumentSwatch[]
  /** 添加（或按名称覆盖）色板条目，返回更新后的色板列表。 */
  addDocumentSwatch: (name: string, color: string) => DocumentSwatch[]
  /** 删除指定名称的色板条目，返回剩余色板列表。 */
  removeDocumentSwatch: (name: string) => DocumentSwatch[]
  /** 读取文档级自定义样式预设列表（不含内置预设）。 */
  getDocumentStylePresets: () => DocumentStylePreset[]
  /** 保存（或按名称覆盖）自定义样式预设，返回更新后的预设列表。 */
  saveDocumentStylePreset: (name: string, style: DocumentStylePresetStyle) => DocumentStylePreset[]
  /** 删除指定名称的自定义样式预设，返回剩余预设列表。 */
  removeDocumentStylePreset: (name: string) => DocumentStylePreset[]

  // 文档级命名快照（画布视觉状态备份），随工程 JSON 保存、不进入撤销历史
  /** 读取当前文档级命名快照列表。 */
  getDocumentCanvasSnapshots: () => DocumentCanvasSnapshot[]
  /** 保存（或按名称覆盖）一个命名快照，返回更新后的快照列表。 */
  saveDocumentCanvasSnapshot: (name: string, canvasJson: Record<string, unknown>) => DocumentCanvasSnapshot[]
  /** 删除指定名称的命名快照，返回剩余快照列表。 */
  removeDocumentCanvasSnapshot: (name: string) => DocumentCanvasSnapshot[]

  // 对齐参考线（用户参考线），随撤销快照与工程 JSON 持久化
  /** 读取当前文档级对齐参考线列表。 */
  getDocumentGuides: () => Array<{ id: string; orientation: 'horizontal' | 'vertical'; position: number }>
  /**
   * 整体替换对齐参考线：实现负责归一化、生成 id，并按当前画布尺寸夹取越界位置，
   * 同时触发草稿保存；返回应用后的完整列表（撤销快照由调用方提交）。
   */
  setDocumentGuides: (
    guides: Array<{ orientation: 'horizontal' | 'vertical'; position: number }>
  ) => Array<{ id: string; orientation: 'horizontal' | 'vertical'; position: number }>

  /**
   * 全局颜色替换：把画布全部对象 fill/stroke/渐变色标中等于 from 的颜色替换为 to
   * （归一化比较），返回替换对象数与颜色槽位数（撤销快照由调用方提交）。
   */
  replaceDocumentColorOnCanvas: (from: string, to: string) => { objectCount: number; slotCount: number }

  // 文档级符号系统（Symbol），随撤销快照（editorSymbols）与工程 JSON（symbols）双通道持久化
  /** 读取当前文档级符号定义列表。 */
  getDocumentSymbols: () => ProjectSymbol[]
  /** 统计画布上引用指定符号定义的实例数量。 */
  getSymbolInstanceCount: (symbolId: string) => number
  /**
   * 用画布对象创建符号定义（原对象保持不变，定义坐标按包围盒归一化）；
   * 撤销快照由调用方提交。定义数量超限或对象无效时抛中文错误。
   */
  defineSymbolFromObjects: (name: string, objects: FabricObject[]) => ProjectSymbol
  /**
   * 插入符号定义的一个联动实例（实例 = fabric Group，挂 symbolId / symbolInstanceId 元数据）：
   * scenePoint 为包围盒中心落点，null 表示落画布中心；实现内部提交一条撤销记录。
   * symbolId 不存在时抛中文错误，返回实例 Group。
   */
  insertSymbolInstanceById: (
    symbolId: string,
    scenePoint: { x: number; y: number } | null
  ) => Promise<FabricObject>
  /**
   * 用画布对象重写符号定义并按旧实例几何重建全部实例（保持中心/显示尺寸/角度）；
   * 实现内部提交一条撤销记录，返回更新后的定义。symbolId 不存在时抛中文错误。
   */
  updateSymbolFromObjects: (symbolId: string, objects: FabricObject[]) => Promise<ProjectSymbol>
  /**
   * 解除对象列表中符号实例的关联（转普通对象），返回实际解除的对象；
   * 实现内部在有解除时提交一条撤销记录。
   */
  detachSymbolInstancesFromObjects: (objects: FabricObject[]) => FabricObject[]
  /** 读取当前画布序列化 JSON（与撤销快照同一取数路径）。 */
  serializeCanvasJson: () => Record<string, unknown>
  /**
   * 用一份画布序列化 JSON 整体替换当前画布内容：过程挂起自动撤销快照，
   * 加载后重建万花筒/渐变/端点贴附等派生状态；由调用方决定何时提交撤销记录。
   */
  restoreCanvasContentFromJson: (canvasJson: Record<string, unknown>) => Promise<void>
  /** 触发一次延迟草稿保存，让纯文档级状态变更（快照增删）也能随工程 JSON 落盘。 */
  scheduleDraftSave: () => void

  /**
   * 把文本对象转曲为可编辑路径对象：校验目标是文本类型（否则抛中文错误），
   * 转换 + 替换 + 选中在一条撤销记录内完成，返回新路径对象 id。
   */
  outlineText: (target: FabricObject) => Promise<string>

  /**
   * 更新文本对象的内容与排版属性（update_text 的运行时实现）：updates 的键为
   * text/fontSize/fontFamily/fontWeight/fontStyle/charSpacing/lineHeight/textAlign/
   * underline/linethrough，目标非文本对象时抛中文错误；实现负责在落值后重算
   * 文本布局（换行与宽高随内容刷新）；撤销快照由调用方挂起/提交。
   */
  updateTextObject: (target: FabricObject, updates: Record<string, unknown>) => void

  /**
   * 整体替换目标位图的滤镜设置列表（可选同时设置混合模式，normal 表示正常）：
   * 目标非位图或 blendMode 非法时抛中文错误；撤销快照由调用方挂起/提交。
   */
  applyImageFilterToObject: (target: FabricObject, settings: BitmapFilterSetting[], blendMode?: string) => void

  /**
   * 裁剪目标位图：rect 以图片当前显示包围盒为坐标系（angle=0 语义，同摘要 bboxLeft/bboxTop），
   * 实现负责换算为 fabric cropX/cropY/width/height；越界/面积过小抛中文错误；
   * 撤销快照由调用方挂起/提交。
   */
  cropImageToDisplayRect: (target: FabricObject, rect: { left: number; top: number; width: number; height: number }) => void

  /**
   * 为目标对象设置图案填充：source 为 null 时清除图案恢复纯色，其余参数经归一化后
   * 构建 fabric Pattern（图片加载失败抛中文错误）；撤销快照由调用方挂起/提交。
   */
  applyPatternFillToObject: (
    target: FabricObject,
    request: { source: string | null; repeat?: 'repeat' | 'repeat-x' | 'repeat-y' | 'no-repeat'; scale?: number }
  ) => Promise<void>

  // 历史
  undo: () => void
  redo: () => void
  jumpToHistory: (index: number) => void
  undoStack: () => Array<{ json: string; description: string; timestamp: number }>
  historyIndex: () => number
  /** 挂起期间抑制撤销快照（自动记录的），供批量操作合并为一条历史时使用。 */
  withSnapshotSuppressed: <T>(callback: () => T) => T
  /** 手动提交一条撤销快照，description 用于历史记录展示。 */
  snapshot: (options?: { description?: string }) => void

  // 工程文档
  newDoc: () => void
  saveActiveProjectTab: () => void
  hasSavedProjectPath: () => boolean
  createProjectFile: () => IconCreatorProjectFile
  loadProjectFile: (project: IconCreatorProjectFile) => Promise<void>

  // 画板
  artboards: () => Array<{ id: string; name: string; canvas: { width: number; height: number }; fabric: Record<string, unknown>; layerOrder: string[] }>
  activeArtboardId: () => string
  canRedo: () => boolean
  switchArtboard: (artboardId: string) => Promise<void>
  addArtboard: () => Promise<void>
  deleteArtboard: (artboardId: string) => Promise<void>
  renameArtboardDirect: (artboardId: string, name: string) => void

  // 布尔运算：对象集合由调用方解析，核心实现负责过滤万花筒实例/布尔预览对象并提交撤销快照语义
  runBooleanOperationOnObjects: (
    objects: FabricObject[],
    operation: BooleanOperation,
    subtractDirection?: SubtractDirection
  ) => Promise<{ result?: FabricObject; error?: string }>

  // 导出
  exportSvgText: (includeBackground?: boolean) => Promise<string>
  exportSvgSelection: () => Promise<string>
  exportPngDataUrl: (options?: { size?: number; transparentBackground?: boolean; format?: 'png' | 'webp'; quality?: number }) => string
  exportSvgFile: (options?: { fileName?: string; includeBackground?: boolean; outputDir?: string }) => Promise<string>
  exportPngFile: (options?: {
    size?: number
    fileName?: string
    transparentBackground?: boolean
    format?: 'png' | 'webp'
    quality?: number
    outputDir?: string
  }) => string
  exportSizeSet: (request: ExportSizeSetRequest) => ExportSizeSetResult
  exportIconContainer: (request: ExportIconContainerRequest) => ExportIconContainerResult
  /** 把指定画板临时加载为当前画布执行回调，结束后恢复原工程状态；画板 id 不存在时抛错。 */
  withArtboardExport: <T>(artboardId: string, run: () => T | Promise<T>) => Promise<T>

  // 其他
  showToast: (message: string, type?: 'success' | 'error' | 'info' | 'warning') => void
}

/** 布尔运算在撤销历史中的中文名称，与界面布尔按钮文案保持一致。 */
const BOOLEAN_OPERATION_LABELS: Record<'union' | 'intersect' | 'subtract' | 'xor', string> = {
  union: '并集',
  intersect: '交集',
  subtract: '差集',
  xor: '异或'
}

/** 内置样式预设名称集合，save/remove_style_preset 据此拒绝覆盖或删除内置预设。 */
const BUILTIN_STYLE_PRESET_NAMES = new Set(BUILTIN_STYLE_PRESETS.map((preset) => preset.name))

/**
 * 创建 MCP 编辑器网关实现：把编辑器运行时的闭包能力适配为
 * mcpGatewayTypes 声明的稳定接口。所有操作都通过 options 里的句柄
 * 间接访问编辑器状态，因此本文件不 import 任何运行时内部变量。
 */
export function createMcpEditorGateway(options: McpEditorGatewayOptions): McpEditorGateway {
  /** 按 editorObjectId 查找对象（自动过滤布尔预览等内部对象）。 */
  function findObject(objectId: string): FabricObject | null {
    return (
      options
        .getObjects()
        .find((obj) => !options.isBooleanPreviewObject(obj) && ensureId(obj) === objectId) ?? null
    )
  }

  /** 读取（必要时补齐）对象 id。 */
  function ensureId(obj: FabricObject): string {
    return options.ensureEditorObjectId(obj)
  }

  /**
   * 序列化对象阴影摘要：优先取原生 fabric shadow；多阴影对象原生 shadow 为空
   * （由 multiShadow 模块按 shadowEffects 元数据自绘），此时回退输出首个启用的投影效果，
   * 保证 MCP 摘要在两种渲染路径下都能读到阴影。
   */
  function serializeObjectShadowSummary(obj: FabricObject) {
    if (obj.shadow) return serializeShadowSummary(obj.shadow)
    const effects = (getShadowEffectsMetadata(obj)?.shadowEffects ?? [])
      .filter(effect => effect?.enabled && effect.type === 'drop')
    const first = effects[0]
    return first
      ? { color: first.color, blur: first.blur, offsetX: first.offsetX, offsetY: first.offsetY }
      : null
  }

  /** 把 Fabric 对象转为 MCP 摘要。fill/stroke 为渐变时序列化为可读 JSON，shadow 输出阴影摘要。 */
  function toSummary(obj: FabricObject, index: number): McpObjectSummary {
    const target = obj as AnyFabricObject
    const width = obj.getScaledWidth?.() ?? Number(obj.width ?? 0)
    const height = obj.getScaledHeight?.() ?? Number(obj.height ?? 0)
    // group 类型对象自身的 fill 无视觉意义（fabric 默认 rgb(0,0,0)），组的视觉样式由子对象表达，
    // 摘要一律输出 null，避免调用方把组误读为黑色填充对象再去修改组的 fill。
    const isGroup = String(obj.type ?? '').toLowerCase() === 'group'
    // bboxLeft/bboxTop 表示 angle=0 时的包围盒左上角。left/top 是对象 origin 基准点
    // （fabric v7 默认 center，但布尔运算结果与吸附轮廓辅助对象在 pathKitToFabric 中
    // 以 left/top 原点创建），因此不能直接用 left - width/2 假设中心原点；
    // 改用 origin 无关的 getCenterPoint() 取几何中心再减去显示尺寸一半——
    // 与 fabric calcACoords 同源计算（getCenterPoint + getScaledWidth/Height），
    // 结果和 angle=0 时的 getBoundingRect() 严格一致（含描边外扩）。
    const center = obj.getCenterPoint?.()
    const centerX = center ? center.x : Number(obj.left ?? 0)
    const centerY = center ? center.y : Number(obj.top ?? 0)
    return {
      id: ensureId(obj),
      name: String(target.name ?? obj.type ?? '对象'),
      type: String(obj.type ?? 'unknown'),
      visible: obj.visible !== false,
      locked: !!obj.lockMovementX,
      left: Number(obj.left ?? 0),
      top: Number(obj.top ?? 0),
      bboxLeft: centerX - width / 2,
      bboxTop: centerY - height / 2,
      width,
      height,
      scaleX: Number(obj.scaleX ?? 1),
      scaleY: Number(obj.scaleY ?? 1),
      angle: Number(obj.angle ?? 0),
      opacity: Number(obj.opacity ?? 1),
      fill: isGroup ? null : serializeStyleFillSummary(obj.fill),
      stroke: serializeStyleFillSummary(obj.stroke),
      strokeWidth: Number(obj.strokeWidth ?? 0),
      cornerRadius: Number.isFinite(Number(target.cornerRadius)) ? Number(target.cornerRadius) : undefined,
      shadow: serializeObjectShadowSummary(obj),
      masked: !!obj.clipPath,
      zIndex: index,
      // 混合模式所有对象都携带（source-over 对外展示为 normal）；位图滤镜仅位图对象携带
      blendMode: compositeOperationToBlendMode(obj.globalCompositeOperation),
      filters: obj instanceof FabricImage ? readBitmapFilterSettings(obj) : undefined
    }
  }

  /** 深拷贝画布序列化 JSON，让快照/备份与当前画布状态彻底脱离，避免后续编辑污染存档。 */
  function cloneSerializedCanvas(value: Record<string, unknown>): Record<string, unknown> {
    return JSON.parse(JSON.stringify(value)) as Record<string, unknown>
  }

  /**
   * 把蒙版克隆对象整理为 clipPath 副本：剥离 editorObjectId（clipPath 不是独立图层对象，
   * 避免工程 JSON 里出现与原对象重复的 id），改名便于序列化后辨认来源，
   * 并显式关闭反相（inverted）与绝对定位（absolutePositioned）语义。
   */
  function prepareClipPathClone(clip: FabricObject, sourceName: string): void {
    const typed = clip as AnyFabricObject
    typed.editorObjectId = undefined
    typed.name = `蒙版 · ${sourceName}`
    clip.set({ absolutePositioned: false, inverted: false })
  }

  /** 统一的“按 id 或选中态”目标解析，供复制/编组等操作复用。 */
  function withTargets(objectIds: string[] | undefined): FabricObject[] {
    if (objectIds && objectIds.length) {
      const targets = objectIds
        .map((id) => findObject(id))
        .filter((obj): obj is FabricObject => !!obj)
      if (!targets.length) throw new Error('指定的对象均未找到')
      return targets
    }
    const selection = options.getSelection()
    if (!selection.length) throw new Error('当前没有选中对象')
    return selection
  }

  /** 坐标/尺寸只保留一位小数，用于组装面向 AI 的提示文本。 */
  function roundTo(value: number): number {
    return Math.round(value * 10) / 10
  }

  /**
   * 解析单个属性在目标对象上的最终值（值归一化入口）：
   * - fill/stroke 传字符串 "none" 时回退到对象的 lastFill 原色（描边为 transparent），
   *   使 'none' 语义为"清除渐变回纯色"而非字面 none；
   * - 其余值经 normalizeStylePropValue 处理："swatch:名字" 解析为色板颜色
   *   （不存在时抛中文错误），渐变 JSON 构建 fabric.Gradient，shadow 对象构建 fabric.Shadow；
   * - 其他属性值原样透传，既有字符串行为完全不变。
   */
  function resolvePropValueForTarget(target: FabricObject, prop: string, value: unknown): unknown {
    if (
      (prop === 'fill' || prop === 'stroke')
      && typeof value === 'string'
      && value.trim().toLowerCase() === 'none'
    ) {
      const typed = target as AnyFabricObject
      if (prop === 'fill') {
        const lastFill = typeof typed.lastFill === 'string' ? typed.lastFill.trim() : ''
        return lastFill && lastFill.toLowerCase() !== 'none' ? lastFill : 'transparent'
      }
      return 'transparent'
    }
    return normalizeStylePropValue(prop, value, options.getDocumentSwatches())
  }

  /**
   * 对单个对象应用一组属性，供单对象与批量属性操作复用。
   * 先把对象设为当前选中（setObjProp 作用于激活对象），再逐项应用；
   * 所有值先归一化再应用，保证非法 swatch 引用/渐变结构在写入前整体报错；
   * width/height 以显示尺寸语义换算成缩放设置，其余键直接交给 setObjProp
   * （包含 fill/stroke 的样式目标处理、渐变/阴影分支与 cornerRadius 重建等既有语义）。
   * 每次调用都会在运行时产生撤销快照，批量场景需配合 withSnapshotSuppressed 抑制。
   */
  function applyPropsToObject(target: FabricObject, props: Record<string, unknown>): void {
    options.applyActiveObjectsSelection([target])
    const next: Record<string, unknown> = {}
    let width: unknown
    let height: unknown
    for (const [prop, value] of Object.entries(props)) {
      if (prop === 'width') {
        width = value
        continue
      }
      if (prop === 'height') {
        height = value
        continue
      }
      next[prop] = resolvePropValueForTarget(target, prop, value)
    }
    for (const [prop, value] of Object.entries(next)) {
      options.setObjProp(prop, value)
    }
    if (width !== undefined || height !== undefined) {
      options.scaleObjectToDisplaySize(
        target,
        width !== undefined ? Number(width) : target.getScaledWidth(),
        height !== undefined ? Number(height) : target.getScaledHeight()
      )
    }
  }

  /**
   * 对多个对象应用同一组属性的合并批次实现（batch_set_props 同值批量与 apply_style_preset 共用）。
   * 先解析全部目标对象（任一不存在即整批报错），再交给 applyPropsBatchCore 完成统一应用。
   */
  function applyPropsBatch(objectIds: string[], props: Record<string, unknown>, description: string): McpObjectSummary[] {
    if (!objectIds.length) throw new Error('缺少 objectIds 参数')
    if (!props || !Object.keys(props).length) throw new Error('缺少 props 参数')
    return applyPropsBatchCore(
      objectIds.map((id) => {
        const target = findObject(id)
        if (!target) throw new Error(`未找到对象: ${id}`)
        return { target, props }
      }),
      description
    )
  }

  /**
   * 合并批次核心：对“目标对象 + 各自属性”条目序列应用属性并合并为一条撤销记录
   * （batch_set_props 的同值批量/逐对象条目与 apply_style_preset 共用此路径）。
   * 应用前先整体校验：每个条目的样式值中的 swatch 引用/渐变/阴影结构可解析，
   * 任一失败即整批报错，不会留下部分应用状态；目标对象的存在性由调用方先行解析。
   * 批次内抑制自动快照，结束后恢复操作前的选中态并提交一条合并撤销记录。
   */
  function applyPropsBatchCore(
    entries: Array<{ target: FabricObject; props: Record<string, unknown> }>,
    description: string
  ): McpObjectSummary[] {
    if (!entries.length) throw new Error('缺少应用目标')
    const swatches = options.getDocumentSwatches()
    for (const entry of entries) {
      if (!entry.props || !Object.keys(entry.props).length) throw new Error('缺少 props 参数')
      for (const [prop, value] of Object.entries(entry.props)) {
        normalizeStylePropValue(prop, value, swatches)
      }
    }
    const previousSelection = options.getSelection()
    options.withSnapshotSuppressed(() => {
      entries.forEach((entry) => {
        applyPropsToObject(entry.target, entry.props)
      })
    })
    // 批量应用不应改变用户当前的选择，恢复操作前的选中态。
    options.applyActiveObjectsSelection(previousSelection)
    // 逐项应用产生的自动快照已被抑制，这里手动提交一条合并记录，保证一次 undo 即可整体还原。
    options.snapshot({ description })
    return entries.map((entry) => {
      const summary = gateway.getObjectSummary(ensureId(entry.target))
      if (!summary) throw new Error(`对象摘要读取失败: ${ensureId(entry.target)}`)
      return summary
    })
  }

  /**
   * 从创建类 settings（add_shape / insert_svg / create_objects 条目）中收集已提供的
   * 初始样式字段：值原样保留（解析统一在 applyPropsToObject 内完成），
   * undefined/null 视为未提供（新建对象没有可清除的旧样式，null 与缺失同义）。
   */
  function collectCreateStyleProps(settings: McpCreateStyleSettings | undefined): Record<string, unknown> {
    if (!settings) return {}
    const props: Record<string, unknown> = {}
    for (const field of ['fill', 'stroke', 'strokeWidth', 'cornerRadius', 'opacity', 'shadow'] as const) {
      const value = settings[field]
      if (value !== undefined && value !== null) props[field] = value
    }
    return props
  }

  /**
   * 创建对象后应用 settings 携带的初始样式：走与 set_object_props 完全相同的
   * applyPropsToObject 路径（自动获得 swatch 解析、渐变、shadow 与 cornerRadius 重建语义），
   * 未携带任何样式字段时跳过。
   */
  function applyCreatedStyleProps(created: FabricObject, settings: McpCreateStyleSettings | undefined): void {
    const styleProps = collectCreateStyleProps(settings)
    if (!Object.keys(styleProps).length) return
    applyPropsToObject(created, styleProps)
  }

  /** 组装单个符号定义的摘要：补充定义对象数与画布实例数（实时统计）。 */
  function toSymbolSummary(symbol: ProjectSymbol): McpSymbolSummary {
    return {
      id: symbol.id,
      name: symbol.name,
      createdAt: symbol.createdAt,
      objectCount: symbol.objects.length,
      instanceCount: options.getSymbolInstanceCount(symbol.id)
    }
  }

  const gateway: McpEditorGateway = {
    getOverview(): McpCanvasOverview {
      const selection = options.getSelection()
      return {
        canvasWidth: options.canvasWidth(),
        canvasHeight: options.canvasHeight(),
        canvasBg: options.canvasBg(),
        zoom: options.zoom(),
        showPixelGrid: options.showPixelGrid(),
        snapToPixelGrid: options.snapToPixelGrid(),
        pixelGridSize: options.pixelGridSize(),
        keylineTemplate: options.keylineTemplate(),
        activeArtboardId: options.activeArtboardId(),
        artboardCount: options.artboards().length,
        objectCount: options.getObjects().filter((obj) => !options.isBooleanPreviewObject(obj)).length,
        selectionCount: selection.length,
        canUndo: options.undoStack().length > 1,
        canRedo: options.canRedo(),
        historyLength: options.undoStack().length,
        historyIndex: options.historyIndex(),
        activeObjectIds: selection.map(ensureId)
      }
    },

    listObjects(): McpObjectSummary[] {
      return options
        .getObjects()
        .filter((obj) => !options.isBooleanPreviewObject(obj))
        .map(toSummary)
    },

    getObjectSummary(objectId: string): McpObjectSummary | null {
      const objects = options.getObjects().filter((obj) => !options.isBooleanPreviewObject(obj))
      const index = objects.findIndex((obj) => ensureId(obj) === objectId)
      return index >= 0 ? toSummary(objects[index], index) : null
    },

    getSelectionIds(): string[] {
      return options.getSelection().map(ensureId)
    },

    getSelectionSvg(): Promise<string> {
      return options.exportSvgSelection()
    },

    getActiveObjectProps(): Record<string, unknown> | null {
      const selection = options.getSelection()
      const target = selection.length === 1 ? selection[0] : null
      if (!target) {
        if (!selection.length) return null
        return { multiSelection: true, ids: selection.map(ensureId) }
      }
      const typed = target as AnyFabricObject
      return {
        id: ensureId(target),
        name: typed.name,
        type: target.type,
        left: target.left,
        top: target.top,
        width: target.width,
        height: target.height,
        scaleX: target.scaleX,
        scaleY: target.scaleY,
        angle: target.angle,
        opacity: target.opacity,
        fill: serializeStyleFillSummary(target.fill) ?? undefined,
        stroke: serializeStyleFillSummary(target.stroke) ?? undefined,
        strokeWidth: target.strokeWidth,
        shadow: serializeObjectShadowSummary(target) ?? undefined,
        cornerRadius: typed.cornerRadius,
        editable: typed.editablePath !== undefined
      }
    },

    listArtboards() {
      return options.artboards().map((artboard) => ({
        id: artboard.id,
        name: artboard.name,
        width: artboard.canvas.width,
        height: artboard.canvas.height,
        objectCount: Array.isArray((artboard.fabric as { objects?: unknown[] }).objects)
          ? ((artboard.fabric as { objects: unknown[] }).objects.length)
          : 0,
        active: artboard.id === options.activeArtboardId()
      }))
    },

    listHistory() {
      return options.undoStack().map((item, index) => ({
        index,
        description: item.description,
        timestamp: item.timestamp
      }))
    },

    resizeCanvas(width?: number, height?: number): void {
      if (width !== undefined) options.setCanvasSize('width', Math.round(width))
      if (height !== undefined) options.setCanvasSize('height', Math.round(height))
    },

    setCanvasBackground(color: string): void {
      options.setCanvasBg(color)
    },

    setPixelGrid(settings): void {
      if (settings.visible !== undefined) options.setPixelGridVisible(settings.visible)
      if (settings.snap !== undefined) options.setSnapToPixelGrid(settings.snap)
      if (settings.size !== undefined) options.setPixelGridSize(normalizePixelGridSize(settings.size))
    },

    setKeyline(settings): void {
      if (settings.template) {
        options.setKeylineTemplate(normalizeKeylineTemplate(settings.template))
      }
      if (settings.margin !== undefined) options.setKeylineMargin(settings.margin)
    },

    listGuides(): { guides: McpGuide[] } {
      return { guides: options.getDocumentGuides().map((guide) => ({ ...guide })) }
    },

    setGuides(guides: McpGuideInput[]): { guides: McpGuide[] } {
      // 越界位置由运行时按当前画布尺寸夹取（见 gateway 类型注释），这里直接透传。
      const applied = options.setDocumentGuides(guides)
      options.snapshot({ description: '设置参考线' })
      return { guides: applied }
    },

    clearGuides(): { guides: McpGuide[] } {
      const applied = options.setDocumentGuides([])
      options.snapshot({ description: '设置参考线' })
      return { guides: applied }
    },

    // ── 符号系统（见 symbols.ts 的数据模型与实例语义说明） ──

    /**
     * 从画布对象创建符号定义（define_symbol 实现）：先整体校验 objectIds，
     * 再创建定义并提交一条撤销记录；原对象保持不变（不自动转为实例）。
     */
    defineSymbol(name: string, objectIds: string[]): McpSymbolSummary {
      if (!objectIds.length) throw new Error('缺少 objectIds 参数（非空字符串数组）')
      const targets = objectIds.map((id) => {
        const target = findObject(id)
        if (!target) throw new Error(`未找到对象: ${id}`)
        return target
      })
      const symbol = options.defineSymbolFromObjects(name, targets)
      options.snapshot({ description: `创建符号: ${symbol.name}` })
      return toSymbolSummary(symbol)
    },

    listSymbols(): { symbols: McpSymbolSummary[] } {
      return { symbols: options.getDocumentSymbols().map((symbol) => toSymbolSummary(symbol)) }
    },

    /**
     * 插入符号定义的一个联动实例（insert_symbol_instance 实现）：
     * x/y 语义与 add_shape 一致（默认包围盒中心，anchor='top-left' 按左上角定位），
     * 插入实现内部已提交一条撤销记录，这里只做落点校正与摘要返回。
     */
    async insertSymbolInstance(symbolId: string, insertOptions?: { x?: number; y?: number; anchor?: 'center' | 'top-left' }): Promise<McpSymbolInstanceInsertResult> {
      const hasPosition = insertOptions?.x !== undefined || insertOptions?.y !== undefined
      const scenePoint = hasPosition
        ? { x: insertOptions?.x ?? options.canvasWidth() / 2, y: insertOptions?.y ?? options.canvasHeight() / 2 }
        : null
      const instance = await options.insertSymbolInstanceById(symbolId, scenePoint)
      // anchor='top-left'：把包围盒左上角平移到目标点（delta 法不依赖 origin 假设，同 add_shape）。
      if (scenePoint && insertOptions?.anchor === 'top-left') {
        instance.setCoords()
        const bounds = instance.getBoundingRect()
        instance.set({
          left: Number(instance.left ?? 0) + scenePoint.x - bounds.left,
          top: Number(instance.top ?? 0) + scenePoint.y - bounds.top
        })
        instance.setCoords()
        options.getFabricCanvas()?.requestRenderAll()
      }
      const metadata = (instance as AnyFabricObject) as unknown as { symbolId?: string; symbolInstanceId?: string }
      return {
        objectId: ensureId(instance),
        symbolId: String(metadata.symbolId ?? symbolId),
        symbolInstanceId: String(metadata.symbolInstanceId ?? '')
      }
    },

    /**
     * 用画布对象更新符号定义并同步全部实例（update_symbol 实现）：
     * 重建策略与撤销合并在运行时实现内部完成（一条撤销记录），这里负责校验与摘要返回。
     */
    async updateSymbol(symbolId: string, objectIds: string[]): Promise<McpSymbolSummary> {
      if (!objectIds.length) throw new Error('缺少 objectIds 参数（非空字符串数组）')
      const targets = objectIds.map((id) => {
        const target = findObject(id)
        if (!target) throw new Error(`未找到对象: ${id}`)
        return target
      })
      const symbol = await options.updateSymbolFromObjects(symbolId, targets)
      return toSymbolSummary(symbol)
    },

    /** 解除单个对象的符号关联（detach_symbol_instance 实现），返回解除后的对象摘要。 */
    async detachSymbolInstance(objectId: string): Promise<McpObjectSummary> {
      const target = findObject(objectId)
      if (!target) throw new Error(`未找到对象: ${objectId}`)
      const detached = options.detachSymbolInstancesFromObjects([target])
      if (!detached.length) throw new Error(`对象不是符号实例，无法解除关联: ${objectId}`)
      const summary = gateway.getObjectSummary(objectId)
      if (!summary) throw new Error(`对象摘要读取失败: ${objectId}`)
      return summary
    },

    replaceColor(from: string, to: string): { replacedObjects: number; replacedSlots: number; from: string; to: string } {
      // 双重校验（调度层已做格式校验）：归一化失败说明写法不支持，给出与 add_swatch 一致的可读错误。
      const fromKey = normalizeColorKey(from)
      const toKey = normalizeColorKey(to)
      if (!fromKey) {
        throw new Error(`from 非法: ${from}。支持 hex（如 #f00/#ff0000/#ff000080）或 rgb()/rgba() 表达式或 transparent`)
      }
      if (!toKey) {
        throw new Error(`to 非法: ${to}。支持 hex（如 #f00/#ff0000/#ff000080）或 rgb()/rgba() 表达式或 transparent`)
      }
      if (fromKey === toKey) {
        throw new Error(`from 与 to 是同一种颜色: ${fromKey}`)
      }
      const result = options.replaceDocumentColorOnCanvas(fromKey, toKey)
      // 没有命中任何颜色时不提交撤销快照，避免产生无意义的历史记录。
      if (result.objectCount > 0) {
        options.snapshot({ description: `颜色替换 ${fromKey} → ${toKey}` })
      }
      return {
        replacedObjects: result.objectCount,
        replacedSlots: result.slotCount,
        from: fromKey,
        to: toKey
      }
    },

    addShape(shape, settings): string {
      // 允许 AI 传短名（rectangle）或目录全名（base-rectangle）。
      const normalizedId = shape.startsWith('base-') ? shape : `base-${shape}`
      const item = basicShapes.find((candidate) => candidate.id === normalizedId)
      if (!item) {
        throw new Error(`未知图形: ${shape}。可用图形见 list: ${basicShapes.map((s) => s.id).join(', ')}`)
      }
      const hasPosition = settings?.x !== undefined || settings?.y !== undefined
      const scenePoint = hasPosition
        ? { x: settings?.x ?? options.canvasWidth() / 2, y: settings?.y ?? options.canvasHeight() / 2 }
        : null
      // 指定 width/height 时直接按目标尺寸生成本体几何（scale 恒为 1，圆角与描边不随缩放变形）；
      // 只传其一时另一维度沿用目录默认尺寸，均未传时保持默认尺寸插入行为。
      const hasTargetSize = settings?.width !== undefined || settings?.height !== undefined
      const size = hasTargetSize
        ? {
            width: settings?.width !== undefined ? Number(settings.width) : item.defaultWidth,
            height: settings?.height !== undefined ? Number(settings.height) : item.defaultHeight
          }
        : undefined
      options.addShape(item, scenePoint, size)
      // addShape 内部会把新对象设为选中，从选中态读取新对象 id。
      const created = options.getSelection()[0]
      if (!created) throw new Error('图形创建后未能读取到新对象')
      // settings 携带的初始样式在定位前应用（与 set_object_props 同一条 applyPropsToObject
      // 路径），使 anchor='top-left' 的落位基于应用样式后的最终包围盒。
      applyCreatedStyleProps(created, settings)
      // anchor='top-left'：把包围盒左上角平移到目标点（缺省/center 时 x/y 即中心点，无需处理）。
      // delta 法不依赖 origin 假设：先 setCoords 刷新包围盒缓存，再按包围盒实测左上角求位移。
      if (scenePoint && settings?.anchor === 'top-left') {
        created.setCoords()
        const bounds = created.getBoundingRect()
        options.setObjProp('left', Number(created.left ?? 0) + scenePoint.x - bounds.left)
        options.setObjProp('top', Number(created.top ?? 0) + scenePoint.y - bounds.top)
        created.setCoords()
      }
      return ensureId(created)
    },

    addText(settings): string {
      const preset =
        (settings.preset && textPresets.find((candidate) => candidate.id === settings.preset)) ||
        textPresets.find((candidate) => candidate.id === 'body')
      if (!preset) throw new Error(`未知文本预设: ${settings.preset}`)
      const scenePoint =
        settings?.x !== undefined || settings?.y !== undefined
          ? { x: settings.x ?? options.canvasWidth() / 2, y: settings.y ?? options.canvasHeight() / 2 }
          : null
      options.addText(preset, scenePoint)
      const created = options.getSelection()[0]
      if (!created) throw new Error('文本创建后未能读取到新对象')
      // 覆盖内容与可选样式：统一走 setObjProp 保持撤销/同步逻辑一致；
      // fill 支持 "swatch:名字" 引用（对象形式渐变亦兼容），解析失败时抛中文错误。
      options.setObjProp('text', settings.text)
      if (settings.fontSize !== undefined) options.setObjProp('fontSize', settings.fontSize)
      if (settings.fill !== undefined) {
        options.setObjProp('fill', normalizeStylePropValue('fill', settings.fill, options.getDocumentSwatches()))
      }
      return ensureId(created)
    },

    async insertSvg(svg, settings): Promise<{ objectId: string; message?: string }> {
      // MCP 导入保持 1:1 原始尺寸（不做画布适配缩小），缩放只由 scale 参数显式控制。
      await options.importSVGText(svg, settings?.name ?? '导入 SVG', {
        fitToCanvas: false,
        scale: settings?.scale
      })
      const created = options.getSelection()[0]
      if (!created) throw new Error('SVG 导入后未能读取到新对象')
      // settings 携带的初始样式在定位前应用（与 set_object_props 同一条 applyPropsToObject
      // 路径），使 anchor='top-left' 落位与越界检测都基于应用样式后的最终包围盒。
      applyCreatedStyleProps(created, settings)
      if (settings?.x !== undefined || settings?.y !== undefined) {
        options.setObjProp('left', settings.x ?? Number(created.left ?? 0))
        options.setObjProp('top', settings.y ?? Number(created.top ?? 0))
        created.setCoords()
        // anchor='top-left'：把包围盒左上角平移到目标点（缺省/center 时 x/y 即中心点，无需处理）。
        // delta 法不依赖 origin 假设，按包围盒实测左上角求位移；未提供的轴保持导入后的当前位置。
        if (settings.anchor === 'top-left') {
          const positioned = created.getBoundingRect()
          const targetX = settings.x ?? positioned.left
          const targetY = settings.y ?? positioned.top
          options.setObjProp('left', Number(created.left ?? 0) + targetX - positioned.left)
          options.setObjProp('top', Number(created.top ?? 0) + targetY - positioned.top)
        }
      }
      created.setCoords()
      // 越界不做静默处理：操作仍成功，但把包围盒超出画布的事实写进 message 提醒调用方。
      const bounds = created.getBoundingRect()
      const canvasWidth = options.canvasWidth()
      const canvasHeight = options.canvasHeight()
      const tolerance = 1
      const overflowX = bounds.left < -tolerance || bounds.left + bounds.width > canvasWidth + tolerance
      const overflowY = bounds.top < -tolerance || bounds.top + bounds.height > canvasHeight + tolerance
      if (!overflowX && !overflowY) {
        return { objectId: ensureId(created) }
      }
      return {
        objectId: ensureId(created),
        message:
          `导入成功，但对象包围盒（${roundTo(bounds.left)},${roundTo(bounds.top)} 起 ` +
          `${roundTo(bounds.width)}×${roundTo(bounds.height)}）超出画布范围 ` +
          `（${canvasWidth}×${canvasHeight}），可能无法完整显示或导出，可调整位置或尺寸。`
      }
    },

    async insertIconifyIcon(iconName, settings): Promise<string> {
      const hasPoint = settings && (settings.x !== undefined || settings.y !== undefined)
      const scenePoint = hasPoint
        ? { x: settings!.x ?? options.canvasWidth() / 2, y: settings!.y ?? options.canvasHeight() / 2 }
        : null
      await options.insertIconifyIcon(iconName, scenePoint)
      const created = options.getSelection()[0]
      if (!created) throw new Error('图标插入后未能读取到新对象')
      return ensureId(created)
    },

    async insertIconTemplate(templateId): Promise<string> {
      const template = iconTemplates.find((candidate) => candidate.id === templateId)
      if (!template) {
        throw new Error(`未知模板: ${templateId}。可用模板: ${iconTemplates.map((t) => t.id).join(', ')}`)
      }
      await options.insertIconTemplate(template)
      const created = options.getSelection()[0]
      if (!created) throw new Error('模板插入后未能读取到新对象')
      return ensureId(created)
    },

    async applyIconTemplateAsDocument(templateId): Promise<void> {
      const template = iconTemplates.find((candidate) => candidate.id === templateId)
      if (!template) {
        throw new Error(`未知模板: ${templateId}。可用模板: ${iconTemplates.map((t) => t.id).join(', ')}`)
      }
      await options.applyIconTemplateAsDocument(template)
    },

    selectObjects(objectIds, mode = 'shape'): void {
      options.setSelectionMode(mode)
      if (!objectIds.length) {
        options.applyActiveObjectsSelection([])
        return
      }
      const targets = objectIds
        .map((id) => findObject(id))
        .filter((obj): obj is FabricObject => !!obj)
      if (!targets.length) throw new Error('指定的对象均未找到')
      options.applyActiveObjectsSelection(targets)
    },

    selectAll(): void {
      options.selectAllByMode()
    },

    setObjectProps(objectId: string, props: Record<string, unknown>): void {
      const target = findObject(objectId)
      if (!target) throw new Error(`未找到对象: ${objectId}`)
      applyPropsToObject(target, props)
    },

    moveLayer(objectId: string, direction: 'up' | 'down' | 'top' | 'bottom'): void {
      const target = findObject(objectId)
      if (!target) throw new Error(`未找到对象: ${objectId}`)
      options.applyActiveObjectsSelection([target])
      if (direction === 'up') options.layerUp()
      else if (direction === 'down') options.layerDown()
      else if (direction === 'top') options.layerTop()
      else options.layerBottom()
    },

    setObjectVisible(objectId: string, visible: boolean): void {
      const target = findObject(objectId)
      if (!target) throw new Error(`未找到对象: ${objectId}`)
      options.setObjectsVisible([target], visible)
    },

    setObjectLocked(objectId: string, locked: boolean): void {
      const target = findObject(objectId)
      if (!target) throw new Error(`未找到对象: ${objectId}`)
      options.setObjectsLocked([target], locked)
    },

    async duplicateObjects(objectIds): Promise<string[]> {
      if (!objectIds || !objectIds.length) {
        const ok = await options.duplicateSelection()
        if (!ok) throw new Error('当前没有可复制的选中对象')
        return options.getSelection().map(ensureId)
      }
      // 指定 id：先按 id 选中再复制，结束后不恢复原选中（复制出的对象保持选中更符合直觉）。
      const targets = objectIds
        .map((id) => findObject(id))
        .filter((obj): obj is FabricObject => !!obj)
      if (!targets.length) throw new Error('指定的对象均未找到')
      options.applyActiveObjectsSelection(targets)
      const ok = await options.duplicateSelection()
      if (!ok) throw new Error('复制操作失败')
      return options.getSelection().map(ensureId)
    },

    deleteObjects(objectIds): void {
      if (!objectIds || !objectIds.length) {
        options.deleteObjects()
        return
      }
      const targets = objectIds
        .map((id) => findObject(id))
        .filter((obj): obj is FabricObject => !!obj)
      if (!targets.length) throw new Error('指定的对象均未找到')
      options.deleteObjects(targets)
    },

    flipObject(objectId: string, axis: 'x' | 'y'): void {
      const target = findObject(objectId)
      if (!target) throw new Error(`未找到对象: ${objectId}`)
      options.applyActiveObjectsSelection([target])
      options.flipObject(axis)
    },

    groupObjects(objectIds): void {
      const targets = withTargets(objectIds)
      if (targets.length < 2) throw new Error('编组至少需要 2 个对象')
      options.applyActiveObjectsSelection(targets)
      options.groupObjects()
    },

    ungroupObject(objectId): void {
      const target = objectId ? findObject(objectId) : options.getSelection()[0]
      if (!target) throw new Error('未找到可解散的编组对象')
      options.applyActiveObjectsSelection([target])
      options.ungroupObject()
    },

    setObjectName(objectId: string, name: string): McpObjectSummary | null {
      const target = findObject(objectId)
      if (!target) return null
      options.setObjectName(target, name)
      return gateway.getObjectSummary(objectId)
    },

    addSwatch(name: string, color: string): { swatches: DocumentSwatch[] } {
      const swatches = options.addDocumentSwatch(name, color)
      // 色板随撤销快照（editorMeta）持久化，这里提交独立撤销记录，undo 可还原本次添加。
      options.snapshot({ description: `添加色板: ${name.trim()}` })
      return { swatches }
    },

    removeSwatch(name: string): { swatches: DocumentSwatch[] } {
      const exists = options.getDocumentSwatches().some((item) => item.name === name.trim())
      if (!exists) throw new Error(`未找到名为 "${name}" 的色板，可先执行 list_swatches 查询`)
      const swatches = options.removeDocumentSwatch(name)
      options.snapshot({ description: `删除色板: ${name.trim()}` })
      return { swatches }
    },

    listSwatches(): { swatches: DocumentSwatch[] } {
      return { swatches: options.getDocumentSwatches().map((item) => ({ ...item })) }
    },

    saveStylePreset(name: string, style: Record<string, unknown>): { presets: DocumentStylePresetSummary[] } {
      const normalizedStyle = normalizeDocumentStylePresetStyle(style)
      if (!normalizedStyle) {
        throw new Error('style 必须是对象且至少包含 fill/stroke/strokeWidth/cornerRadius/shadow/opacity 之一')
      }
      if (BUILTIN_STYLE_PRESET_NAMES.has(name.trim())) {
        throw new Error(`预设名 "${name.trim()}" 与内置预设冲突，内置预设不可覆盖`)
      }
      options.saveDocumentStylePreset(name, normalizedStyle)
      options.snapshot({ description: `保存样式预设: ${name.trim()}` })
      return gateway.listStylePresets()
    },

    removeStylePreset(name: string): { presets: DocumentStylePresetSummary[] } {
      if (BUILTIN_STYLE_PRESET_NAMES.has(name.trim())) {
        throw new Error(`预设 "${name.trim()}" 是内置预设，不可删除`)
      }
      const exists = options.getDocumentStylePresets().some((item) => item.name === name.trim())
      if (!exists) throw new Error(`未找到名为 "${name}" 的自定义样式预设，可先执行 list_style_presets 查询`)
      options.removeDocumentStylePreset(name)
      options.snapshot({ description: `删除样式预设: ${name.trim()}` })
      return gateway.listStylePresets()
    },

    listStylePresets(): { presets: DocumentStylePresetSummary[] } {
      return { presets: listDocumentStylePresets(options.getDocumentStylePresets()) }
    },

    /**
     * 应用样式预设：按名称解析（内置优先），再整体走 batch_set_props 的
     * 应用 + 撤销合并路径，保证 cornerRadius/shadow/swatch/渐变语义与批量属性一致。
     */
    applyStylePreset(name: string, objectIds?: string[]) {
      const preset = findDocumentStylePreset(options.getDocumentStylePresets(), name)
      if (!preset) {
        throw new Error(`未找到样式预设: ${name}，可先执行 list_style_presets 查询`)
      }
      const targetIds = objectIds && objectIds.length ? objectIds : gateway.getSelectionIds()
      if (!targetIds.length) throw new Error('缺少 objectIds 参数且当前没有选中对象')
      const results = applyPropsBatch(targetIds, { ...preset.style }, `应用样式预设 ${preset.name}（${targetIds.length} 个对象）`)
      return { name: preset.name, source: preset.source, objectIds: targetIds, results }
    },

    async outlineText(objectId?: string): Promise<{ objectId: string }> {
      const target = objectId ? findObject(objectId) : options.getSelection()[0]
      if (!target) {
        throw new Error(objectId ? `未找到对象: ${objectId}` : '缺少 objectId 参数且当前没有选中对象')
      }
      const newId = await options.outlineText(target)
      return { objectId: newId }
    },

    /**
     * 更新文本对象的内容与排版属性（update_text 实现）：校验目标为文本对象后应用更新，
     * 文本布局由运行时实现在落值后重算；过程挂起自动快照，
     * 结束时提交一条合并撤销记录并返回更新后的摘要。
     */
    async updateText(objectId: string, request: McpUpdateTextRequest): Promise<McpObjectSummary> {
      const target = findObject(objectId)
      if (!target) throw new Error(`未找到对象: ${objectId}`)
      if (!(target instanceof Text)) {
        throw new Error(`对象不是文本对象: ${objectId}。update_text 仅对文本对象生效`)
      }
      const textName = String((target as AnyFabricObject).name ?? objectId)
      await options.withSnapshotSuppressed(() => {
        options.updateTextObject(target, request as Record<string, unknown>)
      })
      options.snapshot({ description: `更新文本: ${textName}` })
      const summary = gateway.getObjectSummary(objectId)
      if (!summary) throw new Error(`对象摘要读取失败: ${objectId}`)
      return summary
    },

    /**
     * 把蒙版对象设为目标对象的 clipPath 裁切。
     *
     * 坐标换算：fabric 对 clipPath（absolutePositioned=false）的渲染合成是
     * 画布点 = M_target · M_clip · p（M 为对象完整变换矩阵，p 为 clipPath 本地坐标），
     * 因此用 sendObjectToPlane 把蒙版克隆从画布平面变换到目标对象的本地平面，
     * 得到 M_clip = M_target⁻¹ · M_mask——目标的旋转/缩放/翻转与蒙版自身的变换
     * 一并通过矩阵求逆精确处理，视觉裁剪区域与蒙版当前画布布局完全一致。
     *
     * 整个操作（含可选的蒙版对象移除）在撤销快照挂起中执行，最后提交一条合并记录。
     */
    async maskObjects(objectId: string, maskId: string, removeMaskObject = false): Promise<{ objectId: string; clipPathId?: string }> {
      const target = findObject(objectId)
      if (!target) throw new Error(`未找到对象: ${objectId}`)
      const mask = findObject(maskId)
      if (!mask) throw new Error(`未找到蒙版对象: ${maskId}`)
      if (target === mask) throw new Error('不能用对象自身作为自己的蒙版')
      const maskWidth = mask.getScaledWidth?.() ?? 0
      const maskHeight = mask.getScaledHeight?.() ?? 0
      if (!(maskWidth > 0) || !(maskHeight > 0)) {
        throw new Error('蒙版对象的显示尺寸为 0，无法用作裁切蒙版')
      }
      const maskName = String((mask as AnyFabricObject).name ?? maskId)
      // 蒙版被移除时预先从恢复名单剔除，避免结束后把已删除对象重新设为选中。
      const selectionToRestore = options.getSelection().filter((obj) => obj !== mask || !removeMaskObject)
      await options.withSnapshotSuppressed(async () => {
        const clip = await mask.clone()
        prepareClipPathClone(clip, maskName)
        util.sendObjectToPlane(clip, undefined, target.calcTransformMatrix())
        target.set({ clipPath: clip })
        target.dirty = true
        target.setCoords()
        if (removeMaskObject) {
          options.deleteObjects([mask])
        }
        options.getFabricCanvas()?.requestRenderAll()
      })
      if (removeMaskObject) {
        const restored = selectionToRestore.filter((obj) => options.getObjects().includes(obj))
        if (restored.length) options.applyActiveObjectsSelection(restored)
      }
      options.snapshot({
        description: removeMaskObject ? `应用蒙版并移除蒙版对象: ${maskName}` : `应用蒙版: ${maskName}`
      })
      return { objectId, clipPathId: maskId }
    },

    /** 移除目标对象上的 clipPath 蒙版恢复完整显示，并提交一条撤销记录，返回移除后的摘要。 */
    async unmaskObject(objectId: string): Promise<McpObjectSummary> {
      const target = findObject(objectId)
      if (!target) throw new Error(`未找到对象: ${objectId}`)
      if (!target.clipPath) throw new Error('该对象没有蒙版（clipPath），无需移除')
      target.set({ clipPath: undefined })
      target.dirty = true
      target.setCoords()
      options.getFabricCanvas()?.requestRenderAll()
      options.snapshot({ description: `移除蒙版: ${String((target as AnyFabricObject).name ?? objectId)}` })
      const summary = gateway.getObjectSummary(objectId)
      if (!summary) throw new Error(`对象摘要读取失败: ${objectId}`)
      return summary
    },

    /**
     * 整体替换目标位图的滤镜列表（apply_image_filter 实现）：
     * 校验目标为位图后整体应用滤镜设置（可选同时设置混合模式）；
     * 过程挂起自动快照，结束时提交一条合并撤销记录并返回更新后的摘要。
     */
    async applyImageFilter(objectId: string, filterSettings: BitmapFilterSetting[] | undefined, blendMode?: string): Promise<McpObjectSummary> {
      const target = findObject(objectId)
      if (!target) throw new Error(`未找到对象: ${objectId}`)
      if (!(target instanceof FabricImage)) {
        throw new Error(`对象不是位图（FabricImage）: ${objectId}。滤镜仅对位图对象生效`)
      }
      const filterName = String((target as AnyFabricObject).name ?? objectId)
      await options.withSnapshotSuppressed(() => {
        options.applyImageFilterToObject(target, filterSettings ?? readBitmapFilterSettings(target), blendMode)
      })
      options.snapshot({ description: `应用位图滤镜: ${filterName}` })
      const summary = gateway.getObjectSummary(objectId)
      if (!summary) throw new Error(`对象摘要读取失败: ${objectId}`)
      return summary
    },

    /**
     * 裁剪目标位图（crop_image 实现）：校验目标为位图后按显示包围盒坐标系换算并应用裁剪，
     * 过程挂起自动快照，结束时提交一条合并撤销记录并返回更新后的摘要。
     */
    async cropImage(objectId: string, rect: { left: number; top: number; width: number; height: number }): Promise<McpObjectSummary> {
      const target = findObject(objectId)
      if (!target) throw new Error(`未找到对象: ${objectId}`)
      if (!(target instanceof FabricImage)) {
        throw new Error(`对象不是位图（FabricImage）: ${objectId}。裁剪仅对位图对象生效`)
      }
      const imageName = String((target as AnyFabricObject).name ?? objectId)
      await options.withSnapshotSuppressed(() => {
        options.cropImageToDisplayRect(target, rect)
      })
      options.snapshot({ description: `裁剪位图: ${imageName}` })
      const summary = gateway.getObjectSummary(objectId)
      if (!summary) throw new Error(`对象摘要读取失败: ${objectId}`)
      return summary
    },

    /**
     * 设置/清除目标对象的图案填充（set_pattern_fill 实现）：
     * source 为 null 时清除图案恢复纯色；过程挂起自动快照，
     * 结束时提交一条合并撤销记录并返回更新后的摘要。
     */
    async setPatternFill(objectId: string, request: McpPatternFillRequest): Promise<McpObjectSummary> {
      const target = findObject(objectId)
      if (!target) throw new Error(`未找到对象: ${objectId}`)
      const objectName = String((target as AnyFabricObject).name ?? objectId)
      await options.withSnapshotSuppressed(() => {
        return options.applyPatternFillToObject(target, request)
      })
      options.snapshot({
        description: request.source === null ? `清除图案填充: ${objectName}` : `设置图案填充: ${objectName}`
      })
      const summary = gateway.getObjectSummary(objectId)
      if (!summary) throw new Error(`对象摘要读取失败: ${objectId}`)
      return summary
    },

    alignObjects(objectIds, mode): string[] {
      const targets = withTargets(objectIds)
      if (targets.length < 2) throw new Error('对齐至少需要 2 个对象')
      options.alignObjectsLayout(targets, mode)
      return targets.map(ensureId)
    },

    distributeObjects(objectIds, axis, mode = 'center'): string[] {
      if (axis !== 'x' && axis !== 'y') throw new Error('axis 必须是 x 或 y')
      const targets = withTargets(objectIds)
      if (targets.length < 2) throw new Error('分布至少需要 2 个对象')
      options.distributeObjectsLayout(targets, axis, mode)
      return targets.map(ensureId)
    },

    batchSetObjectsProps(objectIds: string[], props: Record<string, unknown>): McpObjectSummary[] {
      return applyPropsBatch(objectIds, props, `批量设置对象属性（${objectIds.length} 个对象）`)
    },

    batchSetObjectsPropsItems(items: McpBatchPropsItem[]): McpObjectSummary[] {
      if (!Array.isArray(items) || !items.length) throw new Error('缺少 items 参数')
      return applyPropsBatchCore(
        items.map((item) => {
          const target = findObject(item.objectId)
          if (!target) throw new Error(`未找到对象: ${item.objectId}`)
          return { target, props: item.props }
        }),
        `批量设置对象属性（${items.length} 个对象，逐对象条目）`
      )
    },

    async createObjects(items, createOptions): Promise<{ objectIds: string[]; groupId?: string }> {
      if (!Array.isArray(items) || !items.length) throw new Error('缺少 items 参数')
      const createdIds: string[] = []
      for (let index = 0; index < items.length; index++) {
        const item = items[index]
        const svg = typeof item.svg === 'string' ? item.svg.trim() : ''
        const text = typeof item.text === 'string' ? item.text.trim() : ''
        // 单个条目按 svg > shape > text 的优先级解析创建方式，创建方法内部会把新对象设为选中；
        // anchor 透传给创建方法（调度层已校验取值），控制 x/y 是中心点还是包围盒左上角。
        let createdViaText = false
        if (svg) {
          const result = await gateway.insertSvg(svg, {
            x: item.x,
            y: item.y,
            scale: item.scale,
            anchor: item.anchor,
            ...collectCreateStyleProps(item)
          })
          createdIds.push(result.objectId)
        } else if (item.shape !== undefined && item.shape !== null && String(item.shape).trim()) {
          createdIds.push(gateway.addShape(String(item.shape).trim(), {
            x: item.x,
            y: item.y,
            width: item.width,
            height: item.height,
            anchor: item.anchor,
            ...collectCreateStyleProps(item)
          }))
        } else if (text) {
          createdViaText = true
          // 文本条目只负责内容与定位：初始样式（含 fill）在创建后与其他条目一样
          // 统一经 applyPropsToObject 应用（addText 的 fill 分支保留给 add_text 操作）。
          createdIds.push(gateway.addText({ text, x: item.x, y: item.y }))
        } else {
          throw new Error(`items[${index}] 缺少 shape/svg/text 之一，无法创建对象`)
        }
        const created = findObject(createdIds[createdIds.length - 1])
        if (!created) throw new Error(`items[${index}] 创建后未能读取到新对象`)
        // shape/svg 条目的初始样式已在 addShape/insertSvg 内应用；文本条目在此统一补齐，
        // 与 set_object_props 完全同源（swatch 解析、渐变、shadow、cornerRadius 重建语义一致）。
        if (createdViaText) {
          applyCreatedStyleProps(created, item)
        }
        if (item.name !== undefined && item.name !== null && String(item.name).trim()) {
          options.setObjectName(created, String(item.name))
        }
      }
      let groupId: string | undefined
      if (createOptions?.group && createdIds.length >= 2) {
        gateway.groupObjects(createdIds)
        const groupObject = options.getSelection()[0]
        if (groupObject) {
          if (createOptions.groupName && createOptions.groupName.trim()) {
            options.setObjectName(groupObject, createOptions.groupName)
          }
          groupId = ensureId(groupObject)
        }
      }
      return { objectIds: createdIds, groupId }
    },

    undo(): void {
      options.undo()
    },

    redo(): void {
      options.redo()
    },

    jumpToHistory(index: number): void {
      options.jumpToHistory(index)
    },

    newDocument(): void {
      options.newDoc()
    },

    saveProject(): string {
      if (options.hasSavedProjectPath()) {
        options.saveActiveProjectTab()
        return '工程已保存。'
      }
      options.saveActiveProjectTab()
      return '已触发保存：当前标签尚未记忆文件路径，如弹出了保存对话框请在界面中完成路径选择。'
    },

    getProjectJson(): string {
      return stringifyProjectFile(options.createProjectFile())
    },

    async loadProjectJson(json: string): Promise<void> {
      const { project } = parseProjectFileText(json)
      await options.loadProjectFile(project)
    },

    // ── 文档级命名快照 ──
    /** 快照列表摘要：补充顶层对象数量，供 AI 评估快照内容规模。 */
    listSnapshots(): { snapshots: McpSnapshotSummary[] } {
      return {
        snapshots: options.getDocumentCanvasSnapshots().map((item) => ({
          name: item.name,
          createdAt: item.createdAt,
          objectCount: getDocumentCanvasSnapshotObjectCount(item)
        }))
      }
    },

    /**
     * 保存命名快照：内容为当前画布完整序列化 JSON（与撤销快照同源，深拷贝脱离画布；
     * 不含色板/样式预设等文档级元数据）。同名覆盖，新增超上限抛错。
     * 快照列表不进撤销历史，这里只触发草稿落盘随工程 JSON 持久化。
     */
    saveSnapshot(name: string): McpSnapshotSaveResult {
      const trimmedName = name.trim()
      if (!trimmedName) throw new Error('缺少 name 参数')
      const snapshots = options.getDocumentCanvasSnapshots()
      const exists = snapshots.some((item) => item.name === trimmedName)
      if (!exists && snapshots.length >= MAX_DOCUMENT_CANVAS_SNAPSHOTS) {
        throw new Error(`快照数量已达上限 ${MAX_DOCUMENT_CANVAS_SNAPSHOTS} 个，请先执行 delete_snapshot 删除不需要的快照`)
      }
      const canvasJson = cloneSerializedCanvas(options.serializeCanvasJson())
      const updated = options.saveDocumentCanvasSnapshot(trimmedName, canvasJson)
      const saved = updated.find((item) => item.name === trimmedName)
      options.scheduleDraftSave()
      return {
        name: trimmedName,
        objectCount: saved ? getDocumentCanvasSnapshotObjectCount(saved) : 0,
        createdAt: saved?.createdAt ?? Date.now()
      }
    },

    /**
     * 恢复命名快照：先把当前画布自动备份为 "__backup__" + 时间戳 快照防丢失，
     * 再整体替换画布内容并提交一条撤销记录（undo 即可回到恢复前状态）。
     * 备份写入受 20 个上限约束：列表已满时优先覆盖最旧的自动备份快照，
     * 没有自动备份时才覆盖最旧的命名快照，保证列表数量始终不超过上限。
     */
    async restoreSnapshot(name: string): Promise<McpSnapshotRestoreResult> {
      const trimmedName = name.trim()
      const snapshots = options.getDocumentCanvasSnapshots()
      const target = snapshots.find((item) => item.name === trimmedName)
      if (!target) throw new Error(`未找到快照: ${trimmedName}，可先执行 list_snapshots 查询`)
      const backupName = createDocumentSnapshotBackupName()
      if (
        !snapshots.some((item) => item.name === backupName)
        && snapshots.length >= MAX_DOCUMENT_CANVAS_SNAPSHOTS
      ) {
        const oldestBackup = snapshots.find((item) => item.name.startsWith(SNAPSHOT_BACKUP_NAME_PREFIX))
        const replaced = oldestBackup ?? snapshots[0]
        if (replaced) options.removeDocumentCanvasSnapshot(replaced.name)
      }
      options.saveDocumentCanvasSnapshot(backupName, cloneSerializedCanvas(options.serializeCanvasJson()))
      await options.restoreCanvasContentFromJson(cloneSerializedCanvas(target.canvasJson))
      options.snapshot({ description: `恢复快照: ${trimmedName}` })
      return {
        name: trimmedName,
        backupName,
        objectCount: getDocumentCanvasSnapshotObjectCount(target)
      }
    },

    /** 删除指定名称的命名快照（含自动备份快照），返回剩余快照列表并触发草稿落盘。 */
    deleteSnapshot(name: string): { snapshots: McpSnapshotSummary[] } {
      const trimmedName = name.trim()
      const exists = options.getDocumentCanvasSnapshots().some((item) => item.name === trimmedName)
      if (!exists) throw new Error(`未找到快照: ${trimmedName}，可先执行 list_snapshots 查询`)
      options.removeDocumentCanvasSnapshot(trimmedName)
      options.scheduleDraftSave()
      return gateway.listSnapshots()
    },

    async switchArtboard(artboardId: string): Promise<void> {
      const exists = options.artboards().some((artboard) => artboard.id === artboardId)
      if (!exists) throw new Error(`未找到画板: ${artboardId}`)
      await options.switchArtboard(artboardId)
    },

    async addArtboard(): Promise<string> {
      await options.addArtboard()
      const activeId = options.activeArtboardId()
      if (!activeId) throw new Error('新建画板后未能读取到画板 id')
      return activeId
    },

    async deleteArtboard(artboardId: string): Promise<void> {
      if (options.artboards().length <= 1) throw new Error('至少需要保留一个画板')
      await options.deleteArtboard(artboardId)
    },

    renameArtboard(artboardId: string, name: string): void {
      options.renameArtboardDirect(artboardId, name)
    },

    async exportSvgText(exportOptions: McpExportSvgTextOptions = {}): Promise<string> {
      const run = () => options.exportSvgText(exportOptions.includeBackground ?? false)
      return exportOptions.artboardId ? options.withArtboardExport(exportOptions.artboardId, run) : run()
    },

    async exportPngDataUrl(exportOptions: McpExportPngDataUrlOptions = {}): Promise<string> {
      const run = () => options.exportPngDataUrl({
        size: exportOptions.size,
        transparentBackground: exportOptions.transparentBackground,
        format: exportOptions.format,
        quality: exportOptions.quality
      })
      const dataUrl = exportOptions.artboardId
        ? await options.withArtboardExport(exportOptions.artboardId, run)
        : run()
      if (!dataUrl) throw new Error('位图渲染失败')
      return dataUrl
    },

    /**
     * 渲染画布快速预览图：复用导出管线的渲染路径但固定透明底，
     * 输出宽高按画布宽高比由 size 推导（宽 = size，高 = size × 画布高宽比）。
     * 提供 outputPath 时走文件落盘管线：把路径拆为 outputDir（最后一个 / 或 \ 之前，含分隔符）
     * 与 fileName（最后一段）后复用 exportPngFile 写盘，只返回 filePath（不生成 dataUrl，
     * 避免 base64 占用大量 token）；未提供 outputPath 时返回 dataUrl，行为与历史版本一致。
     * 指定 artboardId 时在画板临时加载上下文内取画布尺寸，保证宽高与实际渲染内容一致。
     */
    async getCanvasThumbnail(thumbnailOptions: McpCanvasThumbnailOptions = {}): Promise<McpCanvasThumbnailResult> {
      const size = thumbnailOptions.size ?? 256
      const measure = (): { width: number; height: number } => {
        const canvasWidth = options.canvasWidth()
        const canvasHeight = options.canvasHeight()
        return {
          width: Math.round(canvasWidth * (size / canvasWidth)),
          height: Math.round(canvasHeight * (size / canvasWidth))
        }
      }
      const outputPath = thumbnailOptions.outputPath
      if (outputPath) {
        const lastSeparator = Math.max(outputPath.lastIndexOf('/'), outputPath.lastIndexOf('\\'))
        const outputDir = lastSeparator >= 0 ? outputPath.slice(0, lastSeparator + 1) : undefined
        const fileName = lastSeparator >= 0 ? outputPath.slice(lastSeparator + 1) : outputPath
        if (!fileName) throw new Error(`outputPath 缺少文件名: ${outputPath}`)
        const runFile = (): McpCanvasThumbnailResult => {
          const filePath = options.exportPngFile({
            size,
            fileName,
            transparentBackground: true,
            format: 'png',
            outputDir
          })
          if (!filePath) throw new Error(`缩略图写入文件失败: ${outputPath}（导出服务不可用或写入被拒绝）`)
          return { ...measure(), filePath }
        }
        return thumbnailOptions.artboardId
          ? options.withArtboardExport(thumbnailOptions.artboardId, runFile)
          : runFile()
      }
      const run = (): McpCanvasThumbnailResult => {
        const dataUrl = options.exportPngDataUrl({
          size,
          transparentBackground: true,
          format: 'png'
        })
        if (!dataUrl) throw new Error('画布渲染失败')
        return { ...measure(), dataUrl }
      }
      return thumbnailOptions.artboardId
        ? options.withArtboardExport(thumbnailOptions.artboardId, run)
        : run()
    },

    async exportSvgFile(exportOptions: McpExportSvgFileOptions = {}): Promise<string> {
      const run = () => options.exportSvgFile({
        fileName: exportOptions.fileName,
        includeBackground: exportOptions.includeBackground,
        outputDir: exportOptions.outputDir
      })
      const filePath = exportOptions.artboardId
        ? await options.withArtboardExport(exportOptions.artboardId, run)
        : await run()
      if (!filePath) throw new Error('SVG 导出失败')
      return filePath
    },

    async exportPngFile(exportOptions: McpExportPngFileOptions = {}): Promise<string> {
      const run = () => options.exportPngFile({
        size: exportOptions.size,
        fileName: exportOptions.fileName,
        transparentBackground: exportOptions.transparentBackground,
        format: exportOptions.format,
        quality: exportOptions.quality,
        outputDir: exportOptions.outputDir
      })
      const filePath = exportOptions.artboardId
        ? await options.withArtboardExport(exportOptions.artboardId, run)
        : run()
      if (!filePath) throw new Error('位图导出失败')
      return filePath
    },

    async exportSizeSet(exportOptions: McpExportSizeSetOptions): Promise<McpExportSizeSetResult> {
      const run = () => options.exportSizeSet(exportOptions)
      return exportOptions.artboardId
        ? options.withArtboardExport(exportOptions.artboardId, run)
        : run()
    },

    async exportIconContainer(exportOptions: McpExportIconContainerOptions): Promise<McpExportIconContainerResult> {
      const run = () => options.exportIconContainer(exportOptions)
      return exportOptions.artboardId
        ? options.withArtboardExport(exportOptions.artboardId, run)
        : run()
    },

    /**
     * 布尔运算入口：解析 objectIds（或当前选区）→ 修正参与顺序 → 调用运行时核心实现，
     * 成功后提交一条撤销快照并返回结果对象 id。subtract 只取图层顺序的前两个对象。
     */
    async booleanOps(objectIds, operation, subtractDirection = 'forward'): Promise<{ objectId: string; operation: 'union' | 'intersect' | 'subtract' | 'xor' }> {
      if (operation !== 'union' && operation !== 'intersect' && operation !== 'subtract' && operation !== 'xor') {
        throw new Error(`未知布尔运算: ${String(operation)}。operation 必须是 union/intersect/subtract/xor 之一`)
      }
      if (subtractDirection !== 'forward' && subtractDirection !== 'reverse') {
        throw new Error('subtractDirection 必须是 forward 或 reverse')
      }

      let objects: FabricObject[]
      if (objectIds && objectIds.length) {
        objects = objectIds.map((id) => {
          const target = findObject(id)
          if (!target) throw new Error(`未找到对象: ${id}`)
          return target
        })
      } else {
        objects = options.getSelection().filter((obj) => !options.isBooleanPreviewObject(obj))
        if (!objects.length) throw new Error('缺少 objectIds 参数且当前没有选中对象')
      }

      // 与布尔运算语义保持一致：按图层顺序参与运算；subtract 只取最前面的两个对象。
      const canvasObjects = options.getObjects()
      const ordered = objects
        .filter((obj) => canvasObjects.includes(obj))
        .sort((a, b) => canvasObjects.indexOf(a) - canvasObjects.indexOf(b))
      const effective = operation === 'subtract' ? ordered.slice(0, 2) : ordered
      if (effective.length < 2) {
        throw new Error(`布尔运算至少需要 2 个对象，当前提供 ${effective.length} 个`)
      }

      const { result, error } = await options.runBooleanOperationOnObjects(effective, operation, subtractDirection)
      if (error || !result) throw new Error(error || '布尔运算失败')
      options.snapshot({ description: `布尔运算: ${BOOLEAN_OPERATION_LABELS[operation]}` })
      return { objectId: ensureId(result), operation }
    },

    setViewport(settings): void {
      if (settings.fit) options.fitCanvasInView()
      else if (settings.zoom !== undefined) options.setZoom(settings.zoom)
    },

    async runInEditor<T>(fn: (editor: McpEditorGatewayInternals) => T | Promise<T>): Promise<T> {
      const internals: McpEditorGatewayInternals = {
        fabricCanvas: options.getFabricCanvas(),
        activeObject: options.getActiveObject()
      }
      return await fn(internals)
    }
  }

  // 挂一个便于调试的标识：确保 ID 前缀引用不因 tree-shaking 丢失。
  void EDITOR_OBJECT_ID_PREFIX

  return gateway
}
