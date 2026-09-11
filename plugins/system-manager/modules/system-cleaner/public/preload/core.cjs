'use strict'

const crypto = require('node:crypto')
const fs = require('node:fs/promises')
const path = require('node:path')

const SNAPSHOT_TTL_MS = 2 * 60 * 1000
const MAX_SNAPSHOTS = 4
const MAX_CANDIDATES = 2_000
const MAX_WALK_ENTRIES = 50_000
const MAX_WALK_DEPTH = 8
const MAX_SCAN_MS = 15_000
const ALLOWED_CATEGORIES = new Set(['cache', 'logs', 'temporary'])

function cleanText(value, maxLength = 180) {
  return String(value ?? '')
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, maxLength)
}

function isInside(parent, child) {
  const relative = path.relative(parent, child)
  return relative !== '' && !relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative)
}

function isInsideOrEqual(parent, child) {
  return parent === child || isInside(parent, child)
}

function fingerprint(stat) {
  return {
    dev: Number(stat.dev),
    ino: Number(stat.ino),
    size: Number(stat.size),
    mtimeMs: Math.round(Number(stat.mtimeMs)),
    mode: Number(stat.mode),
    directory: stat.isDirectory()
  }
}

function sameFingerprint(left, right) {
  return left.dev === right.dev
    && left.ino === right.ino
    && left.size === right.size
    && left.mtimeMs === right.mtimeMs
    && left.mode === right.mode
    && left.directory === right.directory
}

async function measurePath(targetPath, state, depth = 0) {
  if (state.cancelled()) throw Object.assign(new Error('scan cancelled'), { code: 'SCAN_CANCELLED' })
  if (Date.now() >= state.deadline || depth > MAX_WALK_DEPTH || state.entries >= MAX_WALK_ENTRIES) {
    state.truncated = true
    return 0
  }
  let stat
  const fileSystem = state.fs || fs
  try {
    stat = await fileSystem.lstat(targetPath)
  } catch {
    state.unreadable += 1
    if (depth === 0) state.missingRoot = true
    return 0
  }
  state.entries += 1
  if (stat.isSymbolicLink()) return 0
  if (state.rootDev != null && Number(stat.dev) !== state.rootDev) {
    state.truncated = true
    return 0
  }
  if (state.requiredUid != null && Number(stat.uid) !== state.requiredUid) {
    state.foreignOwner = true
    return 0
  }
  const relative = path.relative(state.basePath, targetPath) || '.'
  const nodeHash = crypto.createHash('sha256').update(JSON.stringify([relative, fingerprint(stat)])).digest()
  for (let index = 0; index < state.digest.length; index += 1) state.digest[index] ^= nodeHash[index]
  if (!stat.isDirectory()) return Math.max(0, Number(stat.size) || 0)

  let total = 0
  try {
    const directory = await fileSystem.opendir(targetPath)
    for await (const entry of directory) {
      if (Date.now() >= state.deadline || state.entries >= MAX_WALK_ENTRIES) {
        state.truncated = true
        break
      }
      total += await measurePath(path.join(targetPath, entry.name), state, depth + 1)
    }
  } catch (error) {
    if (error && error.code === 'SCAN_CANCELLED') throw error
    state.unreadable += 1
    return 0
  }
  return total
}

function displayPath(targetPath, home, tempRoot) {
  if (isInsideOrEqual(home, targetPath)) {
    const relative = path.relative(home, targetPath)
    return relative ? `~${path.sep}${relative}` : '~'
  }
  if (tempRoot && isInsideOrEqual(tempRoot, targetPath)) {
    const relative = path.relative(tempRoot, targetPath)
    return relative ? `[临时目录]${path.sep}${relative}` : '[临时目录]'
  }
  return '[受保护位置]'
}

async function prepareRoots(configuredRoots, home, tempRoot, uid, fileSystem = fs) {
  const realHome = await fileSystem.realpath(home)
  let realTemp = null
  try { realTemp = tempRoot ? await fileSystem.realpath(tempRoot) : null } catch {}
  const prepared = []

  for (const item of configuredRoots) {
    if (!item || !ALLOWED_CATEGORIES.has(item.category) || !item.path) continue
    let realRoot
    let lexicalStat
    let canonicalStat
    try {
      lexicalStat = await fileSystem.lstat(item.path)
      if (lexicalStat.isSymbolicLink() || !lexicalStat.isDirectory()) continue
      realRoot = await fileSystem.realpath(item.path)
      canonicalStat = await fileSystem.lstat(realRoot)
    } catch {
      continue
    }
    if (canonicalStat.isSymbolicLink() || !canonicalStat.isDirectory()) continue
    if (Number(lexicalStat.dev) !== Number(canonicalStat.dev) || Number(lexicalStat.ino) !== Number(canonicalStat.ino)) continue
    if (realRoot === realHome) continue
    const insideHome = isInside(realHome, realRoot)
    const exactTemp = realTemp && realRoot === realTemp && item.requireOwnership && uid != null
    if (!insideHome && !exactTemp) continue
    prepared.push({ ...item, requireOwnership: item.requireOwnership && uid != null, realRoot, rootDev: Number(canonicalStat.dev), rootIno: Number(canonicalStat.ino), realHome, realTemp })
  }
  return prepared
}

function createCleaner(options = {}) {
  const home = options.home
  const tempRoot = options.tempRoot
  const roots = Array.isArray(options.roots) ? options.roots : []
  const now = typeof options.now === 'function' ? options.now : Date.now
  const trashItem = options.trashItem
  const uid = Number.isInteger(options.uid) ? options.uid : null
  const snapshots = new Map()
  let scanFlight = null
  let scanFlightKey = ''
  let scanGeneration = 0
  let activeAction = null

  async function withAction(kind, task) {
    if (activeAction) throw Object.assign(new Error(`系统清理正在执行${activeAction}，请稍后重试`), { code: 'CLEANER_BUSY' })
    activeAction = kind
    try { return await task() } finally { activeAction = null }
  }

  function pruneSnapshots() {
    const current = now()
    for (const [id, snapshot] of snapshots) {
      if (snapshot.expiresAt <= current || snapshot.used) snapshots.delete(id)
    }
    while (snapshots.size >= MAX_SNAPSHOTS) snapshots.delete(snapshots.keys().next().value)
  }

  async function scan(request = {}) {
    const requestedCategories = Array.isArray(request.categories)
      ? [...new Set(request.categories.filter((value) => ALLOWED_CATEGORIES.has(value)))].sort()
      : null
    const requestKey = JSON.stringify(requestedCategories)
    if (scanFlight) {
      if (scanFlightKey === requestKey) return scanFlight
      throw Object.assign(new Error('已有不同范围的扫描正在进行'), { code: 'SCAN_BUSY' })
    }
    const generation = ++scanGeneration
    scanFlightKey = requestKey
    scanFlight = withAction('扫描', async () => {
      pruneSnapshots()
      const requested = requestedCategories ? new Set(requestedCategories) : null
      const preparedRoots = await prepareRoots(roots, home, tempRoot, uid)
      const candidates = []
      const warnings = []
      const scanState = {
        entries: 0,
        unreadable: 0,
        foreignOwner: 0,
        truncated: false,
        deadline: Date.now() + MAX_SCAN_MS,
        cancelled: () => generation !== scanGeneration
      }

      for (const root of preparedRoots) {
        if (requested && !requested.has(root.category)) continue
        try {
          const directory = await fs.opendir(root.realRoot)
          for await (const entry of directory) {
            if (candidates.length >= MAX_CANDIDATES || Date.now() >= scanState.deadline) {
              scanState.truncated = true
              break
            }
            if (scanState.cancelled()) throw Object.assign(new Error('scan cancelled'), { code: 'SCAN_CANCELLED' })
            const candidatePath = path.join(root.realRoot, entry.name)
            let stat
            let realCandidate
            try {
              stat = await fs.lstat(candidatePath)
              if (stat.isSymbolicLink() || Number(stat.dev) !== root.rootDev) continue
              if (root.requireOwnership && (uid == null || Number(stat.uid) !== uid)) continue
              realCandidate = await fs.realpath(candidatePath)
            } catch {
              scanState.unreadable += 1
              continue
            }
            if (!isInside(root.realRoot, realCandidate)) continue
            const ageDays = Math.max(0, (now() - Number(stat.mtimeMs)) / 86_400_000)
            const sizeState = {
              entries: scanState.entries,
              unreadable: 0,
              truncated: false,
              missingRoot: false,
              foreignOwner: false,
              rootDev: root.rootDev,
              requiredUid: root.requireOwnership ? uid : null,
              basePath: realCandidate,
              digest: Buffer.alloc(32),
              deadline: scanState.deadline,
              cancelled: scanState.cancelled
            }
            const sizeBytes = await measurePath(realCandidate, sizeState)
            scanState.entries = sizeState.entries
            scanState.unreadable += sizeState.unreadable
            if (sizeState.foreignOwner) scanState.foreignOwner += 1
            scanState.truncated ||= sizeState.truncated
            if (sizeState.missingRoot || sizeState.unreadable || sizeState.foreignOwner || sizeState.truncated) continue
            candidates.push({
              id: crypto.randomUUID(),
              rootId: root.id,
              category: root.category,
              label: cleanText(entry.name) || '未命名项目',
              location: displayPath(realCandidate, root.realHome, root.realTemp),
              sizeBytes,
              ageDays: Math.floor(ageDays),
              kind: stat.isDirectory() ? 'directory' : 'file',
              selectedByDefault: root.defaultSelected && ageDays >= Math.max(0, root.minAgeDays),
              path: realCandidate,
              rootPath: root.realRoot,
              rootDev: root.rootDev,
              requireOwnership: root.requireOwnership,
              fingerprint: fingerprint(stat),
              treeDigest: sizeState.digest.toString('hex')
            })
          }
        } catch (error) {
          if (error && error.code === 'SCAN_CANCELLED') throw error
          warnings.push({ code: 'ROOT_UNREADABLE', source: root.id, message: `${root.label}无法读取` })
        }
      }

      if (scanState.unreadable) warnings.push({ code: 'ITEMS_UNREADABLE', message: `${scanState.unreadable} 个位置无法读取，已安全跳过` })
      if (scanState.foreignOwner) warnings.push({ code: 'FOREIGN_OWNER', message: `${scanState.foreignOwner} 个项目包含其他用户内容，已安全跳过` })
      if (scanState.truncated) warnings.push({ code: 'SCAN_TRUNCATED', message: '扫描达到安全上限，结果可能不完整' })
      const snapshotId = crypto.randomUUID()
      const generatedAt = new Date(now()).toISOString()
      const snapshot = {
        id: snapshotId,
        generatedAt,
        expiresAt: now() + SNAPSHOT_TTL_MS,
        used: false,
        candidates: new Map(candidates.map((item) => [item.id, item]))
      }
      snapshots.set(snapshotId, snapshot)
      return {
        snapshotId,
        generatedAt,
        expiresAt: new Date(snapshot.expiresAt).toISOString(),
        candidates: candidates.map(({ path: _path, rootPath: _rootPath, rootDev: _rootDev, requireOwnership: _owner, fingerprint: _fingerprint, treeDigest: _treeDigest, ...safe }) => safe),
        totalBytes: candidates.reduce((sum, item) => sum + item.sizeBytes, 0),
        warnings
      }
    }).finally(() => { scanFlight = null; scanFlightKey = '' })
    return scanFlight
  }

  function cancelScan() {
    if (!scanFlight) return false
    scanGeneration += 1
    return true
  }

  function getSnapshot(snapshotId) {
    pruneSnapshots()
    const snapshot = snapshots.get(snapshotId)
    if (!snapshot || snapshot.used || snapshot.expiresAt <= now()) {
      throw Object.assign(new Error('扫描结果已过期，请重新扫描'), { code: 'SNAPSHOT_EXPIRED' })
    }
    return snapshot
  }

  async function validateCandidate(candidate) {
    const realPath = await fs.realpath(candidate.path)
    if (realPath !== candidate.path || !isInside(candidate.rootPath, realPath)) {
      throw Object.assign(new Error('项目位置已变化'), { code: 'PATH_CHANGED' })
    }
    const stat = await fs.lstat(realPath)
    if (stat.isSymbolicLink() || Number(stat.dev) !== candidate.rootDev) {
      throw Object.assign(new Error('项目已变为不安全位置'), { code: 'UNSAFE_PATH' })
    }
    if (candidate.requireOwnership && (uid == null || Number(stat.uid) !== uid)) {
      throw Object.assign(new Error('项目不属于当前用户'), { code: 'OWNERSHIP_CHANGED' })
    }
    if (!sameFingerprint(candidate.fingerprint, fingerprint(stat))) {
      throw Object.assign(new Error('项目在扫描后发生变化'), { code: 'FINGERPRINT_CHANGED' })
    }
    const verificationState = {
      entries: 0,
      unreadable: 0,
      truncated: false,
      missingRoot: false,
      foreignOwner: false,
      rootDev: candidate.rootDev,
      requiredUid: candidate.requireOwnership ? uid : null,
      basePath: realPath,
      digest: Buffer.alloc(32),
      deadline: Date.now() + MAX_SCAN_MS,
      cancelled: () => false
    }
    await measurePath(realPath, verificationState)
    if (verificationState.foreignOwner) {
      throw Object.assign(new Error('项目包含不属于当前用户的内容'), { code: 'OWNERSHIP_CHANGED' })
    }
    if (verificationState.missingRoot || verificationState.unreadable || verificationState.truncated || verificationState.digest.toString('hex') !== candidate.treeDigest) {
      throw Object.assign(new Error('项目内容在扫描后发生变化'), { code: 'CONTENT_CHANGED' })
    }
    return realPath
  }

  async function cleanUnlocked(request = {}) {
    if (request.confirmation !== '移到废纸篓') {
      throw Object.assign(new Error('需要输入确认文本'), { code: 'CONFIRMATION_REQUIRED' })
    }
    if (!Array.isArray(request.candidateIds) || request.candidateIds.length === 0 || request.candidateIds.length > MAX_CANDIDATES) {
      throw Object.assign(new Error('请选择有效的清理项目'), { code: 'INVALID_SELECTION' })
    }
    if (typeof trashItem !== 'function') throw Object.assign(new Error('废纸篓能力不可用'), { code: 'TRASH_UNAVAILABLE' })
    const snapshot = getSnapshot(request.snapshotId)
    const selected = [...new Set(request.candidateIds)].map((id) => {
      const candidate = snapshot.candidates.get(id)
      if (!candidate) throw Object.assign(new Error('包含未知清理项目'), { code: 'UNKNOWN_CANDIDATE' })
      return candidate
    })
    snapshot.used = true

    const results = []
    for (const candidate of selected) {
      try {
        const targetPath = await validateCandidate(candidate)
        await trashItem(targetPath)
        results.push({ candidateId: candidate.id, status: 'trashed', sizeBytes: candidate.sizeBytes })
      } catch (error) {
        results.push({ candidateId: candidate.id, status: 'failed', code: cleanText(error && error.code, 60) || 'CLEAN_FAILED', message: cleanText(error && error.message) || '清理失败' })
      }
    }
    return {
      operationId: crypto.randomUUID(),
      completedAt: new Date(now()).toISOString(),
      results,
      movedBytes: results.filter((item) => item.status === 'trashed').reduce((sum, item) => sum + item.sizeBytes, 0)
    }
  }

  async function clean(request = {}) {
    return withAction('清理', () => cleanUnlocked(request))
  }

  function resolveCandidate(snapshotId, candidateId) {
    const snapshot = getSnapshot(snapshotId)
    const candidate = snapshot.candidates.get(candidateId)
    if (!candidate) throw Object.assign(new Error('未知项目'), { code: 'UNKNOWN_CANDIDATE' })
    return candidate.path
  }

  return { scan, cancelScan, clean, resolveCandidate }
}

module.exports = {
  ALLOWED_CATEGORIES,
  MAX_CANDIDATES,
  MAX_SCAN_MS,
  SNAPSHOT_TTL_MS,
  cleanText,
  createCleaner,
  fingerprint,
  isInside,
  measurePath,
  prepareRoots,
  sameFingerprint
}
