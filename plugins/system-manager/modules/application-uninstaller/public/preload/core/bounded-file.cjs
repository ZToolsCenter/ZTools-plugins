'use strict'

const MAX_METADATA_BYTES = 1024 * 1024

function unsafeFile(message) {
  const error = new Error(message)
  error.code = 'UNSAFE_FILE'
  return error
}

function validateStat(info, maxBytes) {
  if (!info || info.isSymbolicLink?.() || !info.isFile?.()) throw unsafeFile('元数据入口不是普通文件')
  if (!Number.isSafeInteger(info.size) || info.size < 0 || info.size > maxBytes) throw unsafeFile(`元数据入口超过 ${maxBytes} bytes 上限`)
}

function sameIdentity(left, right) {
  return left && right && left.dev === right.dev && left.ino === right.ino
}

async function readBoundedFile(file, fileSystem, options = {}) {
  const maxBytes = Number.isInteger(options.maxBytes) && options.maxBytes > 0 ? Math.min(MAX_METADATA_BYTES, options.maxBytes) : MAX_METADATA_BYTES
  const initial = options.initialStat || (typeof fileSystem.lstat === 'function' ? await fileSystem.lstat(file) : null)
  if (initial) validateStat(initial, maxBytes)

  if (typeof fileSystem.open !== 'function') {
    const fallback = await fileSystem.readFile(file)
    const content = Buffer.isBuffer(fallback) ? fallback : Buffer.from(String(fallback))
    if (content.length > maxBytes) throw unsafeFile(`元数据入口超过 ${maxBytes} bytes 上限`)
    return options.encoding ? content.toString(options.encoding) : content
  }

  const handle = await fileSystem.open(file, 'r')
  try {
    const before = await handle.stat()
    validateStat(before, maxBytes)
    if (initial && !sameIdentity(initial, before)) throw unsafeFile('元数据入口在打开前发生变化')
    const buffer = Buffer.alloc(before.size + 1)
    let offset = 0
    while (offset < buffer.length) {
      const { bytesRead } = await handle.read(buffer, offset, buffer.length - offset, offset)
      if (bytesRead === 0) break
      offset += bytesRead
    }
    const after = await handle.stat()
    if (!sameIdentity(before, after) || before.size !== after.size || before.mtimeMs !== after.mtimeMs || offset !== before.size) {
      throw unsafeFile('元数据入口在读取期间发生变化')
    }
    const content = buffer.subarray(0, offset)
    return options.encoding ? content.toString(options.encoding) : content
  } finally {
    await handle.close()
  }
}

async function assertBoundedRegularFile(file, fileSystem, maxBytes = MAX_METADATA_BYTES) {
  const info = await fileSystem.lstat(file)
  validateStat(info, Math.min(MAX_METADATA_BYTES, maxBytes))
  return info
}

module.exports = { MAX_METADATA_BYTES, assertBoundedRegularFile, readBoundedFile }
