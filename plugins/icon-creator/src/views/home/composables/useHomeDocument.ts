import { ref } from 'vue'
import { DRAFT_QUOTA_TOAST_THROTTLE, DRAFT_SAVE_DELAY, DRAFT_STORAGE_KEY, PROJECT_FILE_EXTENSION, PROJECT_SCHEMA_VERSION } from '../constants'
import { normalizeKeylineMargin, normalizeKeylineOpacity, normalizeKeylineTemplate, normalizePixelGridSize, normalizePixelPaintBrushSize } from '../canvasSettings'
import { isEmptyDocumentStyleMeta, normalizeDocumentStyleMeta } from '../documentStyleMeta'
import type { DocumentStyleMeta } from '../documentStyleMeta'
import { normalizeProjectCanvasSettings, stringifyProjectFile } from '../projectFile'
import { buildDraftWriteCandidates, buildLegacyDraftWriteCandidates, decodeProjectDraft, encodeProjectDraft } from '../projectDraft'
import type { ProjectDraftFile } from '../projectDraft'
import type { IconCreatorDraftFile, IconCreatorProjectFile, SnapshotOptions } from '../types'
import type { DecodedProjectDraft } from '../projectDraft'
import type { HistorySnapshot, HistoryState, UseHomeDocumentOptions, UseHomeDocumentReturn } from './contracts'

export function useHomeDocument(options: UseHomeDocumentOptions): UseHomeDocumentReturn {
  const {
    getFabricCanvas,
    serializeFabricCanvas,
    snapshotGate,
    canvasState,
    artboardState,
    captureCurrentArtboard,
    loadArtboardContent,
    showToast,
    clearBooleanPreview,
    clearPointEditing,
    syncPixelGridSizeInput,
    syncPixelPaintBrushSizeInput,
    syncKeylineMarginInput,
    syncCanvasSizeInputs,
    syncCanvasInteractionMode,
    applyCanvasBgToFabric,
    syncCanvasBgFromFabric,
    syncActiveObject,
    syncAllKaleidoscopes,
    ensureCanvasObjectMetadata,
    applyProjectLayerOrder,
    rehydrateCanvasGradientFills,
    syncAllEndpointAttachments,
    applyCanvasTheme,
    refreshLayers,
    fitCanvasInView,
    markSmallPreviewsDirty,
    isBooleanPreviewObject,
    ensureEditorObjectId,
    isTransparentCanvasBg,
    getDocumentStyleMeta,
    applyDocumentStyleMeta,
    restoreDocumentStyleMetaFromSnapshot,
    getDocumentSnapshots,
    applyDocumentSnapshots,
    getDocumentGuides,
    applyDocumentGuides,
    restoreDocumentGuidesFromSnapshot,
    getDocumentSymbols,
    applyDocumentSymbols,
    restoreDocumentSymbolsFromSnapshot,
    getDraftTabsSnapshot,
    applyDraftTabs
  } = options

  const { canvasWidth, canvasHeight, canvasBg, lastOpaqueCanvasBg, showPixelGrid, snapToPixelGrid, pixelGridSize, pixelPaintBrushSize, keylineTemplate, keylineMargin, keylineOpacity } = canvasState
  const { artboards, activeArtboardId, showArtboardList } = artboardState

  const undoStack: HistorySnapshot[] = []
  const redoStack: HistorySnapshot[] = []
  const historyIndex = ref(0)
  const canUndo = ref(false)
  const canRedo = ref(false)

  let draftSaveTimer: ReturnType<typeof window.setTimeout> | null = null
  let draftDirty = false
  let restoringDraftPromptShown = false
  // 草稿恢复确认弹窗状态：show 控制显隐，tabCount 供弹窗文案体现恢复范围。
  const draftRestoreDialog = ref({ show: false, tabCount: 0 })
  // 弹窗展示期间暂存的待恢复草稿；确认恢复时消费，取消 / 关闭时丢弃并清理存储。
  let pendingRestoreDraft: DecodedProjectDraft | null = null
  // 上次草稿写入失败提示的时间戳：按节流间隔 toast，避免连续编辑失败时提示刷屏。
  let lastDraftQuotaToastAt = 0

  /**
   * 组装撤销快照 JSON：画布序列化结果 + 文档级样式元数据（editorMeta 字段）+ 对齐参考线（editorGuides 字段）
   * + 符号定义（editorSymbols 字段）。
   * 元数据 / 参考线 / 符号为空时省略对应字段，保持与旧快照结构一致。
   * 参考线与符号定义入撤销快照：增删改与画布对象保持一致的可撤销体验
   * （见 documentGuides.ts / symbols.ts 说明）。
   */
  function buildSnapshotPayload(): Record<string, unknown> {
    const canvasPayload = serializeFabricCanvas()
    const styleMeta = getDocumentStyleMeta?.() as DocumentStyleMeta | undefined
    const payload: Record<string, unknown> = styleMeta && !isEmptyDocumentStyleMeta(styleMeta)
      ? { ...canvasPayload, editorMeta: styleMeta }
      : canvasPayload
    const guides = getDocumentGuides?.() as unknown[] | undefined
    if (guides && guides.length > 0) payload.editorGuides = guides
    const symbols = getDocumentSymbols?.() as unknown[] | undefined
    if (symbols && symbols.length > 0) payload.editorSymbols = symbols
    return payload
  }

  function snapshot(options: SnapshotOptions = {}) {
    const fabricCanvas = getFabricCanvas()
    if (snapshotGate.get() || !fabricCanvas) return
    const description = options.description || '编辑操作'
    undoStack.push({
      json: JSON.stringify(buildSnapshotPayload()),
      description,
      timestamp: Date.now()
    })
    if (undoStack.length > 60) undoStack.shift()
    redoStack.length = 0
    historyIndex.value = undoStack.length - 1
    canUndo.value = undoStack.length > 1
    canRedo.value = false
    markSmallPreviewsDirty()
    if (options.autoSave !== false) scheduleDraftSave()
  }

  function createProjectFile(): IconCreatorProjectFile {
    const fabricCanvas = getFabricCanvas()
    if (!fabricCanvas) throw new Error('画布尚未初始化')
    const now = new Date().toISOString()
    const layerOrder = fabricCanvas.getObjects()
      .filter((obj) => !isBooleanPreviewObject(obj))
      .map((obj) => ensureEditorObjectId(obj))

    const projectFile: IconCreatorProjectFile = {
      app: 'icon-creator',
      schemaVersion: PROJECT_SCHEMA_VERSION,
      createdAt: now,
      updatedAt: now,
      canvas: {
        width: canvasWidth.value,
        height: canvasHeight.value,
        background: canvasBg.value,
        gridSize: pixelGridSize.value,
        showPixelGrid: showPixelGrid.value,
        snapToPixelGrid: snapToPixelGrid.value,
        brushSize: pixelPaintBrushSize.value,
        keylineTemplate: keylineTemplate.value,
        keylineMargin: keylineMargin.value,
        keylineOpacity: keylineOpacity.value
      },
      fabric: serializeFabricCanvas(),
      layerOrder
    }

    // 文档级元数据（色板/预设）为空时省略字段，保持旧工程文件结构不变。
    const styleMeta = getDocumentStyleMeta?.() as DocumentStyleMeta | undefined
    // 命名画布快照数据量大，只随工程 JSON 持久化，不进入撤销快照通道。
    const documentSnapshots = getDocumentSnapshots?.() ?? []
    const hasStyleMeta = !!styleMeta && !isEmptyDocumentStyleMeta(styleMeta)
    if (hasStyleMeta || documentSnapshots.length > 0) {
      projectFile.meta = {
        ...(styleMeta ?? { swatches: [], stylePresets: [] }),
        ...(documentSnapshots.length > 0 ? { snapshots: documentSnapshots } : {})
      }
    }

    // 对齐参考线挂工程顶层 guides 字段，为空时省略保持旧文件结构不变。
    const guides = getDocumentGuides?.() as unknown[] | undefined
    if (guides && guides.length > 0) projectFile.guides = guides as IconCreatorProjectFile['guides']

    // 符号定义挂工程顶层 symbols 字段，为空时省略保持旧文件结构不变（见 symbols.ts 说明）。
    const symbols = getDocumentSymbols?.() as unknown[] | undefined
    if (symbols && symbols.length > 0) projectFile.symbols = symbols as IconCreatorProjectFile['symbols']

    if (artboards.value.length > 0) {
      if (activeArtboardId.value) {
        const currentIndex = artboards.value.findIndex((artboard) => artboard.id === activeArtboardId.value)
        if (currentIndex >= 0) {
          artboards.value[currentIndex] = captureCurrentArtboard()
        }
      }
      projectFile.artboards = artboards.value.map((artboard) => ({ ...artboard }))
      projectFile.activeArtboardId = activeArtboardId.value
    }

    return projectFile
  }

  /**
   * 捕获当前文档历史栈的可序列化副本，供项目标签切换时隔离每个项目的撤销 / 重做记录。
   */
  function captureHistoryState(): HistoryState {
    return {
      undoStack: undoStack.map((item) => ({ ...item })),
      redoStack: redoStack.map((item) => ({ ...item })),
      historyIndex: historyIndex.value
    }
  }

  /**
   * 恢复指定项目标签保存的历史状态，并同步撤销 / 重做按钮可用性。
   */
  function restoreHistoryState(state: HistoryState) {
    undoStack.length = 0
    redoStack.length = 0
    undoStack.push(...state.undoStack.map((item) => ({ ...item })))
    redoStack.push(...state.redoStack.map((item) => ({ ...item })))
    historyIndex.value = Math.min(Math.max(0, state.historyIndex), Math.max(0, undoStack.length - 1))
    canUndo.value = undoStack.length > 1
    canRedo.value = redoStack.length > 0
  }

  function resetHistoryToCurrentCanvas() {
    undoStack.length = 0
    redoStack.length = 0
    canUndo.value = false
    canRedo.value = false
    snapshot({ autoSave: false })
  }

  async function restoreSingleProjectCanvas(project: IconCreatorProjectFile) {
    const fabricCanvas = getFabricCanvas()
    if (!fabricCanvas) return

    clearBooleanPreview()
    clearPointEditing()
    const settings = normalizeProjectCanvasSettings(project.canvas)
    canvasWidth.value = settings.width
    canvasHeight.value = settings.height
    canvasBg.value = settings.background
    pixelGridSize.value = normalizePixelGridSize(settings.gridSize)
    showPixelGrid.value = settings.showPixelGrid === true
    snapToPixelGrid.value = settings.snapToPixelGrid === true
    pixelPaintBrushSize.value = normalizePixelPaintBrushSize(settings.brushSize)
    keylineTemplate.value = normalizeKeylineTemplate(settings.keylineTemplate)
    keylineMargin.value = normalizeKeylineMargin(settings.keylineMargin)
    keylineOpacity.value = normalizeKeylineOpacity(settings.keylineOpacity)
    syncPixelGridSizeInput()
    syncPixelPaintBrushSizeInput()
    syncKeylineMarginInput()
    syncCanvasInteractionMode()
    if (!isTransparentCanvasBg(settings.background)) lastOpaqueCanvasBg.value = settings.background
    syncCanvasSizeInputs()

    snapshotGate.set(true)
    try {
      fabricCanvas.clear()
      fabricCanvas.setDimensions({ width: canvasWidth.value, height: canvasHeight.value })
      await fabricCanvas.loadFromJSON(project.fabric)
      applyCanvasBgToFabric(canvasBg.value)
      await syncAllKaleidoscopes()
      ensureCanvasObjectMetadata()
      applyProjectLayerOrder(project.layerOrder)
      rehydrateCanvasGradientFills()
      syncAllEndpointAttachments()
      applyCanvasTheme()
      syncCanvasInteractionMode()
      fabricCanvas.discardActiveObject()
      syncActiveObject(null)
      fabricCanvas.requestRenderAll()
      refreshLayers()
      fitCanvasInView()
      markSmallPreviewsDirty()
    } finally {
      snapshotGate.set(false)
    }
  }

  async function loadProjectFile(project: IconCreatorProjectFile, options: { keepDraft?: boolean; resetHistory?: boolean } = {}) {
    const fabricCanvas = getFabricCanvas()
    if (!fabricCanvas) return

    // 工程自带文档级样式元数据（色板/预设）时先写入运行时状态，旧工程无该字段则归一化为空。
    applyDocumentStyleMeta?.(normalizeDocumentStyleMeta((project as { meta?: unknown }).meta))
    // 命名画布快照随工程 meta 一并恢复；传空值时清空运行时快照列表。
    applyDocumentSnapshots?.(
      (project as { meta?: { snapshots?: unknown } | undefined }).meta?.snapshots ?? []
    )
    // 对齐参考线随工程 guides 字段恢复；旧工程无该字段时归一化为空列表。
    applyDocumentGuides?.((project as { guides?: unknown }).guides)
    // 符号定义随工程 symbols 字段恢复；旧工程无该字段时归一化为空列表。
    applyDocumentSymbols?.((project as { symbols?: unknown }).symbols)

    if (project.artboards && project.artboards.length > 0) {
      artboards.value = project.artboards.map((artboard) => ({ ...artboard }))
      activeArtboardId.value = project.activeArtboardId || artboards.value[0].id
      showArtboardList.value = true

      const activeArtboard = artboards.value.find((artboard) => artboard.id === activeArtboardId.value) || artboards.value[0]
      await loadArtboardContent(activeArtboard)
    } else {
      artboards.value = []
      activeArtboardId.value = ''
      showArtboardList.value = false
      await restoreSingleProjectCanvas(project)
    }

    if (options.resetHistory !== false) resetHistoryToCurrentCanvas()
    if (!options.keepDraft) clearStoredDraft()
  }

  function scheduleDraftSave() {
    if (!getFabricCanvas() || typeof window === 'undefined') return
    draftDirty = true
    if (draftSaveTimer != null) window.clearTimeout(draftSaveTimer)
    draftSaveTimer = window.setTimeout(() => {
      draftSaveTimer = null
      saveDraftNow()
    }, DRAFT_SAVE_DELAY)
  }

  /**
   * 草稿写入失败（含配额超限）的统一出口：只记录警告并节流 toast 提示，
   * 绝不向编辑主流程抛错，保证草稿通道异常不影响画布交互。
   */
  function warnDraftSaveFailure(error: unknown) {
    console.warn('保存自动草稿失败', error)
    const now = Date.now()
    if (now - lastDraftQuotaToastAt < DRAFT_QUOTA_TOAST_THROTTLE) return
    lastDraftQuotaToastAt = now
    try {
      showToast('草稿保存失败：浏览器存储空间不足', 'warning')
    } catch {
      // toast 通道异常时忽略，失败提示本身也不允许影响编辑主流程
    }
  }

  /**
   * 把草稿信封按降级链逐级尝试写入 localStorage：全量 → 去命名快照 → 去画板缩略图 → 去次要元数据。
   * 写入方式保持现状的「同步 JSON.stringify + setItem」：单文件草稿通常在数百 KB 量级，
   * 序列化耗时可接受；改为 requestIdleCallback 分片会引入跨帧状态一致性复杂度，收益有限。
   * 任一级成功即结束；全部失败返回 false，由调用方节流提示。
   */
  function writeDraftWithDegradation(envelope: IconCreatorDraftFile | ProjectDraftFile): boolean {
    const candidates = 'tabs' in envelope
      ? buildDraftWriteCandidates(envelope)
      : buildLegacyDraftWriteCandidates(envelope)
    for (let index = 0; index < candidates.length; index += 1) {
      try {
        window.localStorage.setItem(DRAFT_STORAGE_KEY, JSON.stringify(candidates[index]))
        if (index > 0) console.warn(`自动草稿已降级保存（裁剪等级 ${index}）`)
        return true
      } catch {
        // 本级写入失败（多为配额超限），继续尝试下一级降级
      }
    }
    return false
  }

  function saveDraftNow() {
    if (!getFabricCanvas() || typeof window === 'undefined') return
    try {
      const updatedAt = new Date().toISOString()
      const currentProject = createProjectFile()
      const tabsSnapshot = getDraftTabsSnapshot?.(currentProject) ?? null
      // 页面层提供多标签通道时一律按多标签结构写入（覆盖标签列表 / 顺序 / 激活态与每标签工程）；
      // 返回 null 表示标签未就绪（启动早期 / 切换中），跳过本次写入避免用过场状态覆盖已有草稿。
      if (getDraftTabsSnapshot) {
        if (!tabsSnapshot) return
        const draft = encodeProjectDraft({
          activeTabId: tabsSnapshot.activeTabId,
          tabs: tabsSnapshot.tabs,
          updatedAt
        })
        if (writeDraftWithDegradation(draft)) {
          draftDirty = false
        } else {
          warnDraftSaveFailure(new Error('localStorage 配额超限，草稿降级链全部失败'))
        }
        return
      }
      // 无多标签通道的宿主退化为旧版单标签结构。
      const draft: IconCreatorDraftFile = {
        app: 'icon-creator',
        schemaVersion: PROJECT_SCHEMA_VERSION,
        updatedAt,
        project: currentProject
      }
      if (writeDraftWithDegradation(draft)) {
        draftDirty = false
      } else {
        warnDraftSaveFailure(new Error('localStorage 配额超限，草稿降级链全部失败'))
      }
    } catch (error) {
      // createProjectFile / 序列化异常同样不允许打断编辑主流程
      warnDraftSaveFailure(error)
    }
  }

  function clearStoredDraft() {
    if (draftSaveTimer != null) {
      window.clearTimeout(draftSaveTimer)
      draftSaveTimer = null
    }
    draftDirty = false
    try {
      window.localStorage.removeItem(DRAFT_STORAGE_KEY)
    } catch (error) {
      console.warn('清理自动草稿失败', error)
    }
  }

  function flushDraftBeforeDispose() {
    if (draftSaveTimer != null) {
      window.clearTimeout(draftSaveTimer)
      draftSaveTimer = null
    }
    if (draftDirty) saveDraftNow()
  }

  // 读取并解码草稿：兼容旧版单标签结构与新版多标签结构，脏数据按无草稿处理并清理存储。
  function readStoredDraft(): DecodedProjectDraft | null {
    try {
      const raw = window.localStorage.getItem(DRAFT_STORAGE_KEY)
      if (!raw) return null
      const decoded = decodeProjectDraft(JSON.parse(raw))
      if (!decoded) {
        // 结构无法识别的脏数据直接清理，避免每次启动重复解析失败
        clearStoredDraft()
        return null
      }
      return decoded
    } catch (error) {
      console.warn('读取自动草稿失败', error)
      clearStoredDraft()
      return null
    }
  }

  // 打开草稿恢复确认弹窗（替代原生 window.confirm）：读到草稿就暂存并弹窗，实际恢复延迟到用户确认。
  async function promptRestoreDraft() {
    if (restoringDraftPromptShown) return
    restoringDraftPromptShown = true
    const draft = readStoredDraft()
    if (!draft) return
    pendingRestoreDraft = draft
    draftRestoreDialog.value = { show: true, tabCount: draft.tabs.length }
  }

  // 关闭弹窗并丢弃暂存草稿；show 为 true（编程式打开）时不做清理。
  function handleDraftRestoreDialogShowChange(show: boolean) {
    if (show) return
    draftRestoreDialog.value = { show: false, tabCount: 0 }
    pendingRestoreDraft = null
    // 与原 window.confirm 取消路径一致：放弃恢复的同时清掉存储的草稿。
    clearStoredDraft()
  }

  // 确认恢复草稿：多标签通道可用时恢复全部项目标签与激活态，否则退化为仅恢复第一个标签。
  async function confirmDraftRestore() {
    const draft = pendingRestoreDraft
    if (!draft) {
      draftRestoreDialog.value = { show: false, tabCount: 0 }
      return
    }
    pendingRestoreDraft = null
    draftRestoreDialog.value = { show: false, tabCount: 0 }
    if (applyDraftTabs) {
      await applyDraftTabs(draft)
    } else {
      await loadProjectFile(draft.tabs[0].project, { keepDraft: true })
    }
    // 恢复完成后立即写回草稿，保证崩溃恢复链路里激活态与标签结构是最新的。
    saveDraftNow()
  }

  async function restoreHistorySnapshot(json: string) {
    const fabricCanvas = getFabricCanvas()
    if (!fabricCanvas) return

    snapshotGate.set(true)
    try {
      await fabricCanvas.loadFromJSON(json)
      // 快照 JSON 内嵌的文档级样式元数据（色板/预设）随历史一并还原。
      restoreDocumentStyleMetaFromSnapshot?.(json)
      // 对齐参考线同样随撤销快照还原，撤销 / 重做可以回滚参考线的增删改。
      restoreDocumentGuidesFromSnapshot?.(json)
      // 符号定义随撤销快照还原；实例外观由画布 JSON 保持（恢复后不自动按定义重建，见 symbols.ts）。
      restoreDocumentSymbolsFromSnapshot?.(json)
      await syncAllKaleidoscopes()
      ensureCanvasObjectMetadata()
      rehydrateCanvasGradientFills()
      syncAllEndpointAttachments()
      fabricCanvas.discardActiveObject()
      syncActiveObject(null)
      syncCanvasBgFromFabric()
      fabricCanvas.requestRenderAll()
      refreshLayers()
      markSmallPreviewsDirty()
    } finally {
      snapshotGate.set(false)
    }
  }

  function undo() {
    if (undoStack.length <= 1 || !getFabricCanvas()) return
    clearPointEditing()
    redoStack.push(undoStack.pop()!)
    canRedo.value = true
    historyIndex.value = undoStack.length - 1
    void restoreHistorySnapshot(undoStack[undoStack.length - 1].json).then(() => {
      canUndo.value = undoStack.length > 1
    })
  }

  function redo() {
    if (!redoStack.length || !getFabricCanvas()) return
    clearPointEditing()
    const historySnapshot = redoStack.pop()!
    undoStack.push(historySnapshot)
    historyIndex.value = undoStack.length - 1
    void restoreHistorySnapshot(historySnapshot.json).then(() => {
      canUndo.value = undoStack.length > 1
      canRedo.value = redoStack.length > 0
    })
  }

  function jumpToHistory(index: number) {
    if (!getFabricCanvas() || index < 0 || index >= undoStack.length) return
    if (index === historyIndex.value) return

    clearPointEditing()

    if (index < historyIndex.value) {
      while (historyIndex.value > index) {
        redoStack.push(undoStack.pop()!)
        historyIndex.value--
      }
    } else {
      while (historyIndex.value < index && redoStack.length > 0) {
        undoStack.push(redoStack.pop()!)
        historyIndex.value++
      }
    }

    void restoreHistorySnapshot(undoStack[undoStack.length - 1].json).then(() => {
      canUndo.value = undoStack.length > 1
      canRedo.value = redoStack.length > 0
    })
  }

  function saveProject() {
    if (!getFabricCanvas()) return
    clearBooleanPreview()
    try {
      const filePath = window.services?.writeTextFile?.(stringifyProjectFile(createProjectFile()), PROJECT_FILE_EXTENSION)
      clearStoredDraft()
      if (filePath) showToast(`工程已保存：${filePath}`, 'success')
    } catch (error) {
      showToast(error instanceof Error ? error.message : '保存工程失败', 'error')
    }
  }

  /**
   * 弹出系统保存对话框选择存储位置与文件名，成功后返回最终路径；用户取消返回空字符串。
   * 首次保存用它收集路径，之后 saveProject 直接覆盖同一文件。
   */
  function pickProjectSavePath(): string {
    const ztools = typeof window !== 'undefined' ? window.ztools : undefined
    const downloads = ztools?.getPath?.('downloads')
    const result = ztools?.showSaveDialog?.({
      title: '保存工程',
      defaultPath: downloads ? `${downloads}/未命名工程.${PROJECT_FILE_EXTENSION}` : `未命名工程.${PROJECT_FILE_EXTENSION}`,
      buttonLabel: '保存',
      nameFieldLabel: '工程名称',
      filters: [{ name: 'Icon Creator 工程文件', extensions: [PROJECT_FILE_EXTENSION] }],
      properties: ['showOverwriteConfirmation', 'createDirectory']
    })
    return typeof result === 'string' ? result : ''
  }

  /**
   * 将当前工程直接写入指定绝对路径并清除自动草稿，覆盖式保存不再次弹框。
   * 同时把更新时间刷新到当前，保证覆盖后的文件元信息与最后一次保存一致。
   */
  function saveProjectToPath(filePath: string): string | undefined {
    if (!getFabricCanvas()) return undefined
    clearBooleanPreview()
    const write = window.services?.writeTextFileToPath
    if (!write) {
      showToast('当前环境不支持覆盖保存，请使用另存为', 'error')
      return undefined
    }
    try {
      write(stringifyProjectFile(createProjectFile()), filePath)
      clearStoredDraft()
      showToast(`工程已保存：${filePath}`, 'success')
      return filePath
    } catch (error) {
      showToast(error instanceof Error ? error.message : '保存工程失败', 'error')
      return undefined
    }
  }

  /**
   * 另存为：每次都弹出系统保存对话框，并把新路径回传回调用于更新项目标签记忆。
   * 不会直接覆盖项目标签记忆，由调用方决定是否更新已保存路径。
   */
  function saveProjectAs(onSaved?: (filePath: string) => void) {
    const filePath = pickProjectSavePath()
    if (!filePath) return
    const savedPath = saveProjectToPath(filePath)
    if (savedPath) onSaved?.(savedPath)
  }

  return {
    undoStack,
    historyIndex,
    canUndo,
    canRedo,
    draftRestoreDialog,
    snapshot,
    createProjectFile,
    captureHistoryState,
    restoreHistoryState,
    resetHistoryToCurrentCanvas,
    loadProjectFile,
    scheduleDraftSave,
    saveDraftNow,
    clearStoredDraft,
    promptRestoreDraft,
    confirmDraftRestore,
    handleDraftRestoreDialogShowChange,
    flushDraftBeforeDispose,
    saveProject,
    saveProjectAs,
    saveProjectToPath,
    undo,
    redo,
    jumpToHistory
  }
}
