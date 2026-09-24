const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')

function ensureDir(dir) {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true })
  }
}

function createTempPath(prefix) {
  return path.join(
    os.tmpdir(),
    prefix + '-' + process.pid + '-' + Date.now() + '-' + Math.random().toString(36).slice(2) + '.tmp'
  )
}

function finalizeOutput(tempPath, outputPath, inputPath) {
  if (outputPath === inputPath) {
    fs.unlinkSync(inputPath)
  } else if (fs.existsSync(outputPath)) {
    fs.unlinkSync(tempPath)
    return { success: false, error: '输出文件已存在: ' + outputPath }
  }
  fs.renameSync(tempPath, outputPath)
  return { success: true }
}

function safeUnlink(filePath) {
  if (filePath && fs.existsSync(filePath)) {
    try {
      fs.unlinkSync(filePath)
    } catch {
      // ignore
    }
  }
}

module.exports = {
  ensureDir,
  createTempPath,
  finalizeOutput,
  safeUnlink
}
