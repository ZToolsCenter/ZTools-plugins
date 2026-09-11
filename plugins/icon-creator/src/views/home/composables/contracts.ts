import type { Canvas, FabricObject } from 'fabric'
import type { Ref } from 'vue'
import type { DocumentCanvasSnapshot } from '../documentSnapshots'
import type { DecodedProjectDraft, ProjectDraftTab } from '../projectDraft'
import type {
  IconCreatorProjectArtboard,
  IconCreatorProjectFile,
  KeylineTemplate,
  ProjectLoadOptions,
  SnapshotOptions
} from '../types'

export interface HistorySnapshot {
  json: string
  description: string
  timestamp: number
}

export interface HistoryState {
  undoStack: HistorySnapshot[]
  redoStack: HistorySnapshot[]
  historyIndex: number
}

export type HomeToastType = 'success' | 'error' | 'info' | 'warning'
export type HomeShowToast = (message: string, type?: HomeToastType, duration?: number) => void

export interface HomeSnapshotGate {
  get: () => boolean
  set: (value: boolean) => void
}

export interface HomeCanvasStateRefs {
  canvasWidth: Ref<number>
  canvasHeight: Ref<number>
  canvasBg: Ref<string>
  lastOpaqueCanvasBg: Ref<string>
  showPixelGrid: Ref<boolean>
  snapToPixelGrid: Ref<boolean>
  pixelGridSize: Ref<number>
  pixelPaintBrushSize: Ref<number>
  keylineTemplate: Ref<KeylineTemplate>
  keylineMargin: Ref<number>
  keylineOpacity: Ref<number>
}

export interface HomeArtboardStateRefs {
  artboards: Ref<IconCreatorProjectArtboard[]>
  activeArtboardId: Ref<string>
  showArtboardList: Ref<boolean>
}

/** 页面层收集的多标签草稿快照：激活标签工程由调用方传入最新序列化结果，其余标签复用内存工程克隆。 */
export interface HomeDraftTabsSnapshot {
  activeTabId: string
  tabs: ProjectDraftTab[]
}

export interface HomeCanvasRestoreCallbacks {
  clearBooleanPreview: () => void
  clearPointEditing: () => void
  syncPixelGridSizeInput: () => void
  syncPixelPaintBrushSizeInput: () => void
  syncKeylineMarginInput: () => void
  syncCanvasSizeInputs: () => void
  syncCanvasInteractionMode: () => void
  applyCanvasBgToFabric: (value: string) => void
  syncActiveObject: (obj: FabricObject | null) => void
  syncAllKaleidoscopes: () => Promise<void>
  ensureCanvasObjectMetadata: () => void
  applyProjectLayerOrder: (layerOrder: string[]) => void
  rehydrateCanvasGradientFills: () => void
  syncAllEndpointAttachments: () => void
  applyCanvasTheme: () => void
  refreshLayers: () => void
  fitCanvasInView: () => void
  markSmallPreviewsDirty: () => void
}

export interface UseHomeArtboardsOptions extends HomeCanvasRestoreCallbacks {
  artboardIdSeed: Ref<number>
  getFabricCanvas: () => Canvas | null
  serializeFabricCanvas: () => Record<string, unknown>
  snapshotGate: HomeSnapshotGate
  snapshot: (options?: SnapshotOptions) => void
  canvasState: HomeCanvasStateRefs
  showToast: HomeShowToast
  isBooleanPreviewObject: (obj: FabricObject | null | undefined) => boolean
  ensureEditorObjectId: (obj: FabricObject | null | undefined) => string
  isTransparentCanvasBg: (value: unknown) => boolean
}

export interface UseHomeArtboardsReturn extends HomeArtboardStateRefs {
  artboardRenameDialog: Ref<{ show: boolean; value: string; targetId: string }>
  captureCurrentArtboard: () => IconCreatorProjectArtboard
  loadArtboardContent: (artboard: IconCreatorProjectArtboard) => Promise<void>
  switchArtboard: (artboardId: string) => Promise<void>
  addArtboard: () => Promise<void>
  duplicateArtboard: (artboardId: string) => void
  renameArtboard: (artboardId: string) => void
  confirmArtboardRename: () => void
  handleArtboardRenameDialogShowChange: (show: boolean) => void
  deleteArtboard: (artboardId: string) => Promise<void>
}

export interface UseHomeDocumentOptions extends HomeCanvasRestoreCallbacks {
  getFabricCanvas: () => Canvas | null
  serializeFabricCanvas: () => Record<string, unknown>
  snapshotGate: HomeSnapshotGate
  canvasState: HomeCanvasStateRefs
  artboardState: HomeArtboardStateRefs
  captureCurrentArtboard: () => IconCreatorProjectArtboard
  loadArtboardContent: (artboard: IconCreatorProjectArtboard) => Promise<void>
  showToast: HomeShowToast
  clearBooleanPreview: () => void
  syncCanvasBgFromFabric: () => void
  isBooleanPreviewObject: (obj: FabricObject | null | undefined) => boolean
  ensureEditorObjectId: (obj: FabricObject | null | undefined) => string
  isTransparentCanvasBg: (value: unknown) => boolean
  /**
   * 读取文档级样式元数据（命名色板与自定义样式预设）。
   * 提供后随撤销快照（editorMeta 字段）与工程 JSON（meta 字段）一起持久化。
   */
  getDocumentStyleMeta?: () => unknown
  /** 把工程 JSON 的 meta 字段写入运行时文档状态（loadProjectFile 时调用）。 */
  applyDocumentStyleMeta?: (value: unknown) => void
  /** 从撤销快照 JSON 中还原文档级样式元数据（undo/redo/jumpToHistory 时调用）。 */
  restoreDocumentStyleMetaFromSnapshot?: (snapshotJson: string) => void
  /**
   * 读取文档级命名画布快照列表。
   * 数据量大只随工程 JSON（meta.snapshots 字段）持久化，不进入撤销快照。
   */
  getDocumentSnapshots?: () => DocumentCanvasSnapshot[]
  /** 把工程 JSON 的命名画布快照写入运行时状态（loadProjectFile 时调用，传空值表示清空）。 */
  applyDocumentSnapshots?: (value: unknown) => void
  /**
   * 读取文档级对齐参考线列表（project.guides 通道）。
   * 同时随撤销快照（editorGuides 字段）与工程 JSON（guides 字段）持久化，
   * 参考线增删改与画布对象一样可以撤销 / 重做。
   */
  getDocumentGuides?: () => unknown
  /** 把工程 JSON 的 guides 写入运行时状态（loadProjectFile 时调用，传空值表示清空）。 */
  applyDocumentGuides?: (value: unknown) => void
  /** 从撤销快照 JSON 中还原文档级对齐参考线（undo/redo/jumpToHistory 时调用）。 */
  restoreDocumentGuidesFromSnapshot?: (snapshotJson: string) => void
  /**
   * 读取文档级符号定义列表（project.symbols 通道，见 symbols.ts 说明）。
   * 同时随撤销快照（editorSymbols 字段）与工程 JSON（symbols 字段）持久化，
   * 定义的新建 / 更新 / 删除与画布对象一样可以撤销 / 重做。
   */
  getDocumentSymbols?: () => unknown
  /** 把工程 JSON 的 symbols 写入运行时状态（loadProjectFile 时调用，传空值表示清空）。 */
  applyDocumentSymbols?: (value: unknown) => void
  /** 从撤销快照 JSON 中还原文档级符号定义（undo/redo/jumpToHistory 时调用）。 */
  restoreDocumentSymbolsFromSnapshot?: (snapshotJson: string) => void
  /**
   * 收集多标签草稿快照（提供后草稿按多标签结构写入，覆盖全部标签与激活态）。
   * 参数为激活标签刚序列化的工程对象；返回 null 表示标签结构暂不可写
   *（未初始化 / 切换中），本次草稿写入跳过，避免用过场状态覆盖已有草稿。
   */
  getDraftTabsSnapshot?: (currentProject: IconCreatorProjectFile) => HomeDraftTabsSnapshot | null
  /** 多标签草稿恢复回调：由页面层重建全部项目标签并把激活标签载入画布。 */
  applyDraftTabs?: (draft: DecodedProjectDraft) => Promise<void>
}

export interface UseHomeDocumentReturn {
  undoStack: HistorySnapshot[]
  historyIndex: Ref<number>
  canUndo: Ref<boolean>
  canRedo: Ref<boolean>
  snapshot: (options?: SnapshotOptions) => void
  createProjectFile: () => IconCreatorProjectFile
  captureHistoryState: () => HistoryState
  restoreHistoryState: (state: HistoryState) => void
  resetHistoryToCurrentCanvas: () => void
  loadProjectFile: (project: IconCreatorProjectFile, options?: ProjectLoadOptions) => Promise<void>
  scheduleDraftSave: () => void
  /** 立即同步写入一次草稿（不走防抖），供标签新建 / 关闭 / 切换等结构变化节点调用。 */
  saveDraftNow: () => void
  clearStoredDraft: () => void
  promptRestoreDraft: () => Promise<void>
  /** 草稿恢复确认弹窗状态（替代原生 window.confirm）：show 控制显隐，tabCount 供文案使用。 */
  draftRestoreDialog: Ref<{ show: boolean; tabCount: number }>
  /** 确认恢复暂存草稿：恢复全部项目标签（无多标签通道时退化为第一个标签）并立即写回草稿。 */
  confirmDraftRestore: () => Promise<void>
  /** 弹窗显隐变化：关闭（取消 / 蒙层 / ESC）时丢弃暂存草稿并清掉存储的草稿。 */
  handleDraftRestoreDialogShowChange: (show: boolean) => void
  flushDraftBeforeDispose: () => void
  saveProject: () => void
  saveProjectAs: (onSaved?: (filePath: string) => void) => void
  saveProjectToPath: (filePath: string) => string | undefined
  undo: () => void
  redo: () => void
  jumpToHistory: (index: number) => void
}
