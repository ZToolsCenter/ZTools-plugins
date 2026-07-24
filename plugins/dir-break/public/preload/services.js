const fs = require('node:fs')
const path = require('node:path')

const HISTORY_FILE = 'dir-break-history.json'

function getHistoryPath() {
  return path.join(window.ztools.getPath('userData'), HISTORY_FILE)
}

function readHistory() {
  const p = getHistoryPath()
  try {
    const raw = fs.readFileSync(p, { encoding: 'utf-8' })
    return JSON.parse(raw)
  } catch {
    return []
  }
}

function writeHistory(records) {
  const p = getHistoryPath()
  fs.writeFileSync(p, JSON.stringify(records, null, 2), { encoding: 'utf-8' })
}

function ensureDir(dir) {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true })
  }
}

function genUniquePath(targetPath) {
  if (!fs.existsSync(targetPath)) return targetPath
  const dir = path.dirname(targetPath)
  const ext = path.extname(targetPath)
  const base = path.basename(targetPath, ext)
  let i = 1
  while (fs.existsSync(path.join(dir, base + ' (' + i + ')' + ext))) {
    i++
  }
  return path.join(dir, base + ' (' + i + ')' + ext)
}

function getRelativePath(absolutePath, baseDir) {
  const rel = path.relative(baseDir, absolutePath)
  return rel.split(path.sep).join('/')
}

window.services = {

  scanDirectory(dirPath, recursive) {
    const info = { files: [], dirs: [], totalFiles: 0, totalDirs: 0, totalSize: 0, fileTypes: [] }
    const typeMap = new Map()
    if (!fs.existsSync(dirPath)) return info
    const stat = fs.statSync(dirPath)
    if (!stat.isDirectory()) return info

    function addToTypeMap(name) {
      const ext = path.extname(name).toLowerCase() || '(no-ext)'
      typeMap.set(ext, (typeMap.get(ext) || 0) + 1)
    }

    const entries = fs.readdirSync(dirPath)
    for (const name of entries) {
      const fullPath = path.join(dirPath, name)
      let s
      try { s = fs.statSync(fullPath) } catch { continue }
      if (s.isDirectory()) {
        info.dirs.push({ name, path: fullPath, relativePath: getRelativePath(fullPath, dirPath), size: 0 })
        info.totalDirs++
        if (recursive) {
          const sub = window.services.scanDirectory(fullPath, true)
          for (const f of sub.files) {
            info.files.push({ ...f, relativePath: getRelativePath(f.path, dirPath) })
            addToTypeMap(f.name)
          }
          for (const d of sub.dirs) {
            info.dirs.push({ ...d, relativePath: getRelativePath(d.path, dirPath) })
          }
          info.totalFiles += sub.totalFiles
          info.totalDirs += sub.totalDirs
          info.totalSize += sub.totalSize
        }
      } else {
        info.files.push({ name, path: fullPath, relativePath: getRelativePath(fullPath, dirPath), size: s.size })
        info.totalFiles++
        info.totalSize += s.size
        addToTypeMap(name)
      }
    }
    info.fileTypes = Array.from(typeMap.entries())
      .map(([ext, count]) => ({ ext, count }))
      .sort((a, b) => b.count - a.count)
    return info
  },

  breakDirectory(dirPath, options) {
    const { recursive, conflictStrategy } = options
    const parentDir = path.dirname(dirPath)
    const targetName = path.basename(dirPath)

    if (!fs.existsSync(dirPath)) {
      throw new Error('目录不存在: ' + dirPath)
    }

    const operations = []
    const deletedDirs = []

    function collectMoves(currentDir) {
      const entries = fs.readdirSync(currentDir)
      const subdirs = []
      for (const name of entries) {
        const fullPath = path.join(currentDir, name)
        const s = fs.statSync(fullPath)
        if (s.isDirectory()) {
          if (recursive) {
            subdirs.push({ name, path: fullPath })
          } else {
            operations.push({
              from: fullPath,
              name,
              originalDir: currentDir,
              relativeInTarget: name,
              isDir: true
            })
          }
        } else {
          operations.push({
            from: fullPath,
            name,
            originalDir: currentDir,
            relativeInTarget: name,
            isDir: false
          })
        }
      }
      if (recursive) {
        for (const sd of subdirs) {
          collectMoves(sd.path)
          const remaining = fs.readdirSync(sd.path)
          if (remaining.length === 0) {
            try { fs.rmdirSync(sd.path); deletedDirs.push(sd.path) } catch {}
          } else {
            operations.push({
              from: sd.path,
              name: sd.name,
              originalDir: currentDir,
              relativeInTarget: sd.name,
              isDir: true
            })
          }
        }
      }
    }

    collectMoves(dirPath)

    const movedItems = []

    for (const op of operations) {
      if (op.isDir) {
        const remain = fs.readdirSync(op.from)
        if (remain.length === 0) {
          try { fs.rmdirSync(op.from); deletedDirs.push(op.from) } catch {}
          continue
        }
      }

      const targetPath = path.join(parentDir, op.name)
      let finalTarget = targetPath

      if (fs.existsSync(targetPath)) {
        if (targetPath === dirPath) {
          finalTarget = genUniquePath(targetPath)
        } else if (conflictStrategy === 'rename') {
          finalTarget = genUniquePath(targetPath)
        } else if (conflictStrategy === 'overwrite') {
          fs.rmSync(targetPath, { recursive: true, force: true })
        } else if (conflictStrategy === 'skip') {
          continue
        }
      }

      fs.renameSync(op.from, finalTarget)
      movedItems.push({
        from: op.from,
        to: finalTarget,
        originalDir: op.originalDir,
        name: op.name,
        relativeInTarget: op.relativeInTarget,
        isDir: op.isDir
      })
    }

    const remaining = fs.readdirSync(dirPath)
    if (remaining.length === 0) {
      fs.rmdirSync(dirPath)
      deletedDirs.push(dirPath)
    }

    const record = {
      id: Date.now().toString() + '-' + Math.random().toString(36).slice(2, 8),
      timestamp: Date.now(),
      targetDir: dirPath,
      parentDir,
      targetName,
      recursive,
      conflictStrategy,
      movedFiles: movedItems,
      deletedDirs,
      summary: {
        totalMoved: movedItems.filter((m) => !m.isDir).length,
        totalDirsMoved: movedItems.filter((m) => m.isDir).length,
        totalDeleted: deletedDirs.length
      }
    }

    const history = readHistory()
    history.unshift(record)
    if (history.length > 50) history.length = 50
    writeHistory(history)

    return record
  },

  undoBreak(record) {
    const errors = []

    for (const d of record.deletedDirs) {
      ensureDir(d)
    }

    const reverseOps = [...record.movedFiles].reverse()
    for (const op of reverseOps) {
      if (fs.existsSync(op.to)) {
        ensureDir(path.dirname(op.from))
        fs.renameSync(op.to, op.from)
      } else {
        errors.push('文件不存在，无法撤回: ' + op.to)
      }
    }

    const history = readHistory()
    const idx = history.findIndex((r) => r.id === record.id)
    if (idx !== -1) {
      history.splice(idx, 1)
      writeHistory(history)
    }

    return { success: errors.length === 0, errors }
  },

  getHistory() {
    return readHistory()
  },

  clearHistory() {
    writeHistory([])
  }
}
