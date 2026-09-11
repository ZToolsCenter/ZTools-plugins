const fs = require('node:fs')
const path = require('node:path')
const { clipboard, webUtils } = require('electron')

function toFileUrlPath(value) {
  try {
    const parsed = new URL(value)
    if (parsed.protocol !== 'file:') return ''

    let filePath = decodeURIComponent(parsed.pathname)
    if (parsed.host) {
      filePath = `//${parsed.host}${filePath}`
    }
    if (process.platform === 'win32' && /^\/[a-zA-Z]:/.test(filePath)) {
      filePath = filePath.slice(1)
    }
    return process.platform === 'win32' ? filePath.replace(/\//g, '\\') : filePath
  } catch {
    return ''
  }
}

function parseUriList(value) {
  return value
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && line !== 'copy' && line !== 'cut' && !line.startsWith('#'))
    .map(toFileUrlPath)
    .filter(Boolean)
}

function uniqueExistingPaths(paths) {
  const seen = new Set()
  return paths.filter((targetPath) => {
    if (!targetPath || !path.isAbsolute(targetPath) || !fs.existsSync(targetPath)) return false
    const identity = process.platform === 'win32' ? targetPath.toLowerCase() : targetPath
    if (seen.has(identity)) return false
    seen.add(identity)
    return true
  })
}

// 通过 window 对象向渲染进程注入 nodejs 能力
window.services = {
  // 重命名文件
  rename(oldPath, newPath) {
    return new Promise((resolve, reject) => {
      fs.rename(oldPath, newPath, (err) => {
        if (err) reject(err)
        else resolve()
      })
    })
  },
  // 判断文件是否存在
  exists(targetPath) {
    return fs.existsSync(targetPath)
  },
  // 读取文件状态信息
  getStats(targetPath) {
    return new Promise((resolve, reject) => {
      fs.stat(targetPath, (err, stats) => {
        if (err) {
          reject(err)
          return
        }

        resolve({
          isFile: stats.isFile(),
          isDirectory: stats.isDirectory(),
          size: stats.size,
          mtimeMs: stats.mtimeMs,
          ctimeMs: stats.ctimeMs,
          birthtimeMs: stats.birthtimeMs
        })
      })
    })
  },
  // 仅读取目录的直接子项，目录节点由渲染层按需进入。
  async readDirectory(targetPath) {
    const entries = await fs.promises.readdir(targetPath, { withFileTypes: true })
    const details = await Promise.all(entries.map(async (entry) => {
      const entryPath = path.join(targetPath, entry.name)
      try {
        const stats = await fs.promises.stat(entryPath)
        return {
          name: entry.name,
          path: entryPath,
          isFile: stats.isFile(),
          isDirectory: stats.isDirectory(),
          size: stats.size,
          mtimeMs: stats.mtimeMs,
          ctimeMs: stats.ctimeMs,
          birthtimeMs: stats.birthtimeMs
        }
      } catch {
        return null
      }
    }))

    return details
      .filter(Boolean)
      .sort((left, right) => {
        if (left.isDirectory !== right.isDirectory) return left.isDirectory ? -1 : 1
        return left.name.localeCompare(right.name, undefined, { numeric: true, sensitivity: 'base' })
      })
  },
  // 优先由 PasteEvent 提供 File 对象；这里补齐不同桌面系统的文件剪贴板格式。
  getClipboardFilePaths() {
    const formats = clipboard.availableFormats()
    const paths = []

    if (formats.includes('FileNameW')) {
      const value = clipboard.readBuffer('FileNameW').toString('utf16le')
      paths.push(...value.split('\0').map((item) => item.trim()).filter(Boolean))
    }

    for (const format of ['text/uri-list', 'x-special/gnome-copied-files', 'public.file-url']) {
      if (!formats.includes(format)) continue
      const value = clipboard.readBuffer(format).toString('utf8')
      paths.push(...parseUriList(value))
    }

    return uniqueExistingPaths(paths)
  },
  writeClipboardText(text) {
    clipboard.writeText(text)
  },
  // 获取拖拽 File 对象的本地绝对路径（Electron 22+ 废弃 File.path，改用 webUtils）
  getPathForFile(file) {
    return webUtils.getPathForFile(file)
  }
}
