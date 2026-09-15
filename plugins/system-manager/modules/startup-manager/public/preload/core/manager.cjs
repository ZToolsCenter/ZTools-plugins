'use strict'

const crypto = require('node:crypto')
const nodeFs = require('node:fs/promises')
const os = require('node:os')
const path = require('node:path')
const defaultRunner = require('./runner.cjs')
const { readState, stateEvidence } = require('./file-state.cjs')
const { publicItem } = require('./model.cjs')

const SNAPSHOT_TTL_MS = 10 * 60 * 1000
const MAX_SNAPSHOTS = 3
// The UI exposes only the latest undo action. Keeping older items alive can
// retain a complete platform origin proof, so the journal is intentionally
// limited to the one operation the user can still invoke.
const MAX_OPERATIONS = 1
const EXCLUSIVE_LOCK = 'startup-manager-exclusive'
const JOURNAL_VERSION = 1
const JOURNAL_FILE = '.ztools/system-manager/startup-rollback.json'

function errorWithCode(message, code) {
  const error = new Error(message)
  error.code = code
  return error
}

function createJournalStore(options, home, fileSystem) {
  const storage = options.storage || options.journalStore
  const getStored = storage && (storage.get || storage.getItem)
  const setStored = storage && (storage.set || storage.setItem)
  const removeStored = storage && (storage.remove || storage.removeItem)
  const filePath = options.journalPath || path.join(home, JOURNAL_FILE)
  async function read() {
    if (typeof getStored === 'function') {
      const value = await getStored.call(storage, 'startup-rollback-v1')
      if (!value) return null
      return typeof value === 'string' ? JSON.parse(value) : value
    }
    try {
      const value = await fileSystem.readFile(filePath, 'utf8')
      return JSON.parse(String(value))
    } catch { return null }
  }
  async function write(value) {
    const serialized = JSON.stringify(value)
    if (typeof setStored === 'function') {
      await setStored.call(storage, 'startup-rollback-v1', serialized)
      return
    }
    const directory = path.dirname(filePath)
    if (typeof fileSystem.mkdir === 'function') await fileSystem.mkdir(directory, { recursive: true, mode: 0o700 })
    const temp = `${filePath}.tmp-${process.pid}-${crypto.randomBytes(4).toString('hex')}`
    try {
      await fileSystem.writeFile(temp, serialized, { encoding: 'utf8', mode: 0o600, flag: 'wx' })
      if (typeof fileSystem.rename === 'function') await fileSystem.rename(temp, filePath)
      else await fileSystem.writeFile(filePath, serialized, { encoding: 'utf8', mode: 0o600 })
    } finally { try { if (typeof fileSystem.unlink === 'function') await fileSystem.unlink(temp) } catch {} }
  }
  async function clear() {
    if (storage) {
      if (typeof removeStored === 'function') await removeStored.call(storage, 'startup-rollback-v1')
      else if (typeof setStored === 'function') await setStored.call(storage, 'startup-rollback-v1', null)
      return
    }
    try { await fileSystem.unlink(filePath) } catch {}
  }
  return Object.freeze({ read, write, clear, filePath })
}

function serializable(value) {
  try { return JSON.parse(JSON.stringify(value)) } catch { return null }
}

function createManager(options = {}) {
  const platform = options.platform || process.platform
  const adapter = options.adapter || require(`../adapters/${platform}.cjs`)
  const home = options.home || os.homedir()
  const deps = { runner: options.runner || defaultRunner, fs: options.fs || nodeFs, home, uid: options.uid, powershell: options.powershell, locations: options.locations, desktopLocations: options.desktopLocations, toolPaths: options.toolPaths }
  const clock = options.clock || Date.now
  const journalStore = createJournalStore(options, home, deps.fs)
  const snapshots = new Map()
  const operations = new Map()
  const locks = new Map()
  let scanFlight = null
  let journalLoaded = false
  let persistedJournal = null
  let shuttingDown = false

  function trim(map, limit) {
    while (map.size > limit) map.delete(map.keys().next().value)
  }

  async function loadJournal() {
    if (journalLoaded) return persistedJournal
    journalLoaded = true
    const value = await journalStore.read()
    if (value && value.version === JOURNAL_VERSION && value.operationId && value.itemKey) persistedJournal = value
    return persistedJournal
  }

  async function saveJournal(value) {
    persistedJournal = value
    await journalStore.write(value)
  }

  async function clearJournal() {
    persistedJournal = null
    await journalStore.clear()
  }

  function stateMatches(item, enabled) {
    return typeof item.enabled === 'boolean' && item.enabled === enabled
  }

  async function reconcileJournal(items, warnings) {
    const journal = await loadJournal()
    if (!journal) return
    const createdAt = Number.isFinite(journal.createdAt) ? journal.createdAt : Date.parse(journal.createdAt || '')
    if (!Number.isFinite(createdAt) || clock() - createdAt > SNAPSHOT_TTL_MS) {
      await clearJournal()
      warnings.push('上次启动项撤销记录已过期，已清理；请重新扫描后操作')
      return
    }
    const item = items.find((candidate) => candidate.key === journal.itemKey)
    if (!item) {
      warnings.push('检测到上次启动项变更记录，但当前扫描未找到对应项目；记录已保留以便后续核对')
      return
    }
    if (stateMatches(item, journal.before && journal.before.enabled)) {
      await clearJournal()
      return
    }
    if (!stateMatches(item, journal.enabled)) {
      warnings.push('上次启动项变更状态无法确认，请刷新后人工核对；撤销记录暂不可用')
      return
    }
    let rollback = journal.rollback || null
    // If the process stopped between the adapter mutation and the journal
    // completion, reconstruct the minimal rollback proof from the pre-write
    // snapshot and the authoritative post-write scan.
    if (!rollback) {
      if (item.kind === 'desktop-autostart' && journal.beforeContent) {
        rollback = { kind: 'linux-desktop', content: journal.beforeContent, evidence: stateEvidence(item.internal && item.internal.evidence) }
      } else if (item.kind === 'systemd-unit' || item.kind === 'scheduled-task') {
        rollback = { kind: item.kind === 'systemd-unit' ? 'linux-systemd' : 'win-task', enabled: Boolean(journal.before && journal.before.enabled) }
      }
    }
    if (!rollback) {
      warnings.push('上次启动项变更已发生但缺少安全撤销凭据，请人工核对')
      return
    }
    const operationId = journal.operationId
    operations.clear()
    operations.set(operationId, { item, itemId: journal.itemId || null, before: journal.before || {}, rollback, createdAt: journal.createdAt || clock() })
    trim(operations, MAX_OPERATIONS)
    persistedJournal = { ...journal, status: 'ready', rollback: serializable(rollback) }
    try { await journalStore.write(persistedJournal) } catch {}
    warnings.push('已恢复上次启动项变更的撤销记录，可继续撤销')
    return { operationId, createdAt: journal.createdAt || clock() }
  }

  async function scan() {
    if (scanFlight) return scanFlight
    scanFlight = withLock(EXCLUSIVE_LOCK, async () => {
      const result = await adapter.scan(deps)
      const snapshotId = crypto.randomUUID()
      const createdAt = clock()
      const byId = new Map()
      const items = result.items.map((item) => {
        const id = crypto.randomUUID()
        byId.set(id, item)
        return publicItem(item, id)
      })
      snapshots.set(snapshotId, { createdAt, byId, publicItems: items })
      trim(snapshots, MAX_SNAPSHOTS)
      const warnings = (result.warnings || []).slice(0, 100)
      const recovered = await reconcileJournal([...byId.values()], warnings)
      return {
        snapshotId,
        platform,
        generatedAt: new Date(createdAt).toISOString(),
        items,
        warnings: warnings.slice(0, 100),
        ...(recovered ? { recoveredOperationId: recovered.operationId, recoveredOperationCreatedAt: recovered.createdAt } : {}),
      }
    })
    try { return await scanFlight } finally { scanFlight = null }
  }

  function resolveItem(snapshotId, itemId) {
    if (typeof snapshotId !== 'string' || typeof itemId !== 'string') throw errorWithCode('请求参数无效', 'INVALID_REQUEST')
    const snapshot = snapshots.get(snapshotId)
    if (!snapshot || clock() - snapshot.createdAt > SNAPSHOT_TTL_MS) throw errorWithCode('扫描结果已过期，请刷新后重试', 'SNAPSHOT_EXPIRED')
    const item = snapshot.byId.get(itemId)
    if (!item) throw errorWithCode('启动项不存在或不属于该扫描结果', 'ITEM_NOT_FOUND')
    return { snapshot, item }
  }

  async function withLock(key, task) {
    if (locks.has(key)) throw errorWithCode('该项目正在执行其他操作', 'ITEM_BUSY')
    const marker = Symbol(key)
    locks.set(key, marker)
    try { return await task() } finally { if (locks.get(key) === marker) locks.delete(key) }
  }

  async function refreshItem(item, fallbackState) {
    try {
      const result = await adapter.scan(deps)
      const fresh = result.items.find((candidate) => candidate.key === item.key)
      if (fresh) {
        Object.assign(item, fresh)
        return item
      }
    } catch {
      // Adapters verify a mutation before returning. Preserve that verified
      // state so a temporary rescan failure cannot discard the undo journal.
    }
    if (fallbackState) {
      if (typeof fallbackState.enabled === 'boolean') item.enabled = fallbackState.enabled
      if (typeof fallbackState.running === 'boolean' || fallbackState.running === null) item.running = fallbackState.running
    }
    return item
  }

  async function setEnabled(request = {}) {
    if (shuttingDown) throw errorWithCode('插件正在退出，暂不接受新的启动项写入', 'SHUTTING_DOWN')
    if (typeof request.enabled !== 'boolean') throw errorWithCode('enabled 必须为布尔值', 'INVALID_REQUEST')
    const { item } = resolveItem(request.snapshotId, request.itemId)
    if (!item.action.canToggle || item.scope !== 'user') throw errorWithCode(item.action.reason || '该项目仅支持查看', 'READ_ONLY')
    return withLock(EXCLUSIVE_LOCK, async () => {
      if (shuttingDown) throw errorWithCode('插件正在退出，暂不接受新的启动项写入', 'SHUTTING_DOWN')
      if (item.enabled === request.enabled) return { changed: false, item: publicItem(item, request.itemId), operationId: null }
      const before = { enabled: item.enabled, running: item.running }
      let beforeContent = null
      if (item.kind === 'desktop-autostart' && item.internal && item.internal.file) {
        try { beforeContent = (await readState(item.internal.file, deps.fs)).content.toString('base64') } catch {
          throw errorWithCode('无法在写入前保存启动项原始内容', 'STATE_UNKNOWN')
        }
      }
      const operationId = crypto.randomUUID()
      await saveJournal({ version: JOURNAL_VERSION, status: 'pending', operationId, itemId: request.itemId, itemKey: item.key, enabled: request.enabled, before, beforeContent, createdAt: clock() })
      let rollback
      try {
        rollback = await adapter.applyEnabled(item, request.enabled, deps)
      } catch (error) {
        // Adapters verify and roll back on their own failure. Keep an unknown
        // pending record when they cannot prove that, so the next session can
        // reconcile instead of silently losing the user's undo path.
        if (error && error.rollbackRestored === true) await clearJournal()
        throw error
      }
      await refreshItem(item, rollback.state || { enabled: request.enabled, running: request.enabled ? item.running : false })
      await saveJournal({ version: JOURNAL_VERSION, status: 'ready', operationId, itemId: request.itemId, itemKey: item.key, enabled: request.enabled, before, beforeContent, rollback: serializable(rollback), createdAt: clock() })
      operations.clear()
      operations.set(operationId, { item, itemId: request.itemId, before, rollback, createdAt: clock() })
      trim(operations, MAX_OPERATIONS)
      return { changed: true, operationId, item: publicItem(item, request.itemId) }
    })
  }

  async function undo(request = {}) {
    if (shuttingDown) throw errorWithCode('插件正在退出，暂不接受新的启动项写入', 'SHUTTING_DOWN')
    if (typeof request.operationId !== 'string') throw errorWithCode('operationId 无效', 'INVALID_REQUEST')
    const operation = operations.get(request.operationId)
    if (!operation) throw errorWithCode('撤销记录不存在或已使用', 'OPERATION_NOT_FOUND')
    if (clock() - operation.createdAt > SNAPSHOT_TTL_MS) { operations.delete(request.operationId); throw errorWithCode('撤销记录已过期', 'OPERATION_EXPIRED') }
    return withLock(EXCLUSIVE_LOCK, async () => {
      if (shuttingDown) throw errorWithCode('插件正在退出，暂不接受新的启动项写入', 'SHUTTING_DOWN')
      const result = await adapter.undo(operation.item, operation.rollback, deps)
      await refreshItem(operation.item, result && result.state ? result.state : operation.before)
      operations.delete(request.operationId)
      await clearJournal()
      return { restored: true, item: publicItem(operation.item, operation.itemId) }
    })
  }

  async function shutdown() {
    shuttingDown = true
    const started = Date.now()
    while (locks.size && Date.now() - started < 200) await new Promise((resolve) => setTimeout(resolve, 5))
    return { state: 'shutdown', drained: locks.size === 0 }
  }

  return { scan, setEnabled, undo, shutdown, _state: { snapshots, operations, locks, get shuttingDown() { return shuttingDown } } }
}

module.exports = { JOURNAL_FILE, JOURNAL_VERSION, MAX_OPERATIONS, MAX_SNAPSHOTS, SNAPSHOT_TTL_MS, createManager }
