const fs = require('node:fs')
const path = require('node:path')

const INVALID_CHARS = /[<>:"/\\|?*\x00-\x1f]/g

function sanitizeBaseName(name) {
  return String(name || '')
    .replace(INVALID_CHARS, '_')
    .replace(/^\.+/, '')
    .trim()
}

function buildTargetBaseName(baseName, options, index) {
  if (options.renameMode === 'replace') {
    const findText = String(options.findText || '')
    if (!findText) {
      throw new Error('请填写查找内容')
    }
    if (!baseName.includes(findText)) {
      throw new Error('文件名未匹配到查找内容，已跳过')
    }
    const replaceText = String(options.replaceText ?? '')
    return sanitizeBaseName(baseName.split(findText).join(replaceText))
  }

  const startIndex = Number(options.startIndex)
  const padLength = Math.max(1, Number(options.padLength) || 3)
  const seq = Number.isFinite(startIndex) ? startIndex : 1
  const number = String(seq + index).padStart(padLength, '0')
  const prefix = String(options.prefix || '')
  const separator = options.separator == null ? '_' : String(options.separator)
  const raw = prefix ? `${prefix}${separator}${number}` : number
  return sanitizeBaseName(raw)
}

function renameOneImage(inputPath, options, index = 0) {
  try {
    if (!fs.existsSync(inputPath)) {
      return { inputPath, success: false, error: '源文件不存在' }
    }

    const dir = path.dirname(inputPath)
    const ext = path.extname(inputPath)
    const baseName = path.basename(inputPath, ext)
    const nextBase = buildTargetBaseName(baseName, options, index)

    if (!nextBase) {
      return { inputPath, success: false, error: '新文件名为空，已跳过' }
    }

    const outputPath = path.join(dir, nextBase + ext)
    const samePath = path.resolve(outputPath) === path.resolve(inputPath)

    if (samePath) {
      const stat = fs.statSync(inputPath)
      return {
        inputPath,
        outputPath,
        success: true,
        inputSize: stat.size,
        outputSize: stat.size
      }
    }

    if (fs.existsSync(outputPath)) {
      return {
        inputPath,
        outputPath,
        success: false,
        error: `目标文件名已存在，已跳过：${path.basename(outputPath)}`
      }
    }

    const oldStat = fs.statSync(inputPath)
    fs.renameSync(inputPath, outputPath)
    const newStat = fs.statSync(outputPath)

    return {
      inputPath,
      outputPath,
      success: true,
      inputSize: oldStat.size,
      outputSize: newStat.size
    }
  } catch (err) {
    return {
      inputPath,
      success: false,
      error: err && err.message ? err.message : String(err)
    }
  }
}

module.exports = { renameOneImage, buildTargetBaseName, sanitizeBaseName }
