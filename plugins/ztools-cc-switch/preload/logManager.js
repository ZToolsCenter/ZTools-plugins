'use strict'

const fs = require('node:fs')
const fsp = require('node:fs/promises')
const path = require('node:path')

const LEVELS = Object.freeze({ error: 0, warn: 1, info: 2, debug: 3, trace: 4 })

function createLogManager(options = {}) {
  const dataDir = path.resolve(options.dataDir)
  const configPath = path.join(dataDir, 'log-config.json')
  const appLogPath = path.join(dataDir, 'plugin.log.jsonl')
  const requestLogPath = path.join(dataDir, 'request-logs.jsonl')
  const originals = Object.fromEntries(['error', 'warn', 'info', 'debug', 'log', 'trace'].map((name) => [name, console[name].bind(console)]))
  let queue = Promise.resolve(); let installed = false; let writes = 0; let cachedConfig = null

  function normalize(value = {}) {
    return { enabled: value.enabled !== false, level: LEVELS[value.level] === undefined ? 'info' : value.level, retentionDays: Math.min(Math.max(Number.parseInt(value.retentionDays, 10) || 30, 1), 365), maxFileSizeMb: Math.min(Math.max(Number(value.maxFileSizeMb) || 20, 1), 500), maxRequestEntries: Math.min(Math.max(Number.parseInt(value.maxRequestEntries, 10) || 50000, 1000), 1000000) }
  }
  async function getConfig() {
    if (cachedConfig) return structuredClone(cachedConfig)
    try { cachedConfig = normalize(JSON.parse(await fsp.readFile(configPath, 'utf8'))) }
    catch (error) { if (error.code !== 'ENOENT') originals.warn('[cc-switch] 日志配置读取失败，使用默认值:', error.message); cachedConfig = normalize() }
    return structuredClone(cachedConfig)
  }
  async function saveConfig(value) {
    const config = normalize(value); await fsp.mkdir(dataDir, { recursive: true, mode: 0o700 }); const temp = `${configPath}.${process.pid}.${Date.now()}.tmp`; await fsp.writeFile(temp, `${JSON.stringify(config, null, 2)}\n`, { mode: 0o600 }); await fsp.rename(temp, configPath); cachedConfig = config; await maintain(); return structuredClone(config)
  }
  function redact(value) { return String(value).replace(/Bearer\s+[A-Za-z0-9._~+\/-]+/gi, 'Bearer [REDACTED]').replace(/(authorization|api[-_ ]?key|token|secret|password)(["'\s:=]+)([^\s,"'}]+)/gi, '$1$2[REDACTED]').replace(/\bsk-[A-Za-z0-9_-]{8,}\b/g, 'sk-[REDACTED]').replace(/https?:\/\/[^\s/@:]+:[^\s/@]+@/gi, (match) => match.replace(/\/\/.*@/, '//[REDACTED]@')) }
  function formatArg(value) { if (value instanceof Error) return redact(value.stack || value.message); if (typeof value === 'string') return redact(value); try { return redact(JSON.stringify(value)) } catch { return redact(value) } }
  async function rotateAppLog(config) {
    let stat; try { stat = await fsp.stat(appLogPath) } catch (error) { if (error.code === 'ENOENT') return; throw error }
    if (stat.size < config.maxFileSizeMb * 1024 * 1024) return
    await fsp.rename(appLogPath, `${appLogPath}.${Date.now()}.bak`)
  }
  function append(level, args) {
    const first = typeof args[0] === 'string' ? args[0] : ''
    if (!first.includes('[cc-switch]')) return
    queue = queue.then(async () => {
      const config = await getConfig(); if (!config.enabled || LEVELS[level] > LEVELS[config.level]) return
      await fsp.mkdir(dataDir, { recursive: true, mode: 0o700 }); if (++writes % 100 === 1) await rotateAppLog(config)
      const entry = { ts: new Date().toISOString(), level, message: args.map(formatArg).join(' ').slice(0, 16000) }
      await fsp.appendFile(appLogPath, `${JSON.stringify(entry)}\n`, { mode: 0o600 })
    }).catch((error) => originals.warn('[cc-switch] 写入宿主日志失败:', error.message))
  }
  function install() {
    if (installed) return; installed = true
    for (const [name, original] of Object.entries(originals)) console[name] = (...args) => { original(...args); append(name === 'log' ? 'info' : name, args) }
  }
  function uninstall() { if (!installed) return; for (const [name, original] of Object.entries(originals)) console[name] = original; installed = false }
  async function compactRequestLogs(config) {
    let text; try { text = await fsp.readFile(requestLogPath, 'utf8') } catch (error) { if (error.code === 'ENOENT') return { changed: false, kept: 0 }; throw error }
    const cutoff = Date.now() - config.retentionDays * 86400000; const lines = text.split(/\r?\n/).filter(Boolean); const kept = []
    for (const line of lines) { try { const value = JSON.parse(line); if (Number(value.createdAt) >= cutoff) kept.push(line) } catch {} }
    const limited = kept.slice(-config.maxRequestEntries); const sizeExceeded = Buffer.byteLength(text) > config.maxFileSizeMb * 1024 * 1024
    if (!sizeExceeded && limited.length === lines.length) return { changed: false, kept: limited.length }
    const backupPath = `${requestLogPath}.${Date.now()}.bak`; const temp = `${requestLogPath}.${process.pid}.${Date.now()}.tmp`; await fsp.copyFile(requestLogPath, backupPath); await fsp.writeFile(temp, limited.length ? `${limited.join('\n')}\n` : '', { mode: 0o600 }); await fsp.rename(temp, requestLogPath)
    return { changed: true, kept: limited.length, removed: lines.length - limited.length, backupPath }
  }
  async function cleanupBackups(config) {
    let entries; try { entries = await fsp.readdir(dataDir, { withFileTypes: true }) } catch (error) { if (error.code === 'ENOENT') return; throw error }
    const cutoff = Date.now() - config.retentionDays * 86400000
    for (const entry of entries) if (entry.isFile() && /\.(?:jsonl|log\.jsonl)\.\d+\.bak$/.test(entry.name)) { const file = path.join(dataDir, entry.name); const stat = await fsp.stat(file); if (stat.mtimeMs < cutoff) await fsp.rm(file) }
  }
  async function maintain() { const config = await getConfig(); await rotateAppLog(config); const result = await compactRequestLogs(config); await cleanupBackups(config); return result }
  async function listFiles() { let entries; try { entries = await fsp.readdir(dataDir, { withFileTypes: true }) } catch (error) { if (error.code === 'ENOENT') return []; throw error }; const rows = []; for (const entry of entries) if (entry.isFile() && (/\.log\.jsonl(?:\.\d+\.bak)?$/.test(entry.name) || /-logs\.jsonl(?:\.\d+\.bak)?$/.test(entry.name))) { const stat = await fsp.stat(path.join(dataDir, entry.name)); rows.push({ name: entry.name, sizeBytes: stat.size, modifiedAt: stat.mtime.toISOString() }) } return rows.sort((a, b) => b.modifiedAt.localeCompare(a.modifiedAt)) }
  async function clearLogs() { const moved = []; for (const file of [appLogPath, requestLogPath, path.join(dataDir, 'connectivity-check-logs.jsonl')]) { try { const backupPath = `${file}.${Date.now()}.bak`; await fsp.rename(file, backupPath); moved.push(path.basename(backupPath)) } catch (error) { if (error.code !== 'ENOENT') throw error } } return { cleared: moved.length, backups: moved } }
  return { install, uninstall, getConfig, saveConfig, maintain, listFiles, clearLogs, flush: () => queue, getDataDir: () => dataDir, _internal: { normalize, redact, compactRequestLogs } }
}

module.exports = { LEVELS, createLogManager }
