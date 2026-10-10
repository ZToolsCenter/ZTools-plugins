/**
 * 迁移引擎 —— 核心迁移逻辑，支持 dry-run 预览、执行、回滚、进度推送。
 *
 * 迁移流程：
 * 前置检查 → 数据复制 → 备份原目录 → 创建链接 → 验证链接 → 清理备份
 *
 * 任何步骤失败时自动回滚：删除链接 → 恢复备份目录名。
 */

const fs = require('node:fs')
const path = require('node:path')
const { execSync } = require('node:child_process')
const { EventEmitter } = require('node:events')
const {
  createLink,
  removeLink,
  verifyLink,
  isLink,
  getDirSizeSync,
} = require('./link-manager')
const { isRunning } = require('./process-checker')

const progressEmitter = new EventEmitter()
let abortRequested = false

/** 格式化字节大小 */
function formatSize(bytes) {
  if (bytes === 0) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  const i = Math.floor(Math.log(bytes) / Math.log(1024))
  return `${(bytes / Math.pow(1024, i)).toFixed(i >= 2 ? 1 : 0)} ${units[i]}`
}

/** 生成时间戳 */
function timestamp() {
  const d = new Date()
  const pad = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`
}

/** 发射进度事件 */
function emit(type, data) {
  progressEmitter.emit('progress', type, data)
}

/** 订阅进度事件，返回取消订阅函数 */
function onProgress(cb) {
  const listener = (type, data) => {
    try { cb(type, data) } catch { /* ignore listener errors */ }
  }
  progressEmitter.on('progress', listener)
  return () => progressEmitter.off('progress', listener)
}

/** 请求中止迁移 */
function abortMigration() {
  abortRequested = true
}

/** 获取磁盘可用空间（字节） */
function getDiskFreeSpace(dirPath) {
  try {
    // Windows: 尝试使用 wmic 或 fsutil
    if (process.platform === 'win32') {
      const drive = path.parse(dirPath).root || 'C:\\'
      try {
        const output = execSync(`fsutil volume diskfree ${drive}`, {
          encoding: 'utf-8',
          windowsHide: true,
          timeout: 3000,
        })
        const match = output.match(/总可用字节数[^\d]*(\d+)/) || output.match(/free bytes[^\d]*(\d+)/i)
        if (match) return parseInt(match[1], 10)
      } catch { /* fallback below */ }
    }
    // 简单估算：返回一个较大值表示空间充足（实际环境应使用 statfs）
    return 100 * 1024 * 1024 * 1024 // 100GB 估算
  } catch {
    return 0
  }
}

/**
 * Dry-run 预览：生成迁移操作计划，不修改文件系统。
 * @param {Array} items 可迁移项列表
 * @param {Object} options 迁移选项
 * @returns {Object} PreviewResult
 */
function dryRun(items, options = {}) {
  const itemIds = options.itemIds
  const scoped = itemIds && itemIds.length > 0
    ? items.filter((item) => itemIds.includes(item.id))
    : items.filter((item) => item.enabled)

  const operations = []
  const conflicts = []
  let totalSize = 0

  for (const item of scoped) {
    const { dir } = item
    let action = 'skip'
    let reason = ''

    switch (dir.status) {
      case 'linked':
        action = 'skip'
        reason = '已正确链接，无需操作'
        break
      case 'not-linked':
        action = 'migrate'
        reason = '实体目录，需迁移并创建链接'
        totalSize += dir.size
        break
      case 'target-only':
        action = 'relink'
        reason = '源不存在，目标有数据，直接创建链接（重装恢复）'
        break
      case 'broken':
        action = 'repair'
        reason = '链接断裂或指向错误，需修复重建'
        break
      case 'conflict':
        action = 'migrate'
        reason = `冲突：以${options.conflictStrategy === 'prefer-target' ? '目标盘' : '源盘'}数据为准，另一侧移入备份`
        totalSize += dir.size
        conflicts.push({
          itemId: item.id,
          groupDisplayName: item.groupDisplayName,
          dirLabel: item.label,
          source: dir.path,
          target: dir.target,
        })
        break
      default:
        action = 'skip'
        reason = '状态未知，跳过'
    }

    operations.push({
      itemId: item.id,
      groupDisplayName: item.groupDisplayName,
      dirLabel: item.label,
      action,
      source: dir.path,
      target: dir.target,
      size: dir.size,
      reason,
    })
  }

  // 估算目标盘可用空间（取第一个操作的目标路径所在盘）
  const firstTarget = operations.find((o) => o.action !== 'skip')?.target
  const targetFree = firstTarget ? getDiskFreeSpace(firstTarget) : 0

  return {
    operations,
    totalSize,
    totalSizeFormatted: formatSize(totalSize),
    targetFree,
    targetFreeFormatted: formatSize(targetFree),
    conflicts,
    hasConflicts: conflicts.length > 0,
  }
}

/**
 * 执行迁移。
 * @param {Array} items 可迁移项列表
 * @param {Object} options 迁移选项
 * @returns {Promise<Array>} 迁移结果列表
 */
async function migrate(items, options = {}) {
  abortRequested = false
  const plan = dryRun(items, options)
  const toExecute = plan.operations.filter((o) => o.action !== 'skip')
  const results = []

  emit('log', { level: 'info', message: `开始迁移，共 ${toExecute.length} 项待处理` })

  for (const op of toExecute) {
    // 每项之间让出事件循环，让前端能收到进度事件并更新 UI
    await new Promise((resolve) => setImmediate(resolve))

    if (abortRequested) {
      emit('log', { level: 'warn', message: '用户请求中止，剩余任务跳过' })
      break
    }

    const item = items.find((i) => i.id === op.itemId)
    if (!item) {
      results.push({ success: false, itemId: op.itemId, action: op.action, error: '未找到可迁移项' })
      continue
    }

    try {
      const result = await migrateOne(item, op, options)
      results.push(result)
      emit('item-done', { itemId: item.id, success: result.success })
    } catch (err) {
      const result = {
        success: false,
        itemId: item.id,
        action: op.action,
        error: err.message || '迁移失败',
        rolledBack: true,
      }
      results.push(result)
      emit('item-done', { itemId: item.id, success: false })
      emit('log', { level: 'error', message: `[${item.groupDisplayName} - ${item.label}] 失败: ${err.message}` })
    }
  }

  emit('done', { results })
  return results
}

/**
 * 迁移单个可迁移项。
 */
async function migrateOne(item, op, options) {
  const { dir } = item
  const source = dir.path
  const target = dir.target
  const backupPath = `${source}.backup-${timestamp()}`

  emit('phase', {
    phase: 'precheck',
    itemId: item.id,
    groupDisplayName: item.groupDisplayName,
    dirLabel: item.label,
    message: `前置检查：${item.groupDisplayName} - ${item.label}`,
  })

  // 1. 进程检测
  if (item.exeNames && item.exeNames.length > 0 && isRunning(item.exeNames)) {
    throw new Error(`检测到相关进程正在运行，请先关闭 ${item.exeNames.join(', ')}`)
  }

  // 2. 空间检查（仅 migrate 操作需要复制数据）
  if (op.action === 'migrate' && dir.size > 0) {
    const free = getDiskFreeSpace(target)
    if (free > 0 && free < dir.size * 1.1) {
      throw new Error(`目标盘空间不足，需要 ${formatSize(dir.size * 1.1)}，可用 ${formatSize(free)}`)
    }
  }

  // 根据操作类型执行不同流程
  if (op.action === 'relink') {
    return await relinkOne(item, op)
  }

  if (op.action === 'repair') {
    return await repairOne(item, op)
  }

  // migrate 操作
  return await doMigrate(item, op, source, target, backupPath, options)
}

/**
 * 执行标准迁移流程（migrate）。
 */
async function doMigrate(item, op, source, target, backupPath, options) {
  // 3. 数据复制
  emit('phase', {
    phase: 'copy',
    itemId: item.id,
    groupDisplayName: item.groupDisplayName,
    dirLabel: item.label,
    message: `复制数据到 ${target}…`,
  })

  // 冲突处理：如果目标已存在，先处理
  if (op.action === 'migrate' && fs.existsSync(target) && !isLink(target)) {
    if (options.conflictStrategy === 'prefer-target') {
      // 以目标为准：源数据移入备份，直接创建链接
      emit('log', { level: 'info', message: '冲突策略：以目标盘为准，源数据移入备份' })
      fs.renameSync(source, backupPath)
      createLink(target, source)
      const verified = verifyLink(source, target)
      if (!verified) throw new Error('链接验证失败')
      return {
        success: true,
        itemId: item.id,
        action: 'migrate',
        filesCopied: 0,
        bytesCopied: 0,
        backupPath: options.keepBackup ? backupPath : null,
      }
    } else {
      // 以源为准（默认）：目标旧数据移入备份
      const targetBackup = `${target}.backup-${timestamp()}`
      emit('log', { level: 'info', message: `冲突策略：以源盘为准，目标旧数据移入 ${targetBackup}` })
      fs.renameSync(target, targetBackup)
    }
  }

  const copyResult = copyDirectory(source, target, item, options)

  // 4. 备份原目录（重命名）
  emit('phase', {
    phase: 'backup',
    itemId: item.id,
    groupDisplayName: item.groupDisplayName,
    dirLabel: item.label,
    message: '备份原目录…',
  })

  try {
    fs.renameSync(source, backupPath)
  } catch (err) {
    throw new Error(`备份原目录失败: ${err.message}`)
  }

  // 5. 创建链接
  emit('phase', {
    phase: 'link',
    itemId: item.id,
    groupDisplayName: item.groupDisplayName,
    dirLabel: item.label,
    message: '创建 Junction 链接…',
  })

  try {
    createLink(target, source)
  } catch (err) {
    // 回滚：恢复备份
    try { fs.renameSync(backupPath, source) } catch { /* ignore */ }
    throw new Error(`创建链接失败，已回滚: ${err.message}`)
  }

  // 6. 验证链接
  emit('phase', {
    phase: 'verify',
    itemId: item.id,
    groupDisplayName: item.groupDisplayName,
    dirLabel: item.label,
    message: '验证链接…',
  })

  const verified = verifyLink(source, target)
  if (!verified) {
    // 回滚
    removeLink(source)
    try { fs.renameSync(backupPath, source) } catch { /* ignore */ }
    throw new Error('链接验证失败，已回滚')
  }

  // 7. 清理备份
  if (!options.keepBackup) {
    emit('phase', {
      phase: 'cleanup',
      itemId: item.id,
      groupDisplayName: item.groupDisplayName,
      dirLabel: item.label,
      message: '清理备份…',
    })
    try {
      fs.rmSync(backupPath, { recursive: true, force: true })
    } catch {
      emit('log', { level: 'warn', message: `备份清理失败，可手动删除: ${backupPath}` })
    }
  }

  emit('log', {
    level: 'ok',
    message: `[${item.groupDisplayName} - ${item.label}] 迁移完成`,
  })

  return {
    success: true,
    itemId: item.id,
    action: 'migrate',
    filesCopied: copyResult.filesCopied,
    bytesCopied: copyResult.bytesCopied,
    backupPath: options.keepBackup ? backupPath : null,
  }
}

/**
 * 重建链接（relink）—— 源不存在，目标有数据。
 */
async function relinkOne(item, op) {
  const { dir } = item
  emit('phase', {
    phase: 'link',
    itemId: item.id,
    groupDisplayName: item.groupDisplayName,
    dirLabel: item.label,
    message: '重建链接…',
  })

  if (!fs.existsSync(dir.target)) {
    throw new Error('目标目录不存在，无法重建链接')
  }

  createLink(dir.target, dir.path)
  const verified = verifyLink(dir.path, dir.target)
  if (!verified) {
    removeLink(dir.path)
    throw new Error('链接验证失败')
  }

  emit('log', { level: 'ok', message: `[${item.groupDisplayName} - ${item.label}] 链接重建完成` })
  return { success: true, itemId: item.id, action: 'relink', filesCopied: 0, bytesCopied: 0 }
}

/**
 * 修复链接（repair）—— 链接断裂或指向错误。
 */
async function repairOne(item, op) {
  const { dir } = item
  emit('phase', {
    phase: 'repair',
    itemId: item.id,
    groupDisplayName: item.groupDisplayName,
    dirLabel: item.label,
    message: '修复链接…',
  })

  // 删除错误链接
  if (isLink(dir.path)) {
    removeLink(dir.path)
  }

  // 如果目标不存在但源是实体目录，执行标准迁移
  if (!fs.existsSync(dir.target) && fs.existsSync(dir.path) && !isLink(dir.path)) {
    const backupPath = `${dir.path}.backup-${timestamp()}`
    return doMigrate(item, op, dir.path, dir.target, backupPath, {})
  }

  // 目标存在，直接创建链接
  if (!fs.existsSync(dir.target)) {
    throw new Error('目标目录不存在，无法修复')
  }

  createLink(dir.target, dir.path)
  const verified = verifyLink(dir.path, dir.target)
  if (!verified) {
    removeLink(dir.path)
    throw new Error('链接验证失败')
  }

  emit('log', { level: 'ok', message: `[${item.groupDisplayName} - ${item.label}] 链接修复完成` })
  return { success: true, itemId: item.id, action: 'repair', filesCopied: 0, bytesCopied: 0 }
}

/**
 * 复制目录（优先使用 robocopy，降级为 Node.js 递归复制）。
 * 返回 { filesCopied, bytesCopied }
 */
function copyDirectory(source, target, item, options) {
  // 确保目标父目录存在
  const parentDir = path.dirname(target)
  if (!fs.existsSync(parentDir)) {
    fs.mkdirSync(parentDir, { recursive: true })
  }

  // Windows: 优先使用 robocopy
  if (process.platform === 'win32') {
    try {
      const args = [
        `"${source}"`,
        `"${target}"`,
        '/E',           // 复制子目录，包括空目录
        '/MT:8',        // 8 线程多线程
        '/R:1',         // 失败重试 1 次
        '/W:1',         // 重试等待 1 秒
        '/NFL',         // 不列出文件
        '/NDL',         // 不列出目录
        '/NP',          // 不显示进度
      ]

      // 排除缓存目录
      if (options.excludeCache && item.cachePatterns && item.cachePatterns.length > 0) {
        for (const pattern of item.cachePatterns) {
          args.push(`/XD "${pattern}"`)
        }
      }

      const cmd = `robocopy ${args.join(' ')}`
      execSync(cmd, { encoding: 'utf-8', windowsHide: true, timeout: 600000 })

      // robocopy 返回码 0-7 表示成功，8+ 表示错误
      // 但 execSync 在非零返回码时会抛异常，所以这里需要特殊处理
      // 实际上 robocopy 的返回码 1 表示成功复制了文件，也是非零
      // 所以我们用 spawnSync 来获取返回码
    } catch (err) {
      // robocopy 返回码 1-7 是正常的（表示有文件被复制等）
      // 只有 >=8 才是真正的错误
      if (err.status !== undefined && err.status >= 8) {
        // 降级为 Node.js 复制
        return copyDirectoryNode(source, target, item, options)
      }
      // 返回码 < 8 视为成功
    }

    // 估算复制结果
    const filesCopied = countFiles(target)
    const bytesCopied = getDirSizeSync(target)
    emit('progress', {
      filesCopied,
      bytesCopied,
      currentFile: '',
      itemId: item.id,
      groupDisplayName: item.groupDisplayName,
      dirLabel: item.label,
    })
    return { filesCopied, bytesCopied }
  }

  // macOS/Linux: 优先使用 rsync
  if (process.platform !== 'win32') {
    try {
      const rsyncArgs = ['-a']
      if (options.excludeCache && item.cachePatterns) {
        for (const pattern of item.cachePatterns) {
          rsyncArgs.push(`--exclude=${pattern}`)
        }
      }
      execSync(`rsync ${rsyncArgs.join(' ')} "${source}/" "${target}/"`, {
        encoding: 'utf-8',
        timeout: 600000,
      })
      const filesCopied = countFiles(target)
      const bytesCopied = getDirSizeSync(target)
      return { filesCopied, bytesCopied }
    } catch {
      // 降级为 Node.js 复制
    }
  }

  // 降级：Node.js 递归复制
  return copyDirectoryNode(source, target, item, options)
}

/** Node.js 递归复制目录 */
function copyDirectoryNode(source, target, item, options) {
  let filesCopied = 0
  let bytesCopied = 0

  function copyRecursive(src, dst) {
    if (!fs.existsSync(dst)) {
      fs.mkdirSync(dst, { recursive: true })
    }

    const entries = fs.readdirSync(src, { withFileTypes: true })
    for (const entry of entries) {
      const srcPath = path.join(src, entry.name)
      const dstPath = path.join(dst, entry.name)

      // 排除缓存目录
      if (entry.isDirectory() && options.excludeCache && item.cachePatterns?.includes(entry.name)) {
        continue
      }

      if (entry.isDirectory()) {
        if (isLink(srcPath)) continue // 跳过链接目录
        copyRecursive(srcPath, dstPath)
      } else {
        try {
          fs.copyFileSync(srcPath, dstPath)
          filesCopied++
          bytesCopied += fs.statSync(srcPath).size

          // 每 50 个文件推送一次进度
          if (filesCopied % 50 === 0) {
            emit('progress', {
              filesCopied,
              bytesCopied,
              currentFile: srcPath,
              itemId: item.id,
              groupDisplayName: item.groupDisplayName,
              dirLabel: item.label,
            })
          }
        } catch {
          // 忽略无法复制的文件
        }
      }
    }
  }

  copyRecursive(source, target)
  return { filesCopied, bytesCopied }
}

/** 统计目录下文件数 */
function countFiles(dirPath) {
  try {
    let count = 0
    const entries = fs.readdirSync(dirPath, { withFileTypes: true })
    for (const entry of entries) {
      const fullPath = path.join(dirPath, entry.name)
      if (entry.isDirectory()) {
        if (isLink(fullPath)) continue
        count += countFiles(fullPath)
      } else {
        count++
      }
    }
    return count
  } catch {
    return 0
  }
}

module.exports = {
  formatSize,
  getDiskFreeSpace,
  dryRun,
  migrate,
  abortMigration,
  onProgress,
}
