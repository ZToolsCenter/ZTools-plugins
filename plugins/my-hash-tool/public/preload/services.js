const crypto = require('node:crypto')
const fs = require('node:fs')
const path = require('node:path')

const CHUNK_SIZE = 4 * 1024 * 1024
const CORE_ALGORITHMS = ['md5', 'sha1', 'sha256']
const CRYPTO_ALGORITHMS = new Set(['md5', 'sha1', 'sha256', 'sha384', 'sha512'])
const CRC32_TABLE = createCrc32Table()
let electronWebUtils = null

try {
  electronWebUtils = require('electron').webUtils
} catch {
  electronWebUtils = null
}

function getFileInfo(filePath) {
  const normalizedPath = path.resolve(filePath)
  const stat = fs.statSync(normalizedPath)

  if (!stat.isFile()) {
    throw new Error('请选择文件，暂不支持文件夹')
  }

  return {
    path: normalizedPath,
    name: path.basename(normalizedPath),
    size: stat.size
  }
}

function getDroppedFilePath(file) {
  if (file && typeof file.path === 'string' && file.path) {
    return file.path
  }

  if (electronWebUtils && typeof electronWebUtils.getPathForFile === 'function') {
    const filePath = electronWebUtils.getPathForFile(file)
    if (filePath) return filePath
  }

  throw new Error('无法读取拖入文件的路径，请使用“选择文件”按钮重试')
}

function normalizeAlgorithms(algorithms) {
  const requestedAlgorithms = Array.isArray(algorithms) ? algorithms : []
  const nextAlgorithms = []

  for (const algorithm of [...CORE_ALGORITHMS, ...requestedAlgorithms]) {
    if ((CRYPTO_ALGORITHMS.has(algorithm) || algorithm === 'crc32') && !nextAlgorithms.includes(algorithm)) {
      nextAlgorithms.push(algorithm)
    }
  }

  return nextAlgorithms
}

function createCrc32Table() {
  const table = new Uint32Array(256)

  for (let index = 0; index < table.length; index += 1) {
    let value = index
    for (let bit = 0; bit < 8; bit += 1) {
      value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1
    }
    table[index] = value >>> 0
  }

  return table
}

function updateCrc32(currentValue, chunk) {
  let value = currentValue
  for (const byte of chunk) {
    value = CRC32_TABLE[(value ^ byte) & 0xff] ^ (value >>> 8)
  }
  return value >>> 0
}

function digestCrc32(currentValue) {
  return ((currentValue ^ 0xffffffff) >>> 0).toString(16).padStart(8, '0')
}

function hashFile(filePath, algorithms, onProgress) {
  return new Promise((resolve, reject) => {
    // 规范化路径，防止路径遍历攻击
    const normalizedPath = path.resolve(filePath)
    let fileSize = 0

    try {
      fileSize = fs.statSync(normalizedPath).size
    } catch (error) {
      reject(error)
      return
    }

    const enabledAlgorithms = normalizeAlgorithms(algorithms)
    const hashes = {}
    let crc32 = 0xffffffff

    for (const algorithm of enabledAlgorithms) {
      if (CRYPTO_ALGORITHMS.has(algorithm)) {
        hashes[algorithm] = crypto.createHash(algorithm)
      }
    }

    const hashInstances = Object.values(hashes)
    const shouldCalculateCrc32 = enabledAlgorithms.includes('crc32')
    const stream = fs.createReadStream(normalizedPath, { highWaterMark: CHUNK_SIZE })
    let bytesRead = 0

    stream.on('data', (chunk) => {
      bytesRead += chunk.length
      for (const hash of hashInstances) {
        hash.update(chunk)
      }
      if (shouldCalculateCrc32) {
        crc32 = updateCrc32(crc32, chunk)
      }

      if (typeof onProgress === 'function') {
        onProgress({
          path: normalizedPath,
          bytesRead,
          totalBytes: fileSize,
          progress: fileSize === 0 ? 100 : Math.min(100, (bytesRead / fileSize) * 100)
        })
      }
    })

    stream.on('error', (error) => {
      stream.destroy()
      reject(error)
    })

    stream.on('end', () => {
      stream.destroy()

      if (typeof onProgress === 'function') {
        onProgress({
          path: normalizedPath,
          bytesRead: fileSize,
          totalBytes: fileSize,
          progress: 100
        })
      }

      const result = {}
      for (const algorithm of enabledAlgorithms) {
        result[algorithm] = algorithm === 'crc32' ? digestCrc32(crc32) : hashes[algorithm].digest('hex')
      }

      resolve(result)
    })
  })
}

function hashText(text, algorithms) {
  const content = String(text)
  const buffer = Buffer.from(content, 'utf8')
  const enabledAlgorithms = normalizeAlgorithms(algorithms)
  const result = {}

  for (const algorithm of enabledAlgorithms) {
    result[algorithm] =
      algorithm === 'crc32'
        ? digestCrc32(updateCrc32(0xffffffff, buffer))
        : crypto.createHash(algorithm).update(buffer).digest('hex')
  }

  return result
}

// 通过 window 对象向渲染进程注入 nodejs 能力
window.services = {
  selectFiles() {
    const files = window.ztools.showOpenDialog({
      title: '选择需要计算 Hash 的文件',
      buttonLabel: '选择文件',
      properties: ['openFile', 'multiSelections']
    })

    if (!files) return []

    return files.map((filePath) => getFileInfo(filePath))
  },

  getFileInfos(filePaths) {
    return filePaths.map((filePath) => getFileInfo(filePath))
  },

  getDroppedFileInfos(files) {
    return Array.from(files).map((file) => getFileInfo(getDroppedFilePath(file)))
  },

  hashFile(filePath, algorithms, onProgress) {
    return hashFile(filePath, algorithms, onProgress)
  },

  hashText(text, algorithms) {
    return hashText(text, algorithms)
  }
}
