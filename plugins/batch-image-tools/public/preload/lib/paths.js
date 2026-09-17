const path = require('node:path')
const { IMAGE_EXTENSIONS } = require('./constants')

function getExtension(filePath) {
  return path.extname(filePath).slice(1).toLowerCase()
}

function isImageFile(filePath) {
  return IMAGE_EXTENSIONS.has(getExtension(filePath))
}

function normalizeFormat(format) {
  if (!format || format === 'original') return null
  if (format === 'jpg') return 'jpeg'
  if (format === 'ico') return 'png'
  return format
}

function resolveOutputPath(inputPath, options) {
  const outFormat = normalizeFormat(options.format)
  const ext = outFormat || getExtension(inputPath)
  const baseName = path.basename(inputPath, path.extname(inputPath))
  const outputMode = options.outputMode || 'same-folder'

  if (outputMode === 'overwrite') {
    if (outFormat && outFormat !== getExtension(inputPath)) {
      return path.join(path.dirname(inputPath), baseName + '.' + ext)
    }
    return inputPath
  }

  if (outputMode === 'output-dir') {
    const dir = options.outputDir || path.dirname(inputPath)
    return path.join(dir, baseName + '.' + ext)
  }

  const suffix = options.suffix || '_processed'
  const dir = path.dirname(inputPath)
  if (outFormat) {
    return path.join(dir, baseName + suffix + '.' + ext)
  }
  return path.join(dir, baseName + suffix + path.extname(inputPath))
}

function resolveMergeOutputPath(firstInputPath, options) {
  const mergeMode = options.mergeMode || 'long-vertical'
  const outputMode = options.outputMode || 'same-folder'
  const dir =
    outputMode === 'output-dir' && options.outputDir
      ? options.outputDir
      : path.dirname(firstInputPath)
  const suffix = options.suffix || '_merged'
  const baseName = path.basename(firstInputPath, path.extname(firstInputPath))

  if (mergeMode === 'pdf') {
    return path.join(dir, baseName + suffix + '.pdf')
  }
  if (mergeMode === 'gif-animated') {
    return path.join(dir, baseName + suffix + '.gif')
  }

  const format = normalizeFormat(options.format) || 'jpeg'
  return path.join(dir, baseName + suffix + '.' + format)
}

module.exports = {
  getExtension,
  isImageFile,
  normalizeFormat,
  resolveOutputPath,
  resolveMergeOutputPath
}
