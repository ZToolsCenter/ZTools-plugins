const fs = require('node:fs/promises')
const { constants } = require('node:fs')
const path = require('node:path')

const types = {
  '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png',
  '.gif': 'image/gif', '.webp': 'image/webp', '.bmp': 'image/bmp',
  '.svg': 'image/svg+xml', '.avif': 'image/avif', '.ico': 'image/x-icon',
  '.heic': 'image/heic', '.tif': 'image/tiff', '.tiff': 'image/tiff'
}
const imageType = target => typeof target === 'string' ? types[path.extname(target).toLowerCase()] : undefined
const maxBytes = 32 * 1024 * 1024

async function readImage(target) {
  const type = imageType(target)
  if (!type || !path.isAbsolute(target)) throw new Error('图片路径或格式无效')
  // Unix 上即使文件被替换成管道，open 也不会阻塞；只读取普通文件。
  const flags = process.platform === 'win32' ? constants.O_RDONLY : constants.O_RDONLY | constants.O_NONBLOCK
  const file = await fs.open(target, flags)
  try {
    const { size, mode } = await file.stat()
    if ((mode & constants.S_IFMT) !== constants.S_IFREG || !size) throw new Error('图片为空或不可读取')
    if (size > maxBytes) throw new Error('图片超过 32 MB，请用默认应用打开')
    const bytes = new Uint8Array(size)
    let offset = 0
    while (offset < size) {
      const { bytesRead } = await file.read(bytes, offset, size - offset, offset)
      if (!bytesRead) throw new Error('图片在读取时发生变化，请重试')
      offset += bytesRead
    }
    return { type, bytes }
  } finally { await file.close() }
}

module.exports = { imageType, readImage }
