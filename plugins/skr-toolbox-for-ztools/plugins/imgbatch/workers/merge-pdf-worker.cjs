const fs = require('fs')
const os = require('os')

const { writeMergePdfAssetCore } = require('../lib/merge-pdf-core.cjs')

const CPU_COUNT = Math.max(1, os.cpus()?.length || 1)
const ALPHA_CAPABLE_FORMATS = new Set(['png', 'webp', 'tiff', 'avif', 'gif', 'ico'])
const PERFORMANCE_MODES = new Set(['compatible', 'balanced', 'max'])
const BMP_DECODE_CACHE = new Map()
const FALLBACK_IMAGE_BUFFER_CACHE = new Map()
const INPUT_FORMAT_CACHE = new Map()

function getPerformanceProfile(mode) {
  const normalized = PERFORMANCE_MODES.has(mode) ? mode : 'balanced'
  if (normalized === 'compatible') {
    return {
      heavyConcurrency: Math.max(1, Math.min(3, Math.floor(CPU_COUNT / 6) || 1)),
      sharpConcurrency: Math.max(1, Math.min(CPU_COUNT, Math.floor(CPU_COUNT * 0.5) || 1)),
      cacheMemory: Math.min(256, Math.max(96, CPU_COUNT * 8)),
      cacheItems: Math.max(32, CPU_COUNT * 4),
    }
  }
  if (normalized === 'max') {
    return {
      heavyConcurrency: Math.max(1, Math.min(8, Math.floor(CPU_COUNT / 3) || 1)),
      sharpConcurrency: Math.max(1, Math.min(CPU_COUNT, Math.floor(CPU_COUNT * 0.9) || 1)),
      cacheMemory: Math.min(768, Math.max(160, CPU_COUNT * 24)),
      cacheItems: Math.max(96, CPU_COUNT * 12),
    }
  }
  return {
    heavyConcurrency: Math.max(1, Math.min(6, Math.floor(CPU_COUNT / 4) || 1)),
    sharpConcurrency: Math.max(1, Math.min(CPU_COUNT, Math.floor(CPU_COUNT * 0.75) || 1)),
    cacheMemory: Math.min(512, Math.max(128, CPU_COUNT * 16)),
    cacheItems: Math.max(64, CPU_COUNT * 8),
  }
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

function isAlphaCapableFormat(format) {
  return ALPHA_CAPABLE_FORMATS.has(normalizeImageFormatName(format))
}

function hexToRgbaObject(value, alpha = 1) {
  const color = String(value || '#ffffff').trim().replace('#', '')
  const normalized = color.length === 3 ? color.split('').map((item) => item + item).join('') : color.padEnd(6, 'f').slice(0, 6)
  return {
    r: Number.parseInt(normalized.slice(0, 2), 16),
    g: Number.parseInt(normalized.slice(2, 4), 16),
    b: Number.parseInt(normalized.slice(4, 6), 16),
    alpha,
  }
}

function getCachedPathValue(cache, input, factory) {
  if (typeof input !== 'string' || !input) return factory()
  if (cache.has(input)) return cache.get(input)
  const value = factory()
  if (value) cache.set(input, value)
  return value
}

function createNativeImageFromInput(input) {
  try {
    const { nativeImage } = require('electron')
    if (!nativeImage) return null
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
  } catch {}
  return null
}

function createNativeImagePngBuffer(input) {
  return getCachedPathValue(FALLBACK_IMAGE_BUFFER_CACHE, input, () => {
    const image = createNativeImageFromInput(input)
    return image ? image.toPNG() : null
  })
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
  const normalizedPath = String(filePath || '').trim()
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

async function getAssetInputFormat(sharpLib, asset) {
  const sourcePath = String(asset?.sourcePath || '').trim()
  const fallbackFormat = normalizeImageFormatName(asset?.ext)
  if (!sourcePath) {
    if (fallbackFormat) asset.inputFormat = fallbackFormat
    return fallbackFormat
  }
  const cachedFormat = normalizeImageFormatName(asset?.inputFormat)
  if (cachedFormat) return cachedFormat
  const cachedMetadata = asset?.inputMetadata
  const cachedMetadataFormat = normalizeImageFormatName(cachedMetadata?.format)
  if (cachedMetadataFormat) {
    asset.inputFormat = cachedMetadataFormat
    return cachedMetadataFormat
  }
  const headerFormat = detectImageFormatFromFile(sourcePath)
  if (headerFormat && isFallbackDecodedInputFormat(headerFormat)) {
    asset.inputFormat = headerFormat
    return headerFormat
  }
  let metadata = null
  try {
    metadata = await sharpLib(sourcePath).metadata()
    asset.inputMetadata = metadata
    const detectedFormat = resolveCanonicalInputFormat(metadata?.format, headerFormat, fallbackFormat)
    if (detectedFormat) {
      asset.inputFormat = detectedFormat
      return detectedFormat
    }
  } catch {}
  if (headerFormat) {
    asset.inputFormat = headerFormat
    return headerFormat
  }
  if (fallbackFormat) asset.inputFormat = fallbackFormat
  return fallbackFormat
}

async function getAssetMetadata(sharpLib, asset) {
  if (asset?.inputMetadata) return asset.inputMetadata
  const normalizedFormat = normalizeImageFormatName(asset?.inputFormat || asset?.ext)
  if (normalizedFormat === 'bmp') {
    try {
      const decoded = getCachedPathValue(BMP_DECODE_CACHE, asset.sourcePath, () => {
        const sourceBuffer = fs.readFileSync(asset.sourcePath)
        return decodeBmpBuffer(sourceBuffer)
      })
      if (decoded) {
        const metadata = {
          format: 'bmp',
          width: decoded.width,
          height: decoded.height,
          channels: decoded.channels,
          hasAlpha: decoded.channels === 4,
        }
        asset.inputMetadata = metadata
        asset.inputFormat = 'bmp'
        return metadata
      }
    } catch {}
  }
  if (isFallbackDecodedInputFormat(normalizedFormat)) {
    try {
      const decodedInput = createNativeImagePngBuffer(asset.sourcePath)
      if (decodedInput) {
        const metadata = await sharpLib(decodedInput).metadata()
        asset.inputMetadata = metadata
        return metadata
      }
    } catch {}
  }
  try {
    const metadata = await sharpLib(asset.sourcePath).metadata()
    asset.inputMetadata = metadata
    const detectedFormat = normalizeImageFormatName(metadata?.format)
    if (detectedFormat && !asset.inputFormat) asset.inputFormat = detectedFormat
    return metadata
  } catch {
    return null
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
  const sharpInput = isFallbackDecodedInputFormat(normalizedExt)
    ? createNativeImagePngBuffer(input) || input
    : input
  return sharpLib(sharpInput, { animated: normalizedExt === 'gif' })
}

function getCachedDecodedFallbackInput(asset) {
  const normalizedExt = normalizeImageFormatName(asset?.inputFormat || asset?.ext)
  if (!isFallbackDecodedInputFormat(normalizedExt)) return null
  if (asset?.decodedFallbackInput) return asset.decodedFallbackInput
  const decoded = createNativeImagePngBuffer(asset?.sourcePath)
  if (decoded) asset.decodedFallbackInput = decoded
  return decoded
}

function createTransformer(sharpLib, asset) {
  const fallbackInput = getCachedDecodedFallbackInput(asset)
  return createTransformerFromInput(
    sharpLib,
    fallbackInput || asset.sourcePath,
    fallbackInput ? 'png' : (asset.inputFormat || asset.ext),
  )
}

function yieldToEventLoop() {
  return new Promise((resolve) => {
    setTimeout(resolve, 0)
  })
}

function throwIfRunCancelled() {}

process.on('message', async (message) => {
  if (!message || message.type !== 'start') return
  try {
    const sharpLib = require('sharp')
    const pdfLib = require('pdf-lib')
    const performanceMode = message.performanceMode || 'balanced'
    const profile = getPerformanceProfile(performanceMode)
    sharpLib.concurrency(profile.sharpConcurrency)
    sharpLib.cache({ memory: profile.cacheMemory, items: profile.cacheItems, files: 0 })
    const result = await writeMergePdfAssetCore({
      sharpLib,
      pdfLib,
      payload: message.payload,
      profile,
      normalizeImageFormatName,
      isAlphaCapableFormat,
      getAssetInputFormat,
      getAssetMetadata,
      createTransformer,
      hexToRgbaObject,
      throwIfRunCancelled,
      yieldToEventLoop,
      emitProgress(detail) {
        if (typeof process.send === 'function') {
          process.send({ type: 'progress', detail })
        }
      },
    })
    if (typeof process.send === 'function') {
      process.send({ type: 'result', result })
    }
    process.exit(0)
  } catch (error) {
    if (typeof process.send === 'function') {
      process.send({
        type: 'error',
        error: error?.message || 'PDF merge failed',
        code: error?.code || '',
      })
    }
    process.exit(1)
  }
})

process.on('uncaughtException', (error) => {
  if (typeof process.send === 'function') {
    process.send({
      type: 'error',
      error: error?.message || 'PDF merge child uncaught exception',
      code: error?.code || '',
    })
  }
  process.exit(1)
})

process.on('unhandledRejection', (error) => {
  if (typeof process.send === 'function') {
    process.send({
      type: 'error',
      error: error?.message || 'PDF merge child unhandled rejection',
      code: error?.code || '',
    })
  }
  process.exit(1)
})
