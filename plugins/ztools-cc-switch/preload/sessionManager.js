'use strict'

const fs = require('node:fs')
const fsp = require('node:fs/promises')
const path = require('node:path')
const crypto = require('node:crypto')
const readline = require('node:readline')
const { execFile: execFileCallback } = require('node:child_process')
const { promisify } = require('node:util')
const execFile = promisify(execFileCallback)

const MAX_SESSIONS = 5000
const MAX_MESSAGES = 3000
const MAX_JSON_BYTES = 32 * 1024 * 1024
const VSCODE_CONTEXT_PREFIX = '# Context from my IDE setup:'
const CODEX_REQUEST_MARKER = 'my request for codex'

function parseTimestamp(value) { if (value === undefined || value === null) return null; if (typeof value === 'number') return value < 1e12 ? value * 1000 : value; const parsed = Date.parse(String(value)); return Number.isFinite(parsed) ? parsed : null }
function extractText(value) {
  if (typeof value === 'string') return value
  if (Array.isArray(value)) return value.map((item) => {
    if (typeof item === 'string') return item
    if (['text', 'input_text', 'output_text', 'tool_result'].includes(item?.type)) return extractText(item.text ?? item.content)
    if (item?.type === 'tool_use') return `[Tool: ${item.name || 'unknown'}]`
    return item?.text || ''
  }).filter(Boolean).join('\n')
  if (value && typeof value === 'object') return String(value.text || value.content || '')
  return ''
}
function truncate(value, length = 160) { const text = String(value || '').trim().replace(/\s+/g, ' '); return text.length > length ? `${text.slice(0, length - 1)}…` : text }
function basename(value) { try { return path.basename(value) || null } catch { return null } }
function quoteShell(value) { return `'${String(value).replace(/'/g, `'"'"'`)}'` }
function codexRequestHeadingPayload(line) {
  const trimmed = String(line || '').trim()
  if (!trimmed.startsWith('#')) return null
  const heading = trimmed.replace(/^#+/, '').trimStart()
  if (!heading.toLowerCase().startsWith(CODEX_REQUEST_MARKER)) return null
  const suffix = heading.slice(CODEX_REQUEST_MARKER.length).trimStart()
  if (!suffix) return ''
  if (![':', '：', '-', '—'].includes(suffix[0])) return null
  return suffix.replace(/^[\s:：—-]+/, '').trim()
}
function extractCodexPromptFromIdeContext(text) {
  const lines = String(text || '').replace(/\r\n/g, '\n').split('\n')
  let prompt = null
  for (let index = 0; index < lines.length; index += 1) {
    const inline = codexRequestHeadingPayload(lines[index])
    if (inline === null) continue
    prompt = inline || lines.slice(index + 1).join('\n').trim() || null
  }
  return prompt
}
function codexTitleCandidate(text) {
  const trimmed = String(text || '').trim()
  if (!trimmed || trimmed.startsWith('# AGENTS.md') || trimmed.startsWith('<environment_context>')) return null
  if (trimmed.startsWith(VSCODE_CONTEXT_PREFIX)) return extractCodexPromptFromIdeContext(trimmed)
  return trimmed
}

function createSessionManager(options = {}) {
  const homeDir = path.resolve(options.homeDir)
  const dataDir = path.resolve(options.dataDir)
  const trashDir = path.join(dataDir, 'session-trash')
  const codexDir = path.resolve(options.codexHome || process.env.CODEX_HOME || path.join(homeDir, '.codex'))
  const xdgData = options.xdgDataHome ? path.resolve(options.xdgDataHome) : process.env.XDG_DATA_HOME ? path.resolve(process.env.XDG_DATA_HOME) : path.join(homeDir, '.local', 'share')
  const roots = {
    claude: [path.join(homeDir, '.claude', 'projects')],
    codex: [path.join(codexDir, 'sessions'), path.join(codexDir, 'archived_sessions')],
    gemini: [path.join(homeDir, '.gemini', 'tmp')],
    opencode: [path.join(xdgData, 'opencode', 'storage'), path.join(xdgData, 'opencode', 'opencode.db')],
    openclaw: [path.join(homeDir, '.openclaw', 'agents')],
    hermes: [path.join(options.hermesHome || process.env.HERMES_HOME || path.join(homeDir, '.hermes'), 'sessions'), path.join(options.hermesHome || process.env.HERMES_HOME || path.join(homeDir, '.hermes'), 'state.db')],
    grokbuild: [path.join(options.grokHome || path.join(homeDir, '.grok'), 'sessions'), path.join(options.grokHome || path.join(homeDir, '.grok'), 'archived_sessions')]
  }

  async function atomicWrite(filePath, content) {
    const temp = `${filePath}.${process.pid}.${crypto.randomBytes(5).toString('hex')}.tmp`
    try { await fsp.writeFile(temp, content, { mode: 0o600 }); await fsp.rename(temp, filePath) }
    finally { await fsp.rm(temp, { force: true }).catch(() => {}) }
  }

  async function collectFiles(root, predicate, maxDepth = 6, output = [], depth = 0) {
    if (depth > maxDepth || output.length >= MAX_SESSIONS) return output
    let entries; try { entries = await fsp.readdir(root, { withFileTypes: true }) } catch { return output }
    for (const entry of entries) {
      if (output.length >= MAX_SESSIONS || entry.isSymbolicLink()) break
      const target = path.join(root, entry.name)
      if (entry.isDirectory()) await collectFiles(target, predicate, maxDepth, output, depth + 1)
      else if (entry.isFile() && predicate(target, entry.name)) output.push(target)
    }
    return output
  }
  async function readHeadTail(file, headCount = 12, tailCount = 32) {
    const handle = await fsp.open(file, 'r')
    try {
      const stat = await handle.stat(); const headSize = Math.min(stat.size, 160 * 1024); const tailSize = Math.min(Math.max(stat.size - headSize, 0), 320 * 1024)
      const head = Buffer.alloc(headSize); await handle.read(head, 0, headSize, 0)
      const tail = Buffer.alloc(tailSize); if (tailSize) await handle.read(tail, 0, tailSize, stat.size - tailSize)
      return { head: head.toString('utf8').split(/\r?\n/).filter(Boolean).slice(0, headCount), tail: tail.toString('utf8').split(/\r?\n/).filter(Boolean).slice(-tailCount), stat }
    } finally { await handle.close() }
  }
  function jsonLines(lines) { return lines.map((line) => { try { return JSON.parse(line) } catch { return null } }).filter(Boolean) }
  function meta(providerId, sessionId, sourcePath, values = {}) { return { providerId, sessionId, title: values.title || null, summary: values.summary || null, projectDir: values.projectDir || null, createdAt: values.createdAt || null, lastActiveAt: values.lastActiveAt || values.createdAt || null, sourcePath, resumeCommand: values.resumeCommand || null, storageType: values.storageType || 'file' } }

  async function scanClaude() {
    const files = await collectFiles(roots.claude[0], (_p, name) => name.endsWith('.jsonl') && !name.startsWith('agent-'))
    const result = []
    for (const file of files) { try {
      const { head, tail } = await readHeadTail(file); const first = jsonLines(head); const last = jsonLines(tail)
      let id = '', cwd = '', createdAt = null, title = ''
      for (const row of first) { id ||= row.sessionId || ''; cwd ||= row.cwd || ''; createdAt ||= parseTimestamp(row.timestamp); const message = row.message; if (!title && (row.type === 'user' || message?.role === 'user')) { const text = extractText(message?.content); if (text && !text.includes('<local-command-caveat>') && !text.startsWith('<command-name>')) title = text } }
      id ||= path.basename(file, '.jsonl'); let summary = '', lastActiveAt = null, customTitle = ''
      for (const row of [...last].reverse()) { lastActiveAt ||= parseTimestamp(row.timestamp); if (!customTitle && row.type === 'custom-title') customTitle = row.customTitle || ''; if (!summary && !row.isMeta) summary = extractText(row.message?.content) }
      result.push(meta('claude', id, file, { title: truncate(customTitle || title || basename(cwd)), summary: truncate(summary), projectDir: cwd, createdAt, lastActiveAt, resumeCommand: `claude --resume ${id}` }))
    } catch {} }
    return result
  }
  async function scanCodex() {
    const files = []; for (const root of roots.codex) await collectFiles(root, (_p, name) => name.endsWith('.jsonl'), 6, files)
    const threadTitles = await loadCodexThreadTitles()
    const result = []
    for (const file of files) { try {
      const { head, tail } = await readHeadTail(file); const first = jsonLines(head); const last = jsonLines(tail)
      let id = '', cwd = '', createdAt = null, title = '', subagent = false
      for (const row of first) { createdAt ||= parseTimestamp(row.timestamp); if (row.type === 'session_meta') { subagent ||= Boolean(row.payload?.source?.subagent); id ||= row.payload?.id || ''; cwd ||= row.payload?.cwd || ''; createdAt ||= parseTimestamp(row.payload?.timestamp) } if (!title && row.type === 'response_item' && row.payload?.type === 'message' && row.payload?.role === 'user') title = codexTitleCandidate(extractText(row.payload.content)) || '' }
      if (subagent) continue; id ||= (path.basename(file).match(/[0-9a-f]{8}-[0-9a-f-]{27,}/i)?.[0] || path.basename(file, '.jsonl'))
      let summary = '', lastActiveAt = null; for (const row of [...last].reverse()) { lastActiveAt ||= parseTimestamp(row.timestamp); if (!summary && row.type === 'response_item' && row.payload?.type === 'message') summary = extractText(row.payload.content) }
      result.push(meta('codex', id, file, { title: truncate(threadTitles.get(id) || title || basename(cwd)), summary: truncate(summary), projectDir: cwd, createdAt, lastActiveAt, resumeCommand: `codex resume ${id}` }))
    } catch {} }
    return result
  }
  async function readJsonLimited(file) { const stat = await fsp.stat(file); if (stat.size > MAX_JSON_BYTES) throw new Error('会话文件超过 32 MB'); return JSON.parse(await fsp.readFile(file, 'utf8')) }
  async function scanGemini() {
    const projectRoots = new Map(); let projects = []; try { projects = await fsp.readdir(roots.gemini[0], { withFileTypes: true }) } catch {}
    for (const entry of projects) if (entry.isDirectory()) { try { projectRoots.set(entry.name, (await fsp.readFile(path.join(roots.gemini[0], entry.name, '.project_root'), 'utf8')).trim()) } catch {} }
    const files = await collectFiles(roots.gemini[0], (file, name) => name.startsWith('session-') && name.endsWith('.json'), 3); const result = []
    for (const file of files) { try { const value = await readJsonLimited(file); const id = value.sessionId; if (!id) continue; const first = (value.messages || []).find((item) => item.type === 'user'); const title = extractText(first?.content); const projectKey = path.basename(path.dirname(path.dirname(file))); result.push(meta('gemini', id, file, { title: truncate(title), summary: truncate(title), projectDir: projectRoots.get(projectKey), createdAt: parseTimestamp(value.startTime), lastActiveAt: parseTimestamp(value.lastUpdated), resumeCommand: `gemini --resume ${id}` })) } catch {} }
    return result
  }
  async function scanOpenCodeJson() {
    const storage = roots.opencode[0]; const files = await collectFiles(path.join(storage, 'session'), (_p, name) => name.endsWith('.json'), 4); const result = []
    for (const file of files) { try { const value = await readJsonLimited(file); if (!value.id) continue; const title = value.title || basename(value.directory); result.push(meta('opencode', value.id, path.join(storage, 'message', value.id), { title: truncate(title), summary: truncate(title), projectDir: value.directory, createdAt: parseTimestamp(value.time?.created), lastActiveAt: parseTimestamp(value.time?.updated), resumeCommand: `opencode -s ${value.id}`, storageType: 'json' })) } catch {} }
    return result
  }
  async function sqliteQuery(db, sql) {
    try { const result = await execFile('sqlite3', ['-readonly', '-json', db, sql], { timeout: 5000, maxBuffer: 12 * 1024 * 1024 }); return JSON.parse(result.stdout || '[]') } catch { return [] }
  }
  function resolveCodexPath(value) {
    const raw = String(value || '').trim()
    if (raw === '~') return homeDir
    if (raw.startsWith('~/') || raw.startsWith('~\\')) return path.join(homeDir, raw.slice(2))
    return path.resolve(raw)
  }
  async function loadCodexThreadTitles() {
    const titles = new Map()
    try {
      const text = await fsp.readFile(path.join(codexDir, 'session_index.jsonl'), 'utf8')
      for (const line of text.split(/\r?\n/)) {
        try { const entry = JSON.parse(line); const id = String(entry.id || '').trim(); const title = String(entry.thread_name || '').trim(); if (id && title) titles.set(id, title) } catch {}
      }
    } catch {}
    const dbPaths = [path.join(codexDir, 'state_5.sqlite')]
    let configuredSqliteHome = ''
    try {
      const config = await fsp.readFile(path.join(codexDir, 'config.toml'), 'utf8')
      const match = /^\s*sqlite_home\s*=\s*(["'])(.*?)\1\s*$/m.exec(config)
      if (match?.[2]?.trim()) configuredSqliteHome = match[2].trim()
    } catch {}
    const override = configuredSqliteHome || String(options.codexSqliteHome || process.env.CODEX_SQLITE_HOME || '').trim()
    if (override) { const candidate = path.join(resolveCodexPath(override), 'state_5.sqlite'); if (!dbPaths.includes(candidate)) dbPaths.push(candidate) }
    for (const db of dbPaths) {
      if (!fs.existsSync(db)) continue
      const rows = await sqliteQuery(db, "SELECT id,title FROM threads WHERE title <> '' AND (first_user_message IS NULL OR TRIM(title) <> TRIM(first_user_message));")
      for (const row of rows) { const id = String(row.id || '').trim(); const title = String(row.title || '').trim(); if (id && title) titles.set(id, title) }
    }
    return titles
  }
  async function scanOpenCodeSqlite() {
    const db = roots.opencode[1]; if (!fs.existsSync(db)) return []
    const rows = await sqliteQuery(db, 'SELECT id,title,directory,time_created,time_updated FROM session ORDER BY time_updated DESC LIMIT 1000;')
    return rows.map((row) => meta('opencode', row.id, `sqlite:${db}:${row.id}`, { title: truncate(row.title || basename(row.directory)), summary: truncate(row.title), projectDir: row.directory, createdAt: parseTimestamp(row.time_created), lastActiveAt: parseTimestamp(row.time_updated), resumeCommand: `opencode -s ${row.id}`, storageType: 'sqlite' }))
  }
  async function scanOpenClaw() {
    const files = await collectFiles(roots.openclaw[0], (_p, name) => name.endsWith('.jsonl'), 4); const result = []
    for (const file of files) { try { const { head, tail } = await readHeadTail(file); const first = jsonLines(head); const last = jsonLines(tail); let id = '', cwd = '', title = '', summary = '', createdAt = null; for (const row of first) { createdAt ||= parseTimestamp(row.timestamp); if (row.type === 'session') { id ||= row.id || ''; cwd ||= row.cwd || '' } if (row.type === 'message') { const text = extractText(row.message?.content).replace(/\n\[message_id:.*$/s, '').trim(); if (text) { summary ||= text; if (!title && row.message?.role === 'user') title = text } } } id ||= path.basename(file, '.jsonl'); let lastActiveAt = null; for (const row of [...last].reverse()) lastActiveAt ||= parseTimestamp(row.timestamp); try { const index = JSON.parse(await fsp.readFile(path.join(path.dirname(file), 'sessions.json'), 'utf8')); for (const entry of Object.values(index)) if (entry?.sessionId === id && entry.displayName) { title = entry.displayName; break } } catch {} result.push(meta('openclaw', id, file, { title: truncate(title || basename(cwd)), summary: truncate(summary), projectDir: cwd, createdAt, lastActiveAt })) } catch {} }
    return result
  }
  async function scanHermes() {
    const files = await collectFiles(roots.hermes[0], (_p, name) => name.endsWith('.jsonl') || name.endsWith('.json'), 2); const result = []
    for (const file of files) { try { const { head, tail } = await readHeadTail(file, 30, 10); const first = jsonLines(head); const last = jsonLines(tail); let id = '', cwd = '', title = '', firstUser = '', createdAt = null; for (const row of first) { const ts = parseTimestamp(row.timestamp ?? row.ts); createdAt ||= ts; if (['session', 'init'].includes(row.type)) { id ||= row.id || row.sessionId || ''; cwd ||= row.cwd || row.directory || ''; title ||= row.title || '' } const msg = row.type === 'message' ? row.message : row; if (!firstUser && msg?.role === 'user') firstUser = extractText(msg.content) } id ||= path.basename(file, path.extname(file)); let lastActiveAt = null; for (const row of [...last].reverse()) lastActiveAt ||= parseTimestamp(row.timestamp ?? row.ts); result.push(meta('hermes', id, file, { title: truncate(title || firstUser), summary: truncate(firstUser), projectDir: cwd, createdAt, lastActiveAt })) } catch {} }
    return result
  }
  function hermesSqliteSource(db, id) { return `sqlite:${db}#${id}` }
  function parseHermesSqliteSource(source) { const match = /^sqlite:(.*)#([^#]+)$/.exec(source); return match ? { db: match[1], id: match[2] } : null }
  async function scanHermesSqlite() {
    const db = roots.hermes[1]; if (!fs.existsSync(db)) return []
    const rows = await sqliteQuery(db, 'SELECT * FROM sessions ORDER BY rowid DESC LIMIT 500;')
    return rows.flatMap((row) => {
      if (!row.id) return []
      const createdAt = parseTimestamp(row.started_at ?? row.created_at); const lastActiveAt = parseTimestamp(row.ended_at ?? row.updated_at) || createdAt
      return [meta('hermes', String(row.id), hermesSqliteSource(db, String(row.id)), { title: truncate(row.title), projectDir: row.cwd || row.directory || null, createdAt, lastActiveAt, storageType: 'sqlite' })]
    })
  }
  async function scanGrokBuild() {
    const files = []
    for (const root of roots.grokbuild) await collectFiles(root, (_file, name) => name === 'summary.json', 6, files)
    const result = []
    for (const file of files) { try {
      const value = await readJsonLimited(file); const info = value.info || {}; if (!info.id) continue
      result.push(meta('grokbuild', String(info.id), file, { title: truncate(value.generated_title || value.session_summary), summary: truncate(value.session_summary), projectDir: info.cwd || null, createdAt: parseTimestamp(value.created_at), lastActiveAt: parseTimestamp(value.last_active_at ?? value.updated_at), resumeCommand: `grok --resume ${info.id}` }))
    } catch {} }
    return result
  }
  async function listSessions() {
    const groups = await Promise.all([scanClaude(), scanCodex(), scanGemini(), scanOpenCodeJson(), scanOpenCodeSqlite(), scanOpenClaw(), scanHermes(), scanHermesSqlite(), scanGrokBuild()])
    const byKey = new Map(); for (const session of groups.flat()) { const key = `${session.providerId}:${session.sessionId}`; const current = byKey.get(key); if (!current || session.storageType === 'sqlite') byKey.set(key, session) }
    return [...byKey.values()].sort((a, b) => (b.lastActiveAt || b.createdAt || 0) - (a.lastActiveAt || a.createdAt || 0)).slice(0, MAX_SESSIONS)
  }

  async function loadJsonlMessages(file, provider) {
    const stream = fs.createReadStream(file, { encoding: 'utf8' }); const lines = readline.createInterface({ input: stream, crlfDelay: Infinity }); const messages = []
    try { for await (const line of lines) { if (messages.length >= MAX_MESSAGES) break; let row; try { row = JSON.parse(line) } catch { continue } let role, content, ts
      if (provider === 'claude') { if (row.isMeta || !row.message) continue; role = row.message.role || 'unknown'; if (role === 'user' && Array.isArray(row.message.content) && row.message.content.length && row.message.content.every((item) => item.type === 'tool_result')) role = 'tool'; content = extractText(row.message.content); ts = parseTimestamp(row.timestamp) }
      else if (provider === 'codex') { if (row.type !== 'response_item') continue; const item = row.payload || {}; if (item.type === 'message') { role = item.role || 'unknown'; content = extractText(item.content) } else if (item.type === 'function_call') { role = 'assistant'; content = `[Tool: ${item.name || 'unknown'}]` } else if (item.type === 'function_call_output') { role = 'tool'; content = String(item.output || '') } else continue; ts = parseTimestamp(row.timestamp) }
      else if (provider === 'openclaw') { if (row.type !== 'message') continue; role = row.message?.role === 'toolResult' ? 'tool' : row.message?.role; content = extractText(row.message?.content); ts = parseTimestamp(row.timestamp) }
      else if (provider === 'grokbuild') { if (!['system', 'user', 'assistant', 'tool'].includes(row.type)) continue; role = row.type; content = extractText(row.content); ts = parseTimestamp(row.timestamp ?? row.ts) }
      else { const item = row.type === 'message' ? row.message : row; role = item?.role; content = extractText(item?.content); ts = parseTimestamp(row.timestamp ?? item?.ts) }
      if (role && content?.trim()) messages.push({ role, content, ts })
    } } finally { lines.close(); stream.destroy() }
    return messages
  }
  async function loadOpenCodeJsonMessages(directory) {
    const storage = path.dirname(path.dirname(directory)); const files = await collectFiles(directory, (_p, name) => name.endsWith('.json'), 2); const rows = []
    for (const file of files) { try { const msg = await readJsonLimited(file); if (!msg.id) continue; const partFiles = await collectFiles(path.join(storage, 'part', msg.id), (_p, name) => name.endsWith('.json'), 2); const texts = []; for (const part of partFiles) { try { const value = await readJsonLimited(part); const text = value.type === 'tool' ? `[Tool: ${value.tool || value.name || 'unknown'}]` : extractText(value.text ?? value.content); if (text) texts.push(text) } catch {} } if (texts.length) rows.push({ role: msg.role || 'unknown', content: texts.join('\n'), ts: parseTimestamp(msg.time?.created) }) } catch {} }
    return rows.sort((a, b) => (a.ts || 0) - (b.ts || 0)).slice(0, MAX_MESSAGES)
  }
  function parseSqliteSource(source) { const match = /^sqlite:(.*):(ses_[^:]+)$/.exec(source); return match ? { db: match[1], id: match[2] } : null }
  async function loadOpenCodeSqliteMessages(source) {
    const parsed = parseSqliteSource(source); if (!parsed) throw new Error('OpenCode SQLite 会话引用无效'); const id = parsed.id.replace(/'/g, "''")
    const messages = await sqliteQuery(parsed.db, `SELECT id,time_created,data FROM message WHERE session_id='${id}' ORDER BY time_created ASC;`); const parts = await sqliteQuery(parsed.db, `SELECT message_id,data FROM part WHERE session_id='${id}' ORDER BY time_created ASC;`); const byMessage = new Map()
    for (const part of parts) { try { const value = JSON.parse(part.data); const text = extractText(value.text ?? value.content); if (text) { const list = byMessage.get(part.message_id) || []; list.push(text); byMessage.set(part.message_id, list) } } catch {} }
    return messages.map((row) => { let data = {}; try { data = JSON.parse(row.data) } catch {} return { role: data.role || 'unknown', content: (byMessage.get(row.id) || []).join('\n'), ts: parseTimestamp(row.time_created) } }).filter((item) => item.content).slice(0, MAX_MESSAGES)
  }
  async function loadHermesSqliteMessages(source) {
    const parsed = parseHermesSqliteSource(source); if (!parsed) throw new Error('Hermes SQLite 会话引用无效')
    const id = parsed.id.replace(/'/g, "''")
    const rows = await sqliteQuery(parsed.db, `SELECT role,content,created_at FROM messages WHERE session_id='${id}' ORDER BY created_at ASC;`)
    return rows.map((row) => ({ role: row.role || 'unknown', content: String(row.content || ''), ts: parseTimestamp(row.created_at) })).filter((item) => item.content.trim()).slice(0, MAX_MESSAGES)
  }
  async function loadGrokBuildMessages(summaryPath) {
    const file = path.join(path.dirname(summaryPath), 'chat_history.jsonl')
    const rows = await loadJsonlMessages(file, 'grokbuild')
    return rows.filter((item) => ['system', 'user', 'assistant', 'tool'].includes(item.role))
  }
  async function getSessionMessages(providerId, sourcePath) {
    const sessions = await listSessions(); const session = sessions.find((item) => item.providerId === providerId && item.sourcePath === sourcePath); if (!session) throw new Error('会话不存在或来源路径不受信任')
    if (providerId === 'opencode') return sourcePath.startsWith('sqlite:') ? loadOpenCodeSqliteMessages(sourcePath) : loadOpenCodeJsonMessages(sourcePath)
    if (providerId === 'hermes' && sourcePath.startsWith('sqlite:')) return loadHermesSqliteMessages(sourcePath)
    if (providerId === 'grokbuild') return loadGrokBuildMessages(sourcePath)
    if (providerId === 'gemini') { const value = await readJsonLimited(sourcePath); return (value.messages || []).flatMap((item) => { const role = item.type === 'gemini' ? 'assistant' : item.type === 'user' ? 'user' : ''; let content = extractText(item.content); for (const call of item.toolCalls || []) content += `${content ? '\n' : ''}[Tool: ${call.name || 'unknown'}]`; return role && content ? [{ role, content, ts: parseTimestamp(item.timestamp) }] : [] }).slice(0, MAX_MESSAGES) }
    return loadJsonlMessages(sourcePath, providerId)
  }

  async function moveToTrash(item) { const relative = `${crypto.randomUUID()}-${path.basename(item)}`; const target = path.join(trashDir, relative); await fsp.mkdir(trashDir, { recursive: true }); await fsp.rename(item, target); return { original: item, trashed: target } }
  function sqlLiteral(value) {
    if (value === null || value === undefined) return 'NULL'
    if (typeof value === 'number' && Number.isFinite(value)) return String(value)
    return `'${String(value).replace(/'/g, "''")}'`
  }
  function sqliteInsert(table, row) {
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(table)) throw new Error('SQLite 回收站表名无效')
    const columns = Object.keys(row)
    if (!columns.length || columns.some((column) => !/^[A-Za-z_][A-Za-z0-9_]*$/.test(column))) throw new Error('SQLite 回收站列名无效')
    return `INSERT INTO "${table}" (${columns.map((column) => `"${column}"`).join(',')}) VALUES (${columns.map((column) => sqlLiteral(row[column])).join(',')});`
  }
  async function createSqliteBackup(db, backup) {
    await fsp.mkdir(path.dirname(backup), { recursive: true })
    await fsp.rm(backup, { force: true })
    await execFile('sqlite3', [db, `VACUUM INTO '${backup.replace(/'/g, "''")}'`], { timeout: 15000 })
  }
  async function sqliteSessionSnapshot(providerId, db, id) {
    const escaped = id.replace(/'/g, "''")
    const definitions = providerId === 'hermes'
      ? [['sessions', `id='${escaped}'`], ['messages', `session_id='${escaped}'`]]
      : [['session', `id='${escaped}'`], ['message', `session_id='${escaped}'`], ['part', `session_id='${escaped}'`]]
    const tables = []
    for (const [name, where] of definitions) tables.push({ name, rows: await sqliteQuery(db, `SELECT * FROM "${name}" WHERE ${where};`) })
    if (!tables[0].rows.length) throw new Error('SQLite 会话已不存在')
    return tables
  }
  async function deleteSession(providerId, sessionId, sourcePath) {
    const sessions = await listSessions(); const session = sessions.find((item) => item.providerId === providerId && item.sessionId === sessionId && item.sourcePath === sourcePath); if (!session) throw new Error('会话不存在或来源路径不匹配')
    if (sourcePath.startsWith('sqlite:')) {
      const parsed = providerId === 'hermes' ? parseHermesSqliteSource(sourcePath) : parseSqliteSource(sourcePath); if (!parsed) throw new Error('SQLite 会话引用无效')
      const expected = providerId === 'hermes' ? roots.hermes[1] : roots.opencode[1]
      if (path.resolve(parsed.db) !== path.resolve(expected) || parsed.id !== sessionId) throw new Error('SQLite 会话来源不匹配')
      const trashId = crypto.randomUUID(); const backup = path.join(trashDir, `${trashId}-${path.basename(parsed.db)}.bak`); const tables = await sqliteSessionSnapshot(providerId, parsed.db, parsed.id); await createSqliteBackup(parsed.db, backup); const id = parsed.id.replace(/'/g, "''")
      const sql = providerId === 'hermes'
        ? `BEGIN; DELETE FROM messages WHERE session_id='${id}'; DELETE FROM sessions WHERE id='${id}'; COMMIT;`
        : `BEGIN; DELETE FROM part WHERE session_id='${id}'; DELETE FROM message WHERE session_id='${id}'; DELETE FROM session WHERE id='${id}'; COMMIT;`
      await execFile('sqlite3', [parsed.db, sql], { timeout: 5000 })
      const manifest = { id: trashId, providerId, sessionId, title: session.title || null, deletedAt: Date.now(), moved: [], sqliteRestore: { db: parsed.db, backupPath: backup, tables } }
      try { await fsp.writeFile(path.join(trashDir, `${trashId}.json`), `${JSON.stringify(manifest, null, 2)}\n`, { mode: 0o600 }) }
      catch (error) { await fsp.copyFile(backup, parsed.db).catch(() => {}); throw error }
      return { success: true, recoverable: true, trashId, backupPath: backup }
    }
    const moved = []
    let openClawIndexSnapshot = null
    if (providerId === 'claude') { const sidecar = sourcePath.slice(0, -path.extname(sourcePath).length); if (fs.existsSync(sidecar)) moved.push(await moveToTrash(sidecar)) }
    if (providerId === 'opencode') {
      const storage = path.dirname(path.dirname(sourcePath)); const messageFiles = await collectFiles(sourcePath, (_p, name) => name.endsWith('.json'), 2)
      for (const file of messageFiles) { try { const msg = await readJsonLimited(file); const part = path.join(storage, 'part', msg.id); if (msg.id && fs.existsSync(part)) moved.push(await moveToTrash(part)) } catch {} }
      const diff = path.join(storage, 'session_diff', `${sessionId}.json`); if (fs.existsSync(diff)) moved.push(await moveToTrash(diff)); const metaFiles = await collectFiles(path.join(storage, 'session'), (file) => path.basename(file, '.json') === sessionId, 4); for (const file of metaFiles) moved.push(await moveToTrash(file))
    }
    if (providerId === 'openclaw') {
      const indexPath = path.join(path.dirname(sourcePath), 'sessions.json')
      try {
        const original = await fsp.readFile(indexPath, 'utf8')
        const index = JSON.parse(original)
        const removed = {}
        for (const [key, value] of Object.entries(index)) if (value?.sessionId === sessionId || value?.sessionFile === sourcePath) { removed[key] = value; delete index[key] }
        await fsp.copyFile(indexPath, `${indexPath}.bak`)
        await atomicWrite(indexPath, `${JSON.stringify(index, null, 2)}\n`)
        openClawIndexSnapshot = { indexPath, original }
        session.indexRestore = { indexPath, removed }
      } catch (error) {
        if (error.code !== 'ENOENT') throw new Error(`更新 OpenClaw 会话索引失败，未删除会话：${error.message}`)
      }
    }
    try {
      if (providerId === 'grokbuild') {
        const value = await readJsonLimited(sourcePath); const sessionDir = path.dirname(sourcePath)
        if (path.basename(sourcePath) !== 'summary.json' || value.info?.id !== sessionId || path.basename(sessionDir) !== sessionId || !roots.grokbuild.some((root) => path.resolve(sessionDir).startsWith(`${path.resolve(root)}${path.sep}`))) throw new Error('GrokBuild 会话目录校验失败')
        moved.push(await moveToTrash(sessionDir))
      } else moved.push(await moveToTrash(sourcePath))
      const manifest = { id: crypto.randomUUID(), providerId, sessionId, title: session.title || null, deletedAt: Date.now(), moved, indexRestore: session.indexRestore || null }
      await options.beforeTrashManifestWrite?.(manifest)
      await atomicWrite(path.join(trashDir, `${manifest.id}.json`), `${JSON.stringify(manifest, null, 2)}\n`)
      return { success: true, recoverable: true, trashId: manifest.id }
    } catch (error) {
      const rollbackErrors = []
      for (const item of moved.reverse()) {
        try {
          if (fs.existsSync(item.trashed) && !fs.existsSync(item.original)) { await fsp.mkdir(path.dirname(item.original), { recursive: true }); await fsp.rename(item.trashed, item.original) }
        } catch (rollbackError) { rollbackErrors.push(`会话文件: ${rollbackError.message}`) }
      }
      if (openClawIndexSnapshot) {
        try { await atomicWrite(openClawIndexSnapshot.indexPath, openClawIndexSnapshot.original) }
        catch (rollbackError) { rollbackErrors.push(`OpenClaw 索引: ${rollbackError.message}`) }
      }
      if (rollbackErrors.length) throw new Error(`删除会话失败且回滚不完整：${error.message}；${rollbackErrors.join('；')}`)
      throw new Error(`删除会话失败，已恢复原状态：${error.message}`)
    }
  }
  async function deleteSessions(items) { const results = []; for (const item of Array.isArray(items) ? items : []) { try { const value = await deleteSession(item.providerId, item.sessionId, item.sourcePath); results.push({ ...item, ...value }) } catch (error) { results.push({ ...item, success: false, error: error.message }) } } return results }
  async function launchSession(providerId, sessionId, sourcePath) {
    const session = (await listSessions()).find((item) => item.providerId === providerId && item.sessionId === sessionId && item.sourcePath === sourcePath); if (!session?.resumeCommand) throw new Error('该会话不支持 CLI 恢复'); if (process.platform !== 'darwin') throw new Error('会话终端恢复当前仅支持 macOS')
    const cwd = session.projectDir && fs.existsSync(session.projectDir) ? session.projectDir : homeDir; const command = `cd ${quoteShell(cwd)} && ${session.resumeCommand}`; const escaped = command.replace(/\\/g, '\\\\').replace(/"/g, '\\"'); const script = `tell application "Terminal"\nactivate\ndo script "${escaped}"\nend tell`; await execFile('osascript', ['-e', script], { timeout: 10000 }); return { launched: true, command: session.resumeCommand, cwd }
  }
  async function listTrash() {
    let entries; try { entries = await fsp.readdir(trashDir, { withFileTypes: true }) } catch (error) { if (error.code === 'ENOENT') return []; throw error }
    const result = []
    for (const entry of entries) { if (!entry.isFile() || !/^[0-9a-f-]{36}\.json$/i.test(entry.name)) continue; try { const value = JSON.parse(await fsp.readFile(path.join(trashDir, entry.name), 'utf8')); if (value.id && value.providerId && Array.isArray(value.moved) && (value.moved.length || value.sqliteRestore)) result.push({ trashId: value.id, providerId: value.providerId, sessionId: value.sessionId, title: value.title || null, deletedAt: value.deletedAt, storageType: value.sqliteRestore ? 'sqlite' : 'file' }) } catch {} }
    return result.sort((a, b) => b.deletedAt - a.deletedAt)
  }
  function allowedOriginal(providerId, original) {
    const candidates = providerId === 'grokbuild' ? roots.grokbuild : providerId === 'hermes' ? [roots.hermes[0]] : roots[providerId] || []
    const resolved = path.resolve(original)
    return candidates.some((root) => resolved.startsWith(`${path.resolve(root)}${path.sep}`))
  }
  async function restoreTrash(trashId) {
    if (!/^[0-9a-f-]{36}$/i.test(String(trashId || ''))) throw new Error('Session 回收站 ID 无效')
    const manifestPath = path.join(trashDir, `${trashId}.json`); const manifest = JSON.parse(await fsp.readFile(manifestPath, 'utf8'))
    if (manifest.id !== trashId || !Array.isArray(manifest.moved) || (!manifest.moved.length && !manifest.sqliteRestore)) throw new Error('Session 回收站清单无效')
    if (manifest.sqliteRestore) {
      const expected = manifest.providerId === 'hermes' ? roots.hermes[1] : manifest.providerId === 'opencode' ? roots.opencode[1] : ''
      const sqlite = manifest.sqliteRestore
      if (!expected || path.resolve(sqlite.db) !== path.resolve(expected) || !path.resolve(sqlite.backupPath || '').startsWith(`${path.resolve(trashDir)}${path.sep}`) || !Array.isArray(sqlite.tables)) throw new Error('SQLite Session 恢复清单不受信任')
      const statements = sqlite.tables.flatMap((table) => {
        if (!table || !Array.isArray(table.rows)) throw new Error('SQLite Session 恢复数据无效')
        return table.rows.map((row) => sqliteInsert(table.name, row))
      })
      if (!statements.length) throw new Error('SQLite Session 恢复数据为空')
      const preRestoreBackup = path.join(trashDir, `${trashId}-pre-restore-${path.basename(sqlite.db)}.bak`)
      await createSqliteBackup(sqlite.db, preRestoreBackup)
      await execFile('sqlite3', [sqlite.db, `BEGIN IMMEDIATE; ${statements.join(' ')} COMMIT;`], { timeout: 10000 })
      await fsp.rm(manifestPath)
      return { restored: true, providerId: manifest.providerId, sessionId: manifest.sessionId, backupPath: preRestoreBackup }
    }
    for (const item of manifest.moved) {
      if (!allowedOriginal(manifest.providerId, item.original) || !path.resolve(item.trashed).startsWith(`${path.resolve(trashDir)}${path.sep}`)) throw new Error('Session 恢复路径不受信任')
      if (fs.existsSync(item.original)) throw new Error(`恢复目标已存在：${item.original}`)
    }
    const restored = []
    try {
      for (const item of manifest.moved) { await fsp.mkdir(path.dirname(item.original), { recursive: true }); await fsp.rename(item.trashed, item.original); restored.push(item) }
      if (manifest.indexRestore?.indexPath && allowedOriginal(manifest.providerId, manifest.indexRestore.indexPath)) {
        const current = JSON.parse(await fsp.readFile(manifest.indexRestore.indexPath, 'utf8')); Object.assign(current, manifest.indexRestore.removed || {}); await fsp.copyFile(manifest.indexRestore.indexPath, `${manifest.indexRestore.indexPath}.bak`); await fsp.writeFile(manifest.indexRestore.indexPath, `${JSON.stringify(current, null, 2)}\n`, { mode: 0o600 })
      }
      await fsp.rm(manifestPath)
      return { restored: true, providerId: manifest.providerId, sessionId: manifest.sessionId }
    } catch (error) {
      for (const item of restored.reverse()) await fsp.rename(item.original, item.trashed).catch(() => {})
      throw error
    }
  }
  return { listSessions, getSessionMessages, deleteSession, deleteSessions, launchSession, listTrash, restoreTrash, getRoots: () => structuredClone(roots), _internal: { scanClaude, scanCodex, scanGemini, scanOpenCodeJson, scanOpenCodeSqlite, scanOpenClaw, scanHermes, scanHermesSqlite, scanGrokBuild, loadCodexThreadTitles } }
}

module.exports = { parseTimestamp, extractText, truncate, quoteShell, codexRequestHeadingPayload, extractCodexPromptFromIdeContext, codexTitleCandidate, createSessionManager }
