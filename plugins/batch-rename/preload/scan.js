const fs = require('node:fs/promises')
const path = require('node:path')

const MAX_FILES = 10000
const YIELD_EVERY = 64

async function scanDirectory(directoryPath) {
  if (typeof directoryPath !== 'string' || !path.isAbsolute(directoryPath)) {
    throw new TypeError('目录路径必须是绝对路径')
  }

  const paths = []
  const errors = []
  const pending = [directoryPath]
  let truncated = false

  while (pending.length && !truncated) {
    const currentPath = pending.pop()
    let directory

    try {
      directory = await fs.opendir(currentPath)
    } catch (error) {
      errors.push({ path: currentPath, message: `读取目录失败：${errorMessage(error)}` })
      continue
    }

    let processed = 0
    try {
      for await (const entry of directory) {
        const entryPath = path.join(currentPath, entry.name)
        try {
          // lstat 不跟随符号链接；junction 也作为链接跳过。
          const stats = await fs.lstat(entryPath)
          if (stats.isSymbolicLink()) continue
          if (stats.isDirectory()) {
            pending.push(entryPath)
          } else if (stats.isFile()) {
            if (paths.length === MAX_FILES) {
              errors.push({ path: currentPath, message: `文件数量超过上限 ${MAX_FILES}，扫描结果已截断` })
              truncated = true
              break
            }
            paths.push(entryPath)
          }
        } catch (error) {
          errors.push({ path: entryPath, message: `读取条目失败：${errorMessage(error)}` })
        }

        processed += 1
        if (processed % YIELD_EVERY === 0) await new Promise((resolve) => setImmediate(resolve))
      }
    } catch (error) {
      errors.push({ path: currentPath, message: `读取目录失败：${errorMessage(error)}` })
    } finally {
      await directory.close().catch(() => {})
    }
  }

  return { paths, errors }
}

function errorMessage(error) {
  return error instanceof Error ? error.message : String(error)
}

module.exports = { scanDirectory }
