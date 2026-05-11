import { TOOL_MAP } from './config/tools.js'
import { getAppShellMode, renderAppShell, renderShellOverlays, renderShellSideNav, renderShellTopBar, renderShellWorkspace } from './components/AppShell.js'
import { buildQueueClassName, buildQueueItemClassName, getQueueItemRenderSignatures, getQueueLayoutFlags, getQueueViewportRenderSignature, renderImageQueue, renderQueueItemFragments, renderQueueItemsMarkup, shouldVirtualizeQueue } from './components/ImageQueueList.js'
import { renderToolPage } from './pages/index.js'
import {
  applyManualCropSnap,
  clampManualCropArea,
  getInheritedManualCropArea,
  getManualCropArea,
  getManualCropDisplaySize,
  getManualCropGlobalTransformPatch,
  getManualCropSelection,
  getManualCropSnapThreshold,
  getManualCropStageMetrics,
  mergeManualCropAreaPatch,
  moveManualCropArea,
  resizeManualCropArea,
} from './lib/manual-crop-helpers.js'
import {
  beginManualCropDrag,
  beginManualCropPan,
  endManualCropDrag,
  endManualCropPan,
  handleManualCropAction,
  handleManualCropDrag,
  handleManualCropKeydown,
  handleManualCropKeyup,
  handleManualCropPan,
  handleManualCropWheel,
  hasManualCropDrag,
  hasManualCropPan,
} from './lib/manual-crop-controller.js'
import {
  advanceManualCropAfterSuccess as advanceManualCropAfterSuccessFlow,
  ensureManualCropSessionOutputPath as ensureManualCropSessionOutputPathFlow,
  getAssetsForTool as getAssetsForToolFlow,
} from './lib/manual-crop-flow.js'
import { updateManualCropSummaryResultView } from './lib/manual-crop-results.js'
import { createManualCropRuntime } from './lib/manual-crop-runtime.js'
import { getFormatCapability } from './services/ztools-bridge.js'
import { appendAssets, applyRunResult, batchStateUpdates, dismissNotification, getAssetById, getAssetIndexById, getState, moveAsset, moveAssetToTarget, pushNotification, removeAsset, replaceConfig, setActiveTool, setConfirmDialog, setPresetDialog, setPreviewModal, setResultView, setSearchQuery, setSettingsDialog, setState, setToolPresets, subscribe, updateAssetListThumbnail, updateConfig, updateSettings } from './state/store.js'
import { cancelRun, checkStagedFiles, cleanupPreviewCache, clearPreviewCacheDirectory, createAssetDisplayUrl, deletePreset, getLaunchInputs, importItems, loadPresets, loadSettings, materializePreviewResults, openInputDialog, prepareRunPayload, regenerateQueueThumbnails, renamePreset, resolveInputPaths, revealPath, replaceOriginals, runTool, saveAllStagedResults, savePreset, saveSettings, saveStagedResult, showMainWindow, stageToolPreview, subscribeLaunchInputs, subscribeQueueThumbnails } from './services/ztools-bridge.js'

const PREVIEW_SAVE_TOOLS = new Set(['compression', 'format', 'resize', 'watermark', 'corners', 'padding', 'crop', 'rotate', 'flip'])
const PREVIEWABLE_TOOLS = new Set(['compression', 'format', 'resize', 'watermark', 'corners', 'padding', 'crop', 'rotate', 'flip'])
const MERGE_PREVIEW_TOOLS = new Set(['merge-pdf', 'merge-image', 'merge-gif'])
const RESHAPED_PREVIEW_TOOLS = new Set(['resize', 'rotate', 'crop', 'padding', 'flip', 'manual-crop'])
const MANUAL_CROP_RATIO_ORDER = [
  { label: '1:1', value: '1:1' },
  { label: '4:5', value: '4:5' },
  { label: '16:9', value: '16:9' },
  { label: '9:16', value: '9:16' },
  { label: '4:3', value: '4:3' },
  { label: '3:2', value: '3:2' },
  { label: '3:4', value: '3:4' },
  { label: '2:3', value: '2:3' },
  { label: '21:9', value: '21:9' },
]
const SETTINGS_TOOL_ID = 'settings'
const PREVIEW_CACHE_LIMIT = 12
const WATERMARK_POSITION_LABELS = {
  'top-left': '左上',
  'top-center': '上方居中',
  'top-right': '右上',
  'middle-left': '左侧居中',
  center: '正中',
  'middle-right': '右侧居中',
  'bottom-left': '左下',
  'bottom-center': '下方居中',
  'bottom-right': '右下',
}

const app = document.getElementById('app')
const fileInput = createFileInput({ directory: false })
const folderInput = createFileInput({ directory: true })
const watermarkFileInput = createFileInput({ directory: false })
watermarkFileInput.multiple = false

const DRAG_CONTEXT = {
  rotateDial: null,
  previewCompare: null,
  previewPan: null,
  queueSort: null,
}
let activeQueueSortDragItem = null
let activeQueueSortBeforeItem = null
let activeQueueSortAfterItem = null
let resultMarqueeFrame = 0
let activeTooltipTarget = null
let tooltipElement = null
let postRenderFrame = 0
let pendingPostRenderWork = null
let resultToolbarSignature = ''
let processingProgressFrame = 0
let pendingProcessingProgress = undefined
let lastRenderSnapshot = null
let queueRenderFrame = 0
let queueItemPatchFrame = 0
let rotateDialFrame = 0
let detachedQueueContent = null
let detachedQueueState = null
let queueThumbnailPatchFrame = 0
let pendingQueueScrollRestore = null
let queueMarkupCacheDirty = false
let lastQueueViewportRenderSignature = ''
let pendingAdjacentQueueMove = null
const previewCacheQueue = []
const pendingQueueThumbnailPatches = new Map()
const LAUNCH_INPUT_RETRY_INTERVAL_MS = 1200
const LAUNCH_INPUT_RETRY_WINDOW_MS = 12000
const LAUNCH_INPUT_POST_IMPORT_RETRY_WINDOW_MS = 12000
const rootMarkupCache = {
  sideNav: '',
  topbar: '',
  workspace: '',
  panel: '',
  queue: '',
  overlays: '',
  notifications: '',
}
const queueViewportState = {
  scrollTop: 0,
  height: 0,
}

function getQueueScrollNode(root = app) {
  return root?.querySelector?.('.queue-list') || null
}

function shouldTrackQueueViewport(state) {
  return getAppShellMode(state) === 'workspace'
    && TOOL_MAP[state.activeTool]?.mode !== 'sort'
    && shouldVirtualizeQueue(state.assets.length)
}

const {
  flushManualCropConfigUpdates,
  queueManualCropConfigUpdate,
  queueManualCropStageSync,
  syncManualCropStageViewport,
} = createManualCropRuntime({ getState, updateConfig })

let observedCleanupToolId = getState().activeTool
let observedSettingsVisible = Boolean(getState().settingsDialog?.visible)
let launchInputRetryTimer = null
let launchInputRetryDeadline = 0
let launchInputRetryInFlight = false
let launchInputRetryStartedAt = 0

function isPreviewCacheStatus(status, includeSaved = false) {
  return status === 'previewed'
    || status === 'stale'
    || status === 'staged'
    || (includeSaved && status === 'saved')
}

function collectPreviewCacheAssetIds(options = {}) {
  const includeSaved = Boolean(options?.includeSaved)
  const assetIds = []
  const seen = new Set()
  for (let index = 0; index < previewCacheQueue.length; index += 1) {
    const assetId = String(previewCacheQueue[index]?.assetId || '')
    if (!assetId || seen.has(assetId)) continue
    seen.add(assetId)
    assetIds.push(assetId)
  }
  const state = getState()
  for (let index = 0; index < state.assets.length; index += 1) {
    const asset = state.assets[index]
    const assetId = String(asset?.id || '')
    if (!assetId || seen.has(assetId) || !isPreviewCacheStatus(asset?.previewStatus, includeSaved)) continue
    seen.add(assetId)
    assetIds.push(assetId)
  }
  return assetIds
}

function handleCleanupStateTransitions(state) {
  const nextToolId = state?.activeTool || ''
  const nextSettingsVisible = Boolean(state?.settingsDialog?.visible)
  if (observedCleanupToolId && observedCleanupToolId !== nextToolId) {
    cleanupToolPreviewCache(observedCleanupToolId, `state-transition:tool-change:${observedCleanupToolId}->${nextToolId}`)
  }
  if (!observedSettingsVisible && nextSettingsVisible) {
    cleanupToolPreviewCache(nextToolId, `state-transition:open-settings:${nextToolId}`)
  }
  observedCleanupToolId = nextToolId
  observedSettingsVisible = nextSettingsVisible
}

document.body.append(fileInput, folderInput, watermarkFileInput)
subscribe((state) => {
  handleCleanupStateTransitions(state)
  render(state)
})
render(getState())
attachProcessingProgressEvents()
attachGlobalEvents()
bootstrapSettings().finally(() => {
  bootstrapLaunchInputs().finally(() => {
    attachLaunchSubscription()
  })
})
attachQueueThumbnailSubscription()

async function bootstrapSettings() {
  try {
    const settings = await loadSettings()
    updateSettings(settings)
    void applyDefaultPresetForTool(getState().activeTool, true)
  } catch {
    // ignore settings bootstrap errors
  }
}

function getDefaultPresetMap() {
  return getState().settings.defaultPresetByTool || {}
}

function createSettingsDialogState() {
  const settings = getState().settings
  return {
    visible: true,
    saveLocationMode: settings.saveLocationMode || 'source',
    saveLocationCustomPath: settings.saveLocationCustomPath || settings.defaultSavePath || '',
    performanceMode: settings.performanceMode || 'balanced',
    queueThumbnailSize: settings.queueThumbnailSize || '128',
    settingsSelectOpen: false,
    performanceSelectOpen: false,
  }
}

function closeSettingsDialog() {
  setSettingsDialog(null)
}

function updateSettingsDialog(patch) {
  const current = getState().settingsDialog
  if (!current) return
  const entries = Object.entries(patch || {})
  if (!entries.length) return
  const next = { ...current }
  let changed = false
  for (const [key, value] of entries) {
    if (next[key] !== value) {
      next[key] = value
      changed = true
    }
  }
  if (!changed) return
  setSettingsDialog(next)
}

function normalizeLoadedPresets(presets = []) {
  return (Array.isArray(presets) ? presets : []).map((preset, index) => ({
    id: String(preset?.id || `preset-${index + 1}`),
    name: String(preset?.name || `预设 ${index + 1}`),
    config: preset?.config && typeof preset.config === 'object' ? preset.config : preset || {},
    createdAt: preset?.createdAt || '',
  }))
}

async function ensureToolPresetsLoaded(toolId, force = false, options = {}) {
  const cached = getState().presetsByTool?.[toolId]
  if (!force && Array.isArray(cached)) return cached
  const presets = normalizeLoadedPresets(await loadPresets(toolId))
  setToolPresets(toolId, presets, options.emitChange !== false)
  return presets
}

function closePresetDialog() {
  setPresetDialog(null)
}

function openConfirmDialog(dialog) {
  setConfirmDialog({ visible: true, ...dialog })
}

function closeConfirmDialog() {
  setConfirmDialog(null)
}

function updatePresetDialog(patch) {
  const current = getState().presetDialog
  if (!current) return
  const entries = Object.entries(patch || {})
  if (!entries.length) return
  const next = { ...current }
  let changed = false
  for (const [key, value] of entries) {
    if (next[key] !== value) {
      next[key] = value
      changed = true
    }
  }
  if (!changed) return
  setPresetDialog(next)
}

function normalizeMeasureToggleValue(value, nextUnit) {
  const raw = String(value ?? '').trim()
  if (!raw) return nextUnit === '%' ? '%' : 'px'
  const numeric = raw.replace(/(px|%)$/i, '').trim()
  if (!numeric) return nextUnit === '%' ? '%' : 'px'
  return nextUnit === '%' ? `${numeric}%` : `${numeric}px`
}

function isSameConfigShape(left, right) {
  if (left === right) return true
  if (!left || !right || typeof left !== 'object' || typeof right !== 'object') return false
  const leftKeys = Object.keys(left)
  const rightKeys = Object.keys(right)
  if (leftKeys.length !== rightKeys.length) return false
  for (const key of leftKeys) {
    if (left[key] !== right[key]) return false
  }
  return true
}

async function applyDefaultPresetForTool(toolId, silent = false) {
  const defaultPresetId = getDefaultPresetMap()?.[toolId]
  if (!defaultPresetId) return false
  const presets = await ensureToolPresetsLoaded(toolId, false, { emitChange: !silent })
  const preset = presets.find((item) => item.id === defaultPresetId)
  if (!preset?.config) return false
  if (isSameConfigShape(getState().configs?.[toolId], preset.config)) return false
  replaceConfig(toolId, preset.config)
  if (!silent) notify({ type: 'success', message: `已应用默认预设：${preset.name}` })
  return true
}

async function saveSettingsFromDialog() {
  const dialog = getState().settingsDialog
  if (!dialog) return
  if (dialog.saveLocationMode === 'custom' && !String(dialog.saveLocationCustomPath || '').trim()) {
    notify({ type: 'info', message: '请先选择自定义保存目录。' })
    return
  }
  const previousQueueThumbnailSize = getState().settings.queueThumbnailSize || '128'
  const payload = {
    saveLocationMode: dialog.saveLocationMode || 'source',
    saveLocationCustomPath: dialog.saveLocationCustomPath || '',
    performanceMode: dialog.performanceMode || 'balanced',
    queueThumbnailSize: dialog.queueThumbnailSize || '128',
  }
  const settings = await saveSettings(payload)
  updateSettings(settings)
  if ((settings.queueThumbnailSize || '128') !== previousQueueThumbnailSize) {
    void regenerateQueueThumbnails(getState().assets)
  }
  closeSettingsDialog()
  notify({ type: 'success', message: '已保存默认图片保存位置与性能模式。' })
}

async function clearAllPreviewCacheDirectoryFromSettings() {
  const assetIds = collectPreviewCacheAssetIds({ includeSaved: true })
  clearPreviewCacheDirectory({ reason: 'settings-clear-preview-cache-directory' })
  if (assetIds.length) clearPreviewCacheState(assetIds)
  notify({ type: 'success', message: '已清空 Imgbatch Preview 缓存目录。' })
}

async function chooseSettingsCustomPath() {
  const selected = await openInputDialog({
    title: '选择默认保存目录',
    properties: ['openDirectory'],
  })
  const paths = Array.isArray(selected?.filePaths) ? selected.filePaths : Array.isArray(selected) ? selected : []
  if (!paths.length) return
  updateSettingsDialog({ saveLocationMode: 'custom', saveLocationCustomPath: String(paths[0] || '') })
}

async function openApplyPresetDialog(toolId) {
  const presets = await ensureToolPresetsLoaded(toolId)
  setPresetDialog({
    visible: true,
    mode: 'apply',
    toolId,
    name: '',
    selectedPresetId: presets[0]?.id || '',
    setAsDefault: false,
  })
}

function openSavePresetDialog(toolId) {
  setPresetDialog({
    visible: true,
    mode: 'save',
    toolId,
    name: '',
    selectedPresetId: '',
    setAsDefault: false,
  })
}

function openRenamePresetDialog(toolId, preset) {
  setPresetDialog({
    visible: true,
    mode: 'rename',
    toolId,
    name: preset?.name || '',
    selectedPresetId: preset?.id || '',
    setAsDefault: false,
  })
}

async function confirmSavePresetDialog() {
  const dialog = getState().presetDialog
  if (!dialog?.toolId) return
  const liveName = document.querySelector('[data-action="change-preset-name"]')?.value
  const name = String(liveName ?? dialog.name ?? '').trim()
  if (!name) {
    notify({ type: 'info', message: '请先输入预设名称。' })
    return
  }
  const presets = normalizeLoadedPresets(await savePreset(dialog.toolId, {
    name,
    config: getState().configs[dialog.toolId],
  }))
  setToolPresets(dialog.toolId, presets)
  const savedPreset = presets[presets.length - 1]
  if (dialog.setAsDefault && savedPreset?.id) {
    const settings = await saveSettings({
      defaultPresetByTool: {
        ...getDefaultPresetMap(),
        [dialog.toolId]: savedPreset.id,
      },
    })
    updateSettings(settings)
  }
  setPresetDialog({
    visible: true,
    mode: 'apply',
    toolId: dialog.toolId,
    name: '',
    selectedPresetId: dialog.selectedPresetId,
    setAsDefault: false,
  })
  notify({ type: 'success', message: `已保存预设：${name}` })
}

async function confirmRenamePresetDialog() {
  const dialog = getState().presetDialog
  if (!dialog?.toolId || !dialog.selectedPresetId) return
  const liveName = document.querySelector('[data-action="change-preset-name"]')?.value
  const name = String(liveName ?? dialog.name ?? '').trim()
  if (!name) {
    notify({ type: 'info', message: '请先输入预设名称。' })
    return
  }
  const presets = normalizeLoadedPresets(await renamePreset(dialog.toolId, dialog.selectedPresetId, name))
  setToolPresets(dialog.toolId, presets)
  if (dialog.setAsDefault) {
    const settings = await saveSettings({
      defaultPresetByTool: {
        ...getDefaultPresetMap(),
        [dialog.toolId]: dialog.selectedPresetId,
      },
    })
    updateSettings(settings)
  }
  setPresetDialog({
    visible: true,
    mode: 'apply',
    toolId: dialog.toolId,
    name: '',
    selectedPresetId: dialog.selectedPresetId,
    setAsDefault: false,
  })
  notify({ type: 'success', message: `已重命名预设：${name}` })
}

async function confirmApplyPresetDialog() {
  const dialog = getState().presetDialog
  if (!dialog?.toolId || !dialog.selectedPresetId) return
  const presets = await ensureToolPresetsLoaded(dialog.toolId)
  const preset = presets.find((item) => item.id === dialog.selectedPresetId)
  if (!preset?.config) {
    notify({ type: 'error', message: '未找到要应用的预设。' })
    return
  }
  replaceConfig(dialog.toolId, preset.config)
  if (dialog.setAsDefault) {
    const settings = await saveSettings({
      defaultPresetByTool: {
        ...getDefaultPresetMap(),
        [dialog.toolId]: preset.id,
      },
    })
    updateSettings(settings)
  }
  closePresetDialog()
  notify({ type: 'success', message: `已应用预设：${preset.name}` })
}

async function removeSelectedPreset() {
  const dialog = getState().presetDialog
  if (!dialog?.toolId || !dialog.selectedPresetId) return
  const presets = getState().presetsByTool?.[dialog.toolId] || []
  const preset = presets.find((item) => item.id === dialog.selectedPresetId)
  if (!preset) return
  const next = normalizeLoadedPresets(await deletePreset(dialog.toolId, dialog.selectedPresetId))
  setToolPresets(dialog.toolId, next)
  const defaultPresetByTool = { ...getDefaultPresetMap() }
  if (defaultPresetByTool[dialog.toolId] === dialog.selectedPresetId) {
    delete defaultPresetByTool[dialog.toolId]
    const settings = await saveSettings({ defaultPresetByTool })
    updateSettings(settings)
  }
  updatePresetDialog({ selectedPresetId: next[0]?.id || '' })
  notify({ type: 'success', message: `已删除预设：${preset.name}` })
}

function confirmDeleteSelectedPreset() {
  const dialog = getState().presetDialog
  if (!dialog?.toolId || !dialog.selectedPresetId) return
  const presets = getState().presetsByTool?.[dialog.toolId] || []
  const preset = presets.find((item) => item.id === dialog.selectedPresetId)
  if (!preset) return
  openConfirmDialog({
    title: '删除预设',
    subtitle: TOOL_MAP[dialog.toolId]?.label || dialog.toolId,
    message: `确认删除预设“${preset.name}”吗？删除后不可恢复。`,
    confirmLabel: '删除',
    confirmAction: 'confirm-delete-selected-preset',
  })
}

function confirmReplaceAssetOriginal(assetId) {
  const entry = getReplaceEntry(assetId)
  if (!entry) {
    notify({ type: 'info', message: '当前图片还没有可替换回原图的处理结果。' })
    return
  }
  const asset = getAssetById(assetId)
  if (!asset) return
  openConfirmDialog({
    title: '替换原图',
    subtitle: asset.name,
    message: '确认用处理结果覆盖原图吗？此操作不可撤销。',
    confirmLabel: '确认替换',
    confirmAction: 'confirm-replace-asset-original',
    assetId,
  })
}

function confirmReplaceCurrentOriginals() {
  const entries = getReplaceEntries()
  if (!entries.length) {
    notify({ type: 'info', message: '当前没有可替换的处理结果。' })
    return
  }
  openConfirmDialog({
    title: '批量替换原图',
    subtitle: `共 ${entries.length} 张`,
    message: `确认用处理结果覆盖 ${entries.length} 张原图吗？此操作不可撤销。`,
    confirmLabel: '确认替换',
    confirmAction: 'confirm-replace-current-originals',
  })
}

function isPreviewableTool(toolId) {
  return PREVIEWABLE_TOOLS.has(toolId)
}

function getCurrentStagedItems(activeTool, assets) {
  if (!activeTool || !assets?.length) return []
  const stagedItems = []
  for (const asset of assets) {
    if (!asset?.stagedOutputPath) continue
    if (asset.previewStatus !== 'staged') continue
    if (asset.stagedToolId !== activeTool) continue
    if (!asset.runFolderName) continue
    stagedItems.push({
      assetId: asset.id,
      name: asset.name,
      stagedPath: asset.stagedOutputPath,
      outputName: asset.stagedOutputName,
      runId: asset.runId,
      runFolderName: asset.runFolderName,
    })
  }
  return stagedItems
}

function buildAssetStagedItem(asset, toolId = getState().activeTool) {
  const stagedPath = asset?.stagedOutputPath || asset?.savedOutputPath || asset?.outputPath || ''
  if (!stagedPath) return null
  if (asset.stagedToolId !== toolId) return null
  return {
    assetId: asset.id,
    name: asset.name,
    stagedPath,
    outputName: asset.stagedOutputName || (stagedPath ? String(stagedPath).split(/[\\/]/).pop() || asset.name : asset.name),
    runId: asset.runId,
    runFolderName: asset.runFolderName || '',
    saveSignature: asset.saveSignature || '',
  }
}

function buildReusablePreviewProcessed(asset, toolId) {
  if (!shouldReusePreviewResult(toolId, asset)) return null
  const stagedItem = buildAssetStagedItem(asset, toolId)
  if (!stagedItem) return null
  return {
    assetId: asset.id,
    name: asset.name,
    mode: 'preview-save',
    previewStatus: 'staged',
    outputName: asset.stagedOutputName || asset.name,
    stagedPath: stagedItem.stagedPath,
    previewUrl: asset.previewUrl || '',
    outputSizeBytes: asset.stagedSizeBytes || 0,
    width: asset.stagedWidth || asset.width || 0,
    height: asset.stagedHeight || asset.height || 0,
    warning: asset.warning || '',
    saveSignature: asset.saveSignature || '',
    runId: asset.runId || '',
    runFolderName: asset.runFolderName || '',
    savedOutputPath: '',
  }
}

function buildPreviewCleanupFolders(assets = []) {
  const folders = []
  for (let index = 0; index < assets.length; index += 1) {
    const asset = assets[index]
    if (asset?.previewStatus !== 'previewed' && asset?.previewStatus !== 'stale' && asset?.previewStatus !== 'staged' && asset?.previewStatus !== 'saved') continue
    if (!asset?.runFolderName) continue
    folders.push(asset.runFolderName)
  }
  return folders
}

function clearPreviewCacheState(assetIds = []) {
  if (!assetIds.length) return []
  const targets = new Set(assetIds.map((assetId) => String(assetId || '')).filter(Boolean))
  if (!targets.size) return []
  const state = getState()
  let nextAssets = null
  const cleanedFolders = []
  for (let index = 0; index < state.assets.length; index += 1) {
    const asset = state.assets[index]
    if (!targets.has(String(asset?.id || ''))) continue
    if (asset.runFolderName) cleanedFolders.push(asset.runFolderName)
    if (asset?.previewStatus !== 'previewed' && asset?.previewStatus !== 'stale' && asset?.previewStatus !== 'staged') continue
    if (!nextAssets) nextAssets = [...state.assets]
    nextAssets[index] = {
      ...asset,
      previewStatus: 'idle',
      previewUrl: '',
      stagedOutputPath: '',
      stagedOutputName: '',
      stagedSizeBytes: 0,
      stagedWidth: 0,
      stagedHeight: 0,
      runId: '',
      runFolderName: '',
      stagedToolId: '',
      saveSignature: '',
      warning: '',
    }
  }
  if (nextAssets) {
    setState({ assets: nextAssets })
  }
  for (let index = previewCacheQueue.length - 1; index >= 0; index -= 1) {
    if (targets.has(previewCacheQueue[index].assetId)) {
      previewCacheQueue.splice(index, 1)
    }
  }
  return cleanedFolders
}

function cleanupPreviewCacheByAssetIds(assetIds = [], reason = 'ui-preview-cache-cleanup') {
  const folders = clearPreviewCacheState(assetIds)
  if (folders.length) cleanupPreviewCache(folders, { reason })
}

function cleanupToolPreviewCache(toolId, reason = '') {
  if (!toolId) return
  const state = getState()
  const previewAssetIds = []
  for (let index = 0; index < state.assets.length; index += 1) {
    const asset = state.assets[index]
    if (asset?.stagedToolId !== toolId) continue
    if (!isPreviewCacheStatus(asset?.previewStatus, true)) continue
    previewAssetIds.push(asset.id)
  }
  if (previewAssetIds.length) cleanupPreviewCacheByAssetIds(previewAssetIds, reason || `tool-switch:${toolId}`)
}

function cleanupAllPreviewCache(reason = 'ui-clear-all-preview-cache') {
  const previewAssetIds = collectPreviewCacheAssetIds({ includeSaved: true })
  if (previewAssetIds.length) cleanupPreviewCacheByAssetIds(previewAssetIds, reason)
}

function removePreviewCacheQueueEntries(assetIds = []) {
  const targets = new Set(assetIds.map((assetId) => String(assetId || '')).filter(Boolean))
  if (!targets.size) return
  for (let index = previewCacheQueue.length - 1; index >= 0; index -= 1) {
    if (targets.has(previewCacheQueue[index].assetId)) {
      previewCacheQueue.splice(index, 1)
    }
  }
}

function rememberPreviewCacheAsset(assetId, toolId, runFolderName) {
  const normalizedAssetId = String(assetId || '')
  const normalizedToolId = String(toolId || '')
  const normalizedRunFolderName = String(runFolderName || '')
  if (!normalizedAssetId || !normalizedToolId || !normalizedRunFolderName) return
  for (let index = previewCacheQueue.length - 1; index >= 0; index -= 1) {
    if (previewCacheQueue[index].assetId === normalizedAssetId) {
      previewCacheQueue.splice(index, 1)
    }
  }
  previewCacheQueue.push({
    assetId: normalizedAssetId,
    toolId: normalizedToolId,
    runFolderName: normalizedRunFolderName,
  })
  if (previewCacheQueue.length <= PREVIEW_CACHE_LIMIT) return
  const evicted = []
  while (previewCacheQueue.length > PREVIEW_CACHE_LIMIT) {
    const entry = previewCacheQueue.shift()
    if (entry?.assetId) evicted.push(entry.assetId)
  }
  if (evicted.length) cleanupPreviewCacheByAssetIds(evicted, 'preview-cache-queue-eviction')
}

async function saveAssetResult(assetId) {
  const state = getState()
  const asset = getAssetById(assetId)
  const stagedItem = buildAssetStagedItem(asset, state.activeTool)
  if (!stagedItem) {
    notify({ type: 'info', message: '当前图片还没有可保存的处理结果。' })
    return
  }

  try {
    const destinationPath = state.destinationPath || state.settings.defaultSavePath || ''
    const result = await runBusyAction(() => saveStagedResult(state.activeTool, stagedItem, destinationPath))
    if (result?.processed?.length || result?.failed?.length) {
      applyRunResult(result)
      removePreviewCacheQueueEntries([assetId])
    }
    notifyActionResult(result, '保存失败。')
  } catch (error) {
    notify({ type: 'error', message: error?.message || '保存失败。' })
  }
}

async function saveAllCurrentResults() {
  const state = getState()
  const stagedItems = getCurrentStagedItems(state.activeTool, state.assets)
  if (!stagedItems.length) {
    notify({ type: 'info', message: '当前没有可批量保存的处理结果。' })
    return
  }

  try {
    const destinationPath = state.destinationPath || state.settings.defaultSavePath || ''
    const result = await runBusyAction(() => saveAllStagedResults(state.activeTool, stagedItems, destinationPath))
    if (result?.processed?.length || result?.failed?.length) {
      applyRunResult(result)
      removePreviewCacheQueueEntries(stagedItems.map((item) => item.assetId))
      refreshResultViewIfVisible()
    }
    notifyActionResult(result, '批量保存失败。')
  } catch (error) {
    notify({ type: 'error', message: error?.message || '批量保存失败。' })
  }
}

async function openResultPath(targetPath) {
  if (!targetPath) return
  const ok = await revealPath(targetPath)
  if (!ok) {
    notify({ type: 'error', message: `打开结果目录失败：${targetPath}` })
  }
}

function getDistinctSourceDirectories() {
  const directories = new Set()
  for (const asset of getState().assets) {
    const sourcePath = String(asset?.sourcePath || '').trim()
    if (!sourcePath) continue
    const directory = sourcePath.replaceAll('\\', '/').replace(/\/[^/]+$/, '').replaceAll('/', '\\')
    if (directory) directories.add(directory)
  }
  return Array.from(directories)
}

async function openSourceDirectories(paths = []) {
  for (const targetPath of paths) {
    await openResultPath(targetPath)
  }
}

async function runBusyAction(task) {
  setState({ isProcessing: true, cancelRequested: false })
  try {
    return await task()
  } finally {
    setState({ isProcessing: false, cancelRequested: false, processingProgress: null })
  }
}

async function cancelCurrentRun() {
  const state = getState()
  const runId = state.processingProgress?.runId || state.activeRun?.runId || ''
  if (!runId || getState().cancelRequested) return
  setState({ cancelRequested: true })
  const cancelled = await cancelRun(runId)
  if (!cancelled) {
    setState({ cancelRequested: false })
    notify({ type: 'error', message: '当前任务暂不支持停止。' })
    return
  }
  notify({ type: 'info', message: '已请求停止当前任务，正在尽快中止。', durationMs: 3000 })
}

function notifyActionResult(result, fallbackMessage) {
  notify({
    type: result?.ok ? 'success' : result?.partial ? 'info' : 'error',
    message: result?.message || fallbackMessage,
  })
}

function normalizeAssetPath(value = '') {
  const text = String(value || '').replaceAll('\\', '/').trim()
  if (!text) return ''
  return text.replace(/^([A-Za-z]):(?![\\/])/, '$1:/')
}

function getReplaceEntry(assetId) {
  const state = getState()
  const asset = getAssetById(assetId)
  if (!asset?.sourcePath) return null
  const resultItem = getResultViewItemByAssetId(state.resultView, assetId)
  const resultPath = normalizeAssetPath(
    resultItem?.outputPath
    || asset?.savedOutputPath
    || asset?.stagedOutputPath
    || asset?.outputPath
    || '',
  )
  if (!resultPath) return null
  return {
    assetId: asset.id,
    name: asset.name,
    sourcePath: normalizeAssetPath(asset.sourcePath),
    resultPath,
  }
}

function getResultViewItemByAssetId(resultView, assetId) {
  if (!assetId) return null
  const items = resultView?.items || []
  for (let index = 0; index < items.length; index += 1) {
    const item = items[index]
    if (item?.assetId === assetId) return item
  }
  return null
}

function getReplaceEntries() {
  const state = getState()
  const resultPathByAssetId = new Map()
  const resultItems = state.resultView?.items || []
  for (let index = 0; index < resultItems.length; index += 1) {
    const item = resultItems[index]
    resultPathByAssetId.set(item.assetId, normalizeAssetPath(item.outputPath))
  }
  const entries = []
  for (const asset of state.assets) {
    if (!asset?.sourcePath) continue
    const resultPath = resultPathByAssetId.get(asset.id)
      || normalizeAssetPath(asset?.savedOutputPath || asset?.stagedOutputPath || asset?.outputPath || '')
    if (!resultPath) continue
    entries.push({
      assetId: asset.id,
      name: asset.name,
      sourcePath: normalizeAssetPath(asset.sourcePath),
      resultPath,
    })
  }
  return entries
}

function clearAssetsResultState(processedItems) {
  const processedList = Array.isArray(processedItems) ? processedItems : []
  const state = getState()
  let nextAssets = null
  for (let listIndex = 0; listIndex < processedList.length; listIndex += 1) {
    const replaced = processedList[listIndex]
    const assetId = replaced?.assetId
    const index = getAssetIndexById(assetId)
    if (index === -1) continue
    const asset = (nextAssets || state.assets)[index]
    const nextSourcePath = String(replaced?.sourcePath || asset.sourcePath || '')
    const nextName = nextSourcePath ? nextSourcePath.replaceAll('\\', '/').split('/').pop() || asset.name : asset.name
    const nextExt = nextName.includes('.') ? nextName.split('.').pop().toLowerCase() : asset.ext
    const nextAsset = {
      ...asset,
      sourcePath: nextSourcePath || asset.sourcePath,
      name: replaced?.name || nextName,
      ext: replaced?.inputFormat || nextExt,
      inputFormat: replaced?.inputFormat || nextExt,
      sizeBytes: Number(replaced?.sizeBytes) || asset.sizeBytes,
      width: Number(replaced?.width) || asset.width,
      height: Number(replaced?.height) || asset.height,
      thumbnailUrl: replaced?.thumbnailUrl || (nextSourcePath ? `file:///${encodeURI(nextSourcePath.replaceAll('\\', '/').replace(/^([A-Za-z]):/, '$1:'))}` : asset.thumbnailUrl),
      listThumbnailUrl: replaced?.listThumbnailUrl || replaced?.thumbnailUrl || asset.listThumbnailUrl || asset.thumbnailUrl,
      previewStatus: 'idle',
      previewUrl: '',
      stagedOutputPath: '',
      stagedOutputName: '',
      stagedSizeBytes: 0,
      stagedWidth: 0,
      stagedHeight: 0,
      savedOutputPath: '',
      outputPath: '',
      runId: '',
      runFolderName: '',
      stagedToolId: '',
      saveSignature: '',
    }
    if (
      nextAsset.sourcePath === asset.sourcePath
      && nextAsset.name === asset.name
      && nextAsset.ext === asset.ext
      && nextAsset.inputFormat === asset.inputFormat
      && nextAsset.sizeBytes === asset.sizeBytes
      && nextAsset.width === asset.width
      && nextAsset.height === asset.height
      && nextAsset.thumbnailUrl === asset.thumbnailUrl
      && nextAsset.listThumbnailUrl === asset.listThumbnailUrl
      && nextAsset.previewStatus === asset.previewStatus
      && nextAsset.previewUrl === asset.previewUrl
      && nextAsset.stagedOutputPath === asset.stagedOutputPath
      && nextAsset.stagedOutputName === asset.stagedOutputName
      && nextAsset.stagedSizeBytes === asset.stagedSizeBytes
      && nextAsset.stagedWidth === asset.stagedWidth
      && nextAsset.stagedHeight === asset.stagedHeight
      && nextAsset.savedOutputPath === asset.savedOutputPath
      && nextAsset.outputPath === asset.outputPath
      && nextAsset.runId === asset.runId
      && nextAsset.runFolderName === asset.runFolderName
      && nextAsset.stagedToolId === asset.stagedToolId
      && nextAsset.saveSignature === asset.saveSignature
    ) continue
    if (!nextAssets) nextAssets = [...state.assets]
    nextAssets[index] = nextAsset
  }
  if (nextAssets) {
    setState({ assets: nextAssets })
  }
}

function hasVisibleResultComparison() {
  return !!getState().resultView?.items?.length
}

function refreshResultView() {
  const state = getState()
  const currentResultView = state.resultView
  const canCompareWithCurrent = !!(
    currentResultView
    && currentResultView.runId === (state.activeRun?.runId || '')
    && currentResultView.toolId === state.activeTool
    && currentResultView.mode === (state.activeRun?.mode || 'save')
  )
  const currentItems = canCompareWithCurrent ? (currentResultView.items || []) : null
  const items = []
  let matchesCurrentItems = !!currentItems
  for (const asset of state.assets) {
    const outputPath = getSavedOutputPath(asset) || getPreviewOutputPath(asset) || ''
    if (!outputPath) continue
    const resultSizeBytes = asset.stagedSizeBytes || asset.sizeBytes || 0
    const resultWidth = asset.stagedWidth || asset.width || 0
    const resultHeight = asset.stagedHeight || asset.height || 0
    const normalizedOutputPath = String(outputPath || '').replaceAll('\\', '/')
    const resultName = normalizedOutputPath.split('/').pop() || asset.name || ''
    const nextItem = {
      assetId: asset.id,
      name: asset.name,
      outputPath,
      source: {
        name: asset.name || '',
        sizeBytes: asset.sizeBytes || 0,
        width: asset.width || 0,
        height: asset.height || 0,
      },
      result: {
        name: resultName,
        sizeBytes: resultSizeBytes,
        width: resultWidth,
        height: resultHeight,
      },
      summary: getPreviewMessage(asset),
    }
    if (matchesCurrentItems) {
      const currentItem = currentItems[items.length] || null
      if (
        !currentItem
        || currentItem.assetId !== nextItem.assetId
        || currentItem.outputPath !== nextItem.outputPath
        || currentItem.result?.name !== nextItem.result?.name
        || (currentItem.result?.sizeBytes || 0) !== (nextItem.result?.sizeBytes || 0)
        || (currentItem.result?.width || 0) !== (nextItem.result?.width || 0)
        || (currentItem.result?.height || 0) !== (nextItem.result?.height || 0)
        || (currentItem.summary || '') !== (nextItem.summary || '')
      ) {
        matchesCurrentItems = false
      }
    }
    items.push(nextItem)
  }

  if (!items.length) {
    setResultView(null)
    return
  }

  if (matchesCurrentItems && currentItems.length === items.length) {
    return
  }

  setResultView({
    runId: state.activeRun?.runId || '',
    toolId: state.activeTool,
    mode: state.activeRun?.mode || 'save',
    items,
    failed: [],
    createdAt: Date.now(),
  })
}

function refreshResultViewIfVisible() {
  if (!hasVisibleResultComparison()) return
  refreshResultView()
}

function updateColorPreview(toolId, key, value) {
  updateConfig(toolId, { [key]: value })
}

function normalizeColorInputValue(value = '') {
  const text = String(value || '').trim().toUpperCase()
  return /^#([0-9A-F]{6})$/.test(text) ? text : ''
}

function syncColorTextInput(target) {
  const wrapper = target.closest('.color-field')
  const mirror = wrapper?.querySelector('.color-field__value')
  const value = target.value.toUpperCase()
  if (mirror) mirror.value = value
}

function syncResultMarquees() {
  document.querySelectorAll('.result-strip__value, .result-strip__meta').forEach((node) => {
    const marquee = node.querySelector('.result-strip__marquee')
    if (!marquee) return
    node.classList.toggle('is-marquee', marquee.scrollWidth > node.clientWidth + 1)
  })
}

function queueResultMarqueeSync() {
  if (!document.querySelector('.result-strip__marquee')) return
  if (resultMarqueeFrame) cancelAnimationFrame(resultMarqueeFrame)
  resultMarqueeFrame = requestAnimationFrame(() => {
    resultMarqueeFrame = 0
    syncResultMarquees()
  })
}

function openColorPickerZoom(target) {
  const field = target.closest('.color-field')
  const nativeInput = field?.querySelector('.color-field__native')
  if (!nativeInput) return
  nativeInput.showPicker?.()
  if (!nativeInput.showPicker) nativeInput.click()
}

function resetActiveResultUi() {
  batchStateUpdates(() => {
    closePreviewModal()
    setResultView(null)
    setState({ activeRun: null })
  })
}

function injectResultToolbar() {
  const shell = document.querySelector('.app-shell')
  if (!shell) return
  const existing = shell.querySelector('.result-toolbar')
  const activeRun = getState().activeRun
  const hasBatchRun = activeRun && activeRun.mode !== 'preview-only'
  const hasVisibleResults = hasVisibleResultComparison()
  const shouldShow = hasBatchRun || hasVisibleResults
  if (!shouldShow) {
    if (existing) existing.remove()
    resultToolbarSignature = ''
    return
  }
  const nextSignature = `${hasBatchRun ? 1 : 0}:${hasVisibleResults ? 1 : 0}`
  const primaryLabel = hasVisibleResults ? '打开目录' : '显示结果'
  if (existing) {
    if (resultToolbarSignature === nextSignature) return
    const primaryButton = existing.querySelector('[data-action="open-current-results"]')
    if (primaryButton) primaryButton.textContent = primaryLabel
    resultToolbarSignature = nextSignature
    return
  }
  shell.insertAdjacentHTML('beforeend', `
    <div class="result-toolbar">
      <button class="secondary-button" data-action="continue-processing">继续处理</button>
      <button class="secondary-button" data-action="replace-current-originals">替换原图</button>
      <button class="primary-button" data-action="open-current-results">${primaryLabel}</button>
    </div>
  `)
  resultToolbarSignature = nextSignature
}

async function replaceAssetOriginal(assetId) {
  const entry = getReplaceEntry(assetId)
  if (!entry) {
    notify({ type: 'info', message: '当前图片还没有可替换回原图的处理结果。' })
    return
  }
  try {
    const result = await runBusyAction(() => replaceOriginals([entry]))
    if (result?.processed?.length) {
      clearAssetsResultState(result.processed)
      refreshResultViewIfVisible()
      notify({ type: 'info', message: '图片列表已更新为替换后的文件信息。' })
    }
    notifyActionResult(result, '替换原图失败。')
  } catch (error) {
    notify({ type: 'error', message: error?.message || '替换原图失败。' })
  }
}

async function openCurrentResultsDirectory() {
  const state = getState()
  if (state.activeTool === 'manual-crop') {
    const config = state.configs['manual-crop']
    const currentAsset = state.assets[config.currentIndex]
    let fallbackTargetPath = ''
    for (const item of state.assets) {
      fallbackTargetPath = getLatestAssetResultPath(item)
      if (fallbackTargetPath) break
    }
    const currentTargetPath = config.sessionOutputPath || getLatestAssetResultPath(currentAsset) || fallbackTargetPath || ''
    if (!currentTargetPath) {
      notify({ type: 'info', message: '当前还没有可打开的结果目录。' })
      return
    }
    await openResultPath(currentTargetPath)
    return
  }
  if (!hasVisibleResultComparison()) {
    refreshResultView()
    const visible = !!getState().resultView?.items?.length
    if (visible) closePreviewModal()
    if (visible) return
    const sourceDirectories = getDistinctSourceDirectories()
    if (!sourceDirectories.length) {
      notify({ type: 'info', message: '当前没有可打开的结果目录。' })
      return
    }
    if (sourceDirectories.length > 5) {
      openConfirmDialog({
        title: '打开原图目录',
        subtitle: `共 ${sourceDirectories.length} 个目录`,
        message: `当前结果已替换回原图。要继续打开这 ${sourceDirectories.length} 个原图目录吗？`,
        confirmLabel: '继续打开',
        confirmAction: 'confirm-open-source-directories',
        paths: sourceDirectories,
      })
      return
    }
    await openSourceDirectories(sourceDirectories)
    return
  }
  let asset = null
  for (const item of state.assets) {
    if (getSavedOutputPath(item) || getPreviewOutputPath(item) || item.outputPath) {
      asset = item
      break
    }
  }
  if (!asset) {
    notify({ type: 'info', message: '当前没有可打开的结果目录。' })
    return
  }
  const targetPath = getLatestAssetResultPath(asset)
  if (!targetPath) {
    notify({ type: 'info', message: '当前还没有可打开的结果目录。' })
    return
  }
  await openResultPath(targetPath)
}

async function replaceCurrentOriginals() {
  const entries = getReplaceEntries()
  if (!entries.length) {
    notify({ type: 'info', message: '当前没有可替换的处理结果。' })
    return
  }
  try {
    const result = await runBusyAction(() => replaceOriginals(entries))
    if (result?.processed?.length) {
      clearAssetsResultState(result.processed)
      refreshResultViewIfVisible()
      notify({ type: 'info', message: '图片列表已更新为替换后的文件信息。' })
    }
    notifyActionResult(result, '替换原图失败。')
  } catch (error) {
    notify({ type: 'error', message: error?.message || '替换原图失败。' })
  }
}


function getPreviewMessage(asset) {
  const toolId = getState().activeTool
  const previewStatus = asset.stagedToolId === toolId ? asset.previewStatus : 'idle'
  if (previewStatus === 'previewed') {
    return `预览结果：${truncate(asset.name, 20)} · ${formatBytes(asset.stagedSizeBytes)} · ${asset.stagedWidth || '—'}×${asset.stagedHeight || '—'}`
  }
  if (previewStatus === 'staged') {
    return `待保存结果：${truncate(asset.name, 20)} · ${formatBytes(asset.stagedSizeBytes)} · ${asset.stagedWidth || '—'}×${asset.stagedHeight || '—'}`
  }
  if (previewStatus === 'saved') {
    return `已保存：${truncate(asset.name, 20)} · ${asset.savedOutputPath || asset.outputPath}`
  }
  if (previewStatus === 'stale') {
    return `当前结果已过期，请重新预览或重新处理：${truncate(asset.name, 20)}`
  }
  return `这张图片还没预览：${truncate(asset.name, 20)} · ${describeToolConfig(toolId, getState().configs[toolId])}`
}

function openPreviewModal(asset, toolId = getState().activeTool) {
  if (!asset?.previewUrl) {
    notify({ type: 'info', message: getPreviewMessage(asset) })
    return false
  }
  const compareMode = RESHAPED_PREVIEW_TOOLS.has(toolId) ? 'split' : 'slider'
  setPreviewModal({
    assetId: asset.id || '',
    toolId,
    name: asset.name,
    url: asset.previewUrl,
    beforeUrl: asset.thumbnailUrl || asset.previewUrl,
    afterUrl: asset.previewUrl,
    canSave: !!buildAssetStagedItem(asset, toolId),
    compareMode,
    sourceWidth: Number(asset.width) || 0,
    sourceHeight: Number(asset.height) || 0,
    compareWidth: Number(asset.stagedWidth || asset.width) || 0,
    compareHeight: Number(asset.stagedHeight || asset.height) || 0,
    compareRatio: 0.5,
    compareZoom: 1,
    compareOffsetX: 0,
    compareOffsetY: 0,
    compareLabelsHidden: false,
    helpOpen: false,
    expanded: compareMode !== 'split',
  })
  return true
}

function closePreviewModal() {
  setPreviewModal(null)
}

function togglePreviewCompareFullscreen() {
  const preview = getState().previewModal
  if (!preview?.url) return
  setPreviewModal({ ...preview, expanded: !preview.expanded })
}

function togglePreviewCompareLabels() {
  const preview = getState().previewModal
  if (!preview?.url) return
  setPreviewModal({ ...preview, compareLabelsHidden: !preview.compareLabelsHidden })
}

function togglePreviewHelp() {
  const preview = getState().previewModal
  if (!preview?.url) return
  setPreviewModal({ ...preview, helpOpen: !preview.helpOpen })
}

function setPreviewCompareRatio(ratio) {
  const preview = getState().previewModal
  if (!preview?.url) return
  const nextRatio = Math.max(0, Math.min(1, ratio))
  const currentRatio = Number.isFinite(Number(preview.compareRatio)) ? Number(preview.compareRatio) : 0.5
  if (Math.abs(currentRatio - nextRatio) < 0.0025) return
  setPreviewModal({ ...preview, compareRatio: nextRatio })
}

function setPreviewCompareZoom(zoom) {
  const preview = getState().previewModal
  if (!preview?.url) return
  const nextZoom = Math.max(1, Math.min(5, zoom))
  const currentZoom = Number.isFinite(Number(preview.compareZoom)) ? Number(preview.compareZoom) : 1
  if (Math.abs(currentZoom - nextZoom) < 0.01) return
  setPreviewModal({
    ...preview,
    compareZoom: nextZoom,
    compareOffsetX: nextZoom <= 1.01 ? 0 : Number(preview.compareOffsetX) || 0,
    compareOffsetY: nextZoom <= 1.01 ? 0 : Number(preview.compareOffsetY) || 0,
  })
}

function setPreviewCompareOffset(offsetX, offsetY) {
  const preview = getState().previewModal
  if (!preview?.url) return
  setPreviewModal({
    ...preview,
    compareOffsetX: Math.round(offsetX),
    compareOffsetY: Math.round(offsetY),
  })
}

function nudgePreviewCompareRatio(delta) {
  const preview = getState().previewModal
  if (!preview?.url || preview.compareMode === 'split') return
  const currentRatio = Number.isFinite(Number(preview.compareRatio)) ? Number(preview.compareRatio) : 0.5
  setPreviewCompareRatio(currentRatio + delta)
}

function updatePreviewCompareRatioFromEvent(event) {
  const stage = document.querySelector('.preview-compare-stage[data-role="preview-compare-stage"]')
  if (!stage) return
  const rect = stage.getBoundingClientRect()
  if (!rect.width) return
  const ratio = (event.clientX - rect.left) / rect.width
  setPreviewCompareRatio(ratio)
}

function beginPreviewCompareDrag(event, target) {
  const stage = target.closest('.preview-compare-stage')
  if (!stage) return
  DRAG_CONTEXT.previewCompare = { pointerId: event.pointerId }
  updatePreviewCompareRatioFromEvent(event)
  event.preventDefault()
}

function beginPreviewComparePan(event) {
  const preview = getState().previewModal
  if (!preview?.url) return
  if (preview.compareMode === 'split') {
    if (event.button !== 0 && event.button !== 2) return
  } else if (event.button !== 2) {
    return
  }
  const zoom = Number.isFinite(Number(preview.compareZoom)) ? Number(preview.compareZoom) : 1
  if (zoom <= 1.01) return
  DRAG_CONTEXT.previewPan = {
    pointerId: event.pointerId,
    startX: event.clientX,
    startY: event.clientY,
    originX: Number(preview.compareOffsetX) || 0,
    originY: Number(preview.compareOffsetY) || 0,
  }
  event.preventDefault()
}

function handlePreviewCompareDrag(event) {
  if (!DRAG_CONTEXT.previewCompare) return
  updatePreviewCompareRatioFromEvent(event)
}

function handlePreviewComparePan(event) {
  const context = DRAG_CONTEXT.previewPan
  if (!context) return
  setPreviewCompareOffset(
    context.originX + (event.clientX - context.startX),
    context.originY + (event.clientY - context.startY),
  )
}

function endPreviewCompareDrag() {
  DRAG_CONTEXT.previewCompare = null
}

function endPreviewComparePan() {
  DRAG_CONTEXT.previewPan = null
}

function formatBytes(bytes = 0) {
  if (!bytes) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB']
  let value = bytes
  let index = 0
  while (value >= 1024 && index < units.length - 1) {
    value /= 1024
    index += 1
  }
  return `${value >= 100 ? value.toFixed(0) : value.toFixed(1)} ${units[index]}`
}

function getToolRunner(toolId, previewMode = '') {
  if (previewMode === 'preview-only') {
    return isPreviewableTool(toolId)
      ? (configToolId, config, assets, destinationPath, options = {}) => stageToolPreview(configToolId, config, assets, destinationPath, 'preview-only', options)
      : (configToolId, config, assets, destinationPath, options = {}) => runTool(configToolId, config, assets, destinationPath, options)
  }
  return PREVIEW_SAVE_TOOLS.has(toolId)
    ? (configToolId, config, assets, destinationPath, options = {}) => stageToolPreview(configToolId, config, assets, destinationPath, 'preview-save', options)
    : (configToolId, config, assets, destinationPath, options = {}) => runTool(configToolId, config, assets, destinationPath, options)
}

function buildPreviewReuseSignature(toolId, config) {
  return JSON.stringify({ toolId, config: config || {} })
}

function getPreferredRunFolderName(toolId, assets = getState().assets) {
  const signature = buildPreviewReuseSignature(toolId, getState().configs[toolId])
  for (let index = 0; index < assets.length; index += 1) {
    const asset = assets[index]
    if (asset?.stagedToolId !== toolId) continue
    if (!asset?.runFolderName) continue
    if (asset?.saveSignature && asset.saveSignature !== signature) continue
    if (!['previewed', 'staged', 'saved'].includes(asset?.previewStatus)) continue
    return asset.runFolderName
  }
  return ''
}

function shouldReusePreviewResult(toolId, asset) {
  if (!isPreviewableTool(toolId)) return false
  if (asset?.stagedToolId !== toolId) return false
  if (!asset?.stagedOutputPath && !asset?.savedOutputPath && !asset?.outputPath) return false
  const signature = buildPreviewReuseSignature(toolId, getState().configs[toolId])
  if (asset?.saveSignature && asset.saveSignature !== signature) return false
  return ['previewed', 'staged', 'saved'].includes(asset.previewStatus)
}

function buildViewableResultAsset(asset, toolId) {
  if (!shouldReusePreviewResult(toolId, asset)) return null
  const resultPath = asset.savedOutputPath || asset.outputPath || asset.stagedOutputPath || ''
  if (!resultPath) return null
  const resultUrl = asset.previewUrl || createAssetDisplayUrl(resultPath, asset.inputFormat || asset.ext || '')
  if (!resultUrl) return null
  return {
    ...asset,
    previewUrl: resultUrl,
    stagedOutputPath: asset.stagedOutputPath || resultPath,
  }
}

function hasReusableResultFile(asset, toolId) {
  if (!shouldReusePreviewResult(toolId, asset)) return false
  const resultPath = asset?.savedOutputPath || asset?.outputPath || asset?.stagedOutputPath || ''
  if (!resultPath) return false
  return checkStagedFiles([{ assetId: asset.id, stagedPath: resultPath }]).includes(asset.id)
}

function markAssetResultMissing(assetId, toolId) {
  const state = getState()
  const assetIndex = getAssetIndexById(assetId)
  if (assetIndex === -1) return false
  const asset = state.assets[assetIndex]
  if (!asset || asset.stagedToolId !== toolId) return false
  const nextAssets = [...state.assets]
  nextAssets[assetIndex] = {
    ...asset,
    previewStatus: 'stale',
    previewUrl: '',
    stagedOutputPath: '',
    savedOutputPath: '',
    outputPath: '',
    stagedOutputName: '',
    stagedSizeBytes: 0,
    stagedWidth: 0,
    stagedHeight: 0,
    warning: '',
  }
  setState({ assets: nextAssets })
  return true
}

function findProcessedResultByAssetId(processedItems, assetId) {
  if (!processedItems?.length || !assetId) return null
  for (const item of processedItems) {
    if (item?.assetId === assetId) return item
  }
  return null
}

async function previewWithRunner(tool, asset) {
  const state = getState()
  const destinationPath = state.destinationPath || state.settings.defaultSavePath || ''
  const result = await getToolRunner(tool.id, 'preview-only')(tool.id, state.configs[tool.id], [asset], destinationPath)
  if (!(result?.ok || result?.partial)) {
    throw new Error(result?.message || '预览失败。')
  }
  const processed = result?.processed?.[0]?.assetId === asset.id
    ? result.processed[0]
    : findProcessedResultByAssetId(result?.processed, asset.id)
  if (result?.processed?.length || result?.failed?.length) {
    applyRunResult(result)
    if (processed?.runFolderName) {
      rememberPreviewCacheAsset(asset.id, tool.id, processed.runFolderName)
    }
  }
  const previewedAsset = getAssetById(asset.id) || (processed
    ? {
        ...asset,
        previewUrl: processed.previewUrl || processed.outputPath || asset.previewUrl,
        stagedOutputPath: processed.stagedPath || asset.stagedOutputPath || '',
        stagedOutputName: processed.outputName || asset.stagedOutputName || '',
        stagedSizeBytes: processed.outputSizeBytes || asset.stagedSizeBytes || 0,
        stagedWidth: processed.width || asset.stagedWidth || 0,
        stagedHeight: processed.height || asset.stagedHeight || 0,
        previewStatus: processed.previewStatus || (PREVIEW_SAVE_TOOLS.has(tool.id) ? 'previewed' : 'saved'),
        stagedToolId: tool.id,
        runId: processed.runId || asset.runId || '',
        runFolderName: processed.runFolderName || asset.runFolderName || '',
        saveSignature: processed.saveSignature || asset.saveSignature || '',
        savedOutputPath: processed.savedOutputPath || processed.outputPath || asset.savedOutputPath || '',
        outputPath: processed.outputPath || asset.outputPath || '',
      }
    : asset)
  if (!openPreviewModal(previewedAsset, tool.id)) {
    throw new Error(`${tool?.label || '当前工具'} 预览结果无法打开。`)
  }
  if (isPreviewableTool(tool.id) && !PREVIEW_SAVE_TOOLS.has(tool.id)) {
    notify({ type: 'success', message: `${tool.label} 预览已生成。` })
  }
}

async function savePreviewResultFromModal() {
  const preview = getState().previewModal
  const assetId = preview?.assetId || ''
  if (!assetId) {
    notify({ type: 'info', message: '当前预览没有可直接保存的处理结果。' })
    return
  }
  await saveAssetResult(assetId)
}

function getCompressionOversizeWarning(result, tool) {
  if (tool?.id !== 'compression') return ''
  if (result?.config?.mode !== 'target') return ''
  const targetKb = Number(result?.config?.targetSizeKb) || 0
  const targetBytes = targetKb > 0 ? targetKb * 1024 : 0
  if (!targetBytes) return ''
  let oversizeCount = 0
  let worstBytes = 0
  for (const item of result?.processed || []) {
    const outputSizeBytes = Number(item?.outputSizeBytes) || 0
    if (outputSizeBytes <= targetBytes) continue
    oversizeCount += 1
    if (outputSizeBytes > worstBytes) worstBytes = outputSizeBytes
  }
  if (!oversizeCount) return ''
  if (worstBytes <= targetBytes * 1.5) return ''
  return `按体积存在明显偏离：目标 ${targetKb} KB，最大结果 ${formatBytes(worstBytes)}。极端图片无法保证严格命中目标体积。`
}

function closeConfigSelect(target) {
  const shell = target?.closest?.('.select-shell')
  if (!shell) return
  shell.classList.remove('is-open')
  const trigger = shell.querySelector('[data-action="toggle-config-select"], .select-shell__value')
  if (trigger) trigger.setAttribute('aria-expanded', 'false')
}

function closeAllConfigSelects(exceptShell = null) {
  document.querySelectorAll('.select-shell.is-open').forEach((shell) => {
    if (exceptShell && shell === exceptShell) return
    shell.classList.remove('is-open')
    const trigger = shell.querySelector('[data-action="toggle-config-select"], .select-shell__value')
    if (trigger) trigger.setAttribute('aria-expanded', 'false')
  })
}

function toggleConfigSelect(target) {
  const shell = target?.closest?.('.select-shell')
  if (!shell) return
  const willOpen = !shell.classList.contains('is-open')
  closeAllConfigSelects(shell)
  shell.classList.toggle('is-open', willOpen)
  target.setAttribute('aria-expanded', willOpen ? 'true' : 'false')
}

function getPreviewOutputPath(asset) {
  return asset.stagedOutputPath || ''
}

function getSavedOutputPath(asset) {
  return asset.savedOutputPath || ''
}

function getLatestAssetResultPath(asset) {
  return getSavedOutputPath(asset) || getPreviewOutputPath(asset) || asset?.outputPath || ''
}

function captureRenderSnapshot(state) {
  return {
    mode: getAppShellMode(state),
    activeTool: state.activeTool,
    activeRun: state.activeRun,
    sidebarCollapsed: state.sidebarCollapsed,
    isProcessing: state.isProcessing,
    cancelRequested: state.cancelRequested,
    processingProgress: state.processingProgress,
    assets: state.assets,
    activeConfig: state.configs[state.activeTool],
    settingsDialog: state.settingsDialog,
    resultView: state.resultView,
    presetDialog: state.presetDialog,
    confirmDialog: state.confirmDialog,
    previewModal: state.previewModal,
    notifications: state.notifications,
  }
}

function diffRenderSnapshot(prev, next) {
  const toolChanged = next.activeTool !== prev.activeTool
  const modeChanged = next.mode !== prev.mode
  const configChanged = next.activeConfig !== prev.activeConfig
  const workspaceChanged = toolChanged
    || configChanged
    || next.settingsDialog !== prev.settingsDialog
    || next.resultView !== prev.resultView
  const resultViewChanged = next.resultView !== prev.resultView
  const shellFrameChanged = next.sidebarCollapsed !== prev.sidebarCollapsed
    || modeChanged
    || next.isProcessing !== prev.isProcessing
  const sideNavChanged = toolChanged
    || next.sidebarCollapsed !== prev.sidebarCollapsed
    || modeChanged
  const topbarChanged = toolChanged
    || next.sidebarCollapsed !== prev.sidebarCollapsed
    || modeChanged
    || next.isProcessing !== prev.isProcessing
    || next.cancelRequested !== prev.cancelRequested
    || next.processingProgress !== prev.processingProgress
  const overlaysChanged = next.presetDialog !== prev.presetDialog
    || next.confirmDialog !== prev.confirmDialog
    || next.previewModal !== prev.previewModal
  const notificationsChanged = next.notifications !== prev.notifications
  const toolbarChanged = next.activeRun !== prev.activeRun
    || resultViewChanged
  const queueChanged = next.assets !== prev.assets
    || toolChanged
    || modeChanged
    || next.isProcessing !== prev.isProcessing
  const marqueeChanged = resultViewChanged
    || (next.mode === 'result' && workspaceChanged)

  return {
    previousMode: prev.mode,
    nextMode: next.mode,
    toolChanged,
    modeChanged,
    configChanged,
    resultViewChanged,
    shellFrameChanged,
    workspaceChanged,
    sideNavChanged,
    topbarChanged,
    overlaysChanged,
    notificationsChanged,
    toolbarChanged,
    queueChanged,
    marqueeChanged,
  }
}

function hasSameAssetOrder(previousAssets = [], nextAssets = []) {
  if (previousAssets === nextAssets) return true
  if (!Array.isArray(previousAssets) || !Array.isArray(nextAssets)) return false
  if (previousAssets.length !== nextAssets.length) return false
  for (let index = 0; index < previousAssets.length; index += 1) {
    if (previousAssets[index]?.id !== nextAssets[index]?.id) return false
  }
  return true
}

function hasSameAssetSet(previousAssets = [], nextAssets = []) {
  if (!Array.isArray(previousAssets) || !Array.isArray(nextAssets)) return false
  if (previousAssets.length !== nextAssets.length) return false
  const previousIds = new Set()
  for (const asset of previousAssets) {
    const assetId = asset?.id
    if (!assetId || previousIds.has(assetId)) return false
    previousIds.add(assetId)
  }
  for (const asset of nextAssets) {
    if (!previousIds.has(asset?.id)) return false
  }
  return true
}

function hasAssetOrderPrefix(previousAssets = [], nextAssets = []) {
  if (!Array.isArray(previousAssets) || !Array.isArray(nextAssets)) return false
  if (previousAssets.length >= nextAssets.length) return false
  for (let index = 0; index < previousAssets.length; index += 1) {
    if (previousAssets[index]?.id !== nextAssets[index]?.id) return false
  }
  return true
}

function renderNotificationsRoot(items) {
  return `<div class="render-slot" data-root="notifications">${renderNotifications(items)}</div>`
}

function getRootNode(name) {
  return app?.querySelector?.(`[data-root="${name}"]`) || null
}

function setRootMarkup(name, markup) {
  const key = String(name || '')
  if (!key) return { root: null, changed: false }
  const root = getRootNode(key)
  if (!root) return { root: null, changed: false }
  if (rootMarkupCache[key] === markup) {
    return { root, changed: false }
  }
  root.innerHTML = markup
  rootMarkupCache[key] = markup
  return { root, changed: true }
}

function syncSideNavRoot(state, mode = getAppShellMode(state)) {
  const expectedMarkup = renderShellSideNav(state, mode)
  const root = getRootNode('side-nav')
  if (!root) return { root: null, changed: false }
  if (mode === 'result') return setRootMarkup('side-nav', expectedMarkup)

  const sidebar = root.querySelector('.sidebar')
  const navItems = Array.from(root.querySelectorAll('.nav-item[data-tool-id]'))
  if (!sidebar || !navItems.length) {
    return setRootMarkup('side-nav', expectedMarkup)
  }

  sidebar.classList.toggle('sidebar--collapsed', !!state.sidebarCollapsed)
  for (const item of navItems) {
    const toolId = item.dataset.toolId || ''
    item.classList.toggle('is-active', toolId === state.activeTool)
  }

  rootMarkupCache.sideNav = expectedMarkup
  return { root, changed: false }
}

function syncTopBarRoot(state, mode = getAppShellMode(state)) {
  const expectedMarkup = renderShellTopBar(state, mode)
  if (mode === 'result') return setRootMarkup('topbar', expectedMarkup)

  const root = getRootNode('topbar')
  if (!root) return { root: null, changed: false }

  const topbar = root.querySelector('.topbar')
  const toggleButton = root.querySelector('.topbar__toggle')
  const toggleIcon = toggleButton?.querySelector('.material-symbols-outlined')
  const titleNode = root.querySelector('.topbar__title')
  const meta = root.querySelector('.topbar__meta')
  const processButton = root.querySelector('[data-action="process-current"]')
  if (!topbar || !toggleButton || !toggleIcon || !titleNode || !meta || !processButton) {
    return setRootMarkup('topbar', expectedMarkup)
  }

  const sidebarLabel = state.sidebarCollapsed ? '\u5c55\u5f00\u5bfc\u822a' : '\u6536\u8d77\u5bfc\u822a'
  const sidebarIcon = state.sidebarCollapsed ? 'right_panel_open' : 'left_panel_close'
  const toolLabel = TOOL_MAP[state.activeTool]?.label || ''
  const progress = state.processingProgress
  const processingToolId = progress?.toolId || state.activeTool
  const isMergeProcessing = state.isProcessing
    && (processingToolId === 'merge-pdf' || processingToolId === 'merge-image' || processingToolId === 'merge-gif')
  const processLabel = state.isProcessing
    ? (
        processingToolId === 'merge-pdf'
          ? (progress?.phase === 'merge-pdf-prepare' ? '\u9884\u5904\u7406\u4e2d' : '\u751f\u6210 PDF \u4e2d')
          : processingToolId === 'merge-image'
            ? '\u5408\u5e76\u4e2d'
            : processingToolId === 'merge-gif'
              ? '\u751f\u6210 GIF \u4e2d'
          : `${progress?.completed || 0}/${progress?.total || 0} \u5904\u7406\u4e2d`
      )
    : '\u5f00\u59cb\u5904\u7406'

  if (titleNode.textContent !== toolLabel) titleNode.textContent = toolLabel
  if (toggleButton.dataset.tooltip !== sidebarLabel) toggleButton.dataset.tooltip = sidebarLabel
  if (toggleButton.getAttribute('aria-label') !== sidebarLabel) toggleButton.setAttribute('aria-label', sidebarLabel)
  if (toggleIcon.textContent !== sidebarIcon) toggleIcon.textContent = sidebarIcon

  let stopButton = root.querySelector('[data-action="cancel-current-run"]')
  if (state.isProcessing) {
    const stopLabel = state.cancelRequested ? '\u505c\u6b62\u4e2d...' : '\u505c\u6b62\u4efb\u52a1'
    if (!stopButton) {
      stopButton = document.createElement('button')
      stopButton.className = 'secondary-button topbar__stop-button'
      stopButton.dataset.action = 'cancel-current-run'
      meta.insertBefore(stopButton, processButton)
    }
    if (stopButton.textContent !== stopLabel) stopButton.textContent = stopLabel
    stopButton.toggleAttribute('disabled', !!state.cancelRequested)
    processButton.classList.add('is-processing')
    processButton.classList.toggle('is-processing--merge', isMergeProcessing)
    processButton.toggleAttribute('disabled', true)
  } else if (stopButton) {
    stopButton.remove()
    stopButton = null
    processButton.classList.remove('is-processing')
    processButton.classList.remove('is-processing--merge')
    processButton.removeAttribute('disabled')
  } else {
    processButton.classList.remove('is-processing')
    processButton.classList.remove('is-processing--merge')
    processButton.removeAttribute('disabled')
  }

  if (processButton.textContent !== processLabel) processButton.textContent = processLabel
  rootMarkupCache.topbar = expectedMarkup
  return { root, changed: false }
}

function canReuseDetachedQueueContent(state) {
  if (!detachedQueueContent || !detachedQueueState) return false
  if ((detachedQueueState.activeTool || '') !== String(state?.activeTool || '')) return false
  return detachedQueueState.assetOrderSignature === getAssetOrderSignature(state?.assets)
}

function detachQueueContent(snapshot = null) {
  const root = getRootNode('queue')
  const content = root?.firstElementChild || null
  if (!root || !content) {
    detachedQueueContent = null
    detachedQueueState = null
    return
  }
  root.removeChild(content)
  detachedQueueContent = content
  detachedQueueState = {
    activeTool: snapshot?.activeTool || getState().activeTool,
    assetOrderSignature: getAssetOrderSignature(snapshot?.assets || getState().assets),
  }
}

function attachDetachedQueueContent(state = getState()) {
  const root = getRootNode('queue')
  if (!root || !canReuseDetachedQueueContent(state)) return false
  root.replaceChildren(detachedQueueContent)
  detachedQueueContent = null
  detachedQueueState = null
  queueMarkupCacheDirty = true
  syncQueueViewportFromDom()
  return true
}

function detachQueueThumbContent(root) {
  if (!root) return new Map()
  const detachedThumbs = new Map()
  root.querySelectorAll('.queue-item[data-asset-id]').forEach((item) => {
    const assetId = item.getAttribute('data-asset-id') || ''
    const thumb = item.querySelector('.queue-item__thumb')
    const content = thumb?.firstElementChild || null
    if (!assetId || !thumb || !content) return
    thumb.removeChild(content)
    detachedThumbs.set(assetId, content)
  })
  return detachedThumbs
}

function attachQueueThumbContent(root, detachedThumbs) {
  if (!root || !detachedThumbs?.size) return
  root.querySelectorAll('.queue-item[data-asset-id]').forEach((item) => {
    const assetId = item.getAttribute('data-asset-id') || ''
    const thumb = item.querySelector('.queue-item__thumb')
    const content = detachedThumbs.get(assetId)
    if (!assetId || !thumb || !content) return
    thumb.replaceChildren(content)
  })
}

function patchQueueRootMarkup(root, markup) {
  if (!root) return false
  const currentQueueNode = root.querySelector('[data-scroll-role="queue"]')
  if (!currentQueueNode) {
    root.innerHTML = markup
    return true
  }
  const template = document.createElement('template')
  template.innerHTML = markup.trim()
  const nextQueueNode = template.content.querySelector('[data-scroll-role="queue"]')
  if (!nextQueueNode) {
    root.innerHTML = markup
    return true
  }
  const detachedThumbs = detachQueueThumbContent(currentQueueNode)
  currentQueueNode.className = nextQueueNode.className
  currentQueueNode.innerHTML = nextQueueNode.innerHTML
  attachQueueThumbContent(currentQueueNode, detachedThumbs)
  return true
}

function findQueueAnchorItem(queueNode, queueRect) {
  const items = queueNode?.querySelectorAll?.('.queue-item[data-asset-id]') || []
  for (const item of items) {
    if (item.getBoundingClientRect().bottom > queueRect.top + 1) {
      return item
    }
  }
  return null
}

function queueQueueScrollRestore() {
  const queueNode = getQueueScrollNode()
  if (!queueNode) return
  const queueRect = queueNode.getBoundingClientRect()
  const anchorItem = findQueueAnchorItem(queueNode, queueRect)
  pendingQueueScrollRestore = {
    scrollTop: Math.max(0, queueNode.scrollTop || 0),
    anchorAssetId: anchorItem?.getAttribute('data-asset-id') || '',
    anchorOffset: anchorItem ? (anchorItem.getBoundingClientRect().top - queueRect.top) : 0,
    remainingPasses: 3,
  }
}

function captureQueueScrollPosition() {
  const queueNode = getQueueScrollNode()
  if (!queueNode) return
  queueViewportState.scrollTop = Math.max(0, queueNode.scrollTop || 0)
  queueViewportState.height = Math.max(0, queueNode.clientHeight || 0)
}

function captureQueueAnchor(queueNode = getQueueScrollNode()) {
  if (!queueNode) return null
  const queueRect = queueNode.getBoundingClientRect()
  const anchorItem = findQueueAnchorItem(queueNode, queueRect)
  if (!anchorItem) {
    return {
      assetId: '',
      offset: 0,
      scrollTop: Math.max(0, queueNode.scrollTop || 0),
    }
  }
  return {
    assetId: anchorItem.getAttribute('data-asset-id') || '',
    offset: anchorItem.getBoundingClientRect().top - queueRect.top,
    scrollTop: Math.max(0, queueNode.scrollTop || 0),
  }
}

function restoreQueueAnchor(anchor, queueNode = getQueueScrollNode()) {
  if (!anchor || !queueNode) return
  const queueRect = queueNode.getBoundingClientRect()
  if (anchor.assetId) {
    const anchorItem = queueNode.querySelector(`.queue-item[data-asset-id="${CSS.escape(anchor.assetId)}"]`)
    if (anchorItem) {
      const nextOffset = anchorItem.getBoundingClientRect().top - queueRect.top
      queueNode.scrollTop += nextOffset - (Number(anchor.offset) || 0)
    } else {
      queueNode.scrollTop = Number(anchor.scrollTop) || 0
    }
  } else {
    queueNode.scrollTop = Number(anchor.scrollTop) || 0
  }
  queueViewportState.scrollTop = Math.max(0, queueNode.scrollTop || 0)
  queueViewportState.height = Math.max(0, queueNode.clientHeight || 0)
}

function blurFocusedQueueSortControl() {
  const activeElement = document.activeElement
  if (!activeElement?.closest?.('.queue-item__controls')) return
  if (!activeElement?.matches?.('[data-action="move-asset"], .queue-item__drag')) return
  activeElement.blur()
}

function restoreQueuedQueueScroll(state) {
  if (!pendingQueueScrollRestore) return
  if (getAppShellMode(state) !== 'workspace') return
  const queueNode = getQueueScrollNode()
  if (!queueNode) return
  const queueRect = queueNode.getBoundingClientRect()
  const anchorAssetId = pendingQueueScrollRestore.anchorAssetId || ''
  const anchorOffset = Number(pendingQueueScrollRestore.anchorOffset) || 0
  if (anchorAssetId) {
    const anchorItem = queueNode.querySelector(`.queue-item[data-asset-id="${CSS.escape(anchorAssetId)}"]`)
    if (anchorItem) {
      const nextOffset = anchorItem.getBoundingClientRect().top - queueRect.top
      queueNode.scrollTop += nextOffset - anchorOffset
    } else {
      queueNode.scrollTop = pendingQueueScrollRestore.scrollTop
    }
  } else {
    queueNode.scrollTop = pendingQueueScrollRestore.scrollTop
  }
  queueViewportState.scrollTop = Math.max(0, queueNode.scrollTop || 0)
  queueViewportState.height = Math.max(0, queueNode.clientHeight || 0)
  if ((pendingQueueScrollRestore.remainingPasses || 1) <= 1) {
    pendingQueueScrollRestore = null
  } else {
    pendingQueueScrollRestore.remainingPasses -= 1
  }
}

function patchQueueItemsForToolChange(state) {
  const root = getRootNode('queue')
  if (!root) return false
  const tool = TOOL_MAP[state.activeTool]
  if (!tool) return false
  const layoutFlags = getQueueLayoutFlags(state)
  const { compactLayout } = layoutFlags
  let changed = false

  const expectedRootClassName = buildQueueClassName(layoutFlags)
  if (root.className !== expectedRootClassName) {
    root.className = expectedRootClassName
    changed = true
  }

  root.querySelectorAll('.queue-item[data-asset-id]').forEach((item) => {
    const assetId = item.getAttribute('data-asset-id') || ''
    const assetIndex = getAssetIndexById(assetId)
    if (assetIndex === -1) return
    const asset = state.assets[assetIndex]
    const fragments = getQueueItemRenderSignatures(asset, tool, state, assetIndex, state.assets.length, compactLayout)
    const expectedItemClassName = buildQueueItemClassName(fragments.itemClassName, layoutFlags)
    const expectedDraggable = fragments.draggable ? 'true' : null
    let nextFragments = null
    if (item.className !== expectedItemClassName) {
      item.className = expectedItemClassName
      changed = true
    }
    if ((item.getAttribute('draggable') || null) !== expectedDraggable) {
      if (expectedDraggable) item.setAttribute('draggable', expectedDraggable)
      else item.removeAttribute('draggable')
      changed = true
    }
    const content = item.querySelector('.queue-item__content')
    if (content && content.dataset.renderSignature !== fragments.contentSignature) {
      nextFragments = nextFragments || renderQueueItemFragments(asset, tool, state, assetIndex, state.assets.length, compactLayout, true)
      content.innerHTML = nextFragments.contentMarkup
      content.dataset.renderSignature = nextFragments.contentSignature
      changed = true
    }
    const controls = item.querySelector('.queue-item__controls')
    if (controls && controls.dataset.renderSignature !== fragments.controlsSignature) {
      nextFragments = nextFragments || renderQueueItemFragments(asset, tool, state, assetIndex, state.assets.length, compactLayout, true)
      controls.innerHTML = nextFragments.controlsMarkup
      controls.dataset.renderSignature = nextFragments.controlsSignature
      changed = true
    }
  })

  return changed
}

function patchQueueOrderInPlace(state) {
  const root = getRootNode('queue')
  if (!root) return false
  const queueList = root.querySelector('.queue-list')
  if (!queueList) return false
  const anchor = captureQueueAnchor(queueList)
  const previousScrollLeft = Math.max(0, queueList.scrollLeft || 0)
  if (patchAdjacentQueueMoveInPlace(queueList, state)) {
    queueList.scrollLeft = previousScrollLeft
    restoreQueueAnchor(anchor, queueList)
    rootMarkupCache.queue = renderImageQueue(state, null)
    queueMarkupCacheDirty = false
    return true
  }
  const currentItems = queueList.querySelectorAll('.queue-item[data-asset-id]')
  if (currentItems.length !== state.assets.length) return false
  const itemMap = new Map()
  for (let index = 0; index < currentItems.length; index += 1) {
    const item = currentItems[index]
    itemMap.set(item.getAttribute('data-asset-id') || '', item)
  }
  const orderedItems = []
  for (const asset of state.assets) {
    const item = itemMap.get(asset?.id || '')
    if (!item) return false
    orderedItems.push(item)
  }
  for (let index = orderedItems.length - 1; index >= 0; index -= 1) {
    const expectedItem = orderedItems[index]
    const currentItem = queueList.children[index] || null
    if (currentItem !== expectedItem) {
      queueList.insertBefore(expectedItem, currentItem ? currentItem.nextSibling : null)
    }
  }
  queueList.scrollLeft = previousScrollLeft
  patchQueueSortControlsInPlace(queueList, state)
  restoreQueueAnchor(anchor, queueList)
  rootMarkupCache.queue = renderImageQueue(state, null)
  queueMarkupCacheDirty = false
  return true
}

function patchQueueSortControlsInPlace(queueList, state) {
  const layoutFlags = getQueueLayoutFlags(state)
  const items = queueList.querySelectorAll('.queue-item[data-asset-id]')
  for (let index = 0; index < items.length; index += 1) {
    const item = items[index]
    item.className = buildQueueItemClassName('queue-item queue-item--sortable', layoutFlags)
    item.setAttribute('draggable', 'true')
    const upButton = item.querySelector('[data-action="move-asset"][data-direction="up"]')
    const downButton = item.querySelector('[data-action="move-asset"][data-direction="down"]')
    if (upButton) upButton.toggleAttribute('disabled', index === 0)
    if (downButton) downButton.toggleAttribute('disabled', index === items.length - 1)
  }
}

function patchAdjacentQueueMoveInPlace(queueList, state) {
  if (!pendingAdjacentQueueMove) return false
  const { assetId, direction } = pendingAdjacentQueueMove
  pendingAdjacentQueueMove = null
  const item = queueList.querySelector(`.queue-item[data-asset-id="${CSS.escape(String(assetId))}"]`)
  if (!item) return false
  if (direction === 'down') {
    const nextItem = item.nextElementSibling
    if (!nextItem?.matches?.('.queue-item[data-asset-id]')) return false
    queueList.insertBefore(nextItem, item)
    patchQueueSortControlsInPlace(queueList, state)
    return true
  }
  if (direction === 'up') {
    const previousItem = item.previousElementSibling
    if (!previousItem?.matches?.('.queue-item[data-asset-id]')) return false
    queueList.insertBefore(item, previousItem)
    patchQueueSortControlsInPlace(queueList, state)
    return true
  }
  return false
}

function appendQueueItemsInPlace(state, previousAssets) {
  const root = getRootNode('queue')
  if (!root) return false
  const queueList = root.querySelector('.queue-list')
  if (!queueList) return false
  const previousCount = Array.isArray(previousAssets) ? previousAssets.length : 0
  const currentItems = queueList.querySelectorAll('.queue-item[data-asset-id]')
  if (currentItems.length !== previousCount) return false
  const anchor = captureQueueAnchor(queueList)
  const previousScrollLeft = Math.max(0, queueList.scrollLeft || 0)
  const markup = renderQueueItemsMarkup(state, previousCount)
  if (markup) {
    queueList.insertAdjacentHTML('beforeend', markup)
  }
  queueList.scrollLeft = previousScrollLeft
  patchQueueSortControlsInPlace(queueList, state)
  restoreQueueAnchor(anchor, queueList)
  rootMarkupCache.queue = renderImageQueue(state, null)
  queueMarkupCacheDirty = false
  return true
}

function queueQueueItemPatch() {
  if (queueItemPatchFrame) return
  queueItemPatchFrame = requestAnimationFrame(() => {
    queueItemPatchFrame = 0
    const state = getState()
    if (getAppShellMode(state) !== 'workspace') return
    if (patchQueueItemsForToolChange(state)) {
      queueMarkupCacheDirty = true
    }
    restoreQueuedQueueScroll(state)
  })
}

function syncShellFrame(state) {
  const shell = app?.querySelector?.('.app-shell')
  if (!shell) return
  const mode = getAppShellMode(state)
  shell.classList.toggle('app-shell--sidebar-collapsed', !!state.sidebarCollapsed)
  shell.classList.toggle('app-shell--workspace-overlay', mode === 'result' || mode === 'settings')
  shell.classList.toggle('app-shell--processing', !!state.isProcessing)
}

function syncQueueViewportFromDom() {
  const queueNode = getQueueScrollNode()
  if (!queueNode) return false
  const nextHeight = Math.max(0, queueNode.clientHeight || 0)
  const nextScrollTop = Math.max(0, queueNode.scrollTop || 0)
  const changed = Math.abs(queueViewportState.height - nextHeight) > 1
    || Math.abs(queueViewportState.scrollTop - nextScrollTop) > 1
  queueViewportState.height = nextHeight
  queueViewportState.scrollTop = nextScrollTop
  return changed
}

function renderQueueRoot(state, preserveScroll = true) {
  const root = getRootNode('queue')
  if (!root) return { root: null, changed: false }
  const currentQueueNode = getQueueScrollNode()
  const previousScrollTop = preserveScroll
    ? Math.max(0, currentQueueNode?.scrollTop ?? queueViewportState.scrollTop ?? 0)
    : 0
  const markup = renderImageQueue(state, queueViewportState)
  let changed = false
  if (queueMarkupCacheDirty || rootMarkupCache.queue !== markup) {
    patchQueueRootMarkup(root, markup)
    rootMarkupCache.queue = markup
    queueMarkupCacheDirty = false
    changed = true
  }
  const queueNode = getQueueScrollNode()
  if (queueNode && preserveScroll) {
    queueNode.scrollTop = previousScrollTop
    queueViewportState.scrollTop = Math.max(0, queueNode.scrollTop || 0)
  }
  syncQueueViewportFromDom()
  lastQueueViewportRenderSignature = shouldTrackQueueViewport(state)
    ? getQueueViewportRenderSignature(state, queueViewportState)
    : ''
  return { root, changed }
}

function getWorkspaceTooltipRoot(mode = getAppShellMode(getState())) {
  const workspaceRoot = getRootNode('workspace')
  if (!workspaceRoot) return null
  if (mode !== 'workspace') return workspaceRoot
  return workspaceRoot.querySelector('.panel') || workspaceRoot
}

function scheduleQueueRootRender() {
  if (queueRenderFrame) return
  const state = getState()
  if (shouldTrackQueueViewport(state)) {
    const nextSignature = getQueueViewportRenderSignature(state, queueViewportState)
    if (nextSignature && nextSignature === lastQueueViewportRenderSignature) return
  }
  queueRenderFrame = requestAnimationFrame(() => {
    queueRenderFrame = 0
    const state = getState()
    if (!shouldTrackQueueViewport(state)) return
    const { root, changed } = renderQueueRoot(state)
    queuePostRenderWork({
      snapshot: null,
      activeTool: state.activeTool,
      queueChanged: changed,
      toolbarChanged: false,
      marqueeChanged: false,
      tooltipRoots: [],
    })
  })
}

function shouldPatchQueueInPlace(diff, prevSnapshot, nextSnapshot, state) {
  if (nextSnapshot.mode !== 'workspace' || diff.previousMode !== 'workspace') return false
  if (diff.toolChanged || diff.modeChanged) return false
  if (!hasSameAssetOrder(prevSnapshot.assets, state.assets)) return false
  return prevSnapshot.assets !== nextSnapshot.assets || prevSnapshot.isProcessing !== nextSnapshot.isProcessing
}

function shouldPatchQueueOrderInPlace(diff, prevSnapshot, nextSnapshot, state) {
  if (nextSnapshot.mode !== 'workspace' || diff.previousMode !== 'workspace') return false
  if (diff.toolChanged || diff.modeChanged) return false
  if (TOOL_MAP[state.activeTool]?.mode !== 'sort') return false
  if (hasSameAssetOrder(prevSnapshot.assets, state.assets)) return false
  return hasSameAssetSet(prevSnapshot.assets, state.assets)
}

function shouldAppendQueueItemsInPlace(diff, prevSnapshot, nextSnapshot, state) {
  if (nextSnapshot.mode !== 'workspace' || diff.previousMode !== 'workspace') return false
  if (diff.toolChanged || diff.modeChanged) return false
  if (TOOL_MAP[state.activeTool]?.mode !== 'sort') return false
  return hasAssetOrderPrefix(prevSnapshot.assets, state.assets)
}

function canPatchShell(prev, next) {
  if (!prev) return false
  if (prev.mode === 'manual' || next.mode === 'manual') return false
  return !!app?.querySelector?.('.app-shell')
}

function shouldCaptureSnapshotForFullShell(prev, next) {
  if (!prev || !next) return false
  if (prev.mode === 'manual' || next.mode === 'manual') return false
  return true
}

function getAssetOrderSignature(assets = []) {
  if (!Array.isArray(assets) || !assets.length) return ''
  let signature = ''
  for (let index = 0; index < assets.length; index += 1) {
    if (index) signature += '|'
    signature += String(assets[index]?.id || '')
  }
  return signature
}

function renderFullShell(state, snapshot) {
  const mode = getAppShellMode(state)
  const shouldReuseDetachedQueue = mode === 'workspace' && canReuseDetachedQueueContent(state)
  const queueMarkup = mode === 'workspace'
    ? (shouldReuseDetachedQueue
        ? ''
        : renderImageQueue(state, shouldTrackQueueViewport(state) ? queueViewportState : null))
    : null
  app.innerHTML = renderAppShell(state, queueMarkup) + renderNotificationsRoot(state.notifications)
  const sideNavRoot = getRootNode('side-nav')
  const topbarRoot = getRootNode('topbar')
  const workspaceRoot = getRootNode('workspace')
  const panelRoot = getRootNode('panel')
  const queueRoot = getRootNode('queue')
  const overlaysRoot = getRootNode('overlays')
  const notificationsRoot = getRootNode('notifications')
  let queueTooltipRoot = null
  if (shouldReuseDetachedQueue) {
    if (attachDetachedQueueContent(state)) {
      if (patchQueueItemsForToolChange(state) && queueRoot) {
        queueTooltipRoot = queueRoot
      }
    } else if (mode === 'workspace') {
      detachedQueueContent = null
      detachedQueueState = null
      renderQueueRoot(state, false)
    }
  }
  restoreQueuedQueueScroll(state)
  const queueViewportChanged = mode === 'workspace'
    && shouldTrackQueueViewport(state)
    && syncQueueViewportFromDom()
  rootMarkupCache.sideNav = sideNavRoot?.innerHTML || ''
  rootMarkupCache.topbar = topbarRoot?.innerHTML || ''
  rootMarkupCache.workspace = workspaceRoot?.innerHTML || ''
  rootMarkupCache.panel = panelRoot?.innerHTML || ''
  rootMarkupCache.queue = mode === 'workspace' && !shouldReuseDetachedQueue
    ? (queueMarkup || '')
    : ''
  queueMarkupCacheDirty = mode === 'workspace' && shouldReuseDetachedQueue
  lastQueueViewportRenderSignature = shouldTrackQueueViewport(state)
    ? getQueueViewportRenderSignature(state, queueViewportState)
    : ''
  rootMarkupCache.overlays = overlaysRoot?.innerHTML || ''
  rootMarkupCache.notifications = notificationsRoot?.innerHTML || ''
  queuePostRenderWork({
    snapshot,
    activeTool: state.activeTool,
    queueChanged: queueViewportChanged,
    toolbarChanged: Boolean(state.activeRun || state.resultView),
    marqueeChanged: mode === 'result',
    tooltipRoots: [sideNavRoot, topbarRoot, panelRoot || workspaceRoot, queueTooltipRoot, overlaysRoot, notificationsRoot].filter(Boolean),
  })
}

function render(state) {
  const nextSnapshot = captureRenderSnapshot(state)
  const fullShellChange = !canPatchShell(lastRenderSnapshot, nextSnapshot)
  if (fullShellChange) {
    if (lastRenderSnapshot?.mode === 'workspace' && nextSnapshot.mode === 'manual') {
      detachQueueContent(lastRenderSnapshot)
    }
    const snapshot = shouldCaptureSnapshotForFullShell(lastRenderSnapshot, nextSnapshot)
      ? captureUiSnapshot()
      : null
    renderFullShell(state, snapshot)
    lastRenderSnapshot = nextSnapshot
    return
  }

  const diff = diffRenderSnapshot(lastRenderSnapshot, nextSnapshot)
  const progressOnlyTopbarChange = diff.topbarChanged
    && !diff.shellFrameChanged
    && !diff.sideNavChanged
    && !diff.workspaceChanged
    && !diff.overlaysChanged
    && !diff.notificationsChanged
    && !diff.toolbarChanged
    && !diff.queueChanged
    && !diff.marqueeChanged
  if (progressOnlyTopbarChange) {
    syncTopBarRoot(state, nextSnapshot.mode)
    lastRenderSnapshot = nextSnapshot
    return
  }
  const tooltipRoots = []
  let effectiveQueueChanged = diff.queueChanged
  let shouldCaptureWorkspaceSnapshot = diff.workspaceChanged
  const canPreserveQueueDuringWorkspaceRefresh = diff.previousMode === 'workspace'
    && diff.nextMode === 'workspace'
    && hasSameAssetOrder(lastRenderSnapshot.assets, state.assets)

  if (diff.shellFrameChanged) {
    syncShellFrame(state)
  }
  if (diff.sideNavChanged) {
    const { root, changed } = syncSideNavRoot(state, nextSnapshot.mode)
    if (root && changed) tooltipRoots.push(root)
  }
  if (diff.topbarChanged) {
    const { root, changed } = syncTopBarRoot(state, nextSnapshot.mode)
    if (root && changed) tooltipRoots.push(root)
  }
  if (diff.workspaceChanged) {
    const reuseQueueDuringWorkspaceRefresh = canPreserveQueueDuringWorkspaceRefresh
    if (reuseQueueDuringWorkspaceRefresh) {
      shouldCaptureWorkspaceSnapshot = false
      const { root, changed } = setRootMarkup('panel', renderToolPage(state.activeTool, state))
      if (root && changed) tooltipRoots.push(root)
      queueQueueItemPatch()
      effectiveQueueChanged = false
    } else {
      const shouldReattachQueue = (diff.previousMode !== 'workspace' && diff.nextMode === 'workspace') || reuseQueueDuringWorkspaceRefresh
      if (diff.previousMode === 'workspace' && (diff.nextMode !== 'workspace' || reuseQueueDuringWorkspaceRefresh)) {
        detachQueueContent()
      }
      const workspaceMarkup = renderShellWorkspace(
        state,
        shouldReattachQueue ? '' : renderImageQueue(state, queueViewportState),
        nextSnapshot.mode,
      )
      const { root, changed } = setRootMarkup('workspace', workspaceMarkup)
      const attachedDetachedQueue = root && shouldReattachQueue ? attachDetachedQueueContent() : false
      if (shouldReattachQueue && !attachedDetachedQueue) {
        renderQueueRoot(state, false)
      } else if (shouldReattachQueue) {
        queueQueueItemPatch()
        effectiveQueueChanged = false
      }
      const tooltipRoot = root && changed ? getWorkspaceTooltipRoot(nextSnapshot.mode) : null
      if (tooltipRoot) tooltipRoots.push(tooltipRoot)
    }
  } else if (diff.queueChanged && nextSnapshot.mode === 'workspace') {
    const shouldAppendQueue = shouldAppendQueueItemsInPlace(diff, lastRenderSnapshot, nextSnapshot, state)
    const shouldPatchQueueOrder = shouldPatchQueueOrderInPlace(diff, lastRenderSnapshot, nextSnapshot, state)
    const shouldPatchQueue = !shouldAppendQueue && !shouldPatchQueueOrder && shouldPatchQueueInPlace(diff, lastRenderSnapshot, nextSnapshot, state)
    if (shouldAppendQueue) {
      if (appendQueueItemsInPlace(state, lastRenderSnapshot.assets)) {
        effectiveQueueChanged = false
      } else {
        const { root, changed } = renderQueueRoot(state)
        if (!changed) {
          queuePostRenderWork({
            snapshot: null,
            activeTool: state.activeTool,
            queueChanged: false,
            toolbarChanged: diff.toolbarChanged,
            marqueeChanged: diff.marqueeChanged,
            tooltipRoots,
          })
          lastRenderSnapshot = nextSnapshot
          return
        }
      }
    } else if (shouldPatchQueueOrder) {
      if (patchQueueOrderInPlace(state)) {
        effectiveQueueChanged = false
      } else {
        const { root, changed } = renderQueueRoot(state)
        if (!changed) {
          queuePostRenderWork({
            snapshot: null,
            activeTool: state.activeTool,
            queueChanged: false,
            toolbarChanged: diff.toolbarChanged,
            marqueeChanged: diff.marqueeChanged,
            tooltipRoots,
          })
          lastRenderSnapshot = nextSnapshot
          return
        }
      }
    } else if (shouldPatchQueue) {
      queueQueueItemPatch()
      effectiveQueueChanged = false
    } else {
      const { root, changed } = renderQueueRoot(state)
      if (!changed) {
        queuePostRenderWork({
          snapshot: null,
          activeTool: state.activeTool,
          queueChanged: false,
          toolbarChanged: diff.toolbarChanged,
          marqueeChanged: diff.marqueeChanged,
          tooltipRoots,
        })
        lastRenderSnapshot = nextSnapshot
        return
      }
    }
  }
  if (diff.overlaysChanged) {
    const { root, changed } = setRootMarkup('overlays', renderShellOverlays(state))
    if (root && changed) tooltipRoots.push(root)
  }
  if (diff.notificationsChanged) {
    setRootMarkup('notifications', renderNotifications(state.notifications))
  }

  restoreQueuedQueueScroll(state)

  queuePostRenderWork({
    snapshot: shouldCaptureWorkspaceSnapshot ? captureUiSnapshot() : null,
    activeTool: state.activeTool,
    queueChanged: effectiveQueueChanged || (diff.workspaceChanged && diff.previousMode !== 'workspace'),
    toolbarChanged: diff.toolbarChanged,
    marqueeChanged: diff.marqueeChanged,
    tooltipRoots,
  })
  lastRenderSnapshot = nextSnapshot
}

function queuePostRenderWork(work) {
  if (pendingPostRenderWork) {
    const mergedTooltipRoots = []
    const mergedTooltipRootSet = new Set()
    for (const root of pendingPostRenderWork.tooltipRoots || []) {
      if (!root || mergedTooltipRootSet.has(root)) continue
      mergedTooltipRootSet.add(root)
      mergedTooltipRoots.push(root)
    }
    for (const root of work.tooltipRoots || []) {
      if (!root || mergedTooltipRootSet.has(root)) continue
      mergedTooltipRootSet.add(root)
      mergedTooltipRoots.push(root)
    }
    pendingPostRenderWork = {
      snapshot: work.snapshot || pendingPostRenderWork.snapshot || null,
      activeTool: work.activeTool || pendingPostRenderWork.activeTool,
      queueChanged: Boolean(pendingPostRenderWork.queueChanged || work.queueChanged),
      toolbarChanged: Boolean(pendingPostRenderWork.toolbarChanged || work.toolbarChanged),
      marqueeChanged: Boolean(pendingPostRenderWork.marqueeChanged || work.marqueeChanged),
      tooltipRoots: mergedTooltipRoots,
    }
  } else {
    pendingPostRenderWork = work
  }
  if (!hasPendingPostRenderEffects(pendingPostRenderWork)) {
    pendingPostRenderWork = null
    return
  }
  if (postRenderFrame) return
  postRenderFrame = requestAnimationFrame(() => {
    postRenderFrame = 0
    const nextWork = pendingPostRenderWork
    pendingPostRenderWork = null
    if (!nextWork) return
    if (nextWork.toolbarChanged) injectResultToolbar()
    if (nextWork.snapshot) restoreUiSnapshot(nextWork.snapshot)
    if ((nextWork.tooltipRoots || []).length) {
      for (const root of nextWork.tooltipRoots || []) {
        syncCustomTooltips(root)
      }
    }
    if (nextWork.marqueeChanged) queueResultMarqueeSync()
    if (nextWork.queueChanged && shouldTrackQueueViewport(getState()) && syncQueueViewportFromDom()) {
      scheduleQueueRootRender()
    }
    if (nextWork.activeTool === 'manual-crop') {
      queueManualCropStageSync()
    }
  })
}

function hasPendingPostRenderEffects(work) {
  if (!work) return false
  if (work.snapshot || work.queueChanged || work.toolbarChanged || work.marqueeChanged) return true
  if (Array.isArray(work.tooltipRoots) && work.tooltipRoots.length > 0) return true
  return work.activeTool === 'manual-crop'
}

function isEditableTarget(target) {
  if (!target) return false
  const tagName = String(target.tagName || '').toLowerCase()
  return tagName === 'input' || tagName === 'textarea' || target.isContentEditable
}

function ensureTooltipElement() {
  if (tooltipElement?.isConnected) return tooltipElement
  tooltipElement = document.createElement('div')
  tooltipElement.className = 'app-tooltip'
  tooltipElement.hidden = true
  document.body.append(tooltipElement)
  return tooltipElement
}

function syncCustomTooltips(root = app) {
  if (!root) return
  const hasDirectTitle = root.matches?.('[title]:not([data-tooltip])')
  const hasNestedTitle = root.querySelector?.('[title]:not([data-tooltip])')
  if (!hasDirectTitle && !hasNestedTitle) return
  const applyTooltip = (node) => {
    const text = String(node.getAttribute('title') || '').trim()
    if (!text) return
    node.dataset.tooltip = text
    if (!node.getAttribute('aria-label') && node.matches('button, [role="button"]')) {
      node.setAttribute('aria-label', text)
    }
    node.removeAttribute('title')
  }
  if (hasDirectTitle) applyTooltip(root)
  root.querySelectorAll?.('[title]:not([data-tooltip])').forEach(applyTooltip)
}

function positionTooltip(target) {
  if (!target || !tooltipElement || tooltipElement.hidden) return
  const rect = target.getBoundingClientRect()
  const tooltipRect = tooltipElement.getBoundingClientRect()
  const top = Math.max(8, rect.top - tooltipRect.height - 10)
  const left = Math.min(
    window.innerWidth - tooltipRect.width - 8,
    Math.max(8, rect.left + (rect.width - tooltipRect.width) / 2),
  )
  tooltipElement.style.top = `${top}px`
  tooltipElement.style.left = `${left}px`
}

function showTooltip(target) {
  const text = String(target?.dataset?.tooltip || '').trim()
  if (!text) return
  if (target?.closest?.('.nav-item') && !document.querySelector('.app-shell')?.classList.contains('app-shell--sidebar-collapsed')) {
    return
  }
  if (target?.dataset?.tooltipOverflow === 'true' && target.scrollWidth <= target.clientWidth + 1) {
    return
  }
  activeTooltipTarget = target
  const tooltip = ensureTooltipElement()
  tooltip.textContent = text
  tooltip.hidden = false
  positionTooltip(target)
}

function hideTooltip(target = activeTooltipTarget) {
  if (target && activeTooltipTarget && target !== activeTooltipTarget) return
  activeTooltipTarget = null
  if (tooltipElement) tooltipElement.hidden = true
}

function attachProcessingProgressEvents() {
  if (typeof window === 'undefined' || attachProcessingProgressEvents.bound) return
  window.addEventListener('imgbatch-processing-progress', (event) => {
    const detail = event?.detail || null
    if (!detail) return
    queueProcessingProgressState(detail)
  })
  attachProcessingProgressEvents.bound = true
}

function queueProcessingProgressState(detail) {
  pendingProcessingProgress = detail?.phase === 'finish'
    ? null
    : {
        phase: detail.phase || 'progress',
        runId: detail.runId || '',
        toolId: detail.toolId || '',
        toolLabel: detail.toolLabel || '',
        mode: detail.mode || 'direct',
        total: Number(detail.total) || 0,
        completed: Number(detail.completed) || 0,
        succeeded: Number(detail.succeeded) || 0,
        failed: Number(detail.failed) || 0,
        startedAt: Number(detail.startedAt) || Date.now(),
      }
  if (processingProgressFrame) return
  processingProgressFrame = requestAnimationFrame(() => {
    processingProgressFrame = 0
    const nextProgress = pendingProcessingProgress
    pendingProcessingProgress = undefined
    const currentProgress = getState().processingProgress
    if (isSameProcessingProgress(currentProgress, nextProgress)) return
    setState({ processingProgress: nextProgress })
  })
}

function isSameProcessingProgress(currentProgress, nextProgress) {
  if (currentProgress === nextProgress) return true
  if (!currentProgress || !nextProgress) return !currentProgress && !nextProgress
  return currentProgress.phase === nextProgress.phase
    && currentProgress.runId === nextProgress.runId
    && currentProgress.toolId === nextProgress.toolId
    && currentProgress.mode === nextProgress.mode
    && currentProgress.total === nextProgress.total
    && currentProgress.completed === nextProgress.completed
    && currentProgress.succeeded === nextProgress.succeeded
    && currentProgress.failed === nextProgress.failed
}

function attachQueueThumbnailSubscription() {
  subscribeQueueThumbnails(({ assetId, listThumbnailUrl }) => {
    if (!assetId || !listThumbnailUrl) return
    updateAssetListThumbnail(assetId, listThumbnailUrl, false)
    queueQueueThumbnailPatch(assetId, listThumbnailUrl)
  })
}

function queueQueueThumbnailPatch(assetId, listThumbnailUrl) {
  pendingQueueThumbnailPatches.set(String(assetId), listThumbnailUrl)
  if (queueThumbnailPatchFrame) return
  queueThumbnailPatchFrame = requestAnimationFrame(() => {
    queueThumbnailPatchFrame = 0
    flushQueueThumbnailPatches()
  })
}

function flushQueueThumbnailPatches() {
  if (!pendingQueueThumbnailPatches.size) return
  let itemMap = null
  if (pendingQueueThumbnailPatches.size > 4) {
    itemMap = new Map()
    app?.querySelectorAll?.('.queue-item[data-asset-id]').forEach((item) => {
      const assetId = item.getAttribute('data-asset-id') || ''
      if (assetId) itemMap.set(assetId, item)
    })
  }
  for (const [assetId, listThumbnailUrl] of pendingQueueThumbnailPatches.entries()) {
    patchQueueThumbnail(itemMap?.get(String(assetId)) || null, assetId, listThumbnailUrl)
  }
  pendingQueueThumbnailPatches.clear()
}

function patchQueueThumbnail(item, assetId, listThumbnailUrl) {
  if (!item) {
    item = app?.querySelector?.(`.queue-item[data-asset-id="${CSS.escape(String(assetId))}"]`)
  }
  const thumb = item?.querySelector?.('.queue-item__thumb')
  if (!thumb) return
  const current = thumb.querySelector('img')
  if (current) {
    if (current.getAttribute('src') !== listThumbnailUrl) current.setAttribute('src', listThumbnailUrl)
    return
  }
  const image = document.createElement('img')
  image.src = listThumbnailUrl
  image.alt = item?.querySelector?.('.queue-item__title')?.textContent?.trim() || ''
  image.loading = 'lazy'
  image.decoding = 'async'
  image.fetchPriority = 'low'
  image.draggable = false
  image.width = 96
  image.height = 72
  thumb.replaceChildren(image)
}

function attachLaunchSubscription() {
  subscribeLaunchInputs(async (values) => {
    try {
      const assets = await getLaunchInputs({
        pendingValues: values,
        includeCopiedFiles: true,
        requirePending: true,
      })
      appendImportedAssets(assets, '已带入')
    } catch (error) {
      notify({ type: 'error', message: error?.message || '读取启动图片失败。' })
    }
  })
}

function stopLaunchInputRetryWindow() {
  if (launchInputRetryTimer) {
    clearInterval(launchInputRetryTimer)
    launchInputRetryTimer = null
  }
  launchInputRetryDeadline = 0
  launchInputRetryStartedAt = 0
}

function startLaunchInputRetryWindow(reason = 'unknown', durationMs = LAUNCH_INPUT_RETRY_WINDOW_MS) {
  launchInputRetryStartedAt = Date.now()
  launchInputRetryDeadline = launchInputRetryStartedAt + Math.max(0, Number(durationMs) || 0)
  if (typeof window !== 'undefined' && window.imgbatch?.appendLaunchDebugLog) {
    window.imgbatch.appendLaunchDebugLog('launch-input-retry-window-started', {
      reason,
      startedAt: launchInputRetryStartedAt,
      deadline: launchInputRetryDeadline,
      intervalMs: LAUNCH_INPUT_RETRY_INTERVAL_MS,
      windowMs: Math.max(0, Number(durationMs) || 0),
    })
  }
  if (launchInputRetryTimer) return
  launchInputRetryTimer = setInterval(() => {
    void retryLaunchInputs()
  }, LAUNCH_INPUT_RETRY_INTERVAL_MS)
}

async function retryLaunchInputs() {
  if (launchInputRetryInFlight) return
  if (Date.now() >= launchInputRetryDeadline) {
    stopLaunchInputRetryWindow()
    return
  }
  launchInputRetryInFlight = true
  try {
    const assets = await getLaunchInputs({
      includeCopiedFiles: true,
      requirePending: true,
      minClipboardTimestamp: launchInputRetryStartedAt,
    })
    if (assets?.length) {
      appendImportedAssets(assets, '已带入')
      stopLaunchInputRetryWindow()
    }
  } catch {
    if (Date.now() >= launchInputRetryDeadline) {
      stopLaunchInputRetryWindow()
    }
  } finally {
    launchInputRetryInFlight = false
  }
}

async function bootstrapLaunchInputs() {
  const startTime = Date.now()
  const deadline = startTime + 10000
  while (true) {
    try {
      const assets = await getLaunchInputs({
        includeCopiedFiles: true,
        requirePending: true,
      })
      if (assets?.length) {
        appendImportedAssets(assets, '已带入')
        return
      }
    } catch (error) {
      if (Date.now() >= deadline) {
        notify({ type: 'error', message: error?.message || '读取启动图片失败。' })
        return
      }
    }
    if (Date.now() >= deadline) return
    await new Promise((resolve) => setTimeout(resolve, 250))
  }
}

function appendImportedAssets(assets, verb = '已导入') {
  if (!assets?.length) return
  const appendedCount = appendAssets(assets)
  if (typeof window !== 'undefined' && window.imgbatch?.appendLaunchDebugLog) {
    window.imgbatch.appendLaunchDebugLog('append-imported-assets', {
      receivedCount: assets.length,
      appendedCount,
      sourcePaths: assets.slice(0, 12).map((asset) => String(asset?.sourcePath || '')),
    })
  }
  if (!appendedCount) return
  startLaunchInputRetryWindow('post-import', LAUNCH_INPUT_POST_IMPORT_RETRY_WINDOW_MS)
  notify({ type: 'success', message: `${verb} ${appendedCount} 张图片。` })
}

function captureUiSnapshot() {
  const activeElement = document.activeElement
  const activeField = activeElement?.matches?.('[data-action][data-tool-id][data-key], [data-role="search-input"], [data-action="change-preset-name"]')
    ? getElementDescriptor(activeElement)
    : null
  const scrollTopByRole = []
  const scrollRoots = app?.querySelectorAll?.('[data-scroll-role]') || []
  for (const node of scrollRoots) {
    const role = node.getAttribute('data-scroll-role')
    if (role === 'queue') continue
    scrollTopByRole.push({
      role,
      scrollTop: node.scrollTop,
    })
  }
  return {
    windowScrollY: window.scrollY,
    scrollTopByRole,
    activeField,
    selection: activeField && activeElement && 'selectionStart' in activeElement
      ? {
          start: activeElement.selectionStart,
          end: activeElement.selectionEnd,
        }
      : null,
  }
}

function restoreUiSnapshot(snapshot) {
  if (typeof snapshot?.windowScrollY === 'number') {
    if (Math.abs(window.scrollY - snapshot.windowScrollY) > 1) {
      window.scrollTo({ top: snapshot.windowScrollY })
    }
  }

  for (const item of snapshot?.scrollTopByRole || []) {
    const node = app?.querySelector?.(`[data-scroll-role="${item.role}"]`)
    if (node && Math.abs(node.scrollTop - item.scrollTop) > 1) node.scrollTop = item.scrollTop
  }

  if (!snapshot?.activeField) return
  const target = findElementByDescriptor(snapshot.activeField)
  if (!target) return
  if (document.activeElement === target) return
  target.focus({ preventScroll: true })
  const selectionCapableTypes = new Set(['text', 'search', 'url', 'tel', 'password'])
  const inputType = String(target.type || '').toLowerCase()
  const canRestoreSelection = 'setSelectionRange' in target
    && (!inputType || selectionCapableTypes.has(inputType) || target.tagName === 'TEXTAREA')
  if (snapshot.selection && canRestoreSelection) {
    target.setSelectionRange(snapshot.selection.start, snapshot.selection.end)
  }
}

function getElementDescriptor(element) {
  return {
    action: element.dataset.action || '',
    role: element.dataset.role || '',
    toolId: element.dataset.toolId || '',
    key: element.dataset.key || '',
    value: element.value ?? '',
  }
}

function findElementByDescriptor(descriptor) {
  if (descriptor.role === 'search-input') {
    return document.querySelector('[data-role="search-input"]')
  }

  if (descriptor.action === 'change-preset-name') {
    return document.querySelector('[data-action="change-preset-name"]')
  }

  const selector = `[data-action="${descriptor.action}"][data-tool-id="${descriptor.toolId}"][data-key="${descriptor.key}"]`
  const candidates = document.querySelectorAll(selector)
  let fallback = null
  for (let index = 0; index < candidates.length; index += 1) {
    const element = candidates[index]
    if (!fallback) fallback = element
    if ((element.value ?? '') === descriptor.value) return element
  }
  return fallback
}

function canImportFromEvent(event) {
  const types = Array.from(event.dataTransfer?.types || [])
  return types.includes('Files')
}

function getDropSurface(event) {
  return event.target.closest('[data-role="drop-surface"]') || document.querySelector('[data-role="drop-surface"]')
}

function extractDroppedItems(event) {
  const files = Array.from(event.dataTransfer?.files || [])
  if (files.length) return files

  const entries = Array.from(event.dataTransfer?.items || [])
    .map((item) => item.getAsFile?.())
    .filter(Boolean)
  return entries
}

function attachGlobalEvents() {
  document.addEventListener('wheel', (event) => {
    const previewCompareBody = event.target.closest('.preview-modal__body--compare')
    const previewSplitBody = event.target.closest('.preview-modal__body--split')
    if (previewCompareBody || previewSplitBody) {
      const preview = getState().previewModal
      if (preview?.url) {
        event.preventDefault()
        const currentZoom = Number.isFinite(Number(preview.compareZoom)) ? Number(preview.compareZoom) : 1
        const delta = event.deltaY < 0 ? 0.12 : -0.12
        setPreviewCompareZoom(currentZoom + delta)
        return
      }
    }
    if (handleManualCropWheel(event, {
      getState,
      queueManualCropConfigUpdate,
    })) return
    const scroller = event.target.closest('[data-horizontal-scroll]')
    if (!scroller) return
    if (scroller.scrollWidth <= scroller.clientWidth) return
    if (Math.abs(event.deltaY) <= Math.abs(event.deltaX) && !event.shiftKey) return
    scroller.scrollLeft += event.shiftKey ? (event.deltaX || event.deltaY) : event.deltaY
    event.preventDefault()
  }, { passive: false })

  document.addEventListener('pointerdown', (event) => {
    const target = event.target.closest('[data-action]')
    if (!target) return
    const { action } = target.dataset
    if (action === 'drag-color-surface') {
      beginColorPickerDrag(event, target, 'surface')
      return
    }
    if (action === 'drag-color-hue') {
      beginColorPickerDrag(event, target, 'hue')
    }
  })

  document.addEventListener('pointerdown', (event) => {
    const previewBody = event.target.closest('.preview-modal__body--compare, .preview-modal__body--split')
    const preview = getState().previewModal
    if (previewBody && preview?.compareMode === 'split' && (event.button === 0 || event.button === 2)) {
      beginPreviewComparePan(event)
      return
    }
    if (previewBody && event.button === 2) {
      beginPreviewComparePan(event)
      return
    }
    const target = event.target.closest('[data-action]')
    const manualCropPreview = event.target.closest('[data-role="manual-crop-preview"], [data-role="manual-crop-stage"]')
    if (manualCropPreview && event.button === 2 && getState().activeTool === 'manual-crop') {
      beginManualCropPan(event, manualCropPreview, {
        getState,
      })
      return
    }
    if (!target) return
    if (target.dataset.action === 'move-asset' && event.button === 0) {
      event.preventDefault()
    }
    if (target.dataset.action === 'drag-preview-compare') {
      beginPreviewCompareDrag(event, target)
      return
    }
    if (target.dataset.action === 'drag-rotate') {
      beginRotateDrag(event, target)
      return
    }
    if (target.dataset.action === 'manual-crop-drag' || target.dataset.action === 'manual-crop-resize') {
      beginManualCropDrag(event, target, {
        getState,
        getManualCropStageMetrics,
      })
    }
  })

  document.addEventListener('mouseover', (event) => {
    const target = event.target.closest('[data-tooltip]')
    if (!target) return
    showTooltip(target)
  })

  document.addEventListener('mouseout', (event) => {
    const target = event.target.closest('[data-tooltip]')
    if (!target) return
    if (event.relatedTarget?.closest?.('[data-tooltip]') === target) return
    hideTooltip(target)
  })

  document.addEventListener('focusin', (event) => {
    const target = event.target.closest('[data-tooltip]')
    if (target) showTooltip(target)
  })

  document.addEventListener('focusout', (event) => {
    const target = event.target.closest('[data-tooltip]')
    if (target) hideTooltip(target)
  })

  document.addEventListener('click', async (event) => {
    const modalRoot = event.target.closest('.preview-modal')
    if (modalRoot) {
      const clickedCompareBody = !!event.target.closest('.preview-modal__body--compare')
      const clickedSplitBody = !!event.target.closest('.preview-modal__body--split')
      const clickedSplitLabel = !!event.target.closest('.preview-modal__split-label')
      const clickedCloseButton = !!event.target.closest('.preview-modal__close')
      const clickedCompareLabels = !!event.target.closest('.preview-modal__compare-head')
      const clickedHelpPanel = !!event.target.closest('.preview-modal__help')
      if (!clickedCompareBody && !clickedSplitBody && !clickedSplitLabel && !clickedCloseButton && !clickedCompareLabels && !clickedHelpPanel) {
        closePreviewModal()
        return
      }
    }

    if (modalRoot && !event.target.closest('[data-action]')) {
      return
    }

    if (!event.target.closest('.select-shell')) {
      closeAllConfigSelects()
    }

    const target = event.target.closest('[data-action]')
    if (!target) return

    if (target.matches('.nav-item')) {
      event.preventDefault()
    }

    const { action } = target.dataset

    if (action === 'activate-tool') {
      event.preventDefault()
      const previousToolId = getState().activeTool
      if (previousToolId && previousToolId !== target.dataset.toolId) {
        cleanupToolPreviewCache(previousToolId, `action:activate-tool:${previousToolId}->${target.dataset.tool}`)
      }
      queueQueueScrollRestore()
      batchStateUpdates(() => {
        resetActiveResultUi()
        setActiveTool(target.dataset.toolId)
      })
      if (target.dataset.applyDefaultPreset !== 'false') {
        void applyDefaultPresetForTool(target.dataset.toolId, true)
      }
      return
    }

    if (action === 'close-preview-modal') {
      closePreviewModal()
      return
    }

    if (action === 'save-preview-result') {
      await savePreviewResultFromModal()
      return
    }

    if (action === 'toggle-preview-compare-fullscreen') {
      togglePreviewCompareFullscreen()
      return
    }

    if (action === 'toggle-preview-compare-labels') {
      togglePreviewCompareLabels()
      return
    }

    if (action === 'toggle-preview-help') {
      togglePreviewHelp()
      return
    }

    if (action === 'close-result-view') {
      setResultView(null)
      return
    }

    if (action === 'open-settings' || action === 'save-default-path') {
      cleanupToolPreviewCache(getState().activeTool, `action:open-settings:${getState().activeTool}`)
      setSettingsDialog(createSettingsDialogState())
      return
    }

    if (action === 'close-settings-modal') {
      if (event.target.closest('.app-modal__dialog') && !event.target.closest('.app-modal__close')) return
      closeSettingsDialog()
      return
    }

    if (action === 'toggle-sidebar') {
      setState({ sidebarCollapsed: !getState().sidebarCollapsed })
      return
    }

    if (action === 'set-settings-save-mode') {
      updateSettingsDialog({ saveLocationMode: target.dataset.value })
      closeConfigSelect(target)
      return
    }

    if (action === 'set-settings-performance-mode') {
      updateSettingsDialog({ performanceMode: target.dataset.value || 'balanced' })
      closeConfigSelect(target)
      return
    }

    if (action === 'set-settings-queue-thumbnail-size') {
      updateSettingsDialog({ queueThumbnailSize: target.dataset.value || '128' })
      closeConfigSelect(target)
      return
    }

    if (action === 'pick-settings-custom-path') {
      await chooseSettingsCustomPath()
      return
    }

    if (action === 'clear-preview-cache-directory') {
      await clearAllPreviewCacheDirectoryFromSettings()
      return
    }

    if (action === 'save-settings-dialog') {
      await saveSettingsFromDialog()
      return
    }

    if (action === 'toggle-config-select') {
      toggleConfigSelect(target)
      return
    }

    if (action === 'remove-asset') {
      cleanupPreviewCacheByAssetIds([target.dataset.assetId], `action:remove-asset:${target.dataset.assetId}`)
      if (getState().activeTool === 'manual-crop') {
        flushManualCropConfigUpdates()
        const state = getState()
        const assetId = target.dataset.assetId
        const config = state.configs['manual-crop']
        const removeIndex = getAssetIndexById(assetId)
        if (removeIndex !== -1) {
          const nextAssets = [...state.assets]
          nextAssets.splice(removeIndex, 1)
          const cropAreas = { ...(config.cropAreas || {}) }
          delete cropAreas[assetId]
          const completedIds = []
          for (const id of config.completedIds || []) {
            if (id !== assetId) completedIds.push(id)
          }
          const nextIndex = nextAssets.length
            ? Math.min(removeIndex <= config.currentIndex ? Math.max(0, config.currentIndex - 1) : config.currentIndex, nextAssets.length - 1)
            : 0
          const nextAsset = nextAssets[nextIndex] || null
          removeAsset(assetId)
          updateConfig('manual-crop', {
            currentIndex: nextIndex,
            completedIds,
            cropAreas,
            ...getManualCropGlobalTransformPatch(nextAsset, {
              ...config,
              cropAreas,
            }),
          })
          if (!nextAssets.length) {
            setResultView(null)
            startLaunchInputRetryWindow('remove-last-asset')
          }
          notify({ type: 'success', message: '已移除当前图片。' })
          return
        }
      }
      const nextAssetCount = Math.max(0, getState().assets.length - 1)
      removeAsset(target.dataset.assetId)
      startLaunchInputRetryWindow(nextAssetCount ? 'remove-asset' : 'remove-last-asset')
      return
    }

    if (action === 'clear-assets') {
      const assetIds = getState().assets.map((asset) => asset.id)
      cleanupPreviewCacheByAssetIds(assetIds, 'action:clear-assets')
      resetActiveResultUi()
      setState({ assets: [], previewModal: null, resultView: null })
      startLaunchInputRetryWindow('clear-assets')
      return
    }

    if (action === 'move-asset') {
      blurFocusedQueueSortControl()
      pendingAdjacentQueueMove = {
        assetId: target.dataset.assetId || '',
        direction: target.dataset.direction || 'down',
      }
      captureQueueScrollPosition()
      moveAsset(target.dataset.assetId, target.dataset.direction)
      return
    }

    if (action === 'preview-asset') {
      await previewAsset(target.dataset.assetId)
      return
    }

    if (action === 'process-current') {
      await processCurrentTool()
      return
    }

    if (action === 'cancel-current-run') {
      await cancelCurrentRun()
      return
    }

    if (action === 'open-file-input' || action === 'pick-demo') {
      if (typeof window.imgbatch?.showOpenDialog === 'function') {
        await pickInputsFromHost('file')
      } else {
        fileInput.click()
      }
      return
    }

    if (action === 'pick-watermark-image') {
      if (typeof window.imgbatch?.showOpenDialog === 'function') {
        await pickWatermarkImageFromHost()
      } else {
        watermarkFileInput.click()
      }
      return
    }

    if (action === 'continue-processing') {
      if (getState().activeTool === 'manual-crop') {
        const config = getState().configs['manual-crop']
        updateConfig('manual-crop', {
          currentIndex: 0,
          completedIds: [],
          cropAreas: {},
          lastCompletedCropSeed: null,
          sessionOutputPath: '',
          ...getManualCropGlobalTransformPatch(getState().assets[0] || null, config),
        })
      }
      resetActiveResultUi()
      return
    }

    if (action === 'replace-current-originals') {
      confirmReplaceCurrentOriginals()
      return
    }

    if (action === 'open-current-results') {
      await openCurrentResultsDirectory()
      return
    }

    if (action === 'open-result-path') {
      await openResultPath(target.dataset.path)
      return
    }

    if (action === 'open-color-picker') {
      openColorPickerZoom(target)
      return
    }

    if (action === 'confirm-native-color') {
      const field = target.closest('.color-field')
      const nativeInput = field?.querySelector('.color-field__native')
      const normalized = normalizeColorInputValue(nativeInput?.value || '')
      if (!normalized) {
        notify({ type: 'info', message: '请先选择有效颜色。' })
        return
      }
      updateColorPreview(target.dataset.toolId, target.dataset.key, normalized)
      syncColorTextInput(nativeInput)
      return
    }

    if (action === 'replace-asset-original') {
      confirmReplaceAssetOriginal(target.dataset.assetId)
      return
    }

    if (action === 'open-asset-result') {
      const asset = getAssetById(target.dataset.assetId)
      const targetPath = asset ? getLatestAssetResultPath(asset) : ''
      if (!targetPath) {
        notify({ type: 'info', message: '当前还没有可打开的结果目录。' })
        return
      }
      await openResultPath(targetPath)
      return
    }

    if (action === 'open-folder-input') {
      if (typeof window.imgbatch?.showOpenDialog === 'function') {
        await pickInputsFromHost('folder')
      } else {
        folderInput.click()
      }
      return
    }

    if (action === 'save-preset') {
      openSavePresetDialog(target.dataset.toolId)
      return
    }

    if (action === 'open-preset-dialog') {
      await openApplyPresetDialog(target.dataset.toolId)
      return
    }

    if (action === 'close-preset-dialog') {
      const clickedInsideDialog = !!event.target.closest('.app-modal__dialog')
      const clickedCloseIcon = !!event.target.closest('.app-modal__close')
      const clickedCancelButton = !!target.closest('.app-modal__footer [data-action="close-preset-dialog"]')
      if (clickedInsideDialog && !clickedCloseIcon && !clickedCancelButton) return
      closePresetDialog()
      return
    }

    if (action === 'close-confirm-dialog') {
      const clickedInsideDialog = !!event.target.closest('.app-modal__dialog')
      const clickedCloseIcon = !!event.target.closest('.app-modal__close')
      const clickedCancelButton = !!target.closest('.app-modal__footer [data-action="close-confirm-dialog"]')
      if (clickedInsideDialog && !clickedCloseIcon && !clickedCancelButton) return
      closeConfirmDialog()
      return
    }

    if (action === 'select-preset') {
      updatePresetDialog({ selectedPresetId: target.dataset.presetId })
      return
    }

    if (action === 'confirm-save-preset') {
      await confirmSavePresetDialog()
      return
    }

    if (action === 'confirm-rename-preset') {
      await confirmRenamePresetDialog()
      return
    }

    if (action === 'confirm-apply-preset') {
      await confirmApplyPresetDialog()
      return
    }

    if (action === 'rename-selected-preset') {
      const presets = getState().presetsByTool?.[target.dataset.toolId || getState().presetDialog?.toolId] || []
      const presetId = getState().presetDialog?.selectedPresetId
      const preset = presets.find((item) => item.id === presetId)
      if (preset) openRenamePresetDialog(getState().presetDialog.toolId, preset)
      return
    }

    if (action === 'delete-selected-preset') {
      confirmDeleteSelectedPreset()
      return
    }

    if (action === 'confirm-delete-selected-preset') {
      closeConfirmDialog()
      await removeSelectedPreset()
      return
    }

    if (action === 'confirm-replace-asset-original') {
      const assetId = getState().confirmDialog?.assetId
      closeConfirmDialog()
      if (assetId) await replaceAssetOriginal(assetId)
      return
    }

    if (action === 'confirm-replace-current-originals') {
      closeConfirmDialog()
      await replaceCurrentOriginals()
      return
    }

    if (action === 'confirm-open-source-directories') {
      const paths = Array.isArray(getState().confirmDialog?.paths) ? getState().confirmDialog.paths : []
      closeConfirmDialog()
      if (paths.length) await openSourceDirectories(paths)
      return
    }

    if (action === 'confirm-dangerous-resize-preview') {
      const assetId = getState().confirmDialog?.assetId
      closeConfirmDialog()
      if (assetId) await previewAsset(assetId, true)
      return
    }

    if (action === 'confirm-dangerous-resize-process') {
      closeConfirmDialog()
      await processCurrentTool(true)
      return
    }

    if (action === 'save-preset') {
      const toolId = target.dataset.toolId
      await savePreset(toolId, getState().configs[toolId])
      notify({ type: 'success', message: `已保存 ${toolId} 预设。` })
      return
    }

    if (action === 'set-config' && target.dataset.toolId === 'crop' && target.dataset.key === 'ratio') {
      const ratio = parseValue(target.dataset.value)
      updateConfig('crop', { ratio, useCustomRatio: ratio === 'Custom' })
      closeConfigSelect(target)
      return
    }

    if (action === 'set-measure-unit') {
      const toolId = target.dataset.toolId
      const key = target.dataset.key
      const nextUnit = target.dataset.unit === '%' ? '%' : 'px'
      const input = target.closest('.input-shell')?.querySelector('.text-input')
      const liveValue = input?.value
      const currentValue = getState().configs?.[toolId]?.[key]
      updateConfig(toolId, { [key]: normalizeMeasureToggleValue(liveValue ?? currentValue, nextUnit) })
      return
    }

    if (action === 'set-config') {
      updateConfig(target.dataset.toolId, { [target.dataset.key]: parseValue(target.dataset.value) })
      closeConfigSelect(target)
      return
    }

    if (action === 'apply-resize-preset') {
      updateConfig('resize', {
        sizeMode: 'manual',
        width: target.dataset.width,
        height: target.dataset.height,
      })
      return
    }
    if (await handleManualCropAction(action, target, {
      advanceManualCropAfterSuccess: (asset, latestState, latestConfig) => advanceManualCropAfterSuccessFlow({
        asset,
        latestState,
        latestConfig,
        notify,
        setResultView,
        showManualCropSummaryResultView: (completedIds) => updateManualCropSummaryResultView({
          state: getState(),
          completedIds,
          getSavedOutputPath,
          getPreviewMessage,
          setResultView,
        }),
        updateConfig,
      }),
      applyRunResult,
      closeConfigSelect,
      flushManualCropConfigUpdates,
      getState,
      notify,
      prepareRunPayload,
      runBusyAction,
      runTool,
      syncManualCropStageViewport,
      updateConfig,
      toolMap: TOOL_MAP,
      ensureManualCropSessionOutputPath: (toolId, config, asset, destinationPath) => ensureManualCropSessionOutputPathFlow({
        toolId,
        config,
        asset,
        destinationPath,
        prepareRunPayload,
        updateConfig,
      }),
    })) return

    if (action === 'toggle-config') {
      const state = getState()
      const toolId = target.dataset.toolId
      const key = target.dataset.key
      updateConfig(toolId, { [key]: !state.configs[toolId][key] })
      return
    }
  })

  document.addEventListener('input', (event) => {
    const target = event.target
    if (target.matches('[data-role="search-input"]')) {
      getState().searchQuery = target.value
      return
    }

    const action = target.dataset.action
    if (target.matches('.color-field__picker')) {
      syncColorTextInput(target)
      return
    }

    if (action === 'change-preset-name') {
      const dialog = getState().presetDialog
      if (dialog) dialog.name = target.value
      return
    }

    if (action === 'set-config-range') {
      syncRangeControl(target)
      return
    }

    if (action === 'set-range-value') {
      syncRangeValueInput(target)
      return
    }

    if (action === 'set-config-input') {
      const toolId = target.dataset.toolId
      const key = target.dataset.key
      const value = normalizeConfigInputValue(toolId, key, target.value, target.dataset.unitMode)
      const config = getState().configs[toolId] || {}
      if (config[key] !== value) {
        config[key] = value
      }

      if (toolId === 'crop' && key === 'ratio') {
        if (config.ratio !== value) config.ratio = value
        const useCustomRatio = value === 'Custom'
        if (config.useCustomRatio !== useCustomRatio) {
          config.useCustomRatio = useCustomRatio
        }
      }
    }
  })

  document.addEventListener('change', async (event) => {
    const target = event.target
    if (target === watermarkFileInput) {
      const file = target.files?.[0]
      let imagePath = file?.path || file?.filePath || file?.webkitRelativePath || ''
      if (!imagePath && file) {
        try {
          const [resolvedPath] = await resolveInputPaths([file])
          if (resolvedPath) imagePath = resolvedPath
        } catch {
          // fall through to data url
        }
      }
      if (!imagePath && file) {
        imagePath = await new Promise((resolve) => {
          const reader = new FileReader()
          reader.onload = () => resolve(typeof reader.result === 'string' ? reader.result : '')
          reader.onerror = () => resolve('')
          reader.readAsDataURL(file)
        })
      }
      if (!imagePath) {
        notify({ type: 'error', message: '读取图片水印文件失败。' })
      } else {
        updateConfig('watermark', { imagePath })
      }
      target.value = ''
      return
    }

    if (target === fileInput || target === folderInput) {
      await handleImport([...target.files])
      target.value = ''
      return
    }

    if (target.matches('[data-role="search-input"]')) {
      setSearchQuery(target.value)
      return
    }

    const action = target.dataset.changeAction || target.dataset.action
    if (action === 'toggle-preset-default') {
      updatePresetDialog({ setAsDefault: !!target.checked })
      return
    }

    if (action === 'set-config-range') {
      commitRangeControl(target)
      return
    }

    if (action === 'set-range-value') {
      commitRangeValueInput(target)
      return
    }

    if (action === 'set-config-color') {
      const value = target.value.toUpperCase()
      updateColorPreview(target.dataset.toolId, target.dataset.key, value)
      syncColorTextInput(target)
      return
    }

    if (target.matches('.color-field__value')) {
      const normalized = normalizeColorInputValue(target.value)
      if (normalized) {
        updateColorPreview(target.dataset.toolId, target.dataset.key, normalized)
      }
      return
    }

    if ((action === 'set-config-input' || action === 'set-config-select') && target.dataset.toolId === 'crop' && target.dataset.key === 'ratio') {
      const ratio = parseValue(target.value)
      updateConfig('crop', { ratio, useCustomRatio: ratio === 'Custom' })
      return
    }

    if (action === 'set-config-input' || action === 'set-config-select') {
      const value = normalizeConfigInputValue(target.dataset.toolId, target.dataset.key, target.value, target.dataset.unitMode)
      updateConfig(target.dataset.toolId, { [target.dataset.key]: value })
    }
  })

  document.addEventListener('pointermove', (event) => {
    if (hasManualCropPan()) {
      handleManualCropPan(event, {
        queueManualCropConfigUpdate,
      })
      return
    }
    if (DRAG_CONTEXT.previewPan) {
      handlePreviewComparePan(event)
      return
    }
    if (DRAG_CONTEXT.previewCompare) {
      handlePreviewCompareDrag(event)
      return
    }
    if (DRAG_CONTEXT.rotateDial) {
      handleRotateDrag(event)
      return
    }
    if (hasManualCropDrag()) {
      handleManualCropDrag(event, {
        queueManualCropConfigUpdate,
      })
    }
  })

  document.addEventListener('pointerup', () => {
    endManualCropPan()
    endPreviewComparePan()
    endPreviewCompareDrag()
    endRotateDrag()
    endManualCropDrag()
  })

  document.addEventListener('pointercancel', () => {
    endManualCropPan()
    endPreviewComparePan()
    endPreviewCompareDrag()
    endRotateDrag()
    endManualCropDrag()
  })

  document.addEventListener('contextmenu', (event) => {
    if (event.target.closest('[data-role="manual-crop-stage"]') && getState().activeTool === 'manual-crop') {
      event.preventDefault()
      return
    }
    if (!event.target.closest('.preview-modal__body--compare, .preview-modal__body--split')) return
    const preview = getState().previewModal
    const zoom = Number.isFinite(Number(preview?.compareZoom)) ? Number(preview.compareZoom) : 1
    if (zoom <= 1.01) return
    event.preventDefault()
  })

  document.addEventListener('dblclick', (event) => {
    if (getState().previewModal?.compareMode === 'split') return
    if (!event.target.closest('.preview-modal__body--compare')) return
    setPreviewCompareRatio(0.5)
  })

  document.addEventListener('keydown', (event) => {
    if (handleManualCropKeydown(event, {
      getState,
      isEditableTarget,
      queueManualCropConfigUpdate,
      updateConfig,
    })) return
    if (event.key === 'Escape' && getState().presetDialog?.visible) {
      event.preventDefault()
      event.stopPropagation()
      event.stopImmediatePropagation()
      closePresetDialog()
      return
    }
    if (event.key === 'Escape' && getState().confirmDialog?.visible) {
      event.preventDefault()
      event.stopPropagation()
      event.stopImmediatePropagation()
      closeConfirmDialog()
      return
    }
    if (event.key === 'Escape' && getState().settingsDialog?.visible) {
      event.preventDefault()
      event.stopPropagation()
      event.stopImmediatePropagation()
      closeSettingsDialog()
      return
    }
    const preview = getState().previewModal
    if (!preview?.url) return
    if (event.key === 'Escape') {
      event.preventDefault()
      event.stopPropagation()
      event.stopImmediatePropagation()
      if (preview.expanded && preview.compareMode === 'split') {
        togglePreviewCompareFullscreen()
      } else {
        closePreviewModal()
      }
      return
    }
    if (event.key === 'ArrowLeft') {
      if (preview.compareMode === 'split') return
      event.preventDefault()
      event.stopPropagation()
      event.stopImmediatePropagation()
      nudgePreviewCompareRatio(event.shiftKey ? -0.1 : -0.02)
      return
    }
    if (event.key === 'ArrowRight') {
      if (preview.compareMode === 'split') return
      event.preventDefault()
      event.stopPropagation()
      event.stopImmediatePropagation()
      nudgePreviewCompareRatio(event.shiftKey ? 0.1 : 0.02)
    }
  }, true)

  document.addEventListener('keyup', (event) => {
    if (handleManualCropKeyup(event, { getState })) return
    if (getState().presetDialog?.visible && event.key === 'Escape') {
      event.preventDefault()
      event.stopPropagation()
      event.stopImmediatePropagation()
      return
    }
    if (getState().confirmDialog?.visible && event.key === 'Escape') {
      event.preventDefault()
      event.stopPropagation()
      event.stopImmediatePropagation()
      return
    }
    if (getState().settingsDialog?.visible && event.key === 'Escape') {
      event.preventDefault()
      event.stopPropagation()
      event.stopImmediatePropagation()
      return
    }
    if (!getState().previewModal?.url) return
    if (event.key === 'Escape' || event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
      event.preventDefault()
      event.stopPropagation()
      event.stopImmediatePropagation()
    }
  }, true)

  document.addEventListener('scroll', (event) => {
    const queueNode = event.target?.closest?.('.queue-list')
    if (queueNode) {
      const nextScrollTop = Math.max(0, queueNode.scrollTop || 0)
      const nextHeight = Math.max(0, queueNode.clientHeight || 0)
      if (Math.abs(queueViewportState.scrollTop - nextScrollTop) > 1 || Math.abs(queueViewportState.height - nextHeight) > 1) {
        queueViewportState.scrollTop = nextScrollTop
        queueViewportState.height = nextHeight
        if (shouldTrackQueueViewport(getState())) scheduleQueueRootRender()
      }
    }
  }, true)
  window.addEventListener('scroll', () => positionTooltip(activeTooltipTarget), true)
  window.addEventListener('resize', () => {
    positionTooltip(activeTooltipTarget)
    syncShellFrame(getState())
    if (document.querySelector('.result-strip__marquee')) queueResultMarqueeSync()
    const queueViewportChanged = syncQueueViewportFromDom()
    if (shouldTrackQueueViewport(getState()) && queueViewportChanged) scheduleQueueRootRender()
    if (getState().activeTool === 'manual-crop') {
      queueManualCropStageSync()
    }
  })
  window.addEventListener('blur', () => {
    hideTooltip()
  })

  const cleanupOnPageExit = () => {
    cleanupAllPreviewCache('page-exit')
  }
  window.addEventListener('beforeunload', cleanupOnPageExit)
  window.addEventListener('pagehide', cleanupOnPageExit)
  window.addEventListener('unload', cleanupOnPageExit)

  document.addEventListener('dragstart', (event) => {
    const item = event.target.closest('.queue-item--sortable[data-asset-id]')
    if (!item) return
    beginQueueSortDrag(item, event)
  })

  document.addEventListener('dragend', () => {
    endQueueSortDrag()
  })

  document.addEventListener('dragover', (event) => {
    const queueDropTarget = getQueueSortDropTarget(event)
    if (DRAG_CONTEXT.queueSort && queueDropTarget) {
      event.preventDefault()
      updateQueueSortDropIndicator(queueDropTarget, event.clientY)
      return
    }
    if (!canImportFromEvent(event)) return
    if (!getDropSurface(event)) return
    event.preventDefault()
  })

  document.addEventListener('drop', async (event) => {
    const queueDropTarget = getQueueSortDropTarget(event)
    if (DRAG_CONTEXT.queueSort && queueDropTarget) {
      event.preventDefault()
      finishQueueSortDrop(queueDropTarget, event.clientY)
      return
    }
    if (!canImportFromEvent(event)) return
    if (!getDropSurface(event)) return
    event.preventDefault()
    await handleImport(extractDroppedItems(event))
  })
}

function getQueueSortDropTarget(event) {
  return event.target.closest('.queue-item--sortable[data-asset-id]')
}

function clearQueueSortIndicators() {
  activeQueueSortDragItem?.classList.remove('is-dragging')
  activeQueueSortBeforeItem?.classList.remove('is-drop-before')
  activeQueueSortAfterItem?.classList.remove('is-drop-after')
  activeQueueSortDragItem = null
  activeQueueSortBeforeItem = null
  activeQueueSortAfterItem = null
}

function getAdjacentSortableItem(item, direction) {
  let current = item
  while (current) {
    current = direction === 'next' ? current.nextElementSibling : current.previousElementSibling
    if (!current) return null
    if (current.matches?.('.queue-item--sortable[data-asset-id]')) return current
  }
  return null
}

function markQueueSortInsertionGap(item, placement) {
  if (!item) return
  if (placement === 'after') {
    const nextBeforeItem = getAdjacentSortableItem(item, 'next')
    if (activeQueueSortAfterItem !== item) {
      activeQueueSortAfterItem?.classList.remove('is-drop-after')
      item.classList.add('is-drop-after')
      activeQueueSortAfterItem = item
    }
    if (activeQueueSortBeforeItem !== nextBeforeItem) {
      activeQueueSortBeforeItem?.classList.remove('is-drop-before')
      nextBeforeItem?.classList.add('is-drop-before')
      activeQueueSortBeforeItem = nextBeforeItem
    }
    return
  }
  const nextAfterItem = getAdjacentSortableItem(item, 'prev')
  if (activeQueueSortBeforeItem !== item) {
    activeQueueSortBeforeItem?.classList.remove('is-drop-before')
    item.classList.add('is-drop-before')
    activeQueueSortBeforeItem = item
  }
  if (activeQueueSortAfterItem !== nextAfterItem) {
    activeQueueSortAfterItem?.classList.remove('is-drop-after')
    nextAfterItem?.classList.add('is-drop-after')
    activeQueueSortAfterItem = nextAfterItem
  }
}

function beginQueueSortDrag(item, event) {
  const tool = TOOL_MAP[getState().activeTool]
  if (tool?.mode !== 'sort') return
  DRAG_CONTEXT.queueSort = { assetId: item.dataset.assetId }
  clearQueueSortIndicators()
  item.classList.add('is-dragging')
  activeQueueSortDragItem = item
  if (event.dataTransfer) {
    event.dataTransfer.effectAllowed = 'move'
    event.dataTransfer.setData('text/plain', item.dataset.assetId || '')
  }
}

function updateQueueSortDropIndicator(item, clientY) {
  if (!DRAG_CONTEXT.queueSort || item.dataset.assetId === DRAG_CONTEXT.queueSort.assetId) {
    if (activeQueueSortBeforeItem) {
      activeQueueSortBeforeItem.classList.remove('is-drop-before')
      activeQueueSortBeforeItem = null
    }
    if (activeQueueSortAfterItem) {
      activeQueueSortAfterItem.classList.remove('is-drop-after')
      activeQueueSortAfterItem = null
    }
    if (activeQueueSortDragItem !== item) {
      activeQueueSortDragItem?.classList.remove('is-dragging')
      item.classList.add('is-dragging')
      activeQueueSortDragItem = item
    }
    return
  }
  const rect = item.getBoundingClientRect()
  const placement = clientY > rect.top + rect.height / 2 ? 'after' : 'before'
  markQueueSortInsertionGap(item, placement)
}

function finishQueueSortDrop(item, clientY) {
  const drag = DRAG_CONTEXT.queueSort
  if (!drag) return
  const targetAssetId = item.dataset.assetId
  if (targetAssetId && targetAssetId !== drag.assetId) {
    blurFocusedQueueSortControl()
    captureQueueScrollPosition()
    const rect = item.getBoundingClientRect()
    const placement = clientY > rect.top + rect.height / 2 ? 'after' : 'before'
    moveAssetToTarget(drag.assetId, targetAssetId, placement)
  }
  endQueueSortDrag()
}

function endQueueSortDrag() {
  DRAG_CONTEXT.queueSort = null
  clearQueueSortIndicators()
}

async function handleImport(items) {
  if (!items.length) return
  try {
    const assets = await importItems(items)
    if (!assets.length) {
      notify({ type: 'info', message: '未识别到可导入的图片。' })
      return
    }
    appendAssets(assets)
    notify({ type: 'success', message: `已导入 ${assets.length} 张图片。` })
  } catch (error) {
    notify({ type: 'error', message: error?.message || '导入失败。' })
  }
}

async function pickInputsFromHost(kind) {
  const options = kind === 'folder'
    ? {
        title: '选择图片文件夹',
        properties: ['openDirectory', 'multiSelections'],
      }
    : {
        title: '选择图片',
        properties: ['openFile', 'multiSelections'],
        filters: [
          { name: '图片文件', extensions: ['png', 'jpg', 'jpeg', 'webp', 'bmp', 'gif', 'tiff', 'tif', 'avif', 'ico'] },
        ],
      }

  const selected = await openInputDialog(options)
  const paths = Array.isArray(selected?.filePaths)
    ? selected.filePaths
    : Array.isArray(selected)
      ? selected
      : []
  if (paths.length) {
    await handleImport(paths)
  }

  restoreMainWindowAfterDialog()
}

async function pickWatermarkImageFromHost() {
  const selected = await openInputDialog({
    title: '选择图片水印',
    properties: ['openFile'],
    filters: [
      { name: '图片文件', extensions: ['png', 'jpg', 'jpeg', 'webp', 'bmp', 'gif', 'tiff', 'tif', 'avif', 'ico'] },
    ],
  })
  const paths = Array.isArray(selected?.filePaths)
    ? selected.filePaths
    : Array.isArray(selected)
      ? selected
      : []
  const imagePath = paths[0] || ''
  if (imagePath) {
    updateConfig('watermark', { imagePath })
  }

  restoreMainWindowAfterDialog()
}

function restoreMainWindowAfterDialog() {
  void showMainWindow()
  window.setTimeout(() => {
    void showMainWindow()
    window.focus?.()
  }, 120)
}

async function previewAsset(assetId, skipResizePercentConfirm = false) {
  const state = getState()
  const asset = getAssetById(assetId)
  if (!asset) {
    notify({ type: 'error', message: '未找到要预览的图片。' })
    return
  }

  const tool = TOOL_MAP[state.activeTool]
  if (!tool) return
  if (shouldReusePreviewResult(tool.id, asset) && !hasReusableResultFile(asset, tool.id)) {
    markAssetResultMissing(asset.id, tool.id)
    notify({ type: 'info', message: '处理结果文件已不存在，已回退为重新处理。' })
  }
  const latestAsset = getAssetById(assetId) || asset
  const reusableAsset = buildViewableResultAsset(latestAsset, tool.id)
  if (reusableAsset && openPreviewModal(reusableAsset, tool.id)) {
    return
  }
  if (!isPreviewableTool(tool.id) || MERGE_PREVIEW_TOOLS.has(tool.id)) {
    notify({ type: 'info', message: `${tool.label} 暂不支持预览：${truncate(asset?.name || '当前图片', 20)}` })
    return
  }
  const previewValidationMessage = getToolInputValidationMessage(tool.id, state.configs[tool.id] || {})
  if (previewValidationMessage) {
    notify({ type: 'info', message: previewValidationMessage })
    return
  }
  if (
    tool.id === 'resize'
    && !skipResizePercentConfirm
    && openResizePercentConfirm('preview', assetId)
  ) {
    return
  }
  if (state.isProcessing) return

  try {
    await runBusyAction(() => previewWithRunner(tool, latestAsset))
  } catch (error) {
    notify({ type: 'error', message: error?.message || `${tool.label} 预览失败。` })
  }
}

async function processCurrentTool(skipResizePercentConfirm = false) {
  const state = getState()
  const tool = TOOL_MAP[state.activeTool]

  if (!state.assets.length) {
    notify({ type: 'info', message: '请先导入图片，再开始处理。' })
    return
  }

  if (tool.id === 'manual-crop' && !getAssetsForToolFlow(tool.id, state.assets, state.configs['manual-crop']).length) {
    notify({ type: 'info', message: '请先至少标记一张图片，再开始手动裁剪。' })
    return
  }

  const validationMessage = getToolInputValidationMessage(tool.id, state.configs[tool.id] || {})
  if (validationMessage) {
    notify({ type: 'info', message: validationMessage })
    return
  }
  if (
    tool.id === 'resize'
    && !skipResizePercentConfirm
    && openResizePercentConfirm('process')
  ) {
    return
  }

  if (state.isProcessing) return

  try {
    const assets = getAssetsForToolFlow(tool.id, state.assets, state.configs['manual-crop'])
    const runner = getToolRunner(tool.id)
    const destinationPath = state.destinationPath || state.settings.defaultSavePath || ''
    const preferredRunFolderName = PREVIEW_SAVE_TOOLS.has(tool.id)
      ? getPreferredRunFolderName(tool.id, assets)
      : ''
    const reusableProcessed = []
    const materializeItems = []
    const materializeSourceRunFolderByAssetId = new Map()
    const pendingAssets = []
    if (PREVIEW_SAVE_TOOLS.has(tool.id)) {
      const reusableCandidates = []
      for (let index = 0; index < assets.length; index += 1) {
        const asset = assets[index]
        const reused = buildReusablePreviewProcessed(asset, tool.id)
        if (reused) reusableCandidates.push({ asset, reused })
        else pendingAssets.push(asset)
      }
      if (reusableCandidates.length) {
        const validAssetIds = new Set(checkStagedFiles(reusableCandidates.map(({ reused }) => ({
          assetId: reused.assetId,
          stagedPath: reused.stagedPath,
        }))))
        const invalidAssetIds = []
        for (let index = 0; index < reusableCandidates.length; index += 1) {
          const { asset, reused } = reusableCandidates[index]
          if (validAssetIds.has(reused.assetId)) {
            if (asset.previewStatus === 'previewed') {
              materializeItems.push(reused)
              if (asset.runFolderName) materializeSourceRunFolderByAssetId.set(asset.id, asset.runFolderName)
            } else {
              reusableProcessed.push(reused)
            }
          } else {
            pendingAssets.push(asset)
            invalidAssetIds.push(reused.assetId)
          }
        }
        if (invalidAssetIds.length) {
          cleanupPreviewCacheByAssetIds(invalidAssetIds, 'staged-file-validation')
          notify({
            type: 'info',
            message: `有 ${invalidAssetIds.length} 张预览缓存已失效，已自动回退为重新处理。`,
            durationMs: 4200,
          })
        }
      }
    } else {
      pendingAssets.push(...assets)
    }

    if (reusableProcessed.length || materializeItems.length) {
      notify({
        type: 'info',
        message: pendingAssets.length
          ? `本次有 ${reusableProcessed.length + materializeItems.length} 张直接复用了已有结果，处理进度只会显示其余 ${pendingAssets.length} 张。`
          : `本次 ${reusableProcessed.length + materializeItems.length} 张都直接复用了已有结果，所以不会再进入处理进度。`,
        durationMs: 4200,
      })
    }

    let result = null
    let successfulMaterializedFolders = []
    if (!pendingAssets.length && !materializeItems.length && reusableProcessed.length) {
      result = {
        ok: true,
        partial: false,
        toolId: tool.id,
        config: state.configs[tool.id],
        mode: 'preview-save',
        processed: reusableProcessed,
        failed: [],
        runId: reusableProcessed[0]?.runId || '',
        runFolderName: reusableProcessed[0]?.runFolderName || '',
        message: `已直接复用 ${tool.label} 预览结果：${reusableProcessed.length} 项，可继续保存。`,
      }
    } else {
      const combinedRun = await runBusyAction(async () => {
        const materializedResult = materializeItems.length
          ? await materializePreviewResults(tool.id, materializeItems, destinationPath, preferredRunFolderName)
          : null
        const executedResult = pendingAssets.length
          ? await runner(
              tool.id,
              state.configs[tool.id],
              pendingAssets,
              destinationPath,
              preferredRunFolderName ? { preferredRunFolderName } : {},
            )
          : null
        return { materializedResult, executedResult }
      })
      const materializedResult = combinedRun?.materializedResult || null
      const executedResult = combinedRun?.executedResult || null
      successfulMaterializedFolders = []
      if (materializedResult?.processed?.length) {
        const failedMaterializeAssetIds = new Set((materializedResult.failed || []).map((item) => item?.assetId).filter(Boolean))
        const folderPendingCounts = new Map()
        for (let index = 0; index < materializeItems.length; index += 1) {
          const item = materializeItems[index]
          const folderName = materializeSourceRunFolderByAssetId.get(item.assetId)
          if (!folderName) continue
          folderPendingCounts.set(folderName, (folderPendingCounts.get(folderName) || 0) + 1)
        }
        for (let index = 0; index < materializedResult.processed.length; index += 1) {
          const item = materializedResult.processed[index]
          if (failedMaterializeAssetIds.has(item?.assetId)) continue
          const folderName = materializeSourceRunFolderByAssetId.get(item?.assetId)
          if (!folderName) continue
          const nextCount = (folderPendingCounts.get(folderName) || 0) - 1
          if (nextCount > 0) {
            folderPendingCounts.set(folderName, nextCount)
            continue
          }
          folderPendingCounts.delete(folderName)
          successfulMaterializedFolders.push(folderName)
        }
      }
      if (reusableProcessed.length || materializedResult?.processed?.length) {
        result = {
          ...(executedResult || materializedResult || {
            toolId: tool.id,
            config: state.configs[tool.id],
            mode: 'preview-save',
            processed: [],
            failed: [],
          }),
          mode: executedResult?.mode || materializedResult?.mode || 'preview-save',
          runId: executedResult?.runId || materializedResult?.runId || '',
          runFolderName: executedResult?.runFolderName || materializedResult?.runFolderName || preferredRunFolderName,
          processed: [
            ...reusableProcessed,
            ...(materializedResult?.processed || []),
            ...(executedResult?.processed || []),
          ],
          failed: [
            ...(materializedResult?.failed || []),
            ...(executedResult?.failed || []),
          ],
          ok: (reusableProcessed.length + Number(materializedResult?.processed?.length || 0) + Number(executedResult?.processed?.length || 0)) > 0
            && !(materializedResult?.failed?.length)
            && !(executedResult?.failed?.length),
          partial: !!(materializedResult?.failed?.length) || !!(executedResult?.failed?.length) || !!executedResult?.partial || !!materializedResult?.partial,
          message: executedResult?.message
            || materializedResult?.message
            || `已复用 ${reusableProcessed.length + materializeItems.length} 项预览结果，并继续生成其余结果。`,
        }
      } else {
        result = executedResult || materializedResult
      }
    }
    if (result?.processed?.length || result?.failed?.length) {
      applyRunResult(result)
      removePreviewCacheQueueEntries((result.processed || []).map((item) => item.assetId))
      if (successfulMaterializedFolders.length) {
        cleanupPreviewCache(successfulMaterializedFolders, { reason: 'materialized-preview-reuse' })
      }
    }

    if (result?.ok || result?.partial) {
      notify({
        type: result.partial ? 'info' : 'success',
        message: result?.message || (PREVIEW_SAVE_TOOLS.has(tool.id) ? `已生成 ${tool.label} 结果，确认后可保存。` : `已触发 ${tool.label} 批处理。`),
      })
      const compressionWarning = getCompressionOversizeWarning(result, tool)
      if (compressionWarning) {
        notify({ type: 'info', message: compressionWarning, durationMs: 6500 })
      }
      const autoOpenResultPath = result && tool && MERGE_PREVIEW_TOOLS.has(tool.id)
        ? String(result.processed?.[0]?.outputPath || '').trim()
        : ''
      if (autoOpenResultPath) {
        await openResultPath(autoOpenResultPath)
      }
      return
    }

    notify({
      type: 'info',
      message: result?.message || `处理占位：${tool.label} · ${assets.length} 张 · ${describeToolConfig(tool.id, getState().configs[tool.id])}`,
    })
  } catch (error) {
    notify({ type: 'error', message: error?.message || '批处理触发失败。' })
  }
}

function createFileInput({ directory }) {
  const input = document.createElement('input')
  input.type = 'file'
  input.multiple = true
  input.accept = 'image/*'
  input.hidden = true
  if (directory) {
    input.setAttribute('webkitdirectory', '')
    input.removeAttribute('accept')
  }
  return input
}

function renderNotifications(items) {
  if (!items.length) return ''
  return `
    <div style="position:fixed;right:20px;top:92px;display:flex;flex-direction:column;gap:10px;z-index:999;">
      ${items.map((item) => `
        <button data-action="dismiss-notification" data-id="${item.id}" style="min-width:280px;padding:14px 16px;border-radius:18px;background:${getToastColor(item.type)};color:white;text-align:left;box-shadow:var(--shadow-float);cursor:pointer;">
          ${item.message}
        </button>
      `).join('')}
    </div>
  `
}

function scheduleNotificationDismiss(id, durationMs = 2000) {
  window.setTimeout(() => {
    const state = getState()
    if (state.notifications.some((item) => item.id === id)) {
      dismissNotification(id)
    }
  }, Math.max(1200, Number(durationMs) || 2000))
}

function notify(notification) {
  const item = pushNotification(notification)
  scheduleNotificationDismiss(item.id, notification?.durationMs)
  return item
}

document.addEventListener('click', (event) => {
  const target = event.target.closest('[data-action="dismiss-notification"]')
  if (target) dismissNotification(target.dataset.id)
})

function getToastColor(type) {
  if (type === 'success') return 'linear-gradient(135deg, #4956b4 0%, #8c99fc 100%)'
  if (type === 'error') return '#a8364b'
  return '#5b5e72'
}

function syncRangeControl(target) {
  const value = parseValue(target.value)
  const wrapper = target.closest('.setting-row')
  const valueNode = wrapper?.querySelector('[data-range-value]')
  if (valueNode) valueNode.value = value
  target.style.setProperty('--range-progress', `${getRangeProgress(value, target.min, target.max)}%`)
}

function commitRangeControl(target) {
  syncRangeControl(target)
  updateConfig(target.dataset.toolId, { [target.dataset.key]: parseValue(target.value) })
}

function syncRangeValueInput(target) {
  const wrapper = target.closest('.setting-row')
  const rangeInput = wrapper?.querySelector('.range-input')
  if (!rangeInput) return
  const min = Number(rangeInput.min)
  const max = Number(rangeInput.max)
  const raw = Number(target.value)
  const value = Number.isFinite(raw) ? Math.max(min, Math.min(max, raw)) : min
  rangeInput.value = String(value)
  rangeInput.style.setProperty('--range-progress', `${getRangeProgress(value, rangeInput.min, rangeInput.max)}%`)
}

function commitRangeValueInput(target) {
  const wrapper = target.closest('.setting-row')
  const rangeInput = wrapper?.querySelector('.range-input')
  if (!rangeInput) return
  const min = Number(rangeInput.min)
  const max = Number(rangeInput.max)
  const raw = Number(target.value)
  const value = Number.isFinite(raw) ? Math.max(min, Math.min(max, raw)) : Number(rangeInput.value || min)
  target.value = String(value)
  rangeInput.value = String(value)
  rangeInput.style.setProperty('--range-progress', `${getRangeProgress(value, rangeInput.min, rangeInput.max)}%`)
  updateConfig(target.dataset.toolId, { [target.dataset.key]: value })
}

function beginRotateDrag(event, target) {
  event.preventDefault()
  const element = target.closest('[data-role="rotate-dial"]')
  if (!element) return
  const rect = element.getBoundingClientRect()
  const centerX = rect.left + rect.width / 2
  const centerY = rect.top + rect.height / 2
  const state = getState()
  const rotateConfig = state.configs.rotate || { angle: 0 }
  DRAG_CONTEXT.rotateDial = {
    toolId: target.dataset.toolId,
    pointerId: event.pointerId,
    centerX,
    centerY,
    lastAngle: Number(rotateConfig.angle) || 0,
  }
  target.setPointerCapture?.(event.pointerId)
  handleRotateDrag(event)
}

function handleRotateDrag(event) {
  const context = DRAG_CONTEXT.rotateDial
  if (!context) return
  if (context.pointerId != null && event.pointerId != null && event.pointerId !== context.pointerId) return
  const dx = event.clientX - context.centerX
  const dy = event.clientY - context.centerY
  if (Math.abs(dx) < 2 && Math.abs(dy) < 2) return
  const radians = Math.atan2(dy, dx)
  const signedDegrees = Math.round((((radians * 180) / Math.PI) + 450) % 360)
  const signed = signedDegrees > 180 ? signedDegrees - 360 : signedDegrees
  const nextAngle = signed
  if (nextAngle === context.lastAngle) return
  context.lastAngle = nextAngle
  context.pendingAngle = nextAngle
  if (rotateDialFrame) return
  rotateDialFrame = requestAnimationFrame(() => {
    rotateDialFrame = 0
    const latestContext = DRAG_CONTEXT.rotateDial
    if (!latestContext || latestContext.pendingAngle == null) return
    const angle = latestContext.pendingAngle
    latestContext.pendingAngle = null
    updateConfig(latestContext.toolId, {
      angle,
    })
  })
}

function endRotateDrag() {
  if (rotateDialFrame) {
    cancelAnimationFrame(rotateDialFrame)
    rotateDialFrame = 0
  }
  const context = DRAG_CONTEXT.rotateDial
  if (context?.pendingAngle != null) {
    updateConfig(context.toolId, {
      angle: context.pendingAngle,
    })
  }
  DRAG_CONTEXT.rotateDial = null
}

function parseValue(value) {
  if (value === 'true') return true
  if (value === 'false') return false
  if (value !== '' && !Number.isNaN(Number(value)) && !String(value).endsWith('px') && !String(value).endsWith('%')) {
    return Number(value)
  }
  return value
}

function normalizeConfigInputValue(toolId, key, value, unitMode = '') {
  const parsed = unitMode ? normalizeMeasureToggleValue(value, unitMode) : parseValue(value)
  if (toolId === 'padding' && ['top', 'right', 'bottom', 'left', 'unifiedMargin'].includes(key)) {
    const nextUnit = unitMode || getMeasureUnitFromValue(parsed)
    const numeric = getNumericInputValue(parsed)
    const clamped = nextUnit === '%'
      ? Math.max(0, Math.min(100, Number.isFinite(numeric) ? numeric : 0))
      : Math.max(0, Math.min(10000, Number.isFinite(numeric) ? numeric : 0))
    return `${Math.round(clamped)}${nextUnit}`
  }
  if (toolId === 'rotate' && key === 'angle') {
    const numeric = Number(parsed)
    if (!Number.isFinite(numeric)) return 0
    return Math.max(-360, Math.min(360, Math.round(numeric)))
  }
  return parsed
}

function getNumericInputValue(value) {
  if (typeof value === 'number') return value
  const raw = String(value ?? '').trim()
  if (!raw) return Number.NaN
  const normalized = raw.replace(/(px|%)$/i, '').trim()
  if (!normalized) return Number.NaN
  return Number(normalized)
}

function isPositiveInputValue(value) {
  const numeric = getNumericInputValue(value)
  return Number.isFinite(numeric) && numeric > 0
}

function isNonNegativeInputValue(value) {
  const numeric = getNumericInputValue(value)
  return Number.isFinite(numeric) && numeric >= 0
}

function getMeasureUnitFromValue(value) {
  return String(value ?? '').trim().endsWith('%') ? '%' : 'px'
}

function getDangerousResizePercentConfig(config = {}) {
  const widthUnit = getMeasureUnitFromValue(config.width)
  const heightUnit = getMeasureUnitFromValue(config.height)
  const widthValue = getNumericInputValue(config.width)
  const heightValue = getNumericInputValue(config.height)
  const widthPercent = widthUnit === '%' && Number.isFinite(widthValue) ? widthValue : 0
  const heightPercent = heightUnit === '%' && Number.isFinite(heightValue) ? heightValue : 0
  const hasLargeSinglePercent = widthPercent >= 400 || heightPercent >= 400
  const hasLargeCombinedPercent = widthPercent >= 200 && heightPercent >= 200
  if (!hasLargeSinglePercent && !hasLargeCombinedPercent) return null
  return {
    widthPercent,
    heightPercent,
    summary: [
      widthPercent ? `宽度 ${Math.round(widthPercent)}%` : '',
      heightPercent ? `高度 ${Math.round(heightPercent)}%` : '',
    ].filter(Boolean).join('，'),
  }
}

function openResizePercentConfirm(mode, assetId = '') {
  const config = getState().configs.resize || {}
  const danger = getDangerousResizePercentConfig(config)
  if (!danger) return false
  openConfirmDialog({
    title: '确认放大倍率',
    subtitle: danger.summary || '百分比尺寸过大',
    message: '当前修改尺寸使用了较大的百分比，可能导致图片被放大很多倍，处理明显变慢，严重时可能占满内存。请确认这不是误操作。',
    confirmLabel: '我确定',
    confirmAction: mode === 'preview' ? 'confirm-dangerous-resize-preview' : 'confirm-dangerous-resize-process',
    assetId,
  })
  return true
}

function getToolInputValidationMessage(toolId, config = {}) {
  if (toolId === 'compression') {
    if (config.mode === 'target') {
      return isPositiveInputValue(config.targetSizeKb) ? '' : '目标大小 KB 必须大于 0 后才能开始处理。'
    }
    return isPositiveInputValue(config.quality) ? '' : '压缩质量必须大于 0 后才能开始处理。'
  }

  if (toolId === 'format') {
    const targetFormat = String(config.targetFormat || 'JPEG').toUpperCase()
    if (!getFormatCapability(targetFormat)?.supportsQuality) return ''
    return isPositiveInputValue(config.quality) ? '' : '输出质量必须大于 0 后才能开始处理。'
  }

  if (toolId === 'resize') {
    if (!isPositiveInputValue(config.width)) return '宽度必须大于 0 后才能开始处理。'
    if (!isPositiveInputValue(config.height)) return '高度必须大于 0 后才能开始处理。'
    return ''
  }

  if (toolId === 'flip') {
    const outputFormat = String(config.outputFormat || 'Keep Original')
    if (outputFormat !== 'Keep Original' && !getFormatCapability(outputFormat)?.supportsQuality) return ''
    return isPositiveInputValue(config.quality) ? '' : '输出质量必须大于 0 后才能开始处理。'
  }

  if (toolId === 'rotate') {
    return isPositiveInputValue(config.quality) ? '' : '输出质量必须大于 0 后才能开始处理。'
  }

  if (toolId === 'watermark') {
    if (!isPositiveInputValue(config.quality)) return '输出质量必须大于 0 后才能开始处理。'
    if (!isPositiveInputValue(config.opacity)) return '水印透明度必须大于 0 后才能开始处理。'
    if (!isNonNegativeInputValue(config.margin)) return '水印边距不能小于 0。'
    if (config.tiled && !isPositiveInputValue(config.density)) return '平铺密度必须大于 0 后才能开始处理。'
    if (config.type === 'image') {
      return String(config.imagePath || '').trim() ? '' : '请选择图片水印文件后再开始处理。'
    }
    if (!String(config.text || '').trim()) return '请输入水印文本后再开始处理。'
    return isPositiveInputValue(config.fontSize) ? '' : '字体大小必须大于 0 后才能开始处理。'
  }

  if (toolId === 'corners') {
    if (!isPositiveInputValue(config.quality)) return '输出质量必须大于 0 后才能开始处理。'
    return isPositiveInputValue(config.radius) ? '' : '圆角半径必须大于 0 后才能开始处理。'
  }

  if (toolId === 'padding') {
    if (!isPositiveInputValue(config.quality)) return '输出质量必须大于 0 后才能开始处理。'
    if (config.unifiedMarginEnabled) {
      if (!isNonNegativeInputValue(config.unifiedMargin)) return '统一边距不能小于 0。'
      if (getMeasureUnitFromValue(config.unifiedMargin) === '%' && getNumericInputValue(config.unifiedMargin) > 100) return '统一边距百分比不能超过 100%。'
      return getNumericInputValue(config.unifiedMargin) > 0 ? '' : '请设置一个大于 0 的统一边距后再开始处理。'
    }
    const edges = [config.top, config.right, config.bottom, config.left]
    if (edges.some((value) => !isNonNegativeInputValue(value))) return '留白边距不能小于 0。'
    if (edges.some((value) => getMeasureUnitFromValue(value) === '%' && getNumericInputValue(value) > 100)) return '留白边距百分比不能超过 100%。'
    return edges.some((value) => getNumericInputValue(value) > 0) ? '' : '请至少设置一个大于 0 的留白边距后再开始处理。'
  }

  if (toolId === 'crop') {
    if (!isPositiveInputValue(config.quality)) return '输出质量必须大于 0 后才能开始处理。'
    if (!isNonNegativeInputValue(config.x)) return '开始位置-距离左边不能小于 0。'
    if (!isNonNegativeInputValue(config.y)) return '开始位置-距离顶部不能小于 0。'
    if ((config.mode || 'ratio') === 'ratio' && (config.ratio === 'Custom' || config.useCustomRatio)) {
      if (!isPositiveInputValue(config.customRatioX)) return '自定义比例宽度必须大于 0。'
      if (!isPositiveInputValue(config.customRatioY)) return '自定义比例高度必须大于 0。'
    }
    if ((config.mode || 'ratio') === 'size') {
      if (!isPositiveInputValue(config.width)) return '裁剪宽度必须大于 0 后才能开始处理。'
      if (!isPositiveInputValue(config.height)) return '裁剪高度必须大于 0 后才能开始处理。'
    }
    return ''
  }

  if (toolId === 'merge-image') {
    if (!isPositiveInputValue(config.pageWidth)) return '页面宽度必须大于 0 后才能开始处理。'
    return isNonNegativeInputValue(config.spacing) ? '' : '图片间距不能小于 0。'
  }

  if (toolId === 'merge-gif') {
    if (!isPositiveInputValue(config.width)) return 'GIF 宽度必须大于 0 后才能开始处理。'
    if (!isPositiveInputValue(config.height)) return 'GIF 高度必须大于 0 后才能开始处理。'
    return isPositiveInputValue(config.interval) ? '' : '间隔毫秒必须大于 0 后才能开始处理。'
  }

  return ''
}

function describeToolConfig(toolId, config) {
  if (toolId === 'compression') return config.mode === 'quality' ? `压缩质量 ${config.quality}%` : `目标大小 ${config.targetSizeKb} KB`
  if (toolId === 'format') return `输出 ${config.targetFormat} / 质量 ${config.quality}%`
  if (toolId === 'resize') {
    const width = typeof config.width === 'object' ? `${config.width.value}${config.width.unit}` : config.width
    const height = typeof config.height === 'object' ? `${config.height.value}${config.height.unit}` : config.height
    return `尺寸 ${width} × ${height}`
  }
  if (toolId === 'watermark') return `${config.type === 'text' ? '文本' : '图片'}水印 ${WATERMARK_POSITION_LABELS[config.position] || config.position} / 质量 ${config.quality}%`
  if (toolId === 'corners') return `圆角 ${config.radius}${config.unit} / 质量 ${config.quality}%`
  if (toolId === 'padding') return config.unifiedMarginEnabled
    ? `留白 统一 ${config.unifiedMargin} / 质量 ${config.quality}%`
    : `留白 ${config.top}/${config.right}/${config.bottom}/${config.left} / 质量 ${config.quality}%`
  if (toolId === 'crop') {
    if ((config.mode || 'ratio') === 'size') return `裁剪 ${config.width}×${config.height} / 质量 ${config.quality}%`
    return `裁剪 ${config.ratio === 'Custom' ? `${config.customRatioX}:${config.customRatioY}` : config.ratio} / 质量 ${config.quality}%`
  }
  if (toolId === 'rotate') return `旋转 ${Number(config.angle) || 0}° / 质量 ${config.quality}%`
  if (toolId === 'flip') {
    const directions = [config.horizontal ? '左右' : '', config.vertical ? '上下' : ''].filter(Boolean)
    const outputFormat = String(config.outputFormat || 'Keep Original')
    const qualityText = outputFormat === 'Keep Original' || !!getFormatCapability(outputFormat)?.supportsQuality
      ? ` / 质量 ${config.quality}%`
      : ''
    return directions.length
      ? `${directions.join(' + ')}翻转 / ${outputFormat}${qualityText}`
      : `未翻转 / ${outputFormat}${qualityText}`
  }
  if (toolId === 'merge-pdf') return `PDF ${config.pageSize} / ${config.margin}`
  if (toolId === 'merge-image') {
    const outputFormat = String(config.outputFormat || 'JPEG')
    const qualitySupported = !!getFormatCapability(outputFormat)?.supportsQuality
    const spanLabel = config.direction === 'vertical' ? '宽度' : '高度'
    return `${config.direction === 'vertical' ? '纵向' : '横向'}拼接 ${spanLabel} ${config.pageWidth}px / ${outputFormat}${qualitySupported ? ` ${config.quality}%` : ''}`
  }
  if (toolId === 'merge-gif') return `GIF ${config.width}×${config.height} / ${config.interval}ms`
  if (toolId === 'manual-crop') return `手动裁剪 ${config.ratio}`
  return '待处理'
}

function getRangeProgress(value, min, max) {
  const current = Number(value)
  const start = Number(min)
  const end = Number(max)
  if (!Number.isFinite(current) || !Number.isFinite(start) || !Number.isFinite(end) || start === end) return 0
  return Math.max(0, Math.min(100, ((current - start) / (end - start)) * 100))
}

function truncate(value, length) {
  if (value.length <= length) return value
  return `${value.slice(0, Math.max(0, length - 1))}…`
}
