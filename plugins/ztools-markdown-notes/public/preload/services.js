'use strict'

const crypto = require('node:crypto')
const path = require('node:path')
const { pathToFileURL } = require('node:url')
const { createReadStream } = require('node:fs')
const fs = require('node:fs/promises')

const IDENTITY_FILE = '.znotes-workspace.json'
const RESERVED_NAMES = new Set([IDENTITY_FILE, '.assets', '.trash'])
const WINDOWS_RESERVED_NAMES = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\..*)?$/i

function isReservedName(name) {
  return RESERVED_NAMES.has(name.toLowerCase())
}

class WorkspaceError extends Error {
  constructor(code, message) {
    super(message)
    this.name = 'WorkspaceError'
    this.code = code
  }
}

function assertAbsoluteRoot(rootPath) {
  if (typeof rootPath !== 'string' || !path.isAbsolute(rootPath)) {
    throw new WorkspaceError('INVALID_ROOT', '工作区必须是绝对路径')
  }
  return path.resolve(rootPath)
}

function assertWorkspaceName(name) {
  const normalized = typeof name === 'string' ? name.trim() : ''
  if (!normalized) throw new WorkspaceError('INVALID_NAME', '工作区名称不能为空')
  return normalized
}

function resolveWorkspacePath(rootPath, relativePath) {
  const root = assertAbsoluteRoot(rootPath)
  if (typeof relativePath !== 'string' || path.isAbsolute(relativePath)) {
    throw new WorkspaceError('INVALID_PATH', '必须使用工作区相对路径')
  }

  const segments = relativePath.replaceAll('\\', '/').split('/').filter(Boolean)
  if (segments.length === 0 || segments.some((segment) => segment === '..')) {
    throw new WorkspaceError('PATH_OUTSIDE_WORKSPACE', '路径不能离开工作区')
  }
  if (segments.some(isReservedName)) {
    throw new WorkspaceError('RESERVED_PATH', '不能通过普通笔记操作访问保留目录')
  }

  const resolved = path.resolve(root, ...segments)
  const relative = path.relative(root, resolved)
  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new WorkspaceError('PATH_OUTSIDE_WORKSPACE', '路径不能离开工作区')
  }
  return resolved
}

function assertContainedPath(rootPath, candidatePath) {
  const relative = path.relative(rootPath, candidatePath)
  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new WorkspaceError('PATH_OUTSIDE_WORKSPACE', '路径不能离开工作区')
  }
}

async function assertRealPathContained(rootPath, candidatePath) {
  const [realRoot, realCandidate] = await Promise.all([fs.realpath(rootPath), fs.realpath(candidatePath)])
  assertContainedPath(realRoot, realCandidate)
}

function assertMarkdownPath(relativePath) {
  if (path.extname(relativePath).toLowerCase() !== '.md') {
    throw new WorkspaceError('INVALID_NOTE_PATH', '笔记路径必须以 .md 结尾')
  }
}

function assertEntryName(name) {
  const normalized = typeof name === 'string' ? name.trim() : ''
  if (!normalized) throw new WorkspaceError('INVALID_ENTRY_NAME', '名称不能为空')
  if (/[\\/:*?"<>|]/.test(normalized) || normalized === '.' || normalized === '..') {
    throw new WorkspaceError('INVALID_ENTRY_NAME', '名称包含 Windows 不允许的字符')
  }
  if (/[. ]$/.test(normalized) || WINDOWS_RESERVED_NAMES.test(normalized) || isReservedName(normalized)) {
    throw new WorkspaceError('INVALID_ENTRY_NAME', '该名称不能用于笔记或文件夹')
  }
  return normalized
}

async function createEntry(rootPath, parentRelativePath, name, kind) {
  const root = assertAbsoluteRoot(rootPath)
  const parent = parentRelativePath ? resolveWorkspacePath(root, parentRelativePath) : root
  await assertRealPathContained(root, parent)

  const entryName = assertEntryName(name)
  const fileName = kind === 'note' && path.extname(entryName).toLowerCase() !== '.md' ? `${entryName}.md` : entryName
  if (kind === 'note') assertMarkdownPath(fileName)
  const entryPath = path.join(parent, fileName)

  try {
    if (kind === 'directory') {
      await fs.mkdir(entryPath)
    } else {
      const handle = await fs.open(entryPath, 'wx')
      await handle.close()
    }
  } catch (error) {
    if (error && error.code === 'EEXIST') throw new WorkspaceError('ENTRY_EXISTS', '目标位置已存在同名项目')
    throw error
  }

  return path.relative(root, entryPath).split(path.sep).join('/')
}

async function createNote(rootPath, parentRelativePath, name) {
  return createEntry(rootPath, parentRelativePath, name, 'note')
}

async function createDirectory(rootPath, parentRelativePath, name) {
  return createEntry(rootPath, parentRelativePath, name, 'directory')
}

async function assertEntryDoesNotExist(entryPath) {
  try {
    await fs.access(entryPath)
    throw new WorkspaceError('ENTRY_EXISTS', '目标位置已存在同名项目')
  } catch (error) {
    if (error instanceof WorkspaceError) throw error
    if (!error || error.code !== 'ENOENT') throw error
  }
}

async function renameEntry(rootPath, relativePath, name) {
  const root = assertAbsoluteRoot(rootPath)
  const sourcePath = resolveWorkspacePath(root, relativePath)
  await assertRealPathContained(root, sourcePath)
  const stats = await fs.stat(sourcePath)
  if (!stats.isFile() && !stats.isDirectory()) throw new WorkspaceError('INVALID_ENTRY', '只能重命名笔记或文件夹')

  const entryName = assertEntryName(name)
  const targetName = stats.isFile() && path.extname(entryName).toLowerCase() !== '.md' ? `${entryName}.md` : entryName
  if (stats.isFile()) assertMarkdownPath(targetName)
  const targetPath = path.join(path.dirname(sourcePath), targetName)
  if (targetPath === sourcePath) return relativePath
  await assertEntryDoesNotExist(targetPath)
  await fs.rename(sourcePath, targetPath)
  return path.relative(root, targetPath).split(path.sep).join('/')
}

function rewriteMovedNoteLinks(content, oldNotePath, newNotePath, oldEntryPath, newEntryPath) {
  return content.replace(/(!?\[[^\]]*\]\()([^\s)]+)(\))/g, (match, prefix, href, suffix) => {
    if (/^(?:[a-z][a-z\d+.-]*:|#|\/)/i.test(href)) return match
    const hashIndex = href.search(/[?#]/)
    const pathPart = hashIndex === -1 ? href : href.slice(0, hashIndex)
    const ending = hashIndex === -1 ? '' : href.slice(hashIndex)
    let oldTarget
    try { oldTarget = path.resolve(path.dirname(oldNotePath), decodeURIComponent(pathPart)) } catch { return match }
    const insideMovedEntry = oldTarget === oldEntryPath || oldTarget.startsWith(`${oldEntryPath}${path.sep}`)
    const newTarget = insideMovedEntry ? `${newEntryPath}${oldTarget.slice(oldEntryPath.length)}` : oldTarget
    let relative = path.relative(path.dirname(newNotePath), newTarget).split(path.sep).join('/')
    if (!relative) relative = path.basename(newTarget)
    return `${prefix}${encodeURI(relative)}${ending}${suffix}`
  })
}

async function collectMarkdownFiles(entryPath) {
  const stats = await fs.stat(entryPath)
  if (stats.isFile()) return path.extname(entryPath).toLowerCase() === '.md' ? [entryPath] : []
  const files = []
  for (const entry of await fs.readdir(entryPath, { withFileTypes: true })) {
    const childPath = path.join(entryPath, entry.name)
    if (entry.isDirectory()) files.push(...await collectMarkdownFiles(childPath))
    else if (entry.isFile() && path.extname(entry.name).toLowerCase() === '.md') files.push(childPath)
  }
  return files
}

async function moveEntry(rootPath, relativePath, targetDirectoryPath) {
  const root = assertAbsoluteRoot(rootPath)
  const sourcePath = resolveWorkspacePath(root, relativePath)
  const targetDirectory = targetDirectoryPath ? resolveWorkspacePath(root, targetDirectoryPath) : root
  await Promise.all([assertRealPathContained(root, sourcePath), assertRealPathContained(root, targetDirectory)])
  const sourceStats = await fs.stat(sourcePath)
  const targetStats = await fs.stat(targetDirectory)
  if (!targetStats.isDirectory()) throw new WorkspaceError('INVALID_MOVE_TARGET', '只能移动到文件夹中')
  if (sourceStats.isDirectory() && (targetDirectory === sourcePath || targetDirectory.startsWith(`${sourcePath}${path.sep}`))) {
    throw new WorkspaceError('INVALID_MOVE_TARGET', '不能把文件夹移动到自身或其子文件夹中')
  }
  const targetPath = path.join(targetDirectory, path.basename(sourcePath))
  if (targetPath === sourcePath) return relativePath.replaceAll('\\', '/')
  await assertEntryDoesNotExist(targetPath)

  const noteFiles = await collectMarkdownFiles(sourcePath)
  const rewrites = await Promise.all(noteFiles.map(async (oldNotePath) => {
    const content = await fs.readFile(oldNotePath, 'utf8')
    const stats = await fs.stat(oldNotePath)
    const newNotePath = `${targetPath}${oldNotePath.slice(sourcePath.length)}`
    return { oldNotePath, newNotePath, content, modifiedAt: stats.mtimeMs, rewritten: rewriteMovedNoteLinks(content, oldNotePath, newNotePath, sourcePath, targetPath) }
  }))
  for (const note of rewrites) {
    if ((await fs.stat(note.oldNotePath)).mtimeMs !== note.modifiedAt) throw new WorkspaceError('EXTERNAL_MODIFICATION', '移动前检测到笔记已被外部修改')
  }
  await fs.rename(sourcePath, targetPath)
  try {
    for (const note of rewrites) {
      if (note.rewritten === note.content) continue
      const temporaryPath = `${note.newNotePath}.znotes-${crypto.randomUUID()}.tmp`
      try {
        const handle = await fs.open(temporaryPath, 'wx')
        try {
          await handle.writeFile(note.rewritten, 'utf8')
          await handle.sync()
        } finally {
          await handle.close()
        }
        await fs.rename(temporaryPath, note.newNotePath)
      } catch (error) {
        await fs.rm(temporaryPath, { force: true }).catch(() => undefined)
        throw error
      }
    }
  } catch (error) {
    await fs.rename(targetPath, sourcePath).catch(() => undefined)
    throw error
  }
  return path.relative(root, targetPath).split(path.sep).join('/')
}

async function showEntryInFolder(rootPath, relativePath) {
  const root = assertAbsoluteRoot(rootPath)
  const entryPath = resolveWorkspacePath(root, relativePath)
  await assertRealPathContained(root, entryPath)
  const stats = await fs.stat(entryPath)
  const folderPath = stats.isDirectory() ? entryPath : path.dirname(entryPath)
  if (typeof window === 'undefined' || !window.ztools?.shellOpenPath?.(folderPath)) {
    throw new WorkspaceError('OPEN_FOLDER_FAILED', '无法打开资源管理器')
  }
}

async function moveEntryToTrash(rootPath, relativePath) {
  const root = assertAbsoluteRoot(rootPath)
  const sourcePath = resolveWorkspacePath(root, relativePath)
  await assertRealPathContained(root, sourcePath)
  const stats = await fs.stat(sourcePath)
  if (!stats.isFile() && !stats.isDirectory()) throw new WorkspaceError('INVALID_ENTRY', '只能删除笔记或文件夹')

  const trashId = crypto.randomUUID()
  const trashItemPath = path.join(root, '.trash', trashId)
  await fs.mkdir(trashItemPath)
  try {
    await fs.rename(sourcePath, path.join(trashItemPath, 'entry'))
    const metadata = {
      id: trashId,
      originalPath: relativePath.replaceAll('\\', '/'),
      deletedAt: new Date().toISOString(),
      kind: stats.isDirectory() ? 'directory' : 'note',
    }
    await fs.writeFile(path.join(trashItemPath, 'metadata.json'), `${JSON.stringify(metadata, null, 2)}\n`, {
      encoding: 'utf8',
      flag: 'wx',
    })
    return metadata
  } catch (error) {
    await fs.rename(path.join(trashItemPath, 'entry'), sourcePath).catch(() => undefined)
    await fs.rm(trashItemPath, { recursive: true, force: true }).catch(() => undefined)
    throw error
  }
}

function assertTrashId(id) {
  if (typeof id !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id)) {
    throw new WorkspaceError('INVALID_TRASH_ID', '回收站项目无效')
  }
  return id
}

async function readTrashMetadata(root, id) {
  const trashId = assertTrashId(id)
  const itemPath = path.join(root, '.trash', trashId)
  let metadata
  try {
    metadata = JSON.parse(await fs.readFile(path.join(itemPath, 'metadata.json'), 'utf8'))
  } catch (error) {
    if (error && error.code === 'ENOENT') throw new WorkspaceError('TRASH_ITEM_NOT_FOUND', '回收站项目不存在')
    throw new WorkspaceError('INVALID_TRASH_ITEM', '回收站项目记录已损坏')
  }
  if (
    !metadata || metadata.id !== trashId || typeof metadata.originalPath !== 'string' ||
    typeof metadata.deletedAt !== 'string' || !['note', 'directory'].includes(metadata.kind)
  ) {
    throw new WorkspaceError('INVALID_TRASH_ITEM', '回收站项目记录已损坏')
  }
  resolveWorkspacePath(root, metadata.originalPath)
  await fs.access(path.join(itemPath, 'entry'))
  return { itemPath, metadata }
}

async function listTrash(rootPath) {
  const root = assertAbsoluteRoot(rootPath)
  await readIdentity(root)
  const trashPath = path.join(root, '.trash')
  const entries = await fs.readdir(trashPath, { withFileTypes: true })
  const items = []
  for (const entry of entries) {
    if (!entry.isDirectory()) continue
    try {
      const { metadata } = await readTrashMetadata(root, entry.name)
      items.push(metadata)
    } catch {
      // Keep damaged entries on disk; they must never disappear silently.
    }
  }
  return items.sort((left, right) => right.deletedAt.localeCompare(left.deletedAt))
}

async function restoreTrashItem(rootPath, id, targetRelativePath) {
  const root = assertAbsoluteRoot(rootPath)
  const { itemPath, metadata } = await readTrashMetadata(root, id)
  const relativePath = typeof targetRelativePath === 'string' && targetRelativePath.trim()
    ? targetRelativePath.trim().replaceAll('\\', '/')
    : metadata.originalPath
  const targetPath = resolveWorkspacePath(root, relativePath)
  const parentPath = path.dirname(targetPath)
  try {
    await assertRealPathContained(root, parentPath)
  } catch (error) {
    if (error && error.code === 'ENOENT') throw new WorkspaceError('RESTORE_PARENT_MISSING', '恢复位置的文件夹不存在')
    throw error
  }
  await assertEntryDoesNotExist(targetPath)
  await fs.rename(path.join(itemPath, 'entry'), targetPath)
  try {
    await fs.rm(itemPath, { recursive: true })
  } catch (error) {
    await fs.rename(targetPath, path.join(itemPath, 'entry')).catch(() => undefined)
    throw error
  }
  return relativePath
}

async function permanentlyDeleteTrashItem(rootPath, id) {
  const root = assertAbsoluteRoot(rootPath)
  const { itemPath } = await readTrashMetadata(root, id)
  await fs.rm(itemPath, { recursive: true })
}

async function emptyTrash(rootPath) {
  const root = assertAbsoluteRoot(rootPath)
  await readIdentity(root)
  const trashPath = path.join(root, '.trash')
  const entries = await fs.readdir(trashPath, { withFileTypes: true })
  await Promise.all(entries.map((entry) => fs.rm(path.join(trashPath, entry.name), { recursive: true, force: true })))
}

function assertTrashRetentionDays(days) {
  if (!Number.isInteger(days) || days < 1 || days > 365) {
    throw new WorkspaceError('INVALID_TRASH_RETENTION', '回收站保留天数必须在 1 到 365 天之间')
  }
  return days
}

async function listExpiredTrash(rootPath, retentionDays) {
  const days = assertTrashRetentionDays(retentionDays)
  const expiresBefore = Date.now() - days * 24 * 60 * 60 * 1000
  return (await listTrash(rootPath)).filter((item) => {
    const deletedAt = Date.parse(item.deletedAt)
    return Number.isFinite(deletedAt) && deletedAt <= expiresBefore
  })
}

async function deleteExpiredTrashItems(rootPath, ids, retentionDays) {
  if (!Array.isArray(ids) || ids.some((id) => typeof id !== 'string')) {
    throw new WorkspaceError('INVALID_TRASH_LIST', '待清理回收站清单无效')
  }
  const expiredIds = new Set((await listExpiredTrash(rootPath, retentionDays)).map((item) => item.id))
  const uniqueIds = [...new Set(ids)]
  if (uniqueIds.some((id) => !expiredIds.has(id))) {
    throw new WorkspaceError('TRASH_EXPIRATION_STALE', '回收站项目状态已变化，请重新检查')
  }
  for (const id of uniqueIds) await permanentlyDeleteTrashItem(rootPath, id)
  return uniqueIds.length
}

async function readIdentity(rootPath) {
  const root = assertAbsoluteRoot(rootPath)
  let raw
  try {
    raw = await fs.readFile(path.join(root, IDENTITY_FILE), 'utf8')
  } catch (error) {
    if (error && error.code === 'ENOENT') {
      throw new WorkspaceError('NOT_A_WORKSPACE', '所选目录不是 zTools Markdown 工作区')
    }
    throw error
  }

  let identity
  try {
    identity = JSON.parse(raw)
  } catch {
    throw new WorkspaceError('INVALID_IDENTITY', '工作区身份文件不是有效 JSON')
  }

  if (
    typeof identity !== 'object' ||
    identity === null ||
    typeof identity.id !== 'string' ||
    !identity.id ||
    typeof identity.name !== 'string' ||
    !identity.name.trim() ||
    identity.version !== 1
  ) {
    throw new WorkspaceError('INVALID_IDENTITY', '工作区身份文件字段无效')
  }
  return { id: identity.id, name: identity.name.trim(), version: 1, path: root }
}

async function createWorkspace(rootPath, name) {
  const root = assertAbsoluteRoot(rootPath)
  const workspaceName = assertWorkspaceName(name)
  await fs.mkdir(root, { recursive: true })

  const identityPath = path.join(root, IDENTITY_FILE)
  try {
    await fs.access(identityPath)
    throw new WorkspaceError('WORKSPACE_EXISTS', '该目录已经是一个工作区')
  } catch (error) {
    if (error instanceof WorkspaceError) throw error
    if (!error || error.code !== 'ENOENT') throw error
  }

  const identity = { id: crypto.randomUUID(), name: workspaceName, version: 1 }
  const handle = await fs.open(identityPath, 'wx')
  try {
    await handle.writeFile(`${JSON.stringify(identity, null, 2)}\n`, 'utf8')
    await handle.sync()
  } finally {
    await handle.close()
  }

  await Promise.all([
    fs.mkdir(path.join(root, '.assets'), { recursive: true }),
    fs.mkdir(path.join(root, '.trash'), { recursive: true }),
  ])
  return { ...identity, path: root }
}

async function readWorkspace(rootPath) {
  return readIdentity(rootPath)
}

async function renameWorkspace(rootPath, name) {
  const root = assertAbsoluteRoot(rootPath)
  const workspaceName = assertWorkspaceName(name)
  const identityPath = path.join(root, IDENTITY_FILE)
  const identity = await readIdentity(root)
  const before = await fs.stat(identityPath)
  const temporaryPath = `${identityPath}.znotes-${crypto.randomUUID()}.tmp`
  await fs.writeFile(temporaryPath, `${JSON.stringify({ id: identity.id, name: workspaceName, version: 1 }, null, 2)}\n`, { encoding: 'utf8', flag: 'wx' })
  try {
    const current = await fs.stat(identityPath)
    if (current.mtimeMs !== before.mtimeMs || current.size !== before.size) {
      throw new WorkspaceError('EXTERNAL_MODIFICATION', '工作区信息已被外部修改，请重试')
    }
    await fs.rename(temporaryPath, identityPath)
  } catch (error) {
    await fs.rm(temporaryPath, { force: true }).catch(() => undefined)
    throw error
  }
  return readIdentity(root)
}

async function relinkWorkspace(rootPath, expectedWorkspaceId) {
  if (typeof expectedWorkspaceId !== 'string' || !expectedWorkspaceId) throw new WorkspaceError('INVALID_WORKSPACE_ID', '工作区身份无效')
  const identity = await readIdentity(rootPath)
  if (identity.id !== expectedWorkspaceId) throw new WorkspaceError('WORKSPACE_ID_MISMATCH', '所选目录不是该工作区的新位置')
  return identity
}

async function discoverWorkspaces(parentPath) {
  const parent = assertAbsoluteRoot(parentPath)
  const found = new Map()

  async function visit(directoryPath, depth) {
    try {
      const identity = await readIdentity(directoryPath)
      if (!found.has(identity.id)) found.set(identity.id, identity)
      return
    } catch (error) {
      if (error instanceof WorkspaceError && !['NOT_A_WORKSPACE', 'INVALID_IDENTITY'].includes(error.code)) throw error
    }
    if (depth >= 3) return

    let entries
    try {
      entries = await fs.readdir(directoryPath, { withFileTypes: true })
    } catch {
      return
    }
    for (const entry of entries) {
      if (entry.isDirectory() && !isReservedName(entry.name)) await visit(path.join(directoryPath, entry.name), depth + 1)
    }
  }

  await visit(parent, 0)
  return [...found.values()]
}

async function collectDirectoryInventory(rootPath, currentPath = rootPath) {
  const entries = await fs.readdir(currentPath, { withFileTypes: true })
  const inventory = []
  for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
    const entryPath = path.join(currentPath, entry.name)
    const relativePath = path.relative(rootPath, entryPath).split(path.sep).join('/')
    if (entry.isDirectory()) {
      inventory.push(`d:${relativePath}`)
      inventory.push(...await collectDirectoryInventory(rootPath, entryPath))
    } else if (entry.isSymbolicLink()) {
      inventory.push(`l:${relativePath}:${await fs.readlink(entryPath)}`)
    } else if (entry.isFile()) {
      const hash = crypto.createHash('sha256')
      for await (const chunk of createReadStream(entryPath)) hash.update(chunk)
      inventory.push(`f:${relativePath}:${hash.digest('hex')}`)
    }
  }
  return inventory
}

async function migrateWorkspace(rootPath, targetPath) {
  const source = assertAbsoluteRoot(rootPath)
  const target = assertAbsoluteRoot(targetPath)
  const identity = await readIdentity(source)
  const [realSource, realTarget] = await Promise.all([fs.realpath(source), fs.realpath(target)])
  if (realSource === realTarget) throw new WorkspaceError('SAME_WORKSPACE_PATH', '新位置不能与原位置相同')
  const sourceToTarget = path.relative(realSource, realTarget)
  const targetToSource = path.relative(realTarget, realSource)
  const targetInsideSource = !path.isAbsolute(sourceToTarget) && !sourceToTarget.startsWith('..')
  const sourceInsideTarget = !path.isAbsolute(targetToSource) && !targetToSource.startsWith('..')
  if (targetInsideSource || sourceInsideTarget) {
    throw new WorkspaceError('NESTED_WORKSPACE_PATH', '新位置不能位于原工作区内部或包含原工作区')
  }
  if ((await fs.readdir(target)).length) throw new WorkspaceError('TARGET_NOT_EMPTY', '请选择一个空目录作为新位置')

  const temporaryPath = path.join(path.dirname(target), `.znotes-migrate-${crypto.randomUUID()}`)
  try {
    await fs.cp(source, temporaryPath, { recursive: true, errorOnExist: true, force: false })
    const copiedIdentity = await readIdentity(temporaryPath)
    if (copiedIdentity.id !== identity.id) throw new WorkspaceError('MIGRATION_VERIFY_FAILED', '迁移后的工作区身份校验失败')
    const [sourceInventory, targetInventory] = await Promise.all([
      collectDirectoryInventory(source),
      collectDirectoryInventory(temporaryPath),
    ])
    if (JSON.stringify(sourceInventory) !== JSON.stringify(targetInventory)) {
      throw new WorkspaceError('MIGRATION_VERIFY_FAILED', '迁移后的文件校验失败，原工作区未改动')
    }
    await fs.rmdir(target)
    try {
      await fs.rename(temporaryPath, target)
    } catch (error) {
      await fs.mkdir(target, { recursive: true }).catch(() => undefined)
      throw error
    }
  } catch (error) {
    await fs.rm(temporaryPath, { recursive: true, force: true }).catch(() => undefined)
    throw error
  }
  return readIdentity(target)
}

async function scanDirectory(root, currentPath = root) {
  const entries = await fs.readdir(currentPath, { withFileTypes: true })
  const visibleEntries = entries
    .filter((entry) => !isReservedName(entry.name))
    .filter((entry) => entry.isDirectory() || (entry.isFile() && path.extname(entry.name).toLowerCase() === '.md'))
    .sort((left, right) => {
      if (left.isDirectory() !== right.isDirectory()) return left.isDirectory() ? -1 : 1
      return left.name.localeCompare(right.name, 'zh-CN')
    })

  return Promise.all(
    visibleEntries.map(async (entry) => {
      const absolutePath = path.join(currentPath, entry.name)
      const relativePath = path.relative(root, absolutePath).split(path.sep).join('/')
      if (entry.isDirectory()) {
        return {
          kind: 'directory',
          name: entry.name,
          relativePath,
          children: await scanDirectory(root, absolutePath),
        }
      }

      const stats = await fs.stat(absolutePath)
      return {
        kind: 'note',
        name: path.basename(entry.name, path.extname(entry.name)),
        relativePath,
        modifiedAt: stats.mtimeMs,
        size: stats.size,
      }
    }),
  )
}

async function scanWorkspace(rootPath) {
  const workspace = await readIdentity(rootPath)
  return { workspace, entries: await scanDirectory(workspace.path) }
}

async function openDefaultWorkspace(documentsPath) {
  const documents = assertAbsoluteRoot(documentsPath)
  const defaultPath = path.join(documents, 'ZTools Markdown Notes')
  try {
    return await scanWorkspace(defaultPath)
  } catch (error) {
    if (!(error instanceof WorkspaceError) || error.code !== 'NOT_A_WORKSPACE') throw error
  }

  await createWorkspace(defaultPath, '默认工作区')
  return scanWorkspace(defaultPath)
}

async function readNote(rootPath, relativePath) {
  assertMarkdownPath(relativePath)
  const notePath = resolveWorkspacePath(rootPath, relativePath)
  await assertRealPathContained(assertAbsoluteRoot(rootPath), notePath)
  const [content, stats] = await Promise.all([fs.readFile(notePath, 'utf8'), fs.stat(notePath)])
  return {
    content,
    modifiedAt: stats.mtimeMs,
    size: stats.size,
    baseUrl: pathToFileURL(`${path.dirname(notePath)}${path.sep}`).href,
  }
}

async function openWorkspaceLink(rootPath, noteRelativePath, href) {
  const root = assertAbsoluteRoot(rootPath)
  assertMarkdownPath(noteRelativePath)
  const notePath = resolveWorkspacePath(root, noteRelativePath)
  await assertRealPathContained(root, notePath)
  if (typeof href !== 'string' || !href.trim()) throw new WorkspaceError('INVALID_LINK', '链接地址为空')

  const rawTarget = href.trim().split(/[?#]/, 1)[0]
  let decodedTarget
  try {
    decodedTarget = decodeURIComponent(rawTarget)
  } catch {
    throw new WorkspaceError('INVALID_LINK', '链接地址编码无效')
  }
  if (!decodedTarget || path.isAbsolute(decodedTarget) || /^[a-z][a-z\d+.-]*:/i.test(decodedTarget)) {
    throw new WorkspaceError('INVALID_LINK', '本地链接必须使用工作区内的相对路径')
  }

  const targetPath = path.resolve(path.dirname(notePath), decodedTarget)
  assertContainedPath(root, targetPath)
  const relativePath = path.relative(root, targetPath).split(path.sep).join('/')
  const firstSegment = relativePath.split('/')[0]?.toLowerCase()
  if (firstSegment === '.trash' || firstSegment === IDENTITY_FILE) {
    throw new WorkspaceError('RESERVED_PATH', '链接不能访问工作区保留项目')
  }
  await assertRealPathContained(root, targetPath)
  const stats = await fs.stat(targetPath)
  if (!stats.isFile()) throw new WorkspaceError('INVALID_LINK_TARGET', '链接目标不是文件')

  if (path.extname(targetPath).toLowerCase() === '.md') return { kind: 'note', relativePath }
  if (typeof window === 'undefined' || !window.ztools?.shellOpenPath?.(targetPath)) {
    throw new WorkspaceError('OPEN_LINK_FAILED', '无法使用系统默认程序打开该附件')
  }
  return { kind: 'attachment' }
}

async function createNoteLink(rootPath, noteRelativePath, targetRelativePath) {
  const root = assertAbsoluteRoot(rootPath)
  assertMarkdownPath(noteRelativePath)
  assertMarkdownPath(targetRelativePath)
  const notePath = resolveWorkspacePath(root, noteRelativePath)
  const targetPath = resolveWorkspacePath(root, targetRelativePath)
  await Promise.all([assertRealPathContained(root, notePath), assertRealPathContained(root, targetPath)])
  const targetStats = await fs.stat(targetPath)
  if (!targetStats.isFile()) throw new WorkspaceError('INVALID_LINK_TARGET', '目标笔记不是文件')
  return path.relative(path.dirname(notePath), targetPath).split(path.sep).join('/')
}

async function createCrossWorkspaceNoteLink(targetRootPath, expectedWorkspaceId, targetRelativePath) {
  const identity = await readIdentity(targetRootPath)
  if (identity.id !== expectedWorkspaceId) throw new WorkspaceError('WORKSPACE_ID_MISMATCH', '目标工作区路径已经失效，请重新关联')
  assertMarkdownPath(targetRelativePath)
  const targetPath = resolveWorkspacePath(identity.path, targetRelativePath)
  await assertRealPathContained(identity.path, targetPath)
  if (!(await fs.stat(targetPath)).isFile()) throw new WorkspaceError('INVALID_LINK_TARGET', '目标笔记不是文件')
  const encodedPath = targetRelativePath.split('/').map(encodeURIComponent).join('/')
  return `znotes://${identity.id}/${encodedPath}`
}

async function openCrossWorkspaceNoteLink(targetRootPath, href) {
  let link
  try { link = new URL(href) } catch { throw new WorkspaceError('INVALID_LINK', '跨工作区链接格式无效') }
  if (link.protocol !== 'znotes:' || !link.hostname || !link.pathname) throw new WorkspaceError('INVALID_LINK', '跨工作区链接格式无效')
  const identity = await readIdentity(targetRootPath)
  if (identity.id !== link.hostname) throw new WorkspaceError('WORKSPACE_ID_MISMATCH', '目标工作区路径已经失效，请重新关联')
  let relativePath
  try { relativePath = link.pathname.slice(1).split('/').map(decodeURIComponent).join('/') } catch { throw new WorkspaceError('INVALID_LINK', '跨工作区链接编码无效') }
  assertMarkdownPath(relativePath)
  const targetPath = resolveWorkspacePath(identity.path, relativePath)
  await assertRealPathContained(identity.path, targetPath)
  if (!(await fs.stat(targetPath)).isFile()) throw new WorkspaceError('INVALID_LINK_TARGET', '目标笔记不存在')
  return { workspace: identity, relativePath }
}

function flattenNotes(entries) {
  return entries.flatMap((entry) => entry.kind === 'directory' ? flattenNotes(entry.children) : [entry])
}

function createSearchSnippet(content, matchIndex, queryLength) {
  const start = Math.max(0, matchIndex - 36)
  const end = Math.min(content.length, matchIndex + queryLength + 64)
  return `${start > 0 ? '…' : ''}${content.slice(start, end).replace(/\s+/g, ' ').trim()}${end < content.length ? '…' : ''}`
}

async function searchWorkspace(rootPath, query) {
  const normalizedQuery = typeof query === 'string' ? query.trim() : ''
  if (!normalizedQuery) return []
  if (normalizedQuery.length > 200) throw new WorkspaceError('INVALID_SEARCH_QUERY', '搜索内容过长')

  const scan = await scanWorkspace(rootPath)
  const loweredQuery = normalizedQuery.toLocaleLowerCase('zh-CN')
  const results = []

  for (const note of flattenNotes(scan.entries)) {
    const loweredName = note.name.toLocaleLowerCase('zh-CN')
    const loweredPath = note.relativePath.toLocaleLowerCase('zh-CN')
    let rank = loweredName === loweredQuery ? 1 : loweredName.includes(loweredQuery) ? 2 : loweredPath.includes(loweredQuery) ? 3 : 0
    let snippet = ''

    const notePath = resolveWorkspacePath(scan.workspace.path, note.relativePath)
    await assertRealPathContained(scan.workspace.path, notePath)
    const content = await fs.readFile(notePath, 'utf8')
    const loweredContent = content.toLocaleLowerCase('zh-CN')
    const contentIndex = loweredContent.indexOf(loweredQuery)
    const headingMatch = content.split(/\r?\n/).some((line) => {
      const heading = line.match(/^\s{0,3}#{1,6}\s+(.+?)\s*#*\s*$/)
      return heading?.[1].toLocaleLowerCase('zh-CN').includes(loweredQuery)
    })

    if (!rank && headingMatch) rank = 4
    else if (!rank && contentIndex >= 0) rank = 5
    if (contentIndex >= 0) snippet = createSearchSnippet(content, contentIndex, normalizedQuery.length)
    if (rank) results.push({ name: note.name, relativePath: note.relativePath, snippet, rank })
  }

  return results
    .sort((left, right) => left.rank - right.rank || left.name.localeCompare(right.name, 'zh-CN'))
    .slice(0, 50)
    .map(({ rank, ...result }) => result)
}

async function saveNote(rootPath, relativePath, content, expectedModifiedAt) {
  assertMarkdownPath(relativePath)
  if (typeof content !== 'string') throw new WorkspaceError('INVALID_CONTENT', '笔记正文必须是文本')

  const workspaceIdentity = await readIdentity(rootPath)
  const notePath = resolveWorkspacePath(workspaceIdentity.path, relativePath)
  const directory = path.dirname(notePath)
  await fs.mkdir(directory, { recursive: true })
  await assertRealPathContained(workspaceIdentity.path, directory)

  let currentStats
  try {
    currentStats = await fs.stat(notePath)
  } catch (error) {
    if (!error || error.code !== 'ENOENT') throw error
  }

  if (currentStats && expectedModifiedAt !== currentStats.mtimeMs) {
    throw new WorkspaceError('NOTE_CONFLICT', '磁盘文件已被外部修改')
  }
  if (!currentStats && expectedModifiedAt !== null) {
    throw new WorkspaceError('NOTE_CONFLICT', '磁盘文件状态与编辑时不一致')
  }

  const temporaryPath = path.join(directory, `.${path.basename(notePath)}.${crypto.randomUUID()}.tmp`)
  try {
    const handle = await fs.open(temporaryPath, 'wx')
    try {
      await handle.writeFile(content, 'utf8')
      await handle.sync()
    } finally {
      await handle.close()
    }

    let latestStats
    try {
      latestStats = await fs.stat(notePath)
    } catch (error) {
      if (!error || error.code !== 'ENOENT') throw error
    }
    if (
      (currentStats && (!latestStats || latestStats.mtimeMs !== currentStats.mtimeMs || latestStats.size !== currentStats.size)) ||
      (!currentStats && latestStats)
    ) {
      throw new WorkspaceError('NOTE_CONFLICT', '保存前检测到磁盘文件已被外部修改')
    }
    await fs.rename(temporaryPath, notePath)
  } catch (error) {
    await fs.rm(temporaryPath, { force: true }).catch(() => undefined)
    throw error
  }

  const savedStats = await fs.stat(notePath)
  return { modifiedAt: savedStats.mtimeMs, size: savedStats.size }
}

async function importAttachment(rootPath, noteRelativePath, originalName, data) {
  const root = assertAbsoluteRoot(rootPath)
  await readIdentity(root)
  assertMarkdownPath(noteRelativePath)
  const notePath = resolveWorkspacePath(root, noteRelativePath)
  await assertRealPathContained(root, notePath)
  if (!(data instanceof Uint8Array)) throw new WorkspaceError('INVALID_ATTACHMENT', '附件内容无效')

  const now = new Date()
  const year = String(now.getFullYear())
  const month = String(now.getMonth() + 1).padStart(2, '0')
  const assetDirectory = path.join(root, '.assets', year, month)
  await fs.mkdir(assetDirectory, { recursive: true })
  await assertRealPathContained(root, assetDirectory)

  const originalExtension = path.extname(typeof originalName === 'string' ? originalName : '').toLowerCase()
  const extension = /^\.[a-z0-9]{1,10}$/.test(originalExtension) ? originalExtension : '.bin'
  const contentHash = crypto.createHash('sha256').update(data).digest('hex').slice(0, 16)
  const existingAsset = await findMatchingAttachment(path.join(root, '.assets'), `-${contentHash}${extension}`, data)
  if (existingAsset) return path.relative(path.dirname(notePath), existingAsset).split(path.sep).join('/')

  const fileName = `${Date.now()}-${crypto.randomUUID().slice(0, 8)}-${contentHash}${extension}`
  const assetPath = path.join(assetDirectory, fileName)
  const temporaryPath = path.join(assetDirectory, `.${fileName}.${crypto.randomUUID()}.tmp`)

  try {
    const handle = await fs.open(temporaryPath, 'wx')
    try {
      await handle.writeFile(data)
      await handle.sync()
    } finally {
      await handle.close()
    }
    await assertEntryDoesNotExist(assetPath)
    await fs.rename(temporaryPath, assetPath)
  } catch (error) {
    await fs.rm(temporaryPath, { force: true }).catch(() => undefined)
    throw error
  }

  return path.relative(path.dirname(notePath), assetPath).split(path.sep).join('/')
}

function extractLocalLinkTargets(content) {
  const targets = []
  const patterns = [
    /!?\[[^\]]*\]\(\s*(?:<([^>]+)>|([^\s)]+))/g,
    /^\s*\[[^\]]+\]:\s*(?:<([^>]+)>|(\S+))/gm,
    /(?:src|href)\s*=\s*["']([^"']+)["']/gi,
  ]
  for (const pattern of patterns) {
    for (const match of content.matchAll(pattern)) targets.push(match.slice(1).find(Boolean))
  }
  return targets.filter(Boolean)
}

async function collectFiles(directory) {
  const files = []
  for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
    const entryPath = path.join(directory, entry.name)
    if (entry.isDirectory()) files.push(...await collectFiles(entryPath))
    else if (entry.isFile()) files.push(entryPath)
  }
  return files
}

async function collectAttachmentReferenceNotes(root) {
  const notes = []
  async function visit(directory) {
    for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
      if (directory === root && isReservedName(entry.name)) continue
      const entryPath = path.join(directory, entry.name)
      if (entry.isDirectory()) await visit(entryPath)
      else if (entry.isFile() && path.extname(entry.name).toLowerCase() === '.md') notes.push({ filePath: entryPath, logicalPath: entryPath })
    }
  }
  await visit(root)
  for (const item of await listTrash(root)) {
    const { itemPath } = await readTrashMetadata(root, item.id)
    const entryPath = path.join(itemPath, 'entry')
    if (item.kind === 'note') {
      notes.push({ filePath: entryPath, logicalPath: path.join(root, item.originalPath) })
      continue
    }
    for (const filePath of await collectMarkdownFiles(entryPath)) {
      const suffix = filePath.slice(entryPath.length)
      notes.push({ filePath, logicalPath: path.join(root, `${item.originalPath}${suffix}`) })
    }
  }
  return notes
}

async function scanUnusedAttachments(rootPath) {
  const root = assertAbsoluteRoot(rootPath)
  await readIdentity(root)
  const assetsPath = path.join(root, '.assets')
  await assertRealPathContained(root, assetsPath)
  const referenced = new Set()
  for (const note of await collectAttachmentReferenceNotes(root)) {
    const content = await fs.readFile(note.filePath, 'utf8')
    for (const href of extractLocalLinkTargets(content)) {
      if (/^(?:[a-z][a-z\d+.-]*:|#|\/)/i.test(href)) continue
      const pathPart = href.split(/[?#]/, 1)[0]
      let targetPath
      try { targetPath = path.resolve(path.dirname(note.logicalPath), decodeURIComponent(pathPart)) } catch { continue }
      if (targetPath === assetsPath || targetPath.startsWith(`${assetsPath}${path.sep}`)) referenced.add(path.normalize(targetPath))
    }
  }
  const unused = []
  for (const filePath of await collectFiles(assetsPath)) {
    if (referenced.has(path.normalize(filePath))) continue
    const stats = await fs.stat(filePath)
    unused.push({ relativePath: path.relative(root, filePath).split(path.sep).join('/'), size: stats.size })
  }
  return unused.sort((left, right) => left.relativePath.localeCompare(right.relativePath))
}

async function deleteUnusedAttachments(rootPath, relativePaths) {
  const root = assertAbsoluteRoot(rootPath)
  if (!Array.isArray(relativePaths) || relativePaths.some((value) => typeof value !== 'string')) {
    throw new WorkspaceError('INVALID_ATTACHMENT_LIST', '待清理附件清单无效')
  }
  const latestUnused = new Set((await scanUnusedAttachments(root)).map((item) => item.relativePath))
  const uniquePaths = [...new Set(relativePaths)]
  if (uniquePaths.some((relativePath) => !latestUnused.has(relativePath))) {
    throw new WorkspaceError('ATTACHMENT_SCAN_STALE', '附件引用已发生变化，请重新扫描后再清理')
  }
  for (const relativePath of uniquePaths) {
    if (!relativePath.startsWith('.assets/')) throw new WorkspaceError('INVALID_ATTACHMENT_PATH', '只能清理 .assets 内的附件')
    const filePath = path.resolve(root, ...relativePath.split('/'))
    assertContainedPath(path.join(root, '.assets'), filePath)
    await assertRealPathContained(root, filePath)
    await fs.unlink(filePath)
  }
  return uniquePaths.length
}

async function findMatchingAttachment(directory, fileNameSuffix, data) {
  let entries
  try {
    entries = await fs.readdir(directory, { withFileTypes: true })
  } catch (error) {
    if (error && error.code === 'ENOENT') return null
    throw error
  }

  for (const entry of entries) {
    const entryPath = path.join(directory, entry.name)
    if (entry.isDirectory()) {
      const match = await findMatchingAttachment(entryPath, fileNameSuffix, data)
      if (match) return match
    } else if (entry.isFile() && entry.name.endsWith(fileNameSuffix)) {
      const existingData = await fs.readFile(entryPath)
      if (existingData.length === data.length && crypto.timingSafeEqual(existingData, data)) return entryPath
    }
  }
  return null
}

const workspace = {
  apiVersion: 15,
  createWorkspace,
  renameWorkspace,
  relinkWorkspace,
  discoverWorkspaces,
  migrateWorkspace,
  readWorkspace,
  scanWorkspace,
  openDefaultWorkspace,
  createNote,
  createDirectory,
  renameEntry,
  moveEntry,
  showEntryInFolder,
  moveEntryToTrash,
  listTrash,
  restoreTrashItem,
  permanentlyDeleteTrashItem,
  emptyTrash,
  listExpiredTrash,
  deleteExpiredTrashItems,
  readNote,
  openWorkspaceLink,
  createNoteLink,
  createCrossWorkspaceNoteLink,
  openCrossWorkspaceNoteLink,
  searchWorkspace,
  saveNote,
  importAttachment,
  scanUnusedAttachments,
  deleteUnusedAttachments,
}

if (typeof window !== 'undefined') window.znotes = workspace
if (typeof module !== 'undefined') module.exports = { ...workspace, WorkspaceError }
