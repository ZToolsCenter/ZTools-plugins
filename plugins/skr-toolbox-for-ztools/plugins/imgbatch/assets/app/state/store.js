import { DEFAULT_TOOL } from '../config/tools.js'

const listeners = new Set()
const PREVIEW_SAVE_TOOLS = new Set(['compression', 'format', 'resize', 'watermark', 'corners', 'padding', 'crop', 'rotate', 'flip'])
const MERGE_OUTPUT_TOOLS = new Set(['merge-pdf', 'merge-image', 'merge-gif'])
let batchDepth = 0
let emitQueued = false
let assetIndexById = new Map()
let assetPathSet = new Set()

const DEFAULT_CONFIGS = {
  compression: { mode: 'quality', quality: 85, targetSizeKb: 250 },
  format: { mode: 'quality', targetFormat: 'JPEG', quality: 90, keepTransparency: true, colorProfile: 'srgb' },
  resize: { sizeMode: 'manual', width: '1920px', height: '1080px', lockAspectRatio: true, quality: 90 },
  watermark: { type: 'text', text: '批量处理', opacity: 60, position: 'center', fontSize: 32, color: '#FFFFFF', rotation: 0, margin: 24, tiled: false, density: 100, quality: 90 },
  corners: { radius: '24px', background: '#ffffff', keepTransparency: false, quality: 90 },
  padding: { top: '20px', right: '20px', bottom: '20px', left: '20px', unifiedMarginEnabled: false, unifiedMargin: '20px', color: '#ffffff', opacity: 100, quality: 90 },
  crop: { mode: 'ratio', ratio: '16:9', useCustomRatio: false, customRatioX: 16, customRatioY: 9, x: '0px', y: '0px', width: 1920, height: 1080, quality: 90 },
  rotate: { angle: 0, autoCrop: true, keepAspectRatio: false, background: '#ffffff', quality: 90 },
  flip: { horizontal: true, vertical: false, preserveMetadata: true, autoCropTransparent: false, outputFormat: 'Keep Original', quality: 90 },
  'merge-pdf': { pageSize: 'A4', margin: 'narrow', background: '#ffffff', autoPaginate: false },
  'merge-image': { direction: 'vertical', pageWidth: 1920, spacing: 24, background: '#ffffff', align: 'start', preventUpscale: false, useMaxAssetSize: false, outputFormat: 'JPEG', quality: 90 },
  'merge-gif': { width: 1080, height: 1080, interval: 500, background: '#ffffff', loop: true, useMaxAssetSize: false },
  'manual-crop': {
    ratio: '16:9 电影',
    ratioValue: '16:9',
    currentIndex: 0,
    completedIds: [],
    cropAreas: {},
    helpOpen: false,
    lastCompletedCropSeed: null,
    angle: 0,
    flipHorizontal: false,
    flipVertical: false,
    viewScale: 1,
    viewOffsetX: 0,
    viewOffsetY: 0,
    stageWidth: 1600,
    stageHeight: 900,
    outerAreaMode: 'trim',
    snapEnabled: true,
    snapStrength: 'low',
    lockAspectRatio: false,
    sessionOutputPath: '',
    keepOriginalFormat: true,
  },
}

function cloneDefaultConfigs() {
  return Object.fromEntries(
    Object.entries(DEFAULT_CONFIGS).map(([toolId, config]) => [toolId, { ...config }]),
  )
}

const state = {
  activeTool: DEFAULT_TOOL,
  lastWorkspaceTool: DEFAULT_TOOL,
  searchQuery: '',
  destinationPath: '',
  isProcessing: false,
  cancelRequested: false,
  processingProgress: null,
  activeRun: null,
  settings: {
    defaultSavePath: '',
    saveLocationMode: 'source',
    saveLocationCustomPath: '',
    performanceMode: 'balanced',
    queueThumbnailSize: '128',
    defaultPresetByTool: {},
  },
  settingsDialog: null,
  presetDialog: null,
  confirmDialog: null,
  presetsByTool: {},
  previewModal: null,
  resultView: null,
  sidebarCollapsed: false,
  assets: [],
  notifications: [],
  configs: cloneDefaultConfigs(),
}

export function getState() {
  return state
}

function rebuildAssetIndex(assets = state.assets) {
  const next = new Map()
  const nextPaths = new Set()
  for (let index = 0; index < assets.length; index += 1) {
    const asset = assets[index]
    const assetId = asset?.id
    if (!assetId) continue
    next.set(assetId, index)
    const sourcePath = asset?.sourcePath
    if (sourcePath) nextPaths.add(sourcePath)
  }
  assetIndexById = next
  assetPathSet = nextPaths
}

function setAssets(nextAssets) {
  state.assets = nextAssets
  rebuildAssetIndex(nextAssets)
}

function appendResultStateDebugLog(event, payload = {}) {
  try {
    globalThis?.imgbatch?.appendLaunchDebugLog?.(event, payload)
  } catch {
    // Ignore debug log failures.
  }
}

function findAssetIndexById(assetId) {
  return assetIndexById.has(assetId) ? assetIndexById.get(assetId) : -1
}

function hasAssetSourcePath(sourcePath) {
  return sourcePath ? assetPathSet.has(sourcePath) : false
}

export function getAssetById(assetId) {
  const assetIndex = findAssetIndexById(assetId)
  return assetIndex === -1 ? null : state.assets[assetIndex]
}

export function getAssetIndexById(assetId) {
  return findAssetIndexById(assetId)
}

export function subscribe(listener) {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function batchStateUpdates(task) {
  if (typeof task !== 'function') return
  batchDepth += 1
  try {
    task()
  } finally {
    batchDepth = Math.max(0, batchDepth - 1)
    if (!batchDepth && emitQueued) {
      emitQueued = false
      emitNow()
    }
  }
}

export function setState(patch) {
  if (!patch || typeof patch !== 'object') return
  const keys = Object.keys(patch)
  if (!keys.length) return
  let changed = false
  for (let index = 0; index < keys.length; index += 1) {
    const key = keys[index]
    const value = patch[key]
    if (state[key] !== value) {
      changed = true
      break
    }
  }
  if (!changed) return
  Object.assign(state, patch)
  if (Array.isArray(patch?.assets)) {
    rebuildAssetIndex(patch.assets)
  }
  emit()
}

export function updateSettings(patch) {
  if (!patch || typeof patch !== 'object') return
  const keys = Object.keys(patch)
  if (!keys.length) return
  const nextSettings = { ...state.settings }
  let changed = false
  for (let index = 0; index < keys.length; index += 1) {
    const key = keys[index]
    const value = patch[key]
    if (nextSettings[key] !== value) {
      nextSettings[key] = value
      changed = true
    }
  }
  if (!changed) return
  state.settings = nextSettings
  emit()
}

export function setSettingsDialog(settingsDialog) {
  if (state.settingsDialog === settingsDialog) return
  state.settingsDialog = settingsDialog
  emit()
}

export function setPresetDialog(presetDialog) {
  if (state.presetDialog === presetDialog) return
  state.presetDialog = presetDialog
  emit()
}

export function setConfirmDialog(confirmDialog) {
  if (state.confirmDialog === confirmDialog) return
  state.confirmDialog = confirmDialog
  emit()
}

export function setToolPresets(toolId, presets, emitChange = true) {
  const nextPresets = Array.isArray(presets) ? presets : []
  if (state.presetsByTool?.[toolId] === nextPresets) return
  state.presetsByTool = {
    ...state.presetsByTool,
    [toolId]: nextPresets,
  }
  if (emitChange) emit()
}

export function setPreviewModal(previewModal) {
  if (state.previewModal === previewModal) return
  state.previewModal = previewModal
  emit()
}

export function setResultView(resultView) {
  if (state.resultView === resultView) return
  state.resultView = resultView
  emit()
}

function markPreviewAssetsStale(toolId) {
  if (!PREVIEW_SAVE_TOOLS.has(toolId)) return
  let nextAssets = null
  for (let index = 0; index < state.assets.length; index += 1) {
    const asset = state.assets[index]
    const nextAsset = markAssetPreviewStale(asset, toolId)
    if (nextAsset !== asset) {
      if (!nextAssets) nextAssets = [...state.assets]
      nextAssets[index] = nextAsset
    }
  }
  if (nextAssets) setAssets(nextAssets)
}

export function updateConfig(toolId, patch) {
  const currentConfig = state.configs[toolId] || {}
  if (!patch || typeof patch !== 'object') return
  const keys = Object.keys(patch)
  if (!keys.length) return
  let nextConfig = null
  for (let index = 0; index < keys.length; index += 1) {
    const key = keys[index]
    const value = patch[key]
    if (currentConfig[key] === value) continue
    if (!nextConfig) nextConfig = { ...currentConfig }
    nextConfig[key] = value
  }
  if (!nextConfig) return
  state.configs[toolId] = nextConfig
  markPreviewAssetsStale(toolId)
  emit()
}

export function replaceConfig(toolId, config) {
  const currentConfig = state.configs[toolId] || {}
  const nextConfig = {
    ...(DEFAULT_CONFIGS[toolId] ? { ...DEFAULT_CONFIGS[toolId] } : {}),
    ...(config && typeof config === 'object' ? config : {}),
  }
  const currentKeys = Object.keys(currentConfig)
  const nextKeys = Object.keys(nextConfig)
  let changed = currentKeys.length !== nextKeys.length
  if (!changed) {
    for (let index = 0; index < nextKeys.length; index += 1) {
      const key = nextKeys[index]
      if (currentConfig[key] !== nextConfig[key]) {
        changed = true
        break
      }
    }
  }
  if (!changed) return
  state.configs[toolId] = nextConfig
  markPreviewAssetsStale(toolId)
  emit()
}

export function setActiveTool(toolId) {
  const nextToolId = String(toolId || '').trim() || DEFAULT_TOOL
  const previousToolId = state.activeTool
  const previousLastWorkspaceTool = state.lastWorkspaceTool
  if (nextToolId !== 'manual-crop') {
    state.lastWorkspaceTool = nextToolId
  } else if (previousToolId && previousToolId !== 'manual-crop') {
    state.lastWorkspaceTool = previousToolId
  }
  if (previousToolId === nextToolId && previousLastWorkspaceTool === state.lastWorkspaceTool) return
  state.activeTool = nextToolId
  emit()
}

export function setSearchQuery(value) {
  if (state.searchQuery === value) return
  state.searchQuery = value
  emit()
}

export function replaceAssets(assets) {
  const nextAssets = assets.map(createAssetState)
  if (
    nextAssets.length === state.assets.length
    && nextAssets.every((asset, index) => state.assets[index]?.sourcePath === asset.sourcePath)
  ) return
  setAssets(nextAssets)
  emit()
}

export function appendAssets(assets) {
  const next = [...state.assets]
  const existingSourcePaths = new Set(
    state.assets
      .map((asset) => asset?.sourcePath)
      .filter(Boolean),
  )
  let appendedCount = 0
  for (const asset of assets) {
    const sourcePath = asset?.sourcePath || ''
    if (sourcePath && !existingSourcePaths.has(sourcePath)) {
      next.push(createAssetState(asset))
      existingSourcePaths.add(sourcePath)
      assetPathSet.add(sourcePath)
      appendedCount += 1
    }
  }
  if (!appendedCount) return 0
  setAssets(next)
  emit()
  return appendedCount
}

export function removeAsset(assetId) {
  const assetIndex = findAssetIndexById(assetId)
  if (assetIndex === -1) return
  const removedAsset = state.assets[assetIndex]
  const nextAssets = [...state.assets]
  nextAssets.splice(assetIndex, 1)
  if (removedAsset?.sourcePath) assetPathSet.delete(removedAsset.sourcePath)
  setAssets(nextAssets)
  emit()
}

export function updateAssetListThumbnail(assetId, listThumbnailUrl, emitChange = true) {
  if (!assetId || !listThumbnailUrl) return
  let changed = false
  if (emitChange) {
    const assetIndex = findAssetIndexById(assetId)
    if (assetIndex !== -1 && state.assets[assetIndex]?.listThumbnailUrl !== listThumbnailUrl) {
      const nextAssets = [...state.assets]
      nextAssets[assetIndex] = {
        ...state.assets[assetIndex],
        listThumbnailUrl,
      }
      setAssets(nextAssets)
      changed = true
    }
  } else {
    const assetIndex = findAssetIndexById(assetId)
    const asset = assetIndex === -1 ? null : state.assets[assetIndex]
    if (asset && asset.listThumbnailUrl !== listThumbnailUrl) {
      asset.listThumbnailUrl = listThumbnailUrl
      changed = true
    }
  }
  if (changed && emitChange) emit()
}

export function applyRunResult(result) {
  if (!result) return

  const processedItems = Array.isArray(result.processed) ? result.processed : []
  const failedItems = Array.isArray(result.failed) ? result.failed : []
  const isMergedOutput = MERGE_OUTPUT_TOOLS.has(result.toolId)
  let changed = false

  if (result.runId) {
    const nextActiveRun = { runId: result.runId, runFolderName: result.runFolderName || '', toolId: result.toolId, mode: result.mode || 'direct' }
    const currentActiveRun = state.activeRun
    if (
      !currentActiveRun
      || currentActiveRun.runId !== nextActiveRun.runId
      || currentActiveRun.runFolderName !== nextActiveRun.runFolderName
      || currentActiveRun.toolId !== nextActiveRun.toolId
      || currentActiveRun.mode !== nextActiveRun.mode
    ) {
      state.activeRun = nextActiveRun
      changed = true
    }
  }

  let nextAssets = null
  const ensureNextAssets = () => {
    if (!nextAssets) nextAssets = [...state.assets]
    return nextAssets
  }
  const applyAssetAtIndex = (assetIndex, updater) => {
    if (assetIndex < 0 || assetIndex >= state.assets.length) return
    const currentAsset = (nextAssets || state.assets)[assetIndex]
    const nextAsset = updater(currentAsset)
    if (nextAsset === currentAsset) return
    ensureNextAssets()[assetIndex] = nextAsset
  }

  if (isMergedOutput) {
    const mergedProcessed = processedItems[0]
    if (mergedProcessed && state.assets.length) {
      applyAssetAtIndex(0, (asset) => applyProcessedAsset(asset, mergedProcessed, result))
    }
  } else {
    for (let index = 0; index < processedItems.length; index += 1) {
      const processed = processedItems[index]
      const assetIndex = findAssetIndexById(processed?.assetId)
      if (assetIndex === -1) continue
      applyAssetAtIndex(assetIndex, (asset) => applyProcessedAsset(asset, processed, result))
    }
  }

  for (let index = 0; index < failedItems.length; index += 1) {
    const failed = failedItems[index]
    const assetIndex = findAssetIndexById(failed?.assetId)
    if (assetIndex === -1) continue
    applyAssetAtIndex(assetIndex, (asset) => mergeAssetPatch(asset, {
      status: 'error',
      error: failed.error || '处理失败',
    }))
  }

  if (nextAssets) {
    setAssets(nextAssets)
    changed = true
    appendResultStateDebugLog('result-state-after-apply', {
      mode: result?.mode || '',
      toolId: result?.toolId || '',
      processedCount: processedItems.length,
      assets: processedItems.map((processed) => {
        const asset = getAssetById(processed?.assetId)
        return {
          assetId: processed?.assetId || '',
          previewStatus: asset?.previewStatus || '',
          stagedToolId: asset?.stagedToolId || '',
          stagedOutputPath: asset?.stagedOutputPath || '',
          savedOutputPath: asset?.savedOutputPath || '',
          outputPath: asset?.outputPath || '',
          saveSignature: asset?.saveSignature || '',
        }
      }),
    })
  }

  if (result.mode === 'save' || result.mode === 'direct' || result.mode === 'preview-save') {
    const nextResultView = buildResultView(result, state.assets)
    if (!areResultViewsEquivalent(state.resultView, nextResultView)) {
      state.resultView = nextResultView
      changed = true
    }
  }

  if (result.mode === 'preview-only' && state.resultView !== null) {
    state.resultView = null
    changed = true
  }

  if (!changed) return
  emit()
}

export function moveAsset(assetId, direction) {
  const index = findAssetIndexById(assetId)
  if (index === -1) return
  const nextIndex = direction === 'up' ? index - 1 : index + 1
  if (nextIndex < 0 || nextIndex >= state.assets.length) return
  const next = [...state.assets]
  ;[next[index], next[nextIndex]] = [next[nextIndex], next[index]]
  setAssets(next)
  emit()
}

export function moveAssetToTarget(assetId, targetAssetId, placement = 'before') {
  if (!assetId || !targetAssetId || assetId === targetAssetId) return
  const fromIndex = findAssetIndexById(assetId)
  const targetIndex = findAssetIndexById(targetAssetId)
  if (fromIndex === -1 || targetIndex === -1) return

  const next = [...state.assets]
  const [moved] = next.splice(fromIndex, 1)
  const adjustedTargetIndex = fromIndex < targetIndex ? targetIndex - 1 : targetIndex
  const insertIndex = placement === 'after' ? adjustedTargetIndex + 1 : adjustedTargetIndex
  next.splice(Math.max(0, Math.min(insertIndex, next.length)), 0, moved)
  setAssets(next)
  emit()
}

export function pushNotification(notification) {
  const item = { id: crypto.randomUUID(), ...notification }
  const next = state.notifications.slice()
  next.push(item)
  if (next.length > 4) {
    next.splice(0, next.length - 4)
  }
  state.notifications = next
  emit()
  return item
}

export function dismissNotification(id) {
  const current = state.notifications
  const index = current.findIndex((item) => item.id === id)
  if (index === -1) return
  const next = current.slice()
  next.splice(index, 1)
  state.notifications = next
  emit()
}

function createAssetState(asset) {
  const normalizedFormat = normalizeAssetFormat(asset?.inputFormat || asset?.ext)
  return {
    ...asset,
    listThumbnailUrl: asset.listThumbnailUrl || asset.thumbnailUrl || '',
    ext: normalizedFormat || asset.ext || '',
    inputFormat: normalizedFormat || '',
    status: asset.status || 'idle',
    outputPath: asset.outputPath || '',
    error: asset.error || '',
    warning: asset.warning || '',
    previewStatus: asset.previewStatus || 'idle',
    previewUrl: asset.previewUrl || '',
    stagedOutputPath: asset.stagedOutputPath || '',
    stagedOutputName: asset.stagedOutputName || '',
    stagedSizeBytes: asset.stagedSizeBytes || 0,
    stagedWidth: asset.stagedWidth || 0,
    stagedHeight: asset.stagedHeight || 0,
    savedOutputPath: asset.savedOutputPath || '',
    runId: asset.runId || '',
    runFolderName: asset.runFolderName || '',
    stagedToolId: asset.stagedToolId || '',
    saveSignature: asset.saveSignature || '',
  }
}

function markAssetPreviewStale(asset, toolId) {
  if (asset.stagedToolId !== toolId) return asset
  if (!['staged', 'saving', 'previewed'].includes(asset.previewStatus)) return asset
  return {
    ...asset,
    previewStatus: 'stale',
  }
}

function normalizeAssetFormat(value) {
  const format = String(value || '').trim().toLowerCase()
  if (format === 'jpg') return 'jpeg'
  if (format === 'tif') return 'tiff'
  return format
}

function applyProcessedAsset(asset, processed, result) {
  const targetKb = Number(result?.config?.targetSizeKb) || 0
  const targetBytes = targetKb > 0 ? targetKb * 1024 : 0
  const derivedWarning = processed.warning
    || (result?.toolId === 'compression' && result?.config?.mode === 'target' && targetBytes > 0 && Number(processed?.outputSizeBytes) > targetBytes
      ? `未达到目标体积 ${targetKb} KB，当前结果约 ${Math.max(1, Math.round(Number(processed?.outputSizeBytes || 0) / 1024))} KB。`
      : '')

  if (result.mode === 'preview-save' || result.mode === 'preview-only') {
    const isBatchResult = result.mode === 'preview-save'
    const nextSavedPath = processed.savedOutputPath ?? processed.outputPath ?? ''
    const nextPreviewStatus = processed.previewStatus || (nextSavedPath ? 'saved' : (isBatchResult ? 'staged' : 'previewed'))
    return mergeAssetPatch(asset, {
      status: 'done',
      error: '',
      warning: derivedWarning,
      outputPath: processed.outputPath || nextSavedPath || '',
      previewStatus: nextPreviewStatus,
      previewUrl: processed.previewUrl || '',
      stagedOutputPath: nextPreviewStatus === 'saved' ? '' : (processed.stagedPath || ''),
      stagedOutputName: processed.outputName || '',
      stagedSizeBytes: processed.outputSizeBytes || 0,
      stagedWidth: processed.width || 0,
      stagedHeight: processed.height || 0,
      savedOutputPath: nextSavedPath,
      runId: processed.runId || result.runId || '',
      runFolderName: processed.runFolderName || result.runFolderName || '',
      stagedToolId: result.toolId,
      saveSignature: processed.saveSignature || '',
    })
  }

  if (result.mode === 'save') {
    const nextSavedPath = processed.savedOutputPath ?? processed.outputPath ?? ''
    return mergeAssetPatch(asset, {
      status: 'done',
      error: '',
      warning: derivedWarning,
      outputPath: processed.outputPath || '',
      previewStatus: 'saved',
      savedOutputPath: nextSavedPath,
      stagedOutputName: processed.outputName || asset.stagedOutputName || '',
      stagedSizeBytes: processed.outputSizeBytes || asset.stagedSizeBytes || 0,
      stagedWidth: processed.width || asset.stagedWidth || 0,
      stagedHeight: processed.height || asset.stagedHeight || 0,
      stagedOutputPath: nextSavedPath ? asset.stagedOutputPath : '',
      runId: asset.runId || result.runId || '',
      runFolderName: processed.runFolderName || asset.runFolderName || result.runFolderName || '',
      stagedToolId: result.toolId || asset.stagedToolId || '',
      saveSignature: processed.saveSignature || asset.saveSignature || '',
    })
  }

  return mergeAssetPatch(asset, {
    status: 'done',
    outputPath: processed.outputPath || '',
    savedOutputPath: processed.outputPath || '',
    previewStatus: 'saved',
    stagedOutputName: processed.outputName || asset.stagedOutputName || '',
    stagedSizeBytes: processed.outputSizeBytes || asset.stagedSizeBytes || 0,
    stagedWidth: processed.width || asset.stagedWidth || 0,
    stagedHeight: processed.height || asset.stagedHeight || 0,
    error: '',
    warning: derivedWarning,
    runId: processed.runId || result.runId || asset.runId || '',
    runFolderName: processed.runFolderName || result.runFolderName || asset.runFolderName || '',
    stagedToolId: result.toolId || asset.stagedToolId || '',
    saveSignature: processed.saveSignature || asset.saveSignature || '',
  })
}

function mergeAssetPatch(asset, patch) {
  if (!asset || !patch || typeof patch !== 'object') return asset
  let changed = false
  for (const key of Object.keys(patch)) {
    const value = patch[key]
    if (asset[key] !== value) {
      changed = true
      break
    }
  }
  return changed ? { ...asset, ...patch } : asset
}

function buildResultView(result, assets = []) {
  const processed = Array.isArray(result?.processed) ? result.processed : []
  const failed = Array.isArray(result?.failed) ? result.failed : []
  const isMergedOutput = MERGE_OUTPUT_TOOLS.has(result?.toolId)
  const items = []
  let totalSourceSizeBytes = 0
  let totalResultSizeBytes = 0
  for (const item of processed) {
    const nextItem = isMergedOutput
      ? buildMergedResultViewItem(item, assets)
      : buildResultViewItem(item, getResultViewSourceAsset(item?.assetId, assets))
    if (nextItem.outputPath) {
      items.push(nextItem)
      totalSourceSizeBytes += Math.max(0, Number(nextItem.source?.sizeBytes) || 0)
      totalResultSizeBytes += Math.max(0, Number(nextItem.result?.sizeBytes) || 0)
    }
  }

  return {
    runId: result?.runId || '',
    toolId: result?.toolId || '',
    mode: result?.mode || 'direct',
    items,
    failed,
    elapsedMs: Number(result?.elapsedMs) || 0,
    totalSourceSizeBytes,
    totalResultSizeBytes,
    createdAt: Date.now(),
  }
}

function getResultViewSourceAsset(assetId, assets = []) {
  if (!assetId) return null
  if (assets === state.assets) {
    const assetIndex = findAssetIndexById(assetId)
    return assetIndex === -1 ? null : state.assets[assetIndex]
  }
  for (let index = 0; index < assets.length; index += 1) {
    const asset = assets[index]
    if (asset?.id === assetId) return asset
  }
  return null
}

function areResultViewsEquivalent(current, next) {
  if (current === next) return true
  if (!current || !next) return false
  if (current.runId !== next.runId) return false
  if (current.toolId !== next.toolId) return false
  if (current.mode !== next.mode) return false
  if ((current.elapsedMs || 0) !== (next.elapsedMs || 0)) return false
  if ((current.totalSourceSizeBytes || 0) !== (next.totalSourceSizeBytes || 0)) return false
  if ((current.totalResultSizeBytes || 0) !== (next.totalResultSizeBytes || 0)) return false
  if (!areResultItemListsEquivalent(current.items, next.items)) return false
  if (!areFailedItemListsEquivalent(current.failed, next.failed)) return false
  return true
}

function areResultItemListsEquivalent(currentItems = [], nextItems = []) {
  if (currentItems === nextItems) return true
  if (currentItems.length !== nextItems.length) return false
  for (let index = 0; index < currentItems.length; index += 1) {
    const current = currentItems[index]
    const next = nextItems[index]
    if (!current || !next) return false
    if (current.assetId !== next.assetId) return false
    if (current.outputPath !== next.outputPath) return false
    if (current.afterUrl !== next.afterUrl) return false
    if (current.summary !== next.summary) return false
    if (!areResultSourceEquivalent(current.source, next.source)) return false
    if (!areResultSourceEquivalent(current.result, next.result)) return false
  }
  return true
}

function areResultSourceEquivalent(current, next) {
  if (current === next) return true
  if (!current || !next) return false
  return (
    current.name === next.name
    && (current.sizeBytes || 0) === (next.sizeBytes || 0)
    && (current.width || 0) === (next.width || 0)
    && (current.height || 0) === (next.height || 0)
    && (current.dimensionsText || '') === (next.dimensionsText || '')
    && Boolean(current.isAggregate) === Boolean(next.isAggregate)
  )
}

function areFailedItemListsEquivalent(currentItems = [], nextItems = []) {
  if (currentItems === nextItems) return true
  if (currentItems.length !== nextItems.length) return false
  for (let index = 0; index < currentItems.length; index += 1) {
    const current = currentItems[index]
    const next = nextItems[index]
    if (!current || !next) return false
    if (current.assetId !== next.assetId) return false
    if ((current.error || '') !== (next.error || '')) return false
  }
  return true
}

function buildResultViewItem(processed, asset) {
  const sourceName = asset?.name || processed?.name || processed?.outputName || ''
  const resultName = processed?.outputName || getPathFileName(processed?.savedOutputPath || processed?.outputPath || processed?.stagedPath) || sourceName
  const resultWidth = processed?.width || asset?.stagedWidth || asset?.width || 0
  const resultHeight = processed?.height || asset?.stagedHeight || asset?.height || 0
  const resultSizeBytes = processed?.outputSizeBytes || asset?.stagedSizeBytes || asset?.sizeBytes || 0
  const outputPath = processed?.savedOutputPath || processed?.outputPath || processed?.stagedPath || asset?.savedOutputPath || asset?.stagedOutputPath || ''

  return {
    assetId: processed?.assetId || asset?.id || '',
    name: sourceName,
    beforeUrl: asset?.thumbnailUrl || '',
    afterUrl: processed?.previewUrl || processed?.outputPath || processed?.savedOutputPath || processed?.stagedPath || '',
    outputPath,
    source: {
      name: sourceName,
      sizeBytes: asset?.sizeBytes || 0,
      width: asset?.width || 0,
      height: asset?.height || 0,
    },
    result: {
      name: resultName,
      sizeBytes: resultSizeBytes,
      width: resultWidth,
      height: resultHeight,
    },
    summary: processed?.summary || '',
  }
}

function buildMergedResultViewItem(processed, assets = []) {
  const sourceAssets = Array.isArray(assets) ? assets : []
  const sourceName = processed?.name || processed?.outputName || (sourceAssets[0]?.name || '')
  const resultName = processed?.outputName || getPathFileName(processed?.savedOutputPath || processed?.outputPath || processed?.stagedPath) || sourceName
  const resultWidth = processed?.width || 0
  const resultHeight = processed?.height || 0
  const resultSizeBytes = processed?.outputSizeBytes || 0
  const outputPath = processed?.savedOutputPath || processed?.outputPath || processed?.stagedPath || ''
  const sourceSizeBytes = sourceAssets.reduce((sum, asset) => sum + Math.max(0, Number(asset?.sizeBytes) || 0), 0)
  const sourceCount = sourceAssets.length

  return {
    assetId: processed?.assetId || sourceAssets[0]?.id || '',
    name: sourceName,
    beforeUrl: sourceAssets[0]?.thumbnailUrl || '',
    afterUrl: processed?.previewUrl || processed?.outputPath || processed?.savedOutputPath || processed?.stagedPath || '',
    outputPath,
    source: {
      name: sourceName,
      sizeBytes: sourceSizeBytes,
      width: 0,
      height: 0,
      dimensionsText: sourceCount ? `共 ${sourceCount} 张输入` : '-',
      isAggregate: true,
    },
    result: {
      name: resultName,
      sizeBytes: resultSizeBytes,
      width: resultWidth,
      height: resultHeight,
    },
    summary: processed?.summary || '',
  }
}

function getPathFileName(value = '') {
  const normalized = String(value || '').replaceAll('\\', '/')
  return normalized.split('/').pop() || ''
}

function emitNow() {
  for (const listener of listeners) listener(state)
}

function emit() {
  if (batchDepth > 0) {
    emitQueued = true
    return
  }
  emitNow()
}
