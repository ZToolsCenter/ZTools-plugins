const fs = require('node:fs')
const path = require('node:path')
const sharp = require('../lib/sharp-loader')
const { resolveMergeOutputPath } = require('../lib/paths')
const { ensureDir, createTempPath, safeUnlink } = require('../lib/output')

async function loadImageMeta(inputPath) {
  const meta = await sharp(inputPath, { failOn: 'none' }).metadata()
  const buf = await sharp(inputPath, { failOn: 'none' })
    .resize(meta.width, meta.height, { fit: 'inside' })
    .png()
    .toBuffer()
  return { meta, buf }
}

async function mergeLongImage(inputPaths, options) {
  const direction = options.mergeDirection || 'vertical'
  const images = []
  for (const p of inputPaths) {
    images.push(await loadImageMeta(p))
  }

  if (images.length === 0) throw new Error('没有可合并的图片')

  let canvasWidth = 0
  let canvasHeight = 0
  const composites = []
  let offsetX = 0
  let offsetY = 0

  if (direction === 'vertical') {
    canvasWidth = Math.max(...images.map((i) => i.meta.width || 0))
    canvasHeight = images.reduce((sum, i) => sum + (i.meta.height || 0), 0)
    for (const img of images) {
      composites.push({ input: img.buf, top: offsetY, left: Math.round((canvasWidth - (img.meta.width || 0)) / 2) })
      offsetY += img.meta.height || 0
    }
  } else {
    canvasWidth = images.reduce((sum, i) => sum + (i.meta.width || 0), 0)
    canvasHeight = Math.max(...images.map((i) => i.meta.height || 0))
    for (const img of images) {
      composites.push({ input: img.buf, left: offsetX, top: Math.round((canvasHeight - (img.meta.height || 0)) / 2) })
      offsetX += img.meta.width || 0
    }
  }

  const quality = Number(options.quality) || 80
  const format = options.format === 'png' ? 'png' : 'jpeg'
  const pipeline = sharp({
    create: {
      width: canvasWidth,
      height: canvasHeight,
      channels: 4,
      background: { r: 255, g: 255, b: 255, alpha: 1 }
    }
  }).composite(composites)

  if (format === 'png') {
    return pipeline.png({ compressionLevel: 9 }).toBuffer()
  }
  return pipeline.jpeg({ quality, mozjpeg: true }).toBuffer()
}

async function mergeAnimatedGif(inputPaths, options) {
  const delay = Number(options.gifDelay) || 500
  const firstMeta = await sharp(inputPaths[0], { failOn: 'none' }).metadata()
  const width = firstMeta.width || 640
  const height = firstMeta.height || 480
  const { GIFEncoder, quantize, applyPalette } = require('gifenc')
  const encoder = GIFEncoder()

  for (const inputPath of inputPaths) {
    const { data, info } = await sharp(inputPath, { failOn: 'none' })
      .resize(width, height, {
        fit: 'contain',
        background: { r: 255, g: 255, b: 255, alpha: 1 }
      })
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true })

    const palette = quantize(data, 256)
    const index = applyPalette(data, palette)
    encoder.writeFrame(index, info.width, info.height, {
      palette,
      delay: Math.max(20, Math.round(delay / 10))
    })
  }

  encoder.finish()
  return Buffer.from(encoder.bytes())
}

async function mergePdf(inputPaths, options) {
  let PDFDocument
  try {
    PDFDocument = require('pdfkit')
  } catch {
    throw new Error('PDF 合并需要 pdfkit 依赖，请在 preload 目录安装')
  }

  return new Promise((resolve, reject) => {
    const chunks = []
    const doc = new PDFDocument({ autoFirstPage: false })
    doc.on('data', (chunk) => chunks.push(chunk))
    doc.on('end', () => resolve(Buffer.concat(chunks)))
    doc.on('error', reject)

    ;(async () => {
      try {
        for (const inputPath of inputPaths) {
          const meta = await sharp(inputPath, { failOn: 'none' }).metadata()
          const imgBuf = await sharp(inputPath, { failOn: 'none' }).jpeg({ quality: 90 }).toBuffer()
          const pageWidth = meta.width || 595
          const pageHeight = meta.height || 842
          doc.addPage({ size: [pageWidth, pageHeight], margin: 0 })
          doc.image(imgBuf, 0, 0, { width: pageWidth, height: pageHeight })
        }
        doc.end()
      } catch (err) {
        reject(err)
      }
    })()
  })
}

async function processMerge(inputPaths, options) {
  if (!inputPaths || inputPaths.length < 2) {
    return {
      success: false,
      error: '合并至少需要 2 张图片'
    }
  }

  const outputPath = resolveMergeOutputPath(inputPaths[0], options)
  ensureDir(path.dirname(outputPath))
  const tempPath = createTempPath('batch-merge')

  try {
    const mergeMode = options.mergeMode || 'long-vertical'
    let buffer

    if (mergeMode === 'pdf') {
      buffer = await mergePdf(inputPaths, options)
    } else if (mergeMode === 'gif-animated') {
      buffer = await mergeAnimatedGif(inputPaths, options)
    } else {
      buffer = await mergeLongImage(inputPaths, {
        ...options,
        mergeDirection: mergeMode === 'long-horizontal' ? 'horizontal' : 'vertical'
      })
    }

    fs.writeFileSync(tempPath, buffer)

    if (fs.existsSync(outputPath)) {
      safeUnlink(tempPath)
      return { success: false, error: '输出文件已存在: ' + outputPath }
    }

    fs.renameSync(tempPath, outputPath)
    const inputSize = inputPaths.reduce((sum, p) => sum + fs.statSync(p).size, 0)
    const outputSize = fs.statSync(outputPath).size

    return {
      success: true,
      outputPath,
      inputPaths,
      inputSize,
      outputSize
    }
  } catch (err) {
    safeUnlink(tempPath)
    return {
      success: false,
      error: err && err.message ? err.message : String(err)
    }
  }
}

module.exports = { processMerge }
