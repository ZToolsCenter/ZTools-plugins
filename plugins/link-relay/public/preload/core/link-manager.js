/**
 * 链接管理模块 —— 检测目录链接状态、创建/删除 Junction/Symlink。
 *
 * 状态检测逻辑：
 * - not-installed: 源和目标都不存在
 * - target-only:   源不存在，目标存在（重装后场景）
 * - not-linked:    源是实体目录，目标不存在
 * - linked:        源是链接且指向目标
 * - broken:        源是链接但指向错误，或目标是链接
 * - conflict:      源和目标都是实体目录
 */

const fs = require('node:fs')
const path = require('node:path')

/** 检测目录是否存在 */
function dirExists(dirPath) {
  try {
    return fs.existsSync(dirPath)
  } catch {
    return false
  }
}

/** 检测路径是否为符号链接/Junction */
function isLink(dirPath) {
  try {
    const stat = fs.lstatSync(dirPath)
    return stat.isSymbolicLink()
  } catch {
    return false
  }
}

/** 获取链接的真实目标路径 */
function getRealTarget(dirPath) {
  try {
    return fs.realpathSync(dirPath)
  } catch {
    return null
  }
}

/** 规范化路径用于比较（解析大小写、分隔符差异） */
function normalizePath(p) {
  if (!p) return ''
  try {
    return path.resolve(p).toLowerCase().replace(/[\\/]+$/, '')
  } catch {
    return p.toLowerCase().replace(/[\\/]+$/, '')
  }
}

/**
 * 检测单个目录的链接状态。
 * @param {string} sourcePath 源路径
 * @param {string} targetPath 目标路径
 * @returns {{ path: string, target: string, status: string, size: number, realTarget?: string, sourceMtime?: string, targetMtime?: string }}
 */
function checkDirStatus(sourcePath, targetPath) {
  const sourceExists = dirExists(sourcePath)
  const targetExists = dirExists(targetPath)

  const result = {
    path: sourcePath,
    target: targetPath,
    status: 'unknown',
    size: 0,
  }

  // 两侧都不存在
  if (!sourceExists && !targetExists) {
    result.status = 'not-installed'
    return result
  }

  // 源不存在，目标存在 → 重装后场景
  if (!sourceExists && targetExists) {
    result.status = 'target-only'
    result.size = getDirSizeSync(targetPath)
    result.targetMtime = getMtime(targetPath)
    return result
  }

  // 源存在
  const sourceIsLink = isLink(sourcePath)

  if (sourceIsLink) {
    const realTarget = getRealTarget(sourcePath)
    result.realTarget = realTarget
    const expectedReal = targetExists ? normalizePath(targetPath) : null

    if (realTarget && expectedReal && normalizePath(realTarget) === expectedReal) {
      result.status = 'linked'
      result.size = 0 // 链接本身不占源盘空间
    } else {
      result.status = 'broken'
      result.size = getDirSizeSync(sourcePath)
    }
    return result
  }

  // 源是实体目录
  if (targetExists) {
    const targetIsLink = isLink(targetPath)
    if (targetIsLink) {
      result.status = 'broken' // 目标是链接，异常
    } else {
      result.status = 'conflict' // 两侧都是实体目录
    }
    result.size = getDirSizeSync(sourcePath)
    result.sourceMtime = getMtime(sourcePath)
    result.targetMtime = getMtime(targetPath)
    return result
  }

  // 源是实体目录，目标不存在 → 未迁移
  result.status = 'not-linked'
  result.size = getDirSizeSync(sourcePath)
  result.sourceMtime = getMtime(sourcePath)
  return result
}

/** 获取目录大小（递归，同步） */
function getDirSizeSync(dirPath) {
  try {
    if (!fs.existsSync(dirPath)) return 0
    let total = 0
    const entries = fs.readdirSync(dirPath, { withFileTypes: true })
    for (const entry of entries) {
      const fullPath = path.join(dirPath, entry.name)
      if (entry.isDirectory()) {
        // 跳过链接目录，避免循环
        if (isLink(fullPath)) continue
        total += getDirSizeSync(fullPath)
      } else {
        try {
          total += fs.statSync(fullPath).size
        } catch {
          // 忽略无法读取的文件
        }
      }
    }
    return total
  } catch {
    return 0
  }
}

/** 获取目录最后修改时间 */
function getMtime(dirPath) {
  try {
    return fs.statSync(dirPath).mtime.toISOString()
  } catch {
    return undefined
  }
}

/**
 * 创建 Junction（Windows）或 Symlink（macOS/Linux）。
 * Windows 使用 junction 类型，无需管理员权限。
 */
function createLink(targetPath, sourcePath) {
  const platform = process.platform
  const linkType = platform === 'win32' ? 'junction' : 'dir'

  // 确保源路径的父目录存在
  const parentDir = path.dirname(sourcePath)
  if (!fs.existsSync(parentDir)) {
    fs.mkdirSync(parentDir, { recursive: true })
  }

  fs.symlinkSync(targetPath, sourcePath, linkType)
}

/** 删除链接（不删除链接指向的真实数据） */
function removeLink(linkPath) {
  if (!isLink(linkPath)) return false
  try {
    fs.unlinkSync(linkPath)
    return true
  } catch {
    return false
  }
}

/** 验证链接是否正常工作（写入测试文件） */
function verifyLink(sourcePath, targetPath) {
  try {
    const testFile = path.join(sourcePath, `.link-test-${Date.now()}.tmp`)
    fs.writeFileSync(testFile, 'verify', { encoding: 'utf-8' })

    // 检查目标端是否可见
    const targetTestFile = path.join(targetPath, path.basename(testFile))
    const visible = fs.existsSync(targetTestFile)

    // 清理测试文件
    try { fs.unlinkSync(testFile) } catch { /* ignore */ }

    return visible
  } catch {
    return false
  }
}

module.exports = {
  dirExists,
  isLink,
  getRealTarget,
  normalizePath,
  checkDirStatus,
  getDirSizeSync,
  getMtime,
  createLink,
  removeLink,
  verifyLink,
}
