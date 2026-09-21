import { nextTick, type Ref } from 'vue'
import type { Canvas, FabricObject } from 'fabric'
import {
  DEFAULT_KEYLINE_MARGIN,
  DEFAULT_KEYLINE_OPACITY,
  DEFAULT_KEYLINE_TEMPLATE,
  DEFAULT_PIXEL_GRID_SIZE
} from '../../../constants'
import type {
  HomeCanvasRestoreCallbacks,
  HomeCanvasStateRefs,
  HomeDraftTabsSnapshot,
  HomeShowToast,
  HomeSnapshotGate
} from '../../../composables/contracts'
import { useHomeArtboards } from '../../../composables/useHomeArtboards'
import { useHomeDocument } from '../../../composables/useHomeDocument'
import type { DocumentCanvasSnapshot } from '../../../documentSnapshots'
import type { DecodedProjectDraft } from '../../../projectDraft'
import { parseProjectFileText } from '../../../projectFile'
import type { IconCreatorProjectFile } from '../../../types'
import type { EditorModule } from '../../runtime/editorTypes'
import type {
  HomeWorkspaceController,
  HomeWorkspaceCommands,
  HomeWorkspaceHelpers,
  HomeWorkspaceState
} from './workspaceTypes'

export interface CreateHomeWorkspaceModuleOptions extends HomeCanvasRestoreCallbacks {
  artboardIdSeed: Ref<number>
  getFabricCanvas: () => Canvas | null
  serializeFabricCanvas: () => Record<string, unknown>
  snapshotGate: HomeSnapshotGate
  canvasState: HomeCanvasStateRefs
  showToast: HomeShowToast
  syncCanvasBgFromFabric: () => void
  isBooleanPreviewObject: (obj: FabricObject | null | undefined) => boolean
  ensureEditorObjectId: (obj: FabricObject | null | undefined) => string
  isTransparentCanvasBg: (value: unknown) => boolean
  endSpacePan: () => void
  cancelSmallPreviewsRefresh: () => void
  projectInputRef: Ref<HTMLInputElement | null>
  afterInitialDocumentReady?: () => void
  /** 读取文档级样式元数据（色板/预设），随撤销快照与工程 JSON 持久化。 */
  getDocumentStyleMeta?: () => unknown
  /** 把工程 meta / 空值写入运行时文档样式状态（newDoc 传 null 表示重置为空）。 */
  applyDocumentStyleMeta?: (value: unknown) => void
  /** 从撤销快照 JSON 还原文档级样式元数据。 */
  restoreDocumentStyleMetaFromSnapshot?: (snapshotJson: string) => void
  /** 读取文档级命名画布快照列表（数据量大只随工程 JSON 保存，不进撤销快照）。 */
  getDocumentSnapshots?: () => DocumentCanvasSnapshot[]
  /** 把工程 meta.snapshots / 空值写入运行时命名画布快照状态（newDoc 传 null 表示清空）。 */
  applyDocumentSnapshots?: (value: unknown) => void
  /** 读取文档级对齐参考线列表（随撤销快照与工程 JSON 双通道持久化）。 */
  getDocumentGuides?: () => unknown
  /** 把工程 guides / 空值写入运行时参考线状态（newDoc 传 null 表示清空）。 */
  applyDocumentGuides?: (value: unknown) => void
  /** 从撤销快照 JSON 还原文档级对齐参考线。 */
  restoreDocumentGuidesFromSnapshot?: (snapshotJson: string) => void
  /** 读取文档级符号定义列表（随撤销快照与工程 JSON 双通道持久化，见 symbols.ts 说明）。 */
  getDocumentSymbols?: () => unknown
  /** 把工程 symbols / 空值写入运行时符号定义状态（newDoc 传 null 表示清空）。 */
  applyDocumentSymbols?: (value: unknown) => void
  /** 从撤销快照 JSON 还原文档级符号定义。 */
  restoreDocumentSymbolsFromSnapshot?: (snapshotJson: string) => void
  /** 收集多标签草稿快照（提供后草稿按多标签结构写入，见 contracts 同名注释）。 */
  getDraftTabsSnapshot?: (currentProject: IconCreatorProjectFile) => HomeDraftTabsSnapshot | null
  /** 多标签草稿恢复回调：重建全部项目标签并把激活标签载入画布。 */
  applyDraftTabs?: (draft: DecodedProjectDraft) => Promise<void>
}

export interface CreateHomeWorkspaceModuleResult {
  controller: HomeWorkspaceController
  module: EditorModule
}

/**
 * 创建 Home 编辑器的 Workspace 模块，把文档、画板、历史与草稿恢复统一收口到同一控制器。
 * 模块内部继续复用 useHomeArtboards / useHomeDocument 作为子域实现，但页面层只再依赖统一的 state / commands / helpers 接口。
 */
export function createHomeWorkspaceModule(
  options: CreateHomeWorkspaceModuleOptions
): CreateHomeWorkspaceModuleResult {
  let snapshotFromDocument: HomeWorkspaceCommands['snapshot'] | null = null

  const homeArtboards = useHomeArtboards({
    artboardIdSeed: options.artboardIdSeed,
    getFabricCanvas: options.getFabricCanvas,
    serializeFabricCanvas: options.serializeFabricCanvas,
    snapshotGate: options.snapshotGate,
    snapshot: (nextOptions) => {
      snapshotFromDocument?.(nextOptions)
    },
    canvasState: options.canvasState,
    showToast: options.showToast,
    isBooleanPreviewObject: options.isBooleanPreviewObject,
    ensureEditorObjectId: options.ensureEditorObjectId,
    isTransparentCanvasBg: options.isTransparentCanvasBg,
    clearBooleanPreview: options.clearBooleanPreview,
    clearPointEditing: options.clearPointEditing,
    syncPixelGridSizeInput: options.syncPixelGridSizeInput,
    syncPixelPaintBrushSizeInput: options.syncPixelPaintBrushSizeInput,
    syncKeylineMarginInput: options.syncKeylineMarginInput,
    syncCanvasSizeInputs: options.syncCanvasSizeInputs,
    syncCanvasInteractionMode: options.syncCanvasInteractionMode,
    applyCanvasBgToFabric: options.applyCanvasBgToFabric,
    syncActiveObject: options.syncActiveObject,
    syncAllKaleidoscopes: options.syncAllKaleidoscopes,
    ensureCanvasObjectMetadata: options.ensureCanvasObjectMetadata,
    applyProjectLayerOrder: options.applyProjectLayerOrder,
    rehydrateCanvasGradientFills: options.rehydrateCanvasGradientFills,
    syncAllEndpointAttachments: options.syncAllEndpointAttachments,
    applyCanvasTheme: options.applyCanvasTheme,
    refreshLayers: options.refreshLayers,
    fitCanvasInView: options.fitCanvasInView,
    markSmallPreviewsDirty: options.markSmallPreviewsDirty
  })

  const homeDocument = useHomeDocument({
    getFabricCanvas: options.getFabricCanvas,
    serializeFabricCanvas: options.serializeFabricCanvas,
    snapshotGate: options.snapshotGate,
    canvasState: options.canvasState,
    artboardState: {
      artboards: homeArtboards.artboards,
      activeArtboardId: homeArtboards.activeArtboardId,
      showArtboardList: homeArtboards.showArtboardList
    },
    captureCurrentArtboard: homeArtboards.captureCurrentArtboard,
    loadArtboardContent: homeArtboards.loadArtboardContent,
    showToast: options.showToast,
    clearBooleanPreview: options.clearBooleanPreview,
    clearPointEditing: options.clearPointEditing,
    syncPixelGridSizeInput: options.syncPixelGridSizeInput,
    syncPixelPaintBrushSizeInput: options.syncPixelPaintBrushSizeInput,
    syncKeylineMarginInput: options.syncKeylineMarginInput,
    syncCanvasSizeInputs: options.syncCanvasSizeInputs,
    syncCanvasInteractionMode: options.syncCanvasInteractionMode,
    applyCanvasBgToFabric: options.applyCanvasBgToFabric,
    syncCanvasBgFromFabric: options.syncCanvasBgFromFabric,
    syncActiveObject: options.syncActiveObject,
    syncAllKaleidoscopes: options.syncAllKaleidoscopes,
    ensureCanvasObjectMetadata: options.ensureCanvasObjectMetadata,
    applyProjectLayerOrder: options.applyProjectLayerOrder,
    rehydrateCanvasGradientFills: options.rehydrateCanvasGradientFills,
    syncAllEndpointAttachments: options.syncAllEndpointAttachments,
    applyCanvasTheme: options.applyCanvasTheme,
    refreshLayers: options.refreshLayers,
    fitCanvasInView: options.fitCanvasInView,
    markSmallPreviewsDirty: options.markSmallPreviewsDirty,
    isBooleanPreviewObject: options.isBooleanPreviewObject,
    ensureEditorObjectId: options.ensureEditorObjectId,
    isTransparentCanvasBg: options.isTransparentCanvasBg,
    getDocumentStyleMeta: options.getDocumentStyleMeta,
    applyDocumentStyleMeta: options.applyDocumentStyleMeta,
    restoreDocumentStyleMetaFromSnapshot: options.restoreDocumentStyleMetaFromSnapshot,
    getDocumentSnapshots: options.getDocumentSnapshots,
    applyDocumentSnapshots: options.applyDocumentSnapshots,
    getDocumentGuides: options.getDocumentGuides,
    applyDocumentGuides: options.applyDocumentGuides,
    restoreDocumentGuidesFromSnapshot: options.restoreDocumentGuidesFromSnapshot,
    getDocumentSymbols: options.getDocumentSymbols,
    applyDocumentSymbols: options.applyDocumentSymbols,
    restoreDocumentSymbolsFromSnapshot: options.restoreDocumentSymbolsFromSnapshot,
    getDraftTabsSnapshot: options.getDraftTabsSnapshot,
    applyDraftTabs: options.applyDraftTabs
  })

  snapshotFromDocument = homeDocument.snapshot

  const state: HomeWorkspaceState = {
    artboards: homeArtboards.artboards,
    activeArtboardId: homeArtboards.activeArtboardId,
    showArtboardList: homeArtboards.showArtboardList,
    artboardRenameDialog: homeArtboards.artboardRenameDialog,
    draftRestoreDialog: homeDocument.draftRestoreDialog,
    undoStack: homeDocument.undoStack,
    historyIndex: homeDocument.historyIndex,
    canUndo: homeDocument.canUndo,
    canRedo: homeDocument.canRedo
  }

  const helpers: HomeWorkspaceHelpers = {
    captureCurrentArtboard: homeArtboards.captureCurrentArtboard,
    createProjectFile: homeDocument.createProjectFile,
    loadArtboardContent: homeArtboards.loadArtboardContent
  }

  /**
   * 新建空白工作区时统一清空画板、历史、草稿与文档级元数据（色板/预设/命名画布快照），
   * 并保留当前画布尺寸/背景配置。
   * 这样模板应用、顶部“新建”命令和后续 workspace 工作流都复用同一套文档重置入口。
   */
  function newDoc() {
    const fabricCanvas = options.getFabricCanvas()
    if (!fabricCanvas) return

    options.clearBooleanPreview()
    options.clearPointEditing()
    options.applyDocumentStyleMeta?.(null)
    options.applyDocumentSnapshots?.(null)
    // 新建文档同步清空对齐参考线与符号定义（传 null 表示按新文档重置）。
    options.applyDocumentGuides?.(null)
    options.applyDocumentSymbols?.(null)
    homeDocument.clearStoredDraft()
    state.artboards.value = []
    state.activeArtboardId.value = ''
    state.showArtboardList.value = false

    const previousSnapshotGate = options.snapshotGate.get()
    options.snapshotGate.set(true)
    try {
      fabricCanvas.clear()
    } finally {
      options.snapshotGate.set(previousSnapshotGate)
    }

    options.canvasState.showPixelGrid.value = false
    options.canvasState.snapToPixelGrid.value = false
    options.canvasState.pixelGridSize.value = DEFAULT_PIXEL_GRID_SIZE
    options.canvasState.keylineTemplate.value = DEFAULT_KEYLINE_TEMPLATE
    options.canvasState.keylineMargin.value = DEFAULT_KEYLINE_MARGIN
    options.canvasState.keylineOpacity.value = DEFAULT_KEYLINE_OPACITY
    options.syncPixelGridSizeInput()
    options.syncKeylineMarginInput()
    options.syncCanvasInteractionMode()
    options.applyCanvasBgToFabric(options.canvasState.canvasBg.value)
    fabricCanvas.requestRenderAll()
    options.syncActiveObject(null)
    options.refreshLayers()
    homeDocument.resetHistoryToCurrentCanvas()
  }

  /**
   * 只负责触发隐藏的工程文件输入，让打开工程命令可以脱离页面按钮实现独立复用。
   */
  function openProject() {
    options.projectInputRef.value?.click()
  }

  /**
   * 从工程文件输入恢复项目内容，解析或恢复失败时保留当前工作区并复位 input，便于重复选择同一文件。
   */
  async function onProjectFileChosen(event: Event) {
    const input = event.target as HTMLInputElement
    const file = input.files?.[0]
    if (!file) return
    try {
      const { project } = parseProjectFileText(await file.text())
      await homeDocument.loadProjectFile(project)
    } catch (error) {
      options.showToast(error instanceof Error ? error.message : '打开工程失败', 'error')
    } finally {
      input.value = ''
    }
  }

  const commands: HomeWorkspaceCommands = {
    addArtboard: homeArtboards.addArtboard,
    captureHistoryState: homeDocument.captureHistoryState,
    clearStoredDraft: homeDocument.clearStoredDraft,
    deleteArtboard: homeArtboards.deleteArtboard,
    duplicateArtboard: homeArtboards.duplicateArtboard,
    flushDraftBeforeDispose: homeDocument.flushDraftBeforeDispose,
    jumpToHistory: homeDocument.jumpToHistory,
    loadProjectFile: homeDocument.loadProjectFile,
    newDoc,
    onProjectFileChosen,
    openProject,
    promptRestoreDraft: homeDocument.promptRestoreDraft,
    confirmDraftRestore: homeDocument.confirmDraftRestore,
    handleDraftRestoreDialogShowChange: homeDocument.handleDraftRestoreDialogShowChange,
    redo: homeDocument.redo,
    renameArtboard: homeArtboards.renameArtboard,
    resetHistoryToCurrentCanvas: homeDocument.resetHistoryToCurrentCanvas,
    restoreHistoryState: homeDocument.restoreHistoryState,
    saveProject: homeDocument.saveProject,
    saveProjectAs: homeDocument.saveProjectAs,
    saveProjectToPath: homeDocument.saveProjectToPath,
    saveDraftNow: homeDocument.saveDraftNow,
    scheduleDraftSave: homeDocument.scheduleDraftSave,
    snapshot: homeDocument.snapshot,
    switchArtboard: homeArtboards.switchArtboard,
    undo: homeDocument.undo,
    confirmArtboardRename: homeArtboards.confirmArtboardRename,
    handleArtboardRenameDialogShowChange: homeArtboards.handleArtboardRenameDialogShowChange
  }

  const module: EditorModule = {
    name: 'home-workspace',
    onDocumentReady(context) {
      void nextTick(async () => {
        if (context.getPhase() === 'disposed' || !context.getCanvas()) return
        options.fitCanvasInView()
        commands.snapshot({ autoSave: false })
        await commands.promptRestoreDraft()
        options.afterInitialDocumentReady?.()
      })
    },
    onDispose() {
      options.endSpacePan()
      options.clearBooleanPreview()
      options.clearPointEditing()
      options.cancelSmallPreviewsRefresh()
      commands.flushDraftBeforeDispose()
    }
  }

  return {
    controller: {
      state,
      commands,
      helpers
    },
    module
  }
}
