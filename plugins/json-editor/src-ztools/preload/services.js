const fs = require('node:fs')
const path = require('node:path')

const maxFileSize = 32 * 1024 * 1024

function readFileContent(filePath) {
  if (typeof filePath !== 'string' || !path.isAbsolute(filePath) || path.extname(filePath).toLowerCase() !== '.json') {
    return ''
  }

  let descriptor
  try {
    descriptor = fs.openSync(filePath, fs.constants.O_RDONLY | (fs.constants.O_NONBLOCK ?? 0))
    const stat = fs.fstatSync(descriptor)
    if (!stat.isFile() || stat.size > maxFileSize) return ''

    const buffer = Buffer.allocUnsafe(stat.size + 1)
    let length = 0
    while (length < buffer.length) {
      const read = fs.readSync(descriptor, buffer, length, buffer.length - length, null)
      if (read === 0) return buffer.toString('utf8', 0, length)
      length += read
    }
    return ''
  } catch {
    return ''
  } finally {
    if (descriptor !== undefined) fs.closeSync(descriptor)
  }
}

window.services = Object.freeze({ readFileContent })
