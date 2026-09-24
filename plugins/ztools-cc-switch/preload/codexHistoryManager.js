'use strict'

const fs = require('node:fs')
const fsp = require('node:fs/promises')
const path = require('node:path')
const crypto = require('node:crypto')

const SOURCE_BUCKET = 'openai'
const TARGET_BUCKET = 'ztools_cc_switch'

function createCodexHistoryManager(options = {}) {
  const homeDir = path.resolve(options.homeDir)
  const dataDir = path.resolve(options.dataDir)
  const sidecar = options.sidecar
  const codexDir = path.resolve(options.codexDir || process.env.CODEX_HOME || path.join(homeDir, '.codex'))
  const configPath = path.join(codexDir, 'config.toml')
  const settingsPath = path.join(dataDir, 'codex-history-unify.json')
  const backupParent = path.join(dataDir, 'backups', 'codex-official-history-unify-v1')
  const restoreParent = path.join(dataDir, 'backups', 'codex-official-history-unify-restore-v1')
  let operation = Promise.resolve()

  async function readText(file, fallback = '') { try { return await fsp.readFile(file, 'utf8') } catch (error) { if (error.code === 'ENOENT') return fallback; throw error } }
  async function readJson(file, fallback) { try { return JSON.parse(await fsp.readFile(file, 'utf8')) } catch (error) { if (error.code === 'ENOENT') return fallback; throw error } }
  async function atomicWrite(file, content, backup = true) {
    await fsp.mkdir(path.dirname(file), { recursive: true, mode: 0o700 })
    if (backup && fs.existsSync(file)) await fsp.copyFile(file, `${file}.bak`)
    const temp = `${file}.${process.pid}.${Date.now()}.${crypto.randomBytes(3).toString('hex')}.tmp`
    await fsp.writeFile(temp, content, { mode: 0o600 }); await fsp.rename(temp, file)
  }
  async function writeJson(file, value) { await atomicWrite(file, `${JSON.stringify(value, null, 2)}\n`) }
  function canonical(value) { try { return fs.realpathSync(value) } catch { return path.resolve(value) } }
  function generation(root) { return path.join(root, `${new Date().toISOString().replace(/[:.]/g, '-')}-${crypto.randomBytes(3).toString('hex')}`) }

  async function collectJsonl(root, depth = 0, output = []) {
    if (depth > 10) return output
    let entries; try { entries = await fsp.readdir(root, { withFileTypes: true }) } catch { return output }
    for (const entry of entries) {
      if (entry.isSymbolicLink()) continue
      const target = path.join(root, entry.name)
      if (entry.isDirectory()) await collectJsonl(target, depth + 1, output)
      else if (entry.isFile() && entry.name.endsWith('.jsonl')) output.push(target)
    }
    return output
  }

  function rewriteSessionLines(content, source, target, allowedIds = null) {
    const changedIds = []
    const lines = String(content).split(/\r?\n/).map((line) => {
      if (!line.includes('"session_meta"') || !line.includes('"model_provider"')) return line
      try {
        const value = JSON.parse(line); const payload = value?.type === 'session_meta' ? value.payload : null
        if (!payload || payload.model_provider !== source || !payload.id || (allowedIds && !allowedIds.has(String(payload.id)))) return line
        payload.model_provider = target; changedIds.push(String(payload.id)); return JSON.stringify(value)
      } catch { return line }
    })
    return { content: lines.join('\n'), changedIds }
  }

  async function migrateJsonl(source, target, backupRoot, allowedIds = null) {
    const ids = []; let files = 0
    for (const root of [path.join(codexDir, 'sessions'), path.join(codexDir, 'archived_sessions')]) {
      for (const file of await collectJsonl(root)) {
        const original = await fsp.readFile(file, 'utf8'); const rewritten = rewriteSessionLines(original, source, target, allowedIds)
        if (!rewritten.changedIds.length) continue
        const relative = path.relative(codexDir, file)
        if (relative.startsWith('..') || path.isAbsolute(relative)) throw new Error('Codex 历史路径越界')
        const backup = path.join(backupRoot, 'jsonl', relative); await fsp.mkdir(path.dirname(backup), { recursive: true, mode: 0o700 }); await fsp.copyFile(file, backup)
        await atomicWrite(file, rewritten.content, false); ids.push(...rewritten.changedIds); files += 1
      }
    }
    return { ids: [...new Set(ids)], files }
  }

  async function stateDbPaths(configText) {
    const paths = [path.join(codexDir, 'state_5.sqlite')]
    const match = /^\s*sqlite_home\s*=\s*(["'])(.*?)\1\s*$/m.exec(configText)
    const override = process.env.CODEX_SQLITE_HOME || match?.[2]
    if (override) { const candidate = path.join(path.resolve(override.replace(/^~(?=\/)/, homeDir)), 'state_5.sqlite'); if (!paths.includes(candidate)) paths.push(candidate) }
    return paths
  }

  function routesSharedBucket(config) { return /^\s*model_provider\s*=\s*["']ztools_cc_switch["']\s*$/m.test(config) }
  async function loadSettings() { return readJson(settingsPath, { enabled: false, migrateExisting: false, migratedForDir: '', lastMigration: null }) }
  async function saveSettings(value) { await writeJson(settingsPath, value); return value }
  async function ledgersForCurrentDir() {
    const ids = new Set(); const threadIds = new Set(); let found = false
    let entries; try { entries = await fsp.readdir(backupParent, { withFileTypes: true }) } catch { return { ids, threadIds, found } }
    const key = canonical(codexDir)
    for (const entry of entries) {
      if (!entry.isDirectory()) continue
      const ledger = await readJson(path.join(backupParent, entry.name, 'ledger.json'), null)
      if (!ledger || ledger.codexDir !== key) continue
      found = true; for (const id of ledger.sessionIds || []) ids.add(id); for (const id of ledger.threadIds || []) threadIds.add(id)
    }
    return { ids, threadIds, found }
  }

  async function doEnable(migrateExisting = false) {
    if (!sidecar?.isAvailable()) throw new Error('Codex History Unify 需要 Rust sidecar')
    const current = await readText(configPath)
    const updated = await sidecar.updateCodexHistoryToml(current, true, TARGET_BUCKET)
    if (updated.changed) await atomicWrite(configPath, updated.configToml)
    const effective = updated.configToml
    const settings = await loadSettings(); settings.enabled = true; settings.migrateExisting = Boolean(migrateExisting)
    const dirKey = canonical(codexDir)
    let outcome = { migratedJsonlFiles: 0, migratedStateRows: 0, skippedReason: null }
    if (migrateExisting && settings.migratedForDir !== dirKey) {
      if (!routesSharedBucket(effective)) outcome.skippedReason = 'live_not_unified'
      else {
        const root = generation(backupParent); const jsonl = await migrateJsonl(SOURCE_BUCKET, TARGET_BUCKET, root)
        const sqlite = await sidecar.updateCodexStateProviders({ dbPaths: await stateDbPaths(effective), sourceProvider: SOURCE_BUCKET, targetProvider: TARGET_BUCKET, threadIds: [], filterThreadIds: false, backupDir: path.join(root, 'state') })
        await writeJson(path.join(root, 'ledger.json'), { codexDir: dirKey, sessionIds: jsonl.ids, threadIds: sqlite.threadIds, createdAt: Date.now() })
        settings.migratedForDir = dirKey; settings.lastMigration = { migratedJsonlFiles: jsonl.files, migratedStateRows: sqlite.changedRows, at: Date.now() }
        outcome = { migratedJsonlFiles: jsonl.files, migratedStateRows: sqlite.changedRows, skippedReason: null }
      }
    } else if (migrateExisting) outcome.skippedReason = 'already_migrated'
    await saveSettings(settings)
    return { enabled: true, configChanged: Boolean(updated.changed), configReason: updated.reason || null, ...outcome }
  }

  async function doDisable(restoreBackup = false) {
    if (!sidecar?.isAvailable()) throw new Error('Codex History Unify 需要 Rust sidecar')
    const current = await readText(configPath); const updated = await sidecar.updateCodexHistoryToml(current, false, TARGET_BUCKET)
    if (updated.changed) await atomicWrite(configPath, updated.configToml)
    let restoredJsonlFiles = 0; let restoredStateRows = 0; let skippedReason = null
    if (restoreBackup) {
      const ledger = await ledgersForCurrentDir()
      if (!ledger.found) skippedReason = 'no_backup_ledger'
      else {
        const root = generation(restoreParent); const jsonl = await migrateJsonl(TARGET_BUCKET, SOURCE_BUCKET, root, ledger.ids)
        const sqlite = await sidecar.updateCodexStateProviders({ dbPaths: await stateDbPaths(updated.configToml), sourceProvider: TARGET_BUCKET, targetProvider: SOURCE_BUCKET, threadIds: [...ledger.threadIds], filterThreadIds: true, backupDir: path.join(root, 'state') })
        restoredJsonlFiles = jsonl.files; restoredStateRows = sqlite.changedRows
        if (!restoredJsonlFiles && !restoredStateRows) skippedReason = 'nothing_to_restore'
      }
    }
    const settings = await loadSettings(); settings.enabled = false; settings.migrateExisting = false; settings.migratedForDir = ''
    await saveSettings(settings)
    return { enabled: false, configChanged: Boolean(updated.changed), restoredJsonlFiles, restoredStateRows, skippedReason }
  }

  function serialize(task) { const next = operation.then(task, task); operation = next.catch(() => {}); return next }
  async function status() { const settings = await loadSettings(); const ledger = await ledgersForCurrentDir(); return { ...settings, hasBackup: ledger.found, codexDir, configPath, liveUnified: routesSharedBucket(await readText(configPath)) } }
  return { getStatus: status, enable: (options = {}) => serialize(() => doEnable(Boolean(options.migrateExisting))), disable: (options = {}) => serialize(() => doDisable(Boolean(options.restoreBackup))), ensure: () => serialize(async () => (await loadSettings()).enabled ? doEnable((await loadSettings()).migrateExisting) : status()), _internal: { rewriteSessionLines, stateDbPaths } }
}

module.exports = { SOURCE_BUCKET, TARGET_BUCKET, createCodexHistoryManager }
