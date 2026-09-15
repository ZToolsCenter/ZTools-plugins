'use strict'

const fsp = require('node:fs/promises')
const path = require('node:path')
const crypto = require('node:crypto')
const { execFile: execFileCallback } = require('node:child_process')
const { promisify } = require('node:util')

const execFile = promisify(execFileCallback)
const APP_KEYWORDS = Object.freeze({
  claude: ['ANTHROPIC'],
  codex: ['OPENAI'],
  gemini: ['GEMINI', 'GOOGLE_GEMINI'],
  opencode: ['OPENAI', 'ANTHROPIC', 'GEMINI'],
  openclaw: ['OPENAI', 'ANTHROPIC', 'GEMINI'],
  hermes: ['OPENAI', 'ANTHROPIC'],
  grokbuild: ['XAI', 'GROK']
})
const SHELL_FILES = Object.freeze(['.bashrc', '.bash_profile', '.zshrc', '.zprofile', '.profile', '.config/fish/config.fish'])
const ASSIGNMENT_RE = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/
const FISH_ASSIGNMENT_RE = /^\s*set\s+(?:-[A-Za-z]+\s+)*([A-Za-z_][A-Za-z0-9_]*)\s+(.*?)\s*$/

function keywordsFor(app) {
  const normalized = String(app || '').toLowerCase()
  if (!APP_KEYWORDS[normalized]) throw new Error(`不支持的应用：${app || '(空)'}`)
  return APP_KEYWORDS[normalized]
}

function matches(name, keywords) {
  const upper = name.toUpperCase()
  return keywords.some((keyword) => upper.includes(keyword))
}

function maskValue(value) {
  const text = String(value || '').replace(/^['"]|['"]$/g, '')
  if (!text) return '(空)'
  if (text.length <= 6) return '••••••'
  return `${text.slice(0, 3)}••••${text.slice(-3)}`
}

function parseLine(line) {
  if (!line.trim() || line.trimStart().startsWith('#')) return null
  const match = line.match(ASSIGNMENT_RE) || line.match(FISH_ASSIGNMENT_RE)
  return match ? { varName: match[1], varValue: match[2] } : null
}

async function atomicWrite(filePath, content) {
  const temp = path.join(path.dirname(filePath), `.${path.basename(filePath)}.${process.pid}.${crypto.randomUUID()}.tmp`)
  await fsp.writeFile(`${filePath}.bak`, await fsp.readFile(filePath), { mode: 0o600 })
  try {
    await fsp.writeFile(temp, content, { encoding: 'utf8', mode: 0o600, flag: 'wx' })
    await fsp.rename(temp, filePath)
  } finally { await fsp.rm(temp, { force: true }).catch(() => {}) }
}

function createEnvManager(options = {}) {
  const homeDir = path.resolve(options.homeDir || process.env.HOME || process.env.USERPROFILE || '')
  if (!homeDir || homeDir === path.parse(homeDir).root) throw new Error('无法确定安全的用户 Home 目录')
  const dataDir = path.resolve(options.dataDir || path.join(homeDir, '.ztools', 'cc-switch'))
  const backupDir = path.join(dataDir, 'env-backups')
  const environment = options.environment || process.env
  const platform = options.platform || process.platform
  const run = options.execFile || execFile

  function safeShellPath(relative) {
    if (!SHELL_FILES.includes(relative)) throw new Error('不允许的 Shell 配置文件')
    const resolved = path.resolve(homeDir, relative)
    if (resolved !== homeDir && !resolved.startsWith(`${homeDir}${path.sep}`)) throw new Error('Shell 配置路径越界')
    return resolved
  }

  async function scanUnix(app) {
    const keywords = keywordsFor(app)
    const conflicts = []
    for (const [varName, varValue] of Object.entries(environment)) {
      if (!matches(varName, keywords)) continue
      conflicts.push({
        id: `process:${varName}`, varName, maskedValue: maskValue(varValue), sourceType: 'process',
        sourcePath: '当前 ZTools 进程环境', lineNumber: null, fixable: false
      })
    }
    for (const relative of SHELL_FILES) {
      const filePath = safeShellPath(relative)
      let content
      try { content = await fsp.readFile(filePath, 'utf8') } catch (error) { if (error.code === 'ENOENT') continue; throw error }
      const lines = content.split(/\r?\n/)
      lines.forEach((line, index) => {
        const assignment = parseLine(line)
        if (!assignment || !matches(assignment.varName, keywords)) return
        conflicts.push({
          id: `file:${relative}:${index + 1}:${assignment.varName}`,
          varName: assignment.varName, maskedValue: maskValue(assignment.varValue), sourceType: 'file',
          sourcePath: filePath, lineNumber: index + 1, fixable: true
        })
      })
    }
    return conflicts
  }

  async function queryRegistry(root, registryPath, keywords) {
    try {
      const { stdout } = await run('reg', ['query', `${root}\\${registryPath}`], { windowsHide: true, encoding: 'utf8' })
      return stdout.split(/\r?\n/).flatMap((line) => {
        const match = line.match(/^\s+([^\s]+)\s+REG_\w+\s+(.*)$/)
        if (!match || !matches(match[1], keywords)) return []
        return [{
          id: `registry:${root}:${match[1]}`, varName: match[1], maskedValue: maskValue(match[2]),
          sourceType: 'registry', sourcePath: `${root}\\${registryPath}`, lineNumber: null,
          registryRoot: root, registryPath, fixable: root === 'HKCU'
        }]
      })
    } catch (error) {
      if ([1, 2].includes(error.code)) return []
      throw new Error(`读取 Windows 环境变量失败：${error.message}`)
    }
  }

  async function scan(app) {
    const keywords = keywordsFor(app)
    if (platform !== 'win32') return scanUnix(app)
    const [user, system] = await Promise.all([
      queryRegistry('HKCU', 'Environment', keywords),
      queryRegistry('HKLM', 'SYSTEM\\CurrentControlSet\\Control\\Session Manager\\Environment', keywords)
    ])
    return [...user, ...system]
  }

  async function writeBackup(payload) {
    await fsp.mkdir(backupDir, { recursive: true, mode: 0o700 })
    const id = `${new Date().toISOString().replace(/[:.]/g, '-')}-${crypto.randomUUID()}.json`
    const filePath = path.join(backupDir, id)
    await fsp.writeFile(filePath, JSON.stringify({ version: 1, id, createdAt: Date.now(), ...payload }, null, 2), { mode: 0o600, flag: 'wx' })
    return id
  }

  async function fix(app, selectedIds) {
    if (!Array.isArray(selectedIds) || !selectedIds.length) throw new Error('请选择要修复的冲突项')
    const fresh = await scan(app)
    const byId = new Map(fresh.map((item) => [item.id, item]))
    const selected = [...new Set(selectedIds.map(String))].map((id) => byId.get(id))
    if (selected.some((item) => !item)) throw new Error('冲突列表已变化，请重新扫描')
    if (selected.some((item) => !item.fixable)) throw new Error('当前进程或系统级变量不能由插件安全修复')

    if (platform === 'win32') {
      const records = []
      for (const item of selected) {
        const { stdout = '' } = await run('reg', ['query', item.sourcePath, '/v', item.varName], { windowsHide: true, encoding: 'utf8' })
        const match = stdout.match(new RegExp(`\\s${item.varName}\\s+(REG_\\w+)\\s+(.*)`))
        records.push({ ...item, registryType: match?.[1] || 'REG_SZ', originalValue: match?.[2] || '' })
      }
      const backupId = await writeBackup({ app, platform, registry: records })
      for (const item of selected) await run('reg', ['delete', item.sourcePath, '/v', item.varName, '/f'], { windowsHide: true })
      return { fixed: selected.length, backupId }
    }

    const grouped = new Map()
    for (const item of selected) {
      if (!grouped.has(item.sourcePath)) grouped.set(item.sourcePath, [])
      grouped.get(item.sourcePath).push(item)
    }
    const files = []
    for (const [filePath] of grouped) files.push({ relativePath: path.relative(homeDir, filePath), content: await fsp.readFile(filePath, 'utf8') })
    const backupId = await writeBackup({ app, platform, files })
    for (const [filePath, items] of grouped) {
      const content = await fsp.readFile(filePath, 'utf8')
      const newline = content.includes('\r\n') ? '\r\n' : '\n'
      const lines = content.split(/\r?\n/)
      const removals = new Set(items.map((item) => `${item.lineNumber}:${item.varName}`))
      const output = lines.filter((line, index) => {
        const assignment = parseLine(line)
        return !assignment || !removals.has(`${index + 1}:${assignment.varName}`)
      }).join(newline)
      await atomicWrite(filePath, output)
    }
    return { fixed: selected.length, backupId }
  }

  async function readBackup(backupId) {
    if (!/^[0-9TZ-]+-[0-9a-f-]+\.json$/i.test(String(backupId || ''))) throw new Error('备份 ID 无效')
    const filePath = path.join(backupDir, backupId)
    const parsed = JSON.parse(await fsp.readFile(filePath, 'utf8'))
    if (parsed.version !== 1 || parsed.id !== backupId) throw new Error('环境备份格式无效')
    return parsed
  }

  async function listBackups() {
    let names
    try { names = await fsp.readdir(backupDir) } catch (error) { if (error.code === 'ENOENT') return []; throw error }
    const result = []
    for (const name of names.filter((item) => item.endsWith('.json'))) {
      try {
        const backup = await readBackup(name)
        result.push({ id: name, app: backup.app, createdAt: backup.createdAt, itemCount: backup.files?.length || backup.registry?.length || 0 })
      } catch { /* 不展示损坏或外部伪造的备份。 */ }
    }
    return result.sort((a, b) => b.createdAt - a.createdAt)
  }

  async function restore(backupId) {
    const backup = await readBackup(backupId)
    if (backup.platform === 'win32') {
      for (const item of backup.registry || []) {
        if (item.registryRoot !== 'HKCU') throw new Error('拒绝恢复系统级注册表环境变量')
        await run('reg', ['add', item.sourcePath, '/v', item.varName, '/t', item.registryType, '/d', item.originalValue, '/f'], { windowsHide: true })
      }
      return { restored: backup.registry?.length || 0 }
    }
    for (const file of backup.files || []) {
      const filePath = safeShellPath(file.relativePath)
      if (typeof file.content !== 'string') throw new Error('环境备份内容无效')
      try { await atomicWrite(filePath, file.content) } catch (error) {
        if (error.code !== 'ENOENT') throw error
        await fsp.mkdir(path.dirname(filePath), { recursive: true })
        await fsp.writeFile(filePath, file.content, { mode: 0o600 })
      }
    }
    return { restored: backup.files?.length || 0 }
  }

  return Object.freeze({ scan, fix, listBackups, restore, getSupportedApps: () => Object.keys(APP_KEYWORDS) })
}

module.exports = { createEnvManager, APP_KEYWORDS, parseLine, maskValue }
