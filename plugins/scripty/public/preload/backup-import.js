'use strict'

const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { createHash } = require('node:crypto')
const { TextDecoder } = require('node:util')
const yauzl = require('yauzl')
const { isValidFivePartCron } = require('./cron-utils')
const { createManagedScriptFileName, normalizeManagedFolderPath, normalizeManagedScriptPath } = require('./file-repositories')
const { RepositoryError, mapFileSystemError } = require('./metadata-repository')
const {
  EXPORT_FORMAT_VERSION,
  LEGACY_EXPORT_FORMAT_VERSION,
  LEGACY_REQUIRED_DATA_PATHS,
  HASH_PATTERN,
  MAX_COMPRESSION_RATIO,
  MAX_PACKAGE_BYTES,
  MAX_PACKAGE_FILES,
  REQUIRED_DATA_PATHS,
  assertExportOptions,
  compareStableText,
  getPackageFileLimit,
  isAllowedPackagePath
} = require('./backup-protocol')

const BACKUP_DATA_SCHEMA_VERSION = 2
const LEGACY_BACKUP_DATA_SCHEMA_VERSION = 1
const ENTITY_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
const ENVIRONMENT_NAME_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/
const SEMVER_PATTERN = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/
const SCRIPT_LANGUAGES = new Set(['javascript', 'python', 'powershell', 'shell'])
const CONCURRENCY_POLICIES = new Set(['forbid', 'limited'])
const MAX_ARGUMENTS = 100
const MAX_ARGUMENT_LENGTH = 2000
const MAX_ENVIRONMENT_VALUE_LENGTH = 10000
const MIN_TIMEOUT_MS = 1000
const MAX_TIMEOUT_MS = 86400000
const textDecoder = new TextDecoder('utf-8', { fatal: true })

/** Requires a plain object with exactly the protocol-owned keys for version 1.0. */
function assertExactKeys(value, expectedKeys, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.getPrototypeOf(value) !== Object.prototype) {
    throw new RepositoryError('PACKAGE_INVALID', `${label}格式无效`)
  }
  const keys = Object.keys(value).sort()
  const expected = [...expectedKeys].sort()
  if (keys.length !== expected.length || keys.some((key, index) => key !== expected[index])) {
    throw new RepositoryError('PACKAGE_INVALID', `${label}字段无效`)
  }
}

/** Decodes one bounded protocol JSON file with fatal UTF-8 handling and a plain-root requirement. */
function parsePackageJson(buffer, label) {
  try {
    const value = JSON.parse(textDecoder.decode(buffer))
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('root')
    return value
  } catch (error) {
    throw new RepositoryError('PACKAGE_INVALID', `${label}不是有效的 UTF-8 JSON`, error)
  }
}

/** Returns whether a timestamp uses the protocol's canonical ISO 8601 UTC representation. */
function isCanonicalIsoDateTime(value) {
  if (typeof value !== 'string') return false
  const parsed = new Date(value)
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString() === value
}

/** Requires a protocol string, optionally rejecting empty values and enforcing a maximum length. */
function assertString(value, label, options = {}) {
  const { allowEmpty = true, maxLength = Number.MAX_SAFE_INTEGER } = options
  if (typeof value !== 'string' || (!allowEmpty && value.length === 0) || value.length > maxLength) {
    throw new RepositoryError('PACKAGE_INVALID', `${label}格式无效`)
  }
}

/** Validates fields shared by timestamped portable entities after their exact key sets are checked. */
function assertTimestampedEntity(entity, label) {
  assertString(entity.name, `${label}名称`, { allowEmpty: false })
  assertString(entity.note, `${label}备注`)
  if (!isCanonicalIsoDateTime(entity.createdAt) || !isCanonicalIsoDateTime(entity.updatedAt)) {
    throw new RepositoryError('PACKAGE_INVALID', `${label}时间格式无效`)
  }
}

/** Validates one forbid-or-limited concurrency object and its policy-dependent limit. */
function assertConcurrency(value, label) {
  assertExactKeys(value, ['policy', 'limit'], `${label}并发配置`)
  if (!CONCURRENCY_POLICIES.has(value.policy) || !Number.isInteger(value.limit) || value.limit < 1 || (value.policy === 'forbid' && value.limit !== 1)) {
    throw new RepositoryError('PACKAGE_INVALID', `${label}并发配置无效`)
  }
}

/** Validates the exact portable Script shape before deriving its controlled package path. */
function assertPortableScript(script, legacy = false) {
  assertExactKeys(script, legacy
    ? ['id', 'name', 'managedFileName', 'language', 'contentHash', 'note', 'createdAt', 'updatedAt']
    : ['id', 'name', 'managedFileName', 'relativePath', 'language', 'contentHash', 'note', 'createdAt', 'updatedAt'], '脚本')
  assertTimestampedEntity(script, '脚本')
  if (!SCRIPT_LANGUAGES.has(script.language) || !HASH_PATTERN.test(script.contentHash)) {
    throw new RepositoryError('PACKAGE_INVALID', '脚本语言或哈希无效')
  }
}

/** Validates the exact portable Task shape, including null device paths and bounded execution settings. */
function assertPortableTask(task, scripts) {
  assertExactKeys(task, ['id', 'name', 'note', 'scriptId', 'interpreter', 'args', 'workingDirectory', 'cron', 'timeoutMs', 'enabled', 'concurrency', 'createdAt', 'updatedAt'], '任务')
  assertTimestampedEntity(task, '任务')
  assertExactKeys(task.interpreter, ['kind', 'executable'], '任务解释器')
  const script = scripts.get(task.scriptId)
  if (!script || task.interpreter.kind !== script.language || task.interpreter.executable !== null || task.workingDirectory !== null) {
    throw new RepositoryError('PACKAGE_INVALID', '任务便携执行配置无效')
  }
  if (!Array.isArray(task.args) || task.args.length > MAX_ARGUMENTS || task.args.some(item => typeof item !== 'string' || item.length > MAX_ARGUMENT_LENGTH)) {
    throw new RepositoryError('PACKAGE_INVALID', '任务参数无效')
  }
  if (!isValidFivePartCron(task.cron) || (task.timeoutMs !== null && (!Number.isInteger(task.timeoutMs) || task.timeoutMs < MIN_TIMEOUT_MS || task.timeoutMs > MAX_TIMEOUT_MS))) {
    throw new RepositoryError('PACKAGE_INVALID', '任务 Cron 或超时时间无效')
  }
  if (typeof task.enabled !== 'boolean') throw new RepositoryError('PACKAGE_INVALID', '任务状态无效')
  assertConcurrency(task.concurrency, '任务')
}

/** Validates the exact portable environment shape and its manifest-controlled value projection. */
function assertPortableEnvironment(variable, tasks, manifest, namesByScope) {
  assertExactKeys(variable, ['id', 'name', 'value', 'valueIncluded', 'note', 'scope', 'taskId', 'enabled', 'sensitive', 'createdAt', 'updatedAt'], '环境变量')
  assertTimestampedEntity(variable, '环境变量')
  if (!ENVIRONMENT_NAME_PATTERN.test(variable.name) || typeof variable.value !== 'string' || variable.value.length > MAX_ENVIRONMENT_VALUE_LENGTH || typeof variable.valueIncluded !== 'boolean' || typeof variable.sensitive !== 'boolean' || typeof variable.enabled !== 'boolean') {
    throw new RepositoryError('PACKAGE_INVALID', '环境变量格式无效')
  }
  if (variable.scope === 'global' ? variable.taskId !== null : variable.scope !== 'task' || !tasks.has(variable.taskId)) {
    throw new RepositoryError('PACKAGE_INVALID', '环境变量作用域或任务引用无效')
  }
  const key = `${variable.scope}\0${variable.taskId ?? ''}\0${variable.name}`
  if (namesByScope.has(key)) throw new RepositoryError('PACKAGE_INVALID', '同一作用域存在重名环境变量')
  namesByScope.add(key)
  const mayInclude = manifest.options.includeEnvironmentValues && (!variable.sensitive || manifest.options.includeSensitiveValues)
  if (variable.valueIncluded !== mayInclude || (!variable.valueIncluded && variable.value !== '')) {
    throw new RepositoryError('PACKAGE_INVALID', '环境变量值与导出范围不一致')
  }
}

/** Validates the exact portable Settings projection and every retained cross-device setting. */
function assertPortableSettings(settings) {
  assertExactKeys(settings, ['defaultTimeoutMs', 'defaultConcurrency', 'logRetention', 'updatedAt'], '便携设置')
  if (!Number.isInteger(settings.defaultTimeoutMs) || settings.defaultTimeoutMs < MIN_TIMEOUT_MS || settings.defaultTimeoutMs > MAX_TIMEOUT_MS) {
    throw new RepositoryError('PACKAGE_INVALID', '默认超时时间无效')
  }
  assertConcurrency(settings.defaultConcurrency, '默认')
  assertExactKeys(settings.logRetention, ['maxRunsPerTask', 'maxAgeDays'], '日志保留设置')
  for (const field of ['maxRunsPerTask', 'maxAgeDays']) {
    const value = settings.logRetention[field]
    if (value !== null && (!Number.isInteger(value) || value < 1)) throw new RepositoryError('PACKAGE_INVALID', '日志保留设置无效')
  }
  if (!isCanonicalIsoDateTime(settings.updatedAt)) throw new RepositoryError('PACKAGE_INVALID', '设置更新时间无效')
}

/** Validates the exact manifest 1.0 shape before any non-manifest bytes are staged. */
function validateImportManifest(manifest) {
  assertExactKeys(manifest, ['formatVersion', 'appVersion', 'exportedAt', 'entities', 'options', 'files'], 'manifest.json')
  if (typeof manifest.formatVersion !== 'string') throw new RepositoryError('PACKAGE_INVALID', '备份格式版本无效')
  if (manifest.formatVersion !== EXPORT_FORMAT_VERSION && manifest.formatVersion !== LEGACY_EXPORT_FORMAT_VERSION) {
    throw new RepositoryError('UNSUPPORTED_EXPORT_VERSION', `仅支持备份格式 ${LEGACY_EXPORT_FORMAT_VERSION} 或 ${EXPORT_FORMAT_VERSION}`)
  }
  if (!SEMVER_PATTERN.test(manifest.appVersion)) throw new RepositoryError('PACKAGE_INVALID', '备份应用版本无效')
  const exportedAt = new Date(manifest.exportedAt)
  if (typeof manifest.exportedAt !== 'string' || Number.isNaN(exportedAt.getTime()) || exportedAt.toISOString() !== manifest.exportedAt) {
    throw new RepositoryError('PACKAGE_INVALID', '备份导出时间无效')
  }
  const expectedEntityKeys = manifest.formatVersion === LEGACY_EXPORT_FORMAT_VERSION
    ? ['scripts', 'tasks', 'environments']
    : ['scripts', 'scriptFolders', 'dependencies', 'tasks', 'environments']
  assertExactKeys(manifest.entities, expectedEntityKeys, '实体数量')
  for (const value of Object.values(manifest.entities)) {
    if (!Number.isSafeInteger(value) || value < 0) throw new RepositoryError('PACKAGE_INVALID', '实体数量无效')
  }
  assertExactKeys(manifest.options, ['includeEnvironments', 'includeEnvironmentValues', 'includeSensitiveValues'], '导出选项')
  assertExportOptions(manifest.options, 'PACKAGE_INVALID')
  if (!Array.isArray(manifest.files) || manifest.files.length + 1 > MAX_PACKAGE_FILES) {
    throw new RepositoryError('PACKAGE_LIMIT_EXCEEDED', '备份文件数量超过安全限制')
  }
  const paths = new Set()
  let previousPath = null
  for (const file of manifest.files) {
    assertExactKeys(file, ['path', 'sha256', 'size'], '文件清单项')
    if (!isAllowedPackagePath(file.path) || file.path === 'manifest.json') throw new RepositoryError('PACKAGE_INVALID', '文件清单包含非法路径')
    const collisionKey = file.path.toLowerCase()
    if (paths.has(collisionKey) || (previousPath !== null && compareStableText(previousPath, file.path) >= 0)) {
      throw new RepositoryError('PACKAGE_INVALID', '文件清单路径重复或未排序')
    }
    if (!HASH_PATTERN.test(file.sha256) || !Number.isSafeInteger(file.size) || file.size < 0 || file.size > getPackageFileLimit(file.path)) {
      throw new RepositoryError('PACKAGE_INVALID', '文件清单哈希或大小无效')
    }
    paths.add(collisionKey)
    previousPath = file.path
  }
  const requiredPaths = manifest.formatVersion === LEGACY_EXPORT_FORMAT_VERSION ? LEGACY_REQUIRED_DATA_PATHS : REQUIRED_DATA_PATHS
  for (const requiredPath of requiredPaths) {
    if (!paths.has(requiredPath.toLowerCase())) throw new RepositoryError('PACKAGE_INVALID', '备份缺少必填数据文件')
  }
  return manifest
}

/** Opens a ZIP from an already validated descriptor so later path replacement cannot change the bytes read. */
function openZip(fileDescriptor) {
  return new Promise((resolve, reject) => {
    yauzl.fromFd(fileDescriptor, { lazyEntries: true, strictFileNames: true, validateEntrySizes: true, autoClose: false }, (error, zipFile) => {
      if (error) reject(new RepositoryError('PACKAGE_INVALID', '备份 ZIP 结构无效', error))
      else resolve(zipFile)
    })
  })
}

/** Converts a ZIP parser failure into a bounded single-line diagnostic without exposing stack traces. */
function formatZipDirectoryError(error) {
  const detail = typeof error?.message === 'string'
    ? error.message.replace(/[\x00-\x1f\x7f]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 180)
    : ''
  const reason = detail ? `（解析器原因：${detail}）` : ''
  return `备份 ZIP 目录无效${reason}。请重新复制并直接选择 Scripty 导出的原始 ZIP，不要解压后重新压缩`
}

/** Scans every central-directory entry before extraction and enforces path, type, count, and ratio limits. */
function scanArchiveEntries(zipFile) {
  return new Promise((resolve, reject) => {
    const entries = new Map()
    let totalSize = 0
    let settled = false
    const fail = (error) => {
      if (settled) return
      settled = true
      reject(error instanceof RepositoryError ? error : new RepositoryError('PACKAGE_INVALID', formatZipDirectoryError(error), error))
    }
    zipFile.once('error', fail)
    zipFile.on('entry', (entry) => {
      try {
        if (entries.size + 1 > MAX_PACKAGE_FILES) throw new RepositoryError('PACKAGE_LIMIT_EXCEEDED', '备份文件数量超过安全限制')
        const entryPath = entry.fileName
        const creatorSystem = (entry.versionMadeBy >>> 8) & 0xff
        const hasPosixMode = creatorSystem === 3 || creatorSystem === 19
        const unixMode = hasPosixMode ? (entry.externalFileAttributes >>> 16) & 0xffff : 0
        const fileType = unixMode & 0xf000
        const isDirectory = entryPath.endsWith('/') || (entry.externalFileAttributes & 0x10) !== 0 || (hasPosixMode && fileType === 0x4000)
        const hasInvalidPosixType = hasPosixMode && fileType !== 0 && fileType !== 0x8000
        if (!isAllowedPackagePath(entryPath) || isDirectory || hasInvalidPosixType) {
          throw new RepositoryError('PACKAGE_INVALID', '备份包含非法路径或文件类型')
        }
        if ((entry.generalPurposeBitFlag & 1) !== 0 || ![0, 8].includes(entry.compressionMethod)) {
          throw new RepositoryError('PACKAGE_INVALID', '备份包含不支持的 ZIP 条目')
        }
        const collisionKey = entryPath.toLowerCase()
        if (entries.has(collisionKey)) throw new RepositoryError('PACKAGE_INVALID', '备份包含重复路径')
        if (!Number.isSafeInteger(entry.uncompressedSize) || entry.uncompressedSize > getPackageFileLimit(entryPath)) {
          throw new RepositoryError('PACKAGE_LIMIT_EXCEEDED', '备份单文件超过安全限制')
        }
        const ratio = entry.uncompressedSize / Math.max(entry.compressedSize, 1)
        if (ratio > MAX_COMPRESSION_RATIO) throw new RepositoryError('PACKAGE_LIMIT_EXCEEDED', '备份压缩比超过安全限制')
        totalSize += entry.uncompressedSize
        if (totalSize > MAX_PACKAGE_BYTES) throw new RepositoryError('PACKAGE_LIMIT_EXCEEDED', '备份总大小超过安全限制')
        entries.set(collisionKey, entry)
        zipFile.readEntry()
      } catch (error) {
        fail(error)
      }
    })
    zipFile.once('end', () => {
      if (!settled) {
        settled = true
        resolve(entries)
      }
    })
    zipFile.readEntry()
  })
}

/** Reads one ZIP entry into a bounded buffer and verifies its streamed byte count. */
function readEntryBuffer(zipFile, entry) {
  return new Promise((resolve, reject) => {
    zipFile.openReadStream(entry, (openError, stream) => {
      if (openError) return reject(new RepositoryError('PACKAGE_INVALID', '无法读取备份条目', openError))
      const chunks = []
      let size = 0
      stream.on('data', (chunk) => {
        size += chunk.length
        if (size > getPackageFileLimit(entry.fileName)) stream.destroy(new RepositoryError('PACKAGE_LIMIT_EXCEEDED', '备份条目超过安全限制'))
        else chunks.push(chunk)
      })
      stream.once('error', reject)
      stream.once('end', () => {
        if (size !== entry.uncompressedSize) reject(new RepositoryError('HASH_MISMATCH', '备份条目大小校验失败'))
        else resolve(Buffer.concat(chunks))
      })
    })
  })
}

/** Reconciles central-directory entries against the manifest before reading package payloads. */
function reconcileManifestEntries(manifest, entries) {
  const expected = new Set(['manifest.json', ...manifest.files.map(file => file.path)].map(item => item.toLowerCase()))
  if (entries.size !== expected.size || [...entries.keys()].some(entryPath => !expected.has(entryPath))) {
    throw new RepositoryError('PACKAGE_INVALID', '备份实际文件与清单不一致')
  }
  for (const file of manifest.files) {
    const entry = entries.get(file.path.toLowerCase())
    if (!entry || entry.fileName !== file.path || entry.uncompressedSize !== file.size) {
      throw new RepositoryError('PACKAGE_INVALID', '备份文件大小或路径与清单不一致')
    }
  }
}

/** Validates portable script and folder paths as one Windows-safe tree before import staging. */
function validatePortableTreePaths(scripts, folders, legacy) {
  if (legacy) return
  const nodes = []
  for (const script of scripts) {
    let normalized
    try { normalized = normalizeManagedScriptPath(script.relativePath, script.language) } catch { throw new RepositoryError('PACKAGE_INVALID', '脚本路径无效') }
    if (normalized !== script.relativePath) throw new RepositoryError('PACKAGE_INVALID', '脚本路径必须是规范的相对路径')
    nodes.push({ kind: 'script', path: normalized, key: normalized.toLowerCase() })
  }
  for (const folder of folders) {
    let normalized
    try { normalized = normalizeManagedFolderPath(folder.relativePath) } catch { throw new RepositoryError('PACKAGE_INVALID', '脚本目录路径无效') }
    if (normalized !== folder.relativePath) throw new RepositoryError('PACKAGE_INVALID', '脚本目录路径必须是规范的相对路径')
    nodes.push({ kind: 'folder', path: normalized, key: normalized.toLowerCase() })
  }
  const seen = new Map()
  for (const node of nodes) {
    const previous = seen.get(node.key)
    const hasFileTreeConflict = nodes.some(candidate => candidate !== node && (
      (node.kind === 'script' && candidate.key.startsWith(`${node.key}/`)) ||
      (candidate.kind === 'script' && node.key.startsWith(`${candidate.key}/`))
    ))
    if (previous || hasFileTreeConflict) {
      throw new RepositoryError('PACKAGE_INVALID', '脚本与目录路径存在冲突或重复')
    }
    seen.set(node.key, node)
  }
}

/** Validates current-version envelopes, portable entities, references, counts, and script-file relationships. */
function validateImportDocuments(manifest, documents, hashes) {
  const legacy = manifest.formatVersion === LEGACY_EXPORT_FORMAT_VERSION
  if (legacy) {
    documents.scriptFolders = { schemaVersion: LEGACY_BACKUP_DATA_SCHEMA_VERSION, data: [] }
    documents.dependencies = { schemaVersion: LEGACY_BACKUP_DATA_SCHEMA_VERSION, data: [] }
  }
  const shapes = { scripts: 'array', scriptFolders: 'array', dependencies: 'array', tasks: 'array', environments: 'array', settings: 'object' }
  for (const [name, shape] of Object.entries(shapes)) {
    const envelope = documents[name]
    assertExactKeys(envelope, ['schemaVersion', 'data'], `${name}.json`)
    const expectedVersion = legacy ? LEGACY_BACKUP_DATA_SCHEMA_VERSION : BACKUP_DATA_SCHEMA_VERSION
    if (envelope.schemaVersion !== expectedVersion) throw new RepositoryError('UNSUPPORTED_DATA_VERSION', `${name}.json 数据版本不受支持`)
    if (shape === 'array' ? !Array.isArray(envelope.data) : !envelope.data || typeof envelope.data !== 'object' || Array.isArray(envelope.data)) {
      throw new RepositoryError('PACKAGE_INVALID', `${name}.json 数据格式无效`)
    }
  }
  const createMap = (items, label) => {
    const result = new Map()
    for (const item of items) {
      if (!item || typeof item !== 'object' || !ENTITY_ID_PATTERN.test(item.id) || result.has(item.id)) throw new RepositoryError('PACKAGE_INVALID', `${label} ID 无效或重复`)
      result.set(item.id, item)
    }
    return result
  }
  const scripts = createMap(documents.scripts.data, '脚本')
  const scriptFolders = createMap(documents.scriptFolders.data, '脚本目录')
  const dependencies = createMap(documents.dependencies.data, '依赖')
  const tasks = createMap(documents.tasks.data, '任务')
  createMap(documents.environments.data, '环境变量')
  const scriptPaths = new Set()
  for (const script of scripts.values()) {
    assertPortableScript(script, legacy)
    let expectedName
    try { expectedName = createManagedScriptFileName(script.id, script.language) } catch { throw new RepositoryError('PACKAGE_INVALID', '脚本托管文件名无效') }
    if (script.managedFileName !== expectedName) throw new RepositoryError('PACKAGE_INVALID', '脚本托管文件名无效')
    const scriptPath = `scripts/${expectedName}`
    if (!hashes.has(scriptPath) || hashes.get(scriptPath) !== script.contentHash) throw new RepositoryError('HASH_MISMATCH', '脚本内容哈希校验失败')
    scriptPaths.add(scriptPath)
  }
  const actualScriptPaths = [...hashes.keys()].filter(item => item.startsWith('scripts/'))
  if (actualScriptPaths.length !== scriptPaths.size || actualScriptPaths.some(item => !scriptPaths.has(item))) throw new RepositoryError('PACKAGE_INVALID', '脚本文件与元数据不是一一对应')
  const folderPaths = new Set()
  for (const folder of scriptFolders.values()) {
    assertExactKeys(folder, ['id', 'relativePath', 'createdAt', 'updatedAt'], '脚本目录')
    assertString(folder.relativePath, '脚本目录路径', { allowEmpty: false })
    if (!isCanonicalIsoDateTime(folder.createdAt) || !isCanonicalIsoDateTime(folder.updatedAt) || folderPaths.has(folder.relativePath.toLowerCase())) throw new RepositoryError('PACKAGE_INVALID', '脚本目录无效或重复')
    folderPaths.add(folder.relativePath.toLowerCase())
  }
  validatePortableTreePaths([...scripts.values()], [...scriptFolders.values()], legacy)
  const dependencyNames = new Set()
  for (const dependency of dependencies.values()) {
    assertExactKeys(dependency, ['id', 'kind', 'name', 'versionSpec', 'createdAt', 'updatedAt'], '依赖')
    const key = `${dependency.kind}:${dependency.name}`
    if (!['node', 'python'].includes(dependency.kind) || typeof dependency.name !== 'string' || typeof dependency.versionSpec !== 'string' || !isCanonicalIsoDateTime(dependency.createdAt) || !isCanonicalIsoDateTime(dependency.updatedAt) || dependencyNames.has(key)) throw new RepositoryError('PACKAGE_INVALID', '依赖声明无效或重复')
    dependencyNames.add(key)
  }
  for (const task of tasks.values()) assertPortableTask(task, scripts)
  const namesByScope = new Set()
  for (const variable of documents.environments.data) assertPortableEnvironment(variable, tasks, manifest, namesByScope)
  if (!manifest.options.includeEnvironments && documents.environments.data.length !== 0) throw new RepositoryError('PACKAGE_INVALID', '未声明环境变量却包含环境数据')
  const expectedEntities = legacy
    ? { scripts: scripts.size, tasks: tasks.size, environments: documents.environments.data.length }
    : { scripts: scripts.size, scriptFolders: scriptFolders.size, dependencies: dependencies.size, tasks: tasks.size, environments: documents.environments.data.length }
  if (Object.entries(expectedEntities).some(([key, count]) => manifest.entities[key] !== count)) throw new RepositoryError('PACKAGE_INVALID', '实体数量与清单不一致')
  assertPortableSettings(documents.settings.data)
}

/** Validates and stages one selected ZIP without modifying formal Scripty repositories. */
async function validateImportPackage(archivePath) {
  let fileDescriptor
  let zipFile
  let temporaryDirectory
  try {
    if (typeof archivePath !== 'string' || !path.isAbsolute(archivePath) || path.extname(archivePath).toLowerCase() !== '.zip') throw new RepositoryError('FILE_TYPE_NOT_ALLOWED', '请选择有效的 ZIP 备份包')
    let stat
    try {
      const pathStat = fs.lstatSync(archivePath)
      if (!pathStat.isFile() || pathStat.isSymbolicLink()) throw new RepositoryError('PATH_NOT_ALLOWED', '所选备份包路径无效')
      fileDescriptor = fs.openSync(archivePath, fs.constants.O_RDONLY)
      stat = fs.fstatSync(fileDescriptor)
      if (!stat.isFile() || stat.dev !== pathStat.dev || stat.ino !== pathStat.ino) {
        throw new RepositoryError('PATH_NOT_ALLOWED', '所选备份包在读取前发生变化')
      }
    } catch (error) {
      if (fileDescriptor !== undefined) {
        try { fs.closeSync(fileDescriptor) } catch {}
        fileDescriptor = undefined
      }
      if (error instanceof RepositoryError) throw error
      throw mapFileSystemError(error, 'READ_FAILED', '无法读取所选备份包')
    }
    if (stat.size > MAX_PACKAGE_BYTES) throw new RepositoryError('PACKAGE_LIMIT_EXCEEDED', '备份文件超过安全限制')
    zipFile = await openZip(fileDescriptor)
    const entries = await scanArchiveEntries(zipFile)
    const manifestEntry = entries.get('manifest.json')
    if (!manifestEntry) throw new RepositoryError('PACKAGE_INVALID', '备份缺少 manifest.json')
    const manifestBuffer = await readEntryBuffer(zipFile, manifestEntry)
    const manifest = validateImportManifest(parsePackageJson(manifestBuffer, 'manifest.json'))
    reconcileManifestEntries(manifest, entries)
    temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'scripty-import-'))
    try { fs.chmodSync(temporaryDirectory, 0o700) } catch {}
    const hashes = new Map()
    const documents = {}
    for (const file of manifest.files) {
      const entry = entries.get(file.path.toLowerCase())
      const content = await readEntryBuffer(zipFile, entry)
      const sha256 = createHash('sha256').update(content).digest('hex')
      if (content.length !== file.size || sha256 !== file.sha256) throw new RepositoryError('HASH_MISMATCH', '备份文件完整性校验失败')
      const targetPath = path.join(temporaryDirectory, ...file.path.split('/'))
      if (!targetPath.startsWith(`${temporaryDirectory}${path.sep}`)) throw new RepositoryError('PATH_NOT_ALLOWED', '备份提取路径无效')
      fs.mkdirSync(path.dirname(targetPath), { recursive: true, mode: 0o700 })
      fs.writeFileSync(targetPath, content, { flag: 'wx', mode: 0o600 })
      hashes.set(file.path, sha256)
      if (file.path.startsWith('data/')) documents[path.basename(file.path, '.json')] = parsePackageJson(content, file.path)
      else textDecoder.decode(content)
    }
    validateImportDocuments(manifest, documents, hashes)
    return { temporaryDirectory, manifest, documents, hashes }
  } catch (error) {
    if (temporaryDirectory) {
      try { fs.rmSync(temporaryDirectory, { recursive: true, force: true }) } catch {}
    }
    if (error instanceof RepositoryError) throw error
    if (error instanceof TypeError) throw new RepositoryError('PACKAGE_INVALID', '备份包含无效 UTF-8 文本', error)
    throw new RepositoryError('PACKAGE_INVALID', '备份包校验失败', error)
  } finally {
    if (zipFile) {
      try { zipFile.close() } catch {}
      fileDescriptor = undefined
    }
    if (fileDescriptor !== undefined) {
      try { fs.closeSync(fileDescriptor) } catch {}
    }
  }
}

module.exports = {
  assertExactKeys,
  parsePackageJson,
  reconcileManifestEntries,
  scanArchiveEntries,
  validateImportDocuments,
  validateImportManifest,
  validateImportPackage
}
