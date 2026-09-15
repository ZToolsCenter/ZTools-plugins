'use strict'

const crypto = require('node:crypto')
const path = require('node:path')
const { performance } = require('node:perf_hooks')

const MAX_TREE_ENTRIES = 50_000
const MAX_TREE_DEPTH = 64
const TREE_DEADLINE_MS = 5_000

function opaqueId(prefix, value, secret = '') {
  return `${prefix}_${crypto.createHash('sha256').update(`${secret}\0${value}`).digest('hex').slice(0, 20)}`
}

function isInside(root, target, pathApi = path) {
  const relative = pathApi.relative(pathApi.resolve(root), pathApi.resolve(target))
  return relative !== '' && !relative.startsWith('..') && !pathApi.isAbsolute(relative)
}

function safeRoots(platform, home, env = process.env) {
  if (platform === 'darwin') {
    return [
      path.join(home, 'Applications'),
      path.join(home, 'Library', 'Application Support'),
      path.join(home, 'Library', 'Caches'),
      path.join(home, 'Library', 'Logs'),
      path.join(home, 'Library', 'Saved Application State'),
      path.join(home, 'Library', 'Containers'),
      path.join(home, 'Library', 'Preferences'),
    ]
  }
  if (platform === 'win32') {
    return [
      path.win32.join(home, 'AppData', 'Local'),
      path.win32.join(home, 'AppData', 'Roaming'),
    ].map((item) => path.win32.resolve(item))
  }
  return [
    path.join(home, 'Applications'),
    path.join(home, '.local', 'bin'),
    path.join(home, '.local', 'share'),
    path.join(home, '.local', 'state'),
    path.join(home, '.config'),
    path.join(home, '.cache'),
  ]
}

function protectedRoots(platform, home, env = process.env) {
  const common = [home]
  if (platform === 'darwin') return [...common, '/', '/System', '/Library', '/Applications']
  if (platform === 'win32') {
    return [...common, env.SystemRoot, env.ProgramFiles, env['ProgramFiles(x86)'], env.ProgramData]
      .filter(Boolean)
      .map((item) => path.win32.resolve(item))
  }
  return [...common, '/', '/bin', '/boot', '/dev', '/etc', '/lib', '/lib64', '/opt', '/proc', '/root', '/run', '/sbin', '/srv', '/sys', '/usr', '/var']
}

function assertSafeUserPath(target, options) {
  const platform = options.platform
  const pathApi = platform === 'win32' ? path.win32 : path
  if (typeof target !== 'string' || target.length === 0 || target.includes('\0')) {
    throw new Error('路径无效')
  }
  const resolved = pathApi.resolve(target)
  const roots = safeRoots(platform, options.home, options.env)
  const forbidden = protectedRoots(platform, options.home, options.env)
  if (forbidden.some((root) => pathApi.resolve(root) === resolved)) throw new Error('禁止操作受保护目录')
  if (!roots.some((root) => isInside(root, resolved, pathApi))) throw new Error('路径不在允许的用户目录内')
  return resolved
}

async function assertCanonicalSafeUserPath(target, options, fs) {
  const lexical = assertSafeUserPath(target, options)
  const pathApi = options.platform === 'win32' ? path.win32 : path
  const targetRealPath = await fs.realpath(lexical)
  const realHome = await fs.realpath(options.home)
  let matchedRoot = false
  for (const root of safeRoots(options.platform, options.home, options.env)) {
    if (!isInside(root, lexical, pathApi)) continue
    matchedRoot = true
    try {
      const rootInfo = await fs.lstat(root)
      if (rootInfo.isSymbolicLink()) throw new Error('允许根目录不能是符号链接或目录联接')
      if (!rootInfo.isDirectory()) throw new Error('允许根路径不是目录')
      const canonicalRoot = await fs.realpath(root)
      if (!isInside(realHome, canonicalRoot, pathApi)) throw new Error('允许根目录的真实路径越过用户 Home')
      if (!isInside(canonicalRoot, targetRealPath, pathApi)) throw new Error('真实路径越过允许的用户目录')
      return targetRealPath
    } catch (error) {
      if (error && error.code !== 'ENOENT') throw error
    }
  }
  if (!matchedRoot) throw new Error('路径不在允许的用户目录内')
  throw new Error('允许根目录不存在')
}

async function snapshotDirectory(root, fs, options = {}) {
  const digest = Buffer.alloc(32)
  let entries = 0
  let totalBytes = 0
  const maxEntries = options.maxEntries ?? MAX_TREE_ENTRIES
  const maxDepth = options.maxDepth ?? MAX_TREE_DEPTH
  const deadlineMs = options.deadlineMs ?? TREE_DEADLINE_MS
  const now = options.now || (() => performance.now())
  const startedAt = now()
  const rootDev = String(options.rootDev)
  function record(value) {
    const itemHash = crypto.createHash('sha256').update(JSON.stringify(value)).digest()
    for (let index = 0; index < digest.length; index += 1) digest[index] ^= itemHash[index]
  }
  async function visit(directory, relative, depth) {
    if (depth > maxDepth) throw new Error(`目录深度超过安全上限 ${maxDepth}`)
    if (now() - startedAt > deadlineMs) throw new Error(`目录快照超过安全时限 ${deadlineMs}ms`)
    const handle = await fs.opendir(directory)
    for await (const child of handle) {
      entries += 1
      if (entries > maxEntries) throw new Error(`目录项目超过安全上限 ${maxEntries}`)
      if (now() - startedAt > deadlineMs) throw new Error(`目录快照超过安全时限 ${deadlineMs}ms`)
      const childPath = path.join(directory, child.name)
      const childRelative = relative ? path.join(relative, child.name) : child.name
      const info = await fs.lstat(childPath)
      if (String(info.dev) !== rootDev) throw new Error('目录包含跨设备挂载，拒绝自动处理')
      const kind = info.isSymbolicLink() ? 'link' : info.isDirectory() ? 'directory' : info.isFile() ? 'file' : 'other'
      record([childRelative, kind, String(info.dev), String(info.ino), Number(info.size), Math.trunc(info.mtimeMs)])
      if (info.isFile()) totalBytes += Number(info.size)
      if (info.isDirectory()) await visit(childPath, childRelative, depth + 1)
    }
  }
  await visit(root, '', 0)
  return { treeDigest: digest.toString('hex'), treeEntries: entries, treeBytes: totalBytes }
}

async function fingerprint(target, fs) {
  const info = await fs.lstat(target)
  if (info.isSymbolicLink()) throw new Error('拒绝处理符号链接')
  const realPath = await fs.realpath(target)
  const base = {
    realPath,
    dev: String(info.dev),
    ino: String(info.ino),
    size: Number(info.size),
    mtimeMs: Math.trunc(info.mtimeMs),
    kind: info.isDirectory() ? 'directory' : info.isFile() ? 'file' : 'other',
  }
  if (!info.isDirectory()) return { ...base, treeDigest: null, treeEntries: null, treeBytes: info.isFile() ? Number(info.size) : null }
  return { ...base, ...await snapshotDirectory(target, fs, { rootDev: info.dev }) }
}

async function secureFingerprint(target, options, fs) {
  const before = await assertCanonicalSafeUserPath(target, options, fs)
  const value = await fingerprint(target, fs)
  const after = await assertCanonicalSafeUserPath(target, options, fs)
  if (value.realPath !== before || value.realPath !== after) throw new Error('真实路径在安全校验期间发生变化')
  return value
}

function sameFingerprint(left, right) {
  return Boolean(left && right)
    && left.realPath === right.realPath
    && left.dev === right.dev
    && left.ino === right.ino
    && left.size === right.size
    && left.mtimeMs === right.mtimeMs
    && left.kind === right.kind
    && left.treeDigest === right.treeDigest
    && left.treeEntries === right.treeEntries
    && left.treeBytes === right.treeBytes
}

module.exports = {
  MAX_TREE_ENTRIES,
  MAX_TREE_DEPTH,
  TREE_DEADLINE_MS,
  assertCanonicalSafeUserPath,
  assertSafeUserPath,
  fingerprint,
  isInside,
  opaqueId,
  protectedRoots,
  safeRoots,
  secureFingerprint,
  sameFingerprint,
  snapshotDirectory,
}
