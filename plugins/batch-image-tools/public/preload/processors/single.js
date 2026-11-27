const fs = require('node:fs')
const sharp = require('../lib/sharp-loader')
const { resolveOutputPath, normalizeFormat } = require('../lib/paths')
const { ensureDir, createTempPath, finalizeOutput, safeUnlink } = require('../lib/output')
const { applyFormat, buildPipeline } = require('./pipeline')

async function processOneImage(inputPath, options) {
  const outputPath = resolveOutputPath(inputPath, options)
  ensureDir(require('node:path').dirname(outputPath))

  const tempPath = createTempPath('batch-image')
  try {
    const { writer, meta } = await buildPipeline(inputPath, options)
    const outFormat = normalizeFormat(options.format) || meta.format || 'jpeg'
    const quality = Number(options.quality) || 80

    if (options.targetSizeKb && Number(options.targetSizeKb) > 0 && options.tool === 'compress') {
      const { renderToBuffer } = require('./pipeline')
      const buf = await renderToBuffer(inputPath, options)
      fs.writeFileSync(tempPath, buf)
    } else {
      await applyFormat(writer, outFormat, quality).toFile(tempPath)
    }

    const oldStat = fs.statSync(inputPath)
    const finalize = finalizeOutput(tempPath, outputPath, inputPath)
    if (!finalize.success) {
      return { inputPath, outputPath, success: false, error: finalize.error }
    }

    const newStat = fs.statSync(outputPath)
    return {
      inputPath,
      outputPath,
      success: true,
      inputSize: oldStat.size,
      outputSize: newStat.size,
      width: meta.width,
      height: meta.height,
      format: outFormat
    }
  } catch (err) {
    safeUnlink(tempPath)
    return {
      inputPath,
      success: false,
      error: err && err.message ? err.message : String(err)
    }
  }
}

module.exports = { processOneImage }
