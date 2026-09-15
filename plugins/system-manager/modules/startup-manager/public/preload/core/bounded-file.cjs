'use strict'

const MAX_MUTABLE_FILE_BYTES = 256 * 1024

function unsafeFile(message) {
  const error = new Error(message)
  error.code = 'UNSAFE_FILE'
  return error
}

function validateStat(info, maxBytes) {
  if (!info || info.isSymbolicLink?.() || !info.isFile?.()) throw unsafeFile('启动项不是普通文件')
  if (!Number.isSafeInteger(info.size) || info.size < 0 || info.size > maxBytes) throw unsafeFile(`启动项超过 ${maxBytes} bytes 上限`)
}

function sameIdentity(left, right) {
  return left && right && left.dev === right.dev && left.ino === right.ino
}

async function readBoundedFile(file, fileSystem, options = {}) {
  const maxBytes = Number.isInteger(options.maxBytes) && options.maxBytes > 0 ? Math.min(MAX_MUTABLE_FILE_BYTES, options.maxBytes) : MAX_MUTABLE_FILE_BYTES
  const initial = options.initialStat || await fileSystem.lstat(file)
  validateStat(initial, maxBytes)

  if (typeof fileSystem.open !== 'function') {
    const fallback = await fileSystem.readFile(file)
    const content = Buffer.isBuffer(fallback) ? fallback : Buffer.from(String(fallback))
    if (content.length > maxBytes) throw unsafeFile(`启动项超过 ${maxBytes} bytes 上限`)
    return content
  }

  const handle = await fileSystem.open(file, 'r')
  try {
    const before = await handle.stat()
    validateStat(before, maxBytes)
    if (!sameIdentity(initial, before)) throw unsafeFile('启动项在打开前发生变化')
    const buffer = Buffer.alloc(before.size + 1)
    let offset = 0
    while (offset < buffer.length) {
      const { bytesRead } = await handle.read(buffer, offset, buffer.length - offset, offset)
      if (bytesRead === 0) break
      offset += bytesRead
    }
    const after = await handle.stat()
    if (!sameIdentity(before, after) || before.size !== after.size || before.mtimeMs !== after.mtimeMs || offset !== before.size) {
      throw unsafeFile('启动项在读取期间发生变化')
    }
    return buffer.subarray(0, offset)
  } finally {
    await handle.close()
  }
}

module.exports = { MAX_MUTABLE_FILE_BYTES, readBoundedFile }
