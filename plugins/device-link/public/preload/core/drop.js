'use strict'

const path = require('node:path')

function resolveDroppedFilePaths(files, getPathForFile) {
  if (!files || typeof files[Symbol.iterator] !== 'function') throw new TypeError('拖入内容不包含文件')
  const resolved = []

  for (const file of files) {
    if (!file || typeof file !== 'object') continue
    let candidate = ''
    if (typeof getPathForFile === 'function') {
      try {
        candidate = getPathForFile(file) || ''
      } catch {
        // Older Electron releases expose File.path instead of webUtils.
      }
    }
    if (!candidate && typeof file.path === 'string') candidate = file.path
    if (typeof candidate === 'string' && path.isAbsolute(candidate)) resolved.push(path.normalize(candidate))
  }

  const unique = [...new Set(resolved)]
  if (unique.length === 0) throw new TypeError('无法读取拖入文件的本机路径，请改用附件按钮选择')
  return unique
}

module.exports = { resolveDroppedFilePaths }
