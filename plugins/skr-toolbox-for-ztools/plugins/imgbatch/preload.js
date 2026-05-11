const { ipcRenderer, nativeImage, shell } = require('electron')
const fs = require('fs')
const os = require('os')
const path = require('path')
const { execFileSync, fork } = require('child_process')
const { getManualCropDisplaySize: computeManualCropDisplaySize, getManualCropStageMetrics: computeManualCropStageMetrics } = require('./lib/manual-crop-stage.cjs')

const IMAGE_EXTENSIONS = new Set([
  '.png', '.jpg', '.jpeg', '.webp', '.bmp', '.gif', '.tiff', '.tif', '.avif', '.ico'
])
const TRANSPARENT_BG = { r: 0, g: 0, b: 0, alpha: 0 }
const OPAQUE_WHITE_BG = { r: 255, g: 255, b: 255, alpha: 1 }
const SHARP_INPUT_FORMATS = new Set(['png', 'jpg', 'jpeg', 'webp', 'tiff', 'tif', 'avif', 'gif', 'bmp', 'ico'])
const DIRECT_SHARP_INPUT_FORMATS = new Set(['png', 'jpg', 'jpeg', 'webp', 'tiff', 'tif', 'avif', 'gif'])
const SHARP_OUTPUT_FORMATS = new Set(['png', 'jpeg', 'webp', 'tiff', 'avif', 'gif'])
const CUSTOM_OUTPUT_FORMATS = new Set(['bmp', 'ico'])
const TARGET_COMPRESSION_FORMATS = new Set(['jpeg', 'webp', 'avif'])
const ALPHA_CAPABLE_FORMATS = new Set(['png', 'webp', 'tiff', 'avif', 'gif', 'ico'])
const QUALITY_CAPABLE_FORMATS = new Set(['png', 'jpeg', 'webp', 'tiff', 'avif'])
const OUTPUT_DIR_NAME = 'Imgbatch Output'
const PREVIEW_DIR_NAME = 'Imgbatch Preview'
const LEGACY_DEBUG_LOG_DIR_NAME = 'Imgbatch Logs'
const SETTINGS_STORAGE_KEY = 'imgbatch:settings'
const CONSUMED_HOST_LAUNCH_SIGNATURES_STORAGE_KEY = 'imgbatch:consumed-host-launch-signatures'
const SAVE_LOCATION_MODES = new Set(['source', 'downloads', 'pictures', 'desktop', 'custom'])
const PERFORMANCE_MODES = new Set(['compatible', 'balanced', 'max'])
const QUEUE_THUMBNAIL_SIZE_OPTIONS = new Set(['60', '100', '128', '160', '192'])
const PREVIEW_SAVE_TOOLS = new Set(['compression', 'format', 'resize', 'watermark', 'corners', 'padding', 'crop', 'rotate', 'flip'])
const CPU_COUNT = Math.max(1, os.cpus()?.length || 1)
const HEAVY_ASSET_TOOLS = new Set(['compression', 'watermark', 'corners'])
const MEDIUM_ASSET_TOOLS = new Set(['format', 'resize', 'padding', 'crop', 'manual-crop', 'rotate', 'flip'])
const MERGE_TOOL_IDS = new Set(['merge-image', 'merge-pdf', 'merge-gif'])
const SINGLE_IMAGE_TOOL_IDS = new Set(['compression', 'format', 'resize', 'watermark', 'rotate', 'flip', 'corners', 'padding', 'crop', 'manual-crop'])
const ASSET_TOOL_HANDLERS = {
  compression: writeCompressionAsset,
  format: writeFormatAsset,
  resize: writeResizeAsset,
  watermark: writeWatermarkAsset,
  rotate: writeRotateAsset,
  flip: writeFlipAsset,
  corners: writeCornersAsset,
  padding: writePaddingAsset,
  crop: (sharpLib, asset, config, destinationPath) => writeCropAsset(sharpLib, asset, config, destinationPath, 'crop'),
}
const MERGE_TOOL_HANDLERS = {
  'merge-image': writeMergeImageAsset,
  'merge-pdf': writeMergePdfAssetResponsive,
  'merge-gif': writeMergeGifAsset,
}
const WATERMARK_IMAGE_CACHE = new Map()
const WATERMARK_OVERLAY_CACHE = new Map()
const WATERMARK_TEXT_CACHE = new Map()
const WATERMARK_TILED_CACHE = new Map()
const FALLBACK_IMAGE_BUFFER_CACHE = new Map()
const DISPLAY_URL_CACHE = new Map()
const QUEUE_THUMBNAIL_URL_CACHE = new Map()
const BMP_DECODE_CACHE = new Map()
const ICO_PNG_CACHE = new Map()
const ICO_METADATA_CACHE = new Map()
const INPUT_FORMAT_CACHE = new Map()
const ASSET_DESCRIPTOR_CACHE = new Map()
const CANCELLED_RUNS = new Set()
const ACTIVE_MERGE_WORKERS = new Map()
const DEFAULT_QUEUE_THUMBNAIL_SIZE = 128
const LAUNCH_DEBUG_LOG_PATH = path.join(os.tmpdir(), PREVIEW_DIR_NAME, 'launch-debug.log')
const PREVIEW_CACHE_DEBUG_LOG_PATH = path.join(os.tmpdir(), PREVIEW_DIR_NAME, 'preview-cache-debug.log')
const DETACHED_HEARTBEAT_FILE_NAME = 'preview-detached-heartbeat.json'
const DETACHED_HEARTBEAT_STALE_MS = 15000
const PDF_PAGE_SIZES = {
  A3: [841.89, 1190.55],
  A4: [595.28, 841.89],
  A5: [419.53, 595.28],
  Letter: [612, 792],
  Legal: [612, 1008],
}

const TOOL_LABELS = {
  compression: '图片压缩',
  format: '格式转换',
  resize: '修改尺寸',
  watermark: '添加水印',
  corners: '添加圆角',
  padding: '补边留白',
  crop: '裁剪',
  rotate: '旋转',
  flip: '翻转',
  'merge-pdf': '合并为 PDF',
  'merge-image': '合并为图片',
  'merge-gif': '合并为 GIF',
  'manual-crop': '手动裁剪',
}

function summarizeConfig(toolId, config = {}) {
  if (toolId === 'compression') return config.mode === 'quality' ? `压缩质量 ${config.quality}%` : `目标大小 ${config.targetSizeKb} KB`
  if (toolId === 'format') return `输出 ${config.targetFormat} / 质量 ${config.quality}%`
  if (toolId === 'resize') {
    if (config.sizeMode === 'max') return `尺寸 对齐最大宽高 / 质量 ${config.quality}%`
    if (config.sizeMode === 'min') return `尺寸 对齐最小宽高 / 质量 ${config.quality}%`
    return `尺寸 ${config.width.value}${config.width.unit} × ${config.height.value}${config.height.unit} / 质量 ${config.quality}%`
  }
  if (toolId === 'watermark') return `${config.type === 'text' ? '文本' : '图片'}水印 ${config.position} / 质量 ${config.quality}%`
  if (toolId === 'corners') {
    const radius = String(config.radius ?? '').trim()
    const unit = config.unit || 'px'
    return `圆角 ${radius ? (radius.endsWith('px') || radius.endsWith('%') ? radius : `${radius}${unit}`) : `0${unit}`} / 质量 ${config.quality}%`
  }
  if (toolId === 'padding') return config.unifiedMarginEnabled
    ? `留白 统一 ${formatMeasureLabel(config.unifiedMargin, 20)} / 质量 ${config.quality}%`
    : `留白 ${formatMeasureLabel(config.top, 20)}/${formatMeasureLabel(config.right, 20)}/${formatMeasureLabel(config.bottom, 20)}/${formatMeasureLabel(config.left, 20)} / 质量 ${config.quality}%`
  if (toolId === 'crop') return (config.mode || 'ratio') === 'size' ? `裁剪 ${config.area?.width}×${config.area?.height} / 质量 ${config.quality}%` : `裁剪 ${config.ratio} / 质量 ${config.quality}%`
  if (toolId === 'rotate') return `旋转 ${toNumber(config.angle, 0)}° / 质量 ${config.quality}%`
  if (toolId === 'flip') {
    const directions = [config.horizontal ? '左右' : '', config.vertical ? '上下' : ''].filter(Boolean)
    const outputFormat = String(config.outputFormat || 'Keep Original')
    const qualityText = outputFormat === 'Keep Original' || isQualityCapableFormat(outputFormat)
      ? ` / 质量 ${config.quality}%`
      : ''
    return directions.length
      ? `${directions.join(' + ')}翻转 / ${outputFormat}${qualityText}`
      : `未翻转 / ${outputFormat}${qualityText}`
  }
  if (toolId === 'merge-pdf') return `PDF ${config.pageSize} / ${config.margin}`
  if (toolId === 'merge-image') {
    const outputFormat = String(config.outputFormat || 'JPEG')
    const qualitySupported = isQualityCapableFormat(outputFormat)
    const spanLabel = config.direction === 'vertical' ? '宽度' : '高度'
    return `${config.direction === 'vertical' ? '纵向' : '横向'}拼接 ${spanLabel} ${config.pageWidth}px / ${outputFormat}${qualitySupported ? ` ${config.quality}%` : ''}${config.preventUpscale ? ' / 小图原尺寸' : ''}`
  }
  if (toolId === 'merge-gif') return `GIF ${config.width}×${config.height} / ${config.interval}ms`
  if (toolId === 'manual-crop') return `手动裁剪 ${config.ratio}`
  return '待处理'
}

function toNumber(value, fallback = 0) {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  const normalized = String(value ?? '').trim().replace(/[a-zA-Z%]+$/g, '')
  const numeric = Number.parseFloat(normalized)
  return Number.isFinite(numeric) ? numeric : fallback
}

function toInteger(value, fallback = 0) {
  return Math.round(toNumber(value, fallback))
}

function resolveMeasureOffset(value, total, fallback = 0) {
  if (value && typeof value === 'object') {
    const numericValue = Math.max(0, Number(value.value) || 0)
    if (value.unit === '%') return Math.round(total * (numericValue / 100))
    return Math.round(numericValue)
  }
  if (typeof value === 'string' && value.trim().endsWith('%')) {
    return Math.round(total * (toNumber(value, fallback) / 100))
  }
  return toInteger(value, fallback)
}

function clampNumber(value, min, max, fallback = min) {
  const numeric = toNumber(value, fallback)
  return Math.min(max, Math.max(min, numeric))
}

function sanitizeText(value, fallback = '') {
  const text = typeof value === 'string' ? value.trim() : ''
  return text || fallback
}

function safeInvoke(reader, fallback = null) {
  try {
    return typeof reader === 'function' ? reader() : fallback
  } catch {
    return fallback
  }
}

function summarizeLaunchValue(value, depth = 0) {
  if (value == null) return value
  if (typeof value === 'string') return value
  if (typeof value === 'number' || typeof value === 'boolean') return value
  if (Array.isArray(value)) {
    if (depth >= 1) return { type: 'array', length: value.length }
    return value.slice(0, 6).map((item) => summarizeLaunchValue(item, depth + 1))
  }
  if (typeof value === 'object') {
    const summary = {}
    const keys = Object.keys(value).slice(0, 10)
    for (const key of keys) {
      const item = value[key]
      if (typeof item === 'function') continue
      summary[key] = depth >= 1 ? typeof item : summarizeLaunchValue(item, depth + 1)
    }
    return summary
  }
  return typeof value
}

function appendLaunchDebugLog(event, payload = {}) {
  try {
    fs.mkdirSync(path.dirname(LAUNCH_DEBUG_LOG_PATH), { recursive: true })
    const record = {
      time: new Date().toISOString(),
      event,
      payload,
    }
    fs.appendFileSync(LAUNCH_DEBUG_LOG_PATH, `${JSON.stringify(record)}\n`, 'utf8')
  } catch {
    // Ignore debug log failures.
  }
}

function appendPreviewCacheDebugLog(event, payload = {}) {
  try {
    fs.mkdirSync(path.dirname(PREVIEW_CACHE_DEBUG_LOG_PATH), { recursive: true })
    const record = {
      time: new Date().toISOString(),
      event,
      payload,
    }
    fs.appendFileSync(PREVIEW_CACHE_DEBUG_LOG_PATH, `${JSON.stringify(record)}\n`, 'utf8')
  } catch {
    // Ignore debug log failures.
  }
}

function cleanupLegacyDebugLogDirectory() {
  const legacyDirPath = path.join(os.tmpdir(), LEGACY_DEBUG_LOG_DIR_NAME)
  try {
    fs.rmSync(legacyDirPath, { recursive: true, force: true })
  } catch {
    // Ignore legacy debug cleanup failures.
  }
}

function getDetachedHeartbeatPath() {
  return path.join(os.tmpdir(), PREVIEW_DIR_NAME, DETACHED_HEARTBEAT_FILE_NAME)
}

function normalizeQueueThumbnailSize(value) {
  const normalized = String(value ?? '').trim()
  return QUEUE_THUMBNAIL_SIZE_OPTIONS.has(normalized) ? normalized : String(DEFAULT_QUEUE_THUMBNAIL_SIZE)
}

function getQueueThumbnailMaxSize(settings = getAppSettings()) {
  return Number.parseInt(normalizeQueueThumbnailSize(settings?.queueThumbnailSize), 10) || DEFAULT_QUEUE_THUMBNAIL_SIZE
}

function pickOption(value, options, fallback) {
  return options.includes(value) ? value : fallback
}

function uniqueStrings(values = []) {
  return Array.from(new Set((Array.isArray(values) ? values : []).map((value) => sanitizeText(value)).filter(Boolean)))
}

function inferMeasureUnit(value, fallbackUnit = 'px') {
  const raw = String(value ?? '').trim()
  if (raw.endsWith('%')) return '%'
  if (raw.endsWith('px')) return 'px'
  return fallbackUnit
}

function normalizeMeasure(value, fallbackValue, fallbackUnit = 'px') {
  const raw = String(value ?? '').trim()
  const unit = inferMeasureUnit(raw, fallbackUnit)
  const numericValue = Math.max(0, toNumber(raw, fallbackValue))
  return {
    value: numericValue,
    unit,
    raw: raw || `${fallbackValue}${unit}`,
  }
}

function normalizeRunAssets(assets = []) {
  return assets.map((asset, index) => {
    const sourcePath = sanitizeText(asset?.sourcePath)
    const resolvedSourcePath = sourcePath ? path.resolve(sourcePath) : ''
    const sourceDir = resolvedSourcePath ? path.dirname(resolvedSourcePath) : ''
    const fallbackName = resolvedSourcePath ? path.basename(resolvedSourcePath) : `asset-${index + 1}`

    return {
      id: sanitizeText(asset?.id, `asset-${index + 1}`),
      sourcePath: resolvedSourcePath,
      sourceDir,
      name: sanitizeText(asset?.name, fallbackName),
      ext: sanitizeText(asset?.ext, resolvedSourcePath ? path.extname(resolvedSourcePath).replace('.', '').toLowerCase() : ''),
      width: Math.max(0, toInteger(asset?.width, 0)),
      height: Math.max(0, toInteger(asset?.height, 0)),
      sizeBytes: Math.max(0, toInteger(asset?.sizeBytes, 0)),
    }
  })
}

function getCommonParentDirectory(paths = []) {
  const absolutePaths = paths.map((item) => sanitizeText(item)).filter(Boolean).map((item) => path.resolve(item))
  if (!absolutePaths.length) return ''

  const roots = Array.from(new Set(absolutePaths.map((item) => path.parse(item).root.toLowerCase())))
  if (roots.length !== 1) return ''

  const firstRoot = path.parse(absolutePaths[0]).root
  const segmentLists = absolutePaths.map((item) => item.slice(path.parse(item).root.length).split(path.sep).filter(Boolean))
  const commonSegments = []

  for (let index = 0; index < segmentLists[0].length; index += 1) {
    const segment = segmentLists[0][index]
    const matches = segmentLists.every((segments) => segments[index] && segments[index].toLowerCase() === segment.toLowerCase())
    if (!matches) break
    commonSegments.push(segment)
  }

  if (!commonSegments.length) return ''
  return path.join(firstRoot, ...commonSegments)
}

function getWindowsKnownFolderFromRegistry(valueName, fallbackPath) {
  try {
    const output = execFileSync('reg', ['query', 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\User Shell Folders', '/v', valueName], {
      encoding: 'utf8',
      windowsHide: true,
    })
    const line = output.split(/\r?\n/).find((item) => item.includes(valueName))
    if (!line) return fallbackPath
    const match = line.match(/REG_\w+\s+(.+)$/)
    if (!match?.[1]) return fallbackPath
    const resolved = match[1].trim().replace(/%([^%]+)%/g, (_, key) => process.env[key] || '')
    return resolved || fallbackPath
  } catch {
    return fallbackPath
  }
}

function getSystemFolderPath(name) {
  const hostApi = getHostApi()
  const names = Array.isArray(name) ? name : [name]
  for (const item of names) {
    const resolved = sanitizeText(hostApi.getPath?.(item))
    if (resolved) return path.resolve(resolved)
  }

  if (process.platform === 'win32') {
    if (names.includes('desktop')) return path.resolve(getWindowsKnownFolderFromRegistry('Desktop', path.join(os.homedir(), 'Desktop')))
    if (names.includes('downloads')) return path.resolve(getWindowsKnownFolderFromRegistry('{374DE290-123F-4565-9164-39C4925E467B}', path.join(os.homedir(), 'Downloads')))
    if (names.includes('pictures')) return path.resolve(getWindowsKnownFolderFromRegistry('My Pictures', path.join(os.homedir(), 'Pictures')))
  }

  if (names.includes('desktop')) return path.join(os.homedir(), 'Desktop')
  if (names.includes('downloads')) return path.join(os.homedir(), 'Downloads')
  if (names.includes('pictures')) return path.join(os.homedir(), 'Pictures')
  return ''
}

function resolveConfiguredSavePath(settings = {}, assets = []) {
  const mode = SAVE_LOCATION_MODES.has(settings?.saveLocationMode) ? settings.saveLocationMode : 'source'
  const customPath = sanitizeText(settings?.saveLocationCustomPath || settings?.defaultSavePath)

  if (mode === 'custom' && customPath) {
    return {
      destinationPath: path.resolve(customPath),
      strategy: 'custom-setting',
    }
  }

  if (mode === 'downloads') {
    const targetPath = getSystemFolderPath(['downloads', 'download'])
    return {
      destinationPath: targetPath,
      strategy: 'downloads',
    }
  }

  if (mode === 'pictures') {
    const targetPath = getSystemFolderPath(['pictures', 'picture', 'images'])
    return {
      destinationPath: targetPath,
      strategy: 'pictures',
    }
  }

  if (mode === 'desktop') {
    const targetPath = getSystemFolderPath('desktop')
    return {
      destinationPath: targetPath,
      strategy: 'desktop',
    }
  }

  const sourceDirs = Array.from(new Set(assets.map((asset) => asset.sourceDir).filter(Boolean)))
  if (!sourceDirs.length) {
    return {
      destinationPath: '',
      strategy: 'unresolved',
    }
  }

  if (sourceDirs.length === 1) {
    return {
      destinationPath: sourceDirs[0],
      strategy: 'source-directory',
    }
  }

  const commonParent = getCommonParentDirectory(sourceDirs)
  if (commonParent) {
    return {
      destinationPath: commonParent,
      strategy: 'shared-parent',
    }
  }

  return {
    destinationPath: sourceDirs[0],
    strategy: 'first-source',
  }
}

function resolveDestinationPath(destinationPath, assets = [], settings = {}) {
  const customDestination = sanitizeText(destinationPath)
  if (customDestination) {
    return {
      destinationPath: path.resolve(customDestination),
      strategy: 'custom',
    }
  }

  return resolveConfiguredSavePath(settings, assets)
}

function buildRunFolderName(createdAt, toolId) {
  const stamp = new Date(createdAt || Date.now()).toISOString().replace(/[-:.]/g, '').replace('T', '-').replace('Z', '')
  return `${stamp}-${toolId}`
}

function createRunDescriptor(baseDestinationPath, toolId, createdAt, preferredRunFolderName = '') {
  const runId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
  const runFolderName = sanitizeText(preferredRunFolderName) || buildRunFolderName(createdAt, toolId)
  const runPath = path.join(baseDestinationPath, runFolderName)
  return {
    runId,
    runFolderName,
    runPath,
  }
}

function getAppSettings() {
  const hostApi = getHostApi()
  return hostApi.dbStorage?.getItem?.(SETTINGS_STORAGE_KEY) || {}
}

async function readOutputMeta(outputPath, sharpLib = null) {
  const stat = fs.statSync(outputPath)
  let width = 0
  let height = 0

  if (sharpLib) {
    try {
      const descriptor = await getAssetDescriptor(sharpLib, {
        sourcePath: outputPath,
        ext: path.extname(outputPath).replace('.', '').toLowerCase(),
      }, { probeMetadata: true })
      width = Number(descriptor?.width) || 0
      height = Number(descriptor?.height) || 0
    } catch {
      width = 0
      height = 0
    }
  } else {
    const image = nativeImage.createFromPath(outputPath)
    const size = image.isEmpty() ? { width: 0, height: 0 } : image.getSize()
    width = size.width
    height = size.height
  }

  return {
    outputPath,
    outputName: path.basename(outputPath),
    outputSizeBytes: stat.size,
    width,
    height,
  }
}

function createOutputMeta(outputPath, info = {}, fallback = {}) {
  return {
    outputPath,
    outputName: path.basename(outputPath),
    outputSizeBytes: Number(info.size) || Number(fallback.outputSizeBytes) || 0,
    width: Number(info.width) || Number(fallback.width) || 0,
    height: Number(info.height) || Number(fallback.height) || 0,
  }
}

function writeOutputBuffer(outputPath, buffer, info = {}, fallback = {}) {
  fs.writeFileSync(outputPath, buffer)
  const size = Number(buffer?.length ?? buffer?.byteLength) || Number(info?.size) || 0
  return createOutputMeta(outputPath, { ...info, size }, fallback)
}

function createAssetDisplayUrl(filePath, inputFormat = '') {
  const format = normalizeImageFormatName(inputFormat)
  if (format === 'bmp' || format === 'ico' || format === 'tiff') {
    try {
      const image = nativeImage.createFromPath(filePath)
      if (!image.isEmpty()) {
        const size = image.getSize()
        const maxDimension = Math.max(size.width || 0, size.height || 0)
        const previewImage = maxDimension > 2048
          ? image.resize({
              width: size.width >= size.height ? 2048 : undefined,
              height: size.height > size.width ? 2048 : undefined,
              quality: 'good',
            })
          : image
        return previewImage.toDataURL()
      }
    } catch {}
  }
  const normalized = String(filePath).replace(/\\/g, '/')
  const prefixed = normalized.startsWith('/') ? normalized : `/${normalized}`
  return encodeURI(`file://${prefixed}`)
}

function getDisplayUrlCacheKey(filePath, inputFormat = '') {
  try {
    const stat = fs.statSync(filePath)
    return `${path.resolve(filePath)}|${normalizeImageFormatName(inputFormat)}|${Number(stat.size) || 0}|${Number(stat.mtimeMs) || 0}`
  } catch {
    return `${path.resolve(filePath)}|${normalizeImageFormatName(inputFormat)}`
  }
}

function getThumbnailUrlCacheKey(filePath, inputFormat = '', maxDimension = QUEUE_THUMBNAIL_MAX_SIZE) {
  return `${getDisplayUrlCacheKey(filePath, inputFormat)}|thumb|${Number(maxDimension) || QUEUE_THUMBNAIL_MAX_SIZE}`
}

async function createAssetDisplayUrlAsync(filePath, inputFormat = '', sharpLib = null) {
  const format = normalizeImageFormatName(inputFormat)
  const cacheKey = getDisplayUrlCacheKey(filePath, format)
  if (DISPLAY_URL_CACHE.has(cacheKey)) return DISPLAY_URL_CACHE.get(cacheKey)

  const nativeUrl = createAssetDisplayUrl(filePath, format)
  if (nativeUrl && (format === 'bmp' || format === 'ico' || format === 'tiff' ? nativeUrl.startsWith('data:') : true)) {
    DISPLAY_URL_CACHE.set(cacheKey, nativeUrl)
    return nativeUrl
  }

  if (format === 'tiff' && sharpLib) {
    try {
      const buffer = await sharpLib(filePath, { animated: false })
        .resize({
          width: 2048,
          height: 2048,
          fit: 'inside',
          withoutEnlargement: true,
        })
        .png()
        .toBuffer()
      const dataUrl = `data:image/png;base64,${buffer.toString('base64')}`
      DISPLAY_URL_CACHE.set(cacheKey, dataUrl)
      return dataUrl
    } catch {}
  }

  DISPLAY_URL_CACHE.set(cacheKey, nativeUrl)
  return nativeUrl
}

async function createQueueThumbnailUrlAsync(filePath, inputFormat = '', sharpLib = null, maxDimension = getQueueThumbnailMaxSize()) {
  const format = normalizeImageFormatName(inputFormat)
  const cacheKey = getThumbnailUrlCacheKey(filePath, format, maxDimension)
  if (QUEUE_THUMBNAIL_URL_CACHE.has(cacheKey)) return QUEUE_THUMBNAIL_URL_CACHE.get(cacheKey)

  if (sharpLib) {
    try {
      const transformer = createTransformerFromInput(sharpLib, filePath, format)
      if (transformer) {
        const buffer = await transformer
        .resize({
          width: maxDimension,
          height: maxDimension,
          fit: 'cover',
          position: 'centre',
          withoutEnlargement: true,
        })
        .png()
        .toBuffer()
        const dataUrl = `data:image/png;base64,${buffer.toString('base64')}`
        QUEUE_THUMBNAIL_URL_CACHE.set(cacheKey, dataUrl)
        return dataUrl
      }
    } catch {}
  }

  try {
    const image = nativeImage.createFromPath(filePath)
    if (!image.isEmpty()) {
      const resized = image.resize({
        width: maxDimension,
        height: maxDimension,
        quality: 'good',
      })
      const dataUrl = resized.toDataURL()
      QUEUE_THUMBNAIL_URL_CACHE.set(cacheKey, dataUrl)
      return dataUrl
    }
  } catch {}

  const fallbackUrl = await createAssetDisplayUrlAsync(filePath, format, sharpLib)
  QUEUE_THUMBNAIL_URL_CACHE.set(cacheKey, fallbackUrl)
  return fallbackUrl
}

function queueQueueThumbnailGeneration(assetId, filePath, inputFormat = '', sharpLib = null, maxDimension = getQueueThumbnailMaxSize()) {
  if (!assetId || !filePath) return
  Promise.resolve()
    .then(() => createQueueThumbnailUrlAsync(filePath, inputFormat, sharpLib, maxDimension))
    .then((listThumbnailUrl) => {
      if (!listThumbnailUrl) return
      emitQueueThumbnailReady({ assetId, listThumbnailUrl })
    })
    .catch(() => {})
}

function copyAssetToOutput(asset, outputPath, sourceInput = null, fallback = asset) {
  if (sourceInput) fs.writeFileSync(outputPath, sourceInput)
  else fs.copyFileSync(asset.sourcePath, outputPath)
  return createOutputMeta(outputPath, {
    size: asset.sizeBytes,
    width: asset.width,
    height: asset.height,
  }, fallback)
}

function getAssetDimensionFallback(asset, width = asset?.width, height = asset?.height) {
  return {
    width: Math.max(0, Number(width) || 0),
    height: Math.max(0, Number(height) || 0),
  }
}

function formatMeasureLabel(value, fallbackValue = 0, fallbackUnit = 'px') {
  if (value && typeof value === 'object') {
    const numericValue = Math.max(0, Number(value.value) || fallbackValue)
    const unit = value.unit === '%' ? '%' : fallbackUnit
    return `${numericValue}${unit}`
  }
  const raw = String(value ?? '').trim()
  if (raw) return raw.endsWith('px') || raw.endsWith('%') ? raw : `${Math.max(0, toNumber(raw, fallbackValue))}${fallbackUnit}`
  return `${fallbackValue}${fallbackUnit}`
}

function applyOptionalMetadataPreservation(transformer, enabled) {
  if (!enabled || !transformer || typeof transformer.keepMetadata !== 'function') return transformer
  return transformer.keepMetadata()
}

function applyFormatOutputSettings(transformer, outputFormat, options = {}) {
  let nextTransformer = transformer
  if (typeof nextTransformer?.withIccProfile === 'function') {
    nextTransformer = nextTransformer.withIccProfile(options.colorProfile || 'srgb')
  }
  const keepTransparency = options.keepTransparency && isAlphaCapableFormat(outputFormat)
  if (!keepTransparency) {
    nextTransformer = nextTransformer.flatten({ background: hexToRgbaObject('#ffffff', 1) })
  }
  return nextTransformer
}

async function writeTransformedAsset(transformer, format, quality, outputPath, fallback = {}) {
  if (format === 'bmp') {
    const buffer = await createBmpBuffer(transformer)
    return writeOutputBuffer(outputPath, buffer, {}, fallback)
  }

  if (format === 'ico') {
    const { data, info } = await transformer
      .resize({ width: 256, height: 256, fit: 'inside', withoutEnlargement: true })
      .png({ compressionLevel: 9, effort: 10 })
      .toBuffer({ resolveWithObject: true })
    const buffer = createIcoBuffer(data, info.width || 256, info.height || 256)
    return writeOutputBuffer(outputPath, buffer, {
      width: info.width || fallback.width || 256,
      height: info.height || fallback.height || 256,
    }, fallback)
  }

  const info = await withOutputFormat(transformer, format, quality).toFile(outputPath)
  return createOutputMeta(outputPath, info, fallback)
}

function estimateCompressionQuality(originalSizeBytes, targetBytes) {
  if (!originalSizeBytes || !targetBytes) return 75
  const ratio = Math.max(0.02, Math.min(0.98, targetBytes / originalSizeBytes))
  const estimated = Math.round(12 + (78 * Math.sqrt(ratio)))
  return Math.max(1, Math.min(90, estimated))
}

async function resolveProcessedMeta(resultPath, result, sharpLib = null) {
  return (typeof result === 'object' && result?.outputPath && result?.outputSizeBytes
    ? createOutputMeta(resultPath, result, result)
    : null) || await readOutputMeta(resultPath, sharpLib)
}

function buildSaveSignature(toolId, config) {
  return JSON.stringify({ toolId, config: config || {} })
}

async function stageResultToProcessed(asset, result, payload, sharpLib = null) {
  const stagedPath = typeof result === 'string' ? result : result.outputPath
  const meta = await resolveProcessedMeta(stagedPath, result, sharpLib)
  const previewFormat = path.extname(stagedPath).replace('.', '') || meta.outputName.split('.').pop() || ''
  const previewUrl = await createAssetDisplayUrlAsync(stagedPath, previewFormat, sharpLib)
  const cacheBustedPreviewUrl = previewUrl && payload.runId && !previewUrl.startsWith('data:')
    ? `${previewUrl}${previewUrl.includes('?') ? '&' : '?'}v=${encodeURIComponent(payload.runId)}`
    : previewUrl
  return {
    assetId: asset.id,
    name: asset.name,
    mode: payload.mode,
    previewStatus: payload.mode === 'preview-save' ? 'staged' : 'previewed',
    outputName: meta.outputName,
    stagedPath,
    previewUrl: cacheBustedPreviewUrl,
    outputSizeBytes: typeof result === 'object' && result.outputSizeBytes ? result.outputSizeBytes : meta.outputSizeBytes,
    width: meta.width,
    height: meta.height,
    warning: result?.warning || '',
    saveSignature: buildSaveSignature(payload.toolId, payload.config),
    runId: payload.runId,
    runFolderName: payload.runFolderName,
    savedOutputPath: '',
  }
}

async function directResultToProcessed(asset, result, payload, sharpLib = null) {
  const outputPath = typeof result === 'string' ? result : result.outputPath
  const meta = await resolveProcessedMeta(outputPath, result, sharpLib)
  return {
    assetId: asset.id,
    name: asset.name,
    mode: 'direct',
    previewStatus: 'saved',
    outputPath,
    outputName: meta.outputName,
    outputSizeBytes: typeof result === 'object' && result.outputSizeBytes ? result.outputSizeBytes : meta.outputSizeBytes,
    width: meta.width,
    height: meta.height,
    warning: result?.warning || '',
    saveSignature: buildSaveSignature(payload.toolId, payload.config),
    runId: payload.runId,
    runFolderName: payload.runFolderName,
    savedOutputPath: outputPath || '',
  }
}

async function mapWithConcurrency(items, concurrency, iteratee, options = {}) {
  const list = Array.isArray(items) ? items : []
  if (!list.length) return []

  const workerCount = Math.max(1, Math.min(concurrency || 1, list.length))
  const results = new Array(list.length)
  let cursor = 0
  const shouldStop = typeof options.shouldStop === 'function' ? options.shouldStop : () => false

  if (workerCount === 1) {
    for (let index = 0; index < list.length; index += 1) {
      if (shouldStop()) break
      results[index] = await iteratee(list[index], index)
    }
    return results
  }

  async function worker() {
    while (cursor < list.length) {
      if (shouldStop()) break
      const index = cursor
      cursor += 1
      if (shouldStop()) break
      results[index] = await iteratee(list[index], index)
    }
  }

  await Promise.all(Array.from({ length: workerCount }, () => worker()))
  return results
}

async function mapIndexRangeWithConcurrency(start, end, concurrency, iteratee, options = {}) {
  const rangeSize = Math.max(0, end - start)
  if (!rangeSize) return []

  const workerCount = Math.max(1, Math.min(concurrency || 1, rangeSize))
  const results = new Array(rangeSize)
  let cursor = 0
  const shouldStop = typeof options.shouldStop === 'function' ? options.shouldStop : () => false

  if (workerCount === 1) {
    for (let offset = 0; offset < rangeSize; offset += 1) {
      if (shouldStop()) break
      results[offset] = await iteratee(start + offset, offset)
    }
    return results
  }

  async function worker() {
    while (cursor < rangeSize) {
      if (shouldStop()) break
      const offset = cursor
      cursor += 1
      if (shouldStop()) break
      results[offset] = await iteratee(start + offset, offset)
    }
  }

  await Promise.all(Array.from({ length: workerCount }, () => worker()))
  return results
}

function getAssetProcessingConcurrency(payload) {
  if (payload.mode === 'preview-only') return 1
  if (isMergeTool(payload.toolId)) return 1
  if (payload.assets.length <= 1) return 1
  const profile = getPerformanceProfile(getAppSettings().performanceMode)
  if (HEAVY_ASSET_TOOLS.has(payload.toolId)) {
    return Math.min(payload.assets.length, profile.heavyConcurrency)
  }
  if (MEDIUM_ASSET_TOOLS.has(payload.toolId)) {
    return Math.min(payload.assets.length, profile.mediumConcurrency)
  }
  return Math.min(payload.assets.length, profile.defaultConcurrency)
}

function formatResultMessage(payload, processed, failed) {
  const ok = processed.length > 0 && failed.length === 0
  const partial = processed.length > 0 && failed.length > 0
  const targetKb = Number(payload?.config?.targetSizeKb) || 0
  const targetBytes = targetKb > 0 ? targetKb * 1024 : 0
  const warningCount = processed.filter((item) => {
    if (item?.warning) return true
    if (payload?.toolId !== 'compression' || payload?.config?.mode !== 'target') return false
    return targetBytes > 0 && Number(item?.outputSizeBytes) > targetBytes
  }).length
  const warningSuffix = warningCount ? ` 其中 ${warningCount} 项未达到目标体积，已输出可达到的最小结果。` : ''
  if (payload.mode === 'preview-only') {
    if (ok) return `已生成 ${payload.toolLabel} 单张预览，可继续调整参数。${warningSuffix}`
    if (partial) return `${payload.toolLabel} 预览部分完成：成功 ${processed.length} 项，失败 ${failed.length} 项`
    return `${payload.toolLabel} 预览失败：${failed[0]?.error || '没有可处理的图片'}`
  }
  if (payload.mode === 'preview-save') {
    if (ok) return `已生成 ${payload.toolLabel} 处理结果：${processed.length} 项，可继续保存。${warningSuffix}`
    if (partial) return `${payload.toolLabel} 处理部分完成：成功 ${processed.length} 项，失败 ${failed.length} 项`
    return `${payload.toolLabel} 处理失败：${failed[0]?.error || '没有可处理的图片'}`
  }
  if (ok) return `已完成 ${payload.toolLabel}：${processed.length} 项，输出到 ${payload.destinationPath}${warningSuffix}`
  if (partial) return `${payload.toolLabel} 部分完成：成功 ${processed.length} 项，失败 ${failed.length} 项`
  return `${payload.toolLabel} 执行失败：${failed[0]?.error || '没有可处理的图片'}`
}

function buildSettingsPayload(settings = {}) {
  const defaultPresetByTool = settings?.defaultPresetByTool && typeof settings.defaultPresetByTool === 'object'
    ? Object.fromEntries(Object.entries(settings.defaultPresetByTool).map(([toolId, presetId]) => [sanitizeText(toolId), sanitizeText(presetId)]).filter((entry) => entry[0] && entry[1]))
    : {}
  const saveLocationMode = SAVE_LOCATION_MODES.has(settings?.saveLocationMode) ? settings.saveLocationMode : 'source'
  const saveLocationCustomPath = sanitizeText(settings?.saveLocationCustomPath || settings?.defaultSavePath)
  const performanceMode = PERFORMANCE_MODES.has(settings?.performanceMode) ? settings.performanceMode : 'balanced'
  const queueThumbnailSize = normalizeQueueThumbnailSize(settings?.queueThumbnailSize)
  return {
    defaultSavePath: saveLocationMode === 'custom' ? saveLocationCustomPath : '',
    saveLocationMode,
    saveLocationCustomPath,
    performanceMode,
    queueThumbnailSize,
    defaultPresetByTool,
  }
}

function normalizeRunConfig(toolId, config = {}) {
  if (toolId === 'compression') {
    return {
      mode: pickOption(config.mode, ['quality', 'target'], 'quality'),
      quality: clampNumber(config.quality, 1, 100, 85),
      targetSizeKb: Math.max(1, toInteger(config.targetSizeKb, 250)),
    }
  }

  if (toolId === 'format') {
    return {
      mode: pickOption(config.mode, ['convert', 'quality'], 'quality'),
      targetFormat: pickOption(String(config.targetFormat || '').toUpperCase(), ['PNG', 'JPEG', 'JPG', 'WEBP', 'TIFF', 'AVIF', 'GIF', 'BMP', 'ICO'], 'JPEG'),
      quality: clampNumber(config.quality, 1, 100, 90),
      keepTransparency: Boolean(config.keepTransparency),
      colorProfile: pickOption(String(config.colorProfile || '').toLowerCase(), ['srgb', 'p3', 'cmyk'], 'srgb'),
    }
  }

  if (toolId === 'resize') {
    return {
      sizeMode: pickOption(config.sizeMode, ['manual', 'max', 'min'], 'manual'),
      width: normalizeMeasure(config.width, 1920, inferMeasureUnit(config.width, 'px')),
      height: normalizeMeasure(config.height, 1080, inferMeasureUnit(config.height, 'px')),
      lockAspectRatio: Boolean(config.lockAspectRatio),
      quality: clampNumber(config.quality, 1, 100, 90),
    }
  }

  if (toolId === 'watermark') {
    const normalizedPosition = String(config.position || '').replace('center-left', 'middle-left').replace('center-right', 'middle-right')
    return {
      type: pickOption(config.type, ['text', 'image'], 'text'),
      text: sanitizeText(config.text, '批量处理'),
      position: pickOption(normalizedPosition, ['top-left', 'top-center', 'top-right', 'middle-left', 'center', 'middle-right', 'bottom-left', 'bottom-center', 'bottom-right'], 'center'),
      opacity: clampNumber(config.opacity, 0, 100, 60),
      fontSize: Math.max(1, toInteger(config.fontSize, 32)),
      color: sanitizeText(config.color, '#FFFFFF'),
      rotation: toNumber(config.rotation, 0),
      margin: Math.max(0, toInteger(config.margin, 24)),
      tiled: Boolean(config.tiled),
      density: clampNumber(config.density, 20, 250, 100),
      imagePath: sanitizeText(config.imagePath),
      quality: clampNumber(config.quality, 1, 100, 90),
    }
  }

  if (toolId === 'corners') {
    return {
      radius: Math.max(0, toNumber(config.radius, 24)),
      unit: inferMeasureUnit(config.radius, 'px'),
      background: sanitizeText(config.background, '#ffffff'),
      keepTransparency: Boolean(config.keepTransparency),
      quality: clampNumber(config.quality, 1, 100, 90),
    }
  }

  if (toolId === 'padding') {
    const unifiedMarginEnabled = Boolean(config.unifiedMarginEnabled)
    const unifiedMargin = normalizeMeasure(config.unifiedMargin, 20, inferMeasureUnit(config.unifiedMargin, 'px'))
    const top = normalizeMeasure(config.top, 20, inferMeasureUnit(config.top, 'px'))
    const right = normalizeMeasure(config.right, 20, inferMeasureUnit(config.right, 'px'))
    const bottom = normalizeMeasure(config.bottom, 20, inferMeasureUnit(config.bottom, 'px'))
    const left = normalizeMeasure(config.left, 20, inferMeasureUnit(config.left, 'px'))
    return {
      top: unifiedMarginEnabled ? unifiedMargin : top,
      right: unifiedMarginEnabled ? unifiedMargin : right,
      bottom: unifiedMarginEnabled ? unifiedMargin : bottom,
      left: unifiedMarginEnabled ? unifiedMargin : left,
      unifiedMarginEnabled,
      unifiedMargin,
      color: sanitizeText(config.color, '#ffffff'),
      opacity: clampNumber(config.opacity, 0, 100, 100),
      quality: clampNumber(config.quality, 1, 100, 90),
    }
  }

  if (toolId === 'crop') {
    const customRatioX = Math.max(1, toInteger(config.customRatioX, 16))
    const customRatioY = Math.max(1, toInteger(config.customRatioY, 9))
    const mode = config.mode === 'size' ? 'size' : 'ratio'
    const useCustomRatio = Boolean(config.useCustomRatio) || config.ratio === 'Custom'

    return {
      mode,
      ratio: useCustomRatio ? `${customRatioX}:${customRatioY}` : sanitizeText(config.ratio, '16:9'),
      useCustomRatio,
      customRatio: {
        x: customRatioX,
        y: customRatioY,
      },
      area: {
        x: typeof config.x === 'string' ? config.x : `${Math.max(0, toInteger(config.x, 0))}px`,
        y: typeof config.y === 'string' ? config.y : `${Math.max(0, toInteger(config.y, 0))}px`,
        width: Math.max(1, toInteger(config.width, 1920)),
        height: Math.max(1, toInteger(config.height, 1080)),
      },
      quality: clampNumber(config.quality, 1, 100, 90),
    }
  }

  if (toolId === 'rotate') {
    return {
      angle: clampNumber(config.angle, -360, 360, 0),
      autoCrop: Boolean(config.autoCrop),
      keepAspectRatio: Boolean(config.keepAspectRatio),
      background: sanitizeText(config.background, '#ffffff'),
      quality: clampNumber(config.quality, 1, 100, 90),
    }
  }

  if (toolId === 'flip') {
    return {
      horizontal: Boolean(config.horizontal),
      vertical: Boolean(config.vertical),
      preserveMetadata: Boolean(config.preserveMetadata),
      autoCropTransparent: Boolean(config.autoCropTransparent),
      outputFormat: sanitizeText(config.outputFormat, 'Keep Original'),
      quality: clampNumber(config.quality, 1, 100, 90),
    }
  }

  if (toolId === 'merge-pdf') {
    return {
      pageSize: pickOption(String(config.pageSize || ''), ['A3', 'A4', 'A5', 'Letter', 'Legal', 'Original'], 'A4'),
      margin: pickOption(String(config.margin || ''), ['none', 'narrow', 'normal', 'wide'], 'narrow'),
      background: sanitizeText(config.background, '#ffffff'),
      autoPaginate: Boolean(config.autoPaginate),
    }
  }

  if (toolId === 'merge-image') {
    return {
      direction: pickOption(config.direction, ['vertical', 'horizontal'], 'vertical'),
      pageWidth: Math.max(1, toInteger(config.pageWidth, 1920)),
      spacing: Math.max(0, toInteger(config.spacing, 24)),
      background: sanitizeText(config.background, '#ffffff'),
      align: pickOption(String(config.align || ''), ['start', 'center'], 'start'),
      preventUpscale: Boolean(config.preventUpscale),
      useMaxAssetSize: Boolean(config.useMaxAssetSize),
      outputFormat: pickOption(String(config.outputFormat || ''), ['PNG', 'JPEG', 'WebP'], 'JPEG'),
      quality: Math.max(1, Math.min(100, toInteger(config.quality, 90))),
    }
  }

  if (toolId === 'merge-gif') {
    return {
      width: Math.max(1, toInteger(config.width, 1080)),
      height: Math.max(1, toInteger(config.height, 1080)),
      interval: Math.max(10, toNumber(config.interval, 500)),
      background: sanitizeText(config.background, '#ffffff'),
      loop: config.loop !== false,
      useMaxAssetSize: Boolean(config.useMaxAssetSize),
    }
  }

  if (toolId === 'manual-crop') {
    return {
      ratio: sanitizeText(config.ratio, '16:9 Cinema'),
      ratioValue: sanitizeText(config.ratioValue, '16:9'),
      currentIndex: Math.max(0, toInteger(config.currentIndex, 0)),
      completedIds: uniqueStrings(config.completedIds),
      cropAreas: config.cropAreas && typeof config.cropAreas === 'object' ? config.cropAreas : {},
      angle: clampNumber(config.angle, -180, 180, 0),
      flipHorizontal: Boolean(config.flipHorizontal),
      flipVertical: Boolean(config.flipVertical),
      viewScale: clampNumber(config.viewScale, 0.5, 3, 1),
      viewOffsetX: toInteger(config.viewOffsetX, 0),
      viewOffsetY: toInteger(config.viewOffsetY, 0),
      stageWidth: Math.max(320, toInteger(config.stageWidth, 1600)),
      stageHeight: Math.max(240, toInteger(config.stageHeight, 900)),
      outerAreaMode: pickOption(String(config.outerAreaMode || ''), ['trim', 'white'], 'trim'),
      sessionOutputPath: sanitizeText(config.sessionOutputPath),
      keepOriginalFormat: config.keepOriginalFormat !== false,
    }
  }

  return { ...config }
}

function prepareRunPayload(toolId, config, assets, destinationPath, options = {}) {
  const normalizedAssets = normalizeRunAssets(Array.isArray(assets) ? assets : [])
  const normalizedConfig = normalizeRunConfig(toolId, config)
  if (toolId === 'resize' && normalizedConfig.sizeMode !== 'manual') {
    const dimensions = normalizedAssets
      .map((asset) => ({
        width: Math.max(0, Math.round(Number(asset?.width) || 0)),
        height: Math.max(0, Math.round(Number(asset?.height) || 0)),
      }))
      .filter((entry) => entry.width > 0 && entry.height > 0)
    if (dimensions.length) {
      const referenceSize = dimensions.slice(1).reduce((best, entry) => ({
        width: normalizedConfig.sizeMode === 'min' ? Math.min(best.width, entry.width) : Math.max(best.width, entry.width),
        height: normalizedConfig.sizeMode === 'min' ? Math.min(best.height, entry.height) : Math.max(best.height, entry.height),
      }), dimensions[0])
      normalizedConfig.width = normalizeMeasure(referenceSize.width, referenceSize.width, 'px')
      normalizedConfig.height = normalizeMeasure(referenceSize.height, referenceSize.height, 'px')
    }
  }
  const manualCropSessionPath = toolId === 'manual-crop' ? sanitizeText(normalizedConfig.sessionOutputPath) : ''
  if (manualCropSessionPath) {
    const createdAt = new Date().toISOString()
    const resolvedRunPath = path.resolve(manualCropSessionPath)
    return {
      toolId,
      toolLabel: TOOL_LABELS[toolId] || toolId,
      config: normalizedConfig,
      assets: normalizedAssets,
      destinationPath: resolvedRunPath,
      baseDestinationPath: path.dirname(resolvedRunPath),
      output: {
        destinationPath: path.dirname(resolvedRunPath),
        strategy: 'manual-crop-session',
      },
      queuedCount: normalizedAssets.length,
      summary: summarizeConfig(toolId, normalizedConfig),
      createdAt,
      runId: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      runFolderName: path.basename(resolvedRunPath),
    }
  }
  const output = resolveDestinationPath(destinationPath, normalizedAssets, getAppSettings())
  const createdAt = new Date().toISOString()
  const run = createRunDescriptor(output.destinationPath, toolId, createdAt, options?.preferredRunFolderName)

  return {
    toolId,
    toolLabel: TOOL_LABELS[toolId] || toolId,
    config: normalizedConfig,
    assets: normalizedAssets,
    destinationPath: run.runPath,
    baseDestinationPath: output.destinationPath,
    output,
    queuedCount: normalizedAssets.length,
    summary: summarizeConfig(toolId, normalizedConfig),
    createdAt,
    runId: run.runId,
    runFolderName: run.runFolderName,
  }
}

const pendingLaunchValues = []
const launchWaiters = new Set()
const launchSubscribers = new Set()
let launchHooksInstalled = false
let previewLifecycleCleanupInstalled = false
let delayedPreviewCleanupTimer = null
let lastHandledCopiedFilesSignature = ''
const pluginStartupAt = Date.now()
const MAX_CONSUMED_HOST_LAUNCH_SIGNATURES = 12
const CLIPBOARD_LAUNCH_LOOKBACK_MS = 15000
const CLIPBOARD_LAUNCH_POLL_INTERVAL_MS = 80
const CLIPBOARD_LAUNCH_POLL_TIMEOUT_MS = 420
const MAX_INITIAL_CLIPBOARD_TOKEN_AGE_MS = 1500

function getHostApi() {
  return globalThis.ztools || {}
}

function getCurrentWindowType() {
  return sanitizeText(getHostApi().getWindowType?.()).toLowerCase()
}

function isDetachedWindowType(windowType = '') {
  const normalized = sanitizeText(windowType).toLowerCase()
  return normalized.includes('detach') || normalized.includes('separate')
}

function readDetachedHeartbeatSnapshot(heartbeatFilePath) {
  try {
    const content = fs.readFileSync(heartbeatFilePath, 'utf8')
    const parsed = JSON.parse(content)
    return {
      exists: true,
      ts: Number(parsed?.ts) || 0,
      pid: Number(parsed?.pid) || 0,
      windowType: sanitizeText(parsed?.windowType).toLowerCase(),
    }
  } catch {
    return {
      exists: false,
      ts: 0,
      pid: 0,
      windowType: '',
    }
  }
}

function normalizeCopiedFilePaths(value) {
  return uniqueStrings(
    extractLaunchItems(value).map((item) => sanitizeText(item)).filter(Boolean),
  )
}

function buildLaunchPathSignature(paths = []) {
  return paths.map((item) => path.resolve(item)).sort((left, right) => left.localeCompare(right)).join('|')
}

function readCopiedFilesSnapshot() {
  const hostApi = getHostApi()
  const copiedValue = safeInvoke(() => hostApi.getCopyedFiles?.())
  const paths = normalizeCopiedFilePaths(copiedValue)
  return {
    value: copiedValue,
    paths,
    signature: buildLaunchPathSignature(paths),
  }
}

function extractClipboardHistoryEntries(value, visited = new Set()) {
  if (!value || visited.has(value)) return []
  if (Array.isArray(value)) return value.flatMap((item) => extractClipboardHistoryEntries(item, visited))
  if (typeof value !== 'object') return []
  visited.add(value)

  const directKeys = ['items', 'list', 'records', 'history', 'data', 'rows']
  for (const key of directKeys) {
    if (!value[key]) continue
    const entries = extractClipboardHistoryEntries(value[key], visited)
    if (entries.length) return entries
  }

  if (value.id != null || value.type != null || value.content != null || value.path != null || value.filePath != null) {
    return [value]
  }

  return Object.values(value).flatMap((item) => extractClipboardHistoryEntries(item, visited))
}

function buildClipboardLaunchToken(entry) {
  if (!entry || typeof entry !== 'object') return ''
  const parts = [
    sanitizeText(entry.id),
    sanitizeText(entry.type),
    sanitizeText(entry.createdAt),
    sanitizeText(entry.updatedAt),
    sanitizeText(entry.time),
    sanitizeText(entry.timestamp),
    sanitizeText(entry.path),
    sanitizeText(entry.filePath),
    sanitizeText(entry.name),
  ].filter(Boolean)
  if (!parts.length) return ''
  return parts.join('|')
}

function normalizeClipboardEntryTimestamp(value) {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value > 0 ? Math.round(value) : 0
  }
  const text = sanitizeText(value)
  if (!text) return 0
  const numeric = Number(text)
  if (Number.isFinite(numeric) && numeric > 0) {
    return Math.round(numeric)
  }
  const parsed = Date.parse(text)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0
}

function extractClipboardEntryTimestamp(entry) {
  if (!entry || typeof entry !== 'object') return 0
  return [
    entry.timestamp,
    entry.time,
    entry.updatedAt,
    entry.createdAt,
  ].map((value) => normalizeClipboardEntryTimestamp(value)).find((value) => value > 0) || 0
}

function pickLatestClipboardEntry(entries = []) {
  let latestEntry = null
  let latestTimestamp = 0
  for (const entry of Array.isArray(entries) ? entries : []) {
    if (!entry || typeof entry !== 'object') continue
    const entryTimestamp = extractClipboardEntryTimestamp(entry)
    if (!latestEntry || entryTimestamp > latestTimestamp) {
      latestEntry = entry
      latestTimestamp = entryTimestamp
    }
  }
  return {
    entry: latestEntry,
    entryTimestamp: latestTimestamp,
  }
}

function isRecentClipboardEntry(entryTimestamp, referenceTimestamp = pluginStartupAt) {
  if (!entryTimestamp || !referenceTimestamp) return false
  return entryTimestamp >= (referenceTimestamp - CLIPBOARD_LAUNCH_LOOKBACK_MS)
}

function getClipboardEntryAgeMs(entryTimestamp, referenceTimestamp = pluginStartupAt) {
  if (!entryTimestamp || !referenceTimestamp) return 0
  return referenceTimestamp - entryTimestamp
}

function isClipboardEntryAcceptableForBootstrap(entryTimestamp, referenceTimestamp = pluginStartupAt, maxInitialAgeMs = MAX_INITIAL_CLIPBOARD_TOKEN_AGE_MS) {
  if (!entryTimestamp || !referenceTimestamp) return false
  if (entryTimestamp >= referenceTimestamp) return true
  const ageMs = getClipboardEntryAgeMs(entryTimestamp, referenceTimestamp)
  return ageMs >= 0 && ageMs <= maxInitialAgeMs
}

async function readClipboardLaunchSnapshot() {
  const hostApi = getHostApi()
  const clipboardApi = hostApi.clipboard
  if (!clipboardApi) {
    return { token: '', entry: null, entryTimestamp: 0, historySummary: null, statusSummary: null }
  }

  const historyValues = await Promise.all([
    Promise.resolve(safeInvoke(() => clipboardApi.getHistory?.(1, 5, 'file'))),
    Promise.resolve(safeInvoke(() => clipboardApi.getHistory?.(1, 5, 'image'))),
    Promise.resolve(safeInvoke(() => clipboardApi.getHistory?.(1, 5))),
  ])
  const statusValue = await Promise.resolve(safeInvoke(() => clipboardApi.getStatus?.()))
  const historyEntries = historyValues.flatMap((value) => extractClipboardHistoryEntries(value))
  const { entry, entryTimestamp } = pickLatestClipboardEntry(historyEntries)
  const token = buildClipboardLaunchToken(entry)
  return {
    token,
    entry,
    entryTimestamp,
    historySummary: summarizeLaunchValue(historyValues),
    statusSummary: summarizeLaunchValue(statusValue),
  }
}

async function waitForRecentClipboardLaunchSnapshot(initialToken = '', referenceTimestamp = pluginStartupAt) {
  let snapshot = await readClipboardLaunchSnapshot()
  const deadline = Date.now() + CLIPBOARD_LAUNCH_POLL_TIMEOUT_MS

  while (Date.now() < deadline) {
    const snapshotToken = sanitizeText(snapshot.token)
    if (
      snapshotToken
      && snapshotToken !== initialToken
      && isClipboardEntryAcceptableForBootstrap(snapshot.entryTimestamp, referenceTimestamp)
    ) {
      break
    }
    await new Promise((resolve) => setTimeout(resolve, CLIPBOARD_LAUNCH_POLL_INTERVAL_MS))
    snapshot = await readClipboardLaunchSnapshot()
  }

  return snapshot
}

function loadConsumedHostLaunchSignaturesFromStorage() {
  const hostApi = getHostApi()
  const current = hostApi.dbStorage?.getItem?.(CONSUMED_HOST_LAUNCH_SIGNATURES_STORAGE_KEY)
  return Array.isArray(current)
    ? current.map((value) => sanitizeText(value)).filter(Boolean)
    : []
}

function rememberConsumedHostLaunchSignature(signature) {
  const normalizedSignature = sanitizeText(signature)
  if (!normalizedSignature) return []
  const hostApi = getHostApi()
  const current = loadConsumedHostLaunchSignaturesFromStorage()
  const next = [normalizedSignature, ...current.filter((value) => value !== normalizedSignature)]
    .slice(0, MAX_CONSUMED_HOST_LAUNCH_SIGNATURES)
  hostApi.dbStorage?.setItem?.(CONSUMED_HOST_LAUNCH_SIGNATURES_STORAGE_KEY, next)
  return next
}

function installPreviewLifecycleCleanup() {
  if (previewLifecycleCleanupInstalled) return
  previewLifecycleCleanupInstalled = true
  cleanupLegacyDebugLogDirectory()
  const heartbeatFilePath = getDetachedHeartbeatPath()

  const clearAllPreviewCache = () => {
    appendPreviewCacheDebugLog('clear-all-preview-cache')
    clearPreviewCacheDirectory({ reason: 'preload-clear-all-preview-cache' })
  }

  const cancelDelayedPreviewCleanup = () => {
    if (!delayedPreviewCleanupTimer) return
    clearTimeout(delayedPreviewCleanupTimer)
    delayedPreviewCleanupTimer = null
    appendPreviewCacheDebugLog('cancel-delayed-preview-cleanup')
  }

  const scheduleDelayedPreviewCleanup = () => {
    cancelDelayedPreviewCleanup()
    appendPreviewCacheDebugLog('schedule-delayed-preview-cleanup', {
      delayMs: 60 * 1000,
    })
    delayedPreviewCleanupTimer = setTimeout(() => {
      delayedPreviewCleanupTimer = null
      appendPreviewCacheDebugLog('run-delayed-preview-cleanup')
      clearAllPreviewCache()
    }, 60 * 1000)
  }

  const clearDetachedHeartbeatFile = (reason) => {
    try {
      fs.rmSync(heartbeatFilePath, { force: true })
    } catch {}
    appendPreviewCacheDebugLog('clear-detached-heartbeat-file', {
      heartbeatFilePath,
      reason,
    })
  }

  const writeDetachedHeartbeatFile = () => {
    const payload = {
      ts: Date.now(),
      pid: process.pid,
      windowType: getCurrentWindowType(),
    }
    try {
      fs.mkdirSync(path.dirname(heartbeatFilePath), { recursive: true })
      fs.writeFileSync(heartbeatFilePath, JSON.stringify(payload), 'utf8')
      appendPreviewCacheDebugLog('write-detached-heartbeat-file', {
        heartbeatFilePath,
        windowType: payload.windowType,
        pid: payload.pid,
      })
    } catch {}
  }

  const cleanupStaleDetachedPreviewCacheOnStartup = (windowType) => {
    if (isDetachedWindowType(windowType)) {
      writeDetachedHeartbeatFile()
      return
    }
    const heartbeat = readDetachedHeartbeatSnapshot(heartbeatFilePath)
    appendPreviewCacheDebugLog('check-detached-heartbeat-on-startup', {
      heartbeatFilePath,
      windowType,
      heartbeatExists: heartbeat.exists,
      heartbeatTs: heartbeat.ts,
      heartbeatAgeMs: heartbeat.ts ? (Date.now() - heartbeat.ts) : null,
      heartbeatWindowType: heartbeat.windowType,
    })
    if (!heartbeat.exists) return
    const heartbeatAgeMs = heartbeat.ts ? (Date.now() - heartbeat.ts) : Number.POSITIVE_INFINITY
    if (heartbeatAgeMs <= DETACHED_HEARTBEAT_STALE_MS) return
    appendPreviewCacheDebugLog('cleanup-stale-detached-preview-cache-on-startup', {
      heartbeatFilePath,
      heartbeatAgeMs,
    })
    clearAllPreviewCache()
    clearDetachedHeartbeatFile('startup-stale-detached-heartbeat')
  }

  const handlePluginOut = (source, isKill = false) => {
    const normalizedIsKill = Boolean(isKill)
    appendPreviewCacheDebugLog(source, {
      isKill: normalizedIsKill,
    })
    cancelDelayedPreviewCleanup()
    if (normalizedIsKill) {
      clearAllPreviewCache()
      return
    }
    scheduleDelayedPreviewCleanup()
  }

  const hostApi = getHostApi()
  const windowType = getCurrentWindowType()
  appendPreviewCacheDebugLog('install-preview-lifecycle-cleanup', {
    windowType,
    heartbeatFilePath,
  })
  cleanupStaleDetachedPreviewCacheOnStartup(windowType)
  hostApi.onPluginOut?.((isKill) => {
    handlePluginOut('host-plugin-out', isKill)
  })
  hostApi.onPluginEnter?.(() => {
    appendPreviewCacheDebugLog('host-plugin-enter')
    cancelDelayedPreviewCleanup()
  })
  hostApi.onPluginReady?.(() => {
    appendPreviewCacheDebugLog('host-plugin-ready')
    cancelDelayedPreviewCleanup()
  })
  hostApi.onPluginDetach?.(() => {
    const currentWindowType = getCurrentWindowType()
    appendPreviewCacheDebugLog('host-plugin-detach', {
      windowType: currentWindowType,
    })
    if (isDetachedWindowType(currentWindowType)) {
      writeDetachedHeartbeatFile()
    }
  })

  if (ipcRenderer?.on) {
    ipcRenderer.on('plugin-out', (_event, isKill) => {
      handlePluginOut('ipc-plugin-out', isKill)
    })
  }

  if (typeof process?.once === 'function') {
    process.once('exit', () => {
      appendPreviewCacheDebugLog('process-exit')
      cancelDelayedPreviewCleanup()
      clearDetachedHeartbeatFile('process-exit')
      clearAllPreviewCache()
    })
  }

  if (typeof globalThis?.addEventListener === 'function') {
    globalThis.addEventListener('unload', () => {
      appendPreviewCacheDebugLog('global-unload')
      cancelDelayedPreviewCleanup()
      clearDetachedHeartbeatFile('global-unload')
      clearAllPreviewCache()
    })
  }
}

function enqueueLaunchValue(value) {
  if (value == null) return
  appendLaunchDebugLog('enqueue-launch-value', {
    summary: summarizeLaunchValue(value),
    extractedItems: extractLaunchItems(value).slice(0, 12),
  })
  pendingLaunchValues.push(value)
  for (const waiter of launchWaiters) waiter()
  launchWaiters.clear()
  void flushLaunchSubscribers()
}

function installLaunchHooks() {
  if (launchHooksInstalled) return
  launchHooksInstalled = true

  const hostApi = getHostApi()
  if (!lastHandledCopiedFilesSignature) {
    lastHandledCopiedFilesSignature = readCopiedFilesSnapshot().signature
  }
  const handleLaunch = (param) => {
    appendLaunchDebugLog('launch-callback-raw', {
      summary: summarizeLaunchValue(param),
      extractedItems: extractLaunchItems(param).slice(0, 12),
      hasPayload: param?.payload != null,
      payloadSummary: param?.payload != null ? summarizeLaunchValue(param.payload) : null,
      payloadExtractedItems: param?.payload != null ? extractLaunchItems(param.payload).slice(0, 12) : [],
    })
    enqueueLaunchValue(param)
    if (param?.payload != null && param.payload !== param) {
      enqueueLaunchValue(param.payload)
    }
  }

  hostApi.onPluginEnter?.(handleLaunch)
  hostApi.onPluginReady?.(handleLaunch)
}

async function waitForLaunchValue(timeoutMs = 160) {
  installLaunchHooks()
  if (pendingLaunchValues.length) return

  await new Promise((resolve) => {
    const finish = () => {
      clearTimeout(timer)
      launchWaiters.delete(finish)
      resolve()
    }

    const timer = setTimeout(finish, timeoutMs)
    launchWaiters.add(finish)
  })
}

async function flushLaunchSubscribers() {
  if (!launchSubscribers.size || !pendingLaunchValues.length) return

  const values = pendingLaunchValues.splice(0, pendingLaunchValues.length)
  for (const subscriber of launchSubscribers) {
    try {
      await subscriber(values)
    } catch {
      // ignore subscriber errors so launch delivery keeps working
    }
  }
}

function extractLaunchItems(value, visited = new Set()) {
  if (!value || visited.has(value)) return []
  if (typeof value === 'string') return [value]
  if (Array.isArray(value)) return value.flatMap((item) => extractLaunchItems(item, visited))
  if (typeof value !== 'object') return []

  visited.add(value)

  const directKeys = ['files', 'paths', 'items', 'argv', 'arguments', 'args', 'payload', 'data', 'input', 'inputs', 'list', 'selected', 'selection', 'value', 'values', 'text', 'texts', 'pathList', 'fileList']
  for (const key of directKeys) {
    if (value[key]) {
      const extracted = extractLaunchItems(value[key], visited)
      if (extracted.length) return extracted
    }
  }

  if (typeof value.path === 'string') return [value.path]
  if (typeof value.filePath === 'string') return [value.filePath]
  if (typeof value.sourcePath === 'string') return [value.sourcePath]

  return Object.values(value).flatMap((item) => extractLaunchItems(item, visited))
}

function getPerformanceProfile(mode) {
  const normalized = PERFORMANCE_MODES.has(mode) ? mode : 'balanced'
  if (normalized === 'compatible') {
    return {
      mode: normalized,
      heavyConcurrency: Math.max(1, Math.min(3, Math.floor(CPU_COUNT / 6) || 1)),
      mediumConcurrency: Math.max(1, Math.min(6, Math.floor(CPU_COUNT / 3) || 1)),
      defaultConcurrency: Math.max(1, Math.min(4, Math.floor(CPU_COUNT / 4) || 1)),
      sharpConcurrency: Math.max(1, Math.min(CPU_COUNT, Math.floor(CPU_COUNT * 0.5) || 1)),
      cacheMemory: Math.min(256, Math.max(96, CPU_COUNT * 8)),
      cacheItems: Math.max(32, CPU_COUNT * 4),
    }
  }
  if (normalized === 'max') {
    return {
      mode: normalized,
      heavyConcurrency: Math.max(1, Math.min(8, Math.floor(CPU_COUNT / 3) || 1)),
      mediumConcurrency: Math.max(1, Math.min(16, Math.floor(CPU_COUNT * 0.75) || 1)),
      defaultConcurrency: Math.max(1, Math.min(12, Math.floor(CPU_COUNT / 2) || 1)),
      sharpConcurrency: Math.max(1, Math.min(CPU_COUNT, Math.floor(CPU_COUNT * 0.9) || 1)),
      cacheMemory: Math.min(768, Math.max(160, CPU_COUNT * 24)),
      cacheItems: Math.max(96, CPU_COUNT * 12),
    }
  }
  return {
    mode: normalized,
    heavyConcurrency: Math.max(1, Math.min(6, Math.floor(CPU_COUNT / 4) || 1)),
    mediumConcurrency: Math.max(1, Math.min(12, Math.floor(CPU_COUNT / 2) || 1)),
    defaultConcurrency: Math.max(1, Math.min(8, Math.floor(CPU_COUNT / 3) || 1)),
    sharpConcurrency: Math.max(1, Math.min(CPU_COUNT, Math.floor(CPU_COUNT * 0.75) || 1)),
    cacheMemory: Math.min(512, Math.max(128, CPU_COUNT * 16)),
    cacheItems: Math.max(64, CPU_COUNT * 8),
  }
}

function emitProcessingProgress(detail = {}) {
  if (typeof window === 'undefined' || typeof window.dispatchEvent !== 'function') return
  try {
    window.dispatchEvent(new CustomEvent('imgbatch-processing-progress', { detail }))
  } catch {
    // Ignore progress bridge errors so processing is not affected.
  }
}

function yieldToEventLoop() {
  return new Promise((resolve) => {
    setTimeout(resolve, 0)
  })
}

async function prepareMergePdfChildPayload(sharpLib, payload) {
  const sourceAssets = Array.isArray(payload?.assets) ? payload.assets : []
  if (!sourceAssets.length) return payload
  let tempDir = ''
  const preparedAssets = []

  try {
    for (const asset of sourceAssets) {
      throwIfRunCancelled(payload.runId)
      const nextAsset = { ...asset }
      const descriptor = await getAssetDescriptor(sharpLib, nextAsset, { probeMetadata: false })
      const directFormat = normalizeImageFormatName(descriptor?.inputFormat || nextAsset.inputFormat)
      const directKind = directFormat === 'png'
        ? 'png'
        : (directFormat === 'jpeg' || directFormat === 'jpg' ? 'jpg' : '')
      if (directKind) {
        nextAsset.inputFormat = directKind === 'jpg' ? 'jpeg' : directKind
        nextAsset.pdfEmbedKind = directKind
        preparedAssets.push(nextAsset)
        await yieldToEventLoop()
        continue
      }

      nextAsset.inputFormat = directFormat || normalizeImageFormatName(nextAsset.inputFormat || nextAsset.ext)
      const outputKind = isAlphaCapableFormat(nextAsset.inputFormat) ? 'png' : 'jpeg'
      if (!tempDir) {
        tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'imgbatch-merge-pdf-'))
      }
      const parsed = path.parse(nextAsset.sourcePath)
      const tempPath = path.join(tempDir, `${parsed.name || 'asset'}-${preparedAssets.length + 1}.${outputKind === 'jpeg' ? 'jpg' : 'png'}`)
      const transformed = outputKind === 'png'
        ? createTransformer(sharpLib, nextAsset).png()
        : createTransformer(sharpLib, nextAsset).jpeg({ quality: 100, mozjpeg: true })
      await transformed.toFile(tempPath)
      preparedAssets.push({
        ...nextAsset,
        sourcePath: tempPath,
        ext: outputKind,
        inputFormat: outputKind,
        pdfEmbedKind: outputKind === 'jpeg' ? 'jpg' : outputKind,
      })
      await yieldToEventLoop()
    }

    return {
      ...payload,
      assets: preparedAssets,
      mergePdfTempDir: tempDir || '',
    }
  } catch (error) {
    if (tempDir) {
      try {
        fs.rmSync(tempDir, { recursive: true, force: true })
      } catch {}
    }
    throw error
  }
}

function cleanupMergePdfChildPayload(payload) {
  const tempDir = sanitizeText(payload?.mergePdfTempDir)
  if (!tempDir) return
  try {
    fs.rmSync(tempDir, { recursive: true, force: true })
  } catch {}
}

function runMergePdfWorker(payload) {
  return new Promise((resolve, reject) => {
    const worker = fork(path.join(__dirname, 'workers', 'merge-pdf-worker.cjs'), [], {
      stdio: ['ignore', 'ignore', 'ignore', 'ipc'],
    })
    const runId = String(payload?.runId || '').trim()
    let settled = false
    const cleanup = () => {
      if (runId && ACTIVE_MERGE_WORKERS.get(runId) === worker) {
        ACTIVE_MERGE_WORKERS.delete(runId)
      }
      worker.removeAllListeners()
    }
    if (runId) {
      ACTIVE_MERGE_WORKERS.set(runId, worker)
    }
    worker.send({
      type: 'start',
      payload,
      performanceMode: getAppSettings().performanceMode || 'balanced',
    })
    worker.on('message', (message) => {
      if (!message || typeof message !== 'object') return
      if (message.type === 'progress') {
        emitProcessingProgress({
          runId: payload.runId,
          toolId: payload.toolId,
          toolLabel: payload.toolLabel,
          mode: payload.mode,
          ...message.detail,
        })
        return
      }
      if (message.type === 'result') {
        settled = true
        cleanup()
        try {
          worker.kill()
        } catch {}
        resolve(message.result)
        return
      }
      if (message.type === 'error') {
        settled = true
        cleanup()
        try {
          worker.kill()
        } catch {}
        const error = new Error(message.error || 'PDF 合并失败')
        if (message.code) error.code = message.code
        reject(error)
      }
    })
    worker.on('error', (error) => {
      if (settled) return
      settled = true
      cleanup()
      reject(error)
    })
    worker.on('exit', (code) => {
      if (settled) return
      settled = true
      cleanup()
      if (code === 0) {
        reject(new Error('PDF 合并已中止'))
      } else {
        const error = new Error(code === 1 ? 'PDF 合并已中止' : `PDF 合并 worker 退出异常 (${code})`)
        if (code === 1) error.code = 'RUN_CANCELLED'
        reject(error)
      }
    })
  })
}

function emitQueueThumbnailReady(detail = {}) {
  if (typeof window === 'undefined' || typeof window.dispatchEvent !== 'function') return
  try {
    window.dispatchEvent(new CustomEvent('imgbatch-queue-thumbnail-ready', { detail }))
  } catch {
    // Ignore thumbnail bridge errors so importing is not affected.
  }
}

function cancelRun(runId) {
  const normalized = String(runId || '').trim()
  if (!normalized) return false
  CANCELLED_RUNS.add(normalized)
  const worker = ACTIVE_MERGE_WORKERS.get(normalized)
  if (worker) {
    ACTIVE_MERGE_WORKERS.delete(normalized)
    try {
      worker.kill()
    } catch {}
  }
  return true
}

function clearCancelledRun(runId) {
  const normalized = String(runId || '').trim()
  if (!normalized) return
  CANCELLED_RUNS.delete(normalized)
}

function isRunCancelled(runId) {
  return CANCELLED_RUNS.has(String(runId || '').trim())
}

function throwIfRunCancelled(runId) {
  if (isRunCancelled(runId)) {
    const error = new Error('已停止当前任务。')
    error.code = 'RUN_CANCELLED'
    throw error
  }
}

function getSharp() {
  try {
    const sharp = require('sharp')
    const profile = getPerformanceProfile(getAppSettings().performanceMode)
    if (getSharp.configuredMode !== profile.mode) {
      sharp.concurrency(profile.sharpConcurrency)
      sharp.cache({ memory: profile.cacheMemory, items: profile.cacheItems, files: 0 })
      getSharp.configuredMode = profile.mode
    }
    return sharp
  } catch {
    return null
  }
}

async function regenerateQueueThumbnails(assets = []) {
  const sharpLib = getSharp()
  const queueThumbnailSize = getQueueThumbnailMaxSize()
  const sourceAssets = Array.isArray(assets) ? assets : []
  await Promise.all(sourceAssets.map(async (asset) => {
    const assetId = sanitizeText(asset?.id)
    const sourcePath = sanitizeText(asset?.sourcePath)
    if (!assetId || !sourcePath || !fs.existsSync(sourcePath)) return
    try {
      const listThumbnailUrl = await createQueueThumbnailUrlAsync(
        sourcePath,
        sanitizeText(asset?.inputFormat || asset?.ext),
        sharpLib,
        queueThumbnailSize,
      )
      if (!listThumbnailUrl) return
      emitQueueThumbnailReady({ assetId, listThumbnailUrl })
    } catch {}
  }))
}

function ensureDirectory(targetPath) {
  if (!targetPath) return
  fs.mkdirSync(targetPath, { recursive: true })
}

function mapOutputFormat(toolId, asset, config) {
  if (toolId === 'format') {
    const requested = String(config.targetFormat || '').toLowerCase()
    if (requested === 'jpg') return 'jpeg'
    if (CUSTOM_OUTPUT_FORMATS.has(requested)) return requested
    return SHARP_OUTPUT_FORMATS.has(requested) ? requested : 'jpeg'
  }

  const original = String(asset?.inputFormat || asset?.ext || '').toLowerCase()
  if (original === 'jpg') return 'jpeg'
  if (toolId === 'compression') {
    if (original === 'bmp') return 'jpeg'
    if (original === 'ico') return 'png'
  }
  if (CUSTOM_OUTPUT_FORMATS.has(original)) return original
  if (toolId === 'manual-crop') {
    if (config.keepOriginalFormat !== false) {
      return SHARP_OUTPUT_FORMATS.has(original) ? original : 'png'
    }
    return 'png'
  }
  return SHARP_OUTPUT_FORMATS.has(original) ? original : 'png'
}

function normalizeImageFormatName(format) {
  const normalized = String(format || '').trim().toLowerCase()
  if (normalized === 'jpg') return 'jpeg'
  if (normalized === 'tif') return 'tiff'
  return normalized
}

function resolveCanonicalInputFormat(detectedFormat, headerFormat = '', fallbackFormat = '') {
  const normalizedDetected = normalizeImageFormatName(detectedFormat)
  const normalizedHeader = normalizeImageFormatName(headerFormat)
  const normalizedFallback = normalizeImageFormatName(fallbackFormat)
  if (normalizedHeader === 'avif') return 'avif'
  if (normalizedDetected === 'heif' && normalizedFallback === 'avif') return 'avif'
  return normalizedDetected
}

function isFallbackDecodedInputFormat(format) {
  const normalized = normalizeImageFormatName(format)
  return normalized === 'bmp' || normalized === 'ico'
}

function isDirectSharpInputFormat(format) {
  return DIRECT_SHARP_INPUT_FORMATS.has(normalizeImageFormatName(format))
}

function createNativeImageFromInput(input) {
  try {
    if (Buffer.isBuffer(input)) {
      const image = nativeImage.createFromBuffer(input)
      return image && !image.isEmpty() ? image : null
    }
    if (typeof input === 'string' && input) {
      try {
        const sourceBuffer = fs.readFileSync(input)
        const image = nativeImage.createFromBuffer(sourceBuffer)
        if (image && !image.isEmpty()) return image
      } catch {}
      const image = nativeImage.createFromPath(String(input))
      return image && !image.isEmpty() ? image : null
    }
    return null
  } catch {
    return null
  }
}

function getCachedPathValue(cache, input, factory) {
  if (typeof input !== 'string' || !input) return factory()
  if (cache.has(input)) return cache.get(input)
  const value = factory()
  if (value) cache.set(input, value)
  return value
}

function createNativeImagePngBuffer(input) {
  return getCachedPathValue(FALLBACK_IMAGE_BUFFER_CACHE, input, () => {
    const image = createNativeImageFromInput(input)
    return image ? image.toPNG() : null
  })
}

function getCachedIcoPngBuffer(input) {
  return getCachedPathValue(ICO_PNG_CACHE, input, () => createNativeImagePngBuffer(input))
}

function decodeBmpBuffer(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 54) return null
  if (buffer[0] !== 0x42 || buffer[1] !== 0x4d) return null
  const pixelOffset = buffer.readUInt32LE(10)
  const dibSize = buffer.readUInt32LE(14)
  if (dibSize < 40 || buffer.length < 14 + dibSize) return null
  const width = buffer.readInt32LE(18)
  const rawHeight = buffer.readInt32LE(22)
  const planes = buffer.readUInt16LE(26)
  const bitsPerPixel = buffer.readUInt16LE(28)
  const compression = buffer.readUInt32LE(30)
  if (planes !== 1 || width <= 0 || rawHeight === 0) return null
  if (compression !== 0) return null
  if (bitsPerPixel !== 24 && bitsPerPixel !== 32) return null

  const height = Math.abs(rawHeight)
  const topDown = rawHeight < 0
  const bytesPerPixel = bitsPerPixel / 8
  const rowStride = Math.floor(((bitsPerPixel * width + 31) / 32)) * 4
  const requiredSize = pixelOffset + rowStride * height
  if (buffer.length < requiredSize) return null

  const data = Buffer.alloc(width * height * 4)
  for (let y = 0; y < height; y += 1) {
    const sourceY = topDown ? y : (height - 1 - y)
    const sourceRowOffset = pixelOffset + sourceY * rowStride
    const targetRowOffset = y * width * 4
    for (let x = 0; x < width; x += 1) {
      const sourceOffset = sourceRowOffset + x * bytesPerPixel
      const targetOffset = targetRowOffset + x * 4
      data[targetOffset] = buffer[sourceOffset + 2] || 0
      data[targetOffset + 1] = buffer[sourceOffset + 1] || 0
      data[targetOffset + 2] = buffer[sourceOffset] || 0
      data[targetOffset + 3] = bitsPerPixel === 32 ? (buffer[sourceOffset + 3] ?? 255) : 255
    }
  }

  return {
    data,
    width,
    height,
    channels: 4,
  }
}

function parseIcoDirectory(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 22) return null
  if (buffer.readUInt16LE(0) !== 0 || buffer.readUInt16LE(2) !== 1) return null
  const count = buffer.readUInt16LE(4)
  if (count <= 0 || buffer.length < 6 + count * 16) return null
  let bestEntry = null
  for (let index = 0; index < count; index += 1) {
    const offset = 6 + index * 16
    const width = buffer[offset] || 256
    const height = buffer[offset + 1] || 256
    const colorCount = buffer[offset + 2]
    const bitCount = buffer.readUInt16LE(offset + 6)
    const bytesInRes = buffer.readUInt32LE(offset + 8)
    const imageOffset = buffer.readUInt32LE(offset + 12)
    if (!(width > 0 && height > 0) || !(bytesInRes > 0) || !(imageOffset > 0)) continue
    const score = width * height * 1000 + Math.max(bitCount, colorCount || 0)
    if (!bestEntry || score > bestEntry.score) {
      bestEntry = { width, height, score }
    }
  }
  return bestEntry ? { width: bestEntry.width, height: bestEntry.height } : null
}

function getCachedIcoMetadata(input) {
  return getCachedPathValue(ICO_METADATA_CACHE, input, () => {
    if (Buffer.isBuffer(input)) return parseIcoDirectory(input)
    if (typeof input !== 'string' || !input) return null
    try {
      return parseIcoDirectory(fs.readFileSync(input))
    } catch {
      return null
    }
  })
}

function detectImageFormatFromBuffer(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 4) return ''
  if (buffer[0] === 0x42 && buffer[1] === 0x4d) return 'bmp'
  if (buffer[0] === 0x00 && buffer[1] === 0x00 && buffer[2] === 0x01 && buffer[3] === 0x00) return 'ico'
  if (buffer.length >= 8
    && buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4e && buffer[3] === 0x47
    && buffer[4] === 0x0d && buffer[5] === 0x0a && buffer[6] === 0x1a && buffer[7] === 0x0a) return 'png'
  if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return 'jpeg'
  if (buffer.length >= 6) {
    const gifHeader = buffer.subarray(0, 6).toString('ascii')
    if (gifHeader === 'GIF87a' || gifHeader === 'GIF89a') return 'gif'
  }
  if (buffer.length >= 12
    && buffer.subarray(0, 4).toString('ascii') === 'RIFF'
    && buffer.subarray(8, 12).toString('ascii') === 'WEBP') return 'webp'
  if (buffer.length >= 4) {
    const littleTiff = buffer[0] === 0x49 && buffer[1] === 0x49 && buffer[2] === 0x2a && buffer[3] === 0x00
    const bigTiff = buffer[0] === 0x4d && buffer[1] === 0x4d && buffer[2] === 0x00 && buffer[3] === 0x2a
    if (littleTiff || bigTiff) return 'tiff'
  }
  if (buffer.length >= 12 && buffer.subarray(4, 8).toString('ascii') === 'ftyp') {
    const brand = buffer.subarray(8, 12).toString('ascii')
    if (brand === 'avif' || brand === 'avis') return 'avif'
    if (brand === 'heic' || brand === 'heix' || brand === 'hevc' || brand === 'hevx') return 'heif'
  }
  return ''
}

function detectImageFormatFromFile(filePath) {
  const normalizedPath = sanitizeText(filePath)
  if (!normalizedPath) return ''
  if (INPUT_FORMAT_CACHE.has(normalizedPath)) return INPUT_FORMAT_CACHE.get(normalizedPath)
  try {
    const fd = fs.openSync(normalizedPath, 'r')
    try {
      const header = Buffer.alloc(32)
      const bytesRead = fs.readSync(fd, header, 0, header.length, 0)
      const format = normalizeImageFormatName(detectImageFormatFromBuffer(header.subarray(0, bytesRead)))
      INPUT_FORMAT_CACHE.set(normalizedPath, format)
      return format
    } finally {
      fs.closeSync(fd)
    }
  } catch {
    INPUT_FORMAT_CACHE.set(normalizedPath, '')
    return ''
  }
}

function getAssetDescriptorSourcePath(assetOrPath) {
  if (typeof assetOrPath === 'string') return sanitizeText(assetOrPath)
  return sanitizeText(assetOrPath?.sourcePath)
}

function getAssetDescriptorFallbackFormat(assetOrPath) {
  if (typeof assetOrPath === 'string') return normalizeImageFormatName(path.extname(assetOrPath).replace('.', ''))
  return normalizeImageFormatName(assetOrPath?.inputFormat || assetOrPath?.ext)
}

function getAssetDescriptorCacheKey(assetOrPath) {
  const sourcePath = getAssetDescriptorSourcePath(assetOrPath)
  if (!sourcePath) return ''
  try {
    const stat = fs.statSync(sourcePath)
    return `${path.resolve(sourcePath)}|${Number(stat.size) || 0}|${Number(stat.mtimeMs) || 0}`
  } catch {
    return path.resolve(sourcePath)
  }
}

function mergeAssetDescriptor(asset, descriptor) {
  if (!asset || !descriptor) return descriptor
  if (descriptor.inputFormat) asset.inputFormat = descriptor.inputFormat
  if (descriptor.inputMetadata) asset.inputMetadata = descriptor.inputMetadata
  if (descriptor.width > 0) asset.width = descriptor.width
  if (descriptor.height > 0) asset.height = descriptor.height
  return descriptor
}

async function getAssetDescriptor(sharpLib, assetOrPath, options = {}) {
  const probeMetadata = options.probeMetadata !== false
  const sourcePath = getAssetDescriptorSourcePath(assetOrPath)
  const fallbackFormat = getAssetDescriptorFallbackFormat(assetOrPath)
  if (!sourcePath) {
    const inputMetadata = assetOrPath?.inputMetadata || null
    const inputFormat = normalizeImageFormatName(assetOrPath?.inputFormat || inputMetadata?.format || fallbackFormat)
    const descriptor = {
      sourcePath: '',
      inputFormat,
      inputMetadata,
      width: Math.max(0, Number(inputMetadata?.width) || Number(assetOrPath?.width) || 0),
      height: Math.max(0, Number(inputMetadata?.height) || Number(assetOrPath?.height) || 0),
      hasAlpha: Boolean(inputMetadata?.hasAlpha),
    }
    return mergeAssetDescriptor(assetOrPath, descriptor)
  }

  const cacheKey = getAssetDescriptorCacheKey(assetOrPath)
  const cachedDescriptor = cacheKey ? ASSET_DESCRIPTOR_CACHE.get(cacheKey) : null
  if (cachedDescriptor && (!probeMetadata || cachedDescriptor.inputMetadata)) {
    return mergeAssetDescriptor(assetOrPath, cachedDescriptor)
  }

  const baseDescriptor = cachedDescriptor
    ? { ...cachedDescriptor }
    : {
        sourcePath,
        inputFormat: '',
        inputMetadata: null,
        width: 0,
        height: 0,
        hasAlpha: false,
      }

  const cachedFormat = normalizeImageFormatName(assetOrPath?.inputFormat)
  const cachedMetadata = assetOrPath?.inputMetadata
  const cachedMetadataFormat = normalizeImageFormatName(cachedMetadata?.format)
  const headerFormat = detectImageFormatFromFile(sourcePath)
  const directHeaderFormat = normalizeImageFormatName(headerFormat)

  if (!baseDescriptor.inputFormat) {
    baseDescriptor.inputFormat = cachedFormat || cachedMetadataFormat || directHeaderFormat || fallbackFormat
  }
  if (!baseDescriptor.inputMetadata && cachedMetadata) {
    baseDescriptor.inputMetadata = cachedMetadata
    baseDescriptor.width = Math.max(0, Number(cachedMetadata?.width) || baseDescriptor.width || 0)
    baseDescriptor.height = Math.max(0, Number(cachedMetadata?.height) || baseDescriptor.height || 0)
    baseDescriptor.hasAlpha = Boolean(cachedMetadata?.hasAlpha)
  }

  if (!probeMetadata) {
    if (cacheKey) ASSET_DESCRIPTOR_CACHE.set(cacheKey, baseDescriptor)
    return mergeAssetDescriptor(assetOrPath, baseDescriptor)
  }

  if (!baseDescriptor.inputMetadata && baseDescriptor.inputFormat === 'bmp') {
    try {
      const decoded = getCachedPathValue(BMP_DECODE_CACHE, sourcePath, () => {
        const sourceBuffer = fs.readFileSync(sourcePath)
        return decodeBmpBuffer(sourceBuffer)
      })
      if (decoded) {
        baseDescriptor.inputMetadata = {
          format: 'bmp',
          width: decoded.width,
          height: decoded.height,
          channels: decoded.channels,
          hasAlpha: decoded.channels === 4,
        }
        baseDescriptor.inputFormat = 'bmp'
      }
    } catch {}
  }

  if (!baseDescriptor.inputMetadata && baseDescriptor.inputFormat === 'ico') {
    try {
      const icoMeta = getCachedIcoMetadata(sourcePath)
      const decodedInput = getCachedIcoPngBuffer(sourcePath)
      if (decodedInput) {
        const metadata = await sharpLib(decodedInput).metadata()
        baseDescriptor.inputMetadata = {
          ...metadata,
          format: 'ico',
          width: icoMeta?.width || metadata?.width || 0,
          height: icoMeta?.height || metadata?.height || 0,
        }
        baseDescriptor.inputFormat = 'ico'
      }
    } catch {}
  }

  if (!baseDescriptor.inputMetadata && isFallbackDecodedInputFormat(baseDescriptor.inputFormat)) {
    try {
      const decodedInput = baseDescriptor.inputFormat === 'ico'
        ? getCachedIcoPngBuffer(sourcePath)
        : createNativeImagePngBuffer(sourcePath)
      if (decodedInput) {
        const metadata = await sharpLib(decodedInput).metadata()
        baseDescriptor.inputMetadata = metadata
      }
    } catch {}
  }

  if (!baseDescriptor.inputMetadata && sharpLib && isDirectSharpInputFormat(baseDescriptor.inputFormat || headerFormat || fallbackFormat)) {
    try {
      const metadata = await sharpLib(sourcePath).metadata()
      baseDescriptor.inputMetadata = metadata
    } catch {}
  }

  if (baseDescriptor.inputMetadata) {
    const detectedFormat = resolveCanonicalInputFormat(baseDescriptor.inputMetadata?.format, headerFormat, fallbackFormat)
    if (detectedFormat) baseDescriptor.inputFormat = detectedFormat
    baseDescriptor.width = Math.max(0, Number(baseDescriptor.inputMetadata?.width) || baseDescriptor.width || 0)
    baseDescriptor.height = Math.max(0, Number(baseDescriptor.inputMetadata?.height) || baseDescriptor.height || 0)
    baseDescriptor.hasAlpha = Boolean(baseDescriptor.inputMetadata?.hasAlpha)
  }

  if (!baseDescriptor.inputFormat) {
    baseDescriptor.inputFormat = directHeaderFormat || fallbackFormat
  }

  if (cacheKey) ASSET_DESCRIPTOR_CACHE.set(cacheKey, baseDescriptor)
  return mergeAssetDescriptor(assetOrPath, baseDescriptor)
}

async function ensureAssetDescriptorState(sharpLib, asset, options = {}) {
  const probeMetadata = options.probeMetadata === true
  if (!asset?.sourcePath) {
    return {
      inputFormat: normalizeImageFormatName(asset?.inputFormat || asset?.ext),
      sourceFormat: normalizeImageFormatName(asset?.inputFormat || asset?.ext),
      metadata: asset?.inputMetadata || null,
    }
  }
  const descriptor = await getAssetDescriptor(sharpLib, asset, { probeMetadata })
  const inputFormat = normalizeImageFormatName(descriptor?.inputFormat || asset?.inputFormat || asset?.ext)
  return {
    inputFormat,
    sourceFormat: normalizeImageFormatName(inputFormat),
    metadata: descriptor?.inputMetadata || asset?.inputMetadata || null,
  }
}

async function resolveAssetDimensions(sharpLib, asset, options = {}) {
  let width = Math.max(0, Number(asset?.width) || 0)
  let height = Math.max(0, Number(asset?.height) || 0)
  let descriptorState = null
  if (!(width > 0 && height > 0) || options.probeMetadata === true) {
    descriptorState = await ensureAssetDescriptorState(sharpLib, asset, {
      probeMetadata: options.probeMetadata === true || !(width > 0 && height > 0),
    })
    if (descriptorState?.inputFormat) asset.inputFormat = descriptorState.inputFormat
    if (!(width > 0 && height > 0)) {
      width = Math.max(1, Number(descriptorState?.metadata?.width) || width || 1)
      height = Math.max(1, Number(descriptorState?.metadata?.height) || height || 1)
    }
  }
  return {
    width,
    height,
    descriptorState,
  }
}

async function prepareSingleAssetWriteContext(sharpLib, asset, toolId, config, destinationPath, options = {}) {
  const descriptorState = await ensureAssetDescriptorState(sharpLib, asset, {
    probeMetadata: options.probeMetadata === true,
  })
  asset.inputFormat = descriptorState.inputFormat
  const format = typeof options.resolveFormat === 'function'
    ? options.resolveFormat(asset, config, descriptorState)
    : mapOutputFormat(toolId, asset, config)
  const outputPath = getSingleAssetOutputPath(destinationPath, asset, options.outputSuffix || toolId, format, {
    unique: options.unique === true,
  })
  return {
    ...descriptorState,
    format,
    outputPath,
  }
}

function isAlphaCapableFormat(format) {
  return ALPHA_CAPABLE_FORMATS.has(String(format || '').toLowerCase())
}

function isQualityCapableFormat(format) {
  return QUALITY_CAPABLE_FORMATS.has(normalizeImageFormatName(format))
}

function supportsTransparentCanvasOutput(format) {
  const normalized = normalizeImageFormatName(format)
  return isAlphaCapableFormat(normalized) && normalized !== 'tiff'
}

function canSkipSameFormatEncoding(format, quality = 100) {
  const normalized = normalizeImageFormatName(format)
  if (!normalized) return false
  if (!isQualityCapableFormat(normalized)) return true
  return Math.round(Number(quality) || 0) >= 100
}

function getTransformQuality(configQuality, sourceFormat, outputFormat, sameFormatDefault = 100, changedFormatDefault = 90) {
  const normalizedSource = normalizeImageFormatName(sourceFormat)
  const normalizedOutput = normalizeImageFormatName(outputFormat)
  const fallbackQuality = normalizedSource && normalizedSource === normalizedOutput
    ? sameFormatDefault
    : changedFormatDefault
  return clampNumber(configQuality, 1, 100, fallbackQuality)
}

function buildFormatCapabilitiesPayload() {
  const entries = [
    ['PNG', 'png', []],
    ['JPEG', 'jpeg', ['JPG']],
    ['WEBP', 'webp', ['WebP']],
    ['TIFF', 'tiff', ['TIF']],
    ['AVIF', 'avif', []],
    ['GIF', 'gif', []],
    ['BMP', 'bmp', []],
    ['ICO', 'ico', []],
  ]
  const formats = {}
  const aliases = {}
  for (const [key, canonical, extraAliases] of entries) {
    formats[key] = {
      key,
      canonical,
      supportsQuality: isQualityCapableFormat(canonical),
      supportsTransparency: isAlphaCapableFormat(canonical),
      supportsTransparentCanvasOutput: supportsTransparentCanvasOutput(canonical),
    }
    aliases[key] = key
    for (const alias of extraAliases) aliases[alias] = key
  }
  return { formats, aliases }
}

function getOutputName(asset, toolId, format) {
  const parsed = path.parse(asset.name || path.basename(asset.sourcePath))
  const outputExtension = format === 'jpeg' ? 'jpg' : format
  return `${parsed.name}-${toolId}.${outputExtension}`
}

function getSingleAssetOutputPath(destinationPath, asset, toolId, format, options = {}) {
  const rawOutputPath = path.join(destinationPath, getOutputName(asset, toolId, format))
  return options.unique ? resolveUniqueOutputPath(rawOutputPath) : rawOutputPath
}

function canCopyWithoutTransform(sourceFormat, outputFormat, transformQuality) {
  return normalizeImageFormatName(sourceFormat) === normalizeImageFormatName(outputFormat)
    && canSkipSameFormatEncoding(outputFormat, transformQuality)
}

function shouldKeepOriginalSource(sourceFormat, outputFormat, quality = 100) {
  return normalizeImageFormatName(sourceFormat) === normalizeImageFormatName(outputFormat)
    && Math.round(Number(quality) || 0) >= 100
}

function tryCopyOriginalSource(asset, outputPath, sourceFormat, outputFormat, quality, sourceInput = null) {
  if (!shouldKeepOriginalSource(sourceFormat, outputFormat, quality)) return null
  return copyAssetToOutput(asset, outputPath, sourceInput)
}

async function prepareDirectSourcePassthrough(sharpLib, asset, sourceFormat, outputFormat, quality, options = {}) {
  let effectiveSourceFormat = normalizeImageFormatName(sourceFormat)
  let sourceInput = null
  const normalizedOutputFormat = normalizeImageFormatName(outputFormat)
  const shouldProbeSourceFormat = Math.round(Number(quality) || 0) >= 100
    && (effectiveSourceFormat === normalizedOutputFormat || !isDirectSharpInputFormat(effectiveSourceFormat))

  if (shouldProbeSourceFormat) {
    try {
      const descriptor = await getAssetDescriptor(sharpLib, asset, { probeMetadata: options.probeMetadata !== false })
      effectiveSourceFormat = normalizeImageFormatName(descriptor?.inputFormat) || effectiveSourceFormat
      if (effectiveSourceFormat === normalizedOutputFormat) {
        sourceInput = fs.readFileSync(asset.sourcePath)
      }
    } catch {
      effectiveSourceFormat = normalizeImageFormatName(asset?.inputFormat || asset?.ext) || effectiveSourceFormat
      sourceInput = null
    }
  }

  return {
    effectiveSourceFormat,
    sourceInput,
  }
}

async function writeNoopSingleAsset(sharpLib, asset, outputPath, outputFormat, transformQuality, options = {}) {
  const sourceFormat = normalizeImageFormatName(options.sourceFormat || asset?.inputFormat || asset?.ext)
  const fallback = options.fallback
  if (canCopyWithoutTransform(sourceFormat, outputFormat, transformQuality)) {
    return copyAssetToOutput(asset, outputPath, null, fallback || asset)
  }
  const transformer = typeof options.buildTransformer === 'function'
    ? options.buildTransformer()
    : createTransformer(sharpLib, asset)
  return writeTransformedAsset(transformer, outputFormat, transformQuality, outputPath, fallback || {})
}

function resolveUniqueOutputPath(outputPath) {
  if (!fs.existsSync(outputPath)) return outputPath
  const parsed = path.parse(outputPath)
  let index = 2
  while (true) {
    const candidate = path.join(parsed.dir, `${parsed.name}-${index}${parsed.ext}`)
    if (!fs.existsSync(candidate)) return candidate
    index += 1
  }
}

function getBufferedAssetTransformerInput(asset, sourceFormat = asset?.inputFormat || asset?.ext) {
  const normalizedSourceFormat = normalizeImageFormatName(sourceFormat)
  const decodedInput = isFallbackDecodedInputFormat(normalizedSourceFormat)
    ? getCachedDecodedFallbackInput({ ...asset, inputFormat: normalizedSourceFormat })
    : null
  if (decodedInput) {
    return {
      sourceInput: null,
      transformerInput: decodedInput,
      transformerExt: 'png',
    }
  }
  const sourceInput = fs.readFileSync(asset.sourcePath)
  return {
    sourceInput,
    transformerInput: sourceInput,
    transformerExt: normalizedSourceFormat || asset?.inputFormat || asset?.ext,
  }
}

function createTransformerFromInput(sharpLib, input, ext = '') {
  const normalizedExt = normalizeImageFormatName(ext)
  if (normalizedExt === 'bmp') {
    const decoded = Buffer.isBuffer(input)
      ? decodeBmpBuffer(input)
      : getCachedPathValue(BMP_DECODE_CACHE, input, () => {
        const sourceBuffer = fs.readFileSync(String(input || ''))
        return decodeBmpBuffer(sourceBuffer)
      })
    if (decoded) {
      return sharpLib(decoded.data, {
        raw: {
          width: decoded.width,
          height: decoded.height,
          channels: decoded.channels,
        },
      })
    }
  }
  if (normalizedExt === 'ico') {
    const decoded = getCachedIcoPngBuffer(input)
    if (decoded) return sharpLib(decoded, { animated: false })
  }
  const sharpInput = isFallbackDecodedInputFormat(normalizedExt)
    ? createNativeImagePngBuffer(input) || input
    : input
  return sharpLib(sharpInput, { animated: normalizedExt === 'gif' })
}

function getCachedDecodedFallbackInput(asset) {
  const normalizedExt = normalizeImageFormatName(asset?.inputFormat || asset?.ext)
  if (!isFallbackDecodedInputFormat(normalizedExt)) return null
  if (asset?.decodedFallbackInput) return asset.decodedFallbackInput
  const decoded = normalizedExt === 'ico'
    ? getCachedIcoPngBuffer(asset?.sourcePath)
    : createNativeImagePngBuffer(asset?.sourcePath)
  if (decoded) asset.decodedFallbackInput = decoded
  return decoded
}

function createTransformer(sharpLib, asset) {
  const fallbackInput = getCachedDecodedFallbackInput(asset)
  return createTransformerFromInput(sharpLib, fallbackInput || asset.sourcePath, fallbackInput ? 'png' : (asset.inputFormat || asset.ext))
}

function withOutputFormat(transformer, format, quality) {
  if (format === 'jpeg') return transformer.jpeg({ quality, mozjpeg: true })
  if (format === 'png') {
    if (quality >= 100) {
      return transformer.png({
        compressionLevel: 9,
        palette: false,
        effort: 10,
      })
    }
    const compressionLevel = Math.max(0, Math.min(9, Math.round((100 - quality) / 11)))
    return transformer.png({
      compressionLevel,
      palette: quality < 100,
      quality: Math.max(1, Math.round(quality)),
      effort: 10,
    })
  }
  if (format === 'webp') return transformer.webp({ quality })
  if (format === 'tiff') return transformer.tiff({ quality })
  if (format === 'avif') return transformer.avif({ quality })
  if (format === 'gif') {
    const normalizedQuality = Math.max(1, Math.min(100, Math.round(Number(quality) || 90)))
    const colours = Math.max(16, Math.min(256, Math.round(16 + (normalizedQuality / 100) * 240)))
    const dither = normalizedQuality >= 90
      ? 1
      : (normalizedQuality >= 70 ? 0.85 : (normalizedQuality >= 40 ? 0.6 : 0.35))
    const interFrameMaxError = Math.max(0, Math.min(32, Math.round(((100 - normalizedQuality) / 100) * 24)))
    const interPaletteMaxError = Math.max(0, Math.min(256, Math.round(((100 - normalizedQuality) / 100) * 48)))
    return transformer.gif({
      effort: 7,
      colours,
      dither,
      reuse: normalizedQuality >= 85,
      interFrameMaxError,
      interPaletteMaxError,
    })
  }
  return transformer.png({ compressionLevel: 6 })
}

async function createBmpBuffer(transformer) {
  const { data, info } = await transformer
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true })
  const width = Math.max(1, info.width || 1)
  const height = Math.max(1, info.height || 1)
  const channels = Math.max(3, info.channels || 3)
  const rowStride = Math.ceil((width * 3) / 4) * 4
  const pixelDataSize = rowStride * height
  const fileHeaderSize = 14
  const dibHeaderSize = 40
  const fileSize = fileHeaderSize + dibHeaderSize + pixelDataSize
  const buffer = Buffer.alloc(fileSize)

  buffer.write('BM', 0, 2, 'ascii')
  buffer.writeUInt32LE(fileSize, 2)
  buffer.writeUInt32LE(fileHeaderSize + dibHeaderSize, 10)
  buffer.writeUInt32LE(dibHeaderSize, 14)
  buffer.writeInt32LE(width, 18)
  buffer.writeInt32LE(height, 22)
  buffer.writeUInt16LE(1, 26)
  buffer.writeUInt16LE(24, 28)
  buffer.writeUInt32LE(0, 30)
  buffer.writeUInt32LE(pixelDataSize, 34)
  buffer.writeInt32LE(2835, 38)
  buffer.writeInt32LE(2835, 42)

  const pixelOffset = fileHeaderSize + dibHeaderSize
  for (let y = 0; y < height; y += 1) {
    const srcY = height - 1 - y
    const dstRowOffset = pixelOffset + y * rowStride
    for (let x = 0; x < width; x += 1) {
      const srcOffset = (srcY * width + x) * channels
      const dstOffset = dstRowOffset + x * 3
      buffer[dstOffset] = data[srcOffset + 2] || 0
      buffer[dstOffset + 1] = data[srcOffset + 1] || 0
      buffer[dstOffset + 2] = data[srcOffset] || 0
    }
  }

  return buffer
}

function createIcoBuffer(pngBuffer, width, height) {
  const entryWidth = width >= 256 ? 0 : width
  const entryHeight = height >= 256 ? 0 : height
  const header = Buffer.alloc(6 + 16)
  header.writeUInt16LE(0, 0)
  header.writeUInt16LE(1, 2)
  header.writeUInt16LE(1, 4)
  header.writeUInt8(entryWidth, 6)
  header.writeUInt8(entryHeight, 7)
  header.writeUInt8(0, 8)
  header.writeUInt8(0, 9)
  header.writeUInt16LE(1, 10)
  header.writeUInt16LE(32, 12)
  header.writeUInt32LE(pngBuffer.length, 14)
  header.writeUInt32LE(22, 18)
  return Buffer.concat([header, pngBuffer])
}

async function writeCompressionAsset(sharpLib, asset, config, destinationPath) {
  const { sourceFormat, format, outputPath } = await prepareSingleAssetWriteContext(
    sharpLib,
    asset,
    'compression',
    config,
    destinationPath,
  )
  const originalSizeBytes = Math.max(0, Number(asset?.sizeBytes) || 0)
  const targetBytes = config.targetSizeKb * 1024
  const maxQuality = 90

  const ensureCompressedOutputIsSmaller = (outputSizeBytes) => {
    if (!originalSizeBytes || outputSizeBytes < originalSizeBytes) return
    if (fs.existsSync(outputPath)) fs.unlinkSync(outputPath)
    throw new Error('压缩结果未小于原图，已跳过该文件')
  }

  if (config.mode === 'target' && originalSizeBytes && targetBytes >= originalSizeBytes) {
    throw new Error('目标大小未小于原图，已跳过该文件')
  }

  if (config.mode !== 'target') {
    const passthrough = tryCopyOriginalSource(asset, outputPath, sourceFormat, format, config.quality)
    if (passthrough) return passthrough
  }

  if (config.mode !== 'target' || !TARGET_COMPRESSION_FORMATS.has(format)) {
    const output = await writeTransformedAsset(createTransformer(sharpLib, asset), format, Math.round(config.quality), outputPath, {
      width: asset.width,
      height: asset.height,
    })
    ensureCompressedOutputIsSmaller(output.outputSizeBytes)
    if (config.mode !== 'target') return output
    const warning = output.outputSizeBytes > targetBytes
      ? `当前输出格式 ${String(format || '').toUpperCase()} 不支持精确按体积，已输出当前结果 ${Math.max(1, Math.round(output.outputSizeBytes / 1024))} KB。`
      : ''
    return warning ? { ...output, warning } : output
  }

  const { transformerInput, transformerExt } = getBufferedAssetTransformerInput(asset, sourceFormat)
  const cache = new Map()
  const encodeAtQuality = async (quality) => {
    const normalizedQuality = Math.max(1, Math.min(maxQuality, Math.round(quality)))
    if (cache.has(normalizedQuality)) return cache.get(normalizedQuality)
    const buffer = await withOutputFormat(createTransformerFromInput(sharpLib, transformerInput, transformerExt), format, normalizedQuality).toBuffer()
    cache.set(normalizedQuality, buffer)
    return buffer
  }

  const estimatedQuality = estimateCompressionQuality(originalSizeBytes, targetBytes)
  const estimatedBuffer = await encodeAtQuality(estimatedQuality)
  let chosenBuffer = estimatedBuffer

  if (estimatedBuffer.length > targetBytes) {
    const lowQuality = 1
    const lowBuffer = estimatedQuality === lowQuality ? estimatedBuffer : await encodeAtQuality(lowQuality)
    chosenBuffer = lowBuffer

    if (lowBuffer.length <= targetBytes) {
      let bestBuffer = lowBuffer
      let left = lowQuality + 1
      let right = estimatedQuality - 1

      while (left <= right) {
        const mid = Math.floor((left + right) / 2)
        const buffer = await encodeAtQuality(mid)
        if (buffer.length <= targetBytes) {
          bestBuffer = buffer
          left = mid + 1
        } else {
          right = mid - 1
        }
      }

      chosenBuffer = bestBuffer
    }
  } else if (estimatedQuality < maxQuality) {
    let bestBuffer = estimatedBuffer
    let left = estimatedQuality + 1
    let right = maxQuality

    while (left <= right) {
      const mid = Math.floor((left + right) / 2)
      const buffer = await encodeAtQuality(mid)
      if (buffer.length <= targetBytes) {
        bestBuffer = buffer
        left = mid + 1
      } else {
        right = mid - 1
      }
    }

    chosenBuffer = bestBuffer
  }

  const warning = chosenBuffer.length > targetBytes
    ? `未达到目标体积 ${config.targetSizeKb} KB，已输出当前可达到的最小结果 ${Math.max(1, Math.round(chosenBuffer.length / 1024))} KB。`
    : ''
  if (originalSizeBytes && chosenBuffer.length >= originalSizeBytes) {
    throw new Error('压缩结果未小于原图，已跳过该文件')
  }
  return {
    ...writeOutputBuffer(outputPath, chosenBuffer, {
      width: asset.width || 0,
      height: asset.height || 0,
    }),
    warning,
  }
}

async function writeFormatAsset(sharpLib, asset, config, destinationPath) {
  const { sourceFormat, format, outputPath } = await prepareSingleAssetWriteContext(
    sharpLib,
    asset,
    'format',
    config,
    destinationPath,
    { probeMetadata: true },
  )
  const { effectiveSourceFormat, sourceInput } = await prepareDirectSourcePassthrough(
    sharpLib,
    asset,
    sourceFormat,
    format,
    config.quality,
    { probeMetadata: true },
  )

  const passthrough = tryCopyOriginalSource(asset, outputPath, effectiveSourceFormat, format, config.quality, sourceInput)
  if (passthrough) return passthrough

  const baseTransformer = sourceInput
    ? createTransformerFromInput(sharpLib, sourceInput, effectiveSourceFormat)
    : createTransformer(sharpLib, asset)
  const transformed = applyFormatOutputSettings(baseTransformer, format, {
    colorProfile: config.colorProfile,
    keepTransparency: config.keepTransparency,
  })
  const quality = getTransformQuality(config.quality, sourceFormat, format)

  return writeTransformedAsset(transformed, format, quality, outputPath, {
    width: asset.width,
    height: asset.height,
  })
}

async function writeResizeAsset(sharpLib, asset, config, destinationPath) {
  const { sourceFormat, format, outputPath } = await prepareSingleAssetWriteContext(
    sharpLib,
    asset,
    'resize',
    config,
    destinationPath,
  )
  const quality = getTransformQuality(config.quality, sourceFormat, format)
  const width = config.width.unit === '%' ? Math.max(1, Math.round((asset.width || 0) * (config.width.value / 100))) : Math.max(1, Math.round(config.width.value))
  const height = config.height.unit === '%' ? Math.max(1, Math.round((asset.height || 0) * (config.height.value / 100))) : Math.max(1, Math.round(config.height.value))
  const sourceWidth = Math.max(0, Number(asset.width) || 0)
  const sourceHeight = Math.max(0, Number(asset.height) || 0)

  if (sourceWidth > 0 && sourceHeight > 0 && width === sourceWidth && height === sourceHeight) {
    return writeNoopSingleAsset(sharpLib, asset, outputPath, format, quality, {
      sourceFormat,
      fallback: {
      width: sourceWidth,
      height: sourceHeight,
      },
    })
  }

  const resized = createTransformer(sharpLib, asset).resize({
    width,
    height,
    fit: config.lockAspectRatio ? 'inside' : 'fill',
  })
  return writeTransformedAsset(resized, format, quality, outputPath)
}

function normalizeHexColor(value, alpha = 1) {
  const color = sanitizeText(value, '#FFFFFF').replace('#', '')
  const normalized = color.length === 3 ? color.split('').map((item) => item + item).join('') : color.padEnd(6, 'F').slice(0, 6)
  const numericAlpha = Math.max(0, Math.min(1, alpha))
  const red = Number.parseInt(normalized.slice(0, 2), 16)
  const green = Number.parseInt(normalized.slice(2, 4), 16)
  const blue = Number.parseInt(normalized.slice(4, 6), 16)
  return `rgba(${red}, ${green}, ${blue}, ${numericAlpha})`
}

function hexToRgbaObject(value, alpha = 1) {
  const color = sanitizeText(value, '#ffffff').replace('#', '')
  const normalized = color.length === 3 ? color.split('').map((item) => item + item).join('') : color.padEnd(6, 'f').slice(0, 6)
  return {
    r: Number.parseInt(normalized.slice(0, 2), 16),
    g: Number.parseInt(normalized.slice(2, 4), 16),
    b: Number.parseInt(normalized.slice(4, 6), 16),
    alpha,
  }
}

function escapeSvgText(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;')
}

function getWatermarkRenderScale(asset) {
  const width = Math.max(asset.width || 0, 1)
  const height = Math.max(asset.height || 0, 1)
  const baseDimension = Math.min(width, height)
  return Math.max(0.6, Math.min(2.2, baseDimension / 1080))
}

function buildTextWatermarkSvg(asset, config) {
  const color = normalizeHexColor(config.color, config.opacity / 100)
  const text = escapeSvgText(config.text)
  const renderScale = getWatermarkRenderScale(asset)
  const renderFontSize = Math.max(12, Math.round(config.fontSize * renderScale))
  const textLength = Math.max(String(config.text || '').length, 2)
  const textBoxWidth = Math.max(renderFontSize * textLength * 0.82, renderFontSize * 2.2)
  const textBoxHeight = Math.max(renderFontSize * 1.9, renderFontSize + 14)
  const rotation = Math.abs(toNumber(config.rotation, 0)) % 180
  const radians = rotation * (Math.PI / 180)
  const rotatedWidth = Math.abs(textBoxWidth * Math.cos(radians)) + Math.abs(textBoxHeight * Math.sin(radians))
  const rotatedHeight = Math.abs(textBoxWidth * Math.sin(radians)) + Math.abs(textBoxHeight * Math.cos(radians))
  const padding = Math.max(18, Math.round(renderFontSize * 1.1))
  const width = Math.ceil(rotatedWidth + padding * 2)
  const height = Math.ceil(rotatedHeight + padding * 2)
  const x = Math.round(width / 2)
  const y = Math.round(height / 2)
  return Buffer.from(`
    <svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">
      <style>
        text { font-family: Arial, Helvetica, sans-serif; font-weight: 600; }
      </style>
      <text x="${x}" y="${y}" text-anchor="middle" dominant-baseline="middle" font-size="${renderFontSize}" fill="${color}" transform="rotate(${config.rotation} ${x} ${y})">${text}</text>
    </svg>
  `)
}

async function createTiledWatermarkBuffer(sharpLib, input, density, sizeHint = null) {
  const width = Math.max(1, sizeHint?.width || 1)
  const height = Math.max(1, sizeHint?.height || 1)
  const clampedDensity = clampNumber(density, 20, 250, 100)
  const densityProgress = (clampedDensity - 20) / 230
  const gapRatio = 0.42 - densityProgress * 0.405
  const gap = Math.max(2, Math.round(Math.max(width, height) * gapRatio))
  const canvasWidth = width + gap
  const canvasHeight = height + gap
  const left = Math.max(0, Math.round((canvasWidth - width) / 2))
  const top = Math.max(0, Math.round((canvasHeight - height) / 2))

  return sharpLib({
    create: {
      width: canvasWidth,
      height: canvasHeight,
      channels: 4,
      background: TRANSPARENT_BG,
    },
  })
    .composite([{ input, left, top }])
    .png()
    .toBuffer()
}

async function createImageWatermarkBuffer(sharpLib, asset, config) {
  const imagePath = sanitizeText(config.imagePath)
  if (!imagePath) {
    throw new Error('图片水印文件不存在')
  }

  const isDataUrl = imagePath.startsWith('data:image/')
  const imageSourceKey = isDataUrl ? imagePath : path.resolve(imagePath)

  let imageInput = WATERMARK_IMAGE_CACHE.get(imageSourceKey) || null
  if (!imageInput) {
    try {
      imageInput = isDataUrl
        ? Buffer.from(imagePath.slice(imagePath.indexOf(',') + 1), 'base64')
        : fs.readFileSync(imageSourceKey)
    } catch {
      throw new Error('图片水印文件不存在')
    }
    WATERMARK_IMAGE_CACHE.set(imageSourceKey, imageInput)
  }

  const renderScale = getWatermarkRenderScale(asset)
  const baseWidth = Math.max(asset.width || 1920, 1)
  const watermarkWidth = Math.max(32, Math.round(baseWidth * 0.18 * renderScale))
  const rotation = Math.round(toNumber(config.rotation, 0))
  const opacity = Math.round(clampNumber(config.opacity, 0, 100, 60))
  const overlayCacheKey = [
    imageSourceKey,
    rotation,
    opacity,
    watermarkWidth,
  ].join('|')
  const cachedOverlay = WATERMARK_OVERLAY_CACHE.get(overlayCacheKey)
  if (cachedOverlay) return cachedOverlay

  let overlayTransformer = sharpLib(imageInput)
  if (rotation !== 0) {
    overlayTransformer = overlayTransformer.rotate(rotation, { background: TRANSPARENT_BG })
  }
  overlayTransformer = overlayTransformer.resize({ width: watermarkWidth, withoutEnlargement: true })
  if (opacity < 100) {
    overlayTransformer = overlayTransformer.ensureAlpha(opacity / 100)
  }
  const { data, info } = await overlayTransformer.png().toBuffer({ resolveWithObject: true })
  const overlay = {
    input: data,
    width: info.width || 1,
    height: info.height || 1,
    cacheKey: overlayCacheKey,
  }
  WATERMARK_OVERLAY_CACHE.set(overlayCacheKey, overlay)
  return overlay
}

async function buildWatermarkComposite(sharpLib, asset, config) {
  let overlay = config.type === 'image'
    ? await createImageWatermarkBuffer(sharpLib, asset, config)
    : null

  if (config.type === 'text') {
    const renderScaleKey = Math.round(getWatermarkRenderScale(asset) * 100)
    const textOverlayKey = [
      config.text,
      config.color,
      Math.round(clampNumber(config.opacity, 0, 100, 60)),
      Math.max(1, Math.round(config.fontSize || 32)),
      Math.round(toNumber(config.rotation, 0)),
      renderScaleKey,
    ].join('|')
    overlay = WATERMARK_TEXT_CACHE.get(textOverlayKey) || null
    if (!overlay) {
      const trimmed = await sharpLib(buildTextWatermarkSvg(asset, config))
        .trim()
        .png()
        .toBuffer({ resolveWithObject: true })
      overlay = {
        input: trimmed.data,
        width: trimmed.info.width || 1,
        height: trimmed.info.height || 1,
        cacheKey: textOverlayKey,
      }
      WATERMARK_TEXT_CACHE.set(textOverlayKey, overlay)
    }
  }

  if (config.tiled) {
    const tiledCacheKey = overlay?.cacheKey ? `${overlay.cacheKey}|tile|${clampNumber(config.density, 20, 250, 100)}` : ''
    const cachedTiledOverlay = tiledCacheKey ? WATERMARK_TILED_CACHE.get(tiledCacheKey) : null
    const tiledInput = cachedTiledOverlay
      || await createTiledWatermarkBuffer(sharpLib, overlay.input, config.density, overlay)
    if (tiledCacheKey && !cachedTiledOverlay) {
      WATERMARK_TILED_CACHE.set(tiledCacheKey, tiledInput)
    }
    overlay = {
      input: tiledInput,
      width: 0,
      height: 0,
    }
    return {
      input: overlay.input,
      tile: true,
      gravity: 'centre',
    }
  }

  const overlayWidth = Math.max(1, overlay.width || 1)
  const overlayHeight = Math.max(1, overlay.height || 1)
  const assetWidth = Math.max(1, asset.width || 1)
  const assetHeight = Math.max(1, asset.height || 1)
  const margin = Math.max(0, config.margin || 0)
  const position = String(config.position || 'center')
  const isLeft = position.includes('left')
  const isRight = position.includes('right')
  const isTop = position.startsWith('top')
  const isBottom = position.startsWith('bottom')
  const horizontal = isLeft
    ? margin
    : isRight
      ? Math.max(0, assetWidth - overlayWidth - margin)
      : Math.round((assetWidth - overlayWidth) / 2)
  const vertical = isTop
    ? margin
    : isBottom
      ? Math.max(0, assetHeight - overlayHeight - margin)
      : Math.round((assetHeight - overlayHeight) / 2)

  return {
    input: overlay.input,
    left: Math.max(0, horizontal),
    top: Math.max(0, vertical),
  }
}

async function revealPath(targetPath) {
  const normalizedTarget = path.normalize(sanitizeText(targetPath))
  let resolved = ''
  try {
    if (normalizedTarget && fs.statSync(normalizedTarget).isDirectory()) {
      resolved = normalizedTarget
    } else {
      resolved = normalizedTarget ? path.dirname(normalizedTarget) : ''
    }
  } catch {
    resolved = ''
  }
  if (!resolved) return false
  try {
    let targetStat = null
    try {
      targetStat = normalizedTarget ? fs.statSync(normalizedTarget) : null
    } catch {
      targetStat = null
    }
    if (typeof shell.showItemInFolder === 'function' && targetStat && !targetStat.isDirectory()) {
      shell.showItemInFolder(normalizedTarget)
      return true
    }
    const error = await shell.openPath(resolved)
    return !error
  } catch {
    return false
  }
}

function normalizeFsPath(value, fallback = '') {
  const text = sanitizeText(value, fallback)
  if (!text) return ''
  const normalized = text.replaceAll('/', path.sep).replace(/^([A-Za-z]):(?![\\/])/, `$1:${path.sep}`)
  return path.resolve(path.normalize(normalized))
}

function resolveExistingResultPath(item = {}) {
  const candidates = [
    item.resultPath,
  ].map((value) => normalizeFsPath(value)).filter(Boolean)

  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) return candidate
  }
  return candidates[0] || ''
}

function overwriteFile(sourcePath, targetPath) {
  const tempPath = `${targetPath}.imgbatch-replace-${Date.now()}`
  ensureDirectory(path.dirname(targetPath))
  if (fs.existsSync(targetPath)) {
    try {
      fs.chmodSync(targetPath, 0o666)
    } catch {
      // Keep overwrite flow going even if chmod is unsupported.
    }
  }
  fs.copyFileSync(sourcePath, tempPath)
  if (fs.existsSync(targetPath)) {
    fs.unlinkSync(targetPath)
  }
  fs.renameSync(tempPath, targetPath)
}

function removeEmptyDirectoryIfPossible(targetPath) {
  const directoryPath = path.dirname(targetPath)
  if (!directoryPath || !fs.existsSync(directoryPath)) return
  try {
    if (!fs.statSync(directoryPath).isDirectory()) return
    if ((fs.readdirSync(directoryPath) || []).length > 0) return
    fs.rmdirSync(directoryPath)
  } catch {
    // Ignore cleanup failures so replace succeeds even if folder removal does not.
  }
}

async function replaceOriginals(items = []) {
  const processed = []
  const failed = []
  const sharpLib = getSharp()
  for (const item of items) {
    try {
      const sourcePath = resolveExistingResultPath(item)
      const originalSourcePath = normalizeFsPath(item.sourcePath)
      if (!sourcePath || !fs.existsSync(sourcePath)) {
        throw new Error('处理结果不存在，无法替换原图')
      }
      if (!originalSourcePath) {
        throw new Error('原图不存在，无法替换')
      }
      const originalParsedPath = path.parse(originalSourcePath)
      const resultExtension = path.extname(sourcePath) || originalParsedPath.ext
      const targetPath = path.join(originalParsedPath.dir, `${originalParsedPath.name}${resultExtension}`)
      overwriteFile(sourcePath, targetPath)
      if (path.resolve(originalSourcePath) !== path.resolve(targetPath) && fs.existsSync(originalSourcePath)) {
        fs.unlinkSync(originalSourcePath)
      }
      if (path.resolve(sourcePath) !== path.resolve(targetPath) && fs.existsSync(sourcePath)) {
        fs.unlinkSync(sourcePath)
        removeEmptyDirectoryIfPossible(sourcePath)
      }
      const stat = fs.statSync(targetPath)
      const descriptor = sharpLib
        ? await getAssetDescriptor(sharpLib, {
          sourcePath: targetPath,
          inputFormat: normalizeImageFormatName(resultExtension.replace('.', '')),
          ext: resultExtension.replace('.', ''),
        }, { probeMetadata: true })
        : null
      const width = Math.max(0, Number(descriptor?.width) || 0)
      const height = Math.max(0, Number(descriptor?.height) || 0)
      const inputFormat = normalizeImageFormatName(descriptor?.inputFormat || resultExtension.replace('.', ''))
      processed.push({
        assetId: item.assetId,
        name: path.basename(targetPath),
        outputPath: '',
        savedOutputPath: '',
        sourcePath: targetPath,
        sizeBytes: Number(stat.size) || 0,
        width,
        height,
        inputFormat,
        inputMetadata: descriptor?.inputMetadata || null,
        hasAlpha: Boolean(descriptor?.hasAlpha),
        thumbnailUrl: await createAssetDisplayUrlAsync(targetPath, inputFormat, sharpLib),
        listThumbnailUrl: await createQueueThumbnailUrlAsync(targetPath, inputFormat, sharpLib),
      })
    } catch (error) {
      failed.push({ assetId: item.assetId, name: item.name, error: error?.message || '替换失败' })
    }
  }
  return {
    ok: processed.length > 0 && failed.length === 0,
    partial: processed.length > 0 && failed.length > 0,
    processed,
    failed,
    message: processed.length > 0 && failed.length === 0
      ? `已替换 ${processed.length} 张原图。`
      : processed.length > 0
        ? `替换原图部分完成：成功 ${processed.length} 项，失败 ${failed.length} 项`
        : failed[0]?.error || '替换原图失败。',
  }
}

function revealResultDirectoryIfNeeded(result) {
  if (!['save', 'direct'].includes(result?.mode)) return result
  const targetPath = result.destinationPath || result.baseDestinationPath || ''
  if (targetPath && (result.ok || result.partial)) {
    void revealPath(targetPath)
  }
  return result
}

async function writeWatermarkAsset(sharpLib, asset, config, destinationPath) {
  const { sourceFormat, format, outputPath } = await prepareSingleAssetWriteContext(
    sharpLib,
    asset,
    'watermark',
    config,
    destinationPath,
  )
  const watermarkOpacity = Number(config.opacity) || 0
  const isEmptyTextWatermark = config.type === 'text' && !sanitizeText(config.text)
  const isZeroSizeTextWatermark = config.type === 'text' && Number(config.fontSize) <= 0

  const transformQuality = getTransformQuality(config.quality, sourceFormat, format)

  if (watermarkOpacity <= 0 || isEmptyTextWatermark || isZeroSizeTextWatermark) {
    return writeNoopSingleAsset(sharpLib, asset, outputPath, format, transformQuality, { sourceFormat })
  }

  const composite = await buildWatermarkComposite(sharpLib, asset, config)
  const transformed = createTransformer(sharpLib, asset).composite([composite])
  return writeTransformedAsset(transformed, format, transformQuality, outputPath)
}

async function writeRotateAsset(sharpLib, asset, config, destinationPath) {
  const { sourceFormat, format, outputPath } = await prepareSingleAssetWriteContext(
    sharpLib,
    asset,
    'rotate',
    config,
    destinationPath,
  )
  const normalizedAngle = ((Math.round(Number(config.angle) || 0) % 360) + 360) % 360
  const transformQuality = getTransformQuality(config.quality, sourceFormat, format)

  if (normalizedAngle === 0 && !config.keepAspectRatio && !config.autoCrop) {
    return writeNoopSingleAsset(sharpLib, asset, outputPath, format, transformQuality, {
      sourceFormat,
      fallback: getAssetDimensionFallback(asset),
    })
  }

  const solidBackground = hexToRgbaObject(config.background, 1)
  let transformed = createTransformer(sharpLib, asset)

  if (config.autoCrop) {
    transformed = transformed
      .ensureAlpha()
      .rotate(config.angle, { background: TRANSPARENT_BG })
      .trim()
  } else {
    transformed = transformed.rotate(config.angle, { background: solidBackground })
  }

  if (config.keepAspectRatio && asset.width && asset.height) {
    transformed = transformed.resize({
      width: asset.width,
      height: asset.height,
      fit: 'contain',
      background: config.autoCrop ? TRANSPARENT_BG : solidBackground,
    })
  }

  if (config.autoCrop && !supportsTransparentCanvasOutput(format)) {
    transformed = transformed.flatten({ background: solidBackground })
  }

  return writeTransformedAsset(transformed, format, transformQuality, outputPath)
}

async function writeFlipAsset(sharpLib, asset, config, destinationPath) {
  const requestedOutputFormat = String(config.outputFormat || '').toLowerCase()
  const { sourceFormat, format, outputPath } = await prepareSingleAssetWriteContext(
    sharpLib,
    asset,
    'flip',
    config,
    destinationPath,
    {
      resolveFormat: (currentAsset, currentConfig) => (
        !requestedOutputFormat || requestedOutputFormat === 'keep original'
          ? mapOutputFormat('flip', currentAsset, currentConfig)
          : mapOutputFormat('format', currentAsset, { targetFormat: currentConfig.outputFormat })
      ),
    },
  )
  const hasNoFlipTransform = !config.horizontal && !config.vertical && !config.autoCropTransparent
  const transformQuality = getTransformQuality(config.quality, sourceFormat, format)

  if (hasNoFlipTransform) {
    return writeNoopSingleAsset(sharpLib, asset, outputPath, format, transformQuality, {
      sourceFormat,
      buildTransformer: () => applyOptionalMetadataPreservation(createTransformer(sharpLib, asset), config.preserveMetadata),
      fallback: getAssetDimensionFallback(asset),
    })
  }

  let transformed = createTransformer(sharpLib, asset)

  if (config.horizontal) transformed = transformed.flop()
  if (config.vertical) transformed = transformed.flip()
  if (config.autoCropTransparent) transformed = transformed.ensureAlpha().trim()
  if (config.autoCropTransparent && !supportsTransparentCanvasOutput(format)) {
    transformed = transformed.flatten({ background: OPAQUE_WHITE_BG })
  }
  transformed = applyOptionalMetadataPreservation(transformed, config.preserveMetadata)

  return writeTransformedAsset(transformed, format, transformQuality, outputPath)
}

function buildRoundedRectSvg(width, height, radius, fill) {
  return Buffer.from(`
    <svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">
      <rect x="0" y="0" width="${width}" height="${height}" rx="${radius}" ry="${radius}" fill="${fill}" />
    </svg>
  `)
}

async function writeCornersAsset(sharpLib, asset, config, destinationPath) {
  const { sourceFormat, metadata, format: outputFormat, outputPath } = await prepareSingleAssetWriteContext(
    sharpLib,
    asset,
    'corners',
    config,
    destinationPath,
    {
      probeMetadata: true,
      resolveFormat: (currentAsset, currentConfig, descriptorState) => (
        currentConfig.keepTransparency
          ? (isAlphaCapableFormat(descriptorState.sourceFormat) ? descriptorState.sourceFormat : 'png')
          : mapOutputFormat('corners', currentAsset, currentConfig)
      ),
    },
  )
  const baseTransformer = createTransformer(sharpLib, asset)
  const width = asset.width || metadata?.width || 1
  const height = asset.height || metadata?.height || 1
  const maxRadius = Math.min(width, height) / 2
  const radius = config.unit === '%' ? Math.round(maxRadius * (config.radius / 100)) : Math.min(maxRadius, Math.max(0, config.radius))

  const transformQuality = getTransformQuality(config.quality, sourceFormat, outputFormat)

  if (radius <= 0) {
    return writeNoopSingleAsset(sharpLib, asset, outputPath, outputFormat, transformQuality, {
      sourceFormat,
      fallback: getAssetDimensionFallback(asset, width, height),
    })
  }

  const mask = buildRoundedRectSvg(width, height, radius, '#ffffff')

  const rounded = baseTransformer.ensureAlpha().composite([{ input: mask, blend: 'dest-in' }])
  if (config.keepTransparency) {
    return writeTransformedAsset(rounded, outputFormat, transformQuality, outputPath)
  }

  const roundedBuffer = await rounded.png().toBuffer()
  const transformed = sharpLib({
    create: {
      width,
      height,
      channels: 4,
      background: hexToRgbaObject(config.background, 1),
    },
  }).composite([{ input: roundedBuffer, left: 0, top: 0 }])

  return writeTransformedAsset(transformed, outputFormat, transformQuality, outputPath)
}

async function writePaddingAsset(sharpLib, asset, config, destinationPath) {
  const { sourceFormat, format, outputPath } = await prepareSingleAssetWriteContext(
    sharpLib,
    asset,
    'padding',
    config,
    destinationPath,
  )
  const sourceWidth = Math.max(1, Number(asset.width) || 1)
  const sourceHeight = Math.max(1, Number(asset.height) || 1)
  const top = Math.max(0, resolveMeasureOffset(config.top, sourceHeight, 20))
  const right = Math.max(0, resolveMeasureOffset(config.right, sourceWidth, 20))
  const bottom = Math.max(0, resolveMeasureOffset(config.bottom, sourceHeight, 20))
  const left = Math.max(0, resolveMeasureOffset(config.left, sourceWidth, 20))
  const noPadding = top === 0 && right === 0 && bottom === 0 && left === 0

  const transformQuality = getTransformQuality(config.quality, sourceFormat, format)

  if (noPadding) {
    return writeNoopSingleAsset(sharpLib, asset, outputPath, format, transformQuality, {
      sourceFormat,
      fallback: getAssetDimensionFallback(asset),
    })
  }

  const background = hexToRgbaObject(config.color, config.opacity / 100)
  const transformed = createTransformer(sharpLib, asset).extend({
    top,
    right,
    bottom,
    left,
    background,
  })
  return writeTransformedAsset(transformed, format, transformQuality, outputPath)
}

function getCropDisplaySize(asset, config, toolId = 'crop') {
  const assetWidth = Math.max(1, asset.width || 1)
  const assetHeight = Math.max(1, asset.height || 1)
  if (toolId !== 'manual-crop') return { width: assetWidth, height: assetHeight }
  return computeManualCropDisplaySize(assetWidth, assetHeight, config.angle)
}

function getManualCropStageMetrics(asset, config) {
  return computeManualCropStageMetrics({
    sourceWidth: asset?.width,
    sourceHeight: asset?.height,
    angle: config.angle,
    stageWidth: config.stageWidth,
    stageHeight: config.stageHeight,
    viewScale: config.viewScale,
    viewOffsetX: config.viewOffsetX,
    viewOffsetY: config.viewOffsetY,
  })
}

function normalizeCropBox(asset, config, toolId = 'crop') {
  const stageMetrics = toolId === 'manual-crop' ? getManualCropStageMetrics(asset, config) : null
  const { width: assetWidth, height: assetHeight } = stageMetrics || getCropDisplaySize(asset, config, toolId)
  const mode = toolId === 'manual-crop'
    ? 'size'
    : (config.mode === 'size' ? 'size' : 'ratio')
  let left = Math.max(0, resolveMeasureOffset(config.area?.x, assetWidth, 0))
  let top = Math.max(0, resolveMeasureOffset(config.area?.y, assetHeight, 0))
  let width = Math.min(assetWidth, Math.max(1, toInteger(config.area?.width, assetWidth)))
  let height = Math.min(assetHeight, Math.max(1, toInteger(config.area?.height, assetHeight)))

  if (mode === 'ratio') {
    const availableWidth = Math.max(1, assetWidth - left)
    const availableHeight = Math.max(1, assetHeight - top)
    width = availableWidth
    height = availableHeight
  } else {
    if (left + width > assetWidth) left = Math.max(0, assetWidth - width)
    if (top + height > assetHeight) top = Math.max(0, assetHeight - height)
  }

  if (mode === 'ratio' && config.ratio !== 'Original') {
    const [ratioX, ratioY] = String(config.ratio).split(':').map((item) => Number.parseFloat(item))
    if (Number.isFinite(ratioX) && Number.isFinite(ratioY) && ratioX > 0 && ratioY > 0) {
      const targetRatio = ratioX / ratioY
      const currentRatio = width / height
      if (currentRatio > targetRatio) {
        width = Math.max(1, Math.min(assetWidth, Math.round(height * targetRatio)))
      } else {
        height = Math.max(1, Math.min(assetHeight, Math.round(width / targetRatio)))
      }
    }
  }

  if (left + width > assetWidth) left = Math.max(0, assetWidth - width)
  if (top + height > assetHeight) top = Math.max(0, assetHeight - height)

  return { left, top, width, height }
}

async function renderManualCropSelection(sharpLib, transformed, box, stageMetrics, alphaCapable, outerAreaMode = 'trim') {
  const scaleX = stageMetrics.sourceWidth / Math.max(1, stageMetrics.imageWidth)
  const scaleY = stageMetrics.sourceHeight / Math.max(1, stageMetrics.imageHeight)
  const cropLeft = Math.round(box.left - stageMetrics.imageX)
  const cropTop = Math.round(box.top - stageMetrics.imageY)
  const cropRight = cropLeft + box.width
  const cropBottom = cropTop + box.height
  const intersectionLeft = Math.max(0, cropLeft)
  const intersectionTop = Math.max(0, cropTop)
  const intersectionRight = Math.min(stageMetrics.imageWidth, cropRight)
  const intersectionBottom = Math.min(stageMetrics.imageHeight, cropBottom)
  const intersectionWidth = Math.max(0, intersectionRight - intersectionLeft)
  const intersectionHeight = Math.max(0, intersectionBottom - intersectionTop)
  const mode = outerAreaMode === 'white' ? 'white' : 'trim'
  const outputWidth = Math.max(1, Math.round(box.width * scaleX))
  const outputHeight = Math.max(1, Math.round(box.height * scaleY))
  const intersectionOutputWidth = Math.max(0, Math.round(intersectionWidth * scaleX))
  const intersectionOutputHeight = Math.max(0, Math.round(intersectionHeight * scaleY))
  const canvasWidth = mode === 'white' ? outputWidth : Math.max(1, intersectionOutputWidth)
  const canvasHeight = mode === 'white' ? outputHeight : Math.max(1, intersectionOutputHeight)
  const background = mode === 'white' ? OPAQUE_WHITE_BG : (alphaCapable ? TRANSPARENT_BG : OPAQUE_WHITE_BG)
  let canvas = sharpLib({
    create: {
      width: canvasWidth,
      height: canvasHeight,
      channels: 4,
      background,
    },
  })

  if (intersectionWidth > 0 && intersectionHeight > 0) {
    const sourceLeft = Math.max(0, Math.round(intersectionLeft * scaleX))
    const sourceTop = Math.max(0, Math.round(intersectionTop * scaleY))
    const sourceWidth = Math.max(1, Math.round(intersectionWidth * scaleX))
    const sourceHeight = Math.max(1, Math.round(intersectionHeight * scaleY))
    const extracted = await transformed
      .clone()
      .extract({
        left: Math.min(sourceLeft, Math.max(0, stageMetrics.sourceWidth - 1)),
        top: Math.min(sourceTop, Math.max(0, stageMetrics.sourceHeight - 1)),
        width: Math.min(sourceWidth, stageMetrics.sourceWidth - Math.min(sourceLeft, Math.max(0, stageMetrics.sourceWidth - 1))),
        height: Math.min(sourceHeight, stageMetrics.sourceHeight - Math.min(sourceTop, Math.max(0, stageMetrics.sourceHeight - 1))),
      })
      .png()
      .toBuffer()
    canvas = canvas.composite([{
      input: extracted,
      left: mode === 'white' ? Math.max(0, Math.round(-cropLeft * scaleX)) : 0,
      top: mode === 'white' ? Math.max(0, Math.round(-cropTop * scaleY)) : 0,
    }])
  }

  return canvas
}

async function writeCropAsset(sharpLib, asset, config, destinationPath, suffix = 'crop', toolId = 'crop') {
  const { sourceFormat, format, outputPath } = await prepareSingleAssetWriteContext(
    sharpLib,
    asset,
    toolId,
    config,
    destinationPath,
    {
      outputSuffix: suffix,
      unique: toolId === 'manual-crop',
    },
  )
  const box = normalizeCropBox(asset, config, toolId)
  const manualStageMetrics = toolId === 'manual-crop' ? getManualCropStageMetrics(asset, config) : null
  const sourceWidth = Math.max(0, Number(asset.width) || 0)
  const sourceHeight = Math.max(0, Number(asset.height) || 0)
  const angle = Math.round(Number(config.angle) || 0)
  const hasFlipHorizontal = Boolean(config.flipHorizontal)
  const hasFlipVertical = Boolean(config.flipVertical)
  const hasTransform = angle !== 0 || hasFlipHorizontal || hasFlipVertical
  const alphaCapable = supportsTransparentCanvasOutput(format)

  const transformQuality = getTransformQuality(config.quality, sourceFormat, format)

  if (toolId !== 'manual-crop'
    && sourceWidth > 0 && sourceHeight > 0
    && !hasTransform
    && box.left === 0
    && box.top === 0
    && box.width === sourceWidth
    && box.height === sourceHeight) {
    return writeNoopSingleAsset(sharpLib, asset, outputPath, format, transformQuality, {
      sourceFormat,
      fallback: getAssetDimensionFallback(asset, sourceWidth, sourceHeight),
    })
  }

  let transformed = createTransformer(sharpLib, asset)
  if (toolId === 'manual-crop') {
    if (angle !== 0) {
      transformed = transformed.rotate(angle, {
        background: alphaCapable ? TRANSPARENT_BG : OPAQUE_WHITE_BG,
      })
    }
    if (hasFlipHorizontal) transformed = transformed.flop()
    if (hasFlipVertical) transformed = transformed.flip()
    transformed = await renderManualCropSelection(
      sharpLib,
      transformed,
      box,
      manualStageMetrics,
      alphaCapable,
      config.outerAreaMode,
    )
  } else {
    transformed = transformed.extract(box)
    if (hasFlipHorizontal) transformed = transformed.flop()
    if (hasFlipVertical) transformed = transformed.flip()
    if (angle !== 0) {
      transformed = transformed.rotate(angle, {
        background: alphaCapable ? TRANSPARENT_BG : OPAQUE_WHITE_BG,
      })
    }
  }
  return writeTransformedAsset(transformed, format, transformQuality, outputPath)
}

async function writeMergeImageAsset(sharpLib, payload) {
  throwIfRunCancelled(payload.runId)
  const format = mapOutputFormat('format', null, { targetFormat: payload.config.outputFormat })
  const quality = Math.max(1, Math.min(100, Number(payload.config.quality) || 90))
  const outputExtension = format === 'jpeg' ? 'jpg' : format
  const outputPath = path.join(payload.destinationPath, `merged-image.${outputExtension}`)
  const background = hexToRgbaObject(payload.config.background, 1)
  const isVertical = payload.config.direction === 'vertical'
  const isCentered = payload.config.align === 'center'
  const preventUpscale = Boolean(payload.config.preventUpscale)
  const targetSpan = payload.config.useMaxAssetSize
    ? Math.max(1, ...payload.assets.map((asset) => Math.max(0, Number(isVertical ? asset?.width : asset?.height) || 0)))
    : Math.max(1, Number(payload.config.pageWidth) || 1)
  const fitWidth = isVertical ? targetSpan : undefined
  const fitHeight = isVertical ? undefined : targetSpan
  if (payload.assets.length === 1) {
    const asset = payload.assets[0]
    const { inputFormat, sourceFormat } = await ensureAssetDescriptorState(sharpLib, asset)
    asset.inputFormat = inputFormat
    const keepsOriginalSize = isVertical
      ? ((preventUpscale && Number(asset.width) <= targetSpan) || Number(asset.width) === targetSpan)
      : ((preventUpscale && Number(asset.height) <= targetSpan) || Number(asset.height) === targetSpan)
    if (keepsOriginalSize && canCopyWithoutTransform(sourceFormat, format, quality)) {
      return copyAssetToOutput(asset, outputPath)
    }
    return writeTransformedAsset(createTransformer(sharpLib, asset)
      .resize({
        width: fitWidth,
        height: fitHeight,
        fit: 'contain',
        background,
        withoutEnlargement: preventUpscale,
      }), format, quality, outputPath)
  }
  const profile = getPerformanceProfile(getAppSettings().performanceMode)
  const prepareConcurrency = Math.max(1, Math.min(payload.assets.length, Math.min(profile.mediumConcurrency, 4)))
  const dominantSize = targetSpan
  const prepareAsset = async (asset) => {
    throwIfRunCancelled(payload.runId)
    const { width: sourceWidth, height: sourceHeight } = await resolveAssetDimensions(sharpLib, asset)
    const keepsOriginalSize = isVertical
      ? ((preventUpscale && sourceWidth <= targetSpan) || sourceWidth === targetSpan)
      : ((preventUpscale && sourceHeight <= targetSpan) || sourceHeight === targetSpan)
    if (sourceWidth > 0 && sourceHeight > 0 && keepsOriginalSize) {
      const { data, info } = await createTransformer(sharpLib, asset)
        .flatten({ background })
        .raw()
        .toBuffer({ resolveWithObject: true })
      return {
        input: data,
        raw: {
          width: info.width,
          height: info.height,
          channels: info.channels,
        },
        width: info.width || sourceWidth,
        height: info.height || sourceHeight,
      }
    }
    const { data, info } = await createTransformer(sharpLib, asset)
      .resize({
        width: fitWidth,
        height: fitHeight,
        fit: 'contain',
        background,
        withoutEnlargement: preventUpscale,
      })
      .flatten({ background })
      .raw()
      .toBuffer({ resolveWithObject: true })
    const baseWidth = Math.max(1, sourceWidth || 1)
    const baseHeight = Math.max(1, sourceHeight || 1)
    const scale = isVertical
      ? (preventUpscale ? Math.min(1, dominantSize / baseWidth) : (dominantSize / baseWidth))
      : (preventUpscale ? Math.min(1, dominantSize / baseHeight) : (dominantSize / baseHeight))
    return {
      input: data,
      raw: {
        width: info.width,
        height: info.height,
        channels: info.channels,
      },
      width: info.width || Math.max(1, Math.round(baseWidth * scale)),
      height: info.height || Math.max(1, Math.round(baseHeight * scale)),
    }
  }
  const prepared = new Array(payload.assets.length)
  for (let index = 0; index < payload.assets.length; index += prepareConcurrency) {
    throwIfRunCancelled(payload.runId)
    const preparedBatch = await mapIndexRangeWithConcurrency(
      index,
      Math.min(payload.assets.length, index + prepareConcurrency),
      prepareConcurrency,
      (assetIndex) => prepareAsset(payload.assets[assetIndex]),
    )
    for (let offset = 0; offset < preparedBatch.length; offset += 1) {
      prepared[index + offset] = preparedBatch[offset]
    }
    await yieldToEventLoop()
  }
  throwIfRunCancelled(payload.runId)
  let contentWidth = 0
  let contentHeight = 0

  for (const item of prepared) {
    const { width, height } = item
    if (isVertical) {
      contentWidth = Math.max(contentWidth, width)
      contentHeight += height
    } else {
      contentWidth += width
      contentHeight = Math.max(contentHeight, height)
    }
  }

  if (!prepared.length) throw new Error('没有可拼接的图片')

  const spacing = payload.config.spacing
  const spacingTotal = spacing * Math.max(0, prepared.length - 1)
  const totalWidth = isVertical ? contentWidth : contentWidth + spacingTotal
  const totalHeight = isVertical ? contentHeight + spacingTotal : contentHeight

  let cursorX = 0
  let cursorY = 0
  const composites = new Array(prepared.length)
  for (let index = 0; index < prepared.length; index += 1) {
    const item = prepared[index]
    const composite = {
      input: item.input,
      raw: item.raw,
      left: isVertical && isCentered
        ? Math.max(0, Math.round((totalWidth - item.width) / 2))
        : cursorX,
      top: !isVertical && isCentered
        ? Math.max(0, Math.round((totalHeight - item.height) / 2))
        : cursorY,
    }
    if (isVertical) {
      cursorY += item.height + spacing
    } else {
      cursorX += item.width + spacing
    }
    composites[index] = composite
  }

  const info = await withOutputFormat(sharpLib({
    create: {
      width: totalWidth,
      height: totalHeight,
      channels: 3,
      background,
    },
  }).composite(composites), format, quality).toFile(outputPath)
  throwIfRunCancelled(payload.runId)
  for (let index = 0; index < composites.length; index += 1) {
    if (composites[index]) {
      composites[index].input = null
      composites[index].raw = null
      composites[index] = null
    }
    if (prepared[index]) {
      prepared[index].input = null
      prepared[index].raw = null
      prepared[index] = null
    }
  }
  prepared.length = 0
  composites.length = 0

  return {
    outputPath,
    outputSizeBytes: Number(info?.size) || 0,
    width: totalWidth,
    height: totalHeight,
  }
}

async function writeMergePdfAssetResponsive(sharpLib, payload) {
  throwIfRunCancelled(payload.runId)
  emitProcessingProgress({
    phase: 'merge-pdf-prepare',
    runId: payload.runId,
    toolId: payload.toolId,
    toolLabel: payload.toolLabel,
    mode: payload.mode,
    total: Math.max(1, Array.isArray(payload.assets) ? payload.assets.length : 0),
    completed: 0,
    succeeded: 0,
    failed: 0,
  })
  const preparedPayload = await prepareMergePdfChildPayload(sharpLib, payload)
  try {
    return await runMergePdfWorker(preparedPayload)
  } finally {
    cleanupMergePdfChildPayload(preparedPayload)
  }
}

async function writeMergePdfAssetReal(sharpLib, payload) {
  throwIfRunCancelled(payload.runId)
  let pdfLib = null
  try {
    pdfLib = require('pdf-lib')
  } catch {
    pdfLib = null
  }
  if (!pdfLib) throw new Error('缺少 pdf-lib 依赖')
  const outputPath = path.join(payload.destinationPath, 'merged.pdf')
  const pdf = await pdfLib.PDFDocument.create()
  const background = hexToRgbaObject(payload.config.background || '#ffffff', 1)
  const backgroundColor = pdfLib.rgb(background.r / 255, background.g / 255, background.b / 255)
  const profile = getPerformanceProfile(getAppSettings().performanceMode)
  const prepareConcurrency = Math.max(1, Math.min(payload.assets.length, Math.min(profile.heavyConcurrency, 3)))
  const fixedPageSize = payload.config.pageSize === 'Original'
    ? null
    : (PDF_PAGE_SIZES[payload.config.pageSize] || PDF_PAGE_SIZES.A4)
  const autoPaginateFixedPage = payload.config.autoPaginate && Boolean(fixedPageSize)
  const fixedMargin = fixedPageSize
    ? (payload.config.margin === 'none'
      ? 0
      : payload.config.margin === 'wide'
        ? Math.round(fixedPageSize[0] * 0.08)
        : payload.config.margin === 'normal'
          ? Math.round(fixedPageSize[0] * 0.06)
          : Math.round(fixedPageSize[0] * 0.04))
    : null
  const fixedDrawableWidth = fixedPageSize ? Math.max(1, fixedPageSize[0] - fixedMargin * 2) : 0
  const fixedDrawableHeight = fixedPageSize ? Math.max(1, fixedPageSize[1] - fixedMargin * 2) : 0
  const paintPdfPageBackground = (page, pageSize) => {
    page.drawRectangle({
      x: 0,
      y: 0,
      width: pageSize[0],
      height: pageSize[1],
      color: backgroundColor,
    })
  }
  let preparedCount = 0
  const emitMergePdfProgress = (phase) => {
    emitProcessingProgress({
      phase,
      runId: payload.runId,
      toolId: payload.toolId,
      toolLabel: payload.toolLabel,
      mode: payload.mode,
      total: Math.max(1, Array.isArray(payload.assets) ? payload.assets.length : 0),
      completed: preparedCount,
      succeeded: 0,
      failed: 0,
    })
  }
  emitMergePdfProgress('merge-pdf-prepare')
  const prepareAsset = async (asset) => {
    throwIfRunCancelled(payload.runId)
    let sourceWidth = Math.max(0, Number(asset.width) || 0)
    let sourceHeight = Math.max(0, Number(asset.height) || 0)
    const needsMetadata = autoPaginateFixedPage && !(sourceWidth > 0 && sourceHeight > 0)
    const { descriptorState } = await resolveAssetDimensions(sharpLib, asset, { probeMetadata: needsMetadata })
    if (descriptorState?.inputFormat) asset.inputFormat = descriptorState.inputFormat
    if (needsMetadata) {
      sourceWidth = Math.max(1, Number(asset.width) || Number(descriptorState?.metadata?.width) || sourceWidth || 1)
      sourceHeight = Math.max(1, Number(asset.height) || Number(descriptorState?.metadata?.height) || sourceHeight || 1)
    }
    const sourceFormat = normalizeImageFormatName(asset.inputFormat || asset.ext)
    const margin = fixedMargin ?? (payload.config.margin === 'none'
      ? 0
      : payload.config.margin === 'wide'
        ? Math.round((sourceWidth || 1) * 0.08)
        : payload.config.margin === 'normal'
          ? Math.round((sourceWidth || 1) * 0.06)
          : Math.round((sourceWidth || 1) * 0.04))
    const prepared = {
      imageBytes: null,
      sourcePath: asset.sourcePath,
      sourceFormat,
      sourceWidth,
      sourceHeight,
      margin,
      drawableWidth: 0,
      drawableHeight: 0,
      scaledWidth: 0,
      scaledHeight: 0,
      pageSliceHeight: 0,
      scaledBuffer: null,
      embeddedBytes: null,
      embeddedKind: '',
    }

    if (autoPaginateFixedPage) {
      prepared.drawableWidth = fixedDrawableWidth
      prepared.drawableHeight = fixedDrawableHeight
      prepared.scaledWidth = fixedDrawableWidth
      prepared.pageSliceHeight = fixedDrawableHeight
      prepared.scaledHeight = Math.max(1, Math.round(sourceHeight * (prepared.scaledWidth / sourceWidth)))
      prepared.requiresSlicing = prepared.scaledHeight > prepared.drawableHeight
    } else if (prepared.sourceFormat !== 'png' && prepared.sourceFormat !== 'jpg' && prepared.sourceFormat !== 'jpeg') {
      const embeddedKind = isAlphaCapableFormat(prepared.sourceFormat) ? 'png' : 'jpg'
      prepared.embeddedBytes = embeddedKind === 'png'
        ? await createTransformer(sharpLib, asset).png().toBuffer()
        : await createTransformer(sharpLib, asset).jpeg().toBuffer()
      prepared.embeddedKind = embeddedKind
    }

    preparedCount += 1
    emitMergePdfProgress('merge-pdf-prepare')
    await yieldToEventLoop()
    return prepared
  }
  const preparedAssets = payload.assets.length === 1
    ? [await prepareAsset(payload.assets[0])]
    : await mapWithConcurrency(payload.assets, prepareConcurrency, prepareAsset)
  throwIfRunCancelled(payload.runId)
  emitMergePdfProgress('merge-pdf-write')

  for (let preparedIndex = 0; preparedIndex < preparedAssets.length; preparedIndex += 1) {
    const prepared = preparedAssets[preparedIndex]
    throwIfRunCancelled(payload.runId)
    await yieldToEventLoop()
    let embedded = null
    let sourceWidth = prepared.sourceWidth
    let sourceHeight = prepared.sourceHeight
    const ensureSourceBytes = () => {
      if (!prepared.imageBytes) {
        prepared.imageBytes = fs.readFileSync(prepared.sourcePath)
      }
      return prepared.imageBytes
    }
    const ensureEmbedded = async () => {
      if (embedded) return embedded
      if (prepared.embeddedKind === 'png' && prepared.embeddedBytes) {
        embedded = await pdf.embedPng(prepared.embeddedBytes)
        prepared.embeddedBytes = null
      } else if (prepared.embeddedKind === 'jpg' && prepared.embeddedBytes) {
        embedded = await pdf.embedJpg(prepared.embeddedBytes)
        prepared.embeddedBytes = null
      } else if (prepared.sourceFormat === 'png') {
        embedded = await pdf.embedPng(ensureSourceBytes())
        prepared.imageBytes = null
      } else if (prepared.sourceFormat === 'jpg' || prepared.sourceFormat === 'jpeg') {
        embedded = await pdf.embedJpg(ensureSourceBytes())
        prepared.imageBytes = null
      } else {
        const fallbackEmbeddedBytes = prepared.embeddedBytes || await createTransformer(sharpLib, {
          ...prepared,
          sourcePath: prepared.sourcePath,
          inputFormat: prepared.sourceFormat,
          ext: prepared.sourceFormat,
        }).png().toBuffer()
        embedded = await pdf.embedPng(fallbackEmbeddedBytes)
        if (prepared.embeddedBytes === fallbackEmbeddedBytes) {
          prepared.embeddedBytes = null
        }
      }
      sourceWidth = Math.max(1, sourceWidth || embedded.width || 1)
      sourceHeight = Math.max(1, sourceHeight || embedded.height || 1)
      return embedded
    }
    const margin = prepared.margin

    if (!fixedPageSize) {
      const originalImage = await ensureEmbedded()
      const pageSize = [originalImage.width + margin * 2, originalImage.height + margin * 2]
      const page = pdf.addPage(pageSize)
      paintPdfPageBackground(page, pageSize)
      page.drawImage(originalImage, {
        x: margin,
        y: margin,
        width: originalImage.width,
        height: originalImage.height,
      })
      continue
    }

    const pageSize = fixedPageSize
    const drawableWidth = prepared.drawableWidth || fixedDrawableWidth
    const drawableHeight = prepared.drawableHeight || fixedDrawableHeight

    if (!payload.config.autoPaginate) {
      const pageImage = await ensureEmbedded()
      const page = pdf.addPage(pageSize)
      paintPdfPageBackground(page, pageSize)
      const scale = Math.min(drawableWidth / pageImage.width, drawableHeight / pageImage.height)
      const width = pageImage.width * scale
      const height = pageImage.height * scale
      page.drawImage(pageImage, {
        x: (pageSize[0] - width) / 2,
        y: (pageSize[1] - height) / 2,
        width,
        height,
      })
      continue
    }

    const scaledWidth = prepared.scaledWidth || drawableWidth
    const pageSliceHeight = prepared.pageSliceHeight || drawableHeight
    const scaledHeight = prepared.scaledHeight || Math.max(1, Math.round(sourceHeight * (scaledWidth / sourceWidth)))

    if (prepared.requiresSlicing === false || scaledHeight <= drawableHeight) {
      const pageImage = await ensureEmbedded()
      const width = scaledWidth
      const height = scaledHeight
      const page = pdf.addPage(pageSize)
      paintPdfPageBackground(page, pageSize)
      page.drawImage(pageImage, {
        x: margin,
        y: (pageSize[1] - height) / 2,
        width,
        height,
      })
      continue
    }

    const scaledBuffer = await createTransformer(sharpLib, {
      sourcePath: prepared.sourcePath,
      inputFormat: prepared.sourceFormat,
      ext: prepared.sourceFormat,
    })
      .resize({ width: scaledWidth, fit: 'fill' })
      .png()
      .toBuffer()
    prepared.scaledBuffer = null
    const scaledImage = sharpLib(scaledBuffer)
    let offsetY = 0
    while (offsetY < scaledHeight) {
      throwIfRunCancelled(payload.runId)
      await yieldToEventLoop()
      const sliceHeight = Math.min(pageSliceHeight, scaledHeight - offsetY)
      const sliceBuffer = await scaledImage.clone()
        .extract({ left: 0, top: offsetY, width: scaledWidth, height: sliceHeight })
        .png()
        .toBuffer()
      const pageImage = await pdf.embedPng(sliceBuffer)
      const page = pdf.addPage(pageSize)
      paintPdfPageBackground(page, pageSize)
      page.drawImage(pageImage, {
        x: margin,
        y: pageSize[1] - margin - pageImage.height,
        width: pageImage.width,
        height: pageImage.height,
      })
      offsetY += sliceHeight
    }
    embedded = null
    prepared.imageBytes = null
    prepared.embeddedBytes = null
    prepared.scaledBuffer = null
    preparedAssets[preparedIndex] = null
  }
  preparedAssets.length = 0

  const saveObjectsPerTick = payload.assets.length > 8 ? 8 : 16
  const bytes = await pdf.save({ objectsPerTick: saveObjectsPerTick })
  throwIfRunCancelled(payload.runId)
  return writeOutputBuffer(outputPath, bytes, {
    width: fixedPageSize?.[0] || 0,
    height: fixedPageSize?.[1] || 0,
  })
}

async function writeMergeGifAsset(sharpLib, payload) {
  throwIfRunCancelled(payload.runId)
  let gifenc = null
  try {
    gifenc = require('gifenc')
  } catch {
    gifenc = null
  }
  if (!gifenc) throw new Error('缺少 gifenc 依赖')
  const outputPath = path.join(payload.destinationPath, 'merged.gif')
  const { GIFEncoder, quantize, applyPalette } = gifenc
  const encoder = GIFEncoder()
  const profile = getPerformanceProfile(getAppSettings().performanceMode)
  const hydrationConcurrency = Math.max(1, Math.min((payload.assets || []).length || 1, Math.min(profile.mediumConcurrency, 4)))
  const hydratedAssets = await mapWithConcurrency(payload.assets || [], hydrationConcurrency, async (asset) => {
    const { width, height } = await resolveAssetDimensions(sharpLib, asset)
    asset.width = width
    asset.height = height
    return asset
  })
  let maxFrameWidth = 1
  let maxFrameHeight = 1
  for (const asset of hydratedAssets) {
    maxFrameWidth = Math.max(maxFrameWidth, Math.max(0, Number(asset?.width) || 0))
    maxFrameHeight = Math.max(maxFrameHeight, Math.max(0, Number(asset?.height) || 0))
  }
  const frameWidth = payload.config.useMaxAssetSize ? maxFrameWidth : payload.config.width
  const frameHeight = payload.config.useMaxAssetSize ? maxFrameHeight : payload.config.height
  const background = hexToRgbaObject(payload.config.background, 1)
  const delay = Math.max(1, Math.round(payload.config.interval))
  const repeat = payload.config.loop ? 0 : -1
  const frameWriteOptions = { delay, repeat }
  const frameConcurrency = Math.max(1, Math.min(hydratedAssets.length, Math.min(profile.mediumConcurrency, 4)))
  const frameResizeOptions = { width: frameWidth, height: frameHeight, fit: 'contain', background }
  const prepareFrame = async (asset) => {
    throwIfRunCancelled(payload.runId)
    const data = await createTransformer(sharpLib, asset)
      .resize(frameResizeOptions)
      .ensureAlpha()
      .raw()
      .toBuffer()
    const palette = quantize(data, 256)
    const index = applyPalette(data, palette)
    return { index, palette }
  }
  if (hydratedAssets.length === 1) {
    const frame = await prepareFrame(hydratedAssets[0])
    throwIfRunCancelled(payload.runId)
    encoder.writeFrame(frame.index, frameWidth, frameHeight, {
      palette: frame.palette,
      ...frameWriteOptions,
    })
    hydratedAssets[0] = null
  } else {
    for (let index = 0; index < hydratedAssets.length; index += frameConcurrency) {
      throwIfRunCancelled(payload.runId)
      const preparedFrames = await mapIndexRangeWithConcurrency(
        index,
        Math.min(hydratedAssets.length, index + frameConcurrency),
        frameConcurrency,
        (assetIndex) => prepareFrame(hydratedAssets[assetIndex]),
      )
      for (let frameIndex = 0; frameIndex < preparedFrames.length; frameIndex += 1) {
        const frame = preparedFrames[frameIndex]
        throwIfRunCancelled(payload.runId)
        encoder.writeFrame(frame.index, frameWidth, frameHeight, {
          palette: frame.palette,
          ...frameWriteOptions,
        })
        preparedFrames[frameIndex] = null
      }
      await yieldToEventLoop()
    }
  }
  hydratedAssets.length = 0

  encoder.finish()
  throwIfRunCancelled(payload.runId)
  const bytes = encoder.bytesView()
  return writeOutputBuffer(outputPath, bytes)
}

async function executeAssetTool(sharpLib, payload, asset) {
  const handler = ASSET_TOOL_HANDLERS[payload.toolId]
  if (handler) return handler(sharpLib, asset, payload.config, payload.destinationPath)
  if (payload.toolId === 'manual-crop') {
    const manualArea = payload.config.cropAreas?.[asset.id]
    const manualTransform = {
      angle: clampNumber(manualArea?.angle ?? payload.config.angle, -180, 180, 0),
      flipHorizontal: Boolean(manualArea?.flipHorizontal ?? payload.config.flipHorizontal),
      flipVertical: Boolean(manualArea?.flipVertical ?? payload.config.flipVertical),
      viewScale: clampNumber(manualArea?.viewScale ?? payload.config.viewScale, 0.5, 3, 1),
      viewOffsetX: toInteger(manualArea?.viewOffsetX ?? payload.config.viewOffsetX, 0),
      viewOffsetY: toInteger(manualArea?.viewOffsetY ?? payload.config.viewOffsetY, 0),
    }
    return writeCropAsset(sharpLib, asset, {
      ratio: payload.config.ratioValue || payload.config.ratio,
      area: manualArea || { x: 0, y: 0, width: asset.width, height: asset.height },
      angle: manualTransform.angle,
      flipHorizontal: manualTransform.flipHorizontal,
      flipVertical: manualTransform.flipVertical,
      viewScale: manualTransform.viewScale,
      viewOffsetX: manualTransform.viewOffsetX,
      viewOffsetY: manualTransform.viewOffsetY,
      stageWidth: payload.config.stageWidth,
      stageHeight: payload.config.stageHeight,
      outerAreaMode: payload.config.outerAreaMode,
      keepOriginalFormat: payload.config.keepOriginalFormat,
    }, payload.destinationPath, 'manual-crop', 'manual-crop')
  }
  throw new Error(`未支持的工具：${payload.toolId}`)
}

function isMergeTool(toolId) {
  return MERGE_TOOL_IDS.has(toolId)
}

async function executeSingleAssetTool(payload, sharpLib) {
  let completedCount = 0
  let failedCount = 0
  let cancelled = false
  const totalCount = payload.assets.length
  const emitAssetProgress = () => {
    emitProcessingProgress({
      phase: 'progress',
      runId: payload.runId,
      toolId: payload.toolId,
      toolLabel: payload.toolLabel,
      mode: payload.mode,
      total: totalCount,
      completed: completedCount + failedCount,
      succeeded: completedCount,
      failed: failedCount,
    })
  }
  const executeAsset = async (asset) => {
    if (cancelled || isRunCancelled(payload.runId)) {
      cancelled = true
      return { processed: null, failed: null, cancelled: true }
    }
    if (asset.sourcePath) {
      await getAssetDescriptor(sharpLib, asset, { probeMetadata: true })
    }
    const inputFormat = normalizeImageFormatName(asset.inputFormat || asset.ext)
    if (!(asset.sourcePath && SHARP_INPUT_FORMATS.has(inputFormat))) {
      failedCount += 1
      emitAssetProgress()
      return {
        processed: null,
        failed: { assetId: asset.id, name: asset.name, error: `暂不支持处理 ${inputFormat || asset.ext || 'unknown'} 格式` },
      }
    }

    try {
      const result = await executeAssetTool(sharpLib, payload, asset)
      if (isRunCancelled(payload.runId)) {
        cancelled = true
        return { processed: null, failed: null, cancelled: true }
      }

      const processed = await (payload.mode === 'direct'
        ? directResultToProcessed(asset, result, payload, sharpLib)
        : stageResultToProcessed(asset, result, payload, sharpLib))
      completedCount += 1
      emitAssetProgress()
      return {
        processed,
        failed: null,
      }
    } catch (error) {
      if (error?.code === 'RUN_CANCELLED') {
        cancelled = true
        return { processed: null, failed: null, cancelled: true }
      }
      failedCount += 1
      emitAssetProgress()
      return {
        processed: null,
        failed: { assetId: asset.id, name: asset.name, error: error?.message || '处理失败' },
      }
    }
  }
  const outcomes = totalCount === 1
    ? [await executeAsset(payload.assets[0])]
    : await mapWithConcurrency(
        payload.assets,
        getAssetProcessingConcurrency(payload),
        executeAsset,
        { shouldStop: () => cancelled || isRunCancelled(payload.runId) },
      )

  const processed = []
  const failed = []
  for (const item of outcomes) {
    if (item?.processed) processed.push(item.processed)
    if (item?.failed) failed.push(item.failed)
    if (item?.cancelled) cancelled = true
  }

  return {
    processed,
    failed,
    cancelled,
  }
}

function saveAppSettings(settings = {}) {
  const hostApi = getHostApi()
  const next = buildSettingsPayload({ ...getAppSettings(), ...settings })
  hostApi.dbStorage?.setItem?.(SETTINGS_STORAGE_KEY, next)
  return next
}

function buildStagedItemsFromAssets(assets = []) {
  return assets
    .filter((asset) => asset?.previewStatus === 'staged' && asset?.stagedOutputPath)
    .map((asset) => ({
      assetId: asset.id,
      name: asset.name,
      stagedPath: asset.stagedOutputPath,
      outputName: asset.stagedOutputName || path.basename(asset.stagedOutputPath),
      outputSizeBytes: asset.stagedSizeBytes || 0,
      width: asset.stagedWidth || 0,
      height: asset.stagedHeight || 0,
      runId: asset.runId || '',
      runFolderName: asset.runFolderName || '',
      toolId: asset.stagedToolId || '',
    }))
}

async function executeSaveFlow(payload) {
  if (!payload.stagedItems?.length) {
    return revealResultDirectoryIfNeeded({
      ok: false,
      partial: false,
      ...payload,
      processed: [],
      failed: [{ assetId: payload.toolId, name: payload.toolLabel, error: '没有可保存的预览结果。' }],
      message: '没有可保存的预览结果。',
    })
  }

  if (!payload.destinationPath) {
    return revealResultDirectoryIfNeeded({
      ok: false,
      partial: false,
      ...payload,
      processed: [],
      failed: [{ assetId: payload.toolId, name: payload.toolLabel, error: '无法解析保存目录。' }],
      message: '无法解析保存目录。',
    })
  }

  ensureDirectory(payload.destinationPath)
  const processed = []
  const failed = []

  for (const item of payload.stagedItems) {
    try {
      const sourcePath = sanitizeText(item?.stagedPath)
      if (!sourcePath || !fs.existsSync(sourcePath)) {
        throw new Error('预览结果不存在，无法保存')
      }
      const finalDirectory = path.join(payload.destinationPath, payload.runFolderName)
      ensureDirectory(finalDirectory)
      const targetPath = path.join(finalDirectory, item.outputName || path.basename(sourcePath))
      if (path.resolve(sourcePath) !== path.resolve(targetPath)) {
        fs.copyFileSync(sourcePath, targetPath)
      }
      const saved = createOutputMeta(targetPath, {
        size: item?.outputSizeBytes,
        width: item?.width,
        height: item?.height,
      }, item)
      processed.push({
        assetId: item.assetId,
        name: item.name,
        mode: 'direct',
        previewStatus: 'saved',
        outputPath: saved.outputPath,
        outputName: saved.outputName,
        outputSizeBytes: saved.outputSizeBytes,
        width: saved.width,
        height: saved.height,
        savedOutputPath: saved.outputPath || '',
      })
    } catch (error) {
      failed.push({ assetId: item.assetId, name: item.name, error: error?.message || '保存失败' })
    }
  }

  const savePayload = { ...payload, mode: 'save' }
  return revealResultDirectoryIfNeeded({
    ok: processed.length > 0 && failed.length === 0,
    partial: processed.length > 0 && failed.length > 0,
    ...savePayload,
    processed,
    failed,
    elapsedMs: Number(savePayload?.elapsedMs) || 0,
    message: formatResultMessage(savePayload, processed, failed),
  })
}

async function stageToolPreview(toolId, config, assets, destinationPath, mode = 'preview-save', options = {}) {
  const payload = prepareRunPayload(toolId, config, assets, destinationPath, options)
  if (mode !== 'preview-only') {
    return executeLocalTool({
      ...payload,
      mode,
    })
  }

  const basePreviewPath = path.join(os.tmpdir(), PREVIEW_DIR_NAME)
  const runFolderName = buildRunFolderName(payload.createdAt, toolId)
  return executeLocalTool({
    ...payload,
    destinationPath: path.join(basePreviewPath, runFolderName),
    baseDestinationPath: basePreviewPath,
    runFolderName,
    mode,
  })
}

async function saveAllStagedResults(toolId, stagedItems, destinationPath) {
  const output = resolveDestinationPath(destinationPath, [], getAppSettings())
  const normalizedItems = Array.isArray(stagedItems) ? stagedItems : []
  const firstItem = normalizedItems[0] || {}
  const createdAt = new Date().toISOString()
  return executeSaveFlow({
    toolId,
    toolLabel: TOOL_LABELS[toolId] || toolId,
    destinationPath: output.destinationPath,
    output,
    mode: 'save',
    stagedItems: normalizedItems,
    runId: firstItem.runId || '',
    runFolderName: firstItem.runFolderName || buildRunFolderName(createdAt, toolId),
    createdAt,
  })
}

async function materializePreviewResults(toolId, stagedItems, destinationPath, preferredRunFolderName = '') {
  const output = resolveDestinationPath(destinationPath, [], getAppSettings())
  const normalizedItems = Array.isArray(stagedItems) ? stagedItems : []
  const createdAt = new Date().toISOString()
  const run = createRunDescriptor(
    output.destinationPath,
    toolId,
    createdAt,
    preferredRunFolderName || normalizedItems[0]?.runFolderName || '',
  )
  ensureDirectory(run.runPath)
  const processed = []
  const failed = []

  for (const item of normalizedItems) {
    try {
      const sourcePath = sanitizeText(item?.stagedPath)
      if (!sourcePath || !fs.existsSync(sourcePath)) {
        throw new Error('预览结果不存在，无法复用')
      }
      const targetPath = path.join(run.runPath, item.outputName || path.basename(sourcePath))
      if (path.resolve(sourcePath) !== path.resolve(targetPath)) {
        fs.copyFileSync(sourcePath, targetPath)
      }
      const meta = createOutputMeta(targetPath, {
        size: item?.outputSizeBytes,
        width: item?.width,
        height: item?.height,
      }, item)
      const previewFormat = path.extname(targetPath).replace('.', '') || meta.outputName.split('.').pop() || ''
      const previewUrl = await createAssetDisplayUrlAsync(targetPath, previewFormat)
      processed.push({
        assetId: item.assetId,
        name: item.name,
        mode: 'preview-save',
        previewStatus: 'saved',
        outputName: meta.outputName,
        stagedPath: '',
        previewUrl,
        outputPath: targetPath,
        outputSizeBytes: meta.outputSizeBytes,
        width: meta.width,
        height: meta.height,
        warning: item?.warning || '',
        saveSignature: item?.saveSignature || '',
        runId: run.runId,
        runFolderName: run.runFolderName,
        savedOutputPath: targetPath,
      })
    } catch (error) {
      failed.push({ assetId: item?.assetId, name: item?.name || '', error: error?.message || '复用预览结果失败' })
    }
  }

  return {
    ok: processed.length > 0 && failed.length === 0,
    partial: processed.length > 0 && failed.length > 0,
    toolId,
    toolLabel: TOOL_LABELS[toolId] || toolId,
    destinationPath: run.runPath,
    baseDestinationPath: output.destinationPath,
    output,
    mode: 'preview-save',
    runId: run.runId,
    runFolderName: run.runFolderName,
    createdAt,
    processed,
    failed,
    elapsedMs: 0,
    message: processed.length
      ? `已复用 ${processed.length} 项预览结果并加入当前处理结果。`
      : '没有可复用的预览结果。',
  }
}

function cleanupPreviewCache(runFolderNames = [], options = {}) {
  const basePreviewPath = path.join(os.tmpdir(), PREVIEW_DIR_NAME)
  const folders = new Set()
  const reason = sanitizeText(options?.reason || 'unspecified')
  for (const value of Array.isArray(runFolderNames) ? runFolderNames : []) {
    const folderName = path.basename(String(value || '').trim())
    if (!folderName) continue
    folders.add(folderName)
  }
  appendPreviewCacheDebugLog('cleanup-preview-cache', {
    basePreviewPath,
    reason,
    runFolderNames: Array.from(folders),
    count: folders.size,
  })
  for (const folderName of folders) {
    const targetPath = path.join(basePreviewPath, folderName)
    try {
      fs.rmSync(targetPath, { recursive: true, force: true })
    } catch {
      // Ignore preview cleanup failures so UI state cleanup is not blocked.
    }
  }
  return true
}

function clearPreviewCacheDirectory(options = {}) {
  const basePreviewPath = path.join(os.tmpdir(), PREVIEW_DIR_NAME)
  const reason = sanitizeText(options?.reason || 'unspecified')
  appendPreviewCacheDebugLog('clear-preview-cache-directory', {
    basePreviewPath,
    reason,
  })
  try {
    fs.rmSync(basePreviewPath, { recursive: true, force: true })
  } catch {
    // Ignore cleanup failures and let the caller continue clearing in-memory state.
  }
  return true
}

function checkStagedFiles(stagedItems = []) {
  const validAssetIds = []
  for (const item of Array.isArray(stagedItems) ? stagedItems : []) {
    const sourcePath = sanitizeText(item?.stagedPath)
    if (!sourcePath) continue
    if (!fs.existsSync(sourcePath)) continue
    const assetId = sanitizeText(item?.assetId)
    if (assetId) validAssetIds.push(assetId)
  }
  return validAssetIds
}

async function executeMergeTool(payload, sharpLib) {
  const processed = []
  const failed = []
  let cancelled = false
  try {
    throwIfRunCancelled(payload.runId)
    const mergeHandler = MERGE_TOOL_HANDLERS[payload.toolId]
    const result = await mergeHandler(sharpLib, payload)
    throwIfRunCancelled(payload.runId)
    const outputPath = typeof result === 'string' ? result : result.outputPath
    const outputName = path.basename(outputPath)
    processed.push({
      assetId: payload.assets[0]?.id || payload.toolId,
      name: outputName,
      mode: 'direct',
      previewStatus: 'saved',
      outputPath,
      outputName,
      outputSizeBytes: Number(result?.outputSizeBytes) || 0,
      width: Number(result?.width) || 0,
      height: Number(result?.height) || 0,
      savedOutputPath: outputPath || '',
    })
  } catch (error) {
    if (error?.code === 'RUN_CANCELLED') {
      cancelled = true
      return { processed, failed, cancelled }
    }
    failed.push({ assetId: payload.toolId, name: payload.toolLabel, error: error?.message || '处理失败' })
  }

  return { processed, failed, cancelled }
}

async function executeLocalTool(payload) {
  const sharpLib = getSharp()
  if (!sharpLib) {
    return {
      ok: false,
      ...payload,
      message: '缺少 sharp 依赖，无法执行本地图片处理。请先安装依赖。',
    }
  }

  if (!payload.destinationPath) {
    return {
      ok: false,
      ...payload,
      message: '无法解析输出目录。',
    }
  }

  ensureDirectory(payload.destinationPath)
  clearCancelledRun(payload.runId)
  const startedAt = Date.now()
  emitProcessingProgress({
    phase: 'start',
    runId: payload.runId,
    toolId: payload.toolId,
    toolLabel: payload.toolLabel,
    mode: payload.mode,
    total: Array.isArray(payload.assets) ? payload.assets.length : 0,
    completed: 0,
    succeeded: 0,
    failed: 0,
    startedAt,
  })

  let processed = []
  let failed = []
  let cancelled = false
  try {
    ({ processed, failed, cancelled } = isMergeTool(payload.toolId)
      ? await executeMergeTool(payload, sharpLib)
      : await executeSingleAssetTool(payload, sharpLib))
  } finally {
    clearCancelledRun(payload.runId)
  }
  const elapsedMs = Date.now() - startedAt

  const ok = processed.length > 0 && failed.length === 0
  const partial = processed.length > 0 && failed.length > 0
  const message = cancelled
    ? (processed.length
      ? `已停止 ${payload.toolLabel}，已完成 ${processed.length} 项。`
      : `已停止 ${payload.toolLabel}。`)
    : ok
    ? `已完成 ${payload.toolLabel}：${processed.length} 项，输出到 ${payload.destinationPath}`
    : partial
      ? `${payload.toolLabel} 部分完成：成功 ${processed.length} 项，失败 ${failed.length} 项`
      : `${payload.toolLabel} 执行失败：${failed[0]?.error || '没有可处理的图片'}`

  emitProcessingProgress({
    phase: 'finish',
    runId: payload.runId,
    toolId: payload.toolId,
    toolLabel: payload.toolLabel,
    mode: payload.mode,
    total: Array.isArray(payload.assets) ? payload.assets.length : 0,
    completed: processed.length + failed.length,
    succeeded: processed.length,
    failed: failed.length,
    elapsedMs,
    startedAt,
    cancelled,
  })

  return {
    ok,
    partial,
    cancelled,
    ...payload,
    elapsedMs,
    processed,
    failed,
    message,
  }
}

const toolsApi = {
  showOpenDialog(options = {}) {
    const hostApi = getHostApi()
    if (typeof hostApi.showOpenDialog !== 'function') return undefined
    return hostApi.showOpenDialog(options)
  },

  async showMainWindow() {
    const hostApi = getHostApi()
    if (typeof hostApi.showMainWindow !== 'function') return false
    return hostApi.showMainWindow()
  },

  async revealPath(targetPath) {
    return revealPath(targetPath)
  },

  async replaceOriginals(items = []) {
    return replaceOriginals(items)
  },

  resolveInputPaths(items = []) {
    return this.normalizeInput(items)
  },

  getEnvironment() {
    const hostApi = getHostApi()
    return {
      appName: hostApi.getAppName?.() || 'ZTools',
      isWindows: hostApi.isWindows?.() || false,
      isMacOS: hostApi.isMacOs?.() || hostApi.isMacOS?.() || false,
      isLinux: hostApi.isLinux?.() || false,
    }
  },

  getFormatCapabilities() {
    return buildFormatCapabilitiesPayload()
  },

  normalizeInput(items = []) {
    const hostApi = getHostApi()
    const seedList = Array.isArray(items) ? items : [items]
    const list = seedList.flatMap((item) => {
      const extracted = extractLaunchItems(item)
      return extracted.length ? extracted : [item]
    })
    const paths = []

    for (const item of list) {
      if (!item) continue
      if (typeof item === 'string') {
        paths.push(item)
        continue
      }
      if (item.path) {
        paths.push(item.path)
        continue
      }
      if (item.filePath) {
        paths.push(item.filePath)
        continue
      }
      if (item.sourcePath) {
        paths.push(item.sourcePath)
        continue
      }
      if (hostApi.getPathForFile) {
        const filePath = hostApi.getPathForFile(item)
        if (filePath) {
          paths.push(filePath)
          continue
        }
      }
      if (typeof File !== 'undefined' && item instanceof File && hostApi.getPathForFile) {
        const filePath = hostApi.getPathForFile(item)
        if (filePath) paths.push(filePath)
      }
    }

    return Array.from(new Set(paths))
  },

  async collectImageFiles(inputPaths = []) {
    const result = []
    const visited = new Set()

    const walk = (targetPath) => {
      if (!targetPath || visited.has(targetPath) || !fs.existsSync(targetPath)) return
      visited.add(targetPath)
      const stat = fs.statSync(targetPath)
      if (stat.isDirectory()) {
        for (const entry of fs.readdirSync(targetPath)) {
          walk(path.join(targetPath, entry))
        }
        return
      }

      const ext = path.extname(targetPath).toLowerCase()
      if (IMAGE_EXTENSIONS.has(ext)) {
        result.push(targetPath)
      }
    }

    for (const targetPath of inputPaths) walk(targetPath)
    return result
  },

  async readImageMeta(filePaths = []) {
    const sharpLib = getSharp()
    return Promise.all(filePaths.map(async (filePath, index) => {
      const stat = fs.statSync(filePath)
      const descriptor = await getAssetDescriptor(sharpLib, {
        sourcePath: filePath,
        ext: path.extname(filePath).replace('.', '').toLowerCase(),
      }, { probeMetadata: true })
      let width = Math.max(0, Number(descriptor?.width) || 0)
      let height = Math.max(0, Number(descriptor?.height) || 0)
      const inputFormat = normalizeImageFormatName(descriptor?.inputFormat || path.extname(filePath).replace('.', '').toLowerCase())
      if (!(width > 0 && height > 0)) {
        const image = createNativeImageFromInput(filePath)
        const size = !image || image.isEmpty() ? { width: 0, height: 0 } : image.getSize()
        width = width || size.width
        height = height || size.height
      }
      const ext = inputFormat || path.extname(filePath).replace('.', '').toLowerCase()
      const assetId = `asset-${Date.now()}-${index}-${Math.random().toString(36).slice(2, 8)}`
      const thumbnailUrl = ext === 'tiff'
        ? await createAssetDisplayUrlAsync(filePath, ext, sharpLib)
        : createAssetDisplayUrl(filePath, ext)
      queueQueueThumbnailGeneration(assetId, filePath, ext, sharpLib)
      return {
        id: assetId,
        sourcePath: filePath,
        name: path.basename(filePath),
        ext,
        inputFormat: ext,
        inputMetadata: descriptor?.inputMetadata || null,
        hasAlpha: Boolean(descriptor?.hasAlpha),
        sizeBytes: stat.size,
        width,
        height,
        thumbnailUrl,
        listThumbnailUrl: '',
        status: 'idle',
        outputPath: '',
        error: '',
        selected: false,
        overrides: {},
      }
    }))
  },

  createAssetDisplayUrl(filePath, inputFormat = '') {
    return createAssetDisplayUrl(filePath, inputFormat)
  },

  pathToFileUrl(filePath) {
    const normalized = String(filePath).replace(/\\/g, '/')
    const prefixed = normalized.startsWith('/') ? normalized : `/${normalized}`
    return encodeURI(`file://${prefixed}`)
  },

  async loadInputs(items = []) {
    const normalized = this.normalizeInput(items)
    const filePaths = await this.collectImageFiles(normalized)
    return this.readImageMeta(filePaths)
  },

  async resolveLaunchInputs(values = []) {
    const inputValues = Array.isArray(values) ? values : [values]
    const collected = []

    for (const value of inputValues) {
      const normalized = this.normalizeInput(extractLaunchItems(value))
      if (!normalized.length) continue
      const filePaths = await this.collectImageFiles(normalized)
      if (filePaths.length) {
        collected.push(...filePaths)
      }
    }

    if (!collected.length) {
      appendLaunchDebugLog('resolve-launch-inputs-empty', {
        valueCount: inputValues.length,
        sample: inputValues.slice(0, 3).map((value) => summarizeLaunchValue(value)),
      })
      return []
    }
    const dedupedPaths = Array.from(new Set(collected))
    appendLaunchDebugLog('resolve-launch-inputs-paths', {
      valueCount: inputValues.length,
      paths: dedupedPaths.slice(0, 12),
      totalPaths: dedupedPaths.length,
    })
    return this.readImageMeta(dedupedPaths)
  },

  async getLaunchInputs(options = {}) {
    installLaunchHooks()
    const seededPendingValues = Array.isArray(options?.pendingValues) ? options.pendingValues : null
    const requirePending = Boolean(options?.requirePending)
    const includeCopiedFiles = Boolean(options?.includeCopiedFiles)
    const minClipboardTimestamp = Number(options?.minClipboardTimestamp) || 0
    appendLaunchDebugLog('get-launch-inputs', {
      requirePending,
      includeCopiedFiles,
      minClipboardTimestamp,
      pendingCount: seededPendingValues ? seededPendingValues.length : pendingLaunchValues.length,
      source: seededPendingValues ? 'seeded' : 'queue',
    })
    if (!seededPendingValues) {
      await waitForLaunchValue()
    }

    const pendingValues = seededPendingValues || pendingLaunchValues.splice(0, pendingLaunchValues.length)
    const hadPendingValues = pendingValues.length > 0
    const pendingAssets = await this.resolveLaunchInputs(pendingValues)
    appendLaunchDebugLog('get-launch-inputs-after-pending', {
      pendingCount: pendingValues.length,
      pendingAssetsCount: pendingAssets.length,
      requirePending,
      source: seededPendingValues ? 'seeded' : 'queue',
    })
    if (pendingAssets.length) return pendingAssets

    if (requirePending && !hadPendingValues) {
      if (includeCopiedFiles) {
        const copiedSnapshot = readCopiedFilesSnapshot()
        let clipboardSnapshot = await readClipboardLaunchSnapshot()
        const initialClipboardToken = sanitizeText(clipboardSnapshot.token)
        const initialClipboardEntryAcceptable = isClipboardEntryAcceptableForBootstrap(clipboardSnapshot.entryTimestamp, pluginStartupAt)
        if (!initialClipboardEntryAcceptable) {
          clipboardSnapshot = await waitForRecentClipboardLaunchSnapshot(initialClipboardToken, pluginStartupAt)
        }
        const consumedSignatures = loadConsumedHostLaunchSignaturesFromStorage()
        const clipboardToken = sanitizeText(clipboardSnapshot.token)
        const clipboardTokenConsumed = clipboardToken ? consumedSignatures.includes(clipboardToken) : false
        const clipboardEntryAgeMs = getClipboardEntryAgeMs(clipboardSnapshot.entryTimestamp, pluginStartupAt)
        const clipboardEntryAcceptable = isClipboardEntryAcceptableForBootstrap(clipboardSnapshot.entryTimestamp, pluginStartupAt)
        const clipboardEntryAfterMinTimestamp = !minClipboardTimestamp || (
          Number.isFinite(clipboardSnapshot.entryTimestamp) && clipboardSnapshot.entryTimestamp >= minClipboardTimestamp
        )
        appendLaunchDebugLog('get-launch-inputs-copied-files-check', {
          requirePending,
          includeCopiedFiles,
          minClipboardTimestamp,
          pluginStartupAt,
          lastHandledCopiedFilesSignature,
          currentCopiedFilesSignature: copiedSnapshot.signature,
          copiedFileCount: copiedSnapshot.paths.length,
          copiedPaths: copiedSnapshot.paths.slice(0, 12),
          initialClipboardToken,
          initialClipboardEntryAcceptable,
          clipboardToken,
          clipboardTokenConsumed,
          clipboardEntryTimestamp: clipboardSnapshot.entryTimestamp,
          clipboardEntryAgeMs,
          clipboardEntryAcceptable,
          clipboardEntryAfterMinTimestamp,
          clipboardEntry: summarizeLaunchValue(clipboardSnapshot.entry),
          clipboardHistorySummary: clipboardSnapshot.historySummary,
          clipboardStatusSummary: clipboardSnapshot.statusSummary,
        })
        if (copiedSnapshot.paths.length && clipboardToken && !clipboardTokenConsumed && clipboardEntryAcceptable && clipboardEntryAfterMinTimestamp) {
          const copiedAssets = await this.resolveLaunchInputs([copiedSnapshot.value])
          if (copiedAssets.length) {
            rememberConsumedHostLaunchSignature(clipboardToken)
            lastHandledCopiedFilesSignature = copiedSnapshot.signature
            appendLaunchDebugLog('get-launch-inputs-consumed-clipboard-token', {
              clipboardToken,
              copiedAssetCount: copiedAssets.length,
              copiedFilesSignature: copiedSnapshot.signature,
            })
            return copiedAssets
          }
        }
      }
      appendLaunchDebugLog('get-launch-inputs-skipped-current-read', {
        requirePending,
        includeCopiedFiles,
      })
      return []
    }

    return this.readCurrentLaunchInputs(options)
  },

  subscribeLaunchInputs(callback) {
    installLaunchHooks()
    if (typeof callback !== 'function') return false
    launchSubscribers.add(callback)
    return true
  },

  async readCurrentLaunchInputs(options = {}) {
    const hostApi = getHostApi()
    const includeCopiedFiles = Boolean(options?.includeCopiedFiles)
    const candidateReaders = [
      ['getLaunchData', () => hostApi.getLaunchData?.()],
      ['getLaunchInputs', () => hostApi.getLaunchInputs?.()],
      ['getCommandData', () => hostApi.getCommandData?.()],
      ['getCmdData', () => hostApi.getCmdData?.()],
      ['getFeature', () => hostApi.getFeature?.()],
      ['getCurrentFeature', () => hostApi.getCurrentFeature?.()],
      ['getSelectFiles', () => hostApi.getSelectFiles?.()],
      ['getSelectedFiles', () => hostApi.getSelectedFiles?.()],
      ['getSelectedFilePaths', () => hostApi.getSelectedFilePaths?.()],
      ['getFiles', () => hostApi.getFiles?.()],
      ['getPaths', () => hostApi.getPaths?.()],
      ['getPath', () => hostApi.getPath?.()],
      ['getArguments', () => hostApi.getArguments?.()],
    ]
    if (includeCopiedFiles) {
      candidateReaders.splice(9, 0, ['getCopyedFiles', () => hostApi.getCopyedFiles?.()])
    }
    const candidateValues = await Promise.all(candidateReaders.map(async ([name, reader]) => {
      const value = await Promise.resolve(safeInvoke(reader))
      return { name, value }
    }))
    const candidates = [
      ...candidateValues.map((entry) => entry.value),
      hostApi.arguments,
      hostApi.argv,
      hostApi.payload,
      hostApi.cmd,
      globalThis.launchData,
      globalThis.pluginData,
      globalThis.input,
      globalThis.inputs,
    ]

    const resolvedCandidates = await Promise.all(candidates.map((candidate) => Promise.resolve(candidate)))
    appendLaunchDebugLog('read-current-launch-inputs', {
      candidateCount: resolvedCandidates.length,
      namedCandidates: candidateValues.map(({ name, value }) => ({
        name,
        summary: summarizeLaunchValue(value),
      })),
      sample: resolvedCandidates
        .filter((candidate) => candidate != null)
        .slice(0, 6)
        .map((candidate) => summarizeLaunchValue(candidate)),
    })
    return this.resolveLaunchInputs(resolvedCandidates)
  },

  async savePreset(toolId, preset) {
    const hostApi = getHostApi()
    const key = `imgbatch:preset:${toolId}`
    const current = hostApi.dbStorage?.getItem?.(key) || []
    const normalizedPreset = {
      id: sanitizeText(preset?.id, `preset-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`),
      name: sanitizeText(preset?.name, '未命名预设'),
      config: preset?.config && typeof preset.config === 'object' ? preset.config : {},
      createdAt: sanitizeText(preset?.createdAt, new Date().toISOString()),
    }
    const next = [...current, normalizedPreset]
    hostApi.dbStorage?.setItem?.(key, next)
    return next
  },

  async loadPresets(toolId) {
    const hostApi = getHostApi()
    const key = `imgbatch:preset:${toolId}`
    const current = hostApi.dbStorage?.getItem?.(key) || []
    const normalized = current.map((preset, index) => {
      const fallbackConfig = preset?.config && typeof preset.config === 'object'
        ? preset.config
        : Object.fromEntries(
            Object.entries(preset || {}).filter(([entryKey]) => !['id', 'name', 'createdAt'].includes(entryKey)),
          )
      return {
        id: sanitizeText(preset?.id, `preset-${Date.now()}-${index + 1}`),
        name: sanitizeText(preset?.name, `预设${index + 1}`),
        config: fallbackConfig && typeof fallbackConfig === 'object' ? fallbackConfig : {},
        createdAt: sanitizeText(preset?.createdAt, new Date().toISOString()),
      }
    })
    const changed = JSON.stringify(current) !== JSON.stringify(normalized)
    if (changed) hostApi.dbStorage?.setItem?.(key, normalized)
    return normalized
  },

  async renamePreset(toolId, presetId, name) {
    const hostApi = getHostApi()
    const key = `imgbatch:preset:${toolId}`
    const current = hostApi.dbStorage?.getItem?.(key) || []
    const next = current.map((preset) => (
      String(preset?.id) === String(presetId)
        ? { ...preset, name: sanitizeText(name, preset?.name || '未命名预设') }
        : preset
    ))
    hostApi.dbStorage?.setItem?.(key, next)
    return next
  },

  async deletePreset(toolId, presetId) {
    const hostApi = getHostApi()
    const key = `imgbatch:preset:${toolId}`
    const current = hostApi.dbStorage?.getItem?.(key) || []
    const next = current.filter((preset) => String(preset?.id) !== String(presetId))
    hostApi.dbStorage?.setItem?.(key, next)
    return next
  },

  prepareRunPayload(toolId, config, assets, destinationPath, options) {
    return {
      ...prepareRunPayload(toolId, config, assets, destinationPath, options),
      mode: isMergeTool(toolId) ? 'direct' : PREVIEW_SAVE_TOOLS.has(toolId) ? 'preview-save' : 'direct',
    }
  },

  async stageToolPreview(toolId, config, assets, destinationPath, mode, options) {
    return stageToolPreview(toolId, config, assets, destinationPath, mode, options)
  },

  async saveStagedResult(toolId, stagedItem, destinationPath) {
    return saveAllStagedResults(toolId, [stagedItem], destinationPath)
  },

  async saveAllStagedResults(toolId, stagedItems, destinationPath) {
    return saveAllStagedResults(toolId, stagedItems, destinationPath)
  },

  async materializePreviewResults(toolId, stagedItems, destinationPath, preferredRunFolderName = '') {
    return materializePreviewResults(toolId, stagedItems, destinationPath, preferredRunFolderName)
  },

  cleanupPreviewCache(runFolderNames = [], options = {}) {
    return cleanupPreviewCache(runFolderNames, options)
  },

  clearPreviewCacheDirectory(options = {}) {
    return clearPreviewCacheDirectory(options)
  },

  appendLaunchDebugLog(event, payload) {
    appendLaunchDebugLog(event, payload && typeof payload === 'object' ? payload : { value: payload })
    return true
  },

  checkStagedFiles(stagedItems = []) {
    return checkStagedFiles(stagedItems)
  },

  loadSettings() {
    return buildSettingsPayload(getAppSettings())
  },

  loadConsumedHostLaunchSignatures() {
    const hostApi = getHostApi()
    const current = hostApi.dbStorage?.getItem?.(CONSUMED_HOST_LAUNCH_SIGNATURES_STORAGE_KEY)
    return Array.isArray(current)
      ? current.map((value) => sanitizeText(value)).filter(Boolean)
      : []
  },

  saveConsumedHostLaunchSignatures(signatures = []) {
    const hostApi = getHostApi()
    const normalized = Array.isArray(signatures)
      ? signatures.map((value) => sanitizeText(value)).filter(Boolean)
      : []
    hostApi.dbStorage?.setItem?.(CONSUMED_HOST_LAUNCH_SIGNATURES_STORAGE_KEY, normalized)
    return normalized
  },

  saveSettings(settings) {
    return saveAppSettings(settings)
  },

  regenerateQueueThumbnails(assets = []) {
    return regenerateQueueThumbnails(assets)
  },

  buildStagedItems(assets = []) {
    return buildStagedItemsFromAssets(assets)
  },

  async runTool(toolId, config, assets, destinationPath, options) {
    const payload = {
      ...prepareRunPayload(toolId, config, assets, destinationPath, options),
      mode: isMergeTool(toolId) ? 'direct' : PREVIEW_SAVE_TOOLS.has(toolId) ? 'preview-save' : 'direct',
    }
    const hostApi = getHostApi()

    if (SINGLE_IMAGE_TOOL_IDS.has(payload.toolId) || MERGE_TOOL_IDS.has(payload.toolId)) {
      return executeLocalTool(payload)
    }

    if (typeof hostApi.runTool === 'function') {
      return hostApi.runTool(payload.toolId, payload.config, payload.assets, payload.destinationPath, payload)
    }

    return {
      ok: false,
      ...payload,
      message: `宿主处理管线待接入：${payload.toolLabel} · ${payload.queuedCount} 张 · ${payload.summary}`,
    }
  },

  cancelRun(runId) {
    return cancelRun(runId)
  },
}

installLaunchHooks()
installPreviewLifecycleCleanup()

if (typeof window !== 'undefined') {
  window.imgbatch = toolsApi
}
