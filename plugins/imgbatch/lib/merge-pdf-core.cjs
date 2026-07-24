const fs = require('fs')
const path = require('path')

const PDF_PAGE_SIZES = {
  A3: [841.89, 1190.55],
  A4: [595.28, 841.89],
  A5: [419.53, 595.28],
  Letter: [612, 792],
  Legal: [612, 1008],
}

function detectDirectEmbedKind(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 4) return ''
  if (buffer.length >= 8
    && buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4e && buffer[3] === 0x47
    && buffer[4] === 0x0d && buffer[5] === 0x0a && buffer[6] === 0x1a && buffer[7] === 0x0a) {
    return 'png'
  }
  if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
    return 'jpg'
  }
  return ''
}

async function writeMergePdfAssetCore({
  sharpLib,
  pdfLib,
  payload,
  profile,
  normalizeImageFormatName,
  isAlphaCapableFormat,
  getAssetInputFormat,
  getAssetMetadata,
  createTransformer,
  hexToRgbaObject,
  throwIfRunCancelled = () => {},
  yieldToEventLoop = async () => {},
  emitProgress = () => {},
}) {
  throwIfRunCancelled(payload.runId)
  if (!pdfLib) throw new Error('Missing pdf-lib dependency')
  const outputPath = path.join(payload.destinationPath, 'merged.pdf')
  const pdf = await pdfLib.PDFDocument.create()
  const background = hexToRgbaObject(payload.config.background || '#ffffff', 1)
  const backgroundColor = pdfLib.rgb(background.r / 255, background.g / 255, background.b / 255)
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

  emitProgress({
    phase: 'merge-pdf-prepare',
    total: Math.max(1, Array.isArray(payload.assets) ? payload.assets.length : 0),
    completed: 0,
    succeeded: 0,
    failed: 0,
  })

  const prepareAsset = async (asset) => {
    throwIfRunCancelled(payload.runId)
    const forcedEmbedKind = String(asset?.pdfEmbedKind || '').trim().toLowerCase()
    if (!forcedEmbedKind) {
      asset.inputFormat = await getAssetInputFormat(sharpLib, asset)
    } else if (!asset.inputFormat) {
      asset.inputFormat = forcedEmbedKind === 'jpg' ? 'jpeg' : forcedEmbedKind
    }
    const imageBytes = fs.readFileSync(asset.sourcePath)
    let sourceWidth = Math.max(0, Number(asset.width) || 0)
    let sourceHeight = Math.max(0, Number(asset.height) || 0)
    const margin = fixedMargin ?? (payload.config.margin === 'none'
      ? 0
      : payload.config.margin === 'wide'
        ? Math.round((sourceWidth || 1) * 0.08)
        : payload.config.margin === 'normal'
          ? Math.round((sourceWidth || 1) * 0.06)
          : Math.round((sourceWidth || 1) * 0.04))
    const prepared = {
      imageBytes,
      sourcePath: asset.sourcePath,
      sourceFormat: normalizeImageFormatName(asset.inputFormat || asset.ext),
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
    const directEmbeddedKind = forcedEmbedKind || detectDirectEmbedKind(imageBytes)
    if (directEmbeddedKind) {
      prepared.embeddedBytes = imageBytes
      prepared.embeddedKind = directEmbeddedKind
    }

    if (autoPaginateFixedPage) {
      if (!(sourceWidth > 0 && sourceHeight > 0)) {
        const metadata = await getAssetMetadata(sharpLib, asset)
        sourceWidth = Math.max(1, Number(metadata?.width) || sourceWidth || 1)
        sourceHeight = Math.max(1, Number(metadata?.height) || sourceHeight || 1)
        prepared.sourceWidth = sourceWidth
        prepared.sourceHeight = sourceHeight
      }
      prepared.drawableWidth = fixedDrawableWidth
      prepared.drawableHeight = fixedDrawableHeight
      prepared.scaledWidth = fixedDrawableWidth
      prepared.pageSliceHeight = fixedDrawableHeight
      prepared.scaledHeight = Math.max(1, Math.round(sourceHeight * (prepared.scaledWidth / sourceWidth)))
      prepared.requiresSlicing = prepared.scaledHeight > prepared.drawableHeight
      if (prepared.requiresSlicing) {
        prepared.scaledBuffer = await createTransformer(sharpLib, asset)
          .resize({ width: prepared.scaledWidth, fit: 'fill' })
          .png()
          .toBuffer()
      }
    }

    if (!prepared.embeddedKind) {
      const embeddedKind = isAlphaCapableFormat(prepared.sourceFormat) ? 'png' : 'jpg'
      prepared.embeddedBytes = embeddedKind === 'png'
        ? await createTransformer(sharpLib, asset).png().toBuffer()
        : await createTransformer(sharpLib, asset).jpeg().toBuffer()
      prepared.embeddedKind = embeddedKind
    }

    await yieldToEventLoop()
    return prepared
  }

  const preparedAssets = payload.assets.length === 1
    ? [await prepareAsset(payload.assets[0])]
    : await mapWithConcurrency(payload.assets, prepareConcurrency, prepareAsset)

  throwIfRunCancelled(payload.runId)
  emitProgress({
    phase: 'merge-pdf-write',
    total: Math.max(1, Array.isArray(payload.assets) ? payload.assets.length : 0),
    completed: Math.max(1, Array.isArray(payload.assets) ? payload.assets.length : 0),
    succeeded: 0,
    failed: 0,
  })

  for (const prepared of preparedAssets) {
    throwIfRunCancelled(payload.runId)
    await yieldToEventLoop()
    const { imageBytes } = prepared
    let embedded = null
    let sourceWidth = prepared.sourceWidth
    let sourceHeight = prepared.sourceHeight

    const ensureEmbedded = async () => {
      if (embedded) return embedded
      try {
        if (prepared.embeddedKind === 'png' && prepared.embeddedBytes) {
          embedded = await pdf.embedPng(prepared.embeddedBytes)
        } else if (prepared.embeddedKind === 'jpg' && prepared.embeddedBytes) {
          embedded = await pdf.embedJpg(prepared.embeddedBytes)
        } else {
          embedded = await pdf.embedPng(
            prepared.embeddedBytes || await createTransformer(sharpLib, {
              ...prepared,
              sourcePath: prepared.sourcePath,
              inputFormat: prepared.sourceFormat,
              ext: prepared.sourceFormat,
            }).png().toBuffer(),
          )
        }
      } catch {
        const forcePng = isAlphaCapableFormat(prepared.sourceFormat)
        const fallbackBytes = forcePng
          ? await createTransformer(sharpLib, {
            ...prepared,
            sourcePath: prepared.sourcePath,
            inputFormat: prepared.sourceFormat,
            ext: prepared.sourceFormat,
          }).png().toBuffer()
          : await createTransformer(sharpLib, {
            ...prepared,
            sourcePath: prepared.sourcePath,
            inputFormat: prepared.sourceFormat,
            ext: prepared.sourceFormat,
          }).jpeg().toBuffer()
        embedded = forcePng
          ? await pdf.embedPng(fallbackBytes)
          : await pdf.embedJpg(fallbackBytes)
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

    const scaledBuffer = prepared.scaledBuffer
      || await createTransformer(sharpLib, {
        sourcePath: prepared.sourcePath,
        inputFormat: prepared.sourceFormat,
        ext: prepared.sourceFormat,
      })
        .resize({ width: scaledWidth, fit: 'fill' })
        .png()
        .toBuffer()
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
  }

  const saveObjectsPerTick = payload.assets.length > 8 ? 8 : 16
  const bytes = await pdf.save({ objectsPerTick: saveObjectsPerTick })
  throwIfRunCancelled(payload.runId)
  fs.writeFileSync(outputPath, bytes)
  return {
    outputPath,
    outputSizeBytes: bytes.length,
    width: fixedPageSize?.[0] || 0,
    height: fixedPageSize?.[1] || 0,
  }
}

function mapWithConcurrency(items, concurrency, worker) {
  const source = Array.isArray(items) ? items : []
  const limit = Math.max(1, Math.min(source.length || 1, concurrency || 1))
  if (source.length <= 1 || limit <= 1) {
    return Promise.all(source.map((item, index) => worker(item, index)))
  }
  const results = new Array(source.length)
  let nextIndex = 0
  const runners = Array.from({ length: limit }, async () => {
    while (nextIndex < source.length) {
      const currentIndex = nextIndex
      nextIndex += 1
      results[currentIndex] = await worker(source[currentIndex], currentIndex)
    }
  })
  return Promise.all(runners).then(() => results)
}

module.exports = {
  writeMergePdfAssetCore,
}
