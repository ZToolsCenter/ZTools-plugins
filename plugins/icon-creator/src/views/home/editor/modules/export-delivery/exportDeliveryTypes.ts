import type { ComputedRef, Ref } from 'vue'
import type { Canvas, FabricObject } from 'fabric'
import type {
  ClipboardEntry,
  ExportDialogState,
  ExportFormat,
  IconCreatorProjectArtboard,
  IconCreatorProjectFile,
  InternalClipboard,
  ProjectLoadOptions
} from '../../../types'
import type { EditorPlatform, ShortcutActionDefinition, ShortcutActionId, ShortcutGroupDefinition } from '../../../shortcuts'

export interface HomeExportDeliveryState {
  exportDialog: ExportDialogState
  exportDialogCanExport: ComputedRef<boolean>
  exportDialogSelectedPreset: Ref<string>
  filteredShortcutGroups: ComputedRef<Array<ShortcutGroupDefinition & { actions: ShortcutActionDefinition[] }>>
  shortcutBindings: Record<ShortcutActionId, string[]>
  shortcutDrawerOpen: Ref<boolean>
  shortcutPlatform: EditorPlatform
  shortcutSearch: Ref<string>
}

export interface HomeExportDeliveryCommands {
  addShortcutBinding: (actionId: ShortcutActionId) => void
  applyShortcutBinding: (actionId: ShortcutActionId, oldValue: string, nextValue: string) => void
  closeShortcutDrawer: () => void
  copyAsPNG: () => Promise<void>
  copyAsSVG: () => Promise<void>
  executeShortcutAction: (actionId: ShortcutActionId) => Promise<void>
  getShortcutActionByEvent: (event: KeyboardEvent) => ShortcutActionDefinition | null
  handleExportDialogShowChange: (show: boolean) => void
  handleExportPresetSelect: (presetId: string) => void
  loadShortcutBindings: () => void
  openExportDialog: () => void
  openShortcutDrawer: () => void
  removeShortcutBinding: (actionId: ShortcutActionId, binding: string) => void
  resetShortcutBindingsToDefault: () => void
  runExportDialogExport: () => Promise<void>
  setExportFormatEnabled: (format: ExportFormat, enabled: boolean) => void
  toggleExportPngSize: (size: number) => void
}

export interface HomeExportDeliveryHelpers {
  copySelectionToInternalClipboard: () => boolean
  createCanvasSVGPreview: (includeBackground?: boolean) => Promise<string>
  /** 为选中对象构建裁剪后的临时画布，供选中内容导出 SVG 使用；无选中或边界无效返回 null。 */
  createSelectionCanvas: (objects: FabricObject[]) => Promise<Canvas | null>
  /** 生成选中对象的优化 SVG 文本（未选中时回退整画布），不触碰系统剪贴板。 */
  createSelectionSvgText: () => Promise<string>
  duplicateSelection: () => Promise<boolean>
  exportPNG: (size?: number, fileName?: string, transparentBackground?: boolean, format?: 'png' | 'webp', quality?: number, outputDir?: string) => string
  exportSVG: (fileName?: string, includeBackground?: boolean, outputDir?: string) => Promise<string>
  pasteInternalClipboard: (clipboard?: InternalClipboard | null) => Promise<boolean>
  renderPNGDataUrl: (size: number, transparentBackground: boolean, format?: 'png' | 'webp', quality?: number) => string
  /** 按预设或自定义尺寸列表批量导出 PNG，返回每个尺寸的文件路径与输出目录。 */
  exportSizeSet: (request: ExportSizeSetRequest) => ExportSizeSetResult
  /** 按目标容器格式（ico/icns）渲染各尺寸 PNG 并打包落盘，返回文件路径与实际尺寸列表。 */
  exportIconContainer: (request: ExportIconContainerRequest) => ExportIconContainerResult
  /**
   * 把指定画板临时加载到当前画布执行回调，结束后恢复执行前的完整工程状态；
   * 画板 id 不存在时抛错，目标画板即当前画板时直接执行不做切换。
   */
  withArtboardExport: <T>(artboardId: string, run: () => T | Promise<T>) => Promise<T>
}

/**
 * 多尺寸 PNG 批量导出请求：preset 指定内置尺寸集（custom 或省略时必须提供 sizes），
 * sizes 可覆盖预设尺寸，outputDir 为绝对目录时写入该目录（缺省写入下载目录）。
 */
export interface ExportSizeSetRequest {
  preset?: 'favicon' | 'pwa' | 'android' | 'ios' | 'electron' | 'custom'
  sizes?: number[]
  fileNamePrefix?: string
  transparentBackground?: boolean
  outputDir?: string
}

/** 多尺寸 PNG 批量导出结果：files 与 sizes 一一对应（升序），outputDir 为实际输出目录。 */
export interface ExportSizeSetResult {
  files: Array<{ size: number; filePath: string }>
  outputDir: string
}

/** 图标容器（ico/icns）导出请求：sizes 缺省时使用该格式默认尺寸集，outputDir 语义同多尺寸导出。 */
export interface ExportIconContainerRequest {
  format: 'ico' | 'icns'
  sizes?: number[]
  fileName?: string
  outputDir?: string
}

/** 图标容器导出结果：sizes 为实际打包的升序尺寸列表。 */
export interface ExportIconContainerResult {
  filePath: string
  sizes: number[]
}

export interface HomeExportDeliveryController {
  commands: HomeExportDeliveryCommands
  helpers: HomeExportDeliveryHelpers
  state: HomeExportDeliveryState
}

export type HomeExportDeliveryLayoutActions = {
  canGroup: { value: boolean }
  canUngroup: { value: boolean }
  fitCanvasInView: () => void
  groupObjects: () => void
  layerBottom: () => void
  layerDown: () => void
  layerTop: () => void
  layerUp: () => void
  selectAllByMode: () => void
  setSelectionMode: (mode: 'shape' | 'point' | 'segment') => void
  setZoom: (value: number) => void
  toggleRuler: () => void
  ungroupObject: () => void
  zoom: { value: number }
}

export interface HomeExportDeliveryClipboardOptions {
  applyActiveObjectsSelection: (objects: FabricObject[]) => void
  applyCanvasThemeToObject: (obj: FabricObject | null | undefined) => void
  applyDefaultKaleidoscopeMetadata: (obj: FabricObject) => void
  applyGradientMetadataToCanvasObject: (obj: FabricObject | null | undefined) => void
  canUseKaleidoscopeAsSource: (obj: FabricObject | null | undefined) => boolean
  clearBooleanPreview: () => void
  clearKaleidoscopeMetadata: (obj: FabricObject) => void
  clearPointEditing: () => void
  createClipboardEntry: (obj: FabricObject) => ClipboardEntry
  createKaleidoscopeSourceId: () => string
  getCurrentCopyTargets: () => FabricObject[]
  getFabricCanvas: () => Canvas | null
  getKaleidoscopeEffectiveCenter: (obj: FabricObject) => { x: number; y: number }
  getKaleidoscopeMetadata: (obj: FabricObject) => Record<string, any> | null | undefined
  isKaleidoscopeSource: (obj: FabricObject | null | undefined) => boolean
  nextName: (type: string) => string
  normalizeKaleidoscopeCount: (value: unknown) => number
  prepareClonedObjectMetadata: (obj: FabricObject) => void
  rebuildKaleidoscopeInstances: (obj: FabricObject) => Promise<void>
  refreshLayers: () => void
  setSelectionMode: (mode: 'shape' | 'point' | 'segment') => void
  snapshot: () => void
  snapshotGate: { get: () => boolean; set: (value: boolean) => void }
}

export interface HomeExportDeliveryExportOptions {
  activeArtboardId: { value: string }
  artboards: { value: IconCreatorProjectArtboard[] }
  canvasBg: { value: string }
  canvasWidth: { value: number }
  canvasHeight: { value: number }
  captureCurrentArtboard: () => IconCreatorProjectArtboard
  clearBooleanPreview: () => void
  createProjectFile: () => IconCreatorProjectFile
  getFabricCanvas: () => Canvas | null
  getObjectsCombinedBounds: (objects: FabricObject[]) => { left: number; top: number; width: number; height: number } | null
  isTransparentCanvasBg: (value: unknown) => boolean
  loadArtboardContent: (artboard: IconCreatorProjectArtboard) => Promise<void>
  loadProjectFile: (project: IconCreatorProjectFile, options?: ProjectLoadOptions) => Promise<void>
}

export interface HomeExportDeliveryShortcutOptions extends HomeExportDeliveryLayoutActions {
  activeObject: { value: FabricObject | null }
  canRedo: { value: boolean }
  canUndo: { value: boolean }
  deleteObject: () => void
  activatePenTool: () => void
  activatePaintBucketTool: () => void
  saveProject: () => void
  selectionMode: { value: 'shape' | 'point' | 'segment' }
  showToast: (message: string, type?: 'success' | 'error' | 'info' | 'warning', duration?: number) => void
  undo: () => void
  redo: () => void
  copyStyle: () => void
  pasteStyle: () => void
}
