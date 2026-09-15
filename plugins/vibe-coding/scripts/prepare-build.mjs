import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const scriptsDir = path.dirname(fileURLToPath(import.meta.url))
const runtimeDirectory = path.resolve(scriptsDir, '..', 'dist', 'node_modules')

/**
 * 递归删除运行时目录中的 Finder 元数据，避免 Vite 清空 dist 失败。
 * @param {string} directory 待清理目录。
 * @returns {void} 无返回值。
 */
function removeFinderMetadata(directory) {
  if (!fs.existsSync(directory)) return
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const target = path.join(directory, entry.name)
    if (entry.name === '.DS_Store' && entry.isFile()) {
      try { fs.unlinkSync(target) } catch { /* 锁定文件交由后续 rmSync 统一报告。 */ }
    } else if (entry.isDirectory()) {
      removeFinderMetadata(target)
    }
  }
}
removeFinderMetadata(runtimeDirectory)
if (fs.existsSync(runtimeDirectory)) {
  // 优先原子改名旧依赖目录，降低 Vite 清空目录时的文件占用竞争。
  const tombstone = `${runtimeDirectory}.old-${process.pid}`
  try { fs.renameSync(runtimeDirectory, tombstone) } catch { /* 改名失败时回退为直接删除。 */ }
  if (fs.existsSync(tombstone)) fs.rmSync(tombstone, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 })
  else fs.rmSync(runtimeDirectory, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 })
}
