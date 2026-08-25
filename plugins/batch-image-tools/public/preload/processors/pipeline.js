const sharp = require('../lib/sharp-loader')
const { normalizeFormat } = require('../lib/paths')

function applyFormat(writer, targetFormat, quality) {
  const q = Number(quality) || 80
  switch (targetFormat) {
    case 'jpeg':
      return writer.jpeg({ quality: q, mozjpeg: true })
    case 'png':
      return writer.png({ compressionLevel: 9, quality: q })
    case 'webp':
      return writer.webp({ quality: q })
    case 'avif':
      return writer.avif({ quality: q })
    case 'tiff':
      return writer.tiff({ quality: q })
    case 'gif':
      return writer.gif()
    case 'bmp':
      return writer.toFormat('bmp')
    default:
      return writer
  }
}

async function applyResize(writer, meta, options) {
  const resizeMode = options.resizeMode || 'pixel'
  let width = options.width ? Number(options.width) : null
  let height = options.height ? Number(options.height) : null

  if (resizeMode === 'percent') {
    const percent = Number(options.scalePercent) || 100
    width = Math.round((meta.width || 0) * (percent / 100)) || null
    height = Math.round((meta.height || 0) * (percent / 100)) || null
  }

  if (!width && !height) return writer

  const fit = options.fit || 'inside'
  const withoutEnlargement = options.withoutEnlargement !== false

  if (options.keepAspectRatio !== false && width && height) {
    return writer.resize(width, height, { fit, withoutEnlargement })
  }

  return writer.resize(width || null, height || null, {
    fit: 'fill',
    withoutEnlargement
  })
}

async function applyRotateFlip(writer, options) {
  const angle = Number(options.rotateAngle) || 0
  if (angle) {
    writer = writer.rotate(angle, {
      background: options.rotateBackground || { r: 255, g: 255, b: 255, alpha: 0 }
    })
  }
  if (options.flipHorizontal) writer = writer.flop()
  if (options.flipVertical) writer = writer.flip()
  return writer
}

async function applyCrop(writer, meta, options) {
  if (!meta.width || !meta.height) return writer

  const mode = options.cropMode || 'ratio'

  if (mode === 'manual') {
    const left = Math.max(0, Math.round((Number(options.cropLeft) || 0) * meta.width))
    const top = Math.max(0, Math.round((Number(options.cropTop) || 0) * meta.height))
    let width = Math.round((Number(options.cropWidth) || 1) * meta.width)
    let height = Math.round((Number(options.cropHeight) || 1) * meta.height)

    width = Math.max(1, Math.min(width, meta.width - left))
    height = Math.max(1, Math.min(height, meta.height - top))

    return writer.extract({ left, top, width, height })
  }

  const ratioW = Number(options.cropRatioW) || 0
  const ratioH = Number(options.cropRatioH) || 0
  if (!ratioW || !ratioH) return writer

  const targetRatio = ratioW / ratioH
  const currentRatio = meta.width / meta.height
  let cropW = meta.width
  let cropH = meta.height
  let left = 0
  let top = 0

  if (currentRatio > targetRatio) {
    cropW = Math.round(meta.height * targetRatio)
    left = Math.round((meta.width - cropW) / 2)
  } else if (currentRatio < targetRatio) {
    cropH = Math.round(meta.width / targetRatio)
    top = Math.round((meta.height - cropH) / 2)
  }

  return writer.extract({ left, top, width: cropW, height: cropH })
}

function parseColor(color, fallback = '#ffffff') {
  const value = (color || fallback).replace('#', '')
  if (value.length === 3) {
    return {
      r: parseInt(value[0] + value[0], 16),
      g: parseInt(value[1] + value[1], 16),
      b: parseInt(value[2] + value[2], 16),
      alpha: 1
    }
  }
  if (value.length === 6) {
    return {
      r: parseInt(value.slice(0, 2), 16),
      g: parseInt(value.slice(2, 4), 16),
      b: parseInt(value.slice(4, 6), 16),
      alpha: 1
    }
  }
  if (value.length === 8) {
    return {
      r: parseInt(value.slice(0, 2), 16),
      g: parseInt(value.slice(2, 4), 16),
      b: parseInt(value.slice(4, 6), 16),
      alpha: parseInt(value.slice(6, 8), 16) / 255
    }
  }
  return { r: 255, g: 255, b: 255, alpha: 1 }
}

async function applyStyle(writer, meta, options) {
  let pipeline = writer
  const width = meta.width || 0
  const height = meta.height || 0
  if (!width || !height) return pipeline

  const radiusPercent = Number(options.borderRadius) || 0
  if (radiusPercent > 0) {
    const radius = Math.round((Math.min(width, height) / 2) * (radiusPercent / 100))
    const mask = Buffer.from(
      `<svg width="${width}" height="${height}"><rect x="0" y="0" width="${width}" height="${height}" rx="${radius}" ry="${radius}" fill="white"/></svg>`
    )
    pipeline = pipeline.composite([{ input: mask, blend: 'dest-in' }])
  }

  const padding = Number(options.padding) || 0
  const borderWidth = Number(options.borderWidth) || 0
  const padColor = parseColor(options.paddingColor, '#ffffff')
  padColor.alpha = Number(options.paddingOpacity ?? 100) / 100

  if (padding > 0) {
    pipeline = pipeline.extend({
      top: padding,
      bottom: padding,
      left: padding,
      right: padding,
      background: padColor
    })
  }

  if (borderWidth > 0) {
    const borderColor = parseColor(options.borderColor, '#000000')
    pipeline = pipeline.extend({
      top: borderWidth,
      bottom: borderWidth,
      left: borderWidth,
      right: borderWidth,
      background: borderColor
    })
  }

  return pipeline
}

async function applyWatermark(writer, meta, options) {
  const type = options.watermarkType || 'none'
  if (type === 'none') return writer

  const opacity = Math.min(1, Math.max(0, Number(options.watermarkOpacity ?? 50) / 100))
  const composites = []

  if (type === 'text' && options.watermarkText) {
    const fontSize = Number(options.watermarkFontSize) || 32
    const color = options.watermarkColor || '#ffffff'
    const text = options.watermarkText
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
    const svg = Buffer.from(
      `<svg width="${meta.width}" height="${meta.height}">
        <text x="50%" y="50%" font-size="${fontSize}" fill="${color}" opacity="${opacity}"
          text-anchor="middle" dominant-baseline="middle">${text}</text>
      </svg>`
    )
    composites.push({ input: svg, gravity: options.watermarkPosition || 'center' })
  }

  if (type === 'image' && options.watermarkImagePath) {
    const scale = Number(options.watermarkScale) || 20
    const wmWidth = Math.round(((meta.width || 100) * scale) / 100)
    const wm = await sharp(options.watermarkImagePath)
      .resize(wmWidth)
      .ensureAlpha()
      .modulate({ brightness: 1 })
      .toBuffer()
    composites.push({
      input: wm,
      gravity: options.watermarkPosition || 'southeast',
      blend: 'over'
    })
  }

  if (composites.length === 0) return writer
  return writer.composite(composites)
}

async function compressToTargetSize(inputPath, options, targetFormat) {
  const targetBytes = Number(options.targetSizeKb) * 1024
  let low = 10
  let high = 100
  let best = null

  while (low <= high) {
    const quality = Math.floor((low + high) / 2)
    const { writer } = await buildPipeline(inputPath, { ...options, quality })
    const buf = await applyFormat(writer, targetFormat, quality).toBuffer()

    if (buf.length <= targetBytes) {
      best = { buf, quality }
      low = quality + 1
    } else {
      high = quality - 1
    }
  }

  return best
}

async function buildPipeline(inputPath, options) {
  const meta = await sharp(inputPath, { failOn: 'none' }).metadata()
  let writer = sharp(inputPath, { failOn: 'none' })

  const tool = options.tool || 'compress'

  if (tool === 'resize' || options.applyResize) {
    writer = await applyResize(writer, meta, options)
  }
  if (tool === 'rotate' || options.applyRotate) {
    writer = await applyRotateFlip(writer, options)
  }
  if (tool === 'crop' || options.applyCrop) {
    writer = await applyCrop(writer, meta, options)
  }
  if (tool === 'style' || options.applyStyle) {
    writer = await applyStyle(writer, meta, options)
  }
  if (tool === 'watermark' || options.applyWatermark) {
    writer = await applyWatermark(writer, meta, options)
  }

  return { writer, meta }
}

async function renderToBuffer(inputPath, options) {
  const { writer, meta } = await buildPipeline(inputPath, options)
  const outFormat = normalizeFormat(options.format) || meta.format || 'jpeg'

  if (options.targetSizeKb && Number(options.targetSizeKb) > 0) {
    const result = await compressToTargetSize(inputPath, options, outFormat)
    if (result) return result.buf
  }

  const quality = Number(options.quality) || 80
  return applyFormat(writer, outFormat, quality).toBuffer()
}

module.exports = {
  applyFormat,
  applyResize,
  applyRotateFlip,
  applyCrop,
  applyStyle,
  applyWatermark,
  buildPipeline,
  renderToBuffer,
  normalizeFormat
}
