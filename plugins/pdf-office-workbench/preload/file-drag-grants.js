const DEFAULT_TTL_MS = 5 * 60 * 1000

function createFileDragGrantStore(options) {
  const fs = options.fs
  const path = options.path
  const now = options.now || Date.now
  const ttlMs = options.ttlMs || DEFAULT_TTL_MS
  const requiredExtension = String(options.requiredExtension || '').toLowerCase()
  const grants = new Map()

  function canonicalFile(filePath) {
    if (typeof filePath !== 'string' || !path.isAbsolute(filePath)) {
      throw new Error('拖出的输出路径无效。')
    }
    let canonical
    try {
      canonical = fs.realpathSync(filePath)
      if (!fs.statSync(canonical).isFile()) throw new Error('not a regular file')
    } catch (_) {
      throw new Error('拖出的输出路径无效或文件已不存在。')
    }
    if (requiredExtension && path.extname(canonical).toLowerCase() !== requiredExtension) {
      throw new Error('拖出的输出文件类型无效。')
    }
    return canonical
  }

  function pruneExpired() {
    const current = now()
    for (const [filePath, expiresAt] of grants) {
      if (expiresAt <= current) grants.delete(filePath)
    }
  }

  return {
    grant(filePath) {
      const canonical = canonicalFile(filePath)
      pruneExpired()
      grants.set(canonical, now() + ttlMs)
      return canonical
    },

    consume(filePaths) {
      const values = Array.isArray(filePaths) ? filePaths : [filePaths]
      if (!values.length) throw new Error('拖出的输出路径无效。')
      pruneExpired()
      const canonical = values.map(canonicalFile)
      if (new Set(canonical).size !== canonical.length) {
        throw new Error('拖出的输出路径包含重复文件。')
      }
      if (canonical.some(filePath => !grants.has(filePath))) {
        throw new Error('只能拖出刚刚由插件生成的 PDF 文件。')
      }
      canonical.forEach(filePath => grants.delete(filePath))
      return canonical
    }
  }
}

module.exports = { DEFAULT_TTL_MS, createFileDragGrantStore }
