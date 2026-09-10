'use strict'
const fs = require('node:fs/promises')
const path = require('node:path')
const crypto = require('node:crypto')
const core = require('./git-core.cjs')
const grants = new Map()
let verifiedGit = null
let activeGrantId = null
// Every asynchronous operation is bound to the ZTools view that started it.
// onPluginOut invalidates that view before clearing its capabilities, so a
// delayed native dialog or Git subprocess can never rehydrate a later view.
let sessionEpoch = 0
const MAX_SNAPSHOTS = 30
const TOOL_NAMES = Object.freeze({ snapshotApproved: 'snapshot_approved' })
const RENDERER_SESSION_ENDED = 'git-worktree-cockpit-session-ended'
const registeredHosts = new WeakSet()
function host() { return typeof window !== 'undefined' && window.ztools ? window.ztools : {} }
function sessionEndedError() { return Object.assign(new Error('插件会话已结束，请重新打开后操作。'), { code: 'SESSION_ENDED' }) }
function repositoryUnavailableError() { return Object.assign(new Error('无法访问或验证所选仓库，请重新选择。'), { code: 'REPOSITORY_UNAVAILABLE' }) }
function copyFailedError() { return Object.assign(new Error('无法复制快照，请重试。'), { code: 'COPY_FAILED' }) }
function assertSession(epoch) { if (epoch !== sessionEpoch) throw sessionEndedError() }
function notifyRendererSessionEnded() {
  // This is deliberately only a lifecycle signal: no grant, path, repository
  // or error detail crosses the preload/renderer boundary when ZTools reuses a
  // renderer after plugin out.
  if (typeof window === 'undefined' || typeof window.dispatchEvent !== 'function' || typeof Event !== 'function') return
  try { window.dispatchEvent(new Event(RENDERER_SESSION_ENDED)) } catch {}
}
function clearSession() { sessionEpoch += 1; grants.clear(); verifiedGit = null; activeGrantId = null; notifyRendererSessionEnded() }
function dialogPath(result) { return Array.isArray(result) ? result[0] : typeof result === 'string' ? result : result && Array.isArray(result.filePaths) ? result.filePaths[0] : null }
function grantId() { return crypto.randomBytes(12).toString('hex') }
function revokeGrant(id) { grants.delete(id); if (activeGrantId === id) activeGrantId = null }
function getGrant(id) { const grant = grants.get(id); if (!grant || grant.expiresAt < Date.now()) { revokeGrant(id); throw new Error('仓库授权已过期，请重新选择。') } return grant }
function identity(stat) { return { dev: stat.dev, ino: stat.ino, mtimeMs: stat.mtimeMs, ctimeMs: stat.ctimeMs } }
function sameIdentity(grant, current) { return grant.dev === current.dev && grant.ino === current.ino && grant.mtimeMs === current.mtimeMs && grant.ctimeMs === current.ctimeMs }
async function revalidateGrant(grant) {
  const stable = await core.authorizeRepository(grant.repository)
  const current = identity(await fs.stat(stable))
  if (stable !== grant.repository || !sameIdentity(grant, current)) throw new Error('已授权仓库在选择后发生变化。')
  return stable
}
async function chooseRepository() {
  const epoch = sessionEpoch
  const api = host(); if (typeof api.showOpenDialog !== 'function') return { ok: false, code: 'DIALOG_UNAVAILABLE' }
  let selected
  try { selected = await api.showOpenDialog({ title: '选择 Git 仓库目录', properties: ['openDirectory'] }) }
  catch (error) { assertSession(epoch); throw repositoryUnavailableError() }
  const value = dialogPath(selected)
  assertSession(epoch)
  if (!value) return { ok: false, code: 'CANCELED' }
  try {
    const repository = await core.authorizeRepository(value)
    assertSession(epoch)
    if (grants.size >= MAX_SNAPSHOTS) grants.delete(grants.keys().next().value)
    const selectedIdentity = identity(await fs.stat(repository))
    assertSession(epoch)
    const id = grantId(); grants.set(id, { repository, ...selectedIdentity, expiresAt: Date.now() + 30 * 60 * 1000, snapshot: null }); activeGrantId = id
    return { ok: true, grantId: id, repository: path.basename(repository) || repository }
  } catch (error) {
    if (error && error.code === 'SESSION_ENDED') throw error
    throw repositoryUnavailableError()
  }
}
async function inspectGrant(id) {
  const epoch = sessionEpoch
  try {
    const grant = getGrant(id)
    await revalidateGrant(grant)
    assertSession(epoch)
    if (!verifiedGit) verifiedGit = await core.resolveGit(undefined, process.platform)
    assertSession(epoch)
    const snapshot = await core.inspect(grant.repository, verifiedGit)
    assertSession(epoch)
    await revalidateGrant(grant)
    assertSession(epoch)
    grant.snapshot = snapshot
    return { repository: path.basename(snapshot.repository) || snapshot.repository, worktrees: snapshot.worktrees }
  } catch {
    if (epoch === sessionEpoch) { revokeGrant(id); verifiedGit = null }
    throw new Error('已授权仓库不可用或检查失败，请重新选择。')
  }
}
function dryPlan(action) { return Object.freeze({ executable: false, version: '0.1', action: String(action || 'unknown'), message: 'v0.1 只读：不会创建、移除或修改 Git 工作树。' }) }
function shareableSnapshot(snapshot) {
  const branchLabels = new Map()
  const branchLabel = (value) => {
    if (!value) return null
    if (!branchLabels.has(value)) branchLabels.set(value, `branch-${branchLabels.size + 1}`)
    return branchLabels.get(value)
  }
  return {
    schemaVersion: 1,
    repository: 'repository-1',
    totalWorktrees: snapshot.worktrees.length,
    worktrees: snapshot.worktrees.map((item, index) => ({
      label: `worktree-${index + 1}`,
      branch: branchLabel(item.branch),
      detached: item.detached === true,
      bare: item.bare === true,
      locked: Boolean(item.locked),
      prunable: Boolean(item.prunable),
      status: item.status ? { ahead: Number.isSafeInteger(item.status.ahead) && item.status.ahead >= 0 ? item.status.ahead : 0, behind: Number.isSafeInteger(item.status.behind) && item.status.behind >= 0 ? item.status.behind : 0, dirty: item.status.dirty === true, changedEntryCount: Number.isSafeInteger(item.status.entries) && item.status.entries >= 0 ? item.status.entries : 0 } : null,
      ...(item.status ? {} : { statusUnavailable: item.statusUnavailable === 'prunable' ? 'prunable' : item.statusUnavailable === 'deadline' ? 'deadline' : 'unavailable' })
    }))
  }
}
function humanAnonymousLabel(value) {
  if (typeof value !== 'string') return value
  const match = /^(repository|worktree|branch)-(\d+)$/.exec(value)
  if (!match) return value
  return `${{ repository: '仓库', worktree: '工作树', branch: '分支' }[match[1]]}-${match[2]}`
}
function humanShareableSnapshot(snapshot) {
  return {
    ...snapshot,
    repository: humanAnonymousLabel(snapshot.repository),
    worktrees: snapshot.worktrees.map((item) => ({ ...item, label: humanAnonymousLabel(item.label), branch: humanAnonymousLabel(item.branch) }))
  }
}
function stringifySnapshot(snapshot, format) {
  const shareable = shareableSnapshot(snapshot)
  return format === 'json' ? JSON.stringify(shareable, null, 2) + '\n' : core.snapshotMarkdown(humanShareableSnapshot(shareable)) + '\n'
}
function existingDestinationError() { const error = new Error('不能覆盖已有文件，请选择新的文件名。'); error.code = 'DESTINATION_EXISTS'; return error }
function saveFailedError() { return Object.assign(new Error('无法保存快照，请重新选择保存位置。'), { code: 'SAVE_FAILED' }) }
function temporaryDestination(destination) { return path.join(path.dirname(destination), `.${path.basename(destination)}.${crypto.randomBytes(12).toString('hex')}.tmp`) }
async function removeIfSameIdentity(io, candidate, reference) {
  try {
    const candidateStat = await io.lstat(candidate)
    if (candidateStat.dev !== reference.dev || candidateStat.ino !== reference.ino) return false
    await io.unlink(candidate)
    return true
  } catch (error) { return Boolean(error && error.code === 'ENOENT') }
}
async function closeQuietly(handle) { try { await handle.close() } catch { return false } return true }
async function writeNewFile(destination, content, io = fs, assertCurrent = () => {}) {
  const temporary = temporaryDestination(destination)
  let temporaryCreated = false
  let temporaryIdentity = null
  let handle = null
  let destinationLinked = false
  let linkAttempted = false
  let cleanupFailed = false
  try {
    assertCurrent()
    await io.lstat(destination)
    throw existingDestinationError()
  } catch (error) {
    if (error && error.code !== 'ENOENT') throw error
  }
  try {
    assertCurrent()
    // The exclusive handle establishes ownership.  Never claim ownership or
    // unlink a name until this succeeds: an EEXIST temp may belong to another
    // process using the same directory.
    handle = await io.open(temporary, 'wx', 0o600)
    temporaryCreated = true
    temporaryIdentity = identity(await handle.stat())
    await handle.writeFile(content, { encoding: 'utf8' })
    if (!await closeQuietly(handle)) throw saveFailedError()
    handle = null
    assertCurrent()
    try {
      await io.lstat(destination)
      throw existingDestinationError()
    } catch (error) {
      if (error && error.code !== 'ENOENT') throw error
    }
    assertCurrent()
    linkAttempted = true
    await io.link(temporary, destination)
    destinationLinked = true
    try { assertCurrent() } catch (error) {
      if (!await removeIfSameIdentity(io, destination, temporaryIdentity)) cleanupFailed = true
      throw error
    }
    await io.unlink(temporary)
    temporaryCreated = false
    try { assertCurrent() } catch (error) {
      if (!await removeIfSameIdentity(io, destination, temporaryIdentity)) cleanupFailed = true
      throw error
    }
  } catch (error) {
    if (handle && !await closeQuietly(handle)) cleanupFailed = true
    // A linked destination is rolled back only after verifying that it still
    // points at this operation's temporary inode.  This protects a concurrent
    // replacement and gives unlink(temp) failures the same all-or-nothing
    // contract as a stale session.
    if (destinationLinked && temporaryIdentity && !await removeIfSameIdentity(io, destination, temporaryIdentity)) cleanupFailed = true
    if (temporaryCreated && temporaryIdentity && !await removeIfSameIdentity(io, temporary, temporaryIdentity)) cleanupFailed = true
    if (cleanupFailed) throw saveFailedError()
    if (error && error.code === 'EEXIST' && linkAttempted) throw existingDestinationError()
    if (error && (error.code === 'DESTINATION_EXISTS' || error.code === 'SESSION_ENDED' || error.code === 'SAVE_FAILED')) throw error
    throw saveFailedError()
  }
}
async function saveSnapshot(id, format) {
  const epoch = sessionEpoch
  const grant = getGrant(id); if (!grant.snapshot) throw new Error('请先检查仓库，再导出快照。')
  const kind = format === 'json' ? 'json' : 'markdown'; const api = host()
  if (typeof api.showSaveDialog !== 'function') throw new Error('当前 ZTools 版本不支持保存对话框。')
  let chosen
  try { chosen = await api.showSaveDialog({ title: '保存 Git 工作树快照', defaultPath: 'Git-工作树快照.' + (kind === 'json' ? 'json' : 'md'), filters: [{ name: kind === 'json' ? 'JSON 文件' : 'Markdown 文件', extensions: [kind === 'json' ? 'json' : 'md'] }] }) }
  catch (error) { assertSession(epoch); throw saveFailedError() }
  assertSession(epoch)
  const destination = typeof chosen === 'string' ? chosen : chosen && !chosen.canceled ? chosen.filePath : null
  if (!destination || !path.isAbsolute(destination)) return { canceled: true }
  try { await writeNewFile(destination, stringifySnapshot(grant.snapshot, kind), fs, () => assertSession(epoch)) }
  catch (error) {
    if (error && error.code === 'SESSION_ENDED') throw error
    if (error && error.code === 'DESTINATION_EXISTS') throw error
    throw saveFailedError()
  }
  assertSession(epoch)
  return { canceled: false, fileName: path.basename(destination) }
}
async function copySnapshot(id, format) {
  const epoch = sessionEpoch
  const grant = getGrant(id); if (!grant.snapshot) throw new Error('请先检查仓库，再复制快照。')
  const api = host(); if (typeof api.copyText !== 'function') throw new Error('当前 ZTools 版本不支持复制文本。')
  let copied
  try { copied = await api.copyText(stringifySnapshot(grant.snapshot, format === 'json' ? 'json' : 'markdown')) }
  catch (error) { assertSession(epoch); throw copyFailedError() }
  assertSession(epoch)
  return copied !== false
}
function invalidTool(message) { const error = new Error(message); error.code = 'INVALID_TOOL_INPUT'; throw error }
function validateSnapshotToolInput(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) invalidTool('快照参数必须是对象。')
  let prototype, keys
  try { prototype = Object.getPrototypeOf(input); keys = Reflect.ownKeys(input) } catch { invalidTool('快照参数结构无效。') }
  if (prototype !== Object.prototype && prototype !== null) invalidTool('快照参数原型无效。')
  for (const key of keys) {
    if (typeof key !== 'string') invalidTool('snapshot_approved 不接受 Symbol 字段。')
    let descriptor
    try { descriptor = Object.getOwnPropertyDescriptor(input, key) } catch { invalidTool('快照参数字段无效。') }
    if (!descriptor || !Object.prototype.hasOwnProperty.call(descriptor, 'value')) invalidTool('snapshot_approved 只允许数据字段。')
    invalidTool('snapshot_approved 不接受路径、令牌或其他字段。')
  }
  return input
}
const sanitizedSnapshot = shareableSnapshot
async function snapshotApproved(input) {
  validateSnapshotToolInput(input)
  if (!activeGrantId) throw Object.assign(new Error('请先在插件界面选择并授权一个 Git 仓库。'), { code: 'UI_APPROVAL_REQUIRED' })
  const epoch = sessionEpoch
  const id = activeGrantId
  try {
    const grant = getGrant(id)
    await revalidateGrant(grant)
    assertSession(epoch)
    if (!verifiedGit) verifiedGit = await core.resolveGit(undefined, process.platform)
    assertSession(epoch)
    const snapshot = await core.inspect(grant.repository, verifiedGit, { filterWorktrees: true, shouldInspect: (item, repository) => core.samePath(item.path, repository, process.platform) })
    assertSession(epoch)
    await revalidateGrant(grant)
    assertSession(epoch)
    if (snapshot.worktrees.length !== 1) throw new Error('未找到已授权的 Git 工作树。')
    return shareableSnapshot(snapshot)
  } catch {
    if (epoch === sessionEpoch) { revokeGrant(id); verifiedGit = null }
    throw Object.assign(new Error('已授权 Git 仓库不可用或检查失败，请在插件界面重新选择。'), { code: 'APPROVED_REPOSITORY_FAILED' })
  }
}
function registerTools(api) {
  if (!api || typeof api.registerTool !== 'function') return false
  if (registeredHosts.has(api)) return false
  let registered = false
  try { api.registerTool.call(api, TOOL_NAMES.snapshotApproved, (input) => snapshotApproved(input)); registered = true } catch {}
  registeredHosts.add(api)
  return registered
}
if (typeof host().onPluginOut === 'function') host().onPluginOut(clearSession)
registerTools(host())
window.gitWorktreeCockpit = Object.freeze({ chooseRepository, inspectGrant, dryPlan, saveSnapshot, copySnapshot })
module.exports = Object.freeze({ TOOL_NAMES, validateSnapshotToolInput, sanitizedSnapshot, shareableSnapshot, snapshotApproved, registerTools, __test: { RENDERER_SESSION_ENDED, clearSession, activeGrantId: () => activeGrantId, grant: (id) => grants.get(id), sessionEpoch: () => sessionEpoch, stringifySnapshot, writeNewFile } })
