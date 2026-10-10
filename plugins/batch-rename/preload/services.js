const fs = require('node:fs/promises')
const path = require('node:path')
const { scanDirectory } = require('./scan')
const { readMetadata, clearMetadataCache } = require('./metadata')
const { validatePlan, executePlan, undo, resetTask } = require('./engine')

async function readFileInfo(sourcePath) {
  const name = typeof sourcePath === 'string' ? path.basename(sourcePath) : ''
  if (typeof sourcePath !== 'string' || !path.isAbsolute(sourcePath)) {
    return { path: String(sourcePath), name, error: '文件路径无效' }
  }

  try {
    const stats = await fs.stat(sourcePath)
    if (!stats.isFile()) return { path: sourcePath, name, error: '仅支持文件' }
    return {
      path: sourcePath,
      name,
      size: stats.size,
      createdAt: stats.birthtimeMs,
      modifiedAt: stats.mtimeMs
    }
  } catch (error) {
    const message = error && error.code === 'ENOENT'
      ? '源文件不存在'
      : error && ['EACCES', 'EPERM'].includes(error.code)
        ? '无权限读取文件'
        : `读取文件信息失败：${error instanceof Error ? error.message : String(error)}`
    return { path: sourcePath, name, error: message }
  }
}

window.renameService = {
  platform: process.platform,
  scanDirectory,
  readMetadata,
  validatePlan,
  executePlan,
  undo,
  resetTask() { resetTask(); clearMetadataCache() },
  async readFileInfos(paths) {
    if (!Array.isArray(paths) || paths.length > 10000) throw new Error('文件列表无效')
    const results = []
    for (let index = 0; index < paths.length; index += 32) {
      results.push(...await Promise.all(paths.slice(index, index + 32).map(readFileInfo)))
    }
    return results
  }
}
