'use strict'

const fs = require('node:fs')
const fsp = require('node:fs/promises')
const path = require('node:path')
const os = require('node:os')
const crypto = require('node:crypto')
const tar = require('tar')
const AdmZip = require('adm-zip')

const SKILL_CLIENT_DIRS = Object.freeze({
  claude: ['.claude', 'skills'],
  'claude-desktop': ['.claude-desktop', 'skills'],
  codex: ['.codex', 'skills'],
  gemini: ['.gemini', 'skills'],
  opencode: ['.config', 'opencode', 'skills'],
  openclaw: ['.openclaw', 'skills'],
  hermes: ['.hermes', 'skills'],
  grokbuild: ['.grok', 'skills']
})

const DEFAULT_REPOS = Object.freeze([
  { owner: 'anthropics', name: 'skills', branch: 'main', enabled: true },
  { owner: 'ComposioHQ', name: 'awesome-claude-skills', branch: 'master', enabled: true },
  { owner: 'cexll', name: 'myclaude', branch: 'master', enabled: true },
  { owner: 'JimLiu', name: 'baoyu-skills', branch: 'main', enabled: true }
])

const MAX_ARCHIVE_BYTES = 50 * 1024 * 1024
const MAX_SCAN_ENTRIES = 10000
const BACKUP_RETAIN_COUNT = 20

function safeDirectory(value) {
  const directory = String(value || '').trim()
  if (!directory || directory === '.' || directory === '..' || directory.startsWith('.') || /[\\/\0\r\n]/.test(directory) || Buffer.byteLength(directory) > 240) {
    throw new Error('Skill 目录名必须是安全的单段名称，且不能以点开头')
  }
  return directory
}

function safeRepoPart(value, label) {
  const part = String(value || '').trim()
  if (!/^[A-Za-z0-9_.-]+$/.test(part) || part === '.' || part === '..') throw new Error(`${label}格式无效`)
  return part
}

function safeBranch(value) {
  const branch = String(value || 'main').trim()
  if (!branch || branch.includes('..') || branch.startsWith('/') || branch.endsWith('/') || !/^[A-Za-z0-9._/-]+$/.test(branch)) {
    throw new Error('Git 分支格式无效')
  }
  return branch
}

function safeRelativePath(value) {
  const input = String(value || '').replace(/\\/g, '/').trim()
  if (!input || input.startsWith('/') || input.includes('\0')) throw new Error('Skill 来源路径无效')
  const parts = input.split('/').filter(Boolean)
  if (!parts.length || parts.some((item) => item === '.' || item === '..')) throw new Error('Skill 来源路径无效')
  return parts.join('/')
}

function parseFrontmatter(content, fallbackName) {
  const text = String(content || '').replace(/^\uFEFF/, '')
  const match = /^---\s*\r?\n([\s\S]*?)\r?\n---/.exec(text)
  const metadata = {}
  if (match) {
    for (const line of match[1].split(/\r?\n/)) {
      const item = /^([A-Za-z][\w-]*):\s*(.*)$/.exec(line)
      if (item) metadata[item[1]] = item[2].trim().replace(/^['"]|['"]$/g, '')
    }
  }
  return { name: metadata.name || fallbackName, description: metadata.description || '' }
}

function createSkillManager(options = {}) {
  const homeDir = path.resolve(options.homeDir)
  const dataDir = path.resolve(options.dataDir)
  const fetchFn = options.fetch || globalThis.fetch
  const statePath = path.join(dataDir, 'skills-state.json')
  const builtInStore = path.join(dataDir, 'skills')
  const backupStore = path.join(dataDir, 'skill-backups')
  const agentsStore = path.join(homeDir, '.agents', 'skills')

  async function readState() {
    try {
      const value = JSON.parse(await fsp.readFile(statePath, 'utf8'))
      return {
        version: 2,
        storage: value.storage === 'agents' ? 'agents' : 'plugin',
        syncMode: value.syncMode === 'copy' ? 'copy' : 'symlink',
        skills: value.skills && typeof value.skills === 'object' ? value.skills : {},
        repos: Array.isArray(value.repos) ? value.repos.map(validateRepo) : DEFAULT_REPOS.map((item) => ({ ...item }))
      }
    } catch (error) {
      if (error.code !== 'ENOENT') throw new Error(`读取 Skills 状态失败: ${error.message}`)
      return { version: 2, storage: 'plugin', syncMode: 'symlink', skills: {}, repos: DEFAULT_REPOS.map((item) => ({ ...item })) }
    }
  }

  async function writeState(state) {
    await fsp.mkdir(dataDir, { recursive: true, mode: 0o700 })
    const temp = `${statePath}.${process.pid}.${Date.now()}.tmp`
    await fsp.writeFile(temp, `${JSON.stringify(state, null, 2)}\n`, { mode: 0o600 })
    await fsp.rename(temp, statePath)
  }

  function validateRepo(input) {
    return {
      owner: safeRepoPart(input?.owner, '仓库所有者'),
      name: safeRepoPart(input?.name, '仓库名'),
      branch: safeBranch(input?.branch),
      enabled: input?.enabled !== false
    }
  }

  function storeFor(state) { return state.storage === 'agents' ? agentsStore : builtInStore }

  function targetFor(client, directory) {
    const parts = SKILL_CLIENT_DIRS[client]
    if (!parts) throw new Error(`不支持的 Skill 客户端: ${client}`)
    return path.join(homeDir, ...parts, directory)
  }

  async function hashDirectory(root) {
    const hash = crypto.createHash('sha256')
    async function walk(directory) {
      const entries = await fsp.readdir(directory, { withFileTypes: true })
      entries.sort((a, b) => a.name.localeCompare(b.name))
      for (const entry of entries) {
        if (entry.name.startsWith('.')) continue
        const fullPath = path.join(directory, entry.name)
        const relative = path.relative(root, fullPath).replace(/\\/g, '/')
        if (entry.isDirectory()) await walk(fullPath)
        else if (entry.isFile()) {
          hash.update(relative); hash.update('\0'); hash.update(await fsp.readFile(fullPath)); hash.update('\0')
        }
      }
    }
    await walk(root)
    return hash.digest('hex')
  }

  async function copyAtomically(source, destination) {
    const parent = path.dirname(destination)
    const temp = path.join(parent, `.${path.basename(destination)}.${process.pid}.${Date.now()}.tmp`)
    await fsp.mkdir(parent, { recursive: true, mode: 0o700 })
    await fsp.rm(temp, { recursive: true, force: true })
    try {
      await fsp.cp(source, temp, { recursive: true, errorOnExist: true, force: false })
      await fsp.rm(destination, { recursive: true, force: true })
      await fsp.rename(temp, destination)
    } catch (error) {
      await fsp.rm(temp, { recursive: true, force: true }).catch(() => {})
      throw error
    }
  }

  async function listSkills() {
    const state = await readState()
    const store = storeFor(state)
    await fsp.mkdir(store, { recursive: true, mode: 0o700 })
    const entries = await fsp.readdir(store, { withFileTypes: true })
    const skills = []
    for (const entry of entries) {
      if (!entry.isDirectory() && !entry.isSymbolicLink()) continue
      let directory
      try { directory = safeDirectory(entry.name) } catch { continue }
      const sourcePath = path.join(store, directory)
      try {
        const skillMd = await fsp.readFile(path.join(sourcePath, 'SKILL.md'), 'utf8')
        const metadata = parseFrontmatter(skillMd, directory)
        const saved = state.skills[directory] || {}
        skills.push({
          id: saved.id || saved.key || `local:${directory}`,
          directory, ...metadata, sourcePath,
          contentHash: await hashDirectory(sourcePath),
          apps: saved.apps || {},
          repoOwner: saved.repoOwner || null,
          repoName: saved.repoName || null,
          repoBranch: saved.repoBranch || null,
          sourceDirectory: saved.sourceDirectory || null,
          readmeUrl: saved.readmeUrl || null,
          installedAt: saved.installedAt || null,
          updatedAt: saved.updatedAt || null
        })
      } catch (error) {
        if (error.code !== 'ENOENT') console.warn('[cc-switch] Skill 扫描失败:', error.message)
      }
    }
    skills.sort((a, b) => a.name.localeCompare(b.name))
    return { skills, storage: state.storage, syncMode: state.syncMode, storePath: store }
  }

  async function createBackup(directory, state, reason = 'remove') {
    const source = path.join(storeFor(state), directory)
    if (!fs.existsSync(path.join(source, 'SKILL.md'))) return null
    await fsp.mkdir(backupStore, { recursive: true, mode: 0o700 })
    const backupId = `${Date.now()}-${directory}-${crypto.randomBytes(3).toString('hex')}`
    const destination = path.join(backupStore, backupId)
    await fsp.mkdir(destination, { recursive: true, mode: 0o700 })
    try {
      await fsp.cp(source, path.join(destination, 'skill'), { recursive: true })
      const metadata = { backupId, createdAt: Date.now(), reason, skill: { directory, ...(state.skills[directory] || {}) } }
      await fsp.writeFile(path.join(destination, 'meta.json'), `${JSON.stringify(metadata, null, 2)}\n`, { mode: 0o600 })
    } catch (error) {
      await fsp.rm(destination, { recursive: true, force: true }).catch(() => {})
      throw error
    }
    const backups = await listSkillBackups()
    await Promise.all(backups.slice(BACKUP_RETAIN_COUNT).map((item) => fsp.rm(path.join(backupStore, item.backupId), { recursive: true, force: true })))
    return { backupId, backupPath: destination }
  }

  async function listSkillBackups() {
    const entries = await fsp.readdir(backupStore, { withFileTypes: true }).catch((error) => error.code === 'ENOENT' ? [] : Promise.reject(error))
    const result = []
    for (const entry of entries) {
      if (!entry.isDirectory() || !/^[A-Za-z0-9._-]+$/.test(entry.name)) continue
      try {
        const metadata = JSON.parse(await fsp.readFile(path.join(backupStore, entry.name, 'meta.json'), 'utf8'))
        if (!fs.existsSync(path.join(backupStore, entry.name, 'skill', 'SKILL.md'))) continue
        result.push({ backupId: entry.name, backupPath: path.join(backupStore, entry.name), createdAt: Number(metadata.createdAt) || 0, reason: metadata.reason || 'remove', skill: metadata.skill || {} })
      } catch (error) { console.warn('[cc-switch] 跳过损坏的 Skill 备份:', error.message) }
    }
    return result.sort((a, b) => b.createdAt - a.createdAt)
  }

  function safeBackupId(value) {
    const id = String(value || '')
    if (!id || !/^[A-Za-z0-9._-]+$/.test(id) || id.includes('..')) throw new Error('Skill 备份 ID 无效')
    return id
  }

  async function restoreSkillBackup(backupIdInput, client) {
    const backupId = safeBackupId(backupIdInput)
    const backupPath = path.join(backupStore, backupId)
    const metadata = JSON.parse(await fsp.readFile(path.join(backupPath, 'meta.json'), 'utf8'))
    const directory = safeDirectory(metadata.skill?.directory)
    const state = await readState()
    if (fs.existsSync(path.join(storeFor(state), directory))) await createBackup(directory, state, 'before-restore')
    await copyAtomically(path.join(backupPath, 'skill'), path.join(storeFor(state), directory))
    state.skills[directory] = { ...(metadata.skill || {}), directory, apps: { ...(metadata.skill?.apps || {}) } }
    if (client) state.skills[directory].apps[String(client)] = true
    await writeState(state)
    for (const [app, enabled] of Object.entries(state.skills[directory].apps || {})) {
      if (enabled) await syncTarget(state, directory, app, true)
    }
    return (await listSkills()).skills.find((item) => item.directory === directory)
  }

  async function deleteSkillBackup(backupIdInput) {
    const backupId = safeBackupId(backupIdInput)
    const target = path.join(backupStore, backupId)
    await fsp.access(path.join(target, 'meta.json'))
    await fsp.rm(target, { recursive: true, force: true })
    return true
  }

  async function importSkill(sourcePath, requestedDirectory) {
    const source = path.resolve(String(sourcePath || ''))
    const stat = await fsp.stat(source).catch(() => null)
    if (!stat?.isDirectory()) throw new Error('Skill 来源必须是存在的目录')
    await fsp.access(path.join(source, 'SKILL.md'))
    const state = await readState()
    const directory = safeDirectory(requestedDirectory || path.basename(source))
    const destination = path.join(storeFor(state), directory)
    if (fs.existsSync(destination)) await createBackup(directory, state, 'before-import')
    await copyAtomically(source, destination)
    state.skills[directory] = { ...(state.skills[directory] || {}), id: `local:${directory}`, apps: state.skills[directory]?.apps || {}, installedAt: state.skills[directory]?.installedAt || Date.now() }
    await writeState(state)
    return (await listSkills()).skills.find((item) => item.directory === directory)
  }

  function safeArchivePath(value) {
    const normalized = String(value || '').replace(/\\/g, '/')
    if (!normalized || normalized.includes('\0') || normalized.startsWith('/') || /^[A-Za-z]:/.test(normalized)) throw new Error('ZIP 包含不安全路径')
    const parts = normalized.split('/').filter(Boolean)
    if (parts.some((part) => part === '.' || part === '..')) throw new Error('ZIP 包含路径穿越条目')
    return parts.join('/')
  }

  async function scanSkillDirectories(root) {
    const result = []
    let visited = 0
    async function walk(directory) {
      if (++visited > MAX_SCAN_ENTRIES) throw new Error('ZIP 目录条目超过安全限制')
      if (fs.existsSync(path.join(directory, 'SKILL.md'))) { result.push(directory); return }
      for (const entry of await fsp.readdir(directory, { withFileTypes: true })) {
        if (entry.isDirectory() && !entry.name.startsWith('.')) await walk(path.join(directory, entry.name))
      }
    }
    await walk(root)
    return result
  }

  async function installSkillsFromZip(filePathInput, client) {
    if (!SKILL_CLIENT_DIRS[client]) throw new Error(`不支持的 Skill 客户端: ${client}`)
    const filePath = path.resolve(String(filePathInput || ''))
    if (path.extname(filePath).toLowerCase() !== '.zip') throw new Error('请选择 .zip 文件')
    const stat = await fsp.lstat(filePath).catch(() => null)
    if (!stat?.isFile() || stat.isSymbolicLink()) throw new Error('ZIP 文件不存在或不是普通文件')
    if (stat.size > MAX_ARCHIVE_BYTES) throw new Error('ZIP 文件超过 50 MB 限制')
    const tempRoot = await fsp.mkdtemp(path.join(os.tmpdir(), 'ztools-skill-zip-'))
    try {
      let archive
      try { archive = new AdmZip(filePath) } catch (error) { throw new Error(`读取 ZIP 失败: ${error.message}`) }
      const entries = archive.getEntries()
      if (!entries.length) throw new Error('ZIP 文件为空')
      if (entries.length > MAX_SCAN_ENTRIES) throw new Error('ZIP 条目超过安全限制')
      const symlinks = []
      let totalBytes = 0
      for (const entry of entries) {
        const relative = safeArchivePath(entry.entryName)
        if (!relative) continue
        const target = path.resolve(tempRoot, relative)
        if (target !== tempRoot && !target.startsWith(`${tempRoot}${path.sep}`)) throw new Error('ZIP 包含路径穿越条目')
        // adm-zip exposes the external Unix attributes on entry.attr. Some
        // releases also mirror them on header.attr, so accept both shapes.
        const externalAttributes = Number(entry.attr ?? entry.header?.attr ?? entry.header?.externalFileAttributes ?? 0) >>> 0
        const mode = externalAttributes >>> 16
        const isSymlink = (mode & 0o170000) === 0o120000
        totalBytes += Number(entry.header?.size || 0)
        if (totalBytes > 200 * 1024 * 1024) throw new Error('ZIP 解压内容超过 200 MB 限制')
        if (entry.isDirectory) { await fsp.mkdir(target, { recursive: true, mode: 0o700 }); continue }
        const data = entry.getData()
        if (isSymlink) { symlinks.push({ target, linkTarget: data.toString('utf8').trim() }); continue }
        await fsp.mkdir(path.dirname(target), { recursive: true, mode: 0o700 })
        await fsp.writeFile(target, data, { mode: 0o600 })
      }
      for (const item of symlinks) {
        if (!item.linkTarget || path.isAbsolute(item.linkTarget) || item.linkTarget.includes('\0')) continue
        const resolved = path.resolve(path.dirname(item.target), item.linkTarget)
        if (resolved !== tempRoot && !resolved.startsWith(`${tempRoot}${path.sep}`)) continue
        const resolvedStat = await fsp.lstat(resolved).catch(() => null)
        if (!resolvedStat || resolvedStat.isSymbolicLink()) continue
        await fsp.mkdir(path.dirname(item.target), { recursive: true, mode: 0o700 })
        if (resolvedStat.isDirectory()) await fsp.cp(resolved, item.target, { recursive: true })
        else if (resolvedStat.isFile()) await fsp.copyFile(resolved, item.target)
      }

      const skillDirectories = await scanSkillDirectories(tempRoot)
      if (!skillDirectories.length) throw new Error('ZIP 中未找到 SKILL.md')
      const state = await readState(); const store = storeFor(state)
      await fsp.mkdir(store, { recursive: true, mode: 0o700 })
      const existing = new Set([...(await fsp.readdir(store).catch(() => [])), ...Object.keys(state.skills)].map((value) => value.toLowerCase()))
      const installedDirectories = []
      const archiveStem = path.basename(filePath, path.extname(filePath))
      for (const source of skillDirectories) {
        const metadata = parseFrontmatter(await fsp.readFile(path.join(source, 'SKILL.md'), 'utf8'), path.basename(source))
        const candidate = source === tempRoot ? (metadata.name || archiveStem) : path.basename(source)
        let directory
        try { directory = safeDirectory(candidate) } catch { directory = safeDirectory(archiveStem) }
        if (existing.has(directory.toLowerCase())) continue
        await copyAtomically(source, path.join(store, directory))
        state.skills[directory] = { id: `local:${directory}`, apps: { [client]: true }, installedAt: Date.now(), updatedAt: Date.now(), sourceZip: path.basename(filePath) }
        existing.add(directory.toLowerCase()); installedDirectories.push(directory)
      }
      if (!installedDirectories.length) return []
      await writeState(state)
      for (const directory of installedDirectories) await syncTarget(state, directory, client, true)
      const installedSet = new Set(installedDirectories)
      return (await listSkills()).skills.filter((item) => installedSet.has(item.directory))
    } finally { await fsp.rm(tempRoot, { recursive: true, force: true }).catch(() => {}) }
  }

  async function syncTarget(state, directory, client, enabled) {
    const source = path.join(storeFor(state), directory)
    const target = targetFor(client, directory)
    if (!enabled) {
      await fsp.rm(target, { recursive: true, force: true })
      return target
    }
    await fsp.access(path.join(source, 'SKILL.md'))
    await fsp.mkdir(path.dirname(target), { recursive: true, mode: 0o700 })
    await fsp.rm(target, { recursive: true, force: true })
    if (state.syncMode === 'copy') await fsp.cp(source, target, { recursive: true })
    else await fsp.symlink(source, target, process.platform === 'win32' ? 'junction' : 'dir')
    return target
  }

  async function setSkillEnabled(directoryInput, client, enabled) {
    const directory = safeDirectory(directoryInput)
    if (!SKILL_CLIENT_DIRS[client]) throw new Error(`不支持的 Skill 客户端: ${client}`)
    const state = await readState()
    const target = targetFor(client, directory)
    const previouslyManaged = state.skills[directory]?.apps?.[client] === true
    if (enabled && fs.existsSync(target) && !previouslyManaged) throw new Error(`目标已存在且不由插件管理: ${target}`)
    state.skills[directory] = state.skills[directory] || { id: `local:${directory}`, apps: {} }
    await syncTarget(state, directory, client, Boolean(enabled))
    state.skills[directory].apps[client] = Boolean(enabled)
    await writeState(state)
    return { directory, client, enabled: Boolean(enabled), target }
  }

  async function removeSkill(directoryInput) {
    const directory = safeDirectory(directoryInput)
    const state = await readState()
    const backup = await createBackup(directory, state, 'remove')
    for (const client of Object.keys(SKILL_CLIENT_DIRS)) {
      if (state.skills[directory]?.apps?.[client]) await fsp.rm(targetFor(client, directory), { recursive: true, force: true })
    }
    await fsp.rm(path.join(storeFor(state), directory), { recursive: true, force: true })
    delete state.skills[directory]
    await writeState(state)
    return { removed: true, backupPath: backup?.backupPath || null, backupId: backup?.backupId || null }
  }

  async function updateSettings(patch = {}) {
    const state = await readState()
    const previousStore = storeFor(state)
    const previousSyncMode = state.syncMode
    if (patch.syncMode) state.syncMode = patch.syncMode === 'copy' ? 'copy' : 'symlink'
    if (patch.storage) state.storage = patch.storage === 'agents' ? 'agents' : 'plugin'
    const nextStore = storeFor(state)
    if (previousStore !== nextStore) {
      await fsp.mkdir(nextStore, { recursive: true, mode: 0o700 })
      for (const entry of await fsp.readdir(previousStore, { withFileTypes: true }).catch(() => [])) {
        if (!entry.isDirectory() && !entry.isSymbolicLink()) continue
        let directory
        try { directory = safeDirectory(entry.name) } catch { continue }
        const destination = path.join(nextStore, directory)
        if (!fs.existsSync(destination)) await fsp.rename(path.join(previousStore, directory), destination).catch(async () => {
          await fsp.cp(path.join(previousStore, directory), destination, { recursive: true }); await fsp.rm(path.join(previousStore, directory), { recursive: true, force: true })
        })
      }
    }
    if (previousStore !== nextStore || previousSyncMode !== state.syncMode) {
      for (const [directory, item] of Object.entries(state.skills)) {
        for (const [client, enabled] of Object.entries(item.apps || {})) if (enabled) await syncTarget(state, directory, client, true)
      }
    }
    await writeState(state)
    return listSkills()
  }

  async function fetchWithTimeout(url, timeoutMs = 20000) {
    if (typeof fetchFn !== 'function') throw new Error('当前 Node.js 运行时不支持 fetch')
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), timeoutMs)
    try { return await fetchFn(url, { signal: controller.signal, headers: { 'user-agent': 'ztools-ai-provider-switch' } }) }
    catch (error) { throw new Error(error.name === 'AbortError' ? '网络请求超时' : `网络请求失败: ${error.message}`) }
    finally { clearTimeout(timer) }
  }

  async function downloadRepo(repoInput) {
    const repo = validateRepo(repoInput)
    const tempRoot = await fsp.mkdtemp(path.join(os.tmpdir(), 'ztools-skill-repo-'))
    const archivePath = path.join(tempRoot, 'repo.tgz')
    const extractPath = path.join(tempRoot, 'repo')
    const branches = [...new Set([repo.branch, 'main', 'master'])]
    let lastError
    for (const branch of branches) {
      try {
        const url = `https://codeload.github.com/${repo.owner}/${repo.name}/tar.gz/${encodeURIComponent(branch)}`
        const response = await fetchWithTimeout(url, 60000)
        if (!response.ok) throw new Error(`HTTP ${response.status}`)
        const declared = Number(response.headers?.get?.('content-length') || 0)
        if (declared > MAX_ARCHIVE_BYTES) throw new Error('仓库压缩包超过 50 MB 限制')
        const body = Buffer.from(await response.arrayBuffer())
        if (!body.length || body.length > MAX_ARCHIVE_BYTES) throw new Error('仓库压缩包为空或超过 50 MB 限制')
        await fsp.writeFile(archivePath, body, { mode: 0o600 })
        await fsp.rm(extractPath, { recursive: true, force: true })
        await fsp.mkdir(extractPath, { recursive: true, mode: 0o700 })
        await tar.x({
          file: archivePath, cwd: extractPath, strip: 1, strict: true,
          filter: (entryPath, entry) => {
            const normalized = String(entryPath).replace(/\\/g, '/')
            return !path.posix.isAbsolute(normalized) && !normalized.split('/').includes('..') && !entry?.isSymbolicLink?.() && !entry?.isLink?.()
          }
        })
        if (!(await fsp.readdir(extractPath)).length) throw new Error('仓库压缩包没有可用内容')
        return { root: extractPath, branch, cleanup: () => fsp.rm(tempRoot, { recursive: true, force: true }) }
      } catch (error) { lastError = error }
    }
    await fsp.rm(tempRoot, { recursive: true, force: true }).catch(() => {})
    throw new Error(`下载 ${repo.owner}/${repo.name} 失败: ${lastError?.message || '未知错误'}`)
  }

  async function scanRepo(root, repoInput) {
    const repo = validateRepo(repoInput)
    const skills = []
    let scanned = 0
    async function walk(directory) {
      if (++scanned > MAX_SCAN_ENTRIES) throw new Error('仓库目录项过多，已停止扫描')
      const skillPath = path.join(directory, 'SKILL.md')
      if (fs.existsSync(skillPath)) {
        const relative = path.relative(root, directory).replace(/\\/g, '/') || repo.name
        const sourceDirectory = safeRelativePath(relative)
        const installDirectory = safeDirectory(path.basename(directory))
        const metadata = parseFrontmatter(await fsp.readFile(skillPath, 'utf8'), installDirectory)
        const docPath = relative === repo.name && directory === root ? 'SKILL.md' : `${relative}/SKILL.md`
        skills.push({
          key: `${repo.owner}/${repo.name}:${sourceDirectory}`,
          ...metadata,
          directory: sourceDirectory,
          installDirectory,
          readmeUrl: `https://github.com/${repo.owner}/${repo.name}/blob/${repo.branch}/${docPath}`,
          repoOwner: repo.owner, repoName: repo.name, repoBranch: repo.branch
        })
        return
      }
      for (const entry of await fsp.readdir(directory, { withFileTypes: true })) {
        if (entry.name.startsWith('.') || !entry.isDirectory()) continue
        await walk(path.join(directory, entry.name))
      }
    }
    await walk(root)
    return skills
  }

  async function resolveSkillSource(root, rawDirectory, repoName) {
    const relative = safeRelativePath(rawDirectory)
    if (relative === repoName && fs.existsSync(path.join(root, 'SKILL.md'))) return root
    const direct = path.resolve(root, relative)
    const canonicalRoot = path.resolve(root)
    if ((direct === canonicalRoot || direct.startsWith(`${canonicalRoot}${path.sep}`)) && fs.existsSync(path.join(direct, 'SKILL.md'))) return direct
    const wanted = safeDirectory(path.posix.basename(relative))
    async function walk(directory, depth = 0) {
      if (depth > 4) return null
      for (const entry of await fsp.readdir(directory, { withFileTypes: true })) {
        if (entry.name.startsWith('.') || !entry.isDirectory()) continue
        const candidate = path.join(directory, entry.name)
        if (entry.name.toLowerCase() === wanted.toLowerCase() && fs.existsSync(path.join(candidate, 'SKILL.md'))) return candidate
        const nested = await walk(candidate, depth + 1)
        if (nested) return nested
      }
      return null
    }
    if (fs.existsSync(path.join(root, 'SKILL.md')) && path.basename(root).toLowerCase() === wanted.toLowerCase()) return root
    const found = await walk(root)
    if (!found) throw new Error(`仓库中未找到 Skill 目录: ${relative}`)
    return found
  }

  async function listSkillRepos() { return (await readState()).repos }

  async function addSkillRepo(repoInput) {
    const repo = validateRepo(repoInput)
    const state = await readState()
    const index = state.repos.findIndex((item) => item.owner.toLowerCase() === repo.owner.toLowerCase() && item.name.toLowerCase() === repo.name.toLowerCase())
    if (index >= 0) state.repos[index] = repo
    else state.repos.push(repo)
    await writeState(state)
    return state.repos
  }

  async function removeSkillRepo(ownerInput, nameInput) {
    const owner = safeRepoPart(ownerInput, '仓库所有者')
    const name = safeRepoPart(nameInput, '仓库名')
    const state = await readState()
    state.repos = state.repos.filter((item) => !(item.owner.toLowerCase() === owner.toLowerCase() && item.name.toLowerCase() === name.toLowerCase()))
    await writeState(state)
    return state.repos
  }

  async function discoverSkills() {
    const repos = (await readState()).repos.filter((item) => item.enabled)
    const installed = new Set((await listSkills()).skills.map((item) => item.directory.toLowerCase()))
    const skills = []
    const errors = []
    for (const repo of repos) {
      let download
      try {
        download = await downloadRepo(repo)
        skills.push(...(await scanRepo(download.root, { ...repo, branch: download.branch })))
      } catch (error) { errors.push(`${repo.owner}/${repo.name}: ${error.message}`) }
      finally { await download?.cleanup?.().catch(() => {}) }
    }
    const unique = [...new Map(skills.map((item) => [item.key.toLowerCase(), item])).values()]
    unique.forEach((item) => { item.installed = installed.has(item.installDirectory.toLowerCase()) })
    unique.sort((a, b) => a.name.localeCompare(b.name))
    return { skills: unique, errors }
  }

  async function installDiscoveredSkill(input, client = 'claude') {
    if (!SKILL_CLIENT_DIRS[client]) throw new Error(`不支持的 Skill 客户端: ${client}`)
    const repo = validateRepo({ owner: input?.repoOwner, name: input?.repoName, branch: input?.repoBranch, enabled: true })
    const sourceDirectory = safeRelativePath(input?.directory)
    const directory = safeDirectory(input?.installDirectory || path.posix.basename(sourceDirectory))
    const state = await readState()
    const existing = state.skills[directory]
    if (existing && (existing.repoOwner !== repo.owner || existing.repoName !== repo.name)) throw new Error(`安装目录 ${directory} 已被其他 Skill 使用`)
    const download = await downloadRepo(repo)
    try {
      const source = await resolveSkillSource(download.root, sourceDirectory, repo.name)
      if (fs.existsSync(path.join(storeFor(state), directory))) await createBackup(directory, state, 'before-install')
      await copyAtomically(source, path.join(storeFor(state), directory))
      const metadata = parseFrontmatter(await fsp.readFile(path.join(source, 'SKILL.md'), 'utf8'), directory)
      state.skills[directory] = {
        id: input.key || `${repo.owner}/${repo.name}:${sourceDirectory}`,
        apps: { ...(existing?.apps || {}), [client]: true },
        repoOwner: repo.owner, repoName: repo.name, repoBranch: download.branch,
        sourceDirectory, readmeUrl: input.readmeUrl || null,
        installedAt: existing?.installedAt || Date.now(), updatedAt: Date.now(), ...metadata
      }
      await writeState(state)
      await syncTarget(state, directory, client, true)
      return (await listSkills()).skills.find((item) => item.directory === directory)
    } finally { await download.cleanup().catch(() => {}) }
  }

  async function checkSkillUpdates() {
    const state = await readState()
    const updates = []
    const groups = new Map()
    for (const [directory, item] of Object.entries(state.skills)) {
      if (!item.repoOwner || !item.repoName || !item.sourceDirectory) continue
      const key = `${item.repoOwner}/${item.repoName}#${item.repoBranch || 'main'}`
      if (!groups.has(key)) groups.set(key, [])
      groups.get(key).push({ directory, ...item })
    }
    for (const group of groups.values()) {
      const first = group[0]
      let download
      try {
        download = await downloadRepo({ owner: first.repoOwner, name: first.repoName, branch: first.repoBranch, enabled: true })
        for (const item of group) {
          let source
          try { source = await resolveSkillSource(download.root, item.sourceDirectory, item.repoName) } catch { continue }
          const remoteHash = await hashDirectory(source)
          const local = path.join(storeFor(state), item.directory)
          const currentHash = fs.existsSync(local) ? await hashDirectory(local) : null
          if (remoteHash !== currentHash) updates.push({ id: item.id, directory: item.directory, name: item.name || item.directory, currentHash, remoteHash })
        }
      } catch (error) { console.warn('[cc-switch] Skill 更新检查失败:', error.message) }
      finally { await download?.cleanup?.().catch(() => {}) }
    }
    return updates
  }

  async function updateSkill(directoryInput) {
    const directory = safeDirectory(directoryInput)
    const state = await readState()
    const item = state.skills[directory]
    if (!item?.repoOwner || !item?.repoName || !item?.sourceDirectory) throw new Error('本地 Skill 没有远程仓库信息，无法更新')
    const download = await downloadRepo({ owner: item.repoOwner, name: item.repoName, branch: item.repoBranch, enabled: true })
    try {
      const source = await resolveSkillSource(download.root, item.sourceDirectory, item.repoName)
      await createBackup(directory, state, 'before-update')
      await copyAtomically(source, path.join(storeFor(state), directory))
      const metadata = parseFrontmatter(await fsp.readFile(path.join(source, 'SKILL.md'), 'utf8'), directory)
      state.skills[directory] = { ...item, ...metadata, repoBranch: download.branch, updatedAt: Date.now() }
      await writeState(state)
      for (const [client, enabled] of Object.entries(item.apps || {})) if (enabled) await syncTarget(state, directory, client, true)
      return (await listSkills()).skills.find((entry) => entry.directory === directory)
    } finally { await download.cleanup().catch(() => {}) }
  }

  async function scanUnmanagedSkills() {
    const state = await readState()
    const managed = new Set()
    for (const [directory, item] of Object.entries(state.skills)) {
      for (const [client, enabled] of Object.entries(item.apps || {})) if (enabled) managed.add(`${client}:${directory}`)
    }
    const found = new Map()
    for (const client of Object.keys(SKILL_CLIENT_DIRS)) {
      const clientRoot = path.join(homeDir, ...SKILL_CLIENT_DIRS[client])
      for (const entry of await fsp.readdir(clientRoot, { withFileTypes: true }).catch(() => [])) {
        if ((!entry.isDirectory() && !entry.isSymbolicLink()) || managed.has(`${client}:${entry.name}`)) continue
        let directory
        try { directory = safeDirectory(entry.name) } catch { continue }
        const source = path.join(clientRoot, directory)
        try {
          const metadata = parseFrontmatter(await fsp.readFile(path.join(source, 'SKILL.md'), 'utf8'), directory)
          const item = found.get(directory) || { directory, ...metadata, apps: {}, sourcePaths: {} }
          item.apps[client] = true; item.sourcePaths[client] = source; found.set(directory, item)
        } catch {}
      }
    }
    return [...found.values()].sort((a, b) => a.name.localeCompare(b.name))
  }

  async function importUnmanagedSkills(selections = []) {
    const imported = []
    for (const selection of selections) {
      const directory = safeDirectory(selection.directory)
      const apps = Object.fromEntries(Object.entries(selection.apps || {}).filter(([client, enabled]) => SKILL_CLIENT_DIRS[client] && enabled))
      const firstClient = Object.keys(apps)[0]
      if (!firstClient) continue
      const source = targetFor(firstClient, directory)
      const state = await readState()
      const staging = await fsp.mkdtemp(path.join(os.tmpdir(), 'ztools-skill-import-'))
      try {
        await fsp.cp(source, path.join(staging, directory), { recursive: true })
        await copyAtomically(path.join(staging, directory), path.join(storeFor(state), directory))
        state.skills[directory] = { id: `local:${directory}`, apps, installedAt: Date.now() }
        await writeState(state)
        for (const client of Object.keys(apps)) await syncTarget(state, directory, client, true)
        imported.push((await listSkills()).skills.find((item) => item.directory === directory))
      } finally { await fsp.rm(staging, { recursive: true, force: true }) }
    }
    return imported
  }

  async function searchSkillsSh(queryInput, limitInput = 30, offsetInput = 0) {
    const query = String(queryInput || '').trim().slice(0, 100)
    if (!query) return { skills: [], totalCount: 0, query: '' }
    const limit = Math.max(1, Math.min(50, Number(limitInput) || 30))
    const offset = Math.max(0, Number(offsetInput) || 0)
    const response = await fetchWithTimeout(`https://skills.sh/api/search?q=${encodeURIComponent(query)}&limit=${limit}&offset=${offset}`, 10000)
    if (!response.ok) throw new Error(`skills.sh 搜索失败: HTTP ${response.status}`)
    const payload = await response.json()
    const skills = (Array.isArray(payload.skills) ? payload.skills : []).flatMap((item) => {
      const [owner, name, extra] = String(item.source || '').split('/')
      if (!owner || !name || extra || owner.includes('.') || name.includes('.')) return []
      try {
        const repo = validateRepo({ owner, name, branch: 'main', enabled: true })
        return [{ key: String(item.id || `${owner}/${name}:${item.skillId}`), name: String(item.name || item.skillId), description: '', directory: safeRelativePath(item.skillId), installDirectory: safeDirectory(path.posix.basename(item.skillId)), repoOwner: repo.owner, repoName: repo.name, repoBranch: repo.branch, installs: Number(item.installs) || 0, readmeUrl: `https://github.com/${owner}/${name}` }]
      } catch { return [] }
    })
    return { skills, totalCount: Number(payload.count) || skills.length, query: String(payload.query || query) }
  }

  return {
    listSkills, importSkill, installSkillsFromZip, setSkillEnabled, removeSkill, updateSettings,
    listSkillBackups, restoreSkillBackup, deleteSkillBackup,
    listSkillRepos, addSkillRepo, removeSkillRepo, discoverSkills,
    installDiscoveredSkill, checkSkillUpdates, updateSkill,
    scanUnmanagedSkills, importUnmanagedSkills, searchSkillsSh
  }
}

module.exports = { SKILL_CLIENT_DIRS, DEFAULT_REPOS, parseFrontmatter, createSkillManager }
