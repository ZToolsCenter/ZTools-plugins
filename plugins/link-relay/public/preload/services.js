/**
 * 目录迁移助手 —— preload 服务入口（Node 能力桥）。
 *
 * 新架构职责边界：
 * - 数据（分组 / 映射 / 日志）全部由前端三张 pinia 表持有并持久化，preload 不再保存任何配置，
 *   因此这里没有 config-store / preset-library / entry-resolver，也没有仪表盘缓存；
 * - 本文件只把前端传入的「迁移项」原样转交给执行层，是无状态的能力提供者：
 *   link-manager（状态检测）/ migration-engine（迁移执行）/ process-checker（进程检测）/ path-util（路径展开）。
 *
 * 迁移项形态由前端 api/migrate.toEngineItem 组装：
 *   { id, enabled, groupDisplayName, label, exeNames, cachePatterns,
 *     dir: { path, target, status(kebab), size } }
 */

const linkManager = require('./core/link-manager')
const processChecker = require('./core/process-checker')
const migrationEngine = require('./core/migration-engine')
const { expandEnv } = require('./core/path-util')

// 让出一帧，避免在 IPC 同步回调里阻塞渲染
function nextTick() {
  return new Promise((resolve) => setImmediate(resolve))
}

window.services = {
  // === 目录 / 链接 / 进程（无状态能力） ===

  checkDirStatus(source, target) {
    return linkManager.checkDirStatus(source, target)
  },

  expandEnv(p) {
    return expandEnv(p)
  },

  getDiskFreeSpace(dirPath) {
    return migrationEngine.getDiskFreeSpace(dirPath)
  },

  formatSize(bytes) {
    return migrationEngine.formatSize(bytes)
  },

  isProcessRunning(exeNames) {
    return processChecker.isAnyRunning(exeNames || [])
  },

  // === 迁移流程（items 由前端组装传入） ===

  dryRun(items, options = {}) {
    return migrationEngine.dryRun(items || [], options)
  },

  async migrate(items, options = {}) {
    await nextTick()
    return migrationEngine.migrate(items || [], options)
  },

  /** 单行重建链接：引擎依据 item.dir.status 自行判定为 relink */
  async relink(item) {
    await nextTick()
    if (!item) throw new Error('relink 缺少迁移项')
    const results = await migrationEngine.migrate([item], { itemIds: [item.id] })
    return results[0]
  },

  /** 单行修复：broken 直接重建；conflict 使用传入或默认的冲突策略 */
  async repair(item, strategy) {
    await nextTick()
    if (!item) throw new Error('repair 缺少迁移项')
    const results = await migrationEngine.migrate([item], {
      itemIds: [item.id],
      conflictStrategy: strategy || 'prefer-source',
    })
    return results[0]
  },

  abortMigration() {
    migrationEngine.abortMigration()
  },

  onProgress(cb) {
    return migrationEngine.onProgress(cb)
  },
}
