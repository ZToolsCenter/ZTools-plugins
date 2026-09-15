'use strict'

const fs = require('node:fs')
const fsp = require('node:fs/promises')
const path = require('node:path')
const readline = require('node:readline')
const crypto = require('node:crypto')
const { execFile: execFileCallback } = require('node:child_process')
const { promisify } = require('node:util')

const execFile = promisify(execFileCallback)
const MAX_FILES = 10000
const MAX_JSON_BYTES = 64 * 1024 * 1024

function timestamp(value) {
  if (value === undefined || value === null) return Date.now()
  if (typeof value === 'number') return value < 1e12 ? value * 1000 : value
  const parsed = Date.parse(String(value))
  return Number.isFinite(parsed) ? parsed : Date.now()
}
function count(value) { const number = Number(value); return Number.isFinite(number) && number > 0 ? Math.floor(number) : 0 }
function digest(...values) { return crypto.createHash('sha256').update(values.map((value) => String(value ?? '')).join('\0')).digest('hex').slice(0, 24) }
function baseEntry(values) {
  return {
    id: values.id, createdAt: timestamp(values.createdAt), client: values.client,
    providerId: values.providerId, providerName: values.providerName, model: String(values.model || 'unknown'),
    inputTokens: count(values.inputTokens), outputTokens: count(values.outputTokens), cacheReadTokens: count(values.cacheReadTokens),
    cacheCreationTokens: count(values.cacheCreationTokens), latencyMs: 0, firstTokenMs: null, statusCode: 200,
    streaming: true, error: null, dataSource: values.dataSource, sessionId: values.sessionId || null,
    totalCostUsd: values.totalCostUsd || '0'
  }
}

async function collectFiles(root, predicate, output = [], depth = 0) {
  if (depth > 8 || output.length >= MAX_FILES) return output
  let entries
  try { entries = await fsp.readdir(root, { withFileTypes: true }) } catch (error) { if (error.code === 'ENOENT') return output; throw error }
  for (const entry of entries) {
    if (output.length >= MAX_FILES) break
    if (entry.isSymbolicLink()) continue
    const target = path.join(root, entry.name)
    if (entry.isDirectory()) await collectFiles(target, predicate, output, depth + 1)
    else if (entry.isFile() && predicate(target, entry.name)) output.push(target)
  }
  return output
}

async function readJson(file) {
  const stat = await fsp.lstat(file)
  if (!stat.isFile() || stat.isSymbolicLink()) throw new Error('用量来源不是普通文件')
  if (stat.size > MAX_JSON_BYTES) throw new Error('JSON 会话文件超过 64 MB')
  return JSON.parse(await fsp.readFile(file, 'utf8'))
}

async function readJsonLines(file) {
  const stat = await fsp.lstat(file)
  if (!stat.isFile() || stat.isSymbolicLink()) throw new Error('用量来源不是普通文件')
  const rows = []
  const stream = fs.createReadStream(file, { encoding: 'utf8' })
  const lines = readline.createInterface({ input: stream, crlfDelay: Infinity })
  try {
    for await (const line of lines) {
      if (!line.trim()) continue
      try { rows.push(JSON.parse(line)) } catch { /* 上游同样跳过单行损坏，不中断其他会话。 */ }
    }
  } finally { lines.close(); stream.destroy() }
  return rows
}

function parseClaude(rows) {
  const messages = new Map()
  for (const row of rows) {
    if (row.type !== 'assistant' || !row.message?.usage) continue
    const usage = row.message.usage
    const messageId = row.message.id || `${row.sessionId || 'unknown'}:${row.timestamp || messages.size}`
    const parsed = baseEntry({
      id: `session:${messageId}`, createdAt: row.timestamp, client: 'claude', providerId: '_session', providerName: 'Claude (Session)',
      model: row.message.model, inputTokens: usage.input_tokens, outputTokens: usage.output_tokens,
      cacheReadTokens: usage.cache_read_input_tokens, cacheCreationTokens: usage.cache_creation_input_tokens,
      dataSource: 'session_log', sessionId: row.sessionId
    })
    const current = messages.get(messageId)
    if (!current || (row.message.stop_reason && !current.stopReason) || parsed.outputTokens > current.entry.outputTokens) {
      messages.set(messageId, { entry: parsed, stopReason: row.message.stop_reason || null })
    }
  }
  return [...messages.values()].map((item) => item.entry)
}

function codexCounters(value) {
  if (!value || typeof value !== 'object') return null
  return { input: count(value.input_tokens), cached: count(value.cached_input_tokens ?? value.cache_read_input_tokens), output: count(value.output_tokens) }
}
function codexDelta(previous, current) {
  if (!previous) return current
  return { input: Math.max(0, current.input - previous.input), cached: Math.max(0, current.cached - previous.cached), output: Math.max(0, current.output - previous.output) }
}
function parseCodex(rows) {
  let sessionId = null; let model = 'unknown'; let subagent = false; let previous = null; let sequence = 0
  const entries = []
  for (const row of rows) {
    if (row.type === 'session_meta') {
      sessionId ||= row.payload?.id || null
      subagent ||= Boolean(row.payload?.source?.subagent)
    }
    if (row.type === 'turn_context') model = row.payload?.model || row.payload?.info?.model || model
    if (row.type !== 'event_msg' || row.payload?.type !== 'token_count' || !row.payload.info) continue
    const info = row.payload.info
    model = info.model || info.model_name || row.payload.model || model
    const total = codexCounters(info.total_token_usage)
    const last = codexCounters(info.last_token_usage)
    const current = total || last
    if (!current) continue
    const delta = total ? codexDelta(previous, current) : current
    if (total) previous = current
    delta.cached = Math.min(delta.cached, delta.input)
    if (!(delta.input || delta.cached || delta.output)) continue
    sequence += 1
    const signature = total || last
    entries.push(baseEntry({
      id: `codex_session:${digest(sessionId, row.timestamp, signature.input, signature.cached, signature.output, sequence)}`,
      createdAt: row.timestamp, client: 'codex', providerId: '_codex_session', providerName: 'Codex (Session)', model,
      inputTokens: delta.input, outputTokens: delta.output, cacheReadTokens: delta.cached, cacheCreationTokens: 0,
      dataSource: 'codex_session', sessionId
    }))
  }
  return subagent ? [] : entries
}

function parseGemini(value) {
  const sessionId = value.sessionId || 'unknown'
  return (Array.isArray(value.messages) ? value.messages : []).flatMap((message, index) => {
    if (message.type !== 'gemini' || !message.tokens) return []
    const input = count(message.tokens.input); const output = count(message.tokens.output) + count(message.tokens.thoughts)
    const cached = count(message.tokens.cached)
    if (!(input || output || cached)) return []
    const messageId = message.id || digest(sessionId, message.timestamp, index)
    return [baseEntry({
      id: `gemini_session:${sessionId}:${messageId}`, createdAt: message.timestamp, client: 'gemini',
      providerId: '_gemini_session', providerName: 'Gemini (Session)', model: message.model,
      inputTokens: input, outputTokens: output, cacheReadTokens: cached, cacheCreationTokens: 0,
      dataSource: 'gemini_session', sessionId
    })]
  })
}

function parseOpenCodeMessage(value, messageId, sessionId) {
  if (value?.role !== 'assistant' || !value.tokens || value.time?.completed === undefined) return null
  const tokens = value.tokens
  const input = count(tokens.input); const output = count(tokens.output) + count(tokens.reasoning)
  const cacheRead = count(tokens.cache?.read); const cacheCreation = count(tokens.cache?.write)
  if (!(input || output || cacheRead || cacheCreation)) return null
  return baseEntry({
    id: `opencode_session:${messageId}`, createdAt: value.time?.created, client: 'opencode',
    providerId: '_opencode_session', providerName: 'OpenCode (Session)', model: value.modelID,
    inputTokens: input, outputTokens: output, cacheReadTokens: cacheRead, cacheCreationTokens: cacheCreation,
    dataSource: 'opencode_session', sessionId, totalCostUsd: value.cost
  })
}

function createUsageImportManager(options = {}) {
  const homeDir = path.resolve(options.homeDir || process.env.HOME || process.env.USERPROFILE || '')
  const dataDir = path.resolve(options.dataDir)
  const activityStore = options.activityStore
  if (!activityStore?.importMany) throw new Error('历史用量同步需要 ActivityStore')
  const xdgData = path.resolve(options.xdgDataHome || process.env.XDG_DATA_HOME || path.join(homeDir, '.local', 'share'))
  const roots = options.roots || {
    claude: path.join(homeDir, '.claude', 'projects'),
    codex: [path.join(homeDir, '.codex', 'sessions'), path.join(homeDir, '.codex', 'archived_sessions')],
    gemini: path.join(homeDir, '.gemini', 'tmp'),
    opencodeStorage: path.join(xdgData, 'opencode', 'storage'),
    opencodeDb: path.join(xdgData, 'opencode', 'opencode.db')
  }
  const statePath = path.join(dataDir, 'usage-import-state.json')
  const run = options.execFile || execFile
  let syncQueue = Promise.resolve()

  function serializeSync(task) { const next = syncQueue.then(task, task); syncQueue = next.catch(() => {}); return next }

  async function loadState() { try { const value = JSON.parse(await fsp.readFile(statePath, 'utf8')); return value.version === 1 ? value : { version: 1, files: {} } } catch { return { version: 1, files: {} } } }
  async function saveState(state) {
    await fsp.mkdir(dataDir, { recursive: true, mode: 0o700 })
    const temp = `${statePath}.${process.pid}.${crypto.randomUUID()}.tmp`
    try { await fsp.writeFile(temp, JSON.stringify(state, null, 2), { mode: 0o600, flag: 'wx' }); await fsp.rename(temp, statePath) } finally { await fsp.rm(temp, { force: true }).catch(() => {}) }
  }
  async function signature(file) { const stat = await fsp.lstat(file); if (!stat.isFile() || stat.isSymbolicLink()) throw new Error('用量来源不是普通文件'); return `${stat.size}:${stat.mtimeMs}` }

  async function sourceFiles() {
    const claude = await collectFiles(roots.claude, (_file, name) => name.endsWith('.jsonl') && !name.startsWith('agent-'))
    const codex = []
    for (const root of roots.codex) await collectFiles(root, (_file, name) => name.endsWith('.jsonl'), codex)
    const gemini = await collectFiles(roots.gemini, (_file, name) => name.startsWith('session-') && name.endsWith('.json'))
    const opencode = await collectFiles(path.join(roots.opencodeStorage, 'message'), (_file, name) => name.endsWith('.json'))
    return [
      ...claude.map((file) => ({ kind: 'claude', file })), ...codex.map((file) => ({ kind: 'codex', file })),
      ...gemini.map((file) => ({ kind: 'gemini', file })), ...opencode.map((file) => ({ kind: 'opencode', file }))
    ]
  }

  async function parseFile(item) {
    if (item.kind === 'claude') return parseClaude(await readJsonLines(item.file))
    if (item.kind === 'codex') return parseCodex(await readJsonLines(item.file))
    if (item.kind === 'gemini') return parseGemini(await readJson(item.file))
    const value = await readJson(item.file)
    const sessionId = path.basename(path.dirname(item.file))
    const parsed = parseOpenCodeMessage(value, value.id || path.basename(item.file, '.json'), sessionId)
    return parsed ? [parsed] : []
  }

  async function parseOpenCodeDb(force, state, nextState) {
    if (!fs.existsSync(roots.opencodeDb)) return { entries: [], scanned: 0, changed: 0 }
    const key = `sqlite:${roots.opencodeDb}`; const value = await signature(roots.opencodeDb)
    if (!force && state.files[key] === value) return { entries: [], scanned: 1, changed: 0 }
    const sql = "SELECT id,session_id,data FROM message ORDER BY time_created;"
    const { stdout } = await run('sqlite3', ['-readonly', '-json', roots.opencodeDb, sql], { timeout: 15000, maxBuffer: 64 * 1024 * 1024 })
    const rows = JSON.parse(stdout || '[]'); const entries = []
    for (const row of rows) {
      let data
      try { data = JSON.parse(row.data) } catch { continue }
      const parsed = parseOpenCodeMessage(data, row.id, row.session_id)
      if (parsed) entries.push(parsed)
    }
    nextState.files[key] = value
    return { entries, scanned: 1, changed: 1 }
  }

  async function syncUnlocked(options = {}) {
    const force = Boolean(options.force)
    const state = await loadState(); const nextState = { version: 1, files: { ...state.files }, lastSyncAt: Date.now() }
    const files = await sourceFiles(); const entries = []; const errors = []; let changed = 0
    for (const item of files) {
      try {
        const value = await signature(item.file)
        if (!force && state.files[item.file] === value) continue
        entries.push(...await parseFile(item)); nextState.files[item.file] = value; changed += 1
      } catch (error) { errors.push(`${item.kind}: ${path.basename(item.file)}: ${error.message}`) }
    }
    let sqlite = { entries: [], scanned: 0, changed: 0 }
    try { sqlite = await parseOpenCodeDb(force, state, nextState); entries.push(...sqlite.entries); changed += sqlite.changed } catch (error) { errors.push(`opencode-sqlite: ${error.message}`) }
    const result = await activityStore.importMany(entries)
    await saveState(nextState)
    return { ...result, filesScanned: files.length + sqlite.scanned, filesChanged: changed, recordsParsed: entries.length, errors }
  }

  async function sync(options = {}) { return serializeSync(() => syncUnlocked(options)) }

  function isInside(root, target) {
    const relative = path.relative(path.resolve(root), path.resolve(target))
    return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative))
  }

  async function rebuildCodex() {
    return serializeSync(async () => {
      if (typeof activityStore.backupAndResetDataSource !== 'function') throw new Error('ActivityStore 不支持可恢复的 Codex 重建')
      await fsp.mkdir(dataDir, { recursive: true, mode: 0o700 })
      const state = await loadState(); const rebuildAt = Date.now()
      let stateBackupPath = null
      try { await fsp.access(statePath); stateBackupPath = `${statePath}.bak-codex-${rebuildAt}`; await fsp.copyFile(statePath, stateBackupPath) }
      catch (error) { if (error.code !== 'ENOENT') throw error }
      const reset = await activityStore.backupAndResetDataSource('codex_session')
      const codexRoots = roots.codex.map((root) => path.resolve(root))
      const nextState = { version: 1, files: Object.fromEntries(Object.entries(state.files || {}).filter(([file]) => !codexRoots.some((root) => isInside(root, file)))), lastSyncAt: rebuildAt }
      const files = await sourceFiles(); const codexFiles = files.filter((item) => item.kind === 'codex')
      const entries = []; const errors = []
      for (const item of codexFiles) {
        try { entries.push(...await parseFile(item)); nextState.files[item.file] = await signature(item.file) }
        catch (error) { errors.push(`codex: ${path.basename(item.file)}: ${error.message}`) }
      }
      const imported = await activityStore.importMany(entries)
      await saveState(nextState)
      return { ...imported, removed: reset.removed, backupPath: reset.backupPath, stateBackupPath, filesScanned: codexFiles.length, recordsParsed: entries.length, errors }
    })
  }

  async function status() { return { sources: await activityStore.dataSources(), state: await loadState(), roots: { ...roots, opencodeDb: roots.opencodeDb } } }
  return Object.freeze({ sync, rebuildCodex, status, getRoots: () => structuredClone(roots), _internal: { parseClaude, parseCodex, parseGemini, parseOpenCodeMessage } })
}

module.exports = { createUsageImportManager, parseClaude, parseCodex, parseGemini, parseOpenCodeMessage }
