export function hasBridge() {
  return typeof window !== 'undefined' && !!window.imgbatch
}

const FALLBACK_FORMAT_CAPABILITIES = {
  formats: {
    PNG: { key: 'PNG', canonical: 'png', supportsQuality: true, supportsTransparency: true, supportsTransparentCanvasOutput: true },
    JPEG: { key: 'JPEG', canonical: 'jpeg', supportsQuality: true, supportsTransparency: false, supportsTransparentCanvasOutput: false },
    WEBP: { key: 'WEBP', canonical: 'webp', supportsQuality: true, supportsTransparency: true, supportsTransparentCanvasOutput: true },
    TIFF: { key: 'TIFF', canonical: 'tiff', supportsQuality: true, supportsTransparency: true, supportsTransparentCanvasOutput: false },
    AVIF: { key: 'AVIF', canonical: 'avif', supportsQuality: true, supportsTransparency: true, supportsTransparentCanvasOutput: true },
    GIF: { key: 'GIF', canonical: 'gif', supportsQuality: false, supportsTransparency: true, supportsTransparentCanvasOutput: true },
    BMP: { key: 'BMP', canonical: 'bmp', supportsQuality: false, supportsTransparency: false, supportsTransparentCanvasOutput: false },
    ICO: { key: 'ICO', canonical: 'ico', supportsQuality: false, supportsTransparency: true, supportsTransparentCanvasOutput: true },
  },
  aliases: {
    PNG: 'PNG',
    JPEG: 'JPEG',
    JPG: 'JPEG',
    WEBP: 'WEBP',
    WebP: 'WEBP',
    TIFF: 'TIFF',
    TIF: 'TIFF',
    AVIF: 'AVIF',
    GIF: 'GIF',
    BMP: 'BMP',
    ICO: 'ICO',
  },
}

let cachedFormatCapabilities = null

export async function importItems(items) {
  if (hasBridge()) {
    return window.imgbatch.loadInputs(items)
  }

  return browserImportItems(items)
}

export async function openInputDialog(options = {}) {
  if (!hasBridge() || typeof window.imgbatch.showOpenDialog !== 'function') return null
  return window.imgbatch.showOpenDialog(options)
}

export async function showMainWindow() {
  if (!hasBridge() || typeof window.imgbatch.showMainWindow !== 'function') return false
  return window.imgbatch.showMainWindow()
}

export async function savePreset(toolId, preset) {
  if (!hasBridge()) return []
  return window.imgbatch.savePreset(toolId, preset)
}

export async function loadPresets(toolId) {
  if (!hasBridge()) return []
  return window.imgbatch.loadPresets(toolId)
}

export async function renamePreset(toolId, presetId, name) {
  if (!hasBridge()) return []
  return window.imgbatch.renamePreset(toolId, presetId, name)
}

export async function deletePreset(toolId, presetId) {
  if (!hasBridge()) return []
  return window.imgbatch.deletePreset(toolId, presetId)
}

export async function runTool(toolId, config, assets, destinationPath, options = {}) {
  if (!hasBridge()) {
    return {
      ok: false,
      toolId,
      config,
      assets,
      destinationPath,
      message: `处理占位：${toolId} 尚未接入宿主执行管线`,
    }
  }

  return window.imgbatch.runTool(toolId, config, assets, destinationPath, options)
}

export async function prepareRunPayload(toolId, config, assets, destinationPath, options = {}) {
  if (!hasBridge() || typeof window.imgbatch.prepareRunPayload !== 'function') {
    return {
      toolId,
      config,
      assets,
      destinationPath,
      baseDestinationPath: destinationPath,
      runFolderName: '',
      mode: 'direct',
    }
  }
  return window.imgbatch.prepareRunPayload(toolId, config, assets, destinationPath, options)
}

export async function cancelRun(runId) {
  if (!hasBridge() || typeof window.imgbatch.cancelRun !== 'function') return false
  return window.imgbatch.cancelRun(runId)
}

export async function stageToolPreview(toolId, config, assets, destinationPath, mode = 'preview-save', options = {}) {
  if (!hasBridge()) {
    return runTool(toolId, config, assets, destinationPath, options)
  }
  return window.imgbatch.stageToolPreview(toolId, config, assets, destinationPath, mode, options)
}

export async function saveStagedResult(toolId, stagedItem, destinationPath) {
  if (!hasBridge()) {
    return {
      ok: false,
      toolId,
      stagedItem,
      destinationPath,
      message: `保存占位：${toolId} 尚未接入宿主执行管线`,
    }
  }
  return window.imgbatch.saveStagedResult(toolId, stagedItem, destinationPath)
}

export async function saveAllStagedResults(toolId, stagedItems, destinationPath) {
  if (!hasBridge()) {
    return {
      ok: false,
      toolId,
      stagedItems,
      destinationPath,
      message: `保存占位：${toolId} 尚未接入宿主执行管线`,
    }
  }
  return window.imgbatch.saveAllStagedResults(toolId, stagedItems, destinationPath)
}

export async function materializePreviewResults(toolId, stagedItems, destinationPath, preferredRunFolderName = '') {
  if (!hasBridge() || typeof window.imgbatch.materializePreviewResults !== 'function') {
    return {
      ok: false,
      partial: false,
      toolId,
      stagedItems,
      destinationPath,
      processed: [],
      failed: [],
      message: '预览复用功能尚未接入宿主执行管线',
    }
  }
  return window.imgbatch.materializePreviewResults(toolId, stagedItems, destinationPath, preferredRunFolderName)
}

export function cleanupPreviewCache(runFolderNames = []) {
  if (!hasBridge() || typeof window.imgbatch.cleanupPreviewCache !== 'function') return false
  return window.imgbatch.cleanupPreviewCache(runFolderNames)
}

export function clearPreviewCacheDirectory() {
  if (!hasBridge() || typeof window.imgbatch.clearPreviewCacheDirectory !== 'function') return false
  return window.imgbatch.clearPreviewCacheDirectory()
}

export function createAssetDisplayUrl(filePath, inputFormat = '') {
  if (!hasBridge() || typeof window.imgbatch.createAssetDisplayUrl !== 'function') return ''
  return window.imgbatch.createAssetDisplayUrl(filePath, inputFormat)
}

export function checkStagedFiles(stagedItems = []) {
  if (!hasBridge() || typeof window.imgbatch.checkStagedFiles !== 'function') {
    return stagedItems
      .filter((item) => item?.assetId && item?.stagedPath)
      .map((item) => item.assetId)
  }
  return window.imgbatch.checkStagedFiles(stagedItems)
}

export async function revealPath(targetPath) {
  if (!hasBridge() || typeof window.imgbatch.revealPath !== 'function') return false
  return window.imgbatch.revealPath(targetPath)
}

export async function replaceOriginals(items) {
  if (!hasBridge() || typeof window.imgbatch.replaceOriginals !== 'function') {
    return { ok: false, processed: [], failed: [], message: '替换原图功能尚未接入宿主执行管线' }
  }
  return window.imgbatch.replaceOriginals(items)
}

export async function resolveInputPaths(items = []) {
  if (!hasBridge() || typeof window.imgbatch.resolveInputPaths !== 'function') return []
  return window.imgbatch.resolveInputPaths(items)
}

export async function loadSettings() {
  if (!hasBridge() || typeof window.imgbatch.loadSettings !== 'function') {
    return {
      defaultSavePath: '',
      saveLocationMode: 'source',
      saveLocationCustomPath: '',
      performanceMode: 'balanced',
      queueThumbnailSize: '128',
      defaultPresetByTool: {},
    }
  }
  return window.imgbatch.loadSettings()
}

export async function saveSettings(settings) {
  if (!hasBridge() || typeof window.imgbatch.saveSettings !== 'function') {
    return {
      defaultSavePath: settings?.defaultSavePath || '',
      saveLocationMode: settings?.saveLocationMode || 'source',
      saveLocationCustomPath: settings?.saveLocationCustomPath || '',
      performanceMode: settings?.performanceMode || 'balanced',
      queueThumbnailSize: settings?.queueThumbnailSize || '128',
      defaultPresetByTool: settings?.defaultPresetByTool || {},
    }
  }
  return window.imgbatch.saveSettings(settings)
}

export async function regenerateQueueThumbnails(assets = []) {
  if (!hasBridge() || typeof window.imgbatch.regenerateQueueThumbnails !== 'function') return false
  await window.imgbatch.regenerateQueueThumbnails(assets)
  return true
}

export function buildStagedItems(assets = []) {
  if (!hasBridge() || typeof window.imgbatch.buildStagedItems !== 'function') {
    return assets
      .filter((asset) => asset?.previewStatus === 'staged' && asset?.stagedOutputPath)
      .map((asset) => ({
        assetId: asset.id,
        name: asset.name,
        stagedPath: asset.stagedOutputPath,
        outputName: asset.stagedOutputName,
        runId: asset.runId,
        runFolderName: asset.runFolderName,
        toolId: asset.stagedToolId,
      }))
  }
  return window.imgbatch.buildStagedItems(assets)
}

export async function getLaunchInputs(options = {}) {
  if (!hasBridge() || typeof window.imgbatch.getLaunchInputs !== 'function') return []
  return window.imgbatch.getLaunchInputs(options)
}

export async function loadConsumedHostLaunchSignatures() {
  if (!hasBridge() || typeof window.imgbatch.loadConsumedHostLaunchSignatures !== 'function') return []
  return window.imgbatch.loadConsumedHostLaunchSignatures()
}

export async function saveConsumedHostLaunchSignatures(signatures = []) {
  if (!hasBridge() || typeof window.imgbatch.saveConsumedHostLaunchSignatures !== 'function') return []
  return window.imgbatch.saveConsumedHostLaunchSignatures(signatures)
}

export function subscribeLaunchInputs(callback) {
  if (!hasBridge() || typeof window.imgbatch.subscribeLaunchInputs !== 'function') return false
  return window.imgbatch.subscribeLaunchInputs(callback)
}

export function subscribeQueueThumbnails(callback) {
  if (typeof window === 'undefined' || typeof callback !== 'function') return false
  const handler = (event) => callback(event?.detail || {})
  window.addEventListener('imgbatch-queue-thumbnail-ready', handler)
  return () => window.removeEventListener('imgbatch-queue-thumbnail-ready', handler)
}

export function getEnvironment() {
  if (!hasBridge()) {
    return {
      appName: 'Browser',
      isWindows: false,
      isMacOS: false,
      isLinux: false,
    }
  }

  return window.imgbatch.getEnvironment()
}

export function getFormatCapabilities() {
  if (cachedFormatCapabilities) return cachedFormatCapabilities
  if (hasBridge() && typeof window.imgbatch.getFormatCapabilities === 'function') {
    cachedFormatCapabilities = window.imgbatch.getFormatCapabilities()
    return cachedFormatCapabilities
  }
  cachedFormatCapabilities = FALLBACK_FORMAT_CAPABILITIES
  return cachedFormatCapabilities
}

export function getFormatCapability(format) {
  const capabilities = getFormatCapabilities()
  const key = capabilities.aliases?.[String(format || '').trim()] || String(format || '').trim().toUpperCase()
  return capabilities.formats?.[key] || null
}

async function browserImportItems(items = []) {
  const files = items.filter((item) => item instanceof File && item.type.startsWith('image/'))
  return Promise.all(files.map(readBrowserFileMeta))
}

async function readBrowserFileMeta(file, index) {
  const thumbnailUrl = URL.createObjectURL(file)
  const dimensions = await readImageDimensions(thumbnailUrl)
  return {
    id: `browser-${index}-${crypto.randomUUID()}`,
    sourcePath: file.name,
    name: file.name,
    ext: file.name.includes('.') ? file.name.split('.').pop().toLowerCase() : 'image',
    sizeBytes: file.size,
    width: dimensions.width,
    height: dimensions.height,
    thumbnailUrl,
    listThumbnailUrl: thumbnailUrl,
    status: 'idle',
    outputPath: '',
    error: '',
    selected: false,
    overrides: {},
  }
}

function readImageDimensions(src) {
  return new Promise((resolve) => {
    const image = new Image()
    image.onload = () => resolve({ width: image.naturalWidth, height: image.naturalHeight })
    image.onerror = () => resolve({ width: 0, height: 0 })
    image.src = src
  })
}
