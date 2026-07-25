'use strict'

const fs = require('node:fs')
const fsp = require('node:fs/promises')
const path = require('node:path')
const crypto = require('node:crypto')

const WORKSPACE_FILES = Object.freeze([
  'AGENTS.md', 'SOUL.md', 'USER.md', 'IDENTITY.md', 'TOOLS.md',
  'MEMORY.md', 'HEARTBEAT.md', 'BOOTSTRAP.md', 'BOOT.md'
])
const DAILY_MEMORY_RE = /^\d{4}-\d{2}-\d{2}\.md$/
const MAX_FILE_BYTES = 2 * 1024 * 1024

function assertWorkspaceFilename(filename) {
  if (!WORKSPACE_FILES.includes(filename)) {
    throw new Error(`不允许的 Workspace 文件：${filename || '(空)'}`)
  }
  return filename
}

function assertDailyFilename(filename) {
  if (!DAILY_MEMORY_RE.test(filename)) throw new Error('Daily Memory 文件名必须为 YYYY-MM-DD.md')
  const date = filename.slice(0, 10)
  const parsed = new Date(`${date}T00:00:00Z`)
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== date) {
    throw new Error('Daily Memory 日期无效')
  }
  return filename
}

function assertContent(content) {
  if (typeof content !== 'string') throw new Error('文件内容必须是文本')
  if (Buffer.byteLength(content, 'utf8') > MAX_FILE_BYTES) throw new Error('单个 Workspace 文件不能超过 2 MB')
  return content
}

async function ensureRegularOrMissing(filePath) {
  try {
    const stat = await fsp.lstat(filePath)
    if (stat.isSymbolicLink() || !stat.isFile()) throw new Error('目标必须是普通文件，不能是符号链接')
  } catch (error) {
    if (error.code !== 'ENOENT') throw error
  }
}

async function atomicWrite(filePath, content) {
  await fsp.mkdir(path.dirname(filePath), { recursive: true, mode: 0o700 })
  await ensureRegularOrMissing(filePath)
  try { await fsp.copyFile(filePath, `${filePath}.bak`) } catch (error) { if (error.code !== 'ENOENT') throw error }
  const tempPath = path.join(path.dirname(filePath), `.${path.basename(filePath)}.${process.pid}.${crypto.randomUUID()}.tmp`)
  try {
    await fsp.writeFile(tempPath, content, { encoding: 'utf8', mode: 0o600, flag: 'wx' })
    await fsp.rename(tempPath, filePath)
  } finally {
    await fsp.rm(tempPath, { force: true }).catch(() => {})
  }
}

async function readLimited(filePath) {
  await ensureRegularOrMissing(filePath)
  let stat
  try { stat = await fsp.stat(filePath) } catch (error) { if (error.code === 'ENOENT') return null; throw error }
  if (stat.size > MAX_FILE_BYTES) throw new Error('文件超过 2 MB，拒绝加载')
  return fsp.readFile(filePath, 'utf8')
}

function previewText(content, limit = 200) {
  return Array.from(content.replace(/\s+/g, ' ').trim()).slice(0, limit).join('')
}

function createWorkspaceManager(options = {}) {
  const homeDir = path.resolve(options.homeDir || process.env.HOME || process.env.USERPROFILE || '')
  if (!homeDir || homeDir === path.parse(homeDir).root) throw new Error('无法确定安全的用户 Home 目录')
  const dataDir = path.resolve(options.dataDir || path.join(homeDir, '.ztools', 'cc-switch'))
  const workspaceDir = path.join(homeDir, '.openclaw', 'workspace')
  const memoryDir = path.join(workspaceDir, 'memory')
  const trashDir = path.join(dataDir, 'workspace-trash')

  function workspacePath(filename) { return path.join(workspaceDir, assertWorkspaceFilename(filename)) }
  function memoryPath(filename) { return path.join(memoryDir, assertDailyFilename(filename)) }

  async function listWorkspaceFiles() {
    return Promise.all(WORKSPACE_FILES.map(async (filename) => {
      const filePath = workspacePath(filename)
      try {
        const stat = await fsp.lstat(filePath)
        if (!stat.isFile() || stat.isSymbolicLink()) return { filename, exists: false, unsafe: true }
        return { filename, exists: true, sizeBytes: stat.size, modifiedAt: stat.mtimeMs }
      } catch (error) {
        if (error.code === 'ENOENT') return { filename, exists: false, sizeBytes: 0, modifiedAt: 0 }
        throw error
      }
    }))
  }

  async function listDailyMemoryFiles() {
    let entries
    try { entries = await fsp.readdir(memoryDir, { withFileTypes: true }) } catch (error) { if (error.code === 'ENOENT') return []; throw error }
    const result = []
    for (const entry of entries) {
      if (!entry.isFile() || !DAILY_MEMORY_RE.test(entry.name)) continue
      try {
        assertDailyFilename(entry.name)
        const filePath = memoryPath(entry.name)
        const stat = await fsp.lstat(filePath)
        if (stat.isSymbolicLink() || stat.size > MAX_FILE_BYTES) continue
        const content = await fsp.readFile(filePath, 'utf8')
        result.push({ filename: entry.name, date: entry.name.slice(0, 10), sizeBytes: stat.size, modifiedAt: stat.mtimeMs, preview: previewText(content) })
      } catch { /* 忽略损坏或不安全的单个条目，避免整页不可用。 */ }
    }
    return result.sort((a, b) => b.filename.localeCompare(a.filename))
  }

  async function searchDailyMemoryFiles(query) {
    const needle = String(query || '').trim().toLocaleLowerCase()
    if (!needle) return []
    const files = await listDailyMemoryFiles()
    const result = []
    for (const file of files) {
      const content = await readLimited(memoryPath(file.filename)) || ''
      const lower = content.toLocaleLowerCase()
      let index = lower.indexOf(needle)
      const dateMatch = file.date.toLocaleLowerCase().includes(needle)
      if (index < 0 && !dateMatch) continue
      let matchCount = 0
      for (let cursor = 0; (cursor = lower.indexOf(needle, cursor)) >= 0; cursor += Math.max(needle.length, 1)) matchCount += 1
      const characters = Array.from(content)
      const prefix = Array.from(content.slice(0, Math.max(index, 0))).length
      const start = index >= 0 ? Math.max(0, prefix - 50) : 0
      const end = Math.min(characters.length, start + 120)
      const snippet = `${start ? '…' : ''}${characters.slice(start, end).join('')}${end < characters.length ? '…' : ''}`
      result.push({ ...file, snippet, matchCount })
    }
    return result
  }

  async function deleteDailyMemoryFile(filename) {
    const source = memoryPath(filename)
    await ensureRegularOrMissing(source)
    try { await fsp.access(source, fs.constants.F_OK) } catch (error) { if (error.code === 'ENOENT') return { deleted: false }; throw error }
    await fsp.mkdir(trashDir, { recursive: true, mode: 0o700 })
    const trashName = `${Date.now()}-${crypto.randomUUID()}-${filename}`
    await fsp.rename(source, path.join(trashDir, trashName))
    return { deleted: true, trashId: trashName, filename }
  }

  async function listTrash() {
    let entries
    try { entries = await fsp.readdir(trashDir, { withFileTypes: true }) } catch (error) { if (error.code === 'ENOENT') return []; throw error }
    const items = []
    for (const entry of entries) {
      if (!entry.isFile()) continue
      const match = entry.name.match(/^(\d+)-[0-9a-f-]+-(\d{4}-\d{2}-\d{2}\.md)$/i)
      if (!match) continue
      items.push({ trashId: entry.name, filename: match[2], deletedAt: Number(match[1]) })
    }
    return items.sort((a, b) => b.deletedAt - a.deletedAt)
  }

  async function restoreTrash(trashId) {
    const item = (await listTrash()).find((entry) => entry.trashId === trashId)
    if (!item) throw new Error('回收站条目不存在')
    const destination = memoryPath(item.filename)
    try { await fsp.access(destination); throw new Error('同名 Daily Memory 已存在，请先处理现有文件') } catch (error) { if (error.code !== 'ENOENT') throw error }
    await fsp.mkdir(memoryDir, { recursive: true, mode: 0o700 })
    await fsp.rename(path.join(trashDir, item.trashId), destination)
    return { restored: true, filename: item.filename }
  }

  return Object.freeze({
    getPaths: () => ({ workspaceDir, memoryDir }),
    listWorkspaceFiles,
    readWorkspaceFile: (filename) => readLimited(workspacePath(filename)),
    writeWorkspaceFile: async (filename, content) => { await atomicWrite(workspacePath(filename), assertContent(content)); return { filename } },
    listDailyMemoryFiles,
    readDailyMemoryFile: (filename) => readLimited(memoryPath(filename)),
    writeDailyMemoryFile: async (filename, content) => { await atomicWrite(memoryPath(filename), assertContent(content)); return { filename } },
    searchDailyMemoryFiles,
    deleteDailyMemoryFile,
    listTrash,
    restoreTrash
  })
}

module.exports = { createWorkspaceManager, WORKSPACE_FILES, assertDailyFilename }
